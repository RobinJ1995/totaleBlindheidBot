"""Mock GitHub REST API for acceptance tests.

Serves the single endpoint GitHubService polls — `GET /repos/<owner>/<repo>/commits`
— returning whatever commit list behave has configured, newest-first (GitHub's
ordering). Test-only endpoints let behave push new commits so the bot's
notification flow can be driven without touching the real GitHub API.
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


@app.route("/repos/<owner>/<repo>/commits", methods=["GET"])
def commits(owner: str, repo: str) -> Response:
    with _lock:
        return jsonify(list(_commits))


# ---------------------------------------------------------------------------
# Test-only endpoints (called by behave).
# ---------------------------------------------------------------------------

@app.route("/test/add-commit", methods=["POST"])
def add_commit() -> Response:
    """Prepend a newer commit, as a real push would surface it."""
    body: Dict[str, Any] = request.get_json(force=True) or {}
    sha: str = str(body["sha"])
    commit: Dict[str, Any] = {
        "sha": sha,
        "html_url": body.get("html_url", f"https://example.test/commit/{sha}"),
        "commit": {"message": body.get("message", "")},
    }
    with _lock:
        _commits.insert(0, commit)
    return jsonify({"ok": True})


@app.route("/test/reset", methods=["POST"])
def reset() -> Response:
    global _commits
    with _lock:
        _commits = _baseline()
    return jsonify({"ok": True})


@app.route("/test/health", methods=["GET"])
def health() -> Response:
    return jsonify({"ok": True})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8082, threaded=True)
