"use strict";
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const srcDir = path.join(root, "src");
const source = fs.readFileSync(path.join(srcDir, "main.js"), "utf8");
const input = (name) => fs.readFileSync(path.join(srcDir, name), "utf8");

const marker = "__FLIGHTCLUB_LOGO_DATA__";
if (source.split(marker).length !== 2) throw new Error("Expected one logo placeholder");
const logo = fs.readFileSync(path.join(srcDir, "flightclub-logo.png")).toString("base64");

const sync = "/*__FC_TREE_SYNC__*/";
if (source.split(sync).length !== 2) throw new Error("Expected one sync placeholder");
const planner = input("sync-plan.cjs");
const client = input("sync-client.cjs").replace('require("./sync-plan.cjs")', "plan");
const platformNote = input("platform-note.cjs");
const yamlProps = input("yaml-properties.cjs");
const canvasSync = input("canvas-sync.cjs");
const drive = input("drive-client.cjs")
  .replace('require("./sync-plan.cjs")', "plan")
  .replace('require("./platform-note.cjs")', "platformNote")
  .replace('require("./yaml-properties.cjs")', "yamlProps")
  .replace('require("./canvas-sync.cjs")', "canvasSync");
const bundled = 'const [FC_TREE_SYNC, FC_DRIVE_SYNC, FC_YAML_PROPS] = (() => {\nconst load = (factory) => { const module = {exports:{}}; factory(module); return module.exports; };\nconst plan = load((module) => {\n' + planner + '\n});\nconst platformNote = load((module) => {\n' + platformNote + '\n});\nconst yamlProps = load((module) => {\n' + yamlProps + '\n});\nconst canvasSync = load((module) => {\n' + canvasSync + '\n});\nreturn [load((module) => {\n' + client + '\n}), load((module) => {\n' + drive + '\n}), yamlProps];\n})();';

const teamPluginsMarker = "/*__FC_TEAM_PLUGINS__*/";
if (source.split(teamPluginsMarker).length !== 2) throw new Error("Expected one team plugins placeholder");
const bundledTeamPlugins = "const FC_TEAM_PLUGINS = (() => {\nconst module = { exports: {} };\n" + input("team-plugins.cjs") + "\nreturn module.exports;\n})();";

const eventPublishMarker = "/*__FC_EVENT_PUBLISH__*/";
if (source.split(eventPublishMarker).length !== 2) throw new Error("Expected one event publish placeholder");
const bundledEventPublish = "const FC_EVENT_PUBLISH = (() => {\nconst module = { exports: {} };\n" + input("event-publish.cjs") + "\nreturn module.exports;\n})();";

const directInstallerMarker = "/*__FC_DIRECT_PLUGIN_INSTALLER__*/";
if (source.split(directInstallerMarker).length !== 2) throw new Error("Expected one direct installer placeholder");
const directInstaller = "const FC_COMMUNITY_BUILD = true;\nconst fcCanDirectInstallCommunityPlugin = () => false;\nconst fcDirectInstallCommunityPlugin = null;";

const updateMarker = "/*__FC_PLUGIN_UPDATE__*/";
if (source.split(updateMarker).length !== 2) throw new Error("Expected one updater placeholder");
const updater = "const FC_PLUGIN_UPDATE = (() => {\nconst module = { exports: {} };\n" + input("plugin-update-community.cjs") + "\nreturn module.exports;\n})();";

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
if (!source.includes("const PLUGIN_VERSION = " + JSON.stringify(manifest.version) + ";")) {
  throw new Error("Runtime and manifest version must match");
}

const mediaMarker = "/*__FC_MARKDOWN_MEDIA__*/";
if (source.split(mediaMarker).length !== 2) throw new Error("Expected one Markdown media placeholder");
const sharedMedia = input("markdown-youtube.mjs").replace(/^export function /gm, "function ");
const bundledMedia = "const { parseMarkdownYouTube, renderMarkdownYouTube } = (() => {\n" + sharedMedia + "\nreturn { parseMarkdownYouTube, renderMarkdownYouTube };\n})();";

const graphMarker = "/*__FC_GRAPH_INSIGHTS__*/";
if (source.split(graphMarker).length !== 2) throw new Error("Expected one graph insights placeholder");
const insights = input("graph-insights.cjs");

const diffMarker = "/*__FC_MARKDOWN_DIFF__*/";
if (source.split(diffMarker).length !== 2) throw new Error("Expected one Markdown diff placeholder");
const sharedDiff = input("markdown-diff.mjs").replace(/^export function /gm, "function ");
const bundledDiff = "const FC_MARKDOWN_DIFF = (() => {\n" + sharedDiff + "\nreturn { diffMarkdownLines, diffInlineWords };\n})();";

fs.writeFileSync(
  path.join(root, "main.js"),
  source
    .replace(marker, () => "data:image/png;base64," + logo)
    .replace(sync, () => bundled)
    .replace(teamPluginsMarker, () => bundledTeamPlugins)
    .replace(eventPublishMarker, () => bundledEventPublish)
    .replace(directInstallerMarker, () => directInstaller)
    .replace(updateMarker, () => updater)
    .replace(mediaMarker, () => bundledMedia)
    .replace(diffMarker, () => bundledDiff)
    .replace(graphMarker, () => insights),
);

const baseCss = input("styles.css");
const mediaCss = input("markdown-youtube.css");
fs.writeFileSync(path.join(root, "styles.css"), baseCss + "\n" + mediaCss);
