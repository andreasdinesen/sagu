/*
 * F29 - en note poppet ud i sit eget vindue.
 *
 * »Kan du lave en knap saa man kan poppe en note ud i sit eget vindue, saa den
 * er til at have ved siden af?« (Andreas, 2026-09-05).
 *
 * ── Hvorfor koden hentes UD af kilden ─────────────────────────────────────
 *
 * De tre funktioner bor i fladen og kan ikke importeres. De er til gengaeld
 * smaa og rene nok til at koere med attrapper for `location`, `window` og
 * `document` - saa proeven maaler DEN kode, der udgives, og ikke en afskrift.
 *
 * ── Hvad der IKKE proeves her ─────────────────────────────────────────────
 *
 * At browseren rent faktisk laver et selvstaendigt vindue. Det kan kun ses
 * med oejnene, og browser-ruden laver ingen: den navigerede sin egen fane, da
 * jeg proevede. Selve tilstanden er derimod set i ruden - sidebaren vaek,
 * titlen sat, `?solo=1` bevaret gennem en navigation.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const p1 = readFileSync(new URL('../app/parts/p1_core.js', import.meta.url), 'utf8');
const p4 = readFileSync(new URL('../app/parts/p4_editor.js', import.meta.url), 'utf8');
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

/* ==================================================== soloVindue ======== */

const solo = (search) => hent(p1, 'soloVindue', { location: { search }, URLSearchParams })();

test('?solo=1 er DET, der goer et vindue til et sidevindue', () => {
  assert.equal(solo('?solo=1'), true);
  assert.equal(solo('?a=1&solo=1&b=2'), true, 'flaget maa gerne staa mellem andre');
});

test('et almindeligt vindue er IKKE solo', () => {
  for (const s of ['', '?', '?solo=0', '?solo=', '?solo=ja', '?andet=1']) {
    assert.equal(solo(s), false, `»${s}« skulle ikke give et sidevindue`);
  }
});

test('en soendret adresse giver et ALMINDELIGT vindue, ikke en fejl', () => {
  /*
   * `soloVindue()` kaldes bl.a. i `start()`, foer noget er tegnet. Kastede
   * den, ville appen ikke starte - og et sidevindue er en bekvemmelighed,
   * ikke noget, opstarten maa haenge paa.
   */
  const kastende = hent(p1, 'soloVindue', {
    location: { get search() { throw new Error('nej'); } }, URLSearchParams,
  });
  assert.equal(kastende(), false);
});

/* ==================================================== vinduestitel ====== */

function titel({ solo: erSolo, note, appName = 'Sagu' }) {
  const doc = { title: '' };
  hent(p1, 'vinduestitel', {
    state: { config: { appName } },
    editor: { note },
    document: doc,
    soloVindue: () => erSolo,
  })();
  return doc.title;
}

test('et sidevindue baerer NOTENS navn', () => {
  /*
   * Det er ikke pynt. Har man tre noter poppet ud, staar de i
   * operativsystemets vinduesliste med hver sin titel - hedder de alle sammen
   * »Sagu«, kan man ikke vaelge imellem dem, og saa er en funktion, hvis
   * formaal er at have noter ved siden af hinanden, ubrugelig med tre.
   */
  assert.equal(titel({ solo: true, note: { title: 'Pakke størrelser' } }),
    'Pakke størrelser - Sagu');
});

test('et ALMINDELIGT vindue baerer appens navn - ogsaa med en note aaben', () => {
  // Ellers ville hovedvinduets fane skifte navn, hver gang man aabnede en note.
  assert.equal(titel({ solo: false, note: { title: 'Pakke størrelser' } }), 'Sagu');
});

test('uden en note er titlen appens navn - ogsaa i et sidevindue', () => {
  assert.equal(titel({ solo: true, note: null }), 'Sagu');
  assert.equal(titel({ solo: true, note: { title: '   ' } }), 'Sagu', 'blanke tegn er ikke et navn');
});

test('appens navn foelger med, naar Andreas har doebt den om', () => {
  assert.equal(titel({ solo: true, note: { title: 'Ting' }, appName: 'Arkivet' }),
    'Ting - Arkivet');
});

/* ==================================================== popUdNote ========= */

function popUd({ blokeret = false } = {}) {
  const spor = [];
  const vindue = { focus: () => spor.push('focus') };
  const fn = hent(p4, 'popUdNote', {
    gemNu: () => { spor.push('gemNu'); },
    location: { pathname: '/' },
    window: {
      open: (adr, navn) => { spor.push(`open ${adr} @ ${navn}`); return blokeret ? null : vindue; },
    },
    toast: (t) => spor.push(`toast ${t}`),
  });
  fn({ id: 'c319fb5cbc32d4dd1a9683f5ba4b63db' });
  return spor;
}

test('vinduet aabnes paa notens egen adresse med solo-flaget', () => {
  const spor = popUd();
  assert.ok(spor.some((s) => s.startsWith('open /?solo=1#note-c319fb5cbc32d4dd1a9683f5ba4b63db')),
    `adressen var forkert: ${spor.join(' | ')}`);
});

test('vinduet navngives efter NOTEN - saa den samme note ikke aabnes to gange', () => {
  /*
   * `window.open`s andet argument er vinduets navn. Er det tomt eller ens for
   * alle noter, faar man enten et nyt vindue hver gang (to editorer paa én
   * tekst) eller ét vindue, der bliver genbrugt til alle noter. Navnet skal
   * baere id'et.
   */
  const spor = popUd();
  assert.ok(spor.some((s) => s.includes('@ sagu-note-c319fb5cbc32d4dd1a9683f5ba4b63db')),
    `vinduesnavnet var forkert: ${spor.join(' | ')}`);
});

test('der GEMMES, foer vinduet aabnes', () => {
  /*
   * Det nye vindue henter noten fra serveren. Ligger en rettelse stadig i
   * editorens debounce, ville sidevinduet vise en tekst, der er aeldre end
   * den, man lige har skrevet - i det vindue, man aabnede for at se den.
   */
  const spor = popUd();
  assert.ok(spor.indexOf('gemNu') > -1, 'der gemmes slet ikke');
  assert.ok(spor.indexOf('gemNu') < spor.findIndex((s) => s.startsWith('open ')),
    `gemningen skal ligge foerst: ${spor.join(' | ')}`);
});

test('et blokeret vindue siger det - og kaster ikke', () => {
  const spor = popUd({ blokeret: true });
  assert.ok(spor.some((s) => /^toast .*pop-ups/i.test(s)),
    `brugeren fik ingen forklaring: ${spor.join(' | ')}`);
  assert.ok(!spor.includes('focus'), 'der kaldes focus paa et vindue, der ikke findes');
});

test('vinduet hentes FREM, naar det allerede staar der', () => {
  // Uden `focus()` sker der tilsyneladende ingenting, anden gang man trykker:
  // vinduet findes, men ligger bag hovedvinduet.
  assert.ok(popUd().includes('focus'));
});

/* ================================================ form paa kilden ======= */

test('body.solo staar paa SAMME regel som body.fokus', () => {
  /*
   * De to tilstande skjuler den samme ramme. Stod de i hver sin regel, ville
   * de drive fra hinanden den dag, nogen skjuler ét element mere i fokus - og
   * sidevinduet ville faa det med maaneder senere, hvis nogen huskede det.
   */
  const i = css.indexOf('body.fokus .sidebar');
  assert.ok(i > -1, 'fokus-reglen findes ikke laengere - ret proeven');
  const regel = css.slice(i, css.indexOf('}', i));
  for (const del of ['.sidebar', '.navtoggle', '.krummer', '.backlinks']) {
    assert.ok(regel.includes(`body.solo ${del}`),
      `body.solo mangler paa ${del} - de to lister er drevet fra hinanden`);
  }
});

test('sidevinduet beholder soegefeltet - ellers er det en blindgyde', () => {
  /*
   * Klikker man paa et maerke i et sidevindue, lander man paa en liste. Uden
   * sidebar OG uden soegefelt er der ingen vej videre derfra.
   */
  assert.ok(!/body\.solo[^{]*\.topbar[^{]*\{[^}]*display:\s*none/.test(css),
    'topbaren er skjult i solo - saa er vinduet en blindgyde');
  assert.ok(!/body\.solo[^{]*\.omni-field[^{]*\{[^}]*display:\s*none/.test(css),
    'soegefeltet er skjult i solo');
  // Tastaturhintene under feltet maa derimod gerne gaa - de er en huskeseddel.
  assert.match(css, /body\.solo \.omni-legend\s*\{\s*display:\s*none/);
});

test('pop-ud staar FOER det foerste await i menuens handler', () => {
  /*
   * `window.open` skal koere i samme hop som klikket, ellers er
   * brugerhandlingen brugt op, og browseren blokerer vinduet. Ét `await`
   * foran ville vaere nok - og fejlen ville vise sig som »der sker ingenting«,
   * kun hos den, der har en langsom forbindelse.
   */
  const i = p4.indexOf("if (hvad === 'popud')");
  assert.ok(i > -1, 'popud-grenen findes ikke');
  const start = p4.lastIndexOf('async () => {', i);
  assert.ok(start > -1 && start < i, 'popud staar ikke i menuens handler');
  const foer = p4.slice(start, i);
  assert.ok(!foer.includes('await '), `der ventes paa noget foer popud:\n${foer.slice(-200)}`);
});

test('punktet er skjult i et vindue, der ALLEREDE er poppet ud', () => {
  // En knap, der aabner det vindue, man staar i, er ikke en knap.
  const i = p4.indexOf("data-do=\"popud\"");
  const linje = p4.slice(p4.lastIndexOf('\n', i), i);
  assert.match(linje, /soloVindue\(\)\s*\?\s*''\s*:/,
    'pop-ud-punktet vises ogsaa i et sidevindue');
});
