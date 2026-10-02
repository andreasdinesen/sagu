/*
 * »Download« i boblerne og i bilagslisterne (v95).
 *
 * Fladen kan ikke importeres; testen vogter, at knapperne findes, og at de
 * kun tilbydes for Sagus egne filer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const del = (f) => readFileSync(new URL(`../app/parts/${f}`, import.meta.url), 'utf8');
const p16 = del('p16_dokument.js');
const p6 = del('p6_blokke.js');
const p2 = del('p2_pages.js');

test('link-boblen og billed-boblen har Download', () => {
  assert.match(p16, /data-lb="hent">Download</);
  assert.match(p16, /data-bb="hent">Download</);
  assert.match(p16, /hvad === 'hent'\) \{ hentFilNed\(a\.getAttribute\('href'\)\)/);
  assert.match(p16, /hvad === 'hent'\) \{ hentFilNed\(img\.getAttribute\('src'\)\)/);
});

test('kun Sagus egne filer kan hentes - ikke fremmede links eller et billede under upload', () => {
  const i = p16.indexOf('function kanHentes');
  const kode = p16.slice(i, p16.indexOf('\n}\n', i) + 2);
  const kanHentes = vm.runInNewContext(`(${kode.replace('function kanHentes', 'function')})`);
  assert.equal(kanHentes('/api/v1/files/abc'), true);
  assert.equal(kanHentes('https://example.com/x.pdf'), false);
  assert.equal(kanHentes('blob:http://localhost/123'), false);
  assert.equal(kanHentes(null), false);
});

test('bilagslisten i noten og fillisten i Settings har Download', () => {
  assert.match(p6, /class="btn ghost fil-hent" href="\$\{esc\(f\.url\)\}" download/);
  assert.match(p2, /href="\$\{esc\(f\.url\)\}"\s+download>Download<\/a>/);
});

test('en forladt fil viser kun Insert hele tiden - Download og Remove ved hover (v96)', () => {
  const css = readFileSync(new URL('../app/public/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.fil-forladt \.fil-ind \{ opacity: 1; \}/);
  assert.ok(!/\.fil-forladt \.btn \{ opacity: 1/.test(css), 'alle tre knapper maa ikke staa fremme');
  // Insert-knappen skal stadig have klassen, reglen haenger paa.
  assert.match(p6, /class="btn ghost fil-ind" data-filind=/);
});
