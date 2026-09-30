# 9Router for GitHub Copilot Chat

Use **9Router** (and any OpenAI-compatible gateway) models inside GitHub Copilot Chat: agent mode, tool calling, thinking, vision and automatic fallbacks — with a status dot, an Activity Bar panel and proper debugging.

> Tiếng Việt: xem [README.vi.md](README.vi.md).

## Quick Start

1. **Install** the extension (`.vsix` or Marketplace).
2. Click the **9Router** icon in the Activity Bar (or the status-bar item → *Open 9Router panel*), enter the **Server URL** (default `http://localhost:20128/v1`) and, if your gateway needs one, the **API key**, then **Save & Test**.
3. In Copilot Chat open the model picker → **Manage Models** → enable models under **9Router**.
4. Pick a model and chat. No Copilot subscription is required on VS Code ≥ 1.122.

## What you get

**Connection & UI**
- Activity Bar **panel**: online/offline dot, model count, URL + key form, per-provider health, quick links.
- **Status bar**: coloured by gateway health - green dot = online, yellow = key rejected (401/403) or server erroring / rate limiting, red = unreachable, spinner = request running. Click for *Quick Actions*; hover for a rich tooltip (models, context, last request, session tokens).
- **Health monitor**: probes each provider every 30 s (`healthCheckIntervalSeconds`) and reacts instantly to request results.
- **Open 9Router dashboard** in your browser, or in an editor tab (`dashboardOpen: editor`, only when the gateway allows framing — otherwise it falls back automatically).
- **Multiple provider profiles** (local + cloud at once), keys stored in VS Code SecretStorage.
- Vietnamese and English UI.

**Reliability**
- Tool calls with broken JSON are repaired; missing required fields are filled.
- Reasoning is buffered into **one** thinking block per turn (no "Finished with N steps" spam).
- Strict hosts: tool names/ids over 64 chars are shortened on the wire and mapped back (Agent mode keeps working).
- **429/503** → retry with `Retry-After` / exponential backoff.
- **HTTP 400** → retry once without `reasoning_effort`; tools are dropped only when the error message says tools are unsupported. Never after output was shown.
- **Context Window widget / compaction** follow VS Code's own maths (`maxInput + maxOutput` = real window); token usage is forwarded from the gateway, or estimated when the gateway sends none.
- **Output limit** comes from the server (`max_completion_tokens` / `capabilities.maxOutput`, capped at half the window); `defaultMaxOutputTokens` only applies to models that declare none. A `max_tokens too large` error teaches the real ceiling and the request is retried once.
- Real context limit learned from overflow errors; token budget keeps requests inside the window.
- Non-chat rows (image/audio/embedding/rerank…) are hidden from the picker; Responses-only models are kept.

**Models**
- Catalog read from `/v1/models` (`capabilities`, `context_length`, `max_completion_tokens`).
- **Thinking effort** picker (model picker -> gear/sub-menu) built from exactly the levels your gateway publishes (`capabilities.thinkingRange`); nothing is added on top, and a built-in per-format table is used only when the gateway publishes no list. To send a level the gateway does not advertise (e.g. `max` on a Claude model), set it in `perModelOptions`. Nothing is pre-selected: until you pick a level (or set `reasoningEffort` in `perModelOptions`/`extraModelOptions`) no `reasoning_effort` is sent. Models whose id already carries the tier (`...-high`, `...-none`) and models where the gateway ignores the level (MiniMax) show no picker. Turning thinking fully off is not offered.
- `modelFilter` (regex/substring), `modelContextWindows`, `perModelOptions`.
- Optional **vision proxy** for non-vision models, optional `::` model-id encoding.
- Experimental inline (ghost-text) completions through `/v1/completions`.

**Debugging** (`debugMode`)
- `off` (default) · `metadata` (sizes/roles/tool names only) · `verbose` (full request; API keys are **always redacted**).
- Dumps go to the extension storage folder (last 50 kept): *9Router: Open Request Dumps Folder*.
- Legacy `verboseLogging: true` still means *verbose*.

## Key settings

Prefix: `9router-for-github-copilot.`

| Setting | Default | What it does |
| --- | --- | --- |
| `serverUrl` | `http://localhost:20128/v1` | Gateway base URL (a trailing `/v1` is optional) |
| `statusBar` | `true` | Show the status-bar item |
| `healthCheckIntervalSeconds` | `30` | Health probe period (min 5) |
| `dashboardOpen` / `dashboardUrl` | `external` / empty | Where/what the dashboard opens (empty = server root) |
| `debugMode` | `off` | `off` / `metadata` / `verbose` request dumps |
| `modelFilter` | empty | Regex/substring to limit listed model ids (a filter matching nothing is ignored + logged) |
| `enableToolCalling` / `parallelToolCalling` | `true` | Agent tools |
| `agentTemperature` | `0` | Tool-call stability |
| `defaultMaxTokens` | `262144` | Fallback TOTAL context window (input + output) when the server reports none |
| `defaultMaxOutputTokens` | `4096` | Output limit ONLY for models that declare none (a declared limit always wins) |
| `modelContextWindows` | `{}` | Per-model context overrides |
| `perModelOptions` | `{}` | Per-model sampler params |
| `enableImageInput` | `true` | Allow image attachments |
| `visionProxyEnabled` / `visionProxyModel` | `false` / empty | Describe images for non-vision models (extra request; may use a paid model) |
| `encodeSlashInModelId` | `false` | Show `/` in model ids as `::` (resets saved model choice when changed) |
| `requestTimeout` | `60000` | Chat request timeout (ms) |
| `customHeaders` / `extraModelOptions` | `{}` | Extra HTTP headers / extra body parameters for every request |
| `probeThinkingLevels` | `true` | Ask CLIProxyAPI which thinking levels each model accepts (see above); CLIProxyAPI only |
| `enableInlineCompletion` | `false` | Experimental ghost-text completions (see below) |
| `inlineCompletionProvider` / `inlineCompletionModel` | empty | Which provider / model answers inline completions (*Select Inline Completion Model*) |
| `inlineCompletionMaxTokens` / `inlineCompletionDebounce` / `inlineCompletionTimeout` | `256` / `300` / `3000` | Length, typing pause (ms) and timeout (ms) of an inline request |
| `inlineCompletionMaxPrefixChars` / `inlineCompletionMaxSuffixChars` | `4000` / `1000` | Context sent before / after the cursor |
| `apiKey` | empty | Bearer token; prefer the panel or *Manage Providers* (kept in SecretStorage) |

### Adding a second gateway (e.g. CLIProxyAPI on `http://127.0.0.1:8317/v1`)
*9Router: Add Provider* (or the panel) -> name, Base URL ending in `/v1`, API key (kept in SecretStorage). Once two providers are enabled every model is shown as `<provider-id>/<model-id>`, so your previously selected model may need to be picked again; saved ids without a prefix still route to the default provider.

**CLIProxyAPI reports real limits, and the extension reads them.** Its OpenAI-style `/v1/models` has only `{id, object, owned_by}`, but the same URL with an `anthropic-version` header also returns `max_input_tokens` (context window) and `max_tokens` (output limit) for every model, with non-Claude ids cloaked as `claude-fable-5-dd-<reversed id>`. When some models show no context window, the extension makes that one extra request (cached 5 minutes, silent on failure), decodes the ids and fills in only what the gateway did not report itself. Gateways that already report context (9Router) are never asked. The window is taken as the total (input + output) size, which is exact for Claude and the safe side for GPT/Gemini.

**Thinking levels on CLIProxyAPI.** No model list of CLIProxyAPI carries them, but it validates every request per model and names the accepted levels when it gets one it cannot take (`valid levels: low, medium, high, max`). For CLIProxyAPI only (recognised by its cloaked ids) the extension asks that once per model in the background (a request with an invalid level and `max_tokens: 1`; some models answer it as a real 1-token request - 4 of 33 on the audited gateway), then the **Thinking effort** picker shows exactly the gateway's own list for that model - it differs per model (`claude-opus-4-6` has no `xhigh`, `gpt-5.5` has no `max`). Other standard levels are also accepted but the gateway rounds them to the nearest listed one, which is why they are not offered. Models that answer with no list (2 Claude ids on the audited gateway, and models without level support) get no picker; use `perModelOptions` for those. Answers are remembered for 24 hours, also across restarts (per gateway URL, nothing secret is stored); after a restart within that time no request is sent. Turn it off with `probeThinkingLevels: false`.

Gateways that give no limits in either style (plain `{id, object, owned_by}`) get the fallbacks: context `defaultMaxTokens`, output `defaultMaxOutputTokens`, no thinking picker. For those models: raise `defaultMaxOutputTokens` (e.g. `32768`; a declared limit on other gateways still wins), pin real windows with `modelContextWindows` (e.g. `{"claude-*": 200000}`), and set the effort in `perModelOptions` (e.g. `{"gemini-3.8-flash-high": {"reasoningEffort": "high"}}`). Rows that look like image/audio/embedding models (`gpt-image-*`, `dall-e*`, `whisper*`, ...) are hidden only when the row has no metadata at all. A gateway can still list models its upstream no longer serves (404/503); hide them with `modelFilter`, e.g. `^(?!claude-(opus-4-2|opus-4-1|sonnet-4-2|3-))`.

### Vision proxy (experimental)
Works only when the server explicitly reports `capabilities.vision: false` for a model. Costs one extra request per message with images (`visionProxyModel`, or an auto-picked cheap vision model). If it fails, the image becomes `[Image Description unavailable]` and the chat continues.

## Commands

`9Router: Quick Actions` · `Open 9Router Dashboard` · `Manage Providers` · `Add Provider` · `Test Server Connection` · `Refresh Models` · `Edit Custom Headers` · `Select Inline Completion Model` · `Show Output Log` · `Open Request Dumps Folder` · `Clear API Key` · `Open Settings`.

## Troubleshooting

- **No models?** Open the panel: the dot shows reachability. `curl <server-url>/models` should list models. Run *Test Server Connection*; enable `debugMode: metadata` and check *Show Output Log*.
- **Tool calls printed as text?** `agentTemperature: 0`, disable `parallelToolCalling`, and enable auto tool choice on your server (vLLM: `--enable-auto-tool-choice`).
- **Context overflow?** Add the model to `modelContextWindows`; the extension also learns the limit from the error and retries once.
- **Every model listed twice?** Fixed in this build (the vendor no longer declares a VS Code `configuration` schema). VS Code resolves a vendor once per group in `chatLanguageModels.json`, and it creates such a group by itself when you pick a per-model option such as thinking effort; the group is harmless now and can stay.
- **Thinking picker missing on a model?** Either the model id already contains the tier, the gateway reports no `thinkingRange`/format for it, or it is a MiniMax model. Check the *Output Log* with `debugMode: metadata`.
- **Model not in the list (e.g. a newly released one)?** The list is what your gateway returns from `/v1/models`. Add the model in the 9Router dashboard, then run *Refresh Models*.
- **Copilot Agents window?** Not supported by this build (it needs a proposed VS Code API).

## Privacy

Prompts and code go to **your gateway only**. Request dumps stay on your machine and never contain API keys. Copilot Chat itself may still contact GitHub for auth/telemetry/titles — route those with `chat.utilityModel` / `chat.utilitySmallModel`.

## Development

```bash
npm install
npm run check-types   # tsc --noEmit
npm run lint          # eslint src
npm test              # vitest run
npm run compile       # dev bundle -> dist/
npm run vsix          # package (runs the production build first)
```

## License and attribution

Verify a live gateway with `npm run smoke` (activation in an isolated VS Code) and `NINEROUTER_API_KEY=... node scripts/probe-thinking.cjs` (real requests per thinking level).

MIT. A derivative work combining [arbs-io/github-copilot-llm-gateway](https://github.com/arbs-io/github-copilot-llm-gateway), [hotrungnhan/9router-for-github-copilot](https://github.com/hotrungnhan/9router-for-github-copilot), [Vizards/deepseek-v4-for-copilot](https://github.com/Vizards/deepseek-v4-for-copilot) and [diegosouzapw/OmniCopilot](https://github.com/diegosouzapw/OmniCopilot). All copyright notices are kept in [LICENSE](LICENSE) and [NOTICE](NOTICE).
