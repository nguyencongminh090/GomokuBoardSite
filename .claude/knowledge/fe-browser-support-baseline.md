---
name: fe-browser-support-baseline
description: Deciding which browsers and features to support - Baseline (newly and widely available), feature detection with @supports instead of browser sniffing, polyfills and graceful fallbacks
domain: web-development
tags: browser-support,baseline,feature-detection,polyfill,cross-browser,supports
apply_when: "choosing whether a new CSS or JS feature is safe to use; defining the supported browser list; a feature breaks in one browser; deciding on polyfills"
sources: "web.dev - Baseline (read); MDN - Feature detection (read); GOV.UK - Using progressive enhancement (read); MDN - Cross browser testing strategies (page not found, not read)"
last_reviewed: 2026-09-25
confidence: high
---

# Browser support and Baseline

## Baseline

Baseline (started by the Chrome team, now governed by the WebDX Community Group) labels web
features by cross-browser availability, using four core browsers on desktop and mobile:
Chrome (desktop and Android), Edge, Firefox (desktop and Android) and Safari (macOS and iOS).

| Status | Meaning |
|---|---|
| Limited availability | not yet in all core browsers |
| Newly available | supported in all core browsers, so interoperable |
| Widely available | 30 months since it became newly available; most sites can use it without worrying about support |

Default policy: use widely available features freely; use newly available ones if your
analytics show users are on current browsers or you provide a fallback; use limited features
only as an enhancement behind detection.

## Define the support list

State it as a requirement (`lifecycle-requirements-nfr`): from analytics, list browsers and
versions that matter, and the support level for each (full, works but simplified). "Works" means
core tasks complete; it does not mean identical pixels.

## Feature detection, not sniffing

MDN: test whether a browser supports a feature and branch on the result; avoid detecting the
browser itself ("browser sniffing"), which is fragile and discouraged.

- **CSS**: `@supports (property: value)` with `and`, `or`, `not`; put the fallback outside the block or in `not`. `CSS.supports()` in JavaScript.
- **JavaScript**: check that a member exists (`"geolocation" in navigator`), test an element property, or use `matchMedia()`. Provide an alternative path when the check fails.
- **Polyfills** add missing features to older browsers when detection is not enough; load them only when needed, since they cost bytes.

## Progressive enhancement is the strategy

Serve HTML that works everywhere, then layer CSS and JavaScript (`fe-html-progressive-enhancement`).
CSS ignores unknown declarations, so a modern property after a supported one often needs no
detection. A JavaScript syntax error, however, stops the whole script, so transpile syntax for
your target list (`fe-build-tooling`).

## Testing

Test the main journey in each supported browser family and on real devices where possible, using
manual passes for critical flows and automated cross-browser runs (`webtest-strategy`, `webtest-e2e-browser`).
Test with the network throttled and with JavaScript off.

## Use when

- Adopting a new API or CSS feature, setting a browserslist, or triaging a browser-specific bug.

## Do not use when

- Do not apply "widely available" as a guarantee for every user; it is based on four core browsers, not on your audience or on embedded or older browsers.
- Do not sniff the user-agent string to work around a bug when a feature test exists.

## Trade-offs

- Wider support costs code, polyfills and test time; each extra browser needs a user reason.
- Using newly available features early gives capability and shifts fallback work onto you.

## Common mistakes

- No written support list.
- Assuming one engine (usually the developer's own browser) is the whole web.
- Polyfilling everything for everyone.

## Related

- Notes: `fe-css-architecture`, `fe-build-tooling`, `fe-html-progressive-enhancement`,
  `lifecycle-requirements-nfr`, `ux-responsive-mobile-first`
