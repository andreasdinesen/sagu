/*
 * v111 - en udgivet notesbog kan starte paa en bestemt note.
 *
 * Andreas, 2026-10-08: »kan du lave så man kan vælge en startside når man
 * laver en notebook om til en wiki. Nogle gange vil man gerne have den til at
 * starte på en bestemt note«.
 *
 * Det, der maales:
 *  1. Startsiden vises paa wikiens egen adresse - ogsaa en underside kan vaelges.
 *  2. Kun en note I bogen: en note udenfor, en andens note eller en note-udgivelse afvises.
 *  3. Flyttes noten ud af bogen, falder wikien STILLE tilbage til oversigten.
 *  4. null rydder valget; siden har stadig sin egen adresse imens.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, klient, gaest } from './hjaelp.mjs';

let srv; let a; let b; let bog; let share; let velkommen; let kabler; let udenfor;

before(async () => {
  srv = await startServer();
  a = klient(srv.base);
  b = klient(srv.base);
  await a.opret('alice', 'kodeord-1234');
  await a.kald('POST', '/api/v1/admin', { allowRegistration: true });
  await b.opret('bob', 'kodeord-1234');
  bog = (await a.kald('POST', '/api/v1/notebooks', { name: 'Haandbog' })).data.notebook;
  const netvaerk = (await a.kald('POST', '/api/v1/notes', { title: 'Netvaerk', notebookId: bog.id, body: '# Netvaerk\n\nSwitchen staar i kaelderen.' })).data.note;
  kabler = (await a.kald('POST', '/api/v1/notes', { title: 'Kabler', parentId: netvaerk.id, body: '# Kabler\n\nBlaa er data.' })).data.note;
  velkommen = (await a.kald('POST', '/api/v1/notes', { title: 'Velkommen', notebookId: bog.id, body: '# Velkommen\n\nStart her, kollega.' })).data.note;
  udenfor = (await a.kald('POST', '/api/v1/notes', { title: 'Loen', body: '# Loen\n\nfortroligt tal' })).data.note;
  share = (await a.kald('POST', '/api/v1/shares', { notebookId: bog.id, slug: 'haandbog' })).data.share;
});
after(() => srv.stop());

test('uden valg er forsiden den genererede oversigt', async () => {
  assert.equal(share.startNoteId, null);
  const forside = await gaest(srv.base).hent('/w/haandbog/');
  assert.match(forside.tekst, /wsoegstor/);
  assert.doesNotMatch(forside.tekst, /Start her, kollega/);
});

test('startsiden vises paa wikiens egen adresse - ogsaa en underside', async () => {
  const r = await a.kald('PATCH', `/api/v1/shares/${share.id}`, { startNoteId: velkommen.id });
  assert.equal(r.status, 200);
  assert.equal(r.data.share.startNoteId, velkommen.id);
  const g = gaest(srv.base);
  const forside = await g.hent('/w/haandbog/');
  assert.equal(forside.status, 200);
  assert.match(forside.tekst, /Start her, kollega/);
  assert.doesNotMatch(forside.tekst, /wsoegstor/, 'oversigten er erstattet');
  assert.match(forside.tekst, /Switchen|Netvaerk/, 'navigationen er der stadig');
  // Den ENE adresse, siden hedder - samme side to steder maa ikke se ud som to.
  assert.match(forside.tekst, /rel="canonical" href="[^"]*\/w\/haandbog\/velkommen"/);
  // »← Front page« paa startsiden ville pege paa siden selv.
  assert.doesNotMatch(forside.tekst, /class="whjem"/);
  assert.match((await g.hent('/w/haandbog/netvaerk')).tekst, /class="whjem"/, 'de andre sider har den stadig');
  // Siden har stadig sin egen adresse, og de andre sider virker.
  assert.match((await g.hent('/w/haandbog/velkommen')).tekst, /Start her, kollega/);
  assert.match((await g.hent('/w/haandbog/netvaerk')).tekst, /Switchen staar i kaelderen/);

  await a.kald('PATCH', `/api/v1/shares/${share.id}`, { startNoteId: kabler.id });
  assert.match((await g.hent('/w/haandbog/')).tekst, /Blaa er data/);
});

test('kun en note I bogen - aldrig en udenfor, en andens eller paa en note-udgivelse', async () => {
  const udenforSvar = await a.kald('PATCH', `/api/v1/shares/${share.id}`, { startNoteId: udenfor.id });
  assert.equal(udenforSvar.status, 400);
  assert.equal(udenforSvar.data.error, 'bad_start_page');
  const bobs = (await b.kald('POST', '/api/v1/notes', { title: 'Bobs', body: 'x' })).data.note;
  assert.equal((await a.kald('PATCH', `/api/v1/shares/${share.id}`, { startNoteId: bobs.id })).status, 400);
  assert.equal((await a.kald('PATCH', `/api/v1/shares/${share.id}`, { startNoteId: 'f'.repeat(32) })).status, 400);
  // En anden bruger kan ikke roere udgivelsen.
  assert.equal((await b.kald('PATCH', `/api/v1/shares/${share.id}`, { startNoteId: null })).status, 404);
  // En note-udgivelse har sin rod som forside - der er intet at vaelge.
  const noteShare = (await a.kald('POST', '/api/v1/shares', { noteId: udenfor.id })).data.share;
  assert.equal((await a.kald('PATCH', `/api/v1/shares/${noteShare.id}`, { startNoteId: udenfor.id })).status, 400);
  // Den fortrolige note vises aldrig paa wikien.
  assert.doesNotMatch((await gaest(srv.base).hent('/w/haandbog/')).tekst, /fortroligt tal/);
});

test('flyttes startsiden ud af bogen, falder wikien stille tilbage til oversigten', async () => {
  await a.kald('PATCH', `/api/v1/shares/${share.id}`, { startNoteId: velkommen.id });
  await a.kald('POST', `/api/v1/notes/${velkommen.id}/move`, { parentId: null, notebookId: null });
  const forside = await gaest(srv.base).hent('/w/haandbog/');
  assert.equal(forside.status, 200);
  assert.match(forside.tekst, /wsoegstor/);
  assert.doesNotMatch(forside.tekst, /Start her, kollega/, 'en note uden for bogen vises aldrig');
  // Valget staar der stadig (appen viser det), men kan ryddes.
  const r = await a.kald('PATCH', `/api/v1/shares/${share.id}`, { startNoteId: null });
  assert.equal(r.data.share.startNoteId, null);
});
