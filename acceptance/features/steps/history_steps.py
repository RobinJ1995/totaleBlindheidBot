"""Steps that record finished matches straight into the game history."""
from typing import Any

from behave import given, when, use_step_matcher
from behave.runner import Context

import helpers

use_step_matcher("parse")


def _user_id(cur: Any, telegram_id: int) -> int:
    cur.execute(
        "INSERT IGNORE INTO user (telegram_id, name, username) VALUES (%s, %s, %s)",
        (telegram_id, f"User{telegram_id}", f"user{telegram_id}"),
    )
    cur.execute("SELECT id FROM user WHERE telegram_id = %s", (telegram_id,))
    return int(cur.fetchone()[0])


@given('chat {chat_id:d} already has these finished matches')
def step_finished_matches(context: Context, chat_id: int) -> None:
    conn = helpers.db_conn()
    try:
        with conn.cursor() as cur:
            for row in context.table:
                cells = dict(zip(context.table.headings, row.cells))
                minutes_ago = int(cells.get("minutes_ago", "60"))
                cur.execute(
                    "INSERT INTO game_history (chat_id, user_id, player_name, mode, map, score, started_at, ended_at) "
                    "VALUES (%s, %s, %s, %s, %s, %s, "
                    "UTC_TIMESTAMP(3) - INTERVAL %s MINUTE - INTERVAL 30 MINUTE, UTC_TIMESTAMP(3) - INTERVAL %s MINUTE)",
                    (
                        chat_id, _user_id(cur, int(cells["player"])), cells["name"], cells.get("mode", "Competitive"),
                        cells["map"], cells["score"], minutes_ago, minutes_ago,
                    ),
                )
                history_id = cur.lastrowid
                for co_telegram_id in [int(tg) for tg in cells.get("with", "").split(",") if tg.strip()]:
                    cur.execute(
                        "INSERT INTO game_history_coplayer (game_history_id, co_user_id, name) VALUES (%s, %s, %s)",
                        (history_id, _user_id(cur, co_telegram_id), f"User{co_telegram_id}"),
                    )
    finally:
        conn.close()


@when('the matches of chat {chat_id:d} turn out to have started {minutes:d} minutes earlier')
def step_matches_started_earlier(context: Context, chat_id: int, minutes: int) -> None:
    conn = helpers.db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("UPDATE game_history SET started_at = started_at - INTERVAL %s MINUTE WHERE chat_id = %s", (minutes, chat_id))
    finally:
        conn.close()
