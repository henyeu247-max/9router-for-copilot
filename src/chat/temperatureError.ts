/**
 * Parse temperature constraints out of a 400 Bad Request error.
 *
 * Many reasoning and thinking models enforce strict temperature requirements:
 *  - Kimi K3 / Moonshot: "field Temperature invalid, only 1 is allowed for this model"
 *  - OpenAI o1/o3:       "Unsupported parameter: 'temperature' is not supported with this model"
 *  - Anthropic Thinking: "temperature: 1.0 is required when thinking is enabled"
 *
 * When an upstream server rejects temperature, we learn whether to fix the
 * temperature to a specific value (e.g. 1.0) or omit the field entirely,
 * allowing the request to succeed on retry.
 *
 * Pure and unit-testable.
 */

export type TemperatureAdjustment =
  | { readonly kind: 'fixed'; readonly value: number }
  | { readonly kind: 'omit' };

const FIXED_VALUE_PATTERNS: readonly RegExp[] = [
  // "only 1 is allowed for this model", "only a value of 1.0 is allowed"
  /only\s+(?:a\s+value\s+of\s+)?(\d+(?:\.\d+)?)\s+is\s+allowed/i,
  // "must be 1", "must be 1.0"
  /\bmust\s+be\s+(\d+(?:\.\d+)?)\b/i,
  // "1.0 is required when thinking is enabled"
  /(\d+(?:\.\d+)?)\s+is\s+required/i,
  // "only supports temperature=1", "supports only temperature 1"
  /(?:only\s+supports|supports\s+only)\s+(?:temperature\s*[:=]\s*)?(\d+(?:\.\d+)?)/i,
];

const OMIT_PATTERNS: readonly RegExp[] = [
  /not\s+supported/i,
  /unsupported/i,
  /not\s+allowed/i,
  /unknown\s+parameter/i,
  /unrecognized\s+parameter/i,
  /cannot\s+be\s+set/i,
  /does\s+not\s+support\s+temperature/i,
];

const GENERIC_TEMPERATURE_PATTERNS: readonly RegExp[] = [
  /field\s+temperature\s+invalid/i,
  /invalid.*temperature/i,
  /temperature.*invalid/i,
  /"param"\s*:\s*"temperature"/i,
];

/**
 * Returns true if the error text indicates a rejection of the temperature parameter.
 */
export function isTemperatureError(message: string): boolean {
  if (!/temperature/i.test(message)) {
    return false;
  }
  return (
    FIXED_VALUE_PATTERNS.some((re) => re.test(message)) ||
    OMIT_PATTERNS.some((re) => re.test(message)) ||
    GENERIC_TEMPERATURE_PATTERNS.some((re) => re.test(message))
  );
}

/**
 * Inspect an error message and extract the required temperature adjustment, if any.
 */
export function parseTemperatureError(message: string): TemperatureAdjustment | undefined {
  if (!/temperature/i.test(message)) {
    return undefined;
  }

  // 1. Check for explicit fixed value requirements ("only 1 is allowed", "must be 1.0", etc.)
  for (const re of FIXED_VALUE_PATTERNS) {
    const match = re.exec(message);
    if (match) {
      const val = Number.parseFloat(match[1]);
      if (Number.isFinite(val)) {
        return { kind: 'fixed', value: val };
      }
    }
  }

  // 2. Check if temperature is outright unsupported / forbidden
  for (const re of OMIT_PATTERNS) {
    if (re.test(message)) {
      return { kind: 'omit' };
    }
  }

  // 3. Generic "temperature invalid" without explicit guidance -> default to 1 for reasoning models
  for (const re of GENERIC_TEMPERATURE_PATTERNS) {
    if (re.test(message)) {
      return { kind: 'fixed', value: 1 };
    }
  }

  return undefined;
}
