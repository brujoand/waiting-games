"""The catalogue: what the lobby may offer, and how it is filed.

The lobby's filter is built out of what the games THEMSELVES declare -- the browser
knows no category by name, so a new shelf needs no frontend change at all. What that
buys in flexibility it owes back in invariants, and they are all here: a game on no
shelf, a game on a shelf that does not exist, and a catalogue that stopped being in
the order the filter reads its chips out of.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from waiting_games.games import CATEGORIES, GAMES
from waiting_games.main import app


@pytest.mark.parametrize("game", list(GAMES.values()), ids=list(GAMES))
def test_every_game_is_on_a_shelf_that_exists(game):
    """A game with no category is one the filter cannot place: it would vanish the
    moment any category chip was pressed, and nothing would say why."""
    shelf = getattr(game, "category", None)

    assert shelf in CATEGORIES, (
        f"{game.key} is filed under {shelf!r}, which is not one of {CATEGORIES}"
    )


def test_the_catalogue_is_grouped_by_shelf_in_the_order_the_filter_offers_them():
    """app.js reads the shelves off the catalogue in the order they FIRST APPEAR
    rather than being told what they are -- which is what keeps the browser ignorant
    of every category's name.

    The price is this invariant. GAMES must be grouped by shelf, and grouped in
    CATEGORIES order, or the chips come out in whatever order the games happen to be
    registered in -- and a shelf whose games are not contiguous simply reorders them.
    """
    shelves = [game.category for game in GAMES.values()]
    first_seen = list(dict.fromkeys(shelves))

    assert first_seen == [shelf for shelf in CATEGORIES if shelf in shelves], (
        f"the shelves come out of the catalogue as {first_seen}, "
        f"but the filter offers them as {list(CATEGORIES)}"
    )
    assert shelves == sorted(shelves, key=first_seen.index), (
        f"the catalogue is not grouped by shelf: {shelves}"
    )


def test_the_catalogue_on_the_wire_says_which_shelf_each_game_is_on():
    """And in the catalogue's own order, because that order IS the filter's."""
    with TestClient(app) as client:
        catalogue = client.get("/api/games").json()

    assert [entry["key"] for entry in catalogue] == list(GAMES)
    assert all(entry["category"] in CATEGORIES for entry in catalogue)


def test_snake_seats_one_and_snakes_seats_a_crowd():
    """The distinction the lobby exists to show, and it is not a preference: a grid
    cannot be shared, because the smallest error the wire can hand you on one is a
    whole CELL and a cell is what decides whether you are alive. Snake is the Nokia
    game and it is yours alone. Snakes left the grid in order to be shareable.

    They are one letter apart in the picker, so the seats had better not be a lie.
    """
    assert GAMES["snake"].max_players == 1
    assert GAMES["snakes"].min_players == 1  # ...and it is still fine on your own
    assert GAMES["snakes"].max_players > 1
