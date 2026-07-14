"""Hangman, Battleship and Gris: the games with secrets.

The leak tests come first because they are the only tests here that protect
something a player cannot simply undo. A bug in the scoring is annoying; a fleet
visible to the opponent -- or to a spectator, who is the case people forget --
silently ruins every game.
"""

from __future__ import annotations

import json
import pathlib
import random
import re
import unicodedata

import pytest
from conftest import rejected

from waiting_games.games import InvalidMove
from waiting_games.games.battleship import FIRING, HIT, MISS, SIZE, Battleship
from waiting_games.games.gris import HAND, LETTERS, RANKS, Gris, deck_for
from waiting_games.games.hangman import GALLOWS, MAX_WRONG, Hangman
from waiting_games.games.idiot import RANKS as IDIOT_RANKS

A, B, C = "u-alice", "u-bob", "u-carol"


def seat(game_class, players=(A, B)):
    game = game_class()
    for player in players:
        game.add_player(player)
    game.start()
    return game


def leaks(payload: dict, secret: str) -> bool:
    """Is the secret anywhere in what we would put on the wire?

    Serialised, not walked: a secret buried in a nested dict, a list, or a key is
    still a secret, and a hand-written recursive check is exactly the kind of
    thing that misses the one path that matters.
    """
    return secret.lower() in json.dumps(payload, default=str).lower()


# ==========================================================================
# Hangman: the word is the secret
# ==========================================================================


def set_word(game, word="HUNDEHUS"):
    game.apply_move(game.players[game.setter], {"word": word})
    return word


# -- the alphabet is the game's piece set, not a locale ----------------------


def test_a_word_with_nordic_letters_can_be_set_and_guessed():
    """ALPHABET validates the word, so a letter missing from it is a letter the
    word may not contain AND a key nobody can press. Drop Æ, Ø or Å and a
    Norwegian word is not merely untranslated -- it is unplayable."""
    game = seat(Hangman)
    set_word(game, "HØNE")

    for letter in "HØNE":
        game.apply_move(B, {"letter": letter})

    # Solving it ends the round, which clears the word -- so the result is in
    # `previous`, not in `solved`.
    assert game.previous == {"word": "HØNE", "solved": True, "setter": A}
    assert game.points[1] == 4  # bob got every letter, Ø included


@pytest.mark.parametrize("word", ["BLÅBÆR", "SLØYFE", "HØNE"])
def test_every_nordic_letter_is_playable(word):
    game = seat(Hangman)
    set_word(game, word)

    assert set(word) <= set(game.view(0)["alphabet"])


def test_a_decomposed_a_ring_is_the_same_letter_as_a_precomposed_one():
    """Å has two Unicode encodings. Decomposed, it is an A followed by a combining
    ring -- neither of which is Å -- so a word that is visibly nothing but letters
    would be rejected for containing non-letters."""
    decomposed = unicodedata.normalize("NFD", "BLÅBÆR")
    assert decomposed != "BLÅBÆR"  # the point of the test

    game = seat(Hangman)
    set_word(game, decomposed)

    assert game.word == "BLÅBÆR"  # normalised on the way in

    # ...and a guess typed the same way still lands.
    game.apply_move(B, {"letter": unicodedata.normalize("NFD", "Å")})
    assert "Å" in game.guessed
    assert game.points[1] == 1  # it was a hit, not a miss


def test_the_word_is_hidden_from_the_guesser():
    game = seat(Hangman)
    word = set_word(game)

    assert not leaks(game.view(1), word)  # bob is guessing
    assert leaks(game.view(0), word)  # alice chose it, so she may see it


def test_the_word_is_hidden_from_a_spectator():
    """The case that is easy to forget: anyone logged in may open a game socket
    and watch, and view(None) is what they get."""
    game = seat(Hangman)
    word = set_word(game)

    assert not leaks(game.view(None), word)


def test_the_guesser_sees_only_the_letters_they_have_found():
    game = seat(Hangman)
    set_word(game, "HUS")

    game.apply_move(B, {"letter": "U"})

    assert game.view(1)["revealed"] == "_U_"


def test_a_correct_letter_scores_and_a_wrong_one_hangs():
    game = seat(Hangman)
    set_word(game, "HUS")

    game.apply_move(B, {"letter": "H"})
    assert game.points[1] == 1
    assert game.wrong == []

    game.apply_move(B, {"letter": "X"})
    assert game.points[1] == 1
    assert game.wrong == ["X"]


def test_the_setter_cannot_guess_at_their_own_word():
    game = seat(Hangman)
    set_word(game)

    with rejected("move.not_your_turn"):
        game.apply_move(A, {"letter": "H"})


def test_the_same_letter_cannot_be_tried_twice():
    game = seat(Hangman)
    set_word(game, "HUS")
    game.apply_move(B, {"letter": "H"})

    with rejected("hangman.already_tried"):
        game.apply_move(B, {"letter": "H"})


@pytest.mark.parametrize("word", ["NO", "A" * 21, "HUND!", "123", "", 7])
def test_a_bogus_word_is_rejected(word):
    game = seat(Hangman)

    with pytest.raises(InvalidMove):
        game.apply_move(A, {"word": word})


def test_the_gallows_has_a_part_for_every_wrong_guess():
    """The drawing has to run out at exactly the moment the round does.

    One part short and the fatal guess hangs nobody -- the figure is still
    missing a leg when the server ends the round. One part long and the last part
    can never be reached. MAX_WRONG lives in Python and the parts live in
    JavaScript, so there is no way for the compiler to notice; only this can.
    """
    source = (
        pathlib.Path(__file__).parent.parent
        / "waiting_games"
        / "static"
        / "games"
        / "hangman.js"
    ).read_text()

    body = source.split("const PARTS = [", 1)[1].split("\n];", 1)[0]
    parts = re.findall(r'^\s*\["(?:line|circle)"', body, re.MULTILINE)

    assert len(parts) == MAX_WRONG, (
        f"the gallows draws {len(parts)} parts but the round ends after "
        f"{MAX_WRONG} wrong guesses"
    )


def test_the_gallows_completing_scores_for_the_setter():
    game = seat(Hangman)
    set_word(game, "HUS")

    for letter in "XZBCDFG"[:MAX_WRONG]:
        game.apply_move(B, {"letter": letter})

    assert game.points[0] == GALLOWS  # alice's word held
    assert game.previous == {"word": "HUS", "solved": False, "setter": A}
    # ...and the rotation has moved on: bob owes the next word.
    assert game.setter == 1
    assert game.phase == "setting"


def test_everyone_sets_one_word_and_then_the_game_ends():
    game = seat(Hangman)

    # Round 1: alice sets HUS, bob solves it. Three correct letters, three points.
    set_word(game, "HUS")
    for letter in "HUS":
        game.apply_move(B, {"letter": letter})
    assert game.round == 1
    assert game.setter == 1  # bob owes the next word
    assert not game.over

    # Round 2: bob sets ORD and alice hangs on it. None of these letters are in
    # it -- D would be, and would leave her one short of the gallows.
    game.apply_move(B, {"word": "ORD"})
    for letter in "XZBCFGH"[:MAX_WRONG]:
        game.apply_move(A, {"letter": letter})

    assert game.over
    # Bob: three letters in round 1, plus the gallows for a word alice never got.
    # Alice: guessed nothing right.
    assert game.points == [0, 3 + GALLOWS]
    assert game.winner == B


def test_the_setter_is_skipped_in_the_guessing_order():
    game = seat(Hangman, players=(A, B, C))
    set_word(game, "HUS")  # alice (seat 0) set it

    assert game.turn == 1  # bob guesses first
    game.apply_move(B, {"letter": "X"})
    assert game.turn == 2  # then carol
    game.apply_move(C, {"letter": "Z"})
    assert game.turn == 1  # back to bob -- alice is never asked


# ==========================================================================
# Battleship: the fleet is the secret
# ==========================================================================


def cells_of(game, seat_index):
    return [cell for ship in game.fleets[seat_index] for cell in ship.cells]


def coordinates(payload) -> set[int]:
    """Every integer anywhere in the payload, however deeply buried.

    A cell can hide in a list, in a nested dict, or as a dict KEY -- shots are
    keyed by cell. Walking the whole structure is the point: a hand-written check
    of the fields we happen to remember is what misses the one that matters.
    """
    if isinstance(payload, bool):  # bool subclasses int; it is not a coordinate
        return set()
    if isinstance(payload, int):
        return {payload}
    if isinstance(payload, dict):
        found: set[int] = set()
        for key, value in payload.items():
            if isinstance(key, str) and key.isdigit():
                found.add(int(key))
            found |= coordinates(value)
        return found
    if isinstance(payload, list):
        return {n for item in payload for n in coordinates(item)}
    return set()


def board(game, seat_index: int | None) -> dict:
    """A seat's view, with the board dimension dropped -- `size` is 10, which
    would otherwise read as a coordinate and mask a genuine leak of cell 10."""
    payload = game.view(seat_index)
    payload.pop("size", None)
    return payload


def test_a_fleet_is_hidden_from_the_opponent():
    game = seat(Battleship)
    mine = set(cells_of(game, 0))
    theirs = set(cells_of(game, 1))

    seen = board(game, 0)  # what alice is sent

    # She is shown her own fleet, in full...
    assert {cell for ship in seen["myFleet"] for cell in ship["cells"]} == mine

    # ...and not one cell of bob's that she has not already shot at.
    assert not (theirs - mine) & coordinates(seen)

    # And the same holds the other way round.
    assert {
        cell for ship in board(game, 1)["myFleet"] for cell in ship["cells"]
    } == theirs


def test_a_spectator_sees_neither_fleet():
    """The case people forget: anyone logged in may open a game socket and watch,
    and view(None) is what they get. It has to be the strictest view in the game."""
    game = seat(Battleship)
    watching = board(game, None)

    assert "myFleet" not in watching
    # Ship NAMES are public -- everyone knows a fleet contains a Slagskip. The
    # cells are not, and none of either fleet's may appear.
    assert not (set(cells_of(game, 0)) | set(cells_of(game, 1))) & coordinates(watching)


def test_both_admirals_arrange_at_the_same_time():
    """Placement is not a turn order: neither player waits for the other."""
    game = seat(Battleship)

    assert game._may_move(0)
    assert game._may_move(1)  # both, at once

    game.apply_move(B, {"action": "shuffle"})  # bob acts first; alice is not blocked
    game.apply_move(A, {"action": "shuffle"})


def test_shuffling_moves_the_fleet_but_keeps_it_legal():
    game = seat(Battleship)
    before = cells_of(game, 0)

    for _ in range(5):
        game.apply_move(A, {"action": "shuffle"})

    after = cells_of(game, 0)
    assert len(after) == len(before) == sum(length for _, length in _fleet_sizes())
    assert len(set(after)) == len(after)  # no ship overlaps another
    assert all(0 <= cell < SIZE * SIZE for cell in after)


def _fleet_sizes():
    from waiting_games.games.battleship import FLEET

    return FLEET


def test_firing_only_starts_once_both_are_ready():
    game = seat(Battleship)
    game.apply_move(A, {"action": "ready"})

    assert game.phase != FIRING
    with rejected("move.not_your_turn"):
        game.apply_move(A, {"cell": 0})  # alice is ready, but bob is not

    game.apply_move(B, {"action": "ready"})

    assert game.phase == FIRING
    assert game.turn == 0  # the host opens fire, whoever pressed Klar last


def ready_up(game):
    game.apply_move(A, {"action": "ready"})
    game.apply_move(B, {"action": "ready"})


def test_a_shot_reports_a_hit_or_a_miss():
    game = seat(Battleship)
    ready_up(game)

    target = game.fleets[1][0].cells[0]  # a cell alice cannot legitimately know
    game.apply_move(A, {"cell": target})

    assert game.shots[0][target] == HIT

    empty = next(
        cell for cell in range(SIZE * SIZE) if cell not in set(cells_of(game, 1))
    )
    game.apply_move(B, {"cell": 0})  # bob's turn
    game.apply_move(A, {"cell": empty})

    assert game.shots[0][empty] == MISS


def test_you_cannot_shoot_the_same_cell_twice():
    game = seat(Battleship)
    ready_up(game)
    game.apply_move(A, {"cell": 5})
    game.apply_move(B, {"cell": 5})

    with rejected("battleship.already_fired"):
        game.apply_move(A, {"cell": 5})


def test_sinking_the_whole_fleet_wins():
    game = seat(Battleship)
    ready_up(game)

    enemy = cells_of(game, 1)
    spare = [cell for cell in range(SIZE * SIZE) if cell not in set(cells_of(game, 0))]

    for index, cell in enumerate(enemy):
        game.apply_move(A, {"cell": cell})
        if game.over:
            break
        game.apply_move(B, {"cell": spare[index]})  # bob splashes harmlessly

    assert game.over
    assert game.winner == A
    assert set(game.view(0)["sunkBy"][A]) == {name for name, _ in _fleet_sizes()}


# ==========================================================================
# Gris: your hand is the secret, and the nose race is the game
# ==========================================================================


def table(players=(A, B, C)):
    game = Gris()
    for player in players:
        game.add_player(player)
    # Seeded so that a failure in a test which does NOT stack the deal is
    # reproducible rather than a once-a-week mystery. S311 is about cryptography;
    # this is a card game, and games/* is already excused for the same reason.
    game.rng = random.Random(7)  # noqa: S311
    game.start()
    return game


def stack(game, *hands):
    """Deal a hand we chose instead of one the shuffle chose.

    The engine reads self.hands and nothing else, so this is the whole deal. It is
    the only way to write a test about four of a kind that does not amount to
    shuffling until we get one.
    """
    game.hands = [list(hand) for hand in hands]


# Every card that could ever be dealt, at any table size.
DECK = frozenset(deck_for(Gris.max_players))


def cards_in(payload) -> set[str]:
    """Every card anywhere in the payload, however deeply buried.

    Deliberately NOT `leaks`, which is a substring search: a card is two characters
    long, and two characters collide with ordinary English. "AS" is inside "passed"
    -- a key that is in every payload this game sends -- so substring-searching for
    a secret this short reports a leak in every game ever played, including the ones
    that are airtight. Match whole strings instead, and walk the structure to find
    them, exactly as `coordinates` does for Battleship's cells.
    """
    if isinstance(payload, str):
        return {payload} & DECK
    if isinstance(payload, dict):
        found: set[str] = set()
        for key, value in payload.items():
            found |= cards_in(key) | cards_in(value)
        return found
    if isinstance(payload, list):
        return {card for item in payload for card in cards_in(item)}
    return set()


# Three players, so the deck is aces, kings and queens. Alice has four of a kind
# and nobody else is close.
ALICE_HAS_FOUR = (
    ["AS", "AH", "AD", "AC"],
    ["KS", "KH", "KD", "QC"],
    ["QS", "QH", "QD", "KC"],
)

# The same twelve cards, dealt so that nobody has anything.
NOBODY_HAS_FOUR = (
    ["AS", "AH", "AD", "KC"],
    ["KS", "KH", "KD", "QC"],
    ["QS", "QH", "QD", "AC"],
)


# -- the deck ----------------------------------------------------------------


def test_every_rank_has_a_face_in_both_languages():
    """The renderer builds its key from the card: t(`card.rank.${code[0]}`). That is
    a key no static check can see, so a rank with no string in the dictionary does
    not fail a build -- it draws the card face as the literal text "card.rank.6".

    The ranks are Python and the faces are JavaScript, and BOTH card games deal from
    the same dictionary now (static/games/_cards.js) while dealing different cards:
    Gris's deck is derived from its seat count, and Idiot's is the whole 52. So this
    is the union of the two, and it is the only thing holding them together.
    """
    faces = (
        pathlib.Path(__file__).parent.parent / "waiting_games" / "static" / "i18n.js"
    ).read_text()

    for rank in sorted(set(RANKS) | set(IDIOT_RANKS)):
        key = f'"card.rank.{rank.lower()}":'
        # Once per dictionary: English and Norwegian.
        assert faces.count(key) == 2, f"no card face for the {rank}"

    assert Gris.max_players == len(RANKS)  # a seat with no rank has no fourth card


@pytest.mark.parametrize("players", range(Gris.min_players, Gris.max_players + 1))
def test_the_deck_holds_exactly_one_rank_per_player(players):
    """Which is what makes the game finishable at all: four of a kind is only ever
    reachable because every card of every rank in play is already on the table --
    they are merely in the wrong hands. A deck with a spare rank would let a set be
    permanently impossible, and everyone would pass cards forever."""
    cards = deck_for(players)

    assert len(cards) == players * HAND
    assert len(set(cards)) == len(cards)  # no card is dealt twice
    assert len({card[0] for card in cards}) == players  # one rank per player
    assert all(
        cards.count(rank + suit) == 1 for rank in RANKS[:players] for suit in "SHDC"
    )


# -- the secrets -------------------------------------------------------------


def test_a_hand_is_hidden_from_the_other_players():
    game = table()
    stack(game, *ALICE_HAS_FOUR)

    seen = game.view(1)  # what bob is sent

    assert seen["hand"] == ["KS", "KH", "KD", "QC"]  # his own, in full
    assert cards_in(seen) == set(game.hands[1])  # and not one card of anybody else's


def test_a_spectator_sees_no_hand_at_all():
    """The strictest view in the game: anyone logged in may open the socket and
    watch, and a watcher who can see the cards can see who is about to touch."""
    game = table()
    stack(game, *ALICE_HAS_FOUR)

    watching = game.view(None)

    assert "hand" not in watching
    assert "four" not in watching  # nor even a hint that alice is one card away
    assert cards_in(watching) == set()


def test_which_card_you_are_passing_stays_secret():
    """That you have chosen is public -- a card face-down on the table is a thing
    everyone can see. WHICH card it is, is not."""
    game = table()
    stack(game, *NOBODY_HAS_FOUR)

    game.apply_move(A, {"card": "KC"})

    assert game.view(None)["passed"] == [A]  # everyone knows she is ready
    assert game.view(0)["chosen"] == "KC"  # alice, of course, knows what she picked
    # Bob is told a card is coming, and nothing whatever about which one.
    assert cards_in(game.view(1)) == set(game.hands[1])
    assert cards_in(game.view(None)) == set()


# -- passing -----------------------------------------------------------------


def test_everyone_passes_at_once_and_nobody_waits_for_a_turn():
    game = table()

    assert all(game._may_move(seat) for seat in range(3))


def test_the_cards_only_move_when_the_last_player_has_chosen():
    game = table()
    stack(game, *NOBODY_HAS_FOUR)

    game.apply_move(C, {"card": "AC"})
    game.apply_move(A, {"card": "KC"})  # in any order; there is no turn

    assert game.hands[0] == ["AS", "AH", "AD", "KC"]  # nothing has moved yet

    game.apply_move(B, {"card": "QC"})  # ...and now the table turns

    # Each player passed the one card that was blocking someone ELSE's set, so this
    # one pass completes all three at once. It also pins the direction: alice is
    # holding carol's ace, not bob's queen, which is what "to the left" means here.
    assert game.hands == [
        ["AS", "AH", "AD", "AC"],
        ["KS", "KH", "KD", "KC"],
        ["QS", "QH", "QD", "QC"],
    ]
    assert game.view(0)["chosen"] is None  # a fresh choice to make
    assert game.view(None)["passed"] == []


def test_you_cannot_pass_twice_in_a_round():
    game = table()
    stack(game, *NOBODY_HAS_FOUR)
    game.apply_move(A, {"card": "KC"})

    with rejected("gris.already_passed"):
        game.apply_move(A, {"card": "AS"})


@pytest.mark.parametrize("card", ["QH", "ZZ", "", None, True, 7, ["AS"]])
def test_a_card_you_are_not_holding_cannot_be_passed(card):
    """QH is a real card in a real deck -- it is simply in carol's hand."""
    game = table()
    stack(game, *NOBODY_HAS_FOUR)

    with rejected("gris.not_your_card"):
        game.apply_move(A, {"card": card})


def test_a_move_that_is_neither_a_pass_nor_a_touch_is_rejected():
    game = table()

    with rejected("gris.no_move"):
        game.apply_move(A, {"touch": False})


# -- the nose race -----------------------------------------------------------


def test_touching_with_four_of_a_kind_opens_the_race():
    game = table()
    stack(game, *ALICE_HAS_FOUR)

    game.apply_move(A, {"touch": True})

    assert game.view(None)["touched"] == [A]
    assert game.view(None)["caught"] == A  # she is the one who actually had them
    assert game.letters == [0, 0, 0]  # nobody has lost anything yet
    assert not game.over


def test_the_slowest_player_takes_the_letter_without_ever_pressing_anything():
    """The round ends when everybody BUT one has touched. There is nothing left for
    the last player to do, and so there is nothing to wait for -- which is the whole
    reason this game needs no clock. A player who has wandered off loses the round
    instead of hanging it."""
    game = table()
    stack(game, *ALICE_HAS_FOUR)

    game.apply_move(A, {"touch": True})
    game.apply_move(C, {"touch": True})  # carol notices; bob does not

    assert game.letters == [0, 1, 0]  # bob, who never moved, pays
    assert game.view(None)["last"] == {"loser": B, "reason": "slow", "caught": A}


def test_copying_a_nose_needs_no_cards_at_all():
    """Carol has nothing. Once a nose is up she may still save herself, and that is
    the game: you are not racing to collect cards, you are racing to NOTICE."""
    game = table()
    stack(game, *ALICE_HAS_FOUR)
    assert not game._has_four(2)

    game.apply_move(A, {"touch": True})
    game.apply_move(C, {"touch": True})  # legal, and it costs her nothing

    assert game.letters[2] == 0


def test_touching_first_with_nothing_is_a_false_start():
    """The rule that stops a player simply hammering the button every round."""
    game = table()
    stack(game, *NOBODY_HAS_FOUR)

    game.apply_move(B, {"touch": True})

    assert game.letters == [0, 1, 0]
    assert game.view(None)["last"] == {
        "loser": B,
        "reason": "false_start",
        "caught": None,
    }


def test_passing_stops_once_a_nose_is_up():
    game = table()
    stack(game, *ALICE_HAS_FOUR)
    game.apply_move(A, {"touch": True})

    with rejected("gris.hands_are_up"):
        game.apply_move(B, {"card": "KS"})


def test_you_cannot_touch_your_nose_twice():
    game = table()
    stack(game, *ALICE_HAS_FOUR)
    game.apply_move(A, {"touch": True})

    with rejected("gris.already_touched"):
        game.apply_move(A, {"touch": True})


def test_a_lost_round_is_followed_by_a_fresh_deal():
    game = table()
    stack(game, *ALICE_HAS_FOUR)
    game.apply_move(A, {"card": "AS"})  # a card in flight, and a nose about to go up

    game.apply_move(B, {"touch": True})  # bob false starts

    assert game.round == 2
    assert game.view(None)["touched"] == []
    assert game.view(None)["passed"] == []  # alice's committed card is forgotten
    assert sorted(card for hand in game.hands for card in hand) == sorted(deck_for(3))
    assert all(len(hand) == HAND for hand in game.hands)


# -- spelling the word -------------------------------------------------------


def test_spelling_gris_ends_the_game_and_names_the_pig():
    game = table()
    stack(game, *NOBODY_HAS_FOUR)
    game.letters = [LETTERS - 1, 0, 1]  # alice is one bad round from the word

    game.apply_move(A, {"touch": True})  # ...and she false starts

    assert game.over
    assert game.view(None)["pig"] == A
    assert game.view(None)["counts"] == {A: LETTERS, B: 0, C: 1}
    # Fewest letters wins, so the pig is last by construction and bob is clear.
    assert game.winner == B


def test_survivors_who_got_through_equally_unscathed_draw():
    """There is only ever one pig. If the others come out level, saying one of them
    beat the other would be an invention."""
    game = table()
    stack(game, *NOBODY_HAS_FOUR)
    game.letters = [LETTERS - 1, 0, 0]

    game.apply_move(A, {"touch": True})

    assert game.over
    assert game.view(None)["pig"] == A
    assert game.winner is None  # a draw between bob and carol


def test_the_final_view_shows_the_cards_the_game_ended_on():
    """No fresh deal over the top of a finished game."""
    game = table()
    stack(game, *NOBODY_HAS_FOUR)
    game.letters = [LETTERS - 1, 0, 0]

    game.apply_move(A, {"touch": True})

    assert game.round == 1  # never dealt again
    assert game.hands[0] == ["AS", "AH", "AD", "KC"]
