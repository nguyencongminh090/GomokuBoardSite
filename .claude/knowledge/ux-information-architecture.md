---
name: ux-information-architecture
description: Structuring site content (information architecture), navigation as its interface, and designing URLs that stay stable
domain: web-development
tags: ux,information-architecture,navigation,sitemap,urls,content-inventory
apply_when: "planning a sitemap or menu; a site has grown and users cannot find things; choosing URL structure; a redesign will change addresses"
sources: "Nielsen Norman Group - Information Architecture vs Navigation and Card Sorting (read); Google Search Central - URL structure and Site moves (read); Berners-Lee - Cool URIs don't change, W3C 1998 (read); Google Search Central - SEO Starter Guide (read)"
last_reviewed: 2026-09-25
confidence: high
---

# Information architecture, navigation and URLs

**Information architecture (IA)** is the structure of content and functionality: what groups
exist, how they relate, what they are called. **Navigation** is the UI that exposes that
structure. Design IA first; picking navigation components by looks can force a poor IA. NN/g's
example: a fixed inverted-L navigation only accommodates sites about four tiers deep, and
outgrowing it means a costly redesign.

## Method

1. **Content inventory and audit**: list what exists or will exist; drop or merge what nobody needs.
2. **Group and label**: cluster items by the user's mental model, choose one controlled vocabulary (one name per concept).
3. **Test the structure**: card sorting to build it and tree testing to check findability before visual design (see below for sample sizes).
4. **Draw the sitemap**, then design navigation for it; keep depth shallow and labels in user words.
5. Re-check with real tasks in usability tests (`ux-research-usability`).

Card sorting details (NN/g): **open** sorts let people make and name their own groups and are
the usual way to generate a structure; **closed** sorts use fixed categories and are weaker
than tree testing for validation. **Tree testing** (reverse card sorting) checks whether people
can find items in an existing or proposed structure. Sample sizes: at least about 15 participants
for qualitative work, 30-50 for quantitative; 30-50 cards keeps participants from tiring.

## URL design

Berners-Lee's principle: "URIs change when there is some information in them which changes."
Keep addresses free of things that will change: author names, status words (draft, latest),
subject categories that get reorganised, access levels, file extensions and implementation
details (script names). Map stable public URLs to current storage on the server. Google's
guidance for search agrees: use descriptive, logical, readable paths and group related pages
in directories.

Google's URL guidance adds practical rules: use simple descriptive words rather than long IDs;
separate words with hyphens, not underscores; keep session IDs out of URLs; remember URLs are
case-sensitive, so standardise on lower case; non-ASCII characters must be percent-encoded
(consider ASCII slugs for readability, a practice choice rather than a requirement); do not use
fragments to change page content, use the History API.

When a URL must change, keep the old one answering with a permanent redirect; never leave
dangling links. Google advises keeping permanent redirects for at least a year. Plan redirects as part of any relaunch (`lifecycle-launch-readiness`).

## Use when

- Define phase for any site with more than a handful of pages; before a migration or redesign.

## Do not use when

- Do not build a deep taxonomy for a one-page or few-page site; a flat list is enough.
- Do not encode business hierarchy or team structure into URLs when it will reorganise.

## Trade-offs

- Descriptive URLs help people and search but longer paths are harder to keep unique.
- Deep hierarchies organise well and hide content; search can compensate but does not replace clear structure.

## Common mistakes

- Menu labels using internal jargon or department names.
- Changing URL patterns in a redesign without a redirect map.
- Adding new sections by appending menu items until nothing is findable.

## Related

- Notes: `ux-research-usability`, `ux-prototyping`, `lifecycle-launch-readiness`
- Skills: `design-workflow`
