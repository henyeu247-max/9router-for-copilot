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

### Added (second gateway, verified live against CLIProxyAPI)
- Adding another OpenAI-compatible gateway works through the existing multi-provider profiles. Verified on a live CLIProxyAPI (`127.0.0.1:8317`): `/v1/models` 200 with the key and 401 without; 43/53 listed models answer a streamed chat with usage; tool calls work (ids are unique); `reasoning_effort` is validated per model by that gateway.
- Rows with no metadata whatsoever (`{id, object, owned_by}`) and an id of an OpenAI image/audio/embedding family (`gpt-image-*`, `dall-e*`, `imagen*`, `sora*`, `whisper*`, `tts-*`, `text-embedding*`, `omni-moderation*`) are hidden: measured `503 ... only supported on /v1/images/generations`. `gemini-*-image` stays (it answers chat). 9Router rows are never affected (0 of 623 match).
- **Real limits instead of 262144 / 4096 on CLIProxyAPI.** The same `/v1/models` asked with an `anthropic-version` header returns `max_input_tokens` and `max_tokens` for every model (non-Claude ids are cloaked as `claude-fable-5-dd-<reversed id>`; decoded exactly as CLIProxyAPI's `ResolveClaudeModelIDPrefix` does). Requested once (cached 5 min, silent on failure) and ONLY when some model lacks a context window, so 9Router costs no extra request; server-reported values are never overwritten and `modelContextWindows` still wins. Live check through the real client and catalog: 33/33 picker models match the API numbers. The window is treated as total (input + output): exact for Claude, on the safe side for GPT/Gemini.
- README documents the fallbacks such gateways get and how to tune them. Known: the gateway also lists models its upstream has retired (404/503 for 5 Claude ids); use `modelFilter`.

### Fixed (chat stuck on HTTP 400 `INVALID_ARGUMENT`)
- **Duplicate tool-call ids.** A gateway can reuse a short id (`call_149461`) for two different tool calls in one chat. VS Code keeps the history, so every later request carried the same id twice and strict upstreams (Gemini) rejected all of them - the chat could never recover. Ids are now made unique before sending (first use keeps its id, later reuses get `..._dupN`, results are re-pointed; unique histories are untouched). Evidence from a real session log: 12/12 failing requests contained such a pair, 268/268 requests without one succeeded; on the real transcript the fix removes both duplicate ids and keeps call/result pairing. Existing chats recover on the next message because the history is re-sent each time. Not replayed against the live upstream (needs a key).

### Fixed (thinking effort: read against microsoft/vscode source, 9Router's translator source and a real 623-model `/v1/models` capture; NOT yet exercised on a live chat request - run `scripts/probe-thinking.cjs`)
- **The picker offers exactly the levels the gateway publishes** (`capabilities.thinkingRange`, or an explicit `capabilities.reasoningEffort`), minus values the request path cannot send (`none`, `thinking`). No level is added by the extension. The built-in per-format table applies only when the gateway publishes no list at all. Note (measured on a real 623-model catalogue): the audited 9Router reports the *same* list for every model of a format (all 59 claude-adaptive models: `low|medium|high`), i.e. a per-format default; if it should offer more (e.g. `max`), fix it in the gateway, or send the level explicitly through `perModelOptions`. Levels are shown low -> high. Run `scripts/probe-thinking.cjs --try max` to test a level the gateway does not advertise.
- **`minimal` can now be sent.** It is valid for OpenAI/Gemini-level models but was silently dropped on the wire.
- **No picker where it would do nothing:** MiniMax (9Router only toggles thinking on/off and ignores the level); models with a tier in the id (`...-none`, `...-minimal` were missed: 13 models); and `claude-budget` fallbacks no longer offer levels whose `budget_tokens` is not below `max_tokens` (Anthropic would answer 400). `qwen3.7-max` / `qwen3.8-max` were wrongly hidden because "max" is a Qwen product name, not a level.
- **No forced default.** VS Code injects a schema `default` into *every* request, so the old hard-coded default (`high` for Claude, `medium` otherwise) sent `reasoning_effort` on models the user never touched (cost/latency) and made the `reasoningEffort` setting dead. The picker default is now the level you set in `perModelOptions`/`extraModelOptions` (if the model offers it); otherwise nothing is sent and the server's own default applies. Behaviour change: an untouched picker shows no checked level.
- A stale picker choice that the model no longer offers is not sent; the value from settings is used instead.
- Out of scope: turning thinking *off* (`none`). The server's level lists never include it and some routes reject it, so it is not offered.
- Known limit: for Claude budget-style models the level -> `budget_tokens` rule (from Anthropic's docs and 9Router's table) is applied to the advertised output limit; a very long prompt that shrinks `max_tokens` below the budget still yields a 400, which the 400-degrade step recovers from by retrying without `reasoning_effort`.
- Picker sub-menu is titled "Thinking effort" (localised) instead of the humanised key.
- New `scripts/probe-thinking.cjs` checks a live gateway: every advertised level, per thinking format, with your key from `NINEROUTER_API_KEY`.

### Fixed (context / compaction, verified against microsoft/vscode source and a real 9Router `/v1/models` capture of 623 models)
- **Output limit**: the advertised `maxOutputTokens` is now the server-declared limit (`max_completion_tokens`, then `capabilities.maxOutput`), capped at 50% of the window. Before, `defaultMaxOutputTokens` (4096) capped **621 of 623** models although servers declare 64K-500K; it is now only a fallback for models that declare nothing. The 50% cap is a documented heuristic (stable API cannot express `maxContextWindowTokens`, a proposed API); it only affects 27 models.
- **One token scale**: `provideTokenCount` (which VS Code compacts on) and the truncation gate now use the same conservative estimate (chars/4 x 1.2), so VS Code starts compacting at 78-90% of `maxInputTokens` before the extension's own last-resort truncation. Property-tested over the 623 real models x 3 tool-catalogue sizes; the issue #74 invariant (a prompt at the gate keeps its full output) still holds.
- **`max_tokens` too large**: on a 400 that states the upstream ceiling (OpenAI `supports at most N completion tokens`, Anthropic `> N, which is the maximum allowed number of output tokens`) the limit is learned and the request is retried once with a smaller `max_tokens`.
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
