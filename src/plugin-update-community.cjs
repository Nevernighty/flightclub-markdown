"use strict";

const ORIGIN = "https://flightclub.com.ua";
const PLUGIN = "flightclub-markdown";
const SEMVER = /^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$/;
const MAX_ARCHIVE = 2 * 1024 * 1024;
const failure = code => Object.assign(new Error(code), { code });
const compare = (a, b) => {
  if (!SEMVER.test(a || "") || !SEMVER.test(b || "")) throw failure("INVALID_VERSION");
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
};
async function sha(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), x => x.toString(16).padStart(2, "0")).join("");
}
function parseRelease(value) {
  const r = value?.release;
  if (value?.ok !== true || !r || !SEMVER.test(r.version || "") || !SEMVER.test(r.minimumVersion || "") ||
      !SEMVER.test(r.minAppVersion || "") || compare(r.minimumVersion, r.version) > 0 ||
      !/^[a-f0-9]{64}$/.test(r.sha256 || "") || !Number.isSafeInteger(r.bytes) || r.bytes < 1 || r.bytes > MAX_ARCHIVE ||
      r.url !== ORIGIN + "/downloads/" + PLUGIN + "-v" + r.version + ".zip") throw failure("INVALID_RELEASE");
  const history = Array.isArray(r.history) ? r.history.slice(0, 8).flatMap(entry => {
    if (!SEMVER.test(entry?.version || "") || compare(entry.version, r.version) > 0 || !Array.isArray(entry.changes)) return [];
    const changes = entry.changes.slice(0, 8).filter(change => typeof change === "string" && change.trim() && change.length <= 400);
    return changes.length ? [{ version: entry.version, changes }] : [];
  }) : [];
  return Object.freeze({ version: r.version, minimumVersion: r.minimumVersion, minAppVersion: r.minAppVersion, sha256: r.sha256, bytes: r.bytes, url: r.url, history });
}

function createPluginUpdater({ requestUrl, getVersion, onState = () => {}, now = Date.now }) {
  let state = { status: "unchecked", installedVersion: getVersion(), release: null, verifiedAt: 0, error: null };
  let checking = null;
  const publish = patch => {
    state = { ...state, ...patch, installedVersion: getVersion() };
    onState({ ...state });
    return { ...state };
  };
  async function check(force = false) {
    if (checking) return checking;
    if (!force && state.verifiedAt && now() - state.verifiedAt < (state.error ? 30000 : 600000)) return { ...state };
    checking = (async () => {
      try {
        const response = await requestUrl({ url: ORIGIN + "/m/obsidian-sync?obsidian=release-v1", method: "GET", throw: false });
        if (response.status !== 200) throw failure("UPDATE_CHECK_UNAVAILABLE");
        const release = parseRelease(response.json), installed = getVersion();
        const status = compare(installed, release.minimumVersion) < 0 ? "required" : compare(installed, release.version) < 0 ? "available" : "current";
        return publish({ status, release, verifiedAt: now(), error: null });
      } catch (error) {
        return publish({ status: state.status === "required" ? "required" : "unavailable", verifiedAt: now(), error: error.code || "UPDATE_CHECK_UNAVAILABLE" });
      }
    })();
    try { return await checking; } finally { checking = null; }
  }
  async function install() {
    throw failure("COMMUNITY_MANAGED_UPDATE");
  }
  return Object.freeze({
    COMMUNITY_MANAGED: true,
    check,
    install,
    snapshot: () => ({ ...state }),
    blocked: () => !["current", "available"].includes(state.status),
  });
}

module.exports = {
  COMMUNITY_MANAGED: true,
  createPluginUpdater,
  parseRelease,
  compareVersions: compare,
  sha256: sha,
};
