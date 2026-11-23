"use strict";

function readCanvas(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const doc = JSON.parse(raw.replace(/^\uFEFF/, ""));
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
    const { nodes = [], edges = [] } = doc;
    for (const items of [nodes, edges]) {
      if (!Array.isArray(items) || items.some(item => !item || typeof item.id !== "string" || !item.id)) return null;
      if (new Set(items.map(item => item.id)).size !== items.length) return null;
    }
    const ids = new Set(nodes.map(node => node.id));
    if (edges.some(edge => !ids.has(edge.fromNode) || !ids.has(edge.toNode))) return null;
    return { ...doc, nodes, edges };
  } catch { return null; }
}

function stableJson(value) {
  return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}

const same = (a, b) => stableJson(a) === stableJson(b);
const serialize = value => JSON.stringify(value, null, 2) + "\n";

function canvasTextEquals(a, b) {
  if (a === b) return true;
  const left = readCanvas(a), right = readCanvas(b);
  return Boolean(left && right && same(left, right));
}

function mergeRecord(base, local, remote) {
  const fields = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
  const entries = [];
  for (const key of fields) {
    const bv = Object.hasOwn(base, key) ? base[key] : undefined;
    const lv = Object.hasOwn(local, key) ? local[key] : undefined;
    const rv = Object.hasOwn(remote, key) ? remote[key] : undefined;
    if (!same(lv, rv) && !same(lv, bv) && !same(rv, bv)) return null;
    const value = same(lv, bv) ? rv : lv;
    if (value !== undefined) entries.push([key, value]);
  }
  return Object.fromEntries(entries);
}

function mergeList(base, local, remote) {
  const asMap = list => new Map(list.map(item => [item.id, item]));
  const a = asMap(base), l = asMap(local), r = asMap(remote);
  const ids = new Set([...r.keys(), ...l.keys()]);
  const merged = new Map();
  for (const id of ids) {
    const before = a.get(id), left = l.get(id), right = r.get(id);
    if (same(left, right) || same(right, before)) {
      if (left) merged.set(id, left);
    } else if (same(left, before)) {
      if (right) merged.set(id, right);
    } else {
      if (!before || !left || !right) return null;
      const joined = mergeRecord(before, left, right);
      if (!joined) return null;
      merged.set(id, joined);
    }
  }
  const shared = id => a.has(id) && l.has(id) && r.has(id) && merged.has(id);
  const aOrder = [...a.keys()].filter(shared), lOrder = [...l.keys()].filter(shared), rOrder = [...r.keys()].filter(shared);
  const localReordered = !same(aOrder, lOrder), remoteReordered = !same(aOrder, rOrder);
  if (localReordered && remoteReordered && !same(lOrder, rOrder)) return null;
  const order = localReordered ? new Set([...l.keys(), ...r.keys()]) : ids;
  return [...order].map(id => merged.get(id)).filter(Boolean);
}

function mergeCanvasJsonText(baseRaw, localRaw, remoteRaw) {
  const local = readCanvas(localRaw), remote = readCanvas(remoteRaw);
  if (!local || !remote) return null;
  if (same(local, remote)) return remoteRaw;
  const base = readCanvas(baseRaw);
  if (!base) return null;
  if (same(local, base)) return remoteRaw;
  if (same(remote, base)) return localRaw;
  const { nodes: baseNodes, edges: baseEdges, ...baseMeta } = base;
  const { nodes: localNodes, edges: localEdges, ...localMeta } = local;
  const { nodes: remoteNodes, edges: remoteEdges, ...remoteMeta } = remote;
  const baseIds = new Set(baseNodes.map(node => node.id));
  const replacesBoard = nodes => baseIds.size > 0 && nodes.length > 0 && !nodes.some(node => baseIds.has(node.id));
  if (replacesBoard(localNodes) || replacesBoard(remoteNodes)) return null;
  const nodes = mergeList(baseNodes, localNodes, remoteNodes);
  const edges = mergeList(baseEdges, localEdges, remoteEdges);
  const meta = mergeRecord(baseMeta, localMeta, remoteMeta);
  if (!nodes || !edges || !meta) return null;
  const nodeIds = new Set(nodes.map(node => node.id));
  if (edges.some(edge => !nodeIds.has(edge.fromNode) || !nodeIds.has(edge.toNode))) return null;
  return serialize({ ...meta, nodes, edges });
}

function retainCanvasMedia(text, ...snapshots) {
  const doc = readCanvas(text);
  if (!doc) return text;
  const references = new Map();
  for (const raw of snapshots) {
    for (const node of readCanvas(raw)?.nodes ?? []) {
      if (node.type === "file" && typeof node.fc_media_url === "string") references.set(node.id, node);
    }
  }
  let changed = false;
  for (const node of doc.nodes) {
    const source = references.get(node.id);
    if (node.type !== "file" || node.fc_media_url || !source || source.file !== node.file) continue;
    node.fc_media_url = source.fc_media_url;
    changed = true;
  }
  return changed ? serialize(doc) : text;
}

function describeCanvasNode(node) {
  if (!node || typeof node !== "object") return "Елемент";
  if (node.type === "group") {
    const label = String(node.label || "").trim();
    return label ? `Група «${label.slice(0, 64)}»` : "Група без назви";
  }
  if (node.type === "file") {
    const fileName = String(node.file || "").split("/").pop() || "Файл";
    return `Файл: ${fileName.slice(0, 64)}`;
  }
  if (node.type === "link") {
    const rawUrl = String(node.url || "").trim();
    try {
      const u = new URL(rawUrl);
      return `Посилання: ${(u.hostname + u.pathname).slice(0, 64)}`;
    } catch {
      return rawUrl ? `Посилання: ${rawUrl.slice(0, 64)}` : "Посилання";
    }
  }
  const firstLine = String(node.text || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").replace(/[*_`>\[\]]/g, "").trim())
    .find(Boolean);
  return firstLine ? firstLine.slice(0, 72) : "Текстова картка";
}

function summarizeCanvasDiff(localRaw, remoteRaw, baseRaw = null) {
  const local = readCanvas(localRaw);
  const remote = readCanvas(remoteRaw);
  if (!local || !remote) return null;
  const base = baseRaw ? readCanvas(baseRaw) : null;
  const baseNodes = new Map((base?.nodes || []).map((n) => [n.id, n]));
  const localNodes = new Map(local.nodes.map((n) => [n.id, n]));
  const remoteNodes = new Map(remote.nodes.map((n) => [n.id, n]));

  const localOnly = [];
  const remoteOnly = [];
  const changedBoth = [];

  for (const [id, node] of localNodes) {
    if (!remoteNodes.has(id)) {
      localOnly.push({
        id,
        type: node.type || "text",
        label: describeCanvasNode(node),
        removedRemotely: baseNodes.has(id),
      });
    }
  }
  for (const [id, node] of remoteNodes) {
    if (!localNodes.has(id)) {
      remoteOnly.push({
        id,
        type: node.type || "text",
        label: describeCanvasNode(node),
        removedLocally: baseNodes.has(id),
      });
    }
  }
  for (const [id, lNode] of localNodes) {
    const rNode = remoteNodes.get(id);
    if (!rNode || same(lNode, rNode)) continue;
    const geomFields = new Set(["x", "y", "width", "height"]);
    const allKeys = new Set([...Object.keys(lNode), ...Object.keys(rNode)]);
    let contentChanged = false;
    let movedOnly = true;
    for (const k of allKeys) {
      if (!same(lNode[k], rNode[k])) {
        if (!geomFields.has(k)) {
          contentChanged = true;
          movedOnly = false;
        }
      }
    }
    changedBoth.push({
      id,
      type: lNode.type || rNode.type || "text",
      localLabel: describeCanvasNode(lNode),
      remoteLabel: describeCanvasNode(rNode),
      contentChanged,
      movedOnly,
    });
  }

  const localEdgeIds = new Set(local.edges.map((e) => e.id));
  const remoteEdgeIds = new Set(remote.edges.map((e) => e.id));
  let addedLocal = 0;
  let addedRemote = 0;
  for (const id of localEdgeIds) if (!remoteEdgeIds.has(id)) addedLocal++;
  for (const id of remoteEdgeIds) if (!localEdgeIds.has(id)) addedRemote++;

  const canSmartMerge = Boolean(mergeCanvasBestEffort(baseRaw, localRaw, remoteRaw, { prefer: "local" }));
  return {
    localCount: local.nodes.length,
    remoteCount: remote.nodes.length,
    localOnly,
    remoteOnly,
    changedBoth,
    edgesDelta: {
      localCount: local.edges.length,
      remoteCount: remote.edges.length,
      addedLocal,
      addedRemote,
    },
    canSmartMerge,
  };
}

function mergeRecordBestEffort(base, local, remote, prefer = "local") {
  const b = base && typeof base === "object" ? base : null;
  const l = local && typeof local === "object" ? local : {};
  const r = remote && typeof remote === "object" ? remote : {};
  const fields = new Set([...(b ? Object.keys(b) : []), ...Object.keys(l), ...Object.keys(r)]);
  const entries = [];
  for (const key of fields) {
    const bv = b && Object.hasOwn(b, key) ? b[key] : undefined;
    const lv = Object.hasOwn(l, key) ? l[key] : undefined;
    const rv = Object.hasOwn(r, key) ? r[key] : undefined;
    let value;
    if (same(lv, rv)) value = lv;
    else if (b && same(lv, bv)) value = rv;
    else if (b && same(rv, bv)) value = lv;
    else value = prefer === "remote" ? (rv !== undefined ? rv : lv) : (lv !== undefined ? lv : rv);
    if (value !== undefined) entries.push([key, value]);
  }
  return Object.fromEntries(entries);
}

function mergeCanvasBestEffort(baseRaw, localRaw, remoteRaw, { prefer = "local" } = {}) {
  const strictMerged = mergeCanvasJsonText(baseRaw, localRaw, remoteRaw);
  if (strictMerged) return retainCanvasMedia(strictMerged, localRaw, remoteRaw);
  const local = readCanvas(localRaw);
  const remote = readCanvas(remoteRaw);
  if (!local || !remote) return null;
  if (same(local, remote)) return retainCanvasMedia(localRaw, remoteRaw);
  const base = baseRaw ? readCanvas(baseRaw) : null;

  const baseNodes = new Map((base?.nodes || []).map((n) => [n.id, n]));
  const localNodes = new Map(local.nodes.map((n) => [n.id, n]));
  const remoteNodes = new Map(remote.nodes.map((n) => [n.id, n]));
  const orderedIds = prefer === "remote"
    ? new Set([...remoteNodes.keys(), ...localNodes.keys()])
    : new Set([...localNodes.keys(), ...remoteNodes.keys()]);

  const mergedNodes = [];
  for (const id of orderedIds) {
    const bNode = baseNodes.get(id);
    const lNode = localNodes.get(id);
    const rNode = remoteNodes.get(id);
    if (lNode && rNode) {
      mergedNodes.push(mergeRecordBestEffort(bNode, lNode, rNode, prefer));
    } else if (lNode) {
      if (bNode && same(lNode, bNode)) continue;
      mergedNodes.push(lNode);
    } else if (rNode) {
      if (bNode && same(rNode, bNode)) continue;
      mergedNodes.push(rNode);
    }
  }

  const nodeIds = new Set(mergedNodes.map((n) => n.id));
  const baseEdges = new Map((base?.edges || []).map((e) => [e.id, e]));
  const localEdges = new Map(local.edges.map((e) => [e.id, e]));
  const remoteEdges = new Map(remote.edges.map((e) => [e.id, e]));
  const orderedEdgeIds = prefer === "remote"
    ? new Set([...remoteEdges.keys(), ...localEdges.keys()])
    : new Set([...localEdges.keys(), ...remoteEdges.keys()]);

  const mergedEdges = [];
  for (const id of orderedEdgeIds) {
    const bEdge = baseEdges.get(id);
    const lEdge = localEdges.get(id);
    const rEdge = remoteEdges.get(id);
    let chosen = null;
    if (lEdge && rEdge) chosen = mergeRecordBestEffort(bEdge, lEdge, rEdge, prefer);
    else if (lEdge && !(bEdge && same(lEdge, bEdge))) chosen = lEdge;
    else if (rEdge && !(bEdge && same(rEdge, bEdge))) chosen = rEdge;
    if (chosen && nodeIds.has(chosen.fromNode) && nodeIds.has(chosen.toNode)) {
      mergedEdges.push(chosen);
    }
  }

  const { nodes: _bn, edges: _be, ...baseMeta } = base || {};
  const { nodes: _ln, edges: _le, ...localMeta } = local;
  const { nodes: _rn, edges: _re, ...remoteMeta } = remote;
  const meta = mergeRecordBestEffort(base ? baseMeta : null, localMeta, remoteMeta, prefer);
  return retainCanvasMedia(serialize({ ...meta, nodes: mergedNodes, edges: mergedEdges }), localRaw, remoteRaw);
}

module.exports = {
  readCanvas,
  canvasTextEquals,
  mergeCanvasJsonText,
  retainCanvasMedia,
  summarizeCanvasDiff,
  mergeCanvasBestEffort,
};
