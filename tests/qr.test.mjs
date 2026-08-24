/*
 * QR-koden.
 *
 * Den kan ikke scannes af en test, saa den proeves i tre lag:
 *
 *  1. **Reed-Solomon mod standardens egne generator-polynomier** (Annex A).
 *     En kodning, der kun er enig med sig selv, er ikke bevist.
 *  2. **Strukturen**: finder-moenstre, adskillere, timing og den faste soerte
 *     modul. En scanner leder efter praecis dem, foer den ser paa data.
 *  3. **En AFKODER**, der laeser koden tilbage. Den fanger det, oejet ikke
 *     kan se: en maske, der ikke fjernes rigtigt, data lagt én plads forkert,
 *     eller blokke, der er flettet i forkert raekkefoelge.
 *
 * Det sidste lag er stadig min egen forstaaelse af standarden begge veje. Den
 * endelige proeve er en rigtig telefon - og den staar i README'en som noget,
 * ejeren skal goere.
 */

import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const ROD = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const Q = require(join(ROD, 'app', 'qr.js'));

test('Reed-Solomon passer med standardens generator-polynomier', () => {
  assert.deepEqual(Q.generator(7), [1, 127, 122, 154, 164, 11, 68, 117]);
  assert.deepEqual(Q.generator(10), [1, 216, 194, 159, 111, 199, 94, 95, 113, 157, 193]);
  assert.deepEqual(Q.generator(16),
    [1, 59, 13, 104, 189, 68, 209, 30, 8, 163, 65, 41, 229, 98, 50, 36, 59]);
});

test('strukturen er, hvad en scanner leder efter', () => {
  const { modules: m, size: n } = Q.lavQr('otpauth://totp/Sagu:test?secret=ABCDEFGHIJKLMNOP');

  for (const [fr, fc] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    // Ydre ring soert, indre ring hvid, kerne soert.
    for (let i = 0; i < 7; i++) {
      assert.equal(m[fr][fc + i], 1, 'finder-moensterets top');
      assert.equal(m[fr + 6][fc + i], 1, 'finder-moensterets bund');
    }
    assert.equal(m[fr + 1][fc + 1], 0, 'den hvide ring');
    assert.equal(m[fr + 3][fc + 3], 1, 'kernen');
  }
  // Timing: stiplet fra 8 til n-9, altid startende paa soert.
  for (let i = 8; i < n - 8; i++) {
    assert.equal(m[6][i], i % 2 === 0 ? 1 : 0, `vandret timing ved ${i}`);
    assert.equal(m[i][6], i % 2 === 0 ? 1 : 0, `lodret timing ved ${i}`);
  }
  assert.equal(m[n - 8][8], 1, 'den faste soerte modul');
  // Ingen plads maa staa uudfyldt.
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    assert.notEqual(m[r][c], null, `hul ved ${r},${c}`);
  }
});

/* ---------------------------------------------------- afkoderen ------ */

/** Laeser en QR fra `lavQr` tilbage til tekst. Kun byte-mode, niveau M. */
function afkod(kode) {
  const { modules: g, size: n } = kode;

  // Format-informationen sidder ved det oeverste venstre finder-moenster.
  // Bit 14 staar FOERST - se kommentaren i saetFormat().
  let fmt = 0;
  for (let i = 0; i <= 5; i++) fmt |= g[8][i] << (14 - i);
  fmt |= g[8][7] << 8;
  fmt |= g[8][8] << 7;
  fmt |= g[7][8] << 6;
  for (let i = 9; i <= 14; i++) fmt |= g[14 - i][8] << (14 - i);
  fmt ^= 0b101010000010010;
  const maske = (fmt >> 10) & 0b111;
  const niveau = (fmt >> 13) & 0b11;
  assert.equal(niveau, 0b00, 'niveau M');

  const MASKER = [
    (r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
  ];

  const v = (n - 17) / 4;
  const JUST = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] }[v];
  const reserveret = new Set();
  for (let i = 0; i < 9; i++) { reserveret.add(`8,${i}`); reserveret.add(`${i},8`); }
  for (let i = 0; i < 8; i++) { reserveret.add(`8,${n - 1 - i}`); reserveret.add(`${n - 1 - i},8`); }
  // Versionsinformationen fra version 7. Sprang afkoderen den over paa samme
  // maade som koderen, ville begge vaere enige om noget forkert - derfor er
  // den ogsaa proevet for sig nedenfor.
  if (v >= 7) {
    for (let i = 0; i < 6; i++) for (let k = 0; k < 3; k++) {
      reserveret.add(`${i},${n - 11 + k}`);
      reserveret.add(`${n - 11 + k},${i}`);
    }
  }
  const fast = (r, c) => {
    if (reserveret.has(`${r},${c}`)) return true;
    if (r === 6 || c === 6) return true;
    for (const [fr, fc] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
      if (r >= fr - 1 && r <= fr + 7 && c >= fc - 1 && c <= fc + 7) return true;
    }
    for (const rr of JUST) for (const cc of JUST) {
      if ((rr <= 8 && cc <= 8) || (rr <= 8 && cc >= n - 9) || (rr >= n - 9 && cc <= 8)) continue;
      if (Math.abs(r - rr) <= 2 && Math.abs(c - cc) <= 2) return true;
    }
    return false;
  };

  // Samme zigzag som ved kodningen, med masken fjernet undervejs.
  const bits = [];
  let opad = true;
  for (let c = n - 1; c > 0; c -= 2) {
    if (c === 6) c--;
    for (let i = 0; i < n; i++) {
      const r = opad ? n - 1 - i : i;
      for (const dc of [0, 1]) {
        const col = c - dc;
        if (fast(r, col)) continue;
        bits.push(g[r][col] ^ (MASKER[maske](r, col) ? 1 : 0));
      }
    }
    opad = !opad;
  }

  const bytes = [];
  for (let i = 0; i + 7 < bits.length; i += 8) {
    let b = 0;
    for (let k = 0; k < 8; k++) b = (b << 1) | bits[i + k];
    bytes.push(b);
  }

  // Flet blokkene fra hinanden igen.
  const M = { 1: [10, 1, 16, 0, 0], 2: [16, 1, 28, 0, 0], 3: [26, 1, 44, 0, 0],
    4: [18, 2, 32, 0, 0], 5: [24, 2, 43, 0, 0], 6: [16, 4, 27, 0, 0],
    7: [18, 4, 31, 0, 0], 8: [22, 2, 38, 2, 39], 9: [22, 3, 36, 2, 37],
    10: [26, 4, 43, 1, 44] }[v];
  const [, b1, d1, b2, d2] = M;
  const laengder = [...Array(b1).fill(d1), ...Array(b2).fill(d2)];
  const blokke = laengder.map(() => []);
  let p = 0;
  for (let i = 0; i < Math.max(...laengder); i++) {
    for (let bi = 0; bi < blokke.length; bi++) {
      if (i < laengder[bi]) blokke[bi].push(bytes[p++]);
    }
  }
  const data = blokke.flat();

  // Byte-mode: 4 bit tilstand, 8/16 bit laengde, saa selve teksten.
  const db = [];
  for (const b of data) for (let i = 7; i >= 0; i--) db.push((b >> i) & 1);
  const tag = (start, antal) => {
    let x = 0;
    for (let i = 0; i < antal; i++) x = (x << 1) | db[start + i];
    return x;
  };
  assert.equal(tag(0, 4), 0b0100, 'byte-tilstand');
  const lb = v < 10 ? 8 : 16;
  const laengde = tag(4, lb);
  const ud = [];
  for (let i = 0; i < laengde; i++) ud.push(tag(4 + lb + i * 8, 8));
  return Buffer.from(ud).toString('utf8');
}

test('koden kan læses tilbage - en rigtig otpauth-adresse', () => {
  const uri = 'otpauth://totp/Sagu:andreas?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
    + '&issuer=Sagu&algorithm=SHA1&digits=6&period=30';
  assert.equal(afkod(Q.lavQr(uri)), uri);
});

test('kan læses tilbage i flere størrelser', () => {
  for (const tekst of ['a', 'otpauth://totp/x:y?secret=ABCDEFGH', 'æøå — unicode klarer sig også',
    'x'.repeat(100), 'y'.repeat(150)]) {
    assert.equal(afkod(Q.lavQr(tekst)), tekst, `mislykkedes for ${tekst.length} tegn`);
  }
});

test('for lang tekst siger fra i stedet for at lave en ulæselig kode', () => {
  assert.throws(() => Q.lavQr('z'.repeat(400)), /for lang/);
});

test('SVG har en hvid kant - uden den kan en scanner ikke finde koden', () => {
  const svg = Q.tilSvg('otpauth://totp/a:b?secret=ABCD');
  assert.match(svg, /^<svg /);
  assert.match(svg, /<rect width="\d+" height="\d+" fill="#fff"\/>/);
  const vb = svg.match(/viewBox="0 0 (\d+) \1"/);
  assert.ok(vb, 'kvadratisk viewBox');
  const { size } = Q.lavQr('otpauth://totp/a:b?secret=ABCD');
  assert.equal(Number(vb[1]), size + 8, 'fire moduler stille zone hele vejen rundt');
});

/*
 * Format-informationen staar TO steder, og en scanner maa laese hvilken som
 * helst af dem. Afkoderen ovenfor laeser kun den FOERSTE - og var derfor
 * groen, mens den anden kopi var forskudt én plads og efterlod et hul.
 *
 * Derfor denne: laes den anden kopi for sig, og krav at de er ENS.
 */
test('begge kopier af format-informationen siger det samme', () => {
  for (const tekst of ['a', 'otpauth://totp/Sagu:andreas?secret=GEZDGNBVGY3TQOJQ', 'x'.repeat(120)]) {
    const { modules: g, size: n } = Q.lavQr(tekst);

    let en = 0;
    for (let i = 0; i <= 5; i++) en |= g[8][i] << (14 - i);
    en |= g[8][7] << 8;
    en |= g[8][8] << 7;
    en |= g[7][8] << 6;
    for (let i = 9; i <= 14; i++) en |= g[14 - i][8] << (14 - i);

    let to = 0;
    for (let i = 0; i <= 6; i++) to |= g[n - 1 - i][8] << (14 - i);
    for (let i = 7; i <= 14; i++) to |= g[8][n - 15 + i] << (14 - i);

    assert.equal(to, en, `de to kopier skal vaere ens (n=${n})`);
    // Og BCH-koden skal gaa op: resten er nul for et gyldigt format.
    let rest = (en ^ 0b101010000010010) << 0;
    for (let i = 14; i >= 10; i--) if ((rest >> i) & 1) rest ^= 0b10100110111 << (i - 10);
    assert.equal(rest & 0b1111111111, 0, 'BCH-koden skal passe');
  }
});

/*
 * Versionsinformationen (version >= 7).
 *
 * DEN her er grunden til, at en QR kan se helt rigtig ud og alligevel ikke
 * kunne scannes: feltet manglede, og en afkoder, jeg selv har skrevet,
 * opdagede det ikke - den sprang bare den samme plads over som koderen.
 * Fejlen fandtes foerst med en rigtig telefon.
 */
test('version 7 og opefter bærer versionsinformation', () => {
  // Kort tekst -> lav version: feltet skal IKKE vaere der.
  const lille = Q.lavQr('a');
  assert.ok(lille.version < 7);

  const stor = Q.lavQr('otpauth://totp/Sagu:andreas?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
    + '&issuer=Sagu&algorithm=SHA1&digits=6&period=30');
  assert.ok(stor.version >= 7, `forventede version 7+, fik ${stor.version}`);

  const { modules: g, size: n, version: v } = stor;
  // Begge blokke skal staa der, og de skal sige det samme.
  let a = 0;
  let b = 0;
  for (let i = 0; i < 18; i++) {
    a |= g[Math.floor(i / 3)][n - 11 + (i % 3)] << i;
    b |= g[n - 11 + (i % 3)][Math.floor(i / 3)] << i;
  }
  assert.equal(a, b, 'de to blokke skal vaere ens');
  assert.equal(a >> 12, v, 'versionsnummeret skal kunne laeses ud af koden');
  // BCH-koden skal gaa op.
  let rest = a;
  for (let i = 17; i >= 12; i--) if ((rest >> i) & 1) rest ^= 0b1111100100101 << (i - 12);
  assert.equal(rest & 0xfff, 0, 'BCH-koden skal passe');
});

/* =============== den uafhaengige dom: macOS' egen afkoder ============== */

/*
 * Afkoderen ovenfor er MIN. Den var groen, mens format-informationen stod i
 * omvendt bit-raekkefoelge - fordi den laeste forkert paa praecis samme maade,
 * som koderen skrev. Alt passede med sig selv, og ingen telefon kunne laese
 * koden.
 *
 * Derfor denne: macOS' CIDetector laeser koden, som en telefon ville. Findes
 * `swift` ikke (Linux, CI), springes den over med en tydelig besked - en test,
 * der stiltiende ikke koerer, er værre end ingen test.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const harSwift = spawnSync('which', ['swift']).status === 0;

/** Skriver matricen som PBM - et format, man kan lave i ti linjer. */
function skrivPbm(kode, sti) {
  const { modules: m, size: n } = kode;
  const q = 4;
  const s = 8;
  const bred = (n + q * 2) * s;
  const linjer = [];
  for (let y = 0; y < bred; y++) {
    const r = Math.floor(y / s) - q;
    const raekke = [];
    for (let x = 0; x < bred; x++) {
      const c = Math.floor(x / s) - q;
      const inde = r >= 0 && r < n && c >= 0 && c < n;
      raekke.push(inde && m[r][c] ? 1 : 0);
    }
    linjer.push(raekke.join(' '));
  }
  writeFileSync(sti, `P1\n${bred} ${bred}\n${linjer.join('\n')}\n`);
}

test('macOS kan læse koden — den prøve, min egen afkoder ikke kan give', { skip: !harSwift && 'swift findes ikke her' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'doda-qr-'));
  try {
    const proever = [
      'a',
      'otpauth://totp/Sagu:a?secret=ABCDEFGH',
      'otpauth://totp/Sagu:andreas?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Sagu',
      'otpauth://totp/Sagu:andreas?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
        + '&issuer=Sagu&algorithm=SHA1&digits=6&period=30',
      'x'.repeat(150),
    ];
    for (const tekst of proever) {
      const kode = Q.lavQr(tekst);
      const pbm = join(dir, 'q.pbm');
      skrivPbm(kode, pbm);
      const ud = execFileSync('swift',
        [join(ROD, 'tests', 'hjaelp', 'qrlaes.swift'), pbm], { encoding: 'utf8' }).trim();
      assert.equal(ud, tekst, `version ${kode.version} kunne ikke laeses`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/*
 * Niveauet skal staa som M (0b00) i format-informationen.
 *
 * Stod bitsene omvendt, meldte koden et andet niveau, end den var kodet med -
 * og saa giver enhver scanner op. Fejlen blev fundet ved at holde fire
 * niveauer fra macOS' egen koder op mod standardens facit: 1/0/3/2.
 */
test('format-informationen melder niveau M', () => {
  const { modules: g } = Q.lavQr('otpauth://totp/Sagu:a?secret=ABCDEFGH');
  let fmt = 0;
  for (let i = 0; i <= 5; i++) fmt |= g[8][i] << (14 - i);
  fmt |= g[8][7] << 8;
  fmt |= g[8][8] << 7;
  fmt |= g[7][8] << 6;
  for (let i = 9; i <= 14; i++) fmt |= g[14 - i][8] << (14 - i);
  fmt ^= 0b101010000010010;
  assert.equal((fmt >> 13) & 3, 0b00, 'niveau M — L=01, M=00, Q=11, H=10');
});
