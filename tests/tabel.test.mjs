/*
 * v122: tabeller redigeres som tabeller.
 *
 * Cellerne skrives tilbage af p18_tabel.js - men den rene del ligger i de
 * delte moduler og proeves her uden en DOM:
 *
 *  1. `\|` er et roer I en celle, ikke en kant - i parseren og i renderen.
 *  2. Editoren skriver et roer som `\|`, et linjeskift som mellemrum.
 *  3. En raekke ud og ind igen giver de samme celler (rundturen).
 *  4. Skillelinjen af justeringen, og kolonnetallet.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const md = require(path.join(ROD, 'app', 'shared', 'markdown.js'));
const red = require(path.join(ROD, 'app', 'shared', 'redigering.js'));

test('\\| er et rør i cellen, ikke en kant', () => {
  const [b] = md.blokke('| a | b\\|c |\n| --- | --- |\n| x |  |');
  assert.equal(b.slags, 'tabel');
  assert.deepEqual(b.hoved, ['a', 'b|c']);
  assert.deepEqual(b.raekker, [['x', '']]);
  assert.match(md.render('| a | b\\|c |\n| --- | --- |\n| x |  |').html, /<th>b\|c<\/th>/);
});

test('en almindelig tabel deles som før', () => {
  const [b] = md.blokke('| Trio | .NET |\n|---|:-:|\n| TE 8.2 | **3.1.4** |');
  assert.deepEqual(b.hoved, ['Trio', '.NET']);
  assert.deepEqual(b.just, ['left', 'center']);
  assert.deepEqual(b.raekker, [['TE 8.2', '**3.1.4**']]);
});

test('editoren skriver rør som \\| og linjeskift som mellemrum', () => {
  assert.equal(red.tabelCelle('a|b||c'), 'a\\|b\\|\\|c');
  assert.equal(red.tabelCelle('en\nto\n\ntre'), 'en to tre');
  assert.equal(red.tabelCelle('  '), '');
  assert.equal(red.tabelRaekke(['a|b', '', '**x**']), '| a\\|b |  | **x** |');
});

test('en række ud og ind igen giver de samme celler', () => {
  const celler = ['a|b', '.NET **8**', '', 'x \\ y'];
  const linje = red.tabelRaekke(celler);
  const [b] = md.blokke(`${linje}\n${red.tabelSkil(celler.map(() => 'left'))}`);
  assert.deepEqual(b.hoved, celler);
});

test('skillelinjen og kolonnetallet', () => {
  assert.equal(red.tabelSkil(['left', 'center', 'right']), '| --- | :-: | --: |');
  assert.equal(red.tabelKolonner('|---|---|---|'), 3);
  assert.equal(red.tabelKolonner('| a\\|b | c |'), 2);
});

test('en HTML-tabel oversættes med \\| i cellerne', () => {
  const ud = red.tilMarkdown('<table><tr><th>a||b</th></tr><tr><td>x</td></tr></table>');
  assert.equal(ud.split('\n')[0], '| a\\|\\|b |');
});
