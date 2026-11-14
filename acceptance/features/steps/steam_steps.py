"""Steps for driving the mocked Steam layer via its control server."""
from typing import Any, Callable, Dict, List

from behave import given, when, then, use_step_matcher
from behave.runner import Context

import helpers

use_step_matcher("parse")


def _capture_steam_baseline(context: Context) -> None:
    context.steam_chat = context.chat_id
    context.steam_baseline = len(helpers.get_outbox(context.chat_id))


@given('Steam account "{steam_id}" is not a friend of the bot')
def step_steam_stranger(context: Context, steam_id: str) -> None:
    helpers.steam_set_relationship(steam_id, "None")


@given('Steam refuses friend requests to account "{steam_id}"')
def step_steam_refuses(context: Context, steam_id: str) -> None:
    helpers.steam_set_relationship(steam_id, "None", refuses=True)


@given('the bot has a friend request out to Steam account "{steam_id}"')
def step_steam_request_out(context: Context, steam_id: str) -> None:
    helpers.steam_set_relationship(steam_id, "RequestInitiator")


@given('Steam account "{steam_id}" has asked to be the bot\'s friend')
@when('Steam account "{steam_id}" asks to be the bot\'s friend')
def step_steam_asks(context: Context, steam_id: str) -> None:
    helpers.steam_set_relationship(steam_id, "RequestRecipient")


@when('Steam account "{steam_id}" becomes the bot\'s friend')
def step_steam_friend(context: Context, steam_id: str) -> None:
    helpers.steam_set_relationship(steam_id, "Friend")


@when('Steam account "{steam_id}" unfriends the bot')
def step_steam_unfriends(context: Context, steam_id: str) -> None:
    helpers.steam_set_relationship(steam_id, "None")


@when('the bot logs on to Steam again')
def step_steam_logs_on(context: Context) -> None:
    helpers.steam_refresh()


@then('the bot sends Steam account "{steam_id}" a friend request')
@then('the bot accepts the friend request of Steam account "{steam_id}"')
def step_steam_befriended(context: Context, steam_id: str) -> None:
    assert helpers.wait_until(lambda: steam_id in helpers.steam_friend_requests()), \
        f"The bot never befriended Steam account {steam_id}; it asked {helpers.steam_friend_requests()}"


@then('the bot sends Steam account "{steam_id}" no friend request')
def step_steam_not_befriended(context: Context, steam_id: str) -> None:
    assert not helpers.wait_until(lambda: steam_id in helpers.steam_friend_requests(), helpers.QUIET_WINDOW), \
        f"The bot befriended Steam account {steam_id}"


@when('Steam mappings are refreshed')
def step_steam_refresh(context: Context) -> None:
    helpers.steam_refresh()


@when('Steam reports user "{steam_id}" playing CS2 on map "{map_name}"')
def step_steam_playing_map(context: Context, steam_id: str, map_name: str) -> None:
    _capture_steam_baseline(context)
    helpers.steam_report(steam_id, {
        "player_name": "Gamer",
        # The real steam-user library reports gameid as a string ("730"), so the mock
        # must too — a numeric 730 would not exercise the type-sensitive diff logic.
        "gameid": "730",
        "rich_presence": [
            {"key": "game:map", "value": map_name},
            {"key": "status", "value": "Competitive"},
        ],
    })


@when('Steam reports user "{steam_id}" playing CS2 with score "{score}" on map "{map_name}"')
def step_steam_playing_map_score(context: Context, steam_id: str, score: str, map_name: str) -> None:
    _capture_steam_baseline(context)
    helpers.steam_report(steam_id, {
        "player_name": "Gamer",
        "gameid": "730",
        "rich_presence": [
            {"key": "game:map", "value": map_name},
            {"key": "status", "value": "Competitive"},
            {"key": "game:score", "value": score},
        ],
    })


@when('the matches of Steam user "{steam_id}" have been recorded')
def step_matches_recorded(context: Context, steam_id: str) -> None:
    assert helpers.wait_until(lambda: helpers.steam_matches_finalized(steam_id)), \
        f"The bot never finalised the matches of Steam id {steam_id}"


# Same as the score+map step but with an explicit Steam display name, so a test can assert that
# distinct players are named in a grouped end-of-game announcement. The name sits BETWEEN
# "playing CS2" and "with score" (like the "summarised as" step) so the plainer score/map step's
# tail isn't a substring of this sentence — otherwise behave reports an ambiguous step.
@when('Steam reports user "{steam_id}" playing CS2 as "{name}" with score "{score}" on map "{map_name}"')
def step_steam_named_playing_map_score(context: Context, steam_id: str, name: str, score: str, map_name: str) -> None:
    _capture_steam_baseline(context)
    helpers.steam_report(steam_id, {
        "player_name": name,
        "gameid": "730",
        "rich_presence": [
            {"key": "game:map", "value": map_name},
            {"key": "status", "value": "Competitive"},
            {"key": "game:score", "value": score},
        ],
    })


# Starts with "party" rather than "user" so the name+score step above can't also match it.
@when('Steam reports party "{party}" member "{steam_id}" playing CS2 as "{name}" with score "{score}" on map "{map_name}"')
def step_steam_party_playing(context: Context, party: str, steam_id: str, name: str, score: str, map_name: str) -> None:
    _capture_steam_baseline(context)
    helpers.steam_report(steam_id, {
        "player_name": name,
        "gameid": "730",
        "rich_presence": [
            {"key": "game:map", "value": map_name},
            {"key": "status", "value": "Competitive"},
            {"key": "game:score", "value": score},
            {"key": "steam_player_group", "value": party},
        ],
    })


# A varying "summarised as" rich_presence_string with a stable "Competitive" status: the game
# mode must come from the stable status, not the changing summary, or the match would split.
# "summarised as" sits before "with score" so the existing score/map step can't greedily match.
@when('Steam reports user "{steam_id}" playing CS2 summarised as "{summary}" with score "{score}" on map "{map_name}"')
def step_steam_playing_map_score_summary(context: Context, steam_id: str, summary: str, score: str, map_name: str) -> None:
    _capture_steam_baseline(context)
    helpers.steam_report(steam_id, {
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
    helpers.steam_report(steam_id, {"player_name": "Gamer", "gameid": "730"})


@when('Steam reports user "{steam_id}" playing CS2 with no details')
def step_steam_playing_no_details(context: Context, steam_id: str) -> None:
    # A bare "playing CS2" presence with no map/status/score. This must not be allowed to
    # overwrite a more-detailed message that is already on screen for the same session.
    _capture_steam_baseline(context)
    helpers.steam_report(steam_id, {"player_name": "Gamer", "gameid": "730"})


@when('Steam reports user "{steam_id}" in the CS2 menu')
def step_steam_in_menu(context: Context, steam_id: str) -> None:
    _capture_steam_baseline(context)
    helpers.steam_report(steam_id, {
        "player_name": "Gamer",
        "gameid": "730",
        "rich_presence": [{"key": "status", "value": "In the main menu"}],
    })


@when('Steam reports user "{steam_id}" stopped playing')
def step_steam_stopped(context: Context, steam_id: str) -> None:
    _capture_steam_baseline(context)
    helpers.steam_report(steam_id, {"player_name": "Gamer", "gameid": None})


@when('Steam reports user "{steam_id}" left CS2 but stayed online')
def step_steam_stopped_online(context: Context, steam_id: str) -> None:
    # Like "stopped playing", but still signed in to Steam, so the session closes as 🟡.
    _capture_steam_baseline(context)
    helpers.steam_report(steam_id, {"player_name": "Gamer", "gameid": None, "persona_state": 1})


@when('Steam reports user "{steam_id}" online but not playing')
def step_steam_online(context: Context, steam_id: str) -> None:
    helpers.steam_report(steam_id, {"player_name": "Gamer", "gameid": None, "persona_state": 1})


@when('Steam reports user "{steam_id}" offline')
def step_steam_offline(context: Context, steam_id: str) -> None:
    helpers.steam_report(steam_id, {"player_name": "Gamer", "gameid": None, "persona_state": 0})


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
    def downgraded() -> List[str]:
        texts: List[str] = [m["text"] for m in helpers.get_outbox(chat_id) if m["method"] in ("sendMessage", "editMessageText")]
        assert texts, f"No Steam messages reached chat {chat_id}"
        return [texts[-1]] if expected not in texts[-1] else []

    latest: List[str] = helpers.wait_until(downgraded, helpers.QUIET_WINDOW)
    assert not latest, (
        f"Latest Steam message in chat {chat_id} no longer contains {expected!r}; "
        f"a less-detailed update overwrote it. Latest text: {latest!r}"
    )


@then('chat {chat_id:d} has not received a Steam message containing "{expected}"')
def step_chat_has_not_received(context: Context, chat_id: int, expected: str) -> None:
    bad: List[str] = helpers.wait_until(
        lambda: [m["text"] for m in helpers.get_outbox(chat_id) if m["method"] == "sendMessage" and expected in m["text"]],
        helpers.QUIET_WINDOW,
    )
    assert not bad, f"Expected no Steam message containing {expected!r}, but got: {bad!r}"


@then('chat {chat_id:d} has received {count:d} Steam messages containing "{expected}"')
def step_chat_received_count(context: Context, chat_id: int, count: int, expected: str) -> None:
    # Count fresh sendMessage calls (not edits) matching the text. Used to prove distinct matches
    # get distinct announcements rather than one being edited into another.
    def matching() -> int:
        return len([m for m in helpers.get_outbox(chat_id) if m["method"] == "sendMessage" and expected in m["text"]])

    helpers.wait_until(lambda: matching() >= count)
    found: int = matching()
    assert found == count, (
        f"Expected {count} Steam messages containing {expected!r} in chat {chat_id}, found {found}"
    )


def _wait_for_method(chat_id: int, method: str, matches: Callable[[str], bool], description: str) -> None:
    assert helpers.wait_until(lambda: any(m["method"] == method and matches(m["text"]) for m in helpers.get_outbox(chat_id))), \
        f"No {method} {description} reached chat {chat_id}"


@then('the Steam message in chat {chat_id:d} is edited to contain "{expected}"')
def step_steam_message_edited(context: Context, chat_id: int, expected: str) -> None:
    _wait_for_method(chat_id, "editMessageText", lambda text: expected in text, f"containing {expected!r}")


@then('the Steam message in chat {chat_id:d} is edited to "{expected}"')
def step_steam_message_edited_to(context: Context, chat_id: int, expected: str) -> None:
    _wait_for_method(chat_id, "editMessageText", lambda text: text == expected, f"reading {expected!r}")


@when("the Steam message's live window has passed")
def step_steam_message_window_passed(context: Context) -> None:
    helpers.age_game_updates(7)


@then('the Steam message in chat {chat_id:d} is edited to drop its presence marker, keeping "{name}" bold')
def step_steam_message_marker_stripped(context: Context, chat_id: int, name: str) -> None:
    markers = ("🟢", "🟡", "🔴")
    stripped: List[Dict[str, Any]] = helpers.wait_until(lambda: [
        m for m in helpers.get_outbox(chat_id)
        if m["method"] == "editMessageText" and "is playing Counter-Strike" in m["text"]
        and not any(marker in m["text"] for marker in markers)
    ])
    assert stripped, f"No edit dropping the presence marker reached chat {chat_id}"
    assert name in helpers.bold_texts(stripped[0]), f"Expected {name!r} bold in {stripped[0]['text']!r}"


@then('chat {chat_id:d} eventually receives a new Steam message containing "{expected}"')
def step_chat_receives_new_steam(context: Context, chat_id: int, expected: str) -> None:
    # Poll for a fresh sendMessage (e.g. the end-of-game notification), which may arrive a
    # few seconds after an unrelated edit has already grown the outbox.
    _wait_for_method(chat_id, "sendMessage", lambda text: expected in text, f"containing {expected!r}")


@then('chat {chat_id:d} eventually receives a new Steam message "{expected}"')
def step_chat_receives_new_steam_exact(context: Context, chat_id: int, expected: str) -> None:
    _wait_for_method(chat_id, "sendMessage", lambda text: text == expected, f"reading {expected!r}")


@then('chat {chat_id:d} eventually receives a new Steam message reading')
def step_chat_receives_new_steam_text(context: Context, chat_id: int) -> None:
    _wait_for_exact(chat_id, "sendMessage", context.text)


@then('the Steam message in chat {chat_id:d} is edited to read')
def step_steam_message_edited_to_text(context: Context, chat_id: int) -> None:
    _wait_for_exact(chat_id, "editMessageText", context.text)


def _wait_for_exact(chat_id: int, method: str, expected: str) -> None:
    def texts() -> List[str]:
        return [m["text"] for m in helpers.get_outbox(chat_id) if m["method"] == method]
    assert helpers.wait_until(lambda: expected in texts()), f"No {method} reading {expected!r} reached chat {chat_id}; got {texts()!r}"


@then('the Steam Guard callback received code "{code}"')
def step_steam_guard_callback(context: Context, code: str) -> None:
    helpers.wait_until(lambda: helpers.steam_guard_state().get("called"))
    state: Dict[str, Any] = helpers.steam_guard_state()
    assert state.get("called"), "Steam Guard callback was never invoked"
    assert state.get("code") == code, \
        f"Steam Guard callback got {state.get('code')!r}, expected {code!r}"


@then('the bot\'s Steam nickname is "{nickname}"')
def step_steam_nickname(context: Context, nickname: str) -> None:
    assert helpers.wait_until(lambda: helpers.steam_nicknames()[-1:] == [nickname]), \
        f"Expected the Steam nickname {nickname!r}, the bot set {helpers.steam_nicknames()}"


@then('the bot has never been nicknamed "{nickname}" on Steam')
def step_steam_never_nicknamed(context: Context, nickname: str) -> None:
    assert nickname not in helpers.steam_nicknames(), f"The bot took the Steam nickname {nickname!r}"


@then('the Steam message containing "{expected}" in chat {chat_id:d} is deleted')
def step_steam_message_deleted(context: Context, expected: str, chat_id: int) -> None:
    def deleted() -> bool:
        outbox: List[Dict[str, Any]] = helpers.get_outbox(chat_id)
        sent: List[int] = [m["message_id"] for m in outbox if m["method"] == "sendMessage" and expected in m["text"]]
        return any(m["method"] == "deleteMessage" and m["message_id"] in sent for m in outbox)

    assert helpers.wait_until(deleted), f"No Steam message containing {expected!r} was deleted in chat {chat_id}"
