# skiffr dashboard design system

**This file is the source of truth for every dashboard screen.** If a page needs something it does not cover, or a
rule here is wrong, edit this file in the same PR as the code. Tracking issue and audit findings: #104.

Identity in one line: **a ledger, not a SaaS dashboard.** Black, white and greys. Sharp 1px boxes. Type does the work.
Colour appears only when it means something (state, status, destructive) and is never the only signal.

Scope: these rules are for `apps/dashboard`. The tokens and base styles live in `packages/ui`, and
`packages/ui/src/styles/globals.css` is imported by `apps/web` and `apps/docs` too, so a token change or the 14px
base moves the landing page and the docs. A PR that changes shared styles must include before and after screenshots
of web and docs. The landing-only utilities (`bg-glow`, `bg-dots`) stay for `apps/web`; "no gradients" applies to the
dashboard.

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
   coarse pointers (exceptions in 2.3).

## 2. Tokens

All tokens live in `packages/ui/src/styles/theme.css`. Implementers change values there, never hard-code colours in
components. The base is the shadcn "neutral" preset with `--radius: 0`; keep that and apply what is below.

### 2.1 Colour (OKLCH, achromatic)

Contrast ratios are WCAG 2.x, computed from the OKLCH values (oklch to linear sRGB, relative luminance). The
numbers are on `--background` unless a surface is named. Re-check them in both themes whenever a value changes
(`packages/ui/src/styles/tokens.test.ts` is the guard).

| token | light | dark | use |
| --- | --- | --- | --- |
| `--background` | `oklch(1 0 0)` | `oklch(0.145 0 0)` | page |
| `--card`, `--popover` | = background | `oklch(0.18 0 0)` | boxes. Light mode: same as page, the border draws the box |
| `--foreground` | `oklch(0.145 0 0)` (19.8:1) | `oklch(0.985 0 0)` (19.0:1) | text, primary fills |
| `--muted-foreground` | `oklch(0.50 0 0)` (6.00:1; 5.50 on `--muted`) | `oklch(0.72 0 0)` (7.98:1; 6.63 on `--muted`) | secondary text. Never lighter |
| `--muted` | `oklch(0.97 0 0)` | `oklch(0.24 0 0)` | hover rows, code chips. Not visible as a boundary (1.09:1 light), so never use it alone to mark an edge or a skeleton |
| `--border` | `oklch(0.89 0 0)` (1.39:1) | `oklch(0.30 0 0)` (1.45:1; 1.38 on `--card`) | structure: card edges, row dividers, table rules. Solid, no alpha |
| `--border-strong` | `oklch(0.62 0 0)` (3.64:1; 3.34 on `--muted`) | `oklch(0.58 0 0)` (4.62:1; 4.39 on `--card`, 3.84 on `--muted`) | **control boundaries**: input, select, checkbox, switch, outline button. Needed for WCAG 1.4.11 (3:1). `--input` points at `--border-strong` |
| `--ring` | `oklch(0.145 0 0)` | `oklch(0.985 0 0)` | focus ring, **solid** |
| `--primary` | `oklch(0.145 0 0)` | `oklch(0.985 0 0)` | filled buttons and strong badges (same as foreground) |

Everything else shadcn defines (`--secondary`, `--accent`, `--popover-foreground`, `--card-foreground`,
`--sidebar-*`) maps to foreground, muted, card or border. No new greys, no hue. The sidebar uses `--background`,
`--border` and `--foreground` like the page (the blue dark `--sidebar-primary` of the starting preset is removed).

Why `--border` stays faint: dividers and card edges are decorative, the information they carry is also carried by
spacing, headings and content, so WCAG does not require 3:1 for them. They are meant to be quiet (1.39 and 1.45:1,
up from about 1.17:1 for the starting `white/10` in dark). Anything the user must perceive as a control uses
`--border-strong`. If boxes read as too faint in review, darken `--border` to about `oklch(0.80)` light and
`oklch(0.36)` dark (1.87 and 1.82:1) and keep the row dividers at the current values; do not go to 3:1 for decoration.

Status colour (the only colour allowed). Always icon + word + colour, never colour alone. Ratios as text on
`--background` / `--muted`:

| token | light | dark | meaning |
| --- | --- | --- | --- |
| `--destructive` | `oklch(0.52 0.20 27)` (6.11 / 5.60) | `oklch(0.70 0.19 22)` (6.79 / 5.65) | errors, delete, rejected, failed |
| `--success` | `oklch(0.50 0.12 150)` (5.67 / 5.20) | `oklch(0.75 0.14 150)` (9.40 / 7.81) | connected, healthy, offer |
| `--warning` | `oklch(0.52 0.12 75)` (5.61 / 5.15) | `oklch(0.80 0.13 85)` (10.52 / 8.74) | needs attention, expiring, paused by system |

Never use a status colour as a background fill. A status is a 1px outline box in that colour with foreground text,
plus the icon in that colour (see 4.6).

Chart series (`--chart-1..5`, `--viz-*`): monochrome, defined in 4.8. Ordinal ramp `--viz-o1..o4` and single-series
`--viz-seq` are greys from the same family and follow the same rule (every mark at least 3:1 on its surface).
The blue/orange/green `--viz-*` values of the starting preset are removed.

### 2.2 Type

Fonts: IBM Plex Sans (UI, headings), JetBrains Mono (identifiers, urls, tokens, keyboard). **Base size is 14px.**
The starting preset used 12px (`text-xs`) for buttons, inputs, cards and table cells, which is too small for a daily
tool and below the 16px iOS needs to avoid zooming into inputs.

| role | class | size / line | weight | notes |
| --- | --- | --- | --- | --- |
| page title (h1) | `text-2xl font-heading` | 24 / 32 | 600 | one per page, sentence case |
| section title (h2) | `text-base font-heading` | 16 / 24 | 600 | real `<h2>` (use `Section`) |
| group label (h3) | `text-xs font-medium tracking-wide text-muted-foreground` | 12 / 16 | 500 | rare, sentence case |
| body | `text-sm` | 14 / 20 | 400 | default for everything |
| dense table cell | `text-sm` | 14 / 20 | 400 | row height does the density, not font size |
| meta / helper / timestamp | `text-xs text-muted-foreground` | 12 / 16 | 400 | supporting text only, never actions |
| big number | `font-heading text-3xl tabular-nums` | 30 / 36 | 600 | tiles; never above `text-3xl` |
| identifier | `font-mono text-xs` | 12 / 16 | 400 | hosts, token prefixes, shortcuts |

Rules: sentence case everywhere ("Add answer", not "Add Answer"), no `uppercase` transform anywhere. Brand is
lowercase `skiffr`. Numbers in tables and tiles are `tabular-nums`. Max line length 70ch for prose (`max-w-prose`).
Inputs are `text-base` below `md` and `text-sm` from `md`.

### 2.3 Spacing, sizing and layout

4px base. Gaps between blocks use `1 (4) 2 (8) 3 (12) 4 (16) 6 (24) 8 (32) 12 (48) 16 (64)`. Component internals
(control and badge padding, icon gaps) may also use the half steps `1.5 (6)`, `2.5 (10)` and `5 (20)` for badge and
checkbox heights. Nothing else.

- Page gutter: `px-4` (<md), `px-6` (md), `px-8` (xl). Content max width `max-w-6xl` for lists/tables, `max-w-3xl` for
  forms and settings, `max-w-prose` for prose. Content is left aligned, never centred in a wide void.
- Vertical rhythm: sections `gap-8`, items inside a section `gap-4`, label to control `gap-2`.
- Card padding `p-4` (<md) / `p-6` (md+). Card header to body `gap-4`.
- Controls by size (`Button`, `Input`, `Select`):
  - `default` `h-9` (36px), `h-11` (44px) on `(pointer: coarse)`;
  - `sm` `h-8` (32px) for dense toolbars, 44px on coarse;
  - `xs` `h-6` (24px), **fine pointers only**, 32px on coarse; for dense toolbars and table cells, never the only
    way to do an action;
  - icon buttons `size-9`, `size-11` on coarse, `icon-xs` 24px / 32px on coarse with the same restriction.
- Checkbox and switch: the visible control is 20px (switch 20 to 24px tall). Its hit area is 36px (`after:-inset-2`)
  and it always sits inside a `label` or row whose clickable height is at least 44px on coarse pointers. This is the
  one documented exception to "44px on touch": the bare control is 36px, the effective target is the row.
- Rows (lists, tables): 40px one line, 48px two lines, **52px on coarse pointers**.
- Breakpoints (Tailwind): 320 floor, `sm` 640, `md` 768, `lg` 1024, `xl` 1280, `2xl` 1536. Test at 320, 390, 768,
  1024, **1280**, 1440, 1920 (1280 is where the sidebar changes).
- Sidebar and shell by width: below `md` the shell is a top bar plus a bottom tab bar (3.1); `md` to below `xl` an
  icon rail; `xl` and up the full 256px sidebar.

### 2.4 Borders, radius, shadow, elevation

- Radius: `0` everywhere. Avatars are square too. The only round thing allowed is a status dot (`rounded-full size-2`).
- Border: `1px solid var(--border)` for structure; `--border-strong` for anything interactive. Cards use a real
  `border`, not `ring-1 ring-foreground/10`. Never `border-2` except the selected state below.
- Dividers between rows: `border-b` on the row, none on the last.
- Shadow: **none**. Popovers, menus, dialogs: 1px `--border-strong` border on `--popover`. Dialogs get a
  `bg-background/80` scrim, no blur. Starting-preset leftovers (`shadow-sm`, `ring-1 ring-ring/50` on sidebar, field,
  chart tooltip, segmented control) are removed by the shell and chart issues.
- Selected / current: `border-foreground` plus `bg-muted` (2px for selected cards and rows), not colour. Sidebar
  current item: 2px left bar in `--foreground` plus `bg-muted` and `aria-current="page"`.
- Focus: `outline-2 outline-offset-2 outline-ring` (solid, 2px, via `:focus-visible`). Remove `ring-1 ring-ring/50`.
  Same on every interactive element, including focusable table rows and inputs.

### 2.5 Density

Two densities, chosen per component, not per user:

- **Comfortable** (default): forms, settings, cards, dialogs. Field min height 40px.
- **Compact list**: queue, answers, tables. Row sizes as in 2.3. Compactness comes from fewer columns, not smaller type.

### 2.6 Motion

- Durations: `100ms` (hover, press), `150ms` (popover, tooltip, toast in), `200ms` (dialog, sheet, accordion). Nothing
  longer except chart draw-in: **300ms max, once**, never on update.
- Easing: one token, `--ease-out: cubic-bezier(0.2, 0, 0, 1)`, defined in `globals.css`. Every enter/exit and
  state transition uses it (popover, tooltip, dialog, sheet, accordion, toast, sidebar width, chart draw-in).
  `linear` is only for spinners. Components that still use `ease-in-out`, `ease-linear` or the Tailwind default move
  to the token.
- Properties: `opacity`, `transform`, `background-color` only. Do not animate `height` or `width`, with one
  exception: accordion and disclosure open/close via `grid-template-rows`.
- List changes: a removed row (applied, skipped, deleted) fades out over 100ms and the list then reflows without
  animation; focus moves to the next row immediately.
- Skeletons: static `bg-border` blocks (`--muted` is invisible on the page), no shimmer or sweep, at most a slow
  1.6s opacity fade between 1 and 0.6.
- `prefers-reduced-motion: reduce`: no transforms, no draw-in, no fades on skeletons, durations 0 except opacity
  fades at 100ms. Implement once in `globals.css` with a `@media (prefers-reduced-motion: reduce)` reset, not per
  component.

### 2.7 Layering (z-index)

One scale, no ad hoc values:

| layer | z |
| --- | --- |
| inline detail pane, sticky table header | 20 |
| top bar, bottom tab bar | 30 |
| sticky bottom page action (above the tab bar) | 35 |
| dialog scrim and content, modal sheet, dropdown, select, popover | 50 |
| tooltip, and select/popover/menu opened from inside a dialog or sheet | 60 |
| toast region | 100 |
| skip link while focused | 110 |

Toasts sit above everything except the skip link, so an error is never hidden by a dialog.

## 3. Information architecture

```
Today            (home: what to do now, what changed, setup checklist)
Queue            (triage and apply)
Answers          (what skiffr learned: review, fix, forget)
Stats            (progress)
-----
Settings         (one sidebar entry, sub-navigation inside)
  Profile        (applicant data the extension fills from: identity, links, work auth, salary, location)
  Account        (name, avatar, password, sessions)
  Extension      (install, connection health, extension tokens)
  Job sources    (nav group with two routes: Gmail alerts at /settings/gmail, Careers pages at /settings/sources)
  Resume         (Reactive Resume connection, base resume)
  Data and privacy (what is stored, export, delete)
  Appearance     (theme: system / light / dark; keyboard shortcuts on/off)
Admin > Users    (admins only, bottom of sidebar)
```

Gmail and Careers pages stay two routes because the Gmail OAuth return path is fixed to `/settings/gmail`
(`RETURN_PATHS` in `packages/orpc/src/lib/gmail/state.ts` and the redirect URI registered with Google); merging them
into one page means moving both.

Not in the product nav: the Notes example resource of the starting template, the "REST + RPC / Docs" tile and a
template "Overview" page. Home is called "Today" so the label says what the page is for.

### 3.1 Shell

- Header row on every page (sticky, 56px, `border-b`, `bg-background`): sidebar trigger (md and up), breadcrumb **only**
  when nested (Settings / Extension), global search button (`Search  ⌘K`), theme toggle, user menu. The page title is
  the `<h1>` below it, rendered once.
- User menu (dropdown): name and email, Settings, Appearance, Keyboard shortcuts, Sign out (one click, no confirm).
  Sign out is not a bare icon button in the sidebar footer.
- Skip link "Skip to content" first in tab order, target `<main id="main" tabIndex={-1}>`; focus moves to the `h1` on
  route change.
- **Mobile (below md)**: one top bar and one bottom bar, no sidebar trigger.
  - Top bar 56px: `skiffr` wordmark, search icon button, user menu button (avatar). The user menu holds theme,
    Settings and Sign out, so sign out and theme are always reachable.
  - Bottom tab bar 56px plus the safe-area inset: Today, Queue, Answers, Stats, More. More opens one bottom sheet
    with Settings (and its sub pages), Admin and Appearance. This is the only trigger for that sheet.
  - Stacking from the bottom edge: tab bar, then a sticky page action if the page has one (queue "Open next", 56px),
    then toasts above both (`bottom: calc(tab bar + action bar + 16px)`). Page content gets matching bottom padding
    so nothing is hidden.
- Global search / command palette (`⌘K` / `Ctrl K`): jump to pages, search jobs by company or role, search answers
  by question, run actions ("Add job", "Open next job", "Create extension token", "Sync Gmail now", "Switch theme").
  Built on shadcn `Command` (cmdk) in a dialog. It loads nothing until it opens and never logs queries.
- Toasts: bottom-right on desktop, above the bottom bars on mobile (see above); not top-center, which covers the page
  header. Max 3 stacked, 5s (8s with an action, persistent for errors that need action), pause on hover and focus,
  always `role="status"` (errors `role="alert"`). A toast with an action ("Undo") is the pattern for reversible
  changes; confirm dialogs are only for irreversible ones.

### 3.2 Keyboard shortcuts (WCAG 2.1.4)

Single-character shortcuts must not fire from anywhere. Rules:

1. **Scope**: a single-key shortcut is active only while focus is inside the page content (`main`) and not in a text
   field, select, or an open overlay. They are never attached to `document` while focus is on the browser chrome,
   the sidebar or a dialog. List keys (`j k x o a s u e c f` and friends) are active only while the list or one of
   its rows has focus.
2. **Off switch**: Settings > Appearance > "Keyboard shortcuts" (on by default). When off, no single-key shortcut is
   registered. The modified shortcuts below keep working.
3. **Never the only way**: every shortcut action also exists as a visible control and in the command palette.
4. **Modified shortcuts** are exempt from 2.1.4 and may be global: `⌘K` / `Ctrl K` (palette), `Esc` (close).

Map (one list, all pages use it; the `?` dialog is generated from it):

| keys | where | action |
| --- | --- | --- |
| `⌘K` / `Ctrl K` | anywhere | command palette |
| `?` | page content | shortcut help |
| `g` then `h` `q` `a` `s` `,` | page content | go to Today, Queue, Answers, Stats, Settings |
| `/` | a list page | focus the list filter (not the palette) |
| `j` `k` or arrows | list | move the active row |
| `Enter` | list | open the row detail |
| `x` or `Space` | list | select the row |
| `+` | queue, answers | add a job / add an answer |
| `n` | Today, queue | open the next job |
| `o` `a` `s` `u` `Backspace` | queue row | open link, mark applied, skip, restore, remove |
| `e` `c` `f` | answers row | edit, confirm, stop filling |
| `Esc` | anywhere | close, clear selection |

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
`lg`. Headings: pages use `Section` for `h2`; `CardTitle` renders a `div` by default (it holds big numbers) and takes
`as="h2" | "h3" | "h4"` when a card title is a real heading.

### 4.3 Lists and tables

- One list pattern for jobs, answers, tokens, sources, imports: a bordered container, rows separated by `border-b`.
  Desktop: a table. Mobile (<md): each row becomes a stacked block, same data, same order, same actions (no hidden
  actions).
- Max 5 columns visible; secondary data moves to a detail pane. Primary cell is two lines (title, then muted meta).
  Numeric columns right aligned, `tabular-nums`.
- **Row actions**: one primary action as a text button, the rest in a `⋯` menu (`DropdownMenu`) and, on
  `hover` / `focus-within`, as icon buttons with tooltips (never the only access). The destructive action is last,
  in the menu, never a red icon repeated on every row.
- Row selection: checkbox column; header checkbox selects all on the page (indeterminate state); a bulk bar replaces
  the toolbar (`n selected`, actions, clear). `Esc` clears.
- **Keyboard model**: interactive lists use the ARIA `grid` pattern (`role="grid"` on the table, `row`, `gridcell`),
  not plain table semantics, because a roving cursor needs it. The grid is one tab stop. `j` / `k` or up/down arrows
  move the active row; left/right arrows move between the row's cells and its action buttons (so every row action is
  reachable without a letter key); `Enter` opens the detail; `Space` and `x` select; the `⋯` menu opens with `Enter`
  on its button. Letter shortcuts (3.2) are accelerators, never the only way. Read-only tables (stats breakdowns,
  imports) stay plain tables. A one-line hint bar under the toolbar shows the keys for the page.
- Filters live in the URL (`?status=queued&source=greenhouse&q=...`) so a view can be bookmarked and survives
  reload. Filter bar: search input, segmented status control, source `Select`. A "Clear filters" link when any
  filter is active. The result count is a `role="status"` live region.
- Pagination: cursor or "Load more" with a visible count, never page numbers over 100 rows; virtualise at 200+ rows.
- Sort is explicit: a sort control showing the current sort and direction.
- Dates: relative ("2h ago", "yesterday", "3 Nov") with the absolute local time in the `title` and `<time dateTime>`.
  Never mix UTC and local on one screen; never `11/12/2026, 11:38:22 PM`. One `<RelativeTime>` component.

### 4.4 Forms

- Label above control, helper below (`text-xs muted`), error replaces helper in `--destructive` with an icon, tied by
  `aria-describedby`; `aria-invalid` on the control. Mark the optional fields "(optional)", not the required ones
  with asterisks.
- Validate on blur and on submit, not on every keystroke. On submit error, focus the first invalid field and
  announce a summary in a `role="alert"` region when more than one.
- Primary button text is the verb and object ("Save profile", "Create token"), disabled only while pending (show a
  spinner and keep the width). Never disable a submit because the form is invalid without saying why.
- Autosave only for toggles and inline edits; everything else has an explicit Save with an unsaved-changes guard
  (`beforeunload` and in-app navigation prompt).
- Use the shared `Select` (non-native, with typeahead) in place of native `<select>`, and the shared `Checkbox`
  (square, `--border-strong`) in place of native checkboxes.
- Secrets (tokens, API keys): shown once in a copy box with a copy button and "I have stored it" confirmation;
  afterwards only prefix and last 4 in mono.

### 4.5 Dialogs, sheets, menus

- Dialog: title, one-sentence description, content, footer with the primary on the right. `Esc` closes, focus returns
  to the trigger, no nested dialogs. Width `max-w-md` (confirm), `max-w-xl` (form).
- Confirm dialogs only for irreversible actions (delete account, remove job with application, disconnect Gmail,
  revoke a token). Wording: the title states the consequence ("Remove 3 jobs?"), one sentence of what is lost, the
  button repeats the verb ("Remove 3 jobs"), cancel is "Cancel". Reversible actions (mark applied, skip, stop
  filling, restore) happen immediately with an Undo toast. Sign out is neither: one click.
- Detail panels (job, answer): **below `xl` a modal right-side `Sheet`** (full screen below `md`) with scrim and
  focus trap; **from `xl` an inline, non-modal pane** beside the list (`complementary` landmark, no scrim, `Esc`
  closes it and returns focus to the row), so the list keeps its place in both.

### 4.6 Status badges

One component, `StatusBadge`, one visual language everywhere (jobs, applications, answers, sources, gmail, tokens):
`[icon] Word` in a 1px box, height 20, `text-xs`, sentence case.

| tone | box | text | icon | examples |
| --- | --- | --- | --- | --- |
| neutral | `--border-strong` | foreground | outline icon | queued, learned, paused, not checked yet |
| strong | `bg-foreground` | `text-background` | check | confirmed, applied, active, watching |
| success | `--success` border | foreground | check-circle in `--success` | connected, offer |
| warning | `--warning` border | foreground | alert-triangle in `--warning` | needs attention, expiring, needs reconnect |
| danger | `--destructive` border | foreground | x-circle in `--destructive` | rejected, failed, problem, revoked |

Rules: the word is always visible; one badge per entity per row; the meaning of tones is global (a black filled badge
always means "done and kept"). Source and ATS labels are **not** badges: they are muted mono text.

### 4.7 Empty, loading, error

- **Empty (first use)**: title (what this is), one sentence (why it is empty and what fills it), one primary action,
  optional secondary link to docs. Bordered box, left aligned. Example: "No answers yet. skiffr saves an answer the
  first time you correct a field it filled. Install the extension, apply to a job, and they show up here." [Connect
  the extension]
- **Empty (filtered)**: "No jobs match" + the active filters as removable chips + "Clear filters".
- **Loading**: every route has a `loading.tsx` with a skeleton that matches the final layout (same row height and
  column widths) so nothing shifts. Skeleton rules in 2.6. Buttons show an inline spinner and keep their width.
  Client queries use prefetch or `placeholderData`; no skeleton after first paint when the data was prefetched on the
  server.
- **Error (section)**: bordered box with a `--destructive` icon, a plain sentence of what failed, the reason when
  known, a `Try again` button, the request id when the API sends `x-request-id`. Never a bare red text line.
- **Error (route)**: `error.tsx` per route group with the same box and "Go to Today"; `global-error.tsx`; a branded
  `not-found.tsx` inside the shell. Unauthenticated API errors redirect to sign in with a `next` param and a toast
  "Your session ended".
- **Offline / slow**: a thin banner under the header when `navigator.onLine` is false.
- Success feedback is a toast or an inline "Saved" with a timestamp; never silent.

### 4.8 Charts

Rules, inline (no external guidance needed):

1. Encode with **position and length first**, then fill, then pattern. Never hue.
2. Every mark is at least 3:1 against the surface it sits on (WCAG 1.4.11), and series are told apart by position,
   a direct label, a 1px `--background` gap between adjacent marks and a hatch on the second series, not by
   luminance alone.
3. Label the data directly (end of line, inside or beside the bar); a legend only when there are more than 3 series.

Series palette (greys, from `--viz-1..3`; ratios on `--background`, dark also on `--card`):

| series | light | dark | use |
| --- | --- | --- | --- |
| 1 | `oklch(0.145)` 19.8:1 | `oklch(0.985)` 19.0:1 (18.0 card) | primary series, totals |
| 2 | `oklch(0.50)` 6.00:1, **hatched** (45deg, 1px `--foreground` lines) | `oklch(0.70)` 7.41:1 (7.04 card), hatched | second series |
| 3 | `oklch(0.66)` 3.11:1 | `oklch(0.52)` 3.59:1 (3.41 card) | third series, de-emphasised |

Adjacent luminance steps are 3.30 and 1.93 (light), 2.56 and 2.06 (dark): they are not enough on their own, which is
why rule 2 requires the gap, the hatch and direct labels. Ordinal ramp `--viz-o1..o4` (ordered stages such as the
reply funnel): light `0.66 / 0.55 / 0.42 / 0.30` (3.11 to 13.6:1), dark `0.52 / 0.62 / 0.76 / 0.90` (3.59 to 14.7:1),
darkest = furthest stage in light, lightest in dark so "more" is always "more contrast". Single series (`--viz-seq`):
series 2 value. `--destructive` only for a series that literally means rejected or failed.

- Charts allowed: bar (counts per day/week), horizontal bar (ranking), stacked bar (status split), funnel as
  horizontal bars with conversion %, line (trend, at most 3 series). No pies, no donuts, no gradients, no 3D.
- Every chart has: a title that states the finding ("You edit 38% of what skiffr fills, up 1 point"), an axis with
  units, a "Show as table" disclosure, `role="img"` with a text alternative, a minimum-sample note when n is small
  ("Based on 4 applications"), and an empty state in place (not a missing card).
- Numbers: `tabular-nums`, locale formatted, deltas as `+3` / `-2` with a word, not coloured arrows.
- Tooltips open on focus as well as hover; the table fallback is the keyboard path to every value.
- Draw-in: 300ms max, once (2.6).
- Tiles: label (muted), number (3xl), one-line note, optional delta. At most 4 per row, 1 per row below `sm`.

### 4.9 Answer pattern (the core object)

(Internal name "learned answer"; in the UI it is just "answer".) An answer row or panel always shows: **question**
(as seen on the form), **value**, **status badge**, **where it came from** (source: you typed it / learned from a
correction / drafted by AI / imported, plus the last sites it was used on, e.g. `boards.greenhouse.io/northwind`),
**confidence** (a labelled word, not a score: "Solid" used 5+ times and left as filled, "Unsure" corrected recently or
flip-flopping, "New" used fewer than 3 times), **last used** (relative), **times used / times corrected** as one muted
line, and actions (Edit inline, Confirm, Stop filling, Delete). Conflicts (same question answered two ways) are
surfaced at the top of the page as a review queue, with side-by-side values and "Keep this one". Bulk: select rows,
"Confirm", "Stop filling", "Delete". Sensitive questions are marked and explained ("never filled automatically").
Sites and last used need the answer provenance api; until it exists the row shows what the answer record has.

### 4.10 Connection health pattern

Anything that connects (extension, Gmail, Reactive Resume, each source) shows the same block: state badge
(Connected / Needs attention / Not connected), last activity relative ("last filled 2h ago"), the next scheduled run
when there is one, the one action to fix it, and the reason in plain words when it is broken. A compact version (dot +
word) sits in the user menu and on Today.

## 5. Copy guidelines

- Plain, second person, present tense, short. "skiffr" fills forms; "you" press submit. No exclamation marks, no
  emoji, no "simply", "just", "easy".
- Sentence case for every heading, label, button and menu item. Brand lowercase.
- Buttons are verb + object ("Add job", "Sync now", "Revoke token"). No "Submit", "OK", "Yes".
- Say what happened and what to do: "Gmail needs to be reconnected. Reconnect" not "Authentication error".
- Errors never blame the user and never show codes (put them in a collapsible "Details" with the request id).
- Names: job (not "posting" and "role" at once), queue, answer, source, token (headings say "Extension tokens"; a user
  can have many per device), "Resume" in the nav (the integration is "Reactive Resume").
- Dates and numbers follow 4.3. Counts: "1 job", "24 jobs".
- Explanatory "What skiffr does with ..." text blocks live in a collapsible "How this works" (closed by default after
  the first view) so they do not compete with the controls.
- Copy about a feature must match what ships: no "coming soon" for things that exist.

## 6. Accessibility checklist (WCAG 2.2 AA), run per PR

- [ ] Contrast: text at least 4.5:1 (3:1 for 18px+ or 14px bold); control borders, focus ring, chart marks and
      icons that carry meaning at least 3:1. Check both themes.
- [ ] Focus: visible 2px solid ring on every interactive element; never `outline-none` without replacement; focus
      not obscured by sticky bars (`scroll-padding-top` and bottom); logical order equals visual order.
- [ ] Keyboard: every action reachable and operable; no traps; `Esc` closes overlays; list navigation per 4.3; focus
      returns to the trigger after a dialog closes and moves to the next row after a row is removed.
- [ ] **Character key shortcuts (2.1.4)**: single-key shortcuts only fire while focus is inside the page content or
      the list, never from a text field, and can be turned off in Appearance. Modified shortcuts (`⌘K`) are global.
      See 3.2.
- [ ] Landmarks: `header`, `nav` (labelled), `main#main`, skip link. One `h1`, then `h2` sections in order, no skipped
      levels. Pages use `Section` for h2; a card title that is a heading uses `CardTitle as="h2"`.
- [ ] Names: icon-only buttons have `aria-label`; labels are programmatically tied (`htmlFor`/`aria-labelledby`);
      links say where they go; "Open" rows include the job name.
- [ ] Status: never colour alone; badges have text; live regions for async results (`role="status"`), alerts for
      errors (`role="alert"`).
- [ ] Targets: at least 24px (WCAG 2.5.8), 44px on coarse pointers (checkbox and switch exception in 2.3).
- [ ] Forms: `autocomplete` tokens, correct `type`/`inputmode`, 16px font on mobile, errors tied to fields.
- [ ] Motion: respects reduced motion; nothing flashes; no auto-moving content.
- [ ] Zoom/reflow: usable at 200% zoom and 320px wide without horizontal scroll or clipped content; text spacing
      overrides do not break layout.
- [ ] Time: nothing times out silently; toasts with actions persist long enough (8s) and pause on hover/focus.
- [ ] Automated: axe-core run in the e2e on each route in light and dark with 0 serious/critical violations.

## 7. Responsive rules

- 320 to 1920 with no horizontal page scroll (tables scroll inside their own container only if they cannot stack).
- `< md`: top bar and bottom tab bar (3.1), single column, list rows stack, filters collapse into a `Filter` sheet with
  an active-count badge, the primary page action of a loop page becomes a sticky bottom action above the tab bar
  (queue: "Open next").
- `md` to below `xl`: icon rail sidebar, content gets the full width up to its max. Detail opens in the modal sheet.
- `>= xl` (1280): full sidebar; queue and answers show the detail as an inline pane beside the list.
- `>= 1920`: content max width stays (6xl); do not stretch tables to 1700px.
- Test matrix per page: 320, 390, 768, 1024, 1280, 1440, 1920 x light, dark. Screenshots named
  `<page>-<width>-<scheme>.png`.

## 8. Performance rules

- Server-render the first meaningful view and prefetch the page's queries (done for queue, extension, gmail, sources,
  cv status); **no client fetch on first load of a route for data the page needs to paint**. The answers bank is the
  exception that must go: it loads up to 2000 rows in the browser after paint and shifts the layout; page it from the
  API or stream it with Suspense and a skeleton of the same height.
- `loading.tsx` on every route.
- Lists over 100 rows are paginated server-side or virtualised; row components are memoised.
- Third-party data never blocks the page. The resume list on the Resume page is fetched from the user's Reactive
  Resume instance by a client query after the page paints (skeleton, error with retry; the transport times out and
  surfaces as an error). Keep it that way and add an explicit "taking longer than usual" state, so the connection
  block never waits on it.
- Keep the JS for charts small (the charts are plain CSS, keep it that way); lazy-load the command palette and dialogs
  with heavy content (tailoring).
- Fonts: `display: swap`, preload the two used weights, subset latin.
- Budget: LCP < 1.8s, CLS 0, INP < 200ms on a seeded dataset (60 jobs, 45 answers); report with each page PR.

## 9. Implementation map

| area | files |
| --- | --- |
| tokens, primitives | `packages/ui/src/styles/*.css`, `packages/ui/src/components/*` |
| shell | `apps/dashboard/app/(app)/layout.tsx`, `components/app-sidebar.tsx`, `components/page-header.tsx`, `components/shell/*` |
| format helpers | `apps/dashboard/lib/format.ts`, `components/time.tsx` |
| settings | `apps/dashboard/app/(app)/settings/**`, `components/settings/*` |

Per page work is tracked on #104.
