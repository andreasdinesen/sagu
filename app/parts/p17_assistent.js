/* ------------------------------------------------------------ AI-assistenten (»Ask«) */

/*
 * Andreas, 2026-10-08: »en AI assistant som kan hjælpe med at finde ting i
 * noterne m.m. Den skal kunne give direkte links«. Portet fra qlk.
 *
 * Et panel i hoejre side, hvor man taler med sin egen Claude, ChatGPT eller
 * DeepSeek (noeglen staar paa serveren, app/assistent.js). Assistenten soeger og
 * laeser selv; alt, der AENDRER noget, vises som et kort, man godkender eller
 * afviser. Noter i svaret er links (`#note-<id>`) og aabner med ét klik - samme
 * vej som et link i en note (⌘-klik = ny fane). Samtalen bor paa serveren.
 */
const ai = { log: [], travl: false, venter: null, forbundet: null };

/* Det, vaerktoejskaldene hedder i panelet. */
const AI_VAERKTOEJ = {
  search_notes: 'Searched', get_note: 'Read', list_notebooks: 'Listed notebooks', list_tags: 'Listed tags',
  create_note: 'Create note', append_note: 'Add to note', update_note: 'Change note',
  add_comment: 'Comment', publish_note: 'Publish',
};
const AI_EKSEMPLER = [
  'What did I write about VPN?',
  'Find my notes tagged #meeting from this month',
  'Which notes link to GitHub?',
  'Summarise my newest note',
];

function aiKnapHtml() {
  return `<button class="temabtn ai-knap" id="aiBtn" type="button" aria-label="Ask the assistant"
    title="Ask the assistant (${modTast() === '⌘' ? '⌘⌥A' : 'Ctrl+Alt+A'})">${icon('gnist', 16)}<span>Ask</span></button>`;
}

function aiPanel() {
  let p = document.getElementById('aiPanel');
  if (p) return p;
  document.body.insertAdjacentHTML('beforeend', `<aside class="ai-panel" id="aiPanel" role="dialog" aria-labelledby="aiTitel" hidden>
    <div class="ai-hoved">
      <h2 id="aiTitel">${icon('gnist', 18)} Ask</h2>
      <button class="pinbtn" id="aiNy" type="button" title="New conversation" aria-label="New conversation">${icon('plus', 16)}</button>
      <button class="pinbtn" id="aiLuk" type="button" title="Close" aria-label="Close">${icon('luk', 16)}</button>
    </div>
    <div class="ai-log" id="aiLog" aria-live="polite"></div>
    <form class="ai-form" id="aiForm">
      <textarea class="input" id="aiInput" rows="2" placeholder="Ask about your notes…"></textarea>
      <button class="btn primary" type="submit" id="aiSend">Send</button>
    </form>
  </aside>`);
  p = document.getElementById('aiPanel');
  p.querySelector('#aiLuk').addEventListener('click', () => visAi(false));
  p.querySelector('#aiNy').addEventListener('click', async () => {
    ai.log = []; ai.venter = null;
    try { await api('POST', '/api/v1/assistant/reset', {}); } catch { /* ligegyldigt */ }
    tegnAi();
    p.querySelector('#aiInput').focus();
  });
  const felt = p.querySelector('#aiInput');
  felt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); p.querySelector('#aiForm').requestSubmit(); }
    if (e.key === 'Escape') { e.preventDefault(); visAi(false); }
  });
  p.querySelector('#aiForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = felt.value.trim();
    if (v && !ai.travl) { felt.value = ''; aiSpoerg(v); }
  });
  p.addEventListener('click', (e) => {
    // Et link til en note: samme vej som et link i en note - ⌘/Ctrl-klik giver en ny fane.
    const a = e.target.closest('a[href^="#note-"]');
    if (a) {
      e.preventDefault();
      const id = a.getAttribute('href').slice(6);
      if (e.metaKey || e.ctrlKey) { aabnIBaggrunden(id, a.textContent); return; }
      if (window.innerWidth < 900) visAi(false);
      aabnNote(id);
      return;
    }
    if (e.target.closest('[data-ai-forbind]')) { visAi(false); gemFane('broer'); gaaTil('settings'); }
  });
  return p;
}

/*
 * Genvejen (Andreas, 2026-10-09): ⌘⌥A / Ctrl+Alt+A - og A, naar man ikke skriver -
 * aabner panelet og lukker det igen. Kun naar en assistent ER forbundet; ellers en
 * besked om, hvor den sættes op (knappen oeverst viser stadig vejen derhen).
 */
async function skiftAi() {
  const p = document.getElementById('aiPanel');
  if (p && !p.hidden) { visAi(false); return; }
  if (ai.forbundet === null) {
    try { ai.forbundet = (await api('GET', '/api/v1/assistant')).assistant.connected; } catch { ai.forbundet = false; }
  }
  if (!ai.forbundet) { toast('No assistant is connected yet — set one up under Settings → Connections.'); return; }
  visAi(true);
}

async function visAi(vis) {
  const p = aiPanel();
  // Lukkes panelet, maa fokus ikke blive i det skjulte chatfelt - saa troede genvejene, man skrev.
  if (!vis && p.contains(document.activeElement)) document.activeElement.blur();
  p.hidden = !vis;
  document.body.classList.toggle('ai-aaben', vis);
  if (!vis) return;
  if (ai.forbundet === null) {
    try { ai.forbundet = (await api('GET', '/api/v1/assistant')).assistant.connected; } catch { ai.forbundet = false; }
  }
  tegnAi();
  p.querySelector('#aiInput').focus();
}

/*
 * Modellens tekst: escapet, saa lidt markdown (fed, kode, punkter, overskrifter),
 * [titel](#note-id) som et link til noten og adresser som links ud.
 */
function aiTekst(s) {
  let h = esc(s);
  h = h.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  h = h.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/\[([^\]\n]+)\]\(#note-([a-f0-9]{32})\)/g, '<a class="ai-notelink" href="#note-$2">$1</a>');
  h = h.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  h = h.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  // Et id, modellen skrev uden link (»id: …«), bliver ogsaa klikbart.
  h = h.replace(/(\bid:?\s*)([a-f0-9]{32})\b/g, '$1<a class="ai-notelink" href="#note-$2">$2</a>');
  h = h.replace(/^#{1,4} (.+)$/gm, '<strong>$1</strong>');
  h = h.replace(/(?:^|\n)((?:[-*] .+(?:\n|$))+)/g, (m, liste) => `\n<ul>${liste.trim().split('\n').map((l) => `<li>${l.replace(/^[-*] /, '')}</li>`).join('')}</ul>\n`);
  return h.trim().replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>').replace(/<br>(<ul>)|(<\/ul>)<br>/g, '$1$2');
}

/* Et vaerktoejskald i én linje: hvad, og det vigtigste argument. */
function aiKald(navn, input) {
  const x = input || {};
  const del = x.query || x.title || x.notebook || (x.text ? String(x.text).split('\n')[0].slice(0, 80) : '')
    || (x.id ? `#note-${x.id}` : '');
  const tekst = /^#note-[a-f0-9]{32}$/.test(del) ? `<a class="ai-notelink" href="${esc(del)}">${esc(del.slice(6, 14))}…</a>` : esc(del);
  return `<span class="ai-vaerktoej-navn">${esc(AI_VAERKTOEJ[navn] || navn)}</span> ${tekst}`;
}

function tegnAi() {
  const p = document.getElementById('aiPanel');
  if (!p || p.hidden) return;
  const log = p.querySelector('#aiLog');
  if (!ai.forbundet) {
    log.innerHTML = `<div class="ai-tom"><p>Connect Claude, ChatGPT or DeepSeek with your own API key, and ask about
      your notes here. The assistant searches and reads for you, and answers with links straight to the notes.</p>
      <button class="btn" type="button" data-ai-forbind>${icon('settings', 16)} Settings → Connections</button></div>`;
    p.querySelector('#aiForm').hidden = true;
    return;
  }
  p.querySelector('#aiForm').hidden = false;
  const linjer = ai.log.map((m) => {
    if (m.rolle === 'bruger') return `<div class="ai-msg bruger">${esc(m.tekst).replace(/\n/g, '<br>')}</div>`;
    if (m.rolle === 'svar') return `<div class="ai-msg svar">${aiTekst(m.tekst)}</div>`;
    if (m.rolle === 'afvist') return '<div class="ai-msg svar meta">The model declined to answer that.</div>';
    if (m.rolle === 'fejl') return `<div class="ai-msg fejl">${esc(m.tekst)}</div>`;
    if (m.rolle === 'kald') {
      const mark = m.declined ? 'declined' : m.error ? 'failed' : m.done ? 'done' : '';
      return `<div class="ai-trin${m.error || m.declined ? ' daarlig' : ''}">${icon(m.declined ? 'luk' : 'caret', 12)} ${aiKald(m.name, m.input)}${mark ? ` <span class="meta">· ${mark}</span>` : ''}</div>`;
    }
    return '';
  });
  if (!ai.log.length) {
    linjer.push(`<div class="ai-tom"><p>Ask about anything in your notes. Links in the answer open the note.</p>
      <div class="ai-eksempler">${AI_EKSEMPLER.map((k) => `<button class="ai-eks" type="button">${esc(k)}</button>`).join('')}</div></div>`);
  }
  if (ai.venter) {
    linjer.push(`<div class="ai-godkend"><p><strong>The assistant wants to:</strong></p>
      ${ai.venter.map((v) => `<label class="ai-handling"><input type="checkbox" checked data-id="${esc(v.id)}"> <span>${aiKald(v.name, v.input)}</span></label>`).join('')}
      <div class="btnrow"><button class="btn primary" id="aiJa" type="button">${ai.venter.length > 1 ? 'Do the checked' : 'Do it'}</button>
        <button class="btn" id="aiNej" type="button">No</button></div></div>`);
  }
  if (ai.travl) linjer.push('<div class="ai-trin meta"><span class="ai-prik"></span> Thinking…</div>');
  log.innerHTML = linjer.join('');
  // Panelets egen log ruller - siden selv roeres aldrig herfra.
  log.scrollTop = log.scrollHeight;
  log.querySelectorAll('.ai-eks').forEach((b) => b.addEventListener('click', () => aiSpoerg(b.textContent)));
  const ja = log.querySelector('#aiJa');
  if (ja) {
    ja.addEventListener('click', () => aiGodkend([...log.querySelectorAll('.ai-handling input:checked')].map((i) => i.dataset.id)));
    log.querySelector('#aiNej').addEventListener('click', () => aiGodkend([]));
  }
  p.querySelector('#aiSend').disabled = ai.travl;
}

function aiModtag(r) {
  let aendret = false;
  for (const d of r.parts || []) {
    if (d.type === 'text') ai.log.push({ rolle: 'svar', tekst: d.text });
    else if (d.type === 'refusal') ai.log.push({ rolle: 'afvist' });
    else if (d.type === 'tool') { ai.log.push(Object.assign({ rolle: 'kald' }, d)); if (d.done && !d.error) aendret = true; }
  }
  ai.venter = r.pending && r.pending.length ? r.pending : null;
  // Noget er aendret: hent noterne igen, saa traeet og den aabne note passer.
  if (aendret && typeof opfriskAlt === 'function') opfriskAlt();
}

async function aiKoer(fn) {
  ai.travl = true; tegnAi();
  try { aiModtag(await fn()); } catch (err) {
    ai.log.push({ rolle: 'fejl', tekst: err.message });
    if (err.status === 400 && /Connect an AI/.test(err.message)) ai.forbundet = false;
  }
  ai.travl = false; tegnAi();
}
function aiSpoerg(tekst) {
  if (ai.venter) { ai.venter.forEach((v) => ai.log.push({ rolle: 'kald', name: v.name, input: v.input, declined: true })); ai.venter = null; }
  ai.log.push({ rolle: 'bruger', tekst });
  return aiKoer(() => api('POST', '/api/v1/assistant/chat', { message: tekst }));
}
function aiGodkend(ids) {
  ai.venter = null;
  return aiKoer(() => api('POST', '/api/v1/assistant/approve', { approve: ids }));
}

function bindAiKnap() {
  const b = document.getElementById('aiBtn');
  if (b) b.addEventListener('click', () => visAi(aiPanel().hidden));
}

/* ---------------------------------------- Settings → Connections */

const AI_NAVNE = { anthropic: 'Claude', openai: 'ChatGPT', deepseek: 'DeepSeek', compatible: 'Compatible server' };
const AI_HINT = {
  anthropic: 'From console.anthropic.com → API keys.',
  openai: 'From platform.openai.com → API keys.',
  deepseek: 'From platform.deepseek.com → API keys. The model is deepseek-chat (or deepseek-reasoner).',
  compatible: 'Only if the server wants one.',
};

async function aiDelHtml() {
  let d;
  try { d = (await api('GET', '/api/v1/assistant')).assistant; } catch { return ''; }
  ai.forbundet = !!d.connected;
  return `
  <h2>AI assistant</h2>
  <div class="card" id="aiKort">
    <p class="meta saetning">Ask about your notes in plain words — the <strong>Ask</strong> button at the top.
    The assistant searches and reads your notes with your own Claude, ChatGPT or DeepSeek key, and answers
    with links straight to the notes. Anything that would change a note waits for your OK.</p>
    ${d.connected ? `<p class="doda-forbundet">Connected to <strong>${esc(AI_NAVNE[d.provider] || d.provider)}</strong> · ${esc(d.model)}${d.base ? ` · ${esc(d.base)}` : ''}</p>
    <p class="gemt-noegle">${icon('laas', 14)}
      <span><strong>An API key is saved</strong> on the server. It never leaves it again.</span></p>
    <div class="btnrow" style="margin-top:10px">
      <button class="btn primary" id="aiAabn" type="button">${icon('gnist', 16)} Ask</button>
      <button class="btn" id="aiAfbryd" type="button">Disconnect</button>
    </div>` : `
    <label class="field"><span>Service</span><select class="input" id="aiUdbyder">
      <option value="anthropic">Claude (Anthropic)</option><option value="openai">ChatGPT (OpenAI)</option><option value="deepseek">DeepSeek</option>
      ${state.user && state.user.isAdmin ? '<option value="compatible">Compatible server (LM Studio, Ollama …)</option>' : ''}</select></label>
    <label class="field" id="aiBaseFelt" style="margin-top:10px" hidden><span>Server address</span>
      <input class="input" id="aiBase" placeholder="http://192.168.1.10:1234/v1" autocomplete="off" spellcheck="false"></label>
    <label class="field" style="margin-top:10px"><span>API key</span>
      <input class="input" id="aiNoegle" type="password" autocomplete="off"></label>
    <p class="meta saetning" id="aiNoegleHint"></p>
    <label class="field" style="margin-top:10px"><span>Model</span>
      <input class="input" id="aiModel" autocomplete="off" spellcheck="false"></label>
    <p class="meta saetning">Leave it empty for the standard model. The key is tested before it is saved.</p>
    <div class="btnrow" style="margin-top:10px"><button class="btn primary" id="aiForbind" type="button">Connect</button></div>`}
  </div>`;
}

function bindAiDel() {
  const udb = document.getElementById('aiUdbyder');
  if (udb) {
    const skift = () => {
      const v = udb.value;
      document.getElementById('aiBaseFelt').hidden = v !== 'compatible';
      document.getElementById('aiModel').placeholder = { anthropic: 'claude-opus-5-5', openai: 'gpt-5', deepseek: 'deepseek-chat', compatible: 'qwen3-30b' }[v];
      document.getElementById('aiNoegleHint').textContent = AI_HINT[v];
    };
    udb.addEventListener('change', skift);
    skift();
    const knap = document.getElementById('aiForbind');
    knap.addEventListener('click', async () => {
      knap.disabled = true;
      knap.textContent = 'Testing…';
      try {
        await api('POST', '/api/v1/assistant', { provider: udb.value, key: document.getElementById('aiNoegle').value,
          model: document.getElementById('aiModel').value, base: document.getElementById('aiBase').value });
        ai.forbundet = true; ai.log = []; ai.venter = null;
        toast('Connected. Ask away — the button is at the top.');
        await tegnSide();
      } catch (ex) { toast(ex.message); knap.disabled = false; knap.textContent = 'Connect'; }
    });
  }
  const af = document.getElementById('aiAfbryd');
  if (af) {
    af.addEventListener('click', async () => {
      if (!window.confirm('Disconnect the AI assistant? The key is deleted from the server.')) return;
      try { await api('DELETE', '/api/v1/assistant'); ai.forbundet = false; ai.log = []; ai.venter = null; toast('Assistant disconnected.'); await tegnSide(); } catch (ex) { toast(ex.message); }
    });
  }
  const aa = document.getElementById('aiAabn');
  if (aa) aa.addEventListener('click', () => visAi(true));
}
