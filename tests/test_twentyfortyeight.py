"""2048, and the platform rule it brought with it: a full game starts itself.

The sliding is worth testing directly because every one of its bugs is quiet. A
line that merges twice, or a slide that hands out a tile without moving anything,
still produces a plausible board -- it just produces the wrong game.
"""

from __future__ import annotations

import pytest
from conftest import rejected

from waiting_games.auth import Player
from waiting_games.games.twentyfortyeight import SIZE, TARGET, TwentyFortyEight
from waiting_games.lobby import Lobby

A = "u-alice"


def solo(tiles=None):
    game = TwentyFortyEight()
    game.add_player(A)
    game.start()
    if tiles is not None:
        game.tiles = list(tiles)
        game.score = 0
    return game


def rows(game):
    return [game.tiles[row * SIZE : (row + 1) * SIZE] for row in range(SIZE)]


def board(*rows_):
    """A board written the way it looks, with 0 for an empty cell."""
    return [cell for row in rows_ for cell in row]


def test_a_new_board_is_dealt_two_tiles():
    game = solo()

    dealt = [tile for tile in game.tiles if tile]

    assert len(dealt) == 2
    assert all(tile in (2, 4) for tile in dealt)


def test_a_slide_packs_a_line_against_the_wall():
    game = solo(board([0, 0, 0, 2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]))

    game.apply_move(A, {"dir": "left"})

    assert rows(game)[0][0] == 2  # against the left wall, wherever the new tile fell


def test_two_equal_tiles_merge_and_score():
    game = solo(board([2, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]))

    game.apply_move(A, {"dir": "left"})

    assert rows(game)[0][0] == 4
    assert game.score == 4  # the merged tile IS the score


def test_a_tile_merges_only_once_per_slide():
    """4 4 4 4 slides to 8 8, not to 16. The classic off-by-one of this game: a
    loop that folds the front of the line into itself keeps eating the line."""
    game = solo(board([4, 4, 4, 4], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]))

    game.apply_move(A, {"dir": "left"})

    assert rows(game)[0][:2] == [8, 8]
    assert game.score == 16  # two merges of 8, not one of 16


def test_the_pair_nearest_the_wall_merges_first():
    """2 2 4 slides LEFT to 4 4: the twos meet, and the four rides along behind.
    Merging the far pair instead would give 2 8, which is a different game."""
    game = solo(board([2, 2, 4, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]))

    game.apply_move(A, {"dir": "left"})

    assert rows(game)[0][:2] == [4, 4]


def test_sliding_right_merges_from_the_right_wall():
    """The direction is not a mirror of the code, it is a mirror of the LINE --
    which is the whole reason _lines() reverses it. 4 2 2 to the right is 4 4."""
    game = solo(board([4, 2, 2, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]))

    game.apply_move(A, {"dir": "right"})

    assert rows(game)[0][2:] == [4, 4]


def test_a_column_slides_too():
    game = solo(board([2, 0, 0, 0], [2, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]))

    game.apply_move(A, {"dir": "up"})

    assert game.tiles[0] == 4


def test_every_slide_hands_out_a_new_tile():
    game = solo(board([2, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]))

    game.apply_move(A, {"dir": "left"})

    # The merge left one tile; the spawn makes two.
    assert len([tile for tile in game.tiles if tile]) == 2


def test_a_slide_that_moves_nothing_does_nothing():
    """Not an error, and above all not a free tile.

    Not an error because a board packed into a corner has several directions that
    do nothing, and the game everybody knows does not scold you for pressing them.
    Not a tile because a tile you did not earn is, on a tight board, the difference
    between a run you can save and one you cannot.
    """
    game = solo(board([2, 4, 2, 4], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]))
    before = list(game.tiles)

    game.apply_move(A, {"dir": "left"})  # the row is already packed left

    assert game.tiles == before
    assert game.moves == 0
    assert not game.over


# -- the account of the slide ------------------------------------------------
#
# Two boards in a row cannot say how the second became the first. A 4 sitting where
# there was none is either a 4 that slid in or two 2s that met, and the browser has
# to draw those two things differently -- so the engine, which is the only thing
# that knows, says which. Everything the animation does rests on this being true.


def journeys(game):
    return {(step["from"], step["to"]): step for step in game.slid}


def test_a_slide_says_where_every_tile_went():
    game = solo(board([0, 0, 0, 2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]))

    game.apply_move(A, {"dir": "left"})

    travelled = journeys(game)[(3, 0)]
    assert travelled["value"] == 2  # the value it carried, not the one it becomes
    assert not travelled["merged"]


def test_both_halves_of_a_merge_travel_to_the_same_square():
    """The two tiles that met, and the fact that they met. Without the second, the
    browser cannot tell this from a 2 that simply slid to the wall next to another.
    """
    game = solo(board([2, 0, 0, 2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]))

    game.apply_move(A, {"dir": "left"})

    travelled = journeys(game)
    assert travelled[(0, 0)]["merged"]  # it never moved, and it still merged
    assert travelled[(3, 0)]["merged"]  # it crossed the row to do it
    assert game.tiles[0] == 4


def test_a_tile_that_does_not_move_is_still_accounted_for():
    """Silence would mean "gone". A tile the slide does not mention is one the
    browser has nothing to do with -- so it says even the journey of no distance."""
    game = solo(board([2, 0, 4, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]))

    game.apply_move(A, {"dir": "left"})

    assert (0, 0) in journeys(game)  # the 2 was already against the wall


def test_the_slide_accounts_for_every_tile_on_the_board():
    game = solo(board([2, 4, 0, 8], [0, 2, 0, 0], [16, 0, 0, 4], [0, 0, 32, 0]))
    before = [cell for cell, value in enumerate(game.tiles) if value]

    game.apply_move(A, {"dir": "down"})

    assert sorted(step["from"] for step in game.slid) == before


def test_a_slide_says_where_the_new_tile_landed():
    game = solo(board([2, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]))

    game.apply_move(A, {"dir": "left"})

    # The one square that no tile travelled to, and yet has a tile standing on it.
    assert game.spawned not in [step["to"] for step in game.slid]
    assert game.tiles[game.spawned] in (2, 4)


def test_a_reversed_line_reports_the_cells_it_really_used():
    """`up` and `right` read their lines backwards, which is what keeps them from
    being a second copy of the slide. The journeys must come back the right way
    round anyway -- a slide reported in mirror image would animate every tile into
    the wrong wall, and the board would still be correct, so nothing would catch it.
    """
    game = solo(board([4, 2, 2, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]))

    game.apply_move(A, {"dir": "right"})

    travelled = journeys(game)
    assert travelled[(1, 3)]["merged"]  # the twos met at the right-hand wall...
    assert travelled[(2, 3)]["merged"]
    assert not travelled[(0, 2)]["merged"]  # ...and the four rode along behind


def test_a_board_that_has_only_been_dealt_has_no_slide_to_report():
    """The two tiles a new board is dealt did not travel to get there, and a browser
    joining a game in progress has no board to travel FROM. Both are the same thing:
    nothing to animate, only something to draw."""
    game = solo()

    assert game.slid == []
    assert game.public_state()["moves"] == 0


@pytest.mark.parametrize("heading", ["sideways", "", None, 3])
def test_a_bogus_direction_is_rejected(heading):
    game = solo()

    with rejected("twentyfortyeight.unknown_direction"):
        game.apply_move(A, {"dir": heading})


def test_reaching_the_target_wins():
    half = TARGET // 2
    game = solo(board([half, half, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]))

    game.apply_move(A, {"dir": "left"})

    assert game.over
    assert game.winner == A


def test_a_jammed_board_ends_the_run():
    """One hole, one legal slide, and a board with no two neighbours alike once the
    new tile lands. The hole ends up walled in by 8s and 16s, so the spawn jams the
    board whichever of 2 or 4 it turns out to be -- the run is over either way, and
    the test does not have to hope.

    The engine can only call that a DRAW: there was nobody to lose to. The renderer
    is what turns it into the loss it plainly is -- see twentyfortyeight.js.
    """
    game = solo(board([2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 16, 8], [0, 8, 16, 8]))

    game.apply_move(A, {"dir": "left"})  # only the bottom row can move

    assert 0 not in game.tiles
    assert game.over
    assert game.winner is None


def test_a_full_board_that_can_still_merge_is_not_over():
    game = solo(board([2, 2, 4, 8], [4, 8, 16, 32], [2, 4, 8, 16], [4, 8, 16, 32]))

    assert not game._stuck()  # the pair of twos can still meet


def test_a_solo_game_starts_the_moment_it_is_created():
    """A one-seat game is full at birth. Before this rule, its host was shown a
    Start button for a game nobody else could ever join."""
    lobby = Lobby()

    session = lobby.create("twentyfortyeight", Player(sub=A, name="alice"))

    assert session.engine.started
    assert session.status == "active"
    assert session.summary()["joinable"] is False


def test_a_game_with_room_in_it_still_waits():
    lobby = Lobby()

    session = lobby.create("tictactoe", Player(sub=A, name="alice"))

    assert not session.engine.started
    assert session.status == "waiting"
