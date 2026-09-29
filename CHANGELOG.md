# Changelog

## 3.0.0

**One project.** The four sources are merged into a single tree: the engine of `hotrungnhan/9router-for-github-copilot` (itself from arbs-io), the resilience work from the earlier Vizards-based 0.9.x line, and the toolchain, panel/health/dashboard concepts and catalog filtering of `diegosouzapw/OmniCopilot` as the repository base. Git history of all of them is preserved (`upstream` and `omni` remotes).

### Added
- Activity Bar **panel** (`nine-router.panel`): status dot, model count, URL + key form with *Save & Test*, per-provider health, quick links.
- **Health monitor** (`healthCheckIntervalSeconds`, default 30 s, min 5) with instant updates from request outcomes; states are `online` / `auth` (401/403) / `degraded` (5xx/429) / `offline`; **Quick Actions** menu on status-bar click.
- **Open 9Router Dashboard** (`dashboardOpen`: `external`/`editor`, `dashboardUrl`); editor tab only if the server allows framing, otherwise automatic fallback.
- **`debugMode`** `off | metadata | verbose` with redacted request dumps (last 50 kept), *Open Request Dumps Folder*; legacy `verboseLogging: true` = verbose.
- Commands: Quick Actions, Open Dashboard, Open Panel, Open Settings, Open Request Dumps Folder, Clear API Key.
- Tool-name wire shortening (<= 64 chars) with reverse mapping; opt-in vision proxy; opt-in `::` model-id encoding; non-chat catalog filter + `modelFilter`; 429/503 retry; graceful HTTP 400 degradation (`reasoning_effort` first, tools only when the message says so); single-block thinking output.
- Vietnamese localization (`package.nls.vi.json`, `l10n/bundle.l10n.vi.json`) with a test that fails when a key or string is missing.

### Fixed
- **Context Window widget / compaction** (verified against microsoft/vscode source: `getModelContextWindowTotal`, `chatContextUsageWidget`, `agentIntent`):
  - `maxInputTokens` is now `context - maxOutputTokens` (was the full window). VS Code shows `maxInput + maxOutput` as the window and compacts at ~80-90% of `maxInput`, so the old value inflated the denominator by `maxOutputTokens` and let prompt + reserved output overrun the real window.
  - When the gateway sends **no usage** (many ignore `stream_options.include_usage`) or an all-zero frame, an estimate (chars/4 of prompt + tools, and of streamed text/reasoning/tool args) is emitted as the `usage` data part, so the widget and compaction do not stay at 0%. A server-reported value always wins.
  - Catalog fallback before the first model fetch adds `maxOutputTokens` back to recover the real window.

### Breaking
- **New extension id** `henyeu247-max.9router-for-github-copilot` (a different Marketplace listing from `hotrungnhan.9router-for-github-copilot`); uninstall the old one to avoid two copies. Language-model vendor is unchanged (`9router-github-copilot`) so saved model choices keep working.
- **No settings were removed or renamed** relative to 2.2.0. New keys: `statusBar`, `healthCheckIntervalSeconds`, `dashboardOpen`, `dashboardUrl`, `debugMode`. The legacy `verboseLogging` still works (`true` = `debugMode: verbose`).
- Requires VS Code >= 1.125.

### Changed
- Toolchain is Omni's: npm + vitest + esbuild (`dist/`), `vscode` mocked for tests. All 35 previous `node:test` files now run under vitest.
- Extension id `henyeu247-max.9router-for-github-copilot`, vendor `9router-github-copilot`; settings keys unchanged.
- Only English and Vietnamese are shipped.

### Removed / not carried over (on purpose)
- OmniRoute-specific parts: usage endpoint, `omniroute` CLI bridge, OmniRoute-only settings.
- Copilot Agents-window registration (proposed VS Code API), price/cost display, routing classifier, reasoning replay (no evidence of need in the merged build).

### Licensing
- `LICENSE` lists every copyright holder; `NOTICE` documents what came from where.

## 2.2.0 and earlier

See git history (`pre-omni-rebase-2.2.0` tag) and upstream release notes.
