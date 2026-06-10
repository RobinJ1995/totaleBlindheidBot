"""Behave lifecycle hooks: wait for the stack, seed per-scenario context."""
import os
import sys
import time
from typing import Optional

import requests
from behave.model import Scenario
from behave.runner import Context

# Make the helpers module (under steps/) importable here, the same way behave
# exposes it to the step modules themselves.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "steps"))
import helpers  # noqa: E402


def _wait_for(url: str, timeout: int = 90, name: str = "") -> None:
    deadline: float = time.time() + timeout
    last_err: Optional[Exception] = None
    while time.time() < deadline:
        try:
            resp = requests.get(url, timeout=3)
            if resp.status_code < 500:
                return
        except Exception as exc:  # noqa: BLE001
            last_err = exc
        time.sleep(1)
    raise RuntimeError(f"Timed out waiting for {name or url}: {last_err}")


def _wait_for_bot_polling(timeout: int = 90) -> None:
    """Smoke-check that the bot is up and polling by round-tripping a /hi."""
    deadline: float = time.time() + timeout
    chat_id: int = 999000
    user = {"id": 999001, "first_name": "Warmup", "username": "warmup"}
    while time.time() < deadline:
        helpers.reset_mock()
        helpers.inject_message("/hi", chat_id, user)
        new = helpers.wait_for_new_message(chat_id, 0, timeout=5)
        if new:
            helpers.reset_mock()
            return
    raise RuntimeError("Bot never replied to warmup /hi; is it polling the mock?")


def before_all(context: Context) -> None:
    _wait_for(f"{helpers.TELEGRAM_MOCK_URL}/test/health", name="telegram-mock")
    _wait_for(f"{helpers.STEAM_CONTROL_URL}/steam/health", name="steam control")
    helpers.ensure_bucket()
    helpers.clear_bucket()
    _wait_for_bot_polling()


def before_scenario(context: Context, scenario: Scenario) -> None:
    helpers.reset_mock()
    # Sensible defaults; features override chat/user as needed.
    context.chat_id = 1001
    context.user = {"id": 5001, "first_name": "Tester", "username": "tester"}
    context.last_reply = None
