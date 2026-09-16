/*
 * F35 - noter i faner.
 *
 * »er det muligt at lave i sagu at man kan have flere noter åbne i tabs som
 * det fx er muligt at gøre i notion« (Andreas, 2026-09-15).
 *
 * ── Hvorfor koden hentes UD af kilden ─────────────────────────────────────
 *
 * Fanerne bor i fladen og kan ikke importeres. Logikken er til gengaeld skilt
 * ud i rene funktioner (`placerNoteFane`, `naboNoteFane`, `fjernNoteFane`),
 * saa proeven koerer den kode, der udgives - ikke en afskrift.
 *
 * ── Hvad der IKKE proeves her ─────────────────────────────────────────────
 *
 * Selve bjaelken, klikkene og rullepositionen. De er set i browser-ruden:
 * ⌘-klik i en liste, midterklik i traeet, luk med krydset, W, `,` og `.`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const p15 = readFileSync(new URL('../app/parts/p15_faner.js', import.meta.url), 'utf8');
const p4 = readFileSync(new URL('../app/parts/p4_editor.js', import.meta.url), 'utf8');
const p1 = readFileSync(new URL('../app/parts/p1_core.js', import.meta.url), 'utf8');
const p12 = readFileSync(new URL('../app/parts/p12_polering.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/public/style.css', import.meta.url), 'utf8');

/** Henter én navngiven funktion ud af kilden og giver den sine afhaengigheder. */
function hent(kilde, navn, afhaengigheder = {}) {
  const i = kilde.indexOf(`function ${navn}(`);
  assert.ok(i > -1, `${navn} findes ikke laengere - ret proeven`);
  const slut = kilde.indexOf('\n}', i) + 2;
  const navne = Object.keys(afhaengigheder);
  // eslint-disable-next-line no-new-func
  return new Function(...navne, `${kilde.slice(i, slut)}\nreturn ${navn};`)(
    ...navne.map((k) => afhaengigheder[k]));
}

/** Kildeteksten til én funktion - til formreglerne. */
function krop(kilde, navn) {
  const i = kilde.indexOf(`function ${navn}(`);
  assert.ok(i > -1, `${navn} findes ikke laengere - ret proeven`);
  return kilde.slice(i, kilde.indexOf('\n}', i) + 2);
}

const placer = hent(p15, 'placerNoteFane');
const nabo = hent(p15, 'naboNoteFane');
const fjern = hent(p15, 'fjernNoteFane', { naboNoteFane: nabo });

const A = 'a'.repeat(32);
const B = 'b'.repeat(32);
const C = 'c'.repeat(32);
const D = 'd'.repeat(32);
const ider = (f) => f.liste.map((t) => t.id);
const ny = () => ({ liste: [], aktiv: null });

/* ================================================== et almindeligt klik */

test('den foerste note bliver den foerste fane - og den aktive', () => {
  const f = ny();
  placer(f, A, 'her', { titel: 'Drift' });
  assert.deepEqual(ider(f), [A]);
  assert.equal(f.aktiv, A);
  assert.equal(f.liste[0].titel, 'Drift');
});

test('et almindeligt klik skifter DEN AKTIVE fane ud - som i Notion', () => {
  const f = ny();
  placer(f, A, 'her');
  placer(f, B, 'baggrund');
  placer(f, C, 'her');
  assert.deepEqual(ider(f), [C, B], 'A blev skiftet ud paa sin egen plads');
  assert.equal(f.aktiv, C);
});

test('en note, der ALLEREDE staar i en fane, skifter til den - ingen dublet', () => {
  const f = ny();
  placer(f, A, 'her');
  placer(f, B, 'baggrund');
  placer(f, B, 'her');
  assert.deepEqual(ider(f), [A, B], 'A maa ikke blive skiftet ud med en note, der i forvejen har en fane');
  assert.equal(f.aktiv, B);
});

test('uden en aktiv fane laver et almindeligt klik en ny', () => {
  // Efter en genstart er ingen fane aktiv. Det foerste klik maa ikke skifte
  // en fane ud, man ikke har set, at man »stod i«.
  const f = { liste: [{ id: A, titel: '', ikon: null, mine: true, rul: 0 }], aktiv: null };
  placer(f, B, 'her');
  assert.deepEqual(ider(f), [A, B]);
  assert.equal(f.aktiv, B);
});

/* ============================================ ⌘-klik, midterklik, adresse */

test('baggrund: fanen kommer, men man bliver hvor man er', () => {
  const f = ny();
  placer(f, A, 'her');
  placer(f, B, 'baggrund');
  assert.deepEqual(ider(f), [A, B]);
  assert.equal(f.aktiv, A);
});

test('tre ⌘-klik i traek staar i den raekkefoelge, de blev klikket', () => {
  const f = ny();
  placer(f, A, 'her');
  for (const id of [B, C, D]) placer(f, id, 'baggrund');
  assert.deepEqual(ider(f), [A, B, C, D]);
});

test('en baggrundsfane paa en note, der allerede er aaben, flytter ikke fokus', () => {
  const f = ny();
  placer(f, A, 'her');
  placer(f, B, 'baggrund');
  placer(f, B, 'baggrund', { titel: 'ny titel' });
  assert.deepEqual(ider(f), [A, B]);
  assert.equal(f.aktiv, A);
  assert.equal(f.liste[1].titel, 'ny titel', 'men titlen maa gerne opfriskes');
});

test('»ny« (adressen) skifter ALDRIG en fane ud', () => {
  const f = ny();
  placer(f, A, 'her');
  placer(f, B, 'ny');
  assert.deepEqual(ider(f), [A, B]);
  assert.equal(f.aktiv, B);
});

/* ================================================================ lukke */

test('lukkes den aktive, tager fanen til HOEJRE over', () => {
  const f = ny();
  for (const id of [A, B, C]) placer(f, id, 'ny');
  f.aktiv = B;
  const n = fjern(f, B);
  assert.equal(n.id, C);
  assert.deepEqual(ider(f), [A, C]);
  assert.equal(f.aktiv, C);
});

test('er der ingen til hoejre, tager den til VENSTRE over', () => {
  const f = ny();
  for (const id of [A, B, C]) placer(f, id, 'ny');
  const n = fjern(f, C);
  assert.equal(n.id, B);
  assert.equal(f.aktiv, B);
});

test('den sidste fane lukket: ingen aktiv, ingen nabo', () => {
  const f = ny();
  placer(f, A, 'her');
  assert.equal(fjern(f, A), null);
  assert.deepEqual(ider(f), []);
  assert.equal(f.aktiv, null);
});

test('at lukke en ANDEN fane roerer ikke den aktive', () => {
  const f = ny();
  for (const id of [A, B, C]) placer(f, id, 'ny');
  f.aktiv = A;
  fjern(f, C);
  assert.equal(f.aktiv, A);
  assert.deepEqual(ider(f), [A, B]);
});

/* ======================================================== formreglerne */

test('aabnNote afgoer fanen FOER vagten mod »samme note« og foer foerste await', () => {
  /*
   * Efter vagten ville et klik paa den note, man staar i, aldrig goere dens
   * fane aktiv. Og efter et `await` er `state.openNote` allerede den nye, saa
   * rullepositionen ville blive gemt paa den forkerte fane.
   */
  const k = krop(p4, 'aabnNote');
  const fane = k.indexOf('noteFaneVedAabning(id)');
  assert.ok(fane > -1, 'aabnNote kalder ikke noteFaneVedAabning');
  assert.ok(fane < k.indexOf('editor.note.id === id && !editor.indlaeser'), 'fanen skal afgoeres foer vagten');
  assert.ok(fane < k.indexOf('await '), 'fanen skal afgoeres foer det foerste await');
  assert.match(k, /if \(!tving\) noteFaneVedAabning\(id\)/, 'en opfriskning maa ikke flytte fanerne');
});

test('en fejlet hentning lukker kun fanen ved 404 - ikke uden net', () => {
  const kaldt = [];
  const fejl = hent(p15, 'noteFaneFejl', {
    noteFaner: { liste: [{ id: A }], aktiv: A },
    fjernNoteFane: (f, id) => kaldt.push(id),
    gemNoteFaner: () => {},
    tegnNoteFaner: () => {},
  });
  fejl(A, { offline: true, message: 'No connection' });
  fejl(A, { status: 500 });
  assert.deepEqual(kaldt, [], 'en note, der ikke kan NAAS, er ikke vaek');
  fejl(A, { status: 404 });
  assert.deepEqual(kaldt, [A]);
});

/*
 * Rullepositionen - paa BEGGE slags rulleboks.
 *
 * Paa desktop ruller dokumentet. Under 900 px goer `html, body { height:
 * 100% }` + `overflow-x: hidden` body til rulleboksen, og saa er
 * `window.scrollY` altid 0, og `window.scrollTo()` flytter ingenting
 * (RUNE-ERFARINGER §4). Fanerne er slaaet fra dér i dag, saa fejlen var
 * latent - men hjaelperne skal vaere de rigtige, den dag de ikke er.
 *
 * Browser-ruden kan ikke drive rulningen (test-quirk 3), saa de to verdener
 * bygges her med de maalte egenskaber, og koden hentes UD AF KILDEN.
 */
function rulleVerden(bred) {
  const html = { scrollTop: 0, scrollHeight: bred ? 5000 : 812, clientHeight: 812 };
  const body = { scrollTop: 0, scrollHeight: 5000, clientHeight: 812 };
  const kald = [];
  const window = {
    scrollY: 0,
    scrollTo(x, y) {
      kald.push([x, y]);
      // Under 900 px er det body, der ruller - saa flytter window intet.
      if (bred) { this.scrollY = y; html.scrollTop = y; }
    },
  };
  const document = { scrollingElement: html, documentElement: html, body };
  return {
    window, document, kald,
    saet(y) { if (bred) { window.scrollY = y; html.scrollTop = y; } else body.scrollTop = y; },
    y: () => (bred ? window.scrollY : body.scrollTop),
  };
}

for (const bred of [true, false]) {
  test(`en fane husker og genskaber sin rulning - ${bred ? 'dokumentet ruller (desktop)' : 'body ruller (under 900 px)'}`, () => {
    const v = rulleVerden(bred);
    const { window, document } = v;
    const rulletNed = hent(p1, 'rulletNed', { window, document });
    const rulleBoks = hent(p1, 'rulleBoks', { document });
    const rulTil = hent(p1, 'rulTil', { window, document, rulleBoks });
    const f = { liste: [{ id: A, titel: '', ikon: null, mine: true, rul: 0 }], aktiv: A, rulTil: null };
    const faelles = { noteFaner: f, rulletNed, rulTil, window, document };

    v.saet(1200);
    hent(p15, 'gemNoteFaneRul', { ...faelles, state: { view: 'note', openNote: A } })();
    assert.equal(f.liste[0].rul, 1200, 'positionen blev gemt');

    v.saet(0);
    f.rulTil = 1200;
    hent(p15, 'noteFaneEfterIndlaesning', {
      ...faelles,
      state: { openNote: A },
      noteFanerAktive: () => true,
      gemNoteFaner: () => {},
      tegnNoteFaner: () => {},
      setTimeout: (fn) => fn(),
    })({ id: A, title: 'x', mine: true });
    assert.equal(v.y(), 1200, 'og genskabt i den boks, der ruller');
    assert.equal(rulletNed(), 1200);

    if (bred) {
      // Desktop er uaendret: det er stadig window.scrollTo, der goer det.
      assert.deepEqual(v.kald, [[0, 1200]]);
      assert.equal(document.body.scrollTop, 0, 'body roeres ikke, naar dokumentet ruller');
    } else {
      assert.equal(document.documentElement.scrollTop, 0, 'den forkerte boks ruller ikke med');
    }
  });
}

test('p15 maaler og ruller KUN gennem hjaelperne', () => {
  // Grep efter hvad der MAALES (RUNE-ERFARINGER §4), ikke efter et navn.
  const kode = p15.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/scrollY|pageYOffset|scrollTop|scrollTo\(/.test(kode),
    'brug rulletNed() til at laese og rulTil() til at skrive');
});

test('ryddNoteFaner lukker ingenting offline eller fra et tomt trae efter en fejl', () => {
  const faner = () => ({ bruger: 1, aktiv: A, liste: [
    { id: A, titel: 'min', ikon: null, mine: true, rul: 0 },
    { id: B, titel: 'delt', ikon: null, mine: false, rul: 0 },
  ] });
  const koer = (st) => {
    const f = faner();
    hent(p15, 'ryddNoteFaner', { state: st, noteFaner: f, gemNoteFaner: () => {}, tegnNoteFaner: () => {} })();
    return f;
  };
  assert.deepEqual(ider(koer({ user: { id: 1 }, offline: true, tree: [] })), [A, B],
    'offline er traeet fra cachen - det maa ikke lukke faner');
  const efter = koer({ user: { id: 1 }, offline: false, tree: [] });
  assert.deepEqual(ider(efter), [B], 'min slettede note forsvinder; den delte staar aldrig i traeet og bliver');
  assert.equal(efter.aktiv, null);
  const omdoebt = koer({ user: { id: 1 }, offline: false, tree: [{ id: A, title: 'nyt navn', icon: '📘' }] });
  assert.equal(omdoebt.liste[0].titel, 'nyt navn');
  assert.equal(omdoebt.liste[0].ikon, '📘');
});

test('hentTrae rydder fanerne i den gren, der LYKKEDES - ikke i fejlgrenen', () => {
  const k = krop(p4, 'hentTrae');
  const ok = k.indexOf('ryddNoteFaner()');
  assert.ok(ok > -1, 'hentTrae kalder ikke ryddNoteFaner');
  assert.ok(ok < k.indexOf('catch'), 'et tomt trae efter en fejl ville lukke alle faner');
});

test('⌘-klik i traeet VAELGER stadig - kun ⌥-klik og midterklik tager traeet med', () => {
  // »det kraever ikke at jeg benytter command ... hvilket ogsaa er det jeg
  // oensker« (Andreas, 2026-09-01). Fanerne maa ikke tage det fra ham.
  const maal = hent(p15, 'noteMaalFraKlik', { NOTE_ID_RE: /^[a-f0-9]{32}$/ });
  const el = (sel) => ({
    closest: (v) => (v.split(',').includes(sel) ? {
      dataset: { note: A }, getAttribute: () => null, querySelector: () => null, textContent: 'Drift',
    } : null),
  });
  assert.equal(maal(el('[data-note]'), false), null, '⌘-klik i traeet skal ikke aabne en fane');
  assert.equal(maal(el('[data-note]'), true).id, A, 'midterklik i traeet skal');
  // Og lytteren giver kun traeet med, naar det er ⌥ UDEN ⌘/Ctrl.
  const lytter = p15.slice(p15.indexOf("document.addEventListener('click'"));
  assert.match(lytter, /const alt = e\.altKey && !e\.metaKey && !e\.ctrlKey;/);
  assert.match(lytter, /noteMaalFraKlik\(e\.target, alt\)/);
});

test('et id, der ikke ligner et id, bliver aldrig til en fane', () => {
  const maal = hent(p15, 'noteMaalFraKlik', { NOTE_ID_RE: /^[a-f0-9]{32}$/ });
  const link = (href) => ({
    closest: () => ({ dataset: {}, getAttribute: () => href, querySelector: () => null, textContent: 'x' }),
  });
  assert.equal(maal(link(`#note-${A}`), false).id, A);
  assert.equal(maal(link('#note-../../api'), false), null);
  assert.equal(maal(link('#note-'), false), null);
});

test('fanerne findes ikke i et sidevindue eller under 900 px', () => {
  const aktive = (solo, smal) => hent(p15, 'noteFanerAktive', {
    state: { user: { id: 1 } }, soloVindue: () => solo, smalSkaerm: () => smal,
  })();
  assert.equal(aktive(false, false), true);
  assert.equal(aktive(true, false), false, 'et sidevindue ER én note');
  assert.equal(aktive(false, true), false, '»det er for smaat paa telefonen«');
  assert.match(css, /@media \(max-width: 900px\) \{\s*\.notefaner \{ display: none; \}/);
  assert.match(css, /body\.solo \.notefaner \{ display: none; \}/);
});

test('fanerne huskes pr. BRUGER - to konti i samme browser ser ikke hinandens titler', () => {
  const noegle = hent(p15, 'noteFaneNoegle', { state: { user: { id: 7 } } });
  assert.equal(noegle(), 'sagu_faner:7');
});

test('bjaelken tegnes af tegnNoteFaner, ikke af skallen', () => {
  // docs/regler/flade.md: ét sted tegner OG binder.
  const skal = krop(p1, 'shellHtml');
  assert.match(skal, /id="noteFaner"[^>]*hidden><\/div>/, 'skallen maa kun have den TOMME vaert');
  assert.ok(!skal.includes('notefane-'), 'faner i skallen ville staa uden klik-handler');
  assert.ok(krop(p1, 'bindShell').includes('klargoerNoteFaner()'));
});

test('fanegenvejene er enkelttaster uden Alt paa et dansk tastatur', () => {
  // `[` og `]` kraever Alt paa en dansk Mac, og genvejene afviser Alt.
  for (const tast of ["'w'", "','", "'.'"]) {
    assert.ok(p12.includes(`tast: ${tast}`), `genvejen ${tast} mangler`);
  }
  const i = p12.indexOf("tast: 'w'");
  assert.ok(!p12.slice(i, i + 300).includes('modifikator'), 'W maa ikke tage Ctrl+W fra browseren');
});

/*
 * At p15 ikke roerer en konstant fra p1 i sin egen top, vogtes nu af en
 * GENEREL formregel i form.test.mjs: alle dele, der sorterer foer p1_core.js,
 * koeres i build'ets orden.
 */
