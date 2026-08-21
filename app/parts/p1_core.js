'use strict';
/* Sagu - kerne: opstart, tema, login, app-skal.
   Denne fil samles til public/app.js af build_rune.py. Redigér aldrig app.js.

   NB: interfacet er ENGELSK - som doda, og ogsaa den ramme, kollegaerne ser
   i wikien. Koden, kommentarerne og dokumenterne er dansk. */

const APP_VERSION = 1;

/* Mobilgraensen bor to steder: her og i style.css. Holdes de ikke i trit,
   folder menuknappen sidebaren sammen paa en iPad, hvor CSS'en tror, den er
   en overlay (RUNE-ERFARINGER §4). */
const SMAL_SKAERM = 900;
const smalSkaerm = () => window.matchMedia(`(max-width: ${SMAL_SKAERM}px)`).matches;

const state = {
  user: null,
  config: { appName: 'Sagu', needsSetup: false, allowRegistration: false, secureContext: false },
  // Appen starter i soegefeltet. Det er dét, man vil, naar man aabner et
  // arkiv: finde noget. Andreas' oenske, 2026-08-20.
  view: 'search',
  notebooks: [],
  tree: [],
  tags: [],
  counts: {},
  notes: [],
  publicUrl: '',
  today: '',
  // Login-skaermen kan staa i to tilstande: log ind eller opret konto.
  gateMode: 'login',
};

/* ------------------------------------------------------------ hjaelpere */

// crypto.randomUUID() findes KUN i secure contexts. Panelet tilgaas paa
// IP:port over http, hvor alt der opretter id'er ellers doer stille
// (RUNE-ERFARINGER §4).
function nyId() {
  if (window.crypto && crypto.randomUUID && window.isSecureContext) return crypto.randomUUID();
  const b = new Uint8Array(16);
  if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.random() * 256 | 0;
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Plukker `#maerke` ud af en tekst, man er ved at SKRIVE.
 *
 * Familiens vane: i doda og tovo saetter man et maerke ved at skrive `#navn`
 * dér, hvor man skriver. ÉN definition, brugt af baade notens titel og
 * soegefeltets oprettelse - to steder med hver sin regel ville betyde, at
 * feltet lover noget, den anden vej ikke holder (RUNE-ERFARINGER, doda F1).
 *
 * To regler, som begge er noedvendige:
 *  - Markoeren skal staa ved linjestart eller efter et MELLEMRUM, ellers
 *    bliver `https://dr.dk/nyheder#sport` til et maerke.
 *  - Maerket skal klaebe direkte til tegnet (`#drift`, ikke `# drift`), og saa
 *    er der intet at trimme - det var dér, den gamle fejl kom fra: man
 *    trimmede vaerdien og maalte laengden paa den utrimmede.
 */
function plukMaerker(raa) {
  const maerker = [];
  const tekst = String(raa || '')
    .replace(/(^|\s)#([\p{L}\p{N}][\p{L}\p{N}_-]{0,59})/gu, (helt, foer, navn) => {
      maerker.push(navn);
      return foer;
    })
    .replace(/\s+/g, ' ')
    .trim();
  return { tekst, maerker };
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Goer URL'er og [tekst](url) klikbare.
 *
 * Teksten escapes FOERST, og der matches derefter kun paa http(s). Det er med
 * vilje: `javascript:` og `data:` maa aldrig kunne slippe igennem fra en
 * Notion-import, et API-kald eller en MCP-klient. Den rigtige markdown-
 * renderer i F1 bygger ovenpaa netop denne funktion - saa der findes ingen vej
 * fra brugerens tekst til et tag, vi ikke selv har skrevet.
 */
function linkify(tekst) {
  let ud = esc(tekst);
  ud = ud.replace(/\[([^\]\n]{1,120})\]\((https?:\/\/[^)\s]{1,500})\)/g,
    (_, navn, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${navn}</a>`);
  ud = ud.replace(/(^|[\s(])(https?:\/\/[^\s<]{1,500})/g, (helt, foer, url) => {
    // Slutpunktum og lukkeparentes hoerer til saetningen, ikke til adressen.
    const hale = url.match(/[.,;:!?)]+$/);
    const ren = hale ? url.slice(0, -hale[0].length) : url;
    const vis = ren.replace(/^https?:\/\//, '').slice(0, 60);
    return `${foer}<a href="${ren}" target="_blank" rel="noopener noreferrer">${vis}</a>${hale ? hale[0] : ''}`;
  });
  return ud;
}

async function api(method, path, body) {
  const opts = { method, credentials: 'same-origin' };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
    // Saet headers EFTER en evt. merge - en shallow merge har foer slettet
    // Authorization, fordi hele header-objektet blev erstattet.
    opts.headers = { 'Content-Type': 'application/json' };
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    // Browserens egen tekst er ubrugelig for et menneske: Safari siger
    // "Load failed", Chrome "Failed to fetch". Oversaettelsen hoerer hjemme
    // HER - ét sted - og ikke i hvert kaldssted.
    //
    // Ingen `status`: koden andetsteds skelner netvaerksbrud fra afslag
    // netop paa den.
    throw Object.assign(
      new Error('No connection — this needs the network. Try again when you are back.'),
      { offline: true });
  }
  let data = {};
  try { data = await res.json(); } catch { /* tomt svar er i orden */ }
  // API'et svarer {error: kode, message: laesbar tekst}. Mennesket skal se
  // beskeden; koden er til klienter.
  if (!res.ok) {
    throw Object.assign(new Error(data.message || data.error || `Error ${res.status}`),
      { status: res.status, code: data.error });
  }
  return data;
}

function toast(besked, handling) {
  const host = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(besked)}</span>`;
  if (handling) {
    const knap = document.createElement('button');
    knap.className = 'toast-action';
    knap.textContent = handling.label;
    knap.addEventListener('click', () => { el.remove(); handling.run(); });
    el.appendChild(knap);
  }
  host.appendChild(el);
  setTimeout(() => el.remove(), handling ? 8000 : 3200);
}

/* --------------------------------------------------------------- tema */

function anvendTema(valg) {
  if (valg === 'light' || valg === 'dark') document.documentElement.setAttribute('data-theme', valg);
  else document.documentElement.removeAttribute('data-theme');
  try { localStorage.setItem('sagu_theme', valg); } catch { /* privat tilstand */ }
}

function nuvaerendeTema() {
  try { return localStorage.getItem('sagu_theme') || 'auto'; } catch { return 'auto'; }
}

/* Det tema, man rent faktisk SER. "Follow system" er ikke en tredje farve -
   den er lys eller moerk, afhaengigt af maskinen, og knappen i sidebaren skal
   vise vejen til den modsatte af det, oejet ser.

   Temaet bliver med vilje i localStorage og ikke i settings: det skal laeses
   FOER foerste paint, og der er intet netvaerk. Lyst/moerkt er desuden et valg
   pr. skaerm (RUNE-ERFARINGER, tovo v11). */
function visuelTema() {
  const valg = nuvaerendeTema();
  if (valg === 'light' || valg === 'dark') return valg;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/* -------------------------------------------------------------- ikoner */

const ICONS = {
  logo: '<path d="M6 4.5h8.5L19 9v10.5H6z"/><path d="M14 4.5V9h5"/><path d="M9 12.5h7M9 15.5h4"/>',
  notes: '<path d="M6 4.5h8.5L19 9v10.5H6z"/><path d="M14 4.5V9h5"/><path d="M9 12.5h7M9 15.5h4"/>',
  book: '<path d="M5 5.5A1.5 1.5 0 016.5 4H18v16H6.5A1.5 1.5 0 015 18.5z"/><path d="M9 4v16"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
  tag: '<path d="M4 11.5V5a1 1 0 011-1h6.5l8 8-7.5 7.5z"/><circle cx="8" cy="8" r="1.2"/>',
  shared: '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5"/><path d="M16 6.5a3 3 0 010 6M17.5 19c-.3-1.8-1-3.2-2-4.2"/>',
  trash: '<path d="M5 7h14"/><path d="M9 7V5.5A1.5 1.5 0 0110.5 4h3A1.5 1.5 0 0115 5.5V7"/><path d="M6.5 7l.8 11.6A1.5 1.5 0 008.8 20h6.4a1.5 1.5 0 001.5-1.4L17.5 7"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M18 6l-1.4 1.4M7.4 16.6L6 18M18 18l-1.4-1.4M7.4 7.4L6 6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  pin: '<path d="M9 3.5h6l-1 5 3 3.5H7l3-3.5z"/><path d="M12 12v8.5"/>',
  out: '<path d="M14.5 4.5H18a1.5 1.5 0 011.5 1.5v12a1.5 1.5 0 01-1.5 1.5h-3.5"/><path d="M4.5 12h10M11 8.5l3.5 3.5-3.5 3.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M17.8 6.2l-1.4 1.4M7.6 16.4l-1.4 1.4M17.8 17.8l-1.4-1.4M7.6 7.6L6.2 6.2"/>',
  moon: '<path d="M20 14.6A8.6 8.6 0 019.4 4 8.6 8.6 0 1020 14.6z"/>',
  key: '<circle cx="8" cy="12" r="3.5"/><path d="M11.5 12H20M17 12v3M20 12v2.5"/>',
  caret: '<path d="M9 6l6 6-6 6"/>',
  width: '<path d="M3 12h18"/><path d="M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
  focus: '<path d="M4 9V5.5A1.5 1.5 0 015.5 4H9"/><path d="M15 4h3.5A1.5 1.5 0 0120 5.5V9"/><path d="M20 15v3.5a1.5 1.5 0 01-1.5 1.5H15"/><path d="M9 20H5.5A1.5 1.5 0 014 18.5V15"/>',
  dots: '<circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/>',
  comment: '<path d="M20 12.5a6.5 6.5 0 01-6.5 6.5H9l-4 2.5v-4A6.5 6.5 0 016.5 6h7A6.5 6.5 0 0120 12.5z"/>',
  copy: '<path d="M9 9h10v10a1.5 1.5 0 01-1.5 1.5H9z"/><path d="M15 9V4.5A1.5 1.5 0 0013.5 3H5.5A1.5 1.5 0 004 4.5v9A1.5 1.5 0 005.5 15H9"/>',
  luk: '<path d="M6 6l12 12M18 6L6 18"/>',
  kalender: '<path d="M4.5 6.5h15v13h-15z"/><path d="M4.5 10h15M9 4.5v3M15 4.5v3"/>',
  skabelon: '<path d="M4.5 5.5h15v13h-15z"/><path d="M4.5 9.5h15M9.5 9.5v9"/>',
  klips: '<path d="M17 8.5l-6.6 6.6a2.5 2.5 0 003.5 3.5l6.6-6.6a4.5 4.5 0 00-6.4-6.4l-6.6 6.6a6.5 6.5 0 009.2 9.2l5.8-5.8"/>',
  import: '<path d="M12 3.5v11M8.5 11L12 14.5 15.5 11"/><path d="M4.5 15.5v3a1.5 1.5 0 001.5 1.5h12a1.5 1.5 0 001.5-1.5v-3"/>',
  ind: '<path d="M4 6.5h16M9 12h11M9 17.5h11"/><path d="M4 10l2.5 2L4 14"/>',
  fold: '<path d="M8 9l4-4 4 4"/><path d="M8 15l4 4 4-4"/>',
  udfold: '<path d="M8 5l4 4 4-4"/><path d="M8 19l4-4 4 4"/>',
  globe: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16"/><path d="M12 4a12 12 0 010 16 12 12 0 010-16z"/>',
};

function icon(name, size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

/* ------------------------------------------------------------- sider */

/* Raekkefoelgen her er ogsaa sidebarens. group: 0 = staar IKKE i navigationen;
   Settings naas fra menuen paa brugerknappen, hvor kontoen i forvejen bor. */
const VIEWS = [
  { id: 'notes', label: 'All Notes', icon: 'notes', group: 1, tael: 'notes' },
  { id: 'search', label: 'Search', icon: 'search', group: 1 },
  { id: 'tags', label: 'Tags', icon: 'tag', group: 2 },
  { id: 'comments', label: 'Comments', icon: 'comment', group: 2, tael: 'pendingComments' },
  { id: 'shared', label: 'Shared with me', icon: 'shared', group: 2, tael: 'shared' },
  { id: 'trash', label: 'Trash', icon: 'trash', group: 3, tael: 'trash' },
  // group: 0 = staar IKKE i navigationen. Import og eksport er noget, man goer
  // et par gange i en apps levetid - den hoerer i brugermenuen ved siden af
  // Settings, ikke i den daglige liste (Andreas, 2026-08-21).
  { id: 'import', label: 'Import & export', icon: 'import', group: 0 },
  { id: 'settings', label: 'Settings', icon: 'settings', group: 0 },
  // group: 0 = staar IKKE i navigationen. En note naas fra traeet; uden en
  // valgt note er der ingenting at gaa ind til.
  { id: 'note', label: 'Note', icon: 'notes', group: 0 },
];

const viewById = (id) => VIEWS.find((v) => v.id === id) || VIEWS[0];

/*
 * Skaermene, der bor bag BRUGERKNAPPEN.
 *
 * De staar ikke i navigationen, saa brugerknappen skal markeres, mens man er
 * paa dem - ellers lyser INTET i menuen, og man kan ikke se, hvor man er
 * (RUNE-ERFARINGER §9c).
 */
const BAG_BRUGEREN = new Set(['settings', 'import']);

const BESKRIVELSER = {
  notes: 'Everything you have written, newest first.',
  search: 'Search titles, headings, body text, tags and properties.',
  tags: 'Your tags, and what is filed under each.',
  comments: 'What people wrote on your notes — and what is waiting to be read.',
  shared: 'Notes other people have shared with you.',
  trash: 'Deleted notes. They are removed for good after 30 days.',
  import: 'Bring your Notion archive in, and take everything out again whenever you like.',
  settings: 'Appearance, account and access.',
};

/* ------------------------------------------------------------ optegning */

/** Fuld optegning. Kun ved login/logout - ellers mister felter fokus. */
function render() {
  const root = document.getElementById('root');
  if (!state.user) { root.innerHTML = gateHtml(); bindGate(); return; }
  root.innerHTML = shellHtml();
  bindShell();
  tegnSide();
}

/* --------------------------------------------------------------- gate */

function gateHtml() {
  const setup = state.config.needsSetup;
  const opretter = setup || state.gateMode === 'register';
  return `
  <div class="gate">
    <div class="card">
      <div class="brand">${icon('logo', 26)} ${esc(state.config.appName || 'Sagu')}</div>
      <p class="lead" style="text-align:center;margin-bottom:22px">
        ${setup ? 'Pick a username and a password, and you are in.'
    : opretter ? 'Create your account.' : 'Sign in to continue.'}
      </p>
      <p class="gate-error" id="gateError" hidden></p>
      <form id="gateForm">
        <label class="field"><span>Username</span>
          <input class="input" id="gateUser" autocomplete="username" autocapitalize="none" required></label>
        <label class="field"><span>Password</span>
          <input class="input" id="gatePass" type="password"
            autocomplete="${opretter ? 'new-password' : 'current-password'}" required></label>
        <button class="btn primary" type="submit" style="width:100%">
          ${opretter ? 'Create account' : 'Sign in'}</button>
      </form>
      ${!opretter && state.config.passkeys && state.config.hasPasskeys ? `
        <div class="gate-or"><span>or</span></div>
        <button class="btn" id="gatePasskey" style="width:100%">Sign in with a passkey</button>` : ''}
      ${setup ? '<p class="gate-note">The first account is the administrator. It decides whether anyone else may sign up.</p>' : ''}
      ${!setup && state.config.allowRegistration ? `
        <p class="gate-switch">${opretter ? 'Already have an account?' : 'No account yet?'}
          <button type="button" id="gateSwitch">${opretter ? 'Sign in' : 'Create one'}</button></p>` : ''}
    </div>
  </div>`;
}

function bindGate() {
  const form = document.getElementById('gateForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('gateError');
    err.hidden = true;
    const opretter = state.config.needsSetup || state.gateMode === 'register';
    try {
      const data = await api('POST', opretter ? '/api/register' : '/api/login', {
        username: document.getElementById('gateUser').value,
        password: document.getElementById('gatePass').value,
      });
      state.user = data.user;
      state.config.needsSetup = false;
      await hentState();
      render();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  });

  const skift = document.getElementById('gateSwitch');
  if (skift) {
    skift.addEventListener('click', () => {
      state.gateMode = state.gateMode === 'register' ? 'login' : 'register';
      render();
    });
  }

  const pkBtn = document.getElementById('gatePasskey');
  if (pkBtn) {
    pkBtn.addEventListener('click', async () => {
      const err = document.getElementById('gateError');
      err.hidden = true;
      try {
        const d = await loginMedPasskey();
        state.user = d.user;
        await hentState();
        render();
      } catch (ex) {
        // Brugeren afbroed selv - det er ikke en fejl, der skal vises.
        if (ex.name === 'NotAllowedError') return;
        err.textContent = ex.message || 'The passkey did not work';
        err.hidden = false;
      }
    });
  }

  document.getElementById('gateUser').focus();
}

/* --------------------------------------------------------------- skal */

function navHtml() {
  const iNav = VIEWS.filter((v) => v.group > 0);
  const grupper = [...new Set(iNav.map((v) => v.group))];
  return grupper.map((g) => `<nav class="nav">${iNav.filter((v) => v.group === g).map((v) => {
    const antal = v.tael ? (state.counts[v.tael] || 0) : 0;
    return `<button class="nav-item" data-view="${v.id}" ${v.id === state.view ? 'aria-current="page"' : ''}>
        ${icon(v.icon)}<span>${esc(v.label)}</span>
        ${antal ? `<span class="nav-count">${antal}</span>` : ''}
      </button>`;
  }).join('')}</nav>`).join('');
}

function shellHtml() {
  return `
  <button class="btn navtoggle" id="navToggle" aria-label="Menu">${icon('menu')}</button>
  <div class="backdrop" id="backdrop"></div>
  <div class="app">
    <aside class="sidebar">
      <div class="brand">${icon('logo', 24)} <span style="flex:1;min-width:0">${esc(state.config.appName || 'Sagu')}</span>
        <button class="pinbtn" id="pinBtn" aria-label="Hide the menu"
          title="Hide the menu">${icon('pin', 16)}</button></div>
      <div id="navHost">${navHtml()}</div>
      <div id="treeHost" class="treehost"></div>
      <div class="sidebar-foot">
        <button class="nav-item" id="userBtn"
          ${BAG_BRUGEREN.has(state.view) ? 'aria-current="page"' : ''}>${icon('settings')}<span>${esc(state.user.username)}</span></button>
        <div class="foot-row" id="footRow">${versionHtml()}</div>
      </div>
    </aside>
    <main class="main">
      <div class="topbar">
        <div class="toprow">
          <div class="stats meta" id="statsHost">${statsHtml()}</div>
          ${temaKnapHtml()}
        </div>
        ${omniHtml()}
      </div>
      <div id="pageHost"></div>
    </main>
  </div>
  <nav class="toc" id="tocRail" aria-label="On this page" hidden></nav>`;
}

/*
 * Versionen, altid synlig. Det er SAMME tal som runens version: i panelet -
 * build_rune.py stempler APP_VERSION i index.html og i runen paa én gang.
 *
 * Serveren melder sit eget tal i /api/public-config. Er de to forskellige, er
 * app.js i browserens cache aeldre end den, serveren udleverer - og saa er det
 * DET, brugeren skal vide, ikke versionsnummeret alene.
 */
/* En rolig linje over feltet: hvor meget staar der egentlig. */
function statsHtml() {
  const c = state.counts || {};
  const dele = [];
  if (c.notes) dele.push(`${c.notes} notes`);
  if ((state.notebooks || []).length) dele.push(`${state.notebooks.length} notebooks`);
  if (c.archived) dele.push(`${c.archived} archived`);
  if (c.trash) dele.push(`${c.trash} in trash`);
  return dele.map((d) => `<span>${esc(d)}</span>`).join('');
}

function versionHtml() {
  const server = state.config.version;
  const gammel = server && server !== APP_VERSION;
  if (gammel) {
    return `<button class="version-line meta version-old" id="versionBtn"
      title="Your browser is running v${APP_VERSION}, but the server has v${server}. Click to reload.">
      v${APP_VERSION} · v${server} available — reload</button>`;
  }
  return `<div class="version-line meta">v${esc(String(APP_VERSION))}</div>`;
}

/* Ét klik mellem lyst og moerkt. Knappen viser det tema, man skifter TIL -
   ikke det, man er i. Alle tre valg bliver staaende under Settings. */
function temaKnapHtml() {
  const naeste = visuelTema() === 'dark' ? 'light' : 'dark';
  return `<button class="temabtn" id="temaBtn" data-naeste="${naeste}"
    aria-label="Switch to ${naeste} theme" title="Switch to ${naeste} theme">
    ${icon(naeste === 'dark' ? 'moon' : 'sun', 16)}</button>`;
}

function opdaterTemaKnap() {
  const gammel = document.getElementById('temaBtn');
  if (!gammel) return;
  gammel.outerHTML = temaKnapHtml();
  bindTemaKnap();
  // Er man PAA indstillingssiden, skal de tre knapper der ogsaa foelge med.
  if (state.view === 'settings') tegnSide();
}

function bindTemaKnap() {
  const el = document.getElementById('temaBtn');
  if (!el) return;
  el.addEventListener('click', () => { anvendTema(el.dataset.naeste); opdaterTemaKnap(); });
}

function bindNav() {
  document.querySelectorAll('.nav-item[data-view]').forEach((el) => {
    el.addEventListener('click', () => gaaTil(el.dataset.view));
  });
}

function bindShell() {
  bindNav();
  bindTemaKnap();
  bindOmni();
  tegnLegend();
  tegnTrae();
  document.getElementById('userBtn').addEventListener('click', visBrugerMenu);
  saetNavSkjult(navErSkjult());

  document.getElementById('pinBtn').addEventListener('click', () => {
    const skjul = !document.body.classList.contains('navskjult');
    saetNavSkjult(skjul);
    // Foldes den vaek, mens man staar i den, skal overlayet ogsaa lukke.
    if (skjul) document.body.classList.remove('navopen');
  });

  // Er serverens version nyere end den indlaeste, sidder der en gammel app.js
  // i cachen. Ryd den FOER genindlaesningen - ellers serveres den samme fil.
  const vBtn = document.getElementById('versionBtn');
  if (vBtn) {
    vBtn.addEventListener('click', async () => {
      try {
        if (window.caches) await Promise.all((await caches.keys()).map((n) => caches.delete(n)));
      } catch { /* uden cache-api er der ikke noget at rydde */ }
      location.reload();
    });
  }

  document.getElementById('navToggle').addEventListener('click',
    () => document.body.classList.toggle('navopen'));
  document.getElementById('backdrop').addEventListener('click',
    () => document.body.classList.remove('navopen'));
}

/*
 * At gaa til en skaerm betyder at se den REN.
 *
 * Laa nulstillingen bag `if (state.view !== view)`, ville en aaben note goere
 * skaermen til en blindgyde: man staar allerede paa 'notes', saa hverken
 * sidebaren eller en tilbage-knap gjorde noget (RUNE-ERFARINGER, doda v32).
 * Et filter er noget, man VAELGER - ikke noget, man arver.
 */
function gaaTil(view, opt) {
  // En ventende gemning maa ikke gaa tabt, fordi man klikker i sidebaren.
  if (typeof gemNu === 'function') gemNu();
  const skifter = state.view !== view;
  const havdeFilter = !!(state.openNote || state.filterTag || state.openNotebook);
  state.view = view;
  state.openNote = null;
  state.filterTag = null;
  state.openNotebook = null;
  if (typeof editor === 'object') { editor.note = null; editor.aabenBlok = null; }
  document.body.classList.remove('fokus', 'bred-note');
  if (opt && opt.tag !== undefined) state.filterTag = opt.tag;
  if (opt && opt.notebook !== undefined) state.openNotebook = opt.notebook;
  document.body.classList.remove('navopen');
  opdaterNav();
  tegnSide();
  // Scroll kun til toppen ved reelt sideskift - ellers kastes brugeren op,
  // hver gang en inline-redigering gentegner (RUNE-ERFARINGER §4).
  if (skifter || havdeFilter) window.scrollTo(0, 0);
}

function opdaterNav() {
  const host = document.getElementById('navHost');
  if (host) { host.innerHTML = navHtml(); bindNav(); }
  const stats = document.getElementById('statsHost');
  if (stats) stats.innerHTML = statsHtml();
  // Settings staar ikke i navigationen - brugerknappen er indgangen, og saa
  // skal den ogsaa vise, naar man er der. Ellers er INTET markeret.
  const bruger = document.getElementById('userBtn');
  if (bruger) {
    if (BAG_BRUGEREN.has(state.view)) bruger.setAttribute('aria-current', 'page');
    else bruger.removeAttribute('aria-current');
  }
}

/** Henter state og gentegner NAV og SIDE, men aldrig hele skallen. */
async function genindlaes() {
  await hentState();
  if (typeof foelgImport === 'function') foelgImport();
  opdaterNav();
  await tegnSide();
}

async function hentState() {
  try {
    const d = await api('GET', '/api/v1/state');
    state.notebooks = d.notebooks || [];
    // Traeet hentes i sit EGET kald, saa en note-optegning kan opfriske det
    // uden ogsaa at hente taellere og maerker.
    await hentTrae();
    await hentSeneste();
    state.tags = d.tags || [];
    state.storage = d.storage || {};
    state.counts = d.counts || {};
    state.today = d.today || '';
    // Tom betyder "brug den vaert, browseren staar paa" - se offentligBase().
    state.publicUrl = d.publicUrl || '';
  } catch (ex) {
    if (ex.status !== 401) toast(ex.message);
  }
}

/* ------------------------------------------------------ sidebaren */

/*
 * Sidebaren kan foldes helt vaek, saa der kun staar en hamburger tilbage.
 * Skjult ligger den som et OVERLAY over indholdet i stedet for at skubbe det -
 * ellers hopper hele siden, hver gang man kigger i menuen (§9c).
 *
 * Valget bliver i localStorage med vilje: det afhaenger af skaermens bredde og
 * hoerer derfor til ENHEDEN, ikke til brugeren (RUNE-ERFARINGER, tovo v11).
 */
function navErSkjult() {
  try { return localStorage.getItem('sagu_nav_skjult') === '1'; } catch { return false; }
}

function saetNavSkjult(skjult) {
  try { localStorage.setItem('sagu_nav_skjult', skjult ? '1' : '0'); } catch { /* privat */ }
  document.body.classList.toggle('navskjult', skjult);
  if (!skjult) document.body.classList.remove('navopen');
  // Brugermenuen haenger i sidebarens fod. Foldes sidebaren vaek, mens menuen
  // staar aaben, ville den blive svaevende tilbage over ingenting.
  const menu = document.getElementById('userMenu');
  if (menu) menu.remove();
  const knap = document.getElementById('pinBtn');
  if (knap) {
    const tekst = skjult ? 'Keep the menu open' : 'Hide the menu';
    knap.setAttribute('aria-label', tekst);
    knap.title = tekst;
    knap.classList.toggle('off', skjult);
  }
}

/* --------------------------------------------------- brugermenuen */

/*
 * Menuen HAENGER i sidebarens fod og placeres af CSS (position:absolute i en
 * position:relative fod). Ikke af et getBoundingClientRect() paa
 * klik-tidspunktet: paa mobil glider sidebaren stadig ind, naar man maaler,
 * og menuen lander uden for skaermen (RUNE-ERFARINGER, Beanledger v29).
 *
 * Arver du komponenten, saa arv BEGGE halvdele - CSS'en alene giver en menu,
 * der ser rigtig ud i kilden og er usynlig paa skaermen (tools v2).
 */
function visBrugerMenu() {
  const gammel = document.getElementById('userMenu');
  if (gammel) { gammel.remove(); return; }
  const fod = document.querySelector('.sidebar-foot');
  const anker = document.getElementById('userBtn');
  if (!fod || !anker) return;

  const host = document.createElement('div');
  host.className = 'usermenu';
  host.id = 'userMenu';
  host.innerHTML = `
    <div class="usermenu-head">
      <div class="usermenu-name">${esc(state.user.username)}</div>
      <div class="meta">${state.user.isAdmin ? 'Administrator' : 'Signed in'}${state.config.secureContext ? '' : ' · plain http'}</div>
    </div>
    <button class="usermenu-item" data-go="import">${icon('import', 17)}<span>Import &amp; export</span></button>
    <button class="usermenu-item" data-go="settings">${icon('settings', 17)}<span>Settings</span></button>
    <button class="usermenu-item danger" data-go="logout">${icon('out', 17)}<span>Log out</span></button>`;
  fod.appendChild(host);

  const luk = () => host.remove();
  host.querySelectorAll('[data-go]').forEach((el) => {
    el.addEventListener('click', async () => {
      const hvad = el.dataset.go;
      luk();
      if (hvad === 'settings' || hvad === 'import') { gaaTil(hvad); return; }
      await api('POST', '/api/logout', {});
      state.user = null;
      state.gateMode = 'login';
      render();
    });
  });
  // Ét klik udenfor lukker igen. setTimeout, saa klikket der AABNEDE menuen
  // ikke lukker den med det samme.
  setTimeout(() => {
    document.addEventListener('click', function udenfor(e) {
      if (host.isConnected && !host.contains(e.target) && e.target !== anker && !anker.contains(e.target)) {
        luk();
        document.removeEventListener('click', udenfor);
      }
    });
  }, 0);
}

/* --------------------------------------------------- sideoversigten */

/*
 * §9b fra RUNE-ERFARINGER, ordret. En stak streger i hoejre kant, én pr.
 * afsnit, som folder sig ud paa hover. Det er praecis den funktion, Andreas
 * bad om (krav 8), og den koster ingenting, fordi opskriften allerede findes.
 *
 * Den bor i <body>, ikke i #pageHost: alt derinde skiftes ud ved hver
 * optegning, og saa ville oversigten forsvinde.
 */
const tocState = { punkter: [], aktiv: -1 };

function byggToc() {
  const rail = document.getElementById('tocRail');
  if (!rail) return;
  const host = document.getElementById('pageHost');
  // I en note er det notens egne overskrifter, oversigten skal vise - baade
  // h2 og h3, saa et langt dokument kan navigeres.
  const vaelger = state.view === 'note' ? '.note-body h2, .note-body h3' : 'h2';
  const fundne = host ? [...host.querySelectorAll(vaelger)] : [];

  // Under to afsnit er der ingen oversigt at lave, og paa en telefon ville en
  // fast stribe i hoejre side ligge oven i indholdet.
  if (fundne.length < 2 || smalSkaerm()) {
    rail.hidden = true;
    rail.innerHTML = '';
    tocState.punkter = [];
    return;
  }

  tocState.punkter = fundne.map((el, i) => {
    if (!el.id) el.id = `afsnit-${i}`;
    const taeller = el.querySelector('.group-count');
    const navn = (taeller ? el.textContent.replace(taeller.textContent, '') : el.textContent).trim();
    return { el, navn: navn || `Section ${i + 1}` };
  });
  tocState.aktiv = -1;

  rail.innerHTML = tocState.punkter.map((p, i) => `
    <button class="toc-item" data-toc="${i}" title="${esc(p.navn)}">
      <span class="toc-dash"></span><span class="toc-tekst">${esc(p.navn)}</span>
    </button>`).join('');
  rail.hidden = false;

  rail.querySelectorAll('[data-toc]').forEach((el) => {
    el.addEventListener('click', () => {
      const p = tocState.punkter[Number(el.dataset.toc)];
      if (p) p.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
  markerToc();
}

/** Afsnittet, der lige er rullet forbi toppen, er det man er i. */
function markerToc() {
  if (!tocState.punkter.length) return;
  let i = 0;
  for (let n = 0; n < tocState.punkter.length; n++) {
    if (tocState.punkter[n].el.getBoundingClientRect().top <= 140) i = n;
  }
  if (i === tocState.aktiv) return;
  tocState.aktiv = i;
  const rail = document.getElementById('tocRail');
  if (!rail) return;
  rail.querySelectorAll('[data-toc]').forEach((el) => {
    el.classList.toggle('on', Number(el.dataset.toc) === i);
  });
}

// Én rAF pr. rulning: ellers laeses layout hundredvis af gange i sekundet.
let tocVenter = false;
window.addEventListener('scroll', () => {
  if (tocVenter || !tocState.punkter.length) return;
  tocVenter = true;
  requestAnimationFrame(() => { tocVenter = false; markerToc(); });
}, { passive: true });

window.addEventListener('resize', () => { byggToc(); });

/* --------------------------------------------------------------- start */

(async function start() {
  anvendTema(nuvaerendeTema());
  try {
    state.config = await api('GET', '/api/public-config');
    document.title = state.config.appName || 'Sagu';
    const me = await api('GET', '/api/me');
    state.user = me.user;
    if (state.user) await hentState();
  } catch (ex) {
    document.getElementById('root').innerHTML =
      `<div class="gate"><div class="card"><div class="brand">${icon('logo', 26)} Sagu</div>
       <p class="lead" style="text-align:center">Could not reach the server.<br>${esc(ex.message)}</p></div></div>`;
    return;
  }
  render();
  aabnFraAdressen();
  // Feltet skal have fokus ved opstart - man aabner et arkiv for at finde
  // noget. Ikke paa mobil: dér ville tastaturet daekke halve skaermen.
  if (state.user && state.view === 'search' && !smalSkaerm()) {
    const o = omniEl();
    if (o) o.focus();
  }
})();

/**
 * `#note-<id>` i adressen aabner den note.
 *
 * Saa kan et soegeresultat deles som et link, og en genindlaesning lander
 * samme sted i stedet for paa forsiden.
 */
function aabnFraAdressen() {
  if (!state.user) return;
  const m = String(location.hash || '').match(/^#note-([a-f0-9]{32})$/);
  if (m) aabnNote(m[1]);
}

window.addEventListener('hashchange', aabnFraAdressen);
