---
name: vbase-layout-spacing
description: Layout and spacing rules behind any style - grids and gutters, a spacing scale, proximity grouping, whitespace as a hierarchy tool, and responsive layout limits
domain: visual-design
tags: layout,grid,spacing,whitespace,proximity,spacing-scale,responsive,density
apply_when: "a page looks cramped, random or empty; setting up a grid and spacing tokens; a style calls for airy, dense or modular layouts; adapting a desktop layout to mobile"
sources: "NN/g - Good Visual Design (Gordon 2025), Visual Hierarchy in UX (Gordon 2021), 5 Principles of Visual Design (Gordon 2020), Neobrutalism (Sheikh 2025), Cards (Laubheimer 2016); Wikipedia - International Typographic Style; MDN - Responsive web design; Wathan and Schoger - Refactoring UI (publisher page only)"
last_reviewed: 2026-09-26
confidence: medium
---

# Layout and spacing

## Grid

- Use a grid with consistent columns and gutters so elements align across sections (NN/g,
  Gordon 2025). Swiss-style design made this the base of modern layout (Wikipedia).
- Match gutters to purpose: narrow for dense information, wide for calm separation.
- Let the grid adapt across screen sizes; content decides breakpoints, not device names
  (`ux-responsive-mobile-first`).
- Limit the reading column: a text block wider than roughly 66 characters reads badly
  (`vbase-typography`).

## Spacing scale

- Choose a base unit (commonly 4 or 8 px) and derive all margins, paddings and gaps from a
  small scale (for example 4, 8, 12, 16, 24, 32, 48, 64). Store it as tokens
  (`ux-design-systems`). This is common practice rather than a rule from one source.
- Space between groups must be larger than space inside groups; that alone builds hierarchy
  (proximity, NN/g).
- Emphasise by adding space around an element, not only by making it bigger or colored
  (Gordon 2021). NN/g's neobrutalism note suggests margins of roughly 24-32 px so heavy blocks
  do not merge.
- Prefer spacing, background change or elevation over borders to separate content; too many
  borders clutter (Wathan and Schoger, publisher page).

## Density by style

| Style direction | Density | Notes |
|---|---|---|
| Minimal, luxury, editorial | low, large margins | space signals value; avoid empty-looking pages |
| Flat apps, SaaS | medium | consistent 8 px rhythm, cards or sections |
| Dashboards, tools | high | clear grid and grouping matter more than space |
| Bento, modular | medium, tile-based | one message per tile; watch reading order (`vstyle-bento-modular`) |
| Maximalist, brutalist | varies | hard edges and blocks need whitespace around them to stay legible |

## Responsive rules

- Mobile first: design the narrow layout first, add columns as width allows.
- Touch targets need comfortable size and gaps; WCAG 2.2 adds a minimum target size at AA
  (SC 2.5.8; the exact size is in `a11y-wcag-essentials`, not re-read here), and about 44 px
  is a common comfort size (common practice).
- Use fluid spacing sparingly (`clamp()` with rem bounds) and keep content readable at 200%
  zoom and 320 px width without horizontal scrolling.
- Decide the vertical order on mobile explicitly; do not rely on the desktop mosaic collapsing
  well.

## Use when

- Setting up a project's layout tokens; reviewing why a page feels off; adapting a style
  (airy versus dense) to a content type.

## Do not use when

- A component library already defines spacing and grid; use its scale and extend it only when
  a real need appears.

## Trade-offs

- Generous space feels premium but lengthens pages and pushes content below the fold; dense
  layouts show more but tire and confuse casual users.
- Strict grids keep order but can look rigid; break the grid once, on purpose, for emphasis.

## Common mistakes

- Random padding values (13 px, 17 px) that break rhythm.
- Equal spacing everywhere, so groups do not read as groups.
- Fixed-width layouts that force horizontal scrolling on phones.

## Related

- Notes: `vbase-visual-principles`, `vbase-typography`, `vstyle-minimalism-swiss`,
  `vstyle-bento-modular`, `ux-responsive-mobile-first`, `ux-design-systems`
- Skills: `ui-ux-pro-max`, `design-system`, `google-style-html-css`
