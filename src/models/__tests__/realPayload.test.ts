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

// ---------- Thinking effort (picker schema -> request wire), N/N over the real catalogue ----------
import { EXTRA_LEVEL_RULES, WIRE_EFFORT_LEVELS, extraEffortLevels, hasReasoningTierInName } from '../modelInfoBuilder';
import { pickReasoningEffort, resolveSendableEffort } from '../../chat/reasoningEffort';

describe.skipIf(rows.length === 0)('real 9Router payload: thinking effort', () => {
  const info = (m: OpenAIModel) =>
    buildModelInfo({ model: m, defaultMaxTokens: 262144, defaultMaxOutputTokens: 4096, capabilities: {} });
  const prop = (m: OpenAIModel) => info(m).info.configurationSchema?.properties.reasoningEffort;
  const range = (m: OpenAIModel): string[] | null =>
    Array.isArray(m.capabilities?.thinkingRange) ? (m.capabilities!.thinkingRange as string[]) : null;

  test('only reasoning models without a baked-in tier get a picker; the rest get none', () => {
    for (const m of rows) {
      const expectNone = !m.capabilities?.reasoning || hasReasoningTierInName(m.id);
      if (expectNone) { assert.equal(prop(m), undefined, `${m.id} must have no picker`); }
    }
  });

  test('every offered level is one the request path can send (pickReasoningEffort accepts it)', () => {
    let offered = 0;
    for (const m of rows) {
      const p = prop(m);
      if (!p) { continue; }
      assert.ok(Array.isArray(p.enum) && p.enum.length > 0, m.id);
      for (const level of p.enum) {
        offered++;
        assert.ok(WIRE_EFFORT_LEVELS.has(level), `${m.id}: ${level} not sendable`);
        assert.equal(pickReasoningEffort({ modelConfiguration: { reasoningEffort: level } }), level, `${m.id}: ${level} dropped on the wire`);
      }
    }
    assert.ok(offered > 500);
  });

  test('the picker offers every level the server lists, plus ONLY the documented extras', () => {
    let checked = 0;
    let withExtras = 0;
    for (const m of rows) {
      const r = range(m);
      const p = prop(m);
      if (!r || !p) { continue; }
      checked++;
      const server = [...new Set(r.map((x) => x.toLowerCase()).filter((x) => WIRE_EFFORT_LEVELS.has(x)))];
      const extras = extraEffortLevels(m);
      for (const level of server) { assert.ok(p.enum.includes(level), `${m.id}: server level ${level} missing`); }
      const added = p.enum.filter((l: string) => !server.includes(l));
      assert.deepEqual(added, extras.filter((l) => !server.includes(l)), `${m.id}: only rule-based extras may be added`);
      if (added.length) { withExtras++; }
    }
    assert.ok(checked > 100);
    // independent count (does not reuse extraEffortLevels): claude-adaptive or cx/gpt-6* models
    // with a picker whose server list lacks max must all have gained exactly that level
    const expected = rows.filter(
      (m) =>
        prop(m) &&
        !(range(m) ?? []).includes('max') &&
        (m.capabilities?.thinkingFormat === 'claude-adaptive' ||
          (m.capabilities?.thinkingFormat === 'openai' && /^cx\/gpt-6/i.test(m.id)))
    ).length;
    assert.equal(withExtras, expected);
    assert.ok(expected > 0);
  });

  test('claude-adaptive: every model offers max, none offers xhigh (this gateway folds xhigh into high)', () => {
    let n = 0;
    for (const m of rows) {
      if (m.capabilities?.thinkingFormat !== 'claude-adaptive' || !prop(m)) { continue; }
      n++;
      assert.ok(prop(m)!.enum.includes('max'), `${m.id} has no max`);
      assert.ok(!prop(m)!.enum.includes('xhigh'), `${m.id} offers xhigh, which would silently become high`);
    }
    assert.ok(n > 10);
  });

  test('cx/gpt-6* (incl. 6.1-sol) offers max; other openai-format models do not get it from the rules', () => {
    for (const m of rows) {
      if (m.capabilities?.thinkingFormat !== 'openai' || !prop(m)) { continue; }
      const expectMax = /^cx\/gpt-6/i.test(m.id);
      const has = prop(m)!.enum.includes('max');
      const serverHasMax = (range(m) ?? []).includes('max');
      if (expectMax) { assert.ok(has, `${m.id} should offer max`); }
      else if (!serverHasMax) { assert.ok(!has, `${m.id} must not get max`); }
    }
  });

  test('every extra rule points at a level the request path can send', () => {
    for (const rule of EXTRA_LEVEL_RULES) { for (const l of rule.add) { assert.ok(WIRE_EFFORT_LEVELS.has(l)); } }
  });

  test('a reasoning model with a published list and no tier in its id always gets a picker', () => {
    for (const m of rows) {
      if (m.capabilities?.reasoning && range(m) && !hasReasoningTierInName(m.id)) {
        assert.ok(prop(m), `${m.id} lost its picker despite thinkingRange ${JSON.stringify(range(m))}`);
      }
    }
  });

  test('every offered level reaches the request through the stale-value guard; a level outside the list does not', () => {
    for (const m of rows) {
      const p = prop(m);
      if (!p) { continue; }
      for (const level of p.enum) {
        assert.equal(resolveSendableEffort(pickReasoningEffort({ modelConfiguration: { reasoningEffort: level } }), p.enum, undefined).effort, level, `${m.id}: ${level}`);
      }
      const missing = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'].find((l) => !p.enum.includes(l));
      if (missing) {
        const r = resolveSendableEffort(pickReasoningEffort({ modelConfiguration: { reasoningEffort: missing } }), p.enum, undefined);
        assert.equal(r.effort, undefined, `${m.id}: stale ${missing} must not be sent`);
        assert.equal(r.dropped, missing);
      }
    }
  });

  test('no model ships a hard-coded default (only a user-configured level may become one)', () => {
    for (const m of rows) { assert.equal(prop(m)?.default, undefined, m.id); }
  });

  test('default is one of the offered levels (or absent); VS Code injects it into every request', () => {
    for (const m of rows) {
      const p = prop(m);
      if (p?.default !== undefined) { assert.ok(p.enum.includes(p.default), `${m.id}: default ${String(p.default)} not offered`); }
    }
  });

  test('claude-budget: no offered level has a budget_tokens >= the advertised output (Anthropic needs max_tokens > budget)', () => {
    const budget: Record<string, number> = { minimal: 512, low: 1024, medium: 8192, high: 24576, xhigh: 32768, max: 128000 };
    for (const m of rows) {
      if (m.capabilities?.thinkingFormat !== 'claude-budget' || range(m)) { continue; }
      const p = prop(m);
      const out = info(m).info.maxOutputTokens;
      for (const level of p?.enum ?? []) { assert.ok(budget[level] < out, `${m.id}: ${level} budget ${budget[level]} >= max_tokens ${out}`); }
    }
  });

  test('summary of the catalogue (informational)', () => {
    let reasoning = 0, picker = 0, baked = 0, noLevels = 0;
    for (const m of rows) {
      if (!m.capabilities?.reasoning) { continue; }
      reasoning++;
      if (prop(m)) { picker++; } else if (hasReasoningTierInName(m.id)) { baked++; } else { noLevels++; }
    }
    assert.equal(picker + baked + noLevels, reasoning);
    console.log(`thinking: reasoning=${reasoning} picker=${picker} tier-in-id=${baked} no-levels=${noLevels}`);
  });
});
