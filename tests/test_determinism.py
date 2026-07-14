"""The two rulebooks must agree, and this is the only thing making them.

A solo game is played in the BROWSER -- it has to be, because a phone's radio
cannot deliver a tick on time and a game you are told about two seconds late is a
game you cannot steer. So Snake's rules exist twice: once in snake.py, once in
static/games/snake_rules.js.

Two copies of a rulebook drift. They always do, and the drift here would not look
like a broken build -- it would look like a player who died on their own screen
and lived on the server's, or a score the server refused to believe. Nothing else
would catch it.

So run the SAME seed and the SAME moves through both, and demand the same board
out the far end: every cell of every snake, every apple, alive or dead. Change a
rule on one side and this fails until you change it on the other. That is the
deal, and it is what a second implementation costs.
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

# Seeds and move logs chosen to make the two implementations disagree if they can:
# an apple eaten (so the RNG advances and the tail is held), a turn, a reversal the
# rules must reject, a move after death, and a run long enough to hit a wall.
CASES = [
    ("straight into the wall", 4242, []),
    (
        "turning, and eating on the way",
        4242,
        [
            {"tick": 2, "dir": "down"},
            {"tick": 7, "dir": "right"},
            {"tick": 14, "dir": "up"},
        ],
    ),
    (
        "a reversal, which both must refuse",
        1337,
        [
            {"tick": 1, "dir": "left"},
            {"tick": 3, "dir": "up"},
            {"tick": 4, "dir": "down"},
        ],
    ),
    (
        "steering into its own neck the long way round",
        99,
        [
            {"tick": 2, "dir": "down"},
            {"tick": 4, "dir": "left"},
            {"tick": 6, "dir": "up"},
            {"tick": 8, "dir": "right"},
        ],
    ),
    ("a long quiet run", 7, [{"tick": 5, "dir": "up"}]),
]

TICKS = 40
PLAYER = "u-alice"


def in_javascript(seed: int, moves: list[dict], ticks: int) -> dict:
    """Play the same game in the browser's rulebook, via node."""
    script = f"""
    import {{ game }} from "{RULES.as_posix()}";
    const g = game({seed}, ["{PLAYER}"]);
    g.start();
    const moves = {json.dumps(moves)};
    for (let tick = 0; tick < {ticks}; tick += 1) {{
      for (const move of moves.filter((m) => m.tick === tick)) g.steer(0, move.dir);
      if (g.over) break;
      g.tick(1 / 6);
    }}
    process.stdout.write(JSON.stringify(g.state()));
    """
    # Running node from a test is the entire point of this file -- the only way to
    # know the browser's rulebook agrees with Python's is to ask the browser's
    # engine. The script is built here from constants above; nothing in it comes
    # from anywhere a user could reach.
    result = subprocess.run(  # noqa: S603
        ["node", "--input-type=module", "-e", script],  # noqa: S607
        capture_output=True,
        text=True,
        check=True,
        cwd=ROOT,
    )
    return json.loads(result.stdout)


def board(state: dict) -> dict:
    """Everything that is the GAME, and nothing that is merely the platform."""
    return {
        "apples": sorted(map(tuple, state["apples"])),
        "snakes": [
            {
                "cells": [tuple(c) for c in snake["cells"]],
                "alive": snake["alive"],
                "next": tuple(snake["next"]) if snake["next"] else None,
                "grows": snake["grows"],
            }
            for snake in state["snakes"]
        ],
    }


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
@pytest.mark.parametrize(("name", "seed", "moves"), CASES, ids=[c[0] for c in CASES])
def test_the_browser_plays_the_same_game_the_server_would_have(name, seed, moves):
    served = replay(seed, [PLAYER], [{**m, "player": PLAYER} for m in moves], TICKS)
    browsed = in_javascript(seed, moves, TICKS)

    assert board(browsed) == board(served.public_state()), (
        f"the two rulebooks disagree about '{name}'.\n"
        "A solo game is played in the browser and checked on the server, so a "
        "disagreement here is a player who dies on one screen and lives on the "
        "other. Whichever side you changed, change the other."
    )


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_the_apples_grow_in_the_same_cells():
    """The apples are the RNG, and the RNG is the whole reason the seed is on the
    wire. If these ever drift apart, so does everything downstream of them: the
    board fills differently, the snake grows at different moments, and the two
    games are simply not the same game any more."""
    served = replay(4242, [PLAYER], [], 1)
    browsed = in_javascript(4242, [], 1)

    assert sorted(map(tuple, browsed["apples"])) == sorted(served.apples)
    assert browsed["seed"] == served.seed == 4242
