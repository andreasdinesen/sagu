'use strict';
/* Sagu - noten som ÉT dokument (v85).
 *
 * »I stedet for en masse elementer, saa skal den se alt tekst som et samlet
 * element, saa naar man klikker ind i en note, saa kan man bruge pilene til
 * at komme ned igennem hele noten og man kan vaelge hele noten« (Andreas,
 * 2026-09-24).
 *
 * ── Hvad der er det samme som foer ───────────────────────────────────────
 *
 * `body_md` er stadig sandheden, og noten tegnes af den samme `render()`.
 * Forskellen er, at HELE kroppen nu er ét `contenteditable` (`#dok`) i stedet
 * for et afsnit ad gangen. Piletaster, ⌘A, en markering over fem afsnit og
 * browserens egen fortryd (⌘Z) virker derfor, som man kender dem.
 *
 * ── Hvorfor en fejl stadig kun kan ramme den blok, man skriver i ──────────
 *
 * DESIGN.md sagde nej til ét `contenteditable` med den begrundelse, at hvert
 * tastetryk saa ville oversaette HELE noten tilbage. Det goer det ikke her:
 *
 *  - Hvert barn af `#dok` husker den markdown, det kom af (`dok.urort`).
 *  - En `MutationObserver` noterer, hvilke boern der er ROERT.
 *  - Ved sammensaetningen giver et uroert barn sin gamle markdown tilbage
 *    tegn for tegn; kun de roerte gaar gennem `tilMarkdown`.
 *
 * Og en blok, der ikke kan skrives tilbage til noejagtig sig selv (porten fra
 * F30, `kanRedigereRigt`), bliver en ØE: `contenteditable="false"`. Kode,
 * tabeller, streger og GitHub-kort er oeer. Et klik aabner dem raat som
 * foer - den gamle vej, `aabnBlok()`.
 *
 * ── Sikkerhedsnettet ──────────────────────────────────────────────────────
 *
 * Foer dokumentet gives fri, sammensaettes det én gang uden aendringer. Giver
 * det ikke praecis `body` tilbage, tegnes noten med blok-editoren i stedet,
 * og der skrives ikke et tegn (`dok.afvist`). Hellere den gamle editor end en
 * note, der aendrer sig af at blive aabnet.
 */

const DOK_MARKOER = '\uE002';

const dok = {
  el: null,           // #dok
  urort: new WeakMap(), // barn -> { md, gap, foerst, sidst, forrige }
  orig: new WeakMap(),  // barn -> { forrige, gap, foerst, sidst } fra optegningen - aendres aldrig
  roert: new Set(),   // boern, der er aendret siden sidste sammensaetning
  ramme: { foran: [], bagved: [], tom: '' },
  obs: null,
  grebTimer: null,
  afvist: null,       // note-id, dokumentet ikke kunne rundture
};

/* Elementer, der er en blok for sig. Alt andet paa oeverste niveau er tekst,
   som browseren har lagt dér (typisk efter man har slettet alt). */
const DOK_BLOKKE = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'BLOCKQUOTE', 'UL', 'OL', 'PRE', 'TABLE', 'HR', 'SECTION', 'ARTICLE', 'FIGURE']);

/* Pynt, der aldrig maa skrives med tilbage som tekst. */
const DOK_PYNT = '.inlinekode-kopi, .kodeblok-top, .blok-greb, .blok-indsaet, .wikiforslag, .linkboble';

/** Skal noten redigeres som ét dokument? */
function brugDokument(n) {
  if (!n || !maaRette(n)) return false;
  if (typeof saguRedigering === 'undefined' || !saguRedigering.sammensaet) return false;
  const p = state.prefs || {};
  if (p.classicEditor || p.editWhole) return false;
  if (editor.raaNote) return false;
  return dok.afvist !== n.id;
}

/** Staar dokumentet fremme lige nu? */
function dokAktiv() {
  return !!(dok.el && dok.el.isConnected);
}

function dokHarFokus() {
  return dokAktiv() && (document.activeElement === dok.el || dok.el.contains(document.activeElement));
}

/* --------------------------------------------------------- optegningen */

/*
 * Porten, husket. `kanRedigereRigt` renderer blokken og oversaetter den
 * tilbage - pr. blok og pr. optegning. En note paa tusind afsnit maa ikke
 * koste tusind renderinger hver gang et flueben saettes.
 */
const dokPortHukommelse = new Map();
function dokKanSkrives(raa, b) {
  const noegle = `${b.slags}\u0000${raa}`;
  if (dokPortHukommelse.has(noegle)) return dokPortHukommelse.get(noegle);
  const ok = kanRedigereRigt(raa, b);
  if (dokPortHukommelse.size > 4000) dokPortHukommelse.clear();
  dokPortHukommelse.set(noegle, ok);
  return ok;
}

/** Blokkens foerste linje - paa barnet selv, eller paa det, det pakker ind. */
function dokFra(barn) {
  if (!barn || barn.nodeType !== 1) return null;
  const el = barn.dataset.blok !== undefined ? barn : barn.querySelector('[data-blok]');
  return el ? Number(el.dataset.blok) : null;
}

/**
 * Tegner noten som ét dokument.
 *
 * @param {object} [opt] `markoer`: {fra, pos} eller 'tegn' - hvor markoeren
 *   skal staa bagefter (se `dokTegnOm`).
 * @returns {boolean} falsk, hvis dokumentet ikke kunne bruges - saa tegner
 *   kalderen den gamle vej.
 */
function tegnDokument(host, n, opt) {
  dokStop();
  const body = String(n.body || '');
  let html;
  let stykker;
  try {
    html = saguMarkdown.render(body, renderValg()).html;
    stykker = saguMarkdown.blokke(body);
  } catch (ex) {
    if (window.console) console.error('dokument: render fejlede', ex);
    return false;
  }

  host.innerHTML = `<div class="dok" id="dok" contenteditable="true" spellcheck="true"
    role="textbox" aria-multiline="true" aria-label="Note text">${html || '<p><br></p>'}</div>`;
  const el = host.querySelector('#dok');

  // Pynt og binding FOER hukommelsen bygges: `pyntKodeblokke` pakker <pre> ind
  // i en ramme, og det er rammen, der er barnet.
  pyntKodeblokke(el);
  pyntInlineKode(el);
  bindBilleder(host);
  fyldGhIndlejringer(host);
  /*
   * Det, der ikke er brugerens tekst, kan ikke rettes: kopiknapper,
   * fluebenene og en callouts overskrift (»Note«). Overskriften kommer af
   * klassen, ikke af teksten - rettede man den, forsvandt rettelsen i
   * tavshed ved naeste optegning.
   */
  el.querySelectorAll('.inlinekode-kopi, .kodeblok-top, .tjek-boks, .callout-hoved')
    .forEach((x) => x.setAttribute('contenteditable', 'false'));

  const linjer = body.split('\n');
  const efterFra = new Map(stykker.map((b) => [b.fra, b]));
  const boern = [...el.children];
  dok.urort = new WeakMap();
  dok.orig = new WeakMap();
  dok.roert = new Set();
  let forrige = null;
  let forrigeTil = -1;
  boern.forEach((barn, i) => {
    const fra = dokFra(barn);
    const b = fra === null ? null : efterFra.get(fra);
    if (!b) return;
    const raa = linjer.slice(b.fra, b.til + 1).join('\n');
    if (!dokKanSkrives(raa, b)) {
      barn.setAttribute('contenteditable', 'false');
      barn.classList.add('dok-oe');
    }
    const gap = forrige ? linjer.slice(forrigeTil + 1, b.fra) : null;
    dok.urort.set(barn, {
      md: raa, gap, foerst: i === 0, sidst: i === boern.length - 1, forrige,
    });
    dok.orig.set(barn, { forrige, gap, foerst: i === 0, sidst: i === boern.length - 1 });
    forrige = barn;
    forrigeTil = b.til;
  });
  const foerste = stykker[0];
  const sidste = stykker[stykker.length - 1];
  dok.ramme = {
    foran: foerste ? linjer.slice(0, foerste.fra) : [],
    bagved: sidste ? linjer.slice(sidste.til + 1) : [],
    tom: stykker.length ? '' : body,
  };
  dok.el = el;

  /*
   * Sikkerhedsnettet: uroert skal give praecis det, der stod. Goer det ikke
   * det, bliver noten i blok-editoren - uden at der er skrevet et tegn.
   */
  const proeve = dokSammensaet();
  if (proeve.body !== body) {
    if (window.console) {
      console.warn('dokument: noten kan ikke skrives uaendret tilbage - blok-editoren bruges',
        { forventet: body.length, fik: proeve.body.length });
    }
    dok.el = null;
    dok.afvist = n.id;
    return false;
  }

  bindDokument(el, host);
  tegnGreb(host);
  byggToc();
  /*
   * Observatoeren FOER markoeren. Markoeren kan vaere et tegn i teksten, der
   * fjernes igen (`'tegn'`) - og den fjernelse er en aendring af blokken.
   * Kom den foer observatoeren, stod tegnet stadig i blokkens hukommelse og
   * kom tilbage i noten ved naeste gemning.
   */
  dokStart();
  if (opt && opt.markoer) dokSaetMarkoer(opt.markoer);
  return true;
}

/* ---------------------------------------------------- sammensaetningen */

/** Barnets markdown, som det staar nu. Pynten fjernes paa en KOPI. */
function dokOversaet(barn) {
  if (barn.nodeType === 3) return barn.data;
  const kopi = barn.cloneNode(true);
  kopi.querySelectorAll(DOK_PYNT).forEach((x) => x.remove());
  return saguRedigering.tilMarkdown(kopi.outerHTML);
}

/**
 * Deler `#dok` op i det, der skal sammensaettes: hvert blok-element for sig,
 * og loes tekst paa oeverste niveau samlet til ét afsnit.
 */
function dokDele() {
  const dele = [];
  let loes = null;
  const slutLoes = () => {
    if (!loes) return;
    const md = loes.map((x) => (x.nodeType === 3 ? x.data : dokOversaet(x))).join('');
    if (md.trim()) dele.push({ barn: null, md, ny: true });
    loes = null;
  };
  for (const barn of [...dok.el.childNodes]) {
    const erBlok = barn.nodeType === 1 && DOK_BLOKKE.has(barn.tagName);
    if (!erBlok) {
      if (barn.nodeType === 1 && barn.tagName === 'BR') continue;
      if (barn.nodeType !== 1 && barn.nodeType !== 3) continue;
      (loes = loes || []).push(barn);
      continue;
    }
    slutLoes();
    const info = dok.urort.get(barn);
    // En oe er aldrig roert: den kan kun forsvinde og (med ⌘Z) komme igen.
    const ren = info && (!dok.roert.has(barn) || dokErOe(barn));
    const md = ren ? info.md : dokOversaet(barn);
    /*
     * Et tomt element er ikke en blok - hverken et tomt afsnit (to tryk paa
     * ⌘Enter) eller den tomme overskrift, browseren lader staa, naar man har
     * valgt alt og slettet. Det er TEKSTEN, der afgoer det, ikke markdownen:
     * en tom overskrift giver »# «, og det er ikke tomt.
     */
    if (!ren && (!md.trim() || (!barn.textContent.trim() && !barn.querySelector('img, hr')))) continue;
    dele.push({ barn, md, info, ny: !info });
  }
  slutLoes();
  return dele;
}

function dokSammensaet() {
  const dele = dokDele();
  let forrige = null;
  const input = dele.map((d) => {
    const i = d.info;
    const o = d.barn ? dok.orig.get(d.barn) : null;
    /*
     * Afstanden foran blokken:
     *  - den, den havde sidst, hvis naboen er den samme som dengang,
     *  - ellers den fra OPTEGNINGEN, hvis naboen er den, den havde dér -
     *    det er dét, der goer, at ⌘Z efter en sletning giver praecis den
     *    gamle note, og ikke en med en tom linje mere,
     *  - ellers et nyt naboskab: én tom linje, som markdown vil have.
     */
    let gap = null;
    if (i && i.forrige && i.forrige === forrige) gap = i.gap;
    else if (o && o.forrige && o.forrige === forrige) gap = o.gap;
    const ud = {
      md: d.md,
      gap,
      // Rammen (tomme linjer foran og bagved) hoerer til den OPRINDELIGE
      // foerste og sidste blok - og kommer med, naar de staar der.
      foerst: !!(o && o.foerst),
      sidst: !!(o && o.sidst),
    };
    forrige = d.barn;
    return ud;
  });
  const r = saguRedigering.sammensaet(input, dok.ramme);
  return { body: r.body, dele, pladser: r.pladser };
}

/**
 * Dokumentet -> `editor.note.body`. Kaldes efter hver aendring.
 *
 * Bagefter faar hvert barn sine NYE linjer (`data-blok`) og sin nye markdown
 * i hukommelsen - saa traekhaandtag, blokmenu og flueben peger rigtigt, og
 * naeste tastetryk kun oversaetter det, der er roert SIDEN.
 */
function dokSkriv() {
  if (!dokAktiv() || !editor.note) return;
  const { body, dele, pladser } = dokSammensaet();
  let flyttet = false;
  dele.forEach((d, i) => {
    const p = pladser[i];
    if (!d.barn) return;
    const tidl = d.info;
    dok.urort.set(d.barn, {
      md: d.md,
      gap: i ? p.gap : null,
      // (Rammens foerste og sidste laeses af `dok.orig`, ikke herfra.)
      foerst: false,
      sidst: false,
      forrige: i ? dele[i - 1].barn : null,
    });
    const blokEl = d.barn.dataset.blok !== undefined ? d.barn
      : (d.barn.querySelector('[data-blok]') || d.barn);
    if (String(blokEl.dataset.blok) !== String(p.fra) || !tidl) flyttet = true;
    blokEl.dataset.blok = p.fra;
    blokEl.dataset.til = p.til;
    // Fluebenene baerer deres linje - én raekke, én linje.
    d.barn.querySelectorAll('.tjek-boks').forEach((k, j) => { k.dataset.tjek = p.fra + j; });
  });
  // Rammen (tomme linjer foran og bagved) roeres ikke: den hoerer til den
  // oprindelige foerste og sidste blok og kommer med, naar de er der.
  dok.ramme.tom = '';
  dok.roert.clear();

  if (body !== editor.note.body) {
    editor.note.body = body;
    markerBeskidt();
  }
  if (flyttet) planlaegGreb();
}

function planlaegGreb() {
  clearTimeout(dok.grebTimer);
  dok.grebTimer = setTimeout(() => {
    const host = document.getElementById('noteBody');
    if (host && dokAktiv()) tegnGreb(host);
  }, 250);
}

/* ------------------------------------------------ hvad er roert? */

/** Det barn af `#dok`, knuden ligger i - eller null. */
function dokBarn(knude) {
  let k = knude;
  while (k && k.parentNode !== dok.el) k = k.parentNode;
  return k && k.parentNode === dok.el ? k : null;
}

/** En oe: den redigeres raat ved et klik og har ALTID sin egen markdown. */
function dokErOe(x) {
  return !!x && x.nodeType === 1 && x.getAttribute('contenteditable') === 'false';
}

/**
 * Noterer, hvilke boern en raekke aendringer har roert.
 * ÉT sted - observatoeren, `dokStop` og `dokTvingSkriv` laeser dem ens.
 * @returns {boolean} om der var noget, der kan have aendret noten.
 */
function dokNoter(poster) {
  let noget = false;
  for (const m of poster) {
    if (m.target === dok.el) {
      /*
       * Boern tilfoejet eller fjernet. Et TILFOEJET barn er roert - ogsaa
       * naar det er et, vi kender: ⌘Z saetter de blokke, en sletning tog,
       * tilbage som de samme elementer, og deres hukommelse er fra FOER
       * sletningen. De oversaettes forfra; porten har sikret, at det giver
       * det samme.
       */
      m.addedNodes.forEach((x) => { if (x.nodeType === 1 && !dokErOe(x)) dok.roert.add(x); });
      noget = true;
      continue;
    }
    const barn = dokBarn(m.target);
    if (!barn) continue;
    /*
     * En oe roeres aldrig af brugeren - men dens PYNT kan skifte: »Copy«
     * bliver til »Copied«, et GitHub-kort fyldes. Det er ikke en aendring
     * af noten, og en oe gennem oversaetteren ville koste den sin form.
     */
    if (dokErOe(barn)) continue;
    if (m.type === 'attributes' && m.attributeName !== 'aria-checked') continue;
    dok.roert.add(barn);
    noget = true;
  }
  return noget;
}

function dokStart() {
  if (!dokAktiv() || !window.MutationObserver) return;
  dok.obs = new MutationObserver((poster) => { if (dokNoter(poster)) dokSkriv(); });
  dok.obs.observe(dok.el, {
    subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['aria-checked'],
  });
}

function dokStop() {
  if (!dok.obs) return;
  // Det, der stod i koeen, skal med - ellers kunne det sidste tastetryk foer
  // en optegning gaa tabt.
  const rest = dok.obs.takeRecords();
  dok.obs.disconnect();
  dok.obs = null;
  if (rest.length && dokAktiv() && dokNoter(rest)) dokSkriv();
}

/** Faa det, der ligger i koeen, skrevet NU - foer noget laeser `body`. */
function dokTvingSkriv() {
  if (!dok.obs) { if (dok.roert.size) dokSkriv(); return; }
  const rest = dok.obs.takeRecords();
  if (dokNoter(rest) || dok.roert.size) dokSkriv();
}

/* ------------------------------------------------------------- markoeren */

/** Hvor staar markoeren - som blokkens foerste linje og et tegn-tal i den. */
function dokMarkoer() {
  const sel = window.getSelection();
  if (!dokAktiv() || !sel || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  if (!dok.el.contains(r.startContainer)) return null;
  const barn = dokBarn(r.startContainer);
  if (!barn || barn.nodeType !== 1) return null;
  const foer = document.createRange();
  foer.selectNodeContents(barn);
  foer.setEnd(r.startContainer, r.startOffset);
  return { fra: dokFra(barn), pos: foer.toString().length };
}

/** Saetter markoeren ved {fra, pos}, 'start', 'slut' eller 'tegn'. */
function dokSaetMarkoer(hvor) {
  if (!dokAktiv()) return;
  const sel = window.getSelection();
  const r = document.createRange();
  dok.el.focus({ preventScroll: true });

  if (hvor === 'tegn') {
    // Markoeren staar dér, hvor tegnet `DOK_MARKOER` staar. Det fjernes fra
    // BAADE teksten og noten - det har aldrig vaeret brugerens.
    const gaa = document.createTreeWalker(dok.el, NodeFilter.SHOW_TEXT);
    let t = gaa.nextNode();
    while (t && !t.data.includes(DOK_MARKOER)) t = gaa.nextNode();
    if (!t) return;
    const i = t.data.indexOf(DOK_MARKOER);
    t.data = t.data.slice(0, i) + t.data.slice(i + 1);
    // Ogsaa uden observatoer: blokken ER roert, og en tom rest (tegnet stod
    // alene) skal ikke blive et tomt afsnit.
    const barn = dokBarn(t);
    if (barn) {
      dok.roert.add(barn);
      if (!barn.textContent.trim() && barn.tagName === 'P' && dok.el.children.length > 1) {
        const foer = barn.previousElementSibling;
        const nabo = foer || barn.nextElementSibling;
        barn.remove();
        if (nabo) { r.selectNodeContents(nabo); r.collapse(!foer); }
        sel.removeAllRanges();
        sel.addRange(r);
        return;
      }
    }
    r.setStart(t, i);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    return;
  }
  if (hvor === 'start' || hvor === 'slut') {
    r.selectNodeContents(dok.el);
    r.collapse(hvor === 'start');
    sel.removeAllRanges();
    sel.addRange(r);
    return;
  }
  // {fra, pos}: barnet med den linje - eller det naermeste foer den.
  let barn = null;
  for (const b of dok.el.children) {
    const f = dokFra(b);
    if (f !== null && f <= hvor.fra) barn = b;
  }
  if (!barn) barn = dok.el.firstElementChild;
  if (!barn) return;
  const gaa = document.createTreeWalker(barn, NodeFilter.SHOW_TEXT);
  let rest = hvor.pos;
  let t = gaa.nextNode();
  let sidste = null;
  while (t) {
    if (rest <= t.data.length) { r.setStart(t, rest); break; }
    rest -= t.data.length;
    sidste = t;
    t = gaa.nextNode();
  }
  if (!t) {
    if (sidste) r.setStart(sidste, sidste.data.length);
    else { r.selectNodeContents(barn); r.collapse(false); }
  }
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

/**
 * Tegn dokumentet om af `body` - og behold markoeren.
 *
 * Til det, der har aendret `body` UDEN om dokumentet: et flueben via
 * markdownen, en tjekliste-knap, en blok, der blev flyttet.
 */
function dokTegnOm() {
  const host = document.getElementById('noteBody');
  if (!host || !editor.note) return;
  const hvor = dokHarFokus() ? dokMarkoer() : null;
  if (!tegnDokument(host, editor.note, hvor ? { markoer: hvor } : null)) tegnKrop();
}

/**
 * Tegn om efter noget, der er skrevet IND i dokumentet som markdown - et
 * indsaet, en fil. Markoeren saettes som et usynligt tegn i teksten, foer
 * noten skrives, og findes igen efter optegningen. Det er den eneste maade
 * at lande praecis efter det indsatte paa, naar det er blevet til tre
 * afsnit og et billede.
 */
function dokTegnOmVedMarkoer() {
  if (!dokAktiv()) { tegnKrop(); return; }
  const sel = window.getSelection();
  if (sel && sel.rangeCount && dok.el.contains(sel.getRangeAt(0).startContainer)) {
    const r = sel.getRangeAt(0).cloneRange();
    r.collapse(false);
    r.insertNode(document.createTextNode(DOK_MARKOER));
  }
  dokTvingSkriv();
  const host = document.getElementById('noteBody');
  const n = editor.note;
  const medTegn = n.body.includes(DOK_MARKOER);
  if (!tegnDokument(host, n, medTegn ? { markoer: 'tegn' } : null)) {
    n.body = n.body.split(DOK_MARKOER).join('');
    tegnKrop();
    return;
  }
  if (medTegn) {
    // Tegnet er ude af DOM'en nu (se `dokSaetMarkoer`); ud af noten ogsaa.
    dokTvingSkriv();
    if (editor.note.body.includes(DOK_MARKOER)) {
      editor.note.body = editor.note.body.split(DOK_MARKOER).join('');
    }
  }
}

/** Den blok, markoeren staar i - som linjer i noten. */
function dokBlokVedMarkoer() {
  dokTvingSkriv();
  const sel = window.getSelection();
  if (!dokAktiv() || !sel || !sel.rangeCount) return null;
  const barn = dokBarn(sel.getRangeAt(0).startContainer);
  if (!barn || barn.nodeType !== 1) return null;
  const el = barn.dataset.blok !== undefined ? barn : barn.querySelector('[data-blok]');
  if (!el) return null;
  return { fra: Number(el.dataset.blok), til: Number(el.dataset.til), slags: 'afsnit' };
}

/** Den blok, et bestemt tegn staar i (lavKodeblok's maerker). */
function dokBlokMed(tegnStart, tegnSlut) {
  const linjer = editor.note.body.split('\n');
  const i = linjer.findIndex((l) => l.includes(tegnStart));
  let j = linjer.findIndex((l) => l.includes(tegnSlut || tegnStart));
  if (i < 0) return null;
  if (j < 0) j = i;
  // Hele blokkene, maerkerne staar i - saa teksten foer og efter kommer med.
  const b = saguMarkdown.blokke(editor.note.body);
  const a = b.find((x) => x.fra <= i && i <= x.til) || { fra: i };
  const z = b.find((x) => x.fra <= j && j <= x.til) || { til: j };
  return { fra: a.fra, til: z.til, slags: 'afsnit' };
}

/* ----------------------------------------------------------- tasterne */

/*
 * Enter i en tjekliste giver et nyt PUNKT - med en boks.
 *
 * Browserens eget »nyt afsnit« deler raekken, men kopien har ingen boks
 * (knappen staar foer teksten, ikke i den), saa raekken kom til at se ud som
 * almindelig tekst, til noten blev tegnet om. Vi bygger raekken selv.
 *
 * En TOM raekke + Enter forlader listen: den bliver til et afsnit efter den.
 */
function dokNyTjekRaekke(raekke) {
  const sel = window.getSelection();
  const tekstEl = raekke.querySelector('.tjek-tekst');
  if (!sel || !sel.rangeCount || !tekstEl) return false;
  const r = sel.getRangeAt(0);
  r.deleteContents();

  if (!tekstEl.textContent.trim()) {
    const liste = raekke.parentNode;
    const p = document.createElement('p');
    p.appendChild(document.createElement('br'));
    // Raekkerne EFTER den tomme - midt i en liste deles den i to, med
    // afsnittet imellem.
    const efterRaekker = [];
    for (let k = raekke.nextElementSibling; k; k = k.nextElementSibling) efterRaekker.push(k);
    raekke.remove();
    liste.after(p);
    if (efterRaekker.length) {
      const resten = document.createElement('div');
      resten.className = liste.className;
      efterRaekker.forEach((x) => resten.appendChild(x));
      p.after(resten);
    }
    // En liste uden raekker er ingen liste.
    if (!liste.querySelector('.tjek')) liste.remove();
    const ny = document.createRange();
    ny.setStart(p, 0);
    ny.collapse(true);
    sel.removeAllRanges();
    sel.addRange(ny);
    return true;
  }

  const efter = document.createRange();
  efter.setStart(r.endContainer, r.endOffset);
  efter.setEnd(tekstEl, tekstEl.childNodes.length);
  const stump = efter.extractContents();

  const ny = document.createElement('div');
  ny.className = 'tjek';
  if (raekke.getAttribute('style')) ny.setAttribute('style', raekke.getAttribute('style'));
  if (raekke.dataset.md) ny.dataset.md = raekke.dataset.md;
  ny.innerHTML = '<button class="tjek-boks" role="checkbox" aria-checked="false" contenteditable="false"></button>'
    + '<span class="tjek-tekst"></span>';
  const nyTekst = ny.querySelector('.tjek-tekst');
  nyTekst.appendChild(stump);
  if (!nyTekst.textContent) nyTekst.appendChild(document.createElement('br'));
  raekke.after(ny);

  const m = document.createRange();
  m.setStart(nyTekst, 0);
  m.collapse(true);
  sel.removeAllRanges();
  sel.addRange(m);
  return true;
}

function dokTast(e) {
  const el = dok.el;
  if (wikiTast(e)) return;
  if (e.key === 'Escape') { e.preventDefault(); lukWikiForslag(); el.blur(); return; }

  if (e.key === 'Enter') {
    const sel = window.getSelection();
    const hvor = sel && sel.rangeCount ? sel.getRangeAt(0).startContainer : null;
    const hvorEl = hvor && (hvor.nodeType === 1 ? hvor : hvor.parentElement);
    const raekke = hvorEl && hvorEl.closest('.tjek');
    const punkt = hvorEl && hvorEl.closest('li');
    /*
     * Enter bliver i afsnittet; ⌘/Ctrl+Enter laver et nyt (F32 - Andreas'
     * egen regel, uaendret). I en LISTE er et nyt punkt det almindelige,
     * saa dér giver Enter et punkt og Shift+Enter en linje i punktet.
     */
    if (raekke && !e.shiftKey) {
      e.preventDefault();
      dokNyTjekRaekke(raekke);
      return;
    }
    // En overskrift er én linje. Enter i den giver et afsnit - ellers ville
    // naeste linje blive en del af overskriften i noten.
    const overskrift = hvorEl && hvorEl.closest('h1, h2, h3, h4, h5, h6');
    if ((punkt || overskrift) && !e.shiftKey) {
      e.preventDefault();
      nytLinjeskift(el, true);
      return;
    }
    e.preventDefault();
    nytLinjeskift(el, !e.shiftKey && (e.metaKey || e.ctrlKey));
    return;
  }

  /*
   * Backspace i starten af en blok, der staar lige efter en oe (en kodeblok,
   * en tabel) - og Delete i slutningen af en blok lige foer én - ville slette
   * HELE oeen i ét tryk: browseren ser den som ét tegn. Det er for meget for
   * en tast, man trykker for at fjerne et bogstav. Oeen slettes ved at
   * markere den eller fra dens egen menu.
   */
  if ((e.key === 'Backspace' || e.key === 'Delete') && !e.metaKey && !e.altKey && !e.ctrlKey) {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && sel.isCollapsed) {
      const r = sel.getRangeAt(0);
      const barn = dokBarn(r.startContainer);
      if (barn && barn.nodeType === 1) {
        const kant = document.createRange();
        kant.selectNodeContents(barn);
        if (e.key === 'Backspace') kant.setEnd(r.startContainer, r.startOffset);
        else kant.setStart(r.startContainer, r.startOffset);
        const nabo = e.key === 'Backspace' ? barn.previousElementSibling : barn.nextElementSibling;
        if (!kant.toString().length && dokErOe(nabo)) {
          e.preventDefault();
          // Er afsnittet selv TOMT, er det dét, man vil af med - ikke oeen.
          if (!barn.textContent.trim() && !barn.querySelector('img')) {
            const videre = e.key === 'Backspace' ? barn.nextElementSibling : barn.previousElementSibling;
            barn.remove();
            if (videre && !dokErOe(videre)) {
              const m = document.createRange();
              m.selectNodeContents(videre);
              m.collapse(e.key === 'Backspace');
              sel.removeAllRanges();
              sel.addRange(m);
            }
          }
          return;
        }
      }
    }
  }

  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
    if (e.key.toLowerCase() === 'k') { e.preventDefault(); e.stopPropagation(); dokLinkGenvej(); return; }
    const t = { b: 'strong', i: 'em', u: 'u' }[e.key.toLowerCase()];
    if (t) { e.preventDefault(); omslut(el, t); }
  }
}

/* ------------------------------------------------------------ bindingen */

function bindDokument(el, host) {
  // Et nyt afsnit er et <p>, ikke et <div> - saa oversaetteren og CSS'en
  // kender det, det ser ud som.
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch { /* aeldre browser */ }

  el.addEventListener('keydown', dokTast);
  el.addEventListener('input', () => {
    // Genvejene foerst - samme raekkefoelge som den rige blok.
    rigTekstgenvej(el);
    liveFormatering(el);
    const a = dokWikiAdapter();
    if (a) { opdaterWikiForslag(a); placerDokWiki(); } else lukWikiForslag();
  });
  el.addEventListener('paste', (e) => indsaetRent(e, el, null));
  /*
   * ⌘C/⌘X paa et markeret billede: browserens egen kopi FOERST (saa noget
   * altid naar frem), og straks efter det rigtige billede oven i - se
   * `kopierBilledeUdklip`. Tasten er brugerhandlingen, der tillader det.
   */
  const billedKopi = () => {
    const img = dokValgtBillede();
    if (img) kopierBilledeUdklip(img);
  };
  el.addEventListener('copy', billedKopi);
  el.addEventListener('cut', billedKopi);
  el.addEventListener('dragover', (e) => {
    if (e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files')) {
      e.preventDefault();
      el.classList.add('traekker');
    }
  });
  el.addEventListener('dragleave', () => el.classList.remove('traekker'));
  el.addEventListener('drop', (e) => {
    if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
    e.preventDefault();
    el.classList.remove('traekker');
    indsaetRent(e, el, null);
  });
  el.addEventListener('focus', () => { visDokVaerktoej(); });
  el.addEventListener('blur', () => {
    setTimeout(() => {
      const a = document.activeElement;
      if (a && a.closest && a.closest('#blokVaerktoej, #wikiforslag, #linkBoble')) return;
      if (dokHarFokus()) return;
      lukWikiForslag();
      skjulDokVaerktoej();
    }, 0);
  });

  /*
   * Fluebenene - delegeret, saa ogsaa en raekke, man lige har lavet med
   * Enter, virker. Klikket aendrer kun `aria-checked`; observatoeren ser det
   * og skriver noten, som ved alle andre aendringer.
   */
  el.addEventListener('mousedown', (e) => {
    if (e.target.closest('.tjek-boks')) e.preventDefault();
  });
  el.addEventListener('click', (e) => {
    const boks = e.target.closest('.tjek-boks');
    if (!boks || !el.contains(boks)) return;
    e.preventDefault();
    e.stopPropagation();
    const nu = boks.getAttribute('aria-checked') === 'true';
    boks.setAttribute('aria-checked', String(!nu));
    boks.textContent = !nu ? '✓' : '';
    if (boks.parentElement) boks.parentElement.classList.toggle('er-tjekket', !nu);
  });

}

/* --------------------------------------------------------- vaerktoejet */

/*
 * Vaerktoejslinjen svaever over den blok, markoeren staar i - til hoejre,
 * saa den daekker mindst muligt. Samme knapper som den rige blok havde; de
 * arbejder paa `#dok` i stedet for et enkelt afsnit.
 */
function visDokVaerktoej() {
  const host = document.getElementById('noteBody');
  if (!host || !dokAktiv()) return;
  let linje = document.getElementById('blokVaerktoej');
  if (linje && !linje.classList.contains('dok-vaerktoej')) return;
  if (!linje) {
    const ramme = document.createElement('div');
    ramme.innerHTML = vaerktoejslinjeHtml(true, true);
    linje = ramme.firstElementChild;
    linje.classList.add('dok-vaerktoej');
    const hj = document.createElement('button');
    hj.className = 'vt-knap vt-tekst';
    hj.type = 'button';
    hj.tabIndex = -1;
    hj.id = 'dokHjaelp';
    hj.title = 'How to write this';
    hj.setAttribute('aria-label', 'How to write this');
    hj.textContent = '?';
    // Link-knappen - ⌘K's knap, saa den ogsaa findes paa en telefon.
    const lk = document.createElement('button');
    lk.className = 'vt-knap vt-tekst';
    lk.type = 'button';
    lk.tabIndex = -1;
    lk.dataset.link = '1';
    lk.title = 'Link (⌘K)';
    lk.setAttribute('aria-label', 'Link');
    lk.textContent = 'Link';
    const md = linje.querySelector('[data-raa]');
    linje.insertBefore(lk, md || null);
    linje.appendChild(hj);
    host.appendChild(linje);
    bindDokVaerktoej(linje);
  }
  placerDokVaerktoejVedMarkoer();
}

function skjulDokVaerktoej() {
  const linje = document.getElementById('blokVaerktoej');
  if (linje && linje.classList.contains('dok-vaerktoej')) linje.remove();
  document.body.classList.remove('dok-skriver');
}

function placerDokVaerktoejVedMarkoer() {
  let linje = document.getElementById('blokVaerktoej');
  // `focus` kommer ikke altid (et vindue uden fokus, et programmatisk
  // fokus) - men markoeren flytter sig altid. Saa ogsaa herfra.
  if (!linje && dokHarFokus()) { visDokVaerktoej(); return; }
  if (!linje || !linje.classList.contains('dok-vaerktoej') || !dokHarFokus()) return;
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  /*
   * Paa en telefon staar linjen i BUNDEN, lige over tastaturet - som i
   * Noter. Over blokken daekkede den teksten over det afsnit, man skrev i,
   * og der er ingen plads i siden af paa 375 px. `visualViewport` er den
   * del af skaermen, tastaturet ikke daekker.
   */
  if (smalSkaerm()) {
    const vv = window.visualViewport;
    const under = vv ? Math.max(0, window.innerHeight - (vv.height + vv.offsetTop)) : 0;
    linje.classList.add('bund');
    linje.style.top = '';
    linje.style.bottom = `${under}px`;
    document.body.classList.add('dok-skriver');
    return;
  }
  linje.classList.remove('bund');
  linje.style.bottom = '';
  const barn = dokBarn(sel.getRangeAt(0).startContainer);
  const host = document.getElementById('noteBody');
  if (!barn || barn.nodeType !== 1 || !host) return;
  /*
   * Over den LINJE, markoeren staar paa - ikke over blokken. I et langt
   * afsnit stod linjen ellers en skaermhoejde over det, man skrev i, og var
   * afsnittet rullet op under topbjaelken, lagde den sig oven paa soegefeltet
   * (Andreas' skaermbillede, 2026-09-25). Ville den havne under bjaelken,
   * staar den UNDER markoerens linje i stedet.
   */
  const hr = host.getBoundingClientRect();
  let r = sel.getRangeAt(0).getBoundingClientRect();
  if (!r || (!r.height && !r.width)) r = barn.getBoundingClientRect();
  const bjaelke = document.querySelector('.topbar');
  const loft = bjaelke ? bjaelke.getBoundingClientRect().bottom : 0;
  const h = linje.offsetHeight;
  const over = r.top - h - 6;
  const y = over >= loft + 4 ? over : r.bottom + 6;
  linje.style.top = `${Math.round(y - hr.top)}px`;
}

function bindDokVaerktoej(linje) {
  const el = dok.el;
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };

  const filKnap = linje.querySelector('[data-fil]');
  if (filKnap) {
    filKnap.addEventListener('mousedown', stop);
    filKnap.addEventListener('click', (e) => {
      stop(e);
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.multiple = true;
      inp.style.display = 'none';
      document.body.appendChild(inp);
      inp.addEventListener('change', async () => {
        const valgte = [...inp.files];
        inp.remove();
        if (valgte.length) await indsaetFilerIBlok(valgte, el, null);
      });
      inp.click();
    });
  }
  linje.querySelectorAll('[data-genvej]').forEach((k) => {
    k.addEventListener('mousedown', (e) => {
      stop(e);
      const g = TEKSTGENVEJE.find((x) => x.ord === k.dataset.genvej);
      if (g) indsaetVedMarkoer(el, g.lav(new Date()));
    });
  });
  const tjekKnap = linje.querySelector('[data-blokform="tjekliste"]');
  if (tjekKnap) tjekKnap.addEventListener('mousedown', (e) => { stop(e); skiftTjekliste(el, null); });
  linje.querySelectorAll('[data-goer]').forEach((k) => {
    k.addEventListener('mousedown', (e) => {
      stop(e);
      if (k.dataset.goer === 'code' && markeringOverFlereLinjer()) { lavKodeblok(el, null); return; }
      omslut(el, k.dataset.goer);
    });
  });
  // MD: hele noten som markdown - dokumentet ER hele noten, saa det er det
  // omfang, knappen betyder her.
  const md = linje.querySelector('[data-raa]');
  if (md) {
    md.addEventListener('mousedown', (e) => {
      stop(e);
      const b = dokBlokVedMarkoer();
      editor.raaBlok = false;
      editor.raaNote = true;
      editor.aabenBlok = b ? b.fra : 0;
      tegnKrop();
    });
  }
  const hj = linje.querySelector('#dokHjaelp');
  if (hj) hj.addEventListener('mousedown', (e) => { stop(e); visSyntaksPanel(); });
  const lk = linje.querySelector('[data-link]');
  if (lk) lk.addEventListener('mousedown', (e) => { stop(e); dokLinkGenvej(); });
}

/* ----------------------------------------------------- [[forslag]] */

/*
 * `[[note]]`-forslagene. Samme adapter som den rige blok - men panelet
 * laegges UDEN FOR dokumentet og placeres ved markoeren. Inde i dokumentet
 * ville det blive en del af teksten.
 */
function dokWikiAdapter() {
  const a = wikiAdapter(dok.el, null);
  if (!a) return null;
  const host = document.getElementById('noteBody');
  Object.defineProperty(a, 'parentNode', { get: () => host });
  Object.defineProperty(a, 'nextSibling', { get: () => null });
  /*
   * Naar et forslag er valgt, staar `[[Titel]]` som raa tekst. Tegn om, saa
   * det bliver det link, det er - med markoeren lige efter det. Foer stod
   * de firkantede parenteser der, til noten blev aabnet igen.
   */
  a.dispatchEvent = () => { dokTegnOmVedMarkoer(); };
  return a;
}

function placerDokWiki() {
  const panel = document.getElementById('wikiforslag');
  const host = document.getElementById('noteBody');
  const sel = window.getSelection();
  if (!panel || !host || !sel || !sel.rangeCount) return;
  const r = sel.getRangeAt(0).getBoundingClientRect();
  const h = host.getBoundingClientRect();
  panel.classList.add('dok-wiki');
  panel.style.top = `${r.bottom - h.top + 6}px`;
  panel.style.left = `${Math.max(0, Math.min(r.left - h.left, h.width - 280))}px`;
}

/* --------------------------------------------------------------- klik */

/**
 * Et klik i dokumentet. Teksten er browserens - vi tager kun det, der ikke er
 * tekst: links, oeerne og det tomme areal under noten.
 *
 * @returns {boolean} sandt, hvis klikket er haandteret her.
 */
function dokKlik(e) {
  if (!dokAktiv()) return false;
  const host = document.getElementById('noteBody');
  if (e.target.closest('.blok-greb, .blok-menu, .blok-indsaet, #blokVaerktoej, #wikiforslag, #linkBoble')) return true;

  const a = e.target.closest('a');
  if (a && dok.el.contains(a)) {
    /*
     * Et klik saetter markoeren i linket, og boblen under det viser adressen
     * med »Open« og »Edit« (se link-boblen nederst). ⌘/Ctrl-klik foelger
     * linket direkte, som i de fleste editorer.
     *
     * Foer (v85's foerste udgave) fulgte et klik ALTID linket - saa kunne man
     * hverken komme ind i teksten eller naa adressen (Andreas, 2026-09-24).
     */
    e.preventDefault();
    if (e.metaKey || e.ctrlKey) foelgLink(a);
    return true;
  }

  const oe = e.target.closest('.dok-oe');
  if (oe && dok.el.contains(oe)) {
    // Knapperne paa en oe (Copy, GitHub-opdatering) klarer sig selv.
    if (e.target.closest('button, img')) return true;
    const fra = dokFra(oe);
    if (fra !== null) { dokTvingSkriv(); aabnBlok(fra); }
    return true;
  }

  // Under det sidste afsnit: markoeren til sidst i noten.
  if (e.target === host) { dokSaetMarkoer('slut'); return true; }
  return dok.el.contains(e.target);
}

// ÉN lytter for hele appen - ikke én pr. optegning.
document.addEventListener('selectionchange', placerDokVaerktoejVedMarkoer);
// Tastaturet paa en telefon aendrer den synlige del - linjen foelger med.
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', placerDokVaerktoejVedMarkoer);
  window.visualViewport.addEventListener('scroll', placerDokVaerktoejVedMarkoer);
}

/* ============================================================ link-boblen */

/*
 * »Hvordan kan jeg rette et link?« (Andreas, 2026-09-24).
 *
 * I dokumentet FULGTE et klik linket - saa man kunne hverken komme ind i
 * teksten eller naa adressen, uden at gaa over i markdown. Nu som i Google
 * Docs: et klik saetter markoeren i linket, og en boble under det viser
 * adressen med »Open«, »Edit« og »Remove link«. ⌘/Ctrl-klik foelger linket
 * direkte, og ⌘K laver et nyt af den markerede tekst.
 *
 * Boblen rører kun DOM'en (linkets tekst, `data-md`, eller pakker det ud).
 * Observatoeren ser aendringen og skriver noten - samme vej som alt andet.
 */
const linkBoble = { el: null, a: null, redigerer: false, omraade: null };

/** Det link, markoeren staar i - eller null. `[[doede]]` er et <span> og taeller ikke. */
function dokLinkVedMarkoer() {
  const sel = window.getSelection();
  if (!dokAktiv() || !sel || !sel.rangeCount) return null;
  const n = sel.getRangeAt(0).startContainer;
  const el = n.nodeType === 1 ? n : n.parentElement;
  const a = el && el.closest('a');
  return a && dok.el.contains(a) ? a : null;
}

/** Adressen, som den staar i NOTEN - ikke den, appen viser. */
function linkAdresse(a) {
  if (a.classList.contains('notelink')) return '';
  return a.getAttribute('data-md') || a.getAttribute('href') || '';
}

/** Hvad adressen er, sagt til et menneske. */
function linkVisning(a) {
  if (a.classList.contains('notelink')) return `Note: ${a.textContent}`;
  const adr = linkAdresse(a);
  const note = /^sagu-note:([a-f0-9]{32})$/.exec(adr) || /^#note-([a-f0-9]{32})$/.exec(adr);
  if (note) {
    const t = (state.tree || []).find((x) => x.id === note[1]);
    return `Note: ${t ? (t.title || 'Untitled') : 'a note'}`;
  }
  if (/^sagu:/.test(adr)) return 'Attached file';
  return adr.replace(/^https?:\/\//, '');
}

/** Foelg linket - kun til adresser, der maa foelges herfra. */
function foelgLink(a) {
  const href = a.getAttribute('href') || '';
  if (href.startsWith('#note-')) { aabnNote(href.slice(6)); return; }
  if (/^(https?:|mailto:)/i.test(href) || href.startsWith('/api/v1/files/')) {
    window.open(a.href, '_blank', 'noopener');
  }
}

function lukLinkBoble() {
  if (linkBoble.el) linkBoble.el.remove();
  linkBoble.el = null;
  linkBoble.a = null;
  linkBoble.redigerer = false;
  linkBoble.omraade = null;
}

function placerLinkBoble() {
  const b = linkBoble.el;
  const host = document.getElementById('noteBody');
  if (!b || !host) return;
  const hr = host.getBoundingClientRect();
  let r = null;
  if (linkBoble.a && linkBoble.a.isConnected) r = linkBoble.a.getBoundingClientRect();
  else if (linkBoble.omraade) r = linkBoble.omraade.getBoundingClientRect();
  if (!r) return;
  b.style.top = `${r.bottom - hr.top + 6}px`;
  b.style.left = `${Math.max(0, Math.min(r.left - hr.left, hr.width - b.offsetWidth))}px`;
}

/** Visningen: adressen og tre knapper. */
function visLinkBoble(a) {
  const host = document.getElementById('noteBody');
  if (!host) return;
  if (linkBoble.el && linkBoble.a === a && !linkBoble.redigerer) { placerLinkBoble(); return; }
  lukLinkBoble();
  const b = document.createElement('div');
  b.className = 'linkboble';
  b.id = 'linkBoble';
  const kanFoelges = !a.classList.contains('notelink') || (a.getAttribute('href') || '').startsWith('#note-');
  b.innerHTML = `
    <button type="button" class="linkboble-adr" data-lb="aabn" title="Open">${esc(linkVisning(a))}</button>
    ${kanFoelges ? '<button type="button" class="linkboble-knap" data-lb="aabn">Open</button>' : ''}
    <button type="button" class="linkboble-knap" data-lb="ret">Edit</button>
    <button type="button" class="linkboble-knap" data-lb="fjern">Remove link</button>`;
  host.appendChild(b);
  linkBoble.el = b;
  linkBoble.a = a;
  // `mousedown` + preventDefault: markoeren bliver i linket, mens man trykker.
  b.addEventListener('mousedown', (e) => { if (!e.target.closest('input')) e.preventDefault(); });
  b.querySelectorAll('[data-lb]').forEach((k) => {
    k.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const hvad = k.dataset.lb;
      if (hvad === 'aabn') { foelgLink(a); return; }
      if (hvad === 'ret') { visLinkRet(a, null); return; }
      if (hvad === 'fjern') {
        lukLinkBoble();
        pakUd(a);       // teksten bliver staaende; observatoeren skriver noten
      }
    });
  });
  placerLinkBoble();
}

/**
 * Redigeringen: tekst og adresse. `a` er et eksisterende link - eller null
 * for et NYT, og saa er `omraade` den markering, det skal laegges om.
 */
function visLinkRet(a, omraade) {
  const host = document.getElementById('noteBody');
  if (!host) return;
  lukLinkBoble();
  const notelink = !!(a && a.classList.contains('notelink'));
  const b = document.createElement('div');
  b.className = 'linkboble ret';
  b.id = 'linkBoble';
  const tekst = a ? a.textContent : (omraade ? omraade.toString() : '');
  const adr = a ? linkAdresse(a) : '';
  b.innerHTML = `
    <label class="linkboble-felt"><span>${notelink ? 'Note title' : 'Text'}</span>
      <input type="text" id="lbTekst" value="${esc(tekst)}" autocomplete="off"></label>
    ${notelink ? '' : `<label class="linkboble-felt"><span>Link</span>
      <input type="text" id="lbAdr" value="${esc(adr)}" placeholder="https://…" autocomplete="off"
        spellcheck="false"></label>`}
    <div class="linkboble-knapper">
      <button type="button" class="btn ghost" data-lb="annuller">Cancel</button>
      <button type="button" class="btn primary" data-lb="gem">${a ? 'Save' : 'Add link'}</button>
    </div>`;
  host.appendChild(b);
  linkBoble.el = b;
  linkBoble.a = a;
  linkBoble.redigerer = true;
  linkBoble.omraade = omraade;
  placerLinkBoble();

  const tekstFelt = b.querySelector('#lbTekst');
  const adrFelt = b.querySelector('#lbAdr');
  (a || tekst ? (adrFelt || tekstFelt) : tekstFelt).focus();
  (adrFelt || tekstFelt).select();

  const tilbage = () => {
    // Markoeren tilbage i noten - efter linket, eller hvor man stod.
    dok.el.focus({ preventScroll: true });
    const sel = window.getSelection();
    const r = document.createRange();
    if (linkBoble.a && linkBoble.a.isConnected) { r.setStartAfter(linkBoble.a); r.collapse(true); }
    else if (omraade) { r.setStart(omraade.endContainer, omraade.endOffset); r.collapse(true); }
    else return;
    sel.removeAllRanges();
    sel.addRange(r);
  };

  const gem = () => {
    const nyTekst = tekstFelt.value.trim();
    const nyAdr = adrFelt ? adrFelt.value.trim() : '';
    if (!notelink && !nyAdr) {
      // Uden adresse er det ikke et link. Et eksisterende pakkes ud.
      if (a) { const x = a; lukLinkBoble(); pakUd(x); } else lukLinkBoble();
      dok.el.focus({ preventScroll: true });
      return;
    }
    let el = a;
    if (!el) {
      el = document.createElement('a');
      if (omraade) { omraade.deleteContents(); omraade.insertNode(el); } else return;
    }
    el.textContent = nyTekst || (notelink ? el.textContent : nyAdr);
    if (!notelink) {
      /*
       * Adressen staar i `data-md` - det er den, oversaetteren skriver. `href`
       * er kun til at foelge linket herfra, og kun til det, der MAA foelges:
       * en `javascript:`-adresse bliver aldrig et href (se `sikkerUrl`).
       */
      el.setAttribute('data-md', nyAdr);
      el.removeAttribute('data-auto');
      el.removeAttribute('data-tom');
      el.removeAttribute('data-billede');
      const note = /^sagu-note:([a-f0-9]{32})$/.exec(nyAdr);
      if (note) el.setAttribute('href', `#note-${note[1]}`);
      else if (/^(https?:\/\/|mailto:)/i.test(nyAdr)) el.setAttribute('href', nyAdr);
      else el.setAttribute('href', '#');
      if (/^https?:/i.test(nyAdr)) { el.target = '_blank'; el.rel = 'noopener noreferrer'; }
    }
    linkBoble.a = el;
    tilbage();
    lukLinkBoble();
  };

  b.querySelector('[data-lb="gem"]').addEventListener('click', (e) => { e.preventDefault(); gem(); });
  b.querySelector('[data-lb="annuller"]').addEventListener('click', (e) => {
    e.preventDefault();
    tilbage();
    lukLinkBoble();
  });
  b.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); gem(); }
    if (e.key === 'Escape') { e.preventDefault(); tilbage(); lukLinkBoble(); }
  });
}

/** ⌘K: ret linket, markoeren staar i - eller lav et af det markerede. */
function dokLinkGenvej() {
  const a = dokLinkVedMarkoer();
  if (a) { visLinkRet(a, null); return; }
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const r = sel.getRangeAt(0);
  // Et link ligger INDE i ét afsnit - en markering over to afsnit kan ikke
  // blive ét link. Saa markeres kun det, der staar i det foerste.
  if (dokBarn(r.startContainer) !== dokBarn(r.endContainer)) {
    const barn = dokBarn(r.startContainer);
    if (barn) r.setEnd(barn, barn.childNodes.length);
  }
  visLinkRet(null, r.cloneRange());
}

/* Boblen foelger markoeren: i et link vises den, ude af det lukker den. */
document.addEventListener('selectionchange', () => {
  if (linkBoble.redigerer) return;
  if (!dokHarFokus()) {
    const a = document.activeElement;
    if (!(a && a.closest && a.closest('#linkBoble'))) lukLinkBoble();
    return;
  }
  // Et markeret billede har sin egen boble (se billederne nedenfor).
  if (dokValgtBillede()) return;
  const a = dokLinkVedMarkoer();
  if (a) visLinkBoble(a); else lukLinkBoble();
});

/* ============================================================== billeder */

/*
 * »Hvordan sletter jeg billeder eller markerer dem, saa jeg kan kopiere og
 * flytte dem rundt?« (Andreas, 2026-09-24).
 *
 * Et klik paa et billede aabnede det stort, og saa var der ingen vej til at
 * markere det. Nu er billedet en MARKERING som alt andet: et klik lægger
 * markeringen om billedet, og saa virker Backspace, ⌘C, ⌘X og ⌘V, som de
 * goer paa tekst. Et billede kan ogsaa traekkes et andet sted hen i noten -
 * det er browserens eget traek, og observatoeren ser begge afsnit aendre sig.
 *
 * Kopien bevarer billedet: det markerede har `data-md` (`sagu:<id>`), og
 * indsaet laeser HTML'en gennem `tilMarkdown`, som skriver den adresse.
 */
function dokMarkerBillede(img) {
  if (!dokAktiv()) return;
  dok.el.focus({ preventScroll: true });
  const r = document.createRange();
  r.selectNode(img);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  visBilledBoble(img);
}

/**
 * Billedet paa udklipsholderen - som et BILLEDE, ikke kun som HTML.
 *
 * »Naar jeg proever at copy og paste et billede ind i fx Claude-appen, saa
 * faar jeg [kun navnet]« (Andreas, 2026-09-25). Browserens egen kopi af et
 * markeret <img> er HTML med en adresse bag login og alt-teksten - andre
 * programmer kan hverken hente adressen eller bruge HTML'en.
 *
 * Derfor BEGGE: `image/png` til alle andre programmer, og `text/html` med
 * billedets `data-md` (`sagu:<id>`), saa et indsaet i Sagu bliver det SAMME
 * billede og ikke en ny fil (se `indsaetRent`). PNG, fordi det er det eneste
 * billedformat, udklipsholderen tager overalt; `tilPngBlob` omsaetter.
 *
 * Loeftet gives til `ClipboardItem` MED DET SAMME, inde i klikket/tasten -
 * Safari naegter en skrivning, der foerst kommer efter et `await`.
 */
async function kopierBilledeUdklip(img) {
  if (!navigator.clipboard || !window.ClipboardItem) return false;
  const src = img.getAttribute('src');
  const html = `<img src="${esc(img.src)}" alt="${esc(img.getAttribute('alt') || '')}"${
    img.dataset.md ? ` data-md="${esc(img.dataset.md)}"` : ''}>`;
  const htmlBlob = new Blob([html], { type: 'text/html' });
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': tilPngBlob(src), 'text/html': htmlBlob })]);
    return true;
  } catch (ex1) {
    // Nogle browsere tager kun ét format ad gangen - saa er billedet det vigtigste.
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': tilPngBlob(src) })]);
      return true;
    } catch (ex2) {
      // Hvad browseren sagde, staar i konsollen - »kunne ikke« alene er svaert
      // at fejlsoege paa en maskine, man ikke sidder ved.
      if (window.console) console.warn('billedkopi afvist', ex1 && ex1.message, ex2 && ex2.message);
      return false;
    }
  }
}

/** Det billede, markeringen er - praecis ét, og intet andet. */
function dokValgtBillede() {
  const sel = window.getSelection();
  if (!dokAktiv() || !sel || !sel.rangeCount || sel.isCollapsed) return null;
  const r = sel.getRangeAt(0);
  if (r.startContainer !== r.endContainer || r.endOffset - r.startOffset !== 1) return null;
  const n = r.startContainer.childNodes[r.startOffset];
  return n && n.nodeName === 'IMG' && dok.el.contains(n) ? n : null;
}

function visBilledBoble(img) {
  const host = document.getElementById('noteBody');
  if (!host) return;
  if (linkBoble.el && linkBoble.a === img) { placerLinkBoble(); return; }
  lukLinkBoble();
  dok.el.querySelectorAll('img.valgt').forEach((x) => x.classList.remove('valgt'));
  img.classList.add('valgt');
  const b = document.createElement('div');
  b.className = 'linkboble';
  b.id = 'linkBoble';
  b.innerHTML = `
    <button type="button" class="linkboble-knap" data-bb="vis">View</button>
    <button type="button" class="linkboble-knap" data-bb="kopi">Copy</button>
    <button type="button" class="linkboble-knap farlig" data-bb="slet">Delete</button>
    <span class="linkboble-hint meta">Drag to move · ⌘X ⌘V</span>`;
  host.appendChild(b);
  linkBoble.el = b;
  linkBoble.a = img;
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.querySelectorAll('[data-bb]').forEach((k) => {
    k.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const hvad = k.dataset.bb;
      if (hvad === 'vis') { visLightbox(img.getAttribute('src'), img.getAttribute('alt')); return; }
      if (hvad === 'kopi') {
        kopierBilledeUdklip(img).then((ok) => {
          toast(ok ? 'Image copied — paste it here or in any other app.'
            : 'Could not copy the image here — use View, then Copy image.');
        });
        return;
      }
      if (hvad === 'slet') {
        lukLinkBoble();
        dokMarkerBillede(img);
        // Gennem browserens egen sletning, saa ⌘Z bringer billedet tilbage.
        if (!document.execCommand('delete')) img.remove();
        lukLinkBoble();
        toast('Image removed. ⌘Z brings it back.');
      }
    });
  });
  placerLinkBoble();
}

/* Markeringen af et billede kan ses - og boblen gaar, naar markeringen gaar. */
document.addEventListener('selectionchange', () => {
  if (!dokAktiv()) return;
  const img = dokValgtBillede();
  dok.el.querySelectorAll('img.valgt').forEach((x) => { if (x !== img) x.classList.remove('valgt'); });
  if (img) { img.classList.add('valgt'); visBilledBoble(img); return; }
  if (linkBoble.a && linkBoble.a.nodeName === 'IMG' && !linkBoble.redigerer) lukLinkBoble();
});
