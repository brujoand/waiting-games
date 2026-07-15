"""Draw: one player is handed a word and draws it; everyone else races to guess.

This is the platform's first drawing game, and it sits differently from every other
one, so the whole shape is worth saying out loud.

-- why it is real-time, and why it is not client-run ------------------------

A drawing game has a clock even though nobody is dodging anything: the round is
sixty seconds long, and sixty seconds is a fact the SERVER has to own, because the
drawer and the guessers must agree on when the pens go down. So it is a
`RealTimeGame` -- it takes a tick, and the tick is where the round ends.

It is emphatically NOT client_clock. A client-run game (Snake) works because a run
is a pure function of `(seed, moves, ticks)` and the server can replay it to find
out what really happened. There is no such trick when the "input" is a drawing of a
horse and the "output" is whether Kari recognised it. The server cannot referee a
drawing; what it CAN referee is a typed guess against the word it dealt, and the
manual-accept button hands the one judgement it cannot make -- "close enough" -- to
the one human who is entitled to make it.

-- the picture on the wire --------------------------------------------------

The platform has exactly two ways to send anything: the tick broadcasts full state,
and a turn-based move fan-outs full state. There is no delta channel, and a
real-time move never echoes at all (main.py suppresses it, or four held keys become
a fan-out storm). So the drawing has to ride the per-tick full state -- the same
place Snakes puts every snake, every tick.

That means the accumulated picture is re-sent on every tick, which is only
affordable because it is BOUNDED: the client quantises points to a coarse integer
grid and only sends a handful per frame, and the server caps the total (MAX_POINTS).
A finished board is a few thousand integers, re-sent at TICK_HZ; `Lobby.stream`
drops a frame for any socket that cannot keep up, exactly as it does for Snakes.

-- the secret ---------------------------------------------------------------

The word is hidden from everyone who has not earned it: the guessers, and the
spectators, who are the case people forget (any logged-in user may open the socket
and watch). Only the drawer sees it while the round is live, plus any guesser who
has already solved it -- they typed it, so there is nothing left to hide from them.

Two subtler leaks, both closed here:
  * a CORRECT guess must not show its text to the others, or the first person to
    solve it broadcasts the answer in the chat log. Correct guesses travel as a
    name and nothing else; only wrong guesses carry their words.
  * the round's word, and every FUTURE round's word, live in `self.words`, which
    never goes near view(). Only the current word is ever named, and only to the
    people allowed to see it.
"""

from __future__ import annotations

import random

from .base import InvalidMove, RealTimeGame, Result

TICK_HZ = 10.0

# The two halves of a round, and the pause that shows the result between rounds.
#
# The drawer gets GRACE seconds with the word before anyone expects a line -- time
# to think of what to draw. The first stroke starts the DRAW clock, so the worst
# case is a drawer who dawdles the full grace and then uses the full draw time:
# GRACE + DRAW seconds, the "maximum 120" the round advertises. A drawer who never
# draws ends the round at GRACE with nothing to guess.
GRACE = 60.0
DRAW = 60.0
SUMMARY = 6.0

REVEAL = "reveal"  # the word is up, waiting for the first stroke
DRAWING = "drawing"  # the pen is down, the guess clock is running
RECAP = "recap"  # the round is over, the word is shown to all

SOLVE = 5  # to a guesser who gets it
DRAWN_WELL = 2  # to the drawer, once, if anybody gets it at all

# The picture. The client owns the actual colours and brush widths; the server only
# needs to know how many there are, so an out-of-range index cannot be used to smuggle
# anything through. COORD is the drawing grid: points arrive as integers 0..COORD on
# both axes, which is what keeps the wire small and the strokes crisp on any canvas.
NUM_COLOURS = 8
NUM_WIDTHS = 4
COORD = 1000

# A whole round of drawing, bounded. A finished board is a few thousand integers; the
# cap is what stops a client -- honest or not -- growing the per-tick payload without
# limit. Past it, further points are simply dropped: two minutes of drawing is already
# well over anything a person produces.
MAX_POINTS = 4000
MAX_STROKES = 600
MAX_GUESS = 60  # characters; a guess is a word or two, not an essay

# A drawer handed a word they cannot draw is not stuck with it: they may skip it for
# a fresh one, up to this many times a turn. The skip only exists BEFORE the first
# stroke -- it is "I don't like this word", not "this drawing is going badly" -- so it
# resets the think-time clock and hands over a new word with the canvas still blank.
# Each drawer gets a fresh three when their own turn opens.
MAX_SKIPS = 3


def _normalise(text: str) -> str:
    """Fold a word or guess to the one form they are compared in.

    Case-insensitive, and blind to leading, trailing or doubled whitespace, so
    "  Ice   Cream " and "ice cream" are the same answer. Deliberately nothing
    cleverer: stripping punctuation or stemming would start guessing at what the
    player meant, and the drawer's Accept button is the honest home for "close
    enough".
    """
    return " ".join(text.casefold().split())


def _mask(word: str) -> str:
    """The word as a guesser sees it: every letter blanked, spaces and hyphens kept.

    So "ice cream" shows as "___ _____" -- the shape of the answer, which is a fair
    hint, without a single letter of it, which would not be.
    """
    return "".join("_" if ch.isalnum() else ch for ch in word)


class Draw(RealTimeGame):
    key = "draw"
    title = "Draw"
    category = "party"
    min_players = 2  # a drawer and at least one guesser
    max_players = 8
    tick_hz = TICK_HZ

    def __init__(self, words: list[str] | None = None) -> None:
        super().__init__()
        # Forced words make a round reproducible in a test, exactly as Snakes' seed
        # does. None in play: a fresh sample every game.
        self._forced_words = words
        self.rng = random.Random()

        self.phase = REVEAL
        self.round = 0
        self.drawer = 0
        self.word = ""
        # This round's word and every future round's. NEVER goes on the wire.
        self.words: list[str] = []
        # Forced words consumed so far -- the initial deal plus every skip. Only
        # meaningful when _forced_words is set; a skip draws the next one from here so
        # a test can pin what the drawer is handed next, exactly as the deal is.
        self._forced_taken = 0
        self.skips_left = MAX_SKIPS
        self.clock = GRACE

        # The picture: [{"c", "w", "p": [x0, y0, x1, y1, ...]}].
        self.strokes: list[dict] = []
        self.points_used = 0

        self.solved: list[int] = []  # seats that have the word this round, in order
        # The chat log: [{"id", "seat", "text", "correct"}].
        self.guesses: list[dict] = []
        self.next_guess_id = 0

        self.scores: list[int] = []
        # What the last round came to, so the table sees it during the next drawer's
        # grace rather than the board simply blanking.
        self.previous: dict | None = None

    # -- the match -------------------------------------------------------

    @property
    def rounds(self) -> int:
        """Everybody draws exactly once."""
        return len(self.players)

    def _on_start(self) -> None:
        n = len(self.players)
        if self._forced_words is not None:
            if len(self._forced_words) < n:
                raise InvalidMove("draw.not_enough_words")
            chosen = list(self._forced_words[:n])
            self._forced_taken = n
        else:
            chosen = self.rng.sample(WORDS, n)

        self.words = chosen
        self.scores = [0] * n
        self.round = 0
        self.drawer = 0
        self._open_round()

    def _open_round(self) -> None:
        """Deal the round in front of us: a word for the drawer, a blank canvas."""
        self.word = self.words[self.round]
        self.phase = REVEAL
        self.clock = GRACE
        self.strokes = []
        self.points_used = 0
        self.solved = []
        self.guesses = []
        self.skips_left = MAX_SKIPS

    @property
    def _guessers(self) -> list[int]:
        return [seat for seat in range(len(self.players)) if seat != self.drawer]

    def _all_solved(self) -> bool:
        return bool(self._guessers) and all(
            seat in self.solved for seat in self._guessers
        )

    # -- input -----------------------------------------------------------

    def _apply(self, seat: int, move: dict) -> None:
        # The round is over but the summary is still up: nothing to apply. (The game
        # being over is already handled by apply_move.)
        if self.phase == RECAP:
            raise InvalidMove("draw.between_rounds")

        action = move.get("a")
        if action in ("open", "pts", "undo", "clear"):
            self._draw(seat, action, move)
        elif action == "guess":
            self._guess(seat, move)
        elif action == "accept":
            self._accept(seat, move)
        elif action == "skip":
            self._skip(seat)
        else:
            raise InvalidMove("draw.unknown_action")

    # -- the drawer's pen ------------------------------------------------

    def _draw(self, seat: int, action: str, move: dict) -> None:
        if seat != self.drawer:
            raise InvalidMove("draw.not_the_drawer")

        # The first mark of the round starts the guessing clock. A drawer who dawdles
        # the whole grace and never draws lets REVEAL expire instead; see tick().
        if self.phase == REVEAL:
            self.phase = DRAWING
            self.clock = DRAW

        if action == "clear":
            self.strokes = []
            self.points_used = 0
        elif action == "undo":
            if self.strokes:
                self.points_used -= len(self.strokes[-1]["p"]) // 2
                self.strokes.pop()
        elif action == "open":
            if len(self.strokes) < MAX_STROKES:
                self.strokes.append(
                    {
                        "c": _index(move.get("c"), NUM_COLOURS),
                        "w": _index(move.get("w"), NUM_WIDTHS),
                        "p": [],
                    }
                )
        elif action == "pts":
            self._extend(move.get("p"))

    def _extend(self, raw: object) -> None:
        """Append a batch of points to the stroke currently open, up to the cap."""
        if not self.strokes or not isinstance(raw, list):
            return
        stroke = self.strokes[-1]
        # Points arrive flat: [x0, y0, x1, y1, ...]. An odd tail is a truncated
        # message; drop it rather than pairing a coordinate with the next one.
        for i in range(0, len(raw) - 1, 2):
            if self.points_used >= MAX_POINTS:
                return
            x, y = _coord(raw[i]), _coord(raw[i + 1])
            if x is None or y is None:
                continue
            stroke["p"].extend((x, y))
            self.points_used += 1

    # -- a guess ---------------------------------------------------------

    def _guess(self, seat: int, move: dict) -> None:
        if seat == self.drawer:
            raise InvalidMove("draw.drawer_cannot_guess")

        text = move.get("text")
        if not isinstance(text, str):
            raise InvalidMove("draw.guess_required")
        text = text.strip()
        if not text or len(text) > MAX_GUESS:
            raise InvalidMove("draw.guess_length", max=MAX_GUESS)

        # Already solved this round: nothing more to earn, and re-guessing would just
        # spam the log with the answer they already know.
        if seat in self.solved:
            raise InvalidMove("draw.already_solved")

        correct = _normalise(text) == _normalise(self.word)
        if correct:
            self._award(seat)

        self.guesses.append(
            {
                "id": self.next_guess_id,
                "seat": seat,
                # A correct guess IS the word, so its text never leaves the server --
                # view() shows a name and a tick, not the answer. A wrong guess is the
                # whole fun of the chat log, so it keeps its text.
                "text": text,
                "correct": correct,
            }
        )
        self.next_guess_id += 1

    def _award(self, seat: int) -> None:
        self.scores[seat] += SOLVE
        self.solved.append(seat)

    # -- the drawer accepts a synonym ------------------------------------

    def _accept(self, seat: int, move: dict) -> None:
        if seat != self.drawer:
            raise InvalidMove("draw.not_the_drawer")

        guess_id = move.get("id")
        target = next((g for g in self.guesses if g["id"] == guess_id), None)
        if target is None:
            raise InvalidMove("draw.no_such_guess")
        if target["correct"] or target["seat"] in self.solved:
            raise InvalidMove("draw.already_solved")

        self._award(target["seat"])
        # Accepted: it counts, and -- like any correct guess -- its text stops
        # travelling, so an accepted near-miss of the word cannot leak it either.
        target["correct"] = True

    # -- the drawer skips a word they cannot draw ------------------------

    def _skip(self, seat: int) -> None:
        if seat != self.drawer:
            raise InvalidMove("draw.not_the_drawer")
        # Only before the pen touches the canvas. Once DRAWING has begun the clock is
        # the guessers' and a skip would rewind their round; that is what Clear is for.
        if self.phase != REVEAL:
            raise InvalidMove("draw.skip_too_late")
        if self.skips_left <= 0:
            raise InvalidMove("draw.no_skips_left")

        self.skips_left -= 1
        self.words[self.round] = self._new_word()
        # Re-deal this round in place: the new word, a fresh grace clock, a blank
        # slate. Nobody has drawn yet, and any reveal-phase guess was against a word
        # that no longer exists, so the log and the solves start over -- and a seat
        # paid for solving the old word is refunded, or the skip would mint points.
        for seat in self.solved:
            self.scores[seat] -= SOLVE
        self.word = self.words[self.round]
        self.clock = GRACE
        self.solved = []
        self.guesses = []

    def _new_word(self) -> str:
        """A replacement word, distinct from every word this game has dealt.

        Excluding all of self.words keeps the skip from handing back a word another
        round is already holding, so the rounds stay distinct even after a skip.
        """
        if self._forced_words is not None:
            if self._forced_taken >= len(self._forced_words):
                raise InvalidMove("draw.not_enough_words")
            word = self._forced_words[self._forced_taken]
            self._forced_taken += 1
            return word
        pool = [w for w in WORDS if w not in self.words]
        return self.rng.choice(pool)

    # -- the clock -------------------------------------------------------

    def tick(self, dt: float) -> None:
        """The round ends here, never in a move -- the platform's contract for a
        real-time game, and the one place every phase change lives."""
        self.clock -= dt

        if self.clock > 0.0:
            # The one transition that beats the clock: everyone has guessed it, so
            # there is nothing left to wait for.
            if self.phase == DRAWING and self._all_solved():
                self._end_round()
            return

        # The clock has run out on whatever phase we were in. A recap gives way to
        # the next round (or the end of the game); a live round ends -- solved or
        # not, drawn on or not.
        if self.phase == RECAP:
            self._advance()
        else:
            self._end_round()

    def _end_round(self) -> None:
        # The drawer's reward: once, if anybody got it at all. The guessers were paid
        # the moment they solved.
        if self.solved:
            self.scores[self.drawer] += DRAWN_WELL

        self.previous = {
            "word": self.word,
            "drawer": self.players[self.drawer],
            "solvers": [self.players[seat] for seat in self.solved],
        }
        self.phase = RECAP
        self.clock = SUMMARY

    def _advance(self) -> None:
        self.round += 1
        if self.round >= self.rounds:
            self.finish(Result.by_score(self.scores))
            return
        self.drawer = self.round  # the next seat takes the pen
        self._open_round()

    # -- what each seat may see ------------------------------------------

    def public_state(self) -> dict:
        """The spectator's view, and the base every other view is built from.

        The word is NOT in here while a round is live -- this is what an unsolved
        guesser and a spectator get. It appears only during the recap, when the round
        is over and there is nothing left to protect.
        """
        state = {
            "phase": self.phase,
            "round": self.round + 1,
            "rounds": self.rounds,
            "remaining": max(0.0, self.clock),
            "coord": COORD,
            "colours": NUM_COLOURS,
            "widths": NUM_WIDTHS,
            "strokes": self.strokes,
            "drawer": self.players[self.drawer] if self.started else None,
            "mask": _mask(self.word) if self.started else "",
            "solved": [self.players[seat] for seat in self.solved],
            "guesses": [self._public_guess(g) for g in self.guesses],
            "previous": self.previous,
            # How many skips the drawer has left this turn. Not a secret -- it says
            # nothing about the word -- so the whole table sees it; only the drawer's
            # own client turns it into a button.
            "skips": self.skips_left,
            # No score before the deal: scores are sized in _on_start, and the lobby
            # shows a waiting board too.
            "counts": {
                player: self.scores[seat] for seat, player in enumerate(self.players)
            }
            if self.started
            else {},
        }
        # The round is over: the answer is public now, for everyone watching.
        if self.started and self.phase == RECAP:
            state["word"] = self.word
        return state

    def _public_guess(self, guess: dict) -> dict:
        entry = {
            "id": guess["id"],
            "who": self.players[guess["seat"]],
            "correct": guess["correct"],
        }
        # Only a wrong guess carries its text. A right one would be the answer.
        if not guess["correct"]:
            entry["text"] = guess["text"]
        return entry

    def view(self, seat: int | None) -> dict:
        state = self.public_state()
        # While the round is live, the word belongs to the drawer and to anyone who
        # has already solved it. During the recap it is already public above.
        live = self.started and self.phase != RECAP and seat is not None
        if live and (seat == self.drawer or seat in self.solved):
            state["word"] = self.word
        return state


def _index(value: object, count: int) -> int:
    """A palette/width index clamped into range, defaulting to 0 for junk.

    An out-of-range index cannot then be used to reach past the client's arrays --
    it just draws in the default colour.
    """
    if isinstance(value, bool) or not isinstance(value, int):
        return 0
    return value if 0 <= value < count else 0


def _coord(value: object) -> int | None:
    """One drawing coordinate, clamped to the grid, or None for junk."""
    if isinstance(value, bool) or not isinstance(value, (int | float)):
        return None
    if value != value or value in (float("inf"), float("-inf")):  # NaN / inf
        return None
    return max(0, min(COORD, round(value)))


# A drawable noun should be a THING, concrete enough that a stick figure of it is
# recognisable and common enough that a room full of people will know the word. No
# proper nouns, no abstractions, no adjectives -- the detector-free cousin of I Spy's
# eighty nouns, chosen the same way: if you cannot mime it, it is not here.
WORDS = [
    "apple",
    "banana",
    "carrot",
    "pizza",
    "hamburger",
    "hotdog",
    "ice cream",
    "cake",
    "cookie",
    "donut",
    "egg",
    "cheese",
    "bread",
    "sandwich",
    "fish",
    "cat",
    "dog",
    "horse",
    "cow",
    "pig",
    "sheep",
    "chicken",
    "duck",
    "rabbit",
    "mouse",
    "elephant",
    "lion",
    "tiger",
    "bear",
    "monkey",
    "giraffe",
    "zebra",
    "penguin",
    "owl",
    "frog",
    "snake",
    "turtle",
    "snail",
    "spider",
    "bee",
    "butterfly",
    "ladybug",
    "octopus",
    "crab",
    "whale",
    "dolphin",
    "shark",
    "car",
    "truck",
    "bus",
    "train",
    "airplane",
    "helicopter",
    "boat",
    "bicycle",
    "motorcycle",
    "rocket",
    "tractor",
    "ambulance",
    "scooter",
    "sailboat",
    "house",
    "tent",
    "castle",
    "bridge",
    "lighthouse",
    "windmill",
    "barn",
    "church",
    "skyscraper",
    "igloo",
    "tower",
    "tree",
    "flower",
    "mushroom",
    "cactus",
    "leaf",
    "grass",
    "sun",
    "moon",
    "star",
    "cloud",
    "rainbow",
    "mountain",
    "volcano",
    "island",
    "river",
    "chair",
    "table",
    "bed",
    "couch",
    "lamp",
    "door",
    "window",
    "clock",
    "mirror",
    "ladder",
    "umbrella",
    "candle",
    "key",
    "book",
    "pencil",
    "scissors",
    "hammer",
    "saw",
    "wrench",
    "paintbrush",
    "broom",
    "bucket",
    "shovel",
    "hat",
    "shoe",
    "sock",
    "shirt",
    "pants",
    "dress",
    "glove",
    "scarf",
    "boot",
    "glasses",
    "crown",
    "ring",
    "watch",
    "necklace",
    "backpack",
    "belt",
    "guitar",
    "piano",
    "drum",
    "trumpet",
    "violin",
    "flute",
    "microphone",
    "ball",
    "kite",
    "balloon",
    "dice",
    "puzzle",
    "robot",
    "teddy bear",
    "yo-yo",
    "cup",
    "plate",
    "fork",
    "spoon",
    "knife",
    "bottle",
    "teapot",
    "pan",
    "kettle",
    "phone",
    "camera",
    "television",
    "computer",
    "headphones",
    "battery",
    "snowman",
    "fire",
    "anchor",
    "compass",
    "map",
    "flag",
    "envelope",
    "stamp",
    "ticket",
    "gift",
    "bell",
    "trophy",
    "medal",
    "eye",
    "hand",
    "foot",
    "ear",
    "nose",
    "mouth",
    "tooth",
    "heart",
    "brain",
    "skeleton",
    "ghost",
    "dragon",
    "mermaid",
    "wizard",
    "pirate",
    "clown",
    "fence",
    "mailbox",
    "traffic light",
    "swing",
    "slide",
    "seesaw",
    "strawberry",
    "grapes",
    "watermelon",
    "pineapple",
    "lemon",
    "cherry",
    "corn",
    "pumpkin",
    "onion",
    "potato",
    "tomato",
    "broccoli",
]
