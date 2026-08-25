# Tempotrack

> **built with ox alpha**
>
> most of this was written in august 2026 during the free preview window of
> [ox alpha](https://openrouter.ai/stealth/ox-alpha), an anonymous stealth model
> that turned up on openrouter for about a week. i set the direction and reviewed
> what came back. the tests are real and they pass — clone it and run them.

Tempotrack is a local-first time tracker that pairs a pomodoro timer with honest analytics about where your hours actually went, for freelancers and focused workers.

## Install

Requirements: Node.js 20.19+ (Node 24 tested).

```sh
npm install
npm run dev        # start the dev server, open the printed URL
```

Other commands:

```sh
npm test           # run the full test suite
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build locally
```

Generate a synthetic sample dataset to stdout (fictional projects only):

```sh
node scripts/generate-sample-data.ts > sample.json   # Node 22+ runs TS directly
```

## The timing model

All timing correctness lives in `src/core/`. No module calls the system clock directly; everything goes through an injectable `Clock` with two independent counters: a monotonic counter and wall time. Durations are computed as differences of these integers in UTC milliseconds — local time zones, DST transitions and midnight never touch a duration.

- **While running**, elapsed time comes from the monotonic counter and is committed to a persisted snapshot at every state change and at least every 10 seconds.
- **System clock changed backwards** while a session runs: monotonic time is unaffected, so the measured duration is unchanged. A negative duration is impossible by construction.
- **System clock jumped forwards** or the machine slept: wall time runs ahead of monotonic time beyond tolerance (`WALL_TOLERANCE_MS`, 2 s). The timer refuses to guess. It shows exactly what is trusted, what is contested, and asks you to keep the whole span, discard the away span, discard back to the away point, or move the span to another project. Nothing is counted silently.
- **Crash, force-quit or browser close** while running: the next launch restores the last checkpointed snapshot through the same reconciliation prompt.
- **Idle detection** observes input inside the Tempotrack window only (pointer, keys, scroll). After a configurable idle threshold it asks you to keep, remove, reassign, or stop-at-idle-start for the unattended stretch. It never looks at other applications, window titles, or any system-wide input.
- **Day attribution**: an entry belongs to the local calendar day containing its placement start. Durations are never split across midnight.

The suspend, clock-change, crash-recovery and DST behaviours are covered by deterministic tests in `tests/core/` using a manually advanced fake clock; no test touches the real system clock.

## Metric definitions

These definitions are implemented once in `src/analytics/` and are the single source of truth:

| Metric | Definition |
|---|---|
| Focused time | Sum of entry durations whose placement start falls on the day(s) in scope. |
| Billable time | Subset of focused time from entries marked billable. |
| Per-project / per-tag totals | Same sums grouped by entry project / by each attached tag (a multi-tagged entry counts under each tag). |
| Time-of-day heatmap | Average focused minutes per weekday × local-hour bucket: total minutes in the bucket divided by how many days of that weekday occur in the range. Empty cell = no data; buckets are never interpolated. |
| Pomodoro completion rate | Completed work intervals ÷ (completed + abandoned work intervals) from recorded phase events. Breaks do not enter the rate. Returns "—" when no work interval ended. |
| Abandoned work interval | A focus phase ended before its target, by stop or skip. |
| Average session length | Arithmetic mean duration over all entries in range, timed and manual alike. |
| Focus streak | Consecutive local days with focused time ≥ 25 min. Today counts as pending, not failed, until it ends below the threshold. |
| Week-over-week change | This week's focused time minus previous week's, shown as signed h:mm. |
| Goal progress | Focused time ÷ target per project goal (daily or weekly). "Behind pace" appears only when focused < target × elapsed fraction of the period; finished periods show behind when focused < target. |
| Billable amount | Integer minor units (cents) throughout. Rate resolution: the project's own hourly rate, else its nearest ancestor's, else no amount. Rounding is half-up applied once per entry, then summed — matching invoice line items. |

Display durations are always `h:mm`; the live timer additionally shows seconds (`m:ss` / `h:mm:ss`); decimal hours appear only next to money in billing contexts.

## Overlaps and gaps

- Entries covering the same wall-clock period are flagged (touching endpoints are not overlaps), shown on the day view, and resolvable by trimming the earlier entry's end. Acknowledged overlaps stay in totals; reports note when a range contains them.
- Unaccounted stretches strictly inside your working window (configurable days and times, default Mon–Fri 09:00–17:00, minimum 5 minutes) are listed with actions: log the time retroactively or dismiss for that day.

## Data location and format

Data lives entirely in your browser's localStorage under:

```
tempotrack.data.v2          current database (sealed envelope: app id, format, FNV-1a checksum)
tempotrack.data.v2.staging  write-ahead copy during saves
tempotrack.data.v2.prev     previous known-good copy
```

Saves are staged before commit; a load verifies checksums and falls back staging → backup if the main copy is corrupt or truncated. The database is one JSON document: schema version, projects (hierarchical, colour, optional hourly rate in minor units, optional weekly/daily goal), tasks, tags, entries (start + authoritative duration, billable flag, revision audit trail), pomodoro events, gap dismissals, settings, and the last timer snapshot.

Use Settings → Your data to download a backup JSON, export everything, restore from a file, load obviously fictional synthetic sample data, or delete all data.

## Configuration reference

All configuration lives in Settings (stored in the database):

| Setting | Default | Notes |
|---|---|---|
| Theme | light | light · dark · dim (low-stimulation) · high contrast |
| Focus / short break / long break | 25 / 5 / 15 min | Long break every N focus intervals (default 4); auto-start toggle |
| Week starts on | Monday | Affects weeks, weekly review and weekly goals |
| Working days & workday window | Mon–Fri, 09:00–17:00 | Scope for gap detection |
| Minimum reported gap | 5 min | Shorter gaps stay quiet |
| Idle prompt threshold | 5 min | Input observed inside this window only |
| Notifications | on | Browser permission requested on use; in-app banner fallback |
| Currency | USD | Display code for amounts |
| Timeline day span | 07:00–22:00 | Visible range of the day timeline |

Keyboard: `Space` start/pause · `S` stop · `K` skip phase · `N` add past time · `T` quick switcher · `←/→` day navigation · `1–5` sections · `?` help. The browser platform offers no OS-global shortcut; the sticky header indicator and tab title keep a running timer visible everywhere.

## Privacy

Tempotrack observes interaction with its own window only. It does not monitor which applications are open, window titles, screenshots, or any system-wide input. All data stays on your machine unless you export it yourself. Sample data is synthetic and uses invented names.

## Repository layout

```
src/core/       clock abstraction, reconciliation, session/pomodoro engine, money, formatting
src/data/       schema, migrations, crash-safe store, model ops, overlap/gap, idle monitor
src/analytics/  aggregation, metrics, goals, billing
src/export/     CSV, invoice-style printable summary
src/ui/         vanilla-TS UI (views, dialogs, keyboard wiring)
tests/          vitest suite incl. injected-clock timing tests and token accessibility checks
tools/          palette tuner used during theme design
scripts/        synthetic sample-data generator
```