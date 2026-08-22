# PLAN — feature decisions

Judged against three tests: (1) serves the core purpose of measuring and understanding time spent; (2) finishable to the same quality bar; (3) does not expand scope into a second product.

## Accepted

| Feature | Reason |
|---|---|
| In-app global start/stop shortcut (any view) | Removes friction from the act of measuring; small, bounded surface. |
| Quick project switcher (fuzzy) attached to the running timer | Improves timing accuracy directly (right project, fast); self-contained. |
| Pomodoro defaults 25/5/15 with long break every 4 cycles | Zero-risk baseline behaviour everyone expects. |
| Validation errors on invalid manual-entry ranges (end ≤ start, future timestamps, hard overlaps) | Data integrity is the foundation of honest analytics. |
| Today view as the default screen | Matches the primary job: "what did I do today". |
| Recent-tasks quick start (last 5 project/task pairs) | Cheapest path to an accurate running timer. |
| Weekly review: last 4 weeks side-by-side totals | This *is* understanding time; totals-only avoids journaling scope creep. |
| Per-project colour used consistently across charts and timeline | Pure comprehension win; tiny and testable. |
| Accessibility: keyboard-only operation, live-region announcements, reduced-motion | Part of the quality bar itself, not scope growth. |
| First-run onboarding: one screen, creates a sample project, explains timing model | Teaches the core mental model; no animations. |
| Notification permission flow with graceful in-app fallback | Break alerts are intrinsic to pomodoro; fallback makes it shippable everywhere. |
| Idle detection with keep / discard / reassign prompt | Honesty requires surfacing unattended time; user decides, nothing silent. |
| Crash-safe running-timer persistence and recovery | Measurement you cannot lose is measurement people trust. |
| Full export / backup / restore of all local data | Local-first ownership; builds trust; small effort. |
| Flat tags with report filtering (no nesting, no dependencies) | Sharpens "what was it for" without becoming a task manager. |

## Rejected

| Feature | Reason |
|---|---|
| Calendar-style drag editing of the timeline | High hidden complexity (hit-testing, snapping, overlaps, a11y parity) — would ship half-baked; numeric editing covers the need. |
| Cloud multi-device sync | Conflicts/auth/backend lift breaks the local-first promise; not this product. |
| AI-generated productivity insights | Unbounded quality bar, hallucination and privacy risk, vague success criteria. |
| Google/Outlook calendar import | OAuth maintenance per provider plus mapping ambiguity — creeping into a calendar product. |
| Invoicing with PDF generation and payment tracking | Explicitly out of bounds: printable invoice-style summary already covers the reporting need. |
| Team workspaces with approvals | Multiplies the data model and UI by an order of magnitude; second product. |
| Automatic window-title activity monitoring | Surveillance, not tracking; violates the privacy stance outright. |
| OS tray/menubar controller | This build targets the browser platform, where no tray exists; the sticky in-page running indicator plus document.title serve the same glanceability. |

## Consequences

Accepted items are first-class FEATURES under the same implement/test/fix/commit loop and the same regression gate as the mission features.
