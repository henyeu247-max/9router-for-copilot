/**
 * Per-model thinking levels for gateways that do not publish them (CLIProxyAPI).
 *
 * CLIProxyAPI keeps a thinking configuration per model (levels, budget range) and validates every
 * request against it, but none of its model lists (OpenAI, Anthropic, Gemini style) carries it.
 * The one place it shows up is the validation error for a level the model does not accept:
 *
 *   400 {"error":{"message":"level \"x\" not supported, valid levels: low, medium, high, max"}}
 *
 * (router-for-me/CLIProxyAPI, internal/thinking/validate.go). Measured live on 33 models: 27 answered
 * with their own exact list (it differs per model: claude-opus-4-6 has no `xhigh`, gpt-5.5 has no
 * `max`, gemini-3-flash has `minimal`); 2 said only "unknown level"; 4 accepted the bogus value and
 * simply ran (models without level support).
 *
 * Nothing here is hard-coded per model: every list comes from the gateway's own answer. The probe
 * request itself is built in the client (max_tokens 1); this module only interprets the answer and
 * merges it into model rows.
 */
import type { OpenAIModel } from '../api/types';
import { WIRE_EFFORT_LEVELS } from './modelInfoBuilder';

/** A value no gateway can accept as a real level. */
export const PROBE_LEVEL = '__probe__';

export type ProbeOutcome =
  | { readonly kind: 'levels'; readonly levels: readonly string[] }
  /** Answered, but the model exposes no usable list (accepted the value, or "unknown level"). */
  | { readonly kind: 'none' }
  /** Network error / unexpected status: nothing learned. */
  | { readonly kind: 'error' };

/** Pull the list out of `valid levels: a, b, c`, keeping only levels the request path can send. */
export function parseValidLevels(text: string): string[] {
  const m = /valid levels:\s*([A-Za-z0-9_,\s.-]+)/i.exec(text);
  if (!m) {
    return [];
  }
  const seen = new Set<string>();
  for (const raw of m[1].split(',')) {
    const level = raw.trim().toLowerCase();
    if (WIRE_EFFORT_LEVELS.has(level)) {
      seen.add(level);
    }
  }
  return [...seen];
}

/** Interpret the gateway's answer to a request carrying {@link PROBE_LEVEL}. */
export function classifyProbe(status: number | undefined, body: string): ProbeOutcome {
  if (status === undefined) {
    return { kind: 'error' }; // network trouble / timeout
  }
  if (status === 200) {
    return { kind: 'none' }; // it took the bogus value: this model has no level validation
  }
  if (status === 400 || status === 404 || status === 422) {
    const levels = parseValidLevels(body);
    if (levels.length > 0) {
      return { kind: 'levels', levels };
    }
    // The gateway answered but names no list ("unknown level", model retired, a wording we do not
    // know, an upstream refusing max_tokens 1...). That is an answer, not trouble: it is remembered
    // like any other so a wording change can never turn into a request storm.
    return { kind: 'none' };
  }
  return { kind: 'error' }; // 401/403 (auth), 429, 5xx: transient, retried later
}

/**
 * Give bare rows (no `capabilities` at all) their probed levels as an explicit
 * `capabilities.reasoningEffort` list, which the picker treats as authoritative. Rows that already
 * carry capabilities are never touched.
 */
export function applyProbedLevels(
  models: readonly OpenAIModel[],
  levelsById: ReadonlyMap<string, readonly string[]>
): OpenAIModel[] {
  return models.map((m) => {
    const levels = levelsById.get(m.id);
    if (!levels || levels.length === 0 || m.capabilities !== undefined) {
      return m;
    }
    return { ...m, capabilities: { reasoning: true, reasoningEffort: [...levels] } };
  });
}
