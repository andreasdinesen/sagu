/*
 * Naar folder topbjaelken sig sammen?
 *
 * ── Hvorfor den her proeve findes ─────────────────────────────────────────
 *
 * Meldt fra doda-sessionen (2026-08-25): bjaelken flimrede ved rulning. Den
 * folder sig sammen, dokumentet bliver kortere, browseren klipper
 * rullepositionen, toppen kommer i syne, bjaelken folder sig ud - og om igen,
 * mange gange i sekundet. Betingelsen:
 *
 *     (dokumenthoejde - skaermhoejde) < det, bjaelken krymper
 *
 * MAALT i Sagu paa 1280x800: bjaelken krymper 70 px, og en note paa fire til
 * seks korte afsnit har 0-56 px at rulle i, naar den er foldet.
 *
 * ── Hvorfor koden hentes UD af kilden ─────────────────────────────────────
 *
 * `skalVaereRullet()` bor i fladen og kan ikke importeres. Og hverken en
 * `IntersectionObserver` eller en scroll-lytter kan drives programmatisk i et
 * testmiljoe - maalt i dag: en programmatisk rulning gav NUL fyringer af
 * begge slags, mens et rigtigt hjul-scroll gav baade scroll-haendelser og
 * observer-kald.
 *
 * Regnestykket er derfor det ENESTE sted, fejlen kan fanges uden en finger
 * paa et hjul. Funktionen hentes ud af kilden og koeres - ikke skrives af.
 * En kopi ville proeve kopien.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const kilde = readFileSync(new URL('../app/parts/p1_core.js', import.meta.url), 'utf8');

/** Henter konstanterne og funktionen ud af den kode, der faktisk sendes. */
function hentBeslutningen() {
  const konst = [...kilde.matchAll(/^const (RULLET_[A-Z]+) = (\d+);/gm)];
  assert.equal(konst.length, 3, 'forventede tre taerskler i p1_core.js');
  const i = kilde.indexOf('function skalVaereRullet');
  assert.ok(i > -1, 'skalVaereRullet findes ikke laengere');
  const slut = kilde.indexOf('\n}', i) + 2;
  const src = `${konst.map((m) => m[0]).join('\n')}\n${kilde.slice(i, slut)}\nreturn { skalVaereRullet, RULLET_TIL, RULLET_FRA, RULLET_PLADS };`;
  // eslint-disable-next-line no-new-func
  return new Function(src)();
}

const { skalVaereRullet, RULLET_TIL, RULLET_FRA, RULLET_PLADS } = hentBeslutningen();

/* Det, bjaelken giver slip paa, maalt i browseren paa 1280x800. */
const KRYMPER = 70;

test('afstanden mellem taersklerne er STOERRE end det, bjaelken krymper', () => {
  /*
   * Den vigtigste proeve i filen. Er afstanden mindre, kan browserens egen
   * justering naa fra den oevre taerskel ned under den nedre - og saa er
   * loekken der igen, uanset hvor pæn koden ellers ser ud.
   */
  assert.ok(RULLET_TIL - RULLET_FRA > KRYMPER,
    `${RULLET_TIL} - ${RULLET_FRA} = ${RULLET_TIL - RULLET_FRA}, som skal vaere > ${KRYMPER}`);
});

test('gulvet er ogsaa stoerre end det, bjaelken krymper', () => {
  // Ellers kan en side vaere lang nok til at folde sammen og for kort til at
  // blive ved med at vaere det.
  assert.ok(RULLET_PLADS > KRYMPER, `${RULLET_PLADS} skal vaere > ${KRYMPER}`);
});

test('en KORT side folder aldrig sammen — uanset hvor langt der rulles', () => {
  // Den note, der flimrede: 36-56 px at rulle i.
  for (const plads of [0, 11, 36, 56, RULLET_PLADS]) {
    for (const y of [0, 8, 50, 120, 200, 5000]) {
      assert.equal(skalVaereRullet(false, y, plads), false,
        `plads=${plads} y=${y} foldede sammen`);
    }
  }
});

test('en LANG side folder sammen, naar der er rullet nok', () => {
  // Og det er den anden halvdel: fejlen maa ikke fjernes ved at fjerne
  // funktionen. Doda-sessionen faldt selv i den faelde.
  assert.equal(skalVaereRullet(false, RULLET_TIL + 1, RULLET_PLADS + 1), true);
  assert.equal(skalVaereRullet(false, 5000, 9000), true);
});

test('… men ikke foer den oevre taerskel er naaet', () => {
  assert.equal(skalVaereRullet(false, RULLET_TIL, 9000), false);
  assert.equal(skalVaereRullet(false, 119, 9000), false);
});

test('foldet bliver den, til man er naesten helt tilbage i toppen', () => {
  assert.equal(skalVaereRullet(true, 119, 9000), true, 'et lille ryk maa ikke folde den ud');
  assert.equal(skalVaereRullet(true, RULLET_FRA, 9000), true);
  assert.equal(skalVaereRullet(true, RULLET_FRA - 1, 9000), false);
  assert.equal(skalVaereRullet(true, 0, 9000), false);
});

test('den klipning, der lavede loekken, kan ikke laengere folde den ud', () => {
  /*
   * Kernen. Bjaelken staar foldet, man er rullet til 130, og browseren
   * klipper positionen med de 70 px, sammenfoldningen frigav. Med ÉN taerskel
   * ved 8 px ville 130-70 = 60 stadig vaere over - men i den GAMLE kode var
   * taersklen vagtpostens 8 px MAALT FRA TOPPEN, og en kort side klippede
   * helt i bund. Her er det tallet, der taeller: efter klipningen skal den
   * stadig vaere foldet.
   */
  for (const y of [130, 200, 500]) {
    assert.equal(skalVaereRullet(true, Math.max(0, y - KRYMPER), 9000), true,
      `y=${y} klippet til ${y - KRYMPER} foldede ud igen`);
  }
});

test('en tilstand, der ikke skal skifte, bliver staaende', () => {
  // Ingen skift = ingen flimmer. Den samme maaling to gange giver det samme.
  const tilfaelde = [[false, 0, 0], [false, 500, 9000], [true, 500, 9000], [true, 0, 0]];
  for (const [r, y, p] of tilfaelde) {
    const en = skalVaereRullet(r, y, p);
    assert.equal(skalVaereRullet(en, y, p), en, `ustabil ved r=${r} y=${y} p=${p}`);
  }
});

test('vagtposten er VÆK — dødt markup er en fælde', () => {
  assert.ok(!kilde.includes('rulVagt'), 'vagtposten bruges ikke laengere');
  const css = readFileSync(new URL('../app/public/style.css', import.meta.url), 'utf8');
  assert.ok(!css.includes('.rulvagt'), 'CSS til vagtposten staar tilbage');
});
