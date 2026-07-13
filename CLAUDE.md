# CLAUDE.md

Waiting Games: a small multiplayer browser game server. FastAPI + WebSockets on
the server, vanilla ES modules in the browser, no build step. Ships as a public
container image.

## Hard rules

- **Never authenticate on a request header** unless the deployment can guarantee
  the header cannot come from a client. By default a header is set by whoever is
  talking to us, so trusting one (`X-Auth-*`, `X-Forwarded-User`, …) lets anybody
  be anybody. `test_a_forged_identity_header_is_ignored` fails if that is
  reintroduced in the default mode — do not delete it.

  The one sanctioned exception is `TRUSTED_PROXY_AUTH=1`, which takes identity
  from `X-Auth-Sub`/`X-Auth-Email`. It is safe **only** behind a proxy that
  authenticates, *and* a network policy that makes that proxy the sole thing able
  to reach this process. The code cannot check either; the flag is an operator's
  assertion, and if it is wrong the server is handed to anyone who can send a
  header. Only `sub` and `email` are trusted, because those are the only claims
  guaranteed to be in the token — a header backing an *optional* claim is one the
  proxy leaves alone, and therefore one the client still controls.
- **Never push to `main`.** Every change lands via a branch and a PR. CI must be
  green before merge.
- Commits follow Conventional Commits; the type decides the next release.

## Commands

```bash
mise trust && mise install
pip install -r requirements.txt pytest httpx

python -m pytest -q                 # tests
pre-commit run --all-files          # ruff, gitleaks, formatting
uvicorn waiting_games.main:app --reload --port 8080
docker build -t waiting-games .
```

## Layout

- `waiting_games/auth.py` — display names, session cookies. The only source of
  identity.
- `waiting_games/lobby.py` — sessions, joining, starting, reaping, and the
  real-time clock. All in memory: a restart drops every live game, and it runs
  as a single instance (two would not share a lobby).
- `waiting_games/games/` — one module per game. `base.Game` is the contract:
  the platform owns seats, turn order, the start gate and the clock; a subclass
  owns the board and the rules.
- `waiting_games/main.py` — HTTP + WebSocket endpoints.
- `waiting_games/static/` — the frontend. `games/<key>.js` renders game `<key>`.

## Adding a game

Implement `Game` — only `_apply`, `_result` and `public_state` are required —
register it in `games/__init__.py`, and add `static/games/<key>.js` exporting
`create({root, me, send}) -> {update, destroy}`. Nothing else should need to
change; if it does, the abstraction is wrong.

Two things to get right:

- **Hidden information lives in `view(seat)`**, and the spectator view
  (`seat is None`) must be the MOST restricted one — any logged-in user may open
  a game socket and watch. Battleship and Hangman are the worked examples.
- **A real-time game** subclasses `RealTimeGame` and sets `tick_hz`. A move is
  then *intent*: `tick()` decides what actually happens and when the game ends,
  and the tick loop — not the move handler — broadcasts. Don't echo real-time
  input back; it turns held keys into a fan-out storm.

A game's `key` is also its renderer's filename. Renaming one renames both.

## Language

Player-facing text is English: game titles, `InvalidMove` messages, UI strings.

## Releases

Merging to `main` runs semantic-release, which reads the commits and decides the
version. Only if it publishes a release does the image get built and pushed, tagged
with that exact version. There is deliberately no `latest` tag.
