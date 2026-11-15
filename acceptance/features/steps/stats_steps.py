"""Steps that set up recorded game history for the stats commands."""
from typing import Any

from behave import given, use_step_matcher
from behave.runner import Context

import helpers

use_step_matcher("parse")


def _record(chat_id: int, table: Any) -> None:
    for row in table:
        cells = dict(zip(table.headings, row.cells))
        helpers.seed_match(
            chat_id,
            int(cells["player"]),
            cells["name"],
            cells.get("mode", "Competitive"),
            cells["map"],
            cells["score"],
            [int(tg_id) for tg_id in cells.get("with", "").split(",") if tg_id.strip()],
            int(cells.get("days_ago", "0")),
        )


# Every scenario uses its own chat, so a Background keeps the shared matches until the scenario
# names its chat with "the chat has recorded the shared matches".
@given('every scenario records these shared matches')
def step_shared_matches(context: Context) -> None:
    context.shared_matches = context.table


@given('the chat has recorded the shared matches')
def step_record_shared_matches(context: Context) -> None:
    _record(context.chat_id, context.shared_matches)


@given('the chat has recorded these matches')
def step_record_matches(context: Context) -> None:
    _record(context.chat_id, context.table)
