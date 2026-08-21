/*
 * F9 - API'et og iPhone-genvejene.
 *
 * **Alt her koeres UDEN cookie.** Med en session godkender serveren alting,
 * og scope-tjekket ser ud til at virke, selv hvis det aldrig blev kaldt
 * (RUNE-ERFARINGER, doda F2). Det er dét, en telefon ude i verden goer, og
 * det er den eneste maade at bevise, at noeglerne betyder noget.
 *
 * Det andet, filen handler om, er TILGIVELSEN: en iOS-genvej har ét tekstfelt
 * og ingen taalmodighed. Den kan ikke bygge JSON, den kan ikke laese en
 * fejlkode, og den kan ikke spoerge om noget. Hver af de fire veje ind
 * (JSON, formulardata, ren tekst, `?text=`) har derfor sin egen test.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, klient } from './hjaelp.mjs';

let srv;
let a;
const noegler = {};

/** Et kald som en GENVEJ ville lave det: ingen cookie, kun en noegle. */
async function medNoegle(scope, metode, sti, opt) {
  const o = opt || {};
  const headers = { Authorization: `Bearer ${noegler[scope]}` };
  if (o.type) headers['Content-Type'] = o.type;
  const r = await fetch(srv.base + sti, { method: metode, headers, body: o.krop });
  const tekst = await r.text();
  let data = null;
  try { data = JSON.parse(tekst); } catch { /* ikke JSON - fx markdown */ }
  return { status: r.status, data, tekst, headers: r.headers };
}

before(async () => {
  srv = await startServer();
  a = klient(srv.base);
  await a.opret('ejer', 'kodeord-1234');
  for (const scope of ['capture', 'read', 'link', 'full']) {
    noegler[scope] = (await a.kald('POST', '/api/v1/keys', { name: scope, scope })).data.key;
  }
});

after(() => srv.stop());

const iDag = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/* ====================================== de fire veje ind =============== */

test('fangst tager JSON', async () => {
  const r = await medNoegle('capture', 'POST', '/api/v1/capture', {
    type: 'application/json', krop: JSON.stringify({ text: 'Ny router i skabet' }),
  });
  assert.equal(r.status, 200, r.tekst);
  assert.equal(r.data.note.title, 'Ny router i skabet');
  assert.match(r.data.message, /Saved/, 'svaret skal have en faerdig linje, genvejen kan vise');
});

test('fangst tager FORMULARDATA', async () => {
  const r = await medNoegle('capture', 'POST', '/api/v1/capture', {
    type: 'application/x-www-form-urlencoded',
    krop: new URLSearchParams({ text: 'Fra en formular' }).toString(),
  });
  assert.equal(r.status, 200, r.tekst);
  assert.equal(r.data.note.title, 'Fra en formular');
});

test('fangst tager REN TEKST - uden Content-Type overhovedet', async () => {
  // Det er dét, en genvej med ét felt sender, hvis man ikke goer noget.
  const r = await medNoegle('capture', 'POST', '/api/v1/capture', { krop: 'Bare en linje' });
  assert.equal(r.status, 200, r.tekst);
  assert.equal(r.data.note.title, 'Bare en linje');
});

test('fangst tager en krop, der PAASTAAR at vaere formulardata', async () => {
  /*
   * Det er dét, `curl --data '...'` goer - og en hel del andre klienter med:
   * de saetter form-typen af sig selv, uanset hvad kroppen indeholder.
   *
   * Foerste udgave lavede hele saetningen om til et tomt felt med et
   * mystisk navn og svarede »send noget tekst«, selv om teksten var der.
   * Min egen test sendte slet ingen Content-Type og gik derfor fri - fejlen
   * kom frem, da jeg koerte den som en rigtig klient ville.
   */
  const r = await medNoegle('capture', 'POST', '/api/v1/capture', {
    type: 'application/x-www-form-urlencoded',
    krop: 'Ny switch i racket, ikke et formularfelt',
  });
  assert.equal(r.status, 200, r.tekst);
  assert.equal(r.data.note.title, 'Ny switch i racket, ikke et formularfelt');
});

test('fangst tager ?text= i adressen', async () => {
  const r = await medNoegle('capture', 'POST',
    `/api/v1/capture?text=${encodeURIComponent('Fra adressen')}`);
  assert.equal(r.status, 200, r.tekst);
  assert.equal(r.data.note.title, 'Fra adressen');
});

test('en tom fangst er ikke en note', async () => {
  const r = await medNoegle('capture', 'POST', '/api/v1/capture', { krop: '   ' });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'no_text');
  assert.match(r.data.message, /text/i, 'og beskeden skal sige HVAD der mangler');
});

/* ====================================== hvad teksten bliver til ======== */

test('foerste linje er titlen, resten er noten', async () => {
  const r = await medNoegle('capture', 'POST', '/api/v1/capture', {
    krop: 'Skift certifikat\nUdloeber i november.\nHusk begge servere.',
  });
  assert.equal(r.data.note.title, 'Skift certifikat');
  const md = await medNoegle('read', 'GET', `/api/v1/notes/${r.data.note.id}?format=md`);
  assert.match(md.tekst, /Udloeber i november/);
  assert.match(md.tekst, /Husk begge servere/);
});

test('`#maerke` i teksten bliver et RIGTIGT maerke - samme regel som i appen', async () => {
  const r = await medNoegle('capture', 'POST', '/api/v1/capture', { krop: 'Ny switch #drift' });
  assert.equal(r.data.note.title, 'Ny switch', 'maerket skal ud af titlen');
  const note = (await a.kald('GET', `/api/v1/notes/${r.data.note.id}`)).data.note;
  assert.deepEqual(note.tags, ['drift']);

  // Og en adresse med et fragment er IKKE et maerke (doda F1).
  const r2 = await medNoegle('capture', 'POST', '/api/v1/capture',
    { krop: 'Se https://dr.dk/nyheder#sport' });
  const n2 = (await a.kald('GET', `/api/v1/notes/${r2.data.note.id}`)).data.note;
  assert.deepEqual(n2.tags, []);
  assert.match(n2.title, /#sport/, 'adressen skal staa uroert');
});

test('en notesbog kan vaelges ved NAVN - en genvej kan ikke slaa et id op', async () => {
  const bog = (await a.kald('POST', '/api/v1/notebooks', { name: 'Drift' })).data.notebook;
  const r = await medNoegle('capture', 'POST', '/api/v1/capture?notebook=drift',
    { krop: 'Lander i Drift' });
  assert.equal(r.status, 200, r.tekst);
  assert.equal((await a.kald('GET', `/api/v1/notes/${r.data.note.id}`)).data.note.notebookId, bog.id);

  // En bog, der ikke findes, er ikke en fejl: teksten er det vigtige, og en
  // fangst, der fejler, er det vaerste udfald (doda v28).
  const r2 = await medNoegle('capture', 'POST', '/api/v1/capture?notebook=findes-ikke',
    { krop: 'Lander alligevel' });
  assert.equal(r2.status, 200);
});

/* ====================================== dagens note ==================== */

test('to=today samler dagens smaating ÉT sted', async () => {
  const en = await medNoegle('capture', 'POST', '/api/v1/capture?to=today', { krop: 'Foerste indfald' });
  assert.equal(en.status, 200, en.tekst);
  assert.equal(en.data.note.title, iDag(), 'noten hedder datoen');
  // Beskeden naevner NOTEN ved navn. Den hed foer »today's note«, og det var
  // rigtigt, saa laenge der kun var ét maal at tilfoeje til - med `to=<id>`
  // ville den vaere en usandhed hver gang.
  assert.match(en.data.message, new RegExp(`Added to “${iDag()}”`));

  const to = await medNoegle('capture', 'POST', '/api/v1/capture?to=today', { krop: 'Andet indfald' });
  assert.equal(to.data.note.id, en.data.note.id, 'samme note - ikke en ny pr. indfald');

  const md = await medNoegle('read', 'GET', `/api/v1/notes/${en.data.note.id}?format=md`);
  assert.match(md.tekst, /Foerste indfald/);
  assert.match(md.tekst, /Andet indfald/);
  // Rækkefoelgen er den, de kom i - en dagbog, der vender om, er ubrugelig.
  assert.ok(md.tekst.indexOf('Foerste') < md.tekst.indexOf('Andet'));
});

test('telefonen kan sende SIN dato - den ved bedre end serveren, hvad i dag er', async () => {
  // Serverens ur og telefonens doegn er ikke det samme naar man er paa rejse,
  // og et kald lige efter midnat maa ikke lande i gaar.
  const r = await medNoegle('capture', 'POST', '/api/v1/capture?to=today&date=2026-01-02',
    { krop: 'Fra en anden dag' });
  assert.equal(r.status, 200, r.tekst);
  assert.equal(r.data.note.title, '2026-01-02');

  // En vaerdi, der ikke er en dato, falder tilbage til serverens dag frem for
  // at faelde fangsten.
  const r2 = await medNoegle('capture', 'POST', '/api/v1/capture?to=today&date=i-morgen',
    { krop: 'Vrøvl i datoen' });
  assert.equal(r2.data.note.title, iDag());
});

/* ====================================== noten ud igen ================== */

test('?format=md giver REN markdown - ikke JSON at grave i', async () => {
  const n = (await a.kald('POST', '/api/v1/notes',
    { title: 'Haandbog', body: '# Haandbog\n\n- et punkt\n- to' })).data.note;
  const r = await medNoegle('read', 'GET', `/api/v1/notes/${n.id}?format=md`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^text\/markdown/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.tekst, /^# Haandbog\n/);
  assert.match(r.tekst, /- et punkt/);
  // Titlen staar ÉN gang - ikke to, fordi kroppen ogsaa begynder med den.
  assert.equal(r.tekst.match(/# Haandbog/g).length, 1);

  // Har noten sin EGEN overskrift, staar den uroert. Dagens note hedder
  // datoen, men har »Friday, 21 August« i teksten - og det er DEN, brugeren
  // ser. At bytte den ud ville vaere at skrive om paa hans tekst.
  const dag = (await a.kald('POST', '/api/v1/notes',
    { title: '2026-08-21', body: '# Friday, 21 August 2026\n\nnoget' })).data.note;
  const md = await medNoegle('read', 'GET', `/api/v1/notes/${dag.id}?format=md`);
  assert.match(md.tekst, /^# Friday, 21 August 2026/);
  assert.ok(!md.tekst.includes('# 2026-08-21'));

  // Og en note UDEN overskrift faar titlen foran, saa teksten kan staa alene.
  const bar = (await a.kald('POST', '/api/v1/notes',
    { title: 'Uden overskrift', body: 'bare tekst' })).data.note;
  const md2 = await medNoegle('read', 'GET', `/api/v1/notes/${bar.id}?format=md`);
  assert.match(md2.tekst, /^# Uden overskrift\n\nbare tekst/);
});

test('changes fortaeller ogsaa om det, der er SLETTET', async () => {
  // En liste over det, der findes, kan ikke sige, at noget er forsvundet - og
  // en klient, der kun ser tilfoejelser, samler paa spoegelser (doda F9).
  const foer = (await medNoegle('read', 'GET', '/api/v1/changes?since=0')).data.now;
  const n = (await a.kald('POST', '/api/v1/notes', { title: 'Kortlivet', body: 'x' })).data.note;
  const efter = await medNoegle('read', 'GET', `/api/v1/changes?since=${foer - 1}`);
  assert.ok(efter.data.notes.some((x) => x.id === n.id));
  assert.ok(!efter.data.notes.some((x) => x.body !== undefined),
    'listesvar baerer aldrig broedteksten');

  await a.kald('DELETE', `/api/v1/notes/${n.id}`);
  const slettet = await medNoegle('read', 'GET', `/api/v1/changes?since=${foer - 1}`);
  assert.ok(slettet.data.deleted.includes(n.id));
  assert.ok(!slettet.data.notes.some((x) => x.id === n.id), 'og den er ude af listen');
});

test('en daarlig `since` siger hvad den skulle vaere', async () => {
  const r = await medNoegle('read', 'GET', '/api/v1/changes?since=i-gaar');
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'bad_since');
  assert.match(r.data.message, /timestamp|ISO/);
});

/* ====================================== billedet fra delingsmenuen ===== */

test('et billede fra delingsmenuen bliver en note med billedet i', async () => {
  // En 1x1 PNG - nok til at bevise vejen igennem.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64');
  const r = await medNoegle('capture', 'POST',
    `/api/v1/capture?name=skab.png&text=${encodeURIComponent('Skabet i kaelderen')}`,
    { type: 'image/png', krop: png });
  assert.equal(r.status, 200, r.tekst);
  assert.equal(r.data.note.title, 'Skabet i kaelderen');

  const note = (await a.kald('GET', `/api/v1/notes/${r.data.note.id}`)).data.note;
  assert.match(note.body, /!\[skab\.png\]\(sagu:[a-f0-9]{32}\)/, 'billedet skal staa i noten');
  assert.equal(note.files.length, 1, 'og haenge paa den som en vedhaeftning');

  // Filen kan hentes igen - og den er den samme.
  const fil = await a.kald('GET', `/api/v1/files/${note.files[0].id}`);
  assert.equal(fil.status, 200);
});

/* ====================================== scope-matricen ================= */

test('SCOPE: en capture-noegle kan skrive noget nyt og se INGENTING', async () => {
  const n = (await a.kald('POST', '/api/v1/notes', { title: 'Hemmelig', body: 'x' })).data.note;
  assert.equal((await medNoegle('capture', 'POST', '/api/v1/capture', { krop: 'ok' })).status, 200);
  // En mistet telefon maa ikke kunne laese arkivet.
  assert.equal((await medNoegle('capture', 'GET', `/api/v1/notes/${n.id}`)).status, 403);
  assert.equal((await medNoegle('capture', 'GET', `/api/v1/notes/${n.id}?format=md`)).status, 403);
  assert.equal((await medNoegle('capture', 'GET', '/api/v1/changes?since=0')).status, 403);
  assert.equal((await medNoegle('capture', 'GET', '/api/v1/search?q=hemmelig')).status, 403);
  assert.equal((await medNoegle('capture', 'GET', '/api/v1/notes')).status, 403);
});

test('SCOPE: en read-noegle kan se og skriver INTET', async () => {
  assert.equal((await medNoegle('read', 'GET', '/api/v1/changes?since=0')).status, 200);
  assert.equal((await medNoegle('read', 'POST', '/api/v1/capture', { krop: 'nej' })).status, 403);
  assert.equal((await medNoegle('read', 'POST', '/api/v1/notes',
    { type: 'application/json', krop: '{"title":"nej"}' })).status, 403);
});

test('SCOPE: INGEN noegle kan lave noegler eller skifte kodeord', async () => {
  /*
   * Den vigtigste raekke i matricen.
   *
   * Ellers er én laekket noegle nok til at give sig selv fuld og varig adgang
   * - eller til at laase ejeren ude af sin egen app (RUNE-ERFARINGER, doda
   * F2). Auth-ruterne staar derfor uden for »ét API, to legitimationer«.
   */
  for (const scope of ['capture', 'read', 'link', 'full']) {
    assert.equal((await medNoegle(scope, 'GET', '/api/v1/keys')).status, 401, scope);
    assert.equal((await medNoegle(scope, 'POST', '/api/v1/keys',
      { type: 'application/json', krop: '{"name":"min egen","scope":"full"}' })).status, 401, scope);
    assert.equal((await medNoegle(scope, 'POST', '/api/password',
      { type: 'application/json', krop: '{"current":"kodeord-1234","password":"kapret-1234"}' })).status,
    401, scope);
    assert.equal((await medNoegle(scope, 'POST', '/api/v1/admin',
      { type: 'application/json', krop: '{"allowRegistration":true}' })).status, 401, scope);
  }
  // Kodeordet virker stadig.
  assert.equal((await a.kald('POST', '/api/login',
    { username: 'ejer', password: 'kodeord-1234' })).status, 200);
});

test('SCOPE: en tilbagekaldt noegle doer med det samme', async () => {
  const ny = (await a.kald('POST', '/api/v1/keys', { name: 'kortvarig', scope: 'capture' })).data;
  noegler.kortvarig = ny.key;
  assert.equal((await medNoegle('kortvarig', 'POST', '/api/v1/capture', { krop: 'mens den lever' })).status, 200);
  const liste = (await a.kald('GET', '/api/v1/keys')).data.keys;
  const id = liste.find((k) => k.name === 'kortvarig').id;
  await a.kald('DELETE', `/api/v1/keys/${id}`);
  // Ingen cache at rydde: opslaget sker paa hashen, saa naeste kald er 401.
  assert.equal((await medNoegle('kortvarig', 'POST', '/api/v1/capture', { krop: 'bagefter' })).status, 401);
});

test('SCOPE: en noegle naar kun sin EGEN brugers noter', async () => {
  await a.kald('POST', '/api/v1/admin', { allowRegistration: true });
  const b = klient(srv.base);
  await b.opret('anden', 'kodeord-1234');
  const bNote = (await b.kald('POST', '/api/v1/notes', { title: 'B ejer den', body: 'x' })).data.note;
  // A's noegle maa ikke kunne se B's note - 404, ikke 403.
  assert.equal((await medNoegle('read', 'GET', `/api/v1/notes/${bNote.id}`)).status, 404);
  assert.equal((await medNoegle('read', 'GET', `/api/v1/notes/${bNote.id}?format=md`)).status, 404);
  const aendringer = await medNoegle('read', 'GET', '/api/v1/changes?since=0');
  assert.ok(!aendringer.data.notes.some((x) => x.id === bNote.id));
});

test('en ugyldig noegle er 401 - og siger ikke hvorfor', async () => {
  const r = await fetch(`${srv.base}/api/v1/capture`, {
    method: 'POST', headers: { Authorization: 'Bearer sagu_findesikke' }, body: 'nej',
  });
  assert.equal(r.status, 401);
  assert.equal(r.headers.get('www-authenticate'), 'Bearer', 'ellers proever klienter i ring');
});

/* ============== læg noget nederst i en note, der findes ================= */

test('to=<id> lægger teksten nederst i den note', async () => {
  const n = (await a.kald('POST', '/api/v1/notes',
    { title: 'Serverskabet', body: '# Serverskabet\n\nUniFi, 24 porte.' })).data.note;

  const r = await medNoegle('capture', 'POST', `/api/v1/capture?to=${n.id}`,
    { krop: 'Husk at skifte filteret' });
  assert.equal(r.status, 200, r.tekst);
  assert.equal(r.data.note.id, n.id, 'samme note - der laves ikke en ny');
  assert.match(r.data.message, /Added to “Serverskabet”/, 'beskeden skal naevne noten ved navn');

  const md = await medNoegle('read', 'GET', `/api/v1/notes/${n.id}?format=md`);
  assert.match(md.tekst, /UniFi, 24 porte/, 'det, der stod der, bliver staaende');
  assert.match(md.tekst, /Husk at skifte filteret/);
  assert.ok(md.tekst.indexOf('UniFi') < md.tekst.indexOf('Husk'), 'og det nye kommer NEDERST');
});

test('to=<id> tilføjer mærker — det ERSTATTER dem ikke', async () => {
  /*
   * Fejlen fandtes i forvejen på `to=today`: `saetMaerker` skriver notens
   * mærker forfra, og det er rigtigt, når man redigerer mærkerækken. Men her
   * *tilføjer* man til en note, der findes — og så forsvandt dens øvrige
   * mærker, uden at noget fejlede. **En fangst, der sletter noget, er den
   * værste slags stille fejl.**
   */
  const n = (await a.kald('POST', '/api/v1/notes',
    { title: 'Med maerker', tags: ['drift', 'netvaerk'] })).data.note;

  const r = await medNoegle('capture', 'POST', `/api/v1/capture?to=${n.id}`,
    { krop: 'Ny router i skabet #indkoeb' });
  assert.equal(r.status, 200, r.tekst);

  const efter = (await a.kald('GET', `/api/v1/notes/${n.id}`)).data.note;
  assert.deepEqual(efter.tags.slice().sort(), ['drift', 'indkoeb', 'netvaerk'],
    'de gamle maerker skal blive, og det nye laegges til');
});

test('to=<id> kræver SKRIVE-adgang, ikke bare at man kan se noten', async () => {
  const n = (await a.kald('POST', '/api/v1/notes', { title: 'Kun min' })).data.note;

  // En anden konto, som noten er delt med til LAESNING.
  await a.kald('POST', '/api/v1/admin', { allowRegistration: true });
  const b = klient(srv.base);
  await b.opret('kollega', 'kodeord-1234');
  await a.kald('POST', `/api/v1/notes/${n.id}/access`, { username: 'kollega', level: 'read' });
  const bNoegle = (await b.kald('POST', '/api/v1/keys', { name: 'k', scope: 'capture' })).data.key;

  const r = await fetch(`${srv.base}/api/v1/capture?to=${n.id}`, {
    method: 'POST', headers: { Authorization: `Bearer ${bNoegle}` }, body: 'skrevet udefra',
  });
  assert.equal(r.status, 400);
  assert.match((await r.json()).message, /not yours to write in/);

  // ... og teksten er ikke landet.
  assert.ok(!/skrevet udefra/.test((await a.kald('GET', `/api/v1/notes/${n.id}`)).data.note.body));
});

test('to=<id> med et ukendt id svarer som med en note, der ikke findes', async () => {
  const r = await medNoegle('capture', 'POST', `/api/v1/capture?to=${'f'.repeat(32)}`,
    { krop: 'ingen steder' });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'not_found');
});

test('et BILLEDE kan lægges i en note, der findes', async () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64');
  const n = (await a.kald('POST', '/api/v1/notes',
    { title: 'Skabet', body: '# Skabet\n\nStaar i kaelderen.' })).data.note;

  const r = await medNoegle('capture', 'POST', `/api/v1/capture?to=${n.id}&name=foto.png`,
    { type: 'image/png', krop: png });
  assert.equal(r.status, 200, r.tekst);
  assert.equal(r.data.note.id, n.id);
  assert.match(r.data.message, /Added the image to “Skabet”/);

  const efter = (await a.kald('GET', `/api/v1/notes/${n.id}`)).data.note;
  assert.match(efter.body, /Staar i kaelderen/, 'teksten er uroert');
  assert.match(efter.body, /!\[foto\.png\]\(sagu:[a-f0-9]{32}\)/, 'og billedet staar nederst');
  assert.equal(efter.files.length, 1, 'og haenger paa noten som en vedhaeftning');
  // Uden en `text=` skal der ikke staa et filnavn som overskrift i teksten.
  assert.ok(!/^foto\.png$/m.test(efter.body), 'filnavnet er ikke en overskrift her');
});

/* ==================== en kommentar er noget NYT, ikke en ændring ======== */

test('en capture-nøgle kan skrive en kommentar — men får ikke samtalen retur', async () => {
  /*
   * Scopet blev sænket fra `write` til `capture`, fordi en kommentar er noget
   * nyt ved siden af noten og ikke en ændring af den. Det er samme skel, F11
   * allerede traf: en kollega med læse-adgang må gerne kommentere.
   *
   * **Men svaret bar hele samtalen.** Havde vi kun sænket scopet, var
   * skrive-døren blevet til en læse-kanal: en capture-nøgle kunne skrive en
   * ligegyldig kommentar på et hvilket som helst note-id og få alt, der står,
   * retur — og så er den ene ting, capture findes for, væk.
   */
  const n = (await a.kald('POST', '/api/v1/notes', { title: 'Til gennemsyn' })).data.note;
  await a.kald('POST', `/api/v1/notes/${n.id}/comments`, { body: 'Noget hemmeligt i forvejen' });

  const r = await medNoegle('capture', 'POST', `/api/v1/notes/${n.id}/comments`, {
    type: 'application/json', krop: JSON.stringify({ body: 'Set fra doda' }),
  });
  assert.equal(r.status, 200, r.tekst);
  assert.ok(r.data.id, 'kommentaren skal vaere oprettet');
  assert.equal(r.data.comments, undefined, 'listen maa IKKE komme med til en noegle, der ikke maa laese');
  assert.ok(!r.tekst.includes('hemmeligt'), 'og slet ikke den samtale, der stod der i forvejen');

  // ... men den ER landet.
  const set = (await a.kald('GET', `/api/v1/notes/${n.id}/comments`)).data.comments;
  assert.ok(set.some((c) => c.body === 'Set fra doda'));
});

test('en link-nøgle får listen med — den må både skrive og læse', async () => {
  const n = (await a.kald('POST', '/api/v1/notes', { title: 'Fra doda' })).data.note;
  const r = await medNoegle('link', 'POST', `/api/v1/notes/${n.id}/comments`, {
    type: 'application/json', krop: JSON.stringify({ body: 'Skrevet fra doda' }),
  });
  assert.equal(r.status, 200, r.tekst);
  assert.ok(Array.isArray(r.data.comments), 'en link-noegle maa laese, saa listen kommer med');
  assert.equal(r.data.comments[0].body, 'Skrevet fra doda');
});

test('en read-nøgle kan LÆSE kommentarer, men ikke skrive en', async () => {
  const n = (await a.kald('POST', '/api/v1/notes', { title: 'Kun laesning' })).data.note;
  assert.equal((await medNoegle('read', 'GET', `/api/v1/notes/${n.id}/comments`)).status, 200);

  const r = await medNoegle('read', 'POST', `/api/v1/notes/${n.id}/comments`, {
    type: 'application/json', krop: JSON.stringify({ body: 'burde ikke lykkes' }),
  });
  assert.equal(r.status, 403);
  assert.match(r.data.message, /cannot capture/);
});
