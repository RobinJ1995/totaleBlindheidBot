"""Behave lifecycle hooks: wait for the stack, seed per-scenario context."""
import itertools
import os
import sys
from typing import Iterator

import requests
from behave.model import Feature, Scenario, Step
from behave.runner import Context

# Make the helpers module (under steps/) importable here, the same way behave
# exposes it to the step modules themselves.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "steps"))
import helpers  # noqa: E402

# Scenarios are dealt round-robin over SHARD_TOTAL runs; this run takes the SHARD_INDEX-th share.
SHARD_INDEX: int = int(os.environ.get("SHARD_INDEX", "0"))
SHARD_TOTAL: int = int(os.environ.get("SHARD_TOTAL", "1"))
if not 0 <= SHARD_INDEX < SHARD_TOTAL:
    raise ValueError(f"SHARD_INDEX {SHARD_INDEX} is not below SHARD_TOTAL {SHARD_TOTAL}: no scenario would run")
_scenario_numbers: Iterator[int] = itertools.count()


def _wait_for(url: str, timeout: int = 90, name: str = "") -> None:
    def healthy() -> bool:
        try:
            return requests.get(url, timeout=3).status_code < 500
        except requests.RequestException:
            return False

    if not helpers.wait_until(healthy, timeout, interval=1):
        raise RuntimeError(f"Timed out waiting for {name or url}")


def _wait_for_bot_polling(timeout: int = 90) -> None:
    """Smoke-check that the bot is up and polling by round-tripping a /hi."""
    chat_id: int = 999000
    user = {"id": 999001, "first_name": "Warmup", "username": "warmup"}

    def replied() -> bool:
        helpers.reset_mock()
        helpers.inject_message("/hi", chat_id, user)
        return bool(helpers.wait_for_new_message(chat_id, 0, timeout=5))

    if not helpers.wait_until(replied, timeout, interval=0):
        raise RuntimeError("Bot never replied to warmup /hi; is it polling the mock?")
    helpers.reset_mock()


def before_all(context: Context) -> None:
    _wait_for(f"{helpers.TELEGRAM_MOCK_URL}/test/health", name="telegram-mock")
    _wait_for(f"{helpers.STEAM_CONTROL_URL}/steam/health", name="steam control")
    _wait_for(f"{helpers.DISCORD_MOCK_URL}/test/health", name="discord-mock")
    _wait_for(f"{helpers.LEETIFY_MOCK_URL}/test/health", name="leetify-mock")
    # The bot creates the schema on startup; wait for it, warm up, then reset app data.
    helpers.wait_for_db()
    _wait_for_bot_polling()
    helpers.reset_db()


def before_feature(context: Context, feature: Feature) -> None:
    for scenario in feature.walk_scenarios():
        if next(_scenario_numbers) % SHARD_TOTAL != SHARD_INDEX:
            scenario.skip()


def before_scenario(context: Context, scenario: Scenario) -> None:
    helpers.reset_mock()
    helpers.discord_reset()
    helpers.leetify_reset()
    # Sensible defaults; features override chat/user as needed.
    context.chat_id = 1001
    context.user = {"id": 5001, "first_name": "Tester", "username": "tester"}
    context.last_reply = None
    # Message id captured by the "the RSVP message is remembered" step, so later button
    # taps can target a specific message even after newer messages arrive.
    context.rsvp_message_id = None


def before_step(context: Context, step: Step) -> None:
    # Baseline for the "Discord channel ... receives" steps.
    if step.step_type == "when":
        counts: dict = {}
        for message in helpers.discord_outbox():
            counts[message["channel_id"]] = counts.get(message["channel_id"], 0) + 1
        context.discord_baselines = counts
