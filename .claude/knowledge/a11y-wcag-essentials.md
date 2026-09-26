---
name: a11y-wcag-essentials
description: WCAG 2.2 in practice - the four POUR principles, conformance levels and what AA means, contrast and target-size numbers, the criteria new in 2.2, and how to set an accessibility requirement
domain: web-development
tags: accessibility,wcag,wcag-2-2,conformance,contrast,pour,legal
apply_when: "setting an accessibility target; asked whether a site is WCAG compliant; choosing contrast and focus styles; a client or law requires WCAG; deciding what to test at Level AA"
sources: "W3C WAI - WCAG 2.2 at a glance; What's new in WCAG 2.2; Understanding conformance; Understanding 1.4.3 Contrast (Minimum); Understanding focus criteria (all read); MDN - HTML accessibility (read)"
last_reviewed: 2026-09-25
confidence: high
---

# WCAG essentials

## Structure

WCAG 2.2 is organised under four principles (**POUR**): **Perceivable** (text alternatives, captions, adaptable and distinguishable content), **Operable** (keyboard access, enough time, no
seizure triggers, navigable, input modalities), **Understandable** (readable, predictable, input assistance) and **Robust** (compatible with current and future assistive technology).
Under them sit guidelines and testable **success criteria** at levels A, AA and AAA. Conformance levels are cumulative: AA means all A and all AA criteria are met.

WCAG 2.2 is backwards compatible: criteria from 2.0 and 2.1 remain essentially the same, so meeting 2.2 also meets 2.1. Criterion 4.1.1 Parsing was removed as obsolete.

## Conformance rules that matter

- Conformance applies to **complete pages**; it cannot be claimed if part of a page is excluded. Every responsive layout variant must conform.
- Content may rely only on **accessibility-supported** ways of using technologies.
- W3C does not recommend requiring **AAA** as a general policy for entire sites, because some AAA criteria cannot be met for some content. **AA is the usual target**, and often the legal one; confirm what your law or contract names.
- A formal conformance claim is optional but must state the level, technologies relied on, how testing was done and dates.

## New in 2.2 (nine criteria)

| Criterion | Level |
|---|---|
| 2.4.11 Focus Not Obscured (Minimum) | AA |
| 2.4.12 Focus Not Obscured (Enhanced) | AAA |
| 2.4.13 Focus Appearance | AAA |
| 2.5.7 Dragging Movements | AA |
| 2.5.8 Target Size (Minimum) | AA |
| 3.2.6 Consistent Help | A |
| 3.3.7 Redundant Entry | A |
| 3.3.8 Accessible Authentication (Minimum) | AA |
| 3.3.9 Accessible Authentication (Enhanced) | AAA |

Design consequences: keep focused controls from being hidden by sticky headers or banners; give a non-dragging alternative for drag
interactions; make targets large enough; do not force users to re-enter information already given; do not require cognitive tests (such as memorising or transcribing) for login,
which aligns with password-manager and passkey friendliness (`authn-mfa-passkeys`).

## Numbers designers need

- **Contrast, 1.4.3 (AA)**: at least 4.5:1 for normal text, 3:1 for large text (18 pt, or 14 pt bold; roughly 24 px and 18.5 px). Exceptions: decorative text, inactive controls, logos, incidental text in photos.
- **Focus Visible (AA)**: a visible focus indicator must exist for keyboard focus. Focus Appearance (AAA) sets a 2 CSS px perimeter and a 3:1 change in contrast between states, a good design target even though it is AAA.
- Do not use colour alone to convey meaning.

## Making it a requirement

State: "WCAG 2.2 Level AA for all templates and components", plan an audit before launch, and treat regressions as bugs (`lifecycle-requirements-nfr`, `lifecycle-launch-readiness`). Build accessibility into the design system
components once (`ux-design-systems`). Semantics first: `fe-html-progressive-enhancement`; keyboard and ARIA: `a11y-aria-keyboard-focus`; how to test: `a11y-testing`.

## Use when

- Writing the requirement, reviewing designs, or preparing an accessibility statement.

## Do not use when

- Do not treat WCAG as a complete definition of usability for disabled people; it is a minimum set of testable criteria (`ux-research-usability`).
- Do not claim "compliant" from an automated scan.

## Trade-offs

- AA constrains colour, motion and pattern choices, and retrofitting costs far more than designing it in.
- Chasing every AAA criterion is not recommended as a blanket policy; adopt those that fit the audience.

## Common mistakes

- Low-contrast placeholder and disabled-looking text that is actually interactive.
- Sticky headers that hide focused elements.
- Accessibility as a final-week audit.

## Related

- Notes: `a11y-aria-keyboard-focus`, `a11y-testing`, `fe-html-progressive-enhancement`, `ux-forms-errors`,
  `ux-design-systems`, `lifecycle-requirements-nfr`
- Skills: `ux-audit`, `ui-ux-pro-max`
