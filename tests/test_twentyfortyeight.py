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
