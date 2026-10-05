# Chat fails with "Inference server reported an error mid-stream: unexpected EOF"

Date: 2026-10-05. Status: extension mitigation shipped; upstream cause not fully identified.

## Symptom
Copilot Chat shows `9Router: Chat request failed. Chat completion request failed: Inference server reported an error mid-stream: unexpected EOF`. The turn ends; later turns work.

## Verified error chain
1. The gateway (CLIProxyAPI 8.0.2 at the time) reads the Antigravity upstream response body and the read fails with `unexpected EOF`.
2. HTTP 200 and the SSE headers were already sent, so the gateway reports the failure as an inline SSE error payload.
3. `GatewayClient` (`src/api/client.ts`) throws `Inference server reported an error mid-stream: <message>`.
4. Before the fix nothing recovered from it.

The extension does not generate this error. It only surfaces what the gateway streams.

## Gateway evidence (log of 3-5 Oct 2026)
- All 16 Antigravity failures that day were model `gemini-3.8-flash-high`; Codex and Claude routes in the same period were unaffected.
- Two failures were body EOF (`unexpected EOF`, 30 s and 40.5 s). Fourteen were `Post ".../streamGenerateContent": EOF` after about 32-34 s (before a response). The gateway retried the latter internally; one request needed 8 attempts (4 min 56 s) and was finally served by `gemini-3.8-flash` instead of the requested `-high` variant.
- The gateway process was stable (no restart, empty err log) and no proxy was configured.
- Not established: whether Google, the network path or an intermediary closes the connection, and why it started on 5 Oct.

## Mitigation in the extension
`src/api/retryLoop.ts` retries exactly once on this inline EOF error, only if no response part (text, reasoning, tool call) was reported and the request was not cancelled. Request options are unchanged. A second EOF is thrown as is. Other errors (quota, HTTP 5xx, arbitrary `Error("unexpected EOF")`) do not match. Covered by 6 tests in `src/api/__tests__/retryLoop.test.ts`.

After output has started the error still surfaces: replaying would duplicate text or tool calls, and a tool may already have run.

## Gateway action taken (outside this repo)
CLIProxyAPI was updated 8.0.2 → 8.0.15 and debug logging enabled to capture the next failure. The release notes contain no fix for connection-level EOF; whether the update changes the behavior is unverified. Backup of the previous binary and config was kept next to the gateway install.

## Follow-up
Compare Antigravity failures in the gateway log after the update. Still failing at about 33 s: upstream or network limit. Gone: the update helped. Do not share debug logs; they can contain request content.
