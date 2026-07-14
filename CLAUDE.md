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
- Commits follow Conventional Commits; the type decides the next release, and
  **a type that releases nothing ships nothing.** `feat` → minor, `fix`/`perf`/
  `revert` → patch, a `BREAKING CHANGE:` footer → major. Anything else
  (`chore`, `docs`, `refactor`, `style`, `ci`, `test`) mints **no version**, and
  with no version there is no image and the change can never reach a cluster that
  pins one. **The squash title is what semantic-release reads**, so it is the PR
  title that decides — not the commits inside it. CI fails if a commit touches the
  app and produces no release, because that used to happen silently.

## Commands

```bash
mise trust && mise install
pip install -r requirements.txt pytest httpx

python -m pytest -q                 # tests
node --test tests/*.test.mjs        # ...and the renderer's, which pytest cannot see
pre-commit run --all-files          # ruff, gitleaks, formatting
uvicorn waiting_games.main:app --reload --port 8080
docker build -t waiting-games .
```

Load a real-time game with **`?debug`** for a readout: fps and the worst frame
gap, the render delay, dropped states, and the measured milliseconds from a
keypress to the snake actually turning. "It feels choppy" is three unrelated bugs
wearing one coat — a browser that stopped painting, a server that stopped sending,
and arithmetic that went wrong — and this is what tells them apart.

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
- **A secret can belong to NOBODY.** Solitaire's face-down cards are hidden from
  the only person playing, so there is no `view()` override at all: the strict
  view is the only view, and `public_state()` counts the cards it may not name.
  That is the safe way round, and it is why the stock is a NUMBER on the wire —
  send the list and the browser knows what is coming, which is not a thing a
  player can un-know.
- **Solitaire deals ONE card, not three, and that is not softness.** Turning one
  at a time makes every card in the stock reachable, which is what turns "there
  is no move left" into arithmetic (`_stuck()`) instead of a judgement. Deal
  three and two cards in every three are unreachable this pass and reachable the
  next — a dead board becomes an opinion, and the honest answer becomes "we
  cannot say". A dead end also says only *there is nothing left to do*, never
  *you cannot win*: one of those is checkable and the other is a guess.
- **A real-time game** subclasses `RealTimeGame` and sets `tick_hz`. A move is
  then *intent*: `tick()` decides what actually happens and when the game ends,
  and the tick loop — not the move handler — broadcasts. Don't echo real-time
  input back; it turns held keys into a fan-out storm.
- **Don't put a grid on the wire.** Snake was a 6 Hz grid game and it could not
  be played over a network, and a week went into finding out why. On a grid the
  smallest error the wire can hand you is one whole CELL — there is nothing
  between cell 5 and cell 6 — and a cell is exactly the granularity that decides
  whether you are alive. Interpolation, buffering, prediction, deciding the move
  a tick early: all of it was trying to hide a quantum the same size as the game.
  Continuous positions make the same 300 ms worth a fifth of a unit, which is a
  smudge rather than a death. That is what the .io games have and we did not —
  not smoothness, **forgiveness**.
- **Floats are fine. `sin`, `cos` and `sqrt` are not.** Two simulations must agree
  to the last bit (the server replays a browser-run game to check it), and `+ - *
  /` on doubles are specified identically by Python and JavaScript while a square
  root may differ in its last bit. So: four directions rather than a free angle,
  and distances compared **squared**. `tests/test_determinism.py` proves it over
  600 ticks, with no tolerance.
- **A body with a free heading needs a minimum turning radius.** Turn, then turn
  again within your own width, and the snake is running parallel to itself and
  inside itself — geometry, not a bug. Snake's `MIN_TURN` is the four-direction
  version of slither's turn-rate cap, and it is *soft*: a turn asked for too early
  is remembered, not refused.

- **A game with one player and no hidden information can be played in the
  BROWSER** — say so with `client_clock`, and the lobby gives it no clock. Solo
  Snake is the worked example, and the reason is not elegance: measured on a real
  phone, our states arrived a median of 168ms apart (the tick, exactly), p90
  333ms, worst **2439ms**, with nothing dropped. You cannot steer a game you are
  told about two seconds late, and no renderer fixes that — the packet has to come
  out of the render loop. The run is a pure function of `(seed, moves, ticks)`, so
  the browser plays it and the server **replays it** to find out what really
  happened (`Game.run`, and the `result` message). It is not trust, it is
  arithmetic. Such a renderer gets `publish` (show the platform the board it is
  actually playing) and `finish` (hand the run over to be checked).
- **Two rulebooks drift.** A client-run game means its rules exist twice —
  `snake.py` and `static/games/snake_rules.js` — and the drift would not look like
  a broken build, it would look like a player who died on their own screen and
  lived on the server's. `tests/test_determinism.py` runs the same seed and moves
  through both and demands the same board, cell for cell. That test is the only
  thing making this safe. Nothing may be random that both sides cannot compute:
  `random.Random` is a Mersenne Twister and the browser has no such thing, hence
  `games/_rng.py` and its twin.

- **A grid cannot be shared.** Snake is the Nokia game — a matrix, one cell per tick,
  walls — and it works, because solo never touches a network. But on a grid the
  smallest error the wire can hand you is one whole CELL, and a cell is exactly the
  granularity that decides whether you are alive. **Snakes** is the shared one: real
  positions, turn where you ask, eat by overlap, no edges. The same 300 ms is then
  worth a fifth of a unit — a smudge, not a death. That is what the .io games have and
  a grid cannot: not smoothness, **forgiveness**.
- **Floats are fine. `sin`, `cos` and `sqrt` are not.** Two simulations must agree to
  the last bit (the server replays a browser-run game to check it, and rollback would
  need the same). `+ - * /` on doubles are specified identically by Python and
  JavaScript; a square root may differ in its last bit, and one bit is two different
  games. Hence four directions rather than a free angle, distances compared **squared**,
  and a wrapping **torus** rather than a sphere — a wrap is `x mod BOARD`; a sphere is
  trigonometry. `tests/test_determinism.py` proves both games with **no tolerance**.
- **A body with a free heading needs a minimum turning radius.** Turn, then turn again
  inside your own width, and the snake is running parallel to itself and *inside*
  itself — geometry, not a bug. `MIN_TURN` is the four-direction version of slither's
  turn-rate cap, and it is *soft*: a turn asked for too early is remembered, not refused.

A game's `key` is also its renderer's filename. Renaming one renames both.

## Language

Player-facing text is English: game titles, `InvalidMove` messages, UI strings.

## Releases

Merging to `main` runs semantic-release, which reads the commits and decides the
version. Only if it publishes a release does the image get built and pushed, tagged
with that exact version. There is deliberately no `latest` tag.
