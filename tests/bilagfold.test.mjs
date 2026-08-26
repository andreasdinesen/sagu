/*
 * De tre foldbare bilag under en note: vedhaeftninger, opgaver i doda,
 * kommentarer.
 *
 * Foldningen er DOM og kan ikke proeves her. Det, der KAN proeves, er den
 * mekanik, de tre deler - og dét er netop pointen med at have ÉN:
 *
 *   »to maader at folde paa i samme app er to steder at rette naeste gang,
 *    en af dem skal aendres« (RUNE-ERFARINGER, tovo v11)
 *
 * De to fejl, proeverne staar vagt om, ville begge vaere tavse i browseren:
 * et afsnit, der glemmer at binde sig og derfor klapper i, hver gang det
 * tegnes om - og to afsnit, der deler noegle og derfor folder hinanden.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const laes = (navn) => readFileSync(new URL(`../app/parts/${navn}`, import.meta.url), 'utf8');
const editor = laes('p4_editor.js');
const blokke = laes('p6_blokke.js');
const kommentar = laes('p8_kommentar.js');
const alt = editor + blokke + kommentar;

const NOEGLER = ['BILAG_FILER', 'BILAG_DODA', 'BILAG_KOM'];

test('de tre noegler er DEFINERET — én gang hver', () => {
  for (const n of NOEGLER) {
    const fund = editor.match(new RegExp(`const ${n} = '([^']+)'`, 'g')) || [];
    assert.equal(fund.length, 1, `${n} skal staa ét sted`);
  }
});

test('… og de er FORSKELLIGE — ellers folder to afsnit hinanden', () => {
  const vaerdier = NOEGLER.map((n) => editor.match(new RegExp(`const ${n} = '([^']+)'`))[1]);
  assert.equal(new Set(vaerdier).size, 3, `to noegler er ens: ${vaerdier.join(', ')}`);
});

test('alle tre afsnit BINDER sig — ellers klapper de i ved hver optegning', () => {
  /*
   * Den her er den vigtigste. Alle tre tegnes om UNDER brug - en ny
   * kommentar, et flueben i doda, en slettet fil - og uden bindingen ville
   * afsnittet folde sig sammen, hver gang man roerte det.
   */
  // Linje for linje, ikke ét moenster: argumentet kan selv indeholde en
  // parentes (`document.querySelector('.filer')`), og et `[^)]*` stopper dér.
  // Foerste udgave af den her proeve gjorde netop det og paastod, at koden
  // ikke bandt sig - den var forkert, ikke koden.
  const linjer = alt.split('\n').filter((l) => l.includes('bindBilagsfold('));
  for (const n of NOEGLER) {
    assert.ok(linjer.some((l) => l.includes(n)), `${n} bliver aldrig bundet`);
  }
});

test('alle tre laeser deres tilstand med bilagAabent', () => {
  for (const n of NOEGLER) {
    assert.ok(new RegExp(`bilagAabent\\(${n}\\)`).test(alt), `${n} tegnes uden sin tilstand`);
  }
});

test('foldningen bor i det SAMME saet som notesboegerne', () => {
  const i = editor.indexOf('function bilagAabent');
  const krop = editor.slice(i, editor.indexOf('\n}', i));
  assert.match(krop, /editor\.foldede/,
    'et eget saet ville vaere en anden mekanik at rette to steder');
});

test('valget gemmes — ellers overlever det ikke en genindlaesning', () => {
  const i = editor.indexOf('function bindBilagsfold');
  const krop = editor.slice(i, editor.indexOf('\n}', editor.indexOf('gemFoldede()', i)));
  assert.match(krop, /gemFoldede\(\)/);
});
