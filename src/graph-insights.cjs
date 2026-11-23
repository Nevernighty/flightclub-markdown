const GRAPH_MODES = {
  domains: "Напрями",
  funnel: "Воронка",
  hubs: "Осередки",
  timeline: "Дати",
  topics: "Теми",
};
const GRAPH_EXCLUSIONS = '-path:"FlightClub Sync Archive" -path:"FlightClub Platform/Приховані"';
const GRAPH_COLORS = [0x38bdf8, 0x34d399, 0xf59e0b, 0xa78bfa, 0xf472b6, 0x2dd4bf, 0xfb7185, 0x94a3b8];
const GRAPH_TAG = /^[\p{L}\p{N}_/-]{1,100}$/u;
const GRAPH_MONTH = /^\d{4}-(?:0[1-9]|1[0-2])$/;
const GRAPH_PAGE = 30;
const graphCount = new Intl.NumberFormat("uk-UA");
const graphMonth = new Intl.DateTimeFormat("uk-UA", { year: "numeric", month: "long", timeZone: "UTC" });

function monthTitle(month) {
  return GRAPH_MONTH.test(month) ? graphMonth.format(new Date(month + "-01T00:00:00Z")) : "Без дати";
}

function graphDate(record) {
  return record.dateInfo?.field === "mtime" ? null : record.dateInfo;
}

function graphFacets(records) {
  const topics = new Map(), months = new Map();
  for (const note of records) {
    for (const topic of note.topics) {
      if (GRAPH_TAG.test(topic)) topics.set(topic, (topics.get(topic) ?? 0) + 1);
    }
    const month = graphDate(note)?.ym ?? "";
    months.set(month, (months.get(month) ?? 0) + 1);
  }
  return {
    topics: [...topics].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "uk")),
    months: [...months].sort((a, b) => b[0].localeCompare(a[0])),
  };
}

function graphMonthQuery(month) {
  if (!GRAPH_MONTH.test(month)) return "";
  const [year, twoDigits] = month.split("-");
  const number = twoDigits.startsWith("0") ? "0?" + Number(twoDigits) : twoDigits;
  const separator = "\\x2f";
  const pattern = [
    `${year}-${number}-[0-9]`,
    `[0-9]{1,2}\\.${number}\\.${year}`,
    `^${number}${separator}[0-9]{1,2}${separator}${year}`,
    `^(?:1[3-9]|[23][0-9])${separator}${number}${separator}${year}`,
  ].join("|");
  const properties = FC_DATE_FM_PRIORITY.map(([key]) => `["${key}":/${pattern}/]`);
  return `(${[...properties, `file:/${pattern}/`].join(" OR ")})`;
}

function graphPresetChoices(records) {
  const { topics, months } = graphFacets(records);
  const group = (query, index) => ({ query, color: { a: 1, rgb: GRAPH_COLORS[index % GRAPH_COLORS.length] } });
  return {
    ...Object.fromEntries(["domains", "funnel", "hubs"].map((mode) => [
      mode,
      FC_GRAPH_CATEGORIZATIONS[mode].zones.map(({ query, rgb }) => ({ query, color: { a: 1, rgb } })),
    ])),
    topics: topics.slice(0, 12).map(([tag], index) => group(`tag:#${tag}`, index)),
    timeline: months.filter(([month]) => GRAPH_MONTH.test(month)).slice(0, 12)
      .map(([month], index) => group(graphMonthQuery(month), index)),
  };
}

function readGraphPreset(value) {
  if (!value || !Array.isArray(value.groups) || typeof value.before !== "string" || typeof value.applied !== "string") return null;
  return {
    before: value.before,
    applied: value.applied,
    groups: value.groups.slice(0, 12).filter((entry) => typeof entry?.query === "string" && Number.isInteger(entry.color?.rgb)),
  };
}

function graphObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

async function updateNativeGraph(plugin, groups, filter = "", open = false) {
  if (plugin.nativeGraphBusy) return { ok: false };
  plugin.nativeGraphBusy = true;
  try {
    const app = plugin.app;
    // Obsidian exposes global graph leaves, but its option editor is internal.
    const native = app.internalPlugins?.getPluginById?.("graph")?.instance;
    const adapter = app.vault?.adapter;
    const leaves = app.workspace?.getLeavesOfType?.("graph") ?? [];
    const path = `${app.vault?.configDir ?? ".obsidian"}/graph.json`;
    let current = native?.options;
    if (!graphObject(current)) {
      if (!adapter?.exists || !adapter?.read || !adapter?.write) throw new Error("Configuration unavailable");
      current = await adapter.exists(path) ? JSON.parse(await adapter.read(path)) : {};
      if (!graphObject(current)) throw new Error("Invalid native configuration");
    }
    const visible = leaves.includes(app.workspace?.activeLeaf) ? app.workspace.activeLeaf : leaves[0];
    const live = visible?.view?.dataEngine?.getOptions?.();
    if (graphObject(live)) current = { ...current, ...live };
    const previous = plugin.graphPreset;
    if (groups === null && !previous) return { ok: true, config: current };
    const search = typeof current.search === "string" ? current.search : "";
    const original = previous?.applied === search ? previous.before : search;
    const currentGroups = Array.isArray(current.colorGroups) ? current.colorGroups : [];
    const identity = (entry) => JSON.stringify([entry?.query, entry?.color?.rgb, entry?.color?.a]);
    const owned = new Set((previous?.groups ?? []).map(identity));
    const personal = currentGroups.filter((entry) => !owned.has(identity(entry)));
    const queries = new Set(personal.map((entry) => entry?.query));
    const added = (groups ?? []).filter((entry) => !queries.has(entry.query));
    const nextSearch = groups === null || original.includes(GRAPH_EXCLUSIONS)
      ? [original, groups === null ? "" : filter].filter(Boolean).join(" ")
      : [original && `(${original})`, GRAPH_EXCLUSIONS, filter].filter(Boolean).join(" ");
    const changes = { search: nextSearch, colorGroups: [...personal, ...added] };
    const config = { ...current, ...changes };
    if (typeof native?.plugin?.saveData === "function") await native.plugin.saveData(config);
    else if (typeof adapter?.write === "function") await adapter.write(path, JSON.stringify(config, null, 2));
    else throw new Error("Native settings unavailable");
    if (native) native.options = config;
    plugin.graphPreset = groups === null ? null : { before: original, applied: nextSearch, groups: added };
    if (plugin.alive && typeof plugin.persist === "function") {
      try { await plugin.persist(); } catch { new Notice("Не вдалося зберегти дані для відновлення після перезапуску."); }
    }
    let refreshNeeded = false;
    for (const leaf of leaves) {
      try {
        const engine = leaf.view?.dataEngine;
        if (typeof engine?.setOptions === "function") {
          engine.setOptions(changes);
          engine.requestUpdateSearch?.run?.();
        } else refreshNeeded = true;
      } catch { refreshNeeded = true; }
    }
    if (open) {
      if (leaves[0]) app.workspace?.revealLeaf?.(leaves[0]);
      else if (app.commands?.executeCommandById?.("graph:open") === false) {
        new Notice("Увімкніть Graph View у вбудованих плагінах Obsidian.");
      }
    }
    if (refreshNeeded) new Notice("Групи збережено. Перевідкрийте вкладку графа, щоб оновити вигляд.");
    return { ok: true, config };
  } catch {
    new Notice("Не вдалося змінити групи графа. Перевірте налаштування Graph View.");
    return { ok: false };
  } finally {
    plugin.nativeGraphBusy = false;
  }
}

function graphRows(records, mode, facets) {
  if (mode === "topics") {
    return facets.topics.slice(0, 12).map(([id, count], index) =>
      ({ id, count, label: `#${id}`, color: GRAPH_COLORS[index % GRAPH_COLORS.length], query: `tag:#${id}` }));
  }
  if (mode === "timeline") {
    return facets.months.slice(0, 12).map(([id, count], index) =>
      ({ id, count, label: monthTitle(id), color: GRAPH_COLORS[index % GRAPH_COLORS.length], query: graphMonthQuery(id) }));
  }
  const counts = new Map();
  for (const note of records) counts.set(note[mode], (counts.get(note[mode]) ?? 0) + 1);
  return FC_GRAPH_CATEGORIZATIONS[mode].zones.map(({ id, label, rgb, query }) =>
    ({ id, label, count: counts.get(id) ?? 0, color: rgb, query }));
}

function fcSeededRng(seed) {
  let a = Math.imul((Number(seed) || 1) >>> 0, 0x9e3779b1) ^ 0x85ebca6b;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickShowcaseSamples(members, count, seed, priorityScore) {
  const realNotes = members.filter((n) => n && n.kind !== "tag" && !/\.canvas$/i.test(String(n.path || "")));
  const pool = realNotes.length ? realNotes : members;
  if (!pool.length) return [];
  const sorted = [...pool].sort((a, b) => priorityScore(b) - priorityScore(a));
  const paths = new Set();
  const buckets = {
    person: [],
    item: [],
    event: [],
    note: [],
  };
  for (const node of sorted) {
    const path = String(node.path || node.id).replace(/\\/g, "/");
    if (paths.has(path)) continue;
    paths.add(path);
    const k = node.entityKind && Object.hasOwn(buckets, node.entityKind) ? node.entityKind : "note";
    buckets[k].push(node);
  }
  const orderKeys = ["person", "item", "note", "event"];
  if (seed > 0) {
    const rng = fcSeededRng(seed);
    for (const arr of [orderKeys, ...Object.values(buckets)]) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
    }
  }
  const picked = [];
  while (picked.length < count) {
    let added = false;
    for (const k of orderKeys) {
      const candidate = buckets[k].shift();
      if (candidate) {
        picked.push(candidate);
        added = true;
        if (picked.length >= count) break;
      }
    }
    if (!added) break;
  }
  return picked;
}

function buildObsidianZoneCanvas(model, { detailed = false, showcase = false, shuffleSeed = 0, maxPerZone = null, visibleIds = null } = {}) {
  const card = showcase
    ? { width: 420, height: 160, gap: 24, inset: 32, headerPadTop: 12, summaryHeight: 66, columns: 1 }
    : { width: 340, height: 176, gap: 32, inset: 48, headerPadTop: 28, summaryHeight: 0, columns: 3 };
  const colGap = showcase ? 180 : 200;
  const rowGap = showcase ? 260 : 320;
  const width = card.width * card.columns + card.gap * (card.columns - 1) + card.inset * 2;
  const limit = showcase ? (maxPerZone || 3) : maxPerZone || (detailed ? 60 : 9);
  const nodeDegree = new Map();
  for (const edge of model.edges || []) {
    nodeDegree.set(edge.source, (nodeDegree.get(edge.source) || 0) + 1);
    nodeDegree.set(edge.target, (nodeDegree.get(edge.target) || 0) + 1);
  }
  const priorityScore = (node) => {
    const p = String(node.path || "");
    const hubBonus = /(?:^|\/)(?:00[\s_]|index|sop|база)/iu.test(p) || /\.(?:base|canvas)$/iu.test(p) ? 100 : 0;
    const personBonus = node.kind === "person" || node.entityKind === "person" ? 6 : node.entityKind === "item" ? 5 : 0;
    return hubBonus + personBonus + (nodeDegree.get(node.id) || 0) * 4;
  };
  const zoneMap = new Map();
  for (const zone of model.zones) {
    const members = (model.byZone?.get(zone.id) || model.nodes.filter((node) => node.zoneId === zone.id))
      .filter((node) => node.kind !== "tag" && (!visibleIds || visibleIds.has(node.id)));
    if (!members.length) continue;
    const orderIdx = new Map(members.map((node, i) => [node.id, i]));
    let notes;
    if (showcase) {
      notes = pickShowcaseSamples(members, limit, shuffleSeed, priorityScore);
    } else {
      const ranked = [...members].sort((a, b) => (priorityScore(b) - priorityScore(a)) || ((orderIdx.get(a.id) ?? 0) - (orderIdx.get(b.id) ?? 0)));
      notes = ranked.slice(0, limit);
    }
    const rows = Math.ceil(notes.length / card.columns);
    const summarySpan = card.summaryHeight > 0 ? card.summaryHeight + card.gap : 0;
    const height = card.headerPadTop + summarySpan + rows * (card.height + card.gap) - card.gap + card.inset * 2;
    zoneMap.set(zone.id, { zone, members, notes, height });
  }
  const sectionRows = [];
  if (showcase && model.mode === "funnel") {
    const row1 = ["pending", "active", "done", "team"].map((id) => zoneMap.get(id)).filter(Boolean);
    const row1Ids = new Set(row1.map((s) => s.zone.id));
    const row2 = [...zoneMap.values()].filter((s) => !row1Ids.has(s.zone.id));
    if (row1.length) sectionRows.push(row1);
    if (row2.length) sectionRows.push(row2);
  } else {
    const allSections = [...zoneMap.values()];
    const perRow = showcase ? 4 : 3;
    for (let start = 0; start < allSections.length; start += perRow) {
      sectionRows.push(allSections.slice(start, start + perRow));
    }
  }

  let y = 0;
  const groups = [];
  const textCards = [];
  const zoneByNode = new Map();
  const notes = [];
  const index = new Map();
  for (const row of sectionRows) {
    row.forEach(({ zone, members, notes: shown, height }, column) => {
      const x = column * (width + colGap);
      for (const node of members) zoneByNode.set(node.id, zone.id);
      const count = shown.length === members.length ? String(shown.length) : `${shown.length} з ${members.length}`;
      groups.push({
        id: "fc-g-" + zone.id, type: "group", x, y, width, height,
        label: showcase ? zone.label : `${zone.label} · ${count}`,
        color: /^#[0-9a-f]{6}$/i.test(zone.color) ? zone.color : "5",
      });
      if (showcase) {
        textCards.push({
          id: "fc-t-" + zone.id,
          type: "text",
          text: `**Приклади:** ${shown.length} з ${members.length}`,
          x: x + card.inset,
          y: y + card.inset + card.headerPadTop,
          width: width - card.inset * 2,
          height: card.summaryHeight,
        });
      }
      const startY = y + card.inset + card.headerPadTop + (showcase ? card.summaryHeight + card.gap : 0);
      shown.forEach((node, offset) => {
        const id = "fc-n-" + notes.length;
        index.set(node.id, { id, zoneId: zone.id });
        notes.push({
          id, type: "file", file: node.path,
          x: x + card.inset + (offset % card.columns) * (card.width + card.gap),
          y: startY + Math.floor(offset / card.columns) * (card.height + card.gap),
          width: card.width, height: card.height,
        });
      });
    });
    y += Math.max(...row.map((section) => section.height)) + rowGap;
  }

  const edges = [];
  if (showcase) {
    const groupIds = new Set(groups.map((g) => g.id));
    if (model.mode === "funnel") {
      const funnelFlow = [
        ["pending", "active", "Далі"],
        ["active", "done", "Готово"],
        ["done", "team", "Команда"],
      ];
      for (const [fromZ, toZ, lbl] of funnelFlow) {
        const fg = "fc-g-" + fromZ;
        const tg = "fc-g-" + toZ;
        if (groupIds.has(fg) && groupIds.has(tg)) {
          edges.push({
            id: "fc-e-" + edges.length,
            fromNode: fg,
            fromSide: "right",
            toNode: tg,
            toSide: "left",
            toEnd: "arrow",
            label: lbl,
          });
        }
      }
    } else {
      const zoneLinks = new Map();
      for (const { source, target } of model.edges) {
        const sourceZone = zoneByNode.get(source), targetZone = zoneByNode.get(target);
        if (sourceZone && targetZone && sourceZone !== targetZone) {
          const [first, second] = [sourceZone, targetZone].sort();
          const key = first + ":" + second;
          const relation = zoneLinks.get(key) || { first, second, count: 0 };
          relation.count++;
          zoneLinks.set(key, relation);
        }
      }
      const top = [...zoneLinks.values()].sort((a, b) => b.count - a.count).slice(0, 4);
      for (const { first, second, count } of top) {
        edges.push({
          id: "fc-e-" + edges.length,
          fromNode: "fc-g-" + first,
          toNode: "fc-g-" + second,
          toEnd: "arrow",
          label: graphCount.format(count),
        });
      }
    }
    return { nodes: [...groups, ...textCards, ...notes], edges };
  }

  const degree = new Map();
  const zoneLinks = new Map();
  for (const { source, target } of model.edges) {
    const sourceZone = zoneByNode.get(source), targetZone = zoneByNode.get(target);
    if (!detailed && sourceZone && targetZone && sourceZone !== targetZone) {
      const [first, second] = [sourceZone, targetZone].sort();
      const key = first + ":" + second;
      const relation = zoneLinks.get(key) || { first, second, count: 0 };
      relation.count++;
      zoneLinks.set(key, relation);
      continue;
    }
    const from = index.get(source), to = index.get(target);
    if (!from || !to || from === to) continue;
    if (!detailed && (from.zoneId !== to.zoneId || (degree.get(source) ?? 0) >= 2 || (degree.get(target) ?? 0) >= 2)) continue;
    edges.push({ id: "fc-e-" + edges.length, fromNode: from.id, toNode: to.id, toEnd: "none" });
    degree.set(source, (degree.get(source) ?? 0) + 1);
    degree.set(target, (degree.get(target) ?? 0) + 1);
    if (edges.length >= 600) break;
  }
  const strongest = [...zoneLinks.values()].sort((a, b) => b.count - a.count).slice(0, 6);
  for (const { first, second, count } of strongest) {
    edges.push({
      id: "fc-e-" + edges.length, fromNode: "fc-g-" + first, toNode: "fc-g-" + second,
      toEnd: "none", label: graphCount.format(count),
    });
  }
  return { nodes: [...groups, ...notes], edges };
}

function renderGraphInsights(plugin, container, { expanded = false, initialMode, onNavigate } = {}) {
  const wrap = container.createDiv({ cls: expanded ? "fc-insights" : "fc-insights is-compact" });
  const savedMode = initialMode ?? plugin.zoneGraphMode;
  const startMode = Object.hasOwn(GRAPH_MODES, savedMode) ? savedMode : "domains";

  if (expanded) {
    const zoneCtrl = typeof plugin.renderZoneGraphPanel === "function"
      ? plugin.renderZoneGraphPanel(wrap, {
          expanded: true,
          isTabView: true,
          initialMode: startMode,
          onCloseModal: onNavigate,
          showNativeActions: true,
        })
      : null;
    return zoneCtrl || { destroy() {} };
  }

  const controls = wrap.createDiv({ cls: "fc-insights-controls" });
  const modeLabel = controls.createEl("label", { text: "Групувати за" });
  const select = modeLabel.createEl("select");
  for (const [value, label] of Object.entries(GRAPH_MODES)) select.createEl("option", { text: label, attr: { value } });
  select.value = startMode;

  const overview = controls.createEl("button", { text: "Відкрити граф FlightClub", cls: "mod-cta", attr: { type: "button" } });
  overview.addEventListener("click", () => void plugin.activateZoneGraphView(select.value));

  const extras = controls.createEl("details", { cls: "fc-insights-extras" });
  extras.createEl("summary", { text: "Canvas і нативний граф" });
  const graphActions = extras.createDiv({ cls: "fc-insights-extra-actions" });
  const canvas = graphActions.createEl("button", { text: "Створити Canvas · Воронка", attr: { type: "button" } });
  canvas.addEventListener("click", async () => {
    canvas.disabled = true;
    try {
      await plugin.exportObsidianZoneCanvas(select.value, null, { showcase: true, shuffleSeed: 0, replaceLatest: true });
    } finally {
      canvas.disabled = false;
    }
  });
  const shuffleCanvas = graphActions.createEl("button", { text: "🔀 Шафл прикладів", attr: { type: "button" } });
  shuffleCanvas.addEventListener("click", async () => {
    shuffleCanvas.disabled = true;
    try {
      await plugin.exportObsidianZoneCanvas(select.value, null, {
        showcase: true,
        shuffle: true,
        replaceLatest: true,
      });
    } finally {
      shuffleCanvas.disabled = false;
    }
  });
  const apply = graphActions.createEl("button", { text: "Застосувати групи в Obsidian", attr: { type: "button" } });
  const restore = graphActions.createEl("button", { text: "Прибрати групи FlightClub", attr: { type: "button" } });
  restore.hidden = !plugin.graphPreset;
  const status = wrap.createEl("p", { cls: "fc-insights-status", attr: { role: "status", "aria-live": "polite" } });
  let records = null;
  let destroyed = false;
  // Single source of truth: pass withLinks=true so funnelIndex and derived tags match the Canvas graph.
  const collect = () => (records ??= plugin.collectObsidianGraphNotes(true).rawRecords);
  async function changeGraph(remove) {
    apply.disabled = restore.disabled = true;
    try {
      const mode = select.value;
      const result = remove
        ? await updateNativeGraph(plugin, null)
        : await plugin.applyNativeObsidianGraphPreset(mode, true, "", collect());
      if (destroyed) return;
      restore.hidden = !plugin.graphPreset;
      status.setText(result.ok ? (remove ? "Групи FlightClub прибрано." : "Групи застосовано.") : "Граф не оновлено.");
      if (result.ok && !remove) onNavigate?.();
    } finally {
      if (!destroyed) apply.disabled = restore.disabled = false;
    }
  }
  apply.addEventListener("click", () => void changeGraph(false));
  restore.addEventListener("click", () => void changeGraph(true));
  return { destroy: () => { destroyed = true; } };
}
