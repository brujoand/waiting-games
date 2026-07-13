"""The two rules that keep the server locale-free, enforced rather than promised.

Both of these exist because the failure they catch is silent. A sentence on the
wire looks fine in review and only bites the player who does not read English;
a game view that clobbers a platform key looks like a frontend bug.
"""

from __future__ import annotations

import ast
import pathlib
import re

import pytest

from waiting_games.games import GAMES
from waiting_games.lobby import RESERVED_KEYS

SOURCE = pathlib.Path(__file__).parent.parent / "waiting_games"
CODED_ERRORS = ("InvalidMove", "InvalidName")

# lower.dotted.words -- e.g. "othello.no_flank", "move.not_your_turn"
CODE = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$")


def raise_sites():
    """Every InvalidMove(...) / InvalidName(...) construction in the package."""
    for path in sorted(SOURCE.rglob("*.py")):
        tree = ast.parse(path.read_text(), filename=str(path))
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id in CODED_ERRORS
            ):
                yield path.relative_to(SOURCE), node


def test_every_error_is_raised_with_a_code_not_a_sentence():
    """An f-string here is a sentence, and a sentence on the wire is English the
    player cannot escape. The browser owns the prose; the server owns the code.

    This is the test that stops someone writing `InvalidMove(f"the cell must be
    0-{n}")` again in six months, long after the reason has been forgotten.
    """
    offenders = []

    for path, node in raise_sites():
        first = node.args[0] if node.args else None
        if not isinstance(first, ast.Constant) or not isinstance(first.value, str):
            offenders.append(f"{path}:{node.lineno} -- not a literal string")
        elif not CODE.match(first.value):
            offenders.append(f"{path}:{node.lineno} -- {first.value!r} is not a code")

    assert not offenders, "errors must carry a code, not prose:\n" + "\n".join(offenders)


def test_error_codes_are_not_positional_beyond_the_code():
    """Params are keyword-only, so a code can never silently become a sentence
    with an argument stapled to it."""
    for path, node in raise_sites():
        assert len(node.args) == 1, f"{path}:{node.lineno} -- params must be keywords"


@pytest.mark.parametrize("game_class", list(GAMES.values()), ids=list(GAMES))
def test_no_game_view_collides_with_a_platform_key(game_class):
    """Session.state() merges a game's view OVER the platform's own keys, so a
    game returning e.g. `status` would silently clobber the lobby and look for all
    the world like a frontend bug.

    lobby.py has promised this test in a comment since the day it was written.
    """
    game = game_class()
    for index in range(game.max_players):
        game.add_player(f"u-{index}")
    game.start()

    for seat in (None, *range(len(game.players))):
        assert not RESERVED_KEYS & game.view(seat).keys()
