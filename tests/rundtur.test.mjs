/*
 * RUNDTUREN. »Projektets vigtigste test« (CLAUDE.md).
 *
 * »Man kan eksportere og importere« er en PAASTAND, indtil der findes en
 * test, der SLETTER databasen (RUNE-ERFARINGER, doda F9). Moensteret:
 *
 *   fyld en rigtig server med én af hver slags
 *   → eksportér
 *   → rmSync paa BAADE sagu.db* og filmappen
 *   → start serveren forfra og tjek at needsSetup er true
 *      (saa ved man, at sletningen virkede - ellers maaler man ingenting)
 *   → gendan i portioner, som UI'et gør
 *   → sammenlign et FINGERAFTRYK af hele systemet, felt for felt
 *   → og hent en vedhaeftet fil og sammenlign dens INDHOLD, ikke kun dens
 *     metadata
 *
 * Det er den eneste maade at turde sige, at Andreas' data ikke er laast inde.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServerPaa, klient } from './hjaelp.mjs';

const require = createRequire(import.meta.url);
const ROD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const zipmod = require(path.join(ROD, 'app', 'zip.js'));

/** Ét af hver slags, saa rundturen daekker hele modellen. */
async function fyld(base, kl) {
  const bog = (await kl.kald('POST', '/api/v1/notebooks', { name: 'Drift', icon: '🔧' })).data.notebook;
  const rod = (await kl.kald('POST', '/api/v1/notes', {
    title: 'Hjorten', notebookId: bog.id,
    body: '# Hjorten\n\n## Netvaerk\n\n- [ ] tjek tunnel\n- [x] skift certifikat\n\n'
      + '> [!WARNING]\n> Genstart ikke i arbejdstiden.\n\n'
      + '| Tjeneste | Port |\n|---|---:|\n| Panel | 8080 |\n\n'
      + '```sh\ndocker compose up -d\n```\n\nSe [[Backup-rutine]] og https://dr.dk.',
  })).data.note;
  const barn = (await kl.kald('POST', '/api/v1/notes', {
    title: 'Netkort', notebookId: bog.id, parentId: rod.id, body: 'Et barn med **fed** tekst.',
  })).data.note;
  await kl.kald('POST', '/api/v1/notes', {
    title: 'Backup-rutine', notebookId: bog.id, body: 'Ugentligt. Se [[Hjorten]].',
  });
  const loes = (await kl.kald('POST', '/api/v1/notes', {
    title: 'Uden notesbog', body: 'ligger loest', extId: 'a'.repeat(32),
  })).data.note;
  await kl.kald('PATCH', `/api/v1/notes/${loes.id}`, { fullWidth: true, icon: '📌' });
  const arkiveret = (await kl.kald('POST', '/api/v1/notes', { title: 'Afsluttet' })).data.note;
  await kl.kald('PATCH', `/api/v1/notes/${arkiveret.id}`, { archived: true });

  // En vedhaeftning med indhold, der kan sammenlignes BYTE for byte.
  const indhold = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7) % 251));
  const r = await fetch(`${base}/api/v1/files?name=data.png&note=${rod.id}`, {
    method: 'POST',
    headers: { Cookie: kl.cookie, 'X-Sagu-Upload': '1', 'Content-Type': 'image/png' },
    body: indhold,
  });
  const fil = (await r.json()).file;
  await kl.kald('PATCH', `/api/v1/notes/${rod.id}`,
    { body: `${rod.body}\n\n![data](sagu:${fil.id})` });

  // Maerker og egenskaber, som importen ville have sat dem.
  const { DatabaseSync } = await import('node:sqlite');
  return { bog, rod, barn, loes, arkiveret, fil, indhold, DatabaseSync };
}

/**
 * Et fingeraftryk af HELE systemet, som brugeren ser det gennem API'et.
 *
 * Sammenlignes foer og efter. At sammenligne databasen direkte ville ogsaa
 * fange ting, ingen kan se - og MISSE ting, API'et regner ud.
 */
async function fingeraftryk(kl) {
  const trae = (await kl.kald('GET', '/api/v1/tree')).data;
  const noter = [];
  for (const n of [...trae.notes].sort((a, b) => a.title.localeCompare(b.title))) {
    const fuld = (await kl.kald('GET', `/api/v1/notes/${n.id}`)).data.note;
    noter.push({
      id: fuld.id,
      title: fuld.title,
      body: fuld.body,
      icon: fuld.icon,
      fullWidth: fuld.fullWidth,
      archived: fuld.archived,
      extId: fuld.extId,
      createdAt: fuld.createdAt,
      notebookId: fuld.notebookId,
      parentId: fuld.parentId,
      tags: [...fuld.tags].sort(),
      props: [...fuld.props].sort((a, b) => a.key.localeCompare(b.key)),
      files: [...fuld.files].map((f) => ({ id: f.id, name: f.name, size: f.size, mime: f.mime }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      backlinks: [...fuld.backlinks].map((b) => b.id).sort(),
    });
  }
  return {
    notebooks: [...trae.notebooks].map((b) => ({ id: b.id, name: b.name, icon: b.icon }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    noter,
  };
}

test('RUNDTUREN: eksportér, SLET databasen og filerne, gendan, sammenlign', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sagu-rundtur-'));
  let srv = await startServerPaa(dir);
  /*
   * Ryd op, OGSAA naar testen kaster.
   *
   * Uden det her efterlader en fejlende test sine servere koerende, og hele
   * koerslen haenger i stedet for at fejle - saa ligner en assertion en
   * timeout, og man leder det forkerte sted. (Det skete: 13 zombie-servere.)
   */
  t.after(() => { try { srv.stop(); } catch { /* allerede stoppet */ } });
  let a = klient(srv.base);
  await a.opret('andreas', 'kodeord-1234');
  const { rod, fil, indhold } = await fyld(srv.base, a);

  // Maerker og egenskaber gennem den vej, importen bruger.
  const { DatabaseSync } = await import('node:sqlite');
  {
    const db = new DatabaseSync(path.join(dir, 'sagu.db'));
    const bruger = db.prepare('SELECT id FROM users LIMIT 1').get().id;
    db.prepare('INSERT INTO tags (id, user_id, name, created_at) VALUES (?,?,?,?)')
      .run('bb'.repeat(16), bruger, 'drift', 1);
    db.prepare('INSERT INTO note_tags (note_id, tag_id) VALUES (?,?)').run(rod.id, 'bb'.repeat(16));
    db.prepare('INSERT INTO note_props (note_id, key, value, seq) VALUES (?,?,?,0)')
      .run(rod.id, 'Status', 'I drift');
    db.close();
  }
  // Serveren skal genstartes, for at indekset og API'et ser de nye raekker.
  await srv.stopOgVent();
  srv = await startServerPaa(dir);
  a = klient(srv.base);
  await a.kald('POST', '/api/login', { username: 'andreas', password: 'kodeord-1234' });

  const foer = await fingeraftryk(a);
  // Hjorten, Netkort (barn), Backup-rutine, Uden notesbog, Afsluttet (arkiveret).
  assert.equal(foer.noter.length, 5, `${foer.noter.length} noter - fyld() laver fem`);
  assert.ok(foer.noter.some((n) => n.archived), 'en ARKIVERET note skal ogsaa med i rundturen');
  assert.ok(foer.noter.some((n) => n.parentId), 'og en UNDERSIDE');
  assert.ok(foer.noter.some((n) => n.extId), 'og et Notion-id');
  assert.ok(foer.noter.some((n) => n.fullWidth), 'og fuld bredde');
  assert.ok(foer.noter.some((n) => n.tags.length), 'der skal vaere maerker at tabe');
  assert.ok(foer.noter.some((n) => n.props.length), 'der skal vaere egenskaber at tabe');
  assert.ok(foer.noter.some((n) => n.files.length), 'der skal vaere filer at tabe');
  assert.ok(foer.noter.some((n) => n.backlinks.length), 'der skal vaere backlinks at tabe');

  /* --- 1. eksportér ------------------------------------------------------ */
  const eks = await fetch(`${srv.base}/api/v1/export?format=json`, { headers: { Cookie: a.cookie } });
  assert.equal(eks.status, 200);
  assert.match(eks.headers.get('content-disposition'), /attachment; filename="sagu-\d{4}-\d{2}-\d{2}\.json"/);
  const dump = await eks.json();
  assert.equal(dump.sagu, 1);
  assert.ok(dump.files.length >= 1, 'filerne skal vaere med i eksporten');

  // Og markdown-udgaven, som et menneske kan laese.
  const md = await fetch(`${srv.base}/api/v1/export?format=md`, { headers: { Cookie: a.cookie } });
  const zipBuf = Buffer.from(await md.arrayBuffer());
  const zipSti = path.join(dir, 'eksport.zip');
  (await import('node:fs')).writeFileSync(zipSti, zipBuf);
  const z = zipmod.aabn(zipSti);
  const navne = z.poster.map((p) => p.navn);
  assert.ok(navne.some((x) => x.startsWith('Drift/') && x.endsWith('.md')),
    `traeet skal blive til mapper: ${navne.slice(0, 4)}`);
  assert.ok(navne.some((x) => x.startsWith('_files/')), 'filerne skal med i zippen');
  const enSide = zipmod.udpak(z, z.poster.find((p) => p.navn.endsWith('Hjorten.md'))).toString('utf8');
  assert.match(enSide, /^---\ncreated: \d{4}-/, 'YAML-forside, som Obsidian og Bear skriver');
  assert.match(enSide, /^tags: \["drift"\]$/m);
  assert.match(enSide, /^# Hjorten$/m);
  zipmod.luk(z);

  /* --- 2. SLET databasen og filerne FYSISK ------------------------------- */
  await srv.stopOgVent();
  for (const f of ['sagu.db', 'sagu.db-wal', 'sagu.db-shm']) rmSync(path.join(dir, f), { force: true });
  rmSync(path.join(dir, 'files'), { recursive: true, force: true });
  assert.ok(!existsSync(path.join(dir, 'sagu.db')), 'databasen skal VAERE vaek');
  assert.ok(!existsSync(path.join(dir, 'files')), 'filmappen skal VAERE vaek');

  /* --- 3. start forfra og BEVIS at sletningen virkede -------------------- */
  srv = await startServerPaa(dir);
  const cfg = await (await fetch(`${srv.base}/api/public-config`)).json();
  assert.equal(cfg.needsSetup, true,
    'serveren skal se helt tom ud - ellers maaler resten af testen ingenting');

  /* --- 4. gendan i PORTIONER, som UI\'et gør ------------------------------ */
  const b = klient(srv.base);
  await b.opret('andreas', 'kodeord-1234');

  // Strukturen foerst, saa fremmednoeglerne findes.
  await b.kald('POST', '/api/v1/restore',
    { sagu: 1, notebooks: dump.notebooks, tags: dump.tags });
  // Saa noterne i bidder af 50 - en enkelt kaempe krop er praecis Kokkeris fejl.
  for (let i = 0; i < dump.notes.length; i += 50) {
    const svar = await b.kald('POST', '/api/v1/restore', { sagu: 1, notes: dump.notes.slice(i, i + 50) });
    assert.equal(svar.status, 200, `portion ${i} fejlede: ${JSON.stringify(svar.data)}`);
  }
  await b.kald('POST', '/api/v1/restore',
    { sagu: 1, noteTags: dump.noteTags, props: dump.props, settings: dump.settings });
  for (let i = 0; i < dump.files.length; i += 10) {
    await b.kald('POST', '/api/v1/restore', { sagu: 1, files: dump.files.slice(i, i + 10) });
  }

  /* --- 5. sammenlign FELT FOR FELT --------------------------------------- */
  const efter = await fingeraftryk(b);
  assert.deepEqual(efter.notebooks, foer.notebooks, 'notesboegerne kom ikke uaendret tilbage');
  assert.equal(efter.noter.length, foer.noter.length, 'der mangler noter');
  for (let i = 0; i < foer.noter.length; i++) {
    assert.deepEqual(efter.noter[i], foer.noter[i],
      `noten "${foer.noter[i].title}" kom ikke uaendret tilbage`);
  }

  /* --- 6. og filens INDHOLD, ikke kun dens metadata ---------------------- */
  const hent = await fetch(`${srv.base}/api/v1/files/${fil.id}`, { headers: { Cookie: b.cookie } });
  assert.equal(hent.status, 200, 'filen skal kunne hentes efter gendannelsen');
  const ud = Buffer.from(await hent.arrayBuffer());
  assert.ok(ud.equals(indhold), 'filens INDHOLD kom ikke byte-identisk tilbage');

  /* --- 7. og soegningen virker igen -------------------------------------- */
  const soeg = await b.kald('GET', '/api/v1/search?q=tunnel');
  assert.ok(soeg.data.results.length >= 1, 'indekset skal vaere bygget op igen');
});

test('en eksport indeholder ALDRIG hemmeligheder', async () => {
  // En eksportfil er noget, brugeren maaske deler videre (doda F9).
  const dir = mkdtempSync(path.join(tmpdir(), 'sagu-hemmelig-'));
  const srv = await startServerPaa(dir);
  try {
    const a = klient(srv.base);
    await a.opret('andreas', 'kodeord-1234');
    const noegle = (await a.kald('POST', '/api/v1/keys', { name: 'test', scope: 'full' })).data.key;

    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(path.join(dir, 'sagu.db'));
    const bruger = db.prepare('SELECT id FROM users LIMIT 1').get().id;
    for (const [k, v] of [['github_token', 'ghp_HEMMELIGT'], ['doda_key', 'doda_HEMMELIGT'],
      ['visning', 'liste']]) {
      db.prepare('INSERT OR REPLACE INTO settings (scope, key, value) VALUES (?,?,?)').run(bruger, k, v);
    }
    db.close();

    const dump = await (await fetch(`${srv.base}/api/v1/export?format=json`,
      { headers: { Cookie: a.cookie } })).json();
    const tekst = JSON.stringify(dump);
    for (const hemmelig of ['ghp_HEMMELIGT', 'doda_HEMMELIGT', noegle, 'scrypt$']) {
      assert.ok(!tekst.includes(hemmelig), `"${hemmelig.slice(0, 12)}…" slap ud i eksporten`);
    }
    // ... men en almindelig indstilling er med.
    assert.ok(dump.settings.some((s) => s.key === 'visning'));
  } finally {
    srv.stop();
  }
});

test('ISOLATION: en eksport indeholder kun MINE noter', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sagu-eks-iso-'));
  const srv = await startServerPaa(dir);
  try {
    const a = klient(srv.base);
    await a.opret('alice', 'kodeord-1234');
    await a.kald('POST', '/api/v1/admin', { allowRegistration: true });
    await a.kald('POST', '/api/v1/notes', { title: 'Alices note', body: 'ALICE-HEMMELIG' });

    const b = klient(srv.base);
    await b.opret('bob', 'kodeord-1234');
    await b.kald('POST', '/api/v1/notes', { title: 'Bobs note', body: 'BOB-HEMMELIG' });

    const bDump = await (await fetch(`${srv.base}/api/v1/export?format=json`,
      { headers: { Cookie: b.cookie } })).json();
    assert.ok(!JSON.stringify(bDump).includes('ALICE-HEMMELIG'), 'bobs eksport indeholdt alices note');
    assert.equal(bDump.notes.length, 1);

    const bZip = Buffer.from(await (await fetch(`${srv.base}/api/v1/export?format=md`,
      { headers: { Cookie: b.cookie } })).arrayBuffer());
    assert.ok(!bZip.includes(Buffer.from('ALICE-HEMMELIG')), 'markdown-eksporten laekkede paa tvaers');
  } finally {
    srv.stop();
  }
});

test('gendannelse er IDEMPOTENT - samme fil to gange giver ikke dubletter', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sagu-idem-'));
  const srv = await startServerPaa(dir);
  try {
    const a = klient(srv.base);
    await a.opret('andreas', 'kodeord-1234');
    await a.kald('POST', '/api/v1/notes', { title: 'En note', body: 'tekst' });
    const dump = await (await fetch(`${srv.base}/api/v1/export?format=json`,
      { headers: { Cookie: a.cookie } })).json();

    const foer = (await a.kald('GET', '/api/v1/tree')).data.notes.length;
    await a.kald('POST', '/api/v1/restore', dump);
    await a.kald('POST', '/api/v1/restore', dump);
    const efter = (await a.kald('GET', '/api/v1/tree')).data.notes.length;
    assert.equal(efter, foer, 'to gendannelser maa ikke fordoble arkivet');
  } finally {
    srv.stop();
  }
});

test('en eksportfil, der ikke er vores, afvises', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sagu-fremmed-'));
  const srv = await startServerPaa(dir);
  try {
    const a = klient(srv.base);
    await a.opret('andreas', 'kodeord-1234');
    const r = await a.kald('POST', '/api/v1/restore', { noget: 'andet', notes: [{ id: 'x' }] });
    assert.equal(r.status, 400);
    assert.equal(r.data.error, 'restore_failed');
    assert.equal((await a.kald('GET', '/api/v1/tree')).data.notes.length, 0, 'intet maa vaere skrevet');
  } finally {
    srv.stop();
  }
});

test('link-tabellen BAERES IKKE med - den genopbygges af teksten', async () => {
  // Teksten er sandheden; note_links er kun et indeks over den. Baerer man
  // indekset med i en eksportfil, kan det blive uenigt med sin egen tekst.
  const dir = mkdtempSync(path.join(tmpdir(), 'sagu-links-'));
  const srv = await startServerPaa(dir);
  try {
    const a = klient(srv.base);
    await a.opret('andreas', 'kodeord-1234');
    const maal = (await a.kald('POST', '/api/v1/notes', { title: 'Maalet' })).data.note;
    await a.kald('POST', '/api/v1/notes', { title: 'Peger', body: 'se [[Maalet]]' });
    assert.equal((await a.kald('GET', `/api/v1/notes/${maal.id}`)).data.note.backlinks.length, 1);

    const dump = await (await fetch(`${srv.base}/api/v1/export?format=json`,
      { headers: { Cookie: a.cookie } })).json();
    assert.equal(dump.noteLinks, undefined, 'et afledt indeks hoerer ikke i en eksportfil');

    // Slet linkene i databasen og gendan - de skal komme igen af sig selv.
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(path.join(dir, 'sagu.db'));
    db.exec('DELETE FROM note_links');
    db.close();

    await a.kald('POST', '/api/v1/restore', dump);
    assert.equal((await a.kald('GET', `/api/v1/notes/${maal.id}`)).data.note.backlinks.length, 1,
      'backlinket skal vaere genopbygget af teksten');
  } finally {
    srv.stop();
  }
});
