/*
 * Den offentlige adresse.
 *
 * Sagu kan naas paa flere vaertsnavne paa én gang (Andreas peger baade
 * `sagu.<domaene>` og et kortere domaene paa den samme container). Uden et
 * valg svarer hver flade med den vaert, DEN blev kaldt paa - og saa hedder et
 * kopieret link noget forskelligt, alt efter hvor man selv sad, mens en
 * soegemaskine ser den samme side som to sider.
 *
 * Filen har sin EGEN server, fordi indstillingen er global (`scope '*'`): sat
 * i en delt server ville den sive ind i alle de andre filers forventninger.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, klient, gaest } from './hjaelp.mjs';

const OFFENTLIG = 'https://sagu.eksempel.dk';

let srv;
let a;
let share;

before(async () => {
  srv = await startServer();
  a = klient(srv.base);
  await a.opret('ejer', 'kodeord-1234');
  const n = (await a.kald('POST', '/api/v1/notes',
    { title: 'Haandbog', body: '# Haandbog\n\ntekst' })).data.note;
  await a.kald('POST', '/api/v1/notes', { title: 'Underside', body: 'x', parentId: n.id });
  share = (await a.kald('POST', '/api/v1/shares',
    { noteId: n.id, slug: 'haandbog', allowIndex: true })).data.share;
});

after(() => srv.stop());

async function saetAdresse(v) {
  return a.kald('POST', '/api/v1/admin', { publicUrl: v });
}

test('uden en indstilling er alt som foer: kaldets egen vaert', async () => {
  assert.equal((await a.kald('GET', '/api/v1/state')).data.publicUrl, '');
  const g = gaest(srv.base);
  const side = await g.hent(`${share.path}/`);
  assert.ok(!/rel="canonical"/.test(side.tekst) || side.tekst.includes(srv.base),
    'en kanonisk adresse skal pege paa den vaert, kaldet kom paa');
  const feed = await g.hent(`${share.path}/feed`);
  assert.ok(feed.tekst.includes(srv.base), 'feedets absolutte adresser er kaldets egne');
});

test('adressen kan saettes, laeses og ryddes igen', async () => {
  const r = await saetAdresse(OFFENTLIG);
  assert.equal(r.status, 200);
  assert.equal(r.data.publicUrl, OFFENTLIG);
  assert.equal((await a.kald('GET', '/api/v1/state')).data.publicUrl, OFFENTLIG);

  // En skraastreg til sidst er den samme adresse - ikke en anden.
  assert.equal((await saetAdresse(`${OFFENTLIG}/`)).data.publicUrl, OFFENTLIG);

  assert.equal((await saetAdresse('')).data.publicUrl, '', 'tom rydder den');
  await saetAdresse(OFFENTLIG);
});

test('kun en OPRINDELSE godtages - ikke en sti, en query eller noget andet', async () => {
  for (const daarlig of [
    'https://sagu.eksempel.dk/w',        // en sti ville lande midt i alle adresser
    'https://sagu.eksempel.dk/?x=1',
    'https://sagu.eksempel.dk/#top',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'sagu.eksempel.dk',                  // uden protokol er det ikke en adresse
    'https://bruger:kode@sagu.eksempel.dk',
    'ikke en adresse',
  ]) {
    const r = await saetAdresse(daarlig);
    assert.equal(r.status, 400, `${daarlig} skulle vaere afvist`);
    assert.equal(r.data.error, 'bad_public_url');
  }
  // Og den gamle vaerdi staar uroert efter et afvist forsoeg.
  assert.equal((await a.kald('GET', '/api/v1/state')).data.publicUrl, OFFENTLIG);
});

test('de offentlige sider faar ÉN kanonisk adresse - ogsaa dybt nede', async () => {
  const g = gaest(srv.base);
  const forside = await g.hent(`${share.path}/`);
  assert.match(forside.tekst, new RegExp(`<link rel="canonical" href="${OFFENTLIG}/w/haandbog/"`));
  assert.match(forside.tekst, new RegExp(`<meta property="og:url" content="${OFFENTLIG}/w/haandbog/"`));
  // Forsiden er IKKE en underside: dens kanoniske adresse maa ikke baere
  // rodnotens eget slug. `dybde` hoerer til raekken, ikke til noten, og det
  // var praecis dér, den foerste udgave tog fejl.
  assert.ok(!/canonical" href="[^"]*\/haandbog\/haandbog"/.test(forside.tekst));

  const under = await g.hent(`${share.path}/underside`);
  assert.match(under.tekst, new RegExp(`<link rel="canonical" href="${OFFENTLIG}/w/haandbog/underside"`));
});

test('feedets absolutte adresser bruger den offentlige vaert', async () => {
  const g = gaest(srv.base);
  const feed = await g.hent(`${share.path}/feed`);
  assert.equal(feed.status, 200);
  assert.ok(feed.tekst.includes(`${OFFENTLIG}/w/haandbog`), 'feedet skal pege paa den offentlige adresse');
  assert.ok(!feed.tekst.includes(srv.base), 'og ikke paa den, kaldet tilfaeldigvis kom paa');
});

test('adressen bruges ALDRIG til en omdirigering', async () => {
  /*
   * Det farlige ved et adressefelt er, at det kan blive til en aaben
   * viderestilling. Derfor bruges det kun til at VISE og til canonical -
   * hver eneste omdirigering i wikien er relativ, og `next` er hvidlistet til
   * udgivelsen selv (doda F12).
   */
  const laast = (await a.kald('POST', '/api/v1/shares', {
    noteId: (await a.kald('POST', '/api/v1/notes', { title: 'Laast', body: 'x' })).data.note.id,
    slug: 'laast-adresse', password: 'aabnesesam',
  })).data.share;
  const g = gaest(srv.base);

  const dyb = await g.hent(`${laast.path}/en-side`);
  const hen = dyb.headers.get('location') || '';
  assert.ok(hen.startsWith('/w/laast-adresse/'), `omdirigeringen skal vaere relativ, var: ${hen}`);
  assert.ok(!hen.includes('eksempel.dk'), 'den offentlige adresse maa ikke ind i en omdirigering');

  // Og et `next`, der peger ud af huset, skal ignoreres.
  const svar = await g.post(`${laast.path}/password`,
    { password: 'aabnesesam', next: 'https://ondt.eksempel/' });
  assert.ok(!(svar.headers.get('location') || '').includes('ondt.eksempel'));
});

test('kun en ADMIN kan saette adressen', async () => {
  await a.kald('POST', '/api/v1/admin', { allowRegistration: true });
  const b = klient(srv.base);
  await b.opret('anden', 'kodeord-1234');
  const r = await b.kald('POST', '/api/v1/admin', { publicUrl: 'https://kapret.eksempel.dk' });
  assert.equal(r.status, 403);
  assert.equal((await a.kald('GET', '/api/v1/state')).data.publicUrl, OFFENTLIG, 'uroert');

  // En noegle maa det heller ikke - admin-ruterne staar uden for delingen.
  const noegle = (await a.kald('POST', '/api/v1/keys', { name: 'k', scope: 'full' })).data.key;
  const medNoegle = await a.kald('POST', '/api/v1/admin', { publicUrl: 'https://kapret.eksempel.dk' },
    { udenCookie: true, headers: { Authorization: `Bearer ${noegle}` } });
  assert.equal(medNoegle.status, 401);
});
