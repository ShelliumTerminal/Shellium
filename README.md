# Shellium

An SSH and SFTP desktop client for people who work on many servers: tabs, saved hosts grouped by
environment (Production, Test, ...), script buttons, and a two-pane SFTP browser. Windows, macOS and
Linux (Electron).

> **Disclaimer.** Shellium is a personal project, shared in the hope that it is useful. It is
> provided **"as is", without warranty of any kind**, and without support. The authors accept no
> liability for any damage, data loss or downtime arising from its use. You are responsible for the
> systems you connect to and the commands you run; try it on a test system before you use it on
> production. See [LICENSE](LICENSE).

## Features

- **Sessions in tabs** (top, left or right), a Home tab with search, environment filters, favorites
  and recent connections, and a connect dialog on **Alt+S** (⌘S on a Mac).
- **Environments** (Production, Test, Development, ...) with their own colors, a production banner
  and per-environment terminal color schemes.
- **Protected sessions**: run a tab's shell in tmux / screen on the server so a dropped connection
  (VPN, Wi-Fi, sleep) does not kill what runs in it; the tab reconnects into the same session.
- **SFTP**: two panes, multi-select, folder transfers, a queue with pause / resume, resume after a
  dropped connection, chmod, edit in a local editor, drag and drop.
- **Script buttons**: send strings or multi-line commands with one click, in categories.
- **Import / export**: encrypted `.shellium` files, CSV host lists, and XML exports of other tools
  (SecureCRT, mRemoteNG, ...) with a field-mapping step.
- Terminal color schemes, X11 forwarding, anti-idle, session recording, find in terminal,
  multi-line paste review, light and dark themes.

## Security model

- An app password is required. The host database is encrypted with AES-256-GCM, with a key derived
  from the app password and bound to the OS key store (Windows DPAPI, macOS Keychain, GNOME Keyring
  / KWallet on Linux; Linux without a keyring is refused). Nothing is stored unencrypted.
- SSH host keys are verified (trust on first use; a changed key is refused unless you replace it).
- Legacy SSH algorithms are off unless enabled per host or after an explicit prompt.

Found a vulnerability? See [SECURITY.md](SECURITY.md).

## Build from source

Requirements: Node.js 20+ and [pnpm](https://pnpm.io/) 10.

```bash
pnpm install
pnpm dev          # run in development mode
pnpm build        # type-check, build and package an installer into release/<version>/
```

The Windows installer is built on Windows, the macOS `.dmg` on a Mac and the Linux `.AppImage` on
Linux. `test/linux/` has a Docker test bed and `test/macos/` notes for testing on a Mac; both use a
throwaway local SSH server, never real hosts.

Your data lives in the app's data folder (`%APPDATA%\shellium` on Windows), not in this repository.
To try changes without touching it, start Electron with its own profile:
`electron . --user-data-dir=<an empty folder>`.

## How it is built

Shellium is developed with the help of AI coding tools (Claude Code). The maintainer directs the
work, reviews the changes and tests them in isolated profiles against throwaway SSH servers before
they are committed. Commits written with AI assistance say so in a `Co-Authored-By` line.

As with any open source project, review the code yourself if you rely on it; see the disclaimer
above and [LICENSE](LICENSE).

## Contributing

Issues and pull requests are welcome, but there is no promise that they will be answered, reviewed
or merged. Changes are recorded in [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE). Copyright (c) 2026 Shellium. Provided "as is", without warranty of any kind.

Bundled fonts (Inter, JetBrains Mono) are under the SIL Open Font License. Third-party packages keep
their own licenses.
