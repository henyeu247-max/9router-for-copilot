import { createHash } from 'node:crypto';

/**
 * Wire-safe tool names for strict OpenAI-compatible hosts (e.g. Meta Llama API):
 *   - `tools[].function.name` and `tool_calls[].function.name` <= 64 chars
 *   - charset `^[a-zA-Z0-9_.-]+$`, at most one `.`
 *   - `tool_call_id` <= 64 chars
 * Names are deterministic (hash suffix when altered) and mapped back to the
 * original VS Code tool name on the response so Agent mode still runs the right tool.
 *
 * Pure (no `vscode` import) so it is unit-testable under `node --test`.
 */
export const MAX_TOOL_FUNCTION_NAME_LEN = 64;
export const MAX_TOOL_CALL_ID_LEN = 64;

const sha1 = (s: string, n: number): string => createHash('sha1').update(s).digest('hex').slice(0, n);

/** Stable wire name. Unchanged when already valid. */
export function wireToolName(original: string): string {
  const name = original.trim();
  let safe = name.replace(/[^a-zA-Z0-9_.-]/g, '_');
  // at most one dot
  const firstDot = safe.indexOf('.');
  if (firstDot !== -1) {
    safe = safe.slice(0, firstDot + 1) + safe.slice(firstDot + 1).replaceAll('.', '_');
  }
  if (safe === name && safe.length <= MAX_TOOL_FUNCTION_NAME_LEN) {
    return name;
  }
  const hash = sha1(name, 8);
  const maxPrefix = MAX_TOOL_FUNCTION_NAME_LEN - 1 - hash.length;
  return `${safe.slice(0, Math.max(1, maxPrefix))}_${hash}`;
}

export function wireToolCallId(original: string): string {
  if (original.length <= MAX_TOOL_CALL_ID_LEN) {
    return original;
  }
  const hash = sha1(original, 16);
  return `${original.slice(0, MAX_TOOL_CALL_ID_LEN - 1 - hash.length)}_${hash}`;
}

export interface ToolNameMap {
  /** wire name -> original name */
  readonly wireToOriginal: Map<string, string>;
  /** original name -> wire name */
  readonly originalToWire: Map<string, string>;
}

/** Build a collision-free mapping for a request's tool list. */
export function buildToolNameMap(originalNames: readonly string[]): ToolNameMap {
  const wireToOriginal = new Map<string, string>();
  const originalToWire = new Map<string, string>();
  for (const original of originalNames) {
    if (originalToWire.has(original)) { continue; }
    let wire = wireToolName(original);
    let salt = 0;
    while (wireToOriginal.has(wire) && wireToOriginal.get(wire) !== original) {
      salt++;
      const hash = sha1(`${original}#${salt}`, 8);
      wire = `${wire.slice(0, MAX_TOOL_FUNCTION_NAME_LEN - 1 - hash.length)}_${hash}`;
    }
    wireToOriginal.set(wire, original);
    originalToWire.set(original, wire);
  }
  return { wireToOriginal, originalToWire };
}

/** Restore the original tool name for a streamed tool call (falls back to input). */
export function restoreToolName(map: ToolNameMap, wire: string): string {
  return map.wireToOriginal.get(wire) ?? wire;
}

interface ToolCallLike { id: string; function: { name: string } }

/**
 * Rewrite tool names / call ids in conversation history to their wire form so
 * history stays consistent with the (possibly shortened) `tools[]` we send.
 * Mutates in place and returns the same array. Accepts loose records
 * (`OpenAIMessage` is `Record<string, unknown>`).
 */
export function rewriteHistoryToolNames<T extends Record<string, unknown>>(messages: T[], map: ToolNameMap): T[] {
  for (const m of messages) {
    const toolCalls = m.tool_calls;
    if (Array.isArray(toolCalls)) {
      for (const tc of toolCalls as ToolCallLike[]) {
        tc.function.name = map.originalToWire.get(tc.function.name) ?? wireToolName(tc.function.name);
        tc.id = wireToolCallId(tc.id);
      }
    }
    if (m.role === 'tool' && typeof m.tool_call_id === 'string') {
      (m as Record<string, unknown>).tool_call_id = wireToolCallId(m.tool_call_id);
    }
  }
  return messages;
}
