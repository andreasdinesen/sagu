/*
 * Dato- og tidsgenveje i skrivefeltet.
 *
 * »Jeg vil gerne have en shortcut til at kunne skrive dd-mm-yyyy og hh:mm«
 * (Andreas, 2026-09-02), og han valgte praefiks-formen: `/dmy` og `/hhmm`.
 *
 * ── Hvad proeverne maaler ─────────────────────────────────────────────────
 *
 * Ikke at en dato kan formateres. At genvejen ikke slaar til, naar den ikke
 * skal - det er dér, en teksterstatning goer skade. Den fejl er tavs: man
 * opdager den, naar noten allerede staar forkert.
 *
 * Funktionerne hentes UD af kilden og koeres. En afskrift ville proeve
 * afskriften.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const kilde = readFileSync(new URL('../app/parts/p4_editor.js', import.meta.url), 'utf8');

function hentGenveje() {
  const i = kilde.indexOf('const TEKSTGENVEJE = [');
  assert.ok(i > -1, 'TEKSTGENVEJE findes ikke');
  const slut = kilde.indexOf('\n];', i) + 3;
  // eslint-disable-next-line no-new-func
  return new Function(`${kilde.slice(i, slut)}\nreturn TEKSTGENVEJE;`)();
}

/**
 * `byttedeTekstgenvej` roerer et `<textarea>`. Her efterlignes kun de fire
 * ting, den bruger - resten af DOM'en har den ikke brug for.
 */
function felt(tekst, pos) {
  return {
    value: tekst,
    selectionStart: pos === undefined ? tekst.length : pos,
    selectionEnd: pos === undefined ? tekst.length : pos,
    setSelectionRange(a) { this.selectionStart = a; this.selectionEnd = a; },
    /*
     * Fjerde argument er ikke pynt.
     *
     * Foerste udgave af den her efterligning ignorerede `tilstand` og satte
     * altid markoeren til sidst - og saa kunne proeven ikke se, at koden
     * droppede `'end'`. Maalt: sabotagen gav GROENT. En efterligning, der er
     * mildere end virkeligheden, proever ingenting.
     */
    setRangeText(ny, a, b, tilstand) {
      this.value = this.value.slice(0, a) + ny + this.value.slice(b);
      this.setSelectionRange(tilstand === 'end' ? a + ny.length : a);
    },
  };
}

function hentBytter() {
  const i = kilde.indexOf('function byttedeTekstgenvej');
  assert.ok(i > -1, 'byttedeTekstgenvej findes ikke');
  const slut = kilde.indexOf('\n}', i) + 2;
  const genveje = kilde.slice(kilde.indexOf('const TEKSTGENVEJE = ['),
    kilde.indexOf('\n];', kilde.indexOf('const TEKSTGENVEJE = [')) + 3);
  // eslint-disable-next-line no-new-func
  return new Function(`${genveje}\n${kilde.slice(i, slut)}\nreturn byttedeTekstgenvej;`)();
}

const TEKSTGENVEJE = hentGenveje();
const byt = hentBytter();
const d = new Date(2026, 8, 2, 14, 32);   // 2. september 2026, 14:32

test('/dmy giver dd-mm-yyyy', () => {
  const g = TEKSTGENVEJE.find((x) => x.ord === '/dmy');
  assert.equal(g.lav(d), '02-09-2026');
});

test('/hhmm giver hh:mm', () => {
  const g = TEKSTGENVEJE.find((x) => x.ord === '/hhmm');
  assert.equal(g.lav(d), '14:32');
});

test('begge foranstilles med nul — ellers flytter kolonnerne sig', () => {
  const tidlig = new Date(2026, 0, 5, 9, 7);
  assert.equal(TEKSTGENVEJE.find((x) => x.ord === '/dmy').lav(tidlig), '05-01-2026');
  assert.equal(TEKSTGENVEJE.find((x) => x.ord === '/hhmm').lav(tidlig), '09:07');
});

test('genvejen bytter, naar den staar foerst paa linjen', () => {
  const f = felt('/dmy');
  assert.equal(byt(f), true);
  assert.match(f.value, /^\d{2}-\d{2}-\d{4}$/);
});

test('… og efter et mellemrum', () => {
  const f = felt('Taget /hhmm');
  assert.equal(byt(f), true);
  assert.match(f.value, /^Taget \d{2}:\d{2}$/);
});

test('… og paa en ny linje midt i en note', () => {
  const f = felt('Foerste linje\n/dmy');
  assert.equal(byt(f), true);
  assert.match(f.value, /^Foerste linje\n\d{2}-\d{2}-\d{4}$/);
});

test('MIDT i et ord bytter den ikke', () => {
  /*
   * Den vigtigste. En erstatning, der slaar til uden at man bad om den, er
   * vaerre end ingen genvej - man opdager den, naar noten staar forkert.
   */
  const f = felt('format/dmy');
  assert.equal(byt(f), false);
  assert.equal(f.value, 'format/dmy');
});

test('et ord uden skraatstreg bytter ikke', () => {
  const f = felt('dmy');
  assert.equal(byt(f), false);
  assert.equal(f.value, 'dmy');
});

test('den bytter kun det, markoeren staar lige efter', () => {
  // Markoeren staar midt i teksten, ikke ved genvejen.
  const f = felt('/dmy og mere', 3);
  assert.equal(byt(f), false);
  assert.equal(f.value, '/dmy og mere');
});

test('med en markering roeres der ingenting', () => {
  const f = felt('/dmy');
  f.selectionEnd = 2;
  assert.equal(byt(f), false);
});

test('markoeren staar EFTER det indsatte', () => {
  // Ellers skriver man videre midt inde i datoen.
  const f = felt('kl. /hhmm');
  byt(f);
  assert.equal(f.selectionStart, f.value.length);
});

test('en halv genvej bytter ikke', () => {
  for (const t of ['/dm', '/hh', '/', '/dmyy']) {
    const f = felt(t);
    assert.equal(byt(f), false, `${t} blev byttet`);
  }
});

test('hver genvej har et navn og et eksempel til hjaelpepanelet', () => {
  // Hjaelpen tegnes af den SAMME tabel. Uden de her felter staar der huller.
  for (const g of TEKSTGENVEJE) {
    assert.ok(g.navn && g.navn.length > 2, `${g.ord} mangler et navn`);
    assert.ok(typeof g.lav === 'function');
  }
});
