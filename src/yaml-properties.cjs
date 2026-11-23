"use strict";

const DRIVE_ID_RE = /^[A-Za-z0-9_-]{3,200}$/;
const DRIVE_FILE_URL_RE = /^https:\/\/(?:drive\.google\.com\/file|docs\.google\.com\/document)\/d\/([A-Za-z0-9_-]{3,200})(?:\/|$|\?)/i;
const SITE_VAULT_URL_RE = /^https:\/\/flightclub\.com\.ua\/markdown\b/i;

const KNOWN_FRONTMATTER_KEYS = [
  "додаткова інфа (чому не пройшов?)",
  "profile-number in responses",
  "profile-зібрати дрон хочу",
  "profile-краще всіх робить",
  "profile-заповнив форму",
  "profile-skill-language",
  "profile-skill-training",
  "profile-skill-rhetoric",
  "profile-навчати хочу",
  "profile-skill-flying",
  "profile-skill-пайка",
  "profile-skill-osint",
  "profile-skill-media",
  "profile-спеціальність",
  "profile - full name",
  "profile-skill-IT",
  "profile-очікування",
  "profile-про навички",
  "file-created date",
  "краще всіх робить",
  "посилання на відео",
  "Імʼя та прізвище",
  "Ім'я та прізвище",
  "Ім’я та прізвище",
  "00 заповнив анкету",
  "01 став в чергу",
  "02 почав навчання",
  "03 завершив навчання",
  "04 почав шукати роботу",
  "05 знайшов роботу",
  "06 знайшов альтушку",
  "07 знайшов альтушку",
  "видане обладнання",
  "зібрати дрон хочу",
  "номер в табличці",
  "profile-status",
  "profile-phone",
  "profile-notes",
  "profile-potik",
  "profile-mail",
  "status-profile",
  "польоти - skill",
  "навчати - skill",
  "rhetoric - skill",
  "language - skill",
  "номер телефону",
  "заповнив форму",
  "долучитись хочу",
  "status-потік",
  "status-event",
  "status-script",
  "пайка - skill",
  "osint - skill",
  "media - skill",
  "спеціальність",
  "навчати хочу",
  "номер потоку",
  "status-team",
  "про навички",
  "роботу хочу",
  "курс/освіта",
  "description",
  "event-city",
  "file-owner",
  "IT - skill",
  "очікування",
  "share_url",
  "drive_url",
  "cssclasses",
  "ітерація",
  "file-todo",
  "site_url",
  "category",
  "aliases",
  "summary",
  "version",
  "status",
  "source",
  "пошта",
  "місто",
  "public",
  "owner",
  "title",
  "roles",
  "tags",
  "date",
  "todo",
  "slug",
  "url",
];

const OBSIDIAN_CALLOUT_TYPES_RE = /^(?:[ \t]*(?:>[ \t]*)+)\\\[\\!(note|abstract|summary|tldr|info|todo|tip|hint|important|success|check|done|question|help|faq|warning|caution|attention|failure|fail|missing|danger|error|bug|example|quote|cite)\\\]/gim;
const SYSTEM_LAST_WINS_KEYS = new Set(["site_url", "drive_url", "share_url", "slug", "roles", "public"]);

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const KNOWN_KEYS_PATTERN = KNOWN_FRONTMATTER_KEYS.map(escapeRegExp).join("|");
const INLINE_KEY_BOUNDARY_RE = new RegExp(
  `^(?:${KNOWN_KEYS_PATTERN}|(?:item|event|user|fc|profile|status)-[A-Za-zА-Яа-яІіЇїЄєҐґ0-9_.-]{1,40})\\s*:(?=\\s|$)`,
);
const ESCAPED_YAML_KEY_RE = /(?:^|[\s\n])([A-Za-z0-9_.-]*\\_[A-Za-z0-9_.-]*)\s*:/;
const MD_LINK_IN_YAML_RE = /\[[^\]]*\]\((?:https?:\/\/|mailto:)[^)\s]+\)/i;
const ESCAPED_WIKILINK_RE = /\\\[\\\[/;
const COLLAPSED_LIST_KEY_RE = /^\s*-\s+[^\n]+\s+(?:site_url|drive_url|description|source|status|todo|date|owner|пошта|tags)\s*:/im;

function normalizeTopKey(rawKey) {
  return String(rawKey ?? "").replace(/\\_/g, "_").trim();
}

/**
 * Unescape Obsidian callout headers mangled by Google Docs (`> \[\!danger\]` -> `> [!danger]`).
 */
function unescapeObsidianCallouts(body) {
  return String(body ?? "").replace(OBSIDIAN_CALLOUT_TYPES_RE, (full, kind) => {
    const idx = full.indexOf("\\[\\!");
    return full.slice(0, idx) + `[!${kind}]`;
  });
}

/**
 * Detect whether a note's YAML frontmatter was corrupted by a Google Docs markdown export.
 */
function isGoogleDocsMangledFrontmatter(yamlText, parsed) {
  const yaml = String(yamlText ?? "");
  if (!yaml.trim()) return false;
  if (ESCAPED_YAML_KEY_RE.test(yaml) || MD_LINK_IN_YAML_RE.test(yaml) || ESCAPED_WIKILINK_RE.test(yaml)) {
    return true;
  }
  const hasBlankEdges = /^[ \t]*\r?\n|\r?\n[ \t]*$/.test(yaml);
  const hasCollapsedListKey = COLLAPSED_LIST_KEY_RE.test(yaml);
  if (hasCollapsedListKey) return true;
  const parseFailed = parsed === null;
  if (parseFailed && hasBlankEdges) return true;
  // Detect multiple inline properties collapsed onto one unquoted scalar line (even if PyYAML/Obsidian parses part of it)
  for (const line of yaml.split(/\r?\n/)) {
    if (!line || /^[ \t]/.test(line) || /^#/.test(line)) continue;
    const m = /^([A-Za-zА-Яа-яІіЇїЄєҐґ0-9_./()\s?-]+?)\s*:(.*)$/.exec(line);
    if (!m) {
      if (hasCollapsedListKey) return true;
      continue;
    }
    const rest = m[2].trim();
    if (!rest) continue;
    let inDq = false, inSq = false;
    for (let i = 0; i < rest.length; i++) {
      const ch = rest[i];
      if (inDq) {
        if (ch === "\\" && i + 1 < rest.length) { i++; continue; }
        if (ch === '"') inDq = false;
        continue;
      }
      if (inSq) {
        if (ch === "'" && rest[i + 1] === "'") { i++; continue; }
        if (ch === "'") inSq = false;
        continue;
      }
      if (ch === '"') { inDq = true; continue; }
      if (ch === "'") { inSq = true; continue; }
      if (/\s/.test(ch)) {
        let j = i;
        while (j < rest.length && /\s/.test(rest[j])) j++;
        if (j < rest.length && INLINE_KEY_BOUNDARY_RE.test(rest.slice(j))) {
          return true;
        }
      }
    }
  }
  return false;
}

function unescapeGoogleDocsFrontmatterText(yamlText) {
  let s = String(yamlText ?? "");
  // Convert markdown links back to raw URLs or email addresses before stripping escapes
  s = s.replace(/\[[^\]]*\]\((mailto:|https?:\/\/)([^)\s]+)\)/gi, (_, scheme, rest) =>
    scheme.toLowerCase() === "mailto:" ? rest : scheme + rest,
  );
  // Strip Google Docs markdown backslash escapes while keeping JSON \" intact
  s = s.replace(/\\([_:\\&\-*#|\+\.\[\]=!()])/g, "$1");
  return s;
}

function splitCollapsedFrontmatterLines(yamlText) {
  const out = [];
  for (const rawLine of String(yamlText ?? "").split(/\r?\n/)) {
    const trimmed = rawLine.replace(/[ \t]+$/g, "");
    if (!trimmed.trim()) continue;
    let curStart = 0;
    let inDq = false;
    let inSq = false;
    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (inDq) {
        if (ch === "\\" && i + 1 < trimmed.length) { i++; continue; }
        if (ch === '"') inDq = false;
        continue;
      }
      if (inSq) {
        if (ch === "'" && trimmed[i + 1] === "'") { i++; continue; }
        if (ch === "'") inSq = false;
        continue;
      }
      if (ch === '"') { inDq = true; continue; }
      if (ch === "'") { inSq = true; continue; }
      if (/\s/.test(ch)) {
        let j = i;
        while (j < trimmed.length && /\s/.test(trimmed[j])) j++;
        if (j > curStart && j < trimmed.length && INLINE_KEY_BOUNDARY_RE.test(trimmed.slice(j))) {
          const piece = trimmed.slice(curStart, i).trimEnd();
          if (piece.trim()) out.push(piece);
          curStart = j;
          i = j - 1;
        }
      }
    }
    const tail = trimmed.slice(curStart).trimEnd();
    if (tail.trim()) out.push(tail);
  }
  return out;
}

function needsYamlScalarQuotes(val) {
  if (!val) return false;
  if (/^["']/.test(val)) return false;
  if (/^\[\[/.test(val)) return true; // Wikilink must be quoted in YAML
  if (/^\[[^\]]*\]$/.test(val)) return false; // Flow sequence `[a, b]`
  if (val.includes(": ") || /:$/.test(val) || /\s#/.test(val)) return true;
  if (/^[*&!|>%@`,?{\-]/.test(val)) return true;
  if (/^\[/.test(val) && !/^\[[^[\]]*\]$/.test(val)) return true;
  return false;
}

function formatRecoveredPropertyLine(key, val) {
  const cleanVal = val.trim();
  if (!cleanVal) return `${key}:`;
  if (/^\[\[/.test(cleanVal)) return `${key}: ${JSON.stringify(cleanVal)}`;
  if ((cleanVal.startsWith('"') && cleanVal.endsWith('"')) || (cleanVal.startsWith("'") && cleanVal.endsWith("'"))) {
    return `${key}: ${cleanVal}`;
  }
  if (SYSTEM_LAST_WINS_KEYS.has(key) && /^https?:\/\//i.test(cleanVal)) {
    return `${key}: ${JSON.stringify(cleanVal)}`;
  }
  if (needsYamlScalarQuotes(cleanVal)) {
    return `${key}: ${JSON.stringify(cleanVal)}`;
  }
  return `${key}: ${cleanVal}`;
}

function rebuildCleanYamlLines(rawLines) {
  const entries = [];
  let inListKey = null;
  let inBlockKey = false;
  for (const line of rawLines) {
    if (inBlockKey && /^[ \t]{2,}\S/.test(line)) {
      const target = entries.at(-1);
      if (target && Array.isArray(target.blockLines)) {
        target.blockLines.push(line);
        continue;
      }
    }
    inBlockKey = false;
    const bulletMatch = /^\s*-\s+(.+)$/.exec(line);
    if (bulletMatch && inListKey) {
      const itemText = bulletMatch[1].trim();
      const target = entries.at(-1);
      if (target && target.key === inListKey && Array.isArray(target.list)) {
        if (!target.list.includes(itemText)) target.list.push(itemText);
        continue;
      }
    }
    const kvMatch = /^([^:\n]+?)\s*:(.*)$/.exec(line);
    if (!kvMatch) {
      inListKey = null;
      continue;
    }
    const key = normalizeTopKey(kvMatch[1]);
    const val = kvMatch[2].trim();
    if (!key) { inListKey = null; continue; }
    if (val === "|" || val === "|-" || val === ">" || val === ">-") {
      inListKey = null;
      inBlockKey = true;
      entries.push({ key, val, blockLines: [] });
    } else if (key === "tags" && !val) {
      inListKey = "tags";
      entries.push({ key, list: [] });
    } else {
      inListKey = (!val && (key === "aliases" || key === "roles" || key === "cssclasses")) ? key : null;
      entries.push(inListKey ? { key, list: [] } : { key, val });
    }
  }

  // Deduplicate repeated keys: system links keep last occurrence, user fields keep first non-empty occurrence
  const chosen = new Map();
  const orderedKeys = [];
  for (const entry of entries) {
    if (!chosen.has(entry.key)) {
      orderedKeys.push(entry.key);
      chosen.set(entry.key, entry);
      continue;
    }
    const prev = chosen.get(entry.key);
    if (SYSTEM_LAST_WINS_KEYS.has(entry.key)) {
      chosen.set(entry.key, entry);
    } else if (prev.list && entry.list) {
      for (const item of entry.list) if (!prev.list.includes(item)) prev.list.push(item);
    } else if (!prev.val && (entry.val || entry.blockLines?.length)) {
      chosen.set(entry.key, entry);
    }
  }

  const lines = [];
  for (const key of orderedKeys) {
    const entry = chosen.get(key);
    if (entry.list) {
      lines.push(`${key}:`);
      for (const item of entry.list) lines.push(`  - ${item}`);
    } else if (Array.isArray(entry.blockLines)) {
      lines.push(`${key}: ${entry.val}`);
      for (const bl of entry.blockLines) lines.push(bl);
    } else {
      lines.push(formatRecoveredPropertyLine(key, entry.val));
    }
  }
  return lines;
}

/**
 * Repair YAML frontmatter corrupted when a markdown file was edited/exported by Google Docs.
 * Prefers lossless frontmatter restoration from `fallbackText` when valid, then falls back
 * to deterministic heuristic recovery and key deduplication.
 */
function repairGoogleDocsFrontmatter(rawText, { fallbackText = null, parseYaml, unescapeBodyCallouts = false } = {}) {
  const input = String(rawText ?? "");
  const parts = splitFrontmatter(input);
  if (!parts.hasFrontmatter) {
    return { text: input, repaired: false, method: null };
  }
  let parsed = undefined;
  if (typeof parseYaml === "function" && parts.yaml.trim()) {
    try {
      const p = parseYaml(parts.yaml);
      parsed = p && typeof p === "object" && !Array.isArray(p) ? p : null;
    } catch {
      parsed = null;
    }
  }
  if (!isGoogleDocsMangledFrontmatter(parts.yaml, parsed)) {
    return { text: input, repaired: false, method: null };
  }

  const nl = parts.newline;
  const nextBody = unescapeBodyCallouts ? unescapeObsidianCallouts(parts.body) : parts.body;

  // Priority 1: Lossless frontmatter recovery from clean pre-edit baseline
  if (typeof fallbackText === "string" && fallbackText.trim()) {
    const fb = splitFrontmatter(fallbackText);
    if (fb.hasFrontmatter && fb.yaml.trim()) {
      let fbParsed = undefined;
      if (typeof parseYaml === "function") {
        try {
          const p = parseYaml(fb.yaml);
          fbParsed = p && typeof p === "object" && !Array.isArray(p) ? p : null;
        } catch {
          fbParsed = null;
        }
      }
      if (!isGoogleDocsMangledFrontmatter(fb.yaml, fbParsed) && (typeof parseYaml !== "function" || fbParsed)) {
        const cleanFbYaml = fb.yaml.replace(/\r?\n/g, nl).trimEnd();
        const rebuilt = `${parts.bom}---${nl}${cleanFbYaml}${nl}---${nl}${nextBody}`;
        return { text: rebuilt, repaired: true, method: "baseline" };
      }
    }
  }

  // Priority 2: Deterministic heuristic recovery
  const unescaped = unescapeGoogleDocsFrontmatterText(parts.yaml);
  const splitLines = splitCollapsedFrontmatterLines(unescaped);
  const recoveredLines = rebuildCleanYamlLines(splitLines);
  if (!recoveredLines.length) {
    return { text: input, repaired: false, method: null };
  }
  const candidateYaml = recoveredLines.join(nl);
  if (typeof parseYaml === "function") {
    try {
      const check = parseYaml(candidateYaml);
      if (!check || typeof check !== "object" || Array.isArray(check)) {
        return { text: input, repaired: false, method: null };
      }
    } catch {
      return { text: input, repaired: false, method: null };
    }
  }
  const rebuilt = `${parts.bom}---${nl}${candidateYaml}${nl}---${nl}${nextBody}`;
  return { text: rebuilt, repaired: rebuilt !== input, method: "heuristic" };
}

function splitFrontmatter(raw) {
  const text = String(raw ?? "");
  const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
  const clean = bom ? text.slice(1) : text;
  const start = /^---\r?\n/.exec(clean);
  if (!start) return { bom, frontmatterBlock: "", yaml: "", newline: clean.includes("\r\n") ? "\r\n" : "\n", body: clean, hasFrontmatter: false };
  const remainder = clean.slice(start[0].length);
  if (/^---[ \t]*(?:\r?\n|$)/.test(remainder)) {
    const emptyEnd = /^---[ \t]*(?:\r?\n|$)/.exec(remainder);
    const cut = bom.length + start[0].length + emptyEnd[0].length;
    return {
      bom,
      frontmatterBlock: text.slice(0, cut),
      yaml: "",
      newline: start[0].includes("\r\n") ? "\r\n" : "\n",
      body: text.slice(cut),
      hasFrontmatter: true,
    };
  }
  const end = /\r?\n---[ \t]*(?:\r?\n|$)/.exec(remainder);
  if (!end) return { bom, frontmatterBlock: "", yaml: "", newline: clean.includes("\r\n") ? "\r\n" : "\n", body: clean, hasFrontmatter: false };
  const cut = bom.length + start[0].length + end.index + end[0].length;
  return {
    bom,
    frontmatterBlock: text.slice(0, cut),
    yaml: remainder.slice(0, end.index),
    newline: start[0].includes("\r\n") ? "\r\n" : "\n",
    body: text.slice(cut),
    hasFrontmatter: true,
  };
}

function formatYamlValue(value) {
  if (Array.isArray(value)) {
    const items = value.map(item => {
      const str = String(item ?? "").trim();
      return /^[A-Za-z0-9_-]+$/.test(str) ? str : JSON.stringify(str);
    });
    return "[" + items.join(", ") + "]";
  }
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (value === null || value === undefined) return "null";
  return JSON.stringify(String(value));
}

function isPlatformFrontmatter(yamlText, parsed) {
  if (parsed?.["fc-schema"] === 2 || /^fc-schema\s*:\s*2(?:\s|$)/m.test(yamlText)) return true;
  if (typeof parsed?.["item-link"] === "string" && /[?&]item=[0-9a-f-]{36}\b/i.test(parsed["item-link"])) return true;
  if (typeof parsed?.["event-link"] === "string" && /[?&]e=[0-9a-f-]{36}\b/i.test(parsed["event-link"])) return true;
  return /^item-link\s*:[^\n]*[?&]item=[0-9a-f-]{36}\b|^event-link\s*:[^\n]*[?&]e=[0-9a-f-]{36}\b/im.test(yamlText);
}

function hasAmbiguousGoogleDocsFrontmatter(rawText) {
  const clean = String(rawText ?? "").replace(/^\uFEFF/, "");
  if (splitFrontmatter(clean).hasFrontmatter) return false;
  if (/^---[ \t]*(?:\r?\n|$)/.test(clean)) return true;
  const head = clean.split(/\r?\n/).slice(0, 25).join("\n");
  if (ESCAPED_YAML_KEY_RE.test(head)) return true;
  if (/\[[^\]]*\]\(https:\/\/(?:flightclub\.com\.ua\/markdown\?view=vault|drive\.google\.com\/file\/d\/|docs\.google\.com\/document\/d\/)/i.test(head)) {
    return true;
  }
  if (/^(?:site_url|drive_url|share_url)\s*:/im.test(head)) return true;
  return false;
}

function isUnrepairableDocsFrontmatter(rawText, { fallbackText = null, parseYaml } = {}) {
  const input = String(rawText ?? "");
  if (hasAmbiguousGoogleDocsFrontmatter(input)) return true;
  const parts = splitFrontmatter(input);
  if (!parts.hasFrontmatter || !parts.yaml.trim()) return false;
  let parsed = undefined;
  if (typeof parseYaml === "function") {
    try {
      const p = parseYaml(parts.yaml);
      parsed = p && typeof p === "object" && !Array.isArray(p) ? p : null;
    } catch {
      parsed = null;
    }
  }
  if (!isGoogleDocsMangledFrontmatter(parts.yaml, parsed)) return false;
  const healed = repairGoogleDocsFrontmatter(input, { fallbackText, parseYaml });
  if (!healed.repaired) return true;
  const after = splitFrontmatter(healed.text);
  if (!after.hasFrontmatter) return true;
  if (typeof parseYaml === "function") {
    try {
      const pAfter = parseYaml(after.yaml);
      if (!pAfter || typeof pAfter !== "object" || Array.isArray(pAfter)) return true;
    } catch {
      return true;
    }
  }
  return false;
}

/**
 * Insert, update, or remove top-level YAML frontmatter properties while preserving
 * all unrelated keys, multiline YAML lists, comments, and body content verbatim.
 * Automatically repairs Google-Docs-mangled frontmatter before applying patches so
 * site_url / drive_url properties are never duplicated.
 */
function upsertYamlProperties(
  rawText,
  patch,
  { removeKeys = [], skipPlatform = true, parseYaml, fallbackText = null, unescapeBodyCallouts = false } = {},
) {
  const input = String(rawText ?? "");
  if (!patch || typeof patch !== "object") return input;
  let working = input;
  let parts = splitFrontmatter(working);
  let parsed = undefined;
  const tryParse = yaml => {
    if (typeof parseYaml !== "function") return undefined;
    if (!yaml.trim()) return null;
    try {
      const p = parseYaml(yaml);
      return p && typeof p === "object" && !Array.isArray(p) ? p : null;
    } catch {
      return null;
    }
  };
  if (!parts.hasFrontmatter && hasAmbiguousGoogleDocsFrontmatter(working)) {
    return input;
  }
  if (parts.hasFrontmatter && parts.yaml.trim()) {
    parsed = tryParse(parts.yaml);
    if (skipPlatform && isPlatformFrontmatter(parts.yaml, parsed)) {
      return input;
    }
    if (isGoogleDocsMangledFrontmatter(parts.yaml, parsed)) {
      const healed = repairGoogleDocsFrontmatter(working, { fallbackText, parseYaml, unescapeBodyCallouts });
      if (healed.repaired && healed.text !== working) {
        working = healed.text;
        parts = splitFrontmatter(working);
        parsed = tryParse(parts.yaml);
      } else {
        // Unrepairable Google-Docs-corrupted YAML must NOT receive duplicate trailing site_url/drive_url lines.
        return input;
      }
    }
  }

  const removeSet = new Set(Array.isArray(removeKeys) ? removeKeys : []);
  const entries = Object.entries(patch).filter(([key, value]) => key && value !== undefined && !removeSet.has(key));
  if (!entries.length && !removeSet.size) return working === input ? input : working;

  // Fast check: if frontmatter is clean, already matches every desired scalar/array via parseYaml, and has no removed keys, skip rewrite
  if (parsed && typeof parsed === "object" && entries.length && !isGoogleDocsMangledFrontmatter(parts.yaml, parsed)) {
    const matchesAll = entries.every(([key, value]) => {
      const existing = parsed[key];
      if (Array.isArray(value)) {
        return Array.isArray(existing) && existing.length === value.length && existing.every((v, i) => String(v) === String(value[i]));
      }
      return existing === value;
    });
    const hasRemoved = [...removeSet].some(k => Object.prototype.hasOwnProperty.call(parsed, k));
    if (matchesAll && !hasRemoved) return working === input ? input : working;
  }

  const nl = parts.newline;
  const lines = parts.yaml ? parts.yaml.split(/\r?\n/) : [];
  const nextLines = [];
  const patchMap = new Map(entries);
  const handled = new Set();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const keyMatch = /^([A-Za-z0-9_.-]+(?:\\_[A-Za-z0-9_.-]+)*)\s*:(.*)$/.exec(line);
    if (!keyMatch) {
      nextLines.push(line);
      continue;
    }
    const rawKey = keyMatch[1];
    const key = normalizeTopKey(rawKey);
    // Collect any indented continuation lines (or unindented list items `- ...`) belonging to this key
    let endIdx = i;
    const valInline = keyMatch[2].trim();
    const blockScalar = valInline === "|" || valInline === ">" || valInline === "|-" || valInline === ">-";
    if (!valInline || blockScalar) {
      while (endIdx + 1 < lines.length) {
        const nextLine = lines[endIdx + 1];
        if (/^[A-Za-z0-9_.-]+(?:\\_[A-Za-z0-9_.-]+)*\s*:/.test(nextLine)) break;
        if (blockScalar ? /^(?:[ \t]+|$)/.test(nextLine) : /^(?:[ \t]+\S|-\s)/.test(nextLine)) {
          endIdx++;
          continue;
        }
        break;
      }
    }
    if (removeSet.has(key)) {
      i = endIdx;
      continue;
    }
    if (patchMap.has(key)) {
      if (!handled.has(key)) {
        nextLines.push(`${key}: ${formatYamlValue(patchMap.get(key))}`);
        handled.add(key);
      }
      i = endIdx;
      continue;
    }
    for (let j = i; j <= endIdx; j++) nextLines.push(lines[j]);
    i = endIdx;
  }

  for (const [key, value] of entries) {
    if (!handled.has(key)) {
      nextLines.push(`${key}: ${formatYamlValue(value)}`);
    }
  }

  while (nextLines.length && !nextLines[nextLines.length - 1].trim()) nextLines.pop();
  if (!nextLines.length) {
    return parts.hasFrontmatter ? parts.bom + parts.body : (working === input ? input : working);
  }
  const rebuilt = `${parts.bom}---${nl}${nextLines.join(nl)}${nl}---${nl}${parts.body}`;
  return rebuilt === input ? input : rebuilt;
}

/**
 * Google Docs edit URL for markdown/document files stored on Google Drive.
 */
function docsEditUrl(fileId) {
  const id = String(fileId ?? "").trim();
  if (!DRIVE_ID_RE.test(id)) return null;
  return `https://docs.google.com/document/d/${encodeURIComponent(id)}/edit`;
}

/**
 * Direct Google Drive viewer URL for non-document binary assets (PDFs, images, audio).
 */
function driveRawFileUrl(fileId) {
  const id = String(fileId ?? "").trim();
  if (!DRIVE_ID_RE.test(id)) return null;
  return `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`;
}

/**
 * Default external Drive/Docs URL injected into `.md` `drive_url` YAML properties.
 */
function driveViewUrl(fileId) {
  return docsEditUrl(fileId);
}

function siteVaultEditUrl(origin, fileId) {
  const id = String(fileId ?? "").trim();
  const base = String(origin || "https://flightclub.com.ua").replace(/\/+$/, "");
  if (!DRIVE_ID_RE.test(id)) return null;
  return `${base}/markdown?view=vault&file=${encodeURIComponent(id)}&edit=1`;
}

function extractDriveIdFromMeta(meta) {
  if (!meta || typeof meta !== "object") return null;
  for (const field of ["drive_url", "site_url", "drive_id"]) {
    const raw = meta[field];
    if (typeof raw !== "string" || !raw.trim()) continue;
    const trimmed = raw.trim();
    if (field === "drive_id" && DRIVE_ID_RE.test(trimmed)) return trimmed;
    const gMatch = DRIVE_FILE_URL_RE.exec(trimmed);
    if (gMatch?.[1] && DRIVE_ID_RE.test(gMatch[1])) return gMatch[1];
    try {
      const url = new URL(trimmed);
      if (SITE_VAULT_URL_RE.test(trimmed)) {
        const fid = url.searchParams.get("file");
        if (fid && DRIVE_ID_RE.test(fid)) return fid;
      }
    } catch {}
  }
  return null;
}

module.exports = {
  splitFrontmatter,
  upsertYamlProperties,
  isGoogleDocsMangledFrontmatter,
  hasAmbiguousGoogleDocsFrontmatter,
  isUnrepairableDocsFrontmatter,
  repairGoogleDocsFrontmatter,
  unescapeObsidianCallouts,
  docsEditUrl,
  driveRawFileUrl,
  driveViewUrl,
  siteVaultEditUrl,
  extractDriveIdFromMeta,
};
