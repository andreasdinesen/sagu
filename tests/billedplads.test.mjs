/*
 * Billedets plads overlever en gentegning.
 *
 * »hvis jeg klikker add a block. saa hopper den til toppen af noten, istedet
 * for at blive der hvor jeg skal skrive« (Andreas, 2026-09-06).
 *
 * Maalt i browseren FOER rettelsen: dokumentet gik fra 2011 px til 888 px i
 * det oejeblik noten blev tegnet igen, og rulningen blev klemt fra 1291 til
 * 168. Aarsagen er, at et `<img>` uden maal fylder nul, indtil filen er inde.
 *
 * Selve layoutet kan ikke proeves i node - der er ingen browser. Det, der KAN
 * proeves, er hukommelsen bag det: at maalene bliver gemt, at de bliver sat
 * paa igen, og at de ALDRIG bliver staaende oven paa et billede, der er
 * hentet. Og saa formen: at optegningen stadig kalder dem.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const p6 = readFileSync(new URL('../app/parts/p6_blokke.js', import.meta.url), 'utf8');
const p4 = readFileSync(new URL('../app/parts/p4_editor.js', import.meta.url), 'utf8');

/** Hukommelsen hentet UD af kilden - ikke skrevet af. */
function hentHukommelsen() {
  const kort = p6.match(/^const billedMaal = new Map\(\);$/m);
  assert.ok(kort, 'billedMaal findes ikke laengere');
  const tag = (navn) => {
    const i = p6.indexOf(`function ${navn}(`);
    assert.ok(i > -1, `${navn} findes ikke laengere`);
    return p6.slice(i, p6.indexOf('\n}', i) + 2);
  };
  // eslint-disable-next-line no-new-func
  return new Function(`${kort[0]}
    ${tag('gemBilledMaal')}
    ${tag('saetBilledMaal')}
    return { gemBilledMaal, saetBilledMaal, billedMaal };`)();
}

const { gemBilledMaal, saetBilledMaal, billedMaal } = hentHukommelsen();

/** Et `<img>`, saa smalt som reglerne har brug for. */
const billede = (o = {}) => ({
  src: 'https://sagu.dk/api/v1/files/abc',
  complete: false,
  naturalWidth: 0,
  naturalHeight: 0,
  style: { width: '', aspectRatio: '' },
  ...o,
});

/* ================================================== hukommelsen ========= */

test('et hentet billede huskes, og et nyt af samme adresse faar pladsen', () => {
  billedMaal.clear();
  const inde = billede({ complete: true, naturalWidth: 1000, naturalHeight: 1400 });
  assert.equal(gemBilledMaal(inde), true);

  // Gentegningen: et HELT nyt element med samme adresse, endnu ikke hentet.
  const nyt = billede();
  assert.equal(saetBilledMaal(nyt), true);
  assert.equal(nyt.style.width, '1000px');
  assert.equal(nyt.style.aspectRatio, '1000 / 1400');
});

test('et billede vi ALDRIG har set faar ingen plads - vi ville gaette', () => {
  billedMaal.clear();
  const nyt = billede({ src: 'https://sagu.dk/api/v1/files/ukendt' });
  assert.equal(saetBilledMaal(nyt), false);
  assert.equal(nyt.style.width, '');
  assert.equal(nyt.style.aspectRatio, '');
});

test('maalene foelger ADRESSEN - to forskellige billeder blandes ikke', () => {
  billedMaal.clear();
  gemBilledMaal(billede({ src: 'a', complete: true, naturalWidth: 800, naturalHeight: 200 }));
  gemBilledMaal(billede({ src: 'b', complete: true, naturalWidth: 100, naturalHeight: 900 }));
  const a = billede({ src: 'a' });
  const b = billede({ src: 'b' });
  saetBilledMaal(a);
  saetBilledMaal(b);
  assert.equal(a.style.aspectRatio, '800 / 200');
  assert.equal(b.style.aspectRatio, '100 / 900');
});

test('stemplet ryddes, saa snart billedet ER inde', () => {
  /*
   * Det gemte maal er et GAET om noget, vi endnu ikke har set. I samme
   * oejeblik filen er inde, kender browseren sandheden - og bliver
   * `aspect-ratio` staaende, ville et billede, der er skiftet ud bag samme
   * adresse, blive trykket skaevt for altid.
   */
  billedMaal.clear();
  gemBilledMaal(billede({ complete: true, naturalWidth: 1000, naturalHeight: 1400 }));
  const el = billede();
  saetBilledMaal(el);
  assert.equal(el.style.width, '1000px');

  // Filen lander: browseren melder maalene, og stemplet skal vaek.
  el.complete = true;
  el.naturalWidth = 640;
  el.naturalHeight = 480;
  gemBilledMaal(el);
  assert.equal(el.style.width, '');
  assert.equal(el.style.aspectRatio, '');
  // ... og det er de NYE maal, der huskes.
  const igen = billede();
  saetBilledMaal(igen);
  assert.equal(igen.style.aspectRatio, '640 / 480');
});

test('et billede, der ER hentet, roeres ikke - browseren ved bedst', () => {
  billedMaal.clear();
  gemBilledMaal(billede({ complete: true, naturalWidth: 1000, naturalHeight: 1400 }));
  const el = billede({ complete: true, naturalWidth: 640, naturalHeight: 480 });
  assert.equal(saetBilledMaal(el), false);
  assert.equal(el.style.width, '');
});

test('et billede, der fejlede, huskes ikke som nul gange nul', () => {
  /*
   * `naturalWidth` er 0 for en fil, der ikke kunne hentes. Blev det gemt,
   * ville `aspect-ratio: 0 / 0` staa paa hvert eneste billede bagefter.
   */
  billedMaal.clear();
  const doedt = billede({ complete: true, naturalWidth: 0, naturalHeight: 0 });
  assert.equal(gemBilledMaal(doedt), false);
  const nyt = billede();
  assert.equal(saetBilledMaal(nyt), false);
});

/* ======================================================= formen ========= */

test('bindBilleder saetter pladsen af, FOER den binder klikket', () => {
  /*
   * Raekkefoelgen er hele rettelsen. Sker det efter, at browseren har regnet
   * layoutet, er hoejden allerede faldet sammen - og rulningen er allerede
   * klemt ned i den. `indexOf` alene duer ikke som proeve (-1 er mindre end
   * alt); begge dele skal FINDES.
   */
  const i = p6.indexOf('function bindBilleder(');
  assert.ok(i > -1, 'bindBilleder findes ikke');
  const krop = p6.slice(i, p6.indexOf('\n}\n', i));
  const plads = krop.indexOf('saetBilledMaal(el)');
  const klik = krop.indexOf("addEventListener('click'");
  assert.ok(plads > -1, 'bindBilleder saetter ikke pladsen af');
  assert.ok(klik > -1, 'bindBilleder binder ikke klikket');
  assert.ok(plads < klik, 'pladsen skal saettes af foer klikket bindes');
});

test('bindBilleder husker maalene, baade nu og naar billedet lander', () => {
  const i = p6.indexOf('function bindBilleder(');
  const krop = p6.slice(i, p6.indexOf('\n}\n', i));
  assert.match(krop, /if \(el\.complete\) gemBilledMaal\(el\)/,
    'et billede, der allerede er inde, skal huskes med det samme');
  assert.match(krop, /addEventListener\('load', \(\) => gemBilledMaal\(el\)/,
    'et billede, der lander senere, skal ogsaa huskes');
});

test('optegningen med en aaben blok holder feltet i syne', () => {
  const i = p4.indexOf('function tegnMedAabenBlok(');
  assert.ok(i > -1, 'tegnMedAabenBlok findes ikke');
  const krop = p4.slice(i, p4.indexOf('\nfunction ', i + 10));
  assert.match(krop, /holdBlokISyne\(host\)/,
    'tegnMedAabenBlok kalder ikke holdBlokISyne - saa gaelder den kun den ene af de to veje');
});

test('holdBlokISyne slipper roret, naar man ruller selv', () => {
  /*
   * Den henter feltet tilbage, naar et billede lander. Ruller man SELV
   * imens, har man taget over - og at trække skaermen tilbage ville vaere
   * appen, der bestemmer over brugeren.
   */
  const i = p4.indexOf('function holdBlokISyne(');
  assert.ok(i > -1, 'holdBlokISyne findes ikke');
  const krop = p4.slice(i, p4.indexOf('\n}\n', i));
  assert.match(krop, /'wheel'/, 'musehjulet stopper den ikke');
  assert.match(krop, /'touchmove'/, 'en finger stopper den ikke');
  assert.match(krop, /document\.activeElement !== felt/,
    'den foelger et felt, man ikke laengere staar i');
  assert.match(krop, /block: 'nearest'/,
    "'nearest' er det, der goer INTET, naar feltet allerede staar i syne");
});
