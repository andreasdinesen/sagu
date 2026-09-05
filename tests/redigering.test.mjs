/*
 * F30 - vejen tilbage: HTML -> markdown.
 *
 * `markdown.render()` gaar den ene vej. `redigering.tilMarkdown()` gaar den
 * anden, og den er forudsaetningen for at kunne skrive i noten, mens den ser
 * ud, som naar man laeser den.
 *
 * ── Den invariant, alt hviler paa ────────────────────────────────────────
 *
 *     tilMarkdown(render(md)) === md
 *
 * Holder den ikke, bliver en note, man bare har KLIKKET i, skrevet om - og
 * det ville staa i versionshistorikken som en rettelse, ingen har lavet.
 * Maalt mod Andreas' 9.233 rigtige afsnit og overskrifter: 99,99 %. Den ene
 * afviger er en overskrift med et mellemrum til sidst, som rendereren
 * trimmer; saadan en blok skal aabnes RAAT i stedet.
 *
 * ── To rigtige fejl, fundet af rundturen ─────────────────────────────────
 *
 * Rundturen sammenlignede hrefs med kilden og fandt to fejl, der ramte
 * noterne i drift - ikke bare oversaettelsen. De har hver sin proeve
 * nederst, og de er de vigtigste i filen.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import md from '../app/shared/markdown.js';
import R from '../app/shared/redigering.js';

/** Vaertens kroge, praecis som appen saetter dem. */
const HOOK = { billedUrl: (u) => (u.startsWith('sagu:') ? `/api/v1/files/${u.slice(5)}` : null) };

const rundtur = (kilde, opt) => R.tilMarkdown(md.render(kilde, opt || HOOK).html.trim());

/* ==================================================== rundturen ========= */

const KORPUS = [
  'helt almindelig tekst',
  '**fed** og *kursiv* midt i en linje',
  '__fed med understreg__ og _kursiv med understreg_',
  'begge slags: **fed** og __fed__ og *kursiv* og _kursiv_',
  'en `kodestump` og en `anden`',
  '~~gennemstreget~~',
  'et [link](https://example.com) i en linje',
  'en bar adresse https://example.com midt i',
  'en adresse med query https://a.dk/?x=1&y=2 og mere',
  '[navngivet](https://a.dk/?x=1&y=2)',
  '[](https://a.dk/tom-tekst)',
  '[a.dk](https://a.dk)',
  '![alt tekst](sagu:0123456789abcdef0123456789abcdef)',
  '![](https://cdn.example.com/uden-alt.png)',
  '![med alt](https://cdn.example.com/x.png)',
  'en [[anden note]] i teksten',
  '## En overskrift',
  '#### Fjerde niveau',
  'linje et\nlinje to\nlinje tre',
  'tegn der undslippes: < > & og et " citat',
  'stjerne uden makker * og understreg _ alene',
  'https://x.com/v3/__https://y.dk/a__hale',
  'blandet **fed** `kode` [link](https://a.dk) og https://b.dk til sidst',
];

test('rundturen er EKSAKT for hver konstruktion, appen kan rendere', () => {
  const fejl = [];
  for (const kilde of KORPUS) {
    const ud = rundtur(kilde);
    if (ud !== kilde) fejl.push(`  ${JSON.stringify(kilde)}\n  -> ${JSON.stringify(ud)}`);
  }
  assert.deepEqual(fejl, [], `rundturen aendrede teksten:\n${fejl.join('\n')}`);
});

test('de tre spor staar i HTML-en - uden dem maa oversaettelsen gaette', () => {
  /*
   * Sporene er hele grunden til, at rundturen kan vaere eksakt. Uden dem er
   * `[a.dk](https://a.dk)` og en bar `https://a.dk` det samme `<a>`, og
   * `_kursiv_` og `*kursiv*` det samme `<em>`. Gaettet var forkert 240 gange
   * i det rigtige arkiv.
   */
  assert.match(md.render('https://a.dk').html, /data-auto="1"/);
  assert.match(md.render('_kursiv_').html, /<em data-md="_">/);
  assert.match(md.render('__fed__').html, /<strong data-md="_">/);
  assert.match(md.render('[](https://a.dk)').html, /data-tom="1"/);
  // Med vaertens krog (som i appen) afvises et FREMMED billede af CSP'en, og
  // rendereren viser et link i stedet. Uden krogen hentes det som et rigtigt
  // <img> - to forskellige grene, og det er den foerste, sporet hoerer til.
  assert.match(md.render('![](https://cdn.dk/x.png)', HOOK).html, /data-billede="1"/);
  assert.match(md.render('![a](sagu:0123456789abcdef0123456789abcdef)', HOOK).html,
    /data-md="sagu:0123456789abcdef0123456789abcdef"/);

  // ... og de maa IKKE staa der, naar de ikke gaelder.
  assert.doesNotMatch(md.render('*kursiv*').html, /data-md/);
  assert.doesNotMatch(md.render('[navn](https://a.dk)').html, /data-auto|data-tom/);
});

/* ================================ to rigtige fejl, fundet af rundturen == */

test('& i en adresse undslippes ÉN gang - ikke to', () => {
  /*
   * DEN vigtigste proeve i filen, for den handler om drift og ikke om
   * oversaettelse.
   *
   * `inline()` escaper hele teksten FOERST, saa en adresse, en regel fanger,
   * baerer allerede `&amp;`. Et `attr()` ovenpaa gjorde den til `&amp;amp;`,
   * browseren afkodede ét lag, og linket pegede paa `?x=1&amp;y=2`. Hver
   * eneste adresse med mere end én parameter var i stykker - YouTube med
   * `&t=`, Amazon, alt med en query.
   */
  for (const kilde of ['https://a.dk/?x=1&y=2', '[navn](https://a.dk/?x=1&y=2)']) {
    const html = md.render(kilde).html;
    assert.doesNotMatch(html, /&amp;amp;/, `${kilde} er dobbelt-undsluppet`);
    const href = html.match(/href="([^"]+)"/)[1];
    assert.equal(R.afkod(href), 'https://a.dk/?x=1&y=2',
      'browseren ville lande et andet sted, end der staar i noten');
  }
});

test('en adresse med __ i faar ikke injiceret et tag', () => {
  /*
   * Fremhaevnings-reglerne koerte hen over HELE strengen - ogsaa inde i de
   * tags, de tidligere regler lige havde udsendt. Et sporingslink
   * `.../v3/__https://...` fik et `<strong>` midt i sit href, og linket var i
   * stykker. Et faerdigt tag laegges derfor til side bag en pladsholder,
   * praecis som kodestumper altid har vaeret.
   */
  const html = md.render('https://x.com/v3/__https://y.dk/a__hale').html;
  const href = html.match(/href="([^"]+)"/)[1];
  assert.doesNotMatch(href, /<|strong|data-md/, `href blev forurenet: ${href}`);
  assert.match(href, /^https:\/\/x\.com\/v3\/__https/);
});

test('et tag, en tidligere regel har udsendt, roeres ikke af de senere', () => {
  // Den generelle udgave af proeven ovenfor: titler og klasser maa heller
  // ikke kunne rammes af eftertryk eller kode-reglen.
  for (const kilde of ['[[en _note_ med tegn]]', '![et *alt*](https://cdn.dk/x.png)']) {
    const html = md.render(kilde).html;
    assert.doesNotMatch(html.replace(/>[^<]*</g, '><'), /<(em|strong|code)[^>]*>[^<]*<\/(em|strong|code)>/,
      `${kilde}: en senere regel kom ind i et faerdigt tag`);
  }
});

/* ==================================================== laeseren ========== */

test('et ukendt tag koster sin formatering - aldrig sine ord', () => {
  /*
   * Det er reglen, der goer indsaet-rensningen sikker: kopierer man fra Word
   * eller en browser, kommer der `<span style>`, `<font>` og `<div>` ind.
   * De maa gerne miste deres udseende. Teksten maa ikke forsvinde.
   */
  assert.equal(R.tilMarkdown('<div><span style="color:red">vigtig</span> tekst</div>'),
    'vigtig tekst');
  assert.equal(R.tilMarkdown('<font face="x">a</font><b>b</b>'), 'a**b**');
});

test('ubalanceret HTML kaster ikke - en note er ikke velformet undervejs', () => {
  for (const daarlig of ['<p>uafsluttet', '</em>uden start', '<a href="x">a', '<<>>']) {
    assert.doesNotThrow(() => R.tilMarkdown(daarlig), `kastede paa ${daarlig}`);
  }
  assert.equal(R.tilMarkdown('<p>uafsluttet'), 'uafsluttet');
  assert.equal(R.tilMarkdown('</em>tekst'), 'tekst');
});

test('entiteter afkodes - ellers vokser teksten for hver rundtur', () => {
  assert.equal(R.tilMarkdown('a &amp; b &lt; c &gt; d &quot;e&quot; &#39;f&#39;'),
    'a & b < c > d "e" \'f\'');
  // En entitet, vi ikke kender, bliver staaende frem for at blive aedt.
  assert.equal(R.tilMarkdown('&ukendt; her'), '&ukendt; her');
});

test('billedets data-md vinder over src - ellers taber noten sin vedhaeftning', () => {
  assert.equal(
    R.tilMarkdown('<img src="/api/v1/files/abc" data-md="sagu:abc" alt="x">'),
    '![x](sagu:abc)');
});

test('<br> bliver til et linjeskift, ikke til ingenting', () => {
  assert.equal(R.tilMarkdown('<p>et<br>to</p>'), 'et\nto');
});
