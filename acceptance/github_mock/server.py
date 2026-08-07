"""Mock GitHub REST API for acceptance tests.

Serves the single endpoint GitHubService polls — `GET /repos/<owner>/<repo>/commits`
— returning whatever commit list behave has configured, newest-first (GitHub's
ordering). Test-only endpoints let behave push new commits so the bot's
notification flow can be driven without touching the real GitHub API.

Mirrors the parts of GitHub's rate-limit contract the bot depends on: every commits
response carries an ETag, a matching `If-None-Match` gets a bodyless 304, and behave
can force rejections that carry `retry-after` so the poller's backoff is exercised.
"""
import logging
import threading
from typing import Any, Dict, List

from flask import Flask, Response, request, jsonify

logging.getLogger("werkzeug").setLevel(logging.WARNING)

app = Flask(__name__)

_lock = threading.Lock()


def _baseline() -> List[Dict[str, Any]]:
    return [{
        "sha": "baseline0",
        "html_url": "https://example.test/commit/baseline0",
        "commit": {"message": "baseline commit"},
    }]


# Newest-first list of commits, mirroring GitHub's response ordering.
_commits: List[Dict[str, Any]] = _baseline()

# Bumped on every change to _commits so the ETag changes with the content. Never
# reset: a scenario must not be able to hand the bot an ETag it already holds from
# an earlier scenario, which would 304 against commits it never saw.
_version: int = 0

# Request counters, so tests can assert conditional requests are actually happening.
_total_requests: int = 0
_conditional_hits: int = 0

# When set, the next _reject_requests commit requests answer with a rate-limit
# rejection carrying this retry-after (seconds). In "secondary" mode the rejection
# carries no timing headers at all, which GitHub documents for secondary limits —
# the client has only the message body to go on.
_reject_requests: int = 0
_reject_retry_after: int = 1
_reject_secondary: bool = False


def _etag() -> str:
    return f'W/"commits-{_version}"'


@app.route("/repos/<owner>/<repo>/commits", methods=["GET"])
def commits(owner: str, repo: str) -> Response:
    global _total_requests, _conditional_hits, _reject_requests
    with _lock:
        _total_requests += 1

        if _reject_requests > 0:
            _reject_requests -= 1
            if _reject_secondary:
                return Response(
                    response='{"message": "You have exceeded a secondary rate limit."}',
                    status=403,
                    content_type="application/json",
                )
            # Shape of a real primary rate-limit rejection: exhausted counter plus a
            # retry-after telling the client when to come back.
            return Response(
                response='{"message": "API rate limit exceeded"}',
                status=403,
                content_type="application/json",
                headers={
                    "Retry-After": str(_reject_retry_after),
                    "X-RateLimit-Limit": "60",
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Used": "60",
                },
            )

        etag: str = _etag()
        if request.headers.get("If-None-Match") == etag:
            _conditional_hits += 1
            # 304 carries no body, and GitHub does not charge it against the quota.
            return Response(status=304, headers={"ETag": etag})

        response: Response = jsonify(list(_commits))
        response.headers["ETag"] = etag
        return response


# ---------------------------------------------------------------------------
# Test-only endpoints (called by behave).
# ---------------------------------------------------------------------------

@app.route("/test/add-commit", methods=["POST"])
def add_commit() -> Response:
    """Prepend a newer commit, as a real push would surface it."""
    global _version
    body: Dict[str, Any] = request.get_json(force=True) or {}
    sha: str = str(body["sha"])
    commit: Dict[str, Any] = {
        "sha": sha,
        "html_url": body.get("html_url", f"https://example.test/commit/{sha}"),
        "commit": {"message": body.get("message", "")},
    }
    with _lock:
        _commits.insert(0, commit)
        _version += 1
    return jsonify({"ok": True})


@app.route("/test/rate-limit", methods=["POST"])
def rate_limit() -> Response:
    """Make the next N commit requests fail the way an exceeded rate limit does."""
    global _reject_requests, _reject_retry_after, _reject_secondary
    body: Dict[str, Any] = request.get_json(force=True) or {}
    with _lock:
        _reject_requests = int(body.get("requests", 1))
        _reject_retry_after = int(body.get("retry_after", 1))
        _reject_secondary = bool(body.get("secondary", False))
    return jsonify({"ok": True})


@app.route("/test/stats", methods=["GET"])
def stats() -> Response:
    with _lock:
        return jsonify({
            "total_requests": _total_requests,
            "conditional_hits": _conditional_hits,
        })


@app.route("/test/reset-stats", methods=["POST"])
def reset_stats() -> Response:
    global _total_requests, _conditional_hits
    with _lock:
        _total_requests = 0
        _conditional_hits = 0
    return jsonify({"ok": True})


@app.route("/test/reset", methods=["POST"])
def reset() -> Response:
    global _commits, _version, _total_requests, _conditional_hits, _reject_requests, _reject_secondary
    with _lock:
        _commits = _baseline()
        _version += 1
        _total_requests = 0
        _conditional_hits = 0
        _reject_requests = 0
        _reject_secondary = False
    return jsonify({"ok": True})


@app.route("/test/health", methods=["GET"])
def health() -> Response:
    return jsonify({"ok": True})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8082, threaded=True)
