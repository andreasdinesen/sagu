'use strict';
/* Sagu - omni-feltet. Ét felt der baade soeger, opretter og navigerer.
 *
 * Samme foelelse som dodas, men med byttet raekkefoelge, og det er et bevidst
 * valg: i doda skal ét Enter ALTID fange, fordi appen findes for at fange.
 * Sagu er et arkiv - man leder langt oftere, end man opretter, og med tusind
 * importerede noter ville en oprettelse paa foerstepladsen betyde, at Enter
 * laver en ny note, hver gang man ledte efter en gammel.
 *
 * Derfor: **traefferne staar oeverst, og »New note« er den sidste raekke.**
 * Den er altid der, altid naaelig, og `*` foran teksten flytter den op paa
 * foerstepladsen for den, der ved, hvad han vil. Er der ingen traeffere, er
 * den den eneste raekke - og saa er Enter en oprettelse igen. */

/* Foerste tegn vaelger en TILSTAND. Pillen i feltet og legenden i bunden viser
   hvilken, saa man aldrig er i tvivl om, hvad Enter kommer til at goere. */
const OMNI_MODER = {
  '*': {
    id: 'note',
    pil: '* New note',
    ph: 'Title of the new note…',
    // Legenden er en KRAVSPECIFIKATION: naevner den noget, skal det findes
    // (RUNE-ERFARINGER, doda v9). Derfor bygges den af tilstanden.
    legend: ['↵ create'],
    enter: 'Create',
  },
  '/': { id: 'notebook', pil: '/ Notebooks', ph: 'Find a notebook…', legend: [], enter: 'Open' },
  '#': { id: 'tag', pil: '# Tags', ph: 'Find a tag…', legend: [], enter: 'Filter' },
  '+': {
    id: 'task',
    pil: '+ New task in doda',
    ph: 'Task title… — it goes to doda',
    legend: [],
    enter: 'Create',
  },
};

const OMNI_LEGEND = ['* new note', '/ notebooks', '# tags', 'tag: in: updated: has:'];

/*
 * `/notesbog` INDE i en tekst, man opretter en note ud fra.
 *
 * ── Hvorfor den ikke ligger i `app/shared/` ───────────────────────────────
 *
 * `#maerke` bor i det delte modul, fordi SERVEREN ogsaa skal tolke det: en
 * genvej paa en telefon sender ren tekst til API'et, og maerket skal blive et
 * rigtigt maerke. Notesbogen har derimod sit eget felt i API'et
 * (`notebookId`), saa der er ingen anden koereplads at holde i trit med. En
 * regel i `shared/` med ét koerested ville se ud, som om serveren ogsaa
 * tolkede den - og det goer den ikke.
 *
 * ── Formen er maerkets ────────────────────────────────────────────────────
 *
 * Markoeren skal staa ved start eller efter et MELLEMRUM, og navnet skal
 * klaebe til skraastregen. Det er de samme to regler som `#`, og de er der af
 * samme grund: ellers bliver »https://dr.dk/nyheder« til en notesbog.
 *
 * ── Uden en modtager bliver teksten staaende ──────────────────────────────
 *
 * Rammer `/xyz` ingen notesbog, fjernes den IKKE fra titlen. En markoer, der
 * forsvinder uden at have gjort noget, er den slags, man opdager en uge
 * senere. Fladen siger det desuden med en chip, mens man skriver.
 *
 * Der oprettes heller ingen notesbog af en tastefejl: med 32 boeger er en
 * 33. ved navn »dirft« en stille oprydningsopgave, ikke en hjaelp. Vil man
 * have en ny, er `/` som FOERSTE tegn stadig vejen - den tilbyder det
 * ligeud.
 */
/*
 * Formen: `/Drift` eller `/"TDCE noter"`.
 *
 * Anfoerselstegnene er der, fordi mange notesboeger har et navn med
 * MELLEMRUM, og uden dem ville `/TDCE noter` kun ramme »TDCE«. Det er samme
 * greb, soegefeltet allerede bruger til en fraselookup - og dodas
 * `/"two words"`.
 *
 * Moensteret slutter IKKE med `$`. Foerste udgave gjorde, og det var forkert:
 * naar et forslag udfylder feltet, kommer der et mellemrum efter navnet, saa
 * man kan skrive videre - og saa holdt markoeren op med at blive genkendt.
 * Noten landede i ingen notesbog, selv om baade raekken og chippen sagde det
 * modsatte. »Staar den til sidst?« er et spoergsmaal om FORSLAG, ikke om
 * tolkning; det maales for sig i `erSidst()`.
 */
const BOG_MOENSTER = /(^|\s)\/(?:"([^"]{1,60})"|([\p{L}\p{N}][\p{L}\p{N}_-]{0,59}))/u;

/** Skriver navnet, som det skal tastes - med anfoerselstegn, hvis det har mellemrum. */
function bogMarkoer(navn) {
  return /\s/.test(navn) ? `/"${navn}"` : `/${navn}`;
}

/**
 * Finder den notesbog, `/navn` peger paa.
 *
 * Praecist navn slaar alt. Ellers skal praefikset passe paa PRAECIS ÉN bog -
 * to kandidater er ikke et valg, appen maa traeffe for brugeren.
 */
function findBog(navn, boeger) {
  const q = String(navn || '').trim().toLowerCase();
  if (!q) return null;
  const alle = boeger || [];
  const praecis = alle.find((b) => String(b.name || '').toLowerCase() === q);
  if (praecis) return praecis;
  const starter = alle.filter((b) => String(b.name || '').toLowerCase().startsWith(q));
  if (starter.length === 1) return starter[0];
  return null;
}

/**
 * Deler en fangst-tekst i titel og notesbog.
 *
 * @returns {{tekst, bog, soegt}} `soegt` er det, der stod efter skraastregen -
 *   ogsaa naar den ikke ramte noget. Den er det, chippen og forslagene viser.
 */
function plukBog(raa, boeger) {
  const tekst = String(raa || '');
  const m = BOG_MOENSTER.exec(tekst);
  if (!m) return { tekst: tekst.trim(), bog: null, soegt: '', erSidst: false };
  const soegt = String(m[2] != null ? m[2] : m[3]).trim();
  const bog = findBog(soegt, boeger);
  // Staar markoeren sidst, er man stadig i gang med at skrive navnet - og saa
  // er det dét, forslagene handler om.
  const erSidst = m.index + m[0].length === tekst.length;
  // Ingen modtager: teksten bliver, som den blev skrevet.
  if (!bog) return { tekst: tekst.trim(), bog: null, soegt, erSidst };
  return {
    tekst: (tekst.slice(0, m.index) + m[1] + tekst.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim(),
    bog,
    soegt,
    erSidst,
  };
}

/** Etiketten paa oprettelses-raekken - den skal sige, HVOR noten lander. */
function opretEtiket(titel, bog) {
  const navn = titel ? `Create “${titel}”` : 'Create a note';
  return bog ? `${navn} in ${bog.name}` : navn;
}

/* `#maerke`, mens det skrives. Samme form som bogens, men uden citater:
   et maerke kan ikke indeholde mellemrum (`shared/maerker.js`). */
const MAERKE_SIDST = /(^|\s)#([\p{L}\p{N}][\p{L}\p{N}_-]{0,59})$/u;

/*
 * Forslag, mens man skriver en markoer.
 *
 * ── Kun naar markoeren staar SIDST ────────────────────────────────────────
 *
 * Det er dét, der betyder »jeg er i gang med at skrive navnet«. Er den
 * faerdig og fulgt af mere tekst, er valget truffet, og forslagene ville
 * staa i vejen for Enter.
 *
 * Og fordi kun ÉN markoer kan staa sidst, kan de to lister aldrig optraede
 * samtidig. Det er ikke et tilfaelde, det er grunden til, at de to ligger i
 * den SAMME funktion: to uafhaengige lister ville kunne komme til at gore det.
 *
 * ── Et forslag UDFYLDER, det aabner ikke ──────────────────────────────────
 *
 * Det er forskellen paa de her raekker og `/`- og `#`-tilstandenes: dér leder
 * man EFTER en bog eller et maerke, her er man i gang med at lave en note et
 * bestemt sted eller med et bestemt maerke.
 *
 * ── Rammer navnet praecist, foreslaas der ikke mere ───────────────────────
 *
 * Saa er der ikke noget at vaelge imellem.
 *
 * ── Hvorfor `#` ogsaa har brug for det ────────────────────────────────────
 *
 * Et maerke, der ikke findes, bliver LAVET - der er ingen fejl at opdage.
 * Derfor er det netop her, en tastefejl bliver til en dublet: `#drift` og
 * `#dirft` ved siden af hinanden, og den ene har én note i sig. Antallet
 * staar paa hvert forslag, saa det er til at se, hvilket der er det rigtige.
 */
function markoerForslag(raa) {
  const tekst = String(raa || '');

  const mm = MAERKE_SIDST.exec(tekst);
  if (mm) {
    const q = mm[2].toLowerCase();
    const traef = (state.tags || [])
      .filter((t) => String(t.name || '').toLowerCase().includes(q))
      .slice(0, 6);
    if (traef.length === 1 && String(traef[0].name || '').toLowerCase() === q) return [];
    return traef.map((t) => ({
      slags: 'udfyld',
      markoer: '#',
      navn: t.name,
      etiket: `#${t.name}`,
      antal: t.notes,
      under: 'tag the new note with this',
    }));
  }

  const b = plukBog(tekst, state.notebooks);
  if (!b.soegt || !b.erSidst) return [];
  const q = b.soegt.toLowerCase();
  const traef = (state.notebooks || [])
    .filter((x) => String(x.name || '').toLowerCase().includes(q))
    .slice(0, 6);
  if (traef.length === 1 && String(traef[0].name || '').toLowerCase() === q) return [];
  return traef.map((x) => ({
    slags: 'udfyld',
    markoer: '/',
    id: x.id,
    navn: x.name,
    ikon: x.icon || '📓',
    etiket: x.name,
    under: 'put the new note here',
  }));
}

const omni = {
  mode: null,
  raekker: [],
  valgt: 0,
  timer: null,
  token: 0,
  soeger: false,
  fallback: false,
  seneste: [],
  stilleFokus: false,
  // Id paa den bog, man har valgt at soege i - eller null for alle noter.
  // Det er et ID og ikke et flueben: valget gaelder kun, saa laenge den aabne
  // note ligger i netop den bog (se `soegeBog`).
  kunBog: null,
};

/**
 * Den notesbog, man »staar i« - den aabne notes, hvis den er ens egen.
 *
 * Sagu har ingen side for en bog, saa den aabne note er den eneste kontekst.
 * En delt note fra en anden ligger i HANS bog, og den er ikke i
 * `state.notebooks` - saa er der ingen bog at tilbyde.
 */
function aktuelBog() {
  const note = state.view === 'note' && typeof editor === 'object' ? editor.note : null;
  if (!note || !note.notebookId) return null;
  return (state.notebooks || []).find((b) => b.id === note.notebookId) || null;
}

/** Den bog, soegningen er afgraenset til lige nu - eller null. */
function soegeBog() {
  const bog = aktuelBog();
  return bog && omni.kunBog === bog.id ? bog : null;
}

/** Skifter mellem »alle noter« og »kun denne bog« og soeger igen. */
function skiftSoegeBog() {
  const bog = aktuelBog();
  if (!bog) return;
  omni.kunBog = omni.kunBog === bog.id ? null : bog.id;
  omni.valgt = 0;
  opdaterOmni();
}

/**
 * Knap og legende efter et skift af note.
 *
 * Feltet tegnes ikke forfra, naar man aabner en note, saa uden det her ville
 * knappen blive staaende med den FORRIGE notes bog, til man skrev noget.
 */
function opfriskSoegeBog() {
  tegnSoegeBog();
  tegnLegend();
}

/** Knappen i feltet. Kun i den almindelige soegning, og kun med en bog. */
function tegnSoegeBog() {
  const knap = document.getElementById('omniScope');
  if (!knap) return;
  const bog = aktuelBog();
  knap.hidden = !bog || !!omni.mode;
  if (knap.hidden) return;
  const paa = omni.kunBog === bog.id;
  knap.classList.toggle('on', paa);
  knap.textContent = paa ? `In ${bog.name}` : 'All notes';
  knap.title = paa ? 'Searching this notebook only — Tab for all notes'
    : `Searching all notes — Tab for “${bog.name}” only`;
  knap.setAttribute('aria-pressed', paa ? 'true' : 'false');
}

const omniEl = () => document.getElementById('omni');

/* --------------------------------------------------------------- feltet */

function omniHtml() {
  return `
    <div class="omni-card" id="omniCard">
      <div class="omni-field">
        <span class="omni-icon">${icon('search', 21)}</span>
        <span class="omni-mode" id="omniMode" hidden></span>
        <input class="omni-input" id="omni" autocomplete="off" spellcheck="false"
          placeholder="Search your notes, or start a new one">
        <button class="omni-scope" id="omniScope" type="button" hidden></button>
        <button class="omni-clear" id="omniClear" aria-label="Clear" hidden>${icon('luk', 15)}</button>
      </div>
      <div class="omni-panel" id="omniPanel" hidden></div>
      <div class="omni-legend meta" id="omniLegend"></div>
    </div>
    <div class="omni-chips" id="omniChips"></div>`;
}

function saetMode(tegn) {
  omni.mode = tegn;
  const el = omniEl();
  const pil = document.getElementById('omniMode');
  if (!el || !pil) return;
  const m = tegn ? OMNI_MODER[tegn] : null;
  pil.hidden = !m;
  pil.textContent = m ? m.pil : '';
  el.placeholder = m ? m.ph : 'Search your notes, or start a new one';
  const kort = document.getElementById('omniCard');
  if (kort) kort.classList.toggle('moded', !!m);
}

function tegnLegend() {
  const host = document.getElementById('omniLegend');
  if (!host) return;
  const m = omni.mode ? OMNI_MODER[omni.mode] : null;
  // Legenden lover kun Tab, naar der ER en bog at skifte til.
  const bog = !m && aktuelBog();
  const dele = m ? m.legend
    : OMNI_LEGEND.concat(bog ? [soegeBog() ? '⇥ all notes' : `⇥ only ${bog.name}`] : []);
  const enter = m ? m.enter : 'Open';
  host.innerHTML = `
    <span class="legend-keys">${dele.map((d) => {
    const mellemrum = d.indexOf(' ');
    return `<span class="legend-item"><kbd>${esc(d.slice(0, mellemrum))}</kbd>${esc(d.slice(mellemrum + 1))}</span>`;
  }).join('<span class="legend-dot">·</span>')}</span>
    <span class="legend-nav"><span class="legend-item">↑ ↓ Navigate</span>
      <span class="legend-item">↵ ${esc(enter)}</span>
      <span class="legend-item">⌘↵ New tab</span></span>`;
}

/** Chips under feltet: hvad filtrene BETYDER, mens man skriver dem. */
function tegnOmniChips(tolket, bog) {
  const host = document.getElementById('omniChips');
  if (!host) return;
  const dele = tolket ? saguSoeg.beskriv(tolket) : [];
  const bogSoeg = soegeBog();
  if (tolket && bogSoeg) dele.unshift(`in ${bogSoeg.name}`);
  if (omni.fallback) dele.push('no index match — read the text');
  /*
   * `/navn`, der ikke rammer noget, skal SIGES.
   *
   * Markoeren bliver staaende i titlen, og uden chippen ville man foerst
   * opdage det, naar noten var lavet og hed »Ny router /dirft«.
   */
  if (bog && bog.soegt && !bog.bog) dele.push(`no notebook called “${bog.soegt}”`);
  host.innerHTML = dele.map((d) => `<span class="chip${d.startsWith('no index') ? ' neutral' : ''}">${esc(d)}</span>`).join('');
}

/* ------------------------------------------------------------- raekkerne */

async function opdaterOmni() {
  const el = omniEl();
  if (!el) return;
  const raa = el.value;
  const tegn = raa[0];
  saetMode(OMNI_MODER[tegn] ? tegn : null);
  const tekst = omni.mode ? raa.slice(1).trim() : raa.trim();
  tegnLegend();
  tegnSoegeBog();

  if (omni.mode === '*') {
    const b = plukBog(tekst, state.notebooks);
    const p = plukMaerker(b.tekst);
    // Skriver man stadig paa navnet, staar forslagene OEVERST - det er dem,
    // man kigger efter i det oejeblik.
    omni.raekker = markoerForslag(tekst);
    omni.raekker.push({
      slags: 'ny',
      tekst: p.tekst,
      maerker: p.maerker,
      bogId: b.bog ? b.bog.id : null,
      etiket: opretEtiket(p.tekst, b.bog),
      meta: p.maerker.length ? p.maerker.map((m) => `#${m}`).join(' ') : '',
    });
    tegnOmniChips(null, b);
    tegnPanel();
    return;
  }
  if (omni.mode === '+') {
    // Er en note aaben, faar opgaven et link tilbage til den - saa siger
    // raekken det HOEJT, i stedet for at det sker bag ryggen paa nogen
    // (RUNE-ERFARINGER, doda v28: vis det, FOER handlingen sker).
    const paaNote = state.view === 'note' && editor.note ? editor.note.title || 'Untitled' : null;
    omni.raekker = [{
      slags: 'doda',
      tekst,
      etiket: tekst ? `Send "${tekst}" to doda` : 'Send a task to doda',
      under: paaNote ? `linked to “${paaNote}”` : null,
    }];
    tegnOmniChips(null);
    tegnPanel();
    return;
  }
  if (omni.mode === '/') {
    const q = tekst.toLowerCase();
    omni.raekker = (state.notebooks || [])
      .filter((b) => !q || b.name.toLowerCase().includes(q))
      .slice(0, 8)
      .map((b) => ({ slags: 'bog', id: b.id, etiket: b.name, ikon: b.icon || '📓' }));
    if (!omni.raekker.length && tekst) {
      omni.raekker = [{ slags: 'nybog', tekst, etiket: `Create notebook "${tekst}"` }];
    }
    tegnOmniChips(null);
    tegnPanel();
    return;
  }
  if (omni.mode === '#') {
    const q = tekst.toLowerCase();
    omni.raekker = (state.tags || [])
      .filter((t) => !q || t.name.toLowerCase().includes(q))
      .slice(0, 10)
      .map((t) => ({ slags: 'tag', id: t.id, etiket: `#${t.name}`, antal: t.notes }));
    /*
     * Findes maerket ikke, saa tilbyd at lave MAERKET.
     *
     * Foerste udgave tilboed at lave en NOTE med maerket paa - og det er en
     * anden handling end den, man bad om. Andreas skrev `#tags`, trykkede
     * Enter og fik en tom note. Det, `#` handler om, er maerket selv; en note
     * med et maerke laver man med `*` eller ved at skrive `#navn` i titlen.
     * Raekken er den SIDSTE, som alle andre oprettelser i feltet.
     */
    const navn = plukMaerker(`#${tekst}`).maerker[0];
    if (navn && !(state.tags || []).some((t) => t.name.toLowerCase() === navn.toLowerCase())) {
      omni.raekker.push({ slags: 'nytag', tekst: navn, etiket: `Create tag #${navn}` });
    }
    tegnOmniChips(null);
    tegnPanel();
    return;
  }

  // Almindelig soegning.
  const tolket = saguSoeg.tolk(raa);
  tegnOmniChips(tolket);
  if (!raa.trim()) {
    omni.raekker = omni.seneste.map((n) => ({ slags: 'note', id: n.id, etiket: n.title || 'Untitled', meta: 'recent' }));
    tegnPanel();
    return;
  }

  clearTimeout(omni.timer);
  omni.timer = setTimeout(async () => {
    const mit = ++omni.token;
    try {
      const bog = soegeBog();
      const d = await api('GET', `/api/v1/search?q=${encodeURIComponent(raa)}&preview=1`
        + (bog ? `&notebook=${encodeURIComponent(bog.id)}` : ''));
      // Et AELDRE svar maa aldrig overskrive et nyere.
      if (mit !== omni.token) return;
      omni.fallback = !!d.fallback;
      omni.raekker = d.results.map((r) => ({
        slags: 'note',
        id: r.id,
        etiket: r.title || 'Untitled',
        uddrag: r.excerpt,
        forsmag: r.preview,
        afsnit: r.section,
        afsnitTitel: r.sectionTitle,
        meta: r.notebook,
      }));
      // Oprettelse er den SIDSTE raekke - altid der, aldrig i vejen.
      /*
       * Notesbogen plukkes af den RAA tekst - ikke af `tolket.tekst`.
       *
       * Soegetolken laeser `"to ord"` som en FRASE og fjerner citaterne. Kom
       * `plukBog` bagefter, saa den `/"TDCE noter"` som `/TDCE noter`, ramte
       * kun »TDCE« med sit navne-moenster, og ordet »noter« blev staaende i
       * titlen: `Create "mine noter noter og mere tekst"`. Maalt, ikke
       * gaettet - `plukBog` alene gav det rigtige svar hele tiden.
       *
       * Raekkefoelgen er derfor: markoer foerst, saa soegesyntaks, saa maerker.
       */
      const b = plukBog(raa.trim(), state.notebooks);
      const udenSyntaks = saguSoeg.tolk(b.tekst);
      const p = plukMaerker(udenSyntaks.tekst || b.tekst);
      // Har man ledt i én bog uden at skrive `/bog`, er det dér, noten skal ligge.
      const nyBog = b.bog || bog;
      omni.raekker.push({
        slags: 'ny',
        tekst: p.tekst,
        // Baade det, man skrev som `#drift`, og et `tag:drift`-filter: har man
        // ledt efter noget under et maerke og ikke fundet det, er det dér, den
        // nye note hoerer hjemme.
        maerker: p.maerker.concat(tolket.tags || []),
        bogId: nyBog ? nyBog.id : null,
        etiket: opretEtiket(p.tekst, nyBog),
      });
      /*
       * Notesbogs-forslagene staar OEVERST - foran traefferne.
       *
       * Skriver man `/dri`, leder man ikke laengere efter en note; man er i
       * gang med at vaelge en bog. Stod de nederst, skulle man forbi ti
       * soegetraeffere for at naa det, man var i gang med.
       */
      omni.raekker = markoerForslag(raa).concat(omni.raekker);
      omni.valgt = 0;
      tegnOmniChips(tolket, b);
      tegnPanel();
    } catch (ex) {
      if (mit !== omni.token) return;
      omni.raekker = [{ slags: 'fejl', etiket: ex.message }];
      tegnPanel();
    }
  }, 140);
}

/**
 * Uddraget under en note-raekke - eller forsmagen, naar raekken er VALGT.
 *
 * Man koerer ned over traefferne med piletasterne for at finde den rigtige,
 * og én linje er sjaeldent nok til at afgoere det (Andreas, 2026-09-23). Kun
 * den valgte folder ud: stod alle raekker med seks linjer, var der plads til
 * tre traeffere i panelet, og listen var ikke til at overskue.
 */
function forsmagHtml(r, valgt) {
  if (valgt && r.forsmag) return `<span class="omni-row-forsmag">${uddrag(r.forsmag)}</span>`;
  return r.uddrag ? `<span class="omni-row-uddrag">${uddrag(r.uddrag)}</span>` : '';
}

function tegnPanel() {
  const host = document.getElementById('omniPanel');
  if (!host) return;
  if (!omni.raekker.length) { host.hidden = true; host.innerHTML = ''; return; }
  if (omni.valgt >= omni.raekker.length) omni.valgt = omni.raekker.length - 1;
  if (omni.valgt < 0) omni.valgt = 0;

  host.innerHTML = omni.raekker.map((r, i) => {
    const paa = i === omni.valgt ? ' on' : '';
    if (r.slags === 'note') {
      /*
       * En note-raekke er et RIGTIGT link.
       *
       * Den var en `<button>`, og saa kan browserens egen »aabn i ny fane«
       * ikke bruges: ⌘-klik, midterklik og »Aabn link i ny fane« gjorde
       * ingenting. Man maatte forlade sin soegning for at se et resultat og
       * begynde forfra bagefter (Andreas, 2026-08-21).
       *
       * `tabindex="-1"`, fordi listen styres med piletasterne - et link i
       * tabuleringsraekkefoelgen ville lave en anden slags navigation ved
       * siden af den, der allerede er.
       */
      return `<a class="omni-row${paa}" data-row="${i}" tabindex="-1"
          href="#note-${esc(r.id)}">
          <span class="omni-row-ikon">${icon('notes', 16)}</span>
          <span class="omni-row-tekst">
            <span class="omni-row-titel">${esc(r.etiket)}</span>
            ${forsmagHtml(r, !!paa)}
          </span>
          <span class="omni-row-meta meta">${r.afsnitTitel ? esc(r.afsnitTitel)
    : (r.meta ? esc(r.meta) : '')}</span>
        </a>`;
    }
    const ikon = { ny: 'plus', nybog: 'book', bog: null, udfyld: null, tag: 'tag', doda: 'plus', fejl: 'notes' }[r.slags];
    return `<button class="omni-row${paa}${r.slags === 'fejl' ? ' fejl' : ''}" data-row="${i}">
        <span class="omni-row-ikon">${r.ikon ? esc(r.ikon) : icon(ikon || 'book', 16)}</span>
        <span class="omni-row-tekst"><span class="omni-row-titel">${esc(r.etiket)}</span>
          ${r.under ? `<span class="omni-row-uddrag">${esc(r.under)}</span>` : ''}</span>
        ${typeof r.antal === 'number'
    ? `<span class="omni-row-antal">${r.antal} note${r.antal === 1 ? '' : 's'}</span>` : ''}
      </button>`;
  }).join('');
  host.hidden = false;
  /*
   * Den valgte raekke skal kunne ses. Med forsmagen er den flere linjer hoej,
   * saa to tryk paa pil ned kan skubbe den ud under panelets kant.
   * `nearest` ruller kun, naar den ikke allerede staar der.
   */
  const valgtEl = host.querySelector('.omni-row.on');
  if (valgtEl && valgtEl.scrollIntoView) valgtEl.scrollIntoView({ block: 'nearest' });

  host.querySelectorAll('[data-row]').forEach((el) => {
    el.addEventListener('mousedown', (e) => e.preventDefault());   // behold fokus i feltet
    el.addEventListener('click', (e) => {
      /*
       * ⌘/Ctrl-klik, midterklik og shift-klik er browserens egne. Kalder vi
       * `preventDefault()` paa dem, aabner den nye fane aldrig - og saa har
       * linket kun set ud som et link.
       *
       * Med Sagus egne faner (F35) naar ⌘-klik og midterklik aldrig hertil:
       * lytteren i p15_faner.js tager dem i fangst-fasen. Grenen her er
       * derfor telefonens og sidevinduets.
       */
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
      e.preventDefault();
      vaelgRaekke(Number(el.dataset.row));
    });
  });
}

async function vaelgRaekke(i) {
  const r = omni.raekker[i];
  if (!r) return;
  const el = omniEl();

  if (r.slags === 'note') {
    ryd();
    await aabnNote(r.id);
    // Hop til det AFSNIT, traefferen staar i - ikke til toppen af en lang
    // side. Det alene er forskellen paa Notions wiki-soegning (SAGU-PLAN §5).
    if (r.afsnit) {
      setTimeout(() => {
        const h = document.getElementById(r.afsnit);
        if (h) h.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 120);
    }
    return;
  }
  if (r.slags === 'ny') {
    ryd();
    await opretOgAaben(Object.assign(
      { title: r.tekst || 'Untitled', tags: r.maerker || [] },
      r.bogId ? { notebookId: r.bogId } : {},
    ));
    return;
  }
  /*
   * Et forslag UDFYLDER feltet med bogens fulde navn og bliver staaende.
   *
   * Feltet ryddes ikke, og der oprettes ingenting: man har valgt en bog, ikke
   * afsluttet en handling. Markoeren erstattes praecis dér, hvor den stod, saa
   * resten af titlen er uroert - og markoeren kommer til sidst, saa det, man
   * skriver videre, IKKE havner i navnet paa bogen.
   */
  if (r.slags === 'udfyld') {
    if (!el) return;
    /*
     * Markoeren erstattes DÉR, hvor den stod - resten af titlen er uroert -
     * og der saettes et mellemrum efter, saa det, man skriver videre, ikke
     * havner inde i navnet.
     *
     * Feltet ryddes ikke, og der oprettes ingenting: man har valgt en bog
     * eller et maerke, ikke afsluttet en handling.
     */
    el.value = r.markoer === '#'
      ? `${el.value.replace(MAERKE_SIDST, `$1#${r.navn}`)} `
      : `${el.value.replace(BOG_MOENSTER, `$1${bogMarkoer(r.navn)}`)} `;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    opdaterOmni();
    return;
  }
  if (r.slags === 'nybog') {
    try {
      const d = await api('POST', '/api/v1/notebooks', { name: r.tekst });
      await hentTrae();
      if (d && d.notebook) markerSetOgAaben(d.notebook.id);
      tegnTrae();
      ryd();
      toast(`Notebook "${r.tekst}" created.`);
    } catch (ex) { toast(ex.message); }
    return;
  }
  /*
   * En notesbog »aabnes« ved at folde den ud i sidebaren - som broedkrummen
   * goer. Sagu har ingen side for en bog; `gaaTil('notes', { notebook })`
   * landede derfor bare paa All Notes, og Enter lignede en doed tast
   * (Andreas, 2026-09-16).
   */
  if (r.slags === 'bog') {
    ryd();
    visBogITraeet(r.id);
    return;
  }
  if (r.slags === 'nytag') {
    try {
      await api('POST', '/api/v1/tags', { name: r.tekst });
      state.tags = (await api('GET', '/api/v1/state')).tags || state.tags;
      toast(`Tag #${r.tekst} created. Put it on a note with + tag, or write #${r.tekst} in a title.`);
      // Bliv i feltet med maerket som FILTER: man har lige lavet det, og det
      // naeste, man vil, er at se hvad der ligger under det.
      if (el) { el.value = `tag:${r.tekst} `; opdaterOmni(); el.focus(); }
    } catch (ex) { toast(ex.message); }
    return;
  }
  if (r.slags === 'tag') {
    if (el) { el.value = `tag:${r.etiket.slice(1)} `; opdaterOmni(); el.focus(); }
    return;
  }
  if (r.slags === 'doda') {
    if (!r.tekst) { toast('Write what the task should say.'); return; }
    sendOpgaveTilDoda(r.tekst);
  }
}

/**
 * Sender en opgave til doda.
 *
 * ÉT sted, saa `+`-markoeren og opgaveruden paa noten giver samme besked og
 * samme fejl. Er en note aaben, faar opgaven et link tilbage til den; ellers
 * er det en fritstaaende opgave, og det er ogsaa i orden - man staar ikke
 * altid i en note, naar noget falder én ind.
 *
 * `stille` slaar KVITTERINGEN fra, ikke fejlen. Den bruges, naar flere
 * blokke sendes i traek (F36): fem beskeder oven i hinanden er ikke fem
 * kvitteringer, det er stoej, og afsenderen siger selv hvor mange der naaede
 * frem. Gaar noget galt, skal beskeden derimod frem med det samme.
 *
 * @returns {Promise<boolean>} sandt, hvis opgaven naaede frem
 */
async function sendOpgaveTilDoda(tekst, stille) {
  const note = state.view === 'note' && editor.note ? editor.note : null;
  try {
    if (!note) {
      // Uden en note er der ingen note-rute at gaa igennem. Broen har en
      // fritstaaende doer, saa markoeren virker fra enhver skaerm.
      const r = await api('POST', '/api/v1/doda/tasks', { text: tekst });
      if (!stille) toast(r.message || 'Sent to doda.');
      return true;
    }
    const r = await api('POST', `/api/v1/notes/${note.id}/tasks`, { text: tekst });
    dodaState.opgaver = r.tasks || [];
    dodaState.noteId = note.id;
    tegnDodaOpgaver();
    if (!stille) toast(r.message || 'Sent to doda.');
    return true;
  } catch (ex) {
    /*
     * En fejlet forbindelse er ikke en fejlet gemning.
     *
     * `not_connected` er ikke en fejl, brugeren har lavet - det er en
     * indstilling, han ikke har sat endnu. Sig hvad han skal goere, og gaa
     * derhen (en knap, der bare ikke virker, er det vaerste svar).
     */
    if (ex && ex.code === 'not_connected') {
      toast('doda is not connected yet.', { label: 'Connect', run: () => gaaTil('settings') });
      return false;
    }
    toast(ex && ex.message ? ex.message : 'Could not reach doda.');
    return false;
  }
}

/**
 * Skriver en linje i feltet og soeger med det samme.
 *
 * Findes for at der er ÉN vej til et resultat: et klik paa et maerke skriver
 * bare den linje, brugeren selv kunne have skrevet. Ellers ville der vaere to
 * maader at filtrere paa, som kan naa hver sit svar.
 */
function soegFra(linje) {
  const el = omniEl();
  if (!el) return;
  el.value = linje;
  el.focus();
  opdaterOmni();
}

function ryd() {
  const el = omniEl();
  if (el) { el.value = ''; el.blur(); }
  omni.raekker = [];
  omni.mode = null;
  omni.fallback = false;
  // Et tomt felt er en ny soegning, og en ny soegning er i alle noter.
  omni.kunBog = null;
  saetMode(null);
  tegnLegend();
  tegnSoegeBog();
  tegnOmniChips(null);
  tegnPanel();
}

/**
 * Fokus ved opstart - UDEN listen.
 *
 * »Kan du lave saa naar man starter Sagu, saa skal den ikke vise listen fra
 * soegefeltet, da det fylder det hele?« (Andreas, 2026-09-14). Tomt felt og
 * fokus gav »senest aendrede« som en rullegardin-liste, der daekkede hele
 * forsiden - og forsiden viser i forvejen de samme noter under »Recently
 * changed«. Fokus bliver, for man aabner et arkiv for at finde noget: der
 * kan skrives med det samme, og det foerste tegn aabner listen.
 */
function fokusVedOpstart() {
  const el = omniEl();
  if (!el) return;
  /*
   * Flaget nulstilles IKKE lige efter `focus()`.
   *
   * Aabnes Sagu i en baggrundsfane, har dokumentet ikke fokus, og feltets
   * `focus`-haendelse kommer foerst, naar man skifter til fanen - og saa
   * ville listen alligevel staa der. Flaget lever derfor, til brugeren selv
   * goer noget - en tast eller et tryk HVOR SOM HELST. Ikke kun i feltet:
   * `/`, Esc og genvejene naar feltet ad andre veje, og de skal alle vise
   * listen som foer.
   */
  omni.stilleFokus = true;
  el.focus();
}

/* -------------------------------------------------------------- binding */

function bindOmni() {
  const el = omniEl();
  if (!el) return;

  el.addEventListener('input', () => { omni.valgt = 0; opdaterOmni(); });
  el.addEventListener('focus', () => {
    opfriskSoegeBog();
    if (!omni.raekker.length && !omni.stilleFokus) opdaterOmni();
  });
  /*
   * Et klik i feltet, der ALLEREDE har fokus, aabner listen.
   *
   * Opstarten giver feltet fokus uden at aabne den (`fokusVedOpstart`), og
   * saa kommer der ingen `focus`-haendelse, naar man klikker i det bagefter.
   * Uden det her ville »klik i feltet« vise listen hver gang - undtagen den
   * allerfoerste, og det er netop dén, man proever.
   */
  el.addEventListener('click', () => {
    const p = document.getElementById('omniPanel');
    if (p && p.hidden) opdaterOmni();
  });

  el.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); omni.valgt++; tegnPanel(); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); omni.valgt--; tegnPanel(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      /*
       * ⌘/Ctrl+Enter aabner i en ny fane og lader soegningen staa. Det er
       * tastaturets udgave af ⌘-klik, og linjen under feltet lover det.
       *
       * Fanen er Sagus EGEN (F35) - i den installerede app paa Mac'en er der
       * ingen browserfaner at aabne i. Uden faner (telefon, sidevindue) er
       * det stadig browserens.
       */
      if (e.metaKey || e.ctrlKey) {
        const r = omni.raekker[omni.valgt];
        if (r && r.slags === 'note' && r.id) { aabnIBaggrunden(r.id, r.etiket); return; }
      }
      vaelgRaekke(omni.valgt);
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); ryd(); }
    /*
     * Tab skifter mellem alle noter og den aabne notes bog.
     *
     * Kun i den almindelige soegning og kun naar der er en bog - ellers er
     * Tab browserens, og fokus flytter videre som altid.
     */
    if (e.key === 'Tab' && !e.shiftKey && !omni.mode && aktuelBog()) {
      e.preventDefault();
      skiftSoegeBog();
    }
  });

  const scope = document.getElementById('omniScope');
  if (scope) {
    scope.addEventListener('click', () => { skiftSoegeBog(); el.focus(); });
    tegnSoegeBog();
  }

  const luk = document.getElementById('omniClear');
  if (luk) luk.addEventListener('click', () => { ryd(); el.focus(); });

  el.addEventListener('input', () => {
    const k = document.getElementById('omniClear');
    if (k) k.hidden = !el.value;
  });

  // Klik uden for feltet lukker panelet, men beholder teksten - man kan vaere
  // paa vej hen for at laese noget og komme tilbage.
  document.addEventListener('click', (e) => {
    const kort = document.getElementById('omniCard');
    if (!kort || kort.contains(e.target)) return;
    const p = document.getElementById('omniPanel');
    if (p) p.hidden = true;
  });
}

/*
 * Brugeren har gjort noget - saa er opstartens stille fokus forbi.
 *
 * Paa topniveau og ikke i `bindOmni()`, som koeres ved hver optegning af
 * skallen. I opfangningsfasen, saa flaget er vaek, FOER `/`-genvejen
 * nedenfor giver feltet fokus.
 */
const slutStilleFokus = () => { omni.stilleFokus = false; };
document.addEventListener('keydown', slutStilleFokus, true);
document.addEventListener('pointerdown', slutStilleFokus, true);

/*
 * `/` giver feltet fokus fra hvor som helst.
 *
 * IKKE »skriv bare« som i doda: dér er fangst appens hele formaal, mens Sagu
 * har enkeltbogstavs-genveje paa noteskaermen (F for fokus). To funktioner om
 * de samme bogstaver er den fejl, tovo F1 beskriver - en arvet tastaturregel
 * kan vaere forkert i den nye app.
 */
document.addEventListener('keydown', (e) => {
  const iFelt = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  if (iFelt(e.target) || iFelt(document.activeElement)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key !== '/') return;
  const el = omniEl();
  if (!el) return;
  e.preventDefault();
  el.focus();
  el.select();
});

/*
 * Hvor mange »Recent« der vises - i soegefeltet og under »Recently changed«.
 * Fem, ikke otte: listen skal kunne overskues med et blik (Andreas,
 * 2026-09-16). Ét tal, saa de to steder ikke kan komme ud af trit.
 */
const ANTAL_SENESTE = 5;

/** De senest aendrede noter - svaret paa et tomt felt. */
async function hentSeneste() {
  try {
    // Serveren sorterer FOER den klipper - at sortere de fem bagefter
    // giver bare de forkerte otte i den rigtige orden.
    const d = await api('GET', `/api/v1/notes?limit=${ANTAL_SENESTE}&sort=updated`);
    omni.seneste = d.notes;
  } catch { omni.seneste = []; }
}

/*
 * En gemt note lægges øverst i »Recent« uden en rundtur: gemningen sker
 * hvert sekund, man skriver, og listen er kun en tilgift. Titlen følger med,
 * så en omdøbt note ikke står under sit gamle navn.
 */
function flytTilSeneste(note) {
  // Listen er MINE noter, som serverens - en delt side hører ikke til dér.
  if (note.mine === false) return;
  const gammel = omni.seneste.find((n) => n.id === note.id);
  const ny = { ...(gammel || note), title: note.title, updatedAt: note.updatedAt };
  omni.seneste = [ny, ...omni.seneste.filter((n) => n.id !== note.id)].slice(0, ANTAL_SENESTE);
}
