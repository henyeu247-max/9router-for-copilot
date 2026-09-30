#!/usr/bin/env node
/**
 * Live probe: does the gateway really accept every thinking-effort level the picker offers?
 *
 *   NINEROUTER_API_KEY=sk-... node scripts/probe-thinking.cjs [--base URL] [--models id1,id2] [--control]
 *
 * For each selected model it sends one tiny request per advertised level (thinkingRange) plus a
 * no-effort baseline, and prints HTTP status, whether reasoning text came back, and any error.
 * Defaults to one cheap, non-combo, no-tier-in-id model per thinking format.
 * --control also sends the level "bogus" to show whether the gateway validates levels at all.
 * Costs a few hundred tokens per call. The key is read from the environment only and never printed.
 */
const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt; };
const BASE = opt('--base', 'http://127.0.0.1:20128/v1').replace(/\/$/, '');
const KEY = process.env.NINEROUTER_API_KEY || '';
const only = opt('--models', '') ? opt('--models', '').split(',') : null;
const control = argv.includes('--control');
const headers = { 'content-type': 'application/json', ...(KEY ? { authorization: `Bearer ${KEY}` } : {}) };

const TIER = new Set(['low', 'medium', 'high', 'extra', 'max', 'xhigh', 'thinking', 'agentic', 'none', 'minimal']);
// NOTE: mirrors hasReasoningTierInName() in src/models/modelInfoBuilder.ts - keep in sync.
const hasTier = (id) => {
  const p = id.includes('/') ? id.slice(id.indexOf('/') + 1) : id;
  return p.split(/[-_]/).slice(-3).some((s) => TIER.has(s.toLowerCase()) && !(s.toLowerCase() === 'max' && /^qwen/i.test(p)));
};
const cheap = /flash|mini|haiku|lite|nano|small|air|turbo/i;

async function call(model, effort) {
  const body = { model, max_tokens: 400, stream: false, messages: [{ role: 'user', content: 'What is 17*23? Answer with just the number.' }] };
  if (effort) { body.reasoning_effort = effort; }
  const t0 = Date.now();
  try {
    const r = await fetch(`${BASE}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    const text = await r.text();
    let j; try { j = JSON.parse(text); } catch { /* not JSON */ }
    const msg = j?.choices?.[0]?.message;
    const reasoning = msg?.reasoning_content ?? msg?.reasoning;
    return { status: r.status, ms: Date.now() - t0, reasoning: reasoning ? reasoning.length : 0, out: String(msg?.content ?? '').trim().slice(0, 16), error: r.ok ? '' : String(j?.error?.message ?? text).slice(0, 120) };
  } catch (e) { return { status: 'ERR', ms: Date.now() - t0, reasoning: 0, out: '', error: String(e.message).slice(0, 100) }; }
}

(async () => {
  const res = await fetch(`${BASE}/models`, { headers });
  if (!res.ok) { console.error(`GET /models -> ${res.status}. Set NINEROUTER_API_KEY if your gateway needs a key.`); process.exitCode = 2; return; }
  const rows = (await res.json()).data ?? [];
  let targets;
  if (only) { targets = rows.filter((m) => only.includes(m.id)); }
  else {
    const byFmt = new Map();
    for (const m of rows) {
      const c = m.capabilities ?? {};
      if (!c.reasoning || hasTier(m.id) || m.owned_by === 'combo') { continue; }
      const list = byFmt.get(c.thinkingFormat) ?? []; list.push(m); byFmt.set(c.thinkingFormat, list);
    }
    targets = [...byFmt.values()].map((l) => l.find((m) => cheap.test(m.id)) ?? l[0]);
  }
  if (!targets.length) { console.error('No matching models.'); process.exitCode = 2; return; }
  const summary = [];
  for (const m of targets) {
    const c = m.capabilities ?? {};
    const levels = Array.isArray(c.thinkingRange) ? c.thinkingRange : [];
    console.log(`\n## ${m.id}  format=${c.thinkingFormat}  advertised=${JSON.stringify(levels)}  canDisable=${c.thinkingCanDisable}`);
    const base = await call(m.id, null);
    console.log(`  baseline   ${base.status} ${base.ms}ms reasoning=${base.reasoning} out="${base.out}" ${base.error}`);
    if (base.status === 401) { console.error('  -> 401: set NINEROUTER_API_KEY'); process.exitCode = 3; return; }
    if (base.status !== 200) { summary.push([m.id, 'baseline-failed']); continue; }
    let bad = 0;
    for (const lv of [...levels, ...(control ? ['bogus'] : [])]) {
      const r = await call(m.id, lv);
      const ok = r.status === 200;
      if (!ok && lv !== 'bogus') { bad++; }
      console.log(`  ${lv.padEnd(9)}  ${r.status} ${r.ms}ms reasoning=${r.reasoning} out="${r.out}" ${r.error}${lv === 'bogus' ? (ok ? '   (gateway does not validate levels)' : '   (gateway validates levels)') : ''}`);
    }
    summary.push([m.id, bad === 0 ? `all ${levels.length} advertised levels OK` : `${bad} advertised level(s) REJECTED`]);
  }
  console.log('\n== summary =='); for (const [id, s] of summary) { console.log(`${id}: ${s}`); }
})();
