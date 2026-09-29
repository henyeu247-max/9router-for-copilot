import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import { resolveDashboardUrl } from '../../commands/ui';

describe('resolveDashboardUrl', () => {
  test('explicit wins, else server root without /v1', () => {
    assert.equal(resolveDashboardUrl(' http://x:1/dash ', 'http://h:20128/v1'), 'http://x:1/dash');
    assert.equal(resolveDashboardUrl('', 'http://h:20128/v1/'), 'http://h:20128');
  });
});
