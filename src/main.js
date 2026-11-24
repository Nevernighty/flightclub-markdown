"use strict";

const obsidian = require("obsidian");
const { MarkdownView, Menu, Modal, Notice, Platform, Plugin, TFile, TFolder, requestUrl } = obsidian;
/*__FC_TREE_SYNC__*/
/*__FC_TEAM_PLUGINS__*/
/*__FC_EVENT_PUBLISH__*/
/*__FC_DIRECT_PLUGIN_INSTALLER__*/
/*__FC_PLUGIN_UPDATE__*/
/*__FC_MARKDOWN_MEDIA__*/
/*__FC_MARKDOWN_DIFF__*/
const PLUGIN_VERSION = "1.11.1";
const SHARED_FOLDER = "FlightClub Shared/";
const SYNC_ARCHIVE_PREFIX = "FlightClub Sync Archive";
const DEFAULT_HUB_CITIES = ["Київ", "Житомир", "Луцьк", "Львів"];

function driveOpenUrlForPath(fileId, filePath = "") {
  const cleanId = String(fileId || "").trim();
  if (!cleanId) return null;
  const p = String(filePath || "").trim();
  const isMd = !p || /\.(?:md|markdown)$/i.test(p);
  if (typeof FC_YAML_PROPS !== "undefined") {
    return isMd ? FC_YAML_PROPS.docsEditUrl(cleanId) : FC_YAML_PROPS.driveRawFileUrl(cleanId);
  }
  const encoded = encodeURIComponent(cleanId);
  return isMd
    ? `https://docs.google.com/document/d/${encoded}/edit`
    : `https://drive.google.com/file/d/${encoded}/view`;
}

function isSyncArchivePath(filePath) {
  return typeof filePath === "string" && (
    filePath === SYNC_ARCHIVE_PREFIX ||
    filePath.startsWith(SYNC_ARCHIVE_PREFIX + "/")
  );
}

function isTemplateOrArchivePath(filePath) {
  if (!filePath || typeof filePath !== "string") return true;
  if (isSyncArchivePath(filePath)) return true;
  return /(?:^|\/)(?:\.trash|Templates|other\/Templates)(?:\/|$)/i.test(filePath);
}

const EQUIPMENT_STATUS_META = {
  available: { key: "available", short: "вільно", label: "вільно", fullLabel: "Вільно", cls: "is-available", dot: "🟢" },
  issued: { key: "issued", short: "на руках", label: "на руках", fullLabel: "На руках", cls: "is-issued", dot: "🟠" },
  loaned: { key: "issued", short: "на руках", label: "на руках", fullLabel: "На руках", cls: "is-issued", dot: "🟠" },
  event: { key: "event", short: "на івенті", label: "на івенті", fullLabel: "На івенті", cls: "is-event", dot: "🔵" },
  repair: { key: "repair", short: "ремонт", label: "ремонт", fullLabel: "У ремонті", cls: "is-repair", dot: "🔴" },
  maintenance: { key: "repair", short: "ремонт", label: "ремонт", fullLabel: "У ремонті", cls: "is-repair", dot: "🔴" },
  lost: { key: "lost", short: "втрачено", label: "втрачено", fullLabel: "Втрачено / списано", cls: "is-lost", dot: "⚫" },
  written_off: { key: "lost", short: "втрачено", label: "втрачено", fullLabel: "Втрачено / списано", cls: "is-lost", dot: "⚫" },
  retired: { key: "lost", short: "втрачено", label: "втрачено", fullLabel: "Втрачено / списано", cls: "is-lost", dot: "⚫" },
};
const CANONICAL_EQUIPMENT_STATUSES = [
  EQUIPMENT_STATUS_META.available,
  EQUIPMENT_STATUS_META.issued,
  EQUIPMENT_STATUS_META.event,
  EQUIPMENT_STATUS_META.repair,
  EQUIPMENT_STATUS_META.lost,
];

function normalizeEquipmentStatus(raw) {
  if (!raw || typeof raw !== "string") return null;
  const k = raw.trim().toLowerCase();
  if (EQUIPMENT_STATUS_META[k]) return EQUIPMENT_STATUS_META[k];
  if (k === "вільно" || k === "доступно") return EQUIPMENT_STATUS_META.available;
  if (k === "на руках" || k === "видано") return EQUIPMENT_STATUS_META.issued;
  if (k === "на івенті" || k === "івент") return EQUIPMENT_STATUS_META.event;
  if (k === "ремонт" || k === "у ремонті") return EQUIPMENT_STATUS_META.repair;
  if (k === "втрачено" || k === "списано") return EQUIPMENT_STATUS_META.lost;
  return null;
}

const PERSON_FUNNEL_META = {
  job: { key: "person-job", label: "робота", fullLabel: "Етап 05: знайшов роботу", cls: "is-p-job", dot: "💼" },
  searching: { key: "person-searching", label: "шукає", fullLabel: "Етап 04: почав шукати роботу", cls: "is-p-searching", dot: "🔍" },
  graduated: { key: "person-graduated", label: "випуск", fullLabel: "Етап 03: завершив навчання", cls: "is-p-graduated", dot: "✅" },
  learning: { key: "person-learning", label: "навчання", fullLabel: "Етап 02: почав навчання", cls: "is-p-learning", dot: "🎓" },
  queue: { key: "person-queue", label: "черга", fullLabel: "Етап 01: став у чергу на навчання", cls: "is-p-queue", dot: "⏳" },
  form: { key: "person-form", label: "анкета", fullLabel: "Етап 00: заповнив анкету", cls: "is-p-form", dot: "📝" },
  nodrone: { key: "person-nodrone", label: "без дрона", fullLabel: "Етап -01: не відправили дрон", cls: "is-p-nodrone", dot: "⛔" },
  altushka: { key: "person-altushka", label: "альтушка", fullLabel: "Етап 07: знайшов альтушку", cls: "is-p-altushka", dot: "💜" },
  team: { key: "person-team", label: "команда", fullLabel: "Долучився до команди FlightClub", cls: "is-p-team", dot: "⭐" },
  unknown: { key: "person-unknown", label: "невідомо", fullLabel: "Етап воронки невідомий", cls: "is-p-muted", dot: "❓" },
};

const TEAM_STATUS_META = {
  admin: { key: "team-admin", label: "адмін FC", fullLabel: "Команда: адмінкоманда FlightClub", cls: "is-p-team", dot: "⚡" },
  instructor: { key: "team-instructor", label: "інструктор", fullLabel: "Команда: інструктор FlightClub", cls: "is-p-instructor", dot: "🛡️" },
  hub: { key: "team-hub", label: "осередок", fullLabel: "Команда: координатор осередку FC", cls: "is-p-hub", dot: "📍" },
  partner: { key: "team-partner", label: "партнер", fullLabel: "Команда: став партнером FlightClub", cls: "is-p-job", dot: "🤝" },
  apply: { key: "team-apply", label: "заявка", fullLabel: "Рекрутинг 01: хоче приєднатись до команди", cls: "is-p-form", dot: "📩" },
  contacted: { key: "team-contacted", label: "написали", fullLabel: "Рекрутинг 02: написали кандидату", cls: "is-p-queue", dot: "💬" },
  interview: { key: "team-interview", label: "співбесіда", fullLabel: "Рекрутинг: очікує / скоро співбесіда", cls: "is-p-searching", dot: "🗓️" },
  test: { key: "team-test", label: "тестове", fullLabel: "Рекрутинг: виконує тестове завдання", cls: "is-p-learning", dot: "🧪" },
  paused: { key: "team-paused", label: "пауза", fullLabel: "Рекрутинг 00: на паузі", cls: "is-p-muted", dot: "⏸️" },
  left: { key: "team-left", label: "пішов", fullLabel: "Рекрутинг 04: пішов з команди", cls: "is-p-nodrone", dot: "🚪" },
  rejected: { key: "team-rejected", label: "відмова", fullLabel: "Рекрутинг: не підійшов", cls: "is-p-nodrone", dot: "⛔" },
};

const PLATFORM_ROLE_META = {
  superadmin: { key: "role-admax", label: "ADMAX", fullLabel: "Роль на платформі: ADMAX (суперадмін)", cls: "is-p-admax", dot: "👑" },
  admin: { key: "role-admin", label: "адмін", fullLabel: "Роль на платформі: Адміністратор", cls: "is-p-team", dot: "⚡" },
  miniadmin: { key: "role-miniadmin", label: "мініадмін", fullLabel: "Роль на платформі: Мініадмін", cls: "is-p-team", dot: "⚡" },
  instructor: { key: "role-instructor", label: "інструктор", fullLabel: "Роль на платформі: Інструктор", cls: "is-p-instructor", dot: "🛡️" },
  mentor: { key: "role-mentor", label: "ментор", fullLabel: "Роль на платформі: Ментор", cls: "is-p-hub", dot: "🧭" },
  miltech: { key: "role-miltech", label: "мілтех", fullLabel: "Роль на платформі: Мілтех", cls: "is-p-graduated", dot: "🔧" },
  partner: { key: "role-partner", label: "партнер", fullLabel: "Роль на платформі: Партнер", cls: "is-p-job", dot: "🤝" },
  cadet: { key: "role-cadet", label: "курсант", fullLabel: "Роль на платформі: Курсант", cls: "is-p-learning", dot: "🎓" },
  user: { key: "role-user", label: "учасник", fullLabel: "Роль на платформі: Учасник", cls: "is-p-user", dot: "👤" },
  quarantine: { key: "role-quarantine", label: "карантин", fullLabel: "Роль на платформі: На модерації (карантин)", cls: "is-p-queue", dot: "⏳" },
  guest: { key: "role-guest", label: "гість", fullLabel: "Роль на платформі: Гість", cls: "is-p-muted", dot: "👋" },
  banned: { key: "role-banned", label: "бан", fullLabel: "Статус на платформі: Заблоковано", cls: "is-p-nodrone", dot: "⛔" },
};

const CANONICAL_PERSON_STATUSES = [
  PERSON_FUNNEL_META.job,
  PERSON_FUNNEL_META.searching,
  PERSON_FUNNEL_META.graduated,
  PERSON_FUNNEL_META.learning,
  PERSON_FUNNEL_META.queue,
  PERSON_FUNNEL_META.form,
  PERSON_FUNNEL_META.nodrone,
  PERSON_FUNNEL_META.team,
  TEAM_STATUS_META.instructor,
  PLATFORM_ROLE_META.miltech,
  PLATFORM_ROLE_META.cadet,
  PLATFORM_ROLE_META.user,
];

function extractFrontmatterString(val) {
  if (typeof val === "string") return val.trim();
  if (Array.isArray(val)) {
    const first = val.find(v => typeof v === "string" && v.trim());
    return first ? first.trim() : "";
  }
  return "";
}

function abbreviateStatusLabel(raw) {
  const clean = String(raw || "").replace(/^[-+]?\d+\s+/, "").trim();
  if (!clean) return "";
  const words = clean.split(/\s+/).filter(Boolean);
  if (clean.length <= 13) return clean.toLowerCase();
  if (words.length >= 2 && (words[0].length + words[1].length + 1) <= 13) {
    return `${words[0]} ${words[1]}`.toLowerCase();
  }
  return words[0].slice(0, 12).toLowerCase() + (words[0].length > 12 ? "…" : "");
}

function normalizeCadetFunnelStatus(raw) {
  const clean = extractFrontmatterString(raw);
  if (!clean || clean === "(n/a)" || clean === "n/a" || clean === "—") return null;
  const k = clean.toLowerCase().replace(/\s+/g, " ");
  if (k.includes("знайшов роботу") || k.includes("знайшла роботу") || /^05\b/.test(k)) return { ...PERSON_FUNNEL_META.job, raw: clean };
  if (k.includes("шукати роботу") || k.includes("шукає роботу") || /^04\b/.test(k)) return { ...PERSON_FUNNEL_META.searching, raw: clean };
  if (k.includes("завершив навчання") || k.includes("завершила навчання") || /^03\b/.test(k)) return { ...PERSON_FUNNEL_META.graduated, raw: clean };
  if (k.includes("почав навчання") || k.includes("почала навчання") || /^02\b/.test(k)) return { ...PERSON_FUNNEL_META.learning, raw: clean };
  if (k.includes("став в чергу") || k.includes("стала в чергу") || k.includes("в черзі") || /^01\b/.test(k)) return { ...PERSON_FUNNEL_META.queue, raw: clean };
  if (k.includes("заповнив анкету") || k.includes("заповнила анкету") || /^00\b/.test(k)) return { ...PERSON_FUNNEL_META.form, raw: clean };
  if (k.includes("не відправили дрон") || k.includes("без дрона") || /^-01\b/.test(k)) return { ...PERSON_FUNNEL_META.nodrone, raw: clean };
  if (k.includes("альтушк") || /^07\b/.test(k)) return { ...PERSON_FUNNEL_META.altushka, raw: clean };
  if (k.includes("долучився до команди") || k.includes("долучилась до команди") || k.includes("в команді")) return { ...PERSON_FUNNEL_META.team, raw: clean };
  if (k === "невідомо" || k === "unknown") return { ...PERSON_FUNNEL_META.unknown, raw: clean };
  return {
    key: "person-custom",
    label: abbreviateStatusLabel(clean),
    fullLabel: `Етап воронки: ${clean}`,
    cls: "is-p-muted",
    dot: "🏷️",
    raw: clean,
  };
}

function normalizeTeamStatus(raw) {
  const clean = extractFrontmatterString(raw);
  if (!clean || clean === "(n/a)" || clean === "n/a" || clean === "—") return null;
  const k = clean.toLowerCase().replace(/\s+/g, " ");
  if (k.includes("адмінкоманд")) return { ...TEAM_STATUS_META.admin, raw: clean };
  if (k.includes("інструктор") || k.includes("нструктор")) return { ...TEAM_STATUS_META.instructor, raw: clean };
  if (k.includes("осередок") || k.includes("середок")) return { ...TEAM_STATUS_META.hub, raw: clean };
  if (k.includes("партнер")) return { ...TEAM_STATUS_META.partner, raw: clean };
  if (k.includes("хоче приєднат")) return { ...TEAM_STATUS_META.apply, raw: clean };
  if (k.includes("написали")) return { ...TEAM_STATUS_META.contacted, raw: clean };
  if (k.includes("співбесід")) return { ...TEAM_STATUS_META.interview, raw: clean };
  if (k.includes("тестов")) return { ...TEAM_STATUS_META.test, raw: clean };
  if (k.includes("пауз")) return { ...TEAM_STATUS_META.paused, raw: clean };
  if (k.includes("пішов") || k.includes("пішла")) return { ...TEAM_STATUS_META.left, raw: clean };
  if (k.includes("не підійшов") || k.includes("не підійшла")) return { ...TEAM_STATUS_META.rejected, raw: clean };
  return {
    key: "team-custom",
    label: abbreviateStatusLabel(clean),
    fullLabel: `Команда: ${clean}`,
    cls: "is-p-muted",
    dot: "🏷️",
    raw: clean,
  };
}

function normalizePlatformPersonRoles(roles) {
  const list = Array.isArray(roles)
    ? roles.map(r => String(r || "").trim().toLowerCase()).filter(Boolean)
    : (typeof roles === "string" && roles.trim() ? [roles.trim().toLowerCase()] : []);
  if (!list.length) return null;
  const priority = ["superadmin", "admin", "miniadmin", "instructor", "mentor", "miltech", "partner", "cadet", "user", "quarantine", "guest", "banned"];
  const picked = priority.find(r => list.includes(r)) || list[0];
  const meta = PLATFORM_ROLE_META[picked] || {
    key: `role-${picked}`,
    label: abbreviateStatusLabel(picked),
    fullLabel: `Роль на платформі: ${picked}`,
    cls: "is-p-muted",
    dot: "👤",
  };
  const roleLabelsUk = {
    superadmin: "ADMAX",
    admin: "Адмін",
    miniadmin: "Мініадмін",
    instructor: "Інструктор",
    mentor: "Ментор",
    miltech: "Мілтех",
    partner: "Партнер",
    cadet: "Курсант",
    user: "Учасник",
    quarantine: "Карантин",
    guest: "Гість",
    banned: "Заблоковано",
  };
  const isStaff = list.some(r => ["superadmin", "admin", "miniadmin", "instructor", "mentor", "miltech"].includes(r));
  const allRolesUk = list.map(r => roleLabelsUk[r] || r).join(", ");
  return { ...meta, allRolesUk, roles: list, isStaff };
}

const UK_PHONETIC_TABLE = {
  а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ie", ж: "zh", з: "z",
  и: "y", і: "i", ї: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p",
  р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch",
  ь: "", ю: "iu", я: "ia", ы: "y", э: "e", ё: "io", ъ: "",
};

function normalizePersonLookupKey(name) {
  return String(name || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\.(?:md|markdown)$/i, "")
    .replace(/^\([0-9a-f-]{36}\)\s*/i, "")
    .replace(/['\u2019`ʼ]+/g, "")
    .replace(/[\-_.,()]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function personPhoneticKey(name) {
  const clean = normalizePersonLookupKey(name);
  if (!clean) return "";
  let lat = "";
  for (const ch of clean) lat += UK_PHONETIC_TABLE[ch] ?? ch;
  lat = lat
    .replace(/ya/g, "ia").replace(/yu/g, "iu").replace(/ye/g, "ie")
    .replace(/yi|iy|ii|yy/g, "i").replace(/[jy]/g, "i")
    .replace(/g/g, "h").replace(/x/g, "ks").replace(/ck/g, "k").replace(/w/g, "v");
  const toks = (lat.match(/[a-z0-9]+/g) || []).filter(t => t.length >= 2);
  return toks.length ? toks.sort().join(" ") : "";
}

function personLookupKeys(name) {
  const out = [];
  const exact = normalizePersonLookupKey(name);
  if (exact) out.push("e:" + exact);
  const phon = personPhoneticKey(name);
  if (phon) out.push("p:" + phon);
  return out;
}

function isPlatformItemPath(path) {
  return typeof path === "string" && (
    path.startsWith("FlightClub Platform/Майно/") ||
    path.startsWith("FlightClub Platform/Приховані/Майно/")
  ) && /\.md$/i.test(path);
}

function isPlatformPersonPath(path) {
  return typeof path === "string" && (
    path.startsWith("FlightClub Platform/Люди/") ||
    path.startsWith("FlightClub Platform/Приховані/Люди/")
  ) && /\.md$/i.test(path);
}

function badgeToneForKind(kind) {
  return (kind === "drive" || kind === "page" || kind === "m") ? "drive" : "platform";
}

function normalizeHubCities(list, { fromServer = false } = {}) {
  const base = [...DEFAULT_HUB_CITIES];
  if (!Array.isArray(list)) return base;
  for (const item of list) {
    const city = String(typeof item === "object" && item !== null ? item.name ?? "" : item ?? "").trim();
    if (!city || city.length > 60) continue;
    // Strip stale inactive "Одеса" that was cached before active-only filtering
    if (!fromServer && city === "Одеса") continue;
    if (typeof item === "object" && item !== null && item.active === false) continue;
    if (!base.includes(city)) base.push(city);
  }
  return base;
}

function formatEditorTimestamp(iso) {
  if (!iso || typeof iso !== "string") return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const diffMin = Math.max(0, Math.round((Date.now() - ms) / 60000));
  let clock = "";
  try {
    clock = new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
  } catch {}
  if (diffMin < 1) return clock ? `${clock} (щойно)` : "щойно";
  if (diffMin < 60) return clock ? `${clock} (${diffMin} хв тому)` : `${diffMin} хв тому`;
  if (diffMin < 1440) {
    const h = Math.round(diffMin / 60);
    return clock ? `${clock} (${h} год тому)` : `${h} год тому`;
  }
  try {
    return new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
  } catch { return clock; }
}

function readUpdateDetails(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 10).flatMap(entry => {
    if (!entry || typeof entry.label !== "string") return [];
    const label = entry.label.trim().slice(0, 80);
    const before = typeof entry.before === "string" ? entry.before.trim().slice(0, 160) : null;
    const after = typeof entry.after === "string" ? entry.after.trim().slice(0, 160) : "";
    return label ? [{ label, before, after }] : [];
  });
}

// A preview is derived from the two already-authorized local revisions. Its text
// stays in memory and is never written to plugin data or the activity log.
const updateExcerpts = new WeakMap();
const SAFE_YAML_UPDATE_FIELDS = [
  ["status-profile", "Статус профілю"],
  ["profile-status", "Статус профілю"],
  ["item-status", "Статус майна"],
  ["item-holder", "Тримач майна"],
  ["місто", "Місто"],
  ["номер потоку", "Номер потоку"],
  ["date", "Дата"],
  ["дата івенту", "Дата івенту"],
  ["tags", "Теги"],
  ["status-script", "Статус сценарію"],
];
const SAFE_YAML_KEY_SET = new Map(SAFE_YAML_UPDATE_FIELDS);

function sanitizeYamlPreviewValue(raw) {
  if (raw == null) return "";
  const str = Array.isArray(raw)
    ? raw.map(v => String(v ?? "").trim()).filter(Boolean).join(", ")
    : String(raw).trim();
  if (!str || str === "(n/a)" || str === "n/a" || str === "Empty" || str === "null") return "";
  if (/https?:\/\/|fco_[a-f0-9]{16,}|bearer\s+|eyJ[A-Za-z0-9_-]+\./i.test(str)) return "";
  return str.slice(0, 120);
}

function parseSafeUpdateYaml(rawText) {
  const out = new Map();
  if (typeof rawText !== "string") return out;
  const fmMatch = rawText.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!fmMatch) return out;
  const yamlBlock = fmMatch[1];
  let parsed = null;
  if (typeof obsidian?.parseYaml === "function") {
    try { parsed = obsidian.parseYaml(yamlBlock); } catch {}
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    parsed = {};
    let currentKey = null;
    for (const rawLine of yamlBlock.split(/\r?\n/)) {
      const listMatch = currentKey && /^\s+-\s+(.+)$/.exec(rawLine);
      if (listMatch) {
        const item = listMatch[1].trim().replace(/^["']|["']$/g, "");
        if (item) {
          if (!Array.isArray(parsed[currentKey])) parsed[currentKey] = [];
          parsed[currentKey].push(item);
        }
        continue;
      }
      const kv = /^["']?([^"':\r\n]+)["']?\s*:\s*(.*)$/.exec(rawLine);
      if (!kv) { currentKey = null; continue; }
      const key = kv[1].trim();
      let val = kv[2].trim();
      currentKey = null;
      if (!val) { currentKey = key; continue; }
      if (val.startsWith("[") && val.endsWith("]")) {
        parsed[key] = val.slice(1, -1).split(",").map(s => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
      } else {
        parsed[key] = val.replace(/^["']|["']$/g, "");
      }
    }
  }
  for (const [k, v] of Object.entries(parsed)) {
    const cleanKey = k.trim().replace(/^["']|["']$/g, "").toLowerCase();
    if (/^(?:fc-|site_url|drive_url|share_url|url$|slug$|roles$|public$)|token|secret|password|auth/i.test(cleanKey)) continue;
    const label = SAFE_YAML_KEY_SET.get(cleanKey);
    if (!label || out.has(label)) continue;
    const val = sanitizeYamlPreviewValue(v);
    if (val) out.set(label, val);
  }
  return out;
}

function summarizeNotePreview(rawText) {
  if (typeof rawText !== "string" || !rawText) return [];
  const bounded = rawText.length > 128_000 ? rawText.slice(0, 128_000) : rawText;
  const lines = [];
  const seen = new Set();
  const pushLine = (text) => {
    const clean = String(text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!clean) return;
    const clipped = clean.length > 144 ? clean.slice(0, 143) + "…" : clean;
    if (seen.has(clipped)) return;
    seen.add(clipped);
    lines.push(clipped);
  };
  const safeProps = parseSafeUpdateYaml(bounded);
  const propBits = [];
  for (const [label, val] of safeProps.entries()) {
    propBits.push(`${label}: ${val}`);
    if (propBits.length === 3) break;
  }
  if (propBits.length) pushLine(propBits.join(" · "));

  const bodyText = bounded.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
  const fallbackLines = [];
  let inFence = false;
  for (const rawLine of bodyText.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (/^(?:```|~~~)/.test(trimmed)) { inFence = !inFence; continue; }
    if (inFence || !trimmed || /^[-*_]{3,}$/.test(trimmed) || /^[|\s:-]+$/.test(trimmed)) continue;
    if (/^%%.*%%$/.test(trimmed)) continue;
    if (/^[-*]\s*\[\s*\]\s*$/.test(trimmed)) continue;
    if (/^\[\[\s*(?:SOP|Шаблон|Template)[^\]]*\]\]$/i.test(trimmed)) {
      if (fallbackLines.length < 3) fallbackLines.push(trimmed);
      continue;
    }
    pushLine(trimmed);
    if (lines.length === 5) break;
  }
  if (lines.length === (propBits.length ? 1 : 0)) {
    for (const fb of fallbackLines) {
      pushLine(fb);
      if (lines.length === 5) break;
    }
  }
  return lines;
}

function summarizeUpdateText(before, after) {
  const excerpts = [];
  if (before === after || before.length > 128_000 || after.length > 128_000) return { changes: [], excerpts };
  // Exclude YAML added by the sync client from the body diff; compare only allowlisted non-sensitive fields separately.
  const body = value => value.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
  const diff = FC_MARKDOWN_DIFF.diffMarkdownLines(body(before), body(after), { context: 0, maxInlinePairs: 6 });
  const changes = [
    diff.addedLines && { label: "Додано рядків", after: String(diff.addedLines) },
    diff.removedLines && { label: "Видалено рядків", after: String(diff.removedLines) },
  ].filter(Boolean);
  const beforeProps = parseSafeUpdateYaml(before);
  const afterProps = parseSafeUpdateYaml(after);
  const yamlExcerpts = [];
  for (const [, label] of SAFE_YAML_UPDATE_FIELDS) {
    if (changes.some(c => c.label === label)) continue;
    const prev = beforeProps.get(label) || "";
    const next = afterProps.get(label) || "";
    if (prev === next || (!prev && !next)) continue;
    if (changes.length < 10) changes.push({ label, before: prev || null, after: next || "—" });
    const clipField = (v) => {
      const prefix = `${label}: `;
      const budget = Math.max(12, 144 - prefix.length);
      return v.length > budget ? v.slice(0, budget - 1) + "…" : v;
    };
    if (prev) yamlExcerpts.push({ kind: "del", parts: [{ changed: false, text: `${label}: ` }, { changed: true, text: clipField(prev) }] });
    if (next) yamlExcerpts.push({ kind: "add", parts: [{ changed: false, text: `${label}: ` }, { changed: true, text: clipField(next) }] });
  }
  const seen = new Set();
  for (const row of diff.blocks) {
    if (row.kind !== "add" && row.kind !== "del") continue;
    const line = row.text.trim();
    if (!line || /^(```|~~~)/.test(line) || seen.has(row.kind + line)) continue;
    seen.add(row.kind + line);
    const segments = row.segments || [{ type: row.kind, text: line }];
    const index = segments.findIndex(segment => segment.type === row.kind);
    const visible = segments.slice(Math.max(0, index - 1));
    let remaining = 144;
    const parts = [];
    for (const [offset, part] of visible.entries()) {
      if (!remaining) break;
      const text = offset === 0 && index > 0 && part.text.length > 32
        ? "…" + part.text.slice(-30)
        : part.text;
      const clipped = text.length > remaining ? text.slice(0, remaining - 1) + "…" : text;
      parts.push({ changed: part.type === row.kind, text: clipped });
      remaining -= clipped.length;
    }
    excerpts.push({ kind: row.kind, parts });
    if (excerpts.length === 3) break;
  }
  for (const yEx of yamlExcerpts) {
    if (excerpts.length >= 3) break;
    excerpts.push(yEx);
  }
  return { changes, excerpts };
}

function legacyUpdateDetail(summary) {
  const detail = String(summary || "")
    .replace(/^Автооновлення із сайту(?:\s*\(\+\d+\))?[:\s]*/i, "")
    .replace(/^Оновлено на сайті(?:\s*\([^)]*\))?[:\s]*/i, "")
    .replace(/\s*\(\+\d+\)$/g, "").trim();
  if (!detail || /(?:^| — )(?:оновлено документ|новий документ)(?: у| Google)? Drive(?: · .*)?$/i.test(detail)) return "";
  return detail;
}

function updateDetailLines(info) {
  return (info.changes || []).map(({label, before, after}) =>
    before === null ? `${label}: ${after}` : `${label}: ${before || "—"} → ${after || "—"}`);
}

function readUnreviewedUpdates(raw) {
  const map = new Map();
  if (!raw || typeof raw !== "object") return map;
  for (const [path, entry] of Object.entries(raw)) {
    if (!path || typeof path !== "string" || !entry || typeof entry !== "object") continue;
    if (path === "FlightClub Sync Archive" || path.startsWith("FlightClub Sync Archive/")) continue;
    const count = Math.max(0, Math.min(99, Number(entry.count) || 0));
    if (count <= 0) continue;
    const actions = Array.isArray(entry.actions)
      ? entry.actions.map(a => String(a || "").trim()).filter(Boolean).slice(0, 5)
      : [];
    const summary = typeof entry.summary === "string" && entry.summary.trim()
      ? entry.summary.trim().slice(0, 240)
      : actions[0] || `Автооновлення із сайту (+${count})`;
    const editorName = typeof entry.editorName === "string" && entry.editorName.trim() ? entry.editorName.trim().slice(0, 80) : null;
    const editorUserId = typeof entry.editorUserId === "string" && entry.editorUserId.trim() ? entry.editorUserId.trim().slice(0, 64) : null;
    const editedAt = typeof entry.editedAt === "string" && entry.editedAt.trim() ? entry.editedAt.trim() : (typeof entry.updatedAt === "string" ? entry.updatedAt : new Date().toISOString());
    const shownInTreeAt = Number.isFinite(Number(entry.shownInTreeAt)) ? Number(entry.shownInTreeAt) : (Date.parse(editedAt) || Date.now());
    map.set(path, {
      count,
      summary,
      changes: readUpdateDetails(entry.changes),
      actions: actions.length ? actions : [summary],
      kind: typeof entry.kind === "string" ? entry.kind : "platform",
      updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : editedAt,
      editorName,
      editorUserId,
      editedAt,
      shownInTreeAt,
      treeDismissed: entry.treeDismissed === true,
    });
    if (map.size >= 500) break;
  }
  return map;
}
const BaseItemView = obsidian.ItemView || class { constructor(leaf) { this.leaf = leaf; } };
const BasePluginSettingTab = obsidian.PluginSettingTab || class { constructor(app, plugin) { this.app = app; this.plugin = plugin; } };

const SITE = "https://flightclub.com.ua";
const DRIVE_VAULT_URL = SITE + "/markdown?view=vault";
const SECRET_ID = "flightclub-markdown-device";
const BRAND_ICON = "flightclub-propeller";
const BRAND_LOGO = "__FLIGHTCLUB_LOGO_DATA__";
const DOCK_VIEW_TYPE = "flightclub-live-dock";
const ZONE_GRAPH_VIEW_TYPE = "flightclub-zone-graph";
const SLUG = /^[a-z0-9_-]{2,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERSION = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DRIVE_ID = /^[A-Za-z0-9_-]{3,200}$/;
const TOKEN_RE = /^fco_[a-f0-9]{48}$/;
const TTL = 20 * 60 * 1000;
const MAX_NOTE = 120_000;
const LABEL = {
  user: "Профіль людини",
  item: "Майно бібліотеки",
  event: "Подія розкладу",
  m: "Сторінка /m/",
  drive: "Файл Drive Vault",
};
const KIND_ICON = {
  user: "👤",
  item: "📦",
  event: "📅",
  m: "📘",
  drive: "🗂️",
};

// ============================================================================
// FlightClub Adaptive 4-Categorization Force-Directed Physics Graph (v1.6.8)
// ============================================================================

const FC_GRAPH_CATEGORIZATIONS = {
  domains: {
    id: "domains",
    label: "🧭 Напрями",
    title: "За напрямами FlightClub",
    desc: "Навчання й курсанти · Майно · Люди/Події · Медіа · SOP/Daily · Результати",
    zones: [
      { id: "training", label: "Навчання й курсанти", icon: "🎓", color: "#38bdf8", rgb: 0x38bdf8, query: 'path:"01 НАВЧАННЯ" OR path:"04 Навчання курсантів" OR path:"01_03 Профілі курсантів" OR path:"01_02 Потоки навчань" OR tag:#профіль' },
      { id: "equipment", label: "Майно й бібліотека", icon: "🛠️", color: "#10b981", rgb: 0x10b981, query: 'path:"FlightClub Platform/Майно" OR ["item-status":*] OR tag:#item' },
      { id: "community", label: "Люди, команда й події", icon: "👥", color: "#a855f7", rgb: 0xa855f7, query: 'path:"FlightClub Platform/Люди" OR path:"FlightClub Platform/Події" OR path:"01_01 події" OR path:"01_03_01 події" OR tag:#event OR tag:#person' },
      { id: "media", label: "Медіа та сценарії", icon: "🎬", color: "#ec4899", rgb: 0xec4899, query: 'path:"02 МЕДІА" OR path:"03 media" OR path:"01_02 projects-production" OR path:"02 копірайти" OR tag:#copywrite OR tag:#script' },
      { id: "governance", label: "SOP, правила й Daily", icon: "📘", color: "#6366f1", rgb: 0x6366f1, query: 'path:"05 sop" OR path:"Daily" OR path:"03 - Meeting notes" OR path:"04 нотатки з зустрічей" OR path:"04 meeting notes" OR path:"03_01 - daily core team" OR tag:#daily OR tag:#sop' },
      { id: "evidence", label: "Результати й фінанси", icon: "📊", color: "#f59e0b", rgb: 0xf59e0b, query: 'path:"01_01 projects-fundraising" OR file:результат OR file:звіт OR file:пітч OR file:фінанс OR file:грант' },
      { id: "knowledge", label: "База знань та індекси", icon: "📚", color: "#94a3b8", rgb: 0x94a3b8, query: 'path:"00 index" OR path:"00 НАПРЯМКИ"' },
    ],
  },
  funnel: {
    id: "funnel",
    label: "📊 Воронка й статуси",
    title: "За воронкою та статусами",
    desc: "Робота/Випуск/Вільно · Навчання/В роботі · Черга/На руках · Ремонт/Без дрона · Команда",
    zones: [
      { id: "done", label: "Робота / Випуск / Вільно", icon: "✅", color: "#10b981", rgb: 0x10b981, query: '["status-profile":"05"] OR ["status-profile":"03"] OR ["status-profile":"07"] OR ["item-status":available]' },
      { id: "active", label: "Навчання / Шукає / В роботі", icon: "🚀", color: "#38bdf8", rgb: 0x38bdf8, query: '["status-profile":"02"] OR ["status-profile":"04"] OR ["item-status":event]' },
      { id: "pending", label: "Черга / Анкета / На руках", icon: "⏳", color: "#f59e0b", rgb: 0xf59e0b, query: '["status-profile":"00"] OR ["status-profile":"01"] OR ["item-status":issued]' },
      { id: "attention", label: "Без дрона / Ремонт / Увага", icon: "⚠️", color: "#ef4444", rgb: 0xef4444, query: '["status-profile":"-01"] OR ["item-status":repair] OR ["item-status":lost]' },
      { id: "team", label: "Команда / Інструктори / Адмін", icon: "⭐", color: "#a855f7", rgb: 0xa855f7, query: 'tag:#профіль/команда OR ["status-team":*] OR tag:#admin OR tag:#instructor OR tag:#miltech' },
      { id: "reference", label: "Довідник / SOP / Інше", icon: "📚", color: "#94a3b8", rgb: 0x94a3b8, query: 'path:"05 sop" OR path:"00 index" OR tag:#sop' },
    ],
  },
  hubs: {
    id: "hubs",
    label: "📍 Осередки",
    title: "За осередками та джерелами",
    desc: "Київ · Львів · Житомир · Луцьк · Інші осередки · Platform · Google Drive",
    zones: [
      { id: "kyiv", label: "Київ", icon: "🔴", color: "#ef4444", rgb: 0xef4444, query: '["user-hub":Київ] OR ["item-hub":Київ] OR ["місто":Київ] OR Київ' },
      { id: "lviv", label: "Львів", icon: "🔵", color: "#38bdf8", rgb: 0x38bdf8, query: '["user-hub":Львів] OR ["item-hub":Львів] OR ["місто":Львів] OR Львів' },
      { id: "zhytomyr", label: "Житомир", icon: "🟢", color: "#10b981", rgb: 0x10b981, query: '["user-hub":Житомир] OR ["item-hub":Житомир] OR ["місто":Житомир] OR Житомир' },
      { id: "lutsk", label: "Луцьк", icon: "🟠", color: "#f59e0b", rgb: 0xf59e0b, query: '["user-hub":Луцьк] OR ["item-hub":Луцьк] OR ["місто":Луцьк] OR Луцьк' },
      { id: "other_hub", label: "Інші осередки / Онлайн", icon: "🟣", color: "#a855f7", rgb: 0xa855f7, query: 'Полтава OR Одеса OR Дніпро OR Харків OR Вінниця OR Хмельницький OR Тернопіль' },
      { id: "platform", label: "FlightClub Platform", icon: "⚡", color: "#ec4899", rgb: 0xec4899, query: 'path:"FlightClub Platform"' },
      { id: "drive", label: "Google Drive Vault", icon: "🗂️", color: "#818cf8", rgb: 0x818cf8, query: 'path:"FlightClub"' },
    ],
  },
  timeline: {
    id: "timeline",
    label: "📅 Дати й потоки",
    title: "За датами, активністю та потоками",
    desc: "Листопад 2026 · Жовтень 2026 · Літо–Вересень 2026 · Потоки курсантів 1–3 · Постійна база",
    zones: [
      { id: "m_2026_11", label: "Листопад 2026 (Активні)", icon: "🔥", color: "#10b981", rgb: 0x10b981, query: '["date":2026-11] OR ["03 завершив навчання":11/] OR ["item-last_modified":2026-11]' },
      { id: "m_2026_10", label: "Жовтень 2026", icon: "🍂", color: "#38bdf8", rgb: 0x38bdf8, query: '["date":2026-10] OR ["заповнив форму":10/] OR ["00 заповнив анкету":2026-10]' },
      { id: "m_2026_q3", label: "Літо — Вересень 2026", icon: "☀️", color: "#f59e0b", rgb: 0xf59e0b, query: '["date":2026-09] OR ["date":2026-08] OR ["заповнив форму":08/] OR ["заповнив форму":09/]' },
      { id: "stream_3", label: "3 Потік навчання", icon: "🎓", color: "#a855f7", rgb: 0xa855f7, query: '["номер потоку":3] OR "3 потік"' },
      { id: "stream_2", label: "2 Потік навчання", icon: "🚀", color: "#ec4899", rgb: 0xec4899, query: '["номер потоку":2] OR "2 потік"' },
      { id: "stream_1", label: "1 Потік / Раніше", icon: "🏛️", color: "#6366f1", rgb: 0x6366f1, query: '["номер потоку":1] OR "1 потік"' },
      { id: "evergreen", label: "Постійні SOP та База", icon: "📚", color: "#94a3b8", rgb: 0x94a3b8, query: 'path:"05 sop" OR path:"00 index"' },
    ],
  },
  topics: {
    id: "topics",
    label: "🏷️ Теми",
    title: "За темами й тегами",
    desc: "Топ-теги та тематичні кластери Obsidian",
    zones: [],
  },
};

/*__FC_GRAPH_INSIGHTS__*/

function fcFmText(fm, keys) {
  if (!fm || typeof fm !== "object") return "";
  for (const k of keys) {
    const v = fm[k];
    if (v == null) continue;
    const s = Array.isArray(v) ? v.join(" ") : String(v);
    if (s.trim() && s.trim() !== "(n/a)" && s.trim() !== "Empty") return s.trim();
  }
  return "";
}

function parseFlexibleFcDate(raw) {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 946684800000 && raw < 4102444800000) {
    const d = new Date(raw);
    const iso = d.toISOString().slice(0, 10);
    return { ms: raw, iso, ym: iso.slice(0, 7), label: `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` };
  }
  const str = String(raw).trim().replace(/^["']|["']$/g, "").trim();
  if (!str || str === "(n/a)" || str === "n/a" || str === "—") return null;
  let y = 0, m = 0, day = 0;
  const isoM = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(str);
  if (isoM) {
    y = Number(isoM[1]); m = Number(isoM[2]); day = Number(isoM[3]);
  } else {
    const slashM = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(str);
    if (slashM) {
      // Obsidian properties US date format MM/DD/YYYY (e.g. 08/01/2026, 11/17/2026) or DD/MM/YYYY
      const a = Number(slashM[1]), b = Number(slashM[2]);
      y = Number(slashM[3]);
      if (a > 12 && b <= 12) { day = a; m = b; }
      else { m = a; day = b; }
    } else {
      const dotM = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(str);
      if (dotM) {
        day = Number(dotM[1]); m = Number(dotM[2]); y = Number(dotM[3]);
      }
    }
  }
  if (y >= 2020 && y <= 2035 && m >= 1 && m <= 12 && day >= 1 && day <= 31) {
    const mm = String(m).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    const iso = `${y}-${mm}-${dd}`;
    const ms = Date.parse(`${iso}T12:00:00Z`);
    if (Number.isFinite(ms)) return { ms, iso, ym: `${y}-${mm}`, label: `${dd}.${mm}.${y}` };
  }
  return null;
}

const FC_DATE_FM_PRIORITY = [
  ["05 знайшов роботу", "Робота"],
  ["07 знайшов альту", "Альта"],
  ["04 почав шукати роботу", "Пошук"],
  ["03 завершив навчання", "Випуск"],
  ["02 почав навчання", "Навчання"],
  ["01 став в чергу", "Черга"],
  ["заповнив форму", "Анкета"],
  ["profile-заповнив форму", "Анкета"],
  ["00 заповнив анкету", "Анкета"],
  ["заповнив анкету", "Анкета"],
  ["дата івенту", "Івент"],
  ["event-starts_at", "Івент"],
  ["date", "Дата"],
  ["item-last_modified", "Оновлено"],
  ["item-date_added", "Додано"],
  ["updated_at", "Оновлено"],
  ["file-created date", "Створено"],
  ["note created date", "Створено"],
];

function extractObsidianNoteDate(file, fm = null) {
  if (fm && typeof fm === "object") {
    for (const [key, prefix] of FC_DATE_FM_PRIORITY) {
      const val = fm[key] ?? fm[`"${key}"`];
      const parsed = parseFlexibleFcDate(val);
      if (parsed) return { ...parsed, source: prefix, field: key };
    }
    for (const [k, v] of Object.entries(fm)) {
      if (/date|дата|заповнив|завершив|почав|знайшов/i.test(k)) {
        const parsed = parseFlexibleFcDate(v);
        if (parsed) return { ...parsed, source: k.replace(/^["']|["']$/g, ""), field: k };
      }
    }
  }
  const titleParsed = parseFlexibleFcDate(file?.basename || file?.path || "");
  if (titleParsed) return { ...titleParsed, source: "Назва", field: "basename" };
  const statMs = Number(file?.stat?.mtime || file?.stat?.ctime || 0);
  if (statMs > 946684800000) {
    const parsed = parseFlexibleFcDate(statMs);
    if (parsed) return { ...parsed, source: "Файл", field: "mtime" };
  }
  return null;
}

const GRAPH_LAYOUT_ORDER = ["obsidian", "roadmap", "zones", "gantt"];
const GRAPH_LAYOUT_META = {
  obsidian: { id: "obsidian", label: "Фізика", short: "Фізика", desc: "Вільний силовий граф зв’язків з фізикою Obsidian" },
  roadmap: { id: "roadmap", label: "Роадмап", short: "Роадмап", desc: "Хронологічна лінія за датами з чекпоїнтами років і фізикою" },
  zones: { id: "zones", label: "Зони", short: "Зони", desc: "Структуровані кольорові зони за обраною категоризацією" },
  gantt: { id: "gantt", label: "Гантт", short: "Гантт", desc: "Комплексна діаграма Гантта по проєктах, напрямах і датах" },
};

function fcGraphIconSvg(kind, doc, size = 14) {
  if (!doc?.createElementNS) return null;
  const ns = "http://www.w3.org/2000/svg";
  const svgEl = doc.createElementNS(ns, "svg");
  svgEl.setAttribute("width", String(size));
  svgEl.setAttribute("height", String(size));
  svgEl.setAttribute("viewBox", "0 0 16 16");
  svgEl.setAttribute("fill", "none");
  svgEl.setAttribute("stroke", "currentColor");
  svgEl.setAttribute("stroke-width", "1.45");
  svgEl.setAttribute("stroke-linecap", "round");
  svgEl.setAttribute("stroke-linejoin", "round");
  svgEl.setAttribute("aria-hidden", "true");
  svgEl.setAttribute("class", "fc-ui-svg fc-ui-svg-" + kind);

  const add = (tag, attrs) => {
    const el = doc.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    svgEl.append(el);
    return el;
  };

  if (kind === "obsidian") {
    add("path", { d: "M8 2.8L3.4 9.5L8 12.8L12.6 9.5Z" });
    add("circle", { cx: 8, cy: 2.8, r: 1.4, fill: "currentColor", stroke: "none" });
    add("circle", { cx: 3.4, cy: 9.5, r: 1.4, fill: "currentColor", stroke: "none" });
    add("circle", { cx: 12.6, cy: 9.5, r: 1.4, fill: "currentColor", stroke: "none" });
    add("circle", { cx: 8, cy: 12.8, r: 1.3, fill: "currentColor", stroke: "none" });
  } else if (kind === "roadmap") {
    add("line", { x1: 2, y1: 8, x2: 14, y2: 8 });
    add("line", { x1: 4.5, y1: 3.2, x2: 4.5, y2: 12.8, "stroke-opacity": "0.45" });
    add("line", { x1: 11.5, y1: 3.2, x2: 11.5, y2: 12.8, "stroke-opacity": "0.45" });
    add("circle", { cx: 4.5, cy: 8, r: 1.8, fill: "currentColor", stroke: "none" });
    add("circle", { cx: 8.2, cy: 5.2, r: 1.4, fill: "currentColor", stroke: "none" });
    add("circle", { cx: 11.5, cy: 8, r: 1.8, fill: "currentColor", stroke: "none" });
  } else if (kind === "zones") {
    add("rect", { x: 2.2, y: 2.4, width: 5.1, height: 5.1, rx: 1.3 });
    add("rect", { x: 8.7, y: 2.4, width: 5.1, height: 5.1, rx: 1.3 });
    add("rect", { x: 2.2, y: 8.7, width: 5.1, height: 5.1, rx: 1.3 });
    add("rect", { x: 8.7, y: 8.7, width: 5.1, height: 5.1, rx: 1.3 });
  } else if (kind === "gantt") {
    add("rect", { x: 2.2, y: 2.8, width: 6.5, height: 2.2, rx: 1, fill: "currentColor", stroke: "none" });
    add("rect", { x: 5.4, y: 6.9, width: 7.4, height: 2.2, rx: 1, fill: "currentColor", stroke: "none" });
    add("rect", { x: 7.8, y: 11, width: 6, height: 2.2, rx: 1, fill: "currentColor", stroke: "none" });
    add("line", { x1: 10.2, y1: 1.8, x2: 10.2, y2: 14.2, "stroke-dasharray": "1.6 1.6" });
  } else if (kind === "cycle") {
    add("path", { d: "M12.8 5.2A5.2 5.2 0 0 0 3.7 5.2M3.2 10.8A5.2 5.2 0 0 0 12.3 10.8" });
    add("polyline", { points: "11.2 2.7 13.1 5.3 10.4 5.7" });
    add("polyline", { points: "4.8 13.3 2.9 10.7 5.6 10.3" });
  } else if (kind === "filters") {
    add("line", { x1: 2.5, y1: 4.5, x2: 13.5, y2: 4.5 });
    add("line", { x1: 4.5, y1: 8, x2: 11.5, y2: 8 });
    add("line", { x1: 6.5, y1: 11.5, x2: 9.5, y2: 11.5 });
  } else if (kind === "list") {
    add("line", { x1: 5.2, y1: 4.2, x2: 13.2, y2: 4.2 });
    add("line", { x1: 5.2, y1: 8, x2: 13.2, y2: 8 });
    add("line", { x1: 5.2, y1: 11.8, x2: 13.2, y2: 11.8 });
    add("circle", { cx: 2.8, cy: 4.2, r: 0.9, fill: "currentColor", stroke: "none" });
    add("circle", { cx: 2.8, cy: 8, r: 0.9, fill: "currentColor", stroke: "none" });
    add("circle", { cx: 2.8, cy: 11.8, r: 0.9, fill: "currentColor", stroke: "none" });
  } else if (kind === "refresh") {
    add("path", { d: "M13 8a5 5 0 1 1-1.35-3.42" });
    add("polyline", { points: "13 2.4 13 5.2 10.2 5.2" });
  } else if (kind === "search") {
    add("circle", { cx: 7.1, cy: 7.1, r: 4.2 });
    add("line", { x1: 10.2, y1: 10.2, x2: 13.6, y2: 13.6 });
  } else if (kind === "open") {
    add("line", { x1: 4.5, y1: 11.5, x2: 11.5, y2: 4.5 });
    add("polyline", { points: "6 4.5 11.5 4.5 11.5 10" });
  } else if (kind === "wrap") {
    add("path", { d: "M2.5 4.5h11M2.5 8h8.2a2.1 2.1 0 0 1 0 4.2H8" });
    add("polyline", { points: "9.5 10.6 7.8 12.2 9.5 13.8" });
  } else if (kind === "copy") {
    add("rect", { x: 5.5, y: 5.5, width: 7.5, height: 8, rx: 1.2 });
    add("path", { d: "M4.5 10.5H3.8A1.3 1.3 0 0 1 2.5 9.2V3.8A1.3 1.3 0 0 1 3.8 2.5H9.2A1.3 1.3 0 0 1 10.5 3.8V4.5" });
  }
  return svgEl;
}

function extractObsidianDateTimeline(file, fm = null, primaryDate = null) {
  const milestones = [];
  const seenIso = new Set();
  const pushDate = (parsed, source) => {
    if (!parsed || !parsed.iso || seenIso.has(parsed.iso)) return;
    seenIso.add(parsed.iso);
    milestones.push({ ms: parsed.ms, iso: parsed.iso, ym: parsed.ym, label: parsed.label, source });
  };
  if (primaryDate && primaryDate.field !== "mtime") pushDate(primaryDate, primaryDate.source || "Дата");
  if (fm && typeof fm === "object") {
    for (const [key, prefix] of FC_DATE_FM_PRIORITY) {
      const val = fm[key] ?? fm[`"${key}"`];
      const parsed = parseFlexibleFcDate(val);
      if (parsed) pushDate(parsed, prefix);
    }
    for (const [k, v] of Object.entries(fm)) {
      if (/date|дата|start|end|deadline|заповнив|завершив|почав|знайшов/i.test(k)) {
        const parsed = parseFlexibleFcDate(v);
        if (parsed) pushDate(parsed, k.replace(/^["']|["']$/g, ""));
      }
    }
  }
  const titleParsed = parseFlexibleFcDate(file?.basename || file?.path || "");
  if (titleParsed) pushDate(titleParsed, "Назва");
  milestones.sort((a, b) => a.ms - b.ms);
  const explicit = milestones.length > 0;
  const fallbackMs = primaryDate?.ms || null;
  const startMs = milestones[0]?.ms ?? fallbackMs;
  const endMs = milestones.length > 1 ? milestones[milestones.length - 1].ms : startMs;
  const spanDays = startMs && endMs ? Math.max(1, Math.round((endMs - startMs) / 86_400_000) + 1) : 1;
  return {
    startMs,
    endMs,
    spanDays,
    hasExplicitDate: explicit,
    milestones: milestones.slice(0, 8),
    year: startMs ? new Date(startMs).getUTCFullYear() : null,
  };
}

function extractObsidianProjectMeta(filePath, fm = null) {
  const p = String(filePath || "");
  const explicitProject = fm ? fcFmText(fm, ["project", "проєкт", "проект", "напрям"]) : "";
  if (explicitProject) {
    return { projectKey: "proj:" + explicitProject.toLowerCase(), projectLabel: explicitProject };
  }
  const streamNum = fm ? fcFmText(fm, ["номер потоку", "потік", "stream"]) : "";
  if (/^[1-9]$/.test(streamNum)) {
    return { projectKey: `stream:${streamNum}`, projectLabel: `${streamNum} Потік навчання` };
  }
  if (/01_01 projects-fundraising\//iu.test(p)) return { projectKey: "proj:fundraising", projectLabel: "Фандрейзинг і гранти" };
  if (/01_02 projects-production\//iu.test(p)) return { projectKey: "proj:production", projectLabel: "Медіа-продакшн" };
  if (/01_03 projects-події\/|01_01 події\/|01_03_01 події\//iu.test(p)) return { projectKey: "proj:events", projectLabel: "Події та івенти" };
  if (/01_03 Профілі курсантів\/|Курсанти - профілі\//iu.test(p)) return { projectKey: "proj:cadets", projectLabel: "Профілі курсантів" };
  if (/01_02 Потоки навчань\//iu.test(p)) return { projectKey: "proj:streams", projectLabel: "Потоки навчань" };
  if (/FlightClub Platform\/Майно\//iu.test(p)) return { projectKey: "proj:equipment", projectLabel: "Бібліотека майна" };
  if (/FlightClub Platform\/Люди\//iu.test(p)) return { projectKey: "proj:people", projectLabel: "Учасники платформи" };
  if (/FlightClub Platform\/Події\//iu.test(p)) return { projectKey: "proj:platform-events", projectLabel: "Події платформи" };
  if (/Daily\/|03_01 - daily/iu.test(p)) return { projectKey: "proj:daily", projectLabel: "Daily та сінки" };
  if (/05 sop\//iu.test(p)) return { projectKey: "proj:sop", projectLabel: "SOP і регламенти" };
  if (/02 копірайти\//iu.test(p)) return { projectKey: "proj:copywrite", projectLabel: "Копірайти" };
  if (/02 МЕДІА\/|03 media\//iu.test(p)) return { projectKey: "proj:media", projectLabel: "Медіа та соцмережі" };
  const parts = p.split("/").filter(Boolean);
  const folder = parts.length >= 2 ? parts[parts.length - 2] : "База Vault";
  return { projectKey: "folder:" + folder.toLowerCase(), projectLabel: folder };
}

function extractObsidianNoteTags(file, fm = null, cache = null, includeDerived = true) {
  const out = new Set();
  const addTag = (raw) => {
    if (!raw) return;
    for (const piece of String(raw).split(/[\s,]+/)) {
      const clean = piece.replace(/^#+/, "").replace(/^["'\[\]]+|["'\[\]]+$/g, "").trim().toLowerCase();
      if (clean && clean.length >= 2 && clean !== "n/a" && clean !== "empty") out.add(clean);
    }
  };
  if (fm && typeof fm === "object") {
    const rawTags = fm.tags ?? fm.tag;
    if (Array.isArray(rawTags)) rawTags.forEach(addTag);
    else if (rawTags != null) addTag(rawTags);
    if (includeDerived) {
      const streamNum = fcFmText(fm, ["номер потоку", "потік", "stream"]);
      if (/^[1-9]$/.test(streamNum)) out.add(`потік-${streamNum}`);
      const teamSt = [fcFmText(fm, ["status-team"]), fcFmText(fm, ["user-role", "user-roles"])].filter(Boolean).join(" ").toLowerCase();
      if (teamSt) {
        if (teamSt.includes("інструктор") || teamSt.includes("instructor")) out.add("instructor");
        if (teamSt.includes("адмін") || teamSt.includes("admin") || teamSt.includes("admax")) out.add("admin");
        if (teamSt.includes("мілтех") || teamSt.includes("miltech")) out.add("miltech");
        out.add("профіль/команда");
      }
    }
  }
  if (Array.isArray(cache?.tags)) {
    for (const t of cache.tags) {
      if (t?.tag) addTag(t.tag);
    }
  }
  const p = String(file?.path || "");
  if (includeDerived && !out.size) {
    if (/FlightClub Platform\/Майно\//i.test(p)) out.add("item");
    else if (/01_03 Профілі курсантів\/|Курсанти - профілі\//i.test(p)) out.add("профіль");
    else if (/FlightClub Platform\/Люди\//i.test(p)) out.add("person");
    else if (/FlightClub Platform\/Події\/|01_01 події\/|01_03_01 події\//i.test(p)) out.add("event");
    else if (/Daily\/|03_01 - daily/i.test(p)) out.add("daily");
    else if (/05 sop\//i.test(p)) out.add("sop");
    else if (/02 копірайти\//i.test(p)) out.add("copywrite");
    else if (/02 МЕДІА\/|03 media\/|01_02 projects-production\//i.test(p)) out.add("script");
  }
  return [...out];
}

function classifyObsidianGraphNote(filePath, basename, fm = null, funnelMeta = null, dateInfo = null, tags = []) {
  const p = String(filePath || "");
  const t = String(basename || "");
  const fcKind = fcFmText(fm, ["fc-kind", "kind"]).toLowerCase();
  const itemStatus = fcFmText(fm, ["item-status"]).toLowerCase();
  const profileStatus = fcFmText(fm, ["status-profile", "profile-status", "status-lead"]).toLowerCase() || (funnelMeta?.funnel?.fullLabel || "").toLowerCase();
  const teamStatus = fcFmText(fm, ["status-team"]).toLowerCase() || (funnelMeta?.team?.fullLabel || "").toLowerCase();
  const tagsText = [fcFmText(fm, ["tags"]), ...(tags || [])].join(" ").toLowerCase();
  const hubText = [
    fcFmText(fm, ["user-hub", "item-hub", "event-city", "місто", "city", "осередок", "hub"]),
    funnelMeta?.city || "",
    t,
  ].join(" ").toLowerCase();

  // 1. Domains categorization
  let domains = "knowledge";
  if (fcKind === "item" || itemStatus || /FlightClub Platform\/Майно\//iu.test(p) || /бібліотек.*майн|tinywhoop|паяльн|дрон №|arduino/iu.test(t)) {
    domains = "equipment";
  } else if (profileStatus || /01_03 Профілі курсантів\/|Курсанти - профілі\/|04 Навчання курсантів\/|01_02 Потоки навчань\/|01 НАВЧАННЯ\//iu.test(p) || /(?:^|[\s,])профіль(?:$|[\s,/])/iu.test(tagsText)) {
    domains = "training";
  } else if (/02 МЕДІА\/|03 media\/|01_02 projects-production\/|02 копірайти\//iu.test(p) || /сценар|копірай|зйом|монтаж|медіа|smm|ютуб|мерч|1cut/iu.test(t) || /copywrite|script/i.test(tagsText)) {
    domains = "media";
  } else if (/05 sop\/|Daily\/|03 - Meeting notes\/|04 нотатки з зустрічей\/|04 meeting notes\/|03_01 - daily/iu.test(p) || /\bsop\b|\bdaily\b|правил|принцип|регламент/iu.test(t) || /\bdaily\b|\bsop\b/i.test(tagsText)) {
    domains = "governance";
  } else if (fcKind === "event" || fcKind === "user" || teamStatus || /FlightClub Platform\/(?:Люди|Події)\/|01_01 події\/|01_03_01 події\//iu.test(p) || /івент|воркшоп|лекці|універ|осеред/iu.test(t)) {
    domains = "community";
  } else if (/01_01 projects-fundraising\//iu.test(p) || /результат|зві[тт]|статист|фінанс|бюджет|грант|пітч|pitch|цифр/iu.test(t)) {
    domains = "evidence";
  }

  // 2. Funnel & status categorization
  let funnel = "reference";
  if ((teamStatus && /адмін|інструктор|мілтех|команд/iu.test(teamStatus)) || /профіль\/команда|\badmin\b|\binstructor\b|\bmiltech\b/iu.test(tagsText)) {
    // Notice: if a person has BOTH status-profile (e.g. 03 завершив навчання) AND status-team, prioritize status-profile unless they have no active funnel status, OR let team members with active profile statuses reflect their funnel completion while team-only goes to team
    if (profileStatus && /05|знайшов роботу|07|альту|03|завершив|випуск/iu.test(profileStatus)) funnel = "done";
    else if (profileStatus && /-01|не відправ|без дрона|відмов|карантин|бан/iu.test(profileStatus)) funnel = "attention";
    else funnel = "team";
  } else if (itemStatus) {
    funnel = /available|вільн/iu.test(itemStatus) ? "done"
      : /repair|lost|ремонт|втрач/iu.test(itemStatus) ? "attention"
      : /issued|loaned|на руках/iu.test(itemStatus) ? "pending"
      : "active";
  } else if (profileStatus) {
    funnel = /05|знайшов роботу|07|альту|03|завершив|випуск/iu.test(profileStatus) ? "done"
      : /-01|не відправ|без дрона|відмов|карантин|бан/iu.test(profileStatus) ? "attention"
      : /02|почав навчан|04|шукати/iu.test(profileStatus) ? "active"
      : /00|01|анкет|черг/iu.test(profileStatus) ? "pending"
      : "active";
  } else if (/01_01 події\/|01_03_01 події\/|FlightClub Platform\/Події\//iu.test(p)) {
    funnel = "active";
  } else if (/FlightClub Platform\/Люди\//iu.test(p)) {
    funnel = "active";
  }

  // 3. Hubs & source categorization
  let hubs = p.startsWith("FlightClub Platform/") ? "platform" : "drive";
  if (/київ|kyiv/iu.test(hubText)) hubs = "kyiv";
  else if (/львів|lviv/iu.test(hubText)) hubs = "lviv";
  else if (/житомир|zhytomyr/iu.test(hubText)) hubs = "zhytomyr";
  else if (/луцьк|lutsk/iu.test(hubText)) hubs = "lutsk";
  else if (/полтав|одес|дніпр|харків|вінниц|хмельниц|івано-франк|терноп|рівне|чернів|ужгород|онлайн|online/iu.test(hubText)) hubs = "other_hub";

  // 4. Timeline & cohorts categorization
  const streamNum = fcFmText(fm, ["номер потоку", "потік", "stream"]);
  let timeline = "evergreen";
  if (streamNum === "3" || /\b3 потік\b/iu.test(t)) timeline = "stream_3";
  else if (streamNum === "2" || /\b2 потік\b/iu.test(t)) timeline = "stream_2";
  else if (streamNum === "1" || /\b1 потік\b/iu.test(t)) timeline = "stream_1";
  else if (dateInfo?.ym) {
    if (dateInfo.ym >= "2026-11") timeline = "m_2026_11";
    else if (dateInfo.ym === "2026-10") timeline = "m_2026_10";
    else if (dateInfo.ym >= "2026-06" && dateInfo.ym <= "2026-09") timeline = "m_2026_q3";
    else timeline = "stream_1";
  }

  return { domains, funnel, hubs, timeline };
}

function stepObsidianForcePhysics(sim, alpha = 0.25) {
  const { nodes, edges, zoneCenters, physicsLayout = "obsidian", forces = {} } = sim;
  const nLen = nodes.length;
  if (!nLen) return;
  const isRoadmap = physicsLayout === "roadmap";
  const isFree = physicsLayout === "obsidian";
  const fCenter = Number.isFinite(forces.center) ? forces.center : 0.45;
  const fRepel = Number.isFinite(forces.repel) ? forces.repel : 1.0;
  const fLink = Number.isFinite(forces.link) ? forces.link : 1.0;
  const fDist = Number.isFinite(forces.distance) ? forces.distance : 85;

  // 1. Gravity (Obsidian free radial cluster pull | Roadmap chronological X + swim-lane Y | Zone-boxed constellation anchors)
  for (let i = 0; i < nLen; i++) {
    const n = nodes[i];
    if (n.fx != null && n.fy != null) {
      n.x = n.fx;
      n.y = n.fy;
      n.vx = 0;
      n.vy = 0;
      continue;
    }
    if (isRoadmap) {
      if (Number.isFinite(n.roadmapX)) {
        n.vx += (n.roadmapX - n.x) * (0.28 + fCenter * 0.16) * alpha;
      }
      if (Number.isFinite(n.roadmapY)) {
        n.vy += (n.roadmapY - n.y) * (0.075 + fCenter * 0.04) * alpha;
      }
    } else if (isFree) {
      n.vx += (0 - n.x) * 0.018 * fCenter * alpha;
      n.vy += (0 - n.y) * 0.018 * fCenter * alpha;
      const zc = zoneCenters.get(n.zoneId);
      if (zc) {
        const zPull = (n.isOrphan ? 0.018 : 0.011) * Math.max(0.25, fCenter);
        n.vx += (zc.x - n.x) * zPull * alpha;
        n.vy += (zc.y - n.y) * zPull * alpha;
      }
    } else {
      const zc = zoneCenters.get(n.zoneId);
      if (zc) {
        if (n.isOrphan) {
          const tx = zc.x + (n.homeRelX || 0);
          const ty = zc.y + (n.homeRelY || 0);
          n.vx += (tx - n.x) * 0.14 * alpha;
          n.vy += (ty - n.y) * 0.14 * alpha;
        } else {
          const gStrength = n.kind === "tag" ? 0.05 : (n.degree > 2 ? 0.032 : 0.046);
          n.vx += (zc.x - n.x) * gStrength * alpha;
          n.vy += (zc.y + (zc.coreOffsetY || 0) - n.y) * gStrength * alpha;
        }
      }
    }
  }

  // 2. O(N) spatial-hash Coulomb repulsion + collision separation (bounded neighbors per node for 60fps)
  const cellSize = isRoadmap ? 112 : isFree ? 128 : 104;
  const grid = new Map();
  for (let i = 0; i < nLen; i++) {
    const n = nodes[i];
    const gx = Math.floor(n.x / cellSize);
    const gy = Math.floor(n.y / cellSize);
    const key = `${gx},${gy}`;
    let bucket = grid.get(key);
    if (!bucket) { bucket = []; grid.set(key, bucket); }
    bucket.push(i);
  }
  const maxDistSq = isFree ? 28000 : isRoadmap ? 22000 : 22000;
  for (let i = 0; i < nLen; i++) {
    const a = nodes[i];
    const gx = Math.floor(a.x / cellSize);
    const gy = Math.floor(a.y / cellSize);
    const rA = a.visualR || a.r || 5;
    let checks = 0;
    for (let dx = -1; dx <= 1 && checks < 22; dx++) {
      for (let dy = -1; dy <= 1 && checks < 22; dy++) {
        const bucket = grid.get(`${gx + dx},${gy + dy}`);
        if (!bucket) continue;
        for (let k = 0; k < bucket.length && checks < 22; k++) {
          const j = bucket[k];
          if (j <= i) continue;
          checks++;
          const b = nodes[j];
          let rx = b.x - a.x;
          let ry = b.y - a.y;
          let distSq = rx * rx + ry * ry;
          if (distSq < 1) {
            rx = ((i * 17 + j * 31) % 11) - 5 || 1;
            ry = ((i * 23 + j * 13) % 11) - 5 || 1;
            distSq = rx * rx + ry * ry;
          }
          if (distSq > maxDistSq) continue;
          const sameZone = a.zoneId === b.zoneId;
          const bothOrphans = a.isOrphan && b.isOrphan;
          const baseCharge = (a.kind === "tag" || b.kind === "tag")
            ? 980
            : bothOrphans
              ? (sameZone ? 260 : 480)
              : (sameZone ? 660 : 780);
          const charge = baseCharge * (isFree ? fRepel : isRoadmap ? fRepel * 0.78 : 1);
          const dist = Math.sqrt(distSq);
          const minDist = rA + (b.visualR || b.r || 5) + (isFree ? 16 : isRoadmap ? 15 : 14);
          const overlapBoost = dist < minDist ? ((minDist - dist) / minDist) * 2.2 : 0;
          const f = ((charge / (distSq + 55)) + overlapBoost) * alpha;
          const fx = (rx / dist) * f;
          const fy = (ry / dist) * f;
          const rxScale = isRoadmap ? 0.42 : 1;
          if (a.fx == null) { a.vx -= fx * rxScale; a.vy -= fy; }
          if (b.fx == null) { b.vx += fx * rxScale; b.vy += fy; }
        }
      }
    }
  }

  // 3. Hooke's law spring attraction along edges
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    const a = e.sourceNode;
    const b = e.targetNode;
    if (!a || !b) continue;
    const cross = a.zoneId !== b.zoneId;
    if (!isFree && !isRoadmap && cross) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const rest = isFree
      ? (a.visualR || a.r || 5) + (b.visualR || b.r || 5) + fDist * (e.type === "tag" ? 0.62 : cross ? 0.92 : 0.72)
      : isRoadmap
        ? (a.visualR || a.r || 5) + (b.visualR || b.r || 5) + fDist * 0.9
        : (a.visualR || a.r || 5) + (b.visualR || b.r || 5) + (e.type === "tag" ? 38 : 30);
    const k = isFree
      ? (e.type === "tag" ? 0.048 : cross ? 0.042 : 0.062) * fLink
      : isRoadmap
        ? 0.018 * fLink
        : (e.type === "tag" ? 0.042 : 0.068);
    const force = (dist - rest) * k * alpha;
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;
    const exScale = isRoadmap ? 0.35 : 1;
    if (a.fx == null) { a.vx += fx * exScale; a.vy += fy; }
    if (b.fx == null) { b.vx -= fx * exScale; b.vy -= fy; }
  }

  // 4. Integrate velocities with smooth damping
  const damp = isFree ? 0.78 : isRoadmap ? 0.72 : 0.74;
  const maxSpeed = isFree ? 28 : 26;
  for (let i = 0; i < nLen; i++) {
    const n = nodes[i];
    if (n.fx != null && n.fy != null) continue;
    const pad = (n.visualR || n.r || 6) + 18;
    if (isRoadmap && Number.isFinite(n.laneTop) && Number.isFinite(n.laneBot)) {
      if (n.y < n.laneTop + pad) n.vy += (n.laneTop + pad - n.y) * 0.25 * alpha;
      else if (n.y > n.laneBot - pad) n.vy -= (n.y - (n.laneBot - pad)) * 0.25 * alpha;
    }
    const zc = zoneCenters.get(n.zoneId);
    if (!isFree && !isRoadmap && zc) {
      const limX = Math.max(40, zc.rx - pad);
      const topLim = Math.max(20, zc.ry - (pad + 26));
      const botLim = Math.max(40, zc.ry - pad);
      const ox = n.x - zc.x;
      const oy = n.y - zc.y;
      if (ox > limX) n.vx -= (ox - limX) * 0.22 * alpha;
      else if (ox < -limX) n.vx += (-limX - ox) * 0.22 * alpha;
      if (oy > botLim) n.vy -= (oy - botLim) * 0.22 * alpha;
      else if (oy < -topLim) n.vy += (-topLim - oy) * 0.22 * alpha;
    }
    n.vx *= damp;
    n.vy *= damp;
    const speed = Math.hypot(n.vx, n.vy);
    if (speed > maxSpeed) {
      n.vx = (n.vx / speed) * maxSpeed;
      n.vy = (n.vy / speed) * maxSpeed;
    }
    n.x += n.vx;
    n.y += n.vy;
    if (!isFree && !isRoadmap && zc) {
      const left = zc.x - zc.minRx + pad;
      const right = zc.x + zc.minRx - pad;
      const top = zc.y - zc.minRy + pad + 24;
      const bottom = zc.y + zc.minRy - pad;
      const x = Math.max(left, Math.min(right, n.x));
      const y = Math.max(top, Math.min(bottom, n.y));
      if (x !== n.x) n.vx = 0;
      if (y !== n.y) n.vy = 0;
      n.x = x;
      n.y = y;
    } else if (isRoadmap && Number.isFinite(n.laneTop) && Number.isFinite(n.laneBot)) {
      const yClamp = Math.max(n.laneTop + 14, Math.min(n.laneBot - 14, n.y));
      if (yClamp !== n.y) n.vy = 0;
      n.y = yClamp;
    }
  }
}

function recomputeObsidianZoneHulls(zones, byZone, positions, zoneCenters, physicsLayout = "obsidian") {
  const isFree = physicsLayout === "obsidian";
  const isRoadmap = physicsLayout === "roadmap";
  for (const z of zones) {
    const members = byZone.get(z.id) || [];
    for (const n of members) {
      positions.set(n.id, { x: n.x, y: n.y });
    }
    if (isRoadmap) {
      const zc = zoneCenters?.get(z.id);
      if (zc) { z.x = zc.x; z.y = zc.y; z.rx = zc.rx; z.ry = zc.ry; }
      continue;
    }
    const zc = zoneCenters?.get(z.id);
    if (!members.length) continue;
    let cx = 0;
    let cy = 0;
    if (isFree) {
      for (const n of members) { cx += n.x; cy += n.y; }
      cx /= members.length;
      cy /= members.length;
    } else {
      cx = zc ? zc.x : members.reduce((s, n) => s + n.x, 0) / members.length;
      cy = zc ? zc.y : members.reduce((s, n) => s + n.y, 0) / members.length;
    }
    let maxLeft = 56, maxRight = 56, maxTop = 44, maxBot = 40;
    for (const n of members) {
      const r = n.visualR || n.r || 6;
      const dx = n.x - cx;
      const dy = n.y - cy;
      if (-dx + r > maxLeft) maxLeft = -dx + r;
      if (dx + r > maxRight) maxRight = dx + r;
      if (-dy + r > maxTop) maxTop = -dy + r;
      if (dy + r > maxBot) maxBot = dy + r;
    }
    const rx = isFree
      ? Math.max(96, Math.max(maxLeft, maxRight) + 28)
      : Math.max(zc?.minRx || 124, Math.max(maxLeft, maxRight) + 26);
    const ry = isFree
      ? Math.max(88, Math.max(maxTop + 32, maxBot + 24))
      : Math.max(zc?.minRy || 104, Math.max(maxTop + 44, maxBot + 24));
    z.x = cx;
    z.y = cy;
    z.rx = rx;
    z.ry = ry;
    if (zc && !isFree) { zc.rx = rx; zc.ry = ry; }
  }
}

const SHORT_MONTHS_UK = ["Січ", "Лют", "Бер", "Кві", "Тра", "Чер", "Лип", "Сер", "Вер", "Жов", "Лис", "Гру"];

function computeObsidianRoadmapLayout(nodes, edges, activeZones, byZone) {
  const datedNodes = [];
  const undatedNodes = [];
  const edgePeers = new Map();
  for (const e of edges) {
    if (!edgePeers.has(e.sourceNode.id)) edgePeers.set(e.sourceNode.id, []);
    if (!edgePeers.has(e.targetNode.id)) edgePeers.set(e.targetNode.id, []);
    edgePeers.get(e.sourceNode.id).push(e.targetNode);
    edgePeers.get(e.targetNode.id).push(e.sourceNode);
  }

  for (const n of nodes) {
    const ms = Number.isFinite(n.startMs) ? n.startMs : (n.dateInfo?.ms ?? null);
    if (Number.isFinite(ms)) {
      const d = new Date(ms);
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth() + 1;
      const day = d.getUTCDate();
      const ym = `${y}-${String(m).padStart(2, "0")}`;
      datedNodes.push({ n, ms, y, m, day, ym });
    } else if (n.kind === "tag") {
      const neighborMs = (edgePeers.get(n.id) || [])
        .map((p) => (Number.isFinite(p.startMs) ? p.startMs : p.dateInfo?.ms))
        .filter((v) => Number.isFinite(v))
        .sort((a, b) => a - b);
      if (neighborMs.length) {
        const med = neighborMs[Math.floor(neighborMs.length / 2)];
        const d = new Date(med);
        const y = d.getUTCFullYear();
        const m = d.getUTCMonth() + 1;
        datedNodes.push({ n, ms: med, y, m, day: d.getUTCDate(), ym: `${y}-${String(m).padStart(2, "0")}` });
      } else {
        undatedNodes.push(n);
      }
    } else {
      undatedNodes.push(n);
    }
  }

  const monthMap = new Map();
  for (const item of datedNodes) {
    let bucket = monthMap.get(item.ym);
    if (!bucket) {
      bucket = { ym: item.ym, year: item.y, month: item.m, items: [] };
      monthMap.set(item.ym, bucket);
    }
    bucket.items.push(item);
  }

  const currentYear = new Date().getUTCFullYear();
  const months = [...monthMap.values()].sort((a, b) => a.ym.localeCompare(b.ym));
  let cursorX = 0;
  let lastYear = null;
  const yearCheckpoints = [];
  const monthTicks = [];

  for (const bucket of months) {
    if (lastYear !== null && bucket.year !== lastYear) {
      cursorX += 86;
    }
    const width = Math.max(116, Math.min(310, 74 + Math.sqrt(bucket.items.length) * 34));
    const startX = cursorX;
    const endX = startX + width;

    if (lastYear === null || bucket.year !== lastYear) {
      yearCheckpoints.push({
        year: bucket.year,
        x: startX,
        endX,
        count: 0,
        isCurrentYear: bucket.year === currentYear,
      });
    }
    const curCp = yearCheckpoints[yearCheckpoints.length - 1];
    curCp.endX = endX;
    curCp.count += bucket.items.length;

    monthTicks.push({
      ym: bucket.ym,
      year: bucket.year,
      month: bucket.month,
      label: SHORT_MONTHS_UK[bucket.month - 1] || String(bucket.month),
      x: startX,
      endX,
      midX: startX + width / 2,
      count: bucket.items.length,
    });

    bucket.startX = startX;
    bucket.width = width;
    for (const item of bucket.items) {
      const frac = Math.max(0.06, Math.min(0.94, (item.day - 1) / 30));
      item.rawX = startX + frac * width;
    }

    cursorX = endX + 18;
    lastYear = bucket.year;
  }

  const timelineSpan = Math.max(200, cursorX);
  const shiftX = timelineSpan / 2;
  for (const cp of yearCheckpoints) { cp.x -= shiftX; cp.endX -= shiftX; }
  for (const mt of monthTicks) { mt.x -= shiftX; mt.endX -= shiftX; mt.midX -= shiftX; }
  for (const item of datedNodes) {
    item.n.roadmapX = item.rawX - shiftX;
  }

  const hasTimeline = monthTicks.length > 0;
  const minTimelineX = hasTimeline ? yearCheckpoints[0].x : -180;
  const maxTimelineX = hasTimeline ? monthTicks[monthTicks.length - 1].endX : 180;
  const noDateX = undatedNodes.length ? minTimelineX - 170 : null;
  undatedNodes.forEach((n, idx) => {
    n.roadmapX = (noDateX ?? 0) + ((idx % 5) - 2) * 22;
  });

  const now = new Date();
  const todayYm = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const exactTodayTick = monthTicks.find((m) => m.ym === todayYm);
  let todayX = null;
  if (exactTodayTick) {
    todayX = exactTodayTick.x + Math.max(0.08, Math.min(0.92, (now.getUTCDate() - 1) / 30)) * (exactTodayTick.endX - exactTodayTick.x);
  } else if (hasTimeline) {
    todayX = maxTimelineX + 42;
  }

  const lanes = [];
  let accY = 0;
  const laneGap = 24;
  for (const z of activeZones) {
    const members = byZone.get(z.id) || [];
    const h = Math.max(114, Math.min(340, 74 + Math.sqrt(members.length) * 30));
    const topY = accY;
    const botY = accY + h;
    lanes.push({
      id: z.id,
      label: z.label,
      icon: z.icon,
      color: z.color,
      count: members.filter((m) => m.kind !== "tag").length,
      topY,
      botY,
      y: topY + h / 2,
      height: h,
    });
    accY = botY + laneGap;
  }
  const totalH = Math.max(120, accY - laneGap);
  const shiftY = totalH / 2;
  const laneByZone = new Map();
  for (const lane of lanes) {
    lane.topY -= shiftY;
    lane.botY -= shiftY;
    lane.y -= shiftY;
    laneByZone.set(lane.id, lane);
  }

  const counters = new Map();
  for (const n of nodes) {
    const lane = laneByZone.get(n.zoneId);
    if (!lane) continue;
    const seq = counters.get(lane.id) || 0;
    counters.set(lane.id, seq + 1);
    const band = Math.max(24, lane.height * 0.34);
    const offset = (((seq * 29) % 19) / 18 - 0.5) * 2 * band;
    n.roadmapY = lane.y + offset;
    n.laneTop = lane.topY;
    n.laneBot = lane.botY;
    n.laneY = lane.y;
  }

  const minX = (noDateX != null ? noDateX - 80 : minTimelineX) - 60;
  const maxX = Math.max(maxTimelineX, todayX ?? maxTimelineX) + 80;
  const minY = (lanes[0]?.topY ?? -120) - 72;
  const maxY = (lanes[lanes.length - 1]?.botY ?? 120) + 48;

  return {
    yearCheckpoints,
    monthTicks,
    lanes,
    todayX,
    noDateX,
    axisY: minY + 34,
    minX,
    maxX,
    minY,
    maxY,
  };
}

function layoutObsidianZoneGraph(nodes, edges, mode = "domains", skipPhysics = false, customZones = null, layoutOpts = {}) {
  const baseCat = FC_GRAPH_CATEGORIZATIONS[mode] || FC_GRAPH_CATEGORIZATIONS.domains;
  const cat = Array.isArray(customZones) && customZones.length
    ? { ...baseCat, zones: customZones }
    : baseCat;
  const physicsLayout = GRAPH_LAYOUT_ORDER.includes(layoutOpts.physicsLayout)
    ? layoutOpts.physicsLayout
    : "obsidian";
  const prevPositions = layoutOpts.prevPositions instanceof Map ? layoutOpts.prevPositions : null;
  const forces = {
    center: Number.isFinite(layoutOpts.forces?.center) ? layoutOpts.forces.center : 0.45,
    repel: Number.isFinite(layoutOpts.forces?.repel) ? layoutOpts.forces.repel : 1.0,
    link: Number.isFinite(layoutOpts.forces?.link) ? layoutOpts.forces.link : 1.0,
    distance: Number.isFinite(layoutOpts.forces?.distance) ? layoutOpts.forces.distance : 85,
  };
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const degree = new Map();
  const validEdges = [];
  for (const e of edges) {
    const a = nodeMap.get(e.source);
    const b = nodeMap.get(e.target);
    if (!a || !b || a === b) continue;
    degree.set(e.source, (degree.get(e.source) || 0) + 1);
    degree.set(e.target, (degree.get(e.target) || 0) + 1);
    validEdges.push({ ...e, sourceNode: a, targetNode: b });
  }
  const byZone = new Map();
  for (const z of cat.zones) byZone.set(z.id, []);
  const fallbackId = cat.zones[cat.zones.length - 1]?.id || "knowledge";
  const facetField = mode === "topics" ? "topicsZone" : mode;
  for (const n of nodes) {
    const zid = byZone.has(n[facetField]) ? n[facetField] : fallbackId;
    n.zoneId = zid;
    n.degree = degree.get(n.id) || 0;
    n.isOrphan = n.kind !== "tag" && n.degree === 0;
    n.r = n.kind === "tag"
      ? Math.max(7, Math.min(13.5, 6.2 + Math.sqrt(n.degree) * 1.15))
      : Math.max(4.2, Math.min(11, 4.2 + Math.sqrt(n.degree) * 1.35));
    n.visualR = n.kind === "tag"
      ? n.r + 2
      : n.entityKind === "person"
        ? Math.max(13, n.r + 6)
        : n.entityKind === "item"
          ? Math.max(12, n.r + 5)
          : n.entityKind === "event"
            ? 15
            : n.r;
    if (!byZone.has(zid)) byZone.set(zid, []);
    byZone.get(zid).push(n);
  }
  const activeZones = cat.zones.filter((z) => (byZone.get(z.id)?.length || 0) > 0);
  if (skipPhysics || physicsLayout === "gantt") {
    for (const members of byZone.values()) {
      members.sort((a, b) => b.degree - a.degree || a.title.localeCompare(b.title, "uk"));
    }
    const zonesSummary = activeZones.map((z) => ({
      ...z,
      count: (byZone.get(z.id) || []).filter((m) => m.kind !== "tag").length,
      x: 0,
      y: 0,
      rx: 120,
      ry: 80,
    }));
    return { mode: cat.id, category: cat, nodes, edges: validEdges, zones: zonesSummary, byZone, physicsLayout, forces };
  }

  const positions = new Map();
  const zones = [];
  const zoneCenters = new Map();
  const GOLDEN_ANGLE = 2.39996322972865332;
  let roadmapMeta = null;

  if (physicsLayout === "roadmap") {
    roadmapMeta = computeObsidianRoadmapLayout(nodes, validEdges, activeZones, byZone);
    const spanX = Math.max(240, roadmapMeta.maxX - roadmapMeta.minX);
    for (const lane of roadmapMeta.lanes) {
      const zObj = activeZones.find((z) => z.id === lane.id);
      if (!zObj) continue;
      const rx = spanX / 2;
      const ry = lane.height / 2;
      const cx = (roadmapMeta.minX + roadmapMeta.maxX) / 2;
      zoneCenters.set(zObj.id, { x: cx, y: lane.y, coreOffsetY: 0, rx, ry, minRx: rx, minRy: ry });
      zones.push({ ...zObj, count: lane.count, x: cx, y: lane.y, rx, ry });
    }
    for (const n of nodes) {
      const zColor = zoneCenters.has(n.zoneId)
        ? (activeZones.find((z) => z.id === n.zoneId)?.color || "#94a3b8")
        : "#94a3b8";
      n.color = zColor;
      const tx = Number.isFinite(n.roadmapX) ? n.roadmapX : 0;
      const ty = Number.isFinite(n.roadmapY) ? n.roadmapY : 0;
      const prev = prevPositions?.get(n.id);
      if (prev && Number.isFinite(prev.x) && Number.isFinite(prev.y)) {
        n.x = prev.x * 0.55 + tx * 0.45;
        n.y = prev.y * 0.55 + ty * 0.45;
      } else {
        n.x = tx;
        n.y = ty;
      }
      n.vx = 0;
      n.vy = 0;
    }
  } else {
    const count = Math.max(1, activeZones.length);
    const plans = activeZones.map((z) => {
      const members = byZone.get(z.id).sort((a, b) => (b.kind === "tag") - (a.kind === "tag") || b.degree - a.degree || a.title.localeCompare(b.title, "uk"));
      const connected = members.filter((m) => !m.isOrphan);
      const orphans = members.filter((m) => m.isOrphan);
      const coreOffsetY = physicsLayout === "zones" ? 14 : 0;
      const coreSpread = connected.length
        ? (connected.length === 1 ? 28 : 26 * Math.sqrt(connected.length) + 22)
        : 0;
      const ringStart = connected.length ? coreSpread + 28 : 0;
      const orphanArea = orphans.some(m => m.entityKind === "person" || m.entityKind === "item" || m.entityKind === "event") ? 1380 : 980;
      const outerRadius = orphans.length
        ? (connected.length
            ? Math.sqrt(ringStart * ringStart + orphans.length * orphanArea)
            : (orphans.length === 1 ? 26 : 26 * Math.sqrt(orphans.length) + 18))
        : coreSpread;
      const rx = Math.max(128, Math.ceil(outerRadius + 40));
      const ry = Math.max(106, Math.ceil(outerRadius + 48));
      return { z, members, connected, orphans, coreOffsetY, coreSpread, ringStart, orphanArea, rx, ry, cx: 0, cy: 0 };
    });

    if (physicsLayout === "zones") {
      const gridCols = count <= 2 ? count : count <= 4 ? 2 : count <= 6 ? 3 : 4;
      const gridRows = Math.ceil(count / gridCols);
      const colWidths = Array(gridCols).fill(0);
      const rowHeights = Array(gridRows).fill(0);
      plans.forEach((p, idx) => {
        const c = idx % gridCols;
        const r = Math.floor(idx / gridCols);
        colWidths[c] = Math.max(colWidths[c], p.rx * 2);
        rowHeights[r] = Math.max(rowHeights[r], p.ry * 2);
      });
      const gap = 72;
      const colX = [];
      let accX = 0;
      for (let c = 0; c < gridCols; c++) { colX[c] = accX + colWidths[c] / 2; accX += colWidths[c] + gap; }
      const rowY = [];
      let accY = 0;
      for (let r = 0; r < gridRows; r++) { rowY[r] = accY + rowHeights[r] / 2; accY += rowHeights[r] + gap; }
      plans.forEach((p, idx) => {
        p.cx = colX[idx % gridCols];
        p.cy = rowY[Math.floor(idx / gridCols)];
      });
      for (let pass = 0; pass < 6; pass++) {
        for (let i = 0; i < plans.length; i++) {
          for (let j = i + 1; j < plans.length; j++) {
            const a = plans[i], b = plans[j];
            const minDx = a.rx + b.rx + 56;
            const minDy = a.ry + b.ry + 56;
            const dx = b.cx - a.cx;
            const dy = b.cy - a.cy;
            const ox = minDx - Math.abs(dx);
            const oy = minDy - Math.abs(dy);
            if (ox > 0 && oy > 0) {
              if (ox < oy) {
                const push = (ox / 2) * (dx >= 0 ? 1 : -1);
                a.cx -= push; b.cx += push;
              } else {
                const push = (oy / 2) * (dy >= 0 ? 1 : -1);
                a.cy -= push; b.cy += push;
              }
            }
          }
        }
      }
      const midX = plans.reduce((s, p) => s + p.cx, 0) / count;
      const midY = plans.reduce((s, p) => s + p.cy, 0) / count;
      plans.forEach((p) => { p.cx -= midX; p.cy -= midY; });
    } else {
      const orbitR = count === 1 ? 0 : Math.max(240, Math.sqrt(nodes.length) * 34);
      plans.forEach((p, idx) => {
        const ang = (idx / count) * Math.PI * 2 - Math.PI / 2;
        p.cx = Math.cos(ang) * orbitR;
        p.cy = Math.sin(ang) * orbitR;
      });
    }

    plans.forEach((p, idx) => {
      zoneCenters.set(p.z.id, { x: p.cx, y: p.cy, coreOffsetY: p.coreOffsetY, rx: p.rx, ry: p.ry, minRx: p.rx, minRy: p.ry });

      p.connected.forEach((n, j) => {
        n.color = p.z.color;
        const theta = j * GOLDEN_ANGLE + (idx * 0.7);
        const r = j === 0 ? 0 : (physicsLayout === "obsidian" ? 22 : 25) * Math.sqrt(j);
        const tx = p.cx + Math.cos(theta) * r;
        const ty = p.cy + p.coreOffsetY + Math.sin(theta) * r;
        const prev = prevPositions?.get(n.id);
        n.x = prev ? prev.x * 0.48 + tx * 0.52 : tx;
        n.y = prev ? prev.y * 0.48 + ty * 0.52 : ty;
        n.vx = 0;
        n.vy = 0;
      });

      p.orphans.forEach((n, j) => {
        n.color = p.z.color;
        const theta = (j + p.connected.length) * GOLDEN_ANGLE + (idx * 0.7);
        const r = p.connected.length
          ? Math.sqrt(p.ringStart * p.ringStart + (j + 0.5) * p.orphanArea) * (physicsLayout === "obsidian" ? 0.88 : 1)
          : (j === 0 ? 0 : 26 * Math.sqrt(j));
        n.homeRelX = Math.cos(theta) * r;
        n.homeRelY = p.coreOffsetY + Math.sin(theta) * r;
        const tx = p.cx + n.homeRelX;
        const ty = p.cy + n.homeRelY;
        const prev = prevPositions?.get(n.id);
        n.x = prev ? prev.x * 0.48 + tx * 0.52 : tx;
        n.y = prev ? prev.y * 0.48 + ty * 0.52 : ty;
        n.vx = 0;
        n.vy = 0;
      });

      zones.push({ ...p.z, count: p.members.filter((m) => m.kind !== "tag").length, x: p.cx, y: p.cy, rx: p.rx, ry: p.ry });
    });
  }

  // Fast initial warm-up so switching views starts smoothly without UI lag
  const sim = { nodes, edges: validEdges, zoneCenters, zones, byZone, positions, physicsLayout, forces };
  const ticks = 4;
  for (let step = 0; step < ticks; step++) {
    const alpha = 0.45 * (1 - step / (ticks + 4));
    stepObsidianForcePhysics(sim, alpha);
  }
  recomputeObsidianZoneHulls(zones, byZone, positions, zoneCenters, physicsLayout);

  return {
    mode: cat.id,
    category: cat,
    physicsLayout,
    forces,
    zones,
    zoneCenters,
    roadmapMeta,
    byZone,
    nodes,
    edges: validEdges,
    positions,
    setPhysicsLayout: (nextLayout) => {
      sim.physicsLayout = GRAPH_LAYOUT_ORDER.includes(nextLayout) ? nextLayout : "obsidian";
    },
    stepPhysics: (alpha = 0.2) => {
      stepObsidianForcePhysics(sim, alpha);
      recomputeObsidianZoneHulls(zones, byZone, positions, zoneCenters, sim.physicsLayout);
    },
  };
}

function fcHexToRgba(hex, alpha = 1) {
  if (typeof hex === "string" && /^#[0-9a-f]{6}$/i.test(hex)) {
    const r = Number.parseInt(hex.slice(1, 3), 16);
    const g = Number.parseInt(hex.slice(3, 5), 16);
    const b = Number.parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return `rgba(148, 163, 184, ${alpha})`;
}

function fcDrawRoundedRect(ctx, x, y, w, h, r) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

function fcBuildGraphSpatialGrid(nodes, cellSize = 48) {
  const grid = new Map();
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const gx = Math.floor(n.x / cellSize);
    const gy = Math.floor(n.y / cellSize);
    const key = `${gx},${gy}`;
    let bucket = grid.get(key);
    if (!bucket) { bucket = []; grid.set(key, bucket); }
    bucket.push(n);
  }
  return {
    hitTest(wx, wy, scale = 1, preferId = null) {
      const gx = Math.floor(wx / cellSize);
      const gy = Math.floor(wy / cellSize);
      const minPad = 7 / Math.max(0.2, scale);
      let best = null;
      let bestScore = Infinity;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const bucket = grid.get(`${gx + dx},${gy + dy}`);
          if (!bucket) continue;
          for (let i = 0; i < bucket.length; i++) {
            const n = bucket[i];
            const vr = Math.max(n.visualR || n.r || 6, minPad);
            const dist = Math.hypot(wx - n.x, wy - n.y);
            if (dist <= vr + 3) {
              const score = dist - (n.id === preferId ? 2 : 0) - Math.min(2, (n.degree || 0) * 0.15);
              if (score < bestScore) { bestScore = score; best = n; }
            }
          }
        }
      }
      return best;
    },
  };
}

function fcDrawGraphZoneCard(ctx, z, { isActive, isDim, isHeaderHovered }, theme, scale) {
  const x0 = z.x - z.rx;
  const y0 = z.y - z.ry;
  const w = z.rx * 2;
  const h = z.ry * 2;
  ctx.save();
  ctx.globalAlpha = isDim ? 0.16 : 1;
  fcDrawRoundedRect(ctx, x0, y0, w, h, 16);
  ctx.fillStyle = fcHexToRgba(z.color, isActive ? 0.08 : 0.04);
  ctx.fill();
  ctx.lineWidth = Math.max(0.85, (isActive ? 1.8 : 1) / Math.max(0.25, scale));
  ctx.strokeStyle = fcHexToRgba(z.color, isActive ? 0.72 : isHeaderHovered ? 0.48 : 0.24);
  ctx.stroke();

  // Clean top-left header pill (zero double dashed ellipse)
  const fontSize = Math.max(10.5, Math.min(18, 11.5 / Math.sqrt(Math.max(0.28, scale))));
  ctx.font = `600 ${fontSize}px ${theme.fontFamily}`;
  const headerText = `${z.icon || ""} ${z.label} · ${z.count}`.trim();
  const maxPillW = Math.max(60, w - 20);
  const measuredW = ctx.measureText ? ctx.measureText(headerText).width : headerText.length * fontSize * 0.56;
  const pillW = Math.min(maxPillW, measuredW + 18);
  const pillH = Math.max(22, fontSize + 10);
  const px = x0 + 10;
  const py = y0 + 10;
  fcDrawRoundedRect(ctx, px, py, pillW, pillH, 10);
  ctx.fillStyle = isActive || isHeaderHovered ? fcHexToRgba(z.color, 0.2) : theme.headerPillBg;
  ctx.fill();
  ctx.lineWidth = Math.max(0.75, 1 / Math.max(0.3, scale));
  ctx.strokeStyle = fcHexToRgba(z.color, isActive ? 0.65 : 0.34);
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  ctx.rect(px + 6, py, Math.max(12, pillW - 12), pillH);
  ctx.clip();
  ctx.fillStyle = theme.textNormal;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(headerText, px + 9, py + pillH / 2 + 0.5);
  ctx.restore();
  ctx.restore();
}

function fcDrawGraphClusterGlow(ctx, z, { isActive, isDim, isHeaderHovered }, theme, scale) {
  ctx.save();
  const radius = Math.max(z.rx, z.ry) * 1.05;
  ctx.globalAlpha = isDim ? 0.14 : 1;
  if (typeof ctx.createRadialGradient === "function") {
    const grad = ctx.createRadialGradient(z.x, z.y, radius * 0.08, z.x, z.y, radius);
    grad.addColorStop(0, fcHexToRgba(z.color, isActive ? 0.14 : 0.065));
    grad.addColorStop(1, fcHexToRgba(z.color, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(z.x, z.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  if (scale <= 1.15 || isActive || isHeaderHovered) {
    const fontSize = Math.max(10, Math.min(16, 11 / Math.sqrt(Math.max(0.28, scale))));
    ctx.font = `600 ${fontSize}px ${theme.fontFamily}`;
    const headerText = `${z.icon || ""} ${z.label} · ${z.count}`.trim();
    const measuredW = ctx.measureText ? ctx.measureText(headerText).width : headerText.length * fontSize * 0.56;
    const pillW = Math.min(260, measuredW + 18);
    const pillH = Math.max(20, fontSize + 8);
    const px = z.x - pillW / 2;
    const py = z.y - z.ry - pillH * 0.35;
    fcDrawRoundedRect(ctx, px, py, pillW, pillH, 999);
    ctx.fillStyle = isActive || isHeaderHovered ? fcHexToRgba(z.color, 0.24) : theme.headerPillBg;
    ctx.fill();
    ctx.lineWidth = Math.max(0.7, 0.9 / Math.max(0.3, scale));
    ctx.strokeStyle = fcHexToRgba(z.color, isActive ? 0.65 : 0.3);
    ctx.stroke();
    ctx.fillStyle = theme.textNormal;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(headerText, z.x, py + pillH / 2 + 0.5);
  }
  ctx.restore();
}

function fcDrawGraphRoadmapBackdrop(ctx, roadmap, activeZone, theme, scale, tx, ty, stageW) {
  if (!ctx || !roadmap) return;
  const { yearCheckpoints = [], monthTicks = [], lanes = [], todayX, noDateX, axisY, minX, maxX, minY, maxY } = roadmap;
  ctx.save();

  // 1. Horizontal swim-lanes by active categorization
  for (let i = 0; i < lanes.length; i++) {
    const lane = lanes[i];
    const isActive = Boolean(activeZone && lane.id === activeZone);
    const isDim = Boolean(activeZone && lane.id !== activeZone);
    ctx.save();
    ctx.globalAlpha = isDim ? 0.16 : 1;
    ctx.fillStyle = fcHexToRgba(lane.color, isActive ? 0.085 : i % 2 === 0 ? 0.032 : 0.015);
    ctx.fillRect(minX, lane.topY, maxX - minX, lane.height);
    ctx.beginPath();
    ctx.moveTo(minX, lane.topY);
    ctx.lineTo(maxX, lane.topY);
    ctx.lineWidth = Math.max(0.7, 0.85 / Math.max(0.3, scale));
    ctx.strokeStyle = fcHexToRgba(lane.color, isActive ? 0.42 : 0.14);
    ctx.stroke();

    // Sticky left lane pill locked just inside visible stage edge
    const fontSize = Math.max(9.5, Math.min(13.5, 11 / Math.sqrt(Math.max(0.3, scale))));
    ctx.font = `600 ${fontSize}px ${theme.fontFamily}`;
    const labelText = `${lane.label} · ${lane.count}`;
    const tw = ctx.measureText ? ctx.measureText(labelText).width : labelText.length * fontSize * 0.55;
    const pw = Math.min(220, tw + 18);
    const ph = Math.max(20, fontSize + 8);
    const visibleLeftWx = (12 - tx) / Math.max(0.08, scale);
    const px = Math.max(minX + 10, Math.min(maxX - pw - 10, visibleLeftWx));
    const py = lane.topY + 8;
    fcDrawRoundedRect(ctx, px, py, pw, ph, 999);
    ctx.fillStyle = isActive ? fcHexToRgba(lane.color, 0.24) : theme.headerPillBg;
    ctx.fill();
    ctx.lineWidth = Math.max(0.7, 0.85 / Math.max(0.3, scale));
    ctx.strokeStyle = fcHexToRgba(lane.color, isActive ? 0.72 : 0.34);
    ctx.stroke();
    ctx.fillStyle = theme.textNormal;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(labelText, px + 9, py + ph / 2 + 0.5);
    ctx.restore();
  }

  // 2. Main horizontal chronological timeline spine near top
  ctx.beginPath();
  ctx.moveTo(minX + 16, axisY);
  ctx.lineTo(maxX - 16, axisY);
  ctx.lineWidth = Math.max(1.1, 1.4 / Math.max(0.3, scale));
  ctx.strokeStyle = "rgba(148, 163, 184, 0.26)";
  ctx.stroke();

  // 3. Secondary month ticks
  if (scale >= 0.24) {
    const mFont = Math.max(9, Math.min(11.5, 10 / Math.sqrt(Math.max(0.35, scale))));
    ctx.font = `500 ${mFont}px ${theme.fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const mt of monthTicks) {
      ctx.beginPath();
      ctx.moveTo(mt.x, axisY - 5);
      ctx.lineTo(mt.x, maxY - 12);
      ctx.lineWidth = Math.max(0.55, 0.7 / Math.max(0.3, scale));
      ctx.strokeStyle = "rgba(148, 163, 184, 0.08)";
      ctx.stroke();

      if (scale >= 0.42 || mt.count >= 6) {
        ctx.fillStyle = "rgba(148, 163, 184, 0.72)";
        ctx.fillText(mt.label, mt.midX, axisY + 13);
      }
    }
  }

  // 4. Prominent Year Checkpoints (vertical pillars + FlightClub year pills)
  const yFont = Math.max(11, Math.min(17, 12.5 / Math.sqrt(Math.max(0.28, scale))));
  for (const cp of yearCheckpoints) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cp.x, axisY - 14);
    ctx.lineTo(cp.x, maxY - 6);
    ctx.lineWidth = Math.max(1.2, (cp.isCurrentYear ? 2.1 : 1.5) / Math.max(0.3, scale));
    ctx.setLineDash?.([6 / Math.max(0.3, scale), 5 / Math.max(0.3, scale)]);
    ctx.strokeStyle = cp.isCurrentYear ? "rgba(242, 61, 76, 0.45)" : "rgba(56, 189, 248, 0.34)";
    ctx.stroke();
    ctx.setLineDash?.([]);

    ctx.font = `750 ${yFont}px ${theme.fontFamily}`;
    const yText = `${cp.year} · ${cp.count}`;
    const yw = (ctx.measureText ? ctx.measureText(yText).width : yText.length * yFont * 0.6) + 20;
    const yh = Math.max(24, yFont + 10);
    const yx = cp.x - 10;
    const yy = axisY - yh - 8;
    fcDrawRoundedRect(ctx, yx, yy, yw, yh, 999);
    ctx.fillStyle = cp.isCurrentYear ? "rgba(227, 39, 58, 0.92)" : theme.headerPillBg;
    ctx.fill();
    ctx.lineWidth = Math.max(0.9, 1.1 / Math.max(0.3, scale));
    ctx.strokeStyle = cp.isCurrentYear ? "#ff7b88" : "rgba(56, 189, 248, 0.55)";
    ctx.stroke();

    ctx.fillStyle = cp.isCurrentYear ? "#ffffff" : theme.textNormal;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(yText, yx + yw / 2, yy + yh / 2 + 0.5);
    ctx.restore();
  }

  // 5. Undated evergreen anchor badge
  if (Number.isFinite(noDateX)) {
    const nFont = Math.max(10, Math.min(13, 10.5 / Math.sqrt(Math.max(0.3, scale))));
    ctx.font = `600 ${nFont}px ${theme.fontFamily}`;
    const label = "Постійна база";
    const nw = (ctx.measureText ? ctx.measureText(label).width : 84) + 18;
    const nh = Math.max(22, nFont + 8);
    fcDrawRoundedRect(ctx, noDateX - nw / 2, axisY - nh - 8, nw, nh, 999);
    ctx.fillStyle = theme.headerPillBg;
    ctx.fill();
    ctx.strokeStyle = "rgba(148, 163, 184, 0.3)";
    ctx.lineWidth = 0.8 / Math.max(0.3, scale);
    ctx.stroke();
    ctx.fillStyle = "rgba(148, 163, 184, 0.88)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, noDateX, axisY - nh / 2 - 7.5);
  }

  // 6. Glowing crimson Today laser line
  if (Number.isFinite(todayX)) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(todayX, axisY - 8);
    ctx.lineTo(todayX, maxY - 6);
    ctx.lineWidth = Math.max(1.2, 1.8 / Math.max(0.3, scale));
    ctx.strokeStyle = "rgba(255, 85, 101, 0.72)";
    ctx.stroke();
    const tFont = Math.max(9.5, Math.min(12.5, 10 / Math.sqrt(Math.max(0.3, scale))));
    ctx.font = `700 ${tFont}px ${theme.fontFamily}`;
    const tw = (ctx.measureText ? ctx.measureText("Сьогодні").width : 56) + 14;
    const th = Math.max(18, tFont + 7);
    fcDrawRoundedRect(ctx, todayX - tw / 2, axisY - th / 2, tw, th, 999);
    ctx.fillStyle = "#e3273a";
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Сьогодні", todayX, axisY + 0.5);
    ctx.restore();
  }

  ctx.restore();
}

function fcDrawGraphEdge(ctx, e, { matchedIds, focusId }, scale) {
  const a = e.sourceNode;
  const b = e.targetNode;
  if (!a || !b) return;
  const hit = matchedIds.has(e.source) && matchedIds.has(e.target);
  const isFocus = Boolean(focusId && (e.source === focusId || e.target === focusId));
  if (focusId && !isFocus && !hit) return;
  const crossZone = a.zoneId !== b.zoneId;
  let alpha = crossZone ? 0.065 : e.type === "semantic" ? 0.24 : e.type === "tag" ? 0.15 : 0.16;
  if (!hit || (focusId && !isFocus)) alpha = 0.03;
  else if (isFocus) alpha = 0.88;

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const offset = Math.min(24, len * 0.13) * (e.curveDir || 1);
  const mx = (a.x + b.x) / 2 - (dy / len) * offset;
  const my = (a.y + b.y) / 2 + (dx / len) * offset;

  ctx.save();
  ctx.beginPath();
  if (e.type === "tag" && !isFocus) {
    const dash = 4 / Math.max(0.3, scale);
    ctx.setLineDash?.([dash, dash]);
    ctx.strokeStyle = `rgba(192, 132, 252, ${alpha})`;
  } else if (isFocus) {
    ctx.strokeStyle = fcHexToRgba(a.color || "#38bdf8", alpha);
  } else if (e.type === "semantic") {
    ctx.strokeStyle = `rgba(56, 189, 248, ${alpha})`;
  } else {
    ctx.strokeStyle = `rgba(148, 163, 184, ${alpha})`;
  }
  ctx.lineWidth = (isFocus ? 1.85 : e.type === "semantic" ? 1.15 : 0.95) / Math.max(0.3, scale);
  ctx.moveTo(a.x, a.y);
  ctx.quadraticCurveTo(mx, my, b.x, b.y);
  ctx.stroke();
  ctx.restore();
}

function fcRequestCachedImage(url, imageCache, onLoad) {
  if (!url || typeof Image !== "function") return null;
  const existing = imageCache.get(url);
  if (existing) return existing.ok ? existing.img : null;
  const entry = { img: null, ok: false };
  imageCache.set(url, entry);
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      entry.ok = true;
      entry.img = img;
      onLoad?.();
    };
    img.onerror = () => { entry.ok = false; };
    img.src = url;
  } catch {}
  return null;
}

function fcDrawGraphNode(ctx, n, { isDim, isHovered, isSelected, isNeighbor, isCurrent, isSearchHit }, imageCache, onImageLoad, theme, scale) {
  const ek = n.kind === "tag" ? "tag" : (n.entityKind || "note");
  const r = n.r || 5;
  const highlight = isHovered || isSelected || isCurrent;
  const ringStroke = highlight ? "#ffffff" : isNeighbor ? "#e2e8f0" : null;
  ctx.save();
  ctx.globalAlpha = isDim ? 0.14 : 1;

  if (ek === "tag") {
    const d = r + 2;
    ctx.beginPath();
    ctx.moveTo(n.x, n.y - d);
    ctx.lineTo(n.x + d, n.y);
    ctx.lineTo(n.x, n.y + d);
    ctx.lineTo(n.x - d, n.y);
    ctx.closePath();
    ctx.fillStyle = "#1e1b4b";
    ctx.fill();
    ctx.lineWidth = (highlight ? 2.2 : 1.7) / Math.max(0.35, scale);
    ctx.strokeStyle = ringStroke || n.color || "#c084fc";
    ctx.stroke();
  } else if (ek === "person") {
    const R = Math.max(13, r + 6);
    ctx.beginPath();
    ctx.arc(n.x, n.y, R, 0, Math.PI * 2);
    ctx.fillStyle = "#152236";
    ctx.fill();
    const avImg = n.avatarUrl ? fcRequestCachedImage(n.avatarUrl, imageCache, onImageLoad) : null;
    if (avImg) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(n.x, n.y, R - 0.5, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(avImg, n.x - R, n.y - R, R * 2, R * 2);
      ctx.restore();
    } else {
      ctx.fillStyle = "#e2e8f0";
      ctx.font = `700 9px ${theme.fontFamily}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(n.initials || "FC", n.x, n.y + 0.5);
    }
    ctx.beginPath();
    ctx.arc(n.x, n.y, R + 1, 0, Math.PI * 2);
    ctx.lineWidth = (highlight ? 2.5 : 1.8) / Math.max(0.35, scale);
    ctx.strokeStyle = ringStroke || n.color || "#38bdf8";
    ctx.stroke();
  } else if (ek === "item") {
    const S = Math.max(12, r + 5);
    fcDrawRoundedRect(ctx, n.x - S, n.y - S, S * 2, S * 2, 6);
    ctx.fillStyle = "#111926";
    ctx.fill();
    const itemImg = n.photoUrl ? fcRequestCachedImage(n.photoUrl, imageCache, onImageLoad) : null;
    if (itemImg) {
      ctx.save();
      fcDrawRoundedRect(ctx, n.x - S + 1.5, n.y - S + 1.5, S * 2 - 3, S * 2 - 3, 5);
      ctx.clip();
      ctx.drawImage(itemImg, n.x - S + 1.5, n.y - S + 1.5, S * 2 - 3, S * 2 - 3);
      ctx.restore();
    } else {
      ctx.save();
      ctx.translate(n.x, n.y);
      ctx.strokeStyle = n.color || "#10b981";
      ctx.lineWidth = 1.5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-4, -4); ctx.lineTo(4, 4);
      ctx.moveTo(4, -4); ctx.lineTo(-4, 4);
      ctx.stroke();
      for (const [rx, ry] of [[-4.5, -4.5], [4.5, -4.5], [-4.5, 4.5], [4.5, 4.5]]) {
        ctx.beginPath();
        ctx.arc(rx, ry, 2.2, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = n.color || "#10b981";
      ctx.fillRect(-2, -2, 4, 4);
      ctx.restore();
    }
    fcDrawRoundedRect(ctx, n.x - S, n.y - S, S * 2, S * 2, 6);
    ctx.lineWidth = (highlight ? 2.4 : 1.5) / Math.max(0.35, scale);
    ctx.strokeStyle = ringStroke || n.color || "#10b981";
    ctx.stroke();

    const ledColor = /repair|broken|lost/i.test(n.itemStatus || "")
      ? "#ef4444"
      : /hand|assigned|use|event/i.test(n.itemStatus || "")
        ? "#f59e0b"
        : "#10b981";
    ctx.beginPath();
    ctx.arc(n.x + S - 3, n.y - S + 3, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = ledColor;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = "#0b1017";
    ctx.stroke();
  } else if (ek === "event") {
    const hw = 14, hh = 12;
    fcDrawRoundedRect(ctx, n.x - hw, n.y - hh, hw * 2, hh * 2, 5);
    ctx.fillStyle = "#131c2b";
    ctx.fill();
    ctx.save();
    fcDrawRoundedRect(ctx, n.x - hw + 1, n.y - hh + 1, hw * 2 - 2, 7, 3);
    ctx.fillStyle = fcHexToRgba(n.color || "#a855f7", 0.85);
    ctx.fill();
    ctx.restore();
    fcDrawRoundedRect(ctx, n.x - hw, n.y - hh, hw * 2, hh * 2, 5);
    ctx.lineWidth = (highlight ? 2.4 : 1.5) / Math.max(0.35, scale);
    ctx.strokeStyle = ringStroke || n.color || "#a855f7";
    ctx.stroke();
    ctx.fillStyle = "#f8fafc";
    ctx.font = `700 8.5px ${theme.fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(n.eventBadge || "📅", n.x, n.y + 4);
  } else {
    const rad = isCurrent ? r + 2 : r;
    ctx.beginPath();
    ctx.arc(n.x, n.y, rad, 0, Math.PI * 2);
    ctx.fillStyle = n.color || "#94a3b8";
    ctx.fill();
    ctx.lineWidth = (highlight ? 2.2 : isSearchHit ? 1.8 : 1) / Math.max(0.35, scale);
    ctx.strokeStyle = ringStroke || (isSearchHit ? "#fde047" : "rgba(255, 255, 255, 0.42)");
    ctx.stroke();
  }
  if (isSelected || isHovered) {
    const haloR = (n.visualR || r) + 4 / Math.max(0.4, scale);
    ctx.beginPath();
    ctx.arc(n.x, n.y, haloR, 0, Math.PI * 2);
    ctx.lineWidth = 1.6 / Math.max(0.4, scale);
    ctx.strokeStyle = isSelected ? "#38bdf8" : "rgba(255, 255, 255, 0.72)";
    ctx.stroke();
  }
  ctx.restore();
}

function fcDrawGraphLabels(ctx, nodes, { hoveredId, selectedId, activePath, matchedIds, neighborSet, hasSearch }, tx, ty, scale, viewW, viewH, theme) {
  const candidates = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (!matchedIds.has(n.id) && n.id !== hoveredId && n.id !== selectedId) continue;
    const isFocus = n.id === hoveredId || n.id === selectedId;
    const isNeighbor = Boolean(neighborSet && neighborSet.has(n.id));
    const isCurrent = n.path === activePath;
    const isTag = n.kind === "tag";
    if (scale < 0.36 && !isFocus && !(hasSearch && matchedIds.size <= 16)) continue;
    const sx = n.x * scale + tx;
    const sy = (n.y + (n.visualR || n.r || 6)) * scale + ty + 11;
    if (sx < -120 || sx > viewW + 120 || sy < -40 || sy > viewH + 40) continue;
    let tier = 0;
    if (isFocus) tier = 4;
    else if (isNeighbor) tier = 3;
    else if (isCurrent || isTag || (hasSearch && matchedIds.size <= 24)) tier = 2;
    else if (n.degree > 0 && scale >= 0.5) tier = 1;
    else if (scale >= 1.05 || nodes.length <= 28) tier = 0;
    else continue;
    candidates.push({ n, sx, sy, tier, isFocus, isTag });
  }
  candidates.sort((a, b) => b.tier - a.tier || (b.n.degree || 0) - (a.n.degree || 0));

  const placed = [];
  const fontSize = Math.max(10, Math.min(12.5, 10.5 + Math.max(0, scale - 0.8) * 1.6));
  ctx.save();
  ctx.font = `500 ${fontSize}px ${theme.fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const showBacking = scale >= 0.85;

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const label = c.n.title.length > 26 ? c.n.title.slice(0, 25) + "…" : c.n.title;
    const tw = ctx.measureText ? ctx.measureText(label).width : label.length * fontSize * 0.55;
    const bw = tw + 10;
    const bh = fontSize + 6;
    const x1 = c.sx - bw / 2;
    const y1 = c.sy - bh / 2;
    const x2 = x1 + bw;
    const y2 = y1 + bh;
    if (!c.isFocus) {
      let overlaps = false;
      for (let j = 0; j < placed.length; j++) {
        const b = placed[j];
        if (x1 < b.x2 && x2 > b.x1 && y1 < b.y2 && y2 > b.y1) { overlaps = true; break; }
      }
      if (overlaps) continue;
    }
    placed.push({ x1: x1 - 3, y1: y1 - 2, x2: x2 + 3, y2: y2 + 2 });
    if (showBacking || c.isFocus) {
      fcDrawRoundedRect(ctx, x1, y1, bw, bh, 4);
      ctx.fillStyle = theme.labelBg;
      ctx.fill();
    }
    ctx.fillStyle = c.isTag ? "#e9d5ff" : c.isFocus ? "#ffffff" : theme.textNormal;
    ctx.fillText(label, c.sx, c.sy + 0.5);
  }
  ctx.restore();
  return placed.length;
}

const PROPELLER_BLADE = '<path d="M50 45C49 29 53 11 66 7C76 4 80 13 73 22L57 46Z" />';
const BRAND_ICON_MARKUP = '<g fill="currentColor">' + PROPELLER_BLADE
  + '<g transform="rotate(120 50 50)">' + PROPELLER_BLADE + '</g>'
  + '<g transform="rotate(240 50 50)">' + PROPELLER_BLADE + '</g><circle cx="50" cy="50" r="8" /></g>';

function appendBrandIconSvg(svgEl, doc) {
  const ns = "http://www.w3.org/2000/svg";
  const g = doc.createElementNS(ns, "g");
  g.setAttribute("fill", "currentColor");
  const d = "M50 45C49 29 53 11 66 7C76 4 80 13 73 22L57 46Z";
  for (const angle of [null, 120, 240]) {
    const p = doc.createElementNS(ns, "path");
    p.setAttribute("d", d);
    if (angle === null) {
      g.append(p);
    } else {
      const rot = doc.createElementNS(ns, "g");
      rot.setAttribute("transform", `rotate(${angle} 50 50)`);
      rot.append(p);
      g.append(rot);
    }
  }
  const c = doc.createElementNS(ns, "circle");
  c.setAttribute("cx", "50");
  c.setAttribute("cy", "50");
  c.setAttribute("r", "8");
  g.append(c);
  svgEl.append(g);
}

function secureImageUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function addAvatar(container, peer) {
  const isMaskedOpsec = Boolean(peer && peer.opsec && !userProfileUrl(peer.userId));
  const name = isMaskedOpsec ? "OPSEC" : String(peer.name || "Учасник");
  const profile = isMaskedOpsec ? null : userProfileUrl(peer.userId);
  const avatar = profile
    ? container.createEl("a", { cls: "fc-peer-avatar" + (peer?.opsec ? " is-opsec" : ""), attr: {
        href: profile, target: "_blank", rel: "noopener noreferrer", "aria-label": "Профіль " + name, title: "Профіль " + name,
      } })
    : container.createDiv({ cls: "fc-peer-avatar" + (isMaskedOpsec ? " fc-peer-avatar-opsec" : peer?.opsec ? " is-opsec" : "") });
  if (/^#[0-9a-f]{6}$/i.test(peer.color || "")) avatar.style?.setProperty?.("--fc-peer-color", peer.color);
  if (isMaskedOpsec) {
    avatar.createSpan({ text: "🛡", attr: { "aria-hidden": "true" } });
    return avatar;
  }
  const letters = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  avatar.createSpan({ text: letters || "FC", attr: { "aria-hidden": "true" } });
  const url = secureImageUrl(peer.avatarUrl);
  if (url) {
    const photo = avatar.createEl("img", { attr: { src: url, alt: "", decoding: "async", referrerpolicy: "no-referrer" } });
    photo.addEventListener("error", () => photo.remove(), { once: true });
  }
  return avatar;
}

function pageUrl(slug) {
  return SITE + "/m/" + slug;
}

function userProfileUrl(userId) {
  if (!userId || !UUID.test(String(userId))) return null;
  return SITE + "/u/" + String(userId).toLowerCase();
}

function splitFrontmatter(raw) {
  const text = String(raw ?? "");
  const start = /^---\r?\n/.exec(text);
  if (!start) return { frontmatterBlock: "", body: text };
  const remainder = text.slice(start[0].length);
  const end = /^---[ \t]*(?:\r?\n|$)/m.exec(remainder);
  if (!end) return { frontmatterBlock: "", body: text };
  const cut = start[0].length + end.index + end[0].length;
  return {
    frontmatterBlock: text.slice(0, cut),
    body: text.slice(cut),
  };
}

// ============================================================================
// Pure OT Engine (fc-live-v1 compatible with website LiveMarkdownCollabEditor)
// ============================================================================

function clampOffset(pos, length) {
  if (!Number.isFinite(pos) || pos < 0) return 0;
  if (pos > length) return length;
  return Math.floor(pos);
}

function diffToChange(prev, next) {
  if (prev === next) return null;
  const minLen = Math.min(prev.length, next.length);
  let start = 0;
  while (start < minLen && prev.charCodeAt(start) === next.charCodeAt(start)) start++;
  let endPrev = prev.length;
  let endNext = next.length;
  while (endPrev > start && endNext > start && prev.charCodeAt(endPrev - 1) === next.charCodeAt(endNext - 1)) {
    endPrev--;
    endNext--;
  }
  return { from: start, to: endPrev, insert: next.slice(start, endNext) };
}

function mergeMarkdownText(base, local, remote) {
  if (local === base || local === remote) return remote;
  if (remote === base) return local;
  const own = diffToChange(base, local), incoming = diffToChange(base, remote);
  const apply = (body, change) => body.slice(0, change.from) + change.insert + body.slice(change.to);
  if (own.from === own.to && own.from === incoming.from && incoming.from === incoming.to) {
    return apply(base, { ...own, insert: [own.insert, incoming.insert].sort().join("") });
  }
  if (own.to <= incoming.from) return apply(apply(base, incoming), own);
  if (incoming.to <= own.from) return apply(apply(base, own), incoming);
  return null;
}

async function contentHash(text) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
}

function parseDriveInput(raw) {
  const input = String(raw ?? "").trim();
  if (!input) return "";
  if (DRIVE_ID.test(input)) return input;
  try {
    const url = new URL(input);
    if (url.protocol === "https:" && url.hostname === "drive.google.com" && !url.username && !url.password) {
      const m = /^\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]{3,200})\/?$/.exec(url.pathname);
      if (m && m[1]) return m[1];
      const openId = url.pathname === "/open" ? url.searchParams.get("id") : null;
      if (openId && DRIVE_ID.test(openId)) return openId;
    }
  } catch {}
  return "";
}

function parseSiteUrl(value) {
  try {
    const url = new URL(value);
    if (url.origin !== SITE || url.username || url.password || url.hash) return null;
    const segments = url.pathname.split("/");
    const id = segments[2] ?? "";
    if (segments.length === 3 && !url.search) {
      if (segments[1] === "m" && SLUG.test(id)) return { kind: "m", id };
      if (segments[1] === "u" && UUID.test(id)) return { kind: "user", id: id.toLowerCase() };
    }
    if (Array.from(url.searchParams.keys()).length !== 1) return null;
    const kind = url.pathname === "/library" ? "item" : url.pathname === "/schedule" ? "event" : null;
    const ref = kind && (url.searchParams.get("item") || url.searchParams.get("e") || url.searchParams.get("event"));
    return ref && UUID.test(ref) ? { kind, id: ref.toLowerCase() } : null;
  } catch {
    return null;
  }
}

function parseDriveRefParts(rawId) {
  const value = String(rawId ?? "").trim();
  if (!value) return null;
  if (value.includes("/")) {
    const parts = value.split("/");
    if (parts.length !== 2) return null;
    const [sourceId, fileId] = parts;
    if (!UUID.test(sourceId) || !DRIVE_ID.test(fileId)) return null;
    return { sourceId: sourceId.toLowerCase(), fileId, canonicalId: `${sourceId.toLowerCase()}/${fileId}` };
  }
  if (!DRIVE_ID.test(value)) return null;
  return { sourceId: null, fileId: value, canonicalId: value };
}

function driveIconForName(label, mimeType = "") {
  const mime = String(mimeType || "").toLowerCase();
  const lower = String(label || "").toLowerCase();
  if (mime === "application/vnd.google-apps.folder") return "📁";
  if (mime === "application/pdf" || lower.endsWith(".pdf")) return "📕";
  if (mime.startsWith("video/") || /\.(?:mp4|mov|mkv|webm|avi)$/.test(lower)) return "🎞️";
  if (mime.startsWith("image/") || /\.(?:png|jpe?g|webp|gif|svg|heic)$/.test(lower)) return "🖼️";
  if (mime.startsWith("audio/") || /\.(?:mp3|wav|ogg|m4a|flac)$/.test(lower)) return "🎵";
  if (mime === "application/vnd.google-apps.spreadsheet" || /\.(?:xlsx?|csv)$/.test(lower)) return "📊";
  if (mime === "application/vnd.google-apps.presentation" || /\.pptx?$/.test(lower)) return "📽️";
  if (lower.endsWith(".canvas")) return "🎨";
  if (lower.endsWith(".base")) return "🗃️";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "📝";
  return KIND_ICON.drive;
}

function driveLucideIconForItem(item) {
  const mime = String(item?.mimeType || "").toLowerCase();
  const lower = String(item?.label || "").toLowerCase();
  if (mime === "application/vnd.google-apps.folder") return "folder";
  if (mime.startsWith("video/") || /\.(?:mp4|mov|mkv|webm|avi)$/.test(lower)) return "film";
  if (mime.startsWith("image/") || /\.(?:png|jpe?g|webp|gif|svg|heic)$/.test(lower)) return "image";
  if (mime === "application/vnd.google-apps.spreadsheet" || /\.(?:xlsx?|csv)$/.test(lower)) return "table";
  if (lower.endsWith(".md") || lower.endsWith(".markdown") || mime === "application/vnd.google-apps.document") return "file-text";
  return "hard-drive";
}

function refInfo(target) {
  const match = /^(user|item|event|m|drive):([^|#]+)$/.exec(String(target ?? "").trim());
  if (!match) return null;
  const [, kind, id] = match;
  if (kind === "m") {
    return SLUG.test(id) ? { kind, id, href: pageUrl(id), icon: KIND_ICON.m } : null;
  }
  if (kind === "drive") {
    const parsed = parseDriveRefParts(id);
    if (!parsed) return null;
    return {
      kind,
      id: parsed.canonicalId,
      fileId: parsed.fileId,
      sourceId: parsed.sourceId,
      href: "https://drive.google.com/open?id=" + encodeURIComponent(parsed.fileId),
      icon: KIND_ICON.drive,
    };
  }
  if (!UUID.test(id)) return null;
  const lower = id.toLowerCase();
  const path = { user: "/u/", item: "/library?item=", event: "/schedule?e=" }[kind];
  return { kind, id: lower, href: SITE + path + lower, icon: KIND_ICON[kind] || "🔗" };
}

function refUrl(target) {
  return refInfo(target)?.href || null;
}

const MENTION_PATTERN = /\[\[((?:user|item|event|m|drive):[^\s|#\[\]]+)(?:\|([^\]\r\n]*))?\]\]/g;
const EXCLUDED_MENTION_DOM = "pre, code, kbd, samp, .frontmatter, .metadata-container";
const EXCLUDED_MENTION_SYNTAX = /code[-_ ]?(?:block|text|span)|(?:inline|fenced|indented)[-_ ]?code|frontmatter|comment|html/i;

function* mentionsIn(text) {
  for (const match of text.matchAll(MENTION_PATTERN)) {
    // Markdown escapes the first opening bracket with an odd number of backslashes.
    const escapes = /\\+$/.exec(text.slice(0, match.index))?.[0].length ?? 0;
    const prefix = text[match.index - 1];
    if (escapes % 2 || prefix === "!" || prefix === "[") continue;
    const ref = refInfo(match[1]);
    if (ref) yield { ...ref, label: match[2]?.trim() || LABEL[ref.kind], from: match.index, to: match.index + match[0].length };
  }
}

function renderedMention(raw) {
  try { raw = decodeURIComponent(raw); } catch { return null; }
  const [target, label] = raw.trim().split("|", 2);
  const ref = refInfo(target);
  return ref && { ...ref, label: label?.trim() };
}

function mentionLink(doc, mention, openSite) {
  const link = doc.createElement("a");
  link.href = mention.href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.className = `fc-mention-chip fc-mention-chip-${mention.kind}`;
  link.title = mention.kind === "drive"
    ? `${LABEL.drive} · відкрити в Google Drive`
    : `${LABEL[mention.kind]} · відкрити на flightclub.com.ua`;
  link.draggable = false;
  const icon = doc.createElement("span");
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = mention.kind === "drive" ? driveIconForName(mention.label) : mention.icon;
  link.append(icon, doc.createTextNode(mention.label || LABEL[mention.kind]));
  const navigate = (event) => {
    if (event.type === "auxclick" && event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    openSite(mention.href, doc.defaultView);
  };
  link.addEventListener("click", navigate);
  link.addEventListener("auxclick", navigate);
  return link;
}

function renderReadingMentions(element, openSite) {
  const doc = element.ownerDocument;
  for (const anchor of element.querySelectorAll("a[data-href], a[href]")) {
    if (anchor.closest(EXCLUDED_MENTION_DOM) || anchor.classList.contains("fc-mention-chip")) continue;
    const raw = anchor.getAttribute("data-href") || anchor.getAttribute("href");
    const ref = raw && renderedMention(raw);
    if (!ref) continue;
    const displayed = anchor.textContent.trim();
    const label = ref.label || (renderedMention(displayed) ? undefined : displayed);
    anchor.replaceWith(mentionLink(doc, { ...ref, label }, openSite));
  }
  const walker = doc.createTreeWalker(element, 4, {
    acceptNode: (node) => node.data.includes("[[") &&
      !node.parentElement?.closest(`a, button, script, style, ${EXCLUDED_MENTION_DOM}`) ? 1 : 2,
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const matches = [...mentionsIn(node.data)];
    if (!matches.length) continue;
    const fragment = doc.createDocumentFragment();
    let from = 0;
    for (const match of matches) {
      fragment.append(node.data.slice(from, match.from), mentionLink(doc, match, openSite));
      from = match.to;
    }
    fragment.append(node.data.slice(from));
    node.replaceWith(fragment);
  }
}

function mentionInCode(tree, from, to) {
  for (let node = tree.resolveInner(from, 1); node; node = node.parent) {
    if (EXCLUDED_MENTION_SYNTAX.test(node.name)) return true;
  }
  let excluded = false;
  tree.iterate({ from, to, enter: ({ name }) => {
    if (EXCLUDED_MENTION_SYNTAX.test(name)) excluded = true;
    return !excluded;
  } });
  return excluded;
}

function slugFromTitle(title, requestId) {
  const slug = String(title ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 64);
  return SLUG.test(slug) ? slug : "note-" + String(requestId || "fc").slice(0, 8);
}

function readLink(raw) {
  if (!raw || typeof raw.slug !== "string" || !SLUG.test(raw.slug)) return null;
  return {
    slug: raw.slug,
    version: typeof raw.version === "string" && VERSION.test(raw.version) ? raw.version : null,
    observedRemoteRevision:
      typeof raw.observedRemoteRevision === "string" && VERSION.test(raw.observedRemoteRevision)
        ? raw.observedRemoteRevision
        : null,
    syncedBodyHash: typeof raw.syncedBodyHash === "string" ? raw.syncedBodyHash : null,
    conflict: Boolean(raw.conflict),
    dirtyLocal: Boolean(raw.dirtyLocal),
  };
}

function readVaultConfig(raw) {
  const v = raw && typeof raw === "object" ? raw : {};
  const revision = typeof v.revision === "string" && UUID.test(v.revision) ? v.revision : null;
  const migratedV2 = v.configVersion === 2;
  return {
    configVersion: 2,
    vaultRootId: revision && typeof v.vaultRootId === "string" && DRIVE_ID.test(v.vaultRootId) ? v.vaultRootId : null,
    vaultRootName: revision && typeof v.vaultRootName === "string" && v.vaultRootName.trim() ? v.vaultRootName.trim().slice(0, 120) : null,
    revision,
    localVaultRoot: typeof v.localVaultRoot === "string" ? v.localVaultRoot.trim().replace(/^\/+|\/+$/g, "").slice(0, 160) : "FlightClub",
    userPinnedLocalRoot: Boolean(v.userPinnedLocalRoot),
    updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : null,
    deviceToken: typeof v.deviceToken === "string" && TOKEN_RE.test(v.deviceToken) ? v.deviceToken : null,
    pairedUserId: typeof v.pairedUserId === "string" && UUID.test(v.pairedUserId) ? v.pairedUserId.toLowerCase() : null,
    pairedUser: typeof v.pairedUser === "string" ? v.pairedUser.slice(0, 80) : null,
    pairedRole: typeof v.pairedRole === "string" ? v.pairedRole.slice(0, 40) : null,
    pairedHub: typeof v.pairedHub === "string" ? v.pairedHub.slice(0, 40) : null,
    pairedCanEdit: v.pairedCanEdit === true,
    pairedCanSync: v.pairedCanSync === true,
    importPhotos: v.importPhotos !== false,
    importPages: v.importPages !== false,
    driveAutoSync: v.driveAutoSync !== false,
    refreshPausedByUser: v.refreshPausedByUser === true,
    refreshOnStartup: v.refreshPausedByUser === true ? false : (v.refreshPausedByUser === false ? v.refreshOnStartup !== false : true),
    livePausedByUser: v.livePausedByUser === true,
    liveEnabled: v.livePausedByUser === true ? false : (v.livePausedByUser === false ? v.liveEnabled !== false : true),
    folderAutoSync: v.folderAutoSync !== false,
    explicitStaffFolderSync: v.explicitStaffFolderSync === true,
    folderSyncScope: v.folderSyncScope === "private" || v.folderSyncScope === "staff" ? v.folderSyncScope : null,
    lastPluginVersion: typeof v.lastPluginVersion === "string" ? v.lastPluginVersion.slice(0, 32) : null,
    platformV3Migrated: v.platformV3Migrated === true,
    liveHeroCollapsed: v.liveHeroCollapsed === true,
    radarCollapsed: v.radarCollapsed === true,
    liveBannerCompactV2: true,
    liveBannerCollapsed: v.liveBannerCompactV2 === true ? v.liveBannerCollapsed !== false : true,
    counterTimeoutSec: [-1, 0, 30, 120].includes(Number(v.counterTimeoutSec)) ? Number(v.counterTimeoutSec) : 30,
    autoPublishEventOnCheck: v.autoPublishEventOnCheck === true,
    lastEventPublishWaGroupJid: typeof v.lastEventPublishWaGroupJid === "string" ? v.lastEventPublishWaGroupJid.trim().slice(0, 80) : "",
    syncCheckpoints: Array.isArray(v.syncCheckpoints)
      ? v.syncCheckpoints
          .filter(c => c && typeof c === "object" && typeof c.name === "string" && c.name.trim())
          .slice(0, 6)
          .map(c => ({
            name: c.name.trim().slice(0, 120),
            rootId: typeof c.rootId === "string" && DRIVE_ID.test(c.rootId) ? c.rootId : null,
            revision: typeof c.revision === "string" && UUID.test(c.revision) ? c.revision : null,
            at: typeof c.at === "string" ? c.at.slice(0, 40) : null,
            filesCount: Number.isFinite(Number(c.filesCount)) ? Number(c.filesCount) : null,
          }))
      : [],
  };
}

// ============================================================================
// Right-Sidebar Persistent Dock View (FlightClub Live Hub)
// ============================================================================

class FlightClubDockView extends BaseItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.activeTab = "live";
    this.mentionState = { kind: "all", query: "" };
    this.pagesFilterState = { query: "" };
    this.hubHost = {};
    this.entering = true;
  }
  getViewType() { return DOCK_VIEW_TYPE; }
  getDisplayText() { return "FlightClub"; }
  getIcon() { return BRAND_ICON; }
  async onOpen() {
    const hosts = [
      this.containerEl?.closest?.(".workspace-tabs"),
      this.containerEl?.closest?.(".workspace-split.mod-right-split"),
    ].filter(Boolean);
    this._dockHostEls = hosts;
    for (const hostEl of hosts) hostEl.classList?.add?.("fc-has-live-dock");
    this.render();
  }
  async onClose() {
    for (const hostEl of this._dockHostEls || []) hostEl?.classList?.remove?.("fc-has-live-dock");
    this._dockHostEls = [];
    this.hubHost?.cleanup?.();
    this.hubHost = {};
    this.contentEl?.empty?.();
  }
  render() {
    const root = this.contentEl;
    if (!root) return;
    this.plugin.renderHubInterface(root, {
      isDock: true, entering: this.entering, activeTab: this.activeTab, mentionState: this.mentionState,
      pagesFilterState: this.pagesFilterState, host: this.hubHost,
      onTabChange: (tab) => { this.activeTab = tab; this.render(); },
    });
    this.entering = false;
  }
}

class FlightClubZoneGraphView extends BaseItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.graphController = null;
  }
  getViewType() { return ZONE_GRAPH_VIEW_TYPE; }
  getDisplayText() { return "Огляд нотаток FlightClub"; }
  getIcon() { return BRAND_ICON; }
  async onOpen() { this.render(); }
  async onClose() {
    this.graphController?.destroy?.();
    this.graphController = null;
    this.contentEl?.empty?.();
  }
  render(mode = null) {
    const root = this.contentEl;
    if (!root) return;
    this.graphController?.destroy?.();
    root.empty?.();
    this.graphController = this.plugin.renderGraphInsights(root, {
      expanded: true,
      initialMode: mode || this.plugin.zoneGraphMode || "domains",
    });
  }
}

class FlightClubSettingTab extends BasePluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.activeTab = "live";
    this.mentionState = { kind: "all", query: "" };
    this.pagesFilterState = { query: "" };
    this.hubHost = {};
  }
  hide() {
    this.hubHost?.cleanup?.();
    this.hubHost = {};
  }
  display() {
    const { containerEl } = this;
    if (!containerEl) return;
    this.plugin.renderHubInterface(containerEl, {
      activeTab: this.activeTab, mentionState: this.mentionState,
      pagesFilterState: this.pagesFilterState, host: this.hubHost,
      onTabChange: (tab) => { this.activeTab = tab; this.display(); },
    });
  }
}

// ============================================================================
// Main Plugin Class
// ============================================================================

module.exports = class FlightClubMarkdown extends Plugin {
  async onload() {
    this.alive = true;
    this.clientId = "obs-" + crypto.randomUUID().slice(0, 12);
    this.sharedPresenceId = crypto.randomUUID();
    this.sharedPresenceSequence = 0;
    this.sourceKind = Platform?.isMobileApp ? "obsidian-mobile" : "obsidian";
    const data = await this.loadData().catch(() => null);
    if (!this.alive) return;
    this.links = new Map();
    for (const [path, value] of Object.entries(data?.links ?? {})) {
      if (isSyncArchivePath(path)) continue;
      const link = readLink(value);
      if (path.toLowerCase().endsWith(".md") && link) this.links.set(path, link);
    }
    this.vaultConfig = readVaultConfig(data?.vaultConfig);
    this.graphPreset = readGraphPreset(data?.graphPreset);
    this.pendingPageCreates = new Map(Object.entries(data?.pendingPageCreates ?? {}).filter(([path,value]) =>
      !isSyncArchivePath(path) && UUID.test(value?.userId ?? "") && SLUG.test(value?.slug ?? "") && /^[a-f0-9]{64}$/.test(value?.bodyHash ?? "")));
    this.requestCount=0;this.requestWaiters=new Set();this.updatingPlugin=false;
    this.updater=FC_PLUGIN_UPDATE.createPluginUpdater({
      adapter:this.app.vault.adapter,
      directory:(this.app.vault.configDir||'.obsidian')+'/plugins/flightclub-markdown',
      requestUrl,getVersion:()=>PLUGIN_VERSION,getAppVersion:()=>obsidian.apiVersion,isActive:()=>this.alive,
      onState:()=>{if(this.alive&&this.livePeers)this.refreshDockViews();},
    });
    this.writes = Promise.resolve();
    this.treeSyncState = data?.treeSyncState ?? null;
    this.staffTreeSyncState = data?.staffTreeSyncState ?? null;
    this.driveFiles = new Map(Object.entries(data?.driveFiles ?? {}).filter(([path]) => !isSyncArchivePath(path)));
    this.driveFolders = new Map(Object.entries(data?.driveFolders ?? {}).filter(([path]) => !isSyncArchivePath(path)));
    this.pendingDriveDeletes = Array.isArray(data?.pendingDriveDeletes) ? data.pendingDriveDeletes.slice(-200) : [];
    this.pendingDriveMoves = Array.isArray(data?.pendingDriveMoves)
      ? data.pendingDriveMoves.filter(m => m && !isSyncArchivePath(m.newPath)).slice(-200)
      : [];
    this.pendingFolderOps = Array.isArray(data?.pendingFolderOps) ? data.pendingFolderOps.slice(-200) : [];
    this.driveLastSummary = data?.driveLastSummary ?? null;
    this.recentSyncWrites = new Map();
    this.lastEditorInputAt = new Map();
    this.driveSyncTimer = null;
    this.structurePromptTimer = null;
    this.structureSnoozedAt = 0;
    this.lastPromptedStructureSig = "";
    this.updatesFilterKind = "all";
    this.updatesLegendOpen = false;
    this.updatesShowAll = false;
    this.updatesSearchQuery = "";
    this.teamPluginsCatalog = { revision: null, updatedAt: null, updatedBy: null, plugins: [] };
    this.communityCatalogCache = {};
    this.teamPluginsRefreshTick = 0;
    this.teamPluginsPromptedThisRun = false;
    this.eventPublishCache = new Map();
    this.eventPublishFlagState = new Map();
    this.eventPublishWatchTimers = new Map();
    this._writingEventPublishFrontmatter = false;
    this.driveResyncQueued = false;
    this._mentionCache = new Map();
    this.ensureSyncArchiveIgnored();
    this.driveClient = FC_DRIVE_SYNC.createDriveClient({
      summarizeTextUpdate: summarizeUpdateText,
      app: this.app, TFile, TFolder, requestUrl:options=>this.timedSiteRequest(options), origin: SITE,
      getIdentity: () => this.alive && this.vaultConfig.deviceToken && this.vaultConfig.pairedUserId
        ? { token: this.vaultConfig.deviceToken, userId: this.vaultConfig.pairedUserId } : null,
      remember: (path, baseline) => this.driveFiles.set(path, baseline),
      parseYaml: obsidian.parseYaml,
      getLocalRoot: () => this.vaultConfig.localVaultRoot || "",
    });
    this.treeSync = FC_TREE_SYNC.createObsidianSync({
      app: this.app, TFile, TFolder, requestUrl:options=>this.timedSiteRequest(options), origin: SITE,
      getToken: () => this.alive ? this.vaultConfig.deviceToken : null,
      getScope: () => this.folderSyncScope(),
      getState: () => this.folderSyncScope() === "private" ? this.treeSyncState : this.staffTreeSyncState,
      getLocalRoot: () => this.folderSyncScope() === "private" ? "FlightClub Sync" : "FlightClub Shared",
      isActive: () => this.alive && this.accountVerified && this.vaultConfig.pairedCanSync,
      saveState: async (state) => {
        const key = this.folderSyncScope() === "private" ? "treeSyncState" : "staffTreeSyncState";
        const previous = this[key];
        this[key] = state;
        try { await this.persist(); }
        catch (error) { this[key] = previous; throw error; }
      },
    });
    const storage = this.app.secretStorage;
    if (storage?.getSecret && storage?.setSecret) {
      try {
        const legacy = this.vaultConfig.deviceToken;
        const token = storage.getSecret(SECRET_ID);
        if (TOKEN_RE.test(token || "")) this.vaultConfig.deviceToken = token;
        else if (legacy) storage.setSecret(SECRET_ID, legacy);
        this.useSecretStorage = true;
        if (legacy) await this.persist();
      } catch { this.useSecretStorage = false; }
    }
    this.accountAvatarUrl = null;
    this.remoteCatalog = Array.isArray(data?.remoteCatalog) ? data.remoteCatalog : [];
    this.hubCities = normalizeHubCities(data?.hubCities, { fromServer: false });
    const savedUpdatesOwner = typeof data?.unreviewedUpdatesUserId === "string" ? data.unreviewedUpdatesUserId.toLowerCase() : null;
    const activeUserId = this.vaultConfig?.pairedUserId || null;
    this.unreviewedUpdates = (savedUpdatesOwner && activeUserId && savedUpdatesOwner !== activeUserId)
      ? new Map()
      : readUnreviewedUpdates(data?.unreviewedUpdates);
    this.treeBadgeExpiryTimer = null;
    this.scheduleTreeBadgeExpiry();
    this.shareStateCache = new Map();
    this.shareDrafts = new Map();
    this.lastLocalModifyAt = new Map();

    // Live Collab Session State
    this.liveSlug = null;
    this.liveRev = 1;
    this.livePeers = [];
    this.sharedPeers = [];
    this.workspaceActivity = [];
    this.liveManualPauseSlug = null;
    this.lastActivityFetchAt = 0;

    this.liveApplyingRemote = false;
    this.livePushTimer = null;
    this.livePollTimer = null;
    this.liveCursorTimer = null;
    this.liveBannerEl = null;
    this.liveRadarEl = null;

    if (typeof this.registerView === "function") {
      try {
        this.registerView(DOCK_VIEW_TYPE, (leaf) => new FlightClubDockView(leaf, this));
        this.registerView(ZONE_GRAPH_VIEW_TYPE, (leaf) => new FlightClubZoneGraphView(leaf, this));
      } catch {}
    }

    if (typeof this.addSettingTab === "function") {
      try {
        this.settingTab = new FlightClubSettingTab(this.app, this);
        this.addSettingTab(this.settingTab);
      } catch {}
    }

    obsidian.addIcon?.(BRAND_ICON, BRAND_ICON_MARKUP);
    this.registerCollaboratorCursors();
    const ribbon = this.addRibbonIcon(BRAND_ICON, "FlightClub", (event) => {
      if (event?.button === 2 || event?.shiftKey) {
        const menu = new Menu();
        this.fillMenu(menu, this.activeNote());
        menu.showAtMouseEvent(event);
        return;
      }
      void this.activateDockView();
    });
    ribbon?.classList?.add("fc-flightclub-ribbon");
    ribbon?.addEventListener?.("contextmenu", (event) => {
      event.preventDefault();
      const menu = new Menu();
      this.fillMenu(menu, this.activeNote());
      menu.showAtMouseEvent(event);
    });

    if (!Platform?.isMobileApp && typeof this.addStatusBarItem === "function") {
      this.statusBarEl = this.addStatusBarItem();
      this.statusBarEl.addClass("fc-statusbar-pill");
      this.statusBarEl.setAttribute("role", "button");
      this.statusBarEl.tabIndex = 0;
      this.statusBarEl.setAttribute("aria-label", "Відкрити панель FlightClub");
      this.statusBarEl.addEventListener("click", () => void this.activateDockView());
      this.statusBarEl.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          void this.activateDockView();
        }
      });
    }
    const savedToken = this.vaultConfig.deviceToken;
    if (savedToken) void this.verifyDeviceTokenOnServer(savedToken).then((result) => {
      if (!this.alive || this.vaultConfig.deviceToken !== savedToken) return;
      if (!result.ok) {
        this.accountVerified = false;
        this.accountIsAdmax = false;
        this.accountCanSyncPrivate = false;
        this.accountRestricted = result.reason === "restricted";
        if (this.accountRestricted) {
          this.remoteCatalog = [];
          this.drivePreview = null;
          this.vaultConfig.pairedCanSync = false;
          this.vaultConfig.pairedReadDrive = false;
          this.vaultConfig.pairedReadPlatform = false;
          this.pairMessage = result.error || "Обліковий запис у карантині або ще не підтверджений.";
        }
        this.vaultConfig.pairedCanEdit = false;
        this.stopLiveSession();
        this.refreshDockViews();
        return;
      }
      this.accountRestricted = false;
      this.vaultConfig.pairedUser = result.viewer.displayName || "Учасник";
      this.vaultConfig.pairedUserId = result.viewer.userId;
      this.vaultConfig.pairedRole = result.viewer.roleLabel;
      if ("accessTier" in result.viewer) this.vaultConfig.pairedAccessTier = result.viewer.accessTier || null;
      this.vaultConfig.pairedCanEdit = result.viewer.canEdit === true;
      this.vaultConfig.pairedCanSync = result.viewer.canSync ?? (result.viewer.isAdmax === true || result.viewer.canEdit === true);
      if ("canReadDrive" in result.viewer) this.vaultConfig.pairedReadDrive = result.viewer.canReadDrive === true;
      if ("canReadPlatform" in result.viewer) this.vaultConfig.pairedReadPlatform = result.viewer.canReadPlatform === true;
      this.accountVerified = true;
      this.accountIsAdmax = result.viewer.isAdmax === true;
      this.accountCanSyncPrivate = result.viewer.canSyncPrivate === true;
      this.accountAvatarUrl = secureImageUrl(result.viewer.avatarUrl);
      this.folderSyncDirty = true;
      void this.runAutomaticFolderSync();
      void this.loadTeamPluginsCatalog?.({ silent: true });
      this.attachLiveSessionToActiveNote(this.activeNote());
      this.refreshDockViews();
    });
    this.updateStatusBar();

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (file instanceof TFile && ["md", "canvas", "base"].includes(file.extension.toLowerCase())) this.lastMarkdownFile = file;
        if (file?.path) this.markNoteReviewed(file.path);
        if (file?.path && /\.md$/i.test(file.path) && !isTemplateOrArchivePath(file.path)) {
          this.eventPublishFlagState?.set(file.path, this.readPublishCheckboxFlag(file));
          void this.refreshEventPublishAnalysis?.(file);
        }
        this.updateStatusBar();
        this.attachLiveSessionToActiveNote(file);
        this.refreshDockViews();
      }),
    );

    this.registerEvent(
      this.app.workspace.on("editor-change", (editor, info) => {
        if (this.liveApplyingRemote) return;
        const file = info?.file ?? this.activeNote();
        if (!file) return;
        this.lastEditorInputAt?.set(file.path, Date.now());
        const session = this.liveSession;
        const liveHandling = Boolean(this.vaultConfig.liveEnabled && session?.file === file && this.liveSessionAuthorized(session));
        if (this.isPathInDriveRoot(file.path) && !(liveHandling && session?.kind === "drive")) {
          this.dirtyDriveFiles ??= new Set();
          this.dirtyDriveFiles.add(file.path);
          this.scheduleDriveSync(file.path);
        }
        if (this.platformNote(file) && this.activeNote() === file) this.queuePublishCheck();
        if (liveHandling) {
          this.scheduleLiveEditorPush(editor, file, session.key || session.slug);
        }
      }),
    );

    const handleEditorMediaTransfer = (event, editor, info) => {
      try {
        const dt = event?.clipboardData || event?.dataTransfer;
        const files = dt?.files ? Array.from(dt.files).filter(f => /^image\/(png|jpe?g|webp|gif)$/i.test(f?.type || "")) : [];
        if (!files.length) return;
        const file = info?.file ?? this.activeNote();
        if (!file || !this.accountVerified || !this.vaultConfig?.deviceToken) return;
        if (!this.isPathInDriveRoot(file.path) && !this.linkFor?.(file)) return;
        event.preventDefault();
        void this.uploadEditorImagesToSite(files, editor, file);
      } catch {}
    };
    this.registerEvent(this.app.workspace.on("editor-paste", handleEditorMediaTransfer));
    this.registerEvent(this.app.workspace.on("editor-drop", handleEditorMediaTransfer));

    this.registerEvent(this.app.metadataCache.on("changed", file => {
      if (file?.path && /\.md$/i.test(file.path)) {
        this._personFunnelIndexCache = null;
        this.handleEventMetadataChanged?.(file);
        if (isPlatformItemPath(file.path) || isPlatformPersonPath(file.path) || this.personStatusForPath?.(file.path)) {
          if (this._badgeRefreshTimer) clearTimeout(this._badgeRefreshTimer);
          this._badgeRefreshTimer = setTimeout(() => {
            this._badgeRefreshTimer = null;
            if (this.alive) this.renderFileExplorerBadges();
          }, 90);
        }
      }
      if (this.activeNote() !== file) return;
      const platform = this.platformNote(file);
      if (!platform) {
        const target = this.liveTargetFor(file);
        const curKey = this.liveSession ? (this.liveSession.key || this.liveSession.slug) : null;
        if (target && (this.liveSession?.file !== file || curKey !== target.key)) {
          this.attachLiveSessionToActiveNote(file);
          this.refreshDockViews();
        }
        return;
      }
      const binding = [file.path,platform.id].join(":");
      if (this.activePlatformBinding !== binding) {
        this.activePlatformBinding = binding;
        this.attachLiveSessionToActiveNote(file);
        this.refreshDockViews();
      }
      this.queuePublishCheck();
    }));
    if (typeof this.app.metadataCache?.on === "function") {
      try {
        this.registerEvent(this.app.metadataCache.on("resolved", () => {
          if (this.alive) this.renderFileExplorerBadges();
        }));
      } catch {}
    }

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFolder) {
          menu.addSeparator();
          const folderDriveId = this.driveFolders?.get?.(file.path)?.id || null;
          if (folderDriveId && DRIVE_ID.test(folderDriveId)) {
            menu.addItem((item) =>
              item
                .setTitle("🔗 Вставити / скопіювати тег папки Google Drive")
                .setIcon("link")
                .onClick(() => void this.tagDriveEntry(folderDriveId, file.name, "application/vnd.google-apps.folder")),
            );
          }
          menu.addItem((item) =>
            item
              .setTitle("💎 FlightClub: Зробити локальною папкою синхронізації Vault")
              .setIcon("folder-sync")
              .onClick(async () => {
                this.vaultConfig.localVaultRoot = file.path;
                this.vaultConfig.userPinnedLocalRoot = true;
                await this.persist();
                this.updateStatusBar();
                this.refreshDockViews();
                new Notice("📁 Локальна папка синхронізації: " + file.path);
              }),
          );
          return;
        }
        if (!(file instanceof TFile)) return;
        const ext = String(file.extension || "").toLowerCase();
        if (ext === "md") {
          menu.addSeparator();
          this.fillMenu(menu, file);
          const mdDriveId = this.resolveDriveIdForFile?.(file) || null;
          if (mdDriveId) {
            menu.addItem((item) =>
              item
                .setTitle("🔗 Тегнути цей файл Drive ([[drive:...]])")
                .setIcon("hard-drive")
                .onClick(() => void this.tagDriveEntry(mdDriveId, file.name)),
            );
          }
          return;
        }
        const editTarget = this.siteEditTarget(file);
        const rawDriveId = this.resolveDriveIdForFile?.(file) || null;
        if (editTarget || rawDriveId || this.isPathInDriveRoot(file.path)) {
          menu.addSeparator();
          if (rawDriveId) {
            menu.addItem((item) =>
              item
                .setTitle("🔗 Тегнути цей файл Drive ([[drive:...]])")
                .setIcon("hard-drive")
                .onClick(() => void this.tagDriveEntry(rawDriveId, file.name)),
            );
          }
          if (editTarget) {
            menu.addItem((item) => item.setTitle(editTarget.label).setIcon("pencil").onClick(() => this.openSite(editTarget.url)));
          }
          if (this.vaultConfig?.deviceToken) {
            menu.addItem((item) => item.setTitle("🔄 Синхронізувати з Google Drive").setIcon("refresh-cw").onClick(() => void this.startVaultDownload()));
          }
        }
      }),
    );

    this.addCommand({ id: "sync-vault-folder", name: "Синхронізувати спільну папку FlightClub Sync", callback: () => void this.previewTreeSync() });
    this.addCommand({
      id: "drive-sync-now",
      name: "🔄 Синхронізувати Google Drive зараз (Драйв головний)",
      hotkeys: [{ modifiers: ["Alt", "Shift"], key: "G" }],
      callback: () => void this.startVaultDownload(message => new Notice(message)),
    });
    // Clear, intuitive commands with default hotkeys
    this.addCommand({
      id: "open-command-deck",
      name: "💎 Панель FlightClub Live Hub (Бокова панель & Керування)",
      hotkeys: [{ modifiers: ["Alt", "Shift"], key: "F" }],
      callback: () => void this.activateDockView(true),
    });
    this.addCommand({
      id: "pair-obsidian-live",
      name: "🚀 Увійти та прив'язати аккаунт FlightClub (1 клік)",
      hotkeys: [{ modifiers: ["Alt", "Shift"], key: "P" }],
      callback: () => this.startPairingFlow(),
    });
    this.addCommand({
      id: "toggle-live-collab",
      name: "Спільне редагування: Увімкнути / призупинити спільне редагування",
      hotkeys: [{ modifiers: ["Alt", "Shift"], key: "L" }],
      callback: () => void this.toggleLiveMode(),
    });
    this.addCommand({
      id: "direct-save-page",
      name: "💾 Зберегти нотатку на сайт /m/ (1 клік)",
      hotkeys: [{ modifiers: ["Alt", "Shift"], key: "S" }],
      checkCallback: (checking) => {
        const file = this.activeNote();
        if (!file || this.platformNote(file)) return false;
        if (!checking) void this.directSaveNote(file);
        return true;
      },
    });
    this.addCommand({
      id: "insert-reference",
      name: "🔗 Вставити згадку сайту (@Людина / 📦Майно / 📅Подія / 🗂️Drive)",
      hotkeys: [{ modifiers: ["Alt", "Shift"], key: "M" }],
      editorCallback: (editor, view) => this.openEntityPickerModal(editor, view?.file),
    });
    this.addCommand({
      id: "insert-drive-reference",
      name: "🗂️ Тегнути файл Google Drive (клікабельний лінк [[drive:...]])",
      hotkeys: [{ modifiers: ["Alt", "Shift"], key: "R" }],
      editorCallback: (editor, view) => this.openEntityPickerModal(editor, view?.file, "drive"),
    });
    this.addCommand({
      id: "open-zone-graph",
      name: "Огляд нотаток: напрями, теми й дати",
      hotkeys: [{ modifiers: ["Alt", "Shift"], key: "K" }],
      callback: () => void this.activateZoneGraphView(this.zoneGraphMode || "domains"),
    });
    this.addCommand({
      id: "apply-native-graph-domains",
      name: "🎨 Нативний граф Obsidian: Кольори за напрямами FlightClub",
      callback: () => void this.applyNativeObsidianGraphPreset("domains", true),
    });
    this.addCommand({
      id: "manage-team-plugins",
      name: "🧩 ADMAX: Налаштувати спільні плагіни команди",
      checkCallback: (checking) => {
        if (!this.accountVerified || !this.accountIsAdmax) return false;
        if (!checking) void this.openAdmaxTeamPluginsModal();
        return true;
      },
    });
    this.addCommand({
      id: "install-team-plugins",
      name: "🧩 Встановити плагіни команди з Community Plugins",
      checkCallback: (checking) => {
        if (!this.accountVerified || !this.vaultConfig?.deviceToken) return false;
        if (!checking) void this.openTeamPluginsInstallerModal();
        return true;
      },
    });
    this.addCommand({
      id: "publish-current-event",
      name: "📅 Опублікувати подію (Google Calendar · Discord · WhatsApp)",
      checkCallback: (checking) => {
        const file = this.activeNote();
        if (!file || !/\.md$/i.test(file.path || "") || isTemplateOrArchivePath(file.path)) return false;
        if (!checking) void this.openEventPublishModal(file);
        return true;
      },
    });
    this.addCommand({
      id: "insert-event-publish-properties",
      name: "📋 Додати поля публікації події (опублікувати подію + event-copywrite)",
      checkCallback: (checking) => {
        const file = this.activeNote();
        if (!file || !/\.md$/i.test(file.path || "") || isTemplateOrArchivePath(file.path)) return false;
        if (!checking) void this.insertEventPublishProperties(file);
        return true;
      },
    });
    this.addCommand({
      id: "apply-native-graph-funnel",
      name: "🎨 Нативний граф Obsidian: Кольори за воронкою й статусами",
      callback: () => void this.applyNativeObsidianGraphPreset("funnel", true),
    });
    this.addCommand({
      id: "apply-native-graph-hubs",
      name: "🎨 Нативний граф Obsidian: Кольори за осередками",
      callback: () => void this.applyNativeObsidianGraphPreset("hubs", true),
    });
    this.addCommand({
      id: "apply-native-graph-timeline",
      name: "🎨 Нативний граф Obsidian: Кольори за датами та потоками",
      callback: () => void this.applyNativeObsidianGraphPreset("timeline", true),
    });
    this.addCommand({
      id: "pull-site-pages",
      name: "📥 Завантажити сторінки /m/ із сайту у локальний Vault",
      hotkeys: [{ modifiers: ["Alt", "Shift"], key: "D" }],
      callback: () => void this.pullPagesFromSite(),
    });
    this.addCommand({
      id: "sync-site-index",
      name: "🔄 Синхронізувати індекс сторінок /m/ із сайтом",
      hotkeys: [{ modifiers: ["Alt", "Shift"], key: "I" }],
      callback: () => void this.syncIndexFromSite(true),
    });
    this.addCommand({
      id: "admax-drive-vault",
      name: "🛡️ ADMAX: Керування папкою Google Drive & Vault",
      callback: () => this.openDeckModal(),
    });
    this.command(
      "create-page",
      "➕ Створити нову сторінку /m/ із нотатки",
      (file) => this.showTransfer(file, "create"),
      (file) => !this.platformNote(file),
      [{ modifiers: ["Alt", "Shift"], key: "N" }],
    );
    this.command(
      "update-page",
      "📤 Оновити сторінку /m/ через браузер",
      (file) => this.showTransfer(file, "update"),
      (file) => !!this.linkFor(file)?.version,
      [{ modifiers: ["Alt", "Shift"], key: "U" }],
    );
    this.command(
      "copy-link",
      "📋 Копіювати посилання на сайт (Vault або /m/)",
      (file) => {
        const target = this.siteEditTarget(file);
        if (target?.url) void this.copyTextToClipboard(target.url, "Лінк сторінки сайту скопійовано");
        else void this.copyLink(file);
      },
      (file) => Boolean(this.siteEditTarget(file) || this.linkFor(file)),
      [{ modifiers: ["Alt", "Shift"], key: "C" }],
    );
    this.command(
      "copy-drive-link",
      "🔗 Копіювати посилання на Google Drive файл",
      (file) => {
        const target = this.siteEditTarget(file);
        if (target?.driveUrl) void this.copyTextToClipboard(target.driveUrl, "Лінк Google Drive скопійовано");
      },
      (file) => Boolean(this.siteEditTarget(file)?.driveUrl),
    );
    this.command(
      "open-share-roles",
      "🔐 Налаштувати ролі та шерінг документа в Vault",
      (file) => {
        const target = this.siteEditTarget(file);
        if (target?.vaultShareUrl) this.openSite(target.vaultShareUrl);
      },
      (file) => Boolean(this.siteEditTarget(file)?.vaultShareUrl),
    );
    this.command(
      "open-page",
      "✏️ Редагувати поточну нотатку на сайті FlightClub",
      (file) => { const target = this.siteEditTarget(file); if (target) this.openSite(target.url); },
      (file) => Boolean(this.siteEditTarget(file)),
      [{ modifiers: ["Alt", "Shift"], key: "O" }],
    );
    this.command(
      "attach-link",
      "📎 Прив’язати наявне посилання /m/ до нотатки",
      (file) => this.attachLink(file),
      (file) => !this.platformNote(file),
      [{ modifiers: ["Alt", "Shift"], key: "A" }],
    );

    this.addCommand({id:'update-plugin',name:'Перевірити й оновити плагін FlightClub',callback:()=>void this.checkPluginVersion(true,true)});
    this.registerInterval(setInterval(()=>{if(this.alive)void this.checkPluginVersion(true,false);},6*60*60*1000));
    this.registerInterval(setInterval(() => { if (!document.hidden) void this.runAutomaticDriveSync({ periodic: true }); }, 60_000));
    this.registerInterval(setInterval(() => { if (!document.hidden) void this.runAutomaticFolderSync(); }, 45_000));
    this.registerInterval(setInterval(() => { if (!document.hidden) void this.sharedVaultPulse(); }, 15_000));
    this.registerInterval(setInterval(() => { if (!document.hidden) void this.fetchWorkspaceActivity(); }, 15_000));
    this.registerObsidianProtocolHandler("flightclub-markdown", (data) => this.receiveLink(data));
    this.registerMarkdownPostProcessor((element) => {
      renderReadingMentions(element, (href, host) => this.openSite(href, host));
    });
    this.registerMarkdownCodeBlockProcessor("youtube", (source, element, context) => {
      this.renderYouTubeBlock(source, element, context);
    });
    this.registerMentionEditor();
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      this.onVaultFileChanged("rename", file, oldPath);
      this.rekey(oldPath, file.path);
      this.queueFolderSync(file.path, oldPath);
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      this.onVaultFileChanged("delete", file);
      this.rekey(file.path);
      this.queueFolderSync(file.path);
    }));
    this.registerEvent(this.app.vault.on("create", (file) => {
      this.onVaultFileChanged("create", file);
      this.queueFolderSync(file.path);
    }));
    this.registerEvent(this.app.vault.on("modify", (file) => {
      this.onVaultFileChanged("modify", file);
      this.queueFolderSync(file.path);
      if (this.app.workspace.getActiveFile() === file) this.queuePublishCheck();
    }));
    this.registerEvent(this.app.workspace.on("file-open", () => {
      this.enhanceGeneratedCanvasLeaves();
      this.queuePublishCheck();
      void this.sharedVaultPulse();
      if (this.folderSyncOpenPending) {
        this.folderSyncDirty = true;
        void this.runAutomaticFolderSync();
      }
    }));

    this.registerEvent(this.app.workspace.on("layout-change", () => this.enhanceNativeObsidianGraphLeaves()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.enhanceNativeObsidianGraphLeaves()));

    if (this.app.workspace?.onLayoutReady) {
      this.app.workspace.onLayoutReady(() => {
        if (!this.alive) return;
        this.versionPromptReady=true;void this.checkPluginVersion(false,true);
        void this.activateDockView(false);
        void this.syncIndexFromSite(false);
        if (this.vaultConfig.deviceToken) void this.prepareVaultImport();
        const active = this.activeNote();
        if (active?.path) this.markNoteReviewed(active.path);
        this.setupFileExplorerObserver();
        this.renderFileExplorerBadges();
        this.enhanceNativeObsidianGraphLeaves();
        this.attachLiveSessionToActiveNote(active);
      });
    } else {
      this.setupFileExplorerObserver();
      this.renderFileExplorerBadges();
      this.enhanceNativeObsidianGraphLeaves();
      setTimeout(() => {
        if (this.alive) this.attachLiveSessionToActiveNote(this.activeNote());
      }, 400);
    }
  }

  renderYouTubeBlock(source, element, context) {
    element.empty?.();
    const video = typeof parseMarkdownYouTube === "function" ? parseMarkdownYouTube(source) : null;
    if (!video) {
      element.createEl("p", {
        cls: "fc-md-video-error",
        text: "Укажіть HTTPS-посилання на одне відео YouTube й назву окремим рядком за потреби.",
      });
      return;
    }
    const figure = element.createEl("figure", {
      cls: "fc-md-video" + (video.vertical ? " fc-md-video--vertical" : ""),
      attr: { "data-fc-md-video": video.id },
    });
    const screen = figure.createDiv({ cls: "fc-md-video-screen" });
    const play = screen.createEl("button", {
      cls: "fc-md-video-play",
      attr: { type: "button", "data-fc-md-video-play": "" },
    });
    play.createSpan({ cls: "fc-md-video-icon", attr: { "aria-hidden": "true" } });
    play.createSpan({ cls: "fc-md-video-label", text: "Відтворити відео" });
    play.createSpan({ cls: "fc-md-video-title", text: video.title });
    const footer = figure.createEl("figcaption", { cls: "fc-md-video-footer" });
    const link = footer.createEl("a", {
      text: "Відкрити на YouTube ",
      attr: { href: video.href, target: "_blank", rel: "noopener noreferrer" },
    });
    link.createSpan({ text: "↗", attr: { "aria-hidden": "true" } });

    const child = new obsidian.MarkdownRenderChild(element);
    context.addChild(child);
    child.registerDomEvent(play, "click", async () => {
      const target = screen.ownerDocument.createElement("div");
      target.className = "fc-md-video-native";
      target.tabIndex = -1;
      target.setAttribute("aria-label", video.title);
      screen.replaceChildren(target);
      target.focus();
      // Obsidian supplies the platform-specific YouTube playback integration.
      try {
        await obsidian.MarkdownRenderer.render(this.app, `![](${video.href})`, target, context.sourcePath, child);
        const frame = target.querySelector("iframe");
        if (frame) frame.title = video.title;
      } catch {
        target.textContent = "Скористайтеся посиланням «Відкрити на YouTube».";
      }
    });
  }

  onunload() {
    this.alive = false;
    this.teardownFileExplorerObserver();
    this.teardownNativeGraphOverlays();
    this.updateDialog?.close();
    for(const done of this.requestWaiters||[])done();this.requestWaiters?.clear();
    this.pending = null;
    this.pendingVault = null;
    this.pendingPair = null;
    if (this.pairTimer) clearTimeout(this.pairTimer);
    clearTimeout(this.publishCheckTimer);
    clearTimeout(this.folderSyncTimer);
    for (const timer of this.priorityCanvasJobs?.values() ?? []) clearTimeout(timer);
    clearTimeout(this.treeBadgeExpiryTimer);
    this.treeBadgeExpiryTimer = null;
    if (this.baselineTimer) { clearTimeout(this.baselineTimer); void this.persist().catch(() => {}); }
    this.stopLiveSession();
    this.closeUpdateDetails?.();
    this.dialog?.close();
  }

  recordUnreviewedSiteUpdate(path, { count = 1, changes = [], excerpts = [], summary = "Автооновлення із сайту", kind = "platform", updatedAt = new Date().toISOString(), editorName = null, editorUserId = null, editedAt = null } = {}) {
    if (!path || typeof path !== "string") return false;
    if (path === "FlightClub Sync Archive" || path.startsWith("FlightClub Sync Archive/")) return false;
    const myUserId = this.vaultConfig?.pairedUserId || null;
    if (editorUserId && myUserId && String(editorUserId).toLowerCase() === String(myUserId).toLowerCase()) return false;
    const active = this.activeNote?.();
    if (active?.path === path) return false;
    this.unreviewedUpdates ??= new Map();
    const prev = this.unreviewedUpdates.get(path);
    const delta = Math.max(1, Math.min(99, Number(count) || 1));
    const nextCount = Math.min(99, (prev?.count || 0) + delta);
    const cleanEditor = typeof editorName === "string" && editorName.trim() ? editorName.trim().slice(0, 80) : (prev?.editorName || null);
    const cleanEditorId = typeof editorUserId === "string" && editorUserId.trim() ? editorUserId.trim().slice(0, 64) : (prev?.editorUserId || null);
    const cleanEditedAt = typeof editedAt === "string" && editedAt.trim() ? editedAt.trim() : updatedAt;
    const cleanSummary = String(summary || "Автооновлення із сайту").trim().slice(0, 240);
    const actions = [cleanSummary, ...(prev?.actions || []).filter(a => a !== cleanSummary)].slice(0, 5);
    const nowMs = Date.now();
    const update = {
      count: nextCount,
      changes: readUpdateDetails([...readUpdateDetails(changes), ...(prev?.changes || [])]),
      summary: actions[0] || cleanSummary,
      actions,
      kind: kind || prev?.kind || "platform",
      updatedAt,
      editorName: cleanEditor,
      editorUserId: cleanEditorId,
      editedAt: cleanEditedAt,
      shownInTreeAt: nowMs,
      treeDismissed: false,
    };
    if (excerpts.length) updateExcerpts.set(update, excerpts);
    this.unreviewedUpdates.set(path, update);
    if (this.unreviewedUpdates.size > 500) {
      const oldestKey = this.unreviewedUpdates.keys().next().value;
      if (oldestKey && oldestKey !== path) this.unreviewedUpdates.delete(oldestKey);
    }
    this.renderFileExplorerBadges();
    this.scheduleTreeBadgeExpiry();
    return true;
  }

  counterTimeoutSec() {
    const raw = Number(this.vaultConfig?.counterTimeoutSec);
    return [-1, 0, 30, 120].includes(raw) ? raw : 30;
  }

  isTreeBadgeVisible(info, nowMs = Date.now()) {
    if (!info || (Number(info.count) || 0) <= 0) return false;
    const ttl = this.counterTimeoutSec();
    if (ttl < 0) return false;
    if (ttl === 0) return info.treeDismissed !== true;
    if (info.treeDismissed === true) return false;
    const started = Number.isFinite(Number(info.shownInTreeAt))
      ? Number(info.shownInTreeAt)
      : (Date.parse(info.editedAt || info.updatedAt || "") || nowMs);
    return (nowMs - started) < ttl * 1000;
  }

  expireStaleTreeBadges(nowMs = Date.now()) {
    const ttl = this.counterTimeoutSec();
    if (ttl <= 0 || !this.unreviewedUpdates?.size) return 0;
    let expired = 0;
    for (const info of this.unreviewedUpdates.values()) {
      if (!info || info.treeDismissed) continue;
      const started = Number.isFinite(Number(info.shownInTreeAt))
        ? Number(info.shownInTreeAt)
        : (Date.parse(info.editedAt || info.updatedAt || "") || nowMs);
      if ((nowMs - started) >= ttl * 1000) {
        info.treeDismissed = true;
        expired++;
      }
    }
    if (expired > 0) this.renderFileExplorerBadges();
    this.scheduleTreeBadgeExpiry(nowMs);
    return expired;
  }

  scheduleTreeBadgeExpiry(nowMs = Date.now()) {
    if (this.treeBadgeExpiryTimer) {
      clearTimeout(this.treeBadgeExpiryTimer);
      this.treeBadgeExpiryTimer = null;
    }
    if (!this.alive) return;
    const ttl = this.counterTimeoutSec();
    if (ttl <= 0 || !this.unreviewedUpdates?.size) return;
    let minDelay = Infinity;
    for (const info of this.unreviewedUpdates.values()) {
      if (!info || info.treeDismissed) continue;
      const started = Number.isFinite(Number(info.shownInTreeAt))
        ? Number(info.shownInTreeAt)
        : (Date.parse(info.editedAt || info.updatedAt || "") || nowMs);
      const rem = (ttl * 1000) - (nowMs - started);
      if (rem < minDelay) minDelay = rem;
    }
    if (!Number.isFinite(minDelay)) return;
    const waitMs = Math.max(80, Math.min(minDelay + 60, 600_000));
    const t = setTimeout(() => {
      this.treeBadgeExpiryTimer = null;
      if (this.alive) this.expireStaleTreeBadges(Date.now());
    }, waitMs);
    if (typeof t?.unref === "function") t.unref();
    this.treeBadgeExpiryTimer = t;
  }

  setCounterTimeoutSec(sec) {
    const next = [-1, 0, 30, 120].includes(Number(sec)) ? Number(sec) : 30;
    if (!this.vaultConfig) this.vaultConfig = readVaultConfig({});
    this.vaultConfig.counterTimeoutSec = next;
    const nowMs = Date.now();
    for (const info of (this.unreviewedUpdates || new Map()).values()) {
      if (!info) continue;
      if (next === 0) {
        info.treeDismissed = false;
      } else if (next > 0) {
        info.shownInTreeAt = nowMs;
        info.treeDismissed = false;
      }
    }
    this.renderFileExplorerBadges();
    this.scheduleTreeBadgeExpiry(nowMs);
    this.refreshDockViews(true);
    void this.persist().catch(() => {});
  }

  markNoteReviewed(fileOrPath) {
    const path = typeof fileOrPath === "string" ? fileOrPath : fileOrPath?.path;
    if (!path || !this.unreviewedUpdates?.has(path)) return false;
    this.unreviewedUpdates.delete(path);
    this.renderFileExplorerBadges();
    if (this.baselineTimer) clearTimeout(this.baselineTimer);
    this.baselineTimer = setTimeout(() => {
      this.baselineTimer = null;
      if (this.alive) void this.persist().catch(() => {});
    }, 800);
    return true;
  }

  clearAllUnreviewedUpdates() {
    if (!this.unreviewedUpdates?.size) return;
    this.unreviewedUpdates.clear();
    this.renderFileExplorerBadges();
    this.updateStatusBar();
    this.refreshDockViews();
    void this.persist().catch(() => {});
  }

  totalUnreviewedUpdateCount() {
    if (!this.unreviewedUpdates?.size) return 0;
    let total = 0;
    for (const [uPath, info] of this.unreviewedUpdates.entries()) {
      if (typeof uPath === "string" && (uPath === "FlightClub Sync Archive" || uPath.startsWith("FlightClub Sync Archive/"))) continue;
      total += Math.max(0, Number(info?.count) || 0);
    }
    return total;
  }

  equipmentStatusForPath(filePath) {
    if (!filePath || typeof filePath !== "string") return null;
    const base = this.driveFiles?.get(filePath);
    const isItem = isPlatformItemPath(filePath) || (base?.kind === "platform" && base?.entity === "item");
    if (!isItem) return null;
    let fm = null;
    try {
      const f = this.app?.vault?.getAbstractFileByPath?.(filePath);
      if (f) fm = this.app?.metadataCache?.getFileCache?.(f)?.frontmatter || null;
    } catch {}
    const rawStatus = fm?.["item-status"] ?? base?.itemStatus ?? null;
    const meta = normalizeEquipmentStatus(typeof rawStatus === "string" ? rawStatus : null);
    if (!meta) return null;
    const holder = (typeof fm?.["item-holder"] === "string" && fm["item-holder"].trim()) ? fm["item-holder"].trim() : (base?.itemHolder || null);
    const hub = (typeof fm?.["item-hub"] === "string" && fm["item-hub"].trim()) ? fm["item-hub"].trim() : (base?.itemHub || null);
    const condition = (typeof fm?.["item-condition"] === "string" && fm["item-condition"].trim()) ? fm["item-condition"].trim() : (base?.itemCondition || null);
    const tipParts = [
      `${meta.dot} Статус майна: ${meta.fullLabel}`,
      holder ? `Утримувач: ${holder}` : null,
      hub ? `Осередок: ${hub}` : null,
      condition ? `Стан: ${condition}` : null,
    ].filter(Boolean);
    return { ...meta, holder, hub, condition, tooltip: tipParts.join(" · ") };
  }

  ensureSyncArchiveIgnored() {
    try {
      const vault = this.app?.vault;
      if (!vault || typeof vault.getConfig !== "function" || typeof vault.setConfig !== "function") return false;
      const current = vault.getConfig("userIgnoreFilters");
      const list = Array.isArray(current) ? current.filter(v => typeof v === "string") : [];
      const hasArchive = list.some(pattern => pattern === "FlightClub Sync Archive/" || pattern === "^FlightClub Sync Archive/" || pattern === "FlightClub Sync Archive");
      if (hasArchive) return false;
      vault.setConfig("userIgnoreFilters", [...list, "FlightClub Sync Archive/"]);
      return true;
    } catch {
      return false;
    }
  }

  buildPersonFunnelIndex() {
    const now = Date.now();
    if (this._personFunnelIndexCache && (now - this._personFunnelIndexCache.at) < 4000) {
      return this._personFunnelIndexCache;
    }
    const map = new Map();
    const platformByPerson = new Map();
    const formsByPerson = new Map();
    try {
      const files = typeof this.app?.vault?.getMarkdownFiles === "function" ? this.app.vault.getMarkdownFiles() : [];
      for (const f of files) {
        if (!f?.path || isTemplateOrArchivePath(f.path)) continue;
        if (f.path.startsWith(SHARED_FOLDER) || /(?:^|\/)Курсанти - профілі(?:\/|$)/i.test(f.path)) continue;
        if (/^(?:Профіль курсантів|SOP\b|Шаблон|Template)/i.test(String(f.basename || "").trim())) continue;
        const fm = this.app?.metadataCache?.getFileCache?.(f)?.frontmatter;
        if (isPlatformPersonPath(f.path)) {
          const names = [f.basename, extractFrontmatterString(fm?.["user-name"])].filter(Boolean);
          for (const n of names) {
            for (const k of personLookupKeys(n)) {
              if (!platformByPerson.has(k)) platformByPerson.set(k, f);
            }
          }
          continue;
        }
        if (!fm) continue;
        const isDashedForm = String(f.basename || "").includes(" - ");
        const funnel = normalizeCadetFunnelStatus(fm["status-profile"] ?? fm["profile-status"] ?? fm["status-lead"]);
        const team = normalizeTeamStatus(fm["status-team"]);
        const city = extractFrontmatterString(fm["місто"] ?? fm["event-city"] ?? fm["user-hub"]);
        if (isDashedForm && (funnel || team || (Array.isArray(fm.tags) && fm.tags.some(t => String(t).includes("профіль"))))) {
          const baseName = String(f.basename).split(" - ")[0].trim();
          const formNames = [baseName, extractFrontmatterString(fm["Імʼя та прізвище"]), extractFrontmatterString(fm["Ім'я та прізвище"])].filter(Boolean);
          for (const n of formNames) {
            for (const k of personLookupKeys(n)) {
              const arr = formsByPerson.get(k) || [];
              if (!arr.some(existing => existing.path === f.path)) arr.push(f);
              formsByPerson.set(k, arr);
            }
          }
          continue;
        }
        if (!funnel && !team) continue;
        const entry = { funnel, team, city, path: f.path, file: f };
        const names = [
          f.basename,
          extractFrontmatterString(fm["Імʼя та прізвище"]),
          extractFrontmatterString(fm["Ім'я та прізвище"]),
          extractFrontmatterString(fm["profile - full name"]),
          extractFrontmatterString(fm["user-name"]),
        ].filter(Boolean);
        for (const n of names) {
          for (const key of personLookupKeys(n)) {
            const prev = map.get(key);
            if (!prev || (!prev.funnel && entry.funnel) || (prev.funnel?.key === "person-unknown" && entry.funnel && entry.funnel.key !== "person-unknown")) {
              map.set(key, entry);
            }
          }
        }
      }
    } catch {}
    this._personFunnelIndexCache = { at: now, map, platformByPerson, formsByPerson };
    return this._personFunnelIndexCache;
  }

  relatedPersonNotesForPath(filePath) {
    if (!filePath || typeof filePath !== "string" || !/\.md$/i.test(filePath) || isTemplateOrArchivePath(filePath)) return null;
    const bundle = this.buildPersonFunnelIndex();
    let file = null;
    let fm = null;
    try {
      file = this.app?.vault?.getAbstractFileByPath?.(filePath) || null;
      if (file) fm = this.app?.metadataCache?.getFileCache?.(file)?.frontmatter || null;
    } catch {}
    const stem = file?.basename || filePath.split("/").pop()?.replace(/\.md$/i, "") || "";
    const baseName = stem.includes(" - ") ? stem.split(" - ")[0].trim() : stem;
    const candidateNames = [
      baseName,
      extractFrontmatterString(fm?.["user-name"]),
      extractFrontmatterString(fm?.["Імʼя та прізвище"]),
      extractFrontmatterString(fm?.["Ім'я та прізвище"]),
      extractFrontmatterString(fm?.["profile - full name"]),
    ].filter(Boolean);
    const keys = [];
    for (const n of candidateNames) {
      for (const k of personLookupKeys(n)) {
        if (!keys.includes(k)) keys.push(k);
      }
    }
    let trainingFile = null;
    let platformFile = null;
    const formFiles = [];
    const seenForm = new Set();
    for (const k of keys) {
      if (!trainingFile && bundle.map.has(k)) {
        const candidate = bundle.map.get(k)?.file || null;
        if (candidate && candidate.path !== filePath) trainingFile = candidate;
      }
      if (!platformFile && bundle.platformByPerson.has(k)) {
        const candidate = bundle.platformByPerson.get(k) || null;
        if (candidate && candidate.path !== filePath) platformFile = candidate;
      }
      if (bundle.formsByPerson.has(k)) {
        for (const ff of bundle.formsByPerson.get(k)) {
          if (ff.path !== filePath && !seenForm.has(ff.path)) {
            seenForm.add(ff.path);
            formFiles.push(ff);
          }
        }
      }
    }
    if (!trainingFile && !platformFile && !formFiles.length) return null;
    return { trainingFile, platformFile, formFiles: formFiles.slice(0, 3) };
  }

  personStatusForPath(filePath, funnelIndex = null) {
    if (!filePath || typeof filePath !== "string" || !/\.md$/i.test(filePath) || isTemplateOrArchivePath(filePath)) return null;
    const rawStem = filePath.split("/").pop()?.replace(/\.md$/i, "") || "";
    if (/^(?:Профіль курсантів|SOP\b|Шаблон|Template)/i.test(rawStem.trim())) return null;
    let file = null;
    let fm = null;
    try {
      file = this.app?.vault?.getAbstractFileByPath?.(filePath) || null;
      if (file) fm = this.app?.metadataCache?.getFileCache?.(file)?.frontmatter || null;
    } catch {}
    const base = this.driveFiles?.get(filePath);
    const isPlatformUser = isPlatformPersonPath(filePath) || (base?.kind === "platform" && base?.entity === "user") || fm?.["fc-kind"] === "user";
    const directFunnel = fm ? normalizeCadetFunnelStatus(fm["status-profile"] ?? fm["profile-status"] ?? fm["status-lead"] ?? fm["user-funnel-status"]) : null;
    const directTeam = fm ? normalizeTeamStatus(fm["status-team"]) : null;
    const directRoles = fm ? normalizePlatformPersonRoles(fm["user-roles"]) : null;
    const city = extractFrontmatterString(fm?.["місто"] ?? fm?.["user-hub"] ?? fm?.["event-city"]);

    const idx = funnelIndex instanceof Map ? funnelIndex : this.buildPersonFunnelIndex().map;

    // Secondary city/form copy (e.g. "Марія Ілечко - Львів.md") when canonical profile exists:
    // label clearly as "дубль · анкета" instead of misleading grey "невідомо"!
    if (!isPlatformUser && rawStem.includes(" - ")) {
      const baseName = rawStem.split(" - ")[0].trim();
      let canonical = null;
      for (const k of personLookupKeys(baseName)) {
        if (idx.has(k) && idx.get(k).path !== filePath) { canonical = idx.get(k); break; }
      }
      if (canonical && (directFunnel || directTeam || (Array.isArray(fm?.tags) && fm.tags.some(t => String(t).includes("профіль"))))) {
        const canonicalStage = canonical.funnel?.fullLabel || canonical.team?.fullLabel || "";
        const tipParts = [
          `📋 Вторинний запис / анкета${city ? ` (${city})` : ""}`,
          `⭐ Основний профіль: ${canonical.file?.basename || baseName}${canonicalStage ? ` — ${canonicalStage}` : ""}`,
          directFunnel && directFunnel.key !== "person-unknown" ? `Статус цього файлу: ${directFunnel.fullLabel}` : null,
        ].filter(Boolean);
        return {
          key: "person-form-dup",
          label: "дубль · анкета",
          fullLabel: "Вторинний запис анкети (є основний профіль)",
          cls: "is-p-archive-dup",
          dot: "📋",
          category: "person",
          funnel: directFunnel,
          team: directTeam,
          roles: null,
          city: city || canonical.city || null,
          tooltip: tipParts.join("\n"),
        };
      }
    }

    let matchedFunnel = null;
    if (isPlatformUser && !directFunnel) {
      const stem = file?.basename || rawStem;
      const names = [extractFrontmatterString(fm?.["user-name"]), stem].filter(Boolean);
      outer: for (const n of names) {
        for (const k of personLookupKeys(n)) {
          if (idx.has(k)) { matchedFunnel = idx.get(k); break outer; }
        }
      }
    }

    const funnel = directFunnel || matchedFunnel?.funnel || null;
    const team = directTeam || matchedFunnel?.team || null;
    let primary = null;
    if (isPlatformUser) {
      const strongFunnel = funnel && funnel.key !== "person-unknown" ? funnel : null;
      const achievementFunnel = strongFunnel && ["person-job", "person-altushka"].includes(strongFunnel.key) ? strongFunnel : null;
      if (directRoles?.isStaff) {
        primary = achievementFunnel || directRoles;
      } else {
        primary = strongFunnel || team || directRoles;
      }
    } else {
      primary = funnel || team;
    }
    if (!primary) return null;

    const tipParts = [];
    if (funnel) tipParts.push(`${funnel.dot} Воронка: ${funnel.fullLabel}${funnel.raw && !funnel.fullLabel.includes(funnel.raw) ? ` (${funnel.raw})` : ""}`);
    if (team) tipParts.push(`${team.dot} ${team.fullLabel}${team.raw && !team.fullLabel.includes(team.raw) ? ` (${team.raw})` : ""}`);
    if (directRoles) tipParts.push(`${directRoles.dot} Роль на платформі: ${directRoles.allRolesUk}`);
    const resolvedCity = city || matchedFunnel?.city || "";
    if (resolvedCity) tipParts.push(`📍 Осередок / місто: ${resolvedCity}`);
    return {
      ...primary,
      category: "person",
      funnel,
      team,
      roles: directRoles,
      city: resolvedCity || null,
      tooltip: tipParts.join("\n"),
    };
  }

  renderFileExplorerBadges(rootDoc = typeof document !== "undefined" ? document : null) {
    if (!rootDoc || typeof rootDoc.querySelectorAll !== "function") return;
    const updates = this.unreviewedUpdates || new Map();
    const nowMs = Date.now();
    const funnelIndex = this.buildPersonFunnelIndex().map;
    const folderTotals = new Map();
    for (const [filePath, info] of updates.entries()) {
      const c = Math.max(0, Number(info?.count) || 0);
      if (!c || typeof filePath !== "string") continue;
      if (!this.isTreeBadgeVisible(info, nowMs)) continue;
      if (filePath === "FlightClub Sync Archive" || filePath.startsWith("FlightClub Sync Archive/")) continue;
      const tone = badgeToneForKind(info.kind, filePath);
      const parts = filePath.split("/");
      const stem = parts.at(-1)?.replace(/\.(?:md|canvas|base)$/i, "") || filePath;
      const when = formatEditorTimestamp(info.editedAt || info.updatedAt);
      const who = info.editorName || (tone === "drive" ? "Google Drive" : "Сайт FlightClub");
      const atMs = Date.parse(info.editedAt || info.updatedAt || "") || 0;
      const folderLine = `${stem} — ${who}${when ? ` · ${when}` : ""}`;
      let prefix = "";
      for (let i = 0; i < parts.length - 1; i++) {
        prefix = prefix ? `${prefix}/${parts[i]}` : parts[i];
        const prev = folderTotals.get(prefix) || { count: 0, files: 0, platformCount: 0, driveCount: 0, items: [] };
        prev.count = Math.min(99, prev.count + c);
        prev.files += 1;
        if (tone === "drive") prev.driveCount += c;
        else prev.platformCount += c;
        prev.items.push({ atMs, line: folderLine });
        folderTotals.set(prefix, prev);
      }
    }

    const activeSyncPath = this.driveDownloading && typeof this.activeSyncPath === "string" ? this.activeSyncPath : null;
    const activeSyncAncestors = new Set();
    if (activeSyncPath) {
      const parts = activeSyncPath.split("/");
      let pref = "";
      for (let i = 0; i < parts.length - 1; i++) {
        pref = pref ? `${pref}/${parts[i]}` : parts[i];
        activeSyncAncestors.add(pref);
      }
    }

    const fileEls = rootDoc.querySelectorAll(".nav-file-title[data-path]");
    for (const el of fileEls) {
      const p = el.getAttribute("data-path");
      const rawInfo = p ? updates.get(p) : null;
      const info = rawInfo && this.isTreeBadgeVisible(rawInfo, nowMs) ? rawInfo : null;
      const stMeta = p ? (this.equipmentStatusForPath(p) || this.personStatusForPath(p, funnelIndex)) : null;
      const isSyncingNow = Boolean(activeSyncPath && p === activeSyncPath);

      let statusEl = el.querySelector("[data-fc-tree-status]");
      let badge = el.querySelector("[data-fc-tree-badge='file']");
      let syncPill = el.querySelector("[data-fc-tree-sync]");

      if (isSyncingNow) {
        if (!syncPill) {
          syncPill = rootDoc.createElement("span");
          syncPill.className = "fc-tree-sync-pill";
          syncPill.setAttribute("data-fc-tree-sync", "file");
          syncPill.textContent = "⟳ Сінк…";
          el.append(syncPill);
        }
        el.classList?.add?.("fc-is-syncing-now");
      } else {
        if (syncPill) syncPill.remove();
        el.classList?.remove?.("fc-is-syncing-now");
      }

      if (stMeta) {
        if (!statusEl) {
          statusEl = rootDoc.createElement("span");
          statusEl.setAttribute("data-fc-tree-status", stMeta.key);
          if (badge && badge.parentElement === el) el.insertBefore(statusEl, badge);
          else el.append(statusEl);
        }
        const stCls = `fc-tree-item-status ${stMeta.category === "person" ? "fc-tree-person-status " : ""}${stMeta.cls}`;
        if (statusEl.className !== stCls) statusEl.className = stCls;
        if (statusEl.getAttribute("data-fc-tree-status") !== stMeta.key) statusEl.setAttribute("data-fc-tree-status", stMeta.key);
        if (statusEl.textContent !== stMeta.label) statusEl.textContent = stMeta.label;
        if (statusEl.getAttribute("title") !== stMeta.tooltip) statusEl.setAttribute("title", stMeta.tooltip);
      } else if (statusEl) {
        statusEl.remove();
        statusEl = null;
      }

      if (info && info.count > 0) {
        const tone = badgeToneForKind(info.kind, p);
        if (!badge) {
          badge = rootDoc.createElement("span");
          badge.className = "fc-tree-update-badge";
          badge.setAttribute("data-fc-tree-badge", "file");
          el.append(badge);
        }
        const label = info.count === 1 ? "•" : String(info.count);
        if (badge.textContent !== label) badge.textContent = label;
        badge.setAttribute("data-fc-update-badge", label);
        badge.setAttribute("data-kind", info.kind || "platform");
        badge.setAttribute("data-tone", tone);
        const when = formatEditorTimestamp(info.editedAt || info.updatedAt);
        const whoLine = info.editorName
          ? `👤 Оновив: ${info.editorName}${when ? ` · ${when}` : ""}`
          : (when ? `🕒 Оновлено: ${when}` : "");
        const source = tone === "drive" ? "Drive" : "Сайт";
        const details = updateDetailLines(info);
        const tip = [`${source} · ${info.count} оновлень`, whoLine,
          ...(details.length ? details : [legacyUpdateDetail(info.summary)]),
        ].filter(Boolean).join("\n");
        if (badge.getAttribute("title") !== tip) badge.setAttribute("title", tip);
        if (el.getAttribute("title") !== tip) el.setAttribute("title", tip);
      } else {
        if (badge) {
          badge.remove();
          badge = null;
        }
        if (el.hasAttribute?.("title") && el.classList?.contains?.("fc-has-unreviewed-update")) {
          el.removeAttribute("title");
        }
      }

      if ((info && info.count > 0) || stMeta) {
        el.classList?.add?.("fc-has-unreviewed-update");
      } else {
        el.classList?.remove?.("fc-has-unreviewed-update");
      }
    }

    const folderEls = rootDoc.querySelectorAll(".nav-folder-title[data-path]");
    for (const el of folderEls) {
      const p = el.getAttribute("data-path");
      const fInfo = p ? folderTotals.get(p) : null;
      const isSyncingFolder = Boolean(p && activeSyncAncestors.has(p));
      let badge = el.querySelector("[data-fc-tree-badge='folder']");
      let fSyncPill = el.querySelector("[data-fc-tree-sync]");
      if (isSyncingFolder) {
        if (!fSyncPill) {
          fSyncPill = rootDoc.createElement("span");
          fSyncPill.className = "fc-tree-sync-pill is-folder";
          fSyncPill.setAttribute("data-fc-tree-sync", "folder");
          fSyncPill.textContent = "⟳";
          el.append(fSyncPill);
        }
        el.classList?.add?.("fc-is-syncing-now");
      } else {
        if (fSyncPill) fSyncPill.remove();
        el.classList?.remove?.("fc-is-syncing-now");
      }
      if (fInfo && fInfo.count > 0) {
        if (!badge) {
          badge = rootDoc.createElement("span");
          badge.className = "fc-tree-update-badge fc-tree-update-badge-folder";
          badge.setAttribute("data-fc-tree-badge", "folder");
          el.append(badge);
        }
        const label = String(fInfo.count);
        if (badge.textContent !== label) badge.textContent = label;
        badge.setAttribute("data-fc-update-badge", label);
        badge.setAttribute("data-tone", "folder");
        const breakdown = [
          fInfo.platformCount > 0 ? `🟡 Майно/події: +${fInfo.platformCount}` : null,
          fInfo.driveCount > 0 ? `🔵 Документи Drive: +${fInfo.driveCount}` : null,
        ].filter(Boolean).join(" · ");
        const recentLines = [...(fInfo.items || [])]
          .sort((a, b) => b.atMs - a.atMs)
          .slice(0, 6)
          .map(item => item.line);
        const tip = `🟢 Нові оновлення у папці: +${fInfo.count} (${fInfo.files} файл.)${breakdown ? "\n" + breakdown : ""}`
          + (recentLines.length ? `\n• ${recentLines.join("\n• ")}` : "");
        if (badge.getAttribute("title") !== tip) badge.setAttribute("title", tip);
        if (el.getAttribute("title") !== tip) el.setAttribute("title", tip);
        el.classList?.add?.("fc-has-unreviewed-update");
      } else {
        if (badge) badge.remove();
        if (el.hasAttribute?.("title") && el.classList?.contains?.("fc-has-unreviewed-update")) {
          el.removeAttribute("title");
        }
        el.classList?.remove?.("fc-has-unreviewed-update");
      }
    }
  }

  setupFileExplorerObserver() {
    this.teardownFileExplorerObserver();
    if (typeof MutationObserver !== "function" || typeof document === "undefined" || !document.body) return;
    let scheduled = false;
    const isOwnBadgeNode = (node) =>
      Boolean(node?.hasAttribute && (node.hasAttribute("data-fc-tree-badge") || node.hasAttribute("data-fc-tree-status") || node.hasAttribute("data-fc-tree-sync")));
    this.fileExplorerObserver = new MutationObserver((mutations) => {
      if (!this.alive || scheduled) return;
      const hasAnyBadges = Boolean(this.unreviewedUpdates?.size || this.driveFiles?.size);
      if (!hasAnyBadges) return;
      const relevant = mutations.some((m) => {
        if (isOwnBadgeNode(m.target)) return false;
        for (const n of m.addedNodes || []) {
          if (n?.nodeType === 1 && !isOwnBadgeNode(n)) return true;
        }
        return false;
      });
      if (!relevant) return;
      scheduled = true;
      const schedule = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (fn) => setTimeout(fn, 60);
      this.fileExplorerRaf = schedule(() => {
        scheduled = false;
        this.fileExplorerRaf = null;
        if (this.alive) this.renderFileExplorerBadges();
      });
    });
    try {
      this.fileExplorerObserver.observe(document.body, { childList: true, subtree: true });
    } catch {}
  }

  teardownFileExplorerObserver() {
    if (this.fileExplorerObserver) {
      try { this.fileExplorerObserver.disconnect(); } catch {}
      this.fileExplorerObserver = null;
    }
    if (this.fileExplorerRaf) {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.fileExplorerRaf);
      else clearTimeout(this.fileExplorerRaf);
      this.fileExplorerRaf = null;
    }
    if (typeof document !== "undefined" && typeof document.querySelectorAll === "function") {
      for (const b of document.querySelectorAll("[data-fc-tree-badge], [data-fc-tree-status]")) b.remove();
    }
  }

  async activateDockView(openModalFallback = false) {
    if (Platform?.isMobileApp) { this.openDeckModal(); return; }
    try {
      const ws = this.app.workspace;
      if (!ws?.getLeavesOfType) {
        if (openModalFallback) this.openDeckModal();
        return;
      }
      let leaf = ws.getLeavesOfType(DOCK_VIEW_TYPE)[0];
      if (!leaf) {
        leaf = ws.getRightLeaf?.(false) || ws.getLeaf?.(true);
        if (leaf) {
          await leaf.setViewState({ type: DOCK_VIEW_TYPE, active: true });
        }
      }
      if (leaf) {
        ws.revealLeaf?.(leaf);
        leaf.view?.render?.();
        return;
      }
    } catch {}
    if (openModalFallback) this.openDeckModal();
  }

  refreshDockViews(liveOnly = false) {
    if (this.syncReviewClose && (!this.accountVerified || this.syncActivityUserId !== this.vaultConfig.pairedUserId)) {
      this.syncReviewClose();
    }
    this.mobileHubRefresh?.(liveOnly);
    try {
      const leaves = this.app.workspace?.getLeavesOfType?.(DOCK_VIEW_TYPE) || [];
      for (const leaf of leaves) {
        if (!liveOnly || leaf.view?.activeTab === "live") leaf.view?.render?.();
      }
    } catch {}
  }

  authHeaders(overrideToken) {
    const h = {"X-FlightClub-Plugin-Version":PLUGIN_VERSION};
    const tok = overrideToken || this.vaultConfig?.deviceToken;
    if (tok) {
      h["Authorization"] = "Bearer " + tok;
    }
    return h;
  }

  async checkPluginVersion(force=false,prompt=false){
    if(!this.updater)return null;
    if(force){
      this.checkingVersion=true;
      if(this.alive)this.refreshDockViews();
    }
    try{
      const state=await this.updater.check(force);
      if(this.alive&&prompt&&(state.status==='required'||force))this.showUpdateDialog();
      return state;
    }finally{
      if(force){
        this.checkingVersion=false;
        if(this.alive)this.refreshDockViews();
      }
    }
  }

  async siteRequest(options){
    if(this.updatingPlugin)throw Object.assign(new Error('Оновлення плагіна триває.'),{code:'PLUGIN_UPDATE_IN_PROGRESS'});
    if(this.updater){
      const state=await this.checkPluginVersion(false,false);
      if(this.updater.blocked()){
        if(this.versionPromptReady&&state?.status==='required')this.showUpdateDialog();
        throw Object.assign(new Error(state?.status==='required'?'Потрібне оновлення плагіна FlightClub.':'Не вдалося перевірити версію плагіна. Відкрийте панель оновлення й повторіть перевірку.'),{code:'PLUGIN_UPDATE_REQUIRED'});
      }
    }
    const headers={...options.headers,'X-FlightClub-Plugin-Version':PLUGIN_VERSION};
    this.requestCount=(this.requestCount||0)+1;
    try{
      const response=await requestUrl({...options,headers});
      if(response.status===426)void this.checkPluginVersion(true,true);
      return response;
    }finally{
      this.requestCount--;
      if(!this.requestCount){for(const done of this.requestWaiters||[])done();this.requestWaiters?.clear();}
    }
  }

  showUpdateDialog(){
    if(this.updateDialog||!this.alive)return;
    const state=this.updater.snapshot(),modal=new Modal(this.app);this.updateDialog=modal;
    modal.onOpen=()=>{
      const content=modal.contentEl;content.addClass('fc-update-dialog');
      content.createEl('h2',{text:state.status==='required'?'Оновіть FlightClub':'Оновлення плагіна'});
      content.createEl('p',{text:'Встановлено '+PLUGIN_VERSION+(state.release?(state.status==='current'?' (актуальна · на сервері '+state.release.version+')':' · Доступно '+state.release.version):'')});
      if(state.release?.history?.length){
        const history=content.createDiv({cls:'fc-plugin-release-history',attr:{'aria-label':'Журнал версій'}});
        for(const [index,entry] of state.release.history.entries()){
          const section=history.createEl('details',{attr:index===0?{open:''}:{}});
          section.createEl('summary',{text:'Що змінилося у '+entry.version});
          const changes=section.createEl('ul');
          for(const change of entry.changes)changes.createEl('li',{text:change});
        }
      }
      content.createEl('p',{text:state.status==='required'?'Для синхронізації потрібна актуальна версія плагіна. Ваші нотатки й налаштування зберігаються.':'Перевірений пакет встановлюється зі збереженням акаунта, налаштувань і локальних файлів.'});
      const status=content.createDiv({cls:'fc-update-status',attr:{role:'status'}});
      if(state.error)status.setText('Перевірка версії недоступна. Повторіть спробу.');
      const actions=content.createDiv({cls:'fc-update-actions'});
      const isCommunityManaged=Boolean(FC_PLUGIN_UPDATE?.COMMUNITY_MANAGED);
      if(state.release&&state.status!=='current'){
        if(isCommunityManaged){
          const openCommunity=actions.createEl('button',{text:'Відкрити оновлення в Obsidian',cls:'mod-cta',attr:{type:'button'}});
          openCommunity.addEventListener('click',()=>{
            try{
              this.app?.setting?.open?.();
              this.app?.setting?.openTabById?.('community-plugins');
            }catch{}
            new Notice('Відкрийте Settings → Community Plugins та натисніть «Check for updates».');
            modal.close();
          });
        }else{
          const update=actions.createEl('button',{text:'Оновити зараз',cls:'mod-cta',attr:{type:'button'}});
          update.addEventListener('click',async()=>{
            update.disabled=true;
            status.setText('Завантажуємо й перевіряємо пакет…');
            try { await this.installPluginUpdate(); }
            catch(error) {
              status.setText(error.code==='UPDATE_ROLLBACK_REQUIRED'
                ? 'Не вдалося відновити файли плагіна. Резервна копія: '+error.backup+'. Синхронізацію призупинено до відновлення.'
                : error.code ? 'Оновлення не завершене. Попередні файли плагіна збережено. Повторіть спробу.' : error.message);
              update.disabled=false;
            }
          });
        }
      }
      const check=actions.createEl('button',{text:'Перевірити ще раз',attr:{type:'button'}});
      check.addEventListener('click',async()=>{check.disabled=true;await this.checkPluginVersion(true,false);modal.close();this.showUpdateDialog();});
      const close=actions.createEl('button',{text:'Закрити',attr:{type:'button'}});close.addEventListener('click',()=>modal.close());
    };
    modal.onClose=()=>{if(this.updateDialog===modal)this.updateDialog=null;};modal.open();
  }

  async installPluginUpdate(){
    if(FC_PLUGIN_UPDATE?.COMMUNITY_MANAGED){
      try{
        this.app?.setting?.open?.();
        this.app?.setting?.openTabById?.('community-plugins');
      }catch{}
      new Notice('Оновіть FlightClub Markdown через Community Plugins → Check for updates.');
      return;
    }
    if(this.updatingPlugin)return;
    if(this.driveDownloading||this.treeSyncBusy||this.publishingDrive||this.importingSlug){
      throw new Error('Дочекайтеся завершення імпорту або публікації.');
    }
    this.updatingPlugin=true;this.stopLiveSession();
    try{
      if(this.requestCount)await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{this.requestWaiters.delete(done);reject(new Error('Запит ще виконується. Повторіть після завершення синхронізації.'));},20000);
        const done=()=>{clearTimeout(timer);resolve();};this.requestWaiters.add(done);
      });
      if(!this.alive)throw new Error('UPDATE_CANCELLED');
      await this.updater.install();
      // Feature-detect Obsidian's plugin manager. Never reload the whole app or a note.
      const manager=this.app.plugins;
      if(typeof manager?.disablePlugin==='function'&&typeof manager?.enablePlugin==='function'){
        await manager.disablePlugin('flightclub-markdown');
        try{await manager.enablePlugin('flightclub-markdown');}
        catch{new Notice('Пакет оновлено. Перезапустіть Obsidian, щоб увімкнути FlightClub.');}
      }else new Notice('Плагін оновлено. Перезапустіть Obsidian, щоб застосувати версію.');
    }finally{
      this.updatingPlugin=false;
      if(this.alive){
        if(!this.updater.blocked())this.attachLiveSessionToActiveNote(this.activeNote());
        this.refreshDockViews();
      }
    }
  }

  renderHeroVersion(container, fallbackStatus = "", statusOk = false){
    if(!this.updater){
      const ctrl=container.createDiv({cls:'fc-hero-version-ctrl'});
      ctrl.createSpan({text:'v'+PLUGIN_VERSION,cls:'fc-hero-ver-num'});
      if(fallbackStatus){
        ctrl.createSpan({text:fallbackStatus,cls:'fc-deck-badge'+(statusOk?' fc-deck-badge-ok':''),attr:{role:'status'}});
      }
      return ctrl;
    }
    const state=this.updater.snapshot();
    const isChecking=Boolean(this.checkingVersion);
    const hasUpdate=Boolean(state.release&&['available','required','downloading','installing','installed'].includes(state.status)&&state.release.version!==PLUGIN_VERSION);
    const uiState=isChecking?'checking':state.status;
    const ctrl=container.createDiv({cls:'fc-hero-version-ctrl'});
    ctrl.dataset.state=uiState;
    const meta=ctrl.createDiv({cls:'fc-hero-ver-meta'});
    meta.createSpan({
      text:'v'+PLUGIN_VERSION+(hasUpdate?' → '+state.release.version:''),
      cls:'fc-hero-ver-num',
    });
    const labels={
      checking:'Перевірка…',
      required:'Потрібне оновлення',
      unavailable:'Не перевірено',
      unchecked:'Перевірка…',
      downloading:'Завантаження…',
      installing:'Встановлення…',
      installed:'Перезапустіть',
      available:'Доступно',
      current:'Актуальна',
    };
    meta.createSpan({
      text:labels[uiState]||fallbackStatus||'',
      cls:'fc-hero-ver-state',
      attr:{role:'status'},
    });
    const canInstall=['required','available'].includes(state.status);
    const busy=Boolean(this.updatingPlugin||isChecking||['downloading','installing'].includes(state.status));
    const btn=ctrl.createEl('button',{
      cls:'fc-hero-update-btn'+(canInstall?' is-update':'')+(busy?' is-busy':''),
      attr:{
        type:'button',
        title:canInstall
          ? `Оновити FlightClub до ${state.release?.version || 'нової версії'}`
          : 'Перевірити оновлення плагіна FlightClub',
        'aria-label':canInstall ? 'Оновити плагін' : 'Перевірити версію плагіна',
      },
    });
    const iconEl=btn.createSpan({cls:'fc-hero-update-icon',attr:{'aria-hidden':'true'}});
    obsidian.setIcon?.(iconEl,canInstall?'download':state.status==='installed'?'check':'refresh-cw');
    if(!iconEl.firstChild){
      iconEl.setText(canInstall?'⬇':state.status==='installed'?'✓':'↻');
    }
    btn.createSpan({
      text:state.status==='downloading'
        ? 'Завант…'
        : state.status==='installing'
          ? 'Встанов…'
          : state.status==='installed'
            ? 'Готово'
            : canInstall
              ? 'Оновити'
              : isChecking
                ? 'Пошук…'
                : 'Перевірити',
      cls:'fc-hero-update-label',
    });
    btn.disabled=busy;
    btn.addEventListener('click',()=>{
      if(canInstall){this.showUpdateDialog();return;}
      void this.checkPluginVersion(true,true);
    });
    return ctrl;
  }

  renderUpdateCard(container){
    if(!this.updater)return;
    const state=this.updater.snapshot(),card=container.createDiv({cls:'fc-plugin-update-card'});
    card.dataset.state=state.status;
    const hasUpdateArrow=state.release&&['available','required','downloading','installing','installed'].includes(state.status)&&state.release.version!==PLUGIN_VERSION;
    card.createSpan({text:'FlightClub '+PLUGIN_VERSION+(hasUpdateArrow?' → '+state.release.version:''),cls:'fc-plugin-version'});
    const labels={required:'Потрібне оновлення',unavailable:'Версію не перевірено',unchecked:'Перевірка версії',downloading:'Завантаження…',installing:'Встановлення…',installed:'Потрібен перезапуск',available:'Доступне оновлення',current:'Актуальна версія'};
    card.createSpan({text:labels[state.status]||'',cls:'fc-plugin-update-state',attr:{role:'status'}});
    const update=card.createEl('button',{text:['required','available'].includes(state.status)?'Оновити плагін':'Перевірити',cls:'fc-deck-btn',attr:{type:'button'}});
    update.disabled=this.updatingPlugin||['downloading','installing'].includes(state.status);
    update.addEventListener('click',()=>void this.checkPluginVersion(true,true));
  }

  // ==========================================================================
  // Live Collaborative Session (Two-Way OT + Presence + Clickable Profiles)
  // ==========================================================================

  liveTargetFor(file) {
    if (!file || isSyncArchivePath(file.path)) return null;
    const ext = typeof file.extension === "string" ? file.extension.toLowerCase() : (String(file.path || "").match(/\.([^.]+)$/)?.[1]?.toLowerCase() || "");
    if (ext && !["md", "canvas"].includes(ext)) return null;
    if (this.platformNote(file)) return null;
    const isCanvas = ext === "canvas";
    const link = !isCanvas ? this.linkFor?.(file) : null;
    if (link) return { kind: "m", key: link.slug, slug: link.slug, isCanvas: false };
    const driveId = typeof this.resolveDriveIdForFile === "function" ? this.resolveDriveIdForFile(file) : null;
    if (driveId && DRIVE_ID.test(driveId)) return { kind: "drive", key: "drive:" + driveId, fileId: driveId, isCanvas };
    return null;
  }

  findLiveDriveFile(fileId, remotePath) {
    if (fileId && this.driveFiles) {
      for (const [p, row] of this.driveFiles.entries()) {
        if (isSyncArchivePath(p)) continue;
        if (row && row.kind !== "platform" && row.fileId === fileId) {
          const found = this.app.vault.getAbstractFileByPath(p);
          if (found instanceof TFile) return found;
        }
      }
    }
    const root = String(this.vaultConfig?.localVaultRoot || "").replace(/^\/+|\/+$/g, "");
    if (remotePath && typeof remotePath === "string") {
      const clean = remotePath.trim().replace(/^\/+/, "");
      const stripped = clean.includes("/") ? clean.split("/").slice(1).join("/") : clean;
      const candidates = [root ? `${root}/${clean}` : clean, clean, root ? `${root}/${stripped}` : stripped, stripped]
        .filter((c, idx, arr) => c && !isSyncArchivePath(c) && arr.indexOf(c) === idx);
      for (const c of candidates) {
        const found = this.app.vault.getAbstractFileByPath(c);
        if (found instanceof TFile) return found;
      }
    }
    if (fileId && typeof this.app?.vault?.getMarkdownFiles === "function") {
      for (const f of this.app.vault.getMarkdownFiles()) {
        if (isSyncArchivePath(f.path)) continue;
        const meta = this.app?.metadataCache?.getFileCache?.(f)?.frontmatter;
        const fromMeta = typeof FC_YAML_PROPS !== "undefined" ? FC_YAML_PROPS.extractDriveIdFromMeta(meta) : null;
        if (fromMeta === fileId) return f;
      }
    }
    return null;
  }

  resolveLiveFileFromArchive(archiveFile) {
    if (!archiveFile || !isSyncArchivePath(archiveFile.path)) return null;
    const meta = this.app?.metadataCache?.getFileCache?.(archiveFile)?.frontmatter;
    const driveId = typeof FC_YAML_PROPS !== "undefined" ? FC_YAML_PROPS.extractDriveIdFromMeta(meta) : null;
    if (driveId) {
      const byId = this.findLiveDriveFile(driveId, null);
      if (byId) return byId;
    }
    const parts = archiveFile.path.split("/");
    const tailRel = parts.length >= 4 ? parts.slice(3).join("/") : parts.slice(1).join("/");
    if (tailRel) {
      const byPath = this.findLiveDriveFile(null, tailRel);
      if (byPath) return byPath;
    }
    const slugMeta = typeof meta?.slug === "string" && SLUG.test(meta.slug.toLowerCase()) ? meta.slug.toLowerCase() : null;
    if (slugMeta) {
      for (const [p, link] of this.links?.entries?.() || []) {
        if (isSyncArchivePath(p) || link?.slug !== slugMeta) continue;
        const f = this.app.vault.getAbstractFileByPath(p);
        if (f instanceof TFile) return f;
      }
      const cat = Array.isArray(this.remoteCatalog) ? this.remoteCatalog.find(p => p?.slug === slugMeta) : null;
      if (cat?.drive_file_id) {
        const byCat = this.findLiveDriveFile(cat.drive_file_id, cat.obsidian_path);
        if (byCat) return byCat;
      }
    }
    return null;
  }

  async openDriveFileInObsidian(fileId, remotePath) {
    const target = this.findLiveDriveFile(fileId, remotePath);
    if (target) {
      const leaf = this.app.workspace.getLeaf?.(false) || this.app.workspace.getLeaf?.();
      if (leaf?.openFile) await leaf.openFile(target, { active: true });
      this.attachLiveSessionToActiveNote?.(target);
      if (this.liveSession?.file === target) {
        this.liveSession.forceRefresh = true;
        this.queueLiveCheck?.(this.liveSession, 50);
      }
      return target;
    }
    if (fileId) {
      this.openSite(`${SITE}/markdown?view=vault&file=${encodeURIComponent(fileId)}&edit=1`);
    }
    return null;
  }

  bindUpdateDetails(row, trigger, { info, path, title, source }) {
    const doc = row.ownerDocument;
    const win = doc.defaultView;
    let active = null;

    const show = (pin = false, keyboard = false) => {
      if (!win || !trigger.isConnected) return;
      if (active) {
        win.clearTimeout(active.leaveTimer);
        if (pin && active.pinned) { active.close(); return; }
        if (pin) active.pinned = true;
        if (keyboard) (active.historyButton || active.panel).focus();
        return;
      }
      this.closeUpdateDetails?.();
      const panel = doc.body.createDiv({ cls: "fc-update-details" });
      panel.id = "fc-update-details";
      panel.tabIndex = -1;
      panel.setAttribute("role", "region");
      panel.setAttribute("aria-label", `Оновлення: ${title}`);
      panel.createEl("strong", { cls: "fc-update-details-title", text: title });
      if (path) {
        panel.createDiv({ cls: "fc-update-details-path", text: path });
      }
      const excerpts = updateExcerpts.get(info);
      const details = updateDetailLines(info);
      const legacy = Array.from(new Set((info.actions || [info.summary]).map(legacyUpdateDetail).filter(Boolean)));
      const lines = details.length ? details : legacy;
      const vaultFile = this.app?.vault?.getAbstractFileByPath?.(path);
      let needsLocalPreview = false;
      let previewSlot = null;
      if (lines.length) {
        const list = panel.createEl("ul");
        for (const line of lines) list.createEl("li", { text: line });
      }
      if (excerpts?.length) {
        const list = panel.createEl("ul", { cls: "fc-update-excerpts", attr: { "aria-label": "Фрагменти змін" } });
        for (const { kind, parts } of excerpts) {
          const item = list.createEl("li", { cls: `is-${kind}` });
          item.createSpan({ text: kind === "add" ? "+" : "−", cls: "fc-update-excerpt-sign", attr: {
            "aria-label": kind === "add" ? "Додано" : "Видалено",
          } });
          const excerpt = item.createSpan();
          for (const part of parts) {
            if (part.changed) excerpt.createEl("mark", { text: part.text });
            else excerpt.append(doc.createTextNode(part.text));
          }
        }
      }
      if (!excerpts?.length && !lines.length) {
        previewSlot = panel.createDiv({ cls: "fc-update-preview-slot" });
        const reader = this.app?.vault?.cachedRead?.bind(this.app.vault) || this.app?.vault?.read?.bind(this.app.vault);
        if (vaultFile instanceof TFile && typeof reader === "function" && /\.(?:md|markdown|txt|canvas|base|ya?ml|json|csv)$/i.test(vaultFile.path || path)) {
          needsLocalPreview = true;
          previewSlot.createEl("p", { cls: "fc-update-preview-loading", text: "Читаємо фрагмент нотатки…" });
        } else {
          previewSlot.createEl("p", { text: "Файл недоступний локально — перегляньте історію версій." });
        }
      }

      let openButton = null;
      let historyButton = null;
      const file = source !== "Сайт" || info.kind === "page" ? vaultFile : null;
      const link = file instanceof TFile ? this.linkFor(file) : null;
      const hasOpenAction = vaultFile instanceof TFile;
      const hasHistoryAction = Boolean(file instanceof TFile && (link?.slug || this.driveFiles?.get(path)?.fileId));
      if (hasOpenAction || hasHistoryAction) {
        const footer = panel.createDiv({ cls: "fc-update-details-actions" });
        if (hasOpenAction) {
          openButton = footer.createEl("button", {
            cls: "fc-update-open-link", text: "Відкрити нотатку", attr: { type: "button" },
          });
          openButton.addEventListener("click", () => {
            close();
            void this.openUpdateNotePath(path);
          });
        }
        if (hasHistoryAction) {
          historyButton = footer.createEl("button", {
            cls: "fc-update-history-link", text: "Історія версій", attr: { type: "button" },
          });
          historyButton.addEventListener("click", () => {
            if (trigger.isConnected) trigger.focus();
            close();
            this.dialog?.close();
            const modal = new Modal(this.app);
            this.dialog = modal;
            modal.setTitle(title);
            modal.contentEl.addClass("fc-hub-wrap");
            this.renderHistoryPanel(modal.contentEl, file, link);
            modal.onClose = () => { if (this.dialog === modal) this.dialog = null; };
            modal.open();
          });
        }
      }

      const scope = new win.AbortController();
      const options = { signal: scope.signal };
      const observer = new win.MutationObserver(() => {
        if (!trigger.isConnected) close();
      });
      const close = () => {
        if (!active) return;
        win.clearTimeout(active.leaveTimer);
        scope.abort();
        observer.disconnect();
        panel.remove();
        trigger.setAttribute("aria-expanded", "false");
        trigger.removeAttribute("aria-controls");
        trigger.removeAttribute("aria-describedby");
        active = null;
        if (this.closeUpdateDetails === close) this.closeUpdateDetails = null;
      };
      const position = () => {
        const anchor = trigger.getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();
        if (anchor.bottom < 0 || anchor.top > win.innerHeight) { close(); return; }
        const dockEl = row.closest?.(".fc-hub-wrap, .workspace-leaf, .workspace-sidedock") || row;
        const dockRect = dockEl.getBoundingClientRect();
        const gap = 12;
        const leftEdge = dockRect.left > 0 ? Math.min(dockRect.left, anchor.left) : anchor.left;
        panel.style.maxHeight = Math.max(120, Math.min(440, win.innerHeight - gap * 2)) + "px";
        const { width, height } = panel.getBoundingClientRect();
        const fitsLeft = leftEdge >= width + gap * 2;
        const rightEdge = Math.max(dockRect.right || 0, anchor.right);
        const fitsRight = !fitsLeft && rightEdge > 0 && win.innerWidth - rightEdge >= width + gap * 2;
        const left = fitsLeft
          ? leftEdge - width - gap
          : fitsRight
            ? rightEdge + gap
            : Math.min(anchor.left - width - gap, win.innerWidth - width - gap);
        const top = rowRect.top > 0 ? rowRect.top - 8 : anchor.top - 8;
        panel.style.left = Math.max(gap, Math.min(left, win.innerWidth - width - gap)) + "px";
        panel.style.top = Math.max(gap, Math.min(top, win.innerHeight - height - gap)) + "px";
      };
      active = { close, pinned: pin, leaveTimer: 0, historyButton: historyButton || openButton, panel };
      this.closeUpdateDetails = close;
      trigger.setAttribute("aria-expanded", "true");
      trigger.setAttribute("aria-controls", panel.id);
      trigger.setAttribute("aria-describedby", panel.id);
      observer.observe(doc.body, { childList: true, subtree: true });
      panel.addEventListener("pointerenter", () => win.clearTimeout(active?.leaveTimer), options);
      panel.addEventListener("pointerleave", delayClose, options);
      win.addEventListener("resize", position, options);
      doc.addEventListener("scroll", position, { ...options, capture: true });
      doc.addEventListener("pointerdown", event => {
        if (!row.contains(event.target) && !panel.contains(event.target)) close();
      }, options);
      doc.addEventListener("keydown", event => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (panel.contains(doc.activeElement)) trigger.focus();
          close();
        }
      }, { ...options, capture: true });
      position();
      if (keyboard) (historyButton || panel).focus();
      if (needsLocalPreview && previewSlot) {
        const reader = this.app?.vault?.cachedRead?.bind(this.app.vault) || this.app?.vault?.read?.bind(this.app.vault);
        Promise.resolve(reader(vaultFile)).then(rawText => {
          if (!active || !panel.isConnected) return;
          const previewLines = summarizeNotePreview(typeof rawText === "string" ? rawText : "");
          previewSlot.empty?.();
          if (previewLines.length) {
            previewSlot.createEl("div", { cls: "fc-update-preview-heading", text: "Поточний фрагмент нотатки" });
            const previewList = previewSlot.createEl("ul", { cls: "fc-update-excerpts is-preview", attr: { "aria-label": "Поточний фрагмент нотатки" } });
            for (const lineText of previewLines) {
              previewList.createEl("li", { cls: "is-preview", text: lineText });
            }
          } else {
            previewSlot.createEl("p", { text: "Файл недоступний локально — перегляньте історію версій." });
          }
          position();
        }).catch(() => {
          if (!active || !panel.isConnected) return;
          previewSlot.empty?.();
          previewSlot.createEl("p", { text: "Файл недоступний локально — перегляньте історію версій." });
          position();
        });
      }
    };

    function delayClose() {
      if (!active || active.pinned || doc.activeElement === trigger || active.panel.contains(doc.activeElement)) return;
      win.clearTimeout(active.leaveTimer);
      active.leaveTimer = win.setTimeout(active.close, 180);
    }

    row.addEventListener("pointerenter", event => {
      if (event.pointerType !== "touch") show();
    });
    row.addEventListener("pointerleave", delayClose);
    trigger.addEventListener("focus", () => show());
    trigger.addEventListener("blur", event => {
      if (active && !active.panel.contains(event.relatedTarget)) active.close();
    });
    trigger.addEventListener("click", event => show(true, event.detail === 0));
  }

  async openUpdateNotePath(uPath) {
    if (!uPath || isSyncArchivePath(uPath)) {
      this.markNoteReviewed(uPath);
      return false;
    }
    let target = this.app.vault.getAbstractFileByPath(uPath);
    if (!(target instanceof TFile)) {
      const stem = uPath.split("/").pop();
      if (stem && this.driveFiles) {
        for (const [p] of this.driveFiles.entries()) {
          if (!isSyncArchivePath(p) && p.split("/").pop() === stem) {
            const candidate = this.app.vault.getAbstractFileByPath(p);
            if (candidate instanceof TFile) { target = candidate; break; }
          }
        }
      }
    }
    if (target instanceof TFile && !isSyncArchivePath(target.path)) {
      const leaf = this.app.workspace.getLeaf?.(false) || this.app.workspace.getLeaf?.();
      if (leaf?.openFile) await leaf.openFile(target, { active: true });
      this.markNoteReviewed(uPath);
      if (target.path !== uPath) this.markNoteReviewed(target.path);
      if (this.liveSession?.file === target) {
        this.liveSession.forceRefresh = true;
        this.queueLiveCheck?.(this.liveSession, 50);
      }
      return true;
    }
    this.markNoteReviewed(uPath);
    new Notice("Нотатку не знайдено локально — синхронізуйте Vault або перевірте шлях: " + uPath);
    return false;
  }

  stopLiveSession() {
    const session = this.liveSession;
    if (session?.isCanvas && session.mode === "live" && !session.conflict &&
        (session.batch || session.canvasPendingEdit || Date.now() - session.lastTypedAt < 2_000) &&
        this.presenceSessionAuthorized(session)) {
      this.dirtyDriveFiles ??= new Set();
      this.dirtyDriveFiles.add(session.file.path);
      this.scheduleDriveSync(session.file.path);
    }
    this.liveSession = null;
    this.liveSlug = null;
    this.liveConnected = false;
    this.livePeers = [];
    if (session?.timer) clearTimeout(session.timer);
    this.liveBannerEl?.remove();
    this.liveRadarEl?.remove();
    this.liveBannerEl = null;
    this.liveRadarEl = null;
    this.refreshCursorDecorations?.();
    if (session?.joined && this.vaultConfig?.deviceToken) {
      if (session.kind === "drive" && session.fileId) {
        void this.driveLivePost({
          action: "drive_live_presence",
          fileId: session.fileId,
          clientId: this.clientId,
          source: this.sourceKind,
          leave: true,
        }).catch(() => {});
      } else if (session.slug) {
        void this.sitePost(session.slug, { action: "live_presence", clientId: this.clientId, source: this.sourceKind, leave: true }).catch(() => {});
      }
    }
  }

  async toggleLiveMode() {
    if (this.liveModeChanging) return;
    const file = this.activeNote();
    if (this.platformNote(file)) {
      new Notice("Правки майна й подій залишаються локально до кнопки «Відправити на сайт».");
      return;
    }
    if (!file || !this.liveTargetFor(file)) {
      new Notice("Спочатку синхронізуйте нотатку з Google Drive або прив’яжіть до сторінки /m/.");
      return;
    }
    const target = this.liveTargetFor(file);
    const canWriteTarget = target.kind === "drive"
      ? Boolean(this.vaultConfig.pairedCanSyncWrite ?? this.vaultConfig.pairedCanEdit ?? this.accountIsAdmax)
      : Boolean(this.vaultConfig.pairedCanEdit);
    if (!this.accountVerified || !canWriteTarget) {
      new Notice("Підтвердьте акаунт із правом редагування цієї сторінки.");
      return;
    }
    const previous = this.vaultConfig.liveEnabled;
    const previousPaused = this.vaultConfig.livePausedByUser;
    const nextEnabled = !previous;
    const slug = target.key || null;
    this.liveModeChanging = true;
    this.renderLiveBanner();
    try {
      this.vaultConfig.liveEnabled = nextEnabled;
      this.vaultConfig.livePausedByUser = !nextEnabled;
      await this.persist();
      if (!nextEnabled && this.livePeers.length > 0 && slug) this.liveManualPauseSlug = slug;
      else this.liveManualPauseSlug = null;
      this.liveModeChanging = false;
      this.attachLiveSessionToActiveNote(this.activeNote());
      new Notice(nextEnabled
        ? "🟢 Live Edit увімкнено — ваші правки синхронізуються в реальному часі."
        : "🟡 Live Edit призупинено — ви редагуєте лише локально.");
    } catch {
      this.vaultConfig.liveEnabled = previous;
      this.vaultConfig.livePausedByUser = previousPaused;
      new Notice("Не вдалося зберегти режим. Спробуйте ще раз.");
    } finally {
      this.liveModeChanging = false;
      this.renderLiveBanner();
      this.queuePublishCheck();
      this.updateStatusBar();
      this.refreshDockViews(true);
    }
  }

  liveModeState(file) {
    const platform = this.platformNote(file);
    if (platform) {
      if (platform.kind === "user") return {state:"readonly",eligible:false,label:"Профіль FlightClub",hint:"Дані профілю редагуються на сайті."};
      if (!platform.id) return {state:"unlinked",eligible:false,label:"Прив’язка не визначена",hint:"Перевірте властивість item-link / event-link (або fc-id) чи звірте копію в Obsidian."};
      if (!this.accountVerified || !this.vaultConfig.pairedCanEdit) {
        return {state:"readonly",eligible:false,label:"Локальна копія",hint:"Для оновлення запису підключіть акаунт адміністратора FlightClub."};
      }
      if (!this.platformPublishBaseline(file,platform)) {
        return {state:"draft",eligible:false,label:"Потрібна звірка",hint:"Порівняйте локальну назву й опис із поточною версією сайту."};
      }
      return {state:"draft",eligible:false,label:"Локальні правки",hint:"Змініть назву або опис і натисніть «Відправити на сайт»."};
    }
    if (!this.accountVerified) return {state:"account",eligible:false,label:"Потрібне підключення",hint:"Підтвердьте акаунт FlightClub."};
    const target = file ? this.liveTargetFor(file) : null;
    if (!file || !target) {
      if (file && this.sharedNotePath?.(file)) {
        return {state:"live",eligible:false,label:"Опублікований вольт активний",hint:"Опублікований вольт (FlightClub Shared) синхронізується автоматично кожні 15 секунд."};
      }
      if (file && this.isPathInDriveRoot?.(file.path)) {
        return {state:"unlinked",eligible:false,label:"Нова нотатка для Drive",hint:"Після синхронізації з Google Drive файл автоматично отримає Live Edit та присутність."};
      }
      return {state:"unlinked",eligible:false,label:"Нотатку не прив’язано",hint:"Синхронізуйте з Google Drive або прив’яжіть до /m/, щоб працювати разом."};
    }
    const canWrite = target.kind === "drive"
      ? Boolean(this.vaultConfig.pairedCanSyncWrite ?? this.vaultConfig.pairedCanEdit ?? this.accountIsAdmax)
      : Boolean(this.vaultConfig.pairedCanEdit);
    const scopeLabel = target.kind === "drive" ? "Live Edit Drive" : "Live Edit";
    if (!canWrite) return {state:"readonly",eligible:false,label:"Доступ для читання",hint:"Для Live Edit потрібне право редагування документа."};
    if (!this.vaultConfig.liveEnabled) return {state:"paused",eligible:true,label:`${scopeLabel} призупинено`,hint:"Локальні правки не відправляються автоматично. Увімкнення спочатку звірить версії."};
    const session=this.liveSession?.file === file ? this.liveSession : null;
    if (session?.conflict) return {state:"conflict",eligible:true,label:"Потрібне порівняння",hint:"Автоматичний запис призупинено до вибору версії."};
    if (session && this.liveConnected) return {state:session.batch ? "sending":"live",eligible:true,
      label:session.batch ? "Надсилаємо зміни":`${scopeLabel} активний`,
      hint: target.kind === "drive"
        ? "Зміни файла Google Drive і живі курсори синхронізуються в реальному часі (Драйв головний)."
        : "Зміни цієї сторінки /m/ надсилаються автоматично. Учасники й курсори показуються нижче."};
    return {state:session?.retryDelay ? "retrying":"connecting",eligible:true,
      label:session?.retryDelay ? "Відновлюємо з’єднання":`Підключаємо ${scopeLabel}`,
      hint:"Локальний текст зберігається. Перед синхронізацією пріоритетно звіряємо актуальну версію документа."};
  }

  attachLiveSessionToActiveNote(file) {
    if (typeof TFile === "function" && file instanceof TFile && !["md", "canvas"].includes(file.extension.toLowerCase())) { this.stopLiveSession(); return; }
    const active = typeof TFile === "function" && file instanceof TFile ? file : this.activeNote();
    const target = active ? this.liveTargetFor(active) : null;
    const canObserve = Boolean(target && this.accountVerified && this.vaultConfig.deviceToken && !this.updater?.blocked());
    const canWrite = target?.kind === "drive"
      ? Boolean(this.vaultConfig.pairedCanSyncWrite ?? this.vaultConfig.pairedCanEdit ?? this.accountIsAdmax)
      : Boolean(this.vaultConfig.pairedCanEdit);
    const liveWriting = Boolean(canObserve && this.vaultConfig.liveEnabled && canWrite);
    const sessionKey = this.liveSession ? (this.liveSession.key || this.liveSession.slug) : null;
    if (canObserve && this.liveSession?.file === active && sessionKey === target.key) {
      this.liveSession.mode = liveWriting ? "live" : "presence";
      this.renderLiveBanner();
      return;
    }
    this.stopLiveSession();
    if (!target) {
      if (active) this.queueOpenCanvasCreate(active);
      if (active && this.sharedNotePath(active)) this.renderLiveBanner();
      return;
    }
    this.liveSlug = target.kind === "m" ? target.slug : target.key;
    if (!canObserve) { this.renderLiveBanner(); return; }
    const session = {
      file: active,
      kind: target.kind,
      isCanvas: Boolean(target.isCanvas || active.extension?.toLowerCase?.() === "canvas"),
      key: target.key,
      slug: target.slug || null,
      fileId: target.fileId || null,
      mode: liveWriting ? "live" : "presence",
      liveRev: null,
      revision: null,
      sha256: null,
      base: null,
      batch: null,
      conflict: null,
      timer: null,
      busy: false,
      joined: false,
      forceRefresh: true,
      lastTypedAt: 0,
      retryDelay: 0,
    };
    this.liveSession = session;
    this.renderLiveBanner();
    this.queueLiveCheck(session, 0);
  }

  queueLiveCheck(session, delay) {
    if (!this.alive || this.liveSession !== session) return;
    const due = Date.now() + delay;
    if (session.timer && session.due <= due) return;
    if (session.timer) clearTimeout(session.timer);
    session.due = due;
    session.timer = setTimeout(() => { session.timer = null; void this.checkLiveSession(session); }, delay);
  }

  async sitePost(slug, payload) {
    return this.siteRequest({ url: SITE + "/m/" + encodeURIComponent(slug) + "?api=1", method: "POST",
      headers: { "Content-Type": "application/json", ...this.authHeaders() }, body: JSON.stringify(payload), throw: false });
  }

  async timedSiteRequest(options, timeoutMs = 45_000) {
    let timer;
    try {
      return await Promise.race([
        this.siteRequest(options),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(Object.assign(new Error("Час очікування запиту вичерпано."), { code: "TIMEOUT" })), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async driveLivePost(payload) {
    return this.timedSiteRequest({
      url: SITE + "/m/obsidian-sync?api=1&obsidian=drive-live-v1",
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.authHeaders() },
      body: JSON.stringify(payload),
      throw: false,
    }, 15_000);
  }

  async uploadImageToSite(bytes, filename = "image.png", mimeType = "image/png") {
    if (!this.accountVerified || !this.vaultConfig?.deviceToken) throw new Error("Підключіть акаунт FlightClub.");
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes instanceof ArrayBuffer ? bytes : bytes.buffer || bytes);
    if (!u8.byteLength || u8.byteLength > 8_388_608) throw new Error("Зображення перевищує ліміт 8 МБ.");
    this.uploadedMediaCache ??= new Map();
    const hash = await FC_DRIVE_SYNC.hashBytes(u8);
    if (this.uploadedMediaCache.has(hash)) return this.uploadedMediaCache.get(hash);
    let bin = "";
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    const b64 = btoa(bin);
    const res = await this.timedSiteRequest({
      url: SITE + "/m/obsidian-sync?obsidian=media-upload-v1",
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.authHeaders() },
      body: JSON.stringify({ base64: b64, filename, mimeType }),
      throw: false,
    }, 30_000);
    if (res.status !== 200 || res.json?.ok !== true || typeof res.json?.url !== "string") {
      throw new Error(res.json?.error || "Не вдалося завантажити зображення на сайт.");
    }
    this.uploadedMediaCache.set(hash, res.json.url);
    return res.json.url;
  }

  async uploadEditorImagesToSite(files, editor, file) {
    if (!files?.length || !editor) return;
    const notice = new Notice(`⏳ Завантажуємо зображення на FlightClub (${files.length})…`, 4000);
    const inserted = [];
    for (const img of files) {
      try {
        const buf = await img.arrayBuffer();
        const url = await this.uploadImageToSite(new Uint8Array(buf), img.name || "pasted.png", img.type || "image/png");
        inserted.push(`![](${url})`);
      } catch (err) {
        new Notice(`⚠️ ${err?.message || "Не вдалося завантажити фото на сайт."}`);
      }
    }
    try { notice?.hide?.(); } catch {}
    if (inserted.length) {
      editor.replaceSelection(inserted.join("\n") + "\n");
      if (file?.path) this.lastEditorInputAt?.set(file.path, Date.now());
      new Notice(`🖼️ Завантажено на сайт (${inserted.length}) — доступно всім у Live Edit!`);
    }
  }

  async uploadCanvasLocalImages(canvasText, canvasFile) {
    if (typeof canvasText !== "string" || !canvasText.trim() || !this.accountVerified || !this.vaultConfig?.deviceToken) {
      return { text: canvasText, changed: false };
    }
    let parsed;
    try { parsed = JSON.parse(canvasText.replace(/^\uFEFF/, "")); } catch { return { text: canvasText, changed: false }; }
    if (!parsed || !Array.isArray(parsed.nodes)) return { text: canvasText, changed: false };
    const IMG_RE = /\.(png|jpe?g|webp|gif)$/i;
    const images = new Map();
    for (const node of parsed.nodes) {
      if (node?.type !== "file" || typeof node.file !== "string" || !IMG_RE.test(node.file) || node.fc_media_url) continue;
      let file = this.app?.vault?.getAbstractFileByPath?.(node.file);
      if (!(file instanceof TFile)) file = this.app?.metadataCache?.getFirstLinkpathDest?.(node.file, canvasFile?.path || "");
      if (!(file instanceof TFile)) continue;
      const sameFile = images.get(file.path) ?? { file, nodes: [] };
      sameFile.nodes.push(node);
      images.set(file.path, sameFile);
    }
    const jobs = [...images.values()];
    let next = 0, changed = false, retry = false;
    await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, async () => {
      while (next < jobs.length) {
        const { file, nodes } = jobs[next++];
        try {
          const bytes = await this.app.vault.readBinary(file);
          if (bytes.byteLength > 8_388_608) continue;
          const ext = nodes[0].file.match(IMG_RE)[1].toLowerCase();
          const mime = /jpe?g/.test(ext) ? "image/jpeg" : "image/" + ext;
          const url = await this.uploadImageToSite(new Uint8Array(bytes), file.name || "image." + ext, mime);
          for (const node of nodes) node.fc_media_url = url;
          changed = true;
        } catch { retry = true; }
      }
    }));
    return { text: changed ? JSON.stringify(parsed, null, 2) + "\n" : canvasText, changed, retry };
  }

  queueCanvasAttachments(session, text) {
    if (session.canvasAttachmentsBusy || (session.canvasAttachmentsSource === text &&
        (!session.canvasAttachmentsRetryAt || Date.now() < session.canvasAttachmentsRetryAt))) return;
    session.canvasAttachmentsBusy = true;
    session.canvasAttachmentsSource = text;
    void this.uploadCanvasLocalImages(text, session.file).then((result) => {
      if (!this.liveSessionAuthorized(session)) return;
      session.canvasAttachmentsRetryAt = result.retry ? Date.now() + 8_000 : null;
      if (result.changed) {
        session.canvasAttachments = result.text;
        session.canvasPendingEdit = true;
        if (!session.busy) this.queueLiveCheck(session, 0);
      }
    }).catch(() => { session.canvasAttachmentsRetryAt = Date.now() + 8_000; })
      .finally(() => { session.canvasAttachmentsBusy = false; });
  }

  async hydrateCanvasRemoteImages(canvasText) {
    if (typeof canvasText !== "string" || !canvasText.trim() || !this.app?.vault) return;
    let parsed;
    try { parsed = JSON.parse(canvasText.replace(/^\uFEFF/, "")); } catch { return; }
    if (!parsed || !Array.isArray(parsed.nodes)) return;
    const SAFE_SITE_MEDIA = /^https:\/\/flightclub\.com\.ua\/m\/[A-Za-z0-9]{12,32}\.(?:png|jpe?g|webp|gif)$/i;
    this.hydratingMediaUrls ??= new Set();
    for (const node of parsed.nodes) {
      if (!node || node.type !== "file" || typeof node.file !== "string" || typeof node.fc_media_url !== "string") continue;
      if (!SAFE_SITE_MEDIA.test(node.fc_media_url)) continue;
      if (this.app.vault.getAbstractFileByPath(node.file)) continue;
      const targetPath = node.file.replace(/\\/g, "/").replace(/^\/+/, "");
      if (!targetPath || targetPath.includes("..") || targetPath.startsWith(".obsidian/")) continue;
      if (this.hydratingMediaUrls.has(targetPath)) continue;
      this.hydratingMediaUrls.add(targetPath);
      try {
        const res = await this.siteRequest({ url: node.fc_media_url, method: "GET", throw: false });
        if (res.status === 200 && res.arrayBuffer && res.arrayBuffer.byteLength > 0 && res.arrayBuffer.byteLength <= 8_388_608) {
          const parts = targetPath.split("/").slice(0, -1);
          for (let i = 1; i <= parts.length; i++) {
            const dir = parts.slice(0, i).join("/");
            if (!this.app.vault.getAbstractFileByPath(dir)) {
              this.markInternalSyncWrite?.(dir);
              await this.app.vault.createFolder(dir);
            }
          }
          if (!this.app.vault.getAbstractFileByPath(targetPath)) {
            this.markInternalSyncWrite?.(targetPath);
            await this.app.vault.createBinary(targetPath, res.arrayBuffer);
          }
        }
      } catch {}
      finally { this.hydratingMediaUrls.delete(targetPath); }
    }
  }

  async localNote(file) {
    const view = this.noteView(file);
    const isCanvas = file?.extension?.toLowerCase?.() === "canvas" || String(file?.path || "").toLowerCase().endsWith(".canvas");
    if (isCanvas) {
      let raw = "";
      if (typeof view?.canvas?.getData === "function") {
        try {
          const data = view.canvas.getData();
          if (data && typeof data === "object") raw = JSON.stringify(data, null, 2) + "\n";
        } catch {}
      }
      const diskRaw = await (this.app.vault.read?.(file) ?? this.app.vault.cachedRead?.(file));
      raw ||= diskRaw;
      return { editor: null, raw, diskRaw, canvasView: view?.canvas, frontmatterBlock: "", body: raw, isCanvas: true };
    }
    const editor = view?.editor && view.getMode?.() !== "preview" ? view.editor : null;
    const raw = editor ? editor.getValue() : await (this.app.vault.read?.(file) ?? this.app.vault.cachedRead?.(file));
    return { editor, raw, ...splitFrontmatter(raw), isCanvas: false };
  }

  async applyNoteContent(file, local, content, stillCurrent = () => true) {
    if (!stillCurrent()) return false;
    if (local.body === content) return true;
    const typedAt = this.lastEditorInputAt?.get(file.path);
    const modAt = this.lastLocalModifyAt?.get(file.path);
    if ((typeof typedAt === "number" && Date.now() - typedAt < 2_500) || (typeof modAt === "number" && Date.now() - modAt < 2_500)) return false;
    this.markInternalSyncWrite?.(file.path);
    if (local.editor) {
      const view = this.noteView(file);
      if (view?.editor !== local.editor || view.getMode?.() === "preview" || local.editor.getValue() !== local.raw) return false;
      const change = diffToChange(local.body, content);
      const offset = local.frontmatterBlock.length;
      this.liveApplyingRemote = true;
      try {
        local.editor.replaceRange(change.insert, local.editor.offsetToPos(offset + change.from), local.editor.offsetToPos(offset + change.to));
        return true;
      } finally { this.liveApplyingRemote = false; }
    }
    let applied = false;
    if (typeof this.app.vault.process !== "function") return false;
    await this.app.vault.process(file, (raw) => {
      const view = this.noteView(file);
      if (!stillCurrent() || (view?.editor && view.getMode?.() !== "preview") || raw !== local.raw) return raw;
      applied = true;
      return local.frontmatterBlock + content;
    });
    return applied;
  }

  async applyRawDriveContent(file, local, content, stillCurrent = () => true) {
    if (!stillCurrent()) return false;
    const localNorm = String(local.raw ?? "").replace(/\r\n?/g, "\n");
    const targetNorm = String(content ?? "").replace(/\r\n?/g, "\n");
    if (localNorm === targetNorm) return true;
    const isCanvas = Boolean(local.isCanvas || file?.extension?.toLowerCase?.() === "canvas");
    if (isCanvas) {
      const parsed = FC_DRIVE_SYNC.readCanvas(targetNorm);
      if (!parsed || typeof this.app.vault.process !== "function") return false;
      const sameViewSnapshot = () => {
        const canvas = this.noteView(file)?.canvas;
        if (canvas !== local.canvasView || !stillCurrent()) return false;
        const viewData = canvas?.getData?.();
        return !viewData || FC_DRIVE_SYNC.canvasTextEquals(JSON.stringify(viewData), localNorm);
      };
      if (!sameViewSnapshot()) return false;
      let written = false;
      this.markInternalSyncWrite?.(file.path);
      this.liveApplyingRemote = true;
      try {
        await this.app.vault.process(file, (disk) => {
          if (disk !== (local.diskRaw ?? local.raw) || !sameViewSnapshot()) return disk;
          written = true;
          return targetNorm;
        });
        if (!written || !sameViewSnapshot()) return false;
        local.canvasView?.setData?.(parsed);
        local.canvasView?.requestFrame?.();
      } finally { this.liveApplyingRemote = false; }
      // Apply the snapshot immediately. Image transfers refresh the same surface later.
      void this.hydrateCanvasRemoteImages(targetNorm).then(() => {
        if (stillCurrent() && this.noteView(file)?.canvas === local.canvasView) local.canvasView?.requestFrame?.();
      }).catch(() => {});
      return true;
    }
    const typedAt = this.lastEditorInputAt?.get(file.path);
    const modAt = this.lastLocalModifyAt?.get(file.path);
    if ((typeof typedAt === "number" && Date.now() - typedAt < 2_500) || (typeof modAt === "number" && Date.now() - modAt < 2_500)) return false;
    this.markInternalSyncWrite?.(file.path);
    if (local.editor) {
      const view = this.noteView(file);
      if (view?.editor !== local.editor || view.getMode?.() === "preview" || local.editor.getValue() !== local.raw) return false;
      const change = diffToChange(local.raw, targetNorm);
      if (!change) return true;
      this.liveApplyingRemote = true;
      try {
        local.editor.replaceRange(change.insert, local.editor.offsetToPos(change.from), local.editor.offsetToPos(change.to));
        return true;
      } finally { this.liveApplyingRemote = false; }
    }
    let applied = false;
    if (typeof this.app.vault.process === "function") {
      await this.app.vault.process(file, (raw) => {
        const view = this.noteView(file);
        if (!stillCurrent() || (view?.editor && view.getMode?.() !== "preview") || raw !== local.raw) return raw;
        applied = true;
        return targetNorm;
      });
      return applied;
    }
    return false;
  }

  async rememberDriveLiveBaseline(file, meta, contentText) {
    if (!file || isSyncArchivePath(file.path) || !meta?.fileId || !this.driveFiles) return;
    const existing = this.driveFiles.get(file.path);
    if (existing?.kind === "platform") return;
    const normText = String(contentText ?? "").replace(/\r\n?/g, "\n");
    const sha = meta.sha256 || await contentHash(normText);
    const localSha = await contentHash(normText);
    const liveFile = this.app?.vault?.getAbstractFileByPath?.(file.path) || file;
    const sm = Number.isFinite(liveFile?.stat?.mtime) && Number.isFinite(liveFile?.stat?.size)
      ? { localMtime: liveFile.stat.mtime, localSize: liveFile.stat.size } : {};
    this.driveFiles.set(file.path, {
      ...(existing || {}),
      userId: existing?.userId || this.vaultConfig.pairedUserId,
      fileId: meta.fileId,
      bindingRevision: existing?.bindingRevision || this.vaultConfig.revision,
      version: meta.version ?? existing?.version ?? "1",
      sha256: localSha,
      remoteSha256: sha,
      kind: existing?.kind || (file.extension?.toLowerCase?.() === "canvas" ? "canvas" : "markdown"),
      canEdit: true,
      sourcePath: existing?.sourcePath || file.path,
      ...sm,
    });
    if (this.baselineTimer) clearTimeout(this.baselineTimer);
    this.baselineTimer = setTimeout(() => {
      this.baselineTimer = null;
      if (this.alive) void this.persist().catch(() => {});
    }, 1_200);
  }

  async rememberBaseline(file, page, stillCurrent = () => true) {
    if (!file || isSyncArchivePath(file.path)) return;
    const hash = await contentHash(page.content);
    if (!this.alive || !stillCurrent() || this.app.vault.getAbstractFileByPath(file.path) !== file) return;
    const known = this.links.get(file.path);
    if (known && (known.slug !== page.slug || known.version > page.updated_at)) return;
    this.links.set(file.path, { slug: page.slug, version: page.updated_at,
      observedRemoteRevision: page.updated_at, syncedBodyHash: hash, conflict: false, dirtyLocal: false });
    if (this.baselineTimer) clearTimeout(this.baselineTimer);
    this.baselineTimer = setTimeout(() => {
      this.baselineTimer = null;
      void this.persist().catch(() => new Notice("Не вдалося зберегти стан синхронізації."));
    }, 1_200);
  }

  async receiveLivePage(session, page, acknowledgedText) {
    if (session.kind === "drive") {
      if (!this.liveSessionAuthorized(session) || isSyncArchivePath(session.file?.path) || page?.fileId !== session.fileId || typeof page.content !== "string") return;
      const remoteText = page.content.replace(/\r\n?/g, "\n");
      if (session.isCanvas && /^\d+$/.test(String(page.version ?? "")) &&
          /^\d+$/.test(String(session.revision ?? "")) && BigInt(page.version) < BigInt(session.revision)) {
        if (session.pendingCanvasPage === page) session.pendingCanvasPage = null;
        return;
      }
      const ackNorm = typeof acknowledgedText === "string" ? acknowledgedText.replace(/\r\n?/g, "\n") : undefined;
      if (ackNorm !== undefined && (remoteText === ackNorm || (session.isCanvas && FC_DRIVE_SYNC.canvasTextEquals(remoteText, ackNorm)))) {
        session.base = remoteText;
        session.liveRev = page.rev ?? session.liveRev;
        session.revision = page.version ?? session.revision;
        session.sha256 = page.sha256 ?? await contentHash(remoteText);
        session.conflict = null;
        session.pendingCanvasPage = null;
        await this.rememberDriveLiveBaseline(session.file, { fileId: session.fileId, version: session.revision, sha256: session.sha256 }, remoteText);
        return;
      }
      const local = await this.localNote(session.file);
      if (!this.liveSessionAuthorized(session)) return;
      const localRaw = String(local.raw ?? "");
      const normalized = localRaw.replace(/\r\n?/g, "\n");
      const isCanvas = Boolean(session.isCanvas || local.isCanvas);
      const localNorm = isCanvas ? FC_DRIVE_SYNC.retainCanvasMedia(normalized, local.diskRaw, session.base, session.canvasAttachments) : normalized;
      let base = ackNorm ?? session.base;
      if (base === null) {
        if (localNorm === remoteText || (isCanvas && FC_DRIVE_SYNC.canvasTextEquals(localNorm, remoteText))) {
          base = localNorm;
        } else {
          const linked = this.driveBaselineFor?.(session.file);
          const baseline = !isCanvas || (linked?.fileId === session.fileId &&
            linked?.bindingRevision === this.vaultConfig.revision) ? linked : null;
          const localHash = await contentHash(localNorm);
          const rawHash = localRaw === localNorm ? localHash : await contentHash(localRaw);
          const diskHash = isCanvas && typeof local.diskRaw === "string" &&
            FC_DRIVE_SYNC.canvasTextEquals(localNorm, local.diskRaw) ? await contentHash(local.diskRaw) : null;
          const remoteHash = page.sha256 || await contentHash(remoteText);
          if (baseline && (baseline.sha256 === remoteHash || baseline.remoteSha256 === remoteHash)) {
            // Remote matches our last synced baseline while local has newer edits: adopt remote as base and push local forward (NEVER rollback!).
            session.base = remoteText;
            session.liveRev = page.rev ?? session.liveRev;
            session.revision = page.version ?? session.revision;
            session.sha256 = remoteHash;
            session.conflict = null;
            session.pendingCanvasPage = null;
            return;
          }
          const matchesBaseline = Boolean(
            baseline && (
              baseline.sha256 === localHash || baseline.remoteSha256 === localHash ||
              baseline.sha256 === rawHash || baseline.remoteSha256 === rawHash ||
              (diskHash && (baseline.sha256 === diskHash || baseline.remoteSha256 === diskHash))
            ),
          );
          const dirty = !isCanvas && this.isEditorDirty(session.file);
          const untouchedLocal = !dirty && !this.lastEditorInputAt?.get?.(session.file.path);
          if (isCanvas ? matchesBaseline : !dirty && (matchesBaseline || !baseline || untouchedLocal)) {
            base = localNorm;
          }
        }
      }
      const stillCurrent = () => this.liveSessionAuthorized(session);
      if (!stillCurrent()) return;
      let merged;
      if (isCanvas) {
        merged = FC_DRIVE_SYNC.mergeCanvasJsonText(base, localNorm, remoteText);
      } else {
        merged = base === null ? null : mergeMarkdownText(base, localNorm, remoteText);
      }
      if (merged === null) {
        if (stillCurrent()) { session.conflict = page; session.pendingCanvasPage = null; }
        return;
      }
      if (merged !== localNorm && (!isCanvas || !FC_DRIVE_SYNC.canvasTextEquals(merged, localNorm))) {
        if (!await this.applyRawDriveContent(session.file, local, merged, stillCurrent)) {
          if (stillCurrent() && isCanvas) session.pendingCanvasPage = page;
          else if (stillCurrent() && !this.isEditorDirty(session.file)) session.conflict = page;
          return;
        }
      } else if (isCanvas) {
        void this.hydrateCanvasRemoteImages(merged);
      }
      if (!stillCurrent()) return;
      session.base = remoteText;
      session.liveRev = page.rev ?? session.liveRev;
      session.revision = page.version ?? session.revision;
      session.sha256 = page.sha256 ?? await contentHash(remoteText);
      session.conflict = null;
      session.pendingCanvasPage = null;
      if (merged === remoteText || (isCanvas && FC_DRIVE_SYNC.canvasTextEquals(merged, remoteText))) {
        await this.rememberDriveLiveBaseline(session.file, { fileId: session.fileId, version: session.revision, sha256: session.sha256 }, remoteText);
      }
      return;
    }
    if (!this.liveSessionAuthorized(session) || page?.slug !== session.slug || typeof page.content !== "string" || !VERSION.test(page.updated_at)) return;
    if (session.revision && page.updated_at < session.revision) return;
    if (typeof acknowledgedText === "string" && page.content === acknowledgedText) {
      session.base = page.content;
      session.revision = page.updated_at;
      session.conflict = null;
      await this.rememberBaseline(session.file, page, () => this.liveSessionAuthorized(session));
      return;
    }
    const local = await this.localNote(session.file);
    if (!this.liveSessionAuthorized(session)) return;
    let base = acknowledgedText ?? session.base;
    if (base === null) {
      const link = this.linkFor(session.file);
      if (local.body === page.content) base = local.body;
      else if (link?.syncedBodyHash?.length === 64) {
        if (await contentHash(local.body) === link.syncedBodyHash) base = local.body;
        else if (await contentHash(page.content) === link.syncedBodyHash) base = page.content;
      } else if (!this.isEditorDirty(session.file) && !link?.dirtyLocal && !local.body.trim()) {
        base = local.body;
      }
    }
    const stillCurrent = () => this.liveSessionAuthorized(session);
    if (!stillCurrent()) return;
    const merged = base === null ? null : mergeMarkdownText(base, local.body, page.content);
    if (merged === null || !await this.applyNoteContent(session.file, local, merged, stillCurrent)) {
      if (stillCurrent()) session.conflict = page;
      return;
    }
    if (!stillCurrent()) return;
    session.base = page.content;
    session.revision = page.updated_at;
    session.conflict = null;
    await this.rememberBaseline(session.file, page, stillCurrent);
  }

  presenceSessionAuthorized(session) {
    return this.alive && this.liveSession === session && this.accountVerified && this.vaultConfig.deviceToken &&
      !this.liveModeChanging && !this.updatingPlugin && !this.updater?.blocked() &&
      this.driveFiles?.get(session.file.path)?.kind !== "platform" && !this.platformNote(session.file) &&
      (session.kind === "drive" ? Boolean(this.resolveDriveIdForFile?.(session.file) === session.fileId) : Boolean(this.linkFor(session.file)));
  }

  liveSessionAuthorized(session) {
    const canWrite = session?.kind === "drive"
      ? Boolean(this.vaultConfig.pairedCanSyncWrite ?? this.vaultConfig.pairedCanEdit ?? this.accountIsAdmax)
      : Boolean(this.vaultConfig.pairedCanEdit);
    return this.presenceSessionAuthorized(session) && canWrite && Boolean(this.vaultConfig.liveEnabled);
  }

  async checkLiveSession(session) {
    if (!this.alive || this.liveSession !== session) return;
    if (this.liveModeChanging) { this.queueLiveCheck(session, 1_200); return; }
    if (!this.presenceSessionAuthorized(session)) {
      this.stopLiveSession();
      this.updateStatusBar();
      this.refreshDockViews(true);
      return;
    }
    if (session.busy) { this.queueLiveCheck(session, 1_000); return; }
    if ((this.noteView?.(session.file)?.containerEl?.ownerDocument ?? document).hidden) {
      this.queueLiveCheck(session, 5_000);
      return;
    }
    session.busy = true;
    session.canvasPendingEdit = false;
    let delay = 2_500;
    try {
      const isDrive = session.kind === "drive";
      const canWrite = isDrive
        ? Boolean(this.vaultConfig.pairedCanSyncWrite ?? this.vaultConfig.pairedCanEdit ?? this.accountIsAdmax)
        : Boolean(this.vaultConfig.pairedCanEdit);
      const liveWriting = Boolean(this.vaultConfig.liveEnabled && canWrite);
      const local = await this.localNote(session.file);
      if (!this.presenceSessionAuthorized(session)) return;
      let current = local;
      if (session.pendingCanvasPage && liveWriting) {
        await this.receiveLivePage(session, session.pendingCanvasPage);
        if (session.pendingCanvasPage) { delay = 250; return; }
        current = await this.localNote(session.file);
      }
      let localComparable = isDrive ? String(current.raw ?? "").replace(/\r\n?/g, "\n") : current.body;
      if (isDrive && session.isCanvas && liveWriting && !session.conflict && !session.batch) {
        localComparable = FC_DRIVE_SYNC.retainCanvasMedia(localComparable, current.diskRaw, session.base, session.canvasAttachments);
        this.queueCanvasAttachments(session, localComparable);
      }
      if (liveWriting && !session.conflict && session.base !== null && !session.batch) {
        if (isDrive && session.isCanvas) {
          if (!session.forceRefresh && !FC_DRIVE_SYNC.canvasTextEquals(localComparable, session.base) && localComparable.length <= MAX_NOTE) {
            session.batch = {
              opId: crypto.randomUUID(), baseRev: session.liveRev, revision: session.revision,
              baseContent: session.base, baseSha256: session.sha256, content: localComparable, isCanvas: true,
            };
          }
        } else {
          const change = diffToChange(session.base, localComparable);
          if (change && localComparable.length <= MAX_NOTE) {
            session.batch = { opId: crypto.randomUUID(), baseRev: session.liveRev, revision: session.revision, content: localComparable, change };
          }
        }
      }
      const batch = liveWriting ? session.batch : null;
      if (batch && session.retryDelay === 0) this.refreshDockViews(true);
      const editor = local.editor;
      const fmLen = isDrive ? 0 : local.frontmatterBlock.length;
      const position = (part) => editor ? Math.max(0, editor.posToOffset(editor.getCursor(part)) - fmLen) : 0;
      const selection = { anchor: position("anchor"), head: position("head") };
      const presenceAction = liveWriting ? (selection.anchor !== selection.head ? "selecting" : Date.now() - session.lastTypedAt < 4_000 ? "typing" : "viewing") : "viewing";
      const basePayload = { clientId: this.clientId, source: this.sourceKind, ...selection };

      const result = isDrive
        ? await this.driveLivePost(batch ? (batch.isCanvas ? {
            ...basePayload, action: "drive_live_canvas", fileId: session.fileId, opId: batch.opId,
            baseRev: batch.baseRev, baseVersion: batch.revision, baseSha256: batch.baseSha256,
            baseContent: batch.baseContent, canvasContent: batch.content,
          } : {
            ...basePayload, action: "drive_live_op", fileId: session.fileId, opId: batch.opId,
            baseRev: batch.baseRev, changes: [batch.change],
          }) : {
            ...basePayload, action: "drive_live_presence", fileId: session.fileId,
            afterRev: session.liveRev ?? undefined, afterVersion: session.revision ?? undefined, afterSha256: session.sha256 ?? undefined,
            forceRefresh: Boolean(session.forceRefresh), presenceAction,
          })
        : await this.sitePost(session.slug, batch ? {
            ...basePayload, action: "live_op", opId: batch.opId, expectedUpdatedAt: batch.revision, changes: [batch.change],
          } : {
            ...basePayload, action: "live_presence", after: session.conflict?.updated_at ?? session.revision, presenceAction,
          });
      session.forceRefresh = false;
      if (!this.presenceSessionAuthorized(session)) return;
      if (result.status === 426 || result.json?.code === "PLUGIN_UPDATE_REQUIRED") {
        this.liveConnected = false;
        this.stopLiveSession();
        void this.checkPluginVersion?.(true, true);
        return;
      }
      const response = result.json;
      const validOk = isDrive
        ? (result.status === 200 && response?.ok === true && response?.fileId === session.fileId)
        : (result.status === 200 && response?.ok === true && VERSION.test(response.baseUpdatedAt || ""));
      if (validOk) {
        const connectionChanged = !this.liveConnected;
        this.liveConnected = true;
        this.liveRev = response.rev ?? this.liveRev;
        if (!session.isCanvas || !isDrive || typeof response.content !== "string") session.liveRev = response.rev ?? session.liveRev;
        session.joined = true;
        session.retryDelay = 0;
        if (batch) session.batch = null;
        const oldConflict = isDrive ? (session.conflict?.sha256 || session.conflict?.version) : session.conflict?.updated_at;
        if (isDrive) {
          if (!session.isCanvas || typeof response.content !== "string") {
            session.revision = response.version ?? session.revision;
            session.sha256 = response.sha256 ?? session.sha256;
          }
          if (typeof response.content === "string") {
            if (session.isCanvas && session.revision && response.version !== session.revision) {
              session.canvasRemoteChangedAt = Date.now();
            }
            const pagePayload = { fileId: response.fileId, rev: response.rev, version: response.version, sha256: response.sha256, content: response.content };
            const replayed = session.pendingCanvasAck && FC_DRIVE_SYNC.canvasTextEquals(pagePayload.content, session.pendingCanvasAck);
            const acknowledgement = batch?.content ?? (replayed ? session.pendingCanvasAck : undefined);
            session.pendingCanvasAck = null;
            if (session.conflict) session.conflict = pagePayload;
            else if (!session.isCanvas || liveWriting) await this.receiveLivePage(session, pagePayload, acknowledgement);
          } else if (batch) {
            session.base = batch.content;
            await this.rememberDriveLiveBaseline(session.file, { fileId: session.fileId, version: response.version, sha256: response.sha256 }, batch.content);
          }
        } else if (liveWriting && response.page) {
          if (session.conflict) session.conflict = response.page;
          else await this.receiveLivePage(session, response.page, batch?.content);
        }
        if (this.liveSession !== session) return;
        const peers = Array.isArray(response.peers) ? response.peers : [];
        this.selfLivePeer = peers.find(p => p.clientId === this.clientId) || null;
        const unique = new Map();
        for (const peer of peers) {
          if (peer.clientId === this.clientId) continue;
          const key = peer.userId && peer.userId !== this.vaultConfig.pairedUserId ? peer.userId : peer.clientId;
          if (!unique.has(key) || unique.get(key).updatedAt < peer.updatedAt) unique.set(key, peer);
        }
        const next = [...unique.values()];
        const visible = (list) => JSON.stringify(list.map(({ updatedAt, ...peer }) => peer));
        const peersChanged = visible(this.livePeers) !== visible(next);
        if (peersChanged) { this.livePeers = next; this.refreshCursorDecorations?.(); }

        const distinctRemotePeople = new Set(next.filter(p => !this.vaultConfig.pairedUserId || p.userId !== this.vaultConfig.pairedUserId).map(p => p.userId || p.clientId)).size;
        const hasTwoPlusInDoc = distinctRemotePeople >= 1 || next.length >= 1;
        if (hasTwoPlusInDoc && !this.vaultConfig.liveEnabled && canWrite && this.liveManualPauseSlug !== session.key) {
          this.vaultConfig.liveEnabled = true;
          this.vaultConfig.livePausedByUser = false;
          session.mode = "live";
          void this.persist().catch(() => {});
          if (isDrive && typeof response.content === "string") {
            await this.receiveLivePage(session, { fileId: response.fileId, rev: response.rev, version: response.version, sha256: response.sha256, content: response.content });
          } else if (!isDrive && response.page) {
            await this.receiveLivePage(session, response.page);
          }
          new Notice(`👥 У документі ${Math.max(distinctRemotePeople + 1, next.length + 1)} учасники — Live Edit увімкнено автоматично!`);
          this.renderLiveBanner();
          this.updateStatusBar();
          this.refreshDockViews();
          delay = 500;
        } else {
          if (!hasTwoPlusInDoc && this.liveManualPauseSlug === session.key) {
            this.liveManualPauseSlug = null;
          }
          const newConflict = isDrive ? (session.conflict?.sha256 || session.conflict?.version) : session.conflict?.updated_at;
          if (connectionChanged || peersChanged || oldConflict !== newConflict || batch) {
            this.renderLiveBanner(); this.updateStatusBar(); this.refreshDockViews(true);
          }
          if (session.isCanvas) {
            const now = Date.now();
            const activelyEditing = now - session.lastTypedAt < 5_000 ||
              now - session.canvasRemoteChangedAt < 5_000 || next.some(peer => peer.action === "typing");
            delay = session.pendingCanvasPage || batch ? 220 : activelyEditing ? 650 : 2_500;
          } else {
            delay = batch ? 500 : next.length || Date.now() - session.lastTypedAt < 5_000 ? 1_000 : 2_500;
          }
        }
      } else if (isDrive && session.isCanvas && result.status === 409 &&
                 ["CANVAS_SAVE_PENDING", "CANVAS_REFRESH_REQUIRED"].includes(response?.code)) {
        if (response?.code === "CANVAS_REFRESH_REQUIRED") {
          session.pendingCanvasAck = batch?.content;
          session.batch = null;
          session.forceRefresh = true;
        }
        delay = 300;
      } else if (liveWriting && result.status === 409 && batch && (isDrive ? typeof response?.content === "string" : (response?.page?.slug === session.slug && VERSION.test(response.page.updated_at) && typeof response.page.content === "string"))) {
        session.batch = null;
        if (isDrive) {
          const acknowledgement = session.isCanvas && FC_DRIVE_SYNC.canvasTextEquals(response.content, batch.content) ? batch.content : undefined;
          await this.receiveLivePage(session, { fileId: response.fileId, rev: response.rev, version: response.version, sha256: response.sha256, content: response.content }, acknowledgement);
        } else {
          await this.receiveLivePage(session, response.page);
        }
        delay = session.isCanvas ? 250 : 1_000;
        this.renderLiveBanner(); this.refreshDockViews(true);
      } else {
        this.liveConnected = false;
        session.retryDelay = result.status === 401 || result.status === 403 ? 12_000 : 5_000;
        delay = session.retryDelay;
        this.renderLiveBanner(); this.refreshDockViews(true);
      }
    } catch {
      if (this.liveSession === session) {
        this.liveConnected = false;
        session.retryDelay = Math.min(20_000, Math.max(3_000, session.retryDelay * 2));
        delay = session.retryDelay;
        this.renderLiveBanner(); this.refreshDockViews(true);
      }
    } finally {
      session.busy = false;
      this.queueLiveCheck(session, session.canvasPendingEdit && !session.retryDelay ? 150 : delay);
    }
  }

  scheduleLiveEditorPush(_editor, file, slug) {
    const session = this.liveSession;
    const key = session ? (session.key || session.slug) : null;
    if (!session || session.file !== file || key !== slug || session.conflict) return;
    session.lastTypedAt = Date.now();
    if (session.isCanvas) session.canvasPendingEdit = true;
    if (!session.busy) this.queueLiveCheck(session, session.isCanvas ? 180 : 450);
  }

  async resolveLiveConflict(choice = "compare") {
    const session = this.liveSession, remote = session?.conflict;
    if (!remote || !this.liveSessionAuthorized(session)) return;
    const mode = choice === true ? "remote" : choice === false ? "local" : (choice || "compare");
    const isDrive = session.kind === "drive";
    const current = () => this.liveSessionAuthorized(session) && (isDrive
      ? (session.conflict?.version === remote.version && session.conflict?.sha256 === remote.sha256 && session.conflict?.content === remote.content)
      : (session.conflict?.updated_at === remote.updated_at && session.conflict?.content === remote.content));
    let local;
    try { local = await this.localNote(session.file); }
    catch { new Notice("Не вдалося прочитати локальну нотатку."); return; }
    if (!current()) return;
    this.openLiveConflictModal(session, local, remote, mode, current);
  }

  openLiveConflictModal(session, local, remote, defaultMode = "compare", current = null) {
    const isDrive = session.kind === "drive";
    const isCanvas = Boolean(session.isCanvas || local?.isCanvas);
    const stillValid = current || (() => this.liveSessionAuthorized(session) && (isDrive
      ? (session.conflict?.version === remote.version && session.conflict?.sha256 === remote.sha256 && session.conflict?.content === remote.content)
      : (session.conflict?.updated_at === remote.updated_at && session.conflict?.content === remote.content)));
    const localComparableInitial = isDrive
      ? (isCanvas
        ? FC_DRIVE_SYNC.retainCanvasMedia(String(local.raw ?? "").replace(/\r\n?/g, "\n"), local.diskRaw, session.base, session.canvasAttachments)
        : String(local.raw ?? "").replace(/\r\n?/g, "\n"))
      : String(local.body ?? "");
    const remoteText = String(remote.content ?? "").replace(/\r\n?/g, "\n");
    const remoteLabel = isDrive ? "На Google Drive" : "На сайті";
    const canvasDiff = isCanvas && typeof FC_DRIVE_SYNC.summarizeCanvasDiff === "function"
      ? FC_DRIVE_SYNC.summarizeCanvasDiff(localComparableInitial, remoteText, session.base)
      : null;
    const smartMerged = isCanvas && typeof FC_DRIVE_SYNC.mergeCanvasBestEffort === "function"
      ? FC_DRIVE_SYNC.mergeCanvasBestEffort(session.base, localComparableInitial, remoteText, { prefer: "local" })
      : null;

    this.dialog?.close();
    const modal = new Modal(this.app);
    this.dialog = modal;

    modal.onOpen = () => {
      modal.titleEl.setText(isCanvas ? "Конфлікт дошки Canvas" : "Порівняти версії Live Edit");
      const wrap = modal.contentEl.createDiv({ cls: "fc-conflict-modal", attr: { "data-fc-live-conflict-modal": isCanvas ? "canvas" : "markdown" } });
      wrap.createEl("p", {
        cls: "fc-deck-sub",
        text: isCanvas
          ? `У дошці «${session.file?.basename || "Canvas"}» є одночасні правки. Оберіть дію — зайві копії у папці не створюються.`
          : `У документі «${session.file?.basename || "Нотатка"}» є одночасні правки. Оберіть, яку редакцію застосувати.`,
      });

      if (isCanvas && canvasDiff) {
        const summary = wrap.createDiv({ cls: "fc-conflict-summary", attr: { "data-fc-canvas-diff-summary": "" } });
        const pills = summary.createDiv({ cls: "fc-conflict-pills" });
        pills.createSpan({ cls: "fc-deck-badge", text: `У вас: ${canvasDiff.localCount} карток` });
        pills.createSpan({ cls: "fc-deck-badge", text: `${remoteLabel}: ${canvasDiff.remoteCount} карток` });
        if (canvasDiff.localOnly.length) pills.createSpan({ cls: "fc-deck-badge fc-deck-badge-ok", text: `+${canvasDiff.localOnly.length} лише у вас` });
        if (canvasDiff.remoteOnly.length) pills.createSpan({ cls: "fc-deck-badge fc-deck-badge-ok", text: `+${canvasDiff.remoteOnly.length} лише на ${isDrive ? "Drive" : "сайті"}` });
        if (canvasDiff.changedBoth.length) pills.createSpan({ cls: "fc-deck-badge fc-deck-badge-warn", text: `Змінено разом: ${canvasDiff.changedBoth.length}` });

        const renderBucket = (title, items, formatter) => {
          if (!items.length) return;
          const sec = summary.createDiv({ cls: "fc-conflict-section" });
          sec.createEl("strong", { text: title, cls: "fc-conflict-section-title" });
          const ul = sec.createEl("ul", { cls: "fc-conflict-list" });
          for (const item of items.slice(0, 6)) ul.createEl("li", { text: formatter(item) });
          if (items.length > 6) ul.createEl("li", { text: `… та ще ${items.length - 6}`, cls: "fc-deck-row-meta" });
        };

        renderBucket("Лише у вашій версії:", canvasDiff.localOnly, (it) => it.removedRemotely ? `${it.label} (прибрано на ${isDrive ? "Drive" : "сайті"})` : it.label);
        renderBucket(`Лише ${remoteLabel.toLowerCase()}:`, canvasDiff.remoteOnly, (it) => it.removedLocally ? `${it.label} (прибрано у вас)` : it.label);
        renderBucket("Одночасні зміни в картках:", canvasDiff.changedBoth, (it) => {
          const kind = it.movedOnly ? "переміщено/розмір" : "оновлено текст";
          return it.localLabel === it.remoteLabel
            ? `${it.localLabel} (${kind})`
            : `«${it.localLabel}» ↔ «${it.remoteLabel}»`;
        });
        if (!canvasDiff.localOnly.length && !canvasDiff.remoteOnly.length && !canvasDiff.changedBoth.length) {
          summary.createEl("p", {
            cls: "fc-deck-row-meta",
            text: `Змінилися лише зв’язки або параметри полотна (${canvasDiff.edgesDelta.localCount} ↔ ${canvasDiff.edgesDelta.remoteCount} з’єднань).`,
          });
        }

        const rawDetails = wrap.createEl("details", { cls: "fc-conflict-raw-details", attr: { "data-fc-conflict-raw": "" } });
        rawDetails.createEl("summary", { text: "Показати технічний JSON (для перевірки)" });
        const panels = rawDetails.createDiv({ cls: "fc-sync-review-previews" });
        for (const [label, body] of [["У цьому Vault", localComparableInitial], [remoteLabel, remoteText]]) {
          const panel = panels.createDiv({ cls: "fc-sync-review-preview" });
          panel.createEl("h4", { text: label });
          panel.createEl("pre").createEl("code", { text: body.slice(0, MAX_NOTE) });
        }
      } else {
        const diffLines = typeof FC_MARKDOWN_DIFF !== "undefined" && typeof FC_MARKDOWN_DIFF.diffMarkdownLines === "function"
          ? FC_MARKDOWN_DIFF.diffMarkdownLines(localComparableInitial, remoteText, { context: 1, maxInlinePairs: 6 })
          : null;
        if (diffLines?.length) {
          const diffBox = wrap.createDiv({ cls: "fc-conflict-summary" });
          diffBox.createEl("strong", { text: "Змінені рядки:", cls: "fc-conflict-section-title" });
          const ul = diffBox.createEl("ul", { cls: "fc-conflict-list" });
          const changed = diffLines.filter((d) => d && d.type !== "equal").slice(0, 12);
          for (const d of changed) {
            const prefix = d.type === "add" ? "+ " : d.type === "remove" ? "− " : "~ ";
            const text = d.text ?? d.newLine ?? d.oldLine ?? "";
            ul.createEl("li", { text: `${prefix}${String(text).slice(0, 140)}`, cls: d.type === "add" ? "is-added" : d.type === "remove" ? "is-removed" : "" });
          }
          if (!changed.length) diffBox.createEl("p", { cls: "fc-deck-row-meta", text: "Відрізняється форматування або переноси рядків." });
        }
        const panels = wrap.createDiv({ cls: "fc-sync-review-previews" });
        for (const [label, body] of [["У цьому Vault", localComparableInitial], [remoteLabel, remoteText]]) {
          const panel = panels.createDiv({ cls: "fc-sync-review-preview" });
          panel.createEl("h4", { text: label });
          panel.createEl("pre").createEl("code", { text: body.slice(0, MAX_NOTE) });
        }
      }

      const backupLabel = wrap.createEl("label", { cls: "fc-conflict-backup-opt" });
      const backupCheckbox = backupLabel.createEl("input", { attr: { type: "checkbox", "data-fc-conflict-backup": "" } });
      backupCheckbox.checked = false;
      backupLabel.createSpan({ text: "Зберегти архівну копію попередньої версії у FlightClub Sync Archive (за потреби)" });

      const status = wrap.createEl("p", { cls: "fc-sync-status", attr: { role: "status" } });
      const actions = wrap.createDiv({ cls: "fc-conflict-actions" });
      const actionButtons = [];
      const setBusy = (busy) => { for (const b of actionButtons) b.disabled = busy; };

      const applyResolution = async (chosenMode) => {
        if (!stillValid() || session.busy) {
          status.setText("Серверна версія перевіряється або вже змінилася. Оновіть дані.");
          return;
        }
        setBusy(true);
        session.busy = true;
        status.setText("Застосовуємо вибраний варіант…");
        try {
          const freshLocal = await this.localNote(session.file);
          if (isCanvas ? !FC_DRIVE_SYNC.canvasTextEquals(freshLocal.raw, local.raw) : freshLocal.raw !== local.raw) {
            throw new Error("Локальний файл змінився під час перегляду. Відкрийте порівняння ще раз.");
          }
          if (!stillValid() || !this.alive || this.dialog !== modal) return;

          const maybeArchivePrevious = async () => {
            if (!backupCheckbox.checked) return null;
            const folder = "FlightClub Sync Archive/live-conflicts";
            const parts = folder.split("/");
            for (let i = 1; i <= parts.length; i++) {
              const p = parts.slice(0, i).join("/");
              if (!this.app.vault.getAbstractFileByPath(p)) {
                this.markInternalSyncWrite?.(p);
                await this.app.vault.createFolder(p);
              }
            }
            const ext = isCanvas ? ".canvas" : ".md";
            const stem = String(session.file?.basename || "note").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 60);
            const backup = `${folder}/${stem}-${Date.now()}${ext}`;
            this.markInternalSyncWrite?.(backup);
            await this.app.vault.create(backup, freshLocal.raw);
            return backup;
          };

          if (chosenMode === "merge" && smartMerged) {
            const backup = await maybeArchivePrevious();
            const stillOpen = () => stillValid() && this.alive && this.dialog === modal;
            const ok = await this.applyRawDriveContent(session.file, freshLocal, smartMerged, stillOpen);
            if (!ok) throw new Error("Не вдалося оновити полотно Canvas у пам’яті. Закрийте інші вікна редагування й повторіть.");
            const freshHash = await contentHash(remoteText);
            session.base = remoteText;
            session.liveRev = remote.rev ?? session.liveRev;
            session.revision = remote.version ?? session.revision;
            session.sha256 = remote.sha256 ?? freshHash;
            session.batch = {
              opId: crypto.randomUUID(),
              baseRev: session.liveRev,
              revision: session.revision,
              baseSha256: session.sha256,
              baseContent: remoteText,
              content: smartMerged,
              isCanvas: true,
            };
            session.conflict = null;
            session.pendingCanvasPage = null;
            new Notice(backup ? `🔀 Версії Canvas об’єднано (резерв: ${backup})` : "🔀 Версії Canvas об’єднано без втрати карток.");
          } else if (chosenMode === "local") {
            const freshNorm = isDrive
              ? (isCanvas
                ? FC_DRIVE_SYNC.retainCanvasMedia(String(freshLocal.raw ?? "").replace(/\r\n?/g, "\n"), freshLocal.diskRaw, session.base, session.canvasAttachments)
                : String(freshLocal.raw ?? "").replace(/\r\n?/g, "\n"))
              : String(freshLocal.body ?? "");
            if (isDrive) {
              const freshHash = await contentHash(remoteText);
              session.base = remoteText;
              session.liveRev = remote.rev ?? session.liveRev;
              session.revision = remote.version ?? session.revision;
              session.sha256 = remote.sha256 ?? freshHash;
              if (isCanvas) {
                if (freshNorm.length > MAX_NOTE) throw new Error("Розмір Canvas перевищує ліміт Live Edit.");
                session.batch = {
                  opId: crypto.randomUUID(),
                  baseRev: session.liveRev,
                  revision: session.revision,
                  baseSha256: session.sha256,
                  baseContent: remoteText,
                  content: freshNorm,
                  isCanvas: true,
                };
              } else {
                const change = diffToChange(remoteText, freshNorm);
                if (!change || freshNorm.length > MAX_NOTE) throw new Error("Цей текст не можна відправити через Live Edit.");
                session.batch = { opId: crypto.randomUUID(), baseRev: session.liveRev, revision: session.revision, content: freshNorm, change };
              }
            } else {
              const change = diffToChange(remoteText, freshNorm);
              if (!change || freshNorm.length > MAX_NOTE) throw new Error("Цей текст не можна відправити через Live Edit.");
              session.batch = { opId: crypto.randomUUID(), revision: remote.updated_at, content: freshNorm, change };
              session.base = remoteText;
              session.revision = remote.updated_at;
            }
            session.conflict = null;
            session.pendingCanvasPage = null;
            new Notice("⬆️ Локальну версію поставлено на синхронізацію.");
          } else {
            const backup = await maybeArchivePrevious();
            const stillOpen = () => stillValid() && this.alive && this.dialog === modal;
            if (isDrive) {
              const ok = await this.applyRawDriveContent(session.file, freshLocal, remoteText, stillOpen);
              if (!ok) throw new Error(backup ? `Файл змінився під час запису. Резерв: ${backup}` : "Файл змінився під час запису. Повторіть спробу.");
              const freshHash = remote.sha256 ?? await contentHash(remoteText);
              session.base = remoteText;
              session.liveRev = remote.rev ?? session.liveRev;
              session.revision = remote.version ?? session.revision;
              session.sha256 = freshHash;
              session.conflict = null;
              session.pendingCanvasPage = null;
              await this.rememberDriveLiveBaseline(session.file, { fileId: session.fileId, version: session.revision, sha256: session.sha256 }, remoteText);
            } else {
              if (!await this.applyNoteContent(session.file, freshLocal, remoteText, stillOpen)) {
                throw new Error(backup ? `Нотатка змінилася. Резервну копію збережено: ${backup}` : "Нотатка змінилася. Повторіть спробу.");
              }
              session.base = remoteText;
              session.revision = remote.updated_at;
              session.conflict = null;
              await this.rememberBaseline(session.file, remote);
            }
            new Notice(backup ? `⬇️ Прийнято версію (${backup})` : `⬇️ Прийнято версію ${isDrive ? "з Google Drive" : "із сайту"}.`);
          }
          if (this.dialog === modal) modal.close();
        } catch (err) {
          status.setText(err instanceof Error ? err.message : "Не вдалося вирішити конфлікт.");
        } finally {
          session.busy = false;
          setBusy(false);
          this.queueLiveCheck(session, 0);
          this.renderLiveBanner();
          this.refreshDockViews(true);
        }
      };

      if (smartMerged) {
        const mergeBtn = actions.createEl("button", {
          text: "🔀 Об’єднати обидві версії",
          cls: "mod-cta fc-deck-btn",
          attr: { type: "button", "data-fc-conflict-merge": "" },
        });
        mergeBtn.addEventListener("click", () => void applyResolution("merge"));
        actionButtons.push(mergeBtn);
      }

      const localBtn = actions.createEl("button", {
        text: "⬆️ Залишити мою версію",
        cls: (!smartMerged && defaultMode === "local" ? "mod-cta " : "") + "fc-deck-btn",
        attr: { type: "button", "data-fc-conflict-local": "" },
      });
      localBtn.addEventListener("click", () => void applyResolution("local"));
      actionButtons.push(localBtn);

      const remoteBtn = actions.createEl("button", {
        text: isDrive ? "⬇️ Прийняти з Google Drive" : "⬇️ Прийняти версію сайту",
        cls: (!smartMerged && defaultMode === "remote" ? "mod-cta " : "") + "fc-deck-btn",
        attr: { type: "button", "data-fc-conflict-remote": "" },
      });
      remoteBtn.addEventListener("click", () => void applyResolution("remote"));
      actionButtons.push(remoteBtn);

      const focusTarget = smartMerged ? actionButtons[0] : (defaultMode === "remote" ? remoteBtn : localBtn);
      focusTarget?.focus?.();
    };

    modal.onClose = () => {
      if (this.dialog === modal) this.dialog = null;
      modal.contentEl.empty();
    };
    modal.open();
  }

  describePeerActivity(peer, isCanvas = false) {
    const rawDetail = String(peer?.actionDetail || "").trim();
    const action = String(peer?.action || "").toLowerCase();
    const editing = Boolean(
      peer?.editing ||
      action === "typing" ||
      action === "editing_meta" ||
      /друкує|редагує|змінює/i.test(rawDetail)
    );
    const selecting = action === "selecting" || /виділяє/i.test(rawDetail);
    const saved = action === "saved" || /зберіг/i.test(rawDetail);
    const lineNum = typeof peer?.line === "number" && peer.line >= 1 ? Math.floor(peer.line) : null;
    if (isCanvas) {
      const detail = rawDetail && !/ряд\.\s*1\b/i.test(rawDetail)
        ? rawDetail
        : editing ? "редагує Canvas" : saved ? "зберіг Canvas" : "переглядає Canvas";
      return {
        icon: editing ? "✏️" : saved ? "💾" : "🎨",
        text: detail,
        state: editing ? "editing" : saved ? "saved" : "viewing",
        editing,
        line: null,
      };
    }
    const fallbackText = editing
      ? (lineNum ? `друкує в ряд. ${lineNum}` : "друкує зараз")
      : selecting
        ? (lineNum ? `виділяє в ряд. ${lineNum}` : "виділяє текст")
        : saved
          ? "зберіг документ"
          : (lineNum ? `читає · ряд. ${lineNum}` : "переглядає документ");
    const detail = rawDetail
      ? (lineNum && !/ряд\./i.test(rawDetail) && !saved ? `${rawDetail} · ряд. ${lineNum}` : rawDetail)
      : fallbackText;
    return {
      icon: editing ? "✏️" : selecting ? "✂️" : saved ? "💾" : "👀",
      text: detail,
      state: editing ? "editing" : selecting ? "selecting" : saved ? "saved" : "viewing",
      editing: editing || selecting,
      line: lineNum,
    };
  }

  dedupeOnlineRooms(workspaceActivity, sharedPeers, activeFile = null, activeSharedPath = null) {
    const normPath = (raw) => String(raw || "")
      .trim()
      .replace(/\\/g, "/")
      .replace(/^\/+|\/+$/g, "")
      .replace(/^FlightClub(?:_Vault[^/]*)?\//i, "")
      .replace(/^FlightClub Shared\//i, "")
      .replace(/\.(?:md|markdown)$/i, "")
      .normalize("NFKC")
      .toLocaleLowerCase("uk");
    const activeFileId =
      (activeFile && typeof this.resolveDriveIdForFile === "function" ? this.resolveDriveIdForFile(activeFile) : null) ||
      this.liveSession?.fileId ||
      null;
    const activePathNorm = activeFile?.path ? normPath(activeFile.path) : activeSharedPath ? normPath(activeSharedPath) : "";
    const peerRank = (p) => {
      const isSelf = Boolean(p?.clientId && p.clientId === this.clientId);
      const editing = Boolean(p?.editing || p?.action === "typing" || p?.action === "editing_meta");
      const hasLine = typeof p?.line === "number" && p.line >= 1 ? 1 : 0;
      const ts = Number(Date.parse(p?.updatedAt || p?.lastSeen || "") || p?.ts || 0) || 0;
      return [isSelf ? 1 : 0, editing ? 1 : 0, hasLine, ts];
    };
    const beats = (a, b) => {
      const ra = peerRank(a), rb = peerRank(b);
      for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] > rb[i];
      return false;
    };
    const canonicalRoomKey = (room) => {
      if (room?.fileId) return "fid:" + String(room.fileId);
      const np = normPath(room?.path || "");
      if (np) return "path:" + np;
      const nt = normPath(room?.title || "");
      if (nt) return "title:" + nt;
      return "slug:" + String(room?.slug || "unknown");
    };
    const rawRooms = [...(workspaceActivity || [])];
    if (sharedPeers?.length) {
      const byShared = new Map();
      for (const sp of sharedPeers) {
        const key = sp.fileId || sp.path || "shared";
        if (!byShared.has(key)) {
          byShared.set(key, {
            kind: "shared",
            fileId: sp.fileId || null,
            path: sp.path || "",
            slug: `shared:${key}`,
            title: (sp.path || "").split("/").pop() || "Опублікований вольт",
            peers: [],
          });
        }
        byShared.get(key).peers.push(sp);
      }
      for (const sr of byShared.values()) rawRooms.push(sr);
    }
    const mergedByKey = new Map();
    const byPathIndex = new Map();
    const byTitleIndex = new Map();
    const findExisting = (room) => {
      const fidKey = room?.fileId ? "fid:" + String(room.fileId) : null;
      if (fidKey && mergedByKey.has(fidKey)) return mergedByKey.get(fidKey);
      const np = normPath(room?.path || "");
      if (np && byPathIndex.has(np)) return byPathIndex.get(np);
      const nt = normPath(room?.title || "");
      if (nt && byTitleIndex.has(nt)) return byTitleIndex.get(nt);
      return mergedByKey.get(canonicalRoomKey(room)) || null;
    };
    for (const room of rawRooms) {
      if (!room) continue;
      let target = findExisting(room);
      if (!target) {
        target = { ...room, peers: [], _peerMap: new Map() };
        mergedByKey.set(canonicalRoomKey(room), target);
      } else {
        if (room.kind === "drive" && target.kind !== "drive") target.kind = "drive";
        if (room.fileId && !target.fileId) target.fileId = room.fileId;
        if (room.path && (!target.path || room.path.length > target.path.length)) target.path = room.path;
        if (room.title && (!target.title || target.title === "Опублікований вольт")) target.title = room.title;
        if (room.slug && room.slug === this.liveSlug) target.slug = room.slug;
      }
      if (target.fileId) mergedByKey.set("fid:" + String(target.fileId), target);
      const np = normPath(target.path || room.path || "");
      if (np) byPathIndex.set(np, target);
      const nt = normPath(target.title || room.title || "");
      if (nt) byTitleIndex.set(nt, target);
      for (const p of room.peers || []) {
        if (!p) continue;
        const isSelfClient = Boolean(p.clientId && p.clientId === this.clientId);
        if (isSelfClient && activeFile) {
          const roomMatchesActive = Boolean(
            (target.fileId && activeFileId && target.fileId === activeFileId) ||
            (this.liveSlug && (target.slug === this.liveSlug || room.slug === this.liveSlug)) ||
            (activePathNorm && np && np === activePathNorm) ||
            (activePathNorm && nt && nt === activePathNorm.split("/").pop())
          );
          if (!roomMatchesActive) continue;
        }
        const pKey = p.userId
          ? "u:" + String(p.userId)
          : p.clientId
            ? "c:" + String(p.clientId)
            : "n:" + String(p.name || "").trim().toLowerCase();
        const prev = target._peerMap.get(pKey);
        if (!prev || beats(p, prev)) target._peerMap.set(pKey, p);
      }
    }
    const unique = [];
    const seen = new Set();
    for (const target of mergedByKey.values()) {
      if (seen.has(target)) continue;
      seen.add(target);
      target.peers = [...target._peerMap.values()];
      delete target._peerMap;
      if (target.peers.length > 0) unique.push(target);
    }
    return unique;
  }

  async jumpToPeerCursor(peer, targetFile = null) {
    const file = targetFile || this.liveSession?.file || this.activeNote?.();
    if (!file) {
      new Notice("Відкрийте документ, щоб перейти до учасника.");
      return false;
    }
    const isCanvas = file.extension?.toLowerCase?.() === "canvas" || String(file.path || "").toLowerCase().endsWith(".canvas");
    const view = this.noteView?.(file) || null;
    if (isCanvas) {
      if (view?.leaf && this.app?.workspace?.setActiveLeaf) {
        try { this.app.workspace.setActiveLeaf(view.leaf, { focus: true }); } catch {}
      }
      const info = this.describePeerActivity(peer, true);
      new Notice(`🎯 ${peer?.name || "Учасник"} · ${info.text}`);
      return true;
    }
    if (view && view.getMode?.() === "preview" && typeof view.setState === "function") {
      try {
        await view.setState({ ...(view.getState?.() || {}), mode: "source" }, { history: false });
      } catch {}
    }
    if (!view?.editor || view.getMode?.() === "preview") {
      new Notice("Відкрийте нотатку в режимі редагування.");
      return false;
    }
    const editor = view.editor;
    const raw = editor.getValue();
    const isDrive = Boolean(this.liveSession?.file === file ? this.liveSession.kind === "drive" : !this.linkFor?.(file));
    const fmBlock = isDrive ? "" : splitFrontmatter(raw).frontmatterBlock;
    let position;
    if (typeof peer?.head === "number" && Number.isFinite(peer.head) && (peer.head > 0 || !(typeof peer?.line === "number" && peer.line > 1))) {
      const offset = fmBlock.length + Math.max(0, peer.head);
      position = editor.offsetToPos(Math.min(raw.length, offset));
    } else if (typeof peer?.line === "number" && Number.isFinite(peer.line) && peer.line >= 1) {
      const fmLines = fmBlock ? fmBlock.split("\n").length - 1 : 0;
      const totalLines = typeof editor.lineCount === "function" ? editor.lineCount() : raw.split("\n").length;
      const lineIdx = Math.max(0, Math.min(Math.max(0, totalLines - 1), fmLines + Math.floor(peer.line) - 1));
      const lineStr = typeof editor.getLine === "function" ? editor.getLine(lineIdx) : (raw.split("\n")[lineIdx] || "");
      const ch = Math.max(0, Math.min(String(lineStr || "").length, Math.floor(Number(peer.col) || 1) - 1));
      position = { line: lineIdx, ch };
    } else {
      position = { line: 0, ch: 0 };
    }
    editor.setCursor(position);
    editor.scrollIntoView({ from: position, to: position }, true);
    editor.focus?.();
    try {
      const activeLineEl = view.containerEl?.querySelector?.(".cm-activeLine");
      if (activeLineEl?.classList) {
        activeLineEl.classList.remove("fc-teleport-flash");
        void activeLineEl.offsetWidth;
        activeLineEl.classList.add("fc-teleport-flash");
        setTimeout(() => activeLineEl.classList?.remove?.("fc-teleport-flash"), 1600);
      }
    } catch {}
    new Notice(`🎯 Телепорт до ${peer?.name || "учасника"} · ряд. ${(position?.line ?? 0) + 1}`);
    return true;
  }

  async teleportToOnlinePeer(room, peer) {
    if (!room) return false;
    const active = this.activeNote?.();
    const isCurrent = Boolean(
      room.kind === "drive"
        ? (room.fileId && (this.liveSession?.fileId === room.fileId || this.resolveDriveIdForFile?.(active) === room.fileId))
        : room.kind === "shared"
          ? (room.path && active && this.sharedNotePath?.(active) === room.path)
          : (room.slug && (this.liveSlug === room.slug || this.linkFor?.(active)?.slug === room.slug))
    );
    let targetFile = isCurrent ? active : null;
    if (!targetFile) {
      if (room.kind === "drive" && room.fileId) {
        targetFile = await this.openDriveFileInObsidian(room.fileId, room.path);
      } else if (room.kind === "shared" && room.path) {
        const found = this.app?.vault?.getAbstractFileByPath?.(room.path)
          || this.app?.vault?.getAbstractFileByPath?.(`FlightClub Shared/${room.path}`);
        if (found instanceof TFile) {
          const leaf = this.app.workspace.getLeaf?.(false) || this.app.workspace.getLeaf?.();
          if (leaf?.openFile) await leaf.openFile(found, { active: true });
          targetFile = found;
        }
      } else if (room.slug) {
        targetFile = await this.openSitePageInObsidian(room.slug);
      }
    }
    if (!targetFile) return false;
    if (!isCurrent) {
      this.attachLiveSessionToActiveNote?.(targetFile);
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    const liveMatch = (this.livePeers || []).find((lp) =>
      (peer?.clientId && lp.clientId === peer.clientId) || (peer?.userId && lp.userId === peer.userId)
    );
    return this.jumpToPeerCursor(liveMatch || peer, targetFile);
  }

  renderLiveBanner() {
    this.refreshCursorDecorations?.();
    const view = this.app?.workspace && this.activeNote ? this.noteView?.(this.activeNote()) : null;
    const container = view?.containerEl?.querySelector?.(".view-content");
    if (!container || typeof container.ownerDocument?.createElement !== "function") {
      this.liveBannerEl?.remove?.();
      this.liveBannerEl = null;
      this.liveBannerSignature = null;
      return;
    }
    const file = view.file;
    const link = file ? this.linkFor(file) : null;
    const driveId = !link && file ? this.resolveDriveIdForFile?.(file) : null;
    const target = file ? this.liveTargetFor?.(file) : null;
    const sharedPath = file ? this.sharedNotePath(file) : null;
    if (!file || (!link && !driveId && !sharedPath)) {
      this.liveBannerEl?.remove?.();
      this.liveBannerEl = null;
      this.liveBannerSignature = null;
      return;
    }
    const mode = target ? this.liveModeState(file) : null;
    const activeSharedFileId = this.sharedWebNote?.path === sharedPath ? this.sharedWebNote?.fileId : null;
    const peers = target ? this.livePeers : (activeSharedFileId ? (this.sharedPeers || []).filter(p => p.fileId === activeSharedFileId) : []);
    const bannerSig = JSON.stringify([
      file.path,
      target?.key || "",
      mode?.state || "",
      mode?.label || "",
      Boolean(this.vaultConfig.liveEnabled),
      Boolean(this.liveModeChanging),
      this.vaultConfig.liveBannerCollapsed !== false,
      sharedPath || "",
      peers.map(p => [p.clientId || p.userId, p.name, p.line, p.editing, p.actionDetail, p.color]),
    ]);
    if (this.liveBannerEl && this.liveBannerEl.parentElement === container && this.liveBannerSignature === bannerSig) {
      return;
    }
    this.liveBannerSignature = bannerSig;
    const doc = container.ownerDocument;
    if (!this.liveBannerEl || this.liveBannerEl.parentElement !== container) {
      this.liveBannerEl?.remove?.();
      this.liveBannerEl = doc.createElement("div");
      container.prepend(this.liveBannerEl);
    }
    const banner = this.liveBannerEl;
    const paused = Boolean(mode && !this.vaultConfig.liveEnabled);
    const unpaired = Boolean(mode && mode.state === "account");
    const bannerCollapsed = this.vaultConfig.liveBannerCollapsed !== false;
    banner.className = "fc-live-banner"
      + (paused ? " fc-live-banner-paused" : "")
      + (unpaired ? " fc-live-banner-unpaired" : "")
      + (bannerCollapsed ? " fc-live-banner-collapsed" : "");
    banner.setAttribute("data-collapsed", String(bannerCollapsed));
    banner.replaceChildren();

    const toggleCollapse = () => {
      this.vaultConfig.liveBannerCollapsed = !bannerCollapsed;
      void this.persist().catch(() => {});
      this.liveBannerSignature = null;
      this.renderLiveBanner();
      this.refreshDockViews(true);
    };

    const iconTrigger = doc.createElement("button");
    iconTrigger.type = "button";
    iconTrigger.className = "fc-live-icon-trigger";
    iconTrigger.setAttribute("data-fc-live-icon", "true");
    iconTrigger.setAttribute("aria-expanded", String(!bannerCollapsed));
    iconTrigger.title = bannerCollapsed
      ? `${mode?.label || "Live Edit"}${peers.length ? ` · учасників: ${peers.length + 1}` : ""} (клік — розгорнути)`
      : "Згорнути панель Live Edit в іконку";
    const iconDot = doc.createElement("span");
    iconDot.className = "fc-live-dot" + (paused ? " fc-live-dot-paused" : unpaired ? " fc-live-dot-offline" : "");
    iconDot.setAttribute("aria-hidden", "true");
    iconTrigger.append(iconDot);
    const iconLabel = doc.createElement("span");
    iconLabel.className = "fc-live-icon-label";
    iconLabel.textContent = paused ? "Пауза" : unpaired ? "Offline" : (file.extension?.toLowerCase?.() === "canvas" ? "Canvas Live" : "Live");
    iconTrigger.append(iconLabel);
    if (peers.length > 0) {
      const pCount = doc.createElement("span");
      pCount.className = "fc-live-icon-peers";
      pCount.textContent = `👥 ${peers.length + 1}`;
      iconTrigger.append(pCount);
    }
    iconTrigger.addEventListener("click", toggleCollapse);
    banner.append(iconTrigger);

    const status = doc.createElement("div");
    status.className = "fc-live-status";
    const dot = doc.createElement("span");
    dot.className = "fc-live-dot" + (paused ? " fc-live-dot-paused" : unpaired ? " fc-live-dot-offline" : "");
    dot.setAttribute("aria-hidden", "true");
    status.append(dot);
    if (link) {
      status.append(doc.createTextNode(`${mode.label} · /m/${link.slug}`));
    } else if (driveId) {
      status.append(doc.createTextNode(`${mode.label} · ${file.basename}`));
    } else {
      status.append(doc.createTextNode(`Опублікований вольт · ${sharedPath}`));
    }
    banner.append(status);
    const peersWrap = doc.createElement("div");
    peersWrap.className = "fc-live-peers";
    if (!peers.length) {
      const solo = doc.createElement("span");
      solo.className = "fc-live-solo-note";
      solo.textContent = "👥 Зараз у документі лише ви";
      peersWrap.append(solo);
    } else {
      const label = doc.createElement("span");
      label.className = "fc-live-solo-note";
      label.textContent = `👥 У документі (${peers.length + 1}):`;
      peersWrap.append(label);
      for (const peer of peers) {
        const group = doc.createElement("div");
        group.className = "fc-live-peer-group";
        if (peer.color) group.style.borderColor = peer.color;
        const chip = doc.createElement("button");
        chip.type = "button";
        chip.className = "fc-live-peer-chip" + (peer.opsec ? " is-opsec" : "");
        const pDot = doc.createElement("span");
        pDot.className = "fc-live-peer-dot";
        pDot.style.background = peer.color || "#38bdf8";
        chip.append(pDot);
        const sameAccount = peer.userId && peer.userId === this.vaultConfig.pairedUserId;
        const prof = userProfileUrl(peer.userId);
        const verb = peer.actionDetail || (peer.editing ? "редагує" : "переглядає");
        const where = peer.line && !String(verb).includes("ряд.") ? ` · ряд. ${peer.line}` : "";
        if (peer.opsec) {
          const obadge = doc.createElement("span");
          obadge.className = "fc-opsec-badge";
          obadge.textContent = "OPSEC";
          chip.append(obadge);
        }
        const peerLabel = peer.opsec && !prof ? "" : `${peer.name}${sameAccount ? " (ваш пристрій)" : ""}`;
        chip.append(doc.createTextNode(`${peerLabel ? peerLabel + " · " : ""}${verb}${where}`));
        if (target) chip.addEventListener("click", () => this.jumpToPeerCursor(peer));
        group.append(chip);
        if (prof) {
          const a = doc.createElement("a");
          a.className = "fc-live-peer-profile-link";
          a.href = prof;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.textContent = "↗";
          a.title = `Профіль ${peer.name}`;
          group.append(a);
        }
        peersWrap.append(group);
      }
    }
    banner.append(peersWrap);

    const actions = doc.createElement("div");
    actions.className = "fc-live-actions";
    if (target && mode?.eligible) {
      const toggle = doc.createElement("button");
      toggle.type = "button";
      toggle.className = "fc-live-mini-btn" + (!this.vaultConfig.liveEnabled ? " fc-live-mini-btn-cta" : "");
      toggle.textContent = this.vaultConfig.liveEnabled ? "⏸ Пауза Live" : "🟢 Увімкнути Live Edit";
      toggle.disabled = Boolean(this.liveModeChanging);
      toggle.addEventListener("click", () => void this.toggleLiveMode());
      actions.append(toggle);
    }
    const bannerDriveId = this.resolveDriveIdForFile?.(file);
    const bannerDocsTarget = this.siteEditTarget?.(file);
    if (bannerDriveId) {
      const gDriveViewUrl = driveOpenUrlForPath(bannerDriveId, file?.path);
      const isMdBanner = /\.(?:md|markdown)$/i.test(file?.path || "");
      const openDocs = doc.createElement("button");
      openDocs.type = "button";
      openDocs.className = "fc-live-mini-btn";
      openDocs.textContent = "Docs ↗";
      openDocs.title = `${isMdBanner ? "Відкрити у Google Docs" : "Відкрити у Google Drive"}: ${gDriveViewUrl}`;
      openDocs.addEventListener("click", () => this.openSite(gDriveViewUrl));
      actions.append(openDocs);

      const vaultWebUrl = `${SITE}/markdown?view=vault&file=${encodeURIComponent(bannerDriveId)}&edit=1`;
      const openVault = doc.createElement("button");
      openVault.type = "button";
      openVault.className = "fc-live-mini-btn";
      openVault.textContent = "Vault ↗";
      openVault.title = `Відкрити у FlightClub Drive Vault: ${vaultWebUrl}`;
      openVault.addEventListener("click", () => this.openSite(vaultWebUrl));
      actions.append(openVault);
    } else if (bannerDocsTarget?.url) {
      const openDocs = doc.createElement("button");
      openDocs.type = "button";
      openDocs.className = "fc-live-mini-btn";
      openDocs.textContent = "Docs ↗";
      openDocs.title = bannerDocsTarget.url;
      openDocs.addEventListener("click", () => this.openSite(bannerDocsTarget.url));
      actions.append(openDocs);
    }
    const openPanel = doc.createElement("button");
    openPanel.type = "button";
    openPanel.className = "fc-live-mini-btn";
    openPanel.textContent = "Панель FlightClub";
    openPanel.addEventListener("click", () => void this.activateDockView(true));
    actions.append(openPanel);

    const collapseBannerBtn = doc.createElement("button");
    collapseBannerBtn.type = "button";
    collapseBannerBtn.className = "fc-live-mini-btn fc-live-collapse-btn";
    collapseBannerBtn.setAttribute("data-fc-collapse", "live-banner");
    collapseBannerBtn.setAttribute("aria-expanded", String(!bannerCollapsed));
    collapseBannerBtn.title = bannerCollapsed ? "Розгорнути панель Live Edit" : "Згорнути панель Live Edit";
    collapseBannerBtn.textContent = bannerCollapsed ? "▸ Розгорнути" : "✕";
    collapseBannerBtn.addEventListener("click", toggleCollapse);
    actions.append(collapseBannerBtn);
    banner.append(actions);
  }

  registerMentionEditor() {
    if (typeof this.registerEditorExtension !== "function") return;
    const { Prec } = require("@codemirror/state");
    const { Decoration, ViewPlugin, WidgetType } = require("@codemirror/view");
    const { syntaxTree } = require("@codemirror/language");
    const openSite = (href, host) => this.openSite(href, host);
    const isPreview = (state) => !!obsidian.editorLivePreviewField && state.field(obsidian.editorLivePreviewField, false);

    class MentionWidget extends WidgetType {
      constructor(mention) { super(); this.mention = mention; }
      eq(other) { return this.mention.href === other.mention.href && this.mention.label === other.mention.label; }
      toDOM(view) { return mentionLink(view.dom.ownerDocument, this.mention, openSite); }
      ignoreEvent() { return true; }
    }

    function decorate(view) {
      const { state, visibleRanges } = view;
      if (!isPreview(state)) return Decoration.none;
      const tree = syntaxTree(state);
      const seen = new Set();
      const marks = [];
      for (const range of visibleRanges) {
        for (let number = state.doc.lineAt(range.from).number; number <= state.doc.lineAt(range.to).number; number++) {
          if (seen.has(number)) continue;
          seen.add(number);
          const line = state.doc.line(number);
          for (const mention of mentionsIn(line.text)) {
            const from = line.from + mention.from, to = line.from + mention.to;
            const editing = state.selection.ranges.some((selection) => selection.from <= to && selection.to >= from);
            if (editing || mentionInCode(tree, from, to)) continue;
            marks.push(Decoration.replace({ widget: new MentionWidget(mention) }).range(from, to));
          }
        }
      }
      return Decoration.set(marks, true);
    }

    const extension = ViewPlugin.fromClass(class {
      constructor(view) {
        this.view = view;
        this.decorations = decorate(view);
        view.dom.addEventListener("click", this.openSourceMention, true);
        view.dom.addEventListener("keydown", this.openSourceMention, true);
      }
      update(update) {
        if (update.docChanged || update.selectionSet || update.viewportChanged ||
            isPreview(update.startState) !== isPreview(update.state) ||
            syntaxTree(update.startState) !== syntaxTree(update.state)) this.decorations = decorate(update.view);
      }
      openSourceMention = (event) => {
        const keyboard = event.type === "keydown";
        if ((!event.ctrlKey && !event.metaKey) || (keyboard ? event.key !== "Enter" : event.button !== 0) ||
            event.target?.closest?.(`.fc-mention-chip, ${EXCLUDED_MENTION_DOM}`) ||
            !this.view.contentDOM.contains(event.target)) return;
        const position = keyboard ? this.view.state.selection.main.head
          : this.view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (position === null) return;
        const { state } = this.view;
        const line = state.doc.lineAt(position);
        const mention = [...mentionsIn(line.text)].find(({ from, to }) => line.from + from <= position && position < line.from + to);
        if (!mention || mentionInCode(syntaxTree(state), line.from + mention.from, line.from + mention.to)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        openSite(mention.href, this.view.dom.ownerDocument.defaultView);
      };
      destroy() {
        this.view.dom.removeEventListener("click", this.openSourceMention, true);
        this.view.dom.removeEventListener("keydown", this.openSourceMention, true);
      }
    }, { decorations: (plugin) => plugin.decorations });
    this.registerEditorExtension(Prec.high(extension));
  }

  registerCollaboratorCursors() {
    if (!obsidian.editorInfoField || typeof this.registerEditorExtension !== "function") return;
    try {
      const { StateEffect } = require("@codemirror/state");
      const { ViewPlugin, Decoration, WidgetType } = require("@codemirror/view");
      const owner = this, editors = new Set(), refresh = StateEffect.define();
      class PeerCaret extends WidgetType {
        constructor(peer) { super(); this.peer = peer; }
        eq(other) {
          return this.peer.clientId === other.peer.clientId && this.peer.avatarUrl === other.peer.avatarUrl
            && this.peer.name === other.peer.name && this.peer.color === other.peer.color;
        }
        toDOM(view) {
          const doc = view.dom.ownerDocument;
          const caret = doc.createElement("span");
          caret.className = "fc-inline-caret";
          caret.setAttribute("aria-hidden", "true");
          caret.style.setProperty("--fc-peer-color", this.peer.color);
          const profile = userProfileUrl(this.peer.userId);
          const label = doc.createElement(profile ? "a" : "span");
          label.className = "fc-inline-caret-label";
          if (profile) {
            label.href = profile; label.target = "_blank"; label.rel = "noopener noreferrer"; label.tabIndex = -1;
            label.addEventListener("mousedown", (event) => event.stopPropagation());
          }
          const photoUrl = secureImageUrl(this.peer.avatarUrl);
          if (photoUrl) {
            const photo = doc.createElement("img");
            photo.src = photoUrl; photo.alt = ""; photo.referrerPolicy = "no-referrer";
            photo.addEventListener("error", () => photo.remove(), { once: true });
            label.append(photo);
          }
          label.append(doc.createTextNode(this.peer.name));
          caret.append(label);
          return caret;
        }
      }
      function decorate(view) {
        const note = view.state.field(obsidian.editorInfoField, false);
        const session = owner.liveSession;
        if (!session || note?.file !== session.file || !owner.livePeers.length) return Decoration.none;
        const doc = view.state.doc, length = doc.length;
        const prefix = doc.sliceString(0, Math.min(length, 16_384));
        const header = splitFrontmatter(prefix).frontmatterBlock;
        const offset = session.kind === "drive"
          ? 0
          : (!header && prefix.startsWith("---\n") && length > prefix.length
            ? splitFrontmatter(doc.toString()).frontmatterBlock.length : header.length);
        const bound = (position) => Math.max(offset, Math.min(length, offset + Math.max(0, Number(position) || 0)));
        const visible = (from, to) => view.visibleRanges.some((range) => from <= range.to && to >= range.from);
        const decorations = [];
        for (const peer of owner.livePeers) {
          if (!/^#[0-9a-f]{6}$/i.test(peer.color)) continue;
          const head = bound(peer.head), anchor = bound(peer.anchor);
          const from = Math.min(head, anchor), to = Math.max(head, anchor);
          if (from !== to && visible(from, to)) {
            decorations.push(Decoration.mark({ class: "fc-inline-selection", attributes: { style: "--fc-peer-color:" + peer.color } }).range(from, to));
          }
          if (visible(head, head)) decorations.push(Decoration.widget({ widget: new PeerCaret(peer), side: 1 }).range(head));
        }
        return Decoration.set(decorations, true);
      }
      const extension = ViewPlugin.fromClass(class {
        constructor(view) { this.view = view; editors.add(view); this.decorations = decorate(view); }
        update(update) {
          if (update.docChanged || update.viewportChanged || update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(refresh)))) {
            this.decorations = decorate(update.view);
          }
        }
        destroy() { editors.delete(this.view); }
      }, { decorations: (plugin) => plugin.decorations });
      this.registerEditorExtension(extension);
      this.refreshCursorDecorations = () => {
        if (this.cursorRefresh) return;
        this.cursorRefresh = setTimeout(() => {
          this.cursorRefresh = null;
          for (const editor of editors) editor.dispatch({ effects: refresh.of(null) });
        }, 0);
      };
    } catch { /* The participant panel is also available in reading mode. */ }
  }

  folderSyncScope() {
    if (this.accountCanSyncPrivate && (this.vaultConfig.folderSyncScope === "private" ||
        (!this.vaultConfig.folderSyncScope && this.treeSyncState?.vaultId))) return "private";
    return "staff";
  }

  sharedNotePath(file = this.activeNote()) {
    const fullPath = file?.path;
    if (this.folderSyncScope() !== "staff" || !fullPath?.startsWith(SHARED_FOLDER) || !/\.md$/i.test(fullPath)) return null;
    return fullPath.slice(SHARED_FOLDER.length);
  }

  async sharedVaultPulse() {
    const token = this.vaultConfig.deviceToken;
    if (!this.alive || !token || !this.accountVerified || !this.vaultConfig.pairedCanSync ||
        document.hidden || this.updatingPlugin || this.updater?.blocked()) return;
    const path = this.sharedNotePath();
    if (!path && !this.sharedPresencePath) return;
    if (this.sharedPresenceBusy) return;
    this.sharedPresenceBusy = true;
    this.sharedPresencePath = path;
    try {
      const result = await this.siteRequest({
        url: SITE + "/m/obsidian-sync?scope=staff&sync=presence-v1",
        method: "POST",
        headers: { ...this.authHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: this.sharedPresenceId, sequence: ++this.sharedPresenceSequence, path, source: this.sourceKind,
          editing: !!path && this.noteView(this.activeNote())?.getMode?.() === "source" }),
        throw: false,
      });
      if (!this.alive || token !== this.vaultConfig.deviceToken || path !== this.sharedNotePath()) return;
      const fileId = result.status === 200 ? result.json?.fileId : null;
      this.sharedWebNote = path && UUID.test(fileId || "") ? { path, fileId, token } : null;
      const peers = result.status === 200 && Array.isArray(result.json?.peers) ? result.json.peers : [];
      const changed = JSON.stringify(this.sharedPeers || []) !== JSON.stringify(peers);
      if (changed) {
        this.sharedPeers = peers;
        this.renderLiveBanner();
        this.updateStatusBar();
        this.refreshDockViews(true);
      }
    } catch {
      this.sharedWebNote = null;
    } finally {
      this.sharedPresenceBusy = false;
      if (this.alive && token === this.vaultConfig.deviceToken && path !== this.sharedNotePath()) void this.sharedVaultPulse();
    }
  }

  async fetchWorkspaceActivity(force = false) {
    const token = this.vaultConfig?.deviceToken;
    if (!this.alive || !token || !this.accountVerified || (!this.vaultConfig.pairedCanEdit && !this.vaultConfig.pairedCanSync) ||
        (typeof document !== "undefined" && document.hidden) || this.updatingPlugin || this.updater?.blocked()) return;
    if (!force && Date.now() - (this.lastActivityFetchAt || 0) < 6_000) return;
    if (this.activityBusy) return;
    this.activityBusy = true;
    this.lastActivityFetchAt = Date.now();
    try {
      const response = await this.siteRequest({
        url: SITE + "/m/obsidian-sync?obsidian=index-v1&activity=1",
        method: "GET",
        headers: this.authHeaders(token),
        throw: false,
      });
      if (!this.alive || token !== this.vaultConfig.deviceToken) return;
      if (response.status === 200 && response.json?.ok === true && Array.isArray(response.json.activity)) {
        const next = response.json.activity;
        if (JSON.stringify(this.workspaceActivity || []) !== JSON.stringify(next)) {
          this.workspaceActivity = next;
          this.refreshDockViews(true);
        }
      }
    } catch {
      /* Activity polling is best-effort metadata. */
    } finally {
      this.activityBusy = false;
    }
  }

  folderSyncPublishConfirmed() {
    const state = this.folderSyncScope() === "private" ? this.treeSyncState : this.staffTreeSyncState;
    return !!this.vaultConfig.pairedUserId && state?.publishUserId === this.vaultConfig.pairedUserId;
  }

  queueFolderSync(path, previousPath) {
    let root;
    try {root=this.treeSync.localRoot();} catch {return;}
    if (![path,previousPath].some(value => value === root || value?.startsWith(root + "/"))) return;
    if (this.treeSyncBusy || this.driveDownloading) return;
    this.folderSyncDirty = true;
    clearTimeout(this.folderSyncTimer);
    this.folderSyncTimer = setTimeout(()=>void this.runAutomaticFolderSync(),1_200);
  }

  async runAutomaticFolderSync() {
    if (!this.alive || !this.accountVerified || !this.vaultConfig.pairedCanSync || !this.vaultConfig.folderAutoSync ||
        this.treeSyncBusy || this.driveDownloading || this.publishingDrive || this.previewingDrive ||
        this.savingNote || this.reviewSyncBusy || this.updatingPlugin || this.updater?.blocked()) return;
    const usingDrivePrimary = this.vaultConfig.pairedReadDrive !== false && this.vaultConfig.driveAutoSync !== false;
    if (this.folderSyncScope() === "staff" && usingDrivePrimary && !this.vaultConfig.explicitStaffFolderSync) return;
    this.treeSyncBusy = true;
    this.updateStatusBar();
    const token = this.vaultConfig.deviceToken;
    try {
      const status = await this.treeSync.status({withRevision:true});
      if (!this.alive || token !== this.vaultConfig.deviceToken || !this.vaultConfig.pairedCanSync) return;
      const scope = this.folderSyncScope();
      const revisionKey = revision => JSON.stringify([token, scope, revision]);
      if (!this.folderSyncDirty && this.folderSyncRevision === revisionKey(status.revision)) return;
      this.folderSyncDirty = false;
      const plan = await this.treeSync.inspect();
      const allowPush = this.folderSyncPublishConfirmed();
      const result = await this.treeSync.apply(plan, { automatic: true, allowPush });
      if (!this.alive || token !== this.vaultConfig.deviceToken || !this.vaultConfig.pairedCanSync) return;
      this.folderSyncRevision = revisionKey(result.revision);
      this.folderSyncOpenPending = result.waitingForEditor > 0;
      this.treeSyncMessage = result.pending
        ? "Отримано · " + result.pulled + ". Відправлено · " + result.pushed + ". Очікують звірки · " + result.pending + "."
        : "Папка актуальна.";
      if (!allowPush) this.treeSyncMessage += " Перегляньте зміни, щоб підтвердити публікацію з цієї папки.";
      this.refreshDockViews();
    } catch(error) {
      if (this.alive && token === this.vaultConfig.deviceToken) {
        this.folderSyncDirty = true;
        this.treeSyncMessage = error instanceof Error ? error.message : "Не вдалося звірити папку.";
        this.refreshDockViews();
      }
    } finally {
      this.treeSyncBusy = false;
      if(this.alive)this.updateStatusBar();
    }
  }

  async previewTreeSync(report = message => new Notice(message)) {
    if (this.treeSyncBusy || this.driveDownloading) {
      report("Спочатку дочекайтеся завершення поточної синхронізації.");
      return;
    }
    this.treeSyncBusy = true;
    report("Звіряємо зміни…");
    try {
      const plan = await this.treeSync.inspect();
      if (!this.alive) return;
      const lines = (label, operations) => label + " · " + operations.length + (operations.length ? "\n" + operations.slice(0, 10).map(op => op.action === "move" ? op.path + " → " + op.to : op.path).join("\n") : "");
      if (plan.conflicts.length) {
        report("Є конфлікти. Звірте зазначені файли й повторіть перевірку.");
        this.dialogForm({ title: "Конфлікти синхронізації", description: plan.conflicts.slice(0, 12).join("\n"), button: "Закрити", submit: async () => {} });
        return;
      }
      const userId = this.vaultConfig.pairedUserId;
      if (!plan.pull.length && !plan.push.length && this.folderSyncPublishConfirmed()) {
        await this.treeSync.apply(plan);
        if (this.alive) report("Папка актуальна.");
        return;
      }
      report("План готовий до перегляду.");
      const movesOrRemovals = [...plan.pull, ...plan.push].filter(op => op.action === "remove" || op.action === "move").length;
      this.dialogForm({ title: "Синхронізація FlightClub Sync", description: [
        lines("До Obsidian", plan.pull), lines("На сервер FlightClub", plan.push),
        !this.folderSyncPublishConfirmed() ? "Після підтвердження плагін зможе відправляти з цієї папки нові та змінені файли згідно з налаштуванням автосинхронізації." : "",
        movesOrRemovals ? "Переміщень або вилучень · " + movesOrRemovals + ". Заміни й вилучення на пристрої зберігають копію у FlightClub Sync Archive." : "",
      ].filter(Boolean).join("\n\n"), button: "Застосувати", submit: async () => {
        if (this.treeSyncBusy || this.driveDownloading) throw new Error("Синхронізація вже триває.");
        if (this.vaultConfig.pairedUserId !== userId) throw new Error("Акаунт змінився. Звірте папку ще раз.");
        this.treeSyncBusy = true;
        try {
          const result = await this.treeSync.apply(plan, { confirmedBy: userId });
          this.folderSyncRevision = undefined;
          const message = "Синхронізовано. До Obsidian · " + result.pulled + ". На сервер · " + result.pushed + ".";
          report(message);
        } finally { this.treeSyncBusy = false; }
      } });
    } catch (error) { if (this.alive) report(error instanceof Error ? error.message : "Не вдалося звірити папку FlightClub Sync."); }
    finally { this.treeSyncBusy = false; }
  }

  async verifyDriveBinding(expected) {
    const token = this.vaultConfig.deviceToken;
    if (!token) throw new Error("Підключіть акаунт FlightClub у вкладці акаунта.");
    const response = await this.siteRequest({
      url: SITE + "/m/obsidian-sync?obsidian=drive-binding-v1",
      headers: this.authHeaders(token),
      throw: false,
    });
    if (!this.alive || this.vaultConfig.deviceToken !== token) throw new Error("Сесію змінено. Повторіть перевірку.");
    let payload;
    try { payload = response.json; } catch { /* A proxy can return HTML on failure. */ }
    if (response.status !== 200 || payload?.ok !== true) {
      throw new Error(payload?.error || (response.status === 403
        ? "Акаунт FlightClub має отримати доступ до цієї папки Drive."
        : "Не вдалося перевірити папку на сайті. Спробуйте ще раз."));
    }
    const binding = payload.binding;
    if ((binding !== null && (!DRIVE_ID.test(binding?.rootId || "") || !UUID.test(binding?.revision || "")))
      || (expected && (binding?.rootId !== expected.rootId || binding?.revision !== expected.revision))) {
      throw new Error("Прив’язка на сайті вже змінилася. Звірте поточну папку.");
    }
    this.vaultConfig.vaultRootId = binding?.rootId ?? null;
    this.vaultConfig.vaultRootName = typeof binding?.rootName === "string" ? binding.rootName.slice(0, 120) : null;
    this.vaultConfig.revision = binding?.revision ?? null;
    if (this.drivePreview?.source?.bindingRevision !== this.vaultConfig.revision) this.drivePreview = null;
    await this.persist();
    return binding;
  }

  vaultFolders() {
    const folders = new Set(["", this.vaultConfig.localVaultRoot]);
    for (const file of this.app.vault.getAllLoadedFiles()) {
      if (file instanceof TFolder && file.path && file.path !== "/" && !file.path.split("/").some(part => part.startsWith("."))) {
        folders.add(file.path);
      }
    }
    return [...folders].sort((a, b) => a.localeCompare(b, "uk"));
  }

  async startPairingFlow() {
    if (!this.alive || this.pairStarting || this.pairSaving) return;
    if (this.pendingPair && Date.now() < this.pendingPair.expires) {
      this.openSite(this.pendingPair.url);
      void this.checkPairing(this.pendingPair);
      return;
    }
    if (this.pairTimer) clearTimeout(this.pairTimer);
    this.pairStarting = true;
    this.pairMessage = null;
    try {
      const bytes = crypto.getRandomValues(new Uint8Array(24));
      const token = "fco_" + Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
      const id = crypto.randomUUID();
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
      const challenge = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
      if (!this.alive) return;
      const target = new URL(SITE + "/m/obsidian-sync");
      target.searchParams.set("obsidian", id);
      target.searchParams.set("intent", "pair");
      target.searchParams.set("challenge", challenge);
      const pending = { id, token, url: target.href, expires: Date.now() + 5 * 60_000, state: "waiting", checking: false };
      this.pendingPair = pending;
      this.openSite(pending.url);
      this.refreshDockViews();
      this.pairTimer = setTimeout(() => void this.checkPairing(pending), 800);
    } catch {
      this.pairMessage = "Не вдалося відкрити підключення. Спробуйте ще раз або вставте код із сайту.";
      this.refreshDockViews();
      new Notice(this.pairMessage);
    } finally { this.pairStarting = false; }
  }

  cancelPairing() {
    if (this.pairSaving) return;
    if (this.pairTimer) clearTimeout(this.pairTimer);
    this.pairTimer = null;
    this.pendingPair = null;
    this.pairMessage = null;
    this.refreshDockViews();
  }

  async checkPairing(pending) {
    if (!this.alive || this.pendingPair !== pending || pending.checking) return;
    if (this.pairTimer) clearTimeout(this.pairTimer);
    this.pairTimer = null;
    if (Date.now() >= pending.expires) {
      this.pendingPair = null;
      this.pairMessage = "Запит діяв 5 хвилин і вже завершився. Почніть підключення знову.";
      this.refreshDockViews();
      new Notice(this.pairMessage);
      return;
    }
    pending.checking = true;
    const verified = await this.verifyDeviceTokenOnServer(pending.token);
    pending.checking = false;
    if (!this.alive || this.pendingPair !== pending) return;
    if (Date.now() >= pending.expires) {
      void this.checkPairing(pending);
      return;
    }
    if (verified.ok) {
      // Clear only this request after storage succeeds. A cancelled or newer request
      // must never be replaced by the completion of an earlier server probe.
      pending.checking = true;
      pending.state = "saving";
      this.refreshDockViews();
      try {
        await this.acceptDevice(pending.token, verified.viewer);
        if (this.pendingPair === pending) {
          this.pendingPair = null;
          this.pairMessage = null;
          this.refreshDockViews();
        }
        return;
      } catch {
        pending.state = "storage";
        this.refreshDockViews();
        new Notice("Сайт підтвердив доступ. Не вдалося зберегти його в Obsidian. Натисніть «Перевірити зараз».");
        return;
      } finally { pending.checking = false; }
    } else if (verified.reason === "restricted") {
      this.pendingPair = null;
      this.accountRestricted = true;
      this.pairMessage = verified.error || "Обліковий запис у карантині або ще не підтверджений.";
      this.refreshDockViews();
      new Notice(this.pairMessage);
      return;
    } else {
      const nextState = verified.reason || "waiting";
      if (pending.state !== nextState) {
        pending.state = nextState;
        this.refreshDockViews();
      }
    }
    if (!this.alive || this.pendingPair !== pending) return;
    this.pairTimer = setTimeout(() => void this.checkPairing(pending), document.hidden ? 4_000 : 1_750);
  }

  async verifyDeviceTokenOnServer(token) {
    if (!TOKEN_RE.test(token || "")) return { ok: false };
    try {
      const response = await this.siteRequest({ url: SITE + "/m/obsidian-sync?obsidian=device-v1",
        method: "GET", headers: this.authHeaders(token), throw: false });
      const viewer = response.status === 200 ? response.json?.viewer : null;
      if (response.status === 200 && response.json?.ok === true && UUID.test(viewer?.userId || "")) {
        return { ok: true, viewer };
      }
      const isRestricted = response.status === 403 && response.json?.code === "ACCOUNT_RESTRICTED";
      return {
        ok: false,
        reason: isRestricted
          ? "restricted"
          : response.status === 401
            ? "waiting"
            : response.status === 426
              ? "update"
              : response.status === 403
                ? "denied"
                : "offline",
        code: response.json?.code || null,
        error: response.json?.error || null,
      };
    } catch { return { ok: false, reason: "offline" }; }
  }

  async acceptDevice(token, viewer) {
    if (!this.alive || !UUID.test(viewer?.userId || "")) throw new Error("Не вдалося підтвердити акаунт FlightClub.");
    if (this.pairSaving) throw new Error("Зачекайте завершення збереження підключення.");
    this.pairSaving = true;
    const keys = ["deviceToken", "pairedUserId", "pairedUser", "pairedRole", "pairedHub", "pairedCanEdit", "pairedCanSync", "liveEnabled"];
    const previous = Object.fromEntries(keys.map(key => [key, this.vaultConfig[key]]));
    const previousState = { accountVerified: this.accountVerified, accountIsAdmax: this.accountIsAdmax,
      accountCanSyncPrivate: this.accountCanSyncPrivate,
      accountAvatarUrl: this.accountAvatarUrl, drivePreview: this.drivePreview };
    try {
      if (this.vaultConfig.deviceToken !== token) {
        this.stopLiveSession();
        this.syncActivity = [];
        this.syncTotals = {};
        this.driveClient?.clearReviews?.();
      }
      if (this.useSecretStorage) this.app.secretStorage.setSecret(SECRET_ID, token);
      this.vaultConfig.deviceToken = token;
      this.vaultConfig.pairedUserId = viewer.userId;
      this.vaultConfig.pairedUser = viewer.displayName || "Учасник";
      this.vaultConfig.pairedRole = viewer.roleLabel || "Учасник";
      this.vaultConfig.pairedHub = viewer.hubCity || null;
      if ("accessTier" in viewer) this.vaultConfig.pairedAccessTier = viewer.accessTier || null;
      else delete this.vaultConfig.pairedAccessTier;
      this.vaultConfig.pairedCanEdit = viewer.canEdit === true;
      this.vaultConfig.pairedCanSync = viewer.canSync ?? (viewer.canEdit === true || viewer.isAdmax === true);
      if ("canSyncWrite" in viewer) this.vaultConfig.pairedCanSyncWrite = viewer.canSyncWrite === true;
      else delete this.vaultConfig.pairedCanSyncWrite;
      if ("canReadDrive" in viewer) this.vaultConfig.pairedReadDrive = viewer.canReadDrive === true;
      else delete this.vaultConfig.pairedReadDrive;
      if ("canReadPlatform" in viewer) this.vaultConfig.pairedReadPlatform = viewer.canReadPlatform === true;
      else delete this.vaultConfig.pairedReadPlatform;
      this.accountVerified = true;
      this.accountRestricted = false;
      this.accountIsAdmax = viewer.isAdmax === true;
      this.accountCanSyncPrivate = viewer.canSyncPrivate === true;
      this.drivePreview = null;
      if (!viewer.canEdit) this.vaultConfig.liveEnabled = false;
      this.accountAvatarUrl = secureImageUrl(viewer.avatarUrl);
      this.refreshDockViews();
      await this.persist();
    } catch (error) {
      Object.assign(this.vaultConfig, previous);
      Object.assign(this, previousState);
      if (this.useSecretStorage) {
        try { this.app.secretStorage.setSecret(SECRET_ID, previous.deviceToken || ""); } catch {}
      }
      throw error;
    } finally { this.pairSaving = false; }
    if (!this.alive) return;
    this.updateStatusBar();
    this.attachLiveSessionToActiveNote(this.activeNote());
    this.refreshDockViews();
    void this.syncIndexFromSite(false);
    new Notice("Підключено як " + this.vaultConfig.pairedUser + ".");
    const slug = this.pendingImport;
    this.pendingImport = null;
    if (slug) void this.openSitePageInObsidian(slug);
    void this.prepareVaultImport();
    this.folderSyncDirty=true;
    void this.runAutomaticFolderSync();
  }

  async prepareVaultImport({allowAutomatic=true}={}) {
    const token = this.vaultConfig.deviceToken;
    if (!token || this.driveDownloading || this.previewingDrive) return;
    this.previewingDrive = true;
    this.driveDownloadStatus = "Перевіряємо доступні файли…";
    this.refreshDockViews();
    let refresh = false;
    try {
      const account = await this.verifyDeviceTokenOnServer(token);
      if (!this.alive || token !== this.vaultConfig.deviceToken) return;
      this.accountVerified = account.ok === true;
      this.accountRestricted = account.reason === "restricted";
      this.accountIsAdmax = account.ok === true && account.viewer.isAdmax === true;
      this.accountCanSyncPrivate = account.ok === true && account.viewer.canSyncPrivate === true;
      if (!account.ok) {
        this.vaultConfig.pairedCanEdit = false;
        this.stopLiveSession();
        this.drivePreview = null;
        if (account.reason === "restricted") {
          this.remoteCatalog = [];
          this.vaultConfig.pairedCanSync = false;
          this.vaultConfig.pairedReadDrive = false;
          this.vaultConfig.pairedReadPlatform = false;
          this.driveDownloadStatus = "Обмежений доступ (карантин або непідтверджений акаунт).";
          this.refreshDockViews();
          return;
        }
        throw new Error('Не вдалося підтвердити акаунт. Перевірте підключення або увійдіть повторно.');
      }
      this.vaultConfig.pairedRole = account.viewer.roleLabel;
      if ("accessTier" in account.viewer) this.vaultConfig.pairedAccessTier = account.viewer.accessTier || null;
      if (account.viewer.userId) this.vaultConfig.pairedUserId = account.viewer.userId;
      this.vaultConfig.pairedCanEdit = account.viewer.canEdit === true;
      this.vaultConfig.pairedCanSync = account.viewer.canSync ?? (account.viewer.canEdit === true || account.viewer.isAdmax === true);
      if ("canSyncWrite" in account.viewer) this.vaultConfig.pairedCanSyncWrite = account.viewer.canSyncWrite === true;
      else delete this.vaultConfig.pairedCanSyncWrite;
      if ("canReadDrive" in account.viewer) this.vaultConfig.pairedReadDrive = account.viewer.canReadDrive === true;
      else delete this.vaultConfig.pairedReadDrive;
      if ("canReadPlatform" in account.viewer) this.vaultConfig.pairedReadPlatform = account.viewer.canReadPlatform === true;
      else delete this.vaultConfig.pairedReadPlatform;
      if (this.vaultConfig.pairedCanEdit) this.attachLiveSessionToActiveNote(this.app?.workspace?.getActiveFile?.());
      else if (this.liveSession) this.stopLiveSession();
      void this.fetchWorkspaceActivity?.(true);
      void this.loadTeamPluginsCatalog?.({ silent: true });
      const preview = this.vaultConfig.pairedReadDrive === false
        ? {
            available: 0, matches: 0, partial: false, canEdit: false,
            desync: {
              hasDesync: false, totalIssues: 0,
              driveMissing: 0, driveOutdated: 0, driveRenamed: 0, driveUntracked: 0,
              platformLocalTotal: 0, platformLegacyNames: 0, platformLegacySchema: 0, platformUnboundOrOld: 0, platformMissing: 0,
              pagesOutdated: 0, pagesMissing: 0, legacyPlatformFolder: false,
            },
          }
        : typeof this.driveClient.previewDesync === "function"
          ? await this.driveClient.previewDesync({
              lookup: path => this.driveFiles?.get(path),
              entries: this.driveFiles || [],
              includePeople: this.accountIsAdmax,
              pages: this.remoteCatalog || [],
              links: this.links || [],
              importPages: this.vaultConfig.importPages !== false,
            })
          : await this.driveClient.preview();
      if (!this.alive || token !== this.vaultConfig.deviceToken) return;
      this.drivePreview = preview;
      const metaChanged = this.syncVaultSourceMeta(preview?.source, preview?.rootId, preview?.available);
      const d = preview.desync;
      const desyncCount = d?.totalIssues || 0;
      const platDesync = d ? (d.platformOutdatedFiles ?? Math.max(d.platformLegacyNames || 0, d.platformLegacySchema || 0, d.platformUnboundOrOld || 0)) + (d.platformMissing || 0) : 0;
      const upgradedPlugin = !this.vaultConfig.platformV3Migrated || Boolean(this.vaultConfig.lastPluginVersion && this.vaultConfig.lastPluginVersion !== PLUGIN_VERSION);
      this.driveDownloadStatus = preview.available || desyncCount
        ? desyncCount > 0
          ? `Виявлено ${desyncCount} змін/оновлень (Drive: ${d.driveMissing + d.driveOutdated + d.driveRenamed + d.driveUntracked}, платформа: ${platDesync}, сторінки: ${d.pagesOutdated + d.pagesMissing}).`
          : `${preview.partial ? "Щонайменше " : ""}${preview.available} файлів доступно · ${preview.matches} збігів, розсинхрону немає.`
        : "Поточні правила Drive не дають завантажити файли з цієї папки.";
      const hasExistingVault = preview.matches > 0 || this.driveFilesCount() > 0;
      const autoInitialForStaff = Boolean((this.vaultConfig.pairedCanEdit || this.accountIsAdmax) && preview.available > 0);
      refresh = allowAutomatic && (hasExistingVault || autoInitialForStaff) && (this.vaultConfig.refreshOnStartup !== false || this.vaultConfig.driveAutoSync !== false) && (desyncCount > 0 || upgradedPlugin || preview.matches > 0 || (this.driveFiles?.size || 0) > 0 || autoInitialForStaff);
      if (this.vaultConfig.lastPluginVersion !== PLUGIN_VERSION || metaChanged) {
        this.vaultConfig.lastPluginVersion = PLUGIN_VERSION;
        if (this.writes && typeof this.persist === "function") void this.persist().catch(() => {});
      }
      if (!preview.matches && !hasExistingVault && preview.available > 0 && !this.offeredVaultImport) {
        this.offeredVaultImport = true;
        new Notice("FlightClub Vault доступний. Відкрийте панель FlightClub та натисніть «Імпортувати з Drive».");
      }
    } catch (error) {
      if (token === this.vaultConfig.deviceToken) {
        this.drivePreview = null;
        this.driveDownloadStatus = error.message;
      }
    } finally {
      this.previewingDrive = false;
      if (this.alive) this.refreshDockViews();
    }
    if (refresh) void this.startVaultDownload(undefined, {
      automatic: true, includePlatform: true,
      pushLocal: Boolean(this.drivePreview?.matches || this.driveFilesCount()),
    });
  }

  syncVaultSourceMeta(source, rootId = null, filesCount = null) {
    if (!this.vaultConfig) return false;
    let changed = false;
    const rev = typeof source?.bindingRevision === "string" && UUID.test(source.bindingRevision) ? source.bindingRevision : null;
    const name = typeof source?.name === "string" && source.name.trim() ? source.name.trim().slice(0, 120) : null;
    const id = typeof rootId === "string" && DRIVE_ID.test(rootId) ? rootId : null;
    if (rev && this.vaultConfig.revision !== rev) {
      this.vaultConfig.revision = rev;
      changed = true;
    }
    if (name && this.vaultConfig.vaultRootName !== name) {
      this.vaultConfig.vaultRootName = name;
      changed = true;
    }
    if (id && this.vaultConfig.vaultRootId !== id) {
      this.vaultConfig.vaultRootId = id;
      changed = true;
    }
    if (name) {
      const list = Array.isArray(this.vaultConfig.syncCheckpoints) ? [...this.vaultConfig.syncCheckpoints] : [];
      const idx = list.findIndex(c => (rev && c.revision === rev) || c.name === name);
      const existing = idx >= 0 ? list[idx] : null;
      const nextEntry = {
        name,
        rootId: id || this.vaultConfig.vaultRootId || existing?.rootId || null,
        revision: rev || this.vaultConfig.revision || existing?.revision || null,
        at: (existing && existing.name === name && existing.revision === (rev || this.vaultConfig.revision || existing.revision) && existing.at)
          ? existing.at
          : new Date().toISOString(),
        filesCount: Number.isFinite(Number(filesCount)) && Number(filesCount) > 0
          ? Number(filesCount)
          : (existing?.filesCount ?? null),
      };
      const isNewOrUpdated = !existing || idx !== 0 ||
        existing.name !== nextEntry.name ||
        existing.revision !== nextEntry.revision ||
        existing.rootId !== nextEntry.rootId ||
        existing.filesCount !== nextEntry.filesCount;
      if (isNewOrUpdated) {
        const filtered = list.filter((c, i) => i !== idx);
        this.vaultConfig.syncCheckpoints = [nextEntry, ...filtered].slice(0, 6);
        changed = true;
      }
    }
    return changed;
  }

  getSyncCheckpoints() {
    const activeName = this.drivePreview?.source?.name || this.vaultConfig?.vaultRootName || null;
    const activeRev = this.drivePreview?.source?.bindingRevision || this.vaultConfig?.revision || null;
    const activeFiles = this.drivePreview?.available || this.syncTotals?.drive?.available || null;
    const merged = [];
    const seen = new Set();
    const pushItem = (item, isActive) => {
      if (!item || typeof item.name !== "string" || !item.name.trim()) return;
      const name = item.name.trim();
      const key = `${name}|${item.revision || ""}`;
      const nameOnlyKey = `${name}|`;
      if (seen.has(key) || (item.revision && seen.has(nameOnlyKey)) || (!item.revision && [...seen].some(k => k.startsWith(name + "|")))) {
        return;
      }
      seen.add(key);
      merged.push({
        name,
        rootId: item.rootId || null,
        revision: item.revision || null,
        at: item.at || null,
        filesCount: Number.isFinite(Number(item.filesCount)) ? Number(item.filesCount) : null,
        active: Boolean(isActive),
      });
    };
    if (activeName) {
      const localMatch = (this.vaultConfig?.syncCheckpoints || []).find(c => c.name === activeName || (activeRev && c.revision === activeRev));
      pushItem({
        name: activeName,
        rootId: this.drivePreview?.rootId || this.vaultConfig?.vaultRootId || null,
        revision: activeRev,
        at: localMatch?.at || null,
        filesCount: activeFiles || localMatch?.filesCount || null,
      }, true);
    }
    for (const sc of this.serverVaultCheckpoints || []) {
      const isAct = Boolean(activeName && sc?.name === activeName);
      pushItem(sc, isAct);
    }
    for (const lc of this.vaultConfig?.syncCheckpoints || []) {
      const isAct = Boolean(activeName && lc?.name === activeName);
      pushItem(lc, isAct);
    }
    return merged.slice(0, 5);
  }

  isPathInDriveRoot(filePath) {
    if (!filePath || typeof filePath !== "string") return false;
    const cfgDir = String(this.app?.vault?.configDir || ".obsidian").replace(/\/+$/, "");
    if (filePath.startsWith("FlightClub Sync Archive/") || filePath === "FlightClub Sync Archive" ||
        filePath.startsWith("FlightClub Platform/") || filePath === "FlightClub Platform" ||
        filePath.startsWith("FlightClub Shared/") || filePath === "FlightClub Shared" ||
        (cfgDir && (filePath.startsWith(cfgDir + "/") || filePath === cfgDir)) ||
        filePath.startsWith(".obsidian/") || filePath === ".obsidian" ||
        filePath.startsWith(".trash/") || filePath === ".trash" ||
        filePath.startsWith(".git/") || filePath === ".git" ||
        filePath.startsWith(".makemd/") || filePath === ".makemd" ||
        filePath.startsWith(".space/") || filePath === ".space") {
      return false;
    }
    const localRoot = String(this.vaultConfig?.localVaultRoot || "").trim();
    if (!localRoot) return true;
    return filePath === localRoot || filePath.startsWith(localRoot + "/");
  }

  markInternalSyncWrite(filePath) {
    if (!filePath || !this.recentSyncWrites) return;
    const now = Date.now();
    const ttl = now + 15_000;
    this.recentSyncWrites.set(filePath, ttl);
    const localRoot = String(this.vaultConfig?.localVaultRoot || "").trim();
    const parts = String(filePath).split("/").filter(Boolean);
    for (let i = 1; i < parts.length; i++) {
      const folderPath = parts.slice(0, i).join("/");
      if (!localRoot || folderPath === localRoot || folderPath.startsWith(localRoot + "/")) {
        this.recentSyncWrites.set(folderPath, ttl);
      }
    }
    if (this.recentSyncWrites.size > 1500) {
      for (const [k, exp] of this.recentSyncWrites) if (exp < now) this.recentSyncWrites.delete(k);
    }
  }

  isSuppressedDriveEvent(filePath) {
    if (this.publishingDrive) return true;
    const exp = this.recentSyncWrites?.get(filePath);
    return typeof exp === "number" && exp > Date.now();
  }

  isActivelyTyping(file) {
    if (!file) return false;
    const typedAt = this.lastEditorInputAt?.get(file.path);
    if (typeof typedAt === "number" && Date.now() - typedAt < 2_500) return true;
    return false;
  }

  isEditorDirty(file) {
    if (!file) return false;
    const typedAt = this.lastEditorInputAt?.get(file.path);
    if (typeof typedAt === "number" && Date.now() - typedAt < 20_000) return true;
    const modAt = this.lastLocalModifyAt?.get(file.path);
    if (typeof modAt === "number" && Date.now() - modAt < 15_000) return true;
    if (this.liveSession?.file === file && this.liveSessionAuthorized(this.liveSession)) {
      if (this.liveSession.batch || this.liveSession.busy || (this.liveSession.lastTypedAt && Date.now() - this.liveSession.lastTypedAt < 20_000)) {
        return true;
      }
    }
    for (const mode of ["markdown", "canvas", "bases"]) {
      for (const leaf of this.app?.workspace?.getLeavesOfType?.(mode) || []) {
        if (leaf.view?.file === file && (leaf.view?.dirty || (mode === "bases" && Number.isFinite(file.stat?.mtime) && Date.now() - file.stat.mtime < 20_000))) return true;
      }
    }
    return false;
  }

  onVaultFileChanged(kind, file, oldPath) {
    if (!file || typeof file.path !== "string") return;
    if (this.isSuppressedDriveEvent(file.path) || (oldPath && this.isSuppressedDriveEvent(oldPath))) return;
    const isFolder = (typeof TFolder === "function" && file instanceof TFolder) || Array.isArray(file.children);
    const isFile = !isFolder && ((typeof TFile === "function" && file instanceof TFile) || !file.children);
    const localRoot = String(this.vaultConfig?.localVaultRoot || "").trim();

    if (isFolder) {
      if (this.driveDownloading && (kind === "create" || kind === "delete")) return;
      // Never treat the Drive root folder itself as a child folder op.
      if (localRoot && file.path === localRoot && (!oldPath || oldPath === localRoot)) return;
      this.pendingFolderOps ??= [];
      if (kind === "rename" && oldPath) {
        if (!this.isPathInDriveRoot(oldPath) && !this.isPathInDriveRoot(file.path)) return;
        const knownFolder = this.driveFolders?.get(oldPath) || this.driveFolders?.get(file.path);
        // Coalesce chained folder renames (A -> B -> C becomes A -> C) and update nested folder ops
        let matchedChain = false;
        for (const op of this.pendingFolderOps) {
          if (op.kind === "rename_folder" && op.newPath === oldPath) {
            op.newPath = file.path;
            op.at = Date.now();
            if (!op.folderId && knownFolder?.folderId) op.folderId = knownFolder.folderId;
            matchedChain = true;
          } else if (op.kind === "rename_folder" && op.newPath?.startsWith(oldPath + "/")) {
            op.newPath = file.path + op.newPath.slice(oldPath.length);
            op.at = Date.now();
          } else if (op.kind === "create_folder" && (op.path === oldPath || op.path?.startsWith(oldPath + "/"))) {
            op.path = file.path + op.path.slice(oldPath.length);
            op.at = Date.now();
            if (op.path === file.path) matchedChain = true;
          }
        }
        // Remove no-op renames where oldPath === newPath
        this.pendingFolderOps = this.pendingFolderOps.filter(op => !(op.kind === "rename_folder" && op.oldPath === op.newPath));
        if (!matchedChain) {
          this.pendingFolderOps.push({
            kind: "rename_folder",
            oldPath,
            newPath: file.path,
            folderId: knownFolder?.folderId || null,
            sourcePath: knownFolder?.sourcePath || null,
            at: Date.now(),
          });
        }
        // Also update any pendingDriveMoves whose newPath was inside oldPath
        for (const m of this.pendingDriveMoves || []) {
          if (m.newPath === oldPath || m.newPath?.startsWith(oldPath + "/")) {
            m.newPath = file.path + m.newPath.slice(oldPath.length);
            m.movedAt = Date.now();
          }
        }
        // Immediately migrate tracked driveFiles & driveFolders keys (preserving sourcePath!) so restarts or direct calls never lose bindings!
        if (this.driveFolders instanceof Map) {
          for (const [k, meta] of [...this.driveFolders.entries()]) {
            if (k === oldPath || k.startsWith(oldPath + "/")) {
              const nextK = file.path + k.slice(oldPath.length);
              if (!this.driveFolders.has(nextK)) {
                this.driveFolders.delete(k);
                this.driveFolders.set(nextK, meta);
              }
            }
          }
        }
        if (this.driveFiles instanceof Map) {
          for (const [k, row] of [...this.driveFiles.entries()]) {
            if (k.startsWith(oldPath + "/")) {
              const nextK = file.path + k.slice(oldPath.length);
              if (!this.driveFiles.has(nextK)) {
                this.driveFiles.delete(k);
                this.driveFiles.set(nextK, row);
              }
            }
          }
        }
        void this.persist?.().catch(() => {});
        this.scheduleStructurePrompt();
        return;
      }
      if (kind === "create" && this.isPathInDriveRoot(file.path)) {
        // Cancel any pending delete for the same folder path
        this.pendingFolderOps = this.pendingFolderOps.filter(op => !(op.kind === "delete_folder" && op.path === file.path));
        const alreadyKnown = this.driveFolders?.has(file.path) ||
          this.pendingFolderOps.some(op => (op.kind === "create_folder" && op.path === file.path) || (op.kind === "rename_folder" && op.newPath === file.path));
        if (!alreadyKnown) {
          this.pendingFolderOps.push({ kind: "create_folder", path: file.path, at: Date.now() });
          this.scheduleStructurePrompt();
        }
        return;
      }
      if (kind === "delete" && this.isPathInDriveRoot(file.path)) {
        const wasJustCreated = this.pendingFolderOps.some(op => op.kind === "create_folder" && op.path === file.path);
        this.pendingFolderOps = this.pendingFolderOps.filter(op =>
          !((op.kind === "create_folder" && (op.path === file.path || op.path?.startsWith(file.path + "/"))) ||
            (op.kind === "rename_folder" && op.newPath === file.path)),
        );
        const knownFolder = this.driveFolders?.get(file.path);
        if (!wasJustCreated && knownFolder?.folderId) {
          this.pendingFolderOps.push({
            kind: "delete_folder",
            path: file.path,
            folderId: knownFolder.folderId,
            sourcePath: knownFolder.sourcePath || null,
            onlyIfEmpty: true,
            at: Date.now(),
          });
          this.scheduleStructurePrompt();
        }
        return;
      }
      return;
    }

    if (!isFile) return;
    if (kind === "delete") {
      const base = this.driveFiles?.get(file.path);
      if (base && base.kind !== "platform" && base.fileId && base.userId === this.vaultConfig?.pairedUserId && this.isPathInDriveRoot(file.path)) {
        this.pendingDriveMoves = (this.pendingDriveMoves || []).filter(m => m.fileId !== base.fileId);
        this.pendingDriveDeletes = (this.pendingDriveDeletes || []).filter(d => d.fileId !== base.fileId);
        this.pendingDriveDeletes.push({
          fileId: base.fileId, path: file.path, sourcePath: base.sourcePath || file.path,
          version: base.version, sha256: base.sha256, deletedAt: Date.now(),
        });
        this.scheduleDriveSync(file.path);
      }
      return;
    }
    if (kind === "rename" && oldPath) {
      const base = this.driveFiles?.get(oldPath) || this.driveFiles?.get(file.path);
      if (base && base.kind !== "platform" && base.fileId && base.userId === this.vaultConfig?.pairedUserId &&
          (this.isPathInDriveRoot(oldPath) || this.isPathInDriveRoot(file.path))) {
        if (oldPath !== file.path && this.driveFiles instanceof Map && this.driveFiles.has(oldPath) && !this.driveFiles.has(file.path)) {
          this.driveFiles.delete(oldPath);
          this.driveFiles.set(file.path, base);
        }
        const existingMove = (this.pendingDriveMoves || []).find(m => m.fileId === base.fileId);
        const originalOldPath = existingMove?.oldPath || oldPath;
        this.pendingDriveMoves = (this.pendingDriveMoves || []).filter(m => m.fileId !== base.fileId);
        if (originalOldPath !== file.path) {
          const oldDir = originalOldPath.includes("/") ? originalOldPath.slice(0, originalOldPath.lastIndexOf("/")) : "";
          const newDir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
          const crossFolderMove = oldDir !== newDir;
          this.pendingDriveMoves.push({
            fileId: base.fileId,
            oldPath: originalOldPath,
            newPath: file.path,
            crossFolder: crossFolderMove,
            movedAt: Date.now(),
          });
          if (crossFolderMove || (this.pendingFolderOps?.length || 0) > 0) {
            this.scheduleStructurePrompt();
          } else {
            this.scheduleDriveSync(file.path);
          }
        }
      }
      return;
    }
    if ((kind === "create" || kind === "modify") && this.isPathInDriveRoot(file.path)) {
      if (this.queueOpenCanvasCreate(file)) return;
      if (this.pendingDriveDeletes?.length) {
        this.pendingDriveDeletes = this.pendingDriveDeletes.filter(d => d.path !== file.path);
      }
      if (kind === "modify") {
        this.lastLocalModifyAt ??= new Map();
        this.lastLocalModifyAt.set(file.path, Date.now());
      }
      const isActiveLiveDrive = Boolean(
        kind === "modify" &&
        this.vaultConfig?.liveEnabled &&
        this.liveSession?.file === file &&
        this.liveSession?.kind === "drive" &&
        this.liveSessionAuthorized(this.liveSession)
      );
      if (isActiveLiveDrive) {
        this.lastEditorInputAt?.set(file.path, Date.now());
        // Push BOTH .canvas edits AND .md Obsidian Properties UI changes immediately via Live Edit!
        this.scheduleLiveEditorPush(null, file, this.liveSession.key);
        return;
      }
      if (kind === "modify") {
        this.dirtyDriveFiles ??= new Set();
        this.dirtyDriveFiles.add(file.path);
      }
      this.scheduleDriveSync(file.path);
    }
  }

  pendingStructureSummary() {
    const folderRenames = [];
    const folderCreates = [];
    const folderDeletes = [];
    const fileMoves = [];
    const localRoot = String(this.vaultConfig?.localVaultRoot || "").trim();
    const joinPrefix = rel => localRoot ? `${localRoot}/${rel}` : rel;

    const getEntry = typeof this.app?.vault?.getAbstractFileByPath === "function"
      ? p => this.app.vault.getAbstractFileByPath(p)
      : null;
    const isReservedOpPath = p => typeof p === "string" && (
      isSyncArchivePath(p) ||
      /^(?:FlightClub Shared|FlightClub Platform|\.obsidian|\.trash|\.git|\.makemd|\.space)(?:\/|$)/i.test(p)
    );

    for (const op of this.pendingFolderOps || []) {
      if (!op || typeof op !== "object") continue;
      const opKind = op.kind === "rename_folder" || op.op === "move_folder"
        ? "rename_folder"
        : op.kind === "create_folder" || op.op === "create_folder"
          ? "create_folder"
          : op.kind === "delete_folder" || op.op === "trash_folder"
            ? "delete_folder"
            : op.kind;
      if (opKind === "rename_folder" && op.oldPath && op.newPath && op.oldPath !== op.newPath) {
        if (isReservedOpPath(op.oldPath) || isReservedOpPath(op.newPath)) continue;
        if (getEntry && !getEntry(op.newPath)) continue;
        folderRenames.push(op);
      } else if (opKind === "create_folder" && op.path) {
        if (isReservedOpPath(op.path)) continue;
        if (this.driveFolders?.has(op.path)) continue;
        if (getEntry && !getEntry(op.path)) continue;
        folderCreates.push(op);
      } else if (opKind === "delete_folder" && op.path) {
        if (isReservedOpPath(op.path)) continue;
        if (getEntry && getEntry(op.path)) continue;
        folderDeletes.push(op);
      }
    }

    const seenMoveIds = new Set();
    for (const m of this.pendingDriveMoves || []) {
      if (!m?.fileId || !m?.newPath || m.oldPath === m.newPath) continue;
      // Check if this file move is already part of a pending folder rename
      const coveredByFolder = folderRenames.some(op =>
        m.oldPath?.startsWith(op.oldPath + "/") &&
        m.newPath === op.newPath + m.oldPath.slice(op.oldPath.length),
      );
      seenMoveIds.add(m.fileId);
      if (!coveredByFolder) fileMoves.push(m);
    }

    // Also include any baseline path divergence where Drive path != current local path
    for (const [trackedPath, row] of this.driveFiles || []) {
      if (!row || row.kind === "platform" || !row.fileId || !row.sourcePath) continue;
      if (this.vaultConfig?.pairedUserId && row.userId && row.userId !== this.vaultConfig.pairedUserId) continue;
      if (seenMoveIds.has(row.fileId)) continue;
      const expectedLocal = joinPrefix(row.sourcePath);
      if (trackedPath !== expectedLocal && trackedPath !== row.sourcePath) {
        const coveredByFolder = folderRenames.some(op =>
          expectedLocal.startsWith(op.oldPath + "/") &&
          trackedPath === op.newPath + expectedLocal.slice(op.oldPath.length),
        );
        if (!coveredByFolder) {
          fileMoves.push({ fileId: row.fileId, oldPath: expectedLocal, newPath: trackedPath, crossFolder: true });
        }
      }
    }

    const total = folderRenames.length + folderCreates.length + folderDeletes.length + fileMoves.length;
    const lines = [
      ...folderRenames.map(op => ({ kind: "rename_folder", badge: "📁 Папка", text: `${op.oldPath} → ${op.newPath}` })),
      ...folderCreates.map(op => ({ kind: "create_folder", badge: "➕ Нова папка", text: op.path })),
      ...fileMoves.map(m => ({ kind: "move_file", badge: "📄 Переміщено", text: `${m.oldPath} → ${m.newPath}` })),
      ...folderDeletes.map(op => ({ kind: "delete_folder", badge: "🗑️ Видалено папку", text: op.path })),
    ];
    const items = lines.map(l => `${l.badge}: ${l.text}`);
    const signature = items.join("\n");
    return {
      hasChanges: total > 0,
      total,
      folderRenames,
      folderCreates,
      folderDeletes,
      fileMoves,
      lines,
      items,
      signature,
    };
  }

  scheduleStructurePrompt() {
    if (!this.alive) return;
    this.updateStatusBar();
    this.refreshDockViews();
    void this.persist().catch(() => {});
    if (!this.vaultConfig?.deviceToken || (!this.vaultConfig?.pairedCanEdit && !this.accountIsAdmax)) return;
    clearTimeout(this.structurePromptTimer);
    this.structurePromptTimer = setTimeout(() => {
      this.structurePromptTimer = null;
      if (!this.alive) return;
      const summary = this.pendingStructureSummary();
      if (!summary.hasChanges) return;
      this.updateStatusBar();
      this.refreshDockViews();
      const snoozed = this.structureSnoozedAt && Date.now() - this.structureSnoozedAt < 10 * 60_000;
      if (!snoozed && summary.signature !== this.lastPromptedStructureSig && !this.dialog) {
        this.lastPromptedStructureSig = summary.signature;
        this.openStructureSyncModal({ force: false });
      }
    }, 1_800);
  }

  async pushStructureChangesToDrive(report = msg => new Notice(msg)) {
    if (!this.alive || !this.vaultConfig?.deviceToken) return;
    this.structureSnoozedAt = 0;
    this.lastPromptedStructureSig = "";
    report("⬆️ Відправляємо нову структуру папок на головний Google Drive…");
    await this.startVaultDownload(report, { automatic: false, includePlatform: false, structureMode: "push" });
  }

  async revertStructureChangesToDrive(report = msg => new Notice(msg)) {
    if (!this.alive || !this.vaultConfig?.deviceToken) return;
    this.structureSnoozedAt = 0;
    this.lastPromptedStructureSig = "";
    this.pendingFolderOps = [];
    this.pendingDriveMoves = [];
    await this.persist().catch(() => {});
    report("↩️ Повертаємо структуру папок із Google Drive…");
    await this.startVaultDownload(report, { automatic: false, includePlatform: false, structureMode: "revert" });
  }

  openStructureSyncModal({ force = true } = {}) {
    if (!this.alive) return;
    const summary = this.pendingStructureSummary();
    if (!summary.hasChanges) {
      if (force) new Notice("Змін структури папок немає — структура синхронна з Google Drive.");
      return;
    }
    this.dialog?.close();
    const modal = new Modal(this.app);
    this.dialog = modal;
    modal.onOpen = () => {
      modal.titleEl?.setText?.("📁 Змінено структуру папок у Obsidian");
      const root = modal.contentEl;
      root.addClass?.("fc-structure-modal");
      root.createEl("p", {
        cls: "fc-structure-lead",
        text: `Виявлено ${summary.total} змін структури папок/файлів. Залити нову структуру на основний Google Drive?`,
      });
      root.createEl("p", {
        cls: "fc-deck-sub",
        text: "🛡️ Захист від відкатів активний: фонова автосинхронізація НЕ повертатиме старі папки назад, поки ви не оберете дію.",
      });
      const list = root.createEl("ul", { cls: "fc-structure-list" });
      for (const line of summary.items.slice(0, 16)) {
        list.createEl("li", { text: line });
      }
      if (summary.items.length > 16) {
        list.createEl("li", { text: `…та ще ${summary.items.length - 16} змін` });
      }
      const actions = root.createDiv({ cls: "fc-structure-actions" });
      const pushBtn = actions.createEl("button", {
        text: "⬆️ Залити зміни на головний Google Drive",
        cls: "mod-cta fc-deck-btn",
        attr: { type: "button" },
      });
      pushBtn.addEventListener("click", () => {
        modal.close();
        void this.pushStructureChangesToDrive();
      });

      const snoozeBtn = actions.createEl("button", {
        text: "⏸ Відкласти (я ще впорядковую папки)",
        cls: "fc-deck-btn",
        attr: { type: "button" },
      });
      snoozeBtn.addEventListener("click", () => {
        this.structureSnoozedAt = Date.now();
        modal.close();
        new Notice("⏸ Відправку структури відкладено. Зміни не відкотяться — кнопка «Залити на Drive» доступна в бічній панелі FlightClub.");
        this.refreshDockViews();
      });

      const revertBtn = actions.createEl("button", {
        text: "↩️ Відкотити локально до версії Drive",
        cls: "fc-deck-btn fc-btn-revert-structure",
        attr: { type: "button" },
      });
      revertBtn.addEventListener("click", () => {
        modal.close();
        this.dialogForm({
          title: "Підтвердити відкат структури до Google Drive",
          description: "Локальні перейменування та переміщення папок будуть скасовані, а розташування файлів повернеться до поточної структури Google Drive (змінений текст файлів збережеться в архіві).",
          button: "Так, повернути структуру з Drive",
          submit: async () => {
            await this.revertStructureChangesToDrive();
          },
        });
      });
    };
    modal.onClose = () => {
      if (this.dialog === modal) this.dialog = null;
      modal.contentEl?.empty?.();
    };
    modal.open();
  }

  queueOpenCanvasCreate(file) {
    const path = file?.path;
    const revision = this.vaultConfig?.revision;
    const canWrite = this.vaultConfig?.pairedCanSyncWrite ?? this.vaultConfig?.pairedCanEdit ?? this.accountIsAdmax;
    if (!this.alive || !this.accountVerified || !this.vaultConfig?.deviceToken || !this.vaultConfig.liveEnabled ||
        this.vaultConfig.driveAutoSync === false || this.updatingPlugin || this.updater?.blocked() || !canWrite ||
        !UUID.test(revision || "") || !path || !/\.canvas$/i.test(path) || isSyncArchivePath(path) ||
        /(?:^|\/)FlightClub Canvas — /i.test(path) || !this.isPathInDriveRoot(path) ||
        this.app?.workspace?.getActiveFile?.() !== file || this.driveBaselineFor(file) || !this.driveClient?.pushSingleFile) return false;
    this.priorityCanvasJobs ??= new Map();
    if (this.priorityCanvasJobs.has(path)) return true;
    const timer = setTimeout(async () => {
      try {
        if (!this.alive || this.vaultConfig?.revision !== revision || this.vaultConfig.driveAutoSync === false ||
            this.app.vault.getAbstractFileByPath(path) !== file || this.driveBaselineFor(file)) return;
        await this.driveClient.pushSingleFile({ file, createBindingRevision: revision });
        if (!this.alive || this.vaultConfig?.revision !== revision) return;
        this.dirtyDriveFiles?.delete(path);
        await this.persist();
        if (this.app.workspace.getActiveFile?.() === file) this.attachLiveSessionToActiveNote(file);
      } catch (error) {
        if (this.alive) {
          this.driveDownloadStatus = error?.message || "Не вдалося додати Canvas у Drive.";
          this.dirtyDriveFiles?.add(path);
          this.scheduleDriveSync(path);
        }
      } finally { this.priorityCanvasJobs.delete(path); }
    }, 180);
    this.priorityCanvasJobs.set(path, timer);
    return true;
  }

  scheduleDriveSync(filePath) {
    if (!this.alive || !this.vaultConfig?.deviceToken || this.vaultConfig?.driveAutoSync === false) return;
    if (!this.isPathInDriveRoot(filePath) && !(this.pendingDriveMoves?.length || this.pendingDriveDeletes?.length || this.pendingFolderOps?.length)) return;
    if (this.driveDownloading) { this.driveResyncQueued = true; return; }
    clearTimeout(this.driveSyncTimer);
    this.driveSyncTimer = setTimeout(() => void this.runAutomaticDriveSync(), 2_500);
  }

  openAndRevealFile(path) {
    if (!path || !this.app?.vault) return;
    const target = this.app.vault.getAbstractFileByPath(path);
    if (!target) {
      new Notice(`Файл не знайдено локально: ${path}`);
      return;
    }
    if (target instanceof TFile) {
      const leaf = this.app.workspace?.getLeaf?.(false) || this.app.workspace?.getLeaf?.();
      if (leaf?.openFile) void leaf.openFile(target);
    }
    try {
      const explorer = (this.app.workspace?.getLeavesOfType?.("file-explorer") || [])[0]?.view;
      if (typeof explorer?.revealInFolder === "function") explorer.revealInFolder(target);
    } catch {}
  }

  async pushActiveFileToDrive(file = this.activeNote()) {
    if (!file || !(file instanceof TFile)) { new Notice("Відкрийте нотатку або Canvas."); return; }
    if (!this.accountVerified || !this.vaultConfig?.deviceToken) { new Notice("Спочатку підключіть акаунт FlightClub."); return; }
    if (this.driveDownloading || this.publishingDrive) { new Notice("Дочекайтеся завершення поточної синхронізації."); return; }
    if (typeof this.driveClient?.pushSingleFile !== "function") { await this.startVaultDownload(undefined, { pushLocal: true, structureMode: "push" }); return; }
    this.publishingDrive = true;
    this.activeSyncPath = file.path;
    this.renderFileExplorerBadges();
    this.updateStatusBar();
    this.refreshDockViews();
    try {
      const baseline = this.driveBaselineFor(file);
      let editorContent = null;
      const view = this.noteView(file);
      if (file.extension?.toLowerCase?.() === "canvas") {
        let raw = typeof view?.canvas?.getData === "function" ? JSON.stringify(view.canvas.getData(), null, 2) + "\n" : await this.app.vault.read(file);
        const imgRes = await this.uploadCanvasLocalImages(raw, file);
        if (imgRes.changed) {
          raw = imgRes.text;
          this.markInternalSyncWrite(file.path);
          if (typeof this.app.vault.process === "function") await this.app.vault.process(file, () => raw);
        }
        editorContent = raw;
      } else if (view?.editor && view.getMode?.() !== "preview") {
        editorContent = view.editor.getValue();
      }
      const res = await this.driveClient.pushSingleFile({
        file, baseline, editorContent,
        getShareMeta: (localPath, fileId) => this.shareMetaForSync(localPath, fileId),
        markInternalPath: p => this.markInternalSyncWrite(p),
      });
      this.dirtyDriveFiles?.delete(file.path);
      await this.persist();
      if (res.status === "unchanged") new Notice(`✓ «${file.basename}» вже актуальний на Google Drive.`);
      else if (res.status === "created") new Notice(`⬆️ «${file.basename}» створено на Google Drive (v${res.version}).`);
      else if (res.status === "merged") new Notice(`🔀 «${file.basename}» об’єднано і збережено в Drive (v${res.version}).`);
      else new Notice(`⬆️ Правки «${file.basename}» відправлено в Google Drive (v${res.version}).`);
      if (this.liveSession?.file === file && res.version) {
        this.liveSession.revision = res.version;
        if (res.sha256) this.liveSession.sha256 = res.sha256;
      }
    } catch (err) {
      if (err?.code === "REVISION_CONFLICT") {
        new Notice("⚠️ Файл на Google Drive новіший! Натисніть «⬇️ Підтягнути з Drive» або перевірте різницю.");
      } else {
        new Notice(`⚠️ ${err?.message || "Не вдалося відправити файл у Drive."}`);
      }
    } finally {
      this.publishingDrive = false;
      this.activeSyncPath = null;
      this.renderFileExplorerBadges();
      this.updateStatusBar();
      this.refreshDockViews();
    }
  }

  async pullActiveFileFromDrive(file = this.activeNote()) {
    if (!file || !(file instanceof TFile)) { new Notice("Відкрийте нотатку або Canvas."); return; }
    if (!this.accountVerified || !this.vaultConfig?.deviceToken) { new Notice("Спочатку підключіть акаунт FlightClub."); return; }
    if (this.driveDownloading || this.publishingDrive) { new Notice("Дочекайтеся завершення поточної синхронізації."); return; }
    const baseline = this.driveBaselineFor(file);
    if (!baseline || typeof this.driveClient?.pullSingleFile !== "function") {
      await this.startVaultDownload(undefined, { pushLocal: false });
      return;
    }
    this.driveDownloading = true;
    this.activeSyncPath = file.path;
    this.renderFileExplorerBadges();
    this.updateStatusBar();
    this.refreshDockViews();
    try {
      const res = await this.driveClient.pullSingleFile({
        file, baseline, archiveLocal: true,
        getShareMeta: (localPath, fileId) => this.shareMetaForSync(localPath, fileId),
        markInternalPath: p => this.markInternalSyncWrite(p),
      });
      this.dirtyDriveFiles?.delete(file.path);
      if (res.status === "downloaded" && typeof res.content === "string") {
        const view = this.noteView(file);
        if (file.extension?.toLowerCase?.() === "canvas") {
          await this.hydrateCanvasRemoteImages(res.content);
          try {
            const parsed = JSON.parse(res.content.replace(/^\uFEFF/, ""));
            if (typeof view?.canvas?.setData === "function") {
              this.liveApplyingRemote = true;
              try { view.canvas.setData(parsed); view.canvas.requestFrame?.(); } finally { this.liveApplyingRemote = false; }
            }
          } catch {}
        } else if (view?.editor && view.getMode?.() !== "preview" && view.editor.getValue() !== res.content) {
          this.liveApplyingRemote = true;
          try { view.editor.setValue(res.content); } finally { this.liveApplyingRemote = false; }
        }
        if (this.liveSession?.file === file) {
          this.liveSession.base = res.content.replace(/\r\n?/g, "\n");
          this.liveSession.revision = res.version;
          this.liveSession.conflict = null;
        }
      }
      await this.persist();
      if (res.status === "unchanged") new Notice(`✓ «${file.basename}» вже збігається з Google Drive (v${res.version}).`);
      else if (res.backupPath) new Notice(`⬇️ Оновлено «${file.basename}» з Drive (v${res.version}). Вашу чернетку збережено в архів.`);
      else new Notice(`⬇️ Оновлено «${file.basename}» з Google Drive (v${res.version}).`);
    } catch (err) {
      new Notice(`⚠️ ${err?.message || "Не вдалося підтягнути файл із Drive."}`);
    } finally {
      this.driveDownloading = false;
      this._quietSync = false;
      this.activeSyncPath = null;
      this.renderFileExplorerBadges();
      this.updateStatusBar();
      this.refreshDockViews();
    }
  }

  openFolderRenameModal() {
    if (!this.accountVerified || (!this.vaultConfig?.pairedCanEdit && !this.accountIsAdmax)) {
      new Notice("Перейменування папок на Google Drive доступне редакторам / ADMAX.");
      return;
    }
    const localRoot = String(this.vaultConfig?.localVaultRoot || "").trim();
    const folders = this.vaultFolders()
      .filter(p => p && p !== localRoot && this.isPathInDriveRoot(p))
      .sort((a, b) => a.localeCompare(b, "uk"));
    if (!folders.length) {
      new Notice("У папці Drive Vault поки немає підпапок.");
      return;
    }
    this.dialog?.close();
    const modal = new Modal(this.app);
    this.dialog = modal;
    modal.onOpen = () => {
      const root = modal.contentEl;
      modal.setTitle("📁 Перейменувати / замінити папку на Google Drive");
      root.createEl("p", {
        cls: "fc-deck-sub",
        text: "Оберіть папку зі старою назвою та вкажіть нову. Якщо папка з новою назвою вже існує і порожня — вона буде безпечно замінена, а всі файли перейменуються на головному Google Drive.",
      });
      const srcField = root.createEl("label", { cls: "fc-deck-field" });
      srcField.createSpan({ text: "Папка з файлами (стара назва)" });
      const srcSelect = srcField.createEl("select");
      for (const f of folders) {
        const tf = this.app.vault.getAbstractFileByPath(f);
        const childCount = Array.isArray(tf?.children) ? tf.children.length : 0;
        srcSelect.createEl("option", { text: `${f} (${childCount} об’єктів)`, attr: { value: f } });
      }
      const dstField = root.createEl("label", { cls: "fc-deck-field" });
      dstField.createSpan({ text: "Новий шлях папки" });
      const dstInput = dstField.createEl("input", { attr: { type: "text", value: folders[0] } });
      dstInput.value = folders[0];
      srcSelect.addEventListener("change", () => { dstInput.value = srcSelect.value; });
      const statusEl = root.createEl("p", { cls: "fc-deck-sub", attr: { role: "status" } });
      const actions = root.createDiv({ cls: "fc-deck-grid" });
      const submitBtn = actions.createEl("button", { text: "⬆️ Перейменувати і синхронізувати на Drive", cls: "mod-cta fc-deck-btn", attr: { type: "button" } });
      const cancelBtn = actions.createEl("button", { text: "Скасувати", cls: "fc-deck-btn", attr: { type: "button" } });
      cancelBtn.addEventListener("click", () => modal.close());
      submitBtn.addEventListener("click", async () => {
        const oldPath = srcSelect.value.trim();
        const newPath = dstInput.value.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
        if (!oldPath || !newPath || oldPath === newPath) { statusEl.setText("Вкажіть нову назву папки."); return; }
        if (!this.isPathInDriveRoot(newPath)) { statusEl.setText(`Новий шлях має бути всередині «${localRoot || "Vault"}».`); return; }
        const oldFolder = this.app.vault.getAbstractFileByPath(oldPath);
        if (!(oldFolder instanceof TFolder)) { statusEl.setText("Вихідну папку не знайдено."); return; }
        submitBtn.disabled = cancelBtn.disabled = true;
        statusEl.setText("Перевіряємо цільову папку…");
        try {
          const existingTarget = this.app.vault.getAbstractFileByPath(newPath);
          if (existingTarget) {
            if (!(existingTarget instanceof TFolder) || (Array.isArray(existingTarget.children) && existingTarget.children.length > 0)) {
              statusEl.setText("Цільова папка вже існує і не порожня. Перенесіть або видаліть файли в ній вручну.");
              submitBtn.disabled = cancelBtn.disabled = false;
              return;
            }
            this.markInternalSyncWrite(newPath);
            if (typeof this.app.vault.trash === "function") await this.app.vault.trash(existingTarget, false);
            else await this.app.vault.delete(existingTarget);
          }
          const knownFolder = this.driveFolders?.get(oldPath);
          const rename = this.app.fileManager?.renameFile?.bind(this.app.fileManager) ?? this.app.vault.rename.bind(this.app.vault);
          this.markInternalSyncWrite(oldPath);
          this.markInternalSyncWrite(newPath);
          await rename(oldFolder, newPath);
          this.rekey(oldPath, newPath);
          this.pendingFolderOps ??= [];
          this.pendingFolderOps = this.pendingFolderOps.filter(op => !(op.kind === "rename_folder" && (op.oldPath === oldPath || op.newPath === newPath)));
          this.pendingFolderOps.push({
            kind: "rename_folder",
            oldPath, newPath,
            folderId: knownFolder?.folderId || null,
            sourcePath: knownFolder?.sourcePath || null,
            at: Date.now(),
          });
          await this.persist();
          modal.close();
          await this.pushStructureChangesToDrive();
        } catch (err) {
          statusEl.setText(err?.message || "Не вдалося перейменувати папку.");
          submitBtn.disabled = cancelBtn.disabled = false;
        }
      });
    };
    modal.onClose = () => { if (this.dialog === modal) this.dialog = null; modal.contentEl?.empty?.(); };
    modal.open();
  }

  async runAutomaticDriveSync({ periodic = false } = {}) {
    if (!this.alive || !this.accountVerified || !this.vaultConfig?.deviceToken || !this.vaultConfig?.pairedCanSync ||
        this.vaultConfig.driveAutoSync === false || this.driveDownloading || this.publishingDrive ||
        this.reviewSyncBusy || this.savingNote || this.treeSyncBusy || this.updatingPlugin || this.updater?.blocked()) {
      return;
    }
    const duePlatform = periodic && (!this.vaultConfig.platformV3Migrated || !this.lastPlatformAutoSyncAt || Date.now() - this.lastPlatformAutoSyncAt >= 300_000);
    const hasStructureChanges = (this.pendingFolderOps?.length || 0) > 0 ||
      (this.pendingDriveMoves || []).some(m => m.crossFolder) ||
      this.pendingStructureSummary().hasChanges;

    // Ultra-fast single/few-file delta push without scanning 480+ files or hammering the server!
    const activeDrive = this.liveSession?.kind === "drive" && this.liveSessionAuthorized(this.liveSession)
      ? this.liveSession : null;
    const dirtyPaths = [...(this.dirtyDriveFiles || [])].filter(path =>
      path !== activeDrive?.file?.path && !this.priorityCanvasJobs?.has(path));
    if (activeDrive?.isCanvas && !activeDrive.retryDelay && Date.now() - activeDrive.lastTypedAt < 2_500 &&
        (activeDrive.batch || activeDrive.pendingCanvasPage || activeDrive.canvasPendingEdit)) {
      if (dirtyPaths.length) this.scheduleDriveSync(dirtyPaths[0]);
      return;
    }
    const localRoot = this.vaultConfig.localVaultRoot;
    const cachedDriveState = Boolean(this.driveFiles?.size || this._lastSyncedManifestSig || this.pendingDriveDeletes?.length || hasStructureChanges);
    const restoreRoot = Boolean(localRoot && cachedDriveState &&
      typeof this.app?.vault?.getAbstractFileByPath === "function" &&
      !this.app.vault.getAbstractFileByPath(localRoot));
    if (periodic && !restoreRoot && this.lastDriveSyncFinishedAt && Date.now() - this.lastDriveSyncFinishedAt < 45_000) return;
    if (periodic && restoreRoot && this._lastRestoreAttemptAt && Date.now() - this._lastRestoreAttemptAt < 30_000) return;
    if (restoreRoot) this._lastRestoreAttemptAt = Date.now();
    if (
      !periodic &&
      !duePlatform &&
      !restoreRoot &&
      !hasStructureChanges &&
      !(this.pendingDriveDeletes?.length) &&
      !(this.pendingDriveMoves?.length) &&
      dirtyPaths.length > 0 &&
      dirtyPaths.length <= 3 &&
      typeof this.driveClient?.pushSingleFile === "function"
    ) {
      let needsFullFallback = false;
      let hadError = false;
      for (const p of dirtyPaths) {
        const tf = this.app?.vault?.getAbstractFileByPath?.(p);
        const isFileObj = tf && (typeof TFile === "function" ? tf instanceof TFile : !Array.isArray(tf.children));
        if (!isFileObj) { this.dirtyDriveFiles.delete(p); continue; }
        if (this.isActivelyTyping(tf)) { this.scheduleDriveSync(p); continue; }
        const base = this.driveBaselineFor(tf);
        if (!base || !base.canEdit) { needsFullFallback = true; continue; }
        try {
          this.publishingDrive = true;
          this.activeSyncPath = p;
          await this.driveClient.pushSingleFile({
            file: tf, baseline: base,
            getShareMeta: (localPath, fileId) => this.shareMetaForSync(localPath, fileId),
            markInternalPath: mp => this.markInternalSyncWrite(mp),
          });
          this.dirtyDriveFiles.delete(p);
          this.lastLocalModifyAt?.delete(p);
        } catch (err) {
          if (err?.code === "REVISION_CONFLICT" || err?.code === "ROOT_BINDING_CHANGED") needsFullFallback = true;
          else {
            hadError = true;
            this.driveDownloadStatus = err?.message || "Не вдалося синхронізувати файл із Drive.";
          }
        } finally {
          this.publishingDrive = false;
          this.activeSyncPath = null;
        }
      }
      if (!needsFullFallback) {
        if (!hadError) await this.persist().catch(() => {});
        this.updateStatusBar();
        this.refreshDockViews(true);
        return;
      }
    }

    const hasState = (this.driveFiles?.size || 0) > 0 || (this.drivePreview?.matches || 0) > 0 ||
      (this.drivePreview?.desync?.platformLocalTotal || 0) > 0 ||
      (this.pendingDriveDeletes?.length || 0) > 0 || (this.pendingDriveMoves?.length || 0) > 0 ||
      (this.pendingFolderOps?.length || 0) > 0 ||
      (duePlatform && Boolean(this.vaultConfig?.pairedReadPlatform));
    if (!hasState) {
      if (periodic && !this.drivePreview && !this.previewingDrive && this.vaultConfig?.pairedReadDrive !== false) {
        const now = Date.now();
        if (!this.lastDrivePreviewAttemptAt || now - this.lastDrivePreviewAttemptAt >= 25_000) {
          this.lastDrivePreviewAttemptAt = now;
          await this.prepareVaultImport({ allowAutomatic: true });
        }
      }
      return;
    }
    // Silent manifest signature check: avoid scanning disk or flashing the dock when Drive hasn't changed.
    if (
      periodic &&
      !duePlatform &&
      !restoreRoot &&
      !hasStructureChanges &&
      dirtyPaths.length === 0 &&
      !(this.pendingDriveDeletes?.length) &&
      !(this.pendingDriveMoves?.length) &&
      typeof this.driveClient?.peekManifest === "function"
    ) {
      try {
        const peek = await this.driveClient.peekManifest();
        if (peek?.signature && this._lastSyncedManifestSig === peek.signature) {
          this.lastDriveSyncFinishedAt = Date.now();
          return;
        }
      } catch {
        /* Fall back cleanly to startVaultDownload if peek fails */
      }
    }
    const pushLocalAuto = dirtyPaths.length > 0 || hasStructureChanges ||
      Boolean(this.pendingDriveDeletes?.length || this.pendingDriveMoves?.length);
    // Automatic sync ALWAYS uses structureMode: "prompt" when folder/cross-folder structure changes exist so it NEVER rolls back local folder changes!
    await this.startVaultDownload(undefined, {
      automatic: true,
      quiet: periodic,
      pushLocal: !restoreRoot && (!periodic || pushLocalAuto),
      includePlatform: duePlatform,
      structureMode: restoreRoot || hasStructureChanges ? "prompt" : "push",
    });
  }

  driveFilesCount() {
    const userId = this.vaultConfig?.pairedUserId;
    if (!this.driveFiles?.size || !userId) return 0;
    let count = 0;
    for (const [path, row] of this.driveFiles) {
      if (row?.userId !== userId || row.kind === "platform" || !this.isPathInDriveRoot(path)) continue;
      const file = this.app?.vault?.getAbstractFileByPath?.(path);
      const isFileObj = file && (typeof TFile === "function" ? file instanceof TFile : !Array.isArray(file.children));
      if (isFileObj) count++;
    }
    return count;
  }

  updateImportProgress(stage, current, total) {
    this.importProgress = {stage,current,total};
    const roots = this.app.workspace.getLeavesOfType(DOCK_VIEW_TYPE).map(leaf => leaf.view?.contentEl).filter(Boolean);
    if (this.mobileImportRoot) roots.push(this.mobileImportRoot);
    for (const root of roots) {
      const progress = root.querySelector("[data-fc-import-progress]");
      if (!progress) continue;
      progress.hidden = !this.driveDownloading;
      progress.setAttribute("aria-label", stage);
      if (total > 0) {
        progress.max = total;
        progress.value = current;
      } else progress.removeAttribute("value");
    }
  }

  async startVaultDownload(report, { automatic = false, quiet = false, includePlatform = !automatic, structureMode, pushLocal = true, confirmBulkTrash = false, showResults = false } = {}) {
    if (this.driveDownloading || this.publishingDrive || this.reviewSyncBusy || this.savingNote || this.importingSlug || !this.vaultConfig.deviceToken) return;
    const effectiveStructureMode = structureMode || (
      !pushLocal ? "prompt" : this.pendingStructureSummary().hasChanges ? "prompt" : "push"
    );
    this.driveDownloading = true;
    this._quietSync = Boolean(quiet);
    this.cancelDriveDownload = false;
    this.driveResyncQueued = false;
    this.activeSyncPath = null;
    this.recentSyncedEntries = [];
    const token = this.vaultConfig.deviceToken;
    const stillCurrent = () => this.alive && !this.cancelDriveDownload && token === this.vaultConfig.deviceToken;
    this.syncActivity = [];
    this.syncTotals = {};
    this.syncResultNote = "";
    this.syncActivityUserId = this.vaultConfig.pairedUserId;
    const hadExistingBaselines = (this.driveFiles?.size || 0) > 0;
    const remoteUpdates = [];
    let lastTreeHighlightAt = 0;
    const updateActiveSyncVisual = (activePath) => {
      if (typeof activePath !== "string" || !activePath) return;
      this.activeSyncPath = activePath;
      const now = Date.now();
      if (now - lastTreeHighlightAt < 140) return;
      lastTreeHighlightAt = now;
      this.renderFileExplorerBadges();
      for (const leaf of this.app.workspace?.getLeavesOfType?.(DOCK_VIEW_TYPE) || []) {
        const linkEl = leaf.view?.contentEl?.querySelector?.("[data-fc-active-sync-link]");
        if (linkEl) {
          linkEl.hidden = false;
          linkEl.setAttribute("data-path", activePath);
          linkEl.setAttribute("title", `Відкрити в Obsidian: ${activePath}`);
          const nameEl = linkEl.querySelector("[data-fc-active-sync-name]");
          if (nameEl) nameEl.textContent = activePath.split("/").at(-1) || activePath;
        }
      }
    };
    const onEntry = entry => {
      if (!stillCurrent()) return;
      if (entry?.path) {
        this.markInternalSyncWrite(entry.path);
        if (entry.status !== "unchanged" && entry.status !== "skipped" && entry.status !== "props_updated") {
          this.dirtyDriveFiles?.delete(entry.path);
          this.recentSyncedEntries = [
            { path: entry.path, status: entry.status, reason: entry.reason || null, at: Date.now() },
            ...(this.recentSyncedEntries || []).filter(r => r.path !== entry.path),
          ].slice(0, 6);
        }
      }
      if (entry?.backupPath) this.markInternalSyncWrite(entry.backupPath);
      const { actionExcerpts, ...activity } = entry;
      this.syncActivity.push(activity);
      if (entry?.path && hadExistingBaselines) {
        if (entry.channel === "platform" && entry.status === "saved" && entry.reason === "platform_updated") {
          this.recordUnreviewedSiteUpdate(entry.path, {
            count: entry.actionCount || 1,
            changes: entry.actionDetails,
            summary: entry.actionSummary || "Автооновлення об’єкта із сайту",
            kind: entry.entity || "platform",
          });
        } else if (entry.channel === "drive" && (
          (entry.status === "saved" && (entry.reason === "remote_update" || entry.reason === "remote_new")) ||
          entry.status === "archived_conflict" ||
          entry.status === "moved_local" ||
          entry.status === "archived_delete"
        )) {
          remoteUpdates.push({
            path: entry.path,
            editorName: entry.editorName || null,
            status: entry.status,
            reason: entry.reason || null,
          });
          if (entry.status !== "moved_local" && entry.status !== "archived_delete") {
            const baseAction = entry.reason === "remote_new" ? "Новий документ у Drive" : "Оновлено документ у Drive";
            this.recordUnreviewedSiteUpdate(entry.path, {
              count: 1,
              summary: baseAction,
              changes: entry.actionDetails,
              excerpts: actionExcerpts,
              kind: "drive",
              editorName: entry.editorName || null,
              editorUserId: entry.editorUserId || null,
              editedAt: entry.editedAt || new Date().toISOString(),
            });
          }
        }
      }
    };
    let lastStatusAt = 0, lastPhase;
    const update = (text, throttle = false) => {
      this.driveDownloadStatus = text;
      if (throttle && Date.now() - lastStatusAt < 180) return;
      lastStatusAt = Date.now();
      report?.(text);
      for (const leaf of this.app.workspace.getLeavesOfType(DOCK_VIEW_TYPE)) {
        leaf.view?.contentEl?.querySelector?.("[data-fc-download-status]")?.setText(text);
      }
    };
    if (!quiet) {
      update(automatic ? "Фонова перевірка змін Google Drive…" : pushLocal ? "Звіряємо й синхронізуємо зміни з Google Drive…" : "Оновлюємо локальний Vault із Google Drive…");
      this.updateStatusBar();
    }
    this.importProgress = {stage:"Drive",current:0,total:0};
    if (!quiet) this.refreshDockViews();
    try {
      const useFullSync = typeof this.driveClient?.sync === "function";
      const result = this.vaultConfig.pairedReadDrive === false
        ? { available: 0, saved: 0, downloaded: 0, unchanged: 0, dirty: 0, conflicts: 0, skipped: 0, canEdit: false, partial: false }
        : useFullSync
        ? await this.driveClient.sync({
            lookup: path => this.driveFiles.get(path),
            entries: this.driveFiles,
            forget: path => this.driveFiles.delete(path),
            driveFolders: this.driveFolders,
            rememberFolder: (path, meta) => { this.driveFolders ??= new Map(); this.driveFolders.set(path, meta); },
            forgetFolder: path => this.driveFolders?.delete(path),
            pendingFolderOps: this.pendingFolderOps || [],
            consumeFolderOp: op => {
              this.pendingFolderOps = (this.pendingFolderOps || []).filter(item =>
                item !== op && !(item.kind === op.kind && item.oldPath === op.oldPath && item.newPath === op.newPath && item.path === op.path),
              );
            },
            structureMode: effectiveStructureMode,
            markInternalPath: path => this.markInternalSyncWrite(path),
            pendingDeletes: this.pendingDriveDeletes || [],
            consumeDelete: fileId => { this.pendingDriveDeletes = (this.pendingDriveDeletes || []).filter(d => d.fileId !== fileId); },
            pendingMoves: this.pendingDriveMoves || [],
            consumeMove: move => {
              this.pendingDriveMoves = (this.pendingDriveMoves || []).filter(m =>
                m !== move && !(m.fileId === move?.fileId && m.newPath === move?.newPath),
              );
            },
            isEditorDirty: file => this.isEditorDirty(file),
            isActiveLiveFile: path => Boolean(this.priorityCanvasJobs?.has(path) ||
              (this.liveSession?.kind === "drive" && this.liveSession.file?.path === path)),
            allowBulkTrash: !automatic && pushLocal && Boolean(confirmBulkTrash),
            pushLocal,
            getShareMeta: (localPath, fileId) => this.shareMetaForSync(localPath, fileId),
            lastBindingRevision: this.vaultConfig.revision || null,
            onEntry,
            shouldContinue: stillCurrent,
            report: (current, total, phase, activePath) => {
              if (quiet && total === 0) return;
              if (quiet && total > 0 && this._quietSync) {
                this._quietSync = false;
                this.refreshDockViews();
              }
              if (activePath) updateActiveSyncVisual(activePath);
              const label = phase === "upload" ? "Відправка в Drive" : "Оновлення змін Drive";
              const phaseChanged = phase !== lastPhase;
              lastPhase = phase;
              this.updateImportProgress(label, current, total);
              const shortName = activePath ? ` · ${activePath.split("/").at(-1)}` : "";
              update(total > 0 ? `${label} · ${current} / ${total}${shortName}` : `${label} · усе актуально`, !phaseChanged);
            },
          })
        : await this.driveClient.pull({
            lookup: path => this.driveFiles.get(path),
            entries: this.driveFiles,
            forget: path => this.driveFiles.delete(path),
            onEntry,
            shouldContinue: stillCurrent,
            report: (current, total) => {
              this.updateImportProgress("Файли Drive",current,total);
              update(`Файли Drive · ${current} / ${total}`,true);
            },
          });
      if (!stillCurrent()) return;
      if (!result.partial && result.manifestSignature) {
        this._lastSyncedManifestSig = result.manifestSignature;
      }
      if (result.pendingStructure?.total > 0 && (this.vaultConfig.pairedCanEdit || this.accountIsAdmax)) {
        this.scheduleStructurePrompt();
      }
      this.syncTotals.drive = result;
      if (result.partial) this.syncResultNote = "Список Drive частковий. Доступні результати можна відкрити нижче.";
      let platformResult = null;
      const matchedCount = (result.saved || 0) + (result.unchanged || 0) + (result.uploaded || 0) + (result.created || 0) + (result.movedLocal || 0) + (result.movedRemote || 0) + (result.archivedConflicts || 0) + (result.dirty || 0) + (result.conflicts || 0);
      const uploadedTotal = (result.uploaded || 0) + (result.created || 0) + (result.movedRemote || 0);
      const archivedTotal = (result.archivedConflicts || 0) + (result.archivedRemoteDelete || 0);
      this.driveLastSummary = {
        at: new Date().toISOString(), available: result.available,
        downloaded: result.downloaded ?? result.saved ?? 0, uploaded: uploadedTotal,
        trashedRemote: result.trashedRemote || 0, archived: archivedTotal,
        conflicts: result.conflicts || 0, skipped: result.skipped || 0,
        backups: Array.isArray(result.backups) ? result.backups.slice(0, 30) : [],
      };
      this.drivePreview = {
        available: result.available,
        matches: matchedCount,
        partial: result.partial,
        canEdit: result.canEdit,
        rootId: result.rootId || null,
        source: result.source,
        desync: {
          hasDesync: (result.conflicts || 0) > 0,
          totalIssues: result.conflicts || 0,
          driveMissing: 0, driveOutdated: 0, driveRenamed: 0, driveUntracked: 0,
          platformLocalTotal: 0, platformLegacyNames: 0, platformLegacySchema: 0, platformUnboundOrOld: 0, platformMissing: 0,
          pagesOutdated: 0, pagesMissing: 0, localDirty: result.dirty || 0,
        },
      };
      this.syncVaultSourceMeta(result.source, result.rootId, result.available);
      const parts = [
        result.downloaded || result.saved ? `${result.downloaded ?? result.saved} завантажено` : null,
        uploadedTotal ? `${uploadedTotal} відправлено в Drive` : null,
        result.trashedRemote ? `${result.trashedRemote} перенесено в кошик` : null,
        archivedTotal ? `${archivedTotal} збережено в архів (Drive головний)` : null,
        `${result.unchanged} актуальних`,
        result.dirty ? `${result.dirty} зі змінами` : null,
        result.conflicts ? `${result.conflicts} конфліктів` : null,
        !automatic && result.skipped ? `${result.skipped} пропущено` : null,
      ].filter(Boolean);
      update(`Drive: ${parts.join(" · ")}${result.partial ? " · список частковий" : ""}.`);
      const platformAllowed = typeof this.vaultConfig.pairedReadPlatform === "boolean"
        ? this.vaultConfig.pairedReadPlatform
        : (result.canEdit && this.vaultConfig.pairedCanEdit);
      if (includePlatform && platformAllowed) {
        const driveStatus = this.driveDownloadStatus;
        try {
          platformResult = await this.driveClient.pullPlatform({
            lookup: path => this.driveFiles.get(path), entries: this.driveFiles,
            forget: path => this.driveFiles.delete(path), includePeople:this.accountIsAdmax,
            includePhotos:this.vaultConfig.importPhotos, shouldContinue:stillCurrent,
            onEntry,
            report: (current, total) => {
              this.updateImportProgress("Об’єкти FlightClub",current,total);
              update(`Об’єкти FlightClub · ${current} / ${total}`,true);
            },
          });
          if (!stillCurrent()) return;
          this.lastPlatformAutoSyncAt = Date.now();
          if (platformResult.saved > 0 || platformResult.conflicts === 0) {
            this.vaultConfig.platformV3Migrated = true;
          }
          this.syncTotals.platform = platformResult;
          const postIssues = (result.conflicts || 0) + (platformResult.conflicts || 0);
          this.drivePreview.desync = {
            ...this.drivePreview.desync,
            hasDesync: postIssues > 0,
            totalIssues: postIssues,
            platformLocalTotal: platformResult.saved + platformResult.conflicts,
            platformLegacyNames: 0,
            platformLegacySchema: 0,
            platformUnboundOrOld: 0,
            platformMissing: 0,
          };
          update(`${driveStatus} Об’єкти FlightClub: ${platformResult.saved} звірено · ${platformResult.conflicts} конфліктів · ${platformResult.skipped} пропущено.`);
        } catch (error) {
          this.syncResultNote = `Об’єкти FlightClub: ${error.message}`;
          update(this.syncResultNote);
        }
      }
      if (automatic && remoteUpdates.length > 0 && typeof Notice === "function") {
        const first = remoteUpdates[0];
        const shortName = String(first.path || "").split("/").pop() || first.path;
        if (remoteUpdates.length === 1) {
          new Notice(`Оновлено з FlightClub Drive: ${shortName}${first.editorName ? ` (${first.editorName})` : ""}`);
        } else {
          const second = remoteUpdates[1];
          const secondName = String(second.path || "").split("/").pop() || second.path;
          const more = remoteUpdates.length > 2 ? ` +${remoteUpdates.length - 2}` : "";
          new Notice(`Оновлено ${remoteUpdates.length} нотаток із FlightClub Drive: ${shortName}, ${secondName}${more}`);
        }
      }
      const platSynced = (platformResult?.saved || 0);
      if (automatic && !includePlatform && platSynced > 0) {
        this.lastPlatformAutoSyncAt = Date.now();
      }
      if (includePlatform && stillCurrent() && this.vaultConfig.importPages && !this.importingSlug) {
        this.updateImportProgress("Сторінки сайту",0,0);
        await this.pullPagesFromSite({ quiet:true, shouldContinue:stillCurrent });
      }
    } catch (error) {
      this.syncResultNote = error instanceof Error ? error.message : "Не вдалося прочитати Drive.";
      update(this.syncResultNote);
    } finally {
      if (this.alive && token === this.vaultConfig.deviceToken) {
        try { await this.persist(); } catch {
          this.syncResultNote = "Файли збережено, але не вдалося зберегти стан синхронізації.";
          update(this.syncResultNote);
        }
      }
      this.driveDownloading = false;
      this._quietSync = false;
      this.activeSyncPath = null;
      this.lastDriveSyncFinishedAt = Date.now();
      if (this.alive) {
        if (!this.liveSession && this.activeNote()) {
          this.attachLiveSessionToActiveNote(this.activeNote());
        }
        this.updateStatusBar();
        this.renderFileExplorerBadges();
        this.refreshDockViews();
        void this.loadTeamPluginsCatalog?.({ silent: true }).then(async (cat) => {
          if (!this.alive || automatic || this.teamPluginsPromptedThisRun || !cat?.plugins?.length) return;
          if (typeof FC_TEAM_PLUGINS === "undefined") return;
          const installed = await FC_TEAM_PLUGINS.listInstalledPlugins(this.app);
          const summary = FC_TEAM_PLUGINS.computeTeamPluginStatus({
            teamPlugins: cat.plugins,
            installedPlugins: installed,
            isMobile: Boolean(Platform?.isMobile || Platform?.isMobileApp),
          });
          if (summary.actionableCount > 0 && typeof Notice === "function") {
            this.teamPluginsPromptedThisRun = true;
            new Notice(`🧩 Для команди доступні ${summary.actionableCount} плагінів у вкладці Drive → «Плагіни команди».`, 6500);
          }
        }).catch(() => {});
        if (showResults && stillCurrent() && this.accountVerified && this.syncTotals.drive) {
          const issue = this.syncActivity.some(entry => entry.channel === "drive" &&
            ["conflict", "archived_conflict", "archived_delete"].includes(entry.status));
          this.openSyncResults("drive", issue ? "conflict" : "changed");
        }
        this.queuePublishCheck();
        if (this.driveResyncQueued) {
          this.driveResyncQueued = false;
          setTimeout(() => void this.runAutomaticDriveSync(), 5_000);
        }
      }
    }
  }

  renderSyncMetrics(container) {
    if (!this.accountVerified || this.syncActivityUserId !== this.vaultConfig.pairedUserId || !this.syncTotals) return;
    if (this.syncResultNote && this.syncTotals.drive) container.createEl("p",{text:this.syncResultNote,cls:"fc-sync-note",attr:{role:"status"}});
    const drive = this.syncTotals.drive;
    if (drive) {
      const section = container.createDiv({ cls: "fc-sync-metrics" });
      const up = (drive.uploaded || 0) + (drive.created || 0) + (drive.movedRemote || 0);
      const down = drive.downloaded ?? drive.saved ?? 0;
      const issues = (drive.conflicts || 0) + (drive.archivedConflicts || 0) + (drive.archivedRemoteDelete || 0);
      const dirty = drive.dirty || 0;
      const skipped = drive.skipped || 0;
      const unchanged = drive.unchanged || 0;
      const actions = section.createDiv({ cls: "fc-sync-metric-actions", attr: { role: "group", "aria-label": "Drive · результати синхронізації" } });
      const chips = [
        { status: "saved", text: `Завантажено · ${down}`, tone: down > 0 ? "saved" : "quiet" },
        ...(up > 0 ? [{ status: "uploaded", text: `⬆️ Відправлено · ${up}`, tone: "uploaded" }] : []),
        { status: "unchanged", text: `Актуальні · ${unchanged}`, tone: "ok" },
        { status: "dirty", text: `Локальні правки · ${dirty}`, tone: dirty > 0 ? "dirty" : "quiet" },
        { status: "conflict", text: `Конфлікти · ${issues}`, tone: issues > 0 ? "conflict" : "quiet" },
        { status: "skipped", text: `Веб-файли Drive · ${skipped}`, tone: "quiet", title: "Google Docs, Таблиці та інші веб-формати Google Drive, що відкриваються у браузері" },
      ];
      for (const chip of chips) {
        const button = actions.createEl("button", {
          text: chip.text,
          cls: "fc-sync-metric",
          attr: { type: "button", "data-state": chip.tone, ...(chip.title ? { title: chip.title } : {}) },
        });
        button.addEventListener("click", () => this.openSyncResults("drive", chip.status));
      }
    }
    const platform = this.syncTotals.platform;
    if (platform) {
      const platConflicts = platform.conflicts || 0;
      const platWrap = platConflicts > 0
        ? container.createDiv({ cls: "fc-sync-metrics" })
        : container.createEl("details", { cls: "fc-sync-metrics fc-sync-platform-compact" });
      if (platConflicts > 0) {
        platWrap.createEl("strong", { text: "Об’єкти FlightClub" });
      } else {
        platWrap.createEl("summary", {
          cls: "fc-dock-details-summary",
          text: `Об’єкти FlightClub · ${platform.saved || 0} звірено`,
        });
      }
      const actions = platWrap.createDiv({ cls: "fc-sync-metric-actions", attr: { role: "group", "aria-label": "Об’єкти FlightClub · результати" } });
      for (const [status, title, count, tone] of [
        ["saved", "Звірено", platform.saved || 0, "ok"],
        ["conflict", "Конфлікти", platConflicts, platConflicts > 0 ? "conflict" : "quiet"],
        ["skipped", "Пропущені", platform.skipped || 0, "quiet"],
      ]) {
        const button = actions.createEl("button", {
          text: `${title} · ${count}`,
          cls: "fc-sync-metric",
          attr: { type: "button", "data-state": tone },
        });
        button.addEventListener("click", () => this.openSyncResults("platform", status));
      }
    }
  }

  openSyncResults(channel,initialStatus="conflict",initialEntry=null) {
    if (!this.accountVerified || (!initialEntry && this.syncActivityUserId !== this.vaultConfig.pairedUserId)) {
      new Notice("Спочатку підтвердьте доступ акаунта.");
      return;
    }
    this.dialog?.close();
    const modal=new Modal(this.app);
    this.dialog=modal;
    this.syncReviewClose=()=>modal.close();
    const userId=this.vaultConfig.pairedUserId, token=this.vaultConfig.deviceToken;
    const normalizedInitial = initialStatus === "issues" ? "conflict" : initialStatus;
    let epoch=0, open=true, busy=false, selectedStatus=normalizedInitial, query="", previewComponent=null;
    const sameAccount=()=>this.alive && this.accountVerified &&
      token === this.vaultConfig.deviceToken && userId === this.vaultConfig.pairedUserId;
    const current=()=>open && sameAccount();
    modal.onOpen=()=>{
      const root=modal.contentEl;
      root.addClass("fc-sync-review");
      modal.modalEl?.addClass("fc-sync-review-modal");
      modal.setTitle("🔎 Зміни та конфлікти — До / Після");
      const allChannelEntries = () => (initialEntry ? [initialEntry] : this.syncActivity || []).filter(e => e.channel === channel);
      const matchesFilter = (entry, filterKey) => {
        if (filterKey === "all") return true;
        if (filterKey === "conflict" || filterKey === "issues") return ["conflict", "archived_conflict", "archived_delete"].includes(entry.status);
        if (filterKey === "changed") return ["saved", "uploaded", "created_remote", "moved_local", "moved_remote", "moved_folder_remote", "trashed_remote"].includes(entry.status);
        if (filterKey === "uploaded") return ["uploaded", "created_remote", "moved_remote", "moved_folder_remote"].includes(entry.status);
        return entry.status === filterKey;
      };

      const checkpointName = this.drivePreview?.source?.name || this.vaultConfig?.vaultRootName;
      if (checkpointName) {
        const allForSummary = allChannelEntries();
        const cCount = allForSummary.filter(e => matchesFilter(e, "conflict")).length;
        const chCount = allForSummary.filter(e => matchesFilter(e, "changed")).length;
        const dCount = allForSummary.filter(e => matchesFilter(e, "dirty")).length;
        const cpBar = root.createDiv({ cls: "fc-sync-review-checkpoint" });
        cpBar.createSpan({
          cls: "fc-sync-review-checkpoint-name",
          text: `Чекпоїнт: ${checkpointName} → ${this.vaultConfig?.localVaultRoot || "Vault"}`,
        });
        cpBar.createSpan({
          cls: "fc-sync-review-checkpoint-stats",
          text: `Конфліктів: ${cCount} · Змінено: ${chCount} · Локальні: ${dCount}`,
        });
      }

      const tabsBar = root.createDiv({ cls: "fc-sync-review-tabs", attr: { role: "tablist", "aria-label": "Категорії файлів" } });
      const tabDefs = [
        ["conflict", "⚠️ Конфлікти й Архів"],
        ["changed", "⚡ Змінені"],
        ["dirty", "✏️ Локальні правки"],
        ["saved", "⬇️ Завантажено"],
        ["uploaded", "⬆️ Відправлено"],
        ["unchanged", "✓ Актуальні"],
        ["skipped", "☁️ Веб-файли Drive"],
        ["all", "Усі"],
      ];
      const tabButtons = new Map();

      const controls=root.createDiv({cls:"fc-sync-review-controls"});
      const field=controls.createEl("label",{text:"Пошук файлу"});
      const search=field.createEl("input",{attr:{type:"search",placeholder:"Введіть назву нотатки або шлях…",autocomplete:"off"}});
      const filter=controls.createEl("label",{text:"Категорія"});
      const select=filter.createEl("select");
      for (const [value,label] of tabDefs) {
        const option=select.createEl("option",{text:label,attr:{value}});
        option.selected=value === selectedStatus;
        const tabBtn = tabsBar.createEl("button", {
          text: label,
          cls: "fc-sync-review-tab" + (value === selectedStatus ? " is-active" : ""),
          attr: { type: "button", role: "tab", "aria-selected": String(value === selectedStatus), "data-tab": value },
        });
        tabBtn.addEventListener("click", () => {
          if (busy) return;
          selectedStatus = value;
          select.value = value;
          filtersChanged();
        });
        tabButtons.set(value, tabBtn);
      }

      const layout=root.createDiv({cls:"fc-sync-review-layout"});
      const list=layout.createEl("ul",{cls:"fc-sync-review-list",attr:{"aria-label":"Файли синхронізації"}});
      const detail=layout.createDiv({cls:"fc-sync-review-detail"});
      const footer=root.createDiv({cls:"fc-sync-review-footer"});
      const summary=footer.createSpan({attr:{role:"status"}});
      const more=footer.createEl("button",{text:"Показати ще",attr:{type:"button"}});
      const refresh=footer.createEl("button",{text:"🔄 Перевірити заново",attr:{type:"button"}});
      const close=footer.createEl("button",{text:"Закрити",attr:{type:"button"}});
      const statusBadgeMeta = {
        saved: ["⬇️ Завантажено", "is-saved"],
        uploaded: ["⬆️ Відправлено", "is-uploaded"],
        created_remote: ["⬆️ Створено в Drive", "is-uploaded"],
        moved_local: ["📁 Переміщено", "is-saved"],
        moved_remote: ["📁 Переміщено в Drive", "is-uploaded"],
        moved_folder_remote: ["📁 Папку оновлено", "is-uploaded"],
        dirty: ["✏️ Локальні правки", "is-dirty"],
        conflict: ["⚠️ Конфлікт", "is-conflict"],
        archived_conflict: ["📦 Архів конфлікту", "is-conflict"],
        archived_delete: ["🗑️ Видалено на Drive", "is-conflict"],
        unchanged: ["✓ Актуальний", "is-ok"],
        skipped: ["☁️ Веб-файл Drive", "is-quiet"],
        deferred: ["⏸ Відкритий у редакторі", "is-dirty"],
      };
      const reasons={
        local_changes:"У локальному Obsidian є невідправлені правки — натисніть «⬆️ Залити в Drive» у панелі «Керування синхронізацією» або перегляньте різницю нижче.",
        drive_wins_conflict:"Обидві версії мали правки; активна версія з Google Drive, а вашу локальну чернетку збережено в архіві (можна відновити в 1 клік).",
        drive_wins_adopt:"Файл існував локально з іншим вмістом; активна версія з Google Drive, локальну копію збережено в архіві.",
        google_docs_yaml_healed:"Google Docs пошкодив YAML-властивості: плагін автоматично відновив коректний блок Properties і застосував оновлений текст нотатки. (Текст редагуйте в Docs, Properties — в Obsidian.)",
        docs_yaml_corrupted_ambiguous:"Google Docs пошкодив межу YAML (---): щоб зберегти Properties і не загубити текст із Docs, правку збережено в архіві конфліктів.",
        deleted_on_drive:"Файл видалено з Google Drive; локальну резервну копію збережено в архіві.",
        bulk_trash_confirm:"Видалено понад 10 локальних файлів: масове видалення в Drive зупинено для безпеки. Натисніть «🗑️ Підтвердити видалення в Drive» нижче або «⬇️ Відновити файли з Drive».",
        oversized:"Файл перевищує ліміт розміру синхронізації (1 МБ для тексту, 8 МБ для зображень).",
        read_only:"Акаунт має доступ лише для читання.",
        remote_move:"Файл переміщено на Google Drive.",
        duplicate_binding:"Кілька локальних копій прив’язані до одного файлу Drive.",
        open_editor:"Файл щойно редагувався — синхронізація захистила ваші правки від перезапису.",
        ambiguous_path:"Кілька файлів на Drive мають однаковий шлях.",
        unbound_platform:"Звірте нотатку з її записом на сайті.",
        path_collision:"Шлях зайнятий іншим файлом або папкою.",
        revision:"Версія змінилася під час синхронізації.",
        invalid_remote:"Сервер повернув неповні дані.",
        integrity:"Не збіглася контрольна сума.",
        unsupported:"Веб-документ Google Drive (Google Docs / Таблиця / Презентація або непідтримуваний формат) — відкривається в браузері.",
        photo_limit:"Фото перевищує допустимий розмір.",
        photo_unavailable:"Не вдалося завантажити фото.",
        unavailable:"Файл тимчасово недоступний.",
      };
      const renderUnifiedDiff = (container, oldLabel, newLabel, oldText, newText) => {
        const diff = FC_MARKDOWN_DIFF.diffMarkdownLines(String(oldText ?? ""), String(newText ?? ""), { context: 2 });
        const head = container.createDiv({ cls: "fc-sync-diff-summary" });
        head.createSpan({ text: `${oldLabel}  →  ${newLabel}`, cls: "fc-sync-diff-legend" });
        if (diff.identical) {
          head.createSpan({ text: "✓ Текст повністю ідентичний", cls: "fc-history-pill is-neutral" });
          return;
        }
        const pills = head.createDiv({ cls: "fc-history-stat-badges" });
        if (diff.addedLines > 0) pills.createSpan({ text: `+${diff.addedLines} рядків`, cls: "fc-history-pill is-add" });
        if (diff.removedLines > 0) pills.createSpan({ text: `−${diff.removedLines} рядків`, cls: "fc-history-pill is-del" });
        const box = container.createDiv({ cls: "fc-diff-box fc-sync-diff-box" });
        const doc = box.ownerDocument;
        const appendRow = (row) => {
          const lineEl = doc.createElement("div");
          lineEl.className = `fc-diff-line is-${row.kind}`;
          const gutter = doc.createElement("span");
          gutter.className = "fc-diff-gutter";
          gutter.textContent = row.kind === "add" ? String(row.newLine ?? "") : row.kind === "del" ? String(row.oldLine ?? "") : String(row.newLine ?? row.oldLine ?? "");
          const sign = doc.createElement("span");
          sign.className = "fc-diff-sign";
          sign.textContent = row.kind === "add" ? "+" : row.kind === "del" ? "−" : " ";
          const code = doc.createElement("span");
          code.className = "fc-diff-code";
          if (Array.isArray(row.segments) && row.segments.length) {
            for (const seg of row.segments) {
              if (seg.type === "add" || seg.type === "del") {
                const mark = doc.createElement("mark");
                mark.className = seg.type === "add" ? "fc-diff-mark-add" : "fc-diff-mark-del";
                mark.textContent = seg.text;
                code.append(mark);
              } else code.append(doc.createTextNode(seg.text));
            }
          } else code.textContent = row.text || " ";
          lineEl.append(gutter, sign, code);
          box.append(lineEl);
        };
        for (const block of (diff.blocks || []).slice(0, 400)) {
          if (block.type === "collapsed") {
            const fold = doc.createElement("button");
            fold.type = "button";
            fold.className = "fc-diff-fold";
            fold.textContent = `⋯ Показати ${block.count} незмінних рядків ⋯`;
            fold.addEventListener("click", () => {
              const frag = doc.createDocumentFragment();
              const tmp = doc.createElement("div");
              for (const line of block.lines || []) {
                const lineEl = doc.createElement("div");
                lineEl.className = `fc-diff-line is-${line.kind || "context"}`;
                const g = doc.createElement("span"); g.className = "fc-diff-gutter"; g.textContent = String(line.newLine ?? line.oldLine ?? "");
                const s = doc.createElement("span"); s.className = "fc-diff-sign"; s.textContent = " ";
                const c = doc.createElement("span"); c.className = "fc-diff-code"; c.textContent = line.text || " ";
                lineEl.append(g, s, c);
                tmp.append(lineEl);
              }
              while (tmp.firstChild) frag.appendChild(tmp.firstChild);
              fold.replaceWith(frag);
            });
            box.append(fold);
          } else {
            appendRow(block);
          }
        }
      };

      let selectedEntry = null;
      const show=async entry=>{
        if (!current() || busy) return;
        const generation=++epoch;
        selectedEntry = entry;
        list.querySelector("[aria-current]")?.removeAttribute("aria-current");
        buttons.get(entry)?.setAttribute("aria-current","true");
        previewComponent?.unload();
        previewComponent=null;
        detail.empty();
        const headerBar = detail.createDiv({ cls: "fc-sync-review-head" });
        const badge = statusBadgeMeta[entry.status] || [entry.status, "is-quiet"];
        headerBar.createEl("h3", { text: entry.path.split("/").at(-1) || entry.fileId });
        headerBar.createSpan({ text: badge[0], cls: "fc-sync-status-pill " + badge[1] });
        detail.createEl("p",{text:entry.path,cls:"fc-sync-review-path"});
        if (entry.channel === "drive" && entry.remoteVersion && ["saved", "archived_conflict"].includes(entry.status)) {
          const editedAt = formatEditorTimestamp(entry.editedAt);
          detail.createEl("p", {
            cls: "fc-sync-review-path",
            text: [entry.editorName || "Drive не надав імені автора", editedAt, `Версія Drive ${entry.remoteVersion}`].filter(Boolean).join(" · "),
          });
        }
        const status=detail.createEl("p",{text:reasons[entry.reason]||"Завантажуємо версії для порівняння До / Після…",attr:{role:"status"}});

        const quickBar = detail.createDiv({ cls: "fc-sync-review-quickbar" });
        const local=quickBar.createEl("button",{text:"📂 Відкрити в Obsidian",attr:{type:"button"}});
        local.disabled=!this.app.vault.getAbstractFileByPath(entry.path);
        local.addEventListener("click",()=>{
          if (current()) this.openAndRevealFile(entry.path);
        });
        if (entry.channel === "drive" && entry.fileId && DRIVE_ID.test(entry.fileId)) {
          const isMdEntry = /\.(?:md|markdown)$/i.test(entry.path || "");
          const gLink = quickBar.createEl("a", {
            text: isMdEntry ? "📝 Відкрити у Google Docs ↗" : "🗂️ Відкрити в Google Drive ↗",
            cls: "fc-sync-review-ext-link",
            attr: { href: driveOpenUrlForPath(entry.fileId, entry.path), target: "_blank", rel: "noopener noreferrer" },
          });
          gLink.setAttribute("role", "button");
          const note = this.app.vault.getAbstractFileByPath(entry.path);
          if (note instanceof TFile && isMdEntry && this.driveFiles?.get(entry.path)?.fileId === entry.fileId) {
            const history = quickBar.createEl("button", { text: "Історія версій Drive", attr: { type: "button" } });
            history.addEventListener("click", () => {
              if (!current()) return;
              modal.close();
              const versions = new Modal(this.app);
              this.dialog = versions;
              versions.setTitle(note.basename || entry.path.split("/").at(-1));
              versions.contentEl.addClass("fc-hub-wrap");
              this.renderHistoryPanel(versions.contentEl, note, this.linkFor(note));
              versions.onClose = () => { if (this.dialog === versions) this.dialog = null; };
              versions.open();
            });
          }
        }
        if (entry.reason === "bulk_trash_confirm") {
          const delTotal = Math.max(this.pendingDriveDeletes?.length || 0, (this.syncActivity || []).filter(e => e.reason === "bulk_trash_confirm").length);
          const confirmDelBtn = quickBar.createEl("button", {
            text: `🗑️ Підтвердити видалення (${delTotal}) в Drive`,
            cls: "mod-cta",
            attr: { type: "button", "data-fc-confirm-bulk-trash": "" },
          });
          confirmDelBtn.disabled = Boolean(this.driveDownloading || this.publishingDrive);
          confirmDelBtn.addEventListener("click", () => {
            modal.close();
            void this.startVaultDownload(undefined, { pushLocal: true, structureMode: "push", confirmBulkTrash: true, showResults: true });
          });
          const restoreDelBtn = quickBar.createEl("button", {
            text: "⬇️ Відновити файли з Drive",
            attr: { type: "button", "data-fc-restore-bulk-trash": "" },
          });
          restoreDelBtn.disabled = Boolean(this.driveDownloading || this.publishingDrive);
          restoreDelBtn.addEventListener("click", () => {
            modal.close();
            void this.startVaultDownload(undefined, { pushLocal: false, showResults: true });
          });
        }
        if (entry.backupPath) {
          const bf = this.app.vault.getAbstractFileByPath(entry.backupPath);
          const bBtn = quickBar.createEl("button", { text: "📦 Відкрити архів чернетки", attr: { type: "button" } });
          bBtn.disabled = !(bf instanceof TFile);
          bBtn.addEventListener("click", () => { if (current() && bf instanceof TFile) this.openAndRevealFile(entry.backupPath); });
          if (bf instanceof TFile) {
            const restoreBtn = quickBar.createEl("button", { text: "⏪ Відновити чернетку з архіву", cls: "mod-cta", attr: { type: "button" } });
            restoreBtn.addEventListener("click", async () => {
              if (!current() || busy) return;
              busy = true;
              try {
                const draftBytes = await this.app.vault.readBinary(bf);
                const targetFile = this.app.vault.getAbstractFileByPath(entry.path);
                this.markInternalSyncWrite(entry.path);
                if (targetFile instanceof TFile) await this.app.vault.modifyBinary(targetFile, draftBytes);
                else await this.app.vault.createBinary(entry.path, draftBytes);
                status.setText("✓ Локальну чернетку відновлено з архіву! Тепер натисніть «⬆️ Відправити в Drive», якщо хочете зберегти її на Drive.");
                new Notice("⏪ Чернетку відновлено з архіву.");
              } catch (err) {
                status.setText(err?.message || "Не вдалося відновити чернетку.");
              } finally { busy = false; }
            });
          }
        }
        if (entry.backupPath) {
          const bf = this.app.vault.getAbstractFileByPath(entry.backupPath);
          const lf = this.app.vault.getAbstractFileByPath(entry.path);
          if (bf instanceof TFile && lf instanceof TFile && /\.(?:md|markdown|canvas|txt|json)$/i.test(entry.path)) {
            try {
              const [archText, curText] = await Promise.all([this.app.vault.read(bf), this.app.vault.read(lf)]);
              if (!current() || generation !== epoch) return;
              const archWrap = detail.createDiv({ cls: "fc-sync-diff-section" });
              archWrap.createEl("h4", { text: "🔍 Що відрізнялось (Ваша чернетка в архіві → Поточна версія з Drive)" });
              renderUnifiedDiff(archWrap, "Ваша чернетка (архів)", "Активна версія (Drive)", archText, curText);
            } catch {}
          }
        }
        if (["ambiguous_path","path_collision","duplicate_binding","unsupported"].includes(entry.reason)) return;
        try {
          const snapshot=await this.driveClient.inspect(entry,path=>this.driveFiles.get(path));
          if (!current() || generation !== epoch) return;
          const component=obsidian.Component ? new obsidian.Component() : this;
          if (component !== this) { component.load(); previewComponent=component; }
          status.setText(snapshot.remote === snapshot.local
            ? "✓ Локальний файл і версія на Google Drive повністю збігаються."
            : "Порівняння версій (До / Після). Червоне — прибрано, зелене — додано у вашому Vault.");

          if (snapshot.local !== null && snapshot.remote !== null) {
            const diffSec = detail.createDiv({ cls: "fc-sync-diff-section" });
            renderUnifiedDiff(diffSec, "Google Drive / сайт (До)", "Ваш Obsidian Vault (Після)", snapshot.remote, snapshot.local);
          }
          const previews=detail.createDiv({cls:"fc-sync-review-previews"});
          for (const [label,text,bytes,missing] of [["💻 У цьому Vault (Після)",snapshot.local,snapshot.localBytes,snapshot.hasLocal === false],["☁️ На Google Drive / сайті (До)",snapshot.remote,snapshot.remoteBytes,false]]) {
            const panel=previews.createDiv({cls:"fc-sync-review-preview"});
            panel.createEl("h4",{text:label});
            if (missing) { panel.createEl("p",{text:"Файлу ще немає в цьому Vault."}); continue; }
            panel.createEl("small",{text:new Intl.NumberFormat("uk-UA").format(bytes)+" байт"});
            if (text === null) { panel.createEl("p",{text:"Вкладення. Для перегляду можна зберегти серверну копію."}); continue; }
            const source=panel.createEl("details");
            source.createEl("summary",{text:snapshot.kind === "canvas" ? "Дані Canvas" : "Текст Markdown"});
            source.createEl("pre").createEl("code",{text:text.slice(0,120_000)});
            if (text.length > 120_000) panel.createEl("p",{text:"Попередній перегляд скорочено. Синхронізація використовує весь файл."});
            if (snapshot.kind !== "canvas" && obsidian.MarkdownRenderer?.render) {
              const rendered=panel.createDiv({cls:"markdown-rendered"});
              await obsidian.MarkdownRenderer.render(this.app,text.slice(0,120_000),rendered,entry.path,component);
              if (!current() || generation !== epoch) { rendered.empty(); return; }
            } else source.open=true;
          }
          if (snapshot.uploadError) detail.createEl("p",{text:snapshot.uploadError,cls:"fc-sync-review-note"});
          const actions=detail.createDiv({cls:"fc-sync-review-actions"});
          const confirmation=detail.createDiv({cls:"fc-sync-review-confirm"});
          const fileIsLive=()=>this.liveSession?.file?.path === entry.path && this.liveSessionAuthorized(this.liveSession);
          const recommendedDirection = (entry.status === "conflict" || entry.status === "archived_conflict")
            ? "download"
            : entry.status === "dirty"
              ? "upload"
              : null;
          const addAction=(direction,label,explanation,enabled)=>{
            const button=actions.createEl("button",{
              text:label,
              ...(direction === recommendedDirection ? { cls: "mod-cta" } : {}),
              attr:{type:"button"},
            });
            button.disabled=!enabled || this.driveDownloading || this.publishingDrive || (direction !== "copy" && fileIsLive());
            button.addEventListener("click",()=>{
              if (!current() || busy) return;
              confirmation.empty();
              confirmation.createEl("p",{text:explanation});
              const confirm=confirmation.createEl("button",{text:"Підтвердити дію",cls:"mod-cta",attr:{type:"button"}});
              const cancel=confirmation.createEl("button",{text:"Скасувати",attr:{type:"button"}});
              cancel.addEventListener("click",()=>{if(!busy){confirmation.empty();button.focus();}});
              confirm.focus();
              confirm.addEventListener("click",async()=>{
                if (!current() || busy) return;
                if (this.driveDownloading || this.publishingDrive || (direction !== "copy" && fileIsLive())) {
                  status.setText("Завершіть поточну синхронізацію або призупиніть Live Edit."); return;
                }
                busy=true;
                this.reviewSyncBusy=true;
                select.disabled=search.disabled=more.disabled=refresh.disabled=true;
                for (const control of actions.querySelectorAll("button")) control.disabled=true;
                confirm.disabled=cancel.disabled=true;
                status.setText("Синхронізуємо вибрану версію…");
                try {
                  const result=await this.driveClient.resolveReview(snapshot.id,direction);
                  if (!sameAccount()) return;
                  await this.persist();
                  if (!sameAccount()) return;
                  if (!result.copied) {
                    const totals=initialEntry ? null : this.syncTotals?.[channel];
                    const counter=entry.status === "conflict" ? "conflicts" : entry.status;
                    if (totals && counter !== "saved") {
                      totals[counter]=Math.max(0,(totals[counter]||0)-1);
                      totals.saved++;
                    }
                    entry.resolved=true;
                    entry.status="saved";
                    entry.reason=null;
                  }
                  confirmation.empty();
                  status.setText(result.copied ? "Серверну копію збережено · "+result.path
                    : result.uploaded ? "Зміни відправлено на сайт." : "Версію сайту прийнято."+ (result.backup ? " Попередня копія · "+result.backup : ""));
                  this.queuePublishCheck();
                } catch(error) {
                  if(current())status.setText((error.message||"Не вдалося синхронізувати.")+" Оновіть порівняння перед повторною дією.");
                } finally {
                  busy=false;
                  this.reviewSyncBusy=false;
                  select.disabled=search.disabled=more.disabled=refresh.disabled=false;
                  if(open){draw();status.setAttribute("tabindex","-1");status.focus();}
                }
              });
            });
          };
          if (fileIsLive()) detail.createEl("p",{text:"Призупиніть Live Edit цієї нотатки, щоб змінити її через звіт Drive."});
          addAction("download","Прийняти версію сайту",snapshot.hasLocal === false ? "Файл буде додано до цього Vault." : "Локальний файл буде оновлено версією з Drive. Попередня локальна копія збережеться в архіві.",snapshot.canDownload ?? snapshot.remote !== null);
          addAction("upload","Відправити локальні зміни",entry.channel === "platform"
            ? "На сайт буде відправлено лише назву й опис. Поточні права та версію запису перевірить сервер."
            : "На Google Drive буде відправлено показану локальну версію з Obsidian.",snapshot.canUpload);
          addAction("copy","Зберегти окрему серверну копію","Обидві версії збережуться. Копія з Drive з’явиться у FlightClub Sync Archive.",true);
          const reload=detail.createEl("button",{text:"↻ Оновити порівняння",attr:{type:"button"}});
          reload.addEventListener("click",()=>{if(!busy)void show(entry);});
        } catch(error) {
          if(current() && generation===epoch)status.setText(error.message||"Не вдалося прочитати версію сайту.");
        }
      };
      const buttons = new Map();
      let visible=[],shown=0;
      const append=()=>{
        for(const entry of visible.slice(shown,shown+40)){
          const row=list.createEl("li");
          const badge = statusBadgeMeta[entry.status] || [entry.status, "is-quiet"];
          const button=row.createEl("button",{text:(entry.resolved ? "✓ " : "") + entry.path,cls:"fc-sync-review-row-btn",attr:{type:"button"}});
          const metaRow = row.createDiv({ cls: "fc-sync-review-row-meta" });
          metaRow.createSpan({ text: badge[0], cls: "fc-sync-status-pill " + badge[1] });
          if (entry.reason && entry.reason !== "unsupported") row.createEl("small", { text: reasons[entry.reason] || entry.reason });
          buttons.set(entry,button);
          if (entry === selectedEntry) button.setAttribute("aria-current","true");
          button.addEventListener("click",()=>void show(entry));
        }
        shown+=40;
        more.hidden=shown>=visible.length;
      };
      const draw=()=>{
        if(!current()){modal.close();return;}
        const baseList = allChannelEntries();
        for (const [key, label] of tabDefs) {
          const btn = tabButtons.get(key);
          if (!btn) continue;
          const cnt = baseList.filter(e => matchesFilter(e, key)).length;
          btn.setText(`${label} · ${cnt}`);
          btn.classList.toggle("is-active", key === selectedStatus);
          btn.classList.toggle("is-empty", cnt === 0);
          btn.setAttribute("aria-selected", String(key === selectedStatus));
        }
        visible = baseList.filter(entry => matchesFilter(entry, selectedStatus) &&
          entry.path.toLocaleLowerCase("uk").includes(query.toLocaleLowerCase("uk")));
        shown=0;list.empty();buttons.clear();append();
        summary.setText(`Показано: ${visible.length} із ${baseList.length}`);
        if(!visible.length)list.createEl("li",{cls:"fc-sync-review-empty",text:"У цій категорії файлів немає."});
      };
      const filtersChanged = () => {
        epoch++;
        previewComponent?.unload();
        previewComponent = null;
        selectedEntry = null;
        detail.empty();
        detail.createEl("p",{text:"Оберіть файл зліва, щоб побачити кольорову різницю До / Після та керувати версіями."});
        draw();
      };
      search.addEventListener("input",()=>{query=search.value;filtersChanged();});
      select.addEventListener("change",()=>{selectedStatus=select.value;filtersChanged();});
      more.addEventListener("click",append);
      refresh.disabled=this.driveDownloading;
      refresh.addEventListener("click",()=>{modal.close();void this.startVaultDownload();});
      close.addEventListener("click",()=>modal.close());
      detail.createEl("p",{text:"Оберіть файл, щоб переглянути версії та доступні дії."});
      draw();
      if (initialEntry) void show(initialEntry);
    };
    modal.onClose=()=>{
      open=false;epoch++;
      previewComponent?.unload();
      this.syncReviewClose=null;
      this.driveClient.clearReviews();
      modal.contentEl.empty();
      if(this.dialog===modal)this.dialog=null;
      this.refreshDockViews();
    };
    modal.open();
  }

  queuePublishCheck() {
    clearTimeout(this.publishCheckTimer);
    const generation = (this.publishCheckGeneration || 0) + 1;
    this.publishCheckGeneration = generation;
    this.publishCheckTimer = setTimeout(async () => {
      if (!this.alive) return;
      const file = this.activeNote() || this.app.workspace.getActiveFile();
      const platform = this.platformNote(file);
      const baseline = platform ? this.platformPublishBaseline(file,platform) : this.driveFiles.get(file?.path);
      let change = null;
      if (file && this.accountVerified && (baseline?.kind === "platform" ? this.vaultConfig.pairedCanEdit : (baseline?.canEdit === true || this.vaultConfig.pairedCanEdit)) && !(this.liveSession?.file === file && this.liveSessionAuthorized(this.liveSession))) {
        try {
          if (baseline) {
            const editorDraft = baseline.kind === "platform" ? (await this.localNote(file)).raw : undefined;
            change = await this.driveClient.prepare(file, baseline, editorDraft);
          }
          else if (!platform) {
            const link = this.linkFor(file);
            if (link?.syncedBodyHash && (await contentHash((await this.localNote(file)).body)) !== link.syncedBodyHash) {
              change = { linked: true };
            }
          }
        } catch { /* A closed, renamed or unreadable file may be in the process of updating. */ }
      }
      if (!this.alive || generation !== this.publishCheckGeneration) return;
      const pending = change ? { file, baseline, change } : null;
      const previous = this.pendingPublish;
      this.pendingPublish = pending;
      if (Boolean(previous) !== Boolean(pending) || previous?.file !== pending?.file) this.refreshDockViews();
    }, 200);
  }

  async publishActiveChanges() {
    const pending = this.pendingPublish;
    if (!pending || !this.accountVerified || this.updater?.blocked() || this.publishingDrive || this.driveDownloading || this.reviewSyncBusy || (this.activeNote() || this.app.workspace.getActiveFile()) !== pending.file) return;
    if (pending.change.linked) {
      await this.directSaveNote(pending.file);
      this.queuePublishCheck();
      return;
    }
    this.publishingDrive = true;
    this.updateStatusBar();
    this.refreshDockViews();
    try {
      const { file, baseline } = pending;
      const editorDraft = baseline.kind === "platform" ? (await this.localNote(file)).raw : undefined;
      const change = await this.driveClient.prepare(file, baseline, editorDraft);
      if (!change || this.driveFiles.get(file.path) !== baseline) return;
      if (baseline.kind === "platform") {
        const receipt = await this.driveClient.publishPlatform(change, baseline);
        if (!/^[a-f0-9]{64}$/.test(receipt.revision)) throw new Error("Сайт не підтвердив версію.");
        const title = receipt.title === undefined ? {} : {
          title: receipt.title, heading: receipt.heading, propertyTitle: receipt.propertyTitle,
        };
        this.driveFiles.set(file.path, { ...baseline, ...title, sha256: change.sha256, version: receipt.revision });
        await this.persist();
        new Notice("Зміни опубліковано на FlightClub.");
        return;
      }
      const retry = this.drivePublishRetry;
      const requestId = retry?.fileId === baseline.fileId && retry.sha256 === change.sha256
        ? retry.requestId : crypto.randomUUID();
      this.drivePublishRetry = { fileId: baseline.fileId, sha256: change.sha256, requestId };
      const receipt = await this.driveClient.publish(change, baseline, requestId, this.vaultConfig?.revision);
      if (!receipt.stillCurrent || receipt.contentSha256 !== change.sha256 || !/^\d{1,30}$/.test(receipt.revision?.version)) {
        throw new Error("Drive уже має іншу версію. Звірте зміни.");
      }
      this.driveFiles.set(file.path, { ...baseline, sha256: change.sha256, version: receipt.revision.version });
      await this.persist();
      this.drivePublishRetry = null;
      new Notice("Зміни опубліковано в Google Drive.");
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Зміни залишилися у Vault.");
    } finally {
      this.publishingDrive = false;
      this.updateStatusBar();
      this.refreshDockViews();
      this.queuePublishCheck();
    }
  }

  async directSaveNote(file) {
    if (!file) return;
    if (this.platformNote(file)) {
      new Notice("Використайте «Відправити на сайт», щоб оновити назву й опис об’єкта.");
      return;
    }
    if (this.vaultConfig.deviceToken && !this.vaultConfig.pairedCanEdit) {
      new Notice("Ваш акаунт має доступ до читання. Для публікації потрібні права адміністратора.");
      return;
    }
    const existing = this.linkFor(file);
    if (!this.vaultConfig?.deviceToken) return this.showTransfer(file, existing?.version ? "update" : "create");
    const session = this.liveSession?.file === file ? this.liveSession : null;
    if (this.importingSlug || this.driveDownloading) { new Notice("Зачекайте завершення імпорту."); return; }
    if (session?.busy || session?.batch || session?.conflict) {
      new Notice("Зачекайте на підтвердження синхронізації або вирішіть конфлікт.");
      return;
    }
    if (this.savingNote) return;
    this.savingNote = true;
    if (session) session.busy = true;
    const token = this.vaultConfig.deviceToken, userId = this.vaultConfig.pairedUserId, path = file.path;
    const stillCurrent = () => this.alive && this.accountVerified && token === this.vaultConfig.deviceToken &&
      userId === this.vaultConfig.pairedUserId && path === file.path && this.app.vault.getAbstractFileByPath(path) === file;
    try {
      if (!stillCurrent()) throw new Error("Підтвердьте підключення FlightClub перед збереженням.");
      const local = await this.localNote(file);
      if (local.body.length > MAX_NOTE) throw new Error("Ліміт сторінки — 120 000 символів.");
      let expectedUpdatedAt = existing?.version;
      if (existing && (!expectedUpdatedAt || !/^[a-f0-9]{64}$/.test(existing.syncedBodyHash ?? ""))) {
        const response = await this.siteRequest({ url: pageUrl(existing.slug) + "?api=1&document=1", method: "GET", headers: this.authHeaders(), throw: false });
        const remote = response.json?.page;
        if (response.status !== 200 || remote?.content !== local.body || !VERSION.test(remote.updated_at)) {
          throw new Error("Ця прив’язка ще не має спільної версії. Звірте локальну нотатку зі сторінкою /m/ перед збереженням.");
        }
        expectedUpdatedAt = remote.updated_at;
      }
      const metadata = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
      const requestedSlug = typeof metadata.slug === "string" ? metadata.slug.trim().toLowerCase() : "";
      this.pendingPageCreates ??= new Map();
      const pending = this.pendingPageCreates.get(path);
      let slug = existing?.slug ?? (SLUG.test(requestedSlug) ? requestedSlug : slugFromTitle(file.basename, crypto.randomUUID()));
      if (!existing) {
        const bodyHash = await contentHash(local.body);
        if (!stillCurrent()) return;
        if (pending?.userId === userId) {
          slug = pending.slug;
          const lookup = await this.siteRequest({url:pageUrl(slug)+"?api=1&document=1",method:"GET",headers:this.authHeaders(),throw:false});
          if (!stillCurrent()) return;
          const remote = lookup.json?.page;
          if (lookup.status === 200 && lookup.json?.ok === true) {
            if (remote?.slug !== slug || remote.obsidian_path !== (pending.sourcePath ?? path) || !VERSION.test(remote.updated_at) ||
                typeof remote.content !== "string" || await contentHash(remote.content) !== pending.bodyHash) {
              throw new Error("Адреса вже зайнята або серверна чернетка змінилася. Звірте сторінку перед повтором.");
            }
            if (!stillCurrent()) return;
            await this.rememberBaseline(file,remote,stillCurrent);
            if (!stillCurrent()) return;
            this.pendingPageCreates.delete(path);
            await this.persist();
            this.queuePublishCheck();
            this.attachLiveSessionToActiveNote(file);
            this.refreshDockViews();
            new Notice("Підтверджено створену сторінку " + pageUrl(slug));
            return;
          }
          if (lookup.status !== 404) throw new Error("Сайт ще не підтвердив результат. Повторіть перевірку.");
        }
        this.pendingPageCreates.set(path,{userId,slug,bodyHash,sourcePath:path.trim().slice(0,240)});
        await this.persist();
      }
      const existingDriveId = this.resolveDriveIdForFile(file);
      const page = { slug, content: local.body, obsidian_path: path, ...(existingDriveId ? { drive_file_id: existingDriveId } : {}) };
      if (!existing) {
        page.title = typeof metadata.title === "string" && metadata.title.trim() ? metadata.title : file.basename;
        page.category = typeof metadata.category === "string" && metadata.category.trim() ? metadata.category : "Obsidian";
        page.is_published = false;
      }
      if (!stillCurrent()) return;
      const result = await this.sitePost(slug, { action: "save", write: existing ? "update" : "create",
        expectedUpdatedAt, clientId: this.clientId, source: this.sourceKind, page });
      if (result.status !== 200 || result.json?.ok !== true || !result.json.page) {
        throw new Error(result.json?.error || "Сайт не підтвердив збереження.");
      }
      if (!stillCurrent()) return;
      const saved = result.json.page;
      if (saved.slug !== slug || typeof saved.content !== "string" || !VERSION.test(saved.updated_at)) {
        throw new Error("Сайт не підтвердив редакцію. Повторіть перевірку.");
      }
      await this.rememberBaseline(file, saved, stillCurrent);
      if (!stillCurrent()) return;
      this.upsertRemoteCatalogPage(saved);
      await this.ensureNoteYamlProperties(file, {
        ...(existingDriveId ? {
          site_url: FC_YAML_PROPS.siteVaultEditUrl(SITE, existingDriveId),
          drive_url: FC_YAML_PROPS.driveViewUrl(existingDriveId),
        } : { site_url: `${pageUrl(saved.slug)}?edit=1` }),
        share_url: pageUrl(saved.slug),
        slug: saved.slug,
        roles: saved.target_roles ?? [],
        public: Boolean(saved.is_public),
      }).catch(() => {});
      if (this.pendingPageCreates.delete(path)) await this.persist();
      if (session && this.liveSession === session) {
        session.base = saved.content;
        session.revision = saved.updated_at;
      }
      this.attachLiveSessionToActiveNote(file);
      this.refreshDockViews();
      new Notice(existing ? "Збережено " + pageUrl(slug) : "Створено чернетку " + pageUrl(slug) + ". Налаштуйте публікацію на сайті.");
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Не вдалося зберегти сторінку.");
    } finally {
      this.savingNote = false;
      if (session) session.busy = false;
    }
  }

  async importSitePage(page, stillCurrent = () => this.alive) {
    if (!this.alive || !page || !SLUG.test(page.slug) || !VERSION.test(page.updated_at) || typeof page.content !== "string" || page.content.length > MAX_NOTE) {
      throw new Error("Сайт повернув некоректну версію сторінки.");
    }
    if (!stillCurrent()) throw new Error("Підключення змінилося. Повторіть імпорт.");
    const linked = this.app.vault.getMarkdownFiles().filter((file) =>
      file?.path && !file.path.startsWith("FlightClub Sync Archive/") && this.linkFor(file)?.slug === page.slug
    );
    if (linked.length > 1) throw new Error("Кілька нотаток мають цю адресу /m/. Залиште одну прив’язку.");
    const root = this.vaultConfig.localVaultRoot;
    const segments = root ? root.split("/") : [];
    if (segments.some((part) => !part || part.startsWith(".") || /[\\:\x00-\x1f]/.test(part))) throw new Error("Вкажіть коректну папку у Vault.");
    const path = [...segments, page.slug + ".md"].join("/");
    let file = linked[0] || this.app.vault.getAbstractFileByPath(path);
    if (file) {
      if (!(file instanceof TFile)) throw new Error("За шляхом нотатки вже існує папка.");
      const link = this.linkFor(file);
      if (link?.slug !== page.slug) return { file, conflict: true };
      if ([link.version,link.observedRemoteRevision].some(version => version && version > page.updated_at)) return { file, conflict: true };
      const local = await this.localNote(file);
      if (!stillCurrent()) throw new Error("Підключення змінилося. Повторіть імпорт.");
      if (this.liveSession?.file === file) return { file, conflict: local.body !== page.content };
      if (local.body !== page.content) {
        if (this.driveFiles?.has(file.path) || !link.syncedBodyHash || await contentHash(local.body) !== link.syncedBodyHash) {
          return { file, conflict: true };
        }
        const canApply = () => stillCurrent() && this.liveSession?.file !== file && this.linkFor(file) === link;
        if (!await this.applyNoteContent(file, local, page.content, canApply)) return { file, conflict: true };
        this.recordUnreviewedSiteUpdate(file.path, {
          count: 1,
          summary: `Оновлено сторінку /m/${page.slug} із сайту`,
          ...summarizeUpdateText(local.body, page.content),
          kind: "page",
        });
      }
      if (file) {
        const mappedId = this.resolveDriveIdForFile(file) || (DRIVE_ID.test(page.drive_file_id || "") ? page.drive_file_id : null);
        await this.ensureNoteYamlProperties(file, {
          ...(mappedId ? {
            site_url: FC_YAML_PROPS.siteVaultEditUrl(SITE, mappedId),
            drive_url: FC_YAML_PROPS.driveViewUrl(mappedId),
          } : {}),
          share_url: pageUrl(page.slug),
          slug: page.slug,
          roles: page.target_roles ?? [],
          public: Boolean(page.is_public),
        }).catch(() => {});
      }
    } else {
      let parent = "";
      for (const segment of segments) {
        parent += (parent ? "/" : "") + segment;
        if (!stillCurrent()) throw new Error("Підключення змінилося. Повторіть імпорт.");
        if (!this.app.vault.getAbstractFileByPath(parent)) await this.app.vault.createFolder(parent);
      }
      const mappedId = DRIVE_ID.test(page.drive_file_id || "") ? page.drive_file_id : null;
      const frontmatterLines = [
        "---",
        ...(mappedId ? [
          "site_url: " + JSON.stringify(FC_YAML_PROPS.siteVaultEditUrl(SITE, mappedId)),
          "drive_url: " + JSON.stringify(FC_YAML_PROPS.driveViewUrl(mappedId)),
        ] : ["site_url: " + JSON.stringify(pageUrl(page.slug) + "?edit=1")]),
        "share_url: " + JSON.stringify(pageUrl(page.slug)),
        "slug: " + JSON.stringify(page.slug),
        "title: " + JSON.stringify(page.title || page.slug),
        ...(Array.isArray(page.target_roles) ? ["roles: [" + page.target_roles.join(", ") + "]"] : []),
        ...(typeof page.is_public === "boolean" ? ["public: " + String(page.is_public)] : []),
        "url: " + JSON.stringify(pageUrl(page.slug)),
        "---",
        "",
      ];
      const frontmatter = frontmatterLines.join("\n");
      if (!stillCurrent()) throw new Error("Підключення змінилося. Повторіть імпорт.");
      file = await this.app.vault.create(path, frontmatter + page.content);
    }
    await this.rememberBaseline(file, page, stillCurrent);
    return { file, conflict: false };
  }

  async openSitePageInObsidian(slug) {
    if (!this.alive || !SLUG.test(slug) || this.importingSlug || this.savingNote) return null;
    if (this.links) {
      for (const [p, link] of this.links.entries()) {
        if (link?.slug === slug) {
          const found = this.app?.vault?.getAbstractFileByPath?.(p);
          if (found instanceof TFile) {
            const leaf = this.app.workspace.getLeaf?.(false) || this.app.workspace.getLeaf?.();
            if (leaf?.openFile) await leaf.openFile(found, { active: true });
            return found;
          }
        }
      }
    }
    if (this.driveDownloading) { new Notice("Зачекайте завершення імпорту Vault."); return null; }
    if (!this.vaultConfig.deviceToken) {
      this.pendingImport = slug;
      void this.startPairingFlow();
      return null;
    }
    const catMatch = Array.isArray(this.remoteCatalog) ? this.remoteCatalog.find(p => p?.slug === slug) : null;
    if (catMatch?.drive_file_id && DRIVE_ID.test(catMatch.drive_file_id)) {
      const liveDriveFile = this.findLiveDriveFile(catMatch.drive_file_id, catMatch.obsidian_path);
      if (liveDriveFile) {
        const opened = await this.openDriveFileInObsidian(catMatch.drive_file_id, liveDriveFile.path);
        this.refreshDockViews();
        return opened;
      }
    }
    this.importingSlug = slug;
    const token = this.vaultConfig.deviceToken;
    const stillCurrent = () => this.alive && this.vaultConfig.deviceToken === token;
    try {
      const response = await this.siteRequest({ url: pageUrl(slug) + "?api=1&document=1", method: "GET", headers: this.authHeaders(), throw: false });
      if (response.status !== 200 || response.json?.ok !== true || response.json.page?.slug !== slug) throw new Error("Не вдалося прочитати сторінку FlightClub.");
      const remotePage = response.json.page;
      if (remotePage.drive_file_id && DRIVE_ID.test(remotePage.drive_file_id)) {
        const liveDriveFile = this.findLiveDriveFile(remotePage.drive_file_id, remotePage.obsidian_path);
        if (liveDriveFile) {
          if (!stillCurrent()) return null;
          const opened = await this.openDriveFileInObsidian(remotePage.drive_file_id, liveDriveFile.path);
          this.refreshDockViews();
          return opened;
        }
      }
      const result = await this.importSitePage(remotePage, stillCurrent);
      if (!stillCurrent()) return null;
      await this.app.workspace.getLeaf(false).openFile(result.file, { active: true });
      if (result.conflict) new Notice("Локальна нотатка має зміни. Її відкрито для звірки версій.");
      this.refreshDockViews();
      return result.file;
    } catch (error) {
      if (stillCurrent()) new Notice(error instanceof Error ? error.message : "Не вдалося відкрити сторінку.");
      return null;
    } finally { this.importingSlug = null; }
  }

  async pullPagesFromSite({ quiet = false, shouldContinue = () => true } = {}) {
    if (!this.vaultConfig.deviceToken || this.importingSlug || this.savingNote) {
      if (!this.vaultConfig.deviceToken) new Notice("Підключіть акаунт FlightClub.");
      return;
    }
    this.importingSlug = "all";
    const token = this.vaultConfig.deviceToken;
    const stillCurrent = () => this.alive && this.vaultConfig.deviceToken === token && shouldContinue();
    try {
      const response = await this.siteRequest({ url: SITE + "/m/obsidian-sync?obsidian=index-v1&full=1",
        method: "GET", headers: this.authHeaders(), throw: false });
      if (response.status !== 200 || response.json?.ok !== true || response.json?.authenticated !== true) throw new Error("Сайт не підтвердив доступ до сторінок.");
      let synced = 0, conflicts = 0, skipped = 0;
      const seen = new Set();
      for (const page of response.json.pages || []) {
        if (!stillCurrent()) break;
        if (seen.has(page?.slug)) continue;
        seen.add(page?.slug);
        try {
          const result = await this.importSitePage(page, stillCurrent);
          if (result.conflict) conflicts++; else synced++;
        } catch { skipped++; }
      }
      if (!stillCurrent()) return;
      await this.persist();
      if (!stillCurrent()) return;
      this.pagesDownloadStatus = "Сторінки /m/: " + synced + (conflicts ? " · конфліктів " + conflicts : "") + (skipped ? " · пропущено " + skipped : "") + ".";
      this.refreshDockViews();
      if (!quiet) new Notice(this.pagesDownloadStatus);
    } catch (error) {
      if (!stillCurrent()) return;
      this.pagesDownloadStatus = error instanceof Error ? error.message : "Не вдалося імпортувати сторінки /m/.";
      this.refreshDockViews();
      if (!quiet) new Notice(this.pagesDownloadStatus);
    }
    finally { this.importingSlug = null; }
  }

  renderHistoryPanel(container, file, link, opts = {}) {
    const showTitle = opts.showTitle !== false;
    const doc = container.ownerDocument || document;
    const headerRow = container.createDiv({ cls: "fc-history-head" + (showTitle ? "" : " is-compact") });
    const titleWrap = headerRow.createDiv({ cls: "fc-history-head-title" });
    if (showTitle) titleWrap.createEl("h4", { text: "Історія змін", cls: "fc-deck-title" });
    const status = titleWrap.createDiv({ cls: "fc-deck-sub", attr: { role: "status" } });
    const baseline = this.driveFiles?.get(file?.path);
    const HISTORY_CACHE_TTL = 45_000;
    const driveCache = (this._driveHistoryCache ??= new Map());
    const siteCache = (this._siteHistoryCache ??= new Map());
    const readCache = (cache, key) => {
      const hit = cache.get(key);
      if (!hit) return null;
      if (Date.now() - hit.at > HISTORY_CACHE_TTL) { cache.delete(key); return null; }
      return hit.data;
    };
    const writeCache = (cache, key, data) => {
      if (cache.size > 30) {
        const oldest = cache.keys().next().value;
        if (oldest) cache.delete(oldest);
      }
      cache.set(key, { at: Date.now(), data });
    };
    const clearCachePrefix = (cache, prefix) => {
      for (const k of cache.keys()) {
        if (k === prefix || k.startsWith(`${prefix}::`)) cache.delete(k);
      }
    };
    const renderSkeleton = (parent, rows = 3) => {
      const skel = parent.createDiv({ cls: "fc-history-skeleton", attr: { role: "status", "aria-label": "Завантаження ревізій…" } });
      for (let i = 0; i < rows; i++) skel.createDiv({ cls: "fc-history-skel-bar" });
      return skel;
    };
    const makeBtnWithIcon = (parent, iconKind, label, cls, attr = {}) => {
      const btn = parent.createEl("button", { cls, attr: { type: "button", ...attr } });
      const svg = fcGraphIconSvg(iconKind, doc, 13);
      if (svg) btn.append(svg);
      const lblSpan = btn.createSpan({ text: label, cls: "fc-history-btn-lbl" });
      return { btn, lblSpan };
    };

    const appendDiffRow = (diffWrap, row) => {
      const doc = diffWrap.ownerDocument;
      const lineEl = doc.createElement("div");
      lineEl.className = `fc-diff-line is-${row.kind}`;
      const gutter = doc.createElement("span");
      gutter.className = "fc-diff-gutter";
      gutter.textContent = row.kind === "add" ? String(row.newLine ?? "") : row.kind === "del" ? String(row.oldLine ?? "") : String(row.newLine ?? row.oldLine ?? "");
      const sign = doc.createElement("span");
      sign.className = "fc-diff-sign";
      sign.textContent = row.kind === "add" ? "+" : row.kind === "del" ? "−" : " ";
      const code = doc.createElement("span");
      code.className = "fc-diff-code";
      if (Array.isArray(row.segments) && row.segments.length) {
        for (const seg of row.segments) {
          if (seg.type === "add" || seg.type === "del") {
            const mark = doc.createElement("mark");
            mark.className = seg.type === "add" ? "fc-diff-mark-add" : "fc-diff-mark-del";
            mark.textContent = seg.text;
            code.append(mark);
          } else {
            code.append(doc.createTextNode(seg.text));
          }
        }
      } else {
        code.textContent = row.text || " ";
      }
      lineEl.append(gutter, sign, code);
      diffWrap.append(lineEl);
      return lineEl;
    };

    const renderLocalArchiveSection = (parentEl, targetFile) => {
      if (!targetFile?.basename || typeof this.app?.vault?.getFiles !== "function") return 0;
      const stemLower = String(targetFile.basename).toLowerCase();
      const archived = this.app.vault.getFiles()
        .filter(f => isSyncArchivePath(f.path) && String(f.basename || "").toLowerCase().includes(stemLower))
        .sort((a, b) => (b.stat?.mtime || 0) - (a.stat?.mtime || 0))
        .slice(0, 10);
      if (!archived.length) return 0;
      const details = parentEl.createEl("details", { cls: "fc-history-archive-box" });
      details.createEl("summary", { text: `Локальні резервні копії Sync Archive (${archived.length})` });
      const ul = details.createEl("ul", { cls: "fc-history-list fc-history-archive-list" });
      const fmt = new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
      for (const af of archived) {
        const li = ul.createEl("li", { cls: "fc-deck-row fc-history-archive-row" });
        const meta = li.createDiv({ cls: "fc-deck-row-info" });
        meta.createSpan({ text: af.basename, cls: "fc-deck-row-title", attr: { title: af.path } });
        if (af.stat?.mtime) {
          meta.createSpan({ text: fmt.format(new Date(af.stat.mtime)), cls: "fc-deck-row-meta" });
        }
        const openBtn = li.createEl("button", { text: "Відкрити", cls: "fc-row-action-btn", attr: { type: "button" } });
        openBtn.addEventListener("click", async () => {
          const leaf = this.app.workspace.getLeaf?.(false) || this.app.workspace.getLeaf?.();
          if (leaf?.openFile) await leaf.openFile(af, { active: true });
        });
      }
      return archived.length;
    };

    if (baseline?.kind === "platform" && baseline.canEdit) {
      status.setText("Завантажуємо публікації з Obsidian…");
      const list = container.createEl("ul", { cls: "fc-history-list" });
      void this.driveClient.platformHistory(baseline).then(({entries}) => {
        if (!list.isConnected || !this.alive) return;
        status.setText(entries.length ? "Останні публікації з Obsidian" : "Публікацій з Obsidian ще немає.");
        for (const entry of entries) {
          const row = list.createEl("li", { cls: "fc-deck-row" });
          row.createEl("span", { text: (entry.summary || "Оновлення") + " · " + new Date(entry.created_at).toLocaleString("uk-UA") });
          const actor = userProfileUrl(entry.actor_id);
          if (actor) row.createEl("a", { text: "Автор", attr: { href: actor, target: "_blank", rel: "noopener noreferrer" } });
        }
      }).catch(error => { if (status.isConnected) status.setText(error.message); });
      renderLocalArchiveSection(container, file);
      return;
    }

    const driveId = file ? this.resolveDriveIdForFile?.(file) : null;
    if (file && driveId && !link) {
      const headBtns = headerRow.createDiv({ cls: "fc-history-head-actions" });
      const { btn: docsBtn } = makeBtnWithIcon(headBtns, "open", "Docs", "fc-deck-btn fc-history-refresh", { title: "Відкрити у Google Docs / Drive" });
      docsBtn.addEventListener("click", () => this.openSite(driveOpenUrlForPath(driveId, file?.path)));
      const { btn: refresh } = makeBtnWithIcon(headBtns, "refresh", "Оновити", "fc-deck-btn fc-history-refresh", { "data-fc-history-refresh": "" });
      const list = container.createEl("ul", { cls: "fc-history-list", attr: { "aria-label": "Ревізії Google Drive" } });
      const preview = container.createDiv({ cls: "fc-history-preview" });
      const historyEndpoint = `${SITE}/m/obsidian-sync?obsidian=drive-history-v1&fileId=${encodeURIComponent(driveId)}`;
      const sourceLabels = { flightclub: "FlightClub", google_drive: "Google Drive", snapshot: "Знімок" };
      let epoch = 0, previewEpoch = 0;
      let selectedId = null;
      let diffMode = "vs-current";
      let wrapLines = true;
      const rowButtons = new Map();

      const readDriveHistory = async (snapshotId = "", { force = false } = {}) => {
        const cacheKey = snapshotId ? `${driveId}::${snapshotId}` : driveId;
        if (!force) {
          const hit = readCache(driveCache, cacheKey);
          if (hit) return hit;
        }
        const reqUrl = snapshotId ? `${historyEndpoint}&snapshotId=${encodeURIComponent(snapshotId)}` : historyEndpoint;
        const response = await this.siteRequest({ url: reqUrl, method: "GET", headers: this.authHeaders(), throw: false });
        if (response.status !== 200 || response.json?.ok !== true) {
          throw new Error(response.json?.error || "Історія Google Drive недоступна. Перевірте підключення FlightClub.");
        }
        writeCache(driveCache, cacheKey, response.json);
        return response.json;
      };

      const renderDriveDiff = (entry, history, data, localContent) => {
        preview.empty();
        const snapText = typeof data.content === "string" ? data.content : "";
        const currentText = typeof localContent === "string" ? localContent : (typeof data.currentContent === "string" ? data.currentContent : snapText);
        const head = preview.createDiv({ cls: "fc-history-diff-head" });
        const titleBlock = head.createDiv({ cls: "fc-history-diff-title" });
        titleBlock.createEl("strong", { text: `${entry.actorName || "Google Drive"}${entry.afterVersion ? ` · v${entry.afterVersion}` : ""}` });
        if (entry.label) {
          titleBlock.createDiv({ cls: "fc-history-meta-diff", text: entry.label });
        }

        const tabs = preview.createDiv({ cls: "fc-history-tabs", attr: { role: "tablist" } });
        for (const tab of [
          { id: "vs-current", label: "З поточною" },
          { id: "raw", label: "Повний текст" },
        ]) {
          const btn = tabs.createEl("button", {
            text: tab.label,
            cls: "fc-history-tab" + (diffMode === tab.id ? " is-active" : ""),
            attr: { type: "button", role: "tab", "aria-selected": String(diffMode === tab.id) },
          });
          btn.addEventListener("click", () => {
            diffMode = tab.id;
            renderDriveDiff(entry, history, data, localContent);
          });
        }

        if (diffMode === "raw") {
          preview.createEl("pre", { text: snapText, cls: "fc-history-raw", attr: { tabindex: "0", "aria-label": "Вміст ревізії" } });
        } else {
          const diff = FC_MARKDOWN_DIFF.diffMarkdownLines(snapText, currentText, { context: 2 });
          const summary = preview.createDiv({ cls: "fc-history-diff-summary" });
          summary.createEl("span", { text: "Відмінності від поточної локальної нотатки", cls: "fc-history-diff-scope" });
          if (diff.identical) {
            summary.createEl("span", { text: "Ідентично", cls: "fc-history-pill is-neutral" });
            preview.createDiv({ cls: "fc-history-identical", text: "Ця ревізія повністю збігається з поточним текстом у вашому Obsidian." });
          } else {
            const summaryRight = summary.createDiv({ cls: "fc-history-stat-badges" });
            if (diff.addedLines > 0) summaryRight.createEl("span", { text: `+${diff.addedLines}`, cls: "fc-history-pill is-add" });
            if (diff.removedLines > 0) summaryRight.createEl("span", { text: `−${diff.removedLines}`, cls: "fc-history-pill is-del" });
            const { btn: wrapBtn } = makeBtnWithIcon(summaryRight, "wrap", "Перенос", "fc-history-wrap-btn" + (wrapLines ? " is-active" : ""), {
              "aria-pressed": String(wrapLines),
              title: "Переносити довгі рядки й посилання",
            });
            const diffWrap = preview.createDiv({ cls: "fc-diff-view" + (wrapLines ? "" : " is-nowrap"), attr: { tabindex: "0", "aria-label": "Порівняння змін" } });
            wrapBtn.addEventListener("click", () => {
              wrapLines = !wrapLines;
              wrapBtn.classList.toggle("is-active", wrapLines);
              wrapBtn.setAttribute("aria-pressed", String(wrapLines));
              diffWrap.classList.toggle("is-nowrap", !wrapLines);
            });
            for (const block of diff.blocks) {
              if (block.type === "collapsed") {
                const foldBtn = diffWrap.createEl("button", {
                  type: "button",
                  cls: "fc-diff-fold",
                  text: `··· Показати ${block.count} незмінених рядків ···`,
                });
                foldBtn.addEventListener("click", () => {
                  const frag = diffWrap.ownerDocument.createDocumentFragment();
                  const tmp = diffWrap.ownerDocument.createElement("div");
                  for (const line of block.lines) appendDiffRow(tmp, line);
                  while (tmp.firstChild) frag.appendChild(tmp.firstChild);
                  foldBtn.replaceWith(frag);
                });
              } else {
                appendDiffRow(diffWrap, block);
              }
            }
          }
        }

        const actions = preview.createDiv({ cls: "fc-history-actions" });
        if (history.canRestore && snapText !== currentText) {
          const restore = actions.createEl("button", { text: "↩ Відновити версію", cls: "mod-cta fc-deck-btn", attr: { type: "button" } });
          restore.addEventListener("click", () => this.dialogForm({
            title: "Відновити ревізію Google Drive",
            description: "Поточна версія буде автоматично збережена в «FlightClub Sync Archive», а вибрана ревізія записана в нотатку та надіслана у Google Drive.",
            button: "Відновити",
            submit: async () => {
              const prevLocal = await this.app.vault.read(file).catch(() => "");
              try {
                if (typeof this.app.vault.createFolder === "function" && !this.app.vault.getAbstractFileByPath(SYNC_ARCHIVE_PREFIX)) {
                  await this.app.vault.createFolder(SYNC_ARCHIVE_PREFIX).catch(() => {});
                }
                const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
                const ext = file.extension || "md";
                const backupPath = `${SYNC_ARCHIVE_PREFIX}/${file.basename} · backup-${stamp}.${ext}`;
                if (typeof this.app.vault.create === "function" && prevLocal) {
                  await this.app.vault.create(backupPath, prevLocal).catch(() => {});
                }
              } catch {}
              await this.app.vault.modify(file, snapText);
              this.dirtyDriveFiles?.add?.(file.path);
              if (typeof this.pushActiveFileToDrive === "function") {
                await this.pushActiveFileToDrive(file).catch(() => {});
              }
              new Notice("Ревізію відновлено (резервну копію збережено у Sync Archive).");
              clearCachePrefix(driveCache, driveId);
              void loadDriveHistory(true);
            },
          }));
        }
        const { btn: copyBtn, lblSpan: copyLbl } = makeBtnWithIcon(actions, "copy", "Копіювати", "fc-deck-btn fc-history-copy-btn");
        copyBtn.addEventListener("click", async () => {
          try {
            await navigator.clipboard?.writeText(snapText);
            copyBtn.classList.add("is-copied");
            copyLbl.setText("✓ Скопійовано");
            setTimeout(() => {
              if (copyBtn.isConnected) {
                copyBtn.classList.remove("is-copied");
                copyLbl.setText("Копіювати");
              }
            }, 1600);
            new Notice("Текст ревізії скопійовано.");
          } catch {
            new Notice("Буфер обміну недоступний.");
          }
        });
      };

      const showDriveEntry = async (entry, history) => {
        const expected = ++previewEpoch;
        selectedId = entry.id;
        for (const [id, btn] of rowButtons) btn.classList.toggle("is-selected", id === selectedId);
        const snapCached = Boolean(readCache(driveCache, `${driveId}::${entry.id}`));
        if (!snapCached) {
          preview.empty();
          renderSkeleton(preview, 3);
        }
        try {
          const [data, localRaw] = await Promise.all([
            readDriveHistory(entry.id),
            this.app.vault.read(file).catch(() => null),
          ]);
          if (!container.isConnected || expected !== previewEpoch) return;
          renderDriveDiff(entry, history, data, localRaw);
        } catch (error) {
          if (expected === previewEpoch) {
            preview.empty();
            status.setText(error instanceof Error ? error.message : "Ревізію не завантажено.");
          }
        }
      };

      const loadDriveHistory = async (force = false) => {
        const generation = ++epoch;
        previewEpoch++;
        selectedId = null;
        rowButtons.clear();
        preview.empty(); list.empty();
        if (force || !readCache(driveCache, driveId)) renderSkeleton(list, 3);
        status.setText("Завантажуємо ревізії Google Drive…");
        try {
          const history = await readDriveHistory("", { force });
          if (!container.isConnected || generation !== epoch) return;
          list.empty();
          const entries = Array.isArray(history.entries) ? history.entries : [];
          status.setText(
            entries.length
              ? `Google Drive · ревізій: ${entries.length}${history.currentVersion ? ` (v${history.currentVersion})` : ""}`
              : "Історія ревізій у Google Drive ще порожня.",
          );
          const time = new Intl.DateTimeFormat("uk-UA", {
            timeZone: "Europe/Kyiv", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
          });
          for (let idx = 0; idx < entries.length; idx++) {
            const entry = entries[idx];
            const row = list.createEl("li");
            const button = row.createEl("button", { cls: "fc-history-row", attr: { type: "button", "data-fc-drive-rev": entry.id } });
            rowButtons.set(entry.id, button);
            const topLine = button.createDiv({ cls: "fc-history-row-top" });
            topLine.createEl("strong", { text: entry.actorName || "Google Drive" });
            const badges = topLine.createDiv({ cls: "fc-history-row-badges" });
            if (entry.isCurrent) {
              badges.createEl("span", { text: "Поточна", cls: "fc-history-pill is-current" });
            } else if (entry.afterVersion || entry.beforeVersion) {
              badges.createEl("span", { text: `v${entry.afterVersion || entry.beforeVersion}`, cls: "fc-history-pill is-neutral" });
            } else {
              badges.createEl("span", { text: `#${entries.length - idx}`, cls: "fc-history-pill is-neutral" });
            }
            if (entry.source && sourceLabels[entry.source]) {
              badges.createEl("span", { text: sourceLabels[entry.source], cls: "fc-history-pill is-neutral" });
            }
            const whenStr = entry.createdAt && Number.isFinite(Date.parse(entry.createdAt))
              ? time.format(new Date(entry.createdAt))
              : "час невідомий";
            const sizeStr = entry.size ? ` · ${Math.max(1, Math.round(entry.size / 1024))} КБ` : "";
            button.createEl("small", { text: `${whenStr}${sizeStr}` });
            button.addEventListener("click", () => {
              diffMode = "vs-current";
              void showDriveEntry(entry, history);
            });
          }
          // Auto-open the first previous revision (or current) for immediate diff visibility
          const autoEntry = entries.find(e => !e.isCurrent) || entries[0];
          if (autoEntry) void showDriveEntry(autoEntry, history);
        } catch (error) {
          if (generation === epoch && status.isConnected) {
            status.setText(error instanceof Error ? error.message : "Історія Google Drive недоступна.");
          }
        }
      };

      refresh.addEventListener("click", () => {
        clearCachePrefix(driveCache, driveId);
        void loadDriveHistory(true);
      });
      void loadDriveHistory();
      renderLocalArchiveSection(container, file);
      return;
    }

    if (!file) {
      status.setText("Відкрийте нотатку .md, .canvas або .base, щоб переглянути історію змін.");
      return;
    }
    if (!link) {
      const archiveCount = renderLocalArchiveSection(container, file);
      status.setText(
        archiveCount
          ? "Файл локальний (ще не в Google Drive) — доступні резервні копії Sync Archive."
          : "Ця нотатка ще не синхронізована з Google Drive або /m/. Збережіть її у папці Drive, щоб з’явилась історія ревізій.",
      );
      return;
    }
    const { btn: refresh } = makeBtnWithIcon(headerRow, "refresh", "Оновити", "fc-deck-btn fc-history-refresh", { "data-fc-history-refresh": "" });
    const list = container.createEl("ul", { cls: "fc-history-list", attr: { "aria-label": "Версії сторінки" } });
    const preview = container.createDiv({ cls: "fc-history-preview" });
    const url = pageUrl(link.slug) + "?api=1&history=1";
    const labels = { baseline: "База", save: "Збереження", edit: "Правка", restore: "Відкат" };
    let epoch = 0, previewEpoch = 0, receipt = null;
    let selectedRev = null;
    let diffMode = "vs-current";
    let wrapLines = true;
    const rowButtons = new Map();

    const read = async (suffix = "", { force = false } = {}) => {
      const cacheKey = suffix ? `${link.slug}::${suffix}` : link.slug;
      if (!force) {
        const hit = readCache(siteCache, cacheKey);
        if (hit) return hit;
      }
      const response = await this.siteRequest({ url: url + suffix, method: "GET", headers: this.authHeaders(), throw: false });
      if (response.status !== 200 || response.json?.ok !== true) throw new Error("Історія недоступна. Перевірте підключення FlightClub.");
      writeCache(siteCache, cacheKey, response.json);
      return response.json;
    };

    const renderDiffPayload = (entry, history, data, localBody) => {
      preview.empty();
      const snapshot = data.snapshot;
      const previousSnapshot = data.previousSnapshot || null;
      const serverCurrent = data.currentSnapshot || { title: snapshot.title, content: localBody ?? snapshot.content };
      const currentBody = typeof localBody === "string" ? localBody : serverCurrent.content;
      const isCurrent = entry.revision === history.currentRevision;
      if (diffMode === "this-edit" && !previousSnapshot) diffMode = "vs-current";
      if (isCurrent && diffMode === "vs-current" && previousSnapshot) diffMode = "this-edit";

      const head = preview.createDiv({ cls: "fc-history-diff-head" });
      const titleBlock = head.createDiv({ cls: "fc-history-diff-title" });
      titleBlock.createEl("strong", { text: snapshot.title || file.basename });
      if (serverCurrent.title && serverCurrent.title !== snapshot.title) {
        titleBlock.createDiv({ cls: "fc-history-meta-diff", text: `Заголовок: «${snapshot.title}» → «${serverCurrent.title}»` });
      }
      if (entry.pathChange) {
        titleBlock.createDiv({
          cls: "fc-history-meta-diff",
          text: "Шлях · " + (entry.pathChange.from ?? "Без прив’язки") + " → " + (entry.pathChange.to ?? "Без прив’язки"),
        });
      }

      const tabs = preview.createDiv({ cls: "fc-history-tabs", attr: { role: "tablist" } });
      const tabDefs = [
        { id: "vs-current", label: "З поточною", disabled: false },
        { id: "this-edit", label: "Ця правка", disabled: !previousSnapshot },
        { id: "raw", label: "Повний текст", disabled: false },
      ];
      for (const tab of tabDefs) {
        const btn = tabs.createEl("button", {
          text: tab.label,
          cls: "fc-history-tab" + (diffMode === tab.id ? " is-active" : ""),
          attr: { type: "button", role: "tab", "aria-selected": String(diffMode === tab.id) },
        });
        btn.disabled = tab.disabled;
        btn.addEventListener("click", () => {
          diffMode = tab.id;
          renderDiffPayload(entry, history, data, localBody);
        });
      }

      if (diffMode === "raw") {
        preview.createEl("pre", { text: snapshot.content, cls: "fc-history-raw", attr: { tabindex: "0", "aria-label": "Вміст версії" } });
      } else {
        const oldText = diffMode === "this-edit" ? (previousSnapshot?.content ?? "") : snapshot.content;
        const newText = diffMode === "this-edit" ? snapshot.content : currentBody;
        const diff = FC_MARKDOWN_DIFF.diffMarkdownLines(oldText, newText, { context: 2 });
        const summary = preview.createDiv({ cls: "fc-history-diff-summary" });
        const scopeLabel = diffMode === "this-edit" ? "Змінено у цій ревізії" : "Відмінності від поточної версії";
        summary.createEl("span", { text: scopeLabel, cls: "fc-history-diff-scope" });
        let wrapBtn = null;
        if (diff.identical) {
          summary.createEl("span", { text: "Ідентично", cls: "fc-history-pill is-neutral" });
        } else {
          const summaryRight = summary.createDiv({ cls: "fc-history-stat-badges" });
          if (diff.addedLines > 0) summaryRight.createEl("span", { text: `+${diff.addedLines}`, cls: "fc-history-pill is-add" });
          if (diff.removedLines > 0) summaryRight.createEl("span", { text: `−${diff.removedLines}`, cls: "fc-history-pill is-del" });
          wrapBtn = makeBtnWithIcon(summaryRight, "wrap", "Перенос", "fc-history-wrap-btn" + (wrapLines ? " is-active" : ""), {
            "aria-pressed": String(wrapLines),
            title: "Переносити довгі рядки й посилання",
          }).btn;
        }

        if (diff.identical) {
          preview.createDiv({
            cls: "fc-history-identical",
            text: diffMode === "this-edit"
              ? "Текст у цій ревізії не змінювався (змінено лише метадані або шлях)."
              : "Ця версія повністю збігається з поточним текстом документа.",
          });
        } else {
          const diffWrap = preview.createDiv({ cls: "fc-diff-view" + (wrapLines ? "" : " is-nowrap"), attr: { tabindex: "0", "aria-label": "Порівняння змін" } });
          if (wrapBtn) {
            wrapBtn.addEventListener("click", () => {
              wrapLines = !wrapLines;
              wrapBtn.classList.toggle("is-active", wrapLines);
              wrapBtn.setAttribute("aria-pressed", String(wrapLines));
              diffWrap.classList.toggle("is-nowrap", !wrapLines);
            });
          }
          for (const block of diff.blocks) {
            if (block.type === "collapsed") {
              const foldBtn = diffWrap.createEl("button", {
                type: "button",
                cls: "fc-diff-fold",
                text: `··· Показати ${block.count} незмінених рядків ···`,
              });
              foldBtn.addEventListener("click", () => {
                const frag = diffWrap.ownerDocument.createDocumentFragment();
                const tmp = diffWrap.ownerDocument.createElement("div");
                for (const line of block.lines) appendDiffRow(tmp, line);
                while (tmp.firstChild) frag.appendChild(tmp.firstChild);
                foldBtn.replaceWith(frag);
              });
            } else {
              appendDiffRow(diffWrap, block);
            }
          }
        }
      }

      const actions = preview.createDiv({ cls: "fc-history-actions" });
      if (history.canRestore && !isCurrent) {
        const restore = actions.createEl("button", { text: "↩ Відновити версію", cls: "mod-cta fc-deck-btn", attr: { type: "button" } });
        restore.addEventListener("click", () => this.dialogForm({
          title: "Відновити версію", description: "Відновлений текст стане новою редакцією. Права доступу залишаться чинними.", button: "Відновити",
          submit: async () => {
            const session = this.liveSession;
            if (session?.file === file && (session.batch || session.conflict || (await this.localNote(file)).body !== session.base)) {
              throw new Error("Спершу синхронізуйте локальні правки.");
            }
            const key = history.currentRevision + "/" + entry.revision;
            if (receipt?.key !== key) receipt = { key, opId: crypto.randomUUID() };
            const response = await this.sitePost(link.slug, { action: "restore", expectedUpdatedAt: history.currentRevision,
              restoreRevision: entry.revision, opId: receipt.opId, source: this.sourceKind });
            if (response.status !== 200 || response.json?.ok !== true) throw new Error(response.json?.error || "Версію не підтверджено. Оновіть історію.");
            receipt = null;
            if (session?.file === file && this.liveSession === session) this.queueLiveCheck(session, 0);
            new Notice("Версію відновлено.");
            clearCachePrefix(siteCache, link.slug);
            void load(true);
          },
        }));
      }
      const { btn: copyBtn, lblSpan: copyLbl } = makeBtnWithIcon(actions, "copy", "Копіювати", "fc-deck-btn fc-history-copy-btn");
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard?.writeText(snapshot.content);
          copyBtn.classList.add("is-copied");
          copyLbl.setText("✓ Скопійовано");
          setTimeout(() => {
            if (copyBtn.isConnected) {
              copyBtn.classList.remove("is-copied");
              copyLbl.setText("Копіювати");
            }
          }, 1600);
          new Notice("Текст версії скопійовано.");
        } catch {
          new Notice("Буфер обміну недоступний.");
        }
      });
    };

    const show = async (entry, history) => {
      const expected = ++previewEpoch;
      selectedRev = entry.revision;
      for (const [rev, btn] of rowButtons) btn.classList.toggle("is-selected", rev === selectedRev);
      const revSuffix = "&revision=" + encodeURIComponent(entry.revision);
      const revCached = Boolean(readCache(siteCache, `${link.slug}::${revSuffix}`));
      if (!revCached) {
        preview.empty();
        renderSkeleton(preview, 3);
      }
      try {
        const [data, local] = await Promise.all([
          read(revSuffix),
          this.localNote(file).catch(() => null),
        ]);
        if (!container.isConnected || expected !== previewEpoch) return;
        renderDiffPayload(entry, history, data, local?.body ?? null);
      } catch (error) {
        if (expected === previewEpoch) {
          preview.empty();
          status.setText(error instanceof Error ? error.message : "Версію не завантажено.");
        }
      }
    };

    const load = async (force = false) => {
      const generation = ++epoch;
      previewEpoch++;
      selectedRev = null;
      rowButtons.clear();
      preview.empty(); list.empty();
      if (force || !readCache(siteCache, link.slug)) renderSkeleton(list, 3);
      status.setText("Завантаження…");
      try {
        const history = await read("", { force });
        if (!container.isConnected || generation !== epoch) return;
        list.empty();
        const entries = Array.isArray(history.entries) ? history.entries.filter((entry) => VERSION.test(entry.revision)) : [];
        status.setText(entries.length ? "Версій: " + entries.length : "Версії з’являться після збереження.");
        const time = new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
        let shown = 0;
        const more = list.createEl("li", { cls: "fc-history-more-li" });
        const next = more.createEl("button", { text: "Показати ще", cls: "fc-deck-btn", attr: { type: "button" } });
        const append = () => {
          const total = entries.length;
          for (let offset = 0; offset < 20 && shown + offset < total; offset++) {
            const index = shown + offset;
            const entry = entries[index];
            const revNum = total - index;
            const isCurrent = entry.revision === history.currentRevision;
            const row = list.createEl("li");
            list.insertBefore(row, more);
            const button = row.createEl("button", { cls: "fc-history-row", attr: { type: "button" } });
            rowButtons.set(entry.revision, button);
            const topLine = button.createDiv({ cls: "fc-history-row-top" });
            topLine.createEl("strong", { text: entry.actorName || "Автор невідомий" });
            const badges = topLine.createDiv({ cls: "fc-history-row-badges" });
            if (isCurrent) {
              badges.createEl("span", { text: "Поточна", cls: "fc-history-pill is-current" });
            } else {
              badges.createEl("span", { text: `#${revNum}`, cls: "fc-history-pill is-neutral" });
            }
            if (entry.delta) {
              if (entry.delta.addedChars > 0) badges.createEl("span", { text: `+${entry.delta.addedChars}`, cls: "fc-history-pill is-add" });
              if (entry.delta.removedChars > 0) badges.createEl("span", { text: `−${entry.delta.removedChars}`, cls: "fc-history-pill is-del" });
              if (!entry.delta.addedChars && !entry.delta.removedChars && entry.delta.metaChanged?.length) {
                badges.createEl("span", { text: "метадані", cls: "fc-history-pill is-neutral" });
              }
            }
            const subLine = button.createEl("small", {
              text: `${labels[entry.action] || "Зміна"} · ${time.format(new Date(entry.revision))}${entry.source && entry.source !== "web" ? " · Obsidian" : ""}`,
            });
            button.addEventListener("click", () => {
              diffMode = isCurrent ? "this-edit" : "vs-current";
              void show(entry, history);
            });
          }
          shown += 20;
          more.hidden = shown >= entries.length;
        };
        next.addEventListener("click", append);
        append();
        if (entries.length > 0) {
          const initialEntry = entries.length > 1 ? entries[1] : entries[0];
          diffMode = initialEntry.revision === history.currentRevision ? "this-edit" : "vs-current";
          void show(initialEntry, history);
        }
      } catch (error) {
        if (generation === epoch) status.setText(error instanceof Error ? error.message : "Не вдалося завантажити історію.");
      }
    };
    refresh.addEventListener("click", () => {
      clearCachePrefix(siteCache, link.slug);
      void load(true);
    });
    void load();
  }

  localDriveEntityMatches(query, limit = 25) {
    const needle = String(query || "").trim().toLocaleLowerCase("uk");
    const out = [];
    const seen = new Set();
    const pushItem = (id, label, subtitle, mimeType = null) => {
      if (!id || seen.has(id) || out.length >= limit) return;
      seen.add(id);
      const isFolder = mimeType === "application/vnd.google-apps.folder";
      out.push({
        kind: "drive",
        id,
        fileId: id,
        mimeType,
        label,
        subtitle,
        url: isFolder
          ? `https://drive.google.com/drive/folders/${encodeURIComponent(id)}`
          : `https://drive.google.com/open?id=${encodeURIComponent(id)}`,
      });
    };
    for (const [fPath, meta] of (this.driveFiles || new Map()).entries()) {
      if (!meta || isSyncArchivePath(fPath)) continue;
      const fid = typeof meta.id === "string" && DRIVE_ID.test(meta.id) ? meta.id : null;
      if (!fid) continue;
      const fileName = fPath.split("/").pop() || fPath;
      const folderHint = fPath.includes("/") ? fPath.slice(0, fPath.lastIndexOf("/")).split("/").slice(-2).join(" / ") : "Google Drive";
      if (!needle || fileName.toLocaleLowerCase("uk").includes(needle) || fPath.toLocaleLowerCase("uk").includes(needle)) {
        pushItem(fid, fileName, `Drive · ${folderHint}`, meta.mimeType || null);
      }
    }
    for (const [dPath, meta] of (this.driveFolders || new Map()).entries()) {
      if (!meta || isSyncArchivePath(dPath)) continue;
      const fid = typeof meta.id === "string" && DRIVE_ID.test(meta.id) ? meta.id : null;
      if (!fid) continue;
      const folderName = dPath.split("/").pop() || dPath;
      if (!needle || folderName.toLocaleLowerCase("uk").includes(needle) || dPath.toLocaleLowerCase("uk").includes(needle)) {
        pushItem(fid, folderName, `Папка Drive · ${dPath}`, "application/vnd.google-apps.folder");
      }
    }
    return out;
  }

  async tagDriveEntry(fileId, rawLabel, mimeType = null) {
    const parsed = parseDriveRefParts(fileId);
    if (!parsed) return false;
    const cleanLabel = String(rawLabel || parsed.fileId).replace(/[|\[\]\r\n]+/g, " ").trim().slice(0, 120);
    const token = `[[drive:${parsed.canonicalId}|${cleanLabel}]]`;
    const active = this.activeNote?.();
    const view = this.noteView(active);
    const editor = view?.getMode?.() !== "preview" ? view?.editor : null;
    if (editor && active) {
      editor.replaceSelection(token + " ");
      editor.focus();
      new Notice(`🔗 Вставлено тег Google Drive: ${cleanLabel}`);
      return true;
    }
    await this.copyTextToClipboard(token, `Тег Drive скопійовано: ${cleanLabel}`);
    return true;
  }

  async fetchSiteEntities(query, kind) {
    const params = new URLSearchParams({ api: "1", entities: "1", q: query.trim(), kind });
    const response = await this.siteRequest({ url: SITE + "/m/welcome?" + params, method: "GET", headers: this.authHeaders(), throw: false });
    if (response.status === 401 || response.status === 403) throw new Error("Підключіть акаунт із правом редагування FlightClub.");
    if (response.status !== 200 || response.json?.ok !== true || !Array.isArray(response.json.items)) {
      if (kind === "drive") {
        const local = this.localDriveEntityMatches(query, 40);
        if (local.length) return { items: local, failedKinds: [] };
      }
      throw new Error("Пошук на сайті тимчасово недоступний.");
    }
    const items = response.json.items.filter((item) => item && typeof item.label === "string"
      && (item.kind === "m"
        ? SLUG.test(item.id)
        : item.kind === "drive"
          ? Boolean(parseDriveRefParts(item.id))
          : ["user", "item", "event"].includes(item.kind) && UUID.test(item.id)));
    if (kind === "drive" || kind === "all") {
      const seenDriveIds = new Set(
        items.filter(x => x.kind === "drive").map(x => parseDriveRefParts(x.id)?.fileId).filter(Boolean),
      );
      const localExtra = this.localDriveEntityMatches(query, kind === "drive" ? 30 : 6)
        .filter(x => !seenDriveIds.has(x.fileId));
      if (localExtra.length) items.push(...localExtra);
    }
    return { items, failedKinds: Array.isArray(response.json.failedKinds) ? response.json.failedKinds : [] };
  }

  noteView(file) {
    const active = this.app?.workspace?.getActiveViewOfType?.(MarkdownView);
    if (active?.file && (!file || active.file === file)) return active;
    if (!file) return null;
    for (const mode of ["markdown", "canvas", "bases"]) {
      const hit = (this.app?.workspace?.getLeavesOfType?.(mode) || []).find((leaf) => leaf.view?.file === file)?.view;
      if (hit) return hit;
    }
    return null;
  }

  insertEntityTokenIntoActiveEditor(item, explicitEditor, file = this.activeNote()) {
    const view = this.noteView(file);
    const editor = explicitEditor || (view?.getMode?.() !== "preview" ? view?.editor : null);
    if (!editor || !file || (explicitEditor && view?.editor !== explicitEditor)) {
      new Notice("Відкрийте потрібну нотатку в режимі редагування, щоб вставити згадку.");
      return false;
    }
    const label = String(item.label || item.id).replace(/[|\[\]\r\n]+/g, " ").trim().slice(0, 120);
    editor.replaceSelection("[[" + item.kind + ":" + item.id + "|" + label + "]] ");
    editor.focus();
    return true;
  }

  renderMentionSearch(container, { file, editor, state = { kind: "all", query: "" }, onInsert } = {}) {
    const panel = container.createDiv({ cls: "fc-mention-panel" });
    const kinds = [["all", "Усі"], ["user", "Люди"], ["item", "Майно"], ["event", "Події"], ["m", "Сторінки"], ["drive", "Drive"]];
    const filters = panel.createDiv({ cls: "fc-entity-filters", attr: { role: "group", "aria-label": "Тип згадки" } });
    const buttons = new Map();
    const form = panel.createEl("form", { cls: "fc-mention-form" });
    const label = form.createEl("label", { cls: "fc-mention-label" });
    label.createSpan({ text: "Знайти згадку", cls: "fc-sr-only" });
    const input = label.createEl("input", { attr: { type: "search", name: "query", autocomplete: "off", placeholder: "Пошук: ім’я, майно, подія, сторінка або файл Drive…", maxlength: "80", "aria-label": "Знайти згадку" } });
    input.value = state.query;
    form.createEl("button", { text: "Знайти", cls: "mod-cta fc-deck-btn fc-mention-submit", attr: { type: "submit" } });
    const statusRow = panel.createDiv({ cls: "fc-mention-status-row" });
    const status = statusRow.createDiv({ cls: "fc-mention-status fc-deck-sub", attr: { role: "status", "aria-live": "polite" } });
    const progress = statusRow.createDiv({ cls: "fc-mention-progress", attr: { "aria-hidden": "true" } });
    const results = panel.createEl("ul", { cls: "fc-mention-results", attr: { "aria-label": "Знайдені згадки" } });
    if (!this._mentionCache) this._mentionCache = new Map();
    let timer = null, generation = 0, lastQuery = null;

    const paintFilters = () => {
      for (const [id, button] of buttons) {
        button.classList.toggle("is-active", id === state.kind);
        button.setAttribute("aria-pressed", String(id === state.kind));
      }
    };

    const renderSkeletonRows = () => {
      results.empty();
      for (let i = 0; i < 5; i++) {
        const li = results.createEl("li", { cls: "fc-mention-skeleton" });
        li.createSpan({ cls: "fc-mention-skel-thumb" });
        const lines = li.createSpan({ cls: "fc-mention-skel-lines" });
        lines.createSpan({ cls: "fc-mention-skel-bar" });
        lines.createSpan({ cls: "fc-mention-skel-bar is-short" });
      }
    };

    const renderItems = (items, failedKinds) => {
      results.empty();
      const funnelIndex = this.buildPersonFunnelIndex().map;
      status.setText(failedKinds.length ? "Частина джерел тимчасово недоступна." : items.length ? "Результатів: " + items.length : "Збігів немає.");
      for (const item of items) {
        const row = results.createEl("li", { cls: "fc-mention-item" });
        const button = row.createEl("button", {
          cls: "fc-mention-result fc-mention-with-media",
          attr: { type: "button", "aria-label": "Вставити " + item.label, "data-tooltip-position": "top" },
        });
        const thumbnail = button.createSpan({ cls: "fc-mention-thumbnail", attr: { "aria-hidden": "true", "data-kind": item.kind } });
        thumbnail.createSpan({ text: item.kind === "user" ? item.label.trim().split(/\s+/).slice(0,2).map(word => word[0]).join("").toUpperCase() : "" });
        if (item.kind !== "user") {
          obsidian.setIcon?.(
            thumbnail,
            item.kind === "item"
              ? "box"
              : item.kind === "event"
                ? "calendar"
                : item.kind === "drive"
                  ? driveLucideIconForItem(item)
                  : "file-text",
          );
        }
        const imageUrl = secureImageUrl(item.imageUrl);
        if (imageUrl) {
          const image = thumbnail.createEl("img", { attr: { src: imageUrl, alt: "", loading: "lazy", decoding: "async", referrerpolicy: "no-referrer" } });
          image.addEventListener("error", () => image.remove(), { once: true });
        }
        const caption = button.createSpan({ cls: "fc-mention-caption" });
        const titleLine = caption.createDiv({ cls: "fc-mention-title-line" });
        titleLine.createEl("strong", { text: item.label });
        if (item.kind === "item" && item.status) {
          const st = normalizeEquipmentStatus(item.status);
          if (st) {
            titleLine.createSpan({
              text: `${st.dot} ${st.label}`,
              cls: `fc-tree-item-status ${st.cls}`,
              attr: { "data-fc-tree-status": st.key, title: `Статус майна: ${st.label}` },
            });
          }
        } else if (item.kind === "user") {
          let matched = null;
          for (const k of personLookupKeys(item.label)) {
            if (funnelIndex.has(k)) { matched = funnelIndex.get(k); break; }
          }
          const st = matched?.funnel || matched?.team || null;
          if (st) {
            titleLine.createSpan({
              text: `${st.dot} ${st.label}`,
              cls: `fc-tree-item-status fc-tree-person-status ${st.cls}`,
              attr: { "data-fc-mention-person-status": st.key, title: st.fullLabel },
            });
          }
        }
        caption.createEl("small", { text: item.subtitle || LABEL[item.kind] });
        button.addEventListener("click", () => {
          if (this.insertEntityTokenIntoActiveEditor(item, editor, file)) onInsert?.();
        });
        const target = (item.kind === "drive" && secureImageUrl(item.url)) || refUrl(item.kind + ":" + item.id);
        if (target) {
          row.createEl("a", {
            cls: "fc-deck-link fc-mention-open",
            text: item.kind === "drive" ? "Drive ↗" : "Відкрити",
            attr: { href: target, target: "_blank", rel: "noopener noreferrer", "aria-label": item.kind === "drive" ? ("Відкрити " + item.label + " у Google Drive") : ("Відкрити " + item.label + " на сайті"), "data-tooltip-position": "top" },
          });
        }
      }
    };

    const search = async (force = false) => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (!panel.isConnected) return;
      state.query = input.value;
      const key = state.kind + "\n" + state.query.trim();
      if (!force && key === lastQuery) return;
      lastQuery = key;
      const request = ++generation;
      const cached = !force ? this._mentionCache.get(key) : null;
      if (cached && (Date.now() - cached.at) < 15_000) {
        results.classList.remove("is-loading");
        progress.classList.remove("is-active");
        results.setAttribute("aria-busy", "false");
        renderItems(cached.items, cached.failedKinds);
        return;
      }
      status.setText("Пошук…");
      results.setAttribute("aria-busy", "true");
      progress.classList.add("is-active");
      if (!results.querySelector(".fc-mention-item")) {
        renderSkeletonRows();
      } else {
        results.classList.add("is-loading");
      }
      try {
        const { items, failedKinds } = await this.fetchSiteEntities(state.query, state.kind);
        if (!panel.isConnected || request !== generation) return;
        this._mentionCache.set(key, { at: Date.now(), items, failedKinds });
        if (this._mentionCache.size > 40) this._mentionCache.delete(this._mentionCache.keys().next().value);
        results.classList.remove("is-loading");
        progress.classList.remove("is-active");
        renderItems(items, failedKinds);
      } catch (error) {
        if (panel.isConnected && request === generation) {
          lastQuery = null;
          results.classList.remove("is-loading");
          progress.classList.remove("is-active");
          results.empty();
          status.setText(error instanceof Error ? error.message : "Не вдалося виконати пошук.");
        }
      } finally {
        if (panel.isConnected && request === generation) {
          results.setAttribute("aria-busy", "false");
          results.classList.remove("is-loading");
          progress.classList.remove("is-active");
        }
      }
    };
    for (const [id, caption] of kinds) {
      const button = filters.createEl("button", { text: caption, cls: "fc-entity-pill", attr: { type: "button" } });
      buttons.set(id, button);
      button.addEventListener("click", () => { state.kind = id; paintFilters(); void search(); });
    }
    paintFilters();
    input.addEventListener("input", () => {
      state.query = input.value;
      generation++;
      lastQuery = null;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void search(), 300);
    });
    form.addEventListener("submit", (event) => { event.preventDefault(); void search(); });
    void search();
    return input;
  }

  openEntityPickerModal(editor, file = this.activeNote(), kind = "all") {
    this.dialog?.close();
    const modal = new Modal(this.app);
    this.dialog = modal;
    modal.onOpen = () => {
      modal.titleEl.setText(kind === "drive" ? "Тегнути файл Google Drive" : "Згадки FlightClub");
      const input = this.renderMentionSearch(modal.contentEl, { file, editor, state: { kind, query: "" }, onInsert: () => modal.close() });
      input.focus();
    };
    modal.onClose = () => {
      if (this.dialog === modal) this.dialog = null;
      modal.contentEl.empty();
    };
    modal.open();
  }

  async loadGraphEntityVisuals() {
    const cache = this._graphEntityCache;
    if (cache && Date.now() - cache.at < 300_000) return false;
    if (this._graphEntityPending) return this._graphEntityPending;
    if (typeof this.siteRequest !== "function" || !this.vaultConfig?.deviceToken) return false;

    const extractUuid = (url) => {
      const m = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(String(url || ""));
      return m ? m[1].toLowerCase() : "";
    };
    const next = {
      at: Date.now(),
      usersById: new Map(),
      usersByNameKey: new Map(),
      itemsById: new Map(),
      itemsByName: new Map(),
      eventsById: new Map(),
      eventsByName: new Map(),
    };

    const run = async () => {
      let updated = false;
      for (const kind of ["user", "item", "event"]) {
        try {
          const qs = new URLSearchParams({ api: "1", entities: "1", kind, graph: "1", q: "" });
          const res = await this.siteRequest({
            url: `${SITE}/m/welcome?${qs}`,
            method: "GET",
            headers: this.authHeaders(),
            throw: false,
          });
          if (res?.status !== 200 || res.json?.ok !== true || !Array.isArray(res.json.items)) continue;
          for (const item of res.json.items) {
            if (!item || typeof item.id !== "string") continue;
            const id = item.id.toLowerCase();
            const label = String(item.label || "").trim().toLowerCase();
            const img = secureImageUrl(item.imageUrl);
            if (kind === "user") {
              if (img) {
                next.usersById.set(id, img);
                for (const k of personLookupKeys(item.label)) next.usersByNameKey.set(k, img);
                updated = true;
              }
            } else if (kind === "item") {
              const info = { imageUrl: img, status: typeof item.status === "string" ? item.status : null };
              next.itemsById.set(id, info);
              if (label) next.itemsByName.set(label, info);
              if (img || info.status) updated = true;
            } else {
              const info = { startsAt: typeof item.startsAt === "string" ? item.startsAt : null, city: typeof item.city === "string" ? item.city : null };
              next.eventsById.set(id, info);
              if (label) next.eventsByName.set(label, info);
              if (info.startsAt) updated = true;
            }
          }
        } catch {
          /* офлайн або обмежений доступ — лишаємо локальні дані без помилки */
        }
      }
      if (!updated && this._graphEntityCache) return false;
      next.extractUuid = extractUuid;
      this._graphEntityCache = next;
      return updated;
    };

    this._graphEntityPending = run().finally(() => { this._graphEntityPending = null; });
    return this._graphEntityPending;
  }

  collectObsidianGraphNotes(withLinks = false) {
    const files = typeof this.app?.vault?.getMarkdownFiles === "function"
      ? this.app.vault.getMarkdownFiles()
      : [];
    const primaryRoot = (this.vaultConfig?.localVaultRoot || "FlightClub").replace(/^\/+|\/+$/g, "");
    const allPaths = new Set(files.map((f) => f?.path).filter(Boolean));
    const funnelIndex = withLinks ? this.buildPersonFunnelIndex?.()?.map || new Map() : new Map();

    const rawRecords = [];
    const tagCounts = new Map();
    const monthCounts = new Map();
    const personKeyToPrimaryPath = new Map();

    for (const f of files) {
      if (!f?.path || isSyncArchivePath(f.path)) continue;
      // Exclude hidden items, trash, templates, and legacy import logs / duplicate folders
      if (/(?:^|\/)(?:\.trash|Templates?|Шаблони|03 google drive import)\//i.test(f.path)) continue;
      if (/(?:^|\/)(?:Курсанти - профілі|КАЛОВІ МАСИ З ГУГЛ ДРАЙВА|03 google drive import)\//i.test(f.path)) continue;
      if (/^FlightClub Platform\/Приховані\//i.test(f.path)) continue;
      // Deduplicate FlightClub Shared mirror copies when primary FlightClub copy exists
      if (f.path.startsWith("FlightClub Shared/") && primaryRoot && primaryRoot !== "FlightClub Shared") {
        const rel = f.path.slice("FlightClub Shared/".length);
        if (allPaths.has(`${primaryRoot}/${rel}`)) continue;
      }

      const cache = this.app?.metadataCache?.getFileCache?.(f) || null;
      const fm = cache?.frontmatter || null;
      const basename = f.basename || f.path.split("/").pop()?.replace(/\.md$/i, "") || f.path;
      // Deduplicate secondary "Ім'я - Місто.md" form duplicate when canonical "Ім'я.md" exists in the same folder
      if (basename.includes(" - ") && /01_03 Профілі курсантів\/|04 Навчання курсантів\//i.test(f.path)) {
        const cleanStem = basename.split(" - ")[0].trim();
        const folderPref = f.path.slice(0, f.path.lastIndexOf("/") + 1);
        if (cleanStem && allPaths.has(`${folderPref}${cleanStem}.md`)) continue;
      }
      let funnelMeta = null;
      if (funnelIndex.size) {
        for (const key of personLookupKeys(basename)) {
          if (funnelIndex.has(key)) { funnelMeta = funnelIndex.get(key); break; }
        }
      }
      const dateInfo = extractObsidianNoteDate(f, fm);
      const timelineSpan = extractObsidianDateTimeline(f, fm, dateInfo);
      const projectMeta = extractObsidianProjectMeta(f.path, fm);
      const topics = extractObsidianNoteTags(f, fm, cache, false);
      const tags = withLinks ? extractObsidianNoteTags(f, fm, cache) : topics;
      if (withLinks) {
        for (const tag of tags) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        if (dateInfo?.ym) monthCounts.set(dateInfo.ym, (monthCounts.get(dateInfo.ym) || 0) + 1);
      }

      const cls = classifyObsidianGraphNote(f.path, basename, fm, funnelMeta, dateInfo, tags);
      const statusMeta = withLinks ? this.equipmentStatusForPath?.(f.path) || this.personStatusForPath?.(f.path, funnelIndex) : null;
      const itemHolder = withLinks ? fcFmText(fm, ["item-holder"]) : "";
      const fcKind = fcFmText(fm, ["fc-kind"]).toLowerCase();
      const entityCache = this._graphEntityCache || null;
      const refUrl = fcFmText(fm, ["user-link", "item-link", "event-link", "link"]);
      const uuidHit = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(refUrl || fcFmText(fm, ["fc-id", "id"]));
      const entityUuid = uuidHit ? uuidHit[1].toLowerCase() : "";

      const isPersonEntity =
        fcKind === "user" ||
        fcKind === "person" ||
        /FlightClub Platform\/Люди\/|01_03 Профілі курсантів\/|04 Навчання курсантів\//i.test(f.path) ||
        Boolean(fcFmText(fm, ["user-link", "user-avatar"]));
      const isItemEntity =
        !isPersonEntity &&
        (fcKind === "item" ||
          /FlightClub Platform\/Майно\//i.test(f.path) ||
          Boolean(fcFmText(fm, ["item-status", "item-id", "item-link"])));
      const isEventEntity =
        !isPersonEntity &&
        !isItemEntity &&
        (fcKind === "event" ||
          /FlightClub Platform\/Події\//i.test(f.path) ||
          Boolean(fcFmText(fm, ["дата івенту", "event-date", "event-link"])));
      const entityKind = isPersonEntity ? "person" : isItemEntity ? "item" : isEventEntity ? "event" : "note";

      let avatarUrl = null;
      let photoUrl = null;
      let itemStatus = fcFmText(fm, ["item-status"]).toLowerCase();
      let eventBadge = "";
      if (entityKind === "person") {
        avatarUrl = secureImageUrl(fcFmText(fm, ["user-avatar", "avatar", "avatar_url"]))
          || (entityUuid ? entityCache?.usersById?.get(entityUuid) || null : null);
        if (!avatarUrl && entityCache?.usersByNameKey) {
          for (const k of personLookupKeys(basename)) {
            const hit = entityCache.usersByNameKey.get(k);
            if (hit) { avatarUrl = hit; break; }
          }
        }
      } else if (entityKind === "item") {
        const rawItemPhoto = fcFmText(fm, ["item-photo", "photo", "photo_url"]);
        const linkInner = rawItemPhoto.replace(/^!?\[\[([^|\]]+)(?:\|[^\]]+)?\]\]$/, "$1").trim();
        const resolvedPhoto = linkInner && typeof this.app?.metadataCache?.getFirstLinkpathDest === "function"
          ? this.app.metadataCache.getFirstLinkpathDest(linkInner, f.path)
          : null;
        const localRes = resolvedPhoto && typeof this.app?.vault?.getResourcePath === "function"
          ? this.app.vault.getResourcePath(resolvedPhoto)
          : null;
        const cachedItem = (entityUuid ? entityCache?.itemsById?.get(entityUuid) : null)
          || entityCache?.itemsByName?.get(basename.toLowerCase())
          || null;
        photoUrl = localRes || secureImageUrl(rawItemPhoto) || cachedItem?.imageUrl || null;
        if (!itemStatus && cachedItem?.status) itemStatus = cachedItem.status;
      } else if (entityKind === "event") {
        const cachedEv = (entityUuid ? entityCache?.eventsById?.get(entityUuid) : null)
          || entityCache?.eventsByName?.get(basename.toLowerCase())
          || null;
        const iso = dateInfo?.iso || (cachedEv?.startsAt ? cachedEv.startsAt.slice(0, 10) : "");
        if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
          eventBadge = `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
        }
      }
      const cleanStemForInitials = basename.replace(/\s*\([^)]*\)/g, "").trim();
      const words = cleanStemForInitials.split(/\s+/).filter(Boolean);
      const initials = words.length >= 2
        ? (words[0][0] + words[1][0]).toUpperCase()
        : cleanStemForInitials.slice(0, 2).toUpperCase() || "FC";

      if (withLinks && /01_03 Профілі курсантів\/|FlightClub Platform\/Люди\//i.test(f.path)) {
        for (const k of personLookupKeys(basename)) {
          if (!personKeyToPrimaryPath.has(k) || /01_03 Профілі курсантів\//i.test(f.path)) {
            personKeyToPrimaryPath.set(k, f.path);
          }
        }
      }

      rawRecords.push({
        id: f.path,
        path: f.path,
        kind: "note",
        entityKind,
        avatarUrl,
        photoUrl,
        itemStatus,
        eventBadge,
        initials,
        title: basename,
        folder: f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "",
        statusLabel: statusMeta ? `${statusMeta.dot} ${statusMeta.label}` : "",
        dateInfo,
        dateLabel: dateInfo ? `${dateInfo.source}: ${dateInfo.label}` : "",
        startMs: timelineSpan.startMs,
        endMs: timelineSpan.endMs,
        spanDays: timelineSpan.spanDays,
        hasExplicitDate: timelineSpan.hasExplicitDate,
        milestones: timelineSpan.milestones,
        projectKey: projectMeta.projectKey,
        projectLabel: projectMeta.projectLabel,
        tags: withLinks ? tags : [],
        topics,
        itemHolder,
        ...cls,
      });
    }

    return { rawRecords, tagCounts, monthCounts, personKeyToPrimaryPath };
  }

  buildObsidianZoneGraphModel(mode = "domains", filterOpts = {}) {
    const validMode = Object.hasOwn(FC_GRAPH_CATEGORIZATIONS, mode) ? mode : "domains";
    const includeTagNodes = filterOpts.includeTagNodes === true;
    const activeTag = typeof filterOpts.activeTag === "string" && filterOpts.activeTag.trim() ? filterOpts.activeTag.trim().toLowerCase() : null;
    const datePreset = typeof filterOpts.datePreset === "string" ? filterOpts.datePreset : "all";
    const dateFromIso = typeof filterOpts.dateFrom === "string" && /^\d{4}-\d{2}-\d{2}$/.test(filterOpts.dateFrom) ? filterOpts.dateFrom : null;
    const dateToIso = typeof filterOpts.dateTo === "string" && /^\d{4}-\d{2}-\d{2}$/.test(filterOpts.dateTo) ? filterOpts.dateTo : null;
    const monthBucket = typeof filterOpts.monthBucket === "string" && /^\d{4}-\d{2}$/.test(filterOpts.monthBucket) ? filterOpts.monthBucket : null;
    const connectedOnly = filterOpts.connectedOnly === true;

    const { rawRecords, tagCounts, monthCounts, personKeyToPrimaryPath } = this.collectObsidianGraphNotes(true);

    // Apply Date / Timeline & Tag Filters
    const nowMs = Date.now();
    const dayMs = 86_400_000;
    const matchesDateFilter = (rec) => {
      if (monthBucket) return rec.dateInfo?.ym === monthBucket;
      if (dateFromIso || dateToIso) {
        const iso = rec.dateInfo?.iso;
        if (!iso) return false;
        if (dateFromIso && iso < dateFromIso) return false;
        if (dateToIso && iso > dateToIso) return false;
        return true;
      }
      if (!datePreset || datePreset === "all") return true;
      const d = rec.dateInfo;
      if (!d) return false;
      if (datePreset === "7d") return (nowMs - d.ms) <= 7 * dayMs && d.ms <= nowMs + dayMs;
      if (datePreset === "30d") return (nowMs - d.ms) <= 30 * dayMs && d.ms <= nowMs + dayMs;
      if (datePreset === "90d") return (nowMs - d.ms) <= 90 * dayMs && d.ms <= nowMs + dayMs;
      if (datePreset === "2026-11") return d.ym === "2026-11";
      if (datePreset === "2026-10") return d.ym === "2026-10";
      if (datePreset === "2026-09") return d.ym === "2026-09";
      if (datePreset === "2026-summer") return d.ym >= "2026-06" && d.ym <= "2026-08";
      return true;
    };

    let filteredNotes = rawRecords.filter((rec) => {
      if (activeTag && !rec.tags.includes(activeTag)) return false;
      if (!matchesDateFilter(rec)) return false;
      return true;
    });

    const pathSet = new Set(filteredNotes.map((n) => n.path));
    const edges = [];
    const seenEdges = new Set();
    const pushEdge = (src, dst, type = "wiki") => {
      if (!src || !dst || src === dst) return;
      const key = src < dst ? `${src}\0${dst}` : `${dst}\0${src}`;
      if (seenEdges.has(key)) return;
      seenEdges.add(key);
      edges.push({ source: src, target: dst, type });
    };

    // 1. Explicit Markdown/Wiki links from Obsidian metadataCache
    const resolved = this.app?.metadataCache?.resolvedLinks || {};
    for (const [src, targets] of Object.entries(resolved)) {
      if (!pathSet.has(src) || !targets || typeof targets !== "object") continue;
      for (const dst of Object.keys(targets)) {
        if (pathSet.has(dst)) pushEdge(src, dst, "wiki");
      }
    }

    // 2. Semantic FlightClub links (Person <-> Cadet training profile, Equipment <-> Holder)
    for (const rec of filteredNotes) {
      if (rec.path.startsWith("FlightClub Platform/Люди/")) {
        for (const k of personLookupKeys(rec.title)) {
          const targetPath = personKeyToPrimaryPath.get(k);
          if (targetPath && targetPath !== rec.path && pathSet.has(targetPath)) {
            pushEdge(rec.path, targetPath, "semantic");
            break;
          }
        }
      }
      if (rec.itemHolder) {
        for (const k of personLookupKeys(rec.itemHolder)) {
          const holderPath = personKeyToPrimaryPath.get(k);
          if (holderPath && pathSet.has(holderPath)) {
            pushEdge(rec.path, holderPath, "semantic");
            break;
          }
        }
      }
    }

    // Optional connectedOnly filter (before adding tag hub nodes)
    if (connectedOnly) {
      const linkedIds = new Set();
      for (const e of edges) { linkedIds.add(e.source); linkedIds.add(e.target); }
      filteredNotes = filteredNotes.filter((n) => linkedIds.has(n.id));
    }

    let finalNodes = filteredNotes.map((n) => ({ ...n }));
    let customZones = null;
    if (validMode === "topics" && finalNodes.length > 0) {
      const topicCounts = new Map();
      for (const n of finalNodes) {
        const sourceTags = n.topics?.length ? n.topics : (n.tags || []);
        for (const t of sourceTags) {
          topicCounts.set(t, (topicCounts.get(t) || 0) + 1);
        }
      }
      const topTopics = [...topicCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "uk"))
        .slice(0, 8);
      const topTagSet = new Set(topTopics.map(([t]) => t));
      const rankMap = new Map(topTopics.map(([t, c], i) => [t, { c, i }]));
      let hasUntagged = false;
      for (const n of finalNodes) {
        const sourceTags = n.topics?.length ? n.topics : (n.tags || []);
        const best = sourceTags
          .filter((t) => topTagSet.has(t))
          .sort((a, b) => (rankMap.get(b).c - rankMap.get(a).c) || (rankMap.get(a).i - rankMap.get(b).i))[0];
        if (best) n.topicsZone = best;
        else { n.topicsZone = "_untagged"; hasUntagged = true; }
      }
      const palette = GRAPH_COLORS.map((rgb) => ({ rgb, color: `#${rgb.toString(16).padStart(6, "0")}` }));
      customZones = topTopics.map(([tag], idx) => ({
        id: tag,
        label: `#${tag}`,
        icon: "🏷️",
        color: palette[idx % palette.length].color,
        rgb: palette[idx % palette.length].rgb,
        query: `tag:#${tag}`,
      }));
      if (hasUntagged || !customZones.length) {
        customZones.push({ id: "_untagged", label: "Без тегів", icon: "📄", color: "#94a3b8", rgb: 0x94a3b8, query: "" });
      }
    }

    // 3. Optional Obsidian Tag Hub Nodes (pulls notes sharing #tags into organic constellations!)
    if (includeTagNodes && finalNodes.length > 0) {
      const visibleTagMap = new Map();
      for (const n of finalNodes) {
        for (const t of n.tags || []) {
          let list = visibleTagMap.get(t);
          if (!list) { list = []; visibleTagMap.set(t, list); }
          list.push(n);
        }
      }
      const minTagMembers = finalNodes.length <= 15 ? 1 : 2;
      const topTagHubs = [...visibleTagMap.entries()]
        .filter(([, members]) => members.length >= minTagMembers)
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 16);

      const topTopicIds = new Set((customZones || []).map((z) => z.id));
      for (const [tagName, members] of topTagHubs) {
        const tagId = `tag:#${tagName}`;
        // Assign tag hub to the dominant zone of its member notes in each categorization
        const dominantFor = (facetKey) => {
          const counts = new Map();
          for (const m of members) counts.set(m[facetKey], (counts.get(m[facetKey]) || 0) + 1);
          return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || members[0][facetKey];
        };
        finalNodes.push({
          id: tagId,
          path: tagId,
          kind: "tag",
          tagName,
          title: `#${tagName}`,
          folder: "Тег Obsidian",
          statusLabel: `🏷️ ${members.length} нот.`,
          dateLabel: "",
          tags: [tagName],
          domains: dominantFor("domains"),
          funnel: dominantFor("funnel"),
          hubs: dominantFor("hubs"),
          timeline: dominantFor("timeline"),
          topicsZone: topTopicIds.has(tagName) ? tagName : dominantFor("topicsZone"),
        });
        for (const m of members) {
          pushEdge(tagId, m.id, "tag");
        }
      }
    }

    const layout = layoutObsidianZoneGraph(finalNodes, edges, validMode, filterOpts.skipPhysics === true, customZones, {
      physicsLayout: filterOpts.physicsLayout,
      forces: filterOpts.forces,
      prevPositions: filterOpts.prevPositions,
    });
    layout.allTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24);
    layout.monthBuckets = [...monthCounts.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-10);
    layout.allMonths = [...monthCounts.entries()].sort((a, b) => b[0].localeCompare(a[0]));
    layout.filteredNotes = finalNodes.filter((n) => n.kind !== "tag");
    layout.rawRecords = rawRecords;
    layout.totalNotesCount = layout.filteredNotes.length;
    layout.rawTotalNotesCount = rawRecords.length;
    return layout;
  }

  async applyNativeObsidianGraphPreset(mode = "domains", openNative = false, extraFilter = "", records = null) {
    const choices = graphPresetChoices(records ?? (mode === "timeline" || mode === "topics" ? this.collectObsidianGraphNotes(true).rawRecords : []));
    const groups = choices[mode] ?? choices.domains;
    const result = await updateNativeGraph(this, groups, extraFilter, openNative);
    if (result.ok) {
      this.zoneGraphMode = mode;
      this.enhanceNativeObsidianGraphLeaves?.();
      if (openNative) {
        for (const view of this._nativeGraphOverlays?.values() || []) view.setCanvasOpen(false);
      }
    }
    return { ...result, mode, count: groups.length };
  }

  async exportObsidianZoneCanvas(mode = "domains", activeModel = null, options = {}) {
    try {
      const model = activeModel || this.buildObsidianZoneGraphModel(mode, { skipPhysics: true });
      const canvas = buildObsidianZoneCanvas(model, options.shuffle
        ? { ...options, shuffleSeed: 1 + Math.floor(Math.random() * 0xffffffff) }
        : options);
      if (!canvas.nodes.length) {
        new Notice("У вибірці немає нотаток для Canvas.");
        return { ok: false };
      }
      const rootDir = (this.vaultConfig?.localVaultRoot || "FlightClub").replace(/^\/+|\/+$/g, "");
      const viewName = options.showcase ? "вітрина" : options.detailed ? "зв’язки" : "огляд";
      const base = `${rootDir ? rootDir + "/" : ""}FlightClub Canvas — ${model.mode} · ${viewName}`;
      const payload = JSON.stringify(canvas, null, 2);
      const vault = this.app.vault;
      let openFile;
      let filePath;
      if (options.replaceLatest === true) {
        filePath = `${base}.canvas`;
        const existing = vault.getAbstractFileByPath?.(filePath);
        if (!existing) {
          openFile = await vault.create(filePath, payload);
        } else if (existing instanceof TFile && typeof vault.modify === "function") {
          await vault.modify(existing, payload);
          openFile = existing;
        }
      }
      for (let version = 1; !openFile && version <= 100; version++) {
        filePath = `${base}${version === 1 ? "" : ` (${version})`}.canvas`;
        const existing = vault.getAbstractFileByPath?.(filePath);
        if (!existing) {
          openFile = await vault.create(filePath, payload);
          break;
        }
        // Reuse the same export without overwriting a board the user has edited.
        if (existing instanceof TFile && await vault.read(existing) === payload) {
          openFile = existing;
          break;
        }
      }
      if (!openFile) {
        new Notice("У цій папці вже є 100 різних знімків Canvas.");
        return { ok: false };
      }
      await this.app.workspace?.getLeaf?.("tab")?.openFile?.(openFile);
      this.enhanceGeneratedCanvasLeaves();
      new Notice(options.shuffle ? "Приклади в Canvas оновлено" : `Відкрито Canvas · ${viewName}`);
      return { ok: true, path: filePath };
    } catch {
      new Notice("Не вдалося зберегти Canvas у Vault.");
      return { ok: false };
    }
  }

  enhanceGeneratedCanvasLeaves() {
    const leaves = this.app?.workspace?.getLeavesOfType?.("canvas") || [];
    for (const { view } of leaves) {
      const path = view?.file?.path || view?.getState?.()?.file || "";
      const generated = /(?:^|\/)FlightClub Canvas — (domains|funnel|hubs|timeline|topics)(?: · (?:огляд|зв’язки|вітрина)(?: \(\d+\))?)?\.canvas$/.test(path);
      view?.contentEl?.classList?.toggle("fc-generated-canvas", generated);
    }
  }

  teardownNativeGraphOverlays() {
    for (const { view } of this.app?.workspace?.getLeavesOfType?.("canvas") || []) {
      view?.contentEl?.classList?.remove("fc-generated-canvas");
    }
    if (!this._nativeGraphOverlays) return;
    for (const entry of this._nativeGraphOverlays.values()) {
      try { entry.ctrl?.destroy?.(); } catch {}
      try { entry.watermark?.remove?.(); } catch {}
      try { entry.hud?.remove?.(); } catch {}
      try { entry.overlay?.remove?.(); } catch {}
      try { entry.host?.classList?.remove?.("fc-native-graph-host", "is-fc-canvas-mode"); } catch {}
    }
    this._nativeGraphOverlays.clear();
  }

  enhanceNativeObsidianGraphLeaves() {
    if (!this.alive) return;
    this.enhanceGeneratedCanvasLeaves();
    const leaves = this.app?.workspace?.getLeavesOfType?.("graph") || [];
    this._nativeGraphOverlays ??= new Map();
    const activeHosts = new Set();

    for (const leaf of leaves) {
      const contentEl = leaf?.view?.contentEl
        || leaf?.view?.containerEl?.querySelector?.(".view-content")
        || leaf?.containerEl?.querySelector?.(".view-content");
      if (!contentEl || typeof contentEl.querySelector !== "function") continue;
      activeHosts.add(contentEl);
      contentEl.classList?.add?.("fc-native-graph-host");
      const doc = contentEl.ownerDocument || document;

      let state = this._nativeGraphOverlays.get(contentEl);
      if (!state) {
        const watermark = doc.createElement("div");
        watermark.className = "fc-native-graph-watermark";
        watermark.setAttribute("aria-hidden", "true");
        if (typeof BRAND_LOGO === "string" && BRAND_LOGO.startsWith("data:image/")) {
          const logoImg = doc.createElement("img");
          logoImg.className = "fc-zgraph-bg-logo";
          logoImg.src = BRAND_LOGO;
          logoImg.alt = "";
          logoImg.draggable = false;
          watermark.append(logoImg);
        }
        const wmRing = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
        wmRing.setAttribute("class", "fc-zgraph-bg-ring");
        wmRing.setAttribute("viewBox", "0 0 100 100");
        appendBrandIconSvg(wmRing, doc);
        watermark.append(wmRing);
        contentEl.prepend(watermark);

        const hud = doc.createElement("div");
        hud.className = "fc-native-graph-hud";
        hud.setAttribute("data-fc-native-graph-hud", "");
        const brandPill = doc.createElement("span");
        brandPill.className = "fc-native-graph-brand";
        brandPill.textContent = "FlightClub";
        hud.append(brandPill);

        const presets = doc.createElement("div");
        presets.className = "fc-native-graph-presets";
        hud.append(presets);
        const modeButtons = new Map();
        const modeEntries = [
          ["domains", "🧭 Напрями"],
          ["funnel", "📊 Статуси"],
          ["hubs", "📍 Осередки"],
          ["timeline", "📅 Дати"],
          ["topics", "🏷️ Теми"],
        ];
        for (const [mKey, mLabel] of modeEntries) {
          const btn = doc.createElement("button");
          btn.type = "button";
          btn.className = "fc-native-graph-pill";
          btn.textContent = mLabel;
          btn.setAttribute("data-fc-native-mode", mKey);
          btn.addEventListener("click", () => {
            this.zoneGraphMode = mKey;
            if (state.canvasOpen && state.ctrl?.setMode && Object.hasOwn(FC_GRAPH_CATEGORIZATIONS, mKey)) {
              state.ctrl.setMode(mKey);
            }
            void this.applyNativeObsidianGraphPreset(mKey, false);
          });
          presets.append(btn);
          modeButtons.set(mKey, btn);
        }

        const overlay = doc.createElement("div");
        overlay.className = "fc-native-graph-canvas-overlay";
        overlay.hidden = true;

        const canvasToggle = doc.createElement("button");
        canvasToggle.type = "button";
        canvasToggle.className = "fc-native-graph-canvas-btn";
        canvasToggle.setAttribute("data-fc-native-canvas-toggle", "");
        const syncOverlayUi = () => {
          canvasToggle.textContent = state.canvasOpen ? "Нативний граф" : "Граф FlightClub";
          presets.hidden = state.canvasOpen;
          canvasToggle.classList.toggle("is-active", state.canvasOpen);
          contentEl.classList?.toggle?.("is-fc-canvas-mode", state.canvasOpen);
          overlay.hidden = !state.canvasOpen;
        };
        const setCanvasOpen = (open) => {
          state.canvasOpen = open;
          syncOverlayUi();
          if (state.canvasOpen && !state.ctrl) {
            state.ctrl = this.renderZoneGraphPanel(overlay, {
              expanded: true,
              isTabView: true,
              initialMode: Object.hasOwn(FC_GRAPH_CATEGORIZATIONS, this.zoneGraphMode) ? this.zoneGraphMode : "domains",
            });
          } else if (!state.canvasOpen && state.ctrl) {
            state.ctrl.destroy?.();
            state.ctrl = null;
            overlay.replaceChildren?.();
          }
        };
        canvasToggle.addEventListener("click", () => setCanvasOpen(!state.canvasOpen));
        hud.append(canvasToggle);

        contentEl.append(hud, overlay);
        state = { host: contentEl, watermark, hud, overlay, modeButtons, setCanvasOpen, canvasOpen: false, ctrl: null };
        this._nativeGraphOverlays.set(contentEl, state);
        setCanvasOpen(true);
      }

      const activeMode = this.zoneGraphMode || "domains";
      for (const [mKey, btn] of state.modeButtons) {
        btn.classList.toggle("is-active", mKey === activeMode);
      }
    }

    for (const [host, entry] of this._nativeGraphOverlays.entries()) {
      if (!activeHosts.has(host) || !host.isConnected) {
        entry.ctrl?.destroy?.();
        entry.watermark?.remove?.();
        entry.hud?.remove?.();
        entry.overlay?.remove?.();
        this._nativeGraphOverlays.delete(host);
      }
    }
  }

  renderGraphInsights(container, options) {
    return renderGraphInsights(this, container, options);
  }

  async activateZoneGraphView(initialMode = null) {
    const mode = Object.hasOwn(GRAPH_MODES, initialMode || this.zoneGraphMode)
      ? (initialMode || this.zoneGraphMode)
      : "domains";
    this.zoneGraphMode = mode;
    if (Platform?.isMobileApp) {
      this.openZoneGraphModal(mode);
      return;
    }
    try {
      const ws = this.app?.workspace;
      if (ws?.getLeavesOfType) {
        let leaf = ws.getLeavesOfType(ZONE_GRAPH_VIEW_TYPE)[0];
        if (!leaf) {
          leaf = ws.getLeaf?.("tab") || ws.getLeaf?.(true);
          if (leaf?.setViewState) {
            await leaf.setViewState({ type: ZONE_GRAPH_VIEW_TYPE, active: true });
          }
        }
        if (leaf) {
          ws.revealLeaf?.(leaf);
          leaf.view?.render?.(mode);
          return;
        }
      }
    } catch {}
    this.openZoneGraphModal(mode);
  }

  renderZoneGraphPanel(container, { expanded = false, isTabView = false, initialMode = null, onCloseModal = null } = {}) {
    const doc = container?.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    const win = doc.defaultView || (typeof window !== "undefined" ? window : null);
    const SVG_NS = "http://www.w3.org/2000/svg";
    const MODE_ORDER = [
      ["domains", "Напрями"],
      ["funnel", "Воронка"],
      ["hubs", "Осередки"],
      ["timeline", "Дати"],
      ["topics", "Теми"],
    ];
    let mode = Object.hasOwn(FC_GRAPH_CATEGORIZATIONS, initialMode || this.zoneGraphMode)
      ? (initialMode || this.zoneGraphMode)
      : "domains";
    let activeZone = null;
    let activeTag = null;
    let userIncludeTagNodes = false;
    let topicsTagNodesOverride = null;
    let connectedOnly = false;
    let datePreset = "all";
    let dateFrom = "";
    let dateTo = "";
    let monthBucket = null;
    let query = "";
    let drawerOpen = false;
    let selectedNodeId = null;
    let physicsLayout = "obsidian";
    let ganttZoom = "months";
    const ganttCollapsedLanes = new Set();
    const ganttExpandedLanes = new Set();
    let ganttShowUndated = false;
    let ganttScrollTodayNext = false;
    const forces = { center: 0.45, repel: 1.0, link: 1.0, distance: 85 };
    let listLimit = GRAPH_PAGE;
    let scale = 1, tx = 0, ty = 0;
    let targetScale = 1, targetTx = 0, targetTy = 0;
    let hoveredId = null;
    let hoveredZoneHeaderId = null;
    let renderRaf = null;
    let needsRender = true;
    let physicsAlpha = 0;
    let physicsFrame = 0;
    let destroyed = false;
    let stageW = isTabView ? 960 : expanded ? 860 : 320;
    let stageH = isTabView ? 620 : expanded ? 520 : 300;
    let dpr = 1;
    let searchTimer = null;

    const effectiveIncludeTagNodes = () => (mode === "topics" ? (topicsTagNodesOverride ?? true) : userIncludeTagNodes);
    const prefersReducedMotion = () => Boolean(win?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);

    const wrap = container.createDiv({
      cls: "fc-zgraph-wrap" + (expanded ? " is-expanded" : "") + (isTabView ? " is-tab-view" : ""),
      attr: { "data-fc-zone-graph": mode },
    });

    // 1. Unified Slim Top Command Bar (Modes | Single Search | Filters, List, Refresh, Actions)
    const toolbar = wrap.createDiv({ cls: "fc-zgraph-toolbar" });
    const modeRow = toolbar.createDiv({ cls: "fc-zgraph-modes", attr: { role: "group", "aria-label": "Категоризація графа" } });
    const modeButtons = new Map();

    const searchWrap = toolbar.createDiv({ cls: "fc-zgraph-search-wrap" });
    const searchIcon = fcGraphIconSvg("search", doc, 14);
    if (searchIcon) searchWrap.append(searchIcon);
    const searchInput = searchWrap.createEl("input", {
      cls: "fc-zgraph-search",
      attr: {
        type: "search",
        placeholder: "Пошук: ім’я, #тег, майно, місто або дата…",
        "aria-label": "Пошук: ім’я, #тег, майно, місто або дата",
      },
    });
    const clearSearchBtn = searchWrap.createEl("button", {
      text: "×",
      cls: "fc-zgraph-search-clear",
      attr: { type: "button", "aria-label": "Очистити пошук", title: "Очистити пошук" },
    });
    clearSearchBtn.hidden = true;

    const toolbarRight = toolbar.createDiv({ cls: "fc-zgraph-toolbar-right" });
    const layoutGroup = toolbarRight.createDiv({
      cls: "fc-zgraph-layout-group",
      attr: { role: "group", "aria-label": "Вигляд візуалізації" },
    });
    const layoutModeBtns = new Map();
    for (const lKey of GRAPH_LAYOUT_ORDER) {
      const meta = GRAPH_LAYOUT_META[lKey];
      const lBtn = layoutGroup.createEl("button", {
        cls: "fc-zgraph-layout-btn" + (physicsLayout === lKey ? " is-active" : ""),
        attr: {
          type: "button",
          "data-fc-layout-mode": lKey,
          "aria-pressed": String(physicsLayout === lKey),
          title: meta.desc,
        },
      });
      const iconEl = fcGraphIconSvg(lKey, doc, 13);
      if (iconEl) lBtn.append(iconEl);
      lBtn.createSpan({ text: meta.short, cls: "fc-zgraph-layout-lbl" });
      layoutModeBtns.set(lKey, lBtn);
    }
    const layoutToggleBtn = layoutGroup.createEl("button", {
      cls: "fc-zgraph-layout-cycle",
      attr: {
        type: "button",
        "data-fc-toggle-physics-layout": "",
        "data-fc-layout-current": physicsLayout,
        "aria-pressed": String(physicsLayout === "obsidian"),
        "aria-label": "Перемкнути вигляд: Фізика → Роадмап → Зони → Гантт",
        title: "Перемкнути наступний вигляд (Фізика → Роадмап → Зони → Гантт)",
      },
    });
    const cycleIconEl = fcGraphIconSvg("cycle", doc, 12);
    if (cycleIconEl) layoutToggleBtn.append(cycleIconEl);

    const filters = toolbarRight.createEl("details", { cls: "fc-zgraph-filters" });
    const filterLabel = filters.createEl("summary", { cls: "fc-zgraph-tool-btn fc-zgraph-filter-label" });
    const filterIconEl = fcGraphIconSvg("filters", doc, 13);
    if (filterIconEl) filterLabel.append(filterIconEl);
    const filterLabelText = filterLabel.createSpan({ text: "Фільтри" });
    const filterPopover = filters.createDiv({ cls: "fc-zgraph-filter-popover" });
    const filterOptions = filterPopover.createDiv({ cls: "fc-zgraph-filter-options" });
    const tagNodesToggle = filterOptions.createEl("button", {
      text: "Вузли-теги",
      cls: "fc-zgraph-toggle-pill" + (effectiveIncludeTagNodes() ? " is-active" : ""),
      attr: {
        type: "button",
        "data-fc-toggle-tag-nodes": "",
        "aria-pressed": String(effectiveIncludeTagNodes()),
        title: "Показувати теги Obsidian як фізичні вузли-хаби, що притягують пов’язані нотатки",
      },
    });
    const connectedToggle = filterOptions.createEl("button", {
      text: "Зі зв’язками",
      cls: "fc-zgraph-toggle-pill",
      attr: { type: "button", "data-fc-toggle-connected-only": "", "aria-pressed": "false", title: "Приховати ізольовані нотатки без посилань" },
    });
    const resetFiltersBtn = filterOptions.createEl("button", {
      text: "Скинути",
      cls: "fc-zgraph-toggle-pill fc-zgraph-reset-btn",
      attr: { type: "button", "data-fc-reset-filters": "" },
    });
    resetFiltersBtn.hidden = true;

    const physicsPanel = filterPopover.createDiv({ cls: "fc-zgraph-physics-sliders", attr: { "data-fc-physics-sliders": "" } });
    physicsPanel.createSpan({ text: "Фізика (сили):", cls: "fc-zgraph-bar-label" });
    const sliderDefs = [
      ["center", "Центр", 0.1, 1.5, 0.05],
      ["repel", "Відштовхування", 0.3, 2.4, 0.1],
      ["link", "Сила зв’язків", 0.2, 2.0, 0.1],
      ["distance", "Довжина зв’язків", 35, 180, 5],
    ];
    for (const [fKey, fLabel, fMin, fMax, fStep] of sliderDefs) {
      const lbl = physicsPanel.createEl("label", { cls: "fc-zgraph-slider-row" });
      lbl.createSpan({ text: fLabel, cls: "fc-zgraph-slider-name" });
      const rng = lbl.createEl("input", {
        cls: "fc-zgraph-slider",
        attr: {
          type: "range",
          min: String(fMin),
          max: String(fMax),
          step: String(fStep),
          value: String(forces[fKey]),
          "data-fc-physics-slider": fKey,
          "aria-label": fLabel,
        },
      });
      rng.value = String(forces[fKey]);
      rng.addEventListener("input", () => {
        const val = Number(rng.value);
        if (!Number.isFinite(val)) return;
        forces[fKey] = val;
        if (model?.forces) model.forces[fKey] = val;
        physicsAlpha = prefersReducedMotion() ? 0 : Math.max(physicsAlpha, 0.65);
        scheduleRender();
      });
    }

    const dateRow = filterPopover.createDiv({ cls: "fc-zgraph-date-bar", attr: { "data-fc-graph-date-bar": "" } });
    const datePillsWrap = dateRow.createDiv({ cls: "fc-zgraph-date-pills" });
    datePillsWrap.createSpan({ text: "Період:", cls: "fc-zgraph-bar-label" });
    const datePresets = [
      ["all", "Увесь час"],
      ["7d", "7д"],
      ["30d", "30д"],
      ["90d", "90д"],
      ["2026-11", "Лист 26"],
      ["2026-10", "Жовт 26"],
      ["2026-09", "Вер 26"],
      ["2026-summer", "Літо 26"],
    ];
    const datePresetBtns = new Map();
    for (const [pKey, pLabel] of datePresets) {
      const b = datePillsWrap.createEl("button", {
        text: pLabel,
        cls: "fc-zgraph-mini-pill" + (datePreset === pKey ? " is-active" : ""),
        attr: { type: "button", "data-fc-date-preset": pKey, "aria-pressed": String(datePreset === pKey) },
      });
      datePresetBtns.set(pKey, b);
    }
    const monthWrap = dateRow.createEl("label", { text: "Місяць", cls: "fc-zgraph-month-label" });
    const monthSelect = monthWrap.createEl("select", { cls: "fc-zgraph-month-select", attr: { "data-fc-month-select": "" } });
    const rangeWrap = dateRow.createDiv({ cls: "fc-zgraph-date-range" });
    const fromInput = rangeWrap.createEl("input", {
      cls: "fc-zgraph-date-input",
      attr: { type: "date", "data-fc-date-from": "", "aria-label": "Дата від", title: "Дата від" },
    });
    rangeWrap.createSpan({ text: "—", cls: "fc-zgraph-date-sep" });
    const toInput = rangeWrap.createEl("input", {
      cls: "fc-zgraph-date-input",
      attr: { type: "date", "data-fc-date-to": "", "aria-label": "Дата до", title: "Дата до" },
    });
    const histogramWrap = dateRow.createDiv({ cls: "fc-zgraph-histogram", attr: { "data-fc-graph-histogram": "" } });
    const tagBar = filterPopover.createDiv({ cls: "fc-zgraph-tag-bar", attr: { "data-fc-graph-tag-bar": "" } });

    const drawerBtn = toolbarRight.createEl("button", {
      cls: "fc-zgraph-tool-btn fc-zgraph-drawer-btn",
      attr: { type: "button", "data-fc-drawer-toggle": "", "aria-pressed": "false", title: "Відкрити список нотаток та інспектор" },
    });
    const drawerIconEl = fcGraphIconSvg("list", doc, 13);
    if (drawerIconEl) drawerBtn.append(drawerIconEl);
    const drawerBtnLabel = drawerBtn.createSpan({ text: "Список (0)", cls: "fc-zgraph-drawer-btn-lbl" });
    const refreshBtn = toolbarRight.createEl("button", {
      cls: "fc-zgraph-tool-btn",
      attr: { type: "button", "data-fc-graph-refresh": "", title: "Перечитати нотатки та зв’язки Vault" },
    });
    const refreshIconEl = fcGraphIconSvg("refresh", doc, 13);
    if (refreshIconEl) refreshBtn.append(refreshIconEl);
    refreshBtn.createSpan({ text: "Оновити" });
    const actionsMenu = toolbarRight.createEl("details", { cls: "fc-zgraph-actions-menu" });
    actionsMenu.createEl("summary", { text: "Дії ▾", cls: "fc-zgraph-tool-btn" });
    const actionsPopover = actionsMenu.createDiv({ cls: "fc-zgraph-actions-popover" });
    const nativeBtn = actionsPopover.createEl("button", {
      text: "У граф Obsidian",
      cls: "fc-zgraph-menu-item",
      attr: { type: "button", "data-fc-apply-native-graph": "", title: "Синхронізувати групи у .obsidian/graph.json" },
    });
    const removeNativeBtn = actionsPopover.createEl("button", {
      text: "Прибрати групи FlightClub",
      cls: "fc-zgraph-menu-item",
      attr: { type: "button", "data-fc-remove-native-graph": "" },
    });
    removeNativeBtn.hidden = !this.graphPreset;
    const canvasShowcaseBtn = actionsPopover.createEl("button", {
      text: "Створити Canvas · Воронка (приклади)",
      cls: "fc-zgraph-menu-item",
      attr: { type: "button", "data-fc-export-canvas": "showcase" },
    });
    const canvasShuffleBtn = actionsPopover.createEl("button", {
      text: "Шафл прикладів у Canvas",
      cls: "fc-zgraph-menu-item",
      attr: { type: "button", "data-fc-export-canvas": "shuffle" },
    });
    const canvasOverviewBtn = actionsPopover.createEl("button", {
      text: "Створити Canvas · Огляд (по 4)",
      cls: "fc-zgraph-menu-item",
      attr: { type: "button", "data-fc-export-canvas": "overview" },
    });
    if (!isTabView) {
      const openTabBtn = actionsPopover.createEl("button", {
        text: "Відкрити у вкладці",
        cls: "fc-zgraph-menu-item",
        attr: { type: "button", "data-fc-open-graph-tab": "" },
      });
      openTabBtn.addEventListener("click", () => {
        actionsMenu.open = false;
        onCloseModal?.();
        void this.activateZoneGraphView(mode);
      });
    }
    if (!expanded && !isTabView) {
      const expandBtn = actionsPopover.createEl("button", {
        text: "Відкрити у вікні",
        cls: "fc-zgraph-menu-item",
        attr: { type: "button", "data-fc-expand-graph": "" },
      });
      expandBtn.addEventListener("click", () => {
        actionsMenu.open = false;
        this.openZoneGraphModal(mode);
      });
    }

    // 2. Slim Single-Line Scrollable Zone Chip Bar
    const zoneBar = wrap.createDiv({ cls: "fc-zgraph-zones", attr: { role: "group", "aria-label": "Кольорові зони" } });
    const statusLine = wrap.createEl("div", {
      cls: "fc-zgraph-status",
      attr: { role: "status", "aria-live": "polite" },
    });
    statusLine.hidden = true;

    // 3. Main Split Workspace: Full-Bleed Canvas Stage + Right Collapsible Drawer
    const workspace = wrap.createDiv({ cls: "fc-zgraph-workspace" });
    const stage = workspace.createDiv({ cls: "fc-zgraph-stage" });
    const watermark = stage.createDiv({ cls: "fc-zgraph-bg-watermark", attr: { "aria-hidden": "true" } });
    if (typeof BRAND_LOGO === "string" && BRAND_LOGO.startsWith("data:image/")) {
      watermark.createEl("img", { cls: "fc-zgraph-bg-logo", attr: { src: BRAND_LOGO, alt: "", draggable: "false" } });
    }
    const wmRing = doc.createElementNS(SVG_NS, "svg");
    wmRing.setAttribute("class", "fc-zgraph-bg-ring");
    wmRing.setAttribute("viewBox", "0 0 100 100");
    appendBrandIconSvg(wmRing, doc);
    watermark.append(wmRing);

    const canvasEl = stage.createEl("canvas", {
      cls: "fc-zgraph-canvas",
      attr: { tabindex: "0", role: "img", "aria-label": "Інтерактивний граф FlightClub" },
    });
    let ctx = null;
    try { ctx = canvasEl.getContext?.("2d") || null; } catch { ctx = null; }

    const ganttEl = stage.createDiv({
      cls: "fc-zgraph-gantt",
      attr: { "data-fc-gantt": "", role: "region", "aria-label": "Діаграма Гантта FlightClub" },
    });
    ganttEl.hidden = true;

    const tipEl = stage.createDiv({ cls: "fc-zgraph-tip" });
    tipEl.hidden = true;

    const controls = stage.createDiv({ cls: "fc-zgraph-controls" });
    const reheatBtn = controls.createEl("button", { cls: "fc-zgraph-ctrl-btn", attr: { type: "button", "data-fc-reheat-physics": "", "aria-label": "Перетрусити фізику графа", title: "Перетрусити фізику графа" } });
    const reheatIcon = fcGraphIconSvg("cycle", doc, 13);
    if (reheatIcon) reheatBtn.append(reheatIcon); else reheatBtn.setText("↻");
    const zoomOutBtn = controls.createEl("button", { text: "−", cls: "fc-zgraph-ctrl-btn", attr: { type: "button", "data-fc-zoom-out": "", "aria-label": "Зменшити", title: "Зменшити" } });
    const fitBtn = controls.createEl("button", { cls: "fc-zgraph-ctrl-btn fc-zgraph-fit-btn", attr: { type: "button", "data-fc-fit-view": "", "aria-label": "Умістити всі зони", title: "Умістити всі зони" } });
    const fitIcon = fcGraphIconSvg("zones", doc, 13);
    if (fitIcon) fitBtn.append(fitIcon); else fitBtn.setText("⊡");
    const zoomInBtn = controls.createEl("button", { text: "+", cls: "fc-zgraph-ctrl-btn", attr: { type: "button", "data-fc-zoom-in": "", "aria-label": "Збільшити", title: "Збільшити" } });

    const drawerEl = workspace.createEl("aside", {
      cls: "fc-zgraph-drawer",
      attr: { "aria-label": "Інспектор та список нотаток" },
    });
    drawerEl.hidden = true;

    let model = null;
    let spatialGrid = fcBuildGraphSpatialGrid([], 48);
    const adjacency = new Map();
    const searchText = new Map();
    const nodeById = new Map();
    const matchedIds = new Set();
    const imageCache = new Map();

    const readTheme = () => {
      const style = win?.getComputedStyle?.(stage);
      const bg = style?.getPropertyValue?.("--background-primary")?.trim() || "#0b1017";
      const isLight = doc.body?.classList?.contains?.("theme-light") === true;
      return {
        fontFamily: style?.getPropertyValue?.("--font-interface")?.trim() || "system-ui, -apple-system, sans-serif",
        textNormal: style?.getPropertyValue?.("--text-normal")?.trim() || (isLight ? "#1e293b" : "#e2e8f0"),
        headerPillBg: isLight ? "rgba(255, 255, 255, 0.88)" : "rgba(15, 23, 42, 0.84)",
        labelBg: isLight ? "rgba(255, 255, 255, 0.88)" : "rgba(11, 16, 23, 0.84)",
        bg,
      };
    };
    let theme = readTheme();

    const scheduleFrame = win?.requestAnimationFrame?.bind(win) ?? ((fn) => setTimeout(fn, 16));
    const cancelFrame = win?.cancelAnimationFrame?.bind(win) ?? clearTimeout;

    const updateCanvasSize = () => {
      const w = stage.clientWidth || (isTabView ? 960 : expanded ? 860 : 320);
      const h = stage.clientHeight || (isTabView ? 620 : expanded ? 520 : 300);
      dpr = Math.min(2.5, Math.max(1, Number(win?.devicePixelRatio) || 1));
      if (w !== stageW || h !== stageH || canvasEl.width !== Math.round(w * dpr) || canvasEl.height !== Math.round(h * dpr)) {
        stageW = w;
        stageH = h;
        canvasEl.width = Math.round(w * dpr);
        canvasEl.height = Math.round(h * dpr);
        if (canvasEl.style) {
          canvasEl.style.width = `${w}px`;
          canvasEl.style.height = `${h}px`;
        }
        needsRender = true;
      }
    };

    const updateZoomReadout = () => {
      const pct = Math.round(scale * 100);
      const fitTitle = physicsLayout === "roadmap" ? "Умістити роадмап" : physicsLayout === "zones" ? "Умістити всі зони" : "Умістити граф";
      fitBtn.title = `${fitTitle} (${pct}%)`;
    };

    const drawCanvas = () => {
      needsRender = false;
      if (!ctx || !model || physicsLayout === "gantt") return;
      updateCanvasSize();
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, stageW, stageH);

      ctx.save();
      ctx.translate(tx, ty);
      ctx.scale(scale, scale);

      // 1. Zone Containers (Roadmap Timeline + Year Checkpoints vs Boxed Cards vs Organic Glows)
      if (physicsLayout === "roadmap" && model.roadmapMeta) {
        fcDrawGraphRoadmapBackdrop(ctx, model.roadmapMeta, activeZone, theme, scale, tx, ty, stageW);
      } else {
        const drawCluster = physicsLayout === "zones" ? fcDrawGraphZoneCard : fcDrawGraphClusterGlow;
        for (const z of model.zones) {
          const isActive = Boolean(activeZone && z.id === activeZone);
          const isDim = Boolean(activeZone && z.id !== activeZone);
          drawCluster(ctx, z, { isActive, isDim, isHeaderHovered: hoveredZoneHeaderId === z.id }, theme, scale);
        }
      }

      // 2. Curved Quadratic Bezier Edges
      const focusId = hoveredId || selectedNodeId;
      const focusNeighbors = focusId ? (adjacency.get(focusId) || new Set([focusId])) : null;
      const edgeLimit = Math.min(model.edges.length, 2600);
      for (let i = 0; i < edgeLimit; i++) {
        fcDrawGraphEdge(ctx, model.edges[i], { matchedIds, focusId }, scale);
      }

      // 3. Nodes (dimmed first, highlighted on top)
      const activePath = this.activeNote?.()?.path || "";
      const hasSearch = Boolean(query.trim());
      const topNodes = [];
      for (let i = 0; i < model.nodes.length; i++) {
        const n = model.nodes[i];
        const mOk = matchedIds.has(n.id);
        const fOk = !focusNeighbors || focusNeighbors.has(n.id);
        const isHovered = n.id === hoveredId;
        const isSelected = n.id === selectedNodeId;
        const isNeighbor = Boolean(focusNeighbors && focusNeighbors.has(n.id) && n.id !== focusId);
        const isCurrent = n.path === activePath;
        const isDim = !(mOk && fOk);
        const state = { isDim, isHovered, isSelected, isNeighbor, isCurrent, isSearchHit: hasSearch && mOk };
        if (!isDim && (isHovered || isSelected || isNeighbor || isCurrent || n.kind === "tag")) {
          topNodes.push({ n, state });
        } else {
          fcDrawGraphNode(ctx, n, state, imageCache, onImageLoaded, theme, scale);
        }
      }
      for (let i = 0; i < topNodes.length; i++) {
        fcDrawGraphNode(ctx, topNodes[i].n, topNodes[i].state, imageCache, onImageLoaded, theme, scale);
      }
      ctx.restore();

      // 4. Smart LOD Label Engine with 2D AABB Collision Rejection
      fcDrawGraphLabels(
        ctx,
        model.nodes,
        { hoveredId, selectedId: selectedNodeId, activePath, matchedIds, neighborSet: focusNeighbors, hasSearch },
        tx,
        ty,
        scale,
        stageW,
        stageH,
        theme,
      );
      ctx.restore();
    };

    const scheduleRender = () => {
      needsRender = true;
      if (destroyed || renderRaf != null) return;
      renderRaf = scheduleFrame(frameTick);
    };

    const onImageLoaded = () => {
      if (!destroyed) scheduleRender();
    };

    function frameTick() {
      renderRaf = null;
      if (destroyed || !model) return;
      let keepGoing = false;

      if (physicsAlpha > 0.005) {
        model.stepPhysics?.(physicsAlpha);
        physicsAlpha *= 0.965;
        physicsFrame++;
        if (physicsFrame % 3 === 0 || physicsAlpha <= 0.005) {
          spatialGrid = fcBuildGraphSpatialGrid(model.nodes, 48);
        }
        needsRender = true;
        if (physicsAlpha > 0.005) keepGoing = true;
        else physicsAlpha = 0;
      }

      const dScale = targetScale - scale;
      const dTx = targetTx - tx;
      const dTy = targetTy - ty;
      if (Math.abs(dScale) > 0.001 || Math.abs(dTx) > 0.25 || Math.abs(dTy) > 0.25) {
        if (prefersReducedMotion()) {
          scale = targetScale; tx = targetTx; ty = targetTy;
        } else {
          scale += dScale * 0.22;
          tx += dTx * 0.22;
          ty += dTy * 0.22;
          keepGoing = true;
        }
        updateZoomReadout();
        needsRender = true;
      } else if (scale !== targetScale || tx !== targetTx || ty !== targetTy) {
        scale = targetScale; tx = targetTx; ty = targetTy;
        updateZoomReadout();
        needsRender = true;
      }

      if (needsRender) drawCanvas();
      if (keepGoing && !destroyed) renderRaf = scheduleFrame(frameTick);
    }

    const fitView = (targetZoneId = activeZone, { immediate = false } = {}) => {
      if (!model || !model.nodes.length || physicsLayout === "gantt") return;
      updateCanvasSize();
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      if (physicsLayout === "roadmap" && model.roadmapMeta) {
        const rm = model.roadmapMeta;
        const focusLane = targetZoneId ? rm.lanes?.find((l) => l.id === targetZoneId) : null;
        minX = rm.minX;
        maxX = rm.maxX;
        minY = focusLane ? focusLane.topY - 56 : rm.minY;
        maxY = focusLane ? focusLane.botY + 32 : rm.maxY;
      } else if (physicsLayout !== "zones") {
        const targetNodes = targetZoneId
          ? model.nodes.filter((n) => n.zoneId === targetZoneId)
          : model.nodes;
        const pool = targetNodes.length ? targetNodes : model.nodes;
        for (const n of pool) {
          const pad = (n.visualR || n.r || 8) + 42;
          minX = Math.min(minX, n.x - pad);
          maxX = Math.max(maxX, n.x + pad);
          minY = Math.min(minY, n.y - pad);
          maxY = Math.max(maxY, n.y + pad);
        }
      } else {
        const targetZones = targetZoneId ? model.zones.filter((z) => z.id === targetZoneId) : model.zones;
        if (!targetZones.length) return;
        for (const z of targetZones) {
          minX = Math.min(minX, z.x - z.rx - 28);
          maxX = Math.max(maxX, z.x + z.rx + 28);
          minY = Math.min(minY, z.y - z.ry - 28);
          maxY = Math.max(maxY, z.y + z.ry + 28);
        }
      }
      const spanX = Math.max(120, maxX - minX);
      const spanY = Math.max(120, maxY - minY);
      const nextScale = Math.max(0.08, Math.min(2.4, Math.min(Math.max(48, stageW - 32) / spanX, Math.max(48, stageH - 32) / spanY)));
      const nextTx = stageW / 2 - ((minX + maxX) / 2) * nextScale;
      const nextTy = stageH / 2 - ((minY + maxY) / 2) * nextScale;
      targetScale = nextScale;
      targetTx = nextTx;
      targetTy = nextTy;
      if (immediate || prefersReducedMotion() || !ctx) {
        scale = nextScale; tx = nextTx; ty = nextTy;
        updateZoomReadout();
      }
      scheduleRender();
    };

    const focusNode = (id, { zoomMin = 0.95 } = {}) => {
      const node = nodeById.get(id);
      if (!node) return;
      updateCanvasSize();
      const nextScale = Math.max(targetScale, zoomMin);
      targetScale = Math.min(2.4, nextScale);
      targetTx = stageW / 2 - node.x * targetScale;
      targetTy = stageH / 2 - node.y * targetScale;
      if (prefersReducedMotion() || !ctx) {
        scale = targetScale; tx = targetTx; ty = targetTy;
        updateZoomReadout();
      }
      scheduleRender();
    };

    const openVaultPath = async (notePath) => {
      const targetFile = this.app?.vault?.getAbstractFileByPath?.(notePath);
      if (!targetFile) {
        new Notice("Нотатку не знайдено у Vault. Оновіть граф.");
        return false;
      }
      const leaf = this.app?.workspace?.getLeaf?.("tab") || this.app?.workspace?.getLeaf?.(false);
      try {
        if (leaf?.openFile) await leaf.openFile(targetFile, { active: true });
        onCloseModal?.();
        return true;
      } catch {
        new Notice("Не вдалося відкрити нотатку.");
        return false;
      }
    };

    const getFilteredNotes = () => {
      if (!model) return [];
      const needle = query.trim().toLocaleLowerCase("uk").replace(/^#/, "");
      return (model.filteredNotes || model.nodes.filter((n) => n.kind !== "tag"))
        .filter((n) => (!activeZone || n.zoneId === activeZone) && (!needle || (searchText.get(n.id) || "").includes(needle)))
        .sort((a, b) => (b.dateInfo?.iso || "").localeCompare(a.dateInfo?.iso || "") || a.title.localeCompare(b.title, "uk"));
    };

    const renderDrawer = () => {
      if (!model) return;
      const filteredNotes = getFilteredNotes();
      drawerBtnLabel.setText(`Список (${filteredNotes.length})`);
      drawerBtn.classList.toggle("is-active", drawerOpen);
      drawerBtn.setAttribute("aria-pressed", String(drawerOpen));
      drawerEl.hidden = !drawerOpen;
      if (!drawerOpen) return;

      drawerEl.empty?.();
      const selected = selectedNodeId ? nodeById.get(selectedNodeId) : null;
      const head = drawerEl.createDiv({ cls: "fc-zgraph-drawer-head" });
      if (selected) {
        const backBtn = head.createEl("button", {
          text: "← Список",
          cls: "fc-zgraph-drawer-back",
          attr: { type: "button", "data-fc-drawer-back": "" },
        });
        backBtn.addEventListener("click", () => {
          selectedNodeId = null;
          renderDrawer();
          scheduleRender();
        });
        head.createSpan({ text: "Інспектор", cls: "fc-zgraph-drawer-title" });
      } else {
        const zoneLabel = activeZone ? model.zones.find((z) => z.id === activeZone)?.label : null;
        head.createSpan({
          text: zoneLabel ? `${zoneLabel} · ${filteredNotes.length}` : `Нотатки (${filteredNotes.length})`,
          cls: "fc-zgraph-drawer-title",
        });
      }
      const closeBtn = head.createEl("button", {
        text: "×",
        cls: "fc-zgraph-drawer-close",
        attr: { type: "button", "data-fc-drawer-close": "", "aria-label": "Закрити панель", title: "Закрити панель" },
      });
      closeBtn.addEventListener("click", () => {
        drawerOpen = false;
        selectedNodeId = null;
        renderDrawer();
        scheduleRender();
      });

      const body = drawerEl.createDiv({ cls: "fc-zgraph-drawer-body" });
      if (selected) {
        const zoneMeta = model.zones.find((z) => z.id === selected.zoneId);
        if (zoneMeta) {
          const zBadge = body.createDiv({ cls: "fc-zgraph-insp-zone" });
          zBadge.style?.setProperty?.("--fc-z-color", zoneMeta.color);
          zBadge.createSpan({ cls: "fc-zgraph-zone-dot" });
          zBadge.createSpan({ text: zoneMeta.label });
        }
        body.createEl("h3", { text: selected.title, cls: "fc-zgraph-insp-title" });
        if (selected.kind !== "tag") {
          body.createDiv({ text: selected.path, cls: "fc-zgraph-insp-path" });
        }
        const metaItems = [selected.statusLabel, selected.dateLabel, selected.folder].filter(Boolean);
        if (metaItems.length) {
          const metaRow = body.createDiv({ cls: "fc-zgraph-insp-meta" });
          for (const m of metaItems) metaRow.createSpan({ text: m, cls: "fc-zgraph-insp-chip" });
        }
        if (selected.kind === "tag" && selected.tagName) {
          const tagFilterBtn = body.createEl("button", {
            text: activeTag === selected.tagName ? `Скинути фільтр #${selected.tagName}` : `Фільтрувати за #${selected.tagName}`,
            cls: "mod-cta fc-zgraph-insp-cta",
            attr: { type: "button", "data-fc-inspector-tag-filter": selected.tagName },
          });
          tagFilterBtn.addEventListener("click", () => {
            activeTag = activeTag === selected.tagName ? null : selected.tagName;
            rebuild();
          });
        } else {
          const openBtn = body.createEl("button", {
            text: "Відкрити нотатку",
            cls: "mod-cta fc-zgraph-insp-cta",
            attr: { type: "button", "data-fc-inspector-open": "" },
          });
          openBtn.addEventListener("click", () => void openVaultPath(selected.path));
        }

        if (selected.tags?.length) {
          const tagsBox = body.createDiv({ cls: "fc-zgraph-insp-section" });
          tagsBox.createDiv({ text: "Теги", cls: "fc-zgraph-insp-label" });
          const tagsList = tagsBox.createDiv({ cls: "fc-zgraph-insp-chips" });
          for (const t of selected.tags.slice(0, 12)) {
            const tb = tagsList.createEl("button", {
              text: `#${t}`,
              cls: "fc-zgraph-tag-pill" + (activeTag === t ? " is-active" : ""),
              attr: { type: "button", "data-fc-inspector-tag": t },
            });
            tb.addEventListener("click", () => {
              activeTag = activeTag === t ? null : t;
              rebuild();
            });
          }
        }

        const nbIds = [...(adjacency.get(selected.id) || [])].filter((id) => id !== selected.id);
        const neighbors = nbIds.map((id) => nodeById.get(id)).filter(Boolean)
          .sort((a, b) => (b.degree || 0) - (a.degree || 0) || a.title.localeCompare(b.title, "uk"));
        const nbBox = body.createDiv({ cls: "fc-zgraph-insp-section" });
        nbBox.createDiv({ text: `Зв’язки (${neighbors.length})`, cls: "fc-zgraph-insp-label" });
        if (!neighbors.length) {
          nbBox.createDiv({ text: "Немає зв’язків у поточній вибірці.", cls: "fc-zgraph-insp-empty" });
        } else {
          const nbList = nbBox.createDiv({ cls: "fc-zgraph-insp-chips" });
          for (const nb of neighbors.slice(0, 30)) {
            const nBtn = nbList.createEl("button", {
              text: nb.title,
              cls: "fc-zgraph-insp-neighbor",
              attr: { type: "button", "data-fc-inspector-neighbor": nb.id, title: nb.path },
            });
            nBtn.addEventListener("click", () => {
              selectedNodeId = nb.id;
              focusNode(nb.id);
              renderDrawer();
            });
          }
        }
        return;
      }

      const list = body.createEl("ul", { cls: "fc-zgraph-drawer-list", attr: { "aria-label": "Нотатки" } });
      if (!filteredNotes.length) {
        list.createEl("li", { text: "Нотаток за цим запитом немає.", cls: "fc-zgraph-drawer-empty" });
        return;
      }
      for (const note of filteredNotes.slice(0, listLimit)) {
        const zoneMeta = model.zones.find((z) => z.id === note.zoneId);
        const li = list.createEl("li", { cls: "fc-zgraph-drawer-item" });
        if (zoneMeta?.color) li.style?.setProperty?.("--fc-z-color", zoneMeta.color);
        const rowBtn = li.createEl("button", {
          cls: "fc-zgraph-drawer-row",
          attr: { type: "button", "data-fc-drawer-note": note.path, title: note.path },
        });
        rowBtn.createSpan({ text: note.title, cls: "fc-zgraph-drawer-note-title" });
        const shortFolder = String(note.folder || "").split("/").filter(Boolean).slice(-2).join("/");
        const meta = [note.dateInfo?.label, shortFolder, ...(note.topics || []).slice(0, 2).map((t) => `#${t}`)].filter(Boolean);
        if (meta.length) {
          const metaEl = rowBtn.createSpan({ cls: "fc-zgraph-drawer-note-meta" });
          metaEl.createSpan({ cls: "fc-zgraph-drawer-zone-dot" });
          metaEl.createSpan({ text: meta.join(" · "), cls: "fc-zgraph-drawer-note-meta-txt" });
        }
        rowBtn.addEventListener("click", () => {
          selectedNodeId = note.id;
          focusNode(note.id);
          renderDrawer();
          if (physicsLayout === "gantt") renderGanttView();
        });
        const quickOpen = li.createEl("button", {
          cls: "fc-zgraph-drawer-open",
          attr: { type: "button", "aria-label": `Відкрити ${note.title}`, title: "Відкрити нотатку" },
        });
        const openSvg = fcGraphIconSvg("open", doc, 13);
        if (openSvg) quickOpen.append(openSvg);
        else quickOpen.setText("↗");
        quickOpen.addEventListener("click", () => void openVaultPath(note.path));
      }
      if (listLimit < filteredNotes.length) {
        const moreBtn = body.createEl("button", {
          text: `Показати ще (${filteredNotes.length - listLimit})`,
          cls: "fc-zgraph-drawer-more",
          attr: { type: "button", "data-fc-drawer-more": "" },
        });
        moreBtn.addEventListener("click", () => {
          listLimit += GRAPH_PAGE;
          renderDrawer();
        });
      }
    };

    function renderGanttView() {
      if (!model || physicsLayout !== "gantt") return;
      ganttEl.empty?.();
      const filteredNotes = getFilteredNotes();
      const dated = filteredNotes.filter((n) => Number.isFinite(n.startMs));
      const undated = filteredNotes.filter((n) => !Number.isFinite(n.startMs));
      const catMeta = FC_GRAPH_CATEGORIZATIONS[mode] || FC_GRAPH_CATEGORIZATIONS.domains;
      const projectGroupedModes = mode === "domains" || mode === "hubs";

      // 1. Gantt Controls Header Bar
      const gHead = ganttEl.createDiv({ cls: "fc-zgraph-gantt-head" });
      const gInfo = gHead.createDiv({ cls: "fc-zgraph-gantt-info" });
      gInfo.createSpan({ text: catMeta.label, cls: "fc-zgraph-gantt-cat-badge" });
      gInfo.createSpan({
        text: `${dated.length} на шкалі` + (undated.length ? ` · ${undated.length} без дати` : ""),
        cls: "fc-zgraph-gantt-count",
      });

      const gControls = gHead.createDiv({ cls: "fc-zgraph-gantt-controls" });
      const zoomGrp = gControls.createDiv({ cls: "fc-zgraph-gantt-zoom-group", attr: { role: "group", "aria-label": "Масштаб часу" } });
      for (const [zKey, zLbl] of [["weeks", "Тижні"], ["months", "Місяці"], ["years", "Роки"]]) {
        const zb = zoomGrp.createEl("button", {
          text: zLbl,
          cls: "fc-zgraph-gantt-ctrl-btn" + (ganttZoom === zKey ? " is-active" : ""),
          attr: { type: "button", "data-fc-gantt-zoom": zKey, "aria-pressed": String(ganttZoom === zKey) },
        });
        zb.addEventListener("click", () => {
          if (ganttZoom === zKey) return;
          ganttZoom = zKey;
          ganttScrollTodayNext = false;
          renderGanttView();
        });
      }

      const todayBtn = gControls.createEl("button", {
        text: "Сьогодні",
        cls: "fc-zgraph-gantt-ctrl-btn fc-zgraph-gantt-today-btn",
        attr: { type: "button", "data-fc-gantt-today": "", title: "Прокрутити шкалу до поточної дати" },
      });

      const activeZonesForGantt = model.zones.filter((z) => !activeZone || z.id === activeZone);
      const allCollapsed = activeZonesForGantt.length > 0 && activeZonesForGantt.every((z) => ganttCollapsedLanes.has(z.id));
      const collapseAllBtn = gControls.createEl("button", {
        text: allCollapsed ? "Розгорнути всі" : "Згорнути всі",
        cls: "fc-zgraph-gantt-ctrl-btn",
        attr: { type: "button", "data-fc-gantt-collapse-all": "" },
      });
      collapseAllBtn.addEventListener("click", () => {
        if (allCollapsed) ganttCollapsedLanes.clear();
        else activeZonesForGantt.forEach((z) => ganttCollapsedLanes.add(z.id));
        renderGanttView();
      });

      if (undated.length) {
        const undatedBtn = gControls.createEl("button", {
          text: `Постійна база (${undated.length})`,
          cls: "fc-zgraph-gantt-ctrl-btn" + (ganttShowUndated ? " is-active" : ""),
          attr: { type: "button", "data-fc-gantt-undated-toggle": "", "aria-pressed": String(ganttShowUndated) },
        });
        undatedBtn.addEventListener("click", () => {
          ganttShowUndated = !ganttShowUndated;
          renderGanttView();
        });
      }

      // 2. Time Range & Track Metrics
      const nowMs = Date.now();
      const dayMs = 86_400_000;
      const nowDate = new Date(nowMs);
      const nowYear = nowDate.getUTCFullYear();
      let rawMin = nowMs - 21 * dayMs;
      let rawMax = nowMs + 28 * dayMs;
      for (const n of dated) {
        if (n.startMs < rawMin) rawMin = n.startMs;
        const eMs = Number.isFinite(n.endMs) ? n.endMs : n.startMs;
        if (eMs > rawMax) rawMax = eMs;
      }
      const dStart = new Date(rawMin);
      const minMs = Date.UTC(dStart.getUTCFullYear(), dStart.getUTCMonth(), 1);
      const dEnd = new Date(rawMax);
      const maxMs = Date.UTC(dEnd.getUTCFullYear(), dEnd.getUTCMonth() + 1, 1);
      const spanMs = Math.max(28 * dayMs, maxMs - minMs);
      const totalDays = Math.max(28, Math.round(spanMs / dayMs));
      const pxPerDay = ganttZoom === "weeks" ? 11.5 : ganttZoom === "years" ? 1.15 : 3.6;
      const trackPx = Math.max(640, Math.min(9200, Math.round(totalDays * pxPerDay)));
      const xPct = (ms) => Math.max(0, Math.min(100, ((ms - minMs) / spanMs) * 100));
      const wPct = (sMs, eMs) => {
        const left = xPct(sMs);
        const end = Math.max(sMs + dayMs, Number.isFinite(eMs) ? eMs : sMs + dayMs);
        const rawW = ((end - sMs) / spanMs) * 100;
        return Math.max(0.9, Math.min(100 - left, rawW));
      };
      const todayPct = xPct(nowMs);

      const scrollWrap = ganttEl.createDiv({ cls: "fc-zgraph-gantt-scroll" });
      const grid = scrollWrap.createDiv({ cls: "fc-zgraph-gantt-grid" });
      grid.style?.setProperty?.("--fc-gantt-track-w", `${trackPx}px`);

      // Sticky Timeline Ruler Row
      const rulerRow = grid.createDiv({ cls: "fc-zgraph-gantt-ruler-row" });
      rulerRow.createDiv({
        text: projectGroupedModes ? `${catMeta.label} / Проєкти` : `${catMeta.label} / Нотатки`,
        cls: "fc-zgraph-gantt-corner",
      });
      const rulerTrack = rulerRow.createDiv({ cls: "fc-zgraph-gantt-ruler-track" });

      const yearGuides = [];
      const minYear = new Date(minMs).getUTCFullYear();
      const maxYear = new Date(maxMs - dayMs).getUTCFullYear();
      for (let y = minYear; y <= maxYear; y++) {
        const yS = Math.max(minMs, Date.UTC(y, 0, 1));
        const yE = Math.min(maxMs, Date.UTC(y + 1, 0, 1));
        if (yE <= yS) continue;
        const lPct = xPct(yS);
        const segW = xPct(yE) - lPct;
        yearGuides.push({ year: y, leftPct: lPct, isCurrent: y === nowYear });
        const yBand = rulerTrack.createDiv({
          cls: "fc-zgraph-gantt-year-band" + (y === nowYear ? " is-current" : ""),
        });
        if (yBand.style) {
          yBand.style.left = `${lPct.toFixed(3)}%`;
          yBand.style.width = `${segW.toFixed(3)}%`;
        }
        yBand.createSpan({ text: String(y), cls: "fc-zgraph-gantt-year-lbl" });
      }

      // Secondary ticks (Weeks vs Months vs Quarters)
      const ticksWrap = rulerTrack.createDiv({ cls: "fc-zgraph-gantt-ticks" });
      if (ganttZoom === "weeks") {
        const stepMs = 7 * dayMs;
        let cur = minMs;
        let guard = 0;
        while (cur < maxMs && guard++ < 96) {
          const td = new Date(cur);
          const lbl = `${String(td.getUTCDate()).padStart(2, "0")}.${String(td.getUTCMonth() + 1).padStart(2, "0")}`;
          const tk = ticksWrap.createSpan({ text: lbl, cls: "fc-zgraph-gantt-tick" });
          if (tk.style) tk.style.left = `${xPct(cur).toFixed(3)}%`;
          cur += stepMs;
        }
      } else {
        const monthStep = ganttZoom === "years" ? 3 : 1;
        let cy = minYear;
        let cm = new Date(minMs).getUTCMonth();
        let guard = 0;
        while (guard++ < 96) {
          const curMs = Date.UTC(cy, cm, 1);
          if (curMs >= maxMs) break;
          const tk = ticksWrap.createSpan({ text: SHORT_MONTHS_UK[cm] || String(cm + 1), cls: "fc-zgraph-gantt-tick" });
          if (tk.style) tk.style.left = `${xPct(curMs).toFixed(3)}%`;
          cm += monthStep;
          while (cm >= 12) { cm -= 12; cy++; }
        }
      }

      const todayMarker = rulerTrack.createDiv({ cls: "fc-zgraph-gantt-today-flag", text: "Сьогодні" });
      if (todayMarker.style) todayMarker.style.left = `${todayPct.toFixed(3)}%`;

      const scrollToToday = (smooth = true) => {
        const targetX = Math.max(0, Math.round((todayPct / 100) * trackPx - 260));
        scrollWrap.scrollLeft = targetX;
        if (typeof scrollWrap.scrollTo === "function") {
          scrollWrap.scrollTo({ left: targetX, behavior: smooth ? "smooth" : "auto" });
        }
      };
      todayBtn.addEventListener("click", () => scrollToToday(true));

      const dateFmt = new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "short", year: "2-digit" });
      const fmtSpan = (sMs, eMs) => {
        const sTxt = dateFmt.format(new Date(sMs));
        if (!Number.isFinite(eMs) || Math.abs(eMs - sMs) < dayMs) return sTxt;
        return `${sTxt} → ${dateFmt.format(new Date(eMs))}`;
      };

      const appendGuidesToTrack = (trackEl) => {
        for (const yg of yearGuides) {
          const line = trackEl.createSpan({ cls: "fc-zgraph-gantt-year-line" + (yg.isCurrent ? " is-current" : "") });
          if (line.style) line.style.left = `${yg.leftPct.toFixed(3)}%`;
        }
        const tLine = trackEl.createSpan({ cls: "fc-zgraph-gantt-today-line" });
        if (tLine.style) tLine.style.left = `${todayPct.toFixed(3)}%`;
      };

      const renderNoteRow = (note, color) => {
        const row = grid.createDiv({
          cls: "fc-zgraph-gantt-row" + (selectedNodeId === note.id ? " is-selected" : ""),
          attr: { "data-fc-gantt-note": note.path },
        });
        row.style?.setProperty?.("--fc-z-color", color);
        const lCell = row.createDiv({ cls: "fc-zgraph-gantt-label-cell" });
        const selectBtn = lCell.createEl("button", {
          cls: "fc-zgraph-gantt-note-btn",
          attr: { type: "button", title: `${note.title} · ${note.path}` },
        });
        selectBtn.createSpan({ text: note.title, cls: "fc-zgraph-gantt-note-title" });
        const metaParts = [note.dateInfo?.label, note.statusLabel].filter(Boolean);
        if (metaParts.length) selectBtn.createSpan({ text: metaParts.join(" · "), cls: "fc-zgraph-gantt-note-meta" });
        selectBtn.addEventListener("click", () => {
          selectedNodeId = note.id;
          drawerOpen = true;
          renderDrawer();
          renderGanttView();
        });
        selectBtn.addEventListener("dblclick", () => void openVaultPath(note.path));

        const openIconBtn = lCell.createEl("button", {
          cls: "fc-zgraph-gantt-open-btn",
          attr: { type: "button", "aria-label": `Відкрити ${note.title}`, title: "Відкрити нотатку" },
        });
        const oSvg = fcGraphIconSvg("open", doc, 12);
        if (oSvg) openIconBtn.append(oSvg); else openIconBtn.setText("↗");
        openIconBtn.addEventListener("click", () => void openVaultPath(note.path));

        const track = row.createDiv({ cls: "fc-zgraph-gantt-track" });
        appendGuidesToTrack(track);

        const endMs = Number.isFinite(note.endMs) ? note.endMs : note.startMs;
        const barW = wPct(note.startMs, endMs);
        const bar = track.createEl("button", {
          cls: "fc-zgraph-gantt-bar" + (selectedNodeId === note.id ? " is-selected" : ""),
          attr: {
            type: "button",
            title: `${note.title}\n${fmtSpan(note.startMs, endMs)}${note.projectLabel ? `\nПроєкт: ${note.projectLabel}` : ""}`,
          },
        });
        if (bar.style) {
          bar.style.left = `${xPct(note.startMs).toFixed(3)}%`;
          bar.style.width = `${barW.toFixed(3)}%`;
        }
        if (barW >= 4.5) {
          bar.createSpan({ text: note.title, cls: "fc-zgraph-gantt-bar-lbl" });
        }
        bar.addEventListener("click", () => {
          selectedNodeId = note.id;
          drawerOpen = true;
          renderDrawer();
          renderGanttView();
        });
        bar.addEventListener("dblclick", () => void openVaultPath(note.path));

        if (Array.isArray(note.milestones) && note.milestones.length > 1) {
          for (const m of note.milestones.slice(0, 5)) {
            const ms = Number(m?.ms);
            if (!Number.isFinite(ms)) continue;
            const dEl = track.createSpan({
              cls: "fc-zgraph-gantt-milestone",
              attr: { title: `${m.source || "Етап"}: ${m.label}` },
            });
            if (dEl.style) dEl.style.left = `${xPct(ms).toFixed(3)}%`;
          }
        }
      };

      // 3. Categorization Lanes & Sub-Project Rollups
      const byZoneDated = new Map();
      for (const n of dated) {
        if (!byZoneDated.has(n.zoneId)) byZoneDated.set(n.zoneId, []);
        byZoneDated.get(n.zoneId).push(n);
      }

      let renderedDatedLanes = 0;
      for (const z of activeZonesForGantt) {
        const zNotes = (byZoneDated.get(z.id) || []).slice().sort((a, b) => a.startMs - b.startMs || a.title.localeCompare(b.title, "uk"));
        if (!zNotes.length) continue;
        renderedDatedLanes++;
        const collapsed = ganttCollapsedLanes.has(z.id);
        let zMin = Infinity, zMax = -Infinity;
        for (const n of zNotes) {
          if (n.startMs < zMin) zMin = n.startMs;
          const e = Number.isFinite(n.endMs) ? n.endMs : n.startMs;
          if (e > zMax) zMax = e;
        }

        const laneRow = grid.createDiv({
          cls: "fc-zgraph-gantt-lane-row" + (collapsed ? " is-collapsed" : ""),
          attr: { "data-fc-gantt-lane": z.id },
        });
        laneRow.style?.setProperty?.("--fc-z-color", z.color);
        const laneBtn = laneRow.createEl("button", {
          cls: "fc-zgraph-gantt-lane-btn",
          attr: { type: "button", "aria-expanded": String(!collapsed) },
        });
        laneBtn.createSpan({ text: collapsed ? "▸" : "▾", cls: "fc-zgraph-gantt-chev" });
        laneBtn.createSpan({ cls: "fc-zgraph-zone-dot" });
        laneBtn.createSpan({ text: z.label, cls: "fc-zgraph-gantt-lane-title" });
        laneBtn.createSpan({ text: String(zNotes.length), cls: "fc-zgraph-gantt-lane-cnt" });
        laneBtn.addEventListener("click", () => {
          if (ganttCollapsedLanes.has(z.id)) ganttCollapsedLanes.delete(z.id);
          else ganttCollapsedLanes.add(z.id);
          renderGanttView();
        });

        const laneTrack = laneRow.createDiv({ cls: "fc-zgraph-gantt-track" });
        appendGuidesToTrack(laneTrack);
        const laneBar = laneTrack.createDiv({
          cls: "fc-zgraph-gantt-lane-bar",
          attr: { title: `${z.label}: ${fmtSpan(zMin, zMax)}` },
        });
        if (laneBar.style) {
          laneBar.style.left = `${xPct(zMin).toFixed(3)}%`;
          laneBar.style.width = `${wPct(zMin, zMax).toFixed(3)}%`;
        }
        laneBar.createSpan({ text: fmtSpan(zMin, zMax), cls: "fc-zgraph-gantt-lane-span" });

        if (collapsed) continue;

        const rowCap = ganttExpandedLanes.has(z.id) ? zNotes.length : 40;
        const projMap = new Map();
        for (const n of zNotes) {
          const pKey = n.projectKey || "__general__";
          if (!projMap.has(pKey)) {
            projMap.set(pKey, { key: pKey, label: n.projectLabel || "Загальний потік", items: [], minMs: Infinity, maxMs: -Infinity });
          }
          const grp = projMap.get(pKey);
          grp.items.push(n);
          if (n.startMs < grp.minMs) grp.minMs = n.startMs;
          const e = Number.isFinite(n.endMs) ? n.endMs : n.startMs;
          if (e > grp.maxMs) grp.maxMs = e;
        }
        const projectGroups = [...projMap.values()].sort((a, b) => a.minMs - b.minMs);
        const showProjects = (projectGroupedModes && projectGroups.length >= 2)
          || (!projectGroupedModes && projectGroups.length >= 3 && zNotes.length >= 8);

        let emitted = 0;
        if (showProjects) {
          for (const proj of projectGroups) {
            if (emitted >= rowCap) break;
            const pRow = grid.createDiv({ cls: "fc-zgraph-gantt-project-row" });
            pRow.style?.setProperty?.("--fc-z-color", z.color);
            const pCell = pRow.createDiv({ cls: "fc-zgraph-gantt-project-cell" });
            pCell.createSpan({ text: proj.label, cls: "fc-zgraph-gantt-project-title", attr: { title: proj.label } });
            pCell.createSpan({ text: String(proj.items.length), cls: "fc-zgraph-gantt-project-cnt" });
            const pTrack = pRow.createDiv({ cls: "fc-zgraph-gantt-track" });
            appendGuidesToTrack(pTrack);
            const pBar = pTrack.createDiv({ cls: "fc-zgraph-gantt-project-bar", attr: { title: `${proj.label}: ${fmtSpan(proj.minMs, proj.maxMs)}` } });
            if (pBar.style) {
              pBar.style.left = `${xPct(proj.minMs).toFixed(3)}%`;
              pBar.style.width = `${wPct(proj.minMs, proj.maxMs).toFixed(3)}%`;
            }
            for (const item of proj.items) {
              if (emitted >= rowCap) break;
              renderNoteRow(item, z.color);
              emitted++;
            }
          }
        } else {
          for (const item of zNotes.slice(0, rowCap)) {
            renderNoteRow(item, z.color);
          }
        }

        if (zNotes.length > rowCap) {
          const moreRow = grid.createDiv({ cls: "fc-zgraph-gantt-more-row" });
          const moreBtn = moreRow.createEl("button", {
            text: `Показати ще ${zNotes.length - rowCap} у «${z.label}»`,
            cls: "fc-zgraph-drawer-more",
            attr: { type: "button", "data-fc-gantt-expand-lane": z.id },
          });
          moreBtn.addEventListener("click", () => {
            ganttExpandedLanes.add(z.id);
            renderGanttView();
          });
        }
      }

      if (!renderedDatedLanes) {
        grid.createDiv({
          text: "Немає нотаток із датами за активними фільтрами.",
          cls: "fc-zgraph-gantt-empty",
        });
      }

      if (undated.length && (ganttShowUndated || !renderedDatedLanes)) {
        const uBox = ganttEl.createDiv({ cls: "fc-zgraph-gantt-undated" });
        uBox.createDiv({ text: `Постійна база без дати (${undated.length})`, cls: "fc-zgraph-gantt-undated-title" });
        const uGrid = uBox.createDiv({ cls: "fc-zgraph-gantt-undated-grid" });
        for (const u of undated.slice(0, 60)) {
          const chip = uGrid.createEl("button", {
            text: u.title,
            cls: "fc-zgraph-gantt-undated-chip" + (selectedNodeId === u.id ? " is-selected" : ""),
            attr: { type: "button", title: u.path },
          });
          chip.addEventListener("click", () => {
            selectedNodeId = u.id;
            drawerOpen = true;
            renderDrawer();
            renderGanttView();
          });
        }
      }

      if (ganttScrollTodayNext) {
        ganttScrollTodayNext = false;
        scrollToToday(false);
      }
    }

    const syncDateUi = () => {
      for (const [k, b] of datePresetBtns) {
        const on = !monthBucket && !dateFrom && !dateTo && datePreset === k;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-pressed", String(on));
      }
      if (monthSelect) monthSelect.value = monthBucket || "*";
    };

    const applyFilters = () => {
      if (!model) return;
      const needle = query.trim().toLocaleLowerCase("uk").replace(/^#/, "");
      clearSearchBtn.hidden = !query.trim();
      for (const pill of zoneBar.querySelectorAll("[data-fc-zone-id]")) {
        const pressed = (pill.getAttribute("data-fc-zone-id") || "") === (activeZone || "");
        pill.classList.toggle("is-active", pressed);
        pill.setAttribute("aria-pressed", String(pressed));
      }
      matchedIds.clear();
      for (const n of model.nodes) {
        const zOk = !activeZone || n.zoneId === activeZone;
        const qOk = !needle || (searchText.get(n.id) || "").includes(needle);
        if (zOk && qOk) matchedIds.add(n.id);
      }
      canvasEl.setAttribute("aria-label", `Граф FlightClub: ${model.totalNotesCount} нотаток, ${model.edges.length} зв’язків`);
      renderDrawer();
      if (physicsLayout === "gantt") renderGanttView();
      else scheduleRender();
    };

    const syncLayoutUi = () => {
      wrap.setAttribute("data-fc-physics-layout", physicsLayout);
      const isGantt = physicsLayout === "gantt";
      for (const [lKey, lBtn] of layoutModeBtns) {
        const active = lKey === physicsLayout;
        lBtn.classList.toggle("is-active", active);
        lBtn.setAttribute("aria-pressed", String(active));
      }
      const nextIdx = (GRAPH_LAYOUT_ORDER.indexOf(physicsLayout) + 1) % GRAPH_LAYOUT_ORDER.length;
      const nextMeta = GRAPH_LAYOUT_META[GRAPH_LAYOUT_ORDER[nextIdx]];
      const curMeta = GRAPH_LAYOUT_META[physicsLayout] || GRAPH_LAYOUT_META.obsidian;
      layoutToggleBtn.setAttribute("data-fc-layout-current", physicsLayout);
      layoutToggleBtn.setAttribute("aria-pressed", String(physicsLayout === "obsidian"));
      layoutToggleBtn.title = `Вигляд «${curMeta.label}» · Натисніть для «${nextMeta.label}»`;
      canvasEl.hidden = isGantt;
      controls.hidden = isGantt;
      watermark.hidden = isGantt;
      ganttEl.hidden = !isGantt;
      physicsPanel.hidden = isGantt;
      if (isGantt) tipEl.hidden = true;
      updateZoomReadout();
    };

    const syncModeUi = () => {
      wrap.setAttribute("data-fc-zone-graph", mode);
      for (const [k, b] of modeButtons) {
        b.classList.toggle("is-active", k === mode);
        b.setAttribute("aria-pressed", String(k === mode));
      }
      const tagOn = effectiveIncludeTagNodes();
      tagNodesToggle.classList.toggle("is-active", tagOn);
      tagNodesToggle.setAttribute("aria-pressed", String(tagOn));
    };

    const switchMode = (key) => {
      if (!Object.hasOwn(FC_GRAPH_CATEGORIZATIONS, key) || mode === key) return;
      mode = key;
      this.zoneGraphMode = key;
      activeZone = null;
      selectedNodeId = null;
      listLimit = GRAPH_PAGE;
      syncModeUi();
      rebuild();
    };

    for (const [key, label] of MODE_ORDER) {
      const cat = FC_GRAPH_CATEGORIZATIONS[key];
      const btn = modeRow.createEl("button", {
        text: label,
        cls: "fc-zgraph-mode-btn" + (mode === key ? " is-active" : ""),
        attr: { type: "button", "aria-pressed": String(mode === key), "data-fc-graph-mode": key, title: cat?.desc || label },
      });
      modeButtons.set(key, btn);
      btn.addEventListener("click", () => switchMode(key));
    }

    const rebuild = ({ preserveViewport = false, prevPositions = null } = {}) => {
      physicsAlpha = 0;
      physicsFrame = 0;
      hoveredId = null;
      hoveredZoneHeaderId = null;
      tipEl.hidden = true;
      theme = readTheme();
      const useTagNodes = effectiveIncludeTagNodes();
      model = this.buildObsidianZoneGraphModel(mode, {
        includeTagNodes: useTagNodes,
        activeTag,
        datePreset,
        dateFrom,
        dateTo,
        monthBucket,
        connectedOnly,
        physicsLayout,
        prevPositions,
        forces,
      });
      // Deterministic gentle curve direction per edge
      for (let i = 0; i < model.edges.length; i++) {
        model.edges[i].curveDir = i % 2 === 0 ? 1 : -1;
      }

      const activeFilters = Number(Boolean(activeTag)) + Number(datePreset !== "all" || Boolean(monthBucket) || Boolean(dateFrom) || Boolean(dateTo))
        + Number(useTagNodes) + Number(connectedOnly);
      filterLabelText.setText(activeFilters ? `Фільтри · ${activeFilters}` : "Фільтри");
      resetFiltersBtn.hidden = activeFilters === 0;
      removeNativeBtn.hidden = !this.graphPreset;

      adjacency.clear();
      searchText.clear();
      nodeById.clear();
      const zoneLabelById = new Map(model.zones.map((z) => [z.id, z.label]));
      for (const n of model.nodes) {
        nodeById.set(n.id, n);
        adjacency.set(n.id, new Set([n.id]));
        const zLbl = zoneLabelById.get(n.zoneId) || "";
        searchText.set(
          n.id,
          [n.title, n.path, n.folder, n.statusLabel, n.dateLabel, n.itemHolder, zLbl, ...(n.tags || []), ...(n.topics || [])]
            .filter(Boolean)
            .join(" ")
            .toLocaleLowerCase("uk"),
        );
      }
      if (selectedNodeId && !nodeById.has(selectedNodeId)) selectedNodeId = null;
      for (const e of model.edges) {
        adjacency.get(e.source)?.add(e.target);
        adjacency.get(e.target)?.add(e.source);
      }
      spatialGrid = fcBuildGraphSpatialGrid(model.nodes, 48);

      // Populate Month <select> inside Фільтри popover
      monthSelect.empty?.();
      monthSelect.createEl("option", { text: "Усі дати", attr: { value: "*" } });
      for (const [ym] of model.allMonths || []) {
        monthSelect.createEl("option", { text: monthTitle(ym), attr: { value: ym } });
      }
      monthSelect.value = monthBucket || "*";

      // Monthly Timeline Histogram
      histogramWrap.empty?.();
      if (model.monthBuckets?.length) {
        const maxM = Math.max(1, ...model.monthBuckets.map(([, c]) => c));
        for (const [ym, count] of model.monthBuckets) {
          const isAct = monthBucket === ym;
          const barBtn = histogramWrap.createEl("button", {
            cls: "fc-zgraph-hist-bar" + (isAct ? " is-active" : ""),
            attr: { type: "button", "data-fc-month-bucket": ym, "aria-pressed": String(isAct), title: `${ym}: ${count} нотаток` },
          });
          const fill = barBtn.createSpan({ cls: "fc-zgraph-hist-fill" });
          fill.style?.setProperty?.("height", `${Math.max(18, Math.round((count / maxM) * 100))}%`);
          barBtn.createSpan({ text: ym.slice(5), cls: "fc-zgraph-hist-lbl" });
          barBtn.addEventListener("click", () => {
            monthBucket = monthBucket === ym ? null : ym;
            syncDateUi();
            rebuild();
          });
        }
      }

      // Smart Obsidian Tags Strip
      tagBar.empty?.();
      if (model.allTags?.length) {
        tagBar.createSpan({ text: "Теги:", cls: "fc-zgraph-bar-label" });
        const allTagBtn = tagBar.createEl("button", {
          text: "Усі теги",
          cls: "fc-zgraph-tag-pill" + (!activeTag ? " is-active" : ""),
          attr: { type: "button", "data-fc-graph-tag": "" },
        });
        allTagBtn.addEventListener("click", () => { activeTag = null; rebuild(); });
        for (const [tName, tCount] of model.allTags.slice(0, expanded || isTabView ? 18 : 10)) {
          const tb = tagBar.createEl("button", {
            text: `#${tName} (${tCount})`,
            cls: "fc-zgraph-tag-pill" + (activeTag === tName ? " is-active" : ""),
            attr: { type: "button", "data-fc-graph-tag": `#${tName}`, "aria-pressed": String(activeTag === tName), title: `Фільтрувати за тегом #${tName}` },
          });
          tb.addEventListener("click", () => {
            activeTag = activeTag === tName ? null : tName;
            rebuild();
          });
        }
      }

      // Slim Zone Chips Bar
      zoneBar.empty?.();
      const allBtn = zoneBar.createEl("button", {
        text: `Усі (${model.totalNotesCount})`,
        cls: "fc-zgraph-zone-pill" + (!activeZone ? " is-active" : ""),
        attr: { type: "button", "data-fc-zone-id": "" },
      });
      allBtn.addEventListener("click", () => {
        activeZone = null;
        listLimit = GRAPH_PAGE;
        applyFilters();
        fitView(null);
      });
      for (const z of model.zones) {
        const zb = zoneBar.createEl("button", {
          cls: "fc-zgraph-zone-pill" + (activeZone === z.id ? " is-active" : ""),
          attr: { type: "button", "data-fc-zone-id": z.id, title: `Ізолювати зону «${z.label}» (${z.count})` },
        });
        zb.style?.setProperty?.("--fc-z-color", z.color);
        zb.createSpan({ cls: "fc-zgraph-zone-dot" });
        zb.createSpan({ text: z.label });
        zb.createSpan({ text: String(z.count), cls: "fc-zgraph-zone-cnt" });
        zb.addEventListener("click", () => {
          activeZone = activeZone === z.id ? null : z.id;
          listLimit = GRAPH_PAGE;
          applyFilters();
          fitView(activeZone);
        });
      }

      applyFilters();
      if (physicsLayout === "gantt") {
        physicsAlpha = 0;
      } else {
        if (!preserveViewport) fitView(activeZone, { immediate: true });
        else scheduleRender();
        if (!prefersReducedMotion() && model?.nodes?.length) {
          physicsAlpha = physicsLayout === "roadmap" ? 0.55 : 0.75;
          scheduleRender();
        }
      }
    };

    const setPhysicsLayout = (nextLayout) => {
      const target = GRAPH_LAYOUT_ORDER.includes(nextLayout) ? nextLayout : "obsidian";
      if (target === physicsLayout && model) return;
      const prevPositions = new Map();
      if (model?.nodes?.length) {
        for (const n of model.nodes) {
          prevPositions.set(n.id, { x: n.x, y: n.y, vx: n.vx, vy: n.vy });
        }
      }
      physicsLayout = target;
      ganttScrollTodayNext = target === "gantt";
      syncLayoutUi();
      rebuild({ prevPositions, preserveViewport: false });
    };

    // Toolbar & Filter interactions
    for (const [lKey, lBtn] of layoutModeBtns) {
      lBtn.addEventListener("click", () => setPhysicsLayout(lKey));
    }
    layoutToggleBtn.addEventListener("click", () => {
      const idx = GRAPH_LAYOUT_ORDER.indexOf(physicsLayout);
      const next = GRAPH_LAYOUT_ORDER[(idx + 1) % GRAPH_LAYOUT_ORDER.length];
      setPhysicsLayout(next);
    });
    tagNodesToggle.addEventListener("click", () => {
      if (mode === "topics") topicsTagNodesOverride = !effectiveIncludeTagNodes();
      else userIncludeTagNodes = !userIncludeTagNodes;
      syncModeUi();
      rebuild();
    });
    connectedToggle.addEventListener("click", () => {
      connectedOnly = !connectedOnly;
      connectedToggle.classList.toggle("is-active", connectedOnly);
      connectedToggle.setAttribute("aria-pressed", String(connectedOnly));
      rebuild();
    });
    resetFiltersBtn.addEventListener("click", () => {
      activeTag = null;
      connectedOnly = false;
      datePreset = "all";
      dateFrom = "";
      dateTo = "";
      monthBucket = null;
      fromInput.value = "";
      toInput.value = "";
      if (mode === "topics") topicsTagNodesOverride = null;
      else userIncludeTagNodes = false;
      connectedToggle.classList.remove("is-active");
      connectedToggle.setAttribute("aria-pressed", "false");
      syncModeUi();
      syncDateUi();
      rebuild();
    });
    for (const [pKey, b] of datePresetBtns) {
      b.addEventListener("click", () => {
        datePreset = pKey;
        monthBucket = null;
        dateFrom = "";
        dateTo = "";
        fromInput.value = "";
        toInput.value = "";
        syncDateUi();
        rebuild();
      });
    }
    monthSelect.addEventListener("change", () => {
      const val = monthSelect.value;
      monthBucket = val === "*" ? null : val;
      if (monthBucket) {
        dateFrom = "";
        dateTo = "";
        fromInput.value = "";
        toInput.value = "";
      }
      syncDateUi();
      rebuild();
    });
    const onCustomDateChange = () => {
      dateFrom = fromInput.value || "";
      dateTo = toInput.value || "";
      monthBucket = null;
      datePreset = (dateFrom || dateTo) ? "custom" : "all";
      syncDateUi();
      rebuild();
    };
    fromInput.addEventListener("change", onCustomDateChange);
    toInput.addEventListener("change", onCustomDateChange);

    drawerBtn.addEventListener("click", () => {
      drawerOpen = !drawerOpen;
      if (!drawerOpen) selectedNodeId = null;
      renderDrawer();
      scheduleRender();
    });
    refreshBtn.addEventListener("click", () => {
      rebuild({ preserveViewport: true });
      void this.loadGraphEntityVisuals().then((updated) => {
        if (updated && !destroyed) rebuild({ preserveViewport: true });
      });
    });

    const visibleIds = () => new Set(matchedIds);
    const runNativePreset = async (remove) => {
      nativeBtn.disabled = removeNativeBtn.disabled = true;
      actionsMenu.open = false;
      try {
        const extra = activeTag ? `tag:#${activeTag}` : "";
        const result = remove
          ? await updateNativeGraph(this, null)
          : await this.applyNativeObsidianGraphPreset(mode, true, extra, model?.rawRecords || null);
        if (destroyed) return;
        removeNativeBtn.hidden = !this.graphPreset;
        statusLine.hidden = false;
        statusLine.setText(result.ok ? (remove ? "Групи FlightClub прибрано." : "Групи застосовано.") : "Граф не оновлено.");
        if (result.ok && !remove) onCloseModal?.();
      } finally {
        if (!destroyed) nativeBtn.disabled = removeNativeBtn.disabled = false;
      }
    };
    nativeBtn.addEventListener("click", () => void runNativePreset(false));
    removeNativeBtn.addEventListener("click", () => void runNativePreset(true));
    for (const [btnEl, optsFn] of [
      [canvasShowcaseBtn, () => ({ showcase: true, shuffleSeed: 0, replaceLatest: true, visibleIds: visibleIds() })],
      [canvasShuffleBtn, () => ({ showcase: true, shuffle: true, replaceLatest: true, visibleIds: visibleIds() })],
      [canvasOverviewBtn, () => ({ maxPerZone: 4, visibleIds: visibleIds() })],
    ]) {
      btnEl.addEventListener("click", async () => {
        if (!model) return;
        btnEl.disabled = true;
        try {
          const result = await this.exportObsidianZoneCanvas(mode, model, optsFn());
          if (result.ok) actionsMenu.open = false;
        } finally {
          if (!destroyed) btnEl.disabled = false;
        }
      });
    }

    searchInput.addEventListener("input", () => {
      query = searchInput.value;
      listLimit = GRAPH_PAGE;
      clearTimeout(searchTimer);
      applyFilters();
    });
    clearSearchBtn.addEventListener("click", () => {
      searchInput.value = "";
      query = "";
      listLimit = GRAPH_PAGE;
      applyFilters();
      searchInput.focus();
    });

    // Canvas2D Pointer & Keyboard Engine
    const screenToStage = (clientX, clientY) => {
      const rect = canvasEl.getBoundingClientRect?.() || stage.getBoundingClientRect?.() || { left: 0, top: 0 };
      return { sx: clientX - rect.left, sy: clientY - rect.top };
    };
    const hitTestZoneHeader = (wx, wy) => {
      if (!model) return null;
      for (let i = model.zones.length - 1; i >= 0; i--) {
        const z = model.zones[i];
        const x0 = z.x - z.rx;
        const y0 = z.y - z.ry;
        if (wx >= x0 && wx <= x0 + z.rx * 2 && wy >= y0 && wy <= y0 + 36) return z;
      }
      return null;
    };
    const hitTestZoneBody = (wx, wy) => {
      if (!model) return null;
      for (let i = model.zones.length - 1; i >= 0; i--) {
        const z = model.zones[i];
        if (wx >= z.x - z.rx && wx <= z.x + z.rx && wy >= z.y - z.ry && wy <= z.y + z.ry) return z;
      }
      return null;
    };
    const updateTip = (node) => {
      if (!node) { tipEl.hidden = true; return; }
      const tagLine = node.tags?.length ? `🏷️ ${node.tags.slice(0, 5).map((t) => "#" + t).join(" ")}` : "";
      const dateBit = node.dateLabel ? ` · 📅 ${node.dateLabel}` : "";
      tipEl.textContent = `${node.title}${node.statusLabel ? ` · ${node.statusLabel}` : ""}${dateBit}\n${node.folder || "Корінь"} · ${node.degree} зв’язків${tagLine ? "\n" + tagLine : ""}`;
      tipEl.hidden = false;
    };

    let panDrag = null;
    let nodeDrag = null;
    let zoneDrag = null;

    canvasEl.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !model) return;
      const { sx, sy } = screenToStage(e.clientX, e.clientY);
      const wx = (sx - tx) / scale;
      const wy = (sy - ty) / scale;
      const hitNode = spatialGrid.hitTest(wx, wy, scale, selectedNodeId || hoveredId);
      if (hitNode) {
        nodeDrag = { node: hitNode, startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false };
        hitNode.fx = hitNode.x;
        hitNode.fy = hitNode.y;
        canvasEl.setPointerCapture?.(e.pointerId);
        return;
      }
      const hitHeader = hitTestZoneHeader(wx, wy);
      if (hitHeader) {
        zoneDrag = { zone: hitHeader, startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false };
        canvasEl.setPointerCapture?.(e.pointerId);
        return;
      }
      panDrag = { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, moved: false, downWx: wx, downWy: wy };
    });

    canvasEl.addEventListener("pointermove", (e) => {
      if (zoneDrag && model) {
        const dx = (e.clientX - zoneDrag.lastX) / scale;
        const dy = (e.clientY - zoneDrag.lastY) / scale;
        if (!zoneDrag.moved && Math.hypot(e.clientX - zoneDrag.startX, e.clientY - zoneDrag.startY) >= 4) zoneDrag.moved = true;
        if (zoneDrag.moved) {
          const z = zoneDrag.zone;
          const zc = model.zoneCenters?.get(z.id);
          if (zc) { zc.x += dx; zc.y += dy; }
          z.x += dx; z.y += dy;
          const members = model.byZone?.get(z.id) || model.nodes.filter((n) => n.zoneId === z.id);
          for (const m of members) {
            m.x += dx; m.y += dy;
            model.positions?.set(m.id, { x: m.x, y: m.y });
          }
          spatialGrid = fcBuildGraphSpatialGrid(model.nodes, 48);
          zoneDrag.lastX = e.clientX;
          zoneDrag.lastY = e.clientY;
          scheduleRender();
        }
        return;
      }
      if (nodeDrag && model) {
        const dx = e.clientX - nodeDrag.lastX;
        const dy = e.clientY - nodeDrag.lastY;
        if (!nodeDrag.moved && Math.hypot(e.clientX - nodeDrag.startX, e.clientY - nodeDrag.startY) >= 4) nodeDrag.moved = true;
        if (nodeDrag.moved) {
          nodeDrag.node.fx = (nodeDrag.node.fx ?? nodeDrag.node.x) + dx / scale;
          nodeDrag.node.fy = (nodeDrag.node.fy ?? nodeDrag.node.y) + dy / scale;
          nodeDrag.node.x = nodeDrag.node.fx;
          nodeDrag.node.y = nodeDrag.node.fy;
          nodeDrag.lastX = e.clientX;
          nodeDrag.lastY = e.clientY;
          model.positions?.set(nodeDrag.node.id, { x: nodeDrag.node.x, y: nodeDrag.node.y });
          if (!prefersReducedMotion()) physicsAlpha = Math.max(physicsAlpha, 0.42);
          spatialGrid = fcBuildGraphSpatialGrid(model.nodes, 48);
          scheduleRender();
        }
        return;
      }
      if (panDrag) {
        if (!panDrag.moved && Math.hypot(e.clientX - panDrag.startX, e.clientY - panDrag.startY) >= 4) panDrag.moved = true;
        tx += e.clientX - panDrag.x;
        ty += e.clientY - panDrag.y;
        targetTx = tx;
        targetTy = ty;
        panDrag.x = e.clientX;
        panDrag.y = e.clientY;
        scheduleRender();
        return;
      }
      if (!model) return;
      const { sx, sy } = screenToStage(e.clientX, e.clientY);
      const wx = (sx - tx) / scale;
      const wy = (sy - ty) / scale;
      const hitNode = spatialGrid.hitTest(wx, wy, scale, selectedNodeId || hoveredId);
      const nextHoverId = hitNode ? hitNode.id : null;
      const hitHeader = !hitNode ? hitTestZoneHeader(wx, wy) : null;
      const nextZoneHeaderId = hitHeader ? hitHeader.id : null;
      if (nextHoverId !== hoveredId || nextZoneHeaderId !== hoveredZoneHeaderId) {
        hoveredId = nextHoverId;
        hoveredZoneHeaderId = nextZoneHeaderId;
        updateTip(hitNode);
        if (canvasEl.style) canvasEl.style.cursor = hitNode ? "pointer" : hitHeader ? "move" : "grab";
        scheduleRender();
      }
    });

    const endPointer = (e) => {
      if (zoneDrag) {
        const { zone, moved } = zoneDrag;
        zoneDrag = null;
        if (!moved) {
          activeZone = activeZone === zone.id ? null : zone.id;
          listLimit = GRAPH_PAGE;
          applyFilters();
          fitView(activeZone);
        }
      }
      if (nodeDrag) {
        const { node, moved } = nodeDrag;
        node.fx = null;
        node.fy = null;
        nodeDrag = null;
        if (!moved) {
          if ((e?.ctrlKey || e?.metaKey) && node.kind !== "tag") {
            void openVaultPath(node.path);
          } else {
            selectedNodeId = node.id;
            drawerOpen = true;
            renderDrawer();
            scheduleRender();
          }
        }
      }
      if (panDrag) {
        const { moved, downWx, downWy } = panDrag;
        panDrag = null;
        if (!moved) {
          const hitZone = hitTestZoneBody(downWx, downWy);
          if (hitZone) {
            activeZone = activeZone === hitZone.id ? null : hitZone.id;
            listLimit = GRAPH_PAGE;
            applyFilters();
            fitView(activeZone);
          } else if (selectedNodeId) {
            selectedNodeId = null;
            renderDrawer();
            scheduleRender();
          }
        }
      }
    };
    canvasEl.addEventListener("pointerup", endPointer);
    canvasEl.addEventListener("pointercancel", endPointer);
    canvasEl.addEventListener("pointerleave", () => {
      if (hoveredId || hoveredZoneHeaderId) {
        hoveredId = null;
        hoveredZoneHeaderId = null;
        updateTip(null);
        scheduleRender();
      }
    });
    canvasEl.addEventListener("dblclick", (e) => {
      if (!model) return;
      const { sx, sy } = screenToStage(e.clientX, e.clientY);
      const hitNode = spatialGrid.hitTest((sx - tx) / scale, (sy - ty) / scale, scale, selectedNodeId);
      if (!hitNode) return;
      if (hitNode.kind === "tag" && hitNode.tagName) {
        activeTag = activeTag === hitNode.tagName ? null : hitNode.tagName;
        rebuild();
      } else {
        void openVaultPath(hitNode.path);
      }
    });
    canvasEl.addEventListener("wheel", (e) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0014);
      const next = Math.max(0.08, Math.min(3.5, scale * factor));
      const { sx, sy } = screenToStage(e.clientX || stageW / 2, e.clientY || stageH / 2);
      const r = next / scale;
      tx = sx - (sx - tx) * r;
      ty = sy - (sy - ty) * r;
      scale = next;
      targetTx = tx;
      targetTy = ty;
      targetScale = scale;
      updateZoomReadout();
      scheduleRender();
    }, { passive: false });
    canvasEl.addEventListener("keydown", (e) => {
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomAroundCenter(1.25);
      } else if (e.key === "-") {
        e.preventDefault();
        zoomAroundCenter(1 / 1.25);
      } else if (e.key === "0") {
        e.preventDefault();
        fitView(activeZone);
      } else if (e.key === "Escape") {
        selectedNodeId = null;
        hoveredId = null;
        tipEl.hidden = true;
        renderDrawer();
        scheduleRender();
      } else if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        const step = 48;
        if (e.key === "ArrowLeft") targetTx += step;
        if (e.key === "ArrowRight") targetTx -= step;
        if (e.key === "ArrowUp") targetTy += step;
        if (e.key === "ArrowDown") targetTy -= step;
        scheduleRender();
      }
    });

    const zoomAroundCenter = (factor) => {
      updateCanvasSize();
      const next = Math.max(0.08, Math.min(3.5, targetScale * factor));
      const cx = stageW / 2;
      const cy = stageH / 2;
      const r = next / targetScale;
      targetTx = cx - (cx - targetTx) * r;
      targetTy = cy - (cy - targetTy) * r;
      targetScale = next;
      if (prefersReducedMotion() || !ctx) {
        scale = targetScale; tx = targetTx; ty = targetTy;
        updateZoomReadout();
      }
      scheduleRender();
    };
    reheatBtn.addEventListener("click", () => {
      if (!model?.nodes.length) return;
      if (prefersReducedMotion()) {
        model.stepPhysics?.(0.24);
        spatialGrid = fcBuildGraphSpatialGrid(model.nodes, 48);
        scheduleRender();
        return;
      }
      physicsAlpha = 0.36;
      scheduleRender();
    });
    zoomInBtn.addEventListener("click", () => zoomAroundCenter(1.25));
    zoomOutBtn.addEventListener("click", () => zoomAroundCenter(1 / 1.25));
    fitBtn.addEventListener("click", () => fitView(activeZone));

    // Close popovers cleanly on outside click or Escape
    const onDocPointerDown = (ev) => {
      if (filters.open && !filters.contains(ev.target)) filters.open = false;
      if (actionsMenu.open && !actionsMenu.contains(ev.target)) actionsMenu.open = false;
    };
    const onDocKeyDown = (ev) => {
      if (ev.key === "Escape") {
        if (filters.open) { filters.open = false; filterLabel.focus?.(); }
        if (actionsMenu.open) { actionsMenu.open = false; }
      }
    };
    doc.addEventListener?.("pointerdown", onDocPointerDown);
    doc.addEventListener?.("keydown", onDocKeyDown);

    let resizeObs = null;
    if (typeof win?.ResizeObserver === "function") {
      resizeObs = new win.ResizeObserver(() => {
        if (!destroyed) {
          updateCanvasSize();
          scheduleRender();
        }
      });
      resizeObs.observe(stage);
    }

    syncModeUi();
    syncLayoutUi();
    rebuild();
    void this.loadGraphEntityVisuals().then((updated) => {
      if (updated && !destroyed) rebuild({ preserveViewport: true });
    });

    const controller = {
      rebuild,
      setMode: switchMode,
      setPhysicsLayout,
      getMode: () => mode,
      focusZone: (zid) => {
        activeZone = activeZone === zid ? null : zid;
        listLimit = GRAPH_PAGE;
        applyFilters();
        fitView(activeZone);
      },
      selectNode: (id) => {
        selectedNodeId = id || null;
        if (selectedNodeId) {
          drawerOpen = true;
          focusNode(selectedNodeId);
        }
        renderDrawer();
        if (physicsLayout === "gantt") renderGanttView();
        else scheduleRender();
      },
      getSnapshot: () => ({
        mode,
        physicsLayout,
        ganttZoom,
        activeZone,
        activeTag,
        includeTagNodes: effectiveIncludeTagNodes(),
        connectedOnly,
        datePreset,
        monthBucket,
        query,
        drawerOpen,
        selectedNodeId,
        totalNotesCount: model?.totalNotesCount ?? 0,
        rawTotalNotesCount: model?.rawTotalNotesCount ?? 0,
        zones: model?.zones || [],
        nodes: model?.nodes || [],
        edges: model?.edges || [],
        roadmapMeta: model?.roadmapMeta || null,
        matchedIds: [...matchedIds],
        filteredNotes: getFilteredNotes(),
        camera: { tx, ty, scale, targetTx, targetTy, targetScale },
      }),
      destroy: () => {
        destroyed = true;
        clearTimeout(searchTimer);
        if (renderRaf != null) cancelFrame(renderRaf);
        renderRaf = null;
        resizeObs?.disconnect?.();
        doc.removeEventListener?.("pointerdown", onDocPointerDown);
        doc.removeEventListener?.("keydown", onDocKeyDown);
      },
    };
    wrap.__fcGraphController = controller;
    return controller;
  }

  openZoneGraphModal(initialMode = "domains") {
    this.dialog?.close();
    const modal = new Modal(this.app);
    this.dialog = modal;
    let ctrl = null;
    modal.modalEl?.classList?.add?.("fc-zgraph-modal");
    modal.onOpen = () => {
      modal.titleEl.setText("Огляд нотаток FlightClub");
      ctrl = this.renderGraphInsights(modal.contentEl, {
        expanded: true,
        initialMode,
        onNavigate: () => modal.close(),
      });
    };
    modal.onClose = () => {
      ctrl?.destroy?.();
      ctrl = null;
      if (this.dialog === modal) this.dialog = null;
      modal.contentEl.empty();
    };
    modal.open();
  }

  renderHubInterface(container, opts = {}) {
    const activeTab = opts.activeTab || "live";
    const onTabChange = opts.onTabChange || (() => {});
    const file = opts.targetFile !== undefined ? opts.targetFile : this.activeNote?.();
    const platform = this.platformNote?.(file) || null;
    const activeLink = file && !platform ? this.linkFor?.(file) || null : null;
    const activeLiveTarget = file && !platform && typeof this.liveTargetFor === "function" ? this.liveTargetFor(file) : (activeLink ? { kind: "m", key: activeLink.slug, slug: activeLink.slug } : null);
    const sharedPath = file && typeof this.sharedNotePath === "function" ? this.sharedNotePath(file) : null;
    const sharedFileId = this.sharedWebNote?.path === sharedPath ? this.sharedWebNote?.fileId : null;
    const activeDocPeers = activeLiveTarget
      ? (this.livePeers || [])
      : sharedFileId
        ? (this.sharedPeers || []).filter(p => p.fileId === sharedFileId)
        : [];
    const hasToken = Boolean(this.vaultConfig?.deviceToken);
    const activeBaseline = this.platformPublishBaseline?.(file, platform) || null;
    const liveMode = this.liveModeState ? this.liveModeState(file) : { state: "idle", label: "Очікування", hint: "", eligible: false };
    const isLive = ["live", "sending"].includes(liveMode.state);

    const host = opts.host && typeof container.querySelector === "function" ? opts.host : null;
    const savedScroll = host && typeof container.scrollTop === "number" ? container.scrollTop : 0;
    let wrap, topSlot, navSlot, bodySlot, footSlot;
    if (host && host.wrap && host.wrap.parentElement === container) {
      ({ wrap, topSlot, navSlot, bodySlot, footSlot } = host);
    } else {
      if (host) host.cleanup?.();
      wrap = container.createDiv({ cls: "fc-hub-wrap" + (opts.entering ? " fc-hub-first" : "") });
      topSlot = wrap.createDiv({ cls: "fc-hub-top-slot" });
      navSlot = wrap.createDiv({ cls: "fc-hub-nav-slot" });
      bodySlot = wrap.createDiv({ cls: "fc-hub-panel-slot" });
      footSlot = wrap.createDiv({ cls: "fc-hub-foot-slot" });
      if (host) {
        Object.assign(host, {
          wrap, topSlot, navSlot, bodySlot, footSlot,
          topKey: null, navKey: null, bodyKey: null, footKey: null, lastTab: null, dropdownOpen: false,
          cleanup: () => {
            if (typeof document !== "undefined") {
              if (host.onDocPointer) document.removeEventListener("pointerdown", host.onDocPointer);
              if (host.onDocKey) document.removeEventListener("keydown", host.onDocKey);
            }
            host.onDocPointer = null;
            host.onDocKey = null;
          },
        });
      }
    }
    if (!opts.isDock) this.mobileImportRoot = wrap;

    const topKey = host ? JSON.stringify([
      hasToken,
      this.accountVerified,
      this.accountIsAdmax,
      this.vaultConfig.pairedUserId || "",
      this.vaultConfig.pairedUser || "",
      this.vaultConfig.pairedRole || "",
      this.vaultConfig.pairedHub || "",
      this.accountAvatarUrl || "",
      Boolean(this.pairSaving),
      this.pendingPair?.state || "",
      Boolean(this.pendingPair?.checking),
      this.pairMessage || "",
      liveMode.state,
      liveMode.label,
      file?.path || "",
      platform ? `${platform.kind}:${platform.id || ""}` : "",
      activeLink?.slug || "",
      Boolean(activeBaseline),
      Boolean(this.updater?.blocked?.()),
      this.updater?.state?.status || "",
      this.updater?.state?.release?.version || "",
      Boolean(this.checkingVersion),
      Boolean(this.updatingPlugin),
      Boolean(activeTab === "live" && this.liveSession?.conflict),
    ]) : null;

    if (!host || host.topKey !== topKey) {
      if (host) {
        topSlot.empty?.();
        host.topKey = topKey;
      }
      // 1. FlightClub Compact Brand & Update Hero Header (logo left-anchored, version & animated update button right)
      const hero = topSlot.createDiv({ cls: "fc-hero-banner" });
      const heroTop = hero.createDiv({ cls: "fc-hero-top" });
      const brand = heroTop.createDiv({ cls: "fc-hero-brand" });
      const brandText = brand.createDiv({ cls: "fc-brand-text" });
      if (BRAND_LOGO.startsWith("data:image/png;base64,")) {
        brandText.createEl("img", { cls: "fc-brand-logo", attr: { src: BRAND_LOGO, alt: "FlightClub", decoding: "sync" } });
      } else {
        brandText.createEl("h3", { text: "FlightClub", cls: "fc-hero-title" });
      }
      const status = this.pairSaving ? "Зберігаємо"
        : this.pendingPair ? "Підтвердьте в браузері"
        : liveMode.state === "conflict" ? "Конфлікт"
        : hasToken && !this.accountVerified ? "Перевірте доступ"
        : isLive ? liveMode.label
        : hasToken ? "Підключено" : "Не підключено";
      this.renderHeroVersion(heroTop, status, !this.pendingPair && this.accountVerified);

      // 2. Compact Account Login / Connected Profile Card
      const authCard = hero.createDiv({
        cls: "fc-auth-card" + (hasToken ? " fc-auth-card-connected" : ""),
      });
      if (!hasToken) {
        authCard.createEl("div", {
          text: "Підключіть акаунт FlightClub, щоб синхронізувати сторінки й вставляти згадки.",
          cls: "fc-deck-sub",
        });
        if (!this.pendingPair) {
          const loginBtn = authCard.createEl("button", {
            text: "Підключити акаунт",
            cls: "fc-btn-hero-login",
            attr: { type: "button" },
          });
          loginBtn.addEventListener("click", () => this.startPairingFlow());
        }
        const manualRow = authCard.createDiv({ cls: "fc-deck-grid" });
        const pasteBtn = manualRow.createEl("button", {
          text: "Вставити код",
          cls: "fc-deck-btn",
          attr: { type: "button" },
        });
        pasteBtn.addEventListener("click", () => this.promptManualTokenPaste());
      } else {
        const userRow = authCard.createDiv({ cls: "fc-auth-user-row" });
        const userTitle = userRow.createDiv({ cls: "fc-peer-identity" });
        addAvatar(userTitle, { name: this.vaultConfig.pairedUser, userId: this.vaultConfig.pairedUserId, avatarUrl: this.accountAvatarUrl });
        const uInfo = userTitle.createDiv({ cls: "fc-auth-user-info" });
        const myProfileUrl = userProfileUrl(this.vaultConfig.pairedUserId);
        if (myProfileUrl) {
          const myLink = uInfo.createEl("a", {
            text: `${this.vaultConfig.pairedUser || "Учасник FlightClub"} ↗`,
            cls: "fc-peer-name-link",
            attr: { href: myProfileUrl, target: "_blank", rel: "noopener noreferrer" },
          });
          myLink.title = "Відкрити ваш профіль на сайті FlightClub";
        } else {
          uInfo.createEl("strong", { text: this.vaultConfig.pairedUser || "Авторизований учасник" });
        }
        const roleLine = this.accountVerified
          ? [this.vaultConfig.pairedRole || "Учасник", this.vaultConfig.pairedHub || "", !this.pendingPair ? "● Підключено" : ""].filter(Boolean).join(" · ")
          : "Роль перевіряється";
        uInfo.createEl("div", {
          text: roleLine,
          cls: "fc-deck-row-meta" + (this.accountVerified && !this.pendingPair ? " is-ok" : ""),
        });

        if (!this.pendingPair) {
          const rePairBtn = userRow.createEl("button", {
            text: "Змінити",
            cls: "fc-deck-btn fc-auth-switch-btn",
            attr: { type: "button", title: "Підтвердити або змінити акаунт для цього Obsidian у браузері" },
          });
          rePairBtn.addEventListener("click", () => this.startPairingFlow());
        }
      }

      if (this.pendingPair) {
        const pairing = hero.createDiv({ cls: "fc-pairing-progress" });
        const pending = this.pendingPair;
        pairing.createEl("p", { text: {
          waiting: "Увійдіть на сайт і натисніть «Підтвердити цей Obsidian». Запит діє 5 хвилин.",
          offline: "Сайт тимчасово недоступний. Підключення перевіриться автоматично після відновлення зв’язку.",
          denied: "Сайт відхилив перевірку. Відкрийте підтвердження й перевірте доступ акаунта.",
          update: "Для цього підключення потрібно оновити плагін.",
          storage: "Доступ підтверджено. Натисніть «Перевірити зараз», щоб повторити збереження.",
          saving: "Зберігаємо підключення в Obsidian…",
        }[pending.state] || "Відкрийте підтвердження на сайті.", attr: { role: "status" } });
        const actions = pairing.createDiv({ cls: "fc-deck-grid" });
        actions.createEl("a", { text: "Відкрити підтвердження", cls: "fc-deck-btn",
          attr: { href: pending.url, target: "_blank", rel: "noopener noreferrer" } });
        const recheck = actions.createEl("button", {
          text: "Перевірити зараз", cls: "fc-deck-btn", attr: { type: "button" },
        });
        recheck.disabled = pending.checking;
        recheck.addEventListener("click", () => { void this.checkPairing(pending); });
        const cancel = actions.createEl("button", { text: "Скасувати запит", cls: "fc-deck-btn", attr: { type: "button" } });
        cancel.disabled = Boolean(this.pairSaving);
        cancel.addEventListener("click", () => this.cancelPairing());
      } else if (this.pairMessage) {
        hero.createEl("p", { text: this.pairMessage, cls: "fc-deck-sub", attr: { role: "status" } });
      }

      if (platform) {
        const target = platform.id ? refUrl(platform.kind + ":" + platform.id) : null;
        const connection = topSlot.createDiv({ cls: "fc-note-connection" });
        connection.createSpan({ text: LABEL[platform.kind] || "Об’єкт FlightClub", cls: "fc-note-connection-kind" });
        if (target) connection.createEl("a", { text: "Редагувати на сайті ↗", cls: "fc-note-connection-link", attr: { href: target, target: "_blank", rel: "noopener noreferrer" } });
        if (platform.id && platform.kind !== "user" && !activeBaseline &&
            this.accountVerified && this.vaultConfig.pairedCanEdit) {
          const action = connection.createEl("button", {text:"Звірити й відправити",cls:"mod-cta fc-deck-btn",attr:{type:"button"}});
          action.disabled = Boolean(this.updater?.blocked() || this.driveDownloading || this.publishingDrive || this.reviewSyncBusy);
          action.addEventListener("click", () => this.reviewPlatformNote(file));
        }
      }

      if (this.liveSession?.conflict && activeTab === "live") {
        const isDriveConflict = this.liveSession.kind === "drive";
        const isCanvasConflict = Boolean(this.liveSession.isCanvas);
        const warning = topSlot.createDiv({ cls: "fc-conflict-card", attr: { role: "alert" } });
        warning.createEl("p", {
          text: isCanvasConflict
            ? "Дошку Canvas змінили одночасно у вас і на Google Drive."
            : "Обидві версії мають правки в одному фрагменті.",
        });
        const actions = warning.createDiv({ cls: "fc-deck-grid" });
        const compareBtn = actions.createEl("button", { text: "🔀 Порівняти та вирішити", cls: "mod-cta fc-deck-btn", attr: { type: "button" } });
        const localBtn = actions.createEl("button", { text: "⬆️ Залишити мою", cls: "fc-deck-btn", attr: { type: "button" } });
        const remoteBtn = actions.createEl("button", { text: isDriveConflict ? "⬇️ Прийняти з Drive" : "⬇️ Прийняти із сайту", cls: "fc-deck-btn", attr: { type: "button" } });
        compareBtn.addEventListener("click", () => void this.resolveLiveConflict("compare"));
        localBtn.addEventListener("click", () => void this.resolveLiveConflict("local"));
        remoteBtn.addEventListener("click", () => void this.resolveLiveConflict("remote"));
      }
    }

    // 3. Clean Animated Section Dropdown (Replaces multi-row tab strip, prevents layout jumping)
    const driveAlert = Boolean(this.drivePreview?.desync?.hasDesync);
    const linkCount = this.links?.size || 0;
    const sections = [
      ["live", activeDocPeers.length ? `Учасники (${activeDocPeers.length + 1})` : "Учасники та Live", "👥", "Присутність, ролі та Live Edit", activeDocPeers.length ? String(activeDocPeers.length + 1) : ""],
      ["entities", "Згадки", "🔗", "Люди, майно, події, сторінки та Drive", ""],
      ["graph", "Граф і Canvas", "🕸️", "Зв’язки між нотатками", ""],
      ["pages", "Сторінки бази знань", "📚", "Завантажені нотатки і Vault редагування", linkCount ? String(linkCount) : ""],
      ["history", "Історія змін", "🕘", "Попередні ревізії документа", ""],
      ["drive", "Google Drive і Опублікований вольт", "🗂️", "Синхронізація Drive та спільних папок", driveAlert ? "!" : ""],
    ];
    const currentSection = sections.find(([tId]) => tId === activeTab) || sections[0];
    const navKey = host ? JSON.stringify([
      activeTab,
      activeDocPeers.length,
      linkCount,
      driveAlert,
    ]) : null;
    if (!host || host.navKey !== navKey) {
      if (host) {
        host.cleanup?.();
        navSlot.empty?.();
        host.navKey = navKey;
      }
      const isOpen = host ? Boolean(host.dropdownOpen) : false;
      const picker = navSlot.createDiv({
        cls: "fc-section-picker" + (isOpen ? " is-open" : ""),
      });
      const trigger = picker.createEl("button", {
        cls: "fc-section-trigger",
        attr: {
          type: "button",
          "aria-haspopup": "listbox",
          "aria-expanded": String(isOpen),
          "aria-label": "Розділи панелі FlightClub",
        },
      });
      trigger.createSpan({ text: currentSection[2], cls: "fc-section-trigger-icon", attr: { "aria-hidden": "true" } });
      const triggerCopy = trigger.createDiv({ cls: "fc-section-trigger-copy" });
      triggerCopy.createSpan({ text: currentSection[1], cls: "fc-section-trigger-title" });
      triggerCopy.createSpan({ text: currentSection[3], cls: "fc-section-trigger-desc" });
      const triggerBadge = currentSection[4] || (driveAlert && activeTab !== "drive" ? "!" : "");
      if (triggerBadge) {
        trigger.createSpan({
          text: triggerBadge,
          cls: "fc-section-badge" + (triggerBadge === "!" ? " is-warn" : ""),
        });
      }
      const chevronWrap = trigger.createSpan({ cls: "fc-section-chevron-badge", attr: { "aria-hidden": "true" } });
      const chevSpan = chevronWrap.createSpan({ cls: "fc-section-chevron" });
      const chevDoc = chevSpan.ownerDocument || (typeof document !== "undefined" ? document : null);
      if (chevDoc?.createElementNS) {
        const chevSvg = chevDoc.createElementNS("http://www.w3.org/2000/svg", "svg");
        chevSvg.setAttribute("width", "14");
        chevSvg.setAttribute("height", "14");
        chevSvg.setAttribute("viewBox", "0 0 16 16");
        chevSvg.setAttribute("fill", "none");
        chevSvg.setAttribute("stroke", "currentColor");
        chevSvg.setAttribute("stroke-width", "1.8");
        chevSvg.setAttribute("stroke-linecap", "round");
        chevSvg.setAttribute("stroke-linejoin", "round");
        chevSvg.setAttribute("aria-hidden", "true");
        const chevPath = chevDoc.createElementNS("http://www.w3.org/2000/svg", "path");
        chevPath.setAttribute("d", "M4 6l4 4 4-4");
        chevSvg.append(chevPath);
        chevSpan.append(chevSvg);
      } else {
        chevSpan.setText("▾");
      }

      const menu = picker.createDiv({
        cls: "fc-section-menu" + (isOpen ? " is-open" : ""),
        attr: { role: "listbox", "aria-label": "Оберіть розділ" },
      });
      const setDropdownOpen = (nextOpen) => {
        if (host) host.dropdownOpen = nextOpen;
        trigger.setAttribute("aria-expanded", String(nextOpen));
        if (typeof picker.classList?.toggle === "function") picker.classList.toggle("is-open", nextOpen);
        if (typeof menu.classList?.toggle === "function") menu.classList.toggle("is-open", nextOpen);
      };
      trigger.addEventListener("click", (e) => {
        e?.stopPropagation?.();
        setDropdownOpen(!(host ? host.dropdownOpen : false));
      });
      for (const [tId, tLabel, tIcon, tDesc, tBadge] of sections) {
        const selected = activeTab === tId;
        const opt = menu.createEl("button", {
          cls: "fc-section-option" + (selected ? " is-active" : ""),
          attr: { type: "button", role: "option", "aria-selected": String(selected), "data-section": tId },
        });
        opt.createSpan({ text: tIcon, cls: "fc-section-option-icon", attr: { "aria-hidden": "true" } });
        const copy = opt.createDiv({ cls: "fc-section-option-copy" });
        copy.createSpan({ text: tLabel, cls: "fc-section-option-title" });
        copy.createSpan({ text: tDesc, cls: "fc-section-option-desc" });
        if (tBadge) {
          opt.createSpan({
            text: tBadge,
            cls: "fc-section-badge" + (tBadge === "!" ? " is-warn" : ""),
          });
        }
        if (selected) {
          opt.createSpan({ text: "✓", cls: "fc-section-option-check", attr: { "aria-hidden": "true" } });
        }
        opt.addEventListener("click", () => {
          setDropdownOpen(false);
          if (tId !== activeTab) onTabChange(tId);
        });
      }
      if (host && typeof document !== "undefined") {
        host.onDocPointer = (event) => {
          if (host.dropdownOpen && !picker.contains(event.target)) setDropdownOpen(false);
        };
        host.onDocKey = (event) => {
          if (event.key === "Escape" && host.dropdownOpen) {
            setDropdownOpen(false);
            trigger.focus?.();
          }
        };
        document.addEventListener("pointerdown", host.onDocPointer);
        document.addEventListener("keydown", host.onDocKey);
      }
    }

    // 4. Tab Content Area (updates independently without touching hero/avatars or scroll)
    const isArchiveActive = Boolean(file && isSyncArchivePath(file.path));
    const bodyKey = host ? JSON.stringify([
      activeTab,
      hasToken,
      this.accountVerified,
      this.accountIsAdmax,
      file?.path || "",
      isArchiveActive,
      platform ? `${platform.kind}:${platform.id || ""}` : "",
      activeLink?.slug || "",
      this.driveFilesCount?.() || 0,
      this.resolveDriveIdForFile?.(file) || "",
      (this.hubCities || []).join(","),
      this.driveLastSummary?.at || "",
      this.totalUnreviewedUpdateCount?.() || 0,
      this.updatesFilterKind || "all",
      this.counterTimeoutSec?.() ?? 30,
      Boolean(this.updatesLegendOpen),
      Boolean(this.updatesShowAll),
      this.equipmentStatusForPath?.(file?.path)?.key || "",
      this.eventPublishSignatureForFile?.(file) || "",
      ...(activeTab === "live" ? [
        liveMode.state, liveMode.label, Boolean(this.liveModeChanging), Boolean(this.vaultConfig.liveHeroCollapsed), Boolean(this.vaultConfig.radarCollapsed),
        this.liveRev || 0, activeLiveTarget?.key || "", sharedPath || "", sharedFileId || "",
        this.selfLivePeer ? [this.selfLivePeer.name, this.selfLivePeer.line, this.selfLivePeer.actionDetail] : null,
        activeDocPeers.map(p => [p.clientId || p.userId, p.name, p.line, p.col, p.action, p.editing, p.actionDetail, p.source, p.color]),
        (this.workspaceActivity || []).map(r => [r.slug, r.fileId || "", r.title, (r.peers || []).map(p => [p.clientId || p.userId, p.name, p.source, p.action, p.actionDetail, p.line, p.editing, p.color])]),
        (this.sharedPeers || []).map(p => [p.userId, p.name, p.fileId, p.path, p.editing, p.actionDetail]),
      ] : activeTab === "pages" ? [
        Array.from(this.links.entries()).map(([p, l]) => [p, l.slug, Boolean(l.conflict), Boolean(l.dirtyLocal), this.unreviewedUpdates?.get(p)?.count || 0]),
      ] : activeTab === "history" ? [
        this.historyStateKey || "",
      ] : activeTab === "drive" ? [
        this.folderSyncScope(), Boolean(this.accountCanSyncPrivate),
        Boolean(this.vaultConfig.pairedCanSync), Boolean(this.vaultConfig.pairedCanEdit),
        Boolean(this.vaultConfig.folderAutoSync), Boolean(this.vaultConfig.driveAutoSync !== false),
        this.vaultConfig.vaultRootId || "", this.vaultConfig.vaultRootName || "", this.vaultConfig.localVaultRoot || "",
        this.treeSyncMessage || "", Boolean(this.treeSyncBusy),
        Boolean(this.driveDownloading), Boolean(this.previewingDrive),
        this.driveDownloadStatus || "", this.pagesDownloadStatus || "",
        this.importProgress ? `${this.importProgress.current}/${this.importProgress.total}:${this.importProgress.stage}` : "",
        this.drivePreview ? `${this.drivePreview.available}:${this.drivePreview.partial}:${this.drivePreview.matches}` : "",
        this.syncTotals?.drive ? JSON.stringify(this.syncTotals.drive) : "",
        this.teamPluginsCatalog?.revision || "",
        (this.teamPluginsCatalog?.plugins || []).length,
        this.teamPluginsRefreshTick || 0,
      ] : []),
    ]) : null;

    let didSwitchTab = false;
    if (!host || host.bodyKey !== bodyKey) {
      const tabSwitched = host && host.lastTab !== null && host.lastTab !== activeTab;
      didSwitchTab = Boolean(tabSwitched);
      if (host) {
        bodySlot.empty?.();
        host.bodyKey = bodyKey;
        host.lastTab = activeTab;
        if (typeof bodySlot.classList?.remove === "function") {
          bodySlot.classList.remove("fc-panel-enter");
          if (tabSwitched) {
            void bodySlot.offsetWidth;
            bodySlot.classList.add("fc-panel-enter");
          }
        }
      }
      if (activeTab === "live") {
        const editTarget = file && !isArchiveActive ? this.siteEditTarget(file) : null;
        const driveBase = file && !isArchiveActive ? this.driveBaselineFor(file) : null;
        const driveId = file && !isArchiveActive ? this.resolveDriveIdForFile(file) : null;
        const inDriveRoot = file && !isArchiveActive && this.isPathInDriveRoot(file.path);
        const driveUrl = driveId ? driveOpenUrlForPath(driveId, file?.path) : null;

        const isCanvasFile = file?.extension?.toLowerCase?.() === "canvas" || String(file?.path || "").toLowerCase().endsWith(".canvas");
        const isBaseFile = file?.extension?.toLowerCase?.() === "base" || String(file?.path || "").toLowerCase().endsWith(".base");
        // Active Note / Canvas / Base Card
        const noteCard = bodySlot.createDiv({ cls: "fc-deck-card" });
        const noteHeader = noteCard.createDiv({ cls: "fc-deck-header" });
        noteHeader.createEl("h4", {
          text: file ? `${isArchiveActive ? "📦" : isCanvasFile ? "🎨" : isBaseFile ? "🗃️" : "📄"} ${file.basename}` : "📄 Відкрийте нотатку, Canvas або Base",
          cls: "fc-deck-title",
        });
        if (!file && !sharedPath) {
          noteCard.createEl("p", {
            cls: "fc-deck-sub",
            text: "Виберіть файл у дереві зліва для Live Edit, учасників та швидких дій документа.",
          });
        }
        if (isArchiveActive) {
          noteHeader.createSpan({
            text: "Sync Archive",
            cls: "fc-deck-badge fc-deck-badge-warn",
          });
        } else if (driveId && activeLink) {
          noteHeader.createSpan({
            text: `📁 Drive + /m/${activeLink.slug}`,
            cls: "fc-deck-badge fc-deck-badge-ok",
          });
        } else if (driveBase || driveId) {
          noteHeader.createSpan({
            text: "📁 Google Drive",
            cls: "fc-deck-badge fc-deck-badge-ok",
          });
        } else if (activeLink) {
          noteHeader.createSpan({
            text: `/m/${activeLink.slug}`,
            cls: "fc-deck-badge fc-deck-badge-ok",
          });
        } else if (inDriveRoot) {
          noteHeader.createSpan({
            text: "📁 Нова для Drive",
            cls: "fc-deck-badge",
          });
        } else if (file) {
          noteHeader.createSpan({ text: platform ? LABEL[platform.kind] : "Локальна нотатка", cls: "fc-deck-badge" });
        }

        if (isArchiveActive && file) {
          const archiveBanner = noteCard.createDiv({
            cls: "fc-archive-banner",
            attr: { "data-fc-archive-banner": "" },
          });
          archiveBanner.createEl("div", {
            cls: "fc-archive-banner-title",
            text: "Ви переглядаєте резервну копію із Sync Archive",
          });
          archiveBanner.createEl("p", {
            cls: "fc-archive-banner-copy",
            text: "Це архівний знімок минулого конфлікту. Зміни тут не синхронізуються в Live Edit та Google Drive.",
          });
          const liveCandidate = this.resolveLiveFileFromArchive(file);
          const openLiveBtn = archiveBanner.createEl("button", {
            text: liveCandidate ? `↗ Відкрити актуальний файл (${liveCandidate.basename})` : "↗ Знайти актуальний файл",
            cls: "mod-cta fc-deck-btn",
            attr: { type: "button", title: liveCandidate?.path || "" },
          });
          openLiveBtn.addEventListener("click", async () => {
            const target = this.resolveLiveFileFromArchive(file);
            if (target instanceof TFile) {
              const leaf = this.app.workspace.getLeaf?.(false) || this.app.workspace.getLeaf?.();
              if (leaf?.openFile) await leaf.openFile(target, { active: true });
              this.attachLiveSessionToActiveNote?.(target);
              if (this.liveSession?.file === target) {
                this.liveSession.forceRefresh = true;
                this.queueLiveCheck?.(this.liveSession, 50);
              }
              return;
            }
            const meta = this.app?.metadataCache?.getFileCache?.(file)?.frontmatter;
            const archivedDriveId = typeof FC_YAML_PROPS !== "undefined" ? FC_YAML_PROPS.extractDriveIdFromMeta(meta) : null;
            if (archivedDriveId) {
              await this.openDriveFileInObsidian(archivedDriveId, null);
              return;
            }
            new Notice("Актуальну копію не знайдено локально — запустіть «Звірити з Drive» у вкладці Drive.");
          });
        }

        const appendStatusPill = (parentEl, meta, extraCls = "", attr = {}) => {
          const pill = parentEl.createSpan({
            cls: `fc-tree-item-status ${meta.cls}${extraCls ? " " + extraCls : ""}`,
            attr,
          });
          pill.createSpan({ cls: "fc-status-dot", attr: { "aria-hidden": "true" } });
          pill.createSpan({ text: meta.label });
          return pill;
        };

        if (file && platform?.kind === "item") {
          const itemStatus = this.equipmentStatusForPath(file.path);
          if (itemStatus) {
            appendStatusPill(noteHeader, itemStatus, "fc-note-item-status", {
              "data-fc-tree-status": itemStatus.key,
              title: `Живий статус майна із сайту: ${itemStatus.label}`,
            });
            const metaBits = [
              `Статус: ${itemStatus.label}`,
              itemStatus.holder ? `Утримувач: ${itemStatus.holder}` : null,
              itemStatus.hub ? `Осередок: ${itemStatus.hub}` : null,
              itemStatus.condition ? `Стан: ${itemStatus.condition}` : null,
            ].filter(Boolean);
            noteCard.createEl("div", {
              cls: "fc-deck-row-meta fc-item-status-meta",
              text: metaBits.join(" · "),
              attr: { "data-fc-item-status-summary": itemStatus.key },
            });
          }
        } else if (file) {
          const personStatus = this.personStatusForPath(file.path);
          if (personStatus) {
            appendStatusPill(noteHeader, personStatus, "fc-tree-person-status fc-note-item-status", {
              "data-fc-tree-status": personStatus.key,
              title: personStatus.tooltip || personStatus.fullLabel,
            });
            const metaBits = [
              personStatus.funnel ? personStatus.funnel.fullLabel : null,
              personStatus.team ? personStatus.team.fullLabel : null,
              personStatus.roles ? `Роль: ${personStatus.roles.allRolesUk}` : null,
              personStatus.city ? `Осередок: ${personStatus.city}` : null,
            ].filter(Boolean);
            if (metaBits.length) {
              noteCard.createEl("div", {
                cls: "fc-deck-row-meta fc-item-status-meta",
                text: metaBits.join(" · "),
                attr: { "data-fc-person-status-summary": personStatus.key, title: personStatus.tooltip || "" },
              });
            }
          }
          const relatedPerson = this.relatedPersonNotesForPath?.(file.path);
          if (relatedPerson) {
            const crossWrap = noteCard.createDiv({ cls: "fc-person-crosslinks", attr: { "data-fc-person-crosslinks": "" } });
            const openRelated = async (targetFile) => {
              const leaf = this.app.workspace.getLeaf?.(false) || this.app.workspace.getLeaf?.();
              if (leaf?.openFile) await leaf.openFile(targetFile, { active: true });
            };
            if (relatedPerson.trainingFile) {
              const b = crossWrap.createEl("button", {
                text: `🎓 Профіль навчання: ${relatedPerson.trainingFile.basename}`,
                cls: "fc-deck-btn fc-person-crosslink-btn",
                attr: { type: "button", title: relatedPerson.trainingFile.path },
              });
              b.addEventListener("click", () => void openRelated(relatedPerson.trainingFile));
            }
            if (relatedPerson.platformFile) {
              const b = crossWrap.createEl("button", {
                text: `👤 Картка у Platform: ${relatedPerson.platformFile.basename}`,
                cls: "fc-deck-btn fc-person-crosslink-btn",
                attr: { type: "button", title: relatedPerson.platformFile.path },
              });
              b.addEventListener("click", () => void openRelated(relatedPerson.platformFile));
            }
            for (const ff of relatedPerson.formFiles) {
              const b = crossWrap.createEl("button", {
                text: `📋 Анкета: ${ff.basename}`,
                cls: "fc-deck-btn fc-person-crosslink-btn",
                attr: { type: "button", title: ff.path },
              });
              b.addEventListener("click", () => void openRelated(ff));
            }
          }
        }

        if (editTarget?.sub && !platform) {
          noteCard.createEl("p", { text: editTarget.sub, cls: "fc-deck-sub" });
        }

        if (file && platform && platform.id) {
          const pUrl = refUrl(platform.kind + ":" + platform.id);
          if (pUrl) {
            const pGrid = noteCard.createDiv({ cls: "fc-deck-grid" });
            const pOpenBtn = pGrid.createEl("button", {
              text: "✏️ Відкрити картку на сайті",
              cls: "mod-cta fc-deck-btn",
              attr: { type: "button", title: pUrl },
            });
            pOpenBtn.addEventListener("click", () => this.openSite(pUrl));
            const pCopyBtn = pGrid.createEl("button", {
              text: "📋 Копіювати лінк",
              cls: "fc-deck-btn",
              attr: { type: "button", title: pUrl },
            });
            pCopyBtn.addEventListener("click", () => void this.copyTextToClipboard(pUrl, "Посилання скопійовано"));
          }
        }

        if (file && !platform && !isArchiveActive) {
          const btnGrid = noteCard.createDiv({ cls: "fc-deck-grid fc-note-actions-grid" });
          if (editTarget) {
            const editBtn = btnGrid.createEl("button", {
              text: editTarget.label,
              cls: "mod-cta fc-deck-btn",
              attr: { type: "button", title: editTarget.url },
            });
            editBtn.addEventListener("click", () => this.openSite(editTarget.url));
          }

          if (driveUrl) {
            const gDriveBtn = btnGrid.createEl("button", {
              text: "🗂️ Google Drive",
              cls: "fc-deck-btn",
              attr: { type: "button", title: driveUrl },
            });
            gDriveBtn.addEventListener("click", () => this.openSite(driveUrl));
          }

          if (driveBase || inDriveRoot) {
            const noteDirtyOrPaused = Boolean(this.dirtyDriveFiles?.has(file.path) || !this.vaultConfig.liveEnabled || !driveBase);
            if (driveBase) {
              const pullOneBtn = btnGrid.createEl("button", {
                text: this.driveDownloading ? "⏳ Оновлення…" : "⬇️ Підтягнути з Drive",
                cls: "fc-deck-btn fc-btn-pull-drive",
                attr: { type: "button", title: "Завантажити актуальну версію цього файлу з Google Drive у локальний Vault", "data-fc-pull-active": "" },
              });
              pullOneBtn.disabled = Boolean(this.driveDownloading || this.publishingDrive || !hasToken);
              pullOneBtn.addEventListener("click", () => void this.pullActiveFileFromDrive(file));
            }
            if (this.vaultConfig.pairedCanEdit || this.accountIsAdmax) {
              const pushOneBtn = btnGrid.createEl("button", {
                text: this.publishingDrive ? "⏳ Відправка…" : "⬆️ Залити правки в Drive",
                cls: (noteDirtyOrPaused ? "mod-cta " : "") + "fc-deck-btn fc-btn-push-drive",
                attr: { type: "button", title: "Відправити локальні правки цього файлу на головний Google Drive (зручно коли Live Edit вимкнено)", "data-fc-push-active": "" },
              });
              pushOneBtn.disabled = Boolean(this.driveDownloading || this.publishingDrive || !hasToken);
              pushOneBtn.addEventListener("click", () => void this.pushActiveFileToDrive(file));
            }
          }

          if (activeLink) {
            const saveBtn = btnGrid.createEl("button", {
              text: `💾 Зберегти /m/${activeLink.slug}`,
              cls: editTarget ? "fc-deck-btn" : "mod-cta fc-deck-btn",
              attr: { type: "button" },
            });
            saveBtn.addEventListener("click", () => void this.directSaveNote(file));
          } else {
            const secDetails = noteCard.createEl("details", { cls: "fc-secondary-actions" });
            secDetails.createEl("summary", { text: "Веб-сторінка /m/ і додатково…" });
            const secGrid = secDetails.createDiv({ cls: "fc-deck-grid" });
            const pubBtn = secGrid.createEl("button", {
              text: "💾 Опублікувати в /m/",
              cls: "fc-deck-btn",
              attr: { type: "button" },
            });
            pubBtn.addEventListener("click", () => void this.directSaveNote(file));
            const attachBtn = secGrid.createEl("button", {
              text: "📎 Прив’язати наявну /m/",
              cls: "fc-deck-btn",
              attr: { type: "button" },
            });
            attachBtn.addEventListener("click", () => this.attachLink(file));
          }

          if (editTarget || driveUrl || activeLink) {
            const copyStrip = noteCard.createDiv({ cls: "fc-copy-strip" });
            if (editTarget?.url) {
              const copySiteBtn = copyStrip.createEl("button", {
                text: "📋 Копіювати лінк сайту",
                cls: "fc-deck-btn",
                attr: { type: "button", title: editTarget.url },
              });
              copySiteBtn.addEventListener("click", () => void this.copyTextToClipboard(editTarget.url, "Лінк сторінки сайту скопійовано"));
            }
            if (driveUrl) {
              const copyDriveBtn = copyStrip.createEl("button", {
                text: "🔗 Копіювати Drive лінк",
                cls: "fc-deck-btn",
                attr: { type: "button", title: driveUrl },
              });
              copyDriveBtn.addEventListener("click", () => void this.copyTextToClipboard(driveUrl, "Лінк Google Drive скопійовано"));
            }
            if (activeLink) {
              const copyShareBtn = copyStrip.createEl("button", {
                text: "🌐 Копіювати /m/",
                cls: "fc-deck-btn",
                attr: { type: "button", title: pageUrl(activeLink.slug) },
              });
              copyShareBtn.addEventListener("click", () => void this.copyLink(file));
            }
          }
        }

        if (file && !platform && !isArchiveActive && hasToken) {
          const shareDetails = noteCard.createEl("details", { cls: "fc-secondary-actions" });
          const existingPage = this.catalogPageForFile(file, driveId);
          const shareStatusBadge = existingPage?.is_public ? " · 🌐 Публічно" : existingPage?.is_published ? " · Опубліковано" : "";
          shareDetails.createEl("summary", { text: `🔒 Налаштувати ролі та шерінг${shareStatusBadge}` });
          const shareBody = shareDetails.createDiv({ cls: "fc-share-card" });
          const draftKey = file.path + "::" + (driveId || activeLink?.slug || "");
          let sDraft = this.shareDrafts?.get(draftKey);
          if (!sDraft) {
            sDraft = {
              slug: existingPage?.slug || activeLink?.slug || slugFromTitle(file.basename, typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
              is_published: existingPage ? existingPage.is_published !== false : true,
              is_public: existingPage?.is_public === true,
              target_roles: Array.isArray(existingPage?.target_roles) ? [...existingPage.target_roles] : [],
              target_hubs: Array.isArray(existingPage?.target_hubs) ? [...existingPage.target_hubs] : [],
            };
            this.shareDrafts?.set(draftKey, sDraft);
          }
          const clearEl = el => {
            if (typeof el.empty === "function") el.empty();
            else if (typeof el.replaceChildren === "function") el.replaceChildren();
            else if (Array.isArray(el.children)) el.children.length = 0;
          };
          const renderShareControls = () => {
            clearEl(shareBody);
            const slugRow = shareBody.createDiv({ cls: "fc-share-slug-row" });
            slugRow.createSpan({ text: "/m/" });
            const slugInp = slugRow.createEl("input", { attr: { type: "text", value: sDraft.slug, placeholder: "nazva-storinky", maxlength: "64" } });
            slugInp.value = sDraft.slug;
            slugInp.readOnly = Boolean(existingPage?.slug || activeLink?.slug);
            slugInp.addEventListener("input", () => { sDraft.slug = slugInp.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""); slugInp.value = sDraft.slug; });

            const toggles = shareBody.createDiv({ cls: "fc-share-toggles" });
            const pubLbl = toggles.createEl("label");
            const pubCb = pubLbl.createEl("input", { attr: { type: "checkbox" } });
            pubCb.checked = sDraft.is_published;
            pubCb.addEventListener("change", () => { sDraft.is_published = pubCb.checked; });
            pubLbl.createSpan({ text: "Опубліковано" });

            const globLbl = toggles.createEl("label");
            const globCb = globLbl.createEl("input", { attr: { type: "checkbox" } });
            globCb.checked = sDraft.is_public;
            globCb.addEventListener("change", () => { sDraft.is_public = globCb.checked; });
            globLbl.createSpan({ text: "🌐 Публічно (без входу)" });

            const rPills = shareBody.createDiv({ cls: "fc-role-pills" });
            const allBtn = rPills.createEl("button", { text: "🌐 Усі", cls: "fc-role-pill", attr: { type: "button", "aria-pressed": String(sDraft.target_roles.length === 0) } });
            allBtn.addEventListener("click", () => { sDraft.target_roles = []; renderShareControls(); });
            for (const [rk, rl] of [["cadet", "🎓 Курсанти"], ["miltech", "🔧 MilTech"], ["instructor", "🛡️ Інструктори"], ["admin", "⚡ Адміни"], ["quarantine", "⏳ Кандидати"]]) {
              const on = sDraft.target_roles.includes(rk);
              const b = rPills.createEl("button", { text: rl, cls: "fc-role-pill", attr: { type: "button", "aria-pressed": String(on) } });
              b.addEventListener("click", () => {
                sDraft.target_roles = on ? sDraft.target_roles.filter(x => x !== rk) : [...sDraft.target_roles, rk];
                renderShareControls();
              });
            }

            const effectiveHubCities = normalizeHubCities(this.hubCities, { fromServer: true });
            if (effectiveHubCities.length) {
              const hPills = shareBody.createDiv({ cls: "fc-role-pills" });
              for (const hc of effectiveHubCities) {
                const on = sDraft.target_hubs.includes(hc);
                const hb = hPills.createEl("button", { text: hc, cls: "fc-role-pill", attr: { type: "button", "aria-pressed": String(on) } });
                hb.addEventListener("click", () => {
                  sDraft.target_hubs = on ? sDraft.target_hubs.filter(x => x !== hc) : [...sDraft.target_hubs, hc];
                  renderShareControls();
                });
              }
            }

            const sMsg = shareBody.createDiv({ cls: "fc-deck-sub", attr: { role: "status" } });
            const actRow = shareBody.createDiv({ cls: "fc-deck-grid" });
            const saveShareBtn = actRow.createEl("button", {
              text: "💾 Зберегти ролі, YAML і скопіювати",
              cls: "mod-cta fc-deck-btn",
              attr: { type: "button" },
            });
            saveShareBtn.addEventListener("click", async () => {
              saveShareBtn.disabled = true;
              sMsg.setText("Зберігаємо доступ і оновлюємо YAML…");
              try {
                const saved = await this.saveNoteShareSettings(file, sDraft);
                sMsg.setText("✓ Збережено · " + (saved.shareUrl || editTarget?.url || ""));
              } catch (e) {
                sMsg.setText(e instanceof Error ? e.message : "Не вдалося зберегти налаштування.");
              } finally { saveShareBtn.disabled = false; }
            });

            if (driveId) {
              const aclBtn = actRow.createEl("button", {
                text: "🛡️ Права папки Drive на сайті",
                cls: "fc-deck-btn",
                attr: { type: "button", title: editTarget?.vaultShareUrl || "" },
              });
              aclBtn.addEventListener("click", () => this.openSite(editTarget?.vaultShareUrl || `${SITE}/markdown?view=vault&file=${encodeURIComponent(driveId)}&edit=1&share=1`));

              const loadAclBtn = actRow.createEl("button", { text: "🔎 Перевірити права Drive", cls: "fc-deck-btn", attr: { type: "button" } });
              const aclList = shareBody.createDiv({ cls: "fc-share-acl-list" });
              const drawAcl = (info) => {
                clearEl(aclList);
                if (!info) return;
                if (info.parentFolder) aclList.createDiv({ cls: "fc-deck-row-meta", text: `Папка Drive: ${info.parentFolder.name}` });
                if (!info.driveRules?.length) aclList.createDiv({ cls: "fc-deck-row-meta", text: "Спецправил папки немає (доступ ADMAX)." });
                for (const rule of info.driveRules || []) {
                  const it = aclList.createDiv({ cls: "fc-share-acl-item" });
                  it.createSpan({ text: `${rule.effect === "deny" ? "🚫" : "✅"} [${rule.section}] ${(rule.roles || []).join(", ")} · ${(rule.ops || []).join(", ")}` });
                }
              };
              const cachedAcl = this.shareStateCache?.get(driveId);
              if (cachedAcl) drawAcl(cachedAcl);
              loadAclBtn.addEventListener("click", async () => {
                loadAclBtn.disabled = true;
                try {
                  const info = await this.loadDriveShareInfo(driveId, file.path);
                  drawAcl(info);
                } catch (e) { sMsg.setText(e instanceof Error ? e.message : "Не вдалося завантажити права Drive."); }
                finally { loadAclBtn.disabled = false; }
              });
            }
          };
          renderShareControls();
        }

        const showLivePanels = Boolean(file || sharedPath || activeDocPeers.length > 0);
        const liveHeroCollapsed = Boolean(this.vaultConfig.liveHeroCollapsed);
        if (showLivePanels && !isArchiveActive) {
        const liveHero = noteCard.createDiv({
          cls: "fc-live-hero" + (liveHeroCollapsed ? " is-collapsed" : ""),
          attr: { "data-state": liveMode.state, "data-collapsed": String(liveHeroCollapsed), role: "status" },
        });
        const liveHead = liveHero.createDiv({ cls: "fc-live-mode", attr: { "data-state": liveMode.state } });
        liveHead.createSpan({ cls: "fc-live-mode-indicator", attr: { "aria-hidden": "true" } });
        liveHead.createEl("strong", { text: liveMode.label });
        const liveCollapseBtn = liveHead.createEl("button", {
          text: liveHeroCollapsed ? "▸ Розгорнути" : "▾ Згорнути",
          cls: "fc-collapse-chip",
          attr: {
            type: "button",
            "data-fc-collapse": "live-hero",
            "aria-expanded": String(!liveHeroCollapsed),
            title: liveHeroCollapsed ? "Розгорнути керування Live Edit" : "Згорнути керування Live Edit",
          },
        });
        liveCollapseBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.vaultConfig.liveHeroCollapsed = !this.vaultConfig.liveHeroCollapsed;
          void this.persist().catch(() => {});
          this.refreshDockViews(true);
        });
        const guideText = sharedPath
          ? "Опублікований вольт (FlightClub Shared) синхронізується автоматично кожні 15 секунд."
          : liveMode.hint;
        const liveGuideEl = liveHero.createEl("p", { cls: "fc-live-guide", text: guideText });
        if (liveHeroCollapsed) liveGuideEl.hidden = true;

        if (file && !platform && liveMode.eligible) {
          const liveOn = Boolean(this.vaultConfig.liveEnabled);
          const toggleLiveBtn = liveHero.createEl("button", {
            text: liveOn
              ? "⏸ Призупинити Live Edit (редагувати локально)"
              : "🟢 Увімкнути Live Edit (редагувати наживо)",
            cls: (!liveOn ? "mod-cta " : "") + "fc-deck-btn fc-live-hero-btn",
            attr: { type: "button", "aria-pressed": String(liveOn) },
          });
          toggleLiveBtn.disabled = this.liveModeChanging;
          if (liveHeroCollapsed) toggleLiveBtn.hidden = true;
          toggleLiveBtn.addEventListener("click", () => void this.toggleLiveMode());
        }
        }

        const renderRadarSection = () => {
          if (!(!platform && showLivePanels && !isArchiveActive)) return;
          const radarCollapsed = Boolean(this.vaultConfig.radarCollapsed);
          const radarCard = bodySlot.createDiv({
            cls: "fc-deck-card fc-deck-card-live" + (radarCollapsed ? " is-collapsed" : ""),
            attr: { "data-collapsed": String(radarCollapsed) },
          });
          const radarHead = radarCard.createDiv({ cls: "fc-deck-header fc-deck-header-collapsible" });
          radarHead.createEl("h4", {
            text: activeDocPeers.length > 0
              ? `👥 Зараз у документі (${activeDocPeers.length + 1})`
              : activeLiveTarget || sharedPath
                ? "👥 Зараз у документі (1 · ви)"
                : "👥 Зараз у документі",
            cls: "fc-deck-title",
          });
          const radarHeadRight = radarHead.createDiv({ cls: "fc-deck-header-actions" });
          if (liveHeroCollapsed && file && !platform && liveMode.eligible) {
            const liveOn = Boolean(this.vaultConfig.liveEnabled);
            const quickLiveBtn = radarHeadRight.createEl("button", {
              text: liveOn ? "🟢 Live" : "⏸ Пауза",
              cls: "fc-collapse-chip fc-quick-live-chip",
              attr: {
                type: "button",
                "aria-pressed": String(liveOn),
                title: liveOn ? "Призупинити Live Edit" : "Увімкнути Live Edit",
              },
            });
            quickLiveBtn.disabled = Boolean(this.liveModeChanging);
            quickLiveBtn.addEventListener("click", (e) => {
              e.stopPropagation();
              void this.toggleLiveMode();
            });
          }
          radarHeadRight.createSpan({
            text: activeLiveTarget?.kind === "drive"
              ? `Google Drive · rev #${this.liveRev}`
              : activeLink
                ? `/m/${activeLink.slug} · rev #${this.liveRev}`
                : sharedPath
                  ? "Опублікований вольт"
                  : "Очікування",
            cls: "fc-deck-badge fc-deck-badge-ok",
          });
          const radarCollapseBtn = radarHeadRight.createEl("button", {
            text: radarCollapsed ? "▸ Розгорнути" : "▾ Згорнути",
            cls: "fc-collapse-chip",
            attr: {
              type: "button",
              "data-fc-collapse": "radar-card",
              "aria-expanded": String(!radarCollapsed),
              title: radarCollapsed ? "Розгорнути блок «Зараз у документі»" : "Згорнути блок «Зараз у документі»",
            },
          });
          radarCollapseBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            this.vaultConfig.radarCollapsed = !this.vaultConfig.radarCollapsed;
            void this.persist().catch(() => {});
            this.refreshDockViews(true);
          });

          const radarBody = radarCard.createDiv({ cls: "fc-radar-body" });
          if (radarCollapsed) radarBody.hidden = true;

          if (hasToken && (activeLiveTarget || sharedPath)) {
            const selfPeer = this.selfLivePeer || {
              name: this.vaultConfig.pairedUser || "Ви",
              userId: this.vaultConfig.pairedUserId,
              avatarUrl: this.accountAvatarUrl,
              roleLabel: this.vaultConfig.pairedRole || "Учасник",
              hub: this.vaultConfig.pairedHub || null,
              color: "#10b981",
            };
            const selfCard = radarBody.createDiv({ cls: "fc-peer-card fc-peer-card-self" });
            const sTop = selfCard.createDiv({ cls: "fc-peer-top" });
            const sId = sTop.createDiv({ cls: "fc-peer-identity" });
            addAvatar(sId, selfPeer);
            const sNameWrap = sId.createDiv();
            sNameWrap.createEl("strong", { text: `${selfPeer.name} (Ви)` });
            sNameWrap.createEl("div", {
              cls: "fc-deck-row-meta",
              text: `💎 Цей Obsidian${selfPeer.roleLabel ? " · " + selfPeer.roleLabel : ""}${selfPeer.hub ? " · " + selfPeer.hub : ""}`,
            });
            const sAct = this.describePeerActivity(selfPeer, isCanvasFile);
            const sActRow = selfCard.createDiv({ cls: "fc-peer-activity" + (sAct.editing ? " is-editing" : "") });
            const sActStatus = sActRow.createSpan({ cls: "fc-peer-activity-status" });
            sActStatus.createSpan({
              cls: "fc-live-state-dot" + (sAct.editing ? " is-editing" : ""),
              attr: { "aria-hidden": "true" },
            });
            sActStatus.createSpan({
              text: `${sAct.icon} ${selfPeer.actionDetail ? sAct.text : (this.vaultConfig.liveEnabled ? (isCanvasFile ? "Canvas Live активний" : "Live Edit активний") : sAct.text)}`,
            });
          }

          if (activeDocPeers.length === 0) {
            radarBody.createEl("p", {
              text: activeLiveTarget
                ? "Поки ви працюєте самі. Коли інший учасник відкриє цей документ на сайті або в Obsidian, тут одразу з’явиться його аватар, профіль і живий курсор, а Live Edit увімкнеться сам."
                : sharedPath
                  ? "Поки ви самі в цій спільній нотатці. Учасники з Опублікованого вольту та сайту з’являться тут."
                  : "Синхронізуйте нотатку з Google Drive або прив’яжіть до /m/, щоб бачити учасників у реальному часі.",
              cls: "fc-deck-sub",
            });
          } else {
            for (const peer of activeDocPeers) {
              const pCard = radarBody.createDiv({ cls: "fc-peer-card" + (peer.opsec ? " is-opsec" : "") });
              if (peer.color) pCard.style.borderLeft = `3px solid ${peer.color}`;
              const pTop = pCard.createDiv({ cls: "fc-peer-top" });
              const pId = pTop.createDiv({ cls: "fc-peer-identity" });
              addAvatar(pId, peer);
              const pNameWrap = pId.createDiv();
              const profUrl = userProfileUrl(peer.userId);
              const isSameUser = peer.userId && peer.userId === this.vaultConfig.pairedUserId;
              const suffix = peer.clientId === this.clientId ? " (ви)" : isSameUser ? " (ваш інший пристрій)" : "";
              const titleLine = pNameWrap.createDiv({ cls: "fc-peer-title-row" });
              if (profUrl) {
                const pLink = titleLine.createEl("a", {
                  text: `${peer.name}${suffix} ↗`,
                  cls: "fc-peer-name-link",
                  attr: {
                    href: profUrl,
                    target: "_blank",
                    rel: "noopener noreferrer",
                    title: `Відкрити профіль ${peer.name} на flightclub.com.ua`,
                  },
                });
                pLink.addEventListener("click", (e) => e.stopPropagation());
              } else if (!peer.opsec) {
                titleLine.createEl("strong", {
                  text: `${peer.name}${suffix}`,
                });
              }
              if (peer.opsec) {
                titleLine.createSpan({ cls: "fc-opsec-badge", text: "OPSEC" });
              }
              pNameWrap.createEl("div", {
                text: `${peer.source === "web" ? "🌐 Сайт" : "💎 Obsidian"} · ${peer.roleLabel || (peer.editing ? "Редагує" : "Учасник")}${peer.hub ? " · " + peer.hub : ""}`,
                cls: "fc-deck-row-meta",
              });

              const pAct = this.describePeerActivity(peer, isCanvasFile);
              const actRow = pCard.createDiv({ cls: "fc-peer-activity" + (pAct.editing ? " is-editing" : "") });
              const actStatus = actRow.createSpan({ cls: "fc-peer-activity-status" });
              actStatus.createSpan({
                cls: "fc-live-state-dot" + (pAct.editing ? " is-editing" : ""),
                attr: { "aria-hidden": "true" },
              });
              actStatus.createSpan({ text: `${pAct.icon} ${pAct.text}` });

              if (activeLiveTarget) {
                const actBtns = actRow.createDiv({ cls: "fc-deck-grid fc-peer-action-btns" });
                const jumpBtn = actBtns.createEl("button", {
                  text: isCanvasFile ? "🎨 У Canvas" : `🎯 Ряд. ${pAct.line || peer.line || 1}`,
                  cls: "fc-deck-btn fc-teleport-btn",
                  attr: {
                    type: "button",
                    "data-fc-jump-peer": peer.clientId || peer.userId || peer.name || "peer",
                    title: isCanvasFile ? "Перейти до активного Canvas" : "Телепортуватися до живого курсора учасника в редакторі",
                  },
                });
                jumpBtn.addEventListener("click", () => void this.jumpToPeerCursor(peer, file));

                if (profUrl) {
                  const openProfBtn = actBtns.createEl("button", {
                    text: "👤 Профіль",
                    cls: "fc-deck-btn",
                    attr: { type: "button", title: profUrl },
                  });
                  openProfBtn.addEventListener("click", () => this.openSite(profUrl));
                }
              }
            }
          }
        };
        if (file && !isArchiveActive) {
          this.renderEventPublishSidebarCard?.(bodySlot, file, hasToken);
        }

        const renderInlineLegendBar = (parentEl) => {
          const wrap = parentEl.createDiv({
            cls: "fc-legend-wrap",
            attr: { "data-fc-counter-legend": "" },
          });
          const strip = wrap.createDiv({ cls: "fc-legend-strip" });
          const open = Boolean(this.updatesLegendOpen);
          const toggleBtn = strip.createEl("button", {
            text: open ? "Сховати позначення ▴" : "Позначення та статуси ▾",
            cls: "fc-text-btn fc-legend-toggle",
            attr: {
              type: "button",
              "data-fc-legend-toggle": "",
              "aria-expanded": String(open),
              title: "Показати пояснення кольорів лічильників, статусів майна та воронки людей",
            },
          });
          toggleBtn.addEventListener("click", () => {
            this.updatesLegendOpen = !this.updatesLegendOpen;
            this.refreshDockViews(true);
          });

          const drawer = wrap.createDiv({
            cls: "fc-legend-drawer",
            attr: { "data-fc-legend-drawer": "" },
          });
          if (!open) drawer.hidden = true;
          const counterGrid = drawer.createDiv({ cls: "fc-legend-counters" });
          const counterRows = [
            ["folder", "3", "fc-tree-update-badge fc-tree-update-badge-folder", "Папка", "сума оновлень"],
            ["platform", "•", "fc-tree-update-badge", "Сайт", "автооновлення об’єкта"],
            ["drive", "•", "fc-tree-update-badge", "Drive", "зміни колег"],
          ];
          for (const [tone, sample, badgeCls, titleText, descText] of counterRows) {
            const row = counterGrid.createDiv({ cls: "fc-legend-row" });
            row.createSpan({ text: sample, cls: badgeCls, attr: { "data-tone": tone } });
            const copy = row.createDiv({ cls: "fc-legend-copy" });
            copy.createEl("strong", { text: titleText });
            copy.createEl("span", { text: descText });
          }
          const ttlBar = drawer.createDiv({ cls: "fc-counter-ttl-bar", attr: { "data-fc-counter-ttl": "" } });
          ttlBar.createSpan({ text: "Позначки в дереві", cls: "fc-counter-ttl-label" });
          const ttlSegmented = ttlBar.createDiv({ cls: "fc-counter-ttl-segmented", attr: { role: "group", "aria-label": "Час показу позначок у дереві" } });
          const activeTtl = this.counterTimeoutSec();
          for (const [sec, labelText, tipText] of [
            [30, "30с", "Ховати цифри в дереві через 30 секунд (історія лишається тут)"],
            [120, "2хв", "Ховати цифри в дереві через 2 хвилини"],
            [0, "∞", "Тримати цифри в дереві, поки файл не відкрито"],
            [-1, "Вимк", "Не показувати цифри в дереві (лише у списку «Оновлення»)"],
          ]) {
            const btn = ttlSegmented.createEl("button", {
              text: labelText,
              cls: "fc-counter-ttl-pill" + (activeTtl === sec ? " is-active" : ""),
              attr: { type: "button", "data-fc-ttl-sec": String(sec), "aria-pressed": String(activeTtl === sec), title: tipText },
            });
            btn.addEventListener("click", () => this.setCounterTimeoutSec(sec));
          }
          const equipDetails = drawer.createEl("details", { cls: "fc-legend-subdetails", attr: { "data-fc-legend-group": "equipment" } });
          equipDetails.createEl("summary", { text: `Статуси майна (${CANONICAL_EQUIPMENT_STATUSES.length})` });
          const statusWrap = equipDetails.createDiv({ cls: "fc-legend-status-pills" });
          for (const meta of CANONICAL_EQUIPMENT_STATUSES) {
            appendStatusPill(statusWrap, meta, "fc-legend-pill", {
              "data-fc-tree-status": meta.key,
              title: meta.fullLabel,
            });
          }
          const peopleDetails = drawer.createEl("details", { cls: "fc-legend-subdetails", attr: { "data-fc-legend-group": "people" } });
          peopleDetails.createEl("summary", { text: `Люди та етапи воронки (${CANONICAL_PERSON_STATUSES.length})` });
          const personWrap = peopleDetails.createDiv({ cls: "fc-legend-status-pills" });
          for (const meta of CANONICAL_PERSON_STATUSES) {
            appendStatusPill(personWrap, meta, "fc-tree-person-status fc-legend-pill", {
              "data-fc-legend-person-status": meta.key,
              title: meta.fullLabel,
            });
          }
        };

        const renderUpdatesSection = () => {
          const allEntries = Array.from((this.unreviewedUpdates || new Map()).entries())
            .filter(([uPath]) => typeof uPath === "string" && !isSyncArchivePath(uPath))
            .sort(([, a], [, b]) => (Date.parse(b.editedAt || b.updatedAt) || 0) - (Date.parse(a.editedAt || a.updatedAt) || 0));
          if (allEntries.length > 0) {
            const platformEntries = allEntries.filter(([uPath, uInfo]) => badgeToneForKind(uInfo?.kind, uPath) === "platform");
            const driveEntries = allEntries.filter(([uPath, uInfo]) => badgeToneForKind(uInfo?.kind, uPath) === "drive");
            const filterKind = this.updatesFilterKind || "all";
            const baseEntries = filterKind === "platform"
              ? platformEntries
              : filterKind === "drive"
                ? driveEntries
                : allEntries;

            const updCard = bodySlot.createDiv({ cls: "fc-deck-card fc-unreviewed-card", attr: { "data-fc-unreviewed-card": "" } });
            const updHead = updCard.createDiv({ cls: "fc-deck-header" });
            const updTitleWrap = updHead.createDiv({ cls: "fc-upd-head-title" });
            updTitleWrap.createEl("h4", {
              text: "🔔 Оновлення",
              cls: "fc-deck-title",
            });
            updTitleWrap.createSpan({
              text: String(allEntries.length),
              cls: "fc-upd-count-badge",
            });
            const clearBtn = updHead.createEl("button", {
              text: "Прочитано все",
              cls: "fc-text-btn",
              attr: { type: "button", title: "Позначити всі автооновлення як переглянуті" },
            });
            clearBtn.addEventListener("click", () => this.clearAllUnreviewedUpdates());

            const filterRow = updCard.createDiv({ cls: "fc-update-filter-chips" });
            for (const [fKey, fLabel] of [
              ["all", `Усі (${allEntries.length})`],
              ["platform", `Сайт (${platformEntries.length})`],
              ["drive", `Drive (${driveEntries.length})`],
            ]) {
              const chip = filterRow.createEl("button", {
                text: fLabel,
                cls: "fc-entity-pill" + (filterKind === fKey ? " is-active" : ""),
                attr: { type: "button", "data-fc-update-filter": fKey, "aria-pressed": String(filterKind === fKey) },
              });
              chip.addEventListener("click", () => {
                this.updatesFilterKind = fKey;
                this.updatesShowAll = false;
                this.refreshDockViews(true);
              });
            }

            let searchInput = null;
            if (allEntries.length > 8) {
              const searchWrap = updCard.createDiv({ cls: "fc-update-search-wrap" });
              searchInput = searchWrap.createEl("input", {
                cls: "fc-update-search-input",
                attr: {
                  type: "search",
                  placeholder: "Пошук в оновленнях (назва, автор, папка)…",
                  "aria-label": "Фільтр оновлень",
                  "data-fc-updates-search": "",
                },
              });
              searchInput.value = this.updatesSearchQuery || "";
            }

            const listContainer = updCard.createDiv({ cls: "fc-update-list-wrap" });
            const clearListEl = (el) => {
              if (typeof el.empty === "function") el.empty();
              else if (typeof el.replaceChildren === "function") el.replaceChildren();
              else if (Array.isArray(el.children)) el.children.length = 0;
            };

            const drawUpdatesRows = () => {
              clearListEl(listContainer);
              const q = String(this.updatesSearchQuery || "").trim().toLowerCase();
              const visibleEntries = q
                ? baseEntries.filter(([uPath, uInfo]) =>
                    uPath.toLowerCase().includes(q) ||
                    String(uInfo?.editorName || "").toLowerCase().includes(q) ||
                    String(uInfo?.summary || "").toLowerCase().includes(q))
                : baseEntries;

              const pageLimit = this.updatesShowAll ? visibleEntries.length : 10;
              const shownEntries = visibleEntries.slice(0, pageLimit);
              if (!shownEntries.length) {
                listContainer.createDiv({
                  cls: "fc-update-empty",
                  text: q ? "За вашим запитом оновлень не знайдено." : "Непрочитаних оновлень у цьому джерелі немає.",
                });
                return;
              }
              const updList = listContainer.createEl("ul", { cls: "fc-workspace-activity-list fc-update-list" });
              for (const [uPath, uInfo] of shownEntries) {
                const tone = badgeToneForKind(uInfo?.kind, uPath);
                const itemStatus = this.equipmentStatusForPath(uPath) || this.personStatusForPath(uPath);
                const li = updList.createEl("li", { cls: "fc-deck-row fc-update-row", attr: { "data-tone": tone } });
                const topLine = li.createDiv({ cls: "fc-update-row-top" });
                const titleGroup = topLine.createDiv({ cls: "fc-deck-row-title-wrap" });
                const stem = uPath.split("/").pop()?.replace(/\.(?:md|canvas|base)$/i, "") || uPath;
                const typeIcon = /\.canvas$/i.test(uPath) ? "🎨 " : /\.base$/i.test(uPath) ? "🗃️ " : "";
                const folderTrail = uPath.includes("/") ? uPath.slice(0, uPath.lastIndexOf("/")).split("/").slice(-2).join(" / ") : "";
                const titleBtn = titleGroup.createEl("button", {
                  text: `${typeIcon}${stem}`,
                  cls: "fc-update-title-btn",
                  attr: { type: "button", title: uPath },
                });
                titleBtn.addEventListener("click", () => void this.openUpdateNotePath(uPath));
                if (itemStatus) {
                  appendStatusPill(titleGroup, itemStatus, itemStatus.category === "person" ? "fc-tree-person-status" : "", {
                    "data-fc-tree-status": itemStatus.key,
                    title: itemStatus.tooltip || itemStatus.fullLabel,
                  });
                }
                const whenLabel = formatEditorTimestamp(uInfo.editedAt || uInfo.updatedAt);
                const source = uInfo.kind === "page" || tone === "platform" ? "Сайт" : "Drive";
                const detailButton = topLine.createEl("button", {
                  text: uInfo.count > 1 ? String(uInfo.count) : "···",
                  cls: "fc-update-detail-button",
                  attr: { type: "button", "data-tone": tone, "aria-label": `Деталі оновлення: ${stem}`, "aria-expanded": "false" },
                });
                this.bindUpdateDetails(li, detailButton, { info: uInfo, path: uPath, title: stem, source });

                const subLine = li.createDiv({ cls: "fc-update-row-sub" });
                subLine.createSpan({
                  cls: "fc-update-row-meta",
                  text: [source, uInfo.editorName || folderTrail, whenLabel].filter(Boolean).join(" · "),
                });
                const rowBtns = subLine.createDiv({ cls: "fc-update-row-actions" });
                const dismissUpdBtn = rowBtns.createEl("button", {
                  text: "✓",
                  cls: "fc-row-action-btn fc-row-action-icon",
                  attr: { type: "button", "aria-label": `Позначити прочитаним: ${stem}`, title: "Позначити прочитаним" },
                });
                dismissUpdBtn.addEventListener("click", () => this.markNoteReviewed(uPath));
              }

              if (visibleEntries.length > 10) {
                const moreBtn = listContainer.createEl("button", {
                  text: this.updatesShowAll ? "Згорнути список" : `Показати ще (${visibleEntries.length - 10})`,
                  cls: "fc-text-btn fc-show-more-btn",
                  attr: { type: "button" },
                });
                moreBtn.addEventListener("click", () => {
                  this.updatesShowAll = !this.updatesShowAll;
                  drawUpdatesRows();
                });
              }
            };

            drawUpdatesRows();
            if (searchInput) {
              searchInput.addEventListener("input", () => {
                this.updatesSearchQuery = searchInput.value;
                drawUpdatesRows();
              });
            }

            renderInlineLegendBar(updCard);
          } else {
            const emptyLegendWrap = bodySlot.createDiv({ cls: "fc-deck-card fc-legend-compact-card" });
            renderInlineLegendBar(emptyLegendWrap);
          }
        };

        if (activeDocPeers.length > 0) {
          renderRadarSection();
          renderUpdatesSection();
        } else {
          renderUpdatesSection();
          renderRadarSection();
        }

        if (hasToken && (this.workspaceActivity?.length || this.sharedPeers?.length)) {
          const onlineRooms = this.dedupeOnlineRooms(this.workspaceActivity, this.sharedPeers, file, sharedPath);
          if (onlineRooms.length) {
          const totalOnlinePeers = onlineRooms.reduce((sum, r) => sum + ((r.peers || []).length), 0);
          const roomsCard = bodySlot.createDiv({ cls: "fc-deck-card fc-online-rooms-card", attr: { "data-fc-online-rooms": "" } });
          const roomsHead = roomsCard.createDiv({ cls: "fc-deck-header" });
          roomsHead.createEl("h4", { cls: "fc-deck-title", text: `🌐 Зараз онлайн у документах (${totalOnlinePeers})` });
          const list = roomsCard.createEl("ul", { cls: "fc-workspace-activity-list fc-online-rooms-list" });
          for (const room of onlineRooms) {
            const roomIsCanvas = /\.canvas$/i.test(String(room.path || room.title || ""));
            const isCurrent = Boolean(
              (room.slug && room.slug === this.liveSlug) ||
              (room.kind === "drive" && room.fileId && (this.liveSession?.fileId === room.fileId || this.resolveDriveIdForFile?.(file) === room.fileId)) ||
              (room.kind === "shared" && room.path && sharedPath === room.path)
            );
            const li = list.createEl("li", { cls: "fc-online-room" + (isCurrent ? " is-current" : "") });
            const roomTop = li.createDiv({ cls: "fc-online-room-head" });
            const roomTitleBtn = roomTop.createEl("button", {
              text: `${roomIsCanvas ? "🎨" : "📄"} ${room.title || room.path || room.slug}`,
              cls: "fc-online-room-title",
              attr: {
                type: "button",
                title: isCurrent ? "Ви вже в цьому документі" : `Відкрити ${room.path || room.title || room.slug} в Obsidian`,
              },
            });
            roomTitleBtn.addEventListener("click", () => {
              const firstPeer = (room.peers || []).find((p) => p.clientId !== this.clientId) || (room.peers || [])[0] || null;
              void this.teleportToOnlinePeer(room, firstPeer);
            });
            const roomHeadRight = roomTop.createDiv({ cls: "fc-online-room-actions" });
            if (isCurrent) {
              roomHeadRight.createSpan({ text: "Тут", cls: "fc-online-here-pill" });
            }
            if (room.kind === "drive" && room.fileId) {
              const gDriveUrl = driveOpenUrlForPath(room.fileId, room.path);
              const webUrl = `${SITE}/markdown?view=vault&file=${encodeURIComponent(room.fileId)}&edit=1`;
              const docsBtn = roomHeadRight.createEl("button", {
                text: "Docs ↗",
                cls: "fc-online-mini-link",
                attr: { type: "button", title: `Відкрити у Google Docs: ${gDriveUrl}` },
              });
              docsBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                this.openSite(gDriveUrl);
              });
              const vaultBtn = roomHeadRight.createEl("button", {
                text: "Vault ↗",
                cls: "fc-online-mini-link",
                attr: { type: "button", title: `Відкрити у FlightClub Drive Vault: ${webUrl}` },
              });
              vaultBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                this.openSite(webUrl);
              });
            }

            const peersBox = li.createDiv({ cls: "fc-online-peer-list" });
            for (const peer of room.peers || []) {
              const isSelfClient = Boolean(peer.clientId && peer.clientId === this.clientId);
              const isSameUser = Boolean(!isSelfClient && peer.userId && peer.userId === this.vaultConfig.pairedUserId);
              const pInfo = this.describePeerActivity(peer, roomIsCanvas);
              const pRow = peersBox.createDiv({
                cls: "fc-online-peer-row" + (pInfo.editing ? " is-editing" : "") + (isSelfClient ? " is-self" : ""),
              });
              if (peer.color) pRow.style.borderLeftColor = peer.color;
              const pMain = pRow.createDiv({ cls: "fc-online-peer-main" });
              const pIdentity = pMain.createDiv({ cls: "fc-online-peer-who" });
              pIdentity.createSpan({
                cls: "fc-live-state-dot" + (pInfo.editing ? " is-editing" : ""),
                attr: { "aria-hidden": "true" },
              });
              const suffix = isSelfClient ? " (ви)" : isSameUser ? " (інший пристрій)" : "";
              pIdentity.createEl("strong", { text: `${peer.name || "Учасник"}${suffix}`, cls: "fc-online-peer-name" });
              pIdentity.createSpan({
                text: peer.source === "web" ? "🌐 Сайт" : "💎 Obsidian",
                cls: "fc-online-source-pill",
              });
              pMain.createEl("div", {
                text: `${pInfo.icon} ${pInfo.text}`,
                cls: "fc-online-peer-status" + (pInfo.editing ? " is-editing" : ""),
              });

              const teleportBtn = pRow.createEl("button", {
                text: isCurrent
                  ? (roomIsCanvas ? "🎨 Фокус" : `🎯 Ряд. ${pInfo.line || 1}`)
                  : (pInfo.line && !roomIsCanvas ? `🎯 Ряд. ${pInfo.line}` : "🎯 Телепорт"),
                cls: "fc-deck-btn fc-teleport-btn",
                attr: {
                  type: "button",
                  "data-fc-teleport-peer": peer.clientId || peer.userId || peer.name || "peer",
                  title: isCurrent
                    ? `Перейти до позиції ${peer.name} у цьому документі`
                    : `Телепортуватися до ${peer.name} у «${room.title || room.slug}»${pInfo.line ? ` (ряд. ${pInfo.line})` : ""}`,
                },
              });
              teleportBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                void this.teleportToOnlinePeer(room, peer);
              });
              pRow.addEventListener("click", () => void this.teleportToOnlinePeer(room, peer));
            }
          }
          }
        }
      } else if (activeTab === "entities") {
        this.renderMentionSearch(bodySlot.createDiv({ cls: "fc-deck-card" }), { file, state: opts.mentionState });
      } else if (activeTab === "graph") {
        this.renderGraphInsights(bodySlot, { expanded: false });
      } else if (activeTab === "history") {
        this.renderHistoryPanel(bodySlot.createDiv({ cls: "fc-deck-card" }), file, activeLink, { showTitle: false });
      } else if (activeTab === "pages") {
        // Pages /m/ Browser & 1-Click Sync Tab
        const pagesCard = bodySlot.createDiv({ cls: "fc-deck-card" });
        const entries = Array.from(this.links.entries()).filter(([p]) => !isSyncArchivePath(p));
        const pHead = pagesCard.createDiv({ cls: "fc-deck-header" });
        pHead.createEl("h4", {
          text: `📚 Сторінки бази знань /m/ (${entries.length})`,
          cls: "fc-deck-title",
        });

        const syncBtns = pagesCard.createDiv({ cls: "fc-deck-grid" });
        const pullBtn = syncBtns.createEl("button", {
          text: "📥 Завантажити всі сторінки у Vault",
          cls: "mod-cta fc-deck-btn",
          attr: { type: "button" },
        });
        pullBtn.addEventListener("click", () => void this.pullPagesFromSite());

        const idxBtn = syncBtns.createEl("button", {
          text: "🔄 Оновити індекс",
          cls: "fc-deck-btn",
          attr: { type: "button" },
        });
        idxBtn.addEventListener("click", () => void this.syncIndexFromSite(true));

        const filterState = opts.pagesFilterState || { query: "" };
        const searchInput = pagesCard.createEl("input", {
          attr: { type: "search", placeholder: "Фільтр за назвою файлу або slug…" },
        });
        searchInput.value = filterState.query || "";
        const listEl = pagesCard.createDiv({ cls: "fc-deck-list" });
        const renderRows = (q) => {
          listEl.empty();
          const cleanQ = String(q || "").trim().toLowerCase();
          for (const [notePath, linkInfo] of entries) {
            if (cleanQ && !`${notePath} ${linkInfo.slug}`.toLowerCase().includes(cleanQ)) continue;
            const catalogEntry = Array.isArray(this.remoteCatalog) ? this.remoteCatalog.find(p => p.slug === linkInfo.slug) : null;
            const mappedDriveId = this.resolveDriveIdForFile({ path: notePath }) || (DRIVE_ID.test(catalogEntry?.drive_file_id || "") ? catalogEntry.drive_file_id : null);
            const siteEditUrl = mappedDriveId
              ? `${SITE}/markdown?view=vault&file=${encodeURIComponent(mappedDriveId)}&edit=1`
              : `${pageUrl(linkInfo.slug)}?edit=1`;
            const driveView = mappedDriveId ? driveOpenUrlForPath(mappedDriveId, notePath) : null;
            const cleanName = String(notePath || "").split("/").pop()?.replace(/\.(?:md|markdown)$/i, "") || notePath;
            const folderPart = notePath.includes("/") ? notePath.slice(0, notePath.lastIndexOf("/")) : "";
            const row = listEl.createDiv({ cls: "fc-deck-row" });
            const info = row.createDiv({ cls: "fc-deck-row-info" });
            const titleWrap = info.createDiv({ cls: "fc-deck-row-title-wrap" });
            titleWrap.createSpan({ text: catalogEntry?.title || cleanName, cls: "fc-deck-row-title", attr: { title: notePath } });
            const unrev = this.unreviewedUpdates?.get(notePath);
            if (unrev && unrev.count > 0) {
              const pTone = badgeToneForKind(unrev.kind, notePath);
              titleWrap.createSpan({
                text: `+${unrev.count}`,
                cls: "fc-tree-update-badge",
                attr: { "data-fc-update-badge": `+${unrev.count}`, "data-tone": pTone, title: unrev.summary || "" },
              });
            }
            const stateBadge = linkInfo.conflict
              ? "⚠️ Перевірити"
              : linkInfo.dirtyLocal
                ? "✏️ Локальні зміни"
                : "✅ Актуально";
            const metaParts = [mappedDriveId ? "Drive Docs" : `/m/${linkInfo.slug}`, folderPart || null, stateBadge].filter(Boolean);
            info.createSpan({
              text: metaParts.join(" · "),
              cls: "fc-deck-row-meta",
            });
            const actions = row.createDiv({ cls: "fc-deck-grid" });
            const openNoteBtn = actions.createEl("button", {
              text: "Відкрити",
              cls: "fc-deck-btn",
              attr: { type: "button" },
            });
            openNoteBtn.addEventListener("click", async () => {
              if (mappedDriveId) {
                const liveFound = this.findLiveDriveFile(mappedDriveId, catalogEntry?.obsidian_path || notePath);
                if (liveFound) {
                  await this.openDriveFileInObsidian(mappedDriveId, liveFound.path);
                  return;
                }
              }
              const abs = !isSyncArchivePath(notePath) ? this.app.vault.getAbstractFileByPath(notePath) : null;
              if (abs instanceof TFile) {
                await this.app.workspace.getLeaf(false).openFile(abs, { active: true });
              } else {
                new Notice("Файл нотатки не знайдено: " + notePath);
              }
            });
            if (mappedDriveId && driveView) {
              const docsBtn = actions.createEl("button", {
                text: "Docs ↗",
                cls: "fc-deck-btn",
                attr: { type: "button", title: `Відкрити у Google Drive / Docs: ${driveView}` },
              });
              docsBtn.addEventListener("click", () => this.openSite(driveView));
              const vaultBtn = actions.createEl("button", {
                text: "Vault ↗",
                cls: "fc-deck-btn",
                attr: { type: "button", title: `Відкрити у FlightClub Drive Vault: ${siteEditUrl}` },
              });
              vaultBtn.addEventListener("click", () => this.openSite(siteEditUrl));
            } else {
              const openWebBtn = actions.createEl("button", {
                text: "Сайт ↗",
                cls: "fc-deck-btn",
                attr: { type: "button", title: siteEditUrl },
              });
              openWebBtn.addEventListener("click", () => this.openSite(siteEditUrl));
            }
            const copyUrl = (mappedDriveId && driveView) ? driveView : siteEditUrl;
            const copyPageBtn = actions.createEl("button", {
              text: "📋 Лінк",
              cls: "fc-deck-btn",
              attr: { type: "button", title: copyUrl },
            });
            copyPageBtn.addEventListener("click", () => void this.copyTextToClipboard(copyUrl, mappedDriveId ? "Посилання Google Drive скопійовано" : "Посилання скопійовано"));
          }
        };
        searchInput.addEventListener("input", () => {
          filterState.query = searchInput.value;
          renderRows(searchInput.value);
        });
        renderRows(filterState.query);
      } else if (activeTab === "drive") {
        // 1) Shared Folder / Published Vault (first <select> for plugin-ui.test.mjs)
        const syncCard = bodySlot.createDiv({ cls: "fc-deck-card fc-sync-card fc-shared-secondary" });
        syncCard.createEl("h4", { cls: "fc-deck-title", text: "FlightClub Sync" });
        const scope = this.folderSyncScope();
        const root = scope === "private" ? this.treeSyncState?.localRoot || "FlightClub Sync" : "FlightClub Shared";
        syncCard.createEl("p", { cls: "fc-sync-note", text: (scope === "staff" ? "Опублікований вольт · " : "Папка ADMAX · ") + root });
        if (scope === "staff") {
          syncCard.createEl("button", { text: "Опублікований вольт на сайті", attr: { type: "button" } })
            .addEventListener("click", () => {
              const target = new URL("/markdown?view=shared", SITE);
              const active = this.sharedWebNote;
              if (active?.path === this.sharedNotePath() && active.token === this.vaultConfig.deviceToken) {
                target.searchParams.set("note", active.fileId);
                target.searchParams.set("edit", "1");
              }
              this.openSite(target.href);
            });
        }
        if (this.accountCanSyncPrivate) {
          const field = syncCard.createEl("label", { cls: "fc-deck-field" });
          field.createSpan({ text: "Сховище синхронізації" });
          const select = field.createEl("select");
          select.createEl("option", { text: "Опублікований вольт", attr: { value: "staff" } });
          select.createEl("option", { text: "Приватне ADMAX", attr: { value: "private" } });
          select.value = scope;
          select.disabled = this.treeSyncBusy || this.driveDownloading;
          select.addEventListener("change", async () => {
            if (this.treeSyncBusy || this.driveDownloading) { select.value = scope; return; }
            const previous = this.vaultConfig.folderSyncScope;
            this.vaultConfig.folderSyncScope = select.value;
            this.folderSyncRevision = undefined;
            this.folderSyncOpenPending = false;
            this.treeSyncMessage = "";
            try { await this.persist(); }
            catch {
              this.vaultConfig.folderSyncScope = previous;
              new Notice("Не вдалося зберегти налаштування.");
            }
            if (!this.alive) return;
            this.refreshDockViews();
            void this.runAutomaticFolderSync();
          });
        }
        const syncStatus = syncCard.createEl("p", { cls: "fc-sync-status", attr: { role: "status" } });
        syncStatus.setText(this.vaultConfig.deviceToken
          ? this.treeSyncMessage || "Перевірте, чи доступне сховище для вашого профілю."
          : "Підключіть акаунт FlightClub, щоб перевірити сховище.");
        const reportSync = message => {
          this.treeSyncMessage = message;
          syncStatus.setText(message);
        };
        const automaticLabel = syncCard.createEl("label",{cls:"fc-sync-note"});
        const automatic = automaticLabel.createEl("input",{attr:{type:"checkbox"}});
        const usingDrivePrimary = this.vaultConfig.pairedReadDrive !== false && this.vaultConfig.driveAutoSync !== false;
        automatic.checked = scope === "staff" && usingDrivePrimary
          ? Boolean(this.vaultConfig.folderAutoSync && this.vaultConfig.explicitStaffFolderSync)
          : Boolean(this.vaultConfig.folderAutoSync);
        automatic.disabled = !this.accountVerified || !this.vaultConfig.pairedCanSync;
        automaticLabel.createSpan({text:" Автоматично синхронізувати опубліковані файли (FlightClub Shared)"});
        automatic.addEventListener("change",async()=>{
          const prevAuto = this.vaultConfig.folderAutoSync;
          const prevExplicit = this.vaultConfig.explicitStaffFolderSync;
          this.vaultConfig.folderAutoSync = automatic.checked;
          if (scope === "staff") this.vaultConfig.explicitStaffFolderSync = automatic.checked;
          try {await this.persist();if(automatic.checked){this.folderSyncDirty=true;void this.runAutomaticFolderSync();}}
          catch {
            this.vaultConfig.folderAutoSync = prevAuto;
            this.vaultConfig.explicitStaffFolderSync = prevExplicit;
            automatic.checked = prevAuto;
            new Notice("Не вдалося зберегти налаштування.");
          }
        });
        const syncActions = syncCard.createDiv({ cls: "fc-deck-grid" });
        const checkButton = syncActions.createEl("button", { cls: "fc-deck-btn", text: "Перевірити сховище", attr: { type: "button" } });
        const syncButton = syncActions.createEl("button", { cls: "mod-cta fc-deck-btn", text: "Переглянути зміни", attr: { type: "button" } });
        checkButton.disabled = syncButton.disabled = !this.accountVerified || !this.vaultConfig.pairedCanSync;
        checkButton.addEventListener("click", async () => {
          checkButton.disabled = true;
          reportSync("Перевіряємо доступ…");
          try {
            const status = await this.treeSync.status();
            if (this.alive) reportSync("Сховище доступне · " + status.files + " файлів.");
          } catch (error) {
            if (this.alive) reportSync(error.message);
          } finally { checkButton.disabled = !this.accountVerified || !this.vaultConfig.pairedCanSync; }
        });
        syncButton.addEventListener("click", () => void this.previewTreeSync(reportSync));

        // 2) Primary Google Drive Two-Way Sync Card (Drive is Authoritative)
        const driveCard = bodySlot.createDiv({ cls: "fc-deck-card fc-sync-card" });
        const driveHead = driveCard.createDiv({ cls: "fc-deck-header" });
        driveHead.createEl("h4", { cls: "fc-deck-title", text: "FlightClub Vault · Google Drive" });
        driveHead.createSpan({
          cls: "fc-deck-badge " + (this.vaultConfig.driveAutoSync !== false ? "fc-deck-badge-ok" : ""),
          text: this.vaultConfig.driveAutoSync !== false ? "Драйв головний · Автосінк" : "Ручний режим",
        });
        if (hasToken) driveCard.createEl("p", { cls: "fc-sync-note", text: [
          this.accountVerified ? this.vaultConfig.pairedRole : "Роль перевіряється",
          this.accountVerified && this.vaultConfig.pairedCanEdit ? "Двосторонній сінк (текст, Canvas, .base, фото)" : "Читання дозволених файлів",
          this.drivePreview ? `${this.drivePreview.available}${this.drivePreview.partial ? "+" : ""} файлів на Drive` : "",
        ].filter(Boolean).join(" · ") });
        const downloadStatus = driveCard.createEl("p", { cls: "fc-sync-status", text: this.driveDownloadStatus || "Готово до синхронізації з Google Drive.", attr: { role: "status", "data-fc-download-status": "" } });
        downloadStatus.hidden=!this.driveDownloading && Boolean(this.syncTotals?.drive);
        this.renderSyncMetrics(driveCard);
        const progress = driveCard.createEl("progress", {cls:"fc-import-progress", attr: {"data-fc-import-progress":"", "aria-label":this.importProgress?.stage||"Синхронізація Drive"}});
        progress.hidden = !this.driveDownloading;
        if (this.importProgress?.total > 0) { progress.max=this.importProgress.total; progress.value=this.importProgress.current; }
        const driveBtnRow = driveCard.createDiv({ cls: "fc-deck-grid" });
        const hasLocalDriveFiles = this.driveFilesCount() > 0 || this.drivePreview?.matches > 0;
        const download = driveBtnRow.createEl("button", {
          cls: "mod-cta fc-deck-btn",
          text: this.driveDownloading ? "Синхронізація триває…"
            : hasLocalDriveFiles ? "🔄 Синхронізувати з Drive зараз" : "Імпортувати з Drive",
          attr: { type: "button" },
        });
        download.disabled = !hasToken || Boolean(this.driveDownloading || this.reviewSyncBusy || this.updatingPlugin) || this.drivePreview?.available === 0;
        download.addEventListener("click", () => void this.startVaultDownload(message => downloadStatus.setText(message), {
          pushLocal: hasLocalDriveFiles,
        }));
        const accessButton = driveBtnRow.createEl("button", { text:"Звірити доступ",cls:"fc-deck-btn",attr:{type:"button"} });
        accessButton.disabled = !hasToken || Boolean(this.driveDownloading || this.previewingDrive);
        accessButton.addEventListener("click",()=>void this.prepareVaultImport({allowAutomatic:false}));
        const openVault = driveBtnRow.createEl("button", { cls: "fc-deck-btn", text: "Відкрити веб-Vault", attr: { type: "button" } });
        openVault.hidden = !this.accountIsAdmax;
        openVault.addEventListener("click", () => this.openSite(DRIVE_VAULT_URL));
        const canManageCadetSync = Boolean(this.accountIsAdmax || /^admin$/i.test(String(this.vaultConfig?.pairedRole || "")));
        const syncCadetsBtn = driveBtnRow.createEl("button", {
          cls: "fc-deck-btn",
          text: this.cadetSyncBusy ? "Синхр. профілів…" : "👤 Синхр. профілі курсантів",
          attr: { type: "button", title: "Автоматично створити відсутні профілі курсантів з Google Таблиці у 01_03 Профілі курсантів" },
        });
        syncCadetsBtn.hidden = !hasToken || !canManageCadetSync;
        syncCadetsBtn.disabled = !hasToken || !canManageCadetSync || Boolean(this.cadetSyncBusy || this.driveDownloading);
        syncCadetsBtn.addEventListener("click", () => void this.syncCadetProfilesFromSheet(downloadStatus));
        const teamSharedCount = (this.teamPluginsCatalog?.plugins || []).length;
        const admaxPluginsBtn = driveBtnRow.createEl("button", {
          cls: "fc-deck-btn",
          text: teamSharedCount ? `🧩 Плагіни команди (${teamSharedCount})` : "🧩 Плагіни команди",
          attr: {
            type: "button",
            "data-fc-admax-team-plugins": "",
            title: "Вибрати встановлені плагіни для синхронізації в команді та автоматичного підвантаження з Community Plugins",
          },
        });
        admaxPluginsBtn.hidden = !hasToken || !this.accountIsAdmax;
        admaxPluginsBtn.disabled = !hasToken || !this.accountIsAdmax;
        admaxPluginsBtn.addEventListener("click", () => void this.openAdmaxTeamPluginsModal());
        if (this.driveDownloading) {
          const cancel = driveBtnRow.createEl("button", {text:"Призупинити", cls:"fc-deck-btn",attr:{type:"button"}});
          cancel.addEventListener("click",()=>{this.cancelDriveDownload=true;cancel.disabled=true;downloadStatus.setText("Завершуємо поточний крок…");});
        }
        if (this.pagesDownloadStatus) driveCard.createEl("p", { cls: "fc-sync-note", text: this.pagesDownloadStatus });
        if (this.driveLastSummary?.backups?.length) {
          const backupDetails = driveCard.createEl("details", { cls: "fc-secondary-actions" });
          backupDetails.createEl("summary", { text: `📦 Архів конфліктів / видалень (${this.driveLastSummary.backups.length})` });
          const bList = backupDetails.createDiv({ cls: "fc-backup-list" });
          for (const item of this.driveLastSummary.backups.slice(0, 12)) {
            const bRow = bList.createDiv({ cls: "fc-backup-row" });
            const cleanName = (item.path || item.backupPath || "").split("/").pop()?.replace(/\.(?:md|canvas)$/i, "") || item.backupPath;
            const reasonText = item.reason === "drive_wins_conflict" ? "чернетка до оновлення з Drive"
              : item.reason === "deleted_on_drive" ? "видалено на Drive"
              : item.reason === "remote_move" || item.reason === "remote_move_displaced" ? "переміщено на Drive"
              : "архівна копія";
            bRow.createSpan({ text: `${cleanName} (${reasonText})`, attr: { title: `${item.path} → ${item.backupPath}` } });
            const origFile = item.path ? this.app.vault.getAbstractFileByPath(item.path) : null;
            if (origFile instanceof TFile) {
              const oOpen = bRow.createEl("button", { text: "📂 Оригінал", cls: "fc-deck-btn", attr: { type: "button", title: item.path } });
              oOpen.addEventListener("click", () => this.openAndRevealFile(item.path));
            }
            const bOpen = bRow.createEl("button", { text: "📦 Архів", cls: "fc-deck-btn", attr: { type: "button", title: item.backupPath } });
            bOpen.addEventListener("click", () => {
              const bf = this.app.vault.getAbstractFileByPath(item.backupPath);
              if (bf instanceof TFile) this.openAndRevealFile(item.backupPath);
              else new Notice("Архівний файл не знайдено: " + item.backupPath);
            });
          }
        }
        const driveStatus = driveCard.createEl("p", { cls: "fc-sync-status", attr: { role: "status" } });
        const describeBinding = () => this.drivePreview?.source?.name
          ? "Папка Drive · " + this.drivePreview.source.name
          : "Звірте папку Google Drive із сайтом.";
        driveStatus.setText(describeBinding());
        const checkpoints = this.getSyncCheckpoints();
        if (checkpoints.length > 0) {
          const cpStrip = driveCard.createDiv({ cls: "fc-checkpoint-strip", attr: { "data-fc-sync-checkpoints": "" } });
          cpStrip.createSpan({ cls: "fc-checkpoint-label", text: "Синхрон-чекпоїнти" });
          const cpList = cpStrip.createDiv({ cls: "fc-checkpoint-list" });
          for (const cp of checkpoints) {
            const cpRow = cpList.createDiv({ cls: "fc-checkpoint-row" + (cp.active ? " is-active" : "") });
            cpRow.createSpan({ cls: "fc-checkpoint-name", text: cp.name });
            const metaBits = [
              cp.filesCount ? `${cp.filesCount} ф.` : null,
              cp.at ? new Date(cp.at).toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" }) : null,
            ].filter(Boolean);
            if (metaBits.length) cpRow.createSpan({ cls: "fc-checkpoint-meta", text: metaBits.join(" · ") });
            cpRow.createSpan({
              cls: "fc-checkpoint-pill" + (cp.active ? " is-active" : ""),
              text: cp.active ? "🟢 Активний" : "Чекпоїнт",
            });
          }
        }
        const driveForm = driveCard.createEl("form", { cls: "fc-sync-form" });
        driveForm.hidden = !this.accountIsAdmax;
        const driveField = driveForm.createEl("label", { cls: "fc-deck-field" });
        driveField.createSpan({ text: "Нова папка Drive (посилання або ID)" });
        const driveInput = driveField.createEl("input", {
          attr: { type: "text", autocomplete: "off", placeholder: "https://drive.google.com/drive/folders/…" },
        });
        const driveActions = driveForm.createDiv({ cls: "fc-deck-grid" });
        driveActions.createEl("button", { cls: "mod-cta fc-deck-btn", text: "Вибрати папку на сайті", attr: { type: "submit" } });
        const verifyButton = driveActions.createEl("button", { cls: "fc-deck-btn", text: "Звірити папку", attr: { type: "button" } });
        verifyButton.disabled = !this.vaultConfig.deviceToken;
        verifyButton.addEventListener("click", async () => {
          verifyButton.disabled = true;
          driveStatus.setText("Звіряємо прив’язку…");
          try {
            const binding = await this.verifyDriveBinding();
            if (this.alive) {
              driveStatus.setText(binding ? "Папка Drive · " + (binding.rootName || binding.rootId) : "Папку Drive ще не вибрано.");
              if (binding) void this.prepareVaultImport({ allowAutomatic: false });
            }
          } catch (error) {
            if (this.alive) driveStatus.setText(error.message);
          } finally { verifyButton.disabled = !this.vaultConfig.deviceToken; }
        });
        driveInput.addEventListener("input", () => {
          if (driveInput.hasAttribute("aria-invalid")) {
            driveInput.removeAttribute("aria-invalid");
            driveStatus.setText(describeBinding());
          }
        });
        driveForm.addEventListener("submit", event => {
          event.preventDefault();
          if (!this.accountIsAdmax) return;
          const input = driveInput.value.trim();
          const rootId = parseDriveInput(input);
          if (input && !rootId) {
            driveInput.setAttribute("aria-invalid", "true");
            driveStatus.setText("Вкажіть посилання на папку Google Drive або її ID.");
            driveInput.focus();
            return;
          }
          const id = crypto.randomUUID();
          this.pendingVault = { id, expires: Date.now() + TTL };
          const target = new URL(SITE + "/m/obsidian-sync");
          target.searchParams.set("obsidian", id);
          target.searchParams.set("intent", "vault");
          if (rootId) target.searchParams.set("drive", rootId);
          this.openSite(target.href);
          driveStatus.setText("Підтвердьте папку у браузері, а потім поверніться в Obsidian.");
        });
        const isMobileEnv = Boolean(Platform?.isMobile || Platform?.isMobileApp);
        if (!isMobileEnv) {
          const importInput = driveCard.createEl("input", { attr: { type: "file", webkitdirectory: "", multiple: "", hidden: "" } });
          const importButton = driveActions.createEl("button", { cls: "fc-deck-btn", text: "Імпортувати з локальної папки", attr: { type: "button" } });
          importButton.addEventListener("click", () => importInput.click());
          importInput.addEventListener("change", async () => {
            const selection = Array.from(importInput.files || []);
            importInput.value = "";
            if (!selection.length) return;
            importButton.disabled = true;
            driveStatus.setText("Звіряємо вибрану папку…");
            try {
              const scope = this.folderSyncScope();
              const plan = await this.treeSync.previewImport(selection);
              if (!this.alive) return;
              driveStatus.setText("Копію перевірено. Перегляньте результат перед імпортом.");
              this.dialogForm({
                title: "Імпорт копії Google Drive",
                description: "Обрана папка · " + plan.originalRoot + "\n"
                  + "Нових файлів · " + (plan.entries.length - plan.unchanged) + "\n"
                  + "Збігаються · " + plan.unchanged + "\nПропущено · " + plan.skipped
                  + "\n\nКопія з’явиться в " + this.treeSync.localRoot() + ". Після імпорту можна переглянути план синхронізації із сервером.",
                button: "Імпортувати",
                submit: async () => {
                  if (this.treeSyncBusy) throw new Error("Зачекайте завершення поточної синхронізації.");
                  if (this.folderSyncScope() !== scope) throw new Error("Сховище змінилося. Перегляньте імпорт ще раз.");
                  this.treeSyncBusy = true;
                  try {
                    const result = await this.treeSync.applyImport(plan);
                    if (this.alive) driveStatus.setText("Імпортовано · " + result.added + ". Збігаються · " + result.unchanged + ".");
                  } finally { this.treeSyncBusy = false; }
                },
              });
            } catch (error) {
              if (this.alive) driveStatus.setText(error.message);
            } finally { importButton.disabled = false; }
          });
        }

        const teamPlugins = this.teamPluginsCatalog?.plugins || [];
        if (hasToken && (teamPlugins.length > 0 || this.accountIsAdmax)) {
          const teamCard = bodySlot.createDiv({ cls: "fc-deck-card fc-sync-card fc-team-plugins-card", attr: { "data-fc-team-plugins-card": "" } });
          const teamHead = teamCard.createDiv({ cls: "fc-deck-header" });
          teamHead.createEl("h4", { cls: "fc-deck-title", text: `🧩 Плагіни команди (${teamPlugins.length})` });
          if (this.teamPluginsCatalog?.updatedBy) {
            teamHead.createSpan({ cls: "fc-deck-badge", text: `ADMAX · ${this.teamPluginsCatalog.updatedBy}` });
          }
          const installedIds = new Set(
            Object.keys(this.app?.plugins?.manifests || {}).map((id) => id.toLowerCase()),
          );
          const enabledIds = new Set(
            Array.from(this.app?.plugins?.enabledPlugins || []).map((id) => String(id).toLowerCase()),
          );
          let installedCnt = 0;
          let missingCnt = 0;
          let disabledCnt = 0;
          for (const tp of teamPlugins) {
            const key = String(tp.id || "").toLowerCase();
            if (!installedIds.has(key)) missingCnt++;
            else if (enabledIds.size && !enabledIds.has(key)) disabledCnt++;
            else installedCnt++;
          }
          const summaryText = teamPlugins.length === 0
            ? "Спільний список плагінів ще не налаштований. Натисніть «Налаштувати список», щоб обрати плагіни для команди."
            : missingCnt === 0 && disabledCnt === 0
              ? `Усі ${teamPlugins.length} плагінів команди встановлені й готові до роботи.`
              : `Установлено: ${installedCnt} із ${teamPlugins.length}` +
                (missingCnt ? ` · Потрібно встановити: ${missingCnt}` : "") +
                (disabledCnt ? ` · Потрібно увімкнути: ${disabledCnt}` : "");
          teamCard.createEl("p", { cls: "fc-team-plugins-summary", text: summaryText });
          const teamBtns = teamCard.createDiv({ cls: "fc-deck-grid" });
          if (teamPlugins.length > 0) {
            const installTeamBtn = teamBtns.createEl("button", {
              cls: (missingCnt > 0 || disabledCnt > 0 ? "mod-cta " : "") + "fc-deck-btn",
              text: missingCnt > 0
                ? `⬇️ Встановити з Community Plugins (${missingCnt + disabledCnt})`
                : disabledCnt > 0
                  ? `▶ Увімкнути плагіни (${disabledCnt})`
                  : "Переглянути плагіни команди",
              attr: { type: "button", "data-fc-open-team-plugins-installer": "" },
            });
            installTeamBtn.addEventListener("click", () => void this.openTeamPluginsInstallerModal());
          }
          if (this.accountIsAdmax) {
            const manageBtn = teamBtns.createEl("button", {
              cls: (teamPlugins.length === 0 ? "mod-cta " : "") + "fc-deck-btn",
              text: "⚙️ Налаштувати список",
              attr: { type: "button", "data-fc-open-team-plugins-admin": "" },
            });
            manageBtn.addEventListener("click", () => void this.openAdmaxTeamPluginsModal());
          }
        }

        // 3) Drive Sync Preferences (folderSelect remains last <select> for plugin-ui.test.mjs)
        const notesCard = bodySlot.createDiv({ cls: "fc-deck-card fc-sync-card" });
        notesCard.createEl("h4", { cls: "fc-deck-title", text: "Параметри Google Drive" });
        for (const [key, title] of [
          ["driveAutoSync","Автоматичний двосторонній сінк з Google Drive (Драйв головний)"],
          ["refreshOnStartup","Синхронізувати при запуску Obsidian"],
          ["importPages","Імпортувати доступні сторінки бази знань /m/"],
          ["importPhotos","Завантажувати фото майна"],
        ]) {
          if (key === "importPhotos" && !this.vaultConfig.pairedCanEdit) continue;
          const setting = notesCard.createEl("label",{cls:"fc-import-setting"});
          const checkbox = setting.createEl("input",{attr:{type:"checkbox"}});
          checkbox.checked = this.vaultConfig[key] === true;
          setting.createSpan({text:title});
          checkbox.addEventListener("change",async()=>{
            const previous = this.vaultConfig[key];
            const previousPaused = this.vaultConfig.refreshPausedByUser;
            this.vaultConfig[key] = checkbox.checked;
            if (key === "refreshOnStartup") this.vaultConfig.refreshPausedByUser = !checkbox.checked;
            try {
              await this.persist();
              if (key === "driveAutoSync" && checkbox.checked) void this.runAutomaticDriveSync();
            }
            catch {
              this.vaultConfig[key]=previous;
              if (key === "refreshOnStartup") this.vaultConfig.refreshPausedByUser = previousPaused;
              checkbox.checked=previous===true;
              new Notice("Не вдалося зберегти параметр синхронізації.");
            }
          });
        }
        const folderField = notesCard.createEl("label", { cls: "fc-deck-field" });
        folderField.createSpan({ text: "Локальна папка для Google Drive Vault" });
        const folderSelect = folderField.createEl("select");
        for (const fPath of this.vaultFolders()) {
          const opt = folderSelect.createEl("option", {
            text: fPath || "Корінь Obsidian Vault",
            attr: { value: fPath },
          });
          if (fPath === (this.vaultConfig.localVaultRoot || "")) opt.selected = true;
        }
        folderSelect.addEventListener("change", async () => {
          const previous = this.vaultConfig.localVaultRoot;
          const previousPin = this.vaultConfig.userPinnedLocalRoot;
          this.vaultConfig.localVaultRoot = folderSelect.value;
          this.vaultConfig.userPinnedLocalRoot = true;
          folderSelect.disabled = true;
          try {
            await this.persist();
            this.updateStatusBar();
          } catch {
            this.vaultConfig.localVaultRoot = previous;
            this.vaultConfig.userPinnedLocalRoot = previousPin;
            folderSelect.value = previous;
            new Notice("Не вдалося зберегти локальну папку. Спробуйте ще раз.");
          } finally { folderSelect.disabled = false; }
        });
      }
    }

    // 5. Anchored Bottom Google Drive Sync Dock + Structure Anti-Rollback + Hotkeys
    const structSummaryFoot = hasToken ? (this.pendingStructureSummary?.() || { hasChanges: false, total: 0, lines: [], signature: "" }) : { hasChanges: false, total: 0, lines: [], signature: "" };
    const dirtyCountFoot = this.dirtyDriveFiles?.size || 0;
    const pendingDelFoot = this.pendingDriveDeletes?.length || 0;
    const bulkTrashBlockedFoot = (this.syncActivity || []).filter(e => e?.reason === "bulk_trash_confirm");
    const footKey = host ? JSON.stringify([
      Boolean(opts.isDock),
      hasToken,
      this.accountVerified,
      this.accountIsAdmax,
      Boolean(this.vaultConfig?.pairedCanEdit),
      Boolean(this.driveDownloading),
      Boolean(this.previewingDrive),
      Boolean(this.reviewSyncBusy),
      Boolean(this.publishingDrive),
      Boolean(this.updatingPlugin),
      Boolean(this.updater?.blocked?.()),
      this.driveDownloading ? null : this.driveDownloadStatus || "",
      this.driveDownloading ? null : (this.recentSyncedEntries || []).map(r => r.path + ":" + r.status),
      this.drivePreview ? `${this.drivePreview.available}:${this.drivePreview.matches}:${this.drivePreview.desync?.totalIssues ?? 0}:${Boolean(this.drivePreview.desync?.legacyPlatformFolder)}` : "",
      this.drivePreview?.source?.name || "",
      this.drivePreview?.source?.localRoot ?? this.vaultConfig?.localVaultRoot,
      !this.driveDownloading && this.syncTotals?.drive ? JSON.stringify(this.syncTotals.drive) : "",
      this.driveDownloading ? null : this.driveFilesCount?.() || 0,
      this.driveLastSummary?.at || "",
      this.pendingPublish?.file?.path || "",
      file?.path || "",
      structSummaryFoot.signature || "",
      dirtyCountFoot,
      pendingDelFoot,
      bulkTrashBlockedFoot.length,
    ]) : null;
    if (!host || host.footKey !== footKey) {
      if (host) {
        footSlot.empty?.();
        host.footKey = footKey;
      }

      if (hasToken && this.pendingPublish && this.pendingPublish.file === file) {
        const action = footSlot.createDiv({ cls: "fc-publish-bar" });
        action.createSpan({ text: this.publishingDrive ? "Збереження…" : "Є локальні зміни", attr: { role: "status" } });
        const publish = action.createEl("button", {
          cls: "mod-cta fc-deck-btn", text: this.pendingPublish?.baseline?.kind === "platform" ? "Відправити на сайт" : "Опублікувати зміни", attr: { type: "button" },
        });
        publish.disabled = Boolean(this.publishingDrive || this.driveDownloading || this.reviewSyncBusy || this.updater?.blocked());
        publish.addEventListener("click", () => void this.publishActiveChanges());
      }

      if (hasToken && structSummaryFoot.hasChanges && (this.vaultConfig?.pairedCanEdit || this.accountIsAdmax)) {
        const structBanner = footSlot.createEl("details", {
          cls: "fc-structure-banner fc-dock-disclosure",
          attr: { "data-fc-structure-banner": "", ...(host?.structureExpanded ? { open: "" } : {}) },
        });
        structBanner.createEl("summary", {
          cls: "fc-dock-details-summary",
          text: `Зміни папок · ${structSummaryFoot.total}`,
        });
        structBanner.addEventListener("toggle", () => {
          if (host) host.structureExpanded = structBanner.open;
        });
        structBanner.createEl("p", {
          cls: "fc-sync-note",
          text: "Перейменування збережено локально. Перегляньте зміни перед відправкою на Google Drive.",
        });
        if (structSummaryFoot.lines.length) {
          const sList = structBanner.createEl("ul", { cls: "fc-structure-banner-list" });
          for (const line of structSummaryFoot.lines.slice(0, 4)) {
            sList.createEl("li", { text: `${line.badge}: ${line.text}` });
          }
          if (structSummaryFoot.lines.length > 4) {
            sList.createEl("li", { text: `…та ще ${structSummaryFoot.lines.length - 4} змін` });
          }
        }
        const structActions = structBanner.createDiv({ cls: "fc-deck-grid" });
        const pushStructBtn = structActions.createEl("button", {
          cls: "mod-cta fc-deck-btn",
          text: this.driveDownloading ? "⏳ Заливаємо…" : "⬆️ Залити структуру на Drive",
          attr: { type: "button", "data-fc-structure-push": "" },
        });
        pushStructBtn.disabled = Boolean(this.driveDownloading || this.publishingDrive);
        pushStructBtn.addEventListener("click", () => void this.pushStructureChangesToDrive());

        const inspectStructBtn = structActions.createEl("button", {
          cls: "fc-deck-btn",
          text: "👁 Переглянути",
          attr: { type: "button", "data-fc-structure-inspect": "" },
        });
        inspectStructBtn.addEventListener("click", () => this.openStructureSyncModal(this.pendingStructureSummary()));

        const revertStructBtn = structActions.createEl("button", {
          cls: "fc-deck-btn",
          text: "↩️ Відкотити",
          attr: { type: "button", "data-fc-structure-revert": "" },
        });
        revertStructBtn.disabled = Boolean(this.driveDownloading || this.publishingDrive);
        revertStructBtn.addEventListener("click", () => {
          this.dialogForm({
            title: "Відкотити локальні зміни структури папок?",
            description: "Локально перейменовані або переміщені папки й файли повернуться до розташування як на головному Google Drive.",
            button: "Відкотити до версії Drive",
            submit: async () => { await this.revertStructureChangesToDrive(); },
          });
        });
      }

      if (hasToken) {
        const desync = this.drivePreview?.desync;
        const desyncCount = desync?.totalIssues || 0;
        const trackedTotal = this.driveFilesCount?.() || 0;
        const needsInitialImport = Boolean(this.drivePreview?.available > 0 && !this.drivePreview.matches);
        const hasDesync = Boolean(desync?.hasDesync || needsInitialImport);
        const showSyncProgress = Boolean(this.driveDownloading && (!this._quietSync || (this.importProgress?.total || 0) > 0));
        const pendingPushCount = dirtyCountFoot + (this.syncTotals?.drive?.dirty || 0) + (structSummaryFoot.total || 0) + pendingDelFoot;
        const idleTime = this.driveLastSummary?.at
          ? new Date(this.driveLastSummary.at).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })
          : "";
        const syncBanner = footSlot.createDiv({
          cls: "fc-deck-card fc-sync-banner fc-sync-dock" + (hasDesync ? " is-desync" : this.drivePreview ? " is-ok" : ""),
          attr: { "data-fc-sync-dock": "bottom" },
        });
        const syncHead = syncBanner.createDiv({ cls: "fc-deck-header" });
        syncHead.createEl("h4", {
          cls: "fc-deck-title",
          text: showSyncProgress
            ? "⏳ Синхронізація Drive…"
            : needsInitialImport
              ? `📥 Копія Vault (${this.drivePreview.available} файлів)`
              : hasDesync
                ? `⚠️ Виявлено розсинхрон (${desyncCount})`
                : this.drivePreview
                  ? `🟢 Drive · ${trackedTotal || this.drivePreview.available} файлів${idleTime ? ` · ${idleTime}` : ""}`
                  : "🗂️ Синхронізація Google Drive",
        });
        if (!showSyncProgress && this.drivePreview?.source?.name) {
          const source = this.drivePreview.source;
          syncBanner.createEl("p", {
            cls: "fc-sync-note fc-sync-checkpoint-line",
            text: `Google Drive «${source.name}» → ${source.localRoot ? `«${source.localRoot}» у цьому Vault` : "корінь цього Vault"}`,
          });
        }
        const conflictIssueCount = (this.syncTotals?.drive?.conflicts || 0) + (this.syncTotals?.drive?.archivedConflicts || 0) + (this.syncTotals?.drive?.archivedRemoteDelete || 0);
        if (!showSyncProgress && (conflictIssueCount > 0 || pendingPushCount > 0)) {
          const attentionBar = syncBanner.createDiv({ cls: "fc-sync-attention-bar", attr: { "data-fc-sync-attention": "" } });
          if (conflictIssueCount > 0) {
            const confBtn = attentionBar.createEl("button", {
              cls: "fc-sync-attention-btn is-conflict",
              text: `⚠️ Конфлікти / архів · ${conflictIssueCount}`,
              attr: { type: "button", title: "Відкрити зміни та конфлікти (До / Після)" },
            });
            confBtn.addEventListener("click", () => this.openSyncResults("drive", "conflict"));
          }
          if (pendingPushCount > 0) {
            const dirtyBtn = attentionBar.createEl("button", {
              cls: "fc-sync-attention-btn is-dirty",
              text: `✏️ Локальні зміни · ${pendingPushCount}`,
              attr: { type: "button", title: "Переглянути локальні правки перед синхронізацією" },
            });
            dirtyBtn.addEventListener("click", () => this.openSyncResults("drive", dirtyCountFoot || this.syncTotals?.drive?.dirty ? "dirty" : "changed"));
          }
        }
        if (!showSyncProgress && (bulkTrashBlockedFoot.length > 0 || pendingDelFoot > 10) && (this.vaultConfig?.pairedCanEdit || this.accountIsAdmax)) {
          const delCount = Math.max(pendingDelFoot, bulkTrashBlockedFoot.length);
          const bulkBanner = syncBanner.createDiv({ cls: "fc-bulk-trash-banner", attr: { "data-fc-bulk-trash-banner": "" } });
          bulkBanner.createEl("div", {
            cls: "fc-bulk-trash-title",
            text: `⚠️ Видалено локально ${delCount} файлів (понад 10)`,
          });
          bulkBanner.createEl("p", {
            cls: "fc-bulk-trash-desc",
            text: "Щоб випадково не очистити Google Drive, масове видалення зупинено. Підтвердіть перенесення в кошик Drive або відновіть файли з Drive.",
          });
          const sampleNames = [
            ...bulkTrashBlockedFoot.map(e => String(e.path || "").split("/").at(-1) || e.path),
            ...(this.pendingDriveDeletes || []).map(d => String(d.path || "").split("/").at(-1) || d.path),
          ].filter(Boolean);
          const uniqueSampleNames = [...new Set(sampleNames)];
          if (uniqueSampleNames.length) {
            const shown = uniqueSampleNames.slice(0, 4).join(", ");
            const rest = delCount - Math.min(4, uniqueSampleNames.length);
            bulkBanner.createEl("div", {
              cls: "fc-bulk-trash-files",
              text: rest > 0 ? `${shown} + ще ${rest}` : shown,
            });
          }
          const bulkActions = bulkBanner.createDiv({ cls: "fc-bulk-trash-actions" });
          const confirmTrashBtn = bulkActions.createEl("button", {
            cls: "fc-deck-btn mod-warning",
            text: `🗑️ Підтвердити видалення (${delCount}) в Drive`,
            attr: { type: "button", "data-fc-confirm-bulk-trash": "" },
          });
          confirmTrashBtn.disabled = Boolean(this.driveDownloading || this.reviewSyncBusy || this.updatingPlugin || this.updater?.blocked());
          confirmTrashBtn.addEventListener("click", () => void this.startVaultDownload(undefined, { pushLocal: true, structureMode: "push", confirmBulkTrash: true, showResults: true }));
          const restoreTrashBtn = bulkActions.createEl("button", {
            cls: "fc-deck-btn",
            text: "⬇️ Відновити файли з Drive",
            attr: { type: "button", "data-fc-restore-bulk-trash": "" },
          });
          restoreTrashBtn.disabled = Boolean(this.driveDownloading || this.reviewSyncBusy || this.updatingPlugin || this.updater?.blocked());
          restoreTrashBtn.addEventListener("click", () => void this.startVaultDownload(undefined, { pushLocal: false, showResults: true }));
        }

        if (showSyncProgress) {
          syncBanner.createEl("p", {
            cls: "fc-sync-status",
            text: this.driveDownloadStatus || "Перевіряємо зміни Google Drive…",
            attr: { role: "status", "data-fc-download-status": "" },
          });
          const activeSyncBtn = syncBanner.createEl("button", {
            cls: "fc-active-sync-link",
            attr: {
              type: "button",
              "data-fc-active-sync-link": "",
              ...(this.activeSyncPath ? { "data-path": this.activeSyncPath, title: `Відкрити в Obsidian: ${this.activeSyncPath}` } : {}),
            },
          });
          activeSyncBtn.hidden = !this.activeSyncPath;
          activeSyncBtn.createSpan({ text: "⟳ Зараз: ", cls: "fc-active-sync-prefix" });
          activeSyncBtn.createSpan({
            text: this.activeSyncPath ? (this.activeSyncPath.split("/").at(-1) || this.activeSyncPath) : "",
            cls: "fc-active-sync-name",
            attr: { "data-fc-active-sync-name": "" },
          });
          activeSyncBtn.createSpan({ text: " ↗", cls: "fc-active-sync-arrow" });
          activeSyncBtn.addEventListener("click", () => {
            const p = activeSyncBtn.getAttribute("data-path") || this.activeSyncPath;
            if (p) this.openAndRevealFile(p);
          });

          const topProgress = syncBanner.createEl("progress", { cls: "fc-import-progress", attr: { "data-fc-import-progress": "" } });
          if (this.importProgress?.total > 0) {
            topProgress.max = this.importProgress.total;
            topProgress.value = this.importProgress.current;
          }
        }
        const initialPullRow = needsInitialImport
          ? syncBanner.createDiv({ cls: "fc-sync-direction-grid" })
          : null;
        const syncDetails = syncBanner.createEl("details", {
          cls: "fc-dock-disclosure fc-sync-details",
          attr: { ...(host?.syncExpanded ? { open: "" } : {}) },
        });
        syncDetails.createEl("summary", { cls: "fc-dock-details-summary", text: "Керування синхронізацією" });
        syncDetails.addEventListener("toggle", () => {
          if (host) host.syncExpanded = syncDetails.open;
        });
        if (desync && desyncCount > 0) {
          const details = [];
          const driveChanges = (desync.driveMissing || 0) + (desync.driveOutdated || 0) + (desync.driveRenamed || 0) + (desync.driveUntracked || 0);
          const platChanges = (desync.platformOutdatedFiles ?? Math.max(desync.platformLegacyNames || 0, desync.platformLegacySchema || 0, desync.platformUnboundOrOld || 0)) + (desync.platformMissing || 0);
          const pageChanges = (desync.pagesOutdated || 0) + (desync.pagesMissing || 0);
          if (driveChanges > 0) details.push(`Файли Drive: ${driveChanges} оновлень`);
          if (platChanges > 0) details.push(`Об’єкти платформи: ${platChanges} оновлень`);
          if (pageChanges > 0) details.push(`Сторінки /m/: ${pageChanges} оновлень`);
          if (desync.legacyPlatformFolder) details.push("Знайдено стару папку FlightClub (Майно/Події)");
          if (details.length) {
            const list = syncDetails.createEl("ul", { cls: "fc-sync-desync-list" });
            for (const item of details) list.createEl("li", { text: item });
          }
        } else if (!showSyncProgress && this.driveDownloadStatus && (hasDesync || !this.driveLastSummary?.at)) {
          syncBanner.createEl("p", {
            cls: "fc-sync-status",
            text: this.driveDownloadStatus,
            attr: { role: "status", "data-fc-download-status": "" },
          });
        }

        const primaryRow = syncDetails.createDiv({ cls: "fc-sync-direction-grid" });
        const pullBtn = (initialPullRow ?? primaryRow).createEl("button", {
          cls: (hasDesync ? "mod-cta " : "") + "fc-deck-btn fc-btn-pull-drive",
          text: this.driveDownloading
            ? "⏳ Оновлення…"
            : needsInitialImport
              ? "Імпортувати з Drive"
              : hasDesync
                ? "Оновити з Drive зараз"
                : "⬇️ Оновити з Drive",
          attr: {
            type: "button",
            title: "Завантажити нові й оновлені файли з Google Drive у ваш локальний Vault (не перезаписує Drive)",
            "data-fc-sync-pull": "",
          },
        });
        pullBtn.disabled = !hasToken || Boolean(this.driveDownloading || this.reviewSyncBusy || this.updatingPlugin || this.updater?.blocked());
        pullBtn.addEventListener("click", () => void this.startVaultDownload(undefined, { pushLocal: false, showResults: true }));

        if (this.vaultConfig?.pairedCanEdit || this.accountIsAdmax) {
          const pushBtn = primaryRow.createEl("button", {
            cls: (pendingPushCount > 0 ? "mod-cta " : "") + "fc-deck-btn fc-btn-push-drive",
            text: this.driveDownloading
              ? "⏳ Відправка…"
              : pendingPushCount > 0
                ? `⬆️ Залити в Drive (${pendingPushCount})`
                : "⬆️ Залити в Drive",
            attr: {
              type: "button",
              title: "Відправити локальні правки та перейменування папок на головний Google Drive",
              "data-fc-sync-push": "",
            },
          });
          pushBtn.disabled = !hasToken || Boolean(this.driveDownloading || this.reviewSyncBusy || this.updatingPlugin || this.updater?.blocked());
          pushBtn.addEventListener("click", () => void this.startVaultDownload(undefined, { pushLocal: true, structureMode: "push", showResults: true }));
        }

        const utilRow = syncDetails.createDiv({ cls: "fc-deck-grid fc-sync-util-row" });
        if (this.driveDownloading) {
          const stopBtn = syncHead.createEl("button", {
            cls: "fc-deck-btn fc-sync-pause",
            text: "⏸ Пауза",
            attr: { type: "button", title: "Призупинити поточну синхронізацію" },
          });
          stopBtn.addEventListener("click", () => {
            this.cancelDriveDownload = true;
            this.driveResyncQueued = false;
            this.driveDownloadStatus = "Синхронізацію призупинено.";
            this.refreshDockViews();
          });
        }
        const checkBtn = utilRow.createEl("button", {
          cls: "fc-deck-btn",
          text: this.previewingDrive ? "Перевірка…" : "🔎 Звірити",
          attr: { type: "button", title: "Швидко звірити стан локальних файлів із Google Drive" },
        });
        checkBtn.disabled = !hasToken || Boolean(this.driveDownloading || this.previewingDrive);
        checkBtn.addEventListener("click", () => void this.prepareVaultImport({ allowAutomatic: false }));

        if (this.vaultConfig?.pairedCanEdit || this.accountIsAdmax) {
          const folderBtn = utilRow.createEl("button", {
            cls: "fc-deck-btn",
            text: "📁 Перейменувати папку",
            attr: { type: "button", title: "Перейменувати папку або замінити порожню папку на головному Google Drive", "data-fc-rename-folder": "" },
          });
          folderBtn.disabled = Boolean(this.driveDownloading || this.publishingDrive);
          folderBtn.addEventListener("click", () => this.openFolderRenameModal());
        }

        if (!this.driveDownloading && Array.isArray(this.recentSyncedEntries) && this.recentSyncedEntries.length > 0) {
          const feed = syncDetails.createDiv({ cls: "fc-sync-recent-feed" });
          feed.createSpan({ text: "Останні зміни:", cls: "fc-sync-recent-label" });
          const feedList = feed.createDiv({ cls: "fc-sync-recent-chips" });
          for (const rec of this.recentSyncedEntries.slice(0, 4)) {
            const icon = rec.status === "uploaded" || rec.status === "created_remote" ? "⬆️"
              : rec.status === "archived_conflict" ? "📦" : "⬇️";
            const chip = feedList.createEl("button", {
              cls: "fc-sync-recent-chip",
              text: `${icon} ${rec.path.split("/").at(-1) || rec.path}`,
              attr: { type: "button", title: `Відкрити в Obsidian: ${rec.path}` },
            });
            chip.addEventListener("click", () => this.openAndRevealFile(rec.path));
          }
        }

        if (!this.driveDownloading && this.syncTotals?.drive) this.renderSyncMetrics(syncDetails);
      }

      const hkDetails = footSlot.createEl("details", {
        cls: "fc-deck-card fc-hotkey-card",
        attr: opts.isDock ? {} : { open: "open" },
      });
      const hkSum = hkDetails.createEl("summary", {
        cls: "fc-deck-header",
        attr: { style: "cursor:pointer" },
      });
      hkSum.createSpan({ text: "⌨️ Швидкі клавіші FlightClub (Hotkeys)", cls: "fc-deck-title" });
      hkSum.createSpan({ text: "Призначено автоматично", cls: "fc-deck-badge fc-deck-badge-ok" });

      const hkTable = hkDetails.createDiv({ cls: "fc-hotkey-table" });
      const shortcuts = [
        ["💎 Відкрити панель FlightClub Hub", "Alt + Shift + F"],
        ["🔄 Синхронізувати Google Drive зараз", "Alt + Shift + G"],
        ["✏️ Редагувати поточну нотатку на сайті", "Alt + Shift + O"],
        ["🚀 Підключити акаунт FlightClub", "Alt + Shift + P"],
        ["💾 Зберегти нотатку на сайт /m/", "Alt + Shift + S"],
        ["⚡ Увімкнути / пауза Live Edit", "Alt + Shift + L"],
        ["🔗 Вставити згадку сайту", "Alt + Shift + M"],
        ["📥 Завантажити сторінки /m/ у Vault", "Alt + Shift + D"],
      ];
      for (const [label, combo] of shortcuts) {
        const r = hkTable.createDiv({ cls: "fc-hotkey-row" });
        r.createSpan({ text: label });
        r.createEl("kbd", { text: combo, cls: "fc-hotkey-kbd" });
      }
    }
    if (host && savedScroll > 0 && typeof container.scrollTop === "number") {
      container.scrollTop = savedScroll;
    }
  }

  promptManualTokenPaste() {
    this.dialogForm({
      title: "Підключення за кодом",
      description: "Скопіюйте код у розділі підключення Obsidian на сайті FlightClub.",
      field: { label: "Код FlightClub", value: "", max: "80", secret: true },
      button: "Підключити",
      submit: async (value) => {
        if (this.pairSaving) throw new Error("Зачекайте завершення збереження підключення.");
        const verified = await this.verifyDeviceTokenOnServer(value);
        if (!verified.ok) throw new Error("Код недійсний або ваш акаунт не має прав редагування.");
        this.pendingPair = null;
        if (this.pairTimer) clearTimeout(this.pairTimer);
        await this.acceptDevice(value, verified.viewer);
      },
    });
  }

  updateStatusBar() {
    if (!this.statusBarEl) return;
    if(!this.statusIconEl||!this.statusBarEl.contains(this.statusIconEl)){
      this.statusBarEl.empty();
      this.statusIconEl=this.statusBarEl.createSpan({cls:'fc-statusbar-brand',attr:{'aria-hidden':'true'}});
      obsidian.setIcon?.(this.statusIconEl,BRAND_ICON);
      this.statusTextEl=this.statusBarEl.createSpan({cls:'fc-statusbar-label'});
    }
    this.statusBarEl.classList.toggle('is-syncing',Boolean(this.driveDownloading||this.publishingDrive||this.treeSyncBusy));
    const file = this.activeNote();
    const link = file ? this.linkFor(file) : null;
    const driveBase = file ? this.driveBaselineFor(file) : null;
    const driveId = file ? this.resolveDriveIdForFile(file) : null;
    const trackedCount = this.driveFilesCount();
    const structSummary = this.pendingStructureSummary?.();
    if (this.driveDownloading) {
      this.statusTextEl.setText(`FC · Синхронізація Drive…`);
      this.statusBarEl.setAttr("title", "Йде двостороння синхронізація з Google Drive");
    } else if (structSummary?.hasChanges && this.vaultConfig?.pairedCanEdit) {
      this.statusTextEl.setText(`FC · 📁 Зміни папок (${structSummary.total})`);
      this.statusBarEl.setAttr("title", `FlightClub: ${structSummary.total} локальних змін структури папок очікують заливки на головний Google Drive (натисніть для відкриття панелі)`);
    } else if (driveId) {
      const peerCount = this.livePeers.length;
      const peerSuffix = peerCount > 0 ? ` · 👥 ${peerCount + 1}` : "";
      const liveIcon = this.liveConnected && this.vaultConfig.liveEnabled ? "🟢" : "✓";
      this.statusTextEl.setText(`FC · Docs ${liveIcon} (${trackedCount})${peerSuffix}`);
      this.statusBarEl.setAttr("title", `FlightClub Docs: ${SITE}/markdown?view=vault&file=${encodeURIComponent(driveId)}&edit=1`);
    } else if (link) {
      const peerCount = this.livePeers.length;
      const peerSuffix = peerCount > 0 ? ` · 👥 ${peerCount + 1}` : "";
      const liveIcon = this.vaultConfig.liveEnabled ? "🟢" : "🟡";
      this.statusTextEl.setText(`FC ${liveIcon} /m/${link.slug}${peerSuffix}`);
      this.statusBarEl.setAttr("title", `FlightClub Live: ${pageUrl(link.slug)}?edit=1 (клік — панель)`);
    } else if (file && this.sharedNotePath(file)) {
      const fileId = this.sharedWebNote?.path === this.sharedNotePath(file) ? this.sharedWebNote?.fileId : null;
      const peerCount = fileId ? (this.sharedPeers || []).filter(p => p.fileId === fileId).length : 0;
      const peerSuffix = peerCount > 0 ? ` · 👥 ${peerCount + 1}` : "";
      this.statusTextEl.setText(`FC · Shared${peerSuffix}`);
      this.statusBarEl.setAttr("title", "FlightClub Опублікований вольт · Відкрити панель (Alt+Shift+F)");
    } else {
      const rootLabel = trackedCount ? `Drive (${trackedCount})` : (this.drivePreview?.source?.name || "Vault");
      const desyncCount = this.drivePreview?.desync?.totalIssues || 0;
      const desyncSuffix = desyncCount > 0 ? ` · ⚠️ ${desyncCount}` : "";
      this.statusTextEl.setText(`FC · ${rootLabel + desyncSuffix}`);
      this.statusBarEl.setAttr("title", (this.vaultConfig?.deviceToken?'FlightClub · '+(this.vaultConfig.pairedRole||'роль перевіряється'):'Підключити акаунт FlightClub')+' · Відкрити панель (Alt+Shift+F)');
    }
  }

  driveBaselineFor(file) {
    if (!file || isSyncArchivePath(file.path)) return null;
    const row = this.driveFiles?.get(file.path);
    if (!row || row.kind === "platform") return null;
    if (this.vaultConfig?.pairedUserId && row.userId && row.userId !== this.vaultConfig.pairedUserId) return null;
    return row;
  }

  resolveDriveIdForFile(file) {
    if (!file || isSyncArchivePath(file.path)) return null;
    const base = this.driveBaselineFor(file);
    if (base?.fileId && DRIVE_ID.test(base.fileId)) return base.fileId;
    const meta = this.app?.metadataCache?.getFileCache?.(file)?.frontmatter;
    if (typeof FC_YAML_PROPS !== "undefined") {
      const fromMeta = FC_YAML_PROPS.extractDriveIdFromMeta(meta);
      if (fromMeta) return fromMeta;
    }
    const link = file.extension ? this.links?.get(file.path) : null;
    if (link?.slug && Array.isArray(this.remoteCatalog)) {
      const cat = this.remoteCatalog.find(p => p?.slug === link.slug);
      if (cat?.drive_file_id && DRIVE_ID.test(cat.drive_file_id)) return cat.drive_file_id;
    }
    return null;
  }

  catalogPageForFile(file, driveId) {
    if (!file || !Array.isArray(this.remoteCatalog)) return null;
    const link = this.linkFor(file);
    if (link?.slug) {
      const bySlug = this.remoteCatalog.find(p => p?.slug === link.slug);
      if (bySlug) return bySlug;
    }
    if (driveId) {
      const byId = this.remoteCatalog.find(p => p?.drive_file_id === driveId);
      if (byId) return byId;
    }
    const clean = String(file.path || "").replace(/^\/+/, "").toLowerCase();
    const stripped = clean.includes("/") ? clean.split("/").slice(1).join("/") : clean;
    return this.remoteCatalog.find(p => {
      if (!p?.obsidian_path) return false;
      const pn = String(p.obsidian_path).replace(/^\/+/, "").toLowerCase();
      const ps = pn.includes("/") ? pn.split("/").slice(1).join("/") : pn;
      return pn === clean || ps === clean || pn === stripped || ps === stripped;
    }) || null;
  }

  shareMetaForSync(localPath, fileId) {
    if (!localPath || !Array.isArray(this.remoteCatalog)) return null;
    const link = this.links?.get(localPath);
    let page = fileId ? this.remoteCatalog.find(p => p?.drive_file_id === fileId) : null;
    if (!page && link?.slug) page = this.remoteCatalog.find(p => p?.slug === link.slug);
    if (!page) {
      const clean = String(localPath).replace(/^\/+/, "").toLowerCase();
      const stripped = clean.includes("/") ? clean.split("/").slice(1).join("/") : clean;
      page = this.remoteCatalog.find(p => {
        if (!p?.obsidian_path) return false;
        const pn = String(p.obsidian_path).replace(/^\/+/, "").toLowerCase();
        const ps = pn.includes("/") ? pn.split("/").slice(1).join("/") : pn;
        return pn === clean || ps === clean || pn === stripped || ps === stripped;
      });
    }
    if (!page || !SLUG.test(String(page.slug || ""))) return null;
    return {
      shareUrl: pageUrl(page.slug),
      roles: Array.isArray(page.target_roles) ? page.target_roles : [],
      isPublic: Boolean(page.is_public),
    };
  }

  upsertRemoteCatalogPage(saved) {
    if (!saved?.slug) return;
    this.remoteCatalog ??= [];
    const idx = this.remoteCatalog.findIndex(p => p?.slug === saved.slug);
    if (idx >= 0) this.remoteCatalog[idx] = saved;
    else this.remoteCatalog.unshift(saved);
  }

  async syncCadetProfilesFromSheet(statusEl = null) {
    if (!this.alive || this.cadetSyncBusy || !this.vaultConfig?.deviceToken) return null;
    this.cadetSyncBusy = true;
    if (statusEl) statusEl.setText("Звіряємо відповіді анкети курсантів із Google Drive…");
    this.refreshDockViews();
    try {
      const response = await this.siteRequest({
        url: `${SITE}/m/obsidian-sync?obsidian=cadet-profiles-sync-v1`,
        method: "POST",
        headers: { ...this.authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({}),
        throw: false,
      });
      if (!this.alive) return null;
      const body = response?.json;
      if (response?.status !== 200 || body?.ok !== true) {
        const msg = body?.error || "Не вдалося синхронізувати профілі курсантів із Google Таблиці.";
        if (statusEl) statusEl.setText(msg);
        new Notice(msg);
        return null;
      }
      const createdCount = Array.isArray(body.created) ? body.created.length : 0;
      const matchedCount = Number(body.counts?.matched ?? 0);
      const summary = createdCount > 0
        ? `Створено нових профілів курсантів: ${createdCount} (звірено ${matchedCount}).`
        : `Усі профілі курсантів актуальні (${matchedCount}).`;
      if (statusEl) statusEl.setText(summary);
      new Notice(`👤 ${summary}`);
      if (createdCount > 0 && !this.driveDownloading) {
        await this.startVaultDownload(message => {
          if (statusEl) statusEl.setText(message);
        }, { pushLocal: this.driveFilesCount() > 0 });
      }
      return body;
    } catch {
      const msg = "Помилка з’єднання під час синхронізації профілів курсантів.";
      if (statusEl) statusEl.setText(msg);
      new Notice(msg);
      return null;
    } finally {
      this.cadetSyncBusy = false;
      this.refreshDockViews();
    }
  }

  async ensureNoteYamlProperties(file, patch, removeKeys = []) {
    if (!file || this.platformNote(file) || !/\.(?:md|markdown)$/i.test(file.path || "")) return false;
    if (typeof FC_YAML_PROPS === "undefined" || typeof this.app?.vault?.read !== "function") return false;
    const current = await this.app.vault.read(file);
    const unescapeBodyCallouts = !/(?:^|\/)05 sop\/(?!SOP ДЛЯ НЕЙРОМЕРЕЖ)/i.test(file.path || "");
    const updated = FC_YAML_PROPS.upsertYamlProperties(current, patch, { removeKeys, parseYaml: obsidian.parseYaml, unescapeBodyCallouts });
    if (updated === current) return false;
    this.markInternalSyncWrite?.(file.path);
    if (typeof this.app.vault.process === "function") {
      await this.app.vault.process(file, () => updated);
    } else if (typeof this.app.vault.modify === "function") {
      await this.app.vault.modify(file, updated);
    }
    return true;
  }

  async copyTextToClipboard(text, noticeText = "Посилання скопійовано") {
    if (!text) return false;
    try {
      await navigator.clipboard.writeText(text);
      new Notice(`${noticeText}: ${text}`);
      return true;
    } catch {
      new Notice("Буфер обміну недоступний. Відкрийте сторінку, щоб скопіювати адресу.");
      return false;
    }
  }

  async loadDriveShareInfo(fileId, filePath) {
    if (!this.vaultConfig?.deviceToken || !DRIVE_ID.test(String(fileId || ""))) throw new Error("Файл не прив’язано до Drive.");
    const params = new URLSearchParams({ obsidian: "share-v1", file: fileId, ...(filePath ? { path: filePath } : {}) });
    const response = await this.siteRequest({
      url: `${SITE}/m/obsidian-sync?${params}`,
      method: "GET",
      headers: this.authHeaders(),
      throw: false,
    });
    if (response.status !== 200 || response.json?.ok !== true) {
      throw new Error(response.json?.error || "Не вдалося прочитати права доступу.");
    }
    this.shareStateCache ??= new Map();
    this.shareStateCache.set(fileId, response.json);
    if (response.json.sharePage) this.upsertRemoteCatalogPage(response.json.sharePage);
    if (Array.isArray(response.json.hubCities)) {
      this.hubCities = normalizeHubCities(response.json.hubCities, { fromServer: true });
    }
    return response.json;
  }

  async saveNoteShareSettings(file, shareDraft) {
    if (!file || this.platformNote(file)) throw new Error("Недоступно для системної нотатки.");
    if (!this.vaultConfig?.deviceToken || !this.vaultConfig?.pairedCanEdit) throw new Error("Потрібен акаунт із правом редагування.");
    const slug = String(shareDraft?.slug || "").trim().toLowerCase();
    if (!SLUG.test(slug)) throw new Error("Код після /m/ має містити 2–64 латинські символи.");
    const driveId = this.resolveDriveIdForFile(file);
    const existingLink = this.linkFor(file);
    const catalogMatch = this.catalogPageForFile(file, driveId);
    const write = (existingLink?.slug === slug || catalogMatch?.slug === slug) ? "update" : "create";
    let expectedUpdatedAt = write === "update" ? (catalogMatch?.updated_at || existingLink?.version || undefined) : undefined;
    if (write === "update" && !expectedUpdatedAt) {
      const lookup = await this.siteRequest({ url: `${pageUrl(slug)}?api=1&document=1`, method: "GET", headers: this.authHeaders(), throw: false });
      expectedUpdatedAt = lookup.json?.page?.updated_at;
    }
    const local = await this.localNote(file);
    const metadata = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    const pagePayload = {
      slug,
      title: String(catalogMatch?.title || metadata.title || file.basename).trim().slice(0, 180),
      summary: String(catalogMatch?.summary || metadata.summary || "").trim().slice(0, 400),
      category: String(catalogMatch?.category || metadata.category || "Obsidian").trim().slice(0, 80) || "Obsidian",
      content: local.body.slice(0, MAX_NOTE),
      obsidian_path: file.path,
      ...(driveId ? { drive_file_id: driveId } : {}),
      is_published: shareDraft.is_published !== false,
      is_public: Boolean(shareDraft.is_public),
      target_roles: Array.isArray(shareDraft.target_roles) ? shareDraft.target_roles : [],
      target_hubs: Array.isArray(shareDraft.target_hubs) ? shareDraft.target_hubs : [],
    };
    const res = await this.sitePost(slug, {
      action: "save", write, expectedUpdatedAt, clientId: this.clientId, source: this.sourceKind, page: pagePayload,
    });
    if (res.status !== 200 || res.json?.ok !== true || !res.json.page) {
      throw new Error(res.json?.error || "Не вдалося зберегти налаштування доступу.");
    }
    const saved = res.json.page;
    await this.rememberBaseline(file, saved, () => this.alive);
    this.upsertRemoteCatalogPage(saved);
    const shareUrl = pageUrl(saved.slug);
    const vaultUrl = driveId ? `${SITE}/markdown?view=vault&file=${encodeURIComponent(driveId)}&edit=1` : `${shareUrl}?edit=1`;
    await this.ensureNoteYamlProperties(file, {
      site_url: vaultUrl,
      ...(driveId ? { drive_url: driveOpenUrlForPath(driveId, file.path) } : {}),
      share_url: shareUrl,
      slug: saved.slug,
      roles: saved.target_roles ?? [],
      public: Boolean(saved.is_public),
    });
    if (this.isPathInDriveRoot(file.path)) this.scheduleDriveSync(file.path);
    await this.persist();
    this.attachLiveSessionToActiveNote(file);
    this.refreshDockViews();
    await this.copyTextToClipboard(driveId ? vaultUrl : shareUrl, "Доступ збережено, лінк скопійовано");
    return { saved, shareUrl, vaultUrl };
  }

  siteEditTarget(file) {
    if (!file) return null;
    const platform = this.platformNote(file);
    if (platform) {
      const url = platform.id ? refUrl(platform.kind + ":" + platform.id) : null;
      return url ? { kind: "platform", url, label: "✏️ Редагувати / відкрити на сайті", sub: LABEL[platform.kind] } : null;
    }
    const driveBase = this.driveBaselineFor(file);
    const driveId = this.resolveDriveIdForFile(file);
    const link = this.linkFor(file);
    if (driveId && DRIVE_ID.test(driveId)) {
      const encodedId = encodeURIComponent(driveId);
      const isMdTarget = /\.(?:md|markdown)$/i.test(file.path || "");
      return {
        kind: "drive",
        url: `${SITE}/markdown?view=vault&file=${encodedId}&edit=1`,
        vaultShareUrl: `${SITE}/markdown?view=vault&file=${encodedId}&edit=1&share=1`,
        driveUrl: driveOpenUrlForPath(driveId, file.path),
        isMdTarget,
        label: "✏️ Редагувати на сайті",
        sub: `Google Drive · ${driveBase?.sourcePath || file.path}`,
        pageUrl: link ? `${pageUrl(link.slug)}?edit=1` : null,
        shareUrl: link ? pageUrl(link.slug) : null,
        slug: link?.slug || null,
      };
    }
    if (link) {
      return {
        kind: "m",
        url: `${pageUrl(link.slug)}?edit=1`,
        label: "✏️ Редагувати на сайті",
        sub: `/m/${link.slug}`,
        shareUrl: pageUrl(link.slug),
        slug: link.slug,
      };
    }
    const sharedPath = this.sharedNotePath(file);
    if (sharedPath) {
      const matchedId = this.sharedWebNote?.path === sharedPath ? this.sharedWebNote.fileId
        : this.staffTreeSyncState?.entries?.[sharedPath]?.id;
      const url = matchedId && UUID.test(matchedId)
        ? `${SITE}/markdown?view=shared&note=${encodeURIComponent(matchedId)}&edit=1`
        : `${SITE}/markdown?view=shared`;
      return { kind: "shared", url, label: "✏️ Редагувати на сайті", sub: "Спільний Vault" };
    }
    return null;
  }

  activeNote() {
    const file = this.app?.workspace?.getActiveFile?.();
    const isFile = value => typeof TFile === "function" ? value instanceof TFile : Boolean(value && typeof value.extension === "string");
    if (isFile(file)) return ["md", "canvas", "base"].includes(file.extension.toLowerCase()) ? file : null;
    const last = this.lastMarkdownFile;
    return isFile(last) && this.noteView(last) ? last : null;
  }

  platformNote(file) {
    if (!file) return null;
    return FC_DRIVE_SYNC.platformBinding(file.path,this.app.metadataCache?.getFileCache(file)?.frontmatter,this.driveFiles?.get(file.path));
  }

  platformPublishBaseline(file,platform) {
    const baseline = platform?.id && this.driveFiles?.get(file.path);
    return baseline?.kind === "platform" && baseline.userId === this.vaultConfig.pairedUserId &&
      baseline.entity === platform.kind && baseline.fileId === platform.id && baseline.canEdit ? baseline : null;
  }

  reviewPlatformNote(file) {
    const platform = this.platformNote(file);
    if (!platform?.id || platform.kind === "user" || !this.accountVerified || !this.vaultConfig.pairedCanEdit) return;
    this.openSyncResults("platform","all",{channel:"platform",entity:platform.kind,fileId:platform.id,
      path:file.path,status:"conflict",reason:"unbound_platform"});
  }

  linkFor(file) {
    if (!file || isSyncArchivePath(file.path) || this.platformNote(file)) return null;
    const saved = this.links.get(file.path);
    const meta = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const url = typeof meta?.share_url === "string"
      ? parseSiteUrl(meta.share_url)
      : typeof meta?.url === "string"
        ? parseSiteUrl(meta.url)
        : null;
    const slugMeta = typeof meta?.slug === "string" && SLUG.test(meta.slug.toLowerCase()) ? meta.slug.toLowerCase() : null;
    const exported = url?.kind === "m"
      ? readLink({ slug: url.id, version: meta.updated_at })
      : slugMeta
        ? readLink({ slug: slugMeta, version: meta?.updated_at })
        : null;
    return saved ?? exported;
  }

  command(id, name, run, enabled = () => true, hotkeys = undefined) {
    const def = {
      id,
      name,
      checkCallback: (checking) => {
        const file = this.activeNote();
        if (!file || !enabled(file)) return false;
        if (!checking) run(file);
        return true;
      },
    };
    if (hotkeys) def.hotkeys = hotkeys;
    this.addCommand(def);
  }

  fillMenu(menu, file) {
    menu.addItem((item) =>
      item.setTitle("💎 Відкрити бічну панель FlightClub Live Hub").setIcon("shield").onClick(() => void this.activateDockView(true)),
    );
    menu.addSeparator();
    const platform = this.platformNote(file);
    if (platform) {
      const target = platform.id ? refUrl(platform.kind + ":" + platform.id) : null;
      if (target) menu.addItem(item => item.setTitle("Відкрити запис FlightClub").setIcon("external-link").onClick(() => this.openSite(target)));
      if (platform.id && platform.kind !== "user" && this.accountVerified && this.vaultConfig.pairedCanEdit) {
        if (this.pendingPublish?.file === file) {
          menu.addItem(item => item.setTitle("Відправити на сайт").setIcon("upload").onClick(() => void this.publishActiveChanges()));
        } else {
          menu.addItem(item => item.setTitle("Звірити із сайтом").setIcon("refresh-cw").onClick(() => this.reviewPlatformNote(file)));
        }
      }
    } else if (file) {
      const link = this.linkFor(file);
      const editTarget = this.siteEditTarget(file);
      if (editTarget) {
        menu.addItem((item) => item.setTitle(editTarget.label).setIcon("pencil").onClick(() => this.openSite(editTarget.url)));
        menu.addItem((item) => item.setTitle("📋 Копіювати лінк сайту").setIcon("copy").onClick(() => void this.copyTextToClipboard(editTarget.url, "Лінк сторінки сайту скопійовано")));
      }
      if (editTarget?.driveUrl) {
        const gTargetLabel = editTarget.isMdTarget ? "Google Docs" : "Google Drive";
        menu.addItem((item) => item.setTitle(`📝 Відкрити в ${gTargetLabel}`).setIcon("external-link").onClick(() => this.openSite(editTarget.driveUrl)));
        menu.addItem((item) => item.setTitle(`🔗 Копіювати лінк ${gTargetLabel}`).setIcon("copy").onClick(() => void this.copyTextToClipboard(editTarget.driveUrl, `Лінк ${gTargetLabel} скопійовано`)));
      }
      if (editTarget?.vaultShareUrl) {
        menu.addItem((item) => item.setTitle("🔐 Ролі та шерінг у Vault").setIcon("shield").onClick(() => this.openSite(editTarget.vaultShareUrl)));
      }
      if (this.vaultConfig?.deviceToken && this.isPathInDriveRoot(file.path)) {
        menu.addItem((item) => item.setTitle("🔄 Синхронізувати з Google Drive").setIcon("refresh-cw").onClick(() => void this.startVaultDownload()));
      }
      if (this.vaultConfig?.deviceToken) {
        menu.addItem((item) =>
          item
            .setTitle(link ? `💾 Зберегти /m/${link.slug} на сайті (1 клік)` : "💾 Опублікувати /m/ на сайті (1 клік)")
            .setIcon("save")
            .onClick(() => void this.directSaveNote(file)),
        );
      }
      menu.addItem((item) =>
        item
          .setTitle("🔗 Вставити згадку сайту (@Людина / Майно / Подія)")
          .setIcon("at-sign")
          .onClick(() => this.openEntityPickerModal(null, file)),
      );
      menu.addItem((item) => item.setTitle("🚀 Створити сторінку /m/").setIcon("file-plus").onClick(() => this.showTransfer(file, "create")));
      if (link?.version) {
        menu.addItem((item) => item.setTitle("🔄 Оновити сторінку /m/").setIcon("upload").onClick(() => this.showTransfer(file, "update")));
      }
      if (link) {
        menu.addItem((item) => item.setTitle("📋 Копіювати посилання /m/").setIcon("copy").onClick(() => this.copyLink(file)));
        menu.addItem((item) => item.setTitle("✏️ Редагувати сторінку /m/ на сайті").setIcon("external-link").onClick(() => this.openSite(`${pageUrl(link.slug)}?edit=1`)));
      } else {
        menu.addItem((item) => item.setTitle("📎 Прив’язати наявне посилання /m/").setIcon("link").onClick(() => this.attachLink(file)));
      }
      menu.addSeparator();
    }
    menu.addItem((item) => item.setTitle("🔄 Синхронізувати індекс /m/ із сайтом").setIcon("refresh-cw").onClick(() => void this.syncIndexFromSite(true)));
    menu.addItem((item) => item.setTitle("📥 Завантажити всі сторінки /m/ у Vault").setIcon("download").onClick(() => void this.pullPagesFromSite()));
  }

  openSite(url, host = window) {
    host.open(url, "_blank", "noopener,noreferrer");
  }

  async copyLink(file) {
    const link = this.linkFor(file);
    if (!link) return;
    try {
      await navigator.clipboard.writeText(pageUrl(link.slug));
      new Notice("Посилання скопійовано: " + pageUrl(link.slug));
    } catch {
      new Notice("Буфер обміну недоступний. Відкрийте сторінку, щоб скопіювати адресу в браузері.");
    }
  }

  pruneDeletedLinks() {
    let changed = false;
    for (const [notePath] of Array.from(this.links.entries())) {
      const f = this.app.vault.getAbstractFileByPath(notePath);
      if (isSyncArchivePath(notePath) || !(f instanceof TFile)) {
        this.links.delete(notePath);
        changed = true;
      }
    }
    return changed;
  }

  async syncIndexFromSite(notify = false) {
    const token = this.vaultConfig.deviceToken;
    const generation = (this.catalogGeneration || 0) + 1;
    this.catalogGeneration = generation;
    try {
      this.pruneDeletedLinks();
      const response = await this.siteRequest({
        url: SITE + "/m/obsidian-sync?obsidian=index-v1",
        method: "GET",
        headers: this.authHeaders(),
        throw: false,
      });
      if (!this.alive || token !== this.vaultConfig.deviceToken || generation !== this.catalogGeneration) return false;
      if (response?.status !== 200 || !response.json?.ok) {
        if (notify) new Notice("Не вдалося завантажити індекс сторінок із сайту.");
        return false;
      }
      const payload = response.json;
      if (payload.restricted === true) {
        this.accountRestricted = true;
        this.remoteCatalog = [];
        if (payload.viewer?.roleLabel) this.vaultConfig.pairedRole = payload.viewer.roleLabel;
        if ("accessTier" in (payload.viewer || {})) this.vaultConfig.pairedAccessTier = payload.viewer.accessTier || null;
        this.refreshDockViews();
        return true;
      }
      this.accountRestricted = false;
      if (payload.viewer) {
        if (payload.viewer.userId) this.vaultConfig.pairedUserId = payload.viewer.userId;
        if (payload.viewer.displayName) this.vaultConfig.pairedUser = payload.viewer.displayName;
        if (payload.viewer.roleLabel) this.vaultConfig.pairedRole = payload.viewer.roleLabel;
        if (payload.viewer.hubCity) this.vaultConfig.pairedHub = payload.viewer.hubCity;
        if ("accessTier" in payload.viewer) this.vaultConfig.pairedAccessTier = payload.viewer.accessTier || null;
      }
      if (typeof payload.localVaultRoot === "string" && !this.vaultConfig.userPinnedLocalRoot) {
        this.vaultConfig.localVaultRoot = payload.localVaultRoot;
      }
      if (Array.isArray(payload.vaultCheckpoints)) {
        this.serverVaultCheckpoints = payload.vaultCheckpoints;
        const existing = Array.isArray(this.vaultConfig.syncCheckpoints) ? [...this.vaultConfig.syncCheckpoints] : [];
        let cpAdded = false;
        for (const sc of payload.vaultCheckpoints) {
          if (!sc || typeof sc.name !== "string" || !sc.name.trim()) continue;
          const cleanName = sc.name.trim().slice(0, 120);
          if (!existing.some(c => c.name === cleanName || (sc.revision && c.revision === sc.revision))) {
            existing.push({
              name: cleanName,
              rootId: null,
              revision: typeof sc.revision === "string" && UUID.test(sc.revision) ? sc.revision : null,
              at: typeof sc.at === "string" ? sc.at.slice(0, 40) : null,
              filesCount: null,
            });
            cpAdded = true;
          }
        }
        if (cpAdded) this.vaultConfig.syncCheckpoints = existing.slice(0, 6);
      }
      if (typeof payload.vaultRootName === "string" && payload.vaultRootName.trim() && !this.vaultConfig.vaultRootName) {
        this.vaultConfig.vaultRootName = payload.vaultRootName.trim().slice(0, 120);
      }
      const pages = Array.isArray(payload.pages) ? payload.pages : [];
      this.remoteCatalog = pages;
      if (Array.isArray(payload.hubCities)) {
        this.hubCities = normalizeHubCities(payload.hubCities, { fromServer: true });
      }
      const mdFiles = this.app.vault.getMarkdownFiles().filter((f) => f?.path && !isSyncArchivePath(f.path));
      const localRoot = (this.vaultConfig.localVaultRoot || "").replace(/^\/+|\/+$/g, "");
      let matchedCount = 0;

      for (const p of pages) {
        if (!p || !SLUG.test(String(p.slug ?? ""))) continue;
        const slug = String(p.slug);
        const siteVersion = typeof p.updated_at === "string" && VERSION.test(p.updated_at) ? p.updated_at : null;
        let targetFile = null;

        for (const [existingPath, existingLink] of this.links.entries()) {
          if (isSyncArchivePath(existingPath)) continue;
          if (existingLink.slug === slug) {
            const f = this.app.vault.getAbstractFileByPath(existingPath);
            if (f instanceof TFile) {
              targetFile = f;
              break;
            }
          }
        }

        if (!targetFile && typeof p.obsidian_path === "string" && p.obsidian_path.trim()) {
          const rawObsPath = p.obsidian_path.trim().replace(/^\/+/, "");
          const candidates = [rawObsPath];
          const stripped = rawObsPath.includes("/") ? rawObsPath.split("/").slice(1).join("/") : rawObsPath;
          if (localRoot) candidates.push(`${localRoot}/${stripped}`);
          candidates.push(stripped);
          for (const cand of candidates) {
            if (isSyncArchivePath(cand)) continue;
            const f = this.app.vault.getAbstractFileByPath(cand);
            if (f instanceof TFile && f.extension.toLowerCase() === "md" && !this.driveFiles?.has(f.path)) {
              const existing = this.linkFor(f);
              if (!existing || existing.slug === slug) { targetFile = f; break; }
            }
          }
        }

        if (!targetFile) {
          for (const f of mdFiles) {
            if (isSyncArchivePath(f.path)) continue;
            const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
            const fmSlug = typeof fm?.slug === "string" ? fm.slug.toLowerCase() : null;
            const fmUrl = typeof fm?.url === "string" ? parseSiteUrl(fm.url) : null;
            if (!this.driveFiles?.has(f.path) && (!this.links.has(f.path) || this.links.get(f.path).slug === slug) &&
                (fmSlug === slug || (fmUrl?.kind === "m" && fmUrl.id === slug))) {
              targetFile = f;
              break;
            }
          }
        }

        if (targetFile && !isSyncArchivePath(targetFile.path)) {
          const prev = this.links.get(targetFile.path);
          if (this.driveFiles?.has(targetFile.path) || (prev && prev.slug !== slug)) continue;
          this.links.set(targetFile.path, {
            slug,
            // Only preserve previously confirmed version; keep siteVersion in observedRemoteRevision
            version: prev?.version ?? null,
            observedRemoteRevision: prev?.observedRemoteRevision > siteVersion ? prev.observedRemoteRevision : siteVersion,
            syncedBodyHash: prev?.syncedBodyHash ?? null,
            conflict: Boolean(prev?.conflict),
            dirtyLocal: Boolean(prev?.dirtyLocal),
          });
          matchedCount++;
        }
      }

      await this.persist();
      this.updateStatusBar();
      this.refreshDockViews();
      if (notify) {
        new Notice(
          `✅ Синхронізовано індекс: знайдено ${pages.length} сторінок, узгоджено ${matchedCount} нотаток у Vault`,
        );
      }
      return true;
    } catch {
      if (notify) new Notice("Помилка з’єднання під час синхронізації індексу.");
      return false;
    }
  }

  async loadTeamPluginsCatalog({ silent = true } = {}) {
    const token = this.vaultConfig?.deviceToken;
    if (!token || !this.accountVerified) return null;
    try {
      const response = await this.timedSiteRequest({
        url: SITE + "/m/obsidian-sync?obsidian=team-plugins-v1",
        method: "GET",
        headers: this.authHeaders(token),
        throw: false,
      }, 15_000);
      if (response?.status === 200 && response.json?.ok === true && Array.isArray(response.json.plugins)) {
        this.teamPluginsCatalog = {
          revision: response.json.revision || null,
          updatedAt: response.json.updatedAt || null,
          updatedBy: response.json.updatedBy || null,
          plugins: response.json.plugins,
        };
        if (this.alive) this.refreshDockViews();
        return this.teamPluginsCatalog;
      }
      if (!silent) throw new Error(response?.json?.error || "Не вдалося завантажити спільні плагіни команди.");
    } catch (error) {
      if (!silent) throw error;
    }
    return null;
  }

  async openAdmaxTeamPluginsModal() {
    if (!this.accountIsAdmax) {
      new Notice("Лише ADMAX може налаштовувати спільний список плагінів команди.");
      return;
    }
    if (!this.vaultConfig?.deviceToken || !this.accountVerified) {
      new Notice("Спочатку підключіть акаунт FlightClub.");
      return;
    }
    if (typeof FC_TEAM_PLUGINS === "undefined") return;

    this.dialog?.close();
    const modal = new Modal(this.app);
    this.dialog = modal;

    modal.onOpen = async () => {
      modal.titleEl.setText("🧩 Плагіни команди (ADMAX)");
      const root = modal.contentEl.createDiv({ cls: "fc-team-plugins-modal", attr: { "data-fc-admax-team-plugins-modal": "" } });
      root.createEl("p", {
        cls: "fc-deck-sub",
        text: "Поставте галочки на плагінах з вашого Obsidian, щоб додати їх до спільного списку. Учасники зможуть встановити їх із Community Plugins та (за потреби) підтягнути безпечні налаштування без токенів.",
      });
      const statusEl = root.createEl("p", { cls: "fc-sync-status", text: "Скануємо встановлені плагіни та каталог Community Plugins…", attr: { role: "status" } });

      const [installed, catalogMap, serverState] = await Promise.all([
        FC_TEAM_PLUGINS.listInstalledPlugins(this.app),
        FC_TEAM_PLUGINS.fetchCommunityPluginsCatalog(requestUrl, this.communityCatalogCache),
        this.loadTeamPluginsCatalog({ silent: true }),
      ]);
      if (!this.alive || this.dialog !== modal) return;

      const serverPlugins = serverState?.plugins || this.teamPluginsCatalog?.plugins || [];
      const installedById = new Map(installed.map((p) => [p.id.toLowerCase(), p]));
      const draft = new Map();
      for (const sp of serverPlugins) {
        const key = String(sp.id || "").toLowerCase();
        const cat = catalogMap.get(key);
        const loc = installedById.get(key);
        draft.set(key, {
          id: sp.id,
          name: loc?.name || sp.name || cat?.name || sp.id,
          author: loc?.author || sp.author || cat?.author || "",
          description: loc?.description || sp.description || cat?.description || "",
          version: loc?.version || sp.version || "",
          repo: cat?.repo || sp.repo || "",
          inCommunityCatalog: Boolean(cat?.repo || sp.inCommunityCatalog || sp.repo),
          isDesktopOnly: Boolean(loc ? loc.isDesktopOnly : sp.isDesktopOnly),
          syncConfig: Boolean(sp.syncConfig),
          dataJson: sp.dataJson,
        });
      }

      const allItems = [...installed];
      for (const sp of serverPlugins) {
        const key = String(sp.id || "").toLowerCase();
        if (!installedById.has(key)) {
          allItems.push({
            id: sp.id,
            name: sp.name || sp.id,
            version: sp.version || "",
            author: sp.author || "",
            description: sp.description || "",
            isDesktopOnly: Boolean(sp.isDesktopOnly),
            enabled: false,
            hasDataJson: Boolean(sp.syncConfig && sp.dataJson !== undefined),
            remoteOnly: true,
          });
        }
      }

      statusEl.setText(`Знайдено плагінів: ${allItems.length}. Оберіть потрібні для команди.`);
      const toolbar = root.createDiv({ cls: "fc-team-plugins-toolbar" });
      const searchInput = toolbar.createEl("input", {
        cls: "fc-team-plugins-search",
        attr: { type: "search", placeholder: "Пошук плагіна за назвою або ID…", "aria-label": "Пошук плагінів" },
      });
      let filterMode = "all";
      const filterBtns = [];
      for (const [fKey, fLabel] of [["all", "Усі"], ["enabled", "Увімкнені"], ["selected", "Обрані"]]) {
        const btn = toolbar.createEl("button", {
          text: fLabel,
          cls: "fc-entity-pill" + (fKey === filterMode ? " is-active" : ""),
          attr: { type: "button" },
        });
        filterBtns.push([fKey, btn]);
        btn.addEventListener("click", () => {
          filterMode = fKey;
          for (const [k, b] of filterBtns) b.classList?.toggle?.("is-active", k === filterMode);
          renderList();
        });
      }

      const listEl = root.createDiv({ cls: "fc-team-plugins-list" });
      const footerActions = root.createDiv({ cls: "fc-conflict-actions" });
      const saveBtn = footerActions.createEl("button", {
        text: `💾 Зберегти спільний список (${draft.size})`,
        cls: "mod-cta fc-deck-btn",
        attr: { type: "button", "data-fc-save-team-plugins": "" },
      });
      const cancelBtn = footerActions.createEl("button", { text: "Скасувати", cls: "fc-deck-btn", attr: { type: "button" } });
      cancelBtn.addEventListener("click", () => modal.close());

      const updateSaveLabel = () => {
        saveBtn.setText(`💾 Зберегти спільний список (${draft.size})`);
      };

      const clearBox = (el) => {
        if (typeof el.empty === "function") el.empty();
        else if (typeof el.replaceChildren === "function") el.replaceChildren();
        else if (Array.isArray(el.children)) el.children.length = 0;
      };

      const renderList = () => {
        clearBox(listEl);
        const q = String(searchInput.value || "").trim().toLowerCase();
        const visible = allItems.filter((item) => {
          const key = item.id.toLowerCase();
          if (filterMode === "enabled" && !item.enabled) return false;
          if (filterMode === "selected" && !draft.has(key)) return false;
          if (q && !item.name.toLowerCase().includes(q) && !item.id.toLowerCase().includes(q) && !(item.author || "").toLowerCase().includes(q)) return false;
          return true;
        });
        if (!visible.length) {
          listEl.createEl("p", { cls: "fc-deck-sub", text: "Плагінів за цим фільтром не знайдено." });
          return;
        }
        for (const item of visible) {
          const key = item.id.toLowerCase();
          const cat = catalogMap.get(key);
          const selected = draft.get(key) || null;
          const row = listEl.createDiv({ cls: "fc-team-plugin-row" + (selected ? " is-selected" : "") });
          const head = row.createDiv({ cls: "fc-team-plugin-head" });
          const label = head.createEl("label", { cls: "fc-team-plugin-check" });
          const cb = label.createEl("input", { attr: { type: "checkbox", "data-fc-team-plugin-toggle": item.id } });
          cb.checked = Boolean(selected);
          label.createSpan({ text: item.name + (item.version ? ` (v${item.version})` : "") });

          const badges = head.createDiv({ cls: "fc-team-plugin-badges" });
          if (cat?.repo || selected?.repo) {
            badges.createSpan({ cls: "fc-deck-badge fc-deck-badge-ok", text: "✅ Community Plugins" });
          } else {
            badges.createSpan({ cls: "fc-deck-badge fc-deck-badge-warn", text: "⚠️ Локальний" });
          }
          badges.createSpan({
            cls: "fc-deck-badge",
            text: item.isDesktopOnly ? "💻 Тільки ПК" : "📱+💻 Моб + ПК",
          });
          if (item.enabled) badges.createSpan({ cls: "fc-deck-badge fc-deck-badge-ok", text: "Увімкнено" });

          if (item.description) {
            row.createEl("p", { cls: "fc-team-plugin-desc", text: item.description });
          }

          let cfgWrap = null;
          const drawConfigCheckbox = () => {
            if (cfgWrap) cfgWrap.remove?.();
            if (!draft.has(key) || !item.hasDataJson) return;
            cfgWrap = row.createEl("label", { cls: "fc-team-plugin-config-opt" });
            const cfgCb = cfgWrap.createEl("input", { attr: { type: "checkbox", "data-fc-team-plugin-config": item.id } });
            cfgCb.checked = Boolean(draft.get(key)?.syncConfig);
            cfgWrap.createSpan({ text: "Передати налаштування (data.json; токени й ключі вирізаються автоматично)" });
            cfgCb.addEventListener("change", () => {
              const entry = draft.get(key);
              if (entry) entry.syncConfig = cfgCb.checked;
            });
          };

          cb.addEventListener("change", () => {
            if (cb.checked) {
              draft.set(key, {
                id: item.id,
                name: item.name || item.id,
                author: item.author || cat?.author || "",
                description: item.description || cat?.description || "",
                version: item.version || "",
                repo: cat?.repo || "",
                inCommunityCatalog: Boolean(cat?.repo),
                isDesktopOnly: Boolean(item.isDesktopOnly),
                syncConfig: false,
                dataJson: undefined,
              });
              row.classList?.add?.("is-selected");
            } else {
              draft.delete(key);
              row.classList?.remove?.("is-selected");
            }
            drawConfigCheckbox();
            updateSaveLabel();
          });
          drawConfigCheckbox();
        }
      };

      searchInput.addEventListener("input", renderList);
      renderList();

      saveBtn.addEventListener("click", async () => {
        saveBtn.disabled = cancelBtn.disabled = true;
        statusEl.setText("Готуємо та зберігаємо спільний список…");
        try {
          const payloadPlugins = [];
          let strippedTotal = 0;
          for (const entry of draft.values()) {
            let cleanConfig = entry.dataJson;
            if (entry.syncConfig && !entry.remoteOnly) {
              const readRes = await FC_TEAM_PLUGINS.readLocalPluginConfig(this.app, entry.id);
              if (readRes) {
                cleanConfig = readRes.cleaned;
                strippedTotal += readRes.strippedKeysCount || 0;
              }
            }
            payloadPlugins.push({
              id: entry.id,
              name: entry.name,
              ...(entry.author ? { author: entry.author } : {}),
              ...(entry.description ? { description: entry.description } : {}),
              ...(entry.version ? { version: entry.version } : {}),
              ...(entry.repo ? { repo: entry.repo } : {}),
              inCommunityCatalog: Boolean(entry.inCommunityCatalog || entry.repo),
              isDesktopOnly: Boolean(entry.isDesktopOnly),
              syncConfig: Boolean(entry.syncConfig && cleanConfig !== undefined),
              ...(entry.syncConfig && cleanConfig !== undefined ? { dataJson: cleanConfig } : {}),
            });
          }
          const res = await this.timedSiteRequest({
            url: SITE + "/m/obsidian-sync?obsidian=team-plugins-v1",
            method: "POST",
            headers: { "Content-Type": "application/json", ...this.authHeaders() },
            body: JSON.stringify({
              expectedRevision: this.teamPluginsCatalog?.revision || null,
              plugins: payloadPlugins,
            }),
            throw: false,
          }, 20_000);
          if (res?.status !== 200 || res.json?.ok !== true) {
            throw new Error(res?.json?.error || "Не вдалося зберегти список плагінів команди.");
          }
          this.teamPluginsCatalog = {
            revision: res.json.revision || null,
            updatedAt: res.json.updatedAt || null,
            updatedBy: res.json.updatedBy || this.vaultConfig?.pairedUser || "ADMAX",
            plugins: res.json.plugins || payloadPlugins,
          };
          this.teamPluginsRefreshTick = (this.teamPluginsRefreshTick || 0) + 1;
          this.refreshDockViews();
          const secNote = strippedTotal > 0 ? ` (приховано ${strippedTotal} секретних полів)` : "";
          new Notice(`✅ Збережено ${payloadPlugins.length} плагінів команди${secNote}.`);
          modal.close();
        } catch (err) {
          statusEl.setText(err instanceof Error ? err.message : "Помилка збереження.");
          saveBtn.disabled = cancelBtn.disabled = false;
        }
      });
    };

    modal.onClose = () => {
      if (this.dialog === modal) this.dialog = null;
      modal.contentEl.empty();
    };
    modal.open();
  }

  async openTeamPluginsInstallerModal() {
    if (!this.vaultConfig?.deviceToken || !this.accountVerified) {
      new Notice("Спочатку підключіть акаунт FlightClub.");
      return;
    }
    if (typeof FC_TEAM_PLUGINS === "undefined") return;

    this.dialog?.close();
    const modal = new Modal(this.app);
    this.dialog = modal;

    modal.onOpen = async () => {
      modal.titleEl.setText("🧩 Плагіни команди · Community Plugins");
      const root = modal.contentEl.createDiv({ cls: "fc-team-plugins-modal", attr: { "data-fc-team-plugins-installer": "" } });
      const statusEl = root.createEl("p", { cls: "fc-sync-status", text: "Завантажуємо спільний список плагінів…", attr: { role: "status" } });
      const topActions = root.createDiv({ cls: "fc-team-plugins-toolbar" });
      const listEl = root.createDiv({ cls: "fc-team-plugins-list" });
      const footerActions = root.createDiv({ cls: "fc-conflict-actions" });
      const refreshBtn = footerActions.createEl("button", { text: "🔄 Оновити статус", cls: "fc-deck-btn", attr: { type: "button" } });
      const closeBtn = footerActions.createEl("button", { text: "Закрити", cls: "fc-deck-btn", attr: { type: "button" } });
      closeBtn.addEventListener("click", () => modal.close());

      const clearBox = (el) => {
        if (typeof el.empty === "function") el.empty();
        else if (typeof el.replaceChildren === "function") el.replaceChildren();
        else if (Array.isArray(el.children)) el.children.length = 0;
      };

      const fetchRepoManifest = async (repo) => {
        for (const branch of ["HEAD", "main", "master"]) {
          try {
            const r = await requestUrl({
              url: `https://raw.githubusercontent.com/${repo}/${branch}/manifest.json`,
              method: "GET",
              throw: false,
            });
            if (r?.status === 200 && r.json?.id && r.json?.version) return r.json;
          } catch {}
        }
        return null;
      };

      const draw = async (forceFetch = false) => {
        if (forceFetch || !this.teamPluginsCatalog?.plugins?.length) {
          await this.loadTeamPluginsCatalog({ silent: true });
        }
        const installed = await FC_TEAM_PLUGINS.listInstalledPlugins(this.app);
        if (!this.alive || this.dialog !== modal) return;
        const catalogPlugins = this.teamPluginsCatalog?.plugins || [];
        const isMobile = Boolean(Platform?.isMobile || Platform?.isMobileApp);
        const state = FC_TEAM_PLUGINS.computeTeamPluginStatus({
          teamPlugins: catalogPlugins,
          installedPlugins: installed,
          isMobile,
        });

        clearBox(topActions);
        clearBox(listEl);

        if (!state.rows.length) {
          statusEl.setText("ADMAX ще не додав жодного плагіна до спільного списку.");
          return;
        }
        statusEl.setText(
          `Всього: ${state.rows.length} · Активних: ${state.installedCount}` +
          (state.missingCount ? ` · Не встановлено: ${state.missingCount}` : "") +
          (state.disabledCount ? ` · Вимкнено: ${state.disabledCount}` : "") +
          (state.desktopOnlyCount ? ` · Лише для ПК: ${state.desktopOnlyCount}` : ""),
        );

        const canDirectInstall = !FC_COMMUNITY_BUILD &&
          typeof fcCanDirectInstallCommunityPlugin === "function" &&
          fcCanDirectInstallCommunityPlugin(this.app) &&
          typeof fcDirectInstallCommunityPlugin === "function";
        const installable = state.rows.filter((r) => r.status === "missing" && r.repo);
        if (canDirectInstall && installable.length > 0) {
          const batchBtn = topActions.createEl("button", {
            text: `⬇️ Автоматично встановити всі з Community Plugins (${installable.length})`,
            cls: "mod-cta fc-deck-btn",
            attr: { type: "button", "data-fc-install-all-team-plugins": "" },
          });
          batchBtn.addEventListener("click", async () => {
            batchBtn.disabled = true;
            let okCount = 0;
            for (const rowItem of installable) {
              statusEl.setText(`Встановлюємо ${rowItem.name}…`);
              try {
                const mf = await fetchRepoManifest(rowItem.repo);
                if (mf && await fcDirectInstallCommunityPlugin(this.app, requestUrl, rowItem, mf)) {
                  okCount++;
                  if (rowItem.syncConfig && rowItem.dataJson !== undefined) {
                    await FC_TEAM_PLUGINS.applySharedPluginConfig(this.app, rowItem.id, rowItem.dataJson).catch(() => {});
                  }
                }
              } catch {}
            }
            this.teamPluginsRefreshTick = (this.teamPluginsRefreshTick || 0) + 1;
            this.refreshDockViews();
            await draw(false);
            new Notice(`✅ Встановлено ${okCount} із ${installable.length} плагінів команди.`);
          });
        }

        for (const item of state.rows) {
          const row = listEl.createDiv({ cls: "fc-team-plugin-row" });
          const head = row.createDiv({ cls: "fc-team-plugin-head" });
          const titleSpan = head.createSpan({ cls: "fc-team-plugin-check", text: item.name + (item.version ? ` (v${item.version})` : "") });
          void titleSpan;

          const badges = head.createDiv({ cls: "fc-team-plugin-badges" });
          const badgeText = item.status === "installed_enabled" ? "✅ Активний"
            : item.status === "installed_disabled" ? "⏸ Вимкнено"
            : item.status === "desktop_only_mobile" ? "💻 Лише для ПК"
            : "⬇️ Не встановлено";
          const badgeCls = item.status === "installed_enabled" ? "fc-deck-badge fc-deck-badge-ok"
            : item.status === "missing" || item.status === "installed_disabled" ? "fc-deck-badge fc-deck-badge-warn"
            : "fc-deck-badge";
          badges.createSpan({ cls: badgeCls, text: badgeText });
          if (item.inCommunityCatalog || item.repo) {
            badges.createSpan({ cls: "fc-deck-badge", text: "Community Plugins" });
          }

          if (item.description) {
            row.createEl("p", { cls: "fc-team-plugin-desc", text: item.description });
          }

          const btns = row.createDiv({ cls: "fc-team-plugin-actions" });
          if (item.status === "missing") {
            const openBtn = btns.createEl("button", {
              text: "🔗 Відкрити в Community Plugins",
              cls: (!canDirectInstall ? "mod-cta " : "") + "fc-deck-btn",
              attr: { type: "button", "data-fc-show-community-plugin": item.id },
            });
            openBtn.addEventListener("click", () => {
              FC_TEAM_PLUGINS.openCommunityPluginPage(item.id, (href) => this.openSite(href));
            });

            if (canDirectInstall && item.repo) {
              const autoBtn = btns.createEl("button", {
                text: "⬇️ Встановити в 1 клік",
                cls: "mod-cta fc-deck-btn",
                attr: { type: "button", "data-fc-install-one-plugin": item.id },
              });
              autoBtn.addEventListener("click", async () => {
                autoBtn.disabled = true;
                statusEl.setText(`Завантажуємо ${item.name} з Community Plugins…`);
                try {
                  const mf = await fetchRepoManifest(item.repo);
                  if (!mf || !(await fcDirectInstallCommunityPlugin(this.app, requestUrl, item, mf))) {
                    throw new Error("Не вдалося встановити автоматично.");
                  }
                  if (item.syncConfig && item.dataJson !== undefined) {
                    await FC_TEAM_PLUGINS.applySharedPluginConfig(this.app, item.id, item.dataJson).catch(() => {});
                  }
                  new Notice(`✅ Плагін ${item.name} встановлено!`);
                  this.teamPluginsRefreshTick = (this.teamPluginsRefreshTick || 0) + 1;
                  this.refreshDockViews();
                  await draw(false);
                } catch {
                  statusEl.setText(`Відкрийте ${item.name} у Community Plugins для ручного встановлення.`);
                  FC_TEAM_PLUGINS.openCommunityPluginPage(item.id, (href) => this.openSite(href));
                  autoBtn.disabled = false;
                }
              });
            }
          } else if (item.status === "installed_disabled") {
            const enableBtn = btns.createEl("button", {
              text: "▶ Увімкнути плагін",
              cls: "mod-cta fc-deck-btn",
              attr: { type: "button", "data-fc-enable-team-plugin": item.id },
            });
            enableBtn.addEventListener("click", async () => {
              enableBtn.disabled = true;
              try {
                if (typeof this.app?.plugins?.enablePluginAndSave === "function") {
                  await this.app.plugins.enablePluginAndSave(item.id);
                } else if (typeof this.app?.plugins?.enablePlugin === "function") {
                  await this.app.plugins.enablePlugin(item.id);
                } else {
                  this.app?.setting?.open?.();
                  this.app?.setting?.openTabById?.("community-plugins");
                }
                this.teamPluginsRefreshTick = (this.teamPluginsRefreshTick || 0) + 1;
                this.refreshDockViews();
                await draw(false);
              } catch {
                enableBtn.disabled = false;
              }
            });
          }

          if ((item.status === "installed_enabled" || item.status === "installed_disabled") && item.syncConfig && item.dataJson !== undefined) {
            const cfgBtn = btns.createEl("button", {
              text: "⚙️ Застосувати спільні налаштування",
              cls: "fc-deck-btn",
              attr: { type: "button", "data-fc-apply-team-plugin-config": item.id },
            });
            cfgBtn.addEventListener("click", async () => {
              cfgBtn.disabled = true;
              try {
                const applied = await FC_TEAM_PLUGINS.applySharedPluginConfig(this.app, item.id, item.dataJson);
                new Notice(applied.backupPath
                  ? `✅ Налаштування ${item.name} оновлено (резерв: ${applied.backupPath.split("/").pop()}).`
                  : `✅ Налаштування ${item.name} застосовано.`);
              } catch (err) {
                new Notice(`⚠️ ${err instanceof Error ? err.message : "Не вдалося записати налаштування."}`);
              } finally {
                cfgBtn.disabled = false;
              }
            });
          }
        }
      };

      refreshBtn.addEventListener("click", () => void draw(true));
      await draw(true);
    };

    modal.onClose = () => {
      if (this.dialog === modal) this.dialog = null;
      modal.contentEl.empty();
    };
    modal.open();
  }

  readPublishCheckboxFlag(file) {
    if (!file || typeof FC_EVENT_PUBLISH === "undefined") return false;
    const fm = this.app?.metadataCache?.getFileCache?.(file)?.frontmatter;
    if (!fm || typeof fm !== "object") return false;
    return FC_EVENT_PUBLISH.isTruthyFlag(
      fm["опублікувати подію"] ?? fm["Опублікувати подію"] ?? fm["event-publish"] ?? fm["publish-event"],
    );
  }

  eventPublishSignatureForFile(file) {
    if (!file?.path || !/\.md$/i.test(file.path) || typeof FC_EVENT_PUBLISH === "undefined") return "";
    const cached = this.eventPublishCache?.get(file.path);
    const fm = this.app?.metadataCache?.getFileCache?.(file)?.frontmatter;
    const mtime = file.stat?.mtime ?? 0;
    const flag = this.readPublishCheckboxFlag(file);
    const cw = String(fm?.["event-copywrite"] ?? "").slice(0, 60);
    const dt = String(fm?.["event-start"] ?? fm?.["дата івенту"] ?? "");
    const h = String(fm?.["event-publish-hash"] ?? "");
    return [mtime, flag ? 1 : 0, cw, dt, h, cached?.parsed?.publishHash || ""].join("|");
  }

  async resolveEventCopywriteWikilink(file, wikilink) {
    const link = String(wikilink || "").trim();
    if (!link || !this.app?.metadataCache?.getFirstLinkpathDest || !this.app?.vault?.cachedRead) return "";
    try {
      const target = this.app.metadataCache.getFirstLinkpathDest(link, file.path);
      if (!(target instanceof TFile)) return "";
      return await this.app.vault.cachedRead(target);
    } catch {
      return "";
    }
  }

  async refreshEventPublishAnalysis(file, { force = false } = {}) {
    if (!file?.path || !/\.md$/i.test(file.path) || typeof FC_EVENT_PUBLISH === "undefined") return null;
    const mtime = file.stat?.mtime ?? 0;
    const cached = this.eventPublishCache?.get(file.path);
    if (!force && cached && cached.mtime === mtime && cached.parsed) return cached.parsed;
    try {
      const rawMd = typeof this.app?.vault?.cachedRead === "function"
        ? await this.app.vault.cachedRead(file)
        : await this.app.vault.read(file);
      const fm = this.app?.metadataCache?.getFileCache?.(file)?.frontmatter || null;
      const pre = FC_EVENT_PUBLISH.parseEventPublishNote(rawMd, {
        fileName: file.basename,
        cachedFrontmatter: fm,
      });
      let resolvedCopywrite = "";
      if (pre.copywriteWikilink) {
        resolvedCopywrite = await this.resolveEventCopywriteWikilink(file, pre.copywriteWikilink);
      }
      const parsed = resolvedCopywrite
        ? FC_EVENT_PUBLISH.parseEventPublishNote(rawMd, {
            fileName: file.basename,
            cachedFrontmatter: fm,
            resolvedCopywrite,
          })
        : pre;
      this.eventPublishCache?.set(file.path, { mtime, parsed });
      if (this.alive && this.activeNote() === file && (!cached || cached.parsed?.publishHash !== parsed.publishHash || cached.parsed?.isEventNote !== parsed.isEventNote)) {
        this.refreshDockViews();
      }
      return parsed;
    } catch {
      return null;
    }
  }

  getEventPublishAnalysisSync(file) {
    if (!file?.path || !/\.md$/i.test(file.path) || typeof FC_EVENT_PUBLISH === "undefined") return null;
    const cached = this.eventPublishCache?.get(file.path);
    const mtime = file.stat?.mtime ?? 0;
    if (cached?.parsed && cached.mtime === mtime) return cached.parsed;
    const fm = this.app?.metadataCache?.getFileCache?.(file)?.frontmatter || null;
    const quick = FC_EVENT_PUBLISH.parseEventPublishNote("", {
      fileName: file.basename,
      cachedFrontmatter: fm,
    });
    if (quick.isEventNote || !cached) {
      void this.refreshEventPublishAnalysis(file);
    }
    return cached?.parsed || quick;
  }

  handleEventMetadataChanged(file) {
    if (!file?.path || !/\.md$/i.test(file.path) || isTemplateOrArchivePath(file.path)) return;
    if (this._writingEventPublishFrontmatter) return;
    const nextFlag = this.readPublishCheckboxFlag(file);
    if (!this.eventPublishFlagState?.has(file.path)) {
      this.eventPublishFlagState?.set(file.path, nextFlag);
      return;
    }
    const prevFlag = Boolean(this.eventPublishFlagState.get(file.path));
    this.eventPublishFlagState.set(file.path, nextFlag);
    if (prevFlag || !nextFlag) return;
    if (!this.alive || !this.accountVerified || !this.vaultConfig?.deviceToken) return;

    const prevTimer = this.eventPublishWatchTimers?.get(file.path);
    if (prevTimer) clearTimeout(prevTimer);
    const timer = setTimeout(() => {
      this.eventPublishWatchTimers?.delete(file.path);
      if (!this.alive) return;
      void this.refreshEventPublishAnalysis(file, { force: true }).then((parsed) => {
        if (!this.alive || !parsed || !parsed.isEventNote || !parsed.publishFlag) return;
        if (!parsed.hasChangesSincePublish) {
          new Notice("ℹ️ Цю версію події вже опубліковано. Натисніть «Оновити» на панелі справа за потреби.");
          return;
        }
        if (this.vaultConfig.autoPublishEventOnCheck && parsed.valid && !parsed.copywriteMissing) {
          void this.executeEventPublish(file, {
            ...parsed,
            channels: { googleCalendar: true, discord: true, whatsapp: false, site: true },
            whatsappGroupJid: "",
          }).then((res) => {
            if (res?.ok) new Notice(`✅ Подію «${parsed.event.title}» опубліковано (Calendar · Discord · Сайт).`);
          }).catch((err) => {
            new Notice(`⚠️ ${err instanceof Error ? err.message : "Помилка публікації події."}`);
          });
          return;
        }
        void this.openEventPublishModal(file);
      });
    }, 450);
    this.eventPublishWatchTimers?.set(file.path, timer);
  }

  async writeEventPublishFrontmatter(file, patch) {
    if (!file || typeof this.app?.fileManager?.processFrontMatter !== "function") return;
    this._writingEventPublishFrontmatter = true;
    try {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        for (const [k, v] of Object.entries(patch || {})) {
          if (v !== undefined && v !== null && v !== "") fm[k] = v;
        }
      });
      this.eventPublishFlagState?.set(file.path, this.readPublishCheckboxFlag(file));
      await this.refreshEventPublishAnalysis(file, { force: true });
    } finally {
      setTimeout(() => { this._writingEventPublishFrontmatter = false; }, 300);
    }
  }

  async insertEventPublishProperties(file) {
    if (!file || isTemplateOrArchivePath(file.path)) return;
    const fm = this.app?.metadataCache?.getFileCache?.(file)?.frontmatter || {};
    const patch = {};
    if (!Object.prototype.hasOwnProperty.call(fm, "опублікувати подію")) patch["опублікувати подію"] = false;
    if (!Object.prototype.hasOwnProperty.call(fm, "event-copywrite")) patch["event-copywrite"] = "";
    await this.writeEventPublishFrontmatter(file, Object.keys(patch).length ? patch : { "опублікувати подію": Boolean(fm["опублікувати подію"]) });
    new Notice("✅ Додано властивості `опублікувати подію` та `event-copywrite`.");
    this.refreshDockViews(true);
  }

  async loadEventPublishServerStatus() {
    const token = this.vaultConfig?.deviceToken;
    if (!token || !this.accountVerified) return null;
    try {
      const response = await this.timedSiteRequest({
        url: SITE + "/m/obsidian-sync?obsidian=publish-event-v1",
        method: "GET",
        headers: this.authHeaders(token),
        throw: false,
      }, 12_000);
      if (response?.status === 200 && response.json?.ok === true) {
        return response.json;
      }
      if (response?.status === 403 && response.json?.error) {
        return { ok: false, error: response.json.error };
      }
    } catch {}
    return null;
  }

  async executeEventPublish(file, { event, existing, publishHash, channels, whatsappGroupJid }) {
    const token = this.vaultConfig?.deviceToken;
    if (!token || !this.accountVerified) {
      throw new Error("Спочатку підключіть акаунт FlightClub.");
    }
    const driveId = this.resolveDriveIdForFile?.(file) || "";
    const response = await this.timedSiteRequest({
      url: SITE + "/m/obsidian-sync?obsidian=publish-event-v1",
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.authHeaders(token) },
      body: JSON.stringify({
        title: event.title,
        description: event.description,
        startIso: event.startIso,
        endIso: event.endIso,
        city: event.city,
        location: event.location,
        formUrl: event.formUrl,
        siteUrl: event.siteUrl,
        notePath: file.path,
        driveFileId: driveId,
        publishHash,
        whatsappGroupJid,
        channels,
        existing,
      }),
      throw: false,
    }, 24_000);

    if (response?.status !== 200 || response.json?.ok !== true) {
      throw new Error(response?.json?.error || `Не вдалося опублікувати подію (HTTP ${response?.status || "?"}).`);
    }

    const r = response.json.results || {};
    const patch = {
      "опублікувати подію": true,
      "event-published-at": response.json.publishedAt || new Date().toISOString(),
      "event-publish-hash": publishHash,
    };
    if (r.googleCalendar?.eventId) patch["gcal-event-id"] = r.googleCalendar.eventId;
    if (r.googleCalendar?.url) patch["gcal-link"] = r.googleCalendar.url;
    if (r.discord?.eventId) patch["discord-event-id"] = r.discord.eventId;
    if (r.discord?.url) patch["discord-event-link"] = r.discord.url;
    if (r.site?.eventId) patch["fc-site-event-id"] = r.site.eventId;
    if (r.whatsapp?.status && r.whatsapp.status !== "skipped") patch["wa-event-status"] = r.whatsapp.status;

    if (channels?.whatsapp && whatsappGroupJid && whatsappGroupJid !== this.vaultConfig.lastEventPublishWaGroupJid) {
      this.vaultConfig.lastEventPublishWaGroupJid = whatsappGroupJid;
      void this.persist().catch(() => {});
    }

    await this.writeEventPublishFrontmatter(file, patch).catch(() => {});
    this.refreshDockViews();
    return response.json;
  }

  renderEventPublishSidebarCard(bodySlot, file, hasToken) {
    const parsed = this.getEventPublishAnalysisSync(file);
    if (!parsed || !parsed.isEventNote) return;

    const card = bodySlot.createDiv({
      cls: "fc-deck-card fc-event-publish-card",
      attr: { "data-fc-event-publish-card": "" },
    });
    const head = card.createDiv({ cls: "fc-deck-header" });
    head.createEl("h4", { cls: "fc-deck-title", text: "📅 Публікація події" });
    const badgeCls = !parsed.valid
      ? "fc-deck-badge fc-deck-badge-warn"
      : parsed.alreadyPublished && !parsed.hasChangesSincePublish
        ? "fc-deck-badge fc-deck-badge-ok"
        : parsed.publishFlag
          ? "fc-deck-badge fc-deck-badge-ok"
          : "fc-deck-badge";
    const badgeText = !parsed.valid
      ? "Заповніть поля"
      : parsed.alreadyPublished && !parsed.hasChangesSincePublish
        ? "Опубліковано"
        : parsed.alreadyPublished
          ? "Є зміни до оновлення"
          : parsed.publishFlag
            ? "Готово до публікації"
            : "Чернетка";
    head.createSpan({ cls: badgeCls, text: badgeText });

    const meta = card.createDiv({ cls: "fc-event-publish-meta" });
    const row1 = meta.createDiv({ cls: "fc-event-publish-meta-line" });
    row1.createSpan({ text: "Коли:" });
    row1.createEl("strong", { text: parsed.whenDisplay });
    const row2 = meta.createDiv({ cls: "fc-event-publish-meta-line" });
    row2.createSpan({ text: "Локація:" });
    row2.createEl("strong", { text: parsed.event.location });
    const row3 = meta.createDiv({ cls: "fc-event-publish-meta-line" });
    row3.createSpan({ text: "event-copywrite:" });
    row3.createEl("strong", {
      text: parsed.event.description
        ? (parsed.usedFallbackDescription ? "Резерв із поля «опис»" : `Готовий (${parsed.event.description.length} симв.)`)
        : "Не заповнено",
    });

    if (parsed.warnings?.length) {
      card.createEl("p", { cls: "fc-event-publish-warn", text: parsed.warnings[0] });
    }

    const btns = card.createDiv({ cls: "fc-deck-grid fc-event-publish-actions" });
    const pubBtn = btns.createEl("button", {
      text: parsed.alreadyPublished ? "🔄 Оновити / Опублікувати подію" : "🚀 Опублікувати подію",
      cls: (parsed.publishFlag && parsed.hasChangesSincePublish ? "mod-cta " : "") + "fc-deck-btn",
      attr: { type: "button", "data-fc-open-event-publish": "" },
    });
    pubBtn.disabled = !hasToken;
    pubBtn.addEventListener("click", () => void this.openEventPublishModal(file));

    if (!Object.prototype.hasOwnProperty.call(this.app?.metadataCache?.getFileCache?.(file)?.frontmatter || {}, "event-copywrite")) {
      const propBtn = btns.createEl("button", {
        text: "➕ Додати поля публікації",
        cls: "fc-deck-btn",
        attr: { type: "button" },
      });
      propBtn.addEventListener("click", () => void this.insertEventPublishProperties(file));
    }

    const links = [];
    if (parsed.existing.gcalLink || parsed.calendarTemplateUrl) {
      links.push([parsed.existing.gcalEventId ? "📅 Google Calendar" : "📅 В Google Календар (шаблон)", parsed.existing.gcalLink || parsed.calendarTemplateUrl]);
    }
    if (parsed.existing.discordEventLink) links.push(["💬 Discord Подія", parsed.existing.discordEventLink]);
    if (parsed.existing.siteEventId) links.push(["🌐 Розклад сайту", `${SITE}/schedule?e=${encodeURIComponent(parsed.existing.siteEventId)}`]);

    if (links.length) {
      const linksWrap = card.createDiv({ cls: "fc-event-publish-links" });
      for (const [lbl, href] of links) {
        const b = linksWrap.createEl("button", { text: lbl, cls: "fc-entity-pill", attr: { type: "button", title: href } });
        b.addEventListener("click", () => this.openSite(href));
      }
    }
  }

  async openEventPublishModal(file) {
    if (!file || isTemplateOrArchivePath(file.path)) return;
    if (!this.vaultConfig?.deviceToken || !this.accountVerified) {
      new Notice("Спочатку підключіть акаунт FlightClub.");
      return;
    }
    if (typeof FC_EVENT_PUBLISH === "undefined") return;

    this.dialog?.close();
    const modal = new Modal(this.app);
    this.dialog = modal;

    modal.onOpen = async () => {
      modal.titleEl.setText("📅 Публікація події FlightClub");
      const root = modal.contentEl.createDiv({
        cls: "fc-event-publish-modal",
        attr: { "data-fc-event-publish-modal": "" },
      });
      const statusEl = root.createEl("p", {
        cls: "fc-sync-status",
        text: "Зчитуємо поля нотатки та перевіряємо канали…",
        attr: { role: "status" },
      });

      const [parsed, serverStatus] = await Promise.all([
        this.refreshEventPublishAnalysis(file, { force: true }),
        this.loadEventPublishServerStatus(),
      ]);
      if (!this.alive || this.dialog !== modal) return;

      if (!parsed) {
        statusEl.setText("Не вдалося прочитати нотатку події.");
        return;
      }
      if (serverStatus && serverStatus.ok === false) {
        statusEl.setText(serverStatus.error || "Недостатньо прав для публікації.");
        return;
      }

      statusEl.setText(
        parsed.errors.length
          ? `Перевірте обов’язкові поля: ${parsed.errors.join(" ")}`
          : "Перевірте деталі та оберіть канали для публікації.",
      );

      const summary = root.createDiv({ cls: "fc-event-publish-meta" });
      for (const [k, v] of [
        ["Назва:", parsed.event.title],
        ["Коли:", parsed.whenDisplay],
        ["Локація:", parsed.event.location],
        ["Форма реєстрації:", parsed.event.formUrl || "Не вказано"],
      ]) {
        const line = summary.createDiv({ cls: "fc-event-publish-meta-line" });
        line.createSpan({ text: k });
        line.createEl("strong", { text: v });
      }

      if (parsed.warnings.length) {
        for (const w of parsed.warnings) {
          root.createEl("p", { cls: "fc-event-publish-warn", text: w });
        }
      }

      root.createEl("label", { cls: "fc-deck-sub", text: "Текст анонсу (`event-copywrite`, можна підправити перед публікацією):" });
      const copyInput = root.createEl("textarea", {
        cls: "fc-event-publish-textarea",
        attr: { "aria-label": "Текст анонсу event-copywrite", placeholder: "Додайте опис події для Google Календаря, Discord і WhatsApp…" },
      });
      copyInput.value = parsed.event.description || "";

      const channelsBox = root.createDiv({ cls: "fc-event-publish-channels" });

      const gcalWrap = channelsBox.createDiv({ cls: "fc-event-publish-channel-opt" });
      const gcalLbl = gcalWrap.createEl("label", { cls: "fc-event-publish-channel-row" });
      const gcalCb = gcalLbl.createEl("input", { attr: { type: "checkbox" } });
      gcalCb.checked = true;
      gcalLbl.createSpan({ text: "📅 Google Календар" });
      gcalWrap.createEl("p", {
        cls: "fc-event-publish-channel-hint",
        text: serverStatus?.googleCalendarConfigured
          ? `API підключено (календар: ${serverStatus.googleCalendarId || "primary"}).`
          : "Якщо OAuth-токен сервера ще не має Calendar scope — одразу згенеруємо 1-клік посилання на шаблон Google Календаря.",
      });

      const dcWrap = channelsBox.createDiv({ cls: "fc-event-publish-channel-opt" });
      const dcLbl = dcWrap.createEl("label", { cls: "fc-event-publish-channel-row" });
      const dcCb = dcLbl.createEl("input", { attr: { type: "checkbox" } });
      dcCb.checked = true;
      dcLbl.createSpan({ text: parsed.existing.discordEventId ? "💬 Discord Подія (оновити існуючу)" : "💬 Discord Server Event (створити подію на сервері)" });

      const waWrap = channelsBox.createDiv({ cls: "fc-event-publish-channel-opt" });
      const waLbl = waWrap.createEl("label", { cls: "fc-event-publish-channel-row" });
      const waCb = waLbl.createEl("input", { attr: { type: "checkbox" } });
      waCb.checked = false;
      waLbl.createSpan({ text: "📢 WhatsApp спільнота / чат (анонс від Маскота)" });
      waWrap.createEl("p", {
        cls: "fc-event-publish-channel-hint",
        text: "Evolution API v2.3.7 не підтримує створення нативної картки WhatsApp Community Event, тому бот надішле форматований анонс із посиланнями на Google Календар і Discord у вибрану групу.",
      });
      const waGroups = Array.isArray(serverStatus?.whatsappGroups) ? serverStatus.whatsappGroups : [];
      const waSelect = waWrap.createEl("select", { attr: { "aria-label": "WhatsApp група для анонсу" } });
      if (!waGroups.length) {
        waSelect.createEl("option", { value: "", text: "Групи WhatsApp не завантажені" });
        waCb.disabled = true;
      } else {
        const preferred = this.vaultConfig.lastEventPublishWaGroupJid || serverStatus?.defaultWhatsappGroupJid || waGroups[0]?.jid;
        for (const g of waGroups) {
          const opt = waSelect.createEl("option", {
            value: g.jid,
            text: `${g.name}${g.participantCount ? ` (${g.participantCount})` : ""}`,
          });
          if (g.jid === preferred) opt.selected = true;
        }
      }
      waSelect.disabled = !waCb.checked || !waGroups.length;
      waCb.addEventListener("change", () => {
        waSelect.disabled = !waCb.checked || !waGroups.length;
      });

      const siteWrap = channelsBox.createDiv({ cls: "fc-event-publish-channel-opt" });
      const siteLbl = siteWrap.createEl("label", { cls: "fc-event-publish-channel-row" });
      const siteCb = siteLbl.createEl("input", { attr: { type: "checkbox" } });
      siteCb.checked = true;
      siteLbl.createSpan({ text: parsed.existing.siteEventId ? "🌐 Розклад на сайті (оновити подію)" : "🌐 Додати в розклад на сайті flightclub.com.ua/schedule" });

      const receiptsBox = root.createDiv({ cls: "fc-event-publish-receipts" });

      const actions = root.createDiv({ cls: "fc-conflict-actions" });
      const goBtn = actions.createEl("button", {
        text: "🚀 Опублікувати зараз",
        cls: "mod-cta fc-deck-btn",
        attr: { type: "button", "data-fc-confirm-event-publish": "" },
      });
      goBtn.disabled = parsed.errors.length > 0;
      const gcalQuickBtn = actions.createEl("button", {
        text: "📅 Відкрити в Google Календарі",
        cls: "fc-deck-btn",
        attr: { type: "button" },
      });
      gcalQuickBtn.addEventListener("click", () => {
        const dynUrl = FC_EVENT_PUBLISH.buildGoogleCalendarTemplateUrl({
          ...parsed.event,
          description: copyInput.value.trim(),
        });
        this.openSite(dynUrl);
      });
      const closeBtn = actions.createEl("button", { text: "Закрити", cls: "fc-deck-btn", attr: { type: "button" } });
      closeBtn.addEventListener("click", () => modal.close());

      goBtn.addEventListener("click", async () => {
        const editedDesc = copyInput.value.trim();
        const eventToPublish = { ...parsed.event, description: editedDesc };
        goBtn.disabled = closeBtn.disabled = true;
        statusEl.setText("Публікуємо подію у вибрані канали…");
        receiptsBox.empty?.();

        try {
          const out = await this.executeEventPublish(file, {
            event: eventToPublish,
            existing: parsed.existing,
            publishHash: parsed.publishHash,
            whatsappGroupJid: waCb.checked ? waSelect.value : "",
            channels: {
              googleCalendar: gcalCb.checked,
              discord: dcCb.checked,
              whatsapp: waCb.checked,
              site: siteCb.checked,
            },
          });

          const r = out.results || {};
          const addReceipt = (label, res, fallbackUrl = "") => {
            const st = String(res?.status || "skipped");
            if (st === "skipped") return;
            const cls = st === "created" || st === "updated" || st === "sent_announcement"
              ? "fc-event-receipt-row is-ok"
              : st === "needs_scope"
                ? "fc-event-receipt-row is-warn"
                : "fc-event-receipt-row is-err";
            const row = receiptsBox.createDiv({ cls });
            const msg = st === "created" ? `${label}: ✅ Створено`
              : st === "updated" ? `${label}: ✅ Оновлено`
                : st === "sent_announcement" ? `${label}: ✅ Анонс надіслано`
                  : st === "needs_scope" ? `${label}: ⚠️ Потрібен Calendar scope (є 1-клік посилання)`
                    : `${label}: ❌ ${res?.error || "Помилка"}`;
            row.createEl("strong", { text: msg });
            if (res?.note) row.createSpan({ cls: "fc-deck-sub", text: res.note });
            const href = res?.url || fallbackUrl;
            if (href) {
              const openResBtn = row.createEl("button", { text: `↗ Відкрити (${label})`, cls: "fc-entity-pill", attr: { type: "button" } });
              openResBtn.addEventListener("click", () => this.openSite(href));
            }
          };

          addReceipt("Google Календар", r.googleCalendar, out.calendarTemplateUrl);
          addReceipt("Discord Подія", r.discord);
          addReceipt("WhatsApp Анонс", r.whatsapp);
          addReceipt("Розклад сайту", r.site);

          statusEl.setText("✅ Готово! Метадані публікації збережено у Properties нотатки.");
          new Notice(`✅ Подію «${eventToPublish.title}» оброблено!`);
        } catch (err) {
          statusEl.setText(err instanceof Error ? err.message : "Не вдалося опублікувати подію.");
        } finally {
          goBtn.disabled = closeBtn.disabled = false;
        }
      });
    };

    modal.onClose = () => {
      if (this.dialog === modal) this.dialog = null;
      modal.contentEl.empty();
    };
    modal.open();
  }

  openDeckModal(targetFile) {
    this.dialog?.close();
    this.pruneDeletedLinks();
    const modal = new Modal(this.app);
    this.dialog = modal;
    let activeTab = "live", entering = true;
    const mentionState = { kind: "all", query: "" };
    const pagesFilterState = { query: "" };
    const hubHost = {};
    const render = () => {
      this.renderHubInterface(modal.contentEl, { targetFile, activeTab, mentionState, pagesFilterState, host: hubHost, entering,
        onTabChange: (tab) => { activeTab = tab; render(); } });
      entering = false;
    };
    const refresh = (liveOnly) => { if (!liveOnly || activeTab === "live") render(); };
    modal.onOpen = () => { this.mobileHubRefresh = refresh; modal.titleEl.setText("FlightClub"); render(); };
    modal.onClose = () => {
      hubHost.cleanup?.();
      if (this.mobileHubRefresh === refresh) this.mobileHubRefresh = null;
      if (this.dialog === modal) this.dialog = null;
      modal.contentEl.empty();
    };
    modal.open();
  }

  dialogForm({ title, description, field, button, previews, submit }) {
    this.dialog?.close();
    const modal = new Modal(this.app);
    this.dialog = modal;
    modal.onOpen = () => {
      modal.titleEl.setText(title);
      const form = modal.contentEl.createEl("form", { cls: "flightclub-markdown-form" });
      form.createEl("p", { text: description });
      if (previews) {
        const panels=form.createDiv({cls:"fc-sync-review-previews"});
        for (const [label,body] of previews) {
          const panel=panels.createDiv({cls:"fc-sync-review-preview"});
          panel.createEl("h4",{text:label});
          panel.createEl("pre").createEl("code",{text:body.slice(0,MAX_NOTE)});
        }
      }
      const input = field ? form.createEl("input", {
        attr: { type: field.secret ? "password" : "text", "aria-label": field.label, placeholder: field.label, autocomplete: "off", maxlength: field.max },
      }) : null;
      if (input) input.value = field.value ?? "";
      const status = form.createEl("p", { attr: { role: "status" } });
      const go = form.createEl("button", { text: button, cls: "mod-cta", attr: { type: "submit" } });
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (go.disabled) return;
        go.disabled = true;
        status.setText("");
        try {
          await submit(input?.value.trim() ?? "", () => this.alive && this.dialog === modal);
          if (this.dialog === modal) modal.close();
        } catch (error) {
          status.setText(error instanceof Error ? error.message : "Не вдалося виконати дію.");
        } finally {
          go.disabled = false;
        }
      });
      (input ?? go).focus();
    };
    modal.onClose = () => {
      if (this.dialog === modal) this.dialog = null;
      modal.contentEl.empty();
    };
    modal.open();
  }

  showTransfer(file, intent) {
    if (this.platformNote(file)) return;
    const current = this.linkFor(file);
    if (intent === "update" && !current?.version) return;
    const id = crypto.randomUUID();
    this.dialogForm({
      title: intent === "create" ? "Створити сторінку FlightClub" : "Оновити сторінку FlightClub",
      description: intent === "create"
        ? "Вкажіть адресу після /m/. Нотатка потрапить у буфер обміну, а в браузері ви перевірите текст і виберете доступ."
        : "Адреса /m/" + current.slug + ". У браузері ви перевірите текст перед збереженням.",
      field: intent === "create" ? { label: "Адреса після /m/", value: slugFromTitle(file.basename, id), max: "64" } : null,
      button: "Відкрити редактор сайту",
      submit: async (value, isOpen) => {
        const slug = intent === "create" ? value.toLowerCase() : current.slug;
        if (!SLUG.test(slug)) throw new Error("Введіть 2–64 латинські літери, цифри, дефіси або підкреслення.");
        const url = SITE + "/m/obsidian-sync?obsidian=clipboard-v1";
        let supported = false;
        let timer;
        try {
          const response = await Promise.race([
            this.siteRequest({ url, method: "GET", throw: false }),
            new Promise((resolve) => { timer = setTimeout(() => resolve(null), 8000); }),
          ]);
          supported = response?.status === 200 && response.json?.transfer === "clipboard-v1";
        } catch {
        } finally {
          clearTimeout(timer);
        }
        if (!isOpen()) return;
        if (!supported) throw new Error("Сайт поки не приймає нотатки з плагіна. Markdown можна імпортувати у вебредакторі.");
        if (this.app.vault.getAbstractFileByPath(file.path) !== file) throw new Error("Цю нотатку вже закрито або видалено.");
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        const markdown = view?.file === file && view.editor ? view.editor.getValue() : await this.app.vault.read(file);
        if (!isOpen()) return;
        if (markdown.length > MAX_NOTE) throw new Error("Нотатка завелика для передачі через буфер обміну.");
        await navigator.clipboard.writeText(JSON.stringify({
          flightclub: "obsidian-v1", id, title: file.basename.slice(0, 180), markdown,
          version: intent === "update" ? current.version : null,
        }));
        if (!isOpen()) return;
        this.pending = { id, file, intent, slug, expires: Date.now() + TTL };
        const target = new URL(pageUrl(slug));
        target.searchParams.set("obsidian", id);
        target.searchParams.set("intent", intent);
        this.openSite(target.href);
        new Notice("У браузері натисніть «Вставити нотатку».");
      },
    });
  }

  receiveLink(data) {
    if(data?.update==='1'){void this.checkPluginVersion(true,true);return;}
    if (data?.intent === "shared-note") {
      const path = typeof data.path === "string" ? data.path : "";
      if (!path || path.length > 400 || !/\.md$/i.test(path) || path !== path.normalize("NFC") ||
          path.split("/").some(part => !part || part.startsWith(".") || /[<>:"\\|?*\x00-\x1f\x7f]/u.test(part))) return;
      const file = this.app.vault.getAbstractFileByPath(SHARED_FOLDER + path);
      if (file instanceof TFile && file.path === SHARED_FOLDER + path) {
        void this.app.workspace.getLeaf(false).openFile(file).catch(() => new Notice("Не вдалося відкрити нотатку."));
      } else {
        new Notice("Нотатки ще немає в Obsidian. Синхронізуйте FlightClub Shared у панелі плагіна.");
      }
      return;
    }
    if (data?.intent === "begin-pair") {
      void this.startPairingFlow();
      return;
    }
    if (data?.intent === "import") {
      const slug = String(data.slug || "");
      if (SLUG.test(slug)) void this.openSitePageInObsidian(slug);
      return;
    }
    if (data?.intent === "pair") {
      const pending = this.pendingPair;
      if (!pending || !UUID.test(String(data.request || "")) || data.request !== pending.id) {
        new Notice("Це підтвердження стосується іншого або завершеного запиту. Відкрийте підключення в панелі FlightClub.");
        return;
      }
      void this.checkPairing(pending);
      return;
    }

    // 2. ADMAX Google Drive Vault Rebind Callback
    if (data?.intent === "vault" || data?.vaultRoot) {
      const pv = this.pendingVault;
      if (!pv || pv.expires < Date.now() || pv.id !== data.request) {
        new Notice("Запит зміни папки Google Drive застарів або не збігається. Спробуйте ще раз.");
        return;
      }
      if (!DRIVE_ID.test(String(data.vaultRoot ?? "")) || !UUID.test(String(data.revision ?? ""))) {
        new Notice("Бракує підтвердження папки. Звірте її у вкладці Drive.");
        return;
      }
      this.pendingVault = null;
      void this.verifyDriveBinding({ rootId: data.vaultRoot, revision: data.revision }).then(() => {
        if (!this.alive) return;
        this.updateStatusBar();
        this.renderFileExplorerBadges();
        this.refreshDockViews();
        void this.loadTeamPluginsCatalog?.({ silent: true });
        new Notice("Прив’язку папки Drive підтверджено.");
      }).catch(error => {
        if (this.alive) new Notice(error.message);
      });
      return;
    }

    // 3. Clipboard Transfer Receipt Callback
    const pending = this.pending;
    if (!pending || pending.expires < Date.now() || pending.id !== data.request) return;
    const link = readLink({ slug: data.slug, version: data.version });
    if (!link || (data.version && !link.version) || (pending.intent === "update" && pending.slug !== link.slug)) return;
    this.pending = null;
    if (this.app.vault.getAbstractFileByPath(pending.file.path) !== pending.file) return;
    this.dialogForm({
      title: "Прив’язати сторінку до нотатки",
      description: pending.file.basename + " → " + pageUrl(link.slug),
      button: "Прив’язати й скопіювати",
      submit: async () => {
        if (this.app.vault.getAbstractFileByPath(pending.file.path) !== pending.file) throw new Error("Нотатку більше не знайдено.");
        await this.storeLink(pending.file, link);
        await this.copyLink(pending.file);
        this.attachLiveSessionToActiveNote(pending.file);
        this.refreshDockViews();
      },
    });
  }

  attachLink(file) {
    if (this.platformNote(file)) return;
    this.dialogForm({
      title: "Прив’язати сторінку FlightClub",
      description: "Вставте адресу вже збереженої сторінки.",
      field: { label: "https://flightclub.com.ua/m/…", max: "130" },
      button: "Прив’язати",
      submit: async (value) => {
        const ref = parseSiteUrl(value);
        if (ref?.kind !== "m") throw new Error("Вкажіть точну адресу сторінки /m/ на flightclub.com.ua.");
        await this.storeLink(file, { slug: ref.id, version: null });
        this.updateStatusBar();
        this.attachLiveSessionToActiveNote(file);
        this.refreshDockViews();
        new Notice("Сторінку прив’язано.");
      },
    });
  }

  showReference(editor, file) {
    this.openEntityPickerModal(editor, file);
  }

  async storeLink(file, link) {
    if (!file || isSyncArchivePath(file.path)) throw new Error("Архівні копії із Sync Archive не прив’язуються.");
    if (this.app.vault.getAbstractFileByPath(file.path) !== file) throw new Error("Нотатку більше не знайдено.");
    this.links.set(file.path, link);
    await this.persist();
    this.updateStatusBar();
  }

  rekey(from, to) {
    const destArchived = Boolean(to && isSyncArchivePath(to));
    let changed = false;
    for (const [path, link] of Array.from(this.links)) {
      if (path !== from && !path.startsWith(from + "/")) continue;
      this.links.delete(path);
      if (to && !destArchived) this.links.set(to + path.slice(from.length), link);
      changed = true;
    }
    for (const [path, pending] of Array.from(this.pendingPageCreates ?? [])) {
      if (path !== from && !path.startsWith(from + "/")) continue;
      this.pendingPageCreates.delete(path);
      const destination = to && !destArchived ? to + path.slice(from.length) : null;
      if (destination && !this.pendingPageCreates.has(destination)) {
        this.pendingPageCreates.set(destination,{...pending,sourcePath:pending.sourcePath ?? path});
      }
      changed = true;
    }
    for (const [path, baseline] of Array.from(this.driveFiles ?? [])) {
      if (path !== from && !path.startsWith(from + "/")) continue;
      const destination = to && !destArchived ? to + path.slice(from.length) : null;
      if (destination && this.driveFiles.has(destination)) continue;
      this.driveFiles.delete(path);
      if (destination) this.driveFiles.set(destination, baseline);
      changed = true;
    }
    for (const [path, folderBase] of Array.from(this.driveFolders ?? [])) {
      if (path !== from && !path.startsWith(from + "/")) continue;
      const destination = to && !destArchived ? to + path.slice(from.length) : null;
      if (destination && this.driveFolders.has(destination)) continue;
      this.driveFolders.delete(path);
      if (destination) this.driveFolders.set(destination, folderBase);
      changed = true;
    }
    for (const [path, info] of Array.from(this.unreviewedUpdates ?? [])) {
      if (path !== from && !path.startsWith(from + "/")) continue;
      const destination = to && !destArchived ? to + path.slice(from.length) : null;
      this.unreviewedUpdates.delete(path);
      if (destination && !this.unreviewedUpdates.has(destination)) {
        this.unreviewedUpdates.set(destination, info);
      }
      changed = true;
    }
    if (changed) this.renderFileExplorerBadges();
    this.queuePublishCheck();
    if (changed) void this.persist().catch(() => new Notice("Не вдалося зберегти прив’язку FlightClub."));
  }

  persist() {
    const task = this.writes.catch(() => undefined).then(() =>
      this.saveData({
        links: Object.fromEntries(this.links),
        graphPreset: this.graphPreset ?? null,
        treeSyncState: this.treeSyncState,
        staffTreeSyncState: this.staffTreeSyncState,
        driveFiles: Object.fromEntries(this.driveFiles ?? []),
        driveFolders: Object.fromEntries(this.driveFolders ?? []),
        pendingDriveDeletes: (this.pendingDriveDeletes ?? []).slice(-200),
        pendingDriveMoves: (this.pendingDriveMoves ?? []).slice(-200),
        pendingFolderOps: (this.pendingFolderOps ?? []).slice(-200),
        driveLastSummary: this.driveLastSummary ?? null,
        hubCities: normalizeHubCities(this.hubCities, { fromServer: true }),
        unreviewedUpdates: Object.fromEntries(this.unreviewedUpdates ?? []),
        unreviewedUpdatesUserId: this.vaultConfig?.pairedUserId || null,
        pendingPageCreates: Object.fromEntries(this.pendingPageCreates ?? []),
        vaultConfig: { ...this.vaultConfig, deviceToken: this.useSecretStorage ? null : this.vaultConfig.deviceToken },
      }),
    );
    this.writes = task;
    return task;
  }
};
