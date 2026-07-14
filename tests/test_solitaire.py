"""Solitaire: the secret nobody owns, and the dead board.

Two things here are worth more than the rest of the file.

The first is the leak. Every other secret on this platform belongs to a player --
Battleship's fleet, Gris's hand, Idiot's three face-down cards -- and the test is
that the OTHER players cannot see it. This secret belongs to nobody: the face-down
cards are hidden from the only person playing. So there is no seat to compare
against, and the check is simply that the cards which are face-down are not on the
wire, in any view, at all.

The second is _stuck(). It is the one piece of arithmetic in the game that can be
wrong in a way the player would never forgive: end a run that still had a move in
it, and they lose a game they were winning and have no way to tell you so.
"""

from __future__ import annotations

import pytest
from conftest import rejected

from waiting_games.games.solitaire import COLUMNS, RANKS, SUITS, Solitaire, deck

A = "u-alice"

DECK = frozenset(deck())


def dealt(seed: int = 7) -> Solitaire:
    game = Solitaire()
    game.add_player(A)
    # Seeded, so a failure in a test that does NOT stack the board is reproducible
    # rather than a once-a-week mystery.
    game.rng.seed(seed)
    game.start()
    return game


def board(
    columns: list[list[str]],
    *,
    hidden: list[int] | None = None,
    stock: list[str] | None = None,
    waste: list[str] | None = None,
    foundations: list[list[str]] | None = None,
) -> Solitaire:
    """A position we chose instead of one the shuffle chose.

    The engine reads these five fields and nothing else, so this is the whole board.
    It is the only way to write a test about a dead end that does not amount to
    dealing until we get one.
    """
    game = dealt()
    game.columns = [list(column) for column in columns]
    game.hidden = list(hidden) if hidden else [0] * COLUMNS
    game.stock = list(stock or [])
    game.waste = list(waste or [])
    game.foundations = [list(pile) for pile in (foundations or [[], [], [], []])]
    return game


def cards_in(payload) -> set[str]:
    """Every card anywhere in the payload, however deeply buried.

    Whole strings, walked -- not a substring search. A card is two characters and
    two characters collide with ordinary English ("AS" is inside "passed"), which is
    the lesson Gris's tests already paid for.
    """
    if isinstance(payload, str):
        return {payload} & DECK
    if isinstance(payload, dict):
        found: set[str] = set()
        for key, item in payload.items():
            found |= cards_in(key) | cards_in(item)
        return found
    if isinstance(payload, list):
        return {card for item in payload for card in cards_in(item)}
    return set()


def face_down(game: Solitaire) -> set[str]:
    """Every card the player has not been shown: the stock, and the buried ones."""
    buried = {
        card
        for index, column in enumerate(game.columns)
        for card in column[: game.hidden[index]]
    }
    return buried | set(game.stock)


# -- the deal ----------------------------------------------------------------


def test_the_deal_is_twenty_eight_cards_on_the_table_and_the_rest_in_the_stock():
    game = dealt()

    assert [len(column) for column in game.columns] == [1, 2, 3, 4, 5, 6, 7]
    assert game.hidden == [0, 1, 2, 3, 4, 5, 6]  # every card but the top of each
    assert len(game.stock) == 52 - 28
    assert game.waste == []
    assert game.foundations == [[], [], [], []]

    # Fifty-two cards, each dealt exactly once.
    everywhere = [card for column in game.columns for card in column] + game.stock
    assert sorted(everywhere) == sorted(deck())


def test_every_column_shows_exactly_one_card():
    game = dealt()

    for index in range(COLUMNS):
        assert len(game._up(index)) == 1


# -- the secret nobody owns ---------------------------------------------------


def test_a_face_down_card_is_never_on_the_wire():
    game = dealt()
    hidden = face_down(game)

    assert len(hidden) == 21 + 24  # the buried ones, and the whole stock
    assert not cards_in(game.view(0)) & hidden


def test_the_player_and_the_spectator_see_the_same_board():
    """There is no view() override, and this is the test that says so on purpose.

    The face-down cards are kept from the player as well, so the strictest view is
    the ONLY view -- and that is the way round that is safe. A game that grew a
    seat-specific view later would have to break this test to do it.
    """
    game = dealt()

    assert game.view(0) == game.view(None)
    assert not cards_in(game.view(None)) & face_down(game)


def test_the_stock_is_a_number_and_not_a_list_of_cards():
    game = dealt()

    assert game.view(0)["stock"] == 24


def test_a_card_turned_over_stops_being_a_secret():
    game = dealt()
    game.apply_move(A, {"draw": True})

    turned = game.waste[-1]

    assert turned in cards_in(game.view(0))
    assert turned not in face_down(game)


def test_the_card_under_a_run_that_leaves_turns_itself_over():
    # A red six on a black seven, and a face-down card under the seven.
    game = board(
        [["2C", "7S"], ["8H"], [], [], [], [], []],
        hidden=[1, 0, 0, 0, 0, 0, 0],
    )
    assert cards_in(game.view(0)) == {"7S", "8H"}  # the 2C is under the seven

    game.apply_move(A, {"card": "7S", "to": "t1"})

    assert game.columns[0] == ["2C"]
    assert game.hidden[0] == 0  # it turned over
    assert cards_in(game.view(0)) == {"2C", "7S", "8H"}


# -- drawing ------------------------------------------------------------------


def test_drawing_turns_one_card_at_a_time():
    game = dealt()
    next_up = game.stock[-1]

    game.apply_move(A, {"draw": True})

    assert game.waste == [next_up]
    assert len(game.stock) == 23


def test_an_empty_stock_takes_the_waste_back_in_the_order_it_came_off():
    """A player who was paying attention already knows what is coming. That is not a
    leak, it is the game -- and it is only true if the order survives the recycle."""
    game = board([[], [], [], [], [], [], []], stock=["9C", "5D", "KH"])

    order = []
    for _ in range(3):
        game.apply_move(A, {"draw": True})
        order.append(game.waste[-1])

    assert order == ["KH", "5D", "9C"]  # the last card dealt is the first one turned
    assert game.stock == []

    game.apply_move(A, {"draw": True})  # round again

    assert game.waste == []
    assert game.recycles == 1

    again = []
    for _ in range(3):
        game.apply_move(A, {"draw": True})
        again.append(game.waste[-1])

    assert again == order


def test_drawing_from_nothing_is_rejected():
    game = board([["KS"], [], [], [], [], [], []])

    with rejected("solitaire.nothing_to_draw"):
        game.apply_move(A, {"draw": True})


# -- the columns --------------------------------------------------------------


def test_a_card_goes_on_the_opposite_colour_one_rank_up():
    game = board([["9S"], [], [], [], [], [], []], waste=["8H"])

    game.apply_move(A, {"card": "8H", "to": "t0"})

    assert game.columns[0] == ["9S", "8H"]
    assert game.waste == []


@pytest.mark.parametrize("card", ["8S", "7H", "TH"])
def test_a_card_of_the_wrong_colour_or_rank_does_not_fit(card):
    """The black eight is the right rank and the wrong colour; the red seven is the
    right colour and the wrong rank; the red ten is going the wrong way entirely."""
    game = board([["9S"], [], [], [], [], [], []], waste=[card])

    with rejected("solitaire.does_not_fit"):
        game.apply_move(A, {"card": card, "to": "t0"})


def test_an_empty_column_belongs_to_a_king():
    game = board([[], [], [], [], [], [], []], waste=["QH"])

    with rejected("solitaire.needs_a_king"):
        game.apply_move(A, {"card": "QH", "to": "t0"})

    game.waste = ["KH"]
    game.apply_move(A, {"card": "KH", "to": "t0"})

    assert game.columns[0] == ["KH"]


def test_a_run_moves_with_the_card_it_is_sitting_on():
    """Pick up the nine and the eight and the seven come with it -- and they are a
    legal run by construction, because there is no other way they could have got
    there."""
    game = board([["9S", "8H", "7C"], ["TH"], [], [], [], [], []])

    game.apply_move(A, {"card": "9S", "to": "t1"})

    assert game.columns[0] == []
    assert game.columns[1] == ["TH", "9S", "8H", "7C"]


def test_a_card_from_the_middle_of_a_run_takes_the_rest_with_it():
    # The eight moves to the OTHER black nine -- a red eight on a red nine is not a
    # move, which is the rule doing its job and not a smaller board being convenient.
    game = board([["9S", "8H", "7C"], ["9C"], [], [], [], [], []])

    game.apply_move(A, {"card": "8H", "to": "t1"})

    assert game.columns[0] == ["9S"]
    assert game.columns[1] == ["9C", "8H", "7C"]


# -- the foundations ----------------------------------------------------------


def test_the_foundations_fill_up_from_the_ace():
    game = board([["AS"], ["2S"], [], [], [], [], []])

    game.apply_move(A, {"card": "AS", "to": "f"})

    assert game.foundations[SUITS.index("S")] == ["AS"]
    assert game.view(0)["score"] == 1

    game.apply_move(A, {"card": "2S", "to": "f"})

    assert game.foundations[SUITS.index("S")] == ["AS", "2S"]


def test_a_card_out_of_sequence_is_refused():
    game = board([["3S"], [], [], [], [], [], []])

    with rejected("solitaire.out_of_sequence"):
        game.apply_move(A, {"card": "3S", "to": "f"})


def test_the_card_finds_its_own_foundation():
    """`to` is just "f". A card can only ever go to the foundation of its own suit,
    so the browser is never asked which -- and a card dropped on the wrong pile
    lands on the right one."""
    game = board([["AH"], [], [], [], [], [], []])

    game.apply_move(A, {"card": "AH", "to": "f"})

    assert game.foundations[SUITS.index("H")] == ["AH"]
    assert game.foundations[SUITS.index("S")] == []


def test_only_one_card_at_a_time_goes_home():
    game = board([["3H", "2S"], [], [], [], [], [], []], foundations=[["AS"], [], [], []])

    with rejected("solitaire.one_card_at_a_time"):
        game.apply_move(A, {"card": "3H", "to": "f"})


def test_a_card_can_come_back_off_a_foundation():
    """Sometimes it has to: the red four is stuck behind nothing else."""
    game = board(
        [["6H"], [], [], [], [], [], []],
        foundations=[["AS", "2S", "3S", "4S", "5S"], [], [], []],
    )

    game.apply_move(A, {"card": "5S", "to": "t0"})

    assert game.columns[0] == ["6H", "5S"]
    assert game.foundations[SUITS.index("S")] == ["AS", "2S", "3S", "4S"]


# -- what you may not pick up -------------------------------------------------


def test_a_face_down_card_cannot_be_moved():
    game = board([["2C", "7S"], [], [], [], [], [], []], hidden=[1, 0, 0, 0, 0, 0, 0])

    with rejected("solitaire.card_is_face_down"):
        game.apply_move(A, {"card": "2C", "to": "f"})


def test_a_card_still_in_the_stock_cannot_be_moved():
    """The client cannot have clicked it -- it has never seen it. So a client asking
    for one is a client that has guessed, and the answer is the same as if it had
    asked for a card it can see the back of."""
    game = board([["9S"], [], [], [], [], [], []], stock=["AH"])

    with rejected("solitaire.card_is_face_down"):
        game.apply_move(A, {"card": "AH", "to": "f"})


def test_only_the_top_of_the_waste_is_in_play():
    game = board([["9S"], [], [], [], [], [], []], waste=["AH", "8H"])

    with rejected("solitaire.card_is_buried"):
        game.apply_move(A, {"card": "AH", "to": "f"})


def test_only_the_top_of_a_foundation_comes_back_off():
    game = board([["3H"], [], [], [], [], [], []], foundations=[["AS", "2S"], [], [], []])

    with rejected("solitaire.card_is_buried"):
        game.apply_move(A, {"card": "AS", "to": "t0"})


@pytest.mark.parametrize("card", ["ZZ", "", None, True, 7, ["AS"], "10S"])
def test_a_bogus_card_is_rejected(card):
    game = dealt()

    with rejected("solitaire.no_such_card"):
        game.apply_move(A, {"card": card, "to": "f"})


@pytest.mark.parametrize("to", ["t7", "t-1", "x0", "", "f0", None, 3])
def test_a_bogus_destination_is_rejected(to):
    game = board([["KS"], [], [], [], [], [], []])

    with rejected("solitaire.no_such_pile"):
        game.apply_move(A, {"card": "KS", "to": to})


def test_a_move_that_is_neither_a_draw_nor_a_card_is_rejected():
    game = dealt()

    with rejected("solitaire.no_move"):
        game.apply_move(A, {"draw": False})


# -- winning ------------------------------------------------------------------


def full(suit: str) -> list[str]:
    """Every card of a suit but the king, which is what a foundation holds when there
    is exactly one move left in the game."""
    return [rank + suit for rank in RANKS[:-1]]


def test_the_last_four_kings_win_it():
    game = board(
        [["KS"], ["KH"], ["KD"], ["KC"], [], [], []],
        foundations=[full(suit) for suit in SUITS],
    )
    assert game.view(0)["score"] == 48

    for king in ["KS", "KH", "KD", "KC"]:
        assert not game.over
        game.apply_move(A, {"card": king, "to": "f"})

    assert game.over
    assert game.winner == A
    assert game.view(0)["score"] == 52


# -- the dead board -----------------------------------------------------------

# Nothing here can move, and it takes some doing.
#
#   * every column top is BLACK, and a black card only ever lands on a red one, so
#     no card in the game fits any column;
#   * every column is occupied, so no king has anywhere to go;
#   * all four aces are already home, so the foundations want the twos -- and there
#     is not a two anywhere a player can reach;
#   * an ace can come back OFF a foundation, but only onto a black two, and there is
#     no two on any column either.
DEAD_COLUMNS = [["5S"], ["5C"], ["7S"], ["7C"], ["9S"], ["9C"], ["JS"]]
DEAD_FOUNDATIONS = [["AS"], ["AH"], ["AD"], ["AC"]]
DEAD_STOCK = ["3S", "6C", "KC"]  # black, and not a two among them


def test_a_dead_board_is_dead():
    game = board(DEAD_COLUMNS, stock=DEAD_STOCK, foundations=DEAD_FOUNDATIONS)

    assert game._stuck()


def test_the_run_ends_the_moment_the_player_touches_it():
    """A stuck board is stuck whatever you draw -- drawing only changes the order you
    meet the stock in -- so the next click, whatever it is, is the last one."""
    game = board(DEAD_COLUMNS, stock=DEAD_STOCK, foundations=DEAD_FOUNDATIONS)

    game.apply_move(A, {"draw": True})

    assert game.over
    # Nobody to lose TO, so the platform can only call it a draw. The renderer knows
    # better and says so; see solitaire.js.
    assert game.winner is None


def test_a_card_in_the_stock_with_somewhere_to_go_keeps_the_board_alive():
    """The stock is a POOL, not a queue: the six of hearts is at the bottom and it
    does not matter, because it will come round. That is what dealing one card at a
    time buys, and it is the whole reason this check is arithmetic and not a guess.
    """
    game = board(
        DEAD_COLUMNS,
        stock=["6H", *DEAD_STOCK],  # it goes on either black seven, eventually
        foundations=DEAD_FOUNDATIONS,
    )

    assert not game._stuck()


def test_a_two_anywhere_keeps_the_board_alive():
    game = board(
        DEAD_COLUMNS,
        stock=["2H", *DEAD_STOCK],  # the hearts foundation is waiting for it
        foundations=DEAD_FOUNDATIONS,
    )

    assert not game._stuck()


def test_a_king_shuffling_between_two_gaps_is_not_a_move():
    """The one legal move that changes nothing. A column holding a lone king, with no
    face-down card under it, may be lifted into an empty column for ever -- and if
    that counted as a move, no board with a gap in it could ever be declared dead.
    """
    game = board(
        [["KC"], [], ["7S"], ["7C"], ["9S"], ["9C"], ["JS"]],
        stock=["3S", "6C"],
        foundations=DEAD_FOUNDATIONS,
    )

    assert game._fits_column("KC", 1)  # the move is legal...
    assert game._stuck()  # ...and it is not a move


def test_a_gap_a_king_could_actually_fill_keeps_the_board_alive():
    """The other side of that rule, and the one it must not eat: a king with a
    face-down card under it has somewhere to be, because moving it turns that card
    over."""
    game = board(
        [["2C", "KC"], [], ["7S"], ["7C"], ["9S"], ["9C"], ["JS"]],
        hidden=[1, 0, 0, 0, 0, 0, 0],
        stock=["3S", "6C"],
        foundations=DEAD_FOUNDATIONS,
    )

    assert not game._stuck()


def test_a_foundation_that_can_still_come_down_keeps_the_board_alive():
    """The conservative direction. Pulling a card back off a foundation is a move, so
    a board where one can is not dead -- even if it is hopeless. We say "there is
    nothing left to do", never "you cannot win": one of those is arithmetic and the
    other is an opinion.
    """
    game = board(
        [["6H"], ["5C"], ["7S"], ["7C"], ["9S"], ["9C"], ["JS"]],
        stock=DEAD_STOCK,
        # The five of spades can come down onto that red six.
        foundations=[["AS", "2S", "3S", "4S", "5S"], ["AH"], ["AD"], ["AC"]],
    )

    assert not game._stuck()


def test_a_fresh_deal_is_never_stuck():
    """Not a proof -- it is a property of the shuffle, not of the code -- but a deal
    with no move in it would be a game that ended on the first click, and this is the
    cheapest way to find out that something has gone very wrong indeed."""
    for seed in range(50):
        assert not dealt(seed)._stuck()
