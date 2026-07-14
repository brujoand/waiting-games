"""Registry of playable games. Adding a game is one import and one entry."""

from .base import Game, InvalidMove, RealTimeGame, Result
from .battleship import Battleship
from .connectfour import ConnectFour
from .dotsandboxes import DotsAndBoxes
from .gris import Gris
from .hangman import Hangman
from .idiot import Idiot
from .nim import Nim
from .othello import Othello
from .pong import Pong
from .snake import Snake
from .snakes import Snakes
from .solitaire import Solitaire
from .tictactoe import TicTacToe
from .twentyfortyeight import TwentyFortyEight

GAMES: dict[str, type[Game]] = {
    TicTacToe.key: TicTacToe,
    ConnectFour.key: ConnectFour,
    Othello.key: Othello,
    DotsAndBoxes.key: DotsAndBoxes,
    Nim.key: Nim,
    Hangman.key: Hangman,
    Battleship.key: Battleship,
    Idiot.key: Idiot,
    Gris.key: Gris,
    Snake.key: Snake,
    Snakes.key: Snakes,
    Pong.key: Pong,
    TwentyFortyEight.key: TwentyFortyEight,
    Solitaire.key: Solitaire,
}

__all__ = ["GAMES", "Game", "InvalidMove", "RealTimeGame", "Result"]
