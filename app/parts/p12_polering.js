'use strict';
/*
 * Sagu - genveje, favoritter og spor (F13).
 *
 * ── Genvejene står ÉT sted, og oversigten er GENERERET ────────────────────
 *
 * `GENVEJE` er både det, tastaturet gør, og det, hjælpen viser. Det er ikke
 * bekvemmelighed: en genvejsoversigt, der er skrevet af, er en liste over
 * hvad appen plejede at kunne. Loggen har »en hjælpetekst er en
 * kravspecifikation« stående fire gange (doda v9/v35/v38, Sagu F9), og kuren
 * er hver gang den samme — ikke mere omhu, men ét sted.
 *
 * Her kan de ikke drive fra hinanden, fordi de ER det samme bord.
 *
 * ── Favoritter og spor er MINE ────────────────────────────────────────────
 *
 * Begge hænger på brugeren, ikke på noten. Sagu er flerbruger, og en note kan
 * være delt: et flag på noten ville betyde, at min stjerne dukkede op hos
 * kollegaen, og at hans besøg skubbede rundt på min egen liste.
 */

/**
 * Tasten -> hvad den gør, og hvad der står om den.
 *
 * `naar` afgør, om genvejen overhovedet gælder lige nu — så oversigten kan
 * vise, hvad der virker HER, og ikke en liste, hvor halvdelen ikke gør noget.
 */
/**
 * Hedder tasten Cmd eller Ctrl paa DEN her maskine?
 *
 * Oversigten skal vise det, der staar paa brugerens eget tastatur. Skriver
 * den »Ctrl« til en Mac, leder man efter en tast, der ikke er der.
 */
function modTast() {
  const nav = window.navigator || {};
  const kilde = String((nav.userAgentData && nav.userAgentData.platform) || nav.platform || '');
  return /mac|iphone|ipad|ipod/i.test(kilde) ? '\u2318' : 'Ctrl+';
}

const GENVEJE = [
  {
    tast: '?', vis: '?', hvad: 'Show this list',
    gør: () => visGenvejsPanel(),
  },
  {
    tast: '/', vis: '/', hvad: 'Jump to the search field',
    gør: () => { const o = omniEl(); if (o) { o.focus(); o.select(); } },
  },
  {
    /*
     * Den ENESTE genvej med modifikator - og den er en bevidst undtagelse
     * fra reglen tre skaerme laengere nede.
     *
     * `Cmd`/`Ctrl+K` er blevet den maade, man aabner soegningen paa (Notion,
     * Linear, Slack, GitHub), og en app, der ikke svarer paa den, foeles
     * gaaet i staa. Prisen er aerlig: i Chrome staar `Ctrl/Cmd+K` for
     * adressefeltets soegning, saa vi TAGER noget, browseren havde. Det er
     * vurderingen vaerd, fordi den, der taster den her, mener sin egen app -
     * men det er en undtagelse, ikke en aabning for flere.
     *
     * Den virker OGSAA midt i en note. Netop dér er den mest vaerd: man er
     * ved at skrive, skal slaa noget op, og skal ikke foerst finde musen.
     */
    tast: 'k', modifikator: true, vis: modTast() + 'K',
    hvad: 'Search — from anywhere, even mid-sentence',
    gør: () => { const o = omniEl(); if (o) { o.focus(); o.select(); } },
  },
  {
    tast: 'n', vis: 'N', hvad: 'New note',
    gør: () => opretOgAaben({}),
  },
  {
    tast: 't', vis: 'T', hvad: 'Today’s note',
    gør: () => aabnDagensNote(),
  },
  {
    tast: 'e', vis: 'E', hvad: 'Edit the last paragraph',
    naar: () => state.view === 'note' && maaRette(editor.note),
    gør: () => aabnSidste(),
  },
  {
    tast: 'f', vis: 'F', hvad: 'Focus mode — just the note',
    naar: () => state.view === 'note',
    gør: () => saetFokus(!erIFokus()),
  },
  {
    tast: 's', vis: 'S', hvad: 'Star this note',
    naar: () => state.view === 'note' && !!editor.note,
    gør: () => skiftFavorit(),
  },
  {
    tast: 'g', vis: 'G', hvad: 'Back to all notes',
    gør: () => gaaTil('notes'),
  },
  {
    tast: 'Escape', vis: 'Esc', hvad: 'Close what is open',
    // Escape håndteres af den enkelte rude, som skal lukkes — hver rude
    // kender sin egen lukning. Den står her, fordi den skal STÅ i
    // oversigten: en genvej, folk bruger hele tiden, må ikke mangle på
    // listen, bare fordi den er implementeret et andet sted.
    kunVist: true,
  },
];

/** Gælder genvejen lige nu? */
const genvejGaelder = (g) => !g.kunVist && (!g.naar || g.naar());

/*
 * Én global tastehåndtering, og den er bevidst forsigtig.
 *
 * Vagten spørger om BÅDE `activeElement` og hændelsens `target`: en
 * optimistisk opdatering kan nå at fjerne det fokuserede element, og så ser
 * et værn, der kun kigger på `activeElement`, ingenting (doda v29).
 *
 * Og genvejene er enkelttaster UDEN modifikator med vilje — `Cmd`/`Ctrl`
 * hører browseren til, og at stjæle dem er at ødelægge noget, der virkede.
 * Den ene undtagelse er `Cmd/Ctrl+K`; begrundelsen står ved genvejen selv,
 * så den, der får lyst til at tilføje nummer to, læser prisen først.
 */
document.addEventListener('keydown', (e) => {
  if (!state.user) return;
  const passer = (x) => x.tast === e.key || (x.tast.length === 1 && x.tast === e.key.toLowerCase());

  /*
   * Genveje MED modifikator afgoeres foerst, og de spoerger hverken om
   * skrivefelter eller om noget andet: de er netop lavet til at kunne bruges
   * midt i en saetning. `altKey` er ikke med - `Alt+K` skriver et tegn paa
   * flere tastaturer, og en genvej maa ikke aede et bogstav.
   */
  if ((e.metaKey || e.ctrlKey) && !e.altKey) {
    const m = GENVEJE.find((x) => x.modifikator && passer(x));
    if (!m || !genvejGaelder(m)) return;
    e.preventDefault();
    try { m.gør(); } catch (ex) { if (window.console) console.error('genvej fejlede', ex); }
    return;
  }

  const iFelt = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  if (iFelt(e.target) || iFelt(document.activeElement)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  const g = GENVEJE.find((x) => !x.modifikator && passer(x));
  if (!g || !genvejGaelder(g)) return;
  e.preventDefault();
  try { g.gør(); } catch (ex) { if (window.console) console.error('genvej fejlede', ex); }
});

/* ------------------------------------------------------- oversigten */

function visGenvejsPanel() {
  const gammel = document.getElementById('genvejPanel');
  if (gammel) { gammel.remove(); return; }

  const host = document.createElement('div');
  host.className = 'modal';
  host.id = 'genvejPanel';
  host.innerHTML = `<div class="modal-kort">
      <div class="modal-top">
        <h2>Keyboard shortcuts</h2>
        <button class="iconbtn" id="genvejLuk" aria-label="Close">${icon('luk', 16)}</button>
      </div>
      <div class="modal-krop">
        <div class="tablewrap"><table class="data"><tbody>
          ${GENVEJE.map((g) => `<tr class="${g.kunVist || genvejGaelder(g) ? '' : 'genvej-doed'}">
            <td style="width:1%"><kbd>${esc(g.vis)}</kbd></td>
            <td>${esc(g.hvad)}</td>
          </tr>`).join('')}
        </tbody></table></div>
        <p class="meta saetning">Greyed-out shortcuts do something on other screens.
        None of them use ⌘ or Ctrl — those belong to the browser.</p>
      </div>
    </div>`;
  document.body.appendChild(host);

  const luk = () => { host.remove(); document.removeEventListener('keydown', paaTast); };
  const paaTast = (e) => { if (e.key === 'Escape') { e.preventDefault(); luk(); } };
  document.addEventListener('keydown', paaTast);
  host.querySelector('#genvejLuk').addEventListener('click', luk);
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });
}

/* -------------------------------------------------------- favoritter */

function favoritKnapHtml(n) {
  if (!n) return '';
  const paa = !!n.favorite;
  return `<button class="iconbtn${paa ? ' paa' : ''}" id="favBtn"
    aria-pressed="${paa ? 'true' : 'false'}"
    title="${paa ? 'Remove from favourites (S)' : 'Add to favourites (S)'}">${icon(paa ? 'stjerneFuld' : 'stjerne', 16)}</button>`;
}

async function skiftFavorit() {
  const n = editor.note;
  if (!n) return;
  const nyt = !n.favorite;
  try {
    await api(nyt ? 'PUT' : 'DELETE', `/api/v1/notes/${n.id}/favorite`);
    n.favorite = nyt;
    const knap = document.getElementById('favBtn');
    if (knap) {
      knap.classList.toggle('paa', nyt);
      knap.setAttribute('aria-pressed', nyt ? 'true' : 'false');
      knap.innerHTML = icon(nyt ? 'stjerneFuld' : 'stjerne', 16);
      knap.title = nyt ? 'Remove from favourites (S)' : 'Add to favourites (S)';
    }
    toast(nyt ? 'Starred.' : 'Removed from favourites.');
    await hentGenveje();
    tegnGenveje();
  } catch (ex) { toast(ex.message); }
}

/* ------------------------------------- favoritter og spor i sidebaren */

const sidebarListe = { favoritter: [], seneste: [] };

/**
 * Hentes ÉN gang ved opstart og efter en ændring - ikke ved hver optegning.
 *
 * To lister mere pr. sidevisning ville være to blokerende rundture mere, og
 * de er ingen af dem det, man kom efter (RUNE-ERFARINGER, doda v27).
 */
async function hentGenveje() {
  try {
    const [f, s] = await Promise.all([
      api('GET', '/api/v1/favorites'),
      api('GET', '/api/v1/recent?limit=6'),
    ]);
    sidebarListe.favoritter = f.notes;
    // Den note, jeg står på LIGE NU, hører ikke til på »senest besøgte«.
    // Den er ikke et sted, jeg var - den er der, jeg er.
    sidebarListe.seneste = s.notes.filter((n) => !editor.note || n.id !== editor.note.id);
  } catch { /* listerne er en tilgift, ikke en forudsaetning */ }
}

/*
 * Begge lister kan foldes sammen.
 *
 * De ligger over notesbøgerne i sidebaren, og på en telefon skubber de træet
 * ned under skærmkanten. Valget hører til kontoen, ikke til maskinen — men
 * det gemmes samme sted som bøgernes egen foldning (`editor.foldede`), for
 * **to måder at folde på i samme app er to steder at rette**, næste gang en
 * af dem skal ændres (RUNE-ERFARINGER, tovo v11).
 */
const SEKTION_FAV = 'sektion:favourites';
const SEKTION_SENESTE = 'sektion:recent';

function genvejeHtml() {
  const liste = (titel, noegle, noter) => {
    if (!noter.length) return '';
    const foldet = editor.foldede.has(noegle);
    return `
    <nav class="nav genvejsliste">
      <button class="nav-titel nav-fold" data-foldsektion="${esc(noegle)}"
        aria-expanded="${foldet ? 'false' : 'true'}">
        <span class="fold-pil${foldet ? ' er-foldet' : ''}">${icon('udfold', 12)}</span>
        <span>${esc(titel)}</span>
        ${foldet ? `<span class="nav-count">${noter.length}</span>` : ''}
      </button>
      ${foldet ? '' : noter.map((n) => `<button class="nav-item" data-genvej="${esc(n.id)}"
        ${editor.note && editor.note.id === n.id ? 'aria-current="page"' : ''}>
        ${n.icon ? `<span class="nav-emoji">${esc(n.icon)}</span>` : icon('notes')}
        <span>${esc(n.title || 'Untitled')}</span>
      </button>`).join('')}
    </nav>`;
  };

  return liste('Favourites', SEKTION_FAV, sidebarListe.favoritter)
    + liste('Recent', SEKTION_SENESTE, sidebarListe.seneste);
}

function bindGenveje() {
  document.querySelectorAll('[data-genvej]').forEach((el) => {
    el.addEventListener('click', () => aabnNote(el.dataset.genvej));
  });
  document.querySelectorAll('[data-foldsektion]').forEach((el) => {
    el.addEventListener('click', () => {
      const n = el.dataset.foldsektion;
      if (editor.foldede.has(n)) editor.foldede.delete(n); else editor.foldede.add(n);
      gemFoldede();
      // Tegner KUN sit eget element - en fuld optegning ville lukke en aaben
      // blok og flytte rullepositionen.
      tegnGenveje();
    });
  });
}

/** Tegner KUN sit eget element. En fuld optegning ville lukke en åben blok. */
function tegnGenveje() {
  const host = document.getElementById('navGenveje');
  if (!host) return;
  host.innerHTML = genvejeHtml();
  bindGenveje();
}

/* ==================== træk ned for at opfriske (mobil) ==================
 *
 * »Kan du lave så man kan trække ned for at refreshe når man er på
 * mobilen?« (Andreas, 2026-08-21).
 *
 * ── Hvorfor appen har brug for den ────────────────────────────────────────
 *
 * Sagu kører som en installeret app på telefonen, og dér findes browserens
 * egen »træk ned«-opfriskning ikke — der er ingen adresselinje og ingen
 * genindlæs-knap. Kommer der en note ind fra en anden enhed, en genvej eller
 * MCP, stod skærmen med gårsdagens indhold, indtil man lukkede og åbnede
 * appen igen.
 *
 * ── Hvad den opfrisker, og hvad den IKKE rører ────────────────────────────
 *
 * Den henter DATA, ikke siden. En `location.reload()` ville smide den åbne
 * note, rullepositionen og en kø af ikke-sendte rettelser væk — og det er
 * netop dét, man ikke vil, når man står med telefonen i hånden.
 *
 * En ventende gemning sendes FØRST. Rækkefølgen er ikke til forhandling:
 * hentede vi noten før vi gemte, ville serverens ældre udgave overskrive det,
 * man lige har skrevet — man ville trække ned for at opdatere og få sin egen
 * tekst slettet.
 *
 * Og har noten stadig ugemte rettelser bagefter (offline, en gemning der
 * fejlede), hentes dens tekst IKKE. Resten opfriskes.
 *
 * ── Hvorfor pointer-events ikke duer her ──────────────────────────────────
 *
 * Alle andre steder i Sagu er svaret `pointerdown`/`pointermove` — men her
 * skal rulningen kunne AFLYSES, og det kræver `preventDefault()` på en
 * `touchmove`-lytter, der ikke er passiv. En pointer-hændelse kan ikke stoppe
 * browserens rulning.
 *
 * `preventDefault()` kaldes først, når trækket er GENKENDT: mere lodret end
 * vandret, nedad, og fra en side, der allerede står i toppen. Ellers havde vi
 * brudt almindelig rulning for at vinde en gestus.
 */

// `nedtraek`, ikke `traek`: traeet i sidebaren har sin egen `traek`, og alle
// dele samles til ÉN fil med ét globalt rum. Navnesammenstoed her viser sig
// som en SyntaxError et helt andet sted (det er sket foer, med `maal`).
const NEDTRAEK_GRAENSE = 72;      // px, man skal trække, før den udløser
const NEDTRAEK_VAAGN = 10;        // px, før vi overhovedet griber ind
const NEDTRAEK_MAX = 110;         // så elastikken har en ende

const nedtraek = { yStart: 0, xStart: 0, aktiv: false, laast: false, dy: 0, koerer: false };
let traekEl = null;

function traekIndikator() {
  if (!traekEl) {
    traekEl = document.createElement('div');
    traekEl.className = 'traekopfrisk';
    /*
     * Maerket SIGER, hvad der sker.
     *
     * Foerste udgave var kun et ikon, der skiftede farve ved graensen - og en
     * farve er et gaet, foerste gang man moeder gestussen. doda skriver
     * »Pull to refresh« / »Release to refresh« / »Refreshing…«, og det er
     * hele forskellen paa at vide og at prøve sig frem.
     */
    traekEl.innerHTML = `<div class="traekopfrisk-ring">${icon('opfrisk', 18)}</div>`
      + '<div class="traekopfrisk-tekst"></div>';
    document.body.appendChild(traekEl);
  }
  return traekEl;
}

function saetTraekTekst(el, tekst) {
  const t = el.querySelector('.traekopfrisk-tekst');
  if (t && t.textContent !== tekst) t.textContent = tekst;
}

function skjulTraek() {
  if (!traekEl) return;
  traekEl.classList.remove('paa', 'klar', 'koerer');
  traekEl.style.transform = '';
}

/**
 * Står ALT, fingeren rører, allerede i toppen?
 *
 * `window.scrollY` var ikke nok, og det er ikke en detalje: paa en telefon er
 * det `body`, der ruller, saa `window.scrollY` er ALTID 0 dér.
 *
 * Aarsagen er `html, body { height: 100% }` sammen med
 * `@media (max-width: 900px) { html, body { overflow-x: hidden } }`: naar den
 * ene akse ikke er `visible`, beregnes den anden til `auto`, og saa er body
 * rulleboksen. Paa en bred skaerm er det stadig dokumentet. (Her stod
 * tidligere `height: 100dvh; overflow-y: auto` - det er SIDEBARENS regel, og
 * den, der ledte efter den paa html/body, ledte forgaeves.) Værnet greb dermed aldrig, og et træk nedad
 * midt i en lang note ville opfriske i stedet for at rulle - stik imod det,
 * fingeren bad om (målt i browseren, 2026-08-21).
 *
 * Derfor spørges der tre steder: vinduet, de to mulige sidescrollere, og hver
 * eneste forælder op gennem træet. Det sidste dækker de indre ruder, der har
 * deres egen rulning - en lang kodeblok, sidebaren, en åben rude.
 */
function heltOppe(maal) {
  if (window.scrollY > 0) return false;
  if (document.documentElement.scrollTop > 0 || document.body.scrollTop > 0) return false;
  for (let el = maal; el && el !== document.body; el = el.parentElement) {
    if (el.scrollTop > 0) return false;
  }
  return true;
}

/** Må der overhovedet trækkes lige nu? */
function maaTraekke(e) {
  if (!state.user) return false;
  // Kun berøring. En mus har hjul, og en pegefelt-rulning må ikke fange en
  // gestus, der er tænkt til en finger.
  if (e.touches && e.touches.length !== 1) return false;
  if (!heltOppe(e.target)) return false;
  // En rude, der ligger over siden, har sin egen rulning og sin egen lukning.
  if (document.querySelector('.modal, .blok-menu')) return false;
  /*
   * Spørgsmålet er, hvor FINGEREN lander - ikke hvad der har fokus.
   *
   * Første udgave spurgte om `document.activeElement`, og så virkede
   * gestussen aldrig på en telefon: søgefeltet tager fokus, når appen åbner,
   * og beholder det, selv om tastaturet er væk. Værnet ramte dermed hver
   * eneste gang - en funktion, der er umulig at nå i praksis, findes ikke
   * (samme fælde som markeringsknappen i F16).
   *
   * Inde i et skrivefelt er et træk noget andet: dér panorerer og markerer
   * man. På almindelig tekst gør man ikke - en markering på touch begynder
   * med et langt tryk, ikke med et træk.
   */
  const m = e.target;
  if (m && m.closest && m.closest('input, textarea, [contenteditable="true"]')) return false;
  // Er man i gang med at trække i en blok, hører fingeren til dét.
  if (document.body.querySelector('.greb-aktiv')) return false;
  return true;
}

document.addEventListener('touchstart', (e) => {
  nedtraek.aktiv = false; nedtraek.laast = false; nedtraek.dy = 0;
  if (nedtraek.koerer || !maaTraekke(e)) return;
  nedtraek.yStart = e.touches[0].clientY;
  nedtraek.xStart = e.touches[0].clientX;
  nedtraek.aktiv = true;
}, { passive: true });

document.addEventListener('touchmove', (e) => {
  if (!nedtraek.aktiv || nedtraek.koerer) return;
  const dy = e.touches[0].clientY - nedtraek.yStart;
  const dx = Math.abs(e.touches[0].clientX - nedtraek.xStart);

  if (!nedtraek.laast) {
    // Opad, sidelæns eller for lidt: det er ikke vores gestus. Slip den helt,
    // saa resten af traekket forbliver almindelig rulning.
    if (dy <= 0 || dy < NEDTRAEK_VAAGN) { if (dy < 0) nedtraek.aktiv = false; return; }
    if (dx > dy) { nedtraek.aktiv = false; return; }
    // Naaede siden at rulle, mens fingeren var paa vej? Saa er det rulning.
    if (!heltOppe(e.target)) { nedtraek.aktiv = false; return; }
    nedtraek.laast = true;
    traekIndikator().classList.add('paa');
  }

  // Fra her ER det vores - saa maa siden ikke ogsaa rulle.
  e.preventDefault();
  // Elastik: jo laengere man traekker, jo mindre giver den efter. Uden den
  // foelger maerket fingeren ud af skaermen.
  nedtraek.dy = Math.min(NEDTRAEK_MAX, dy * 0.55);
  const el = traekIndikator();
  el.style.transform = `translate(-50%, ${Math.round(nedtraek.dy)}px)`;
  const ring = el.querySelector('.traekopfrisk-ring');
  if (ring) ring.style.transform = `rotate(${Math.round(nedtraek.dy * 3)}deg)`;
  const klar = nedtraek.dy >= NEDTRAEK_GRAENSE * 0.55;
  el.classList.toggle('klar', klar);
  saetTraekTekst(el, klar ? 'Release to refresh' : 'Pull to refresh');
}, { passive: false });

document.addEventListener('touchend', () => {
  if (!nedtraek.laast) { nedtraek.aktiv = false; return; }
  const naaede = nedtraek.dy >= NEDTRAEK_GRAENSE * 0.55;
  nedtraek.aktiv = false; nedtraek.laast = false;
  if (!naaede) { skjulTraek(); return; }
  opfriskAlt();
}, { passive: true });

// En afbrudt beroering (et opkald, en systemgestus) maa ikke efterlade
// maerket haengende paa skaermen.
document.addEventListener('touchcancel', () => {
  nedtraek.aktiv = false; nedtraek.laast = false; skjulTraek();
}, { passive: true });

/**
 * Henter alt det, skærmen viser, forfra.
 *
 * Ligger for sig selv, fordi den ikke har noget med berøringer at gøre - og
 * fordi den så kan kaldes fra andet end en finger, hvis der senere bliver
 * brug for det.
 */
async function opfriskAlt(stille) {
  if (nedtraek.koerer) return;
  nedtraek.koerer = true;
  sidstOpfrisket = Date.now();
  tegnSynkMaerke();
  const el = traekIndikator();
  // En AUTOMATISK opfriskning skal vaere lydloes. Ellers popper der et maerke
  // op, hver gang telefonen laases op (doda §v26 - samme regel dér).
  if (!stille) {
    el.classList.add('paa', 'koerer');
    el.style.transform = 'translate(-50%, 64px)';
    saetTraekTekst(el, 'Refreshing…');
  }
  try {
    // 1. Det, jeg har skrevet, foerst - se forklaringen i toppen.
    if (typeof gemNu === 'function') await gemNu();
    // 2. Ikke-sendte rettelser afsted, mens vi alligevel har fat i nettet.
    if (typeof synkKoe === 'function' && !state.offline) await synkKoe(true);
    // 3. Notesboeger, maerker, taellere, traeet, favoritter og spor.
    await hentState();
    await hentGenveje();
    tegnTrae();
    // Tallene i toppen laeser `state.counts`, men de tegner sig ikke selv.
    // Uden den her stod der stadig »1 note«, efter at den anden var hentet -
    // og et tal, der ikke foelger med, er vaerre end intet tal.
    opdaterNav();
    // 4. Og selve skaermen.
    if (state.view === 'note' && editor.note && !editor.beskidt) {
      await aabnNote(editor.note.id, true);
    } else if (state.view === 'note' && editor.note) {
      // Ugemte rettelser: teksten er MIN, og den hentes ikke over.
      if (!stille) toast('Refreshed everything except this note — it has unsaved changes.');
    } else {
      await tegnSide();
    }
  } catch (ex) {
    if (!stille) toast(ex && ex.message ? ex.message : 'Could not refresh.');
  } finally {
    nedtraek.koerer = false;
    skjulTraek();
    tegnSynkMaerke();
  }
}

/* ------------------------------------------- naar appen kommer frem igen
 *
 * En app paa hjemmeskaermen bliver ALDRIG genindlaest - den lukkes ikke, den
 * skjules. Vender man tilbage, staar der praecis det, der stod, da man gik -
 * ogsaa selv om man har fanget noget med bogmaerket eller rettet noget paa en
 * anden enhed imens. En app, der viser gamle tal uden at sige det, er en app,
 * man holder op med at stole paa (doda §v26, som allerede havde det her).
 *
 * Sagu spurgte kun om VERSIONEN paa dette tidspunkt (`tjekVersion`), ikke om
 * dataene. Traekket ned var eneste vej til friske noter - og den gestus
 * findes ikke paa en computer.
 *
 * `pageshow` er med, fordi en tilbage-navigation kan komme fra bfcache, hvor
 * hverken `visibilitychange` eller en genindlaesning fyrer.
 *
 * Gulvet paa 30 s er ikke sparsommelighed: uden det henter appen forfra, hver
 * gang man skifter mellem to vinduer paa en computer - og en optegning midt i
 * en saetning er vaerre end lidt gamle tal.
 */
let sidstOpfrisket = Date.now();

/* --------------------------------------------------- »hvor gammelt er det?«
 *
 * Maerket ved siden af tallene i toppen. Det svarer paa ét spoergsmaal, som
 * ellers ikke kan besvares: **sker der ingenting, eller har appen bare ikke
 * spurgt?** Uden det ved man ikke, om de nul nye noter er sandheden eller
 * bare det, appen sidst saa (doda §v26, som havde det foerst).
 *
 * Det er samtidig en KNAP. Traekket ned findes ikke paa en computer, og en
 * automatik uden en manuel vej er en automatik, man ikke kan stole paa, naar
 * den svigter.
 *
 * Ingen falsk praecision: »3 min ago«, ikke »3 min 12 s«.
 */
function opfriskAlder() {
  const sek = Math.round((Date.now() - sidstOpfrisket) / 1000);
  if (sek < 45) return 'just now';
  const min = Math.round(sek / 60);
  if (min < 60) return `${min} min ago`;
  const timer = Math.round(min / 60);
  return timer < 24 ? `${timer} h ago` : 'a while ago';
}

function tegnSynkMaerke() {
  const el = document.getElementById('synkLabel');
  if (!el) return;
  el.textContent = nedtraek.koerer ? 'fetching…' : opfriskAlder();
  const knap = document.getElementById('synkBtn');
  if (knap) knap.classList.toggle('koerer', nedtraek.koerer);
}

/*
 * Hvert halve minut. Tallet skal ikke vaere praecist - det skal bare ikke
 * staa og lyve om, at det var »just now« for ti minutter siden.
 */
setInterval(tegnSynkMaerke, 30000);

function opfriskHvisFremme() {
  if (!state.user || document.visibilityState !== 'visible') return;
  if (state.offline) return;
  if (Date.now() - sidstOpfrisket < 30000) return;
  // Skriver man lige nu, roeres skaermen ikke. `opfriskAlt` passer paa selve
  // teksten, men en optegning under haenderne er stadig en afbrydelse.
  if (typeof editor === 'object' && editor.aabenBlok !== null) return;
  opfriskAlt(true);
}

document.addEventListener('visibilitychange', opfriskHvisFremme);
window.addEventListener('pageshow', (e) => { if (e.persisted) opfriskHvisFremme(); });
