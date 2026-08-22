/*
 * F18 - bogmærket »Save to Sagu« og den ene CORS-dør, det kræver.
 *
 * ── Hvad testen egentlig måler ────────────────────────────────────────────
 *
 * At døren ikke er større, end jeg tror. At åbne CORS på ét endepunkt er en
 * lille ændring at skrive og en stor at tage fejl af: går den for vidt, kan
 * en hvilken som helst side på nettet læse et svar fra en indlogget brugers
 * Sagu.
 *
 * Derfor står de tre ting, der IKKE må ske, først:
 *
 *   1. Ingen anden rute må have fået CORS med.
 *   2. Der må ikke stå `Allow-Credentials` — det er dét, der ville lade en
 *      fremmed side handle som den indloggede.
 *   3. Sessionscookien skal blive ved med at være `SameSite=Lax`, som er den
 *      egentlige grund til, at åbningen er ufarlig. Ændrer nogen den til
 *      `None` en dag, falder denne prøve — og det er meningen.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, klient } from './hjaelp.mjs';

let srv;
let a;
let noegle;

before(async () => {
  srv = await startServer();
  a = klient(srv.base);
  await a.opret('alice', 'kodeord-1234');
  noegle = (await a.kald('POST', '/api/v1/keys', { name: 'bogmaerke', scope: 'capture' })).data.key;
});

after(() => srv.stop());

/* ============================ døren, og kun den ======================= */

test('capture svarer på preflight — ellers virker bogmærket ikke', async () => {
  const r = await fetch(`${srv.base}/api/v1/capture`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://en-helt-anden.example',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.match(String(r.headers.get('access-control-allow-headers')).toLowerCase(), /authorization/);
  // CORP skal ogsaa vaere sat om - ellers kaster browseren svaret ALLIGEVEL.
  assert.equal(r.headers.get('cross-origin-resource-policy'), 'cross-origin');
});

test('ingen ANDEN rute har fået CORS med', async () => {
  /*
   * Den vigtigste af dem. `read`-ruterne er dér, skaden ville ligge: et svar,
   * en fremmed side kan læse, ER selve lækket. Capture kan pr. definition
   * ingenting læse.
   */
  for (const sti of ['/api/v1/notes', '/api/v1/search?q=a', '/api/v1/state', '/api/me',
    '/api/v1/keys', '/api/v1/files', '/api/v1/tree']) {
    const r = await fetch(srv.base + sti, {
      headers: { Origin: 'https://en-helt-anden.example', Authorization: `Bearer ${noegle}` },
    });
    assert.equal(r.headers.get('access-control-allow-origin'), null,
      `${sti} har faaet en CORS-header, den ikke skal have`);
  }
});

test('døren bærer aldrig Allow-Credentials', async () => {
  // Med `*` OG credentials ville en fremmed side kunne handle som den
  // indloggede bruger. De to maa aldrig staa sammen.
  const r = await fetch(`${srv.base}/api/v1/capture`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://en-helt-anden.example', 'Access-Control-Request-Method': 'POST' },
  });
  assert.equal(r.headers.get('access-control-allow-credentials'), null);
});

test('sessionscookien er SameSite=Lax — dét er grunden til at døren er ufarlig', async () => {
  const frisk = klient(srv.base);
  const r = await frisk.kald('POST', '/api/login', { username: 'alice', password: 'kodeord-1234' });
  const saet = r.headers.getSetCookie().find((c) => c.startsWith('sagu_session='));
  assert.match(saet, /SameSite=Lax/,
    'aendres den til None, kan en fremmed sides POST baere cookien - og saa ER doeren et hul');
  assert.match(saet, /HttpOnly/);
});

test('en nøgle er stadig nødvendig — CORS åbner ingen dør uden lås', async () => {
  const r = await fetch(`${srv.base}/api/v1/capture`, {
    method: 'POST',
    headers: { Origin: 'https://en-helt-anden.example', 'Content-Type': 'text/plain' },
    body: 'uden noegle',
  });
  assert.equal(r.status, 401);
});

/* ============================ og så bogmærkets kald ==================== */

test('det kald, bogmærket laver, lander som en note i den valgte notesbog', async () => {
  await a.kald('POST', '/api/v1/notebooks', { name: 'Klip' });
  const krop = 'En sag fra ServiceNow #web\n\n[En sag](https://eksempel.example/sag/1)\n\nBrødtekst.';
  const r = await fetch(`${srv.base}/api/v1/capture?notebook=${encodeURIComponent('Klip')}`, {
    method: 'POST',
    headers: { Origin: 'https://eksempel.example', Authorization: `Bearer ${noegle}`,
      'Content-Type': 'text/plain;charset=utf-8' },
    body: krop,
  });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), '*', 'svaret skal kunne laeses');
  const d = await r.json();

  const note = (await a.kald('GET', `/api/v1/notes/${d.note.id}`)).data.note;
  assert.equal(note.title, 'En sag fra ServiceNow', 'foerste linje blev titlen, uden maerket');
  assert.deepEqual(note.tags, ['web'], 'og #web blev et rigtigt maerke');
  assert.match(note.body, /https:\/\/eksempel\.example\/sag\/1/, 'kilden staar i noten');
  assert.match(note.body, /Brødtekst/);
  const boeger = (await a.kald('GET', '/api/v1/tree')).data.notebooks;
  const klip = boeger.find((b) => b.name === 'Klip');
  assert.equal(note.notebookId, klip.id, 'og den ligger i den valgte notesbog');
});

test('bogmærkets nøgle kan intet læse — den er `capture` og ikke mere', async () => {
  /*
   * Et bogmærke ligger i klartekst i browserens bogmærkeliste og synkroniseres
   * mellem maskiner. Kan dets nøgle læse, er hele arkivet ét stjålet bogmærke
   * væk.
   */
  for (const sti of ['/api/v1/notes', '/api/v1/search?q=sag', '/api/v1/tree']) {
    const r = await fetch(srv.base + sti, { headers: { Authorization: `Bearer ${noegle}` } });
    assert.equal(r.status, 403, `${sti} svarede ${r.status} - capture maa ikke kunne laese`);
  }
});
