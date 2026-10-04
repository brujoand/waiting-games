"""A robot in an empty seat, so that one person can play a game for two.

Eleven of these games need somebody else, and the name on the door is Waiting
Games: the usual state of a player is alone. A robot is a seat like any other --
it is in the engine's `players`, it moves through `apply_move`, it is refused
exactly what a person would be refused -- and the only thing that differs is where
its move comes from.

**The model never writes a move. It picks one.** A game that seats robots can list
every legal move (`Game.legal_moves`); the model is shown what its seat may see
(`view(seat)`, so a robot at Battleship knows no more than a person would) and
that list, numbered, and is asked for a number. Whatever it says, we read the
first integer out of it and look it up. A model that rambles, refuses, hallucinates
a square or has been talked into something by a word on the board has one way to
hurt anybody, which is to play badly.

And it will play badly. A language model loses Connect Four to thirty lines of
minimax. That is not what it is for: it is for the seat being FILLED.

**No model, no answer, a bad answer: the robot moves anyway**, at random among
the legal moves. A table must never be left waiting on a GPU.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
import re
import time

from .games import Game, InvalidMove
from .llm import LLM, LLMUnavailable
from .lobby import Lobby, Session

log = logging.getLogger(__name__)

# A robot that answers in the same instant the board arrives reads as a glitch,
# not as an opponent: the player's own piece and the reply land in one frame and
# they cannot see what happened. This is the least a move may take.
THINK_PAUSE = 0.7

# A move refused this many times running means legal_moves and _apply disagree,
# which is a bug in a game and not something trying again will fix. Stop, rather
# than spin a task on it for as long as the session lives.
MAX_REFUSALS = 3

SYSTEM = (
    "You are playing a game against people. You are told the game, what your seat "
    "can see of it, and a numbered list of every move you are allowed to make. "
    "Reply with the number of the move you choose, and nothing else."
)

# Bounded: no game offers ten thousand moves, and int() of an unbounded run of
# digits is a ValueError waiting for a model that ignores max_tokens.
NUMBER = re.compile(r"\d{1,4}")


def prompt(engine: Game, seat: int, moves: list[dict]) -> str:
    """What the model is shown. `view(seat)`, not the engine: the robot gets its own
    seat's view of a game with secrets in it, and not one field more.

    No display names are in here: a view names players by sub. The only text a
    player wrote that can reach the model is a Hangman word, which is letters of
    the alphabet and nothing else -- and what the model says back is read for a
    number, so there is nothing for a clever word to win.
    """
    listing = "\n".join(f"{n}: {json.dumps(move)}" for n, move in enumerate(moves))
    return (
        f"Game: {engine.title}\n"
        f"{engine.brief}\n"
        f"You are {engine.players[seat]}.\n\n"
        f"What you can see:\n{json.dumps(engine.view(seat))}\n\n"
        f"Your moves:\n{listing}"
    )


def chosen(reply: str, count: int) -> int | None:
    """The move a reply names, or None if it names none we offered."""
    match = NUMBER.search(reply)
    if match is None:
        return None
    index = int(match.group())
    return index if index < count else None


class Bots:
    def __init__(
        self,
        lobby: Lobby,
        llm: LLM | None,
        *,
        pause: float = THINK_PAUSE,
        rng: random.Random | None = None,
    ) -> None:
        self.lobby = lobby
        self.llm = llm
        self.pause = pause
        self.rng = rng or random.Random()  # noqa: S311 -- a move, not a secret
        lobby.after_change = self.nudge

    def _bot_to_move(self, session: Session) -> int | None:
        """The seat of a robot that may move right now, if there is one."""
        engine = session.engine
        if not engine.started or engine.over:
            return None
        for seat, sub in enumerate(engine.players):
            if sub in session.bots and engine._may_move(seat):
                return seat
        return None

    def nudge(self, session: Session) -> None:
        """A board just changed. If that left a robot to move, set it thinking.

        One task per session, and it plays until no robot has a move left -- so a
        nudge that arrives while it is running (including the one its own
        broadcast causes) has nothing to do.
        """
        if not session.bots:
            return
        if session.bot_task is not None and not session.bot_task.done():
            return
        if self._bot_to_move(session) is None:
            return
        session.bot_task = asyncio.create_task(self._play(session))

    async def _play(self, session: Session) -> None:
        refusals = 0
        while (seat := self._bot_to_move(session)) is not None:
            engine = session.engine
            moves = engine.legal_moves(seat)
            if not moves:
                log.error("%s lets a seat move and offers it no move", engine.key)
                return

            move = await self._choose(engine, seat, moves)

            # Seconds have passed. A rematch swaps the engine, and a simultaneous
            # phase lets a person move while we were thinking -- so the move is
            # tried, not trusted, against whatever the board is NOW.
            if session.engine is not engine:
                continue
            async with session.lock:
                try:
                    engine.apply_move(engine.players[seat], move)
                except InvalidMove:
                    refusals += 1
                    if refusals >= MAX_REFUSALS:
                        log.error("%s refuses its own legal moves", engine.key)
                        return
                    continue
                refusals = 0
                final = engine.over
                frames = session.frames()

            # Outside the lock, exactly as the socket handler does it.
            await self.lobby.fanout(session, frames)
            if final:
                await self.lobby.broadcast_lobby()

    async def _choose(self, engine: Game, seat: int, moves: list[dict]) -> dict:
        began = time.monotonic()
        move = self.rng.choice(moves)

        # One legal move is not a question worth a GPU's time.
        if self.llm is not None and len(moves) > 1:
            try:
                reply = await self.llm.ask(
                    SYSTEM, prompt(engine, seat, moves), max_tokens=8
                )
            except LLMUnavailable as exc:
                log.warning("the model did not move, so the robot did: %s", exc)
            else:
                index = chosen(reply, len(moves))
                if index is not None:
                    move = moves[index]

        remaining = self.pause - (time.monotonic() - began)
        if remaining > 0:
            await asyncio.sleep(remaining)
        return move
