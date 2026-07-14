"""Solitaire: Klondike. Seven columns, four foundations, and a stock that comes round.

Turn cards from the stock, build the columns down in alternating colours, and fill
the foundations up from the ace. Get all fifty-two home and you have won.

Three things this game says to the platform, and they are the whole design:

  * The face-down cards are a SECRET, and -- uniquely here -- one kept from the
    PLAYER as much as from anyone watching. Every other secret on this platform
    belongs to somebody: a fleet, a hand, a word, the three cards Idiot has you
    sitting on. This one belongs to nobody, so there is no view() override at all.
    public_state() counts the cards it may not name, and the strictest view is
    therefore the only view.

  * It is solo and it is turn-based, so it has no clock, no tick, and nobody to hand
    the turn to. 2048 is the other one, and it is why the lobby starts a game the
    moment it is full: a one-seat game is full the instant it exists.

  * ONE card is turned at a time, and the stock comes round for ever. That is not the
    Windows game, which turns three, and it is not softness for its own sake -- it
    buys the one thing this engine actually needs. Turning one at a time means every
    card in the stock is REACHABLE, and that makes "there is no move left" something
    the server can COMPUTE rather than something it has to judge. Turn three and two
    cards in every three are unreachable this pass and reachable the next, and a dead
    board becomes an opinion. See _stuck().
"""

from __future__ import annotations

import random

from .base import Game, InvalidMove, Result

# The same two characters every card on this server is written in -- rank then suit,
# the ten a T so that a card is never three wide (see static/games/_cards.js, which
# draws them for every game that deals one).
#
# The ORDER, though, is this game's own, and it has to be. Idiot's ace is the highest
# card in the deck and its RANKS start at the 2; here the ace is a 1, because a
# foundation is built up from one and a column is built down to one. Same fifty-two
# cards, same spelling, opposite ends -- which is why the rank alphabet lives in the
# game rather than in a module all three would have to disagree with.
RANKS = "A23456789TJQK"
SUITS = "SHDC"
RED = "HD"
KING = "K"

COLUMNS = 7


def deck() -> list[str]:
    return [rank + suit for suit in SUITS for rank in RANKS]


CARDS = frozenset(deck())


def value(card: str) -> int:
    """What the card is worth: the ace is 1 and the king is 13."""
    return RANKS.index(card[0]) + 1


def is_red(card: str) -> bool:
    """Colour, which no other game here has ever cared about and this one is half
    made of: a column is built in alternating colours, and that is the rule that
    makes it a puzzle rather than a sort."""
    return card[1] in RED


# The wire. A destination is a column ("t0".."t6"), or simply "f": a card can only
# ever go to the foundation of its own suit, and there is exactly one of those, so
# asking the player WHICH would be asking them for something the card already knows.
# It also means a card dropped on the wrong foundation goes to the right one, which
# is forgiveness for free.
COLUMN = "t"
FOUNDATION = "f"

# Where a card was picked up from.
IN_COLUMN = "column"
IN_WASTE = "waste"
ON_FOUNDATION = "foundation"


class Solitaire(Game):
    key = "solitaire"
    title = "Solitaire"
    min_players = 1
    max_players = 1

    def __init__(self) -> None:
        super().__init__()
        self.rng = random.Random()
        # Face-down, and the LAST card is the next one to be turned.
        self.stock: list[str] = []
        # Face-up, and the last card is the one on top -- the only one in play.
        self.waste: list[str] = []
        # Seven columns, bottom card first. `hidden` says how many of each are still
        # face-down, and they are always the ones at the bottom.
        self.columns: list[list[str]] = []
        self.hidden: list[int] = []
        # One pile per suit, in SUITS order, built up from the ace. A pile holds
        # nothing but its own suit, so its LENGTH is the rank showing on it: four
        # cards on the spades means the 4S is on top. Several rules below are one line
        # because of that.
        self.foundations: list[list[str]] = []
        self.moves = 0
        self.recycles = 0

    def _on_start(self) -> None:
        cards = deck()
        self.rng.shuffle(cards)

        self.columns = []
        self.hidden = []
        for column in range(COLUMNS):
            self.columns.append([cards.pop() for _ in range(column + 1)])
            self.hidden.append(column)  # every card but the top one is face-down

        self.stock = cards
        self.waste = []
        self.foundations = [[] for _ in SUITS]
        self.moves = 0
        self.recycles = 0

    # -- reading the board -------------------------------------------------

    def _up(self, column: int) -> list[str]:
        """The face-up part of a column.

        It is ALWAYS a legal run -- descending, alternating in colour. A card only
        ever arrives in a column by passing _check_column, and a card that is turned
        over arrives alone. So a run picked up from the middle of one needs no
        checking at all: it cannot be anything but legal, and there is no code below
        that checks it.
        """
        return self.columns[column][self.hidden[column] :]

    def _top(self, column: int) -> str | None:
        cards = self.columns[column]
        return cards[-1] if cards else None

    def _fits_column(self, card: str, column: int) -> bool:
        top = self._top(column)
        if top is None:
            return card[0] == KING  # an empty column is a king's, and nobody else's
        return value(card) + 1 == value(top) and is_red(card) != is_red(top)

    def _fits_foundation(self, card: str) -> bool:
        pile = self.foundations[SUITS.index(card[1])]
        return value(card) == len(pile) + 1

    # -- moves -------------------------------------------------------------

    def _apply(self, seat: int, move: dict) -> None:
        if move.get("draw") is True:
            self._draw()
            return
        if "card" not in move or "to" not in move:
            raise InvalidMove("solitaire.no_move")
        self._move(move["card"], move["to"])

    def _draw(self) -> None:
        if self.stock:
            self.waste.append(self.stock.pop())
        elif self.waste:
            # Round again. The cards go back face-down in the order they came off, so
            # they return in the same sequence -- which a player who was paying
            # attention already knows. That is not a leak, it is the game.
            self.stock = list(reversed(self.waste))
            self.waste = []
            self.recycles += 1
        else:
            raise InvalidMove("solitaire.nothing_to_draw")
        self.moves += 1

    def _move(self, card: object, to: object) -> None:
        # A card is a string; True is not, and neither is 7. Check that before asking
        # whether the deck contains it, because a list is not hashable and `in` on a
        # frozenset would raise a TypeError rather than an InvalidMove.
        if not isinstance(card, str) or card not in CARDS:
            raise InvalidMove("solitaire.no_such_card")
        if not isinstance(to, str):
            raise InvalidMove("solitaire.no_such_pile")

        source, index = self._find(card)
        run = self._run(source, index, card)

        # Check, then take, then place -- in that order. A move onto the pile the card
        # is already on is refused by the checks themselves (no card is one rank below
        # itself, and no foundation wants the card already on top of it), so nothing
        # below has to ask whether the source and the destination are the same list.
        if to == FOUNDATION:
            self._check_foundation(run)
            self._take(source, index, len(run))
            self.foundations[SUITS.index(card[1])].append(card)
        else:
            target = self._column_number(to)
            self._check_column(card, target)
            self._take(source, index, len(run))
            self.columns[target].extend(run)

        self.moves += 1

    def _find(self, card: str) -> tuple[str, int]:
        """Where the card is -- and whether the player may pick it up at all."""
        for index, column in enumerate(self.columns):
            if card in column:
                if column.index(card) < self.hidden[index]:
                    raise InvalidMove("solitaire.card_is_face_down")
                return IN_COLUMN, index

        if card in self.waste:
            if card != self.waste[-1]:
                raise InvalidMove("solitaire.card_is_buried")
            return IN_WASTE, 0

        for index, pile in enumerate(self.foundations):
            if card in pile:
                if card != pile[-1]:
                    raise InvalidMove("solitaire.card_is_buried")
                return ON_FOUNDATION, index

        # There is nowhere else it can be: it is still face-down in the stock. Which
        # the player cannot know, cannot see, and cannot have clicked -- so a client
        # asking for it is a client that has guessed.
        raise InvalidMove("solitaire.card_is_face_down")

    def _run(self, source: str, index: int, card: str) -> list[str]:
        """The card, and everything sitting on top of it."""
        if source != IN_COLUMN:
            return [card]
        column = self.columns[index]
        return column[column.index(card) :]

    def _column_number(self, to: str) -> int:
        if to.startswith(COLUMN) and to[1:].isdigit() and int(to[1:]) < COLUMNS:
            return int(to[1:])
        raise InvalidMove("solitaire.no_such_pile")

    def _check_column(self, card: str, column: int) -> None:
        if self._fits_column(card, column):
            return
        if self._top(column) is None:
            raise InvalidMove("solitaire.needs_a_king")
        # Deliberately no `card=` param, though the platform would carry one. A card
        # is "TS" on the wire, and the ten being a T is a spelling this SERVER chose
        # for its own convenience -- put it in a param and a player eventually reads
        # "the TS does not go there", which is not a sentence in any language. The
        # rule is what they need anyway: the browser says what a column wants, and
        # the player can see perfectly well which card they just dropped.
        raise InvalidMove("solitaire.does_not_fit")

    def _check_foundation(self, run: list[str]) -> None:
        if len(run) > 1:
            raise InvalidMove("solitaire.one_card_at_a_time")
        if not self._fits_foundation(run[0]):
            raise InvalidMove("solitaire.out_of_sequence")

    def _take(self, source: str, index: int, count: int) -> None:
        if source == IN_WASTE:
            self.waste.pop()
            return
        if source == ON_FOUNDATION:
            self.foundations[index].pop()
            return

        column = self.columns[index]
        del column[len(column) - count :]
        # The card the run was sitting on turns over. There is no decision in it and
        # nothing to get wrong, so it is not a move -- it simply happens.
        if self.hidden[index] and len(column) == self.hidden[index]:
            self.hidden[index] -= 1

    # -- outcome -----------------------------------------------------------

    def _result(self) -> Result | None:
        if all(len(pile) == len(RANKS) for pile in self.foundations):
            return Result(winner_seat=0)
        if self._stuck():
            # Nowhere left to go. There is nobody to lose TO, so the platform can only
            # call this a draw -- and the renderer overrides it, because a neutral
            # never-mind chime for a run that just died is exactly backwards. 2048 ends
            # the same way, for the same reason.
            return Result.draw()
        return None

    def _stuck(self) -> bool:
        """Is there no move left that CHANGES anything?

        Not "is this unwinnable". That is a different and much harder question, and not
        one a player wants answered on their behalf. This is the honest, checkable one:
        there is nothing left you could click that would do anything at all.

        Turning cards over is not among the moves considered, and that is the whole
        payoff of dealing one at a time: every card in the stock is reachable, so
        drawing cannot save a board -- it only changes the order you meet it in. The
        stock and the waste are therefore just a POOL of cards that are available, and
        the question is whether any of them, or anything already on the table, has
        somewhere to go.
        """
        for card in self.stock + self.waste:
            if self._fits_foundation(card) or self._anywhere(card):
                return False

        for index in range(COLUMNS):
            run = self._up(index)
            for offset, card in enumerate(run):
                # Only the card on top of the column can go home, and only alone.
                if offset == len(run) - 1 and self._fits_foundation(card):
                    return False

                for target in range(COLUMNS):
                    if target == index or not self._fits_column(card, target):
                        continue
                    # The one legal move that changes nothing: lifting an entire column
                    # with no face-down card under it into an empty one. It trades an
                    # empty column for an empty column, and the same cards are showing
                    # afterwards. If it counted, a lone king beside a gap could shuffle
                    # back and forth for ever and no board would ever be dead.
                    whole_column = offset == 0 and self.hidden[index] == 0
                    if whole_column and not self.columns[target]:
                        continue
                    return False

        # A card can come back OFF a foundation, and sometimes it has to: pull the 5S
        # down onto a red six and the red four you were stuck behind has somewhere to
        # go. Counting that as a move is the conservative direction -- it can only ever
        # make us say "there is still something to do", never end a game that had a
        # move left in it.
        for pile in self.foundations:
            if pile and self._anywhere(pile[-1]):
                return False

        return True

    def _anywhere(self, card: str) -> bool:
        return any(self._fits_column(card, column) for column in range(COLUMNS))

    # -- what everyone sees ------------------------------------------------

    def public_state(self) -> dict:
        """Every card the player is entitled to see, and not one more.

        There is no view() under this. The face-down cards are hidden from the player
        as well, so the spectator's view and the player's are the same view -- and it
        is the strict one, which is the way round that is safe.

        The stock is a NUMBER here. The moment it becomes a list of cards, the game is
        over and nobody has to tell the player they cheated: the browser will simply
        know what is coming, and there is no way to un-know it.
        """
        return {
            "columns": [
                {"down": self.hidden[index], "up": self._up(index)}
                for index in range(COLUMNS)
            ],
            # In SUITS order, so the browser knows which pile is whose suit without
            # being told twice.
            "foundations": [list(pile) for pile in self.foundations],
            "suits": SUITS,
            # Every card in here has been turned face-up in front of the player. The
            # ones they have not seen are in `stock`, and `stock` is a count.
            "waste": list(self.waste),
            "stock": len(self.stock),
            "score": sum(len(pile) for pile in self.foundations),
            "cards": len(CARDS),
            "moves": self.moves,
            "recycles": self.recycles,
        }
