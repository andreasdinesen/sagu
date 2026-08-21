/*
 * F12 - GitHub i noter.
 *
 * ── Hvad testen kan måle uden GitHub ──────────────────────────────────────
 *
 * URL-tolkningen er en ren funktion og har ingen undskyldning for ikke at
 * være dækket helt: den er den ENE regel, tre steder deler (browseren, som
 * genkender en indsat adresse; rendereren, som gør linjen til en indlejring;
 * serveren, som oversætter til et API-kald). Går de tre fra hinanden, viser
 * det sig som »indlejringen virker i appen, men ikke på wikien«.
 *
 * Hentningen måles mod en **falsk GitHub** på loopback. Det er den eneste
 * måde at prøve de fejl, der betyder noget: 404 der dækker over både »findes
 * ikke« og »må ikke ses«, en opbrugt kvote, et 304 der ikke koster kvote — og
 * en frossen fil, der slet ikke bliver spurgt om igen.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import gh from '../app/shared/github.js';

/* ==================================== tolkningen ====================== */

test('en fil-adresse tolkes med ref, sti og linjeinterval', () => {
  const a = gh.tolk('https://github.com/andreasdinesen/sagu/blob/main/app/server.js');
  assert.equal(a.slags, 'fil');
  assert.equal(a.ejer, 'andreasdinesen');
  assert.equal(a.repo, 'sagu');
  assert.equal(a.ref, 'main');
  assert.equal(a.sti, 'app/server.js');
  assert.equal(a.frossen, false, 'en gren er ikke frossen — det er hele pointen');

  const sha = '0'.repeat(39) + 'a';
  const b = gh.tolk(`https://github.com/o/r/blob/${sha}/a/b.py#L10-L20`);
  assert.equal(b.frossen, true);
  assert.equal(b.fra, 10);
  assert.equal(b.til, 20);

  assert.equal(gh.tolk('https://github.com/o/r/blob/main/a.js#L7').fra, 7);
  assert.equal(gh.tolk('https://github.com/o/r/blob/main/a.js#L7').til, 7);
});

test('et vendt linjeinterval vendes tilbage frem for at blive afvist', () => {
  // En fumlet markering er ikke et forsoeg paa noget — og en indlejring, der
  // forsvinder, fordi man tog linjerne i den forkerte raekkefoelge, ligner
  // en fejl i appen.
  const a = gh.tolk('https://github.com/o/r/blob/main/a.js#L20-L10');
  assert.equal(a.fra, 10);
  assert.equal(a.til, 20);
});

test('sager og PR-er tolkes hver for sig', () => {
  assert.deepEqual(gh.tolk('https://github.com/o/r/issues/42'),
    { slags: 'issue', ejer: 'o', repo: 'r', nummer: 42 });
  assert.deepEqual(gh.tolk('https://github.com/o/r/pull/7'),
    { slags: 'pr', ejer: 'o', repo: 'r', nummer: 7 });
});

test('alt andet er et almindeligt link', () => {
  const nej = [
    'https://github.com/o/r',                      // repo-roden
    'https://github.com/o/r/tree/main/mappe',      // en mappe
    'https://github.com/o/r/releases/tag/v1',
    'https://gist.github.com/o/abc',
    'https://github.com/o',                        // en person
    'https://github.example.com/o/r/blob/main/a.js', // en fremmed vaert
    'http://github.com/o/r/blob/main/a.js',        // ikke https
    'https://github.com/o/r/issues/0',
    'https://github.com/o/r/issues/abc',
    'https://github.com/o/r/blob/main/',           // ingen sti
    'ikke en url',
    '',
    null,
  ];
  for (const u of nej) assert.equal(gh.tolk(u), null, `${u} skulle ikke tolkes`);
});

test('`..` i stien kan ikke naa igennem — og der er ingen vagt, fordi der ikke KAN være det', () => {
  /*
   * Målt, ikke antaget: `new URL()` normaliserer stien, før modulet ser den
   * — også den kodede form. En vagt her ville aldrig kunne fyre, og en vagt,
   * der ikke kan fyre, er værre end ingen (samme lærdom som m12's kolonne).
   */
  assert.equal(new URL('https://github.com/o/r/blob/main/a/%2e%2e/b.js').pathname,
    '/o/r/blob/main/b.js', 'URL normaliserer den kodede form');
  assert.equal(gh.tolk('https://github.com/o/r/blob/main/a/../b.js').sti, 'b.js');
  assert.equal(gh.tolk('https://github.com/o/r/blob/main/%2e%2e/%2e%2e/etc/passwd'), null);
});

test('linjeAdresse kræver at HELE linjen er adressen', () => {
  const u = 'https://github.com/o/r/issues/1';
  assert.ok(gh.linjeAdresse(u));
  assert.ok(gh.linjeAdresse(`  ${u}  `), 'mellemrum omkring er stadig én adresse');
  assert.equal(gh.linjeAdresse(`se ${u}`), null, 'en saetning er ikke en indlejring');
  assert.equal(gh.linjeAdresse(`${u} og mere`), null);
});

test('medRef bygger adressen igen — med ankeret intakt', () => {
  const info = gh.tolk('https://github.com/o/r/blob/main/a b/c.js#L3-L9');
  const sha = 'a'.repeat(40);
  assert.equal(gh.medRef(info, sha), `https://github.com/o/r/blob/${sha}/a%20b/c.js#L3-L9`);
  // Ét linjenummer skrives som ét, ikke som L3-L3.
  const en = gh.tolk('https://github.com/o/r/blob/main/a.js#L3');
  assert.equal(gh.medRef(en, sha), `https://github.com/o/r/blob/${sha}/a.js#L3`);
});

test('cachenøglen bærer sha for en frossen fil — og ikke for noget foranderligt', () => {
  const sha = 'b'.repeat(40);
  const frossen = gh.tolk(`https://github.com/o/r/blob/${sha}/a.js`);
  assert.ok(gh.cacheNoegle(frossen).includes(sha),
    'en frossen fil kan caches for evigt, og noeglen skal kunne baere det');
  const gren = gh.tolk('https://github.com/o/r/blob/main/a.js');
  assert.notEqual(gh.cacheNoegle(gren), gh.cacheNoegle(frossen));
  // Linjeintervallet er IKKE med: to noter, der viser hver sit uddrag af den
  // samme fil, skal dele ét svar.
  const udsnit = gh.tolk(`https://github.com/o/r/blob/${sha}/a.js#L1-L5`);
  assert.equal(gh.cacheNoegle(udsnit), gh.cacheNoegle(frossen));
});

/* ================================ mod en falsk GitHub ================= */

import http from 'node:http';
import { startServer, klient } from './hjaelp.mjs';

let falsk;          // vores egen »GitHub«
let falskBase;
let srv;
let a;
const kald = [];    // hvad den falske GitHub blev spurgt om
let svarMed = null; // en test kan overtage svaret

function falskGithub() {
  return http.createServer((req, res) => {
    kald.push({ sti: req.url, auth: req.headers.authorization || '', etag: req.headers['if-none-match'] || '' });
    if (svarMed) { svarMed(req, res); return; }

    const fil = (indhold, sti) => {
      const krop = JSON.stringify({
        type: 'file', size: Buffer.byteLength(indhold),
        content: Buffer.from(indhold).toString('base64'),
        html_url: `https://github.com/o/r/blob/main/${sti}`,
      });
      res.writeHead(200, { 'Content-Type': 'application/json', ETag: '"v1"' });
      res.end(krop);
    };

    if (/^\/repos\/o\/r\/commits\//.test(req.url)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sha: 'c'.repeat(40) }));
      return;
    }
    if (/^\/repos\/o\/r\/contents\/findesikke/.test(req.url)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{"message":"Not Found"}');
      return;
    }
    if (/^\/repos\/o\/r\/contents\//.test(req.url)) {
      fil('linje et\nlinje to\nlinje tre\nlinje fire\n', 'a.js');
      return;
    }
    if (req.url === '/user') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"login":"andreasdinesen"}');
      return;
    }
    if (/^\/repos\/o\/r\/issues\/42/.test(req.url)) {
      res.writeHead(200, { 'Content-Type': 'application/json', ETag: '"i1"' });
      res.end(JSON.stringify({
        number: 42, title: 'Noget der driller', state: 'open',
        user: { login: 'andreas' }, comments: 3, labels: [{ name: 'bug' }],
      }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"message":"Not Found"}');
  });
}

before(async () => {
  falsk = falskGithub();
  await new Promise((ok) => falsk.listen(0, '127.0.0.1', ok));
  falskBase = `http://127.0.0.1:${falsk.address().port}`;
  srv = await startServer({ SAGU_GITHUB_API: falskBase });
  a = klient(srv.base);
  await a.opret('ejer', 'kodeord-1234');
});

after(async () => {
  if (srv) srv.stop();
  if (falsk) await new Promise((ok) => falsk.close(ok));
});

const hent = (url) => a.kald('GET', `/api/v1/github?url=${encodeURIComponent(url)}`);
const frys = (url) => a.kald('POST', '/api/v1/github/freeze', { url });

test('en gren FRYSES til en sha — det er hele fasens pointe', async () => {
  const r = await frys('https://github.com/o/r/blob/main/a.js#L2-L3');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.frozen, true);
  assert.equal(r.data.url, `https://github.com/o/r/blob/${'c'.repeat(40)}/a.js#L2-L3`,
    'ankeret skal med — ellers taber uddraget sine linjer');
});

test('en sag fryses IKKE — den skal netop vise, hvordan det står nu', async () => {
  const r = await frys('https://github.com/o/r/issues/42');
  assert.equal(r.status, 200);
  assert.equal(r.data.frozen, false);
  assert.equal(r.data.url, 'https://github.com/o/r/issues/42');
});

test('en fil hentes med linjenumre og kun det valgte udsnit', async () => {
  const sha = 'c'.repeat(40);
  const r = await hent(`https://github.com/o/r/blob/${sha}/a.js#L2-L3`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const e = r.data.embed;
  assert.equal(e.slags, 'fil');
  assert.equal(e.tekst, 'linje to\nlinje tre');
  assert.equal(e.foersteLinje, 2, 'numrene skal passe til FILEN, ikke til udsnittet');
  assert.equal(e.linjer, 2);
  assert.equal(e.ialt, 4);
  assert.equal(e.sprog, 'javascript');
});

test('en FROSSEN fil spørges der ikke om igen', async () => {
  const sha = 'd'.repeat(40);
  const url = `https://github.com/o/r/blob/${sha}/a.js`;
  const foer = kald.length;
  assert.equal((await hent(url)).status, 200);
  const efterFoerste = kald.length;
  assert.ok(efterFoerste > foer, 'foerste gang skal koste et kald');

  for (let i = 0; i < 3; i++) assert.equal((await hent(url)).status, 200);
  assert.equal(kald.length, efterFoerste,
    'en frossen fil kan ikke aendre sig — tre optegninger mere maa ikke koste ét kald');
  assert.equal((await hent(url)).data.source, 'cache');
});

test('en sag genopfriskes med If-None-Match, og et 304 koster ingen kvote', async () => {
  const url = 'https://github.com/o/r/issues/42';
  assert.equal((await hent(url)).status, 200);

  // Tving en genopfriskning: stemplet flyttes bagud i databasen ved siden af.
  const { DatabaseSync } = await import('node:sqlite');
  const path = await import('node:path');
  const d = new DatabaseSync(path.join(srv.dataDir, 'sagu.db'));
  d.exec('UPDATE github_cache SET hentet_at = 0');
  d.close();

  svarMed = (req, res) => {
    assert.equal(req.headers['if-none-match'], '"i1"', 'etaggen skal sendes med');
    res.writeHead(304);
    res.end();
  };
  const r = await hent(url);
  svarMed = null;
  assert.equal(r.status, 200);
  assert.equal(r.data.source, 'etag');
  assert.equal(r.data.embed.titel, 'Noget der driller', 'indholdet staar stadig rigtigt');
});

test('en sag bliver til en chip med tilstand, forfatter og mærker', async () => {
  const e = (await hent('https://github.com/o/r/issues/42')).data.embed;
  assert.equal(e.slags, 'issue');
  assert.equal(e.nummer, 42);
  assert.equal(e.tilstand, 'open');
  assert.equal(e.forfatter, 'andreas');
  assert.deepEqual(e.maerker, ['bug']);
});

test('en LUKKET PR skelnes fra en FLETTET — det er den vigtigste forskel', async () => {
  svarMed = (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      number: 7, title: 'Flettet', state: 'closed',
      pull_request: { merged_at: '2026-08-01T10:00:00Z' },
    }));
  };
  const e = (await hent('https://github.com/o/r/pull/7')).data.embed;
  svarMed = null;
  assert.equal(e.slags, 'pr');
  assert.equal(e.tilstand, 'merged',
    '`state` siger kun open/closed — en lukket PR kan vaere flettet eller afvist');
});

test('404 nævner BEGGE muligheder — ellers fejlsøger man et token, der er i orden', async () => {
  const r = await hent('https://github.com/o/r/blob/' + 'e'.repeat(40) + '/findesikke.js');
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'not_found');
  assert.match(r.data.message, /does not exist/);
  assert.match(r.data.message, /private/, 'uden token skal beskeden naevne, at repoet kan vaere privat');
  assert.match(r.data.message, /token in Settings/);
});

test('en opbrugt kvote siger HVORNÅR den er tilbage', async () => {
  svarMed = (req, res) => {
    res.writeHead(403, {
      'Content-Type': 'application/json',
      'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 25 * 60),
    });
    res.end('{"message":"rate limited"}');
  };
  const r = await hent('https://github.com/o/r/blob/' + 'f'.repeat(40) + '/kvote.js');
  svarMed = null;
  assert.equal(r.data.error, 'rate_limited');
  assert.match(r.data.message, /2[45] min/, '»try again later« er ikke noget, nogen kan handle paa');
  assert.match(r.data.message, /5\.000/, 'og den skal sige, hvad et token ville give');
});

test('en binær fil vises ikke som en skærm fuld af skrald', async () => {
  svarMed = (req, res) => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03]);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ type: 'file', size: buf.length, content: buf.toString('base64') }));
  };
  const r = await hent('https://github.com/o/r/blob/' + '1'.repeat(40) + '/logo.png');
  svarMed = null;
  assert.equal(r.data.error, 'binary');
});

test('et gammelt svar er bedre end en fejl, når GitHub har en dårlig dag', async () => {
  const url = 'https://github.com/o/r/issues/42';
  assert.equal((await hent(url)).status, 200);
  const { DatabaseSync } = await import('node:sqlite');
  const path = await import('node:path');
  const d = new DatabaseSync(path.join(srv.dataDir, 'sagu.db'));
  d.exec('UPDATE github_cache SET hentet_at = 0');
  d.close();

  svarMed = (req, res) => { res.writeHead(500); res.end('{}'); };
  const r = await hent(url);
  svarMed = null;
  assert.equal(r.status, 200, 'en note maa ikke tabe sit indhold, fordi GitHub er nede');
  assert.equal(r.data.source, 'gammel');
  assert.match(r.data.warning, /GitHub answered 500/);
});

test('tokenet forlader aldrig serveren, og sendes med når det er sat', async () => {
  const udenToken = kald[kald.length - 1];
  assert.equal(udenToken.auth, '', 'uden et token skal der ikke staa en Authorization-header');

  const sat = await a.kald('POST', '/api/v1/github/token', { token: 'ghp_hemmelig' });
  assert.equal(sat.status, 200, JSON.stringify(sat.data));
  assert.equal(sat.data.login, 'andreasdinesen', 'tokenet skal PROEVES foer det gemmes');
  const foer = kald.length;
  await hent('https://github.com/o/r/blob/' + '2'.repeat(40) + '/a.js');
  assert.equal(kald[foer].auth, 'Bearer ghp_hemmelig');

  // ... men frontenden faar det ALDRIG at se.
  const st = await a.kald('GET', '/api/v1/state');
  assert.equal(JSON.stringify(st.data).includes('ghp_hemmelig'), false,
    'en hemmelighed forlader ikke serveren — frontenden faar et connected-flag');
});

test('en adresse, Sagu ikke kan vise, afvises af RUTEN — ikke af GitHub', async () => {
  const foer = kald.length;
  const r = await hent('https://github.com/o/r/tree/main/mappe');
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'not_github');
  assert.equal(kald.length, foer, 'der maa ikke gaa et kald af sted for en adresse, vi selv kan afvise');
});

/* ==================================== på wikien ======================= */

test('wikien tegner indlejringen — men henter ALDRIG selv', async () => {
  /*
   * En offentlig side må ikke kunne bruge ejerens GitHub-kvote op.
   *
   * En fremmed, der genindlæser hurtigt nok, ville ellers spørge GitHub med
   * ejerens token — altså mod hans private repoer. Wikien læser derfor kun
   * cachen, og er den tom, står linjen som det link, den var.
   */
  const sha = '3'.repeat(40);
  const url = `https://github.com/o/r/blob/${sha}/a.js#L1-L2`;
  const note = (await a.kald('POST', '/api/v1/notes',
    { title: 'Kode udadtil', body: `Sådan gør man:\n\n${url}\n` })).data.note;
  const share = (await a.kald('POST', '/api/v1/shares', { noteId: note.id, slug: 'kode' })).data.share;
  assert.ok(share);

  // FØR ejeren har åbnet noten er cachen tom: linjen skal være et link.
  const foer = kald.length;
  const tom = await fetch(`${srv.base}/w/kode`);
  const tomHtml = await tom.text();
  assert.equal(tom.status, 200, tomHtml.slice(0, 200));
  assert.equal(kald.length, foer, 'wikien maa ikke udloese et kald til GitHub');
  assert.ok(!tomHtml.includes('gh-kode'), 'uden cache er der intet kort at tegne');
  assert.ok(tomHtml.includes(sha), 'men adressen skal stadig staa der som et link');

  // Ejeren åbner noten -> cachen fyldes.
  assert.equal((await hent(url)).status, 200);

  const efter = kald.length;
  const med = await fetch(`${srv.base}/w/kode`);
  const medHtml = await med.text();
  assert.equal(kald.length, efter, 'og heller ikke NU, hvor der ER noget at vise');
  assert.ok(medHtml.includes('gh-kode'), 'nu staar kortet der');
  assert.ok(medHtml.includes('linje et'), 'med koden i');
  // Ingen knapper: der er ingen app-JS paa en offentlig side.
  assert.ok(!medHtml.includes('data-gh-kopi'));
  assert.ok(!medHtml.includes('data-gh-frisk'));
  assert.match(medHtml, /rel="noopener noreferrer nofollow"/);
});
