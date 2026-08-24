/*
 * F21 - totrinsbekræftelse.
 *
 * To lag: selve algoritmen (RFC 6238) og de regler, serveren lægger ovenpå.
 *
 * ── Dommeren er skrevet af nogen andre ────────────────────────────────────
 *
 * Algoritmen prøves mod RFC'ens EGNE testvektorer. En implementering, der kun
 * er enig med sig selv, er ikke bevist — den kan være konsekvent forkert, og
 * så virker koden i alt undtagen den authenticator-app, den er til for.
 *
 * ── Og det, doda ikke kunne komme til at tage fejl af ─────────────────────
 *
 * Byggeklodsen er kopieret fra doda, som er ÉNBRUGER. Dér kan hemmeligheden,
 * kontakten og koderne ligge globalt. Sagu er flerbruger, og så er den
 * farligste fejl en, doda aldrig kunne lave: at alices andet led spærrer for
 * bob, eller at bobs afslåede led lukker alice ind uden. Derfor står den
 * prøve først blandt serverens regler.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { startServer, klient } from './hjaelp.mjs';

const ROD = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const T = require(join(ROD, 'app', 'totp.js'));

let srv;
let a;      // alice - slaar 2FA til
let b;      // bob - goer ikke
let hemA;
let koderA;

const kodeNu = (hem) => T.kodeFor(hem, Math.floor(Date.now() / 1000 / 30));

/**
 * Glem, at det nuværende vindue er brugt.
 *
 * Serveren brænder det vindue, en kode kom fra — det er hele genbrugsspærren
 * — så to logins i samme test kan ikke bruge samme kode, og en test kan ikke
 * vente et halvt minut på det næste vindue.
 *
 * Første forsøg var en hjælper, der lagde ét vindue til. Den var forkert:
 * `tjek()` godtager kun ét vindue til hver side (RFC), så vindue +2 er ikke
 * en kode — og prøven faldt på sin egen hjælper i stedet for på koden.
 *
 * Her rykkes derfor kun URET-hukommelsen; selve reglen røres ikke. Den prøve,
 * der måler genbrugsspærren, bruger den med vilje IKKE.
 */
function glemVindue(brugerId) {
  const db = new DatabaseSync(join(srv.dataDir, 'sagu.db'));
  try {
    db.prepare('DELETE FROM settings WHERE scope = ? AND key = ?').run(brugerId, 'totp_last');
  } finally { db.close(); }
}

let aliceId;

before(async () => {
  srv = await startServer();
  a = klient(srv.base);
  b = klient(srv.base);
  aliceId = (await a.opret('alice', 'kodeord-1234')).id;
  await a.kald('POST', '/api/v1/admin', { allowRegistration: true });
  await b.opret('bob', 'kodeord-1234');
});

after(() => srv.stop());

/* ------------------------------------------------ algoritmen (RFC 6238) */

test('RFC 6238s egne testvektorer passer', () => {
  // Hemmeligheden fra RFC'ens Appendix B. Facit er 8-cifret; vi laver 6.
  const hem = T.base32(Buffer.from('12345678901234567890', 'utf8'));
  const facit = [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'],
    [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']];
  for (const [tid, otte] of facit) {
    assert.equal(T.kodeFor(hem, Math.floor(tid / 30)), otte.slice(-6), `T=${tid}`);
  }
});

test('base32 er uden polstring — ellers afviser apps hemmeligheden', () => {
  assert.ok(!T.nyHemmelighed().includes('='));
  assert.match(T.nyHemmelighed(), /^[A-Z2-7]{32}$/);
});

test('et vindue til hver side godtages — men ikke to', () => {
  const hem = T.nyHemmelighed();
  const nu = Date.now();
  const c = Math.floor(nu / 1000 / 30);
  assert.ok(T.tjek(hem, T.kodeFor(hem, c), nu) !== null, 'nu');
  assert.ok(T.tjek(hem, T.kodeFor(hem, c - 1), nu) !== null, 'vinduet foer');
  assert.ok(T.tjek(hem, T.kodeFor(hem, c + 1), nu) !== null, 'vinduet efter');
  assert.equal(T.tjek(hem, T.kodeFor(hem, c - 2), nu), null, 'to vinduer tilbage er for meget');
});

test('vrøvl er ikke en kode', () => {
  const hem = T.nyHemmelighed();
  for (const k of ['', '12345', '1234567', 'abcdef', null, undefined]) {
    assert.equal(T.tjek(hem, k), null, JSON.stringify(k));
  }
});

test('udstederen står BÅDE i stien og som parameter', () => {
  // Uden det foerste hedder kontoen bare »alice« i appens liste, og har man
  // to runer, kan de ikke kendes fra hinanden.
  const uri = T.otpauth(T.nyHemmelighed(), 'alice', 'Sagu');
  assert.match(uri, /^otpauth:\/\/totp\/Sagu:alice\?/);
  assert.match(uri, /issuer=Sagu/);
  assert.match(uri, /algorithm=SHA1/, 'apps regner med SHA1, uanset hvor gammelt det ser ud');
});

/* ------------------------------------------------- opsætningen */

test('opsætningen giver en QR, men slår INTET til endnu', async () => {
  const d = (await a.kald('POST', '/api/v1/totp/setup', {})).data;
  hemA = d.secret;
  assert.match(d.secret, /^[A-Z2-7]{32}$/);
  assert.match(d.uri, /^otpauth:\/\/totp\/Sagu:alice\?/);
  assert.match(d.svg, /^<svg /, 'inline SVG - intet billede at hente');
  assert.match(d.svg, /crispEdges/, 'uden den udtvaerer browseren modulerne');

  const st = (await a.kald('GET', '/api/v1/totp')).data;
  assert.equal(st.enabled, false, 'en fejlscanning maa ikke kunne laase ejeren ude');
  assert.equal(st.pending, true);
});

/*
 * Den QR, ENDEPUNKTET sender, skal kunne læses af en rigtig scanner.
 *
 * `tests/qr.test.mjs` beviser, at generatoren er rigtig — men den kalder
 * `tilSvg` selv, og korrekt. Serveren gjorde det FORKERT: den gav `tilSvg`
 * resultatet af `lavQr` i stedet for teksten, og så indeholdt koden strengen
 * »[object Object]«. Femten tegn, en pæn lille kode, og fuldstændig
 * ubrugelig — den så rigtig ud i browseren, og manuel indtastning virkede, så
 * hele opsætningsforløbet bestod.
 *
 * En enhedstest kan ikke fange et forkert kaldested. Denne prøve læser derfor
 * det, endepunktet FAKTISK sender, og kræver adressen tilbage — dommeren er
 * macOS' egen afkoder, ikke min.
 */
const harSwift = spawnSync('which', ['swift']).status === 0;

test('QR-koden fra endepunktet kan læses af macOS — og bærer den rigtige adresse',
  { skip: !harSwift && 'swift findes ikke her' }, async () => {
    const d = (await a.kald('POST', '/api/v1/totp/setup', {})).data;
    hemA = d.secret;

    // Modulerne laeses ud af den SVG, serveren sendte - ikke af generatoren.
    const punkter = [...d.svg.matchAll(/M(\d+) (\d+)h1v1h-1z/g)]
      .map((m) => [Number(m[2]), Number(m[1])]);
    assert.ok(punkter.length > 50, 'der ER moduler i svaret');
    const kant = Math.max(...punkter.flat()) + 5;

    const dir = mkdtempSync(join(tmpdir(), 'saguqr-'));
    try {
      const S = 4;
      const bred = kant * S;
      const saet = new Set(punkter.map(([r, c]) => `${r},${c}`));
      const linjer = [];
      for (let y = 0; y < bred; y++) {
        let r = '';
        for (let x = 0; x < bred; x++) {
          r += saet.has(`${Math.floor(y / S)},${Math.floor(x / S)}`) ? '1 ' : '0 ';
        }
        linjer.push(r.trim());
      }
      const sti = join(dir, 'q.pbm');
      writeFileSync(sti, `P1\n${bred} ${bred}\n${linjer.join('\n')}\n`);
      const laest = execFileSync('swift',
        [join(ROD, 'tests', 'hjaelp', 'qrlaes.swift'), sti], { encoding: 'utf8' }).trim();
      assert.equal(laest, d.uri, 'koden skal baere adressen - ikke »[object Object]«');
      assert.match(laest, new RegExp(`secret=${d.secret}`));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

test('en forkert kode slår det ikke til', async () => {
  const r = await a.kald('POST', '/api/v1/totp/enable', { code: '000000' });
  assert.equal(r.status, 401);
  assert.equal((await a.kald('GET', '/api/v1/totp')).data.enabled, false);
});

test('en kode der passer slår det til — og giver ti nødkoder', async () => {
  const r = await a.kald('POST', '/api/v1/totp/enable', { code: kodeNu(hemA) });
  assert.equal(r.status, 200);
  koderA = r.data.recovery;
  assert.equal(koderA.length, 10, 'uden noedkoder laaser en mistet telefon ejeren ude for altid');
  assert.equal(new Set(koderA).size, 10);
  const st = (await a.kald('GET', '/api/v1/totp')).data;
  assert.deepEqual([st.enabled, st.pending, st.recoveryLeft], [true, false, 10]);
});

/* ------------------------------------------------- porten ved login */

test('kodeordet alene giver INGEN cookie, når der er et andet led', async () => {
  /*
   * Porten skal ligge FØR sessionen udstedes. Udstedte vi cookien først og
   * spurgte bagefter, var 2FA'en en formalitet: den, der har kodeordet, var
   * allerede inde.
   */
  const g = klient(srv.base);
  const r = await g.kald('POST', '/api/login', { username: 'alice', password: 'kodeord-1234' });
  assert.equal(r.status, 200);
  assert.equal(r.data.needsCode, true);
  assert.equal(r.data.user, undefined, 'ingen bruger i svaret');
  assert.equal(g.cookie, '', 'og ingen cookie');
  assert.equal((await g.kald('GET', '/api/me')).data.user, null, 'stadig udenfor');
});

test('en forkert ENGANGSKODE og et forkert KODEORD svarer forskelligt', async () => {
  // Fladen skelner paa `needsCode`: kodefeltet bliver staaende ved det ene og
  // foldes vaek ved det andet.
  const g = klient(srv.base);
  const kode = await g.kald('POST', '/api/login',
    { username: 'alice', password: 'kodeord-1234', code: '000000' });
  assert.equal(kode.status, 401);
  assert.equal(kode.data.needsCode, true);

  const ord = await g.kald('POST', '/api/login', { username: 'alice', password: 'helt-forkert' });
  assert.equal(ord.status, 401);
  assert.equal(ord.data.needsCode, undefined, 'et forkert kodeord roeber ikke, at der er 2FA paa');
});

test('kodeord plus kode lukker ind', async () => {
  const g = klient(srv.base);
  glemVindue(aliceId);
  const r = await g.kald('POST', '/api/login',
    { username: 'alice', password: 'kodeord-1234', code: kodeNu(hemA) });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.username, 'alice');
  assert.equal((await g.kald('GET', '/api/me')).data.user.username, 'alice');
});

test('den SAMME kode kan ikke bruges to gange', async () => {
  /*
   * `tjek()` returnerer det vindue, koden kom fra — ikke `true` — og serveren
   * brænder det. Uden det kan en opsnappet kode bruges igen inden for det
   * halve minut. Denne prøve bruger med vilje ikke `nyKode()`.
   */
  glemVindue(aliceId);
  const kode = kodeNu(hemA);
  const en = klient(srv.base);
  assert.equal((await en.kald('POST', '/api/login',
    { username: 'alice', password: 'kodeord-1234', code: kode })).status, 200);

  const to = klient(srv.base);
  const r = await to.kald('POST', '/api/login',
    { username: 'alice', password: 'kodeord-1234', code: kode });
  assert.equal(r.status, 401);
  assert.match(r.data.message, /already been used/);
  assert.equal(to.cookie, '');
});

/* ------------------------------------------------- nødudgangen */

test('en nødkode lukker ind — én gang, og kun én', async () => {
  const kode = koderA[0];
  const en = klient(srv.base);
  assert.equal((await en.kald('POST', '/api/login',
    { username: 'alice', password: 'kodeord-1234', code: kode })).status, 200);
  assert.equal((await a.kald('GET', '/api/v1/totp')).data.recoveryLeft, 9, 'én er brugt op');

  const to = klient(srv.base);
  assert.equal((await to.kald('POST', '/api/login',
    { username: 'alice', password: 'kodeord-1234', code: kode })).status, 401,
  'raekken bliver staaende som brugt - en noedkode kan ikke gaa om');
});

/* ------------------------------------------------- FLERBRUGER */

test('alices andet led rører ikke bob', async () => {
  /*
   * Den prøve doda ikke kunne skrive. Alt hører til KONTOEN: en global
   * kontakt ville enten spærre for bob eller lukke alice ind uden sit andet
   * led — og begge dele ser rigtige ud, indtil den anden bruger prøver.
   */
  assert.equal((await b.kald('GET', '/api/v1/totp')).data.enabled, false);

  const g = klient(srv.base);
  const r = await g.kald('POST', '/api/login', { username: 'bob', password: 'kodeord-1234' });
  assert.equal(r.status, 200, 'bob logger ind som altid');
  assert.equal(r.data.user.username, 'bob');
  assert.equal(r.data.needsCode, undefined);

  // ... og bobs nødkoder findes ikke, selv om alices gør.
  assert.equal((await b.kald('GET', '/api/v1/totp')).data.recoveryLeft, 0);
});

test('alices nødkode virker ikke på bobs konto', async () => {
  const g = klient(srv.base);
  const r = await g.kald('POST', '/api/login',
    { username: 'bob', password: 'kodeord-1234', code: koderA[1] });
  // Bob har intet andet led, saa koden er bare stoej - han lukkes ind paa sit
  // kodeord. Det farlige ville vaere, hvis koden TALTE som brugt hos alice.
  assert.equal(r.status, 200);
  assert.equal((await a.kald('GET', '/api/v1/totp')).data.recoveryLeft, 9,
    'alices koder er uroerte');
});

/* ------------------------------------------------- hemmeligheden */

test('hemmeligheden forlader ALDRIG serveren efter opsætningen', async () => {
  /*
   * TOTP-hemmeligheden ER det andet led. Kan den læses ud gennem en eksport
   * eller et indstillings-kald, er hele 2FA'en pynt.
   */
  const st = (await a.kald('GET', '/api/v1/totp')).data;
  assert.equal(st.secret, undefined);
  assert.equal(st.uri, undefined);

  /*
   * `?format=json` er ikke en detalje.
   *
   * Første udgave af denne prøve hentede eksporten UDEN format. Standarden er
   * en ZIP, så svaret kunne ikke læses som JSON, `data` var `null`, og prøven
   * bekræftede glad, at hemmeligheden ikke stod i strengen »null«.
   *
   * Den blev afsløret ved at sabotere: jeg fjernede `totp_secret` fra
   * `HEMMELIGE_SETTINGS` og fik NUL røde. En prøve, der ikke kan fejle, er
   * ikke en prøve. Derfor kræver den nu også, at der FAKTISK er indstillinger
   * i eksporten — ellers kan den falde tilbage i det samme.
   */
  const eksport = await a.kald('GET', '/api/v1/export?format=json&files=0');
  assert.equal(eksport.status, 200);
  assert.ok(Array.isArray(eksport.data.settings), 'eksporten HAR en settings-liste');
  await a.kald('POST', '/api/v1/doda', { url: 'http://127.0.0.1:9/x', key: 'hemmelig-vaerdi' })
    .catch(() => null);
  const medIndhold = await a.kald('GET', '/api/v1/export?format=json&files=0');
  const tekst = JSON.stringify(medIndhold.data);
  assert.ok(!tekst.includes(hemA), 'hemmeligheden staar ikke i eksporten');
  assert.ok(!/totp_secret/.test(tekst), 'og noeglen er heller ikke naevnt');
  assert.ok(!/totp_last/.test(tekst));
});

/* ------------------------------------------------- at slå det fra */

test('at slå 2FA fra kræver kodeordet', async () => {
  /*
   * En åben skærm er ellers nok: går man forbi en ulåst maskine, kan man
   * fjerne det andet led med ét klik — og så er 2FA'en kun en forhindring for
   * ejeren selv.
   */
  const r = await a.kald('POST', '/api/v1/totp/disable', { password: 'helt-forkert' });
  assert.equal(r.status, 401);
  assert.equal((await a.kald('GET', '/api/v1/totp')).data.enabled, true, 'stadig taendt');

  assert.equal((await a.kald('POST', '/api/v1/totp/disable',
    { password: 'kodeord-1234' })).status, 200);
  const st = (await a.kald('GET', '/api/v1/totp')).data;
  assert.deepEqual([st.enabled, st.pending, st.recoveryLeft], [false, false, 0],
    'hemmelighed OG noedkoder er vaek - ellers ville gamle koder virke ved naeste opsaetning');

  // ... og saa er login som foer.
  const g = klient(srv.base);
  const ind = await g.kald('POST', '/api/login', { username: 'alice', password: 'kodeord-1234' });
  assert.equal(ind.status, 200);
  assert.equal(ind.data.user.username, 'alice');
});

test('nye nødkoder kræver også kodeordet — og dræber de gamle', async () => {
  const setup = (await a.kald('POST', '/api/v1/totp/setup', {})).data;
  await a.kald('POST', '/api/v1/totp/enable', { code: kodeNu(setup.secret) });
  const foerste = (await a.kald('GET', '/api/v1/totp')).data.recoveryLeft;
  assert.equal(foerste, 10);

  assert.equal((await a.kald('POST', '/api/v1/totp/recovery',
    { password: 'helt-forkert' })).status, 401);

  const gamle = (await a.kald('POST', '/api/v1/totp/recovery',
    { password: 'kodeord-1234' })).data.recovery;
  assert.equal(gamle.length, 10);

  const nye = (await a.kald('POST', '/api/v1/totp/recovery',
    { password: 'kodeord-1234' })).data.recovery;
  assert.equal(nye.filter((k) => gamle.includes(k)).length, 0, 'helt nye koder');

  // De GAMLE maa ikke virke laengere.
  const g = klient(srv.base);
  assert.equal((await g.kald('POST', '/api/login',
    { username: 'alice', password: 'kodeord-1234', code: gamle[0] })).status, 401);

  await a.kald('POST', '/api/v1/totp/disable', { password: 'kodeord-1234' });
});

test('en NØGLE kan ikke røre 2FA — heller ikke en full-nøgle', async () => {
  // Samme regel som kodeordsskift: én laekket noegle maa ikke kunne fjerne
  // det andet led fra en konto.
  const noegle = (await a.kald('POST', '/api/v1/keys', { name: 'k', scope: 'full' })).data.key;
  for (const sti of ['/api/v1/totp', '/api/v1/totp/setup', '/api/v1/totp/disable']) {
    const r = await fetch(srv.base + sti, {
      method: sti === '/api/v1/totp' ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${noegle}`, 'Content-Type': 'application/json' },
      body: sti === '/api/v1/totp' ? undefined : JSON.stringify({ password: 'kodeord-1234' }),
    });
    assert.equal(r.status, 401, `${sti} svarede ${r.status}`);
  }
});
