/**
 * Model ID namespacing and parsing for multi-profile support.
 *
 * When only one profile is active, models expose raw IDs (e.g. 'qwen2.5-coder-32b')
 * to remain fully backward-compatible with settings, history, and single-provider users.
 *
 * When two or more profiles are active, models are namespaced as:
 *   `${profileId}/${rawModelId}`
 * e.g. 'local/qwen2.5-coder-32b' vs 'cloud/qwen2.5-coder-32b'.
 *
 * Incoming requests are parsed back into (profileId, rawModelId) using the
 * set of known active profile IDs.
 */

/** Separator used instead of `/` inside a raw model id when slash-encoding is on. */
export const SLASH_ENCODED_SEP = '::';

/**
 * VS Code identifies a chat model as `vendor/id`. A gateway id that itself
 * contains `/` (e.g. `xai/grok-4.5`) becomes a 3-segment identifier that can
 * collide with same-named BYOK vendors and break picker search. When enabled,
 * `/` inside the RAW id is exposed as `::` (`xai::grok-4.5`); the gateway still
 * receives the original id (see {@link parseModelTarget}).
 */
export function encodeSlashInModelId(rawModelId: string): string {
  return rawModelId.replaceAll('/', SLASH_ENCODED_SEP);
}

export function decodeSlashInModelId(exposedModelId: string): string {
  return exposedModelId.replaceAll(SLASH_ENCODED_SEP, '/');
}

export interface ParsedModelTarget {
  readonly profileId: string;
  readonly rawModelId: string;
}

/**
 * Format a model ID for exposure to VS Code's model picker.
 *
 * Namespaces only when `namespaceEnabled` is true (i.e. more than 1 enabled profile).
 */
export function formatExposedModelId(
  profileId: string,
  rawModelId: string,
  namespaceEnabled: boolean,
  encodeSlash = false
): string {
  const id = encodeSlash ? encodeSlashInModelId(rawModelId) : rawModelId;
  return namespaceEnabled ? `${profileId}/${id}` : id;
}

/**
 * Parse an incoming model ID from VS Code back to its target profile and raw model ID.
 *
 * Resolution order:
 * 1. If the ID starts with `${knownProfileId}/`, strip that prefix and route there.
 * 2. If no prefix matches:
 *    a. If there is an active profile with id === fallbackProfileId, route there with rawId = modelId.
 *    b. Otherwise route to the first known profile ID, or return fallbackProfileId.
 */
export function parseModelTarget(
  modelId: string,
  knownProfileIds: readonly string[],
  fallbackProfileId: string
): ParsedModelTarget {
  const target = parseModelTargetRaw(modelId, knownProfileIds, fallbackProfileId);
  // Always decode `::` even when the setting is now off: a chat session saved
  // while it was ON must keep resolving. Raw gateway ids containing `::` are
  // therefore unsupported (none exist on 9Router; ids use `/`).
  return { ...target, rawModelId: decodeSlashInModelId(target.rawModelId) };
}

function parseModelTargetRaw(
  modelId: string,
  knownProfileIds: readonly string[],
  fallbackProfileId: string
): ParsedModelTarget {
  const trimmed = modelId.trim();
  const slashIndex = trimmed.indexOf('/');

  if (slashIndex > 0) {
    const candidateProfile = trimmed.slice(0, slashIndex);
    if (knownProfileIds.includes(candidateProfile)) {
      return {
        profileId: candidateProfile,
        rawModelId: trimmed.slice(slashIndex + 1),
      };
    }
  }

  // Not namespaced or candidate profile unknown — fallback
  const resolvedProfile = knownProfileIds.includes(fallbackProfileId)
    ? fallbackProfileId
    : knownProfileIds[0] ?? fallbackProfileId;

  return {
    profileId: resolvedProfile,
    rawModelId: trimmed,
  };
}
