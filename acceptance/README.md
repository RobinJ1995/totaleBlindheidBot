# Acceptance tests

Black-box acceptance tests for the bot, written with [behave](https://behave.readthedocs.io/)
(Gherkin) and orchestrated with docker-compose. They drive the **real** compiled
bot through its public surface — incoming Telegram messages in, outgoing replies
out — with all external dependencies stubbed.

## What runs

| Service         | Role                                                                 |
|-----------------|----------------------------------------------------------------------|
| `bot`           | The actual bot image (built from the repo root `Dockerfile`).        |
| `telegram-mock` | Fake Telegram Bot API. The bot polls it; tests inject updates and read the bot's outgoing calls from an outbox. |
| `rustfs`        | S3-compatible object store backing the bot's DAO.                    |
| `steam_mock`    | Drop-in fake `steam-user` (mounted over `node_modules/steam-user`) with an HTTP control channel to trigger Steam events. |
| `behave`        | Runs the feature suite and asserts on the bot's behaviour.           |

The bot needs no source changes beyond honouring `TELEGRAM_API_BASE_URL` (so it can
poll the mock); everything else is configured through existing env vars.

## Running locally

```bash
cd acceptance
docker compose up --build --abort-on-container-exit --exit-code-from behave
docker compose down -v
```

The command exits non-zero if any scenario fails (propagated from the `behave`
container via `--exit-code-from`).

## Layout

```
acceptance/
  docker-compose.yml      # the full stack
  Dockerfile.behave       # python image that runs behave
  behave.ini
  requirements.txt
  telegram_mock/          # mock Telegram Bot API (Flask)
  steam_mock/             # fake steam-user + control server
  features/
    *.feature             # one feature file per bot command/behaviour
    environment.py        # waits for the stack, resets state per scenario
    steps/                # step implementations + shared helpers
```

## How a scenario flows

1. `When the user sends "/hi"` → behave POSTs a Telegram update to
   `telegram-mock` `/test/inject`.
2. The bot polls `getUpdates`, handles it, and calls `sendMessage` against the mock,
   which records it in the outbox.
3. `Then the bot replies "..."` → behave polls `/test/outbox` and asserts.

Steam-driven behaviour (game presence, Steam Guard) is triggered via the steam mock's
control endpoints (`/steam/user`, `/steam/steamguard`, ...) on the `bot` container.
