"use strict";

const SELF_PLUGIN_ID = "flightclub-markdown";
const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9._-]{0,80}$/i;
const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const COMMUNITY_PLUGINS_URL = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json";
const SECRET_KEY_RE = /(?:token|secret|password|passwd|api[_-]?key|private[_-]?key|cookie|auth|credential|session|bearer|refresh)/i;

function validPluginId(id) {
  return typeof id === "string" && PLUGIN_ID_RE.test(id.trim()) && id.trim().toLowerCase() !== SELF_PLUGIN_ID;
}

function sanitizePluginConfig(value, state = { strippedKeysCount: 0 }, depth = 0) {
  if (depth > 12 || value === undefined) return { cleaned: undefined, strippedKeysCount: state.strippedKeysCount };
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return { cleaned: value, strippedKeysCount: state.strippedKeysCount };
  }
  if (typeof value === "number") {
    return { cleaned: Number.isFinite(value) ? value : undefined, strippedKeysCount: state.strippedKeysCount };
  }
  if (Array.isArray(value)) {
    const arr = value.slice(0, 500).map((item) => {
      const sub = sanitizePluginConfig(item, state, depth + 1);
      return sub.cleaned === undefined ? null : sub.cleaned;
    });
    return { cleaned: arr, strippedKeysCount: state.strippedKeysCount };
  }
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY_RE.test(k)) {
        state.strippedKeysCount++;
        continue;
      }
      const sub = sanitizePluginConfig(v, state, depth + 1);
      if (sub.cleaned !== undefined) out[k] = sub.cleaned;
    }
    return { cleaned: out, strippedKeysCount: state.strippedKeysCount };
  }
  return { cleaned: undefined, strippedKeysCount: state.strippedKeysCount };
}

function getConfigDir(app) {
  const raw = typeof app?.vault?.configDir === "string" ? app.vault.configDir.trim() : "";
  return raw ? raw.replace(/\/+$/, "") : ".obsidian";
}

async function readEnabledPluginIds(app) {
  const enabled = new Set();
  const rawEnabled = app?.plugins?.enabledPlugins;
  if (rawEnabled instanceof Set) {
    for (const id of rawEnabled) if (typeof id === "string") enabled.add(id.trim());
    return enabled;
  }
  if (Array.isArray(rawEnabled)) {
    for (const id of rawEnabled) if (typeof id === "string") enabled.add(id.trim());
    return enabled;
  }
  const adapter = app?.vault?.adapter;
  if (adapter && typeof adapter.exists === "function" && typeof adapter.read === "function") {
    const filePath = `${getConfigDir(app)}/community-plugins.json`;
    try {
      if (await adapter.exists(filePath)) {
        const parsed = JSON.parse(await adapter.read(filePath));
        if (Array.isArray(parsed)) {
          for (const id of parsed) if (typeof id === "string") enabled.add(id.trim());
        }
      }
    } catch {}
  }
  return enabled;
}

async function listInstalledPlugins(app) {
  const configDir = getConfigDir(app);
  const pluginsRoot = `${configDir}/plugins`;
  const adapter = app?.vault?.adapter;
  const enabledSet = await readEnabledPluginIds(app);
  const byId = new Map();

  const manifests = app?.plugins?.manifests;
  if (manifests && typeof manifests === "object") {
    const entries = manifests instanceof Map ? manifests.entries() : Object.entries(manifests);
    for (const [key, mf] of entries) {
      const id = String(mf?.id || key || "").trim();
      if (!validPluginId(id)) continue;
      byId.set(id.toLowerCase(), {
        id,
        name: String(mf?.name || id).trim(),
        version: String(mf?.version || "").trim(),
        author: String(mf?.author || "").trim(),
        description: String(mf?.description || "").trim(),
        isDesktopOnly: Boolean(mf?.isDesktopOnly),
        enabled: enabledSet.has(id),
        hasDataJson: false,
      });
    }
  }

  if (adapter && typeof adapter.list === "function") {
    let listing = null;
    try { listing = await adapter.list(pluginsRoot); } catch { listing = null; }
    const folders = Array.isArray(listing?.folders) ? listing.folders : [];
    for (const folderPath of folders) {
      const folderName = String(folderPath || "").replace(/\/+$/, "").split("/").pop() || "";
      if (!validPluginId(folderName)) continue;
      const lower = folderName.toLowerCase();
      if (!byId.has(lower) && typeof adapter.exists === "function" && typeof adapter.read === "function") {
        const mfPath = `${pluginsRoot}/${folderName}/manifest.json`;
        try {
          if (await adapter.exists(mfPath)) {
            const mf = JSON.parse(await adapter.read(mfPath));
            const id = String(mf?.id || folderName).trim();
            if (validPluginId(id)) {
              byId.set(id.toLowerCase(), {
                id,
                name: String(mf?.name || id).trim(),
                version: String(mf?.version || "").trim(),
                author: String(mf?.author || "").trim(),
                description: String(mf?.description || "").trim(),
                isDesktopOnly: Boolean(mf?.isDesktopOnly),
                enabled: enabledSet.has(id),
                hasDataJson: false,
              });
            }
          }
        } catch {}
      }
    }
  }

  if (adapter && typeof adapter.exists === "function") {
    for (const entry of byId.values()) {
      try {
        entry.hasDataJson = Boolean(await adapter.exists(`${pluginsRoot}/${entry.id}/data.json`));
      } catch {
        entry.hasDataJson = false;
      }
    }
  }

  return Array.from(byId.values()).sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    return a.name.localeCompare(b.name, "uk");
  });
}

async function fetchCommunityPluginsCatalog(requestUrl, cache = null, now = Date.now) {
  const ttlMs = 10 * 60 * 1000;
  if (cache?.map instanceof Map && cache.fetchedAt && now() - cache.fetchedAt < ttlMs) {
    return cache.map;
  }
  const map = new Map();
  if (typeof requestUrl !== "function") return map;
  try {
    const res = await requestUrl({ url: COMMUNITY_PLUGINS_URL, method: "GET", throw: false });
    const rows = Array.isArray(res?.json)
      ? res.json
      : typeof res?.text === "string"
        ? JSON.parse(res.text)
        : null;
    if (res?.status === 200 && Array.isArray(rows)) {
      for (const row of rows) {
        const id = typeof row?.id === "string" ? row.id.trim() : "";
        const repo = typeof row?.repo === "string" ? row.repo.trim() : "";
        if (!validPluginId(id) || !REPO_RE.test(repo)) continue;
        map.set(id.toLowerCase(), {
          id,
          name: String(row.name || id).trim(),
          author: String(row.author || "").trim(),
          description: String(row.description || "").trim(),
          repo,
        });
      }
      if (cache && typeof cache === "object") {
        cache.map = map;
        cache.fetchedAt = now();
      }
    }
  } catch {}
  return map;
}

function computeTeamPluginStatus({ teamPlugins = [], installedPlugins = [], isMobile = false } = {}) {
  const installedById = new Map(
    (Array.isArray(installedPlugins) ? installedPlugins : [])
      .filter((p) => validPluginId(p?.id))
      .map((p) => [p.id.toLowerCase(), p]),
  );
  const rows = [];
  let installedCount = 0;
  let missingCount = 0;
  let disabledCount = 0;
  let desktopOnlyCount = 0;

  for (const item of Array.isArray(teamPlugins) ? teamPlugins : []) {
    if (!validPluginId(item?.id)) continue;
    const local = installedById.get(item.id.toLowerCase()) || null;
    const desktopBlocked = Boolean(isMobile && item.isDesktopOnly);
    let status;
    if (desktopBlocked && !local) {
      status = "desktop_only_mobile";
      desktopOnlyCount++;
    } else if (!local) {
      status = "missing";
      missingCount++;
    } else if (desktopBlocked) {
      status = "desktop_only_mobile";
      desktopOnlyCount++;
    } else if (local.enabled) {
      status = "installed_enabled";
      installedCount++;
    } else {
      status = "installed_disabled";
      disabledCount++;
    }
    rows.push({
      ...item,
      local,
      status,
    });
  }

  return {
    rows,
    installedCount,
    missingCount,
    disabledCount,
    desktopOnlyCount,
    actionableCount: missingCount + disabledCount,
  };
}

async function readLocalPluginConfig(app, pluginId) {
  if (!validPluginId(pluginId)) return null;
  const adapter = app?.vault?.adapter;
  if (!adapter || typeof adapter.exists !== "function" || typeof adapter.read !== "function") return null;
  const filePath = `${getConfigDir(app)}/plugins/${pluginId.trim()}/data.json`;
  try {
    if (!(await adapter.exists(filePath))) return null;
    const parsed = JSON.parse(await adapter.read(filePath));
    return sanitizePluginConfig(parsed);
  } catch {
    return null;
  }
}

async function ensureDir(adapter, dirPath) {
  const parts = String(dirPath || "").split("/").filter(Boolean);
  let cur = "";
  for (const part of parts) {
    cur += (cur ? "/" : "") + part;
    if (typeof adapter.exists === "function" && !(await adapter.exists(cur))) {
      if (typeof adapter.mkdir === "function") await adapter.mkdir(cur);
    }
  }
}

async function applySharedPluginConfig(app, pluginId, sharedData) {
  if (!validPluginId(pluginId)) throw new Error("Некоректний ідентифікатор плагіна.");
  if (sharedData === undefined || sharedData === null) throw new Error("Спільні налаштування відсутні.");
  const adapter = app?.vault?.adapter;
  if (!adapter || typeof adapter.write !== "function") throw new Error("Файловий адаптер недоступний.");
  const { cleaned } = sanitizePluginConfig(sharedData);
  if (cleaned === undefined) throw new Error("Некоректний формат налаштувань.");
  const pluginDir = `${getConfigDir(app)}/plugins/${pluginId.trim()}`;
  const dataPath = `${pluginDir}/data.json`;
  const backupPath = `${pluginDir}/data.json.fc-backup.json`;
  await ensureDir(adapter, pluginDir);
  let backedUp = false;
  if (typeof adapter.exists === "function" && typeof adapter.read === "function" && await adapter.exists(dataPath)) {
    try {
      const currentRaw = await adapter.read(dataPath);
      await adapter.write(backupPath, currentRaw);
      backedUp = true;
    } catch {}
  }
  await adapter.write(dataPath, JSON.stringify(cleaned, null, 2) + "\n");
  return { ok: true, dataPath, backupPath: backedUp ? backupPath : null };
}

function communityPluginDeepLink(pluginId) {
  if (!validPluginId(pluginId)) return null;
  return `obsidian://show-plugin?id=${encodeURIComponent(pluginId.trim())}`;
}

function openCommunityPluginPage(pluginId, opener = null) {
  const href = communityPluginDeepLink(pluginId);
  if (!href) return false;
  if (typeof opener === "function") {
    opener(href);
    return true;
  }
  if (typeof document !== "undefined" && typeof document.createElement === "function") {
    const a = document.createElement("a");
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.click?.();
    return true;
  }
  return false;
}

module.exports = {
  SELF_PLUGIN_ID,
  COMMUNITY_PLUGINS_URL,
  validPluginId,
  sanitizePluginConfig,
  getConfigDir,
  readEnabledPluginIds,
  listInstalledPlugins,
  fetchCommunityPluginsCatalog,
  computeTeamPluginStatus,
  readLocalPluginConfig,
  applySharedPluginConfig,
  communityPluginDeepLink,
  openCommunityPluginPage,
};
