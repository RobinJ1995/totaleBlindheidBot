"""Steps for the Discord side: defining servers, speaking as Discord users, asserting on what the bot
posted there. The Telegram side of the same scenarios uses telegram_steps.py."""
import re
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


@given('a Discord server "(?P<guild_id>\\d+)" named "(?P<name>[^"]*)" with channels "(?P<first_id>\\d+)" named "(?P<first>[^"]*)" and "(?P<second_id>\\d+)" named "(?P<second>[^"]*)"')
def step_discord_server_two_channels(context: Context, guild_id: str, name: str, first_id: str, first: str, second_id: str, second: str) -> None:
    helpers.discord_define_guild(guild_id, name, [{"id": first_id, "name": first}, {"id": second_id, "name": second}])


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
    context.discord_last_sent_id = helpers.discord_inject(channel_id, content, author, **extra)["message_id"]
    context.discord_sent = {**getattr(context, "discord_sent", {}), content: context.discord_last_sent_id}


def _copy_of(channel_id: str, text: str) -> Optional[str]:
    """The id of the message showing `text` in a channel: the bot's copy, or what a Discord user sent there."""
    sent = [m for m in helpers.discord_outbox(channel_id) if m["method"] in ("executeWebhook", "createMessage")]
    return next((m["message_id"] for m in sent if m["content"].endswith(text)), None)


@when('Discord user "(?P<username>[^"]*)" named "(?P<name>[^"]*)" with id "(?P<user_id>\\d+)" replies "(?P<text>[^"]*)" to "(?P<replied>[^"]*)" in channel "(?P<channel_id>\\d+)"')
def step_discord_user_replies(context: Context, username: str, name: str, user_id: str, text: str, replied: str, channel_id: str) -> None:
    target: str = _copy_of(channel_id, replied) or context.discord_sent[replied]
    _inject(context, channel_id, text, _author(username, name, user_id), reply_to=target)


def _reply_pattern(context: Context, channel_id: str, text: str, name: str, replied: str, author: str) -> "re.Pattern[str]":
    target: Optional[str] = _copy_of(channel_id, replied) or getattr(context, "discord_sent", {}).get(replied)
    line: str = rf"-# \[↪ Replying to {re.escape(author)}\]\(https://discord\.com/channels/\d+/{channel_id}/{target}\)\n"
    return re.compile(line + rf"(\*\*{re.escape(name)}:\*\* )?{re.escape(text)}")


@then('Discord channel "(?P<channel_id>\\d+)" receives "(?P<text>[^"]*)" from "(?P<name>[^"]*)" replying to "(?P<replied>[^"]*)" by "(?P<author>[^"]*)"')
def step_channel_receives_reply(context: Context, channel_id: str, text: str, name: str, replied: str, author: str) -> None:
    expected = _reply_pattern(context, channel_id, text, name, replied, author)
    is_reply = lambda m: m["method"] in ("executeWebhook", "createMessage") and expected.fullmatch(m["content"]) is not None
    new: List[Dict[str, Any]] = _new_messages(context, channel_id, is_reply)
    assert any(is_reply(m) for m in new), f"Expected {text!r} from {name!r} replying to {replied!r} in channel {channel_id}, got {_describe(new)}"


@then('Discord channel "(?P<channel_id>\\d+)" sees its copy edited to "(?P<text>[^"]*)" from "(?P<name>[^"]*)" replying to "(?P<replied>[^"]*)" by "(?P<author>[^"]*)"')
def step_channel_copy_edited_reply(context: Context, channel_id: str, text: str, name: str, replied: str, author: str) -> None:
    expected = _reply_pattern(context, channel_id, text, name, replied, author)
    is_edit = lambda m: m["method"] in ("editWebhookMessage", "editMessage") and expected.fullmatch(m["content"]) is not None
    new: List[Dict[str, Any]] = _new_messages(context, channel_id, is_edit)
    assert any(is_edit(m) for m in new), f"Expected the copy in channel {channel_id} edited to {text!r} replying to {replied!r}, got {_describe(new)}"


@when('that Discord message is edited to "(?P<text>[^"]*)"')
def step_discord_message_edited(context: Context, text: str) -> None:
    context.cmd_baseline = len(helpers.get_outbox(context.chat_id))
    helpers.discord_edit(context.discord_last_sent_id, text)


@when('that Discord message is deleted')
def step_discord_message_deleted(context: Context) -> None:
    context.cmd_baseline = len(helpers.get_outbox(context.chat_id))
    helpers.discord_delete(context.discord_last_sent_id)


@when('someone deletes the copy in Discord channel "(?P<channel_id>\\d+)"')
def step_discord_copy_deleted(context: Context, channel_id: str) -> None:
    context.cmd_baseline = len(helpers.get_outbox(context.chat_id))
    copies: List[Dict[str, Any]] = [m for m in helpers.discord_outbox(channel_id) if m["method"] in ("executeWebhook", "createMessage")]
    helpers.discord_delete(copies[-1]["message_id"])


@then('Discord channel "(?P<channel_id>\\d+)" sees its copy deleted')
def step_channel_copy_deleted(context: Context, channel_id: str) -> None:
    is_deletion = lambda m: m["method"] in ("deleteWebhookMessage", "deleteMessage")
    new: List[Dict[str, Any]] = _new_messages(context, channel_id, is_deletion)
    assert any(is_deletion(m) for m in new), f"Expected the copy in channel {channel_id} to be deleted, got {_describe(new)}"


@then('Discord channel "(?P<channel_id>\\d+)" sees its copy edited to "(?P<text>[^"]*)"')
def step_channel_copy_edited(context: Context, channel_id: str, text: str) -> None:
    is_edit = lambda m: m["method"] in ("editWebhookMessage", "editMessage") and m["content"] == text
    new: List[Dict[str, Any]] = _new_messages(context, channel_id, is_edit)
    assert any(is_edit(m) for m in new), f"Expected a copy in channel {channel_id} edited to {text!r}, got {_describe(new)}"


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
    is_hit = lambda m: m["method"] == "executeWebhook" and m["username"] == name and m["content"] == text
    new: List[Dict[str, Any]] = _new_messages(context, channel_id, is_hit)
    assert any(is_hit(m) for m in new), f"Expected {text!r} from {name!r} in channel {channel_id}, got {[(m['method'], m['username'], m['content']) for m in new]}"


@then('Discord channel "(?P<channel_id>\\d+)" receives from "(?P<name>[^"]*)"')
def step_channel_receives_text_from(context: Context, channel_id: str, name: str) -> None:
    step_channel_receives_from(context, channel_id, context.text, name)


@then('Discord channel "(?P<channel_id>\\d+)" receives "(?P<text>[^"]*)" posted by the bot as "(?P<name>[^"]*)"')
def step_channel_receives_as_bot(context: Context, channel_id: str, text: str, name: str) -> None:
    """A relayed message where no webhook is available: the bot posts it with the name in front."""
    expected: str = f"**{name}:** {text}"
    is_hit = lambda m: m["method"] == "createMessage" and m["content"] == expected
    new: List[Dict[str, Any]] = _new_messages(context, channel_id, is_hit)
    assert any(is_hit(m) for m in new), f"Expected a bot message {expected!r} in channel {channel_id}, got {[(m['method'], m['content']) for m in new]}"


@then('Discord channel "(?P<channel_id>\\d+)" receives a bot message containing "(?P<text>[^"]+)"')
def step_channel_receives_bot_containing(context: Context, channel_id: str, text: str) -> None:
    is_hit = lambda m: _is_bot_message(m) and text in m["content"]
    new: List[Dict[str, Any]] = _new_messages(context, channel_id, is_hit)
    assert any(is_hit(m) for m in new), f"Expected a bot message containing {text!r} in channel {channel_id}, got {[(m['method'], m['content']) for m in new]}"


@then('Discord channel "(?P<channel_id>\\d+)" sees a bot message edited to contain "(?P<text>[^"]+)"')
def step_channel_bot_message_edited(context: Context, channel_id: str, text: str) -> None:
    is_edit = lambda m: m["method"] == "editMessage" and text in m["content"]
    new: List[Dict[str, Any]] = _new_messages(context, channel_id, is_edit)
    assert any(is_edit(m) for m in new), f"Expected a bot message in channel {channel_id} edited to contain {text!r}, got {_describe(new)}"


@then('Discord channel "(?P<channel_id>\\d+)" receives no bot message containing "(?P<text>[^"]+)"')
def step_channel_receives_no_bot_containing(context: Context, channel_id: str, text: str) -> None:
    new: List[Dict[str, Any]] = helpers.discord_outbox(channel_id)[_baseline(context, channel_id):]
    hits = [m for m in new if _is_bot_message(m) and text in m["content"]]
    assert not hits, f"Expected no bot message containing {text!r} in channel {channel_id}, got {_describe(hits)}"


@then('Discord channel "(?P<channel_id>\\d+)" stays free of bot messages')
def step_channel_no_bot_messages(context: Context, channel_id: str) -> None:
    posted: List[Dict[str, Any]] = helpers.wait_until(
        lambda: _bot_messages(helpers.discord_outbox(channel_id)[_baseline(context, channel_id):]),
        helpers.QUIET_WINDOW,
    )
    assert not posted, f"Expected no bot message in channel {channel_id}, got {_describe(posted)}"


@then('Discord channel "(?P<channel_id>\\d+)" sees the bot message containing "(?P<text>[^"]+)" deleted')
def step_channel_bot_message_deleted(context: Context, channel_id: str, text: str) -> None:
    def deleted() -> bool:
        outbox: List[Dict[str, Any]] = helpers.discord_outbox(channel_id)
        posted: List[str] = [m["message_id"] for m in outbox if _is_bot_message(m) and text in m["content"]]
        return any(m["method"] == "deleteMessage" and m["message_id"] in posted for m in outbox)

    assert helpers.wait_until(deleted), f"No bot message containing {text!r} was deleted in channel {channel_id}"


@then('Discord channel "(?P<channel_id>\\d+)" receives a bot message')
def step_channel_receives_bot_message(context: Context, channel_id: str) -> None:
    is_hit = lambda m: _is_bot_message(m) and m["content"] == context.text
    new: List[Dict[str, Any]] = _new_messages(context, channel_id, is_hit)
    assert any(is_hit(m) for m in new), f"Expected the bot message {context.text!r} in channel {channel_id}, got {[(m['method'], m['content']) for m in new]}"


@then('Discord channel "(?P<channel_id>\\d+)" gets the private answer "(?P<text>[^"]+)"')
def step_channel_private_answer(context: Context, channel_id: str, text: str) -> None:
    is_hit = lambda m: m["content"] == text and m["params"].get("flags") == 64
    new: List[Dict[str, Any]] = _new_messages(context, channel_id, is_hit)
    assert any(is_hit(m) for m in new), f"Expected the ephemeral answer {text!r} in channel {channel_id}, got {[(m['method'], m['content'], m['params'].get('flags')) for m in new]}"


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


@then('Discord server "(?P<guild_id>\\d+)" offers the "/(?P<name>[a-z_]+)" slash command')
def step_slash_command_offered(context: Context, guild_id: str, name: str) -> None:
    registered: List[str] = helpers.discord_commands().get(guild_id, [])
    assert name in registered, f"Expected /{name} among the slash commands of server {guild_id}, got {registered}"


@then('Discord server "(?P<guild_id>\\d+)" offers no slash commands')
def step_no_slash_commands(context: Context, guild_id: str) -> None:
    registered: List[str] = helpers.discord_commands().get(guild_id, [])
    assert registered == [], f"Expected no slash commands in server {guild_id}, got {registered}"


@then('Discord server "(?P<guild_id>\\d+)" offers the slash commands "(?P<names>[^"]*)"')
def step_slash_commands(context: Context, guild_id: str, names: str) -> None:
    expected: List[str] = sorted(n.strip() for n in names.split(","))
    registered: List[str] = sorted(helpers.discord_commands().get(guild_id, []))
    assert registered == expected, f"Expected slash commands {expected} in server {guild_id}, got {registered}"


@then('Discord channel "(?P<channel_id>\\d+)" receives a bot message starting with "(?P<text>[^"]+)"')
def step_channel_receives_bot_starting(context: Context, channel_id: str, text: str) -> None:
    is_hit = lambda m: _is_bot_message(m) and m["content"].startswith(text)
    new: List[Dict[str, Any]] = _bot_messages(_new_messages(context, channel_id, is_hit))
    assert any(is_hit(m) for m in new), f"Expected a bot message starting with {text!r} in channel {channel_id}, got {_describe(new)}"


@then('Discord channel "(?P<channel_id>\\d+)" receives a bot message containing "(?P<text>[^"]+)" with buttons "(?P<labels>[^"]*)"')
def step_channel_receives_bot_with_buttons(context: Context, channel_id: str, text: str, labels: str) -> None:
    expected: List[str] = [l.strip() for l in labels.split(",")]
    is_hit = lambda m: _is_bot_message(m) and text in m["content"] and helpers.discord_button_labels(m) == expected
    new: List[Dict[str, Any]] = _bot_messages(_new_messages(context, channel_id, is_hit))
    assert any(is_hit(m) for m in new), f"Expected a bot message containing {text!r} with buttons {expected} in channel {channel_id}, got {_describe(new)}"


@then('Discord channel "(?P<channel_id>\\d+)" receives a bot message timing the rollcall (?P<hours>\\d+) hours ahead in Discord timestamps')
def step_channel_receives_timestamps(context: Context, channel_id: str, hours: str) -> None:
    expected: float = time.time() + int(hours) * 3600

    def timed(message: Dict[str, Any]) -> bool:
        match = re.search(r"Rollcall scheduled for <t:(\d+):F> \(<t:(\d+):R>\)", message["content"])
        return match is not None and all(abs(int(unix_time) - expected) < 120 for unix_time in match.groups())

    new: List[Dict[str, Any]] = _new_messages(context, channel_id, timed)
    assert any(timed(m) for m in new), f"Expected Discord timestamps {hours} hours ahead in channel {channel_id}, got {_describe(new)}"


@then('Discord channel "(?P<channel_id>\\d+)" receives a bot message whose first line is one of')
def step_channel_receives_bot_first_line(context: Context, channel_id: str) -> None:
    options: List[str] = [row["quote"] for row in context.table]
    is_hit = lambda m: _is_bot_message(m) and m["content"].split("\n")[0] in options
    new: List[Dict[str, Any]] = _bot_messages(_new_messages(context, channel_id, is_hit))
    assert any(is_hit(m) for m in new), f"Expected a bot message starting with one of {options} in channel {channel_id}, got {_describe(new)}"


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

    def edits() -> List[Dict[str, Any]]:
        return [
            m for m in helpers.discord_outbox(remembered["channel_id"])
            if m["method"] == "editMessage" and m["message_id"] == remembered["message_id"]
        ]

    assert helpers.wait_until(lambda: any(matches(m) for m in edits())), \
        f"The remembered Discord message was never edited {description}; edits: {_describe(edits())}"


@then('the remembered Discord message is edited to contain "(?P<text>[^"]+)"')
def step_discord_edited_contains(context: Context, text: str) -> None:
    _wait_for_discord_edit(context, lambda m: text in m["content"], f"to contain {text!r}")


@then('the remembered Discord message is edited to contain "(?P<text>[^"]+)" without a presence marker')
def step_discord_edited_without_markers(context: Context, text: str) -> None:
    matches = lambda m: text in m["content"] and not any(marker in m["content"] for marker in helpers.PRESENCE_MARKERS)
    _wait_for_discord_edit(context, matches, f"to contain {text!r} without a presence marker")


@then('the remembered Discord message is edited to contain "(?P<text>[^"]+)" without buttons')
def step_discord_edited_without_buttons(context: Context, text: str) -> None:
    _wait_for_discord_edit(context, lambda m: text in m["content"] and not helpers.discord_button_labels(m), f"to contain {text!r} without buttons")


@then('the Discord tap is answered with "(?P<text>[^"]+)"')
def step_discord_tap_answered(context: Context, text: str) -> None:
    remembered: Dict[str, str] = context.discord_remembered

    def answers() -> List[str]:
        return [
            m["content"] for m in helpers.discord_outbox(remembered["channel_id"])
            if m["method"] == "interactionCallback" and m["params"].get("type") == 4
        ]

    assert helpers.wait_until(lambda: text in answers()), f"Expected the tap to be answered with {text!r}, got {answers()}"


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


@when('Discord user "(?P<username>[^"]*)" named "(?P<name>[^"]*)" with id "(?P<user_id>\\d+)" sends a poll "(?P<question>[^"]*)" with answers "(?P<answers>[^"]*)" in channel "(?P<channel_id>\\d+)"')
def step_discord_sends_poll(context: Context, username: str, name: str, user_id: str, question: str, answers: str, channel_id: str) -> None:
    poll: Dict[str, Any] = {
        "question": {"text": question},
        "answers": [{"answer_id": i + 1, "poll_media": {"text": answer.strip()}} for i, answer in enumerate(answers.split(","))],
        "expiry": None, "allow_multiselect": False, "layout_type": 1,
    }
    _inject(context, channel_id, "", _author(username, name, user_id), poll=poll)


@when('Discord user "(?P<username>[^"]*)" named "(?P<name>[^"]*)" with id "(?P<user_id>\\d+)" sends a sticker "(?P<sticker>[^"]*)" in (?P<fmt>PNG|GIF|Lottie) format in channel "(?P<channel_id>\\d+)"')
def step_discord_sends_sticker(context: Context, username: str, name: str, user_id: str, sticker: str, fmt: str, channel_id: str) -> None:
    format_type: int = {"PNG": 1, "GIF": 4, "Lottie": 3}[fmt]
    content_type: str = {"PNG": "image/png", "GIF": "image/gif", "Lottie": "application/json"}[fmt]
    spec: Dict[str, Any] = {"id": f"7{abs(hash(sticker)) % 10**17:017d}", "name": sticker, "format_type": format_type,
                            "content_type": content_type, "data_base64": base64.b64encode(b"sticker-" + sticker.encode()).decode()}
    _inject(context, channel_id, "", _author(username, name, user_id), stickers=[spec])


@then('Discord channel "(?P<channel_id>\\d+)" receives a file "(?P<filename>[^"]*)" from "(?P<name>[^"]*)" with text "(?P<text>[^"]*)"')
def step_channel_receives_file(context: Context, channel_id: str, filename: str, name: str, text: str) -> None:
    is_hit = lambda m: (m["method"] == "executeWebhook" and m["username"] == name and m["content"] == text
                        and any(a["filename"] == filename for a in m["attachments"]))
    new: List[Dict[str, Any]] = _new_messages(context, channel_id, is_hit)
    assert any(is_hit(m) for m in new), f"Expected file {filename!r} with text {text!r} from {name!r} in channel {channel_id}, got {[(m['method'], m['username'], m['content'], m['attachments']) for m in new]}"


def _discord_react(context: Context, user: Dict[str, Any], text: str, channel_id: str, emoji: str, **extra: Any) -> None:
    context.cmd_baseline = len(helpers.get_outbox(context.chat_id))
    helpers.discord_react(_copy_of(channel_id, text) or context.discord_sent[text], user, emoji, **extra)


@when('Discord user "(?P<username>[^"]*)" with id "(?P<user_id>\\d+)" reacts with "(?P<emoji>[^"]*)" to "(?P<text>[^"]*)" in channel "(?P<channel_id>\\d+)"')
def step_discord_user_reacts(context: Context, username: str, user_id: str, emoji: str, text: str, channel_id: str) -> None:
    _discord_react(context, {"id": user_id, "username": username}, text, channel_id, emoji)


@when('Discord user "(?P<username>[^"]*)" with id "(?P<user_id>\\d+)" reacts with the custom emoji "(?P<emoji>[^"]*)" to "(?P<text>[^"]*)" in channel "(?P<channel_id>\\d+)"')
def step_discord_user_reacts_custom(context: Context, username: str, user_id: str, emoji: str, text: str, channel_id: str) -> None:
    _discord_react(context, {"id": user_id, "username": username}, text, channel_id, emoji, emoji_id="860500000000000099")


@when('Discord user "(?P<username>[^"]*)" with id "(?P<user_id>\\d+)" removes their "(?P<emoji>[^"]*)" reaction to "(?P<text>[^"]*)" in channel "(?P<channel_id>\\d+)"')
def step_discord_user_unreacts(context: Context, username: str, user_id: str, emoji: str, text: str, channel_id: str) -> None:
    _discord_react(context, {"id": user_id, "username": username}, text, channel_id, emoji, remove=True)


def _own_reaction(context: Context, channel_id: str, text: str, method: str, emoji: str) -> Callable[[Dict[str, Any]], bool]:
    target: Optional[str] = _copy_of(channel_id, text) or getattr(context, "discord_sent", {}).get(text)
    return lambda m: m["method"] == method and m["message_id"] == target and m["content"] == emoji


@then('Discord channel "(?P<channel_id>\\d+)" sees the bot react with "(?P<emoji>[^"]*)" to "(?P<text>[^"]*)"')
def step_channel_bot_reacts(context: Context, channel_id: str, emoji: str, text: str) -> None:
    accept = _own_reaction(context, channel_id, text, "addReaction", emoji)
    new: List[Dict[str, Any]] = _new_messages(context, channel_id, accept)
    assert any(accept(m) for m in new), f"Expected the bot to react with {emoji!r} to {text!r} in channel {channel_id}, got {_describe(new)}"


@then('Discord channel "(?P<channel_id>\\d+)" sees the bot take back its "(?P<emoji>[^"]*)" reaction to "(?P<text>[^"]*)"')
def step_channel_bot_unreacts(context: Context, channel_id: str, emoji: str, text: str) -> None:
    accept = _own_reaction(context, channel_id, text, "removeReaction", emoji)
    new: List[Dict[str, Any]] = _new_messages(context, channel_id, accept)
    assert any(accept(m) for m in new), f"Expected the bot to remove its {emoji!r} reaction to {text!r} in channel {channel_id}, got {_describe(new)}"


@then('Discord channel "(?P<channel_id>\\d+)" sees no reaction changes from the bot')
def step_channel_no_bot_reactions(context: Context, channel_id: str) -> None:
    changes: List[Dict[str, Any]] = helpers.wait_until(
        lambda: [m for m in helpers.discord_outbox(channel_id)[_baseline(context, channel_id):] if m["method"] in ("addReaction", "removeReaction")],
        helpers.QUIET_WINDOW,
    )
    assert not changes, f"Expected no reaction changes from the bot in channel {channel_id}, got {_describe(changes)}"


@when('Discord user "(?P<username>[^"]*)" named "(?P<name>[^"]*)" with id "(?P<user_id>\\d+)" starts a thread "(?P<thread>[^"]*)" on "(?P<text>[^"]*)" in channel "(?P<channel_id>\\d+)"')
def step_discord_user_starts_thread(context: Context, username: str, name: str, user_id: str, thread: str, text: str, channel_id: str) -> None:
    context.cmd_chat = context.chat_id
    context.cmd_baseline = len(helpers.get_outbox(context.chat_id))
    starter: str = _copy_of(channel_id, text) or context.discord_sent[text]
    context.discord_thread = helpers.discord_start_thread(starter, thread, _author(username, name, user_id))


@when('Discord user "(?P<username>[^"]*)" named "(?P<name>[^"]*)" with id "(?P<user_id>\\d+)" says "(?P<text>[^"]*)" in that thread')
def step_discord_user_says_in_thread(context: Context, username: str, name: str, user_id: str, text: str) -> None:
    _inject(context, context.discord_thread, text, _author(username, name, user_id))


@then('the bot has joined that thread')
def step_bot_joined_thread(context: Context) -> None:
    joined = lambda m: m["method"] == "joinThread"
    assert helpers.wait_until(lambda: any(joined(m) for m in helpers.discord_outbox(context.discord_thread))), \
        f"The bot never joined thread {context.discord_thread}"


@then('no slash command reply is deleted in Discord channel "(?P<channel_id>\\d+)"')
def step_no_reply_deleted(context: Context, channel_id: str) -> None:
    deleted = helpers.wait_until(
        lambda: [m for m in helpers.discord_outbox(channel_id)[_baseline(context, channel_id):] if m["method"] == "deleteReply"],
        helpers.QUIET_WINDOW,
    )
    assert not deleted, f"A slash command reply was deleted in channel {channel_id}"
