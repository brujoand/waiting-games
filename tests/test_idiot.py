"""Idiot: the third game with secrets, and the first with two kinds of them.

The leak tests come first, as they do in test_hidden.py, because they are the only
tests here that protect something a player cannot undo. A rule that scores wrong is
annoying; a hand visible to the table -- or to a spectator, who is the case people
forget -- silently ruins every game of it.

And there is a secret in this game that no other game has: a face-down card is
hidden from ITS OWN OWNER. It is the only reason turning one over is exciting, and
a view() that helpfully included it would take the game with it.
"""

from __future__ import annotations

import json
import random

import pytest
from conftest import rejected

from waiting_games.games.base import InvalidMove
from waiting_games.games.idiot import (
    BURN,
    DEAL,
    DOWN,
    HAND,
    PLAYING,
    RANKS,
    RESET,
    Card,
    Idiot,
)

A, B, C = "u-alice", "u-bob", "u-carol"


def card(code: str) -> Card:
    """ "TH" -> the ten of hearts. The tests are unreadable without this."""
    return Card(RANKS.index(code[0]) + 2, code[1])


def cards(*codes: str) -> list[Card]:
    return [card(code) for code in codes]


def seat(players=(A, B)) -> Idiot:
    game = Idiot()
    for player in players:
        game.add_player(player)
    game.start()
    return game


def ready_up(game: Idiot) -> None:
    for player in game.players:
        game.apply_move(player, {"action": "ready"})


def playing(players=(A, B), **hands) -> Idiot:
    """A game past the deal, with the cards put exactly where the test wants them.

    The shuffle is a real shuffle, so every rule below would otherwise be a test of
    whatever happened to come off the top of the deck.
    """
    game = seat(players)
    ready_up(game)

    for index in range(len(game.players)):
        game.hands[index] = list(hands.get(f"hand{index}", []))
        game.ups[index] = list(hands.get(f"up{index}", []))
        game.downs[index] = list(hands.get(f"down{index}", []))

    game.stock = list(hands.get("stock", []))
    game.pile = list(hands.get("pile", []))
    return game


def play(game: Idiot, player: str, *codes: str) -> None:
    """Play these cards by name, whatever order they are sitting in."""
    held = game._pile_of(game.seat_of(player), game.source(game.seat_of(player)))
    game.apply_move(player, {"cards": [held.index(card(code)) for code in codes]})


def leaks(payload: dict, card_codes: list[str]) -> bool:
    """Is any of these cards anywhere in what we would put on the wire?

    Serialised, not walked. A card buried in a nested dict or a list is still a
    card, and a hand-written recursive check is exactly the kind of thing that
    misses the one path that matters.
    """
    wire = json.dumps(payload, default=str)
    return any(f'"{code}"' in wire for code in card_codes)


# ==========================================================================
# The secrets
# ==========================================================================


def codes(hand: list[Card]) -> list[str]:
    return [c.code for c in hand]


def test_a_hand_is_hidden_from_the_other_players():
    game = seat()

    assert not leaks(game.view(1), codes(game.hands[0]))  # bob cannot see alice's
    assert not leaks(game.view(0), codes(game.hands[1]))
    assert game.view(0)["hand"] == codes(game.hands[0])  # ...but she sees her own


def test_a_hand_is_hidden_from_a_spectator():
    """Anyone logged in may open a game socket and watch, and view(None) is what
    they get. It has to be the strictest view in the game."""
    game = seat()
    watching = game.view(None)

    assert "hand" not in watching
    assert not leaks(watching, codes(game.hands[0]) + codes(game.hands[1]))


def test_a_face_down_card_is_hidden_from_its_own_owner():
    """The one secret this game has that no other does. You do not know what you
    are about to turn over -- nobody does -- and a view() that told you would take
    the last three cards of the game with it."""
    game = seat()

    for watcher in (0, 1, None):
        assert not leaks(game.view(watcher), codes(game.downs[0]))
        assert not leaks(game.view(watcher), codes(game.downs[1]))

    # Only the count. That is what a face-down card is: a card-shaped fact.
    assert game.view(0)["table"][A]["down"] == DEAL


def test_the_stock_is_hidden_from_everyone():
    """The cards still to be drawn are not anybody's, and knowing what is coming
    would be worth more than knowing any single hand."""
    game = seat()

    assert game.view(0)["stock"] == 52 - 2 * 3 * DEAL
    assert not leaks(game.view(0), codes(game.stock))
    assert not leaks(game.view(None), codes(game.stock))


def test_a_card_face_up_on_the_table_is_public():
    """The other half of the same coin: these are face UP, and hiding them would
    be hiding something every player at a real table can see."""
    game = seat()

    assert game.view(None)["table"][A]["up"] == codes(game.ups[0])


# ==========================================================================
# The deal
# ==========================================================================


def test_everybody_gets_nine_cards_and_the_rest_is_stock():
    game = seat((A, B, C))

    for index in range(3):
        assert len(game.hands[index]) == DEAL
        assert len(game.ups[index]) == DEAL
        assert len(game.downs[index]) == DEAL

    assert len(game.stock) == 52 - 3 * 3 * DEAL

    dealt = [
        c
        for index in range(3)
        for c in game.hands[index] + game.ups[index] + game.downs[index]
    ]
    assert len(set(dealt + game.stock)) == 52  # every card exactly once


def test_everybody_swaps_at_the_same_time():
    """The deal is not a turn order: nobody is waiting for anybody."""
    game = seat()

    assert game._may_move(0)
    assert game._may_move(1)  # both, at once

    game.apply_move(B, {"action": "swap", "hand": 0, "up": 0})  # bob first
    game.apply_move(A, {"action": "swap", "hand": 0, "up": 0})  # alice is not blocked


def test_a_swap_exchanges_a_hand_card_for_a_face_up_one():
    game = seat()
    hand, up = game.hands[0][1], game.ups[0][2]

    game.apply_move(A, {"action": "swap", "hand": 1, "up": 2})

    assert game.ups[0][2] == hand
    assert game.hands[0][1] == up


def test_nobody_plays_until_everybody_is_ready():
    game = seat()
    game.apply_move(A, {"action": "ready"})

    assert game.phase != PLAYING
    with rejected("move.not_your_turn"):
        game.apply_move(A, {"cards": [0]})  # alice is ready; bob is still swapping

    game.apply_move(B, {"action": "ready"})

    assert game.phase == PLAYING
    assert game.turn == 0  # the host leads, whoever pressed Ready last


def test_a_ready_player_cannot_go_on_swapping():
    game = seat()
    game.apply_move(A, {"action": "ready"})

    with rejected("move.not_your_turn"):
        game.apply_move(A, {"action": "swap", "hand": 0, "up": 0})


# ==========================================================================
# Beating the pile
# ==========================================================================


def test_a_card_must_be_at_least_as_high_as_the_top_of_the_pile():
    game = playing(hand0=cards("5H"), pile=cards("9S"))

    with rejected("idiot.too_low"):
        play(game, A, "5H")


def test_the_same_rank_lands_on_itself():
    game = playing(hand0=cards("9H"), pile=cards("9S"))

    play(game, A, "9H")

    assert game.pile[-1] == card("9H")


def test_anything_lands_on_an_empty_pile():
    game = playing(hand0=cards("3C"))

    play(game, A, "3C")

    assert game.pile == cards("3C")


def test_a_two_plays_on_anything_and_resets_the_pile():
    game = playing(hand0=cards("2C", "8H"), hand1=cards("3D", "8S"), pile=cards("AS"))

    play(game, A, "2C")  # nothing beats an ace, but a 2 does not have to

    assert game.pile[-1] == card("2C")

    play(game, B, "3D")  # ...and now a 3 clears the pile the ace was on top of

    assert game.pile[-1] == card("3D")


def test_several_of_the_same_rank_go_down_together():
    game = playing(hand0=cards("7H", "7S"), pile=cards("5C"))

    play(game, A, "7H", "7S")

    assert game.pile == cards("5C", "7H", "7S")


# ==========================================================================
# The burn
# ==========================================================================


def test_a_ten_burns_the_pile_and_you_play_again():
    game = playing(hand0=cards("TH", "4S"), hand1=cards("6D"), pile=cards("9S", "9H"))

    play(game, A, "TH")

    assert game.pile == []
    assert game.burnt == 3  # the two nines and the ten that ate them
    assert game.turn == 0  # ...and the pile is gone, so it is still alice's


def test_a_fourth_of_a_kind_burns_the_pile_even_across_turns():
    """The four sevens do not have to arrive together. They have to end up on top
    of each other."""
    game = playing(
        hand0=cards("7H", "7S", "3D"),
        hand1=cards("7D", "7C", "4D"),
        pile=cards("5C"),
    )

    play(game, A, "7H", "7S")
    play(game, B, "7D", "7C")

    assert game.pile == []
    assert game.burnt == 5  # the five, and the four sevens that buried it
    assert game.turn == 1  # bob burned it, so bob goes again


def test_four_of_a_kind_that_is_not_on_top_does_not_burn():
    game = playing(hand0=cards("7H", "7S", "7D", "7C"), pile=cards("5C"))

    play(game, A, "7H", "7S", "7D")
    assert game.pile == cards("5C", "7H", "7S", "7D")  # three is not four

    play(game, A, "7C")
    assert game.pile == []  # ...and now it is


def test_burning_with_your_last_card_does_not_hand_you_a_turn_you_cannot_take():
    """You go again when you burn -- unless burning was the last thing you had to
    do, in which case you are out and the turn belongs to somebody else."""
    game = playing((A, B, C), hand0=cards("TH"), hand1=cards("4S"), hand2=cards("5S"))

    play(game, A, "TH")

    assert game.out == [0]
    assert game.turn == 1  # not alice, who has nothing left to play again WITH
    assert not game.over  # bob and carol are still holding cards


# ==========================================================================
# Ladders
# ==========================================================================


def test_a_ladder_climbs_in_one_turn():
    game = playing(hand0=cards("7H", "7S", "8D", "9C", "JH"), pile=cards("6S"))

    play(game, A, "7H", "7S", "8D", "9C", "JH")

    # Note what is NOT here: no ten. A ladder steps from the nine to the jack,
    # because a ten does not land on a pile, it destroys one.
    assert game.pile == cards("6S", "7H", "7S", "8D", "9C", "JH")


def test_a_ladder_lands_lowest_first_however_it_was_clicked():
    """The pile has to end up with the ladder's HIGHEST card on top, or the next
    player is answering the wrong card."""
    game = playing(hand0=cards("5H", "3D", "4S"))

    play(game, A, "5H", "3D", "4S")  # clicked in a daft order

    assert game.pile == cards("3D", "4S", "5H")


def test_a_ladder_must_still_clear_the_pile():
    game = playing(hand0=cards("3H", "4S", "5D"), pile=cards("9S"))

    with rejected("idiot.too_low"):
        play(game, A, "3H", "4S", "5D")


def test_a_gap_is_not_a_ladder():
    game = playing(hand0=cards("3H", "5S"))

    with rejected("idiot.bad_combination"):
        play(game, A, "3H", "5S")


def test_a_ten_is_not_a_rung():
    game = playing(hand0=cards("9H", "TS", "JD"))

    with rejected("idiot.bad_combination"):
        play(game, A, "9H", "TS", "JD")


def test_a_two_is_played_alone():
    game = playing(hand0=cards("2H", "3S", "4D", "5C"))

    with rejected("idiot.bad_combination"):
        play(game, A, "2H", "3S", "4D", "5C")


# ==========================================================================
# Picking the pile up
# ==========================================================================


def test_a_player_who_cannot_play_takes_the_pile():
    game = playing(hand0=cards("3H", "4S"), hand1=cards("5D"), pile=cards("9S", "KH"))

    game.apply_move(A, {"action": "pickup"})

    assert game.pile == []
    assert sorted(game.hands[0], key=lambda c: c.rank) == cards("3H", "4S", "9S", "KH")
    assert game.turn == 1  # and the turn moves on


def test_a_player_who_can_play_may_not_take_the_pile():
    """Otherwise the pile is a place to dump a hand you do not like, and a player
    losing on purpose can stall the table forever."""
    game = playing(hand0=cards("3H", "KS"), pile=cards("9S"))

    with rejected("idiot.must_play"):
        game.apply_move(A, {"action": "pickup"})


def test_there_is_nothing_to_pick_up_from_an_empty_pile():
    game = playing(hand0=cards("3H"))

    with rejected("idiot.pile_empty"):
        game.apply_move(A, {"action": "pickup"})


# ==========================================================================
# Running out: the stock, the table, and the three you never saw
# ==========================================================================


def test_you_draw_back_up_to_three_while_the_stock_lasts():
    game = playing(hand0=cards("5H"), stock=cards("9C", "KD"))

    play(game, A, "5H")

    assert len(game.hands[0]) == 2  # the stock had two left, so it gave both
    assert game.stock == []


def test_you_cannot_be_left_empty_handed_while_the_stock_has_cards():
    game = playing(hand0=cards("5H"), stock=cards("9C", "KD", "3S", "4S"))

    play(game, A, "5H")

    assert len(game.hands[0]) == DEAL
    assert game.source(0) == "hand"


def test_the_face_up_cards_come_into_play_when_the_hand_and_the_stock_are_empty():
    game = playing(hand0=[], up0=cards("QH", "3S", "4D"), hand1=cards("5C"))

    assert game.source(0) == "up"

    play(game, A, "QH")  # played straight off the table

    assert game.ups[0] == cards("3S", "4D")
    assert game.pile == cards("QH")


def test_picking_the_pile_up_puts_you_back_in_hand():
    """Your face-up cards wait on the table until your hand is empty again."""
    game = playing(hand0=[], up0=cards("3S"), hand1=cards("5C"), pile=cards("KH"))

    game.apply_move(A, {"action": "pickup"})

    assert game.source(0) == "hand"  # the pile is in her hand now
    assert game.ups[0] == cards("3S")  # ...and the 3 is still on the table


def test_a_face_down_card_that_fits_stays_on_the_pile():
    game = playing(hand0=[], up0=[], down0=cards("KH", "4S"), pile=cards("9S"))

    game.apply_move(A, {"cards": [0]})  # she picks one, not knowing what it is

    assert game.pile == cards("9S", "KH")
    assert game.downs[0] == cards("4S")
    assert game.hands[0] == []


def test_a_face_down_card_that_misses_takes_the_pile_with_it():
    game = playing(hand0=[], up0=[], down0=cards("4S", "KH"), pile=cards("9S", "QC"))

    game.apply_move(A, {"cards": [0]})  # the 4 -- and she had no way of knowing

    assert game.pile == []
    assert sorted(game.hands[0], key=lambda c: c.rank) == cards("4S", "9S", "QC")
    assert game.downs[0] == cards("KH")


def test_a_face_down_card_is_turned_over_one_at_a_time():
    game = playing(hand0=[], up0=[], down0=cards("KH", "AS"))

    with rejected("idiot.one_blind_card"):
        game.apply_move(A, {"cards": [0, 1]})


# ==========================================================================
# The idiot
# ==========================================================================


def test_the_last_player_holding_cards_is_the_idiot():
    game = playing(hand0=cards("AS"), hand1=cards("3C"))

    play(game, A, "AS")  # alice is out: nothing in hand, on the table or under it

    assert game.over
    assert game.out == [0]
    assert game.winner == A  # ...which leaves bob holding the whole game
    assert game.view(None)["finished"] == [A]
    assert not game.view(None)["table"][B]["out"]


def test_the_first_player_out_wins_and_the_game_runs_on_to_find_the_idiot():
    game = playing(
        (A, B, C),
        hand0=cards("AS"),
        hand1=cards("2C", "3C"),
        hand2=cards("4D"),
        pile=cards("KH"),
    )

    play(game, A, "AS")  # out, and first
    assert game.out == [0]
    assert not game.over
    assert game.turn == 1  # alice is skipped from here on

    play(game, B, "2C")  # bob resets the pile
    assert game.turn == 2

    play(game, C, "4D")
    assert game.out == [0, 2]  # carol is out too
    assert game.over
    assert game.winner == A  # the first one out
    # ...and bob, holding his 3, is the idiot. The platform can only record a
    # winner, so the table is where the idiot is written.
    assert game.view(None)["table"][B]["out"] is False
    assert game.view(None)["finished"] == [A, C]


# ==========================================================================
# A refused move changes nothing
# ==========================================================================


def test_a_refused_move_leaves_no_footprint():
    """A move that raises must not have moved anything first -- the player is told
    no and the table is exactly as they found it."""
    game = playing(hand0=cards("3H", "KS"), pile=cards("9S"))
    before = (list(game.hands[0]), list(game.pile), game.plays)

    with rejected("idiot.too_low"):
        play(game, A, "3H")

    assert (game.hands[0], game.pile, game.plays) == before


@pytest.mark.parametrize(
    "move",
    [
        {"cards": []},
        {"cards": [9]},  # no such card
        {"cards": [0, 0]},  # the same card twice
        {"cards": [-1]},
        {"cards": "0"},
        {"cards": [True]},  # a bool is an int, and it is not a card
        # Junk from the socket. An unhashable thing in that list used to be a
        # TypeError rather than a refusal, and a TypeError is not a move being
        # rejected, it is the handler falling over.
        {"cards": [{}]},
        {"cards": [[0]]},
        {"cards": [None]},
        {"action": "nonsense"},
        {},
    ],
)
def test_a_bogus_move_is_rejected(move):
    game = playing(hand0=cards("3H", "4S"))

    with pytest.raises(InvalidMove):
        game.apply_move(A, move)


# ==========================================================================
# A whole game, played by somebody who can only see what a player can see
# ==========================================================================


def value(code: str) -> int:
    """A card's rank, from the two characters the wire carries it as."""
    return RANKS.index(code[0]) + 2


def goes_on(code: str, pile: list[str]) -> bool:
    if value(code) in (RESET, BURN):
        return True
    return not pile or value(code) >= value(pile[-1])


def a_legal_move(view: dict, me: str, rng: random.Random) -> dict:
    """Pick a move out of a player's VIEW -- not out of the game.

    Which is the point of it. A bot that reaches into the engine only proves the
    engine can be played by the engine; this one is handed exactly what the browser
    is handed, so if the view were missing something the game needs, it could not
    find a move either.
    """
    seat = view["table"][me]
    source = seat["source"]

    if source == DOWN:
        return {"cards": [rng.randrange(seat["down"])]}  # nothing to choose

    held = view["hand"] if source == HAND else seat["up"]
    playable = [i for i, code in enumerate(held) if goes_on(code, view["pile"])]
    if not playable:
        return {"action": "pickup"}

    # The lowest card that will go, and every other card of that rank with it --
    # which is the only way four of a kind ever comes off a hand.
    lowest = min(playable, key=lambda i: value(held[i]))
    return {"cards": [i for i in playable if value(held[i]) == value(held[lowest])]}


@pytest.mark.parametrize("seats", range(Idiot.min_players, Idiot.max_players + 1))
def test_a_game_always_ends_and_never_loses_a_card(seats):
    """The two ways a card game fails silently, at every seat count it has.

    A DEADLOCK first: cards only leave the game by burning, and a player who cannot
    play takes the pile back into their hand -- so a table where nobody can reduce
    their cards would simply pass the same pile around for ever, and the game would
    hang rather than crash. And card CONSERVATION: every one of the 52 is in exactly
    one place -- a hand, a table, a pile, the stock or the fire -- and a rule that
    copies one or drops one is a rule that looks perfectly fine until somebody counts.
    """
    longest = 0

    for trial in range(10):
        game = Idiot()
        for index in range(seats):
            game.add_player(f"u-{index}")
        # A different deal every trial, and the same ten deals every run: a rule
        # that breaks on one shuffle in a hundred should fail the same way twice.
        game.rng = random.Random(trial)  # noqa: S311
        game.start()
        ready_up(game)

        rng = random.Random(trial)  # noqa: S311
        moves = 0

        while not game.over:
            player = game.players[game.turn]
            game.apply_move(player, a_legal_move(game.view(game.turn), player, rng))
            moves += 1

            held = sum(
                len(game.hands[s]) + len(game.ups[s]) + len(game.downs[s])
                for s in range(seats)
            )
            assert held + game.burnt + len(game.pile) + len(game.stock) == 52
            assert moves < 5000, f"{seats} players: the game would not end"

        still = [s for s in range(seats) if not game._finished(s)]
        assert len(still) == 1  # exactly one idiot, every time
        assert game.idiot == game.players[still[0]]
        assert game.winner == game.players[game.out[0]]  # ...and the first one out won
        assert len(game.out) == seats - 1
        longest = max(longest, moves)

    assert longest > 5  # a game that ended in three moves proves nothing
