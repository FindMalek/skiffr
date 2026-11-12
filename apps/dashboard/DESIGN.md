# skiffr dashboard design system

Source of truth for every dashboard screen. Tracking issue: #104. If a page needs something this file does not cover,
add it here in the same PR.

Identity in one line: **a ledger, not a SaaS dashboard.** Black, white and greys. Sharp 1px boxes. Type does the work.
Colour appears only when it means something (state, status, destructive) and is never the only signal.

## 1. Principles

1. **The next action is always one key away.** The product is a loop (triage, open, apply, review what it learned).
   Every screen answers "what do I do now" before it answers "what is here".
2. **Show provenance, not just data.** An answer, a job, a token or a source always says where it came from and when it
   last did something. Trust is the product.
3. **Boxed and flat.** Structure comes from 1px borders and whitespace. No shadows, no gradients, no radius, no tints
   used as decoration.
4. **Typographic hierarchy over chrome.** Size, weight and mono/sans carry rank. Do not add icons, badges or cards to
   create hierarchy that spacing could create.
5. **Quiet by default, loud on exception.** Healthy state is plain text. Problems get an icon, a word, a border and
   an action.
6. **No dead ends.** Every empty, loading and error state names what happened and offers the next step.
7. **Fast feels like no layout shift.** Reserve space, stream the page, optimistic updates with undo instead of
   confirm dialogs.
8. **Keyboard first, pointer friendly, touch safe.** Everything reachable and operable by keyboard; 44px targets on
   coarse pointers.

## 2. Tokens

All tokens live in `packages/ui/src/styles/theme.css`. Implementers change values there, never hard-code colours in
components. The current preset is shadcn "neutral" with `--radius: 0`; keep that and fix what is below.

### 2.1 Colour (OKLCH, achromatic)

| token | light | dark | use |
| --- | --- | --- | --- |
| `--background` | `oklch(1 0 0)` | `oklch(0.145 0 0)` | page |
| `--card` | = background | `oklch(0.18 0 0)` | boxes. Light mode: same as page, the border draws the box |
| `--foreground` | `oklch(0.145 0 0)` | `oklch(0.985 0 0)` | text, primary fills |
| `--muted-foreground` | `oklch(0.50 0 0)` (4.9:1 on white) | `oklch(0.72 0 0)` | secondary text. Never lighter |
| `--muted` | `oklch(0.97 0 0)` | `oklch(0.24 0 0)` | hover rows, skeletons, code chips |
| `--border` | `oklch(0.89 0 0)` | `oklch(0.30 0 0)` | structure: card edges, row dividers, table rules. Solid, no alpha |
| `--border-strong` (new, alias of `--input`) | `oklch(0.62 0 0)` (3.2:1) | `oklch(0.58 0 0)` (3.6:1) | **control boundaries**: input, select, checkbox, switch, outline button. Needed for WCAG 1.4.11 |
| `--ring` | `oklch(0.145 0 0)` | `oklch(0.985 0 0)` | focus ring, **solid** |

Why: today `--input` is `oklch(0.922)` (1.3:1 on white) and the ring is `ring-ring/50` of a mid grey (about 1.5:1),
and dark borders are `white/10`. Controls and focus fail AA non-text contrast and the "boxed" look disappears in dark.

Status colour (the only colour allowed). Always icon + word + colour, never colour alone:

| token | light | dark | meaning |
| --- | --- | --- | --- |
| `--destructive` | `oklch(0.52 0.20 27)` | `oklch(0.70 0.19 22)` | errors, delete, rejected, failed |
| `--success` (new) | `oklch(0.50 0.12 150)` | `oklch(0.75 0.14 150)` | connected, healthy, offer |
| `--warning` (new) | `oklch(0.52 0.12 75)` | `oklch(0.80 0.13 85)` | needs attention, expiring, paused by system |

All three pass 4.5:1 as text on `--background` in their theme. Never use a status colour as a background fill. A
status is a 1px outline box in that colour with foreground text, plus the icon in that colour (see badges).
Remove `--sidebar-primary` blue in dark theme (`oklch(0.488 0.243 264)`) and the blue/orange/green `--viz-*` tokens.

### 2.2 Type

Fonts stay: IBM Plex Sans (UI, headings), JetBrains Mono (identifiers, numbers in tables, urls, tokens, keyboard).
**Base size moves from 12px to 14px**: the current `text-xs` default on buttons, inputs, cards and table cells is too
small for a daily tool (and under 16px inputs zoom on iOS).

| role | class | size / line | weight | notes |
| --- | --- | --- | --- | --- |
| page title (h1) | `text-2xl font-heading` | 24 / 32 | 600 | one per page, sentence case |
| section title (h2) | `text-base font-heading` | 16 / 24 | 600 | real `<h2>`, not a div |
| group label (h3, overline) | `text-xs uppercase tracking-wide text-muted-foreground` | 12 / 16 | 500 | rare |
| body | `text-sm` | 14 / 20 | 400 | default for everything |
| dense table cell | `text-sm` | 14 / 20 | 400 | row height does the density, not font size |
| meta / helper / timestamp | `text-xs text-muted-foreground` | 12 / 16 | 400 | only for supporting text, never for actions |
| big number | `font-heading text-3xl tabular-nums` | 30 / 36 | 600 | tiles; never above `text-3xl` |
| identifier | `font-mono text-xs` | 12 / 16 | 400 | hosts, token prefixes, shortcuts |

Rules: sentence case everywhere ("Add answer", not "Add Answer"). Brand is lowercase `skiffr`. Numbers in tables and
tiles are `tabular-nums`. Max line length 70ch for prose (`max-w-prose`). Inputs are `text-base` below `md` and
`text-sm` from `md`.

### 2.3 Spacing and layout

4px base. Allowed steps: `1 (4) 2 (8) 3 (12) 4 (16) 6 (24) 8 (32) 12 (48) 16 (64)`. No other gaps.

- Page gutter: `px-4` (<md), `px-6` (md), `px-8` (xl). Content max width `max-w-6xl` for lists/tables, `max-w-3xl` for
  forms and settings, `max-w-prose` for prose. Content is left aligned, never centred in a wide void.
- Vertical rhythm: sections `gap-8`, items inside a section `gap-4`, label to control `gap-2`.
- Card padding `p-4` (<md) / `p-6` (md+). Card header to body `gap-4`.
- Controls: height `h-9` (36) default, `h-8` (32) in dense toolbars only, **`h-11` (44) when `(pointer: coarse)`**. Icon
  buttons `size-9`, `size-11` on coarse. Minimum hit area 44px on touch (padding may extend it).
- Breakpoints (Tailwind): 320 floor, `sm` 640, `md` 768, `lg` 1024, `xl` 1280, `2xl` 1536. Verify at 320, 390, 768,
  1024, 1440, 1920.
- Sidebar: icon rail below `xl` (1280), full 256px from `xl`; below `md` it is a bottom tab bar plus a sheet (see 4.1).
  Today it is a permanent 256px column at 768, which squeezes content to ~500px.

### 2.4 Borders, radius, shadow, elevation

- Radius: `0` everywhere. Avatars are square too. The only round thing allowed is a status dot (`rounded-full size-2`).
- Border: `1px solid var(--border)` for structure; `--border-strong` for anything interactive. Cards use a real
  `border`, not `ring-1 ring-foreground/10` (which is too faint). Never `border-2` except the selected state (2.5).
- Dividers between rows: `border-b` on the row, none on the last.
- Shadow: **none**. Popovers, menus, dialogs: 1px `--border-strong` border on `--popover`. Dialogs get a
  `bg-background/80` scrim, no blur.
- Selected / current: `border-foreground` plus `bg-muted`, not colour. Sidebar current item: 2px left bar in
  `--foreground` plus `bg-muted` and `aria-current="page"`.
- Focus: `outline-2 outline-offset-2 outline-ring` (solid, 2px, via `:focus-visible`). Remove `ring-1 ring-ring/50`.
  Same on every interactive element, including table rows that are focusable and inputs.

### 2.5 Density

Two densities, chosen per component, not per user:

- **Comfortable** (default): forms, settings, cards, dialogs. Row/field min height 40px.
- **Compact list**: queue, answers, tables. Row min height 48px for two-line rows, 40px for one-line. No smaller.
  Compactness comes from fewer columns, not smaller type.

### 2.6 Motion

- Durations: `100ms` (hover, press), `150ms` (popover, tooltip, toast in), `200ms` (dialog, sheet, accordion). Nothing
  longer except chart draw-in (max 300ms, once).
- Easing: `cubic-bezier(0.2, 0, 0, 1)` (ease-out). Properties: `opacity`, `transform`, `background-color` only. Never
  animate layout (`height`, `width`) except accordion via grid-template-rows.
- List changes (row removed after apply or skip): row collapses over 150ms, focus moves to the next row.
- Skeletons do not pulse: static `bg-muted` blocks with a single 1.2s opacity fade between 1 and 0.6.
- `prefers-reduced-motion: reduce`: no transforms, no draw-in, durations 0 except opacity fades at 100ms. Implement
  once in `globals.css` with a `@media (prefers-reduced-motion: reduce)` reset, not per component.

## 3. Information architecture

```
Today            (home: what to do now, what changed, setup checklist)
Queue            (triage and apply)
Answers          (what skiffr learned: review, fix, forget)
Stats            (progress)
-----
Settings         (single route, sub-navigation)
  Profile        (applicant data the extension fills from: identity, links, work auth, salary, location)
  Account        (name, avatar, password, sessions)
  Extension      (install, connection health, devices and tokens)
  Job sources    (Gmail alerts and watched careers pages, one page, two sections)
  Resume         (Reactive Resume connection, base resume)
  Data and privacy (what is stored, export, delete)
  Appearance     (theme: system / light / dark; density later)
Admin > Users    (admins only, bottom of sidebar)
```

Removed: **Notes** (leftover of the project template), the "REST + RPC / Docs" tile, "Overview" as a template page.
The product name in the nav is "Today" for home so the label says what the page is for.

### 3.1 Shell

- Header row on every page (sticky, 56px, `border-b`, `bg-background`): sidebar trigger, breadcrumb **only** when
  nested (Settings / Extension), global search button (`Search  ⌘K`), theme toggle, user menu. The page title is the
  `<h1>` below it, rendered once (today it renders twice: breadcrumb text and h1).
- User menu (dropdown): name and email, Settings, Appearance, Keyboard shortcuts, Sign out. Sign out is not a bare
  icon button in the footer.
- Skip link "Skip to content" first in tab order, target `<main id="main" tabIndex={-1}>`.
- Mobile (<md): bottom tab bar with Today, Queue, Answers, Stats, More (opens sheet with Settings and admin). The
  top bar shows the page title and the trigger for the sheet.
- Global search / command palette (`⌘K` / `Ctrl K`, also `/`): jump to pages, search jobs by company or role, search
  answers by question, run actions ("Add job", "Open next job", "Create extension token", "Sync Gmail now", "Switch
  theme"). Built on shadcn `Command` (cmdk) inside a dialog.
- Shortcuts (documented in a `?` dialog): `g q` queue, `g a` answers, `g s` stats, `g h` today, `g ,` settings,
  `?` help. Page shortcuts in 4.3 and 4.4. Shortcuts are disabled while typing in inputs and never use bare keys
  with modifiers the browser owns.
- Toasts: bottom-right on desktop, bottom-center above the tab bar on mobile (not top-center, which covers the page
  header), max 3 stacked, 5s (8s with an action, persist for errors that need action), always `role="status"`
  (errors `role="alert"`). A toast with an action ("Undo") is the pattern for reversible changes; confirm dialogs are
  only for irreversible ones.

## 4. Component patterns

### 4.1 Page header

```
[breadcrumb: Settings / Extension]            (only when nested)
h1 Title                                      [primary action]
one line description, muted, max 70ch         [secondary actions]
```

`border-b` below, `pb-6`. Actions wrap under the title below `md`, full-width primary action on `<sm`. Description is
optional and one sentence. The primary action is the only filled button in the header.

### 4.2 Page body

Pages are a vertical stack: `Section` blocks separated by `gap-8`. A section is an `<h2>` (+ optional one-line
description) and its content. **Do not wrap every section in a Card.** Cards are for self-contained objects (a
connection, a token, a suggestion). Tables and lists sit directly on the page with a top and bottom border. Settings
forms use the two-column pattern: left label and description (max 240px), right controls (max 480px); stacked below
`lg`.

### 4.3 Lists and tables

- One list pattern for jobs, answers, tokens, sources, imports: a bordered container, rows separated by `border-b`.
  Desktop: real `<table>` semantics (no role overrides). Mobile (<md): each row becomes a stacked block, same data,
  same order, same actions (no hidden actions).
- Max 5 columns visible; secondary data moves to a detail row or side panel. Primary cell is two lines (title,
  then muted meta). Numeric columns right aligned, `tabular-nums`.
- **Row actions**: one primary action as a text button, the rest in a `⋯` menu (`DropdownMenu`) and on `hover/focus-within`
  as icon buttons with tooltips (never the only access). Destructive action is last, in the menu, never a red
  icon repeated on every row.
- Row selection: checkbox column; header checkbox selects all on the page (indeterminate state); a bulk bar replaces
  the toolbar (`n selected`, actions, clear). `Esc` clears.
- Keyboard model (queue and answers): the list is one tab stop; `j` / `k` or arrows move the active row (roving
  tabindex, `aria-activedescendant` or focus on the row), `Enter` opens the detail, `x` selects, `Space` also
  selects. Row-specific keys: queue `o` open job, `a` mark applied, `s` skip, `u` restore, `Backspace` remove;
  answers `e` edit, `c` confirm, `f` stop filling. Shown in a hint bar under the toolbar and in the `?` dialog.
- Filters live in the URL (`?status=queued&source=greenhouse&q=...`) so a view can be bookmarked and survives
  reload. Filter bar: search input, segmented status control, source `Select`. A "Clear filters" link when any
  filter is active. Result count is a `role="status"` live region.
- Pagination: cursor or "Load more" with a visible count, never page numbers over 100 rows; virtualise at 200+ rows.
- Sort is explicit: a sort control showing the current sort and direction.
- Dates: relative ("2h ago", "yesterday", "3 Nov") with the absolute local time in the `title` and `<time dateTime>`.
  Never mix UTC and local on one screen; never `11/12/2026, 11:38:22 PM`. One `<RelativeTime>` component.

### 4.4 Forms

- Label above control, helper below (`text-xs muted`), error replaces helper in `--destructive` with an icon, tied by
  `aria-describedby`; `aria-invalid` on the control. Required is marked by "(optional)" on the optional ones, not
  asterisks.
- Validate on blur and on submit, not on every keystroke. On submit error, focus the first invalid field and
  announce a summary in an `role="alert"` region when more than one.
- Primary button text is the verb and object ("Save profile", "Create token"), disabled only while pending (show
  spinner and keep width). Never disable a submit because the form is invalid without saying why.
- Autosave only for toggles and inline edits; everything else has an explicit Save with an unsaved-changes guard
  (`beforeunload` and in-app navigation prompt).
- Use the shared `Select` (non-native, with typeahead) in place of native `<select>`, and the shared `Checkbox`
  (square, `--border-strong`) in place of native checkboxes. Today a native `<select>` (`h-8 text-xs`) and native
  checkboxes (`accent-primary`) sit beside styled inputs and look foreign.
- Secrets (tokens, API keys): shown once in a copy box with a copy button and "I have stored it" confirmation;
  afterwards only prefix and last 4 in mono.

### 4.5 Dialogs, sheets, menus

- Dialog: title, one-sentence description, content, footer with the primary on the right. `Esc` closes, focus returns
  to the trigger, no nested dialogs. Width `max-w-md` (confirm), `max-w-xl` (form).
- Confirm dialogs only for irreversible actions (delete account, remove job with application, disconnect Gmail).
  Wording: title states the consequence ("Remove 3 jobs?"), body one sentence of what is lost, button repeats the
  verb ("Remove 3 jobs"), cancel is "Cancel". Reversible actions (mark applied, skip, stop filling, restore) happen
  immediately with an Undo toast.
- Detail panels (job, answer) open in a right-side `Sheet` on desktop and full screen on mobile, so the list keeps
  its place.

### 4.6 Status badges

One component, `StatusBadge`, one visual language everywhere (jobs, applications, answers, sources, gmail, tokens):

`[icon] Word` in a 1px box, height 20, `text-xs`, uppercase never.

| tone | box | text | icon | examples |
| --- | --- | --- | --- | --- |
| neutral | `--border-strong` | foreground | outline icon | queued, learned, paused, not checked yet |
| strong | `bg-foreground` | `text-background` | check | confirmed, applied, active, watching |
| success | `--success` border | foreground | check-circle in `--success` | connected, offer |
| warning | `--warning` border | foreground | alert-triangle in `--warning` | needs attention, expiring, needs reconnect |
| danger | `--destructive` border | foreground | x-circle in `--destructive` | rejected, failed, problem, revoked |

Rules: the word is always visible; one badge per entity per row; meaning of tones is global (a black filled badge
always means "done and kept"). Source and ATS labels are **not** badges: they are muted mono text. Today `Added`
(filled) vs `Could not read` (outline) vs `Problem` (red fill) vs `Not checked yet` (outline) have no shared logic.

### 4.7 Empty, loading, error

- **Empty (first use)**: title (what this is), one sentence (why it is empty and what fills it), one primary action,
  optional secondary link to docs. Bordered box, left aligned. Example: "No answers yet. skiffr saves an answer the
  first time you correct a field it filled. Install the extension, apply to a job, and they show up here." [Connect
  the extension]
- **Empty (filtered)**: "No jobs match" + the active filters as removable chips + "Clear filters".
- **Loading**: every route has a `loading.tsx` with a skeleton that matches the final layout (same row height and
  column widths) so nothing shifts. Skeleton = static muted blocks, no spinner pages. Buttons show an inline spinner
  and keep their width. Client queries use `placeholderData` / prefetch; no skeleton after the first paint when the
  data was prefetched on the server.
- **Error (section)**: bordered box with `--destructive` icon, plain sentence of what failed, the reason when known,
  `Try again` button, request id when the API sends `x-request-id`. Never a bare red text line.
- **Error (route)**: `error.tsx` per route group with the same box and "Go to Today"; `global-error.tsx`;
  branded `not-found.tsx` inside the shell. Unauthenticated API errors redirect to sign in with a `next` param and a
  toast "Your session ended".
- **Offline / slow**: a thin banner under the header when `navigator.onLine` is false.
- Success feedback is a toast or inline "Saved" with a timestamp; never silent.

### 4.8 Charts (see `dataviz` guidance)

- Monochrome. Encode with **position and length first**, then luminance steps of grey, then pattern. Series
  palette (light): `oklch(0.145)` solid, `oklch(0.55)` solid, `oklch(0.80)` solid, hatch (`45deg 1px`) on
  `oklch(0.55)`; dark mirrors. Use `--destructive` only for a series that literally means rejected/failed.
- Direct labels over legends: label the end of the line or inside the bar with its value; a legend only when more than
  3 series. Never rely on colour to tell series apart: luminance gap >= 3:1 between adjacent marks or a 1px
  `--background` gap plus pattern.
- Charts allowed: bar (counts per day/week), horizontal bar (ranking), stacked bar (status split), funnel as
  horizontal bars with conversion %, line (trend with <= 3 series). No pies, no donuts, no gradients, no 3D.
- Every chart has: a title that states the finding ("You edit 38% of what skiffr fills, up 1 point"), an axis with
  units, a "Show as table" disclosure (keep), `role="img"` with a text alternative, a min sample note when n is small
  ("Based on 4 applications"), and empty state in place (not a missing card).
- Numbers: `tabular-nums`, locale-formatted, deltas as `+3` / `-2` with a word, not arrows in colour.
- Tooltips on focus as well as hover; chart marks are keyboard reachable via the table fallback.
- Tiles: label (muted), number (3xl), one-line note, optional delta. At most 4 per row, 1 per row below `sm`.

### 4.9 Learned-answer pattern (the core object)

An answer row/panel always shows: **question** (as seen on the form), **value**, **status badge**, **where it came
from** (source: you typed it / learned from a correction / drafted by AI / imported, plus the last sites it was used
on, e.g. `boards.greenhouse.io/northwind`), **confidence** (a labelled word, not a score: "Solid" used 5+ times and
left as filled, "Unsure" corrected recently or flip-flopping, "New" used < 3 times), **last used** (relative),
**times used / times corrected** as one muted line, and actions (Edit inline, Confirm, Stop filling, Delete).
Conflicts (same question answered two ways) are surfaced at the top of the page as a review queue, with side-by-side
values and "Keep this one". Bulk: select rows, "Confirm", "Stop filling", "Delete". Sensitive questions are marked and
explained ("never filled automatically").

### 4.10 Connection health pattern

Anything that connects (extension, Gmail, Reactive Resume, each source) shows the same block: state badge
(Connected / Needs attention / Not connected), last activity relative ("last filled 2h ago"), the next scheduled
run when there is one, the one action to fix it, and the reason in plain words when it is broken. A compact version
(dot + word) sits in the user menu and on Today.

## 5. Copy guidelines

- Plain, second person, present tense, short. "skiffr" fills forms; "you" press submit. No exclamation marks, no
  emoji, no "simply", "just", "easy".
- Sentence case for every heading, label, button and menu item. Brand lowercase.
- Buttons are verb + object ("Add job", "Sync now", "Revoke token"). No "Submit", "OK", "Yes".
- Say what happened and what to do: "Gmail needs to be reconnected. Reconnect" not "Authentication error".
- Errors never blame the user, never show codes (show them in a collapsible "Details" with the request id).
- Names: job (not "posting" and "role" at once), queue, answer (not "learned answer" in UI chrome), source, token ->
  "device" in headings ("Devices and tokens"), "resume" not "CV" in nav (the integration is "Reactive Resume").
- Dates and numbers follow 4.3. Counts: "1 job", "24 jobs".
- Explanatory "What skiffr does with ..." text blocks move into a collapsible "How this works" (closed by default
  after first view) so they stop competing with the controls.
- Remove stale copy: the queue empty state still says Gmail alerts and the extension "will add them for you soon".

## 6. Accessibility checklist (WCAG 2.2 AA), run per PR

- [ ] Contrast: text >= 4.5:1 (3:1 for 18px+/14px bold); control borders, focus ring, icons that carry meaning >= 3:1.
      Check both themes.
- [ ] Focus: visible 2px solid ring on every interactive element; never `outline-none` without replacement; focus
      not obscured by sticky headers (`scroll-padding-top`); logical order equals visual order.
- [ ] Keyboard: every action reachable and operable; no traps; `Esc` closes overlays; list navigation per 4.3; focus
      returns to trigger after dialog close, and moves to the next row after a row is removed.
- [ ] Landmarks: `header`, `nav` (labelled), `main#main`, skip link. One `h1`, then `h2` sections in order, no skipped
      levels. Card titles are headings, not divs (today sign-in has no h1 and card titles are divs).
- [ ] Names: icon-only buttons have `aria-label`; labels are programmatically tied (`htmlFor`/`aria-labelledby`);
      links say where they go; "Open" rows include the job name.
- [ ] Status: never colour alone; badges have text; live regions for async results (`role="status"`), alerts for
      errors (`role="alert"`).
- [ ] Targets: >= 24px minimum (WCAG 2.5.8), 44px on coarse pointer.
- [ ] Forms: `autocomplete` tokens, correct `type`/`inputmode`, 16px font on mobile, errors tied to fields.
- [ ] Motion: respects reduced motion; nothing flashes; no auto-moving content.
- [ ] Zoom/reflow: usable at 200% zoom and 320px wide without horizontal scroll or clipped content; text spacing
      overrides do not break layout.
- [ ] Time: nothing times out silently; toasts with actions persist long enough (8s) and pause on hover/focus.
- [ ] Automated: axe-core run in the e2e on each route in light and dark with 0 serious/critical violations.

## 7. Responsive rules

- 320 to 1920 with no horizontal page scroll (tables scroll inside their own container only if they cannot stack).
- `< md`: bottom tab bar, single column, list rows stack, filters collapse into a `Filter` sheet with an active-count
  badge, primary page action becomes a sticky bottom button where the page is a loop (queue: "Open next").
- `md` to `xl`: icon rail sidebar, content gets full width up to its max.
- `>= xl`: full sidebar; queue and answers can show the detail sheet beside the list.
- `>= 1920`: content max-width stays (6xl); do not stretch tables to 1700px.
- Test matrix per page: 320, 390, 768, 1024, 1440, 1920 x light, dark. Screenshots named `ux-<page>-<width>-<scheme>.png`.

## 8. Performance rules

- Server-render the first meaningful view and prefetch the page's queries (already done for queue, extension, gmail);
  **no client fetch on first load of a route** (the answers bank loads 2000 rows client-side after paint and shifts
  layout by 0.018 CLS; use pagination from the API or stream with Suspense + skeleton of the same height).
- `loading.tsx` on every route (today only queue and stats have one).
- Lists over 100 rows are paginated server-side or virtualised; row components are memoised.
- No external call during render of settings pages (the CV page waits on a third-party resume list: load it behind a
  Suspense boundary with its own skeleton and a timeout).
- Keep the JS for charts small (current charts are plain CSS, keep it that way); lazy-load `Command`, dialogs with
  heavy content and the tailoring dialog.
- Fonts: `display: swap`, preload the two used weights, subset latin.
- Budget: LCP < 1.8s, CLS 0, INP < 200ms on the seeded dataset; report with each page PR.

## 9. Implementation map

| area | files | issue |
| --- | --- | --- |
| tokens, primitives | `packages/ui/src/styles/*.css`, `packages/ui/src/components/*` | foundation |
| shell | `apps/dashboard/app/(app)/layout.tsx`, `components/app-sidebar.tsx`, `components/page-header.tsx`, `components/shell/*` | shell |
| format and copy helpers | `apps/dashboard/lib/format.ts`, `components/time.tsx` | foundation |

Per page: see the backlog on #104.
