'use strict';
/* Sagu - omni-feltet. Ét felt der baade soeger, opretter og navigerer.
 *
 * Samme foelelse som dodas, men med byttet raekkefoelge, og det er et bevidst
 * valg: i doda skal ét Enter ALTID fange, fordi appen findes for at fange.
 * Sagu er et arkiv - man leder langt oftere, end man opretter, og med tusind
 * importerede noter ville en oprettelse paa foerstepladsen betyde, at Enter
 * laver en ny note, hver gang man ledte efter en gammel.
 *
 * Derfor: **traefferne staar oeverst, og »New note« er den sidste raekke.**
 * Den er altid der, altid naaelig, og `*` foran teksten flytter den op paa
 * foerstepladsen for den, der ved, hvad han vil. Er der ingen traeffere, er
 * den den eneste raekke - og saa er Enter en oprettelse igen. */

/* Foerste tegn vaelger en TILSTAND. Pillen i feltet og legenden i bunden viser
   hvilken, saa man aldrig er i tvivl om, hvad Enter kommer til at goere. */
const OMNI_MODER = {
  '*': {
    id: 'note',
    pil: '* New note',
    ph: 'Title of the new note…',
    // Legenden er en KRAVSPECIFIKATION: naevner den noget, skal det findes
    // (RUNE-ERFARINGER, doda v9). Derfor bygges den af tilstanden.
    legend: ['↵ create'],
    enter: 'Create',
  },
  '/': { id: 'notebook', pil: '/ Notebooks', ph: 'Find a notebook…', legend: [], enter: 'Open' },
  '#': { id: 'tag', pil: '# Tags', ph: 'Find a tag…', legend: [], enter: 'Filter' },
  '+': {
    id: 'task',
    pil: '+ New task in doda',
    ph: 'Task title… — it goes to doda',
    legend: [],
    enter: 'Create',
  },
};

const OMNI_LEGEND = ['* new note', '/ notebooks', '# tags', 'tag: in: updated: has:'];

const omni = {
  mode: null,
  raekker: [],
  valgt: 0,
  timer: null,
  token: 0,
  soeger: false,
  fallback: false,
  seneste: [],
};

const omniEl = () => document.getElementById('omni');

/* --------------------------------------------------------------- feltet */

function omniHtml() {
  return `
    <div class="omni-card" id="omniCard">
      <div class="omni-field">
        <span class="omni-icon">${icon('search', 21)}</span>
        <span class="omni-mode" id="omniMode" hidden></span>
        <input class="omni-input" id="omni" autocomplete="off" spellcheck="false"
          placeholder="Search your notes, or start a new one">
        <button class="omni-clear" id="omniClear" aria-label="Clear" hidden>${icon('luk', 15)}</button>
      </div>
      <div class="omni-panel" id="omniPanel" hidden></div>
      <div class="omni-legend meta" id="omniLegend"></div>
    </div>
    <div class="omni-chips" id="omniChips"></div>`;
}

function saetMode(tegn) {
  omni.mode = tegn;
  const el = omniEl();
  const pil = document.getElementById('omniMode');
  if (!el || !pil) return;
  const m = tegn ? OMNI_MODER[tegn] : null;
  pil.hidden = !m;
  pil.textContent = m ? m.pil : '';
  el.placeholder = m ? m.ph : 'Search your notes, or start a new one';
  const kort = document.getElementById('omniCard');
  if (kort) kort.classList.toggle('moded', !!m);
}

function tegnLegend() {
  const host = document.getElementById('omniLegend');
  if (!host) return;
  const m = omni.mode ? OMNI_MODER[omni.mode] : null;
  const dele = m ? m.legend : OMNI_LEGEND;
  const enter = m ? m.enter : 'Open';
  host.innerHTML = `
    <span class="legend-keys">${dele.map((d) => {
    const mellemrum = d.indexOf(' ');
    return `<span class="legend-item"><kbd>${esc(d.slice(0, mellemrum))}</kbd>${esc(d.slice(mellemrum + 1))}</span>`;
  }).join('<span class="legend-dot">·</span>')}</span>
    <span class="legend-nav"><span class="legend-item">↑ ↓ Navigate</span>
      <span class="legend-item">↵ ${esc(enter)}</span></span>`;
}

/** Chips under feltet: hvad filtrene BETYDER, mens man skriver dem. */
function tegnOmniChips(tolket) {
  const host = document.getElementById('omniChips');
  if (!host) return;
  const dele = tolket ? saguSoeg.beskriv(tolket) : [];
  if (omni.fallback) dele.push('no index match — read the text');
  host.innerHTML = dele.map((d) => `<span class="chip${d.startsWith('no index') ? ' neutral' : ''}">${esc(d)}</span>`).join('');
}

/* ------------------------------------------------------------- raekkerne */

async function opdaterOmni() {
  const el = omniEl();
  if (!el) return;
  const raa = el.value;
  const tegn = raa[0];
  saetMode(OMNI_MODER[tegn] ? tegn : null);
  const tekst = omni.mode ? raa.slice(1).trim() : raa.trim();
  tegnLegend();

  if (omni.mode === '*') {
    const p = plukMaerker(tekst);
    omni.raekker = [{
      slags: 'ny',
      tekst: p.tekst,
      maerker: p.maerker,
      etiket: p.tekst ? `Create "${p.tekst}"` : 'Create a note',
      meta: p.maerker.length ? p.maerker.map((m) => `#${m}`).join(' ') : '',
    }];
    tegnOmniChips(null);
    tegnPanel();
    return;
  }
  if (omni.mode === '+') {
    // Er en note aaben, faar opgaven et link tilbage til den - saa siger
    // raekken det HOEJT, i stedet for at det sker bag ryggen paa nogen
    // (RUNE-ERFARINGER, doda v28: vis det, FOER handlingen sker).
    const paaNote = state.view === 'note' && editor.note ? editor.note.title || 'Untitled' : null;
    omni.raekker = [{
      slags: 'doda',
      tekst,
      etiket: tekst ? `Send "${tekst}" to doda` : 'Send a task to doda',
      under: paaNote ? `linked to “${paaNote}”` : null,
    }];
    tegnOmniChips(null);
    tegnPanel();
    return;
  }
  if (omni.mode === '/') {
    const q = tekst.toLowerCase();
    omni.raekker = (state.notebooks || [])
      .filter((b) => !q || b.name.toLowerCase().includes(q))
      .slice(0, 8)
      .map((b) => ({ slags: 'bog', id: b.id, etiket: b.name, ikon: b.icon || '📓' }));
    if (!omni.raekker.length && tekst) {
      omni.raekker = [{ slags: 'nybog', tekst, etiket: `Create notebook "${tekst}"` }];
    }
    tegnOmniChips(null);
    tegnPanel();
    return;
  }
  if (omni.mode === '#') {
    const q = tekst.toLowerCase();
    omni.raekker = (state.tags || [])
      .filter((t) => !q || t.name.toLowerCase().includes(q))
      .slice(0, 10)
      .map((t) => ({ slags: 'tag', id: t.id, etiket: `#${t.name}` }));
    /*
     * Findes maerket ikke, saa tilbyd at lave MAERKET.
     *
     * Foerste udgave tilboed at lave en NOTE med maerket paa - og det er en
     * anden handling end den, man bad om. Andreas skrev `#tags`, trykkede
     * Enter og fik en tom note. Det, `#` handler om, er maerket selv; en note
     * med et maerke laver man med `*` eller ved at skrive `#navn` i titlen.
     * Raekken er den SIDSTE, som alle andre oprettelser i feltet.
     */
    const navn = plukMaerker(`#${tekst}`).maerker[0];
    if (navn && !(state.tags || []).some((t) => t.name.toLowerCase() === navn.toLowerCase())) {
      omni.raekker.push({ slags: 'nytag', tekst: navn, etiket: `Create tag #${navn}` });
    }
    tegnOmniChips(null);
    tegnPanel();
    return;
  }

  // Almindelig soegning.
  const tolket = saguSoeg.tolk(raa);
  tegnOmniChips(tolket);
  if (!raa.trim()) {
    omni.raekker = omni.seneste.map((n) => ({ slags: 'note', id: n.id, etiket: n.title || 'Untitled', meta: 'recent' }));
    tegnPanel();
    return;
  }

  clearTimeout(omni.timer);
  omni.timer = setTimeout(async () => {
    const mit = ++omni.token;
    try {
      const d = await api('GET', `/api/v1/search?q=${encodeURIComponent(raa)}`);
      // Et AELDRE svar maa aldrig overskrive et nyere.
      if (mit !== omni.token) return;
      omni.fallback = !!d.fallback;
      omni.raekker = d.results.map((r) => ({
        slags: 'note',
        id: r.id,
        etiket: r.title || 'Untitled',
        uddrag: r.excerpt,
        afsnit: r.section,
        afsnitTitel: r.sectionTitle,
        meta: r.notebook,
      }));
      // Oprettelse er den SIDSTE raekke - altid der, aldrig i vejen.
      const p = plukMaerker(tolket.tekst || raa.trim());
      omni.raekker.push({
        slags: 'ny',
        tekst: p.tekst,
        // Baade det, man skrev som `#drift`, og et `tag:drift`-filter: har man
        // ledt efter noget under et maerke og ikke fundet det, er det dér, den
        // nye note hoerer hjemme.
        maerker: p.maerker.concat(tolket.tags || []),
        etiket: `Create "${p.tekst}"`,
      });
      omni.valgt = 0;
      tegnOmniChips(tolket);
      tegnPanel();
    } catch (ex) {
      if (mit !== omni.token) return;
      omni.raekker = [{ slags: 'fejl', etiket: ex.message }];
      tegnPanel();
    }
  }, 140);
}

function tegnPanel() {
  const host = document.getElementById('omniPanel');
  if (!host) return;
  if (!omni.raekker.length) { host.hidden = true; host.innerHTML = ''; return; }
  if (omni.valgt >= omni.raekker.length) omni.valgt = omni.raekker.length - 1;
  if (omni.valgt < 0) omni.valgt = 0;

  host.innerHTML = omni.raekker.map((r, i) => {
    const paa = i === omni.valgt ? ' on' : '';
    if (r.slags === 'note') {
      return `<button class="omni-row${paa}" data-row="${i}">
          <span class="omni-row-ikon">${icon('notes', 16)}</span>
          <span class="omni-row-tekst">
            <span class="omni-row-titel">${esc(r.etiket)}</span>
            ${r.uddrag ? `<span class="omni-row-uddrag">${uddrag(r.uddrag)}</span>` : ''}
          </span>
          <span class="omni-row-meta meta">${r.afsnitTitel ? esc(r.afsnitTitel)
    : (r.meta ? esc(r.meta) : '')}</span>
        </button>`;
    }
    const ikon = { ny: 'plus', nybog: 'book', bog: null, tag: 'tag', doda: 'plus', fejl: 'notes' }[r.slags];
    return `<button class="omni-row${paa}${r.slags === 'fejl' ? ' fejl' : ''}" data-row="${i}">
        <span class="omni-row-ikon">${r.ikon ? esc(r.ikon) : icon(ikon || 'book', 16)}</span>
        <span class="omni-row-tekst"><span class="omni-row-titel">${esc(r.etiket)}</span>
          ${r.under ? `<span class="omni-row-uddrag">${esc(r.under)}</span>` : ''}</span>
      </button>`;
  }).join('');
  host.hidden = false;

  host.querySelectorAll('[data-row]').forEach((el) => {
    el.addEventListener('mousedown', (e) => e.preventDefault());   // behold fokus i feltet
    el.addEventListener('click', () => vaelgRaekke(Number(el.dataset.row)));
  });
}

async function vaelgRaekke(i) {
  const r = omni.raekker[i];
  if (!r) return;
  const el = omniEl();

  if (r.slags === 'note') {
    ryd();
    await aabnNote(r.id);
    // Hop til det AFSNIT, traefferen staar i - ikke til toppen af en lang
    // side. Det alene er forskellen paa Notions wiki-soegning (SAGU-PLAN §5).
    if (r.afsnit) {
      setTimeout(() => {
        const h = document.getElementById(r.afsnit);
        if (h) h.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 120);
    }
    return;
  }
  if (r.slags === 'ny') {
    ryd();
    await opretOgAaben({ title: r.tekst || 'Untitled', tags: r.maerker || [] });
    return;
  }
  if (r.slags === 'nybog') {
    try {
      await api('POST', '/api/v1/notebooks', { name: r.tekst });
      await hentTrae();
      tegnTrae();
      ryd();
      toast(`Notebook "${r.tekst}" created.`);
    } catch (ex) { toast(ex.message); }
    return;
  }
  if (r.slags === 'bog') { ryd(); gaaTil('notes', { notebook: r.id }); return; }
  if (r.slags === 'nytag') {
    try {
      await api('POST', '/api/v1/tags', { name: r.tekst });
      state.tags = (await api('GET', '/api/v1/state')).tags || state.tags;
      toast(`Tag #${r.tekst} created. Put it on a note with + tag, or write #${r.tekst} in a title.`);
      // Bliv i feltet med maerket som FILTER: man har lige lavet det, og det
      // naeste, man vil, er at se hvad der ligger under det.
      if (el) { el.value = `tag:${r.tekst} `; opdaterOmni(); el.focus(); }
    } catch (ex) { toast(ex.message); }
    return;
  }
  if (r.slags === 'tag') {
    if (el) { el.value = `tag:${r.etiket.slice(1)} `; opdaterOmni(); el.focus(); }
    return;
  }
  if (r.slags === 'doda') {
    if (!r.tekst) { toast('Write what the task should say.'); return; }
    sendOpgaveTilDoda(r.tekst);
  }
}

/**
 * Sender en opgave til doda.
 *
 * ÉT sted, saa `+`-markoeren og opgaveruden paa noten giver samme besked og
 * samme fejl. Er en note aaben, faar opgaven et link tilbage til den; ellers
 * er det en fritstaaende opgave, og det er ogsaa i orden - man staar ikke
 * altid i en note, naar noget falder én ind.
 */
async function sendOpgaveTilDoda(tekst) {
  const note = state.view === 'note' && editor.note ? editor.note : null;
  try {
    if (!note) {
      // Uden en note er der ingen note-rute at gaa igennem. Broen har en
      // fritstaaende doer, saa markoeren virker fra enhver skaerm.
      const r = await api('POST', '/api/v1/doda/tasks', { text: tekst });
      toast(r.message || 'Sent to doda.');
      return;
    }
    const r = await api('POST', `/api/v1/notes/${note.id}/tasks`, { text: tekst });
    dodaState.opgaver = r.tasks || [];
    dodaState.noteId = note.id;
    tegnDodaOpgaver();
    toast(r.message || 'Sent to doda.');
  } catch (ex) {
    /*
     * En fejlet forbindelse er ikke en fejlet gemning.
     *
     * `not_connected` er ikke en fejl, brugeren har lavet - det er en
     * indstilling, han ikke har sat endnu. Sig hvad han skal goere, og gaa
     * derhen (en knap, der bare ikke virker, er det vaerste svar).
     */
    if (ex && ex.code === 'not_connected') {
      toast('doda is not connected yet.', { label: 'Connect', run: () => gaaTil('settings') });
      return;
    }
    toast(ex && ex.message ? ex.message : 'Could not reach doda.');
  }
}

/**
 * Skriver en linje i feltet og soeger med det samme.
 *
 * Findes for at der er ÉN vej til et resultat: et klik paa et maerke skriver
 * bare den linje, brugeren selv kunne have skrevet. Ellers ville der vaere to
 * maader at filtrere paa, som kan naa hver sit svar.
 */
function soegFra(linje) {
  const el = omniEl();
  if (!el) return;
  el.value = linje;
  el.focus();
  opdaterOmni();
}

function ryd() {
  const el = omniEl();
  if (el) { el.value = ''; el.blur(); }
  omni.raekker = [];
  omni.mode = null;
  omni.fallback = false;
  saetMode(null);
  tegnLegend();
  tegnOmniChips(null);
  tegnPanel();
}

/* -------------------------------------------------------------- binding */

function bindOmni() {
  const el = omniEl();
  if (!el) return;

  el.addEventListener('input', () => { omni.valgt = 0; opdaterOmni(); });
  el.addEventListener('focus', () => { if (!omni.raekker.length) opdaterOmni(); });

  el.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); omni.valgt++; tegnPanel(); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); omni.valgt--; tegnPanel(); return; }
    if (e.key === 'Enter') { e.preventDefault(); vaelgRaekke(omni.valgt); return; }
    if (e.key === 'Escape') { e.preventDefault(); ryd(); }
  });

  const luk = document.getElementById('omniClear');
  if (luk) luk.addEventListener('click', () => { ryd(); el.focus(); });

  el.addEventListener('input', () => {
    const k = document.getElementById('omniClear');
    if (k) k.hidden = !el.value;
  });

  // Klik uden for feltet lukker panelet, men beholder teksten - man kan vaere
  // paa vej hen for at laese noget og komme tilbage.
  document.addEventListener('click', (e) => {
    const kort = document.getElementById('omniCard');
    if (!kort || kort.contains(e.target)) return;
    const p = document.getElementById('omniPanel');
    if (p) p.hidden = true;
  });
}

/*
 * `/` giver feltet fokus fra hvor som helst.
 *
 * IKKE »skriv bare« som i doda: dér er fangst appens hele formaal, mens Sagu
 * har enkeltbogstavs-genveje paa noteskaermen (F for fokus). To funktioner om
 * de samme bogstaver er den fejl, tovo F1 beskriver - en arvet tastaturregel
 * kan vaere forkert i den nye app.
 */
document.addEventListener('keydown', (e) => {
  const iFelt = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  if (iFelt(e.target) || iFelt(document.activeElement)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key !== '/') return;
  const el = omniEl();
  if (!el) return;
  e.preventDefault();
  el.focus();
  el.select();
});

/** De senest aendrede noter - svaret paa et tomt felt. */
async function hentSeneste() {
  try {
    const d = await api('GET', '/api/v1/notes?limit=8');
    omni.seneste = d.notes.slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 8);
  } catch { omni.seneste = []; }
}
