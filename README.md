# Waiting Games

A small multiplayer browser game server, for playing something with the people
in the room while you all wait for something else. Pick a name, start a game,
share the page.

Fifteen games: Tic-Tac-Toe, Connect Four, Othello, Dots and Boxes, Nim, Hangman,
Battleship, Idiot, Gris, Solitaire, Snake, Snakes, Pong, 2048 and I Spy. Some are
strictly turn-based, some hide information from the other players (Battleship's
fleet, Hangman's word, the hand you are holding in Idiot), and Snake, Snakes and
Pong run on a clock rather than turns. Solitaire and 2048 are for one player and
Snake will take one, so the lobby asks first whether you are playing alone or with
other people. I Spy is the odd one out: its board is the room you are in, and you
play it through the camera — which needs an HTTPS setup, see below.

## Run it

The server ships as a single container image on GitHub's registry. To run the
latest release on port 8080:

```bash
docker run --rm -p 8080:8080 ghcr.io/brujoand/waiting-games:1.0.0
```

Then open <http://localhost:8080>. Pick a version from
[the releases](https://github.com/brujoand/waiting-games/releases) — there is no
`latest` tag, on purpose: a deployment should say which version it is running, and
`latest` is a moving target that makes "it worked yesterday" impossible to reason
about. Every published tag is an immutable release.

Everything lives in memory. There is no database and no volume to mount: a restart
drops every live game, and it runs as a single instance — two behind a load
balancer would not share a lobby, so don't scale it horizontally.

### Configuration

Behaviour is set entirely through environment variables, all optional:

| Variable | Default | What it does |
|---|---|---|
| `SECURE_COOKIE` | off | Set to `1` when serving over HTTPS, so the session cookie is marked `Secure` and never travels in the clear. Off by default because a `Secure` cookie is silently dropped over plain HTTP, which would make the app impossible to log in to on `http://localhost`. |
| `TRUSTED_PROXY_AUTH` | off | Set to `1` to take player identity from an authenticating reverse proxy's `X-Auth-Sub` / `X-Auth-Email` headers instead of the built-in name-claim. **Only safe** behind a proxy that authenticates *and* a network policy that makes that proxy the sole thing able to reach this process — otherwise anyone who can send a header is anyone they like. Leave it off unless you have both. |

For example, running behind a TLS-terminating proxy:

```bash
docker run --rm -p 8080:8080 -e SECURE_COOKIE=1 \
  ghcr.io/brujoand/waiting-games:1.0.0
```

### I Spy needs a secure context

The camera game uses `getUserMedia`, which the browser refuses to expose over
plain HTTP on a LAN address — `http://some-box:8080`, which is exactly how you
would show this to a room. So I Spy needs the app served over HTTPS (put it behind
a TLS-terminating proxy and set `SECURE_COOKIE=1`). `http://localhost` counts as a
secure context, so I Spy works when you run the container on the same machine you
open it from; it is only the shared-LAN case that needs the certificate. Every
other game is fine over plain HTTP.

### Build it yourself

The image is nothing exotic — a `docker build` reproduces it, fetching the 14MB of
object-detector weights I Spy needs (pinned by SHA-256, not committed to git):

```bash
docker build -t waiting-games .
docker run --rm -p 8080:8080 waiting-games
```

The published images stamp their version in with `--build-arg VERSION=<x.y.z>`; a
local build without it reports its version as `dev`, which is the honest answer for
a build semantic-release never tagged.

### Hardening

The image runs as a non-root user (UID `10001`) and writes nothing to disk at
runtime — the bytecode is compiled at build time — so it runs happily with a
read-only root filesystem and no extra privileges:

```bash
docker run --rm -p 8080:8080 \
  --read-only --cap-drop ALL --security-opt no-new-privileges \
  ghcr.io/brujoand/waiting-games:1.0.0
```

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
