// The running version, bottom left.
//
// It answers one question, and it is the question you ask most often about a
// service that deploys itself: is my change actually live yet?
//
// Deliberately its own module, and not a line in app.js. It hangs off nothing:
// no login, no lobby, no game state. So it still renders when app.js has thrown
// on boot and painted an error over the page -- which is precisely the moment
// you most want to know which build you are looking at.

const badge = document.getElementById("version");

try {
  const response = await fetch("/api/config");
  const { version } = await response.json();
  if (version) {
    badge.textContent = `v${version}`;
    badge.hidden = false;
  }
} catch {
  // A server too broken to say what it is stays silent rather than showing an
  // empty box. The badge starts hidden, so there is nothing to undo.
}
