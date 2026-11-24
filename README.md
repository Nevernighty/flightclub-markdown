# FlightClub Markdown

Obsidian community plugin for FlightClub teams and cadets (Desktop, Android, and iOS).

## What's New in 1.11.0

- **4-Mode Knowledge Graph & Timeline (`Physics` → `Roadmap` → `Zones` → `Gantt`):** Redesigned interactive top bar and adaptive panels with smooth node transitions, chronological **Roadmap** layout with live physics, **Zones** grouping, and full interactive **Gantt** view with subprojects and checkpoints.
- **UI & History Polish:** Fixed text clipping in **List (N)** and **Sync Archive** views, removed duplicate header labels, and added caching plus proper line wrapping in **Change History**.

## Features

- **4-Mode Graph, Roadmap, Zones, Gantt & Native Presets:** Interactive `Physics` → `Roadmap` (year-by-year chronology with physics) → `Zones` → `Gantt` explorer with smooth node transitions, plus one-click native Obsidian Graph color groups (domains, funnel, hubs, timeline).
- **Two-way Google Drive sync (Drive primary):** Synchronizes Markdown notes, Canvas boards, `.base` views, and attachments with your authorized FlightClub Drive folder while preserving local conflict snapshots in `FlightClub Sync Archive/` when needed.
- **Live Markdown & Canvas collaboration:** Real-time presence, cursor sharing, and conflict resolution with human-readable Canvas card/group diffs and one-click merge.
- **Direct web links & mentions:** Clickable `[[user:...]]`, `[[item:...]]`, `[[event:...]]`, `[[m:...]]`, and `[[drive:...]]` references plus direct Google Docs and web editor links.
- **Team Plugins sync (Community Plugins):** ADMAX can curate a recommended list of installed team plugins (with optional sanitized `data.json` presets); teammates can review missing plugins and install them directly from Obsidian's official Community Plugins directory (`obsidian://show-plugin?id=...`).
- **Event publishing pipeline:** Authorized organizers can publish Obsidian event notes (using `опублікувати подію` and `event-copywrite`) to Google Calendar, Discord Scheduled Events, WhatsApp announcements, and the FlightClub schedule via authenticated `flightclub.com.ua` APIs.
- **YouTube embed blocks:** Renders clean `youtube` fenced blocks using Obsidian's native media renderer on click.

## Installation (Desktop & Mobile)

1. Open **Settings → Community plugins** in Obsidian.
2. Disable Restricted Mode if prompted, then search for **FlightClub Markdown** and click **Install** → **Enable**.
3. Open the **FlightClub** ribbon icon (or command **FlightClub Live Hub**) and click **Підключити акаунт** to pair your Obsidian device in your browser.

Updates arrive automatically via **Settings → Community plugins → Check for updates** once published in the official directory. While the initial directory listing is being approved, you can also install and auto-update via **BRAT** using the repository `Nevernighty/flightclub-markdown`.

## Building from Source

Requires Node.js 18+ (no external npm packages are needed to build the Community Plugins release):

```bash
npm run build
npm run verify:compliance
```

This compiles `src/` into `main.js` and `styles.css` in the repository root.

## Network Use, External Services & Privacy Disclosure

- **Account Required:** Full vault sync, live collaboration, mentions, team plugin lists, and event publishing require an authorized FlightClub account paired via `https://flightclub.com.ua`.
- **FlightClub Backend (`https://flightclub.com.ua`):** All vault sync, role/ACL checks, live collaboration presence, mention lookups, and shared team plugin lists communicate solely with `https://flightclub.com.ua` over HTTPS using Obsidian's `requestUrl` API after you explicitly pair your device.
- **Official Obsidian Community Directory (`https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json`):** Queried read-only by ADMAX/team modals solely to match plugin IDs with their official Community Plugins metadata and open official `obsidian://show-plugin?id=...` listings.
- **Self-updating / Telemetry:** This plugin performs **no** telemetry or analytics tracking and does **not** self-update or download executable plugin code; updates are delivered exclusively via Obsidian's built-in Community Plugins updater and GitHub Releases.
- **Optional Plugin Settings Sharing:** Sharing a plugin's `data.json` preset is strictly opt-in per plugin by ADMAX; keys matching tokens, secrets, passwords, cookies, or API keys are automatically stripped prior to upload, and applying a shared preset locally creates a `data.json.fc-backup.json` backup first.
