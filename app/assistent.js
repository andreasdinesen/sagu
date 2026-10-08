'use strict';
/*
 * Sagu - AI-assistenten (»Ask«). Portet fra qlk (v26/v30), samme form.
 *
 * Andreas, 2026-10-08: »en AI assistant som kan hjælpe med at finde ting i
 * noterne m.m. Den skal kunne give direkte links m.m. den skal kunne benytte
 * claude, chatgpt og deepseek«.
 *
 *  - Brugerens EGEN noegle (Claude, ChatGPT eller DeepSeek). Den gemmes som en
 *    hemmelig indstilling (`ai_key`, HEMMELIGE_SETTINGS) og forlader aldrig
 *    serveren - ikke i et svar, ikke i loggen.
 *  - Vaerktoejerne er MCP-serverens (app/mcp.js) - samme vej ind i dataene, samme
 *    `user_id`-filter. Laese-vaerktoejer koeres med det samme; alt andet
 *    (opret, tilfoej, ret, kommenter, udgiv) vises som et kort, der skal godkendes.
 *  - Direkte links: modellen skriver noter som `[Titel](#note-<id>)`, og panelet
 *    aabner dem i appen. Adresser i noterne bliver almindelige links.
 *  - Samtalen er tilfoej-kun: modellens svar laegges tilbage uaendret (ogsaa
 *    Claudes taenkeblokke), og alle vaerktoejssvar fra én runde kommer samlet.
 *  - Raa fetch, ingen SDK - nul npm-pakker.
 *
 * Udbydere:
 *   anthropic   Claude, POST /v1/messages (standard claude-opus-5-5)
 *   openai      ChatGPT, POST /v1/chat/completions (standard gpt-5)
 *   deepseek    DeepSeek, OpenAI-kompatibel paa https://api.deepseek.com (standard
 *               deepseek-chat). `reasoning_content` laegges tilbage paa vaerktoejskald i
 *               SAMME spoergsmaal og fjernes, naar et nyt begynder.
 *   compatible  en OpenAI-kompatibel server (LM Studio, Ollama ...) - kun for en
 *               administrator: SERVEREN henter adressen, og ellers kunne en bruger
 *               kigge ind i hjemmenettet gennem Sagu.
 *
 * Kaster aldrig mod kalderen: { ok, ... } eller { ok: false, kode, besked }.
 */

const ANTHROPIC = process.env.SAGU_ANTHROPIC_URL || 'https://api.anthropic.com';
const OPENAI = process.env.SAGU_OPENAI_URL || 'https://api.openai.com/v1';
const DEEPSEEK = process.env.SAGU_DEEPSEEK_URL || 'https://api.deepseek.com';
const UDBYDERE = ['anthropic', 'openai', 'deepseek', 'compatible'];
const STANDARDMODEL = { anthropic: 'claude-opus-5-5', openai: 'gpt-5', deepseek: 'deepseek-chat', compatible: '' };
/* Modeller, der tager imod Claudes server-side fallback. */
const MED_FALLBACK = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);
/* create_upload_link giver en curl-kommando - meningsloes i et chatpanel. */
const UDEN = new Set(['create_upload_link']);
const MAKS_RUNDER = 10;
const TIMEOUT_MS = 120_000;
const SAMTALE_LEVETID = 3 * 3600e3;

function opret(srv) {
  /* srv = { vaerktoejer: () => [...], getSetting, setSetting, log(m) } */
  const samtaler = new Map();   // userId -> { provider, beskeder, venter, sidst, base }
  setInterval(() => {
    const graense = Date.now() - SAMTALE_LEVETID;
    for (const [k, v] of samtaler) if (v.sidst < graense) samtaler.delete(k);
  }, 600e3).unref();

  function opsaetning(uid, admin) {
    const provider = srv.getSetting(uid, 'ai_provider', '') || null;
    const key = srv.getSetting(uid, 'ai_key', '') || '';
    return {
      provider, key,
      model: srv.getSetting(uid, 'ai_model', '') || (provider ? STANDARDMODEL[provider] : ''),
      base: srv.getSetting(uid, 'ai_base', '') || '',
      admin: !!admin,
      connected: !!(provider && key),
    };
  }
  function offentlig(uid) {
    const o = opsaetning(uid);
    return { connected: o.connected, provider: o.provider, model: o.model, base: o.provider === 'compatible' ? o.base : null };
  }

  /* ------------------------------------------------------------ http */

  async function hentJson(url, opts) {
    let svar;
    try { svar = await fetch(url, Object.assign({ signal: AbortSignal.timeout(TIMEOUT_MS) }, opts)); } catch (e) {
      srv.log(`[ai] advarsel: ${String(url).replace(/\?.*$/, '')}: ${e && e.message}`);
      return { ok: false, kode: 'unreachable' };
    }
    let data = null;
    try { data = await svar.json(); } catch (e) { /* tomt eller ikke-JSON */ }
    if (svar.status === 401 || svar.status === 403) return { ok: false, kode: 'bad_key' };
    if (svar.status === 429) return { ok: false, kode: 'rate' };
    if (!svar.ok) {
      const besked = data && data.error ? String(data.error.message || data.error) : `HTTP ${svar.status}`;
      return { ok: false, kode: 'error', besked: besked.slice(0, 300) };
    }
    return { ok: true, data: data || {} };
  }
  const anthropicHoveder = (key, model) => Object.assign({ 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    MED_FALLBACK.has(model) ? { 'anthropic-beta': 'server-side-fallback-2026-07-01' } : {});
  const openaiBase = (o) => (o.provider === 'compatible' ? o.base.replace(/\/+$/, '') : o.provider === 'deepseek' ? DEEPSEEK : OPENAI);

  /** Forbind: proev noeglen (listen over modeller koster intet) FOER den gemmes. */
  async function forbind(uid, admin, f) {
    const provider = String(f.provider || '');
    if (!UDBYDERE.includes(provider)) return { ok: false, kode: 'provider' };
    const o = opsaetning(uid, admin);
    if (provider === 'compatible' && !o.admin) return { ok: false, kode: 'admin_only' };
    const key = String(f.key || '').trim() || (o.provider === provider ? o.key : '');
    if (!key && provider !== 'compatible') return { ok: false, kode: 'no_key' };
    const model = String(f.model || '').trim().slice(0, 100) || STANDARDMODEL[provider];
    let base = '';
    if (provider === 'compatible') {
      try {
        const u = new URL(String(f.base || '').trim());
        if (!/^https?:$/.test(u.protocol)) throw new Error('skema');
        base = u.toString().replace(/\/+$/, '');
      } catch (e) { return { ok: false, kode: 'bad_url' }; }
      if (!model) return { ok: false, kode: 'no_model' };
    }
    const proeve = provider === 'anthropic'
      ? await hentJson(`${ANTHROPIC}/v1/models?limit=1`, { headers: anthropicHoveder(key, '') })
      : await hentJson(`${openaiBase({ provider, base })}/models`, { headers: key ? { Authorization: `Bearer ${key}` } : {} });
    if (!proeve.ok) return proeve;
    srv.setSetting(uid, 'ai_provider', provider);
    srv.setSetting(uid, 'ai_key', key || 'none');
    srv.setSetting(uid, 'ai_model', model);
    srv.setSetting(uid, 'ai_base', base);
    samtaler.delete(uid);
    return { ok: true };
  }
  function afbryd(uid) {
    for (const k of ['ai_provider', 'ai_key', 'ai_model', 'ai_base']) srv.setSetting(uid, k, '');
    samtaler.delete(uid);
  }

  /* ------------------------------------------------------------ samtalen */

  function systemTekst() {
    return [
      "You are the assistant inside Sagu, the user's own note archive and wiki (like Notion). Notes are markdown, organised in notebooks and pages, with tags.",
      `Answer in the language the user writes in, short and plain. Today is ${new Date().toISOString().slice(0, 10)}.`,
      'Use the tools to look things up - never guess what the notes say, and never invent ids. Search first (search_notes), read a note with get_note when the search lines are not enough, and quote the relevant part.',
      'ALWAYS link the notes you mention, as a markdown link to the note id: [Note title](#note-<id>) - the app opens it with one click. Give web addresses from the notes as plain links too.',
      'Tools that change something (create, append, update, comment, publish) are shown to the user for approval before they run - just call them; do not ask for permission in text first.',
    ].join('\n');
  }

  function vaerktoejer() { return srv.vaerktoejer().filter((v) => !UDEN.has(v.name)); }
  const kraeverGodkendelse = (navn) => { const v = vaerktoejer().find((x) => x.name === navn); return !v || v.scope !== 'read'; };

  /* Koer ét vaerktoej. Svaret er TEKST til modellen. */
  function koer(uid, base, navn, input) {
    const v = vaerktoejer().find((x) => x.name === navn);
    if (!v) return { tekst: `Unknown tool ${navn}.`, fejl: true };
    try {
      const r = v.kald(input || {}, { userId: uid, base });
      return r.fejl ? { tekst: String(r.fejl), fejl: true } : { tekst: String(r.tekst || 'Done.').slice(0, 30000) };
    } catch (e) {
      srv.log(`[fejl] ai ${navn}: ${e && e.stack ? e.stack : e}`);
      return { tekst: 'The tool failed.', fejl: true };
    }
  }

  /* Én runde mod modellen -> { tekst, kald: [{ id, navn, input }], stop } eller { fejl }. */
  async function runde(o, s) {
    if (o.provider === 'anthropic') {
      const krop = {
        model: o.model, max_tokens: 16000, system: systemTekst(), messages: s.beskeder,
        tools: vaerktoejer().map((v) => ({ name: v.name, description: v.description, input_schema: v.inputSchema })),
      };
      if (MED_FALLBACK.has(o.model)) krop.fallbacks = 'default';
      const r = await hentJson(`${ANTHROPIC}/v1/messages`, { method: 'POST', headers: anthropicHoveder(o.key, o.model), body: JSON.stringify(krop) });
      if (!r.ok) return { fejl: r };
      const blokke = r.data.content || [];
      // Hele svaret - ogsaa taenke- og fallback-blokke - tilbage UAENDRET.
      s.beskeder.push({ role: 'assistant', content: blokke });
      return {
        tekst: blokke.filter((b) => b.type === 'text').map((b) => b.text).join('\n\n').trim(),
        kald: blokke.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, navn: b.name, input: b.input || {} })),
        stop: r.data.stop_reason,
      };
    }
    const krop = {
      model: o.model, messages: [{ role: 'system', content: systemTekst() }].concat(s.beskeder),
      tools: vaerktoejer().map((v) => ({ type: 'function', function: { name: v.name, description: v.description, parameters: v.inputSchema } })),
    };
    const r = await hentJson(`${openaiBase(o)}/chat/completions`, {
      method: 'POST',
      headers: Object.assign({ 'content-type': 'application/json' }, o.key && o.key !== 'none' ? { Authorization: `Bearer ${o.key}` } : {}),
      body: JSON.stringify(krop),
    });
    if (!r.ok) return { fejl: r };
    const valg = (r.data.choices || [])[0] || {};
    const m = valg.message || { role: 'assistant', content: '' };
    s.beskeder.push(Object.assign({ role: 'assistant' },
      m.tool_calls ? { content: m.content || null, tool_calls: m.tool_calls } : { content: m.content || '' },
      o.provider === 'deepseek' && m.tool_calls && m.reasoning_content ? { reasoning_content: m.reasoning_content } : {}));
    const kald = (m.tool_calls || []).map((c) => {
      let input = {};
      try { input = JSON.parse((c.function && c.function.arguments) || '{}'); } catch (e) { input = {}; }
      return { id: c.id, navn: c.function && c.function.name, input };
    });
    // Lokale »taenkende« modeller pakker tankerne i <think>…</think>.
    return { tekst: String(m.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim(), kald, stop: valg.finish_reason };
  }

  /* Vaerktoejssvarene ind i samtalen - samlet i ÉN besked (Claude) / én pr. kald (OpenAI-formen). */
  function svarTilbage(o, s, resultater) {
    if (o.provider === 'anthropic') {
      s.beskeder.push({ role: 'user', content: resultater.map((r) => Object.assign({ type: 'tool_result', tool_use_id: r.id, content: r.tekst }, r.fejl ? { is_error: true } : {})) });
    } else {
      for (const r of resultater) s.beskeder.push({ role: 'tool', tool_call_id: r.id, content: r.tekst });
    }
  }

  /* Koer, til modellen er faerdig - eller vil aendre noget (`venter`). */
  async function loekke(uid, o, s) {
    const dele = [];
    for (let i = 0; i < MAKS_RUNDER; i += 1) {
      const r = await runde(o, s);
      if (r.fejl) return Object.assign({ ok: false }, r.fejl, { dele });
      if (r.tekst) dele.push({ type: 'text', text: r.tekst });
      if (r.stop === 'refusal') { dele.push({ type: 'refusal' }); return { ok: true, dele, venter: null }; }
      if (!r.kald.length) return { ok: true, dele, venter: null };
      const resultater = [];
      const venter = [];
      for (const k of r.kald) {
        if (kraeverGodkendelse(k.navn)) { venter.push(k); resultater.push({ id: k.id, navn: k.navn, input: k.input, venter: true }); continue; }
        const res = koer(uid, s.base, k.navn, k.input);
        dele.push({ type: 'tool', name: k.navn, input: k.input, error: !!res.fejl });
        resultater.push(Object.assign({ id: k.id, navn: k.navn }, res));
      }
      if (venter.length) {
        s.venter = resultater;
        return { ok: true, dele, venter: venter.map((k) => ({ id: k.id, name: k.navn, input: k.input })) };
      }
      svarTilbage(o, s, resultater);
    }
    dele.push({ type: 'text', text: '(I stopped after too many steps. Ask again if you want me to go on.)' });
    return { ok: true, dele, venter: null };
  }

  async function spoerg(uid, tekst, base) {
    const o = opsaetning(uid);
    if (!o.connected) return { ok: false, kode: 'not_connected' };
    let s = samtaler.get(uid);
    if (!s || s.provider !== o.provider) { s = { provider: o.provider, beskeder: [], venter: null }; samtaler.set(uid, s); }
    s.sidst = Date.now();
    s.base = base;
    // Et nyt spoergsmaal, mens noget venter: det ventende afvises (svaret skal stadig med).
    if (s.venter) {
      svarTilbage(o, s, s.venter.map((r) => (r.venter ? { id: r.id, tekst: 'The user did not approve this action.', fejl: true } : r)));
      s.venter = null;
    }
    // Gammel DeepSeek-taenkning ud - den maa ikke med paa tvaers af spoergsmaal.
    for (const b of s.beskeder) if (b.reasoning_content) delete b.reasoning_content;
    s.beskeder.push({ role: 'user', content: String(tekst || '').slice(0, 8000) });
    return loekke(uid, o, s);
  }

  /** Brugerens svar paa det ventende: de godkendte id'er koeres, resten afvises. */
  async function godkend(uid, godkendte, base) {
    const o = opsaetning(uid);
    const s = samtaler.get(uid);
    if (!o.connected || !s || !s.venter) return { ok: false, kode: 'nothing_pending' };
    s.sidst = Date.now();
    s.base = base;
    const ja = new Set((Array.isArray(godkendte) ? godkendte : []).map(String));
    const dele = [];
    const resultater = s.venter.map((r) => {
      if (!r.venter) return r;
      if (!ja.has(String(r.id))) {
        dele.push({ type: 'tool', name: r.navn, input: r.input, declined: true });
        return { id: r.id, tekst: 'The user declined this action. Do not try it again unless asked.', fejl: true };
      }
      const res = koer(uid, s.base, r.navn, r.input);
      dele.push({ type: 'tool', name: r.navn, input: r.input, error: !!res.fejl, done: true });
      return Object.assign({ id: r.id }, res);
    });
    s.venter = null;
    svarTilbage(o, s, resultater);
    const r = await loekke(uid, o, s);
    r.dele = dele.concat(r.dele || []);
    return r;
  }

  function nulstil(uid) { samtaler.delete(uid); }

  return { opsaetning, offentlig, forbind, afbryd, spoerg, godkend, nulstil };
}

module.exports = { opret, UDBYDERE, STANDARDMODEL };
