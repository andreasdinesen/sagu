/*
 * AI-assistenten (»Ask«, 2026-10-08) - mod en FALSK Claude, ChatGPT og DeepSeek. Intet net.
 *
 * Det, der maales:
 *  1. Forbindelsen: noeglen proeves foer den gemmes, og den ses aldrig igen (svar og log).
 *  2. Laese-vaerktoejer (search_notes) koeres med det samme - og kun i brugerens EGNE noter.
 *  3. Noget, der aendrer (create_note), venter paa et ja; et nej koerer intet.
 *  4. DeepSeek: egen adresse, deepseek-chat som standard, taenkningen kun med i samme spoergsmaal.
 *  5. Kun med session: en API-noegle kan ikke bruge en brugers AI-kredit.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startServer, klient } from './hjaelp.mjs';

const NOEGLE = 'sk-ant-hemmelig-123';
const kald = [];
const svar = { anthropic: [], openai: [], deepseek: [] };
let falsk; let srv; let a; let b; let noteA;

before(async () => {
  falsk = createServer((req, res) => {
    let x = '';
    req.on('data', (d) => { x += d; });
    req.on('end', () => {
      const krop = x ? JSON.parse(x) : null;
      kald.push({ sti: req.url, hoveder: req.headers, krop });
      const json = (st, d) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(d)); };
      if (req.url.startsWith('/v1/models')) return req.headers['x-api-key'] === NOEGLE ? json(200, { data: [] }) : json(401, { error: { message: 'invalid x-api-key' } });
      if (req.url === '/v1/messages') return json(200, svar.anthropic.shift());
      if (req.url === '/oai/v1/models') return req.headers.authorization === 'Bearer sk-oai' ? json(200, { data: [] }) : json(401, {});
      if (req.url === '/oai/v1/chat/completions') return json(200, svar.openai.shift());
      if (req.url === '/ds/models') return req.headers.authorization === 'Bearer sk-ds' ? json(200, { data: [] }) : json(401, {});
      if (req.url === '/ds/chat/completions') return json(200, svar.deepseek.shift());
      return json(404, {});
    });
  });
  await new Promise((ok) => falsk.listen(0, '127.0.0.1', ok));
  const p = falsk.address().port;
  srv = await startServer({
    SAGU_ANTHROPIC_URL: `http://127.0.0.1:${p}`, SAGU_OPENAI_URL: `http://127.0.0.1:${p}/oai/v1`, SAGU_DEEPSEEK_URL: `http://127.0.0.1:${p}/ds`,
  });
  a = klient(srv.base); b = klient(srv.base);
  await a.opret('andreas', 'kodeord-1234');
  await a.kald('POST', '/api/v1/admin', { allowRegistration: true });   // lukket som standard efter den foerste
  await b.opret('bo', 'kodeord-1234');
  noteA = (await a.kald('POST', '/api/v1/notes', { title: 'VPN-opsaetning', body: 'Forbind til vpn.firma.dk med FortiClient.' })).data.note;
  await b.kald('POST', '/api/v1/notes', { title: 'Bos VPN-hemmelighed', body: 'Kun for bo: vpn' });
});
after(async () => {
  srv.stop();
  falsk.closeAllConnections();
  await new Promise((ok) => falsk.close(ok));
});

test('forbind: noeglen proeves foerst, gemmes, og ses aldrig igen', async () => {
  assert.equal((await a.kald('GET', '/api/v1/assistant')).data.assistant.connected, false);
  const forkert = await a.kald('POST', '/api/v1/assistant', { provider: 'anthropic', key: 'sk-ant-forkert' });
  assert.equal(forkert.status, 502);
  assert.equal(forkert.data.error, 'bad_key');
  assert.equal((await a.kald('GET', '/api/v1/assistant')).data.assistant.connected, false);
  const ok = await a.kald('POST', '/api/v1/assistant', { provider: 'anthropic', key: NOEGLE });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.data.assistant, { connected: true, provider: 'anthropic', model: 'claude-opus-5-5', base: null });
  assert.doesNotMatch(JSON.stringify(ok.data), /hemmelig/);
  // Kun en administrator maa pege serveren mod en adresse (bo er ikke admin).
  assert.equal((await b.kald('POST', '/api/v1/assistant', { provider: 'compatible', base: 'http://127.0.0.1:1/v1', model: 'x' })).data.error, 'admin_only');
});

test('soeg: laese-vaerktoejet koeres med det samme - og kun i egne noter', async () => {
  svar.anthropic.push(
    { stop_reason: 'tool_use', content: [{ type: 'thinking', thinking: 'hmm', signature: 'x' }, { type: 'tool_use', id: 't1', name: 'search_notes', input: { query: 'vpn' } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: `Se [VPN-opsaetning](#note-${noteA.id}).` }] },
  );
  const r = await a.kald('POST', '/api/v1/assistant/chat', { message: 'hvordan forbinder jeg til vpn?' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.parts[0], { type: 'tool', name: 'search_notes', input: { query: 'vpn' }, error: false });
  assert.match(r.data.parts.at(-1).text, new RegExp(`#note-${noteA.id}`));
  const sidste = kald.filter((k) => k.sti === '/v1/messages').at(-1).krop;
  assert.match(sidste.system, /#note-<id>/);
  // Taenkningen tilbage uaendret, og vaerktoejssvaret med andreas' note - aldrig bos.
  assert.equal(sidste.messages[1].content[0].type, 'thinking');
  const resultat = sidste.messages[2].content[0];
  assert.equal(resultat.type, 'tool_result');
  assert.match(resultat.content, /VPN-opsaetning/);
  assert.doesNotMatch(resultat.content, /Bos VPN/);
  // create_upload_link er ikke med (en curl-kommando i et chatpanel).
  assert.ok(!sidste.tools.some((t) => t.name === 'create_upload_link'));
});

test('aendringer venter paa et ja - et nej koerer intet', async () => {
  svar.anthropic.push(
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'create_note', input: { text: 'Ny note fra AI\nindhold' } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Okay, ikke lavet.' }] },
  );
  const r = await a.kald('POST', '/api/v1/assistant/chat', { message: 'lav en note' });
  assert.deepEqual(r.data.pending, [{ id: 't2', name: 'create_note', input: { text: 'Ny note fra AI\nindhold' } }]);
  const nej = await a.kald('POST', '/api/v1/assistant/approve', { approve: [] });
  assert.equal(nej.data.parts[0].declined, true);
  const sendt = kald.filter((k) => k.sti === '/v1/messages').at(-1).krop.messages.at(-1).content[0];
  assert.equal(sendt.is_error, true);
  const soeg = await a.kald('GET', '/api/v1/search?q=AI');
  assert.doesNotMatch(JSON.stringify(soeg.data || {}), /Ny note fra AI/);

  svar.anthropic.push(
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't3', name: 'create_note', input: { text: 'Ny note fra AI\nindhold' } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Lavet.' }] },
  );
  await a.kald('POST', '/api/v1/assistant/chat', { message: 'lav den alligevel' });
  const ja = await a.kald('POST', '/api/v1/assistant/approve', { approve: ['t3'] });
  assert.equal(ja.data.parts[0].done, true);
  assert.equal(ja.data.parts[0].error, false);
  assert.match(kald.filter((k) => k.sti === '/v1/messages').at(-1).krop.messages.at(-1).content[0].content, /Created: Ny note fra AI/);
});

test('DeepSeek: egen adresse, deepseek-chat som standard, taenkningen kun i samme spoergsmaal', async () => {
  const f = await b.kald('POST', '/api/v1/assistant', { provider: 'deepseek', key: 'sk-ds' });
  assert.equal(f.status, 200);
  assert.equal(f.data.assistant.model, 'deepseek-chat');
  svar.deepseek.push(
    { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: '', reasoning_content: 'Jeg soeger.', tool_calls: [{ id: 'd1', type: 'function', function: { name: 'search_notes', arguments: '{"query":"vpn"}' } }] } }] },
    { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Fundet.', reasoning_content: 'Faerdig.' } }] },
    { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '<think>x</think>Hej igen.' } }] },
  );
  const r = await b.kald('POST', '/api/v1/assistant/chat', { message: 'find vpn' });
  assert.deepEqual(r.data.parts.at(-1), { type: 'text', text: 'Fundet.' });
  const ds = kald.filter((k) => k.sti === '/ds/chat/completions');
  assert.equal(ds.at(-1).hoveder.authorization, 'Bearer sk-ds');
  assert.equal(ds.at(-1).krop.messages[0].role, 'system');
  assert.equal(ds.at(-1).krop.messages.find((m) => m.tool_calls).reasoning_content, 'Jeg soeger.');
  const tool = ds.at(-1).krop.messages.at(-1);
  assert.equal(tool.role, 'tool');
  assert.match(tool.content, /Bos VPN/);
  assert.doesNotMatch(tool.content, /VPN-opsaetning/, 'kun egne noter');
  const r2 = await b.kald('POST', '/api/v1/assistant/chat', { message: 'tak' });
  assert.equal(r2.data.parts.at(-1).text, 'Hej igen.');
  assert.ok(kald.filter((k) => k.sti === '/ds/chat/completions').at(-1).krop.messages.every((m) => !m.reasoning_content));
});

test('kun med session: en API-noegle kan ikke bruge assistenten', async () => {
  const noegle = (await a.kald('POST', '/api/v1/keys', { name: 'fuld', scope: 'full' })).data.key;
  const r = await fetch(`${srv.base}/api/v1/assistant/chat`, {
    method: 'POST', headers: { Authorization: `Bearer ${noegle}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'hej' }),
  });
  assert.equal(r.status, 401);
});

test('afbryd fjerner noeglen - og den staar aldrig i loggen', async () => {
  assert.equal((await b.kald('DELETE', '/api/v1/assistant')).data.assistant.connected, false);
  assert.equal((await b.kald('POST', '/api/v1/assistant/chat', { message: 'hej' })).data.error, 'not_connected');
  assert.doesNotMatch(srv.logg() + srv.fejllogg(), /hemmelig-123|sk-ds/);
});
