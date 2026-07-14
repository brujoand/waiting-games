"""The contract every game on the platform implements.

The platform owns seats, the start gate and the clock. A game owns its board.

Only three members are required: _apply, _result and public_state. The rest have
defaults that suit a strictly-alternating, perfect-information, reactive game --
so a simple game never has to mention seats, views, phases or ticks.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


class InvalidMove(Exception):
    """Raised when a player submits a move the game cannot accept.

    The message is a stable CODE, never a sentence. The browser owns every
    player-facing word, because the server does not know -- and must not learn --
    what language the player reads.

    Anything the sentence needs travels in `params` and is interpolated on the
    client, where the word order is known. A param may only ever be data that
    needs no translation: a number, an identifier, a player's name. NEVER an
    English noun -- if you find yourself passing one, you want two codes, not one
    param, or the sentence is still English and you have only hidden it.
    """

    def __init__(self, code: str, /, **params: object) -> None:
        # Positional-only, so a game is free to have a param called `code`.
        super().__init__(code)  # str(exc) is the code: logs and tracebacks stay useful
        self.code = code
        self.params = params

    def as_dict(self) -> dict:
        return {"code": self.code, "params": self.params}


@dataclass(frozen=True)
class Result:
    """How a game ended. winner_seat is None for a draw."""

    winner_seat: int | None

    @classmethod
    def draw(cls) -> Result:
        return cls(winner_seat=None)

    @classmethod
    def by_score(cls, scores: list[int]) -> Result:
        """Most points wins; a tie at the top is a draw."""
        best = max(scores)
        leaders = [seat for seat, score in enumerate(scores) if score == best]
        return cls(winner_seat=leaders[0] if len(leaders) == 1 else None)


class Game(ABC):
    """A single round of a game."""

    key: str
    title: str  # this is what the lobby shows
    min_players: int
    max_players: int

    # Real-time games set a tick rate. This is the single field the session reads
    # to decide whether the game needs a clock of its own.
    tick_hz: float | None = None

    def __init__(self) -> None:
        self.players: list[str] = []
        self.turn: int = 0
        self.started: bool = False
        self.over: bool = False
        self.winner: str | None = None

    # -- players ---------------------------------------------------------

    @property
    def realtime(self) -> bool:
        return self.tick_hz is not None

    @property
    def is_full(self) -> bool:
        return len(self.players) >= self.max_players

    @property
    def can_start(self) -> bool:
        """Enough players are seated that the host may start."""
        return not self.started and len(self.players) >= self.min_players

    def seat_of(self, player_id: str) -> int | None:
        """The player's seat, or None for a spectator."""
        try:
            return self.players.index(player_id)
        except ValueError:
            return None

    def add_player(self, player_id: str) -> None:
        if self.started:
            raise InvalidMove("seat.already_started")
        if self.is_full:
            raise InvalidMove("seat.full")
        if player_id in self.players:
            raise InvalidMove("seat.already_joined")
        self.players.append(player_id)

    # -- starting --------------------------------------------------------

    def start(self) -> None:
        """Deal the board. Called once: by the host, or when the game fills up."""
        if self.started:
            raise InvalidMove("seat.already_started")
        if len(self.players) < self.min_players:
            raise InvalidMove("seat.not_enough_players")
        self.started = True
        self._on_start()

    def _on_start(self) -> None:
        """Set up whatever depends on the final player count.

        Snake spawns one snake per seat here and Pong hands out the walls. A
        board game whose board does not depend on the roster needs nothing.
        """

    # -- moves -----------------------------------------------------------

    def apply_move(self, player_id: str, move: dict) -> None:
        """The platform's rules first, then the game's."""
        if self.over:
            raise InvalidMove("move.game_over")
        if not self.started:
            raise InvalidMove("move.not_started")

        seat = self.seat_of(player_id)
        if seat is None:
            raise InvalidMove("move.not_seated")
        if not self._may_move(seat):
            raise InvalidMove("move.not_your_turn")

        self._apply(seat, move)

        # In a real-time game a move is intent, not action: tick() decides when
        # anything actually happens, and when the game ends.
        if self.realtime:
            return

        result = self._result()
        if result is not None:
            self.finish(result)
        else:
            self.turn = self._next_seat(seat)

    def finish(self, result: Result) -> None:
        """End the game. A real-time game calls this from inside tick()."""
        self.over = True
        self.winner = (
            self.players[result.winner_seat] if result.winner_seat is not None else None
        )

    # -- what every game must say ----------------------------------------

    @abstractmethod
    def _apply(self, seat: int, move: dict) -> None:
        """Apply a move the platform has already allowed, or raise InvalidMove."""

    @abstractmethod
    def _result(self) -> Result | None:
        """The outcome, or None while the game is still going."""

    @abstractmethod
    def public_state(self) -> dict:
        """Everything a spectator may see."""

    # -- what a game may say ---------------------------------------------

    def _may_move(self, seat: int) -> bool:
        """Who may move right now. Default: strictly whose turn it is.

        Relax this for a simultaneous phase (both players placing their ships at
        once) or a role that acts outside the turn order (the Hangman setter).
        """
        return seat == self.turn

    def _next_seat(self, seat: int) -> int:
        """Whose turn it is after `seat` moved. Default: the next player.

        Return `seat` to go again (closing a box in Dots and Boxes), or skip a
        seat with no legal move (Othello). _result() has already ruled out the
        case where nobody can move, so there is always someone to hand the turn to.
        """
        return (seat + 1) % len(self.players)

    def view(self, seat: int | None) -> dict:
        """What this seat may see; seat is None for a spectator.

        Default: one board, everybody sees the same. Override for hidden
        information -- and make the SPECTATOR view the most restricted one, since
        any logged-in user may open a game socket and watch.
        """
        return self.public_state()

    def tick(self, dt: float) -> None:
        """Advance the simulation. Only called when tick_hz is set.

        dt is seconds since the previous tick, clamped by the session so a slow
        frame cannot teleport anything through anything. Call finish() to end.
        """


class RealTimeGame(Game):
    """A game with a clock instead of turns.

    Every seated player may act on every tick, and the game ends when tick() says
    so rather than when a move lands.
    """

    tick_hz: float = 15.0

    @property
    def client_clock(self) -> bool:
        """Does the BROWSER run this game's clock, with the server only checking?

        False for anything with more than one player in it. The moment there is a
        second player there is something to arbitrate, and two browsers each certain
        that they were the one who survived is not a game, it is an argument.

        But a game with ONE player is a pure function of its seed and its inputs,
        and it has nobody to disagree with. It does not need to be streamed to the
        player a tick at a time; it needs to be PLAYED by them, with the server
        checking the answer afterwards by running it again.

        That is not a shortcut, it is the only thing that works. Measured on a real
        phone, mid-game: states arrived a median of 168ms apart -- the tick,
        exactly -- with a 90th percentile of 333ms and a worst of 2439ms, and
        nothing dropped at all. Every one was sent on time and then held in the air
        until the radio woke up to listen for it. You cannot steer a game you are
        being told about two seconds late, and no renderer ever written fixes that.
        The packet has to come out of the render loop.

        A game that says True gets no clock from the lobby. It reports what happened
        when it is done, and the engine replays it to find out whether that is true.
        See Snake.run() and the `result` message in main.py.
        """
        return False

    def run(self, moves: list[dict], ticks: int) -> None:
        """Play a run the browser says it played, and find out what really happened.

        Only ever called on a client_clock game. Default: a game that hands its
        clock to the browser must be able to check the browser's homework.
        """
        raise NotImplementedError

    def __init__(self) -> None:
        super().__init__()
        # Which tick this is. The CLOCK advances it -- see lobby._tick_forever --
        # not the game, so a subclass cannot forget to.
        #
        # It is on the wire because the browser cannot otherwise tell one tick
        # from two. A smooth game slides between the states it is sent, and how
        # far to slide depends entirely on how much game time separates them; a
        # state that never arrived (lobby.stream() drops frames at a busy socket,
        # deliberately) is then indistinguishable from a state that is merely
        # late. Guessing that from arrival times is what made Snake teleport.
        self.ticks: int = 0

    def _may_move(self, seat: int) -> bool:
        return True

    def _result(self) -> Result | None:
        """Never consulted -- apply_move returns early for a real-time game, and
        tick() ends it by calling finish(). It exists only so that Snake and
        Pong do not each have to stub out an abstract method that means nothing
        to them."""
        return None
