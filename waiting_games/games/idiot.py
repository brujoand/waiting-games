"""Idiot: get rid of your cards. The last player still holding any is the idiot.

Nine cards each: three face down (never seen, not even by their owner), three
face up on top of them, three in hand. Play onto a shared pile, always at least
as high as the card on top of it. Cannot play? Pick the whole pile up. Run out of
hand and deck and you play your face-up cards; run out of those and you turn your
face-down ones over one at a time and hope.

Four things the platform has to be told about:

  * a HAND is a secret and a face-down card is a secret from EVERYONE, so view()
    hands out counts rather than cards -- and the spectator, who is the case people
    forget, sees no hand at all;
  * the deal is not a turn order: everybody swaps and presses Ready at once, which
    is what _may_move is for;
  * burning the pile means you go AGAIN, which is _next_seat returning the seat it
    was given -- the same hook Dots and Boxes uses to close a box;
  * a player who has gone out is skipped, which is the same hook again.

The specials are few and they are what makes the game: a 2 plays on anything and
resets the pile, a 10 burns it out of the game, and a fourth card of the same rank
landing on top of the pile burns it too. A LADDER is the house rule: cards that
climb -- 7,7,8,9,J -- go down in one turn. Ten is not a rung, because a ten does
not land on a pile, it destroys one.
"""

from __future__ import annotations

import random
from dataclasses import dataclass

from .base import Game, InvalidMove, Result

# The rank as a value, because this whole game is a comparison: a jack is 11 and
# beats a ten, and an ace is 14 and beats everything. The ten is a T so that a card
# is always two characters -- which is the same card vocabulary Gris speaks, and one
# server needs only one. See static/games/_cards.js, which draws both.
RANKS = "23456789TJQKA"
SUITS = "SHDC"

RESET = 2  # plays on anything, and the next player may then play anything
BURN = 10  # takes the pile out of the game, and you play again
BURN_RUN = 4  # ...and so does a fourth of a kind coming to rest on top of it

# The rungs of a ladder, in order. Everything a ladder may contain, and nothing
# else: a 2 is played alone (it is a reset, not a rank), and a 10 burns rather
# than lands -- so a ladder steps straight from 9 to the jack.
LADDER = (3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14)

DEAL = 3  # ...face down, and again face up, and again into the hand

SWAPPING = "swapping"
PLAYING = "playing"

HAND = "hand"
UP = "up"
DOWN = "down"


@dataclass(frozen=True)
class Card:
    rank: int  # 2..14; the jack, queen, king and ace are 11, 12, 13, 14
    suit: str

    @property
    def code(self) -> str:
        """The two characters this card is on the wire: "TH", "AS"."""
        return RANKS[self.rank - 2] + self.suit


def deck() -> list[Card]:
    return [Card(rank, suit) for rank in range(2, 15) for suit in SUITS]


class Idiot(Game):
    key = "idiot"
    title = "Idiot"
    category = "cards"
    min_players = 2
    max_players = 5

    def __init__(self) -> None:
        super().__init__()
        self.phase = SWAPPING
        self.rng = random.Random()
        self.stock: list[Card] = []
        self.hands: list[list[Card]] = []
        self.ups: list[list[Card]] = []
        self.downs: list[list[Card]] = []
        self.pile: list[Card] = []
        self.burnt = 0  # cards burned out of the game; only the count is interesting
        self.ready: list[bool] = []
        self.out: list[int] = []  # seats that have gone out, in the order they did
        self.plays = 0  # moves made in the playing phase -- 0 means nobody has led
        self.again = False  # you burned the pile, so the turn comes back to you
        # What the last move actually was. A card game whose players see only the
        # resulting state is unplayable: a face-down card that missed, and the pile
        # it dragged away with it, would otherwise be a hand that silently grew by
        # nine. Cards and counts only -- never a word.
        self.last: dict | None = None

    def _on_start(self) -> None:
        cards = deck()
        self.rng.shuffle(cards)

        seats = len(self.players)
        self.downs = [[cards.pop() for _ in range(DEAL)] for _ in range(seats)]
        self.ups = [[cards.pop() for _ in range(DEAL)] for _ in range(seats)]
        self.hands = [[cards.pop() for _ in range(DEAL)] for _ in range(seats)]
        self.stock = cards
        self.ready = [False] * seats

    # -- the cards a seat is playing from ---------------------------------

    def source(self, seat: int) -> str:
        """Where this seat plays from right now.

        Your hand until it is empty -- and it cannot be empty while the stock has
        anything in it, because you draw back up to three after every play. Then
        the cards you laid face up, and last of all the ones you have never seen.
        """
        if self.hands[seat]:
            return HAND
        if self.ups[seat]:
            return UP
        return DOWN

    def _pile_of(self, seat: int, source: str) -> list[Card]:
        return {HAND: self.hands, UP: self.ups, DOWN: self.downs}[source][seat]

    def _finished(self, seat: int) -> bool:
        """Nothing left anywhere: this seat is out, and safe."""
        return not (self.hands[seat] or self.ups[seat] or self.downs[seat])

    # -- what may be played -----------------------------------------------

    @property
    def top(self) -> Card | None:
        return self.pile[-1] if self.pile else None

    def beats(self, card: Card) -> bool:
        """May this card be laid on the pile as it stands?

        A 2 and a 10 always may -- one resets the pile and the other destroys it,
        and neither is really a rank. Everything else must be at least as high as
        the card it lands on. A 2 on top is therefore not a special case: it is
        the lowest card there is, so everything clears it.
        """
        if card.rank in (RESET, BURN):
            return True
        return self.top is None or card.rank >= self.top.rank

    def _combines(self, cards: list[Card]) -> bool:
        """Is this a legal handful: one rank, or a ladder?"""
        ranks = sorted(card.rank for card in cards)

        if len(set(ranks)) == 1:
            return True  # a group of the same rank, however many

        # A ladder. Duplicates are allowed on any rung (7,7,8,9,J) but a special
        # is not a rung at all, so a 2 or a 10 in here is not a ladder, it is a
        # mistake.
        if any(rank in (RESET, BURN) for rank in ranks):
            return False

        rungs = [LADDER.index(rank) for rank in sorted(set(ranks))]
        return rungs == list(range(rungs[0], rungs[0] + len(rungs)))

    def _can_play(self, seat: int) -> bool:
        """Is there anything at all this seat could put down?

        A single card is always a legal handful, so it is enough to ask whether
        any ONE of them beats the pile. Playing blind is the exception: you never
        know what you are about to turn over, so there is always something to try.
        """
        source = self.source(seat)
        if source == DOWN:
            return True
        return any(self.beats(card) for card in self._pile_of(seat, source))

    # -- the platform's hooks ---------------------------------------------

    def _may_move(self, seat: int) -> bool:
        if self.phase == SWAPPING:
            # Everybody rearranges their own three cards at once. Nobody is
            # waiting for anybody, so there is no turn order to be out of.
            return not self.ready[seat]
        return seat == self.turn

    def _next_seat(self, seat: int) -> int:
        if self.phase == SWAPPING:
            return self.turn

        # The deal is done and nobody has led yet. Without this the lead would
        # fall to whoever pressed Ready last, since the platform hands the turn to
        # whoever moved most recently.
        if self.plays == 0:
            return 0

        # You burned the pile, so it is yours again -- unless that was your last
        # card, in which case you are out and it is nobody's.
        if self.again and not self._finished(seat):
            return seat

        nxt = (seat + 1) % len(self.players)
        while self._finished(nxt):  # a player who is out is not asked to play
            nxt = (nxt + 1) % len(self.players)
        return nxt

    def _apply(self, seat: int, move: dict) -> None:
        if self.phase == SWAPPING:
            self._deal_move(seat, move)
            return

        if move.get("action") == "pickup":
            self._pick_up(seat)
        elif "cards" in move:
            self._play(seat, move)
        else:
            raise InvalidMove("idiot.unknown_action")

        # Only now: a move that was refused must leave nothing behind it, and
        # every path above either raises or lands, never both.
        self.plays += 1
        if self._finished(seat) and seat not in self.out:
            self.out.append(seat)

    def _result(self) -> Result | None:
        if self.phase != PLAYING or not self.out:
            return None

        holding = [
            seat for seat in range(len(self.players)) if not self._finished(seat)
        ]
        if len(holding) > 1:
            return None  # still a game: more than one player is holding cards

        # One player left with cards in their hands. They are the idiot, and the
        # first one out is the winner -- which is all the platform can record.
        return Result(winner_seat=self.out[0])

    # -- the deal ----------------------------------------------------------

    def _deal_move(self, seat: int, move: dict) -> None:
        action = move.get("action")

        if action == "swap":
            hand = self._index(move.get("hand"), self.hands[seat])
            up = self._index(move.get("up"), self.ups[seat])
            self.hands[seat][hand], self.ups[seat][up] = (
                self.ups[seat][up],
                self.hands[seat][hand],
            )
            return

        if action == "ready":
            self.ready[seat] = True
            if all(self.ready):
                self.phase = PLAYING  # _next_seat hands the lead to seat 0
            return

        raise InvalidMove("idiot.unknown_action")

    @staticmethod
    def _index(value: object, cards: list[Card]) -> int:
        if isinstance(value, bool) or not isinstance(value, int):
            raise InvalidMove("idiot.no_such_card")
        if not 0 <= value < len(cards):
            raise InvalidMove("idiot.no_such_card")
        return value

    # -- playing -----------------------------------------------------------

    def _play(self, seat: int, move: dict) -> None:
        source = self.source(seat)
        held = self._pile_of(seat, source)

        chosen = move.get("cards")
        if not isinstance(chosen, list) or not chosen:
            raise InvalidMove("idiot.no_such_card")

        # Validate each one BEFORE looking for duplicates. The other way round,
        # set() is handed whatever arrived over the socket, and an unhashable thing
        # in that list -- {"cards": [{}]} -- is a TypeError rather than a refusal.
        picked = [self._index(index, held) for index in chosen]
        if len(set(picked)) != len(picked):
            raise InvalidMove("idiot.no_such_card")  # the same card twice

        if source == DOWN:
            # You do not choose a face-down card, you choose WHICH ONE, and you
            # find out what it was at the same moment everybody else does.
            if len(picked) != 1:
                raise InvalidMove("idiot.one_blind_card")
            self._blind(seat, picked[0])
            return

        cards = [held[index] for index in picked]
        if not self._combines(cards):
            raise InvalidMove("idiot.bad_combination")

        # A ladder only climbs, so it is enough that its lowest card clears the
        # pile -- and for a group of one rank, its lowest card IS the rank.
        #
        # No param says WHICH card it failed against. The rank would have to travel
        # as a number, and 13 is not what a Norwegian player calls that card -- the
        # label is translated in the browser (card.rank.k), and a param cannot be.
        # The pile is on the screen in front of them anyway.
        lowest = min(cards, key=lambda card: card.rank)
        if not self.beats(lowest):
            raise InvalidMove("idiot.too_low")

        for index in sorted(picked, reverse=True):
            held.pop(index)
        self._lay(seat, cards)

        if source == HAND:
            self._draw(seat)

    def _lay(self, seat: int, cards: list[Card]) -> None:
        """Put a legal handful on the pile, lowest first, and see if it burns."""
        self.pile.extend(sorted(cards, key=lambda card: card.rank))

        burned = self._burns()
        if burned:
            self.burnt += len(self.pile)
            self.pile = []

        # The pile is gone, so the turn is still yours -- and if it is not, this is
        # where the LAST burn stops being true.
        self.again = burned

        self.last = {
            "player": self.players[seat],
            "played": [card.code for card in cards],
            "burned": burned,
            "picked": 0,
        }

    def _burns(self) -> bool:
        if not self.pile:
            return False
        if self.pile[-1].rank == BURN:
            return True
        top = self.pile[-BURN_RUN:]
        return len(top) == BURN_RUN and len({card.rank for card in top}) == 1

    def _draw(self, seat: int) -> None:
        while self.stock and len(self.hands[seat]) < DEAL:
            self.hands[seat].append(self.stock.pop())

    def _blind(self, seat: int, index: int) -> None:
        card = self.downs[seat].pop(index)

        if self.beats(card):
            self._lay(seat, [card])
            return

        # It missed. The card goes on the pile all the same, and then the whole
        # pile -- it included -- comes back to you.
        self.pile.append(card)
        picked = len(self.pile)
        self.hands[seat].extend(self.pile)
        self.pile = []
        self.again = False

        self.last = {
            "player": self.players[seat],
            "played": [card.code],
            "burned": False,
            "picked": picked,
        }

    def _pick_up(self, seat: int) -> None:
        if not self.pile:
            raise InvalidMove("idiot.pile_empty")
        if self._can_play(seat):
            raise InvalidMove("idiot.must_play")

        picked = len(self.pile)
        self.hands[seat].extend(self.pile)
        self.pile = []
        self.again = False

        self.last = {
            "player": self.players[seat],
            "played": [],
            "burned": False,
            "picked": picked,
        }

    # -- what each seat may see -------------------------------------------

    def public_state(self) -> dict:
        """The SPECTATOR view, and the base every other view is built from.

        Not one hand card is in here, and not one face-down card -- those are not
        in ANY view, since their own owner has not seen them either. This is what
        a spectator gets, so it has to be the strictest view in the game: any
        logged-in user may open a game socket and watch.
        """
        if not self.started:
            return {"phase": self.phase, "pile": [], "stock": 0, "burnt": 0}

        return {
            "phase": self.phase,
            # Public, all of it: every card on the pile was played face up, and
            # everybody watched it land.
            "pile": [card.code for card in self.pile],
            "stock": len(self.stock),
            "burnt": self.burnt,
            "ready": {
                player: self.ready[seat] for seat, player in enumerate(self.players)
            },
            # Seat order, which is turn order. The platform's playerNames is a map
            # and a map has no seats in it, so without this the table would be laid
            # out in whatever order the browser happened to iterate.
            "order": list(self.players),
            "table": {
                player: {
                    "up": [card.code for card in self.ups[seat]],
                    # Counts, not cards. What is in a hand is that player's
                    # business, and what is face down is nobody's.
                    "hand": len(self.hands[seat]),
                    "down": len(self.downs[seat]),
                    "source": self.source(seat),
                    "out": self._finished(seat),
                }
                for seat, player in enumerate(self.players)
            },
            "finished": [self.players[seat] for seat in self.out],
            # The name of the game, and the one thing the platform cannot record:
            # Result has a winner in it, and the winner is whoever got out first.
            # The player still holding cards when the music stops is the point.
            "idiot": self.idiot,
            "last": self.last,
        }

    @property
    def idiot(self) -> str | None:
        """The player left holding cards. Nobody, until the game is over."""
        if not self.over:
            return None
        still = [seat for seat in range(len(self.players)) if not self._finished(seat)]
        return self.players[still[0]] if len(still) == 1 else None

    def view(self, seat: int | None) -> dict:
        state = self.public_state()
        if seat is None or not self.started:
            return state  # a spectator holds no cards, so they see none

        # ...and a player sees exactly one hand: their own. Their face-down cards
        # are not here either -- they are a secret from the player who is holding
        # them, which is the entire point of them.
        state["hand"] = [card.code for card in self.hands[seat]]
        return state
