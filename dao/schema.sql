-- Schema for totaleBlindheidBot application data (MariaDB / MySQL).
-- Applied idempotently at startup and by the migration script.
-- Telegram chat/user/message ids are signed BIGINT (group chats are negative).
-- Timestamps are DATETIME(3) in UTC; mysql2 maps them to/from JS Date.

CREATE TABLE IF NOT EXISTS telegram_user (
    user_id  BIGINT       NOT NULL,
    name     VARCHAR(255) NULL,
    username VARCHAR(255) NULL,
    PRIMARY KEY (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_settings (
    user_id  BIGINT      NOT NULL,
    timezone VARCHAR(64) NULL,
    PRIMARY KEY (user_id),
    CONSTRAINT fk_user_settings_user FOREIGN KEY (user_id)
        REFERENCES telegram_user (user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_steam_id (
    user_id  BIGINT      NOT NULL,
    steam_id VARCHAR(32) NOT NULL,
    PRIMARY KEY (user_id, steam_id),
    KEY idx_user_steam_id_steam (steam_id),
    CONSTRAINT fk_user_steam_id_user FOREIGN KEY (user_id)
        REFERENCES telegram_user (user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_chat (
    user_id BIGINT NOT NULL,
    chat_id BIGINT NOT NULL,
    PRIMARY KEY (user_id, chat_id),
    CONSTRAINT fk_user_chat_user FOREIGN KEY (user_id)
        REFERENCES telegram_user (user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS chat_settings (
    chat_id       BIGINT     NOT NULL,
    steam_updates TINYINT(1) NULL,
    github_notify TINYINT(1) NULL,
    PRIMARY KEY (chat_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS rollcall_player (
    id           BIGINT       NOT NULL AUTO_INCREMENT,
    chat_id      BIGINT       NOT NULL,
    user_id      BIGINT       NULL,
    username     VARCHAR(255) NULL,
    display_name VARCHAR(512) NULL,
    PRIMARY KEY (id),
    KEY idx_rollcall_player_chat (chat_id),
    CONSTRAINT fk_rollcall_player_user FOREIGN KEY (user_id)
        REFERENCES telegram_user (user_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS rsvp_list (
    id         BIGINT      NOT NULL AUTO_INCREMENT,
    chat_id    BIGINT      NOT NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    KEY idx_rsvp_list_chat (chat_id),
    KEY idx_rsvp_list_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS rsvp_entry (
    rsvp_list_id BIGINT       NOT NULL,
    user_id      BIGINT       NOT NULL,
    rsvp         ENUM('yes','maybe','no') NOT NULL,
    PRIMARY KEY (rsvp_list_id, user_id),
    CONSTRAINT fk_rsvp_entry_list FOREIGN KEY (rsvp_list_id)
        REFERENCES rsvp_list (id) ON DELETE CASCADE,
    CONSTRAINT fk_rsvp_entry_user FOREIGN KEY (user_id)
        REFERENCES telegram_user (user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS rsvp_message (
    rsvp_list_id BIGINT NOT NULL,
    message_id   BIGINT NOT NULL,
    base_text    TEXT   NOT NULL,
    keyboard     ENUM('schedule','rollcall') NOT NULL,
    PRIMARY KEY (rsvp_list_id, message_id),
    KEY idx_rsvp_message_message (message_id),
    CONSTRAINT fk_rsvp_message_list FOREIGN KEY (rsvp_list_id)
        REFERENCES rsvp_list (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Surrogate id + non-unique chat_id index: the schema permits many schedules per
-- chat. The DAO keeps one-per-chat behaviour by replacing the row on write.
CREATE TABLE IF NOT EXISTS rollcall_schedule (
    id           BIGINT      NOT NULL AUTO_INCREMENT,
    chat_id      BIGINT      NOT NULL,
    trigger_at   DATETIME(3) NOT NULL,
    rsvp_list_id BIGINT      NULL,
    initiator_id BIGINT      NULL,
    PRIMARY KEY (id),
    KEY idx_rollcall_schedule_chat (chat_id),
    CONSTRAINT fk_rollcall_schedule_initiator FOREIGN KEY (initiator_id)
        REFERENCES telegram_user (user_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Single-row state for the one polled GitHub repo.
CREATE TABLE IF NOT EXISTS github_state (
    id       TINYINT     NOT NULL DEFAULT 1,
    last_sha VARCHAR(64) NULL,
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Surrogate id + non-unique (chat_id,user_id) index: schema permits many; the DAO
-- keeps one live update per (chat,user) by replacing the row on write.
CREATE TABLE IF NOT EXISTS game_update (
    id         BIGINT      NOT NULL AUTO_INCREMENT,
    chat_id    BIGINT      NOT NULL,
    user_id    BIGINT      NOT NULL,
    message_id BIGINT      NOT NULL,
    text       TEXT        NOT NULL,
    game_id    VARCHAR(64) NULL,
    map        VARCHAR(64) NULL,
    status     VARCHAR(255) NULL,
    score      VARCHAR(64) NULL,
    timestamp  DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    KEY idx_game_update_chat_user (chat_id, user_id),
    CONSTRAINT fk_game_update_user FOREIGN KEY (user_id)
        REFERENCES telegram_user (user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- steam-user library persistence when STEAM_STORAGE_BACKEND=database.
CREATE TABLE IF NOT EXISTS steam_storage (
    filename VARCHAR(255) NOT NULL,
    contents LONGBLOB     NOT NULL,
    PRIMARY KEY (filename)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- The match a (chat,user) is currently playing. One row per (chat,user); replaced on
-- write. Survives session closes and bot restarts so a match can span a game relaunch.
-- A match is finished (and moved to game_history) on a score reset / map / mode change,
-- or once it has been idle (not playing, no score progress) past the idle window.
CREATE TABLE IF NOT EXISTS current_match (
    chat_id          BIGINT       NOT NULL,
    user_id          BIGINT       NOT NULL,
    map              VARCHAR(64)  NULL,
    mode             VARCHAR(255) NULL,
    max_score        VARCHAR(64)  NULL,
    player_name      VARCHAR(255) NULL,
    started_at       DATETIME(3)  NOT NULL,
    last_progress_at DATETIME(3)  NOT NULL,
    playing          TINYINT(1)   NOT NULL,
    PRIMARY KEY (chat_id, user_id),
    KEY idx_current_match_idle (playing, last_progress_at),
    CONSTRAINT fk_current_match_user FOREIGN KEY (user_id)
        REFERENCES telegram_user (user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Other tracked players seen in the same in-progress match. name is a point-in-time
-- snapshot; co_user_id carries no FK so a co-player needn't be ensured every tick.
CREATE TABLE IF NOT EXISTS current_match_coplayer (
    chat_id    BIGINT       NOT NULL,
    user_id    BIGINT       NOT NULL,
    co_user_id BIGINT       NOT NULL,
    name       VARCHAR(255) NULL,
    PRIMARY KEY (chat_id, user_id, co_user_id),
    CONSTRAINT fk_cmcp_match FOREIGN KEY (chat_id, user_id)
        REFERENCES current_match (chat_id, user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- A finished match. score is the raw "16-14" (player-opponent); win/loss/tie is derived
-- from it. One row per finished match per (chat,user).
CREATE TABLE IF NOT EXISTS game_history (
    id         BIGINT       NOT NULL AUTO_INCREMENT,
    chat_id    BIGINT       NOT NULL,
    user_id    BIGINT       NOT NULL,
    mode       VARCHAR(255) NULL,
    map        VARCHAR(64)  NULL,
    score      VARCHAR(64)  NULL,
    started_at DATETIME(3)  NULL,
    ended_at   DATETIME(3)  NOT NULL,
    PRIMARY KEY (id),
    KEY idx_game_history_chat_user (chat_id, user_id),
    CONSTRAINT fk_game_history_user FOREIGN KEY (user_id)
        REFERENCES telegram_user (user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Co-players recorded against a finished match. name is a point-in-time snapshot.
CREATE TABLE IF NOT EXISTS game_history_coplayer (
    game_history_id BIGINT       NOT NULL,
    co_user_id      BIGINT       NOT NULL,
    name            VARCHAR(255) NULL,
    PRIMARY KEY (game_history_id, co_user_id),
    CONSTRAINT fk_ghcp_history FOREIGN KEY (game_history_id)
        REFERENCES game_history (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

