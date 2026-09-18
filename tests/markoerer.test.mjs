/*
 * `/notesbog` og `#maerke`, mens man opretter en note i omni-feltet.
 *
 * Fladen kan ikke koeres her - der er ingen DOM i node - men REGLEN kan.
 * `plukBog()` er ren: tekst ind, {titel, bog} ud. Den hentes UD AF KILDEN
 * frem for at blive skrevet af; en afskrift beviser kun, at afskriften er
 * rigtig (samme greb som `hentPorten()` i rigblok.test.mjs).
 *
 * De tre ting, der er dyre at faa galt:
 *
 *  1. **Et navn med MELLEMRUM.** Halvdelen af notesboegerne hedder noget med
 *     to ord. Uden `/"TDCE noter"` ville markoeren kun ramme »TDCE«, og
 *     resten blev staaende i titlen.
 *  2. **Markoeren maa ikke aede en adresse.** `https://dr.dk/nyheder` er ikke
 *     en notesbog. Samme regel som `#` (shared/maerker.js).
 *  3. **Uden en modtager bliver teksten staaende.** Rammer `/xyz` ingen bog,
 *     fjernes den IKKE - en markoer, der forsvinder uden at have gjort noget,
 *     opdager man en uge senere.
 *
 *   node --test tests/markoerer.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const p5 = readFileSync(new URL('../app/parts/p5_omni.js', import.meta.url), 'utf8');

/** `plukBog` og dens to naboer, hentet ud af kilden. */
function hentPluk() {
  const dele = ['const BOG_MOENSTER', 'function bogMarkoer(', 'function findBog(', 'function plukBog('];
  const kode = dele.map((d) => {
    const i = p5.indexOf(d);
    assert.ok(i > -1, `${d} findes ikke laengere i p5_omni.js`);
    // Konstanten er én linje; funktionerne slutter ved en `}` i kolonne 0.
    const slut = d.startsWith('const') ? p5.indexOf('\n', i) : p5.indexOf('\n}', i) + 2;
    return p5.slice(i, slut);
  }).join('\n');
  // eslint-disable-next-line no-new-func
  return new Function(`${kode}\nreturn { plukBog, findBog, bogMarkoer, BOG_MOENSTER };`)();
}

const { plukBog, findBog, bogMarkoer } = hentPluk();

const BOEGER = [
  { id: 'b1', name: 'Drift' },
  { id: 'b2', name: 'TDCE noter' },
  { id: 'b3', name: 'Driftsplaner' },
];

/* ====================================================== det den skal ==== */

test('et navn i ét ord rammer sin bog, og markoeren forsvinder fra titlen', () => {
  const r = plukBog('Ny router /Drift', BOEGER);
  assert.equal(r.tekst, 'Ny router');
  assert.equal(r.bog.id, 'b1');
  assert.equal(r.soegt, 'Drift');
});

test('et navn med MELLEMRUM kraever anfoerselstegn - og virker saa', () => {
  const r = plukBog('Mine noter /"TDCE noter"', BOEGER);
  assert.equal(r.tekst, 'Mine noter');
  assert.equal(r.bog.id, 'b2');
});

test('markoeren maa staa MIDT i teksten', () => {
  // Foerste udgave af moensteret sluttede paa `$`, saa markoeren kun blev
  // genkendt, naar den stod til sidst. Et forslag saetter et mellemrum efter
  // navnet - og saa holdt den op med at virke.
  const r = plukBog('En note /Drift midt i', BOEGER);
  assert.equal(r.tekst, 'En note midt i');
  assert.equal(r.bog.id, 'b1');
  assert.equal(r.erSidst, false);
});

test('et praefiks er nok, naar det kun kan vaere ÉN bog', () => {
  assert.equal(findBog('drif', BOEGER), null, '»drif« kan vaere to - saa vaelger appen ikke');
  assert.equal(findBog('tdce', BOEGER).id, 'b2');
  // Et PRAECIST navn slaar altid - ogsaa naar det er praefiks for et andet.
  assert.equal(findBog('drift', BOEGER).id, 'b1');
});

/* ====================================================== det den IKKE maa = */

test('en adresse bliver ikke til en notesbog', () => {
  for (const t of ['Se https://dr.dk/nyheder', 'Forhold 3/4', 'and/or', 'a/b/c']) {
    const r = plukBog(t, BOEGER);
    assert.equal(r.bog, null, t);
    assert.equal(r.tekst, t, `teksten skal vaere uroert: ${t}`);
  }
});

test('rammer navnet ingen bog, bliver markoeren STAAENDE i titlen', () => {
  const r = plukBog('Ny router /dirft', BOEGER);
  assert.equal(r.bog, null);
  assert.equal(r.tekst, 'Ny router /dirft');
  // ... men den er oplyst, saa fladen kan sige det.
  assert.equal(r.soegt, 'dirft');
});

test('ingen markoer er ingen aendring', () => {
  const r = plukBog('  Bare en titel  ', BOEGER);
  assert.equal(r.tekst, 'Bare en titel');
  assert.equal(r.bog, null);
  assert.equal(r.soegt, '');
});

/* ====================================================== udfyldningen ==== */

test('udfyldningen saetter anfoerselstegn, naar navnet har mellemrum', () => {
  assert.equal(bogMarkoer('Drift'), '/Drift');
  assert.equal(bogMarkoer('TDCE noter'), '/"TDCE noter"');
});

test('det, et forslag skriver, kan laeses igen', () => {
  /*
   * Rundturen. Foerste udgave bestod hver enkelt prove og var alligevel i
   * stykker: forslaget skrev `/"TDCE noter" `, og moensteret krævede
   * `$` - saa det, fladen selv havde skrevet, kunne den ikke laese bagefter.
   */
  for (const b of BOEGER) {
    const skrevet = `Min titel ${bogMarkoer(b.name)} og mere`;
    const r = plukBog(skrevet, BOEGER);
    assert.equal(r.bog && r.bog.id, b.id, skrevet);
    assert.equal(r.tekst, 'Min titel og mere', skrevet);
  }
});

/* ====================================================== formregler ====== */

test('forslagene ligger i ÉN funktion - to lister kunne vises samtidig', () => {
  /*
   * Kun én markoer kan staa sidst i feltet, saa de to forslagslister kan
   * aldrig optraede paa én gang. Det er grunden til, at de deler funktion;
   * to uafhaengige lister ville kunne komme til at bryde det.
   */
  const i = p5.indexOf('function markoerForslag(');
  assert.ok(i > -1, 'markoerForslag findes ikke laengere');
  const krop = p5.slice(i, p5.indexOf('\n}', i) + 2)
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
  assert.match(krop, /MAERKE_SIDST/, 'maerkerne skal foreslaas her');
  assert.match(krop, /plukBog|BOG_MOENSTER/, 'notesboegerne skal foreslaas her');
});

test('notesbogen plukkes FOER soegetolken', () => {
  /*
   * `saguSoeg.tolk` laeser `"to ord"` som en frase og fjerner citaterne.
   * Kom `plukBog` bagefter, saa den `/TDCE noter` og ramte kun »TDCE« -
   * ordet »noter« blev staaende i titlen. Maalt i browseren, ikke gaettet.
   */
  const i = p5.indexOf('const b = plukBog(raa.trim()');
  assert.ok(i > -1, 'oprettelses-raekken plukker ikke laengere paa den raa tekst');
  const efter = p5.slice(i, i + 400);
  assert.ok(efter.indexOf('saguSoeg.tolk(b.tekst)') > -1,
    'soegetolken skal koere PAA resultatet af plukBog - ikke omvendt');
});
