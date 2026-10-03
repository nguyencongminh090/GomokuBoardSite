---
name: ux-responsive-mobile-first
description: Responsive web design essentials - viewport tag, fluid layout with flexbox and grid, media queries in relative units, responsive images and type, mobile-first ordering
domain: web-development
tags: responsive,mobile-first,viewport,media-queries,css-grid,flexbox,images
apply_when: "a page must work on phones and desktops; layout breaks at some width; choosing breakpoints; serving images for different screens"
sources: "MDN - Responsive web design (read; re-verified 2026-09-26: default viewport width, relative-unit breakpoints); MDN - Container queries (read); web.dev - Learn Responsive Design course outline (read); GOV.UK - Using progressive enhancement (read)"
last_reviewed: 2026-09-26
confidence: medium
---

# Responsive design and mobile-first

Responsive design is not a technology but a set of practices: flexible layouts, media
queries and fluid media so one page renders well at any screen size.

## Building blocks

1. **Viewport meta tag**: `<meta name="viewport" content="width=device-width">`. Without it mobile browsers lay the page out at a default width of about 980 px and shrink it.
2. **Fluid layout**: flexbox and grid are flexible by default; prefer them over floats and fixed pixel widths.
3. **Media queries**: apply extra CSS by conditions. Use relative units (`em`, `rem`) for breakpoints so layout follows user font-size settings.
4. **Breakpoints from content**: add a breakpoint where the design starts to look wrong, not at popular device widths.
5. **Fluid media**: `max-width: 100%` on images and video; `<picture>` with `srcset` and `sizes` to serve suitable file sizes.
6. **Type**: rem-based sizes; `calc()` with a viewport unit can scale smoothly while staying zoomable.

## Media queries versus container queries

Media queries respond to the viewport or device (width, orientation, color scheme): use them
for page-level layout and user preferences. Container queries (`container-type`, `@container`)
respond to the size of a component's container, so the same component works in a sidebar and in
the main column: use them for reusable components placed in several contexts. MDN suggests grid or
flexbox with a media-query fallback where support is missing; check Baseline status
(`lifecycle-requirements-nfr`) against your browser targets before relying on them.

## Mobile-first

Write the base CSS for a narrow, single-column layout and add complexity in media queries for
wider screens. This suits progressive enhancement (start with content that works everywhere,
then add). The course outline from web.dev also lists preparing for different inputs (mouse,
keyboard, touch), user preferences such as dark mode, and internationalisation (writing modes)
as part of responsive work.

## Testing

Check real devices or emulation at narrow, medium and wide widths; zoom to 200 percent; test
touch and keyboard; test slow networks. Verify in field data that mobile users meet the
performance targets (`lifecycle-requirements-nfr`).

## Use when

- Any public web page; most traffic is on phones for many sites, so check analytics.

## Do not use when

- Do not maintain a separate mobile site unless there is a proven reason; two sites double the cost and fragment URLs.
- Do not hide important content on small screens; reorganize instead.

## Trade-offs

- One flexible layout is cheaper than many fixed ones but needs disciplined CSS and testing.
- Serving multiple image sizes saves bytes and adds build and markup complexity.

## Common mistakes

- Missing viewport tag.
- Breakpoints in pixels copied from a device list.
- Disabling zoom, which harms accessibility.
- Huge desktop images shipped to phones.

## Related

- Notes: `ux-design-systems`, `ux-forms-errors`, `ux-information-architecture`, `apptype-web-frontend`
- Skills: `google-style-html-css`, `frontend-design`
