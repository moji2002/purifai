# Purifai README redesign

## Goal

Turn the README into an adoption-focused landing page for developers evaluating
HTML-to-text packages. A reader should understand Purifai's distinct use case,
see evidence for its claims, and reach a working example within the opening
screen or two.

## Positioning

Lead with the product promise:

> Readable text from hostile HTML—without a DOM.

Purifai's defensible niche is the combination of readable extraction, bounded
streaming, deterministic hostile-input limits, zero runtime dependencies, and
one portable implementation for servers, browsers, and edge runtimes. The
README must not imply that Purifai preserves safe HTML or replaces configurable
formatters and sanitizers.

## Opening sequence

1. Product name and concrete one-line promise.
2. A compact evidence line: bounded streaming, zero dependencies, 23.7 KiB
   gzip, and Node/browser/edge support.
3. A before-and-after example that demonstrates script-body removal and
   readable structure, contrasting it with flat tag deletion.
4. A short “Choose Purifai when” block defining the intended job.
5. Installation and the first working `toText` example.
6. Only useful badges: npm version, package size, CI, and license.

Avoid generic adjectives such as “fast,” “secure,” or “powerful” unless the
surrounding text states the measurable behavior that supports the claim.

## Information architecture

After the opening, use this order:

1. **Why Purifai:** explain the narrow advantage over `striptags`,
   `html-to-text`, and HTML sanitizers.
2. **Quick start:** cover `toText`, supported output sinks, and high-value
   options.
3. **Streaming:** show a concise native `TransformStream` example and state its
   partial-output failure semantics.
4. **Limits:** present hostile-input limits and explicit truncation behavior in
   a compact table and example.
5. **Proof:** summarize reproducible benchmarks, artifact size, supported
   runtimes, fuzzing, and release provenance.
6. **API reference:** provide concise signatures and behavior for all public
   exports without duplicating earlier examples.
7. **Selection and project links:** retain the tool-selection table, migration,
   contributing, and license information.

## Content rules

- Preserve all safety-critical sink guidance and category boundaries.
- Replace repeated explanations with one authoritative section and links.
- Put common evaluation and onboarding information before exhaustive details.
- Keep benchmark claims tied to pinned competitors, named gates, and the full
  methodology document.
- Distinguish readable plain-text extraction from markup sanitization.
- Keep examples executable against the current v3 API.
- Prefer short paragraphs, descriptive headings, and scanning-friendly tables.

## Verification

- Run the existing documentation test so every README example remains valid.
- Run Markdown formatting or repository formatting checks if available.
- Run `git diff --check`.
- Confirm all referenced local files and external project links exist.
- Review the rendered hierarchy for duplicated claims and excessive caveats.

## Out of scope

- API or runtime behavior changes.
- New benchmark claims or regenerated benchmark data.
- Changes to package metadata, documentation sites, or migration semantics.
- Decorative assets that do not improve developer evaluation.
