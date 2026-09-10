/*
 * F34 - MD-knappens OMFANG: hele noten, ikke kun sektionen.
 *
 * »Mulighed for at lave hele noten til Markdown og ikke kun sektionen naar MD
 * knappen benyttes« (Andreas, 2026-09-10).
 *
 * Selve fladen er DOM og kan ikke proeves her. Det, der KAN, er de to ting,
 * der afgoer, om knapperne opfoerer sig, som de ser ud til:
 *
 *   1. SKIFTENE - to knapper, to spoergsmaal, og MD som vejen HELT ud.
 *   2. MARKOEREN - man skal lande i det afsnit, man stod i, ikke i toppen.
 *
 * Og saa formreglerne paa kilden: de faa greb, der fejler tavst.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import md from '../app/shared/markdown.js';

const p4 = readFileSync(new URL('../app/parts/p4_editor.js', import.meta.url), 'utf8');

/** En funktion hentet UD af kilden - ikke skrevet af. */
function hent(navn, ...arg) {
  const i = p4.indexOf(`function ${navn}(`);
  assert.ok(i > -1, `${navn} findes ikke laengere`);
  // eslint-disable-next-line no-new-func
  return new Function(...arg, `${p4.slice(i, p4.indexOf('\n}\n', i) + 2)}\nreturn ${navn};`)(
    ...arg.map(() => md));
}

const naesteVisning = hent('naesteVisning');
const blokVedMarkoer = hent('blokVedMarkoer', 'saguMarkdown');

/* ======================================================= skiftene ======= */

const RIG = { raaBlok: false, raaNote: false };
const BLOK = { raaBlok: true, raaNote: false };
const HEL = { raaBlok: false, raaNote: true };

test('MD paa den formaterede blok giver markdown for DEN blok', () => {
  assert.deepEqual(naesteVisning(RIG, 'md'), BLOK);
});

test('MD igen fører hele vejen ud - ogsaa fra hele noten', () => {
  /*
   * Vejen ud af markdown er ud. Slukkede MD kun omfanget, skulle man trykke
   * to gange for at komme tilbage til det, man saa foer - og den anden gang
   * ville ligne, at den foerste ikke virkede.
   */
  assert.deepEqual(naesteVisning(BLOK, 'md'), RIG);
  assert.deepEqual(naesteVisning(HEL, 'md'), RIG);
});

test('»Whole note« skifter OMFANGET, ikke formen', () => {
  assert.deepEqual(naesteVisning(BLOK, 'helnote'), HEL);
  // Og tilbage igen: man er stadig i markdown, bare paa blokken.
  assert.deepEqual(naesteVisning(HEL, 'helnote'), BLOK);
});

test('de to knapper kan ikke ende i to visninger paa én gang', () => {
  /*
   * `raaBlok` og `raaNote` er to flag, og fire kombinationer. Kun tre er
   * visninger; den fjerde (begge slaaet til) ville vaere »hele noten som
   * markdown, og OGSAA denne blok« - som ikke betyder noget. Ingen vej maa
   * foere derhen, uanset hvor man kommer fra.
   */
  for (const fra of [RIG, BLOK, HEL, { raaBlok: true, raaNote: true }]) {
    for (const knap of ['md', 'helnote']) {
      const til = naesteVisning(fra, knap);
      assert.ok(!(til.raaBlok && til.raaNote),
        `${JSON.stringify(fra)} + ${knap} -> begge slaaet til`);
    }
  }
});

/* ======================================================= markoeren ====== */

const NOTE = ['# Overskrift', '', 'Foerste afsnit.', '', 'Andet afsnit', 'paa to linjer.'].join('\n');
const ved = (tekst) => ({ value: NOTE, selectionStart: NOTE.indexOf(tekst) });

test('markoeren i en blok giver blokkens FOERSTE linje', () => {
  assert.equal(blokVedMarkoer(ved('# Overskrift')), 0);
  assert.equal(blokVedMarkoer(ved('Foerste afsnit')), 2);
  // Midt i en blok paa to linjer: stadig blokkens begyndelse.
  assert.equal(blokVedMarkoer(ved('paa to linjer')), 4);
});

test('markoeren paa en TOM linje giver den linje - ikke toppen', () => {
  /*
   * `blokke()` springer tomme linjer over, saa der er ingen blok at finde.
   * Linjen selv er saa maalet: `tegnMedAabenBlok` tager en tom linje som en
   * tom blok. Faldt vi tilbage til 0 i stedet, ville man lande i toppen af
   * en note paa hundrede afsnit, hver gang markoeren stod i et mellemrum.
   */
  assert.equal(blokVedMarkoer({ value: NOTE, selectionStart: NOTE.indexOf('\n\nFoerste') + 1 }), 1);
});

test('uden et felt gaettes der ikke - den aabne blok bliver staaende', () => {
  // eslint-disable-next-line no-new-func
  const uden = new Function('saguMarkdown', 'editor',
    `${p4.slice(p4.indexOf('function blokVedMarkoer('),
    p4.indexOf('\n}\n', p4.indexOf('function blokVedMarkoer(')) + 2)}\nreturn blokVedMarkoer;`)(
    md, { aabenBlok: 7 });
  assert.equal(uden(null), 7);
  assert.equal(uden({ value: 'noget' }), 7);
});

/* ========================================================= formen ======= */

test('»Whole note« staar KUN i markdown-raekken', () => {
  /*
   * »Hele noten som markdown« giver kun mening, naar man allerede har sagt
   * markdown. I den rige raekke ville den vaere en tredje ting at forstaa -
   * og den raekke har ni knapper i forvejen.
   */
  const i = p4.indexOf('function vaerktoejslinjeHtml(');
  assert.ok(i > -1, 'vaerktoejslinjeHtml findes ikke');
  const krop = p4.slice(i, p4.indexOf('\n}\n', i));
  const [raa, rig] = krop.split('const genvej =');
  assert.match(raa, /helNoteKnapHtml\(\)/, 'markdown-raekken mangler knappen');
  assert.ok(!/helNoteKnapHtml\(\)/.test(rig), 'knappen staar ogsaa i den rige raekke');
});

test('en tabel faar »Whole note« - men ingen MD, for der er ingen vej tilbage', () => {
  /*
   * Porten aabner en tabel og en kodeblok raat, og dér ER markdown den
   * rigtige flade - en MD-knap ville ikke kunne noget. Men omfanget kan den:
   * netop i en tabel er det ofte hele noten, man skal rundt i. Havde raekken
   * vaeret helt vaek, ville en tabel vaere den ene blok, man ikke kunne komme
   * videre fra.
   */
  const i = p4.indexOf('function tegnMedAabenBlok(');
  assert.ok(i > -1, 'tegnMedAabenBlok findes ikke');
  const krop = p4.slice(i, p4.indexOf('\nfunction ', i + 10));
  assert.match(krop, /vaerktoejslinjeHtml\(rigt, rigt \|\| editor\.raaBlok\)/,
    'raekken staar ikke ved en blok, porten aabnede raat');

  const j = p4.indexOf('function vaerktoejslinjeHtml(');
  const rk = p4.slice(j, p4.indexOf('\n}\n', j)).split('const genvej =')[0];
  assert.match(rk, /medMd \? mdKnapHtml\(false\) : ''/, 'MD staar ubetinget - ogsaa hvor den ikke kan noget');
  assert.match(rk, /\}\$\{helNoteKnapHtml\(\)\}/, 'omfanget mangler i raekken');
});

test('hele noten faar kun raekken, naar man selv har trykket sig hertil', () => {
  /*
   * Aabner indstillingen `editWhole` hele noten raat, findes den formaterede
   * visning ikke - og der er ingen vej tilbage at tilbyde. En knap, der ikke
   * kan det, den viser, er vaerre end ingen knap.
   */
  const i = p4.indexOf('function tegnHeleNoten(');
  assert.ok(i > -1, 'tegnHeleNoten findes ikke');
  const krop = p4.slice(i, p4.indexOf('\n\nfunction ', i));
  assert.match(krop, /editor\.raaNote \? vaerktoejslinjeHtml\(false\) : ''/,
    'raekken staar ubetinget - saa lover den en vej tilbage, der ikke findes');
  assert.match(krop, /bindMdKnap\(\)/, 'raekken bliver tegnet, men aldrig bundet');
});

test('heleNoten() lytter baade til knappen og til indstillingen', () => {
  const i = p4.indexOf('function heleNoten(');
  const krop = p4.slice(i, p4.indexOf('\n}\n', i));
  assert.match(krop, /editor\.raaNote/, 'knappen aabner ikke hele noten');
  assert.match(krop, /editWhole/, 'indstillingen blev glemt, da knappen kom til');
});

test('valget doer med blokken - det er et valg for lige nu', () => {
  /*
   * `editWhole` er indstillingen og gaelder hver note, hver dag. Knappen
   * gaelder den note, man staar i - ellers ville et tryk i én note aendre,
   * hvordan den naeste aabner, uden at nogen bad om det.
   */
  const i = p4.indexOf('function lukBlok(');
  assert.match(p4.slice(i, p4.indexOf('\n}\n', i)), /editor\.raaNote = false/,
    'omfanget overlever, at blokken lukkes');
  const j = p4.indexOf('function aabnBlok(');
  assert.match(p4.slice(j, p4.indexOf('\n}\n', j)), /editor\.raaNote = false/,
    'et klik paa en enkelt blok lader hele noten staa aaben');
});
