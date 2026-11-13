# Changelog

All notable changes to Shellium. Versions follow [Semantic Versioning](https://semver.org/):
MAJOR for changes that need action from users (data, identity, compatibility), MINOR for new
features, PATCH for fixes. Every user-visible change is added under **Unreleased** when it is made;
`npm version <patch|minor|major>` moves it under the new version.

## [Unreleased]

### Fixed
- Copying a long line that the terminal wrapped onto several rows (an ssh key, a long command)
  put a line break at the end of every row, so pasting it ran several broken commands. The rows of
  one line are now copied as one line; real line breaks stay. A triple click selects the whole
  wrapped line instead of one row.

## [2.3.0] - 2026-11-13

### Added
- Links in the terminal: **Ctrl+click** (⌘+click on a Mac) on a web address opens it in the browser;
  on an absolute path (e.g. `/u01/app/oracle/diag/.../alert_ORCL.log`) it opens the session's SFTP
  view there: a folder is shown, a file is selected in its folder. Holding the key over a link
  underlines it; a plain click still selects text. Addresses and paths that wrap onto the next row
  count as one link.
- Terminal bell: a tab in the background that rings its bell (e.g. `long_job; echo -e '\a'`) shows a
  bell until it is opened, and when Shellium itself is in the background its taskbar button flashes
  (the Dock icon bounces on a Mac).

### Changed
- The terminal is drawn on the GPU (WebGL): fast output such as `tail -f` or long query results
  uses much less CPU. Without WebGL it falls back to the previous renderer on its own.
- Emoji and other wide characters take the width the server expects (Unicode 11), so columns and
  box drawing after them stay aligned.

### Fixed
- The terminal froze in `vim`: after opening a file the keys seemed to do nothing and the tab showed
  no more output until it was closed (other tabs kept working). Typical after `su - oracle` on
  RHEL / Oracle Linux, where `vi` is full vim for normal users but not for root. vim asks the
  terminal about its cursor on start, and the installed build of the terminal failed on that
  question (a build setting broke one of its functions); the build no longer changes it.
- Selecting text while output keeps coming: the selection stayed in place on the screen and the new
  lines ran through it (once the scrollback was full). It now moves with its text and goes away when
  that text leaves the scrollback. While the mouse button is held to select, the view stands still;
  the output that arrived meanwhile appears when the button is released.
- Clicking outside the terminal turned its cursor into two thin vertical lines ("| |"). The cursor
  is now hidden while the terminal is not focused and comes back when you click into it.

### Removed
- Import no longer reads export and backup files of the app's earlier versions, and data encrypted
  by them is no longer opened. Shellium's own `.shellium` exports, CSV and XML
  import as before.

## [2.2.0] - 2026-11-11

### Added
- Shellium is open source under the MIT License. Help › About and the Windows installer show the
  license: Shellium is provided "as is", without warranty of any kind.
- Hovering a session tab shows its full name in a slim bubble, so a name cut off with "..." can be
  read (below a tab strip, beside a left / right session list).

### Changed
- The connect dialog (search hosts and connect) opens with **Alt+S** (⌘S on a Mac) instead of Alt+B,
  so Alt+B reaches the terminal again (word back in bash, sqlplus with rlwrap, emacs).
- A session tab shows only its name; user@host:port and X11 are no longer in the tab. The session's
  name, environment, user@host:port, X11 and "Legacy SSH" moved from the row above the terminal to the
  status bar at the bottom (next to Connected / Disconnected). Copy / Paste / Find are icon buttons in
  the toolbar at the top (left of SFTP); the row above the terminal is gone, so the terminal is taller.
- Protected sessions, for critical work: **Protect** in the toolbar (or the tab menu, or Tools) runs the
  tab's shell in tmux on the server (screen when there is no tmux), so a dropped connection - VPN,
  Wi-Fi, sleep - no longer kills what runs in it. The environment (ORACLE_SID...) and the folder stay;
  the tab shows a shield. When the connection drops, the tab turns amber and reconnects on its own
  (2, 5, 10, 15, then every 30 s; Try now / Stop), back into the same session with the terminal and its
  scrollback kept; a dead link is noticed within about 20 s. Tools › "Protect New Sessions" opens every
  new tab protected (a "New tabs protected" badge shows while it is on). Switching protection off asks
  first when something still runs in it; closing a protected tab asks whether to end the session on the
  server or leave it running, and Protect on a tab of the same server later offers to go back into it.
  Only commands started after Protect are protected; it refuses to type into sqlplus / vim unless told
  the terminal is at a prompt. Shellium's tmux has its own socket and settings (no status bar, no prefix
  key, scrollback in the terminal) and never touches the user's own tmux.
- New password screen: the Shellium title on black on the left (when it opens, a few lines of an SSH
  handshake run by and the session "opens" onto the name over a rule in the Shellium colors), the
  password form on the right in the app's theme. Nothing waits for the animation - you can type at once. Options › General › "Animate the password screen"
  turns the animation off; with reduced motion it is shown still. In a narrow window the title becomes
  a band on top.
- Home: the environment filters are tinted in their environment's color with a color dot instead of a
  grey outline around a badge; the selected one gets a ring in its color, environments without hosts
  are dimmed.

### Fixed
- Protected sessions on servers where `/etc/tmux.conf` cannot be read (e.g. root only) or with old
  tmux (1.8 / 2.7): the new session no longer opens stuck in tmux's error view where typing did
  nothing.
- Protected sessions started after `su - oracle` (or sudo): Shellium notices the session runs as
  another user and says so. It keeps running when the connection drops; after reconnecting Shellium
  opens a plain shell and shows the command to go back into it. Ending protection works through the
  terminal, and if the session still does not end, a message shows the command to end it as that user.
- Quitting Shellium with an open session (seen with a protected one) could show "A JavaScript error
  occurred in the main process - Object has been destroyed": the connections closing after the window
  reported to the window that was already gone.
- SFTP: the drives and folders sidebar of the local pane can be resized by dragging its border
  (double-click resets it); the width is remembered.
- SSH: with "Allow legacy SSH algorithms" on, a server that only offers the
  `diffie-hellman-group-exchange-sha1` key exchange could not be
  reached ("no matching key exchange algorithm"); it is now part of the legacy set.
- macOS: the connect dialog shortcut did nothing (Option+B types a character there); on a Mac it is
  ⌘S (see Changed). The script button shortcuts (Option+1 … 9) work on a Mac too.

## [2.1.0] - 2026-10-15

### Added
- Status bar: for the active session the time connected, latency (SSH keep-alive round trip every
  10 s, nothing runs on the server), protocol and cipher (hover: server version, key exchange, host
  key fingerprint, MAC, compression), data received / sent, terminal type, size (columns × rows) and
  cursor line / column. A running recording shows a red REC timer; clicking it stops the recording.
  In a narrow window the less important items hide first.
- SFTP: a sidebar next to the local files with Home, Desktop, Documents, Downloads and the drives of
  this computer (label, free space); the button next to "Choose folder" shows or hides it.
- SFTP: transfers paused by a lost connection continue on their own after the session reconnects
  (Options › General › "Resume transfers after reconnecting", on by default). Transfers you paused
  stay paused.
- Clicking the transfer in the status bar opens that session's SFTP tab.
- Script buttons: hovering a button shows its send string as a tooltip, one line per Enter. It can be
  turned off per button in Tools › Script Buttons ("Show the send string as a tooltip"), e.g. for a
  button that types a password.
- Right-click in text fields (search boxes, forms, the send string editor, ...) offers Cut, Copy,
  Paste and Select All in the app's theme; selected text elsewhere offers Copy. Password fields cannot
  be cut or copied. The terminal keeps its own right-click (paste).
- Script button manager: the borders between categories, buttons and the editor can be dragged
  (double-click resets them).
- Terminal color schemes: a gallery in Options › Terminal with 14 built-in schemes (Shellium Dark /
  Light / Production, Dracula, Nord, One Dark, Tokyo Night, Catppuccin Mocha, Gruvbox Dark,
  Solarized Dark / Light, GitHub Dark / Light, Monokai) and your own copies with all 16 ANSI colors.
- A color scheme per environment (Options › Environments) and per host (connect dialog › Terminal
  colors): host > environment > default. Open sessions change color at once. New installations give
  Production the red-tinted "Shellium Production" scheme.

### Changed
- Terminal: selected text shows in inverted colors (light background, dark text),
  instead of a translucent tint. Options › Terminal › Selection switches back to "Highlight".
- Tools › "Manage Buttons..." is now "Script Buttons...", the same name as its window. Dragging a
  button in the list shows a move cursor instead of a hand.
- Options opens as a tab next to Home and uses the whole window instead of a small dialog. Apply and
  Revert sit at the bottom; closing the tab with unsaved changes asks first. Each page has "Reset to
  defaults" (it changes nothing until Apply; environments, your color schemes and folders are kept).
- Connect dialog: X11 forwarding, Terminal colors, Anti-idle and SSH security fold open on a click
  and start closed every time; while closed they show the current setting.
- The _ cursor in the Shellium mark blinks like a terminal cursor (title bar and lock screen).
- Windows app icon: a larger >_, and the small sizes (16-32 px) are drawn on the pixel grid so the taskbar icon stays sharp.
- Terminal colors moved from the terminal font dialog to the color schemes. Colors you had changed
  become a custom scheme "My colors".

### Fixed
- Home: a long favorite name ran out of its card over the next one; it now wraps to two lines (the
  full name shows on hover) and the cards line up.
- Script buttons: the right-click menu (Modify, Move Up, ...) was unreadable in the light theme
  (light text on white); it now looks like the tab menu in both themes.
- Script buttons send their lines one by one, each after the server has answered the previous one,
  like typing. A button that starts a program and then sends commands to it (`sqlplus / as sysdba`
  followed by `set lines ...`) no longer runs them together into one line (SP2-0158 / SP2-0268);
  `\r` and `\r\n` both work, no `\p` pauses needed.
- Terminal: Shift+Insert and Ctrl+Shift+V pasted a one-line text twice (e.g. a path came out as the
  path written two times); right-click and middle-click pastes were not affected.
- Options › Terminal: the color scheme previews no longer stick out of their cards at a larger UI scale.
- SFTP: in a narrow window the file name column no longer gets squeezed to nothing; narrow panes
  hide the permissions column first, then the modified column.
- A black strip below the last terminal row (visible with lighter backgrounds).

### Removed
- Script button manager: the button bar `.ini` import.
- Session header: the "Open SFTP" button; SFTP stays in the app bar.

## [2.0.0] - 2026-10-06

First release as **Shellium**. Its identity and data folder are new: move your
hosts with File › Export in the old version and File › Import in Shellium.

### Changed
- New name, icon and app identity: Shellium (`com.shellium.app`), data in `%APPDATA%/shellium`.
  Windows treats it as a new app.
- New application shell and design system: one app bar, Home tab with search, environment filters,
  favorites and recent connections, quick connect (Alt+B), tabs on top, left or right, light and dark
  themes, bundled Inter and JetBrains Mono.
- Rebuilt connect dialog, Options, lock screen, script button manager, script bar and all small
  dialogs; questions are themed dialogs instead of native message boxes.
- Background tabs with new output turn blue; a tab whose session ended turns red.

### Added
- Environments (Production, Test, Development, ...) defined in Options and assigned per host, with a
  production banner in sessions.
- SFTP v2: two panes with multi-select and sortable columns, folder upload / download / delete,
  conflict handling (overwrite, keep both, skip), `.bak` copies, transfer queue with pause, resume and
  cancel, resume after a dropped connection, chmod, edit in a local editor, drag and drop, transfers in
  the status bar.
- Export / import wizard: encrypted `.shellium` files (optionally with passwords), CSV host lists,
  and other tools' XML exports with a field-mapping step; conflicts are
  reviewed before import and an import can be undone.
- Trusted host keys in Options › Security: list, remove, import an OpenSSH `known_hosts`.
- Anti-idle per host: protocol NO-OP interval, keep-alive string, unanswered NO-OPs before closing.
- Multi-line paste review: anything with a line break is shown, editable, before it is sent.
- Find in terminal, terminal font dialog with live preview, Help › About Shellium.

### Security
- The app password is mandatory; nothing is stored unencrypted. The connection database is
  AES-256-GCM encrypted with a key from the app password and the OS key store (DPAPI, Keychain,
  GNOME Keyring / KWallet); Linux without a keyring is refused.
- SSH host keys are verified (trust on first use, changed keys refused unless replaced).
- Legacy SSH algorithms only per host or after an explicit prompt.

### Fixed
- Escape closes only the topmost window.
- The terminal scrollbar can be dragged again.
- A CSV import no longer resets X11, anti-idle, legacy-algorithm or environment settings of hosts
  that are already there.
- Linux: data files are owner-only, keyring messages name the cause, terminal fonts fall back to the
  bundled JetBrains Mono.

## [1.0.3] - 2026-08-25

### Changed
- The native Electron application menu is hidden.

## [1.0.2] - 2026-08-25

### Fixed
- Packaged builds include the `safer-buffer` dependency.

## [1.0.1] - 2026-08-25

### Fixed
- Packaged builds include the SSH runtime dependencies.

## [1.0.0] - 2026-08-25

First release.
