"use strict";

const parentPath = path => path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
const depth = path => path.split("/").length;
const same = (a, b) => a?.type === b?.type && a?.sha256 === b?.sha256 && a?.size === b?.size;
const validHash = /^[a-f0-9]{64}$/;
const inlineLimit = 10 * 1024 * 1024;
const partSize = 8 * 1024 * 1024;
const limit = 64 * 1024 * 1024;

function validPath(value) {
  if (typeof value !== "string" || !value || value.length > 400 || value !== value.normalize("NFC")) return false;
  return value.split("/").every(part => part && part.length <= 160 && !part.startsWith(".")
    && !/[. ]$|[<>:"\\|?*\x00-\x1f\x7f]/u.test(part) && !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part));
}

function asMap(rows) {
  if (!Array.isArray(rows) || rows.length > 5000) throw new Error("Неповний список файлів Vault.");
  const entries = new Map(), folded = new Set();
  for (const entry of rows) {
    if (!entry || !validPath(entry.path) || folded.has(entry.path.toLowerCase())
      || (entry.type !== "folder" && (entry.type !== "file" || !validHash.test(entry.sha256)
        || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > limit))) {
      throw new Error("Vault містить несумісний шлях, розмір або дублікат назви.");
    }
    folded.add(entry.path.toLowerCase());
    entries.set(entry.path, entry);
  }
  for (const entry of rows) {
    const dir = parentPath(entry.path);
    if (dir && entries.get(dir)?.type !== "folder") throw new Error("Дерево Vault неповне.");
  }
  return entries;
}

function subset(map, path) {
  return [...map].filter(([key]) => key === path || key.startsWith(path + "/")).sort(([a], [b]) => a.localeCompare(b, "en"));
}

function moveEntries(map, from, to) {
  for (const [old, entry] of subset(map, from)) {
    const path = to + old.slice(from.length);
    map.delete(old);
    map.set(path, { ...entry, path });
  }
}

function prepareSync(agreed, localFiles, remoteFiles) {
  const base = asMap(agreed), local = asMap(localFiles), remote = asMap(remoteFiles);
  const pull = [], push = [], conflicts = [];
  const remoteById = new Map([...remote.values()].map(entry => [entry.id, entry]));
  const removed = [...base.values()].sort((a, b) => depth(a.path) - depth(b.path));
  for (const previous of removed) {
    if (!base.has(previous.path) || !previous.id) continue;
    const to = remoteById.get(previous.id)?.path;
    if (!to || to === previous.path || local.has(to) || remote.has(previous.path)) continue;
    const parent = parentPath(to);
    const original = subset(base, previous.path), onDisk = subset(local, previous.path);
    if (parent && !local.has(parent) || original.length !== onDisk.length || original.some(([key, entry]) => !same(entry, local.get(key)))) continue;
    pull.push({ action: "move", path: previous.path, to, before: original.map(([, entry]) => entry) });
    moveEntries(local, previous.path, to);
    moveEntries(base, previous.path, to);
  }
  const signature = (entry, map) => {
    if (entry.type === "file") return entry.sha256 + "/" + entry.size;
    const children = subset(map, entry.path).slice(1);
    if (!children.length) return null;
    return JSON.stringify(children.map(([key, child]) => [key.slice(entry.path.length), child.type, child.sha256, child.size]));
  };
  const beforeCounts = new Map(), afterCounts = new Map(), localNew = new Map();
  for (const entry of base.values()) {
    const key = signature(entry, base);
    beforeCounts.set(key, (beforeCounts.get(key) ?? 0) + 1);
  }
  for (const entry of local.values()) {
    const key = signature(entry, local);
    afterCounts.set(key, (afterCounts.get(key) ?? 0) + 1);
    if (key && !base.has(entry.path)) localNew.set(key, entry);
  }
  for (const entry of [...base.values()].sort((a, b) => depth(a.path) - depth(b.path))) {
    if (!base.has(entry.path)) continue;
    const key = signature(entry, base);
    const newEntry = localNew.get(key);
    if (!newEntry || beforeCounts.get(key) !== 1 || afterCounts.get(key) !== 1
      || local.has(entry.path) || remote.has(newEntry.path) || newEntry.path.startsWith(entry.path + "/")
      || parentPath(newEntry.path) && remote.get(parentPath(newEntry.path))?.type !== "folder") continue;
    const before = subset(base, entry.path);
    if (before.some(([path, item]) => !same(item, remote.get(path))) || subset(remote, entry.path).length !== before.length) continue;
    push.push({ action: "move", path: entry.path, to: newEntry.path });
    moveEntries(remote, entry.path, newEntry.path);
    moveEntries(base, entry.path, newEntry.path);
  }
  const queue = { pull: [], push: [] };
  const allPaths = new Set([...base.keys(), ...local.keys(), ...remote.keys()]);
  const folded = new Map();
  for (const path of allPaths) {
    const key = path.toLowerCase(), prior = folded.get(key);
    if (prior && prior !== path) { conflicts.push(path, prior); continue; }
    folded.set(key, path);
    const common = base.get(path), disk = local.get(path), server = remote.get(path);
    if (same(disk, server)) continue;
    const fromLocal = same(server, common), fromServer = same(disk, common);
    if (fromLocal === fromServer || disk && server && disk.type !== server.type) {
      conflicts.push(path);
      continue;
    }
    const next = fromLocal ? disk : server;
    const current = fromLocal ? server : disk;
    queue[fromLocal ? "push" : "pull"].push({ action: next?.type ?? "remove", path, next, before: current });
  }
  const sort = (a, b) => {
    const order = { folder: 0, file: 1, remove: 2 };
    return order[a.action] - order[b.action] || (a.action === "remove" ? depth(b.path) - depth(a.path) : depth(a.path) - depth(b.path));
  };
  for (const [target, current, list] of [["pull", local, pull], ["push", remote, push]]) {
    const planned = queue[target].sort(sort);
    const final = new Map(current);
    for (const op of planned) if (op.next) final.set(op.path, op.next); else final.delete(op.path);
    for (const entry of final.values()) {
      const dir = parentPath(entry.path);
      if (dir && final.get(dir)?.type !== "folder") conflicts.push(dir);
    }
    list.push(...planned);
  }
  return { pull, push, conflicts: [...new Set(conflicts)].sort() };
}

function confirmedBaseline(local, remote) {
  const disk = asMap(local);
  return [...asMap(remote).values()].filter(entry => same(entry, disk.get(entry.path)));
}
module.exports = { prepareSync, confirmedBaseline, validPath, limit, inlineLimit, partSize };
