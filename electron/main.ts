import type { BrowserWindow as BrowserWindowType } from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { registerAppSettingsHandlers } from './appSettings'
import { migrateConnectionSensitiveData, registerConnectionHandlers, resetConnectionDatabase } from './connectionsDb'
import { registerTerminalHandlers } from './terminalSsh'
import { registerConnectionPromptHandlers } from './connectionPrompts'
import { registerKnownHostsHandlers } from './knownHostsIpc'
import { registerSecurityHandlers, resetSecuritySession } from './security'
import { clearTransferSessions, registerTransferHandlers } from './transfer'
import { registerSftpJobHandlers } from './sftpJobs'

const require = createRequire(import.meta.url)
const { app, BrowserWindow, Menu, clipboard, ipcMain } = require('electron') as typeof import('electron')
const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

// Product name (menus, notifications, the macOS Keychain entry of safeStorage) and data folder.
// The folder is set explicitly rather than derived from package.json; a --user-data-dir on the
// command line (isolated test profiles) always wins.
app.setName('Shellium')
if (!app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath('userData', path.join(app.getPath('appData'), 'shellium'))
}

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

const vitePublic = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST
const appIcon = process.platform === 'win32'
  ? path.join(process.env.APP_ROOT, 'build', 'icon.ico')
  // A PNG: Electron cannot load SVG as a window icon (Linux showed none).
  : path.join(process.env.APP_ROOT, 'build', 'icon.png')
process.env.VITE_PUBLIC = vitePublic

let win: BrowserWindowType | null
let isAppCloseConfirmed = false

function registerAppCloseHandlers() {
  ipcMain.handle('app:confirm-close', () => {
    isAppCloseConfirmed = true
    win?.close()
  })
}

function registerClipboardHandlers() {
  ipcMain.handle('clipboard:readText', () => clipboard.readText())
  ipcMain.handle('clipboard:writeText', (_event, text: string) => {
    clipboard.writeText(text)
  })
  // The themed text-field menu (EditContextMenu.tsx) runs Chromium's own edit commands on the
  // focused field, so cut / paste keep undo history and input events like a keyboard shortcut.
  ipcMain.on('app:edit', (event, command: unknown) => {
    if (command === 'cut' || command === 'copy' || command === 'paste' || command === 'selectAll') {
      event.sender[command]()
    }
  })
}

function createWindow() {
  Menu.setApplicationMenu(null)

  win = new BrowserWindow({
    autoHideMenuBar: true,
    // Black until the page paints: the start animation (or the password screen) follows, not a white flash.
    backgroundColor: '#000000',
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  win.setMenuBarVisibility(false)
  win.maximize()

  win.on('close', (event) => {
    if (isAppCloseConfirmed) {
      return
    }

    event.preventDefault()
    win?.webContents.send('app:close-request')
  })

  // Connect dialog: Alt+S, Cmd+S on macOS (src/app/platform.ts). Matched by the physical key (on macOS
  // Option+S types a character) and stopped here, so the terminal never gets it.
  const isMac = process.platform === 'darwin'
  win.webContents.on('before-input-event', (event, input) => {
    const modifierOk = isMac
      ? input.meta && !input.alt && !input.control && !input.shift
      : input.alt && !input.meta && !input.control && !input.shift
    if (input.type === 'keyDown' && modifierOk && input.code === 'KeyS') {
      event.preventDefault()
      win?.webContents.send('app:shortcut', 'connect')
    }
  })
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(() => {
  // Unpackaged runs (`electron .`) show Electron's own icon in the macOS Dock; packaged builds use
  // build/icon.icns. The Dock *name* of an unpackaged run comes from Electron.app itself - see
  // scripts/mac-dev-branding.mjs.
  if (process.platform === 'darwin' && !app.isPackaged) {
    app.dock?.setIcon(appIcon)
  }
  registerAppCloseHandlers()
  registerClipboardHandlers()
  registerAppSettingsHandlers(() => {
    resetConnectionDatabase()
    resetSecuritySession()
    clearTransferSessions()
  })
  registerSecurityHandlers(migrateConnectionSensitiveData, () => {
    resetConnectionDatabase()
    clearTransferSessions()
  })
  registerConnectionHandlers()
  registerConnectionPromptHandlers()
  registerKnownHostsHandlers()
  registerTransferHandlers()
  registerTerminalHandlers()
  registerSftpJobHandlers()
  createWindow()
})
