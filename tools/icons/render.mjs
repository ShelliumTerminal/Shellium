// Renders every box of icons.html to its own transparent PNG (exact pixel size) via headless Chrome + CDP.
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const { height, boxes } = JSON.parse(fs.readFileSync(path.join(here, "boxes.json"), "utf8"));
const outDir = path.join(here, "png");
fs.mkdirSync(outDir, { recursive: true });

const chrome = spawn(process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe", [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", "--remote-debugging-port=9555",
  `--user-data-dir=${path.join(here, "chrome-prof")}`, `--window-size=2200,${height}`, "about:blank",
], { stdio: "ignore" });

let targets = [];
for (let i = 0; i < 50 && !targets.length; i++) {
  await new Promise((r) => setTimeout(r, 300));
  try { targets = (await (await fetch("http://127.0.0.1:9555/json")).json()).filter((t) => t.type === "page"); } catch { /* not up yet */ }
}
const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const msg = JSON.parse(m.data); pending.get(msg.id)?.(msg); pending.delete(msg.id); };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 2200, height, deviceScaleFactor: 1, mobile: false });
await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
await send("Page.navigate", { url: "file:///" + path.join(here, "icons.html").replace(/\\/g, "/") });
await new Promise((r) => setTimeout(r, 1500));

for (const [name, b] of Object.entries(boxes)) {
  const res = await send("Page.captureScreenshot", { format: "png", fromSurface: true, clip: { x: b.x, y: b.y, width: b.s, height: b.s, scale: 1 } });
  fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(res.result.data, "base64"));
}
console.log("rendered", Object.keys(boxes).length);
ws.close();
chrome.kill();
