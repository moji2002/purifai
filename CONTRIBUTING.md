# Contributing to Purifai

Purifai is a bounded, streaming HTML-to-readable-text converter. Contributions
should preserve its fixed policy, chunk invariance, resource bounds, portability,
and zero-runtime-dependency contract.

## Setup

Requirements: Node.js 22 or newer and the pnpm version declared in
`package.json`.

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm run test:core
```

## Verification commands

Use the narrowest relevant check while developing, then run the affected release
gate before opening a pull request.

| Area | Command |
| --- | --- |
| Types, entities, unit, fuzz, sinks, package | `pnpm run test:core` |
| Node, Bun, Deno packed consumers | `pnpm run test:runtimes` |
| Cloudflare `workerd` | `pnpm run test:cloudflare` |
| Chromium, Firefox, WebKit | `pnpm run test:browsers` |
| Runtime/package size | `pnpm run test:size` |
| Adversarial time and memory scaling | `pnpm run test:scaling` |
| Saved category gates | `pnpm run bench:check` |
| Documentation and runnable examples | `pnpm run test:docs` |
| Complete local qualification | `pnpm run test:release` |

The benchmark command, `pnpm run bench`, replaces the checked raw result and
report. Only do that when intentionally collecting a new canonical run, and
include the environment and result changes in review.

## Code changes

- Keep runtime code Web-standard and side-effect free. Do not add Node built-ins,
  a DOM dependency, or runtime dependencies.
- Preserve output equality across every possible chunk partition.
- Charge caller-controlled retained state before it grows beyond a public limit.
- Add a focused regression test for behavior changes and hostile edge cases.
- Regenerate entity data with `pnpm run entities:update`; verify committed data
  with `pnpm run entities:check`.
- Do not claim browser-equivalent HTML parsing or universal output safety.

## Pull requests

Explain the externally visible behavior and why it belongs in Purifai's narrow
category. Include benchmark evidence for performance-sensitive changes and state
which qualification commands passed. Keep changes focused and use conventional
commit subjects such as `feat:`, `fix:`, `test:`, `docs:`, or `refactor:`.

## Releases

Maintainers release through the protected provenance workflow after every local
and CI qualification gate passes. Do not publish manually. A version, tag, npm
trusted-publisher configuration, and workflow invocation are separate reviewed
actions.

## Security reports

Do not open a public issue for a suspected vulnerability. Email
`it@worksonmy.dev` with a reproducer, affected sink/runtime, and expected
behavior.
