# Release checklist — Hima

Hima ships as source: a checksummed `hima-<version>.tar.gz` attached to a GitHub
release. There is no store upload and no packaged binary.

Current version: **0.36.0** (`package.json` is the single source of truth;
`src/shared/app-meta.ts` reads it).

## Cutting a release

1. Update `CHANGELOG.md` with a `## <version> — <date>` section (the release
   notes are cut from it) and bump the version: `npm version <x.y.z> --no-git-tag-version`.
2. Update the version assertion in `src/shared/app-meta.test.ts`.
3. Run `npm run typecheck && npm test && npm run build && npm run test:e2e && npm audit --omit=dev --audit-level=high`.
4. Re-render the README screenshots if the UI changed:
   `SCREENSHOTS=1 npx playwright test tests/e2e/screenshots.spec.ts`.
5. Commit, then tag the commit: `git tag -a v<x.y.z> -m "Hima <x.y.z>"` and push the tag.
6. The `Release` workflow (`.github/workflows/release.yml`, public repository
   only) checks that the tag equals the `package.json` version, runs typecheck,
   build and unit tests, builds the archive and `SHA256SUMS`, and publishes the
   release with the changelog section as notes.

## Safety checks before every tag

- No credentials, tokens or keyring contents anywhere in the diff or the tests.
- The server still binds to `127.0.0.1` and the API session boundary is intact.
- Tests use synthetic mail data only.
