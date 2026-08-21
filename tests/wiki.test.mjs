/*
 * F6 - den offentlige wiki.
 *
 * DELINGSTESTEN er fasens vigtigste (CLAUDE.md): en besoegende uden kodeord
 * skal ikke kunne naa NOGET - heller ikke en titel i navigationen, et uddrag i
 * en soegning eller et billede, der ligger dybt i et delt trae. Og en note,
 * der ikke er udgivet, maa ikke kunne naas gennem en udgivelse af nabotraeet.
 *
 * Testen henter siderne som en RIGTIG besoegende: `fetch` uden cookie, uden
 * session, uden noget. Det er den eneste maade at bevise, at der ikke er en
 * intern bagvej, appen tilfaeldigvis bruger.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, klient, tags, gaest } from './hjaelp.mjs';

let srv;
let a;      // ejeren
let b;      // en anden bruger - isolationen gaelder ogsaa udgivelser

before(async () => {
  srv = await startServer();
  a = klient(srv.base);
  b = klient(srv.base);
  await a.opret('alice', 'kodeord-1234');
  // Registrering lukker efter den foerste bruger (F0). Bruger nummer to
  // findes her, fordi isolationen ogsaa gaelder udgivelser.
  await a.kald('POST', '/api/v1/admin', { allowRegistration: true });
  await b.opret('bob', 'kodeord-1234');
});

after(() => srv.stop());

/** Et lille trae: rod -> barn -> barnebarn, plus en note UDEN FOR udgivelsen. */
async function byggTrae(kl, praefiks) {
  const rod = (await kl.kald('POST', '/api/v1/notes', {
    title: `${praefiks} handbook`,
    body: `# ${praefiks} handbook\n\nWelcome to the handbook.\n\n## VPN access\n\nUse the client.`,
  })).data.note;
  const barn = (await kl.kald('POST', '/api/v1/notes', {
    title: `${praefiks} VPN`,
    parentId: rod.id,
    body: '# VPN\n\nThe secret is hunter2 and the tunnel is up.\n\n```sh\nvpn --up\n```',
  })).data.note;
  const barnebarn = (await kl.kald('POST', '/api/v1/notes', {
    title: `${praefiks} Deep page`,
    parentId: barn.id,
    body: '# Deep page\n\nBuried treasure lives here.',
  })).data.note;
  const udenfor = (await kl.kald('POST', '/api/v1/notes', {
    title: `${praefiks} Private`,
    body: '# Private\n\nNobody outside may read this classified line.',
  })).data.note;
  return { rod, barn, barnebarn, udenfor };
}

test('en udgivelse er OFFENTLIG som udgangspunkt - kollegaerne har ingen konti', async () => {
  const t = await byggTrae(a, 'A1');
  const share = (await a.kald('POST', '/api/v1/shares',
    { noteId: t.rod.id, slug: 'a1-handbook' })).data.share;
  assert.equal(share.path, '/w/a1-handbook');
  assert.equal(share.hasPassword, false);

  const g = gaest(srv.base);
  const forside = await g.hent('/w/a1-handbook/');
  assert.equal(forside.status, 200);
  assert.match(forside.tekst, /Welcome to the handbook/, 'indholdet skal vaere der');

  // Undersiderne staar i navigationen og kan aabnes paa deres eget navn.
  assert.match(forside.tekst, /a1-handbook\/a1-vpn/, 'undersiden skal staa i navigationen');
  const under = await g.hent('/w/a1-handbook/a1-vpn');
  assert.equal(under.status, 200);
  assert.match(under.tekst, /the tunnel is up/);

  // ... men noten UDEN FOR traeet findes ikke, uanset hvad man taster.
  assert.doesNotMatch(forside.tekst, /classified line/);
  assert.equal((await g.hent('/w/a1-handbook/a1-private')).status, 404);
});

test('den offentlige side henter INGEN app-JS og kan ikke kalde app-API et', async () => {
  const t = await byggTrae(a, 'A2');
  await a.kald('POST', '/api/v1/shares', { noteId: t.rod.id, slug: 'a2-book' });
  const g = gaest(srv.base);
  const side = await g.hent('/w/a2-book/');

  assert.doesNotMatch(side.tekst, /app\.js/, 'app-koden maa ALDRIG staa paa en offentlig side');
  assert.doesNotMatch(side.tekst, /\/api\/v1\//, 'ingen app-API-adresse maa staa i HTML en');
  // Kun wikiens egen lille fil - og den kalder intet.
  const scripts = [...side.tekst.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(scripts.map((x) => x.split('?')[0]), ['/wiki.js']);

  // Tema-scriptet er inline og skal daekkes af CSP-hashen - ellers blokerer
  // vores egen CSP det, og siden blinker hvid ved hvert klik.
  const csp = side.headers.get('content-security-policy') || '';
  assert.match(csp, /script-src 'self' 'sha256-/, `CSP: ${csp}`);
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /img-src 'self' data: blob:/);
});

test('DELINGSTESTEN: uden kodeord naas intet - heller ikke dybt i traeet', async () => {
  const t = await byggTrae(a, 'A3');
  // Et billede paa den dybe side, saa "billeder og vedhaeftninger" ogsaa er daekket.
  const up = await fetch(`${srv.base}/api/v1/files?note=${t.barnebarn.id}&name=kort.png`, {
    method: 'POST',
    headers: { Cookie: a.cookie, 'X-Sagu-Upload': '1', 'Content-Type': 'image/png' },
    body: Buffer.from('\x89PNG\r\n\x1a\nhemmeligt billede'),
  });
  const fil = (await up.json()).file;
  assert.ok(fil && fil.id, `upload fejlede: ${JSON.stringify(fil)}`);

  const share = (await a.kald('POST', '/api/v1/shares',
    { noteId: t.rod.id, slug: 'a3-locked', password: 'aabnesesam' })).data.share;
  assert.equal(share.hasPassword, true);

  const g = gaest(srv.base);

  // Forsiden svarer - men KUN med formularen. Ikke en titel, ikke en linje tekst.
  const laast = await g.hent('/w/a3-locked/');
  assert.equal(laast.status, 200);
  assert.match(laast.tekst, /password/i);
  assert.doesNotMatch(laast.tekst, /Welcome to the handbook/);
  assert.doesNotMatch(laast.tekst, /A3 handbook/, 'ikke engang titlen maa slippe ud');
  assert.doesNotMatch(laast.tekst, /A3 VPN/);

  // Soegning, feed og aendringsliste: 404. Ikke 401 eller 403 - de ville
  // bekraefte, hvad der findes derinde.
  for (const sti of ['/w/a3-locked/search?q=tunnel', '/w/a3-locked/changes', '/w/a3-locked/feed']) {
    const svar = await g.hent(sti);
    assert.equal(svar.status, 404, `${sti} skal vaere 404 uden kodeord`);
    assert.doesNotMatch(svar.tekst, /tunnel is up/);
  }

  // Filen, der ligger DYBT i traeet.
  assert.equal((await g.hent(`/w/a3-locked/f/${fil.id}`)).status, 404);
  // ... og app-ruten til den samme fil kraever stadig login.
  assert.equal((await g.hent(`/api/v1/files/${fil.id}`)).status, 401);

  // En dyb side sender til formularen og laekker ikke sit indhold.
  const dyb = await g.hent('/w/a3-locked/a3-deep-page');
  assert.equal(dyb.status, 302);
  assert.doesNotMatch(dyb.tekst, /Buried treasure/);

  /* --- og med kodeordet virker alting ------------------------------------ */
  const forkert = await g.post('/w/a3-locked/password', { password: 'forkert' });
  assert.equal(forkert.status, 401);
  assert.doesNotMatch(forkert.tekst, /Welcome to the handbook/);

  const rigtig = await g.post('/w/a3-locked/password', { password: 'aabnesesam' });
  assert.equal(rigtig.status, 302);
  const cookie = (rigtig.headers.get('set-cookie') || '').split(';')[0];
  assert.match(cookie, new RegExp(`^sagu_w_${share.id}=`));

  const aabnet = await g.hent('/w/a3-locked/', { headers: { Cookie: cookie } });
  assert.equal(aabnet.status, 200);
  assert.match(aabnet.tekst, /Welcome to the handbook/);
  assert.equal((await g.hent(`/w/a3-locked/f/${fil.id}`, { headers: { Cookie: cookie } })).status, 200);
});

test('at slaa kodeord TIL aendrer hverken slug eller token', async () => {
  // Kravet bag hele modellen: linket i kollegaernes bogmaerker skal overleve,
  // at siden bliver beskyttet (CLAUDE.md).
  const t = await byggTrae(a, 'A4');
  const share = (await a.kald('POST', '/api/v1/shares',
    { noteId: t.rod.id, slug: 'a4-open' })).data.share;
  const g = gaest(srv.base);
  assert.equal((await g.hent('/w/a4-open/')).status, 200);

  const efter = (await a.kald('PATCH', `/api/v1/shares/${share.id}`,
    { password: 'nyt-kodeord' })).data.share;
  assert.equal(efter.slug, share.slug, 'slug skal staa uroert');
  assert.equal(efter.token, share.token, 'tokenet skal staa uroert');
  assert.equal(efter.path, share.path);
  assert.equal(efter.hasPassword, true);

  // Samme adresse virker stadig - den moeder bare en kodeordsside nu.
  const nu = await g.hent('/w/a4-open/');
  assert.equal(nu.status, 200);
  assert.doesNotMatch(nu.tekst, /Welcome to the handbook/);

  // ... og at fjerne kodeordet igen aabner den, uden at adressen skifter.
  const aaben = (await a.kald('PATCH', `/api/v1/shares/${share.id}`, { password: null })).data.share;
  assert.equal(aaben.hasPassword, false);
  assert.equal(aaben.slug, share.slug);
  assert.match((await g.hent('/w/a4-open/')).tekst, /Welcome to the handbook/);
});

test('et kodeordsSKIFT lukker de gamle browsere ude', async () => {
  const t = await byggTrae(a, 'A5');
  const share = (await a.kald('POST', '/api/v1/shares',
    { noteId: t.rod.id, slug: 'a5-x', password: 'foerste-kode' })).data.share;
  const g = gaest(srv.base);
  const cookie = ((await g.post('/w/a5-x/password', { password: 'foerste-kode' }))
    .headers.get('set-cookie') || '').split(';')[0];
  assert.equal((await g.hent('/w/a5-x/', { headers: { Cookie: cookie } })).status, 200);

  await a.kald('PATCH', `/api/v1/shares/${share.id}`, { password: 'anden-kode' });
  const efter = await g.hent('/w/a5-x/', { headers: { Cookie: cookie } });
  assert.doesNotMatch(efter.tekst, /Welcome to the handbook/,
    'den gamle cookie maa ikke laase op efter et kodeordsskift');
});

test('et TILBAGEKALDT link doer paa naeste kald', async () => {
  const t = await byggTrae(a, 'A6');
  const share = (await a.kald('POST', '/api/v1/shares',
    { noteId: t.rod.id, slug: 'a6-gone' })).data.share;
  const g = gaest(srv.base);
  assert.equal((await g.hent('/w/a6-gone/')).status, 200);

  await a.kald('DELETE', `/api/v1/shares/${share.id}`);
  assert.equal((await g.hent('/w/a6-gone/')).status, 404, 'tilbagekaldt = 404, ikke 403');
  assert.equal((await g.hent(`/s/${share.token}`)).status, 404, 'ogsaa den anden adresse');
});

test('en UDLOEBET udgivelse er 404, og en ukendt adresse ser ens ud', async () => {
  const t = await byggTrae(a, 'A7');
  const share = (await a.kald('POST', '/api/v1/shares',
    { noteId: t.rod.id, slug: 'a7-old' })).data.share;
  const g = gaest(srv.base);
  assert.equal((await g.hent('/w/a7-old/')).status, 200);

  await a.kald('PATCH', `/api/v1/shares/${share.id}`,
    { expiresAt: Math.floor(Date.now() / 1000) - 60 });
  const udloebet = await g.hent('/w/a7-old/');
  const ukendt = await g.hent('/w/findes-slet-ikke/');
  assert.equal(udloebet.status, 404);
  assert.equal(ukendt.status, 404);
  assert.equal(udloebet.tekst, ukendt.tekst,
    'udloebet og ukendt skal se PRAECIS ens ud - ellers kan man aflaese, hvad der har vaeret');
});

test('en ENKELT note kan deles alene - undersiderne foelger ikke med', async () => {
  const t = await byggTrae(a, 'A8');
  await a.kald('POST', '/api/v1/shares', { noteId: t.rod.id, slug: 'a8-one', mode: 'single' });
  const g = gaest(srv.base);
  const side = await g.hent('/w/a8-one/');
  assert.equal(side.status, 200);
  assert.match(side.tekst, /Welcome to the handbook/);
  assert.doesNotMatch(side.tekst, /A8 VPN/, 'undersiden er ikke delt');
  assert.equal((await g.hent('/w/a8-one/a8-vpn')).status, 404);
});

test('en hel NOTESBOG kan udgives - forsiden er bogens indhold', async () => {
  /*
   * Andreas, 2026-08-21: »jeg kan ikke markere en notebook og dele den, jeg
   * kan kun markere en note«. Et importeret Notion-arkiv ER en bog med sider
   * i - ikke en forside med undersider - og at kraeve en kunstig forside for
   * at kunne dele den ville vaere at bede brugeren lave om paa sit indhold
   * for appens skyld.
   */
  const bog = (await a.kald('POST', '/api/v1/notebooks', { name: 'Drift' })).data.notebook;
  const en = (await a.kald('POST', '/api/v1/notes', {
    title: 'Netvaerk', notebookId: bog.id, body: '# Netvaerk\n\nSwitchen staar i kaelderen.',
  })).data.note;
  const under = (await a.kald('POST', '/api/v1/notes', {
    title: 'Kabler', parentId: en.id, body: '# Kabler\n\nBlaa er data.',
  })).data.note;
  await a.kald('POST', '/api/v1/notes', {
    title: 'Telefoni', notebookId: bog.id, body: '# Telefoni\n\nOmstillingen ringer.',
  });
  // ... og en note UDEN FOR bogen, som ikke maa kunne naas.
  await a.kald('POST', '/api/v1/notes', { title: 'Loenninger', body: '# Loen\n\nfortroligt tal' });

  const share = (await a.kald('POST', '/api/v1/shares',
    { notebookId: bog.id, slug: 'drift-bog' })).data.share;
  assert.equal(share.kind, 'notebook');
  assert.equal(share.noteTitle, 'Drift', 'udgivelsen hedder det, den peger paa');

  const g = gaest(srv.base);
  const forside = await g.hent('/w/drift-bog/');
  assert.equal(forside.status, 200);
  // Forsiden er GENERERET: bogens navn og et kort pr. side i toppen.
  assert.match(forside.tekst, /Drift/);
  assert.match(forside.tekst, /Netvaerk/);
  assert.match(forside.tekst, /Telefoni/, 'siderne staar i navigationen og i »Recently updated«');
  // Ingen liste over ALLE sider under soegefeltet: navigationen og
  // »Recently updated« siger det samme, og tre lister over det samme er
  // stoej, ikke tre indgange (Andreas, 2026-08-21).
  assert.doesNotMatch(forside.tekst, /wkort/, 'listen over alle sider er vaek');
  assert.match(forside.tekst, /wsoegstor/, 'til gengaeld er soegefeltet stort');
  assert.match(forside.tekst, /Recently updated/);
  assert.doesNotMatch(forside.tekst, /fortroligt tal/);

  // Hver side har sin EGEN adresse - ogsaa de oeverste. I en note-udgivelse
  // ER den oeverste selve forsiden; her er den det ikke.
  const side = await g.hent('/w/drift-bog/netvaerk');
  assert.equal(side.status, 200);
  assert.match(side.tekst, /Switchen staar i kaelderen/);
  assert.match((await g.hent('/w/drift-bog/kabler')).tekst, /Blaa er data/);

  // Broedkrummen begynder ved BOGEN - ellers er der ingen vej hjem.
  assert.match(side.tekst, /wkrummer/);

  // Og noten uden for bogen findes ikke, uanset hvad man taster.
  assert.equal((await g.hent('/w/drift-bog/loenninger')).status, 404);
  assert.doesNotMatch((await g.hent('/w/drift-bog/search?q=fortroligt')).tekst, /fortroligt tal/);

  // En side, der TILFOEJES senere, kommer med af sig selv - det er hele
  // forskellen paa at dele en bog og at dele en forside.
  await a.kald('POST', '/api/v1/notes', {
    title: 'Vagtplan', notebookId: bog.id, body: '# Vagtplan\n\nmandag: Kim',
  });
  assert.match((await g.hent('/w/drift-bog/')).tekst, /Vagtplan/);

  // Flyttes en side UD af bogen, forsvinder den fra wikien.
  await a.kald('POST', `/api/v1/notes/${under.id}/move`, { parentId: null, notebookId: null });
  assert.equal((await g.hent('/w/drift-bog/kabler')).status, 404);
});

test('wikiens soegning daekker traeet - og kan aldrig naa uden for det', async () => {
  const t = await byggTrae(a, 'A9');
  await a.kald('POST', '/api/v1/shares', { noteId: t.rod.id, slug: 'a9-wiki' });
  const g = gaest(srv.base);

  const traef = await g.hent('/w/a9-wiki/search?q=tunnel');
  assert.equal(traef.status, 200);
  assert.match(traef.tekst, /A9 VPN/, 'traefferen skal staa der');
  assert.match(traef.tekst, /<mark>/, 'uddraget skal fremhaeve ordet');

  // Broedteksten er med - det er dét, Notions wiki-soegning ikke kan.
  const broed = await g.hent('/w/a9-wiki/search?q=treasure');
  assert.match(broed.tekst, /A9 Deep page/);

  // ... men en note uden for udgivelsen findes ikke, selv om ejeren har den.
  const uden = await g.hent('/w/a9-wiki/search?q=classified');
  assert.doesNotMatch(uden.tekst, /A9 Private/, 'notens titel maa ikke dukke op');
  assert.doesNotMatch(uden.tekst, /Nobody outside/, 'og heller ikke et uddrag af den');
  // NB: ordet selv STAAR paa siden - i overskriften »Results for …«. Det er
  // den besoegendes eget input, ikke noget, der er laekket ud af arkivet.
  assert.match(uden.tekst, /Nothing matched/);

  // Et link i resultatet peger paa AFSNITTET, ikke paa toppen af en lang side.
  const afsnit = await g.hent('/w/a9-wiki/search?q=VPN%20access');
  assert.match(afsnit.tekst, /a9-wiki\/[a-z0-9-]*#/, `intet afsnits-anker: ${afsnit.tekst.slice(0, 400)}`);
});

test('en fil paa en note UDEN FOR udgivelsen kan ikke hentes gennem wikien', async () => {
  /*
   * Fundet ved at sabotere vagten og se, at INTET blev roedt.
   *
   * Delingstesten daekkede en fil inde i et laast trae; ingen test daekkede
   * det omvendte - en fil, der hoerer til en note, som slet ikke er udgivet.
   * Fjernede man id-filteret i `filIUdgivelse`, kunne enhver med et
   * wiki-link altsaa hente hvad som helst af ejerens filer, og alle tests var
   * groenne. »En verifikation, der kun bekraefter det, du har listet, fanger
   * tilfoejelser - aldrig udeladelser« (Beanledger v30).
   */
  const t = await byggTrae(a, 'A10');
  const up = await fetch(`${srv.base}/api/v1/files?note=${t.udenfor.id}&name=privat.png`, {
    method: 'POST',
    headers: { Cookie: a.cookie, 'X-Sagu-Upload': '1', 'Content-Type': 'image/png' },
    body: Buffer.from('\x89PNG\r\n\x1a\nikke til deling'),
  });
  const privatFil = (await up.json()).file;
  const up2 = await fetch(`${srv.base}/api/v1/files?note=${t.barn.id}&name=delt.png`, {
    method: 'POST',
    headers: { Cookie: a.cookie, 'X-Sagu-Upload': '1', 'Content-Type': 'image/png' },
    body: Buffer.from('\x89PNG\r\n\x1a\nmaa gerne ses'),
  });
  const deltFil = (await up2.json()).file;

  await a.kald('POST', '/api/v1/shares', { noteId: t.rod.id, slug: 'a10-filer' });
  const g = gaest(srv.base);

  assert.equal((await g.hent(`/w/a10-filer/f/${deltFil.id}`)).status, 200,
    'en fil paa en udgivet side skal kunne hentes');
  assert.equal((await g.hent(`/w/a10-filer/f/${privatFil.id}`)).status, 404,
    'en fil paa en note uden for udgivelsen maa IKKE kunne hentes');
  // Og et id, der slet ikke findes, ser ens ud.
  assert.equal((await g.hent(`/w/a10-filer/f/${'a'.repeat(32)}`)).status, 404);
});

test('den levende soegning svarer JSON - og kun inden for udgivelsen', async () => {
  /*
   * Feltet skal foeles som appens: traeffere mens man skriver. Det maa bare
   * ikke gaa gennem `/api/` - en besoegende skal ikke kunne naa app'ens
   * endepunkter (CLAUDE.md). Svaret er DEN SAMME soegning, afgraenset til
   * udgivelsen, i JSON.
   */
  const t = await byggTrae(a, 'E1');
  await a.kald('POST', '/api/v1/shares', { noteId: t.rod.id, slug: 'e1-levende' });
  const g = gaest(srv.base);

  const svar = await g.hent('/w/e1-levende/search?format=json&q=tunnel');
  assert.equal(svar.status, 200);
  assert.match(svar.headers.get('content-type'), /application\/json/);
  const d = JSON.parse(svar.tekst);
  assert.equal(d.results.length, 1);
  assert.equal(d.results[0].title, 'E1 VPN');
  assert.match(d.results[0].url, /^\/w\/e1-levende\//, 'adressen skal blive inde i udgivelsen');
  assert.match(d.results[0].excerpt, /<</, 'fremhaevningen er markoerer, ikke tags');
  assert.doesNotMatch(svar.tekst, /<mark>/, 'serveren udsteder ALDRIG et tag i JSON');

  // Uden for udgivelsen findes intet.
  const uden = JSON.parse((await g.hent('/w/e1-levende/search?format=json&q=classified')).tekst);
  assert.deepEqual(uden.results, []);

  // Er soegningen slaaet fra, findes ruten ikke - heller ikke i JSON.
  const share = (await a.kald('GET', `/api/v1/shares?note=${t.rod.id}`)).data.shares[0];
  await a.kald('PATCH', `/api/v1/shares/${share.id}`, { allowSearch: false });
  assert.equal((await g.hent('/w/e1-levende/search?format=json&q=tunnel')).status, 404);
});

test('importens INTERNE links virker - og laekker ikke det, der ikke er udgivet', async () => {
  /*
   * Andreas, 2026-08-21: »hvorfor laver den disse links uden at de virker?«
   *
   * Notion-importen skriver `sagu-note:<id>` for hvert internt link mellem to
   * importerede sider - 241 af dem i hans arkiv. Ingen af dem blev oversat:
   * `sikkerUrl` afviste dem med rette (de er ikke http(s)), og hele
   * krydsreferencenettet stod som RAA markdown med et hex-id i. Kvitteringen
   * sagde »241 internal links rewritten«, og ikke ét af dem virkede.
   */
  const t = await byggTrae(a, 'F1');
  // En note i traeet peger paa en anden - og paa én uden for udgivelsen.
  await a.kald('PATCH', `/api/v1/notes/${t.rod.id}`, {
    body: `# F1 handbook\n\nSe [VPN-siden](sagu-note:${t.barn.id})`
      + ` og [det private](sagu-note:${t.udenfor.id}).`,
  });
  await a.kald('POST', '/api/v1/shares', { noteId: t.rod.id, slug: 'f1-links' });
  const g = gaest(srv.base);
  const side = await g.hent('/w/f1-links/');

  // Det UDGIVNE link er et rigtigt link til den rigtige side.
  assert.match(side.tekst, /<a href="\/w\/f1-links\/f1-vpn"[^>]*>VPN-siden<\/a>/,
    `linket blev ikke oversat:\n${side.tekst.slice(side.tekst.indexOf('handbook'), 900)}`);

  // Det, der IKKE er udgivet, staar som doed tekst - med sit navn, uden
  // adressen og uden id'et.
  assert.match(side.tekst, /det private<\/span>/, 'teksten skal blive staaende');
  assert.doesNotMatch(side.tekst, new RegExp(t.udenfor.id), 'id et paa en ikke-udgivet note maa ikke staa der');
  assert.doesNotMatch(side.tekst, /sagu-note:/, 'og den raa markdown maa ikke staa nogen steder');
});

test('ISOLATION: en anden bruger kan hverken udgive eller aendre As noter', async () => {
  const t = await byggTrae(a, 'B1');
  const share = (await a.kald('POST', '/api/v1/shares', { noteId: t.rod.id, slug: 'b1-mine' })).data.share;

  // B kan ikke udgive As note ...
  const forsoeg = await b.kald('POST', '/api/v1/shares', { noteId: t.rod.id, slug: 'b1-stjaalet' });
  assert.equal(forsoeg.status, 404, '404, ikke 403 - id et maa ikke kunne bekraeftes');

  // ... kan ikke aendre As udgivelse ...
  assert.equal((await b.kald('PATCH', `/api/v1/shares/${share.id}`, { password: null })).status, 404);
  // ... kan ikke tilbagekalde den ...
  assert.equal((await b.kald('DELETE', `/api/v1/shares/${share.id}`)).status, 404);
  // ... og ser den ikke i sin egen liste.
  const bs = (await b.kald('GET', '/api/v1/shares')).data.shares;
  assert.ok(!bs.some((x) => x.id === share.id));

  // Ejeren kan det hele.
  const as = (await a.kald('GET', '/api/v1/shares')).data.shares;
  assert.ok(as.some((x) => x.id === share.id));
});

test('en slug er GLOBALT unik, og en ugyldig slug afvises med en forklaring', async () => {
  const t1 = await byggTrae(a, 'C1');
  const t2 = await byggTrae(b, 'C2');
  await a.kald('POST', '/api/v1/shares', { noteId: t1.rod.id, slug: 'delt-navn' });

  const kollision = await b.kald('POST', '/api/v1/shares', { noteId: t2.rod.id, slug: 'Delt-Navn' });
  assert.equal(kollision.status, 409, 'ogsaa med andet bogstavsleje - adresserummet er ét');
  assert.equal(kollision.data.error, 'slug_taken');
  assert.match(kollision.data.message, /already in use/);

  const daarlig = await b.kald('POST', '/api/v1/shares', { noteId: t2.rod.id, slug: '///' });
  assert.equal(daarlig.status, 400);
  assert.equal(daarlig.data.error, 'bad_slug');
});

test('en udgivelse uden slug naas paa sit token - og tokenet kan ikke gaettes', async () => {
  const t = await byggTrae(a, 'C3');
  const share = (await a.kald('POST', '/api/v1/shares', { noteId: t.rod.id })).data.share;
  assert.equal(share.slug, null);
  assert.match(share.token, /^[a-f0-9]{48}$/, 'et token skal vaere langt nok til ikke at kunne gaettes');
  const g = gaest(srv.base);
  assert.equal((await g.hent(`/s/${share.token}`)).status, 200);
  assert.equal((await g.hent(`/s/${'0'.repeat(48)}`)).status, 404);
});

test('kodeordsforsoeg rate-limites', async () => {
  const t = await byggTrae(a, 'C4');
  await a.kald('POST', '/api/v1/shares', { noteId: t.rod.id, slug: 'c4-brute', password: 'kodeord-her' });
  const g = gaest(srv.base);
  let spaerret = 0;
  for (let i = 0; i < 25; i++) {
    const r = await g.post('/w/c4-brute/password', { password: `gaet-${i}` });
    if (r.status === 429) spaerret++;
  }
  assert.ok(spaerret > 0, 'der skal komme en spaerre foer 25 forsoeg');
});

test('kodeordssiden er ikke en aaben viderestilling', async () => {
  const t = await byggTrae(a, 'C5');
  await a.kald('POST', '/api/v1/shares', { noteId: t.rod.id, slug: 'c5-open-redir', password: 'kodeord-her' });
  const g = gaest(srv.base);
  const svar = await g.post('/w/c5-open-redir/password',
    { password: 'kodeord-her', next: 'https://ondt.example/phishing' });
  assert.equal(svar.status, 302);
  assert.equal(svar.headers.get('location'), '/w/c5-open-redir/',
    'en fremmed adresse skal kastes vaek - det er dér, den besoegende er indstillet paa at godkende noget');
});

test('en side, der ikke er indekserbar, siger det - og en beskyttet er det aldrig', async () => {
  const t = await byggTrae(a, 'C6');
  const share = (await a.kald('POST', '/api/v1/shares', { noteId: t.rod.id, slug: 'c6-robots' })).data.share;
  const g = gaest(srv.base);
  // Fravaer betyder NEJ: en side, ingen har taget stilling til, skal ikke
  // kunne findes i en soegemaskine.
  assert.match((await g.hent('/w/c6-robots/')).tekst, /name="robots" content="noindex/);

  await a.kald('PATCH', `/api/v1/shares/${share.id}`, { allowIndex: true });
  assert.match((await g.hent('/w/c6-robots/')).tekst, /name="robots" content="index/);

  // ... men et kodeord slaar det fra igen, uanset flaget.
  await a.kald('PATCH', `/api/v1/shares/${share.id}`, { password: 'kodeord-her' });
  const cookie = ((await g.post('/w/c6-robots/password', { password: 'kodeord-her' }))
    .headers.get('set-cookie') || '').split(';')[0];
  assert.match((await g.hent('/w/c6-robots/', { headers: { Cookie: cookie } })).tekst,
    /name="robots" content="noindex/);
});

test('aendringsfeedet og Atom findes, og daekker kun det udgivne', async () => {
  const t = await byggTrae(a, 'C7');
  await a.kald('POST', '/api/v1/shares', { noteId: t.rod.id, slug: 'c7-feed' });
  const g = gaest(srv.base);

  const aendringer = await g.hent('/w/c7-feed/changes');
  assert.equal(aendringer.status, 200);
  assert.match(aendringer.tekst, /C7 VPN/);
  assert.doesNotMatch(aendringer.tekst, /C7 Private/);

  const atom = await g.hent('/w/c7-feed/feed');
  assert.equal(atom.status, 200);
  assert.match(atom.headers.get('content-type'), /atom\+xml/);
  assert.match(atom.tekst, /<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/);
  assert.doesNotMatch(atom.tekst, /C7 Private/);
});

test('det, laeserne ledte forgaeves efter, kan ses - og kun af ejeren', async () => {
  /*
   * »Listen over det, folk soegte efter uden at finde noget, er den bedste
   * indholdsplan en wiki kan faa« (SAGU-PLAN §5). Den blev logget allerede i
   * F2 - men kunne ikke ses nogen steder, og en funktion, man ikke kan se,
   * findes ikke for brugeren (RUNE-ERFARINGER, tovo v8).
   */
  const t = await byggTrae(a, 'C10');
  const share = (await a.kald('POST', '/api/v1/shares', { noteId: t.rod.id, slug: 'c10-savn' })).data.share;
  const g = gaest(srv.base);
  await g.hent('/w/c10-savn/search?q=feriepenge');
  await g.hent('/w/c10-savn/search?q=feriepenge');
  await g.hent('/w/c10-savn/search?q=tunnel');   // denne FINDER noget

  const savn = (await a.kald('GET', `/api/v1/search-misses?scope=${share.id}`)).data.misses;
  assert.deepEqual(savn.map((m) => m.term), ['feriepenge'], 'kun det, der gav nul');
  assert.equal(savn[0].n, 2, 'to gange');

  // En anden brugers udgivelse kan man ikke laese soegningerne i.
  assert.equal((await b.kald('GET', `/api/v1/search-misses?scope=${share.id}`)).status, 404);
  // ... og en besoegende kan slet ikke naa listen.
  assert.equal((await g.hent(`/api/v1/search-misses?scope=${share.id}`)).status, 401);
});

test('visningstallet taeller sider, ikke personer', async () => {
  const t = await byggTrae(a, 'C8');
  const share = (await a.kald('POST', '/api/v1/shares', { noteId: t.rod.id, slug: 'c8-tal' })).data.share;
  const g = gaest(srv.base);
  await g.hent('/w/c8-tal/');
  await g.hent('/w/c8-tal/');
  await g.hent('/w/c8-tal/c8-vpn');

  const efter = (await a.kald('GET', `/api/v1/shares?note=${t.rod.id}`)).data.shares[0];
  assert.equal(efter.views, 3);
  const top = efter.topPages;
  assert.equal(top[0].views, 2, 'forsiden er den mest laeste');
  assert.ok(top.every((x) => typeof x.title === 'string'));
  assert.equal(share.views, 0, 'og den var nul, da den blev oprettet');
});

test('en note i papirkurven tager sin udgivelse med sig', async () => {
  const t = await byggTrae(a, 'C9');
  await a.kald('POST', '/api/v1/shares', { noteId: t.rod.id, slug: 'c9-vaek' });
  const g = gaest(srv.base);
  assert.equal((await g.hent('/w/c9-vaek/')).status, 200);

  await a.kald('DELETE', `/api/v1/notes/${t.rod.id}`);
  assert.equal((await g.hent('/w/c9-vaek/')).status, 404,
    'en slettet note maa ikke kunne laeses videre gennem sin udgivelse');

  // ... og en gendannelse vaekker den igen. Sletning er ikke en tilbagekaldelse.
  await a.kald('POST', `/api/v1/notes/${t.rod.id}/restore`, {});
  assert.equal((await g.hent('/w/c9-vaek/')).status, 200);
});

test('en offentlig side kan ikke faa laeserens browser til at hente fra en fremmed vaert', async () => {
  // CSP en er streng med vilje (DESIGN.md §8): et eksternt billede paa en
  // offentlig side ville vaere en sporingskanal mod kollegaerne, og de har
  // ikke engang en konto at sige fra med. Indholdet gaar ikke tabt - det
  // bliver et synligt link med en forklaring.
  const rod = (await a.kald('POST', '/api/v1/notes', {
    title: 'D1 extern',
    body: '# D1\n\n![et kort](https://sporing.example/pixel.png)',
  })).data.note;
  await a.kald('POST', '/api/v1/shares', { noteId: rod.id, slug: 'd1-ekstern' });
  const side = await gaest(srv.base).hent('/w/d1-ekstern/');
  assert.doesNotMatch(side.tekst, /<img[^>]+sporing\.example/,
    'et fremmed billede maa ikke blive til et img-tag');
  assert.match(side.tekst, /sporing\.example/, 'men adressen skal kunne SES, saa intet forsvinder');
});

test('fremmed markdown kan ikke blive til et tag paa den offentlige side', async () => {
  // Wikien renderer FREMMED markdown paa et OFFENTLIGT domaene (risiko R4).
  // Suiten i markdown.test.mjs daekker rendereren; det her er beviset for, at
  // wiki-skabelonen ikke aabner en vej udenom.
  const rod = (await a.kald('POST', '/api/v1/notes', {
    title: '<img src=x onerror=alert(1)>',
    body: '# D2\n\n<script>alert(1)</script>\n\n![" onerror="alert(1)](x.png)\n\n'
      + '[klik](javascript:alert(1))\n\n<iframe src="//ondt"></iframe>',
  })).data.note;
  await a.kald('POST', '/api/v1/shares', { noteId: rod.id, slug: 'd2-angreb' });
  const side = await gaest(srv.base).hent('/w/d2-angreb/');

  /*
   * Maalt paa de RIGTIGE tags, ikke med et regex efter »on…=«.
   *
   * `&lt;img src=x onerror=…&gt;` i en <title> er inert TEKST, og et regex kan
   * ikke se forskel paa en attribut og tekst, der ligner en - saa det raaber
   * op om ingenting og ville faa en rigtig fejl til at druknei stoej.
   * Sagus egen F1-lektie, som jeg lavede om igen her.
   */
  const fundne = tags(side.tekst);
  assert.ok(!fundne.some((t) => t.navn === 'iframe'), 'ingen iframe');
  for (const t of fundne) {
    for (const at of t.attributter) {
      assert.ok(!/^on/.test(at.navn), `haendelses-attribut ${at.navn} paa <${t.navn}>: ${t.raa}`);
      if (['href', 'src', 'action', 'formaction'].includes(at.navn)) {
        assert.match(at.vaerdi, /^https?:\/\/|^\/|^#/,
          `${at.navn}="${at.vaerdi}" peger et sted, den ikke maa: ${t.raa}`);
      }
    }
  }
  // Kun de to scripts, siden SELV har: tema-scriptet og wikiens egen fil.
  // `tags()` giver baade aabne og lukkede tags, saa der taelles kun de aabne.
  const scripts = fundne.filter((t) => t.navn === 'script' && !t.raa.startsWith('</'));
  assert.equal(scripts.length, 2, `uventede scripts: ${scripts.map((x) => x.raa).join(' ')}`);
  assert.deepEqual(
    scripts.map((t) => (t.attributter.find((x) => x.navn === 'src') || { vaerdi: 'inline' }).vaerdi.split('?')[0]),
    ['inline', '/wiki.js']);
  assert.ok(!/<script>alert/.test(side.tekst));
});
