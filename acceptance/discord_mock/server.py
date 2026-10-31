"""Mock Discord for acceptance tests: the REST API subset the bot uses plus a gateway WebSocket.

The real discord.js in the bot container connects here (`GET /api/v10/gateway/bot` points it at
the mock gateway); REST calls are answered from in-memory state and recorded in an outbox.

Test-only endpoints let behave define servers and channels, inject messages as if Discord users
sent them, and read back everything the bot posted.
"""
import asyncio
import itertools
import json
import logging
import os
import threading
import time
from typing import Any, Dict, List, Optional

import websockets
from flask import Flask, Response, jsonify, request

logging.getLogger("werkzeug").setLevel(logging.WARNING)
logging.getLogger("websockets").setLevel(logging.WARNING)

REST_PORT = int(os.environ.get("DISCORD_MOCK_PORT", "8083"))
GATEWAY_PORT = int(os.environ.get("DISCORD_MOCK_GATEWAY_PORT", "8084"))
GATEWAY_URL = os.environ.get("DISCORD_MOCK_GATEWAY_URL", f"ws://discord-mock:{GATEWAY_PORT}")

APPLICATION_ID = os.environ.get("DISCORD_APPLICATION_ID", "990000000000000000")
BOT_USER = {
    "id": "990000000000000001",
    "username": "tbb_bot",
    "global_name": "TotaleBlindheidBot",
    "discriminator": "0",
    "avatar": None,
    "bot": True,
}

# Permission bits (https://discord.com/developers/docs/topics/permissions).
PERMISSIONS = {
    "View Channel": 1 << 10,
    "Send Messages": 1 << 11,
    "Embed Links": 1 << 14,
    "Attach Files": 1 << 15,
    "Read Message History": 1 << 16,
    "Use External Emojis": 1 << 18,
    "Manage Webhooks": 1 << 29,
}
DEFAULT_PERMISSIONS = sum(PERMISSIONS.values())

app = Flask(__name__)
_lock = threading.Lock()

_guilds: Dict[str, Dict[str, Any]] = {}      # guild id -> {"id", "name", "channels": {id: channel}, "permissions": int, "members": {user id: user}}
_webhooks: Dict[str, Dict[str, Any]] = {}    # webhook id -> webhook object (with token)
_outbox: List[Dict[str, Any]] = []           # everything the bot posted, in order
_ids = itertools.count(100000000000000001)   # snowflake-ish ids for messages and webhooks

_loop: Optional[asyncio.AbstractEventLoop] = None
_sockets: set = set()
_sequence = itertools.count(1)


def _next_id() -> str:
    return str(next(_ids))


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S.000000+00:00", time.gmtime())


# ---------------------------------------------------------------------------
# Discord objects as discord.js expects them.
# ---------------------------------------------------------------------------

def _channel_object(guild: Dict[str, Any], channel: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": channel["id"],
        "type": channel.get("type", 0),
        "guild_id": guild["id"],
        "name": channel["name"],
        "position": 0,
        "permission_overwrites": channel.get("permission_overwrites", []),
        "nsfw": False,
        "parent_id": None,
        "topic": None,
        "last_message_id": None,
        "rate_limit_per_user": 0,
    }


def _bot_member(guild: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "user": BOT_USER,
        "nick": None,
        "roles": [],
        "joined_at": _now(),
        "deaf": False,
        "mute": False,
        "flags": 0,
        "guild_id": guild["id"],
    }


def _guild_object(guild: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": guild["id"],
        "name": guild["name"],
        "icon": None,
        "owner_id": "1",
        "region": "eu",
        "afk_channel_id": None,
        "afk_timeout": 300,
        "verification_level": 0,
        "default_message_notifications": 0,
        "explicit_content_filter": 0,
        "mfa_level": 0,
        "system_channel_id": None,
        "premium_tier": 0,
        "preferred_locale": "en-US",
        "nsfw_level": 0,
        "features": [],
        "emojis": [],
        "stickers": [],
        "roles": [{
            "id": guild["id"],
            "name": "@everyone",
            "color": 0,
            "hoist": False,
            "position": 0,
            "permissions": str(guild["permissions"]),
            "managed": False,
            "mentionable": False,
            "flags": 0,
        }],
        "member_count": 2,
        "joined_at": _now(),
        "large": False,
        "unavailable": False,
        "channels": [_channel_object(guild, c) for c in guild["channels"].values()],
        "threads": [],
        "members": [_bot_member(guild)],
        "presences": [],
        "voice_states": [],
    }


def _message_object(channel_id: str, guild_id: Optional[str], content: str, author: Dict[str, Any],
                    webhook_id: Optional[str] = None, member: Optional[Dict[str, Any]] = None,
                    attachments: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    message: Dict[str, Any] = {
        "id": _next_id(),
        "channel_id": channel_id,
        "author": author,
        "content": content,
        "timestamp": _now(),
        "edited_timestamp": None,
        "tts": False,
        "mention_everyone": False,
        "mentions": [],
        "mention_roles": [],
        "attachments": attachments or [],
        "embeds": [],
        "pinned": False,
        "type": 0,
        "flags": 0,
    }
    if guild_id is not None:
        message["guild_id"] = guild_id
        message["member"] = member or {"nick": None, "roles": [], "joined_at": _now(), "deaf": False, "mute": False, "flags": 0}
    if webhook_id is not None:
        message["webhook_id"] = webhook_id
    return message


def _find_channel(channel_id: str):
    for guild in _guilds.values():
        channel = guild["channels"].get(channel_id)
        if channel:
            return guild, channel
    return None, None


# ---------------------------------------------------------------------------
# Gateway (asyncio websockets server on its own thread).
# ---------------------------------------------------------------------------

def _dispatch(event: str, data: Dict[str, Any]) -> None:
    """Send a dispatch to every connected shard."""
    payload = json.dumps({"op": 0, "t": event, "s": next(_sequence), "d": data})
    if _loop is None:
        return
    for socket in list(_sockets):
        asyncio.run_coroutine_threadsafe(socket.send(payload), _loop)


async def _gateway_connection(socket) -> None:
    _sockets.add(socket)
    try:
        await socket.send(json.dumps({"op": 10, "d": {"heartbeat_interval": 41250}}))
        async for raw in socket:
            payload = json.loads(raw)
            op = payload.get("op")
            if op == 1:  # heartbeat
                await socket.send(json.dumps({"op": 11}))
            elif op == 2:  # identify
                with _lock:
                    guilds = [{"id": g["id"], "unavailable": True} for g in _guilds.values()]
                    ready = {
                        "v": 10,
                        "user": BOT_USER,
                        "guilds": guilds,
                        "session_id": "mock-session",
                        "resume_gateway_url": GATEWAY_URL,
                        "application": {"id": APPLICATION_ID, "flags": 0},
                        "shard": [0, 1],
                    }
                    guild_objects = [_guild_object(g) for g in _guilds.values()]
                await socket.send(json.dumps({"op": 0, "t": "READY", "s": next(_sequence), "d": ready}))
                for guild in guild_objects:
                    await socket.send(json.dumps({"op": 0, "t": "GUILD_CREATE", "s": next(_sequence), "d": guild}))
            elif op == 6:  # resume
                await socket.send(json.dumps({"op": 0, "t": "RESUMED", "s": next(_sequence), "d": {}}))
    finally:
        _sockets.discard(socket)


def _run_gateway() -> None:
    global _loop
    _loop = asyncio.new_event_loop()
    asyncio.set_event_loop(_loop)

    async def serve() -> None:
        async with websockets.serve(_gateway_connection, "0.0.0.0", GATEWAY_PORT):
            await asyncio.Future()

    _loop.run_until_complete(serve())


# ---------------------------------------------------------------------------
# REST API (called by the bot through discord.js).
# ---------------------------------------------------------------------------

def _error(status: int, code: int, message: str) -> Response:
    response = jsonify({"code": code, "message": message})
    response.status_code = status
    return response


def _body() -> Dict[str, Any]:
    if request.is_json:
        return request.get_json(silent=True) or {}
    payload = request.form.get("payload_json")
    return json.loads(payload) if payload else {}


def _attachments_from_upload() -> List[Dict[str, Any]]:
    """Files attached to a multipart message, served back from /cdn so Telegram-bound relays work."""
    attachments: List[Dict[str, Any]] = []
    for key, storage in request.files.items():
        data = storage.read()
        attachment_id = _next_id()
        _files[attachment_id] = {"name": storage.filename, "content_type": storage.content_type, "data": data}
        attachments.append({
            "id": attachment_id,
            "filename": storage.filename,
            "size": len(data),
            "content_type": storage.content_type,
            "url": f"{request.host_url.rstrip('/')}/cdn/attachments/{attachment_id}/{storage.filename}",
            "proxy_url": f"{request.host_url.rstrip('/')}/cdn/attachments/{attachment_id}/{storage.filename}",
        })
    return attachments


_files: Dict[str, Dict[str, Any]] = {}

# Injected interactions by token, so responses can be tied back to their channel.
_commands: Dict[str, List[Dict[str, Any]]] = {}
_interactions: Dict[str, Dict[str, Any]] = {}


@app.route("/api/v10/gateway/bot", methods=["GET"])
def gateway_bot() -> Response:
    return jsonify({
        "url": GATEWAY_URL,
        "shards": 1,
        "session_start_limit": {"total": 1000, "remaining": 1000, "reset_after": 0, "max_concurrency": 1},
    })


@app.route("/api/v10/channels/<channel_id>", methods=["GET"])
def get_channel(channel_id: str) -> Response:
    with _lock:
        guild, channel = _find_channel(channel_id)
        if not channel:
            return _error(404, 10003, "Unknown Channel")
        return jsonify(_channel_object(guild, channel))


@app.route("/api/v10/guilds/<guild_id>/members/@me", methods=["GET"])
def get_me_member(guild_id: str) -> Response:
    with _lock:
        guild = _guilds.get(guild_id)
        if not guild:
            return _error(404, 10004, "Unknown Guild")
        return jsonify(_bot_member(guild))


def _member_object(guild: Dict[str, Any], user: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "user": {"discriminator": "0", "avatar": None, "bot": False, "global_name": None, **user},
        "nick": user.get("nick"),
        "roles": [],
        "joined_at": _now(),
        "deaf": False,
        "mute": False,
        "flags": 0,
    }


@app.route("/api/v10/guilds/<guild_id>/members/search", methods=["GET"])
def search_members(guild_id: str) -> Response:
    """Members whose username or display name starts with the query, like Discord's search."""
    query = (request.args.get("query") or "").lower()
    limit = int(request.args.get("limit", 1))
    with _lock:
        guild = _guilds.get(guild_id)
        if not guild:
            return _error(404, 10004, "Unknown Guild")
        hits = [
            _member_object(guild, user) for user in guild["members"].values()
            if user["username"].lower().startswith(query) or (user.get("global_name") or "").lower().startswith(query)
        ]
    return jsonify(hits[:limit])


@app.route("/api/v10/channels/<channel_id>/messages", methods=["POST"])
def create_message(channel_id: str) -> Response:
    body = _body()
    with _lock:
        guild, channel = _find_channel(channel_id)
        if not channel:
            return _error(404, 10003, "Unknown Channel")
        attachments = _attachments_from_upload()
        message = _message_object(
            channel_id, guild["id"], body.get("content", ""), BOT_USER,
            member=_bot_member(guild), attachments=attachments
        )
        _outbox.append({
            "method": "createMessage",
            "channel_id": channel_id,
            "message_id": message["id"],
            "content": message["content"],
            "username": None,
            "attachments": [{"filename": a["filename"], "size": a["size"], "content_type": a["content_type"]} for a in attachments],
            "params": body,
        })
    _dispatch("MESSAGE_CREATE", message)
    return jsonify(message)


@app.route("/api/v10/channels/<channel_id>/messages/<message_id>", methods=["PATCH"])
def edit_message(channel_id: str, message_id: str) -> Response:
    body = _body()
    with _lock:
        guild, channel = _find_channel(channel_id)
        if not channel:
            return _error(404, 10003, "Unknown Channel")
        message = _message_object(channel_id, guild["id"], body.get("content", ""), BOT_USER)
        message["id"] = message_id
        _outbox.append({
            "method": "editMessage",
            "channel_id": channel_id,
            "message_id": message_id,
            "content": message["content"],
            "username": None,
            "attachments": [],
            "params": body,
        })
    return jsonify(message)


@app.route("/api/v10/channels/<channel_id>/webhooks", methods=["POST"])
def create_webhook(channel_id: str) -> Response:
    body = _body()
    with _lock:
        guild, channel = _find_channel(channel_id)
        if not channel:
            return _error(404, 10003, "Unknown Channel")
        webhook_id = _next_id()
        webhook = {
            "id": webhook_id,
            "type": 1,
            "guild_id": guild["id"],
            "channel_id": channel_id,
            "name": body.get("name", "webhook"),
            "avatar": None,
            "token": f"token-{webhook_id}",
            "application_id": APPLICATION_ID,
            "user": BOT_USER,
        }
        _webhooks[webhook_id] = webhook
        return jsonify(webhook)


@app.route("/api/v10/channels/<channel_id>/webhooks", methods=["GET"])
def list_webhooks(channel_id: str) -> Response:
    with _lock:
        return jsonify([w for w in _webhooks.values() if w["channel_id"] == channel_id])


@app.route("/api/v10/webhooks/<webhook_id>/<token>", methods=["GET"])
def get_webhook(webhook_id: str, token: str) -> Response:
    with _lock:
        webhook = _webhooks.get(webhook_id)
        if not webhook or webhook["token"] != token:
            return _error(404, 10015, "Unknown Webhook")
        return jsonify(webhook)


@app.route("/api/v10/webhooks/<webhook_id>/<token>", methods=["DELETE"])
def delete_webhook(webhook_id: str, token: str) -> Response:
    with _lock:
        webhook = _webhooks.pop(webhook_id, None)
        if not webhook or webhook["token"] != token:
            return _error(404, 10015, "Unknown Webhook")
        _outbox.append({"method": "deleteWebhook", "channel_id": webhook["channel_id"], "message_id": None,
                        "content": "", "username": None, "attachments": [], "params": {}})
    return Response(status=204)


@app.route("/api/v10/webhooks/<webhook_id>/<token>", methods=["POST"])
def execute_webhook(webhook_id: str, token: str) -> Response:
    body = _body()
    with _lock:
        webhook = _webhooks.get(webhook_id)
        if not webhook or webhook["token"] != token:
            return _error(404, 10015, "Unknown Webhook")
        guild, channel = _find_channel(webhook["channel_id"])
        attachments = _attachments_from_upload()
        author = {
            "id": webhook_id, "username": body.get("username") or webhook["name"], "discriminator": "0000",
            "avatar": None, "bot": True,
        }
        message = _message_object(
            webhook["channel_id"], guild["id"], body.get("content", ""), author,
            webhook_id=webhook_id, attachments=attachments
        )
        _outbox.append({
            "method": "executeWebhook",
            "channel_id": webhook["channel_id"],
            "message_id": message["id"],
            "content": message["content"],
            "username": body.get("username"),
            "attachments": [{"filename": a["filename"], "size": a["size"], "content_type": a["content_type"]} for a in attachments],
            "params": body,
        })
    # Webhook messages reach the gateway like any other message in the channel.
    _dispatch("MESSAGE_CREATE", message)
    return jsonify(message)


@app.route("/api/v10/applications/<application_id>/guilds/<guild_id>/commands", methods=["PUT"])
def set_guild_commands(application_id: str, guild_id: str) -> Response:
    body = request.get_json(force=True) or []
    with _lock:
        commands = [{"id": _next_id(), "application_id": application_id, "guild_id": guild_id, "version": "1", "type": 1, **c} for c in body]
        _commands[guild_id] = commands
    return jsonify(commands)


def _record_interaction_message(interaction: Dict[str, Any], method: str, body: Dict[str, Any], message_id: Optional[str] = None) -> Dict[str, Any]:
    guild, channel = _find_channel(interaction["channel_id"])
    message = _message_object(interaction["channel_id"], guild["id"] if guild else None, body.get("content", ""), BOT_USER)
    if message_id:
        message["id"] = message_id
    message["components"] = body.get("components", [])
    _outbox.append({
        "method": method,
        "channel_id": interaction["channel_id"],
        "message_id": message["id"],
        "content": message["content"],
        "username": None,
        "attachments": [],
        "params": body,
    })
    return message


@app.route("/api/v10/interactions/<interaction_id>/<token>/callback", methods=["POST"])
def interaction_callback(interaction_id: str, token: str) -> Response:
    """The bot's first response to an interaction: a deferral (5/6), a message (4) or an update (7)."""
    body = _body()
    with _lock:
        interaction = _interactions.get(token)
        if not interaction:
            return _error(404, 10062, "Unknown interaction")
        data = body.get("data") or {}
        _outbox.append({
            "method": "interactionCallback",
            "channel_id": interaction["channel_id"],
            "message_id": None,
            "content": data.get("content", ""),
            "username": None,
            "attachments": [],
            "params": {"type": body.get("type"), "data": data, "interaction_id": interaction_id},
        })
        if body.get("type") == 4:
            interaction["original"] = _record_interaction_message(interaction, "interactionReply", data)
        elif body.get("type") == 5:
            interaction["original"] = _message_object(interaction["channel_id"], interaction.get("guild_id"), "", BOT_USER)
    return Response(status=204)


@app.route("/api/v10/webhooks/<application_id>/<token>/messages/@original", methods=["PATCH"])
def edit_original(application_id: str, token: str) -> Response:
    """editReply: the deferred response becomes a real message in the channel."""
    body = _body()
    with _lock:
        interaction = _interactions.get(token)
        if not interaction:
            return _error(404, 10062, "Unknown interaction")
        original = interaction.get("original")
        message = _record_interaction_message(interaction, "editReply", body, original["id"] if original else None)
        interaction["original"] = message
    return jsonify(message)


@app.route("/api/v10/webhooks/<application_id>/<token>/messages/@original", methods=["GET"])
def get_original(application_id: str, token: str) -> Response:
    with _lock:
        interaction = _interactions.get(token)
        if not interaction or not interaction.get("original"):
            return _error(404, 10008, "Unknown Message")
        return jsonify(interaction["original"])


@app.route("/api/v10/webhooks/<application_id>/<token>/messages/@original", methods=["DELETE"])
def delete_original(application_id: str, token: str) -> Response:
    with _lock:
        interaction = _interactions.get(token)
        if interaction:
            interaction["original"] = None
            _outbox.append({"method": "deleteReply", "channel_id": interaction["channel_id"], "message_id": None,
                            "content": "", "username": None, "attachments": [], "params": {}})
    return Response(status=204)


@app.route("/api/v10/webhooks/<application_id>/<token>", methods=["POST"])
def follow_up(application_id: str, token: str) -> Response:
    """followUp on an interaction (its token looks like a webhook token to discord.js)."""
    body = _body()
    with _lock:
        interaction = _interactions.get(token)
        if not interaction:
            return _error(404, 10015, "Unknown Webhook")
        message = _record_interaction_message(interaction, "followUp", body)
    return jsonify(message)


@app.route("/cdn/stickers/<path:name>", methods=["GET"])
def cdn_sticker(name: str) -> Response:
    sticker_id = name.split(".")[0]
    with _lock:
        stored = _files.get(f"sticker-{sticker_id}")
    if not stored:
        return Response(status=404)
    return Response(stored["data"], content_type=stored["content_type"] or "application/octet-stream")


@app.route("/cdn/attachments/<attachment_id>/<filename>", methods=["GET"])
def cdn_attachment(attachment_id: str, filename: str) -> Response:
    with _lock:
        stored = _files.get(attachment_id)
    if not stored:
        return Response(status=404)
    return Response(stored["data"], content_type=stored["content_type"] or "application/octet-stream")


@app.route("/api/v10/<path:rest>", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
def unhandled(rest: str) -> Response:
    return _error(404, 0, f"discord_mock: no handler for {request.method} /api/v10/{rest}")


# ---------------------------------------------------------------------------
# Test-only endpoints (called by behave).
# ---------------------------------------------------------------------------

@app.route("/test/guilds", methods=["POST"])
def define_guild() -> Response:
    """Define a server with channels, as if the bot had just been added to it. A guild already
    defined is left as it is."""
    body = request.get_json(force=True) or {}
    with _lock:
        if body["id"] in _guilds:
            return jsonify({"ok": True, "created": False})
        permissions = DEFAULT_PERMISSIONS
        if "permissions" in body:
            permissions = sum(PERMISSIONS[name] for name in body["permissions"])
        channels: Dict[str, Dict[str, Any]] = {}
        for spec in body.get("channels", []):
            overwrites = []
            if spec.get("deny"):
                overwrites.append({
                    "id": BOT_USER["id"], "type": 1, "allow": "0",
                    "deny": str(sum(PERMISSIONS[name] for name in spec["deny"])),
                })
            channels[spec["id"]] = {"id": spec["id"], "name": spec["name"], "type": spec.get("type", 0),
                                    "permission_overwrites": overwrites}
        members: Dict[str, Dict[str, Any]] = {m["id"]: m for m in body.get("members", [])}
        guild = {"id": body["id"], "name": body["name"], "permissions": permissions, "channels": channels, "members": members}
        _guilds[body["id"]] = guild
        guild_object = _guild_object(guild)
    _dispatch("GUILD_CREATE", guild_object)
    return jsonify({"ok": True, "created": True})


@app.route("/test/inject", methods=["POST"])
def inject_message() -> Response:
    """Deliver a message to the bot as if a Discord user sent it in a channel."""
    body = request.get_json(force=True) or {}
    with _lock:
        guild, channel = _find_channel(body["channel_id"])
        if not channel:
            return _error(404, 10003, "Unknown Channel")
        author = {"discriminator": "0", "avatar": None, "bot": False, "global_name": None}
        author.update(body["author"])
        if not author.get("bot"):
            guild["members"][author["id"]] = {k: author[k] for k in ("id", "username", "global_name")}
        attachments = []
        for spec in body.get("attachments", []):
            attachment_id = _next_id()
            data = spec.get("data_base64")
            url = spec.get("url")
            if data is not None:
                import base64
                raw = base64.b64decode(data)
                _files[attachment_id] = {"name": spec["filename"], "content_type": spec.get("content_type"), "data": raw}
                url = f"http://{request.host}/cdn/attachments/{attachment_id}/{spec['filename']}"
                size = len(raw)
            else:
                size = spec.get("size", 0)
            attachments.append({"id": attachment_id, "filename": spec["filename"], "size": size,
                                "content_type": spec.get("content_type"), "url": url, "proxy_url": url})
        member = {"nick": body.get("nick"), "roles": [], "joined_at": _now(), "deaf": False, "mute": False, "flags": 0}
        message = _message_object(
            body["channel_id"], guild["id"], body.get("content", ""), author,
            webhook_id=body.get("webhook_id"), member=member, attachments=attachments
        )
        message["mentions"] = body.get("mentions", [])
        # format_type: 1 PNG, 2 APNG, 3 Lottie, 4 GIF.
        stickers = []
        for spec in body.get("stickers", []):
            if spec.get("data_base64") is not None:
                import base64
                _files[f"sticker-{spec['id']}"] = {
                    "name": spec["name"], "content_type": spec.get("content_type"),
                    "data": base64.b64decode(spec["data_base64"]),
                }
            stickers.append({"id": spec["id"], "name": spec["name"], "format_type": spec["format_type"]})
        if stickers:
            message["sticker_items"] = stickers
    _dispatch("MESSAGE_CREATE", message)
    return jsonify({"ok": True, "message_id": message["id"]})


def _interaction_base(body: Dict[str, Any]) -> Dict[str, Any]:
    guild, channel = _find_channel(body["channel_id"])
    user = {"discriminator": "0", "avatar": None, "bot": False, "global_name": None, **body["user"]}
    if guild and not user.get("bot"):
        guild["members"][user["id"]] = {k: user[k] for k in ("id", "username", "global_name")}
    interaction_id = _next_id()
    token = f"interaction-token-{interaction_id}"
    interaction = {
        "id": interaction_id,
        "application_id": APPLICATION_ID,
        "token": token,
        "version": 1,
        "guild_id": guild["id"] if guild else None,
        "channel_id": body["channel_id"],
        "channel": _channel_object(guild, channel) if channel else {"id": body["channel_id"], "type": 0},
        "member": {
            "user": user, "nick": body.get("nick"), "roles": [], "joined_at": _now(), "deaf": False, "mute": False,
            "flags": 0, "permissions": str(DEFAULT_PERMISSIONS),
        },
        "user": user,
        "app_permissions": str(DEFAULT_PERMISSIONS),
        "locale": "en-GB",
        "guild_locale": "en-US",
        "entitlements": [],
        "authorizing_integration_owners": {"0": guild["id"] if guild else "0"},
        "context": 0,
        "attachment_size_limit": 26214400,
    }
    _interactions[token] = {"channel_id": body["channel_id"], "guild_id": interaction["guild_id"], "original": None}
    return interaction


@app.route("/test/interactions/command", methods=["POST"])
def inject_command() -> Response:
    """Invoke a slash command as a Discord user; it must be registered in the channel's server."""
    body = request.get_json(force=True) or {}
    with _lock:
        interaction = _interaction_base(body)
        registered = next((c for c in _commands.get(interaction["guild_id"] or "", []) if c["name"] == body["name"]), None)
        if not registered:
            return _error(404, 0, f"discord_mock: command {body['name']!r} is not registered in guild {interaction['guild_id']}")
        options = []
        if body.get("argument"):
            options.append({"type": 3, "name": body["argument"]["name"], "value": body["argument"]["value"]})
        interaction["type"] = 2
        interaction["data"] = {
            "id": registered["id"], "name": registered["name"], "type": 1, "options": options,
            "guild_id": interaction["guild_id"],
        }
    _dispatch("INTERACTION_CREATE", interaction)
    return jsonify({"ok": True, "token": interaction["token"]})


@app.route("/test/interactions/button", methods=["POST"])
def inject_button() -> Response:
    """Tap a button on a message the bot posted."""
    body = request.get_json(force=True) or {}
    with _lock:
        interaction = _interaction_base(body)
        guild, channel = _find_channel(body["channel_id"])
        posted = next((m for m in reversed(_outbox) if m["channel_id"] == body["channel_id"] and m["message_id"] == body["message_id"]), None)
        message = _message_object(body["channel_id"], guild["id"] if guild else None, posted["content"] if posted else "", BOT_USER)
        message["id"] = body["message_id"]
        message["components"] = (posted or {}).get("params", {}).get("components", [])
        interaction["type"] = 3
        interaction["message"] = message
        interaction["data"] = {"custom_id": body["custom_id"], "component_type": 2}
    _dispatch("INTERACTION_CREATE", interaction)
    return jsonify({"ok": True, "token": interaction["token"]})


@app.route("/test/commands", methods=["GET"])
def test_commands() -> Response:
    with _lock:
        return jsonify({"ok": True, "commands": {g: [c["name"] for c in cs] for g, cs in _commands.items()}})


@app.route("/test/outbox", methods=["GET"])
def outbox() -> Response:
    channel_id = request.args.get("channel_id")
    with _lock:
        if channel_id is not None:
            result = [m for m in _outbox if m.get("channel_id") == channel_id]
        else:
            result = list(_outbox)
    return jsonify({"ok": True, "outbox": result})


@app.route("/test/webhooks", methods=["GET"])
def test_webhooks() -> Response:
    with _lock:
        return jsonify({"ok": True, "webhooks": list(_webhooks.values())})


@app.route("/test/reset", methods=["POST"])
def reset() -> Response:
    """Forget what the bot posted. Servers and webhooks persist, since the bot's database does too."""
    with _lock:
        _outbox.clear()
        _files.clear()
    return jsonify({"ok": True})


@app.route("/test/health", methods=["GET"])
def health() -> Response:
    return jsonify({"ok": True, "gateway_connected": len(_sockets) > 0})


if __name__ == "__main__":
    threading.Thread(target=_run_gateway, daemon=True).start()
    app.run(host="0.0.0.0", port=REST_PORT, threaded=True)
