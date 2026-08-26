/*
 * Kopiknappen paa `inline kode`.
 *
 * »Jeg vil gerne have en copi knap ved `inline code` som ved Code block«
 * (Andreas, 2026-08-25).
 *
 * Selve knappen er DOM og kan ikke proeves her. Det, der KAN proeves, er den
 * kontrakt, den hviler paa: at rendereren skelner de to slags kode, saa
 * `kode.closest('pre')` faktisk skiller dem. Holdt den skelnen op, ville
 * kodeblokken faa TO knapper - én i toppen og én inde i koden - og ingen af
 * proeverne i browseren ville sige fra.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import markdown from '../app/shared/markdown.js';

const kilde = readFileSync(new URL('../app/parts/p6_blokke.js', import.meta.url), 'utf8');

test('inline kode bliver et bart <code> — uden <pre> omkring', () => {
  const html = markdown.render('Brug `licdump.php` her.').html;
  assert.match(html, /<code>licdump\.php<\/code>/);
  assert.ok(!/<pre/.test(html), 'inline kode maa ikke pakkes i pre');
});

test('en kodeblok bliver <pre><code> — det er dét, der holder de to adskilt', () => {
  const html = markdown.render('```js\nconst x = 1;\n```').html;
  assert.match(html, /<pre><code class="language-js">/);
});

test('fladen skiller dem paa netop <pre>', () => {
  assert.match(kilde, /kode\.closest\('pre'\)/,
    'pynten skal springe kodeblokkens egen <code> over');
});

test('knappen stopper klikket — ellers aabner den blokken bagved', () => {
  const i = kilde.indexOf('function pyntInlineKode');
  const krop = kilde.slice(i, kilde.indexOf('\nfunction pyntKodeblokke', i));
  assert.match(krop, /e\.stopPropagation\(\)/);
});

test('det er KNAPPEN der kopierer, ikke selve koden', () => {
  /*
   * Den vigtigste af dem. Laa kopieringen paa `<code>` selv, ville et afsnit,
   * der KUN bestaar af en kodestump, ikke kunne aabnes med et klik - og saa
   * havde man byttet en kopiknap for en note, man ikke kan rette.
   */
  const i = kilde.indexOf('function pyntInlineKode');
  const krop = kilde.slice(i, kilde.indexOf('\nfunction pyntKodeblokke', i));
  assert.match(krop, /knap\.addEventListener\('click'/);
  assert.ok(!/kode\.addEventListener\('click'/.test(krop),
    'koden selv maa ikke tage klikket');
});

test('kodestumper med tegn, der skal escapes, kopieres som de STAAR', () => {
  const html = markdown.render('Se `a < b && c` her.').html;
  assert.match(html, /<code>a &lt; b &amp;&amp; c<\/code>/);
  // `textContent` giver den raa tekst tilbage - det er dét, knappen kopierer.
});
