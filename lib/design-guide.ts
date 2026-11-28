/**
 * Zeko's built-in design guide. Agents read it with get_guide before designing, so every canvas starts
 * from the same craft floor; canvas skills and guidelines add to it, and the person's own words override it.
 */

const DESIGN = `# Designing on Zeko

The person's own words, the canvas guidelines and any skill they named come first. This guide fills in
whatever they leave open. Where they pin a look, a font or a palette, follow it exactly, even if it is
something this guide steers away from.

## 1. Know what you are designing

Before choosing a single color, name three things: who uses this screen, the one job they came to do, and
where they are when they do it (at a desk all day, on a phone between errands, on a big screen in a meeting).
If the request does not say, infer it from the canvas (guidelines, frames, references) and say what you assumed.

Then name the surface's mode, because it decides how much expression the screen can carry:
- Sell: landing pages, pricing, campaigns. The design is the argument; take a clear visual position.
- Work: app screens, dashboards, editors, settings. Speed, scanning and consistency win; personality lives
  in small precise details. Read the "product-ui" guide.
- Read: docs, articles, help. Measure, rhythm and navigation come first.
- Show: portfolios, galleries. The work leads and the interface steps back.

Decide what the screen must do best: impress or clarify. Exploring a look, a brand or a launch page asks for
a strong, memorable point of view. Solving a product problem asks for clarity first, and style that never
gets in the way. Say which one you are aiming for.

When the request is short and open ("design a landing page", "show me something") and the canvas gives you
nothing to follow, pick one deliverable you can finish to a very high standard and make it remarkable,
rather than a broad, thin set of screens.

Brands with personality (consumer apps, food, games, kids, events) can take a playful register: a second
or third accent from the same world, a tilted sticker, a hand-drawn mark, a mascot or a wordmark with
character, copy with a wink. Choose one or two of these, never all of them.

## 2. Write the brief first

For a new screen or a new look, and unless the canvas guidelines already settle palette and type, open your
reply with a short brief before the first create_sketch. It is part of the work, so keep it to these lines:
- Subject: the user, the job and the mode, in one sentence.
- World: a concrete setting the product belongs to (a ferry terminal, a seed catalogue, a hospital night
  shift, a print shop). List two or three candidates and commit to one that is not the most obvious.
- Palette: 4 to 6 hex values, each with a role (ground, surface, text, muted text, accent, signal), each traced
  to something in that world. A color you cannot trace to the world is decoration; drop it.
- Type: one or two families with their roles, and the size scale in px.
- Layout: one sentence on the structure and alignment, and the one element you will make memorable.

Then test it: if the same brief would come out for any product in this category, change the part that is
generic and say what you changed. Your first idea for a world is usually everyone's first idea; when two
candidates fit equally, take the less expected one.

Worlds and the palettes they give (examples of the method, not a menu; pick values that fit your world):
- Ferry terminal: harbor-fog white ground, deck-paint navy text, life-ring orange accent.
- Seed catalogue: uncoated-paper ground, pressed-leaf green, beet-red for the one call to action.
- Hospital night shift: dimmed graphite ground, monitor-trace cyan, alarm amber kept for real alerts.
- Print shop: pure white ground, process black, one flat ink such as cyan or magenta as the accent.
- Observatory: deep blue-black ground, starlight white text, brass for the accent.
- Ski lodge: snow white ground, pine green, a wool-red accent.
- Laboratory: clean white ground, steel-gray structure, a single indicator color such as reagent violet.
- Night market: wet-asphalt ground, lantern red and one neon (pink or yellow), used sparingly.
- Archive: off-white file-card ground, typewriter-ribbon black, a faded stamp blue. When the canvas has no guidelines yet and the person keeps the result,
record the palette, type and voice with update_guidelines (when you have it) so the next screen matches.

## 3. Color

- Most product UI wants a plain ground: white or near-white in light mode, a neutral near-black in dark mode.
  Tinted grounds (cream, paper, sand) are a choice that a world earns, not a neutral.
- Pick light or dark from where the screen is used, not from the category.
- One accent carries the brand. Use it where action or meaning is, not as wallpaper. Status colors (success,
  warning, danger, info) are separate from the accent and come from the same world.
- Grays are either truly neutral or tinted toward the palette for a reason. On a colored surface, tint
  secondary text from that surface's hue instead of laying gray on top.
- Design hierarchy first with size, weight and space; then add color. If a screen only reads in color it does
  not read.
- Contrast: body text at least 4.5:1, large text (24px and up, or 19px bold) at least 3:1, controls and
  focus rings at least 3:1 against what is around them. Check small and muted text; that is where it fails.

## 4. Type

- One family can carry a whole product; two if they are clearly different (a serif display with a sans
  body, a grotesk with a mono for real data). Never three.
- Choose a family for this product, not the default you reach for everywhere. Load it from Google Fonts
  in the sketch's <head>, and check the weights you use exist.
- Set a scale and keep to it: a ratio of about 1.2 for dense product UI, 1.25 to 1.333 for marketing and
  reading. Five or six sizes are plenty.
- Body 15 to 18px, line-height 1.4 to 1.6, measure 60 to 75 characters. Display line-height 1.0 to 1.15.
- Tighten large type slightly (-0.01 to -0.03em); never below -0.04em. Give small caps and tiny labels a
  little positive tracking. Avoid text under 12px outside dense data tables.
- Make contrast between levels obvious: a heavy display against regular body, not 600 against 500.
- Use tabular numerals (font-variant-numeric: tabular-nums) for numbers that stack in columns or update in
  place (tables, prices, counters). Many fonts widen the colon and period in tabular mode, so check times
  like 10:00 in the screenshot and drop it where the spacing looks broken.

## 5. Space and layout

- Use one spacing scale on a 4px base (4, 8, 12, 16, 24, 32, 48, 64, 96). Put tokens on it when the canvas has them.
- Spacing encodes grouping: related things sit close, groups sit far apart, and a heading has more space
  above it than below.
- Start with too much space and take it away. Empty space around the main content is a choice, not a gap.
- Prefer asymmetry and clear scale contrast to a grid of equal boxes. Let content live on the surface;
  add a container only when it groups or separates something.
- Repeated rows align in lanes: give icons, avatars, checkboxes and trailing actions fixed-width slots
  (width plus flex-shrink: 0) so columns line up even when a slot is empty.
- Elevation is declared once per element: a border or a shadow, not both. Shadows have an offset and a soft
  blur; layer two for realism. Inner radius never exceeds the outer one.
- Radii follow the element's size: 4 to 8px for inputs and small controls, 10 to 16px for cards and panels,
  full pills only for small chips and toggles.

## 6. Content

- Write real copy for this product: real names, plausible numbers (1,284 not 1,000+), real dates, real
  product nouns. No lorem ipsum, no "John Doe", no "Feature one".
- Name things the way users do, not the way the system is built. Buttons say what happens ("Book class",
  "Save changes"), and the result repeats the verb ("Class booked").
- Sentence case for headings, buttons and labels unless the guidelines say otherwise.
- Errors say what happened and how to fix it; empty states say what goes here and offer the first action.
- Every structural device (numbers, dividers, labels, badges) must carry information. Numbered markers only
  for real sequences.

## 7. Icons, images and motion

- Icons come from one drawn set in one stroke weight: draw them as inline SVG or place_svg. Never emoji or
  unicode glyphs as icons.
- Prefer real imagery to gray boxes; if you have none, use an honest, styled placeholder that states what goes there.
- Effects (add_shader, gradients, blur, grain) are allowed when they come from the world and appear once.
  One deliberate visual moment beats several scattered ones.
- Motion responds to what the person did. Keep it short (100 to 200ms for small changes, 200 to 300ms for
  larger ones), ease out, and animate transform and opacity.

## 8. Defaults to avoid

These show up whatever the product is, so they read as unconsidered. Use one only when the brief asks for it.
- A page built from identical rounded cards, each an icon, a heading and a line of text. Do instead: vary
  scale and span by importance, or drop the cards and set the content on the surface.
- A hero of one huge number, a small label and three stats. Do instead: lead with the product's most
  characteristic thing (the real interface, the object, a sentence that only this product could say).
- A small tracked-out uppercase label above every heading. Do instead: let the heading stand alone.
- Purple-to-blue gradients, gradient text, glows on every card, glass as decoration. Do instead: a solid
  accent used where it means something.
- A colored bar down one side of a rounded box. Do instead: a full border, a tint or a leading icon.
- One radius and one soft gray shadow on everything. Do instead: radii by size and one elevation system.
- Cream ground with a serif display and a terracotta accent; near-black with one acid-green accent. Do
  instead: derive the palette from the world in your brief.
- Monospace as costume for "technical". Do instead: mono only for code, IDs and measurements.
- Meta strings joined with middle dots and arrows tacked onto every link. Do instead: plain labels and
  a clear link style.

## 9. Review before you report back

Look twice per screen: once after the first section is in (catching a wrong direction early is cheap), and
again when the screen is complete. Call screenshot_frame each time. It also runs automatic checks (fonts
that did not load, missing weights, text below contrast, text under 12px, overflow); fix every one it lists.
Then judge it as a demanding design lead would. Give yourself a one-line verdict on each point below, fix
what fails with targeted edits (edit_layers or edit_sketch), then look again. Do not throw the screen away to
start over unless it is truly beyond repair; a frame that only overflows needs fit_frame_to_content, nothing more.
- Purpose: the main action and content are the first thing you see.
- Hierarchy: you can tell the heading, body and secondary text apart at a glance.
- Spacing: groups are clear, gaps follow the scale, nothing feels cramped or stranded.
- Alignment: edges and lanes line up across rows and sections.
- Contrast and legibility: everything reads without squinting, including muted and small text.
- Fit: nothing clips or overflows (inspect_frame reports overflow); use fit_frame_to_content
  instead of guessing a height.
- Character: the screen could not be mistaken for a template of its category, and it matches the brief.

## 10. Several directions

When asked for alternates or options, make each one a different point of view, not a recolor: change the
world, the type and the layout idea together. Name each variant after its idea, create it with variant_of,
and say in one line what each one bets on.`

const PRODUCT_UI = `# Product screens (Work mode)

Use this for app screens, dashboards, admin, editors, settings and tools.

## Layout and density
- Design at the real viewport: 1440 x 900 for desktop apps, 390 x 844 for phones (read the "mobile" guide),
  unless the canvas says otherwise.
- Put the navigation, the current context (where am I) and the primary action in predictable places.
  One primary button per view; the rest are secondary or quiet.
- Density follows use: tools used all day can be compact (13 to 14px body, 32px rows); occasional flows get
  more room (15 to 16px, 44px rows).
- Tables: left-align text, right-align numbers, tabular numerals, a sticky header, and row actions in a
  fixed trailing slot. Avoid zebra stripes and heavy borders; use spacing and a hairline.
- Do not open a dashboard with a row of summary-number boxes unless those numbers are what people act on.
  Lead with the list, queue or chart that drives the work.
- Prefer inline disclosure and side panels to modals. Use a modal only for a decision that must interrupt.

## Controls
- Hit targets at least 24px on desktop and 44px on touch; expand the hit area when the visual is smaller.
- Text inputs at least 16px on mobile. Labels above fields, help text below, errors next to the field.
- Two or three fixed options: radio buttons or a segmented control, not a select.
- Every interactive element has a visible hover, pressed and keyboard focus state, each with more contrast
  than the resting state.
- Destructive actions name the object ("Delete project") and offer undo or a confirmation; never "OK".

## States
A screen is not finished until its states are designed. Make each one a frame with the same route and its
own state (loading, empty, error, and others the product can actually reach), so get_state_map can show
what is missing:
- Loading: a skeleton that mirrors the final layout, not a centered spinner on a blank page.
- Empty: what goes here, why it is empty, and the first action.
- Error: what failed and the way out, in the interface's voice.
- Also consider: partial or sparse data, very long names and numbers, permission denied, offline,
  and success confirmations.

## Consistency
- Reuse the canvas's components (insert_component) and tokens (var(--name)) before drawing a new one.
- The same thing looks and is named the same everywhere: one style per button role, one word per concept.`

const MOBILE = `# Phone and tablet screens

## Frame sizes
Unless the person or the canvas says otherwise: phone 390 x 844, tablet 834 x 1194, desktop 1440 x 900.
The height is the first screenful; grow it with fit_frame_to_content when the content runs longer.

## Phone anatomy
- Start the frame with a status bar, 54px tall, then the screen's own top bar. Paste this one as the first
  child of <body> and change only its color (currentColor follows the text color you set on it):

<div class="status-bar" style="height:54px;display:flex;align-items:center;justify-content:space-between;padding:0 30px 0 36px;font:600 17px/1 -apple-system,system-ui,sans-serif;color:#000;flex-shrink:0">
  <span>9:41</span>
  <svg width="78" height="14" viewBox="0 0 78 14" fill="currentColor" aria-hidden="true">
    <rect x="0" y="9" width="3.5" height="5" rx="1"/><rect x="5" y="6.5" width="3.5" height="7.5" rx="1"/>
    <rect x="10" y="3.5" width="3.5" height="10.5" rx="1"/><rect x="15" y="0.5" width="3.5" height="13.5" rx="1"/>
    <path d="M31.5 3.2a11 11 0 0 1 7.6 3l1.3-1.4a13 13 0 0 0-17.8 0l1.3 1.4a11 11 0 0 1 7.6-3Zm0 4a7 7 0 0 1 4.8 1.9l1.3-1.4a9 9 0 0 0-12.2 0l1.3 1.4a7 7 0 0 1 4.8-1.9Zm0 4a3 3 0 0 1 2 .8l-2 2.1-2-2.1a3 3 0 0 1 2-.8Z"/>
    <rect x="49.5" y="1" width="24" height="12" rx="3.5" fill="none" stroke="currentColor" stroke-opacity=".4"/>
    <rect x="51.5" y="3" width="17" height="8" rx="2"/><path d="M75.5 5v4a2 2 0 0 0 0-4Z" fill-opacity=".45"/>
  </svg>
</div>

- On a dark top area, set color:#fff on the status bar. Do not redraw these icons.
- End screens that have no bottom bar with a 34px home-indicator zone (a 134 x 5px rounded bar, centered,
  8px from the bottom) so content does not sit under it.
- Margins 16 to 20px at the sides. Body text 16 to 17px. Touch targets at least 44 x 44px.
- Bottom tab bar: 3 to 5 destinations, icon plus short label, 49px plus the home-indicator zone.
- Primary actions sit within thumb reach, at the bottom of the screen, full width or in a sticky bar.
- Large titles (28 to 34px bold) for top-level screens, a compact 17px centered title for pushed screens with
  a back control on the left.
- Sheets and dialogs come up from the bottom, with a grabber and a clear dismiss.

## Tablet
Use the extra width for a sidebar or a two-pane list and detail layout, not for stretched phone content.`

const COPY = `# Words in the interface

- Every piece of text has one job. Cut words that do not change what the person does or understands.
- Write for the user's goal in their vocabulary: "Notifications", not "Webhook config".
- Active voice and plain verbs. Buttons name the result: "Send invite", "Book class", "Export CSV".
  Keep the verb through the flow: "Publish" leads to "Published".
- Sentence case. No exclamation marks in system messages. No filler such as "Simply", "Just" or "Easily".
- Headlines on marketing pages say something only this product could say; avoid "Unlock", "Supercharge",
  "Seamless", "Elevate" and "Next-gen".
- Errors: what happened, why if it helps, and what to do next. Never apologize vaguely or blame the user.
- Empty states: what will appear here and the first step to get it.
- Numbers and names are specific and plausible; dates and currencies follow the product's locale.`

export const DESIGN_GUIDES = {
  design: { title: 'Design method', summary: 'Brief, color, type, space, content, defaults to avoid and the review checklist. Read before designing.', text: DESIGN },
  mobile: { title: 'Phone and tablet', summary: 'Frame sizes, a ready status bar to paste, safe areas, touch targets and phone navigation.', text: MOBILE },
  'product-ui': { title: 'Product screens', summary: 'Dashboards, app screens, forms and tables: density, controls and the states a screen needs.', text: PRODUCT_UI },
  copy: { title: 'Interface copy', summary: 'Labels, buttons, errors, empty states and marketing headlines.', text: COPY },
} as const

export type DesignGuideTopic = keyof typeof DESIGN_GUIDES

export const DESIGN_GUIDE_TOPICS = Object.keys(DESIGN_GUIDES) as [DesignGuideTopic, ...DesignGuideTopic[]]

export function guideTopicList() {
  return DESIGN_GUIDE_TOPICS.map((topic) => `"${topic}": ${DESIGN_GUIDES[topic].summary}`).join('\n')
}
