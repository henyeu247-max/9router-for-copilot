import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const pkg = JSON.parse(readFileSync(join(resolve(__dirname, '..'), 'package.json'), 'utf8'));

describe('language model vendor contribution', () => {
  const vendor = pkg.contributes.languageModelChatProviders[0];

  test('declares NO `configuration` schema (otherwise every model is listed twice)', () => {
    // VS Code (checked in the 1.139.1 workbench bundle, languageModels.ts _resolveAllLanguageModels):
    // it resolves a vendor once without a group, then AGAIN for every group in chatLanguageModels.json.
    // The skip `!vendor.configuration && models already resolved` only applies to vendors WITHOUT a
    // configuration schema. VS Code itself creates such a group as soon as the user picks a per-model
    // option (e.g. thinking effort), and our provider returns all profiles' models for each call, so a
    // vendor with a schema shows every model of every profile twice.
    assert.equal(vendor.configuration, undefined);
  });

  test('keeps the management command (profiles are managed by the extension, not by VS Code groups)', () => {
    assert.equal(vendor.managementCommand, '9router-for-github-copilot.manage');
    assert.equal(vendor.vendor, '9router-github-copilot');
  });
});
