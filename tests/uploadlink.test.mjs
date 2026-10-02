/*
 * v97 - et billede ind via MCP: `create_upload_link` + en upload med curl.
 *
 * Koeres som en rigtig klient: MCP-kaldet med en noegle og ingen cookie, og
 * selve uploaden med INGEN legitimation ud over linket - som curl i Claude
 * Code. `--data-binary` sender `application/x-www-form-urlencoded`, saa den
 * type sendes her med vilje: typen skal gaettes af filnavnet.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, klient } from './hjaelp.mjs';

let srv;
let a;
let b;
const noegler = {};
let rpcId = 0;

async function kald(navn, args, noegle) {
  const r = await fetch(`${srv.base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${noegle || noegler.full}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name: navn, arguments: args } }),
  });
  return (await r.json()).result;
}

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

function send(url, krop, metode = 'POST', type = 'application/x-www-form-urlencoded') {
  return fetch(url, { method: metode, headers: { 'Content-Type': type }, body: krop });
}

async function nyNote(titel) {
  return (await kald('create_note', { text: titel })).structuredContent.note.id;
}

before(async () => {
  srv = await startServer();
  a = klient(srv.base);
  await a.opret('ejer', 'kodeord-1234');
  for (const scope of ['read', 'full', 'link']) {
    noegler[scope] = (await a.kald('POST', '/api/v1/keys', { name: scope, scope })).data.key;
  }
});

after(() => srv.stop());

test('linket peger paa serveren selv og bruges med curl', async () => {
  const id = await nyNote('Med billede');
  const r = await kald('create_upload_link', { id, filename: 'diagram.png' });
  assert.ok(!r.isError, r.content[0].text);
  const url = r.structuredContent.url;
  assert.match(url, /\/api\/v1\/upload\/[A-Za-z0-9_-]{20,}$/);
  assert.ok(url.startsWith(srv.base), 'linket skal pege paa den vaert, klienten talte med');
  assert.match(r.content[0].text, /curl -sS --data-binary @/);

  const svar = await send(url, PNG);
  const d = await svar.json();
  assert.equal(svar.status, 200, JSON.stringify(d));
  assert.equal(d.inserted, true);
  assert.equal(d.file.mime, 'image/png', 'typen gaettes af endelsen, ikke af curls form-urlencoded');
  assert.equal(d.file.inline, true);

  const note = (await kald('get_note', { id })).structuredContent.note;
  assert.ok(note.body.trimEnd().endsWith(`![diagram.png](sagu:${d.file.id})`), note.body);
  assert.ok(note.files.some((f) => f.id === d.file.id));
});

test('linket virker kun én gang', async () => {
  const id = await nyNote('Én gang');
  const { url } = (await kald('create_upload_link', { id, filename: 'a.png' })).structuredContent;
  assert.equal((await send(url, PNG)).status, 200);
  const igen = await send(url, PNG);
  assert.equal(igen.status, 404);
  assert.match((await igen.json()).message, /unknown, used or expired/);
});

test('PUT virker ogsaa (curl -T), og insert:false laegger den kun i bilagene', async () => {
  const id = await nyNote('Kun bilag');
  const { url } = (await kald('create_upload_link', { id, filename: 'log.txt', insert: false })).structuredContent;
  const svar = await send(url, 'linje 1\n', 'PUT', '');
  const d = await svar.json();
  assert.equal(svar.status, 200, JSON.stringify(d));
  assert.equal(d.inserted, false);
  assert.equal(d.file.mime, 'text/plain');
  const note = (await kald('get_note', { id })).structuredContent.note;
  assert.ok(!note.body.includes('sagu:'), 'teksten maa ikke roeres med insert:false');
});

test('en fejlet upload (tom fil) forbruger ikke linket', async () => {
  const id = await nyNote('Proev igen');
  const { url } = (await kald('create_upload_link', { id, filename: 'b.png' })).structuredContent;
  assert.equal((await send(url, Buffer.alloc(0))).status, 400);
  assert.equal((await send(url, PNG)).status, 200);
});

test('et opdigtet link afvises', async () => {
  const r = await send(`${srv.base}/api/v1/upload/${'x'.repeat(32)}`, PNG);
  assert.equal(r.status, 404);
});

test('kun en noegle, der maa skrive, ser vaerktoejet - og kun til en note, man maa skrive i', async () => {
  const liste = async (n) => (await fetch(`${srv.base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${n}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/list' }),
  }).then((r) => r.json())).result.tools.map((t) => t.name);
  assert.ok((await liste(noegler.full)).includes('create_upload_link'));
  assert.ok(!(await liste(noegler.read)).includes('create_upload_link'));
  assert.ok(!(await liste(noegler.link)).includes('create_upload_link'), 'link-scope maa aldrig skrive');

  const r = await kald('create_upload_link', { id: 'f'.repeat(32), filename: 'x.png' });
  assert.equal(r.isError, true);

  // En anden brugers note: findes ikke for mig.
  b = klient(srv.base);
  await a.kald('POST', '/api/v1/admin', { allowRegistration: true });
  await b.opret('anden', 'kodeord-5678');
  const hans = (await b.kald('POST', '/api/v1/notes', { title: 'Hans', body: '' })).data.note.id;
  const r2 = await kald('create_upload_link', { id: hans, filename: 'x.png' });
  assert.equal(r2.isError, true, 'man maa ikke faa et link til en fremmed note');
});
