// macOS only: an unpackaged run (`pnpm dev`, `electron .`) is Electron.app, so the Dock shows
// "Electron" and its icon. This makes a project-local copy of Electron.app named Shellium with our
// icon in .electron-dev/ and prints how to use it. node_modules is never modified (pnpm hard-links
// it from a store shared with other projects). Packaged builds don't need this.
//
//   node scripts/mac-dev-branding.mjs
//   ELECTRON_OVERRIDE_DIST_PATH="$PWD/.electron-dev/dist" pnpm dev        (or: pnpm dev:mac)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") {
  console.log("mac-dev-branding: macOS only, nothing to do.");
  process.exit(0);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDist = path.join(root, "node_modules", "electron", "dist");
const targetDist = path.join(root, ".electron-dev", "dist");
const app = path.join(targetDist, "Electron.app");
const versionFile = path.join(root, ".electron-dev", "electron-version");
const electronVersion = JSON.parse(fs.readFileSync(path.join(root, "node_modules", "electron", "package.json"), "utf8")).version;

if (!fs.existsSync(app) || !fs.existsSync(versionFile) || fs.readFileSync(versionFile, "utf8") !== electronVersion) {
  fs.rmSync(targetDist, { recursive: true, force: true });
  fs.mkdirSync(targetDist, { recursive: true });
  // ditto keeps the bundle's symlinks and extended attributes intact
  execFileSync("ditto", [path.join(sourceDist, "Electron.app"), app]);
  fs.writeFileSync(versionFile, electronVersion);
}

const plistPath = path.join(app, "Contents", "Info.plist");
let plist = fs.readFileSync(plistPath, "utf8");
const setKey = (key, value) => {
  const pattern = new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`);
  plist = pattern.test(plist)
    ? plist.replace(pattern, `$1${value}$2`)
    : plist.replace("<dict>", `<dict>\n\t<key>${key}</key>\n\t<string>${value}</string>`);
};
setKey("CFBundleName", "Shellium");
setKey("CFBundleDisplayName", "Shellium");
setKey("CFBundleIdentifier", "com.shellium.app.dev");
fs.writeFileSync(plistPath, plist);
fs.copyFileSync(path.join(root, "build", "icon.icns"), path.join(app, "Contents", "Resources", "electron.icns"));

// Editing Info.plist breaks Electron's signature; Apple silicon refuses to launch that, so sign
// the copy ad hoc again. Then nudge Launch Services / the Dock to pick up the new name and icon.
execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
fs.utimesSync(app, new Date(), new Date());

console.log(`mac-dev-branding: ${app} is now "Shellium".`);
console.log(`Run with: ELECTRON_OVERRIDE_DIST_PATH="${targetDist}" pnpm dev   (or pnpm dev:mac)`);
