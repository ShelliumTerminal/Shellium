#!/bin/bash
# Stops Shellium and the keyring daemon in the test container (matched by process name, so the
# command running this script is never hit). Xvfb, socat and the test SSH server keep running.
pkill -x electron
pkill -x gnome-keyring-d
pkill -x dbus-daemon
for _ in $(seq 1 20); do
  pgrep -x electron >/dev/null || exit 0
  sleep 0.5
done
pkill -9 -x electron
exit 0
