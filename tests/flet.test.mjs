/*
 * At slaa to notesboeger sammen.
 *
 * »Det skal vaere muligt at kunne slaa 2 notebooks sammen ... enten ved at
 * flytte alle noter over i den ene notebook eller ved at lade den ene
 * notebook blive en hovedside under den anden« (Andreas, 2026-08-25).
 *
 * ── Hvad proeverne maaler ─────────────────────────────────────────────────
 *
 * Ikke at et felt kan saettes. At INTET forsvinder undervejs. En flytning,
 * der taber en underside eller efterlader et undertrae spredt over to
 * boeger, fejler ikke - den ser bare rigtig ud, indtil man leder efter noten.
 *
 * Den vigtigste er `undertrae`-proeven: »et undertrae ligger i ÉN notesbog«
 * (DESIGN.md) er hele grunden til, at en udgivet bog kan tegnes ét sted.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, klient } from './hjaelp.mjs';

let srv;
let a;

const nyBog = async (navn) =>
  (await a.kald('POST', '/api/v1/notebooks', { name: navn })).data.notebook;

const nyNote = async (titel, bogId, foraelder) =>
  (await a.kald('POST', '/api/v1/notes',
    { title: titel, notebookId: bogId, parentId: foraelder })).data.note;

/** Traeet, som sidebaren ser det. */
const trae = async () => (await a.kald('GET', '/api/v1/tree')).data;

const flet = (kilde, maal, mode) =>
  a.kald('POST', `/api/v1/notebooks/${kilde}/merge`, { into: maal, mode });

before(async () => {
  srv = await startServer();
  a = klient(srv.base);
  await a.opret('alice', 'kodeord-1234');
});

after(() => srv.stop());

test('»flyt noterne«: noterne staar i maalbogen, kildebogen er vaek', async () => {
  const kilde = await nyBog('Kilde');
  const maal = await nyBog('Maal');
  await nyNote('Fra maal', maal.id);
  const en = await nyNote('En', kilde.id);
  const to = await nyNote('To', kilde.id);

  const r = await flet(kilde.id, maal.id, 'noter');
  assert.equal(r.status, 200);
  assert.equal(r.data.notes, 2);

  const t = await trae();
  const boeger = t.notebooks.map((b) => b.id);
  assert.ok(!boeger.includes(kilde.id), 'kildebogen skal vaere vaek af listen');
  assert.ok(boeger.includes(maal.id));
  for (const id of [en.id, to.id]) {
    const n = t.notes.find((x) => x.id === id);
    assert.ok(n, 'noten forsvandt');
    assert.equal(n.notebookId, maal.id);
    assert.equal(n.parentId, null, 'en topnote skal blive en topnote');
  }
});

test('»bliv en hovedside«: der laves ÉN side, og noterne haenger under den', async () => {
  const kilde = await nyBog('Teknik');
  const maal = await nyBog('Arkiv');
  const en = await nyNote('En', kilde.id);
  const to = await nyNote('To', kilde.id);

  const r = await flet(kilde.id, maal.id, 'side');
  assert.equal(r.status, 200);

  const t = await trae();
  const side = t.notes.find((n) => n.title === 'Teknik' && n.notebookId === maal.id);
  assert.ok(side, 'hovedsiden blev ikke lavet');
  assert.equal(side.parentId, null, 'hovedsiden er selv en topnote i maalbogen');
  for (const id of [en.id, to.id]) {
    const n = t.notes.find((x) => x.id === id);
    assert.equal(n.parentId, side.id, 'noten blev ikke en underside');
    assert.equal(n.notebookId, maal.id);
  }
});

test('et UNDERTRAE holder sammen — og skifter bog hele vejen ned', async () => {
  /*
   * Den vigtigste. Uden det ville en underside blive liggende i en bog, der
   * ikke findes laengere, og sidebaren kunne ikke tegne traeet ét sted.
   */
  const kilde = await nyBog('Med dybde');
  const maal = await nyBog('Modtager');
  const top = await nyNote('Top', kilde.id);
  const barn = await nyNote('Barn', kilde.id, top.id);
  const barnebarn = await nyNote('Barnebarn', kilde.id, barn.id);

  await flet(kilde.id, maal.id, 'noter');

  const t = await trae();
  for (const id of [top.id, barn.id, barnebarn.id]) {
    const n = t.notes.find((x) => x.id === id);
    assert.ok(n, `noten ${id} forsvandt`);
    assert.equal(n.notebookId, maal.id, 'hele undertraeet skal med over');
  }
  assert.equal(t.notes.find((x) => x.id === barn.id).parentId, top.id,
    'barnets foraelder maa ikke roeres');
  assert.equal(t.notes.find((x) => x.id === barnebarn.id).parentId, barn.id);
});

test('en underside bliver IKKE hevet op som hovedside', async () => {
  // Kun topnoterne haenges under den nye side. Gjorde vi det paa alle, ville
  // et trae blive fladet ud.
  const kilde = await nyBog('Dyb kilde');
  const maal = await nyBog('Dyb maal');
  const top = await nyNote('Top', kilde.id);
  const barn = await nyNote('Barn', kilde.id, top.id);

  await flet(kilde.id, maal.id, 'side');

  const t = await trae();
  const side = t.notes.find((n) => n.title === 'Dyb kilde');
  assert.equal(t.notes.find((x) => x.id === top.id).parentId, side.id);
  assert.equal(t.notes.find((x) => x.id === barn.id).parentId, top.id,
    'barnet skal blive hos sin foraelder');
});

test('de indkomne noter laegges EFTER dem, der var der i forvejen', async () => {
  /*
   * `seq` er et loebenummer PR. BOG, saa to boeger har begge 0, 1, 2. Uden en
   * forskydning ville de to lister blive flettet ind i hinanden, og man ville
   * ikke kunne se hvad der kom hvorfra.
   */
  const kilde = await nyBog('Sidst');
  const maal = await nyBog('Foerst');
  const m1 = await nyNote('Maal 1', maal.id);
  const m2 = await nyNote('Maal 2', maal.id);
  const k1 = await nyNote('Kilde 1', kilde.id);
  const k2 = await nyNote('Kilde 2', kilde.id);

  await flet(kilde.id, maal.id, 'noter');

  const t = await trae();
  const seq = (id) => t.notes.find((x) => x.id === id).seq;
  assert.ok(seq(k1.id) > seq(m2.id),
    `kilde 1 (${seq(k1.id)}) skal ligge efter maal 2 (${seq(m2.id)})`);
  assert.ok(seq(k2.id) > seq(k1.id), 'og kilderne beholder deres indbyrdes orden');
  assert.ok(seq(m1.id) < seq(m2.id), 'maalets egen orden roeres ikke');
});

test('en UDGIVET kildebog kan ikke flettes — linket ville doe', async () => {
  const kilde = await nyBog('Udgivet');
  const maal = await nyBog('Et maal');
  await nyNote('En note', kilde.id);
  const u = await a.kald('POST', '/api/v1/shares', { notebookId: kilde.id, mode: 'read' });
  assert.equal(u.status, 200, 'kunne ikke udgive bogen');

  const r = await flet(kilde.id, maal.id, 'noter');
  assert.equal(r.status, 409);
  assert.equal(r.data.error, 'source_published');

  // ... og INTET er sket.
  const t = await trae();
  assert.ok(t.notebooks.some((b) => b.id === kilde.id), 'bogen skal stadig staa der');
});

test('en bog kan ikke flettes ind i sig selv', async () => {
  const b = await nyBog('Alene');
  const r = await flet(b.id, b.id, 'noter');
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'same_notebook');
});

test('en ukendt bog giver 404 — begge veje', async () => {
  const b = await nyBog('Findes');
  const fantom = 'f'.repeat(32);
  assert.equal((await flet(b.id, fantom, 'noter')).status, 404);
  assert.equal((await flet(fantom, b.id, 'noter')).status, 404);
});

test('en anden brugers bog kan ikke flettes ind i min', async () => {
  const b = klient(srv.base);
  await a.kald('POST', '/api/v1/admin', { allowRegistration: true });
  await b.opret('bob', 'kodeord-1234');
  const bobs = (await b.kald('POST', '/api/v1/notebooks', { name: 'Bobs' })).data.notebook;
  const mit = await nyBog('Mit');

  assert.equal((await flet(bobs.id, mit.id, 'noter')).status, 404);
  assert.equal((await flet(mit.id, bobs.id, 'noter')).status, 404);
});

test('en tom bog kan flettes — der sker bare ingenting med noter', async () => {
  const kilde = await nyBog('Tom');
  const maal = await nyBog('Modtager tom');
  const r = await flet(kilde.id, maal.id, 'side');
  assert.equal(r.status, 200);
  assert.equal(r.data.notes, 0);
  const t = await trae();
  assert.ok(!t.notebooks.some((x) => x.id === kilde.id));
  assert.ok(t.notes.some((n) => n.title === 'Tom' && n.notebookId === maal.id),
    'hovedsiden laves ogsaa for en tom bog — den ER bogen');
});
