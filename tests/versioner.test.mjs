/*
 * F22 - versionshistorik med en grænse, en kontakt og en vej tilbage.
 *
 * ── Hvad der var galt før ─────────────────────────────────────────────────
 *
 * Tabellen er blevet skrevet til siden F1 — uden grænse, uden kontakt og
 * uden en flade. Den voksede altså i det uendelige med noget, ingen kunne se.
 *
 * ── Hvad prøverne måler ───────────────────────────────────────────────────
 *
 * Ikke at man kan gå tilbage. At man ikke kan gå for langt, at grænsen
 * FAKTISK rydder op, og at en gendannelse selv kan fortrydes. En vej tilbage,
 * der ikke selv kan fortrydes, er en fælde.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer, klient } from './hjaelp.mjs';

let srv;
let a;
let b;

/**
 * Skub en notes versioner en time tilbage.
 *
 * Skrivestunds-vinduet kan ikke ventes ud i en test. Her rykkes kun URET;
 * selve reglen røres ikke — den prøve, der måler sammenlægningen, bruger den
 * med vilje ikke.
 */
function nyStund(noteId) {
  const db = new DatabaseSync(path.join(srv.dataDir, 'sagu.db'));
  try { db.prepare('UPDATE note_versions SET at = at - 3600 WHERE note_id = ?').run(noteId); }
  finally { db.close(); }
}

const versioner = async (kl, id) => (await kl.kald('GET', `/api/v1/notes/${id}/versions`)).data;

before(async () => {
  srv = await startServer();
  a = klient(srv.base);
  b = klient(srv.base);
  await a.opret('alice', 'kodeord-1234');
  await a.kald('POST', '/api/v1/admin', { allowRegistration: true });
  await b.opret('bob', 'kodeord-1234');
});

after(() => srv.stop());

/* ------------------------------------------------------------- grænsen */

test('der gemmes tredive versioner som udgangspunkt', async () => {
  const n = (await a.kald('POST', '/api/v1/notes', { title: 'Grænse', body: 'v0' })).data.note;
  const d = await versioner(a, n.id);
  assert.equal(d.keep, 30);
  assert.equal(d.enabled, true);
});

test('grænsen rydder FAKTISK op — den ældste falder ud', async () => {
  await a.kald('POST', '/api/v1/versions', { keep: 3 });
  const n = (await a.kald('POST', '/api/v1/notes', { title: 'Tre', body: 'et' })).data.note;
  for (const tekst of ['to', 'tre', 'fire', 'fem']) {
    nyStund(n.id);
    await a.kald('PATCH', `/api/v1/notes/${n.id}`, { body: tekst });
  }
  const d = await versioner(a, n.id);
  assert.equal(d.versions.length, 3, 'ikke fem');
  // De TRE nyeste, nyeste foerst. »fem« er den nuvaerende note, ikke en version.
  const tekster = [];
  for (const v of d.versions) {
    tekster.push((await a.kald('GET', `/api/v1/notes/${n.id}/versions/${v.id}`)).data.version.body);
  }
  assert.deepEqual(tekster, ['fire', 'tre', 'to']);
  await a.kald('POST', '/api/v1/versions', { keep: 30 });
});

test('et urimeligt antal afvises — og det gældende består', async () => {
  for (const daarlig of [0, -1, 5000, 'mange', null]) {
    const r = await a.kald('POST', '/api/v1/versions', { keep: daarlig });
    assert.equal(r.status, 400, `${daarlig}`);
    assert.equal(r.data.error, 'bad_keep');
  }
  const n = (await a.kald('POST', '/api/v1/notes', { title: 'Uændret', body: 'x' })).data.note;
  assert.equal((await versioner(a, n.id)).keep, 30);
});

/* ------------------------------------------------------------- kontakten */

test('slået fra skrives der ingen nye — og de gamle bliver stående', async () => {
  /*
   * At slå fra sletter ingenting. Det, der allerede er gemt, er en
   * kendsgerning om noten; at rydde det, fordi man skifter en indstilling,
   * ville være at ændre historikken.
   */
  const n = (await a.kald('POST', '/api/v1/notes', { title: 'Kontakt', body: 'foer' })).data.note;
  assert.equal((await versioner(a, n.id)).versions.length, 1);

  /*
   * Noten skal have et ANDET indhold end den gemte version, før kontakten
   * kan måles. Første udgave af prøven rettede fra en tilstand, der allerede
   * stod som version — så sprang dublet-vagten ind, og prøven bestod, selv
   * når kontakten var saboteret væk. En prøve, hvis emne er dækket af en
   * anden regel, måler den anden regel.
   */
  nyStund(n.id);
  await a.kald('PATCH', `/api/v1/notes/${n.id}`, { body: 'et andet indhold' });
  assert.equal((await versioner(a, n.id)).versions.length, 1, 'stadig kun oprettelsen');

  await a.kald('POST', '/api/v1/versions', { enabled: false });
  nyStund(n.id);
  await a.kald('PATCH', `/api/v1/notes/${n.id}`, { body: 'skrevet mens den var slukket' });

  const slukket = await versioner(a, n.id);
  assert.equal(slukket.enabled, false);
  assert.equal(slukket.versions.length, 1, 'ingen ny - og den gamle staar der endnu');

  await a.kald('POST', '/api/v1/versions', { enabled: true });
  nyStund(n.id);
  await a.kald('PATCH', `/api/v1/notes/${n.id}`, { body: 'bagefter' });
  assert.equal((await versioner(a, n.id)).versions.length, 2, 'og saa skrives der igen');
});

/* ------------------------------------------------------------- vejen tilbage */

test('en gendannelse kan selv fortrydes — også midt i en skrivestund', async () => {
  /*
   * Gendannelsen sker med VILJE uden en `nyStund()` imellem.
   *
   * Det er dér, fælden er: falder gendannelsen ind i skrivestunds-vinduet
   * efter den rettelse, man fortryder, ville den tilstand, man går væk fra,
   * aldrig blive gemt — og så er den væk for altid. Derfor springer en
   * gendannelse vinduet over.
   *
   * Min første udgave af prøven havde en `nyStund()` her, og så bestod den,
   * selv når `tving` blev saboteret væk.
   */
  const n = (await a.kald('POST', '/api/v1/notes', { title: 'Frem og tilbage', body: 'oprindelig' })).data.note;
  // INGEN `nyStund()` her - alt sker inden for samme vindue, som naar man
  // fortryder med det samme.
  await a.kald('PATCH', `/api/v1/notes/${n.id}`, { body: 'skrevet om' });

  const d = await versioner(a, n.id);
  assert.equal(d.versions.length, 1, 'rettelsen laa i vinduet og gav ingen ny version');
  const gammel = d.versions[d.versions.length - 1];
  const r = await a.kald('POST', `/api/v1/notes/${n.id}/versions/${gammel.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.note.body, 'oprindelig');

  // ... og »skrevet om« er nu selv en version, saa turen kan gaa tilbage igen.
  const efter = await versioner(a, n.id);
  const tekster = [];
  for (const v of efter.versions) {
    tekster.push((await a.kald('GET', `/api/v1/notes/${n.id}/versions/${v.id}`)).data.version.body);
  }
  assert.ok(tekster.includes('skrevet om'), 'gendannelsen gemte det, den erstattede');
});

/* ------------------------------------------------------------- isolationen */

test('en anden brugers versioner kan hverken ses eller gendannes', async () => {
  const min = (await a.kald('POST', '/api/v1/notes', { title: 'Min', body: 'hemmelig tekst' })).data.note;
  const hans = (await b.kald('POST', '/api/v1/notes', { title: 'Hans', body: 'hans' })).data.note;
  const minVersion = (await versioner(a, min.id)).versions[0].id;

  assert.equal((await b.kald('GET', `/api/v1/notes/${min.id}/versions`)).status, 404);
  assert.equal((await b.kald('GET', `/api/v1/notes/${min.id}/versions/${minVersion}`)).status, 404);

  /*
   * Den farligste: en version fra MIN note, hentet gennem HANS note. Uden
   * `note_id` i opslaget ville id'et alene være nok.
   */
  assert.equal((await b.kald('GET', `/api/v1/notes/${hans.id}/versions/${minVersion}`)).status, 404);
  const gendan = await b.kald('POST', `/api/v1/notes/${hans.id}/versions/${minVersion}`);
  assert.equal(gendan.status, 404);
  assert.equal((await b.kald('GET', `/api/v1/notes/${hans.id}`)).data.note.body, 'hans',
    'hans note er uroert');
});

test('indstillingerne er PERSONLIGE, og en nøgle kan ikke røre dem', async () => {
  await a.kald('POST', '/api/v1/versions', { keep: 7 });
  const mine = (await a.kald('POST', '/api/v1/notes', { title: 'Mine', body: 'x' })).data.note;
  const hans = (await b.kald('POST', '/api/v1/notes', { title: 'Hans', body: 'x' })).data.note;
  assert.equal((await versioner(a, mine.id)).keep, 7);
  assert.equal((await versioner(b, hans.id)).keep, 30, 'bobs er uroert');
  await a.kald('POST', '/api/v1/versions', { keep: 30 });

  const noegle = (await a.kald('POST', '/api/v1/keys', { name: 'k', scope: 'full' })).data.key;
  const r = await fetch(`${srv.base}/api/v1/versions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${noegle}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: false }),
  });
  assert.equal(r.status, 401, 'indstillinger er ikke en noegles sag');
});
