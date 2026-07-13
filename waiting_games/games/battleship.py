"""Battleship: two fleets, hidden from each other. Fire until one is sunk.

The fleet is placed FOR you, at random, and you press "Shuffle" until you like
the look of it, then "Ready". That keeps the part of the game that is actually a
game -- the guessing -- and skips a drag-and-drop placement editor.

Two things the platform has to be told about:

  * a fleet is a SECRET, so view() shows you your own ships and shows the enemy
    only the shots that have landed. Spectators see neither fleet;
  * during placement BOTH players act at once, which is not a turn order at all
    -- that is what _may_move is for.

The placement phase is a string on this class, not a platform concept.
"""

from __future__ import annotations

import random

from .base import Game, InvalidMove, Result

SIZE = 10
FLEET = (
    ("Carrier", 5),
    ("Battleship", 4),
    ("Cruiser", 3),
    ("Submarine", 3),
    ("Destroyer", 2),
)

PLACING = "placing"
FIRING = "firing"

MISS = "miss"
HIT = "hit"


class Ship:
    def __init__(self, name: str, cells: list[int]) -> None:
        self.name = name
        self.cells = cells
        self.hits: set[int] = set()

    @property
    def sunk(self) -> bool:
        return len(self.hits) == len(self.cells)


class Battleship(Game):
    key = "battleship"
    title = "Battleship"
    min_players = 2
    max_players = 2

    def __init__(self) -> None:
        super().__init__()
        self.phase = PLACING
        self.fleets: list[list[Ship]] = []
        self.ready: list[bool] = []
        # shots[seat] is what THIS seat has fired at the other: cell -> hit/miss.
        self.shots: list[dict[int, str]] = []
        self.rng = random.Random()

    def _on_start(self) -> None:
        self.fleets = [self._random_fleet() for _ in self.players]
        self.ready = [False] * len(self.players)
        self.shots = [{} for _ in self.players]

    # -- placing ---------------------------------------------------------

    def _random_fleet(self) -> list[Ship]:
        taken: set[int] = set()
        ships: list[Ship] = []

        for name, length in FLEET:
            while True:
                horizontal = self.rng.random() < 0.5
                if horizontal:
                    row = self.rng.randrange(SIZE)
                    col = self.rng.randrange(SIZE - length + 1)
                    cells = [row * SIZE + col + i for i in range(length)]
                else:
                    row = self.rng.randrange(SIZE - length + 1)
                    col = self.rng.randrange(SIZE)
                    cells = [(row + i) * SIZE + col for i in range(length)]

                if not taken.intersection(cells):
                    taken.update(cells)
                    ships.append(Ship(name, cells))
                    break

        return ships

    # -- the platform's hooks ---------------------------------------------

    def _may_move(self, seat: int) -> bool:
        if self.phase == PLACING:
            # Both admirals arrange their fleets at the same time. Neither is
            # waiting for the other, so turn order does not apply yet.
            return not self.ready[seat]
        return seat == self.turn

    def _next_seat(self, seat: int) -> int:
        # Nobody's turn advances while the fleets are still being arranged.
        if self.phase == PLACING:
            return self.turn
        # The opening shot always belongs to the player who created the game.
        # Without this it would fall to whoever happened to press Ready LAST,
        # since the platform sets the turn from whoever moved most recently.
        if not any(self.shots):
            return 0
        return (seat + 1) % 2

    def _apply(self, seat: int, move: dict) -> None:
        if self.phase == PLACING:
            self._arrange(seat, move)
        else:
            self._fire(seat, move)

    def _arrange(self, seat: int, move: dict) -> None:
        action = move.get("action")

        if action == "shuffle":
            self.fleets[seat] = self._random_fleet()
            return

        if action == "ready":
            self.ready[seat] = True
            if all(self.ready):
                self.phase = FIRING  # _next_seat hands the first shot to seat 0
            return

        raise InvalidMove("unknown action")

    def _fire(self, seat: int, move: dict) -> None:
        cell = move.get("cell")
        if (
            isinstance(cell, bool)
            or not isinstance(cell, int)
            or not 0 <= cell < SIZE * SIZE
        ):
            raise InvalidMove(f"the cell must be 0-{SIZE * SIZE - 1}")
        if cell in self.shots[seat]:
            raise InvalidMove("you have already fired there")

        enemy = self.fleets[1 - seat]
        for ship in enemy:
            if cell in ship.cells:
                ship.hits.add(cell)
                self.shots[seat][cell] = HIT
                return

        self.shots[seat][cell] = MISS

    def _result(self) -> Result | None:
        if self.phase != FIRING:
            return None
        for seat in range(2):
            if all(ship.sunk for ship in self.fleets[1 - seat]):
                return Result(winner_seat=seat)  # you sank their whole fleet
        return None

    # -- what each seat may see -------------------------------------------

    def _enemy_grid(self, seat: int) -> dict:
        """What `seat` has learned about the other fleet: only its own shots."""
        return {str(cell): result for cell, result in self.shots[seat].items()}

    def _sunk_names(self, seat: int) -> list[str]:
        """Which of the enemy's ships are gone. Derivable from the hits anyway."""
        return [ship.name for ship in self.fleets[1 - seat] if ship.sunk]

    def public_state(self) -> dict:
        """The SPECTATOR view. Neither fleet appears here -- only the shots that
        have been fired, which both players already know about.

        This is the strictest view in the game and it must stay that way: any
        logged-in user may open a game socket and watch.
        """
        if not self.started:
            return {"phase": self.phase, "size": SIZE}

        return {
            "phase": self.phase,
            "size": SIZE,
            "ready": {
                player: self.ready[seat] for seat, player in enumerate(self.players)
            },
            # Each player's shots at the other. Public: both of them saw every
            # splash, and a spectator learns nothing the players do not know.
            "shotsBy": {
                player: self._enemy_grid(seat)
                for seat, player in enumerate(self.players)
            },
            "sunkBy": {
                player: self._sunk_names(seat)
                for seat, player in enumerate(self.players)
            },
            "fleet": [name for name, _ in FLEET],
        }

    def view(self, seat: int | None) -> dict:
        state = self.public_state()
        if seat is None or not self.started:
            return state  # a spectator sees no ships at all

        # ...and a player sees exactly one fleet: their own.
        state["myFleet"] = [
            {"name": ship.name, "cells": ship.cells, "hits": sorted(ship.hits)}
            for ship in self.fleets[seat]
        ]
        return state
