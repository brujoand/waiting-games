"""Hangman and Battleship: the two games with secrets.

The leak tests come first because they are the only tests here that protect
something a player cannot simply undo. A bug in the scoring is annoying; a fleet
visible to the opponent -- or to a spectator, who is the case people forget --
silently ruins every game.
"""

from __future__ import annotations

import json
import unicodedata

import pytest

from waiting_games.games import InvalidMove
from waiting_games.games.battleship import FIRING, HIT, MISS, SIZE, Battleship
from waiting_games.games.hangman import GALLOWS, MAX_WRONG, Hangman

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

    with pytest.raises(InvalidMove, match="it is not your turn"):
        game.apply_move(A, {"letter": "H"})


def test_the_same_letter_cannot_be_tried_twice():
    game = seat(Hangman)
    set_word(game, "HUS")
    game.apply_move(B, {"letter": "H"})

    with pytest.raises(InvalidMove, match="already been tried"):
        game.apply_move(B, {"letter": "H"})


@pytest.mark.parametrize("word", ["NO", "A" * 21, "HUND!", "123", "", 7])
def test_a_bogus_word_is_rejected(word):
    game = seat(Hangman)

    with pytest.raises(InvalidMove):
        game.apply_move(A, {"word": word})


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
    with pytest.raises(InvalidMove, match="it is not your turn"):
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

    with pytest.raises(InvalidMove, match="already fired there"):
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
