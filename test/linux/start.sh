#!/bin/bash
# Starts Shellium inside the test container as the current user.
#   start.sh keyring     - D-Bus session + unlocked gnome-keyring (safeStorage = gnome_libsecret)
#   start.sh dbus-only   - D-Bus session, no keyring daemon
#   start.sh nokeyring   - no D-Bus at all (Electron falls back to basic_text)
# DevTools (renderer) is forwarded to :9342, the main-process inspector to :9230.
set -u
MODE="${1:-keyring}"
PROFILE="${PROFILE:-$HOME/shellium-profile}"
LOG="$HOME/shellium-$MODE.log"
export DISPLAY=:99

pgrep -x Xvfb >/dev/null || (Xvfb :99 -screen 0 1600x950x24 >/dev/null 2>&1 &)
pgrep -f "TCP-LISTEN:9342" >/dev/null || (socat TCP-LISTEN:9342,fork,reuseaddr TCP:127.0.0.1:9341 >/dev/null 2>&1 &)
pgrep -f "TCP-LISTEN:9230" >/dev/null || (socat TCP-LISTEN:9230,fork,reuseaddr TCP:127.0.0.1:9229 >/dev/null 2>&1 &)
pgrep -f "sshd.cjs" >/dev/null || (node /app/test/linux/sshd.cjs >/tmp/sshd.log 2>&1 &)
sleep 1

ELECTRON=(/app/node_modules/.bin/electron /app --no-sandbox --user-data-dir="$PROFILE"
  --remote-debugging-port=9341 --inspect=9229 --disable-gpu)

case "$MODE" in
  keyring)
    # The login keyring is created / unlocked with a fixed test password, as a desktop login would.
    exec dbus-run-session -- bash -c '
      echo -n "keyring-test-pass" | gnome-keyring-daemon --unlock --components=secrets >/dev/null
      export XDG_CURRENT_DESKTOP=GNOME
      exec "$@" --password-store=gnome-libsecret' _ "${ELECTRON[@]}" >"$LOG" 2>&1
    ;;
  dbus-only)
    exec dbus-run-session -- bash -c 'export XDG_CURRENT_DESKTOP=GNOME; exec "$@"' _ "${ELECTRON[@]}" >"$LOG" 2>&1
    ;;
  nokeyring)
    unset DBUS_SESSION_BUS_ADDRESS
    exec env XDG_CURRENT_DESKTOP=none "${ELECTRON[@]}" >"$LOG" 2>&1
    ;;
  *)
    echo "unknown mode $MODE" >&2
    exit 2
    ;;
esac
