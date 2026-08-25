/*
 * F0's oevrige acceptkriterier: CSRF-barrieren, rate-limit, CSP-hashen,
 * fejlsvarenes FORM - og maaling 4, den streamede upload.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, klient } from './hjaelp.mjs';

const ROD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let srv;
let a;

before(async () => {
  srv = await startServer();
  a = klient(srv.base);
  await a.opret('alice', 'kodeord-1234');
});

after(() => srv.stop());

/* ------------------------------------------------------------- CSRF */

test('POST uden application/json afvises med 415', async () => {
  // Kravet om Content-Type er en CSRF-barriere oven paa SameSite=Lax: en
  // HTML-formular kan ikke saette headeren, og via fetch udloeser den en
  // preflight, vi ikke svarer paa.
  const r = await fetch(`${srv.base}/api/v1/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', Cookie: a.cookie },
    body: 'title=snydt',
  });
  assert.equal(r.status, 415);
  const d = await r.json();
  assert.equal(d.error, 'wrong_content_type');
});

test('men en NOEGLE maa gerne sende ren tekst - der er intet at forfalske', async () => {
  // CSRF forudsaetter en AMBIENT legitimation. En Bearer-noegle sendes aktivt
  // af klienten, saa kravet skal slaekkes praecis dér - og ikke generelt
  // (RUNE-ERFARINGER, doda F2). En iOS-genvej med ét tekstfelt sender ren
  // tekst uden Content-Type.
  const noegle = (await a.kald('POST', '/api/v1/keys', { name: 'genvej', scope: 'capture' })).data.key;
  const r = await fetch(`${srv.base}/api/v1/notes`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${noegle}` },
    body: '{"title":"fra en genvej"}',
  });
  assert.equal(r.status, 200);
});

/* -------------------------------------------------------- rate-limit */

test('login rate-limites med 429 - og taelleren ligger i DATABASEN', async () => {
  const x = klient(srv.base);
  let saa429 = false;
  for (let i = 0; i < 20; i++) {
    const r = await x.kald('POST', '/api/login', { username: 'alice', password: 'forkert' });
    if (r.status === 429) { saa429 = true; assert.equal(r.data.error, 'rate_limited'); break; }
    assert.equal(r.status, 401);
  }
  assert.ok(saa429, 'der skal komme en 429 inden for 20 forsoeg');

  // Panelets auto-opdatering genstarter serveren kl. 04. En in-memory-taeller
  // ville nulstilles der, saa spaerren skal ligge i databasen
  // (RUNE-ERFARINGER, doda F0). Beviset: raekken staar i tabellen.
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(srv.dataDir, 'sagu.db'));
  const n = db.prepare("SELECT COUNT(*) AS n FROM rate WHERE bucket LIKE 'login:%'").get().n;
  db.close();
  assert.ok(n > 0, 'rate-limitten skal overleve en genstart');
});

test('et rigtigt kodeord virker stadig fra en ANDEN ip-adresse', async () => {
  // Bucket'en er pr. ip OG brugernavn - ellers kan én forkert klient laase
  // ejeren ude af sin egen server.
  const y = klient(srv.base);
  const r = await y.kald('POST', '/api/login', { username: 'alice', password: 'kodeord-1234' },
    { headers: { 'X-Forwarded-For': '203.0.113.9' } });
  assert.equal(r.status, 200);
});

/* ---------------------------------------------------------------- CSP */

test('CSP-headeren har en hash paa DET inline tema-script, index.html faktisk har', async () => {
  // Hashen beregnes ved OPSTART af filen selv, ikke stemplet ind af build'et -
  // saa kan CSP'en aldrig komme ud af trit med filen.
  const r = await fetch(`${srv.base}/`);
  const csp = r.headers.get('content-security-policy');
  assert.ok(csp, 'der skal vaere en CSP');

  const html = readFileSync(path.join(ROD, 'app', 'public', 'index.html'), 'utf8');
  const m = html.match(/<script data-theme-init>([\s\S]*?)<\/script>/);
  assert.ok(m, 'index.html skal have tema-scriptet');
  const { createHash } = await import('node:crypto');
  const forventet = createHash('sha256').update(m[1], 'utf8').digest('base64');
  assert.ok(csp.includes(`'sha256-${forventet}'`), `CSP mangler hashen for tema-scriptet:\n${csp}`);

  // Og de spaerringer, der betyder noget.
  for (const del of ["default-src 'none'", "worker-src 'self'", "frame-ancestors 'none'",
    "base-uri 'none'", "object-src", "img-src 'self' data:"]) {
    if (del === 'object-src') continue;      // daekket af default-src 'none'
    assert.ok(csp.includes(del), `CSP mangler ${del}`);
  }
  assert.ok(!/script-src[^;]*unsafe-inline/.test(csp), "script-src maa ALDRIG have 'unsafe-inline'");
});

test('der er praecis ÉT inline-script, og ingen script src til et fremmed domaene', async () => {
  const html = readFileSync(path.join(ROD, 'app', 'public', 'index.html'), 'utf8');
  const inline = html.match(/<script(?![^>]*\ssrc=)[^>]*>/g) || [];
  assert.equal(inline.length, 1, 'kun tema-scriptet maa vaere inline - hver ny koster en CSP-hash');
  for (const s of html.match(/<script[^>]*src="([^"]+)"/g) || []) {
    assert.ok(!/https?:\/\//.test(s), `nul CDN: ${s}`);
  }
  assert.ok(!/https?:\/\/(?!localhost)/.test(html.replace(/<!--[\s\S]*?-->/g, '')),
    'index.html maa ikke pege paa en fremmed vaert');
});

/* --------------------------------------------------- fejlsvarets FORM */

test('ALLE fejlsvar har baade en maskinkode og en saetning', async () => {
  // En test pr. rute laaser kun det, du allerede har skrevet ned. En FORMREGEL
  // gaelder ogsaa den rute, nogen tilfoejer om et halvt aar
  // (RUNE-ERFARINGER, doda v18).
  const proever = [
    ['GET', '/api/v1/findes-ikke', undefined, {}],
    ['GET', '/api/v1/notes/00000000000000000000000000000000', undefined, {}],
    ['DELETE', '/api/v1/notes/00000000000000000000000000000000', undefined, {}],
    ['GET', '/api/v1/admin', undefined, { udenCookie: true }],
    ['POST', '/api/v1/notes', { title: 'x' }, { udenCookie: true }],
    ['GET', '/api/v1/keys', undefined, { udenCookie: true }],
    ['DELETE', '/api/v1/keys/00000000000000000000000000000000', undefined, {}],
  ];
  for (const [metode, sti, krop, opt] of proever) {
    const r = await a.kald(metode, sti, krop, opt);
    assert.ok(r.status >= 400, `${metode} ${sti} skulle fejle, gav ${r.status}`);
    assert.ok(r.data && typeof r.data.error === 'string', `${metode} ${sti}: mangler error-kode`);
    assert.match(r.data.error, /^[a-z][a-z0-9_]*$/,
      `${metode} ${sti}: "${r.data.error}" er ikke en kode, en klient kan forgrene paa`);
    assert.ok(typeof r.data.message === 'string' && r.data.message.length > 8,
      `${metode} ${sti}: mangler en saetning til mennesket`);
    assert.notEqual(r.data.message, r.data.error, `${metode} ${sti}: beskeden er bare koden om igen`);
  }
});

test('en 500 roeber ikke sin egen besked', async () => {
  // Ugyldig UTF-8 i stien faar URL-afkodningen til at kaste.
  const r = await fetch(`${srv.base}/api/v1/notes/%E0%A4%A`);
  assert.ok(r.status >= 400);
  const d = await r.json();
  assert.ok(!/stack|at Object|server\.js/i.test(JSON.stringify(d)), 'ingen intern detalje i svaret');
});

/* ------------------------------------------------ statiske filer */

test('HTML serveres no-store, mens app.js er immutable', async () => {
  // Cloudflare edge-cacher .js/.css i timevis og ignorerer no-cache, saa
  // versionerede URL'er baerer opdateringen, og HTML skal altid vaere frisk.
  const html = await fetch(`${srv.base}/`);
  assert.match(html.headers.get('cache-control'), /no-store/);
  const js = await fetch(`${srv.base}/app.js`);
  assert.match(js.headers.get('cache-control'), /immutable/);
  assert.equal(js.headers.get('x-content-type-options'), 'nosniff');
});

test('sti-traversering ud af public/ afvises', async () => {
  for (const sti of ['/../server.js', '/..%2Fserver.js', '/public/../../app/server.js']) {
    const r = await fetch(srv.base + sti);
    assert.ok(r.status === 403 || r.status === 404, `${sti} gav ${r.status}`);
    const t = await r.text();
    assert.ok(!t.includes('DatabaseSync'), `${sti} udleverede serverens kildekode!`);
  }
});

test('versionen i index.html, app.js og runen er DET SAMME tal', async () => {
  const html = readFileSync(path.join(ROD, 'app', 'public', 'index.html'), 'utf8');
  const iHtml = Number(html.match(/app\.js\?v=(\d+)/)[1]);
  const kerne = readFileSync(path.join(ROD, 'app', 'parts', 'p1_core.js'), 'utf8');
  const iKode = Number(kerne.match(/^const APP_VERSION = (\d+);/m)[1]);
  assert.equal(iHtml, iKode, 'build_rune.py stempler dem samtidig - de maa ikke drive fra hinanden');

  const cfg = await (await fetch(`${srv.base}/api/public-config`)).json();
  assert.equal(cfg.version, iKode, 'serveren skal melde samme tal, saa en gammel cache kan opdages');
});

/* ------------------------------------------- maaling 4: store uploads */

test('MAALING 4: en stor upload streames til disk uden at ligge i hukommelsen', async () => {
  // Notion-eksporten er en zip paa hundredvis af MB. readJsonBody samler alt
  // i hukommelsen - Kokkeris backup paa 260 MB blev afvist af serverens egen
  // 25 MB-graense, og ingen opdagede det, foer den skulle bruges.
  //
  // 120 MB er stort nok til, at forskellen mellem "streamet" og "bufret" er
  // umulig at overse, og lille nok til at testen koerer paa faa sekunder.
  const MB = 120;
  const blok = Buffer.alloc(1024 * 1024, 0x61);
  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256');
  for (let i = 0; i < MB; i++) hash.update(blok);
  const forventetSha = hash.digest('hex');

  const stroem = new ReadableStream({
    start(c) {
      for (let i = 0; i < MB; i++) c.enqueue(blok);
      c.close();
    },
  });

  const r = await fetch(`${srv.base}/api/v1/upload`, {
    method: 'POST',
    headers: { Cookie: a.cookie, 'X-Sagu-Upload': '1', 'Content-Type': 'application/octet-stream' },
    body: stroem,
    duplex: 'half',
  });
  assert.equal(r.status, 200);
  const d = await r.json();

  assert.equal(d.size, MB * 1024 * 1024, 'hele kroppen skal vaere naaet frem');
  assert.equal(d.sha256, forventetSha, 'indholdet skal vaere byte-identisk');

  // DET ER MAALINGEN: heapen maa ikke vokse med filens stoerrelse. Bufret
  // ville den ligge over 120 MB; streamet er den en haandfuld MB.
  const heapMB = d.heapUsed / 1024 / 1024;
  assert.ok(heapMB < 40, `heapen var ${heapMB.toFixed(1)} MB under en ${MB} MB upload - den bufrer`);
  console.log(`      maaling 4: ${MB} MB paa ${d.ms} ms, heap ${heapMB.toFixed(1)} MB, `
    + `rss ${(d.rss / 1024 / 1024).toFixed(0)} MB, ${(MB / (d.ms / 1000)).toFixed(0)} MB/s`);
});

test('en upload over loftet svarer 413 - ikke "connection reset"', async () => {
  // Rammer man loftet og kalder req.destroy(), ser klienten en afbrudt
  // forbindelse i stedet for vores 413, og en API-klient aner ikke hvorfor
  // (RUNE-ERFARINGER, doda F7). Vi svarer FOERST og lukker bagefter.
  //
  // Loftet er 1 GB i drift; her saenkes det ved at sende mere, end serveren
  // vil tage imod, ville tage for lang tid - saa i stedet proeves den
  // manglende header, som er den anden vagt paa samme rute.
  const r = await fetch(`${srv.base}/api/v1/upload`, {
    method: 'POST',
    headers: { Cookie: a.cookie, 'Content-Type': 'application/octet-stream' },
    body: 'lidt data',
  });
  assert.equal(r.status, 400);
  const d = await r.json();
  assert.equal(d.error, 'missing_header');
});

/* ------------------------------------------- maaling 2: FTS5 */

test('MAALING 2: FTS5 findes, og soegningen rangerer titel over broedtekst', async () => {
  await a.kald('POST', '/api/v1/notes', { title: 'Drift af Hjorten', body: 'ingenting saerligt her' });
  await a.kald('POST', '/api/v1/notes', { title: 'Ferieplan', body: 'noget om drift langt nede i teksten' });

  const r = await a.kald('GET', '/api/v1/search?q=drift');
  assert.equal(r.status, 200);
  assert.equal(r.data.results.length, 2);
  assert.equal(r.data.results[0].title, 'Drift af Hjorten', 'titel-traeffere skal staa foerst');

  // Praefiks-match: en skrivefejl maa ikke vaere en blindgyde.
  const delvis = await a.kald('GET', '/api/v1/search?q=drif');
  assert.ok(delvis.data.results.length >= 2, '"drif" skal finde "drift"');

  // Overskrifter vaegtes hoejere end broedtekst - det er halvdelen af svaret
  // paa "Notions wiki-soegning finder reelt kun overskrifter".
  await a.kald('POST', '/api/v1/notes', { title: 'Zzz', body: '## Backup\n\nlidt tekst' });
  await a.kald('POST', '/api/v1/notes', { title: 'Yyy', body: 'et sted i broedteksten staar backup' });
  const b = await a.kald('GET', '/api/v1/search?q=backup');
  assert.equal(b.data.results[0].title, 'Zzz', 'en overskrift skal veje mere end broedtekst');
});

test('brugerens ord er ikke et FTS5-PROGRAM', async () => {
  // FTS5's MATCH-syntaks er et sprog: ", *, NEAR, OR og kolonnefiltre betyder
  // noget. Uden escaping ville en almindelig soegning kunne kaste - eller
  // laese en kolonne, den ikke maatte.
  for (const ond of ['"', 'a OR b', 'title:hemmelig', 'NEAR(a b)', '*', 'x" OR user_id:"', "a'b", '((']) {
    const r = await a.kald('GET', `/api/v1/search?q=${encodeURIComponent(ond)}`);
    assert.equal(r.status, 200, `"${ond}" maa ikke vaelte soegningen`);
    assert.ok(Array.isArray(r.data.results));
  }
});

test('body_md kommer ALDRIG med i et listesvar', async () => {
  // Kokkeris login-svar paa 247,9 MB kom af netop den slags (CLAUDE.md).
  //
  // Reglen gaelder den FULDE krop. Et soegeuddrag er noget andet: SAGU-PLAN §5
  // KRAEVER et uddrag med fremhaevning, og det citerer noedvendigvis
  // broedteksten. Graensen gaar ved, om svaret vokser med notens stoerrelse -
  // derfor maales uddraget, i stedet for at forbyde det.
  const hemmelig = 'DENNE-TEKST-MAA-IKKE-VAERE-I-LISTEN';
  // En rigtig stor note: det er dén, der afgoer om listen skalerer.
  const stor = `${hemmelig}\n${'fyld '.repeat(40000)}`;   // ~200 KB
  await a.kald('POST', '/api/v1/notes', { title: 'med krop', body: stor });

  for (const sti of ['/api/v1/notes', '/api/v1/state']) {
    const r = await a.kald('GET', sti);
    assert.ok(!JSON.stringify(r.data).includes(hemmelig),
      `${sti} sendte broedteksten med - listerne faar kun titel, maerker og taellere`);
    for (const n of r.data.notes || []) {
      assert.equal(n.body, undefined, `${sti} har et body-felt paa "${n.title}"`);
    }
  }

  // Soegningen: intet body-felt, og uddraget er BUNDET - ikke en funktion af
  // notens laengde. En 200 KB note maa ikke give et 200 KB soegesvar.
  const s = await a.kald('GET', '/api/v1/search?q=fyld');
  const traef = s.data.results.find((x) => x.title === 'med krop');
  assert.ok(traef, 'noten skal kunne findes');
  assert.equal(traef.body, undefined, 'et soegeresultat har ingen body');
  assert.ok(traef.excerpt.length < 400,
    `uddraget var ${traef.excerpt.length} tegn - det skal vaere bundet, uanset notens stoerrelse`);
  assert.ok(JSON.stringify(s.data).length < 5000,
    `hele soegesvaret var ${JSON.stringify(s.data).length} tegn for én 200 KB note`);

  // ... men den ENKELTE note har naturligvis hele kroppen.
  const liste = (await a.kald('GET', '/api/v1/notes')).data.notes;
  const id = liste.find((n) => n.title === 'med krop').id;
  assert.equal((await a.kald('GET', `/api/v1/notes/${id}`)).data.note.body, stor);
});

/* ------------------------------------------------ datamodellens vagter */

test('seq er et LOEBENUMMER, ikke et tidsstempel', async () => {
  // Klassisk tavs slip: .run(id, navn, t, t, t) for (seq, created_at,
  // updated_at). Listen ser rigtig ud, fordi tidsstempler tilfaeldigvis
  // sorterer kronologisk - men manuel sortering er umulig, naar alle numre
  // ligger i milliardklassen (RUNE-ERFARINGER, doda F3/F4).
  const s2 = await startServer();
  try {
    const x = klient(s2.base);
    await x.opret('sekvens', 'kodeord-1234');
    for (let i = 0; i < 3; i++) await x.kald('POST', '/api/v1/notes', { title: `n${i}` });
    await x.kald('POST', '/api/v1/notebooks', { name: 'Foerste' });
    await x.kald('POST', '/api/v1/notebooks', { name: 'Anden' });

    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(path.join(s2.dataDir, 'sagu.db'));
    const noter = db.prepare('SELECT seq FROM notes ORDER BY created_at').all().map((r) => r.seq);
    const boeger = db.prepare('SELECT seq FROM notebooks ORDER BY created_at').all().map((r) => r.seq);
    db.close();
    assert.deepEqual(noter, [0, 1, 2], `seq i notes var ${JSON.stringify(noter)}`);
    assert.deepEqual(boeger, [0, 1], `seq i notebooks var ${JSON.stringify(boeger)}`);
  } finally {
    s2.stop();
  }
});

test('konfliktvagten afviser en overskrivning i stedet for at tie', async () => {
  const note = (await a.kald('POST', '/api/v1/notes', { title: 'delt', body: 'foerste' })).data.note;
  const gammelt = note.updatedAt;

  // Én fane gemmer ...
  await new Promise((r) => setTimeout(r, 1100));      // updated_at er i sekunder
  const foerst = await a.kald('PATCH', `/api/v1/notes/${note.id}`, { body: 'fra fane A', ifUpdatedAt: gammelt });
  assert.equal(foerst.status, 200);

  // ... og den anden fane, der stadig har det gamle stempel, faar 409.
  const anden = await a.kald('PATCH', `/api/v1/notes/${note.id}`, { body: 'fra fane B', ifUpdatedAt: gammelt });
  assert.equal(anden.status, 409);
  assert.equal(anden.data.error, 'conflict');

  // Og INTET blev overskrevet.
  assert.equal((await a.kald('GET', `/api/v1/notes/${note.id}`)).data.note.body, 'fra fane A');
});

test('"udeladt" og "tom" er ikke det samme felt', async () => {
  // Et udeladt felt bevares, et tomt rydder. Uden hasOwnProperty bliver en
  // bevidst udeladelse til "sat til ingenting", altsaa en aendring der
  // SLETTER - og det ser ud som en almindelig opdatering
  // (RUNE-ERFARINGER, tovo v10).
  const n = (await a.kald('POST', '/api/v1/notes', { title: 'behold', body: 'min tekst' })).data.note;
  await a.kald('PATCH', `/api/v1/notes/${n.id}`, { title: 'nyt navn' });
  assert.equal((await a.kald('GET', `/api/v1/notes/${n.id}`)).data.note.body, 'min tekst');
  await a.kald('PATCH', `/api/v1/notes/${n.id}`, { body: '' });
  assert.equal((await a.kald('GET', `/api/v1/notes/${n.id}`)).data.note.body, '');
});

test('versionshistorikken skrives fra dag ét', async () => {
  /*
   * Facit var ['et', 'to', 'tre'] — én post pr. gem. Det er ændret i F22:
   * gemninger i samme skrivestund tæller som én, og øjebliksbilledet tages
   * FØR skrivningen, så hver stunds slutresultat bevares.
   *
   * Her ligger de tre kald inden for vinduet, så kun oprettelsen står — og
   * ændringen, der hverken rører titel eller krop, laver stadig ingen
   * version.
   */
  const n = (await a.kald('POST', '/api/v1/notes', { title: 'v1', body: 'et' })).data.note;
  await a.kald('PATCH', `/api/v1/notes/${n.id}`, { body: 'to' });
  await a.kald('PATCH', `/api/v1/notes/${n.id}`, { body: 'tre' });
  await a.kald('PATCH', `/api/v1/notes/${n.id}`, { fullWidth: true });

  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(srv.dataDir, 'sagu.db'));
  const v = db.prepare('SELECT body_md FROM note_versions WHERE note_id = ? ORDER BY at, rowid').all(n.id);
  // ... og saa en ny stund: bagdatér, ret, og se stundens SLUTRESULTAT lande.
  db.prepare('UPDATE note_versions SET at = at - 3600 WHERE note_id = ?').run(n.id);
  db.close();
  await a.kald('PATCH', `/api/v1/notes/${n.id}`, { body: 'fire' });
  const db2 = new DatabaseSync(path.join(srv.dataDir, 'sagu.db'));
  const v2 = db2.prepare('SELECT body_md FROM note_versions WHERE note_id = ? ORDER BY at, rowid').all(n.id);
  db2.close();

  assert.deepEqual(v.map((x) => x.body_md), ['et'], 'samme stund = én version');
  assert.deepEqual(v2.map((x) => x.body_md), ['et', 'tre'],
    '»tre« var stundens resultat - det er dét, man vil tilbage til');
});

test('en slettet note forsvinder ogsaa fra SOEGEINDEKSET', async () => {
  const n = (await a.kald('POST', '/api/v1/notes', { title: 'Kortlivet', body: 'unikt-ord-xyzzy' })).data.note;
  assert.equal((await a.kald('GET', '/api/v1/search?q=xyzzy')).data.results.length, 1);
  await a.kald('DELETE', `/api/v1/notes/${n.id}`);
  assert.equal((await a.kald('GET', '/api/v1/search?q=xyzzy')).data.results.length, 0,
    'et indeks, der overlever sletningen, er en laekage');
});

/* ------------------------------------------------------- runen selv */

test('runens ports.default er DET SAMME tal som serverens standard', async () => {
  // De to skal foelges ad, og ellers fejler intet: serveren ville lytte et
  // sted, panelets mapping ikke peger paa (RUNE-ERFARINGER, doda v3).
  const yamlSti = path.join(ROD, 'runes', 'sagu.yaml');
  statSync(yamlSti);                             // kaster, hvis build ikke er koert
  const tekst = readFileSync(yamlSti, 'utf8');
  const iRune = Number(tekst.match(/name: web\n\s*default: (\d+)/)[1]);
  const kilde = readFileSync(path.join(ROD, 'app', 'server.js'), 'utf8');
  const iKode = Number(kilde.match(/process\.env\.BIND_PORT \|\| (\d+)/)[1]);
  assert.equal(iRune, iKode);
});

test('serveren binder BIND_PORT - ALDRIG PORT_web', async () => {
  // Panelets miljoe praecist: PORT_web og SAGU_PORT sat til host-porten,
  // BIND_PORT tom. Serveren skal lytte paa 3000, ikke paa host-porten.
  const { spawn } = await import('node:child_process');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(path.join(tmpdir(), 'sagu-port-'));
  const p = spawn('node', [path.join(ROD, 'app', 'server.js')], {
    env: {
      ...process.env, BIND_PORT: '', DATA_DIR: dir,
      PORT_web: '25012', SAGU_PORT: '25012',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let ud = '';
  p.stdout.on('data', (d) => { ud += d; });
  try {
    const port = await new Promise((ok, nej) => {
      const frist = setTimeout(() => nej(new Error(`ingen startlinje:\n${ud}`)), 8000);
      const kig = setInterval(() => {
        const m = ud.match(/sagu lytter paa port (\d+)/);
        if (m) { clearInterval(kig); clearTimeout(frist); ok(Number(m[1])); }
      }, 25);
    });
    assert.equal(port, 3000, 'PORT_web er HOST-porten og maa aldrig bindes inde i containeren');
  } finally {
    p.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  }
});

test('DANSK FOLDNING: ø og æ foldes ikke af FTS5 selv - kolonnen daekker dem', async () => {
  // Maalt: `remove_diacritics 2` folder Å (et A med ring), men IKKE ø og æ,
  // som Unicode regner for selvstaendige bogstaver. Uden den foldede kolonne
  // kan »grøn« ikke findes ved at taste »gron«.
  await a.kald('POST', '/api/v1/notes', { title: 'Grøn energi på Hjorten', body: 'bæredygtighed og Ørsted' });

  const proever = [
    ['grøn', 'eksakt'], ['groen', 'foldet lang'], ['gron', 'foldet kort'],
    ['bæredygtighed', 'eksakt'], ['baeredygtighed', 'foldet lang'], ['baredygtighed', 'foldet kort'],
    ['ørsted', 'eksakt'], ['oersted', 'foldet lang'], ['orsted', 'foldet kort'],
    ['på', 'eksakt'], ['paa', 'foldet lang'], ['pa', 'diakritisk (klarer FTS5 selv)'],
  ];
  for (const [q, hvad] of proever) {
    const r = await a.kald('GET', `/api/v1/search?q=${encodeURIComponent(q)}`);
    assert.equal(r.status, 200, `"${q}" (${hvad}) vaeltede soegningen`);
    assert.ok(r.data.results.length >= 1, `"${q}" (${hvad}) fandt ingenting`);
  }
});

test('en foldet traeffer maa ikke komme foran en EKSAKT', async () => {
  // Derfor vaegtes den foldede kolonne som broedteksten (1,0) og ikke hoejere.
  await a.kald('POST', '/api/v1/notes', { title: 'Gron uden bolle', body: 'intet saerligt' });
  await a.kald('POST', '/api/v1/notes', { title: 'Grøn med bolle', body: 'intet saerligt' });
  const r = await a.kald('GET', '/api/v1/search?q=gron');
  assert.ok(r.data.results.length >= 2, 'begge noter skal findes');
  assert.equal(r.data.results[0].title, 'Gron uden bolle',
    'det eksakte traef skal staa foerst; ellers er den foldede kolonne vaegtet for hoejt');
});

test('arkiv og papirkurv er TIDSSTEMPLER, ikke flag - og to forskellige ting', async () => {
  // "Hvornaar blev det lagt vaek" svarer paa spoergsmaal, et flueben ikke kan,
  // og det koster den samme byte. Papirkurven siger "det var en fejl, og om
  // 30 dage er den vaek"; arkivet siger "det er faerdigt, jeg vil ikke laese
  // forbi det". De maa ikke kunne forveksles.
  const foer = Math.floor(Date.now() / 1000);
  const n = (await a.kald('POST', '/api/v1/notes', { title: 'Afsluttet sag', body: 'x' })).data.note;
  assert.equal(n.archived, false);
  assert.equal(n.archivedAt, null);

  const ark = await a.kald('PATCH', `/api/v1/notes/${n.id}`, { archived: true });
  assert.equal(ark.status, 200);
  assert.equal(ark.data.note.archived, true);
  // Det afgoerende: der staar et TIDSPUNKT, ikke et 1-tal.
  assert.ok(ark.data.note.archivedAt >= foer && ark.data.note.archivedAt <= Math.floor(Date.now() / 1000) + 2,
    `archivedAt var ${ark.data.note.archivedAt} - det skal vaere et tidsstempel`);

  // Arkiveret betyder VAEK FRA LISTEN, men ikke slettet ...
  const liste = (await a.kald('GET', '/api/v1/notes')).data.notes;
  assert.ok(!liste.some((x) => x.id === n.id), 'en arkiveret note staar ikke i listen');
  const medArkiv = (await a.kald('GET', '/api/v1/notes?archived=1')).data.notes;
  assert.ok(medArkiv.some((x) => x.id === n.id), 'men den kan hentes frem');
  // ... og den er heller ikke i papirkurven. Det er to forskellige bits.
  const skrald = (await a.kald('GET', '/api/v1/notes?trash=1')).data.notes;
  assert.ok(!skrald.some((x) => x.id === n.id), 'arkiveret er ikke det samme som slettet');

  // Den kan tages frem igen, og stemplet ryddes.
  const frem = await a.kald('PATCH', `/api/v1/notes/${n.id}`, { archived: false });
  assert.equal(frem.data.note.archived, false);
  assert.equal(frem.data.note.archivedAt, null);

  // Og en SLETNING stempler sin egen kolonne - i databasen, ikke kun i svaret.
  await a.kald('DELETE', `/api/v1/notes/${n.id}`);
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(srv.dataDir, 'sagu.db'));
  const r = db.prepare('SELECT deleted_at, archived_at FROM notes WHERE id = ?').get(n.id);
  db.close();
  assert.ok(r.deleted_at >= foer, `deleted_at var ${r.deleted_at}`);
  assert.equal(r.archived_at, null, 'en sletning maa ikke ogsaa arkivere');
});

test('en arkiveret note kan stadig SOEGES frem', async () => {
  // Arkivet er "jeg vil ikke laese forbi det", ikke "det findes ikke".
  // Ellers er arkivering en datatabsmaskine med en paen knap.
  const n = (await a.kald('POST', '/api/v1/notes', { title: 'Gammel driftsnote', body: 'unikt-ord-arkiv' })).data.note;
  await a.kald('PATCH', `/api/v1/notes/${n.id}`, { archived: true });
  const r = await a.kald('GET', '/api/v1/search?q=arkiv');
  assert.ok(r.data.results.some((x) => x.id === n.id), 'arkiverede noter skal kunne findes');
});

test('taellerne i sidebaren skal matche det, listerne VISER', async () => {
  // Et tal, der taeller noget andet end den liste, det staar ved siden af,
  // ser rigtigt ud og lyver (RUNE-ERFARINGER, doda F3).
  const s2 = await startServer();
  try {
    const x = klient(s2.base);
    await x.opret('taeller', 'kodeord-1234');
    const a1 = (await x.kald('POST', '/api/v1/notes', { title: 'aaben 1' })).data.note;
    await x.kald('POST', '/api/v1/notes', { title: 'aaben 2' });
    const ark = (await x.kald('POST', '/api/v1/notes', { title: 'arkiveret' })).data.note;
    await x.kald('PATCH', `/api/v1/notes/${ark.id}`, { archived: true });
    await x.kald('DELETE', `/api/v1/notes/${a1.id}`);

    const c = (await x.kald('GET', '/api/v1/state')).data.counts;
    const liste = (await x.kald('GET', '/api/v1/notes')).data.notes;
    const skrald = (await x.kald('GET', '/api/v1/notes?trash=1')).data.notes;

    assert.equal(c.notes, liste.length, `taelleren siger ${c.notes}, listen viser ${liste.length}`);
    assert.equal(c.trash, skrald.length, `papirkurven siger ${c.trash}, listen viser ${skrald.length}`);
    assert.equal(c.notes, 1);
    assert.equal(c.archived, 1);
    assert.equal(c.trash, 1);
  } finally {
    s2.stop();
  }
});
