const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const WATCH_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"]);
const EMBED_HOSTS = new Set(["youtube-nocookie.com", "www.youtube-nocookie.com"]);

export function parseMarkdownYouTube(source) {
  const [url, title = "", ...extra] = source.trim().split(/\r?\n/);
  const value = url.trim();
  if (extra.length || !/^https:\/\/[^\s\\]+$/i.test(value)) return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.username || parsed.password || parsed.port) return null;

  const path = parsed.pathname.replace(/\/$/, "");
  const [, format, pathId] = /^\/(shorts|live|embed)\/([^/]+)$/.exec(path) ?? [];
  let id = "";
  if (parsed.hostname === "youtu.be") id = /^\/([^/]+)$/.exec(path)?.[1] ?? "";
  if (WATCH_HOSTS.has(parsed.hostname)) id = path === "/watch" ? parsed.searchParams.get("v") ?? "" : pathId ?? "";
  if (EMBED_HOSTS.has(parsed.hostname) && format === "embed") id = pathId;
  if (!YOUTUBE_ID.test(id)) return null;

  const vertical = format === "shorts";
  return {
    id,
    vertical,
    title: title.trim().slice(0, 160) || "Відео YouTube",
    href: vertical ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`,
  };
}

function escapeVideoText(text) {
  return text.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char]);
}

export function renderMarkdownYouTube(source) {
  const video = parseMarkdownYouTube(source);
  if (!video) return '<p class="fc-md-video-error">Укажіть HTTPS-посилання на одне відео YouTube й назву окремим рядком за потреби.</p>';

  return `<figure class="fc-md-video${video.vertical ? " fc-md-video--vertical" : ""}" data-fc-md-video="${video.id}">
    <div class="fc-md-video-screen">
      <button type="button" class="fc-md-video-play" data-fc-md-video-play>
        <span class="fc-md-video-icon" aria-hidden="true"></span>
        <span class="fc-md-video-label">Відтворити відео</span>
        <span class="fc-md-video-title">${escapeVideoText(video.title)}</span>
      </button>
    </div>
    <figcaption class="fc-md-video-footer">
      <a href="${video.href}" target="_blank" rel="noopener noreferrer">Відкрити на YouTube <span aria-hidden="true">↗</span></a>
    </figcaption>
  </figure>`;
}

export function activateMarkdownYouTube(event) {
  const button = event.target?.closest?.("[data-fc-md-video-play]");
  const figure = button?.closest("[data-fc-md-video]");
  const screen = button?.parentElement;
  const id = figure?.dataset.fcMdVideo ?? "";
  if (!screen || !YOUTUBE_ID.test(id)) return;
  const frame = button.ownerDocument.createElement("iframe");
  frame.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&rel=0`;
  frame.title = button.querySelector(".fc-md-video-title")?.textContent ?? "Відео YouTube";
  frame.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
  frame.allowFullscreen = true;
  frame.referrerPolicy = "strict-origin-when-cross-origin";
  screen.replaceChildren(frame);
  frame.focus();
}
