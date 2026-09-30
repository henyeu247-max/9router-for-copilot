/**
 * Catalog shaping helpers (pure, unit-testable under `node --test`).
 *
 * A gateway `/v1/models` payload may list rows that can never answer
 * `/chat/completions` (image, audio, embedding, rerank, moderation, web
 * search...). Picking one in Copilot fails on the first message with HTTP 400,
 * so they are dropped before reaching the picker. Responses-API-only models
 * are kept: gateways such as 9Router/OmniRoute translate them for chat.
 *
 * The idea of filtering by `type` / `supported_endpoints` is credited to
 * diegosouzapw/OmniCopilot (MIT) - see NOTICE.
 */

const NON_CHAT_KINDS = new Set([
  'image', 'video', 'audio', 'tts', 'stt', 'embedding', 'embeddings',
  'rerank', 'moderation', 'websearch', 'webfetch',
]);

/**
 * Model families that can never answer /chat/completions. Only consulted for rows that carry NO
 * metadata at all (plain `{id, object, owned_by}` from gateways such as CLIProxyAPI). Measured on
 * a live CLIProxyAPI: `gpt-image-*` answer `503 ... only supported on /v1/images/generations`.
 * Deliberately narrow: `gemini-*-image` DOES answer chat, so it is not listed.
 */
const NON_CHAT_ID = /^(gpt-image|dall-e|imagen|sora|whisper|tts-|text-embedding|omni-moderation)/i;

interface CatalogRow {
  id: string;
  capabilities?: unknown;
  type?: unknown;
  kind?: unknown;
  supported_endpoints?: unknown;
}

const norm = (v: unknown): string => (typeof v === 'string' ? v.trim().toLowerCase() : '');

/** True when the row can be used from a chat request. Unknown shapes are kept. */
export function isChatCapable(row: CatalogRow): boolean {
  for (const field of [row.type, row.kind]) {
    if (NON_CHAT_KINDS.has(norm(field))) { return false; }
  }
  const endpoints = row.supported_endpoints;
  if (Array.isArray(endpoints) && endpoints.length > 0) {
    return endpoints.some((e) => {
      const v = norm(e);
      return v === 'chat' || v === 'responses' || v.includes('chat/completions');
    });
  }
  // No type/kind/endpoints/capabilities: the only signal left is the id.
  const hasMetadata = row.type !== undefined || row.kind !== undefined || row.capabilities !== undefined;
  if (!hasMetadata && NON_CHAT_ID.test(row.id.slice(row.id.lastIndexOf('/') + 1))) {
    return false;
  }
  return true;
}

function escapeRegExp(text: string): string {
  const special = '\\^$.*+?()[]{}|/-';
  let out = '';
  for (const ch of text) {
    out += special.includes(ch) ? `\\${ch}` : ch;
  }
  return out;
}

/** Drop specialty rows, preserving order. */
export function selectChatModels<T extends CatalogRow>(models: readonly T[]): T[] {
  return models.filter(isChatCapable);
}

/**
 * Compile a user filter (regex, falling back to a literal substring when the
 * regex is invalid). Empty input returns undefined = no filtering.
 */
export function compileModelFilter(raw: string | undefined): RegExp | undefined {
  const text = (raw ?? '').trim();
  if (!text) { return undefined; }
  try {
    return new RegExp(text, 'i');
  } catch {
    return new RegExp(escapeRegExp(text), 'i');
  }
}

/** Apply an include filter. A filter that would hide EVERYTHING is ignored so a typo can't blank the picker. */
export function applyModelFilter<T extends { id: string }>(
  models: readonly T[],
  raw: string | undefined,
  onIgnored?: (filter: string) => void
): T[] {
  const re = compileModelFilter(raw);
  if (!re) { return [...models]; }
  const kept = models.filter((m) => re.test(m.id));
  if (kept.length === 0 && models.length > 0) {
    onIgnored?.((raw ?? '').trim());
    return [...models];
  }
  return kept;
}
