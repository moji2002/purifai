# Contributing to Purifai

Thanks for your interest in contributing! We appreciate your time and effort.

## Code of Conduct

Be respectful and constructive. We follow the standard [Contributor Covenant](https://www.contributor-covenant.org/). Treat everyone with kindness.

## Getting Started

1. Fork the repo and create your branch from `main`
2. Install dependencies with `pnpm install`
3. Build with `pnpm run build`
4. Run tests with `pnpm test` (add tests if you change behavior)

## Development

- Use TypeScript and keep code self-explanatory
- Prefer small, focused PRs
- Include unit tests for new features and bug fixes
- Keep performance and security in mind (this is a sanitizer)
- Match existing code style and formatting

## Commit Messages

- Use conventional commits
  - `feat:` new feature
  - `fix:` bug fix
  - `chore:` tooling/infra/docs
  - `refactor:` code change that neither fixes a bug nor adds a feature
- Keep the subject line concise and include a brief body explaining the why when needed

## Pull Requests

- Link related issues
- Describe the problem and solution clearly
- Add screenshots/benchmarks if the change affects performance
- Ensure CI is green

## Release Process

- Maintainers bump version via `npm version [patch|minor|major]`
- `pnpm run build` before publishing
- Publish with `npm publish --access public`

## Security

If you find a security issue, please do not open a public issue. Instead, email `it@worksonmy.dev` with details.

## Questions

Open a GitHub Discussion or issue if you need help.
