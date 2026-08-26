/*
 * Noten som PDF (F25).
 *
 * »Kan du lave en funktion saa man kan lave en pdf af en sagu note. den skal
 * ligge under ... menuen« (Andreas, 2026-08-25).
 *
 * ── Hvad proeverne kan og ikke kan ────────────────────────────────────────
 *
 * Selve udskriften er browserens, og en printerdialog kan ikke aabnes i en
 * test. Det, der KAN maales, er reglerne - og det er ogsaa dér, fejlene
 * sidder: et print-ark, der arver appens moerke tema, er sort paa sort, og
 * det ser man foerst, naar papiret er ude.
 *
 * Reglen, alle proeverne haenger paa, staar i RUNE-ERFARINGER §4:
 *
 *     print-HTML maa ALDRIG bruge var(--…)-farver
 *
 * Den var kun skrevet for `body` og `.card`, og derfor kom tabellens hoved ud
 * som rgb(40,35,32) paa rgb(17,17,17) - en overskriftsraekke, ingen kan laese.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../app/public/style.css', import.meta.url), 'utf8');
const editor = readFileSync(new URL('../app/parts/p4_editor.js', import.meta.url), 'utf8');

/** Alle @media print-blokke, samlet. */
function printRegler() {
  const ud = [];
  const re = /@media print\s*\{/g;
  let m;
  while ((m = re.exec(css))) {
    let dybde = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < css.length && dybde > 0) {
      if (css[i] === '{') dybde += 1;
      if (css[i] === '}') dybde -= 1;
      i += 1;
    }
    ud.push(css.slice(start, i - 1));
  }
  return ud.join('\n');
}

const print = printRegler();

test('der ER et print-ark at maale paa', () => {
  assert.ok(print.length > 500, 'fandt ingen @media print-regler');
});

test('INGEN var(--…)-farve i print — den fælde, huset allerede har skrevet ned', () => {
  /*
   * Den vigtigste af dem alle. En temavariabel i et print-ark er en farve,
   * der ser rigtig ud paa skaermen og forsvinder paa papir - eller bliver
   * sort paa sort. Fejlen er tavs begge veje.
   */
  const linjer = print.split('\n')
    .filter((l) => /var\(--/.test(l) && !/^\s*(\/\*|\*)/.test(l));
  assert.deepEqual(linjer, [], `print-regler med temafarver:\n${linjer.join('\n')}`);
});

test('betjeningen printer ikke — kun indholdet', () => {
  for (const klasse of ['.note-tools', '.blok-greb', '.inlinekode-kopi',
    '.filer', '.dodaopgaver', '.kommentarer', '.topbar', '.sidebar']) {
    assert.ok(print.includes(klasse), `${klasse} staar ikke i print-arket`);
  }
});

test('titlen er et <input> og skal AFKLAEDES — ellers printer den som en formular', () => {
  const i = print.indexOf('.note-title');
  assert.ok(i > -1, '.note-title mangler i print-arket');
  const blok = print.slice(i, print.indexOf('}', i));
  assert.match(blok, /border:\s*0/);
  assert.match(blok, /background:\s*none/);
});

test('fluebenet faar et TEGN — en tom knap printer som ingenting', () => {
  // Samme faelde som ved kopiering til Apple Notes (v36): den uafkrydsede
  // knap er tom, saa uden det her ville en tjekliste tabe sin tilstand.
  assert.match(print, /\.tjek-boks::before\s*\{[^}]*content:\s*"\\2610"/);
  assert.match(print, /aria-checked="true"\]::before\s*\{[^}]*content:\s*"\\2611"/);
});

test('baggrundsfarver, der SKAL med, beder om det', () => {
  // Browseren dropper baggrunde i print, medmindre man siger fra (§4).
  const i = print.indexOf('.md-tabel thead th');
  const blok = print.slice(i, print.indexOf('}', i));
  assert.match(blok, /print-color-adjust:\s*exact/);
});

test('billeder og kodeblokke braekkes ikke over to sider', () => {
  assert.match(print, /break-inside:\s*avoid/);
});

test('menupunktet ligger under »…« og kalder gemSomPdf', () => {
  assert.match(editor, /data-do="pdf"[^]*?Save as PDF/);
  assert.match(editor, /if \(hvad === 'pdf'\) \{ gemSomPdf\(n\); return; \}/);
});

test('den aabne blok lukkes FOER udskriften', () => {
  /*
   * Et `<textarea>` printer som en formular-kasse. Uden lukningen ville man
   * faa en PDF med et hul praecis dér, hvor man sidst havde markoeren.
   *
   * KOMMENTARERNE STRIPPES FOERST. Foerste udgave af den her proeve gjorde
   * det ikke - og bestod derfor, ogsaa da jeg fjernede selve kaldet:
   * funktionens egen kommentar naevner `lukBlok()`, og `indexOf` fandt DEN.
   * En proeve, der maaler en kommentar, maaler ingenting. Fanget ved at
   * sabotere kaldet og se GROENT.
   */
  const i = editor.indexOf('function gemSomPdf');
  const krop = editor.slice(i, editor.indexOf('\nfunction lukBlok', i))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  const lukket = krop.indexOf('lukBlok()');
  const printet = krop.indexOf('window.print()');
  assert.ok(lukket > -1, 'kaldet til lukBlok() findes ikke i koden');
  assert.ok(printet > -1, 'window.print() findes ikke');
  assert.ok(lukket < printet, 'blokken skal lukkes FOER der printes');
});

test('titlen gendannes — og paa afterprint, saa en fortrudt dialog ogsaa rydder op', () => {
  const i = editor.indexOf('function gemSomPdf');
  const krop = editor.slice(i, editor.indexOf('\nfunction lukBlok', i));
  assert.match(krop, /document\.title = navn/);
  assert.match(krop, /addEventListener\('afterprint'/);
  assert.match(krop, /document\.title = foer/);
});

test('filnavnet renses for det, et filsystem ikke vil have', () => {
  const i = editor.indexOf('function gemSomPdf');
  const krop = editor.slice(i, editor.indexOf('\nfunction lukBlok', i));
  assert.match(krop, /replace\(\/\[/, 'notetitlen kan indeholde / : * ? " < > |');
});
