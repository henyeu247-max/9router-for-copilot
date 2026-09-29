# Changelog

## 2.2.0

### Added
- **Non-chat model filtering** (`src/models/catalogFilter.ts`): rows typed image/video/audio/tts/stt/embedding/rerank/moderation/webSearch/webFetch, or whose `supported_endpoints` lack chat/responses, are hidden from the picker. Responses-only models stay.
- **`modelFilter` setting**: regex (or substring if invalid) on model ids; a filter that matches nothing is ignored and logged so a typo can't blank the picker.
- **HTTP 400 graceful degradation** (`src/api/degrade.ts`, `src/api/retryLoop.ts`): retry once without `reasoning_effort`; drop tools only when the error message points at tools. Never after output was streamed or after cancellation; bounded to 4 attempts total together with the single context-overflow retry. Chat HTTP failures now carry a typed `ChatHttpError.status`.

### Licensing
- `NOTICE` now also credits diegosouzapw/OmniCopilot (MIT).

### Notes
- Not ported on purpose: Copilot Agents-window registration (proposed VS Code API), price/cost display, request dumps, routing classifier.
- Test suite: 532 tests (was 505).

## 2.1.0

Ported from the 0.9.x line and hardened against the OmniCopilot / 9Router catalog contract.

### Added
- **Tool-name wire shortening** (`src/chat/toolNames.ts`): tool names and call ids are made safe for strict OpenAI-compatible hosts (<= 64 chars, `^[a-zA-Z0-9_.-]+$`, at most one `.`) with a deterministic hash suffix, collision-free. Streamed tool calls are mapped back to the original VS Code tool name; conversation history is rewritten consistently. Valid names are left untouched.
- **Vision proxy** (`visionProxyEnabled`, `visionProxyModel`, default **off**): describes images for models the server reports as non-vision, inserts the text description, degrades to a marker on failure. See README.
- **`encodeSlashInModelId`** (default **off**): exposes `/` in model ids as `::` in the picker; decoding is always on so old sessions still resolve.
- **429/503 retry** with `Retry-After` (seconds or HTTP date) or exponential backoff (`src/api/rateLimitRetry.ts`), applied to streaming chat and the vision call before any body is consumed.

### Fixed
- **Thinking display**: reasoning deltas are buffered and emitted as **one** `LanguageModelThinkingPart` with a stable id per turn, then closed with `vscode_reasoning_done`. Previously each token created its own visible step ("Finished with N steps"). Reasoning arriving after the block closed (interleaved models) is ignored; the block is closed on text, tool call, end of stream.

### Licensing
- `LICENSE` now lists every copyright holder (arbs-io, hotrungnhan, henyeu247-max); added `NOTICE` with third-party attribution (incl. Vizards/deepseek-v4-for-copilot for adapted code). Publisher/repository metadata point to henyeu247-max. Extension id is now `henyeu247-max.9router-for-github-copilot` (settings keys unchanged).

### Notes
- Changing `encodeSlashInModelId` resets saved model selections in the picker.
- Vision proxy only triggers when the server explicitly reports `vision: false`; it may call a paid model, hence off by default.
- Test suite: 505 tests (was 482).

## 2.0.1

Upstream release (hotrungnhan/9router-for-github-copilot).
