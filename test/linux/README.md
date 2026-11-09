# Linux test bed (Docker)

Runs the built app (`dist/`, `dist-electron/`) on Ubuntu 24.04 with Xvfb, D-Bus and GNOME Keyring to
test the app password / Electron `safeStorage` on Linux. Nothing here touches the owner's profile.

```bash
npx vite build
docker build -f test/linux/Dockerfile -t shellium-linux-test .
docker run -d --init --name shellium-linux \
  -p 127.0.0.1:9341:9342 -p 127.0.0.1:9229:9230 \
  -v "$PWD/dist:/app/dist:ro" -v "$PWD/dist-electron:/app/dist-electron:ro" \
  -v "<a host folder>:/exchange" shellium-linux-test
docker exec -d -u alice shellium-linux /app/test/linux/start.sh keyring   # or dbus-only / nokeyring
docker exec shellium-linux /app/test/linux/stop.sh
```

- `--init` matters: without it the container's PID 1 (`sleep`) never reaps Electron's processes.
- DevTools of the renderer is on host port 9341, the main-process inspector on 9229, so the
  Windows test scripts (CDP eval / screenshots, `dialog` stubs) work unchanged.
- Users `alice` and `bob`: copy alice's `~/shellium-profile` to bob to check that the data is bound to
  the OS user. `PROFILE=<dir>` (via `docker exec -e`) picks another profile.
- `start.sh keyring` unlocks a login keyring with the password `keyring-test-pass`; `dbus-only`
  lets D-Bus start gnome-keyring on demand, which shows its own unlock prompt on the virtual screen
  (answer it with `xdotool`; while it is open Electron's main process - and so DevTools - is blocked).
  `nokeyring` has no D-Bus: Electron falls back to `basic_text` and Shellium refuses setup / unlock.
- Test SSH server inside the container: `127.0.0.1:2222`, `tester` / `tester-pass` (shell echoes,
  SFTP lists one file).
- Full-screen capture including non-Electron windows: install `x11-apps imagemagick xdotool` in the
  container and use `xwd -root | convert xwd:- out.png`.
