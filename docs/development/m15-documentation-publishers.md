# M15 — Documentation publishers

Status: current design contract for `feat/m15-documentation-publishers`.

M15 adds deterministic publication/adaptation of already-authored DemoWeave documentation into existing documentation stacks. It does **not** turn DemoWeave into another site generator and it does not move agent judgment into hidden runtime behavior.

## Goal

Given reviewed project Markdown plus local Evidence/media, DemoWeave should be able to prepare and safely synchronize the documentation into an explicit target layout such as plain Markdown/GitHub, Docusaurus, VitePress, MkDocs, Fumadocs, Mintlify, or another documented adapter.

The publisher layer complements existing stacks. It should preserve their configuration and conventions rather than replacing them.

The first proof is intentionally local and credential-free: a plain Markdown/GitHub-style target tree. Remote deployment/upload is not required to prove the core publisher contract.

## Product rule

Agents author structure, prose, and target intent. DemoWeave performs deterministic validation, path resolution, dependency closure, preview/diff, safe writes, hashing, and provenance.

```text
reviewed Markdown + Evidence
        +
PublisherPlan v1
        ↓
Publisher resolver
        ↓
source/dependency closure
        ↓
publication preview
        ↓
review token
        ↓
atomic target sync
        ↓
PublicationManifest v1
```

## Non-goals

M15A does **not**:

- generate prose with an LLM;
- invent navigation/IA unless an agent authored it in the plan;
- auto-install a documentation framework;
- run `npm install`, `pip install`, or another package manager;
- upload to GitHub Pages, Vercel, Netlify, Cloudflare, S3, or another remote service;
- request or persist deployment credentials/tokens;
- rewrite Docusaurus/VitePress/MkDocs/etc. configuration in the first slice;
- scrape external assets;
- follow arbitrary remote URLs;
- silently overwrite unrelated existing target files;
- make M14 renderer plugins responsible for publication;
- claim a stack adapter before it has a real fixture/proof.

Remote deploy integrations may be added after the local publisher contract is proven, but they require explicit credentials/runtime boundaries and separate acceptance tests.

## PublisherPlan v1

Add a strict versioned plan stored under:

```text
.demoweave/publishers/<id>.json
```

Minimum shape conceptually:

```json
{
  "schemaVersion": 1,
  "id": "github-docs",
  "publisher": "markdown",
  "targetRoot": "published-docs",
  "entries": [
    {
      "source": "README.md",
      "destination": "README.md"
    },
    {
      "source": "docs/getting-started.md",
      "destination": "docs/getting-started.md"
    }
  ]
}
```

The plan is agent-authored. DemoWeave does not guess what documentation should be public.

### Plan requirements

- stable portable kebab-case `id`;
- `publisher` is an explicit adapter ID;
- project-relative `targetRoot`;
- one or more explicit Markdown entries;
- each entry has project-relative `source` and target-relative `destination`;
- source must exist and be Markdown for M15A;
- destination cannot be absolute, traverse, or escape targetRoot;
- duplicate destinations fail;
- targetRoot itself must remain within project root after realpath/symlink checks;
- source paths must remain inside project root after realpath/symlink checks;
- nested initialized DemoWeave projects are not implicitly crossed; a plan must explicitly point to owned files and normal project-root safety still applies;
- plan JSON is strict; unknown fields fail rather than being ignored.

Do not encode credentials, deployment tokens, machine paths, user IDs, device IDs, or runtime secrets in PublisherPlan v1.

## Dependency closure

M15A must copy the local dependencies needed by the selected Markdown documents to render correctly.

At minimum understand project-local Markdown dependencies already recognized elsewhere in DemoWeave:

- Markdown images: `![...](...)`;
- Markdown links to explicitly included local documentation pages;
- HTML `<img src>` local assets;
- HTML `<a href>` local docs where practical;
- DemoWeave Evidence artifact paths referenced by selected Markdown.

Rules:

- remote URLs are left unchanged and never fetched;
- fragment-only links are left unchanged;
- query/fragment suffixes are preserved in rewritten links;
- dependencies are resolved relative to the source Markdown file;
- local asset traversal/symlink escape fails;
- links to Markdown not included by the plan should produce a clear unresolved-publication diagnostic rather than silently copying the entire repository;
- non-Markdown local assets required by included docs are copied automatically into deterministic target paths;
- destination links are rewritten only where required by source/destination relocation;
- rewrite behavior must be parser/source-position aware enough to avoid global string-replace corruption;
- repeated/shared dependencies are copied once deterministically.

For M15A, the safe target layout may preserve source-relative asset structure where that avoids unnecessary rewrites, but the behavior must be deterministic and documented.

## Markdown preservation

Do not reserialize whole Markdown files merely to publish them.

Publication should preserve authored Markdown bytes except for intentional local-link/path rewrites required by the target mapping.

Preserve where possible:

- heading spelling/case;
- whitespace;
- code fences;
- HTML blocks;
- CRLF/LF style;
- UTF-8 BOM;
- unrelated links/text.

Reuse the M5 parser/source-position approach where useful rather than adding a second fragile Markdown regex rewriter.

## Publication preview

Publishing must be reviewable before writes.

Add a deterministic preview operation which reports at least:

- plan ID + adapter ID;
- plan hash;
- target root;
- files to create;
- files to update;
- files unchanged;
- local dependencies copied;
- unresolved links/dependencies;
- conflicts;
- content hashes for candidate outputs;
- exact unified diffs for text files that already exist and would change.

Preview must not mutate the target tree.

## Review token

Bind apply to the exact preview using a deterministic review token analogous to M5.

Token should bind at least:

- canonical PublisherPlan v1;
- source file hashes;
- dependency asset hashes;
- existing target-file hashes/existence used by preview;
- candidate publication content hashes.

If any source/dependency/target baseline changes after preview, apply must refuse and require a new preview.

Do not use wall-clock timestamps or random IDs in the token.

## Apply safety

`apply` must write only the exact reviewed candidate publication.

Requirements:

- targetRoot remains inside project after realpath/symlink checks;
- no writes outside targetRoot;
- atomic file replacement where possible;
- stage candidates before replacing target files;
- no partial success should be reported as a successful publication;
- do not delete unrelated files merely because they are absent from the current plan;
- do not delete a previously published file automatically in M15A unless the plan/runtime has an explicit reviewed deletion model;
- existing target file not owned by the current publication manifest and with differing bytes is a conflict by default;
- byte-identical existing files are unchanged;
- second apply with the same reviewed state performs zero writes/churn.

## PublicationManifest v1

After a successful apply, write a deterministic local publication record under:

```text
.demoweave/publications/<plan-id>.json
```

The manifest should record portable metadata only:

- schemaVersion: 1;
- plan ID;
- adapter/publisher ID;
- PublisherPlan hash;
- targetRoot;
- published files and candidate SHA-256 hashes;
- source document/dependency paths + hashes;
- optional source Evidence IDs for files known to come from Evidence;
- no absolute paths;
- no secrets;
- no timestamp required for freshness correctness.

The manifest is a publication baseline, not an ownership claim over arbitrary target-tree files.

## Publication freshness/status

Add deterministic status for a publication plan.

At minimum distinguish:

- `fresh` — current source/dependency hashes and target bytes equal manifest baseline;
- `stale` — source/dependency or plan changed;
- `drifted` — target published file changed independently after apply;
- `missing` — expected published target file missing;
- `unpublished` — no successful PublicationManifest exists;
- `unknown` — baseline cannot be resolved safely.

M15A may define a dedicated `PublicationStatus v1` rather than overloading Evidence `FreshnessReport v1`, as long as the contracts are explicit and schemas are synchronized.

Do not pretend target drift is ordinary source staleness; those are different decisions for an agent/user.

## Built-in `markdown` publisher — first proof

Implement a built-in publisher ID:

```text
markdown
```

Purpose: prepare a project-local Markdown documentation tree suitable for GitHub/plain Markdown hosting and as a baseline adapter contract for later frameworks.

It should:

- copy selected Markdown according to explicit source → destination mapping;
- copy required local image/media/Evidence dependencies;
- preserve Markdown bytes except required link rewrites;
- refuse unresolved local documentation links;
- never fetch remote assets;
- never run another build tool;
- never mutate source docs;
- never write outside targetRoot;
- provide preview/apply/status/no-churn behavior.

The first proof target must be a separate project-local directory, not the repository root, so dogfood cannot accidentally overwrite DemoWeave's own README/docs while the contract is being proven.

## CLI

Add a coherent publisher surface. Exact command nesting may be adjusted for ergonomics, but target behavior should be equivalent to:

```text
demoweave publish preview <plan-id-or-path> [--project <path>] [--json]
demoweave publish apply <plan-id-or-path> --review-token <token> [--project <path>] [--json]
demoweave publish status <plan-id-or-path> [--project <path>] [--json]
```

`preview`:
- resolves/validates plan;
- computes candidate tree + diff + token;
- no writes.

`apply`:
- recomputes preview;
- validates supplied review token;
- writes reviewed target;
- writes PublicationManifest v1.

`status`:
- no writes;
- reports current publication state and reasons.

Do not add a command named `deploy` or imply remote upload in M15A.

## Adapter boundary

M15A should structure the runtime so later framework publishers share one host contract instead of copy/pasting file safety.

Conceptually:

```text
PublisherHost
  ├─ source/dependency resolution
  ├─ path safety
  ├─ preview + diff + token
  ├─ atomic apply
  ├─ PublicationManifest
  └─ status
        ↓
PublisherAdapter
  ├─ markdown        (M15A)
  ├─ docusaurus      (later proof)
  ├─ vitepress       (later proof)
  ├─ mkdocs          (later proof)
  ├─ fumadocs        (later proof)
  └─ mintlify        (later proof)
```

An adapter may define destination conventions and target-specific metadata transforms, but the host owns filesystem safety, review binding, baseline hashes, and apply semantics.

Do not freeze target-framework-specific fields into PublisherPlan v1 until at least one real framework adapter proves they are needed. Prefer adapter options as strict JSON-compatible data if necessary.

## Plugin publisher boundary

M14 deliberately stopped before publisher runtime. M15 should prove the built-in host contract before exposing it as plugin API.

Do **not** add `registerPublisher()` in M15A merely for symmetry.

After the built-in Markdown proof is stable, a later M15 slice may expose publisher adapters through `@demoweave/sdk` using the same rules:

- explicit configured trusted plugin only;
- plugin receives detached/read-only input;
- plugin does not choose arbitrary host filesystem paths;
- DemoWeave owns apply/write safety and publication baseline;
- no remote credentials persisted.

## Real fixture

Add a deterministic publisher fixture such as:

```text
fixtures/publisher-markdown/
```

It should contain:

- a small existing source docs tree;
- at least two Markdown documents;
- one local image or SVG Evidence-style asset;
- one document linked from another;
- one remote link which remains untouched;
- a pre-existing targetRoot containing at least one unrelated file that must be preserved;
- `.demoweave/publishers/<plan>.json`.

The fixture must prove real preview/apply/status behavior, not import internal helpers directly.

Suggested source:

```text
README.md
docs/getting-started.md
docs-media/proof.svg
```

Suggested target:

```text
published/
  README.md
  guide/getting-started.md
  assets/proof.svg
  keep-me.txt
```

If the getting-started destination moves, the README link rewrite must be deterministic and source-position safe.

## Fixture acceptance

Prove all of the following:

1. `preview` produces no target mutation;
2. preview reports create/update/unchanged/dependency operations deterministically;
3. remote URLs are preserved and not fetched;
4. local doc links resolve only to included plan entries;
5. local asset dependency is copied;
6. relocated local links are rewritten correctly;
7. unrelated pre-existing target file is preserved;
8. apply with wrong/stale token fails with zero writes;
9. successful apply writes only reviewed files;
10. PublicationManifest v1 is portable and hash-complete;
11. status after apply is fresh;
12. source Markdown change → stale source publication reason;
13. dependency asset change → stale dependency reason;
14. target published-file edit → drifted, distinct from source stale;
15. target published-file deletion → missing;
16. second unchanged preview/apply produces zero writes and byte-identical PublicationManifest/target files;
17. source files remain byte-identical after publication;
18. target traversal/symlink escapes fail;
19. source traversal/symlink escapes fail;
20. unresolved local documentation link fails clearly.

## Security/path tests

Test at minimum:

- absolute targetRoot;
- `../` targetRoot traversal;
- targetRoot symlink outside project;
- source absolute path;
- source traversal;
- source symlink outside project;
- destination absolute path;
- destination traversal;
- dependency traversal;
- dependency symlink escape;
- duplicate destinations;
- malformed plan;
- unknown publisher ID;
- target conflict with unmanaged differing file;
- target changed between preview/apply;
- source/dependency changed between preview/apply;
- no absolute paths in PublicationManifest;
- no environment variables/secrets persisted.

## Determinism

Given identical:

- PublisherPlan bytes/meaning;
- source documents;
- dependency assets;
- target baseline;
- DemoWeave version/adapter behavior;

then candidate files, preview classification, content hashes, review token, successful output bytes, PublicationManifest, and status must be deterministic.

Do not include timestamps, temp paths, random IDs, process IDs, or hostname information in persistent publication metadata.

## Cross-platform

M15A must pass Windows and Linux/WSL path behavior.

Pay particular attention to:

- path separators in manifests/links;
- case behavior without pretending all filesystems are case-sensitive;
- CRLF/LF preservation;
- BOM preservation;
- symlinks/junctions;
- atomic replacement behavior;
- POSIX-style Markdown link destinations independent of host path separator.

## M15A exit criteria — publisher foundation + Markdown target

- strict PublisherPlan v1 + published JSON Schema;
- PublisherHost/adapter boundary exists;
- built-in `markdown` publisher exists;
- safe source/dependency closure exists;
- parser/source-position-aware local link rewriting exists;
- deterministic preview + unified diff exists;
- hash-bound review token exists;
- safe atomic apply exists;
- PublicationManifest v1 + published JSON Schema exists;
- publication status differentiates stale/drifted/missing/unpublished/unknown;
- real Markdown publisher fixture proves apply/status/mutations/no-churn;
- source docs are never modified;
- unrelated target files are preserved;
- Windows + Ubuntu hosted build/test/typecheck/smokes remain green;
- M10 reviewed-media gate is not weakened.

## Later M15 slices

After M15A is merged, prove framework adapters individually from real fixtures rather than by filename heuristics alone.

Candidate order:

1. Docusaurus or VitePress — straightforward Markdown docs tree and explicit config;
2. MkDocs — Python ecosystem proof;
3. Fumadocs — modern Next.js docs stack;
4. Mintlify — config/content conventions;
5. plugin publisher adapters after the built-in adapter contract is stable;
6. optional authenticated remote deployment integrations only with explicit runtime credentials and separate security review.

A framework adapter is not "supported" merely because DemoWeave can copy a Markdown file into a similarly named directory.

## Review rule

Do not merge M15A just because unit tests pass. Review:

- target/source/dependency path safety;
- link rewrite correctness on real Markdown;
- preview/apply token binding;
- unmanaged target conflict handling;
- target drift semantics;
- source byte preservation;
- fixture publication output itself;
- no-churn behavior;
- Windows/Linux consistency;
- full existing DemoWeave CI and M10 visual-review gate.
