"""A solo game is played in the browser and CHECKED here.

Which means the server has to be able to check it, has to refuse to be lied to
about the things that matter, and must not quietly simulate the same game a second
time behind the player's back. Those are the three things that can go wrong, and
they are the three things below.
"""

from __future__ import annotations

import pytest
from conftest import Watcher

from waiting_games.games.snake import HEIGHT, WIDTH, Snake
from waiting_games.lobby import Lobby, Player

A, B = "u-alice", "u-bob"
ALICE = Player(sub=A, name="alice")
BOB = Player(sub=B, name="bob")


def solo() -> Snake:
    game = Snake(seed=4242)
    game.add_player(A)
    game.start()
    return game


def test_a_solo_game_hands_its_clock_to_the_browser_and_a_shared_one_does_not():
    """The whole rule, and the reason for it. One snake is a pure function of its
    seed and its inputs and has nobody to disagree with, so the browser can simply
    play it -- which is the only way a phone gets a playable game, because its radio
    delivers our ticks a median of 168ms and a worst of 2439ms apart.

    Two snakes have a collision to arbitrate. That is the server's job and nobody
    else's: two browsers each certain they were the one who survived is not a game,
    it is an argument."""
    lobby = Lobby()

    alone = lobby.create("snake", ALICE)
    lobby.begin(alone.id, ALICE)
    assert alone.engine.client_clock

    together = lobby.create("snake", ALICE)
    lobby.join(together.id, BOB)
    lobby.begin(together.id, ALICE)
    assert not together.engine.client_clock


def test_the_seed_is_on_the_wire_because_the_browser_needs_it():
    """It is not a secret. It IS the game -- and the browser cannot grow the same
    apples in the same cells without it, which means it cannot play the same game
    the server is about to replay."""
    game = solo()
    assert game.public_state()["seed"] == 4242

    # ...and `clientClock` is the PLATFORM's word, not the game's: whether the
    # browser turns the handle is the lobby's business, exactly as the tick and the
    # tick rate are. A game that had to remember to announce it could forget.
    lobby = Lobby()
    session = lobby.create("snake", ALICE)
    lobby.begin(session.id, ALICE)
    assert session.state(seat=0)["clientClock"] is True
    assert session.state(seat=0)["seed"] is not None


def test_the_server_replays_the_run_rather_than_believing_it():
    """The safety of the whole design, and it is arithmetic rather than trust: the
    run is a pure function of (seed, moves, ticks). We issued the seed. So play it
    again and look at the board."""
    honest = solo()
    honest.run([{"tick": 2, "dir": "down"}, {"tick": 8, "dir": "right"}], 30)

    twice = solo()
    twice.run([{"tick": 2, "dir": "down"}, {"tick": 8, "dir": "right"}], 30)

    assert honest.public_state() == twice.public_state()


def test_a_client_cannot_talk_its_score_up():
    """It reports its moves, not its result. Whatever it CLAIMS happened is never
    read -- the board that comes out of the replay is the board, and the length of
    the snake in it is the score."""
    game = solo()
    game.run([], 6)  # six ticks straight, eating nothing

    # There is no field it could have inflated: the state is derived, every time.
    assert len(game.snakes[0].cells) == 3  # it never ate, so it never grew
    assert game.snakes[0].alive


def test_a_run_that_walks_into_the_wall_ends_the_game_here_too():
    """The browser saw itself die. The server has to reach the same verdict from the
    same moves, or the player is looking at a game-over the lobby does not believe."""
    game = solo()
    game.run([], WIDTH + 5)  # it starts facing right and nobody turns it

    assert not game.snakes[0].alive
    assert game.over


def test_a_browser_run_game_is_never_ticked_by_the_lobby_as_well():
    """The failure this would be: TWO simulations of one game, one of them half a
    radio behind the other, disagreeing about who died and when. The player would
    watch themselves survive and then be told they had not."""

    async def scenario():
        lobby = Lobby()
        session = lobby.create("snake", ALICE)
        lobby.begin(session.id, ALICE)

        session.sockets.add((A, Watcher()))
        session.note_sockets_changed()
        await lobby.launch(session)

        assert session.tick_task is None, "the browser is already running this game"
        assert session.engine.ticks == 0

    import asyncio

    asyncio.run(scenario())


@pytest.mark.parametrize("ticks", [0, 1, HEIGHT * 4])
def test_replaying_any_number_of_ticks_is_safe(ticks):
    """`ticks` is a loop bound on OUR machine, handed to us by a browser. main.py
    clamps it; the engine must not fall over inside the clamp."""
    game = solo()
    game.run([{"tick": 1, "dir": "up"}], ticks)
    assert game.public_state()["snakes"][0]["cells"]
