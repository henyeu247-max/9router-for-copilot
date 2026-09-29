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
- **Status bar**: click for *Quick Actions*; hover for a rich tooltip (models, context, last request, session tokens).
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
- Real context limit learned from overflow errors; token budget keeps requests inside the window.
- Non-chat rows (image/audio/embedding/rerank…) are hidden from the picker; Responses-only models are kept.

**Models**
- Catalog read from `/v1/models` (`capabilities`, `context_length`, `max_completion_tokens`).
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
| `defaultMaxTokens` / `defaultMaxOutputTokens` | see package.json | Fallback limits |
| `modelContextWindows` | `{}` | Per-model context overrides |
| `perModelOptions` | `{}` | Per-model sampler params |
| `enableImageInput` | `true` | Allow image attachments |
| `visionProxyEnabled` / `visionProxyModel` | `false` / empty | Describe images for non-vision models (extra request; may use a paid model) |
| `encodeSlashInModelId` | `false` | Show `/` in model ids as `::` (resets saved model choice when changed) |

### Vision proxy (experimental)
Works only when the server explicitly reports `capabilities.vision: false` for a model. Costs one extra request per message with images (`visionProxyModel`, or an auto-picked cheap vision model). If it fails, the image becomes `[Image Description unavailable]` and the chat continues.

## Commands

`9Router: Quick Actions` · `Open 9Router Dashboard` · `Manage Providers` · `Add Provider` · `Test Server Connection` · `Refresh Models` · `Edit Custom Headers` · `Select Inline Completion Model` · `Show Output Log` · `Open Request Dumps Folder` · `Clear API Key` · `Open Settings`.

## Troubleshooting

- **No models?** Open the panel: the dot shows reachability. `curl <server-url>/models` should list models. Run *Test Server Connection*; enable `debugMode: metadata` and check *Show Output Log*.
- **Tool calls printed as text?** `agentTemperature: 0`, disable `parallelToolCalling`, and enable auto tool choice on your server (vLLM: `--enable-auto-tool-choice`).
- **Context overflow?** Add the model to `modelContextWindows`; the extension also learns the limit from the error and retries once.
- **Agents window?** It runs in a separate process: add `"extensions.supportAgentsWindow": { "henyeu247-max.9router-for-github-copilot": true }` and reload.

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

MIT. A derivative work combining [arbs-io/github-copilot-llm-gateway](https://github.com/arbs-io/github-copilot-llm-gateway), [hotrungnhan/9router-for-github-copilot](https://github.com/hotrungnhan/9router-for-github-copilot), [Vizards/deepseek-v4-for-copilot](https://github.com/Vizards/deepseek-v4-for-copilot) and [diegosouzapw/OmniCopilot](https://github.com/diegosouzapw/OmniCopilot). All copyright notices are kept in [LICENSE](LICENSE) and [NOTICE](NOTICE).
