"""Snake and Pong, and the clock that drives them.

Every test here drives engine.tick(dt) directly with a FIXED dt. No sleeping, no
wall-clock, no event loop: a real-time game is perfectly deterministic if you
hand it the time yourself, and a test that sleeps is a test that goes flaky on a
loaded CI runner.
"""

from __future__ import annotations

import asyncio

import pytest
from conftest import Watcher, rejected

from waiting_games.games.pong import (
    BALL_RADIUS,
    LIVES,
    PADDLE_HALF,
    PADDLE_THICK,
    Pong,
)
from waiting_games.games.snake import BOARD, SPEED, Snake
from waiting_games.lobby import Lobby, Player

A, B, C = "u-alice", "u-bob", "u-carol"
ALICE = Player(sub=A, name="alice")
BOB = Player(sub=B, name="bob")


def seat(game_class, players=(A, B)):
    game = game_class()
    for player in players:
        game.add_player(player)
    game.start()
    return game


def run(game, ticks, dt=None):
    """Advance the world by a fixed number of frames."""
    step = dt if dt is not None else 1.0 / game.tick_hz
    for _ in range(ticks):
        if game.over:
            return
        game.tick(step)


def staged(game):
    """Let the engine look at a board that a test placed by hand.

    A snake's next move is DECIDED a tick before it is made, and goes out with
    the state -- which is what lets the browser draw the move while it happens
    instead of a cell after it did. So a tick carries out the move worked out at
    the end of the tick before, and a test that rewrites the board behind the
    engine's back has to give it the chance to work one out for the board it now
    actually has.

    Nothing in a real game needs this. Cells only ever move because _execute
    moved them, and _decide runs on the very same tick.
    """
    game._decide()
    return game


# ==========================================================================
# Snake -- off the grid
# ==========================================================================


def test_a_snake_moves_on_its_own_with_no_input_at_all():
    """The whole difference from a turn-based game: the world advances because the
    clock ticked, not because anybody did anything."""
    game = seat(Snake, players=(A,))
    before = list(game.snakes[0].head)

    game.tick(1 / game.tick_hz)

    head = game.snakes[0].head
    assert head[0] > before[0]  # it starts facing right
    assert head[1] == before[1]
    # ...and it moved a REAL distance, not a square. Speed is units per second now,
    # and the tick rate is the network's business rather than the game's.
    assert head[0] - before[0] == pytest.approx(SPEED / game.tick_hz)


def test_steering_takes_effect_at_once():
    """On a grid it could not. A turn had to wait for the next cell boundary, and
    then -- to let the browser draw the move as it happened -- for the one after that.
    Off the grid there is no boundary to wait for: you turn where you are.

    That is not a nicety. It is why a late packet stopped being fatal: a turn arriving
    300ms late now happens 300ms further along the same line, which is a smudge. On the
    grid it happened a whole CELL later, and a cell is the difference between rounding
    the corner and hitting the wall."""
    game = seat(Snake, players=(A,))
    game.apply_move(A, {"dir": "down"})

    assert game.snakes[0].heading == "right"  # not yet: a move is still intent
    game.tick(1 / game.tick_hz)
    assert game.snakes[0].heading == "down"  # ...and the very next tick turns it

    # The path grew a corner exactly where it turned, and nowhere else.
    assert len(game.snakes[0].path) == 3


def test_a_snake_cannot_reverse_into_its_own_neck():
    game = seat(Snake, players=(A,))

    with rejected("snake.no_reverse"):
        game.apply_move(A, {"dir": "left"})  # it is heading right


def test_an_unknown_direction_is_rejected():
    game = seat(Snake, players=(A,))

    with rejected("snake.unknown_direction"):
        game.apply_move(A, {"dir": "sideways"})


def test_turning_twice_in_a_hurry_does_not_kill_you():
    """THE RULE THE GRID GAVE US FOR FREE, and off the grid we have to say out loud.

    On a grid you could only turn on a cell boundary, so two turns put the head a whole
    cell from its own neck and it was never in danger. Off the grid you turn wherever
    you like -- so left, then left again a fraction of a unit later, brings the head
    right alongside the body it just left. Without NECK, the game would kill you for
    turning twice quickly, which is not a rule anybody would call fair."""
    game = seat(Snake, players=(A,))

    game.apply_move(A, {"dir": "down"})
    run(game, 1)
    game.apply_move(A, {"dir": "left"})
    run(game, 3)

    assert game.snakes[0].alive, "it turned twice in a hurry and the game killed it"


def test_a_snake_dies_on_the_wall():
    game = seat(Snake, players=(A,))
    run(game, int(BOARD / SPEED * game.tick_hz) + 5)  # nobody turns it

    assert not game.snakes[0].alive
    assert game.over  # solo: the game ends when you do


def test_an_apple_is_eaten_by_OVERLAP_rather_than_by_landing_on_it():
    """The grid's rule was coincidence: the head's cell had to BE the apple's cell.
    There are no cells now, so an apple is eaten the way anything is eaten anywhere
    else -- by running into it. Put one a little off the line and the snake still gets
    it, because it is wide and so is the apple."""
    game = seat(Snake, players=(A,))
    snake = game.snakes[0]
    length = snake.length

    x, y = snake.head
    # NOT dead ahead: half a body-width off the centre line. On a grid this apple would
    # be in a different cell and the snake would sail straight past it.
    game.apples = [[x + 2.0, y + 0.4]]

    run(game, int(3.0 / SPEED * game.tick_hz))

    assert game.apples and game.apples[0] != [x + 2.0, y + 0.4], "it went hungry"
    run(game, 20)
    assert snake.length > length


def test_the_last_snake_alive_wins():
    game = seat(Snake)  # alice and bob

    game.apply_move(B, {"dir": "up"})  # steer bob into the wall; leave alice alone
    run(game, int(BOARD / SPEED * game.tick_hz))

    assert not game.snakes[1].alive
    assert game.snakes[0].alive
    assert game.over
    assert game.winner == A


def test_two_snakes_meeting_head_on_both_die():
    """Everyone moves before anyone dies, so the snake that happens to be first in the
    list must not win a collision it should have shared."""
    game = seat(Snake)
    alice, bob = game.snakes

    alice.path = [[10.0, 5.0], [7.0, 5.0]]
    alice.heading = alice.pending = "right"
    bob.path = [[11.0, 5.0], [14.0, 5.0]]
    bob.heading = bob.pending = "left"
    game.apples = []

    run(game, 2)

    assert not alice.alive
    assert not bob.alive
    assert game.over
    assert game.winner is None  # a draw: nobody survived


def test_a_snake_dies_on_somebody_else_right_up_to_their_head():
    """Your own neck is forgiven -- see NECK -- and nobody else's is. Theirs can kill
    you all the way to the tip."""
    game = seat(Snake)
    alice, bob = game.snakes

    # A long wall of bob down the board, with somewhere to go -- a snake that steers
    # into the scenery and dies stops blocking, and alice would sail through the corpse.
    bob.path = [[12.0, 14.0], [12.0, 2.0]]
    bob.length = 12.0
    bob.heading = bob.pending = "down"

    alice.path = [[10.5, 7.0], [7.5, 7.0]]  # alice, heading straight into his flank
    alice.heading = alice.pending = "right"
    game.apples = []

    run(game, 6)

    assert not alice.alive, "she ran into him and lived"
    assert bob.alive


def test_solo_never_declares_a_winner():
    game = seat(Snake, players=(A,))
    run(game, int(BOARD / SPEED * game.tick_hz) + 5)

    assert game.over
    assert game.winner is None  # you played against the wall, and the wall won


# ==========================================================================
# Pong
# ==========================================================================


def test_the_ball_moves_on_its_own():
    game = seat(Pong)
    before = list(game.ball)

    run(game, 1)

    assert game.ball != before


def test_seats_claim_walls_in_order_and_the_rest_are_solid():
    two = seat(Pong)
    assert [p.wall for p in two.paddles] == ["left", "right"]
    assert set(two.public_state()["solid"]) == {"top", "bottom"}

    four = seat(Pong, players=(A, B, C, "u-dave"))
    assert [p.wall for p in four.paddles] == ["left", "right", "top", "bottom"]
    assert four.public_state()["solid"] == []


def test_an_undefended_wall_bounces_the_ball_instead_of_conceding():
    """This is what makes two- and three-player Pong work with no special case."""
    game = seat(Pong)  # left and right are defended; top and bottom are not

    game.ball = [0.5, 0.02]
    game.velocity = [0.0, -0.5]  # straight up, into the empty top wall

    run(game, 1)

    assert game.velocity[1] > 0  # bounced back down
    assert all(p.lives == LIVES for p in game.paddles)  # nobody was scored on


def test_a_paddle_saves_the_ball():
    game = seat(Pong)
    left = game.paddles[0]
    left.position = 0.5

    game.ball = [0.02, 0.5]  # dead centre on the left paddle
    game.velocity = [-0.5, 0.0]

    run(game, 1)

    assert game.velocity[0] > 0  # sent back
    assert left.lives == LIVES  # and it cost nothing


def test_missing_the_ball_costs_a_life_and_re_serves():
    game = seat(Pong)
    left = game.paddles[0]
    left.position = 0.9  # right down at the far end of its wall

    game.ball = [0.02, 0.1]  # ...and the ball is up at the other
    game.velocity = [-0.5, 0.0]

    run(game, 1)

    assert left.lives == LIVES - 1
    assert game.ball == [0.5, 0.5]  # back to the middle


def test_running_out_of_lives_puts_you_out_and_your_wall_goes_solid():
    game = seat(Pong)
    left = game.paddles[0]
    left.lives = 1
    left.position = 0.9

    game.ball = [0.02, 0.1]
    game.velocity = [-0.5, 0.0]
    run(game, 1)

    assert left.out
    assert game.over  # only bob is left standing
    assert game.winner == B


def test_the_ball_turns_around_at_the_paddles_face_not_the_wall_behind_it():
    """The paddle is a real slab, and the renderer draws it at exactly the
    thickness the server bounces the ball off. It used to be drawn 2% thick over a
    collision that happened at the wall, so at the moment of contact the ball was
    already buried a third of the way into the bat -- and the ball is big enough
    now that you would see it."""
    game = seat(Pong)
    game.paddles[0].position = 0.5

    game.ball = [0.1, 0.5]  # dead centre on the left paddle, coming in slowly
    game.velocity = [-0.5, 0.0]

    run(game, 6)

    assert game.velocity[0] > 0  # sent back
    assert game.ball[0] >= PADDLE_THICK + BALL_RADIUS - 1e-9, (
        f"the ball got inside the paddle: {game.ball}"
    )


def test_an_undefended_wall_has_no_paddle_to_stand_off_from():
    """A bare wall is bare: the ball meets the wall itself, so it uses the whole
    board. A wall that reserved a paddle's worth of space with no paddle on it
    would be a slab of board that nothing bounces off."""
    game = seat(Pong)  # top and bottom are solid

    game.ball = [0.5, 0.03]
    game.velocity = [0.0, -0.5]

    run(game, 1)  # the tick it crosses on, so the bounce is still where it landed

    assert game.velocity[1] > 0
    assert game.ball[1] == pytest.approx(BALL_RADIUS)


def test_a_paddle_says_when_it_is_being_held():
    """The only feedback a phone gets. You steer by holding a HALF OF THE BOARD,
    nowhere near the paddle, so without this nothing on screen says the press
    landed."""
    game = seat(Pong)

    assert game.public_state()["paddles"][0]["held"] is False

    game.apply_move(A, {"paddle": 1})
    assert game.public_state()["paddles"][0]["held"] is True

    game.apply_move(A, {"paddle": 0})
    assert game.public_state()["paddles"][0]["held"] is False


def test_a_paddle_jammed_against_the_end_of_its_wall_is_still_held():
    """The moment a player most needs telling that the game can hear them: it is
    being held, it cannot move, and a board that shows nothing at all looks like
    one that has stopped listening. So this is the DRIFT, not the movement."""
    game = seat(Pong)
    left = game.paddles[0]

    game.apply_move(A, {"paddle": -1})
    run(game, 200)  # all the way to the end, and then some

    assert left.position == pytest.approx(PADDLE_HALF)  # going nowhere
    assert game.public_state()["paddles"][0]["held"] is True


def test_a_paddle_only_moves_while_it_is_told_to():
    game = seat(Pong)
    left = game.paddles[0]
    start = left.position

    run(game, 5)
    assert left.position == start  # no input, no movement

    game.apply_move(A, {"paddle": 1})
    run(game, 5)
    assert left.position > start

    game.apply_move(A, {"paddle": 0})
    held = left.position
    run(game, 5)
    assert left.position == held  # stopped, and stays stopped


def test_a_paddle_cannot_leave_its_wall():
    game = seat(Pong)
    left = game.paddles[0]

    game.apply_move(A, {"paddle": -1})
    run(game, 200)

    assert left.position == pytest.approx(PADDLE_HALF)


@pytest.mark.parametrize("drift", [2, -2, "up", None, True, 0.5])
def test_bogus_steering_is_rejected(drift):
    game = seat(Pong)

    with rejected("pong.bad_input"):
        game.apply_move(A, {"paddle": drift})


def test_a_ball_in_a_corner_bounces_off_both_walls_at_once():
    """In a corner the ball is past TWO walls. Handling only the first would
    leave it hanging outside the box on the other axis until the next tick."""
    game = seat(Pong)  # left and right defended; top and bottom solid

    # As far up its wall as a paddle can go, so it comfortably covers the corner.
    game.paddles[0].position = PADDLE_HALF
    game.ball = [0.005, 0.005]  # past the left wall AND the top wall
    game.velocity = [-0.3, -0.3]  # still heading further into the corner

    game.tick(1 / game.tick_hz)

    x, y = game.ball
    assert x >= BALL_RADIUS - 1e-9, f"still outside on x: {game.ball}"
    assert y >= BALL_RADIUS - 1e-9, f"still outside on y: {game.ball}"
    assert game.velocity[0] > 0  # bounced off the left paddle
    assert game.velocity[1] > 0  # ...and off the solid top wall


def test_the_ball_never_escapes_the_box():
    """The one that would catch tunnelling: run a long game at the clamped
    worst-case frame time and make sure the ball is always inside."""
    game = seat(Pong, players=(A, B, C, "u-dave"))
    slowest_frame = 3.0 / game.tick_hz  # what lobby.TICK_CATCHUP clamps to

    for _ in range(2000):
        if game.over:
            break
        game.tick(slowest_frame)
        x, y = game.ball
        assert -0.05 <= x <= 1.05, f"ball escaped: {game.ball}"
        assert -0.05 <= y <= 1.05, f"ball escaped: {game.ball}"


# ==========================================================================
# The clock itself
# ==========================================================================


def test_a_real_time_game_gets_a_clock_and_a_turn_based_one_does_not():
    async def scenario():
        lobby = Lobby()

        turn_based = lobby.create("tictactoe", ALICE)
        lobby.join(turn_based.id, BOB)
        await lobby.launch(turn_based)
        assert turn_based.tick_task is None  # no clock: it only moves when you do

        # Solo Snake is played in the BROWSER and checked here, so it is given no
        # clock at all -- see RealTimeGame.client_clock. Two snakes have a collision
        # to arbitrate, so the server keeps the handle.
        solo = lobby.create("snake", ALICE)
        lobby.begin(solo.id, ALICE)
        await lobby.launch(solo)
        assert solo.engine.client_clock
        assert solo.tick_task is None, "a browser-run game must not be simulated twice"

        realtime = lobby.create("snake", ALICE)
        lobby.join(realtime.id, BOB)  # ...and now there is somebody to disagree with
        lobby.begin(realtime.id, ALICE)
        await lobby.launch(realtime)
        assert not realtime.engine.client_clock
        assert realtime.tick_task is not None

        lobby.drop(realtime.id)  # reaping a session must stop its clock
        assert realtime.tick_task.cancelled() or realtime.tick_task.cancelling()

    asyncio.run(scenario())


def test_an_empty_room_parks_the_clock():
    """A game nobody is watching must cost ZERO cpu -- not 'a little'. The loop
    waits on an Event rather than spinning, and a player who reloads the page
    does not come back to a corpse."""

    async def scenario():
        lobby = Lobby()
        session = lobby.create("snake", ALICE)
        lobby.join(session.id, BOB)  # two snakes: the SERVER clocks this one
        lobby.begin(session.id, ALICE)
        await lobby.launch(session)

        # Nobody has ever opened a socket, so the clock is parked from the start.
        assert not session.watchers.is_set()

        # A COPY. `head` is path[0] and the engine advances it in place, so a bare
        # reference would track the snake and compare equal to itself for ever.
        head = list(session.engine.snakes[0].head)
        await asyncio.sleep(0.4)  # several ticks' worth of wall-clock
        assert session.engine.snakes[0].head == head, "it ticked into an empty room"

        # Someone looks: the clock starts, and frames start arriving.
        watcher = Watcher()
        session.sockets.add((A, watcher))
        session.note_sockets_changed()
        assert session.watchers.is_set()

        await asyncio.sleep(0.4)
        assert session.engine.snakes[0].head != head, "it did not resume"
        assert watcher.frames, "it resumed but sent nobody anything"

        lobby.drop(session.id)

    asyncio.run(scenario())


class Sluggish:
    """A socket that never finishes taking a frame. A player on a train."""

    def __init__(self) -> None:
        self.started = 0

    async def send_json(self, message: dict) -> None:
        self.started += 1
        await asyncio.Event().wait()  # never returns


def test_one_slow_player_does_not_freeze_the_room():
    """The clock must not be serialised on the slowest socket. If it were, a
    single flaky connection would stall the simulation for everybody else --
    every tick, for as long as that socket took to fail."""

    async def scenario():
        lobby = Lobby()
        session = lobby.create("snake", ALICE)
        lobby.join(session.id, BOB)  # 2 of 6, so the host starts it
        lobby.begin(session.id, ALICE)
        await lobby.launch(session)

        sluggish, healthy = Sluggish(), Watcher()
        session.sockets.add((A, sluggish))
        session.sockets.add((B, healthy))
        session.note_sockets_changed()

        # Measured in TICKS, not seconds. Snake's tick rate is its difficulty and
        # is tuned when players say so -- it has already been slowed once -- and a
        # test that hardcodes the wall-clock equivalent is one that fails the day
        # somebody does, with a message about frames that says nothing about speed.
        await asyncio.sleep(6 / session.engine.tick_hz)

        # The world kept turning...
        assert session.engine.elapsed > 0.2, "the simulation stalled"
        # ...the healthy player kept getting frames...
        assert len(healthy.frames) >= 3, (
            f"only {len(healthy.frames)} frames got through"
        )
        # ...and the sluggish one was skipped rather than waited on: once a frame
        # is in flight to it, stream() passes it over every tick. Not an exact
        # count -- the connect broadcast and the first tick race to be its first
        # frame, and either may win -- but it must be stuck near the start while
        # the healthy socket keeps up with the clock.
        assert sluggish.started <= 2, (
            f"the slow socket took {sluggish.started} frames; it is being fed, "
            "not skipped"
        )
        assert sluggish.started < len(healthy.frames)

        lobby.drop(session.id)

    asyncio.run(scenario())


def test_a_real_time_state_says_which_tick_it_is():
    """The browser slides a smooth game between the states it is sent, and how far
    to slide depends on how much game time separates them.

    `seconds` cannot answer that: it is rounded to a tenth, and at 8 Hz a tick is
    0.125s, so a one-tick gap and a two-tick gap both round to 0.2. The renderer
    therefore could not tell a state that was merely LATE from one that never
    arrived at all -- and lobby.stream() drops states at a busy socket on purpose.
    Guessing it from arrival times is what used to teleport the snake a whole cell.

    So the platform puts the tick INDEX on the wire, and it is the clock that
    advances it -- not the game, which could forget.
    """

    async def scenario():
        lobby = Lobby()
        session = lobby.create("snake", ALICE)
        lobby.join(session.id, BOB)  # two snakes: the SERVER clocks this one
        lobby.begin(session.id, ALICE)

        state = session.state(seat=0)
        assert state["tick"] == 0
        assert state["tickHz"] == session.engine.tick_hz

        watcher = Watcher()
        session.sockets.add((A, watcher))
        session.note_sockets_changed()
        await lobby.launch(session)
        await asyncio.sleep(0.5)  # a few ticks at 8 Hz

        ticks = [f["data"]["tick"] for f in watcher.frames if "tick" in f["data"]]
        assert ticks, "a real-time state must carry its tick index"
        assert ticks == sorted(ticks), (
            f"the tick index must never go backwards: {ticks}"
        )
        assert ticks[-1] >= 2, f"the clock should have advanced by now: {ticks}"
        # Consecutive, so a hole in what the CLIENT receives means a dropped state
        # rather than a server that skipped a number.
        assert ticks == list(range(ticks[0], ticks[0] + len(ticks))), ticks

        lobby.drop(session.id)

    asyncio.run(scenario())


def test_a_turn_based_game_carries_no_clock_on_the_wire():
    lobby = Lobby()
    session = lobby.create("tictactoe", ALICE)
    lobby.join(session.id, BOB)

    state = session.state(seat=0)
    assert "tick" not in state
    assert "tickHz" not in state
