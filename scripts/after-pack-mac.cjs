// electron-builder afterPack hook. Shellium has no Apple Developer ID yet (mac.identity is null, so
// electron-builder signs nothing), but Apple Silicon refuses to start code without any signature
// ("Shellium is damaged"). The app is therefore signed ad hoc ("-"): it starts after the usual
// "unidentified developer" step (Control-click > Open). Only the final app is signed - for a
// universal build not the x64 / arm64 halves, which @electron/universal merges afterwards.
const { execFileSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin' || /-temp$/.test(context.appOutDir)) {
    return
  }
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' })
}
