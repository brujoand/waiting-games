"""Hangman: one player sets the word, the rest guess letters. Everyone sets one word.

Two things the platform has to be told about:

  * the word is a SECRET, so view() shows it to the setter and masks it for
    everyone else -- including spectators, who are the strictest case;
  * the setter does not guess, so _may_move and _next_seat step around them.

Rounds are NOT a platform concept. They are a counter and a rotation, right here,
because this is the only game that has them.
"""

from __future__ import annotations

import unicodedata

from .base import Game, InvalidMove, Result

# The alphabet is this game's piece set, like a board having 64 squares. It is
# NOT a locale, and it must not depend on the word, for two separate reasons:
#
#   * a letter that can be in the word but has no key makes that word
#     unguessable, and the setter wins by construction;
#   * an alphabet DERIVED from the word would leak the answer -- set HØNE, an Ø
#     key appears, and every guesser now knows there is an Ø in it. In a game
#     whose whole premise is a secret word, the keyboard would be telling them.
#
# So it is a constant, and the only constant that works is the union of what any
# player might use. An English player sees three keys they never press; that is
# the entire cost, and there is no effect on the rules.
ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZÆØÅ"
MAX_WRONG = 7  # head, body, two arms, two legs, and the rope
MIN_LENGTH, MAX_LENGTH = 3, 20

CORRECT_LETTER = 1  # to the guesser
GALLOWS = 3  # to the setter, if nobody solves it

SETTING = "setting"
GUESSING = "guessing"


def normalise(raw: str) -> str:
    """Fold a typed word or letter into the one form ALPHABET is written in.

    Å has two Unicode encodings, and the decomposed one is an A followed by a
    combining ring -- neither of which is Å. Without this, a player types a word
    that is visibly nothing but letters and is told it contains non-letters,
    which is an impossible thing to be told and an impossible thing to debug.

    The guess path happens to be safe today, because the client sends back the
    text of a key the server itself rendered. Normalise it anyway: that safety is
    an accident of the current frontend, not a promise it made.
    """
    return unicodedata.normalize("NFC", raw.strip()).upper()


class Hangman(Game):
    key = "hangman"
    title = "Hangman"
    category = "board"
    min_players = 2
    max_players = 6

    def __init__(self) -> None:
        super().__init__()
        self.phase = SETTING
        self.setter = 0
        self.round = 0
        self.word = ""
        self.guessed: list[str] = []  # every letter tried, in order
        self.wrong: list[str] = []  # ...and the ones that missed
        self.points: list[int] = []
        # What happened last round, so the table sees the result before the next
        # word is set rather than the board simply vanishing.
        self.previous: dict | None = None

    def _on_start(self) -> None:
        self.points = [0] * len(self.players)
        self.setter = 0
        self.turn = 0  # the setter goes first: they owe everyone a word

    # -- the round -------------------------------------------------------

    @property
    def rounds(self) -> int:
        """Everybody sets exactly one word."""
        return len(self.players)

    @property
    def revealed(self) -> str:
        """The word as the guessers see it."""
        return "".join(
            letter if letter in self.guessed else "_" for letter in self.word
        )

    @property
    def solved(self) -> bool:
        return bool(self.word) and "_" not in self.revealed

    @property
    def hanged(self) -> bool:
        return len(self.wrong) >= MAX_WRONG

    def _finish_round(self) -> None:
        if self.hanged:
            self.points[self.setter] += GALLOWS

        self.previous = {
            "word": self.word,
            "solved": self.solved,
            "setter": self.players[self.setter],
        }

        self.round += 1
        if self.round < self.rounds:
            self.setter = self.round  # the next player owes a word
            self.phase = SETTING
            self.word = ""
            self.guessed = []
            self.wrong = []

    # -- the platform's hooks ---------------------------------------------

    def _may_move(self, seat: int) -> bool:
        if self.phase == SETTING:
            return seat == self.setter  # only they can supply the word
        # The setter knows the answer, so they never guess.
        return seat == self.turn and seat != self.setter

    def _next_seat(self, seat: int) -> int:
        if self.phase == SETTING:
            return self.setter

        # Hand on to the next player who is not the setter. There is always one:
        # the game needs two players, and only one of them is setting.
        nxt = (seat + 1) % len(self.players)
        while nxt == self.setter:
            nxt = (nxt + 1) % len(self.players)
        return nxt

    def _apply(self, seat: int, move: dict) -> None:
        if self.phase == SETTING:
            self._set_word(move)
        else:
            self._guess(seat, move)

    def _set_word(self, move: dict) -> None:
        word = move.get("word")
        if not isinstance(word, str):
            raise InvalidMove("hangman.word_required")

        word = normalise(word)
        if not MIN_LENGTH <= len(word) <= MAX_LENGTH:
            raise InvalidMove("hangman.word_length", min=MIN_LENGTH, max=MAX_LENGTH)
        if any(letter not in ALPHABET for letter in word):
            raise InvalidMove("hangman.word_letters", alphabet=ALPHABET)

        self.word = word
        self.phase = GUESSING

    def _guess(self, seat: int, move: dict) -> None:
        letter = move.get("letter")
        if not isinstance(letter, str):
            raise InvalidMove("hangman.letter_required")

        letter = normalise(letter)
        if len(letter) != 1 or letter not in ALPHABET:
            raise InvalidMove("hangman.not_a_letter")
        if letter in self.guessed:
            raise InvalidMove("hangman.already_tried")

        self.guessed.append(letter)
        if letter in self.word:
            self.points[seat] += CORRECT_LETTER
        else:
            self.wrong.append(letter)

        if self.solved or self.hanged:
            self._finish_round()

    def _result(self) -> Result | None:
        if self.round < self.rounds:
            return None  # somebody still owes a word
        return Result.by_score(self.points)

    # -- what each seat may see -------------------------------------------

    def public_state(self) -> dict:
        """The spectator's view, and the base every other view is built from.

        The word is NOT in here. This method is what a spectator gets, so it has
        to be the strictest view in the game -- any logged-in user may open a
        game socket and watch.
        """
        return {
            "phase": self.phase,
            "revealed": self.revealed,
            "letters": self.guessed,
            "wrong": self.wrong,
            "maxWrong": MAX_WRONG,
            "alphabet": ALPHABET,
            "setter": self.players[self.setter] if self.started else None,
            "round": self.round + 1,
            "rounds": self.rounds,
            "previous": self.previous,
            # The lobby renders a waiting session too, and points are only dealt
            # out in _on_start -- so before the game starts there is no score.
            "counts": {
                player: self.points[seat] for seat, player in enumerate(self.players)
            }
            if self.started
            else {},
        }

    def view(self, seat: int | None) -> dict:
        state = self.public_state()
        # Only the player who chose the word may see it.
        if seat is not None and seat == self.setter:
            state["word"] = self.word
        return state
