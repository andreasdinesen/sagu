/*
 * F8 - broen til doda.
 *
 * En integration mod en fremmed tjeneste kan ikke testes mod tjenesten selv:
 * den skal koere paa en maskine uden doda, og den skal kunne proeve de
 * fejlstier, en rigtig doda ikke vil finde sig i at levere paa kommando.
 * Derfor koerer testene mod en **doda-attrap** - en lille http-server, der
 * svarer som doda goer, og som kan bedes om at svare forkert.
 *
 * Det, der maales, er derfor ikke »kan vi tale med doda« (det er ét kald),
 * men de tre ting, der faktisk gaar galt i en bro:
 *
 *  1. **Fejlstien.** Et netvaerksbrud, en for smal noegle og en doedt
 *     endepunkt skal kunne SKELNES - ellers fejlsoeger man et token, der er
 *     helt i orden (RUNE-ERFARINGER §6b, tools v1).
 *  2. **Rundturen.** Der maa aldrig gaa et kald pr. optegning. Attrappen
 *     TAELLER sine kald, saa reglen kan bevises frem for at staa i en
 *     kommentar (doda v27).
 *  3. **Hemmeligheden.** Noeglen maa aldrig kunne laeses tilbage.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startServer, klient } from './hjaelp.mjs';

let srv;
let a;
let attrap;

/**
 * En doda-attrap.
 *
 * `svar` kan skiftes ud undervejs, saa den samme test kan se baade en
 * virkende og en gaaen-i-stykker doda - og `kald` taeller, saa »aldrig et
 * kald pr. optegning« kan MAALES.
 */
function dodaAttrap() {
  const kald = [];
  let tilstand = 'ok';
  let naeste = 1;
  const items = new Map();
  const s = createServer(async (req, res) => {
    kald.push(`${req.method} ${req.url}`);
    const send = (kode, krop) => {
      res.writeHead(kode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(krop));
    };
    if (tilstand === 'nede') { req.destroy(); return; }
    if (String(req.headers.authorization || '') !== 'Bearer doda_rigtig') {
      send(401, { error: 'unauthorized', message: 'No key.' });
      return;
    }
    if (tilstand === 'smal' && req.method === 'GET') {
      // Praecis dodas egen form - det er DEN, broen skal kunne genkende.
      send(403, { error: 'wrong_scope', message: 'This key is "capture" and cannot read.' });
      return;
    }
    if (req.url.startsWith('/api/v1/state')) {
      send(200, { counts: { next: 3, inbox: 2 } });
      return;
    }
    if (req.url.startsWith('/api/v1/changes')) {
      send(200, { now: 1000, items: [...items.values()], deleted: [...items.values()]
        .filter((x) => x.slettet).map((x) => x.id) });
      return;
    }
    /*
     * Attrappen kan nu ogsaa AENDRE en opgave - det er dodas `write`, og
     * broens nye »afslut herfra« gaar netop den vej.
     */
    const m = req.url.match(/^\/api\/v1\/items\/([^/]+)\/(complete|uncomplete)$/);
    if (req.method === 'POST' && m) {
      if (tilstand === 'kunlaes') {
        send(403, { error: 'wrong_scope', message: 'This key is "read" and cannot write.' });
        return;
      }
      const it = items.get(m[1]);
      if (!it) { send(404, { error: 'not_found', message: 'No such item.' }); return; }
      it.status = m[2] === 'complete' ? 'done' : 'next';
      send(200, { item: it });
      return;
    }
    if (req.method === 'POST' && req.url.startsWith('/api/v1/capture')) {
      let raa = '';
      for await (const bid of req) raa += bid;
      const krop = JSON.parse(raa || '{}');
      const id = `d${naeste}`;
      naeste += 1;
      items.set(id, { id, title: krop.text, status: 'inbox' });
      send(200, { item: items.get(id), message: `Added: ${krop.text}` });
      return;
    }
    send(404, { error: 'unknown_endpoint', message: 'No such endpoint.' });
  });
  return {
    async start() {
      await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
      return `http://127.0.0.1:${s.address().port}`;
    },
    luk: () => s.close(),
    kald,
    ryd: () => { kald.length = 0; },
    saet: (t) => { tilstand = t; },
    items,
  };
}

before(async () => {
  srv = await startServer();
  a = klient(srv.base);
  await a.opret('ejer', 'kodeord-1234');
  attrap = dodaAttrap();
  attrap.url = await attrap.start();
});

after(() => { attrap.luk(); srv.stop(); });

const forbind = (url, key) => a.kald('POST', '/api/v1/doda', { url, key });

async function nyNote(felter) {
  return (await a.kald('POST', '/api/v1/notes', felter || { title: 'Note', body: 'x' })).data.note;
}

/* ============================================== forbindelsen =========== */

test('en forkert noegle GEMMES ikke - forbindelsen rulles tilbage', async () => {
  /*
   * Raekkefoelgen er hele pointen: gem, afproev, rul tilbage. Ellers ligger et
   * forkert token og LIGNER en virkende forbindelse, indtil brugeren proever
   * at bruge den (RUNE-ERFARINGER, doda v16).
   */
  const r = await forbind(attrap.url, 'doda_forkert');
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'bad_key');
  const efter = await a.kald('GET', '/api/v1/doda');
  assert.equal(efter.data.connected, false, 'intet maa vaere gemt efter et afvist forsoeg');
  assert.equal(efter.data.url, '');
});

test('en adresse, der ikke svarer, siger DET - ikke »forkert noegle«', async () => {
  // De to fejl foerer til hver sin handling: den ene er en adresse, den anden
  // et token. Bland dem, og brugeren leder det forkerte sted.
  const r = await forbind('http://127.0.0.1:9', 'doda_rigtig');
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'unreachable');
  assert.match(r.data.message, /did not answer/);
});

test('kun en rigtig adresse godtages', async () => {
  for (const d of ['ikke en adresse', 'javascript:alert(1)', `${attrap.url}/api/v1`]) {
    const r = await forbind(d, 'doda_rigtig');
    assert.equal(r.status, 400, d);
    assert.equal(r.data.error, 'bad_url');
  }
});

test('en rigtig noegle forbinder - og noeglen kan ALDRIG laeses tilbage', async () => {
  const r = await forbind(attrap.url, 'doda_rigtig');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(r.data.message, /3 next actions/, 'proeven skal sige hvad den saa');

  const set = await a.kald('GET', '/api/v1/doda');
  assert.equal(set.data.connected, true);
  assert.equal(set.data.url, attrap.url);
  assert.equal(JSON.stringify(set.data).includes('doda_rigtig'), false,
    'noeglen maa aldrig forlade serveren');

  // Heller ikke ad en anden vej: eksporten har sin egen filtrering, og de to
  // lister skal vaere den SAMME (RUNE-ERFARINGER, doda v16).
  const eksport = await a.kald('GET', '/api/v1/export');
  assert.equal(JSON.stringify(eksport.data).includes('doda_rigtig'), false,
    'og slet ikke i en eksportfil, brugeren maaske deler videre');
});

test('en noegle, der kun kan FANGE, forbinder - men siger hvad den ikke kan', async () => {
  attrap.saet('smal');
  const r = await forbind(attrap.url, 'doda_rigtig');
  assert.equal(r.status, 200, 'en smal noegle er ikke en fejl');
  assert.equal(r.data.limited, true);
  assert.match(r.data.message, /cannot read/);
  attrap.saet('ok');
  await forbind(attrap.url, 'doda_rigtig');
});

/* ============================================== at sende en opgave ===== */

test('en note kan sende en opgave - med et link tilbage til sig selv', async () => {
  const n = await nyNote({ title: 'VPN', body: '# VPN\n\ntekst' });
  const r = await a.kald('POST', `/api/v1/notes/${n.id}/tasks`,
    { text: 'Ret trin 2 #drift' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.tasks.length, 1);
  assert.match(r.data.message, /Added:/);

  /*
   * Linket skal PEGE paa noten - og det skal have sin EGEN linje.
   *
   * Foerste udgave haengte det paa enden med et tankestreg. Maalt mod en
   * rigtig doda kostede det baade linket OG datoen: dodas `!`-markoer loeber
   * til linjens ende, saa `!i morgen — http://…` blev ét datoudtryk, der ikke
   * gav mening. Intet fejlede; opgaven kom bare ind uden begge dele.
   */
  const sendt = [...attrap.items.values()].pop();
  const linjer = sendt.title.split('\n');
  assert.equal(linjer[0], 'Ret trin 2 #drift',
    'foerste linje skal vaere brugerens tekst - UROERT, saa en aaben markoer ikke aeder noget');
  assert.match(linjer[1] || '', new RegExp(`#note-${n.id}$`),
    'og adressen skal staa alene paa sin egen linje');
  // Markoererne staar uroert: teksten er dodas sprog, ikke Sagus.
  assert.match(linjer[0], /#drift/);

  // Men i SAGUS egen liste er adressen stoej - den peger tilbage paa den note,
  // raekken allerede staar paa.
  assert.ok(!r.data.tasks[0].title.includes('#note-'));
});

test('en tom opgave er ikke en opgave', async () => {
  const n = await nyNote();
  assert.equal((await a.kald('POST', `/api/v1/notes/${n.id}/tasks`, { text: '  ' })).status, 400);
});

test('doda nede: en chip med en paen fejl - ikke en fejlet gemning', async () => {
  const n = await nyNote({ title: 'Mens doda er nede', body: 'x' });
  attrap.saet('nede');
  const r = await a.kald('POST', `/api/v1/notes/${n.id}/tasks`, { text: 'noget' });
  attrap.saet('ok');
  // 502, ikke 500: det er den ANDEN ende, der svigtede, og koden skal kunne
  // skelnes af frontenden, saa den kan sige det paent.
  assert.equal(r.status, 502);
  assert.equal(r.data.error, 'unreachable');
  assert.match(r.data.message, /did not answer/);
  // Og der maa ikke ligge en halv opgave tilbage.
  assert.equal((await a.kald('GET', `/api/v1/notes/${n.id}/tasks`)).data.tasks.length, 0);
});

test('uden forbindelse siger den det - i stedet for at fejle uforstaaeligt', async () => {
  const b = klient(srv.base);
  await a.kald('POST', '/api/v1/admin', { allowRegistration: true });
  await b.opret('anden', 'kodeord-1234');
  const n = (await b.kald('POST', '/api/v1/notes', { title: 'Uden doda', body: 'x' })).data.note;
  const r = await b.kald('POST', `/api/v1/notes/${n.id}/tasks`, { text: 'noget' });
  assert.equal(r.status, 409);
  assert.equal(r.data.error, 'not_connected');
});

/* ============================================== rundturen ============== */

test('status hentes fra Sagus EGEN tabel - aldrig et kald pr. optegning', async () => {
  const n = await nyNote({ title: 'Rundtur', body: 'x' });
  await a.kald('POST', `/api/v1/notes/${n.id}/tasks`, { text: 'opgave A' });
  await a.kald('POST', `/api/v1/notes/${n.id}/tasks`, { text: 'opgave B' });

  attrap.ryd();
  // Ti opslag i traek, som en bruger der bladrer frem og tilbage.
  for (let i = 0; i < 10; i++) {
    const r = await a.kald('GET', `/api/v1/notes/${n.id}/tasks`);
    assert.equal(r.data.tasks.length, 2);
  }
  assert.deepEqual(attrap.kald, [],
    `ti opslag gav ${attrap.kald.length} kald til doda - der maa gaa NUL`);
});

test('en opfriskning er ÉT kald for alle opgaver - ikke ét pr. opgave', async () => {
  const n = await nyNote({ title: 'Opfrisk', body: 'x' });
  await a.kald('POST', `/api/v1/notes/${n.id}/tasks`, { text: 'en' });
  await a.kald('POST', `/api/v1/notes/${n.id}/tasks`, { text: 'to' });
  await a.kald('POST', `/api/v1/notes/${n.id}/tasks`, { text: 'tre' });

  attrap.ryd();
  const r = await a.kald('GET', `/api/v1/notes/${n.id}/tasks?refresh=1`);
  assert.equal(r.status, 200);
  assert.equal(attrap.kald.length, 1, `tre opgaver gav ${attrap.kald.length} kald`);
  assert.match(attrap.kald[0], /^GET \/api\/v1\/changes\?since=/);
});

test('en status, der aendrer sig i doda, slaar igennem ved opfriskning', async () => {
  const n = await nyNote({ title: 'Status', body: 'x' });
  await a.kald('POST', `/api/v1/notes/${n.id}/tasks`, { text: 'bliver gjort' });
  const sendt = [...attrap.items.values()].pop();

  sendt.status = 'done';
  sendt.title = 'bliver gjort (rettet i doda)';
  const r = await a.kald('GET', `/api/v1/notes/${n.id}/tasks?refresh=1`);
  const t = r.data.tasks.find((x) => x.dodaId === sendt.id);
  assert.equal(t.status, 'done');
  assert.match(t.title, /rettet i doda/, 'titlen foelger med, saa raekken ikke lyver');
});

test('en opgave, der SLETTES i doda, bliver ikke staaende som aaben', async () => {
  const n = await nyNote({ title: 'Slettet', body: 'x' });
  await a.kald('POST', `/api/v1/notes/${n.id}/tasks`, { text: 'forsvinder' });
  const sendt = [...attrap.items.values()].pop();
  sendt.slettet = true;
  const r = await a.kald('GET', `/api/v1/notes/${n.id}/tasks?refresh=1`);
  assert.equal(r.data.tasks.find((x) => x.dodaId === sendt.id).status, 'deleted');
});

test('doda nede under en opfriskning: raekkerne staar der stadig', async () => {
  // En bro, der bliver TOM naar den anden ende er nede, ligner en bro, der
  // har mistet noget. Fejlen sendes med i stedet for at faelde kaldet.
  const n = await nyNote({ title: 'Uden svar', body: 'x' });
  await a.kald('POST', `/api/v1/notes/${n.id}/tasks`, { text: 'staar ved magt' });
  attrap.saet('nede');
  const r = await a.kald('GET', `/api/v1/notes/${n.id}/tasks?refresh=1`);
  attrap.saet('ok');
  assert.equal(r.status, 200);
  assert.equal(r.data.tasks.length, 1);
  assert.equal(r.data.tasks[0].title, 'staar ved magt');
  assert.ok(!r.data.tasks[0].title.includes('#note-'),
    'Sagus egen liste skal vise opgavens TEKST - ikke den adresse, den selv haengte paa');
  assert.match(r.data.staleReason || '', /did not answer/, 'og den siger hvorfor den ikke er frisk');
});

/* ============================================== isolationen ============ */

test('ISOLATION: forbindelsen er personlig, og opgaverne er ejerens', async () => {
  const b = klient(srv.base);
  await b.kald('POST', '/api/login', { username: 'anden', password: 'kodeord-1234' });

  // B har sin egen (tomme) forbindelse - ikke A's.
  assert.equal((await b.kald('GET', '/api/v1/doda')).data.connected, false);

  const n = await nyNote({ title: 'A\'s note', body: 'x' });
  await a.kald('POST', `/api/v1/notes/${n.id}/tasks`, { text: 'A\'s opgave' });
  assert.equal((await b.kald('GET', `/api/v1/notes/${n.id}/tasks`)).status, 404);
  assert.equal((await b.kald('POST', `/api/v1/notes/${n.id}/tasks`, { text: 'ind' })).status, 404);
});

test('en noegle maa ikke kunne saette en noegle', async () => {
  // Auth-ruterne staar uden for »ét API, to legitimationer«: ellers er én
  // laekket noegle nok til at pege Sagu paa en fremmed doda.
  const noegle = (await a.kald('POST', '/api/v1/keys', { name: 'k', scope: 'full' })).data.key;
  const r = await a.kald('POST', '/api/v1/doda', { url: 'https://ondt.eksempel.dk', key: 'x' },
    { udenCookie: true, headers: { Authorization: `Bearer ${noegle}` } });
  assert.equal(r.status, 401);
  assert.equal((await a.kald('GET', '/api/v1/doda')).data.url, attrap.url, 'uroert');
});

test('en capture-noegle kan ikke laese opgaverne, og en link-noegle kan begge dele', async () => {
  const n = await nyNote({ title: 'Scopes', body: 'x' });
  const noegler = {};
  for (const scope of ['capture', 'read', 'link']) {
    noegler[scope] = (await a.kald('POST', '/api/v1/keys', { name: scope, scope })).data.key;
  }
  const med = (scope, metode, sti, krop) => a.kald(metode, sti, krop, {
    udenCookie: true, headers: { Authorization: `Bearer ${noegler[scope]}` },
  });
  // `link` er hele grunden til, at scopet findes: en soesterapp skal kunne
  // finde den rigtige note og lave en ny - og ikke andet.
  assert.equal((await med('link', 'GET', `/api/v1/notes/${n.id}`)).status, 200);
  assert.equal((await med('link', 'POST', '/api/v1/notes', { title: 'Fra doda', body: '' })).status, 200);
  assert.equal((await med('link', 'DELETE', `/api/v1/notes/${n.id}`)).status, 403,
    'link maa IKKE kunne slette');
  assert.equal((await med('capture', 'GET', `/api/v1/notes/${n.id}`)).status, 403);
  assert.equal((await med('read', 'POST', '/api/v1/notes', { title: 'nej', body: '' })).status, 403);
});

test('en opgave, der er lukket i doda, bliver opfrisket i Sagu', async () => {
  /*
   * Fejlen var ikke i mekanikken, men i VINDUET: status blev opfrisket højst
   * hvert kvarter, og den almindelige gang er »send en opgave, luk den i
   * doda, kom tilbage til noten« — altså langt under et kvarter. Opgaven stod
   * som åben, og broen så død ud (Andreas, 2026-08-21).
   *
   * Testen måler det, der betyder noget: at et lukket punkt i dodas
   * ændringsfeed slår igennem på noten.
   */
  const n = (await a.kald('POST', '/api/v1/notes', { title: 'Med en opgave' })).data.note;
  const r = await a.kald('POST', `/api/v1/notes/${n.id}/tasks`, { text: 'Ring til GoldWave' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const opg = r.data.tasks.find((t) => t.title.includes('GoldWave'));
  assert.ok(opg, 'opgaven skal staa paa noten');
  assert.notEqual(opg.status, 'done');

  // doda melder den nu som fuldført.
  const hos = attrap.items.get(opg.dodaId);
  assert.ok(hos, 'attrappen skal kende opgaven');
  hos.status = 'done';

  const efter = await a.kald('GET', `/api/v1/notes/${n.id}/tasks?refresh=1`);
  const nu = efter.data.tasks.find((t) => t.title.includes('GoldWave'));
  assert.equal(nu.status, 'done', 'status skal foelge med fra dodas aendringsfeed');
});

test('opfrisknings-vinduet er kort nok til at man tror på det, man ser', async () => {
  /*
   * Det var her, fejlen lå — ikke i mekanikken.
   *
   * Testen ovenfor tvinger en opfriskning (`?refresh=1`) og beviser derfor,
   * at status KAN følge med. Men i brug kom den ikke: vinduet var et kvarter,
   * og den almindelige gang tager to minutter. **En test, der forcerer det,
   * brugeren ikke kan forcere, måler mekanikken og ikke oplevelsen.**
   *
   * Tallet pinnes derfor. Sættes det op igen, skal det være et bevidst valg.
   */
  const { FRISK_I } = await import('../app/doda.js');
  assert.ok(FRISK_I <= 120,
    `opfrisknings-vinduet er ${FRISK_I} s - saa staar en lukket opgave som aaben for laenge`);
  assert.ok(FRISK_I >= 15, 'og det maa ikke blive saa kort, at det bliver ét kald pr. optegning');
});

/* ==================== afslut en opgave uden at forlade noten ============ */

/*
 * »Mulighed for at afslutte en opgave i doda fra sagu, når de er listet i
 * sagu« (Andreas, 2026-08-24).
 *
 * Det farlige ved den vej er ikke, at den ikke virker. Det er, at den virker
 * på for meget: en id, nogen kunne gætte, må ikke kunne afslutte en opgave,
 * der ikke står på denne note — det er dodas arkiv, ikke Sagus.
 */
test('en opgave kan afsluttes fra noten — og fortrydes igen', async () => {
  const note = (await a.kald('POST', '/api/v1/notes', { title: 'Drift', body: '# Drift' })).data.note;
  await a.kald('POST', `/api/v1/notes/${note.id}/tasks`, { text: 'Ring til Bo' });
  const foer = (await a.kald('GET', `/api/v1/notes/${note.id}/tasks`)).data.tasks;
  assert.equal(foer.length, 1);
  const dodaId = foer[0].dodaId;

  const gjort = await a.kald('POST', `/api/v1/notes/${note.id}/tasks/${dodaId}`, { done: true });
  assert.equal(gjort.status, 200);
  assert.equal(gjort.data.tasks[0].status, 'done');
  assert.equal([...attrap.items.values()].find((i) => i.id === dodaId).status, 'done',
    'doda er dén, der bestemmer - vi skriver ikke bare vores egen raekke');

  const fortrudt = await a.kald('POST', `/api/v1/notes/${note.id}/tasks/${dodaId}`, { done: false });
  assert.equal(fortrudt.status, 200);
  assert.notEqual(fortrudt.data.tasks[0].status, 'done');
  assert.equal([...attrap.items.values()].find((i) => i.id === dodaId).status, 'next');
});

test('en opgave, der ikke står på noten, kan ikke afsluttes gennem den', async () => {
  const en = (await a.kald('POST', '/api/v1/notes', { title: 'En', body: '# En' })).data.note;
  const to = (await a.kald('POST', '/api/v1/notes', { title: 'To', body: '# To' })).data.note;
  await a.kald('POST', `/api/v1/notes/${en.id}/tasks`, { text: 'Hoerer til EN' });
  const dodaId = (await a.kald('GET', `/api/v1/notes/${en.id}/tasks`)).data.tasks[0].dodaId;

  const r = await a.kald('POST', `/api/v1/notes/${to.id}/tasks/${dodaId}`, { done: true });
  assert.equal(r.status, 404);
  assert.equal([...attrap.items.values()].find((i) => i.id === dodaId).status, 'inbox',
    'og doda er uroert');
});

test('en nøgle, der kun må læse, får at vide hvad der mangler', async () => {
  const note = (await a.kald('POST', '/api/v1/notes', { title: 'Smal', body: '# Smal' })).data.note;
  await a.kald('POST', `/api/v1/notes/${note.id}/tasks`, { text: 'Noget' });
  const dodaId = (await a.kald('GET', `/api/v1/notes/${note.id}/tasks`)).data.tasks[0].dodaId;

  attrap.saet('kunlaes');
  const r = await a.kald('POST', `/api/v1/notes/${note.id}/tasks/${dodaId}`, { done: true });
  attrap.saet('ok');
  assert.equal(r.status, 502);
  assert.equal(r.data.error, 'wrong_scope');
  // dodas egen besked SIGER hvilket scope noeglen har; vi siger hvad der skal til.
  assert.match(r.data.message, /cannot write/);
  assert.match(r.data.message, /"full" key/);
});

/* ============ en opgave, doda har linket til en note, dukker op ========= */

/*
 * »Hvis en doda opgave får et link til en sagu note, så skal den dukke op i
 * noten i sagu« (Andreas, 2026-08-24).
 *
 * Broen kendte kun det, den selv havde oprettet. Skrev man linket i doda,
 * stod noten tom ved siden af en opgave, der pegede lige på den.
 *
 * Den vigtigste prøve her er den sidste: et id i en FREMMED opgave må ikke
 * kunne få noget til at stå på en note, man ikke ejer.
 */
test('en opgave med et link til noten hentes ind af sig selv', async () => {
  const note = (await a.kald('POST', '/api/v1/notes', { title: 'Linket', body: '# Linket' })).data.note;
  assert.equal((await a.kald('GET', `/api/v1/notes/${note.id}/tasks`)).data.tasks.length, 0);

  // En opgave, der er lavet i DODA - Sagu har aldrig set den.
  attrap.items.set('udefra', {
    id: 'udefra',
    title: 'Skrevet i doda',
    status: 'next',
    note: `Se noten: http://eksempel.example/#note-${note.id}`,
  });

  const r = await a.kald('GET', `/api/v1/notes/${note.id}/tasks?refresh=1`);
  assert.equal(r.status, 200);
  assert.equal(r.data.tasks.length, 1, 'den staar paa noten nu');
  assert.equal(r.data.tasks[0].title, 'Skrevet i doda');
  assert.equal(r.data.tasks[0].dodaId, 'udefra');
});

test('adressen findes også i link_url — og i titlen', async () => {
  const iFelt = (await a.kald('POST', '/api/v1/notes', { title: 'Felt', body: '# Felt' })).data.note;
  const iTitel = (await a.kald('POST', '/api/v1/notes', { title: 'Titel', body: '# Titel' })).data.note;
  attrap.items.set('felt', { id: 'felt', title: 'Via link_url', status: 'next',
    link_url: `https://sagu.eksempel/#note-${iFelt.id}` });
  attrap.items.set('titel', { id: 'titel', status: 'next',
    title: `Via titlen #note-${iTitel.id}` });

  assert.equal((await a.kald('GET', `/api/v1/notes/${iFelt.id}/tasks?refresh=1`)).data.tasks.length, 1);
  const t = (await a.kald('GET', `/api/v1/notes/${iTitel.id}/tasks?refresh=1`)).data.tasks;
  assert.equal(t.length, 1);
  assert.equal(t[0].title, 'Via titlen', 'adressen staar ikke i titlen paa skaermen');
});

test('flyttes linket til en anden note, følger opgaven med', async () => {
  const fra = (await a.kald('POST', '/api/v1/notes', { title: 'Fra', body: '# Fra' })).data.note;
  const til = (await a.kald('POST', '/api/v1/notes', { title: 'Til', body: '# Til' })).data.note;
  attrap.items.set('flytter', { id: 'flytter', title: 'Flytter sig', status: 'next',
    note: `#note-${fra.id}` });
  assert.equal((await a.kald('GET', `/api/v1/notes/${fra.id}/tasks?refresh=1`)).data.tasks.length, 1);

  attrap.items.get('flytter').note = `#note-${til.id}`;
  assert.equal((await a.kald('GET', `/api/v1/notes/${til.id}/tasks?refresh=1`)).data.tasks.length, 1,
    'den staar paa den nye note');
  assert.equal((await a.kald('GET', `/api/v1/notes/${fra.id}/tasks?refresh=1`)).data.tasks.length, 0,
    'og ikke laengere paa den gamle');
});

test('et #note-id, der ikke findes, vælter ikke opfriskningen', async () => {
  /*
   * Den prøve, en sabotage afslørede manglede.
   *
   * Jeg fjernede ejerskabstjekket og fik NUL røde: min første prøve kiggede
   * på, om noget dukkede op hos den anden bruger — og dét er en helt anden
   * vagt, der stopper det.
   *
   * Skaden er en anden og værre: uden tjekket forsøger vi at indsætte en
   * række, hvis `note_id` ikke findes, fremmednøglen siger fra, og **hele**
   * opfriskningen kaster. Én tilfældig hex-streng i én doda-opgave ville
   * dermed slå opgavelisten ud for alt andet.
   */
  const note = (await a.kald('POST', '/api/v1/notes', { title: 'Overlever', body: '# O' })).data.note;
  attrap.items.set('spoegelse', { id: 'spoegelse', title: 'Peger paa ingenting', status: 'next',
    note: `#note-${'f'.repeat(32)}` });
  attrap.items.set('rigtig', { id: 'rigtig', title: 'Peger paa noten', status: 'next',
    note: `#note-${note.id}` });

  const r = await a.kald('GET', `/api/v1/notes/${note.id}/tasks?refresh=1`);
  assert.equal(r.status, 200, 'opfriskningen overlevede spoegelset');
  assert.equal(r.data.tasks.length, 1);
  assert.equal(r.data.tasks[0].dodaId, 'rigtig');
});

test('et link til en note, man ikke ejer, gør ingenting', async () => {
  const b = klient(srv.base);
  await a.kald('POST', '/api/v1/admin', { allowRegistration: true });
  await b.opret('fremmed', 'kodeord-1234');
  const bNote = (await b.kald('POST', '/api/v1/notes', { title: 'Bobs', body: '# Bobs' })).data.note;

  attrap.items.set('tyveri', { id: 'tyveri', title: 'Peger paa en fremmed note', status: 'next',
    note: `#note-${bNote.id}` });
  // Ejeren opfrisker - hans doda naevner en note, der er bobs.
  const egen = (await a.kald('POST', '/api/v1/notes', { title: 'Egen', body: '# Egen' })).data.note;
  await a.kald('GET', `/api/v1/notes/${egen.id}/tasks?refresh=1`);

  const hosBob = await b.kald('GET', `/api/v1/notes/${bNote.id}/tasks`);
  assert.equal(hosBob.data.tasks.length, 0, 'intet er dukket op paa bobs note');
});

/* ==================== adressen til opgaven i doda ====================== */

/*
 * »Kan du lave så man kan klikke på en doda opgave og så åbner den opgaven i
 * doda?« (Andreas, 2026-08-24).
 *
 * `?item=<id>` er dodas EGEN indgang — den, kalenderfeedet allerede peger med.
 * Der skulle altså ingenting ændres i doda; formen fandtes.
 *
 * Adressen bygges på serveren, fordi det er dér, resten af det Sagu ved om
 * doda ligger. Den vigtige prøve er den sidste: uden en forbindelse er der
 * ingen adresse, og så må der heller ikke stå et link — et link, der peger på
 * ingenting, er værre end intet link.
 */
test('hver opgave bærer adressen til sig selv i doda', async () => {
  const note = (await a.kald('POST', '/api/v1/notes', { title: 'Med link', body: '# M' })).data.note;
  await a.kald('POST', `/api/v1/notes/${note.id}/tasks`, { text: 'Aabn mig' });
  const t = (await a.kald('GET', `/api/v1/notes/${note.id}/tasks`)).data.tasks[0];

  assert.equal(t.url, `${attrap.url}/?item=${t.dodaId}`);
  // Adressen skal kunne baere et id med tegn, der skal kodes.
  assert.ok(!t.url.includes(' '));
  assert.match(t.url, /^http:\/\//, 'kun http(s) - `rensOffentligUrl` tillader intet andet');
});

test('uden en forbindelse er der ingen adresse — men opgaverne bliver stående', async () => {
  /*
   * Første udgave af denne prøve lavede en bruger UDEN opgaver og fastslog,
   * at han ingen havde. Den kunne ikke fejle på det, den handlede om.
   *
   * Her fjernes forbindelsen fra en, der HAR opgaver. Rækkerne bliver stående
   * med vilje — en liste, der bliver tom, ligner en liste, der har mistet
   * noget — men adressen kan ikke bygges uden en vært, og så skal feltet være
   * tomt i stedet for at pege ingen steder hen.
   */
  const note = (await a.kald('POST', '/api/v1/notes', { title: 'Frakobles', body: '# F' })).data.note;
  await a.kald('POST', `/api/v1/notes/${note.id}/tasks`, { text: 'Staar tilbage' });
  assert.ok((await a.kald('GET', `/api/v1/notes/${note.id}/tasks`)).data.tasks[0].url,
    'med forbindelse ER der en adresse');

  await a.kald('DELETE', '/api/v1/doda');
  const efter = (await a.kald('GET', `/api/v1/notes/${note.id}/tasks`)).data;
  assert.equal(efter.connected, false);
  assert.equal(efter.tasks.length, 1, 'opgaven staar der stadig');
  assert.equal(efter.tasks[0].url, null, 'men uden en adresse');

  // Kobl til igen, saa resten af filen ikke arver en frakoblet doda.
  await a.kald('POST', '/api/v1/doda', { url: attrap.url, key: 'doda_rigtig' });
});
