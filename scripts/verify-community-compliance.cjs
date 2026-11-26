"use strict";
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
for (const required of ["README.md", "LICENSE", "manifest.json", "versions.json", "package.json", "package-lock.json", "main.js", "styles.css"]) {
  if (!fs.existsSync(path.join(root, required))) {
    throw new Error("Missing required file: " + required);
  }
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
const versions = JSON.parse(fs.readFileSync(path.join(root, "versions.json"), "utf8"));
if (!/^[a-z0-9-]+$/.test(manifest.id || "")) throw new Error("Invalid manifest id");
if (!manifest.name || /obsidian|plugin/i.test(manifest.name)) throw new Error("Invalid plugin name");
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(manifest.version || "")) throw new Error("Invalid manifest version");
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(manifest.minAppVersion || "")) throw new Error("Invalid minAppVersion");
if (!manifest.description || manifest.description.length > 250 || !manifest.description.endsWith(".") || /^This is a plugin/i.test(manifest.description)) {
  throw new Error("Manifest description violates Obsidian guidelines");
}
if (!manifest.authorUrl || manifest.authorUrl === "https://flightclub.com.ua") {
  throw new Error("Manifest authorUrl must point to a publicly reachable page without 401 gate");
}
if (manifest.isDesktopOnly !== false) throw new Error("Expected isDesktopOnly: false");
if (versions[manifest.version] !== manifest.minAppVersion) throw new Error("versions.json mismatch");
if (pkg.version !== manifest.version) throw new Error("package.json version mismatch");
if (lock.version !== manifest.version || lock.lockfileVersion !== 3) throw new Error("package-lock.json mismatch");

const mainJs = fs.readFileSync(path.join(root, "main.js"), "utf8");
const stylesCss = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const srcStylesCss = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");

for (const lfFile of ["main.js", "styles.css", "manifest.json", "package.json", "package-lock.json", "versions.json"]) {
  if (fs.readFileSync(path.join(root, lfFile), "utf8").includes("\r\n")) {
    throw new Error("CRLF detected in release artifact: " + lfFile);
  }
}

const rules = [
  ["innerHTML / outerHTML / insertAdjacentHTML", /\b(innerHTML|outerHTML|insertAdjacentHTML)\b/g],
  ["Node built-in require()", /\brequire\s*\(\s*["'](?:node:|fs\b|path\b|os\b|crypto\b|child_process\b)/g],
  ["Node Buffer", /\bBuffer\b/g],
  ["Raw fetch()", /\bfetch\s*\(/g],
  ["eval / new Function", /\beval\s*\(|new\s+Function/g],
  ["window.open", /\bwindow\.open\b/g],
  ["Global window.app", /\bwindow\.app\b/g],
  ["Direct installPlugin", /\binstallPlugin\b/g],
  ["Bundled fflate", /\bfflate\b/g],
  ["Debug console.log", /\bconsole\.log\b/g],
  ["detachLeavesOfType in runtime", /\bdetachLeavesOfType\b/g],
  ["Hardcoded .obsidian string without configDir fallback", /\.obsidian\/plugins\/flightclub-markdown/g],
];

const cssRules = [
  ["CSS !important", /!important/g],
  ["CSS :has()", /:has\(/g],
  ["CSS scrollbar-width/color", /scrollbar-(?:width|color)/g],
];

const violations = [];
for (const [label, re] of rules) {
  const hits = mainJs.match(re);
  if (hits) violations.push({ label, count: hits.length });
}
for (const [label, re] of cssRules) {
  const h1 = stylesCss.match(re);
  const h2 = srcStylesCss.match(re);
  if (h1 || h2) violations.push({ label, count: (h1 ? h1.length : 0) + (h2 ? h2.length : 0) });
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
  authorUrl: manifest.authorUrl,
  isDesktopOnly: manifest.isDesktopOnly,
  lockfileVersion: lock.lockfileVersion,
  mainBytes: Buffer.byteLength(mainJs, "utf8"),
  stylesBytes: fs.statSync(path.join(root, "styles.css")).size,
}));
