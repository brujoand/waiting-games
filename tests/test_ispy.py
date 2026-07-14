"""I Spy.

The game the server cannot referee. It never sees the camera, so most of what is
worth testing here is not "did they find it" -- it is the shape of the round, and
the one piece of player-supplied content this app has ever put on another player's
screen.
"""

from __future__ import annotations

import pytest
from conftest import rejected

from waiting_games.games.ispy import DECK, PHOTO_MAX, ROUNDS, ISpy

A, B, C = "u-alice", "u-bob", "u-cleo"

# A real, minimal jpeg data url. The bytes do not have to decode to a picture --
# nothing here decodes it -- but the SHAPE has to be the shape a browser sends.
PHOTO = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAEB"


def seat(players=(A, B), cards=None):
    """A dealt game -- and, where a test cares WHAT was dealt, a stacked deck.

    The real deal is a sample of five from thirty-one, so "play until a coloured
    card comes up" is a test that passes most afternoons. The game reads its length
    off `cards`, so a stacked deck of one is a one-round game, which is exactly what
    most of these want.
    """
    game = ISpy()
    for player in players:
        game.add_player(player)
    game.start()
    if cards is not None:
        game.cards = list(cards)
    return game


COLOURED = next(card for card in DECK if card.colour)
PLAIN = next(card for card in DECK if not card.colour)


def find(game, player, photo=PHOTO, **override):
    """Claim the card on the table, the way a browser that saw it would."""
    card = game.target
    claim = {"thing": card.thing, "colour": card.colour, "photo": photo}
    game.apply_move(player, {"found": {**claim, **override}})


# -- the deck -----------------------------------------------------------------


def test_every_card_names_something_the_detector_can_actually_see():
    """A card whose `thing` is not one of the model's eighty nouns is a round that
    can never be won -- and it would never fail loudly, it would just sit there
    being impossible while everybody swept the room with a phone.

    The labels are the COCO set, spelled as the model spells them. "traffic light",
    with the space, is the whole point of pinning it: `traffic_light` is the i18n
    key and it is NOT what comes out of the detector.
    """
    coco = {
        "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train",
        "truck", "boat", "traffic light", "fire hydrant", "stop sign",
        "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow",
        "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella", "handbag",
        "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball", "kite",
        "baseball bat", "baseball glove", "skateboard", "surfboard",
        "tennis racket", "bottle", "wine glass", "cup", "fork", "knife", "spoon",
        "bowl", "banana", "apple", "sandwich", "orange", "broccoli", "carrot",
        "hot dog", "pizza", "donut", "cake", "chair", "couch", "potted plant",
        "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote",
        "keyboard", "cell phone", "microwave", "oven", "toaster", "sink",
        "refrigerator", "book", "clock", "vase", "scissors", "teddy bear",
        "hair drier", "toothbrush",
    }  # fmt: skip

    strangers = sorted({card.thing for card in DECK} - coco)
    assert not strangers, f"the detector has never heard of: {strangers}"


def test_every_card_is_a_different_card():
    ids = [card.id for card in DECK]
    assert len(ids) == len(set(ids))


def test_a_colour_is_only_ever_asked_of_something_a_box_is_mostly_full_of():
    """Colour comes from the pixels inside the bounding box, and a bounding box
    round a bicycle is mostly the road behind the bicycle. Asking for a red bicycle
    would be asking about the road.

    This is a judgement call frozen into a test on purpose: the next person to add
    a card will want to add "a red bicycle", and it is not obvious why they should
    not until you have watched it match a red car parked behind one.
    """
    thin = {"bicycle", "bird", "traffic light", "stop sign", "potted plant"}
    asked = {card.thing for card in DECK if card.colour}
    assert not (asked & thin)


# -- the round ----------------------------------------------------------------


def test_finding_the_thing_scores_it_and_deals_the_next_one():
    game = seat()
    first = game.target

    find(game, A)

    assert game.public_state()["counts"] == {A: 1, B: 0}
    assert game.target is not first
    assert game.results[-1]["winner"] == A
    assert game.results[-1]["photo"] == PHOTO


def test_a_claim_for_the_wrong_thing_is_refused():
    """Not a cheat check -- there is no cheat check to be had. It is a browser whose
    detector fired on the dog while the card said red car, and it has not found the
    card."""
    game = seat()

    with rejected("ispy.not_the_target"):
        find(game, A, thing="giraffe")

    assert game.public_state()["counts"] == {A: 0, B: 0}


def test_the_colour_is_part_of_the_thing():
    """A red car is not a car. Claiming the card's noun while ignoring its adjective
    is the exact bug a client would have if it forgot to look at the pixels."""
    game = seat(cards=[COLOURED])

    with rejected("ispy.not_the_target"):
        find(game, A, colour=None)


def test_the_first_to_find_it_takes_the_round_and_the_second_is_too_late():
    game = seat(cards=[COLOURED, PLAIN])
    find(game, A)

    # B was still pointing a phone at the card A has just taken. It is not on the
    # table any more, and finding it now finds nothing.
    with rejected("ispy.not_the_target"):
        game.apply_move(
            B,
            {
                "found": {
                    "thing": COLOURED.thing,
                    "colour": COLOURED.colour,
                    "photo": PHOTO,
                }
            },
        )

    assert game.public_state()["counts"] == {A: 1, B: 0}


# -- giving up ----------------------------------------------------------------


def test_a_round_nobody_can_win_ends_when_the_last_player_stops_looking():
    """The reason this game needs no clock. There is no cow in an airport, and a
    round with no cow in it is not a stalemate to be timed out -- when the final
    player gives up there is nobody left who could still be looking, and that is an
    answer."""
    game = seat((A, B, C))
    card = game.target

    game.apply_move(A, {"pass": True})
    game.apply_move(B, {"pass": True})
    assert game.target is card  # C is still out there

    game.apply_move(C, {"pass": True})

    assert game.target is not card
    assert game.results[-1] == {"target": card.id, "winner": None, "photo": None}
    assert game.public_state()["counts"] == {A: 0, B: 0, C: 0}


def test_giving_up_twice_is_refused():
    game = seat()
    game.apply_move(A, {"pass": True})

    with rejected("ispy.already_passed"):
        game.apply_move(A, {"pass": True})


def test_giving_up_is_forgotten_when_the_next_card_is_dealt():
    """You gave up on the cow. You have not given up on the game."""
    game = seat()
    game.apply_move(A, {"pass": True})
    assert game.public_state()["passed"] == [A]

    find(game, B)

    assert game.public_state()["passed"] == []
    game.apply_move(A, {"pass": True})  # allowed again, on a new card


def test_alone_giving_up_ends_the_round_on_the_spot():
    game = seat((A,))
    card = game.target

    game.apply_move(A, {"pass": True})

    assert game.target is not card


# -- the photograph -----------------------------------------------------------
#
# The one thing a player can put on another player's screen. Everything below is
# about that, and none of it is paranoia: `image.src = shot.photo` is a real line
# in ispy.js.


@pytest.mark.parametrize(
    "photo",
    [
        pytest.param("", id="empty"),
        pytest.param(None, id="missing"),
        pytest.param(123, id="not_even_a_string"),
        pytest.param("https://example.test/cat.jpg", id="a_url_somewhere_else"),
        pytest.param("javascript:alert(1)", id="a_scheme_with_ideas"),
        pytest.param(
            "data:text/html;base64,PHNjcmlwdD4=", id="html_wearing_a_data_url"
        ),
        pytest.param(
            "data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Lz48L3N2Zz4=",
            # The reason "any image" is not the rule. An svg is a document, it can
            # carry script, and it is an image by every check that only looks at the
            # word before the slash.
            id="an_svg_which_is_a_program",
        ),
        pytest.param("data:image/png;base64,iVBORw0KGgo=", id="the_wrong_image"),
        pytest.param("data:image/jpeg;base64,not base64!", id="not_base64"),
        pytest.param("data:image/jpeg;base64,", id="no_bytes_at_all"),
        pytest.param(
            " data:image/jpeg;base64,/9j/4AAQ", id="smuggled_in_behind_a_space"
        ),
    ],
)
def test_a_photo_that_is_not_a_jpeg_is_not_a_find(photo):
    game = seat()

    with rejected("ispy.no_photo"):
        find(game, A, photo=photo)

    assert game.public_state()["counts"] == {A: 0, B: 0}


def test_a_photo_nobody_could_have_taken_is_refused_before_it_is_parsed():
    """Bounded, because this string is broadcast to every socket in the session --
    and because "match a regex against however many megabytes they sent" is not a
    sentence that should appear in a server."""
    game = seat()
    huge = "data:image/jpeg;base64," + ("A" * PHOTO_MAX)

    with rejected("ispy.photo_too_big"):
        find(game, A, photo=huge)


def test_a_find_needs_a_photo_at_all():
    game = seat()
    card = game.target

    with rejected("ispy.no_photo"):
        game.apply_move(A, {"found": {"thing": card.thing, "colour": card.colour}})


# -- the game -----------------------------------------------------------------


def test_the_game_is_over_after_the_last_card_and_the_most_finds_wins():
    game = seat()

    find(game, A)
    find(game, B)
    find(game, A)
    find(game, B)
    assert not game.over

    find(game, A)  # the fifth and last card

    assert game.over
    assert game.winner == A
    assert game.public_state()["counts"] == {A: 3, B: 2}


def test_a_game_where_everyone_found_the_same_number_is_a_draw():
    game = seat()

    find(game, A)
    find(game, B)
    find(game, A)
    find(game, B)

    for player in game.players:  # and nobody finds the last one
        game.apply_move(player, {"pass": True})

    assert game.over
    assert game.winner is None
    assert game.public_state()["counts"] == {A: 2, B: 2}


def test_the_scrapbook_only_rides_the_wire_once_the_game_is_over():
    """Five photographs re-sent to every socket on every state change is a game that
    does not work on a phone. The photo of the round just won rides in `last`; the
    scrapbook waits for the end, where it costs exactly one broadcast."""
    game = seat()

    find(game, A)
    state = game.public_state()
    assert state["gallery"] is None
    assert state["last"]["photo"] == PHOTO  # ...but the one just won is there

    for _ in range(ROUNDS - 1):
        find(game, A)

    assert game.over
    assert len(game.public_state()["gallery"]) == ROUNDS


def test_a_game_can_be_looked_at_before_it_is_dealt():
    """The waiting room is a view of the game, and the game has not started yet.

    Which is not obvious, and cost an afternoon: the lobby opens a socket the moment
    you create a session, and the first thing it does is broadcast view() -- so
    public_state() runs with a seat taken, no cards dealt and `scores` still the
    empty list it was born as. Reaching into it by seat there is an IndexError, the
    socket closes with 1008, and the player is bounced back to a lobby that cheerfully
    lists the game they cannot enter.

    Gris has this bug on main right now, found the same way. It is a platform contract
    nothing writes down and nothing tested.
    """
    game = ISpy()
    game.add_player(A)  # created, sitting in the lobby, waiting for company

    state = game.public_state()

    assert state["counts"] == {A: 0}
    assert state["target"] is None
    assert state["rounds"] == 0


def test_a_spectator_sees_exactly_what_a_player_sees():
    """There is no hidden information in I Spy -- the whole game is that everybody
    is looking for the same thing -- so view() is public_state() and this is the
    test that says the day somebody changes that, they meant to."""
    game = seat()

    assert game.view(None) == game.view(0) == game.public_state()


def test_the_cards_are_dealt_without_repeats():
    game = seat()
    dealt = [game.target]
    for _ in range(ROUNDS - 1):
        find(game, A)
        dealt.append(game.target)

    assert len(dealt) == ROUNDS
    assert len({card.id for card in dealt}) == ROUNDS
