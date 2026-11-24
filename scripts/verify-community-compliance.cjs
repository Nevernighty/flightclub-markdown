"use strict";
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
for (const required of ["README.md", "LICENSE", "manifest.json", "versions.json", "main.js", "styles.css"]) {
  if (!fs.existsSync(path.join(root, required))) {
    throw new Error("Missing required file: " + required);
  }
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const versions = JSON.parse(fs.readFileSync(path.join(root, "versions.json"), "utf8"));
if (!/^[a-z0-9-]+$/.test(manifest.id || "")) throw new Error("Invalid manifest id");
if (!manifest.name || /obsidian|plugin/i.test(manifest.name)) throw new Error("Invalid plugin name");
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(manifest.version || "")) throw new Error("Invalid manifest version");
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(manifest.minAppVersion || "")) throw new Error("Invalid minAppVersion");
if (!manifest.description || manifest.description.length > 250 || !manifest.description.endsWith(".") || /^This is a plugin/i.test(manifest.description)) {
  throw new Error("Manifest description violates Obsidian guidelines");
}
if (manifest.isDesktopOnly !== false) throw new Error("Expected isDesktopOnly: false");
if (versions[manifest.version] !== manifest.minAppVersion) throw new Error("versions.json mismatch");

const mainJs = fs.readFileSync(path.join(root, "main.js"), "utf8");
const stylesCss = fs.readFileSync(path.join(root, "styles.css"), "utf8");
if (mainJs.includes("\r\n") || stylesCss.includes("\r\n")) {
  throw new Error("Build artifacts must use LF line endings for deterministic verification");
}
const rules = [
  ["innerHTML / outerHTML / insertAdjacentHTML", /\b(innerHTML|outerHTML|insertAdjacentHTML)\b/g],
  ["Node built-in require()", /\brequire\s*\(\s*["'](?:node:|fs\b|path\b|os\b|crypto\b|child_process\b)/g],
  ["Node Buffer", /\bBuffer\b/g],
  ["Raw fetch()", /\bfetch\s*\(/g],
  ["eval / new Function", /\beval\s*\(|new\s+Function/g],
  ["Regex lookbehind (iOS / obsidianmd/regex-lookbehind)", /\(\?<[=!]/g],
  ["detachLeavesOfType in onunload (obsidianmd/detach-leaves)", /\bdetachLeavesOfType\b/g],
  ["window.open", /\bwindow\.open\b/g],
  ["Global window.app", /\bwindow\.app\b/g],
  ["Direct installPlugin", /\binstallPlugin\b/g],
  ["Bundled fflate", /\bfflate\b/g],
  ["Debug console.log", /\bconsole\.log\b/g],
  ["Hardcoded .obsidian string without configDir fallback", /\.obsidian\/plugins\/flightclub-markdown/g],
];

const violations = [];
for (const [label, re] of rules) {
  const hits = mainJs.match(re);
  if (hits) violations.push({ label, count: hits.length });
}
if (violations.length) {
  console.error("Compliance violations:", JSON.stringify(violations, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({
  ok: true,
  id: manifest.id,
  version: manifest.version,
  minAppVersion: manifest.minAppVersion,
  isDesktopOnly: manifest.isDesktopOnly,
  mainBytes: Buffer.byteLength(mainJs, "utf8"),
  stylesBytes: fs.statSync(path.join(root, "styles.css")).size,
}));
