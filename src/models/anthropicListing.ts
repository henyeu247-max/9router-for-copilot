/**
 * Context / output limits from an Anthropic-style model listing.
 *
 * Some gateways (CLIProxyAPI) answer the OpenAI `GET /v1/models` with only `{id, object, owned_by}`,
 * but answer the SAME url in Anthropic style when the request carries an `anthropic-version` header
 * (or a claude-cli user agent): each row then also has `display_name`, `max_input_tokens` and
 * `max_tokens`. Verified live on a CLIProxyAPI: 38/38 rows carried both numbers.
 *
 * Cloaked ids: in that Anthropic listing CLIProxyAPI renames every model whose id does not start
 * with `claude-` to `claude-fable-5-dd-` + the id reversed rune by rune, so Claude Code accepts
 * them (router-for-me/CLIProxyAPI, internal/client/claude/models/models.go:
 * EnsureClaudeModelIDPrefix / ResolveClaudeModelIDPrefix). `gemini-3-flash` therefore appears as
 * `claude-fable-5-dd-hsalf-3-inimeg`. We decode it exactly as the gateway does, and a decoded id is
 * only used when the OpenAI listing really contains it.
 *
 * Meaning of the numbers: `max_input_tokens` is the model's context window (Anthropic API docs), i.e.
 * the same thing 9Router calls `context_length` (1,000,000 for a 1M Claude whose `max_tokens` is
 * 128,000); `max_tokens` is the largest allowed `max_tokens` request value.
 */
import type { OpenAIModel } from '../api/types';
import { serverReportedContext } from '../chat/contextWindow';

/** Value CLIProxyAPI's own Anthropic listing accepts; any well-formed version works. */
export const ANTHROPIC_VERSION_HEADER = '2023-06-01';

/** Prefix CLIProxyAPI puts in front of a reversed, non-`claude-` model id. */
export const CLOAK_PREFIX = 'claude-fable-5-dd-';

export interface ListingLimits {
  /** Context window, tokens. */
  readonly contextWindow: number;
  /** Largest allowed `max_tokens`. */
  readonly maxOutput: number;
}

const reverseRunes = (s: string): string => [...s].reverse().join('');

/** Inverse of CLIProxyAPI's cloaking; ids that are not cloaked are returned unchanged. */
export function decodeCloakedId(id: string): string {
  if (!id.startsWith(CLOAK_PREFIX) || id.length === CLOAK_PREFIX.length) {
    return id;
  }
  return reverseRunes(id.slice(CLOAK_PREFIX.length));
}

/**
 * True when an Anthropic-style listing contains CLIProxyAPI's cloaked ids. Only that gateway does
 * this, so it doubles as the signature that lets us tell it apart from Ollama, vLLM, OpenRouter...
 */
export function hasCloakedIds(payload: unknown): boolean {
  const rows = (payload as { data?: unknown } | null | undefined)?.data;
  return Array.isArray(rows) && rows.some((r) => typeof (r as { id?: unknown } | null)?.id === 'string' && ((r as { id: string }).id).startsWith(CLOAK_PREFIX) && (r as { id: string }).id.length > CLOAK_PREFIX.length);
}

const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * Parse an Anthropic-style `{ data: [...] }` listing into id -> limits (ids decoded).
 * Rows without BOTH positive numbers are ignored; anything that is not a listing yields an empty map.
 */
export function parseAnthropicListing(payload: unknown): Map<string, ListingLimits> {
  const out = new Map<string, ListingLimits>();
  const rows = (payload as { data?: unknown } | null | undefined)?.data;
  if (!Array.isArray(rows)) {
    return out;
  }
  for (const row of rows) {
    const r = row as { id?: unknown; max_input_tokens?: unknown; max_tokens?: unknown } | null;
    if (typeof r?.id !== 'string' || !positive(r.max_input_tokens) || !positive(r.max_tokens)) {
      continue;
    }
    out.set(decodeCloakedId(r.id), { contextWindow: r.max_input_tokens, maxOutput: r.max_tokens });
  }
  return out;
}

const declaresOutput = (m: OpenAIModel): boolean => positive(m.max_completion_tokens) || positive(m.capabilities?.maxOutput);

/** True when at least one model gives no context window, i.e. the extra request can help. */
export function needsListingLimits(models: readonly OpenAIModel[]): boolean {
  return models.some((m) => serverReportedContext(m) === undefined);
}

export interface EnrichResult {
  readonly models: OpenAIModel[];
  /** Models that received a context window and/or an output limit. */
  readonly filled: number;
}

/**
 * Fill ONLY what the server left out: a model that already reports a context window or an output
 * limit keeps it. Returns the original array when nothing changed.
 */
export function applyListingLimits(models: readonly OpenAIModel[], limits: ReadonlyMap<string, ListingLimits>): EnrichResult {
  let filled = 0;
  const next = models.map((m) => {
    const l = limits.get(m.id);
    if (!l) {
      return m;
    }
    const needCtx = serverReportedContext(m) === undefined;
    const needOut = !declaresOutput(m);
    if (!needCtx && !needOut) {
      return m;
    }
    filled++;
    return {
      ...m,
      ...(needCtx ? { context_length: l.contextWindow } : {}),
      ...(needOut ? { max_completion_tokens: l.maxOutput } : {}),
    };
  });
  return filled === 0 ? { models: models as OpenAIModel[], filled } : { models: next, filled };
}
