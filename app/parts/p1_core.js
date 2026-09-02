'use strict';
/* Sagu - kerne: opstart, tema, login, app-skal.
   Denne fil samles til public/app.js af build_rune.py. Redigér aldrig app.js.

   NB: interfacet er ENGELSK - som doda, og ogsaa den ramme, kollegaerne ser
   i wikien. Koden, kommentarerne og dokumenterne er dansk. */

const APP_VERSION = 46;

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
  prefs: {},
  // F14: viser vi noget, der kom fra offline-cachen?
  offline: false,
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
  // Reglen bor i `app/shared/maerker.js`, saa serveren og browseren tolker
  // `#maerke` ENS. Wrapperen bliver staaende, saa kaldstederne er uroerte.
  return saguMaerker.pluk(raa);
}

/**
 * Brugernavnet, som det skal SES - med stort begyndelsesbogstav.
 *
 * Reglen bor i det delte modul, fordi den ogsaa skal gaelde de sider,
 * SERVEREN tegner (samtykkesiden og wikiens kommentarer). Kun til visning:
 * den gemte vaerdi, alt der sammenlignes, og alt der sendes til serveren
 * skal blive ved med at vaere det, brugeren tastede.
 */
function pentBruger(navn) {
  return saguMarkdown.pentBrugernavn(navn);
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
    /*
     * Et fejlet kald ER offline, set fra appen.
     *
     * `navigator.onLine` kender kun netkortet - den er sand, naar man haenger
     * paa et wifi uden internet, eller naar serveren er nede. Baandet sagde
     * derfor »Sending 1 change…«, mens ingenting blev sendt. **Det, der
     * afgoer, om vi er offline, er om vi kan naa serveren** - ikke hvad
     * browseren mener om ledningen (F15).
     */
    saetOffline(true);
    throw Object.assign(
      new Error('No connection — this needs the network. Try again when you are back.'),
      { offline: true });
  }
  /*
   * Kom svaret fra offline-cachen, skal det SIGES.
   *
   * Service workeren saetter headeren, naar den serverer noget gammelt, fordi
   * netvaerket ikke svarede. En app, der viser gamle tal uden at sige det, er
   * vaerre end en, der siger »her er intet«: man traeffer beslutninger paa
   * noget, man tror er nyt (F14).
   */
  /*
   * Kom svaret fra serveren, er vi online igen - ogsaa selv om ingen
   * `online`-haendelse er kommet. Kom det fra cachen, er vi ikke.
   */
  saetOffline(res.headers.get('X-Sagu-Offline') === '1');

  let data = {};
  try { data = await res.json(); } catch { /* tomt svar er i orden */ }
  // API'et svarer {error: kode, message: laesbar tekst}. Mennesket skal se
  // beskeden; koden er til klienter.
  if (!res.ok) {
    /*
     * `needsCode` foelger MED fejlen.
     *
     * Fladen skal kunne skelne to 401'ere fra hinanden: et forkert kodeord
     * (fold kodefeltet vaek) og en forkert engangskode (lad det staa). Uden
     * feltet her ville et fejltastet ciffer se ud som et forkert kodeord, og
     * man ville taste det hele forfra (RUNE-ERFARINGER §9d).
     */
    throw Object.assign(new Error(data.message || data.error || `Error ${res.status}`),
      { status: res.status, code: data.error, needsCode: !!data.needsCode });
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
  // F16: markér en linje -> en opgave i doda.
  tjek: '<path d="M20 6.5L9.5 17 4 11.5"/>',
  pin: '<path d="M9 3.5h6l-1 5 3 3.5H7l3-3.5z"/><path d="M12 12v8.5"/>',
  out: '<path d="M14.5 4.5H18a1.5 1.5 0 011.5 1.5v12a1.5 1.5 0 01-1.5 1.5h-3.5"/><path d="M4.5 12h10M11 8.5l3.5 3.5-3.5 3.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M17.8 6.2l-1.4 1.4M7.6 16.4l-1.4 1.4M17.8 17.8l-1.4-1.4M7.6 7.6L6.2 6.2"/>',
  moon: '<path d="M20 14.6A8.6 8.6 0 019.4 4 8.6 8.6 0 1020 14.6z"/>',
  key: '<circle cx="8" cy="12" r="3.5"/><path d="M11.5 12H20M17 12v3M20 12v2.5"/>',
  caret: '<path d="M9 6l6 6-6 6"/>',
  // Tilbage. En venstre-pil med skaft - `ind` er et INDRYKNINGS-ikon og siger
  // »goer til underside«, ikke »tilbage«.
  tilbage: '<path d="M10.5 5.5L4 12l6.5 6.5"/><path d="M4 12h15"/>',
  focus: '<path d="M4 9V5.5A1.5 1.5 0 015.5 4H9"/><path d="M15 4h3.5A1.5 1.5 0 0120 5.5V9"/><path d="M20 15v3.5a1.5 1.5 0 01-1.5 1.5H15"/><path d="M9 20H5.5A1.5 1.5 0 014 18.5V15"/>',
  dots: '<circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/>',
  comment: '<path d="M20 12.5a6.5 6.5 0 01-6.5 6.5H9l-4 2.5v-4A6.5 6.5 0 016.5 6h7A6.5 6.5 0 0120 12.5z"/>',
  copy: '<path d="M9 9h10v10a1.5 1.5 0 01-1.5 1.5H9z"/><path d="M15 9V4.5A1.5 1.5 0 0013.5 3H5.5A1.5 1.5 0 004 4.5v9A1.5 1.5 0 005.5 15H9"/>',
  luk: '<path d="M6 6l12 12M18 6L6 18"/>',
  kalender: '<path d="M4.5 6.5h15v13h-15z"/><path d="M4.5 10h15M9 4.5v3M15 4.5v3"/>',
  skabelon: '<path d="M4.5 5.5h15v13h-15z"/><path d="M4.5 9.5h15M9.5 9.5v9"/>',
  klips: '<path d="M17 8.5l-6.6 6.6a2.5 2.5 0 003.5 3.5l6.6-6.6a4.5 4.5 0 00-6.4-6.4l-6.6 6.6a6.5 6.5 0 009.2 9.2l5.8-5.8"/>',
  // F12. Tegnet er GitHubs kat, forenklet til den samme stregtykkelse som
  // resten - et fremmed logo hentet fra et CDN ville baade bryde CSP'en og
  // se ud som et fremmedlegeme.
  github: '<path d="M9.5 20.5c-4 1.2-4-2.2-5.5-2.7m11 5.2v-3.4c0-1 .1-1.4-.5-2 2.6-.3 5-1.3 5-5.6a4.3 4.3 0 00-1.2-3 4 4 0 00-.1-3s-1-.3-3.2 1.2a11 11 0 00-5.8 0C7 5.7 6 6 6 6a4 4 0 00-.1 3 4.3 4.3 0 00-1.2 3c0 4.3 2.4 5.3 5 5.6-.6.6-.6 1.2-.5 2v3.4"/>',
  opfrisk: '<path d="M20 12a8 8 0 11-2.3-5.7"/><path d="M20 4v4.5h-4.5"/>',
  laas: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5"/>',
  stjerne: '<path d="M12 3.8l2.5 5.1 5.6.8-4 4 .9 5.6-5-2.6-5 2.6.9-5.6-4-4 5.6-.8z"/>',
  tastatur: '<rect x="3" y="6.5" width="18" height="11" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M17 10h.01M7 14h10"/>',
  offline: '<path d="M3 3l18 18"/><path d="M8.5 16.5a5 5 0 017 0"/><path d="M5 13a10 10 0 013.5-2.3M19 13a10 10 0 00-6.5-2.9"/><path d="M2 9.5A15 15 0 016 7M22 9.5a15 15 0 00-8.5-3.4"/>',
  stjerneFuld: '<path fill="currentColor" d="M12 3.8l2.5 5.1 5.6.8-4 4 .9 5.6-5-2.6-5 2.6.9-5.6-4-4 5.6-.8z"/>',
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
  // group: 0 - naas fra Settings, hvor noeglerne bor. En opskrift hoerer
  // ved siden af det, den handler om.
  { id: 'api', label: 'API & Shortcuts', icon: 'settings', group: 0 },
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
const BAG_BRUGEREN = new Set(['settings', 'import', 'api']);

const BESKRIVELSER = {
  notes: 'Everything you have written, newest first.',
  search: 'Search titles, headings, body text, tags and properties.',
  tags: 'Your tags, and what is filed under each.',
  comments: 'What people wrote on your notes — and what is waiting to be read.',
  shared: 'Notes other people have shared with you.',
  trash: 'Deleted notes. They are removed for good after 30 days.',
  import: 'Bring your Notion archive in, and take everything out again whenever you like.',
  settings: 'Appearance, account and access.',
  api: 'How to reach Sagu from an iPhone shortcut, or from another program.',
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
        <label class="field" id="gateKodeFelt" ${state.gateKode ? '' : 'hidden'}>
          <span>Code from your authenticator app</span>
          <input class="input" id="gateKode" inputmode="numeric" autocomplete="one-time-code"
            autocapitalize="characters" placeholder="123456" spellcheck="false"></label>
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
      const krop = {
        username: document.getElementById('gateUser').value,
        password: document.getElementById('gatePass').value,
      };
      // Feltet sendes kun med, naar det ER fremme. Ellers ville en tom kode
      // blive et forsoeg, og serveren braendte et vindue for ingenting.
      const kodeFelt = document.getElementById('gateKode');
      if (state.gateKode && kodeFelt && kodeFelt.value.trim()) krop.code = kodeFelt.value.trim();
      const data = await api('POST', opretter ? '/api/register' : '/api/login', krop);

      /*
       * Kodeordet passede, men vi er kun halvvejs.
       *
       * Svaret er 200 og BAERER INGEN cookie - der staar bare, at der mangler
       * et led. Feltet foldes ud, og der staar en besked; en tom formular,
       * der bare ikke gjorde noget, ville se ud som en fejl.
       */
      if (data && data.needsCode) {
        /*
         * Feltet VISES - formularen tegnes ikke om.
         *
         * Foerste udgave kaldte `render()`, og saa blev baade brugernavn og
         * kodeord ryddet i samme oejeblik: man tastede sin kode og sendte en
         * TOM formular, hvorpaa serveren svarede »Wrong username or
         * password«. Det saa ud, som om kodeordet var forkert - og det var
         * det, man lige havde skrevet rigtigt (maalt i browseren,
         * 2026-08-24).
         *
         * Feltet staar der i forvejen, bare skjult. Der er intet at tegne.
         */
        state.gateKode = true;
        const boks = document.getElementById('gateKodeFelt');
        if (boks) boks.hidden = false;
        const felt = document.getElementById('gateKode');
        if (felt) felt.focus();
        const besked = document.getElementById('gateError');
        besked.textContent = 'Enter the six-digit code from your authenticator app '
          + '— or one of your recovery codes.';
        besked.hidden = false;
        besked.classList.add('gate-info');
        return;
      }
      state.gateKode = false;
      state.user = data.user;
      state.config.needsSetup = false;
      if (fortsaetTilConnector()) return;
      await hentState();
      render();
    } catch (ex) {
      /*
       * Kodefeltet bliver staaende ved en forkert ENGANGSKODE og foldes vaek
       * ved et forkert kodeord. Det er hele grunden til, at serveren svarer
       * forskelligt paa de to.
       */
      // Samme grund: fold feltet vaek uden at roere det, der er tastet.
      if (state.gateKode && !ex.needsCode) {
        state.gateKode = false;
        const boks = document.getElementById('gateKodeFelt');
        if (boks) boks.hidden = true;
      }
      const boks = document.getElementById('gateError');
      boks.textContent = ex.message;
      boks.classList.remove('gate-info');
      boks.hidden = false;
      const felt = document.getElementById('gateKode');
      if (felt && ex.needsCode) { felt.value = ''; felt.focus(); }
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
        // Ogsaa her: begge veje ind skal kunne fortsaette til samtykkesiden,
        // ellers virker connectoren kun for den, der taster sit kodeord.
        if (fortsaetTilConnector()) return;
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

/*
 * ── Menuknappen staar i BJAELKEN, ikke i skaermens hjoerne ────────────────
 *
 * Den var `position: fixed` med et hoejere lag end topbjaelken. Da bjaelken
 * blev klaebende (v23), laa knappen dermed OVEN PAA soegefeltet, saa snart man
 * rullede - to ting, der begge vil vaere oeverst, og kun den ene kan vinde
 * (Andreas, 2026-08-24).
 *
 * Inde i raekken er der ingen strid om pladsen: bjaelken er ét element, der
 * klaeber, og knappen foelger med af sig selv. Samme sted som i doda.
 *
 * Derfor kan `body.navskjult .main { padding-left: 64px }` ogsaa forsvinde -
 * den fandtes kun for at holde plads fri til en knap, der svaevede.
 *
 * ── Og hvorfor feltet har sin egen indpakning ─────────────────────────────
 *
 * `omniHtml()` giver BAADE soegekortet og maerke-chipsene, og chipsene hoerer
 * UNDER kortet - ikke ved siden af det. Uden `.topraekke-felt` blev de et
 * flex-element nummer to i raekken, raekkens `gap` slog til, og soegefeltet
 * blev ti pixel smallere end indholdet nedenunder. Maalt, da Andreas spurgte
 * hvorfor bredderne ikke passede (2026-08-25).
 */
function shellHtml() {
  return `
  <div class="backdrop" id="backdrop"></div>
  <div class="app">
    <aside class="sidebar">
      <div class="brand">${icon('logo', 24)} <span style="flex:1;min-width:0">${esc(state.config.appName || 'Sagu')}</span>
        <button class="pinbtn" id="pinBtn" aria-label="Hide the menu"
          title="Hide the menu">${icon('pin', 16)}</button></div>
      <div id="navHost">${navHtml()}</div>
      <!-- Fyldes af tegnGenveje() i bindShell, praecis som traeet nedenfor. -->
      <div id="navGenveje"></div>
      <div id="treeHost" class="treehost"></div>
      <div class="sidebar-foot">
        <button class="nav-item" id="userBtn"
          ${BAG_BRUGEREN.has(state.view) ? 'aria-current="page"' : ''}>${icon('settings')}<span>${esc(pentBruger(state.user.username))}</span></button>
        <div class="foot-row" id="footRow">${versionHtml()}</div>
      </div>
    </aside>
    <main class="main">
      <div class="opdater-baand" id="opdaterBaand" hidden>
        ${icon('opfrisk', 15)}
        <span class="baand-tekst"></span>
        <button class="btn" id="opdaterNu">Update</button>
      </div>
      <div class="offline-baand" id="offlineBaand" hidden>
        ${icon('offline', 15)}
        <span class="baand-tekst">Offline — showing what was loaded last.</span>
      </div>
      <div class="topbar">
        <div class="toprow">
          <button class="synkbtn meta" id="synkBtn" title="Fetch new notes now"
            aria-label="Fetch new notes now">${icon('opfrisk', 14)}<span id="synkLabel">just now</span></button>
          <div class="stats meta" id="statsHost">${statsHtml()}</div>
          ${temaKnapHtml()}
        </div>
        <div class="topraekke">
          <button class="btn navtoggle" id="navToggle" aria-label="Menu">${icon('menu')}</button>
          <div class="topraekke-felt">${omniHtml()}</div>
        </div>
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
  // »1 notes« stod der foer. Et tal og et ord, der ikke passer sammen, er
  // smaat - men det er ogsaa det foerste, oejet falder paa i toppen.
  const stk = (n, ental, flertal) => `${n} ${n === 1 ? ental : flertal}`;
  if (c.notes) dele.push(stk(c.notes, 'note', 'notes'));
  if ((state.notebooks || []).length) {
    dele.push(stk(state.notebooks.length, 'notebook', 'notebooks'));
  }
  if (c.archived) dele.push(`${c.archived} archived`);
  if (c.trash) dele.push(`${c.trash} in trash`);
  return dele.map((d) => `<span>${esc(d)}</span>`).join('');
}

/*
 * Kun NYERE taeller som en opdatering.
 *
 * Sammenligningen var `!==`, og den er forkert i den ene retning: er
 * serverens tal LAVERE end det, browseren koerer - en rullet udgivelse, eller
 * en serverproces, der ikke er genstartet - saa staar der »v5 is ready, you
 * are running v6«, og det er noget vaas. Maalt i udvikling, hvor netop det
 * skete (2026-08-21).
 */
function versionHtml() {
  const server = state.config.version;
  const gammel = server && server > APP_VERSION;
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
  registrerRullevagt();
  bindTemaKnap();
  const synk = document.getElementById('synkBtn');
  if (synk) synk.addEventListener('click', () => opfriskAlt());

  bindOmni();
  tegnLegend();
  /*
   * Favoritter og spor tegnes HER - ikke i `shellHtml()`.
   *
   * De stod som markup inde i skallen, men blev kun BUNDET af
   * `tegnGenveje()`. Efter en fuld optegning - altsaa hver sideindlaesning -
   * havde punkterne under »Recent« og »Favourites« derfor ingen klik-handler:
   * de saa rigtige ud og gjorde ingenting, indtil noget andet tilfaeldigvis
   * kaldte `tegnGenveje()` (Andreas, 2026-08-21).
   *
   * Kuren er ikke et kald mere ved siden af det foerste - det ville vaere
   * det samme problem én linje senere. **Ét sted tegner OG binder**, praecis
   * som `tegnTrae()` under her. Saa kan de to ikke skilles ad igen.
   */
  tegnGenveje();
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
  if (vBtn) vBtn.addEventListener('click', () => hentNyVersion());
  const opdKnap = document.getElementById('opdaterNu');
  if (opdKnap) opdKnap.addEventListener('click', () => hentNyVersion());
  visOpdaterBaand();

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
/* ------------------------------------------------------ tilbage (F26)
 *
 * »Kan du lave en back knap. hvis man fx klikker paa et link i en note som
 * goer at man bliver sendt til en anden note, men gerne vil retur igen?«
 * (Andreas, 2026-09-01).
 *
 * ── Hvorfor et EGET spor og ikke browserens historik ──────────────────────
 *
 * v42 valgte med vilje `replaceState` frem for `pushState`, saa browserens
 * tilbage-knap ikke gaar gennem hver eneste note, man har kigget paa - en
 * note aabnes ad mindst seks veje, og flere af dem taenker man ikke paa som
 * en navigation.
 *
 * Det valg staar ved magt. Men et eget spor kan noget, browserens ikke kan:
 * det ved, HVAD man gaar tilbage til, og kan skrive det paa knappen. »Back to
 * Pakke stoerrelser« er et loefte; en pil er et gaet.
 *
 * ── Naar der IKKE huskes ─────────────────────────────────────────────────
 *
 * Ved en opfriskning af den note, man allerede staar paa (`tving`), og ved en
 * tilbage-tur selv. Uden det ville sporet vokse ved hver
 * traek-ned-for-at-opfriske, og tilbage-knappen ville vippe mellem to noter i
 * stedet for at gaa hjem.
 */
const tilbagespor = [];
const TILBAGE_LOFT = 50;
let gaarTilbage = false;

/** Navnet paa det, man ville komme tilbage TIL. */
function sporNavn(post) {
  if (post.note) return post.titel || 'the note';
  const v = (typeof VIEWS !== 'undefined' ? VIEWS : []).find((x) => x.id === post.view);
  return (v && v.label) || 'back';
}

/**
 * Laeg det, man staar paa NU, i sporet.
 *
 * Kaldes FOER `state` aendres - ellers husker den det sted, man er paa vej
 * hen, og knappen bliver en genindlaesning.
 */
function husk() {
  if (gaarTilbage || !state.user) return;
  const post = {
    view: state.view,
    note: state.openNote || null,
    tag: state.filterTag || null,
    notebook: state.openNotebook || null,
    titel: (typeof editor === 'object' && editor.note && editor.note.id === state.openNote)
      ? editor.note.title : '',
  };
  const sidste = tilbagespor[tilbagespor.length - 1];
  // Samme sted to gange i traek er ikke to skridt.
  if (sidste && sidste.view === post.view && sidste.note === post.note
      && sidste.tag === post.tag && sidste.notebook === post.notebook) return;
  tilbagespor.push(post);
  if (tilbagespor.length > TILBAGE_LOFT) tilbagespor.shift();
}

function kanGaaTilbage() {
  return tilbagespor.length > 0;
}

/**
 * Ét skridt tilbage.
 *
 * `gaarTilbage` er den vagt, der goer det til et SKRIDT og ikke en vippen:
 * uden den ville turen tilbage selv blive husket, og knappen ville sende én
 * frem igen.
 */
function gaaTilbage() {
  const post = tilbagespor.pop();
  if (!post) return;
  gaarTilbage = true;
  try {
    if (post.note) {
      aabnNote(post.note);
    } else {
      gaaTil(post.view, { tag: post.tag, notebook: post.notebook });
    }
  } finally {
    /*
     * Vagten slaas fra i naeste tur om loekken, ikke med det samme.
     *
     * `aabnNote` er asynkron: den saetter `state` med det samme, men naar
     * foerst frem til optegningen bagefter. Ryddede vi flaget her, ville den
     * optegning kunne naa at huske det sted, vi lige forlod.
     */
    setTimeout(() => { gaarTilbage = false; }, 0);
  }
}

function gaaTil(view, opt) {
  // En ventende gemning maa ikke gaa tabt, fordi man klikker i sidebaren.
  if (typeof gemNu === 'function') gemNu();
  const skifter = state.view !== view;
  // Husk hvor vi stod - FOER `state` aendres.
  if (skifter || state.openNote) husk();
  const havdeFilter = !!(state.openNote || state.filterTag || state.openNotebook);
  state.view = view;
  state.openNote = null;
  state.filterTag = null;
  state.openNotebook = null;
  if (typeof editor === 'object') { editor.note = null; editor.aabenBlok = null; }
  document.body.classList.remove('fokus');
  if (opt && opt.tag !== undefined) state.filterTag = opt.tag;
  if (opt && opt.notebook !== undefined) state.openNotebook = opt.notebook;
  document.body.classList.remove('navopen');
  /*
   * Adressen ryddes, naar man forlader noten.
   *
   * Ellers ville »gaa til Search og opfrisk« kaste én tilbage til den note,
   * man lige forlod - altsaa den samme fejl som foer, bare med modsat
   * fortegn. Adressen skal sige, hvad man ser.
   */
  if (typeof saetAdresse === 'function') saetAdresse(null);
  opdaterNav();
  tegnSide();
  // Scroll kun til toppen ved reelt sideskift - ellers kastes brugeren op,
  // hver gang en inline-redigering gentegner (RUNE-ERFARINGER §4).
  if (skifter || havdeFilter) tilToppen();
}

/**
 * Til toppen - uanset HVEM der ruller.
 *
 * ── Hvorfor der staar tre linjer og ikke én ───────────────────────────────
 *
 * Her stod `window.scrollTo(0, 0)`, og paa en telefon gjorde den INGENTING.
 * Maalt paa 375 px: rullet til 800, `window.scrollTo(0, 0)`, og
 * `document.body.scrollTop` staar stadig paa 800. Skiftede man side, landede
 * man midt i den nye.
 *
 * Grunden er `@media (max-width: 900px) { html, body { overflow-x: hidden } }`
 * sammen med `html, body { height: 100% }`: naar den ene akse ikke er
 * `visible`, beregnes den anden til `auto`, og saa er det BODY, der er
 * rulleboksen. Paa en bred skaerm er det stadig dokumentet. Maalt:
 * `getComputedStyle(document.body).overflowY === 'auto'` under 900 px.
 *
 * Vi saetter derfor alle tre i stedet for at gaette. Det er samme greb som
 * `heltOppe()` i F19 - bare den anden vej.
 *
 * ── Og hvorfor den staar her, ikke inde i `gaaTil` ────────────────────────
 *
 * En kollega-session fandt fejlen ved at lede efter faelden ét sted mere, end
 * jeg selv gjorde: jeg skrev erkendelsen ned i en kommentar i F19 og rettede
 * kun dét ene sted. **En erkendelse, der kun bliver til en kommentar, er ikke
 * en rettelse.** Naeste gang nogen skal rulle et sted hen, findes funktionen
 * nu - saa der ikke er noget at gaette om.
 */
function tilToppen() {
  window.scrollTo(0, 0);
  document.body.scrollTop = 0;
  document.documentElement.scrollTop = 0;
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
    // Personlige valg om, hvordan fladen opfoerer sig. De skal vaere kendt
    // FOER foerste optegning - ellers tegnes den foerste note med den ene
    // editor og hopper til den anden et oejeblik efter.
    state.prefs = d.prefs || {};
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
  /*
   * Genvejsoversigten staar HER, fordi en genvej, man ikke kan FINDE, ikke
   * findes (RUNE-ERFARINGER, tovo v8). Spoergsmaalstegnet er den eneste vej
   * ind i listen, og det kan man kun taste, hvis man ved, det er der.
   */
  host.innerHTML = `
    <div class="usermenu-head">
      <div class="usermenu-name">${esc(pentBruger(state.user.username))}</div>
      <div class="meta">${state.user.isAdmin ? 'Administrator' : 'Signed in'}${state.config.secureContext ? '' : ' · plain http'}</div>
    </div>
    <button class="usermenu-item" data-go="import">${icon('import', 17)}<span>Import &amp; export</span></button>
    <button class="usermenu-item" data-go="settings">${icon('settings', 17)}<span>Settings</span></button>
    <button class="usermenu-item" data-go="genveje">${icon('tastatur', 17)}<span>Keyboard shortcuts</span>
      <kbd style="margin-left:auto">?</kbd></button>
    <button class="usermenu-item danger" data-go="logout">${icon('out', 17)}<span>Log out</span></button>`;
  fod.appendChild(host);

  const luk = () => host.remove();
  host.querySelectorAll('[data-go]').forEach((el) => {
    el.addEventListener('click', async () => {
      const hvad = el.dataset.go;
      luk();
      if (hvad === 'genveje') { visGenvejsPanel(); return; }
      if (hvad === 'settings' || hvad === 'import') { gaaTil(hvad); return; }
      /*
       * Ryd offline-cachen FOER logout-kaldet.
       *
       * En cache overlever en session. Uden det her ville en telefon, man
       * har logget ud af, stadig kunne vise noterne fra sidste gang - og det
       * er en helt anden aftale end den, »log ud« giver indtryk af (F14).
       */
      ryddOffline();
      ryddKoe();
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

/* --------------------------------------------- ny version (F17) */

/*
 * »Der er kommet en ny version.«
 *
 * Versionslinjen i sidebarens fod har kunnet sige det siden F0 - men paa en
 * telefon staar foden BAG hamburgeren, saa man ser den aldrig. Beskeden hoerer
 * dér, hvor man er.
 *
 * Tallet kommer fra serveren (`/api/public-config`), og `APP_VERSION` er
 * bagt ind i den app.js, browseren koerer. Er de forskellige, sidder der en
 * gammel fil i cachen - og saa er DET, brugeren skal vide, ikke
 * versionsnummeret alene.
 */
function visOpdaterBaand() {
  const b = document.getElementById('opdaterBaand');
  if (!b) return;
  const server = state.config.version;
  // Kun NYERE - se versionHtml(). En aeldre server er ikke en opdatering.
  const ny = server && server > APP_VERSION;
  b.hidden = !ny;
  if (!ny) return;
  const t = b.querySelector('.baand-tekst');
  if (t) {
    t.innerHTML = `<strong>Sagu v${esc(String(server))} is ready.</strong> `
      + `You are running v${esc(String(APP_VERSION))}. Updating reloads the app and `
      + 'fetches your notes again.';
  }
}

/**
 * Spoerger serveren, om der er kommet noget nyt.
 *
 * Kaldes naar fanen kommer FREM igen - det er dét oejeblik, en telefon vender
 * tilbage til appen efter en opdatering paa serveren. Uden det ville beskeden
 * foerst dukke op ved naeste genindlaesning, og saa er den overfloedig.
 *
 * Fejler kaldet, sker der ingenting: man er formentlig offline, og saa er en
 * ny version det mindste af det.
 */
async function tjekVersion() {
  try {
    const c = await api('GET', '/api/public-config');
    state.config.version = c.version;
    visOpdaterBaand();
  } catch { /* offline - se F14's eget baand */ }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.user) tjekVersion();
});

/*
 * `body.rullet` - er siden rullet ned fra toppen?
 *
 * Den klaebende topbjaelke bruger den til at folde tallene og legenden
 * sammen, saa kun soegefeltet bliver staaende (F20).
 *
 * ── Den fejl, ÉN taerskel gav ─────────────────────────────────────────────
 *
 * Meldt fra doda-sessionen (2026-08-25): bjaelken flimrede ved rulning, »som
 * om den gaar i hak«. Aarsagen er, at sammenfoldningen SELV goer dokumentet
 * kortere. Er der mindre tilbage at rulle i end den hoejde, bjaelken giver
 * slip paa, klipper browseren rullepositionen til det, der er plads til -
 * toppen kommer i syne, klassen ryger af, bjaelken vokser, dokumentet bliver
 * laengere, man kan rulle igen. Frem og tilbage, mange gange i sekundet.
 *
 *     (dokumenthoejde - skaermhoejde) < det, bjaelken krymper
 *
 * MAALT i Sagu paa 1280x800: bjaelken krymper **70 px**, og en note paa fire
 * til seks korte afsnit har 0-56 px at rulle i, naar den er foldet.
 * Betingelsen holder altsaa. Den rammer KUN korte sider, og det er praecis
 * derfor den kan have staaet laenge uden at blive fanget.
 *
 * `rootMargin: -8px` var taenkt som hysterese, og det ER det - men 8 px er
 * langt mindre end de 70, bjaelken giver tilbage. Justeringen springer let
 * hen over dem.
 *
 * ── Kuren: to taerskler og et gulv ────────────────────────────────────────
 *
 * Afstanden mellem taersklerne skal vaere STOERRE end det, bjaelken krymper -
 * ellers kan justeringen naa ned under den nedre, og loekken er der igen.
 * 120 - 8 = 112 > 70.
 *
 * Og `RULLET_PLADS`: uden det ville bjaelken aldrig folde sig paa en kort
 * side, fordi man ikke KAN naa 120 px. Doda-sessionen faldt selv i den -
 * maalingen sagde »0 skift, ingen flimmer«, hvilket saa ud som en sejr, men
 * fejlen var fjernet ved at fjerne funktionen. Gulvet siger i stedet: fold
 * kun sammen, hvis der er rigeligt at rulle i.
 *
 * ── Hvorfor en scroll-lytter nu, naar v23 valgte den fra ──────────────────
 *
 * v23 skrev: »hvem ruller?« er en faelde, og en programmatisk rulning giver
 * NUL scroll-haendelser. Begge dele staar ved magt - jeg har maalt dem igen i
 * dag. Men de rammer PROEVEN, ikke brugeren: med et rigtigt hjul-scroll kom
 * der baade scroll-haendelser og observer-fyringer i den samme rude. Og »hvem
 * ruller« har vi siden faaet et svar paa i `heltOppe()`, som `rulletNed()`
 * genbruger.
 *
 * En `IntersectionObserver` paa en vagtpost kan kun ÉT skifte, og det er dét,
 * der ikke raekker: to taerskler kraever to tal at sammenligne med.
 *
 * Selve beslutningen ligger derfor i `skalVaereRullet()` - en REN funktion.
 * Hverken observeren eller lytteren kan drives programmatisk i et testmiljoe,
 * saa regnestykket er det eneste sted, fejlen kan fanges uden en finger paa
 * et hjul.
 */
const RULLET_TIL = 120;      // folder sammen her
const RULLET_FRA = 8;        // folder foerst ud igen her
const RULLET_PLADS = 200;    // og kun hvis der er saa meget at rulle i

/**
 * Hvor langt er der rullet? Max af de tre, der kan vaere rulleboksen.
 *
 * `window.scrollY` er ALTID 0, naar body er rulleboksen - og det er den under
 * 900 px, fordi `overflow-x: hidden` faar den anden akse til at blive `auto`.
 * Den fejl har kostet tre gange (traek-ned, op-til-toppen, og her).
 */
function rulletNed() {
  return Math.max(window.scrollY || 0,
    document.body.scrollTop || 0,
    document.documentElement.scrollTop || 0);
}

/** Hvor meget er der overhovedet at rulle i? */
function rullePlads() {
  return Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)
    - window.innerHeight;
}

/**
 * Skal bjaelken vaere foldet sammen?
 *
 * @param {boolean} rullet  staar den foldet lige nu?
 * @param {number} y        hvor langt der er rullet
 * @param {number} plads    hvor meget der er at rulle i
 */
function skalVaereRullet(rullet, y, plads) {
  if (!rullet) return y > RULLET_TIL && plads > RULLET_PLADS;
  return y >= RULLET_FRA;
}

function registrerRullevagt() {
  let rullet = document.body.classList.contains('rullet');
  const tjek = () => {
    const nu = skalVaereRullet(rullet, rulletNed(), rullePlads());
    if (nu === rullet) return;
    rullet = nu;
    document.body.classList.toggle('rullet', nu);
  };
  // Begge mulige rullebokse. Hvilken der er den rigtige, afhaenger af
  // skaermbredden, og det maa den her ikke skulle vide.
  window.addEventListener('scroll', tjek, { passive: true });
  document.body.addEventListener('scroll', tjek, { passive: true });
  /*
   * Ogsaa ved `resize`: `rullePlads()` afhaenger af skaermhoejden. Drejer man
   * en telefon, kan en side, der havde rigeligt at rulle i, pludselig ikke
   * have det - og saa skal bjaelken ud igen, uden at nogen har rullet.
   */
  window.addEventListener('resize', tjek, { passive: true });
  tjek();
}

/**
 * Henter den nye app.
 *
 * Cachen ryddes FOER genindlaesningen - baade fra siden og gennem service
 * workeren. Uden det serverer workeren bare den samme gamle `app.js` igen, og
 * knappen ville se ud, som om den ikke gjorde noget (RUNE-ERFARINGER §5).
 */
async function hentNyVersion() {
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage('ryd');
    }
    if (window.caches) await Promise.all((await caches.keys()).map((n) => caches.delete(n)));
    // Workeren selv skal ogsaa afloeses - ellers styrer den gamle stadig.
    if (navigator.serviceWorker) {
      for (const r of await navigator.serviceWorker.getRegistrations()) await r.update();
    }
  } catch { /* uden cache-api er der ikke noget at rydde */ }
  location.reload();
}

/* ------------------------------------------------------ offline (F14) */

/*
 * Service workeren registreres, saa noterne kan LAESES uden net.
 *
 * `./sw.js` uden en `?v=` med vilje: browseren sammenligner selve FILEN byte
 * for byte og opdaterer workeren, naar den er aendret. Et versionsnummer i
 * adressen ville lave en ny worker pr. udgivelse i stedet for at afloese den
 * gamle - og saa ville to workere slaas om den samme cache.
 *
 * Fejler registreringen, sker der ingenting. Offline er en TILGIFT; appen
 * skal virke praecis som foer uden den.
 */
function registrerOffline() {
  if (!('serviceWorker' in navigator)) return;
  // Kun over https (eller localhost). Panelet naas paa ren http, hvor en
  // service worker slet ikke findes - og en fejl i konsollen dér ville se ud
  // som om noget var i stykker.
  if (location.protocol !== 'https:' && location.hostname !== 'localhost'
      && location.hostname !== '127.0.0.1') return;
  navigator.serviceWorker.register('./sw.js').catch(() => { /* en tilgift */ });
}

/** Alt cachet indhold vaek. Kaldes ved log ud. */
function ryddOffline() {
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage('ryd');
    }
    if (window.caches) caches.keys().then((n) => n.forEach((x) => caches.delete(x)));
  } catch { /* ingen cache at rydde */ }
}

/**
 * Baandet, der siger det HOEJT.
 *
 * En app, der viser gamle tal uden at sige det, er vaerre end en, der siger
 * »her er intet«: man traeffer beslutninger paa noget, man tror er nyt. Derfor
 * saetter service workeren `X-Sagu-Offline` paa et svar fra cachen, og
 * `api()` taender baandet.
 */
function saetOffline(gammelt) {
  const nu = !!gammelt;
  if (state.offline === nu) return;
  const varOffline = state.offline;
  state.offline = nu;
  // Kommer vi tilbage, saa send det, der venter - uden at vente paa
  // browserens `online`-haendelse, som maaske aldrig kommer.
  if (varOffline && !nu && typeof synkKoe === 'function') synkKoe();
  // Baandets TEKST skrives ét sted (`visKoeBaand`), fordi den skal kunne sige
  // baade »offline« og »der venter tre rettelser« - og de to er den samme
  // besked set fra hver sin side.
  visKoeBaand();
}

window.addEventListener('online', () => {
  saetOffline(false);
  // Send det, der venter, FOER vi henter: ellers henter vi den gamle udgave
  // ned oven i den rettelse, der stod i koen (F15).
  synkKoe().then(() => {
    if (state.user) return hentState().then(() => tegnSide());
    return null;
  }).catch(() => {});
});
window.addEventListener('offline', () => saetOffline(true));

/* --------------------------------------------------------------- start */

/**
 * Adressen at vende tilbage til, naar man er logget ind.
 *
 * Serveren sender `?next=/oauth/authorize?...` hertil, naar en connector beder
 * om samtykke og der ingen session er. **KUN den ene sti accepteres** - alt
 * andet ville vaere en aaben viderestilling, og en connector-godkendelse er
 * praecis det sted, hvor man ikke skal kunne lokkes videre.
 */
function oauthNaeste() {
  try {
    const n = new URLSearchParams(location.search).get('next') || '';
    return n.startsWith('/oauth/authorize?') ? n : null;
  } catch { return null; }
}

/** Kaldes efter login. Returnerer true, hvis siden er paa vej et andet sted hen. */
function fortsaetTilConnector() {
  const n = oauthNaeste();
  if (!n) return false;
  location.replace(n);
  return true;
}

(async function start() {
  anvendTema(nuvaerendeTema());
  registrerOffline();
  try {
    state.config = await api('GET', '/api/public-config');
    document.title = state.config.appName || 'Sagu';
    const me = await api('GET', '/api/me');
    state.user = me.user;
    state.flereBrugere = !!me.flereBrugere;
    // Var jeg allerede logget ind, da connectoren sendte mig herhen, skal jeg
    // slet ikke se appen - kun samtykkesiden.
    if (state.user && fortsaetTilConnector()) return;
    if (state.user) await hentState();
    // Favoritter og spor hentes ÉN gang her - ikke ved hver optegning.
    if (state.user) await hentGenveje();
    /*
     * Koen laeses FOER foerste optegning, saa baandet kan sige det med det
     * samme - og sendes bagefter. Browseren kan vaere lukket, mens den var
     * offline, saa `online`-haendelsen kommer aldrig (F15).
     */
    if (state.user) { laesKoe(); }
  } catch (ex) {
    document.getElementById('root').innerHTML =
      `<div class="gate"><div class="card"><div class="brand">${icon('logo', 26)} Sagu</div>
       <p class="lead" style="text-align:center">Could not reach the server.<br>${esc(ex.message)}</p></div></div>`;
    return;
  }
  render();
  visKoeBaand();
  if (state.user && navigator.onLine) synkKoe(true);
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

/**
 * Skriver adressen, saa den passer til det, man ser.
 *
 * »Er det muligt at lave at naar man laver en refresh paa en note at den saa
 * bliver paa noten i stedet for at hoppe til forsiden?« (Andreas,
 * 2026-09-01).
 *
 * Mekanikken til at LAESE `#note-<id>` har vaeret der siden F13, og
 * kommentaren ovenfor lovede endda, at »en genindlaesning lander samme sted«.
 * Den gjorde den bare aldrig: ingen skrev adressen, naar man aabnede en note
 * ved at KLIKKE. Adressen blev kun sat, hvis man kom udefra med et link.
 *
 * ── `replaceState` og ikke `location.hash = …` ────────────────────────────
 *
 * At saette `location.hash` fyrer `hashchange`, som kalder
 * `aabnFraAdressen()`, som kalder `aabnNote()` igen. Vagten mod »samme note«
 * fanger det som regel - men netop som regel: mens noten stadig HENTES, er
 * `editor.note` den forrige, og saa slipper kaldet igennem. En adresselinje
 * maa ikke kunne saette en hentning i gang.
 *
 * ── `replaceState` og ikke `pushState` ────────────────────────────────────
 *
 * `pushState` ville lade browserens tilbage-knap gaa gennem de noter, man har
 * kigget paa. Det lyder bedre end det er: en note aabnes ad mindst seks veje,
 * og flere af dem sker uden at man taenker paa det som en navigation. Her er
 * kun bedt om, at en OPFRISKNING lander samme sted - og det er `replaceState`
 * praecis.
 */
function saetAdresse(noteId) {
  const oensket = noteId ? `#note-${noteId}` : '';
  // Ingen skrivning, hvis den allerede staar rigtigt: en tom `replaceState`
  // pr. optegning er stoej i browserens historik-log.
  const nu = String(location.hash || '');
  if (nu === oensket) return;
  try {
    /*
     * `location.pathname + location.search` skal MED.
     *
     * Uden dem kaster Safari paa en `file:`- eller sandkasse-oprindelse, og
     * en tom streng ville i oevrigt rydde stien. Det er kun fragmentet, der
     * skal skiftes.
     */
    history.replaceState(null, '', `${location.pathname}${location.search}${oensket}`);
  } catch { /* uden history-api staar adressen bare stille */ }
}
