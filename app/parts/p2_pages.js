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
}

async function tegnSideIndhold() {
  const host = document.getElementById('pageHost');
  if (!host) return;
  const v = viewById(state.view);
  const hoved = `<h1>${esc(v.label)}</h1><p class="lead">${esc(BESKRIVELSER[v.id] || '')}</p>`;

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
    <div class="card"><div class="tablewrap"><table class="data">
      <thead><tr><th>Title</th><th>Tags</th><th class="num">Updated</th><th></th></tr></thead>
      <tbody>${d.notes.map((n) => `<tr>
        <td><button class="linkknap" data-aabn="${esc(n.id)}">${esc(n.title || 'Untitled')}</button></td>
        <td><span class="chips">${n.tags.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</span></td>
        <td class="num">${esc(visTid(n.updatedAt))}</td>
        <td style="text-align:right;white-space:nowrap">
          ${opt.trash ? '' : `<button class="btn ghost" data-slet="${esc(n.id)}">Delete</button>`}</td>
      </tr>`).join('')}</tbody>
    </table></div></div>`;
}

function bindNoteliste() {
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

  return `
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

  <h2>Access keys</h2>
  <div class="card">
    <p class="meta saetning">For iPhone shortcuts, other apps and the doda link.
    A key reaches your own notes and nothing else. The value is shown once.</p>
    ${noegler.length ? `<div class="tablewrap"><table class="data">
      <thead><tr><th>Name</th><th>Scope</th><th class="num">Last used</th><th></th></tr></thead>
      <tbody>${noegler.map((k) => `<tr><td>${esc(k.name)}</td><td>${esc(k.scope)}</td>
        <td class="num">${esc(k.last_used_at ? visTid(k.last_used_at) : 'never')}</td>
        <td style="text-align:right"><button class="btn ghost danger" data-noegleslet="${esc(k.id)}">Revoke</button></td>
      </tr>`).join('')}</tbody></table></div>` : ''}
    <div class="btnrow" style="margin-top:14px">
      <input class="input" id="noegleNavn" placeholder="What is it for?" style="max-width:220px">
      <select class="input" id="noegleScope" style="max-width:150px">
        <option value="read">read</option>
        <option value="capture">capture</option>
        <option value="link">link</option>
        <option value="full">full</option>
      </select>
      <button class="btn" id="noegleNy">Create key</button>
    </div>
    <div class="btnrow" style="margin-top:12px">
      <button class="btn" id="tilApi">How to use these →</button>
    </div>
    <p class="meta saetning"><strong>read</strong> looks but never writes.
    <strong>capture</strong> writes but never looks — a lost phone must not be able to
    read the archive. <strong>link</strong> does both, and nothing else: it is what a
    sister app needs to find the right note and make a new one.
    <strong>full</strong> can also change and delete.</p>
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
  ${dodaDel}
  ${ghDel}
  ${adminDel}`;
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
        <h2>Your new ${esc(scope || 'access')} key</h2>
        <button class="iconbtn" id="noegleLuk" aria-label="Close">${icon('luk', 16)}</button>
      </div>
      <div class="modal-krop">
        <p class="lead">Copy it now — <strong>it is never shown again.</strong>
        Sagu keeps only a hash of it, so there is no way to look it up later.</p>
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
