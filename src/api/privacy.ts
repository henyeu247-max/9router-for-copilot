/**
 * Privacy helpers - redact secrets from dumps and diagnostic strings.
 * Pure (no `vscode` import). Adapted from the earlier 0.9.x line (MIT, see NOTICE).
 */

const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._\-+/=]+/giu;
const API_KEY_PATTERN = /\b(sk-[A-Za-z0-9_-]{8,}|sk-or-v1-[A-Za-z0-9_-]{8,})\b/giu;
const AUTHORIZATION_HEADER_PATTERN = /("authorization"\s*:\s*")Bearer\s+[^"]+(")/giu;

export const REDACTED = '***REDACTED***';

/** Redact common secret patterns from a free-form string. */
export function redactSecrets(value: string): string {
  return value
    .replace(AUTHORIZATION_HEADER_PATTERN, `$1Bearer ${REDACTED}$2`)
    .replace(BEARER_PATTERN, `Bearer ${REDACTED}`)
    .replace(API_KEY_PATTERN, REDACTED);
}

/** Deep-clone a JSON-compatible value while redacting secret-looking fields. */
export function redactSensitiveValue<T>(value: T): T {
  return redactValue(value) as T;
}

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') { return redactSecrets(value); }
  if (Array.isArray(value)) { return value.map(redactValue); }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(key)) {
        out[key] = typeof entry === 'string' && entry.length > 0 ? REDACTED : entry;
        continue;
      }
      out[key] = redactValue(entry);
    }
    return out;
  }
  return value;
}

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  // Usage / telemetry counters are never secrets.
  if (/(prompt|completion|total|cached)_tokens?$|cache_(hit|miss)/.test(lower)) { return false; }
  return (
    lower === 'authorization' || lower === 'api_key' || lower === 'apikey' || lower === 'x-api-key' ||
    lower === 'password' || lower === 'access_token' || lower === 'refresh_token' || lower === 'id_token' ||
    lower.endsWith('_api_key') || lower.endsWith('apikey') || lower.includes('secret')
  );
}
