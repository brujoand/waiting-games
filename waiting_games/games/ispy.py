"""I Spy: the board is the world, and the camera is the piece.

Everyone is shown the same thing to find -- "a red car" -- and everyone goes
looking through their phone's back camera at once. A detector running in the
browser watches the live stream, and the moment it is sure, it freezes the frame
it was sure about. That still is your claim, and it is what the table sees.

The round therefore ends without a clock, the same way Gris's does. Either
somebody finds the thing, or every last player gives up on it -- and when the last
one does, there is nobody left who could still be looking. Sometimes there is no
horse. That is not a stalemate to be timed out, it is an answer.

WHAT THIS SERVER CAN AND CANNOT CHECK
-------------------------------------
It cannot see your camera. Snake is safe because a run is a pure function of a
seed and some keystrokes, so we replay it and take the board that comes out; there
is no such trick here, because the input is a room, and we were not in it.

So the checks below are the honest ones and no more: that a claim names the thing
we actually asked for, and that the photo is a JPEG of a sane size. What stops a
player simply asserting a red car is not arithmetic -- it is that the photo goes up
on everyone's screen, and there is no red car in it. The referee is the table. For
a game people play in the same room while waiting for a table, that is the right
referee, and pretending otherwise would buy nothing.

That photo is the one piece of player-supplied content this app ever shows to
another player, which is why _check_photo is as strict as it is. See it.
"""

from __future__ import annotations

import random
import re
from dataclasses import dataclass

from .base import Game, InvalidMove, Result

ROUNDS = 5


@dataclass(frozen=True)
class Target:
    """One card: something to go and find.

    `thing` is a label the DETECTOR emits, spelled the way the model spells it
    ("traffic light", not "traffic_light"). `id` is what the browser looks the
    sentence up by, and it is a different string on purpose -- "a red car" is one
    phrase in English and one in Norwegian, and neither is assembled out of
    "red" and "car" at runtime. Norwegian would want "rødt" for a neuter noun and
    "rød" for the rest, and a game is not the place to learn that.

    `colour` is not the model's business at all. The detector hands back a BOX, and
    the colour of the pixels inside a box is arithmetic -- see _vision.js. It is
    what buys us "a red car" from a detector that knows eighty nouns and no
    adjectives.
    """

    id: str
    thing: str
    colour: str | None = None


# Things a phone can plausibly be pointed at, in a waiting room, a car or a street,
# and that the detector is good at. Some of them will be impossible where you happen
# to be sitting -- there is no cow in an airport -- and that is what passing is for.
DECK = (
    # Colour is only asked of objects big and solid enough for a box to be mostly
    # THEM. A bicycle is a box full of whatever is behind the bicycle, so a bicycle
    # is never asked for in a colour.
    Target("red_car", "car", "red"),
    Target("white_car", "car", "white"),
    Target("black_car", "car", "black"),
    Target("blue_car", "car", "blue"),
    Target("red_cup", "cup", "red"),
    Target("white_cup", "cup", "white"),
    Target("green_bottle", "bottle", "green"),
    Target("blue_backpack", "backpack", "blue"),
    Target("red_book", "book", "red"),
    Target("black_chair", "chair", "black"),
    # ...and the rest are asked for plain.
    Target("dog", "dog"),
    Target("cat", "cat"),
    Target("bird", "bird"),
    Target("horse", "horse"),
    Target("cow", "cow"),
    Target("sheep", "sheep"),
    Target("bicycle", "bicycle"),
    Target("bus", "bus"),
    Target("truck", "truck"),
    Target("boat", "boat"),
    Target("traffic_light", "traffic light"),
    Target("stop_sign", "stop sign"),
    Target("fire_hydrant", "fire hydrant"),
    Target("bench", "bench"),
    Target("potted_plant", "potted plant"),
    Target("umbrella", "umbrella"),
    Target("clock", "clock"),
    Target("laptop", "laptop"),
    Target("cell_phone", "cell phone"),
    Target("teddy_bear", "teddy bear"),
    Target("pizza", "pizza"),
)

# A JPEG data URL and nothing else.
#
# This string is put in an <img src> on every other player's screen, so it is the
# only thing a player can hand to another player, and it is therefore worth being
# unpleasant about. JPEG cannot carry script; SVG can, which is why "any image" is
# not the rule and image/svg+xml is not on this list. The alphabet is base64's, so
# there is nowhere for a "javascript:" or a "data:text/html" to hide.
PHOTO = re.compile(r"^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$")

# The browser sends a 480px-wide JPEG, which runs 30-50kB -- call it 70kB of base64.
# This is that with room to spare, and it is a bound on a string we broadcast to
# every socket in the session.
PHOTO_MAX = 96_000


class ISpy(Game):
    key = "ispy"
    title = "I Spy"
    category = "world"
    # Alone it is a scavenger hunt against the deck, which is a real thing to do in
    # a waiting room. The race only appears when somebody else turns up.
    min_players = 1
    max_players = 8

    def __init__(self) -> None:
        super().__init__()
        self.rng = random.Random()
        self.round = 0
        self.cards: list[Target] = []
        self.scores: list[int] = []
        # Seats that have given up on THIS round. Cleared when it ends.
        self.passed: set[int] = set()
        # Every round that has finished, in order: what it asked for, who got it,
        # and the photo they got it with.
        self.results: list[dict] = []

    def _on_start(self) -> None:
        self.scores = [0] * len(self.players)
        self.cards = self.rng.sample(DECK, ROUNDS)

    @property
    def target(self) -> Target | None:
        """What we are looking for, or None once the last round is done."""
        return self.cards[self.round] if self.round < len(self.cards) else None

    # -- moves -----------------------------------------------------------

    def _may_move(self, seat: int) -> bool:
        """Everyone at once. Nobody waits for a turn in a race."""
        return True

    def _next_seat(self, seat: int) -> int:
        """No seat is ever next, because no seat is ever waiting. Leave `turn`
        where it is rather than marching it round a table that is not taking
        turns."""
        return self.turn

    def _apply(self, seat: int, move: dict) -> None:
        # apply_move has already refused a game that is over, and a game that is not
        # over has a card on the table. So every path below has one.
        card = self.target
        if card is None:
            raise InvalidMove("move.game_over")

        if move.get("pass") is True:
            self._give_up(seat, card)
        elif "found" in move:
            self._found(seat, card, move["found"])
        else:
            raise InvalidMove("ispy.no_move")

    def _found(self, seat: int, card: Target, claim: object) -> None:
        if not isinstance(claim, dict):
            raise InvalidMove("ispy.no_move")

        # Not a cheat check -- we cannot see the camera, so there is no cheat check
        # to be had. It is a wrong-answer check: a browser whose detector fired on
        # the dog while the card said red car has not found the card.
        if claim.get("thing") != card.thing or claim.get("colour") != card.colour:
            raise InvalidMove("ispy.not_the_target")

        photo = self._check_photo(claim.get("photo"))

        self.scores[seat] += 1
        self._end_round(card, winner=seat, photo=photo)

    def _check_photo(self, photo: object) -> str:
        # Length before the pattern, deliberately. The pattern is linear and cannot
        # blow up, but "match a regex against however many megabytes they sent" is
        # not a sentence that should appear in a server, and the next person to edit
        # this pattern should not have to know it is safe.
        if not isinstance(photo, str) or not photo:
            raise InvalidMove("ispy.no_photo")
        if len(photo) > PHOTO_MAX:
            raise InvalidMove("ispy.photo_too_big")
        if not PHOTO.match(photo):
            raise InvalidMove("ispy.no_photo")
        return photo

    def _give_up(self, seat: int, card: Target) -> None:
        if seat in self.passed:
            raise InvalidMove("ispy.already_passed")

        self.passed.add(seat)

        # Everybody. Not everybody-but-one: unlike Gris there is no prize for being
        # last, so the round is over the moment the final player stops looking.
        if len(self.passed) == len(self.players):
            self._end_round(card, winner=None, photo=None)

    def _end_round(self, card: Target, winner: int | None, photo: str | None) -> None:
        self.results.append(
            {
                "target": card.id,
                "winner": None if winner is None else self.players[winner],
                "photo": photo,
            }
        )
        self.round += 1
        self.passed.clear()

    # -- outcome ---------------------------------------------------------

    def _result(self) -> Result | None:
        if self.round < len(self.cards):
            return None
        return Result.by_score(self.scores)

    # -- what the table can see ------------------------------------------

    def public_state(self) -> dict:
        target = self.target
        last = self.results[-1] if self.results else None

        # The lobby broadcasts this to the WAITING ROOM, before anybody has started
        # anything -- so it runs with no cards dealt and no scores kept, and it has
        # to mean something anyway. A seat that has not been dealt into a game has
        # found nothing, which is both true and what the waiting room should show.
        #
        # Worth knowing about, because it is not obvious from base.Game and it is not
        # free: `self.scores` is sized in _on_start, and reaching into it by seat
        # before then is an IndexError on the first socket that connects. See
        # test_a_game_can_be_looked_at_before_it_is_dealt.
        scores = self.scores or [0] * len(self.players)

        return {
            # 1-based for a human, and it stops at the last round rather than
            # reporting a sixth one that does not exist.
            "round": min(self.round + 1, len(self.cards)) if self.cards else 0,
            "rounds": len(self.cards),
            # `thing` and `colour` are what the browser's detector matches on; `id`
            # is what it says out loud. It needs all three.
            "target": target
            and {"id": target.id, "thing": target.thing, "colour": target.colour},
            "counts": {
                player: scores[seat] for seat, player in enumerate(self.players)
            },
            "passed": [self.players[seat] for seat in sorted(self.passed)],
            # The photo that just won a round rides here, and only here, while the
            # game is going: one image on the wire, not a scrapbook that grows a
            # frame every round and is re-sent to every socket on every state.
            "last": last,
            # ...and at the end, the scrapbook. It costs exactly one broadcast, and
            # it is the thing people will actually want to look at.
            "gallery": self.results if self.over else None,
        }
