'use strict';
/* Sagu - at udgive en note som wiki (F6).
 *
 * Ruden er noteskaermens, fordi det er DÉR beslutningen tages: »denne side og
 * dens undersider skal kollegaerne kunne laese«. Listen over alt, der er
 * udgivet, staar i Settings - man skal kunne se hele fladen ét sted uden at
 * gaa gennem alle sine noter.
 *
 * Knappen i vaerktoejsraekken skifter udseende, naar noten ER udgivet. En
 * handling, der aendrer noget, skal efterlade et spor dér, hvor den blev
 * udfoert (RUNE-ERFARINGER, tovo v8) - ellers bliver funktionen meldt som
 * manglende, selv om den virker.
 */

/**
 * Den adresse, et link skal SKRIVES med.
 *
 * `location.origin` er den, browseren tilfaeldigvis staar paa - og Sagu kan
 * naas paa flere paa én gang. Uden valget ville et link, man kopierer fra den
 * ene adresse, sende kollegaen et andet sted hen end et kopieret fra den
 * anden. Tom indstilling = praecis som foer: browserens egen vaert.
 */
function offentligBase() {
  return (state.publicUrl || '').replace(/\/+$/, '') || location.origin;
}

/** Hele adressen. Vaerten er den offentlige; serveren gemmer kun stien. */
function udgivelsesLink(share) {
  return offentligBase() + share.path;
}

/**
 * Udgivelsen for ét maal - eller null. Ét kald, ikke en liste.
 *
 * @param {{slags:'note'|'bog', id:string, titel:string}} maal
 */
async function hentUdgivelse(maal) {
  const felt = maal.slags === 'bog' ? 'notebook' : 'note';
  try {
    const d = await api('GET', `/api/v1/shares?${felt}=${encodeURIComponent(maal.id)}`);
    return (d.shares && d.shares[0]) || null;
  } catch { return null; }
}

function udgivKnapHtml(share) {
  const paa = !!share;
  return `<button class="iconbtn${paa ? ' paa' : ''}" id="udgivBtn"
    aria-pressed="${paa ? 'true' : 'false'}"
    title="${paa ? 'Published on the web — open the settings' : 'Publish on the web'}">${icon('globe', 16)}</button>`;
}

/* ------------------------------------------------------------------ ruden */

/**
 * Udgivelsesruden.
 *
 * @param {{slags:'note'|'bog', id, titel}} [maal] - standard er den aabne note.
 *   En NOTESBOG kan udgives ligesaa vel som en side: et importeret arkiv ER en
 *   bog med sider i, og at kraeve en kunstig forside for at dele den ville
 *   vaere at bede brugeren om at lave om paa sit indhold for appens skyld
 *   (Andreas, 2026-08-21).
 */
async function visUdgivPanel(maal) {
  // `maal && maal.slags`, ikke bare `maal`: bindes funktionen ved et uheld
  // direkte som klik-handler, er argumentet en MouseEvent - den er sand, og
  // saa ville ruden arbejde videre paa et maal uden id. Vagten koster én
  // betingelse og lukker hele fejlklassen.
  const m = (maal && maal.slags) ? maal : (editor.note
    ? { slags: 'note', id: editor.note.id, titel: editor.note.title || 'Untitled' }
    : null);
  if (!m) return;
  const n = m.slags === 'note' && editor.note && editor.note.id === m.id ? editor.note : null;
  const gammel = document.getElementById('udgivPanel');
  if (gammel) { gammel.remove(); return; }

  const host = document.createElement('div');
  host.className = 'modal';
  host.id = 'udgivPanel';
  host.innerHTML = `<div class="modal-kort">
      <div class="modal-top">
        <h2>Publish “${esc(m.titel)}”</h2>
        <button class="iconbtn" id="udgivLuk" aria-label="Close">${icon('luk', 16)}</button>
      </div>
      <div class="modal-krop" id="udgivKrop"><p class="meta saetning">Loading…</p></div>
    </div>`;
  document.body.appendChild(host);

  const luk = () => { host.remove(); document.removeEventListener('keydown', paaTast); };
  const paaTast = (e) => { if (e.key === 'Escape') { e.preventDefault(); luk(); } };
  document.addEventListener('keydown', paaTast);
  host.querySelector('#udgivLuk').addEventListener('click', luk);
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });

  const krop = host.querySelector('#udgivKrop');
  let share = await hentUdgivelse(m);
  /*
   * Hvad laeserne ledte efter uden at finde noget.
   *
   * Loggen har ligget der siden F2, men kunne ikke SES nogen steder - og en
   * funktion, man ikke kan se, bliver meldt som manglende (tovo v8). Det er
   * samtidig den bedste indholdsplan en wiki kan faa (SAGU-PLAN §5): listen
   * siger, hvilke sider der mangler.
   */
  let forgaeves = [];
  if (share) {
    try {
      forgaeves = (await api('GET', `/api/v1/search-misses?scope=${share.id}`)).misses || [];
    } catch { /* listen er en tilgift, ikke en forudsaetning */ }
  }

  /** Tegner ruden om ud fra tilstanden. Ét sted, saa de to tilstande ikke driver. */
  function tegn() {
    krop.innerHTML = share ? udgivetHtml(share, m, { forgaeves }) : ikkeUdgivetHtml(m);
    bind();
    // Knappen i vaerktoejsraekken skal foelge med med det samme - ellers ser
    // man ikke, at noget skete, foer siden tegnes forfra. Og notens eget felt
    // skal rettes med, ellers lyver knappen ved naeste optegning.
    // Kun en NOTE baerer sin udgivelse i sit eget objekt; en bogs staar i
    // traeet og hentes derfra.
    if (n) n.published = share ? { id: share.id, path: share.path, hasPassword: share.hasPassword } : null;
    const knap = document.getElementById('udgivBtn');
    if (knap) {
      knap.classList.toggle('paa', !!share);
      knap.setAttribute('aria-pressed', share ? 'true' : 'false');
    }
  }

  function bind() {
    const q = (id) => krop.querySelector(`#${id}`);

    const udgiv = q('udgivNu');
    if (udgiv) {
      udgiv.addEventListener('click', async () => {
        udgiv.disabled = true;
        try {
          const d = await api('POST', '/api/v1/shares', Object.assign(
            m.slags === 'bog' ? { notebookId: m.id } : { noteId: m.id },
            {
            mode: m.slags === 'bog' ? 'tree' : q('udgivMode').value,
            slug: q('udgivSlug').value.trim() || null,
            password: q('udgivKode').value || null,
            allowSearch: true,
            }));
          share = d.share;
          toast('Published. Anyone with the link can read it.');
          tegn();
          // Traeet viser, hvilke boeger der er udgivet - det skal med samme.
          if (m.slags === 'bog') { await hentTrae(); tegnTrae(); }
        } catch (ex) { fejl(ex.message); udgiv.disabled = false; }
      });
    }

    const kopi = q('udgivKopi');
    if (kopi) {
      kopi.addEventListener('click', async () => {
        const felt = q('udgivUrl');
        // Ingen blindgyde: kan udklipsholderen ikke bruges (den kraever et
        // secure context, og panelet naas over http), saa MARKÉR i stedet.
        if (await kopier(udgivelsesLink(share))) { kopi.textContent = 'Copied'; } else if (markerTekst(felt)) {
          kopi.textContent = 'Press ⌘C';
        } else kopi.textContent = 'Could not copy';
        setTimeout(() => { kopi.textContent = 'Copy link'; }, 1600);
      });
    }

    const gemAdresse = q('udgivGemSlug');
    if (gemAdresse) {
      gemAdresse.addEventListener('click', () => saet({ slug: q('udgivSlug2').value.trim() || null }));
    }

    const kodeTil = q('udgivKodeTil');
    if (kodeTil) {
      kodeTil.addEventListener('click', () => {
        const v = q('udgivKodeNy').value;
        if (v.length < 6) { fejl('A wiki password must be at least 6 characters.'); return; }
        saet({ password: v });
      });
    }
    const kodeFra = q('udgivKodeFra');
    if (kodeFra) kodeFra.addEventListener('click', () => saet({ password: null }));

    krop.querySelectorAll('[data-flag]').forEach((el) => {
      el.addEventListener('change', () => saet({ [el.dataset.flag]: el.checked }));
    });

    const mode = q('udgivModeSkift');
    if (mode) mode.addEventListener('change', () => saet({ mode: mode.value }));

    // En koe, man skal lede efter, bliver aldrig toemt. Herfra er der ÉT klik
    // til den (RUNE-ERFARINGER, tovo v8).
    const tilKoe = q('udgivTilKoe');
    if (tilKoe) {
      tilKoe.addEventListener('click', () => {
        luk();
        gaaTil('comments');
      });
    }

    /*
     * En egen knap til at fjerne datoen.
     *
     * `<input type="date">` kan ikke ryddes i Safari - der er ingen kryds, og
     * feltet nulstiller ikke af sig selv. Uden knappen kunne en udgivelse med
     * en udloebsdato aldrig gøres permanent igen (Andreas, 2026-08-21).
     * Browserens egen kontrol er ikke altid en hel kontrol.
     */
    const intet = q('udgivIntetUdloeb');
    if (intet) intet.addEventListener('click', () => saet({ expiresAt: null }));

    const udloeb = q('udgivUdloeb');
    if (udloeb) {
      udloeb.addEventListener('change', () => {
        // Datoen laeses i LOKAL tid paa (aar, maaned, dag) og sendes som
        // sekunder. Aldrig en dato-streng: serveren skal ikke tolke tekst.
        if (!udloeb.value) { saet({ expiresAt: null }); return; }
        const [aa, mm, dd] = udloeb.value.split('-').map(Number);
        saet({ expiresAt: Math.floor(new Date(aa, mm - 1, dd, 23, 59, 59).getTime() / 1000) });
      });
    }

    const stop = q('udgivStop');
    if (stop) {
      stop.addEventListener('click', async () => {
        if (!confirm('Withdraw this link? Anyone who has it will get "Not found" on their next click.')) return;
        try {
          await api('DELETE', `/api/v1/shares/${share.id}`);
          share = null;
          toast('Withdrawn. The link is dead from the next click.');
          tegn();
          if (m.slags === 'bog') { await hentTrae(); tegnTrae(); }
        } catch (ex) { fejl(ex.message); }
      });
    }
  }

  function fejl(besked) {
    const el = krop.querySelector('#udgivFejl');
    if (el) { el.textContent = besked; el.hidden = false; } else toast(besked);
  }

  async function saet(felter) {
    try {
      const d = await api('PATCH', `/api/v1/shares/${share.id}`, felter);
      share = d.share;
      tegn();
    } catch (ex) { fejl(ex.message); }
  }

  tegn();
}

/* ------------------------------------------------------------ de to sider */

function ikkeUdgivetHtml(m) {
  const erBog = m.slags === 'bog';
  const forslag = (m.titel || 'wiki').toLowerCase()
    .replace(/[æ]/g, 'ae').replace(/[ø]/g, 'oe').replace(/[å]/g, 'aa')
    .replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return `
    <p class="lead">Put ${erBog ? 'this notebook' : 'this page'} on the web so people without
    an account can read it — the replacement for a Notion site.</p>
    ${erBog
    ? `<p class="meta saetning">Every page in the notebook is published, and the front page
       is a list of what is inside. Pages you add later come along by themselves.</p>`
    : `<label class="field"><span>What to publish</span>
      <select class="input" id="udgivMode">
        <option value="tree">This page and everything under it</option>
        <option value="single">Only this page</option>
      </select></label>`}
    <label class="field"><span>Web address</span>
      <div class="udgiv-adresse"><span class="adressepraefiks">${esc(offentligBase())}/w/</span>
        <input class="input" id="udgivSlug" value="${esc(forslag)}" placeholder="handbook"
          autocomplete="off" spellcheck="false"></div></label>
    <p class="meta saetning">Leave it empty for a long, unguessable address instead.</p>
    <label class="field"><span>Password (optional)</span>
      <input class="input" type="password" id="udgivKode" autocomplete="new-password"
        placeholder="No password — anyone with the link can read"></label>
    <p class="meta saetning">You can add or remove the password later, and the link stays
    the same either way.</p>
    <p class="wfejl" id="udgivFejl" hidden></p>
    <div class="btnrow" style="margin-top:16px">
      <button class="btn primary" id="udgivNu">Publish</button>
    </div>`;
}

function udgivetHtml(share, m, opt) {
  const o = opt || {};
  const erBog = share.kind === 'notebook';
  const url = udgivelsesLink(share);
  const dato = share.expiresAt
    ? new Date(share.expiresAt * 1000).toISOString().slice(0, 10) : '';
  return `
    <div class="udgiv-link">
      <input class="input" id="udgivUrl" value="${esc(url)}" readonly>
      <button class="btn" id="udgivKopi">Copy link</button>
      <a class="btn" href="${esc(share.path)}/" target="_blank" rel="noopener">Open</a>
    </div>
    <p class="meta saetning">${share.hasPassword
    ? 'Password protected. Visitors are asked for it before they see anything.'
    : 'Open — anyone with the link can read it. No account needed.'}
      ${share.views ? ` · read ${share.views} time${share.views === 1 ? '' : 's'}` : ' · not read yet'}</p>

    <h3 class="udgiv-hoved">What is published</h3>
    ${erBog
    ? `<p class="meta saetning">The whole notebook — every page in it, including ones you add later.</p>`
    : `<label class="field"><span>Scope</span>
      <select class="input" id="udgivModeSkift">
        <option value="tree"${share.mode === 'tree' ? ' selected' : ''}>This page and everything under it</option>
        <option value="single"${share.mode === 'single' ? ' selected' : ''}>Only this page</option>
      </select></label>`}
    <label class="switch"><input type="checkbox" data-flag="allowSearch"
      ${share.allowSearch ? 'checked' : ''}><span>Let readers search the wiki</span></label>
    <label class="switch"><input type="checkbox" data-flag="allowIndex"
      ${share.allowIndex ? 'checked' : ''}><span>Let search engines find it</span></label>
    <p class="meta saetning">Off means the page asks not to be indexed. A password-protected
    page is never indexed, whatever this says.</p>

    <h3 class="udgiv-hoved">Comments</h3>
    <label class="switch"><input type="checkbox" data-flag="allowComments"
      ${share.allowComments ? 'checked' : ''}><span>Let readers comment and suggest edits</span></label>
    ${share.allowComments ? `
      <label class="switch"><input type="checkbox" data-flag="moderateComments"
        ${share.moderateComments ? 'checked' : ''}><span>Read them before they appear</span></label>
      <p class="meta saetning">Readers have no account, so comments wait in your queue by default.
      Anything with a link waits either way.</p>
      ${share.pendingComments
    ? `<p class="udgiv-venter"><button class="linkbtn" id="udgivTilKoe">${share.pendingComments}
        ${share.pendingComments === 1 ? 'comment is' : 'comments are'} waiting to be read</button></p>`
    : '<p class="meta saetning">Nothing is waiting right now.</p>'}` : ''}

    <h3 class="udgiv-hoved">Address</h3>
    <div class="udgiv-adresse">
      <span class="adressepraefiks">${esc(offentligBase())}/w/</span>
      <input class="input" id="udgivSlug2" value="${esc(share.slug || '')}"
        placeholder="unguessable address in use" autocomplete="off" spellcheck="false">
      <button class="btn" id="udgivGemSlug">Save</button>
    </div>
    <p class="meta saetning">Changing this breaks links your colleagues already have.
    Turning the password on or off does not.</p>

    <h3 class="udgiv-hoved">Password</h3>
    ${share.hasPassword
    ? `<div class="btnrow">
         <input class="input" type="password" id="udgivKodeNy" placeholder="New password" autocomplete="new-password">
         <button class="btn" id="udgivKodeTil">Change</button>
         <button class="btn ghost" id="udgivKodeFra">Remove password</button>
       </div>
       <p class="meta saetning">Changing it signs out everyone who typed the old one.</p>`
    : `<div class="btnrow">
         <input class="input" type="password" id="udgivKodeNy" placeholder="At least 6 characters" autocomplete="new-password">
         <button class="btn" id="udgivKodeTil">Add a password</button>
       </div>
       <p class="meta saetning">The link stays exactly the same — bookmarks keep working.</p>`}

    <h3 class="udgiv-hoved">Expiry</h3>
    <div class="btnrow">
      <input class="input" type="date" id="udgivUdloeb" value="${esc(dato)}"
        aria-label="Stops working after" style="max-width:200px">
      ${dato ? '<button class="btn ghost" id="udgivIntetUdloeb">Never expire</button>' : ''}
    </div>
    <p class="meta saetning">${dato
    ? 'It stops working on that day. »Never expire« removes the date again.'
    : 'No expiry — it keeps working until you withdraw it.'}</p>

    ${o.forgaeves && o.forgaeves.length ? `<h3 class="udgiv-hoved">Looked for, not found</h3>
      <ul class="meta saetning" style="margin:0;padding-left:18px">
        ${o.forgaeves.slice(0, 8).map((m) => `<li>“${esc(m.term)}”${m.n > 1 ? ` — ${m.n} times` : ''}</li>`).join('')}
      </ul>
      <p class="meta saetning">What readers searched for here and got nothing. It is the
      shortest list of pages your wiki is missing.</p>` : ''}

    ${share.topPages && share.topPages.length ? `<h3 class="udgiv-hoved">Most read</h3>
      <ul class="meta saetning" style="margin:0;padding-left:18px">
        ${share.topPages.map((s) => `<li>${esc(s.title || 'Untitled')} — ${s.views}</li>`).join('')}
      </ul>
      <p class="meta saetning">Counts only. Sagu does not record who read what.</p>` : ''}

    <p class="wfejl" id="udgivFejl" hidden></p>
    <div class="btnrow" style="margin-top:18px">
      <button class="btn ghost danger" id="udgivStop">Withdraw this link</button>
    </div>`;
}

/* ------------------------------------------------- listen i Settings ----- */

async function udgivelsesListeHtml() {
  let shares = [];
  try { shares = (await api('GET', '/api/v1/shares')).shares; } catch { /* vist som tom */ }
  if (!shares.length) {
    return `<p class="meta saetning">Nothing is published yet. Open a note and use the
      globe in its toolbar — the page and everything under it becomes a wiki
      your colleagues can read without an account.</p>`;
  }
  return `<div class="tablewrap"><table class="data">
    <thead><tr><th>Page</th><th>Address</th><th>Access</th><th class="num">Reads</th><th></th></tr></thead>
    <tbody>${shares.map((s) => `<tr>
      <td><button class="linkknap" data-udgivnote="${esc(s.noteId)}">${esc(s.noteTitle || 'Untitled')}</button>
        ${s.mode === 'single' ? '<span class="meta"> · single page</span>' : ''}</td>
      <td><a href="${esc(s.path)}/" target="_blank" rel="noopener">${esc(s.path)}</a></td>
      <td>${s.hasPassword ? 'Password' : 'Open'}${s.expiresAt
    ? ` · until ${esc(new Date(s.expiresAt * 1000).toISOString().slice(0, 10))}` : ''}</td>
      <td class="num">${s.views}</td>
      <td style="text-align:right"><button class="btn ghost danger"
        data-udgivstop="${esc(s.id)}">Withdraw</button></td>
    </tr>`).join('')}</tbody></table></div>`;
}

function bindUdgivelsesListe() {
  document.querySelectorAll('[data-udgivnote]').forEach((el) => {
    el.addEventListener('click', () => aabnNote(el.dataset.udgivnote));
  });
  document.querySelectorAll('[data-udgivstop]').forEach((el) => {
    el.addEventListener('click', async () => {
      if (!confirm('Withdraw this link? Anyone who has it will get "Not found" on their next click.')) return;
      try {
        await api('DELETE', `/api/v1/shares/${el.dataset.udgivstop}`);
        toast('Withdrawn.');
        const host = document.getElementById('udgivListe');
        if (host) { host.innerHTML = await udgivelsesListeHtml(); bindUdgivelsesListe(); }
      } catch (ex) { toast(ex.message); }
    });
  });
}
