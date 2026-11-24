"use strict";

const {
  canvasTextEquals,
  mergeCanvasJsonText,
  readCanvas,
  retainCanvasMedia,
  summarizeCanvasDiff,
  mergeCanvasBestEffort,
} = require("./canvas-sync.cjs");

const { validPath } = require("./sync-plan.cjs");
const { readPlatformNote, platformEditableTitle } = require("./platform-note.cjs");
const {
  upsertYamlProperties,
  isGoogleDocsMangledFrontmatter,
  isUnrepairableDocsFrontmatter,
  splitFrontmatter,
  driveViewUrl,
  siteVaultEditUrl,
} = require("./yaml-properties.cjs");

function shouldUnescapeCalloutsOnPath(localPath) {
  return !/(?:^|\/)05 sop\/(?!SOP ДЛЯ НЕЙРОМЕРЕЖ)/i.test(String(localPath || ""));
}
const ID = /^[A-Za-z0-9_-]{3,200}$/;
const VERSION = /^\d{1,30}$/;
const SHA = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const ROOT_LIMIT = 5000;
const NO_FILE = new Set(["folder", "shortcut", "google-native"]);
const TEXT_KINDS = new Set(["markdown", "canvas", "text"]);
const TEXT_EXTS = new Set(["md", "markdown", "canvas", "base", "txt", "yaml", "yml", "json", "csv"]);
const BINARY_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif", "svg", "pdf", "mp3", "wav", "ogg", "m4a"]);
const EXCLUDED = /\.(?:js|cjs|mjs|html?|css|exe|dll|ps1|bat|cmd|sh|lnk|desktop)$/i;
const RESERVED_LOCAL_ROOT = /^(?:FlightClub Shared|FlightClub Platform|FlightClub Sync Archive|\.obsidian|\.trash|\.git|\.makemd|\.space)(?:\/|$)/i;
const IGNORED_LOCAL_FILE = /(?:^|\/)(?:\.DS_Store|Thumbs\.db|desktop\.ini|~\$[^/]+|[^/]+\.(?:tmp|part|crdownload|bak))$/i;

const MD5_SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const MD5_K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0);

function md5Hex(bytes) {
  const input = bytes instanceof Uint8Array
    ? bytes
    : bytes instanceof ArrayBuffer
      ? new Uint8Array(bytes)
      : new Uint8Array(bytes?.buffer || bytes || 0, bytes?.byteOffset || 0, bytes?.byteLength || 0);
  const bitLen = input.length * 8;
  const paddedLen = (((input.length + 8) >> 6) + 1) << 6;
  const msg = new Uint8Array(paddedLen);
  msg.set(input);
  msg[input.length] = 0x80;
  const view = new DataView(msg.buffer);
  view.setUint32(paddedLen - 8, bitLen >>> 0, true);
  view.setUint32(paddedLen - 4, Math.floor(bitLen / 0x100000000) >>> 0, true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const M = new Uint32Array(16);

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let j = 0; j < 16; j++) M[j] = view.getUint32(offset + j * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) & 15;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) & 15;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) & 15;
      }
      const sum = (A + F + MD5_K[i] + M[g]) >>> 0;
      A = D;
      D = C;
      C = B;
      const s = MD5_SHIFTS[i];
      B = (B + ((sum << s) | (sum >>> (32 - s)))) >>> 0;
    }
    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  let hex = "";
  for (const word of [a0, b0, c0, d0]) {
    for (let b = 0; b < 4; b++) {
      hex += ((word >>> (b * 8)) & 0xff).toString(16).padStart(2, "0");
    }
  }
  return hex;
}

function toBase64(bytes) {
  const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes.buffer || bytes, bytes.byteOffset || 0, bytes.byteLength);
  let out = "";
  for (let at = 0; at < view.length; at += 0x8000) out += String.fromCharCode(...view.subarray(at, at + 0x8000));
  return btoa(out);
}

function fromBase64(base64) {
  const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function extOf(path) {
  return String(path || "").match(/\.([^.]+)$/)?.[1]?.toLowerCase() || "";
}

function isTextKind(kind) {
  return TEXT_KINDS.has(kind);
}

function splitBaseYamlDocument(raw) {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const viewsIdx = lines.findIndex(line => /^views:\s*$/.test(line));
  if (viewsIdx < 0) return null;
  let endIdx = lines.length;
  for (let i = viewsIdx + 1; i < lines.length; i++) {
    if (/^[A-Za-z_][A-Za-z0-9_-]*:/.test(lines[i])) { endIdx = i; break; }
  }
  const header = lines.slice(0, viewsIdx + 1).join("\n");
  const footer = endIdx < lines.length ? lines.slice(endIdx).join("\n").replace(/\n+$/, "") : "";
  const bodyLines = lines.slice(viewsIdx + 1, endIdx);
  const rawBlocks = [];
  let current = null;
  for (const line of bodyLines) {
    if (/^  - /.test(line)) {
      if (current) rawBlocks.push(current);
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) rawBlocks.push(current);
  const counts = new Map();
  const views = rawBlocks.map((blockLines, idx) => {
    while (blockLines.length > 1 && blockLines[blockLines.length - 1] === "") blockLines.pop();
    const blockText = blockLines.join("\n");
    const nameMatch = blockText.match(/^(?:  - |    )name:\s*(.+?)\s*$/m);
    const rawName = nameMatch ? nameMatch[1].replace(/^["']|["']$/g, "").trim() : `__idx_${idx}`;
    const seen = (counts.get(rawName) || 0) + 1;
    counts.set(rawName, seen);
    const key = seen === 1 ? rawName : `${rawName}#${seen}`;
    return { key, text: blockText };
  });
  return { header, views, footer };
}

function mergeBaseYamlText(baseRaw, localRaw, remoteRaw, { preferLocal = false } = {}) {
  const local = splitBaseYamlDocument(localRaw);
  const remote = splitBaseYamlDocument(remoteRaw);
  if (!local || !remote) return null;
  const base = splitBaseYamlDocument(baseRaw);

  let mergedHeader = remote.header;
  if (local.header === remote.header) mergedHeader = remote.header;
  else if (base && base.header === remote.header) mergedHeader = local.header;
  else if (base && base.header === local.header) mergedHeader = remote.header;
  else if (preferLocal) mergedHeader = local.header;

  let mergedFooter = remote.footer;
  if (local.footer === remote.footer) mergedFooter = remote.footer;
  else if (base && base.footer === remote.footer) mergedFooter = local.footer;
  else if (base && base.footer === local.footer) mergedFooter = remote.footer;
  else if (preferLocal && local.footer) mergedFooter = local.footer;

  const byKey = list => new Map(list.map(item => [item.key, item.text]));
  const bm = base ? byKey(base.views) : new Map();
  const lm = byKey(local.views);
  const out = [];
  const seen = new Set();

  for (const r of remote.views) {
    seen.add(r.key);
    const lText = lm.get(r.key);
    const bText = bm.get(r.key);
    if (lText === undefined) {
      if (base && bText !== undefined && bText === r.text) continue;
      out.push(r.text);
      continue;
    }
    if (lText === r.text) { out.push(r.text); continue; }
    if (base && bText !== undefined && bText === r.text) { out.push(lText); continue; }
    if (base && bText !== undefined && bText === lText) { out.push(r.text); continue; }
    out.push(preferLocal ? lText : r.text);
  }
  for (const l of local.views) {
    if (seen.has(l.key)) continue;
    const bText = bm.get(l.key);
    if (base && bText !== undefined && bText === l.text) continue;
    seen.add(l.key);
    out.push(l.text);
  }

  const parts = [mergedHeader];
  if (out.length) parts.push(out.join("\n"));
  if (mergedFooter) parts.push(mergedFooter);
  return parts.join("\n").replace(/\n*$/, "\n");
}

function statMeta(fileObj) {
  const mtime = fileObj?.stat?.mtime;
  const size = fileObj?.stat?.size;
  if (Number.isFinite(mtime) && Number.isFinite(size)) return { localMtime: mtime, localSize: size };
  return {};
}

function formatForExtension(path) {
  const ext = extOf(path);
  if (ext === "canvas") return "canvas";
  if (TEXT_EXTS.has(ext)) return "text";
  if (BINARY_EXTS.has(ext)) return "binary";
  return null;
}

const reasons = {
  ACCESS_DENIED: "FlightClub не підтвердив доступ до цього файлу або папки Drive. Звірте доступ у вкладці Drive.",
  WRITE_DENIED: "Вашому акаунту FlightClub бракує права публікувати зміни до цього файлу Drive. Локальну версію збережено.",
  AUTH_REQUIRED: "Підтвердьте підключення акаунта FlightClub.",
  ROOT_BINDING_REQUIRED: "На сайті ще не вибрано папку FlightClub Vault.",
  ROOT_BINDING_CHANGED: "Папку Vault змінено. Спочатку оновіть копію з Drive.",
  INDEX_OR_ACCESS: "Drive повернув файли, але індекс або правила доступу приховали їх. Адміністратор має оновити індекс Drive.",
  REVISION_CONFLICT: "Файл у Drive змінився. Звірте версії перед публікацією.",
  FILE_ALREADY_EXISTS: "Файл з такою назвою вже існує у Google Drive.",
  ACCESS_CHANGED: "Права на файл змінилися під час синхронізації.",
  SYNC_CANCELLED: "Синхронізацію призупинено. Уже перевірені файли збережено.",
};

function syncError(code) {
  return Object.assign(new Error(reasons[code] ?? "Drive Vault тимчасово недоступний. Повторіть перевірку."), { code });
}

async function hashBytes(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function copyable(file) {
  return file && ID.test(file.id) && !file.blocked && !file.ignored && !file.pathAmbiguous &&
    !NO_FILE.has(file.kind) && validPath(file.path) && !EXCLUDED.test(file.path);
}

function driveSource(listing, localRoot) {
  const name = listing.tree?.root?.name;
  return {
    name: typeof name === "string" ? name.trim().slice(0, 120) : "",
    bindingRevision: listing.bindingRevision,
    localRoot,
  };
}

const LEGACY_UUID_PREFIX = /^\([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\) /i;
const LEGACY_EVENT_NAME = /^event - \d{4}-\d{2}-\d{2} - .* \([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\)$/i;

function isLegacyPlatformFilename(path) {
  const stem = String(path ?? "").split("/").at(-1).replace(/\.md$/i, "");
  return UUID.test(stem) || LEGACY_UUID_PREFIX.test(stem) || LEGACY_EVENT_NAME.test(stem);
}

function isUnmodifiedLegacyPlatformNote(localContent, serverNote, { parseYaml, kind, id }) {
  if (typeof localContent !== "string" || !serverNote) return false;
  if (!localContent.trim()) return true;
  try {
    const parsed = readPlatformNote(localContent, { parseYaml, kind, id });
    const norm = v => String(v ?? "").replace(/\r\n/g, "\n").trim();
    if (kind === "user" && !norm(parsed.description)) return true;
    if (parsed.format >= 2) {
      return norm(parsed.heading) === norm(serverNote.heading)
        && norm(parsed.propertyTitle) === norm(serverNote.propertyTitle)
        && norm(parsed.description) === norm(serverNote.description);
    }
    return norm(parsed.heading) === norm(serverNote.heading) && norm(parsed.description) === norm(serverNote.description);
  } catch {
    return false;
  }
}

function extractSectionTableRows(markdown, headingTitle) {
  if (typeof markdown !== "string") return [];
  const norm = markdown.replace(/\r\n?/g, "\n");
  const escaped = headingTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|\\n)##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|\\n<!--|$)`, "i");
  const match = re.exec(norm);
  if (!match) return [];
  const lines = match[1].split("\n").map(l => l.trim()).filter(l => l.startsWith("|") && l.endsWith("|"));
  if (lines.length <= 2) return [];
  return lines.slice(2);
}

function extractYamlScalar(markdown, key) {
  if (typeof markdown !== "string") return null;
  const fm = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  if (!fm) return null;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`^\\s*["']?${escaped}["']?\\s*:\\s*(.*)$`, "m").exec(fm[1]);
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
}

const TRACKED_PLATFORM_PROPERTIES = {
  item: [
    ["item-name", "Назва"], ["item-status", "Статус"], ["item-holder", "Утримувач"],
    ["item-location", "Місце зберігання"], ["item-hub", "Осередок"], ["item-condition", "Стан"],
    ["item-category-name", "Категорія"], ["item-hidden", "Приховано"],
  ],
  event: [
    ["event-name", "Назва"], ["status-event", "Статус події"], ["event-start", "Початок"],
    ["event-end", "Завершення"], ["event-location", "Місце"], ["к-ть реєстрацій", "Реєстрації"],
  ],
  user: [["user-name", "Ім’я"], ["user-roles", "Ролі"], ["user-hub", "Осередок"]],
};

function splitUnescapedPipes(text) {
  const cells = [];
  let current = "";
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "|" && (i === 0 || text[i - 1] !== "\\")) {
      cells.push(current);
      current = "";
    } else {
      current += text[i];
    }
  }
  cells.push(current);
  return cells;
}

function updateTableCells(row) {
  return splitUnescapedPipes(row.slice(1, -1)).map(value => value.trim()
    .replace(/\\\|/g, "|")
    .replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\[\[([^\]]+)\]\]/g, "$1"));
}

function updatePropertyText(value) {
  if (Array.isArray(value)) return value.map(updatePropertyText).filter(Boolean).join(", ");
  if (value == null || typeof value === "object") return "";
  if (typeof value === "boolean") return value ? "Так" : "Ні";
  const states = { available: "Вільно", issued: "На руках", loaned: "На руках", repair: "У ремонті", lost: "Втрачено" };
  return (Object.hasOwn(states, value) ? states[value] : String(value)).slice(0, 160);
}

function summarizePlatformNoteUpdate(oldText, newText, kind = "item", parseYaml) {
  if (typeof oldText !== "string" || typeof newText !== "string" || oldText === newText) return null;
  const properties = markdown => {
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
    if (!frontmatter || typeof parseYaml !== "function") return null;
    try { return parseYaml(frontmatter[1]); } catch { return null; }
  };
  const previous = properties(oldText), next = properties(newText);
  const changes = [];
  for (const [key, label] of TRACKED_PLATFORM_PROPERTIES[kind] || []) {
    const before = updatePropertyText(previous ? previous[key] : extractYamlScalar(oldText, key));
    const after = updatePropertyText(next ? next[key] : extractYamlScalar(newText, key));
    if (before !== after) changes.push({ label, before, after });
  }

  const addedRows = heading => {
    const known = new Set(extractSectionTableRows(oldText, heading));
    return extractSectionTableRows(newText, heading).filter(row => !known.has(row));
  };
  const history = addedRows(kind === "event" ? "Історія змін" : "Історія");
  const reports = addedRows("Звіти");
  for (const row of history.slice(0, 6)) {
    const [date, action, detail, itemAction] = updateTableCells(row);
    const after = kind === "item" ? itemAction : [action, detail].filter(Boolean).join(" · ");
    if (after) changes.push({ label: date ? `Журнал · ${date}` : "Журнал", after });
  }
  for (const row of reports.slice(0, 4)) {
    const [date, , status] = updateTableCells(row);
    changes.push({ label: date ? `Звіт · ${date}` : "Звіт", after: status || "Додано до нотатки" });
  }

  const count = Math.max(1, history.length + reports.length || changes.length);
  const summary = changes.length
    ? changes.slice(0, 2).map(change => `${change.label}: ${change.after || "прибрано"}`).join(" · ")
    : "Оновлено на сайті";
  return { count, summary, kind, changes: changes.slice(0, 10) };
}

function platformNotePath(path,kind) {
  const parent = kind === "item" ? ["FlightClub Platform/Майно/","FlightClub Platform/Приховані/Майно/"]
    : [kind === "user" ? "FlightClub Platform/Люди/" : "FlightClub Platform/Події/"];
  return validPath(path) && parent.some(prefix=>path.startsWith(prefix) && !path.slice(prefix.length).includes("/") && /\.md$/i.test(path));
}

function platformBinding(path, frontmatter, baseline) {
  if (!validPath(path) || !/\.md$/i.test(path)) return null;
  const kinds = ["item", "event", "user"];
  const storedKind = baseline?.kind === "platform" && kinds.includes(baseline.entity) ? baseline.entity : null;
  const kind = kinds.find(value => platformNotePath(path, value)) ?? storedKind;
  if (!kind) return null;
  if (storedKind && storedKind !== kind) return { kind, id: null };
  const stored = storedKind && UUID.test(baseline.fileId) ? baseline.fileId : null;
  const stem = path.split("/").at(-1).slice(0,-3);
  const legacy = [stem, /^\(([^)]+)\) /.exec(stem)?.[1], / \(([^)]+)\)$/.exec(stem)?.[1]].find(value => UUID.test(value));
  if (frontmatter?.["fc-schema"] === 2) {
    const id = frontmatter["fc-id"];
    if (frontmatter["fc-kind"] !== kind || !UUID.test(id) || [stored,legacy].some(value => value && value !== id)) return {kind,id:null};
    return {kind,id};
  }
  const rawLink = kind === "item" ? frontmatter?.["item-link"] : kind === "event" ? frontmatter?.["event-link"] : frontmatter?.["user-link"];
  const linkMatch = typeof rawLink === "string"
    ? (kind === "item" ? /[?&]item=([0-9a-f-]{36})\b/i.exec(rawLink)
      : kind === "event" ? /[?&]e=([0-9a-f-]{36})\b/i.exec(rawLink)
      : /\/u\/([0-9a-f-]{36})\b/i.exec(rawLink))
    : null;
  const linkId = linkMatch?.[1] && UUID.test(linkMatch[1]) ? linkMatch[1] : null;
  if (linkId) {
    if ([stored, legacy].some(value => value && value !== linkId)) return { kind, id: null };
    return { kind, id: linkId };
  }
  return {kind,id:stored || legacy || null};
}

function createDriveClient({ app, requestUrl, origin, TFile, TFolder, getIdentity, remember, parseYaml, summarizeTextUpdate, getLocalRoot = () => "" }) {
  const vault = app.vault;
  const baseTextCache = new Map();
  const cacheBaseText = (fileId, path, text) => {
    if (!fileId || extOf(path) !== "base" || typeof text !== "string" || text.length > 262_144) return;
    baseTextCache.delete(fileId);
    baseTextCache.set(fileId, text);
    if (baseTextCache.size > 32) {
      const oldest = baseTextCache.keys().next().value;
      if (oldest) baseTextCache.delete(oldest);
    }
  };
  const summarizeUpdate = (beforeBytes, afterBytes, path, kind) => {
    if (!summarizeTextUpdate || !/\.(?:md|markdown|txt)$/i.test(path) || !isTextKind(kind || "markdown")) return undefined;
    if ((beforeBytes && beforeBytes.byteLength > 512_000) || afterBytes.byteLength > 512_000) return undefined;
    try {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      return summarizeTextUpdate(beforeBytes ? decoder.decode(beforeBytes) : "", decoder.decode(afterBytes));
    } catch {
      /* The file was saved; preview generation is optional. */
      return undefined;
    }
  };
  const sameIdentity = identity => {
    const current = getIdentity();
    if (!current || current.token !== identity.token || current.userId !== identity.userId) throw syncError("AUTH_REQUIRED");
  };
  async function call(identity, params, data, channel = "drive-device-v1", extraHeaders = {}) {
    sameIdentity(identity);
    const search = new URLSearchParams({ obsidian: channel, ...params });
    const response = await requestUrl({
      url: origin + "/m/obsidian-sync?" + search, method: data ? "POST" : "GET", throw: false,
      headers: { Authorization: "Bearer " + identity.token, ...(data ? { "Content-Type": "application/json" } : {}), ...extraHeaders },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    sameIdentity(identity);
    let payload;
    try { payload = response.json; } catch { throw syncError("SYNC_UNAVAILABLE"); }
    if (response.status !== 200 || payload?.ok !== true) throw syncError(payload?.code || payload?.error?.code);
    return payload;
  }

  async function manifest(identity) {
    const initial = await call(identity, {});
    if (!Array.isArray(initial.tree?.items) || !ID.test(initial.rootId) || !initial.bindingRevision) throw syncError("SYNC_UNAVAILABLE");
    if (!initial.tree.items.length && initial.tree.policyExcluded > 0) throw syncError("INDEX_OR_ACCESS");
    if (initial.tree.complete) return { ...initial, files: initial.tree.items };
    const files = [], seenIds = new Set(), folders = [initial.rootId], visited = new Set();
    let partial = false;
    for (const item of initial.tree.items) {
      if (files.length >= ROOT_LIMIT) { partial = true; break; }
      if (item?.id && !seenIds.has(item.id)) {
        seenIds.add(item.id);
        files.push(item);
        if (item.kind === "folder" && ID.test(item.id)) folders.push(item.id);
      }
    }
    for (let index = 0; index < folders.length && files.length < ROOT_LIMIT; index++) {
      const folder = folders[index];
      if (visited.has(folder)) continue;
      visited.add(folder);
      const page = await call(identity, { folder, revision: initial.bindingRevision });
      if (page.rootId !== initial.rootId || !Array.isArray(page.tree?.items)) throw syncError("ROOT_BINDING_CHANGED");
      partial ||= !page.tree.complete;
      for (const item of page.tree.items) {
        if (files.length >= ROOT_LIMIT) { partial = true; break; }
        if (item?.id && !seenIds.has(item.id)) {
          seenIds.add(item.id);
          files.push(item);
          if (item.kind === "folder" && ID.test(item.id)) folders.push(item.id);
        }
      }
    }
    return { ...initial, files, partial: partial || files.length >= ROOT_LIMIT };
  }

  function importPrefix(loaded, remoteFiles, localPaths) {
    const preferred = getLocalRoot();
    if (preferred) {
      if (!validPath(preferred) || RESERVED_LOCAL_ROOT.test(preferred)) throw syncError("REVISION_CONFLICT");
      return preferred;
    }
    const choices = [""];
    for (const entry of loaded) {
      if (choices.length > 64) break;
      if (entry instanceof TFolder && validPath(entry.path) && !RESERVED_LOCAL_ROOT.test(entry.path)) {
        choices.push(entry.path);
      }
    }
    let best = "", bestScore = 0;
    for (const prefix of choices) {
      const start = prefix ? prefix + "/" : "";
      const score = remoteFiles.reduce((count, file) => count + Number(localPaths.has(start + file.path)), 0);
      if (score > bestScore || (score === bestScore && prefix.length < best.length)) {
        best = prefix;
        bestScore = score;
      }
    }
    return best;
  }

  async function preview() {
    const identity = getIdentity();
    if (!identity) throw syncError("AUTH_REQUIRED");
    const listing = await manifest(identity);
    const files = listing.files.filter(copyable);
    const loaded = vault.getAllLoadedFiles();
    const localPaths = new Set(loaded.filter(file => file instanceof TFile && !RESERVED_LOCAL_ROOT.test(file.path)).map(file => file.path));
    const prefix = importPrefix(loaded, files, localPaths);
    const start = prefix ? prefix + "/" : "";
    const matches = files.filter(file => localPaths.has(start + file.path)).length;
    return { available: files.length, matches, partial: Boolean(listing.partial), canEdit: listing.canEdit === true,
      source: driveSource(listing, prefix) };
  }

  async function previewDesync({ lookup = () => undefined, entries = [], includePeople = false, pages = [], links = [], importPages = true } = {}) {
    const identity = getIdentity();
    if (!identity) throw syncError("AUTH_REQUIRED");
    const listing = await manifest(identity);
    const remoteFiles = listing.files.filter(copyable);
    const loaded = vault.getAllLoadedFiles();
    const tfiles = loaded.filter(file => file instanceof TFile);
    const localPaths = new Set(tfiles.filter(file => !RESERVED_LOCAL_ROOT.test(file.path)).map(file => file.path));
    const prefix = importPrefix(loaded, remoteFiles, localPaths);
    const start = prefix ? prefix + "/" : "";

    const trackedDriveById = new Map();
    for (const [path, row] of entries) {
      if (path.startsWith(start) && row?.userId === identity.userId && row.kind !== "platform" &&
          row.bindingRevision === listing.bindingRevision && localPaths.has(path)) {
        trackedDriveById.set(row.fileId, { path, row });
      }
    }

    let matches = 0, driveMissing = 0, driveOutdated = 0, driveRenamed = 0, driveUntracked = 0, localStructureMoves = 0;
    const seenDrive = new Set();
    for (const file of remoteFiles) {
      if (seenDrive.has(file.id)) continue;
      seenDrive.add(file.id);
      const tracked = trackedDriveById.get(file.id);
      const directPath = start + file.path;
      const localPath = tracked?.path ?? (localPaths.has(directPath) ? directPath : null);
      if (!localPath) {
        driveMissing++;
        continue;
      }
      matches++;
      const known = tracked?.row ?? lookup(localPath);
      if (!known || known.userId !== identity.userId) driveUntracked++;
      else if (known.bindingRevision !== listing.bindingRevision || (file.revision?.version && known.version !== file.revision.version)) driveOutdated++;
      else if (known.sourcePath && known.sourcePath !== file.path) driveRenamed++;
      else if (localPath !== directPath) localStructureMoves++;
    }

    let platformLegacyNames = 0, platformLegacySchema = 0, platformUnboundOrOld = 0, platformOutdatedFiles = 0, platformMissing = 0, platformLocalTotal = 0;
    const localPlatformKeys = new Set();
    for (const file of tfiles) {
      const kind = ["item", "event", "user"].find(value => platformNotePath(file.path, value));
      if (!kind) continue;
      platformLocalTotal++;
      const fm = app.metadataCache?.getFileCache?.(file)?.frontmatter;
      const baseline = lookup(file.path);
      const binding = platformBinding(file.path, fm, baseline);
      if (binding?.id) localPlatformKeys.add(binding.kind + ":" + binding.id.toLowerCase());
      const legacyName = isLegacyPlatformFilename(file.path);
      if (legacyName) platformLegacyNames++;
      let legacySchema = false, unboundOrOld = false;
      if (kind !== "user") {
        const hasModernV3 = Boolean(binding?.id && Array.isArray(fm?.tags) && fm.tags.includes(kind) && fm?.["fc-schema"] !== 2);
        legacySchema = fm?.["fc-schema"] === 2 || !hasModernV3;
        unboundOrOld = !baseline || baseline.kind !== "platform" || baseline.userId !== identity.userId || (baseline.format ?? 1) < 2;
      } else {
        const hasModernV3User = Boolean(binding?.id && Array.isArray(fm?.tags) && (fm.tags.includes("person") || fm.tags.includes("user")) && fm?.["fc-schema"] !== 2);
        legacySchema = !hasModernV3User;
        unboundOrOld = !baseline || baseline.kind !== "platform" || baseline.userId !== identity.userId || (baseline.format ?? 1) < 3;
      }
      if (legacySchema) platformLegacySchema++;
      if (unboundOrOld) platformUnboundOrOld++;
      if (legacyName || legacySchema || unboundOrOld) platformOutdatedFiles++;
    }

    const legacyPlatformFolder = loaded.some(entry => entry instanceof TFolder && (
      entry.path === "FlightClub/Майно" || entry.path === "FlightClub/Події" || entry.path === "FlightClub/Люди"
    ));

    if (listing.canEdit === true) {
      try {
        for (const kind of includePeople ? ["item", "event", "user"] : ["item", "event"]) {
          let after;
          do {
            const page = await platformRequest(identity, { kind, ...(after ? { after } : {}) });
            if (!Array.isArray(page?.ids)) break;
            for (const id of page.ids) {
              if (!UUID.test(id)) continue;
              if (!localPlatformKeys.has(kind + ":" + id.toLowerCase())) platformMissing++;
            }
            after = page.next;
          } while (after && platformMissing < ROOT_LIMIT);
        }
      } catch { /* Platform listing may be mocked out or temporarily unreachable during preview. */ }
    }

    let pagesOutdated = 0, pagesMissing = 0;
    const linkList = Array.isArray(links) ? links : [...links];
    const linkedBySlug = new Map();
    for (const [, link] of linkList) {
      if (link?.slug) linkedBySlug.set(link.slug, link);
    }
    for (const p of Array.isArray(pages) ? pages : []) {
      if (!p?.slug) continue;
      const existing = linkedBySlug.get(p.slug);
      if (!existing) {
        if (importPages) pagesMissing++;
      } else if (p.updated_at && (!existing.version || p.updated_at > existing.version)) {
        pagesOutdated++;
      }
    }

    const totalIssues = driveMissing + driveOutdated + driveRenamed + driveUntracked
      + platformOutdatedFiles + platformMissing
      + pagesOutdated + pagesMissing;
    return {
      available: remoteFiles.length,
      matches,
      partial: Boolean(listing.partial),
      canEdit: listing.canEdit === true,
      rootId: typeof listing.rootId === "string" && ID.test(listing.rootId) ? listing.rootId : null,
      source: driveSource(listing, prefix),
      desync: {
        hasDesync: totalIssues > 0,
        totalIssues,
        driveMissing,
        driveOutdated,
        driveRenamed,
        driveUntracked,
        localStructureMoves,
        platformLocalTotal,
        platformOutdatedFiles,
        platformLegacyNames,
        platformLegacySchema,
        platformUnboundOrOld,
        platformMissing,
        pagesOutdated,
        pagesMissing,
        legacyPlatformFolder,
      },
    };
  }

  async function pull({ lookup, entries = [], forget = () => {}, report, onEntry = () => {}, shouldContinue = () => true }) {
    const identity = getIdentity();
    if (!identity) throw syncError("AUTH_REQUIRED");
    const listing = await manifest(identity);
    const loaded = vault.getAllLoadedFiles();
    const distinct = new Map();
    for (const file of listing.files.filter(copyable)) {
      const key = JSON.stringify([file.id,file.path]);
      if (!distinct.has(key)) distinct.set(key,file);
    }
    const remoteFiles = [...distinct.values()];
    const existingPaths = new Set(loaded.filter(file => file instanceof TFile && !RESERVED_LOCAL_ROOT.test(file.path)).map(file => file.path));
    const prefix = importPrefix(loaded, remoteFiles, existingPaths);
    const start = prefix ? prefix + "/" : "";
    const counts = { saved: 0, unchanged: 0, dirty: 0, conflicts: 0, skipped: 0, available: remoteFiles.length,
      partial: Boolean(listing.partial), canEdit: Boolean(listing.canEdit),
      rootId: typeof listing.rootId === "string" && ID.test(listing.rootId) ? listing.rootId : null,
      source: driveSource(listing, prefix) };
    const record = (status, file, path, reason) => {
      const counter = { saved: "saved", unchanged: "unchanged", dirty: "dirty", conflict: "conflicts", skipped: "skipped" }[status];
      counts[counter]++;
      onEntry({ channel: "drive", status, fileId: file.id, path, sourcePath: file.path,
        kind: file.kind, bindingRevision: listing.bindingRevision, reason });
    };
    const paths = new Map();
    const sourcePaths = new Map();
    for (const file of remoteFiles) {
      sourcePaths.set(file.id,(sourcePaths.get(file.id) || 0)+1);
      const key = file.path.normalize("NFC").toLowerCase();
      if (!paths.has(key)) paths.set(key, []);
      paths.get(key).push(file);
    }
    const files = [...paths.values()].flatMap(entries => {
      if (entries.length === 1 && sourcePaths.get(entries[0].id) === 1) return entries;
      for (const file of entries) record("conflict",file,(prefix ? prefix + "/" : "")+file.path,"ambiguous_path");
      return [];
    });
    const disk = new Map(loaded.map(file => [file.path.normalize("NFC").toLowerCase(), file.path]));
    const trackedPaths = new Map();
    for (const [path,row] of entries) {
      if (!path.startsWith(start) || row?.userId !== identity.userId || row.kind === "platform" || !existingPaths.has(path)) continue;
      const tracked = trackedPaths.get(row.fileId) || [];
      tracked.push(path);
      trackedPaths.set(row.fileId,tracked);
    }
    const dirs = new Map();
    function ensureFolder(path) {
      if (!path) return Promise.resolve();
      if (!dirs.has(path)) dirs.set(path, (async () => {
        await ensureFolder(path.split("/").slice(0, -1).join("/"));
        const existing = vault.getAbstractFileByPath(path);
        if (existing instanceof TFolder) return;
        if (existing || (disk.has(path.normalize("NFC").toLowerCase()) && disk.get(path.normalize("NFC").toLowerCase()) !== path)) {
          throw syncError("REVISION_CONFLICT");
        }
        sameIdentity(identity);
        await vault.createFolder(path);
        disk.set(path.normalize("NFC").toLowerCase(), path);
      })());
      return dirs.get(path);
    }

    let next = 0, finished = 0, fatal;
    report(0, files.length);
    await Promise.all(Array.from({ length: Math.min(3, files.length) }, async () => {
      while (!fatal && next < files.length && shouldContinue()) {
        const file = files[next++];
        const desiredPath = (prefix ? prefix + "/" : "") + file.path;
        const tracked = trackedPaths.get(file.id) || [];
        let path = desiredPath, moved = false;
        try {
          sameIdentity(identity);
          if (tracked.length > 1) { record("conflict",file,desiredPath,"duplicate_binding"); continue; }
          const previousPath = tracked[0];
          const previous = previousPath && lookup(previousPath);
          const existingTracked = previousPath && vault.getAbstractFileByPath(previousPath);
          const remoteMoved = existingTracked instanceof TFile && previous && previous.sourcePath !== file.path && previousPath !== desiredPath;
          if (!remoteMoved && existingTracked instanceof TFile) path = previousPath;
          if (!validPath(path)) { record("conflict",file,path,"path_collision"); continue; }
          const known = lookup(path);
          let existing = vault.getAbstractFileByPath(path);
          const localAlias = disk.get(path.normalize("NFC").toLowerCase());
          if ((localAlias && localAlias !== path && (!remoteMoved || localAlias !== previousPath)) || (existing && !(existing instanceof TFile))) { record("conflict",file,path,"path_collision"); continue; }
          if (remoteMoved && existing) { record("conflict",file,previousPath,"path_collision"); continue; }
          if (existing && known && (known.kind === "platform" || known.fileId !== file.id)) {
            record("conflict",file,path,"path_collision"); continue;
          }
          if (!remoteMoved && existing && known?.userId === identity.userId && known.fileId === file.id &&
            known.version === file.revision?.version) {
            const localHash = await hashBytes(await vault.readBinary(existing));
            sameIdentity(identity);
            remember(path, { ...known, bindingRevision: listing.bindingRevision, canEdit: Boolean(listing.canEdit) });
            if (localHash === known.sha256) record("unchanged",file,path);
            else record("dirty",file,path,"local_changes");
            continue;
          }
          const remote = await call(identity, { file: file.id, revision: listing.bindingRevision });
          if (fatal || !shouldContinue()) break;
          if (remote.file?.id !== file.id || remote.file?.path !== file.path || !VERSION.test(remote.revision?.version) ||
            !SHA.test(remote.sha256) || typeof remote.base64 !== "string" || remote.base64.length > 11_184_812) {
            record("skipped",file,path,"invalid_remote"); continue;
          }
          const data = Uint8Array.from(atob(remote.base64), char => char.charCodeAt(0)).buffer;
          if (await hashBytes(data) !== remote.sha256) { record("skipped",file,path,"integrity"); continue; }
          if (remoteMoved) {
            const localHash = await hashBytes(await vault.readBinary(existingTracked));
            if (localHash !== previous.sha256 || localHash !== remote.sha256 || ["markdown","canvas"].some(mode =>
              app.workspace.getLeavesOfType(mode).some(leaf => leaf.view?.file === existingTracked))) {
              record("conflict",file,previousPath,"remote_move"); continue;
            }
            await ensureFolder(path.split("/").slice(0,-1).join("/"));
            sameIdentity(identity);
            if (!shouldContinue()) break;
            if (previousPath.toLowerCase() === path.toLowerCase() ||
                vault.getAbstractFileByPath(previousPath) !== existingTracked || vault.getAbstractFileByPath(path) ||
                await hashBytes(await vault.readBinary(existingTracked)) !== previous.sha256) {
              record("conflict",file,previousPath,"remote_move"); continue;
            }
            sameIdentity(identity);
            if (!shouldContinue()) break;
            await vault.rename(existingTracked,path);
            disk.delete(previousPath.normalize("NFC").toLowerCase());
            disk.set(path.normalize("NFC").toLowerCase(),path);
            forget(previousPath);
            existing=existingTracked;
            moved=true;
          }
          if (existing) {
            const local = await vault.readBinary(existing);
            const localHash = await hashBytes(local);
            if (localHash !== remote.sha256) {
              const textFile = isTextKind(file.kind);
              const open = ["markdown", "canvas"].some(mode => app.workspace.getLeavesOfType(mode).some(leaf => leaf.view?.file === existing));
              if (!textFile || open || localHash !== known?.sha256 || known?.fileId !== file.id ||
                known?.userId !== identity.userId || typeof vault.process !== "function") {
                record("conflict",file,path,open ? "open_editor" : "local_changes"); continue;
              }
              const decode = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
              const original = decode.decode(local), incoming = decode.decode(data);
              sameIdentity(identity);
              await vault.process(existing, current => {
                sameIdentity(identity);
                if (!shouldContinue()) throw syncError("SYNC_CANCELLED");
                if (existing.path !== path || current !== original) throw syncError("REVISION_CONFLICT");
                return incoming;
              });
              record("saved",file,path);
            } else record(moved ? "saved" : "unchanged",file,path);
          } else {
            await ensureFolder(path.split("/").slice(0, -1).join("/"));
            sameIdentity(identity);
            if (!shouldContinue()) break;
            await vault.createBinary(path, data);
            disk.set(path.normalize("NFC").toLowerCase(), path);
            record("saved",file,path);
          }
          sameIdentity(identity);
          remember(path, {
            userId: identity.userId, fileId: file.id, bindingRevision: listing.bindingRevision, version: remote.revision.version,
            sha256: remote.sha256, kind: file.kind, canEdit: Boolean(listing.canEdit), sourcePath: file.path,
          });
        } catch (error) {
          if (error?.code === "AUTH_REQUIRED" || error?.code === "ROOT_BINDING_CHANGED") fatal = error;
          else if (error?.code === "REVISION_CONFLICT") record("conflict",file,path,"revision");
          else if (error?.code === "SYNC_CANCELLED") break;
          else record("skipped",file,path,error?.code || "unavailable");
        } finally { report(++finished, files.length); }
      }
    }));
    if (fatal) throw fatal;
    if (!shouldContinue()) throw syncError("SYNC_CANCELLED");
    for (const file of listing.files.filter(file => !copyable(file) && file?.kind !== "folder")) {
      record("skipped",file,(prefix ? prefix + "/" : "")+file.path,"unsupported");
    }
    return counts;
  }

  async function prepare(file, baseline, editorDraft) {
    if (!baseline?.canEdit || !["markdown", "canvas", "text", "binary", "platform"].includes(baseline.kind) || !(file instanceof TFile)) return null;
    const identity = getIdentity();
    if (!identity || identity.userId !== baseline.userId) return null;
    const bytes = baseline.kind === "platform" && typeof editorDraft === "string"
      ? new TextEncoder().encode(editorDraft) : await vault.readBinary(file);
    const sha256 = await hashBytes(bytes);
    sameIdentity(identity);
    if (sha256 === baseline.sha256) return null;
    if (baseline.kind === "binary") {
      if (bytes.byteLength > 8_388_608) throw syncError("CONTENT_LIMIT");
      return { sha256, base64: toBase64(bytes), format: "binary" };
    }
    const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    return { sha256, content, format: baseline.kind === "canvas" ? "canvas" : "text" };
  }

  async function publish(change, baseline, requestId, bindingRevision) {
    const identity = getIdentity();
    if (!identity || identity.userId !== baseline.userId || !baseline.canEdit) throw syncError("ACCESS_DENIED");
    const rev = bindingRevision || baseline.bindingRevision;
    if (change.format === "binary") {
      return call(identity, {}, {
        action: "update", fileId: baseline.fileId, bindingRevision: rev,
        expectedVersion: baseline.version, expectedSha256: baseline.sha256, requestId,
        base64: change.base64, format: "binary",
      }, "drive-device-v1", { "x-fc-binary": "1" });
    }
    return call(identity, {}, {
      fileId: baseline.fileId, bindingRevision: rev,
      expectedVersion: baseline.version, expectedSha256: baseline.sha256, requestId,
      content: change.content, format: change.format,
    });
  }

  async function platformRequest(identity, params, data) {
    return call(identity, params, data, "platform-device-v1");
  }

  async function pullPlatform({ lookup, entries, forget, report, onEntry = () => {}, includePeople = false, includePhotos = true, shouldContinue = () => true }) {
    const identity = getIdentity();
    if (!identity) throw syncError("AUTH_REQUIRED");
    const counts = { saved: 0, conflicts: 0, skipped: 0 };
    const oldPaths = new Map(), repeated = new Set();
    for (const [path,row] of entries) {
      if (row.userId !== identity.userId || row.kind !== "platform" || !vault.getAbstractFileByPath(path)) continue;
      const key=row.entity+":"+row.fileId;
      if(oldPaths.has(key))repeated.add(key);
      oldPaths.set(key,path);
    }
    const unboundPaths = new Set();
    for (const file of vault.getAllLoadedFiles()) {
      if (!(file instanceof TFile)) continue;
      const kind = ["item","event","user"].find(value => platformNotePath(file.path,value));
      if (!kind) continue;
      const frontmatter = app.metadataCache?.getFileCache(file)?.frontmatter;
      const binding = platformBinding(file.path,frontmatter,lookup(file.path));
      if (!binding?.id) continue;
      const key = binding.kind + ":" + binding.id;
      const previous = oldPaths.get(key);
      if (previous === file.path) continue;
      if (previous) repeated.add(key);
      else {
        oldPaths.set(key,file.path);
        unboundPaths.add(file.path);
      }
    }
    const encoder = new TextEncoder(), dirs = new Map();
    function folder(path) {
      if (!path) return Promise.resolve();
      if (!dirs.has(path)) dirs.set(path, (async () => {
        await folder(path.split("/").slice(0, -1).join("/"));
        const existing = vault.getAbstractFileByPath(path);
        if (existing instanceof TFolder) return;
        if (existing) throw syncError("REVISION_CONFLICT");
        sameIdentity(identity);
        await vault.createFolder(path);
      })());
      return dirs.get(path);
    }
    const ids = [];
    const seenIds = new Set(), photoDownloads = new Set(), remoteRevisions = new Map(), remoteItemStatuses = new Map();
    for (const kind of includePeople ? ["item", "event", "user"] : ["item", "event"]) {
      let after;
      do {
        if (!shouldContinue()) throw syncError("SYNC_CANCELLED");
        const page = await platformRequest(identity, { kind, ...(after ? { after } : {}) });
        if (!Array.isArray(page.ids) || page.ids.some(id => !UUID.test(id)) || (page.next && (!UUID.test(page.next) || (after && page.next <= after)))) {
          throw syncError("SYNC_UNAVAILABLE");
        }
        const pageRevs = page.revisions && typeof page.revisions === "object" ? page.revisions : null;
        const pageStatuses = kind === "item" && page.itemStatuses && typeof page.itemStatuses === "object" ? page.itemStatuses : null;
        for (const id of page.ids) {
          const key = kind + ":" + id.toLowerCase();
          if (seenIds.has(key)) continue;
          seenIds.add(key);
          ids.push({ id, kind });
          if (pageRevs && typeof pageRevs[id] === "string" && SHA.test(pageRevs[id])) {
            remoteRevisions.set(kind + ":" + id, pageRevs[id]);
          }
          if (pageStatuses && typeof pageStatuses[id] === "string" && pageStatuses[id].trim()) {
            remoteItemStatuses.set(id, pageStatuses[id].trim().toLowerCase());
          }
        }
        after = page.next;
      } while (after && ids.length < ROOT_LIMIT);
    }
    let next = 0, finished = 0, fatal;
    report(0, ids.length);
    await Promise.all(Array.from({ length: Math.min(6, Math.max(1, ids.length)) }, async () => {
      while (!fatal && next < ids.length && shouldContinue()) {
        const { kind, id } = ids[next++];
        let activityPath = oldPaths.get(kind + ":" + id) || id;
        const record = (status,reason,details) => {
          counts[status === "conflict" ? "conflicts" : status]++;
          onEntry({channel:"platform",status,fileId:id,entity:kind,path:activityPath,reason,...details});
        };
        try {
          const expectedSyncState = remoteRevisions.get(kind + ":" + id);
          const cachedPath = oldPaths.get(kind + ":" + id);
          const cachedBase = cachedPath ? lookup(cachedPath) : null;
          if (
            expectedSyncState &&
            cachedPath &&
            !repeated.has(kind + ":" + id) &&
            !unboundPaths.has(cachedPath) &&
            cachedBase?.userId === identity.userId &&
            cachedBase?.kind === "platform" &&
            cachedBase?.entity === kind &&
            cachedBase?.fileId === id &&
            cachedBase?.format === 3 &&
            cachedBase?.syncState === expectedSyncState
          ) {
            const cachedFile = vault.getAbstractFileByPath(cachedPath);
            if (cachedFile instanceof TFile) {
              const cachedHash = await hashBytes(await vault.readBinary(cachedFile));
              if (cachedHash === cachedBase.sha256) {
                const liveItemStatus = kind === "item" ? remoteItemStatuses.get(id) : null;
                if (liveItemStatus && cachedBase.itemStatus !== liveItemStatus) {
                  remember(cachedPath, { ...cachedBase, itemStatus: liveItemStatus });
                }
                record("saved", "unchanged");
                continue;
              }
            }
          }
          const { page } = await platformRequest(identity, { kind, id });
          if (typeof page?.path === "string") activityPath = page.path;
          if (fatal || !shouldContinue()) break;
          if (repeated.has(kind+":"+id)) { record("conflict","duplicate_binding"); continue; }
          if (page?.id !== id || page.kind !== kind || !platformNotePath(page.path,kind) || !SHA.test(page.revision)) {
            record("skipped","invalid_remote"); continue;
          }
          const note = readPlatformNote(page.content, { parseYaml, kind, id });
          const previousPath = oldPaths.get(kind + ":" + id);
          const previousBaseline = previousPath ? lookup(previousPath) : null;
          const path = page.path, parent = path.split("/").slice(0, -1).join("/");
          let file = vault.getAbstractFileByPath(path);
          const old = previousPath && previousPath !== path && vault.getAbstractFileByPath(previousPath);
          let oldText = null, oldUnmodifiedLegacy = false;
          if (old && old instanceof TFile) {
            oldText = await vault.read(old);
            oldUnmodifiedLegacy = unboundPaths.has(previousPath)
              && isUnmodifiedLegacyPlatformNote(oldText, note, { parseYaml, kind, id });
          }
          if (old && unboundPaths.has(previousPath) && !oldUnmodifiedLegacy) { record("conflict","unbound_platform",{path:previousPath}); continue; }
          if (old && file) { record("conflict","path_collision"); continue; }
          await folder(parent);
          const isEditingPlatformLeaf = target => app.workspace.getLeavesOfType("markdown")
            .some(leaf => leaf.view?.file === target && (leaf.view?.dirty === true || leaf.view?.getMode?.() !== "preview"));
          if (old) {
            if (isEditingPlatformLeaf(old)) {
              record("conflict","open_editor",{path:previousPath}); continue;
            }
            if (!(old instanceof TFile) || (!oldUnmodifiedLegacy && await hashBytes(await vault.readBinary(old)) !== previousBaseline?.sha256)) {
              record("conflict","local_changes",{path:previousPath}); continue;
            }
            sameIdentity(identity);
            if (!shouldContinue()) break;
            const rename = app.fileManager?.renameFile?.bind(app.fileManager) ?? vault.rename.bind(vault);
            if (vault.getAbstractFileByPath(path)) { record("conflict","path_collision",{path:previousPath}); continue; }
            await rename(old, path);
            if (previousBaseline) remember(path, previousBaseline);
            forget(previousPath);
            file = old;
          }
          const sha256 = await hashBytes(encoder.encode(page.content));
          let platformUpdateInfo = null;
          if (file) {
            if (!(file instanceof TFile)) { record("conflict","path_collision"); continue; }
            const existing = await vault.read(file);
            const hash = await hashBytes(encoder.encode(existing));
            if (hash !== sha256) {
              if (isEditingPlatformLeaf(file)) {
                record("conflict","open_editor"); continue;
              }
              const baseline = lookup(path) ?? previousBaseline;
              const safeBoundMatch = baseline?.userId === identity.userId && baseline?.fileId === id && baseline?.sha256 === hash;
              const safeLegacyUpgrade = !safeBoundMatch && isUnmodifiedLegacyPlatformNote(existing, note, { parseYaml, kind, id });
              if ((!safeBoundMatch && !safeLegacyUpgrade) || typeof vault.process !== "function") {
                record("conflict",unboundPaths.has(path) ? "unbound_platform" : "local_changes"); continue;
              }
              if (safeBoundMatch) {
                platformUpdateInfo = summarizePlatformNoteUpdate(existing, page.content, kind, parseYaml);
              }
              sameIdentity(identity);
              await vault.process(file, current => {
                sameIdentity(identity);
                if (!shouldContinue()) throw syncError("SYNC_CANCELLED");
                if (file.path !== path || current !== existing) throw syncError("REVISION_CONFLICT");
                return page.content;
              });
            }
          } else {
            sameIdentity(identity);
            if (!shouldContinue()) break;
            await vault.create(path, page.content);
          }
          const itemStatusMeta = kind === "item" ? {
            itemStatus: (extractYamlScalar(page.content, "item-status") || remoteItemStatuses.get(id) || "available").toLowerCase(),
            itemHolder: extractYamlScalar(page.content, "item-holder") || null,
            itemHub: extractYamlScalar(page.content, "item-hub") || null,
            itemCondition: extractYamlScalar(page.content, "item-condition") || null,
          } : {};
          remember(path, { userId: identity.userId, kind: "platform", entity: kind, fileId: id, version: page.revision, canEdit: kind !== "user",
            sha256, detailsSha: await hashBytes(encoder.encode(note.details)),
            ...itemStatusMeta,
            ...(typeof page.syncState === "string" && SHA.test(page.syncState) ? { syncState: page.syncState } : {}),
            ...(note.format >= 2 ? {
              format: note.format, title: note.heading, heading: note.heading, propertyTitle: note.propertyTitle,
              propertiesSha: await hashBytes(encoder.encode(note.protectedProperties)),
            } : {}) });
          const photoJobs = (includePhotos ? page.photos || [] : []).filter(photo => {
            if (!UUID.test(photo.id) || !new RegExp("^" + photo.id + "\\.(?:png|jpe?g|webp|gif|avif)$", "i").test(photo.filename)) return false;
            const target = parent + "/assets/" + photo.filename;
            if (vault.getAbstractFileByPath(target) || photoDownloads.has(target)) return false;
            photoDownloads.add(target);
            return true;
          });
          if (photoJobs.length) {
            let pNext = 0;
            await Promise.all(Array.from({ length: Math.min(4, photoJobs.length) }, async () => {
              while (pNext < photoJobs.length && shouldContinue()) {
                const photo = photoJobs[pNext++];
                const target = parent + "/assets/" + photo.filename;
                const photoEntry = { photoId: photo.id, path: target };
                try {
                  const payload = await platformRequest(identity, { kind, id, photo: photo.id });
                  if (typeof payload.base64 !== "string" || payload.base64.length > 11_184_812) { record("skipped", "photo_limit", photoEntry); continue; }
                  await folder(parent + "/assets");
                  sameIdentity(identity);
                  if (!shouldContinue()) break;
                  if (!vault.getAbstractFileByPath(target)) {
                    await vault.createBinary(target, Uint8Array.from(atob(payload.base64), char => char.charCodeAt(0)).buffer);
                  }
                } catch (error) {
                  if (error?.code === "AUTH_REQUIRED") throw error;
                  record("skipped", "photo_unavailable", photoEntry);
                }
              }
            }));
          }
          if (platformUpdateInfo) {
            record("saved", "platform_updated", {
              actionCount: platformUpdateInfo.count,
              actionSummary: platformUpdateInfo.summary,
              actionDetails: platformUpdateInfo.changes,
            });
          } else {
            record("saved");
          }
        } catch (error) {
          if (error?.code === "AUTH_REQUIRED") fatal = error;
          else if (error?.code === "REVISION_CONFLICT") record("conflict","revision");
          else if (error?.code === "SYNC_CANCELLED") break;
          else record("skipped",error?.code || "unavailable");
        } finally { report(++finished, ids.length); }
      }
    }));
    if (fatal) throw fatal;
    if (!shouldContinue()) throw syncError("SYNC_CANCELLED");
    sameIdentity(identity);
    return counts;
  }

  async function publishPlatform(change, baseline) {
    const identity = getIdentity();
    if (!identity || identity.userId !== baseline.userId) throw syncError("AUTH_REQUIRED");
    const note = readPlatformNote(change.content, { parseYaml, kind: baseline.entity, id: baseline.fileId });
    const encoder = new TextEncoder();
    if (note.format !== (baseline.format ?? 1) ||
      await hashBytes(encoder.encode(note.details)) !== baseline.detailsSha ||
      (note.format >= 2 && await hashBytes(encoder.encode(note.protectedProperties)) !== baseline.propertiesSha)) {
      throw new Error("На сайт можна відправити заголовок і опис. Відновіть згенерований блок із даними.");
    }
    const title = platformEditableTitle(note, baseline);
    const receipt = await platformRequest(identity, {}, {
      kind: baseline.entity, id: baseline.fileId, revision: baseline.version,
      title, description: note.description,
    });
    return { ...receipt, ...(note.format >= 2 ? { title, heading: note.heading, propertyTitle: note.propertyTitle } : {}) };
  }
  const reviews = new Map();
  const failedCreates = new Map();
  const failedUpdates = new Map();
  let resolving = false;

  async function reviewRemote(identity, entry) {
    if (entry.channel === "platform") {
      if (!["item", "event", "user"].includes(entry.entity) || !UUID.test(entry.fileId)) throw syncError("ACCESS_DENIED");
      const {page} = await platformRequest(identity, {kind:entry.entity,id:entry.fileId});
      if (page?.id !== entry.fileId || page.kind !== entry.entity || !SHA.test(page.revision) ||
        typeof page.content !== "string" || page.content.length > 500_000) throw syncError("SYNC_UNAVAILABLE");
      if (!platformNotePath(page.path,entry.entity)) throw syncError("SYNC_UNAVAILABLE");
      if (entry.photoId) {
        const photo = page.photos?.find(photo => photo.id === entry.photoId);
        if (!photo || !UUID.test(photo.id) || !new RegExp("^" + photo.id + "\\.(?:png|jpe?g|webp|gif|avif)$", "i").test(photo.filename) ||
          entry.path !== page.path.slice(0,page.path.lastIndexOf("/")) + "/assets/" + photo.filename) throw syncError("ACCESS_DENIED");
        const payload = await platformRequest(identity,{kind:entry.entity,id:entry.fileId,photo:photo.id});
        if (typeof payload.base64 !== "string" || payload.base64.length > 11_184_812) throw syncError("SYNC_UNAVAILABLE");
        const bytes = Uint8Array.from(atob(payload.base64),char=>char.charCodeAt(0));
        return {bytes,text:null,sha256:await hashBytes(bytes),version:page.revision,baseline:{kind:"attachment",canEdit:false}};
      }
      if (!platformNotePath(entry.path,entry.entity)) throw syncError("ACCESS_DENIED");
      const note = readPlatformNote(page.content,{parseYaml,kind:entry.entity,id:entry.fileId});
      const bytes = new TextEncoder().encode(page.content);
      return {
        bytes, text:page.content, sha256:await hashBytes(bytes), version:page.revision,
        baseline:{userId:identity.userId,kind:"platform",entity:entry.entity,fileId:entry.fileId,
          version:page.revision,canEdit:entry.entity !== "user",detailsSha:await hashBytes(new TextEncoder().encode(note.details)),
          ...(note.format >= 2 ? {format:note.format,title:note.heading,heading:note.heading,propertyTitle:note.propertyTitle,
            propertiesSha:await hashBytes(new TextEncoder().encode(note.protectedProperties))} : {})},
      };
    }
    if (entry.channel !== "drive" || !ID.test(entry.fileId) || !UUID.test(entry.bindingRevision) ||
      !validPath(entry.sourcePath)) throw syncError("ACCESS_DENIED");
    const remote = await call(identity,{file:entry.fileId,revision:entry.bindingRevision});
    if (remote.file?.id !== entry.fileId || remote.file?.path !== entry.sourcePath ||
      !VERSION.test(remote.revision?.version) || !SHA.test(remote.sha256) ||
      typeof remote.base64 !== "string" || remote.base64.length > 11_184_812) throw syncError("SYNC_UNAVAILABLE");
    const bytes = Uint8Array.from(atob(remote.base64),char=>char.charCodeAt(0));
    if (await hashBytes(bytes) !== remote.sha256) throw syncError("SYNC_UNAVAILABLE");
    const textFile = isTextKind(remote.file.kind);
    const text = textFile ? new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes) : null;
    return {
      bytes,text,sha256:remote.sha256,version:remote.revision.version,
      baseline:{userId:identity.userId,kind:remote.file.kind,fileId:entry.fileId,bindingRevision:entry.bindingRevision,
        sourcePath:entry.sourcePath,version:remote.revision.version,sha256:remote.sha256,canEdit:false},
    };
  }

  async function inspect(entry, lookup) {
    const identity = getIdentity();
    if (!identity || !validPath(entry.path) || ["ambiguous_path","path_collision","duplicate_binding"].includes(entry.reason)) {
      throw new Error("Шлях неоднозначний. Звірте розташування файлів перед синхронізацією.");
    }
    const access = await call(identity,{},undefined,"device-v1");
    sameIdentity(identity);
    if (access.viewer?.userId !== identity.userId) throw syncError("AUTH_REQUIRED");
    const remote = await reviewRemote(identity,entry);
    const file = vault.getAbstractFileByPath(entry.path);
    if (file && !(file instanceof TFile)) throw syncError("REVISION_CONFLICT");
    const localBytes = file ? new Uint8Array(await vault.readBinary(file)) : new Uint8Array();
    if (localBytes.byteLength > 8_388_608) throw new Error("Локальний файл завеликий для порівняння.");
    const localText = remote.text === null ? null : new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(localBytes);
    const baseline = lookup(entry.path);
    let uploadError = null, localDraft = null, checkedBaseline = baseline;
    if (entry.channel === "platform" && !entry.photoId) {
      try {
        if (entry.entity === "user") throw new Error("Профілі редагуються на сайті.");
        const note = readPlatformNote(localText,{parseYaml,kind:entry.entity,id:entry.fileId});
        const detailsSha = await hashBytes(new TextEncoder().encode(note.details));
        const propertiesSha = await hashBytes(new TextEncoder().encode(note.protectedProperties));
        const tracked = baseline?.userId === identity.userId && baseline.fileId === entry.fileId &&
          baseline.entity === entry.entity && baseline.canEdit;
        if (tracked) {
          if (note.format !== (baseline.format ?? 1) || detailsSha !== baseline.detailsSha ||
              (note.format >= 2 && propertiesSha !== baseline.propertiesSha)) {
            throw new Error("У локальній копії змінено дані, які оновлює сайт. Передати можна назву й опис.");
          }
        } else {
          if (entry.reason !== "unbound_platform" || note.format < 2) {
            throw new Error("Публікація потребує прив’язки цієї нотатки. Порівняйте її з версією сайту.");
          }
          checkedBaseline = {...remote.baseline,format:note.format,detailsSha,propertiesSha};
        }
        localDraft = {title:platformEditableTitle(note,checkedBaseline),description:note.description,
          ...(note.format >= 2 ? {heading:note.heading,propertyTitle:note.propertyTitle} : {})};
      } catch (error) { uploadError = error.message; }
    }
    sameIdentity(identity);
    remote.baseline.canEdit = access.viewer?.canEdit === true && (entry.channel !== "platform" || entry.entity !== "user");
    const id = crypto.randomUUID();
    const snapshot = {id,identity,entry:{...entry},file,localBytes,localText,localHash:await hashBytes(localBytes),
      remote,baseline:checkedBaseline,localDraft,requestId:crypto.randomUUID()};
    if (reviews.size >= 8) reviews.delete(reviews.keys().next().value);
    reviews.set(id,snapshot);
    return {id,path:entry.path,kind:remote.baseline.kind,hasLocal:Boolean(file),
      local:localText,remote:remote.text,localBytes:localBytes.byteLength,remoteBytes:remote.bytes.byteLength,
      canUpload:Boolean(file && remote.text !== null && remote.baseline.canEdit && (entry.channel !== "platform" || localDraft)),
      canDownload:remote.text !== null || !file,
      uploadError,remoteVersion:remote.version};
  }

  async function reviewFolder(identity,path) {
    if (!path) return;
    if (!validPath(path)) throw syncError("ACCESS_DENIED");
    const parts = path.split("/");
    for (let index=1;index<=parts.length;index++) {
      const parent=parts.slice(0,index).join("/");
      const existing=vault.getAbstractFileByPath(parent);
      if (existing instanceof TFolder) continue;
      if (existing) throw syncError("REVISION_CONFLICT");
      sameIdentity(identity);
      await vault.createFolder(parent);
    }
  }

  function reviewEditorUnchanged(snapshot) {
    if (!snapshot.file) return true;
    for (const kind of ["markdown","canvas"]) {
      for (const leaf of app.workspace.getLeavesOfType(kind)) {
        if (leaf.view?.file !== snapshot.file) continue;
        if (kind === "canvas") return false;
        if (leaf.view.editor?.getValue && leaf.view.editor.getValue() !== snapshot.localText) return false;
      }
    }
    return true;
  }

  async function resolveReview(id,direction) {
    if (resolving) throw new Error("Зачекайте завершення поточної синхронізації.");
    const snapshot=reviews.get(id);
    if (!snapshot || !["download","upload","copy"].includes(direction)) throw new Error("Порівняння застаріло. Відкрийте його знову.");
    const {identity,entry,remote,file}=snapshot;
    sameIdentity(identity);
    resolving=true;
    try {
      const latest=await reviewRemote(identity,entry);
      if (latest.version !== remote.version || latest.sha256 !== remote.sha256) throw syncError("REVISION_CONFLICT");
      const current=vault.getAbstractFileByPath(entry.path);
      if (current !== file || (file && await hashBytes(await vault.readBinary(file)) !== snapshot.localHash) ||
        vault.getAbstractFileByPath(entry.path) !== file || !reviewEditorUnchanged(snapshot)) {
        throw new Error("Локальна версія змінилася або має незбережені правки. Оновіть порівняння.");
      }
      sameIdentity(identity);
      if (direction === "copy") {
        const folder="FlightClub Sync Archive/"+crypto.randomUUID();
        await reviewFolder(identity,folder);
        sameIdentity(identity);
        const path=folder+"/"+entry.path.split("/").at(-1);
        await vault.createBinary(path,remote.bytes.buffer.slice(remote.bytes.byteOffset,remote.bytes.byteOffset+remote.bytes.byteLength));
        sameIdentity(identity);
        return {copied:true,path};
      }
      if (direction === "upload") {
        if (!file || remote.text === null || !remote.baseline.canEdit ||
          (entry.channel === "platform" && !snapshot.localDraft)) throw syncError("ACCESS_DENIED");
        const response=entry.channel === "platform"
          ? await platformRequest(identity,{},{
            kind:entry.entity,id:entry.fileId,revision:remote.version,
            title:snapshot.localDraft.title,description:snapshot.localDraft.description,
          })
          : await publish({content:snapshot.localText,sha256:snapshot.localHash,
            format:remote.baseline.kind === "canvas" ? "canvas" : "text"},remote.baseline,snapshot.requestId);
        if (entry.channel === "platform") {
          if (!SHA.test(response.revision)) throw syncError("SYNC_UNAVAILABLE");
          sameIdentity(identity);
          remember(entry.path,{...snapshot.baseline,...snapshot.localDraft,version:response.revision,sha256:snapshot.localHash});
        } else {
          if (!response.stillCurrent || response.contentSha256 !== snapshot.localHash || !VERSION.test(response.revision?.version)) throw syncError("REVISION_CONFLICT");
          sameIdentity(identity);
          remember(entry.path,{...remote.baseline,version:response.revision.version,sha256:snapshot.localHash});
        }
        reviews.delete(id);
        return {uploaded:true,path:entry.path};
      }
      if (file && (remote.text === null || typeof vault.process !== "function")) {
        throw new Error("Для цього формату збережіть окрему копію серверної версії.");
      }
      let backup=null;
      if (file) {
        const folder="FlightClub Sync Archive/"+crypto.randomUUID();
        await reviewFolder(identity,folder);
        sameIdentity(identity);
        backup=folder+"/"+entry.path.split("/").at(-1);
        await vault.createBinary(backup,snapshot.localBytes.buffer.slice(snapshot.localBytes.byteOffset,snapshot.localBytes.byteOffset+snapshot.localBytes.byteLength));
        sameIdentity(identity);
        await vault.process(file,current=>{
          sameIdentity(identity);
          if (current !== snapshot.localText || !reviewEditorUnchanged(snapshot)) throw syncError("REVISION_CONFLICT");
          return remote.text;
        });
      } else {
        await reviewFolder(identity,entry.path.split("/").slice(0,-1).join("/"));
        sameIdentity(identity);
        if (vault.getAbstractFileByPath(entry.path)) throw syncError("REVISION_CONFLICT");
        if (remote.text === null) {
          await vault.createBinary(entry.path,remote.bytes.buffer.slice(remote.bytes.byteOffset,remote.bytes.byteOffset+remote.bytes.byteLength));
        } else await vault.create(entry.path,remote.text);
      }
      sameIdentity(identity);
      if (!entry.photoId) remember(entry.path,{...remote.baseline,sha256:remote.sha256});
      reviews.delete(id);
      return {downloaded:true,path:entry.path,backup};
    } finally {resolving=false;}
  }

  const platformHistory = baseline => {
    const identity = getIdentity();
    if (!identity || identity.userId !== baseline.userId || !baseline.canEdit) throw syncError("ACCESS_DENIED");
    return platformRequest(identity, {kind:baseline.entity,id:baseline.fileId,history:"1"});
  };
  async function computeManifestSignature(listing) {
    if (!listing?.bindingRevision || !Array.isArray(listing.files)) return null;
    const rows = listing.files
      .filter(copyable)
      .map(f => `${f.id}:${f.revision?.version || ""}:${f.path}`)
      .sort();
    const raw = new TextEncoder().encode(
      `${listing.bindingRevision}|${listing.partial ? "p" : "c"}|${listing.canEdit ? "w" : "r"}|${rows.length}|${rows.join("\n")}`
    );
    return hashBytes(raw);
  }

  async function peekManifest() {
    const identity = getIdentity();
    if (!identity) throw syncError("AUTH_REQUIRED");
    const listing = await manifest(identity);
    return {
      bindingRevision: listing.bindingRevision,
      partial: Boolean(listing.partial),
      canEdit: Boolean(listing.canEdit),
      fileCount: listing.files.filter(copyable).length,
      signature: await computeManifestSignature(listing),
    };
  }

  async function sync({
    lookup, entries = [], forget = () => {}, report = () => {}, onEntry = () => {},
    shouldContinue = () => true, pendingDeletes = [], consumeDelete = () => {},
    pendingMoves = [], consumeMove = () => {}, isEditorDirty = () => false,
    isActiveLiveFile = () => false,
    allowBulkTrash = false, pushLocal = true, getShareMeta = null,
    driveFolders = null, rememberFolder = () => {}, forgetFolder = () => {},
    pendingFolderOps = [], consumeFolderOp = () => {}, structureMode = "push",
    markInternalPath = () => {}, lastBindingRevision = null,
  } = {}) {
    const encoder = new TextEncoder();
    const isMdPath = p => /\.(?:md|markdown)$/i.test(String(p || ""));
    function buildMdPatch(localPath, fileId) {
      const share = typeof getShareMeta === "function" ? getShareMeta(localPath, fileId) : null;
      const siteUrl = siteVaultEditUrl(origin, fileId);
      const driveUrl = driveViewUrl(fileId);
      return {
        ...(siteUrl ? { site_url: siteUrl } : {}),
        ...(driveUrl ? { drive_url: driveUrl } : {}),
        ...(share?.shareUrl ? { share_url: share.shareUrl } : {}),
        ...(Array.isArray(share?.roles) ? { roles: share.roles } : {}),
        ...(typeof share?.isPublic === "boolean" ? { public: share.isPublic } : {}),
      };
    }
    function applyMdProps(localPath, text, fileId, { fallbackText = null } = {}) {
      if (!isMdPath(localPath) || !ID.test(String(fileId || ""))) {
        return { text, changed: false, healedFromGoogleDocs: false };
      }
      const unescapeBodyCallouts = shouldUnescapeCalloutsOnPath(localPath);
      const fm = splitFrontmatter(text);
      let fmParsed = typeof parseYaml === "function" ? null : undefined;
      if (fm.hasFrontmatter && fm.yaml.trim() && typeof parseYaml === "function") {
        try {
          const p = parseYaml(fm.yaml);
          if (p && typeof p === "object" && !Array.isArray(p)) fmParsed = p;
        } catch {}
      }
      const wasMangled = fm.hasFrontmatter && isGoogleDocsMangledFrontmatter(fm.yaml, fmParsed);
      const patch = buildMdPatch(localPath, fileId);
      const next = upsertYamlProperties(text, patch, { parseYaml, fallbackText, unescapeBodyCallouts });
      return {
        text: next,
        changed: next !== text,
        healedFromGoogleDocs: Boolean(wasMangled && next !== text),
      };
    }
    async function writeSyncedFile(localPath, bytesBuffer, textFile, fileId, { fallbackText = null } = {}) {
      if (textFile && isMdPath(localPath)) {
        const rawText = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytesBuffer);
        const { text: nextText, healedFromGoogleDocs } = applyMdProps(localPath, rawText, fileId, { fallbackText });
        const nextBytes = encoder.encode(nextText);
        const fileObj = await writeLocalBytes(localPath, nextBytes.buffer.slice(nextBytes.byteOffset, nextBytes.byteOffset + nextBytes.byteLength), true);
        return {
          writtenBytes: nextBytes,
          writtenSha256: await hashBytes(nextBytes),
          fileObj,
          healedFromGoogleDocs,
          healedText: healedFromGoogleDocs ? nextText : null,
        };
      }
      const fileObj = await writeLocalBytes(localPath, bytesBuffer, textFile);
      if (textFile && extOf(localPath) === "base" && fileId) {
        try { cacheBaseText(fileId, localPath, new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytesBuffer)); } catch {}
      }
      return { writtenBytes: bytesBuffer, writtenSha256: await hashBytes(bytesBuffer), fileObj, healedFromGoogleDocs: false, healedText: null };
    }
    async function archiveIfUnrepairableDocsMd(remote, file, localPath, fallbackText) {
      if (!isTextKind(file.kind) || !isMdPath(localPath)) return false;
      let remoteText = null;
      try {
        remoteText = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(remote.data);
      } catch {
        return false;
      }
      if (!isUnrepairableDocsFrontmatter(remoteText, { fallbackText, parseYaml })) return false;
      const backup = await writeArchiveBackup(file.path, remote.data, "docs-yaml-conflict");
      counts.conflicts++;
      counts.archivedConflicts++;
      counts.backups.push({ path: localPath, backupPath: backup, reason: "docs_yaml_corrupted_ambiguous" });
      emit("archived_conflict", file, localPath, { backupPath: backup, reason: "docs_yaml_corrupted_ambiguous" });
      return true;
    }
    async function tryAutoHealRemoteMd(remote, file, localPath, writtenSha256, healedText) {
      if (!healedText || !listing.canEdit || !pushLocal) {
        return { pushed: false, version: String(remote.revision.version), remoteSha256: remote.sha256 };
      }
      try {
        const res = await call(identity, {}, {
          action: "update",
          fileId: file.id,
          bindingRevision: listing.bindingRevision,
          requestId: crypto.randomUUID(),
          format: "text",
          expectedVersion: String(remote.revision.version),
          expectedSha256: remote.sha256,
          content: healedText,
        });
        return {
          pushed: true,
          version: String(res.revision?.version || remote.revision.version),
          remoteSha256: writtenSha256,
        };
      } catch {
        return { pushed: false, version: String(remote.revision.version), remoteSha256: remote.sha256 };
      }
    }
    async function ensureExistingMdProps(fileObj, localPath, localBytes, localHash, fileId) {
      if (!isMdPath(localPath)) return { sha256: localHash, bytes: localBytes, changed: false, healedFromGoogleDocs: false, text: null, fileObj };
      if (isEditorDirty(fileObj)) return { sha256: localHash, bytes: localBytes, changed: false, healedFromGoogleDocs: false, deferred: true, text: null, fileObj };
      let text;
      try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(localBytes); } catch { return { sha256: localHash, bytes: localBytes, changed: false, healedFromGoogleDocs: false, text: null, fileObj }; }
      const { text: nextText, changed, healedFromGoogleDocs } = applyMdProps(localPath, text, fileId);
      if (!changed) return { sha256: localHash, bytes: localBytes, changed: false, healedFromGoogleDocs: false, text, fileObj };
      const nextBytes = encoder.encode(nextText);
      const nextSha = await hashBytes(nextBytes);
      markInternalPath(localPath);
      if (typeof vault.process === "function") await vault.process(fileObj, () => nextText);
      else await writeLocalBytes(localPath, nextBytes.buffer.slice(nextBytes.byteOffset, nextBytes.byteOffset + nextBytes.byteLength), true);
      onEntry({ channel: "drive", status: "props_updated", fileId, path: localPath });
      return { sha256: nextSha, bytes: nextBytes, changed: true, healedFromGoogleDocs, text: nextText, fileObj: vault.getAbstractFileByPath(localPath) || fileObj };
    }
    const identity = getIdentity();
    if (!identity) throw syncError("AUTH_REQUIRED");
    const listing = await manifest(identity);
    const loaded = vault.getAllLoadedFiles();

    const distinct = new Map();
    for (const file of listing.files.filter(copyable)) {
      const key = JSON.stringify([file.id, file.path]);
      if (!distinct.has(key)) distinct.set(key, file);
    }
    const remoteFiles = [...distinct.values()];
    const remoteFolders = listing.files.filter(f => f && f.kind === "folder" && ID.test(f.id) && !f.blocked && !f.ignored && !f.pathAmbiguous && validPath(f.path));
    const existingFilesList = loaded.filter(file => file instanceof TFile);
    const existingPaths = new Set(existingFilesList.filter(file => !RESERVED_LOCAL_ROOT.test(file.path)).map(file => file.path));
    const prefix = importPrefix(loaded, remoteFiles, existingPaths);

    const joinPrefix = rel => prefix ? prefix + "/" + rel : rel;
    const stripPrefix = fullPath => {
      if (!prefix) return fullPath;
      return fullPath.startsWith(prefix + "/") ? fullPath.slice(prefix.length + 1) : null;
    };
    const isReservedSystemPath = fullPath => RESERVED_LOCAL_ROOT.test(fullPath);

    const counts = {
      saved: 0, downloaded: 0, uploaded: 0, created: 0, movedLocal: 0, movedRemote: 0,
      foldersMovedRemote: 0, foldersCreatedRemote: 0, foldersTrashedRemote: 0,
      prunedEmptyFolders: 0, trashedRemote: 0, archivedConflicts: 0, archivedRemoteDelete: 0,
      unchanged: 0, fastSkipped: 0, dirty: 0, deferred: 0, conflicts: 0, skipped: 0,
      available: remoteFiles.length, partial: Boolean(listing.partial),
      canEdit: Boolean(listing.canEdit), bindingRevision: listing.bindingRevision,
      rootId: typeof listing.rootId === "string" && ID.test(listing.rootId) ? listing.rootId : null,
      source: driveSource(listing, prefix),
      prefix, backups: [], pendingStructure: { folderOps: [], fileMoves: [], total: 0 },
    };
    const emit = (status, file, path, extra = {}) => {
      onEntry({
        channel: "drive", status, fileId: file?.id || null, path,
        sourcePath: file?.path || stripPrefix(path) || path,
        kind: file?.kind || null, bindingRevision: listing.bindingRevision,
        editorName: file?.lastEditor?.name || file?.lastModifyingUser?.displayName || null,
        editorUserId: file?.lastEditor?.userId || null,
        editedAt: file?.lastEditor?.at || file?.revision?.modifiedTime || null,
        remoteVersion: file?.revision?.version ?? null,
        ...extra,
      });
    };

    const remoteFolderById = new Map();
    const remoteFolderByRelKey = new Map();
    for (const folder of remoteFolders) {
      if (!remoteFolderById.has(folder.id)) remoteFolderById.set(folder.id, folder);
      const relKey = folder.path.normalize("NFC").toLowerCase();
      if (!remoteFolderByRelKey.has(relKey)) remoteFolderByRelKey.set(relKey, folder);
    }

    const paths = new Map(), sourcePaths = new Map();
    for (const file of remoteFiles) {
      sourcePaths.set(file.id, (sourcePaths.get(file.id) || 0) + 1);
      const key = file.path.normalize("NFC").toLowerCase();
      if (!paths.has(key)) paths.set(key, []);
      paths.get(key).push(file);
    }
    const files = [...paths.values()].flatMap(group => {
      if (group.length === 1 && sourcePaths.get(group[0].id) === 1) return group;
      for (const file of group) {
        counts.conflicts++;
        emit("conflict", file, joinPrefix(file.path), { reason: "ambiguous_path" });
      }
      return [];
    });
    const remoteById = new Map(files.map(file => [file.id, file]));
    const remoteByLocalKey = new Map(files.map(file => [joinPrefix(file.path).normalize("NFC").toLowerCase(), file]));

    const disk = new Map(loaded.map(file => [file.path.normalize("NFC").toLowerCase(), file.path]));
    const dirs = new Map();
    function ensureFolder(folderPath) {
      if (!folderPath) return Promise.resolve();
      if (!dirs.has(folderPath)) dirs.set(folderPath, (async () => {
        await ensureFolder(folderPath.split("/").slice(0, -1).join("/"));
        const existing = vault.getAbstractFileByPath(folderPath);
        if (existing instanceof TFolder) return;
        if (existing || (disk.has(folderPath.normalize("NFC").toLowerCase()) && disk.get(folderPath.normalize("NFC").toLowerCase()) !== folderPath)) {
          throw syncError("REVISION_CONFLICT");
        }
        sameIdentity(identity);
        markInternalPath(folderPath);
        await vault.createFolder(folderPath);
        markInternalPath(folderPath);
        disk.set(folderPath.normalize("NFC").toLowerCase(), folderPath);
      })());
      return dirs.get(folderPath);
    }
    async function renameLocal(fileObj, targetPath) {
      await ensureFolder(targetPath.split("/").slice(0, -1).join("/"));
      const oldPath = fileObj.path;
      markInternalPath(oldPath);
      markInternalPath(targetPath);
      if (typeof app.fileManager?.renameFile === "function") await app.fileManager.renameFile(fileObj, targetPath);
      else await vault.rename(fileObj, targetPath);
      disk.delete(oldPath.normalize("NFC").toLowerCase());
      disk.set(targetPath.normalize("NFC").toLowerCase(), targetPath);
    }
    async function removeLocal(fileObj) {
      const oldPath = fileObj.path;
      markInternalPath(oldPath);
      if (typeof vault.trash === "function") await vault.trash(fileObj, false);
      else if (typeof vault.delete === "function") await vault.delete(fileObj);
      disk.delete(oldPath.normalize("NFC").toLowerCase());
    }
    async function writeArchiveBackup(relPath, bytesBuffer, category = "conflicts") {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-") + "-" + Math.random().toString(36).slice(2, 6);
      const cleanRel = String(relPath || "note.md").split("/").filter(seg => seg && seg !== "." && seg !== "..").join("/");
      const candidate = `FlightClub Sync Archive/${category}/${stamp}/${cleanRel}`;
      const backupPath = candidate.length <= 230 ? candidate : `FlightClub Sync Archive/${category}/${stamp}-${cleanRel.split("/").at(-1).slice(-100)}`;
      await ensureFolder(backupPath.split("/").slice(0, -1).join("/"));
      sameIdentity(identity);
      markInternalPath(backupPath);
      await vault.createBinary(backupPath, bytesBuffer);
      disk.set(backupPath.normalize("NFC").toLowerCase(), backupPath);
      return backupPath;
    }
    async function writeLocalBytes(localPath, bytesBuffer, textFile) {
      markInternalPath(localPath);
      const existing = vault.getAbstractFileByPath(localPath);
      if (existing instanceof TFile) {
        if (textFile && typeof vault.process === "function") {
          const incoming = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytesBuffer);
          await vault.process(existing, () => incoming);
        } else if (typeof vault.modifyBinary === "function") {
          await vault.modifyBinary(existing, bytesBuffer);
        } else {
          await removeLocal(existing);
          await ensureFolder(localPath.split("/").slice(0, -1).join("/"));
          await vault.createBinary(localPath, bytesBuffer);
          disk.set(localPath.normalize("NFC").toLowerCase(), localPath);
        }
        return vault.getAbstractFileByPath(localPath) || existing;
      }
      await ensureFolder(localPath.split("/").slice(0, -1).join("/"));
      const created = await vault.createBinary(localPath, bytesBuffer);
      disk.set(localPath.normalize("NFC").toLowerCase(), localPath);
      return created;
    }
    async function downloadRemoteBytes(file) {
      const remote = await call(identity, { file: file.id, revision: listing.bindingRevision });
      if (remote.file?.id !== file.id || remote.file?.path !== file.path || !VERSION.test(remote.revision?.version) ||
        !SHA.test(remote.sha256) || typeof remote.base64 !== "string" || remote.base64.length > 11_400_000) {
        throw syncError("SYNC_UNAVAILABLE");
      }
      const data = fromBase64(remote.base64);
      if (await hashBytes(data) !== remote.sha256) throw syncError("CONTENT_MISMATCH");
      return { ...remote, data };
    }

    // Track current known baselines for this user across bindingRevision updates.
    const trackedById = new Map();
    for (const [trackedPath, row] of entries) {
      if (isReservedSystemPath(trackedPath) || stripPrefix(trackedPath) === null) continue;
      if (row?.userId !== identity.userId || row.kind === "platform") continue;
      const list = trackedById.get(row.fileId) || [];
      list.push([trackedPath, row]);
      trackedById.set(row.fileId, list);
    }

    const folderMap = driveFolders instanceof Map ? driveFolders : new Map(Array.isArray(driveFolders) ? driveFolders : []);
    const pendingFolderList = Array.isArray(pendingFolderOps) ? [...pendingFolderOps] : [];
    const pendingMoveList = Array.isArray(pendingMoves) ? [...pendingMoves] : [];
    const consumedFolderOps = new Set();
    const removeFolderOp = (item) => {
      const raw = item?.rawOp || item;
      consumedFolderOps.add(item);
      consumedFolderOps.add(raw);
      consumeFolderOp(raw);
      if (Array.isArray(pendingFolderOps)) {
        const idx = pendingFolderOps.indexOf(raw);
        if (idx !== -1) pendingFolderOps.splice(idx, 1);
      }
    };
    const removeMoveOp = (item) => {
      const raw = item?.rawMove || item;
      consumeMove(raw);
      if (Array.isArray(pendingMoves)) {
        const idx = pendingMoves.indexOf(raw);
        if (idx !== -1) pendingMoves.splice(idx, 1);
      }
    };

    const priorRevs = new Set();
    if (typeof lastBindingRevision === "string" && UUID.test(lastBindingRevision)) {
      priorRevs.add(lastBindingRevision);
    }
    for (const list of trackedById.values()) {
      for (const [, row] of list) {
        if (typeof row?.bindingRevision === "string" && UUID.test(row.bindingRevision)) {
          priorRevs.add(row.bindingRevision);
        }
      }
    }
    const bindingTransition = priorRevs.size > 0 && typeof listing.bindingRevision === "string" && !priorRevs.has(listing.bindingRevision);
    if (bindingTransition) {
      counts.bindingTransition = true;
      for (const op of pendingFolderList) removeFolderOp(op);
      for (const m of pendingMoveList) removeMoveOp(m);
      for (const d of (Array.isArray(pendingDeletes) ? [...pendingDeletes] : [])) {
        if (d?.fileId) consumeDelete(d.fileId);
      }
      pendingFolderList.length = 0;
      pendingMoveList.length = 0;
    }

    // Remember remote Drive folders that are not currently pending a local folder rename/delete.
    const pendingOldFolders = new Set();
    for (const op of pendingFolderList) {
      if (op?.oldPath) pendingOldFolders.add(op.oldPath.normalize("NFC").toLowerCase());
      if (op?.path) pendingOldFolders.add(op.path.normalize("NFC").toLowerCase());
    }
    for (const folder of remoteFolders) {
      const localFolderPath = joinPrefix(folder.path);
      if (!pendingOldFolders.has(localFolderPath.normalize("NFC").toLowerCase())) {
        const meta = {
          userId: identity.userId,
          folderId: folder.id,
          sourcePath: folder.path,
          bindingRevision: listing.bindingRevision,
          version: String(folder.revision?.version || "1"),
        };
        folderMap.set(localFolderPath, meta);
        rememberFolder(localFolderPath, meta);
      }
    }

    // 0) Detect ALL local structural changes (folder ops + locally moved/renamed files where Drive path hasn't changed).
    const handledMoveIds = new Set();
    const deferredStructureIds = new Set();
    const deferredStructureLocalPaths = new Set();

    // Synthesize file move candidates from BOTH explicit pendingMoves AND baseline path divergence (when Drive didn't move the file).
    const effectiveMoveById = new Map();
    for (const move of pendingMoveList) {
      if (!move?.fileId || !move?.newPath) continue;
      const remote = remoteById.get(move.fileId);
      const relTarget = stripPrefix(move.newPath);
      const targetFile = vault.getAbstractFileByPath(move.newPath);
      if (!remote || !relTarget || !validPath(relTarget) || !(targetFile instanceof TFile) || isReservedSystemPath(move.newPath)) {
        removeMoveOp(move);
        continue;
      }
      const desiredOldPath = joinPrefix(remote.path);
      if (desiredOldPath === move.newPath) {
        removeMoveOp(move);
        continue;
      }
      effectiveMoveById.set(remote.id, {
        fileId: remote.id,
        oldPath: desiredOldPath,
        newPath: move.newPath,
        relTarget,
        rawMove: move,
      });
    }
    if (!bindingTransition) {
      for (const file of files) {
        if (effectiveMoveById.has(file.id)) continue;
        const desiredPath = joinPrefix(file.path);
        const trackedList = (trackedById.get(file.id) || []).filter(([p]) => vault.getAbstractFileByPath(p) instanceof TFile);
        if (trackedList.length !== 1) continue;
        const [localCurrentPath, localBase] = trackedList[0];
        if (!localCurrentPath || localCurrentPath === desiredPath) continue;
        // If localBase.sourcePath === file.path (or no sourcePath), Drive did NOT move the file — the user moved it locally!
        const driveDidNotMove = !localBase?.sourcePath || localBase.sourcePath === file.path;
        if (!driveDidNotMove) continue;
        const relTarget = stripPrefix(localCurrentPath);
        if (!relTarget || !validPath(relTarget) || isReservedSystemPath(localCurrentPath)) continue;
        effectiveMoveById.set(file.id, {
          fileId: file.id,
          oldPath: desiredPath,
          newPath: localCurrentPath,
          relTarget,
          rawMove: null,
        });
      }
    }

    // Validate pendingFolderOps against current local & Drive state.
    const validFolderOps = [];
    for (const op of pendingFolderList) {
      if (!op || typeof op !== "object") continue;
      const opKind = op.kind === "rename_folder" || op.op === "move_folder"
        ? "rename_folder"
        : op.kind === "create_folder" || op.op === "create_folder"
          ? "create_folder"
          : op.kind === "delete_folder" || op.op === "trash_folder"
            ? "delete_folder"
            : op.kind;
      if (opKind === "rename_folder" && op.oldPath && op.newPath) {
        const relOld = stripPrefix(op.oldPath);
        const relNew = stripPrefix(op.newPath);
        const targetFolder = vault.getAbstractFileByPath(op.newPath);
        if (!relNew || !validPath(relNew) || !(targetFolder instanceof TFolder) || isReservedSystemPath(op.newPath) || relOld === relNew) {
          removeFolderOp(op);
          continue;
        }
        const remoteFolder = (op.folderId && remoteFolderById.get(op.folderId))
          || (relOld && remoteFolderByRelKey.get(relOld.normalize("NFC").toLowerCase()))
          || (folderMap.get(op.oldPath)?.folderId && remoteFolderById.get(folderMap.get(op.oldPath).folderId))
          || (folderMap.get(op.newPath)?.folderId && remoteFolderById.get(folderMap.get(op.newPath).folderId));
        validFolderOps.push({ ...op, rawOp: op, kind: "rename_folder", relOld, relNew, folderId: remoteFolder?.id || op.folderId || null, remoteFolder });
      } else if (opKind === "create_folder" && op.path) {
        const relNew = stripPrefix(op.path);
        const targetFolder = vault.getAbstractFileByPath(op.path);
        const FORBIDDEN_FOLDER_RE = /^(?:FlightClub Platform|FlightClub Shared|FlightClub Sync Archive|Майно|Люди|Події|Приховані)(?:\/|$)/i;
        if (!relNew || !validPath(relNew) || !(targetFolder instanceof TFolder) || isReservedSystemPath(op.path) || FORBIDDEN_FOLDER_RE.test(relNew)) {
          removeFolderOp(op);
          continue;
        }
        if (remoteFolderByRelKey.has(relNew.normalize("NFC").toLowerCase())) {
          removeFolderOp(op);
          continue;
        }
        validFolderOps.push({ ...op, rawOp: op, kind: "create_folder", relNew });
      } else if (opKind === "delete_folder" && op.path) {
        const relOld = stripPrefix(op.path);
        const stillExists = vault.getAbstractFileByPath(op.path) instanceof TFolder;
        if (stillExists || !relOld) {
          removeFolderOp(op);
          continue;
        }
        const remoteFolder = (op.folderId && remoteFolderById.get(op.folderId))
          || remoteFolderByRelKey.get(relOld.normalize("NFC").toLowerCase())
          || (folderMap.get(op.path)?.folderId && remoteFolderById.get(folderMap.get(op.path).folderId));
        if (!remoteFolder) {
          removeFolderOp(op);
          continue;
        }
        validFolderOps.push({ ...op, rawOp: op, kind: "delete_folder", relOld, folderId: remoteFolder.id, remoteFolder });
      } else {
        removeFolderOp(op);
      }
    }

    if (structureMode === "revert") {
      for (const op of pendingFolderList) removeFolderOp(op);
      for (const m of pendingMoveList) removeMoveOp(m);
      effectiveMoveById.clear();
      validFolderOps.length = 0;
    } else if (structureMode === "prompt" && (validFolderOps.length > 0 || effectiveMoveById.size > 0)) {
      // Freeze locally restructured folders/files: DO NOT push automatically and DO NOT roll back to Drive!
      const mappedFolderOps = validFolderOps.map(op => ({
        kind: op.kind,
        oldPath: op.oldPath || null,
        newPath: op.newPath || op.path || null,
        relOld: op.relOld || null,
        relNew: op.relNew || null,
        folderId: op.folderId || null,
      }));
      counts.pendingStructure = {
        hasChanges: true,
        folderOps: mappedFolderOps,
        folderMoves: mappedFolderOps.filter(op => op.kind === "rename_folder"),
        folderCreates: mappedFolderOps.filter(op => op.kind === "create_folder"),
        folderDeletes: mappedFolderOps.filter(op => op.kind === "delete_folder"),
        fileMoves: [...effectiveMoveById.values()].map(m => ({
          fileId: m.fileId,
          oldPath: m.oldPath,
          newPath: m.newPath,
          relTarget: m.relTarget,
        })),
        total: validFolderOps.length + effectiveMoveById.size,
      };
      for (const m of effectiveMoveById.values()) {
        handledMoveIds.add(m.fileId);
        deferredStructureIds.add(m.fileId);
        deferredStructureLocalPaths.add(m.newPath);
      }
      for (const op of validFolderOps) {
        if (op.kind === "rename_folder" && op.relOld && op.newPath) {
          for (const file of files) {
            if (file.path === op.relOld || file.path.startsWith(op.relOld + "/")) {
              handledMoveIds.add(file.id);
              deferredStructureIds.add(file.id);
              const movedLocalPath = op.newPath + file.path.slice(op.relOld.length);
              deferredStructureLocalPaths.add(movedLocalPath);
            }
          }
        }
      }
    } else if (pushLocal && listing.canEdit && structureMode === "push" && !bindingTransition) {
      const synthesizeFolderChildMoves = op => {
        if (!op?.relOld || !op?.relNew || !op?.newPath) return 0;
        const oldPrefixRel = op.relOld + "/";
        const newPrefixRel = op.relNew + "/";
        let added = 0;
        for (const file of files) {
          if (!file.path.startsWith(oldPrefixRel)) continue;
          const nextRel = newPrefixRel + file.path.slice(oldPrefixRel.length);
          const nextLocal = joinPrefix(nextRel);
          if (!(vault.getAbstractFileByPath(nextLocal) instanceof TFile)) continue;
          if (!effectiveMoveById.has(file.id)) {
            effectiveMoveById.set(file.id, {
              fileId: file.id,
              oldPath: joinPrefix(file.path),
              newPath: nextLocal,
              relTarget: nextRel,
              rawMove: null,
            });
            added++;
          }
        }
        return added;
      };
      const extraEmptyFolderDeletes = [];
      // 1A) Push folder renames/moves atomically on Google Drive first (preserves Drive folder IDs & ACLs!).
      const renameFolderOps = validFolderOps
        .filter(op => op.kind === "rename_folder")
        .sort((a, b) => a.relOld.split("/").length - b.relOld.split("/").length);
      for (const op of renameFolderOps) {
        if (!shouldContinue()) break;
        const targetAlreadyOnDrive = remoteFolderByRelKey.has(op.relNew.normalize("NFC").toLowerCase());
        if (!op.folderId || targetAlreadyOnDrive) {
          // Folder ID was missing or an empty/existing target folder already exists on Drive:
          // move every child file into the target folder via 1C, then safely trash old folder if empty!
          synthesizeFolderChildMoves(op);
          if (op.folderId && targetAlreadyOnDrive) {
            extraEmptyFolderDeletes.push({
              kind: "delete_folder",
              path: op.oldPath,
              relOld: op.relOld,
              folderId: op.folderId,
              onlyIfEmpty: true,
              rawOp: null,
            });
          }
          removeFolderOp(op);
          continue;
        }
        try {
          const movedFolderRes = await call(identity, {}, {
            action: "move_folder",
            fileId: op.folderId,
            path: op.relNew,
            bindingRevision: listing.bindingRevision,
            requestId: crypto.randomUUID(),
          });
          const oldPrefixRel = op.relOld + "/";
          const newPrefixRel = (movedFolderRes.file?.path || op.relNew) + "/";
          remoteFolderByRelKey.delete(op.relOld.normalize("NFC").toLowerCase());
          if (op.remoteFolder) op.remoteFolder.path = movedFolderRes.file?.path || op.relNew;
          remoteFolderByRelKey.set(op.relNew.normalize("NFC").toLowerCase(), op.remoteFolder || { id: op.folderId, path: op.relNew });
          forgetFolder(op.oldPath);
          rememberFolder(op.newPath, {
            userId: identity.userId,
            folderId: op.folderId,
            sourcePath: movedFolderRes.file?.path || op.relNew,
            bindingRevision: listing.bindingRevision,
            version: String(movedFolderRes.revision?.version || "1"),
          });
          // Every child file inside that Drive folder automatically moved with its parent folder on Google Drive!
          for (const file of files) {
            if (file.path.startsWith(oldPrefixRel)) {
              const oldDesiredLocal = joinPrefix(file.path);
              const nextRel = newPrefixRel + file.path.slice(oldPrefixRel.length);
              const nextLocal = joinPrefix(nextRel);
              remoteByLocalKey.delete(oldDesiredLocal.normalize("NFC").toLowerCase());
              file.path = nextRel;
              remoteByLocalKey.set(nextLocal.normalize("NFC").toLowerCase(), file);
              const childMove = effectiveMoveById.get(file.id);
              if (childMove && childMove.newPath === nextLocal) {
                if (childMove.rawMove) removeMoveOp(childMove.rawMove);
                effectiveMoveById.delete(file.id);
              }
              const base = lookup(nextLocal) || lookup(oldDesiredLocal) || (trackedById.get(file.id)?.[0]?.[1]);
              if (base) {
                if (oldDesiredLocal !== nextLocal) forget(oldDesiredLocal);
                remember(nextLocal, {
                  ...base,
                  bindingRevision: listing.bindingRevision,
                  sourcePath: nextRel,
                  canEdit: true,
                });
              }
              handledMoveIds.add(file.id);
            }
          }
          counts.foldersMovedRemote++;
          counts.movedRemote++;
          emit("moved_folder_remote", { id: op.folderId, path: op.relNew, kind: "folder" }, op.newPath, { fromPath: op.oldPath, sourcePath: op.relNew });
          removeFolderOp(op);
        } catch {
          // If folder-level rename fails (e.g., Drive conflict), fall back to moving child files individually so user's rename succeeds!
          synthesizeFolderChildMoves(op);
        }
      }

      // 1B) Push newly created folders to Google Drive (even if currently empty).
      const createFolderOps = validFolderOps
        .filter(op => op.kind === "create_folder")
        .sort((a, b) => a.relNew.split("/").length - b.relNew.split("/").length);
      for (const op of createFolderOps) {
        if (!shouldContinue()) break;
        if (remoteFolderByRelKey.has(op.relNew.normalize("NFC").toLowerCase())) {
          removeFolderOp(op);
          continue;
        }
        try {
          const createdFolderRes = await call(identity, {}, {
            action: "create_folder",
            path: op.relNew,
            bindingRevision: listing.bindingRevision,
            requestId: crypto.randomUUID(),
          });
          const fid = createdFolderRes.fileId || createdFolderRes.file?.id;
          if (fid) {
            remoteFolderByRelKey.set(op.relNew.normalize("NFC").toLowerCase(), { id: fid, path: op.relNew, kind: "folder" });
            rememberFolder(op.path, {
              userId: identity.userId,
              folderId: fid,
              sourcePath: op.relNew,
              bindingRevision: listing.bindingRevision,
              version: String(createdFolderRes.revision?.version || "1"),
            });
            counts.foldersCreatedRemote++;
            emit("created_folder_remote", { id: fid, path: op.relNew, kind: "folder" }, op.path, { sourcePath: op.relNew });
          }
          removeFolderOp(op);
        } catch {
          // Keep queued for retry on transient failure.
        }
      }

      // 1C) Push file moves/renames to Google Drive (using fresh remote.revision.version when remote path matches baseline).
      for (const move of effectiveMoveById.values()) {
        if (!shouldContinue()) break;
        const remote = remoteById.get(move.fileId);
        const targetFile = vault.getAbstractFileByPath(move.newPath);
        if (!remote || !(targetFile instanceof TFile)) {
          if (move.rawMove) removeMoveOp(move.rawMove);
          continue;
        }
        const desiredOldPath = joinPrefix(remote.path);
        const baseline = lookup(move.newPath) || lookup(move.oldPath) || (trackedById.get(remote.id)?.[0]?.[1]);
        // Only abort if Drive itself moved the file to a different path since baseline was recorded!
        if (!baseline || (baseline.sourcePath && baseline.sourcePath !== remote.path) || desiredOldPath === move.newPath) {
          if (move.rawMove) removeMoveOp(move.rawMove);
          continue;
        }
        if (remoteByLocalKey.has(move.newPath.normalize("NFC").toLowerCase())) {
          if (move.rawMove) removeMoveOp(move.rawMove);
          continue;
        }
        try {
          const movedRes = await call(identity, {}, {
            action: "move", fileId: remote.id, path: move.relTarget,
            bindingRevision: listing.bindingRevision, requestId: crypto.randomUUID(),
            expectedVersion: String(remote.revision.version),
          });
          remoteByLocalKey.delete(desiredOldPath.normalize("NFC").toLowerCase());
          remote.path = movedRes.file?.path || move.relTarget;
          if (movedRes.revision?.version) remote.revision = movedRes.revision;
          remoteByLocalKey.set(move.newPath.normalize("NFC").toLowerCase(), remote);
          if (move.oldPath !== move.newPath) forget(move.oldPath);
          if (desiredOldPath !== move.newPath) forget(desiredOldPath);
          remember(move.newPath, {
            ...baseline, bindingRevision: listing.bindingRevision, version: String(remote.revision.version),
            sourcePath: remote.path, canEdit: true,
          });
          handledMoveIds.add(remote.id);
          counts.movedRemote++;
          emit("moved_remote", remote, move.newPath, { sourcePath: remote.path });
          if (move.rawMove) removeMoveOp(move.rawMove);
        } catch (moveErr) {
          // NEVER roll back locally moved files on a failed push! Defer instead so user's structure stays intact.
          handledMoveIds.add(remote.id);
          deferredStructureIds.add(remote.id);
          deferredStructureLocalPaths.add(move.newPath);
          counts.skipped++;
          emit("skipped", remote, move.newPath, { reason: moveErr?.code || "move_failed" });
        }
      }

      // 1D) Trash emptied/deleted folders on Google Drive (bottom-up, safe onlyIfEmpty check by default).
      const deleteFolderOps = [
        ...validFolderOps.filter(op => op.kind === "delete_folder" && op.folderId),
        ...extraEmptyFolderDeletes,
      ].sort((a, b) => b.relOld.split("/").length - a.relOld.split("/").length);
      for (const op of deleteFolderOps) {
        if (!shouldContinue()) break;
        try {
          const trashedRes = await call(identity, {}, {
            action: "trash_folder",
            fileId: op.folderId,
            bindingRevision: listing.bindingRevision,
            requestId: crypto.randomUUID(),
            onlyIfEmpty: op.onlyIfEmpty !== false,
          });
          if (trashedRes.trashed) {
            counts.foldersTrashedRemote++;
            counts.trashedRemote++;
            forgetFolder(op.path);
            emit("trashed_folder_remote", { id: op.folderId, path: op.relOld, kind: "folder" }, op.path);
          }
          removeFolderOp(op);
        } catch {
          removeFolderOp(op);
        }
      }
    }

    // 2) Process Drive-side moves/renames before per-file download/upload.
    for (const file of files) {
      if (!shouldContinue() || handledMoveIds.has(file.id) || deferredStructureIds.has(file.id)) continue;
      const desiredPath = joinPrefix(file.path);
      const trackedList = (trackedById.get(file.id) || []).filter(([p]) => vault.getAbstractFileByPath(p) instanceof TFile);
      if (trackedList.length > 1) {
        counts.conflicts++;
        emit("conflict", file, desiredPath, { reason: "duplicate_binding" });
        continue;
      }
      const [oldPath, oldBase] = trackedList[0] || [];
      if (!oldPath || oldPath === desiredPath) continue;
      // CRITICAL: Only treat as a Drive-side move if Drive's path actually changed from oldBase.sourcePath
      // (or if user explicitly requested structureMode === "revert")!
      if (structureMode !== "revert" && (!oldBase?.sourcePath || oldBase.sourcePath === file.path)) {
        deferredStructureIds.add(file.id);
        deferredStructureLocalPaths.add(oldPath);
        counts.deferred++;
        emit("deferred_structure", file, oldPath, { reason: "local_structure_pending" });
        continue;
      }
      const oldFile = vault.getAbstractFileByPath(oldPath);
      if (!(oldFile instanceof TFile)) continue;
      if (isEditorDirty(oldFile)) {
        counts.deferred++;
        emit("deferred", file, oldPath, { reason: "open_editor" });
        continue;
      }
      try {
        const localBytes = await vault.readBinary(oldFile);
        const localHash = await hashBytes(localBytes);
        const displaced = vault.getAbstractFileByPath(desiredPath);
        if (displaced instanceof TFile) {
          const dispBytes = await vault.readBinary(displaced);
          const dispHash = await hashBytes(dispBytes);
          if (dispHash !== localHash) {
            const backup = await writeArchiveBackup(file.path, dispBytes, "conflicts");
            counts.backups.push({ path: desiredPath, backupPath: backup, reason: "remote_move_displaced" });
          }
          await removeLocal(displaced);
        }
        if (localHash === oldBase.sha256) {
          await renameLocal(oldFile, desiredPath);
          forget(oldPath);
          remember(desiredPath, { ...oldBase, bindingRevision: listing.bindingRevision, sourcePath: file.path, canEdit: Boolean(listing.canEdit) });
          counts.movedLocal++;
          emit("moved_local", file, desiredPath, { fromPath: oldPath });
        } else {
          // Drive moved file while local edited: Drive wins, local draft archived safely.
          const backup = await writeArchiveBackup(oldPath, localBytes, "conflicts");
          const remote = await downloadRemoteBytes(file);
          const { writtenSha256 } = await writeSyncedFile(desiredPath, remote.data, isTextKind(file.kind), file.id);
          await removeLocal(oldFile);
          forget(oldPath);
          remember(desiredPath, {
            userId: identity.userId, fileId: file.id, bindingRevision: listing.bindingRevision,
            version: remote.revision.version, sha256: writtenSha256, remoteSha256: remote.sha256, kind: file.kind,
            canEdit: Boolean(listing.canEdit), sourcePath: file.path,
          });
          counts.archivedConflicts++;
          counts.backups.push({ path: desiredPath, backupPath: backup, reason: "remote_move" });
          emit("archived_conflict", file, desiredPath, { backupPath: backup, reason: "remote_move" });
        }
      } catch (error) {
        if (error?.code === "AUTH_REQUIRED" || error?.code === "ROOT_BINDING_CHANGED") throw error;
        counts.skipped++;
        emit("skipped", file, desiredPath, { reason: error?.code || "move_failed" });
      }
    }

    // 3) Reconcile Drive files with O(1) stat fast-skip for unchanged files (only delta files are read/hashed/synced!).
    const deleteByFileId = bindingTransition
      ? new Map()
      : new Map((Array.isArray(pendingDeletes) ? pendingDeletes : []).filter(d => d?.fileId).map(d => [d.fileId, d]));
    const deltaFiles = [];
    for (const file of files) {
      if (deferredStructureIds.has(file.id)) {
        counts.deferred++;
        continue;
      }
      const localPath = joinPrefix(file.path);
      if (!validPath(localPath)) {
        counts.conflicts++;
        emit("conflict", file, localPath, { reason: "path_collision" });
        continue;
      }
      const knownRaw = lookup(localPath);
      const known = knownRaw?.userId === identity.userId && knownRaw.kind !== "platform" && knownRaw.fileId === file.id ? knownRaw : null;
      const existing = vault.getAbstractFileByPath(localPath);
      if (known && existing instanceof TFile && deleteByFileId.delete(file.id)) {
        consumeDelete(file.id);
      }
      const delIntent = deleteByFileId.get(file.id);
      if (
        existing instanceof TFile &&
        known &&
        !delIntent &&
        !isEditorDirty(existing) &&
        String(file.revision?.version) === String(known.version) &&
        Number.isFinite(existing.stat?.mtime) &&
        Number.isFinite(existing.stat?.size) &&
        known.localMtime === existing.stat.mtime &&
        known.localSize === existing.stat.size &&
        (known.propsVersion === 3 || !isMdPath(localPath))
      ) {
        const remoteSha = known.remoteSha256 || known.sha256;
        if (known.bindingRevision !== listing.bindingRevision || known.canEdit !== Boolean(listing.canEdit) || known.sourcePath !== file.path || known.remoteSha256 !== remoteSha) {
          remember(localPath, { ...known, remoteSha256: remoteSha, bindingRevision: listing.bindingRevision, canEdit: Boolean(listing.canEdit), sourcePath: file.path });
        }
        counts.unchanged++;
        counts.fastSkipped++;
        emit("unchanged", file, localPath, { fast: true });
        continue;
      }
      deltaFiles.push({ file, localPath });
    }

    const trashBatchAllowed = deleteByFileId.size <= 10 || allowBulkTrash;
    let next = 0, finished = 0, fatal;
    report(0, deltaFiles.length, "drive", deltaFiles[0]?.localPath || null);
    await Promise.all(Array.from({ length: Math.min(4, Math.max(1, deltaFiles.length)) }, async () => {
      while (!fatal && next < deltaFiles.length && shouldContinue()) {
        const { file, localPath } = deltaFiles[next++];
        report(finished, deltaFiles.length, "drive", localPath);
        try {
          sameIdentity(identity);
          const knownRaw = lookup(localPath);
          const known = knownRaw?.userId === identity.userId && knownRaw.kind !== "platform" && knownRaw.fileId === file.id ? knownRaw : null;
          const existing = vault.getAbstractFileByPath(localPath);
          const delIntent = deleteByFileId.get(file.id);

          if (existing && !(existing instanceof TFile)) {
            counts.conflicts++;
            emit("conflict", file, localPath, { reason: "path_collision" });
            continue;
          }

          if (isActiveLiveFile(localPath)) {
            counts.deferred++;
            emit("deferred", file, localPath, { reason: "active_live_session" });
            continue;
          }
          if (!existing) {
            if (delIntent && pushLocal && listing.canEdit) {
              if (!trashBatchAllowed) {
                counts.conflicts++;
                emit("conflict", file, localPath, { reason: "bulk_trash_confirm" });
                continue;
              }
              if (String(file.revision?.version) === String(delIntent.version)) {
                try {
                  await call(identity, {}, {
                    action: "trash", fileId: file.id, bindingRevision: listing.bindingRevision,
                    requestId: crypto.randomUUID(), expectedVersion: String(delIntent.version),
                  });
                  forget(localPath);
                  consumeDelete(file.id);
                  counts.trashedRemote++;
                  emit("trashed_remote", file, localPath);
                  continue;
                } catch (err) {
                  if (err?.code !== "REVISION_CONFLICT") throw err;
                }
              }
            }
            const remote = await downloadRemoteBytes(file);
            const synced = await writeSyncedFile(localPath, remote.data, isTextKind(file.kind), file.id);
            const healed = await tryAutoHealRemoteMd(remote, file, localPath, synced.writtenSha256, synced.healedText);
            remember(localPath, {
              userId: identity.userId, fileId: file.id, bindingRevision: listing.bindingRevision,
              version: healed.version, sha256: synced.writtenSha256, remoteSha256: healed.remoteSha256, kind: file.kind,
              canEdit: Boolean(listing.canEdit), sourcePath: file.path, propsVersion: 3, ...statMeta(synced.fileObj),
            });
            if (delIntent) consumeDelete(file.id);
            counts.downloaded++; counts.saved++;
            const update = summarizeUpdate(null, synced.healedText ? encoder.encode(synced.healedText) : remote.data, localPath, file.kind);
            emit("saved", file, localPath, { reason: healed.pushed ? "google_docs_yaml_healed" : "remote_new", actionDetails: update?.changes, actionExcerpts: update?.excerpts });
            continue;
          }

          if (isEditorDirty(existing)) {
            counts.deferred++;
            emit("deferred", file, localPath, { reason: "open_editor" });
            continue;
          }

          const localBytes = await vault.readBinary(existing);
          const localHash = await hashBytes(localBytes);
          const localMd5 = md5Hex(localBytes);
          let localNormText = null;
          let localNormSha = null;
          if (isTextKind(file.kind)) {
            try {
              const rawText = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(localBytes);
              localNormText = rawText.replace(/\r\n?/g, "\n");
              localNormSha = localNormText === rawText ? localHash : await hashBytes(encoder.encode(localNormText));
            } catch {}
          }

          if (!known) {
            // Pre-existing local file with lost/missing baseline: adopt if equal, else Drive wins with archive backup.
            if (localMd5 && file.revision?.md5Checksum && localMd5 === String(file.revision.md5Checksum).toLowerCase()) {
              const ensured = await ensureExistingMdProps(existing, localPath, localBytes, localHash, file.id);
              remember(localPath, {
                userId: identity.userId, fileId: file.id, bindingRevision: listing.bindingRevision,
                version: String(file.revision.version), sha256: ensured.sha256, remoteSha256: localHash, kind: file.kind,
                canEdit: Boolean(listing.canEdit), sourcePath: file.path,
                ...(ensured.deferred ? {} : { propsVersion: 3 }), ...statMeta(ensured.fileObj),
              });
              counts.unchanged++;
              emit("unchanged", file, localPath, { reason: "adopted_md5" });
              continue;
            }
            const remote = await downloadRemoteBytes(file);
            const remoteNormText = isTextKind(file.kind)
              ? (() => { try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(remote.data).replace(/\r\n?/g, "\n"); } catch { return null; } })()
              : null;
            if (localHash === remote.sha256 || (localNormText !== null && remoteNormText !== null && localNormText === remoteNormText)) {
              const ensured = await ensureExistingMdProps(existing, localPath, localBytes, localHash, file.id);
              remember(localPath, {
                userId: identity.userId, fileId: file.id, bindingRevision: listing.bindingRevision,
                version: remote.revision.version, sha256: ensured.sha256, remoteSha256: remote.sha256, kind: file.kind,
                canEdit: Boolean(listing.canEdit), sourcePath: file.path,
                ...(ensured.deferred ? {} : { propsVersion: 3 }), ...statMeta(ensured.fileObj),
              });
              counts.unchanged++;
              emit("unchanged", file, localPath, { reason: "adopted" });
              continue;
            }
            // Check if local already has injected YAML and matches Drive bytes when injected (LF-normalized)
            if (isMdPath(localPath) && remoteNormText !== null) {
              const remoteInjected = applyMdProps(localPath, remoteNormText, file.id, { fallbackText: localNormText });
              const remoteInjectedNorm = remoteInjected.text.replace(/\r\n?/g, "\n");
              const remoteInjectedSha = await hashBytes(encoder.encode(remoteInjectedNorm));
              if (remoteInjectedSha === localHash || (localNormSha && remoteInjectedSha === localNormSha) || (localNormText !== null && localNormText === remoteInjectedNorm)) {
                remember(localPath, {
                  userId: identity.userId, fileId: file.id, bindingRevision: listing.bindingRevision,
                  version: remote.revision.version, sha256: localHash, remoteSha256: remote.sha256, kind: file.kind,
                  canEdit: Boolean(listing.canEdit), sourcePath: file.path, propsVersion: 3, ...statMeta(existing),
                });
                counts.unchanged++;
                emit("unchanged", file, localPath, { reason: "adopted_with_props" });
                continue;
              }
            }
            if (isEditorDirty(existing)) {
              counts.deferred++;
              emit("deferred", file, localPath, { reason: "open_editor" });
              continue;
            }
            const backup = await writeArchiveBackup(file.path, localBytes, "adopted");
            const synced = await writeSyncedFile(localPath, remote.data, isTextKind(file.kind), file.id, { fallbackText: localNormText });
            const healed = await tryAutoHealRemoteMd(remote, file, localPath, synced.writtenSha256, synced.healedText);
            remember(localPath, {
              userId: identity.userId, fileId: file.id, bindingRevision: listing.bindingRevision,
              version: healed.version, sha256: synced.writtenSha256, remoteSha256: healed.remoteSha256, kind: file.kind,
              canEdit: Boolean(listing.canEdit), sourcePath: file.path, propsVersion: 3, ...statMeta(synced.fileObj),
            });
            counts.archivedConflicts++;
            counts.backups.push({ path: localPath, backupPath: backup, reason: "drive_wins_adopt" });
            emit("archived_conflict", file, localPath, { backupPath: backup, reason: "drive_wins_adopt" });
            continue;
          }

          const localMatchesKnown = localHash === known.sha256 || (localNormSha && localNormSha === known.sha256) ||
            (known.remoteSha256 && (localHash === known.remoteSha256 || (localNormSha && localNormSha === known.remoteSha256)));
          const localChanged = !localMatchesKnown;
          const remoteChanged = String(file.revision?.version) !== String(known.version);

          if (!localChanged && remoteChanged && localMd5 && file.revision?.md5Checksum &&
            localMd5 === String(file.revision.md5Checksum).toLowerCase()) {
            const ensured = await ensureExistingMdProps(existing, localPath, localBytes, localHash, file.id);
            remember(localPath, {
              ...known, bindingRevision: listing.bindingRevision, version: String(file.revision.version),
              sha256: ensured.sha256, remoteSha256: localHash,
              canEdit: Boolean(listing.canEdit), sourcePath: file.path,
              ...(ensured.deferred ? {} : { propsVersion: 3 }), ...statMeta(ensured.fileObj),
            });
            counts.unchanged++;
            emit("unchanged", file, localPath);
            continue;
          }

          if (!localChanged && !remoteChanged) {
            const ensured = await ensureExistingMdProps(existing, localPath, localBytes, localHash, file.id);
            const remoteSha = known.remoteSha256 || known.sha256;
            const nextPropsVer = ensured.deferred ? known.propsVersion : 3;
            const sm = statMeta(ensured.fileObj);
            if (ensured.changed || known.propsVersion !== nextPropsVer || known.localMtime !== sm.localMtime || known.localSize !== sm.localSize || known.bindingRevision !== listing.bindingRevision || known.canEdit !== Boolean(listing.canEdit) || known.sourcePath !== file.path || known.remoteSha256 !== remoteSha) {
              remember(localPath, { ...known, sha256: ensured.sha256, remoteSha256: remoteSha, bindingRevision: listing.bindingRevision, canEdit: Boolean(listing.canEdit), sourcePath: file.path, ...(nextPropsVer ? { propsVersion: nextPropsVer } : {}), ...sm });
            }
            counts.unchanged++;
            emit("unchanged", file, localPath);
            continue;
          }

          if (!localChanged && remoteChanged) {
            const remote = await downloadRemoteBytes(file);
            if (isEditorDirty(existing)) {
              counts.deferred++;
              emit("deferred", file, localPath, { reason: "open_editor" });
              continue;
            }
            if (await archiveIfUnrepairableDocsMd(remote, file, localPath, localNormText)) {
              continue;
            }
            const synced = await writeSyncedFile(localPath, remote.data, isTextKind(file.kind), file.id, { fallbackText: localNormText });
            const healed = await tryAutoHealRemoteMd(remote, file, localPath, synced.writtenSha256, synced.healedText);
            remember(localPath, {
              userId: identity.userId, fileId: file.id, bindingRevision: listing.bindingRevision,
              version: healed.version, sha256: synced.writtenSha256, remoteSha256: healed.remoteSha256, kind: file.kind,
              canEdit: Boolean(listing.canEdit), sourcePath: file.path, propsVersion: 3, ...statMeta(synced.fileObj),
            });
            counts.downloaded++; counts.saved++;
            const update = summarizeUpdate(localBytes, synced.healedText ? encoder.encode(synced.healedText) : remote.data, localPath, file.kind);
            emit("saved", file, localPath, { reason: healed.pushed ? "google_docs_yaml_healed" : "remote_update", actionDetails: update?.changes, actionExcerpts: update?.excerpts });
            continue;
          }

          if (localChanged && !remoteChanged) {
            if (!pushLocal || !listing.canEdit) {
              counts.dirty++;
              emit("dirty", file, localPath, { reason: listing.canEdit ? "local_changes" : "read_only" });
              continue;
            }
            const updMtime = existing.stat?.mtime ?? 0;
            const updSize = existing.stat?.size ?? -1;
            const updRemoteVer = String(file.revision?.version || "");
            const prevUpdFail = failedUpdates.get(localPath);
            if (prevUpdFail && prevUpdFail.mtime === updMtime && prevUpdFail.size === updSize && prevUpdFail.remoteVer === updRemoteVer && Date.now() < prevUpdFail.retryAfter) {
              counts.skipped++;
              emit("skipped", file, localPath, { reason: prevUpdFail.reason || "update_cooldown" });
              continue;
            }
            const format = formatForExtension(localPath);
            if (!format) {
              counts.skipped++;
              emit("skipped", file, localPath, { reason: "unsupported" });
              continue;
            }
            const ensured = format === "binary" ? { bytes: localBytes, sha256: localHash, changed: false, fileObj: existing }
              : await ensureExistingMdProps(existing, localPath, localBytes, localHash, file.id);
            const uploadBytes = ensured.bytes;
            const uploadSha = ensured.sha256;
            const expectedRemoteSha = known.remoteSha256 || known.sha256;
            if (format === "binary" ? uploadBytes.byteLength > 8_388_608 : uploadBytes.byteLength > 1_048_576) {
              counts.skipped++;
              emit("skipped", file, localPath, { reason: "oversized" });
              continue;
            }
            try {
              let uploadedRes;
              if (format === "binary") {
                uploadedRes = await call(identity, {}, {
                  action: "update", fileId: file.id, bindingRevision: listing.bindingRevision,
                  requestId: crypto.randomUUID(), format: "binary",
                  expectedVersion: String(known.version), expectedSha256: expectedRemoteSha,
                  base64: toBase64(uploadBytes),
                }, "drive-device-v1", { "x-fc-binary": "1" });
              } else {
                const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(uploadBytes);
                uploadedRes = await call(identity, {}, {
                  action: "update", fileId: file.id, bindingRevision: listing.bindingRevision,
                  requestId: crypto.randomUUID(), format,
                  expectedVersion: String(known.version), expectedSha256: expectedRemoteSha,
                  content,
                });
              }
              const nextVer = String(uploadedRes.revision?.version || file.revision.version);
              remember(localPath, {
                userId: identity.userId, fileId: file.id, bindingRevision: listing.bindingRevision,
                version: nextVer, sha256: uploadSha, remoteSha256: uploadSha,
                kind: file.kind, canEdit: true, sourcePath: file.path, propsVersion: 3, ...statMeta(ensured.fileObj),
              });
              if (extOf(localPath) === "base") {
                try { cacheBaseText(file.id, localPath, new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(uploadBytes)); } catch {}
              }
              counts.uploaded++;
              failedUpdates.delete(localPath);
              emit("uploaded", file, localPath);
              continue;
            } catch (uploadErr) {
              if (uploadErr?.code === "WRITE_RESULT_UNKNOWN") {
                await new Promise(resolve => setTimeout(resolve, 1200));
                try {
                  const checkRemote = await downloadRemoteBytes(file);
                  if (checkRemote?.sha256 === uploadSha) {
                    remember(localPath, {
                      userId: identity.userId, fileId: file.id, bindingRevision: listing.bindingRevision,
                      version: checkRemote.revision.version, sha256: uploadSha, remoteSha256: uploadSha,
                      kind: file.kind, canEdit: true, sourcePath: file.path, propsVersion: 3, ...statMeta(ensured.fileObj),
                    });
                    if (extOf(localPath) === "base") {
                      try { cacheBaseText(file.id, localPath, new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(uploadBytes)); } catch {}
                    }
                    counts.uploaded++;
                    failedUpdates.delete(localPath);
                    emit("uploaded", file, localPath, { reason: "reconciled" });
                    continue;
                  }
                } catch {}
              }
              if (uploadErr?.code !== "REVISION_CONFLICT") {
                failedUpdates.set(localPath, {
                  mtime: existing.stat?.mtime ?? 0,
                  size: existing.stat?.size ?? -1,
                  remoteVer: String(file.revision?.version || ""),
                  reason: uploadErr?.code || "update_failed",
                  retryAfter: Date.now() + 900_000,
                });
                throw uploadErr;
              }
              if (isEditorDirty(existing)) {
                counts.deferred++;
                emit("deferred", file, localPath, { reason: "open_editor" });
                continue;
              }
              // Race lost -> fall through to structural Canvas/.base merge or Drive wins resolution below!
            }
          }

          // Conflict (both Drive & local modified): NEVER clobber an actively edited file!
          if (isEditorDirty(existing)) {
            counts.deferred++;
            emit("deferred", file, localPath, { reason: "open_editor" });
            continue;
          }
          const remote = await downloadRemoteBytes(file);
          if (isEditorDirty(existing)) {
            counts.deferred++;
            emit("deferred", file, localPath, { reason: "open_editor" });
            continue;
          }
          const remoteConflictNorm = isTextKind(file.kind)
            ? (() => { try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(remote.data).replace(/\r\n?/g, "\n"); } catch { return null; } })()
            : null;
          let conflictMatchesRemote = localHash === remote.sha256 ||
            (localNormText !== null && remoteConflictNorm !== null && localNormText === remoteConflictNorm);
          if (!conflictMatchesRemote && isMdPath(localPath) && remoteConflictNorm !== null && localNormText !== null) {
            const remoteInjectedNorm = applyMdProps(localPath, remoteConflictNorm, file.id, { fallbackText: localNormText }).text.replace(/\r\n?/g, "\n");
            if (localNormText === remoteInjectedNorm) conflictMatchesRemote = true;
          }
          if (conflictMatchesRemote) {
            const ensured = await ensureExistingMdProps(existing, localPath, localBytes, localHash, file.id);
            remember(localPath, {
              userId: identity.userId, fileId: file.id, bindingRevision: listing.bindingRevision,
              version: remote.revision.version, sha256: ensured.sha256, remoteSha256: remote.sha256, kind: file.kind,
              canEdit: Boolean(listing.canEdit), sourcePath: file.path,
              ...(ensured.deferred ? {} : { propsVersion: 3 }), ...statMeta(ensured.fileObj),
            });
            if (extOf(localPath) === "base") {
              try { cacheBaseText(file.id, localPath, new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(remote.data)); } catch {}
            }
            counts.unchanged++;
            emit("unchanged", file, localPath);
            continue;
          }
          // For Obsidian .base conflicts, merge YAML views structurally so filter/layout edits survive concurrent updates!
          if (extOf(localPath) === "base" && pushLocal && listing.canEdit) {
            try {
              const localText = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(localBytes);
              const remoteText = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(remote.data);
              const mergedBase = mergeBaseYamlText(baseTextCache.get(file.id) ?? null, localText, remoteText, { preferLocal: true });
              if (mergedBase && mergedBase !== remoteText) {
                const mergedBytes = encoder.encode(mergedBase);
                const mergedSha = await hashBytes(mergedBytes);
                const mergedRes = await call(identity, {}, {
                  action: "update", fileId: file.id, bindingRevision: listing.bindingRevision,
                  requestId: crypto.randomUUID(), format: "text",
                  expectedVersion: String(remote.revision.version), expectedSha256: remote.sha256,
                  content: mergedBase,
                });
                const fileObj = await writeLocalBytes(localPath, mergedBytes.buffer.slice(mergedBytes.byteOffset, mergedBytes.byteOffset + mergedBytes.byteLength), true);
                cacheBaseText(file.id, localPath, mergedBase);
                remember(localPath, {
                  userId: identity.userId, fileId: file.id, bindingRevision: listing.bindingRevision,
                  version: String(mergedRes.revision?.version || remote.revision.version), sha256: mergedSha, remoteSha256: mergedSha,
                  kind: file.kind, canEdit: true, sourcePath: file.path, propsVersion: 3, ...statMeta(fileObj),
                });
                counts.uploaded++;
                emit("uploaded", file, localPath, { reason: "base_merged" });
                continue;
              }
            } catch {
              // Fall back safely to Drive-wins + archive backup below.
            }
          }
          if (await archiveIfUnrepairableDocsMd(remote, file, localPath, localNormText)) {
            continue;
          }
          const backup = await writeArchiveBackup(file.path, localBytes, "conflicts");
          const synced = await writeSyncedFile(localPath, remote.data, isTextKind(file.kind), file.id, { fallbackText: localNormText });
          const healed = await tryAutoHealRemoteMd(remote, file, localPath, synced.writtenSha256, synced.healedText);
          remember(localPath, {
            userId: identity.userId, fileId: file.id, bindingRevision: listing.bindingRevision,
            version: healed.version, sha256: synced.writtenSha256, remoteSha256: healed.remoteSha256, kind: file.kind,
            canEdit: Boolean(listing.canEdit), sourcePath: file.path, propsVersion: 3, ...statMeta(synced.fileObj),
          });
          counts.archivedConflicts++;
          counts.backups.push({ path: localPath, backupPath: backup, reason: "drive_wins_conflict" });
          emit("archived_conflict", file, localPath, { backupPath: backup, reason: "drive_wins_conflict" });
        } catch (error) {
          if (error?.code === "AUTH_REQUIRED" || error?.code === "ROOT_BINDING_CHANGED") fatal = error;
          else if (error?.code === "SYNC_CANCELLED") break;
          else {
            counts.skipped++;
            emit("skipped", file, localPath, { reason: error?.code || "unavailable" });
          }
        } finally {
          report(++finished, deltaFiles.length, "drive", localPath);
        }
      }
    }));
    if (fatal) throw fatal;
    if (!shouldContinue()) throw syncError("SYNC_CANCELLED");

    // 4) Drive deletions: when tree listing is complete, archive & remove tracked files deleted in Drive.
    if (!listing.partial) {
      const removedInStep4Dirs = [];
      for (const [trackedPath, row] of [...entries]) {
        if (!shouldContinue()) break;
        if (row?.userId !== identity.userId || row?.kind === "platform") continue;
        if (remoteById.has(row.fileId)) continue;
        const existing = vault.getAbstractFileByPath(trackedPath);
        if (existing instanceof TFile) {
          if (isEditorDirty(existing)) {
            counts.deferred++;
            emit("deferred", null, trackedPath, { reason: "open_editor" });
            continue;
          }
          const localBytes = await vault.readBinary(existing);
          const backup = await writeArchiveBackup(row.sourcePath || trackedPath, localBytes, "deleted-on-drive");
          await removeLocal(existing);
          counts.archivedRemoteDelete++;
          counts.backups.push({ path: trackedPath, backupPath: backup, reason: "deleted_on_drive" });
          emit("archived_delete", null, trackedPath, { backupPath: backup });
        }
        const parentDir = trackedPath.includes("/") ? trackedPath.slice(0, trackedPath.lastIndexOf("/")) : "";
        if (parentDir) removedInStep4Dirs.push(parentDir);
        forget(trackedPath);
      }

      // 4b) Prune strictly empty legacy folders after Drive deletions / root transitions.
      const remoteFolderPaths = new Set();
      const addRemoteFolderAncestors = localFolder => {
        let cur = localFolder;
        while (cur && (!prefix || cur === prefix || cur.startsWith(prefix + "/"))) {
          remoteFolderPaths.add(cur.normalize("NFC").toLowerCase());
          const slash = cur.lastIndexOf("/");
          cur = slash > 0 ? cur.slice(0, slash) : "";
        }
      };
      for (const folder of remoteFolders) addRemoteFolderAncestors(joinPrefix(folder.path));
      for (const file of files) {
        const full = joinPrefix(file.path);
        const slash = full.lastIndexOf("/");
        if (slash > 0) addRemoteFolderAncestors(full.slice(0, slash));
      }

      const activePendingFolderPaths = new Set();
      const addPendingAncestors = localPath => {
        let cur = localPath;
        while (cur) {
          activePendingFolderPaths.add(cur.normalize("NFC").toLowerCase());
          const slash = cur.lastIndexOf("/");
          cur = slash > 0 ? cur.slice(0, slash) : "";
        }
      };
      for (const op of pendingFolderList) {
        if (consumedFolderOps.has(op)) continue;
        if (op?.path) addPendingAncestors(op.path);
        if (op?.newPath) addPendingAncestors(op.newPath);
        if (op?.oldPath) addPendingAncestors(op.oldPath);
      }
      for (const p of deferredStructureLocalPaths) {
        const slash = p.lastIndexOf("/");
        if (slash > 0) addPendingAncestors(p.slice(0, slash));
      }

      const pruneCandidates = new Set();
      const addPruneAncestors = folderPath => {
        let cur = folderPath;
        while (cur && cur !== prefix && (!prefix || cur.startsWith(prefix + "/")) && !isReservedSystemPath(cur)) {
          pruneCandidates.add(cur);
          const slash = cur.lastIndexOf("/");
          cur = slash > 0 ? cur.slice(0, slash) : "";
        }
      };
      for (const dir of removedInStep4Dirs) addPruneAncestors(dir);
      for (const [folderPath, meta] of [...folderMap.entries()]) {
        if (meta?.userId !== identity.userId) continue;
        if (remoteFolderById.has(meta.folderId)) continue;
        const normKey = folderPath.normalize("NFC").toLowerCase();
        if (remoteFolderPaths.has(normKey) || activePendingFolderPaths.has(normKey)) continue;
        forgetFolder(folderPath);
        folderMap.delete(folderPath);
        addPruneAncestors(folderPath);
      }

      const sortedPrune = [...pruneCandidates].sort((a, b) => b.split("/").length - a.split("/").length || b.localeCompare(a));
      const removedPaths = new Set();
      for (const folderPath of sortedPrune) {
        if (!shouldContinue()) break;
        if (!folderPath || folderPath === prefix || isReservedSystemPath(folderPath)) continue;
        if (prefix && !folderPath.startsWith(prefix + "/")) continue;
        const normKey = folderPath.normalize("NFC").toLowerCase();
        if (remoteFolderPaths.has(normKey) || activePendingFolderPaths.has(normKey)) continue;
        const folderObj = vault.getAbstractFileByPath(folderPath);
        if (!(folderObj instanceof TFolder)) continue;
        if (Array.isArray(folderObj.children) && folderObj.children.some(c => c && !removedPaths.has(c.path))) continue;
        const childPrefix = folderPath + "/";
        const hasLoadedChild = vault.getAllLoadedFiles().some(entry =>
          entry?.path && !removedPaths.has(entry.path) && entry.path.startsWith(childPrefix),
        );
        if (hasLoadedChild) continue;
        markInternalPath(folderPath);
        if (typeof vault.trash === "function") await vault.trash(folderObj, false);
        else if (typeof vault.delete === "function") await vault.delete(folderObj);
        else continue;
        markInternalPath(folderPath);
        removedPaths.add(folderPath);
        disk.delete(normKey);
        counts.prunedEmptyFolders++;
      }
    }

    // 5) New local files inside localVaultRoot -> upload to Google Drive (bounded concurrency + progress).
    if (pushLocal && listing.canEdit && !bindingTransition) {
      const FORBIDDEN_DRIVE_DIR_RE = /^(?:FlightClub Platform|FlightClub Shared|FlightClub Sync Archive|Майно|Люди|Події|Приховані)(?:\/|$)/i;
      const isPlatformNoteText = text => {
        if (typeof text !== "string") return false;
        if (/<!--\s*fc:(?:generated|read-only)\s*-->/i.test(text)) return true;
        const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
        return Boolean(fmMatch && (/^\s*fc-schema\s*:\s*\d+/m.test(fmMatch[1]) || (/^\s*fc-kind\s*:/m.test(fmMatch[1]) && /^\s*fc-id\s*:/m.test(fmMatch[1]))));
      };
      const toCreate = [];
      for (const file of vault.getAllLoadedFiles()) {
        if (!(file instanceof TFile)) continue;
        if (isReservedSystemPath(file.path) || IGNORED_LOCAL_FILE.test(file.path)) continue;
        if (deferredStructureLocalPaths.has(file.path)) continue;
        const rel = stripPrefix(file.path);
        if (!rel || !validPath(rel) || EXCLUDED.test(file.path) || /\.zip$/i.test(file.path) || /(?:^|\/)FlightClub Canvas — .*\.canvas$/i.test(file.path)) continue;
        if (isLegacyPlatformFilename(file.path) || FORBIDDEN_DRIVE_DIR_RE.test(rel)) {
          counts.skipped++;
          emit("skipped", null, file.path, { reason: "platform_protected" });
          continue;
        }
        if (remoteByLocalKey.has(file.path.normalize("NFC").toLowerCase())) continue;
        if (lookup(file.path)?.fileId && remoteById.has(lookup(file.path).fileId)) continue;
        if (isEditorDirty(file)) {
          counts.deferred++;
          emit("deferred", null, file.path, { reason: "open_editor" });
          continue;
        }
        const statMtime = file.stat?.mtime ?? 0;
        const statSize = file.stat?.size ?? -1;
        const prevFail = failedCreates.get(file.path);
        if (prevFail && prevFail.mtime === statMtime && prevFail.size === statSize && Date.now() < prevFail.retryAfter) {
          counts.skipped++;
          emit("skipped", null, file.path, { reason: prevFail.reason || "create_cooldown" });
          continue;
        }
        const format = formatForExtension(file.path);
        if (format) toCreate.push({ file, rel, format, statMtime, statSize });
      }
      if (toCreate.length) {
        let createNext = 0, createDone = 0;
        report(0, toCreate.length, "upload", toCreate[0]?.file?.path || null);
        await Promise.all(Array.from({ length: Math.min(4, toCreate.length) }, async () => {
          while (!fatal && createNext < toCreate.length && shouldContinue()) {
            const { file, rel, format, statMtime, statSize } = toCreate[createNext++];
            report(createDone, toCreate.length, "upload", file.path);
            if (isActiveLiveFile(file.path)) { createDone++; continue; }
            try {
              const localBytes = await vault.readBinary(file);
              if (format === "binary" ? localBytes.byteLength > 8_388_608 : localBytes.byteLength > 1_048_576) {
                counts.skipped++;
                failedCreates.set(file.path, { mtime: statMtime, size: statSize, reason: "oversized", retryAfter: Date.now() + 900_000 });
                emit("skipped", null, file.path, { reason: "oversized" });
                continue;
              }
              let decodedText = null;
              if (format !== "binary") {
                decodedText = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(localBytes);
                if (format === "text" && isMdPath(file.path) && isPlatformNoteText(decodedText)) {
                  counts.skipped++;
                  failedCreates.set(file.path, { mtime: statMtime, size: statSize, reason: "platform_protected", retryAfter: Date.now() + 900_000 });
                  emit("skipped", null, file.path, { reason: "platform_protected" });
                  continue;
                }
              }
              const localHash = await hashBytes(localBytes);
              const payload = { action: "create", path: rel, bindingRevision: listing.bindingRevision, requestId: crypto.randomUUID(), format };
              if (format === "binary") payload.base64 = toBase64(localBytes);
              else payload.content = decodedText;
              const created = await call(identity, {}, payload, "drive-device-v1", format === "binary" ? { "x-fc-binary": "1" } : {});
              failedCreates.delete(file.path);
              const fid = created.fileId || created.file?.id;
              if (fid) {
                let finalVersion = String(created.revision?.version || "1");
                const createdSha = created.contentSha256 || localHash;
                let finalLocalSha = createdSha;
                let finalRemoteSha = createdSha;
                if (isMdPath(file.path) && !isEditorDirty(file)) {
                  const ensured = await ensureExistingMdProps(file, file.path, localBytes, localHash, fid);
                  if (ensured.changed) {
                    finalLocalSha = ensured.sha256;
                    try {
                      const injectedContent = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(ensured.bytes);
                      const upd = await call(identity, {}, {
                        action: "update", fileId: fid, bindingRevision: listing.bindingRevision,
                        requestId: crypto.randomUUID(), format: "text",
                        expectedVersion: finalVersion, expectedSha256: createdSha, content: injectedContent,
                      });
                      if (upd?.revision?.version) finalVersion = String(upd.revision.version);
                      finalRemoteSha = finalLocalSha;
                    } catch {
                      // Keep remoteSha256 pointing at createdSha so next sync pushes injected properties cleanly.
                    }
                  }
                }
                remember(file.path, {
                  userId: identity.userId, fileId: fid, bindingRevision: listing.bindingRevision,
                  version: finalVersion, sha256: finalLocalSha, remoteSha256: finalRemoteSha,
                  kind: created.file?.kind || (format === "canvas" ? "canvas" : format === "binary" ? "binary" : "markdown"),
                  canEdit: true, sourcePath: rel, propsVersion: 3, ...statMeta(vault.getAbstractFileByPath(file.path) || file),
                });
                remoteByLocalKey.set(file.path.normalize("NFC").toLowerCase(), created.file || { id: fid, path: rel });
                counts.created++;
                emit("created_remote", created.file || { id: fid, path: rel }, file.path, { sourcePath: rel });
              }
            } catch (err) {
              if (err?.code === "AUTH_REQUIRED" || err?.code === "ROOT_BINDING_CHANGED") fatal = err;
              else {
                counts.skipped++;
                failedCreates.set(file.path, { mtime: statMtime, size: statSize, reason: err?.code || "create_failed", retryAfter: Date.now() + 900_000 });
                emit("skipped", null, file.path, { reason: err?.code || "create_failed" });
              }
            } finally {
              report(++createDone, toCreate.length, "upload", file.path);
            }
          }
        }));
        if (fatal) throw fatal;
      }
    }

    for (const file of listing.files.filter(file => !copyable(file) && file?.kind !== "folder")) {
      counts.skipped++;
      emit("skipped", file, joinPrefix(file.path), { reason: "unsupported" });
    }
    counts.manifestSignature = await computeManifestSignature(listing);
    return counts;
  }

  // Fast 1-file Push (zero 480-file manifest scan when file is already tracked in baseline!).
  async function pushSingleFile({ file, baseline, createBindingRevision, getShareMeta = null, markInternalPath = () => {}, editorContent = null } = {}) {
    if (!(file instanceof TFile)) throw syncError("ACCESS_DENIED");
    const identity = getIdentity();
    if (!identity) throw syncError("AUTH_REQUIRED");
    const encoder = new TextEncoder();
    const isMd = /\.(?:md|markdown)$/i.test(file.path);
    if (RESERVED_LOCAL_ROOT.test(file.path) || IGNORED_LOCAL_FILE.test(file.path)) throw syncError("ACCESS_DENIED");
    const format = formatForExtension(file.path);
    if (!format) throw syncError("SYNC_UNAVAILABLE");

    let rawBytes;
    if (typeof editorContent === "string" && format !== "binary") {
      rawBytes = encoder.encode(editorContent);
    } else {
      rawBytes = new Uint8Array(await vault.readBinary(file));
    }
    if (format === "binary" ? rawBytes.byteLength > 8_388_608 : rawBytes.byteLength > 1_048_576) throw syncError("CONTENT_LIMIT");

    const buildPatch = fid => {
      const share = typeof getShareMeta === "function" ? getShareMeta(file.path, fid) : null;
      const siteUrl = siteVaultEditUrl(origin, fid);
      const driveUrl = driveViewUrl(fid);
      return {
        ...(siteUrl ? { site_url: siteUrl } : {}),
        ...(driveUrl ? { drive_url: driveUrl } : {}),
        ...(share?.shareUrl ? { share_url: share.shareUrl } : {}),
        ...(Array.isArray(share?.roles) ? { roles: share.roles } : {}),
        ...(typeof share?.isPublic === "boolean" ? { public: share.isPublic } : {}),
      };
    };

    if (baseline?.fileId && baseline.userId === identity.userId && baseline.kind !== "platform") {
      if (!baseline.canEdit) throw syncError("WRITE_DENIED");
      let uploadBytes = rawBytes;
      let decodedText = null;
      if (format !== "binary") {
        decodedText = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(rawBytes);
        if (isMd && ID.test(baseline.fileId)) {
          const nextText = upsertYamlProperties(decodedText, buildPatch(baseline.fileId), {
            parseYaml,
            unescapeBodyCallouts: shouldUnescapeCalloutsOnPath(file.path),
          });
          if (nextText !== decodedText) {
            decodedText = nextText;
            uploadBytes = encoder.encode(nextText);
            if (typeof editorContent !== "string") {
              markInternalPath(file.path);
              if (typeof vault.process === "function") await vault.process(file, () => nextText);
            }
          }
        }
      }
      const uploadSha = await hashBytes(uploadBytes);
      if (uploadSha === baseline.sha256 && uploadSha === (baseline.remoteSha256 || baseline.sha256)) {
        return { ok: true, status: "unchanged", fileId: baseline.fileId, version: baseline.version, path: file.path };
      }
      const expectedRemoteSha = baseline.remoteSha256 || baseline.sha256;
      const tryUpdate = async (ver, sha, contentToSend, bytesToSend) => {
        if (format === "binary") {
          return call(identity, {}, {
            action: "update", fileId: baseline.fileId, bindingRevision: baseline.bindingRevision,
            requestId: crypto.randomUUID(), format: "binary",
            expectedVersion: String(ver), expectedSha256: sha, base64: toBase64(bytesToSend),
          }, "drive-device-v1", { "x-fc-binary": "1" });
        }
        return call(identity, {}, {
          action: "update", fileId: baseline.fileId, bindingRevision: baseline.bindingRevision,
          requestId: crypto.randomUUID(), format,
          expectedVersion: String(ver), expectedSha256: sha, content: contentToSend,
        });
      };
      try {
        const res = await tryUpdate(baseline.version, expectedRemoteSha, decodedText, uploadBytes);
        const nextVersion = String(res.revision?.version || baseline.version);
        if (extOf(file.path) === "base" && decodedText !== null) cacheBaseText(baseline.fileId, file.path, decodedText);
        remember(file.path, {
          ...baseline, version: nextVersion, sha256: uploadSha, remoteSha256: uploadSha,
          propsVersion: 3, ...statMeta(vault.getAbstractFileByPath(file.path) || file),
        });
        return { ok: true, status: "uploaded", fileId: baseline.fileId, version: nextVersion, sha256: uploadSha, path: file.path };
      } catch (err) {
        if (err?.code === "WRITE_RESULT_UNKNOWN") {
          await new Promise(resolve => setTimeout(resolve, 1200));
          try {
            const checkRemote = await call(identity, { file: baseline.fileId, revision: baseline.bindingRevision });
            if (checkRemote?.sha256 === uploadSha && VERSION.test(checkRemote.revision?.version)) {
              const nextVersion = String(checkRemote.revision.version);
              if (extOf(file.path) === "base" && decodedText !== null) cacheBaseText(baseline.fileId, file.path, decodedText);
              remember(file.path, {
                ...baseline, version: nextVersion, sha256: uploadSha, remoteSha256: uploadSha,
                propsVersion: 3, ...statMeta(vault.getAbstractFileByPath(file.path) || file),
              });
              return { ok: true, status: "uploaded", fileId: baseline.fileId, version: nextVersion, sha256: uploadSha, path: file.path };
            }
          } catch {}
        }
        if (err?.code === "REVISION_CONFLICT" && extOf(file.path) === "base" && decodedText) {
          const remote = await call(identity, { file: baseline.fileId, revision: baseline.bindingRevision });
          if (typeof remote?.base64 === "string" && VERSION.test(remote.revision?.version) && SHA.test(remote.sha256)) {
            const remoteBytes = fromBase64(remote.base64);
            const remoteText = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(remoteBytes);
            const merged = mergeBaseYamlText(baseTextCache.get(baseline.fileId) ?? null, decodedText, remoteText, { preferLocal: true });
            if (merged) {
              const mergedBytes = encoder.encode(merged);
              const mergedSha = await hashBytes(mergedBytes);
              const res = await tryUpdate(remote.revision.version, remote.sha256, merged, mergedBytes);
              const nextVersion = String(res.revision?.version || remote.revision.version);
              markInternalPath(file.path);
              if (typeof vault.process === "function") await vault.process(file, () => merged);
              if (extOf(file.path) === "base") cacheBaseText(baseline.fileId, file.path, merged);
              remember(file.path, {
                ...baseline, version: nextVersion, sha256: mergedSha, remoteSha256: mergedSha,
                propsVersion: 3, ...statMeta(vault.getAbstractFileByPath(file.path) || file),
              });
              return { ok: true, status: "merged", fileId: baseline.fileId, version: nextVersion, sha256: mergedSha, content: merged, path: file.path };
            }
          }
        }
        throw err;
      }
    }

    // A new open Canvas already has the paired root revision. The server still checks the path, binding and write role.
    const preferred = getLocalRoot();
    const directCanvas = format === "canvas" && UUID.test(createBindingRevision || "") && preferred && file.path.startsWith(preferred + "/");
    const listing = directCanvas ? { canEdit: true, bindingRevision: createBindingRevision } : await manifest(identity);
    if (!listing.canEdit) throw syncError("WRITE_DENIED");
    const rel = preferred && file.path.startsWith(preferred + "/") ? file.path.slice(preferred.length + 1) : file.path;
    if (!rel || !validPath(rel) || EXCLUDED.test(file.path)) throw syncError("ACCESS_DENIED");
    const decodedText = format !== "binary" ? new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(rawBytes) : null;
    const payload = { action: "create", path: rel, bindingRevision: listing.bindingRevision, requestId: crypto.randomUUID(), format };
    if (format === "binary") payload.base64 = toBase64(rawBytes);
    else payload.content = decodedText;
    const created = await call(identity, {}, payload, "drive-device-v1", format === "binary" ? { "x-fc-binary": "1" } : {});
    const fid = created.fileId || created.file?.id;
    const localHash = await hashBytes(rawBytes);
    let finalVersion = String(created.revision?.version || "1");
    let finalSha = created.contentSha256 || localHash;
    let finalRemoteSha = finalSha;
    if (fid && isMd && decodedText !== null) {
      const nextText = upsertYamlProperties(decodedText, buildPatch(fid), {
        parseYaml,
        unescapeBodyCallouts: shouldUnescapeCalloutsOnPath(file.path),
      });
      if (nextText !== decodedText) {
        const nextBytes = encoder.encode(nextText);
        const nextSha = await hashBytes(nextBytes);
        markInternalPath(file.path);
        if (typeof vault.process === "function") await vault.process(file, () => nextText);
        finalSha = nextSha;
        try {
          const upd = await call(identity, {}, {
            action: "update", fileId: fid, bindingRevision: listing.bindingRevision,
            requestId: crypto.randomUUID(), format: "text",
            expectedVersion: finalVersion, expectedSha256: finalRemoteSha, content: nextText,
          });
          if (upd?.revision?.version) finalVersion = String(upd.revision.version);
          finalRemoteSha = finalSha;
        } catch {}
      }
    }
    if (fid) {
      remember(file.path, {
        userId: identity.userId, fileId: fid, bindingRevision: listing.bindingRevision,
        version: finalVersion, sha256: finalSha, remoteSha256: finalRemoteSha,
        kind: created.file?.kind || (format === "canvas" ? "canvas" : format === "binary" ? "binary" : "markdown"),
        canEdit: true, sourcePath: rel, propsVersion: 3, ...statMeta(vault.getAbstractFileByPath(file.path) || file),
      });
    }
    return { ok: true, status: "created", fileId: fid, version: finalVersion, sha256: finalSha, path: file.path };
  }

  // Fast 1-file Pull (zero 480-file manifest scan; safely archives unpushed local edits before updating!).
  async function pullSingleFile({ file, baseline, getShareMeta = null, markInternalPath = () => {}, archiveLocal = true } = {}) {
    if (!(file instanceof TFile) || !baseline?.fileId) throw syncError("ACCESS_DENIED");
    const identity = getIdentity();
    if (!identity || identity.userId !== baseline.userId) throw syncError("AUTH_REQUIRED");
    const encoder = new TextEncoder();
    const isMd = /\.(?:md|markdown)$/i.test(file.path);
    const remote = await call(identity, { file: baseline.fileId, revision: baseline.bindingRevision });
    if (remote.file?.id !== baseline.fileId || !VERSION.test(remote.revision?.version) || !SHA.test(remote.sha256) || typeof remote.base64 !== "string") {
      throw syncError("SYNC_UNAVAILABLE");
    }
    const remoteBuf = fromBase64(remote.base64);
    if (await hashBytes(remoteBuf) !== remote.sha256) throw syncError("CONTENT_MISMATCH");

    const localBytes = await vault.readBinary(file);
    const localHash = await hashBytes(localBytes);
    const textFile = isTextKind(remote.file.kind || baseline.kind);
    let fallbackText = null;
    if (textFile) {
      try { fallbackText = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(localBytes); } catch {}
    }
    let finalBytes = remoteBuf;
    let finalText = null;
    let healedFromGoogleDocs = false;
    if (textFile) {
      const rawRemoteText = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(remoteBuf);
      finalText = rawRemoteText;
      if (isMd && ID.test(baseline.fileId)) {
        const fm = splitFrontmatter(rawRemoteText);
        let fmParsed = null;
        if (fm.hasFrontmatter && fm.yaml.trim() && typeof parseYaml === "function") {
          try {
            const p = parseYaml(fm.yaml);
            if (p && typeof p === "object" && !Array.isArray(p)) fmParsed = p;
          } catch {}
        }
        const wasMangled = fm.hasFrontmatter && isGoogleDocsMangledFrontmatter(fm.yaml, fmParsed);
        const share = typeof getShareMeta === "function" ? getShareMeta(file.path, baseline.fileId) : null;
        const siteUrl = siteVaultEditUrl(origin, baseline.fileId);
        const driveUrl = driveViewUrl(baseline.fileId);
        finalText = upsertYamlProperties(rawRemoteText, {
          ...(siteUrl ? { site_url: siteUrl } : {}),
          ...(driveUrl ? { drive_url: driveUrl } : {}),
          ...(share?.shareUrl ? { share_url: share.shareUrl } : {}),
          ...(Array.isArray(share?.roles) ? { roles: share.roles } : {}),
          ...(typeof share?.isPublic === "boolean" ? { public: share.isPublic } : {}),
        }, {
          parseYaml,
          fallbackText,
          unescapeBodyCallouts: shouldUnescapeCalloutsOnPath(file.path),
        });
        healedFromGoogleDocs = Boolean(wasMangled && finalText !== rawRemoteText);
        const enc = encoder.encode(finalText);
        finalBytes = enc.buffer.slice(enc.byteOffset, enc.byteOffset + enc.byteLength);
      }
    }
    const finalSha = await hashBytes(finalBytes);
    let remoteVersion = String(remote.revision.version);
    let remoteSha256 = remote.sha256;
    if (healedFromGoogleDocs && finalText !== null && baseline.canEdit) {
      try {
        const upd = await call(identity, {}, {
          action: "update",
          fileId: baseline.fileId,
          bindingRevision: baseline.bindingRevision,
          requestId: crypto.randomUUID(),
          format: "text",
          expectedVersion: remoteVersion,
          expectedSha256: remoteSha256,
          content: finalText,
        });
        if (upd?.revision?.version) remoteVersion = String(upd.revision.version);
        remoteSha256 = finalSha;
      } catch {}
    }
    if (localHash === finalSha) {
      remember(file.path, {
        ...baseline, version: remoteVersion, sha256: finalSha, remoteSha256,
        propsVersion: 3, ...statMeta(file),
      });
      return { ok: true, status: "unchanged", fileId: baseline.fileId, version: remoteVersion, content: finalText, healedFromGoogleDocs, path: file.path };
    }
    let backupPath = null;
    if (archiveLocal && localHash !== baseline.sha256) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-") + "-" + Math.random().toString(36).slice(2, 6);
      const cleanRel = String(baseline.sourcePath || file.path).split("/").filter(seg => seg && seg !== "." && seg !== "..").join("/");
      const candidate = `FlightClub Sync Archive/manual-pull/${stamp}/${cleanRel}`;
      backupPath = candidate.length <= 230 ? candidate : `FlightClub Sync Archive/manual-pull/${stamp}-${cleanRel.split("/").at(-1).slice(-100)}`;
      const parts = backupPath.split("/").slice(0, -1);
      for (let i = 1; i <= parts.length; i++) {
        const p = parts.slice(0, i).join("/");
        if (!(vault.getAbstractFileByPath(p) instanceof TFolder)) {
          markInternalPath(p);
          await vault.createFolder(p);
        }
      }
      markInternalPath(backupPath);
      await vault.createBinary(backupPath, localBytes);
    }
    markInternalPath(file.path);
    if (textFile && typeof vault.process === "function") await vault.process(file, () => finalText);
    else if (typeof vault.modifyBinary === "function") await vault.modifyBinary(file, finalBytes);
    if (extOf(file.path) === "base" && finalText !== null) cacheBaseText(baseline.fileId, file.path, finalText);
    remember(file.path, {
      ...baseline, version: remoteVersion, sha256: finalSha, remoteSha256,
      propsVersion: 3, ...statMeta(vault.getAbstractFileByPath(file.path) || file),
    });
    return { ok: true, status: "downloaded", fileId: baseline.fileId, version: remoteVersion, backupPath, content: finalText, healedFromGoogleDocs, path: file.path };
  }

  return { preview, previewDesync, peekManifest, pull, sync, pushSingleFile, pullSingleFile, prepare, publish, pullPlatform, publishPlatform, platformHistory, inspect, resolveReview,
    clearReviews: () => reviews.clear() };
}

module.exports = {
  createDriveClient,
  hashBytes,
  md5Hex,
  toBase64,
  platformBinding,
  summarizePlatformNoteUpdate,
  mergeCanvasJsonText,
  canvasTextEquals,
  readCanvas,
  retainCanvasMedia,
  summarizeCanvasDiff,
  mergeCanvasBestEffort,
  mergeBaseYamlText,
};
