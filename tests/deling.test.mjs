/*
 * F11 - deling mellem konti.
 *
 * ── Hvad testen maaler ────────────────────────────────────────────────────
 *
 * Isolationstesten (`tests/isolation.test.mjs`) beviser, at to konti IKKE kan
 * naa hinanden. Den her beviser det modsatte hjoerne: at en deling giver
 * praecis den adgang, den lover - og **ikke en tomme mere**.
 *
 * Det farlige ved en delingsfase er ikke, at for lidt virker. Det er, at for
 * meget gør: en `read`-adgang, der viser sig ogsaa at kunne gemme, slette
 * eller UDGIVE, ser fuldstaendig rigtig ud, indtil nogen opdager sin egen
 * side paa det aabne net.
 *
 * ── Arven ─────────────────────────────────────────────────────────────────
 *
 * Deles en side, deles det, der ligger under den - og arven regnes af det
 * LEVENDE trae. Derfor staar der ogsaa tests for det, en materialiseret
 * kopi ville have faaet galt i halsen: en underside lavet BAGEFTER, og en
 * note flyttet ud af traeet igen.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, klient } from './hjaelp.mjs';

let srv;
let a;      // ejeren
let b;      // kollegaen
let c;      // en tredje, der ikke faar noget som helst
let bId;

/** En side med to niveauer under sig, som delingen kan proeves paa. */
async function byggTrae(titel) {
  const rod = (await a.kald('POST', '/api/v1/notes', { title: titel, body: `# ${titel}\n\nrodens tekst` })).data.note;
  const barn = (await a.kald('POST', '/api/v1/notes',
    { title: `${titel} barn`, body: 'barnets tekst', parentId: rod.id })).data.note;
  const barnebarn = (await a.kald('POST', '/api/v1/notes',
    { title: `${titel} barnebarn`, body: 'barnebarnets tekst', parentId: barn.id })).data.note;
  return { rod, barn, barnebarn };
}

const del = (noteId, felter) => a.kald('POST', `/api/v1/notes/${noteId}/access`, felter);

before(async () => {
  srv = await startServer();
  a = klient(srv.base);
  b = klient(srv.base);
  c = klient(srv.base);
  await a.opret('alice', 'kodeord-1234');
  await a.kald('POST', '/api/v1/admin', { allowRegistration: true });
  const bruger = await b.opret('bob', 'kodeord-1234');
  bId = bruger.id;
  await c.opret('carol', 'kodeord-1234');
});

after(() => srv.stop());

/* ==================================== at dele ========================= */

test('kontolisten kræver en session — en nøgle får den aldrig', async () => {
  const folk = (await a.kald('GET', '/api/v1/people')).data.people.map((p) => p.username);
  assert.deepEqual(folk.sort(), ['bob', 'carol'], 'mig selv staar ikke paa listen');

  const noegle = (await a.kald('POST', '/api/v1/keys', { name: 'k', scope: 'full' })).data.key;
  const r = await fetch(`${srv.base}/api/v1/people`, { headers: { Authorization: `Bearer ${noegle}` } });
  assert.equal(r.status, 401, 'en noegle maa aendre indhold, ikke hvem der kan naa det');
});

test('deling med et navn, der ikke findes, siger det — og rører intet', async () => {
  const t = await byggTrae('Ukendt modtager');
  const r = await del(t.rod.id, { username: 'findesikke', level: 'read' });
  assert.equal(r.status, 404);
  assert.equal(r.data.error, 'no_such_user');
  assert.equal((await a.kald('GET', `/api/v1/notes/${t.rod.id}/access`)).data.people.length, 0);
});

test('kun EJEREN kan dele — en kollega med skriveadgang kan ikke dele videre', async () => {
  const t = await byggTrae('Videredeling');
  await del(t.rod.id, { username: 'bob', level: 'write' });

  const r = await b.kald('POST', `/api/v1/notes/${t.rod.id}/access`, { username: 'carol', level: 'read' });
  assert.equal(r.status, 404, 'samme 404 som en note, der ikke findes — ikke en 403, der bekraefter at den er der');
  assert.equal((await c.kald('GET', `/api/v1/notes/${t.rod.id}`)).status, 404);
});

/* ==================================== read ============================ */

test('read: kollegaen kan LÆSE siden og hele undertræet', async () => {
  const t = await byggTrae('Drift');
  await del(t.rod.id, { username: 'bob', level: 'read' });

  for (const [navn, n] of [['roden', t.rod], ['barnet', t.barn], ['barnebarnet', t.barnebarn]]) {
    const r = await b.kald('GET', `/api/v1/notes/${n.id}`);
    assert.equal(r.status, 200, `${navn} skulle vaere synlig`);
    assert.ok(r.data.note.body.length, `${navn} skal komme med sin tekst`);
    assert.equal(r.data.note.mine, false);
    assert.equal(r.data.note.owner, 'alice', 'der skal staa hvem den kom fra');
    assert.equal(r.data.note.level, 'read');
  }
  // Carol fik ingenting.
  assert.equal((await c.kald('GET', `/api/v1/notes/${t.rod.id}`)).status, 404);
});

test('read: den kan ikke gemmes, ikke slettes, ikke flyttes — og ikke UDGIVES', async () => {
  const t = await byggTrae('Kun laesning');
  await del(t.rod.id, { username: 'bob', level: 'read' });

  assert.equal((await b.kald('PATCH', `/api/v1/notes/${t.rod.id}`, { body: 'overskrevet' })).status, 404);
  assert.equal((await b.kald('DELETE', `/api/v1/notes/${t.barn.id}`)).status, 404);
  assert.equal((await b.kald('POST', `/api/v1/notes/${t.barn.id}/move`, { parentId: null })).status, 404);
  const udgiv = await b.kald('POST', '/api/v1/shares', { noteId: t.rod.id });
  assert.equal(udgiv.status, 404, 'en side, man kun maa laese, maa man ikke laegge paa det aabne net');

  // ... og teksten staar uroert bagefter.
  assert.match((await a.kald('GET', `/api/v1/notes/${t.rod.id}`)).data.note.body, /rodens tekst/);
});

test('read: vedhæftninger kan HENTES, men ikke byttes', async () => {
  const t = await byggTrae('Med billede');
  const fil = (await a.kald('POST', `/api/v1/files?note=${t.rod.id}&name=tegning.png`,
    Buffer.from('\x89PNG\r\n\x1a\nbillede'), { raaKrop: true, headers: { 'Content-Type': 'image/png', 'X-Sagu-Upload': '1' } }))
    .data.file;
  await del(t.rod.id, { username: 'bob', level: 'read' });

  const hent = await fetch(`${srv.base}/api/v1/files/${fil.id}`, { headers: { Cookie: b.cookie } });
  assert.equal(hent.status, 200, 'ellers staar en delt side med huller, hvor billederne skulle vaere');

  assert.equal((await b.kald('DELETE', `/api/v1/files/${fil.id}`)).status, 404, 'men han rydder ikke op i den');
  const ny = await b.kald('POST', `/api/v1/files?note=${t.rod.id}&name=min.png`,
    Buffer.from('\x89PNG\r\n\x1a\nandet'), { raaKrop: true, headers: { 'Content-Type': 'image/png', 'X-Sagu-Upload': '1' } });
  assert.equal(ny.status, 404, 'og han haenger ikke nye paa den');

  // Carol naar den ikke - heller ikke selv om filen ligger paa en note.
  assert.equal((await fetch(`${srv.base}/api/v1/files/${fil.id}`, { headers: { Cookie: c.cookie } })).status, 404);
});

/* ==================================== write =========================== */

test('write: kollegaen kan rette i teksten — og det står, hvem der gjorde det', async () => {
  const t = await byggTrae('Faelles');
  await del(t.rod.id, { username: 'bob', level: 'write' });

  const r = await b.kald('PATCH', `/api/v1/notes/${t.rod.id}`, { body: '# Faelles\n\nbob var her' });
  assert.equal(r.status, 200);
  const set = (await a.kald('GET', `/api/v1/notes/${t.rod.id}`)).data.note;
  assert.match(set.body, /bob var her/);
  assert.equal(set.updatedBy, bId, 'updated_by er den, der SKREV — ikke ejeren');
  assert.equal(set.mine, true, '... men den er stadig alices');
});

test('write: han kan lave en underside, og den hører til TRÆET — ikke til ham', async () => {
  const t = await byggTrae('Arv fremad');
  await del(t.rod.id, { username: 'bob', level: 'write' });

  const ny = (await b.kald('POST', '/api/v1/notes',
    { title: 'Bobs tilfoejelse', body: 'noget', parentId: t.rod.id })).data.note;

  // Ejeren skal kunne se den. Hoerte den til bob, ville alices egen SYNLIG
  // ikke matche, og siden ville staa i hendes trae uden at hun kunne se den.
  const hosAlice = await a.kald('GET', `/api/v1/notes/${ny.id}`);
  assert.equal(hosAlice.status, 200);
  assert.equal(hosAlice.data.note.mine, true, 'undersiden arver traeets ejer');
  assert.equal(hosAlice.data.note.notebookId, t.rod.notebookId, '... og traeets notesbog');

  // Og den staar ikke i bobs egen liste.
  const mine = (await b.kald('GET', '/api/v1/notes')).data.notes.map((n) => n.id);
  assert.ok(!mine.includes(ny.id), '»All notes« er MINE noter');
});

test('write: men han kan hverken slette, udgive eller dele videre', async () => {
  const t = await byggTrae('Skrive er ikke bestemme');
  await del(t.rod.id, { username: 'bob', level: 'write' });

  assert.equal((await b.kald('DELETE', `/api/v1/notes/${t.rod.id}`)).status, 404);
  assert.equal((await b.kald('POST', '/api/v1/shares', { noteId: t.rod.id })).status, 404);
  assert.equal((await b.kald('POST', `/api/v1/notes/${t.rod.id}/owner`, { username: 'carol' })).status, 404);
  assert.equal((await a.kald('GET', `/api/v1/notes/${t.rod.id}`)).status, 200, 'siden er der endnu');
});

/* ==================================== arven =========================== */

test('en underside lavet BAGEFTER er også delt — arven er ikke en kopi', async () => {
  const t = await byggTrae('Senere');
  await del(t.rod.id, { username: 'bob', level: 'read' });

  const sen = (await a.kald('POST', '/api/v1/notes',
    { title: 'Lavet bagefter', body: 'ny side', parentId: t.barn.id })).data.note;
  assert.equal((await b.kald('GET', `/api/v1/notes/${sen.id}`)).status, 200,
    'en materialiseret ACL-kopi ville have misset den her');
});

test('flyttes en note UD af træet, forsvinder adgangen med det samme', async () => {
  const t = await byggTrae('Ud af traeet');
  await del(t.rod.id, { username: 'bob', level: 'read' });
  assert.equal((await b.kald('GET', `/api/v1/notes/${t.barn.id}`)).status, 200);

  await a.kald('POST', `/api/v1/notes/${t.barn.id}/move`, { parentId: null });
  assert.equal((await b.kald('GET', `/api/v1/notes/${t.barn.id}`)).status, 404,
    'adgangen ER traeet — den kan ikke blive haengende');
});

test('tree=false deler PRÆCIS den ene side', async () => {
  const t = await byggTrae('Kun forsiden');
  await del(t.rod.id, { username: 'bob', level: 'read', tree: false });
  assert.equal((await b.kald('GET', `/api/v1/notes/${t.rod.id}`)).status, 200);
  assert.equal((await b.kald('GET', `/api/v1/notes/${t.barn.id}`)).status, 404);
});

test('et træ har ÉN ejer — en note kan ikke trækkes ind under en fremmed side', async () => {
  const t = await byggTrae('Fremmed foraelder');
  await del(t.rod.id, { username: 'bob', level: 'write' });
  const bobs = (await b.kald('POST', '/api/v1/notes', { title: 'Bobs egen' })).data.note;

  const r = await b.kald('POST', `/api/v1/notes/${bobs.id}/move`, { parentId: t.rod.id });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'other_owner');
  // Ellers ville bobs note arve alices deling — altsaa give adgang til noget,
  // ingen havde delt.
  assert.equal((await a.kald('GET', `/api/v1/notes/${bobs.id}`)).status, 404);
});

/* ================================ søgning og lister =================== */

test('en delt note kan FINDES — også af den rangerede søgning', async () => {
  const t = await byggTrae('Soegbar');
  await a.kald('PATCH', `/api/v1/notes/${t.barn.id}`, { body: 'sagusoegeord staar her' });
  await del(t.rod.id, { username: 'bob', level: 'read' });

  const r = await b.kald('GET', '/api/v1/search?q=sagusoegeord');
  assert.equal(r.status, 200);
  assert.ok(r.data.results.some((x) => x.id === t.barn.id),
    'FTS-indekset baerer ejerens id — laases der paa det, kan en delt note kun findes, naar indekset MISSER');
  assert.equal(r.data.fallback, false, 'og den skal findes af indekset, ikke af noedbremsen');

  assert.equal((await c.kald('GET', '/api/v1/search?q=sagusoegeord')).data.results.length, 0);
});

test('»delt med mig« viser kun TOPPEN af hvert træ, med hvem det kom fra', async () => {
  const b2 = klient(srv.base);
  await b2.opret('dave', 'kodeord-1234');
  const t = await byggTrae('Til dave');
  await del(t.rod.id, { username: 'dave', level: 'read' });

  const liste = (await b2.kald('GET', '/api/v1/shared')).data.notes;
  assert.equal(liste.length, 1, 'et delt trae paa tre sider er ÉN raekke, ikke tre');
  assert.equal(liste[0].id, t.rod.id);
  assert.equal(liste[0].owner, 'alice');
  assert.equal(liste[0].level, 'read');

  // Og mine egne staar der ikke.
  await b2.kald('POST', '/api/v1/notes', { title: 'Daves egen' });
  assert.equal((await b2.kald('GET', '/api/v1/shared')).data.notes.length, 1);
});

test('baglæns links røber ikke en fremmed sides titel', async () => {
  const maal = (await a.kald('POST', '/api/v1/notes', { title: 'Maalet' })).data.note;
  await a.kald('POST', '/api/v1/notes', { title: 'Opsigelse, Jens', body: 'se [[Maalet]]' });
  await del(maal.id, { username: 'bob', level: 'read' });

  const hosAlice = (await a.kald('GET', `/api/v1/notes/${maal.id}`)).data.note;
  assert.ok(hosAlice.backlinks.some((x) => x.title === 'Opsigelse, Jens'), 'ejeren ser sit eget net');

  const hosBob = (await b.kald('GET', `/api/v1/notes/${maal.id}`)).data.note;
  assert.deepEqual(hosBob.backlinks, [],
    'en titel er tit hele indholdet — den maa ikke sive gennem en side, der linker hertil');
});

test('mærker på en delt note hører til EJEREN', async () => {
  const t = await byggTrae('Maerker');
  await del(t.rod.id, { username: 'bob', level: 'write' });
  await b.kald('PATCH', `/api/v1/notes/${t.rod.id}`, { tags: ['drift'] });

  const alicesMaerker = (await a.kald('GET', '/api/v1/state')).data.tags.map((x) => x.name);
  assert.ok(alicesMaerker.includes('drift'), 'ellers kan ejeren ikke finde sin egen side med tag:drift');
  const bobsMaerker = (await b.kald('GET', '/api/v1/state')).data.tags.map((x) => x.name);
  assert.ok(!bobsMaerker.includes('drift'), 'og maerket hoerer ikke hjemme i kollegaens egen liste');

  assert.ok((await a.kald('GET', '/api/v1/search?q=tag:drift')).data.results.some((x) => x.id === t.rod.id));
});

/* ============================== tilbagekald og ejerskifte ============= */

test('delingen kan tages tilbage — og virker ved NÆSTE kald', async () => {
  const t = await byggTrae('Fortrudt');
  await del(t.rod.id, { username: 'bob', level: 'read' });
  assert.equal((await b.kald('GET', `/api/v1/notes/${t.barn.id}`)).status, 200);

  assert.equal((await a.kald('DELETE', `/api/v1/notes/${t.rod.id}/access/${bId}`)).status, 200);
  assert.equal((await b.kald('GET', `/api/v1/notes/${t.rod.id}`)).status, 404);
  assert.equal((await b.kald('GET', `/api/v1/notes/${t.barn.id}`)).status, 404, 'hele traeet, ikke kun toppen');
});

test('giv siden videre: hele træet skifter ejer, og den gamle beholder skriveadgang', async () => {
  const t = await byggTrae('Overdragelse');
  const r = await a.kald('POST', `/api/v1/notes/${t.rod.id}/owner`, { username: 'bob' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.antal, 3, 'hele undertraeet — ellers bliver undersiderne haengende hos den gamle ejer');

  const hosBob = (await b.kald('GET', `/api/v1/notes/${t.barnebarn.id}`)).data.note;
  assert.equal(hosBob.mine, true);
  assert.equal(hosBob.notebookId, null, 'notesbogen var alices — den kan bob ikke tegne noget sted');

  const hosAlice = (await a.kald('GET', `/api/v1/notes/${t.rod.id}`)).data.note;
  assert.equal(hosAlice.mine, false);
  assert.equal(hosAlice.owner, 'bob');
  assert.equal(hosAlice.level, 'write', '»giv videre« maa ikke betyde »mist«');

  // Og soegeindekset fulgte med: ellers hoerer noten til den ene i traeet og
  // den anden i soegningen.
  assert.ok((await b.kald('GET', '/api/v1/search?q=barnebarnets')).data.results.some((x) => x.id === t.barnebarn.id));
});

test('en slettet note tager sine delinger med sig', async () => {
  const t = await byggTrae('Slettet');
  await del(t.rod.id, { username: 'bob', level: 'read' });
  await a.kald('DELETE', `/api/v1/notes/${t.rod.id}`);
  assert.equal((await b.kald('GET', `/api/v1/notes/${t.rod.id}`)).status, 404);
  assert.equal((await b.kald('GET', '/api/v1/shared')).data.notes.some((n) => n.id === t.rod.id), false);
});

/* ============================== skemaet, delingen står på ============= */

test('det LEVENDE søgeindeks har ingen user_id', async () => {
  /*
   * Målt på databasen, ikke på kilden.
   *
   * `m3` opretter stadig den gamle tabel med kolonnen — en migration er
   * fortid — så en form-regel på kildeteksten ville enten fælde historien
   * eller kun måle m12. Det, der betyder noget, er skemaet EFTER hele
   * rækken af migrationer, og det er det her.
   *
   * Kolonnen var afgrænsningen på den rangerede søgning indtil F11, og den
   * kunne aldrig virke sammen med deling: indekset bærer ejerens id.
   */
  const { DatabaseSync } = await import('node:sqlite');
  const path = await import('node:path');
  const d = new DatabaseSync(path.join(srv.dataDir, 'sagu.db'));
  const kolonner = d.prepare('PRAGMA table_info(note_fts)').all().map((k) => k.name);
  d.close();
  assert.ok(kolonner.includes('note_id'), 'fandt ikke indekset - er det doebt om?');
  assert.ok(!kolonner.includes('user_id'),
    'et indeks afgraenser ikke adgang. SYNLIG gør, paa notes, hvor ejerskabet staar');
});

test('sidebarens træ er MIT arkiv — en delt side står ikke i mine notesbøger', async () => {
  /*
   * Fundet ved at logge ind som bruger nummer to og KIGGE.
   *
   * `hentNoter` havde fået sit ejer-filter, men træruten er sin egen
   * forespørgsel — og den tegner sidebaren efter notesbøger. En delt side
   * ligger i ejerens bog, så alices »Drift« stod under bobs egne bøger, som
   * om den var hans. Testen fandtes ikke, fordi den lister et sted, ingen
   * test kiggede.
   */
  const t = await byggTrae('Ikke i bobs sidebar');
  await del(t.rod.id, { username: 'bob', level: 'write' });

  const trae = (await b.kald('GET', '/api/v1/tree')).data;
  assert.ok(!trae.notes.some((n) => n.id === t.rod.id),
    'en delt side hoerer i »Shared with me«, ikke midt i mine egne notesboeger');
  assert.ok(!trae.notes.some((n) => n.id === t.barn.id));

  // ... men ejeren ser den selvfølgelig i sin egen.
  assert.ok((await a.kald('GET', '/api/v1/tree')).data.notes.some((n) => n.id === t.rod.id));
});

/* ================================ kommentarer på tværs ================ */

test('en kollega kan KOMMENTERE en side, han kun må læse', async () => {
  /*
   * Med vilje `read`-adgang: at kommentere er ikke at ændre noten.
   *
   * Det er tit hele grunden til at dele en side — »kig lige på det her« — og
   * en delt side, man ikke kan svare på, sender samtalen et andet sted hen
   * (til en mail), hvor den ikke står ved siden af det, den handler om.
   */
  const t = await byggTrae('Til gennemsyn');
  await del(t.rod.id, { username: 'bob', level: 'read' });

  const r = await b.kald('POST', `/api/v1/notes/${t.rod.id}/comments`, { body: 'Er filteret skiftet?' });
  assert.equal(r.status, 200, JSON.stringify(r.data));

  const hosAlice = (await a.kald('GET', `/api/v1/notes/${t.rod.id}/comments`)).data.comments;
  assert.equal(hosAlice.length, 1);
  assert.equal(hosAlice[0].body, 'Er filteret skiftet?');
  assert.equal(hosAlice[0].status, 'published', 'en kollega med en konto er ikke en gaest paa wikien');

  // ... men noten selv er urørt.
  assert.match((await a.kald('GET', `/api/v1/notes/${t.rod.id}`)).data.note.body, /rodens tekst/);

  // Og carol, der ikke har adgang, ser hverken noten eller samtalen om den.
  assert.equal((await c.kald('GET', `/api/v1/notes/${t.rod.id}/comments`)).status, 404);
});

test('moderationen følger noten — kun den, der må skrive i den', async () => {
  const t = await byggTrae('Moderation');
  await del(t.rod.id, { username: 'bob', level: 'read' });
  const id = (await b.kald('POST', `/api/v1/notes/${t.rod.id}/comments`, { body: 'min egen' })).data.id;

  // Bob kan rette sin EGEN kommentar ...
  assert.equal((await b.kald('PATCH', `/api/v1/comments/${id}`, { body: 'rettet' })).status, 200);
  /*
   * ... men alices egen kommentar er ikke hans at røre.
   *
   * **403 og ikke 404** — og det er med vilje. Reglen »ukendt og forbudt
   * svarer ens« findes, for at man ikke skal kunne aftaste, hvad der er der.
   * Her KAN bob allerede se kommentaren; siden er delt med ham. En 404 ville
   * fortælle ham, at noget han kigger på ikke findes, og det er ikke
   * hemmeligholdelse — det er en løgn.
   */
  const alices = (await a.kald('POST', `/api/v1/notes/${t.rod.id}/comments`, { body: 'alices svar' })).data.id;
  const kapret = await b.kald('PATCH', `/api/v1/comments/${alices}`, { body: 'kapret' });
  assert.equal(kapret.status, 403);
  assert.match(kapret.data.message, /your own comments/);

  // Og moderationen er ejerens: bob maa ikke afvise alices kommentar.
  assert.equal((await b.kald('PATCH', `/api/v1/comments/${alices}`, { status: 'rejected' })).status, 403);
  assert.equal((await a.kald('PATCH', `/api/v1/comments/${alices}`, { status: 'rejected' })).status, 200);
});

/* ================================ eksport og gendannelse ============== */

test('en eksport bærer IKKE delingerne — og det er et valg', async () => {
  /*
   * En ACL-række peger på en ANDEN brugers id.
   *
   * Bæres den med i en eksport og lægges ind igen i en frisk installation,
   * peger den på et id, der enten ikke findes — eller er blevet en helt
   * andens. Det sidste er den værste slags fejl, en gendannelse kan lave:
   * den giver adgang til nogen, ingen har peget på, og den ser rigtig ud.
   *
   * Prisen er, at delingerne skal sættes igen efter en gendannelse. Det er
   * en håndfuld klik; det andet er et hul, ingen opdager.
   */
  const t = await byggTrae('Til eksport');
  await del(t.rod.id, { username: 'bob', level: 'write' });

  const r = await a.kald('GET', '/api/v1/export?format=json');
  assert.equal(r.status, 200);
  const raa = JSON.stringify(r.data);
  assert.ok(raa.includes('Til eksport'), 'noterne skal selvfoelgelig med');
  assert.ok(!raa.includes('note_acl'), 'ingen ACL-tabel i eksporten');
  assert.ok(!raa.includes(bId), 'og ikke et fremmed bruger-id nogen steder');
});

/* ============================== navnet, som det vises ================= */

test('brugernavnet VISES med stort — men gemmes og matches uændret', async () => {
  /*
   * Skellet er hele pointen: »stort begyndelsesbogstav« er en
   * visningsregel. Ændrede den den gemte værdi, ville login holde op med at
   * virke, og en deling til »Bo« ville ikke finde kontoen »bo«.
   */
  const folk = (await a.kald('GET', '/api/v1/people')).data.people.map((p) => p.username);
  assert.ok(folk.includes('bob'), 'API-et svarer med det, kontoen HEDDER');

  const mig = (await a.kald('GET', '/api/me')).data.user.username;
  assert.equal(mig, 'alice', 'og »hvem er jeg« er heller ikke pyntet');

  // Delingen matcher uafhaengigt af store bogstaver, saa den pyntede form
  // ogsaa ville virke, hvis den slap igennem et sted.
  const t = await byggTrae('Store bogstaver');
  const r = await a.kald('POST', `/api/v1/notes/${t.rod.id}/access`, { username: 'Bob', level: 'read' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.delt.username, 'bob', 'svaret baerer kontoens rigtige navn');
  assert.equal((await b.kald('GET', `/api/v1/notes/${t.rod.id}`)).status, 200);
});

/* ============================ er der nogen at dele MED? ================= */

/*
 * Dele-knappen skal ikke staa paa en server, hvor man er alene: den aabnede
 * en rude, hvis eneste mulige modtager var én selv (Andreas, 2026-08-21).
 *
 * Fladen kan ikke selv taelle konti - kontolisten kraever en session og siger
 * ikke noget om, hvor mange der er, foer man beder om den. Derfor svarer
 * `/api/me` paa spoergsmaalet, og det er DET svar, der proeves her.
 *
 * Bemaerk hvad der IKKE staar i svaret: et antal. Fladen skal traeffe ét valg
 * - vis knappen eller lad vaere - og til det er ja/nej nok. Et tal ville
 * fortaelle enhver bruger, hvor mange konti serveren har.
 */
test('/api/me siger, om der er andre konti — som et ja/nej, ikke et tal', async () => {
  const svar = (await a.kald('GET', '/api/me')).data;
  assert.equal(svar.flereBrugere, true, 'alice, bob og carol findes alle tre');
  assert.equal(svar.users, undefined, 'antallet er ikke fladens sag');
  assert.equal(svar.usernames, undefined);
});

test('en server med én konto svarer nej — så knappen forsvinder', async () => {
  const alene = await startServer();
  try {
    const en = klient(alene.base);
    await en.opret('solo', 'kodeord-1234');
    assert.equal((await en.kald('GET', '/api/me')).data.flereBrugere, false);

    // ... og saa snart der ER en at dele med, skifter svaret. Uden DEN
    // halvdel kunne serveren svare nej til alt og stadig bestaa proeven.
    await en.kald('POST', '/api/v1/admin', { allowRegistration: true });
    await klient(alene.base).opret('nummer-to', 'kodeord-1234');
    assert.equal((await en.kald('GET', '/api/me')).data.flereBrugere, true);
  } finally { alene.stop(); }
});
