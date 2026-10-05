/*
 * v98 - broen til qlk (kortlinks og QR-koder).
 *
 * Testene koerer mod en FALSK qlk - en lille http-server, der svarer som
 * kontrakten qlk-sagu siger, og som kan bedes om at svare forkert, langsomt
 * eller slet ikke. Den taeller sine kald, saa »aldrig et kald pr. optegning«
 * og »kun egne koder gennem proxyen« kan MAALES frem for at staa i en
 * kommentar.
 *
 * Det, der maales:
 *  1. Forbindelsen: gem -> proev -> rul tilbage, og noeglen ses aldrig igen.
 *  2. Adressen: udgivet -> offentlig, ellers intern - for note og notesbog.
 *  3. Beslutning 3: tilbagekaldt -> intern; udgivet igen -> offentlig, SAMME kode.
 *  4. Synken: ny sti -> ny adresse; 404 fra qlk -> raekken ryddes; udloeb (timejob).
 *  5. Isolation: en anden bruger faar 404 paa link og QR, og proxyen kalder
 *     aldrig qlk for en kode, brugeren ikke selv har.
 *  6. Notens kortlinks: ét kald, cachet.
 *  7. Fangst: adressen renses - og en qlk, der er nede, blokerer intet.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { startServer, klient } from './hjaelp.mjs';

const ROD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KORT = 'http://kort.test';
const NOEGLE = 'qlk_rigtig';

let srv;
let a;
let b;
let falsk;

/* ------------------------------------------------------ den falske qlk */

function falskQlk() {
  const kald = [];
  let tilstand = 'ok';
  let naesteId = 1;
  const links = new Map();            // kode -> link
  const svgFejl = new Set();          // koder, hvis SVG er »farlig«
  // En afbrudt forespoergsel (Sagu gav op paa en langsom qlk) maa ikke blive
  // til en ufanget fejl i testen - det er netop det, testen fremprovokerer.
  const s = createServer((req, res) => { svar(req, res).catch(() => { try { res.destroy(); } catch { /* */ } }); });
  async function svar(req, res) {
    const u = new URL(req.url, 'http://x');
    kald.push(`${req.method} ${u.pathname}${u.search}`);
    const send = (kode, krop) => {
      res.writeHead(kode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(krop));
    };
    if (tilstand === 'nede') { req.destroy(); return; }
    if (tilstand === 'langsom') await new Promise((ok) => setTimeout(ok, 4000));

    // Det offentlige QR-billede - uden noegle, som i den rigtige qlk.
    const q = u.pathname.match(/^\/q\/([^/]+)\.svg$/);
    if (q && req.method === 'GET') {
      const l = links.get(decodeURIComponent(q[1]));
      if (!l) { send(404, { error: 'err.404' }); return; }
      res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8' });
      res.end(svgFejl.has(l.code)
        ? '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
        : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21"><path d="M0 0h7v7H0z"/><!-- ${l.code} --></svg>`);
      return;
    }

    const auth = String(req.headers.authorization || '');
    if (auth !== `Bearer ${NOEGLE}` && auth !== 'Bearer qlk_laese') { send(401, { error: 'err.401' }); return; }
    let krop = {};
    if (req.method === 'POST') {
      let raa = '';
      for await (const bid of req) raa += bid;
      try { krop = JSON.parse(raa || '{}'); } catch { send(400, { error: 'err.400' }); return; }
    }
    const sti = u.pathname.replace(/^\/api\/v1\//, '/api/');
    if (sti === '/api/me' && req.method === 'GET') {
      send(200, { me: { id: 1, username: 'andreas' }, shortBase: KORT, appBase: `http://127.0.0.1:${s.address().port}` });
      return;
    }
    if (sti === '/api/links/sagu' && req.method === 'POST') {
      if (auth === 'Bearer qlk_laese') { send(403, { error: 'err.key_scope' }); return; }
      if (!['note', 'notebook'].includes(krop.kind) || !/^[a-f0-9]{32}$/.test(krop.id || '')
        || !/^https?:\/\//.test(krop.url || '') || !/^https?:\/\//.test(krop.base || '')) {
        send(400, { error: 'err.400' });
        return;
      }
      const fundet = [...links.values()].find((l) => l.sagu.kind === krop.kind && l.sagu.id === krop.id);
      if (fundet) {
        const opdateret = fundet.url !== krop.url;
        fundet.url = krop.url;
        fundet.sagu.base = krop.base;
        send(200, { link: fundet, created: false, updated: opdateret });
        return;
      }
      if (!krop.create) { send(404, { error: 'err.404' }); return; }
      const kode = krop.code || `k${naesteId}`;
      if (links.has(kode)) { send(409, { error: 'err.code_taken' }); return; }
      const l = {
        id: naesteId++, code: kode, url: krop.url, title: krop.title || null,
        clicks: 0, scans: 0, shortUrl: `${KORT}/${kode}`,
        sagu: { kind: krop.kind, id: krop.id, base: krop.base },
      };
      links.set(kode, l);
      send(201, { link: l, created: true, updated: false });
      return;
    }
    if (sti === '/api/links/stats' && req.method === 'GET') {
      const koder = String(u.searchParams.get('codes') || '').split(',').filter(Boolean);
      send(200, { links: koder.filter((k) => links.has(k)).map((k) => {
        const l = links.get(k);
        return { code: k, shortUrl: l.shortUrl, url: l.url, title: l.title, clicks: l.clicks, scans: l.scans };
      }) });
      return;
    }
    if (sti === '/api/clean/check' && req.method === 'POST') {
      // Som qlk's rens: i TEKSTEN, kun de kendte navne, resten uroert.
      const adr = String(krop.url || '');
      const i = adr.indexOf('?');
      if (i < 0) { send(200, { url: adr, removed: [], unwrapped: false }); return; }
      const dele = adr.slice(i + 1).split('&');
      const behold = dele.filter((d) => !/^(utm_[a-z]+|fbclid)=/.test(d));
      const ny = behold.length ? `${adr.slice(0, i)}?${behold.join('&')}` : adr.slice(0, i);
      send(200, { url: ny, removed: dele.filter((d) => !behold.includes(d)).map((d) => d.split('=')[0]), unwrapped: false });
      return;
    }
    send(404, { error: 'err.404' });
  }
  return {
    async start() {
      await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
      return `http://127.0.0.1:${s.address().port}`;
    },
    luk: () => { s.closeAllConnections(); s.close(); },
    kald,
    ryd: () => { kald.length = 0; },
    saet: (t) => { tilstand = t; },
    links,
    svgFejl,
    linkFor: (kind, id) => [...links.values()].find((l) => l.sagu.kind === kind && l.sagu.id === id),
  };
}

/* ------------------------------------------------------------ opsaetning */

before(async () => {
  falsk = falskQlk();
  falsk.url = await falsk.start();
  // Timejobbet hvert halve sekund, saa et udloeb kan proeves uden at vente en time.
  srv = await startServer({ SAGU_QLK_SYNK_MS: '500' });
  a = klient(srv.base);
  await a.opret('ejer', 'kodeord-1234');
  await a.kald('POST', '/api/v1/admin', { allowRegistration: true });
  b = klient(srv.base);
  await b.opret('fremmed', 'kodeord-1234');
});

after(() => { falsk.luk(); srv.stop(); });

const forbind = (k, url, key) => k.kald('POST', '/api/v1/qlk', { url, key });

async function nyNote(k, felter) {
  return (await k.kald('POST', '/api/v1/notes', felter || { title: 'Note', body: 'x' })).data.note;
}

/** Vent paa, at noget bliver sandt - synken sker uden at blive ventet paa. */
async function venter(fn, ms = 3000) {
  const slut = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > slut) return v;
    await new Promise((ok) => setTimeout(ok, 40));
  }
}

/* ========================================================= forbindelsen */

test('en forkert noegle GEMMES ikke - forbindelsen rulles tilbage', async () => {
  const r = await forbind(a, falsk.url, 'qlk_forkert');
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'bad_key');
  const efter = await a.kald('GET', '/api/v1/qlk');
  assert.equal(efter.data.connected, false);
  assert.equal(efter.data.url, '');
});

test('en adresse, der ikke svarer, giver unreachable - ikke en serverfejl', async () => {
  const r = await forbind(a, 'http://127.0.0.1:1', NOEGLE);
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'unreachable');
  assert.equal((await a.kald('GET', '/api/v1/qlk')).data.connected, false);
});

test('den rigtige noegle forbinder - og kortlinkenes vaert gemmes', async () => {
  const r = await forbind(a, falsk.url, NOEGLE);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.connected, true);
  assert.equal(r.data.shortBase, KORT);
  const st = await a.kald('GET', '/api/v1/state');
  assert.deepEqual(st.data.qlk, { connected: true, shortBase: KORT });
});

test('en ny, forkert noegle ruller tilbage til den GAMLE, der virkede', async () => {
  const r = await forbind(a, falsk.url, 'qlk_forkert');
  assert.equal(r.status, 400);
  const g = await a.kald('GET', '/api/v1/qlk');
  assert.equal(g.data.connected, true);
  assert.equal(g.data.shortBase, KORT, 'qlk_short skal ogsaa rulles tilbage');
  // ... og den gamle noegle bruges stadig: et kald gennem broen lykkes.
  const n = await nyNote(a, { title: 'Stadig forbundet', body: 'x' });
  const l = await a.kald('POST', '/api/v1/qlk/link', { kind: 'note', id: n.id });
  assert.equal(l.status, 201, JSON.stringify(l.data));
});

test('noeglen forlader ALDRIG serveren - hverken svar, indstillinger eller eksport', async () => {
  for (const sti of ['/api/v1/qlk', '/api/v1/state', '/api/v1/qlk/links']) {
    const r = await a.kald('GET', sti);
    assert.ok(!JSON.stringify(r.data || {}).includes(NOEGLE), `${sti} laekker noeglen`);
  }
  const res = await fetch(`${srv.base}/api/v1/export?format=json&files=0`, { headers: { Cookie: a.cookie } });
  const tekst = await res.text();
  assert.ok(!tekst.includes(NOEGLE), 'eksporten baerer noeglen');
  assert.ok(!tekst.includes('qlk_key'), 'eksporten naevner noeglen');
});

test('en Sagu-NOEGLE kan ikke saette eller slette forbindelsen - kun en session', async () => {
  const noegle = (await a.kald('POST', '/api/v1/keys', { name: 'k', scope: 'full' })).data.key;
  const h = { Authorization: `Bearer ${noegle}`, 'Content-Type': 'application/json' };
  const p = await fetch(`${srv.base}/api/v1/qlk`, { method: 'POST', headers: h,
    body: JSON.stringify({ url: 'http://127.0.0.1:2', key: 'qlk_x' }) });
  assert.equal(p.status, 401);
  const d = await fetch(`${srv.base}/api/v1/qlk`, { method: 'DELETE', headers: h });
  assert.equal(d.status, 401);
  assert.equal((await a.kald('GET', '/api/v1/qlk')).data.connected, true);
});

test('en for smal qlk-noegle siger wrong_scope - ikke »forkert noegle«', async () => {
  const c = klient(srv.base);
  await c.opret('smal', 'kodeord-1234');
  assert.equal((await forbind(c, falsk.url, 'qlk_laese')).status, 200, 'GET /me kraever kun read');
  const n = await nyNote(c, { title: 'x', body: 'x' });
  const r = await c.kald('POST', '/api/v1/qlk/link', { kind: 'note', id: n.id });
  assert.equal(r.status, 502);
  assert.equal(r.data.error, 'wrong_scope');
});

/* ============================================================ adresserne */

test('en IKKE-udgivet note faar et internt kortlink - <base>/#note-<id>', async () => {
  const n = await nyNote(a, { title: 'Intern side', body: 'x' });
  const r = await a.kald('POST', '/api/v1/qlk/link', { kind: 'note', id: n.id });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.url, `${srv.base}/#note-${n.id}`);
  assert.equal(r.data.public, false);
  assert.match(r.data.shortUrl, /^http:\/\/kort\.test\//);
  assert.equal(r.data.qrUrl, `/api/v1/qlk/qr/${r.data.code}.svg`);
  assert.equal(r.data.editUrl, `${falsk.url}/admin/links/${r.data.code}`);
  assert.equal(falsk.linkFor('note', n.id).sagu.base, srv.base, 'basen sendes uden afsluttende /');
  // Anden gang: det SAMME link, ikke et nyt.
  const igen = await a.kald('POST', '/api/v1/qlk/link', { kind: 'note', id: n.id });
  assert.equal(igen.status, 200);
  assert.equal(igen.data.code, r.data.code);
});

test('en notesbog faar <base>/#notebook-<id>, og eget code respekteres', async () => {
  const bog = (await a.kald('POST', '/api/v1/notebooks', { name: 'Haandbog' })).data.notebook;
  const r = await a.kald('POST', '/api/v1/qlk/link', { kind: 'notebook', id: bog.id, code: 'haandbog' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.code, 'haandbog');
  assert.equal(r.data.url, `${srv.base}/#notebook-${bog.id}`);
  // Optaget kode -> 409 med qlk's mening, ikke en 502.
  const n = await nyNote(a, { title: 'Optaget', body: 'x' });
  const t = await a.kald('POST', '/api/v1/qlk/link', { kind: 'note', id: n.id, code: 'haandbog' });
  assert.equal(t.status, 409);
  assert.equal(t.data.error, 'code_taken');
  // Ugyldig kode naar slet ikke qlk.
  const u = await a.kald('POST', '/api/v1/qlk/link', { kind: 'note', id: n.id, code: '../x' });
  assert.equal(u.status, 400);
});

test('en UDGIVET note faar den offentlige adresse med det samme', async () => {
  const n = await nyNote(a, { title: 'Allerede ude', body: 'x' });
  await a.kald('POST', '/api/v1/shares', { noteId: n.id, slug: 'allerede-ude' });
  const r = await a.kald('POST', '/api/v1/qlk/link', { kind: 'note', id: n.id });
  assert.equal(r.data.url, `${srv.base}/w/allerede-ude`);
  assert.equal(r.data.public, true);
});

test('udgiv -> offentlig, ny sti -> ny adresse, tilbagekald -> intern, udgiv igen -> offentlig, SAMME kode', async () => {
  const n = await nyNote(a, { title: 'Rundt', body: 'x' });
  const lav = await a.kald('POST', '/api/v1/qlk/link', { kind: 'note', id: n.id });
  const kode = lav.data.code;
  const intern = `${srv.base}/#note-${n.id}`;
  assert.equal(falsk.links.get(kode).url, intern);

  const u = await a.kald('POST', '/api/v1/shares', { noteId: n.id, slug: 'rundt' });
  assert.equal(u.status, 200, 'udgivelsen lykkes, uanset qlk');
  assert.equal(await venter(() => falsk.links.get(kode).url === `${srv.base}/w/rundt`), true,
    'kortlinket skal pege paa den offentlige adresse');

  await a.kald('PATCH', `/api/v1/shares/${u.data.share.id}`, { slug: 'rundt-2' });
  assert.equal(await venter(() => falsk.links.get(kode).url === `${srv.base}/w/rundt-2`), true,
    'en ny sti skal give en ny adresse');

  await a.kald('DELETE', `/api/v1/shares/${u.data.share.id}`);
  assert.equal(await venter(() => falsk.links.get(kode).url === intern), true,
    'beslutning 3: tilbagekaldt -> den INTERNE adresse, ikke slettet');

  await a.kald('POST', '/api/v1/shares', { noteId: n.id, slug: 'rundt-3' });
  assert.equal(await venter(() => falsk.links.get(kode).url === `${srv.base}/w/rundt-3`), true);
  const g = await a.kald('GET', `/api/v1/qlk/link?kind=note&id=${n.id}`);
  assert.equal(g.data.link.code, kode, 'den samme kode hele vejen - trykte QR-koder virker');
  assert.equal(g.data.link.public, true);
  assert.equal(falsk.links.size, [...falsk.links.values()].length);
});

test('notesbogens kortlink foelger ogsaa udgivelsen af bogen', async () => {
  const bog = (await a.kald('POST', '/api/v1/notebooks', { name: 'Bog til nettet' })).data.notebook;
  const lav = await a.kald('POST', '/api/v1/qlk/link', { kind: 'notebook', id: bog.id });
  const s = await a.kald('POST', '/api/v1/shares', { notebookId: bog.id, slug: 'bog-til-nettet' });
  assert.equal(s.status, 200);
  assert.equal(await venter(() => falsk.links.get(lav.data.code).url === `${srv.base}/w/bog-til-nettet`), true);
  await a.kald('DELETE', `/api/v1/shares/${s.data.share.id}`);
  assert.equal(await venter(() => falsk.links.get(lav.data.code).url === `${srv.base}/#notebook-${bog.id}`), true);
});

test('en qlk, der er NEDE, faar aldrig udgivelsen til at fejle', async () => {
  const n = await nyNote(a, { title: 'Nede', body: 'x' });
  const lav = await a.kald('POST', '/api/v1/qlk/link', { kind: 'note', id: n.id });
  falsk.saet('nede');
  try {
    const u = await a.kald('POST', '/api/v1/shares', { noteId: n.id, slug: 'nede-side' });
    assert.equal(u.status, 200);
    const d = await a.kald('DELETE', `/api/v1/shares/${u.data.share.id}`);
    assert.equal(d.status, 200);
  } finally {
    falsk.saet('ok');
  }
  // Fejlen er logget som en advarsel - ALDRIG med [fejl], der faar panelet til at ringe.
  await venter(() => srv.fejllogg().includes('[qlk] advarsel'));
  assert.match(srv.fejllogg(), /\[qlk\] advarsel/);
  assert.doesNotMatch(srv.fejllogg(), /\[fejl\][^\n]*qlk/i);
  assert.ok(lav.data.code);
});

test('404 fra qlk under synken -> Sagus raekke ryddes', async () => {
  const n = await nyNote(a, { title: 'Forsvinder', body: 'x' });
  const lav = await a.kald('POST', '/api/v1/qlk/link', { kind: 'note', id: n.id });
  falsk.links.delete(lav.data.code);            // slettet i qlk
  await a.kald('POST', '/api/v1/shares', { noteId: n.id, slug: 'forsvinder' });
  assert.equal(await venter(async () => (await a.kald('GET', `/api/v1/qlk/link?kind=note&id=${n.id}`))
    .data.link === null), true, 'raekken skal vaere vaek');
  assert.equal(falsk.linkFor('note', n.id), undefined, 'synken maa ALDRIG oprette et nyt link');
});

test('timejobbet: en udgivelse, der UDLOEBER, flytter kortlinket til den interne adresse', async () => {
  const n = await nyNote(a, { title: 'Udloeber', body: 'x' });
  const s = await a.kald('POST', '/api/v1/shares', { noteId: n.id, slug: 'udloeber' });
  const lav = await a.kald('POST', '/api/v1/qlk/link', { kind: 'note', id: n.id });
  assert.equal(lav.data.url, `${srv.base}/w/udloeber`);
  // Uret flyttes i databasen - en udloebsdato i fortiden kan API'et ikke saette.
  const d = new DatabaseSync(path.join(srv.dataDir, 'sagu.db'));
  try {
    d.prepare('UPDATE shares SET expires_at = ? WHERE id = ?').run(Math.floor(Date.now() / 1000) - 10, s.data.share.id);
  } finally { d.close(); }
  assert.equal(await venter(() => falsk.links.get(lav.data.code).url === `${srv.base}/#note-${n.id}`, 5000), true);
});

/* ============================================================== isolation */

test('isolation: bruger B faar 404 paa A\'s note og bog - og qlk kaldes ikke', async () => {
  await forbind(b, falsk.url, NOEGLE);
  const n = await nyNote(a, { title: 'Kun A', body: 'x' });
  const bog = (await a.kald('POST', '/api/v1/notebooks', { name: 'Kun A' })).data.notebook;
  await a.kald('POST', '/api/v1/qlk/link', { kind: 'note', id: n.id });
  falsk.ryd();
  for (const [kind, id] of [['note', n.id], ['notebook', bog.id]]) {
    const p = await b.kald('POST', '/api/v1/qlk/link', { kind, id });
    assert.equal(p.status, 404, `POST ${kind}`);
    const g = await b.kald('GET', `/api/v1/qlk/link?kind=${kind}&id=${id}`);
    assert.equal(g.status, 404, `GET ${kind}`);
  }
  assert.deepEqual(falsk.kald, [], 'en fremmed ref maa ikke naa qlk');
});

test('isolation: en DELT note giver stadig 404 - kortlinket er ejerens beslutning', async () => {
  const n = await nyNote(a, { title: 'Delt', body: 'x' });
  const del = await a.kald('POST', `/api/v1/notes/${n.id}/access`, { username: 'fremmed', level: 'write' });
  assert.ok([200, 201].includes(del.status), JSON.stringify(del.data));
  assert.equal((await b.kald('GET', `/api/v1/notes/${n.id}`)).status, 200, 'B kan laese noten');
  assert.equal((await b.kald('POST', '/api/v1/qlk/link', { kind: 'note', id: n.id })).status, 404);
});

test('QR-proxyen: egne koder virker og caches; fremmede og ukendte giver 404 UDEN et kald', async () => {
  const n = await nyNote(a, { title: 'QR', body: 'x' });
  const lav = await a.kald('POST', '/api/v1/qlk/link', { kind: 'note', id: n.id });
  const sti = lav.data.qrUrl;
  falsk.ryd();
  const r1 = await fetch(srv.base + sti, { headers: { Cookie: a.cookie } });
  assert.equal(r1.status, 200);
  assert.match(r1.headers.get('content-type'), /^image\/svg\+xml/);
  assert.match(r1.headers.get('content-security-policy'), /sandbox/);
  assert.match(await r1.text(), /^<svg/);
  const r2 = await fetch(srv.base + sti, { headers: { Cookie: a.cookie } });
  assert.equal(r2.status, 200);
  assert.equal(falsk.kald.filter((k) => k.startsWith('GET /q/')).length, 1, 'anden gang fra cachen');

  falsk.ryd();
  // B har ingen raekke med den kode - ogsaa selv om qlk kender den.
  assert.equal((await fetch(srv.base + sti, { headers: { Cookie: b.cookie } })).status, 404);
  // En kode, INGEN har i Sagu - proxyen maa ikke vaere en aaben vej ind i qlk.
  falsk.links.set('fremmedkode', { code: 'fremmedkode', url: 'http://x', sagu: { kind: 'note', id: 'f'.repeat(32) } });
  assert.equal((await fetch(`${srv.base}/api/v1/qlk/qr/fremmedkode.svg`, { headers: { Cookie: a.cookie } })).status, 404);
  assert.equal((await fetch(`${srv.base}/api/v1/qlk/qr/..%2Fx.svg`, { headers: { Cookie: a.cookie } })).status, 404);
  // Uden login: 401.
  assert.equal((await fetch(srv.base + sti)).status, 401);
  assert.deepEqual(falsk.kald, [], 'ingen af dem maa have naaet qlk');
});

test('QR-proxyen afviser et billede, der kan baere kode', async () => {
  const n = await nyNote(a, { title: 'Ond QR', body: 'x' });
  const lav = await a.kald('POST', '/api/v1/qlk/link', { kind: 'note', id: n.id });
  falsk.svgFejl.add(lav.data.code);
  const r = await fetch(srv.base + lav.data.qrUrl, { headers: { Cookie: a.cookie } });
  assert.equal(r.status, 502);
});

/* ========================================================= notens kortlinks */

test('»Short links in this note«: tal for kortlinkene i teksten - ét kald, cachet', async () => {
  const n1 = await nyNote(a, { title: 'Kilde 1', body: 'x' });
  const n2 = await nyNote(a, { title: 'Kilde 2', body: 'x' });
  const k1 = (await a.kald('POST', '/api/v1/qlk/link', { kind: 'note', id: n1.id })).data.code;
  const k2 = (await a.kald('POST', '/api/v1/qlk/link', { kind: 'note', id: n2.id })).data.code;
  falsk.links.get(k1).clicks = 7;
  falsk.links.get(k2).scans = 3;
  const n = await nyNote(a, {
    title: 'Med kortlinks',
    body: `Se ${KORT}/${k2} og [her](${KORT}/${k1}).\n\nOg ${KORT}/ukendt plus https://andet.test/${k1}`,
  });
  falsk.ryd();
  const r = await a.kald('GET', `/api/v1/notes/${n.id}/qlk`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.links.map((l) => [l.code, l.clicks, l.scans]), [[k2, 0, 3], [k1, 7, 0]],
    'i tekstens raekkefoelge, kun brugerens egne');
  assert.equal(falsk.kald.length, 1, 'ÉT kald for alle koder');
  const igen = await a.kald('GET', `/api/v1/notes/${n.id}/qlk`);
  assert.equal(igen.data.links.length, 2);
  assert.equal(falsk.kald.length, 1, 'anden gang fra cachen');

  // En note uden kortlinks koster intet kald.
  const tom = await nyNote(a, { title: 'Ingen', body: 'https://andet.test/x' });
  falsk.ryd();
  assert.deepEqual((await a.kald('GET', `/api/v1/notes/${tom.id}/qlk`)).data.links, []);
  assert.deepEqual(falsk.kald, []);

  // En fremmed faar 404 - notens egen adgangsregel.
  assert.equal((await b.kald('GET', `/api/v1/notes/${n.id}/qlk`)).status, 404);
});

test('udgivelseslisten: kortlink og tal i ÉT kald', async () => {
  falsk.ryd();
  const r = await a.kald('GET', '/api/v1/qlk/links');
  assert.equal(r.status, 200);
  assert.ok(r.data.links.length >= 3);
  assert.ok(r.data.links.every((l) => l.shortUrl && l.qrUrl), 'hver raekke har adresse og QR');
  assert.ok(falsk.kald.filter((k) => k.startsWith('GET /api/v1/links/stats')).length <= 1);
});

/* ================================================================= fangst */

test('fangst: den fangede adresse renses for sporing - kun den, og kun ordret', async () => {
  const kilde = 'https://eksempel.test/artikel?utm_source=nyhedsbrev&id=7&fbclid=abc';
  const tekst = `Artikel\n\n[Artikel](${kilde})\n\nSe ogsaa https://andet.test/?utm_source=x`;
  const r = await a.kald('POST', '/api/v1/capture', { text: tekst, source: kilde });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const n = (await a.kald('GET', `/api/v1/notes/${r.data.note.id}`)).data.note;
  assert.ok(n.body.includes('(https://eksempel.test/artikel?id=7)'), n.body);
  assert.ok(n.body.includes('https://andet.test/?utm_source=x'), 'andre links er sidens indhold');

  // En bar adresse er hele teksten - den renses ogsaa.
  const bar = await a.kald('POST', '/api/v1/capture', { text: 'https://eksempel.test/?utm_medium=mail' });
  const nb = (await a.kald('GET', `/api/v1/notes/${bar.data.note.id}`)).data.note;
  const alt = `${nb.title}\n${nb.body}`;
  assert.ok(alt.includes('https://eksempel.test/') && !alt.includes('utm_medium'), alt);
});

test('fangst: en qlk, der er nede eller langsom, blokerer ikke - adressen gemmes uaendret', async () => {
  const kilde = 'https://eksempel.test/nede?utm_source=x';
  for (const t of ['nede', 'langsom']) {
    falsk.saet(t);
    try {
      const t0 = Date.now();
      const r = await a.kald('POST', '/api/v1/capture', { text: `Nede\n\n${kilde}`, source: kilde });
      assert.equal(r.status, 200, `${t}: ${JSON.stringify(r.data)}`);
      assert.ok(Date.now() - t0 < 3800, `${t}: fangsten ventede ${Date.now() - t0} ms`);
      const n = (await a.kald('GET', `/api/v1/notes/${r.data.note.id}`)).data.note;
      assert.ok(n.body.includes(kilde), `${t}: adressen skal staa uaendret`);
    } finally {
      falsk.saet('ok');
    }
  }
});

test('fangst uden forbindelse kalder aldrig qlk', async () => {
  const c = klient(srv.base);
  await c.opret('uforbundet', 'kodeord-1234');
  falsk.ryd();
  const kilde = 'https://eksempel.test/?utm_source=x';
  const r = await c.kald('POST', '/api/v1/capture', { text: kilde, source: kilde });
  assert.equal(r.status, 200);
  assert.deepEqual(falsk.kald, []);
});

/* =========================================================== frakobling */

test('frakobling rydder adresse og noegle - kortlinkene bliver staaende', async () => {
  const c = klient(srv.base);
  await c.opret('frakobler', 'kodeord-1234');
  await forbind(c, falsk.url, NOEGLE);
  const n = await nyNote(c, { title: 'Bliver', body: 'x' });
  await c.kald('POST', '/api/v1/qlk/link', { kind: 'note', id: n.id });
  const d = await c.kald('DELETE', '/api/v1/qlk');
  assert.equal(d.status, 200);
  const g = await c.kald('GET', '/api/v1/qlk');
  assert.equal(g.data.connected, false);
  assert.equal(g.data.links, 1, 'raekken staar der stadig');
  const p = await c.kald('POST', '/api/v1/qlk/link', { kind: 'note', id: n.id });
  assert.equal(p.status, 409);
  assert.equal(p.data.error, 'not_connected');
});

/* ======================================================== #notebook-<id> */

test('#notebook-<id> i adressen viser notesbogen (aabnFraAdressen, hentet ud af kilden)', () => {
  const kilde = readFileSync(path.join(ROD, 'app', 'parts', 'p1_core.js'), 'utf8');
  const m = kilde.match(/function aabnFraAdressen\(\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'funktionen findes');
  const id = 'a'.repeat(32);
  const kaldt = [];
  const ctx = {
    state: { user: { id: 'u' }, notebooks: [{ id }] },
    location: { hash: `#notebook-${id}`, pathname: '/', search: '' },
    history: { replaceState: (...x) => kaldt.push(['replace', x[2]]) },
    visBogITraeet: (x) => kaldt.push(['bog', x]),
    aabnNoteFraAdresseIFane: (x) => kaldt.push(['note', x]),
  };
  vm.runInNewContext(`${m[0]}; aabnFraAdressen();`, ctx);
  assert.deepEqual(kaldt, [['replace', '/'], ['bog', id]]);

  // En bog, brugeren ikke har, aabner intet.
  kaldt.length = 0;
  ctx.state.notebooks = [];
  vm.runInNewContext(`${m[0]}; aabnFraAdressen();`, ctx);
  assert.deepEqual(kaldt, []);

  // #note-<id> virker som foer.
  ctx.location.hash = `#note-${id}`;
  vm.runInNewContext(`${m[0]}; aabnFraAdressen();`, ctx);
  assert.deepEqual(kaldt, [['note', id]]);
});
