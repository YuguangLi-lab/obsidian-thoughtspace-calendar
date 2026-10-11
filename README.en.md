# ThoughtSpace Calendar & Journal

A standalone Obsidian desktop plugin connecting daily and periodic notes, Markdown tasks, a sidebar calendar, and a large month/week calendar.

[中文详细介绍](README.md) · [Download](https://github.com/YuguangLi-lab/obsidian-thoughtspace-calendar/releases/latest) · [Issues](https://github.com/YuguangLi-lab/obsidian-thoughtspace-calendar/issues)

Source version: **1.4.3**. Available downloads are listed on [Releases](https://github.com/YuguangLi-lab/obsidian-thoughtspace-calendar/releases).

Version 1.4.3 improves keyboard continuity after timeline completion and quadrant reassignment, resolves focus ambiguity for tasks with identical titles, and refines the task UI at narrow widths. See [release notes](docs/RELEASE-1.4.3.md).

## Features

- Large calendar with a six-week month grid and a seven-day hourly week view.
- All-day events, overlapping lanes, and a selected-day agenda combining timed Markdown tasks with Apple events.
- Drag unfinished tasks from lists, quadrants, or the unscheduled tray into the calendar. Move tasks/events and resize their end in the week view, with 15-minute pointer snapping.
- A task scheduling dialog accepts exact minute values without snapping typed input.
- Create a linked event note or choose an existing Markdown note through native Obsidian search.
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

1. Download the complete `thoughtspace-calendar-<version>.zip` available on Releases.
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

Tasks stay in their source files. Date/time/priority actions preserve block references and verify the original line before writing. With **Tasks 7.2+** enabled, recurring items marked with `🔁`, `[repeat:: …]` or `(repeat:: …)` can be completed through the [official Tasks API](https://github.com/obsidian-tasks-group/obsidian-tasks/blob/main/docs/Advanced/Tasks%20Api.md). Tasks controls recurrence generation and ordering; undo checks the complete changed span. Without that API, recurring checkboxes remain disabled. Ordinary tasks keep their existing completion behavior. Unsupported custom checkbox statuses or deletion results are rejected with guidance to use the original note. This is not complete Tasks-specification support. Before writing, the integration verifies that the next occurrence was actually generated before writing; a missing global filter, invalid rule or format mismatch cannot silently finish the task. A single completed row can also mean a finite rule ended; because the public API does not distinguish these cases, finish such a task in its source note. Dataview dates and priority are indexed and retained during scheduling. Version 1.4.2 blocks a stale calendar checkbox while a change made by Tasks is awaiting indexing, including undated recurrences whose next occurrence has identical text. Refreshing then allows normal interaction.

Dropping on a date changes the scheduled date and keeps the existing time. Dropping on the week grid sets time while retaining a known duration, or uses 30 minutes by default. A distinct deadline remains a reminder instead of a second draggable time block. Tasks remain within one day; ranges stop at 23:59.

The selected-day agenda offers a mixed timeline, untimed daily tasks, completed items, and an unscheduled tray. Scheduling a Markdown task writes its original line; it does **not** create an Apple event.

## Apple Calendar

Connect explicitly from the plugin settings or the large-calendar connection dialog. Grant system full calendar access, choose visible calendars, and select a writable default. Loading the plugin alone never requests permission; an empty visible-calendar selection means none.

Supported fields: title, start/end, all-day, calendar, location, and full notes. Read-only calendars are view-only. Repeating events are updated for the current occurrence. A revision check preserves the draft on conflicts; uncertain saves are not retried automatically.

Only the first-day segment of a multi-day event can be dragged to move it; its final segment can be resized in the week view. All-day events move between dates or all-day areas, not into hourly slots. Read-only events cannot be moved or resized.

Event-note links use the native list property `thoughtspace-calendar-events`. Links stay in Markdown and follow native note renames. Creating a note or linking an existing one does not upload note contents or vault paths to Apple. Initial note dates are a creation-time snapshot; event edits do not rewrite its body.

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

Node.js 22+ is recommended. Version 1.4.2 passes 270 automated tests, 19 official Tasks API checks, 30 browser interaction checks, 36 native Tasks integration checks, and 36 general native workflow checks. This iteration also installs and enables official Tasks 8.5.0 in a dedicated test vault, exercising real file writes, the Tasks index, recurrence, undo, and task controls in the list, quadrants, timeline, and large calendar. See the [1.4.2 verification report](qa/RELEASE-VERIFY-1.4.2.json) for results and scope. Task mutations now coalesce index notifications, unchanged scans avoid repainting, and list updates preserve keyboard focus. The [1.4.1 report](qa/RELEASE-VERIFY-1.4.1.json) remains available as the earlier isolated API baseline. No real Apple event writes were tested in this iteration. The [1.3.0 report](qa/RELEASE-VERIFY-1.3.0.json) is a historical baseline, not evidence for new interactions. CI does not access a personal calendar.

More detailed Chinese guides: [Usage](docs/USAGE.md), [Apple Calendar](docs/APPLE-CALENDAR.md), [Development](docs/DEVELOPMENT.md).

## License and acknowledgments

[MIT](LICENSE). Third-party licenses and references are recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), including lunar-typescript, Radix Colors, and Chinese Calendar. This is not an official Obsidian or Apple product.
