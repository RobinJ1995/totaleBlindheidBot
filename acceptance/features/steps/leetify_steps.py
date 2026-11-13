"""Steps for putting accounts and matches on the mocked Leetify and checking the bot's lookups."""
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

from behave import given, when, then, use_step_matcher
from behave.runner import Context

import helpers

use_step_matcher("parse")

# How long the bot's last scheduled Leetify lookup of a match may take to come.
LOOKUP_TIMEOUT: float = 25.0


@given('Steam account "{steam_id}" is on Leetify')
def step_leetify_registered(context: Context, steam_id: str) -> None:
    helpers.leetify_register(steam_id)


@given('Leetify has "{source}" match "{match_id}" that ended {minutes:d} minutes ago at {own:d}-{other:d} for team 2, with these players')
@when('Leetify has "{source}" match "{match_id}" that ended {minutes:d} minutes ago at {own:d}-{other:d} for team 2, with these players')
def step_leetify_match(context: Context, source: str, match_id: str, minutes: int, own: int, other: int) -> None:
    players: List[Dict[str, Any]] = []
    for row in context.table:
        cells = dict(zip(context.table.headings, row.cells))
        players.append({
            "steam64_id": cells["steam_id"],
            "initial_team_number": int(cells.get("team", "2")),
            "total_kills": int(cells.get("kills", "10")),
            "total_deaths": int(cells.get("deaths", "10")),
            "total_assists": int(cells.get("assists", "0")),
            "dpr": float(cells.get("adr", "70")),
            "multi5k": int(cells.get("aces", "0")),
            "multi4k": int(cells.get("4ks", "0")),
            "flashbang_hit_friend": int(cells.get("team_flashes", "0")),
        })
    finished_at: datetime = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    helpers.leetify_add_match({
        "id": match_id,
        "finished_at": finished_at.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "data_source": source,
        "team_scores": [{"team_number": 2, "score": own}, {"team_number": 3, "score": other}],
        "stats": players,
    })


@then('Leetify is asked for the matches of Steam account "{steam_id}" {count:d} times and no more')
def step_leetify_lookups(context: Context, steam_id: str, count: int) -> None:
    helpers.wait_until(lambda: helpers.leetify_lookups(steam_id) >= count, LOOKUP_TIMEOUT)
    assert not helpers.wait_until(lambda: helpers.leetify_lookups(steam_id) != count, helpers.QUIET_WINDOW), \
        f"Leetify was asked for the matches of {steam_id} {helpers.leetify_lookups(steam_id)} times, expected {count}"


@then('the Steam message in chat {chat_id:d} is not edited')
def step_steam_message_not_edited(context: Context, chat_id: int) -> None:
    def edits() -> List[str]:
        return [m["text"] for m in helpers.get_outbox(chat_id) if m["method"] == "editMessageText" and "a game" in m["text"]]
    assert not helpers.wait_until(edits, helpers.QUIET_WINDOW), f"The Steam message in chat {chat_id} was edited: {edits()!r}"
