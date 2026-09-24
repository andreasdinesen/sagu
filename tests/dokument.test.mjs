/*
 * v85: noten som ÉT dokument.
 *
 * Editoren er ét contenteditable, men noten skrives aldrig om i ét hug: et
 * uroert barn giver sin gamle markdown tilbage, og kun de roerte oversaettes.
 * `sammensaet()` er limen - og det er dens loefter, der proeves her, uden en
 * DOM:
 *
 *  1. Uroert giver PRAECIS den note, der stod (sikkerhedsnettet i
 *     `tegnDokument` bygger paa det).
 *  2. En aendret blok aendrer kun sine egne linjer.
 *  3. En ny blok faar én tom linje foran - og en blok, der mister sin nabo,
 *     beholder ikke en afstand, der hoerte til naboen.
 *  4. Pladserne passer, saa `data-blok` kan skrives om uden at gaette.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ROD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const md = require(path.join(ROD, 'app', 'shared', 'markdown.js'));
const red = require(path.join(ROD, 'app', 'shared', 'redigering.js'));

/** Det samme, `tegnDokument` goer: én del pr. blok, med den afstand, der stod. */
function dele(body) {
  const linjer = body.split('\n');
  const b = md.blokke(body);
  const ud = b.map((x, i) => ({
    md: linjer.slice(x.fra, x.til + 1).join('\n'),
    gap: i ? linjer.slice(b[i - 1].til + 1, x.fra) : null,
    foerst: i === 0,
    sidst: i === b.length - 1,
  }));
  const ramme = {
    foran: b.length ? linjer.slice(0, b[0].fra) : [],
    bagved: b.length ? linjer.slice(b[b.length - 1].til + 1) : [],
    tom: b.length ? '' : body,
  };
  return { ud, ramme, blokke: b };
}

const NOTER = [
  '',
  '\n',
  'Én linje',
  'Én linje\n',
  '\n\n# Titel\n\nafsnit\n\n\n\nefter tre tomme\n\n',
  '## Drift\n- punkt\n- [ ] tjek\n- [x] gjort\n\n> [!NOTE]\n> husk\n\n```sh\nls -la\n\n\necho hej\n```\n| a | b |\n|---|--:|\n| 1 | 2 |\n\n---\ntekst lige efter',
  'linje et\r\nlinje to\r\n\r\nnyt afsnit\r\n',
  '   \n  indrykket afsnit\n\n1. et\n2. to\n   3. under\n',
];

test('uroert giver PRAECIS den note, der stod', () => {
  for (const body of NOTER) {
    const { ud, ramme } = dele(body);
    assert.equal(red.sammensaet(ud, ramme).body, body, JSON.stringify(body));
  }
});

test('en aendret blok aendrer kun sine egne linjer', () => {
  const body = '# Titel\n\n\nfoerste afsnit\n\nandet afsnit\n\n\n\ntredje\n';
  const { ud, ramme } = dele(body);
  ud[2] = { ...ud[2], md: 'ANDET, rettet\nmed en linje mere' };
  const r = red.sammensaet(ud, ramme).body;
  assert.equal(r, '# Titel\n\n\nfoerste afsnit\n\nANDET, rettet\nmed en linje mere\n\n\n\ntredje\n');
});

test('en ny blok faar én tom linje - og en slettet blok tager sin afstand med', () => {
  const body = 'a\n\n\n\nb\n\nc';
  const { ud, ramme } = dele(body);
  // Ny blok mellem a og b: b har en ny nabo, saa hverken b eller den nye
  // arver a's tre tomme linjer.
  const medNy = [ud[0], { md: 'NY', gap: null }, { ...ud[1], gap: null }, ud[2]];
  assert.equal(red.sammensaet(medNy, ramme).body, 'a\n\nNY\n\nb\n\nc');
  // b slettet: c's nabo er nu a.
  const udenB = [ud[0], { ...ud[2], gap: null }];
  assert.equal(red.sammensaet(udenB, ramme).body, 'a\n\nc');
});

test('alt slettet giver en tom note - og en tom note forbliver, hvad den var', () => {
  assert.equal(red.sammensaet([], { tom: '' }).body, '');
  assert.equal(red.sammensaet([], { tom: '\n' }).body, '\n');
});

test('pladserne passer paa blokkene i den nye note', () => {
  for (const body of NOTER) {
    const { ud, ramme, blokke } = dele(body);
    const { pladser } = red.sammensaet(ud, ramme);
    assert.deepEqual(pladser.map((p) => [p.fra, p.til]), blokke.map((b) => [b.fra, b.til]),
      JSON.stringify(body));
  }
});

test('en sammensaetning af det sammensatte giver det samme igen', () => {
  // `dokSkriv` skriver pladser og afstande tilbage i hukommelsen. Naeste
  // sammensaetning maa ikke flytte noget - ellers ville noten vandre af at
  // blive skrevet i.
  const body = '# T\n\n\nx\n\ny';
  const { ud, ramme } = dele(body);
  ud[1] = { ...ud[1], md: 'x rettet' };
  const f = red.sammensaet(ud, ramme);
  const igen = ud.map((d, i) => ({ ...d, gap: i ? f.pladser[i].gap : null }));
  assert.equal(red.sammensaet(igen, ramme).body, f.body);
});

/* ------------------------------------------------------- form paa kilden */

const p16 = readFileSync(path.join(ROD, 'app', 'parts', 'p16_dokument.js'), 'utf8');
const p4 = readFileSync(path.join(ROD, 'app', 'parts', 'p4_editor.js'), 'utf8');

test('sikkerhedsnettet staar der: en note, der ikke rundturer, bliver i blok-editoren', () => {
  const i = p16.indexOf('function tegnDokument(');
  const krop = p16.slice(i, p16.indexOf('\n}\n', i));
  assert.match(krop, /proeve\.body !== body/, 'uroert skal sammenlignes med body, foer dokumentet gives fri');
  assert.match(krop, /dok\.afvist = n\.id/);
  assert.ok(krop.indexOf('proeve.body !== body') < krop.indexOf('bindDokument('),
    'nettet skal staa FOER dokumentet bindes');
});

test('en oe roeres aldrig af oversaetteren', () => {
  // Pynten paa en kodeblok (»Copy« -> »Copied«) eller et GitHub-kort, der
  // fyldes, er ikke en aendring af noten.
  const i = p16.indexOf('function dokNoter(');
  const krop = p16.slice(i, p16.indexOf('\n}\n', i));
  assert.match(krop, /if \(dokErOe\(barn\)\) continue;/, 'aendringer inde i en oe er ikke brugerens');
  // ⌘Z saetter en slettet oe tilbage - den maa heller ikke blive roert dér.
  assert.match(krop, /addedNodes\.forEach\(\(x\) => \{ if \(x\.nodeType === 1 && !dokErOe\(x\)\)/);
  // Og i sammensaetningen: en oe giver ALTID sin egen markdown.
  assert.match(p16, /const ren = info && \(!dok\.roert\.has\(barn\) \|\| dokErOe\(barn\)\)/);
});

test('rammen og afstanden laeses af OPTEGNINGEN - saa ⌘Z giver den gamle note', () => {
  // Maalt i browseren: uden `dok.orig` gav ⌘Z efter en sletning over flere
  // blokke en note med én tom linje mere, og »vaelg alt, slet, fortryd«
  // mistede de tomme linjer til sidst.
  assert.match(p16, /else if \(o && o\.forrige && o\.forrige === forrige\) gap = o\.gap;/);
  assert.match(p16, /foerst: !!\(o && o\.foerst\),\s*sidst: !!\(o && o\.sidst\),/);
});

test('tegnKrop proever dokumentet foer blok-editoren - og falder tilbage', () => {
  const i = p4.indexOf('function tegnKrop(');
  const krop = p4.slice(i, p4.indexOf('\n}\n', i));
  assert.ok(krop.indexOf('brugDokument(n)') > -1 && krop.indexOf('brugDokument(n)') < krop.indexOf('saguMarkdown.render('));
});

test('den gamle editor er et valg, ikke vaek', () => {
  assert.match(p16, /p\.classicEditor/);
  const p2 = readFileSync(path.join(ROD, 'app', 'parts', 'p2_pages.js'), 'utf8');
  assert.match(p2, /id="prefKlassisk"/);
});

test('et afsnit med links til NOTER kan skrives tilbage - saa det ikke bliver en oe', () => {
  // Foer v85 gav vejen tilbage `#note-<id>` (appens adresse) og `[tekst](#note-…)`
  // for `[[titel]]`. Porten afviste derfor hvert afsnit med et notelink, og i
  // dokumentet blev de oeer, man ikke kunne skrive i.
  const valg = {
    blokAttribut: true,
    slaaOpNote: (t) => (t === 'Drift' ? { href: '#note-abc' } : null),
    linkUrl: (u) => (/^sagu-note:/.test(u) ? `#note-${u.slice(10)}`
      : (/^sagu:/.test(u) ? `/api/v1/files/${u.slice(5)}` : null)),
  };
  const id = '0123456789abcdef0123456789abcdef';
  for (const s of [
    'Se [[Drift]] og [[Findes ikke]].',
    `Link til [en note](sagu-note:${id}) her.`,
    `Fil [rapport.pdf](sagu:${id}).`,
    '[x](https://a.dk) og https://b.dk.',
  ]) {
    const html = md.render(s, valg).html;
    assert.equal(red.tilMarkdown(html), s, s);
  }
  // Wikien (uden `blokAttribut`) faar IKKE sporet: et udgivet `sagu-note:<id>`
  // er et id, laeseren ikke skal se.
  const wiki = md.render(`[en note](sagu-note:${id})`, { linkUrl: valg.linkUrl }).html;
  assert.doesNotMatch(wiki, /sagu-note:/);
});
