# Waiting Games

A small multiplayer browser game server, for playing something with the people
in the room while you all wait for something else. Pick a name, start a game,
share the page.

Thirteen games: Tic-Tac-Toe, Connect Four, Othello, Dots and Boxes, Nim, Hangman,
Battleship, Idiot, Gris, Snake, Snakes, Pong and 2048. Some are strictly
turn-based, some hide information from the other players (Battleship's fleet,
Hangman's word, the hand you are holding in Idiot), and Snake, Snakes and Pong run
on a clock rather than turns. 2048 is for one player and Snake will take one, so
the lobby asks first whether you are playing alone or with other people.

## Run it

```bash
docker run --rm -p 8080:8080 ghcr.io/brujoand/waiting-games:1.0.0
```

Then open <http://localhost:8080>. Pick a version from
[the releases](https://github.com/brujoand/waiting-games/releases) — there is no
`latest` tag, on purpose.

Serving it over HTTPS? Set `SECURE_COOKIE=1` so the session cookie is marked
`Secure`. It is off by default because a `Secure` cookie is dropped over plain
HTTP, which would make the app impossible to log in to on localhost.

## What the login is worth

There are no accounts and no passwords. You claim a display name and the server
gives you an opaque session cookie. That is enough to stop one player
impersonating another player, and it is not intended to protect anything else.
Do not put anything behind it that you would mind a stranger reaching.

## Develop

```bash
mise trust && mise install
pip install -r requirements.txt pytest httpx

python -m pytest -q                 # tests
pre-commit run --all-files          # lint, format, secret scan
uvicorn waiting_games.main:app --reload --port 8080
```

## Add a game

A game owns its board and its rules; the platform owns seats, turn order, the
start gate and the clock. Implement `Game` (see `waiting_games/games/base.py`) —
only `_apply`, `_result` and `public_state` are required — register it in
`waiting_games/games/__init__.py`, and add a renderer at
`waiting_games/static/games/<key>.js` exporting
`create({root, me, send}) -> {update, destroy}`.

Hidden information goes in `view(seat)`, and the spectator view (`seat is None`)
must be the most restricted one: any logged-in user may open a game socket and
watch. A real-time game sets `tick_hz` and subclasses `RealTimeGame`.

## Conventions

- Commits follow [Conventional Commits](https://www.conventionalcommits.org)
  (enforced by commitizen). The commit types decide the next version.
- Merging to `main` runs semantic-release. If the commits warrant a release, it
  tags one and publishes the matching container image.
