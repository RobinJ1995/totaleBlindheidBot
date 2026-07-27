"""Steps for driving the bot through incoming Telegram messages.

These use behave's regex matcher (which anchors patterns at both ends) so the
generic "the user sends ..." step does not greedily swallow the more specific
mention variants.
"""
from typing import Any, Dict, List, Optional

from behave import given, when, then, use_step_matcher
from behave.runner import Context

import helpers

use_step_matcher("re")


# ---------------------------------------------------------------------------
# Given: identity setup
# ---------------------------------------------------------------------------

@given('a chat with id (?P<chat_id>\\d+)')
def step_set_chat(context: Context, chat_id: str) -> None:
    context.chat_id = int(chat_id)


@given('a user with id (?P<user_id>\\d+) and first name "(?P<name>[^"]*)"')
def step_set_user(context: Context, user_id: str, name: str) -> None:
    context.user = {"id": int(user_id), "first_name": name, "username": name.lower()}


# ---------------------------------------------------------------------------
# When: sending messages
# ---------------------------------------------------------------------------

def _send(
    context: Context,
    text: str,
    user: Dict[str, Any],
    entities: List[Dict[str, Any]] = None,
) -> None:
    context.cmd_chat = context.chat_id
    context.cmd_baseline = len(helpers.get_outbox(context.chat_id))
    helpers.inject_message(text, context.chat_id, user, entities=entities)


@when('the user sends "(?P<text>[^"]*)"')
def step_user_sends(context: Context, text: str) -> None:
    _send(context, text, context.user)


@when('user (?P<user_id>\\d+) sends "(?P<text>[^"]*)"')
def step_specific_user_sends(context: Context, user_id: str, text: str) -> None:
    uid: int = int(user_id)
    user: Dict[str, Any] = {"id": uid, "first_name": f"User{uid}", "username": f"user{uid}"}
    _send(context, text, user)


@when('the user sends "(?P<text>[^"]*)" mentioning user (?P<user_id>\\d+) as "(?P<word>[^"]*)"')
def step_user_sends_mention(context: Context, text: str, user_id: str, word: str) -> None:
    entity: Dict[str, Any] = helpers.text_mention_entity(text, word, int(user_id))
    _send(context, text, context.user, entities=[entity])


@when('the user sends "(?P<text>[^"]*)" mentioning (?P<count>\\d+) users')
def step_user_sends_n_mentions(context: Context, text: str, count: str) -> None:
    # Attach `count` text_mention entities to the first `count` argument tokens,
    # so the command sees matching argument/mention counts.
    words: List[str] = text.split()[1:1 + int(count)]
    entities: List[Dict[str, Any]] = [
        helpers.text_mention_entity(text, word, 700 + i)
        for i, word in enumerate(words)
    ]
    _send(context, text, context.user, entities=entities)


# ---------------------------------------------------------------------------
# Then: asserting on replies
# ---------------------------------------------------------------------------

def _new_messages(context: Context) -> List[Dict[str, Any]]:
    return helpers.wait_for_new_message(context.cmd_chat, context.cmd_baseline)


def _latest_message(context: Context) -> Dict[str, Any]:
    new: List[Dict[str, Any]] = _new_messages(context)
    assert new, "Expected the bot to reply, but the outbox stayed empty"
    context.last_message = new[-1]
    context.last_reply = new[-1]["text"]
    return new[-1]


def _latest_reply(context: Context) -> str:
    return _latest_message(context)["text"]


@then('the bot replies "(?P<expected>[^"]*)"')
def step_reply_equals(context: Context, expected: str) -> None:
    reply: str = _latest_reply(context)
    assert reply == expected, f"Expected reply {expected!r} but got {reply!r}"


@then('the bot reply contains "(?P<expected>[^"]*)"')
def step_reply_contains(context: Context, expected: str) -> None:
    reply: str = _latest_reply(context)
    assert expected in reply, f"Expected reply to contain {expected!r}, got {reply!r}"


@then('the bot reply starts with "(?P<expected>[^"]*)"')
def step_reply_starts_with(context: Context, expected: str) -> None:
    reply: str = _latest_reply(context)
    assert reply.startswith(expected), \
        f"Expected reply to start with {expected!r}, got {reply!r}"


@then('the bot reply first line is one of')
def step_reply_first_line_one_of(context: Context) -> None:
    reply: str = _latest_reply(context)
    first_line: str = reply.split("\n")[0]
    options: List[str] = [row["quote"] for row in context.table]
    assert first_line in options, \
        f"Reply first line {first_line!r} is not one of the expected quotes"


@then('the bot sends no reply')
def step_no_reply(context: Context) -> None:
    new: List[Dict[str, Any]] = helpers.expect_no_new_message(context.cmd_chat, context.cmd_baseline)
    assert not new, f"Expected no reply, but the bot sent: {[m['text'] for m in new]}"


@then('the bot reply does not contain "(?P<unexpected>[^"]*)"')
def step_reply_not_contains(context: Context, unexpected: str) -> None:
    reply: str = _latest_reply(context)
    assert unexpected not in reply, \
        f"Expected reply not to contain {unexpected!r}, got {reply!r}"


@then('the bot reply offers a "(?P<label>[^"]*)" button')
def step_reply_offers_button(context: Context, label: str) -> None:
    message: Dict[str, Any] = _latest_message(context)
    labels: List[Optional[str]] = helpers.button_labels(message)
    assert label in labels, f"Expected a {label!r} button, got {labels}"


# ---------------------------------------------------------------------------
# RSVP inline-button taps (callback queries)
# ---------------------------------------------------------------------------

@when('the RSVP message is remembered')
def step_remember_rsvp_message(context: Context) -> None:
    outbox: List[Dict[str, Any]] = helpers.get_outbox(context.chat_id)
    assert outbox, "No bot message exists to remember"
    context.rsvp_message_id = outbox[-1]["message_id"]


@when('user (?P<user_id>\\d+) named "(?P<name>[^"]*)" taps (?P<choice>yes|maybe|no)')
def step_user_taps(context: Context, user_id: str, name: str, choice: str) -> None:
    # Tap the explicitly remembered message if there is one, otherwise the most recent.
    message_id: Optional[int] = getattr(context, "rsvp_message_id", None)
    if message_id is None:
        outbox: List[Dict[str, Any]] = helpers.get_outbox(context.chat_id)
        assert outbox, "No bot message exists to tap on"
        message_id = outbox[-1]["message_id"]

    context.cmd_chat = context.chat_id
    context.cmd_baseline = len(helpers.get_outbox(context.chat_id))
    context.cb_baseline = len(helpers.get_callback_answers())
    user: Dict[str, Any] = {"id": int(user_id), "first_name": name, "username": name.lower()}
    helpers.inject_callback(f"rsvp:{choice}", context.chat_id, user, message_id)


@when('user (?P<user_id>\\d+) named "(?P<name>[^"]*)" taps the button containing "(?P<needle>[^"]*)"')
def step_user_taps_button_containing(context: Context, user_id: str, name: str, needle: str) -> None:
    """Tap the first inline button whose label contains `needle`, searching newest message first."""
    outbox: List[Dict[str, Any]] = helpers.get_outbox(context.chat_id)
    for message in reversed(outbox):
        markup: Dict[str, Any] = helpers.reply_markup(message)
        for row in markup.get("inline_keyboard", []):
            for button in row:
                if needle in (button.get("text") or ""):
                    context.cmd_chat = context.chat_id
                    context.cmd_baseline = len(helpers.get_outbox(context.chat_id))
                    context.cb_baseline = len(helpers.get_callback_answers())
                    user: Dict[str, Any] = {
                        "id": int(user_id), "first_name": name, "username": name.lower()
                    }
                    helpers.inject_callback(
                        button["callback_data"], context.chat_id, user, message["message_id"]
                    )
                    return
    raise AssertionError(
        f"No inline button containing {needle!r} found in chat {context.chat_id}"
    )


@then('the tap is answered with "(?P<expected>[^"]*)"')
def step_tap_answered_with(context: Context, expected: str) -> None:
    answers: List[Dict[str, Any]] = helpers.wait_for_callback_answer(context.cb_baseline)
    texts: List[Optional[str]] = [a.get("text") for a in answers]
    assert expected in texts, f"Expected a callback answer {expected!r}, got {texts}"
