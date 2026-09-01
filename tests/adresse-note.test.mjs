/*
 * Adressen skal sige, hvad man ser.
 *
 * »Er det muligt at lave at naar man laver en refresh paa en note at den saa
 * bliver paa noten i stedet for at hoppe til forsiden?« (Andreas,
 * 2026-09-01).
 *
 * Mekanikken til at LAESE `#note-<id>` havde vaeret der siden F13 - og
 * kommentaren lovede endda, at »en genindlaesning lander samme sted«. Den
 * gjorde den bare aldrig: ingen SKREV adressen, naar man aabnede en note ved
 * at klikke. Halvdelen af en funktion, med et loefte skrevet ved siden af.
 *
 * ── Kommentarerne strippes ────────────────────────────────────────────────
 *
 * Foerste gang jeg skrev en proeve som den her (PDF'en, v39), fandt den
 * kaldet i en KOMMENTAR og bestod, ogsaa da koden var fjernet. En proeve, der
 * maaler en kommentar, maaler ingenting.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rens = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const core = rens(readFileSync(new URL('../app/parts/p1_core.js', import.meta.url), 'utf8'));
const editor = rens(readFileSync(new URL('../app/parts/p4_editor.js', import.meta.url), 'utf8'));

/*
 * Parentesen SKAL med i soegningen.
 *
 * Uden den er `function gaaTil` et praefiks af `function gaaTilbage`, og
 * `indexOf` finder den forkerte - proeven laeste en helt anden funktions krop
 * og faldt paa noget, der ikke fejlede. Fanget da tilbage-knappen kom til.
 */
const krop = (kilde, navn) => {
  const i = kilde.indexOf(`function ${navn}(`);
  assert.ok(i > -1, `${navn}() findes ikke`);
  return kilde.slice(i, kilde.indexOf('\n}', i));
};

test('at aabne en note SKRIVER adressen', () => {
  assert.match(krop(editor, 'aabnNote'), /saetAdresse\(id\)/,
    'uden det her lander en opfriskning paa forsiden');
});

test('… og den skrives FOER hentningen', () => {
  /*
   * Skete det foerst, naar noten var hentet, ville en opfriskning midt i
   * hentningen stadig lande paa forsiden - og det er praecis dér, man
   * opfrisker, naar noget ser ud til at haenge.
   */
  const k = krop(editor, 'aabnNote');
  const skrevet = k.indexOf('saetAdresse(id)');
  const hentet = k.indexOf("api('GET'");
  assert.ok(skrevet > -1 && hentet > -1);
  assert.ok(skrevet < hentet, 'adressen skal skrives foer noten hentes');
});

test('at forlade noten RYDDER adressen', () => {
  /*
   * Ellers ville »gaa til Search og opfrisk« kaste én tilbage til den note,
   * man lige forlod - den samme fejl med modsat fortegn.
   */
  assert.match(krop(core, 'gaaTil'), /saetAdresse\(null\)/);
});

test('adressen skrives med replaceState — ikke ved at saette location.hash', () => {
  /*
   * `location.hash = …` fyrer `hashchange`, som kalder `aabnFraAdressen()`,
   * som kalder `aabnNote()` igen. Vagten mod »samme note« fanger det som
   * REGEL - men mens noten hentes, er `editor.note` den forrige, og saa
   * slipper kaldet igennem. En adresselinje maa ikke saette en hentning i
   * gang.
   */
  const k = krop(core, 'saetAdresse');
  assert.match(k, /history\.replaceState/);
  assert.ok(!/location\.hash\s*=/.test(k), 'saetAdresse maa ikke skrive location.hash direkte');
});

test('… og ikke med pushState — tilbage-knappen skal ikke gaa gennem hver note', () => {
  assert.ok(!/history\.pushState/.test(krop(core, 'saetAdresse')));
});

test('der skrives ikke, naar adressen allerede staar rigtigt', () => {
  // En tom replaceState pr. optegning er stoej i browserens historik-log.
  assert.match(krop(core, 'saetAdresse'), /if \(nu === oensket\) return;/);
});

test('stien bevares — kun fragmentet skiftes', () => {
  const k = krop(core, 'saetAdresse');
  assert.match(k, /location\.pathname/);
  assert.match(k, /location\.search/);
});

test('adressen laeses kun som et HELT note-id', () => {
  // Anker i begge ender: `#note-abc` og `#note-<64 tegn>` maa ikke slippe
  // igennem som noget, der bliver slaaet op.
  assert.match(core, /\^#note-\(\[a-f0-9\]\{32\}\)\$/);
});

test('skrivningen taaler en browser uden history-api', () => {
  assert.match(krop(core, 'saetAdresse'), /try \{[\s\S]*catch/);
});
