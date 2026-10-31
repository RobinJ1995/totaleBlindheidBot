"""Steps for the Discord side: defining servers, speaking as Discord users, asserting on what the bot
posted there. The Telegram side of the same scenarios uses telegram_steps.py."""
from typing import Any, Callable, Dict, List, Optional

from behave import given, when, then, use_step_matcher
from behave.runner import Context

import helpers

use_step_matcher("re")

BOT_USER_ID = "990000000000000001"


def _baseline(context: Context, channel_id: str) -> int:
    return getattr(context, "discord_baselines", {}).get(channel_id, 0)


def _new_messages(context: Context, channel_id: str, accept: Callable[[Dict[str, Any]], bool] = lambda message: True) -> List[Dict[str, Any]]:
    return helpers.discord_wait_for_new(channel_id, _baseline(context, channel_id), accept=accept)


def _author(username: str, name: str, user_id: str) -> Dict[str, Any]:
    return {"id": user_id, "username": username, "global_name": name}


@given('a Discord server "(?P<guild_id>\\d+)" named "(?P<name>[^"]*)" with channel "(?P<channel_id>\\d+)" named "(?P<channel>[^"]*)"')
def step_discord_server(context: Context, guild_id: str, name: str, channel_id: str, channel: str) -> None:
    helpers.discord_define_guild(guild_id, name, [{"id": channel_id, "name": channel}])


@given('a Discord server "(?P<guild_id>\\d+)" named "(?P<name>[^"]*)" with channel "(?P<channel_id>\\d+)" named "(?P<channel>[^"]*)" where the bot lacks "(?P<perms>[^"]*)"')
def step_discord_server_lacking(context: Context, guild_id: str, name: str, channel_id: str, channel: str, perms: str) -> None:
    deny: List[str] = [p.strip() for p in perms.split(",")]
    helpers.discord_define_guild(guild_id, name, [{"id": channel_id, "name": channel, "deny": deny}])


@given('the user is an admin of the chat')
def step_user_is_admin(context: Context) -> None:
    helpers.make_admin(context.chat_id, context.user["id"])


@given('Discord channel "(?P<channel_id>\\d+)" is linked to the chat')
def step_channel_linked(context: Context, channel_id: str) -> None:
    """Link through the real command, as an admin, and wait for the confirmation. The database is
    not reset between scenarios, so a link made by an earlier scenario (a Background) still counts."""
    helpers.make_admin(context.chat_id, context.user["id"])
    baseline: int = len(helpers.get_outbox(context.chat_id))
    discord_baseline: int = len(helpers.discord_outbox(channel_id))
    helpers.inject_message(f"/link_chat {channel_id}", context.chat_id, context.user)
    replies: List[Dict[str, Any]] = helpers.wait_for_new_message(context.chat_id, baseline)
    texts: List[str] = [m["text"] for m in replies]
    if any(t == "That channel is already linked to this group." for t in texts):
        return
    assert any(t.startswith("Linked to") for t in texts), f"Linking channel {channel_id} failed: {texts}"
    helpers.discord_wait_for_new(channel_id, discord_baseline)


def _inject(context: Context, channel_id: str, content: str, author: Dict[str, Any], **extra: Any) -> None:
    context.cmd_chat = context.chat_id
    context.cmd_baseline = len(helpers.get_outbox(context.chat_id))
    helpers.discord_inject(channel_id, content, author, **extra)


@when('Discord user "(?P<username>[^"]*)" named "(?P<name>[^"]*)" with id "(?P<user_id>\\d+)" says "(?P<text>[^"]*)" in channel "(?P<channel_id>\\d+)"')
def step_discord_user_says(context: Context, username: str, name: str, user_id: str, text: str, channel_id: str) -> None:
    _inject(context, channel_id, text, _author(username, name, user_id))


@when('Discord user "(?P<username>[^"]*)" named "(?P<name>[^"]*)" with id "(?P<user_id>\\d+)" says "(?P<text>[^"]*)" in channel "(?P<channel_id>\\d+)" mentioning user "(?P<mentioned_id>\\d+)" named "(?P<mentioned>[^"]*)"')
def step_discord_user_says_mentioning(context: Context, username: str, name: str, user_id: str, text: str, channel_id: str, mentioned_id: str, mentioned: str) -> None:
    mentions: List[Dict[str, Any]] = [{"id": mentioned_id, "username": mentioned.lower(), "global_name": mentioned, "discriminator": "0", "avatar": None}]
    _inject(context, channel_id, text, _author(username, name, user_id), mentions=mentions)


@when('the bot itself says "(?P<text>[^"]*)" in Discord channel "(?P<channel_id>\\d+)"')
def step_bot_says(context: Context, text: str, channel_id: str) -> None:
    _inject(context, channel_id, text, {"id": BOT_USER_ID, "username": "tbb_bot", "bot": True})


@when('the relay webhook of channel "(?P<channel_id>\\d+)" posts "(?P<text>[^"]*)"')
def step_webhook_posts(context: Context, channel_id: str, text: str) -> None:
    webhooks: List[Dict[str, Any]] = helpers.discord_webhooks()
    hook: Optional[Dict[str, Any]] = next((w for w in webhooks if w["channel_id"] == channel_id), None)
    assert hook, f"No relay webhook exists for channel {channel_id}"
    _inject(context, channel_id, text, {"id": hook["id"], "username": "Someone", "bot": True}, webhook_id=hook["id"])


@then('Discord channel "(?P<channel_id>\\d+)" receives "(?P<text>[^"]*)" from "(?P<name>[^"]*)"')
def step_channel_receives_from(context: Context, channel_id: str, text: str, name: str) -> None:
    """A relayed message: posted through the channel's webhook under the author's name."""
    new: List[Dict[str, Any]] = _new_messages(context, channel_id)
    hits = [m for m in new if m["method"] == "executeWebhook" and m["username"] == name and m["content"] == text]
    assert hits, f"Expected {text!r} from {name!r} in channel {channel_id}, got {[(m['method'], m['username'], m['content']) for m in new]}"


@then('Discord channel "(?P<channel_id>\\d+)" receives "(?P<text>[^"]*)" posted by the bot as "(?P<name>[^"]*)"')
def step_channel_receives_as_bot(context: Context, channel_id: str, text: str, name: str) -> None:
    """A relayed message where no webhook is available: the bot posts it with the name in front."""
    new: List[Dict[str, Any]] = _new_messages(context, channel_id)
    expected: str = f"**{name}:** {text}"
    hits = [m for m in new if m["method"] == "createMessage" and m["content"] == expected]
    assert hits, f"Expected a bot message {expected!r} in channel {channel_id}, got {[(m['method'], m['content']) for m in new]}"


@then('Discord channel "(?P<channel_id>\\d+)" receives a bot message containing "(?P<text>[^"]+)"')
def step_channel_receives_bot_containing(context: Context, channel_id: str, text: str) -> None:
    new: List[Dict[str, Any]] = _new_messages(context, channel_id)
    hits = [m for m in new if m["method"] == "createMessage" and text in m["content"]]
    assert hits, f"Expected a bot message containing {text!r} in channel {channel_id}, got {[(m['method'], m['content']) for m in new]}"


@then('Discord channel "(?P<channel_id>\\d+)" receives nothing')
def step_channel_receives_nothing(context: Context, channel_id: str) -> None:
    new: List[Dict[str, Any]] = helpers.discord_expect_no_new(channel_id, _baseline(context, channel_id))
    assert not new, f"Expected nothing in channel {channel_id}, got {[(m['method'], m['content']) for m in new]}"


@then('the relay webhook of channel "(?P<channel_id>\\d+)" is gone')
def step_webhook_gone(context: Context, channel_id: str) -> None:
    webhooks: List[Dict[str, Any]] = helpers.discord_webhooks()
    assert not any(w["channel_id"] == channel_id for w in webhooks), f"A webhook still exists for channel {channel_id}"
