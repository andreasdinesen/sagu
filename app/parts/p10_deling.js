'use strict';
/*
 * Sagu - deling mellem konti (F11).
 *
 * ── Hvor beslutningen tages ───────────────────────────────────────────────
 *
 * Ruden hoerer paa noteskaermen, ved siden af udgivelsen, fordi de to er den
 * samme slags valg med to forskellige raekkevidder: »kollegaerne paa nettet«
 * og »Bo, med sin egen konto«. Listen over det, ANDRE har delt med mig, staar
 * for sig - den er ikke mit arkiv, og den skal ikke blandes ind i det.
 *
 * ── Det, ruden skal sige HOEJT ────────────────────────────────────────────
 *
 * At dele er at give noget fra sig, saa der maa ikke vaere tvivl om hvad. Tre
 * ting staar derfor skrevet i selve ruden og ikke kun i koden:
 *
 *   - at undersiderne foelger med,
 *   - at `write` betyder »skriv i den«, ikke »bestem over den«,
 *   - og at »giv videre« flytter ejerskabet, ikke bare adgangen.
 *
 * En rude, der bare siger »Share«, faar folk til at gaette - og et gaet om
 * hvem der kan se hvad er den slags fejl, man opdager for sent.
 */

/**
 * Maa jeg rette i den her note?
 *
 * ÉT sted, brugt af de tre steder en redigering kan BEGYNDE: titelfeltet,
 * det at aabne en blok, og tjekbokse. Spredt ud ville den ene blive glemt -
 * og en flade, der lader dig skrive og foerst afviser ved gemningen, ligner
 * en fejl i appen, ikke en spaerring (RUNE-ERFARINGER, tovo v8).
 *
 * Serveren afviser uanset hvad; det her er, for at man ikke skal proeve.
 */
function maaRette(n) {
  return !n || n.mine !== false || n.level === 'write';
}

/** Knappen i notens vaerktoejsraekke. Kun paa MINE noter - kun ejeren deler. */
function delKnapHtml(n) {
  if (!n || n.mine === false) return '';
  const paa = !!n.sharedWith;
  return `<button class="iconbtn${paa ? ' paa' : ''}" id="delBtn"
    aria-pressed="${paa ? 'true' : 'false'}"
    title="${paa ? 'Shared with other accounts' : 'Share with another account'}">${icon('shared', 16)}</button>`;
}

/**
 * Baandet over en note, der ikke er min.
 *
 * En redigeringsflade, der ser ud som ens egen og saa afviser gemningen, er
 * vaerre end en, der siger det paa forhaand (RUNE-ERFARINGER, tovo v8: en
 * spaerring, man foerst moeder NAAR man har skrevet, ligner en fejl i appen).
 */
function delingsBaandHtml(n) {
  if (!n || n.mine !== false) return '';
  const skriv = n.level === 'write';
  return `<div class="delt-baand${skriv ? ' kan-skrive' : ''}">
    ${icon('shared', 16)}
    <div>
      <strong>${esc(n.owner || 'Someone')} shared this page with you.</strong>
      <div class="meta saetning">${skriv
    ? 'You can edit it and add subpages. Deleting, publishing and sharing it on stay with '
      + `${esc(n.owner || 'the owner')}.`
    : 'You can read it. Nothing you type here would be saved.'}</div>
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ ruden */

async function visDelPanel() {
  const n = editor.note;
  if (!n || n.mine === false) return;
  const gammel = document.getElementById('delPanel');
  if (gammel) { gammel.remove(); return; }

  const host = document.createElement('div');
  host.className = 'modal';
  host.id = 'delPanel';
  host.innerHTML = `<div class="modal-kort">
      <div class="modal-top">
        <h2>Share “${esc(n.title || 'Untitled')}”</h2>
        <button class="iconbtn" id="delLuk" aria-label="Close">${icon('luk', 16)}</button>
      </div>
      <div class="modal-krop" id="delKrop"><p class="meta saetning">Loading…</p></div>
    </div>`;
  document.body.appendChild(host);

  const luk = () => { host.remove(); document.removeEventListener('keydown', paaTast); };
  const paaTast = (e) => { if (e.key === 'Escape') { e.preventDefault(); luk(); } };
  document.addEventListener('keydown', paaTast);
  host.querySelector('#delLuk').addEventListener('click', luk);
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });

  const krop = host.querySelector('#delKrop');
  let adgang = null;
  let folk = [];
  try {
    adgang = (await api('GET', `/api/v1/notes/${n.id}/access`));
    folk = (await api('GET', '/api/v1/people')).people;
  } catch (ex) {
    krop.innerHTML = `<p class="meta saetning">${esc(ex.message)}</p>`;
    return;
  }

  function tegn() {
    krop.innerHTML = delKropHtml(adgang, folk);
    bind();
    // Knappen skal foelge med med det samme - ellers ser man ikke, at noget
    // skete, foer siden tegnes forfra.
    n.sharedWith = adgang.people.length;
    const knap = document.getElementById('delBtn');
    if (knap) {
      knap.classList.toggle('paa', !!adgang.people.length);
      knap.setAttribute('aria-pressed', adgang.people.length ? 'true' : 'false');
    }
  }

  function fejl(besked) {
    const el = krop.querySelector('#delFejl');
    if (el) { el.textContent = besked; el.hidden = false; }
  }

  function bind() {
    const q = (id) => krop.querySelector(`#${id}`);

    const giv = q('delGiv');
    if (giv) {
      giv.addEventListener('click', async () => {
        const navn = q('delHvem').value;
        if (!navn) { fejl('Pick who it is for.'); return; }
        giv.disabled = true;
        try {
          await api('POST', `/api/v1/notes/${n.id}/access`, {
            username: navn,
            level: q('delNiveau').value,
            tree: q('delTrae').checked,
          });
          adgang = await api('GET', `/api/v1/notes/${n.id}/access`);
          toast(`Shared with ${navn}.`);
          tegn();
        } catch (ex) { fejl(ex.message); giv.disabled = false; }
      });
    }

    krop.querySelectorAll('[data-fjern]').forEach((el) => {
      el.addEventListener('click', async () => {
        try {
          await api('DELETE', `/api/v1/notes/${n.id}/access/${el.dataset.fjern}`);
          adgang = await api('GET', `/api/v1/notes/${n.id}/access`);
          toast('Access removed. It stops working right away.');
          tegn();
        } catch (ex) { fejl(ex.message); }
      });
    });

    const over = q('delOverdrag');
    if (over) {
      over.addEventListener('click', async () => {
        const navn = q('delNyEjer').value;
        if (!navn) { fejl('Pick who should have it.'); return; }
        /*
         * Ejerskifte er den ene handling her, der ikke kan fortrydes fra MIN
         * side bagefter - den nye ejer kan tage min adgang. Derfor et
         * spoergsmaal, og et der siger hvad der sker.
         */
        if (!confirm(`Hand “${n.title || 'Untitled'}” and everything under it to ${navn}?\n\n`
          + 'They become the owner. You keep write access until they remove it.')) return;
        over.disabled = true;
        try {
          const d = await api('POST', `/api/v1/notes/${n.id}/owner`, { username: navn });
          toast(`${d.newOwner.username} owns it now — ${d.antal} page${d.antal === 1 ? '' : 's'}.`);
          luk();
          await hentTrae();
          tegnTrae();
          await aabnNote(n.id);
        } catch (ex) { fejl(ex.message); over.disabled = false; }
      });
    }
  }

  tegn();
}

function delKropHtml(adgang, folk) {
  const brugt = new Set(adgang.people.map((p) => p.username));
  const ledige = folk.filter((p) => !brugt.has(p.username));
  return `
    <p class="delFejl gate-error" id="delFejl" hidden></p>

    ${adgang.people.length ? `<div class="tablewrap"><table class="data">
      <thead><tr><th>Account</th><th>Can</th><th></th></tr></thead>
      <tbody>${adgang.people.map((p) => `<tr>
        <td>${esc(p.username)}</td>
        <td>${p.level === 'write' ? 'Read and write' : 'Read'}${p.tree ? '' : ' — this page only'}</td>
        <td style="text-align:right"><button class="btn ghost danger"
          data-fjern="${esc(p.userId)}">Remove</button></td>
      </tr>`).join('')}</tbody></table></div>`
    : '<p class="meta saetning">Nobody else can see this page yet.</p>'}

    ${ledige.length ? `
      <div class="btnrow" style="margin-top:14px">
        <select class="input" id="delHvem" style="max-width:180px">
          ${ledige.map((p) => `<option value="${esc(p.username)}">${esc(p.username)}</option>`).join('')}
        </select>
        <select class="input" id="delNiveau" style="max-width:160px">
          <option value="read">Can read</option>
          <option value="write">Can write</option>
        </select>
        <button class="btn" id="delGiv">Share</button>
      </div>
      <label class="switch"><input type="checkbox" id="delTrae" checked>
        <span>Include the subpages — pages added later come along too</span></label>
      <p class="meta saetning"><strong>Can write</strong> means they can edit the text and add
      subpages. Deleting, publishing on the web, sharing it on and handing it over stay
      with you — those are not things someone should be able to do to your archive by
      accident.</p>`
    : `<p class="meta saetning">${folk.length
      ? 'Everyone with an account already has access.'
      : 'There are no other accounts yet. An administrator can open sign-up in Settings.'}</p>`}

    ${folk.length ? `
      <h3 style="margin-top:22px">Hand it over</h3>
      <p class="meta saetning">Gives this page <em>and everything under it</em> to someone
      else. It leaves your notebooks and lands in theirs; you keep write access until they
      remove it.</p>
      <div class="btnrow">
        <select class="input" id="delNyEjer" style="max-width:180px">
          ${folk.map((p) => `<option value="${esc(p.username)}">${esc(p.username)}</option>`).join('')}
        </select>
        <button class="btn ghost danger" id="delOverdrag">Hand over</button>
      </div>` : ''}`;
}

/* ------------------------------------------------------- delt med mig */

async function sideDelt() {
  let noter = [];
  try { noter = (await api('GET', '/api/v1/shared')).notes; } catch (ex) {
    return `<div class="card"><p class="lead">${esc(ex.message)}</p></div>`;
  }
  if (!noter.length) {
    return `<div class="card empty">
      <h2>Nothing yet</h2>
      <p class="meta saetning">When somebody with an account here shares a page with you,
      it shows up in this list — with the pages under it.</p>
    </div>`;
  }
  return `<div class="card">
    <div class="tablewrap"><table class="data">
      <thead><tr><th>Page</th><th>From</th><th>You can</th><th class="num">Changed</th></tr></thead>
      <tbody>${noter.map((n) => `<tr>
        <td><button class="linkbtn" data-aabn="${esc(n.id)}">${n.icon ? `${esc(n.icon)} ` : ''}${
  esc(n.title || 'Untitled')}</button></td>
        <td>${esc(n.owner || '')}</td>
        <td>${n.level === 'write' ? 'read and write' : 'read'}</td>
        <td class="num">${esc(visTid(n.updatedAt))}</td>
      </tr>`).join('')}</tbody></table></div>
    <p class="meta saetning">Only the top of each shared tree is listed — the pages under it
    open from there, the same way your own do.</p>
  </div>`;
}

function bindDelt() {
  document.querySelectorAll('[data-aabn]').forEach((el) => {
    el.addEventListener('click', () => aabnNote(el.dataset.aabn));
  });
}
