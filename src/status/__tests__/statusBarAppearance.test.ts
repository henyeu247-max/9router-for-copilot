import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { statusBarAppearance } from '../statusBarAppearance';
import type { HealthStatus } from '../healthMonitor';

describe('statusBarAppearance', () => {
  test('online is green (foreground), no background', () => {
    const a = statusBarAppearance('online', false);
    assert.equal(a.color, 'testing.iconPassed');
    assert.equal(a.background, undefined);
  });
  test('auth and degraded are yellow (warning background)', () => {
    for (const s of ['auth', 'degraded'] as HealthStatus[]) {
      assert.equal(statusBarAppearance(s, false).background, 'statusBarItem.warningBackground', s);
    }
  });
  test('offline is red (error background)', () => {
    assert.equal(statusBarAppearance('offline', false).background, 'statusBarItem.errorBackground');
  });
  test('checking and busy spin, with no colour', () => {
    for (const a of [statusBarAppearance('checking', false), statusBarAppearance('offline', true)]) {
      assert.equal(a.icon, 'sync~spin');
      assert.equal(a.color, undefined);
      assert.equal(a.background, undefined);
    }
  });
  test('only the two backgrounds VS Code allows for status bar items are used', () => {
    const allowed = new Set(['statusBarItem.warningBackground', 'statusBarItem.errorBackground', undefined]);
    for (const s of ['online', 'auth', 'degraded', 'offline', 'checking'] as HealthStatus[]) {
      assert.ok(allowed.has(statusBarAppearance(s, false).background), s);
    }
  });
});
