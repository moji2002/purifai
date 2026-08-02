# Purifai README Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the README into an adoption-focused package landing page that makes Purifai's distinct use case and supporting evidence clear before presenting its API reference.

**Architecture:** Keep `README.md` as the single public package document, but reorder it into an evaluation path: promise, demonstration, fit, onboarding, proof, reference, and project links. Preserve safety-critical guidance and factual measurements while removing repeated explanations.

**Tech Stack:** GitHub-flavored Markdown, TypeScript examples, existing Node documentation checks.

## Global Constraints

- Do not change the package API or runtime behavior.
- Lead with readable extraction from hostile HTML without a DOM.
- Preserve safe-sink guidance and the boundary between plain-text extraction and HTML sanitization.
- Keep benchmark claims tied to the pinned competitors and recorded methodology.
- Keep examples executable against Purifai v3.
- Do not add decorative assets that do not improve developer evaluation.

---

### Task 1: Rewrite the README evaluation path

**Files:**
- Modify: `README.md`
- Test: `test/docs.test.mjs`

**Interfaces:**
- Consumes: the public exports `toText`, `convert`, `createTextTransform`, `escapeHtmlText`, and `PurifaiLimitError`.
- Produces: a package README whose examples are validated by `pnpm run test:docs`.

- [ ] **Step 1: Replace the opening with a concrete product promise**

Use the headline “Readable text from hostile HTML—without a DOM.” Add a compact
evidence line for bounded streaming, zero runtime dependencies, 23.7 KiB gzip,
and server/browser/edge coverage. Put the script-body removal example before
the first long explanation.

- [ ] **Step 2: Add an explicit fit section and fast installation path**

State that Purifai is for readable plain-text extraction when inputs may be
large, malformed, or hostile. State that configurable formatting and preserved
safe markup belong to other tools. Follow immediately with installation and a
small `toText` example.

- [ ] **Step 3: Reorder the guide around common adoption questions**

Use this order after quick start: why Purifai, safe output, streaming, bounded
conversion, options, proof, API reference, tool selection, migration,
contributing, and license. Consolidate duplicate caveats into their
authoritative sections.

- [ ] **Step 4: Keep proof specific and reproducible**

Retain the recorded 11 benchmark gates, the 23,689-byte gzip measurement, zero
runtime dependencies, runtime matrix, and commands linking to the full
methodology. Do not introduce new performance claims.

- [ ] **Step 5: Run documentation verification**

Run: `fnm exec --using 24 pnpm run test:docs`

Expected: build succeeds and the documentation test exits successfully.

### Task 2: Review and publish the documentation change

**Files:**
- Modify if needed: `README.md`

**Interfaces:**
- Consumes: the rewritten README from Task 1.
- Produces: a clean, committed, and pushed documentation update.

- [ ] **Step 1: Check Markdown integrity and repository links**

Run: `git diff --check`

Run targeted checks for local links to `docs/benchmarks/v3.md`,
`docs/migration-v3.md`, `CONTRIBUTING.md`, and `examples`.

Expected: no whitespace errors and every local target exists.

- [ ] **Step 2: Review the final diff for duplication and claim drift**

Confirm that the first two screens answer what Purifai does, why it differs,
how to install it, and how to use it. Confirm every numeric or comparative claim
already exists in the recorded benchmark or size documentation.

- [ ] **Step 3: Commit the README rewrite**

Run:

```bash
git add README.md docs/superpowers/plans/2026-08-02-readme-redesign.md
git commit -m "docs: sharpen Purifai positioning"
```

- [ ] **Step 4: Push the current branch**

Run: `git push origin main`

Expected: the remote advances to the documentation commit without changing
branches or rewriting history.
