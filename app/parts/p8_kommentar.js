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

function komHtml(c, svarene) {
  const svar = (svarene || []).filter((x) => x.parentId === c.id);
  const egen = !c.guest && state.user && c.author === state.user.username;
  const redigerer = kom.redigerer === c.id;
  return `<li class="kom${c.status === 'published' ? '' : ' daempet'}" data-kom="${esc(c.id)}">
    <div class="kom-top">
      <span class="kom-navn">${esc(c.author)}</span>
      ${c.guest ? '<span class="kom-maerke gaest">guest</span>' : ''}
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
          <span class="kom-navn">${esc(c.author)}</span>
          ${c.guest ? '<span class="kom-maerke gaest">guest</span>' : ''}
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
