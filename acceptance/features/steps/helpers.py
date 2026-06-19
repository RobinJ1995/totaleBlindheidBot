"""Shared helpers for the acceptance step implementations.

Everything that talks to the mock Telegram server, the Steam control server or
the S3 (RustFS) backend lives here so the step files stay declarative.
"""
import os
import time
from typing import Any, Dict, List, Optional

import boto3
import pymysql
import requests

TELEGRAM_MOCK_URL: str = os.environ.get("TELEGRAM_MOCK_URL", "http://telegram-mock:8081")
STEAM_CONTROL_URL: str = os.environ.get("STEAM_CONTROL_URL", "http://bot:9100")
GITHUB_MOCK_URL: str = os.environ.get("GITHUB_MOCK_URL", "http://github-mock:8082")
BOT_TOKEN: str = os.environ.get("TELEGRAM_BOT_API_TOKEN", "test-token")

S3_ENDPOINT: str = os.environ.get("S3_ENDPOINT", "http://rustfs:9000")
S3_BUCKET: str = os.environ.get("S3_BUCKET", "totaleblindheidbot")
S3_ACCESS_KEY: str = os.environ.get("S3_ACCESS_KEY", "rustfsadmin")
S3_SECRET_KEY: str = os.environ.get("S3_SECRET_KEY", "rustfsadmin")
S3_REGION: str = os.environ.get("S3_REGION", "us-east-1")

MARIADB_HOST: str = os.environ.get("MARIADB_HOST", "mariadb")
MARIADB_PORT: int = int(os.environ.get("MARIADB_PORT", "3306"))
MARIADB_USER: str = os.environ.get("MARIADB_USER", "root")
MARIADB_PASSWORD: str = os.environ.get("MARIADB_PASSWORD", "rootpass")
MARIADB_DATABASE: str = os.environ.get("MARIADB_DATABASE", "totaleblindheidbot")

# Every application-data table; truncated between runs to start from a clean DAO state.
_APP_TABLES: List[str] = [
    "telegram_user", "user_settings", "user_steam_id", "user_chat", "chat_settings",
    "rollcall_player", "rsvp_list", "rsvp_entry", "rsvp_message", "rollcall_schedule",
    "github_state", "game_update", "steam_storage",
    "current_match_coplayer", "current_match", "game_history_coplayer", "game_history",
]

# How long to wait for the bot to poll an update and produce a reply.
REPLY_TIMEOUT: float = float(os.environ.get("REPLY_TIMEOUT", "15"))
POLL_INTERVAL: float = 0.25


def s3_client() -> Any:
    return boto3.client(
        "s3",
        endpoint_url=S3_ENDPOINT,
        aws_access_key_id=S3_ACCESS_KEY,
        aws_secret_access_key=S3_SECRET_KEY,
        region_name=S3_REGION,
    )


def ensure_bucket(timeout: int = 90) -> None:
    """Create the bucket, retrying until RustFS is accepting connections."""
    deadline: float = time.time() + timeout
    last_err: Optional[Exception] = None
    while time.time() < deadline:
        client = s3_client()
        try:
            client.create_bucket(Bucket=S3_BUCKET)
            return
        except client.exceptions.BucketAlreadyOwnedByYou:
            return
        except Exception as exc:  # noqa: BLE001
            message: str = str(exc).lower()
            if "exists" in message or "owned" in message:
                return
            last_err = exc
            time.sleep(2)
    raise RuntimeError(f"Could not create bucket {S3_BUCKET!r}: {last_err}")


def clear_bucket() -> None:
    """Empty the bucket so local re-runs start from a clean steam-user state."""
    client = s3_client()
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=S3_BUCKET):
        keys: List[Dict[str, str]] = [{"Key": obj["Key"]} for obj in page.get("Contents", [])]
        if keys:
            client.delete_objects(Bucket=S3_BUCKET, Delete={"Objects": keys})


# ---------------------------------------------------------------------------
# MariaDB (application data) interactions
# ---------------------------------------------------------------------------

def db_conn() -> Any:
    return pymysql.connect(
        host=MARIADB_HOST,
        port=MARIADB_PORT,
        user=MARIADB_USER,
        password=MARIADB_PASSWORD,
        database=MARIADB_DATABASE,
        autocommit=True,
    )


def wait_for_db(timeout: int = 90) -> None:
    """Wait until MariaDB is up and the bot has created the schema."""
    deadline: float = time.time() + timeout
    last_err: Optional[Exception] = None
    while time.time() < deadline:
        try:
            conn = db_conn()
            try:
                with conn.cursor() as cur:
                    cur.execute("SHOW TABLES LIKE 'telegram_user'")
                    if cur.fetchone():
                        return
            finally:
                conn.close()
        except Exception as exc:  # noqa: BLE001
            last_err = exc
        time.sleep(1)
    raise RuntimeError(f"Timed out waiting for MariaDB schema: {last_err}")


def reset_db() -> None:
    """Truncate every application-data table so each run starts from a clean DAO state."""
    conn = db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SET FOREIGN_KEY_CHECKS = 0")
            for table in _APP_TABLES:
                cur.execute(f"TRUNCATE TABLE {table}")
            cur.execute("SET FOREIGN_KEY_CHECKS = 1")
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Telegram mock interactions
# ---------------------------------------------------------------------------

def reset_mock() -> None:
    requests.post(f"{TELEGRAM_MOCK_URL}/test/reset", timeout=5).raise_for_status()


def text_mention_entity(
    text: str, word: str, user_id: int, first_name: Optional[str] = None
) -> Dict[str, Any]:
    """Build a text_mention entity covering `word` within `text`."""
    offset: int = text.index(word)
    return {
        "type": "text_mention",
        "offset": offset,
        "length": len(word),
        "user": {
            "id": user_id,
            "is_bot": False,
            "first_name": first_name or word,
        },
    }


def inject_message(
    text: str,
    chat_id: int,
    user: Dict[str, Any],
    entities: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    message: Dict[str, Any] = {
        "message_id": int(time.time() * 1000) % 1000000,
        "date": int(time.time()),
        "chat": {"id": int(chat_id), "type": "group"},
        "from": {
            "id": int(user["id"]),
            "is_bot": False,
            "first_name": user.get("first_name", "Tester"),
            "username": user.get("username", "tester"),
        },
        "text": text,
    }
    if entities:
        message["entities"] = entities
    resp = requests.post(
        f"{TELEGRAM_MOCK_URL}/test/inject", json=message, timeout=5
    )
    resp.raise_for_status()
    return resp.json()


def get_outbox(chat_id: Optional[int] = None) -> List[Dict[str, Any]]:
    params: Dict[str, str] = {"chat_id": str(chat_id)} if chat_id is not None else {}
    resp = requests.get(f"{TELEGRAM_MOCK_URL}/test/outbox", params=params, timeout=5)
    resp.raise_for_status()
    return resp.json()["outbox"]


def wait_for_new_message(
    chat_id: int, baseline_count: int, timeout: float = REPLY_TIMEOUT
) -> List[Dict[str, Any]]:
    """Wait until the chat's outbox grows past `baseline_count`; return the new tail."""
    deadline: float = time.time() + timeout
    while time.time() < deadline:
        outbox: List[Dict[str, Any]] = get_outbox(chat_id)
        if len(outbox) > baseline_count:
            return outbox[baseline_count:]
        time.sleep(POLL_INTERVAL)
    return get_outbox(chat_id)[baseline_count:]


def expect_no_new_message(
    chat_id: int, baseline_count: int, wait: float = 3.0
) -> List[Dict[str, Any]]:
    """Confirm that no new outbound message arrives within `wait` seconds."""
    deadline: float = time.time() + wait
    while time.time() < deadline:
        outbox: List[Dict[str, Any]] = get_outbox(chat_id)
        if len(outbox) > baseline_count:
            return outbox[baseline_count:]
        time.sleep(POLL_INTERVAL)
    return []


# ---------------------------------------------------------------------------
# Steam control interactions
# ---------------------------------------------------------------------------

def steam_refresh() -> None:
    requests.post(f"{STEAM_CONTROL_URL}/steam/refresh", timeout=5).raise_for_status()


def steam_emit_user(steam_id: str, user: Dict[str, Any]) -> None:
    resp = requests.post(
        f"{STEAM_CONTROL_URL}/steam/user",
        json={"steamId": steam_id, "user": user},
        timeout=5,
    )
    resp.raise_for_status()


def steam_emit_steamguard(domain: Optional[str] = None, last_code_wrong: bool = False) -> None:
    resp = requests.post(
        f"{STEAM_CONTROL_URL}/steam/steamguard",
        json={"domain": domain, "lastCodeWrong": last_code_wrong},
        timeout=5,
    )
    resp.raise_for_status()


def steam_guard_state() -> Dict[str, Any]:
    resp = requests.get(f"{STEAM_CONTROL_URL}/steam/steamguard/state", timeout=5)
    resp.raise_for_status()
    return resp.json()


# ---------------------------------------------------------------------------
# GitHub mock interactions
# ---------------------------------------------------------------------------

def github_add_commit(sha: str, message: str) -> None:
    resp = requests.post(
        f"{GITHUB_MOCK_URL}/test/add-commit",
        json={"sha": sha, "message": message},
        timeout=5,
    )
    resp.raise_for_status()
