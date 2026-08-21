/*
 * F10 - connectoren til claude.ai, hele vejen igennem.
 *
 * Testen gaar PRAECIS den vej, en webklient gaar: opdagelse → registrering →
 * samtykke → kode → token → `/mcp`. Ikke fordi flowet er kompliceret, men
 * fordi hvert eneste trin har en faelde, der fejler TAVST:
 *
 *   1. En 401 uden `resource_metadata` → klienten finder aldrig
 *      autorisationsserveren og opgiver, uden at noget ser i stykker ud.
 *   2. `form-action 'self'` → browseren blokerer hele indsendelsen, og
 *      »Allow« ser bare ud, som om den ikke virker: ingen navigation, ingen
 *      serverlog, intet at fejlsoege paa.
 *   3. Et access token, der ikke udloeber, eller et refresh, der ikke roterer
 *      → en stjaalet kopi virker for evigt, og ingen opdager det.
 *
 * Og dét, der er Sagus eget: **appen er flerbruger**. En forbindelse hoerer
 * til den, der trykkede »Allow« - ikke til installationen.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { startServer, klient } from './hjaelp.mjs';

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

let srv;
let a;
let BASE;

const b64u = (b) => Buffer.from(b).toString('base64url');
const udfordring = (verifier) => b64u(createHash('sha256').update(verifier).digest());

/** Registrerer en klient, som claude.ai ville. INGEN cookie - den er udefra. */
async function registrer(navn, uris) {
  const r = await fetch(`${BASE}/oauth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: navn, redirect_uris: uris || [REDIRECT] }),
  });
  // En 429 her ville ellers foerst vise sig tre trin senere som »unknown
  // client« paa samtykkesiden - samme vildledende sti, en rigtig bruger
  // faar. Sig det hoejt med det samme.
  if (r.status === 429) throw new Error('registreringsgraensen ramt - er den for lav?');
  return { status: r.status, krop: await r.json() };
}

function autoriseringsUrl(felter) {
  return `/oauth/authorize?${new URLSearchParams(Object.assign({
    response_type: 'code', redirect_uri: REDIRECT, scope: 'full', code_challenge_method: 'S256',
  }, felter))}`;
}

/** Hele samtykkesiden igennem, med den cookie en given bruger sidder med. */
async function samtykke(felter, godkend = 'ja', cookie = a.cookie) {
  const q = Object.assign({
    response_type: 'code', redirect_uri: REDIRECT, scope: 'full', code_challenge_method: 'S256',
  }, felter);
  const vis = await fetch(`${BASE}/oauth/authorize?${new URLSearchParams(q)}`,
    { headers: { Cookie: cookie }, redirect: 'manual' });
  const html = await vis.text();
  if (vis.status !== 200) return { status: vis.status, html, headers: vis.headers };

  const bevis = html.match(/name="bevis" value="([a-f0-9]+)"/);
  const svar = await fetch(`${BASE}/oauth/authorize`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: String(new URLSearchParams(Object.assign({}, q,
      { bevis: bevis ? bevis[1] : '', godkend }))),
    redirect: 'manual',
  });
  return { status: svar.status, html, sted: svar.headers.get('location'), headers: vis.headers };
}

async function hentKode(clientId, verifier, cookie) {
  const r = await samtykke({ client_id: clientId, code_challenge: udfordring(verifier) }, 'ja', cookie);
  assert.equal(r.status, 302, `samtykke skulle give en omdirigering: ${r.html || ''}`);
  return new URL(r.sted).searchParams.get('code');
}

const token = async (felter) => {
  const r = await fetch(`${BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: String(new URLSearchParams(felter)),
  });
  return { status: r.status, krop: await r.json() };
};

/** Et helt almindeligt MCP-kald med det udstedte token. */
const mcp = async (noegle, metode = 'tools/list') => {
  const r = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' },
      noegle ? { Authorization: `Bearer ${noegle}` } : {}),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: metode, params: {} }),
  });
  return { status: r.status, auth: r.headers.get('www-authenticate'), krop: await r.json() };
};

/** Hele flowet paa én linje - det de fleste tests skal bruge FOER deres pointe. */
async function forbind(navn, scope = 'full', cookie) {
  const { krop: k } = await registrer(navn);
  const verifier = randomBytes(32).toString('base64url');
  const kode = scope === 'full'
    ? await hentKode(k.client_id, verifier, cookie)
    : await (async () => {
      const r = await samtykke({ client_id: k.client_id, code_challenge: udfordring(verifier), scope },
        'ja', cookie);
      assert.equal(r.status, 302, r.html);
      return new URL(r.sted).searchParams.get('code');
    })();
  const t = await token({
    grant_type: 'authorization_code', code: kode,
    client_id: k.client_id, redirect_uri: REDIRECT, code_verifier: verifier,
  });
  assert.equal(t.status, 200, JSON.stringify(t.krop));
  return { klient: k, t: t.krop };
}

before(async () => {
  srv = await startServer();
  BASE = srv.base;
  a = klient(BASE);
  await a.opret('ejer', 'kodeord-1234');
});

after(() => srv.stop());

/* ====================================== opdagelse ===================== */

test('/mcp uden token peger på ressource-metadataene, og de svarer', async () => {
  const r = await mcp(null);
  assert.equal(r.status, 401);
  assert.match(r.auth, /^Bearer realm="Sagu"/);
  const m = r.auth.match(/resource_metadata="([^"]+)"/);
  assert.ok(m, 'uden den kan claude.ai slet ikke finde autorisationsserveren');

  const doc = await (await fetch(m[1])).json();
  assert.equal(doc.resource, `${BASE}/mcp`);
});

test('begge .well-known svarer UDEN login og peger de rigtige steder hen', async () => {
  const r = await fetch(`${BASE}/.well-known/oauth-protected-resource`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  // CORP ville ellers kassere svaret EFTER CORS-tjekket - en spaerring, der
  // ikke ses i noget netvaerkspanel (RUNE-ERFARINGER §9a, faelde 3).
  assert.equal(r.headers.get('cross-origin-resource-policy'), 'cross-origin');
  const res = await r.json();
  assert.equal(res.resource, `${BASE}/mcp`);
  assert.deepEqual(res.authorization_servers, [BASE]);

  // Samme dokument paa den sti, RFC 9728 udpeger (ressourcens sti haengt paa).
  assert.deepEqual(await (await fetch(`${BASE}/.well-known/oauth-protected-resource/mcp`)).json(), res);

  const as = await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json();
  assert.equal(as.issuer, BASE);
  assert.equal(as.authorization_endpoint, `${BASE}/oauth/authorize`);
  assert.equal(as.token_endpoint, `${BASE}/oauth/token`);
  assert.equal(as.registration_endpoint, `${BASE}/oauth/register`);
  // OAuth 2.1: kun S256, ingen implicit, ingen klienthemmelighed.
  assert.deepEqual(as.code_challenge_methods_supported, ['S256']);
  assert.deepEqual(as.grant_types_supported, ['authorization_code', 'refresh_token']);
  assert.ok(!as.response_types_supported.includes('token'));
  assert.deepEqual(as.token_endpoint_auth_methods_supported, ['none']);
});

test('hver adresse, opdagelsesdokumentet lover, svarer også', async () => {
  /*
   * Metadataene er en KRAVSPECIFIKATION.
   *
   * Omdoebes en rute, peger dokumentet stille et sted hen, hvor der ikke er
   * noget - og klienten fejler et helt andet sted end aarsagen. Det er samme
   * mekanik som guidens opskrifter (F9), bare maalt paa serveren i stedet for
   * paa kilden.
   */
  const as = await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json();
  for (const felt of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint',
    'revocation_endpoint']) {
    const url = as[felt];
    assert.ok(url && url.startsWith(BASE), `${felt} mangler`);
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: '',
      redirect: 'manual',
    });
    assert.notEqual(r.status, 404, `${felt} peger paa ${url}, som ikke findes`);
  }
});

/* ==================================== registrering ==================== */

test('registrering giver et client_id og kræver https', async () => {
  const ok = await registrer('Testklient');
  assert.equal(ok.status, 201);
  assert.match(ok.krop.client_id, /^sagu-client-[0-9a-f]+$/);
  assert.equal(ok.krop.token_endpoint_auth_method, 'none');

  for (const daarlig of [['http://evil.example/cb'], [], ['ikke en url']]) {
    assert.equal((await registrer('Ond', daarlig)).status, 400, JSON.stringify(daarlig));
  }
  // localhost er den eneste http-undtagelse: ellers kan man ikke proeve med
  // et lokalt vaerktoej uden at skulle have et certifikat.
  assert.equal((await registrer('Lokal', ['http://localhost:9000/cb'])).status, 201);
});

/* ==================================== autorisation ==================== */

test('/authorize afviser ukendt klient, fremmed redirect og dårlig PKCE', async () => {
  const { krop: k } = await registrer('Kontrol');
  const god = udfordring(randomBytes(32).toString('hex'));
  const proev = async (sti) => {
    const r = await fetch(BASE + sti, { headers: { Cookie: a.cookie }, redirect: 'manual' });
    return { status: r.status, html: await r.text() };
  };

  assert.equal((await proev(autoriseringsUrl({ client_id: 'findes-ikke', code_challenge: god }))).status, 400);

  // NOEJAGTIG match paa redirect_uri - intet praefiks, ingen wildcards.
  const fremmed = await proev(autoriseringsUrl({
    client_id: k.client_id, code_challenge: god,
    redirect_uri: `${REDIRECT}/evil`,
  }));
  assert.equal(fremmed.status, 400);
  assert.match(fremmed.html, /not registered/);

  assert.equal((await proev(autoriseringsUrl({ client_id: k.client_id, code_challenge: '' }))).status, 400);
  assert.equal((await proev(autoriseringsUrl({
    client_id: k.client_id, code_challenge: god, code_challenge_method: 'plain',
  }))).status, 400, '"plain" er ingen beskyttelse - OAuth 2.1 kraever S256');

  const ok = await proev(autoriseringsUrl({ client_id: k.client_id, code_challenge: god }));
  assert.equal(ok.status, 200);
  assert.match(ok.html, /Kontrol/);
  assert.match(ok.html, /wants to connect/);
  // Vist med stort begyndelsesbogstav - kontoen hedder stadig »ejer«.
  assert.match(ok.html, /Signed in as <strong>Ejer<\/strong>/, 'jeg skal kunne se HVEM jeg godkender som');
});

test('samtykkesiden kræver en session — ellers sendes man til login og tilbage', async () => {
  const { krop: k } = await registrer('Uden session');
  const sti = autoriseringsUrl({ client_id: k.client_id, code_challenge: udfordring('x'.repeat(43)) });
  const r = await fetch(BASE + sti, { redirect: 'manual' });   // ingen cookie
  assert.equal(r.status, 302);
  const sted = new URL(r.headers.get('location'), BASE);
  assert.equal(sted.pathname, '/');
  assert.equal(sted.searchParams.get('next'), sti);
});

test('CSP: form-action skal tillade klientens redirect, ellers dør Allow-knappen tavst', async () => {
  const { krop: k } = await registrer('CSP-kontrol');
  const r = await fetch(BASE + autoriseringsUrl({
    client_id: k.client_id, code_challenge: udfordring('q'.repeat(43)),
  }), { headers: { Cookie: a.cookie } });
  assert.equal(r.status, 200);
  const csp = r.headers.get('content-security-policy');
  assert.match(csp, /form-action 'self' https:\/\/claude\.ai/);
  // Kun OPRINDELSEN - ikke hele stien, og ikke https: i al almindelighed.
  assert.ok(!csp.includes('auth_callback'));

  // Og resten af appen skal vaere uroert.
  assert.match((await fetch(`${BASE}/`)).headers.get('content-security-policy'), /form-action 'self';/);
});

test('en POST uden gyldigt bevis afvises — samtykket skal komme fra denne browser', async () => {
  const { krop: k } = await registrer('Forfalsket');
  const r = await fetch(`${BASE}/oauth/authorize`, {
    method: 'POST',
    headers: { Cookie: a.cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: String(new URLSearchParams({
      client_id: k.client_id, redirect_uri: REDIRECT, response_type: 'code', scope: 'full',
      code_challenge: udfordring('y'.repeat(43)), code_challenge_method: 'S256',
      bevis: 'deadbeef', godkend: 'ja',
    })),
    redirect: 'manual',
  });
  assert.equal(r.status, 400);
});

test('trykker jeg Cancel, får klienten access_denied — ikke tavshed', async () => {
  const { krop: k } = await registrer('Fortrudt');
  const r = await samtykke({
    client_id: k.client_id, code_challenge: udfordring('z'.repeat(43)), state: 'abc123',
  }, 'nej');
  assert.equal(r.status, 302);
  const u = new URL(r.sted);
  assert.equal(u.searchParams.get('error'), 'access_denied');
  assert.equal(u.searchParams.get('state'), 'abc123');
  assert.equal(u.searchParams.get('code'), null);
});

/* ========================================== token ===================== */

test('hele flowet: kode + verifier giver et token, der virker på /mcp', async () => {
  const { krop: k } = await registrer('Claude (fuld)');
  const verifier = randomBytes(32).toString('base64url');
  const r = await samtykke({ client_id: k.client_id, code_challenge: udfordring(verifier), state: 'staten' });
  assert.equal(r.status, 302);
  const u = new URL(r.sted);
  assert.equal(u.origin + u.pathname, REDIRECT);
  assert.equal(u.searchParams.get('state'), 'staten');

  const t = (await token({
    grant_type: 'authorization_code', code: u.searchParams.get('code'),
    client_id: k.client_id, redirect_uri: REDIRECT, code_verifier: verifier,
  })).krop;
  assert.equal(t.token_type, 'Bearer');
  assert.ok(t.expires_in > 0);
  assert.match(t.access_token, /^sagu_/);
  assert.match(t.refresh_token, /^sagur_/);

  // Tokenet gaar gennem SAMME vej som en haandlavet noegle: baade MCP ...
  const m = await mcp(t.access_token);
  assert.equal(m.status, 200);
  assert.ok(m.krop.result.tools.length > 0);

  // ... og det almindelige API.
  assert.equal((await fetch(`${BASE}/api/v1/notebooks`,
    { headers: { Authorization: `Bearer ${t.access_token}` } })).status, 200);

  // ... men IKKE de ruter, der kraever en rigtig session. En connector maa
  // aldrig kunne lave sig en varig noegle, skifte kodeord eller lukke andre
  // forbindelser ned.
  for (const sti of ['/api/v1/keys', '/api/v1/connections']) {
    assert.equal((await fetch(BASE + sti,
      { headers: { Authorization: `Bearer ${t.access_token}` } })).status, 401,
    `${sti} skal kraeve en session`);
  }
});

test('koden er ENGANGSBRUG', async () => {
  const { krop: k } = await registrer('Genbrug');
  const verifier = randomBytes(32).toString('base64url');
  const felter = {
    grant_type: 'authorization_code', code: await hentKode(k.client_id, verifier),
    client_id: k.client_id, redirect_uri: REDIRECT, code_verifier: verifier,
  };
  assert.equal((await token(felter)).status, 200);
  const igen = await token(felter);
  assert.equal(igen.status, 400);
  assert.equal(igen.krop.error, 'invalid_grant');
});

test('forkert code_verifier afvises', async () => {
  const { krop: k } = await registrer('Forkert PKCE');
  const r = await token({
    grant_type: 'authorization_code',
    code: await hentKode(k.client_id, randomBytes(32).toString('base64url')),
    client_id: k.client_id, redirect_uri: REDIRECT,
    code_verifier: randomBytes(32).toString('base64url'),
  });
  assert.equal(r.status, 400);
  assert.equal(r.krop.error, 'invalid_grant');
});

test('en kode udstedt til klient A kan ikke indløses af klient B', async () => {
  const kA = (await registrer('Klient A')).krop;
  const kB = (await registrer('Klient B')).krop;
  const verifier = randomBytes(32).toString('base64url');
  const kode = await hentKode(kA.client_id, verifier);

  const tyv = await token({
    grant_type: 'authorization_code', code: kode,
    client_id: kB.client_id, redirect_uri: REDIRECT, code_verifier: verifier,
  });
  assert.equal(tyv.status, 400);

  // Og koden er BRUGT OP af forsoeget - selv den rigtige klient faar den ikke.
  assert.equal((await token({
    grant_type: 'authorization_code', code: kode,
    client_id: kA.client_id, redirect_uri: REDIRECT, code_verifier: verifier,
  })).status, 400);
});

test('refresh ROTERER: den gamle holder op med at virke', async () => {
  const { klient: k, t: foerste } = await forbind('Fornyelse');
  const ny = await token({
    grant_type: 'refresh_token', refresh_token: foerste.refresh_token, client_id: k.client_id,
  });
  assert.equal(ny.status, 200);
  assert.notEqual(ny.krop.refresh_token, foerste.refresh_token);
  assert.notEqual(ny.krop.access_token, foerste.access_token);
  assert.equal((await mcp(ny.krop.access_token)).status, 200);

  // Den gamle doer i samme oejeblik, den nye foedes - saa en stjaalet kopi
  // kun kan bruges én gang, og det kan OPDAGES.
  const gammel = await token({
    grant_type: 'refresh_token', refresh_token: foerste.refresh_token, client_id: k.client_id,
  });
  assert.equal(gammel.status, 400);

  const fremmed = (await registrer('Fremmed')).krop;
  assert.equal((await token({
    grant_type: 'refresh_token', refresh_token: ny.krop.refresh_token, client_id: fremmed.client_id,
  })).status, 400, 'en anden klient maa ikke kunne forny mit refresh');
});

test('access token UDLØBER — og så er det refresh, der redder forbindelsen', async () => {
  const { klient: k, t } = await forbind('Udloeb');
  assert.equal((await mcp(t.access_token)).status, 200);

  // Uret kan ikke flyttes gennem API'et, saa udloebet flyttes i databasen ved
  // siden af. WAL taaler to processer.
  const d = new DatabaseSync(path.join(srv.dataDir, 'sagu.db'));
  d.prepare('UPDATE tokens SET expires_at = ? WHERE client_id = ?')
    .run(Math.floor(Date.now() / 1000) - 10, k.client_id);
  d.close();

  assert.equal((await mcp(t.access_token)).status, 401);
  const ny = await token({
    grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: k.client_id,
  });
  assert.equal(ny.status, 200);
  assert.equal((await mcp(ny.krop.access_token)).status, 200);
});

/* ===================================== rettigheder ==================== */

test('scope: read giver et token, der kan læse, men ikke skrive', async () => {
  const { krop: k } = await registrer('Kun laesning');
  const verifier = randomBytes(32).toString('base64url');
  const r = await samtykke({
    client_id: k.client_id, code_challenge: udfordring(verifier), scope: 'read',
  });
  // Samtykkesiden skal SIGE, hvad man giver fra sig - ellers er det ikke et
  // samtykke, men et klik.
  assert.match(r.html, /read your notes/);
  assert.ok(!/and change/.test(r.html.split('If you allow it')[1].split('</p>')[0]));

  const t = (await token({
    grant_type: 'authorization_code', code: new URL(r.sted).searchParams.get('code'),
    client_id: k.client_id, redirect_uri: REDIRECT, code_verifier: verifier,
  })).krop;
  assert.equal(t.scope, 'read');

  assert.equal((await fetch(`${BASE}/api/v1/notebooks`,
    { headers: { Authorization: `Bearer ${t.access_token}` } })).status, 200);
  const skriv = await fetch(`${BASE}/api/v1/capture`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${t.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'noget' }),
  });
  assert.equal(skriv.status, 403);

  // Og i MCP'en ses forskellen i selve listen.
  const navne = (await mcp(t.access_token)).krop.result.tools.map((x) => x.name);
  assert.ok(navne.includes('search_notes') && !navne.includes('update_note'));
});

/* ================================== tilbagekaldelse =================== */

test('forbindelsen kan tilbagekaldes — og så dør både token og refresh', async () => {
  const { klient: k, t } = await forbind('Til afvisning');
  assert.equal((await mcp(t.access_token)).status, 200);

  const min = (await a.kald('GET', '/api/v1/connections')).data.connections
    .find((c) => c.id === k.client_id);
  assert.ok(min, 'forbindelsen skal staa paa listen');
  assert.equal(min.name, 'Til afvisning');
  assert.equal(min.active, 1);

  assert.equal((await a.kald('DELETE', `/api/v1/connections/${k.client_id}`)).status, 200);

  // Oejeblikkeligt: der er ingen cache af noegler nogen steder. Et
  // "tilbagekaldt", der virker otte timer endnu, er ikke et tilbagekald.
  assert.equal((await mcp(t.access_token)).status, 401);
  assert.equal((await token({
    grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: k.client_id,
  })).status, 400);

  const efter = (await a.kald('GET', '/api/v1/connections')).data.connections
    .find((c) => c.id === k.client_id);
  assert.equal(efter.active, 0);
  assert.equal(efter.refreshes, 0);
});

test('/oauth/revoke tager et refresh-token og svarer altid 200', async () => {
  const { klient: k, t } = await forbind('Selvafmelding');
  const r = await fetch(`${BASE}/oauth/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: String(new URLSearchParams({ token: t.refresh_token })),
  });
  assert.equal(r.status, 200);
  assert.equal((await token({
    grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: k.client_id,
  })).status, 400);

  // Et ukendt token er allerede tilbagekaldt - og svaret roeber ingenting.
  assert.equal((await fetch(`${BASE}/oauth/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'token=sagur_findesikke',
  })).status, 200);
});

test('OAuth-tokens forurener ikke listen over mine egne adgangsnøgler', async () => {
  await forbind('Claude Desktop');
  const noegler = (await a.kald('GET', '/api/v1/keys')).data.keys;
  assert.ok(noegler.every((n) => n.name !== 'Claude Desktop'),
    'et udstedt OAuth-token hoerer under Connected apps, ikke under Access keys');
});

test('ukendt grant_type og ukendt oauth-sti fejler pænt', async () => {
  assert.equal((await token({ grant_type: 'password', username: 'ejer', password: 'kodeord-1234' })).krop.error,
    'unsupported_grant_type');
  assert.equal((await fetch(`${BASE}/oauth/findes-ikke`)).status, 404);
});

/* ======================================= flerbruger =================== */

test('en forbindelse hører til den, der godkendte den — ikke til installationen', async () => {
  await a.kald('POST', '/api/v1/admin', { allowRegistration: true });
  const b = klient(BASE);
  await b.opret('kollega', 'kodeord-1234');

  // Samme klient-raekke, to brugere: claude.ai registrerer sig paa ny hver
  // gang, men to forskellige installationer kan sagtens ende paa den samme
  // id-raekke i teorien - og gaar de to tokens i ét, river en tilbagekaldelse
  // den forkerte forbindelse med.
  const { krop: k } = await registrer('Delt klient');
  const vA = randomBytes(32).toString('base64url');
  const vB = randomBytes(32).toString('base64url');
  const tA = (await token({
    grant_type: 'authorization_code', code: await hentKode(k.client_id, vA, a.cookie),
    client_id: k.client_id, redirect_uri: REDIRECT, code_verifier: vA,
  })).krop;
  const tB = (await token({
    grant_type: 'authorization_code', code: await hentKode(k.client_id, vB, b.cookie),
    client_id: k.client_id, redirect_uri: REDIRECT, code_verifier: vB,
  })).krop;

  // Hver noegle naar sin EGEN brugers arkiv.
  await a.kald('POST', '/api/v1/notes', { title: 'Ejerens note' });
  const setAfB = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tB.access_token}` },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'search_notes', arguments: { query: 'Ejerens' } },
    }),
  });
  assert.match((await setAfB.json()).result.content[0].text, /Nothing matches/);

  // Og kollegaen kan ikke tilbagekalde ejerens forbindelse.
  assert.equal((await b.kald('DELETE', `/api/v1/connections/${k.client_id}`)).status, 200,
    'kollegaen tilbagekalder SIN egen');
  assert.equal((await mcp(tB.access_token)).status, 401);
  assert.equal((await mcp(tA.access_token)).status, 200, 'ejerens forbindelse skal vaere uroert');
});
