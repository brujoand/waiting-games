"""Snakes: off the grid, and with no edges.

Snake keeps its matrix and its walls -- it is the Nokia game and it works, because a
solo game never goes near a network. These are the rules that are DIFFERENT, and each
of them exists because the grid could not be shared.
"""

from __future__ import annotations

import pytest
from conftest import rejected

from waiting_games.games.snakes import BOARD, SPEED, Snakes

A, B = "u-alice", "u-bob"


def seat(players=(A,)) -> Snakes:
    game = Snakes(seed=4242)
    for player in players:
        game.add_player(player)
    game.start()
    return game


def run(game: Snakes, ticks: int) -> None:
    for _ in range(ticks):
        if game.over:
            return
        game.tick(1 / game.tick_hz)


def test_the_head_is_at_a_real_place_not_in_a_square():
    """The whole point. On a grid the smallest error the wire can hand you is one CELL,
    and a cell is exactly the granularity that decides whether you are alive. Here it
    is a fifth of a unit, which is a smudge."""
    game = seat()
    before = list(game.snakes[0].head)

    game.tick(1 / game.tick_hz)

    moved = game.snakes[0].head[0] - before[0]
    assert moved == pytest.approx(SPEED / game.tick_hz)
    assert moved < 1.0, "it moved less than a whole cell, because there are no cells"


def test_there_are_no_walls_at_all():
    """Off the top, on at the bottom. Nothing kills you but a snake -- which is what a
    shared game wants, and what a wall was only ever standing in for."""
    game = seat()
    run(game, int(BOARD / SPEED * game.tick_hz) + 20)  # straight across, and beyond

    assert game.snakes[0].alive, "it hit an edge that is not supposed to be there"
    assert not game.over


def test_the_body_is_CUT_at_the_seam_rather_than_stretched_across_the_board():
    """A body running from x=23.9 to x=0.1 as a single segment would be drawn straight
    across the middle of the board -- and would kill everything it crossed. So the path
    stops at the seam and a new stroke starts on the far side."""
    game = seat()
    snake = game.snakes[0]

    assert len(snake.strokes) == 1
    # 4.0 + 67 * 0.3 = 24.1, so it is a hair over the seam on the 67th tick.
    run(game, 68)

    assert len(snake.strokes) == 2, "the path did not break at the seam"
    assert snake.head[0] < 1.0  # come out the other side
    assert snake.strokes[1][0][0] > BOARD - 1.0  # ...and the tail is still on this one


def test_it_can_still_bite_itself_THROUGH_the_seam():
    """The trap in a wrapping world: the head at x=0.1 and its own body at x=23.9 are a
    fifth of a unit apart on a torus, and twenty-three units apart if you forget that.
    Forget it, and a snake can hide from itself by standing on the seam."""
    game = seat()
    snake = game.snakes[0]

    # A body lying right along the seam, and a head about to run into it from the far
    # side. In flat coordinates these are a whole board apart.
    snake.strokes = [[[0.6, 12.0], [3.0, 12.0]], [[BOARD, 12.0], [BOARD - 3.0, 12.0]]]
    snake.heading = snake.pending = "left"
    snake.length = 6.0
    game.apples = []

    run(game, 2)

    assert not snake.alive, "it walked through the seam and out of its own body"


def test_an_apple_is_eaten_by_running_into_it():
    """The grid's rule was coincidence -- the head's CELL had to be the apple's cell.
    There are no cells, so an apple is eaten the way anything is eaten anywhere else."""
    game = seat()
    snake = game.snakes[0]
    x, y = snake.head

    # Half a body-width off the centre line. On a grid this would be a different cell
    # and the snake would sail straight past it.
    game.apples = [[x + 2.0, y + 0.4]]
    run(game, 12)

    assert snake.apples == 1, "it went hungry"


def test_turning_twice_in_a_hurry_does_not_kill_you():
    """The rule the grid gave us for free. Off the grid, turn -- then turn again inside
    your own width -- and the snake is running parallel to itself and inside itself. It
    is geometry, not a bug, and MIN_TURN is the answer every game with a body reaches
    for. Soft: an early turn is REMEMBERED, not refused."""
    game = seat()

    game.apply_move(A, {"dir": "down"})
    run(game, 1)
    game.apply_move(A, {"dir": "left"})  # far too soon: it has barely moved
    run(game, 8)

    assert game.snakes[0].alive, "it turned twice in a hurry and the game killed it"
    assert game.snakes[0].heading == "left", "...and the early turn was forgotten"


def test_a_snake_cannot_turn_straight_back_on_itself():
    game = seat()

    with rejected("snakes.no_reverse"):
        game.apply_move(A, {"dir": "left"})  # it is heading right


def test_solo_is_played_in_the_browser_and_a_shared_game_is_not():
    assert seat(players=(A,)).client_clock
    assert not seat(players=(A, B)).client_clock
