# 9Router for GitHub Copilot

VS Code extension (TypeScript) that exposes models from an OpenAI-compatible gateway (9Router, CLIProxyAPI) to GitHub Copilot Chat as a language-model provider. Bundled with esbuild, tested with Vitest.

## Commands
- Install: `npm ci`
- Tests: `npm test` (Vitest; expected: all pass, a few skipped)
- Lint: `npm run lint`
- Types: `npm run check-types`
- Production bundle: `npm run package` (type-check + esbuild → `dist/extension.js`)
- VSIX: `npm run vsix` → `9router-for-github-copilot.vsix`
- Install locally: `code --install-extension .\9router-for-github-copilot.vsix --force`, then fully restart VS Code (a window reload keeps cached modules)
- Smoke: `npm run smoke`

## Structure
- `src/extension.ts` entry; `src/panel.ts` Activity Bar panel.
- `src/api/` gateway client, SSE parsing, `retryLoop.ts` (bounded request recovery).
- `src/provider/` chat request handler and provider; `src/chat/` response streaming, thinking, usage.
- `src/models/`, `src/profiles/`, `src/discovery/`, `src/config/`, `src/status/`, `src/commands/`, `src/completions/`.
- Tests live in `__tests__/` beside each module and in `test/`.
- `l10n/bundle.l10n.vi.json`, `package.nls*.json`: Vietnamese localization; a test fails when a key is missing.
- `dist/` and `*.vsix` are generated and git-ignored.

## Rules
- Update `README.md`, `README.vi.md` and `CHANGELOG.md` (Unreleased) together when behavior changes.
- Recovery in `retryLoop.ts` must stay bounded and must never retry after any response part was reported (text, reasoning or tool call).
- Do not degrade reasoning or tools to cure transport errors; degrade only for errors that name them.
- Never commit secrets, API keys or request dumps; keep gateway auth data out of logs and docs.
- Remotes: `origin` is the working repo; `upstream` and `omni` are history sources only.

## Runtime
- Gateway URL and API key are configured in the extension settings or panel, never in the repo.
- Local CLIProxyAPI gateway (outside this repo): listens on `127.0.0.1:8317`; its config, binary and logs are not managed here.
- Volatile gateway state belongs in `docs/` notes, not in this file.

## Lessons
- NR-001: Inline SSE error `Inference server reported an error mid-stream: unexpected EOF` comes from the gateway's upstream read failing after HTTP 200 was sent. The extension retries once only before any output. Details: `docs/solutions/2026-10-05-stream-unexpected-eof.md`.
- NR-002: After installing a rebuilt VSIX, verify the installed `dist/extension.js` hash against the build and restart VS Code fully; a running host keeps the old code.
