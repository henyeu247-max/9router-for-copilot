import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(__dirname, '..');
const read = (p: string): Record<string, string> => JSON.parse(readFileSync(join(root, p), 'utf8'));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== '__tests__') { walk(p, out); }
    } else if (p.endsWith('.ts')) {
      out.push(p);
    }
  }
  return out;
}

/** Every literal passed to vscode.l10n.t(...) / the local `t(...)` alias in src/. */
function sourceStrings(): Set<string> {
  const pat = /(?:l10n\.t|(?<![A-Za-z_.])t)\(\s*(['"])(.*?)(?<!\\)\1/g;
  const out = new Set<string>();
  for (const file of walk(join(root, 'src'))) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(pat)) { out.add(m[2].replace(/\\'/g, "'")); }
  }
  return out;
}

describe('localization', () => {
  test('package.nls.vi.json has exactly the keys of package.nls.json', () => {
    const en = Object.keys(read('package.nls.json')).sort();
    const vi = Object.keys(read('package.nls.vi.json')).sort();
    assert.deepEqual(vi, en);
    for (const v of Object.values(read('package.nls.vi.json'))) { assert.ok(v.trim().length > 0); }
  });

  test('every %placeholder% in package.json exists in package.nls.json', () => {
    const pkg = readFileSync(join(root, 'package.json'), 'utf8');
    const nls = read('package.nls.json');
    const used = [...pkg.matchAll(/"%([^%"]+)%"/g)].map((m) => m[1]);
    assert.ok(used.length > 20);
    assert.deepEqual(used.filter((k) => !(k in nls)), []);
  });

  test('l10n/bundle.l10n.vi.json translates every string used in src/', () => {
    const bundle = read('l10n/bundle.l10n.vi.json');
    const missing = [...sourceStrings()].filter((s) => !(s in bundle));
    assert.deepEqual(missing, []);
  });

  test('Vietnamese keeps the {0} placeholders of the English source', () => {
    const bundle = read('l10n/bundle.l10n.vi.json');
    for (const [en, vi] of Object.entries(bundle)) {
      assert.equal((vi.match(/\{\d+\}/g) ?? []).join(), (en.match(/\{\d+\}/g) ?? []).join(), en);
    }
  });
});
