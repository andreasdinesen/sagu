/*
 * F2. Accept: »5.000 syntetiske noter søges under 100 ms · rangeringen sætter
 * titel-træffere først · uddraget peger på det rigtige afsnit ·
 * LIKE-jokertegn escapes.«
 *
 * Plus det, Verdandes spec lagde i kø til F2: en tokenizer kan ikke se et ord
 * inde i et ord, og det er ikke eksotisk i en dokumentations-wiki.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, klient } from './hjaelp.mjs';

const require = createRequire(import.meta.url);
const ROD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const soeg = require(path.join(ROD, 'app', 'shared', 'soeg.js'));

/* =================================================== parseren for sig ==== */

test('parseren skiller filtre fra soegeord', () => {
  const t = soeg.tolk('drift tag:server in:Hjorten updated:<30d has:code -gammel "to ord"');
  assert.deepEqual(t.termer, ['drift']);
  assert.deepEqual(t.tags, ['server']);
  assert.equal(t.i, 'Hjorten');
  assert.deepEqual(t.uden, ['gammel']);
  assert.deepEqual(t.fraser, ['to ord']);
  assert.deepEqual(t.has, ['code']);
  assert.equal(t.alder.retning, '<');
  assert.equal(t.alder.sekunder, 30 * 86400);
  // Soegningen skal fodres med den TOLKEDE tekst. Med den raa linje doer
  // resultatet i det oejeblik brugeren skriver en markoer (doda v30).
  assert.equal(t.tekst, 'drift to ord');
});

test('et kolon i en adresse er ikke et filter', () => {
  // Uden kravet om linjestart eller mellemrum ville mailto: og https:// blive
  // delt midt over - samme fejl som doda F1's markoerer.
  const t = soeg.tolk('se https://dr.dk og mailto:navn@eksempel.dk');
  assert.deepEqual(t.tags, []);
  assert.equal(t.i, null);
  assert.ok(t.termer.includes('https://dr.dk'));
  assert.ok(t.termer.includes('mailto:navn@eksempel.dk'));
});

test('et ukendt filternavn er et soegeord, ikke en fejl', () => {
  const t = soeg.tolk('foo:bar drift');
  assert.deepEqual(t.termer, ['foo:bar', 'drift']);
});

test('en filterværdi maa have mellemrum, naar den er i anfoerselstegn', () => {
  assert.equal(soeg.tolk('in:"Min notesbog" drift').i, 'Min notesbog');
});

test('et ugyldigt updated: bliver et soegeord frem for at blive slugt', () => {
  const t = soeg.tolk('updated:i-morgen');
  assert.equal(t.alder, null);
  assert.deepEqual(t.termer, ['updated:i-morgen']);
});

/* ==================================================== mod en rigtig server */

let srv;
let a;
let bog;

before(async () => {
  srv = await startServer();
  a = klient(srv.base);
  await a.opret('alice', 'kodeord-1234');
  bog = (await a.kald('POST', '/api/v1/notebooks', { name: 'Drift' })).data.notebook;
});

after(() => srv.stop());

test('rangeringen saetter TITEL-traeffere foerst', async () => {
  // »Sø  gning på Tesla svarede med en note om nginx først og noten der
  // faktisk hed Tesla Model Y bagefter - hvilket læses som en søgning, der
  // ikke virker« (Verdandes spec). Titlen vejer ti gange broedteksten.
  await a.kald('POST', '/api/v1/notes', { title: 'Nginx-opsaetning', body: 'noget om backup langt nede' });
  await a.kald('POST', '/api/v1/notes', { title: 'Backup-rutine', body: 'ingenting saerligt' });
  await a.kald('POST', '/api/v1/notes', { title: 'Ferieplan', body: 'backup backup backup backup' });

  const r = await a.kald('GET', '/api/v1/search?q=backup');
  assert.equal(r.status, 200);
  assert.equal(r.data.results[0].title, 'Backup-rutine',
    'en titel-traeffer skal slaa fire omtaler i en broedtekst');
});

test('uddraget peger paa det rigtige AFSNIT', async () => {
  const n = (await a.kald('POST', '/api/v1/notes', {
    title: 'Lang driftsnote',
    body: ['# Toppen', '', 'ingenting her', '', '## Netvaerk', '', 'noget om kabler',
      '', '## Certifikater', '', 'her staar ordet enhjoerning', '', '## Backup', '', 'til sidst'].join('\n'),
  })).data.note;

  const r = await a.kald('GET', '/api/v1/search?q=enhjoerning');
  const t = r.data.results.find((x) => x.id === n.id);
  assert.ok(t, 'noten skal findes');
  assert.equal(t.sectionTitle, 'Certifikater', 'ankeret skal pege paa afsnittet, ikke paa toppen');
  assert.equal(t.section, 'certifikater');
  assert.match(t.excerpt, /enhjoerning/i);
});

test('afsnits-id\'et er DET SAMME, som rendereren giver overskriften', async () => {
  // Ellers peger ankeret ingen steder hen, og hoppet lander paa toppen -
  // altsaa praecis den fejl, funktionen findes for at rette.
  const md = require(path.join(ROD, 'app', 'shared', 'markdown.js'));
  const krop = '## Drift\n\nfoerste\n\n## Drift\n\nher staar noget saerligt';
  const n = (await a.kald('POST', '/api/v1/notes', { title: 'To ens afsnit', body: krop })).data.note;

  const r = await a.kald('GET', '/api/v1/search?q=saerligt');
  const t = r.data.results.find((x) => x.id === n.id);
  assert.equal(t.section, 'drift-2', 'anden forekomst skal have -2, som i rendereren');
  const { overskrifter } = md.render(krop);
  assert.ok(overskrifter.some((o) => o.id === t.section), 'id\'et skal findes i det renderede');
});

/* ---------------------------------------------------- et ord inde i et ord */

test('ET ORD INDE I ET ORD findes, naar indekset ikke kan se det', async () => {
  // `keepInventory` er ÉT token. En praefiks-stjerne kan kun ramme forfra, saa
  // »inventory« giver nul - selv om noten staar der. Et arkiv af
  // driftsdokumentation er fuldt af den slags.
  const n = (await a.kald('POST', '/api/v1/notes', {
    title: 'Minecraft-server', body: 'gamerule keepInventory true',
  })).data.note;

  const r = await a.kald('GET', '/api/v1/search?q=inventory');
  assert.equal(r.status, 200);
  assert.ok(r.data.results.some((x) => x.id === n.id), '»inventory« skal finde »keepInventory«');
  assert.equal(r.data.fallback, true, 'og svaret skal SIGE, at det ikke var indekset');
  // Faldet tilbage rangerer ikke - der er intet at rangere.
  assert.ok(r.data.results[0].excerpt, 'der skal stadig vaere et uddrag');
});

test('en almindelig traeffer bruger INDEKSET, ikke faldet tilbage', async () => {
  const r = await a.kald('GET', '/api/v1/search?q=minecraft');
  assert.equal(r.data.fallback, false, 'fallback maa kun bruges, naar indekset var tomt');
});

test('to ord, hvor kun det ene er et helt token, finder stadig noten', async () => {
  // FTS AND'er termerne, saa »keep inventory« giver nul selv om »keep« findes.
  // Den halvdel, der virkede, maa ikke smide den anden vaek.
  const r = await a.kald('GET', '/api/v1/search?q=keep%20inventory');
  assert.ok(r.data.results.some((x) => x.title === 'Minecraft-server'));
  assert.equal(r.data.fallback, true);
});

test('LIKE-jokertegn i brugerens ord betyder INGENTING', async () => {
  // Uden escaping ville `%` matche alt, og en soegning paa `%` ville
  // returnere hele arkivet - ogsaa gennem faldet tilbage.
  await a.kald('POST', '/api/v1/notes', { title: 'Rabatkode', body: 'giver 50% i rabat' });
  const alle = (await a.kald('GET', '/api/v1/notes')).data.notes.length;

  for (const q of ['%', '_', '%%', 'zzz%', '\\']) {
    const r = await a.kald('GET', `/api/v1/search?q=${encodeURIComponent(q)}`);
    assert.equal(r.status, 200, `"${q}" vaeltede soegningen`);
    assert.ok(r.data.results.length < alle,
      `"${q}" returnerede ${r.data.results.length} af ${alle} noter - jokertegnet blev ikke escaped`);
  }
  // ... men et rigtigt procenttegn i teksten kan stadig findes.
  const r = await a.kald('GET', '/api/v1/search?q=50%25');
  assert.ok(r.data.results.some((x) => x.title === 'Rabatkode'));
});

/* ------------------------------------------------------------- filtrene */

test('tag: filtrerer, og et ukendt maerke giver NUL - ikke alt', async () => {
  const n = (await a.kald('POST', '/api/v1/notes', { title: 'Med maerke', body: 'drift her' })).data.note;
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(srv.dataDir, 'sagu.db'));
  const bruger = db.prepare('SELECT id FROM users LIMIT 1').get().id;
  db.prepare('INSERT INTO tags (id, user_id, name, created_at) VALUES (?,?,?,?)')
    .run('aa'.repeat(16), bruger, 'server', 1);
  db.prepare('INSERT INTO note_tags (note_id, tag_id) VALUES (?,?)').run(n.id, 'aa'.repeat(16));
  db.close();
  await a.kald('PATCH', `/api/v1/notes/${n.id}`, { body: 'drift her' });   // genindeksér

  const med = await a.kald('GET', '/api/v1/search?q=drift%20tag:server');
  assert.deepEqual(med.data.results.map((x) => x.id), [n.id]);

  const ukendt = await a.kald('GET', '/api/v1/search?q=drift%20tag:findesikke');
  assert.equal(ukendt.data.results.length, 0,
    'et ukendt maerke skal give nul - et filter, der ignoreres, ligner en soegning der virker');
});

test('in: daekker baade en notesbog og et undertrae', async () => {
  const rod = (await a.kald('POST', '/api/v1/notes',
    { title: 'Hjorten', notebookId: bog.id, body: 'roden' })).data.note;
  await a.kald('POST', '/api/v1/notes',
    { title: 'Under Hjorten', parentId: rod.id, notebookId: bog.id, body: 'enhjoerning-under' });
  await a.kald('POST', '/api/v1/notes', { title: 'Udenfor', body: 'enhjoerning-ude' });

  const iBog = await a.kald('GET', '/api/v1/search?q=enhjoerning%20in:Drift');
  assert.deepEqual(iBog.data.results.map((x) => x.title), ['Under Hjorten']);

  const iSide = await a.kald('GET', '/api/v1/search?q=enhjoerning%20in:Hjorten');
  assert.deepEqual(iSide.data.results.map((x) => x.title), ['Under Hjorten']);

  const ukendt = await a.kald('GET', '/api/v1/search?q=enhjoerning%20in:FindesIkke');
  assert.equal(ukendt.data.results.length, 0);
});

test('has: finder kodeblokke, billeder, links og tjeklister', async () => {
  await a.kald('POST', '/api/v1/notes', { title: 'Har kode', body: 'x\n\n```sh\nls\n```' });
  await a.kald('POST', '/api/v1/notes', { title: 'Har billede', body: '![alt](https://x.dk/a.png)' });
  await a.kald('POST', '/api/v1/notes', { title: 'Har tjekliste', body: '- [ ] noget' });

  assert.ok((await a.kald('GET', '/api/v1/search?q=has:code')).data.results.some((x) => x.title === 'Har kode'));
  assert.ok((await a.kald('GET', '/api/v1/search?q=has:image')).data.results.some((x) => x.title === 'Har billede'));
  assert.ok((await a.kald('GET', '/api/v1/search?q=has:todo')).data.results.some((x) => x.title === 'Har tjekliste'));
  // has: alene er en gyldig soegning - filtrene ER svaret.
  const kun = await a.kald('GET', '/api/v1/search?q=has:code');
  assert.ok(kun.data.results.length >= 1);
});

test('updated: regner i begge retninger', async () => {
  const n = (await a.kald('POST', '/api/v1/notes', { title: 'Gammel note', body: 'stoev' })).data.note;
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(srv.dataDir, 'sagu.db'));
  // Flyt uret ved siden af - det kan API'et ikke provokere.
  db.prepare('UPDATE notes SET updated_at = ? WHERE id = ?')
    .run(Math.floor(Date.now() / 1000) - 200 * 86400, n.id);
  db.close();

  const nye = await a.kald('GET', '/api/v1/search?q=stoev%20updated:%3C30d');
  assert.equal(nye.data.results.length, 0, 'noten er 200 dage gammel');
  const gamle = await a.kald('GET', '/api/v1/search?q=stoev%20updated:%3E30d');
  assert.deepEqual(gamle.data.results.map((x) => x.id), [n.id]);
});

test('-ord fjerner noter, der indeholder det', async () => {
  await a.kald('POST', '/api/v1/notes', { title: 'Kaffe og te', body: 'begge dele' });
  await a.kald('POST', '/api/v1/notes', { title: 'Kun kaffe', body: 'ingen andre drikke' });
  const r = await a.kald('GET', '/api/v1/search?q=kaffe%20-te');
  assert.deepEqual(r.data.results.map((x) => x.title), ['Kun kaffe']);
});

test('en frase kraever ordene i RAEKKEFOELGE', async () => {
  await a.kald('POST', '/api/v1/notes', { title: 'Rigtig orden', body: 'blaa bil paa vejen' });
  await a.kald('POST', '/api/v1/notes', { title: 'Omvendt orden', body: 'bil blaa paa vejen' });
  const r = await a.kald('GET', '/api/v1/search?q=%22blaa%20bil%22');
  const titler = r.data.results.map((x) => x.title);
  assert.ok(titler.includes('Rigtig orden'));
  assert.ok(!titler.includes('Omvendt orden'), 'en frase er ikke to loese ord');
});

/* ------------------------------------------------------------ isolation */

test('ISOLATION: filtre og faldet tilbage kan ikke naa en anden brugers noter', async () => {
  const b = klient(srv.base);
  await a.kald('POST', '/api/v1/admin', { allowRegistration: true });
  await b.opret('bob', 'kodeord-1234');
  await b.kald('POST', '/api/v1/notes', { title: 'Bobs hemmelighed', body: 'bobsKeepInventory her' });

  // Faldet tilbage laeser TEKSTEN - det er den vej, der er lettest at glemme
  // et user_id paa.
  for (const q of ['inventory', 'keepinventory', 'has:code', 'updated:<400d', 'in:Drift', '%']) {
    const r = await a.kald('GET', `/api/v1/search?q=${encodeURIComponent(q)}`);
    assert.ok(!JSON.stringify(r.data).includes('Bobs hemmelighed'),
      `"${q}" laekkede bobs note til alice`);
    const rb = await b.kald('GET', `/api/v1/search?q=${encodeURIComponent(q)}`);
    assert.ok(!JSON.stringify(rb.data).includes('Enhjoerning') && !JSON.stringify(rb.data).includes('Nginx'),
      `"${q}" laekkede alices noter til bob`);
  }
});

/* ---------------------------------------------------------- 5.000 noter */

test('ACCEPT: 5.000 noter soeges under 100 ms', async () => {
  const s2 = await startServer();
  try {
    const x = klient(s2.base);
    await x.opret('stor', 'kodeord-1234');

    // Skriv direkte i databasen - 5.000 http-kald ville tage minutter og
    // maale noget andet end soegningen.
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(path.join(s2.dataDir, 'sagu.db'));
    const bruger = db.prepare('SELECT id FROM users LIMIT 1').get().id;
    const emner = ['drift', 'backup', 'netvaerk', 'certifikat', 'telefoni', 'database', 'kaffe'];
    const t = Math.floor(Date.now() / 1000);
    db.exec('BEGIN');
    for (let i = 0; i < 5000; i++) {
      const id = i.toString(16).padStart(32, '0');
      const emne = emner[i % emner.length];
      const krop = `## ${emne} ${i}\n\nEt afsnit om ${emne} med noget fyld. `
        + `Linje to med flere ord, saa indekset har noget at arbejde med.\n\n`
        + `## Detaljer\n\nMere tekst om ${emne} nummer ${i}.`;
      db.prepare(`INSERT INTO notes (id, user_id, title, body_md, seq, created_at, updated_at)
                  VALUES (?,?,?,?,?,?,?)`)
        .run(id, bruger, `${emne} note ${i}`, krop, i, t, t);
      // Indekset har ingen user_id (m12): det afgraenser ingenting - `SYNLIG`
      // gør det, paa `notes`, hvor ejerskabet staar.
      db.prepare(`INSERT INTO note_fts (title, headings, body, meta, folded, note_id)
                  VALUES (?,?,?,?,?,?)`)
        .run(`${emne} note ${i}`, `${emne} ${i}\nDetaljer`, krop, '', '', id);
    }
    db.exec('COMMIT');
    db.close();

    const antal = (await x.kald('GET', '/api/v1/state')).data.counts.notes;
    assert.equal(antal, 5000, `der er ${antal} noter, ikke 5000`);

    // Maal den VARME sti, som en bruger moeder - ikke det foerste kald, der
    // ogsaa aabner databasen.
    await x.kald('GET', '/api/v1/search?q=drift');
    const maalinger = [];
    for (const q of ['drift', 'backup', 'certifikat', 'drif', 'netvaerk telefoni', 'kaffe tag:findesikke']) {
      const t0 = Date.now();
      const r = await x.kald('GET', `/api/v1/search?q=${encodeURIComponent(q)}`);
      maalinger.push([q, Date.now() - t0, r.data.results.length]);
      assert.equal(r.status, 200);
    }
    for (const [q, ms] of maalinger) {
      assert.ok(ms < 100, `"${q}" tog ${ms} ms af de tilladte 100`);
    }
    console.log(`      5.000 noter: ${maalinger.map(([q, ms, n]) => `${q}=${ms}ms(${n})`).join('  ')}`);

    // Og faldet tilbage - den dyre sti - skal stadig vaere brugbar.
    const t1 = Date.now();
    const fb = await x.kald('GET', '/api/v1/search?q=etaljer');
    const fbMs = Date.now() - t1;
    assert.equal(fb.data.fallback, true);
    console.log(`      faldet tilbage over 5.000 noter: ${fbMs} ms, ${fb.data.results.length} traeffere`);
    assert.ok(fbMs < 1000, `faldet tilbage tog ${fbMs} ms`);
  } finally {
    s2.stop();
  }
});

test('tomme soegninger logges - uden hvem', async () => {
  await a.kald('GET', '/api/v1/search?q=findesheltsikkertikke');
  const r = await a.kald('GET', '/api/v1/search-misses');
  assert.equal(r.status, 200);
  const m = r.data.misses.find((x) => x.term === 'findesheltsikkertikke');
  assert.ok(m, 'ordet skal staa paa listen');
  assert.ok(!('user_id' in m), 'kun ordet, aldrig hvem');
});

test('uddraget er ÉN laesbar linje, ikke raa markdown', async () => {
  // FTS5's snippet() klipper i den raa kolonne, saa et uddrag kan begynde midt
  // i »## Regler« og indeholde linjeskift. Markoererne skal overleve.
  const n = (await a.kald('POST', '/api/v1/notes', {
    title: 'Rodet note',
    body: '## Overskrift\n\n- et punkt med **fed** og `kode`\n\n> et citat med hemmeligtord\n\n```js\nx\n```',
  })).data.note;
  const r = await a.kald('GET', '/api/v1/search?q=hemmeligtord');
  const t = r.data.results.find((x) => x.id === n.id);
  assert.ok(t, 'noten skal findes');
  assert.ok(!t.excerpt.includes('\n'), `uddraget har linjeskift: ${JSON.stringify(t.excerpt)}`);
  assert.ok(!/#{1,6}\s/.test(t.excerpt), `uddraget har overskrifts-markoerer: ${t.excerpt}`);
  assert.ok(!t.excerpt.includes('```'), `uddraget har kodehegn: ${t.excerpt}`);
  assert.ok(!t.excerpt.includes('**'), `uddraget har fed-markoerer: ${t.excerpt}`);
  // ... men fremhaevningen skal vaere der.
  assert.match(t.excerpt, /<<hemmeligtord>>/i, `fremhaevningen forsvandt: ${t.excerpt}`);
});

test('fremhaevningen kan ikke blive til et TAG', async () => {
  // Uddraget escapes i frontenden FOER << og >> byttes til <mark>. Her
  // sikres serversiden: et forsoeg paa at skrive markoererne selv maa ikke
  // give brugeren en vej til opmaerkning.
  const n = (await a.kald('POST', '/api/v1/notes', {
    title: 'Snyd', body: 'her staar <<script>>alert(1)<</script>> og ordet trylleord',
  })).data.note;
  const r = await a.kald('GET', '/api/v1/search?q=trylleord');
  const t = r.data.results.find((x) => x.id === n.id);
  // Frontendens uddrag(): esc() foerst, saa byt markoererne.
  const somFrontenden = t.excerpt
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/&lt;&lt;/g, '<mark>').replace(/&gt;&gt;/g, '</mark>');
  assert.ok(!/<script/i.test(somFrontenden), `et script-tag slap igennem: ${somFrontenden}`);
  assert.ok(!/\son[a-z]+=/i.test(somFrontenden));
});
