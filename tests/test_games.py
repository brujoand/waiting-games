"""The four turn-based games.

None of these needed an engine change, which is the point: Othello's skip and
Dots and Boxes's repeat are the SAME hook (_next_seat), and both score-based
winners are Result.by_score. If a game here had forced a change to base.py, the
engine would have been wrong.
"""

from __future__ import annotations

import pytest
from conftest import rejected

from waiting_games.games import InvalidMove
from waiting_games.games.connectfour import COLS, ROWS, ConnectFour
from waiting_games.games.dotsandboxes import BOXES, DOTS, DotsAndBoxes
from waiting_games.games.nim import Nim
from waiting_games.games.othello import SIZE, Othello

A, B = "u-alice", "u-bob"


def seat(game_class, players=(A, B)):
    game = game_class()
    for player in players:
        game.add_player(player)
    game.start()
    return game


# -- Connect Four -------------------------------------------------------------


def drop(game, columns):
    for column in columns:
        game.apply_move(game.players[game.turn], {"column": column})


def test_four_in_a_column_wins():
    game = seat(ConnectFour)
    # alice stacks column 0; bob answers in column 1 each time.
    drop(game, [0, 1, 0, 1, 0, 1, 0])

    assert game.over
    assert game.winner == A


def test_four_in_a_row_wins():
    game = seat(ConnectFour)
    drop(game, [0, 0, 1, 1, 2, 2, 3])

    assert game.over
    assert game.winner == A


def test_four_on_a_diagonal_wins():
    game = seat(ConnectFour)
    # Alice climbs the diagonal (5,0) (4,1) (3,2) (2,3); bob's discs pad the
    # columns underneath so each of hers lands at the right height.
    drop(game, [0, 1, 1, 2, 3, 2, 2, 3, 0, 3])
    assert not game.over

    drop(game, [3])  # alice completes (2,3)

    assert game.over
    assert game.winner == A


def test_a_disc_falls_to_the_bottom_of_its_column():
    game = seat(ConnectFour)
    drop(game, [3])

    assert game.board[(ROWS - 1) * COLS + 3] == "R"  # the floor of the column
    assert game.board[3] is None  # ...and the top of it is still empty


def test_a_full_column_is_rejected():
    game = seat(ConnectFour)
    drop(game, [0, 0, 0, 0, 0, 0])  # six discs fill it

    with rejected("connectfour.column_full"):
        game.apply_move(game.players[game.turn], {"column": 0})


@pytest.mark.parametrize("column", [-1, COLS, "3", None, True, 1.5])
def test_a_bogus_column_is_rejected(column):
    game = seat(ConnectFour)

    with rejected("connectfour.column_range"):
        game.apply_move(A, {"column": column})


# -- Nim ---------------------------------------------------------------------


def test_taking_the_last_match_wins():
    game = seat(Nim)
    game.apply_move(A, {"pile": 0, "count": 3})  # piles: 0, 5, 7
    game.apply_move(B, {"pile": 1, "count": 5})  # piles: 0, 0, 7
    assert not game.over

    game.apply_move(A, {"pile": 2, "count": 7})  # alice empties the table

    assert game.over
    assert game.winner == A


def test_you_cannot_take_more_than_a_pile_holds():
    game = seat(Nim)

    with rejected("nim.not_that_many"):
        game.apply_move(A, {"pile": 0, "count": 4})  # the first pile holds 3


def test_you_must_take_at_least_one():
    game = seat(Nim)

    with rejected("nim.take_at_least_one"):
        game.apply_move(A, {"pile": 0, "count": 0})


def test_an_unknown_pile_is_rejected():
    game = seat(Nim)

    with rejected("nim.no_such_pile"):
        game.apply_move(A, {"pile": 9, "count": 1})


# -- Othello -----------------------------------------------------------------


def cell(row, col):
    return row * SIZE + col


def test_the_opening_position_offers_four_legal_moves():
    game = seat(Othello)

    # Black to move: the four cells that sandwich a white disc.
    assert sorted(game._legal_cells(0)) == sorted(
        [cell(2, 3), cell(3, 2), cell(4, 5), cell(5, 4)]
    )


def test_a_move_flips_the_discs_it_brackets():
    game = seat(Othello)
    game.apply_move(A, {"cell": cell(2, 3)})  # black, bracketing white at (3,3)

    assert game.board[cell(2, 3)] == "S"
    assert game.board[cell(3, 3)] == "S"  # flipped
    assert game.scores() == [4, 1]  # black gained the placed disc and the flip


def test_a_move_that_flips_nothing_is_rejected():
    game = seat(Othello)

    with rejected("othello.no_flank"):
        game.apply_move(A, {"cell": cell(0, 0)})


def test_a_player_with_no_legal_move_is_skipped():
    """Othello's pass rule -- the whole reason _next_seat is a hook.

    Black holds exactly ONE disc, in the corner. To play, white would have to
    bracket it: an empty cell, a run of black, then a white disc. Every such line
    through a corner starts off the board, so white cannot move at all -- no
    matter where its own discs are. Black meanwhile has three white runs pointing
    at that corner and can flip any of them.
    """
    game = seat(Othello)
    game.board = [None] * (SIZE * SIZE)
    game.board[cell(0, 0)] = "S"
    for row, col in [(0, 1), (0, 2), (1, 0), (2, 0), (1, 1), (2, 2)]:
        game.board[cell(row, col)] = "H"
    game.turn = 0

    assert game._legal_cells(1) == []  # white is stuck
    assert game._legal_cells(0) != []  # black is not

    game.apply_move(A, {"cell": cell(0, 3)})  # flips (0,1) and (0,2)

    assert not game.over  # black can still play the other two runs
    assert game.turn == 0  # white was skipped: straight back to black


def test_the_game_ends_on_count_when_neither_can_move():
    game = seat(Othello)
    # A board with no empty cells at all: nobody can move, black leads 3-1.
    game.board = ["S"] * (SIZE * SIZE)
    game.board[0] = "H"

    game.turn = 0
    result = game._result()

    assert result is not None
    assert result.winner_seat == 0


def test_a_filled_board_split_evenly_is_a_draw():
    game = seat(Othello)
    game.board = ["S"] * 32 + ["H"] * 32

    result = game._result()

    assert result is not None
    assert result.winner_seat is None


# -- Dots and Boxes -------------------------------------------------------


def horizontal(row, col):
    return {"kind": "h", "index": row * BOXES + col}


def vertical(row, col):
    return {"kind": "v", "index": row * DOTS + col}


def test_closing_a_box_keeps_your_turn():
    """The other half of the _next_seat hook: Othello uses it to skip a player,
    Dots and Boxes uses it to repeat one."""
    game = seat(DotsAndBoxes)

    game.apply_move(A, horizontal(0, 0))  # top
    assert game.turn == 1
    game.apply_move(B, vertical(0, 0))  # left
    assert game.turn == 0
    game.apply_move(A, vertical(0, 1))  # right
    assert game.turn == 1

    game.apply_move(B, horizontal(1, 0))  # bottom -- bob closes the box

    assert game.boxes[0] == 1  # bob owns it
    assert game.turn == 1  # and goes again
    assert not game.over


def test_an_edge_cannot_be_drawn_twice():
    game = seat(DotsAndBoxes)
    game.apply_move(A, horizontal(0, 0))

    with rejected("dotsandboxes.line_drawn"):
        game.apply_move(B, horizontal(0, 0))


def test_a_bogus_edge_is_rejected():
    game = seat(DotsAndBoxes)

    with rejected("dotsandboxes.bad_kind"):
        game.apply_move(A, {"kind": "x", "index": 0})

    with rejected("dotsandboxes.no_such_line"):
        game.apply_move(A, {"kind": "h", "index": 999})


def test_the_game_ends_when_every_box_is_closed_and_most_boxes_wins():
    game = seat(DotsAndBoxes)

    # Draw every edge. Whoever happens to close each box keeps their turn, so the
    # ordering is decided by the rules -- we only assert the terminal condition.
    for index in range(len(game.horizontal)):
        if not game.over:
            game.apply_move(game.players[game.turn], {"kind": "h", "index": index})
    for index in range(len(game.vertical)):
        if not game.over:
            game.apply_move(game.players[game.turn], {"kind": "v", "index": index})

    assert game.over
    assert all(owner is not None for owner in game.boxes)

    # 16 boxes shared out, and the winner is whoever holds the most.
    counts = game.scores()
    assert sum(counts) == BOXES * BOXES
    if counts[0] != counts[1]:
        expected = A if counts[0] > counts[1] else B
        assert game.winner == expected
    else:
        assert game.winner is None
