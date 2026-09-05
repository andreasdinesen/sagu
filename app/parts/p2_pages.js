'use strict';
/* Sagu - siderne.
 *
 * Note-siden selv bor i p4_editor.js; her er listerne, soegningen,
 * papirkurven og indstillingerne.
 *
 * En skaerm, der endnu ikke er bygget, siger det AERLIGT med sit fasenummer
 * frem for at staa tom - en tom side ligner en fejl, ikke en plan. */

/** Kaldes ét sted, saa sideoversigten aldrig kan glemmes i en af grenene. */
async function tegnSide() {
  await tegnSideIndhold();
  byggToc();
  // Titlen hoerer til her af samme grund som sideoversigten: ét sted, saa den
  // ikke kan glemmes i en af de mange grene, der aabner en note (F29).
  vinduestitel();
}

/*
 * Spaltens bredde er den SAMME overalt (se style.css).
 *
 * Her stod `BREDE_SIDER` - en liste over de skaerme, der maatte vaere brede.
 * Den er vaek, fordi den var selve problemet: indholdet skiftede bredde fra
 * skaerm til skaerm, mens soegefeltet stod stille.
 *
 * Tilbage staar ét flag: en NOTE er prosa, og dens tekst holder sig i
 * laesebredden inde i den faelles spalte.
 */
async function tegnSideIndhold() {
  const host = document.getElementById('pageHost');
  if (!host) return;
  host.classList.toggle('note', state.view === 'note');
  const v = viewById(state.view);
  /*
   * »All Notes« skriver sin egen undertekst.
   *
   * `BESKRIVELSER` siger »newest first«, og det er sandt lige indtil man
   * sorterer paa en overskrift. En undertekst, der bliver staaende og lyve,
   * er vaerre end ingen undertekst - saa hellere lade siden sige, hvad den
   * FAKTISK viser.
   */
  const beskrivelse = state.view === 'notes' ? noteListeUndertekst() : (BESKRIVELSER[v.id] || '');
  const hoved = `<h1>${esc(v.label)}</h1><p class="lead">${esc(beskrivelse)}</p>`;

  try {
    if (state.view === 'note') {
      // Noten har sin egen overskrift (titelfeltet) - ingen h1 ovenover.
      host.innerHTML = sideNote();
      bindNoteSide();
      return;
    }
    if (state.view === 'settings') { host.innerHTML = hoved + await sideSettings(); bindSettings(); return; }
    // Soegesiden har sin EGEN overskrift; den generiske ville staa oven i den.
    if (state.view === 'search') { host.innerHTML = sideSoeg(); bindSoeg(); return; }
    if (state.view === 'trash') { host.innerHTML = hoved + await sideTrash(); bindTrash(); return; }
    if (state.view === 'shared') {
      host.innerHTML = hoved + await sideDelt();
      bindDelt();
      return;
    }
    if (state.view === 'tags') { host.innerHTML = hoved + sideTags(); bindTags(); return; }
    if (state.view === 'comments') {
      host.innerHTML = hoved + await sideKommentarer();
      bindKommentarSide();
      return;
    }
    if (state.view === 'import') { host.innerHTML = hoved + sideImport(); bindImport(); return; }
    if (state.view === 'api') { host.innerHTML = hoved + sideApi(); return; }
    host.innerHTML = hoved + await sideNoter({});
    bindNoteliste();
  } catch (ex) {
    host.innerHTML = `${hoved}<div class="card"><p class="lead">${esc(ex.message)}</p></div>`;
  }
}

/**
 * En skaerm, der endnu ikke er bygget, skal sige HVAD den bliver og HVORNAAR.
 *
 * En hjaelpetekst er en kravspecifikation (RUNE-ERFARINGER, doda v9/v38): den
 * maa ikke love noget, koden ikke kan. Derfor staar fasenummeret der - saa
 * ingen tror, de bruger appen forkert.
 */
function sideKommer(hvad, fase) {
  return `<div class="card empty">
    <h2>${esc(hvad)}</h2>
    <p class="meta saetning">Not built yet — this arrives in ${esc(fase)}.
    Nothing is hidden here; the screen simply does not exist yet.</p>
  </div>`;
}

/* ------------------------------------------------------------- noter */

/* ------------------------------------------------------------- sortering
 *
 * »Kan du gøre så man kan sortere på overskrifterne under All Notes«
 * (Andreas, 2026-08-22).
 *
 * ── Den sker HER, ikke på serveren ────────────────────────────────────────
 *
 * Listen er allerede hentet og ligger i `state.notes`. En omsortering er en
 * måde at se på det samme på — ikke en ny forespørgsel — og et kald pr. klik
 * på en overskrift ville koste en rundtur gennem tunnelen for at bytte om på
 * noget, browseren allerede har.
 *
 * ── Valget holder sessionen ud, men gemmes ikke ───────────────────────────
 *
 * Det ligger i `state`, så det overlever, at man går ind i en note og tilbage
 * igen. Det bliver IKKE gemt: standarden er »nyeste først«, og det er dét,
 * siden lover i sin egen undertekst. En sortering, der overlever en
 * genindlæsning uden at stå nogen steder, er en indstilling, man ikke ved man
 * har.
 *
 * Underteksten skifter med valget, så den aldrig kommer til at love noget
 * andet end det, listen viser.
 */
const SORTERINGER = {
  titel: {
    navn: 'Title',
    // `localeCompare` med dansk: æ, ø og å hører sidst, ikke midt i alfabetet.
    sammenlign: (a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'da',
      { sensitivity: 'base', numeric: true }),
    stigendeFoerst: true,
    tekst: (ned) => (ned ? 'by title, Z first.' : 'by title, A first.'),
  },
  maerker: {
    navn: 'Tags',
    /*
     * Sorteret paa det FOERSTE maerke. En note uden maerker ligger sidst,
     * uanset retning: »ingen maerker« er ikke en vaerdi, der hoerer i den ene
     * eller den anden ende - det er fravaeret af en, og det skal ikke skubbe
     * det, man leder efter, ned i bunden, naar man vender listen.
     */
    sammenlign: (a, b) => {
      const x = (a.tags || [])[0] || '';
      const y = (b.tags || [])[0] || '';
      if (!x && !y) return 0;
      if (!x) return 1;
      if (!y) return -1;
      return x.localeCompare(y, 'da', { sensitivity: 'base' });
    },
    tomSidst: true,
    stigendeFoerst: true,
    tekst: (ned) => (ned ? 'by tag, Z first — untagged last.' : 'by tag, A first — untagged last.'),
  },
  aendret: {
    navn: 'Updated',
    sammenlign: (a, b) => (a.updatedAt || 0) - (b.updatedAt || 0),
    stigendeFoerst: false,
    tekst: (ned) => (ned ? 'newest first.' : 'oldest first.'),
  },
};

const sortering = { felt: 'aendret', ned: true };

function sorterNoter(liste) {
  const s = SORTERINGER[sortering.felt];
  if (!s) return liste;
  const ud = liste.slice().sort((a, b) => {
    const r = s.sammenlign(a, b);
    if (r !== 0) return sortering.ned ? -r : r;
    // Uafgjort brydes ALTID paa samme maade, ellers hopper raekker rundt
    // mellem to optegninger af den samme liste.
    return String(a.id).localeCompare(String(b.id));
  });
  if (!s.tomSidst) return ud;
  // Notene UDEN vaerdi laegges bagest, uanset retning - se forklaringen ovenfor.
  const med = ud.filter((n) => (n.tags || []).length);
  const uden = ud.filter((n) => !(n.tags || []).length);
  return med.concat(uden);
}

/** Overskriften som en knap, med pilen der viser hvad der sker. */
function sorterTh(felt, ekstra) {
  const s = SORTERINGER[felt];
  const paa = sortering.felt === felt;
  const pil = paa ? (sortering.ned ? '↓' : '↑') : '';
  return `<th${ekstra || ''}><button class="sorterknap${paa ? ' paa' : ''}" data-sorter="${felt}"
    aria-label="Sort by ${esc(s.navn)}">${esc(s.navn)}<span class="sorterpil">${pil}</span></button></th>`;
}

/** Underteksten skal sige, hvad listen FAKTISK viser. */
function noteListeUndertekst() {
  const s = SORTERINGER[sortering.felt];
  return `Everything you have written, ${s.tekst(sortering.ned)}`;
}

async function sideNoter(opt) {
  const q = opt.trash ? '?trash=1' : '';
  const d = await api('GET', `/api/v1/notes${q}`);
  state.notes = d.notes;

  if (!d.notes.length) {
    return `<div class="card empty">
      <h2>${opt.trash ? 'The trash is empty' : 'No notes yet'}</h2>
      <p class="meta saetning">${opt.trash
    ? 'Deleted notes land here and are removed for good after 30 days.'
    : 'Notebooks and pages live in the sidebar. The Notion import arrives in F5.'}</p>
      ${opt.trash ? '' : '<div class="btnrow" style="justify-content:center;margin-top:16px">'
      + `<button class="btn primary" id="nyNote">${icon('plus', 16)} New note</button></div>`}
    </div>`;
  }

  return `${opt.trash ? '' : `<div class="btnrow" style="margin-bottom:16px">
      <button class="btn primary" id="nyNote">${icon('plus', 16)} New note</button>
    </div>`}
    <div class="card"><div class="tablewrap"><table class="data notetabel">
      <thead><tr>${sorterTh('titel')}${sorterTh('maerker')}${sorterTh('aendret', ' class="num"')}<th></th></tr></thead>
      <tbody>${sorterNoter(d.notes).map((n) => `<tr>
        <td><button class="linkknap" data-aabn="${esc(n.id)}">${esc(n.title || 'Untitled')}</button></td>
        <td><span class="chips">${n.tags.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</span></td>
        <td class="num">${esc(visTid(n.updatedAt))}</td>
        <td style="text-align:right;white-space:nowrap">
          ${opt.trash ? '' : `<button class="btn ghost" data-slet="${esc(n.id)}">Delete</button>`}</td>
      </tr>`).join('')}</tbody>
    </table></div></div>`;
}

function bindNoteliste() {
  document.querySelectorAll('[data-sorter]').forEach((el) => {
    el.addEventListener('click', () => {
      const felt = el.dataset.sorter;
      // Samme overskrift igen vender listen. En NY overskrift begynder med
      // den retning, folk mener med netop den: titler fra A, datoer fra
      // nyeste. Alt andet foeles som om knappen gjorde noget tilfaeldigt.
      if (sortering.felt === felt) sortering.ned = !sortering.ned;
      else { sortering.felt = felt; sortering.ned = !SORTERINGER[felt].stigendeFoerst; }
      tegnSide();
    });
  });
  const ny = document.getElementById('nyNote');
  if (ny) ny.addEventListener('click', () => opretOgAaben({}));
  document.querySelectorAll('[data-aabn]').forEach((el) => {
    el.addEventListener('click', () => aabnNote(el.dataset.aabn));
  });
  document.querySelectorAll('[data-slet]').forEach((el) => {
    el.addEventListener('click', async () => {
      try {
        await api('DELETE', `/api/v1/notes/${el.dataset.slet}`);
        toast('Moved to trash.');
        await genindlaes();
      } catch (ex) { toast(ex.message); }
    });
  });
}

function visTid(sek) {
  if (!sek) return '';
  const d = new Date(sek * 1000);
  const dage = Math.floor((Date.now() - sek * 1000) / 86400000);
  if (dage === 0) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (dage === 1) return 'yesterday';
  if (dage < 7) return `${dage} days ago`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ---------------------------------------------------------- papirkurv */

async function sideTrash() {
  const d = await api('GET', '/api/v1/notes?trash=1');
  state.notes = d.notes;
  if (!d.notes.length) {
    return `<div class="card empty"><h2>The trash is empty</h2>
      <p class="meta saetning">Deleted notes land here and are removed for good after 30 days.</p></div>`;
  }
  return `<div class="card"><div class="tablewrap"><table class="data">
      <thead><tr><th>Title</th><th class="num">Deleted</th><th></th></tr></thead>
      <tbody>${d.notes.map((n) => `<tr>
        <td>${esc(n.title || 'Untitled')}</td>
        <td class="num">${esc(visTid(n.updatedAt))}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn ghost" data-gendan="${esc(n.id)}">Restore</button></td>
      </tr>`).join('')}</tbody>
    </table></div></div>
    <p class="meta saetning" style="margin-top:12px">Restoring a page brings back exactly the
    subpages that were deleted with it — not ones you deleted on their own.</p>`;
}

function bindTrash() {
  document.querySelectorAll('[data-gendan]').forEach((el) => {
    el.addEventListener('click', async () => {
      try {
        const d = await api('POST', `/api/v1/notes/${el.dataset.gendan}/restore`, {});
        toast(d.restored > 1 ? `Restored with ${d.restored - 1} subpages.` : 'Restored.');
        await genindlaes();
        tegnTrae();
      } catch (ex) { toast(ex.message); }
    });
  });
}

/* ------------------------------------------------------------ soegning */

function sideSoeg() {
  const seneste = (omni.seneste || []).slice(0, 8);
  return `
    <div class="hjem">
      <h1>${esc(state.config.appName || 'Sagu')}</h1>
      <p class="lead">Search titles, headings, body text, tags and properties —
      or start a new note. Press <kbd>/</kbd> from anywhere.</p>
    </div>
    ${seneste.length ? `<h2>Recently changed</h2>
      <div class="card">${seneste.map((n) => `
        <button class="senest" data-aabn="${esc(n.id)}">
          <span>${esc(n.title || 'Untitled')}</span>
          <span class="meta">${esc(visTid(n.updatedAt))}</span></button>`).join('')}</div>` : ''}
    <h2>What the field understands</h2>
    <div class="card">
      <table class="data syntax">
        <tr><td><code>drif</code></td><td>partial words match — <code>drif</code> finds <em>drift</em></td></tr>
        <tr><td><code>gron</code></td><td>ø, æ and å fold — <code>gron</code> finds <em>grøn</em></td></tr>
        <tr><td><code>"two words"</code></td><td>that phrase, in that order</td></tr>
        <tr><td><code>-word</code></td><td>notes without it</td></tr>
        <tr><td><code>tag:drift</code></td><td>only notes with that tag</td></tr>
        <tr><td><code>in:Hjorten</code></td><td>only in that notebook, or under that page</td></tr>
        <tr><td><code>updated:&lt;30d</code></td><td>changed within 30 days (also <code>w</code>, <code>m</code>, <code>y</code>)</td></tr>
        <tr><td><code>has:code</code></td><td>also <code>image</code>, <code>link</code>, <code>todo</code>, <code>table</code></td></tr>
        <tr><td><code>* title</code></td><td>create a note with that title</td></tr>
        <tr><td><code>/ name</code></td><td>jump to a notebook</td></tr>
        <tr><td><code># name</code></td><td>filter by a tag</td></tr>
      </table>
      <p class="meta saetning" style="margin-top:12px">A word inside a word is found too:
      searching <code>inventory</code> finds a note that only says <code>keepInventory</code>.
      The index cannot see it, so the text is read instead — and the results are then
      unranked, which the field says out loud.</p>
    </div>`;
}

function bindSoeg() {
  // Selve feltet bor i topbaren og bindes af skallen. Her er kun listen over
  // de senest aendrede.
  document.querySelectorAll('.senest[data-aabn]').forEach((el) => {
    el.addEventListener('click', () => aabnNote(el.dataset.aabn));
  });
}

/**
 * FTS5's snippet() markerer traefferne med << og >>.
 *
 * Uddraget escapes FOERST og faar derefter sine markoerer byttet til <mark> -
 * samme raekkefoelge som linkify. Indholdet kan komme fra en Notion-import,
 * saa der maa ikke findes en vej fra notens tekst til et tag, vi ikke selv
 * har skrevet.
 */
function uddrag(raa) {
  return esc(raa || '').replace(/&lt;&lt;/g, '<mark>').replace(/&gt;&gt;/g, '</mark>');
}

/* --------------------------------------------------------------- tags */

/*
 * Maerkerne, og hvad der er filet under hvert.
 *
 * Den tomme tilstand SAGDE »Tags arrive in F3« længe efter, F3 var bygget -
 * og der fandtes ingen vej til at saette et maerke nogen steder. En
 * hjaelpetekst, der beskriver noget, appen ikke kan, er den dyreste slags
 * fejl: brugeren tror, han bruger appen forkert (RUNE-ERFARINGER, doda v38).
 * Nu siger den, HVOR man goer det.
 */
function sideTags() {
  const nyt = `<div class="btnrow" style="margin-top:14px">
      <input class="input" id="nytMaerke" placeholder="New tag name" style="max-width:220px"
        autocomplete="off" spellcheck="false">
      <button class="btn" id="opretMaerke">Create tag</button>
    </div>
    <p class="meta saetning" style="margin-top:10px">Three ways in, and they all end up the same
    place: here, <strong>+ tag</strong> under a note's title, or writing <code>#drift</code> in
    the title. A tag stays until you delete it, so you can lay out your structure first.</p>`;

  if (!state.tags.length) {
    return `<div class="card empty"><h2>No tags yet</h2>${nyt}</div>`;
  }
  return `<div class="card">
    <div class="chips">${state.tags.map((t) =>
    `<span class="chip maerke"><button class="chip-navn" data-maerke="${esc(t.name)}"
      >${esc(t.name)}</button><button class="chip-x" data-sletmaerke="${esc(t.id)}"
      data-navn="${esc(t.name)}" aria-label="Delete ${esc(t.name)}" title="Delete this tag">×</button></span>`).join('')}</div>
    <p class="meta saetning" style="margin-top:12px">Click a tag to see what is filed under it.</p>
    ${nyt}
  </div>`;
}

function bindTags() {
  document.querySelectorAll('[data-maerke]').forEach((el) => {
    // Feltet tolker `tag:navn` som et filter (F2), saa der er ÉN vej til det
    // samme resultat - klikket skriver bare linjen for brugeren.
    el.addEventListener('click', () => soegFra(`tag:${el.dataset.maerke}`));
  });

  const felt = document.getElementById('nytMaerke');
  const knap = document.getElementById('opretMaerke');
  const opret = async () => {
    const navn = (felt.value || '').trim().replace(/^#/, '');
    if (!navn) { felt.focus(); return; }
    try {
      await api('POST', '/api/v1/tags', { name: navn });
      state.tags = (await api('GET', '/api/v1/state')).tags || state.tags;
      felt.value = '';
      tegnSide();
    } catch (ex) { toast(ex.message); }
  };
  if (knap) knap.addEventListener('click', opret);
  if (felt) {
    felt.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); opret(); }
    });
  }

  document.querySelectorAll('[data-sletmaerke]').forEach((el) => {
    el.addEventListener('click', async () => {
      // Bekraeftelsen siger, hvad der SKER - ikke bare "er du sikker".
      // Noterne roeres ikke; kun koblingen forsvinder.
      if (!confirm(`Delete the tag "${el.dataset.navn}"? The notes stay — they just lose the tag.`)) return;
      try {
        const d = await api('DELETE', `/api/v1/tags/${el.dataset.sletmaerke}`);
        state.tags = (await api('GET', '/api/v1/state')).tags || state.tags;
        toast(d.notes ? `Tag removed from ${d.notes} note${d.notes === 1 ? '' : 's'}.` : 'Tag deleted.');
        tegnSide();
      } catch (ex) { toast(ex.message); }
    });
  });
}

/* ------------------------------------------------------------- filer */

/**
 * Alle brugerens filer, paa tvaers af noter.
 *
 * Hentes for sig, ikke som en del af indstillingerne: listen kan vaere lang,
 * og resten af siden skal kunne tegnes uden at vente paa den.
 */
async function tegnFilListe() {
  const host = document.getElementById('filListe');
  if (!host) return;
  try {
    const d = await api('GET', '/api/v1/files');
    if (!d.files.length) {
      host.innerHTML = '<p class="meta saetning">No files yet. Drag one onto a note, or paste an image.</p>';
      return;
    }
    /*
     * Listen er FOLDET som udgangspunkt.
     *
     * »Listen er allerede nu meget lang og fylder« (Andreas, 2026-08-21) - med
     * et par hundrede vedhaeftninger er den en mur, man skal forbi for at naa
     * resten af indstillingerne. Pladsmaaleren staar tilbage: den er ét blik,
     * og det er som regel dét, man kom efter.
     *
     * `<details>` frem for vores egen foldning: browseren goer det selv, det
     * virker uden JavaScript, og teksten paa knappen kan sige HVOR mange der
     * er - saa man ved, hvad man folder ud, foer man goer det (samme grund
     * som wikiens navigation).
     */
    host.innerHTML = `<details class="filfold">
      <summary>${d.files.length} file${d.files.length === 1 ? '' : 's'}</summary>
      <div class="tablewrap"><table class="data">
        <thead><tr><th>Name</th><th>Type</th><th class="num">Size</th><th></th></tr></thead>
        <tbody>${d.files.map((f) => `<tr>
          <td><a href="${esc(f.url)}" ${f.inline ? '' : 'download'}>${esc(f.name)}</a></td>
          <td class="meta saetning">${esc(f.inline ? 'image' : f.mime)}</td>
          <td class="num">${esc(visStoerrelse(f.size))}</td>
          <td style="text-align:right"><button class="btn ghost danger"
            data-filslet2="${esc(f.id)}">Remove</button></td>
        </tr>`).join('')}</tbody>
      </table></div></details>`;
    host.querySelectorAll('[data-filslet2]').forEach((el) => {
      el.addEventListener('click', async () => {
        try {
          await api('DELETE', `/api/v1/files/${el.dataset.filslet2}`);
          toast('Removed.');
          await genindlaes();
        } catch (ex) { toast(ex.message); }
      });
    });
  } catch (ex) {
    host.innerHTML = `<p class="meta saetning">${esc(ex.message)}</p>`;
  }
}

/* ---------------------------------------------------------- settings */

/* ------------------------------------------------ faner i indstillingerne
 *
 * »Jeg vil gerne have lavet sub menuer under indstillinger« (Andreas,
 * 2026-09-02), med verdande som forbillede.
 *
 * Siden var vokset til sytten afsnit i én lang stribe: udseende, konto,
 * passkeys, filer, bogmaerke, udgivelser, om, redigering, versionshistorik,
 * totrin, noegler, forbundne apps, doda, GitHub og to admin-afsnit. Man
 * rullede forbi ti ting for at naa den ellevte.
 *
 * ── ALT tegnes, ét vises ─────────────────────────────────────────────────
 *
 * Fanerne skjuler med `hidden`; de fjerner ikke noget fra dokumentet.
 * `bindSettings()` binder tredive elementer op paa deres id, og tegnede vi
 * kun den aabne fane, ville halvdelen af dem ikke findes - hver eneste
 * binding skulle saa laves om til noget, der koerer igen ved hvert faneskift.
 * Det er den slags omskrivning, der taber en knap undervejs uden at noget
 * fejler.
 *
 * Prisen er, at de skjulte afsnit stadig hentes og tegnes. De er der i
 * forvejen i dag, saa det koster ingenting nyt.
 *
 * ── Valget huskes ────────────────────────────────────────────────────────
 *
 * I `localStorage` og ikke i `state`: det afhaenger af, hvad man sidst var i
 * gang med paa DENNE maskine, ikke af kontoen - samme begrundelse som temaet
 * og den skjulte sidemenu.
 */
const FANER = [
  { id: 'konto', navn: 'Account' },
  { id: 'skrivning', navn: 'Editing' },
  { id: 'filer', navn: 'Files' },
  { id: 'broer', navn: 'Connections' },
  { id: 'noegler', navn: 'Keys' },
  { id: 'server', navn: 'Server', kunAdmin: true },
];

function laesFane() {
  try {
    const g = localStorage.getItem('sagu_fane');
    return FANER.some((f) => f.id === g) ? g : 'konto';
  } catch { return 'konto'; }
}

function gemFane(id) {
  try { localStorage.setItem('sagu_fane', id); } catch { /* privat tilstand */ }
}

/**
 * Hvilken fane staar aaben?
 *
 * Er den gemte fane ikke synlig for den her bruger - »Server« for en, der
 * ikke er administrator - falder den tilbage til den foerste. Ellers ville
 * man aabne indstillingerne og se en tom side.
 */
function aktivFane() {
  const g = laesFane();
  const f = FANER.find((x) => x.id === g);
  if (f && (!f.kunAdmin || state.user.isAdmin)) return g;
  return 'konto';
}

function fanebarHtml() {
  const nu = aktivFane();
  const synlige = FANER.filter((f) => !f.kunAdmin || state.user.isAdmin);
  return `<nav class="faner" role="tablist">${synlige.map((f) => `
    <button class="fane-knap${f.id === nu ? ' paa' : ''}" data-fane-knap="${f.id}"
      role="tab" aria-selected="${f.id === nu ? 'true' : 'false'}">${esc(f.navn)}</button>`).join('')}
  </nav>`;
}

/** Viser én fane og skjuler resten. */
function visFane(id) {
  for (const el of document.querySelectorAll('.fane')) el.hidden = el.dataset.fane !== id;
  for (const k of document.querySelectorAll('[data-fane-knap]')) {
    const paa = k.dataset.faneKnap === id;
    k.classList.toggle('paa', paa);
    k.setAttribute('aria-selected', paa ? 'true' : 'false');
  }
}

function bindFaner() {
  for (const k of document.querySelectorAll('[data-fane-knap]')) {
    k.addEventListener('click', () => {
      gemFane(k.dataset.faneKnap);
      visFane(k.dataset.faneKnap);
      // Til toppen: en fane, man skifter til, skal begynde ved sin foerste
      // overskrift - ikke midt i, fordi den forrige var laengere.
      tilToppen();
    });
  }
  visFane(aktivFane());
}

async function sideSettings() {
  const valgt = nuvaerendeTema();
  const knap = (id, tekst) => `<button class="btn${valgt === id ? ' primary' : ''}" data-tema="${id}">${tekst}</button>`;

  let noegler = [];
  let passkeys = [];
  try { noegler = (await api('GET', '/api/v1/keys')).keys; } catch { /* vist som tom */ }
  try { passkeys = (await api('GET', '/api/v1/passkeys')).passkeys; } catch { /* vist som tom */ }

  let adminDel = '';
  if (state.user.isAdmin) {
    let a = null;
    try { a = await api('GET', '/api/v1/admin'); } catch { /* vist som tom */ }
    if (a) {
      /*
       * To afsnit, ikke ét.
       *
       * »Public address« er et valg om, hvad LINKS skrives med - den handler
       * om det, kollegaerne faar at se. »Server« handler om, hvem der maa
       * logge ind. De to laa i samme kort med adressen klemt inde mellem et
       * flueben og en kontoliste, og saa laeses den som en detalje ved
       * kontostyringen (Andreas, 2026-08-21).
       */
      adminDel = `
      <h2>Public address</h2>
      <div class="card">
        <label class="field"><span>The address links are written with</span>
          <input class="input" id="offentligUrl" value="${esc(state.publicUrl || '')}"
            placeholder="${esc(location.origin)}" autocomplete="off" autocapitalize="none"
            autocorrect="off" inputmode="url" spellcheck="false"></label>
        <div class="btnrow" style="margin-top:8px">
          <button class="btn primary" id="offentligGem">Save address</button>
          ${state.publicUrl ? `<button class="btn" id="offentligRyd">Clear it</button>` : ''}
        </div>
        <p class="meta saetning">Sagu can be reached on more than one address. This is the one
        published links are written with, and the one search engines are told is the real one.
        <strong>Clear it</strong> removes the fixed address again, so links use whichever
        address you happen to be on.</p>
      </div>

      <h2>Server</h2>
      <div class="card">
        <label class="switch">
          <input type="checkbox" id="tilladReg" ${a.allowRegistration ? 'checked' : ''}>
          <span>Let anyone create an account on this server</span></label>
        <p class="meta saetning">Off means only you can sign in. Your colleagues do not need accounts —
        a published wiki is read without one.</p>
        <div class="tablewrap" style="margin-top:14px"><table class="data">
          <thead><tr><th>Account</th><th>Role</th><th class="num">Created</th><th></th></tr></thead>
          <tbody>${a.users.map((u) => `<tr><td>${esc(pentBruger(u.username))}</td>
            <td>${u.isAdmin ? 'Administrator' : 'Member'}</td>
            <td class="num">${esc(visTid(u.createdAt))}</td>
            <td style="text-align:right">${u.id === state.user.id
    ? '<span class="meta">that is you</span>'
    : `<button class="btn ghost" data-nulstil="${esc(u.id)}"
        data-navn="${esc(u.username)}">Set a password</button>`}</td>
          </tr>`).join('')}</tbody>
        </table></div>
        <label class="field" style="margin-top:16px"><span>File storage per account</span>
          <div class="btnrow">
            <input class="input" id="kvoteFelt" type="number" min="0.1" step="0.1"
              style="max-width:130px" value="${esc(String(Math.round((a.storageQuota / 1024 / 1024 / 1024) * 10) / 10))}">
            <span class="meta" style="align-self:center">GB</span>
            <button class="btn" id="kvoteGem">Save</button>
          </div></label>
        <p class="meta saetning">The same limit for every account. Sagu cannot make room:
        is the number bigger than the disk, it is a promise the machine cannot keep.
        Lowering it deletes nothing — it only stops new uploads, so it cannot be set below
        what an account already uses${a.storageMest
    ? ` (right now that is ${esc(visStoerrelse(a.storageMest))})` : ''}.</p>

        <p class="meta saetning">Setting a password signs that account out everywhere at once.
        Its <strong>API keys keep working</strong> — a forgotten password is no reason to kill
        someone's phone shortcuts; remove the key itself if that is what you mean.
        Your own password is changed under <strong>Your account</strong>, where the current
        one is asked for.</p>
      </div>`;
    }
  }

  let dodaDel = '';
  try {
    const d = await api('GET', '/api/v1/doda');
    dodaDel = `
  <h2>doda</h2>
  <div class="card">
    <p class="meta saetning">Sagu and doda are two apps, not one. They are tied together with
    <strong>links</strong> — a note can send a task, and the task carries a link back.
    Nothing is synchronised, so neither can quietly overwrite the other.</p>
    ${d.connected ? `<p class="doda-forbundet">Connected to <strong>${esc(d.url)}</strong>${
  d.tasks ? ` · ${d.tasks} task${d.tasks === 1 ? '' : 's'} sent from your notes` : ''}</p>` : ''}
    <label class="field"><span>doda address</span>
      <input class="input" id="dodaUrl" value="${esc(d.url || '')}"
        placeholder="https://doda.example.com" autocomplete="off" spellcheck="false"></label>
    <label class="field" style="margin-top:10px"><span>API key from doda</span>
      <input class="input" id="dodaKey" type="password" autocomplete="off"
        placeholder="${d.connected ? 'Leave empty to keep the saved key' : 'doda_…'}"></label>
    ${d.connected ? `<p class="gemt-noegle">${icon('laas', 14)}
      <span><strong>An API key is saved</strong> on the server. It never leaves it again —
      not even to this page, which is why the field looks empty. Paste a new one only if
      you want to replace it.</span></p>` : ''}
    <div class="btnrow" style="margin-top:10px">
      <button class="btn primary" id="dodaGem">${d.connected ? 'Save and test' : 'Connect'}</button>
      ${d.connected ? '<button class="btn" id="dodaFjern">Disconnect</button>' : ''}
    </div>
    <p class="meta saetning">In doda: Settings → API keys → create a <strong>full</strong> key.
    A <strong>capture</strong> key also works, but then doda cannot tell Sagu what happened
    to a task, so status will not be shown. The key is tested before it is saved, and it never
    leaves this server again.</p>
  </div>`;
  } catch { /* vist som tom */ }

  let ghDel = '';
  try {
    const g = await api('GET', '/api/v1/github/status');
    ghDel = `
  <h2>GitHub</h2>
  <div class="card">
    <p class="meta saetning">Paste a GitHub file address on its own line in a note, and it
    becomes the code — <strong>frozen at the commit it pointed to</strong>, so the note keeps
    explaining the code it was written about. Issue and pull request addresses become a chip
    with the title and whether it is still open.</p>
    ${g.connected ? `<p class="doda-forbundet">Connected as <strong>${esc(g.login || 'GitHub')}</strong></p>` : ''}
    <label class="field"><span>Personal access token</span>
      <input class="input" id="ghToken" type="password" autocomplete="off"
        placeholder="${g.connected ? 'Leave empty to keep the saved token' : 'github_pat_… or ghp_…'}"></label>
    ${g.connected ? `<p class="gemt-noegle">${icon('laas', 14)}
      <span><strong>A token is saved</strong> on the server. It never leaves it again —
      not even to this page, which is why the field looks empty.</span></p>` : ''}
    <div class="btnrow" style="margin-top:10px">
      <button class="btn primary" id="ghGem">${g.connected ? 'Save and test' : 'Connect'}</button>
      ${g.connected ? '<button class="btn" id="ghFjern">Disconnect</button>' : ''}
    </div>
    <p class="meta saetning">Without a token GitHub allows <strong>60 requests an hour</strong>
    and answers <strong>404</strong> for anything private — the same answer as »does not
    exist«, which is why a missing token looks like a missing file. With a token: 5.000 an
    hour, and your private repositories. A token with <em>read-only</em> access to contents
    is enough; it is tested before it is saved, and it never leaves this server again.</p>
  </div>`;
  } catch { /* vist som tom */ }

  return fanebarHtml() + `
  <section class="fane" data-fane="konto">

  <h2>Appearance</h2>
  <div class="card">
    <div class="btnrow">${knap('auto', 'Follow system')}${knap('light', 'Light')}${knap('dark', 'Dark')}</div>
  </div>


  <h2>Account</h2>
  <div class="card">
    <p class="meta saetning">Signed in as <strong>${esc(pentBruger(state.user.username))}</strong>${state.user.isAdmin ? ' (administrator)' : ''}.</p>
    <form id="kodeordForm" style="margin-top:14px">
      <label class="field"><span>Current password</span>
        <input class="input" type="password" id="kodeNu" autocomplete="current-password"></label>
      <label class="field"><span>New password</span>
        <input class="input" type="password" id="kodeNy" autocomplete="new-password"></label>
      <button class="btn" type="submit">Change password</button>
    </form>
  </div>


  <h2>Passkeys</h2>
  <div class="card">
    ${state.config.passkeys ? '' : `<p class="meta saetning">Passkeys need https.
      On the panel address (plain http) the password is the only way in — and it stays that way,
      so a passkey can never lock you out of your own server.</p>`}
    ${passkeys.length ? `<div class="tablewrap"><table class="data">
      <thead><tr><th>Name</th><th class="num">Added</th><th class="num">Last used</th><th></th></tr></thead>
      <tbody>${passkeys.map((p) => `<tr><td>${esc(p.name)}</td>
        <td class="num">${esc(visTid(p.created_at))}</td>
        <td class="num">${esc(p.last_used_at ? visTid(p.last_used_at) : 'never')}</td>
        <td style="text-align:right"><button class="btn ghost danger" data-pkslet="${esc(p.id)}">Remove</button></td>
      </tr>`).join('')}</tbody></table></div>`
    : '<p class="meta saetning">No passkeys yet.</p>'}
    ${state.config.passkeys ? '<div class="btnrow" style="margin-top:14px">'
      + '<button class="btn" id="pkTilfoej">Add a passkey</button></div>' : ''}
  </div>


  <h2>Two-step verification</h2>
  <div class="card" id="totpKort">
    <p class="meta saetning">Loading…</p>
  </div>


  <h2>About</h2>
  <div class="card">
    <p class="lead" style="margin-top:6px">Sagu version ${esc(String(APP_VERSION))}${
  state.config.version && state.config.version > APP_VERSION
    ? ` — the server has v${esc(String(state.config.version))}` : ''}.</p>
    <p class="meta saetning">${state.config.secureContext
    ? 'Secure connection (https), so passkeys work here.'
    : 'Plain http — passkeys are unavailable on this address. Your password always keeps working.'}
    ${state.publicUrl ? `Links are written with <code>${esc(state.publicUrl)}</code>.` : ''}</p>
    ${state.config.version && state.config.version > APP_VERSION
    ? '<div class="btnrow" style="margin-top:10px"><button class="btn primary" id="omOpdater">Update the app</button></div>'
    : ''}
  </div>
  </section>

  <section class="fane" data-fane="skrivning">

  <h2>Editing</h2>
  <div class="card">
    <label class="switch">
      <input type="checkbox" id="prefHel" ${state.prefs && state.prefs.editWhole ? 'checked' : ''}>
      <span>Click a line to edit the whole note as markdown</span></label>
    <p class="meta saetning">Sagu normally opens just the paragraph you clicked, with the rest of
    the note still rendered around it — good for changing a sentence. With this on, a click opens
    the <strong>whole</strong> note as raw markdown instead, with the cursor at the line you
    clicked. Better for moving things around, fixing a table, or cutting across paragraphs.
    <strong>Esc</strong> closes either way.</p>
  </div>


  <h2>Version history</h2>
  <div class="card" id="versionKort">
    <p class="meta saetning">Loading…</p>
  </div>
  </section>

  <section class="fane" data-fane="filer">

  <h2>Files</h2>
  <div class="card">
    ${(() => {
    const st = state.storage || {};
    const brugt = st.used || 0;
    const kvote = st.quota || 1;
    const pct = Math.min(100, Math.round((brugt / kvote) * 1000) / 10);
    return `<div class="plads">
        <div class="plads-bar"><div class="plads-fyld${pct > 90 ? ' fuld' : ''}"
          style="width:${Math.max(pct, brugt ? 1 : 0)}%"></div></div>
        <p class="meta saetning">${visStoerrelse(brugt)} of ${visStoerrelse(kvote)} used${
  st.maxFile ? ` · one file can be at most ${visStoerrelse(st.maxFile)}` : ''}.</p>
      </div>`;
  })()}
    <div id="filListe"><p class="meta saetning">Loading…</p></div>
  </div>


  <h2>Published pages</h2>
  <div class="card">
    <p class="meta saetning">Pages your colleagues can read without an account.
    A published page always shows what it says right now — there is nothing to re-publish.</p>
    <div id="udgivListe" style="margin-top:12px"><p class="meta saetning">Loading…</p></div>
  </div>
  </section>

  <section class="fane" data-fane="broer">
  ${dodaDel}

  ${ghDel}


  <h2>Save to Sagu</h2>
  <div class="card">
    <p class="meta saetning">A bookmark you press on any page — a ticket, an article, a wiki —
    and it lands in Sagu as a note. Select something first and only the selection is saved;
    otherwise the page's main text is.</p>
    <div class="klip-valg">
      <label class="field"><span>Notebook</span>
        <select class="input" id="klipBog">
          <option value="">Not in a notebook</option>
          ${(state.notebooks || []).map((b) => `<option value="${esc(b.name)}">${esc(b.name)}</option>`).join('')}
        </select></label>
      <label class="field"><span>Tag (optional)</span>
        <input class="input" id="klipMaerke" placeholder="clip" autocomplete="off"
          autocapitalize="none" autocorrect="off" spellcheck="false"></label>
    </div>
    <div class="btnrow" style="margin-top:10px">
      <button class="btn primary" id="klipLav">Make the bookmark</button>
    </div>
    <div id="klipUd"></div>
    <p class="meta saetning" style="margin-top:12px">It gets a <strong>capture</strong> key of its
    own — a key that can put something new in and <strong>read nothing at all</strong>. A bookmark
    sits in plain text in your browser and syncs between machines, so it must not be able to pull
    your archive back out. Revoke it under <strong>Access keys</strong> whenever you like.</p>
  </div>
  </section>

  <section class="fane" data-fane="noegler">

  <h2>Access keys</h2>
  <div class="card">
    <p class="meta saetning">For iPhone shortcuts, Siri and anything else that talks to Sagu
    from outside. One key per device or purpose, so you can revoke a single one without
    touching the rest. The value is shown once.</p>
    ${noegler.length ? `<div class="tablewrap"><table class="data">
      <thead><tr><th>Name</th><th>What it may do</th><th class="num">Last used</th><th></th></tr></thead>
      <tbody>${noegler.map((k) => `<tr><td>${esc(k.name)}</td>
        <td>${esc(scopeNavn(k.scope))}</td>
        <td class="num">${esc(k.last_used_at ? visTid(k.last_used_at) : 'never')}</td>
        <td style="text-align:right"><button class="btn ghost danger" data-noegleslet="${esc(k.id)}">Revoke</button></td>
      </tr>`).join('')}</tbody></table></div>` : ''}
    <div class="btnrow" style="margin-top:14px">
      <input class="input" id="noegleNavn" placeholder="What is it for?" style="max-width:220px">
      <select class="input" id="noegleScope" style="max-width:280px">
        ${SCOPES.map((s) => `<option value="${esc(s.id)}">${esc(s.etiket)}</option>`).join('')}
      </select>
      <button class="btn" id="noegleNy">Create key</button>
    </div>
    <p class="meta saetning" id="scopeHvornaar" style="margin-top:8px"></p>
    <div class="btnrow" style="margin-top:12px">
      <button class="btn" id="tilApi">How to use these →</button>
    </div>
    <div class="tablewrap" style="margin-top:12px"><table class="data">
      <tbody>${SCOPES.map((s) => `<tr>
        <th style="white-space:nowrap">${esc(s.etiket)}</th>
        <td class="meta saetning">${s.hvornaar}</td></tr>`).join('')}</tbody></table></div>
  </div>


  <h2>Connected apps</h2>
  <div class="card">
    <p class="meta saetning">Claude and other MCP clients you have allowed. They asked
    through a consent page and got a key of their own — you did not have to paste one.
    Add Sagu in Claude as a custom connector with the address
    <code>${esc(offentligBase())}/mcp</code>.</p>
    <div id="forbListe"><p class="meta saetning">Loading…</p></div>
    <p class="meta saetning">Revoking cuts it off at once: both the key it holds and the
    one it could have renewed with. It never had permission to change your password,
    create keys, or revoke connections — those need this browser.</p>
  </div>
  </section>

  <section class="fane" data-fane="server">
  ${adminDel}
  </section>`;
}

/** Forbundne apps - hentes bagefter, som udgivelseslisten. */
async function forbindelsesListeHtml() {
  let liste = [];
  try { liste = (await api('GET', '/api/v1/connections')).connections; } catch { return ''; }
  if (!liste.length) return '<p class="meta saetning">Nothing is connected yet.</p>';
  return `<div class="tablewrap"><table class="data">
    <thead><tr><th>App</th><th>Scope</th><th class="num">Last used</th><th></th></tr></thead>
    <tbody>${liste.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.scope || '')}</td>
      <td class="num">${esc(c.last_used_at ? visTid(c.last_used_at) : 'never')}</td>
      <td style="text-align:right"><button class="btn ghost danger"
        data-forbslet="${esc(c.id)}">Revoke</button></td>
    </tr>`).join('')}</tbody></table></div>`;
}

function bindForbindelsesListe() {
  document.querySelectorAll('[data-forbslet]').forEach((el) => {
    el.addEventListener('click', async () => {
      if (!confirm('Cut this app off? It will have to ask again.')) return;
      try {
        await api('DELETE', `/api/v1/connections/${encodeURIComponent(el.dataset.forbslet)}`);
        toast('Connection revoked.');
        const host = document.getElementById('forbListe');
        if (host) { host.innerHTML = await forbindelsesListeHtml(); bindForbindelsesListe(); }
      } catch (ex) { toast(ex.message); }
    });
  });
}

/**
 * Den nye noegle - i en rude, man skal lukke selv.
 *
 * `navigator.clipboard` findes kun i et secure context, og panelet naas over
 * ren http. Derfor BAADE en kopiér-knap og en vaerdi, der kan markeres med
 * fingeren: knappen forsvinder, hvis den ikke kan virke, frem for at fejle
 * naar man trykker (RUNE-ERFARINGER, tools v1).
 */
function visNoeglePanel(noegle, scope) {
  const gammel = document.getElementById('noeglePanel');
  if (gammel) gammel.remove();

  const host = document.createElement('div');
  host.className = 'modal';
  host.id = 'noeglePanel';
  host.innerHTML = `<div class="modal-kort">
      <div class="modal-top">
        <h2>Your new key</h2>
        <button class="iconbtn" id="noegleLuk" aria-label="Close">${icon('luk', 16)}</button>
      </div>
      <div class="modal-krop">
        <p class="lead">Copy it now — <strong>it is never shown again.</strong>
        Sagu keeps only a hash of it, so there is no way to look it up later.</p>
        <p class="meta saetning">It may: <strong>${esc(scopeNavn(scope))}</strong>.</p>
        <p class="noegle-vaerdi"><code id="noegleTekst">${esc(noegle)}</code></p>
        <div class="btnrow">
          ${navigator.clipboard ? '<button class="btn primary" id="noegleKopi">Copy</button>' : ''}
          <button class="btn" id="noegleFaerdig">Done</button>
        </div>
        <p class="meta saetning">Lost it? Revoke it in the list and make a new one —
        that is quicker than looking for it.</p>
      </div>
    </div>`;
  document.body.appendChild(host);

  const luk = () => { host.remove(); document.removeEventListener('keydown', paaTast); };
  const paaTast = (e) => { if (e.key === 'Escape') { e.preventDefault(); luk(); } };
  document.addEventListener('keydown', paaTast);
  host.querySelector('#noegleLuk').addEventListener('click', luk);
  host.querySelector('#noegleFaerdig').addEventListener('click', luk);
  /*
   * Et klik ved siden af lukker IKKE.
   *
   * Alle andre ruder i appen lukker paa baggrunden, og det er rigtigt for
   * dem: man kan aabne dem igen. Den her kan man ikke - et fejlklik ville
   * koste noeglen. Reglen boejes netop dér, hvor den ellers ville gøre skade.
   */

  const kopi = host.querySelector('#noegleKopi');
  if (kopi) {
    kopi.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(noegle);
        kopi.textContent = 'Copied';
        toast('Key copied. Paste it where it belongs before you close this.');
      } catch { toast('The browser would not let me copy — select the text instead.'); }
    });
  }
  // Markér hele vaerdien, saa den kan tages med ét greb paa en telefon.
  const tekst = host.querySelector('#noegleTekst');
  if (tekst) {
    tekst.addEventListener('click', () => {
      const r = document.createRange();
      r.selectNodeContents(tekst);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    });
  }
}

function bindSettings() {
  bindFaner();
  // Listerne hentes bagefter og erstatter kun deres eget element: en side, der
  // venter paa alle sine kald, foeles langsom, og listen er ikke det, man kom
  // efter (RUNE-ERFARINGER, doda v27).
  (async () => {
    const host = document.getElementById('udgivListe');
    if (!host) return;
    host.innerHTML = await udgivelsesListeHtml();
    bindUdgivelsesListe();
  })();

  const ghGem = document.getElementById('ghGem');
  if (ghGem) {
    ghGem.addEventListener('click', async () => {
      const felt = document.getElementById('ghToken');
      ghGem.disabled = true;
      try {
        const d = await api('POST', '/api/v1/github/token', { token: felt.value.trim() });
        toast(d.connected ? `Connected to GitHub as ${d.login}.` : 'Disconnected.');
        tegnSide();
      } catch (ex) { toast(ex.message); ghGem.disabled = false; }
    });
  }

  const ghFjern = document.getElementById('ghFjern');
  if (ghFjern) {
    ghFjern.addEventListener('click', async () => {
      // Tom streng = kobl fra. Cachen bliver staaende: den er ikke hemmelig,
      // og et uddrag, man allerede har set, skal ikke forsvinde.
      try {
        await api('POST', '/api/v1/github/token', { token: '' });
        toast('Disconnected from GitHub.');
        tegnSide();
      } catch (ex) { toast(ex.message); }
    });
  }

  (async () => {
    const host = document.getElementById('forbListe');
    if (!host) return;
    host.innerHTML = await forbindelsesListeHtml();
    bindForbindelsesListe();
  })();

  document.querySelectorAll('[data-tema]').forEach((el) => {
    el.addEventListener('click', () => { anvendTema(el.dataset.tema); opdaterTemaKnap(); });
  });

  const form = document.getElementById('kodeordForm');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('POST', '/api/password', {
          current: document.getElementById('kodeNu').value,
          next: document.getElementById('kodeNy').value,
        });
        toast('Password changed. Other sessions were signed out.');
        form.reset();
      } catch (ex) { toast(ex.message); }
    });
  }

  const reg = document.getElementById('tilladReg');
  if (reg) {
    reg.addEventListener('change', async () => {
      try {
        await api('POST', '/api/v1/admin', { allowRegistration: reg.checked });
        toast(reg.checked ? 'Anyone can now sign up.' : 'Sign-up is closed.');
      } catch (ex) { toast(ex.message); reg.checked = !reg.checked; }
    });
  }

  /*
   * Linjen under rullelisten skifter med valget.
   *
   * Tabellen nedenunder siger det hele, men den, der staar med musen paa
   * rullelisten, skal ikke skulle kigge et andet sted hen for at finde ud af,
   * hvad han lige har valgt.
   */
  const scopeValg = document.getElementById('noegleScope');
  const scopeTekst = document.getElementById('scopeHvornaar');
  if (scopeValg && scopeTekst) {
    const vis = () => {
      const s = SCOPES.find((x) => x.id === scopeValg.value);
      scopeTekst.innerHTML = s ? s.hvornaar : '';
    };
    scopeValg.addEventListener('change', vis);
    vis();
  }

  const prefHel = document.getElementById('prefHel');
  if (prefHel) {
    prefHel.addEventListener('change', async () => {
      try {
        const r = await api('POST', '/api/v1/prefs', { editWhole: prefHel.checked });
        state.prefs = Object.assign({}, state.prefs, { editWhole: r.editWhole });
        toast(r.editWhole ? 'A click now opens the whole note.' : 'A click now opens one paragraph.');
      } catch (ex) { toast(ex.message); prefHel.checked = !prefHel.checked; }
    });
  }

  tegnVersioner();
  tegnTotp();

  const kvoteGem = document.getElementById('kvoteGem');
  if (kvoteGem) {
    kvoteGem.addEventListener('click', async () => {
      const gb = Number(document.getElementById('kvoteFelt').value);
      if (!Number.isFinite(gb) || gb <= 0) { toast('Give it a number of gigabytes.'); return; }
      kvoteGem.disabled = true;
      try {
        await api('POST', '/api/v1/admin', { storageQuota: Math.round(gb * 1024 * 1024 * 1024) });
        toast('Storage limit saved.');
        await genindlaes();
      } catch (ex) { toast(ex.message); }
      kvoteGem.disabled = false;
    });
  }

  const omOpdater = document.getElementById('omOpdater');
  if (omOpdater) omOpdater.addEventListener('click', () => hentNyVersion());

  const klipLav = document.getElementById('klipLav');
  if (klipLav) {
    klipLav.addEventListener('click', async () => {
      const bog = document.getElementById('klipBog').value;
      const maerke = document.getElementById('klipMaerke').value.trim().replace(/^#/, '').replace(/\s+/g, '-');
      klipLav.disabled = true;
      try {
        /*
         * Noeglen laves HER og vises kun én gang - som alle andre noegler.
         *
         * Derfor bygges bogmaerket i samme aandedrag: bagefter findes den raa
         * noegle ikke laengere nogen steder, og en »byg den igen«-knap ville
         * kraeve en ny noegle. Navnet siger hvad den er til, saa den kan
         * genkendes paa noeglelisten, naar den skal trakkes tilbage.
         */
        const navn = `Bookmark${bog ? ` — ${bog}` : ''}`;
        const d = await api('POST', '/api/v1/keys', { name: navn, scope: 'capture' });
        /*
         * Og saa tegnes siden IKKE om.
         *
         * Foerste udgave kaldte `genindlaes()` bagefter, for at den nye
         * noegle kunne dukke op paa noeglelisten. Det slettede bogmaerket
         * igen i samme oejeblik, det var lavet - og noeglen vises kun én
         * gang, saa den var vaek for altid. Det er samme fejl som »jeg kan
         * ikke nå at se Access key når jeg opretter en ny« (Andreas), og
         * den er vaerre her, fordi der ikke engang staar noget at kopiere.
         *
         * Noeglelisten er ajour naeste gang siden tegnes. Bogmaerket bliver
         * staaende, til man selv gaar videre.
         */
        visKlip(byggKlip({ base: offentligBase(), noegle: d.key, notesbog: bog, tag: maerke }), bog, maerke);
      } catch (ex) { toast(ex.message); }
      klipLav.disabled = false;
    });
  }

  document.querySelectorAll('[data-nulstil]').forEach((el) => {
    el.addEventListener('click', () => visNulstilPanel(el.dataset.nulstil, el.dataset.navn));
  });

  const dodaGem = document.getElementById('dodaGem');
  if (dodaGem) {
    dodaGem.addEventListener('click', async () => {
      const url = document.getElementById('dodaUrl').value.trim();
      const key = document.getElementById('dodaKey').value.trim();
      dodaGem.disabled = true;
      dodaGem.textContent = 'Testing…';
      try {
        // Serveren proever forbindelsen FOER den gemmer, og ruller tilbage
        // ved fejl - saa der aldrig ligger et token og LIGNER en virkende
        // forbindelse (RUNE-ERFARINGER, doda v16).
        const r = await api('POST', '/api/v1/doda', { url, key });
        toast(r.message || 'Connected to doda.');
        await tegnSide();
      } catch (ex) {
        toast(ex.message);
        dodaGem.disabled = false;
        dodaGem.textContent = 'Connect';
      }
    });
  }
  const dodaFjern = document.getElementById('dodaFjern');
  if (dodaFjern) {
    dodaFjern.addEventListener('click', async () => {
      // Sig hvad der SKER med det, der allerede findes - ellers toer man ikke
      // trykke (RUNE-ERFARINGER, doda v35).
      if (!window.confirm('Disconnect doda? The tasks your notes have already sent stay '
        + 'where they are, in doda and on the notes.')) return;
      try {
        await api('DELETE', '/api/v1/doda');
        toast('doda disconnected.');
        await tegnSide();
      } catch (ex) { toast(ex.message); }
    });
  }

  // En noegle er ubrugelig uden en opskrift. Herfra er der ét klik til dem.
  const tilApi = document.getElementById('tilApi');
  if (tilApi) tilApi.addEventListener('click', () => gaaTil('api'));

  const gemUrl = document.getElementById('offentligGem');
  if (gemUrl) {
    const felt = document.getElementById('offentligUrl');
    const saet = async (v) => {
      try {
        const r = await api('POST', '/api/v1/admin', { publicUrl: v });
        state.publicUrl = r.publicUrl || '';
        toast(state.publicUrl
          ? `Published links now start with ${state.publicUrl}`
          : 'Published links now use the address you are on.');
        await tegnSide();
      } catch (ex) { toast(ex.message); }
    };
    gemUrl.addEventListener('click', () => saet(felt.value));
    const ryd = document.getElementById('offentligRyd');
    /*
     * Knappen hed »Use this address«, og den RYDDER feltet.
     *
     * Meningen var »brug den adresse, du staar paa« - men ved siden af et
     * felt, man lige har skrevet en adresse i, laeses den som »brug DEN her
     * adresse«. Andreas trykkede paa den efter at have rettet adressen og
     * fik den gamle tilbage; knappen gjorde noejagtig det, den skulle, og
     * stik imod det, den sagde (2026-08-21).
     *
     * **En knap skal hedde det, den goer** - og naar den goer noget, man ikke
     * kan fortryde med det samme, skal den spoerge.
     */
    if (ryd) {
      ryd.addEventListener('click', () => {
        if (!confirm('Remove the fixed public address?\n\n'
          + 'Published links will then use whichever address you open Sagu on.')) return;
        saet('');
      });
    }
  }

  const nyNoegle = document.getElementById('noegleNy');
  if (nyNoegle) {
    nyNoegle.addEventListener('click', async () => {
      try {
        const d = await api('POST', '/api/v1/keys', {
          name: document.getElementById('noegleNavn').value,
          scope: document.getElementById('noegleScope').value,
        });
        /*
         * Vaerdien vises ÉN gang - og skal derfor overleve optegningen.
         *
         * Foer stod den i et `<p>` paa siden, og saa blev `tegnSide()` kaldt
         * med det samme for at faa den nye noegle med i listen. Noeglen
         * blinkede og var vaek, foer man kunne naa at laese den (Andreas,
         * 2026-08-21) - og den kan ikke hentes frem igen.
         *
         * En rude staar uden for siden og roeres ikke af en optegning. Den
         * er samtidig den aerlige form for noget, man kun faar at se én
         * gang: man skal lukke den selv.
         */
        await tegnSide();
        visNoeglePanel(d.key, d.scope);
      } catch (ex) { toast(ex.message); }
    });
  }

  document.querySelectorAll('[data-noegleslet]').forEach((el) => {
    el.addEventListener('click', async () => {
      try {
        await api('DELETE', `/api/v1/keys/${el.dataset.noegleslet}`);
        toast('Key revoked.');
        await tegnSide();
      } catch (ex) { toast(ex.message); }
    });
  });

  tegnFilListe();

  const pkAdd = document.getElementById('pkTilfoej');
  if (pkAdd) {
    pkAdd.addEventListener('click', async () => {
      try {
        await tilfoejPasskey();
        toast('Passkey added.');
        await tegnSide();
      } catch (ex) {
        if (ex.name !== 'NotAllowedError') toast(ex.message || 'The passkey did not work');
      }
    });
  }

  document.querySelectorAll('[data-pkslet]').forEach((el) => {
    el.addEventListener('click', async () => {
      try {
        await api('DELETE', `/api/v1/passkeys/${encodeURIComponent(el.dataset.pkslet)}`);
        toast('Passkey removed.');
        await tegnSide();
      } catch (ex) { toast(ex.message); }
    });
  });
}

/* ================================================ import og eksport (F5) = */

/*
 * Importen koerer som et BAGGRUNDSJOB paa serveren. Frontenden poller og viser
 * et baand - saa kan Andreas lukke browseren, mens 234 MB gaar ind
 * (RUNE-ERFARINGER §6c). En loekke her ville doe med fanen.
 */
const importUI = {
  uploadId: null,
  forhaand: null,
  poller: null,
  /*
   * Har vi allerede ryddet op efter DENNE import?
   *
   * `foelgImport()` kaldte `genindlaes()`, naar en import var faerdig - og
   * `genindlaes()` kalder `foelgImport()`. To funktioner, der kalder hinanden,
   * og en tilstand (`done`), der ikke aendrer sig: løkken koerte i det
   * uendelige, hentede hele state'en og gentegnede siden hver gang. Det saa
   * ud som om siden »hoppede«, og kvitteringen - med listen over det, der
   * blev sprunget over - forsvandt, foer man kunne laese den (Andreas,
   * 2026-08-21).
   *
   * Stemplet er importens starttidspunkt: en NY import har et nyt, saa den
   * bliver ryddet op efter, mens den samme aldrig bliver det to gange.
   */
  ryddetEfter: null,
};

function sideImport() {
  return `
    <h2>Import from Notion</h2>
    <div class="card">
      <p class="meta saetning">In Notion: <strong>Settings → Export all workspace content</strong>,
      format <strong>Markdown &amp; CSV</strong>, include subpages. You get a zip — drop it here.</p>
      <div class="dropzone" id="importDrop">
        <input type="file" id="importFil" accept=".zip" hidden>
        <button class="btn" id="importVaelg">Choose a zip…</button>
        <p class="meta saetning" style="margin-top:8px">or drag it onto this box</p>
      </div>
      <div id="importSvar"></div>
      <p class="meta saetning"><strong>Is the archive bigger than 100 MB?</strong>
      Then send it straight to the server instead of through your tunnel.
      Cloudflare's free plan refuses request bodies over 100 MB, and a big Notion export
      is well past that — the upload climbs and then stops. Open Sagu on the server's own
      address on your network (something like <code>http://192.168.1.50:8080</code>) and
      import there. It is also many times faster, because nothing leaves the house.</p>
    </div>

    <h2>Export</h2>
    <div class="card">
      <p class="meta saetning">Markdown is the format your notes are already stored in, so an
      export loses nothing. The JSON file is the one to keep for a full restore.</p>
      <div class="btnrow" style="margin-top:12px">
        <a class="btn" href="/api/v1/export?format=md" download>Markdown + files (.zip)</a>
        <a class="btn" href="/api/v1/export?format=json" download>Everything (.json)</a>
        <a class="btn ghost" href="/api/v1/export?format=json&files=0" download>Notes only (.json)</a>
      </div>
      <p class="meta saetning" style="margin-top:12px">For a full server backup — including
      settings and keys — use the panel's own backup. It already covers <code>/data</code>.</p>
    </div>`;
}

function bindImport() {
  const felt = document.getElementById('importFil');
  const vaelg = document.getElementById('importVaelg');
  const zone = document.getElementById('importDrop');
  if (!felt || !zone) return;

  vaelg.addEventListener('click', () => felt.click());
  felt.addEventListener('change', () => { if (felt.files[0]) sendArkiv(felt.files[0]); });

  let dybde = 0;
  zone.addEventListener('dragenter', (e) => { e.preventDefault(); dybde++; zone.classList.add('over'); });
  zone.addEventListener('dragover', (e) => e.preventDefault());
  zone.addEventListener('dragleave', () => { dybde = Math.max(0, dybde - 1); if (!dybde) zone.classList.remove('over'); });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    dybde = 0;
    zone.classList.remove('over');
    if (e.dataTransfer.files[0]) sendArkiv(e.dataTransfer.files[0]);
  });

  // Koerer der allerede en import, skal siden vise den - ogsaa efter en
  // genindlaesning. Det er hele pointen med et baggrundsjob.
  foelgImport();
}

/**
 * Et arbejdsfelt, der SIGER hvad der sker.
 *
 * `pct: null` giver en ubestemt, vandrende bjaelke. Den bruges, hvor serveren
 * er optaget og ikke KAN svare paa, hvor langt den er - og en opdigtet
 * procent, der staar stille, er vaerre end en, der aabenlyst bare arbejder.
 */
function arbejdeHtml(overskrift, linje, pct) {
  return `<div class="forhaand">
      <h3>${esc(overskrift)}</h3>
      <div class="plads-bar${pct === null ? ' ubestemt' : ''}">
        <div class="plads-fyld" style="${pct === null ? '' : `width:${pct}%`}"></div></div>
      <p class="meta saetning" style="margin-top:8px">${esc(linje)}</p>
    </div>`;
}

async function sendArkiv(fil) {
  const svar = document.getElementById('importSvar');
  svar.innerHTML = arbejdeHtml('Uploading…', `0 of ${visStoerrelse(fil.size)}`, 0);
  try {
    /*
     * XHR og ikke fetch - ene og alene for `upload.onprogress`.
     *
     * En Notion-eksport er hundredvis af MB, og `fetch` kan ikke fortaelle,
     * hvor langt afsendelsen er naaet. Uden det staar der »Uploading…« i et
     * minut, og brugeren kan ikke se forskel paa »i gang« og »gaaet i staa«.
     */
    const d = await new Promise((ok, nej) => {
      const x = new XMLHttpRequest();
      x.open('POST', `/api/v1/upload?name=${encodeURIComponent(fil.name)}`);
      x.withCredentials = true;
      x.setRequestHeader('X-Sagu-Upload', '1');
      x.setRequestHeader('Content-Type', 'application/zip');
      x.upload.addEventListener('progress', (e) => {
        if (!e.lengthComputable) return;
        svar.innerHTML = arbejdeHtml('Uploading…',
          `${visStoerrelse(e.loaded)} of ${visStoerrelse(e.total)}`,
          Math.round((e.loaded / e.total) * 100));
      });
      x.addEventListener('load', () => {
        let krop = {};
        try { krop = JSON.parse(x.responseText); } catch { /* serveren svarede ikke JSON */ }
        if (x.status >= 200 && x.status < 300) ok(krop);
        else nej(new Error(krop.message || `Upload failed (${x.status})`));
      });
      // En fetch, der kaster, har ingen status - browserens egen ordlyd
      // (»Load failed«) siger brugeren intet (RUNE-ERFARINGER, doda v11).
      x.addEventListener('error', () => nej(new Error('The upload did not get through. Is the server still running?')));
      x.addEventListener('abort', () => nej(new Error('The upload was stopped.')));
      x.send(fil);
    });
    importUI.uploadId = d.id;

    // Serveren laeser hele zip'ens indhold her og kan ikke svare imens.
    // Derfor en ubestemt bjaelke - og en linje, der siger, at det tager tid.
    svar.innerHTML = arbejdeHtml('Looking inside the archive…',
      'Reading the file list. A large export takes a few seconds.', null);
    const f = await api('POST', '/api/v1/import/preview', { uploadId: d.id });
    importUI.forhaand = f;
    visForhaand(f);
  } catch (ex) {
    svar.innerHTML = `<p class="meta saetning" style="color:var(--danger)">${esc(ex.message)}</p>`;
  }
}

/*
 * Vis hvad der VILLE ske, foer det sker.
 *
 * Det er den eneste maade at opdage, at man har valgt den forkerte zip, foer
 * 278 noter ligger i arkivet - og den eneste maade at se, at en genkoersel
 * ikke laver dubletter.
 */
function visForhaand(f) {
  const svar = document.getElementById('importSvar');
  svar.innerHTML = `
    <div class="forhaand">
      <h3>What this archive holds</h3>
      <table class="data">
        <tr><td>Pages</td><td class="num">${f.pages}</td>
          <td class="meta saetning">${f.newPages} new · ${f.existingPages} already imported</td></tr>
        <tr><td>Databases → notebooks</td><td class="num">${f.databases}</td>
          <td class="meta saetning">${f.notebooks.slice(0, 6).map(esc).join(', ')}${f.notebooks.length > 6 ? '…' : ''}</td></tr>
        <tr><td>Files</td><td class="num">${f.files}</td>
          <td class="meta saetning">${esc(visStoerrelse(f.unpacked))} unpacked</td></tr>
        ${f.linkedViews ? `<tr><td>Linked views</td><td class="num">${f.linkedViews}</td>
          <td class="meta saetning">skipped — they are views of databases that live elsewhere,
          and importing them would duplicate the rows</td></tr>` : ''}
      </table>
      ${f.existingPages ? `<p class="meta saetning" style="margin-top:10px">
        ${f.existingPages} pages are already here and will be <strong>updated</strong>, not duplicated —
        the import matches on Notion's own id.</p>` : ''}
      <p class="meta saetning" style="margin-top:10px">Notion does <strong>not</strong> export comments,
      page history, synced blocks or database relations. Those cannot come along.</p>
      <div class="btnrow" style="margin-top:14px">
        <button class="btn primary" id="importStart">Import ${f.pages} pages</button>
        <button class="btn ghost" id="importFortryd">Cancel</button>
      </div>
    </div>`;

  document.getElementById('importStart').addEventListener('click', async () => {
    try {
      await api('POST', '/api/v1/import', { uploadId: importUI.uploadId });
      foelgImport();
    } catch (ex) { toast(ex.message); }
  });
  document.getElementById('importFortryd').addEventListener('click', () => {
    importUI.uploadId = null;
    document.getElementById('importSvar').innerHTML = '';
  });
}

/** Poller status. Baandet staar, ogsaa naar man skifter skaerm. */
async function foelgImport() {
  clearTimeout(importUI.poller);
  let st;
  try { st = await api('GET', '/api/v1/import'); } catch { return; }
  tegnImportBaand(st);
  const svar = document.getElementById('importSvar');
  if (svar && (st.running || st.phase)) svar.innerHTML = importStatusHtml(st);
  if (st.running) {
    importUI.poller = setTimeout(foelgImport, 700);
    return;
  }
  if (st.phase === 'done' && importUI.ryddetEfter !== st.startedAt) {
    importUI.ryddetEfter = st.startedAt;
    // Traeet og taellerne skal opdateres - men KUN én gang. Se kommentaren
    // ved `ryddetEfter`.
    await hentState();
    opdaterNav();
    tegnTrae();
    // Kvitteringen tegnes IKKE om: den staar allerede, og den er det eneste
    // sted, man kan se hvad der blev sprunget over. En gentegning ville
    // rulle siden og lukke »2 skipped - see why« igen.
  }
}

function importStatusHtml(st) {
  const pct = st.total ? Math.min(100, Math.round((st.done / st.total) * 100)) : 0;
  const c = st.counts || {};
  if (st.running) {
    return `<div class="forhaand">
        <h3>${esc(st.phase)}…</h3>
        <div class="plads-bar${st.total ? '' : ' ubestemt'}">
          <div class="plads-fyld" style="${st.total ? `width:${pct}%` : ''}"></div></div>
        <p class="meta saetning" style="margin-top:8px">${st.total
    ? `${st.done} of ${st.total} · ${pct} %` : 'Getting started…'}</p>
        <div class="btnrow" style="margin-top:10px">
          <button class="btn ghost" id="importStop">Stop</button></div>
      </div>`;
  }
  if (st.error) {
    return `<div class="forhaand"><h3 style="color:var(--danger)">The import failed</h3>
      <p class="meta saetning">${esc(st.error)}</p></div>`;
  }
  // Kvitteringen. Den skal ogsaa sige, hvad der blev SPRUNGET OVER - en note,
  // der forsvandt tavst, opdages kun ved at taelle i begge ender.
  return `<div class="forhaand">
      <h3>Done</h3>
      <p class="meta saetning">${c.pages} pages · ${c.notebooks} notebooks · ${c.files} files ·
      ${c.links} internal links rewritten · ${c.tags} tags${c.updated ? ` · ${c.updated} updated` : ''}</p>
      ${c.moved ? `<p class="meta saetning">${c.moved} page${c.moved > 1 ? 's were' : ' was'} moved back
      into the structure the export describes — they had ended up somewhere else.</p>` : ''}
      ${st.skippedTotal ? `<details style="margin-top:10px">
        <summary class="meta saetning">${st.skippedTotal} skipped — see why</summary>
        <ul class="meta saetning">${st.skipped.map((s) =>
    `<li><code>${esc((s.sti || '').slice(-50))}</code> — ${esc(s.hvorfor)}</li>`).join('')}</ul>
      </details>` : ''}
    </div>`;
}

/**
 * Baandet i toppen. Det staar paa ENHVER skaerm, mens importen koerer -
 * ellers ser man ikke, at der sker noget, naar man klikker videre.
 */
function tegnImportBaand(st) {
  let host = document.getElementById('importBaand');
  if (!st || !st.running) { if (host) host.remove(); return; }
  if (!host) {
    host = document.createElement('div');
    host.id = 'importBaand';
    host.className = 'nudge';
    const main = document.querySelector('.main');
    if (!main) return;
    main.insertBefore(host, main.firstChild);
  }
  const pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
  host.innerHTML = `<span>Importing from Notion — ${esc(st.phase)} (${pct}%)</span>
    <button class="btn ghost" id="baandGa">Show</button>`;
  const knap = host.querySelector('#baandGa');
  if (knap) knap.addEventListener('click', () => gaaTil('import'));
}

/* ------------------------------- administratorens kodeordsnulstilling */

/*
 * Ruden, en administrator sætter et nyt kodeord i.
 *
 * ── Hvorfor kodeordet er SYNLIGT her ──────────────────────────────────────
 *
 * Et `type="password"` ville skjule det for den, der skal VIDEREGIVE det.
 * Admin sætter ikke kodeordet for sin egen skyld — han skal sige det til en
 * kollega bagefter, og en prik-række kan man ikke læse op. Modsat sit eget
 * kodeord, hvor felterne netop skal være skjulte, fordi ingen skal aflæse
 * dem over skulderen.
 *
 * ── Og hvorfor der er en »foreslå ét«-knap ────────────────────────────────
 *
 * Alternativet er, at der bliver skrevet »Sommer2026« ind, hver eneste gang.
 * Forslaget kommer fra `crypto.getRandomValues` — ikke fra `Math.random()`,
 * som hverken er tilfældig nok eller ment til det.
 */
function foreslaaKodeord() {
  // Ingen l/I/0/O: et kodeord, der skal læses op eller skrives af, må ikke
  // have tegn, man kan tage fejl af.
  const TEGN = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const tal = new Uint32Array(20);
  crypto.getRandomValues(tal);
  return [...tal].map((n) => TEGN[n % TEGN.length]).join('').replace(/(.{5})(?=.)/g, '$1-');
}

function visNulstilPanel(id, navn) {
  const gammel = document.getElementById('nulstilPanel');
  if (gammel) gammel.remove();

  const host = document.createElement('div');
  host.className = 'modal';
  host.id = 'nulstilPanel';
  host.innerHTML = `<div class="modal-kort">
      <div class="modal-top">
        <h2>Set a password for ${esc(pentBruger(navn))}</h2>
        <button class="iconbtn" id="nulstilLuk" aria-label="Close">${icon('luk', 16)}</button>
      </div>
      <div class="modal-krop">
        <label class="field"><span>New password</span>
          <input class="input" id="nulstilFelt" type="text" autocomplete="off"
            autocapitalize="none" autocorrect="off" spellcheck="false"
            placeholder="At least 8 characters"></label>
        <div class="btnrow" style="margin-top:10px">
          <button class="btn primary" id="nulstilGem">Set password</button>
          <button class="btn" id="nulstilForslag">Suggest one</button>
        </div>
        <p class="meta saetning" style="margin-top:12px">It is shown in full so you can pass it
        on. ${esc(pentBruger(navn))} is signed out everywhere the moment you set it, and should
        change it again under <strong>Your account</strong>. API keys are not touched.</p>
      </div>
    </div>`;
  document.body.appendChild(host);

  const luk = () => { host.remove(); document.removeEventListener('keydown', paaTast); };
  const paaTast = (e) => { if (e.key === 'Escape') { e.preventDefault(); luk(); } };
  document.addEventListener('keydown', paaTast);
  host.querySelector('#nulstilLuk').addEventListener('click', luk);
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });

  const felt = host.querySelector('#nulstilFelt');
  felt.focus();
  host.querySelector('#nulstilForslag').addEventListener('click', () => {
    felt.value = foreslaaKodeord();
    felt.focus();
    felt.select();
  });

  const gem = host.querySelector('#nulstilGem');
  const gaa = async () => {
    const ny = felt.value.trim();
    // Serveren afviser uanset hvad; det her er, for at man ikke skal proeve.
    if (ny.length < 8) { toast('The password must be at least 8 characters.'); felt.focus(); return; }
    gem.disabled = true;
    try {
      const r = await api('POST', `/api/v1/admin/users/${id}/password`, { next: ny });
      luk();
      toast(`${pentBruger(r.username || navn)} has a new password and is signed out everywhere.`);
    } catch (ex) {
      toast(ex.message);
      gem.disabled = false;
    }
  };
  gem.addEventListener('click', gaa);
  felt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); gaa(); }
    e.stopPropagation();
  });
}

/*
 * Det færdige bogmærke.
 *
 * Linket er ægte og trækbart: at trække det op i bogmærkelinjen er den måde,
 * et bogmærke installeres på, og en instruktion uden noget at trække i er
 * ingen instruktion. Kopier-knappen er til dem, der hellere vil indsætte det
 * i »nyt bogmærke«-dialogen — og til telefoner, hvor der ikke er en
 * bogmærkelinje at trække til.
 *
 * `onclick` returnerer false og gør ingenting: klikker man på linket HER,
 * ville browseren køre klippet på Sagus egen side. Det er ikke farligt, men
 * det ser ud som om knappen er i stykker.
 */
function visKlip(adresse, bog, maerke) {
  const ud = document.getElementById('klipUd');
  if (!ud) return;
  ud.innerHTML = `<div class="klip-faerdig">
      <p class="meta saetning"><strong>Drag this up to your bookmarks bar:</strong></p>
      <p style="margin:8px 0 12px"><a class="btn klip-link" id="klipLink">Save to Sagu</a></p>
      <div class="btnrow">
        <button class="btn" id="klipKopi">Copy the address</button>
      </div>
      <p class="meta saetning" style="margin-top:10px">Saves to
      <strong>${esc(bog || 'no notebook')}</strong>${maerke ? ` with <code>#${esc(maerke)}</code>` : ''}.
      Want it somewhere else too? Make a second one — each carries its own key.</p>
    </div>`;

  const link = ud.querySelector('#klipLink');
  link.href = adresse;
  link.addEventListener('click', (e) => { e.preventDefault(); toast('Drag it to your bookmarks bar instead.'); });

  ud.querySelector('#klipKopi').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(adresse);
      toast('Copied. Make a new bookmark and paste it as the address.');
    } catch {
      // Uden udklipsholder: vis den, saa den kan markeres i haanden.
      const felt = document.createElement('textarea');
      felt.className = 'input';
      felt.rows = 4;
      felt.value = adresse;
      felt.readOnly = true;
      ud.appendChild(felt);
      felt.select();
    }
  });
}

/* ------------------------------------------------------- nøglernes navne
 *
 * »Kan jeg ikke få samme navne som i doda under API adgange? Jeg kan godt se
 * at sagu har en link, men kan den ikke få en bedre beskrivelse så jeg kan se
 * hvornår jeg skal bruge den?« (Andreas, 2026-08-21).
 *
 * De hed `read`, `capture`, `link`, `full` — de rå ord fra `SCOPE_TILLADER`.
 * Et databasefelt er ikke en etiket: »link« siger ingenting om, hvad den kan
 * eller hvornår man vil have den, og man skulle læse et helt afsnit under
 * listen for at finde ud af det.
 *
 * De tre, doda også har, hedder nu **præcis det samme dér** — en familie af
 * apps, hvor det samme begreb hedder to ting, tvinger folk til at oversætte i
 * hovedet hver gang.
 *
 * `link` er Sagus egen, og den er den, der havde brug for forklaringen: den
 * kan læse OG lægge nyt ind, men aldrig ændre eller slette.
 *
 * ── Rækkefølgen er ikke tilfældig ─────────────────────────────────────────
 *
 * Den smalleste står øverst og er derfor forvalgt — samme som i doda. Den,
 * der ikke tager stilling, får den nøgle, der kan mindst.
 */
const SCOPES = [
  {
    id: 'capture',
    etiket: 'Capture only — can add, cannot read',
    hvornaar: 'An iPhone shortcut, a Siri command, the <strong>Save to Sagu</strong> bookmark — '
      + 'anything that only sends something in. Lose the phone and it cannot pull your archive out.',
  },
  {
    id: 'read',
    etiket: 'Read only',
    hvornaar: 'Something that looks but must never write: a script that searches your notes, '
      + 'a dashboard, a backup that mirrors the archive.',
  },
  {
    id: 'link',
    etiket: 'Read and add — cannot change or delete',
    hvornaar: 'Both of the above and nothing more — it can find the right note and add to it, '
      + 'but never rewrite or remove what is already there. Pick this when another program '
      + 'should be able to write <em>alongside</em> you rather than over you.',
  },
  {
    id: 'full',
    etiket: 'Full access',
    hvornaar: 'Everything above, and changing and deleting. Claude and other MCP clients need '
      + 'this to edit. No key can make another key or change your password — not even this one.',
  },
];

/** Ét sted at slå etiketten op, så tabellen og rullelisten ikke kan drive fra hinanden. */
function scopeNavn(id) {
  const s = SCOPES.find((x) => x.id === id);
  return s ? s.etiket : id;
}

/* ================================ totrinsbekræftelse (F21) ==============
 *
 * »doda har fået tilføjet 2FA kan du også tilføje det« (Andreas, 2026-08-22).
 *
 * ── Hvorfor den findes ved siden af passkeys ──────────────────────────────
 *
 * Passkeys er stærkere — de kan ikke phishes — men de kræver https, og Sagu
 * nås også på `IP:port` over ren http fra panelet, hvor `navigator.credentials`
 * slet ikke findes. Kodeordet skal derfor altid virke, og så er kodeordet
 * *alene* det svageste led. TOTP lukker netop dét hul, dér hvor en passkey
 * ikke kan (RUNE-ERFARINGER §9d).
 *
 * ── De to ting fladen skal gøre rigtigt ───────────────────────────────────
 *
 *  1. **Nødkoderne vises ÉN gang.** De hashes på serveren, præcis som et
 *     kodeord, så de kan ikke hentes frem igen. Ruden bliver derfor stående,
 *     til man selv lukker den — den må ikke forsvinde i en gentegning, sådan
 *     som bogmærket gjorde, før `genindlaes()` blev fjernet derfra.
 *  2. **Der står, hvad man mister.** At slå det fra kræver kodeordet, og det
 *     står skrevet, før man trykker — ikke i en fejlbesked bagefter.
 */
async function tegnTotp() {
  const host = document.getElementById('totpKort');
  if (!host) return;
  let st;
  try { st = await api('GET', '/api/v1/totp'); } catch { host.innerHTML = ''; return; }

  if (st.enabled) {
    host.innerHTML = `<p class="lead" style="margin-top:0">
        <strong>On.</strong> Signing in needs a code from your authenticator app.</p>
      <p class="meta saetning">${st.recoveryLeft} recovery code${st.recoveryLeft === 1 ? '' : 's'} left.
      They are the way back in if you lose the phone — there is no support desk on your own server.</p>
      <div class="btnrow" style="margin-top:12px">
        <button class="btn" id="totpNyeKoder">New recovery codes</button>
        <button class="btn ghost danger" id="totpFra">Turn off</button>
      </div>`;
    host.querySelector('#totpNyeKoder').addEventListener('click', () => spoergKodeord({
      titel: 'New recovery codes',
      forklaring: 'The ten you have now stop working the moment the new ones appear.',
      knap: 'Make new codes',
      sti: '/api/v1/totp/recovery',
      efter: (d) => visNoedkoder(d.recovery),
    }));
    host.querySelector('#totpFra').addEventListener('click', () => spoergKodeord({
      titel: 'Turn off two-step verification',
      forklaring: 'Your password alone will be enough to sign in again. '
        + 'The secret and every recovery code are deleted.',
      knap: 'Turn it off',
      sti: '/api/v1/totp/disable',
      efter: () => { toast('Two-step verification is off.'); tegnTotp(); },
    }));
    return;
  }

  host.innerHTML = `<p class="meta saetning">A code from an authenticator app as the second step,
    on top of your password. Passkeys are stronger, but they need https — this works on
    <code>IP:port</code> over plain http too, which is exactly where the password stands alone.</p>
    ${st.pending ? '<p class="meta saetning">A setup was started but never finished. '
    + 'Starting again gives you a new QR code.</p>' : ''}
    <div class="btnrow" style="margin-top:12px">
      <button class="btn primary" id="totpStart">${st.pending ? 'Start over' : 'Set it up'}</button>
    </div>
    <div id="totpOpsaet"></div>`;
  host.querySelector('#totpStart').addEventListener('click', () => startTotp());
}

async function startTotp() {
  const ud = document.getElementById('totpOpsaet');
  if (!ud) return;
  ud.innerHTML = '<p class="meta saetning">Making a secret…</p>';
  let d;
  try { d = await api('POST', '/api/v1/totp/setup', {}); } catch (ex) { toast(ex.message); ud.innerHTML = ''; return; }

  ud.innerHTML = `<div class="totp-opsaet">
      <div class="totp-qr">${d.svg}</div>
      <div class="totp-trin">
        <p class="meta saetning"><strong>1.</strong> Scan this with Google Authenticator,
        1Password, Aegis — any authenticator app.</p>
        <p class="meta saetning"><strong>Cannot scan?</strong> Type the secret by hand:<br>
          <code class="totp-hem">${esc(d.secret)}</code></p>
        <label class="field" style="margin-top:12px"><span><strong>2.</strong> The code it shows</span>
          <input class="input" id="totpKode" inputmode="numeric" autocomplete="one-time-code"
            placeholder="123456" spellcheck="false" style="max-width:150px"></label>
        <div class="btnrow" style="margin-top:10px">
          <button class="btn primary" id="totpBekraeft">Turn it on</button>
        </div>
        <p class="meta saetning" style="margin-top:10px">Nothing is switched on until that code
        fits. A mis-scan cannot lock you out of your own server.</p>
      </div>
    </div>`;

  const felt = ud.querySelector('#totpKode');
  const knap = ud.querySelector('#totpBekraeft');
  felt.focus();
  const gaa = async () => {
    const kode = felt.value.trim();
    if (kode.length < 6) { toast('Six digits from the app.'); felt.focus(); return; }
    knap.disabled = true;
    try {
      const r = await api('POST', '/api/v1/totp/enable', { code: kode });
      visNoedkoder(r.recovery);
      await tegnTotp();
    } catch (ex) { toast(ex.message); felt.value = ''; felt.focus(); knap.disabled = false; }
  };
  knap.addEventListener('click', gaa);
  felt.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); gaa(); } });
}

/*
 * Koderne vises ÉN gang.
 *
 * Serveren gemmer kun en hash af dem, præcis som et kodeord, så der er ingen
 * vej til at få dem at se igen. Ruden lukker derfor ikke af sig selv, og
 * teksten siger det højt — det er billigere end at forklare bagefter.
 */
function visNoedkoder(koder) {
  const gammel = document.getElementById('noedPanel');
  if (gammel) gammel.remove();
  const host = document.createElement('div');
  host.className = 'modal';
  host.id = 'noedPanel';
  host.innerHTML = `<div class="modal-kort">
      <div class="modal-top">
        <h2>Your recovery codes</h2>
        <button class="iconbtn" id="noedLuk" aria-label="Close">${icon('luk', 16)}</button>
      </div>
      <div class="modal-krop">
        <p class="lead">Save them now — <strong>they are never shown again.</strong>
        Each one works once, and they are the way back in if you lose the phone.</p>
        <div class="noedkoder">${koder.map((k) => `<code>${esc(k)}</code>`).join('')}</div>
        <div class="btnrow" style="margin-top:14px">
          ${navigator.clipboard ? '<button class="btn primary" id="noedKopi">Copy all</button>' : ''}
          <button class="btn" id="noedFaerdig">I have saved them</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(host);
  const luk = () => { host.remove(); document.removeEventListener('keydown', paaTast); };
  const paaTast = (e) => { if (e.key === 'Escape') { e.preventDefault(); luk(); } };
  document.addEventListener('keydown', paaTast);
  host.querySelector('#noedLuk').addEventListener('click', luk);
  host.querySelector('#noedFaerdig').addEventListener('click', luk);
  const kopi = host.querySelector('#noedKopi');
  if (kopi) {
    kopi.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(koder.join('\n')); toast('Copied.'); }
      catch { toast('Could not copy — select them by hand.'); }
    });
  }
  // Ingen lukning ved klik udenfor: det er for let at ramme ved siden af og
  // miste ti koder, man ikke kan faa igen.
}

/** Ruden, der beder om kodeordet, før noget farligt sker. */
function spoergKodeord(o) {
  const gammel = document.getElementById('kodeordPanel');
  if (gammel) gammel.remove();
  const host = document.createElement('div');
  host.className = 'modal';
  host.id = 'kodeordPanel';
  host.innerHTML = `<div class="modal-kort">
      <div class="modal-top">
        <h2>${esc(o.titel)}</h2>
        <button class="iconbtn" id="kpLuk" aria-label="Close">${icon('luk', 16)}</button>
      </div>
      <div class="modal-krop">
        <p class="meta saetning">${esc(o.forklaring)}</p>
        <label class="field" style="margin-top:12px"><span>Your password</span>
          <input class="input" id="kpFelt" type="password" autocomplete="current-password"></label>
        <div class="btnrow" style="margin-top:12px">
          <button class="btn primary" id="kpGem">${esc(o.knap)}</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(host);
  const luk = () => { host.remove(); document.removeEventListener('keydown', paaTast); };
  const paaTast = (e) => { if (e.key === 'Escape') { e.preventDefault(); luk(); } };
  document.addEventListener('keydown', paaTast);
  host.querySelector('#kpLuk').addEventListener('click', luk);
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });
  const felt = host.querySelector('#kpFelt');
  const knap = host.querySelector('#kpGem');
  felt.focus();
  const gaa = async () => {
    knap.disabled = true;
    try {
      const d = await api('POST', o.sti, { password: felt.value });
      luk();
      o.efter(d);
    } catch (ex) { toast(ex.message); felt.value = ''; felt.focus(); knap.disabled = false; }
  };
  knap.addEventListener('click', gaa);
  felt.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); gaa(); } });
}

/* ============================ versionshistorik (F22) ====================
 *
 * »Denne funktion skal kunne slås fra inde i indstillinger og det skal også
 * være muligt at sætte antallet af versioner den gemmer« (Andreas,
 * 2026-08-25).
 *
 * ── Indstillingen er PERSONLIG ────────────────────────────────────────────
 *
 * Sagu er flerbruger. Ville alice have historik og bob ikke, ville en
 * serverindstilling tvinge dem til at blive enige om noget, der kun handler
 * om deres egne noter.
 */
async function tegnVersioner() {
  const host = document.getElementById('versionKort');
  if (!host) return;
  let d;
  // Opsaetningen ligger paa versions-endepunktet, som kraever en NOTE. Har man
  // ingen, er der heller ingen historik at indstille - men kortet skal stadig
  // kunne vise kontakten, saa vi spoerger gennem den billigste vej der findes.
  try { d = await api('POST', '/api/v1/versions', {}); } catch { host.innerHTML = ''; return; }

  host.innerHTML = `<label class="switch">
      <input type="checkbox" id="verTil" ${d.enabled ? 'checked' : ''}>
      <span>Keep earlier versions of my notes</span></label>
    <p class="meta saetning">A version is kept each time you come back and change something.
    Edits within the same sitting count as one, so the ${esc(String(d.keep))} you keep cover
    ${esc(String(d.keep))} separate times you worked on the note — not the last few minutes.</p>
    <label class="field" style="margin-top:14px"><span>Versions to keep per note</span>
      <div class="btnrow">
        <input class="input" id="verAntal" type="number" min="1" max="200" step="1"
          style="max-width:110px" value="${esc(String(d.keep))}" ${d.enabled ? '' : 'disabled'}>
        <button class="btn" id="verGem" ${d.enabled ? '' : 'disabled'}>Save</button>
      </div></label>
    <p class="meta saetning">Turning it off stops new versions from being kept.
    <strong>What is already saved stays</strong> — it is a fact about the note, and throwing it
    away because you changed a setting would be rewriting history. Open a note's
    <strong>…</strong> menu to see and restore them.</p>`;

  host.querySelector('#verTil').addEventListener('change', async (e) => {
    try {
      await api('POST', '/api/v1/versions', { enabled: e.target.checked });
      toast(e.target.checked ? 'Versions are kept again.' : 'No new versions will be kept.');
      tegnVersioner();
    } catch (ex) { toast(ex.message); e.target.checked = !e.target.checked; }
  });
  const gem = host.querySelector('#verGem');
  if (gem) {
    gem.addEventListener('click', async () => {
      const antal = Number(host.querySelector('#verAntal').value);
      gem.disabled = true;
      try {
        await api('POST', '/api/v1/versions', { keep: antal });
        toast('Saved.');
        tegnVersioner();
      } catch (ex) { toast(ex.message); gem.disabled = false; }
    });
  }
}
