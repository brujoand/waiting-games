"""Gris: collect four of a kind, then touch your nose and say nothing.

Everyone holds four cards and passes one to the left, all at the same time. The
deck holds exactly one rank per player, so somebody always CAN get four of a
kind -- the cards are all there, they are just in the wrong hands.

The moment you have four of a kind you touch your nose. You do not announce it.
Everyone else is watching their own cards, and the last of them to notice takes a
letter: G, R, I, S. Spell the word and you are the pig.

The race is the game, and it is why touching is legal for a player with nothing:
once ANY nose is touched, the rest may pile on without four of a kind, and the
slowest one still pays. Touch first with nothing, though, and you have false
started -- that costs the letter on the spot, and it is the only thing keeping a
player from simply hammering the button every round.

The round therefore ends WITHOUT a clock, which is the whole reason this game
needs none. When every seat but one has touched, the one left over has lost by
arithmetic: there is no move left for them to make and no deadline to wait for.
A player who has wandered off loses the round rather than hanging it.
"""

from __future__ import annotations

import random

from .base import Game, InvalidMove, Result

# The word you are spelling, one letter per round you lose. Four of them, which is
# why LETTERS is not a number you may change without changing the name of the game.
WORD = "GRIS"
LETTERS = len(WORD)

HAND = 4  # four cards, and four of a kind, are the same four
SUITS = "SHDC"

# One rank per player, dealt four ways. Every rank is a single character so the
# rank of a card is card[0] -- hence "T" for the ten, which is the only rank that
# would otherwise need two. Ordered high-to-low, so a three-player deck is aces,
# kings and queens rather than an arbitrary slice of the middle.
RANKS = "AKQJT987"


def deck_for(players: int) -> list[str]:
    """A deck with exactly one rank per player: 4 x N cards, N ranks."""
    return [rank + suit for rank in RANKS[:players] for suit in SUITS]


class Gris(Game):
    key = "gris"
    title = "Gris"
    category = "cards"
    # Two would work mechanically -- passing left is just swapping -- but it is not
    # this game: with one opponent there is nobody to out-notice, and the nose race
    # collapses into who clicks first.
    min_players = 3
    max_players = len(RANKS)

    def __init__(self) -> None:
        super().__init__()
        self.rng = random.Random()
        self.round = 0
        self.hands: list[list[str]] = []
        # The card a seat has committed to pass, hidden until every seat has one.
        self.chosen: list[str | None] = []
        # Seats that have touched, IN ORDER. The order is the entire point.
        self.touched: list[int] = []
        # Who actually had four of a kind and started the race. None until they do.
        self.caught: int | None = None
        self.letters: list[int] = []
        # How the last round ended, so the table can see why somebody just took a
        # letter. None before the first one ends.
        self.last: dict | None = None

    def _on_start(self) -> None:
        self.letters = [0] * len(self.players)
        self._deal()

    def _deal(self) -> None:
        cards = deck_for(len(self.players))
        self.rng.shuffle(cards)
        self.hands = [
            cards[seat * HAND : (seat + 1) * HAND] for seat in range(len(self.players))
        ]
        self.chosen = [None] * len(self.players)
        self.touched = []
        self.caught = None
        self.round += 1

    # -- moves -----------------------------------------------------------

    def _may_move(self, seat: int) -> bool:
        """Everyone at once. Nobody waits for a turn in this game."""
        return True

    def _next_seat(self, seat: int) -> int:
        """There is no next seat: every seat is always live. Leave `turn` where it
        is rather than marching it around a table that is not taking turns."""
        return self.turn

    def _apply(self, seat: int, move: dict) -> None:
        if move.get("touch") is True:
            self._touch(seat)
        elif "card" in move:
            self._pass(seat, move["card"])
        else:
            raise InvalidMove("gris.no_move")

    def _pass(self, seat: int, card: object) -> None:
        # Once a nose is up the deal is over and the only thing left to do is race.
        if self.touched:
            raise InvalidMove("gris.hands_are_up")
        if self.chosen[seat] is not None:
            raise InvalidMove("gris.already_passed")
        # bool first: bool is an int, and "SH" in hand would be a TypeError anyway.
        if not isinstance(card, str) or card not in self.hands[seat]:
            raise InvalidMove("gris.not_your_card")

        self.chosen[seat] = card
        if all(chosen is not None for chosen in self.chosen):
            self._pass_left()

    def _pass_left(self) -> None:
        """Every seat gives up its card, and only then does anyone receive one.

        Two loops rather than one, so the swap is simultaneous by construction. It
        happens that one loop would give the same answer today -- every card in the
        deck is unique, so `remove` can never take the wrong one -- but that is a
        property of the deck, not of the passing, and it is not the sort of thing
        this function should be quietly relying on.
        """
        going = list(self.chosen)
        for seat, card in enumerate(going):
            self.hands[seat].remove(card)
        for seat, card in enumerate(going):
            self.hands[(seat + 1) % len(self.players)].append(card)
        self.chosen = [None] * len(self.players)

    def _touch(self, seat: int) -> None:
        if seat in self.touched:
            raise InvalidMove("gris.already_touched")

        # Legal if somebody has already gone -- copying is the point -- or if you
        # have the cards to start it yourself.
        if not self.touched:
            if not self._has_four(seat):
                # A false start. Nobody had anything, and you moved first.
                self._end_round(loser=seat, reason="false_start")
                return
            self.caught = seat

        self.touched.append(seat)

        # Everybody but one. The one is the slowest, and they never had to press a
        # thing for us to know it.
        if len(self.touched) == len(self.players) - 1:
            slowest = next(
                seat for seat in range(len(self.players)) if seat not in self.touched
            )
            self._end_round(loser=slowest, reason="slow")

    def _has_four(self, seat: int) -> bool:
        return len({card[0] for card in self.hands[seat]}) == 1

    def _end_round(self, loser: int, reason: str) -> None:
        self.letters[loser] += 1
        self.last = {"loser": loser, "reason": reason, "caught": self.caught}
        # Don't deal a fresh hand over the top of a finished game -- _result is
        # about to end it, and the final view should show the cards it ended on.
        if self.letters[loser] < LETTERS:
            self._deal()

    # -- outcome ---------------------------------------------------------

    def _result(self) -> Result | None:
        if not any(count >= LETTERS for count in self.letters):
            return None
        # Fewest letters wins; the pig has the most and so is last by construction.
        # A tie at the top is a draw, which is the honest answer when two players
        # got through the whole game equally unscathed.
        return Result.by_score([-count for count in self.letters])

    def _pig(self) -> int | None:
        return next(
            (seat for seat, count in enumerate(self.letters) if count >= LETTERS), None
        )

    # -- what the table can see ------------------------------------------

    def _named(self, seats: list[int]) -> list[str]:
        return [self.players[seat] for seat in seats]

    def public_state(self) -> dict:
        pig = self._pig()
        last = self.last and {
            "loser": self.players[self.last["loser"]],
            "reason": self.last["reason"],
            "caught": (
                None
                if self.last["caught"] is None
                else self.players[self.last["caught"]]
            ),
        }
        return {
            "round": self.round,
            "word": WORD,
            # Keyed by player, not seat, and this is the score: it is how close each
            # of them is to being the pig. Zero for everyone before the first deal:
            # the lobby broadcasts this board the moment the session exists, which is
            # before start() has sized `letters`, so a seat past its end has simply
            # not lost anything yet.
            "counts": {
                player: self.letters[seat] if seat < len(self.letters) else 0
                for seat, player in enumerate(self.players)
            },
            # THAT you have committed a card, never WHICH. Everyone can see a card
            # face-down on the table.
            "passed": self._named(
                [seat for seat, card in enumerate(self.chosen) if card is not None]
            ),
            # In order. A nose is a public thing.
            "touched": self._named(self.touched),
            "caught": None if self.caught is None else self.players[self.caught],
            "last": last,
            "pig": None if pig is None else self.players[pig],
        }

    def view(self, seat: int | None) -> dict:
        """Your cards are yours. A spectator sees no hand at all -- and neither does
        a player see anyone else's, which is what makes noticing the game."""
        state = self.public_state()
        # `started`, not `seat is not None`: before the deal there are no hands to
        # index, and the lobby shows a seated player this board before start() has
        # dealt one -- so a seat would index an empty list, the same IndexError.
        if seat is not None and self.started:
            state["hand"] = list(self.hands[seat])
            state["chosen"] = self.chosen[seat]
            # The server already knows; making the browser re-derive it would be a
            # second rulebook for no reason.
            state["four"] = self._has_four(seat)
        return state
