/*
 * F10 - MCP-serveren, som en rigtig klient moeder den.
 *
 * ── Alt koeres UDEN cookie ────────────────────────────────────────────────
 *
 * Med en session godkender serveren alting, og scope-tjekket SER ud til at
 * virke, selv om det aldrig blev kaldt (RUNE-ERFARINGER, doda F2). Claude
 * Code har ingen cookie - den har en noegle og intet andet, og det er den
 * eneste maade at bevise, at rettighederne betyder noget.
 *
 * ── Det, filen skal fange ─────────────────────────────────────────────────
 *
 * De fire ting, der i doda kostede en aften hver: 401'eren uden
 * `WWW-Authenticate`, en notifikation besvaret med JSON i stedet for 202, et
 * fremmed `Origin`, der slap igennem (DNS-rebinding), og en vaerktoejsfejl
 * meldt som en protokolfejl, saa modellen ikke kunne rette op.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, klient } from './hjaelp.mjs';

let srv;
let a;
const noegler = {};
let id = 0;

/** Ét JSON-RPC-kald - ingen cookie, som en rigtig MCP-klient. */
async function rpc(method, params, noegle) {
  const headers = { 'Content-Type': 'application/json' };
  if (noegle !== null) headers.Authorization = `Bearer ${noegle || noegler.full}`;
  const r = await fetch(`${srv.base}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
  });
  return { status: r.status, krop: r.status === 202 ? null : await r.json(), headers: r.headers };
}

async function kald(navn, args, noegle) {
  const r = await rpc('tools/call', { name: navn, arguments: args || {} }, noegle);
  return r.krop.result;
}

before(async () => {
  srv = await startServer();
  a = klient(srv.base);
  await a.opret('ejer', 'kodeord-1234');
  for (const scope of ['capture', 'read', 'link', 'full']) {
    noegler[scope] = (await a.kald('POST', '/api/v1/keys', { name: scope, scope })).data.key;
  }
});

after(() => srv.stop());

/* ====================================== protokollen =================== */

test('initialize svarer med protokolversion, serverinfo og instruktioner', async () => {
  const r = await rpc('initialize', {
    protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.krop.jsonrpc, '2.0');
  assert.equal(r.krop.result.protocolVersion, '2025-06-18');
  assert.equal(r.krop.result.serverInfo.name, 'sagu');
  assert.ok(r.krop.result.capabilities.tools);
  // Instruktionerne er gratis kontekst - og de skal sige det farlige hoejt.
  assert.match(r.krop.result.instructions, /never invent an id/);
  assert.match(r.krop.result.instructions, /OPEN web/);
});

test('en ældre protokolversion accepteres, en ukendt falder tilbage', async () => {
  assert.equal((await rpc('initialize', { protocolVersion: '2024-11-05' })).krop.result.protocolVersion,
    '2024-11-05');
  assert.equal((await rpc('initialize', { protocolVersion: '1999-01-01' })).krop.result.protocolVersion,
    '2025-06-18');
});

test('ping virker og svaret bærer MCP-Protocol-Version', async () => {
  const r = await rpc('ping');
  assert.deepEqual(r.krop.result, {});
  assert.equal(r.headers.get('mcp-protocol-version'), '2025-06-18');
});

test('en notifikation kvitteres med 202 og TOM krop', async () => {
  const r = await fetch(`${srv.base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${noegler.full}` },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  assert.equal(r.status, 202);
  assert.equal((await r.text()).length, 0, 'JSON i svaret faar klienten til at brokke sig');
});

test('ukendt metode giver -32601, ugyldig forespørgsel -32600', async () => {
  assert.equal((await rpc('does/not/exist')).krop.error.code, -32601);
  const r = await fetch(`${srv.base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${noegler.full}` },
    body: JSON.stringify({ jsonrpc: '1.0', id: 99, method: 'ping' }),
  });
  assert.equal((await r.json()).error.code, -32600);
});

test('et bundt besvares som et bundt', async () => {
  const r = await fetch(`${srv.base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${noegler.full}` },
    body: JSON.stringify([
      { jsonrpc: '2.0', id: 'a', method: 'ping' },
      { jsonrpc: '2.0', id: 'b', method: 'ping' },
    ]),
  });
  const krop = await r.json();
  assert.ok(Array.isArray(krop));
  assert.deepEqual(krop.map((x) => x.id), ['a', 'b']);
});

/* ========================================== adgang ==================== */

test('uden nøgle: 401 med WWW-Authenticate OG resource_metadata', async () => {
  const r = await fetch(`${srv.base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
  });
  assert.equal(r.status, 401);
  const h = r.headers.get('www-authenticate') || '';
  assert.match(h, /^Bearer /);
  // Uden den her kan claude.ai ikke FINDE autorisationsserveren og opgiver
  // forbindelsen, uden at noget ser i stykker ud.
  assert.match(h, /resource_metadata="[^"]+\/\.well-known\/oauth-protected-resource"/);
});

test('ugyldig nøgle afvises', async () => {
  assert.equal((await rpc('ping', {}, 'sagu_findesikke')).status, 401);
});

test('GET og DELETE afvises med 405', async () => {
  for (const metode of ['GET', 'DELETE']) {
    const r = await fetch(`${srv.base}/mcp`, {
      method: metode, headers: { Authorization: `Bearer ${noegler.full}` },
    });
    assert.equal(r.status, 405, metode);
  }
});

test('fremmed Origin afvises (DNS-rebinding)', async () => {
  const r = await fetch(`${srv.base}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${noegler.full}`,
      Origin: 'https://evil.example',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
  });
  assert.equal(r.status, 403);
});

test('vores egen Origin slipper igennem', async () => {
  const r = await fetch(`${srv.base}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${noegler.full}`,
      Origin: srv.base,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
  });
  assert.equal(r.status, 200);
});

test('tools/list viser KUN det, nøglens scope tillader', async () => {
  const navne = async (scope) => (await rpc('tools/list', {}, noegler[scope]))
    .krop.result.tools.map((t) => t.name);

  const fuld = await navne('full');
  const laes = await navne('read');
  const fang = await navne('capture');
  const link = await navne('link');

  assert.ok(fuld.includes('create_note') && fuld.includes('search_notes') && fuld.includes('publish_note'));
  assert.deepEqual(fang, ['create_note'], 'en fangst-noegle ser praecis ét vaerktoej');
  assert.ok(!laes.includes('create_note'), 'en laese-noegle maa ikke kunne skrive');
  assert.ok(!laes.includes('publish_note'));
  assert.ok(link.includes('create_note') && link.includes('search_notes'));
  assert.ok(!link.includes('update_note') && !link.includes('publish_note'),
    'link er read+capture og ALDRIG write - ellers kunne doda slette arkivet');

  for (const t of (await rpc('tools/list')).krop.result.tools) {
    assert.ok(t.description && t.description.length > 20, `${t.name} mangler beskrivelse`);
    assert.equal(t.inputSchema.type, 'object');
  }
});

test('scope håndhæves også ved direkte kald, ikke kun i listen', async () => {
  // Listen er en HJAELP, ikke en spaerring: en klient kan kende navnet
  // alligevel og proeve.
  const r = await kald('search_notes', { query: 'noget' }, noegler.capture);
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /cannot read/);

  const w = await kald('publish_note', { id: 'x'.repeat(32) }, noegler.link);
  assert.equal(w.isError, true);
  assert.match(w.content[0].text, /cannot write/);
});

/* ======================================= værktøjerne ================== */

test('create_note laver noten, plukker mærket og svarer med id', async () => {
  const r = await kald('create_note', { text: 'Ny router i skabet #drift\n\nUniFi, 24 porte.' });
  assert.equal(r.isError, undefined, r.content && r.content[0].text);
  assert.match(r.content[0].text, /^Created: Ny router i skabet/);
  assert.match(r.content[0].text, /id: [a-f0-9]{32}/);
  assert.equal(r.structuredContent.note.title, 'Ny router i skabet');

  const note = await kald('get_note', { id: r.structuredContent.note.id });
  assert.match(note.content[0].text, /UniFi, 24 porte/);
  assert.match(note.content[0].text, /Tags: #drift/);
});

test('create_note med to=today lægger sig i dagens note', async () => {
  const en = await kald('create_note', { text: 'Ringe til tandlægen', to: 'today' });
  assert.match(en.content[0].text, /^Added to today's note/);
  const to = await kald('create_note', { text: 'Huske henvisningen', to: 'today' });
  assert.equal(to.structuredContent.note.id, en.structuredContent.note.id,
    'to fangster samme dag skal lande i den SAMME note');
  const note = await kald('get_note', { id: to.structuredContent.note.id });
  assert.match(note.content[0].text, /Ringe til tandlægen/);
  assert.match(note.content[0].text, /Huske henvisningen/);
});

test('create_note kan lægge noten i en notesbog ved NAVN', async () => {
  const bog = (await a.kald('POST', '/api/v1/notebooks', { name: 'Drift' })).data.notebook;
  const r = await kald('create_note', { text: 'Serverskabet', notebook: 'drift' });
  const note = (await a.kald('GET', `/api/v1/notes/${r.structuredContent.note.id}`)).data.note;
  assert.equal(note.notebookId, bog.id, 'navnet skal virke - en model kan ikke slaa et id op');
});

test('search_notes bruger appens egen syntaks', async () => {
  const r = await kald('search_notes', { query: 'router tag:drift' });
  assert.match(r.content[0].text, /Ny router i skabet/);
  assert.ok(r.structuredContent.results.length >= 1);

  const tom = await kald('search_notes', { query: 'findesheltbestemtikke' });
  assert.match(tom.content[0].text, /Nothing matches/);
});

test('get_note på et opdigtet id er en isError, ikke en protokolfejl', async () => {
  const r = await kald('get_note', { id: 'f'.repeat(32) });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /never invent an id/);
  // Fejlen skal ligge i RESULTATET: blandes de to, kan modellen ikke skelne
  // "du skrev et forkert id" fra "serveren er i stykker".
  const raa = await rpc('tools/call', { name: 'get_note', arguments: { id: 'f'.repeat(32) } });
  assert.equal(raa.krop.error, undefined);
});

test('append_note tilføjer uden at miste noget', async () => {
  const c = await kald('create_note', { text: 'Indkøb\n\n- kaffe' });
  const r = await kald('append_note', { id: c.structuredContent.note.id, text: '- filtre' });
  assert.match(r.content[0].text, /Added to “Indkøb”/);
  const note = await kald('get_note', { id: c.structuredContent.note.id });
  assert.match(note.content[0].text, /- kaffe/);
  assert.match(note.content[0].text, /- filtre/);
});

test('update_note erstatter, og kræver noget at ændre', async () => {
  const c = await kald('create_note', { text: 'Skal ændres' });
  const r = await kald('update_note', { id: c.structuredContent.note.id, title: 'Ændret', body: 'Ny tekst' });
  assert.match(r.content[0].text, /Saved “Ændret”/);
  const tom = await kald('update_note', { id: c.structuredContent.note.id });
  assert.equal(tom.isError, true);
  assert.match(tom.content[0].text, /Send a title or a body/);
});

test('list_notebooks og list_tags viser det, søgningen kan bruge', async () => {
  const b = await kald('list_notebooks', {});
  assert.match(b.content[0].text, /Drift/);
  assert.match(b.content[0].text, /id: [a-f0-9]{32}/);
  const t = await kald('list_tags', {});
  assert.match(t.content[0].text, /#drift/);
});

test('add_comment lander på noten', async () => {
  const c = await kald('create_note', { text: 'Noget at tale om' });
  const r = await kald('add_comment', { id: c.structuredContent.note.id, body: 'Er den stadig aktuel?' });
  assert.match(r.content[0].text, /Commented on “Noget at tale om”/);
  const liste = (await a.kald('GET', `/api/v1/notes/${c.structuredContent.note.id}/comments`)).data;
  assert.equal(liste.comments.length, 1);
  assert.equal(liste.comments[0].body, 'Er den stadig aktuel?');
});

test('publish_note giver en adresse, en besøgende kan bruge', async () => {
  const c = await kald('create_note', { text: 'Til kollegaerne\n\nSådan gør man.' });
  const r = await kald('publish_note', { id: c.structuredContent.note.id, slug: 'kollegaer' });
  assert.equal(r.isError, undefined, r.content && r.content[0].text);
  assert.match(r.content[0].text, /Published at \/w\/kollegaer/);

  const side = await fetch(`${srv.base}/w/kollegaer`);
  assert.equal(side.status, 200);
  assert.match(await side.text(), /Sådan gør man/);

  // Samme spaerring som knappen i appen: den samme note kan ikke udgives to
  // gange - og fejlen skal vaere en SAETNING, modellen kan handle paa.
  const igen = await kald('publish_note', { id: c.structuredContent.note.id });
  assert.equal(igen.isError, true);
  assert.match(igen.content[0].text, /already published/);
});

test('ukendt værktøj giver -32602', async () => {
  assert.equal((await rpc('tools/call', { name: 'nope', arguments: {} })).krop.error.code, -32602);
});

/* =================================== to brugere ======================= */

test('en nøgle når KUN sin egen brugers noter', async () => {
  await a.kald('POST', '/api/v1/admin', { allowRegistration: true });
  const b = klient(srv.base);
  await b.opret('anden', 'kodeord-1234');
  const bNoegle = (await b.kald('POST', '/api/v1/keys', { name: 'b', scope: 'full' })).data.key;

  const min = await kald('create_note', { text: 'Min hemmelige note' });
  const set = await kald('search_notes', { query: 'hemmelige' }, bNoegle);
  assert.match(set.content[0].text, /Nothing matches/, 'den anden bruger maa ikke kunne SOEGE den frem');

  const hent = await kald('get_note', { id: min.structuredContent.note.id }, bNoegle);
  assert.equal(hent.isError, true, 'og heller ikke hente den paa id');

  const skriv = await kald('append_note', { id: min.structuredContent.note.id, text: 'hejsa' }, bNoegle);
  assert.equal(skriv.isError, true);
});
