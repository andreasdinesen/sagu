/*
 * F1's acceptkriterium: »et træ i fem niveauer kan foldes, flyttes og slettes
 * uden at miste børn«.
 *
 * Foldningen er frontendens; her testes de tre andre - plus cyklus-vagten,
 * som er den fejl, der ikke raaber op: en note traukket ind under sit eget
 * barn giver en ring, hvor begge forsvinder fra sidebaren, og gemningen
 * lykkes.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { startServer, klient } from './hjaelp.mjs';

let srv;
let a;
let bog;
/** n[0] .. n[4] - fem niveauer, hver sit barn. */
const n = [];

before(async () => {
  srv = await startServer();
  a = klient(srv.base);
  await a.opret('alice', 'kodeord-1234');
  bog = (await a.kald('POST', '/api/v1/notebooks', { name: 'Drift' })).data.notebook;

  let foraelder = null;
  for (let i = 0; i < 5; i++) {
    const r = await a.kald('POST', '/api/v1/notes',
      { title: `Niveau ${i}`, body: `krop ${i}`, notebookId: bog.id, parentId: foraelder });
    n.push(r.data.note);
    foraelder = r.data.note.id;
  }
});

after(() => srv.stop());

test('traeet kommer i ÉT kald, i vilkaarlig dybde', async () => {
  // Et kald pr. niveau ville vaere lige saa mange blokerende rundture som
  // traeet er dybt - ~150 ms hver gennem tunnelen (DESIGN.md, maaling 3).
  const r = await a.kald('GET', '/api/v1/tree');
  assert.equal(r.status, 200);
  assert.equal(r.data.notebooks.length, 1);
  assert.equal(r.data.notes.length, 5);

  // Kan traeet samles af svaret alene?
  const kort = new Map(r.data.notes.map((x) => [x.id, x]));
  let dybde = 0;
  let cur = kort.get(n[4].id);
  while (cur && cur.parentId) { dybde++; cur = kort.get(cur.parentId); }
  assert.equal(dybde, 4, 'femte niveau skal have fire foraeldre over sig');
  assert.equal(kort.get(n[0].id).childCount, 1, 'antallet af boern skal med, ellers kan man ikke tegne en folde-trekant');
  // ... og traeet er en LISTE: ingen broedtekst.
  assert.ok(!JSON.stringify(r.data).includes('krop 3'), 'traeet maa ikke baere body_md');
});

test('en note kan IKKE flyttes ind under sit eget barn', async () => {
  // Uden vagten bliver traeet en ring: begge noter forsvinder fra sidebaren,
  // fordi ingen af dem har en rod, og enhver gennemloebning haenger.
  // Fejlen er tavs - gemningen lykkes.
  const r = await a.kald('POST', `/api/v1/notes/${n[0].id}/move`, { parentId: n[3].id });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'would_loop');

  // ... og traeet er uroert.
  const t = (await a.kald('GET', '/api/v1/tree')).data.notes;
  assert.equal(t.find((x) => x.id === n[0].id).parentId, null);
  assert.equal(t.find((x) => x.id === n[3].id).parentId, n[2].id);
});

test('en note kan ikke flyttes ind under SIG SELV', async () => {
  const r = await a.kald('POST', `/api/v1/notes/${n[2].id}/move`, { parentId: n[2].id });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'would_loop');
});

test('en flytning tager hele undertraeet med til den nye notesbog', async () => {
  const bog2 = (await a.kald('POST', '/api/v1/notebooks', { name: 'Arkiv' })).data.notebook;
  // Flyt niveau 2 (med 3 og 4 under sig) til roden af den anden bog.
  const r = await a.kald('POST', `/api/v1/notes/${n[2].id}/move`,
    { parentId: null, notebookId: bog2.id });
  assert.equal(r.status, 200);

  const t = (await a.kald('GET', '/api/v1/tree')).data.notes;
  for (const id of [n[2].id, n[3].id, n[4].id]) {
    assert.equal(t.find((x) => x.id === id).notebookId, bog2.id,
      'et undertrae maa ikke ligge spredt over to notesboeger');
  }
  assert.equal(t.find((x) => x.id === n[1].id).notebookId, bog.id, 'resten blev hvor den var');
  // Og boernene haenger stadig paa deres foraeldre.
  assert.equal(t.find((x) => x.id === n[3].id).parentId, n[2].id);
  assert.equal(t.find((x) => x.id === n[4].id).parentId, n[3].id);

  // Flyt tilbage, saa resten af testene staar paa det oprindelige trae.
  await a.kald('POST', `/api/v1/notes/${n[2].id}/move`, { parentId: n[1].id });
});

test('sletning tager undersiderne med - ingen foraeldreloese noter', async () => {
  const r = await a.kald('DELETE', `/api/v1/notes/${n[2].id}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.deleted, 3, 'niveau 2, 3 og 4');

  const t = (await a.kald('GET', '/api/v1/tree')).data.notes;
  assert.deepEqual(t.map((x) => x.title).sort(), ['Niveau 0', 'Niveau 1']);
  const skrald = (await a.kald('GET', '/api/v1/notes?trash=1')).data.notes;
  assert.equal(skrald.length, 3);
});

test('gendannelse vaekker PRAECIS dem, sletningen tog - ikke dem, jeg selv slettede', async () => {
  // Den dyre variant af fejlen: en genaabning, der ogsaa vaekker noget,
  // brugeren bevidst smed ud (RUNE-ERFARINGER, doda F3).
  const ekstra = (await a.kald('POST', '/api/v1/notes',
    { title: 'Slettet for sig', parentId: n[1].id })).data.note;
  await a.kald('DELETE', `/api/v1/notes/${ekstra.id}`);

  const r = await a.kald('POST', `/api/v1/notes/${n[2].id}/restore`);
  assert.equal(r.status, 200);
  assert.equal(r.data.restored, 3, 'niveau 2, 3 og 4 - og INTET andet');

  const t = (await a.kald('GET', '/api/v1/tree')).data.notes;
  assert.equal(t.length, 5, 'de fem er tilbage');
  assert.ok(!t.some((x) => x.id === ekstra.id), 'den enkeltvis slettede skal BLIVE i papirkurven');
  // Traeet er intakt hele vejen ned.
  assert.equal(t.find((x) => x.id === n[4].id).parentId, n[3].id);
  assert.equal(t.find((x) => x.id === n[2].id).parentId, n[1].id);
});

test('en gendannet note, hvis foraelder stadig er slettet, lander i roden', async () => {
  // Ellers ville den vaere usynlig: den peger paa noget, sidebaren ikke tegner.
  const f = (await a.kald('POST', '/api/v1/notes', { title: 'Foraelder' })).data.note;
  const b = (await a.kald('POST', '/api/v1/notes', { title: 'Barn', parentId: f.id })).data.note;
  await a.kald('DELETE', `/api/v1/notes/${f.id}`);

  const r = await a.kald('POST', `/api/v1/notes/${b.id}/restore`);
  assert.equal(r.status, 200);
  assert.equal(r.data.note.parentId, null, 'loesrevet, saa den kan SES');
  const t = (await a.kald('GET', '/api/v1/tree')).data.notes;
  assert.ok(t.some((x) => x.id === b.id));
  await a.kald('DELETE', `/api/v1/notes/${b.id}`);
});

test('duplikering: kun noten, eller hele undertraeet', async () => {
  const kun = await a.kald('POST', `/api/v1/notes/${n[2].id}/duplicate`, {});
  assert.equal(kun.status, 200);
  assert.equal(kun.data.note.title, 'Niveau 2 (copy)');
  assert.equal(kun.data.note.body, 'krop 2', 'indholdet skal med');
  assert.equal(kun.data.note.childCount, 0, 'uden boern var det uden boern');

  const alt = await a.kald('POST', `/api/v1/notes/${n[2].id}/duplicate`, { withChildren: true });
  assert.equal(alt.status, 200);
  const t = (await a.kald('GET', '/api/v1/tree')).data.notes;
  const kopi = t.find((x) => x.id === alt.data.note.id);
  // Kopiens boern skal haenge paa KOPIEN, ikke paa originalen.
  const boern = t.filter((x) => x.parentId === kopi.id);
  assert.equal(boern.length, 1, 'kopien har sit eget barn');
  assert.equal(boern[0].title, 'Niveau 3');
  const barnebarn = t.filter((x) => x.parentId === boern[0].id);
  assert.equal(barnebarn.length, 1, 'og sit eget barnebarn');
  assert.equal(t.filter((x) => x.parentId === n[2].id).length, 1,
    'originalen har stadig praecis ét barn');

  // Rens op, saa senere tests har et forudsigeligt trae.
  await a.kald('DELETE', `/api/v1/notes/${kun.data.note.id}`);
  await a.kald('DELETE', `/api/v1/notes/${alt.data.note.id}`);
});

test('en kopi arver ikke Notion-id\'et', async () => {
  // Ellers ville en genimport tro, at kopien er originalen, og skrive oven i
  // den. Importen matcher paa ext_id (F5).
  const org = (await a.kald('POST', '/api/v1/notes',
    { title: 'Fra Notion', extId: 'abc123' })).data.note;
  assert.equal(org.extId, 'abc123');
  const kopi = (await a.kald('POST', `/api/v1/notes/${org.id}/duplicate`, {})).data.note;
  assert.equal(kopi.extId, null, 'kopien maa ikke baere originalens Notion-id');
  await a.kald('DELETE', `/api/v1/notes/${org.id}`);
});

test('manuel sortering skriver seq = pladsen i listen', async () => {
  const ider = [n[1].id, n[0].id];
  const r = await a.kald('POST', '/api/v1/reorder', { kind: 'note', ids: ider });
  assert.equal(r.status, 200);

  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(srv.dataDir, 'sagu.db'));
  const seq = Object.fromEntries(db.prepare('SELECT id, seq FROM notes').all().map((x) => [x.id, x.seq]));
  db.close();
  assert.equal(seq[n[1].id], 0);
  assert.equal(seq[n[0].id], 1);
});

test('en notesbog kan omdoebes og arkiveres', async () => {
  const r = await a.kald('PATCH', `/api/v1/notebooks/${bog.id}`, { name: 'Drift og backup', icon: '🔧' });
  assert.equal(r.status, 200);
  assert.equal(r.data.notebook.name, 'Drift og backup');
  assert.equal(r.data.notebook.icon, '🔧');

  await a.kald('PATCH', `/api/v1/notebooks/${bog.id}`, { archived: true });
  const b = (await a.kald('GET', '/api/v1/notebooks')).data.notebooks.find((x) => x.id === bog.id);
  assert.ok(b.archived_at, 'arkiveret skal vaere et TIDSSTEMPEL');
  await a.kald('PATCH', `/api/v1/notebooks/${bog.id}`, { archived: false });
});

test('sletning af en notesbog tager dens noter i papirkurven', async () => {
  const b2 = (await a.kald('POST', '/api/v1/notebooks', { name: 'Til sletning' })).data.notebook;
  await a.kald('POST', '/api/v1/notes', { title: 'i bogen 1', notebookId: b2.id });
  await a.kald('POST', '/api/v1/notes', { title: 'i bogen 2', notebookId: b2.id });

  const r = await a.kald('DELETE', `/api/v1/notebooks/${b2.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.notes, 2);
  const t = (await a.kald('GET', '/api/v1/tree')).data;
  assert.ok(!t.notebooks.some((x) => x.id === b2.id));
  assert.ok(!t.notes.some((x) => x.title.startsWith('i bogen')));
});

/* ------------------------------------------------------------- links */

test('[[henvisninger]] gemmes som raekker og giver backlinks den anden vej', async () => {
  const maal = (await a.kald('POST', '/api/v1/notes', { title: 'Backup-rutine' })).data.note;
  const fra = (await a.kald('POST', '/api/v1/notes',
    { title: 'Ugentlig drift', body: 'Se [[Backup-rutine]] for detaljerne.' })).data.note;

  const set = (await a.kald('GET', `/api/v1/notes/${maal.id}`)).data.note;
  assert.equal(set.backlinks.length, 1, 'maalet skal vide, hvem der peger paa den');
  assert.equal(set.backlinks[0].id, fra.id);
  assert.equal(set.backlinks[0].title, 'Ugentlig drift');
});

test('link-tabellen rives NED og bygges op ved hvert gem - den diffes ikke', async () => {
  // En diff er en anden beskrivelse af det samme faktum, og den kan blive
  // uenig med teksten. Det er dét, den her aldrig maa.
  const et = (await a.kald('POST', '/api/v1/notes', { title: 'Maal Et' })).data.note;
  const to = (await a.kald('POST', '/api/v1/notes', { title: 'Maal To' })).data.note;
  const fra = (await a.kald('POST', '/api/v1/notes',
    { title: 'Peger', body: 'se [[Maal Et]]' })).data.note;

  assert.equal((await a.kald('GET', `/api/v1/notes/${et.id}`)).data.note.backlinks.length, 1);

  // Skift maalet ud i TEKSTEN. Tabellen skal foelge med, begge veje.
  await a.kald('PATCH', `/api/v1/notes/${fra.id}`, { body: 'se [[Maal To]]' });
  assert.equal((await a.kald('GET', `/api/v1/notes/${et.id}`)).data.note.backlinks.length, 0,
    'det gamle link skal vaere VAEK, ikke bare suppleret');
  assert.equal((await a.kald('GET', `/api/v1/notes/${to.id}`)).data.note.backlinks.length, 1);
});

test('et link til en note, der ikke findes, blokerer ikke gemningen', async () => {
  const r = await a.kald('POST', '/api/v1/notes',
    { title: 'Peger i tomrummet', body: 'se [[Findes Slet Ikke]]' });
  assert.equal(r.status, 200);
  // Teksten staar der stadig - en doed henvisning er en kendsgerning om
  // noten, ikke en fejl.
  assert.match((await a.kald('GET', `/api/v1/notes/${r.data.note.id}`)).data.note.body,
    /\[\[Findes Slet Ikke\]\]/);
});

test('en note kan ikke linke til SIG SELV', async () => {
  const r = (await a.kald('POST', '/api/v1/notes', { title: 'Selvhenviser' })).data.note;
  await a.kald('PATCH', `/api/v1/notes/${r.id}`, { body: 'se [[Selvhenviser]]' });
  const set = (await a.kald('GET', `/api/v1/notes/${r.id}`)).data.note;
  assert.equal(set.backlinks.length, 0, 'en note er ikke sin egen backlink');
});

/* --------------------------------------------------------- historikken */

test('historikken har en post pr. gem - F1s acceptkriterium', async () => {
  const note = (await a.kald('POST', '/api/v1/notes', { title: 'Med historik', body: 'et' })).data.note;
  await a.kald('PATCH', `/api/v1/notes/${note.id}`, { body: 'to' });
  await a.kald('PATCH', `/api/v1/notes/${note.id}`, { title: 'Nyt navn' });
  await a.kald('PATCH', `/api/v1/notes/${note.id}`, { icon: '📌' });   // roerer hverken titel eller krop

  const r = await a.kald('GET', `/api/v1/notes/${note.id}/versions`);
  assert.equal(r.status, 200);
  assert.equal(r.data.versions.length, 3, 'oprettelse + to indholdsaendringer, ikke ikonet');
  assert.equal(r.data.versions[0].title, 'Nyt navn', 'nyeste foerst');
});

test('en 200 KB note gemmes og hentes uden maerkbar forsinkelse', async () => {
  // F1s acceptkriterium. Maalt over http mod den rigtige server.
  const stor = `# Stor\n\n${'Et afsnit med **fed** og `kode`.\n\n'.repeat(6200)}`;
  assert.ok(stor.length > 200000, `testnoten er kun ${stor.length} tegn`);

  const t0 = Date.now();
  const ny = await a.kald('POST', '/api/v1/notes', { title: 'Stor note', body: stor });
  const gem = Date.now() - t0;
  assert.equal(ny.status, 200);

  const t1 = Date.now();
  const hent = await a.kald('GET', `/api/v1/notes/${ny.data.note.id}`);
  const laes = Date.now() - t1;
  assert.equal(hent.data.note.body.length, stor.length);

  assert.ok(gem < 1500, `gemningen tog ${gem} ms`);
  assert.ok(laes < 1500, `hentningen tog ${laes} ms`);
  console.log(`      ${(stor.length / 1024).toFixed(0)} KB: gem ${gem} ms, hent ${laes} ms`);

  // ... og den store krop maa stadig ikke sive ud i traeet.
  const t = await a.kald('GET', '/api/v1/tree');
  assert.ok(JSON.stringify(t.data).length < 20000,
    'traeet voksede med notens stoerrelse - det er Kokkeris 247 MB-fejl');
});

/* --------------------------------------------------------- isolation */

test('ISOLATION: traeet, flytning, duplikering og gendannelse er pr. bruger', async () => {
  // Isolationstesten koeres i HVER fase, ogsaa paa de nye ruter.
  const b = klient(srv.base);
  await a.kald('POST', '/api/v1/admin', { allowRegistration: true });
  await b.opret('bob', 'kodeord-1234');

  const bTrae = await b.kald('GET', '/api/v1/tree');
  assert.equal(bTrae.data.notes.length, 0, 'bob ser ingen af alices noter');
  assert.equal(bTrae.data.notebooks.length, 0);

  for (const [metode, sti, krop] of [
    ['POST', `/api/v1/notes/${n[0].id}/move`, { parentId: null }],
    ['POST', `/api/v1/notes/${n[0].id}/duplicate`, {}],
    ['POST', `/api/v1/notes/${n[0].id}/restore`, {}],
    ['GET', `/api/v1/notes/${n[0].id}/versions`, undefined],
    ['PATCH', `/api/v1/notebooks/${bog.id}`, { name: 'kapret' }],
    ['DELETE', `/api/v1/notebooks/${bog.id}`, undefined],
  ]) {
    const r = await b.kald(metode, sti, krop);
    assert.equal(r.status, 404, `${metode} ${sti} gav ${r.status} i stedet for 404`);
  }

  // Omordning maa ikke kunne roere en fremmed raekke, heller ikke ved at
  // blande dens id ind i listen.
  await b.kald('POST', '/api/v1/reorder', { kind: 'note', ids: [n[0].id, n[1].id] });
  const efter = (await a.kald('GET', '/api/v1/tree')).data.notes;
  assert.ok(efter.length >= 5, 'alices trae staar uroert');
  assert.equal((await b.kald('GET', '/api/v1/tree')).data.notes.length, 0);
});

test('den ENKELTE note har sine maerker - ikke kun listen', async () => {
  // medMaerker() blev kun kaldt paa lister, saa hentNote gav altid tags: [].
  // To veje til samme slags objekt skal give samme FORM (doda F5).
  const n = (await a.kald('POST', '/api/v1/notes', { title: 'Med maerker' })).data.note;
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(srv.dataDir, 'sagu.db'));
  const bruger = db.prepare('SELECT id FROM users ORDER BY created_at LIMIT 1').get().id;
  db.prepare('INSERT INTO tags (id, user_id, name, created_at) VALUES (?,?,?,?)')
    .run('cc'.repeat(16), bruger, 'drift', 1);
  db.prepare('INSERT INTO note_tags (note_id, tag_id) VALUES (?,?)').run(n.id, 'cc'.repeat(16));
  db.close();

  const enkelt = (await a.kald('GET', `/api/v1/notes/${n.id}`)).data.note;
  assert.deepEqual(enkelt.tags, ['drift'], 'den enkelte note skal baere sine maerker');
  const iListen = (await a.kald('GET', '/api/v1/notes')).data.notes.find((x) => x.id === n.id);
  assert.deepEqual(iListen.tags, enkelt.tags, 'listen og den enkelte skal vaere enige');
});

test('MAERKER kan saettes, fjernes og oprettes undervejs', async () => {
  /*
   * Fundet af Andreas paa foerste brugsdag, 2026-08-21: »jeg kan ikke oprette
   * nye tags med #«. Maerkerne laa i datamodellen fra F0 og blev sat af
   * Notion-importen - men der fandtes ingen vej til at saette et selv, og
   * »Tags«-skaermen sagde »arrives in F3« længe efter F3 var bygget.
   */
  const n = (await a.kald('POST', '/api/v1/notes', { title: 'Maerket note' })).data.note;
  assert.deepEqual(n.tags, []);

  // Maerket oprettes af sig selv - »opret foerst, haeng paa bagefter« er et
  // trin, ingen tager.
  const et = await a.kald('PATCH', `/api/v1/notes/${n.id}`, { tags: ['drift', 'vpn'] });
  assert.deepEqual(et.data.note.tags.slice().sort(), ['drift', 'vpn']);

  /*
   * Samme maerke med andet bogstavsleje er DET SAMME maerke - to, der ser ens
   * ud, er den hurtigste vej til et arkiv, ingen kan filtrere i.
   *
   * Og maerket beholder sin OPRINDELIGE stavemaade: at skrive »Drift« paa én
   * note maa ikke doebe maerket om paa alle de andre. En omdoebning er en
   * anden handling end at haenge et maerke paa.
   */
  const to = await a.kald('PATCH', `/api/v1/notes/${n.id}`, { tags: ['Drift', 'DRIFT', 'nyt'] });
  assert.deepEqual(to.data.note.tags.slice().sort(), ['drift', 'nyt']);

  // Listen er HELE listen: det, der ikke staar i den, er fjernet.
  const tre = await a.kald('PATCH', `/api/v1/notes/${n.id}`, { tags: [] });
  assert.deepEqual(tre.data.note.tags, []);

  /*
   * ... og et maerke uden noter BLIVER staaende.
   *
   * Foerste udgave ryddede tomme maerker op automatisk. Det loed rigtigt (»et
   * maerke uden noter er en rest«) og gjorde »opret et maerke« umuligt: det
   * forsvandt i samme sekund, det blev lavet. Andreas ramte det paa foerste
   * brugsdag. Et maerke lever nu, til nogen sletter det - saa man kan laegge
   * sin struktur foerst og fylde den bagefter.
   */
  const alle = (await a.kald('GET', '/api/v1/state')).data.tags.map((t) => t.name);
  assert.ok(alle.includes('vpn'), `vpn skal blive staaende: ${alle.join(', ')}`);

  // Et maerke kan laves for sig ...
  const nyt = await a.kald('POST', '/api/v1/tags', { name: '#helt-nyt' });
  assert.equal(nyt.status, 200);
  assert.equal(nyt.data.tag.name, 'helt-nyt', 'et foranstillet # hoerer til syntaksen');
  // ... og at lave det igen er ikke en fejl: en oprettelse, der faelder paa
  // »findes«, tvinger klienten til at spoerge foerst.
  const igen = await a.kald('POST', '/api/v1/tags', { name: 'Helt-Nyt' });
  assert.equal(igen.status, 200);
  assert.equal(igen.data.tag.id, nyt.data.tag.id, 'samme maerke, ikke et nyt');

  // At slette et maerke roerer ikke noterne - kun koblingen.
  await a.kald('PATCH', `/api/v1/notes/${n.id}`, { tags: ['helt-nyt'] });
  const slettet = await a.kald('DELETE', `/api/v1/tags/${nyt.data.tag.id}`);
  assert.equal(slettet.data.notes, 1, 'den skal sige, hvor mange noter der mistede maerket');
  const efter = (await a.kald('GET', `/api/v1/notes/${n.id}`)).data.note;
  assert.deepEqual(efter.tags, [], 'noten lever, maerket er vaek');

  // Maerker skal kunne saettes ved OPRETTELSEN - ellers skal en iOS-genvej
  // lave to kald og kan komme til at lave det ene.
  const m = (await a.kald('POST', '/api/v1/notes', { title: 'Fanget', tags: ['#fra-genvej'] })).data.note;
  assert.deepEqual(m.tags, ['fra-genvej'], 'et foranstillet # hoerer til syntaksen, ikke til navnet');

  // Og et maerke vejer i soegningen (DESIGN.md maaling 2) - indekset skal med.
  const soeg = await a.kald('GET', '/api/v1/search?q=tag%3Afra-genvej');
  assert.equal(soeg.data.results.length, 1);
  assert.equal(soeg.data.results[0].id, m.id);
});
