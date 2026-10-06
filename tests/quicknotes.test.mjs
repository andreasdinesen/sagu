/*
 * v101: notesbogen »Quicknotes« staar ALTID oeverst - ogsaa over de stjernede.
 * Quicknoterne (⌘⌥N) lander dér, og den skal kunne findes uden at lede.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, klient } from './hjaelp.mjs';

let srv;
let a;

before(async () => {
  srv = await startServer();
  a = klient(srv.base);
  await a.opret('alice', 'kodeord-1234');
});

after(() => srv.stop());

test('Quicknotes staar oeverst - foer de stjernede og uanset hvornaar den blev lavet', async () => {
  const lav = async (name) => (await a.kald('POST', '/api/v1/notebooks', { name })).data.notebook;
  const aaa = await lav('Aaa');
  await lav('Bbb');
  // Lavet SIDST og med smaa bogstaver - quicknoten finder den paa navnet,
  // uden at skelne store og smaa, og det goer sorteringen ogsaa.
  await lav('quicknotes');
  await a.kald('PATCH', `/api/v1/notebooks/${aaa.id}`, { starred: true });

  const r = await a.kald('GET', '/api/v1/tree');
  const navne = r.data.notebooks.map((b) => b.name);
  assert.deepEqual(navne.slice(0, 3), ['quicknotes', 'Aaa', 'Bbb'],
    'Quicknotes foerst, saa den stjernede, saa resten');
});
