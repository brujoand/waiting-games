// Every word a player reads.
//
// The server never sends prose. It sends stable codes (`othello.no_flank`) and
// data (`{max: 63}`), and this is where they become a sentence -- here, in the
// browser, which is the only place that knows what language the player reads.
//
// Adding a language is adding a dictionary. Adding a string is adding it to
// EVERY dictionary: a missing one falls back to English rather than going blank,
// so an omission degrades instead of breaking, but it is still an omission.

const en = {
  // -- chrome
  "ui.brand": "Waiting Games",
  "ui.play": "Play",
  "ui.pick_a_name": "Pick a name",
  "ui.sign_out": "Sign out",
  "ui.language": "Language",
  "ui.new_game": "New game",
  "ui.start_game": "Start game",
  "ui.start_now": "Start now",
  "ui.join_a_game": "Join a game",
  "ui.join": "Join",
  "ui.watch": "Watch",
  "ui.back_to_lobby": "Back to lobby",
  "ui.nothing_waiting": "No games waiting. Start one.",
  "ui.players_exact": "{max} players",
  "ui.players_range": "{min}-{max} players",
  "ui.game_with_players": "{game} ({players})",

  // -- lobby rows
  "ui.status.waiting": "waiting",
  "ui.status.active": "in progress",
  "ui.status.finished": "finished",
  "ui.session_line": "{host} - {seats} - {status}",

  // -- the status line above a board
  "ui.waiting_for_players": "Waiting for more players ({seats})",
  "ui.you_may_start": "{waiting}. You can start whenever you like.",
  "ui.still_waiting": "{waiting}...",
  "ui.your_turn": "Your turn",
  "ui.their_turn": "{name}'s turn",
  "ui.disconnected": " ({names} disconnected)",
  "ui.you_won": "You win!",
  "ui.they_won": "{name} wins.",
  "ui.draw": "A draw.",
  "ui.you": "You",
  "ui.gone": "That game is gone (the server may have restarted).",

  // -- errors the server can send
  "error.request_failed": "Request failed ({status}).",
  "auth.not_signed_in": "You are not signed in.",
  "auth.login_disabled": "This server does not have a sign-in form.",
  "auth.proxy_missing":
    "The proxy in front of this server did not say who you are. That is a " +
    "misconfiguration, not something you can fix from here.",

  "move.game_over": "The game is over.",
  "move.not_started": "The game has not started.",
  "move.not_seated": "You are not in this game.",
  "move.not_your_turn": "It is not your turn.",

  "seat.already_started": "The game has already started.",
  "seat.full": "The game is full.",
  "seat.already_joined": "You are already in this game.",
  "seat.not_enough_players": "Not enough players.",

  "lobby.no_such_game": "No such game.",
  "lobby.unknown_game": "Unknown game: {game}.",
  "lobby.too_many_games": "Too many games in progress. Try again later.",
  "lobby.not_host": "Only the host can start the game.",

  "name.not_text": "A name must be text.",
  "name.empty": "A name cannot be empty.",
  "name.too_long": "A name cannot be longer than {max} characters.",
  "name.unprintable": "That name contains characters that cannot be shown.",
  "name.too_many_players": "Too many players right now. Try again later.",

  // -- the games
  "game.tictactoe.title": "Tic-Tac-Toe",
  "game.connectfour.title": "Connect Four",
  "game.othello.title": "Othello",
  "game.dotsandboxes.title": "Dots and Boxes",
  "game.nim.title": "Nim",
  "game.hangman.title": "Hangman",
  "game.battleship.title": "Battleship",
  "game.snake.title": "Snake",
  "game.pong.title": "Pong",

  "tictactoe.cell_range": "The cell must be 0-{max}.",
  "tictactoe.cell_taken": "That cell is taken.",

  "connectfour.column_range": "The column must be 0-{max}.",
  "connectfour.column_full": "That column is full.",

  "othello.cell_range": "The cell must be 0-{max}.",
  "othello.no_flank": "That move does not flank any discs.",
  "othello.score": "Black {dark} - White {light}",

  "dotsandboxes.bad_kind": "A line must be horizontal or vertical.",
  "dotsandboxes.line_not_a_number": "A line must be a number.",
  "dotsandboxes.no_such_line": "That line does not exist.",
  "dotsandboxes.line_drawn": "That line is already drawn.",

  "nim.pile_not_a_number": "The pile must be a number.",
  "nim.count_not_a_number": "The count must be a number.",
  "nim.no_such_pile": "That pile does not exist.",
  "nim.take_at_least_one": "You must take at least one match.",
  "nim.not_that_many": "There are only {left} left in that pile.",
  "nim.take": "Take {count}",
  "nim.empty": "empty",
  "nim.you_took_the_last": "You took the last match. You win!",
  "nim.they_took_the_last": "{name} took the last match and won.",

  "hangman.word_required": "You must submit a word.",
  "hangman.word_length": "The word must be {min}-{max} letters.",
  "hangman.word_letters": "The word can only use these letters: {alphabet}",
  "hangman.letter_required": "You must guess a letter.",
  "hangman.not_a_letter": "That is not a letter.",
  "hangman.already_tried": "That letter has already been tried.",
  "hangman.set_the_word": "Set the word",
  "hangman.type_a_word": "Type a word",
  "hangman.waiting_for_setter": "Waiting for {name} to set a word...",
  "hangman.you_set_it": "You set the word, so you do not guess this round.",
  "hangman.gallows": "Gallows: {parts} ({wrong}/{max})",
  "hangman.gallows_empty": "The gallows is empty (0/{max})",
  "hangman.previous": "Previous word ({name}): {word} - {outcome}.",
  "hangman.was_guessed": "guessed",
  "hangman.was_not_guessed": "not guessed",
  "hangman.round": "Round {round}/{rounds}",
  "hangman.you_set": "You set the word",
  "hangman.they_set": "{name} sets the word",
  "hangman.they_guess": "{name} is guessing",
  "hangman.part.head": "head",
  "hangman.part.body": "body",
  "hangman.part.left_arm": "left arm",
  "hangman.part.right_arm": "right arm",
  "hangman.part.left_leg": "left leg",
  "hangman.part.right_leg": "right leg",
  "hangman.part.rope": "rope",

  "battleship.unknown_action": "Unknown action.",
  "battleship.cell_range": "The cell must be 0-{max}.",
  "battleship.already_fired": "You have already fired there.",
  "battleship.shuffle": "Shuffle",
  "battleship.ready": "Ready",
  "battleship.waiting": "Ready - waiting...",
  "battleship.your_fleet": "Your fleet",
  "battleship.your_waters": "Your waters",
  "battleship.the_enemy": "The enemy",
  "battleship.arrange": "Shuffle until you like your fleet, then press Ready.",
  "battleship.you_are_ready": "You are ready. Waiting for your opponent...",
  "battleship.waiting_for": "Waiting for {names}.",
  "battleship.tally": "Sunk {sunk}/{fleet}, lost {lost}/{fleet}",
  "battleship.fire": "Your turn - fire!",
  "battleship.they_aim": "{name} is taking aim...",
  "battleship.ship.carrier": "Carrier",
  "battleship.ship.battleship": "Battleship",
  "battleship.ship.cruiser": "Cruiser",
  "battleship.ship.submarine": "Submarine",
  "battleship.ship.destroyer": "Destroyer",

  "snake.unknown_direction": "Unknown direction.",
  "snake.dead": "Your snake is dead.",
  "snake.no_reverse": "You cannot reverse straight into yourself.",
  "snake.solo_over": "You survived {seconds} seconds and grew to {length}.",
  "snake.all_crashed": "Everyone crashed. A draw.",
  "snake.you_survived": "You are the last snake alive! Length {length}.",
  "snake.length": "Length {length}",
  "snake.you_crashed": "You crashed",
  "snake.watching": "You are watching",
  "snake.solo_status": "{you}. {seconds} seconds. Swipe, or use the arrow keys.",
  "snake.status": "{you}. {alive} snakes alive. Swipe, or use the arrow keys.",

  "pong.bad_input": "Invalid input.",
  "pong.out": "You are out of the game.",
  "pong.out_short": "out",
  "pong.hint": "Hold a side of the board, or use the arrow keys. Your wall is at the bottom.",
  "pong.you_are_out": "You are out.",
  "pong.watching": "You are watching.",
};

const nb = {
  // -- chrome
  "ui.brand": "Waiting Games",
  "ui.play": "Spill",
  "ui.pick_a_name": "Velg et navn",
  "ui.sign_out": "Logg ut",
  "ui.language": "Språk",
  "ui.new_game": "Nytt spill",
  "ui.start_game": "Start spill",
  "ui.start_now": "Start nå",
  "ui.join_a_game": "Bli med i et spill",
  "ui.join": "Bli med",
  "ui.watch": "Se på",
  "ui.back_to_lobby": "Tilbake til lobbyen",
  "ui.nothing_waiting": "Ingen spill venter. Start et selv.",
  "ui.players_exact": "{max} spillere",
  "ui.players_range": "{min}-{max} spillere",
  "ui.game_with_players": "{game} ({players})",

  // -- lobby rows
  "ui.status.waiting": "venter",
  "ui.status.active": "i gang",
  "ui.status.finished": "ferdig",
  "ui.session_line": "{host} - {seats} - {status}",

  // -- the status line above a board
  "ui.waiting_for_players": "Venter på flere spillere ({seats})",
  "ui.you_may_start": "{waiting}. Du kan starte når du vil.",
  "ui.still_waiting": "{waiting}...",
  "ui.your_turn": "Din tur",
  "ui.their_turn": "{name} sin tur",
  "ui.disconnected": " ({names} koblet fra)",
  "ui.you_won": "Du vant!",
  "ui.they_won": "{name} vant.",
  "ui.draw": "Uavgjort.",
  "ui.you": "Du",
  "ui.gone": "Spillet finnes ikke lenger (tjeneren kan ha startet på nytt).",

  // -- errors the server can send
  "error.request_failed": "Forespørselen feilet ({status}).",
  "auth.not_signed_in": "Du er ikke logget inn.",
  "auth.login_disabled": "Denne tjeneren har ikke innloggingsskjema.",
  "auth.proxy_missing":
    "Proxyen foran denne tjeneren sa ikke hvem du er. Det er en feil i " +
    "oppsettet, ikke noe du kan rette herfra.",

  "move.game_over": "Spillet er over.",
  "move.not_started": "Spillet har ikke startet.",
  "move.not_seated": "Du er ikke med i dette spillet.",
  "move.not_your_turn": "Det er ikke din tur.",

  "seat.already_started": "Spillet har allerede startet.",
  "seat.full": "Spillet er fullt.",
  "seat.already_joined": "Du er allerede med i dette spillet.",
  "seat.not_enough_players": "For få spillere.",

  "lobby.no_such_game": "Finner ikke spillet.",
  "lobby.unknown_game": "Ukjent spill: {game}.",
  "lobby.too_many_games": "For mange spill i gang. Prøv igjen senere.",
  "lobby.not_host": "Bare verten kan starte spillet.",

  "name.not_text": "Navnet må være tekst.",
  "name.empty": "Navnet kan ikke være tomt.",
  "name.too_long": "Navnet kan ikke være lengre enn {max} tegn.",
  "name.unprintable": "Navnet inneholder tegn som ikke kan vises.",
  "name.too_many_players": "For mange spillere akkurat nå. Prøv igjen senere.",

  // -- the games
  "game.tictactoe.title": "Tre på rad",
  "game.connectfour.title": "Fire på rad",
  "game.othello.title": "Othello",
  "game.dotsandboxes.title": "Prikker og bokser",
  "game.nim.title": "Nim",
  "game.hangman.title": "Galgespill",
  "game.battleship.title": "Senke slagskip",
  "game.snake.title": "Slange",
  "game.pong.title": "Pong",

  "tictactoe.cell_range": "Ruten må være 0-{max}.",
  "tictactoe.cell_taken": "Ruten er opptatt.",

  "connectfour.column_range": "Kolonnen må være 0-{max}.",
  "connectfour.column_full": "Kolonnen er full.",

  "othello.cell_range": "Ruten må være 0-{max}.",
  "othello.no_flank": "Det trekket snur ingen brikker.",
  "othello.score": "Svart {dark} - Hvit {light}",

  "dotsandboxes.bad_kind": "Streken må være vannrett eller loddrett.",
  "dotsandboxes.line_not_a_number": "Streken må være et tall.",
  "dotsandboxes.no_such_line": "Den streken finnes ikke.",
  "dotsandboxes.line_drawn": "Streken er allerede tegnet.",

  "nim.pile_not_a_number": "Haugen må være et tall.",
  "nim.count_not_a_number": "Antallet må være et tall.",
  "nim.no_such_pile": "Den haugen finnes ikke.",
  "nim.take_at_least_one": "Du må ta minst én fyrstikk.",
  "nim.not_that_many": "Det er bare {left} igjen i haugen.",
  "nim.take": "Ta {count}",
  "nim.empty": "tom",
  "nim.you_took_the_last": "Du tok den siste fyrstikken. Du vant!",
  "nim.they_took_the_last": "{name} tok den siste fyrstikken og vant.",

  "hangman.word_required": "Du må sende inn et ord.",
  "hangman.word_length": "Ordet må være {min}-{max} bokstaver.",
  "hangman.word_letters": "Ordet kan bare bruke disse bokstavene: {alphabet}",
  "hangman.letter_required": "Du må gjette en bokstav.",
  "hangman.not_a_letter": "Det er ikke en bokstav.",
  "hangman.already_tried": "Den bokstaven er allerede prøvd.",
  "hangman.set_the_word": "Sett ordet",
  "hangman.type_a_word": "Skriv et ord",
  "hangman.waiting_for_setter": "Venter på at {name} setter et ord...",
  "hangman.you_set_it": "Du satte ordet, så du gjetter ikke denne runden.",
  "hangman.gallows": "Galgen: {parts} ({wrong}/{max})",
  "hangman.gallows_empty": "Galgen er tom (0/{max})",
  "hangman.previous": "Forrige ord ({name}): {word} - {outcome}.",
  "hangman.was_guessed": "ble gjettet",
  "hangman.was_not_guessed": "ble ikke gjettet",
  "hangman.round": "Runde {round}/{rounds}",
  "hangman.you_set": "Du setter ordet",
  "hangman.they_set": "{name} setter ordet",
  "hangman.they_guess": "{name} gjetter",
  "hangman.part.head": "hode",
  "hangman.part.body": "kropp",
  "hangman.part.left_arm": "venstre arm",
  "hangman.part.right_arm": "høyre arm",
  "hangman.part.left_leg": "venstre bein",
  "hangman.part.right_leg": "høyre bein",
  "hangman.part.rope": "tau",

  "battleship.unknown_action": "Ukjent handling.",
  "battleship.cell_range": "Ruten må være 0-{max}.",
  "battleship.already_fired": "Du har allerede skutt der.",
  "battleship.shuffle": "Stokk om",
  "battleship.ready": "Klar",
  "battleship.waiting": "Klar - venter...",
  "battleship.your_fleet": "Din flåte",
  "battleship.your_waters": "Dine farvann",
  "battleship.the_enemy": "Fienden",
  "battleship.arrange": "Stokk om til du er fornøyd med flåten, og trykk Klar.",
  "battleship.you_are_ready": "Du er klar. Venter på motstanderen...",
  "battleship.waiting_for": "Venter på {names}.",
  "battleship.tally": "Senket {sunk}/{fleet}, tapt {lost}/{fleet}",
  "battleship.fire": "Din tur - skyt!",
  "battleship.they_aim": "{name} sikter...",
  "battleship.ship.carrier": "Hangarskip",
  "battleship.ship.battleship": "Slagskip",
  "battleship.ship.cruiser": "Krysser",
  "battleship.ship.submarine": "Ubåt",
  "battleship.ship.destroyer": "Destroyer",

  "snake.unknown_direction": "Ukjent retning.",
  "snake.dead": "Slangen din er død.",
  "snake.no_reverse": "Du kan ikke snu rett rundt.",
  "snake.solo_over": "Du overlevde {seconds} sekunder og ble {length} lang.",
  "snake.all_crashed": "Alle krasjet. Uavgjort.",
  "snake.you_survived": "Du er den siste slangen i live! Lengde {length}.",
  "snake.length": "Lengde {length}",
  "snake.you_crashed": "Du krasjet",
  "snake.watching": "Du ser på",
  "snake.solo_status": "{you}. {seconds} sekunder. Sveip, eller bruk piltastene.",
  "snake.status": "{you}. {alive} slanger i live. Sveip, eller bruk piltastene.",

  "pong.bad_input": "Ugyldig styring.",
  "pong.out": "Du er ute av spillet.",
  "pong.out_short": "ute",
  "pong.hint": "Hold på en side av brettet, eller bruk piltastene. Veggen din er nederst.",
  "pong.you_are_out": "Du er ute.",
  "pong.watching": "Du ser på.",
};

const DICTS = { en, nb };
const FALLBACK = "en";

// navigator.language says "no" far more often than "nb", and "nn" is the other
// written Norwegian. Both read the same dictionary here.
const ALIASES = { no: "nb", nn: "nb" };

export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "nb", label: "Norsk" },
];

const STORAGE_KEY = "wg_lang";

let lang = choose();

function choose() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && saved in DICTS) return saved;

  for (const tag of navigator.languages ?? [navigator.language ?? ""]) {
    const base = tag.split("-")[0].toLowerCase();
    const code = ALIASES[base] ?? base;
    if (code in DICTS) return code;
  }
  return FALLBACK;
}

export function t(code, params = {}) {
  // Missing here -> English. Missing there too -> the code itself, visibly. A
  // blank label would hide the omission; the code shouts it.
  const template = DICTS[lang][code] ?? DICTS[FALLBACK][code] ?? code;

  // A missing param leaves its placeholder showing, for the same reason.
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    key in params ? String(params[key]) : `{${key}}`,
  );
}

export function language() {
  return lang;
}

export function setLanguage(next) {
  if (!(next in DICTS)) return;
  lang = next;
  localStorage.setItem(STORAGE_KEY, next);
  document.documentElement.lang = next;

  // NOT "languagechange" -- the browser fires that itself when the system
  // language list changes, and we would be colliding with it.
  window.dispatchEvent(new CustomEvent("wg:languagechange"));
}

document.documentElement.lang = lang;
