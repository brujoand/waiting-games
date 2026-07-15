"""Draw: the secret is the word, the clock is the round, and the drawing is public.

The leak tests come first, as they do for the other games with secrets: a wrong
score is annoying, but a word leaked to the guessers -- or to a spectator, the case
people forget -- silently ruins the round. The rest pins the two things this game
does that no other does: a clock that ends a ROUND rather than the game, and a
manual Accept that lets the drawer allow a synonym the server could never judge.
"""

from __future__ import annotations

import json

import pytest
from conftest import rejected

from waiting_games.games import CATEGORIES, GAMES, InvalidMove
from waiting_games.games.draw import (
    COORD,
    DRAW,
    DRAWN_WELL,
    GRACE,
    MAX_POINTS,
    SOLVE,
    WORDS,
    Draw,
)

A, B, C = "u-alice", "u-bob", "u-carol"


def table(players=(A, B, C), words=("dog", "cat", "sun")):
    game = Draw(words=list(words))
    for player in players:
        game.add_player(player)
    game.start()
    return game


def leaks(payload: dict, secret: str) -> bool:
    return secret.lower() in json.dumps(payload, default=str).lower()


def start_drawing(game):
    """The drawer puts down a line, which starts the guessing clock."""
    game.apply_move(game.players[game.drawer], {"a": "open", "c": 0, "w": 0})
    game.apply_move(game.players[game.drawer], {"a": "pts", "p": [10, 10, 20, 20]})


# ==========================================================================
# The catalogue
# ==========================================================================


def test_draw_is_registered_on_its_own_shelf():
    assert GAMES["draw"] is Draw
    assert Draw.category == "party"
    assert "party" in CATEGORIES


def test_there_are_enough_distinct_words_for_a_full_table():
    """Every player draws once, and random.sample needs one distinct word per seat.
    Duplicates in the list would also let a word be dealt twice."""
    assert len(set(WORDS)) == len(WORDS)
    assert len(WORDS) >= Draw.max_players


# ==========================================================================
# The word is the secret
# ==========================================================================


def test_the_word_is_hidden_from_the_guessers_and_spectators():
    game = table()  # alice (seat 0) draws "dog"
    assert leaks(game.view(0), "dog")  # the drawer may see it
    assert not leaks(game.view(1), "dog")  # a guesser may not
    assert not leaks(game.view(2), "dog")
    assert not leaks(game.view(None), "dog")  # nor a spectator


def test_the_mask_shows_the_shape_but_not_a_letter():
    game = table(words=("ice cream", "cat", "sun"))
    seen = game.view(1)
    assert seen["mask"] == "___ _____"
    assert "word" not in seen


def test_a_solver_is_shown_the_word_they_earned():
    game = table()
    start_drawing(game)
    game.apply_move(B, {"a": "guess", "text": "dog"})

    assert B in [game.players[s] for s in game.solved]
    assert leaks(game.view(1), "dog")  # bob solved it; nothing left to hide
    assert not leaks(game.view(2), "dog")  # carol has not


def test_a_correct_guess_does_not_broadcast_the_word():
    """The first person to solve it must not hand the answer to everyone else via
    the chat log."""
    game = table()
    start_drawing(game)
    game.apply_move(B, {"a": "guess", "text": "dog"})

    # Carol's view of the log names bob and marks him right, without the word.
    log = game.view(2)["guesses"]
    assert log[0]["who"] == B
    assert log[0]["correct"] is True
    assert "text" not in log[0]
    assert not leaks(game.view(2)["guesses"], "dog")


def test_a_wrong_guess_keeps_its_text_for_the_fun_of_it():
    game = table()
    start_drawing(game)
    game.apply_move(B, {"a": "guess", "text": "wolf"})

    log = game.view(2)["guesses"]
    assert log[0]["text"] == "wolf"
    assert log[0]["correct"] is False


def test_future_words_never_reach_the_wire():
    """self.words holds every round's answer, including the ones not dealt yet."""
    game = table(words=("dog", "elephant", "sun"))
    for seat in (None, 0, 1, 2):
        assert not leaks(game.view(seat), "elephant")


# ==========================================================================
# The waiting room, before the deal
# ==========================================================================


def test_the_board_can_be_looked_at_before_it_is_dealt():
    """The lobby opens the socket and broadcasts view(seat) the instant the session
    exists -- before start(). Every per-seat list is sized in _on_start, so indexing
    one here would be an IndexError on the first socket in."""
    game = Draw(words=["dog", "cat"])
    game.add_player(A)
    game.add_player(B)

    for seat in (None, 0, 1):
        state = game.view(seat)  # must not raise
        assert state["counts"] == {}
        assert state["drawer"] is None
        assert state["strokes"] == []
        assert "word" not in state


# ==========================================================================
# Roles: who may do what
# ==========================================================================


def test_only_the_drawer_may_draw():
    game = table()
    with rejected("draw.not_the_drawer"):
        game.apply_move(B, {"a": "open", "c": 0, "w": 0})


def test_the_drawer_cannot_guess_at_their_own_word():
    game = table()
    start_drawing(game)
    with rejected("draw.drawer_cannot_guess"):
        game.apply_move(A, {"a": "guess", "text": "dog"})


def test_a_spectator_cannot_guess():
    game = table()
    start_drawing(game)
    with rejected("move.not_seated"):
        game.apply_move("u-nobody", {"a": "guess", "text": "dog"})


def test_you_cannot_solve_the_same_round_twice():
    game = table()
    start_drawing(game)
    game.apply_move(B, {"a": "guess", "text": "dog"})
    with rejected("draw.already_solved"):
        game.apply_move(B, {"a": "guess", "text": "dog"})


@pytest.mark.parametrize("text", ["", "   ", "x" * 61, 7, None])
def test_a_bogus_guess_is_rejected(text):
    game = table()
    start_drawing(game)
    with pytest.raises(InvalidMove):
        game.apply_move(B, {"a": "guess", "text": text})


# ==========================================================================
# The drawing
# ==========================================================================


def test_the_first_stroke_starts_the_guessing_clock():
    game = table()
    assert game.phase == "reveal"
    assert game.clock == GRACE

    game.apply_move(A, {"a": "open", "c": 2, "w": 1})

    assert game.phase == "drawing"
    assert game.clock == DRAW


def test_points_accumulate_and_the_picture_is_public():
    game = table()
    start_drawing(game)
    game.apply_move(A, {"a": "pts", "p": [30, 40, 50, 60]})

    strokes = game.view(None)["strokes"]
    assert strokes[0]["p"] == [10, 10, 20, 20, 30, 40, 50, 60]


def test_undo_drops_the_last_stroke_and_clear_empties_the_board():
    game = table()
    game.apply_move(A, {"a": "open", "c": 0, "w": 0})
    game.apply_move(A, {"a": "pts", "p": [1, 1, 2, 2]})
    game.apply_move(A, {"a": "open", "c": 1, "w": 0})
    game.apply_move(A, {"a": "pts", "p": [3, 3]})
    game.apply_move(A, {"a": "undo"})

    assert len(game.strokes) == 1
    assert game.points_used == 2

    game.apply_move(A, {"a": "clear"})
    assert game.strokes == []
    assert game.points_used == 0


def test_the_point_cap_holds_and_out_of_range_coordinates_are_clamped():
    game = table()
    game.apply_move(A, {"a": "open", "c": 0, "w": 0})
    game.apply_move(A, {"a": "pts", "p": [-50, 99999, 10, 20]})
    # First point clamped to the grid; second kept as is.
    assert game.strokes[0]["p"][:4] == [0, COORD, 10, 20]

    game.apply_move(A, {"a": "pts", "p": [0, 0] * (MAX_POINTS + 100)})
    assert game.points_used == MAX_POINTS


def test_a_junk_colour_index_falls_back_rather_than_reaching_out_of_range():
    game = table()
    game.apply_move(A, {"a": "open", "c": 999, "w": -1})
    assert game.strokes[0]["c"] == 0
    assert game.strokes[0]["w"] == 0


# ==========================================================================
# Scoring
# ==========================================================================


def test_a_correct_guess_scores_the_guesser():
    game = table()
    start_drawing(game)
    game.apply_move(B, {"a": "guess", "text": "  DOG  "})  # case and space folded
    assert game.scores[1] == SOLVE


def test_the_drawer_is_paid_once_when_the_round_ends_with_a_solve():
    game = table()
    start_drawing(game)
    game.apply_move(B, {"a": "guess", "text": "dog"})
    game.apply_move(C, {"a": "guess", "text": "dog"})  # a second solver, no extra bonus

    assert game.phase == "drawing"  # nothing ends a round but the clock
    game.tick(0.1)  # everyone has solved -> the round ends here
    assert game.phase == "recap"
    assert game.scores[0] == DRAWN_WELL  # alice, once
    assert game.scores[1] == SOLVE
    assert game.scores[2] == SOLVE


def test_the_drawer_earns_nothing_if_nobody_gets_it():
    game = table()
    start_drawing(game)
    game.clock = 0.0
    game.tick(0.1)
    assert game.phase == "recap"
    assert game.scores[0] == 0


# ==========================================================================
# The clock, and the shape of a round
# ==========================================================================


def test_a_drawer_who_never_draws_ends_the_round_at_the_grace():
    game = table()
    assert game.phase == "reveal"
    game.clock = 0.0
    game.tick(0.1)
    assert game.phase == "recap"
    assert game.previous["solvers"] == []


def test_the_recap_reveals_the_word_to_everyone():
    game = table()
    start_drawing(game)
    game.clock = 0.0
    game.tick(0.1)  # -> recap

    assert game.phase == "recap"
    assert game.view(None)["word"] == "dog"  # public now the round is over
    assert game.view(1)["word"] == "dog"


def test_everyone_draws_once_and_then_the_game_ends_on_points():
    game = table(players=(A, B), words=("dog", "cat"))

    # Round 1: alice draws "dog", bob solves it.
    assert game.drawer == 0
    start_drawing(game)
    game.apply_move(B, {"a": "guess", "text": "dog"})
    game.tick(0.1)  # all guessers solved -> recap
    assert game.phase == "recap"

    game.clock = 0.0
    game.tick(0.1)  # recap over -> round 2
    assert game.round == 1
    assert game.drawer == 1  # bob takes the pen
    assert game.word == "cat"
    assert not game.over

    # Round 2: bob draws "cat", alice does not get it.
    start_drawing(game)
    game.clock = 0.0
    game.tick(0.1)  # draw clock out -> recap
    game.clock = 0.0
    game.tick(0.1)  # recap over -> game over

    assert game.over
    # Alice drew "dog" (bob solved it, so +2) and never got "cat" herself. Bob solved
    # "dog" (+5) and drew "cat" that nobody got (+0). So bob leads.
    assert game.scores == [DRAWN_WELL, SOLVE]
    assert game.winner == B


# ==========================================================================
# The drawer accepts a synonym
# ==========================================================================


def test_the_drawer_can_accept_a_synonym_the_server_would_reject():
    game = table()
    start_drawing(game)
    game.apply_move(B, {"a": "guess", "text": "puppy"})  # wrong, to the server
    guess_id = game.guesses[0]["id"]

    game.apply_move(A, {"a": "accept", "id": guess_id})

    assert game.scores[1] == SOLVE
    assert B in [game.players[s] for s in game.solved]
    # Once accepted, an accepted near-miss stops carrying its text too.
    assert "text" not in game.view(2)["guesses"][0]
    assert game.view(2)["guesses"][0]["correct"] is True


def test_only_the_drawer_may_accept():
    game = table()
    start_drawing(game)
    game.apply_move(B, {"a": "guess", "text": "puppy"})
    with rejected("draw.not_the_drawer"):
        game.apply_move(C, {"a": "accept", "id": game.guesses[0]["id"]})


def test_accepting_an_unknown_guess_is_refused():
    game = table()
    start_drawing(game)
    with rejected("draw.no_such_guess"):
        game.apply_move(A, {"a": "accept", "id": 999})


def test_an_unknown_action_is_refused():
    game = table()
    with rejected("draw.unknown_action"):
        game.apply_move(A, {"a": "wiggle"})
