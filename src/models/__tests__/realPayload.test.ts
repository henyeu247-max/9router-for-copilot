import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildModelInfo } from '../modelInfoBuilder';
import { TOKEN_CONSTANTS, calculateMaxInputTokens, calculateSafeMaxOutputTokens, toConservativeTokens } from '../../chat/tokenBudget';
import type { OpenAIModel } from '../../api/types';

// Property test over a REAL `GET /v1/models` capture (623 rows from a running 9Router).
// Skipped when the fixture is absent (it is not committed).
const path = resolve(__dirname, '..', '..', '..', '_models.json');
const rows: OpenAIModel[] = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')).data : [];
const TOOLS = [0, 24000, 100000]; // serialized tool catalogue sizes (chars)

describe.skipIf(rows.length === 0)('real 9Router payload: context/compact invariants', () => {
  const build = (m: OpenAIModel) =>
    buildModelInfo({ model: m, defaultMaxTokens: 262144, defaultMaxOutputTokens: 4096, capabilities: {} });
  const declared = (m: OpenAIModel) =>
    m.max_completion_tokens ?? m.capabilities?.maxOutput;

  test('maxInput + maxOutput == the real window (what VS Code shows)', () => {
    for (const m of rows) {
      const { info, totalContext } = build(m);
      assert.equal(info.maxInputTokens + info.maxOutputTokens, totalContext, m.id);
    }
  });

  test('maxOutput honours the server: never above declared, never above half the window', () => {
    for (const m of rows) {
      const { info, totalContext } = build(m);
      const d = declared(m);
      if (d) { assert.ok(info.maxOutputTokens <= d, `${m.id} out ${info.maxOutputTokens} > declared ${d}`); }
      assert.ok(info.maxOutputTokens <= Math.floor(totalContext / 2), m.id);
      assert.ok(info.maxOutputTokens >= TOKEN_CONSTANTS.MIN_OUTPUT_TOKENS, m.id);
    }
  });

  test('the server value is used, not the 4096 setting (was capped for 621/623 models)', () => {
    let atDefault = 0;
    for (const m of rows) {
      const d = declared(m);
      const { info, totalContext } = build(m);
      if (d && d > 4096 && Math.floor(totalContext / 2) > 4096 && info.maxOutputTokens === 4096) { atDefault++; }
    }
    assert.equal(atDefault, 0);
  });

  test('every model keeps a usable input window', () => {
    for (const m of rows) {
      assert.ok(build(m).info.maxInputTokens >= 4096, m.id);
    }
  });

  test('the extension gate never fires before VS Code starts compacting, and a prompt at the gate keeps its full output', () => {
    let checked = 0;
    for (const m of rows) {
      const { info, totalContext } = build(m);
      for (const toolsChars of TOOLS) {
        const toolsRaw = Math.ceil(toolsChars / TOKEN_CONSTANTS.CHARS_PER_TOKEN);
        const gate = calculateMaxInputTokens({ modelMaxContext: totalContext, configuredMaxOutput: info.maxOutputTokens, toolsSerializedLength: toolsChars });
        if (gate === 0) { continue; }
        checked++;
        // VS Code counts through provideTokenCount = the conservative scale
        const seenByVsCode = toConservativeTokens(gate + toolsRaw);
        assert.ok(seenByVsCode >= info.maxInputTokens * 0.78, `${m.id} tools=${toolsChars}: gate ${seenByVsCode} < 78% of ${info.maxInputTokens}`);
        assert.ok(seenByVsCode <= info.maxInputTokens, `${m.id} tools=${toolsChars}: gate ${seenByVsCode} > maxInput ${info.maxInputTokens}`);
        const safe = calculateSafeMaxOutputTokens({ estimatedInputTokens: gate, toolsOverhead: toolsRaw, modelMaxContext: totalContext, configuredMaxOutput: info.maxOutputTokens });
        assert.equal(safe, info.maxOutputTokens, `${m.id} tools=${toolsChars}: output collapsed to ${safe}`);
      }
    }
    assert.ok(checked > 1000);
  });
});
