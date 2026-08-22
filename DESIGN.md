# DESIGN — Tempotrack

## Point of view

Tempotrack is a calm instrument that reports honestly. The timer is the part you live with for hours, so it is quiet: static numerals in tabular figures, a single thin progress bar, no colour changes and no motion while a focus session runs. The analytics are the part that tells the truth, so they are dense and unflattering where the data is unflattering: gaps render as gaps, idle time is never silently absorbed, abandoned pomodoros count as abandoned, and no chart ever interpolates over an empty hour. Nothing in this app congratulates you, nothing scolds you, and nothing moves unless it carries information.

## Timer display

- Numerals: `font-variant-numeric: tabular-nums` on a system sans stack; digit widths never shift as the clock ticks.
- Size: 96px / weight 600 on desktop, 64px under 720px viewport width. Readable from across a desk.
- Seconds during focus: **shown**, always (`m:ss`; `h:mm:ss` past one hour). Rationale: a pomodoro is short enough that remaining seconds carry real meaning; hiding them forces another glance source and invites distrust of the display. Showing seconds costs nothing visually because the digits do not move or animate — only glyph content changes.
- Progress representation: a single **horizontal depleting bar** (4px tall) spanning the timer card directly beneath the numerals, filling right-to-left for countdown phases (pomodoro work/break, countdown mode) and left-to-right for elapsed-only modes (stopwatch). Chosen over a ring because a ring centres attention on itself and implies rotation; the bar sits quietly below the numerals, works identically across all three timer modes, and its stepwise per-second update (no tween) reads as information rather than decoration.
- State indication:
  - `RUNNING` / `ON BREAK` / `PAUSED` / `READY` word chip above the numerals, plus a small static dot (filled = running, hollow = paused).
  - The chip text and dot colour change **only at phase boundaries** — never mid-focus.
  - During a running focus phase there is no animation, no colour transition, and no layout movement anywhere inside the timer card.

## Always-visible running indicator

A sticky header strip present on every view contains: dot + `Running · {project}` + current `m:ss`. Static while running (no pulse, no breathe — pulsing on a running timer is banned). When the window loses focus the indicator persists unchanged in-page, and `document.title` carries the state (`12:34 Acme — Tempotrack`), so a forgotten running timer is visible from the tab strip alone. Title updates once per second only while running; otherwise it is static.

## Day view and entry-list anatomy

- Default screen. Left: a vertical timeline column for the selected day spanning the configurable day span (default 07:00–22:00), hour gridlines labelled every 2 hours in muted ink.
- Entries render as solid blocks positioned proportionally by wall-clock start/end within the span; block fill uses the project's palette colour at full opacity, label inside when the block is ≥ 30 minutes tall.
- Gaps render as **empty track** — no hatch, no interpolation, no shading. Unaccounted intervals inside working hours (configurable; default Mon–Fri 09:00–17:00, minimum 5 minutes) are additionally listed beneath the timeline with exact bounds and durations, each with actions: start-a-timer-here (retroactive entry) or dismiss.
- Overlapping entries occupy side-by-side lanes; the pair is flagged with an overlap marker and appears in the reconciliation list. Acknowledged overlaps remain counted in totals but every affected total displays a "contains overlaps" note with gross and net values.
- Right: chronological entry list for the day. Edited entries show an "edited" marker; hovering/focusing it reveals the audit trail (what changed, when, by which mechanism).

## Chart rules

- Time-of-day heatmap: rows = weekdays Mon–Sun, columns = hours 00–23 local time. Cell value = **average focused minutes** in that weekday-hour across the selected range (total minutes ÷ number of occurrences of that weekday in range). Scale: 5 quantized steps — empty (no data, flat cell with border only), then >0–10, 10–25, 25–45, >45 average minutes. Sequential ramp from surface to ink; no hue rainbow, no smoothing, missing days contribute zero to counts but produce no fabricated cells.
- All axes: labels in muted ink at AA contrast in every theme; axis lines hairline `--line`; ticks at honest values (heatmap hours every 3h; weekly bars start at zero).
- Weekly comparison bars share a common y-scale starting at zero; week-over-week delta printed as signed `h:mm`, not as a percentage.
- No chart animates on load beyond a single 120ms opacity fade (disabled under reduced motion).

## Duration formatting — fixed once

| Context | Format | Example |
|---|---|---|
| Live timer | `m:ss` / `h:mm:ss` | `24:59`, `1:02:07` |
| Every displayed duration everywhere else (lists, totals, charts, reports) | `h:mm` | `3:07`, `0:47` |
| Billable amounts context only | decimal hours, 2 places, labelled "hours" adjacent to money | `3.12 h × $90/h` |

Display format and billing decimals never appear in the same column without explicit labelling; billing decimals never appear outside a money context.

## Type and spacing

- Base 14px UI text; scale: 12, 13, 14, 16, 20, 28, 48, 96. Weights: 400 body, 600 emphasis/numerals, 500 section headers.
- Spacing on a 4px grid: 4, 8, 12, 16, 24, 32, 48, 64.
- One font family (system sans); tabular figures wherever numbers sit in columns.

## Colour tokens (roles) vs project palette

Role tokens — used for everything structural; never for project identity:

`--bg`, `--surface`, `--surface-2`, `--ink`, `--ink-muted`, `--ink-faint`, `--line`, `--focus-ring`, `--ok`, `--warn`, `--danger` (errors/destructive only), `--chart-ramp-1..5`.

State accents are low-saturation; `--danger` is never applied to the running clock or to time pressure (red urgency as the clock runs down is banned).

Project palette — exactly 8 colours, defined **per theme**, used only to identify projects in blocks, charts and legends. Chosen to stay distinguishable under deuteranopia (blue / teal / amber / orange / violet / magenta / olive / slate families with staggered lightness, no pure red-green oppositions). Contrast vs theme background ≥ 3:1 verified by automated test; pairwise simulated-deuteranopia distance verified by automated test.

Themes shipped as pure token overrides: **light**, **dark**, **dim** (warm, desaturated, intended for long focus sessions), **high-contrast**. Chart axis-label contrast verified per theme by automated test.

## Motion rules

- Strong bias against motion during focus time: while a focus phase runs, the timer card performs **zero** animations, transitions and colour changes.
- Permitted elsewhere: ≤ 150ms opacity transitions on view switches and interactive feedback; progress bar advances stepwise per second without tweening.
- Banned outright: purple-blue gradients, glassmorphism, emoji as project icons or in notifications, default framework indigo, drop shadows on every card, pulsing/breathing running indicators, red urgency as time runs down, confetti or celebration on pomodoro completion, motivational quotes, guilt-framed copy about unproductive days, animated count-ups on totals.
- `prefers-reduced-motion: reduce` removes all remaining transitions and fades globally.

## States

| State | Treatment |
|---|---|
| Empty (no projects / no entries) | Neutral statement of what will appear here and one plain action ("Add your first project"). No illustrations-as-guilt, no productivity framing. |
| Running | Header indicator + title; timer card static; break phases tint the card edge only. |
| Paused | Chip reads PAUSED, hollow dot; bar freezes; no dimming tricks. |
| Idle detected | Modal-free inline panel above the timer: exact absent interval, three equal-weight actions (Keep / Discard absent part / Reassign). Copy states facts, never judgement. |
| Error (storage failure, corrupt file, notification denied) | Inline banner naming what failed and what was preserved; data-loss risks called out before any destructive retry. |
| No data (charts/reports) | Axis frame renders with an explicit "No entries in this range" note; empty ≠ zero is preserved visually. |
