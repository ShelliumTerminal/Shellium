# macOS test bed

Runs the built app directly on the real Mac (native Keychain, no VM/container needed) to test the
app password / Electron `safeStorage` on macOS. Uses an isolated `--user-data-dir` so nothing
touches the owner's real profile.

```bash
npx vite build
env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron . \
  --user-data-dir=<temp dir> \
  --remote-debugging-port=9341 \
  --disable-features=CalculateNativeWinOcclusion,BackgroundingOccludedWindows \
  --disable-backgrounding-occluded-windows
node test/macos/sshd.cjs   # throwaway SSH/SFTP server on 127.0.0.1:2222, tester / tester-pass
```

Drive and inspect the running app over the DevTools protocol (port 9341): `GET /json` for the page
target, then `Runtime.evaluate` over its WebSocket to read `document.body.innerText`, fill inputs
(set `.value` via the native `HTMLInputElement`/`HTMLSelectElement` setter + dispatch `input`/
`change` so React sees it) and `.click()` buttons. Typing into the terminal needs real
`Input.dispatchKeyEvent` (`type: "char"`) after focusing `.xterm-helper-textarea` - setting
`.value` does not reach xterm's key handler.

- No Docker/Xvfb/D-Bus dance needed here (unlike `test/linux/`): the Mac's own WindowServer and
  Keychain are used directly, so this only works interactively on a real Mac with a logged-in GUI
  session - not headless CI.
- `sshd.cjs` is the same throwaway `ssh2` server as `test/linux/sshd.cjs`, just pointed at the
  local `node_modules` instead of `/app/node_modules`.

## Checklist status

Run 2026-10-02 against macOS 26.5.2 (Sequoia era build), isolated profile, no prior Shellium data:

1. **First setup** - PASS. `data/connections.sqlite` written with the encryption prefix of that version
   (AES-256-GCM), 0600 permissions, no plaintext host/credential strings in it (grepped for the
   seeded sample hosts' usernames - zero hits). `settings.json` has `security.enabled: true`,
   `keyBinding: "local-user"`, no secrets in the clear.
2. **Restart / unlock** - PASS. Wrong password -> "Master password is incorrect.", refused. Right
   password -> unlocks, same profile.
3. **DB copied to another OS user** - NOT RUN. Needs a temporary second macOS user account
   (`sudo sysadminctl -addUser ...` + a Fast User Switch login) - both the sudo elevation and the
   GUI login are the owner's own machine actions, left for the owner to drive (or to delegate back
   with their sudo password in hand).
4. **Keychain missing / locked / denied** - NOT RUN. No Keychain prompt appeared on first setup at
   all (same signature trusts its own freshly-created item, as expected). Forcing the "locked /
   denied" path means locking the Mac's real login keychain (`security lock-keychain`), which is
   correctly refused by the test harness's own safety guard - left for the owner to try by hand
   (lock the keychain, relaunch, Cancel the system unlock prompt, confirm no crash / no data
   damage, then unlock the keychain again).
5. **Cross-platform `.shellium` import** - NOT RUN. No Windows-exported `.shellium` file was available
   this session; deferred until one exists (or the owner supplies one).
6. **Smoke (SSH, SFTP, both themes)** - PASS. Connected to the local throwaway `ssh2` server,
   typed into the terminal and saw it echoed, opened SFTP and saw the fake remote file, switched
   Options > Appearance > Theme to Light then back to Dark and the owner confirmed Light rendered
   correctly. Script buttons not exercised (no buttons configured in a fresh profile - low risk,
   not OS-specific).

Remaining: 3, 4 and 5 need the owner physically at the keyboard (sudo password, a real Keychain
system dialog, or a Windows-made `.shellium` file).
