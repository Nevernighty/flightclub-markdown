# FlightClub Markdown

Obsidian community plugin for FlightClub teams and cadets (Desktop, Android, and iOS).

> **Account Required:** Syncing FlightClub documents, Drive folders, entity mentions, and live collaboration requires pairing an approved [FlightClub](https://flightclub.com.ua/about) account. Server-side RLS enforces strict role tiers (guests/quarantine receive no internal docs, cadets receive approved public/role docs without PII, MINIADMIN/ADMIN see non-OPSEC site data, and only ADMAX sees OPSEC members).

## Features

- **Two-way Google Drive sync (Drive primary):** Synchronizes Markdown notes, Canvas boards, `.base` views, and attachments with your authorized FlightClub Drive folder while preserving local conflict snapshots in `FlightClub Sync Archive/` when needed.
- **Live Markdown & Canvas collaboration:** Real-time presence, cursor sharing, and conflict resolution with human-readable Canvas card/group diffs and one-click merge.
- **Direct web links & mentions:** Clickable `[[user:...]]`, `[[item:...]]`, `[[event:...]]`, `[[m:...]]`, and `[[drive:...]]` references plus direct Google Docs and web editor links.
- **Knowledge base insights & graph presets:** Interactive 4-mode graph (`Physics`, `Roadmap`, `Zones`, `Gantt`) and native Obsidian graph color groups.
- **Team Plugins sync (Community Plugins):** ADMAX can curate a recommended list of installed team plugins (with optional sanitized `data.json` presets); teammates can review missing plugins and install them directly from Obsidian's official Community Plugins directory (`obsidian://show-plugin?id=...`).
- **Event publishing pipeline:** Authorized organizers can publish Obsidian event notes (using `опублікувати подію` and `event-copywrite`) to Google Calendar, Discord Scheduled Events, WhatsApp announcements, and the FlightClub schedule via authenticated `flightclub.com.ua` APIs.
- **YouTube embed blocks:** Renders clean `youtube` fenced blocks using Obsidian's native media renderer on click.

## Installation (Desktop & Mobile)

### Official Obsidian Community Plugins
1. Open **Settings → Community plugins** in Obsidian (or open [FlightClub Markdown in Community Plugins](https://community.obsidian.md/plugins/flightclub-markdown)).
2. Disable Restricted Mode if prompted, search for **FlightClub Markdown**, and click **Install** → **Enable**.
3. Open the **FlightClub** ribbon icon (or command **FlightClub Live Hub**) and click **Підключити акаунт** to pair your Obsidian device in your browser.

### Early Releases via BRAT
1. Install the **BRAT** community plugin in Obsidian.
2. Click **Add Beta plugin** and enter `Nevernighty/flightclub-markdown`.
3. Enable **FlightClub Markdown** and pair your FlightClub account.

## Building from Source

Requires Node.js 18+ (no external npm packages are needed to build the Community Plugins release):

```bash
npm ci
npm run build
npm run verify:compliance
```

This compiles `src/` into deterministic LF-normalized `main.js` and `styles.css` in the repository root.

## Network Use, External Services & Privacy Disclosure

- **FlightClub Backend (`https://flightclub.com.ua`):** All vault sync, role/ACL checks, OPSEC visibility filtering, live collaboration presence, mention lookups, and shared team plugin lists communicate solely with `https://flightclub.com.ua` over HTTPS using Obsidian's `requestUrl` API after you explicitly pair your device.
- **Official Obsidian Community Directory (`https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json`):** Queried read-only by ADMAX/team modals solely to match plugin IDs with their official Community Plugins metadata and open official `obsidian://show-plugin?id=...` listings.
- **Self-updating / Telemetry:** This plugin performs **no** telemetry or analytics tracking and does **not** self-update or download executable plugin code; updates are delivered exclusively via Obsidian's built-in Community Plugins updater and GitHub Releases.
- **Optional Plugin Settings Sharing:** Sharing a plugin's `data.json` preset is strictly opt-in per plugin by ADMAX; keys matching tokens, secrets, passwords, cookies, or API keys are automatically stripped prior to upload, and applying a shared preset locally creates a `data.json.fc-backup.json` backup first.
