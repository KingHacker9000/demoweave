# M12B — Windows UI Automation backend

M12A established the portable `DesktopDriver → DesktopBackend v1` boundary. M12B adds the **first real native backend** and must prove it against an actual interactive Windows desktop session before it can be called complete.

## Goal

Execute an existing DemoWeave Flow v1 against an already-running Windows desktop application, using semantic Windows UI Automation targets and real window capture, while preserving the same Evidence / Manifest / freshness / visual-QA contracts used by terminal, web, and research surfaces.

M12B is **not** permission to add OS-specific selectors to Flow v1, auto-launch arbitrary applications, or introduce an OBS/desktop-recorder dependency.

## Runtime boundary

The first backend attaches to an **explicit process ID supplied at invocation time**.

Preferred CLI shape:

```bash
demoweave run <flow-id-or-path> --desktop-pid <pid>
```

The application is already running. DemoWeave does not infer an executable from ProjectProfile and does not guess which process/window belongs to the user.

The same runtime context should be plumbed through `demoweave update --apply` so stale desktop Evidence can be selectively regenerated when `--desktop-pid` is supplied.

Do not encode the PID, executable path, window handle, or launch command in Flow v1.

## Windows backend

Add a backend such as `WindowsUiaBackend` implementing `DesktopBackend v1`.

The backend must be Windows-only and must probe honestly before use:

- host platform must be Windows;
- `--desktop-pid` must be a positive live process ID;
- a usable interactive desktop session must be available;
- the process must expose one unambiguous top-level window through Windows UI Automation;
- if more than one plausible top-level window exists, fail with diagnostics rather than choosing one silently.

Prefer built-in Windows/.NET capabilities over a large native dependency. A small PowerShell/.NET helper is acceptable if it is invoked with argument arrays / stdin or another quoting-safe mechanism and no `Invoke-Expression`/shell interpolation.

## Semantic target mapping

Keep Flow v1 unchanged. Map its existing target strategies into Windows UI Automation where the mapping is factual:

- `automationId` → UI Automation `AutomationId`
- `accessibilityId` → same Windows AutomationId convention
- `name` → UI Automation accessible Name
- `text` / `label` → accessible Name where that is the actual exposed UIA name
- `role` → UI Automation ControlType with an explicit small role map

Do **not** guess a mapping for `testId`; return an unsupported-target diagnostic until a real Windows convention is defined.

Target lookup must fail distinctly for:

- no match;
- ambiguous match;
- unsupported target strategy.

Prefer `automationId` in the local fixture so the proof is deterministic.

## Actions for the first backend

Required M12B vertical slice:

### `activate`

Use the control's supported UI Automation activation pattern, initially `InvokePattern` for the fixture button. If a target cannot be invoked through the supported pattern, fail explicitly rather than synthesizing a random mouse click.

### `input`

Use `ValuePattern` for editable controls. `SetValue` replaces the value, so `clear` must remain semantically correct. Fail when the element does not support the required pattern.

### `press`

Support at minimum the keys required by the local proof (`Enter`, plus basic navigation keys if straightforward). Focus the target first when a target is supplied. Use a Windows-native/.NET input path; keep key mapping explicit and tested.

### `wait`

Required:

- visible target
- hidden target
- text condition against a target

Use the Flow timeout contract. Polling is acceptable for this first backend if deterministic and bounded.

### `assert`

Required:

- visible target
- hidden target
- `textContains` against a target

Return existing driver error semantics; do not create a Windows-only assertion language.

### `capture`

Required first slice: **top-level window PNG screenshot** only.

A capture step with no target means the attached application's top-level window. Use a native window capture path such as Win32 `PrintWindow`/equivalent rather than full-display capture. Return PNG bytes through `DesktopBackendStepResult.capture`; `DesktopDriver` remains responsible for validating/writing Evidence.

Do not claim element screenshot support unless it is actually implemented and tested. Leave `element-capture` out of the backend descriptor until then.

## App/window selection

Anchor all UI Automation lookup to the supplied PID. Never search the entire desktop and take the first matching button/text field.

The backend should resolve exactly one top-level application window and then search its UIA subtree.

If the process exposes zero windows, report that it is not ready / not attachable. If it exposes multiple plausible windows, report ambiguity with enough information to debug it. Do not silently choose by z-order/title.

## Evidence and provenance

Do not create a Windows-specific Evidence format.

A successful screenshot must flow through existing `DesktopDriver` plumbing and become normal Evidence:

```text
kind: screenshot
format: png
producer.kind: driver
producer.id: desktop/windows-uia
```

Then existing `snapshotFlowEvidence` must add:

- Flow hash;
- declared material source hashes;
- artifact hash.

Later source changes must make desktop Evidence stale through the normal M6 path.

## Local deterministic Windows fixture

Create a tiny **Windows-native fixture application** that does not require a heavy framework install. WinForms or WPF using tooling already available on the Windows machine is preferred.

The fixture must expose stable AutomationIds and a simple deterministic workflow, for example:

```text
Project name: [____________]
[Create]

Result: <hidden initially>
```

Flow proof:

1. input `Demo Project` into a text field by AutomationId;
2. activate `Create` by AutomationId;
3. wait/assert the result area is visible;
4. assert the result text contains `Demo Project`;
5. capture the real application window as PNG Evidence.

Do not use screen coordinates for the proof.

Keep fixture appearance clean enough that the resulting screenshot can be reviewed in M10 visual QA.

## Hosted CI vs local Windows proof

Hosted Ubuntu/Windows CI must still cover:

- build;
- unit tests;
- typecheck;
- PowerShell/helper syntax or request/response tests where possible without an interactive desktop;
- backend probe failure when PID/session is absent;
- all existing milestone smokes.

Hosted CI must **not** be described as proof of real interactive UI Automation.

The local Windows machine must prove:

- real fixture process starts;
- real PID attachment succeeds;
- semantic UIA target lookup succeeds;
- input/activate/wait/assert succeed;
- real window PNG capture succeeds;
- `demoweave validate` succeeds;
- Evidence contains expected producer/provenance/fingerprints;
- source mutation creates explainable stale state;
- `update --apply --desktop-pid <pid>` repairs the Evidence when practical;
- a second no-change update is zero-action/no-churn;
- screenshot is visually inspected, then M10 QA is prepared/finalized if the screenshot format is supported by the existing QA path.

## Safety / implementation constraints

- no OBS;
- no full-display recording requirement;
- no raw OS selectors added to Flow v1;
- no arbitrary shell interpolation;
- no `Invoke-Expression`;
- no secret/environment dumping into Evidence;
- no guessing process/window identity;
- no hidden LLM;
- no M13 mobile work;
- keep dependencies lightweight;
- preserve current Windows + Ubuntu CI.

## Acceptance criteria

M12B is complete only when all are true:

1. `WindowsUiaBackend` implements `DesktopBackend v1` and is registered only for Windows.
2. `demoweave run ... --desktop-pid <pid>` passes runtime PID to the backend without changing Flow v1.
3. UIA semantic input/activate/wait/assert work against the real fixture.
4. Real top-level application PNG is captured without full-display/OBS capture.
5. Screenshot becomes normal hash/provenance-backed Evidence.
6. Invalid/missing PID, no window, multiple windows, target-not-found, target-ambiguous, unsupported target strategy/pattern, and capture failure produce explicit diagnostics.
7. Hosted Ubuntu + Windows build/tests/typecheck/smokes are green.
8. Local Windows fixture proof is green.
9. Local screenshot has been visually reviewed rather than automatically approved.
10. No existing Flow/Evidence contract is weakened or made Windows-specific.

Only after this proof should the roadmap call the Windows backend available. macOS/Linux native backends remain separate later slices of M12.
