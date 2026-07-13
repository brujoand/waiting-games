"""Registry of playable games. Adding a game is one import and one entry."""

from .base import Game, InvalidMove
from .tictactoe import TicTacToe

GAMES: dict[str, type[Game]] = {
    TicTacToe.key: TicTacToe,
}

__all__ = ["GAMES", "Game", "InvalidMove"]
