"""Mock Leetify public API for acceptance tests.

Serves the two endpoints the bot uses. Test-only endpoints let behave put accounts and
matches on Leetify and read back which accounts the bot asked about.
"""
import logging
import threading
from typing import Any, Dict, List, Set

from flask import Flask, Response, request, jsonify

logging.getLogger("werkzeug").setLevel(logging.WARNING)

app = Flask(__name__)

_lock = threading.Lock()
_registered: Set[str] = set()
_matches: List[Dict[str, Any]] = []
# Steam ids whose matches were asked for, one entry per request.
_lookups: List[str] = []


@app.route("/v3/profile/matches", methods=["GET"])
def profile_matches() -> Response:
    steam_id: str = request.args.get("steam64_id", "")
    with _lock:
        _lookups.append(steam_id)
        if steam_id not in _registered:
            return Response("Not Found", status=404)
        own: List[Dict[str, Any]] = [
            {**match, "stats": [stats for stats in match["stats"] if stats["steam64_id"] == steam_id]}
            for match in _matches
            if any(stats["steam64_id"] == steam_id for stats in match["stats"])
        ]
    return jsonify(sorted(own, key=lambda match: match["finished_at"], reverse=True))


@app.route("/v2/matches/<match_id>", methods=["GET"])
def match_details(match_id: str) -> Response:
    with _lock:
        found: List[Dict[str, Any]] = [match for match in _matches if match["id"] == match_id]
    return jsonify(found[0]) if found else Response("Not Found", status=404)


# ---------------------------------------------------------------------------
# Test-only endpoints (called by behave).
# ---------------------------------------------------------------------------

@app.route("/test/register", methods=["POST"])
def register() -> Response:
    with _lock:
        _registered.add(str(request.get_json(force=True)["steamId"]))
    return jsonify({"ok": True})


@app.route("/test/match", methods=["POST"])
def add_match() -> Response:
    with _lock:
        _matches.append(request.get_json(force=True))
    return jsonify({"ok": True})


@app.route("/test/lookups", methods=["GET"])
def lookups() -> Response:
    with _lock:
        return jsonify({"lookups": list(_lookups)})


@app.route("/test/reset", methods=["POST"])
def reset() -> Response:
    with _lock:
        _registered.clear()
        _matches.clear()
        _lookups.clear()
    return jsonify({"ok": True})


@app.route("/test/health", methods=["GET"])
def health() -> Response:
    return jsonify({"ok": True})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8085, threaded=True)
