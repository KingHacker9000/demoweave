# M7 web driver design

M7 implements the existing `SurfaceDriver v1` contract for `web` surfaces with Playwright without leaking browser-specific operations into Flow v1.

## Boundary

- Flow v1 stays surface-neutral. M7 consumes the existing `navigate`, `activate`, `input`, `press`, `scroll`, `wait`, `assert`, and `capture` actions.
- The web driver is responsible for translating `InteractionTarget` strategies into Playwright locators.
- Relative `navigate` destinations require an explicit runtime base URL. Absolute `http:`/`https:` destinations work without one.
- M7 does not start arbitrary application dev servers. The agent/test harness owns application startup and passes the reachable base URL to DemoWeave.
- Browser execution is headless by default with a fixed viewport, locale, timezone, color scheme, motion preference, and device scale so captures are reproducible.
- M7 captures PNG screenshot Evidence. Browser video/timeline composition remains M8+.

## Target mapping

| Flow strategy | Playwright mapping |
|---|---|
| `text` | `getByText` |
| `label` | `getByLabel` |
| `role` | `getByRole` |
| `name` | `[name=...]` attribute locator |
| `testId` | `getByTestId` |
| `accessibilityId` | accessible-name / `aria-label` locator |
| `automationId` | `[data-automation-id=...]` attribute locator |

Playwright strict locator semantics are preserved for interactions. Ambiguous targets fail instead of silently picking an arbitrary element.

## Execution

`WebDriver.prepare` launches Chromium and a fresh browser context. The same page is used for all steps in one Flow. `close` always closes the context/browser.

- `navigate`: resolves destination, navigates, and rejects HTTP error responses.
- `activate`: clicks the resolved target.
- `input`: fills when `clear` is true; otherwise appends text.
- `press`: presses on a target or the page keyboard.
- `scroll`: scrolls the target or viewport by a deterministic pixel amount.
- `wait`: supports duration, visible, hidden, and text conditions.
- `assert`: supports visible, hidden, and text-contains assertions.
- `capture`: supports `kind: screenshot`, for either a target element or the current viewport.

Unsupported terminal-only waits/assertions fail explicitly.

## Evidence

Screenshot capture writes `.demoweave/evidence/artifacts/<evidence-id>.png` atomically and upserts Evidence/Manifest metadata:

- `kind: screenshot`
- `format: png`
- `mimeType: image/png`
- producer `driver/web`
- Flow/step/surface/git provenance
- previous Evidence source dependency metadata is preserved

The existing post-Flow M6 snapshot then fingerprints the Flow, declared sources, and screenshot bytes. Derived/document freshness therefore works without a separate web-specific stale model.

## CLI

`demoweave run <flow> --base-url http://127.0.0.1:PORT` supplies the runtime origin for relative browser navigation. Browser-specific tuning stays optional and outside Flow v1.

## Acceptance gate

M7 is complete when a controlled local web fixture can be driven on Ubuntu and Windows through the built CLI, including semantic interaction, waits/assertions, deterministic PNG capture, Manifest provenance/fingerprinting, failure behavior, cleanup, and post-capture validation.
