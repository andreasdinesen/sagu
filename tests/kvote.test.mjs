/*
 * Filkvoten som INDSTILLING.
 *
 * »Kan du gøre det muligt at øge størrelsen af lageret fra 2GB til en valgfri
 * størrelse?« (Andreas, 2026-08-22).
 *
 * ── Hvad testen måler ─────────────────────────────────────────────────────
 *
 * Ikke at et tal kan gemmes. At det ikke kan sættes et sted hen, hvor appen
 * bagefter ser ud til at være i stykker: en kvote UNDER det, en konto allerede
 * bruger, sletter ingenting — den efterlader bare kontoen over grænsen, uden
 * en vej ud der ikke begynder med at slette noget.
 *
 * Og at en almindelig bruger ikke kan skrue op for sin egen plads.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, klient } from './hjaelp.mjs';

let srv;
let a;      // administratoren
let b;      // en almindelig bruger

const MB = 1024 * 1024;

before(async () => {
  // Gulvet saettes ned, saa vagten mod »under det, nogen allerede bruger«
  // kan naas uden at sende 100 MB gennem en test.
  srv = await startServer({ SAGU_MIN_KVOTE: '1' });
  a = klient(srv.base);
  b = klient(srv.base);
  await a.opret('alice', 'kodeord-1234');
  await a.kald('POST', '/api/v1/admin', { allowRegistration: true });
  await b.opret('bob', 'kodeord-1234');
});

after(() => srv.stop());

const kvote = async (kl) => (await kl.kald('GET', '/api/v1/state')).data.storage.quota;

test('kvoten kan sættes op — og gælder med det samme, uden genstart', async () => {
  const foer = await kvote(a);
  const r = await a.kald('POST', '/api/v1/admin', { storageQuota: 500 * MB });
  assert.equal(r.status, 200);
  assert.equal(await kvote(a), 500 * MB);
  assert.notEqual(await kvote(a), foer);

  // ... og den gaelder ALLE konti. Kvoten er pr. konto, ikke pr. person.
  assert.equal(await kvote(b), 500 * MB);

  // Op igen.
  await a.kald('POST', '/api/v1/admin', { storageQuota: 8 * 1024 * MB });
  assert.equal(await kvote(a), 8 * 1024 * MB);
});

test('en almindelig bruger kan ikke skrue op for sin egen plads', async () => {
  const r = await b.kald('POST', '/api/v1/admin', { storageQuota: 900 * 1024 * MB });
  assert.equal(r.status, 403);
  assert.equal(r.data.error, 'not_admin');
});

test('en NØGLE kan det heller ikke — heller ikke en full-nøgle', async () => {
  const noegle = (await a.kald('POST', '/api/v1/keys', { name: 'k', scope: 'full' })).data.key;
  const r = await fetch(`${srv.base}/api/v1/admin`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${noegle}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ storageQuota: 900 * 1024 * MB }),
  });
  assert.equal(r.status, 401, 'serverens indstillinger er ikke en noegles sag');
});

test('et urimeligt tal afvises — og det gamle består', async () => {
  const foer = await kvote(a);
  for (const daarlig of [0, -1, 'meget', null, 1e30]) {
    const r = await a.kald('POST', '/api/v1/admin', { storageQuota: daarlig });
    assert.equal(r.status, 400, `${daarlig} burde vaere afvist`);
    assert.equal(r.data.error, 'bad_quota');
  }
  assert.equal(await kvote(a), foer, 'intet af det roerte den gaeldende kvote');
});

test('kvoten kan ikke sættes under det, en konto allerede bruger', async () => {
  /*
   * Den vigtigste. En kvote under forbruget sletter ingenting - den
   * efterlader kontoen over graensen, hvor intet kan lægges op, og hvor den
   * eneste vej ud begynder med at slette noget.
   */
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64');
  const noegle = (await b.kald('POST', '/api/v1/keys', { name: 'fil', scope: 'capture' })).data.key;
  const op = await fetch(`${srv.base}/api/v1/capture?name=et.png`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${noegle}`, 'Content-Type': 'image/png' },
    body: png,
  });
  assert.equal(op.status, 200, 'bob har nu en fil');

  const brugt = (await b.kald('GET', '/api/v1/state')).data.storage.used;
  assert.ok(brugt > 0, 'der ER brugt plads nu');
  const r = await a.kald('POST', '/api/v1/admin', { storageQuota: brugt - 1 });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'quota_below_use');
  assert.match(r.data.message, /already uses/);
});
