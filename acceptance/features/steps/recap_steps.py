"""Steps for the weekly recap, which the acceptance bot runs at a fixed RECAP_NOW."""
from typing import Any, Dict, List

from behave import given, then, use_step_matcher
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


# One transaction, so the recap never sees half of the matches.
@given('chat {chat_id:d} recorded these matches')
def step_recorded_matches(context: Context, chat_id: int) -> None:
    conn = helpers.db_conn()
    try:
        conn.begin()
        with conn.cursor() as cur:
            for row in context.table:
                cells = dict(zip(context.table.headings, row.cells))
                cur.execute(
                    "INSERT INTO game_history (chat_id, user_id, player_name, mode, map, score, message_id, ended_at) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                    (
                        chat_id, _user_id(cur, int(cells["player"])), cells["name"], cells["mode"], cells["map"],
                        cells["score"], cells.get("message") or None, cells["ended_at"],
                    ),
                )
                history_id = cur.lastrowid
                for co_telegram_id in [int(tg) for tg in cells.get("with", "").split(",") if tg.strip()]:
                    cur.execute(
                        "INSERT INTO game_history_coplayer (game_history_id, co_user_id, name) VALUES (%s, %s, %s)",
                        (history_id, _user_id(cur, co_telegram_id), f"User{co_telegram_id}"),
                    )
        conn.commit()
    finally:
        conn.close()


def _recaps(chat_id: int) -> List[Dict[str, Any]]:
    return [m for m in helpers.get_outbox(chat_id) if m["method"] == "sendMessage" and "Weekly recap" in m["text"]]


@then('chat {chat_id:d} receives this weekly recap')
def step_receives_recap(context: Context, chat_id: int) -> None:
    recaps: List[Dict[str, Any]] = helpers.wait_until(lambda: _recaps(chat_id))
    assert recaps, f"No weekly recap reached chat {chat_id}"
    assert recaps[0]["text"] == context.text, f"Expected recap {context.text!r}, got {recaps[0]['text']!r}"


@then('chat {chat_id:d} receives no other weekly recap')
def step_no_other_recap(context: Context, chat_id: int) -> None:
    extra: List[Dict[str, Any]] = helpers.wait_until(lambda: _recaps(chat_id)[1:], helpers.QUIET_WINDOW)
    assert not extra, f"Chat {chat_id} got another weekly recap: {[m['text'] for m in extra]!r}"


@then('chat {chat_id:d} receives no weekly recap')
def step_no_recap(context: Context, chat_id: int) -> None:
    recaps: List[Dict[str, Any]] = helpers.wait_until(lambda: _recaps(chat_id), helpers.QUIET_WINDOW)
    assert not recaps, f"Chat {chat_id} got a weekly recap: {[m['text'] for m in recaps]!r}"
