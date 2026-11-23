"use strict";
const MARKER = "\n\n<!-- fc:read-only -->\n\n";
const GENERATED_MARKER = "\n\n<!-- fc:generated -->\n\n";
const UUID_RE = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function extractPlatformLinkId(properties, kind) {
  if (!properties || typeof properties !== "object") return null;
  if (kind === "item" && typeof properties["item-link"] === "string") {
    const match = /[?&]item=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i.exec(properties["item-link"]);
    return match?.[1] ?? null;
  }
  if (kind === "event" && typeof properties["event-link"] === "string") {
    const match = /[?&]e=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i.exec(properties["event-link"]);
    return match?.[1] ?? null;
  }
  if (kind === "user" && typeof properties["user-link"] === "string") {
    const match = /\/u\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i.exec(properties["user-link"]);
    return match?.[1] ?? null;
  }
  return null;
}

function extractTechnicalId(details) {
  const match = /"id"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/i.exec(String(details ?? ""));
  return match?.[1] ?? null;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

/** The YAML parser is Obsidian's own parser in the native plugin. */
function readPlatformNote(content, {parseYaml,kind,id} = {}) {
  if (typeof content !== "string") throw new Error("Некоректний Markdown.");
  const source = content.replace(/^\uFEFF/, "").replace(/\r\n/g,"\n");
  const modern = source.startsWith("---\n");
  const parts = source.split(modern ? GENERATED_MARKER : MARKER);
  if (parts.length !== 2) throw new Error("Відновіть межу захищених даних із сайту.");
  let editable = parts[0], properties = null, format = 1;
  if (modern) {
    const end = editable.indexOf("\n---\n",4);
    if (end < 0 || typeof parseYaml !== "function") throw new Error("Не вдалося прочитати властивості Obsidian.");
    properties = parseYaml(editable.slice(4,end));
    if (!properties || Array.isArray(properties) || typeof properties !== "object") {
      throw new Error("Ідентифікатор або тип нотатки не збігається з прив’язкою сайту.");
    }
    if (properties["fc-schema"] === 2) {
      if (properties["fc-kind"] !== kind || properties["fc-id"] !== id) {
        throw new Error("Ідентифікатор або тип нотатки не збігається з прив’язкою сайту.");
      }
      format = 2;
    } else {
      const tags = Array.isArray(properties.tags) ? properties.tags : [];
      const hasKindTag = tags.includes(kind) || (kind === "user" && tags.includes("person"));
      const linkId = extractPlatformLinkId(properties, kind);
      const techId = extractTechnicalId(parts[1]);
      if (!hasKindTag || !UUID_RE.test(linkId || "") || linkId !== id || (techId && techId !== id)) {
        throw new Error("Ідентифікатор або тип нотатки не збігається з прив’язкою сайту.");
      }
      format = 3;
    }
    editable = editable.slice(end+5).trimStart();
  }
  const firstLine = /^# ([^\n]+)\n*/.exec(editable);
  if (!firstLine) throw new Error("Збережіть заголовок нотатки після властивостей.");
  const heading = firstLine[1].trim();
  const propertyKey = kind === "item" ? "item-name" : kind === "event" ? "event-name" : "user-name";
  let propertyTitle = heading, protectedProperties = "";
  if (properties) {
    if (typeof properties[propertyKey] !== "string" || !properties[propertyKey].trim()) throw new Error("Укажіть назву у властивостях нотатки.");
    propertyTitle = properties[propertyKey].trim();
    const rest = {...properties};
    delete rest[propertyKey];
    protectedProperties = JSON.stringify(canonical(rest));
  }
  return {heading,propertyTitle,description:editable.slice(firstLine[0].length).trim(),
    details:parts[1],protectedProperties,format};
}

function platformEditableTitle(note, baseline) {
  if (note.format === 1) return note.heading;
  if (note.heading === note.propertyTitle) return note.heading;
  const headingChanged = note.heading !== baseline.heading;
  const propertyChanged = note.propertyTitle !== baseline.propertyTitle;
  if (!headingChanged && !propertyChanged) return baseline.title;
  if (!headingChanged) return note.propertyTitle;
  if (!propertyChanged) return note.heading;
  throw new Error("Назва у властивостях і заголовку різна. Узгодьте одну назву перед публікацією.");
}
module.exports = {readPlatformNote, platformEditableTitle};
