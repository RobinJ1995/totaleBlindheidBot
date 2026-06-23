"""Steps for driving the mocked Steam layer via its control server."""
import time
from typing import Any, Dict, List

from behave import when, then, use_step_matcher
from behave.runner import Context

import helpers

use_step_matcher("parse")


def _capture_steam_baseline(context: Context) -> None:
    context.steam_chat = context.chat_id
    context.steam_baseline = len(helpers.get_outbox(context.chat_id))


@when('Steam mappings are refreshed')
def step_steam_refresh(context: Context) -> None:
    helpers.steam_refresh()
    # updateUserMappings() runs asynchronously off the friendsList event and
    # reads user settings from S3; give it a moment before we emit presence.
    time.sleep(2)


@when('Steam reports user "{steam_id}" playing CS2 on map "{map_name}"')
def step_steam_playing_map(context: Context, steam_id: str, map_name: str) -> None:
    _capture_steam_baseline(context)
    helpers.steam_emit_user(steam_id, {
        "player_name": "Gamer",
        # The real steam-user library reports gameid as a string ("730"), so the mock
        # must too — a numeric 730 would not exercise the type-sensitive diff logic.
        "gameid": "730",
        "rich_presence": [
            {"key": "game:map", "value": map_name},
            {"key": "status", "value": "Competitive"},
        ],
    })


@when('a moment passes')
def step_moment_passes(context: Context) -> None:
    # Let the bot finish processing the previous presence update before the next one, so
    # rapid score changes are applied in order (matches are seconds apart in reality).
    time.sleep(1.5)


@when('Steam reports user "{steam_id}" playing CS2 with score "{score}" on map "{map_name}"')
def step_steam_playing_map_score(context: Context, steam_id: str, score: str, map_name: str) -> None:
    _capture_steam_baseline(context)
    helpers.steam_emit_user(steam_id, {
        "player_name": "Gamer",
        "gameid": "730",
        "rich_presence": [
            {"key": "game:map", "value": map_name},
            {"key": "status", "value": "Competitive"},
            {"key": "game:score", "value": score},
        ],
    })


@when('{seconds:d} seconds pass')
def step_seconds_pass(context: Context, seconds: int) -> None:
    time.sleep(seconds)


# Same as the score+map step but with an explicit Steam display name, so a test can assert that
# distinct players are named in a grouped end-of-game announcement. "named" sits before "playing"
# so the plainer step can't match this sentence.
@when('Steam reports user "{steam_id}" named "{name}" playing CS2 with score "{score}" on map "{map_name}"')
def step_steam_named_playing_map_score(context: Context, steam_id: str, name: str, score: str, map_name: str) -> None:
    _capture_steam_baseline(context)
    helpers.steam_emit_user(steam_id, {
        "player_name": name,
        "gameid": "730",
        "rich_presence": [
            {"key": "game:map", "value": map_name},
            {"key": "status", "value": "Competitive"},
            {"key": "game:score", "value": score},
        ],
    })


# A varying "summarised as" rich_presence_string with a stable "Competitive" status: the game
# mode must come from the stable status, not the changing summary, or the match would split.
# "summarised as" sits before "with score" so the existing score/map step can't greedily match.
@when('Steam reports user "{steam_id}" playing CS2 summarised as "{summary}" with score "{score}" on map "{map_name}"')
def step_steam_playing_map_score_summary(context: Context, steam_id: str, summary: str, score: str, map_name: str) -> None:
    _capture_steam_baseline(context)
    helpers.steam_emit_user(steam_id, {
        "player_name": "Gamer",
        "gameid": 730,
        "rich_presence_string": summary,
        "rich_presence": [
            {"key": "game:map", "value": map_name},
            {"key": "status", "value": "Competitive"},
            {"key": "game:score", "value": score},
        ],
    })


@when('Steam reports user "{steam_id}" playing CS2')
def step_steam_playing(context: Context, steam_id: str) -> None:
    _capture_steam_baseline(context)
    helpers.steam_emit_user(steam_id, {"player_name": "Gamer", "gameid": "730"})


@when('Steam reports user "{steam_id}" playing CS2 with no details')
def step_steam_playing_no_details(context: Context, steam_id: str) -> None:
    # A bare "playing CS2" presence with no map/status/score. This must not be allowed to
    # overwrite a more-detailed message that is already on screen for the same session.
    _capture_steam_baseline(context)
    helpers.steam_emit_user(steam_id, {"player_name": "Gamer", "gameid": "730"})


@when('Steam reports user "{steam_id}" stopped playing')
def step_steam_stopped(context: Context, steam_id: str) -> None:
    # The preceding "playing" update persists the game state just after the
    # message is sent; let that settle so maybeCloseSession finds it to edit.
    time.sleep(1)
    _capture_steam_baseline(context)
    helpers.steam_emit_user(steam_id, {"player_name": "Gamer", "gameid": None})


@when('a Steam Guard code is requested')
def step_steam_guard_requested(context: Context) -> None:
    # Notification is sent to the admin chat; track that chat for assertions.
    context.steam_chat = context.chat_id
    context.steam_baseline = len(helpers.get_outbox(context.chat_id))
    helpers.steam_emit_steamguard()


@then('chat {chat_id:d} receives a Steam message containing "{expected}"')
def step_chat_receives_steam(context: Context, chat_id: int, expected: str) -> None:
    baseline: int = context.steam_baseline if chat_id == context.steam_chat else 0
    new: List[Dict[str, Any]] = helpers.wait_for_new_message(chat_id, baseline)
    texts: List[str] = [m["text"] for m in new if m["method"] == "sendMessage"]
    assert any(expected in t for t in texts), \
        f"Expected a Steam message containing {expected!r}; got {texts!r}"


@then('no Steam message is posted to chat {chat_id:d}')
def step_no_steam_message(context: Context, chat_id: int) -> None:
    baseline: int = context.steam_baseline if chat_id == context.steam_chat else 0
    new: List[Dict[str, Any]] = helpers.expect_no_new_message(chat_id, baseline)
    sends: List[str] = [m["text"] for m in new if m["method"] == "sendMessage"]
    assert not sends, f"Expected no Steam message, but got: {sends!r}"


@then('the latest Steam message in chat {chat_id:d} still contains "{expected}"')
def step_latest_steam_still_contains(context: Context, chat_id: int, expected: str) -> None:
    # The most recent thing the user sees in the chat (whether the original sendMessage or a
    # later editMessageText) must still carry the detailed info. If a less-detailed update was
    # wrongly allowed to overwrite it, the latest outbox entry would be the downgraded text.
    time.sleep(2)
    outbox: List[Dict[str, Any]] = helpers.get_outbox(chat_id)
    msgs: List[Dict[str, Any]] = [
        m for m in outbox if m["method"] in ("sendMessage", "editMessageText")
    ]
    assert msgs, f"No Steam messages reached chat {chat_id}"
    latest: str = msgs[-1]["text"]
    assert expected in latest, (
        f"Latest Steam message in chat {chat_id} no longer contains {expected!r}; "
        f"a less-detailed update overwrote it. Latest text: {latest!r}"
    )


@then('chat {chat_id:d} has not received a Steam message containing "{expected}"')
def step_chat_has_not_received(context: Context, chat_id: int, expected: str) -> None:
    # Immediate check (no wait): assert nothing matching has been posted yet. Pair with a
    # preceding wait step to give a premature message time to appear if the bug were present.
    outbox: List[Dict[str, Any]] = helpers.get_outbox(chat_id)
    bad: List[str] = [m["text"] for m in outbox if m["method"] == "sendMessage" and expected in m["text"]]
    assert not bad, f"Expected no Steam message containing {expected!r}, but got: {bad!r}"


@then('the Steam message in chat {chat_id:d} is edited to contain "{expected}"')
def step_steam_message_edited(context: Context, chat_id: int, expected: str) -> None:
    deadline: float = time.time() + helpers.REPLY_TIMEOUT
    while time.time() < deadline:
        outbox: List[Dict[str, Any]] = helpers.get_outbox(chat_id)
        edits: List[Dict[str, Any]] = [
            m for m in outbox if m["method"] == "editMessageText" and expected in m["text"]
        ]
        if edits:
            return
        time.sleep(helpers.POLL_INTERVAL)
    raise AssertionError(
        f"No editMessageText containing {expected!r} reached chat {chat_id}"
    )


@then('chat {chat_id:d} eventually receives a new Steam message containing "{expected}"')
def step_chat_receives_new_steam(context: Context, chat_id: int, expected: str) -> None:
    # Poll for a fresh sendMessage (e.g. the end-of-game notification), which may arrive a
    # few seconds after an unrelated edit has already grown the outbox.
    deadline: float = time.time() + helpers.REPLY_TIMEOUT
    while time.time() < deadline:
        outbox: List[Dict[str, Any]] = helpers.get_outbox(chat_id)
        sends: List[Dict[str, Any]] = [
            m for m in outbox if m["method"] == "sendMessage" and expected in m["text"]
        ]
        if sends:
            return
        time.sleep(helpers.POLL_INTERVAL)
    raise AssertionError(
        f"No sendMessage containing {expected!r} reached chat {chat_id}"
    )


@then('the Steam Guard callback received code "{code}"')
def step_steam_guard_callback(context: Context, code: str) -> None:
    deadline: float = time.time() + helpers.REPLY_TIMEOUT
    state: Dict[str, Any] = {}
    while time.time() < deadline:
        state = helpers.steam_guard_state()
        if state.get("called"):
            break
        time.sleep(helpers.POLL_INTERVAL)
    assert state.get("called"), "Steam Guard callback was never invoked"
    assert state.get("code") == code, \
        f"Steam Guard callback got {state.get('code')!r}, expected {code!r}"
