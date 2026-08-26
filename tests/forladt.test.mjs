/*
 * Vedhaeftninger, teksten ikke laengere peger paa.
 *
 * »Hvorfor vises der attachments selvom de er slettet paa en note ... Denne
 * boer kun vises hvis de er der. Den kan evt. vise dem i 24timer og saa fjerne
 * dem, hvis man kommer til at slette dem ved en fejl« (Andreas, 2026-08-25).
 *
 * ── Hvad proeverne maaler ─────────────────────────────────────────────────
 *
 * Ikke at et felt kan saettes. At de TRE tilstande er forskellige, og at
 * ingen af dem taber noget:
 *
 *   i noten          almindelig vedhaeftning
 *   nyligt forladt   staar der endnu, MED et maerke, og kan hentes tilbage
 *   forladt for laenge  vaek fra listen - men filen findes stadig
 *
 * Den vigtigste er den tredje: efter doegnet er filen ude af LISTEN, men den
 * er ikke slettet. Automatikken maa aldrig vaere haardere end den haand, der
 * trykker »Remove« - dér er der 30 dage.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { startServer, startServerPaa, klient } from './hjaelp.mjs';

let srv;
let a;

async function upload(kl, navn, noteId) {
  const q = new URLSearchParams({ name: navn, note: noteId });
  const r = await fetch(`${srv.base}/api/v1/files?${q}`, {
    method: 'POST',
    headers: { Cookie: kl.cookie, 'X-Sagu-Upload': '1', 'Content-Type': 'image/png' },
    body: Buffer.from('\x89PNG\r\n\x1a\nfake'),
  });
  return (await r.json()).file;
}

/** Notens filer, som fladen ser dem. */
const filerPaa = async (id) => (await a.kald('GET', `/api/v1/notes/${id}`)).data.note.files;

/** Baglaens-datering: der er ingen anden vej til »i gaar« end at flytte uret. */
function backdater(id, sekunder) {
  const db = new DatabaseSync(`${srv.dataDir}/sagu.db`);
  db.prepare('UPDATE attachments SET orphan_since = ? WHERE id = ?')
    .run(Math.floor(Date.now() / 1000) - sekunder, id);
  db.close();
}

before(async () => {
  srv = await startServer();
  a = klient(srv.base);
  await a.opret('alice', 'kodeord-1234');
});

test('en vedhaeftning, teksten peger paa, staar helt almindeligt', async () => {
  const n = (await a.kald('POST', '/api/v1/notes', { title: 'Med billede' })).data.note;
  const f = await upload(a, 'a.png', n.id);
  await a.kald('PATCH', `/api/v1/notes/${n.id}`, { body: `Se her:\n\n![a](sagu:${f.id})\n` });

  const filer = await filerPaa(n.id);
  assert.equal(filer.length, 1);
  assert.equal(filer[0].orphan_since, null, 'en fil i noten maa ikke vaere stemplet');
});

test('fjerner man henvisningen, faar filen et stempel — men bliver staaende', async () => {
  const n = (await a.kald('POST', '/api/v1/notes', { title: 'Ryddet' })).data.note;
  const f = await upload(a, 'b.png', n.id);
  await a.kald('PATCH', `/api/v1/notes/${n.id}`, { body: `![b](sagu:${f.id})\n` });
  await a.kald('PATCH', `/api/v1/notes/${n.id}`, { body: 'Billedet er slettet.\n' });

  const filer = await filerPaa(n.id);
  assert.equal(filer.length, 1, 'doegnet er ikke gaaet — den skal kunne hentes tilbage');
  assert.ok(filer[0].orphan_since > 0, 'og den skal BAERE, at den er forladt');
});

test('efter doegnet er den ude af listen', async () => {
  const n = (await a.kald('POST', '/api/v1/notes', { title: 'Gammel' })).data.note;
  const f = await upload(a, 'c.png', n.id);
  await a.kald('PATCH', `/api/v1/notes/${n.id}`, { body: `![c](sagu:${f.id})\n` });
  await a.kald('PATCH', `/api/v1/notes/${n.id}`, { body: 'Vaek.\n' });
  backdater(f.id, 25 * 3600);

  assert.equal((await filerPaa(n.id)).length, 0);
  // ... og i den anden liste, indstillingernes, ogsaa.
  const alle = (await a.kald('GET', '/api/v1/files')).data.files;
  assert.ok(!alle.some((x) => x.id === f.id), 'begge lister skal vaere enige');
});

test('men filen er IKKE slettet — den kan stadig hentes', async () => {
  const n = (await a.kald('POST', '/api/v1/notes', { title: 'Skjult, ikke vaek' })).data.note;
  const f = await upload(a, 'd.png', n.id);
  await a.kald('PATCH', `/api/v1/notes/${n.id}`, { body: `![d](sagu:${f.id})\n` });
  await a.kald('PATCH', `/api/v1/notes/${n.id}`, { body: 'Vaek.\n' });
  backdater(f.id, 25 * 3600);

  const r = await fetch(`${srv.base}/api/v1/files/${f.id}`, { headers: { Cookie: a.cookie } });
  assert.equal(r.status, 200, 'skjult i listen er ikke det samme som slettet');
});

test('kommer henvisningen tilbage, ryddes stemplet', async () => {
  const n = (await a.kald('POST', '/api/v1/notes', { title: 'Fortrudt' })).data.note;
  const f = await upload(a, 'e.png', n.id);
  await a.kald('PATCH', `/api/v1/notes/${n.id}`, { body: `![e](sagu:${f.id})\n` });
  await a.kald('PATCH', `/api/v1/notes/${n.id}`, { body: 'Ups.\n' });
  assert.ok((await filerPaa(n.id))[0].orphan_since > 0);

  // »Insert« goer praecis det her: saetter henvisningen ind igen og gemmer.
  await a.kald('PATCH', `/api/v1/notes/${n.id}`, { body: `Ups.\n\n![e](sagu:${f.id})\n` });
  assert.equal((await filerPaa(n.id))[0].orphan_since, null);
});

test('selv efter doegnet kan den hentes tilbage, saa laenge den ikke er ryddet', async () => {
  const n = (await a.kald('POST', '/api/v1/notes', { title: 'Sent fortrudt' })).data.note;
  const f = await upload(a, 'f.png', n.id);
  await a.kald('PATCH', `/api/v1/notes/${n.id}`, { body: `![f](sagu:${f.id})\n` });
  await a.kald('PATCH', `/api/v1/notes/${n.id}`, { body: 'Vaek.\n' });
  backdater(f.id, 25 * 3600);
  assert.equal((await filerPaa(n.id)).length, 0);

  await a.kald('PATCH', `/api/v1/notes/${n.id}`, { body: `![f](sagu:${f.id})\n` });
  const filer = await filerPaa(n.id);
  assert.equal(filer.length, 1, 'skriver man henvisningen igen, er filen tilbage');
  assert.equal(filer[0].orphan_since, null);
});

test('stemplet staar STILLE — en rettelse maa ikke starte doegnet forfra', async () => {
  /*
   * Uden `COALESCE` ville hver eneste gemning saette et nyt tidspunkt, og en
   * note man retter i hver dag ville aldrig faa ryddet sine forladte filer.
   */
  const n = (await a.kald('POST', '/api/v1/notes', { title: 'Rettet igen' })).data.note;
  const f = await upload(a, 'g.png', n.id);
  await a.kald('PATCH', `/api/v1/notes/${n.id}`, { body: `![g](sagu:${f.id})\n` });
  await a.kald('PATCH', `/api/v1/notes/${n.id}`, { body: 'Vaek.\n' });
  const foerste = (await filerPaa(n.id))[0].orphan_since;

  backdater(f.id, 23 * 3600);
  const backdateret = (await filerPaa(n.id))[0].orphan_since;
  await a.kald('PATCH', `/api/v1/notes/${n.id}`, { body: 'Vaek, og et komma til,\n' });

  assert.equal((await filerPaa(n.id))[0].orphan_since, backdateret,
    'stemplet skal vaere det samme efter endnu en rettelse');
  assert.ok(backdateret < foerste);
});

test('en henvisning i en kodeblok taeller ogsaa — oprydning skal fejle til fordel for at beholde', async () => {
  const n = (await a.kald('POST', '/api/v1/notes', { title: 'Dokumentation' })).data.note;
  const f = await upload(a, 'h.png', n.id);
  await a.kald('PATCH', `/api/v1/notes/${n.id}`,
    { body: 'Saadan skriver man det:\n\n```\n![h](sagu:' + f.id + ')\n```\n' });
  assert.equal((await filerPaa(n.id))[0].orphan_since, null);
});

test('en anden notes tekst redder ikke filen — stemplet foelger DENS note', async () => {
  const n1 = (await a.kald('POST', '/api/v1/notes', { title: 'Ejeren' })).data.note;
  const n2 = (await a.kald('POST', '/api/v1/notes', { title: 'Naboen' })).data.note;
  const f = await upload(a, 'i.png', n1.id);
  await a.kald('PATCH', `/api/v1/notes/${n1.id}`, { body: `![i](sagu:${f.id})\n` });
  // Naboen naevner filen; ejeren gør ikke laengere.
  await a.kald('PATCH', `/api/v1/notes/${n2.id}`, { body: `![i](sagu:${f.id})\n` });
  await a.kald('PATCH', `/api/v1/notes/${n1.id}`, { body: 'Vaek.\n' });

  assert.ok((await filerPaa(n1.id))[0].orphan_since > 0,
    'filen haenger paa n1, og n1 peger ikke laengere paa den');
});

test('oprydningen ved opstart bloedsletter den — og friver pladsen ad den ALMINDELIGE vej', async () => {
  /*
   * Det er her, automatikken faktisk fjerner noget, og derfor det, der skal
   * ses virke. Pointen er, at den vaelger den MILDE vej: `deleted_at`, praecis
   * som havde man trykket »Remove« - saa er der stadig 30 dage, hvor filen kan
   * hentes tilbage, hvis doegnet gik ubemaerket hen.
   *
   * Serveren genstartes, fordi `sweep()` koerer ved opstart. Uden genstarten
   * ville proeven ikke maale oprydningen, men kun laesefiltret - og det er
   * allerede maalt ovenfor.
   */
  const n = (await a.kald('POST', '/api/v1/notes', { title: 'Til oprydning' })).data.note;
  const f = await upload(a, 'j.png', n.id);
  await a.kald('PATCH', `/api/v1/notes/${n.id}`, { body: `![j](sagu:${f.id})\n` });
  await a.kald('PATCH', `/api/v1/notes/${n.id}`, { body: 'Vaek.\n' });
  backdater(f.id, 25 * 3600);

  const raek = () => {
    const db = new DatabaseSync(`${srv.dataDir}/sagu.db`);
    const r = db.prepare('SELECT deleted_at FROM attachments WHERE id = ?').get(f.id);
    db.close();
    return r;
  };
  assert.equal(raek().deleted_at, null, 'endnu ikke ryddet');

  const dataDir = srv.dataDir;
  // `stopOgVent`, ikke `stop`: den sidste SLETTER mappen, og saa er der
  // ingen database at starte paa igen.
  await srv.stopOgVent();
  srv = await startServerPaa(dataDir);
  assert.ok(raek().deleted_at > 0, 'opstarten skal have bloedslettet den');

  // Filen SELV er der endnu. Det er hele forskellen paa bloed og haard.
  const { existsSync } = await import('node:fs');
  const path = await import('node:path');
  assert.ok(existsSync(path.join(dataDir, 'files', f.id)),
    'bloedsletning maa ikke roere disken — den 30-dages frist er der stadig');
});

after(() => srv.stop());
