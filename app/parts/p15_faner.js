'use strict';
/*
 * Sagu - noter i faner (F35).
 *
 * »er det muligt at lave i sagu at man kan have flere noter åbne i tabs som
 * det fx er muligt at gøre i notion« (Andreas, 2026-09-15). Og bagefter:
 * »en fane skal bare kunne indeholde noter. ja fanerne må gerne blive husket
 * og det skal kun være på computeren. det er for småt på telefonen«.
 *
 * ── Hvorfor faner INDE i appen og ikke browserens ─────────────────────────
 *
 * På Mac'en kører Sagu som installeret app, og dér er der ingen fanelinje:
 * `⌘↵` sendte noten ud i browseren. Og hver browserfane er hele appen én gang
 * til - eget opslag, egen opfriskning, og en offline-kø i localStorage, som to
 * kopier kan skrive oven i hinanden.
 *
 * ── Én editor, ikke én pr. fane ───────────────────────────────────────────
 *
 * En fane er et NOTE-ID, en titel og en rulleposition. At skifte fane er
 * `aabnNote()`, præcis som at klikke i træet - og den gemmer i forvejen den
 * ventende rettelse, før den går videre. Så skal gemningen, konfliktvagten og
 * offline-køen ikke kende til faner, og der kan aldrig stå to editorer på den
 * samme tekst.
 *
 * ── Hvad et klik gør ──────────────────────────────────────────────────────
 *
 *  - Et almindeligt klik på en note skifter indholdet i DEN AKTIVE fane - som
 *    i Notion. Står noten allerede i en fane, skiftes der til den i stedet.
 *  - ⌘/Ctrl-klik og midterklik lægger noten i en ny fane I BAGGRUNDEN, som
 *    browseren gør med et link. Man bliver, hvor man er.
 *  - **I træet er ⌘/Ctrl-klik »vælg flere«** - det har Andreas selv bedt om
 *    (se `bindTrae`). Dér er det ⌥/Alt-klik eller midterklik. ⌥ virker
 *    overalt, for på en Mac-trackpad findes der ingen midterknap, og træet
 *    har ingen menu at lægge punktet i.
 *  - Adressen (`#note-<id>` fra et link eller en genindlæsning) åbner i en NY
 *    fane: den må ikke skifte en fane ud, man ikke kan se, man står i.
 *
 * ── Kun på computeren, og kun i hovedvinduet ──────────────────────────────
 *
 * Under 900 px er der ikke plads, og et poppet-ud vindue (`?solo=1`) ER én
 * note. Dér opfører alt sig som før - også ⌘↵, der stadig åbner en
 * browserfane.
 *
 * ── Husket pr. ENHED og pr. bruger ────────────────────────────────────────
 *
 * Hvad man har åbent, hører til skærmen foran én, ligesom de foldede
 * notesbøger (`editor.foldede`). Nøglen bærer bruger-id'et: to konti i samme
 * browser må ikke se hinandens fanetitler - en titel er tit hele indholdet.
 *
 * Ved opstart er INGEN fane aktiv. Ellers ville det første klik efter en
 * genstart skifte en fane ud, som man ikke engang har set, at man »stod i«.
 */

const NOTE_ID_RE = /^[a-f0-9]{32}$/;

const noteFaner = {
  liste: [],        // [{ id, titel, ikon, mine, rul }]
  aktiv: null,      // id'et, et almindeligt klik skifter ud
  bruger: null,     // hvis faner der er læst ind
  rulTil: null,     // rullepositionen, der skal genskabes efter indlæsningen
  maade: null,      // engangsflag til den næste `aabnNote` ('ny')
  lytter: false,    // er vinduesbredde-lytteren sat?
};

/** Er der faner i DET HER vindue lige nu? */
function noteFanerAktive() {
  return !!state.user && !soloVindue() && !smalSkaerm();
}

function noteFaneNoegle() {
  return `sagu_faner:${state.user.id}`;
}

/* ------------------------------------------------------------ ren logik */

/*
 * De tre funktioner herunder rører hverken DOM, `state` eller localStorage -
 * de får fanerne ind og retter i dem. Så kan prøven køre den kode, der
 * udgives (tests/faner.test.mjs).
 *
 * maade: 'her'      skift den aktive fane ud (eller lav den første)
 *        'ny'       en ny fane, og gå til den
 *        'baggrund' en ny fane, men bliv hvor du er
 */
function placerNoteFane(f, id, maade, info) {
  const i = info || {};
  const findes = f.liste.find((t) => t.id === id);
  if (findes) {
    if (i.titel !== undefined) findes.titel = i.titel;
    if (i.ikon !== undefined) findes.ikon = i.ikon;
    if (i.mine) findes.mine = true;
    if (maade !== 'baggrund') f.aktiv = id;
    return findes;
  }
  const post = { id, titel: i.titel || '', ikon: i.ikon || null, mine: !!i.mine, rul: 0 };
  const aktivPlads = f.liste.findIndex((t) => t.id === f.aktiv);
  if (maade === 'her' && aktivPlads > -1) {
    f.liste[aktivPlads] = post;
    f.aktiv = id;
    return post;
  }
  // En ny fane lægger sig SIDST. Lagde den sig lige efter den aktive, ville
  // tre noter ⌘-klikket i træk stå i omvendt rækkefølge.
  f.liste.push(post);
  if (maade !== 'baggrund') f.aktiv = id;
  return post;
}

/** Fanen, der tager over, når `id` lukkes: den til højre, ellers til venstre. */
function naboNoteFane(f, id) {
  const i = f.liste.findIndex((t) => t.id === id);
  if (i < 0) return null;
  return f.liste[i + 1] || f.liste[i - 1] || null;
}

function fjernNoteFane(f, id) {
  const nabo = naboNoteFane(f, id);
  f.liste = f.liste.filter((t) => t.id !== id);
  if (f.aktiv === id) f.aktiv = nabo ? nabo.id : null;
  return nabo;
}

/* ------------------------------------------------------------- lagring */

function laesNoteFaner() {
  noteFaner.bruger = state.user.id;
  noteFaner.liste = [];
  noteFaner.aktiv = null;
  try {
    const raa = JSON.parse(localStorage.getItem(noteFaneNoegle()) || '[]');
    if (Array.isArray(raa)) {
      const set = new Set();
      for (const t of raa) {
        // Det, der står i lageret, er ikke til at stole på: en gammel udgave,
        // en hånd i DevTools. Et id, der ikke ligner et id, kommer aldrig i
        // en adresse.
        if (!t || !NOTE_ID_RE.test(t.id) || set.has(t.id)) continue;
        set.add(t.id);
        noteFaner.liste.push({
          id: t.id,
          titel: String(t.titel || ''),
          ikon: t.ikon ? String(t.ikon) : null,
          mine: !!t.mine,
          rul: Number(t.rul) || 0,
        });
      }
    }
  } catch { /* privat tilstand eller rod i lageret - så begynder vi forfra */ }
}

function gemNoteFaner() {
  if (!state.user || noteFaner.bruger !== state.user.id) return;
  try {
    localStorage.setItem(noteFaneNoegle(), JSON.stringify(noteFaner.liste));
  } catch { /* privat tilstand */ }
}

/** Kaldes, når skallen tegnes - efter et login, og ved opstart. */
function klargoerNoteFaner() {
  if (!state.user) return;
  if (noteFaner.bruger !== state.user.id) laesNoteFaner();
  /*
   * Et vindue, der bliver smallere end 900 px, skal miste bjælken med det
   * samme. Lytteren sættes HER og ikke øverst i filen: delene samles
   * alfabetisk, og `p15_` kommer FØR `p1_core` - `SMAL_SKAERM` findes ikke
   * endnu, når filens egen top køres (appen startede sort første gang).
   */
  if (!noteFaner.lytter) {
    noteFaner.lytter = true;
    window.matchMedia(`(max-width: ${SMAL_SKAERM}px)`).addEventListener('change', () => tegnNoteFaner(null));
  }
  tegnNoteFaner();
}

/* ----------------------------------------------------- når noter åbnes */

/** Rullepositionen for den note, man er ved at forlade. */
function gemNoteFaneRul() {
  if (state.view !== 'note' || !state.openNote) return;
  const t = noteFaner.liste.find((x) => x.id === state.openNote);
  // `rulletNed()`, ikke `window.scrollY`: under 900 px er det body, der ruller.
  if (t) t.rul = Math.round(rulletNed());
}

function infoFraTrae(id) {
  const n = (state.tree || []).find((x) => x.id === id);
  return n ? { titel: n.title, ikon: n.icon, mine: true } : {};
}

/**
 * Kaldes af `aabnNote()` - FØR hentningen. Den eneste vej ind i en fane for
 * alt, der åbner noten i det vindue, man står i.
 */
function noteFaneVedAabning(id) {
  const maade = noteFaner.maade || 'her';
  noteFaner.maade = null;
  if (!noteFanerAktive()) return;
  gemNoteFaneRul();
  const fandtes = noteFaner.liste.find((t) => t.id === id);
  noteFaner.rulTil = fandtes ? fandtes.rul : null;
  placerNoteFane(noteFaner, id, maade, infoFraTrae(id));
  gemNoteFaner();
  tegnNoteFaner(id);
}

/** Kaldes, når noten ER hentet og tegnet. */
function noteFaneEfterIndlaesning(note) {
  if (!noteFanerAktive() || !note) return;
  const t = noteFaner.liste.find((x) => x.id === note.id);
  if (t) {
    t.titel = note.title || '';
    t.ikon = note.icon || null;
    t.mine = !!note.mine;
    gemNoteFaner();
  }
  tegnNoteFaner();
  const rul = noteFaner.rulTil;
  noteFaner.rulTil = null;
  // Kun når man vender TILBAGE til en fane. En note, man lige har åbnet,
  // begynder, hvor den altid har gjort.
  if (!rul) return;
  /*
   * Noten er allerede tegnet (`tegnSide()` er synkron for en note), så der
   * rulles med det samme. IKKE i en `requestAnimationFrame`: den kører
   * slet ikke i et vindue, der ikke vises, og så landede man i toppen.
   *
   * Og to gange, hvilket ikke er nervøsitet. Den første rulning folder
   * tællerne i topbaren sammen (`body.rullet`), bjælken bliver 96 px
   * lavere, og browseren flytter rullepositionen med - man landede præcis
   * så meget for højt oppe. Målt: gemt 1200, genskabt 1104. Anden gang står
   * bjælken, som den stod, da positionen blev gemt.
   */
  rulTil(rul);
  setTimeout(() => {
    if (state.openNote !== note.id) return;
    if (Math.abs(rulletNed() - rul) > 2) rulTil(rul);
  }, 60);
}

/** Hentningen fejlede. En note, der er væk, skal ikke blive stående i en fane. */
function noteFaneFejl(id, ex) {
  // KUN 404. Uden net er noten ikke væk - den kan bare ikke nås lige nu.
  if (!ex || ex.status !== 404) return;
  if (!noteFaner.liste.some((t) => t.id === id)) return;
  fjernNoteFane(noteFaner, id);
  gemNoteFaner();
  tegnNoteFaner();
}

/**
 * ⌘/Ctrl-klik, ⌥-klik, midterklik og ⌘↵ i søgefeltet: en ny fane i baggrunden.
 *
 * Uden faner (telefon, sidevindue) gør den det, ⌘↵ altid har gjort.
 */
function aabnIBaggrunden(id, titel) {
  if (!NOTE_ID_RE.test(String(id))) return;
  if (!noteFanerAktive()) { window.open(`#note-${id}`, '_blank'); return; }
  // Står man i en note, der endnu ikke er en fane (vinduet var smalt, da den
  // blev åbnet), skal den med først - ellers forsvinder den, man står i.
  if (state.view === 'note' && state.openNote
      && !noteFaner.liste.some((t) => t.id === state.openNote)) {
    placerNoteFane(noteFaner, state.openNote, 'ny', editor.note
      ? { titel: editor.note.title, ikon: editor.note.icon, mine: editor.note.mine }
      : infoFraTrae(state.openNote));
  }
  const info = infoFraTrae(id);
  if (info.titel === undefined && titel) info.titel = titel;
  const fandtes = noteFaner.liste.some((t) => t.id === id);
  placerNoteFane(noteFaner, id, 'baggrund', info);
  gemNoteFaner();
  tegnNoteFaner();
  // En ny fane ER sit eget spor - den dukker op i bjælken. Stod noten der i
  // forvejen, sker der intet at se, og så skal det siges.
  if (fandtes) toast('Already open in a tab.');
}

/** Adressen åbner i en NY fane - se toppen af filen. */
function aabnNoteFraAdresseIFane(id) {
  if (noteFanerAktive()) noteFaner.maade = 'ny';
  aabnNote(id);
}

/* ------------------------------------------------------ lukke og skifte */

function lukNoteFane(id) {
  const vises = state.view === 'note' && state.openNote === id;
  const nabo = fjernNoteFane(noteFaner, id);
  gemNoteFaner();
  if (!vises) { tegnNoteFaner(); return; }
  if (nabo) aabnNote(nabo.id);
  else gaaTil('search');
}

/** `,` og `.` - forrige og næste fane, rundt i ring. */
function skiftNoteFane(retning) {
  const l = noteFaner.liste;
  if (!l.length) return;
  const nu = state.view === 'note' ? state.openNote : noteFaner.aktiv;
  const i = l.findIndex((t) => t.id === nu);
  const naeste = i < 0 ? l[0] : l[(i + retning + l.length) % l.length];
  if (naeste && naeste.id !== (state.view === 'note' ? state.openNote : null)) aabnNote(naeste.id);
}

/**
 * Titlen i fanen følger titelfeltet, mens man skriver - uden at tegne
 * bjælken om for hvert tastetryk.
 */
function opdaterNoteFaneTitel(id, titel) {
  const t = noteFaner.liste.find((x) => x.id === id);
  if (!t) return;
  t.titel = titel;
  gemNoteFaner();
  const el = document.querySelector(`#noteFaner [data-fane="${id}"] .notefane-titel`);
  if (el) el.textContent = titel.trim() || 'Untitled';
}

/**
 * Træet er hentet: titler og ikoner opfriskes, og MINE noter, der ikke står
 * der længere, er slettet et sted - i menuen, med notesbogen, i en markering.
 *
 * Kun efter en hentning, der LYKKEDES, og ikke offline: træet fra cachen er
 * gammelt, og en tom liste efter en fejl ville lukke alle faner på én gang.
 * En note, der er delt med én, står aldrig i træet; den fanges af 404'eren i
 * `noteFaneFejl`.
 */
function ryddNoteFaner() {
  if (!state.user || noteFaner.bruger !== state.user.id || !noteFaner.liste.length) return;
  if (state.offline) return;
  const kendte = new Map((state.tree || []).map((n) => [n.id, n]));
  let aendret = false;
  noteFaner.liste = noteFaner.liste.filter((t) => {
    const n = kendte.get(t.id);
    if (n) {
      if (t.titel !== n.title || t.ikon !== (n.icon || null) || !t.mine) {
        t.titel = n.title;
        t.ikon = n.icon || null;
        t.mine = true;
        aendret = true;
      }
      return true;
    }
    if (!t.mine) return true;
    aendret = true;
    if (noteFaner.aktiv === t.id) noteFaner.aktiv = null;
    return false;
  });
  if (!aendret) return;
  gemNoteFaner();
  tegnNoteFaner();
}

/* ------------------------------------------------------------- bjælken */

function noteFaneTitel(t) {
  const n = (typeof editor === 'object' && editor.note && editor.note.id === t.id) ? editor.note.title : t.titel;
  return String(n || '').trim() || 'Untitled';
}

/**
 * Tegner OG binder sit eget element - aldrig `shellHtml()` (docs/regler/flade.md).
 *
 * `visesId` er noten, der er PAA VEJ ind: `aabnNote()` tegner bjaelken, foer
 * `state.openNote` er skiftet, og uden den lyste den forrige fane, mens den
 * nye hentede.
 */
function tegnNoteFaner(visesId) {
  const host = document.getElementById('noteFaner');
  if (!host) return;
  if (!noteFanerAktive() || !noteFaner.liste.length) {
    host.hidden = true;
    host.innerHTML = '';
    return;
  }
  const vises = visesId || (state.view === 'note' ? state.openNote : null);
  host.hidden = false;
  host.innerHTML = noteFaner.liste.map((t) => {
    const titel = noteFaneTitel(t);
    const klasser = ['notefane'];
    if (t.id === vises) klasser.push('vises');
    else if (t.id === noteFaner.aktiv) klasser.push('aktiv');
    return `<div class="${klasser.join(' ')}" data-fane="${esc(t.id)}" role="tab"
        aria-selected="${t.id === vises ? 'true' : 'false'}">
      <button class="notefane-knap" data-faneaabn="${esc(t.id)}" title="${esc(titel)}">
        ${t.ikon ? `<span class="notefane-ikon">${esc(t.ikon)}</span>` : icon('notes', 14)}
        <span class="notefane-titel">${esc(titel)}</span>
      </button>
      <button class="notefane-luk" data-faneluk="${esc(t.id)}" aria-label="Close ${esc(titel)}"
        title="Close tab (W)">${icon('luk', 12)}</button>
    </div>`;
  }).join('');

  host.querySelectorAll('[data-faneaabn]').forEach((el) => {
    el.addEventListener('click', () => aabnNote(el.dataset.faneaabn));
  });
  host.querySelectorAll('[data-faneluk]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      lukNoteFane(el.dataset.faneluk);
    });
  });
  host.querySelectorAll('.notefane').forEach((el) => {
    // Midterklik lukker - som i browseren. `mousedown` skal stoppes, ellers
    // slår Windows sin rulle-cirkel til.
    el.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
    el.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      lukNoteFane(el.dataset.fane);
    });
  });

  // Den fane, man står i, skal kunne ses, også når bjælken er rullet.
  const valgt = host.querySelector('.notefane.vises');
  if (valgt) {
    const venstre = valgt.offsetLeft;
    const hoejre = venstre + valgt.offsetWidth;
    if (venstre < host.scrollLeft) host.scrollLeft = venstre;
    else if (hoejre > host.scrollLeft + host.clientWidth) host.scrollLeft = hoejre - host.clientWidth;
  }
}

/* ------------------------------------------- ⌘-klik og midterklik overalt */

/*
 * Hvilken note peger elementet på?
 *
 * Én lytter på hele dokumentet frem for en gren i hver af de ti handlere, der
 * åbner en note: favoritterne, sporet, listerne, søgningen, baglinks,
 * `[[links]]`, kommentarerne ... Den ellevte ville ellers mangle.
 *
 * Træet (`data-note`) er med for ⌥-klik og midterklik - ⌘-klik vælger dér.
 */
function noteMaalFraKlik(el, medTrae) {
  if (!el || !el.closest) return null;
  const vaelger = '[data-genvej],[data-aabn],[data-krumme],[data-udgivnote],a[href^="#note-"]'
    + (medTrae ? ',[data-note]' : '');
  const kilde = el.closest(vaelger);
  if (!kilde) return null;
  const d = kilde.dataset;
  const id = d.genvej || d.aabn || d.krumme || d.udgivnote || d.note
    || String(kilde.getAttribute('href') || '').replace(/^#note-/, '');
  if (!NOTE_ID_RE.test(id)) return null;
  const titelEl = kilde.querySelector('.omni-row-titel');
  const titel = (titelEl ? titelEl.textContent : (kilde.getAttribute('title') || kilde.textContent)) || '';
  return { id, titel: titel.trim().split('\n')[0].trim() };
}

document.addEventListener('click', (e) => {
  if (e.button !== 0 || e.shiftKey || !noteFanerAktive()) return;
  // ⌥ alene tager træet med; ⌘/Ctrl gør ikke - dér betyder det »vælg«.
  const alt = e.altKey && !e.metaKey && !e.ctrlKey;
  const mod = (e.metaKey || e.ctrlKey) && !e.altKey;
  if (!alt && !mod) return;
  const maal = noteMaalFraKlik(e.target, alt);
  if (!maal) return;
  // I fangst-fasen, så hverken linkets egen handler eller browserens nye
  // fane når at køre.
  e.preventDefault();
  e.stopPropagation();
  aabnIBaggrunden(maal.id, maal.titel);
}, true);

document.addEventListener('mousedown', (e) => {
  if (e.button === 1 && noteFanerAktive() && noteMaalFraKlik(e.target, true)) e.preventDefault();
}, true);

document.addEventListener('auxclick', (e) => {
  if (e.button !== 1 || !noteFanerAktive()) return;
  if (e.target.closest && e.target.closest('#noteFaner')) return;   // bjælken lukker selv
  const maal = noteMaalFraKlik(e.target, true);
  if (!maal) return;
  e.preventDefault();
  e.stopPropagation();
  aabnIBaggrunden(maal.id, maal.titel);
}, true);
