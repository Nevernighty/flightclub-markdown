"use strict";

const { prepareSync, confirmedBaseline, validPath, limit, inlineLimit, partSize } = require("./sync-plan.cjs");
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const same = (a, b) => a?.type === b?.type && a?.sha256 === b?.sha256 && a?.size === b?.size;

async function checksum(bytes) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(hash, value => value.toString(16).padStart(2, "0")).join("");
}

function encode(bytes) {
  const view = new Uint8Array(bytes);
  // Chunk on a three-byte boundary to avoid large temporary strings.
  const chunks = [];
  for (let i = 0; i < view.length; i += 24_576) {
    chunks.push(btoa(String.fromCharCode(...view.subarray(i, i + 24_576))));
  }
  return chunks.join("");
}

function createObsidianSync({ app, TFile, TFolder, requestUrl, origin, getToken, getState, saveState, getLocalRoot = () => "FlightClub Sync", getScope = () => null, isActive = () => true }) {
  function rootPath() {
    const state = getState();
    const legacy = state?.vaultId && (state.entries?.length || vault.getAllLoadedFiles().some(file =>
      file instanceof TFile && file.path.startsWith("FlightClub Sync/")));
    const root = state?.localRoot || (legacy ? "FlightClub Sync" : getLocalRoot());
    if (!validPath(root) || root === archive || root.startsWith(archive + "/")) throw new Error("Виберіть коректну папку FlightClub для синхронізації.");
    return root;
  }
  const archive = "FlightClub Sync Archive";
  const absolute = path => rootPath() + "/" + path;
  const vault = app.vault;
  const error = code => new Error({
    ACCESS_DENIED: "Підключіть чинний акаунт адміністратора або мініадміна FlightClub і повторіть перевірку.",
    NOT_ENROLLED: "Сервер ще використовує попередні правила доступу. Оновіть підключення після оновлення сайту.",
    SYNC_NOT_CONFIGURED: "На сервері FlightClub ще не налаштовано це сховище папок.",
    SYNC_SCOPE_MISCONFIGURED: "Адміністратор має перевірити окрему папку сховища команди на сервері.",
    SYNC_UNAVAILABLE: "Сховище папок тимчасово недоступне. Спробуйте перевірити його ще раз.",
    NETWORK: "З’єднання з FlightClub перервалось. Повторіть перевірку, щоб звірити останню версію.",
    NOT_FOUND: "Сайт ще не підтримує цю перевірку. Після оновлення сайту спробуйте ще раз.",
    VAULT_SIZE_LIMIT: "Сховище досягло ліміту 512 МіБ.",
    REVISION_CONFLICT: "Серверна версія змінилася. Створіть новий план.",
    COMMIT_BUSY: "Сервер завершує інше збереження. Повторіть перевірку.",
    INVALID_CANVAS: "Canvas ще не збережено як коректний JSON. Перевірте файл.",
  }[code] ?? "Синхронізацію зупинено. Оновіть план.");

  async function call(token, action, params = {}, body) {
    if (!isActive() || !token || token !== getToken()) throw error("ACCESS_DENIED");
    const scope = getScope();
    const search = new URLSearchParams({ sync: action, ...(scope ? { scope } : {}), ...params });
    let response;
    try {
      response = await requestUrl({ url: origin + "/m/obsidian-sync?" + search,
        method: body ? "POST" : "GET",
        headers: { Authorization: "Bearer " + token, ...(body ? { "Content-Type": typeof body === "string" ? "application/json" : "application/octet-stream" } : {}) },
        ...(body ? { body } : {}), throw: false });
    } catch {
      throw error("NETWORK");
    }
    if (!isActive() || token !== getToken() || scope !== getScope()) throw error("ACCESS_DENIED");
    if (response.status === 200 && action === "blob-v1") return response.arrayBuffer;
    let payload;
    try { payload = response.json; } catch { /* An upstream gateway may return HTML. */ }
    if (response.status !== 200) {
      const fallback = response.status === 403 || response.status === 401 ? "ACCESS_DENIED"
        : response.status === 404 ? "NOT_FOUND" : "NETWORK";
      throw error(payload?.code ?? fallback);
    }
    if (payload?.ok !== true) throw error();
    return payload;
  }

  async function status({ withRevision = false } = {}) {
    const response = await call(getToken(), "status-v1");
    if (!Number.isSafeInteger(response.files) || response.files < 0 || response.files > 5000
      || (response.revision !== null && !UUID.test(response.revision))) throw error();
    return {files:response.files,...withRevision ? {revision:response.revision} : {}};
  }

  async function descriptor(path, file = vault.getAbstractFileByPath(absolute(path))) {
    if (file instanceof TFolder) return { path, type: "folder" };
    if (!(file instanceof TFile)) return undefined;
    const max = /\.canvas$/i.test(path) ? inlineLimit : limit;
    if (file.stat.size > max) throw new Error("Файл перевищує ліміт " + max / 1024 / 1024 + " МіБ: " + path);
    const bytes = await vault.readBinary(file);
    if (bytes.byteLength > max) throw new Error("Файл перевищує ліміт " + max / 1024 / 1024 + " МіБ: " + path);
    return { path, type: "file", sha256: await checksum(bytes), size: bytes.byteLength };
  }

  async function snapshot() {
    const root = rootPath();
    const rootFile = vault.getAbstractFileByPath(root);
    if (!rootFile) return [];
    if (!(rootFile instanceof TFolder)) throw new Error("«" + root + "» зайнято файлом.");
    const rows = [];
    for (const file of vault.getAllLoadedFiles()) {
      if (!file.path.startsWith(root + "/")) continue;
      const path = file.path.slice(root.length + 1);
      if (path.split("/").some(segment => segment.startsWith("."))) continue;
      if (!validPath(path)) throw new Error("Непідтримувана назва: " + path);
      if (rows.length === 5000) throw new Error("У папці синхронізації понад 5000 записів.");
      rows.push(await descriptor(path, file));
    }
    return rows.sort((a, b) => a.path.localeCompare(b.path, "en"));
  }

  function noOpenNotes(path) {
    const target = absolute(path);
    for (const viewType of ["markdown", "canvas"]) {
      const open = app.workspace.getLeavesOfType(viewType).some(leaf => {
        const current = leaf.view?.file?.path;
        return current === target || current?.startsWith(target + "/");
      });
      if (open) throw new Error("Закрийте відкриту нотатку або Canvas: " + path);
    }
  }

  async function makeDir(path) {
    const existing = vault.getAbstractFileByPath(path);
    if (existing instanceof TFolder) return;
    if (existing) throw new Error("Папку займає інший файл: " + path);
    const parent = path.includes("/") ? path.slice(0,path.lastIndexOf("/")) : null;
    if (parent) await makeDir(parent);
    await vault.createFolder(path);
  }

  async function readImportFile(entry, paths) {
    let data = await entry.file.arrayBuffer();
    if (/\.canvas$/i.test(entry.path)) {
      let canvas;
      try { canvas = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)); }
      catch { throw error("INVALID_CANVAS"); }
      if (!canvas || !Array.isArray(canvas.nodes) || !Array.isArray(canvas.edges)) throw error("INVALID_CANVAS");
      let changed = false;
      const prefix = entry.path.split("/")[0] + "/";
      for (const node of canvas.nodes) {
        const field = node?.type === "file" ? "file" : node?.type === "group" ? "background" : null;
        const reference = field && node[field];
        if (typeof reference !== "string") continue;
        const destination = paths.has(prefix + reference) ? prefix + reference : paths.has(reference) ? reference : null;
        if (destination) {
          node[field] = absolute(destination);
          changed = true;
        }
      }
      if (changed) data = new TextEncoder().encode(JSON.stringify(canvas, null, 2) + "\n").buffer;
    }
    if (data.byteLength > (/\.canvas$/i.test(entry.path) ? inlineLimit : limit)) throw error("VAULT_SIZE_LIMIT");
    return data;
  }

  async function previewImport(selection) {
    const root = rootPath();
    const source = Array.from(selection);
    if (!source.length || source.length > 5000) throw new Error("Виберіть папку з кількістю файлів до 5000.");
    const rootFile = vault.getAbstractFileByPath(root);
    if (rootFile && !(rootFile instanceof TFolder)) throw new Error("«" + root + "» зайнято файлом.");
    const input = new Map(), entries = [], folders = new Set();
    const disk = new Map(vault.getAllLoadedFiles().filter(file => file.path.startsWith(root + "/"))
      .map(file => [file.path.toLowerCase(), file]));
    const mediaOrDocument = /\.(md|markdown|yml|yaml|canvas|txt|csv|json|pdf|png|jpe?g|webp|gif|avif|mp3|wav|ogg|m4a|mp4|webm)$/i;
    let skipped = 0;
    const addPath = (path, type) => {
      const key = path.toLowerCase();
      const previous = input.get(key);
      if (previous && (previous.path !== path || previous.type !== type || type === "file")) {
        throw new Error("У вибраній папці є несумісні назви: " + path);
      }
      const existing = disk.get(absolute(path).toLowerCase());
      if (existing && (existing.path !== absolute(path) || (type === "folder" ? !(existing instanceof TFolder) : !(existing instanceof TFile)))) {
        throw new Error("Шлях уже зайнято: " + path);
      }
      input.set(key, { path, type });
    };
    let originalRoot = null;
    for (const file of source) {
      const path = file.webkitRelativePath;
      if (typeof path !== "string" || !path.includes("/")) throw new Error("Виберіть цілу папку з розпакованої копії Drive.");
      const segments = path.split("/");
      originalRoot ??= segments[0];
      if (segments[0] !== originalRoot) throw new Error("Виберіть одну папку за раз.");
      if (segments.some(part => part.startsWith(".") || part === "__MACOSX") || !mediaOrDocument.test(path)) {
        skipped++;
        continue;
      }
      if (!validPath(path) || !Number.isSafeInteger(file.size) || file.size < 0
        || file.size > (/\.canvas$/i.test(path) ? inlineLimit : limit)) {
        throw new Error("Несумісний шлях або завеликий файл: " + path);
      }
      addPath(path, "file");
      for (let i = 1; i < segments.length; i++) {
        const folder = segments.slice(0, i).join("/");
        addPath(folder, "folder");
        folders.add(folder);
      }
      entries.push({ path, file });
    }
    if (!entries.length) throw new Error("У папці немає Markdown, YAML, Canvas або підтримуваних вкладень.");
    if (input.size > 5000) throw error("VAULT_SIZE_LIMIT");
    const paths = new Set(entries.map(entry => entry.path));
    let total = 0, unchanged = 0;
    for (const entry of entries) {
      const data = await readImportFile(entry, paths);
      entry.size = data.byteLength;
      entry.sha256 = await checksum(data);
      total += entry.size;
      if (total > 512 * 1024 * 1024) throw error("VAULT_SIZE_LIMIT");
      const existing = await descriptor(entry.path);
      if (existing) {
        if (!same(existing, { type: "file", size: entry.size, sha256: entry.sha256 })) {
          throw new Error("У Vault є інша версія: " + entry.path + ". Звірте файли перед імпортом.");
        }
        unchanged++;
      }
    }
    return { source, originalRoot, entries, folders: [...folders], paths, unchanged, skipped };
  }

  async function applyImport(plan) {
    const fresh = await previewImport(plan.source);
    if (JSON.stringify(fresh.entries.map(({ path, sha256 }) => [path, sha256]))
      !== JSON.stringify(plan.entries.map(({ path, sha256 }) => [path, sha256]))) throw error("REVISION_CONFLICT");
    await makeDir(rootPath());
    for (const folder of fresh.folders) await makeDir(absolute(folder));
    let added = 0;
    for (const entry of fresh.entries) {
      const content = await readImportFile(entry, fresh.paths);
      if (await checksum(content) !== entry.sha256) throw error("REVISION_CONFLICT");
      const existing = await descriptor(entry.path);
      if (existing) {
        if (!same(existing, { type: "file", size: entry.size, sha256: entry.sha256 })) throw error("REVISION_CONFLICT");
        continue;
      }
      await vault.createBinary(absolute(entry.path), content);
      added++;
    }
    return { added, unchanged: fresh.entries.length - added };
  }

  async function inspect() {
    const token = getToken(), scope = getScope();
    const remote = await call(token, "manifest-v1");
    if (remote.revision !== null && !UUID.test(remote.revision)) throw error();
    if (!UUID.test(remote.vaultId) || !Array.isArray(remote.entries) || remote.entries.some(entry => !UUID.test(entry?.id))
      || new Set(remote.entries.map(entry => entry.id)).size !== remote.entries.length) throw error();
    const state = getState();
    if (state?.vaultId && state.vaultId !== remote.vaultId) throw new Error("Серверне сховище змінилося. Потрібна звірка прив’язки.");
    const local = await snapshot();
    const baseline = state?.entries ?? [];
    return { token, scope, localRoot: rootPath(), vaultId: remote.vaultId, revision: remote.revision, local, ...prepareSync(baseline, local, remote.entries) };
  }

  async function apply(plan, { automatic = false, allowPush = true, confirmedBy = null } = {}) {
    if (!automatic && plan.conflicts.length) throw new Error("Розв’яжіть конфлікти, перш ніж застосовувати синхронізацію.");
    const fresh = await inspect();
    if (fresh.token !== plan.token || fresh.scope !== plan.scope || fresh.localRoot !== plan.localRoot || fresh.vaultId !== plan.vaultId || fresh.revision !== plan.revision
      || JSON.stringify(fresh.local) !== JSON.stringify(plan.local)) throw error("REVISION_CONFLICT");
    const blocked = new Set(fresh.conflicts);
    let waitingForEditor = 0;
    const touches = (path, boundary) => path === boundary || path.startsWith(boundary + "/") || boundary.startsWith(path + "/");
    if (automatic) {
      for (const operation of fresh.pull) {
        try { noOpenNotes(operation.path); }
        catch { blocked.add(operation.path); waitingForEditor++; }
      }
      for (const operation of fresh.push) {
        if (operation.action === "remove" || operation.action === "move") {
          blocked.add(operation.path);
          if (operation.to) blocked.add(operation.to);
        }
      }
      const safe = operation => ![...blocked].some(path => touches(operation.path,path) || operation.to && touches(operation.to,path));
      fresh.pull = fresh.pull.filter(safe);
      fresh.push = allowPush ? fresh.push.filter(safe) : [];
    }
    if (fresh.pull.length) await makeDir(rootPath());
    const backup = archive + "/" + crypto.randomUUID();
    const archiveFile = async (path, file) => {
      await makeDir(archive);
      await makeDir(backup);
      // Unique operation directory keeps prior copies outside the shared root.
      await vault.rename(file, backup + "/" + crypto.randomUUID() + "-" + path.split("/").at(-1));
    };
    for (const op of fresh.pull) {
      if (!isActive() || fresh.token !== getToken() || fresh.scope !== getScope() || fresh.localRoot !== rootPath()) throw error("ACCESS_DENIED");
      const disk = vault.getAbstractFileByPath(absolute(op.path));
      if (op.action === "move") {
        noOpenNotes(op.path);
        const actual = (await snapshot()).filter(row => row.path === op.path || row.path.startsWith(op.path + "/"));
        const expected = new Map(op.before.map(row => [row.path, row]));
        if (!disk || actual.length !== expected.size || actual.some(row => !same(row, expected.get(row.path)))
          || vault.getAbstractFileByPath(absolute(op.to))) throw error("REVISION_CONFLICT");
        await vault.rename(disk, absolute(op.to));
        continue;
      }
      if (!same(await descriptor(op.path, disk), op.before)) throw error("REVISION_CONFLICT");
      if (op.action === "folder") await makeDir(absolute(op.path));
      if (op.action === "file") {
        noOpenNotes(op.path);
        const bytes = await call(fresh.token, "blob-v1", { revision: fresh.revision, path: op.path });
        noOpenNotes(op.path);
        if (bytes.byteLength !== op.next.size || await checksum(bytes) !== op.next.sha256
          || !same(await descriptor(op.path), op.before)) throw error("REVISION_CONFLICT");
        if (disk) {
          // Preserve the preimage without moving the existing linked note.
          await makeDir(archive);
          await makeDir(backup);
          await vault.createBinary(backup + "/" + crypto.randomUUID() + "-" + disk.name, await vault.readBinary(disk));
          if (!same(await descriptor(op.path), op.before)) throw error("REVISION_CONFLICT");
          noOpenNotes(op.path);
          if(!isActive() || fresh.token!==getToken() || fresh.scope!==getScope())throw error("ACCESS_DENIED");
          await vault.modifyBinary(disk, bytes);
        } else await vault.createBinary(absolute(op.path), bytes);
      }
      if (op.action === "remove") {
        noOpenNotes(op.path);
        if (disk instanceof TFolder && disk.children.length) throw error("REVISION_CONFLICT");
        if (!disk) throw error("REVISION_CONFLICT");
        await archiveFile(op.path, disk);
      }
    }
    let revision = fresh.revision, batch = [], batchBytes = 0;
    const flush = async () => {
      if (!batch.length) return;
      if (fresh.scope !== getScope()) throw error("ACCESS_DENIED");
      const payload = JSON.stringify({ baseRevision: revision, operationId: crypto.randomUUID(), operations: batch });
      const result = await call(fresh.token, "commit-v1", {}, payload);
      if (!UUID.test(result.revision)) throw error();
      revision = result.revision;
      batch = [];
      batchBytes = 0;
    };
    for (const op of fresh.push) {
      if (fresh.scope !== getScope()) throw error("ACCESS_DENIED");
      const size = op.action === "file" && op.next.size <= inlineLimit ? op.next.size : 0;
      if (batch.length >= 100 || batchBytes + size > inlineLimit) await flush();
      let operation;
      if (op.action === "move") {
        const inTree = row => row.path === op.to || row.path.startsWith(op.to + "/");
        const expected = new Map(fresh.local.filter(inTree).map(row => [row.path, row]));
        const next = (await snapshot()).filter(inTree);
        if (await descriptor(op.path) || next.length !== expected.size || next.some(row => !same(row, expected.get(row.path)))) throw error("REVISION_CONFLICT");
        operation = { action: "move", path: op.path, to: op.to };
      } else {
        if (!same(await descriptor(op.path), op.next)) throw error("REVISION_CONFLICT");
        operation = { action: op.action, path: op.path };
        if (op.action === "file") {
          const bytes = await vault.readBinary(vault.getAbstractFileByPath(absolute(op.path)));
          if (bytes.byteLength !== op.next.size || await checksum(bytes) !== op.next.sha256) throw error("REVISION_CONFLICT");
          if (bytes.byteLength > inlineLimit) {
            const identity = { sha256: op.next.sha256, size: String(op.next.size) };
            let complete = false;
            for (let offset = 0; offset < bytes.byteLength && !complete; offset += partSize) {
              const staged = await call(fresh.token, "stage-blob-v1", { ...identity, part: String(offset / partSize) }, bytes.slice(offset, offset + partSize));
              if (staged.sha256 !== op.next.sha256 || staged.size !== op.next.size || typeof staged.complete !== "boolean") throw error();
              complete = staged.complete;
            }
            if (!complete) throw error();
            operation.sha256 = op.next.sha256;
            operation.size = op.next.size;
          } else operation.content = encode(bytes);
        }
      }
      batch.push(operation);
      batchBytes += size;
    }
    await flush();
    const remote = await call(fresh.token, "manifest-v1");
    if (remote.revision !== revision || remote.vaultId !== fresh.vaultId) throw error("REVISION_CONFLICT");
    const local = await snapshot();
    const reconciled = prepareSync(getState()?.entries ?? [], local, remote.entries);
    if (!automatic && (reconciled.conflicts.length || reconciled.push.length || reconciled.pull.length)) throw error("REVISION_CONFLICT");
    const confirmed = confirmedBaseline(local,remote.entries);
    const confirmedPaths = new Set(confirmed.map(entry => entry.path));
    const pendingPaths = [...reconciled.conflicts,...reconciled.pull.flatMap(op=>op.to ? [op.path,op.to] : [op.path]),
      ...reconciled.push.flatMap(op=>op.to ? [op.path,op.to] : [op.path])];
    const retained = automatic ? (getState()?.entries ?? []).filter(entry =>
      !confirmedPaths.has(entry.path) && pendingPaths.some(path=>touches(entry.path,path))) : [];
    if (!isActive() || fresh.token !== getToken() || fresh.scope !== getScope() || fresh.localRoot !== rootPath()) throw error("ACCESS_DENIED");
    await saveState({ vaultId:remote.vaultId,localRoot:fresh.localRoot,entries:[...confirmed,...retained], publishUserId:confirmedBy ?? getState()?.publishUserId ?? null });
    return { pulled:fresh.pull.length,pushed:fresh.push.length,
      ...(automatic ? {revision,pending:new Set(pendingPaths).size,conflicts:reconciled.conflicts.length,waitingForEditor} : {}) };
  }
  return { status, inspect, apply, previewImport, applyImport, localRoot:rootPath };
}

module.exports = { createObsidianSync };
