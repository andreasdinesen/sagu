/*
 * Isolationstesten. Projektets vigtigste test i HVER fase - ikke kun én gang.
 *
 * To brugere, 404 overalt. Den skal have vaeret set FEJLE: fjern
 * `AND user_id = ?` (i Sagu: SYNLIG/SKRIVBAR i app/server.js) og koer igen -
 * uden roede tests beviser de groenne ingenting (RUNE-ERFARINGER, tovo F0).
 *
 * Grunden til at den koeres i hver fase, selv om der kun findes én bruger:
 * et flerbrugerlag kan ikke eftermonteres, og en isolationsfejl ser
 * fuldstaendig rigtig ud i alle tests med kun én konto.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, klient } from './hjaelp.mjs';

let srv;
let a;      // foerste bruger = admin
let b;      // anden bruger
let aNote;
let bNote;

before(async () => {
  srv = await startServer();
  a = klient(srv.base);
  b = klient(srv.base);

  const bruger = await a.opret('alice', 'kodeord-1234');
  assert.equal(bruger.isAdmin, true, 'foerste bruger skal vaere administrator');

  // Registrering er lukket som standard efter den foerste bruger - saa
  // aabnes den, for at kunne teste med to konti.
  const luk = await b.opret('bob', 'kodeord-1234').then(() => 'aabnede', () => 'lukket');
  if (luk === 'lukket') {
    await a.kald('POST', '/api/v1/admin', { allowRegistration: true });
    await b.opret('bob', 'kodeord-1234');
  }

  aNote = (await a.kald('POST', '/api/v1/notes', { title: 'Alices hemmelighed', body: '# Skjult\n\nnoget tekst' })).data.note;
  bNote = (await b.kald('POST', '/api/v1/notes', { title: 'Bobs hemmelighed', body: '# Ogsaa skjult' })).data.note;
});

after(() => srv.stop());

test('registrering er LUKKET som standard efter den foerste bruger', async () => {
  // Fravaer af indstillingen skal betyde lukket: en ny installation maa ikke
  // staa aaben for verden, fordi ingen har taget stilling.
  const srv2 = await startServer();
  try {
    const x = klient(srv2.base);
    await x.opret('foerste', 'kodeord-1234');
    const y = klient(srv2.base);
    const r = await y.kald('POST', '/api/register', { username: 'anden', password: 'kodeord-1234' });
    assert.equal(r.status, 403);
    assert.equal(r.data.error, 'registration_closed');
    // ... og listen over konti skal ikke have faaet en ny.
    const cfg = await y.kald('GET', '/api/public-config');
    assert.equal(cfg.data.allowRegistration, false, 'linket skal ogsaa vaere skjult, ikke kun ruten');
  } finally {
    srv2.stop();
  }
});

test('B kan ikke LAESE A note (404, ikke 403)', async () => {
  const r = await b.kald('GET', `/api/v1/notes/${aNote.id}`);
  // 404, ikke 403: en 403 ville bekraefte, at id'et findes, og saa kan man
  // aftaste hvilke id'er der er i brug.
  assert.equal(r.status, 404);
  assert.equal(r.data.error, 'not_found');
});

test('B kan ikke AENDRE As note', async () => {
  const r = await b.kald('PATCH', `/api/v1/notes/${aNote.id}`, { title: 'kapret' });
  assert.equal(r.status, 404);
  // ... og indholdet er uroert.
  const set = await a.kald('GET', `/api/v1/notes/${aNote.id}`);
  assert.equal(set.data.note.title, 'Alices hemmelighed');
});

test('B kan ikke SLETTE As note', async () => {
  const r = await b.kald('DELETE', `/api/v1/notes/${aNote.id}`);
  assert.equal(r.status, 404);
  assert.equal((await a.kald('GET', `/api/v1/notes/${aNote.id}`)).status, 200);
});

test('listen viser kun egne noter', async () => {
  const ra = await a.kald('GET', '/api/v1/notes');
  const rb = await b.kald('GET', '/api/v1/notes');
  assert.deepEqual(ra.data.notes.map((n) => n.id), [aNote.id]);
  assert.deepEqual(rb.data.notes.map((n) => n.id), [bNote.id]);
});

test('SOEGNINGEN kan ikke naa den anden brugers noter', async () => {
  // Den farligste vej ind: et FTS-indeks er faelles for hele installationen,
  // saa filteret skal ligge i forespoergslen - ikke i en visning bagefter.
  const r = await b.kald('GET', '/api/v1/search?q=hemmelighed');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.results.map((x) => x.id), [bNote.id]);
  assert.ok(!JSON.stringify(r.data).includes('Alices'), 'As titel maa ikke laekke gennem uddraget');
});

test('taellerne i /state er pr. bruger', async () => {
  const ra = await a.kald('GET', '/api/v1/state');
  const rb = await b.kald('GET', '/api/v1/state');
  assert.equal(ra.data.counts.notes, 1);
  assert.equal(rb.data.counts.notes, 1);
});

test('ADMIN er ingen undtagelse - alice ser ikke bobs note', async () => {
  // At vaere administrator betyder at maatte aendre INSTALLATIONEN, ikke at
  // maatte laese andres noter (CLAUDE.md).
  assert.equal((await a.kald('GET', `/api/v1/notes/${bNote.id}`)).status, 404);
  assert.equal((await a.kald('PATCH', `/api/v1/notes/${bNote.id}`, { title: 'x' })).status, 404);
  const s = await a.kald('GET', '/api/v1/search?q=Bobs');
  assert.equal(s.data.results.length, 0);
});

test('B er ikke administrator og kan ikke naa admin-ruterne', async () => {
  assert.equal((await b.kald('GET', '/api/v1/admin')).status, 403);
  assert.equal((await b.kald('POST', '/api/v1/admin', { allowRegistration: false })).status, 403);
});

test('en NOEGLE baerer sin egen user_id - den er ikke en universalnoegle', async () => {
  // Uden tokens.user_id ville enhver noegle ramme "foerste bruger i tabellen",
  // og isolationen ville vaere en illusion, der ser rigtig ud i alle tests
  // med kun én konto (RUNE-ERFARINGER, tovo F0/F8).
  const bNoegle = (await b.kald('POST', '/api/v1/keys', { name: 'bobs', scope: 'full' })).data.key;
  const udenCookie = { headers: { Authorization: `Bearer ${bNoegle}` }, udenCookie: true };

  const egen = await b.kald('GET', `/api/v1/notes/${bNote.id}`, undefined, udenCookie);
  assert.equal(egen.status, 200, 'bobs noegle skal naa bobs egen note');

  const fremmed = await b.kald('GET', `/api/v1/notes/${aNote.id}`, undefined, udenCookie);
  assert.equal(fremmed.status, 404, 'bobs noegle maa ALDRIG naa alices note');

  const liste = await b.kald('GET', '/api/v1/notes', undefined, udenCookie);
  assert.deepEqual(liste.data.notes.map((n) => n.id), [bNote.id]);
});

test('scopes maales UDEN cookie - ellers godkender sessionen alting', async () => {
  // Koerer testen med cookien i behold, ser scope-tjekket ud til at virke,
  // selv hvis det aldrig blev kaldt (RUNE-ERFARINGER, doda F2).
  const capture = (await a.kald('POST', '/api/v1/keys', { name: 'genvej', scope: 'capture' })).data.key;
  const read = (await a.kald('POST', '/api/v1/keys', { name: 'laes', scope: 'read' })).data.key;
  const som = (n) => ({ headers: { Authorization: `Bearer ${n}` }, udenCookie: true });

  // capture kan oprette ...
  assert.equal((await a.kald('POST', '/api/v1/notes', { title: 'fra genvej' }, som(capture))).status, 200);
  // ... men kan IKKE se noget som helst.
  assert.equal((await a.kald('GET', '/api/v1/notes', undefined, som(capture))).status, 403);
  assert.equal((await a.kald('GET', `/api/v1/notes/${aNote.id}`, undefined, som(capture))).status, 403);

  // read kan laese ...
  assert.equal((await a.kald('GET', '/api/v1/notes', undefined, som(read))).status, 200);
  // ... men ikke skrive.
  assert.equal((await a.kald('PATCH', `/api/v1/notes/${aNote.id}`, { title: 'x' }, som(read))).status, 403);
  assert.equal((await a.kald('DELETE', `/api/v1/notes/${aNote.id}`, undefined, som(read))).status, 403);
});

test('INGEN noegle kan administrere kontoen - heller ikke en med fuldt scope', async () => {
  // Ellers er én laekket noegle nok til at give sig selv fuld og varig adgang,
  // eller til at laase ejeren ude af sin egen app (RUNE-ERFARINGER, doda F2).
  const fuld = (await a.kald('POST', '/api/v1/keys', { name: 'fuld', scope: 'full' })).data.key;
  const som = { headers: { Authorization: `Bearer ${fuld}` }, udenCookie: true };

  const forbudte = [
    ['POST', '/api/password', { current: 'kodeord-1234', next: 'nyt-kodeord-9' }],
    ['POST', '/api/v1/keys', { name: 'endnu en', scope: 'full' }],
    ['GET', '/api/v1/keys', undefined],
    ['GET', '/api/v1/admin', undefined],
    ['POST', '/api/v1/admin', { allowRegistration: true }],
    ['GET', '/api/v1/passkeys', undefined],
  ];
  for (const [metode, sti, krop] of forbudte) {
    const r = await a.kald(metode, sti, krop, som);
    assert.equal(r.status, 401, `${metode} ${sti} skal kraeve en rigtig session, ikke en noegle`);
    assert.equal(r.data.error, 'not_signed_in');
  }
  // ... og kodeordet virker stadig.
  const c = klient(srv.base);
  assert.equal((await c.kald('POST', '/api/login', { username: 'alice', password: 'kodeord-1234' })).status, 200);
});

test('en tilbagekaldt noegle doer paa NAESTE kald - ingen cache at invalidere', async () => {
  const ny = await a.kald('POST', '/api/v1/keys', { name: 'kortvarig', scope: 'read' });
  const som = { headers: { Authorization: `Bearer ${ny.data.key}` }, udenCookie: true };
  assert.equal((await a.kald('GET', '/api/v1/notes', undefined, som)).status, 200);

  const liste = (await a.kald('GET', '/api/v1/keys')).data.keys;
  const id = liste.find((k) => k.name === 'kortvarig').id;
  assert.equal((await a.kald('DELETE', `/api/v1/keys/${id}`)).status, 200);

  assert.equal((await a.kald('GET', '/api/v1/notes', undefined, som)).status, 401);
});

test('en noegle kan ikke tilbagekalde en ANDEN brugers noegle', async () => {
  const bNoegler = (await b.kald('GET', '/api/v1/keys')).data.keys;
  assert.ok(bNoegler.length, 'bob har mindst én noegle');
  const r = await a.kald('DELETE', `/api/v1/keys/${bNoegler[0].id}`);
  assert.equal(r.status, 404);
  // ... og bobs noegle staar der stadig.
  assert.equal((await b.kald('GET', '/api/v1/keys')).data.keys.length, bNoegler.length);
});
