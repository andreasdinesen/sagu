'use strict';
/* Sagu - traeet i sidebaren og den hybride editor.
 *
 * Editorens model, som er hele F1:
 *
 *   Markdown ER noten. Visningen er renderet; klikker man i et afsnit, bliver
 *   PRAECIS det afsnit til et raat markdown-felt, og resten af noten bliver
 *   staaende renderet. Der er ingen konvertering nogen steder - feltet
 *   indeholder de linjer, der staar i databasen, og de skrives tilbage paa
 *   samme plads.
 *
 * Det er derfor `saguMarkdown.blokke()` giver linjenumre: uden dem ville man
 * skulle gaette, hvor et afsnit begynder, og et gem ville roere hele noten. */

const editor = {
  // Den note, der er INDLAEST. Ikke den, der er markeret i traeet - det er to
  // forskellige tilstande, og at blande dem er den klassiske fejl: markerer
  // man en raekke og giver editoren det lette listeobjekt, ser den samme id
  // og tegner aldrig den fulde note (Verdandes spec).
  note: null,
  indlaeser: null,        // id'et, der er paa vej ind
  aabenBlok: null,        // linjenummeret paa den blok, der redigeres raat
  gemTimer: null,
  gemmer: false,
  // F15: rettelsen ligger i koen og venter paa net.
  parkeret: false,
  // Hvor markoeren skal staa, naar naeste blok aabnes ('start' | null).
  markoerTil: null,
  beskidt: false,
  sidstGemt: 0,
  konflikt: null,
  /*
   * Foldningen LAESES her, ikke bare skrives.
   *
   * `laesFoldede()` fandtes, men blev aldrig kaldt: hver eneste foldning blev
   * skrevet trofast i localStorage og aldrig hentet frem igen. Det saa
   * rigtigt ud, saa laenge man blev paa siden, og var vaek ved naeste
   * genindlaesning - en indstilling, appen lod som om den huskede.
   *
   * Fundet, fordi de nyfoldede notesboeger stod aabne igen efter en
   * genindlaesning (Andreas, 2026-08-21).
   */
  foldede: laesFoldede(),
};

/* ------------------------------------------------------------- foldning */

/*
 * Foldede grene bliver i localStorage med vilje: hvor meget af traeet man vil
 * se ad gangen afhaenger af skaermens stoerrelse, saa det hoerer til ENHEDEN
 * og ikke til brugeren. Sorterings- og visningsvalg hoerer derimod til
 * kontoen (RUNE-ERFARINGER, tovo v11) - saa spoerg for hvert af dem.
 */
function laesFoldede() {
  try {
    const raa = localStorage.getItem('sagu_foldede');
    return new Set(raa ? JSON.parse(raa) : []);
  } catch { return new Set(); }
}

/*
 * Noeglen til hele notesbogs-sektionens foldning.
 *
 * Den ligger i det SAMME saet som de enkelte boeger (`editor.foldede`), saa
 * der kun er én mekanik og ét sted, valget gemmes - to maader at folde paa i
 * samme app er to steder at rette, naeste gang en af dem skal aendres
 * (RUNE-ERFARINGER, tovo v11).
 *
 * Sektionen husker desuden bøgernes egen foldning: den, der har foldet et
 * undertrae ud inde i en bog, skal have det, som han forlod det.
 */
const SEKTION_BOEGER = 'sektion:notebooks';

/** Samme mekanik for de loese noter - ét saet, ét sted det gemmes. */
const SEKTION_LOESE = 'sektion:loose';

/**
 * Er ALLE notesboeger foldet sammen?
 *
 * Knappen skal sige, hvad den GOER - ikke hvad tilstanden er. To modsatte
 * konventioner side om side er det, der goer en omskifter uforstaaelig
 * (RUNE-ERFARINGER, tovo v9).
 */
function altFoldet(boeger) {
  return boeger.length > 0 && boeger.every((b) => editor.foldede.has(b.id));
}

/**
 * Folder alle notesboeger sammen - eller ud igen.
 *
 * To forskellige oensker, to forskellige knapper: sektionens overskrift
 * gemmer HELE listen vaek, mens denne beholder bognavnene og lukker deres
 * sider. Kun BOEGERNE roeres; den, der har foldet et undertrae ud inde i en
 * bog, skal have det, som han forlod det.
 */
function saetAlleFoldede(fold) {
  for (const b of state.notebooks || []) {
    if (fold) editor.foldede.add(b.id);
    else editor.foldede.delete(b.id);
  }
  gemFoldede();
  tegnTrae();
}

function gemFoldede() {
  try { localStorage.setItem('sagu_foldede', JSON.stringify([...editor.foldede])); } catch { /* privat */ }
}

/*
 * ── En notesbog, man ikke har set foer, starter FOLDET ─────────────────────
 *
 * Med syv boeger og tredive importerede sider er sidebaren en mur, foerste
 * gang man aabner appen paa en ny skaerm. Andreas bad om det modsatte
 * udgangspunkt: alt lukket, saa man selv folder ud, hvad man skal bruge
 * (2026-08-21).
 *
 * Det naive var at folde alle boeger ved hver indlaesning. Men saettet
 * husker de FOLDEDE, saa en bog, man har aabnet med vilje, ville blive
 * lukket igen ved naeste besoeg - appen ville glemme et valg, brugeren har
 * truffet, og det er vaerre end en lang liste.
 *
 * Derfor huskes ogsaa, hvilke boeger vi har SET. Er en bog kendt, staar
 * brugerens valg; er den ny, folder vi den. Saa gaelder reglen ogsaa den
 * bog, en import lige har lagt ind.
 */
const SETE_NOEGLE = 'sagu_sete_boeger';

function laesSete() {
  try { return new Set(JSON.parse(localStorage.getItem(SETE_NOEGLE) || '[]')); } catch { return new Set(); }
}

/**
 * Folder de notesboeger sammen, vi ikke har moedt foer.
 *
 * @returns {boolean} true, hvis noget blev foldet - saa kalderen ved, om
 *                    traeet skal tegnes om.
 */
function foldNyeBoeger() {
  const sete = laesSete();
  let aendret = false;
  for (const b of state.notebooks || []) {
    if (sete.has(b.id)) continue;
    sete.add(b.id);
    editor.foldede.add(b.id);
    aendret = true;
  }
  if (aendret) {
    try { localStorage.setItem(SETE_NOEGLE, JSON.stringify([...sete])); } catch { /* privat */ }
    gemFoldede();
  }
  return aendret;
}

/** En bog, brugeren selv har lavet, skal staa aaben - han skal jo bruge den. */
function markerSetOgAaben(id) {
  const sete = laesSete();
  sete.add(id);
  try { localStorage.setItem(SETE_NOEGLE, JSON.stringify([...sete])); } catch { /* privat */ }
  editor.foldede.delete(id);
  gemFoldede();
}

/* --------------------------------------------------------------- traeet */

async function hentTrae() {
  try {
    const d = await api('GET', '/api/v1/tree');
    state.notebooks = d.notebooks;
    state.tree = d.notes;
    foldNyeBoeger();
  } catch (ex) {
    if (ex.status !== 401) toast(ex.message);
    state.tree = state.tree || [];
  }
}

/** Boern af én foraelder, i den raekkefoelge brugeren har sat. */
function boernAf(foraelderId, notesbogId) {
  return (state.tree || []).filter((n) => n.parentId === foraelderId
    && (foraelderId !== null || n.notebookId === notesbogId));
}

function traeHtml() {
  const boeger = state.notebooks || [];
  const loese = boernAf(null, null);

  const gren = (note, dybde) => {
    const boern = boernAf(note.id, null);
    const foldet = editor.foldede.has(note.id);
    const aktiv = editor.note && editor.note.id === note.id;
    return `<div class="tree-row${aktiv ? ' on' : ''}" data-raekke="${esc(note.id)}"
        style="padding-left:${8 + dybde * 14}px">
        ${boern.length
    ? `<button class="tree-fold${foldet ? '' : ' open'}" data-fold="${esc(note.id)}"
           aria-label="${foldet ? 'Expand' : 'Collapse'}">${icon('caret', 12)}</button>`
    : '<span class="tree-fold empty"></span>'}
        <button class="tree-name" data-note="${esc(note.id)}" title="${esc(note.title || 'Untitled')}">
          ${note.icon ? `<span class="tree-icon">${esc(note.icon)}</span>` : ''}
          <span>${esc(note.title || 'Untitled')}</span></button>
        <button class="tree-add" data-sub="${esc(note.id)}" aria-label="New subpage"
          title="New subpage">${icon('plus', 13)}</button>
      </div>
      ${foldet ? '' : boern.map((b) => gren(b, dybde + 1)).join('')}`;
  };

  const bogHtml = (b) => {
    const foldet = editor.foldede.has(b.id);
    const boern = boernAf(null, b.id);
    return `<div class="tree-book${foldet ? '' : ' open'}">
        <div class="tree-row book" data-bograekke="${esc(b.id)}">
          <button class="tree-fold${foldet ? '' : ' open'}" data-fold="${esc(b.id)}"
            aria-label="${foldet ? 'Expand' : 'Collapse'}">${icon('caret', 12)}</button>
          <button class="tree-ikonknap" data-bogikon="${esc(b.id)}"
            aria-label="Pick an icon">${esc(b.icon || '📓')}</button>
          <button class="tree-name" data-book="${esc(b.id)}" title="${esc(b.name)}">
            <span>${esc(b.name)}</span></button>
          <button class="tree-del${b.published ? ' paa' : ''}" data-udgivbog="${esc(b.id)}"
            data-navn="${esc(b.name)}"
            aria-label="${b.published ? 'Published on the web' : 'Publish this notebook'}"
            title="${b.published ? 'Published on the web — open the settings' : 'Publish this notebook'}"
            >${icon('globe', 13)}</button>
          <button class="tree-add" data-in="${esc(b.id)}" aria-label="New note here"
            title="New note here">${icon('plus', 13)}</button>
          <button class="tree-add" data-bogmenu="${esc(b.id)}" data-navn="${esc(b.name)}"
            aria-label="More" title="Rename or delete">${icon('dots', 13)}</button>
        </div>
        ${foldet ? '' : boern.map((x) => gren(x, 1)).join('')}
      </div>`;
  };

  /*
   * Sektionens egen overskrift med en fold.
   *
   * Med tredive importerede notesboeger er sidebaren en mur, og der er ingen
   * vej til at lukke den samlet. Overskriften folder HELE sektionen - det er
   * ét klik i stedet for tredive, og det er den vane, resten af familien har
   * (Andreas, 2026-08-21).
   */
  const sektionFoldet = editor.foldede.has(SEKTION_BOEGER);
  return `<div class="tree">
      <div class="tree-sektion">
        <button class="tree-sektion-navn" data-fold="${SEKTION_BOEGER}"
          aria-expanded="${sektionFoldet ? 'false' : 'true'}"
          title="${sektionFoldet ? 'Show the notebooks' : 'Fold the notebooks away'}">
          <span class="tree-fold${sektionFoldet ? '' : ' open'}">${icon('caret', 12)}</span>
          <span>Notebooks</span>
          ${boeger.length ? `<span class="tree-sektion-tal">${boeger.length}</span>` : ''}
        </button>
        ${boeger.length > 1 && !sektionFoldet ? `<button class="tree-sektion-add" id="foldAlle"
          aria-label="${altFoldet(boeger) ? 'Open every notebook' : 'Fold every notebook'}"
          title="${altFoldet(boeger) ? 'Open every notebook' : 'Fold every notebook'}">${
  icon(altFoldet(boeger) ? 'udfold' : 'fold', 13)}</button>` : ''}
        <button class="tree-sektion-add" id="nyBogHer" aria-label="New notebook"
          title="New notebook">${icon('plus', 13)}</button>
      </div>
      ${sektionFoldet ? '' : boeger.map(bogHtml).join('')}
      ${sektionFoldet || !loese.length ? '' : (() => {
    /*
     * »Not in a notebook« kan foldes som alt andet i traeet.
     *
     * Den var den ENESTE raekke uden en fold, og med tredive loese noter er
     * den en mur under boegerne. Valget gemmes samme sted som alle de andre
     * foldninger - to maader at folde paa i samme app er to steder at rette
     * (RUNE-ERFARINGER, tovo v11).
     */
    const foldet = editor.foldede.has(SEKTION_LOESE);
    return `<div class="tree-book${foldet ? '' : ' open'}">
        <div class="tree-row book">
          <button class="tree-fold${foldet ? '' : ' open'}" data-fold="${SEKTION_LOESE}"
            aria-label="${foldet ? 'Expand' : 'Collapse'}">${icon('caret', 12)}</button>
          <button class="tree-name meta" data-fold="${SEKTION_LOESE}"
            title="Not in a notebook"><span>Not in a notebook</span></button>
          ${foldet ? `<span class="tree-antal">${loese.length}</span>` : ''}
        </div>
        ${foldet ? '' : loese.map((x) => gren(x, 1)).join('')}</div>`;
  })()}
      <div class="tree-actions">
        <button class="btn ghost" id="nyNoteTop">${icon('plus', 14)} New note</button>
        <button class="btn ghost" id="dagensNote">${icon('kalender', 14)} Today's note</button>
        <button class="btn ghost" id="fraSkabelon">${icon('skabelon', 14)} From template</button>
        <button class="btn ghost" id="nyBogTop">${icon('book', 14)} New notebook</button>
      </div>
    </div>`;
}

/*
 * Notesbogens menu: omdoeb og slet.
 *
 * Serveren har kunnet begge dele siden F1 (`PATCH` og `DELETE` paa
 * `/api/v1/notebooks/:id`) - der var bare ingen vej derhen i fladen. Andreas
 * spurgte, hvordan man sletter en notesbog, og det korte svar var »det kan du
 * ikke« (2026-08-21). **En rute uden en knap er ikke en funktion.**
 */
function visBogMenu(anker, id, navn) {
  const gammel = document.getElementById('bogMenu');
  if (gammel) { gammel.remove(); return; }
  const raekke = anker.closest('.tree-row');
  if (!raekke) return;

  const host = document.createElement('div');
  host.className = 'usermenu notemenu';
  host.id = 'bogMenu';
  host.innerHTML = `
    <button class="usermenu-item" data-do="navn">${icon('notes', 16)}<span>Rename…</span></button>
    <button class="usermenu-item" data-do="bog-udgiv">${icon('globe', 16)}<span>Publish this notebook</span></button>
    <button class="usermenu-item danger" data-do="slet">${icon('trash', 16)}<span>Move to trash</span></button>`;
  raekke.appendChild(host);

  const luk = () => host.remove();
  host.querySelectorAll('[data-do]').forEach((el) => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const hvad = el.dataset.do;
      luk();
      try {
        if (hvad === 'navn') {
          const nyt = prompt('Name of the notebook', navn);
          if (nyt === null || !nyt.trim()) return;
          await api('PATCH', `/api/v1/notebooks/${id}`, { name: nyt.trim() });
        } else if (hvad === 'bog-udgiv') {
          visUdgivPanel({ slags: 'bog', id, titel: navn });
          return;
        } else if (hvad === 'slet') {
          /*
           * Sig HVOR MANGE noter der foelger med.
           *
           * En notesbog er ikke tom, og »slet notesbogen?« lyder som om det
           * kun er selve bogen. Noterne gaar i papirkurven SAMMEN med den og
           * kan gendannes sammen med den - men det skal staa der, foer man
           * trykker, ikke bagefter.
           */
          const antal = (state.tree || []).filter((n) => n.notebookId === id).length;
          const spoergsmaal = antal
            ? `Move “${navn}” and its ${antal} note${antal === 1 ? '' : 's'} to the trash?\n\n`
              + 'They can be restored together from the trash.'
            : `Move “${navn}” to the trash?`;
          if (!confirm(spoergsmaal)) return;
          const d = await api('DELETE', `/api/v1/notebooks/${id}`);
          toast(d.notes
            ? `Notebook and ${d.notes} note${d.notes === 1 ? '' : 's'} moved to the trash.`
            : 'Notebook moved to the trash.');
          // Stod man i en note fra bogen, er den vaek nu.
          if (editor.note && editor.note.notebookId === id) gaaTil('notes');
        }
        await hentTrae();
        await hentState();
        tegnTrae();
        opdaterNav();
      } catch (ex) { toast(ex.message); }
    });
  });

  setTimeout(() => {
    document.addEventListener('click', function udenfor(e) {
      if (host.isConnected && !host.contains(e.target) && e.target !== anker) {
        luk();
        document.removeEventListener('click', udenfor);
      }
    });
  }, 0);
}

function bindTrae() {
  const host = document.getElementById('treeHost');
  if (!host) return;
  bindTraeTraek(host);

  host.querySelectorAll('[data-udgivbog]').forEach((el) => {
    el.addEventListener('click', (e) => {
      // Raekken aabner bogen ved klik; knappen goer noget andet.
      e.stopPropagation();
      visUdgivPanel({ slags: 'bog', id: el.dataset.udgivbog, titel: el.dataset.navn });
    });
  });

  const foldKnap = document.getElementById('foldAlle');
  if (foldKnap) {
    foldKnap.addEventListener('click', (e) => {
      // Knappen ligger inde i sektionsoverskriften, som selv folder ved klik.
      e.stopPropagation();
      saetAlleFoldede(!altFoldet(state.notebooks || []));
    });
  }

  host.querySelectorAll('[data-fold]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.dataset.fold;
      if (editor.foldede.has(id)) editor.foldede.delete(id);
      else editor.foldede.add(id);
      gemFoldede();
      tegnTrae();
    });
  });

  host.querySelectorAll('[data-note]').forEach((el) => {
    el.addEventListener('click', () => aabnNote(el.dataset.note));
  });

  host.querySelectorAll('[data-sub]').forEach((el) => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      await opretOgAaben({ parentId: el.dataset.sub });
    });
  });

  host.querySelectorAll('[data-in]').forEach((el) => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      await opretOgAaben({ notebookId: el.dataset.in });
    });
  });

  host.querySelectorAll('[data-book]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.dataset.book;
      if (editor.foldede.has(id)) editor.foldede.delete(id);
      else editor.foldede.add(id);
      gemFoldede();
      tegnTrae();
    });
  });

  host.querySelectorAll('[data-bogmenu]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      visBogMenu(el, el.dataset.bogmenu, el.dataset.navn);
    });
  });

  host.querySelectorAll('[data-bogikon]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const b = (state.notebooks || []).find((x) => x.id === el.dataset.bogikon);
      visIkonVaelger(el, b && b.icon, async (valgt) => {
        try {
          await api('PATCH', `/api/v1/notebooks/${el.dataset.bogikon}`, { icon: valgt });
          await hentTrae();
          tegnTrae();
        } catch (ex) { toast(ex.message); }
      });
    });
  });

  const nyN = document.getElementById('nyNoteTop');
  if (nyN) nyN.addEventListener('click', () => opretOgAaben({}));
  const dagens = document.getElementById('dagensNote');
  if (dagens) dagens.addEventListener('click', aabnDagensNote);

  const skab = document.getElementById('fraSkabelon');
  if (skab) {
    skab.addEventListener('click', () => {
      const gammel = document.getElementById('skabelonMenu');
      if (gammel) { gammel.remove(); return; }
      const m = document.createElement('div');
      m.className = 'usermenu skabelonmenu';
      m.id = 'skabelonMenu';
      m.innerHTML = SKABELONER.map((x) =>
        `<button class="usermenu-item" data-skab="${esc(x.id)}">${esc(x.navn)}</button>`).join('');
      skab.parentElement.appendChild(m);
      m.querySelectorAll('[data-skab]').forEach((el) => {
        el.addEventListener('click', async () => { m.remove(); await opretFraSkabelon(el.dataset.skab); });
      });
      setTimeout(() => {
        document.addEventListener('click', function udenfor(e) {
          if (m.isConnected && !m.contains(e.target) && !skab.contains(e.target)) {
            m.remove();
            document.removeEventListener('click', udenfor);
          }
        });
      }, 0);
    });
  }

  // To knapper, ÉN handler: plusset i sektionsoverskriften og linjen nederst
  // goer det samme, og skal derfor ikke kunne komme til at goere hver sit.
  [document.getElementById('nyBogTop'), document.getElementById('nyBogHer')].forEach((nyB) => {
    if (!nyB) return;
    nyB.addEventListener('click', async () => {
      const navn = prompt('Name of the notebook');
      if (!navn) return;
      try {
        const d = await api('POST', '/api/v1/notebooks', { name: navn });
        await hentTrae();
        // En bog, man lige har bedt om, skal staa aaben - ellers ser det ud,
        // som om der ikke skete noget.
        if (d && d.notebook) markerSetOgAaben(d.notebook.id);
        tegnTrae();
      } catch (ex) { toast(ex.message); }
    });
  });
}

/* ============================================ traek i traeet (Andreas' oenske)

   »Man skal kunne flytte rundt paa raekkefoelgen af noter med musen.«

   POINTER-events, ikke HTML5 drag & drop: DnD virker ikke paa touch, og
   `pointerdown/move/up` + `setPointerCapture` er de samme paa mus, pen og
   finger (RUNE-ERFARINGER §4, tovo v3).

   Traekket er alligevel kun for MUS og PEN. Paa en telefon ejer fingeren
   rulningen af sidebaren, og et traek, der stjaeler den, goer listen ubrugelig
   - derfor har note-menuen »Move up«/»Move down«, som virker med mus,
   tastatur og tommelfinger (doda F3's regel om at knapper er den ENE loesning,
   der virker alle tre steder). To veje til det samme, ikke to halve.

   Det, der falder, er en SOESKENDE til den raekke, man slipper paa - foer
   eller efter, afgjort af midten. Saa er der ét at forstaa: linjen viser,
   hvor den lander. Slipper man paa en NOTESBOG, flytter noten ind i den. */

const traek = { id: null, fra: null, aktiv: false, x: 0, y: 0, linje: null };

/**
 * Synker den AABNE note med traeet efter en flytning.
 *
 * Traeet hentes friskt, men `editor.note` er et objekt fra et tidligere kald -
 * og broedkrummerne, menuen og »Move to top level« laeser den. Uden det her
 * staar de og siger, hvad der var sandt foer flytningen: menuen tilboed
 * »Make it a subpage of X« igen paa en note, der lige var blevet én.
 */
function synkAabenNote() {
  if (!editor.note) return;
  const frisk = (state.tree || []).find((n) => n.id === editor.note.id);
  if (!frisk) return;
  editor.note.parentId = frisk.parentId;
  editor.note.notebookId = frisk.notebookId;
  tegnSide();
}

/** Noten som `state.tree` kender den. */
function traeNote(id) {
  return (state.tree || []).find((n) => n.id === id) || null;
}

/** Er `maal` en efterkommer af `id`? Man maa ikke slippe en note inde i sig selv. */
function erEfterkommer(id, maal) {
  let p = traeNote(maal);
  for (let i = 0; i < 64 && p; i++) {
    if (p.id === id) return true;
    p = p.parentId ? traeNote(p.parentId) : null;
  }
  return false;
}

function ryddLinje() {
  if (traek.linje) { traek.linje.remove(); traek.linje = null; }
  document.querySelectorAll('.tree-row.drop-i').forEach((el) => el.classList.remove('drop-i'));
}

function visLinje(raekke, efter) {
  ryddLinje();
  const r = raekke.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'tree-indsaet';
  el.style.top = `${(efter ? r.bottom : r.top) - 1}px`;
  el.style.left = `${r.left}px`;
  el.style.width = `${r.width}px`;
  document.body.appendChild(el);
  traek.linje = el;
}

/**
 * Skriver den nye raekkefoelge.
 *
 * Foerst en flytning, hvis noten skifter foraelder eller notesbog - ellers
 * ville `reorder` skrive et loebenummer i en gruppe, noten slet ikke er i.
 * Derefter ét `reorder`-kald med HELE soeskendegruppen, saa numrene er
 * 0,1,2,… og ikke et gaet.
 */
async function slipTraek(noteId, maalId, efter) {
  const note = traeNote(noteId);
  const maal = traeNote(maalId);
  if (!note || !maal || note.id === maal.id) return;

  const nyFar = maal.parentId || null;
  const nyBog = maal.notebookId || null;
  try {
    if ((note.parentId || null) !== nyFar || (note.notebookId || null) !== nyBog) {
      await api('POST', `/api/v1/notes/${note.id}/move`,
        nyFar ? { parentId: nyFar } : { parentId: null, notebookId: nyBog });
    }
    const gruppe = (state.tree || [])
      .filter((n) => (n.parentId || null) === nyFar
        && (nyFar !== null || (n.notebookId || null) === nyBog)
        && n.id !== note.id);
    let i = gruppe.findIndex((n) => n.id === maal.id);
    if (i < 0) i = gruppe.length - 1;
    gruppe.splice(efter ? i + 1 : i, 0, note);
    await api('POST', '/api/v1/reorder', { kind: 'note', ids: gruppe.map((n) => n.id) });
    await hentTrae();
    tegnTrae();
    synkAabenNote();
  } catch (ex) { toast(ex.message); }
}

/** Slip paa en notesbog: ind i den, oeverst i traeet. */
async function slipIBog(noteId, bogId) {
  const note = traeNote(noteId);
  if (!note || ((note.notebookId || null) === bogId && !note.parentId)) return;
  try {
    await api('POST', `/api/v1/notes/${note.id}/move`, { parentId: null, notebookId: bogId });
    await hentTrae();
    tegnTrae();
    synkAabenNote();
    toast('Moved.');
  } catch (ex) { toast(ex.message); }
}

function bindTraeTraek(host) {
  host.addEventListener('pointerdown', (e) => {
    // Mus og pen. Fingeren ejer rulningen - se kommentaren oeverst.
    if (e.pointerType === 'touch' || e.button !== 0) return;
    // Knapper i raekken (fold, plus, globus) goer deres eget.
    if (e.target.closest('button') && !e.target.closest('.tree-name')) return;
    const raekke = e.target.closest('.tree-row[data-raekke]');
    if (!raekke) return;
    traek.id = raekke.dataset.raekke;
    traek.fra = raekke;
    traek.aktiv = false;
    traek.x = e.clientX;
    traek.y = e.clientY;
  });

  host.addEventListener('pointermove', (e) => {
    if (!traek.id) return;
    if (!traek.aktiv) {
      // 5 px, saa et almindeligt klik ikke bliver til et traek.
      if (Math.abs(e.clientX - traek.x) + Math.abs(e.clientY - traek.y) < 5) return;
      traek.aktiv = true;
      traek.fra.classList.add('traekkes');
      document.body.classList.add('traekker');
      try { e.target.setPointerCapture(e.pointerId); } catch { /* ligegyldigt */ }
    }
    // elementFromPoint frem for e.target: med pointer capture er target laast
    // til det element, traekket begyndte paa.
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const bog = under && under.closest('.tree-row.book[data-bograekke]');
    if (bog) {
      ryddLinje();
      bog.classList.add('drop-i');
      return;
    }
    const maal = under && under.closest('.tree-row[data-raekke]');
    if (!maal || maal.dataset.raekke === traek.id
      || erEfterkommer(traek.id, maal.dataset.raekke)) { ryddLinje(); return; }
    const r = maal.getBoundingClientRect();
    visLinje(maal, e.clientY > r.top + r.height / 2);
  });

  const slut = async (e) => {
    if (!traek.id) return;
    const varAktiv = traek.aktiv;
    const noteId = traek.id;
    if (traek.fra) traek.fra.classList.remove('traekkes');
    document.body.classList.remove('traekker');
    traek.id = null;
    traek.fra = null;
    traek.aktiv = false;
    if (!varAktiv) { ryddLinje(); return; }

    const under = document.elementFromPoint(e.clientX, e.clientY);
    const bog = under && under.closest('.tree-row.book[data-bograekke]');
    const maal = under && under.closest('.tree-row[data-raekke]');
    ryddLinje();
    if (bog) { await slipIBog(noteId, bog.dataset.bograekke); return; }
    if (!maal || maal.dataset.raekke === noteId || erEfterkommer(noteId, maal.dataset.raekke)) return;
    const r = maal.getBoundingClientRect();
    await slipTraek(noteId, maal.dataset.raekke, e.clientY > r.top + r.height / 2);
  };

  host.addEventListener('pointerup', slut);
  host.addEventListener('pointercancel', () => {
    if (traek.fra) traek.fra.classList.remove('traekkes');
    document.body.classList.remove('traekker');
    traek.id = null; traek.fra = null; traek.aktiv = false;
    ryddLinje();
  });
}

/**
 * Flytter en note ét trin op eller ned blandt sine soeskende.
 *
 * Den vej, der virker med mus, tastatur OG tommelfinger - traekket er kun for
 * mus og pen (doda F3).
 */
async function flytNoteISort(note, retning) {
  const gruppe = (state.tree || []).filter((n) => (n.parentId || null) === (note.parentId || null)
    && (note.parentId || (n.notebookId || null) === (note.notebookId || null)));
  const i = gruppe.findIndex((n) => n.id === note.id);
  const j = i + retning;
  if (i < 0 || j < 0 || j >= gruppe.length) return;
  const ny = gruppe.slice();
  ny.splice(j, 0, ny.splice(i, 1)[0]);
  try {
    await api('POST', '/api/v1/reorder', { kind: 'note', ids: ny.map((n) => n.id) });
    await hentTrae();
    tegnTrae();
    synkAabenNote();
  } catch (ex) { toast(ex.message); }
}

/** Den soeskende, der staar LIGE FOER noten - den, en indrykning lander under. */
function soeskendeFoer(note) {
  const gruppe = (state.tree || []).filter((n) => (n.parentId || null) === (note.parentId || null)
    && (note.parentId || (n.notebookId || null) === (note.notebookId || null)));
  const i = gruppe.findIndex((n) => n.id === note.id);
  return i > 0 ? gruppe[i - 1] : null;
}

/** Kun traeet gentegnes - ikke skallen, ikke editoren. */
function tegnTrae() {
  const host = document.getElementById('treeHost');
  if (!host) return;
  host.innerHTML = traeHtml();
  bindTrae();
}

async function opretOgAaben(felter) {
  try {
    // Svaret INDEHOLDER elementet. At kalde "hent alt igen" bagefter er en
    // ekstra rundtur for noget, man har i haanden (RUNE-ERFARINGER, doda v27).
    const d = await api('POST', '/api/v1/notes', Object.assign({ title: 'Untitled', body: '' }, felter));
    if (felter.parentId) { editor.foldede.delete(felter.parentId); gemFoldede(); }
    // Er der lavet et NYT maerke undervejs, skal listen med - ellers mangler
    // det i »Tags«-skaermen og i autoudfyldningen, til man genindlaeser.
    if (felter.tags && felter.tags.length) {
      try { state.tags = (await api('GET', '/api/v1/state')).tags || state.tags; } catch { /* ligegyldigt */ }
    }
    await hentTrae();
    tegnTrae();
    await aabnNote(d.note.id);
    const t = document.getElementById('noteTitle');
    if (t) { t.focus(); t.select(); }
  } catch (ex) { toast(ex.message); }
}

/* -------------------------------------------------------------- editoren */

/**
 * Aabner en note.
 *
 * `indlaeser` findes, fordi markeringen og indlaesningen er to forskellige
 * tilstande: klikker man hurtigt paa to noter, maa det foerste svar ikke
 * overskrive det andet.
 */
async function aabnNote(id, tving) {
  /*
   * Luk sidemenuen. HER, og ikke i hvert kaldssted - og FOER den tidlige
   * returnering nedenfor.
   *
   * `gaaTil()` gjorde det allerede for skaermene, men en note aabnes ad
   * mindst seks veje - traeet, favoritterne, sporet, et soegeresultat, et
   * baglaens link og et `[[link]]` i teksten. Paa en telefon ligger menuen
   * hen over noten, saa man valgte en note og saa ... menuen (Andreas,
   * 2026-08-21).
   *
   * Klassen fjernes ubetinget: paa en bred skaerm betyder den ingenting.
   *
   * Og den fjernes FOER vagten mod »samme note igen«. Trykker man paa den
   * note, man allerede staar paa, er oensket stadig at SE den - saa en tidlig
   * returnering, der springer lukningen over, efterlader menuen hen over
   * netop det, man bad om.
   */
  document.body.classList.remove('navopen');
  /*
   * `tving` springer vagten over - og den findes, fordi vagten ellers goer en
   * OPFRISKNING til ingenting.
   *
   * Vagten er rigtig for et klik: trykker man paa den note, man allerede
   * staar paa, skal siden ikke blinke. Men »hent den her note forfra« er
   * netop en anmodning om at gaa udenom, og uden `tving` hentede
   * traek-ned-for-at-opfriske (F19) alt ANDET end den note, man stod og
   * kiggede paa. Den fejl overlevede v14, fordi proeven havde en
   * genindlaesning imellem - saa den nye titel kom derfra og ikke fra
   * trakket (fundet 2026-08-22 ved at sammenligne med doda).
   */
  if (!tving && editor.note && editor.note.id === id && !editor.indlaeser) return;
  await gemNu();
  editor.indlaeser = id;
  state.view = 'note';
  state.openNote = id;
  editor.aabenBlok = null;
  editor.konflikt = null;
  tegnSide();
  try {
    const d = await api('GET', `/api/v1/notes/${id}`);
    if (editor.indlaeser !== id) return;      // en anden note vandt kapløbet
    editor.indlaeser = null;
    editor.note = d.note;
    editor.beskidt = false;
    editor.parkeret = false;
    editor.sidstGemt = Date.now();
    kom.svarPaa = null;
    kom.redigerer = null;
    // Kommentarerne hentes SAMMEN med noten, saa afsnittet staar der ved
    // foerste optegning i stedet for at hoppe ind bagefter. En fejl her maa
    // ikke tage noten med sig - den er det, brugeren kom efter.
    try { await hentKommentarer(id); } catch { kom.liste = []; kom.noteId = id; }
    // Opgaverne hentes SAMMEN med noten - ét kald, ikke ét pr. optegning.
    // En fejl her maa ikke tage noten med sig.
    try { await hentDodaOpgaver(id); } catch { dodaState.opgaver = []; dodaState.noteId = id; }
    if (editor.note && editor.note.id !== id) return;
    opdaterNav();
    tegnTrae();
    tegnSide();
    /*
     * Sporet opfriskes EFTER optegningen, ikke foer (F13).
     *
     * Serveren har allerede noteret besoeget - det skete i selve
     * note-opslaget, hvor alle veje ind moedes. Det her er kun sidebarens
     * liste, og den maa ikke koste en ventetid paa den note, man kom efter.
     */
    hentGenveje().then(tegnGenveje);
  } catch (ex) {
    editor.indlaeser = null;
    toast(ex.message);
    gaaTil('notes');
  }
}

function notesbogNavn(id) {
  const b = (state.notebooks || []).find((x) => x.id === id);
  return b ? b.name : null;
}

/** Broedkrummer: hvor i traeet er jeg? */
function broedkrummer(note) {
  const kort = new Map((state.tree || []).map((n) => [n.id, n]));
  const sti = [];
  let cur = kort.get(note.parentId);
  for (let i = 0; i < 32 && cur; i++) { sti.unshift(cur); cur = kort.get(cur.parentId); }
  const bog = notesbogNavn(note.notebookId);
  const dele = [];
  if (bog) dele.push(`<span>${esc(bog)}</span>`);
  for (const s of sti) dele.push(`<button data-krumme="${esc(s.id)}">${esc(s.title || 'Untitled')}</button>`);
  return dele.length ? `<nav class="krummer meta saetning">${dele.join('<span class="sep">/</span>')}</nav>` : '';
}

/*
 * Notens maerker - SYNLIGE paa noten.
 *
 * De laa i datamodellen fra F0 og blev sat af Notion-importen, men der fandtes
 * ingen vej til at saette et selv, og »Tags«-skaermen sagde »arrives in F3«.
 * En hjaelpetekst, der beskriver noget, appen ikke kan, er den dyreste slags
 * fejl: brugeren tror, han bruger appen forkert (RUNE-ERFARINGER, doda v38).
 *
 * Raekken staar dér, hvor handlingen sker - ikke i en menu og ikke kun i en
 * toast. En handling, der aendrer noget, skal efterlade et spor paa stedet
 * (tovo v8).
 */
function maerkerHtml(n) {
  const maerker = n.tags || [];
  // Paa en note, jeg kun maa laese, staar maerkerne som TEKST: intet kryds og
  // ingen tilfoej-knap. Fjerde sted, en redigering kunne begynde (F11).
  const kanRette = maaRette(n);
  return `<div class="note-maerker" id="noteMaerker">
      ${maerker.map((t) => `<span class="chip maerke">${esc(t)}${kanRette ? `<button class="chip-x"
        data-fjernmaerke="${esc(t)}" aria-label="Remove ${esc(t)}" title="Remove">×</button>` : ''}</span>`).join('')}
      ${kanRette ? `<button class="chip tilfoej" id="tilfoejMaerke">${maerker.length ? '+ tag' : '+ Add a tag'}</button>
      <span class="maerke-felt-hylster">
        <input class="chip-felt" id="maerkeFelt" placeholder="tag, or tag,tag,tag"
          autocomplete="off" autocapitalize="none" spellcheck="false" hidden>
        <span class="maerke-forslag" id="maerkeForslag" hidden></span>
      </span>` : ''}
    </div>`;
}

async function saetNoteMaerker(navne) {
  const n = editor.note;
  try {
    const d = await api('PATCH', `/api/v1/notes/${n.id}`, { tags: navne });
    n.tags = d.note.tags;
    n.updatedAt = d.note.updatedAt;
    // Listen over ALLE maerker skal med, ellers mangler det nye i
    // autoudfyldningen og i »Tags«-skaermen, til man genindlaeser.
    try { state.tags = (await api('GET', '/api/v1/state')).tags || state.tags; } catch { /* ligegyldigt */ }
    tegnMaerker();
  } catch (ex) { toast(ex.message); }
}

/** Kun maerke-raekken tegnes om - ikke hele noten, som ville lukke en aaben blok. */
function tegnMaerker() {
  const host = document.getElementById('noteMaerker');
  if (!host || !editor.note) return;
  host.outerHTML = maerkerHtml(editor.note);
  bindMaerker();
}

/*
 * Maerkefeltet med FORSLAG.
 *
 * Her stod `<datalist>` foer, altsaa browserens egen liste. Den virker paa en
 * computer og **slet ikke paa iOS** - Safari viser ingenting - saa forslagene
 * fandtes kun for halvdelen af brugerne, og den halvdel, der sad med
 * telefonen, kunne ikke se, at de var der (Andreas, 2026-08-21).
 *
 * Listen tegnes derfor selv, praecis som omni-feltets. Til gengaeld skal den
 * saa ogsaa selv kunne det, browseren gjorde: piletaster, Enter og et klik.
 */
const maerkeValg = { traef: [], valgt: 0 };

function bindMaerker() {
  const felt = document.getElementById('maerkeFelt');
  const knap = document.getElementById('tilfoejMaerke');
  const forslag = document.getElementById('maerkeForslag');
  if (!felt || !knap) return;

  knap.addEventListener('click', () => {
    knap.hidden = true;
    felt.hidden = false;
    felt.value = '';
    felt.focus();
    tegnForslag();
  });

  const luk = () => { felt.hidden = true; knap.hidden = false; skjulForslag(); };
  const skjulForslag = () => {
    maerkeValg.traef = [];
    if (forslag) { forslag.hidden = true; forslag.innerHTML = ''; }
  };

  /** Det, der staar EFTER sidste komma - det er dét, man er i gang med. */
  const sidsteDel = () => (felt.value.split(',').pop() || '').trim().replace(/^#/, '');

  function tegnForslag() {
    if (!forslag) return;
    const soeg = sidsteDel().toLowerCase();
    const alt = editor.note.tags || [];
    // Allerede paa noten, eller allerede skrevet i feltet: ikke et forslag.
    const brugt = new Set(alt.concat(saguMaerker.fraFelt(felt.value)).map((t) => t.toLowerCase()));
    const traef = (state.tags || [])
      .map((t) => t.name)
      .filter((n) => !brugt.has(n.toLowerCase()))
      // Det, der BEGYNDER med det skrevne, staar oeverst - som i omni-feltet.
      .filter((n) => !soeg || n.toLowerCase().includes(soeg))
      .sort((a, b) => {
        const ai = a.toLowerCase().startsWith(soeg) ? 0 : 1;
        const bi = b.toLowerCase().startsWith(soeg) ? 0 : 1;
        return ai - bi || a.localeCompare(b, 'da');
      })
      .slice(0, 8);

    maerkeValg.traef = traef;
    maerkeValg.valgt = 0;
    if (!traef.length) { forslag.hidden = true; forslag.innerHTML = ''; return; }
    forslag.hidden = false;
    forslag.innerHTML = traef.map((n, i) => `<button class="maerke-forslag-punkt${
      i === 0 ? ' valgt' : ''}" data-forslag="${esc(n)}">${esc(n)}</button>`).join('');
    forslag.querySelectorAll('[data-forslag]').forEach((el) => {
      // `mousedown`, ikke `click`: feltets blur naar ellers at lukke listen,
      // foer klikket bliver til noget (samme faelde som doda v30).
      el.addEventListener('mousedown', (e) => { e.preventDefault(); vaelg(el.dataset.forslag); });
    });
  }

  function markerValgt() {
    if (!forslag) return;
    forslag.querySelectorAll('[data-forslag]').forEach((el, i) => {
      el.classList.toggle('valgt', i === maerkeValg.valgt);
    });
  }

  /** Saetter et forslag ind i stedet for det halvskrevne ord. */
  function vaelg(navn) {
    const dele = felt.value.split(',');
    dele[dele.length - 1] = navn;
    // Et komma bagefter, saa man kan skrive det naeste med det samme.
    felt.value = `${dele.join(',')},`;
    felt.focus();
    tegnForslag();
  }

  function gem() {
    const nye = saguMaerker.fraFelt(felt.value);
    if (!nye.length) { luk(); return; }
    const nuvaerende = editor.note.tags || [];
    const tilfoej = nye.filter((n) => !nuvaerende.some((t) => t.toLowerCase() === n.toLowerCase()));
    if (!tilfoej.length) { luk(); return; }
    saetNoteMaerker(nuvaerende.concat(tilfoej));
  }

  felt.addEventListener('input', tegnForslag);
  felt.addEventListener('keydown', (e) => {
    // Feltet ejer sine taster: uden stopPropagation gemmer notens egen
    // ⌘+Enter-genvej samtidig, og »f« ville slaa fokus-tilstand til
    // (RUNE-ERFARINGER, doda v29/v31/v34).
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); luk(); return; }
    if (maerkeValg.traef.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const n = maerkeValg.traef.length;
      maerkeValg.valgt = (maerkeValg.valgt + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      markerValgt();
      return;
    }
    if (e.key === 'Tab' && maerkeValg.traef.length) {
      e.preventDefault();
      vaelg(maerkeValg.traef[maerkeValg.valgt]);
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    /*
     * Enter paa et fremhaevet forslag SAETTER det ind; Enter paa noget, man
     * selv har skrevet til ende, gemmer. Forskellen er, om det skrevne ord
     * allerede ER forslaget - ellers ville man ikke kunne lave et nyt maerke,
     * der ligner et gammelt.
     */
    const halvt = sidsteDel();
    const oeverst = maerkeValg.traef[maerkeValg.valgt];
    if (halvt && oeverst && oeverst.toLowerCase() !== halvt.toLowerCase()) {
      vaelg(oeverst);
      return;
    }
    gem();
  });
  felt.addEventListener('blur', () => setTimeout(() => { gem(); }, 120));

  document.querySelectorAll('[data-fjernmaerke]').forEach((el) => {
    el.addEventListener('click', () => {
      const vaek = el.dataset.fjernmaerke.toLowerCase();
      saetNoteMaerker((editor.note.tags || []).filter((t) => t.toLowerCase() !== vaek));
    });
  });
}

function gemMaerke() {
  /*
   * »Saved« paa en side, man ikke KAN gemme, er en usandhed.
   *
   * Maerket svarer paa »naaede mit arbejde frem?« - og paa en note, jeg kun
   * maa laese, er der intet arbejde. Baandet ovenover siger allerede hvorfor
   * (F11).
   */
  if (!maaRette(editor.note)) return '<span class="gem">Read only</span>';
  if (editor.konflikt) return '<span class="gem konflikt">Not saved — conflict</span>';
  // Parkeret er hverken »gemt« eller »ikke gemt«: det ligger sikkert paa
  // telefonen og venter paa net. Maerket skal sige praecis dét (F15).
  if (editor.parkeret && !editor.beskidt) return '<span class="gem">Waiting for network</span>';
  if (editor.gemmer) return '<span class="gem">Saving…</span>';
  if (editor.beskidt) return '<span class="gem">Unsaved</span>';
  return '<span class="gem ok">Saved</span>';
}

function sideNote() {
  const n = editor.note;
  if (editor.indlaeser || !n) {
    return '<div class="card empty"><p class="meta saetning">Opening…</p></div>';
  }

  return `
    ${broedkrummer(n)}
    <div class="note-head">
      <button class="note-ikon" id="noteIkon" title="Pick an icon"
        aria-label="Pick an icon">${n.icon ? esc(n.icon) : icon('notes', 20)}</button>
      <input class="note-title" id="noteTitle" value="${esc(n.title)}"
        placeholder="Untitled" autocomplete="off" spellcheck="false"
        ${maaRette(n) ? '' : 'readonly'}>
      <div class="note-tools">
        <span id="gemMaerke">${gemMaerke()}</span>
        <button class="iconbtn" id="kopiNote"
          title="Copy the whole note as markdown">${icon('copy', 15)}</button>
        <button class="iconbtn" id="fokusBtn" title="Focus mode (F) — just the note">${icon('focus', 16)}</button>
        ${favoritKnapHtml(n)}
        ${delKnapHtml(n)}
        ${n.mine === false ? '' : udgivKnapHtml(n.published)}
        <button class="iconbtn" id="menuBtn" title="More">${icon('dots', 16)}</button>
      </div>
    </div>
    ${delingsBaandHtml(n)}
    ${maerkerHtml(n)}
    ${editor.konflikt ? konfliktHtml() : ''}
    <div class="note-body" id="noteBody"></div>
    ${filerHtml(n)}
    ${n.backlinks && n.backlinks.length ? `
      <div class="backlinks">
        <h2>Linked from</h2>
        ${n.backlinks.map((b) => `<button class="backlink" data-krumme="${esc(b.id)}">
          ${esc(b.title || 'Untitled')}</button>`).join('')}
      </div>` : ''}
    ${dodaState.noteId === n.id ? dodaOpgaverHtml() : ''}
    ${kom.noteId === n.id ? kommentarerHtml() : ''}`;
}

/*
 * Konflikten er et VALG, ikke en tavs overskrivning.
 *
 * Noten blev gemt et andet sted, mens den stod aaben her. Begge udgaver
 * findes stadig - brugeren skal kunne se hvad han selv skrev, og bestemme.
 */
function konfliktHtml() {
  return `<div class="konflikt-baand">
      <div>
        <strong>Someone saved this note while you were editing.</strong>
        <div class="meta saetning">Nothing was overwritten. Your version is still on screen.</div>
      </div>
      <div class="btnrow">
        <button class="btn" id="konfliktHent">Load theirs</button>
        <button class="btn primary" id="konfliktGem">Keep mine</button>
      </div>
    </div>`;
}

/* ------------------------------------------------- den hybride optegning */

/**
 * Tegner notens krop.
 *
 * Én optegningsfejl maa IKKE tage hele ruden med sig: én note i en uventet
 * form kastede i Verdande inde i en reaktiv effekt, og derefter kunne INGEN
 * note aabnes - den forrige blev bare staaende. Derfor guarden og faldet
 * tilbage til raa tekst (Verdandes spec, punkt 8 i deres faeldeliste).
 */
function tegnKrop() {
  const host = document.getElementById('noteBody');
  const n = editor.note;
  if (!host || !n) return;

  if (editor.aabenBlok !== null) { tegnMedAabenBlok(host, n); return; }

  try {
    const { html } = saguMarkdown.render(n.body, renderValg());
    host.innerHTML = html || '<p class="tom-note meta saetning">Click here to start writing.</p>';
    pyntKodeblokke(host);
    bindTjek(host);
    bindBilleder(host);
    // Indlejringerne fyldes BAGEFTER: optegningen maa aldrig vente paa et
    // netvaerkskald (F12).
    fyldGhIndlejringer(host);
  } catch (ex) {
    host.innerHTML = `<div class="render-fejl"><p class="meta saetning">
      This note could not be rendered, so here it is as plain text.</p>
      <pre>${esc(n.body)}</pre></div>`;
    if (window.console) console.error('render fejlede', ex);
  }
  bindKrop();
  tegnGreb(host);
  byggToc();
}

/**
 * De valg, rendereren skal have - ét sted, saa den aabne blok og resten af
 * noten aldrig kan tegnes med forskellige regler.
 *
 * `sagu:<id>` frem for en absolut adresse: en note skal kunne flyttes med til
 * wikien eller en eksport uden at billederne doer. Vaerten oversaetter.
 */
/** `sagu:<id>` -> den interne filadresse. Alt andet er vaertens sag. */
function saguUrl(u) {
  return /^sagu:[a-f0-9]{32}$/.test(u) ? `/api/v1/files/${u.slice(5)}` : null;
}

/**
 * `sagu-note:<id>` -> den note.
 *
 * Notion-importen skriver den for HVERT internt link mellem to importerede
 * sider (241 af dem i Andreas' arkiv). Uden oversaettelsen afviste `sikkerUrl`
 * dem med rette - de er ikke http(s) - og hele krydsreferencenettet stod som
 * raa markdown med et hex-id i. Kvitteringen sagde »241 internal links
 * rewritten«, og ikke ét af dem virkede (Andreas, 2026-08-21).
 *
 * Samme greb som §F4's `linkUrl`-krog: rendereren maa ikke kende Sagus
 * adresser, vaerten oversaetter.
 */
function noteUrl(u) {
  const m = /^sagu-note:([a-f0-9]{32})$/.exec(String(u || ''));
  if (!m) return null;
  // `#note-<id>` er den adresse, appen ALLEREDE aabner paa - baade fra
  // [[henvisninger]] og fra adresselinjen. Ét maal, én handler.
  return `#note-${m[1]}`;
}

function renderValg() {
  return {
    blokAttribut: true,
    slaaOpNote: (titel) => {
      const t = (state.tree || []).find((x) => (x.title || '').toLowerCase() === titel.toLowerCase());
      return t ? { href: `#note-${t.id}` } : null;
    },
    // Kun VORES egne filer vises som billeder. Et billede udefra bliver et
    // link med en forklaring - CSP'en henter det alligevel ikke, og et
    // oedelagt ikon forklarer ingenting. F5's import henter dem ned.
    billedUrl: (u) => saguUrl(u),
    // Et LINK kan pege paa baade en fil og en anden note.
    linkUrl: (u) => saguUrl(u) || noteUrl(u),
    // Et afsnit, der ER én bar adresse, kan blive til en indlejring (F12).
    // Rendereren kender ikke GitHub - den spoerger bare, om nogen vil have
    // linjen.
    bartLink: (u, b) => ghKrog(u, b),
  };
}

function bindKrop() {
  const host = document.getElementById('noteBody');
  if (!host) return;

  // ÉN delegeret handler paa kroppen. Ikke `{once:true}`: den ville fjerne sig
  // selv efter foerste klik, saa man kunne aabne én blok pr. optegning og
  // derefter ingenting - og fejlen ville ligne "editoren gaar i staa".
  host.addEventListener('click', (e) => {
    /*
     * **Har man MARKERET noget, aabner klikket ikke redigeringen.**
     *
     * Et traek hen over teksten ender med et `click` paa afsnittet, og saa
     * gjorde den hybride editor det, den plejer: aabnede afsnittet raat. Det
     * ryddede markeringen i samme oejeblik, den var faerdig.
     *
     * To ting var i stykker af det, og den foerste er den vigtigste:
     *  - **man kunne ikke markere tekst for at KOPIERE den** - fladen hoppede
     *    i redigering, hver gang man proevede,
     *  - og F16's »Send to doda«-knap kunne aldrig naa at komme frem, fordi
     *    den netop naegter at vise sig, mens en blok er aaben.
     *
     * Et markeret stykke tekst er en handling i sig selv. Klikket, der
     * afslutter den, er ikke en anmodning om at redigere.
     */
    const valg = window.getSelection();
    if (valg && !valg.isCollapsed && String(valg).trim().length > 1
        && host.contains(valg.getRangeAt(0).commonAncestorContainer)) return;

    /*
     * Traekhaandtaget er en BETJENING, ikke tekst.
     *
     * Reglen nedenfor - »alt andet i kroppen aabner ogsaa redigeringen« - er
     * rigtig for tekst og pladsholdere, men haandtaget ligger inde i kroppen
     * uden at vaere en blok, saa et klik paa prikkerne aabnede den sidste
     * blok BAG menuen. To rigtige regler, der stoedte sammen; den her
     * undtagelse er graensen mellem dem (maalt i browseren, 2026-08-21).
     */
    if (e.target.closest('.blok-greb, .blok-menu, .blok-indsaet')) return;

    /*
     * **Klikker man i det felt, man allerede skriver i, sker der ingenting.**
     *
     * Uden den her linje faldt et klik i `<textarea>`'et igennem til reglen
     * nederst - »alt andet i kroppen aabner ogsaa redigeringen« - og saa blev
     * blokken tegnet om med markoeren sat til SLUTNINGEN. Symptomet: man
     * satte markoeren i linje 1, og den hoppede ned i linje 2 (Andreas,
     * 2026-08-21).
     *
     * Feltet har ingen `data-blok` - det er netop det, der goer det til den
     * aabne blok - saa det slap forbi begge de foregaaende vagter. Reglen
     * nederst er rigtig for TEKST; den maa bare ikke gaelde det sted, man
     * skriver.
     */
    if (e.target.closest('.blok-redigering')) return;

    // Et klik paa et link skal FOELGE linket, ikke aabne redigeringen -
    // ellers har man byttet én irritation for en vaerre (doda v37).
    const a = e.target.closest('a');
    if (a) {
      const intern = a.getAttribute('href') || '';
      if (intern.startsWith('#note-')) { e.preventDefault(); aabnNote(intern.slice(6)); }
      return;
    }
    const blok = e.target.closest('[data-blok]');
    if (blok) { aabnBlok(Number(blok.dataset.blok)); return; }
    /*
     * Alt ANDET i kroppen aabner ogsaa redigeringen.
     *
     * Her stod `if (e.target === host)`, altsaa »kun det tomme areal under
     * indholdet«. Paa en TOM note findes det areal ikke: pladsholderen
     * »Click here to start writing« er et `<p>` uden `data-blok`, og den
     * fylder kroppen helt ud. Maalt paa en telefonskaerm: kroppen er 22 px
     * hoej, pladsholderen 22 px - **nul pixels tilbage at ramme.**
     *
     * Paa en computer kunne man komme udenom (opret en note, og feltet er
     * allerede aabent; ellers `E`), saa fejlen viste sig foerst paa en
     * telefon, hvor man kommer tilbage til en tom note og trykker paa den
     * eneste tekst, der staar - den, der bogstaveligt siger »klik her«.
     *
     * Reglen er nu den, teksten lover: **et tryk i noten begynder at
     * skrive.** Links, tjekbokse, billeder og GitHub-knapper standser selv
     * deres haendelse, saa de er upaavirkede.
     */
    aabnSidste();
  });
}

/** Erstatter ÉN blok med et raat markdown-felt. Resten bliver staaende. */
function tegnMedAabenBlok(host, n) {
  const linjer = n.body.split('\n');
  const blokke = saguMarkdown.blokke(n.body);
  /*
   * En HELT TOM note har ingen blokke - og det er netop dér, man skal kunne
   * begynde at skrive.
   *
   * `aabnSidste()` laegger en tom linje ind og beder om blok 0. Men
   * `blokke('\n')` giver **ingen** blokke: en tom linje er ikke en blok, den
   * springes over af opdeleren. Saa faldt vi i `!b` nedenfor, satte
   * `aabenBlok` tilbage til null og tegnede pladsholderen igen - **paa
   * samme tick**, saa der aldrig kom et felt at skrive i.
   *
   * Fejlen var usynlig paa en computer, fordi en NY note aabner sit felt ad
   * en anden vej. Den ramte kun den, der kom tilbage til en note, han havde
   * ladet staa tom - og trykkede paa den tekst, der siger »klik her«.
   *
   * En tom foerste blok er derfor et gyldigt maal, ikke et fravaer.
   */
  const b = blokke.find((x) => x.fra === editor.aabenBlok)
    || (!blokke.length && editor.aabenBlok === 0 ? { fra: 0, til: 0 } : null);
  if (!b) { editor.aabenBlok = null; tegnKrop(); return; }

  const foer = linjer.slice(0, b.fra).join('\n');
  const efter = linjer.slice(b.til + 1).join('\n');
  const raa = linjer.slice(b.fra, b.til + 1).join('\n');

  const del = (md) => {
    if (!md.trim()) return '';
    try { return saguMarkdown.render(md, renderValg()).html; } catch { return ''; }
  };

  /*
   * Hjaelpeknappen staar ved FELTET, ikke i vaerktoejsraekken.
   *
   * »En lille knap man kan trykke på når man er ved at skrive en note«
   * (Andreas, 2026-08-21). Vaerktoejsraekken staar i toppen af noten, og paa
   * en telefon er den rullet vaek, netop naar man skriver - saa dér ville
   * knappen vaere usynlig praecis i det oejeblik, den skal bruges.
   *
   * Den er `tabindex="-1"`: Tab fra skrivefeltet skal foere videre i teksten,
   * ikke ind i en hjaelpeknap.
   */
  host.innerHTML = `${del(foer)}
    <div class="blok-redigering">
      <textarea class="blok-felt" id="blokFelt" spellcheck="false"
        rows="${Math.max(1, raa.split('\n').length)}">${esc(raa)}</textarea>
      <button class="blok-hjaelp" id="blokHjaelp" type="button" tabindex="-1"
        aria-label="How to write this" title="How to write this">?</button>
    </div>
    ${del(efter)}`;

  // De renderede dele skal ogsaa have knapper, lightbox og indlejringer.
  // **Begge optegningsveje** - den her og `tegnKrop()` - skal goere det samme;
  // glemmer den ene noget, virker funktionen kun, naar ingen blok er aaben,
  // og fejlen ligner »kortet forsvandt, da jeg klikkede« (F12).
  pyntKodeblokke(host);
  bindTjek(host);
  bindBilleder(host);
  fyldGhIndlejringer(host);
  // Den AABNE blok har ingen `data-blok` og faar derfor intet haandtag - man
  // kan ikke traekke i det, man staar midt i at skrive. Resten kan.
  tegnGreb(host);

  const hj = document.getElementById('blokHjaelp');
  // `mousedown` med preventDefault, ikke `click`: et klik ville tage fokus
  // fra feltet, og `blur` lukker blokken - saa var man ude af det, man var
  // ved at skrive, for at kigge i hjaelpen.
  if (hj) {
    hj.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); visSyntaksPanel(); });
    hj.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); visSyntaksPanel(); },
      { passive: false });
  }

  const felt = document.getElementById('blokFelt');
  if (!felt) return;
  autoHoejde(felt);
  felt.focus();
  /*
   * Markoeren i slutningen - saa man kan skrive videre med det samme.
   *
   * Undtagelsen er, naar man er kommet hertil med pil NED: saa skal den staa
   * i begyndelsen, dér hvor bevaegelsen pegede hen. Hintet bruges ÉN gang og
   * ryddes, ellers ville det ogsaa gaelde det naeste klik.
   */
  const tilStart = editor.markoerTil === 'start';
  editor.markoerTil = null;
  const pos = tilStart ? 0 : felt.value.length;
  felt.setSelectionRange(pos, pos);

  felt.addEventListener('input', () => {
    autoHoejde(felt);
    skrivBlokTilbage(felt.value, b);
    opdaterWikiForslag(felt);
  });

  felt.addEventListener('paste', (e) => { haandterIndsaet(e, felt); });
  felt.addEventListener('dragover', (e) => { e.preventDefault(); felt.classList.add('traekker'); });
  felt.addEventListener('dragleave', () => felt.classList.remove('traekker'));
  felt.addEventListener('drop', (e) => {
    e.preventDefault();
    felt.classList.remove('traekker');
    haandterIndsaet(e, felt);
  });

  felt.addEventListener('keydown', (e) => {
    // Forslagslisten faar tasterne FOERST, naar den er aaben - ellers lukker
    // Escape hele blokken i stedet for kun listen.
    if (wikiTast(e)) return;
    if (e.key === 'Escape') { e.preventDefault(); lukBlok(); return; }

    /*
     * Piletasterne skal kunne KRYDSE blokgraensen.
     *
     * Editoren aabner ét afsnit ad gangen som raa markdown; resten af noten
     * staar renderet omkring det. Naar man stod paa den sidste linje i
     * feltet, gjorde en piletast derfor ingenting - der var ikke nogen naeste
     * linje INDE i feltet, og den naeste linje i NOTEN var et andet element.
     * For den, der skriver, ser det ud som om piletasterne ikke virker
     * (Andreas, 2026-08-21).
     *
     * **Browseren faar lov at proeve foerst.** Kunne den flytte markoeren -
     * fordi afsnittet har flere linjer, eller fordi en lang linje er ombrudt
     * over flere - saa er det dét, brugeren mente, og vi roerer ingenting.
     * Er markoeren IKKE flyttet bagefter, var der ingen vej inde i feltet, og
     * saa springer vi til naboblokken.
     *
     * Den maalemetode er valgt frem for at regne paa linjer i teksten: et
     * OMBRUDT afsnit har flere visuelle linjer end `\n`-tegn, og en regel,
     * der taeller `\n`, ville springe ud af feltet midt i et afsnit.
     */
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const foer = felt.selectionStart;
      const ned = e.key === 'ArrowDown';
      const vaerdi = felt.value;
      // Kun fra den yderste LOGISKE linje - ellers er der helt sikkert en vej
      // inde i feltet, og saa er der ingen grund til at maale noget.
      const yderst = ned
        ? !vaerdi.slice(foer).includes('\n')
        : !vaerdi.slice(0, foer).includes('\n');
      if (!yderst || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return;
      setTimeout(() => {
        if (!document.getElementById('blokFelt')) return;
        if (felt.selectionStart !== foer) return;   // browseren flyttede den
        springTilNaboBlok(ned);
      }, 0);
      return;
    }
    // ⌘/Ctrl+Enter gemmer og lukker blokken. Feltet stopper tasten selv, saa
    // en container-genvej ikke ogsaa fyrer (doda v29/v31/v34).
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      lukBlok();
    }
  });

  felt.addEventListener('blur', () => {
    // Kun hvis fokus forlod selve noten - ellers lukker et klik i en anden
    // blok feltet, foer den nye blok naar at aabne.
    setTimeout(() => {
      const aktiv = document.activeElement;
      if (aktiv && aktiv.id === 'blokFelt') return;
      lukWikiForslag();
      lukBlok();
    }, 0);
  });

  // De blokke, der stadig er renderet, skal kunne klikkes.
  host.querySelectorAll('[data-blok]').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      const nr = Number(el.dataset.blok);
      if (nr !== editor.aabenBlok) aabnBlok(nr);
    });
  });
}

function autoHoejde(felt) {
  felt.style.height = 'auto';
  felt.style.height = `${felt.scrollHeight}px`;
}

function aabnBlok(fra) {
  // En delt note, jeg kun maa laese, aabner ikke en raa markdown-blok. Uden
  // vagten ville teksten se ud til at kunne rettes (F11).
  if (!maaRette(editor.note)) return;
  editor.aabenBlok = fra;
  tegnKrop();
}

function aabnSidste() {
  /*
   * Vagten skal ogsaa staa HER, ikke kun i `aabnBlok`.
   *
   * Den tomme gren nedenfor aendrer `body` og saetter `aabenBlok` selv - den
   * gaar altsaa udenom `aabnBlok()` og dens `maaRette`-tjek. Med den nye
   * regel (et tryk hvor som helst i kroppen aabner redigeringen) ville en
   * kollega med LAESE-adgang til en tom delt note faa et skrivefelt (F11).
   */
  if (!maaRette(editor.note)) return;
  const b = saguMarkdown.blokke(editor.note.body);
  if (!b.length) {
    // Tom note: laeg en tom linje ind, saa der er en blok at aabne.
    editor.note.body = '\n';
    editor.aabenBlok = 0;
    tegnKrop();
    return;
  }
  aabnBlok(b[b.length - 1].fra);
}

/**
 * Aabner blokken foer eller efter den, der staar aaben.
 *
 * Markoeren laegges dér, man kom fra: gaar man NEDAD, skal den staa i
 * begyndelsen af den naeste blok - ikke i slutningen, hvor man saa skulle
 * taste sig tilbage. Det er den eneste rigtige plads, og den er let at
 * glemme, fordi feltet ellers altid aabner med markoeren til sidst.
 */
function springTilNaboBlok(ned) {
  const n = editor.note;
  if (!n) return;
  const b = saguMarkdown.blokke(n.body);
  const i = b.findIndex((x) => x.fra === editor.aabenBlok);
  if (i === -1) return;
  const maal = b[i + (ned ? 1 : -1)];
  // Ingen nabo: bliv staaende. At lukke blokken, fordi man trykkede pil op i
  // den foerste linje, ville vaere at straffe en helt almindelig bevaegelse.
  if (!maal) return;
  editor.markoerTil = ned ? 'start' : 'slut';
  aabnBlok(maal.fra);
}

function lukBlok() {
  if (editor.aabenBlok === null) return;
  editor.aabenBlok = null;
  tegnKrop();
  planlaegGem();
  /*
   * ÉT sted til at fryse GitHub-adresser (F12).
   *
   * Her - og ikke i indsaettelses-haendelsen - fordi linjen kan vaere skrevet,
   * indsat eller kommet med en hel blok, man har klistret ind. Alle veje ind
   * ender med at blokken lukkes.
   *
   * Ingen `await`: gemningen er allerede planlagt, og en fejl hos GitHub maa
   * ikke kunne haenge editoren. Lykkes det, tegnes kroppen igen med den
   * frosne adresse.
   */
  frysGhAdresser().then((aendret) => { if (aendret) tegnKrop(); })
    .catch(() => { /* linjen bliver staaende; kortet siger hvorfor */ });
}

/** Skriver feltets linjer tilbage paa deres plads i noten. */
function skrivBlokTilbage(nyTekst, b) {
  const linjer = editor.note.body.split('\n');
  const nye = nyTekst.split('\n');
  linjer.splice(b.fra, b.til - b.fra + 1, ...nye);
  editor.note.body = linjer.join('\n');
  // Blokkens slutlinje flytter sig, mens man skriver; `fra` gør ikke.
  b.til = b.fra + nye.length - 1;
  markerBeskidt();
}

/* ------------------------------------------------------------ gemningen */

function markerBeskidt() {
  editor.beskidt = true;
  const m = document.getElementById('gemMaerke');
  if (m) m.innerHTML = gemMaerke();
  planlaegGem();
}

function planlaegGem() {
  clearTimeout(editor.gemTimer);
  editor.gemTimer = setTimeout(gemNu, 900);
}

async function gemNu() {
  clearTimeout(editor.gemTimer);
  if (!editor.note || !editor.beskidt || editor.gemmer || editor.konflikt) return;
  const n = editor.note;
  editor.gemmer = true;
  const m = document.getElementById('gemMaerke');
  if (m) m.innerHTML = gemMaerke();
  try {
    const d = await api('PATCH', `/api/v1/notes/${n.id}`, {
      title: n.title,
      body: n.body,
      // Konfliktvagten: serveren afviser, hvis noten er aendret et andet sted.
      ifUpdatedAt: n.updatedAt,
    });
    // Kun stemplet og de afledte felter opdateres. Kroppen er brugerens -
    // at skrive serverens svar tilbage ville kaste det, han skrev, mens
    // kaldet var undervejs.
    n.updatedAt = d.note.updatedAt;
    n.backlinks = d.note.backlinks;
    editor.beskidt = false;
    editor.sidstGemt = Date.now();
    // Titlen kan vaere aendret - traeet skal foelge med.
    const t = (state.tree || []).find((x) => x.id === n.id);
    if (t && t.title !== n.title) { t.title = n.title; tegnTrae(); }
  } catch (ex) {
    if (ex.status === 409) {
      editor.konflikt = true;
      tegnSide();
      return;
    }
    /*
     * Uden net: PARKÉR rettelsen frem for bare at klage (F15).
     *
     * `ex.offline` saettes af `api()`, naar selve forbindelsen fejlede - ikke
     * naar serveren afviste. Forskellen er hele pointen: et afslag skal man
     * se, et netvaerksbrud skal man ikke straffes for.
     *
     * `beskidt` ryddes, naar det er parkeret. Ellers ville den planlagte
     * gemning proeve igen hvert sekund og lave en ny fejlbesked hver gang -
     * og den tekst, man skrev, ER i sikkerhed nu.
     */
    if (ex.offline) {
      if (parkér(n)) {
        editor.beskidt = false;
        editor.parkeret = true;
      }
      return;
    }
    toast(ex.message);
  } finally {
    editor.gemmer = false;
    const m2 = document.getElementById('gemMaerke');
    if (m2) m2.innerHTML = gemMaerke();
  }
}

/* ------------------------------------------------------------ fuldskaerm */

/*
 * »Fuld skaerm« var tre forskellige oensker. Det er nu to:
 *
 *  1. **Fokus** - alt andet end noten forsvinder: sidebar, broedkrummer,
 *     vaerktoejer. Det er en tilstand ved SKAERMEN, ikke ved noten, saa den
 *     gemmes ikke. Esc gaar tilbage.
 *  2. **Browserens fuldskaerm** - ogsaa uden faner og adressefelt. Kraever en
 *     brugerhandling, saa den kan kun taendes fra en knap, og den fejler
 *     stille i en iframe. Derfor er den et TILVALG oven paa fokus og ikke
 *     det, F-tasten goer.
 *
 * ── Den tredje er fjernet ─────────────────────────────────────────────────
 *
 * **Fuld bredde** gav notens tekstspalte hele siden i stedet for
 * laesebredden paa 820 px. »Denne funktion kan fjernes, da jeg ikke kommer
 * til at bruge den« (Andreas, 2026-08-21), og en knap, ingen troer paa, er
 * stoej i en vaerktoejsraekke, hvor hver plads skal fortjenes.
 *
 * Kolonnen `full_width` BLIVER i databasen, og eksport/gendannelse baerer den
 * fortsat. To grunde: migreringer er historie og skrives ikke om, og en
 * sikkerhedskopi fra i gaar skal stadig kunne laeses i morgen. Vaerdien
 * bliver bare ikke laest af fladen laengere - `bred-note` saettes ingen
 * steder, saa en note, der ALLEREDE stod gemt som bred, ikke haenger fast i
 * en visning, der ikke har nogen knap at slaa fra.
 */
function saetFokus(til) {
  document.body.classList.toggle('fokus', til);
  const b = document.getElementById('fokusBtn');
  if (b) {
    b.setAttribute('aria-pressed', til ? 'true' : 'false');
    b.title = til ? 'Leave focus mode (Esc)' : 'Focus mode (F) — just the note';
  }
  // Sideoversigten skal med ud og ind: i fokus er der plads til den, men
  // dens plads flytter sig, saa den skal maales igen.
  byggToc();
}

function erIFokus() { return document.body.classList.contains('fokus'); }

async function slaaBrowserFuldskaerm() {
  try {
    if (document.fullscreenElement) { await document.exitFullscreen(); return; }
    await document.documentElement.requestFullscreen();
  } catch {
    // Fejler i en iframe og naar tilladelsen mangler. Sig det frem for at
    // lade knappen se doed ud.
    toast('The browser would not go fullscreen here. Focus mode still works.');
  }
}

/* -------------------------------------------------------------- binding */

function bindNoteSide() {
  const n = editor.note;
  if (!n) return;
  bindKommentarer();
  bindDodaOpgaver();

  const titel = document.getElementById('noteTitle');
  if (titel) {
    titel.addEventListener('input', () => {
      // En note maa ALDRIG staa uden en titel: den hedder sin titel i traeet,
      // i wikiens adresse og i [[henvisninger]]. Tomt felt = "Untitled",
      // men foerst naar man forlader feltet, saa man kan slette og skrive om.
      n.title = titel.value;
      markerBeskidt();
    });
    titel.addEventListener('blur', () => {
      /*
       * `#maerke` i titlen bliver til et rigtigt maerke - se plukMaerker().
       *
       * Det sker, naar man FORLADER feltet, ikke ved hvert tastetryk: ellers
       * ville `#` blive spist, mens man stadig er i gang med at skrive ordet.
       */
      const { tekst: uden, maerker: fundne } = plukMaerker(titel.value);

      if (fundne.length) {
        titel.value = uden;
        n.title = uden;
        markerBeskidt();
        const nu = n.tags || [];
        const nye = fundne.filter((f) => !nu.some((t) => t.toLowerCase() === f.toLowerCase()));
        // Gem titlen FOERST og maerkerne bagefter: det mest specifikke skriver
        // sidst, ellers overskriver den ene gemning den anden (tovo v7).
        if (nye.length) { gemNu().then(() => saetNoteMaerker(nu.concat(nye))); }
      }
      if (!titel.value.trim()) { titel.value = 'Untitled'; n.title = 'Untitled'; markerBeskidt(); }
    });
    titel.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        // Enter i titlen gaar ned i teksten - det er den vane, alle har.
        aabnSidste();
      }
    });
  }

  const fokus = document.getElementById('fokusBtn');
  if (fokus) fokus.addEventListener('click', () => saetFokus(!erIFokus()));

  const ikonKnap = document.getElementById('noteIkon');
  if (ikonKnap) {
    ikonKnap.addEventListener('click', () => visIkonVaelger(ikonKnap, n.icon, async (e) => {
      n.icon = e;
      ikonKnap.innerHTML = e ? esc(e) : icon('notes', 20);
      try {
        await api('PATCH', `/api/v1/notes/${n.id}`, { icon: e });
        const t = (state.tree || []).find((x) => x.id === n.id);
        if (t) { t.icon = e; tegnTrae(); }
      } catch (ex) { toast(ex.message); }
    }));
  }

  const menu = document.getElementById('menuBtn');
  if (menu) menu.addEventListener('click', visNoteMenu);

  const udgiv = document.getElementById('udgivBtn');
  // IKKE `addEventListener('click', visUdgivPanel)`: saa bliver klik-haendelsen
  // til funktionens foerste argument, og ruden tror, den har faaet et maal.
  // Symptomet var en overskrift uden titel - og, vaerre, at ruden aldrig kunne
  // finde notens EKSISTERENDE udgivelse, fordi opslaget skete paa `undefined`.
  if (udgiv) udgiv.addEventListener('click', () => visUdgivPanel());
  // Samme regel som ovenfor: en pil, ikke funktionen selv - ellers bliver
  // klik-haendelsen til funktionens foerste parameter.
  const delKnap = document.getElementById('delBtn');
  if (delKnap) delKnap.addEventListener('click', () => visDelPanel());
  const favKnap = document.getElementById('favBtn');
  if (favKnap) favKnap.addEventListener('click', () => skiftFavorit());

  /*
   * Hele noten som markdown i udklipsholderen.
   *
   * Markdown ER det, der ligger i databasen (DESIGN.md §2), saa der er intet
   * at konvertere - og derfor heller intet, der kan tabes undervejs. Titlen
   * kommer med som en overskrift, hvis teksten ikke selv har en: en note
   * indsat i en mail uden sit navn er svaer at forstaa.
   *
   * `navigator.clipboard` kraever et secure context, og Sagu kan naas over
   * ren http paa LAN-adressen. Knappen falder derfor tilbage til at MARKERE
   * teksten i en rude, man selv kan kopiere fra - frem for at fejle, naar man
   * trykker (RUNE-ERFARINGER, tools v1).
   */
  const kopiKnap = document.getElementById('kopiNote');
  if (kopiKnap) {
    kopiKnap.addEventListener('click', async () => {
      const note = editor.note;
      if (!note) return;
      const md = noteSomMarkdown(note);
      try {
        if (!navigator.clipboard) throw new Error('ingen udklipsholder');
        await navigator.clipboard.writeText(md);
        toast('The note is on your clipboard as markdown.');
      } catch {
        visMarkdownPanel();
        toast('The browser would not let me copy — here it is to take by hand.');
      }
    });
  }

  document.querySelectorAll('[data-krumme]').forEach((el) => {
    el.addEventListener('click', () => aabnNote(el.dataset.krumme));
  });

  if (editor.konflikt) {
    const hent = document.getElementById('konfliktHent');
    if (hent) {
      hent.addEventListener('click', async () => {
        editor.konflikt = null;
        editor.beskidt = false;
        editor.note = null;
        await aabnNote(n.id);
      });
    }
    const gem = document.getElementById('konfliktGem');
    if (gem) {
      gem.addEventListener('click', async () => {
        // "Behold min" = gem UDEN vagten. Den anden udgave staar i
        // historikken, saa intet er tabt.
        editor.konflikt = null;
        try {
          const d = await api('PATCH', `/api/v1/notes/${n.id}`, { title: n.title, body: n.body });
          n.updatedAt = d.note.updatedAt;
          editor.beskidt = false;
          toast('Saved. The other version is in the history.');
          tegnSide();
        } catch (ex) { toast(ex.message); }
      });
    }
  }

  bindMaerker();
  bindFiler();
  bindDropZone(document.querySelector('.main'));
  tegnKrop();
}

/**
 * Flyt en note til en anden notesbog.
 *
 * Ruten fandtes fra F1 (`POST /notes/:id/move`), men der var ingen vej til den
 * i UI'et - og en funktion, man ikke kan naa, findes ikke for brugeren
 * (RUNE-ERFARINGER, tovo v8). Undersiderne foelger med: et undertrae ligger i
 * ÉN notesbog, ellers kan sidebaren ikke tegne det ét sted.
 */
function visFlytRude(n) {
  const boeger = state.notebooks || [];
  const host = document.createElement('div');
  host.className = 'modal';
  host.id = 'flytRude';
  host.innerHTML = `<div class="modal-kort">
      <div class="modal-top">
        <h2>Move “${esc(n.title || 'Untitled')}”</h2>
        <button class="iconbtn" id="flytLuk" aria-label="Close">${icon('luk', 16)}</button>
      </div>
      <div class="modal-krop">
        <p class="meta saetning">Subpages come along — a page and everything under it
        lives in one notebook.</p>
        <label class="field"><span>Notebook</span>
          <select class="input" id="flytBog">
            <option value="">No notebook</option>
            ${boeger.map((b) => `<option value="${esc(b.id)}"${
  b.id === n.notebookId ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}
          </select></label>
        <div class="btnrow" style="margin-top:16px">
          <button class="btn primary" id="flytGem">Move</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(host);

  const luk = () => { host.remove(); document.removeEventListener('keydown', paaTast); };
  const paaTast = (e) => { if (e.key === 'Escape') { e.preventDefault(); luk(); } };
  document.addEventListener('keydown', paaTast);
  host.querySelector('#flytLuk').addEventListener('click', luk);
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });

  host.querySelector('#flytGem').addEventListener('click', async () => {
    const bog = host.querySelector('#flytBog').value || null;
    try {
      // parentId: null, fordi en note, der flytter notesbog, ikke laengere kan
      // haenge under en side i den gamle. Serveren ville ellers rette
      // notesbogen tilbage til foraelderens (flytNote).
      await api('POST', `/api/v1/notes/${n.id}/move`, { parentId: null, notebookId: bog });
      luk();
      await hentTrae();
      tegnTrae();
      // `aabnNote` paa den note, der ALLEREDE er aaben, gaar tilbage med det
      // samme - den henter ikke forfra. Derfor synkes felterne fra traeet.
      synkAabenNote();
      toast(bog ? 'Moved.' : 'Moved out of its notebook.');
    } catch (ex) { toast(ex.message); }
  });
}

function visNoteMenu() {
  const gammel = document.getElementById('noteMenu');
  if (gammel) { gammel.remove(); return; }
  const anker = document.getElementById('menuBtn');
  const vaert = document.querySelector('.note-tools');
  if (!anker || !vaert) return;
  const n = editor.note;
  // Den soeskende, der staar lige FOER - det er den, en indrykning lander
  // under. Findes den ikke, er der intet at rykke ind under, og punktet
  // staar der ikke: en knap, der ikke kan goere noget, er ikke en knap.
  const foer = soeskendeFoer(n);

  /*
   * Menuen viser kun det, man faktisk kan.
   *
   * `mit` = jeg ejer siden; `ret` = jeg maa skrive i den. En knap, der
   * afviser, naar man trykker paa den, er ikke en knap - det er en faelde, og
   * paa en delt side ville halvdelen af menuen vaere det (F11). Serveren
   * afviser uanset hvad; det her er, for at man ikke skal proeve.
   */
  const mit = n.mine !== false;
  const ret = maaRette(n);

  const host = document.createElement('div');
  host.className = 'usermenu notemenu';
  host.id = 'noteMenu';
  host.innerHTML = `
    ${ret ? `<button class="usermenu-item" data-do="sub">${icon('plus', 16)}<span>New subpage</span></button>
    <button class="usermenu-item" data-do="fil">${icon('klips', 16)}<span>Attach a file…</span></button>` : ''}
    <button class="usermenu-item" data-do="md">${icon('notes', 16)}<span>Show as markdown</span></button>
    <button class="usermenu-item" data-do="id">${icon('key', 16)}<span>Copy the note ID</span></button>
    <button class="usermenu-item" data-do="link">${icon('globe', 16)}<span>Copy the link to this note</span></button>
    ${mit ? `<button class="usermenu-item" data-do="dup">${icon('copy', 16)}<span>Duplicate</span></button>
    <button class="usermenu-item" data-do="dupall">${icon('copy', 16)}<span>Duplicate with subpages</span></button>
    ${foer ? `<button class="usermenu-item" data-do="ind">${icon('ind', 16)}<span>Make it a subpage of “${
  esc((foer.title || 'Untitled').slice(0, 24))}”</span></button>` : ''}
    <button class="usermenu-item" data-do="op">${icon('fold', 16)}<span>Move up</span></button>
    <button class="usermenu-item" data-do="ned">${icon('udfold', 16)}<span>Move down</span></button>
    <button class="usermenu-item" data-do="flyt">${icon('book', 16)}<span>Move to notebook…</span></button>
    ${n.parentId ? `<button class="usermenu-item" data-do="root">${icon('out', 16)}<span>Move to top level</span></button>` : ''}` : ''}
    <button class="usermenu-item" data-do="fs">${icon('focus', 16)}<span>Browser fullscreen</span></button>
    ${mit ? `<button class="usermenu-item danger" data-do="del">${icon('trash', 16)}<span>Move to trash</span></button>` : ''}`;
  vaert.appendChild(host);

  host.querySelectorAll('[data-do]').forEach((el) => {
    el.addEventListener('click', async () => {
      const hvad = el.dataset.do;
      host.remove();
      try {
        if (hvad === 'fil') { vaelgFiler(); return; }
        if (hvad === 'md') { visMarkdownPanel(); return; }
        /*
         * Note-id'et er det, API'et kalder `?to=NOTE_ID` (F9).
         *
         * Det stod KUN i adressefeltet, og en browser viser ikke altid
         * fragmentet - Chrome forkorter til vaertsnavnet, saa der bogstavelig
         * talt ikke var noget at laese af (Andreas, 2026-08-21, med et
         * skaermbillede hvor der staar »sagu.dk« og intet andet).
         *
         * En vaerdi, opskrifterne beder om, skal kunne HENTES i appen. Ellers
         * er hjaelpesiden en anvisning paa noget, man ikke kan skaffe.
         */
        /*
         * Det direkte link - Sagus egen adresse til noten.
         *
         * `offentligBase()` og ikke `location.origin`: Sagu kan naas paa flere
         * adresser (panelets IP:port, tunnelen, det rigtige domaene), og et
         * link, man sender videre, skal pege paa DEN, der er meningen - den
         * samme, udgivelserne og API-opskrifterne skrives med (DESIGN.md §15).
         * Ellers deler man en adresse, kun man selv kan naa.
         */
        if (hvad === 'link') {
          const adr = `${offentligBase()}/#note-${n.id}`;
          try {
            await navigator.clipboard.writeText(adr);
            toast('Link copied.');
          } catch {
            visIdPanel(adr, 'Link to this note');
          }
          return;
        }
        if (hvad === 'id') {
          try {
            await navigator.clipboard.writeText(n.id);
            toast('Note ID copied.');
          } catch {
            // Uden udklipsholder (http, aeldre browser): vis det, saa det kan
            // markeres i haanden. En besked om at det ikke lykkedes hjaelper
            // ingen, der bare skal bruge de 32 tegn.
            visIdPanel(n.id);
          }
          return;
        }
        if (hvad === 'sub') { await opretOgAaben({ parentId: n.id }); return; }
        if (hvad === 'fs') { saetFokus(true); await slaaBrowserFuldskaerm(); return; }
        if (hvad === 'dup' || hvad === 'dupall') {
          const d = await api('POST', `/api/v1/notes/${n.id}/duplicate`, { withChildren: hvad === 'dupall' });
          await hentTrae();
          tegnTrae();
          await aabnNote(d.note.id);
          return;
        }
        if (hvad === 'op' || hvad === 'ned') { await flytNoteISort(n, hvad === 'op' ? -1 : 1); return; }
        if (hvad === 'ind') {
          // Indrykning: noten bliver en underside af den, der stod lige foer.
          // Serveren flytter hele undertraeet med og synker notesbogen.
          await api('POST', `/api/v1/notes/${n.id}/move`, { parentId: foer.id });
          editor.foldede.delete(foer.id);
          gemFoldede();
          await hentTrae();
          tegnTrae();
          synkAabenNote();
          return;
        }
        if (hvad === 'flyt') { visFlytRude(n); return; }
        if (hvad === 'root') {
          await api('POST', `/api/v1/notes/${n.id}/move`, { parentId: null });
          await hentTrae();
          tegnTrae();
          synkAabenNote();
          return;
        }
        if (hvad === 'del') {
          const svar = await api('DELETE', `/api/v1/notes/${n.id}`);
          // Sig hvor mange der fulgte med - ellers opdager man foerst
          // bagefter, at undersiderne ogsaa er vaek.
          toast(svar.deleted > 1
            ? `Moved to trash with ${svar.deleted - 1} subpage${svar.deleted > 2 ? 's' : ''}.`
            : 'Moved to trash.', {
            label: 'Undo',
            run: async () => {
              try {
                await api('POST', `/api/v1/notes/${n.id}/restore`, {});
                await hentTrae();
                tegnTrae();
                await aabnNote(n.id);
              } catch (ex) { toast(ex.message); }
            },
          });
          editor.note = null;
          await hentTrae();
          tegnTrae();
          gaaTil('notes');
        }
      } catch (ex) { toast(ex.message); }
    });
  });

  setTimeout(() => {
    document.addEventListener('click', function udenfor(e) {
      if (host.isConnected && !host.contains(e.target) && !anker.contains(e.target)) {
        host.remove();
        document.removeEventListener('click', udenfor);
      }
    });
  }, 0);
}

/* ------------------------------------------------------------- genveje */

/*
 * Kun det, der IKKE staar i genvejsbordet.
 *
 * Selve genvejene bor i `GENVEJE` i p12 - ét sted, saa hjaelpeoversigten er
 * genereret og ikke skrevet af (F13). Tilbage her er den ene ting, bordet
 * ikke kan udtrykke: **Escape ud af fokustilstand, ogsaa mens man staar i et
 * felt.** Alle andre genveje skal netop IKKE fyre, mens man skriver - den her
 * skal, fordi fokustilstand er noget, man vil ud af, uden foerst at skulle
 * finde ud af, hvor markoeren er.
 */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !erIFokus()) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  // ... men ikke, mens en raa blok er aaben: dér lukker Escape blokken.
  if (document.getElementById('blokFelt')) return;
  saetFokus(false);
});

// Forlader man browserens fuldskaerm med Esc, skal vores egen tilstand foelge
// med - ellers staar appen i fokus uden at nogen bad om det.
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && erIFokus() && state.view !== 'note') saetFokus(false);
});

// En ventende gemning maa ikke gaa tabt, fordi fanen lukkes.
window.addEventListener('beforeunload', (e) => {
  if (editor.beskidt) { gemNu(); e.preventDefault(); e.returnValue = ''; }
});

/*
 * Note-id'et vist, når udklipsholderen ikke kan bruges.
 *
 * `navigator.clipboard` findes kun i et sikkert kontekst - Sagu nås også på
 * `IP:port` over ren http fra panelet, og dér findes den ikke. En besked om
 * at kopieringen mislykkedes hjælper ingen, der bare skal bruge de 32 tegn:
 * så er det bedre at vise dem markeret, klar til ⌘C.
 */
function visIdPanel(id, overskrift) {
  // `esc`, ikke `attr`: fladens egen `esc` escaper OGSAA anfoerselstegn og er
  // dermed attributsikker - `attr` findes kun i det delte markdown-modul og er
  // ikke global her. Det saas foerst, da reserveveien faktisk blev gaaet.
  const gammel = document.getElementById('idPanel');
  if (gammel) gammel.remove();

  const host = document.createElement('div');
  host.className = 'modal';
  host.id = 'idPanel';
  host.innerHTML = `<div class="modal-kort">
      <div class="modal-top">
        <h2>${esc(overskrift || 'Note ID')}</h2>
        <button class="iconbtn" id="idLuk" aria-label="Close">${icon('luk', 16)}</button>
      </div>
      <div class="modal-krop">
        <input class="input" id="idFelt" value="${esc(id)}" readonly
          autocomplete="off" spellcheck="false">
        <p class="meta saetning" style="margin-top:10px">${overskrift
    ? 'Anyone with an account on this server can open it. It is not a published page — '
      + 'use <strong>Publish</strong> for that.'
    : 'This is what the API calls <code>NOTE_ID</code> — the address a shortcut adds to with '
      + '<code>?to=…</code>. See <strong>API &amp; shortcuts</strong> for the recipes.'}</p>
      </div>
    </div>`;
  document.body.appendChild(host);

  const luk = () => { host.remove(); document.removeEventListener('keydown', paaTast); };
  const paaTast = (e) => { if (e.key === 'Escape') { e.preventDefault(); luk(); } };
  document.addEventListener('keydown', paaTast);
  host.querySelector('#idLuk').addEventListener('click', luk);
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });
  const felt = host.querySelector('#idFelt');
  felt.focus();
  felt.select();
}
