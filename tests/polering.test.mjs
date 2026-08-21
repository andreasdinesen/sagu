/*
 * F13 - favoritter og »senest besøgte«.
 *
 * ── Hvorfor de er værd at teste ───────────────────────────────────────────
 *
 * Begge er små funktioner, og begge hænger på det, F11 gjorde svært: de er
 * **mine**, ikke notens. En stjerne, der er et flag på noten, dukker op hos
 * den, man har delt med; et spor, der er notens, bliver skubbet rundt af
 * andres besøg. Med én konto ser begge fejl fuldstændig rigtige ud.
 *
 * Og sporet må ikke kunne skrives af en NØGLE: en iOS-genvej, der henter en
 * note som markdown, og en MCP-klient, der læser den for at svare på noget,
 * er ikke mig, der var her.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, klient } from './hjaelp.mjs';

let srv;
let a;
let b;
let noegle;

const ny = (titel) => a.kald('POST', '/api/v1/notes', { title: titel }).then((r) => r.data.note);

before(async () => {
  srv = await startServer();
  a = klient(srv.base);
  b = klient(srv.base);
  await a.opret('alice', 'kodeord-1234');
  await a.kald('POST', '/api/v1/admin', { allowRegistration: true });
  await b.opret('bob', 'kodeord-1234');
  noegle = (await a.kald('POST', '/api/v1/keys', { name: 'genvej', scope: 'read' })).data.key;
});

after(() => srv.stop());

/* ==================================== favoritter ====================== */

test('en stjerne kan sættes og tages af igen', async () => {
  const n = await ny('Vigtig side');
  assert.equal((await a.kald('GET', `/api/v1/notes/${n.id}`)).data.note.favorite, false);

  assert.equal((await a.kald('PUT', `/api/v1/notes/${n.id}/favorite`)).status, 200);
  assert.equal((await a.kald('GET', `/api/v1/notes/${n.id}`)).data.note.favorite, true);
  assert.ok((await a.kald('GET', '/api/v1/favorites')).data.notes.some((x) => x.id === n.id));

  // To gange skal ikke give to raekker.
  assert.equal((await a.kald('PUT', `/api/v1/notes/${n.id}/favorite`)).status, 200);
  assert.equal((await a.kald('GET', '/api/v1/favorites')).data.notes.filter((x) => x.id === n.id).length, 1);

  assert.equal((await a.kald('DELETE', `/api/v1/notes/${n.id}/favorite`)).status, 200);
  assert.ok(!(await a.kald('GET', '/api/v1/favorites')).data.notes.some((x) => x.id === n.id));
});

test('stjernen er MIN — ikke notens', async () => {
  const n = await ny('Delt og stjernet');
  await a.kald('POST', `/api/v1/notes/${n.id}/access`, { username: 'bob', level: 'read' });
  await a.kald('PUT', `/api/v1/notes/${n.id}/favorite`);

  // Bob kan se noten, men ikke min stjerne.
  const hosBob = await b.kald('GET', `/api/v1/notes/${n.id}`);
  assert.equal(hosBob.status, 200);
  assert.equal(hosBob.data.note.favorite, false,
    'et flag paa NOTEN ville betyde, at min stjerne dukkede op hos kollegaen');
  assert.equal((await b.kald('GET', '/api/v1/favorites')).data.notes.length, 0);

  // ... og han kan sætte sin egen, uden at røre min.
  await b.kald('PUT', `/api/v1/notes/${n.id}/favorite`);
  assert.equal((await b.kald('GET', '/api/v1/favorites')).data.notes.length, 1);
  assert.equal((await a.kald('GET', '/api/v1/notes/' + n.id)).data.note.favorite, true);
});

test('en note, man ikke kan se, kan ikke stjernes', async () => {
  const n = await ny('Alices egen');
  assert.equal((await b.kald('PUT', `/api/v1/notes/${n.id}/favorite`)).status, 404);
});

test('mister man adgangen, forsvinder noten fra stjernerne', async () => {
  const n = await ny('Laant');
  await a.kald('POST', `/api/v1/notes/${n.id}/access`, { username: 'bob', level: 'read' });
  await b.kald('PUT', `/api/v1/notes/${n.id}/favorite`);
  const foer = (await b.kald('GET', '/api/v1/favorites')).data.notes.length;

  const bId = (await b.kald('GET', '/api/me')).data.user.id;
  await a.kald('DELETE', `/api/v1/notes/${n.id}/access/${bId}`);

  const efter = (await b.kald('GET', '/api/v1/favorites')).data.notes;
  assert.equal(efter.length, foer - 1,
    'listen laeses gennem SYNLIG, saa den kan ikke vise noget, man ikke maa se');
});

/* ==================================== sporet ========================== */

/** Sætter alle besøg til det SAMME sekund — som et rigtigt hurtigt klik. */
async function samSekund() {
  const { DatabaseSync } = await import('node:sqlite');
  const path = await import('node:path');
  const d = new DatabaseSync(path.join(srv.dataDir, 'sagu.db'));
  d.exec('UPDATE note_visits SET at = 1000000');
  d.close();
}

test('rækkefølgen afhænger IKKE af urets opløsning', async () => {
  /*
   * Første udgave sorterede på tidsstemplet, og to noter åbnet i samme
   * sekund gav uafgjort — men testen var *flaky* frem for rød: uafgjort
   * betyder vilkårlig, og vilkårlig rammer rigtigt cirka halvdelen af
   * gangene. Det opdagede jeg ved at sabotere sorteringen og få **nul røde**.
   *
   * Derfor sættes stemplerne ens med vilje. Så måler testen dét, dens navn
   * siger — at rækkefølgen er et løbenummer, ikke et ur.
   */
  const en = await ny('Foerste');
  const to = await ny('Anden');
  await a.kald('GET', `/api/v1/notes/${en.id}`);
  await a.kald('GET', `/api/v1/notes/${to.id}`);
  await samSekund();

  const spor = (await a.kald('GET', '/api/v1/recent')).data.notes;
  assert.equal(spor[0].id, to.id, 'den sidst aabnede skal staa oeverst - ogsaa i samme sekund');
  assert.ok(spor.some((x) => x.id === en.id));

  /*
   * Og så det, adfærden IKKE kan måle.
   *
   * En uafgjort sortering er *uspecificeret*, ikke forkert: SQLite må vælge
   * frit, og den valgte rigtigt begge gange, jeg saboterede. Et resultat, der
   * er rigtigt ved et tilfælde, er ikke en måling.
   *
   * Kravet er derfor stillet på dataene i stedet: **to besøg i samme sekund
   * skal have forskelligt løbenummer.** Er den betingelse opfyldt, kan
   * rækkefølgen ikke afhænge af urets opløsning — og er den ikke, er den
   * grønne test ovenover et lykketræf.
   */
  const { DatabaseSync } = await import('node:sqlite');
  const path = await import('node:path');
  const d = new DatabaseSync(path.join(srv.dataDir, 'sagu.db'));
  const raekker = d.prepare('SELECT note_id, seq, at FROM note_visits ORDER BY seq').all();
  d.close();
  const numre = raekker.map((r) => r.seq);
  assert.equal(new Set(numre).size, numre.length, 'to besoeg maa ikke dele loebenummer');
  assert.equal(new Set(raekker.map((r) => r.at)).size, 1, 'de er alle sammen i samme sekund');
  const sidst = raekker[raekker.length - 1];
  assert.equal(sidst.note_id, to.id, 'det hoejeste loebenummer skal vaere den sidst aabnede');
});

test('sporet har ÉN række pr. note — og et gensyn flytter den op', async () => {
  const n = await ny('Besoegt tit');
  const anden = await ny('Noget andet');
  for (let i = 0; i < 5; i++) await a.kald('GET', `/api/v1/notes/${n.id}`);
  let spor = (await a.kald('GET', '/api/v1/recent?limit=50')).data.notes;
  assert.equal(spor.filter((x) => x.id === n.id).length, 1,
    'en logbog ville vokse uden graenser; det her er en liste over hvor jeg var');

  // ... og raekken skal OPDATERES, ikke bare overleve. Uden det bliver
  // sporet en liste over hvad jeg saa foerste gang, ikke hvor jeg var sidst.
  await a.kald('GET', `/api/v1/notes/${anden.id}`);
  await a.kald('GET', `/api/v1/notes/${n.id}`);
  await samSekund();
  spor = (await a.kald('GET', '/api/v1/recent?limit=50')).data.notes;
  assert.equal(spor[0].id, n.id, 'et gensyn skal flytte noten oeverst');
});

test('en NØGLE skriver ikke i sporet', async () => {
  /*
   * En iOS-genvej, der henter en note som markdown, og en MCP-klient, der
   * læser den for at svare på noget, er ikke mig, der »var her«. Sporet skal
   * svare på hvor JEG var — ellers fylder det med noget, en maskine gjorde.
   */
  const n = await ny('Hentet af en genvej');
  const foer = (await a.kald('GET', '/api/v1/recent?limit=50')).data.notes.length;

  const r = await fetch(`${srv.base}/api/v1/notes/${n.id}`, {
    headers: { Authorization: `Bearer ${noegle}` },
  });
  assert.equal(r.status, 200, 'noeglen skal kunne LAESE noten');

  const efter = (await a.kald('GET', '/api/v1/recent?limit=50')).data.notes;
  assert.equal(efter.length, foer);
  assert.ok(!efter.some((x) => x.id === n.id));
});

test('sporet er MIT — bobs besøg rører ikke alices liste', async () => {
  const n = await ny('Faelles side');
  await a.kald('POST', `/api/v1/notes/${n.id}/access`, { username: 'bob', level: 'read' });
  await b.kald('GET', `/api/v1/notes/${n.id}`);

  assert.ok(!(await a.kald('GET', '/api/v1/recent?limit=50')).data.notes.some((x) => x.id === n.id),
    'et spor paa NOTEN ville blive skubbet rundt af andres besoeg');
  assert.ok((await b.kald('GET', '/api/v1/recent')).data.notes.some((x) => x.id === n.id));
});

test('mister man adgangen, forsvinder noten også fra SPORET', async () => {
  /*
   * Samme regel som favoritterne, og den skal måles hver for sig: de to
   * lister er to forespørgsler, og en manglende `SYNLIG` i den ene er
   * usynlig, så længe den anden har sin.
   */
  const n = await ny('Set og mistet');
  await a.kald('POST', `/api/v1/notes/${n.id}/access`, { username: 'bob', level: 'read' });
  await b.kald('GET', `/api/v1/notes/${n.id}`);
  assert.ok((await b.kald('GET', '/api/v1/recent?limit=50')).data.notes.some((x) => x.id === n.id));

  const bId = (await b.kald('GET', '/api/me')).data.user.id;
  await a.kald('DELETE', `/api/v1/notes/${n.id}/access/${bId}`);

  assert.ok(!(await b.kald('GET', '/api/v1/recent?limit=50')).data.notes.some((x) => x.id === n.id),
    'sporet laeses gennem SYNLIG - det kan ikke vise noget, man ikke laengere maa se');
});

test('en slettet note falder ud af begge lister', async () => {
  const n = await ny('Doemt');
  await a.kald('PUT', `/api/v1/notes/${n.id}/favorite`);
  await a.kald('GET', `/api/v1/notes/${n.id}`);
  await a.kald('DELETE', `/api/v1/notes/${n.id}`);

  assert.ok(!(await a.kald('GET', '/api/v1/favorites')).data.notes.some((x) => x.id === n.id));
  assert.ok(!(await a.kald('GET', '/api/v1/recent?limit=50')).data.notes.some((x) => x.id === n.id));
});
