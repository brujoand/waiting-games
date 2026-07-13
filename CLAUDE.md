# CLAUDE.md

Waiting Games: a small multiplayer browser game server. FastAPI + WebSockets on
the server, vanilla ES modules in the browser, no build step. Ships as a public
container image.

## Hard rules

- **Never authenticate on a request header.** Identity comes from the session
  cookie and nothing else. A header is set by whoever is talking to us, so
  trusting one (`X-Auth-*`, `X-Forwarded-User`, …) lets anybody be anybody.
  There is a test that fails if this is reintroduced — do not delete it.
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
- `waiting_games/lobby.py` — game sessions, joining, listing, reaping. All in
  memory: a restart drops every live game, and it runs as a single instance
  (two would not share a lobby).
- `waiting_games/games/` — one module per game. `base.Game` is the contract:
  the platform owns players and turn order, a subclass owns the board and rules.
- `waiting_games/main.py` — HTTP + WebSocket endpoints.
- `waiting_games/static/` — the frontend. `games/<key>.js` renders game `<key>`.

## Adding a game

Implement `Game`, register it in `games/__init__.py`, add
`static/games/<key>.js` exporting `render(root, state, me, send)`. Nothing else
should need to change — if it does, the abstraction is wrong.

## Releases

Merging to `main` runs semantic-release, which reads the commits and decides the
version. Only if it publishes a release does the image get built and pushed, tagged
with that exact version. There is deliberately no `latest` tag.
