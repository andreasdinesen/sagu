/*
 * F7 - kommentarer i appen.
 *
 * To flader, og de svarer paa hver sit spoergsmaal:
 *
 *  - **Under noten:** samtalen om DENNE side. Traade i ét niveau, som i
 *    Notion.
 *  - **Skaermen »Comments«:** alt, der venter paa mig, paa tvaers af noter.
 *    Det er F7's »notifikation« - et tal i navigationen og en liste, man kan
 *    gaa til. En funktion, man ikke kan SE, findes ikke for brugeren
 *    (RUNE-ERFARINGER, tovo v8), og en moderationskoe, man skal lede efter,
 *    er en koe, der aldrig bliver tømt.
 *
 * Kommentarteksten renderes med den SAMME markdown-renderer som noterne, men
 * med krogene slaaet fra: en kommentar maa ikke kunne pege paa en
 * vedhaeftning eller en anden note med en `sagu:`-adresse. Og `noFoelg`
 * saetter `nofollow ugc` paa links - en kommentar er fremmed indhold, ogsaa
 * naar den staar i ens egen app.
 */

const kom = {
  noteId: null,
  liste: [],
  svarPaa: null,
  redigerer: null,
  henter: false,
};

/** Hentes kun, naar en note er aaben. Kommentarer er ikke en del af noten. */
async function hentKommentarer(noteId) {
  kom.henter = true;
  try {
    const r = await api('GET', `/api/v1/notes/${noteId}/comments`);
    kom.noteId = noteId;
    kom.liste = r.comments || [];
  } catch (ex) {
    kom.liste = [];
    throw ex;
  } finally {
    kom.henter = false;
  }
}

function kommentarTekst(raa) {
  return saguMarkdown.render(String(raa || ''), {
    billedUrl: () => null,
    linkUrl: () => null,
    noFoelg: true,
  }).html;
}

function komDato(sek) {
  const d = new Date(sek * 1000);
  const i_dag = new Date();
  const samme = d.toDateString() === i_dag.toDateString();
  return samme
    ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : d.toISOString().slice(0, 10);
}

function komStatusMaerke(c) {
  if (c.status === 'pending') return '<span class="kom-maerke venter">waiting</span>';
  if (c.status === 'rejected') return '<span class="kom-maerke afvist">rejected</span>';
  return '';
}

/**
 * »fra tovo« - hvor kommentaren kom ind ad.
 *
 * Uden det staar der bare "Andreas" paa baade det, Andreas selv skrev i
 * Sagu, og det en anden app skrev gennem hans noegle: samme navn, to helt
 * forskellige situationer. Navnet er noeglens eget, saa Sagu behoever ikke
 * at kende de apps, der taler med den.
 *
 * Ét sted, fordi to visninger tegner en kommentar (traaden og
 * moderationskoeen) - og to kopier ville drive fra hinanden.
 */
function komKilde(c) {
  return c.via ? `<span class="kom-maerke kilde">from ${esc(c.via)}</span>` : '';
}

function komHtml(c, svarene) {
  const svar = (svarene || []).filter((x) => x.parentId === c.id);
  const egen = !c.guest && state.user && c.author === state.user.username;
  const redigerer = kom.redigerer === c.id;
  return `<li class="kom${c.status === 'published' ? '' : ' daempet'}" data-kom="${esc(c.id)}">
    <div class="kom-top">
      <span class="kom-navn">${esc(pentBruger(c.author))}</span>
      ${c.guest ? '<span class="kom-maerke gaest">guest</span>' : ''}
      ${komKilde(c)}
      ${c.kind === 'suggestion' ? '<span class="kom-maerke forslag">suggested edit</span>' : ''}
      ${komStatusMaerke(c)}
      <time>${esc(komDato(c.createdAt))}</time>
      ${c.edited ? '<span class="meta">· edited</span>' : ''}
    </div>
    ${redigerer
    ? `<div class="kom-ret">
         <textarea class="kom-felt" data-ret="${esc(c.id)}" rows="3">${esc(c.body)}</textarea>
         <div class="kom-knapper">
           <button class="btn primary" data-gemret="${esc(c.id)}">Save</button>
           <button class="btn" data-afbrydret="1">Cancel</button>
         </div>
       </div>`
    : `<div class="note-body kom-krop">${kommentarTekst(c.body)}</div>`}
    <div class="kom-handlinger">
      ${c.parentId ? '' : `<button class="linkbtn" data-svar="${esc(c.id)}">Reply</button>`}
      ${egen && !redigerer ? `<button class="linkbtn" data-ret="${esc(c.id)}">Edit</button>` : ''}
      ${c.status === 'pending' ? `<button class="linkbtn" data-godkend="${esc(c.id)}">Approve</button>
        <button class="linkbtn" data-afvis="${esc(c.id)}">Reject</button>` : ''}
      ${c.status === 'rejected' ? `<button class="linkbtn" data-godkend="${esc(c.id)}">Publish anyway</button>` : ''}
      <button class="linkbtn fare" data-slet="${esc(c.id)}">Delete</button>
    </div>
    ${kom.svarPaa === c.id ? komSkrivHtml(c.id) : ''}
    ${svar.length ? `<ul class="kom-svar">${svar.map((x) => komHtml(x, [])).join('')}</ul>` : ''}
  </li>`;
}

function komSkrivHtml(svarPaa) {
  return `<div class="kom-skriv">
    <textarea class="kom-felt" id="komFelt" rows="${svarPaa ? 2 : 3}"
      placeholder="${svarPaa ? 'Your reply…' : 'Add a comment. Markdown works here.'}"></textarea>
    <div class="kom-knapper">
      <button class="btn primary" id="komSend">${svarPaa ? 'Reply' : 'Comment'}</button>
      ${svarPaa ? '<button class="btn" data-afbrydsvar="1">Cancel</button>' : ''}
      <span class="meta saetning">⌘↵ sends</span>
    </div>
  </div>`;
}

/** Afsnittet under noten. */
function kommentarerHtml() {
  const top = kom.liste.filter((c) => !c.parentId);
  const venter = kom.liste.filter((c) => c.status === 'pending').length;
  return `<section class="kommentarer" id="kommentarer">
    <h2>Comments${kom.liste.length ? ` <span class="group-count">${kom.liste.length}</span>` : ''}
      ${venter ? `<span class="kom-maerke venter">${venter} waiting</span>` : ''}</h2>
    ${top.length
    ? `<ul class="kom-liste">${top.map((c) => komHtml(c, kom.liste)).join('')}</ul>`
    : '<p class="meta saetning">No comments yet.</p>'}
    ${kom.svarPaa ? '' : komSkrivHtml(null)}
  </section>`;
}

/**
 * Tegner KUN kommentarafsnittet om.
 *
 * En fuld optegning af noten ville lukke en aaben blok i editoren og flytte
 * rullepositionen - altsaa straffe brugeren for at have skrevet en kommentar
 * (samme regel som afkrydsningsfelterne i F3).
 */
function tegnKommentarer() {
  const host = document.getElementById('kommentarer');
  if (!host) return;
  host.outerHTML = kommentarerHtml();
  bindKommentarer();
}

async function sendKommentar(tekst, svarPaa) {
  const body = String(tekst || '').trim();
  if (!body) return;
  const r = await api('POST', `/api/v1/notes/${kom.noteId}/comments`,
    { body, parentId: svarPaa || undefined });
  kom.liste = r.comments || [];
  kom.svarPaa = null;
  tegnKommentarer();
  genindlaesTaellere();
}

function bindKommentarer() {
  const host = document.getElementById('kommentarer');
  if (!host) return;

  const felt = host.querySelector('#komFelt');
  const send = host.querySelector('#komSend');
  if (send && felt) {
    send.addEventListener('click', () => sendKommentar(felt.value, kom.svarPaa).catch(visFejl));
    // ⌘↵ paa FELTET selv, ikke paa "den primaere knap i det aabne vindue":
    // en genvej, der leder efter den vigtigste knap, kan ikke se forskel paa
    // at gemme og at svare (RUNE-ERFARINGER, doda v31).
    felt.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        sendKommentar(felt.value, kom.svarPaa).catch(visFejl);
      }
      // Uden den her boblede hvert tastetryk op til notens egne genveje.
      e.stopPropagation();
    });
  }

  host.querySelectorAll('[data-svar]').forEach((el) => el.addEventListener('click', () => {
    kom.svarPaa = el.dataset.svar;
    kom.redigerer = null;
    tegnKommentarer();
    const f = document.getElementById('komFelt');
    if (f) f.focus();
  }));
  host.querySelectorAll('[data-afbrydsvar]').forEach((el) => el.addEventListener('click', () => {
    kom.svarPaa = null;
    tegnKommentarer();
  }));
  host.querySelectorAll('[data-ret]').forEach((el) => {
    if (el.tagName === 'TEXTAREA') return;
    el.addEventListener('click', () => { kom.redigerer = el.dataset.ret; kom.svarPaa = null; tegnKommentarer(); });
  });
  host.querySelectorAll('[data-afbrydret]').forEach((el) => el.addEventListener('click', () => {
    kom.redigerer = null;
    tegnKommentarer();
  }));
  host.querySelectorAll('[data-gemret]').forEach((el) => el.addEventListener('click', async () => {
    const id = el.dataset.gemret;
    const f = host.querySelector(`textarea[data-ret="${id}"]`);
    try {
      const r = await api('PATCH', `/api/v1/comments/${id}`, { body: f.value });
      kom.liste = r.comments || [];
      kom.redigerer = null;
      tegnKommentarer();
    } catch (ex) { visFejl(ex); }
  }));
  host.querySelectorAll('[data-godkend]').forEach((el) => el.addEventListener('click',
    () => saetKomStatus(el.dataset.godkend, 'published')));
  host.querySelectorAll('[data-afvis]').forEach((el) => el.addEventListener('click',
    () => saetKomStatus(el.dataset.afvis, 'rejected')));
  host.querySelectorAll('[data-slet]').forEach((el) => el.addEventListener('click', async () => {
    // En sletning tager svarene med - sig det, foer den sker.
    const c = kom.liste.find((x) => x.id === el.dataset.slet);
    const svar = kom.liste.filter((x) => x.parentId === el.dataset.slet).length;
    if (!window.confirm(svar
      ? `Delete this comment and its ${svar} ${svar === 1 ? 'reply' : 'replies'}?`
      : `Delete ${c && c.guest ? `the comment from ${c.author}` : 'your comment'}?`)) return;
    try {
      const r = await api('DELETE', `/api/v1/comments/${el.dataset.slet}`);
      kom.liste = r.comments || [];
      tegnKommentarer();
      genindlaesTaellere();
    } catch (ex) { visFejl(ex); }
  }));
}

async function saetKomStatus(id, status) {
  try {
    const r = await api('PATCH', `/api/v1/comments/${id}`, { status });
    kom.liste = r.comments || [];
    tegnKommentarer();
    genindlaesTaellere();
  } catch (ex) { visFejl(ex); }
}

function visFejl(ex) {
  toast(ex && ex.message ? ex.message : 'Something went wrong.');
}

/* ------------------------------------------------ skaermen »Comments« */

const komKoe = { status: 'pending', liste: [] };

async function sideKommentarer() {
  const r = await api('GET', `/api/v1/comments?status=${komKoe.status}`);
  komKoe.liste = r.comments || [];
  const FANER = [
    ['pending', 'Waiting'],
    ['published', 'Published'],
    ['rejected', 'Rejected'],
  ];
  return `<div class="card">
    <div class="fanerakke">${FANER.map(([id, navn]) => `
      <button class="btn${komKoe.status === id ? ' primary' : ''}" data-fane="${id}">${navn}${
  id === 'pending' && r.pending ? ` (${r.pending})` : ''}</button>`).join('')}</div>
    ${komKoe.liste.length ? `<ul class="kom-liste koe">${komKoe.liste.map((c) => `
      <li class="kom" data-kom="${esc(c.id)}">
        <div class="kom-top">
          <span class="kom-navn">${esc(pentBruger(c.author))}</span>
          ${c.guest ? '<span class="kom-maerke gaest">guest</span>' : ''}
      ${komKilde(c)}
          ${c.kind === 'suggestion' ? '<span class="kom-maerke forslag">suggested edit</span>' : ''}
          <time>${esc(komDato(c.createdAt))}</time>
          <button class="linkbtn" data-aabn="${esc(c.noteId)}">on “${esc(c.noteTitle)}”</button>
        </div>
        <div class="note-body kom-krop">${kommentarTekst(c.body)}</div>
        <div class="kom-handlinger">
          ${c.status !== 'published' ? `<button class="linkbtn" data-godkendkoe="${esc(c.id)}">Approve</button>` : ''}
          ${c.status !== 'rejected' ? `<button class="linkbtn" data-afviskoe="${esc(c.id)}">Reject</button>` : ''}
          <button class="linkbtn fare" data-sletkoe="${esc(c.id)}">Delete</button>
        </div>
      </li>`).join('')}</ul>`
    : `<p class="meta saetning">${komKoe.status === 'pending'
      ? 'Nothing is waiting. Comments from your published pages land here first.'
      : 'Nothing here.'}</p>`}
  </div>`;
}

function bindKommentarSide() {
  document.querySelectorAll('[data-fane]').forEach((el) => el.addEventListener('click', async () => {
    komKoe.status = el.dataset.fane;
    await tegnSide();
  }));
  // At gaa til noten er hele pointen med koeen: man skal kunne se, hvad
  // kommentaren staar TIL, foer man godkender den.
  document.querySelectorAll('[data-aabn]').forEach((el) => el.addEventListener('click',
    () => aabnNote(el.dataset.aabn)));
  const opdater = async (id, felter) => {
    try {
      await api('PATCH', `/api/v1/comments/${id}`, felter);
      await tegnSide();
      genindlaesTaellere();
    } catch (ex) { visFejl(ex); }
  };
  document.querySelectorAll('[data-godkendkoe]').forEach((el) => el.addEventListener('click',
    () => opdater(el.dataset.godkendkoe, { status: 'published' })));
  document.querySelectorAll('[data-afviskoe]').forEach((el) => el.addEventListener('click',
    () => opdater(el.dataset.afviskoe, { status: 'rejected' })));
  document.querySelectorAll('[data-sletkoe]').forEach((el) => el.addEventListener('click', async () => {
    if (!window.confirm('Delete this comment for good?')) return;
    try {
      await api('DELETE', `/api/v1/comments/${el.dataset.sletkoe}`);
      await tegnSide();
      genindlaesTaellere();
    } catch (ex) { visFejl(ex); }
  }));
}

/**
 * Opdaterer tallet i navigationen uden at tegne hele siden om.
 *
 * Uden det staar »3 waiting« i sidebaren, efter man har godkendt dem alle -
 * og et tal, der lyver, er vaerre end intet tal (RUNE-ERFARINGER, Sagu).
 */
async function genindlaesTaellere() {
  try {
    const st = await api('GET', '/api/v1/state');
    state.counts = st.counts || state.counts;
    const nav = document.querySelector('.nav-item[data-view="comments"]');
    if (!nav) return;
    const antal = state.counts.pendingComments || 0;
    const gammel = nav.querySelector('.nav-count');
    if (gammel) gammel.remove();
    if (antal) nav.insertAdjacentHTML('beforeend', `<span class="nav-count">${antal}</span>`);
  } catch { /* et tal, der ikke kunne opdateres, er ikke vaerd at raabe op om */ }
}

/* ==================================================== doda (F8) ========= */

/*
 * Opgaverne, en note har sendt til doda.
 *
 * Ruden bor sammen med kommentarerne, fordi de to svarer paa det samme
 * spoergsmaal: hvad er der SKET omkring den her side. Og ligesom dem hentes
 * de, naar noten aabnes - aldrig pr. optegning. Rundturen gennem tunnelen er
 * ~150 ms, og en note med fem opgaver ville vaere naesten et sekund, hvor der
 * ikke sker noget (RUNE-ERFARINGER, doda v27).
 */

const dodaState = { noteId: null, opgaver: [], connected: false, gammel: null };

async function hentDodaOpgaver(noteId, tving) {
  const r = await api('GET', `/api/v1/notes/${noteId}/tasks${tving ? '?refresh=1' : ''}`);
  dodaState.noteId = noteId;
  dodaState.opgaver = r.tasks || [];
  dodaState.connected = !!r.connected;
  dodaState.gammel = r.staleReason || null;
}

/** dodas statusord, som de skal LAESES. */
function dodaStatusTekst(s) {
  return {
    inbox: 'in the inbox', next: 'next action', waiting: 'waiting for', someday: 'someday',
    done: 'done', dropped: 'dropped', deleted: 'deleted in doda',
  }[s] || s;
}

function dodaOpgaverHtml() {
  if (!dodaState.connected && !dodaState.opgaver.length) return '';
  const aabne = dodaState.opgaver.filter((t) => t.status !== 'done' && t.status !== 'dropped'
    && t.status !== 'deleted');
  return `<section class="dodaopgaver" id="dodaOpgaver">
    <h2>Tasks in doda${dodaState.opgaver.length
    ? ` <span class="group-count">${aabne.length}/${dodaState.opgaver.length}</span>` : ''}</h2>
    ${dodaState.gammel
    /*
     * En liste, der ikke er frisk, skal SIGE det - og blive staaende. En bro,
     * der bliver tom, naar den anden ende er nede, ligner en bro, der har
     * mistet noget.
     */
    ? `<p class="meta saetning">Showing what doda last said — ${esc(dodaState.gammel)}</p>` : ''}
    ${dodaState.opgaver.length
    ? `<ul class="doda-liste">${dodaState.opgaver.map((t) => `
      <li class="doda-opgave${t.status === 'done' || t.status === 'dropped' ? ' udfoert' : ''}">
        ${t.status === 'deleted' || t.status === 'dropped'
    /*
     * Slettet eller droppet i doda: intet flueben.
     *
     * En afkrydsning ville love, at man kan hente den tilbage herfra, og det
     * kan man ikke - `uncomplete` giver en slettet opgave tilbage til doda,
     * ikke til papirkurven. En knap, der ikke kan holde sit loefte, er vaerre
     * end ingen knap.
     */
    ? '<span class="doda-tjek tom"></span>'
    : `<button class="doda-tjek" data-doda="${esc(t.dodaId)}"
        aria-pressed="${t.status === 'done' ? 'true' : 'false'}"
        title="${t.status === 'done' ? 'Put it back in doda' : 'Mark it done in doda'}"
        aria-label="${t.status === 'done' ? 'Put it back in doda' : 'Mark it done in doda'}"
        >${t.status === 'done' ? icon('tjek', 14) : ''}</button>`}
        ${t.url
    /*
     * Titlen er et LINK til opgaven i doda - i en ny fane.
     *
     * Uden `_blank` ville man forlade noten for at kigge paa opgaven, og saa
     * skulle man finde tilbage. De to apps er to steder, man arbejder
     * samtidig; det ene maa ikke koste det andet.
     *
     * Er der ingen forbindelse, er der ingen adresse - og saa staar titlen
     * som ren tekst i stedet for som et link, der ikke fører nogen steder hen.
     */
    /*
     * `sikkerUrl` OGSAA her, selv om serveren allerede har renset.
     *
     * `doda_url` kan kun saettes til en http(s)-oprindelse (`rensOffentligUrl`),
     * saa adressen ER sikker naar den kommer. Men en href, der skrives ud af
     * data, skal gaa gennem husets hvidliste dér, hvor den skrives - ellers
     * afhaenger sikkerheden af, at man husker den anden ende. Reglen skal
     * kunne SES paa stedet.
     */
    ? `<a class="doda-titel doda-link" href="${esc(saguMarkdown.sikkerUrl(t.url) || '')}"
        target="_blank" rel="noopener" title="Open in doda">${esc(t.title)}</a>`
    : `<span class="doda-titel">${esc(t.title)}</span>`}
        <span class="kom-maerke doda-status ${esc(t.status)}">${esc(dodaStatusTekst(t.status))}</span>
      </li>`).join('')}</ul>`
    : '<p class="meta saetning">Nothing sent yet.</p>'}
    <div class="kom-skriv">
      <input class="input" id="dodaFelt" placeholder="Send a task to doda — #context @project !tomorrow"
        autocomplete="off">
      <div class="kom-knapper">
        <button class="btn" id="dodaSend">Send to doda</button>
        ${dodaState.opgaver.length
    ? '<button class="linkbtn" id="dodaOpfrisk">Check doda now</button>' : ''}
      </div>
    </div>
  </section>`;
}

function tegnDodaOpgaver() {
  const host = document.getElementById('dodaOpgaver');
  if (!host) return;
  host.outerHTML = dodaOpgaverHtml();
  bindDodaOpgaver();
}

function bindDodaOpgaver() {
  const host = document.getElementById('dodaOpgaver');
  if (!host) return;
  const felt = host.querySelector('#dodaFelt');
  const send = host.querySelector('#dodaSend');
  if (send && felt) {
    const gaa = async () => {
      const t = felt.value.trim();
      if (!t) { toast('Write what the task should say.'); return; }
      felt.value = '';
      await sendOpgaveTilDoda(t);
    };
    send.addEventListener('click', gaa);
    felt.addEventListener('keydown', (e) => {
      // Enter sender. Feltet er ét felt med ét formaal - og tastetrykket maa
      // ikke boble op til notens egne genveje.
      if (e.key === 'Enter') { e.preventDefault(); gaa(); }
      e.stopPropagation();
    });
  }
  /*
   * Fluebenet skifter opgavens tilstand i DODA - ikke bare her.
   *
   * Knappen laases, mens kaldet er undervejs. Uden det kan man naa at trykke
   * to gange, og saa staar der »done« ét sted og »next« et andet, indtil
   * naeste opfriskning retter det - og imens tror man, at appen tog fejl.
   */
  host.querySelectorAll('[data-doda]').forEach((el) => {
    el.addEventListener('click', async () => {
      if (el.disabled) return;
      el.disabled = true;
      const faerdig = el.getAttribute('aria-pressed') === 'true';
      try {
        const r = await api('POST', `/api/v1/notes/${dodaState.noteId}/tasks/${el.dataset.doda}`,
          { done: !faerdig });
        dodaState.opgaver = r.tasks || dodaState.opgaver;
        tegnDodaOpgaver();
        toast(r.message || 'Done.');
      } catch (ex) {
        toast(ex.message);
        el.disabled = false;
      }
    });
  });

  const opfrisk = host.querySelector('#dodaOpfrisk');
  if (opfrisk) {
    opfrisk.addEventListener('click', async () => {
      opfrisk.textContent = 'Checking…';
      try {
        await hentDodaOpgaver(dodaState.noteId, true);
        tegnDodaOpgaver();
      } catch (ex) { toast(ex.message); }
    });
  }
}

/*
 * Kig efter, naar man KOMMER TILBAGE til Sagu.
 *
 * Den almindelige gang er: send en opgave, skift til doda, luk den, skift
 * tilbage. Uden det her skulle man vente paa det naeste opfrisknings-vindue
 * eller finde »Check doda now« - og indtil da staar opgaven som aaben, hvilket
 * ligner en bro, der ikke virker.
 *
 * Der er en bund paa 10 sekunder: springer man frem og tilbage mellem to
 * faner, skal det ikke blive til et kald hver gang.
 */
let sidsteDodaKig = 0;
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') return;
  if (!state.user || state.view !== 'note' || !editor.note) return;
  if (!dodaState.connected || dodaState.noteId !== editor.note.id) return;
  if (Date.now() - sidsteDodaKig < 10000) return;
  sidsteDodaKig = Date.now();
  try {
    await hentDodaOpgaver(editor.note.id, true);
    tegnDodaOpgaver();
  } catch { /* doda kan vaere nede - raekkerne staar der stadig */ }
});

/* ==================== markér en linje -> en opgave i doda (F16) ========= */

/*
 * Markeringen er allerede en beslutning.
 *
 * Man streger den linje under, der er noget, der skal GØRES — og så er
 * afstanden til en opgave ét tryk. Alternativet er at markere, kopiere, rulle
 * ned til feltet og sætte ind, og den vej tager man ikke, når man har travlt.
 *
 * ── Det, der gør det svært på en telefon ──────────────────────────────────
 *
 * iOS viser sin egen menu (Kopiér, Slå op…) oven på markeringen, og en tap et
 * hvilket som helst sted RYDDER markeringen. Derfor to ting:
 *
 *  - knappen lægger sig OVER markeringen, ikke under, hvor systemets egen
 *    menu står,
 *  - og den lytter på `mousedown`/`touchstart` med `preventDefault`, så
 *    markeringen stadig er der, når vi skal læse den. Bruger man `click`,
 *    er teksten væk, inden handleren kører.
 */

let dodaMarkKnap = null;

function skjulDodaMark() {
  if (dodaMarkKnap) { dodaMarkKnap.remove(); dodaMarkKnap = null; }
}

/** Markeringen som ÉN linje. En opgave er en linje, ikke et afsnit. */
function markeringSomOpgave() {
  /*
   * **Det åbne redigeringsfelt tæller MED.**
   *
   * Første udgave sprang over, når et afsnit stod som rå markdown, med
   * begrundelsen »dér markerer man for at rette«. Det var forkert: at klikke
   * ind i teksten og trække hen over en linje er den mest almindelige måde at
   * markere noget i en note — og så var knappen umulig at få frem i praksis
   * (Andreas, 2026-08-21, anden gang på samme funktion).
   *
   * Og `window.getSelection()` kan ikke se en markering inde i et
   * `<textarea>`: den har sin egen `selectionStart`/`selectionEnd`. Uden det
   * her ville teksten være tom, selv om man kunne se den markeret.
   */
  const felt = document.getElementById('blokFelt');
  if (felt && felt.selectionStart !== felt.selectionEnd) {
    const raa = felt.value.slice(felt.selectionStart, felt.selectionEnd);
    const tekst = raa.replace(/\s+/g, ' ').trim();
    if (tekst.length < 2) return null;
    const r = felt.getBoundingClientRect();
    /*
     * Placeringen er et SKØN, ikke en måling: linjenummeret gange
     * linjehøjden. Et ombrudt afsnit rykker den lidt, men knappen skal bare
     * være i nærheden af det, man markerede - og alternativet (rigtige
     * markørkoordinater i et textarea) kræver en skyggekopi af hele feltet.
     */
    const linje = felt.value.slice(0, felt.selectionStart).split('\n').length - 1;
    const lh = parseFloat(getComputedStyle(felt).lineHeight) || 22;
    return {
      tekst: tekst.slice(0, 500),
      afkortet: tekst.length > 500,
      iFelt: true,
      rect: { left: r.left, width: r.width, top: r.top + (linje * lh) - felt.scrollTop },
    };
  }

  const s = window.getSelection();
  if (!s || s.isCollapsed || !s.rangeCount) return null;
  const tekst = String(s.toString() || '').replace(/\s+/g, ' ').trim();
  if (tekst.length < 2) return null;

  // Markeringen skal ligge inde i NOTEN. En markering i en kommentar eller i
  // sidebaren er ikke det, knappen handler om.
  const krop = document.getElementById('noteBody');
  if (!krop) return null;
  const r = s.getRangeAt(0);
  if (!krop.contains(r.commonAncestorContainer)) return null;

  return { tekst: tekst.slice(0, 500), afkortet: tekst.length > 500, rect: r.getBoundingClientRect() };
}

function visDodaMark() {
  // Der stod en vagt her mod det åbne redigeringsfelt. Den er væk med vilje -
  // se markeringSomOpgave(): det er netop dér, man markerer.
  if (!dodaState.connected) { skjulDodaMark(); return; }

  const m = markeringSomOpgave();
  if (!m) { skjulDodaMark(); return; }

  if (!dodaMarkKnap) {
    dodaMarkKnap = document.createElement('button');
    dodaMarkKnap.className = 'mark-knap';
    dodaMarkKnap.type = 'button';
    dodaMarkKnap.innerHTML = `${icon('tjek', 15)}<span>Send to doda</span>`;
    // `mousedown`/`touchstart` og ikke `click`: et klik ville rydde
    // markeringen, FØR vi når at læse den.
    const gaa = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const nu = markeringSomOpgave();
      skjulDodaMark();
      if (!nu) return;
      if (nu.afkortet) toast('That was long — the first 500 characters became the task.');
      await sendOpgaveTilDoda(nu.tekst);
      // Ryd markeringen, saa knappen ikke straks melder sig igen. I et
      // tekstfelt betyder det at laegge markoeren ved markeringens slutning -
      // `removeAllRanges` roerer ikke et textarea.
      const felt2 = document.getElementById('blokFelt');
      if (nu.iFelt && felt2) {
        felt2.setSelectionRange(felt2.selectionEnd, felt2.selectionEnd);
      } else {
        const s = window.getSelection();
        if (s) s.removeAllRanges();
      }
    };
    dodaMarkKnap.addEventListener('mousedown', gaa);
    dodaMarkKnap.addEventListener('touchstart', gaa, { passive: false });
    document.body.appendChild(dodaMarkKnap);
  }

  // Over markeringen, og aldrig ud over kanten.
  const b = dodaMarkKnap.getBoundingClientRect();
  const bredde = b.width || 150;
  const x = Math.min(Math.max(8, m.rect.left + (m.rect.width - bredde) / 2), window.innerWidth - bredde - 8);
  const y = Math.max(8, m.rect.top - 44);
  dodaMarkKnap.style.left = `${Math.round(x)}px`;
  dodaMarkKnap.style.top = `${Math.round(y)}px`;
}

/*
 * `selectionchange` er den ENESTE hændelse, der fyrer for alle måderne at
 * markere på: mus, tastatur, langt tryk på en telefon og systemets egne
 * håndtag. `mouseup` alene ville virke på en computer og ingen andre steder.
 *
 * Den fyrer til gengæld under hele trækket, så den skal forsinkes — ellers
 * hopper knappen rundt, mens man stadig markerer.
 */
let dodaMarkTimer = null;
document.addEventListener('selectionchange', () => {
  clearTimeout(dodaMarkTimer);
  dodaMarkTimer = setTimeout(() => {
    if (state.view !== 'note') { skjulDodaMark(); return; }
    visDodaMark();
  }, 220);
});
// Ruller siden, står knappen det forkerte sted. Så er det bedre, den går væk.
window.addEventListener('scroll', skjulDodaMark, { passive: true });
