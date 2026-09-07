/*
 * F33 - vaerktoejslinjen fik to knapper:
 *
 *   »Kan du tilfoeje checklist til skrive menuen foer Date?«
 *   »kan du efter Now tilfoeje en knap som skifter visningen til markdown,
 *    saa man fx kan rette overskriften i et URL link«
 *                                             (Andreas, 2026-09-07)
 *
 * Selve raekken er DOM og kan ikke trykkes paa her. Det, der KAN proeves, er
 * de to ting, der baerer den: omskrivningen til tjekliste (ren tekst ind, ren
 * tekst ud) og de faa formregler paa kilden, som fejler TAVST, naar nogen
 * fjerner dem - raekkefoelgen i linjen, og at de to felters blur-vagt er ÉN.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import R from '../app/shared/redigering.js';

const p4 = readFileSync(new URL('../app/parts/p4_editor.js', import.meta.url), 'utf8');

/** `skiftTjekliste` hentet UD af kilden med falske naboer. */
function hentSkift() {
  const tag = (navn) => {
    const i = p4.indexOf(`function ${navn}(`);
    assert.ok(i > -1, `${navn} findes ikke laengere`);
    return p4.slice(i, p4.indexOf('\n}', i) + 2);
  };
  const linje = (m) => {
    const t = p4.match(m);
    assert.ok(t, `${m} findes ikke laengere`);
    return t[0];
  };
  // eslint-disable-next-line no-new-func
  return new Function('editor', 'gemRigBlok', 'skrivBlokTilbage', 'tegnKrop', `
    ${linje(/^const TJEK_LINJE = .*$/m)}
    ${linje(/^const BLOKMAERKE = .*$/m)}
    ${tag('skiftTjekliste')}
    return skiftTjekliste;`);
}

const byg = hentSkift();

/** Kalder knappen paa en blok, der fylder HELE noten, og giver markdownen ud. */
function skift(kilde) {
  const editor = { note: { body: kilde } };
  const b = { fra: 0, til: kilde.split('\n').length - 1 };
  const skrivBlokTilbage = (ny, blok) => {
    const linjer = editor.note.body.split('\n');
    const nye = ny.split('\n');
    linjer.splice(blok.fra, blok.til - blok.fra + 1, ...nye);
    editor.note.body = linjer.join('\n');
    blok.til = blok.fra + nye.length - 1;
  };
  byg(editor, () => {}, skrivBlokTilbage, () => {})(null, b);
  return editor.note.body;
}

/* ================================================== tjeklisten ========== */

test('et afsnit bliver til et tjekpunkt - og tilbage igen', () => {
  assert.equal(skift('koeb kaffe'), '- [ ] koeb kaffe');
  assert.equal(skift('- [ ] koeb kaffe'), 'koeb kaffe');
});

test('hver linje bliver sit eget punkt', () => {
  assert.equal(skift('en\nto\ntre'), '- [ ] en\n- [ ] to\n- [ ] tre');
});

test('en liste, der ALLEREDE er en liste, faar boksen - ikke et bullet mere', () => {
  assert.equal(skift('- en\n- to'), '- [ ] en\n- [ ] to');
  assert.equal(skift('1. en\n2. to'), '- [ ] en\n- [ ] to');
});

test('et maerke, der ikke betyder noget i et punkt, laegges fra sig', () => {
  /*
   * »## Onsdag« inde i et listepunkt er ikke en overskrift - det er to
   * synlige havelaager. Det samme gaelder citattegnet.
   */
  assert.equal(skift('## Onsdag'), '- [ ] Onsdag');
  assert.equal(skift('> sagt af en anden'), '- [ ] sagt af en anden');
});

test('et afkrydset punkt slaas ogsaa fra - begge tilstande er en tjekliste', () => {
  assert.equal(skift('- [x] gjort\n- [ ] ikke endnu'), 'gjort\nikke endnu');
});

test('er kun NOGLE af linjerne punkter, bliver resten det ogsaa', () => {
  // Halvt om halvt er ikke »en tjekliste«, saa knappen goer den til én.
  assert.equal(skift('- [ ] en\nto'), '- [ ] en\n- [ ] to');
});

test('indrykningen bliver staaende - en underliste bliver ikke rettet ud', () => {
  assert.equal(skift('- en\n  - under'), '- [ ] en\n  - [ ] under');
});

test('en tom linje bliver ikke til et tomt punkt', () => {
  assert.equal(skift('en\n\nto'), '- [ ] en\n\n- [ ] to');
});

test('#tag er ikke en overskrift og maa ikke miste sit tegn', () => {
  // Overskriften kraever et mellemrum efter havelaagen; et tag har ingen.
  assert.equal(skift('#kaffe skal koebes'), '- [ ] #kaffe skal koebes');
});

/* ====================================================== formen ========== */

test('tjeklisteknappen staar FOER Date', () => {
  const i = p4.indexOf('function vaerktoejslinjeHtml(');
  assert.ok(i > -1, 'vaerktoejslinjeHtml findes ikke');
  const krop = p4.slice(i, p4.indexOf('\n}\n', i));
  const tjek = krop.indexOf('data-blokform="tjekliste"');
  const dato = krop.indexOf('DATOKNAPPER.map');
  assert.ok(tjek > -1, 'tjeklisteknappen findes ikke i raekken');
  assert.ok(dato > -1, 'datoknapperne findes ikke i raekken');
  assert.ok(tjek < dato, 'tjeklisteknappen skal staa foer Date');
});

test('MD-knappen staar EFTER Now', () => {
  const i = p4.indexOf('function vaerktoejslinjeHtml(');
  const krop = p4.slice(i, p4.indexOf('\n}\n', i));
  const dato = krop.indexOf('DATOKNAPPER.map');
  const md = krop.indexOf('mdKnapHtml(true)');
  assert.ok(md > -1, 'MD-knappen findes ikke i raekken');
  assert.ok(dato < md, 'MD-knappen skal staa efter Now');
});

test('i markdown er MD den eneste knap i raekken', () => {
  /*
   * B, I og U kan ingenting i et `<textarea>`. En knap, der ikke kan det,
   * den viser, er vaerre end ingen knap.
   */
  const i = p4.indexOf('function vaerktoejslinjeHtml(');
  const krop = p4.slice(i, p4.indexOf('\n}\n', i));
  assert.match(krop, /if \(!rigt\) return [\s\S]{0,120}mdKnapHtml\(false\)/,
    'den raa raekke er ikke kun MD-knappen');
});

test('porten spoerger OGSAA, om man selv har bedt om markdown', () => {
  assert.match(p4, /const rigt = !editor\.raaBlok && kanRedigereRigt\(raa, b\)/,
    'MD-knappen kan trykkes ned uden at blokken skifter');
});

test('valget om markdown gaelder kun DEN blok, man staar i', () => {
  const i = p4.indexOf('function aabnBlok(');
  const krop = p4.slice(i, p4.indexOf('\n}\n', i));
  assert.match(krop, /if \(fra !== editor\.aabenBlok\) editor\.raaBlok = false/,
    'et tryk paa MD ville goere resten af noten raa');
  const j = p4.indexOf('function lukBlok(');
  assert.match(p4.slice(j, p4.indexOf('\n}\n', j)), /editor\.raaBlok = false/,
    'valget overlever, at blokken lukkes');
});

test('BEGGE felters blur-vagt er den samme ene funktion', () => {
  /*
   * Den her proeve er selve fejlen skrevet ned. Reglen »er fokus stadig inde
   * i blokken?« stod to steder, og hver af dem kendte kun sit eget felt - saa
   * MD-knappen LUKKEDE blokken i stedet for at skifte visning, fordi den
   * rige blok regnede `blokFelt` for »uden for noten«.
   */
  const vagt = p4.indexOf('function fokusErIBlokken(');
  assert.ok(vagt > -1, 'fokusErIBlokken findes ikke');
  const krop = p4.slice(vagt, p4.indexOf('\n}\n', vagt));
  assert.match(krop, /blokRigt/, 'vagten kender ikke det rige felt');
  assert.match(krop, /blokFelt/, 'vagten kender ikke det raa felt');
  assert.match(krop, /blokVaerktoej/, 'vagten kender ikke vaerktoejslinjen');

  // Og ingen af de to blur-handlere maa have sin egen liste igen.
  const kald = p4.match(/if \(fokusErIBlokken\(\)\) return;/g) || [];
  assert.equal(kald.length, 2, 'begge felter skal spoerge den samme vagt');
  assert.ok(!/aktiv\.id === 'blok(Rigt|Felt)' \|\| aktiv\.closest/.test(p4),
    'et felt har faaet sin egen vagt tilbage');
});

/* ================================================== indsaettet ========== */

/** `indsatMarkdown` hentet UD af kilden, med den rigtige oversaetter. */
function hentIndsat() {
  const i = p4.indexOf('function indsatMarkdown(');
  assert.ok(i > -1, 'indsatMarkdown findes ikke laengere');
  // eslint-disable-next-line no-new-func
  return new Function('saguRedigering',
    `${p4.slice(i, p4.indexOf('\n}', i) + 2)}\nreturn indsatMarkdown;`)(R);
}

const indsat = hentIndsat();

test('HTML\'en er foerstevalget - den baerer formateringen', () => {
  assert.equal(indsat('<b>fed</b>', 'fed'), '**fed**');
});

test('gav HTML\'en ingenting, redder den bare tekst indsaettet', () => {
  /*
   * Vaernet mod den NAESTE form, ingen har set endnu. Udklipsholderens HTML
   * kommer fra fremmede programmer, og et tomt indsaet er det vaerste af de
   * to udfald: teksten er vaek, og der staar ingen fejl nogen steder.
   */
  assert.equal(indsat('<ukendt-form></ukendt-form>', 'ordene'), 'ordene');
  assert.equal(indsat('   ', 'ordene'), 'ordene');
});

test('er der hverken HTML eller tekst, indsaettes ingenting', () => {
  assert.equal(indsat('', ''), '');
  assert.equal(indsat(undefined, undefined), '');
});
