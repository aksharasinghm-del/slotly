import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderPage } from '../lib/pages.js';

test('lib/pages.js matches views/ (run `npm run build:pages` after editing views)', () => {
  for (const f of fs.readdirSync(new URL('../views/', import.meta.url)).filter((x) => x.endsWith('.html'))) {
    assert.equal(renderPage(f.replace('.html', '')), fs.readFileSync(new URL(`../views/${f}`, import.meta.url), 'utf8'), f);
  }
});
