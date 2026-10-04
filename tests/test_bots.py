"""A robot in an empty seat.

The claim this file exists to hold up is in bots.py: the model never WRITES a
move, it picks one. Everything that makes a language model safe to put at a table
with people follows from that, so it is tested from both ends -- that every move a
game offers is one it accepts, and that whatever the model says, what gets played
is a move off that list.
"""

from __future__ import annotations

import asyncio
import random

import pytest
from conftest import rejected
from fastapi.testclient import TestClient

from waiting_games import main, words
from waiting_games.bots import Bots, chosen, prompt
from waiting_games.games import GAMES, Result
from waiting_games.games.draw import WORDS
from waiting_games.games.hangman import GUESSING, Hangman
from waiting_games.llm import LLMUnavailable
from waiting_games.lobby import Lobby, Player

ALICE = Player(sub="u-alice", name="alice")
BOB = Player(sub="u-bob", name="bob")

BOT_GAMES = [game for game in GAMES.values() if game.bot_capable()]


class FakeModel:
    """Stands where the LLM stands and says what it is told to."""

    def __init__(self, reply: str | Exception = "0", delay: float = 0.0) -> None:
        self.reply = reply
        self.delay = delay
        self.asked: list[str] = []

    async def ask(self, system: str, user: str, **_: object) -> str:
        self.asked.append(user)
        if self.delay:
            await asyncio.sleep(self.delay)
        if isinstance(self.reply, Exception):
            raise self.reply
        return self.reply


def table(lobby: Lobby, key: str = "tictactoe"):
    """Alice's game, with a robot in the next chair, started."""
    session = lobby.create(key, ALICE)
    lobby.add_bot(session.id, ALICE)
    if session.status == "waiting":  # room for more, and nobody else is coming
        lobby.begin(session.id, ALICE)
    return session


async def settle(session) -> None:
    """Let the robot finish whatever the last broadcast set it thinking about."""
    if session.bot_task is not None:
        await session.bot_task


# -- what a game offers a robot ------------------------------------------------


def test_some_games_seat_a_robot():
    """A guard on the guard: a refactor that broke bot_capable() would otherwise
    turn every parametrised test below into zero tests, all of them green."""
    assert {game.key for game in BOT_GAMES} >= {"tictactoe", "hangman", "battleship"}


def test_a_real_time_game_seats_no_robot():
    """A model takes seconds to answer and Pong ticks thirty times in one."""
    assert not [game.key for game in BOT_GAMES if game.tick_hz is not None]


@pytest.mark.parametrize("game_class", BOT_GAMES, ids=lambda game: game.key)
@pytest.mark.parametrize("seed", range(5))
def test_every_legal_move_is_one_the_game_accepts(game_class, seed):
    """The whole of a robot's safety is that it plays off this list, so the list
    has to be TRUE: a move on it that _apply refuses is a robot stuck in its seat
    with the table waiting on it.

    Played to the end, by every seat, on nothing but legal_moves. apply_move
    raising anywhere in here is the failure.
    """
    rng = random.Random(seed)  # noqa: S311
    game = game_class()
    for n in range(game.min_players):
        game.add_player(f"u-{n}")
    game.start()

    for _ in range(2000):
        if game.over:
            return
        seats = [s for s in range(len(game.players)) if game._may_move(s)]
        assert seats, "the game is not over and nobody may move"
        seat = rng.choice(seats)
        moves = game.legal_moves(seat)
        assert moves, "a seat that may move was offered nothing"
        game.apply_move(game.players[seat], rng.choice(moves))

    pytest.fail("two thousand legal moves and the game is still going")


# -- sitting one down ------------------------------------------------------------


def test_a_robot_fills_the_seat_and_the_game_starts():
    lobby = Lobby()
    session = table(lobby)

    assert session.status == "active"
    assert session.summary()["players"] == ["alice", "Robot"]
    assert len(session.bots) == 1


def test_a_robot_is_never_away():
    """It has no socket, and `connected` is what the status line reads to decide
    who the table is waiting for."""
    lobby = Lobby()
    session = table(lobby)

    assert set(session.state(0)["connected"]) == session.bots


def test_only_the_host_adds_a_robot():
    lobby = Lobby()
    session = lobby.create("dotsandboxes", ALICE)
    lobby.join(session.id, BOB)

    with rejected("lobby.not_host"):
        lobby.add_bot(session.id, BOB)


def test_a_full_table_has_no_seat_for_a_robot():
    lobby = Lobby()
    session = table(lobby)

    with rejected("seat.already_started"):
        lobby.add_bot(session.id, ALICE)
    assert len(session.bots) == 1


def test_a_game_that_cannot_list_its_moves_gets_no_robot():
    lobby = Lobby()
    session = lobby.create("pong", ALICE)

    with rejected("lobby.bot_cannot_play"):
        lobby.add_bot(session.id, ALICE)
    assert not session.bots


def test_two_robots_are_told_apart():
    lobby = Lobby()
    session = lobby.create("dotsandboxes", ALICE)
    lobby.add_bot(session.id, ALICE)
    lobby.add_bot(session.id, ALICE)

    assert session.summary()["players"] == ["alice", "Robot", "Robot 2"]


# -- playing ---------------------------------------------------------------------


def test_a_robot_answers_a_move():
    async def scenario():
        lobby = Lobby()
        Bots(lobby, None, pause=0)
        session = table(lobby)

        session.engine.apply_move(ALICE.sub, {"cell": 4})
        await lobby.broadcast_state(session)
        await settle(session)

        board = session.engine.board
        assert board.count("X") == 1 and board.count("O") == 1
        assert session.engine.turn == 0, "it is alice's move again"

    asyncio.run(scenario())


def test_a_robot_that_moves_first_does_not_wait_to_be_asked():
    """Battleship opens with both admirals placing at once, so the robot has a
    move to make the moment it sits down -- before any person has touched the
    game. The broadcast that follows the join is what has to wake it."""

    async def scenario():
        lobby = Lobby()
        Bots(lobby, None, pause=0)
        session = table(lobby, "battleship")

        await lobby.broadcast_state(session)
        await settle(session)

        assert session.engine.ready == [False, True]

    asyncio.run(scenario())


@pytest.mark.parametrize("game_class", BOT_GAMES, ids=lambda game: game.key)
def test_a_person_and_a_robot_can_finish_a_game(game_class):
    async def scenario():
        rng = random.Random(7)  # noqa: S311
        lobby = Lobby()
        Bots(lobby, None, pause=0, rng=rng)
        session = table(lobby, game_class.key)
        await lobby.broadcast_state(session)
        await settle(session)

        for _ in range(2000):
            engine = session.engine
            if engine.over:
                return
            assert engine._may_move(0), "nobody is thinking and it is nobody's turn"
            engine.apply_move(ALICE.sub, rng.choice(engine.legal_moves(0)))
            await lobby.broadcast_state(session)
            await settle(session)

        pytest.fail("the game never ended")

    asyncio.run(scenario())


def test_a_robot_keeps_its_seat_for_the_rematch():
    async def scenario():
        lobby = Lobby()
        Bots(lobby, None, pause=0)
        session = table(lobby)
        session.engine.finish(Result.draw())

        lobby.rematch(session.id, ALICE)
        session.engine.apply_move(ALICE.sub, {"cell": 0})
        await lobby.broadcast_state(session)
        await settle(session)

        assert session.engine.board.count("O") == 1

    asyncio.run(scenario())


def test_closing_the_game_stops_a_robot_mid_thought():
    """The task holds its session. Dropped without being cancelled, it would go on
    asking a model about a game nobody can see for as long as the model took."""

    async def scenario():
        lobby = Lobby()
        Bots(lobby, FakeModel(delay=30), pause=0)
        session = table(lobby)
        session.engine.apply_move(ALICE.sub, {"cell": 4})
        await lobby.broadcast_state(session)
        await asyncio.sleep(0)  # let it start thinking
        assert not session.bot_task.done()

        lobby.drop(session.id)
        with pytest.raises(asyncio.CancelledError):
            await session.bot_task

    asyncio.run(scenario())


# -- what the model is asked, and what is done with what it says ---------------------


def robot_move(model: FakeModel) -> tuple[list, list[dict]]:
    """Alice takes the centre; return the board after the robot's reply, and the
    moves it was choosing from."""

    async def scenario():
        lobby = Lobby()
        Bots(lobby, model, pause=0)
        session = table(lobby)
        session.engine.apply_move(ALICE.sub, {"cell": 4})
        offered = session.engine.legal_moves(1)
        await lobby.broadcast_state(session)
        await settle(session)
        return session.engine.board, offered

    return asyncio.run(scenario())


def test_the_model_picks_the_move_by_number():
    board, offered = robot_move(FakeModel("3"))

    assert board[offered[3]["cell"]] == "O"


@pytest.mark.parametrize(
    "reply",
    [
        "I would rather not play.",
        "99",
        "",
        '{"cell": 4}',  # the square alice is standing on, written out by hand
        LLMUnavailable("down"),
    ],
    ids=["prose", "out of range", "nothing", "a move it wrote itself", "no model"],
)
def test_whatever_the_model_says_the_robot_plays_a_legal_move(reply):
    """This is the property. A reply is read for a number and looked up in the
    list; a reply with no usable number in it costs the robot its choice and
    nothing else, and the table never waits."""
    board, _ = robot_move(FakeModel(reply))

    assert board[4] == "X", "alice's centre is still hers"
    assert board.count("O") == 1


@pytest.mark.parametrize(
    ("reply", "count", "expected"),
    [
        ("2", 5, 2),
        ("Move 2, because it blocks.", 5, 2),
        ("5", 5, None),
        ("none of them", 5, None),
        ("9" * 5000, 5, None),  # int() of this is a ValueError, not a number
    ],
)
def test_a_reply_is_read_for_a_number_and_nothing_else(reply, count, expected):
    assert chosen(reply, count) == expected


def test_a_robot_is_shown_its_own_seat_and_no_more():
    """Hangman, with the robot guessing. The word is the game's one secret, and a
    model that was handed it would be a guesser who had read the answer."""
    game = Hangman()
    game.add_player(ALICE.sub)
    game.add_player("bot-x")
    game.start()
    game.apply_move(ALICE.sub, {"word": "zeppelin"})
    assert game.phase == GUESSING

    text = prompt(game, 1, game.legal_moves(1))

    assert "ZEPPELIN" not in text.upper()


def test_one_legal_move_is_not_a_question_for_the_model():
    async def scenario():
        model = FakeModel()
        lobby = Lobby()
        Bots(lobby, model, pause=0)
        session = table(lobby, "battleship")
        await lobby.broadcast_state(session)
        await settle(session)

        assert session.engine.ready[1]
        assert model.asked == []

    asyncio.run(scenario())


# -- hangman: the robot sets a word --------------------------------------------------


def test_a_robot_sets_a_word_hangman_will_take(monkeypatch):
    """...including from words the model generated, which are in the pool it is
    offered. It picks from a list; it does not get to write one."""
    monkeypatch.setattr(words, "GENERATED", ["zeppelin"])
    game = Hangman()
    game.add_player("bot-x")
    game.add_player(ALICE.sub)
    game.start()

    moves = game.legal_moves(0)
    offered = {move["word"] for move in moves}
    assert len(offered) == len(moves) > 1
    assert offered <= set(words.pool(WORDS))

    game.apply_move("bot-x", moves[0])
    assert game.phase == GUESSING


# -- over HTTP -------------------------------------------------------------------


@pytest.fixture
def client():
    with TestClient(main.app) as client:
        client.post("/api/login", json={"name": "alice"})
        yield client
    main.sessions.players.clear()
    main.sessions.seen.clear()


@pytest.fixture
def robots(monkeypatch):
    """A server that has robots. The real one is built from the environment at
    import, and the test environment has no model in it."""
    monkeypatch.setattr(main.lobby, "after_change", None)
    monkeypatch.setattr(main, "bots", Bots(main.lobby, None, pause=0))


def test_a_server_with_no_model_offers_no_robot(client):
    assert client.get("/api/config").json()["bots"] is False

    session = client.post("/api/sessions", json={"game": "tictactoe"}).json()
    response = client.post(f"/api/sessions/{session['id']}/bot")

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "lobby.no_bots"


def test_the_host_adds_a_robot_over_http(client, robots):
    assert client.get("/api/config").json()["bots"] is True

    session = client.post("/api/sessions", json={"game": "tictactoe"}).json()
    summary = client.post(f"/api/sessions/{session['id']}/bot").json()

    assert summary["status"] == "active"
    assert summary["players"] == ["alice", "Robot"]


def test_the_catalogue_says_which_games_seat_a_robot(client):
    catalogue = {game["key"]: game["bots"] for game in client.get("/api/games").json()}

    assert catalogue["tictactoe"] is True
    assert catalogue["pong"] is False
