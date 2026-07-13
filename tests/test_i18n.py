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

    assert not offenders, "errors must carry a code, not prose:\n" + "\n".join(
        offenders
    )


def test_error_codes_are_not_positional_beyond_the_code():
    """Params are keyword-only, so a code can never silently become a sentence
    with an argument stapled to it."""
    for path, node in raise_sites():
        assert len(node.args) == 1, f"{path}:{node.lineno} -- params must be keywords"


I18N = SOURCE / "static" / "i18n.js"

# Keys out of a flat `const en = { "a.b": "...", ... }` object literal. This
# couples the test to the file's shape, which is the price of catching the one
# failure that actually reaches a player: a raw `othello.no_flank` on their
# screen. i18n.js's header comment records the constraint.
KEY = re.compile(r'^\s*"([a-z][a-z0-9_.]*)":', re.MULTILINE)


def dictionary(name: str) -> set[str]:
    source = I18N.read_text()
    start = source.index(f"const {name} = {{")
    end = source.index("\n};", start)
    return set(KEY.findall(source[start:end]))


def test_every_code_the_server_can_raise_has_an_english_string():
    """A code with no string renders as the code. The player sees
    `othello.no_flank` instead of a sentence, which is the exact thing this whole
    refactor exists to avoid."""
    english = dictionary("en")
    missing = sorted(
        {
            node.args[0].value
            for _, node in raise_sites()
            if node.args and isinstance(node.args[0], ast.Constant)
        }
        - english
    )

    assert not missing, f"no English string for: {missing}"


def test_norwegian_says_everything_english_does():
    """A missing string falls back to English rather than going blank -- so this
    degrades instead of breaking, but it is still a half-translated page."""
    missing = sorted(dictionary("en") - dictionary("nb"))

    assert not missing, f"no Norwegian string for: {missing}"


STATIC = SOURCE / "static"

# A string or template chunk in the frontend. Good enough: this is a small,
# hand-written codebase with no minifier and no clever quoting.
LITERAL = re.compile(r'"([^"\\\n]*)"|`([^`\\]*)`', re.DOTALL)

# What a stray English sentence always looks like: a Capitalised word. Every
# technical string in this frontend is lowercase or kebab-case ("rt-canvas",
# "pointerdown", "content-type"), and every translation key is a lowercase dotted
# code -- so a capitalised word is prose that escaped t().
PROSE = re.compile(r"[A-Z][a-z]{2,}")


def without_interpolations(template: str) -> str:
    """Drop every ${...} from a template, braces balanced.

    What is INSIDE an interpolation is code, and code is allowed capital letters
    (`game.playerNames`); only the literal text around it is prose.
    """
    out = []
    depth = 0
    index = 0

    while index < len(template):
        if depth == 0 and template.startswith("${", index):
            depth = 1
            index += 2
        elif depth:
            depth += {"{": 1, "}": -1}.get(template[index], 0)
            index += 1
        else:
            out.append(template[index])
            index += 1

    return "".join(out)


def test_no_english_prose_is_hardcoded_in_the_frontend():
    """i18n.js owns every word. Anything else with a sentence in it is a string
    the language switch cannot reach.

    This is not hypothetical: the original i18n pass was a mechanical
    search-and-replace, and it missed two -- Pong's game-over line and Snake's
    solo one -- because the source did not read quite the way the replacement
    expected. They looked fine in review, passed every test, and simply stayed
    English forever for a Norwegian player. Hence a check rather than more care.
    """
    offenders = []

    for path in sorted(STATIC.rglob("*.js")):
        if path.name == "i18n.js":  # the dictionaries, obviously
            continue

        for line_number, line in enumerate(path.read_text().splitlines(), start=1):
            code = line.split("//", 1)[0]  # comments may say what they like
            for quoted, templated in LITERAL.findall(code):
                text = quoted or without_interpolations(templated)
                if PROSE.search(text):
                    where = path.relative_to(STATIC)
                    offenders.append(f"{where}:{line_number} -- {text.strip()!r}")

    assert not offenders, "prose outside i18n.js:\n" + "\n".join(offenders)


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
