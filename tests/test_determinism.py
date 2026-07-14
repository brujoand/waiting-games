"""The two rulebooks must agree, EXACTLY, and this is the only thing making them.

A solo game is played in the BROWSER -- it has to be, because a phone's radio cannot
deliver a tick on time and a game you are told about two seconds late is a game you
cannot steer. So Snake's rules exist twice: waiting_games/games/snake.py, and
waiting_games/static/games/snake_rules.js.

Two copies of a rulebook drift, and this drift would not look like a broken build. It
would look like a player who died on their own screen and lived on the server's.

Now that the snake is off the grid, "agree" means agree to the LAST BIT of the last
float. There is no tolerance here and there must not be: a difference of one ULP in a
head position is a difference of one ULP in the next collision test, which sooner or
later is the difference between alive and dead. Comparing with a tolerance would let
exactly that through.

That is affordable because of what snake.py refuses to do. Every number in the game
moves through + - * and / only, on IEEE-754 doubles, which Python and JavaScript
specify identically. Distances are compared SQUARED so no square root is taken. There
is no sin, no cos, no angle -- which is the real reason the snake turns in four
directions rather than through a circle.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from waiting_games.games.snake import replay

ROOT = Path(__file__).resolve().parent.parent
RULES = ROOT / "waiting_games" / "static" / "games" / "snake_rules.js"

# Chosen to make the two disagree if they can: turns that put a corner in the path, an
# apple eaten (so the generator advances and the tail is held), a reversal both must
# refuse, a tight double-turn that runs the head down its own neck, and a long run
# into the wall.
CASES = [
    ("straight into the wall", 4242, []),
    ("turning, and eating on the way", 4242, [(6, "down"), (20, "right"), (44, "up")]),
    (
        "a reversal, which both must refuse",
        1337,
        [(4, "left"), (9, "up"), (12, "down")],
    ),
    ("a tight spiral, down its own neck", 99, [(6, "down"), (12, "left"), (18, "up")]),
    ("a long quiet run", 7, [(15, "up")]),
]

TICKS = 120  # 6 seconds at 20 Hz
PLAYER = "u-alice"


def in_javascript(seed: int, moves: list[dict], ticks: int) -> dict:
    """Play the same game in the browser's rulebook, via node."""
    script = f"""
    import {{ game }} from "{RULES.as_posix()}";
    const g = game({seed}, ["{PLAYER}"]);
    g.start();
    const moves = {json.dumps(moves)};
    for (let tick = 0; tick < {ticks}; tick += 1) {{
      for (const m of moves.filter((m) => m.tick === tick)) g.steer(0, m.dir);
      if (g.over) break;
      g.tick(1 / 20);
    }}
    process.stdout.write(JSON.stringify(g.state()));
    """
    # Running node from a test IS this file's purpose: the only way to know the
    # browser's rulebook agrees with Python's is to ask the browser's own engine. The
    # script is built from constants above and nothing in it comes from a user.
    result = subprocess.run(  # noqa: S603
        ["node", "--input-type=module", "-e", script],  # noqa: S607
        capture_output=True,
        text=True,
        check=True,
        cwd=ROOT,
    )
    return json.loads(result.stdout)


def board(state: dict) -> dict:
    """Everything that is the GAME. Floats stay floats -- see the module docstring."""
    return {
        "apples": [tuple(a) for a in state["apples"]],
        "snakes": [
            {
                "path": [tuple(p) for p in snake["path"]],
                "heading": snake["heading"],
                "alive": snake["alive"],
                "length": snake["length"],
            }
            for snake in state["snakes"]
        ],
    }


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
@pytest.mark.parametrize(("name", "seed", "moves"), CASES, ids=[c[0] for c in CASES])
def test_the_browser_plays_the_same_game_the_server_would_have(name, seed, moves):
    log = [{"tick": t, "dir": d} for t, d in moves]

    served = replay(seed, [PLAYER], [{**m, "player": PLAYER} for m in log], TICKS)
    browsed = in_javascript(seed, log, TICKS)

    assert board(browsed) == board(served.public_state()), (
        f"the two rulebooks disagree about '{name}'.\n"
        "A solo game is played in the browser and checked on the server, so this is a "
        "player who dies on one screen and lives on the other. Whichever side you "
        "changed, change the other -- and if the numbers are merely CLOSE, something "
        "took a square root."
    )


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_the_apples_land_on_the_same_real_coordinates():
    """The apples are the generator, and off the grid they are real numbers rather
    than squares -- so this is where a rounding difference would show up first, and
    where it would do the most damage: every apple after the first depends on where
    the last one went."""
    served = replay(4242, [PLAYER], [], 1)
    browsed = in_javascript(4242, [], 1)

    assert [tuple(a) for a in browsed["apples"]] == [tuple(a) for a in served.apples]
    assert browsed["seed"] == served.seed == 4242


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_a_long_game_does_not_drift_apart_by_a_single_bit():
    """The failure a tolerance would hide. Floating point error does not stay put: a
    head position one ULP out feeds the next tick, and the next, and eventually two
    identical games disagree about a collision. Six hundred ticks -- half a minute --
    and the last float must still match the last float."""
    log = [{"tick": t, "dir": d} for t, d in [(10, "down"), (40, "right"), (90, "up")]]

    served = replay(31337, [PLAYER], [{**m, "player": PLAYER} for m in log], 600)
    browsed = in_javascript(31337, log, 600)

    assert board(browsed) == board(served.public_state())
