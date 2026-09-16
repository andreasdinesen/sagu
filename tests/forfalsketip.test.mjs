/*
 * Klient-IP'en mod den RIGTIGE server: en forfalsket vaerdi forrest i
 * X-Forwarded-For maa ikke give en ny spand.
 *
 * Serveren koerer lokalt, saa socket-adressen er loopback - praecis som bag
 * tunnelen. Hvert kald sender »<ny opdigtet>, 203.0.113.50«: den forreste
 * vaelger klienten, den bageste har proxyen sat. Med den gamle regel (foerste
 * vaerdi) fik hvert forsoeg sin egen spand, og login-spaerringen ramte aldrig.
 *
 * 203.0.113.50 ligger uden for de adresser, `gaest()` i hjaelp.mjs deler ud,
 * og serveren er testens egen - spaerren rammer ingen anden test.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, klient } from './hjaelp.mjs';

const RIGTIG = '203.0.113.50';
let srv;

before(async () => {
  srv = await startServer();
  await klient(srv.base).opret('alice', 'kodeord-1234');
});

after(() => srv.stop());

test('login spaerres, selv om hvert forsoeg sender en ny opdigtet IP', async () => {
  const koder = [];
  for (let i = 0; i < 16; i++) {
    const r = await fetch(srv.base + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `198.51.100.${i + 1}, ${RIGTIG}` },
      body: JSON.stringify({ username: 'alice', password: 'forkert-kodeord' }),
    });
    koder.push(r.status);
    await r.arrayBuffer();
  }
  assert.deepEqual(koder.slice(0, 15), Array(15).fill(401));
  assert.equal(koder[15], 429);
});

test('[sikkerhed]-linjerne skriver den rigtige adresse - aldrig den opdigtede', () => {
  // logSecurity skriver paa stderr.
  const linjer = srv.fejllogg().split('\n').filter((l) => l.includes('[sikkerhed]'));
  assert.ok(linjer.some((l) => l.includes('login-fejl')), 'ingen login-fejl-linje');
  assert.ok(linjer.some((l) => l.includes('login-spaerret')), 'ingen spaerre-linje');
  // Samme moenster som panelets events.
  const ips = new Set(linjer.map((l) => (l.match(/ip=(\S+)/) || [])[1]));
  assert.deepEqual([...ips], [RIGTIG]);
});
