# Vireo DESIGN.md

## 1. Color

Vireo uses a dark, pro-video color system inspired by Premiere, Linear, Framer, and Vercel: low-light surfaces, restrained borders, and one focused accent for primary actions.

- `bg-0` — canvas/background: `#09090b`
- `bg-1` — chrome panels: `#111114`
- `bg-2` — elevated panels/cards: `#18181c`
- `bg-3` — controls/pressed state: `#202026`
- `bg-4` — hover/scrollbar/thumb: `#2a2a31`
- `ink-1` — primary text: `#fafafa`
- `ink-2` — secondary text: `#a1a1aa`
- `ink-3` — tertiary/meta: `#6b6b75`
- `ink-4` — disabled/divider: `#4a4a52`
- `border-1` — standard separator: `#1f1f24`
- `border-2` — elevated separator: `#2a2a30`
- `border-3` — active/focus separator: `#3a3a42`
- `accent` — primary Vireo indigo: `#6366f1`
- `accent-h` — hover accent: `#7c7ff5`
- `rec` — recording/active media: `#ef4444`
- `success` — completion/online: `#10b981`
- `warn` — attention: `#f59e0b`
- `danger` — destructive/invalid: `#ef4444`
- `info` — neutral info: `#3b82f6`

Rules:
- Use `bg-0` only for full-screen canvas/background.
- Use `bg-1` for permanent chrome and panel backgrounds.
- Use `bg-2` for elevated cards, inspectors, dropdowns, and selected controls.
- Use `bg-3` for pressed states and dense control surfaces.
- Never add new random brand colors. Add status colors only if they are reusable across UI.

## 2. Typography

Vireo is text-dense but quiet. Use system UI fonts for readability and monospace only for timecodes, durations, IDs, and technical metadata.

- UI font: `Inter`, `-apple-system`, `BlinkMacSystemFont`, `system-ui`, `sans-serif`
- Monospace: `JetBrains Mono`, `SF Mono`, `Menlo`, `Consolas`, `monospace`
- Display: `Inter Display`, `Inter`, `system-ui`, `sans-serif`

Scale:
- `text-[10px]` — tiny metadata, badges, helper text
- `text-[11px]` — panel labels and compact controls
- `text-[12px]` — default UI text
- `text-[13px]` — body/default page text
- `text-[14px]` — emphasized panel copy
- `text-base` and above — only for marketing/editor empty states, not dense chrome

Weight:
- `font-semibold` for headings and selected controls.
- `font-bold` sparingly for brand marks, badges, and short labels.
- Use `tracking-tight` for brand/title text and `tracking-wider` for small uppercase metadata.

## 3. Spacing

Spacing is compact because the editor is tool-heavy. Keep controls touch-friendly enough for pointer use but dense enough for professional editing.

- Tiny: `0.5` / `1` / `1.5`
- Compact: `2` / `3`
- Panel padding: `3` to `4`
- Dense button height: `26px` to `32px`
- Panel header height: `36px` / `40px`
- TopBar height: `44px`

Rules:
- Use Tailwind spacing tokens unless a pixel-perfect media surface requires inline style.
- Keep timeline/tool controls in `h-[26px]` to `h-9`.
- Keep large surfaces in `min-h-0 min-w-0` grid/flex containers so panels do not push the timeline off-screen.

## 4. Layout

The editor shell follows a Premiere-style NLE grid:

- Top: `TopBar` — brand, project breadcrumb, mode switcher, actions.
- Left: `SideRail` — media/effects/audio/text/style/history/projects rail.
- Center-top: `Preview` — program monitor, largest visual area.
- Right: `Inspector` + `ChatPanel` — stacked tabs/panels for clip properties and AI director.
- Bottom: `Timeline` — full-width multi-track timeline.

Layout rules:
- Use CSS grid for the main editor shell, not nested flex hacks.
- Keep `Timeline` in a bottom row spanning the full editor width.
- Keep `Preview` as the largest center region.
- Keep `Inspector` and `ChatPanel` in the right column with stable widths.
- All panels must be `min-h-0 min-w-0 overflow-hidden` unless the panel itself owns scrolling.

## 5. Components

Component language:
- Panels: `bg-bg-1`, `border-border-1`, `rounded-lg`, subtle inner shadows only when elevated.
- Headers: `h-9`, `px-3`/`px-4`, `text-[12px]`, `font-semibold`, `text-ink-1`, `border-border-1`.
- Buttons: `rounded-md`, `text-[11px]` to `text-[12px]`, `transition-all`, `duration-[120ms]`.
- Primary action: `bg-accent hover:bg-accent-h text-white`.
- Secondary action: `bg-bg-2 border border-border-2 text-ink-1`.
- Icon buttons: `w-7 h-7` or `w-9 h-9`, `text-ink-3` default, `text-ink-1 hover:bg-bg-2`.
- Selected/active: `text-accent bg-accent/10`.
- Disabled: `text-ink-4 cursor-not-allowed`.
- Invalid/destructive: use `danger` only for invalid drop/destructive states, not as a general accent.

Focus:
- Visible focus rings use `accent`.
- Focusable controls must remain keyboard reachable.

Motion:
- Use `transition-all duration-[120ms]` for controls.
- Use `duration-[200ms]` for panels/cards.
- Use `duration-[320ms]` for overlays only.
- Avoid layout-shift during drag/drop or tab changes.

## 6. Motion

Motion must feel fast and deterministic.

- `--ease`: `cubic-bezier(0.2, 0, 0, 1)`
- `--dur-1`: `120ms` — control hover/press
- `--dur-2`: `200ms` — cards/panels
- `--dur-3`: `320ms` — overlays

Animations:
- `pulse-rec` — recording indicator.
- `msg-in` — chat message entry.
- `typing-dot` — streaming assistant dots.

Rules:
- No decorative bouncing.
- No layout-changing transitions during editor operations.
- Prefer opacity/transform over width/height changes.

## 7. Voice

Vireo sounds like a calm pro tool: concise, precise, and confident.

Use:
- Short labels: `Render`, `Export`, `Split`, `Undo`, `Redo`, `Add effect`.
- Technical metadata in monospace: timecodes, IDs, durations.
- AI copy that is directive but not chatty: `Make it more cinematic`, `Cut the silences`, `Add captions`.

Avoid:
- Marketing fluff.
- Placeholder product names.
- Joke copy in production UI.
- Long explanatory paragraphs in dense editor panels.

## 8. Brand

Vireo is a premium AI video editor for creators who want cinematic control without manual busywork.

Visual direction:
- Dark pro-video workspace.
- Indigo/purple accent for intelligence and creation.
- Red only for recording/active media and danger states.
- Clean typography, precise borders, minimal shadows.

Brand mark:
- Square `V` badge with indigo-to-purple gradient.
- Label: `Vireo Studio`.
- Avoid fake partner names or placeholder copy.

## 9. Anti-patterns

Do not:
- Add new random colors or gradients that do not exist in this file.
- Put desktop-shell code back into the web studio.
- Mutate timeline state directly outside the op contract.
- Weaken tests or skip suites to make a day pass.
- Hide layout overflow with arbitrary fixed heights.
- Use `bg-black` or pure white as default UI surfaces.
- Introduce layout-shift during drag/drop, tab switching, or panel resize.
- Mix multiple visual languages in Timeline, Preview, Inspector, and Chat.
