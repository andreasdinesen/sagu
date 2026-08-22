/*
 * Administratorens kodeordsnulstilling.
 *
 * ── Hvad testen egentlig måler ────────────────────────────────────────────
 *
 * Ikke at den virker. At den **nægter** — for det er dér, en sådan rute går
 * galt. En vej til at sætte et nyt kodeord på en fremmed konto er den
 * farligste rute i hele appen: den kan overtage alt, hvad serveren rummer, og
 * den ser fuldstændig rigtig ud, indtil nogen prøver den med en API-nøgle i
 * hånden.
 *
 * Derfor står de fem afslag først, og selve nulstillingen sidst.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, klient } from './hjaelp.mjs';

let srv;
let a;        // administratoren (den første konto)
let b;        // en almindelig bruger
let c;        // endnu en almindelig bruger
let bId;
let cId;

const sti = (id) => `/api/v1/admin/users/${id}/password`;

before(async () => {
  srv = await startServer();
  a = klient(srv.base);
  b = klient(srv.base);
  c = klient(srv.base);
  await a.opret('alice', 'kodeord-1234');
  await a.kald('POST', '/api/v1/admin', { allowRegistration: true });
  bId = (await b.opret('bob', 'kodeord-1234')).id;
  cId = (await c.opret('carol', 'kodeord-1234')).id;
});

after(() => srv.stop());

/* ============================== de fem afslag ========================== */

test('en NØGLE kan aldrig nulstille et kodeord — heller ikke en full-nøgle', async () => {
  /*
   * Den vigtigste af dem alle. Én lækket nøgle må ikke kunne overtage hver
   * eneste konto på serveren - og en nøgle er noget, man bærer rundt på i en
   * telefongenvej. Samme regel som `/api/password`, og den STÅR på
   * hjælpesiden: »No key can make another key or change your password — not
   * even full.«
   */
  const noegle = (await a.kald('POST', '/api/v1/keys', { name: 'k', scope: 'full' })).data.key;
  const r = await fetch(srv.base + sti(bId), {
    method: 'POST',
    headers: { Authorization: `Bearer ${noegle}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ next: 'noget-nyt-1234' }),
  });
  assert.equal(r.status, 401, 'en noegle er ikke en session');

  // ... og kodeordet virker stadig.
  const stadig = klient(srv.base);
  assert.equal((await stadig.kald('POST', '/api/login',
    { username: 'bob', password: 'kodeord-1234' })).status, 200);
});

test('en almindelig bruger kan ikke nulstille en andens kodeord', async () => {
  const r = await b.kald('POST', sti(cId), { next: 'noget-nyt-1234' });
  assert.equal(r.status, 403);
  assert.equal(r.data.error, 'not_admin');
});

test('uden nogen som helst legitimation er svaret 401', async () => {
  const r = await fetch(srv.base + sti(bId), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ next: 'noget-nyt-1234' }),
  });
  assert.equal(r.status, 401);
});

test('administratoren kan ikke nulstille sit EGET kodeord ad den vej', async () => {
  /*
   * En kapret admin-session ville ellers kunne sætte et nyt kodeord uden at
   * kende det gamle — og låse ejeren ude af sin egen server. Sit eget skifter
   * man under »Your account«, hvor det nuværende skal opgives.
   */
  const mig = (await a.kald('GET', '/api/me')).data.user;
  const r = await a.kald('POST', sti(mig.id), { next: 'noget-nyt-1234' });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'not_yourself');
});

test('et for kort kodeord afvises — og det gamle består', async () => {
  const r = await a.kald('POST', sti(bId), { next: 'kort' });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'bad_password');
  const stadig = klient(srv.base);
  assert.equal((await stadig.kald('POST', '/api/login',
    { username: 'bob', password: 'kodeord-1234' })).status, 200);
});

test('en konto, der ikke findes, siger det — og rører intet', async () => {
  const r = await a.kald('POST', sti('f'.repeat(32)), { next: 'noget-nyt-1234' });
  assert.equal(r.status, 404);
});

/* ============================== og så virkningen ======================= */

test('administratoren nulstiller et kodeord: det nye virker, det gamle gør ikke', async () => {
  const r = await a.kald('POST', sti(cId), { next: 'et-helt-nyt-4321' });
  assert.equal(r.status, 200);
  assert.equal(r.data.username, 'carol', 'svaret siger HVEM det gjaldt');

  const gammel = klient(srv.base);
  assert.equal((await gammel.kald('POST', '/api/login',
    { username: 'carol', password: 'kodeord-1234' })).status, 401, 'det gamle er dødt');

  const ny = klient(srv.base);
  assert.equal((await ny.kald('POST', '/api/login',
    { username: 'carol', password: 'et-helt-nyt-4321' })).status, 200);
});

test('den ramtes sessioner droppes — en nulstilling skal kunne lukke en tyv ude', async () => {
  // `b` er logget ind lige nu. Efter nulstillingen skal hans cookie være død.
  assert.equal((await b.kald('GET', '/api/me')).data.user.username, 'bob', 'han er inde nu');
  await a.kald('POST', sti(bId), { next: 'endnu-et-nyt-4321' });
  assert.equal((await b.kald('GET', '/api/me')).data.user, null, 'og ude bagefter');
});

test('API-nøglerne overlever — de er ikke det, der blev nulstillet', async () => {
  /*
   * Bevidst, og fladen siger det. En glemt adgangskode er ikke en grund til
   * at slå brugerens telefongenveje ihjel. Skal en nøgle væk, fjerner man
   * nøglen.
   */
  const d = klient(srv.base);
  const dId = (await d.opret('dave', 'kodeord-1234')).id;
  const noegle = (await d.kald('POST', '/api/v1/keys', { name: 'telefon', scope: 'capture' })).data.key;

  await a.kald('POST', sti(dId), { next: 'daves-nye-kode-1' });

  const r = await fetch(`${srv.base}/api/v1/capture`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${noegle}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'stadig min telefon' }),
  });
  assert.equal(r.status, 200, 'noeglen virker endnu');
});
