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
  // F33: har man selv bedt om at se blokken som markdown? Gaelder KUN den
  // blok, der staar aaben - se `aabnBlok`.
  raaBlok: false,
  /*
   * F34: har man bedt om at se HELE noten som markdown?
   *
   * »Mulighed for at lave hele noten til Markdown og ikke kun sektionen naar
   * MD knappen benyttes« (Andreas, 2026-09-10).
   *
   * Den staar ved siden af `raaBlok` og ikke i stedet for: der er to
   * spoergsmaal, ikke ét. `raaBlok` er FORMEN (markdown eller ej), den her er
   * OMFANGET (denne blok eller hele noten) - og de kan slaas til og fra hver
   * for sig. Begge doer, naar noten lukkes: det er et valg for lige nu, ikke
   * en indstilling. Indstillingen findes allerede og hedder `editWhole`.
   */
  raaNote: false,
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

/*
 * Grenens navn ÉT sted. Det staar baade i traeets raekke og i broedkrummen
 * over en note uden bog, og to afskrifter er to navne at laere den dag, den
 * ene bliver rettet.
 */
const LOESE_NAVN = 'Not in a notebook';

/*
 * Notens to bilag - vedhaeftninger og kommentarer - i det SAMME saet.
 *
 * »Kan du lave saa Attachments og comments kan foldes sammen. Men skal vise
 * hvor mange der er« (Andreas, 2026-08-25). De ligger under noten og skubber
 * hinanden ned; med tre skaermbilleder paa er kommentarfeltet ude af syne.
 *
 * De starter FOLDET UD - som i dag. Andreas bad om at kunne folde dem, ikke
 * om at faa dem gemt vaek, og at skjule hans kommentarer uden at spoerge er
 * ikke en foldeknap, det er en aendring han ikke bad om. Folder han dem
 * sammen én gang, bliver de det.
 *
 * Det giver samtidig ÉN betydning i saettet: at staa i `editor.foldede`
 * betyder foldet - praecis som for notesboegerne. Skulle de starte foldet,
 * skulle noeglen betyde det modsatte, og saa var der to konventioner i samme
 * saet at tage fejl af.
 *
 * Antallet staar paa knappen, saa man ved, hvad man folder ud - samme grund
 * som fillisten i indstillingerne (v15) og wikiens navigation.
 *
 * Valget er GLOBALT og ikke pr. note. Den, der aldrig kigger paa
 * vedhaeftninger, skal ikke folde dem sammen én gang pr. note; og den, der
 * altid vil se dem, skal ikke folde dem ud igen hver gang. Samtidig loeser
 * det, at begge afsnit tegnes om under brug - en ny kommentar tegner
 * afsnittet forfra, og uden en husket tilstand ville det klappe i, hver gang
 * man skrev noget.
 */
const BILAG_FILER = 'bilag:files';
const BILAG_KOM = 'bilag:comments';
const BILAG_DODA = 'bilag:doda';

/** Er bilaget foldet ud? */
function bilagAabent(noegle) {
  return !editor.foldede.has(noegle);
}

/**
 * Bind et `<details>` op, saa dets tilstand overlever en optegning.
 *
 * `toggle` og ikke et klik paa `summary`: browseren aabner ogsaa med
 * mellemrum og Enter, og et klik-lytter ville gaa glip af dem.
 */
function bindBilagsfold(host, noegle) {
  const d = host && host.querySelector('details.bilagfold');
  if (!d) return;
  d.addEventListener('toggle', () => {
    if (d.open) editor.foldede.delete(noegle);
    else editor.foldede.add(noegle);
    gemFoldede();
  });
}

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
    // Kun her, hvor hentningen LYKKEDES - se ryddNoteFaner().
    ryddNoteFaner();
  } catch (ex) {
    if (ex.status !== 401) toast(ex.message);
    state.tree = state.tree || [];
  }
}

/**
 * Vis en notesbog i sidebaren: fold den ud, og rul den frem.
 *
 * Bogens egen foldning er ikke nok - er HELE sektionen foldet sammen
 * (`SEKTION_BOEGER`), er bogen der stadig ikke. To foldninger, ét ønske.
 *
 * `bogId` kan også være `SEKTION_LOESE` - »Not in a notebook« er den gren,
 * en note uden bog hører til.
 *
 * Der rulles KUN i sidebaren, som har sin egen rullekasse. `scrollIntoView()`
 * ville tage vinduet med og kaste én ned i noten, man netop står i.
 */
function visBogITraeet(bogId) {
  // Den loese gren er ikke en bog og ligger UDEN for notesbogs-sektionen -
  // dens fold er derfor den eneste, der skal aabnes.
  const loes = bogId === SEKTION_LOESE;
  const varFoldet = editor.foldede.has(bogId) || (!loes && editor.foldede.has(SEKTION_BOEGER));
  if (!loes) editor.foldede.delete(SEKTION_BOEGER);
  editor.foldede.delete(bogId);
  if (varFoldet) gemFoldede();
  tegnTrae();
  // Paa en telefon ligger sidebaren bag menuknappen - ellers aabner man en
  // bog, man ikke kan se. Det samme gaelder en sidebar, der er foldet vaek
  // paa en stor skaerm: dér er den ogsaa et overlay.
  if (smalSkaerm() || document.body.classList.contains('navskjult')) {
    document.body.classList.add('navopen');
  }
  const raekke = document.querySelector(loes
    ? '.tree-row.book[data-loeseraekke]' : `.tree-row.book[data-bograekke="${bogId}"]`);
  const skaerm = document.querySelector('.sidebar');
  if (!raekke || !skaerm) return;
  const r = raekke.getBoundingClientRect();
  const s = skaerm.getBoundingClientRect();
  if (r.top < s.top + 8) skaerm.scrollTop += r.top - s.top - 8;
  else if (r.bottom > s.bottom - 8) skaerm.scrollTop += r.bottom - s.bottom + 8;
  // Et kort glimt, saa oejet finder raekken. Var bogen allerede foldet ud og
  // synlig, er glimtet det eneste, der sker - uden det ligner knappen doed.
  raekke.classList.add('fremhaevet');
  setTimeout(() => raekke.classList.remove('fremhaevet'), 1200);
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
    const markeret = valgte.has(note.id);
    return `<div class="tree-row${aktiv ? ' on' : ''}${markeret ? ' valgt' : ''}" data-raekke="${esc(note.id)}"
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
          ${b.starred ? `<span class="tree-stjerne" title="Starred">${icon('stjerneFuld', 12)}</span>` : ''}
          <button class="tree-del${b.published ? ' paa' : ''}" data-udgivbog="${esc(b.id)}"
            data-navn="${esc(b.name)}"
            aria-label="${b.published ? 'Published on the web' : 'Publish this notebook'}"
            title="${b.published ? 'Published on the web — open the settings' : 'Publish this notebook'}"
            >${icon('globe', 13)}</button>
          <button class="tree-add" data-in="${esc(b.id)}" aria-label="New note here"
            title="New note here">${icon('plus', 13)}</button>
          <button class="tree-add" data-bogmenu="${esc(b.id)}" data-navn="${esc(b.name)}"
            aria-label="More" title="Star, rename or delete">${icon('dots', 13)}</button>
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
    /*
     * `data-loeseraekke` og IKKE `data-bograekke`: krummen skal kunne finde
     * raekken, men et traek, der slippes her, ville ellers forsoege at flytte
     * noten ned i en notesbog, der hedder »sektion:loose« (se bindTraeTraek).
     */
    return `<div class="tree-book${foldet ? '' : ' open'}">
        <div class="tree-row book" data-loeseraekke="1">
          <button class="tree-fold${foldet ? '' : ' open'}" data-fold="${SEKTION_LOESE}"
            aria-label="${foldet ? 'Expand' : 'Collapse'}">${icon('caret', 12)}</button>
          <button class="tree-name meta" data-fold="${SEKTION_LOESE}"
            title="${LOESE_NAVN}"><span>${LOESE_NAVN}</span></button>
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
 * Notesbogens menu: stjerne, omdoeb og slet.
 *
 * Stjernen bor HER og ikke som en knap i raekken (Andreas, 2026-09-13):
 * raekken har allerede globus, plus og prikker, og en bog stjernes én gang -
 * den skal ikke fylde i sidebaren hver dag. En stjernet bog laegger sig
 * oeverst i listen; det goer serveren (`hentNotesboeger`).
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
  const stjernet = !!((state.notebooks || []).find((b) => b.id === id) || {}).starred;
  host.innerHTML = `
    <button class="usermenu-item" data-do="stjerne">${icon(stjernet ? 'stjerneFuld' : 'stjerne', 16)}<span>${
  stjernet ? 'Remove star' : 'Star this notebook'}</span></button>
    <button class="usermenu-item" data-do="navn">${icon('notes', 16)}<span>Rename…</span></button>
    <button class="usermenu-item" data-do="bog-udgiv">${icon('globe', 16)}<span>Publish this notebook</span></button>
    <button class="usermenu-item" data-do="flet">${icon('ind', 16)}<span>Merge into another…</span></button>
    <button class="usermenu-item danger" data-do="slet">${icon('trash', 16)}<span>Move to trash</span></button>`;
  raekke.appendChild(host);

  const luk = () => host.remove();
  host.querySelectorAll('[data-do]').forEach((el) => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const hvad = el.dataset.do;
      luk();
      try {
        if (hvad === 'stjerne') {
          await api('PATCH', `/api/v1/notebooks/${id}`, { starred: !stjernet });
        } else if (hvad === 'navn') {
          const nyt = prompt('Name of the notebook', navn);
          if (nyt === null || !nyt.trim()) return;
          await api('PATCH', `/api/v1/notebooks/${id}`, { name: nyt.trim() });
        } else if (hvad === 'bog-udgiv') {
          visUdgivPanel({ slags: 'bog', id, titel: navn });
          return;
        } else if (hvad === 'flet') {
          visFletRude(id, navn);
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

/* ------------------------------------------- markering af flere noter (F26)
 *
 * »kan du lave saa man kan markere flere noter i venstre side. saa man fx kan
 * flytte flere noter paa en gang?« (Andreas, 2026-09-01).
 *
 * ── Hvorfor ⌘/Ctrl-klik og ikke afkrydsningsfelter ────────────────────────
 *
 * Et felt pr. raekke ville staa fremme i sidebaren hele tiden - i en liste med
 * 945 noter er det 945 felter, man ikke bruger. ⌘-klik er den gestus, enhver
 * filliste bruger, og den koster ingen pixels, foer man tager den i brug.
 *
 * Prisen er, at den ikke findes paa touch. Derfor: **det foerste ⌘-klik
 * taender en markerings-tilstand**, og saa vaelger et almindeligt klik til og
 * fra, saa laenge der er noget markeret. Paa en telefon kan man ikke starte
 * den - og dét er en aaben ende, ikke en loesning. Den staar skrevet ned.
 *
 * ── Hvorfor markeringen ikke overlever en optegning af traeet ─────────────
 *
 * Den goer den. `valgte` er et Set uden for optegningen, og hver raekke faar
 * sin klasse ved tegningen. Ellers ville en flytning - som netop tegner
 * traeet om - rydde markeringen midt i, at man arbejdede med den.
 */
const valgte = new Set();

/** Er der en markering i gang? */
function harValgte() { return valgte.size > 0; }

function ryddValgte() {
  if (!valgte.size) return;
  valgte.clear();
  tegnTrae();
}

/**
 * Skifter markeringen paa én note.
 *
 * `shift` tager spannet fra den sidst markerede - som i enhver anden liste.
 * Raekkefoelgen er den, TRAEET viser, ikke den, noterne blev lavet i: man
 * peger paa to raekker paa skaermen og mener alt imellem dem.
 */
let sidstValgt = null;
function skiftValgt(id, medShift) {
  const raekker = [...document.querySelectorAll('#treeHost [data-note]')]
    .map((el) => el.dataset.note);
  if (medShift && sidstValgt && raekker.includes(sidstValgt) && raekker.includes(id)) {
    const a = raekker.indexOf(sidstValgt);
    const b = raekker.indexOf(id);
    for (const n of raekker.slice(Math.min(a, b), Math.max(a, b) + 1)) valgte.add(n);
  } else if (valgte.has(id)) {
    valgte.delete(id);
  } else {
    valgte.add(id);
  }
  sidstValgt = id;
  tegnTrae();
}

/**
 * Baandet over traeet: hvor mange, og hvad man kan goere.
 *
 * Det staar OVER listen og ikke som en svaevende bjaelke: sidebaren er smal,
 * og en bjaelke hen over den ville daekke netop de raekker, man er ved at
 * vaelge.
 */
function valgtBaandHtml() {
  if (!harValgte()) return '';
  return `<div class="valgtbaand">
      <span class="valgtbaand-tal">${valgte.size} selected</span>
      <button class="btn ghost" id="valgtFlyt">Move…</button>
      <button class="linkbtn" id="valgtRyd">Clear</button>
    </div>`;
}

function bindValgtBaand(host) {
  const flyt = host.querySelector('#valgtFlyt');
  if (flyt) flyt.addEventListener('click', () => visFlytMangeRude());
  const ryd = host.querySelector('#valgtRyd');
  if (ryd) ryd.addEventListener('click', () => ryddValgte());
}

/** Ruden: hvor skal de hen? */
function visFlytMangeRude() {
  const ider = [...valgte];
  if (!ider.length) return;
  const boeger = state.notebooks || [];
  const host = document.createElement('div');
  host.className = 'modal';
  host.id = 'flytMangeRude';
  host.innerHTML = `<div class="modal-kort">
      <div class="modal-top">
        <h2>Move ${ider.length} note${ider.length === 1 ? '' : 's'}</h2>
        <button class="iconbtn" id="fmLuk" aria-label="Close">${icon('luk', 16)}</button>
      </div>
      <div class="modal-krop">
        <p class="meta saetning">Subpages come along. Is a page and its own subpage both
        selected, only the page moves — the subpage follows it, so the branch stays whole.</p>
        <label class="field"><span>Notebook</span>
          <select class="input" id="fmBog">
            <option value="">No notebook</option>
            ${boeger.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}
          </select></label>
        <div class="btnrow" style="margin-top:16px">
          <button class="btn primary" id="fmGem">Move</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(host);

  const luk = () => { host.remove(); document.removeEventListener('keydown', paaTast); };
  const paaTast = (e) => { if (e.key === 'Escape') { e.preventDefault(); luk(); } };
  document.addEventListener('keydown', paaTast);
  host.querySelector('#fmLuk').addEventListener('click', luk);
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });

  host.querySelector('#fmGem').addEventListener('click', async () => {
    const bog = host.querySelector('#fmBog').value || null;
    const navn = bog ? (boeger.find((b) => b.id === bog) || {}).name : 'no notebook';
    try {
      const r = await api('POST', '/api/v1/notes/move', { ids: ider, notebookId: bog });
      luk();
      valgte.clear();
      toast(r.skipped
        ? `${r.moved} moved to “${navn}” — ${r.skipped} came along as `
          + `${r.skipped === 1 ? 'a subpage' : 'subpages'}.`
        : `${r.moved} note${r.moved === 1 ? '' : 's'} moved to “${navn}”.`);
      await hentTrae();
      await hentState();
      tegnTrae();
      opdaterNav();
      // Stod man i en af dem, skal broedkrummerne vise den nye bog.
      if (editor.note && ider.includes(editor.note.id)) await aabnNote(editor.note.id, true);
    } catch (ex) { toast(ex.message); }
  });
}

/* ---------------------------------------- dato- og tidsgenveje (F27)
 *
 * »Jeg vil gerne have en shortcut til at kunne skrive dd-mm-yyyy og hh:mm«
 * (Andreas, 2026-09-02). Han valgte praefiks-formen frem for bare ord.
 *
 * ── Hvorfor et praefiks og ikke bare »dmy« ───────────────────────────────
 *
 * Fordi `dmy` og `hhmm` ogsaa er noget, man kan komme til at skrive - i en
 * note om datoformater, i et kodeeksempel, midt i et ord. En erstatning, der
 * slaar til uden at man bad om det, er vaerre end ingen genvej: man opdager
 * den foerst, naar teksten er forkert.
 *
 * `/` kan ikke rammes ved et uheld midt i et ord, fordi den kun taeller ved
 * starten af en linje eller efter et mellemrum.
 *
 * ── Hvorfor den udloeser med det samme ───────────────────────────────────
 *
 * Alternativet var at vente paa mellemrum eller Enter. Men det, Andreas
 * skriver, er linjer som »01.09.2026, 08.21 : Colestyramin 4g« - dato,
 * komma, tid. Skulle hver genvej afsluttes med et mellemrum, ville han faa et
 * mellemrum, han ikke bad om, lige dér hvor kommaet skal staa.
 *
 * Prisen er, at man ikke kan skrive `/dmy` bogstaveligt i en note. Det er en
 * pris, der er vaerd at betale for to tegn faerre pr. linje, og der er en vej
 * udenom: skriv det i en kodestump.
 */
const TEKSTGENVEJE = [
  {
    ord: '/dmy',
    navn: 'Today’s date',
    eksempel: '02-09-2026',
    lav: (d) => `${String(d.getDate()).padStart(2, '0')}-${
      String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`,
  },
  {
    ord: '/hhmm',
    navn: 'The time now',
    eksempel: '14:32',
    lav: (d) => `${String(d.getHours()).padStart(2, '0')}:${
      String(d.getMinutes()).padStart(2, '0')}`,
  },
  /*
   * Begge dele paa én gang.
   *
   * Formen er den, registreringslinjerne faktisk har: dato, komma, tid -
   * »02-09-2026, 07:18 : Colestyramin 4g«. To genveje pr. linje bliver til én.
   *
   * Den hedder `/now` og ikke `/nu`: interfacet er engelsk (CLAUDE.md), og
   * `/nu` var mit danske ord i et tilbud, ikke et oenske. `/dmy` og `/hhmm`
   * er engelske forkortelser, og den tredje skal laeses i samme sprog.
   *
   * Den bygges af de TO ovenfor frem for at formatere forfra - saa kan de tre
   * ikke komme til at vise forskellige datoer, den dag formatet aendres.
   */
  {
    ord: '/now',
    navn: 'Date and time',
    eksempel: '02-09-2026, 14:32',
    lav: (d) => `${TEKSTGENVEJE[0].lav(d)}, ${TEKSTGENVEJE[1].lav(d)}`,
  },
];

/**
 * Bytter en genvej ud, hvis markoeren staar lige efter én.
 *
 * Returnerer sandt, hvis der blev byttet - saa kalderen ved, at feltet har
 * aendret sig og skal skrives tilbage.
 *
 * Erstatningen sker med `setRangeText`, ikke ved at saette `value`: den
 * bevarer browserens EGEN fortrydelseshistorik, saa ⌘Z tager genvejen tilbage
 * i stedet for at rulle hele afsnittet tilbage.
 */
function byttedeTekstgenvej(felt) {
  const pos = felt.selectionStart;
  if (pos !== felt.selectionEnd) return false;
  const foer = felt.value.slice(0, pos);
  for (const g of TEKSTGENVEJE) {
    if (!foer.endsWith(g.ord)) continue;
    // Kun ved linjestart eller efter et mellemrum - ellers rammer den midt i
    // et ord som `og/dmy`.
    const tegnFoer = foer[foer.length - g.ord.length - 1];
    if (tegnFoer !== undefined && !/\s/.test(tegnFoer)) continue;
    const start = pos - g.ord.length;
    try {
      felt.setRangeText(g.lav(new Date()), start, pos, 'end');
    } catch {
      // Uden setRangeText: bytt i strengen. Fortrydelsen bliver grovere.
      const ny = felt.value.slice(0, start) + g.lav(new Date()) + felt.value.slice(pos);
      const nyPos = start + g.lav(new Date()).length;
      felt.value = ny;
      felt.setSelectionRange(nyPos, nyPos);
    }
    return true;
  }
  return false;
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
    el.addEventListener('click', (e) => {
      /*
       * ⌘/Ctrl vaelger, shift tager spannet - og naar der ALLEREDE er en
       * markering i gang, vaelger et almindeligt klik ogsaa til og fra.
       *
       * Den sidste del er udtrykkeligt oensket: »det kraever ikke at jeg
       * benytter command ... hvilket ogsaa er det jeg oensker« (Andreas,
       * 2026-09-01). Jeg havde lige fjernet den med den begrundelse, at ét
       * fejlramt ⌘-klik saa laaser den primaere handling - at aabne en note.
       * Den indvending var teoretisk; hans brug er det ikke.
       *
       * Men laasen SKAL kunne aabnes uden at lede: derfor rydder **Escape**
       * markeringen, og »Clear« staar i baandet. Uden en vej ud ville et
       * uheld koste én en rundtur gennem sidebaren for at finde knappen.
       */
      if (e.metaKey || e.ctrlKey || e.shiftKey || harValgte()) {
        e.preventDefault();
        skiftValgt(el.dataset.note, e.shiftKey);
        return;
      }
      aabnNote(el.dataset.note);
    });
  });
  bindValgtBaand(host);

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
  const maal = traeNote(maalId);
  if (!maal) return;
  /*
   * Traekker man en MARKERET note, foelger hele markeringen med - ogsaa her,
   * og ikke kun ved slip paa en notesbog. To slipsteder med hver sin regel er
   * to regler at tage fejl af.
   *
   * De laegges ind i den raekkefoelge, TRAEET viser dem - man har peget paa
   * en stribe raekker og mener den stribe, ikke den, de blev lavet i.
   */
  const flok = traekkerHeleMarkeringen(noteId)
    ? valgteITraeorden().filter((id) => id !== maal.id)
    : [noteId];
  const noter = flok.map(traeNote).filter(Boolean);
  if (!noter.length || noter.some((n) => n.id === maal.id)) return;

  const nyFar = maal.parentId || null;
  const nyBog = maal.notebookId || null;
  const flere = noter.length > 1;
  try {
    for (const note of noter) {
      if ((note.parentId || null) !== nyFar || (note.notebookId || null) !== nyBog) {
        await api('POST', `/api/v1/notes/${note.id}/move`,
          nyFar ? { parentId: nyFar } : { parentId: null, notebookId: nyBog });
      }
    }
    const flytted = new Set(noter.map((n) => n.id));
    const gruppe = (state.tree || [])
      .filter((n) => (n.parentId || null) === nyFar
        && (nyFar !== null || (n.notebookId || null) === nyBog)
        && !flytted.has(n.id));
    let i = gruppe.findIndex((n) => n.id === maal.id);
    if (i < 0) i = gruppe.length - 1;
    gruppe.splice(efter ? i + 1 : i, 0, ...noter);
    await api('POST', '/api/v1/reorder', { kind: 'note', ids: gruppe.map((n) => n.id) });
    if (flere) { valgte.clear(); toast(`${noter.length} notes moved.`); }
    await hentTrae();
    tegnTrae();
    synkAabenNote();
  } catch (ex) { toast(ex.message); }
}

/** Slip paa en notesbog: ind i den, oeverst i traeet. */
/**
 * De markerede noter, i den raekkefoelge TRAEET viser dem - og uden dem, hvis
 * forfader ogsaa er markeret.
 *
 * Den sidste del er den samme regel som paa serveren: `flytNote` tager hele
 * undertraeet med, saa flytter man baade en side og dens underside hver for
 * sig, bliver grenen revet fra hinanden. Her SKAL den ogsaa staa, fordi
 * `slipTraek` ikke gaar gennem bulk-ruten - den bygger sin egen sortering.
 */
function valgteITraeorden() {
  const raekkefoelge = [...document.querySelectorAll('#treeHost [data-note]')]
    .map((el) => el.dataset.note)
    .filter((id) => valgte.has(id));
  const harValgtForfader = (id) => {
    let n = traeNote(id);
    for (let dybde = 0; n && n.parentId && dybde < 64; dybde++) {
      if (valgte.has(n.parentId)) return true;
      n = traeNote(n.parentId);
    }
    return false;
  };
  return raekkefoelge.filter((id) => !harValgtForfader(id));
}

/**
 * Traekker man en MARKERET note, foelger hele markeringen med.
 *
 * Meldt fra brug: »hvis jeg marker flere noter med command og proever at
 * flytte dem ned i en anden notebook, saa flytter den kun en ad gangen«
 * (Andreas, 2026-09-01).
 *
 * v43 gav markeringen en »Move…«-knap og glemte trækket. Det er den samme
 * handling set fra brugerens side - han har markeret tre noter og taget fat i
 * en af dem - saa de to veje skal goere det samme. En markering, der kun
 * gaelder den ene af to veje, er vaerre end ingen markering: man kan ikke se
 * paa skaermen, hvilken vej der taeller.
 */
function traekkerHeleMarkeringen(noteId) {
  return valgte.has(noteId) && valgte.size > 1;
}

async function slipIBog(noteId, bogId) {
  if (traekkerHeleMarkeringen(noteId)) {
    const ider = valgteITraeorden();
    try {
      const r = await api('POST', '/api/v1/notes/move', { ids: ider, notebookId: bogId });
      valgte.clear();
      toast(r.skipped
        ? `${r.moved} moved — ${r.skipped} came along as `
          + `${r.skipped === 1 ? 'a subpage' : 'subpages'}.`
        : `${r.moved} note${r.moved === 1 ? '' : 's'} moved.`);
      await hentTrae();
      tegnTrae();
      synkAabenNote();
    } catch (ex) { toast(ex.message); }
    return;
  }
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

/** Alle raekker, der ser trukket ud, faar deres udseende tilbage. */
function ryddTraekkes() {
  for (const el of document.querySelectorAll('.tree-row.traekkes')) el.classList.remove('traekkes');
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
      /*
       * Traekker man en markeret note, skal ALLE de markerede se traukket ud.
       * Ellers ligner det, at man flytter én - og saa er man overrasket, naar
       * tre lander.
       */
      if (traekkerHeleMarkeringen(traek.id)) {
        for (const el of host.querySelectorAll('.tree-row.valgt')) el.classList.add('traekkes');
      } else {
        traek.fra.classList.add('traekkes');
      }
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
    ryddTraekkes();
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
    ryddTraekkes();
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
  // Baandet foerst: det siger, hvor mange der er markeret, og staar OVER
  // listen frem for hen over den.
  host.innerHTML = valgtBaandHtml() + traeHtml();
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
   * Fanen afgoeres HER, foer vagten (F35): et klik paa den note, man allerede
   * staar i, skal stadig goere dens fane til den aktive. En opfriskning
   * (`tving`) er ikke et skridt og roerer ikke fanerne.
   */
  if (!tving) noteFaneVedAabning(id);
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
  /*
   * Husk hvor vi stod - FOER `state` aendres, og kun naar vi faktisk gaar et
   * andet sted hen. En opfriskning af den note, man staar paa, er ikke et
   * skridt.
   */
  if (state.openNote !== id) husk();
  await gemNu();
  editor.indlaeser = id;
  state.view = 'note';
  state.openNote = id;
  /*
   * Adressen skrives HER - foer hentningen, ikke efter.
   *
   * Skete det foerst, naar noten var hentet, ville en opfriskning midt i
   * hentningen lande paa forsiden. Og skrivningen er `replaceState`, saa den
   * ikke selv sender en `hashchange` retur (se `saetAdresse`).
   */
  saetAdresse(id);
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
    noteFaneEfterIndlaesning(editor.note);
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
    noteFaneFejl(id, ex);
    toast(ex.message);
    gaaTil('notes');
  }
}

/**
 * Tilbage-knappen. Kun naar der ER noget at gaa tilbage til.
 *
 * »Den kunne evt. blive synlig til venstre for Save« (Andreas, 2026-09-01) -
 * og dér staar den, forrest i vaerktoejsraekken.
 *
 * Den siger HVOR den foerer hen. En pil alene er et gaet, og man skal kunne
 * vide, om man lander paa den forrige note eller helt tilbage i soegningen,
 * FOER man trykker.
 *
 * Skjult frem for slaaet fra: en knap, der aldrig kan bruges paa den foerste
 * note, man aabner, er stoej i vaerktoejsraekken.
 */
function tilbageKnapHtml() {
  if (!kanGaaTilbage()) return '';
  const post = tilbagespor[tilbagespor.length - 1];
  const navn = sporNavn(post);
  return `<button class="iconbtn" id="tilbageBtn"
    title="Back to “${esc(navn)}”" aria-label="Back to ${esc(navn)}">${icon('tilbage', 16)}</button>`;
}

function notesbog(id) {
  return (state.notebooks || []).find((x) => x.id === id) || null;
}

function notesbogNavn(id) {
  const b = notesbog(id);
  return b ? b.name : null;
}

/*
 * Broedkrummer: hvor i traeet er jeg?
 *
 * »jeg vil gerne have tilfoejet at naar jeg staar i en note at den saa viser
 * lige ved navnet hvilke notebook den ligger under og navnet skal man kunne
 * klikke paa for at aabne den notebook i venstre menuen« (Andreas,
 * 2026-09-16). Bogen STOD der - som doed tekst. Nu er den en knap, der
 * folder bogen ud i sidebaren og ruller den frem.
 *
 * Den foerer ikke til en LISTE over bogens noter: kravet er »aabne den
 * notebook i venstre menuen«, og sidebaren er i forvejen det sted, man
 * bladrer i en bog. En knap, der ogsaa skiftede side, ville flytte én vaek
 * fra den note, man staar i.
 */
function broedkrummer(note) {
  const kort = new Map((state.tree || []).map((n) => [n.id, n]));
  const sti = [];
  let cur = kort.get(note.parentId);
  for (let i = 0; i < 32 && cur; i++) { sti.unshift(cur); cur = kort.get(cur.parentId); }
  const bog = notesbog(note.notebookId);
  const dele = [];
  if (bog) {
    dele.push(`<button class="krumme-bog" data-bogkrumme="${esc(bog.id)}"
      title="Show “${esc(bog.name)}” in the sidebar">${bog.icon
  ? `<span class="krumme-ikon">${esc(bog.icon)}</span>` : icon('book', 13)}${esc(bog.name)}</button>`);
  } else if (!note.notebookId && note.mine !== false) {
    /*
     * »Den maa gerne sige naar noten ligger i not in a notebook« (Andreas,
     * 2026-09-16). Ordene er sidebarens egne - to navne til den samme gren
     * ville vaere to ting at laere.
     *
     * KUN mine egne noter. En note, en anden har delt, ligger i EJERENS bog,
     * som ikke staar i mine `notebooks` - og saa ville »Not in a notebook«
     * vaere et svar, der er direkte forkert. Dér staar der ingenting, som
     * hidtil.
     */
    dele.push(`<button class="krumme-bog" data-bogkrumme="${SEKTION_LOESE}"
      title="Show the loose notes in the sidebar">${LOESE_NAVN}</button>`);
  }
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
    tegnOpdateret();
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

/*
 * »Hvornaar blev noten sidst opdateret?« (Andreas, 2026-09-23).
 *
 * Staar i linjen over titlen, til hoejre for broedkrummen - den er noten
 * OM noten, og dér er der plads. Relativ tid, saa laenge den er det, man
 * taenker i (»12 min ago«, »yesterday at 14:02«), og derefter en dato.
 * Det praecise tidspunkt ligger i `title`, for den, der har brug for det.
 *
 * Tiden er serverens `updatedAt`, ikke »Saved«-maerkets: en rettelse i et
 * maerke eller fra en anden enhed taeller ogsaa som en opdatering.
 */
function opdateretTekst(sek) {
  if (!sek) return '';
  const d = new Date(sek * 1000);
  const sekSiden = Math.round(Date.now() / 1000 - sek);
  if (sekSiden < 45) return 'just now';
  const min = Math.round(sekSiden / 60);
  if (min < 60) return `${min} min ago`;
  const kl = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const idag = new Date(); idag.setHours(0, 0, 0, 0);
  const dagen = new Date(d); dagen.setHours(0, 0, 0, 0);
  const dage = Math.round((idag - dagen) / 86400000);
  if (dage === 0) return `today at ${kl}`;
  if (dage === 1) return `yesterday at ${kl}`;
  if (dage < 7) return `${dage} days ago`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function opdateretHtml(n) {
  if (!n || !n.updatedAt) return '';
  const praecis = new Date(n.updatedAt * 1000).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  return `<span class="note-opdateret meta" id="noteOpdateret"
    title="Last updated ${esc(praecis)}">Updated ${esc(opdateretTekst(n.updatedAt))}</span>`;
}

/** Skriver tidspunktet om uden at tegne siden - efter en gemning og hvert halve minut. */
function tegnOpdateret() {
  const el = document.getElementById('noteOpdateret');
  if (!el || !editor.note) return;
  el.outerHTML = opdateretHtml(editor.note);
}
// »3 min ago« maa ikke staa og vaere »just now« i en time.
setInterval(tegnOpdateret, 30000);

function sideNote() {
  const n = editor.note;
  if (editor.indlaeser || !n) {
    return '<div class="card empty"><p class="meta saetning">Opening…</p></div>';
  }

  return `
    <div class="note-over">${broedkrummer(n)}${opdateretHtml(n)}</div>
    <div class="note-head">
      <button class="note-ikon" id="noteIkon" title="Pick an icon"
        aria-label="Pick an icon">${n.icon ? esc(n.icon) : icon('notes', 20)}</button>
      <textarea class="note-title" id="noteTitle" rows="1"
        placeholder="Untitled" autocomplete="off" spellcheck="false"
        ${maaRette(n) ? '' : 'readonly'}>${esc(n.title)}</textarea>
      <div class="note-tools">
        ${tilbageKnapHtml()}
        <span id="gemMaerke">${gemMaerke()}</span>
        <button class="iconbtn" id="kopiNote"
          title="Copy the whole note — with the images">${icon('copy', 15)}</button>
        <button class="iconbtn" id="fokusBtn" title="Focus mode (F) — just the note">${icon('focus', 16)}</button>
        ${soloVindue() ? '' : `<button class="iconbtn" id="popUdBtn"
          title="Open in its own window">${icon('vindue', 16)}</button>`}
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
/*
 * Feltet under noten, hvor man tilfoejer en blok (F31).
 *
 * Det skal KUNNE SES. Reglen »et tryk i noten begynder at skrive« har vaeret
 * der siden F13, men den aabner den SIDSTE blok - og en regel, man ikke kan
 * se, findes ikke for den, der leder efter en maade at skrive videre paa.
 * Feltet siger derfor, hvad det goer, naar man er i naerheden af det.
 *
 * Det staar ikke, naar en blok er aaben: saa er man allerede ved at skrive,
 * og Enter laver den naeste blok.
 */
function nyBlokFeltHtml() {
  return `<button type="button" class="ny-blok" id="nyBlok" tabindex="-1"
    aria-label="Add a block at the end">${icon('plus', 15)}<span>Add a block</span></button>`;
}

function bindNyBlokFelt(host) {
  const k = host.querySelector('#nyBlok');
  if (k) k.addEventListener('click', (e) => { e.stopPropagation(); nyBlokTilSidst(); });
}

function tegnKrop() {
  const host = document.getElementById('noteBody');
  const n = editor.note;
  if (!host || !n) return;

  if (editor.aabenBlok !== null) {
    // To editorer, ét valg. Se `heleNoten()`.
    if (heleNoten()) tegnHeleNoten(host, n);
    else tegnMedAabenBlok(host, n);
    // Et aabent felt og en markering kan ikke staa samtidig (F36), men
    // baandet skal tegnes VAEK, naar man gaar fra det ene til det andet.
    tegnBlokValgBaand();
    return;
  }

  /*
   * Noten som ÉT dokument (v85) - se p16_dokument.js. Falder den igennem
   * (en note, der ikke kan skrives uaendret tilbage), tegnes den som foer.
   */
  if (brugDokument(n)) {
    const hvor = dokHarFokus() ? dokMarkoer() : null;
    if (tegnDokument(host, n, hvor ? { markoer: hvor } : null)) {
      // Kroppens ene klik-handler - oeerne, links og arealet under noten.
      bindKrop();
      tegnBlokValgBaand();
      return;
    }
  }
  dok.el = null;

  try {
    const { html } = saguMarkdown.render(n.body, renderValg());
    host.innerHTML = (html || '<p class="tom-note meta saetning">Click here to start writing.</p>')
      + (maaRette(n) ? nyBlokFeltHtml() : '');
    bindNyBlokFelt(host);
    pyntKodeblokke(host);
    pyntInlineKode(host);
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
  // Markeringen lever uden for optegningen, saa den skal farves paa igen -
  // ellers ville en optegning (et flueben, et billede der lander) se ud, som
  // om markeringen var forsvundet (F36).
  markerValgteBlokke(host);
  tegnBlokValgBaand();
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

  /*
   * ÉN delegeret handler paa kroppen - og kun én. Ikke `{once:true}`: den
   * ville fjerne sig selv efter foerste klik, saa man kunne aabne én blok pr.
   * optegning og derefter ingenting, og fejlen ville ligne »editoren gaar i
   * staa«.
   *
   * ── Hvorfor der staar et maerke paa vaerten ──────────────────────────────
   *
   * `tegnKrop()` skriver kroppens `innerHTML` om, men `#noteBody` SELV
   * overlever - kun dens boern skiftes ud. Handleren blev derfor lagt paa
   * igen ved hver optegning, og efter n optegninger koerte den n gange paa ét
   * klik. `stopPropagation()` hjaelper ikke: den standser andre ELEMENTER,
   * ikke andre handlere paa det samme.
   *
   * Det var usynligt, saa laenge et klik betoed »aabn den her blok« - at
   * aabne den samme blok fem gange er det samme som at aabne den én gang.
   * F36's markering er et SKIFT, og to kald i traek ophaever hinanden: anden
   * gang man ⌘-klikkede, skete der ingenting (maalt i browseren,
   * 2026-09-20). **En handler, der ikke kan taale at blive kaldt to gange,
   * afsloerer en binding, der er lagt paa to gange.**
   *
   * Vaerten er ny for hver note (`sideNote()` skriver hele kortet), saa
   * maerket foelger med i faldet af sig selv.
   */
  if (host.dataset.bundet) return;
  host.dataset.bundet = '1';

  host.addEventListener('click', (e) => {
    // Dokumentet (v85) har sine egne regler for klik - teksten er browserens.
    if (dokKlik(e)) return;
    /*
     * **Markeringen af flere blokke spoerges FOERST** (F36).
     *
     * Foer tekstmarkeringen nedenfor, med vilje: et ⌘-klik i et afsnit, hvor
     * der ogsaa stod noget markeret tekst, ville ellers falde paa den vagt og
     * ikke markere noget. Vagten mod betjeningselementerne staar inde i
     * `blokValgKlik` selv, saa haandtaget og menuen er upaavirkede.
     */
    if (blokValgKlik(e)) return;

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
  /*
   * En TOM linje, man har bedt om at aabne, er en tom blok.
   *
   * Her stod kun undtagelsen for en tom note (`aabenBlok === 0`). Men fra
   * F31 kan man ogsaa tilfoeje en blok til SIDST, og den nye linje er
   * netop tom - `blokke()` springer tomme linjer over, saa den findes ikke
   * i listen. Uden den her gren lukkede feltet med det samme, og »tilfoej en
   * blok« gjorde ingenting.
   */
  const b = blokke.find((x) => x.fra === editor.aabenBlok)
    || (editor.aabenBlok !== null && editor.aabenBlok < linjer.length
      && !String(linjer[editor.aabenBlok] || '').trim()
      ? { fra: editor.aabenBlok, til: editor.aabenBlok, slags: 'afsnit' } : null);
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
  /*
   * Rig eller raa? (F30)
   *
   * `kanRedigereRigt()` er porten: kun en blok, der kan skrives tilbage til
   * NOEJAGTIG den markdown, den kom af, redigeres renderet. Alt andet - kode,
   * tabeller, en blok med raa HTML - aabner raat som altid. Saa kan en fejl i
   * oversaettelsen aldrig omskrive tekst i tavshed.
   */
  /*
   * `editor.raaBlok` er den, der har TRYKKET paa MD-knappen.
   *
   * Der er to grunde til, at en blok staar raa, og de skal ikke blandes:
   * porten kan have sagt nej (en tabel, en kodeblok - dér er markdown den
   * rigtige flade), eller man kan have bedt om det selv. Kun den anden kan
   * fortrydes, og derfor faar kun den en MD-knap med vejen tilbage.
   *
   * »Hele noten« staar der til gengaeld BEGGE steder (F34). Den er ikke en
   * vej tilbage, men et omfang - og netop i en tabel er det ofte hele noten,
   * man er ude efter. Havde raekken vaeret helt vaek her, ville et klik i en
   * tabel vaere den ene blok, man ikke kunne komme videre fra.
   */
  const rigt = !editor.raaBlok && kanRedigereRigt(raa, b);
  host.innerHTML = `${del(foer)}
    <div class="blok-redigering${rigt ? ' rig' : ''}">
      ${vaerktoejslinjeHtml(rigt, rigt || editor.raaBlok)}
      ${rigt
    ? '<div class="blok-felt rig-felt" id="blokRigt"></div>'
    : `<textarea class="blok-felt" id="blokFelt" spellcheck="false"
        rows="${Math.max(1, raa.split('\n').length)}">${esc(raa)}</textarea>`}
      <button class="blok-hjaelp" id="blokHjaelp" type="button" tabindex="-1"
        aria-label="How to write this" title="How to write this">?</button>
    </div>
    ${del(efter)}`;

  // De renderede dele skal ogsaa have knapper, lightbox og indlejringer.
  // **Begge optegningsveje** - den her og `tegnKrop()` - skal goere det samme;
  // glemmer den ene noget, virker funktionen kun, naar ingen blok er aaben,
  // og fejlen ligner »kortet forsvandt, da jeg klikkede« (F12).
  pyntKodeblokke(host);
  pyntInlineKode(host);
  bindTjek(host);
  bindBilleder(host);
  fyldGhIndlejringer(host);
  // Den AABNE blok har ingen `data-blok` og faar derfor intet haandtag - man
  // kan ikke traekke i det, man staar midt i at skrive. Resten kan.
  tegnGreb(host);
  // ÉT kaldested, foer feltet fyldes: begge veje - rig og raa - skal holdes
  // i syne, og den ene maa ikke kunne glemme det. Det samme gaelder
  // MD-knappen: den findes i BEGGE tilstande og bindes derfor ikke inde i
  // den ene af dem.
  holdBlokISyne(host);
  bindMdKnap();

  const hj = document.getElementById('blokHjaelp');
  // `mousedown` med preventDefault, ikke `click`: et klik ville tage fokus
  // fra feltet, og `blur` lukker blokken - saa var man ude af det, man var
  // ved at skrive, for at kigge i hjaelpen.
  if (hj) {
    hj.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); visSyntaksPanel(); });
    hj.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); visSyntaksPanel(); },
      { passive: false });
  }

  /*
   * Den rige blok fyldes FOERST HER - efter `pynt*` og `bind*` ovenfor.
   *
   * De pynter alt, hvad de finder i `host`: kopiknapper paa kodestumper,
   * greb i margenen, tjekbokse. Inde i noget, man REDIGERER, hoerer de ikke
   * til - en kopiknap ville staa i teksten og blive skrevet med tilbage som
   * ord. At fylde feltet bagefter er billigere end en undtagelse i fem
   * funktioner, og det kan ikke glemmes i den ene.
   */
  if (rigt) {
    const vaert = document.getElementById('blokRigt');
    if (!vaert) return;
    // En TOM blok skal have et afsnit at skrive i - et helt tomt
    // `contenteditable` giver markoeren ingen plads at staa.
    vaert.innerHTML = del(raa) || '<p></p>';
    vaert.setAttribute('contenteditable', 'true');
    vaert.setAttribute('spellcheck', 'true');
    maerkTomt(vaert);
    bindRigBlok(vaert, b);
    return;
  }

  const felt = document.getElementById('blokFelt');
  if (!felt) return;
  bindRaaVaerktoej(felt);
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
    byttedeTekstgenvej(felt);
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
    // blok feltet, foer den nye blok naar at aabne. Vaerktoejslinjen taeller
    // MED til feltet: fra F33 staar MD-knappen dér, ogsaa i markdown.
    setTimeout(() => {
      if (fokusErIBlokken()) return;
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

/**
 * Titlen faar sin hoejde - og hele bredden, hvis den ikke kan staa paa én linje.
 *
 * Med knapperne til hoejre blev en lang titel en hoej, smal soejle. Kan den
 * ikke staa paa én linje ved siden af knapperne, flytter knapperne op over
 * den (`lang-titel`). Afgoerelsen tages altid UDEN klassen - ellers ville
 * den bredere titel passe, klassen ryge af, og titlen hoppe frem og tilbage.
 * Det sker i ét hug, saa browseren kun tegner resultatet.
 */
function tilpasTitel(titel) {
  const hoved = titel.closest('.note-head');
  if (hoved) hoved.classList.remove('lang-titel');
  autoHoejde(titel);
  const linje = parseFloat(getComputedStyle(titel).lineHeight) || 40;
  if (hoved && titel.scrollHeight > linje * 1.5) {
    hoved.classList.add('lang-titel');
    autoHoejde(titel);
  }
}

/*
 * Feltet vokser med teksten.
 *
 * `height: auto` et ojeblik er den eneste maade at maale, hvor hoejt det
 * SKAL vaere - men i det ojeblik er siden kortere, og browseren klemmer
 * rulningen. Paa en telefon hoppede siden derfor ved hvert tastetryk i en
 * lang note, og man mistede den linje, man skrev i (Andreas, 2026-09-25:
 * »kunne ikke rette i noget paa mobil« i hele noten som markdown).
 * Rulningen gemmes og saettes tilbage i samme hug.
 */
function autoHoejde(felt) {
  const y = typeof rulletNed === 'function' ? rulletNed() : 0;
  felt.style.height = 'auto';
  felt.style.height = `${felt.scrollHeight}px`;
  if (typeof rulTil === 'function' && Math.abs(rulletNed() - y) > 1) rulTil(y);
}

/* ==================================================================== F30
 * Rig redigering: noten ser ud, som naar man laeser den - ogsaa mens man
 * skriver i den.
 *
 * »Jeg vil gerne have et interface som viser det paa samme maade som naar man
 * bare kigger paa vores noter. bare ogsaa naar man skriver i den. Det goer at
 * billeder m.m. forbliver synlige« (Andreas, 2026-09-05).
 *
 * ── Porten ───────────────────────────────────────────────────────────────
 *
 * En blok redigeres kun renderet, hvis den kan skrives TILBAGE til noejagtig
 * den markdown, den kom af. Ellers aabner den raat, som altid. Maalt mod
 * Andreas' 9.233 rigtige afsnit og overskrifter: 99,99 % bestaar
 * (DESIGN.md §38). Sikkerhedsnettet er billigere end tilliden.
 *
 * ── Pr. BLOK, ikke pr. note ──────────────────────────────────────────────
 *
 * Hele noten som ét `contenteditable` ville betyde, at hvert tastetryk
 * oversatte HELE noten tilbage - og en fejl dér omskriver tekst, man ikke har
 * roert. Her kan en fejl kun ramme den blok, man staar i; resten beholder sin
 * markdown byte for byte.
 */

/*
 * De slags, hvor rundturen er MAALT mod Andreas' rigtige arkiv (DESIGN.md
 * §38). Tallene er pr. bloktype, ikke et gennemsnit:
 *
 *   afsnit 100,0 %   overskrift 99,9 %   callout 100,0 %
 *   liste   92,8 %   citat      98,4 %   tjekliste 100 % (lokalt)
 *
 * Kode staar med VILJE udenfor: kode SKAL vaere raa, ellers formaterer en
 * kodeblok sit eget indhold, mens man skriver i den. Tabeller og `hr` er
 * ikke lavet endnu - de aabner raat, og porten sikrer, at det ogsaa er dét,
 * der sker, hvis en af de andre alligevel ikke kan skrives tilbage.
 */
const RIGE_BLOKKE = new Set(['afsnit', 'overskrift', 'liste', 'tjekliste', 'citat', 'callout']);

function kanRedigereRigt(raa, b) {
  if (!b || !RIGE_BLOKKE.has(b.slags)) return false;
  if (typeof saguRedigering === 'undefined') return false;
  try {
    const html = saguMarkdown.render(raa, renderValg()).html.trim();
    return saguRedigering.tilMarkdown(html) === raa;
  } catch { return false; }
}

/*
 * Vaerktoejslinjen staar ved BLOKKEN, ikke i notens vaerktoejsraekke.
 *
 * Samme begrundelse som hjaelpeknappen ved siden af: raekken i toppen er
 * rullet vaek paa en telefon, netop naar man skriver. En knap skal vaere dér,
 * hvor handlingen er.
 *
 * Ingen gennemstregning: Andreas bad udtrykkeligt om at lade den ud
 * (2026-09-05), og en knap, ingen har bedt om, er en knap, der skal
 * vedligeholdes.
 */
/* Knapperne i den RAA tekst - de skriver markdown (se `raaOmslut`). */
const RAA_VAERKTOEJER = [
  { goer: 'fed', navn: 'Bold', vis: '<b>B</b>' },
  { goer: 'kursiv', navn: 'Italic', vis: '<i>I</i>' },
  { goer: 'kode', navn: 'Code', vis: '&lt;/&gt;' },
  { goer: 'link', navn: 'Link', vis: 'Link', tekst: true },
  { goer: 'tjek', navn: 'Checklist', vis: icon('tjekboks', 15) },
];

/**
 * Markdown om det markerede i et tekstfelt. REN: tekst og markering ind,
 * erstatning ud - saa den kan proeves uden en DOM.
 *
 * @returns {{fra, til, ny, selA, selB}} erstat `fra..til` med `ny`, og
 *   markér `selA..selB` bagefter (absolutte positioner i den NYE tekst).
 */
function raaOmslut(vaerdi, a, b, hvad) {
  const v = String(vaerdi);
  if (hvad === 'tjek') {
    // Hele linjerne i markeringen - samme regel som knappen i den rige blok.
    const fra = v.lastIndexOf('\n', a - 1) + 1;
    let til = v.indexOf('\n', b > a && v[b - 1] === '\n' ? b - 1 : b);
    if (til < 0) til = v.length;
    const linjer = v.slice(fra, til).split('\n');
    const fyldte = linjer.filter((l) => l.trim());
    const alle = fyldte.length > 0 && fyldte.every((l) => TJEK_LINJE.test(l));
    const ny = linjer.map((l) => {
      if (!l.trim()) return l;
      if (alle) return l.replace(TJEK_LINJE, '$1');
      const uden = TJEK_LINJE.test(l) ? l.replace(TJEK_LINJE, '$1') : l.replace(BLOKMAERKE, '$1');
      const ind = (uden.match(/^\s*/) || [''])[0];
      return `${ind}- [ ] ${uden.slice(ind.length)}`;
    }).join('\n');
    return { fra, til, ny, selA: fra + ny.length, selB: fra + ny.length };
  }
  if (hvad === 'link') {
    const tekst = v.slice(a, b);
    const erAdr = /^https?:\/\/\S+$/.test(tekst);
    // En markeret ADRESSE bliver maalet; en markeret tekst bliver teksten, og
    // adressen er det, man skriver bagefter - den staar markeret.
    const ny = erAdr ? `[](${tekst})` : `[${tekst}](https://)`;
    const selA = erAdr ? a + 1 : a + tekst.length + 3;
    return { fra: a, til: b, ny, selA, selB: erAdr ? a + 1 : selA + 8 };
  }
  const mk = { fed: '**', kursiv: '*', kode: '`' }[hvad];
  if (!mk) return null;
  // Staar markeringen allerede i maerkerne, tages de af igen.
  if (v.slice(a - mk.length, a) === mk && v.slice(b, b + mk.length) === mk
      && !(mk === '*' && (v[a - 2] === '*' || v[b + 1] === '*'))) {
    return { fra: a - mk.length, til: b + mk.length, ny: v.slice(a, b),
      selA: a - mk.length, selB: b - mk.length };
  }
  return { fra: a, til: b, ny: `${mk}${v.slice(a, b)}${mk}`, selA: a + mk.length, selB: b + mk.length };
}

/** Udfoer `raaOmslut` i feltet - gennem browserens indsaet, saa ⌘Z virker. */
function raaFormat(felt, hvad) {
  const r = raaOmslut(felt.value, felt.selectionStart, felt.selectionEnd, hvad);
  if (!r) return;
  felt.focus();
  felt.setSelectionRange(r.fra, r.til);
  let ok = false;
  try { ok = document.execCommand('insertText', false, r.ny); } catch { ok = false; }
  if (!ok) {
    felt.setRangeText(r.ny, r.fra, r.til, 'end');
    felt.dispatchEvent(new Event('input', { bubbles: true }));
  }
  felt.setSelectionRange(r.selA, r.selB);
}

/** Knapperne over et RAA felt: fil, markdown-knapperne og datoerne. */
function bindRaaVaerktoej(felt) {
  const linje = document.getElementById('blokVaerktoej');
  if (!linje || !felt) return;
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  linje.querySelectorAll('[data-raagoer]').forEach((k) => {
    k.addEventListener('mousedown', (e) => { stop(e); raaFormat(felt, k.dataset.raagoer); });
  });
  linje.querySelectorAll('[data-genvej]').forEach((k) => {
    k.addEventListener('mousedown', (e) => {
      stop(e);
      const g = TEKSTGENVEJE.find((x) => x.ord === k.dataset.genvej);
      if (!g) return;
      felt.focus();
      let ok = false;
      try { ok = document.execCommand('insertText', false, g.lav(new Date())); } catch { ok = false; }
      if (!ok) indsaetITekst(felt, g.lav(new Date()));
    });
  });
  const fil = linje.querySelector('[data-fil]');
  if (fil) {
    fil.addEventListener('mousedown', stop);
    fil.addEventListener('click', (e) => {
      stop(e);
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.multiple = true;
      inp.style.display = 'none';
      document.body.appendChild(inp);
      inp.addEventListener('change', async () => {
        const valgte = [...inp.files];
        inp.remove();
        for (const f of valgte.slice(0, 20)) await indsaetFil(f, felt);
        // Filvaelgeren tog fokus, og feltet lukkede imens. Filen ER lagt i
        // noten (feltets `input` skriver den) - nu skal den ogsaa kunne ses.
        if (!felt.isConnected) tegnKrop();
      });
      inp.click();
    });
  }
}

const VAERKTOEJER = [
  { goer: 'strong', navn: 'Bold', tast: '⌘B', vis: '<b>B</b>' },
  { goer: 'em', navn: 'Italic', tast: '⌘I', vis: '<i>I</i>' },
  { goer: 'u', navn: 'Underline', tast: '⌘U', vis: '<u>U</u>' },
  { goer: 'code', navn: 'Code', tast: '', vis: '&lt;/&gt;' },
];

/*
 * Dato og tid som KNAPPER (Andreas bad om det 2026-09-05).
 *
 * De samme tre, som `/dmy`, `/hhmm` og `/now` skriver - og de tegnes af
 * SAMME bord, saa en knap aldrig kan indsaette noget andet end genvejen.
 * Genvejene virker stadig; knapperne er for dem, der ikke husker ordene.
 */
const DATOKNAPPER = [
  { ord: '/dmy', vis: 'Date' },
  { ord: '/hhmm', vis: 'Time' },
  { ord: '/now', vis: 'Now' },
];

/*
 * MD-knappen: den samme blok, vist som markdown (F33).
 *
 * »kan du efter Now tilfoeje en knap som skifter visningen til markdown, saa
 * man fx kan rette overskriften i et URL link« (Andreas, 2026-09-07).
 *
 * Den rige blok viser `[the docs](https://…)` som ordene »the docs«, og saa
 * er der ikke noget at saette markoeren i, hvis det er NAVNET, man vil rette.
 * Kilden er stadig markdown - den er bare gemt bag visningen - saa knappen
 * viser den frem igen. Det er den samme raa blok, som en tabel eller en
 * kodeblok altid har aabnet i; den er nu ogsaa noget, man kan VAELGE.
 *
 * Den staar sidst, efter Now, som han bad om - og den er den ENESTE knap i
 * raekken, naar man staar i markdown, for B/I/U kan ikke noget dér.
 */
function mdKnapHtml(rigt) {
  const navn = rigt ? 'Edit as Markdown' : 'Back to formatted text';
  return `<button type="button" class="vt-knap vt-tekst vt-md" data-raa="1" tabindex="-1"
      aria-pressed="${rigt ? 'false' : 'true'}"
      title="${navn}" aria-label="${navn}">MD</button>`;
}

/*
 * »Hele noten« - MD-knappens omfang (F34).
 *
 * MD viser den blok, man staar i. Naar man skal flytte et afsnit op over et
 * andet, rette en tabel eller klippe paa tvaers, er det ikke blokken, der er
 * arbejdsemnet - det er noten. Den knap staar derfor KUN i markdown-raekken:
 * »hele noten som markdown« giver kun mening, naar man allerede har sagt
 * markdown, og i den rige raekke ville den vaere en tredje ting at forstaa.
 *
 * Den samme flade findes i forvejen som en indstilling (`editWhole`, »et
 * klik aabner hele noten«). Forskellen er varigheden: indstillingen gaelder
 * hver note, hver dag - knappen gaelder den note, man staar i nu.
 */
function helNoteKnapHtml() {
  const hel = !!editor.raaNote;
  const navn = hel ? 'Back to this paragraph' : 'Edit the whole note as Markdown';
  return `<button type="button" class="vt-knap vt-tekst vt-hel" data-helnote="1" tabindex="-1"
      aria-pressed="${hel}" title="${navn}" aria-label="${navn}">Whole note</button>`;
}

/**
 * Raekken over blokken. `rigt` er visningen; `medMd` er, om der ER en vej
 * tilbage til den formaterede tekst - en tabel har ingen.
 */
function vaerktoejslinjeHtml(rigt, medMd = true) {
  // I markdown er der kun vejen tilbage og omfanget. En fed-knap, der ikke
  // kunne goere noget, ville vaere en knap, der loej.
  /*
   * I markdown staar de SAMME knapper - de skriver bare markdown om det
   * markerede (`raaOmslut`). Foer stod her kun MD og »Whole note« med
   * begrundelsen, at en fed-knap ingenting kunne i raa tekst. Paa en telefon
   * er det forkert: `**` er langt vaek paa tastaturet, og en tabel, en
   * kodeblok og hele noten som markdown er alle raa (Andreas, 2026-09-25:
   * »hjaelpemenuen dukker ikke altid op paa mobil, saa man kan lave tekst
   * fed«).
   */
  if (!rigt) {
    return `<div class="blok-vaerktoej" id="blokVaerktoej">
    <button type="button" class="vt-knap" data-fil="1" tabindex="-1"
      title="Add an image or a file" aria-label="Add an image or a file">${icon('klips', 15)}</button>
    <span class="vt-skel" aria-hidden="true"></span>
    ${RAA_VAERKTOEJER.map((v) => `
    <button type="button" class="vt-knap${v.tekst ? ' vt-tekst' : ''}" data-raagoer="${v.goer}" tabindex="-1"
      title="${esc(v.navn)}" aria-label="${esc(v.navn)}">${v.vis}</button>`).join('')}
    <span class="vt-skel" aria-hidden="true"></span>
    ${DATOKNAPPER.map((o) => {
    const g = TEKSTGENVEJE.find((x) => x.ord === o.ord);
    return g ? `<button type="button" class="vt-knap vt-tekst" data-genvej="${g.ord}" tabindex="-1"
      title="${esc(g.navn)} (${esc(g.ord)})" aria-label="${esc(g.navn)}">${o.vis}</button>` : '';
  }).join('')}
    ${medMd ? mdKnapHtml(false) : ''}${helNoteKnapHtml()}</div>`;
  }
  const genvej = (o) => {
    const g = TEKSTGENVEJE.find((x) => x.ord === o.ord);
    return g ? `<button type="button" class="vt-knap vt-tekst" data-genvej="${g.ord}"
      tabindex="-1" title="${esc(g.navn)} (${esc(g.ord)}) — ${esc(g.eksempel)}"
      aria-label="${esc(g.navn)}">${o.vis}</button>` : '';
  };
  /*
   * Vedhaeft staar FOERST.
   *
   * Paa en telefon er det den vigtigste knap i raekken - og stod den sidst,
   * lagde den sig ind under hjaelpeknappen, som ligger absolut i hoejre
   * hjoerne (maalt paa 420 px: to px overlap, selv med margen). Den vigtigste
   * knap skal ikke vaere den, der bliver klemt.
   */
  return `<div class="blok-vaerktoej" id="blokVaerktoej">
    <button type="button" class="vt-knap" data-fil="1" tabindex="-1"
      title="Add an image or a file" aria-label="Add an image or a file">${icon('klips', 15)}</button>
    <span class="vt-skel" aria-hidden="true"></span>
    ${VAERKTOEJER.map((v) => `
    <button type="button" class="vt-knap" data-goer="${v.goer}" tabindex="-1"
      title="${esc(v.navn)}${v.tast ? ` (${v.tast})` : ''}"
      aria-label="${esc(v.navn)}">${v.vis}</button>`).join('')}
    <button type="button" class="vt-knap" data-blokform="tjekliste" tabindex="-1"
      title="Checklist" aria-label="Checklist">${icon('tjekboks', 15)}</button>
    <span class="vt-skel" aria-hidden="true"></span>
    ${DATOKNAPPER.map(genvej).join('')}
    ${mdKnapHtml(true)}</div>`;
}

/**
 * Er markoeren allerede inde i `tag` - og hvor?
 *
 * Bruges baade til at slaa fra igen og til at vise knappen som trykket ned.
 */
/**
 * Er HELE markeringen inde i `tag`?
 *
 * `commonAncestorContainer` og ikke `startContainer`: med `startContainer`
 * spurgte vi kun, om markeringen BEGYNDTE inde i tag'et. En markering fra
 * »alfa« ind i et fedt »beta« svarede derfor nej og blev pakket ind én gang
 * til - resultatet var `**alfa **beta******** gamma`, som hverken kunne
 * laeses eller fortrydes (meldt af Andreas 2026-09-05).
 */
function omsluttendeTag(vaert, tag) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  let n = sel.getRangeAt(0).commonAncestorContainer;
  while (n && n !== vaert) {
    if (n.nodeType === 1 && n.tagName.toLowerCase() === tag) return n;
    n = n.parentNode;
  }
  return null;
}

/** Elementet vaek, indholdet bliver staaende paa dets plads. */
function pakUd(el) {
  const foraeldre = el.parentNode;
  if (!foraeldre) return;
  while (el.firstChild) foraeldre.insertBefore(el.firstChild, el);
  foraeldre.removeChild(el);
}

/** Pak markeringen ind i `tag` - eller pak den ud igen, hvis den allerede er det. */
function omslut(vaert, tag) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const alt = omsluttendeTag(vaert, tag);
  if (alt) { pakUd(alt); return; }

  const r = sel.getRangeAt(0);
  const el = document.createElement(tag);
  /*
   * Intet markeret: knappen gaelder det, man skriver HEREFTER.
   *
   * Foer gjorde den ingenting, og saa kunne man vaelge fed, skrive - og faa
   * almindelig tekst (meldt af Andreas 2026-09-05). Men det er netop den vej,
   * man bruger en vaerktoejslinje: vaelg fed, skriv ordet. Et tomt element med
   * markoeren indeni giver praecis det. Tomme rester ryddes i `gemRigBlok()`.
   */
  if (r.collapsed) {
    r.insertNode(el);
    const inde = document.createRange();
    inde.setStart(el, 0);
    inde.collapse(true);
    sel.removeAllRanges();
    sel.addRange(inde);
    return;
  }

  el.appendChild(r.extractContents());
  // Det SAMME tag inde i det nye ville give `**alfa **beta****`. Markeringen
  // kan sagtens have taget et fedt stykke med; det skal bare vaere ÉT lag.
  el.querySelectorAll(tag).forEach(pakUd);
  r.insertNode(el);
  // Markeringen skal blive staaende paa det, man lige formaterede.
  const ny = document.createRange();
  ny.selectNodeContents(el);
  sel.removeAllRanges();
  sel.addRange(ny);
}

/*
 * Live-formatering: taster man det tegn, der LUKKER en konstruktion, bliver
 * den til formatering med det samme.
 *
 * Det sker som en maalrettet erstatning ved markoeren - ikke som en
 * gentegning af blokken. En gentegning ville flytte markoeren, og saa kunne
 * man ikke skrive videre.
 *
 * `md`-feltet er det tegn, kilden brugte: `_kursiv_` skal komme tilbage som
 * `_kursiv_`, ikke som `*kursiv*` (§38).
 */
const LIVE = [
  { re: /\*\*([^*\n]+)\*\*$/, tag: 'strong', foran: '*' },
  { re: /__([^_\n]+)__$/, tag: 'strong', foran: '_', md: '_' },
  { re: /\*([^*\n]+)\*$/, tag: 'em', foran: '*' },
  { re: /_([^_\n]+)_$/, tag: 'em', foran: '_', md: '_' },
  { re: /`([^`\n]+)`$/, tag: 'code', foran: '`' },
];

/** Erstat teksten lige foer markoeren med noget andet. Markoeren ender efter. */
function byttVedMarkoer(knude, start, slut, tekst) {
  const sel = window.getSelection();
  const r = document.createRange();
  r.setStart(knude, start);
  r.setEnd(knude, slut);
  r.deleteContents();
  const t = document.createTextNode(tekst);
  r.insertNode(t);
  const efter = document.createRange();
  efter.setStartAfter(t);
  efter.collapse(true);
  sel.removeAllRanges();
  sel.addRange(efter);
  return t;
}

/*
 * Skriv tekst ind, hvor markoeren staar - uanset HVAD den staar i.
 *
 * `markoerTekst()` nedenfor kraever en tekstknude, fordi den skal laese
 * BAGLAENS efter en genvej. En knap skal ikke: den skal virke, ogsaa naar
 * markoeren staar paa en elementgraense - fx lige efter et fedt ord, hvor
 * `anchorNode` er `<p>`'et og ikke tekst. Foerste udgave brugte
 * `markoerTekst()` til begge, og saa gjorde dato-knapperne ingenting dér.
 */
function indsaetVedMarkoer(vaert, tekst) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !vaert.contains(sel.anchorNode)) return false;
  const r = sel.getRangeAt(0);
  /*
   * Staar markoeren paa SELVE feltet - altsaa uden for afsnittet - ville et
   * indsat tekstnode blive en blok for sig, og knappen lavede et nyt afsnit
   * i stedet for at skrive datoen dér, hvor man stod. Flyt ind i det sidste
   * element i stedet.
   */
  if (r.startContainer === vaert) {
    const sidste = vaert.lastElementChild;
    if (sidste) {
      r.selectNodeContents(sidste);
      r.collapse(false);
    }
  }
  r.deleteContents();
  const t = document.createTextNode(tekst);
  r.insertNode(t);
  const efter = document.createRange();
  efter.setStartAfter(t);
  efter.collapse(true);
  sel.removeAllRanges();
  sel.addRange(efter);
  return true;
}

/** Tekstknuden og forskydningen ved markoeren - eller null. */
function markoerTekst(vaert) {
  const sel = window.getSelection();
  if (!sel || !sel.isCollapsed || !sel.rangeCount) return null;
  const knude = sel.anchorNode;
  if (!knude || knude.nodeType !== 3 || !vaert.contains(knude)) return null;
  return { knude, pos: sel.anchorOffset };
}

/*
 * `/dmy`, `/hhmm` og `/now` i den RIGE blok (F31).
 *
 * De har virket i det raa felt siden F27, men `byttedeTekstgenvej()` er
 * skrevet til et `<textarea>` (`setRangeText`), og den rige blok fik den
 * aldrig. »Nu hvor min /now m.m. ikke virker« - Andreas, 2026-09-05. Samme
 * bord, samme regler; kun udskiftningen er en anden.
 */
function rigTekstgenvej(vaert) {
  const m = markoerTekst(vaert);
  if (!m) return false;
  const foer = m.knude.data.slice(0, m.pos);
  for (const g of TEKSTGENVEJE) {
    if (!foer.endsWith(g.ord)) continue;
    // Kun ved linjestart eller efter et mellemrum - ellers rammer den midt i
    // et ord som `og/dmy`. Samme regel som i det raa felt.
    const tegnFoer = foer[foer.length - g.ord.length - 1];
    if (tegnFoer !== undefined && !/\s/.test(tegnFoer)) continue;
    byttVedMarkoer(m.knude, m.pos - g.ord.length, m.pos, g.lav(new Date()));
    return true;
  }
  return false;
}

/*
 * `[[note-titel]]`-forslagene i den rige blok (F31).
 *
 * Panelet, soegningen og tasterne findes allerede (p6_blokke) - de er bare
 * skrevet til et `<textarea>`. I stedet for en kopi faar de en ADAPTER, der
 * ser ud som et felt, men arbejder paa tekstknuden ved markoeren. Saa er der
 * ét sted, der bestemmer, hvordan forslagene opfoerer sig - og den dag nogen
 * retter dem, gaelder rettelsen begge editorer.
 */
function wikiAdapter(vaert, b) {
  const m = markoerTekst(vaert);
  if (!m) return null;
  const knude = m.knude;
  return {
    get value() { return knude.data; },
    set value(v) { knude.data = v; },
    selectionStart: m.pos,
    setSelectionRange(pos) {
      const sel = window.getSelection();
      const r = document.createRange();
      r.setStart(knude, Math.min(pos, knude.data.length));
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    },
    // Panelet indsaettes ved SIDEN AF feltet - ikke inde i det. Ellers ville
    // forslagene blive en del af den tekst, man er ved at skrive.
    get parentNode() { return vaert.parentNode; },
    get nextSibling() { return vaert.nextSibling; },
    dispatchEvent() { gemRigBlok(vaert, b); },
    focus() { vaert.focus(); },
  };
}

function liveFormatering(vaert) {
  const sel = window.getSelection();
  if (!sel || !sel.isCollapsed || !sel.rangeCount) return false;
  const knude = sel.anchorNode;
  // Kun i ren tekst. Staar markoeren i et element, er der ikke en tekst at
  // laese baglaens i - og saa er der heller ikke tastet et lukketegn.
  if (!knude || knude.nodeType !== 3 || !vaert.contains(knude)) return false;
  const foer = knude.data.slice(0, sel.anchorOffset);

  for (const m of LIVE) {
    const t = m.re.exec(foer);
    if (!t || !t[1].trim()) continue;
    const start = sel.anchorOffset - t[0].length;
    /*
     * Tegnet FOER maa ikke vaere det samme.
     *
     * Ellers spiser den enkelte stjerne den dobbelte: `**fed**` ville blive
     * fanget af `*...*`-reglen med `*fed*` som indhold. Det er samme regel,
     * rendereren har (»** foer *«), bare set fra den anden side.
     */
    if (start > 0 && knude.data[start - 1] === m.foran) continue;

    const r = document.createRange();
    r.setStart(knude, start);
    r.setEnd(knude, sel.anchorOffset);
    r.deleteContents();
    const el = document.createElement(m.tag);
    if (m.md) el.setAttribute('data-md', m.md);
    el.textContent = t[1];
    r.insertNode(el);

    // Markoeren UD paa den anden side af det nye element - man er faerdig med
    // at skrive fed, naar man har tastet den sidste stjerne.
    const efter = document.createRange();
    efter.setStartAfter(el);
    efter.collapse(true);
    sel.removeAllRanges();
    sel.addRange(efter);
    return true;
  }
  return false;
}

/**
 * Indsaet: fremmed HTML renses gennem den SAMME vej tilbage til markdown.
 *
 * Andreas bad om rensning (2026-09-05). Den behoever ingen egen sanitizer:
 * `tilMarkdown()` kender de tags, Sagu selv udsender, og folder alt andet ud
 * som ren tekst - saa et Word-indsaet bliver til markdown i stedet for
 * `<span style>`-suppe. Én mekanisme, to formaal; to ville kunne drive fra
 * hinanden.
 */
/*
 * Filer ind i den AABNE blok - fra indsaet, fra et traek, eller fra
 * vedhaeft-knappen. Ét sted, saa de tre veje ikke kan komme til at goere
 * hver sit.
 */
async function indsaetFilerIBlok(filer, vaert, b) {
  let lagt = 0;
  for (const f of filer.slice(0, 20)) {
    const fil = await indsaetFil(f, null);
    if (!fil || !fil.markdown) continue;
    indsaetVedMarkoer(vaert, fil.markdown);
    lagt += 1;
  }
  if (!lagt) return;
  if (vaert && vaert === dok.el) { dokTegnOmVedMarkoer(); return; }
  gemRigBlok(vaert, b);
  /*
   * Gentegn, saa billedet kan SES.
   *
   * Uden det stod der `![foto.png](sagu:...)` som raa tekst i en blok, hvis
   * hele pointe er, at man ser noten, mens man skriver i den. Markoeren ryger
   * til slutningen - det er prisen, og den er lille, naar man lige har lagt
   * et billede ind.
   */
  tegnKrop();
}

/*
 * Hvad et indsaet skal skrive: HTML'en oversat - eller den bare tekst.
 *
 * Reglen i oversaetteren er, at et ukendt tag koster sin formatering, aldrig
 * sine ord. Den kan kun holde, saa laenge oversaetteren forstaar formen -
 * gjorde den ikke det, faldt HELE indsaettet paa gulvet i tavshed, og det
 * saa ud, som om ⌘V ikke virkede (Andreas, 2026-09-07: »kun et problem paa
 * min mac, paa pc virker det fint« - se `TOM` i redigering.js).
 *
 * Den fejl er rettet dér, hvor den var. Det her er vaernet mod den naeste,
 * for udklipsholderens HTML kommer fra fremmede programmer og har ingen
 * ende: en ren tekst i noten er et lille tab, et tomt indsaet er et helt.
 */
function indsatMarkdown(html, flad) {
  const ren = html ? saguRedigering.tilMarkdown(html) : flad;
  return String(ren || '').trim() ? ren : (flad || '');
}

async function indsaetRent(e, vaert, b) {
  const dt = e.clipboardData || e.dataTransfer;
  if (!dt) return;

  /*
   * FILER foerst - billeder, der indsaettes eller traekkes ind (F32).
   *
   * Det raa felt har kunnet det siden F4; den rige blok fik det aldrig, saa
   * »jeg kan ikke tilfoeje et billede via min iPhone« (Andreas, 2026-09-06).
   * Paa en telefon er indsaet den ENESTE vej - man kan ikke traekke en fil,
   * og en menu er langt vaek, naar tastaturet fylder halvdelen af skaermen.
   *
   * `indsaetFil()` bygger markdownen; vi laeser den bare tilbage. To steder
   * at bygge `![...]` mod `[...]` ville kunne drive fra hinanden.
   */
  logIndsaet(dt, 'dokument');
  const filer = [...(dt.files || [])];
  /*
   * Et billede kopieret FRA Sagu har baade selve billedet og HTML'en med
   * `data-md="sagu:<id>"` (se `kopierBilledeUdklip`). Saa er det HTML'en,
   * der gaelder: det samme billede, ikke en ny fil med en kopi af det.
   */
  const egetBillede = /data-md="sagu:[a-f0-9]{32}"/.test(dt.getData('text/html') || '');
  if (filer.length && !egetBillede) {
    e.preventDefault();
    await indsaetFilerIBlok(filer, vaert, b);
    return;
  }

  e.preventDefault();
  // Alt laeses FOER det foerste `await`: udklipsholderen kan kun laeses,
  // mens haendelsen staar paa - bagefter giver `getData` tomme strenge.
  const raaHtml = dt.getData('text/html');
  const flad = dt.getData('text/plain');
  // `data:`-billeder (OneNote, Word, Sagus egen kopi uden en fil ved siden
  // af) bliver til rigtige filer, foer HTML'en oversaettes - se p6.
  const html = await dataBillederTilSagu(raaHtml);
  const ren = indsatMarkdown(html, flad);
  // Markdown indsaettes som TEKST og formateres af live-reglerne bagefter -
  // saa er der kun ét sted, der laver formatering.
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const r = sel.getRangeAt(0);
  r.deleteContents();
  const t = document.createTextNode(String(ren || '').replace(/\r\n?/g, '\n'));
  r.insertNode(t);
  const efter = document.createRange();
  efter.setStartAfter(t);
  efter.collapse(true);
  sel.removeAllRanges();
  sel.addRange(efter);
  /*
   * I dokumentet tegnes det indsatte, saa det ser ud som det, det er: tre
   * afsnit og en liste, ikke én linje med stjerner og havelaager. Ren tekst
   * paa én linje lades i fred - saa virker ⌘Z paa den som paa alt andet.
   */
  if (vaert && vaert === dok.el) {
    if (/\n|[*_`#[\]!>~|]/.test(String(ren || ''))) dokTegnOmVedMarkoer();
    else dokTvingSkriv();
    return;
  }
  gemRigBlok(vaert, b);
}

/*
 * Tomme formaterings-elementer ryddes, FOER blokken skrives tilbage.
 *
 * `omslut()` laegger et tomt `<strong>` ved markoeren, naar man vaelger fed
 * uden at have markeret noget. Skriver man, fyldes det. Klikker man i stedet
 * et andet sted hen, ville resten blive til `****` i noten - fire stjerner,
 * ingen har skrevet. Browseren efterlader desuden selv tomme elementer, naar
 * man sletter hen over dem.
 *
 * Elementet med MARKOEREN i fredes: det er ikke en rest, det er dér, man er
 * ved at skrive.
 */
const TOMME_RYDDES = 'strong, em, u, code, del';

function rydTomme(vaert) {
  const sel = window.getSelection();
  const hvor = sel && sel.rangeCount ? sel.getRangeAt(0).commonAncestorContainer : null;
  vaert.querySelectorAll(TOMME_RYDDES).forEach((el) => {
    if (el.textContent !== '' || el.querySelector('img')) return;
    if (hvor && (el === hvor || el.contains(hvor))) return;
    el.remove();
  });
}

/*
 * Enter og ⌘/Ctrl+Enter i den rige blok (F32).
 *
 * »Kan du lave saa den kun laver et nyt afsnit hvis man benytter command +
 * enter? Hvis man bare bruger enter saa bliver det i samme afsnit?«
 * (Andreas, 2026-09-05).
 *
 * Browserens egen opfoersel er den modsatte: Enter laver et nyt afsnit,
 * Shift+Enter et blødt linjeskift. Vi vender den om, saa den mest brugte
 * tast goer det mest almindelige - at skrive videre paa naeste linje i det
 * samme afsnit.
 *
 * `execCommand` er markeret som udgaaet, men er stadig den eneste vej til
 * browserens EGEN haandtering af de to slags linjeskift - inklusive dens
 * fortrydelseshistorik. En haandlavet udgave ville skulle vedligeholde den
 * selv. Derfor bruges den, og derfor er der en reserve nedenunder.
 */
function nytLinjeskift(vaert, nytAfsnit) {
  const kommando = nytAfsnit ? 'insertParagraph' : 'insertLineBreak';
  try {
    if (document.execCommand(kommando)) return true;
  } catch { /* faldet igennem - se reserven */ }
  /*
   * Reserven daekker kun det bloede linjeskift; et nyt afsnit uden
   * `execCommand` ville kraeve, at vi selv delte elementet, og et halvt delt
   * afsnit er vaerre end ingenting. Kan browseren ikke kommandoen, faar man
   * et linjeskift - og markdown gør resten, naar blokken skrives tilbage.
   */
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return false;
  const r = sel.getRangeAt(0);
  r.deleteContents();
  const br = document.createElement('br');
  r.insertNode(br);
  const efter = document.createRange();
  efter.setStartAfter(br);
  efter.collapse(true);
  sel.removeAllRanges();
  sel.addRange(efter);
  return true;
}

/*
 * Er feltet tomt? Klassen styrer pladsholderen.
 *
 * CSS kan ikke spoerge, om et element har tekst i sig - se `.rig-felt.tom` i
 * style.css for hele historien. `textContent` kan, og den ser hverken `<br>`
 * eller tomme elementer som indhold.
 */
function maerkTomt(vaert) {
  vaert.classList.toggle('tom', !vaert.textContent.trim());
}

/** Blokkens HTML tilbage til markdown og ind i noten. */
function gemRigBlok(vaert, b) {
  // I dokumentet (v85) er det observatoeren, der ved, hvad der er roert.
  if (vaert && vaert === dok.el) { rydTomme(vaert); dokTvingSkriv(); return; }
  rydTomme(vaert);
  maerkTomt(vaert);
  const md = saguRedigering.tilMarkdown(vaert.innerHTML);
  skrivBlokTilbage(md, b);
}

/*
 * Feltet bliver staaende i syne, mens siden faar sin endelige hoejde.
 *
 * Billedernes plads er sat af paa forhaand for alt, vi har set foer
 * (`billedMaal` i p6) - men et billede, man ALDRIG har rullet ned til, er
 * ikke hentet endnu, og med `loading="lazy"` bliver det foerst hentet nu.
 * Naar det saa lander, vokser alt over feltet, og feltet skubbes ud under
 * kanten, mens man skriver i det.
 *
 * Derfor: hver gang et billede, der ikke var inde, bliver faerdigt, hentes
 * feltet tilbage i syne. `block: 'nearest'` goer INTET, naar det allerede
 * staar der - saa den, der ikke havde problemet, maerker ikke noget.
 *
 * To ting stopper den, og begge er den samme regel: den maa aldrig tage
 * roret fra brugeren.
 *
 *   - Ruller man selv, har man taget over. Saa holder vi op.
 *   - Er feltet ikke laengere det, man staar i, er der intet at foelge.
 */
function holdBlokISyne(host) {
  const felt = host.querySelector('.blok-felt');
  if (!felt) return;
  const venter = [...host.querySelectorAll('img')].filter((b) => !b.complete);
  if (!venter.length) return;

  let egenRulning = false;
  const stop = () => { egenRulning = true; };
  window.addEventListener('wheel', stop, { once: true, passive: true });
  window.addEventListener('touchmove', stop, { once: true, passive: true });

  const hentTilbage = () => {
    if (egenRulning || !felt.isConnected || document.activeElement !== felt) return;
    felt.scrollIntoView({ block: 'nearest' });
  };
  for (const b of venter) {
    b.addEventListener('load', hentTilbage, { once: true });
    b.addEventListener('error', hentTilbage, { once: true });
  }
}

/*
 * Blokken bliver en tjekliste - eller holder op med at vaere det (F33).
 *
 * »Kan du tilfoeje checklist til skrive menuen foer Date?« (Andreas,
 * 2026-09-07).
 *
 * Knappen arbejder paa MARKDOWNEN, ikke paa den viste HTML. Den kunne have
 * pakket linjerne ind i `<li class="tjek">` og ladet oversaetteren om
 * resten, men saa ville der vaere to steder, der bestemte, hvordan en
 * tjekliste ser ud - og de to ville drive fra hinanden. Markdown er
 * sandheden i databasen; saa er markdown ogsaa dét, knappen skriver.
 *
 * ── Én linje, ét punkt ────────────────────────────────────────────────────
 *
 * Alle linjer i blokken bliver til punkter, og en linje, der allerede baerer
 * et maerke - et bullet, et nummer, en overskrift, et citattegn - lægger det
 * fra sig foerst. Ellers ville et punkt hedde »## Onsdag« med to synlige
 * havelaager, fordi en overskrift inde i et listepunkt ikke er en
 * overskrift.
 *
 * Er ALLE linjer allerede tjekpunkter, tager knappen dem af igen. En knap,
 * der kun kan én vej, er en knap, man ikke toer trykke paa.
 */
const TJEK_LINJE = /^(\s*)[-*+]\s+\[[ xX]\]\s+/;
const BLOKMAERKE = /^(\s*)(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)?/;

function skiftTjekliste(vaert, b) {
  // Skriv blokken tilbage foerst: saa passer `b.til`, og der er kun ét sted,
  // der oversaetter HTML til markdown.
  gemRigBlok(vaert, b);
  // I dokumentet er blokken den, markoeren staar i.
  if (vaert && vaert === dok.el) b = dokBlokVedMarkoer();
  if (!b) return;
  const linjer = editor.note.body.split('\n').slice(b.fra, b.til + 1);
  const fyldte = linjer.filter((l) => l.trim());
  const alle = fyldte.length > 0 && fyldte.every((l) => TJEK_LINJE.test(l));

  const ny = linjer.map((l) => {
    if (!l.trim()) return l;
    if (alle) return l.replace(TJEK_LINJE, '$1');
    /*
     * Et punkt, der ALLEREDE er et tjekpunkt, maa ikke faa en boks til.
     *
     * `BLOKMAERKE` tager bullet'et og efterlader `[ ]` som almindelige tegn,
     * og linjen blev til »- [ ] [ ] en«. Det sker kun, naar nogle af
     * linjerne er punkter og andre ikke er - altsaa netop i den blok, man er
     * midt i at lave om. Fundet af proeven, ikke af et oeje.
     */
    const uden = TJEK_LINJE.test(l) ? l.replace(TJEK_LINJE, '$1') : l.replace(BLOKMAERKE, '$1');
    const indryk = (uden.match(/^\s*/) || [''])[0];
    return `${indryk}- [ ] ${uden.slice(indryk.length)}`;
  });

  skrivBlokTilbage(ny.join('\n'), b);
  // Blokken skifter SLAGS, og det kan kun ses ved at tegne den igen.
  tegnKrop();
}

/*
 * Code over flere linjer bliver en KODEBLOK, ikke inline-kode.
 *
 * »jeg proevede at lave noget tekst ind og lave det til en kode. men det
 * virkede ikke rigtigt« (Andreas, 2026-09-14). Et PowerShell-script paa
 * tolv linjer blev pakket i ét par backticks. Inline-kode kan ikke gaa over
 * en linje - hverken i markdown eller i `inline()`, der kun finder
 * `[^`\n]+` - saa backtickerne stod der bare som tegn, og scriptet blev
 * vist som almindelig tekst med `__` og `*` klar til at blive formatering.
 *
 * Knappen svarer derfor paa det, man markerede: inden for én linje er det
 * et ord eller en kommando (inline), over flere linjer er det et stykke kode
 * (en blok). Én knap, der goer det rigtige, frem for en knap mere, man skal
 * vide at vaelge.
 *
 * ── Koden er KILDEN - ikke det, den rige blok viste ──────────────────────
 *
 * Foerste udgave tog markeringens tekst (`Selection.toString()`), og i
 * browseren mistede scriptet sin indrykning: HTML viser ikke mellemrum i
 * starten af en linje, saa markeringen har dem heller ikke. `**fed**` blev
 * til »fed«. I kode er begge dele en del af koden. Markdownen er det, man
 * skrev eller indsatte - tegn for tegn - og det er dén, blokken skal have.
 *
 * Den findes ved at saette to maerker i DOM'en, lade den ene oversaetter
 * (`gemRigBlok`) skrive blokken, og skaere ved maerkerne: foer, kode, efter.
 */
const KODE_START = '\uE000';
const KODE_SLUT = '\uE001';

function markeringOverFlereLinjer() {
  const sel = window.getSelection();
  return !!(sel && sel.rangeCount && !sel.isCollapsed && sel.toString().replace(/\n+$/, '').includes('\n'));
}

/** Ren tekst ind, ren tekst ud: blokkens nye markdown. */
function kodeblokMarkdown(foer, kode, efter) {
  // Tomme linjer i kanterne vaek, men ikke mellemrummene foran foerste
  // linje: de er indrykning.
  const krop = String(kode).replace(/\r\n?/g, '\n').replace(/^[ \t]*\n+/, '').replace(/\s+$/, '');
  const dele = [];
  if (String(foer).trim()) dele.push(String(foer).replace(/\s+$/, ''));
  dele.push(`\`\`\`\n${krop}\n\`\`\``);
  if (String(efter).trim()) dele.push(String(efter).replace(/^\s+/, ''));
  // Tomme linjer omkring: kodeblokken er sin egen blok, og teksten omkring
  // den bliver de afsnit, den var.
  return dele.join('\n\n');
}

function lavKodeblok(vaert, b) {
  const sel = window.getSelection();
  const r = sel.getRangeAt(0);
  const slut = r.cloneRange();
  slut.collapse(false);
  slut.insertNode(document.createTextNode(KODE_SLUT));
  r.insertNode(document.createTextNode(KODE_START));

  gemRigBlok(vaert, b);
  // I dokumentet kan markeringen gaa over flere blokke: dem alle.
  if (vaert && vaert === dok.el) b = dokBlokMed(KODE_START, KODE_SLUT);
  if (!b) return;
  const md = editor.note.body.split('\n').slice(b.fra, b.til + 1).join('\n');
  const i = md.indexOf(KODE_START);
  const j = md.indexOf(KODE_SLUT);
  const rens = (s) => s.split(KODE_START).join('').split(KODE_SLUT).join('');
  if (i < 0 || j < i) {
    // Maerkerne kom ikke igennem oversaetteren. Saa hellere intet end en
    // halv blok: tag dem ud igen og lad teksten staa, som den stod.
    skrivBlokTilbage(rens(md), b);
    lukBlok();
    return;
  }
  skrivBlokTilbage(kodeblokMarkdown(rens(md.slice(0, i)), rens(md.slice(i + 1, j)),
    rens(md.slice(j + 1))), b);
  // Blokken skifter SLAGS og bliver til flere. Luk den, saa noten tegnes af
  // den nye markdown - `lukBlok` skriver ikke DOM'en tilbage, saa maerkerne
  // kan ikke komme med ud.
  lukBlok();
}

/*
 * MD-knappen. Ét sted, fordi den findes baade i den rige og i den raa blok.
 *
 * `mousedown` med preventDefault og ikke `click`: et klik ville tage fokus
 * fra feltet, og `blur` lukker blokken - saa var man ude af det, man skrev
 * i, i stedet for at se det som markdown. Samme greb som resten af raekken.
 */
/*
 * Er fokus stadig INDE i den blok, man skriver i?
 *
 * ÉT sted, fordi der er tre ting at staa i: det rige felt, det raa felt og
 * vaerktoejslinjen. Reglen stod to steder - én gang ved hvert felt - og hver
 * af dem kendte kun sit eget: den rige blok regnede `blokFelt` for »uden
 * for noten«.
 *
 * Det gik godt, saa laenge man ikke kunne skifte felt uden at lukke
 * blokken. Fra F33 kan man - MD-knappen goer netop det - og saa lukkede
 * blokken i stedet for at skifte visning (maalt i browseren, 2026-09-07).
 * To rigtige regler, der ikke vidste om hinanden; nu er der én.
 */
function fokusErIBlokken() {
  const a = document.activeElement;
  if (!a) return false;
  return a.id === 'blokRigt' || a.id === 'blokFelt'
    || (typeof a.closest === 'function' && !!a.closest('#blokVaerktoej'));
}

/**
 * Hvilken blok staar markoeren i - i det RAA felt?
 *
 * Bruges, naar man forlader hele-noten-visningen: man skal lande i det
 * afsnit, man stod i, ikke i toppen af en note paa hundrede afsnit. Det er
 * samme regel som den anden vej (`tegnHeleNoten` saetter markoeren ved
 * `aabenBlok`), og uden den ville de to knapper vaere en rundtur, hvor man
 * mister sin plads hver gang.
 */
function blokVedMarkoer(felt) {
  if (!felt || typeof felt.selectionStart !== 'number') return editor.aabenBlok;
  const foer = felt.value.slice(0, felt.selectionStart);
  const linje = foer.split('\n').length - 1;
  const b = saguMarkdown.blokke(felt.value).find((x) => x.fra <= linje && x.til >= linje);
  // Ingen blok: markoeren staar paa en tom linje. DEN linje er saa maalet -
  // `tegnMedAabenBlok` tager en tom linje som en tom blok.
  return b ? b.fra : linje;
}

/*
 * De to knapper i markdown-raekken - og hvorfor de er to.
 *
 * MD er FORMEN: markdown eller den formaterede tekst. »Whole note« er
 * OMFANGET: denne blok eller hele noten. De to spoergsmaal er uafhaengige,
 * saa de faar hver sin knap frem for tre tilstande paa én - en knap, der
 * skifter mellem tre ting, kan man ikke se sig til.
 *
 * MD slukker BEGGE: vejen ud af markdown er ud, uanset hvor meget af noten
 * man havde fremme. Ellers ville man skulle trykke to gange for at komme
 * tilbage til det, man saa foer.
 */
/**
 * Hvilken visning giver et tryk paa `knap` - regnet ud, ikke gættet.
 *
 * De to knapper er to spoergsmaal: MD er FORMEN (markdown eller den
 * formaterede tekst), »Whole note« er OMFANGET (denne blok eller hele
 * noten). Skiftene er den eneste rigtige logik i F34, saa de bor i en ren
 * funktion, der kan proeves - resten er DOM.
 *
 * MD slukker BEGGE: vejen ud af markdown er ud, uanset hvor meget af noten
 * man havde fremme. Ellers skulle man trykke to gange for at komme tilbage
 * til det, man saa foer.
 */
function naesteVisning(nu, knap) {
  if (knap === 'md') {
    const iMarkdown = !!(nu.raaBlok || nu.raaNote);
    return { raaBlok: !iMarkdown, raaNote: false };
  }
  const raaNote = !nu.raaNote;
  // Slaar man hele noten FRA, er man stadig i markdown - bare paa blokken.
  return { raaBlok: !raaNote, raaNote };
}

function bindMdKnap() {
  const rk = document.querySelector('#blokVaerktoej [data-raa]');
  const hk = document.querySelector('#blokVaerktoej [data-helnote]');
  const felt = () => document.getElementById('blokFelt');
  /*
   * Der er intet at gemme foerst. Den rige blok skriver sig tilbage til
   * noten ved hvert eneste tastetryk (`gemRigBlok` paa `input`), og det raa
   * felt goer det samme - saa `editor.note.body` ER det, der staar paa
   * skaermen, og optegningen kan ske paa stedet.
   */
  const bind = (k, goer) => {
    if (!k) return;
    k.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Hvor man STOD, laeses foer optegningen - bagefter findes feltet ikke.
      const staaende = editor.raaNote ? blokVedMarkoer(felt()) : editor.aabenBlok;
      goer();
      editor.aabenBlok = staaende;
      tegnKrop();
    });
  };
  bind(rk, () => Object.assign(editor, naesteVisning(editor, 'md')));
  bind(hk, () => Object.assign(editor, naesteVisning(editor, 'helnote')));
}

function bindRigBlok(vaert, b) {
  vaert.focus();
  // Markoeren i slutningen - eller i begyndelsen, hvis man kom hertil med
  // pil ned. Samme regel som det raa felt.
  const sel = window.getSelection();
  const r = document.createRange();
  r.selectNodeContents(vaert);
  r.collapse(editor.markoerTil !== 'start' ? false : true);
  editor.markoerTil = null;
  sel.removeAllRanges();
  sel.addRange(r);

  vaert.addEventListener('input', () => {
    // Genvejene FOERST: `/now` skal blive til en dato, foer live-reglerne
    // kigger paa den, ellers kunne et `*` i formatet blive til kursiv.
    rigTekstgenvej(vaert);
    liveFormatering(vaert);
    gemRigBlok(vaert, b);
    const a = wikiAdapter(vaert, b);
    if (a) opdaterWikiForslag(a); else lukWikiForslag();
  });

  vaert.addEventListener('paste', (e) => indsaetRent(e, vaert, b));
  // Traek-og-slip af en fil ind i blokken - samme vej som indsaet.
  vaert.addEventListener('dragover', (e) => { e.preventDefault(); vaert.classList.add('traekker'); });
  vaert.addEventListener('dragleave', () => vaert.classList.remove('traekker'));
  vaert.addEventListener('drop', (e) => {
    e.preventDefault();
    vaert.classList.remove('traekker');
    indsaetRent(e, vaert, b);
  });

  vaert.addEventListener('keydown', (e) => {
    // Forslagslisten faar tasterne FOERST, naar den er aaben - ellers lukker
    // Escape hele blokken i stedet for kun listen.
    if (wikiTast(e)) return;
    if (e.key === 'Escape') { e.preventDefault(); lukBlok(); return; }
    /*
     * Enter bliver i afsnittet; ⌘/Ctrl+Enter laver et nyt.
     *
     * ⌘+Enter LUKKEDE blokken foer. Den vej er ikke vaek - Escape lukker, og
     * det goer et klik uden for feltet ogsaa - men det er en vane, der
     * skifter, og derfor staar den skrevet her og i »How to write«.
     */
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (nytLinjeskift(vaert, e.metaKey || e.ctrlKey)) gemRigBlok(vaert, b);
      maerkTomt(vaert);
      return;
    }
    if ((e.metaKey || e.ctrlKey) && !e.altKey) {
      const t = { b: 'strong', i: 'em', u: 'u' }[e.key.toLowerCase()];
      if (t) {
        e.preventDefault();
        omslut(vaert, t);
        gemRigBlok(vaert, b);
      }
    }
  });

  vaert.addEventListener('blur', () => {
    setTimeout(() => {
      if (fokusErIBlokken()) return;
      lukWikiForslag();
      lukBlok();
    }, 0);
  });

  const linje = document.getElementById('blokVaerktoej');
  if (linje) {
    /*
     * Vedhaeft-knappen ved BLOKKEN.
     *
     * »Jeg kan ikke tilfoeje et billede via min iPhone« (Andreas, 2026-09-06).
     * Indsaet virker nu - men paa en telefon har man sjaeldent billedet paa
     * udklipsholderen; man vil VAELGE det. Punktet i `...`-menuen kan det, men
     * det laegger filen nederst i noten, og menuen er rullet vaek, naar
     * tastaturet fylder halvdelen af skaermen. Her lander filen dér, hvor
     * markoeren staar.
     */
    const filKnap = linje.querySelector('[data-fil]');
    if (filKnap) {
      filKnap.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
      filKnap.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.multiple = true;
        inp.style.display = 'none';
        document.body.appendChild(inp);
        inp.addEventListener('change', async () => {
          const valgte = [...inp.files];
          inp.remove();
          if (valgte.length) await indsaetFilerIBlok(valgte, vaert, b);
        });
        inp.click();
      });
    }
    linje.querySelectorAll('[data-genvej]').forEach((k) => {
      k.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const g = TEKSTGENVEJE.find((x) => x.ord === k.dataset.genvej);
        if (!g) return;
        if (indsaetVedMarkoer(vaert, g.lav(new Date()))) gemRigBlok(vaert, b);
      });
    });
    const tjekKnap = linje.querySelector('[data-blokform="tjekliste"]');
    if (tjekKnap) {
      tjekKnap.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        skiftTjekliste(vaert, b);
      });
    }
    linje.querySelectorAll('[data-goer]').forEach((k) => {
      // `mousedown` + preventDefault, ikke `click`: et klik ville tage fokus
      // fra teksten, og `blur` lukker blokken - saa var markeringen vaek,
      // foer knappen naaede at virke. Samme greb som hjaelpeknappen.
      k.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (k.dataset.goer === 'code' && markeringOverFlereLinjer()) {
          lavKodeblok(vaert, b);
          return;
        }
        omslut(vaert, k.dataset.goer);
        gemRigBlok(vaert, b);
      });
    });
  }
}

function aabnBlok(fra) {
  // En delt note, jeg kun maa laese, aabner ikke en raa markdown-blok. Uden
  // vagten ville teksten se ud til at kunne rettes (F11).
  if (!maaRette(editor.note)) return;
  // »Vis mig markdown« gjaldt DEN blok, man stod i. En ny blok aabner, som
  // noten ser ud - ellers ville ét tryk paa MD gøre resten af noten raa,
  // uden at nogen bad om det.
  if (fra !== editor.aabenBlok) editor.raaBlok = false;
  // Hele noten er ikke en tilstand, man klikker sig ind i en enkelt blok fra
  // - naar en blok aabnes ved et klik, er omfanget blokken.
  editor.raaNote = false;
  // At begynde at skrive slutter en markering (F36). De to tilstande kan ikke
  // staa sammen: det aabne felt har intet `data-blok` og kan hverken markeres
  // eller slettes af baandet.
  nulstilBlokValg();
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
  // I dokumentet er »begynd at skrive« bare markoeren til sidst.
  if (dokAktiv()) { dokSaetMarkoer('slut'); return; }
  const b = saguMarkdown.blokke(editor.note.body);
  if (!b.length) {
    // Tom note: laeg en tom linje ind, saa der er en blok at aabne.
    editor.note.body = '\n';
    nulstilBlokValg();
    editor.aabenBlok = 0;
    tegnKrop();
    return;
  }
  aabnBlok(b[b.length - 1].fra);
}

/*
 * Tilfoej en blok til sidst i noten (F31).
 *
 * »Hvordan tilfoejer jeg en ny block, naar jeg kun kan klikke ind i en
 * allerede eksisterende tekstblok?« (Andreas, 2026-09-05).
 *
 * Det var et rigtigt hul. Man kunne aabne det, der VAR, og trykke Enter inde
 * i det - men sluttede noten med en kodeblok eller en tabel, blev man
 * afleveret i raa markdown i stedet, og der var ingen vej til en ny linje
 * efter den.
 *
 * Er den sidste blok allerede tom, aabnes DEN frem for at stable tomme
 * afsnit oven paa hinanden: to tryk maa ikke give to tomme afsnit.
 */
function nyBlokTilSidst() {
  if (!maaRette(editor.note)) return;
  const krop = String(editor.note.body || '');
  const linjer = krop.replace(/\s+$/, '').split('\n');
  const tom = linjer.length === 1 && !linjer[0].trim();
  if (tom) {
    editor.note.body = '\n';
    editor.aabenBlok = 0;
    tegnKrop();
    return;
  }
  editor.note.body = `${linjer.join('\n')}\n\n`;
  editor.aabenBlok = linjer.length + 1;
  markerBeskidt();
  tegnKrop();
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

/**
 * Noten som PDF.
 *
 * »Kan du lave en funktion saa man kan lave en pdf af en sagu note. den skal
 * ligge under ... menuen« (Andreas, 2026-08-25).
 *
 * Der er ingen PDF-motor, og der kommer ingen: Sagu har nul pakker, og at
 * skrive en PDF i haanden er skrifttyper, indlejring og sideombrydning - et
 * projekt for sig, som ville kunne mindre end det, browseren allerede kan.
 * Der ER browserens egen »Gem som PDF«, og saa er hele opgaven at give den et
 * ark, der er NOTEN og ikke appen. Det staar i `@media print`.
 *
 * ── De to ting, der skal ske FOER udskriften ──────────────────────────────
 *
 * 1. **Den aabne blok lukkes.** Den er et `<textarea>`, og et tekstfelt
 *    printer som en formular-kasse med rullebjaelke - ikke som den saetning,
 *    der stod der. Man ville faa en PDF med et hul praecis dér, hvor man sidst
 *    havde markoeren.
 *
 * 2. **`document.title` bliver notens navn.** Browseren bruger titlen som
 *    forslag til filnavnet, og »Sagu« paa tolv PDF'er i en mappe er tolv
 *    filer, man skal aabne for at se hvad er hvad (RUNE-ERFARINGER §4,
 *    Beanledger v19). Den gendannes paa `afterprint` - ellers hedder fanen
 *    noten for evigt.
 *
 * `afterprint` fyrer ogsaa, naar man FORTRYDER i dialogen, og det er netop
 * derfor gendannelsen ligger dér og ikke efter `print()`.
 */
function gemSomPdf(n) {
  lukBlok();
  const foer = document.title;
  const navn = (n && n.title ? n.title : 'Untitled').replace(/[\\/:*?"<>|]/g, '-').slice(0, 90);
  document.title = navn;
  const tilbage = () => {
    document.title = foer;
    window.removeEventListener('afterprint', tilbage);
  };
  window.addEventListener('afterprint', tilbage);
  /*
   * Et hak, foer der printes.
   *
   * `lukBlok()` tegner kroppen om, og udskriften skal se den FAERDIGE side -
   * ikke den, der stod der et oejeblik foer. `print()` er synkron og ville
   * ellers naa at fange den halve optegning.
   */
  setTimeout(() => {
    try { window.print(); } catch { toast('The browser would not open the print dialog.'); tilbage(); }
  }, 50);
}

function lukBlok() {
  if (editor.aabenBlok === null) return;
  editor.aabenBlok = null;
  editor.raaBlok = false;
  editor.raaNote = false;
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
    flytTilSeneste(n);
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
    tegnOpdateret();
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
    /*
     * Titlen er et `<textarea>`, der vokser - ikke et `<input>`.
     *
     * Et input er én linje, og en lang titel (»Demoplan: Genesys Admin Tool
     * (v6.1)«) blev skaaret af ved vaerktoejsknapperne, saa man ikke kunne
     * se, hvad noten hed (Andreas, 2026-09-24). Nu bryder den om og skubber
     * teksten ned. Den er stadig ÉN linje i noten: Enter gaar ned i teksten,
     * og et linjeskift i et indsaet bliver et mellemrum.
     */
    tilpasTitel(titel);
    if (window.ResizeObserver) new ResizeObserver(() => tilpasTitel(titel)).observe(titel.parentElement);
    titel.addEventListener('input', () => {
      if (/[\r\n]/.test(titel.value)) {
        const pos = titel.selectionStart;
        titel.value = titel.value.replace(/\s*[\r\n]+\s*/g, ' ');
        titel.setSelectionRange(pos, pos);
      }
      tilpasTitel(titel);
      // En note maa ALDRIG staa uden en titel: den hedder sin titel i traeet,
      // i wikiens adresse og i [[henvisninger]]. Tomt felt = "Untitled",
      // men foerst naar man forlader feltet, saa man kan slette og skrive om.
      n.title = titel.value;
      markerBeskidt();
      opdaterNoteFaneTitel(n.id, titel.value);
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

  /*
   * Pop-ud flyttet op i vaerktoejsraekken (Andreas, 2026-09-05): »saa det er
   * let at trykke paa«. Den staar derfor IKKE laengere i `...`-menuen - to
   * steder til den samme handling er ét for meget, og menuen er i forvejen
   * lang.
   *
   * Handleren skal blive ved med at vaere SYNKRON: `window.open` maa koere i
   * samme hop som klikket, ellers er brugerhandlingen brugt op, og browseren
   * blokerer vinduet.
   */
  const popUd = document.getElementById('popUdBtn');
  if (popUd) popUd.addEventListener('click', () => { if (editor.note) popUdNote(editor.note); });

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
   * Hele noten i udklipsholderen - MED billederne.
   *
   * Knappen kopierede foer ren markdown. »Kan du lave saa den ny copy
   * funktion bliver lagt ved siden af saved i stedet for den nuvaerende...
   * Copy i markdown findes alligevel under show as markdown« (Andreas,
   * 2026-08-25). Den, man som regel vil have, staar nu forrest, og den anden
   * er ikke vaek - den ligger, hvor man ser PAA markdown'en.
   *
   * Menupunktet bag »...« er fjernet i samme omgang. Det stod to centimeter
   * fra ikonet og gjorde det samme.
   *
   * Titlen kommer med som en overskrift, hvis teksten ikke selv har en: en
   * note indsat i en mail uden sit navn er svaer at forstaa. Det goer
   * `noteSomMarkdown()`, som begge veje deler.
   */
  const tilbageKnap = document.getElementById('tilbageBtn');
  if (tilbageKnap) tilbageKnap.addEventListener('click', () => gaaTilbage());

  const kopiKnap = document.getElementById('kopiNote');
  if (kopiKnap) {
    /*
     * Ingen `await` foran `kopierNoten()`. Den opretter sit `ClipboardItem`
     * synkront, fordi Safari kraever det inde i klikket.
     */
    kopiKnap.addEventListener('click', () => {
      if (editor.note) kopierNoten(editor.note);
    });
  }

  document.querySelectorAll('[data-krumme]').forEach((el) => {
    el.addEventListener('click', () => aabnNote(el.dataset.krumme));
  });
  document.querySelectorAll('[data-bogkrumme]').forEach((el) => {
    el.addEventListener('click', () => visBogITraeet(el.dataset.bogkrumme));
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
/**
 * Ruden: slaa den her notesbog sammen med en anden.
 *
 * »Det skal vaere muligt at kunne slaa 2 notebooks sammen« (Andreas,
 * 2026-08-25), paa to maader.
 *
 * ── Hvorfor de to valg staar med en saetning hver ─────────────────────────
 *
 * »Move the notes« og »Make it a page« siger ikke, hvad forskellen bliver til
 * paa skaermen bagefter - og det her er en handling, man ikke kan fortryde
 * med et klik. Hver mulighed siger derfor, hvad man FAAR: noter side om side,
 * eller et niveau der husker, hvor de kom fra.
 *
 * Antallet staar der ogsaa. »Slaa sammen« lyder som noget, der handler om to
 * bøger; det handler om alle noterne i dem.
 */
function visFletRude(id, navn) {
  const andre = (state.notebooks || []).filter((b) => b.id !== id);
  if (!andre.length) {
    toast('There is no other notebook to merge into.');
    return;
  }
  const antal = (state.tree || []).filter((n) => n.notebookId === id).length;

  const host = document.createElement('div');
  host.className = 'modal';
  host.id = 'fletRude';
  host.innerHTML = `<div class="modal-kort">
      <div class="modal-top">
        <h2>Merge “${esc(navn)}”</h2>
        <button class="iconbtn" id="fletLuk" aria-label="Close">${icon('luk', 16)}</button>
      </div>
      <div class="modal-krop">
        <p class="meta saetning">“${esc(navn)}” goes to the trash and its ${antal
  } note${antal === 1 ? '' : 's'} move to the notebook you pick. Subpages come along.</p>
        <label class="field"><span>Merge into</span>
          <select class="input" id="fletMaal">
            ${andre.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}
          </select></label>
        <fieldset class="fletvalg">
          <legend class="meta">How</legend>
          <label class="fletvalg-en">
            <input type="radio" name="flettilstand" value="noter" checked>
            <span><strong>Move the notes in</strong>
              <span class="meta saetning">They end up side by side with the notes already
              there, and where they came from is forgotten.</span></span>
          </label>
          <label class="fletvalg-en">
            <input type="radio" name="flettilstand" value="side">
            <span><strong>Make it a page under the other</strong>
              <span class="meta saetning">A page called “${esc(navn)}” is created, and the
              notes become subpages of it. The old grouping is kept as a level.</span></span>
          </label>
        </fieldset>
        <div class="btnrow" style="margin-top:16px">
          <button class="btn primary" id="fletGem">Merge</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(host);

  const luk = () => { host.remove(); document.removeEventListener('keydown', paaTast); };
  const paaTast = (e) => { if (e.key === 'Escape') { e.preventDefault(); luk(); } };
  document.addEventListener('keydown', paaTast);
  host.querySelector('#fletLuk').addEventListener('click', luk);
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });

  host.querySelector('#fletGem').addEventListener('click', async () => {
    const maal = host.querySelector('#fletMaal').value;
    const tilstand = host.querySelector('input[name="flettilstand"]:checked').value;
    const maalNavn = (andre.find((b) => b.id === maal) || {}).name || 'the notebook';
    try {
      const r = await api('POST', `/api/v1/notebooks/${id}/merge`,
        { into: maal, mode: tilstand });
      luk();
      toast(tilstand === 'side'
        ? `“${navn}” is now a page in “${maalNavn}” with ${r.top} subpage${
          r.top === 1 ? '' : 's'}.`
        : `${r.notes} note${r.notes === 1 ? '' : 's'} moved to “${maalNavn}”.`);
      // Stod man i en note fra bogen, findes noten stadig - men traeet og
      // brødkrummerne skal tegnes om, saa den staar det rigtige sted.
      await hentTrae();
      await hentState();
      tegnTrae();
      opdaterNav();
      if (editor.note) await aabnNote(editor.note.id, true);
    } catch (ex) { toast(ex.message); }
  });
}

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

/**
 * Aabn noten i sit eget vindue (F29).
 *
 * »Kan du lave en knap saa man kan poppe en note ud i sit eget vindue, saa
 * den er til at have ved siden af?« (Andreas, 2026-09-05).
 *
 * ── Vinduet faar NOTENS navn ──────────────────────────────────────────────
 *
 * `window.open`s andet argument er vinduets navn, og det er ikke pynt her:
 * aabner man den SAMME note ud igen, henter browseren det vindue frem, der
 * allerede staar - i stedet for at lave nummer to af den samme note. To
 * vinduer paa én note ville vaere to editorer paa én tekst.
 *
 * ── `gemNu()` FOER, og uden await ─────────────────────────────────────────
 *
 * Har man skrevet i noten, ligger rettelsen i en debounce, og det nye vindue
 * henter noten fra serveren. Derfor sendes PATCH'en af sted foerst.
 *
 * Uden `await`, med vilje: `window.open` skal koere i SAMME hop som klikket,
 * ellers er brugerhandlingen brugt op, og browseren blokerer vinduet. Vi
 * sender altsaa gemningen af sted og aabner straks efter. Naar den sidste
 * rettelse i sjaeldne tilfaelde ikke naar med, er det ikke et tab: serverens
 * `ifUpdatedAt`-vagt afviser den, der skriver ovenpaa, saa det bliver en
 * konflikt man kan se - ikke en tekst, der forsvinder.
 */
function popUdNote(n) {
  if (typeof gemNu === 'function') gemNu();
  /*
   * `location.pathname`, ikke `offentligBase()`. Linket i menuen skal pege
   * paa den adresse, man DELER; det her vindue skal aabne paa den samme
   * oprindelse, man allerede sidder paa - ellers foelger sessionen ikke med.
   */
  const adr = `${location.pathname}?solo=1#note-${n.id}`;
  const v = window.open(adr, `sagu-note-${n.id}`, 'popup,width=560,height=800');
  if (!v) { toast('The browser blocked the window. Allow pop-ups for Sagu.'); return; }
  try { v.focus(); } catch { /* et vindue, der ikke vil frem, er stadig aabent */ }
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
    <button class="usermenu-item" data-do="pdf">${icon('import', 16)}<span>Save as PDF…</span></button>
    <button class="usermenu-item" data-do="id">${icon('key', 16)}<span>Copy the note ID</span></button>
    <button class="usermenu-item" data-do="link">${icon('globe', 16)}<span>Copy the link to this note</span></button>
    <button class="usermenu-item" data-do="historik">${icon('kalender', 16)}<span>Version history</span></button>
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
        if (hvad === 'pdf') { gemSomPdf(n); return; }
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
        if (hvad === 'historik') { visHistorikPanel(n); return; }
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

/* ============================ versionshistorik (F22) ====================
 *
 * »Det skal være muligt at gå 30 versioner tilbage af en note« (Andreas,
 * 2026-08-25).
 *
 * ── Hvad ruden skal kunne, og hvad den ikke skal ──────────────────────────
 *
 * Den skal vise HVORNÅR, og hvad der stod. Den skal ikke være en
 * forskelsvisning: at se to tekster side om side med farvede linjer er en
 * anden funktion, og den, der leder efter »hvad stod der i tirsdags«, er
 * hjulpet af at læse det — ikke af at se hvad der blev ændret.
 *
 * ── Gendannelsen sker ét sted ─────────────────────────────────────────────
 *
 * Serveren gemmer den nuværende tekst som en version, FØR den skriver den
 * gamle tilbage. Fladen behøver derfor ikke passe på noget: en gendannelse er
 * en rettelse som alle andre, og vejen tilbage findes i den samme liste.
 */
async function visHistorikPanel(note) {
  const gammel = document.getElementById('historikPanel');
  if (gammel) gammel.remove();

  const host = document.createElement('div');
  host.className = 'modal';
  host.id = 'historikPanel';
  host.innerHTML = `<div class="modal-kort bred">
      <div class="modal-top">
        <h2>Version history</h2>
        <button class="iconbtn" id="hisLuk" aria-label="Close">${icon('luk', 16)}</button>
      </div>
      <div class="modal-krop" id="hisKrop"><p class="meta saetning">Loading…</p></div>
    </div>`;
  document.body.appendChild(host);

  const luk = () => { host.remove(); document.removeEventListener('keydown', paaTast); };
  const paaTast = (e) => { if (e.key === 'Escape') { e.preventDefault(); luk(); } };
  document.addEventListener('keydown', paaTast);
  host.querySelector('#hisLuk').addEventListener('click', luk);
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });

  const krop = host.querySelector('#hisKrop');
  let d;
  try { d = await api('GET', `/api/v1/notes/${note.id}/versions`); }
  catch (ex) { krop.innerHTML = `<p class="lead">${esc(ex.message)}</p>`; return; }

  if (!d.versions.length) {
    /*
     * Tom af to grunde, og de betyder ikke det samme.
     *
     * »Slået fra« skal ikke se ud som »der er ikke sket noget endnu« - i det
     * ene tilfælde er der en knap at trykke på, i det andet er der ingenting
     * at gøre.
     */
    krop.innerHTML = d.enabled
      ? '<p class="lead">Nothing yet. A version is kept each time you come back and change '
        + 'something — edits within the same sitting count as one.</p>'
      : '<p class="lead">Version history is switched off.</p>'
        + '<div class="btnrow" style="margin-top:12px">'
        + '<button class="btn" id="hisTilIndst">Open settings</button></div>';
    const knap = krop.querySelector('#hisTilIndst');
    if (knap) knap.addEventListener('click', () => { luk(); gaaTil('settings'); });
    return;
  }

  /*
   * Overskriften skal passe til KONTAKTEN, ikke bare til listen.
   *
   * Her stod »Keeping the last 30 versions« uanset hvad - ogsaa naar
   * historikken var slaaet fra og der altsaa ikke bliver gemt flere. Den
   * tomme rude sagde det rigtige; den fyldte sagde noget andet. En
   * hjaelpetekst er en kravspecifikation, ogsaa naar den staar over en liste,
   * der ser rigtig ud.
   */
  krop.innerHTML = `<p class="meta saetning">${d.enabled
    ? `Keeping the last ${esc(String(d.keep))} versions of each note. `
      + 'Edits within the same sitting count as one.'
    : '<strong>Switched off.</strong> These were kept earlier — no new ones are being added.'}</p>
    <div class="historik">
      <ul class="historik-liste">${d.versions.map((v, i) => `
        <li><button class="historik-rk${i === 0 ? ' paa' : ''}" data-v="${esc(v.id)}">
          <span class="historik-tid">${esc(visTid(v.at))}</span>
          <span class="historik-titel">${esc(v.title || 'Untitled')}</span>
          <span class="meta">${esc(visStoerrelse(v.size))}</span>
        </button></li>`).join('')}</ul>
      <div class="historik-vis" id="hisVis"><p class="meta saetning">Pick a version.</p></div>
    </div>`;

  const vis = krop.querySelector('#hisVis');
  let valgt = null;
  const hent = async (id) => {
    valgt = id;
    krop.querySelectorAll('.historik-rk').forEach((b) => b.classList.toggle('paa', b.dataset.v === id));
    vis.innerHTML = '<p class="meta saetning">Loading…</p>';
    try {
      const r = await api('GET', `/api/v1/notes/${note.id}/versions/${id}`);
      // Teksten vises som MARKDOWN, ikke renderet: det er den, der bliver
      // skrevet tilbage, og så skal det være den, man ser.
      vis.innerHTML = `<div class="btnrow" style="margin-bottom:10px">
          <button class="btn primary" id="hisGendan">Restore this version</button>
        </div>
        <pre class="historik-tekst">${esc(r.version.body)}</pre>`;
      vis.querySelector('#hisGendan').addEventListener('click', async () => {
        try {
          const svar = await api('POST', `/api/v1/notes/${note.id}/versions/${id}`);
          luk();
          editor.note = svar.note;
          editor.beskidt = false;
          editor.aabenBlok = null;
          tegnSide();
          toast('Restored. The version you left is in the history too.');
        } catch (ex) { toast(ex.message); }
      });
    } catch (ex) { vis.innerHTML = `<p class="meta saetning">${esc(ex.message)}</p>`; }
  };
  krop.querySelectorAll('.historik-rk').forEach((b) => {
    b.addEventListener('click', () => { if (b.dataset.v !== valgt) hent(b.dataset.v); });
  });
  hent(d.versions[0].id);
}

/* ==================== hele noten som markdown (F23) ====================
 *
 * »Tilføj en mulighed under settings som hvis slået til så når man klikker på
 * en linje i en note gør hele noten til markdown og ikke kun det element som
 * man har klikket på« (Andreas, 2026-08-25).
 *
 * ── Hvorfor det er et VALG og ikke en erstatning ──────────────────────────
 *
 * Den hybride editor — ét afsnit råt, resten renderet — er god, når man retter
 * en sætning i en lang note: man ser stadig, hvad noten er. Den er i vejen,
 * når man skal flytte rundt på det hele, rette en tabel eller klippe og
 * klistre på tværs af afsnit. Det er to måder at arbejde på, ikke en rigtig og
 * en forkert.
 *
 * ── Klikket lander samme sted ─────────────────────────────────────────────
 *
 * Markøren sættes ved den blok, man klikkede på — ikke i toppen. Ellers skal
 * man lede efter sin egen linje i en note på hundrede afsnit, og så var det
 * hurtigere at lade være med at klikke.
 */
function heleNoten() {
  return !!(editor.raaNote || (state.prefs && state.prefs.editWhole));
}

/** Erstatter HELE noten med ét råt markdown-felt. */
function tegnHeleNoten(host, n) {
  /*
   * Raekken staar her KUN, naar man selv har trykket sig hertil (F34).
   *
   * Er det indstillingen `editWhole`, der aabner hele noten raat, er der
   * ingen vej tilbage at tilbyde: den formaterede visning findes ikke i den
   * tilstand. En knap, der ikke kan det, den viser, er vaerre end ingen knap
   * - samme regel som den, der holder MD ude af en tabel.
   */
  host.innerHTML = `<div class="blok-redigering hel">
      ${editor.raaNote ? vaerktoejslinjeHtml(false) : ''}
      <textarea class="blok-felt hel-felt" id="blokFelt" spellcheck="false"></textarea>
      <button class="blok-hjaelp" id="blokHjaelp" type="button" tabindex="-1"
        aria-label="How to write this" title="How to write this">?</button>
    </div>`;

  const felt = document.getElementById('blokFelt');
  felt.value = n.body;
  autoHoejde(felt);
  bindMdKnap();
  bindRaaVaerktoej(felt);

  const hj = document.getElementById('blokHjaelp');
  // `mousedown`, ikke `click`: et klik ville tage fokus fra feltet, og `blur`
  // lukker editoren - saa var man ude af det, man skrev, for at se hjaelpen.
  hj.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); visSyntaksPanel(); });
  hj.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); visSyntaksPanel(); },
    { passive: false });

  felt.focus();
  /*
   * Markoeren ved den blok, man klikkede paa.
   *
   * `editor.aabenBlok` er blokkens FOERSTE linje i markdown'en, saa
   * tegnpositionen er summen af linjerne foer den. Findes linjen ikke
   * (noten er aendret imens), lander vi i toppen frem for at gaette.
   */
  const linjer = n.body.split('\n');
  const nr = Math.min(Math.max(0, editor.aabenBlok || 0), linjer.length);
  const pos = linjer.slice(0, nr).reduce((sum, l) => sum + l.length + 1, 0);
  felt.setSelectionRange(pos, pos);
  // Rul feltet, saa markoeren er synlig. Uden det staar man paa linje 200 i
  // et felt, der viser linje 1.
  felt.blur();
  felt.focus();

  felt.addEventListener('input', () => {
    byttedeTekstgenvej(felt);
    autoHoejde(felt);
    n.body = felt.value;
    markerBeskidt();
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
    if (wikiTast(e)) return;
    if (e.key === 'Escape') { e.preventDefault(); lukBlok(); return; }
    /*
     * Piletasterne skal IKKE krydse nogen graense her.
     *
     * Den hybride editor springer til nabo-blokken, naar man staar yderst -
     * fordi resten af noten er andre elementer. Her ER hele noten i feltet,
     * saa browserens egen opfoersel er den rigtige. Springer man alligevel,
     * lukker man editoren, hver gang man rammer foerste eller sidste linje.
     */
    e.stopPropagation();
  });

  felt.addEventListener('blur', () => {
    /*
     * Kun hvis fokus forlod BLOKKEN - et klik paa hjaelpeknappen eller i
     * vaerktoejsraekken holder den aaben.
     *
     * Her stod `activeElement.id === 'blokFelt'`, altsaa en TREDJE kopi af
     * den regel, F33 samlede to andre af. Den var rigtig, saa laenge hele
     * noten ikke havde en vaerktoejsraekke - og forkert i samme sekund, den
     * fik én: MD-knappen ville lukke editoren i stedet for at skifte
     * visning. Det er noejagtig den faelde, F33 skrev ned, og den laa ét sted
     * mere end jeg ledte.
     */
    setTimeout(() => {
      if (fokusErIBlokken()) return;
      lukWikiForslag();
      lukBlok();
    }, 0);
  });

  byggToc();
}
