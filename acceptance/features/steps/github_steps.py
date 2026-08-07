"""Steps for driving the mocked GitHub commit-notification flow."""
from typing import Any, Dict, List

from behave import given, when, then, use_step_matcher
from behave.runner import Context

import helpers

use_step_matcher("parse")


@when('a commit "{sha}" with message "{message}" is pushed to GitHub')
def step_github_push(context: Context, sha: str, message: str) -> None:
    # The bot polls the mock on a short interval, so capture the chat's baseline
    # before the push and let the assertion wait for the announcement.
    context.gh_chat = context.chat_id
    context.gh_baseline = len(helpers.get_outbox(context.chat_id))
    helpers.github_add_commit(sha, message)


@then('chat {chat_id:d} receives a GitHub notification containing "{expected}"')
def step_github_notified(context: Context, chat_id: int, expected: str) -> None:
    baseline: int = context.gh_baseline if chat_id == context.gh_chat else 0
    new: List[Dict[str, Any]] = helpers.wait_for_new_message(chat_id, baseline)
    texts: List[str] = [m["text"] for m in new if m["method"] == "sendMessage"]
    assert any(expected in t for t in texts), \
        f"Expected a GitHub notification containing {expected!r}; got {texts!r}"


@given('the bot has established its GitHub baseline')
@when('the bot has established its GitHub baseline')
def step_github_baseline(context: Context) -> None:
    helpers.wait_for_github_baseline()


@when('GitHub rejects the next {count:d} requests with a rate limit and retry-after {retry_after:d}')
def step_github_rate_limit(context: Context, count: int, retry_after: int) -> None:
    helpers.github_reject_requests(count, retry_after)


@when('GitHub rejects the next request with a secondary rate limit')
def step_github_secondary_limit(context: Context) -> None:
    # A secondary limit may carry neither retry-after nor an exhausted counter, so
    # the message body is the only thing identifying it.
    helpers.github_reject_requests(1, secondary=True)


@then('the bot stops polling GitHub')
def step_github_polling_stopped(context: Context) -> None:
    helpers.wait_for_github_polling_to_stop()


@when('the GitHub request counters are reset')
def step_github_reset_stats(context: Context) -> None:
    helpers.github_reset_stats()


@then('GitHub answers at least one poll with "304 Not Modified"')
def step_github_conditional(context: Context) -> None:
    helpers.wait_for_conditional_request()


@then('no GitHub notification is posted to chat {chat_id:d}')
def step_github_not_notified(context: Context, chat_id: int) -> None:
    baseline: int = context.gh_baseline if chat_id == context.gh_chat else 0
    new: List[Dict[str, Any]] = helpers.expect_no_new_message(chat_id, baseline, wait=5)
    sends: List[str] = [m["text"] for m in new if m["method"] == "sendMessage"]
    assert not sends, f"Expected no GitHub notification, but got: {sends!r}"
