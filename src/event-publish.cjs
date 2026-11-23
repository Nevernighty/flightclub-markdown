"use strict";

function cleanText(value) {
  return String(value == null ? "" : value).trim();
}

function unquoteYaml(raw) {
  const s = cleanText(raw);
  if (!s) return "";
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    const inner = s.slice(1, -1);
    return s.startsWith('"') ? inner.replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\") : inner.replace(/''/g, "'");
  }
  return s;
}

function parseYamlValue(raw) {
  const s = cleanText(raw);
  if (!s || s === "~" || s === "null") return null;
  if (s === "true" || s === "True") return true;
  if (s === "false" || s === "False") return false;
  if (s.startsWith("[") && s.endsWith("]")) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((p) => unquoteYaml(p)).filter(Boolean);
  }
  if (/^-?\d+(?:\.\d+)?$/.test(s)) return Number(s);
  return unquoteYaml(s);
}

function extractFrontmatterAndBody(rawMarkdown) {
  const text = String(rawMarkdown == null ? "" : rawMarkdown).replace(/\r\n/g, "\n");
  if (!text.startsWith("---\n")) {
    return { frontmatter: {}, body: text, hasFrontmatter: false };
  }
  const endIdx = text.indexOf("\n---", 4);
  if (endIdx < 0) {
    return { frontmatter: {}, body: text, hasFrontmatter: false };
  }
  const nextLineIdx = text.indexOf("\n", endIdx + 1);
  const yamlText = text.slice(4, endIdx);
  const body = nextLineIdx >= 0 ? text.slice(nextLineIdx + 1) : "";
  const lines = yamlText.split("\n");
  const out = {};

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line || /^\s*#/.test(line)) {
      i++;
      continue;
    }
    const kv = line.match(/^([^:\n][^:\n]*?):\s*(.*)$/);
    if (!kv) {
      i++;
      continue;
    }
    let key = unquoteYaml(kv[1].trim());
    const rest = kv[2].trim();

    if (rest === "|" || rest === "|-" || rest === ">" || rest === ">-") {
      const folded = rest.startsWith(">");
      const block = [];
      let blockIndent = null;
      i++;
      while (i < lines.length) {
        const sub = lines[i];
        if (!sub.trim()) {
          block.push("");
          i++;
          continue;
        }
        const mInd = sub.match(/^([ \t]+)/);
        if (!mInd) break;
        if (blockIndent === null) blockIndent = mInd[1].length;
        block.push(sub.slice(Math.min(blockIndent, mInd[1].length)));
        i++;
      }
      while (block.length && block[block.length - 1] === "") block.pop();
      out[key] = folded ? block.join("\n").replace(/([^\n])\n([^\n])/g, "$1 $2") : block.join("\n");
      continue;
    }

    if (!rest) {
      const items = [];
      let j = i + 1;
      let consumedList = false;
      while (j < lines.length) {
        const sub = lines[j];
        const mItem = sub.match(/^[ \t]*-\s+(.*)$/);
        if (mItem) {
          consumedList = true;
          items.push(parseYamlValue(mItem[1]));
          j++;
          continue;
        }
        if (!sub.trim()) {
          j++;
          continue;
        }
        break;
      }
      if (consumedList) {
        out[key] = items;
        i = j;
        continue;
      }
      out[key] = null;
      i++;
      continue;
    }

    out[key] = parseYamlValue(rest);
    i++;
  }

  return { frontmatter: out, body, hasFrontmatter: true };
}

function isTruthyFlag(val) {
  if (val === true) return true;
  if (typeof val === "number") return val === 1;
  const s = cleanText(val).toLowerCase();
  return ["true", "1", "yes", "так", "on", "x", "[x]"].includes(s);
}

function isPlaceholderText(val) {
  const s = cleanText(val);
  if (!s) return true;
  if (/^\?+$/.test(s)) return true;
  if (/^\[посилання[^\]]*\]$/i.test(s)) return true;
  if (/^\(посилання[^)]*\)$/i.test(s)) return true;
  if (/^(?:лінк на обсідіан|todo|tbd|n\/a|-+|—+)$/i.test(s)) return true;
  return false;
}

function safeHttpsUrl(val) {
  const s = cleanText(val);
  if (!s || isPlaceholderText(s)) return "";
  try {
    const u = new URL(s);
    return u.protocol === "https:" ? u.href : "";
  } catch {
    return "";
  }
}

function parseWikilinkTarget(raw) {
  const s = cleanText(raw);
  const m = s.match(/^\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]$/);
  return m ? cleanText(m[1]) : "";
}

function stripLeadingFrontmatter(md) {
  const { body } = extractFrontmatterAndBody(md);
  return cleanText(body);
}

function extractHeadingSection(body, headingNames) {
  const lines = String(body || "").replace(/\r\n/g, "\n").split("\n");
  const normalizedSet = new Set(headingNames.map((n) => n.toLowerCase()));
  let activeDepth = 0;
  const buf = [];

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const h = ln.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (h) {
      const depth = h[1].length;
      const titleClean = h[2].replace(/[*_`~]/g, "").trim().toLowerCase();
      if (activeDepth > 0 && depth <= activeDepth) break;
      if (activeDepth === 0 && normalizedSet.has(titleClean)) {
        activeDepth = depth;
        continue;
      }
      if (activeDepth === 0 && /^event[-_\s]?copywrite\b/i.test(titleClean)) {
        activeDepth = depth;
        continue;
      }
    }
    if (activeDepth > 0) {
      if (/^<!--\s*fc:sync\b/i.test(ln.trim())) break;
      buf.push(ln);
    }
  }
  return buf.join("\n").trim();
}

function extractFirstH1(body) {
  const lines = String(body || "").replace(/\r\n/g, "\n").split("\n");
  for (const ln of lines) {
    const m = ln.match(/^#\s+(.+?)\s*$/);
    if (m) {
      const candidate = cleanText(m[1]);
      if (candidate && !/^властивості для роботів$/i.test(candidate)) return candidate;
    }
  }
  return "";
}

function kyivOffsetMinutesAtUtcMs(utcMs) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Kyiv",
      timeZoneName: "shortOffset",
    }).formatToParts(new Date(utcMs));
    const tzPart = parts.find((p) => p.type === "timeZoneName")?.value || "";
    const m = tzPart.match(/(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?/i);
    if (m) {
      const sign = m[1] === "-" ? -1 : 1;
      const hh = Number(m[2]);
      const mm = Number(m[3] || "0");
      return sign * (hh * 60 + mm);
    }
  } catch {}
  return 120;
}

function formatOffsetStr(offsetMin) {
  const sign = offsetMin < 0 ? "-" : "+";
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}

function wallClockKyivToIso(year, month, day, hour, minute, second = 0) {
  if (!Number.isInteger(year) || month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;
  const approxUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset1 = kyivOffsetMinutesAtUtcMs(approxUtc - 2 * 3600_000);
  const exactUtc = approxUtc - offset1 * 60_000;
  const offset2 = kyivOffsetMinutesAtUtcMs(exactUtc);
  const offStr = formatOffsetStr(offset2);
  const pad = (n) => String(n).padStart(2, "0");
  return `${String(year).padStart(4, "0")}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}${offStr}`;
}

function parseKyivDateTime(raw, defaultHour = 18, defaultMinute = 0) {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const off = kyivOffsetMinutesAtUtcMs(raw.getTime());
    const local = new Date(raw.getTime() + off * 60_000);
    const pad = (n) => String(n).padStart(2, "0");
    return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}${formatOffsetStr(off)}`;
  }
  const s = cleanText(raw);
  if (!s) return null;

  // Explicit timezone offset or Z
  if (/^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const dt = new Date(s);
    if (!Number.isNaN(dt.getTime())) {
      const off = kyivOffsetMinutesAtUtcMs(dt.getTime());
      const local = new Date(dt.getTime() + off * 60_000);
      const pad = (n) => String(n).padStart(2, "0");
      return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}${formatOffsetStr(off)}`;
    }
  }

  // ISO wall clock YYYY-MM-DD[T ]HH:MM[:SS]
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    return wallClockKyivToIso(
      Number(m[1]),
      Number(m[2]),
      Number(m[3]),
      m[4] != null ? Number(m[4]) : defaultHour,
      m[5] != null ? Number(m[5]) : defaultMinute,
      m[6] != null ? Number(m[6]) : 0,
    );
  }

  // DD.MM.YYYY [HH:MM[:SS]]
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    return wallClockKyivToIso(
      Number(m[3]),
      Number(m[2]),
      Number(m[1]),
      m[4] != null ? Number(m[4]) : defaultHour,
      m[5] != null ? Number(m[5]) : defaultMinute,
      m[6] != null ? Number(m[6]) : 0,
    );
  }

  return null;
}

function fnv1aHex(str) {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= (ch + (i & 255));
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

function toGcalUtcStamp(isoStr) {
  const dt = new Date(isoStr);
  if (Number.isNaN(dt.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}${pad(dt.getUTCSeconds())}Z`;
}

function buildGoogleCalendarTemplateUrl({ title, description, startIso, endIso, location, formUrl, siteUrl }) {
  const detailsParts = [];
  if (description) detailsParts.push(description);
  if (formUrl) detailsParts.push(`Реєстрація: ${formUrl}`);
  if (siteUrl && siteUrl !== formUrl) detailsParts.push(`Деталі на сайті: ${siteUrl}`);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: cleanText(title).slice(0, 200),
    details: detailsParts.join("\n\n").slice(0, 1800),
    location: cleanText(location).slice(0, 200),
    ctz: "Europe/Kyiv",
  });
  const s = toGcalUtcStamp(startIso);
  const e = toGcalUtcStamp(endIso);
  if (s && e) params.set("dates", `${s}/${e}`);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function formatKyivDisplayRange(startIso, endIso) {
  if (!startIso) return "Дата не вказана";
  try {
    const sDt = new Date(startIso);
    const eDt = endIso ? new Date(endIso) : null;
    const dFmt = new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", year: "numeric" });
    const tFmt = new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit", hour12: false });
    const dStr = dFmt.format(sDt);
    const stStr = tFmt.format(sDt);
    if (eDt && !Number.isNaN(eDt.getTime())) {
      const edStr = dFmt.format(eDt);
      const etStr = tFmt.format(eDt);
      if (dStr === edStr) return `${dStr}, ${stStr}–${etStr} (Київ)`;
      return `${dStr} ${stStr} – ${edStr} ${etStr} (Київ)`;
    }
    return `${dStr}, ${stStr} (Київ)`;
  } catch {
    return startIso;
  }
}

function parseEventPublishNote(rawMarkdown, { fileName = "", cachedFrontmatter = null, resolvedCopywrite = "" } = {}) {
  const { frontmatter: parsedFm, body } = extractFrontmatterAndBody(rawMarkdown);
  const fm = { ...parsedFm, ...(cachedFrontmatter && typeof cachedFrontmatter === "object" ? cachedFrontmatter : {}) };

  const tagsRaw = Array.isArray(fm.tags) ? fm.tags : typeof fm.tags === "string" ? fm.tags.split(/[,\s]+/) : [];
  const tagsLower = tagsRaw.map((t) => cleanText(t).toLowerCase()).filter(Boolean);

  const publishKeyPresent = ["опублікувати подію", "Опублікувати подію", "event-publish", "publish-event"].some((k) =>
    Object.prototype.hasOwnProperty.call(fm, k),
  );
  const publishFlag =
    isTruthyFlag(fm["опублікувати подію"]) ||
    isTruthyFlag(fm["Опублікувати подію"]) ||
    isTruthyFlag(fm["event-publish"]) ||
    isTruthyFlag(fm["publish-event"]);

  const rawCopywriteProp = fm["event-copywrite"] ?? fm["event_copywrite"] ?? fm["copywrite"];
  const copywriteHeadingText = extractHeadingSection(body, ["event-copywrite", "event copywrite", "event_copywrite"]);

  const isEventNote = Boolean(
    tagsLower.some((t) => ["event", "events", "подія", "події", "івент"].includes(t)) ||
      publishKeyPresent ||
      rawCopywriteProp !== undefined ||
      fm["дата івенту"] !== undefined ||
      fm["event-start"] !== undefined ||
      fm["status-event"] !== undefined ||
      copywriteHeadingText,
  );

  const fileTitle = cleanText(fileName).replace(/\.md$/i, "");
  let title = cleanText(fm["event-name"] ?? fm["назва"] ?? fm["title"]);
  if (!title || isPlaceholderText(title)) title = extractFirstH1(body) || fileTitle || "Подія FlightClub";

  let copywriteWikilink = "";
  let copywrite = "";
  let copywriteSource = "none";
  let usedFallbackDescription = false;
  let copywriteMissing = false;

  if (Array.isArray(rawCopywriteProp)) {
    const joined = rawCopywriteProp.map((x) => cleanText(x)).filter((x) => x && !isPlaceholderText(x)).join("\n");
    if (joined) {
      copywrite = joined;
      copywriteSource = "frontmatter";
    }
  } else if (rawCopywriteProp != null && cleanText(rawCopywriteProp)) {
    const cwStr = cleanText(rawCopywriteProp);
    const wl = parseWikilinkTarget(cwStr);
    if (wl) {
      copywriteWikilink = wl;
      if (cleanText(resolvedCopywrite)) {
        copywrite = stripLeadingFrontmatter(resolvedCopywrite);
        copywriteSource = "wikilink";
      }
    } else if (!isPlaceholderText(cwStr)) {
      copywrite = cwStr;
      copywriteSource = "frontmatter";
    }
  }

  if (!copywrite && copywriteHeadingText && !isPlaceholderText(copywriteHeadingText)) {
    copywrite = copywriteHeadingText;
    copywriteSource = "heading";
  }

  if (!copywrite) {
    copywriteMissing = true;
    const fallbackDesc = cleanText(fm["опис"] ?? fm["description"]);
    if (fallbackDesc && !isPlaceholderText(fallbackDesc)) {
      copywrite = fallbackDesc;
      copywriteSource = "fallback_опис";
      usedFallbackDescription = true;
    }
  }

  const startIso = parseKyivDateTime(fm["event-start"] ?? fm["дата івенту"] ?? fm["event-date"] ?? fm["date"], 18, 0);
  const rawEndIso = parseKyivDateTime(fm["event-end"] ?? fm["дата завершення"], 20, 0);

  const eventType = cleanText(fm["подія-тип"] ?? fm["event-type"]);
  const defaultHours = /воркшоп|workshop/i.test(eventType) ? 3 : 2;
  let endIso = rawEndIso;
  if (startIso && (!endIso || new Date(endIso).getTime() <= new Date(startIso).getTime())) {
    const endDt = new Date(new Date(startIso).getTime() + defaultHours * 3600_000);
    const off = kyivOffsetMinutesAtUtcMs(endDt.getTime());
    const local = new Date(endDt.getTime() + off * 60_000);
    const pad = (n) => String(n).padStart(2, "0");
    endIso = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}${formatOffsetStr(off)}`;
  }

  const cityRaw = cleanText(fm["event-city"] ?? fm["місто"]);
  const city = isPlaceholderText(cityRaw) ? "" : cityRaw;
  const venueRaw = cleanText(fm["event-venue"] ?? fm["event-location"] ?? fm["місце"]);
  const venue = isPlaceholderText(venueRaw) ? "" : venueRaw;

  let location = "FlightClub";
  if (city && venue) {
    location = venue.toLowerCase().includes(city.toLowerCase()) ? venue : `${city}, ${venue}`;
  } else if (venue) {
    location = venue;
  } else if (city) {
    location = `${city}. Точна локація після реєстрації.`;
  }

  const formUrl = safeHttpsUrl(fm["event-form"] ?? fm["link - form"]);
  const siteUrl = safeHttpsUrl(fm["event-link"]) || safeHttpsUrl(fm["share_url"]) || safeHttpsUrl(fm["site_url"]);

  const existing = {
    gcalEventId: cleanText(fm["gcal-event-id"]),
    gcalLink: safeHttpsUrl(fm["gcal-link"]),
    discordEventId: cleanText(fm["discord-event-id"]),
    discordEventLink: safeHttpsUrl(fm["discord-event-link"]),
    siteEventId: cleanText(fm["fc-site-event-id"]),
    waEventStatus: cleanText(fm["wa-event-status"]),
    publishedAt: cleanText(fm["event-published-at"]),
    lastPublishHash: cleanText(fm["event-publish-hash"]),
  };

  const errors = [];
  const warnings = [];
  if (!title) errors.push("Вкажіть назву події.");
  if (!startIso) errors.push("Вкажіть коректну дату/час у полі «дата івенту» або «event-start».");
  if (copywriteMissing && !copywrite) warnings.push("Поле `event-copywrite` порожнє — додайте текст анонсу перед публікацією.");
  else if (usedFallbackDescription) warnings.push("Поле `event-copywrite` не заповнене — використано резервне поле «опис».");
  if (!venue && city) warnings.push(`Точна локація ще не вказана — використано «${location}».`);

  const publishHash = fnv1aHex(
    JSON.stringify({ title, description: copywrite, startIso, endIso, location, city, formUrl }),
  );
  const alreadyPublished = Boolean(existing.gcalEventId || existing.discordEventId || existing.siteEventId || existing.lastPublishHash);
  const hasChangesSincePublish = !alreadyPublished || existing.lastPublishHash !== publishHash;

  const calendarTemplateUrl = buildGoogleCalendarTemplateUrl({
    title,
    description: copywrite,
    startIso: startIso || "",
    endIso: endIso || "",
    location,
    formUrl,
    siteUrl,
  });

  return {
    isEventNote,
    publishFlag,
    valid: errors.length === 0,
    errors,
    warnings,
    copywriteSource,
    copywriteMissing,
    usedFallbackDescription,
    copywriteWikilink,
    alreadyPublished,
    hasChangesSincePublish,
    publishHash,
    calendarTemplateUrl,
    whenDisplay: formatKyivDisplayRange(startIso, endIso),
    event: {
      title,
      description: copywrite,
      startIso: startIso || "",
      endIso: endIso || "",
      city,
      venue,
      location,
      eventType,
      formUrl,
      siteUrl,
    },
    existing,
  };
}

module.exports = {
  buildGoogleCalendarTemplateUrl,
  extractFrontmatterAndBody,
  extractHeadingSection,
  formatKyivDisplayRange,
  isPlaceholderText,
  isTruthyFlag,
  parseEventPublishNote,
  parseKyivDateTime,
  parseWikilinkTarget,
};
