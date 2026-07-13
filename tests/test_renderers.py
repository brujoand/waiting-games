"""The renderer contract, checked statically -- because breaking it is silent.

A game module may export describe() to speak for itself, and app.js asks it before
falling back to the platform's own line. Every failure in that handshake looks like
a wording choice rather than a bug, which is why it lived here for months.
"""

from __future__ import annotations

import pathlib
import re

GAMES = pathlib.Path(__file__).parent.parent / "waiting_games" / "static" / "games"

# The guard that ate the game-over line.
#
# A session's status is "waiting", "active" or "finished" (lobby.py). Five
# renderers opened describe() with `if (game.status !== "active") return null` --
# meaning "not before the board is dealt", and meaning, in fact, "and not after
# the last move either". Every `if (game.over)` branch below it was unreachable, so
# Snake's "you survived 41 seconds" never rendered once, and 2048's dead run
# reported the platform's "A draw." -- to a player who had plainly just lost.
#
# The right guard is `=== "waiting"`. app.js already handles that case before it
# asks the game, so it is belt and braces; the wrong one threw the trousers away.
WRONG = re.compile(r'game\.status\s*!==\s*"active"')


def test_no_renderer_gates_itself_out_of_its_own_game_over():
    offenders = []

    for path in sorted(GAMES.glob("*.js")):
        for number, line in enumerate(path.read_text().splitlines(), start=1):
            if WRONG.search(line.split("//", 1)[0]):
                offenders.append(f"{path.name}:{number} -- {line.strip()}")

    assert not offenders, (
        'a finished game\'s status is "finished", not "active" -- this test is '
        "null for every state the game is actually over in:\n" + "\n".join(offenders)
    )
