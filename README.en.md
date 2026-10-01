# ThoughtSpace Calendar & Journal

A standalone Obsidian desktop plugin connecting daily and periodic notes, Markdown tasks, a sidebar calendar, and a large month/week calendar.

[中文详细介绍](README.md) · [Download](https://github.com/YuguangLi-lab/obsidian-thoughtspace-calendar/releases/latest) · [Issues](https://github.com/YuguangLi-lab/obsidian-thoughtspace-calendar/issues)

## Features

- Large calendar with a six-week month grid and a seven-day hourly week view.
- All-day events, overlapping event lanes, scheduled Markdown tasks, and a selected-day agenda.
- Separate sidebar calendar and journal views; daily, weekly, monthly, quarterly, and yearly notes.
- Offline Chinese lunar dates, festivals, solar terms, and built-in mainland holiday/workday data through 2026.
- Daily note folders by year/month; reuse existing root-level notes and optional backed-up filing.
- Links to notes created on the selected day, quick Markdown capture, and native note editing.
- Task lists with search, tags, date scopes, sorting, grouping, time scheduling, source navigation, and undo.
- Fixed 2×2 Eisenhower quadrants, including in narrow sidebars; drag tasks to classify them.
- A daily timeline with timed items, conflicts, and free gaps.
- Obsidian theme/font integration and pane-width-based layouts.
- Experimental Apple Calendar read/create/update integration on macOS 14+ using EventKit.

![Month view with synthetic demo data](docs/images/month.png)

The screenshot is an isolated UI test preview with synthetic events, not proof of real calendar synchronization.

## Install

Obsidian desktop 1.6.0+ is declared in the manifest. Mobile is not supported. Apple Calendar requires macOS 14+ on Apple Silicon or Intel. Core Windows/Linux behavior has not undergone native validation.

1. Download `thoughtspace-calendar-1.3.0.zip` from the latest Release.
2. Extract it into `.obsidian/plugins/thoughtspace-calendar/` inside your vault.
3. Keep `manifest.json` directly inside that folder and retain the complete `native/` app bundle.
4. Enable **ThoughtSpace 日历与日记** in Community plugins. Reload after updating.

The three standalone runtime assets do not include the Apple Calendar helper. Download the complete ZIP when using Apple Calendar. This project is distributed through GitHub Releases and does not claim Community plugin listing approval.

When updating, preserve `data.json` and other personal files. The source installer backs up existing files and checks hashes before promotion:

```sh
node scripts/install.mjs '/path/to/your/vault'
```

The installer requires an existing valid `.obsidian/community-plugins.json`. ThoughtSpace whiteboard 0.94.0+ is needed if both plugins are enabled.

## Markdown tasks

```markdown
- [ ] 09:00 - 10:00 Draft proposal ⏳ 2026-10-01 ⏫ #work
- [ ] Review notes 📅 2026-10-03
- [x] Finish weekly review ✅ 2026-10-01
```

Tasks stay in their source files. Date/time/priority actions preserve block references and verify the original line before writing. Recurring Tasks-plugin items are not completed here; use the original note and Tasks to retain recurrence behavior. This plugin does not implement the complete Tasks specification.

## Apple Calendar

Connect explicitly from the plugin settings or the large-calendar connection dialog. Grant system full calendar access, choose visible calendars, and select a writable default. Loading the plugin alone never requests permission; an empty visible-calendar selection means none.

Supported fields: title, start/end, all-day, calendar, location, and full notes. Read-only calendars are view-only. Repeating events are updated for the current occurrence. A revision check preserves the draft on conflicts; uncertain saves are not retried automatically.

External changes appear on manual refresh, window focus, or the visible-page refresh timer. Cloud synchronization belongs to macOS Calendar, not this plugin. Deletion, reminders, recurrence-rule editing, instant push sync, and automatic Markdown-task conversion are not included.

The universal helper is ad-hoc signed, not Apple Developer ID notarized. Review and rebuild the Swift source if required by your system policy.

**Experimental:** native input validation, status calls, and fixture-based editor flows were tested. Real authorization, real event read/write roundtrips, and account cloud synchronization remain unverified.

## Development and validation

```sh
npm ci
npm run build
npm test
npm run build:native       # macOS + Xcode Command Line Tools
npx playwright install chromium
npm run test:browser
npm run package           # macOS
```

Node.js 22+ is recommended. The local 1.3.0 baseline passed 176 automated tests, 15 isolated browser checks, and 20 native Obsidian checks. Native editor checks used in-memory fixtures and did not write real calendar events. See the [public report](qa/RELEASE-VERIFY-1.3.0.json) and [test scope](docs/TESTING.md). CI does not access a personal calendar.

More detailed Chinese guides: [Usage](docs/USAGE.md), [Apple Calendar](docs/APPLE-CALENDAR.md), [Development](docs/DEVELOPMENT.md).

## License and acknowledgments

[MIT](LICENSE). Third-party licenses and references are recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), including lunar-typescript, Radix Colors, and Chinese Calendar. This is not an official Obsidian or Apple product.
