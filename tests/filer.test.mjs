/*
 * Vedhaeftninger. F3 kraever billeder i noter, og et billede uden lagring er
 * ikke en funktion - derfor er F4's kerne trukket frem hertil.
 *
 * Reglerne er dodas F7 ordret, og de er sikkerhedsreglerne: en fil, brugeren
 * selv har uploadet, maa aldrig kunne koere som en side paa Sagus domaene.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { startServer, startServerPaa, klient } from './hjaelp.mjs';

let srv;
let a;
let note;

async function upload(kl, indhold, navn, mime, noteId) {
  const q = new URLSearchParams({ name: navn });
  if (noteId) q.set('note', noteId);
  const r = await fetch(`${srv.base}/api/v1/files?${q}`, {
    method: 'POST',
    headers: { Cookie: kl.cookie, 'X-Sagu-Upload': '1', 'Content-Type': mime },
    body: indhold,
  });
  return { status: r.status, data: await r.json().catch(() => null) };
}

before(async () => {
  srv = await startServer();
  a = klient(srv.base);
  await a.opret('alice', 'kodeord-1234');
  note = (await a.kald('POST', '/api/v1/notes', { title: 'Med billeder' })).data.note;
});

after(() => { try { srv.stop(); } catch { /* allerede stoppet */ } });

test('et PNG vises INLINE med sin egen type', async () => {
  const r = await upload(a, Buffer.from('\x89PNG\r\n\x1a\nfake'), 'skaerm.png', 'image/png', note.id);
  assert.equal(r.status, 200);
  assert.equal(r.data.file.inline, true);

  const hent = await fetch(`${srv.base}${r.data.file.url}`, { headers: { Cookie: a.cookie } });
  assert.equal(hent.status, 200);
  assert.equal(hent.headers.get('content-type'), 'image/png');
  assert.match(hent.headers.get('content-disposition'), /^inline/);
  assert.equal(hent.headers.get('x-content-type-options'), 'nosniff');
});

test('en SVG maa ALDRIG serveres inline - den kan baere script', async () => {
  // Den vigtigste spaerring i hele funktionen. Hvidlisten naevner én type ad
  // gangen og matcher aldrig paa et `image/`-praefiks - praefikset lader
  // netop image/svg+xml igennem (RUNE-ERFARINGER, doda F7).
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
  const r = await upload(a, Buffer.from(svg), 'ondt.svg', 'image/svg+xml', note.id);
  assert.equal(r.status, 200);
  assert.equal(r.data.file.inline, false, 'en SVG maa ikke markeres inline');

  const hent = await fetch(`${srv.base}${r.data.file.url}`, { headers: { Cookie: a.cookie } });
  assert.equal(hent.headers.get('content-type'), 'application/octet-stream');
  assert.match(hent.headers.get('content-disposition'), /^attachment/);
  assert.equal(hent.headers.get('x-content-type-options'), 'nosniff');
});

test('HTML og andre farlige typer tvinges ogsaa til download', async () => {
  for (const [navn, mime] of [['x.html', 'text/html'], ['x.xml', 'application/xml'],
    ['x.js', 'application/javascript'], ['x.pdf', 'application/pdf']]) {
    const r = await upload(a, Buffer.from('<script>alert(1)</script>'), navn, mime, note.id);
    assert.equal(r.data.file.inline, false, `${mime} blev markeret inline`);
    const hent = await fetch(`${srv.base}${r.data.file.url}`, { headers: { Cookie: a.cookie } });
    assert.equal(hent.headers.get('content-type'), 'application/octet-stream', `${mime} blev serveret som sig selv`);
  }
});

test('filnavnet saniteres - stien paa disken er ALTID id\'et', async () => {
  const r = await upload(a, Buffer.from('x'), '../../../etc/passwd', 'image/png', note.id);
  assert.equal(r.status, 200);
  assert.ok(!r.data.file.name.includes('/'), `navnet indeholder en sti: ${r.data.file.name}`);
  assert.ok(!r.data.file.name.startsWith('.'), `navnet er en skjult fil: ${r.data.file.name}`);
  // Filen ligger paa sit hex-id, ikke paa brugerens navn.
  assert.ok(existsSync(path.join(srv.dataDir, 'files', r.data.file.id)));
  assert.ok(!existsSync(path.join(srv.dataDir, 'files', 'passwd')));
});

test('kontroltegn i filnavnet fjernes', async () => {
  const r = await upload(a, Buffer.from('x'), 'ondt\x00\x1f\nnavn.png', 'image/png', note.id);
  assert.ok(!/[\x00-\x1f]/.test(r.data.file.name), `navnet har kontroltegn: ${JSON.stringify(r.data.file.name)}`);
});

test('indholdet er byte-identisk, og ETag giver 304', async () => {
  const data = Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 251));
  const r = await upload(a, data, 'binaer.png', 'image/png', note.id);
  const hent = await fetch(`${srv.base}${r.data.file.url}`, { headers: { Cookie: a.cookie } });
  const ud = Buffer.from(await hent.arrayBuffer());
  assert.ok(ud.equals(data), 'filen kom ikke uaendret tilbage');

  const etag = hent.headers.get('etag');
  assert.ok(etag, 'der skal vaere en ETag');
  const igen = await fetch(`${srv.base}${r.data.file.url}`,
    { headers: { Cookie: a.cookie, 'If-None-Match': etag } });
  assert.equal(igen.status, 304, 'indholdet kan aldrig aendre sig for et id - 304 er gratis');
});

test('listerne faar kun et ANTAL, aldrig filernes metadata', async () => {
  // Kokkeris 247 MB-login kom af det modsatte.
  const liste = (await a.kald('GET', '/api/v1/notes')).data.notes;
  const n = liste.find((x) => x.id === note.id);
  assert.ok(typeof n.attachmentCount === 'number' && n.attachmentCount > 0);
  assert.equal(n.files, undefined, 'listen maa ikke baere filernes metadata');

  // ... men den ENKELTE note har dem.
  const en = (await a.kald('GET', `/api/v1/notes/${note.id}`)).data.note;
  assert.ok(Array.isArray(en.files) && en.files.length > 0);
  assert.ok(en.files[0].url.startsWith('/api/v1/files/'));
});

test('en upload uden X-Sagu-Upload afvises - CSRF for en rute uden JSON-krop', async () => {
  // Ruten streamer kroppen og kalder derfor aldrig body-laeseren, saa den
  // staar uden for den faelles barriere (RUNE-ERFARINGER, doda F11).
  const r = await fetch(`${srv.base}/api/v1/files?name=x.png`, {
    method: 'POST', headers: { Cookie: a.cookie, 'Content-Type': 'image/png' }, body: 'x',
  });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, 'missing_header');
});

test('en tom fil afvises', async () => {
  const r = await upload(a, Buffer.alloc(0), 'tom.png', 'image/png', note.id);
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'empty_file');
});

test('ISOLATION: en fil kan kun naas af sin ejer', async () => {
  const b = klient(srv.base);
  await a.kald('POST', '/api/v1/admin', { allowRegistration: true });
  await b.opret('bob', 'kodeord-1234');

  const r = await upload(a, Buffer.from('hemmeligt'), 'privat.png', 'image/png', note.id);
  const somBob = await fetch(`${srv.base}${r.data.file.url}`, { headers: { Cookie: b.cookie } });
  assert.equal(somBob.status, 404, 'bob maa ikke kunne hente alices fil');
  const slet = await fetch(`${srv.base}${r.data.file.url}`,
    { method: 'DELETE', headers: { Cookie: b.cookie, 'Content-Type': 'application/json' } });
  assert.equal(slet.status, 404, 'bob maa ikke kunne slette alices fil');
  // ... og bobs liste er tom.
  assert.equal((await b.kald('GET', '/api/v1/files')).data.files.length, 0);
});

test('en fil kan ikke haenges paa en ANDEN brugers note', async () => {
  const b = klient(srv.base);
  await b.kald('POST', '/api/login', { username: 'bob', password: 'kodeord-1234' });
  const r = await upload(b, Buffer.from('x'), 'x.png', 'image/png', note.id);
  assert.equal(r.status, 404);
});

test('sletning af en note fjerner ogsaa dens filer fra disken', async () => {
  // F4's acceptkriterium. Filen ryddes af sweep() efter 30 dages frist - saa
  // en fortrudt sletning kan naa at blive fortrudt - men den SKAL forsvinde
  // til sidst.
  //
  // Testen har sin EGEN server: den skal genstartes for at faa sweep() til at
  // koere, og en genstart af den delte server ville efterlade resten af filen
  // uden en at snakke med.
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(path.join(tmpdir(), 'sagu-slet-'));
  let s1 = await startServerPaa(dir);
  const x = klient(s1.base);
  await x.opret('sletter', 'kodeord-1234');
  const n2 = (await x.kald('POST', '/api/v1/notes', { title: 'Skal slettes' })).data.note;

  const r = await fetch(`${s1.base}/api/v1/files?name=doed.png&note=${n2.id}`, {
    method: 'POST',
    headers: { Cookie: x.cookie, 'X-Sagu-Upload': '1', 'Content-Type': 'image/png' },
    body: Buffer.from('vaek med mig'),
  });
  const fil = (await r.json()).file;
  const sti = path.join(dir, 'files', fil.id);
  assert.ok(existsSync(sti), 'filen skal ligge der til at begynde med');

  await x.kald('DELETE', `/api/v1/notes/${n2.id}`);
  assert.ok(existsSync(sti), 'en bloed sletning maa ikke fjerne filen med det samme');

  // Flyt uret 31 dage tilbage paa SLETNINGEN og lad sweep() koere sin rigtige
  // vej ved opstart. At hardslette noten i haanden ville springe netop den
  // kode over, testen findes for.
  await s1.stopOgVent();
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(dir, 'sagu.db'));
  db.prepare('UPDATE notes SET deleted_at = ? WHERE id = ?')
    .run(Math.floor(Date.now() / 1000) - 31 * 86400, n2.id);
  db.close();

  s1 = await startServerPaa(dir);
  try {
    assert.ok(!existsSync(sti), 'filen skal vaere vaek fra disken, naar noten er ryddet ud');
    const db2 = new DatabaseSync(path.join(dir, 'sagu.db'));
    const antal = db2.prepare('SELECT COUNT(*) AS n FROM attachments WHERE id = ?').get(fil.id).n;
    db2.close();
    assert.equal(antal, 0, 'og raekken skal vaere vaek med den');
  } finally {
    s1.stop();
  }
});

/* ==================================================== F4: resten ======== */

test('en for stor upload faar et RIGTIGT 413 med en laesbar besked', async () => {
  /*
   * Hvad den her beviser - og hvad den IKKE beviser.
   *
   * Den beviser, at en upload over loftet svarer 413 med en maskinkode og en
   * saetning, der siger hvad graensen ER - i stedet for et tomt eller
   * afbrudt kald.
   *
   * Den beviser IKKE serverens RAEKKEFOELGE (svar foerst, luk bagefter, doda
   * F7). Det stod i testens navn i to faser, og det var forkert: jeg
   * saboterede serveren til at kalde `req.destroy()` med det samme og koerte
   * baade en `fetch`- og en `node:http`-klient imod den. **Begge blev
   * groenne.** Over loopback ligger svaret allerede i socket-bufferen, naar
   * forbindelsen lukkes, saa klienten faar det uanset raekkefoelgen.
   *
   * Raekkefoelgen er stadig rigtig, og begrundelsen staar ved koden - men en
   * test, hvis NAVN lover mere, end den maaler, er den samme fejl som en
   * taeller, der beviser, at noget blev talt og ikke at det virker
   * (RUNE-ERFARINGER, Sagu F6).
   *
   * Fil-loftet er 25 MB; her sendes 30 MB som en stroem, saa serveren
   * opdager det undervejs.
   */
  /*
   * Med `fetch` var den her FLAKKENDE, og fejlen pegede paa serveren.
   *
   * `fetch` afviser hele kaldet, hvis skrivningen bliver afbrudt, mens den
   * stadig sender - og under en fuld, parallel testkoersel naaede klienten
   * ikke altid at se svaret foerst. Det er klientens kapløb, ikke serverens
   * opfoersel, og en test, der maaler det, peger det forkerte sted hen
   * (RUNE-ERFARINGER, Sagu F3: den vaerste slags flakkende test).
   *
   * `node:http` giver kontrollen tilbage: der skrives, indtil svaret kommer,
   * og saa stopper vi - praecis som en klient, der opdager et 413 undervejs.
   */
  const http = await import('node:http');
  const blok = Buffer.alloc(1024 * 1024, 0x62);
  const svar = await new Promise((ok, nej) => {
    const u = new URL(`${srv.base}/api/v1/files?name=kaempe.bin`);
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        Cookie: a.cookie,
        'X-Sagu-Upload': '1',
        'Content-Type': 'application/octet-stream',
        'Transfer-Encoding': 'chunked',
      },
    });
    let faerdig = false;
    req.on('response', (res) => {
      faerdig = true;
      let krop = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { krop += d; });
      // Stop med at SKRIVE (`faerdig`), men lad svaret loebe faerdigt.
      // `req.destroy()` her ville dræbe socket'en, foer kroppen var laest -
      // og saa maalte testen sin egen afbrydelse i stedet for serverens svar.
      res.on('end', () => { req.destroy(); ok({ status: res.statusCode, krop }); });
    });
    /*
     * En afbrudt skrivning er FORVENTET her - serveren svarer og lukker.
     *
     * Men socket-fejlen kan naa frem FOER `response`-haendelsen, naar
     * maskinen er belastet (en fuld, parallel testkoersel). Foer afviste
     * testen med det samme og maalte dermed sit eget kaploeb: den var groen
     * alene og roed cirka hver fjerde gang i den samlede koersel - den
     * vaerste slags flakkende test, fordi fejlen peger paa serveren.
     *
     * Testens paastand er, at der KOMMER et rigtigt 413 med en laesbar krop -
     * ikke at der aldrig sker en socket-fejl. Derfor faar svaret et oejeblik
     * til at naa frem, foer der doemmes.
     */
    req.on('error', () => {
      if (faerdig) return;
      setTimeout(() => {
        if (!faerdig) nej(new Error('forbindelsen doede FOER et svar'));
      }, 500);
    });
    let n = 0;
    const skriv = () => {
      while (!faerdig && n < 30) {
        n += 1;
        if (!req.write(blok)) { req.once('drain', skriv); return; }
      }
      if (!faerdig) req.end();
    };
    skriv();
  });
  assert.equal(svar.status, 413, 'der skal komme et RIGTIGT svar, ikke et afbrudt kald');
  assert.ok(svar.krop.length, 'og en krop, der kan laeses - ikke et tomt svar');
  const d = JSON.parse(svar.krop);
  assert.equal(d.error, 'too_large');
  assert.match(d.message, /\d+ MB/, 'beskeden skal sige hvad graensen ER');
});

test('en afvist upload efterlader ingen fil paa disken', async () => {
  const { readdirSync } = await import('node:fs');
  const foer = readdirSync(path.join(srv.dataDir, 'files')).length;
  const blok = Buffer.alloc(1024 * 1024, 0x63);
  const stroem = new ReadableStream({
    start(c) { for (let i = 0; i < 28; i++) c.enqueue(blok); c.close(); },
  });
  await fetch(`${srv.base}/api/v1/files?name=ogsaa-stor.bin`, {
    method: 'POST',
    headers: { Cookie: a.cookie, 'X-Sagu-Upload': '1', 'Content-Type': 'application/octet-stream' },
    body: stroem,
    duplex: 'half',
  }).catch(() => {});
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(readdirSync(path.join(srv.dataDir, 'files')).length, foer,
    'den halve fil skal vaere ryddet op');
});

test('KVOTEN haandhaeves UNDER uploaden, ikke kun foer den', async () => {
  // Et tjek foer modtagelsen kan kun se, hvad der allerede ligger - saa en
  // enkelt fil, der er stoerre end hele kvoten, ville slippe forbi, fordi
  // der var plads, da den begyndte.
  const s2 = await startServerPaa(
    (await import('node:fs')).mkdtempSync(path.join((await import('node:os')).tmpdir(), 'sagu-kvote-')),
    { SAGU_MAX_SAMLET: String(3 * 1024 * 1024) },      // 3 MB kvote
  );
  try {
    const x = klient(s2.base);
    await x.opret('kvote', 'kodeord-1234');
    const send = async (mb, navn) => {
      const blok = Buffer.alloc(1024 * 1024, 0x64);
      const stroem = new ReadableStream({
        start(c) { for (let i = 0; i < mb; i++) c.enqueue(blok); c.close(); },
      });
      const r = await fetch(`${s2.base}/api/v1/files?name=${navn}`, {
        method: 'POST',
        headers: { Cookie: x.cookie, 'X-Sagu-Upload': '1', 'Content-Type': 'application/octet-stream' },
        body: stroem,
        duplex: 'half',
      });
      return { status: r.status, data: await r.json().catch(() => null) };
    };

    assert.equal((await send(2, 'to.bin')).status, 200, '2 MB skal passe i 3 MB');
    const over = await send(2, 'endnu-to.bin');
    assert.equal(over.status, 413, 'de naeste 2 MB passer ikke i den sidste 1 MB');
    assert.equal(over.data.error, 'quota_full',
      'fejlen skal sige KVOTE, ikke "filen er for stor" - ellers leder man efter et mindre billede');
    assert.match(over.data.message, /remaining/i);

    // Og pladsen staar i state, saa UI'et kan vise den.
    const st = (await x.kald('GET', '/api/v1/state')).data.storage;
    assert.equal(st.quota, 3 * 1024 * 1024);
    assert.ok(st.used >= 2 * 1024 * 1024);
  } finally {
    s2.stop();
  }
});

test('en vedhaeftning, der IKKE er et billede, kan hentes fra noten', async () => {
  // Fejlen, F3 indfoerte: `sagu:<id>` er ikke http(s), saa rendereren afviste
  // den med rette - og et PDF-link blev til doed TEKST. Kuren er en KROG til
  // vaerten, ikke en undtagelse i sikkerUrl.
  // Selve rendererens side af det testes i markdown.test.mjs; her testes, at
  // filen faktisk kan HENTES paa den adresse, linket peger paa.
  const r = await upload(a, Buffer.from('%PDF-1.4 fake'), 'rapport.pdf', 'application/pdf', note.id);
  assert.equal(r.status, 200);
  assert.equal(r.data.file.inline, false);
  // Linket i noten peger paa den interne adresse ...
  await a.kald('PATCH', `/api/v1/notes/${note.id}`,
    { body: `Se [rapport.pdf](sagu:${r.data.file.id}).` });
  // ... og adressen kan faktisk hentes.
  const hent = await fetch(`${srv.base}/api/v1/files/${r.data.file.id}`, { headers: { Cookie: a.cookie } });
  assert.equal(hent.status, 200);
  assert.match(hent.headers.get('content-disposition'), /^attachment/);
  assert.equal(await hent.text(), '%PDF-1.4 fake');
});

test('filerne ligger i runens wipe - ellers overlever de en nulstilling', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const rod = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const yaml = readFileSync(path.join(rod, 'runes', 'sagu.yaml'), 'utf8');
  const wipe = yaml.slice(yaml.indexOf('wipe:'));
  for (const sti of ['sagu.db', 'files', 'uploads']) {
    assert.ok(wipe.includes(`- ${sti}`), `${sti} mangler i wipe.paths`);
  }
  assert.match(wipe, /backup_first: true/);
});
