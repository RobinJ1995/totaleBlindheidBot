"""Steps for the Discord side: defining servers, speaking as Discord users, asserting on what the bot
posted there. The Telegram side of the same scenarios uses telegram_steps.py."""
import time
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


@given('a Discord server "(?P<guild_id>\\d+)" named "(?P<name>[^"]*)" with channel "(?P<channel_id>\\d+)" named "(?P<channel>[^"]*)" and member "(?P<username>[^"]*)" named "(?P<member>[^"]*)" with id "(?P<user_id>\\d+)"')
def step_discord_server_with_member(context: Context, guild_id: str, name: str, channel_id: str, channel: str, username: str, member: str, user_id: str) -> None:
    helpers.discord_define_guild(guild_id, name, [{"id": channel_id, "name": channel}], members=[_author(username, member, user_id)])


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


BOT_MESSAGE_METHODS = ("createMessage", "editReply", "followUp", "interactionReply")


def _is_bot_message(message: Dict[str, Any]) -> bool:
    return message["method"] in BOT_MESSAGE_METHODS


def _bot_messages(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [m for m in messages if _is_bot_message(m)]


def _describe(messages: List[Dict[str, Any]]) -> List[Any]:
    return [(m["method"], m["content"], helpers.discord_button_labels(m)) for m in messages]


@when('Discord user "(?P<username>[^"]*)" named "(?P<name>[^"]*)" with id "(?P<user_id>\\d+)" runs "/(?P<command>[a-z_]+)" in channel "(?P<channel_id>\\d+)"')
def step_discord_runs(context: Context, username: str, name: str, user_id: str, command: str, channel_id: str) -> None:
    context.cmd_chat = context.chat_id
    context.cmd_baseline = len(helpers.get_outbox(context.chat_id))
    helpers.discord_run_command(channel_id, _author(username, name, user_id), command)


@when('Discord user "(?P<username>[^"]*)" named "(?P<name>[^"]*)" with id "(?P<user_id>\\d+)" runs "/(?P<command>[a-z_]+)" with (?P<option>[a-z]+) "(?P<value>[^"]*)" in channel "(?P<channel_id>\\d+)"')
def step_discord_runs_with(context: Context, username: str, name: str, user_id: str, command: str, option: str, value: str, channel_id: str) -> None:
    context.cmd_chat = context.chat_id
    context.cmd_baseline = len(helpers.get_outbox(context.chat_id))
    helpers.discord_run_command(channel_id, _author(username, name, user_id), command, {"name": option, "value": value})


@then('Discord server "(?P<guild_id>\\d+)" offers the slash commands "(?P<names>[^"]*)"')
def step_slash_commands(context: Context, guild_id: str, names: str) -> None:
    expected: List[str] = sorted(n.strip() for n in names.split(","))
    registered: List[str] = sorted(helpers.discord_commands().get(guild_id, []))
    assert registered == expected, f"Expected slash commands {expected} in server {guild_id}, got {registered}"


@then('Discord channel "(?P<channel_id>\\d+)" receives a bot message starting with "(?P<text>[^"]+)"')
def step_channel_receives_bot_starting(context: Context, channel_id: str, text: str) -> None:
    new: List[Dict[str, Any]] = _bot_messages(_new_messages(context, channel_id, _is_bot_message))
    assert any(m["content"].startswith(text) for m in new), f"Expected a bot message starting with {text!r} in channel {channel_id}, got {_describe(new)}"


@then('Discord channel "(?P<channel_id>\\d+)" receives a bot message containing "(?P<text>[^"]+)" with buttons "(?P<labels>[^"]*)"')
def step_channel_receives_bot_with_buttons(context: Context, channel_id: str, text: str, labels: str) -> None:
    expected: List[str] = [l.strip() for l in labels.split(",")]
    new: List[Dict[str, Any]] = _bot_messages(_new_messages(context, channel_id, _is_bot_message))
    hits = [m for m in new if text in m["content"] and helpers.discord_button_labels(m) == expected]
    assert hits, f"Expected a bot message containing {text!r} with buttons {expected} in channel {channel_id}, got {_describe(new)}"


@then('Discord channel "(?P<channel_id>\\d+)" receives a bot message whose first line is one of')
def step_channel_receives_bot_first_line(context: Context, channel_id: str) -> None:
    options: List[str] = [row["quote"] for row in context.table]
    new: List[Dict[str, Any]] = _bot_messages(_new_messages(context, channel_id, _is_bot_message))
    assert any(m["content"].split("\n")[0] in options for m in new), f"Expected a bot message starting with one of {options} in channel {channel_id}, got {_describe(new)}"


@when('the latest bot message in Discord channel "(?P<channel_id>\\d+)" is remembered')
def step_remember_discord_message(context: Context, channel_id: str) -> None:
    posted: List[Dict[str, Any]] = _bot_messages(helpers.discord_outbox(channel_id))
    assert posted, f"No bot message exists in channel {channel_id} to remember"
    context.discord_remembered = {"channel_id": channel_id, "message_id": posted[-1]["message_id"]}


@when('Discord user "(?P<username>[^"]*)" named "(?P<name>[^"]*)" with id "(?P<user_id>\\d+)" taps "(?P<custom_id>[^"]*)" on the remembered Discord message')
def step_discord_taps(context: Context, username: str, name: str, user_id: str, custom_id: str) -> None:
    remembered: Dict[str, str] = context.discord_remembered
    context.cmd_chat = context.chat_id
    context.cmd_baseline = len(helpers.get_outbox(context.chat_id))
    helpers.discord_tap_button(remembered["channel_id"], _author(username, name, user_id), remembered["message_id"], custom_id)


def _wait_for_discord_edit(context: Context, matches: Any, description: str) -> None:
    remembered: Dict[str, str] = context.discord_remembered
    deadline: float = time.time() + helpers.REPLY_TIMEOUT
    edits: List[Dict[str, Any]] = []
    while time.time() < deadline:
        edits = [
            m for m in helpers.discord_outbox(remembered["channel_id"])
            if m["method"] == "editMessage" and m["message_id"] == remembered["message_id"]
        ]
        if any(matches(m) for m in edits):
            return
        time.sleep(helpers.POLL_INTERVAL)
    raise AssertionError(f"The remembered Discord message was never edited {description}; edits: {_describe(edits)}")


@then('the remembered Discord message is edited to contain "(?P<text>[^"]+)"')
def step_discord_edited_contains(context: Context, text: str) -> None:
    _wait_for_discord_edit(context, lambda m: text in m["content"], f"to contain {text!r}")


@then('the remembered Discord message is edited to contain "(?P<text>[^"]+)" without buttons')
def step_discord_edited_without_buttons(context: Context, text: str) -> None:
    _wait_for_discord_edit(context, lambda m: text in m["content"] and not helpers.discord_button_labels(m), f"to contain {text!r} without buttons")


@then('the Discord tap is answered with "(?P<text>[^"]+)"')
def step_discord_tap_answered(context: Context, text: str) -> None:
    remembered: Dict[str, str] = context.discord_remembered
    deadline: float = time.time() + helpers.REPLY_TIMEOUT
    answers: List[str] = []
    while time.time() < deadline:
        answers = [
            m["content"] for m in helpers.discord_outbox(remembered["channel_id"])
            if m["method"] == "interactionCallback" and m["params"].get("type") == 4
        ]
        if text in answers:
            return
        time.sleep(helpers.POLL_INTERVAL)
    raise AssertionError(f"Expected the tap to be answered with {text!r}, got {answers}")


@when("the scheduled rollcall's time has come")
def step_schedule_due(context: Context) -> None:
    context.cmd_chat = context.chat_id
    context.cmd_baseline = len(helpers.get_outbox(context.chat_id))
    helpers.due_scheduled_rollcalls()


import base64


@when('Discord user "(?P<username>[^"]*)" named "(?P<name>[^"]*)" with id "(?P<user_id>\\d+)" sends (?P<kind>an image|a gif|a video|a file) "(?P<filename>[^"]*)" saying "(?P<text>[^"]*)" in channel "(?P<channel_id>\\d+)"')
def step_discord_sends_file(context: Context, username: str, name: str, user_id: str, kind: str, filename: str, text: str, channel_id: str) -> None:
    content_type: str = {"an image": "image/png", "a gif": "image/gif", "a video": "video/mp4", "a file": "application/pdf"}[kind]
    attachment: Dict[str, Any] = {
        "filename": filename, "content_type": content_type,
        "data_base64": base64.b64encode(b"bytes-of-" + filename.encode()).decode(),
    }
    _inject(context, channel_id, text, _author(username, name, user_id), attachments=[attachment])


@when('Discord user "(?P<username>[^"]*)" named "(?P<name>[^"]*)" with id "(?P<user_id>\\d+)" sends a sticker "(?P<sticker>[^"]*)" in (?P<fmt>PNG|GIF|Lottie) format in channel "(?P<channel_id>\\d+)"')
def step_discord_sends_sticker(context: Context, username: str, name: str, user_id: str, sticker: str, fmt: str, channel_id: str) -> None:
    format_type: int = {"PNG": 1, "GIF": 4, "Lottie": 3}[fmt]
    content_type: str = {"PNG": "image/png", "GIF": "image/gif", "Lottie": "application/json"}[fmt]
    spec: Dict[str, Any] = {"id": f"7{abs(hash(sticker)) % 10**17:017d}", "name": sticker, "format_type": format_type,
                            "content_type": content_type, "data_base64": base64.b64encode(b"sticker-" + sticker.encode()).decode()}
    _inject(context, channel_id, "", _author(username, name, user_id), stickers=[spec])


@then('Discord channel "(?P<channel_id>\\d+)" receives a file "(?P<filename>[^"]*)" from "(?P<name>[^"]*)" with text "(?P<text>[^"]*)"')
def step_channel_receives_file(context: Context, channel_id: str, filename: str, name: str, text: str) -> None:
    new: List[Dict[str, Any]] = _new_messages(context, channel_id)
    hits = [m for m in new if m["method"] == "executeWebhook" and m["username"] == name and m["content"] == text
            and any(a["filename"] == filename for a in m["attachments"])]
    assert hits, f"Expected file {filename!r} with text {text!r} from {name!r} in channel {channel_id}, got {[(m['method'], m['username'], m['content'], m['attachments']) for m in new]}"
