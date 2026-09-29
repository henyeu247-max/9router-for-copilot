import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import { HealthMonitor, MIN_HEALTH_INTERVAL_SECONDS, classifyHttpStatus, type HealthTarget } from '../healthMonitor';

/** status: HTTP code, undefined = no answer, 'throw' = probe throws. */
const target = (id: string, status: number | undefined | 'throw'): HealthTarget => ({
  id,
  name: id,
  ping: async () => {
    if (status === 'throw') { throw new Error('net'); }
    return status;
  },
});

function make(targets: HealthTarget[], seconds = 30) {
  let changes = 0;
  const timers: Array<{ ms: number; cleared: boolean }> = [];
  const m = new HealthMonitor({
    getTargets: () => targets,
    onChange: () => { changes++; },
    getIntervalSeconds: () => seconds,
    setInterval: (_fn, ms) => { const t = { ms, cleared: false }; timers.push(t); return t; },
    clearInterval: (h) => { (h as { cleared: boolean }).cleared = true; },
  });
  return { m, timers, changes: () => changes };
}

describe('classifyHttpStatus', () => {
  test('maps HTTP statuses to health states', () => {
    assert.equal(classifyHttpStatus(200), 'online');
    assert.equal(classifyHttpStatus(404), 'online');
    assert.equal(classifyHttpStatus(401), 'auth');
    assert.equal(classifyHttpStatus(403), 'auth');
    assert.equal(classifyHttpStatus(429), 'degraded');
    assert.equal(classifyHttpStatus(500), 'degraded');
    assert.equal(classifyHttpStatus(503), 'degraded');
    assert.equal(classifyHttpStatus(undefined), 'offline');
  });
});

describe('HealthMonitor', () => {
  test('starts as checking, then reflects probes; a throwing probe is offline', async () => {
    const { m } = make([target('a', 200), target('b', 'throw')]);
    assert.equal(m.getOverall(), 'checking');
    await m.checkNow();
    assert.equal(m.getState('a'), 'online');
    assert.equal(m.getState('b'), 'offline');
    assert.equal(m.getOverall(), 'online');
  });
  test('401 is an auth problem, 5xx is degraded, not "online"', async () => {
    const a = make([target('a', 401)]);
    await a.m.checkNow();
    assert.equal(a.m.getOverall(), 'auth');
    const d = make([target('a', 502)]);
    await d.m.checkNow();
    assert.equal(d.m.getOverall(), 'degraded');
  });
  test('overall picks the best profile: online > degraded > auth > offline', async () => {
    assert.equal((await (async () => { const h = make([target('a', undefined), target('b', 401), target('c', 500)]); await h.m.checkNow(); return h.m.getOverall(); })()), 'degraded');
    assert.equal((await (async () => { const h = make([target('a', undefined), target('b', 401)]); await h.m.checkNow(); return h.m.getOverall(); })()), 'auth');
    assert.equal((await (async () => { const h = make([target('a', undefined), target('b', undefined)]); await h.m.checkNow(); return h.m.getOverall(); })()), 'offline');
  });
  test('reportRequest flips state immediately and fires onChange once per real change', async () => {
    const { m, changes } = make([target('a', 200)]);
    await m.checkNow();
    const before = changes();
    m.reportRequest('a', true);
    assert.equal(changes(), before);
    m.reportRequest('a', false);
    assert.equal(m.getState('a'), 'offline');
    assert.equal(changes(), before + 1);
  });
  test('interval is clamped to the minimum and restart replaces the timer', () => {
    const { m, timers } = make([], 1);
    m.start();
    assert.equal(timers[0].ms, MIN_HEALTH_INTERVAL_SECONDS * 1000);
    m.restart();
    assert.equal(timers[0].cleared, true);
    assert.equal(timers.length, 2);
  });
  test('forgets removed profiles and stops after dispose', async () => {
    const list = [target('a', 200), target('b', 200)];
    const m = new HealthMonitor({ getTargets: () => list, onChange: () => undefined, getIntervalSeconds: () => 30, setInterval: () => 1, clearInterval: () => undefined });
    await m.checkNow();
    list.pop();
    await m.checkNow();
    assert.equal(m.getState('b'), 'checking');
    m.dispose();
    m.start();
  });
});
