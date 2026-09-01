/*
 * At flytte flere noter paa én gang.
 *
 * »kan du lave saa man kan markere flere noter i venstre side. saa man fx kan
 * flytte flere noter paa en gang?« (Andreas, 2026-09-01).
 *
 * ── Hvad proeverne maaler ─────────────────────────────────────────────────
 *
 * Den vigtigste er, at en GREN ikke bliver revet fra hinanden. `flytNote`
 * tager hele undertraeet med, saa markerer man baade en side og dens
 * underside, ville undersiden foerst blive flyttet selvstaendigt - og med
 * `parentId: null` er den saa ikke laengere en underside. Man ville markere
 * en gren og faa den fladet ud, uden at noget fejlede.
 *
 * Og at en fejl midtvejs ikke efterlader en HALV flytning.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, klient } from './hjaelp.mjs';

let srv;
let a;

const nyBog = async (navn) =>
  (await a.kald('POST', '/api/v1/notebooks', { name: navn })).data.notebook;
const nyNote = async (t, bog, foraelder) =>
  (await a.kald('POST', '/api/v1/notes', { title: t, notebookId: bog, parentId: foraelder })).data.note;
const trae = async () => (await a.kald('GET', '/api/v1/tree')).data;
const flyt = (ids, notebookId) => a.kald('POST', '/api/v1/notes/move', { ids, notebookId });

before(async () => {
  srv = await startServer();
  a = klient(srv.base);
  await a.opret('alice', 'kodeord-1234');
});

after(() => srv.stop());

test('flere noter flyttes til en anden notesbog i ét kald', async () => {
  const fra = await nyBog('Fra');
  const til = await nyBog('Til');
  const n1 = await nyNote('En', fra.id);
  const n2 = await nyNote('To', fra.id);
  const n3 = await nyNote('Tre', fra.id);

  const r = await flyt([n1.id, n2.id], til.id);
  assert.equal(r.status, 200);
  assert.equal(r.data.moved, 2);

  const t = await trae();
  const bog = (id) => t.notes.find((x) => x.id === id).notebookId;
  assert.equal(bog(n1.id), til.id);
  assert.equal(bog(n2.id), til.id);
  assert.equal(bog(n3.id), fra.id, 'den umarkerede maa ikke flytte sig');
});

test('en GREN rives ikke fra hinanden, naar baade side og underside er markeret', async () => {
  const fra = await nyBog('Gren fra');
  const til = await nyBog('Gren til');
  const top = await nyNote('Top', fra.id);
  const barn = await nyNote('Barn', fra.id, top.id);

  const r = await flyt([top.id, barn.id], til.id);
  assert.equal(r.status, 200);
  assert.equal(r.data.moved, 1, 'kun forfaderen flyttes');
  assert.equal(r.data.skipped, 1, 'barnet springes over — det kommer med alligevel');

  const t = await trae();
  assert.equal(t.notes.find((x) => x.id === barn.id).parentId, top.id,
    'barnet skal stadig haenge under sin foraelder');
  assert.equal(t.notes.find((x) => x.id === barn.id).notebookId, til.id,
    'og det skal vaere fulgt med til den nye bog');
});

test('… ogsaa naar forfaderen er to niveauer oppe', async () => {
  const fra = await nyBog('Dyb fra');
  const til = await nyBog('Dyb til');
  const top = await nyNote('Top', fra.id);
  const barn = await nyNote('Barn', fra.id, top.id);
  const barnebarn = await nyNote('Barnebarn', fra.id, barn.id);

  const r = await flyt([top.id, barnebarn.id], til.id);
  assert.equal(r.data.moved, 1);
  const t = await trae();
  assert.equal(t.notes.find((x) => x.id === barnebarn.id).parentId, barn.id);
  assert.equal(t.notes.find((x) => x.id === barnebarn.id).notebookId, til.id);
});

test('en underside, hvis foraelder IKKE er markeret, bliver en topnote', async () => {
  // Det er meningen: man har bedt om at flytte netop den ene.
  const fra = await nyBog('Alene fra');
  const til = await nyBog('Alene til');
  const top = await nyNote('Bliver', fra.id);
  const barn = await nyNote('Flytter', fra.id, top.id);

  await flyt([barn.id], til.id);
  const t = await trae();
  assert.equal(t.notes.find((x) => x.id === barn.id).parentId, null);
  assert.equal(t.notes.find((x) => x.id === barn.id).notebookId, til.id);
  assert.equal(t.notes.find((x) => x.id === top.id).notebookId, fra.id);
});

test('en ukendt note i listen flytter INGENTING', async () => {
  /*
   * Alt eller intet. En halv flytning er vaerre end en fejlmeddelelse: man
   * kan ikke se hvilke der naaede over, og de ligger to steder.
   *
   * Det er FORHAANDSTJEKKET, der leverer det - ikke tilbagerulningen inde i
   * flytningen. Maalt ved at sabotere: `ROLLBACK` byttet til `COMMIT` gav
   * stadig groent, fordi ingen flytning naar at fejle, naar alt er tjekket
   * foerst. Den linje er et net, ikke et vaern, og det staar skrevet i koden.
   */
  const fra = await nyBog('Alt eller intet');
  const til = await nyBog('Modtager');
  const n1 = await nyNote('Rigtig', fra.id);

  const r = await flyt([n1.id, 'f'.repeat(32)], til.id);
  assert.equal(r.status, 404);
  const t = await trae();
  assert.equal(t.notes.find((x) => x.id === n1.id).notebookId, fra.id,
    'den gyldige note maa IKKE vaere flyttet');
});

test('en anden brugers note flytter ingenting', async () => {
  const b = klient(srv.base);
  await a.kald('POST', '/api/v1/admin', { allowRegistration: true });
  await b.opret('bob', 'kodeord-1234');
  const bobs = (await b.kald('POST', '/api/v1/notes', { title: 'Bobs note' })).data.note;
  const fra = await nyBog('Mine');
  const min = await nyNote('Min', fra.id);
  const til = await nyBog('Mit maal');

  const r = await flyt([min.id, bobs.id], til.id);
  assert.equal(r.status, 404);
  const t = await trae();
  assert.equal(t.notes.find((x) => x.id === min.id).notebookId, fra.id);
});

test('den samme note to gange taeller én gang', async () => {
  const fra = await nyBog('Dublet fra');
  const til = await nyBog('Dublet til');
  const n = await nyNote('Én', fra.id);
  const r = await flyt([n.id, n.id, n.id], til.id);
  assert.equal(r.data.moved, 1);
});

test('uden notesbog lander de uden for alle boeger', async () => {
  const fra = await nyBog('Ud af bogen');
  const n = await nyNote('Fri', fra.id);
  const r = await flyt([n.id], null);
  assert.equal(r.status, 200);
  const t = await trae();
  assert.equal(t.notes.find((x) => x.id === n.id).notebookId, null);
});

test('en tom liste afvises', async () => {
  const r = await flyt([], null);
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'nothing_to_move');
});

test('ruten forveksles ikke med et note-id', async () => {
  // `/notes/move` maa ikke laeses som `/notes/:id` af den anden rute.
  const r = await a.kald('POST', '/api/v1/notes/move', { ids: [], notebookId: null });
  assert.equal(r.status, 400, 'skal ramme bulk-ruten, ikke en 404 fra id-ruten');
});
