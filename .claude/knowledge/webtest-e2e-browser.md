---
name: webtest-e2e-browser
description: Writing end-to-end browser tests that stay reliable - test user-visible behavior, isolate tests, use role-based locators and auto-waiting assertions, control third parties, and debug failures from traces
domain: web-development
tags: e2e,browser-testing,playwright,flaky-tests,locators,ci
apply_when: "adding or repairing browser tests; tests pass locally and fail in CI; selectors break on every UI change; deciding which journeys deserve an end-to-end test"
sources: "Playwright docs - Best practices (read); Ham Vocke - The Practical Test Pyramid (read)"
last_reviewed: 2026-09-26
confidence: medium
---

# End-to-end browser tests

E2E tests drive a real browser through a deployed (or locally running) stack. They are the most realistic and the most expensive tests, so keep them few and focused on **critical user journeys** (sign up, log in, checkout, the core task), as the test pyramid advises (`webtest-strategy`). The examples below name Playwright, but the rules apply to Cypress, Selenium and others.

## Rules that keep them reliable (Playwright best practices)

- **Test what the user sees**, not implementation details such as function names or CSS classes.
- **Isolate each test**: its own data, cookies and storage, so one failure does not cascade and tests can run in parallel.
- **Locators that survive change**: prefer role, label and text locators (the same things assistive technology uses, which also nudges you to accessible markup), or a dedicated test id where nothing better exists. Avoid long CSS or XPath chains tied to the DOM layout.
- **Web-first assertions** that wait and retry (for example `expect(locator).toBeVisible()`), not fixed sleeps or one-shot checks.
- **Do not test what you do not control**: no links to external sites or third-party servers; mock third-party APIs and use a staging backend with controlled data.
- **Run across the browsers you support** (project config per engine) and in parallel; shard across CI machines when the suite grows.
- **Keep traces on CI** (trace viewer, screenshots, video on failure) so a failure can be diagnosed without re-running; lint for missing `await`.

## Making a journey testable

- Seed data through the API or database, not through the UI, so setup is fast and deterministic.
- Log in once per test setup by reusing stored authentication state rather than driving the login form every time.
- Fix the clock and random inputs where results depend on them.
- Provide a way to reset the environment between runs.

## Use when

- Confirming that the assembled system supports the few journeys the product cannot afford to break.

## Do not use when

- Do not use E2E for logic that a unit or component test can prove faster.
- Do not use it to check pixel-perfect layout; leave that to exploratory review or a small, curated visual-regression set.

## Trade-offs

- Real-browser realism versus slowness and maintenance.
- Automatic retries hide flakiness: allow a retry on CI for signal but track and fix tests that need it.

## Common mistakes

- `sleep(5000)` instead of waiting for a condition.
- Tests that depend on the order of earlier tests or on shared accounts.
- Hitting production third-party services (payments, email) from tests.
- A large suite of E2E tests duplicating lower-level coverage.
- Treating a red build as noise after repeated flaky failures.

## Related

- Notes: `webtest-strategy`, `webtest-api-contract`, `a11y-testing`, `fe-browser-support-baseline`, `deploy-cicd-architecture`, `lifecycle-launch-readiness`
