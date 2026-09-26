---
name: a11y-aria-keyboard-focus
description: Making interactive web UI operable and understandable to assistive technology - native elements first, the rules of ARIA, keyboard interaction, tab order, roving tabindex and focus management
domain: web-development
tags: accessibility,aria,keyboard,focus,tabindex,widgets,screen-reader
apply_when: "building a custom widget (menu, dialog, tabs, combobox); adding role or aria attributes; a page cannot be used with a keyboard; focus is lost after content changes; reviewing a component library"
sources: "W3C WAI-ARIA Authoring Practices Guide - Read Me First; Developing a Keyboard Interface (both read); MDN - HTML accessibility (read); W3C WCAG 2.2 focus criteria (read)"
last_reviewed: 2026-09-25
confidence: high
---

# ARIA, keyboard and focus

## Order of preference

1. **Use native HTML** (`button`, `a`, `input`, `select`, `dialog`, headings, landmarks): keyboard, focus and roles come free (`fe-html-progressive-enhancement`).
2. Only when no native element fits, add ARIA and the behavior it implies.

The APG's first rule: **no ARIA is better than bad ARIA**. Incorrect ARIA misrepresents the interface and can make it worse than no attributes at all.

## What ARIA is

- It supplies **semantics only** (role, state, property) to assistive technology, "like a CSS for assistive technologies". It adds **no behavior**: no keyboard handling, no focus management, no styling.
- **A role is a promise.** `role="button"` promises Enter and Space handling, focusability and state changes; if you do not implement them you deceive the user.
- ARIA can enhance (`aria-pressed`, `aria-expanded`) or override (a wrong role can hide the element's native meaning).
- Test with the browser and screen-reader combinations your audience uses; the guide deliberately does not include workarounds for ARIA support gaps.

## Keyboard interface (APG)

- All interactive elements must be operable by keyboard; only one element has focus at a time.
- **Tab order** follows the DOM order, which should match reading order. Avoid positive `tabindex` values; do not reorder visually without matching the DOM.
- Within a composite widget (tabs, menu, listbox, grid) only one item is in the tab sequence; arrow keys move within it, Tab moves out. Two techniques:
  - **Roving tabindex**: the current item has `tabindex="0"`, others `-1`; move the values as focus moves. The browser scrolls the focused item into view.
  - **`aria-activedescendant`**: the container holds focus and points at the active child; needs strict DOM relationships and manual scrolling.
- Follow the standard key patterns of the widget type in the APG rather than inventing your own; keep expected shortcuts (copy, undo) working.
- **Visible focus** must always exist and be distinguishable from selection (WCAG Focus Visible, AA); prefer browser defaults or a clearly stronger custom outline; never remove the outline without replacement. Do not steal focus on page load.
- No **keyboard traps**: users must be able to leave every component with the keyboard.

## Focus management in dynamic UI

Only the first bullet is from the APG page read; the rest is common accessibility practice to confirm with the APG patterns for each widget.

- When content that had focus is removed (deleting a list item), move focus deliberately to a sensible element; otherwise it falls to the body and users lose their place.
- Opening a dialog: move focus into it, keep it there while modal, and return focus to the trigger on close.
- Client-side route changes: move focus to the new content or heading and update the page title (`fe-framework-choice`).
- Announce asynchronous changes (validation errors, search results count) with a polite live region (`ux-forms-errors`).
- Keep sticky elements from covering focused controls (`a11y-wcag-essentials`).

## Use when

- Any custom interactive component, and in reviews of component libraries.

## Do not use when

- Do not add ARIA to native elements that already carry the meaning (`role="button"` on a `button`).
- Do not build custom widgets when a native element or an established, tested library component works.

## Trade-offs

- Custom widgets give design freedom and require implementing everything the platform would have provided.
- Roving tabindex is simpler for scroll behavior; `aria-activedescendant` suits large or virtualised lists but is more delicate.

## Common mistakes

- `div` with click handler and no keyboard support.
- `tabindex` abuse and hidden focusable elements.
- Removing focus outlines.
- Dialogs that let focus escape to the page behind.
- ARIA labels that contradict visible text.

## Related

- Notes: `a11y-wcag-essentials`, `a11y-testing`, `fe-html-progressive-enhancement`, `fe-framework-choice`,
  `ux-forms-errors`, `ux-design-systems`
- Skills: `ux-audit`
