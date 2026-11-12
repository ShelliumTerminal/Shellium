import { ipcRenderer, contextBridge, webFrame, webUtils } from 'electron'

contextBridge.exposeInMainWorld('shellium', {
  app: {
    platform: process.platform,
    versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, arch: process.arch },
    setZoomFactor(factor: number) {
      webFrame.setZoomFactor(factor)
    },
    /** Cut / copy / paste / select all on the focused field (the themed text-field menu). */
    edit(command: 'cut' | 'copy' | 'paste' | 'selectAll') {
      ipcRenderer.send('app:edit', command)
    },
    onShortcut(callback: (shortcut: string) => void) {
      const listener = (_event: Electron.IpcRendererEvent, shortcut: string) => callback(shortcut)
      ipcRenderer.on('app:shortcut', listener)
      return () => ipcRenderer.off('app:shortcut', listener)
    },
    onCloseRequest(callback: () => void) {
      const listener = () => callback()
      ipcRenderer.on('app:close-request', listener)
      return () => ipcRenderer.off('app:close-request', listener)
    },
    confirmClose() {
      return ipcRenderer.invoke('app:confirm-close')
    },
    /** http / https only (checked again in the main process). */
    openExternal(url: string) {
      return ipcRenderer.invoke('app:openExternal', url)
    },
    /** Flashes the taskbar button when the window is in the background. */
    requestAttention() {
      ipcRenderer.send('app:requestAttention')
    },
  },
  clipboard: {
    readText() {
      return ipcRenderer.invoke('clipboard:readText')
    },
    writeText(text: string) {
      return ipcRenderer.invoke('clipboard:writeText', text)
    },
  },
  security: {
    status() {
      return ipcRenderer.invoke('security:status')
    },
    setup(password: string) {
      return ipcRenderer.invoke('security:setup', password)
    },
    unlock(password: string) {
      return ipcRenderer.invoke('security:unlock', password)
    },
    lock() {
      return ipcRenderer.invoke('security:lock')
    },
  },
  settings: {
    get() {
      return ipcRenderer.invoke('settings:get')
    },
    saveAppOptions(options: unknown) {
      return ipcRenderer.invoke('settings:saveAppOptions', options)
    },
    savePaletteTreeWidth(treeWidth: number) {
      return ipcRenderer.invoke('settings:savePaletteTreeWidth', treeWidth)
    },
    savePaletteFrame(frame: unknown) {
      return ipcRenderer.invoke('settings:savePaletteFrame', frame)
    },
    savePaletteExpandedFolders(expandedFolderIds: string[]) {
      return ipcRenderer.invoke('settings:savePaletteExpandedFolders', expandedFolderIds)
    },
    chooseDataDirectory() {
      return ipcRenderer.invoke('settings:chooseDataDirectory')
    },
    chooseXServerExecutable() {
      return ipcRenderer.invoke('settings:chooseXServerExecutable')
    },
    chooseTerminalRecordingDirectory(currentPath?: string) {
      return ipcRenderer.invoke('settings:chooseTerminalRecordingDirectory', currentPath)
    },
  },
  connections: {
    list() {
      return ipcRenderer.invoke('connections:list')
    },
    save(folders: unknown) {
      return ipcRenderer.invoke('connections:save', folders)
    },
  },
  scriptButtons: {
    list() {
      return ipcRenderer.invoke('scriptButtons:list')
    },
    save(library: unknown) {
      return ipcRenderer.invoke('scriptButtons:save', library)
    },
  },
  transfer: {
    exportSources() {
      return ipcRenderer.invoke('transfer:exportSources')
    },
    exportFile(selection: unknown, passphrase: string) {
      return ipcRenderer.invoke('transfer:export', selection, passphrase)
    },
    exportCsv(folderIds: string[] | undefined, delimiter: string) {
      return ipcRenderer.invoke('transfer:exportCsv', folderIds, delimiter)
    },
    openImport() {
      return ipcRenderer.invoke('transfer:openImport')
    },
    unlockImport(token: string, passphrase: string) {
      return ipcRenderer.invoke('transfer:unlockImport', token, passphrase)
    },
    mapImport(token: string, mapping: unknown) {
      return ipcRenderer.invoke('transfer:mapImport', token, mapping)
    },
    previewImport(token: string, selection: unknown) {
      return ipcRenderer.invoke('transfer:previewImport', token, selection)
    },
    applyImport(token: string, selection: unknown, decisions: unknown) {
      return ipcRenderer.invoke('transfer:applyImport', token, selection, decisions)
    },
    undoImport() {
      return ipcRenderer.invoke('transfer:undoImport')
    },
    discard(token?: string) {
      return ipcRenderer.invoke('transfer:discard', token)
    },
  },
  knownHosts: {
    list() {
      return ipcRenderer.invoke('knownHosts:list')
    },
    remove(id: string) {
      return ipcRenderer.invoke('knownHosts:remove', id)
    },
    importOpenSsh() {
      return ipcRenderer.invoke('knownHosts:importOpenSsh')
    },
  },
  connectionPrompt: {
    onAsk(callback: (prompt: unknown) => void) {
      const listener = (_event: Electron.IpcRendererEvent, prompt: unknown) => callback(prompt)
      ipcRenderer.on('connectionPrompt:ask', listener)
      return () => ipcRenderer.off('connectionPrompt:ask', listener)
    },
    onCancel(callback: (requestId: string) => void) {
      const listener = (_event: Electron.IpcRendererEvent, requestId: string) => callback(requestId)
      ipcRenderer.on('connectionPrompt:cancel', listener)
      return () => ipcRenderer.off('connectionPrompt:cancel', listener)
    },
    respond(requestId: string, decision: string) {
      return ipcRenderer.invoke('connectionPrompt:respond', requestId, decision)
    },
  },
  terminal: {
    connect(request: unknown) {
      return ipcRenderer.invoke('terminal:connect', request)
    },
    /** Connection details for the status bar (null when the session is gone). */
    info(sessionId: string) {
      return ipcRenderer.invoke('terminal:info', sessionId)
    },
    write(sessionId: string, data: string) {
      ipcRenderer.send('terminal:write', sessionId, data)
    },
    /** Script button: sent line by line, each line after the server answered the one before. */
    sendScript(sessionId: string, parts: Array<{ kind: 'text'; value: string } | { kind: 'pause' }>) {
      return ipcRenderer.invoke('terminal:sendScript', sessionId, parts)
    },
    resize(sessionId: string, cols: number, rows: number) {
      return ipcRenderer.invoke('terminal:resize', sessionId, cols, rows)
    },
    disconnect(sessionId: string) {
      return ipcRenderer.invoke('terminal:disconnect', sessionId)
    },
    saveTranscript(request: unknown) {
      return ipcRenderer.invoke('terminal:saveTranscript', request)
    },
    startRecording(request: unknown) {
      return ipcRenderer.invoke('terminal:startRecording', request)
    },
    stopRecording(sessionId: string) {
      return ipcRenderer.invoke('terminal:stopRecording', sessionId)
    },
    onData(callback: (payload: unknown) => void) {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
      ipcRenderer.on('terminal:data', listener)
      return () => ipcRenderer.off('terminal:data', listener)
    },
    onExit(callback: (payload: unknown) => void) {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
      ipcRenderer.on('terminal:exit', listener)
      return () => ipcRenderer.off('terminal:exit', listener)
    },
    /** Protected sessions: tmux / screen on the server (electron/sessionProtection.ts). */
    protectProbe(sessionId: string) {
      return ipcRenderer.invoke('terminal:protectProbe', sessionId)
    },
    protectStart(sessionId: string, target: unknown, adopt: boolean) {
      return ipcRenderer.invoke('terminal:protectStart', sessionId, target, adopt)
    },
    protectState(sessionId: string) {
      return ipcRenderer.invoke('terminal:protectState', sessionId)
    },
    protectStop(sessionId: string) {
      return ipcRenderer.invoke('terminal:protectStop', sessionId)
    },
    protectionName(sessionId: string) {
      return ipcRenderer.invoke('terminal:protectionName', sessionId)
    },
    onProtection(callback: (payload: unknown) => void) {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
      ipcRenderer.on('terminal:protection', listener)
      return () => ipcRenderer.off('terminal:protection', listener)
    },
  },
  sftp: {
    connect(request: unknown) {
      return ipcRenderer.invoke('sftp:connect', request)
    },
    list(sessionId: string, remotePath?: string) {
      return ipcRenderer.invoke('sftp:list', sessionId, remotePath)
    },
    disconnect(sessionId: string) {
      return ipcRenderer.invoke('sftp:disconnect', sessionId)
    },
    mkdir(sessionId: string, remoteDirectory: string, folderName: string) {
      return ipcRenderer.invoke('sftp:mkdir', sessionId, remoteDirectory, folderName)
    },
    rename(sessionId: string, remotePath: string, newName: string) {
      return ipcRenderer.invoke('sftp:rename', sessionId, remotePath, newName)
    },
    enqueue(sessionId: string, direction: string, sources: string[], targetDir: string) {
      return ipcRenderer.invoke('sftp:enqueue', sessionId, direction, sources, targetDir)
    },
    pickAndUpload(sessionId: string, targetDir: string, folders: boolean) {
      return ipcRenderer.invoke('sftp:pickAndUpload', sessionId, targetDir, folders)
    },
    resolveConflicts(jobId: string, decision: unknown) {
      return ipcRenderer.invoke('sftp:resolveConflicts', jobId, decision)
    },
    pauseJob(jobId: string) {
      return ipcRenderer.invoke('sftp:pauseJob', jobId)
    },
    resumeJob(jobId: string) {
      return ipcRenderer.invoke('sftp:resumeJob', jobId)
    },
    cancelJob(jobId: string) {
      return ipcRenderer.invoke('sftp:cancelJob', jobId)
    },
    clearFinishedJobs(sessionId: string) {
      return ipcRenderer.invoke('sftp:clearFinishedJobs', sessionId)
    },
    listJobs(sessionId: string) {
      return ipcRenderer.invoke('sftp:listJobs', sessionId)
    },
    onJobs(callback: (payload: unknown) => void) {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
      ipcRenderer.on('sftp:jobs', listener)
      return () => ipcRenderer.off('sftp:jobs', listener)
    },
    inspect(sessionId: string, remotePaths: string[]) {
      return ipcRenderer.invoke('sftp:inspect', sessionId, remotePaths)
    },
    deletePaths(sessionId: string, remotePaths: string[]) {
      return ipcRenderer.invoke('sftp:deletePaths', sessionId, remotePaths)
    },
    chmod(sessionId: string, remotePaths: string[], mode: number) {
      return ipcRenderer.invoke('sftp:chmod', sessionId, remotePaths, mode)
    },
    editStart(sessionId: string, remotePath: string) {
      return ipcRenderer.invoke('sftp:editStart', sessionId, remotePath)
    },
    editUpload(editId: string, force: boolean) {
      return ipcRenderer.invoke('sftp:editUpload', editId, force)
    },
    editStop(editId: string) {
      return ipcRenderer.invoke('sftp:editStop', editId)
    },
    editList(sessionId: string) {
      return ipcRenderer.invoke('sftp:editList', sessionId)
    },
    onEdit(callback: (payload: unknown) => void) {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
      ipcRenderer.on('sftp:edit', listener)
      return () => ipcRenderer.off('sftp:edit', listener)
    },
    /** Local path of a file dropped from Explorer / Finder. */
    pathForFile(file: File) {
      return webUtils.getPathForFile(file)
    },
  },
  localFiles: {
    list(localPath?: string) {
      return ipcRenderer.invoke('localFiles:list', localPath)
    },
    chooseDirectory() {
      return ipcRenderer.invoke('localFiles:chooseDirectory')
    },
    places() {
      return ipcRenderer.invoke('localFiles:places')
    },
  },
})

contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },
})
