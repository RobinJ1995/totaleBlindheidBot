"""Mock Telegram Bot API server for acceptance tests.

Implements the small subset of the Bot API that totaleBlindheidBot exercises in
polling mode, plus a set of test-only endpoints that behave uses to inject
incoming updates and inspect the bot's outgoing calls.

The bot polls `getUpdates`; we hand it whatever updates behave injected. Every
outgoing `sendMessage`/`editMessageText` is recorded in an in-memory outbox that
behave can read back and assert against.
"""
import logging
import threading
from typing import Any, Dict, List

from flask import Flask, Response, request, jsonify

# The bot busy-polls getUpdates several times a second; without this the
# per-request access log floods stdout and buries the behave output (and the
# CI "dump logs on failure" step). Keep only warnings/errors.
logging.getLogger("werkzeug").setLevel(logging.WARNING)

app = Flask(__name__)

# All shared state is guarded by this lock; the bot polls concurrently with
# behave injecting/reading, so access must be serialised.
_lock = threading.Lock()

# Queue of pending updates the bot has not yet consumed (via getUpdates offset).
_updates: List[Dict[str, Any]] = []
_next_update_id: int = 1

# Ordered record of every outbound API call the bot made (sendMessage, etc.).
_outbox: List[Dict[str, Any]] = []
_next_message_id: int = 1000

# Ordered record of every answerCallbackQuery the bot made, so behave can assert on
# the feedback shown for a button tap (e.g. an expired RSVP).
_callback_answers: List[Dict[str, Any]] = []


def _reset() -> None:
    # NOTE: _next_update_id is deliberately NOT reset. The bot's long-poll
    # offset increases monotonically for the life of its process, so update_ids
    # must keep climbing across scenario resets — otherwise post-reset updates
    # fall below the bot's offset and getUpdates never delivers them.
    global _updates, _outbox, _callback_answers
    _updates = []
    _outbox = []
    _callback_answers = []


# ---------------------------------------------------------------------------
# Telegram Bot API surface (called by the bot). Routed by method name.
# ---------------------------------------------------------------------------

def _params() -> Dict[str, Any]:
    """Telegram clients may send JSON, form-encoded or query params."""
    data: Dict[str, Any] = {}
    if request.is_json:
        data.update(request.get_json(silent=True) or {})
    data.update(request.form.to_dict())
    data.update(request.args.to_dict())
    return data


@app.route("/bot<token>/<method>", methods=["GET", "POST"])
def bot_api(token: str, method: str) -> Response:
    global _next_message_id
    params = _params()

    if method == "getUpdates":
        offset = int(params.get("offset", 0) or 0)
        with _lock:
            if offset:
                # Telegram semantics: offset confirms receipt of everything
                # with update_id < offset, so drop those.
                _updates[:] = [u for u in _updates if u["update_id"] >= offset]
            result = list(_updates)
        return jsonify({"ok": True, "result": result})

    if method == "sendMessage":
        with _lock:
            message_id = _next_message_id
            _next_message_id += 1
            chat_id = params.get("chat_id")
            text = params.get("text", "")
            _outbox.append({
                "method": "sendMessage",
                "chat_id": str(chat_id) if chat_id is not None else None,
                "message_id": message_id,
                "text": text,
                "params": params,
            })
        return jsonify({
            "ok": True,
            "result": {
                "message_id": message_id,
                "date": 0,
                "chat": {"id": _maybe_int(chat_id), "type": "group"},
                "text": text,
            },
        })

    if method == "editMessageText":
        with _lock:
            chat_id = params.get("chat_id")
            text = params.get("text", "")
            _outbox.append({
                "method": "editMessageText",
                "chat_id": str(chat_id) if chat_id is not None else None,
                "message_id": _maybe_int(params.get("message_id")),
                "text": text,
                "params": params,
            })
        return jsonify({
            "ok": True,
            "result": {
                "message_id": _maybe_int(params.get("message_id")),
                "date": 0,
                "chat": {"id": _maybe_int(chat_id), "type": "group"},
                "text": text,
            },
        })

    if method == "answerCallbackQuery":
        with _lock:
            _callback_answers.append({
                "callback_query_id": params.get("callback_query_id"),
                "text": params.get("text"),
            })
        return jsonify({"ok": True, "result": True})

    if method == "getMe":
        return jsonify({
            "ok": True,
            "result": {
                "id": 42,
                "is_bot": True,
                "first_name": "TestBot",
                "username": "test_bot",
            },
        })

    # deleteWebhook and anything else the library happens to call.
    return jsonify({"ok": True, "result": True})


def _maybe_int(value: Any) -> Any:
    try:
        return int(value)
    except (TypeError, ValueError):
        return value


# ---------------------------------------------------------------------------
# Test-only endpoints (called by behave).
# ---------------------------------------------------------------------------

@app.route("/test/inject", methods=["POST"])
def inject() -> Response:
    """Queue a Telegram update built from a message payload.

    Accepts either a full update (`{"update_id": ..., "message": {...}}`) or a
    bare message object, which is wrapped into an update automatically.
    """
    global _next_update_id
    body = request.get_json(force=True) or {}
    with _lock:
        if any(key in body for key in ("message", "edited_message", "callback_query")):
            update = dict(body)
        else:
            update = {"message": body}
        update["update_id"] = _next_update_id
        _next_update_id += 1
        _updates.append(update)
        update_id = update["update_id"]
    return jsonify({"ok": True, "update_id": update_id})


@app.route("/test/outbox", methods=["GET"])
def outbox() -> Response:
    chat_id = request.args.get("chat_id")
    with _lock:
        if chat_id is not None:
            result = [m for m in _outbox if m.get("chat_id") == str(chat_id)]
        else:
            result = list(_outbox)
    return jsonify({"ok": True, "outbox": result})


@app.route("/test/callback-answers", methods=["GET"])
def callback_answers() -> Response:
    with _lock:
        return jsonify({"ok": True, "answers": list(_callback_answers)})


@app.route("/test/reset", methods=["POST"])
def reset() -> Response:
    with _lock:
        _reset()
    return jsonify({"ok": True})


@app.route("/test/health", methods=["GET"])
def health() -> Response:
    return jsonify({"ok": True})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8081, threaded=True)
