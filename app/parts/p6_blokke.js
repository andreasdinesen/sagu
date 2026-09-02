'use strict';
/* Sagu - Notion-foelelsen oven paa den hybride editor (F3).
 *
 * Alt herinde arbejder paa MARKDOWN-kilden. Der findes ingen anden
 * repraesentation: en kopier-knap laeser blokkens kilde, et afkrydsningsfelt
 * skriver `[ ]` om til `[x]` paa sit linjenummer, og et indsat billede bliver
 * til `![navn](sagu:<id>)`. Alt hvad editoren kan, overlever derfor en rundtur
 * gennem markdown - og hvad markdown ikke kan sige, tilbyder editoren ikke. */

/* ------------------------------------------------ kodeblokkenes knapper */

/*
 * ÉN definition af, hvad en kodeblok INDEHOLDER.
 *
 * Verdandes dyreste fejl her: en kopier-knap inde i `<pre>` og en
 * syntaksfarver, der laeser `textContent`, blev uenige - et klik paa »Copy«
 * skrev ordet *Copied* ind i koden, og naeste gem lagde det paa disken.
 * Derfor ligger knappen UDEN FOR `<pre>`, og indholdet laeses ét sted.
 */
function kodeIndhold(pre) {
  const kode = pre.querySelector('code');
  return kode ? kode.textContent : pre.textContent;
}

/**
 * Kopiknap paa `inline kode`, som paa en kodeblok.
 *
 * »Jeg vil gerne have en copi knap ved `inline code` som ved Code block«
 * (Andreas, 2026-08-25).
 *
 * ── Tre ting, den ikke maa oedelaegge ─────────────────────────────────────
 *
 * 1. **Teksten maa ikke flytte sig.** Knappen ligger `position: absolute` ved
 *    kodens hoejre kant og fylder derfor ingenting i linjen. Reserverede vi
 *    plads i stedet, ville hver eneste kodestump i hver eneste note blive
 *    bredere - en fast afgift for noget, man goer sjaeldent.
 *
 * 2. **Man skal stadig kunne klikke paa koden for at rette den.** Derfor er
 *    det en KNAP ved siden af og ikke selve `<code>`, der kopierer. Gjorde
 *    koden det, ville et afsnit, der KUN bestaar af en kodestump, ikke kunne
 *    aabnes med et klik overhovedet.
 *
 * 3. **Klikket maa ikke aabne blokken.** `stopPropagation` - samme greb som
 *    kodeblokkens knap og fluebenene.
 *
 * Paa touch findes hover ikke, og knappen vises derfor ikke. Det er ikke en
 * mangel, det er den samme vej som hidtil: et tryk aabner blokken som raa
 * markdown, og dér kan man markere. En knap, der stod fremme paa hver eneste
 * kodestump paa en telefon, ville vaere stoej i hver eneste saetning.
 */
function pyntInlineKode(host) {
  for (const kode of host.querySelectorAll('code')) {
    if (kode.closest('pre')) continue;                    // kodeblokken har sin egen
    if (kode.parentElement && kode.parentElement.classList.contains('inlinekode')) continue;

    const ramme = document.createElement('span');
    ramme.className = 'inlinekode';
    kode.parentNode.insertBefore(ramme, kode);
    ramme.appendChild(kode);

    const knap = document.createElement('button');
    knap.className = 'inlinekode-kopi';
    knap.type = 'button';
    knap.tabIndex = -1;             // ikke i tabuleringen: der kan vaere mange
    knap.title = 'Copy';
    knap.setAttribute('aria-label', `Copy ${kode.textContent}`);
    knap.innerHTML = icon('copy', 12);
    knap.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      const ok = await kopier(kode.textContent);
      knap.classList.add('kopieret');
      knap.title = ok ? 'Copied' : 'Press ⌘C';
      setTimeout(() => { knap.classList.remove('kopieret'); knap.title = 'Copy'; }, 1400);
    });
    ramme.appendChild(knap);
  }
}

function pyntKodeblokke(host) {
  for (const pre of host.querySelectorAll('pre')) {
    if (pre.parentElement && pre.parentElement.classList.contains('kodeblok')) continue;
    const kode = pre.querySelector('code');
    const sprog = (kode && (kode.className.match(/language-([\w+-]+)/) || [])[1]) || '';

    const ramme = document.createElement('div');
    ramme.className = 'kodeblok';
    // Blok-attributten flyttes UD paa rammen, saa et klik paa knapraekken
    // ikke aabner blokken raat.
    if (pre.dataset.blok !== undefined) {
      ramme.dataset.blok = pre.dataset.blok;
      ramme.dataset.til = pre.dataset.til || pre.dataset.blok;
      delete pre.dataset.blok;
      delete pre.dataset.til;
    }
    pre.parentNode.insertBefore(ramme, pre);
    ramme.appendChild(pre);

    const linje = document.createElement('div');
    linje.className = 'kodeblok-top';
    linje.innerHTML = `<span class="kodeblok-sprog meta">${esc(sprog || 'text')}</span>`;
    const knap = document.createElement('button');
    knap.className = 'kodeblok-kopi';
    knap.type = 'button';
    knap.textContent = 'Copy';
    knap.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await kopier(kodeIndhold(pre));
      knap.textContent = ok ? 'Copied' : 'Press ⌘C';
      setTimeout(() => { knap.textContent = 'Copy'; }, 1600);
    });
    linje.appendChild(knap);
    ramme.insertBefore(linje, pre);
  }
}

/**
 * Kopierer til udklipsholderen - med en vej ud, naar det ikke kan lade sig goere.
 *
 * `navigator.clipboard` kraever et secure context, og panelet tilgaas paa
 * IP:port over http. En kopi-knap, der melder »kunne ikke kopiere« og saa
 * ikke goer mere, er en blindgyde: fallbacken MARKERER teksten, saa brugeren
 * selv kan trykke ⌘C (RUNE-ERFARINGER, tools v1).
 */
async function kopier(tekst) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(tekst);
      return true;
    }
  } catch { /* falder igennem */ }
  try {
    const felt = document.createElement('textarea');
    felt.value = tekst;
    felt.style.cssText = 'position:fixed;top:-1000px';
    document.body.appendChild(felt);
    felt.select();
    const ok = document.execCommand('copy');
    felt.remove();
    if (ok) return true;
  } catch { /* falder igennem */ }
  return false;
}

/** Markerer et element, saa brugeren kan trykke ⌘C selv. */
function markerTekst(el) {
  try {
    const r = document.createRange();
    r.selectNodeContents(el);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    return String(s).length > 0;
  } catch { return false; }
}

/* ------------------------------------------------------ afkrydsningsfelter */

function bindTjek(host) {
  // Tredje sted, en redigering kan begynde - se maaRette() (F11).
  if (!maaRette(editor.note)) return;
  host.querySelectorAll('[data-tjek]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();       // maa ikke ogsaa aabne blokken raat
      const linje = Number(el.dataset.tjek);
      const nu = el.getAttribute('aria-checked') === 'true';
      editor.note.body = saguMarkdown.saetTjek(editor.note.body, linje, !nu);
      // Tegn KUN raekken om, ikke hele noten: en fuld optegning ville flytte
      // rullepositionen og lukke en aaben blok.
      el.setAttribute('aria-checked', String(!nu));
      el.textContent = !nu ? '✓' : '';
      el.parentElement.classList.toggle('er-tjekket', !nu);
      markerBeskidt();
    });
  });
}

/* --------------------------------------------------------------- lightbox */

/*
 * Klik paa et billede aabner det stort (krav 7).
 *
 * Esc og swipe lukker (F3's accept). Swipe hoerer med, fordi en telefon ikke
 * har en Esc-tast - og et billede i fuld skaerm uden en synlig vej ud er en
 * blindgyde. Derfor er der ogsaa en lukkeknap.
 */
function visLightbox(src, alt) {
  const gammel = document.getElementById('lightbox');
  if (gammel) gammel.remove();

  const boks = document.createElement('div');
  boks.className = 'lightbox';
  boks.id = 'lightbox';
  boks.innerHTML = `
    <div class="lightbox-vaerktoej">
      <button class="lightbox-knap" id="lbKopi">${icon('copy', 16)}<span>Copy image</span></button>
      <a class="lightbox-knap" id="lbAaben" href="${esc(src)}" target="_blank"
         rel="noopener">${icon('out', 16)}<span>Open</span></a>
      <button class="lightbox-luk" aria-label="Close">${icon('luk', 20)}</button>
    </div>
    <img src="${esc(src)}" alt="${esc(alt || '')}">
    ${alt ? `<div class="lightbox-tekst meta saetning">${esc(alt)}</div>` : ''}`;
  document.body.appendChild(boks);

  const luk = () => {
    boks.remove();
    document.removeEventListener('keydown', paaTast);
  };
  const paaTast = (e) => { if (e.key === 'Escape') { e.preventDefault(); luk(); } };
  document.addEventListener('keydown', paaTast);

  boks.querySelector('.lightbox-luk').addEventListener('click', luk);
  const kopiKnap = boks.querySelector('#lbKopi');
  kopiKnap.addEventListener('click', (e) => { e.stopPropagation(); kopierBillede(src, kopiKnap); });
  // Et klik paa »Open« maa ikke ogsaa lukke ruden bagved.
  boks.querySelector('#lbAaben').addEventListener('click', (e) => e.stopPropagation());
  // Klik paa baggrunden lukker; klik paa selve billedet goer ikke.
  boks.addEventListener('click', (e) => { if (e.target === boks) luk(); });

  // Swipe. pointer-events virker ens paa mus, pen og finger - HTML5 drag
  // findes ikke paa touch (RUNE-ERFARINGER §4).
  let start = null;
  boks.addEventListener('pointerdown', (e) => { start = { x: e.clientX, y: e.clientY }; });
  boks.addEventListener('pointerup', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    start = null;
    if (Math.hypot(dx, dy) > 80) luk();
  });
  return boks;
}

function bindBilleder(host) {
  host.querySelectorAll('img.note-img').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      visLightbox(el.getAttribute('src'), el.getAttribute('alt'));
    });
  });
}

/* ------------------------------------------------------------- indsaetning */

/*
 * Hvad der sker, naar man indsaetter i en aaben blok.
 *
 * Raekkefoelgen er ikke tilfaeldig - den gaar fra mest specifikt til mindst:
 *
 *   1. **Filer** (et billede fra udklipsholderen eller et traek) -> upload.
 *   2. **En adresse over MARKERET tekst** -> `[markeringen](adressen)`.
 *      Det er den eneste maade at faa et link uden at skrive parenteser.
 *   3. **En bar adresse** -> `[pent navn](adressen)`, saa en 200 tegn lang
 *      Notion-adresse ikke fylder en hel linje.
 *   4. **HTML fra en browser** -> markdown. Browseren laegger BAADE `text/html`
 *      og `text/plain` i udklipsholderen; den rene tekst har tabt
 *      overskrifter og links, saa HTML'en er den rigtige kilde, naar den er der.
 *   5. **Ren tekst** -> ordret. Markdown er allerede vores format, saa der er
 *      intet at konvertere - det er hele pointen med at gemme markdown.
 */
async function haandterIndsaet(e, felt) {
  const dt = e.clipboardData || e.dataTransfer;
  if (!dt) return false;

  const filer = [...(dt.files || [])];
  if (filer.length) {
    e.preventDefault();
    for (const f of filer) await indsaetFil(f, felt);
    return true;
  }

  const html = dt.getData('text/html');
  const tekst = dt.getData('text/plain');
  const markeret = felt.value.slice(felt.selectionStart, felt.selectionEnd);
  const url = saguMarkdown.sikkerUrl((tekst || '').trim());

  if (url && markeret) {
    e.preventDefault();
    indsaetITekst(felt, `[${markeret}](${url})`);
    return true;
  }
  if (url && !markeret) {
    e.preventDefault();
    /*
     * En adresse ALENE paa en linje bliver staaende bar.
     *
     * To af Sagus egne funktioner arbejdede mod hinanden: F3 goer en indsat
     * adresse til et paent link (`[navn](url)`), og F12 goer en BAR
     * GitHub-adresse paa sin egen linje til selve koden. Saa snart man
     * indsatte et GitHub-link, lavede F3 det om - og indlejringen kunne
     * aldrig ske. »Hvad goer jeg forkert?« var det rigtige spoergsmaal, og
     * svaret var: ingenting (Andreas, 2026-08-21).
     *
     * Reglen er den samme, som indlejringen selv bruger: et link INDE i en
     * saetning skal have et navn, en adresse alene paa en linje skal ikke.
     */
    const foer = felt.value.slice(0, felt.selectionStart);
    const efter = felt.value.slice(felt.selectionEnd);
    const alenePaaLinjen = !/[^\n]$/.test(foer) && !/^[^\n]/.test(efter);
    if (alenePaaLinjen && saguGithub.tolk(url)) {
      indsaetITekst(felt, url);
      return true;
    }
    indsaetITekst(felt, `[${saguMarkdown.pentNavn(url)}](${url})`);
    return true;
  }
  if (html && html.trim()) {
    const md = htmlTilMarkdown(html);
    // Kun hvis omsaetningen faktisk gav noget MERE end den rene tekst -
    // ellers er den rene tekst det aerligste valg.
    if (md && md.trim() && md.trim() !== (tekst || '').trim()) {
      e.preventDefault();
      indsaetITekst(felt, md);
      return true;
    }
  }
  return false;      // lad browseren indsaette den rene tekst
}

function indsaetITekst(felt, tekst) {
  const a = felt.selectionStart;
  const b = felt.selectionEnd;
  felt.value = felt.value.slice(0, a) + tekst + felt.value.slice(b);
  const pos = a + tekst.length;
  felt.setSelectionRange(pos, pos);
  felt.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * HTML fra en browser -> markdown.
 *
 * Bevidst lille: den daekker de blokke, editoren selv kan (samme regel som
 * Verdandes spec - hvad markdown ikke kan sige, maa der ikke findes en vej
 * til). Alt andet bliver til den tekst, det indeholdt.
 *
 * Der parses med `DOMParser` i et INERT dokument: scripts koerer ikke, og
 * billeder hentes ikke. Vi laeser kun struktur og tekst, og resultatet er
 * markdown - som derefter gaar gennem vores egen renderer med hvidliste.
 */
function htmlTilMarkdown(html) {
  let dok;
  try { dok = new DOMParser().parseFromString(html, 'text/html'); } catch { return ''; }
  if (!dok || !dok.body) return '';

  const inline = (el) => {
    let ud = '';
    for (const n of el.childNodes) {
      if (n.nodeType === 3) { ud += n.nodeValue.replace(/\s+/g, ' '); continue; }
      if (n.nodeType !== 1) continue;
      const t = n.tagName.toLowerCase();
      const indre = inline(n);
      if (t === 'strong' || t === 'b') ud += indre.trim() ? `**${indre.trim()}**` : '';
      else if (t === 'em' || t === 'i') ud += indre.trim() ? `*${indre.trim()}*` : '';
      else if (t === 'del' || t === 's' || t === 'strike') ud += indre.trim() ? `~~${indre.trim()}~~` : '';
      else if (t === 'code') ud += indre.trim() ? `\`${indre.trim()}\`` : '';
      else if (t === 'br') ud += '\n';
      else if (t === 'a') {
        const href = saguMarkdown.sikkerUrl(n.getAttribute('href') || '');
        ud += href ? `[${indre.trim() || saguMarkdown.pentNavn(href)}](${href})` : indre;
      } else if (t === 'img') {
        const src = saguMarkdown.sikkerUrl(n.getAttribute('src') || '');
        if (src) ud += `![${(n.getAttribute('alt') || '').replace(/[[\]]/g, '')}](${src})`;
      } else ud += indre;
    }
    return ud;
  };

  const blokke = [];
  const gaa = (el, dybde) => {
    for (const n of el.children) {
      const t = n.tagName.toLowerCase();
      if (/^h[1-6]$/.test(t)) { blokke.push(`${'#'.repeat(Number(t[1]))} ${inline(n).trim()}`); continue; }
      if (t === 'pre') {
        const sprog = (n.querySelector('code')?.className.match(/language-([\w+-]+)/) || [])[1] || '';
        blokke.push(`\`\`\`${sprog}\n${n.textContent.replace(/\n+$/, '')}\n\`\`\``);
        continue;
      }
      if (t === 'blockquote') { blokke.push(inline(n).trim().split('\n').map((l) => `> ${l}`).join('\n')); continue; }
      if (t === 'ul' || t === 'ol') {
        const punkter = [];
        let nr = 1;
        for (const li of n.children) {
          if (li.tagName.toLowerCase() !== 'li') continue;
          const maerke = t === 'ol' ? `${nr}. ` : '- ';
          nr++;
          punkter.push('  '.repeat(dybde) + maerke + inline(li).trim());
          const under = li.querySelector(':scope > ul, :scope > ol');
          if (under) { gaa(li, dybde + 1); }
        }
        if (punkter.length) blokke.push(punkter.join('\n'));
        continue;
      }
      if (t === 'table') {
        const raekker = [...n.querySelectorAll('tr')].map((tr) =>
          [...tr.children].map((c) => inline(c).trim().replace(/\|/g, '\\|')));
        if (raekker.length) {
          const bredde = Math.max(...raekker.map((r) => r.length));
          const linjer = [`| ${raekker[0].join(' | ')} |`, `|${' --- |'.repeat(bredde)}`];
          for (const r of raekker.slice(1)) linjer.push(`| ${r.join(' | ')} |`);
          blokke.push(linjer.join('\n'));
        }
        continue;
      }
      if (t === 'hr') { blokke.push('---'); continue; }
      if (['div', 'section', 'article', 'main', 'body'].includes(t)) { gaa(n, dybde); continue; }
      const tekst = inline(n).trim();
      if (tekst) blokke.push(tekst);
    }
  };
  gaa(dok.body, 0);
  return blokke.filter(Boolean).join('\n\n');
}

/* ---------------------------------------------------------- billed-upload */

/**
 * Skalerer og uploader et billede.
 *
 * **Skaleringen sker i BROWSEREN** - Node kan ikke skalere uden pakker
 * (RUNE-ERFARINGER §6c). Og PNG bliver PNG: en JPEG-fallback goer transparens
 * SORT, saa output-typen vaelges efter input-typen.
 */
async function indsaetFil(fil, felt) {
  const erBillede = /^image\/(png|jpeg|gif|webp|avif)$/.test(fil.type);
  try {
    let krop = fil;
    let type = fil.type || 'application/octet-stream';
    let maal = { w: 0, h: 0 };
    if (erBillede && fil.type !== 'image/gif') {
      const skaleret = await skalerBillede(fil);
      if (skaleret) { krop = skaleret.blob; type = skaleret.type; maal = skaleret; }
    }
    const q = new URLSearchParams({ name: fil.name || 'image.png' });
    if (editor.note) q.set('note', editor.note.id);
    if (maal.w) { q.set('w', maal.w); q.set('h', maal.h); }

    const res = await fetch(`/api/v1/files?${q}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-Sagu-Upload': '1', 'Content-Type': type },
      body: krop,
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.message || 'Upload failed');

    // `sagu:<id>` frem for en absolut adresse: noten skal kunne flyttes med
    // til et andet domaene (wikien, en eksport) uden at billederne doer.
    const md = d.file.inline
      ? `![${(fil.name || 'image').replace(/[[\]]/g, '')}](sagu:${d.file.id})`
      : `[${d.file.name}](sagu:${d.file.id})`;
    if (felt) indsaetITekst(felt, md);
    return d.file;
  } catch (ex) {
    toast(ex.message);
    return null;
  }
}

/** Skalerer til hoejst 1600 px paa den laengste led. Returnerer null hvis unoedvendigt. */
function skalerBillede(fil) {
  const MAX = 1600;
  return new Promise((ok) => {
    const url = URL.createObjectURL(fil);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const skala = Math.min(1, MAX / Math.max(img.width, img.height));
      // Et lille billede skal IKKE gennem canvas: en rundtur ville
      // rekomprimere det uden gevinst.
      if (skala === 1 && fil.size < 900 * 1024) { ok(null); return; }
      const w = Math.round(img.width * skala);
      const h = Math.round(img.height * skala);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      // PNG bliver PNG. En JPEG-fallback goer transparens sort (§4).
      const type = fil.type === 'image/png' ? 'image/png' : 'image/jpeg';
      c.toBlob((blob) => ok(blob ? { blob, type, w, h } : null), type,
        type === 'image/jpeg' ? 0.86 : undefined);
    };
    img.onerror = () => { URL.revokeObjectURL(url); ok(null); };
    img.src = url;
  });
}

/* ------------------------------------------------- [[ ]]-autoudfyldning */

const wiki = { host: null, valgt: 0, traef: [], felt: null, start: -1 };

/** Staar markoeren inde i et uafsluttet `[[`? */
function wikiVedCaret(felt) {
  const foer = felt.value.slice(0, felt.selectionStart);
  const i = foer.lastIndexOf('[[');
  if (i < 0) return null;
  // Er der lukket efter, er vi ikke inde i den laengere.
  if (foer.slice(i).includes(']]')) return null;
  const delvist = foer.slice(i + 2);
  if (delvist.includes('\n')) return null;
  return { start: i, delvist };
}

function opdaterWikiForslag(felt) {
  const t = wikiVedCaret(felt);
  lukWikiForslag();
  if (!t) return;
  const q = t.delvist.toLowerCase();
  // Det, der BEGYNDER med det skrevne, foerst. Til FULDFOERELSE er
  // »indeholder« en faelde, fordi man skriver forfra (doda v30).
  wiki.traef = (state.tree || [])
    .filter((n) => !q || (n.title || '').toLowerCase().includes(q))
    .sort((a, b) => {
      const aa = (a.title || '').toLowerCase().startsWith(q) ? 0 : 1;
      const bb = (b.title || '').toLowerCase().startsWith(q) ? 0 : 1;
      return aa - bb || (a.title || '').localeCompare(b.title || '');
    })
    .slice(0, 6);
  if (!wiki.traef.length) return;

  wiki.felt = felt;
  wiki.start = t.start;
  wiki.valgt = 0;
  const host = document.createElement('div');
  host.className = 'wikiforslag';
  host.id = 'wikiforslag';
  tegnWikiForslag(host);
  felt.parentNode.insertBefore(host, felt.nextSibling);
  wiki.host = host;
}

function tegnWikiForslag(host) {
  (host || wiki.host).innerHTML = wiki.traef.map((n, i) => `
    <button class="wikiforslag-row${i === wiki.valgt ? ' on' : ''}" data-wiki="${i}">
      ${esc(n.title || 'Untitled')}</button>`).join('');
  (host || wiki.host).querySelectorAll('[data-wiki]').forEach((el) => {
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('click', () => vaelgWiki(Number(el.dataset.wiki)));
  });
}

function vaelgWiki(i) {
  const n = wiki.traef[i];
  const felt = wiki.felt;
  if (!n || !felt) return;
  const ind = `[[${n.title}]]`;
  felt.value = felt.value.slice(0, wiki.start) + ind + felt.value.slice(felt.selectionStart);
  const pos = wiki.start + ind.length;
  felt.setSelectionRange(pos, pos);
  lukWikiForslag();
  felt.dispatchEvent(new Event('input', { bubbles: true }));
  felt.focus();
}

function lukWikiForslag() {
  if (wiki.host) { wiki.host.remove(); wiki.host = null; }
  wiki.traef = [];
}

function wikiTast(e) {
  if (!wiki.host || !wiki.traef.length) return false;
  if (e.key === 'ArrowDown') { e.preventDefault(); wiki.valgt = (wiki.valgt + 1) % wiki.traef.length; tegnWikiForslag(); return true; }
  if (e.key === 'ArrowUp') { e.preventDefault(); wiki.valgt = (wiki.valgt - 1 + wiki.traef.length) % wiki.traef.length; tegnWikiForslag(); return true; }
  if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); vaelgWiki(wiki.valgt); return true; }
  if (e.key === 'Escape') { e.preventDefault(); lukWikiForslag(); return true; }
  return false;
}

/* ------------------------------------------------------------ skabeloner */

/*
 * Skabelonerne er ren markdown. Det er hele pointen: de kan rettes af
 * brugeren bagefter, de overlever en eksport, og de kraever ingen kode.
 */
const SKABELONER = [
  {
    id: 'meeting',
    navn: 'Meeting notes',
    titel: () => `Meeting ${new Date().toISOString().slice(0, 10)}`,
    krop: () => ['## Present', '', '- ', '', '## Agenda', '', '1. ', '',
      '## Decisions', '', '- ', '', '## Actions', '', '- [ ] ', ''].join('\n'),
  },
  {
    id: 'weekly',
    navn: 'Weekly log',
    titel: () => {
      const d = new Date();
      const start = new Date(d.getFullYear(), 0, 1);
      const uge = Math.ceil(((d - start) / 86400000 + start.getDay() + 1) / 7);
      return `Week ${uge}, ${d.getFullYear()}`;
    },
    krop: () => ['## Done', '', '- ', '', '## In progress', '', '- ', '',
      '## Next week', '', '- [ ] ', '', '## Notes', '', ''].join('\n'),
  },
  {
    id: 'project',
    navn: 'Project note',
    titel: () => 'New project',
    krop: () => ['> [!NOTE]', '> One sentence on what "done" looks like.', '',
      '## Background', '', '', '## Open questions', '', '- ', '',
      '## Decisions', '', '| Date | Decision | Why |', '|---|---|---|', '|  |  |  |', '',
      '## Tasks', '', '- [ ] ', ''].join('\n'),
  },
];

/**
 * Dagens note.
 *
 * Én tast aabner dagens note - »den vane, der faar en second brain til at
 * blive brugt frem for at blive sat op« (SAGU-PLAN §8). Findes den, aabnes
 * den; ellers oprettes den. Titlen er datoen, saa den kan findes igen.
 */
async function aabnDagensNote() {
  const i_dag = new Date();
  const iso = `${i_dag.getFullYear()}-${String(i_dag.getMonth() + 1).padStart(2, '0')}-${String(i_dag.getDate()).padStart(2, '0')}`;
  const titel = iso;
  const fundet = (state.tree || []).find((n) => n.title === titel);
  if (fundet) { await aabnNote(fundet.id); return; }
  const dag = i_dag.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  await opretOgAaben({ title: titel, body: `# ${dag}\n\n` });
}

async function opretFraSkabelon(id) {
  const s = SKABELONER.find((x) => x.id === id);
  if (!s) return;
  await opretOgAaben({ title: s.titel(), body: s.krop() });
}

/* --------------------------------------------------------- emoji-ikoner */

/*
 * Et lille, fast udvalg frem for en fuld emoji-vaelger.
 *
 * En rigtig vaelger er en liste paa tusindvis af tegn med soegning paa flere
 * sprog - og et ikon paa en note skal vaelges paa to sekunder. Feltet tager
 * desuden hvad som helst, saa den, der vil have et andet, kan indsaette det.
 */
const IKONER = ['📄', '📓', '🔧', '🖥', '🌐', '🔐', '📊', '📌', '💡', '⚠️', '✅', '🗂',
  '📅', '☕', '🌱', '🚀', '🐛', '📞', '💬', '🏠', '🔍', '⭐', '🧪', '📦'];

function visIkonVaelger(anker, nuvaerende, gem) {
  const gammel = document.getElementById('ikonvaelger');
  if (gammel) { gammel.remove(); return; }
  const host = document.createElement('div');
  host.className = 'usermenu ikonvaelger';
  host.id = 'ikonvaelger';
  host.innerHTML = `
    <div class="ikongrid">${IKONER.map((e) => `
      <button class="ikonknap${e === nuvaerende ? ' on' : ''}" data-ikon="${esc(e)}">${e}</button>`).join('')}</div>
    <div class="btnrow" style="margin-top:8px">
      <input class="input" id="ikonFrit" maxlength="4" placeholder="or paste one"
        value="${esc(nuvaerende || '')}" style="max-width:110px">
      <button class="btn ghost" data-ikon="">None</button>
    </div>`;
  (anker.parentElement || document.body).appendChild(host);

  const vaelg = async (e) => { host.remove(); await gem(e); };
  host.querySelectorAll('[data-ikon]').forEach((el) => {
    el.addEventListener('click', () => vaelg(el.dataset.ikon));
  });
  const frit = host.querySelector('#ikonFrit');
  frit.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); vaelg(frit.value.trim()); }
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

/* ------------------------------------------------- »vis som markdown« */

/**
 * Hele noten som markdown - ÉT sted.
 *
 * Markdown ER det, der ligger i databasen (DESIGN.md §2), saa der er intet at
 * konvertere og derfor heller intet at tabe. Titlen kommer med som en
 * overskrift, hvis teksten ikke selv har en: en note indsat i en mail uden
 * sit navn er svaer at forstaa.
 *
 * Baade kopiér-knappen og »Show as markdown« bruger den, saa de to ikke kan
 * give hver sit svar paa »hvad ER noten«.
 */
function noteSomMarkdown(n) {
  const krop = String((n && n.body) || '');
  if (/^#\s+/.test(krop.trimStart())) return krop;
  return `# ${(n && n.title) || 'Untitled'}\n\n${krop}`;
}

function visMarkdownPanel() {
  const n = editor.note;
  if (!n) return;
  const md = noteSomMarkdown(n);
  const gammel = document.getElementById('mdpanel');
  if (gammel) { gammel.remove(); return; }

  const host = document.createElement('div');
  host.className = 'modal';
  host.id = 'mdpanel';
  host.innerHTML = `
    <div class="modal-kort">
      <div class="modal-top">
        <h2>${esc(n.title || 'Untitled')} — as markdown</h2>
        <button class="iconbtn" id="mdLuk" aria-label="Close">${icon('luk', 16)}</button>
      </div>
      <pre class="mdkilde" id="mdKilde">${esc(md)}</pre>
      <div class="modal-fod btnrow">
        <span class="meta saetning" id="mdSvar">${md.length.toLocaleString('en-GB')} characters</span>
        <span style="flex:1"></span>
        <button class="btn" id="mdMarker">Select all</button>
        ${saguMarkdown.billederIMarkdown(md).length
    ? `<button class="btn" id="mdKopiBilleder">Copy with images</button>` : ''}
        <button class="btn primary" id="mdKopi">Copy</button>
      </div>
    </div>`;
  document.body.appendChild(host);

  const luk = () => { host.remove(); document.removeEventListener('keydown', paaTast); };
  const paaTast = (e) => { if (e.key === 'Escape') { e.preventDefault(); luk(); } };
  document.addEventListener('keydown', paaTast);
  host.querySelector('#mdLuk').addEventListener('click', luk);
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });

  const kilde = host.querySelector('#mdKilde');
  const svar = host.querySelector('#mdSvar');
  host.querySelector('#mdMarker').addEventListener('click', () => {
    svar.textContent = markerTekst(kilde) ? 'Selected — press ⌘C' : 'Could not select';
  });
  host.querySelector('#mdKopi').addEventListener('click', async () => {
    if (await kopier(md)) { svar.textContent = 'Copied.'; return; }
    // Ingen blindgyde: markér, saa brugeren selv kan trykke ⌘C.
    svar.textContent = markerTekst(kilde) ? 'Selected — press ⌘C' : 'Could not copy.';
  });

  const medBilleder = host.querySelector('#mdKopiBilleder');
  if (medBilleder) {
    medBilleder.addEventListener('click', async () => {
      if (!navigator.clipboard || !window.ClipboardItem) {
        svar.textContent = 'This browser cannot carry images on the clipboard.';
        return;
      }
      medBilleder.disabled = true;
      svar.textContent = 'Fetching the images…';
      try {
        const r = await medIndlejredeBilleder(md);
        /*
         * Samme vej som menuens knap. Her er `text/plain` den SELVBAERENDE
         * markdown med billeddata i - man staar og ser paa markdown'en og kan
         * have brug for netop den. Menuens knap goer det modsat.
         */
        if (!skrivToFlavours(r.markdown, r.html)) throw new Error('afvist');
        /*
         * Beskeden siger hvad man FIK, ikke bare at det lykkedes.
         *
         * Blev et billede sprunget over for loftets skyld, skal man vide det
         * nu - ikke opdage det i det dokument, man har indsat i.
         */
        const med = r.ialt - r.sprunget;
        svar.textContent = r.sprunget
          ? `Copied with ${med} of ${r.ialt} images — the rest were too large to carry. `
            + 'Open a large one in the note and use Copy image to move it on its own.'
          : `Copied with ${med} image${med === 1 ? '' : 's'}.`;
      } catch (ex) {
        svar.textContent = udklipsFejl(ex);
      }
      medBilleder.disabled = false;
    });
  }
}

/* ==================================================== vedhaeftninger (F4) == */

/** Menneskeligt filnavn-format. En byte-vaerdi er ikke et svar til nogen. */
function visStoerrelse(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * Ruden med notens filer.
 *
 * Den viser KUN det, `hentNote` sendte med. Listerne baerer bevidst kun et
 * antal, saa den her kan ikke bygges af listeobjektet - det er praecis den
 * fejl, dodas F7 beskriver (RUNE-ERFARINGER).
 */
/**
 * Hvor laenge en forladt vedhaeftning har igen.
 *
 * Beskeden skal sige, hvad der SKER - ikke hvornaar den blev forladt. »forladt
 * i gaar« er en oplysning, man skal regne paa; »removed in 5 hours« er en, man
 * kan handle paa.
 */
function restTid(siden) {
  const tilbage = (Number(siden) + 24 * 3600) - Math.floor(Date.now() / 1000);
  if (tilbage <= 0) return 'removed shortly';
  const timer = Math.round(tilbage / 3600);
  if (timer >= 2) return `removed in ${timer} hours`;
  const min = Math.max(1, Math.round(tilbage / 60));
  return `removed in ${min} minute${min === 1 ? '' : 's'}`;
}

function filerHtml(n) {
  const filer = n.files || [];
  if (!filer.length) return '';
  return `<div class="filer">
      <details class="bilagfold"${bilagAabent(BILAG_FILER) ? ' open' : ''}>
        <summary><span class="bilag-navn">Attachments</span>
          <span class="group-count">${filer.length}</span></summary>
      ${filer.map((f) => `
        <div class="fil${f.orphan_since ? ' fil-forladt' : ''}">
          <span class="fil-ikon">${f.inline ? '🖼' : '📎'}</span>
          <a class="fil-navn" href="${esc(f.url)}"
             ${f.inline ? '' : 'download'} title="${esc(f.name)}">${esc(f.name)}</a>
          ${f.orphan_since ? `<span class="fil-forladt-maerke"
            title="The note no longer links to this file. Press Insert to keep it."
            >not in the note — ${esc(restTid(f.orphan_since))}</span>` : ''}
          <span class="fil-stoerrelse meta">${esc(visStoerrelse(f.size))}</span>
          <button class="btn ghost fil-ind" data-filind="${esc(f.id)}"
            title="${f.orphan_since ? 'Put it back in the note and keep it'
    : 'Insert a link to this file in the note'}">Insert</button>
          <button class="btn ghost danger" data-filslet="${esc(f.id)}">Remove</button>
        </div>`).join('')}
      </details>
    </div>`;
}

function bindFiler() {
  bindBilagsfold(document.querySelector('.filer'), BILAG_FILER);

  document.querySelectorAll('[data-filslet]').forEach((el) => {
    el.addEventListener('click', async () => {
      const n = editor.note;
      const f = (n.files || []).find((x) => x.id === el.dataset.filslet);
      try {
        await api('DELETE', `/api/v1/files/${el.dataset.filslet}`);
        n.files = (n.files || []).filter((x) => x.id !== el.dataset.filslet);
        // Teksten roeres IKKE. En henvisning til en fjernet fil er en
        // kendsgerning om noten - og at redigere brugerens tekst bag hans ryg
        // er vaerre end et doedt link, han selv kan se og fjerne.
        const stadigNaevnt = n.body.includes(`sagu:${el.dataset.filslet}`);
        toast(stadigNaevnt
          ? `Removed "${f ? f.name : 'the file'}" — the note still links to it.`
          : 'Removed.');
        tegnSide();
      } catch (ex) { toast(ex.message); }
    });
  });

  document.querySelectorAll('[data-filind]').forEach((el) => {
    el.addEventListener('click', async () => {
      const n = editor.note;
      const f = (n.files || []).find((x) => x.id === el.dataset.filind);
      if (!f) return;
      const forladt = !!f.orphan_since;
      const md = f.inline
        ? `![${f.name.replace(/[[\]]/g, '')}](sagu:${f.id})`
        : `[${f.name}](sagu:${f.id})`;
      // Laeg den sidst i noten - dér, hvor man kan se den lande.
      n.body = `${n.body.replace(/\s*$/, '')}\n\n${md}\n`;
      markerBeskidt();
      tegnKrop();
      toast(forladt ? 'Back in the note — it stays.' : 'Inserted at the end of the note.');

      /*
       * Gem NU og hent filerne igen.
       *
       * Uden det bliver »not in the note«-maerket staaende, til man aabner
       * noten forfra: serveren rydder stemplet ved gemningen, men fladen
       * spoerger den aldrig igen. Maalt - serveren sagde `orphan=null`, mens
       * skaermen stadig sagde, at filen forsvandt om et doegn.
       *
       * Det er ikke en skoenhedsfejl. Maerket er det eneste svar paa »virkede
       * det?«, og et maerke, der bliver haengende, siger nej.
       */
      if (!forladt) return;
      try {
        await gemNu();
        const d = await api('GET', `/api/v1/notes/${n.id}`);
        editor.note.files = d.note.files;
        tegnSide();
      } catch { /* maerket forsvinder saa foerst ved naeste aabning */ }
    });
  });
}

/* ------------------------------------------------------------ drop-zone */

/*
 * Traek en fil ind hvor som helst paa noten.
 *
 * Inde i en aaben blok haandteres traekket af feltet selv (F3), saa markoeren
 * bestemmer hvor linket lander. Her udenfor er der ingen markoer - filen
 * laegges sidst i noten, hvor man kan SE den lande.
 */
function bindDropZone(host) {
  if (!host || host.dataset.dropbundet) return;
  host.dataset.dropbundet = '1';
  let dybde = 0;

  host.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    dybde++;
    document.body.classList.add('traekker-fil');
  });
  host.addEventListener('dragover', (e) => {
    if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
  });
  host.addEventListener('dragleave', () => {
    // Taeller op og ned: `dragleave` fyrer ogsaa, naar markoeren gaar fra et
    // barn til et andet, og uden taelleren ville rammen blinke.
    dybde = Math.max(0, dybde - 1);
    if (!dybde) document.body.classList.remove('traekker-fil');
  });
  host.addEventListener('drop', async (e) => {
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault();
    dybde = 0;
    document.body.classList.remove('traekker-fil');
    if (!editor.note) return;
    // Er en blok aaben, hoerer traekket til den - feltet har sin egen handler.
    if (document.getElementById('blokFelt')) return;
    await tilfoejFiler([...e.dataTransfer.files]);
  });
}

/** Uploader og laegger markdown'en sidst i noten. */
async function tilfoejFiler(filer) {
  const n = editor.note;
  if (!n) return;
  let lagt = 0;
  for (const f of filer.slice(0, 20)) {
    const uploadet = await indsaetFil(f, null);
    if (!uploadet) continue;
    const md = uploadet.inline
      ? `![${(f.name || 'image').replace(/[[\]]/g, '')}](sagu:${uploadet.id})`
      : `[${uploadet.name}](sagu:${uploadet.id})`;
    n.body = `${n.body.replace(/\s*$/, '')}\n\n${md}\n`;
    lagt++;
  }
  if (!lagt) return;
  markerBeskidt();
  await gemNu();
  // Hent noten igen: filernes metadata kommer KUN med paa den enkelte note,
  // saa ruden kan ikke tegnes af det, vi allerede har.
  try {
    const d = await api('GET', `/api/v1/notes/${n.id}`);
    editor.note.files = d.note.files;
  } catch { /* ruden staar bare tom indtil naeste aabning */ }
  tegnSide();
  toast(lagt === 1 ? 'Attached.' : `Attached ${lagt} files.`);
}

/** Knappen: en skjult filvaelger, saa man ikke SKAL kunne traekke. */
function vaelgFiler() {
  const felt = document.createElement('input');
  felt.type = 'file';
  felt.multiple = true;
  felt.style.display = 'none';
  document.body.appendChild(felt);
  felt.addEventListener('change', async () => {
    const filer = [...felt.files];
    felt.remove();
    if (filer.length) await tilfoejFiler(filer);
  });
  felt.click();
}

/* ============================================================ trækhåndtag
 *
 * »Fx i notion der kommer der ud for hvert element 6 prikker som man kan
 * bruge til at trække rundt i noten med« (Andreas, 2026-08-21).
 *
 * ── Hvorfor det ligger her og ikke i editoren ─────────────────────────────
 *
 * Selve flytningen er `saguMarkdown.flytBlok()` - en ren tekstoperation i det
 * delte modul, hvor den kan prøves uden en browser. Det her er kun fladen:
 * hvor håndtaget står, og hvilke to tal trækket ender med at kalde den med.
 *
 * ── POINTER-events, ikke HTML5 drag & drop ────────────────────────────────
 *
 * Samme valg som træet og lightboxen: HTML5-træk findes ikke på touch. Med
 * `pointerdown` + `setPointerCapture` er mus, pen og finger den samme kode -
 * og `touch-action: none` på håndtaget (og kun dér) betyder, at man stadig
 * kan rulle noten alle andre steder.
 *
 * ── Håndtagene tegnes UDEN OM markdown'en ─────────────────────────────────
 *
 * Rendereren kunne have skrevet dem ud, men den er delt med serveren og med
 * de udgivne sider - en offentlig side skal ikke have knapper, ingen kan
 * bruge. De lægges derfor ovenpå, ud fra `offsetTop` på de blokke, der ER
 * tegnet. En `ResizeObserver` flytter dem igen, når et billede lander eller
 * vinduet skifter bredde; uden den ville håndtagene stå ét sted og teksten
 * et andet, så snart noten voksede.
 */

const greb = { fra: null, til: null, aktiv: false };
let grebObs = null;

/** Blokkens nummer i `blokke()` ud fra dens FØRSTE linje (`data-blok`). */
function blokNrForLinje(linje) {
  return saguMarkdown.blokke(editor.note.body).findIndex((b) => b.fra === linje);
}

function ryddGreb(host) {
  host.querySelectorAll('.blok-greb, .blok-indsaet').forEach((el) => el.remove());
  if (grebObs) { grebObs.disconnect(); grebObs = null; }
}

/** Sætter et håndtag ud for hver tegnet blok. */
function tegnGreb(host) {
  ryddGreb(host);
  // Ingen håndtag på en note, man kun må læse: en knap, der ikke kan gøre
  // noget, er et løfte, appen ikke holder (F11).
  if (!editor.note || !maaRette(editor.note)) return;

  const blokke = [...host.querySelectorAll('[data-blok]')];
  if (blokke.length < 2) return;        // ét element kan ikke flyttes nogen steder

  for (const el of blokke) {
    const g = document.createElement('button');
    g.className = 'blok-greb';
    g.type = 'button';
    g.dataset.greb = el.dataset.blok;
    /*
     * Navnet skal sige, hvad haandtaget KAN - og kun det.
     *
     * Er doda ikke forbundet, aabner klikket ingen menu (se `visBlokMenu`),
     * og saa maa navnet ikke love en. Et navn, der naevner en mulighed, som
     * ikke er der, er den samme slags loefte som en knap, der ikke virker.
     */
    const medMenu = dodaState.connected;
    g.setAttribute('aria-label', medMenu ? 'Move this block, or click for options' : 'Drag to move this block');
    g.title = medMenu ? 'Drag to move — click for options' : 'Drag to move';
    g.innerHTML = '<span></span><span></span><span></span>'
      + '<span></span><span></span><span></span>';
    host.appendChild(g);
    g.addEventListener('pointerdown', (e) => startTraek(e, host, g));
    // Klikket haandteres af `startTraek`s afslutning. Det maa ikke ogsaa naa
    // notens egen klikhaandtering - to svar paa ét tryk.
    g.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
  }
  placerGreb(host);

  if (window.ResizeObserver) {
    grebObs = new ResizeObserver(() => placerGreb(host));
    grebObs.observe(host);
    blokke.forEach((b) => grebObs.observe(b));
  }
}

/** Håndtaget følger sin blok - også når noten vokser under den. */
function placerGreb(host) {
  host.querySelectorAll('.blok-greb').forEach((g) => {
    const el = host.querySelector(`[data-blok="${g.dataset.greb}"]`);
    if (!el) { g.style.display = 'none'; return; }
    g.style.display = '';
    // Første tekstlinje frem for blokkens midte: ud for en lang liste skal
    // håndtaget stå ØVERST, dér hvor listen begynder.
    g.style.top = `${el.offsetTop + 1}px`;
  });
}

/* ------------------------------------------------------------ selve trækket */

function startTraek(e, host, g) {
  if (e.button != null && e.button > 0) return;   // kun venstre knap
  e.preventDefault();
  e.stopPropagation();
  greb.fra = Number(g.dataset.greb);
  greb.til = null;
  greb.aktiv = false;
  g.setPointerCapture(e.pointerId);

  const startY = e.clientY;

  const linje = document.createElement('div');
  linje.className = 'blok-indsaet';

  const flyt = (ev) => {
    /*
     * Et træk begynder først efter 4 px.
     *
     * Uden tærsklen bliver hvert eneste KLIK på håndtaget til et træk på nul
     * pixel, og så blinker indsætningslinjen ved hver berøring. Det er den
     * samme grænse, træet i sidebaren bruger.
     */
    if (!greb.aktiv) {
      if (Math.abs(ev.clientY - startY) < 4) return;
      greb.aktiv = true;
      host.classList.add('traekker-blok');
      g.classList.add('greb-aktiv');
      host.appendChild(linje);
    }
    greb.til = maalFor(host, ev.clientY);
    visLinje(host, linje, greb.til);
  };

  const slut = () => {
    g.releasePointerCapture(e.pointerId);
    g.removeEventListener('pointermove', flyt);
    g.removeEventListener('pointerup', slut);
    g.removeEventListener('pointercancel', slut);
    linje.remove();
    host.classList.remove('traekker-blok');
    g.classList.remove('greb-aktiv');
    if (greb.aktiv && greb.til !== null) fuldfoerTraek();
    // Ingen bevaegelse betyder, at det var et KLIK og ikke et traek. Saa er
    // det menuen, der skal frem.
    else if (!greb.aktiv) visBlokMenu(g);
    greb.fra = null; greb.til = null; greb.aktiv = false;
  };

  g.addEventListener('pointermove', flyt);
  g.addEventListener('pointerup', slut);
  g.addEventListener('pointercancel', slut);
}

/**
 * Hvilken blok skal den lægges FORAN?
 *
 * Grænsen går ved hver bloks midte, ikke ved dens kant: så svarer fladen på
 * det, øjet ser - er markøren i den øverste halvdel af en blok, lander
 * teksten over den.
 *
 * @returns {number} et linjenummer (`data-blok`) eller `Infinity` for »nederst«.
 */
function maalFor(host, y) {
  const blokke = [...host.querySelectorAll('[data-blok]')];
  for (const el of blokke) {
    const r = el.getBoundingClientRect();
    if (y < r.top + r.height / 2) return Number(el.dataset.blok);
  }
  return Infinity;
}

function visLinje(host, linje, maalLinje) {
  const el = maalLinje === Infinity ? null : host.querySelector(`[data-blok="${maalLinje}"]`);
  const sidste = [...host.querySelectorAll('[data-blok]')].pop();
  linje.style.top = el
    ? `${el.offsetTop - 5}px`
    : `${sidste.offsetTop + sidste.offsetHeight + 3}px`;
}

function fuldfoerTraek() {
  const n = editor.note;
  if (!n) return;
  const fraNr = blokNrForLinje(greb.fra);
  const alle = saguMarkdown.blokke(n.body);
  const tilNr = greb.til === Infinity ? alle.length : blokNrForLinje(greb.til);
  if (fraNr < 0 || tilNr < 0) return;

  const ny = saguMarkdown.flytBlok(n.body, fraNr, tilNr);
  if (ny === n.body) return;            // trækket var ingen flytning
  n.body = ny;
  markerBeskidt();
  /*
   * Hele noten tegnes om, og det er med vilje.
   *
   * Blokkenes linjenumre er FLYTTET af operationen, så hvert eneste
   * `data-blok` er forældet i samme øjeblik. Et forsøg på kun at flytte ét
   * element ville lade resten pege på linjer, der nu hører til noget andet.
   */
  editor.aabenBlok = null;
  tegnKrop();
}

/* ------------------------------------------------- menuen på håndtaget
 *
 * »Kan det laves så man kan klikke på de 6 prikker og så få en mulighed for
 * at lave den til en opgave i doda?« (Andreas, 2026-08-21).
 *
 * Klikket var ledigt: et træk begynder først efter 4 px, så et tryk UDEN
 * bevægelse gjorde ingenting. Nu åbner det menuen — samme håndtag, to
 * betydninger, og ingen af dem stjæler den anden.
 *
 * ── Hvorfor menuen kun har ét punkt, og hvorfor den forsvinder helt ───────
 *
 * Punktet vises kun, når doda ER forbundet. En menu med en knap, der ikke
 * kan gøre noget, er et løfte, appen ikke holder (samme regel som
 * dele-ikonet og `maaRette`), og et gråt punkt med en forklaring ville lære
 * folk at menuen som regel er tom. Uden doda opfører håndtaget sig, som det
 * gjorde før: det trækker, og et klik gør ingenting.
 *
 * Kommer der flere punkter, er det HER, de hører til.
 */

let blokMenu = null;

function lukBlokMenu() {
  if (blokMenu) { blokMenu.remove(); blokMenu = null; }
  document.removeEventListener('keydown', blokMenuTast, true);
  document.removeEventListener('pointerdown', blokMenuUdenfor, true);
}

function blokMenuTast(e) {
  if (e.key === 'Escape') { e.stopPropagation(); lukBlokMenu(); }
}

function blokMenuUdenfor(e) {
  if (blokMenu && !blokMenu.contains(e.target)) lukBlokMenu();
}

/** Blokkens tekst som ÉN linje. Selve strimlingen er `blokSomLinje()`. */
function blokSomOpgave(linjeNr) {
  return editor.note ? saguMarkdown.blokSomLinje(editor.note.body, linjeNr) : '';
}

function visBlokMenu(g) {
  lukBlokMenu();
  /*
   * Menuen aabner nu ALTID - foer kraevede den, at doda var forbundet.
   *
   * Dengang var »Send to doda« det eneste punkt, saa en menu uden doda var en
   * tom menu. Nu kan man ogsaa slette blokken, og DEN mulighed har intet med
   * doda at goere. Havde vagten faaet lov at blive staaende, ville sletningen
   * vaere usynlig for enhver, der ikke har koblet de to apps sammen.
   */
  const linje = Number(g.dataset.greb);
  const tekst = blokSomOpgave(linje);
  // Uden en tekst er der intet at sende og intet at vise - men blokken kan
  // stadig slettes, saa menuen aabner alligevel.
  const tilDoda = dodaState.connected && tekst.length >= 2;

  blokMenu = document.createElement('div');
  blokMenu.className = 'blok-menu';
  blokMenu.innerHTML = `${tilDoda
    ? `<button type="button" class="blok-menu-punkt" id="blokTilDoda">
        ${icon('tjek', 15)}<span>Send to doda</span></button>` : ''}
    <button type="button" class="blok-menu-punkt farlig" id="blokSlet">
      ${icon('trash', 15)}<span>Delete this block</span></button>
    ${tekst ? `<div class="blok-menu-uddrag">${esc(tekst.slice(0, 90))}${
  tekst.length > 90 ? '…' : ''}</div>` : ''}`;
  document.body.appendChild(blokMenu);

  const r = g.getBoundingClientRect();
  const m = blokMenu.getBoundingClientRect();
  // Til højre for håndtaget, og aldrig ud over skærmkanten.
  blokMenu.style.left = `${Math.round(Math.min(r.left, window.innerWidth - m.width - 8))}px`;
  blokMenu.style.top = `${Math.round(Math.min(r.bottom + 4, window.innerHeight - m.height - 8))}px`;

  const dodaKnap = blokMenu.querySelector('#blokTilDoda');
  if (dodaKnap) {
    dodaKnap.addEventListener('click', async () => {
      lukBlokMenu();
      if (tekst.length > 500) toast('That was long — the first 500 characters became the task.');
      await sendOpgaveTilDoda(tekst.slice(0, 500));
    });
  }

  blokMenu.querySelector('#blokSlet').addEventListener('click', () => {
    lukBlokMenu();
    sletBlokFraMenu(linje);
  });

  document.addEventListener('keydown', blokMenuTast, true);
  document.addEventListener('pointerdown', blokMenuUdenfor, true);
  (dodaKnap || blokMenu.querySelector('#blokSlet')).focus();
}

/**
 * Fjerner blokken - og tilbyder at fortryde.
 *
 * ── Hvorfor der ikke spoerges foerst ──────────────────────────────────────
 *
 * En »er du sikker?«-rude for hver eneste sletning er en afgift, man betaler
 * hver gang for at daekke den ene gang, man rammer forkert. Fortrydelsen er
 * den bedre handel: handlingen sker med det samme, og vejen tilbage staar
 * fremme, saa laenge det er relevant.
 *
 * Den gamle tekst gemmes FOER der roeres ved noget. Havde vi bygget den op
 * igen af de blokke, der blev tilbage, ville »fortryd« give en tekst, der
 * lignede den gamle - ikke den gamle.
 */
function sletBlokFraMenu(linje) {
  const n = editor.note;
  if (!n || !maaRette(n)) return;
  const foer = n.body;
  const ny = saguMarkdown.sletBlok(foer, linje);
  if (ny === foer) return;

  n.body = ny;
  editor.aabenBlok = null;
  markerBeskidt();
  tegnKrop();
  toast('Block deleted.', {
    label: 'Undo',
    run: () => {
      if (!editor.note || editor.note.id !== n.id) return;
      editor.note.body = foer;
      editor.aabenBlok = null;
      markerBeskidt();
      tegnKrop();
    },
  });
}

// Ruller siden, står menuen det forkerte sted - så er det bedre, den går væk.
// Samme valg som markeringsknappen (F16).
window.addEventListener('scroll', lukBlokMenu, { passive: true });

/* ============================== hjælp til at skrive =====================
 *
 * Ruden bag »?«-knappen ved skrivefeltet.
 *
 * ── Hvorfor listerne ikke står her ────────────────────────────────────────
 *
 * Både `saguMarkdown.SYNTAKS` og `saguGithub.ADRESSER` bor i de delte
 * moduler, ved siden af de regexp'er og den tolk, de beskriver — og
 * testpakken kører hver eneste linje igennem. Holder rendereren op med at
 * kunne tabeller, falder prøven, og hjælpen kan ikke blive ved med at love
 * dem.
 *
 * Fladen her gør derfor ét: viser dem. Den kender ikke selv en eneste
 * markdown-regel, og der er intet at holde i sync.
 *
 * ── Eksemplerne vises BÅDE som kode og som resultat ───────────────────────
 *
 * »`**bold**`« alene fortæller ikke en, der aldrig har set markdown, hvad
 * der sker. To spalter — det man skriver, og det man får — er hele
 * forklaringen uden en eneste sætning.
 */
function visSyntaksPanel() {
  const gammel = document.getElementById('syntaksPanel');
  if (gammel) { gammel.remove(); return; }

  /*
   * Eksemplerne render'es UDEN `blokAttribut`.
   *
   * `data-blok` er editorens haandtag paa noten - dét, klik, traekhaandtag og
   * blokmenu finder hinanden med. I en hjaelperude peger de ingen steder hen,
   * og markup, der ligner en blok uden at vaere det, er en faelde for den
   * naeste, der spoerger dokumentet om alle `[data-blok]`.
   */
  const valg = { ...renderValg(), blokAttribut: false };
  const raekke = (s) => {
    let ud = '';
    try { ud = saguMarkdown.render(s.kode, valg).html; } catch { ud = ''; }
    return `<tr>
      <th>${esc(s.navn)}</th>
      <td><code class="syntaks-kode">${esc(s.kode)}</code></td>
      <td class="syntaks-ud">${ud}</td>
    </tr>`;
  };

  const host = document.createElement('div');
  host.className = 'modal';
  host.id = 'syntaksPanel';
  host.innerHTML = `<div class="modal-kort bred">
      <div class="modal-top">
        <h2>How to write</h2>
        <button class="iconbtn" id="syntaksLuk" aria-label="Close">${icon('luk', 16)}</button>
      </div>
      <div class="modal-krop">
        <p class="meta saetning">Sagu keeps your notes as plain markdown — what you type
        <em>is</em> the note. Nothing here is required; a note written as ordinary prose
        stays ordinary prose.</p>

        <div class="tablewrap"><table class="data syntaks">
          <thead><tr><th>What</th><th>You write</th><th>You get</th></tr></thead>
          <tbody>${saguMarkdown.SYNTAKS.map(raekke).join('')}</tbody>
        </table></div>

        <h3 style="margin-top:22px">Shortcuts while you type</h3>
        <p class="meta saetning">Type one of these and it turns into the value at once. They only
        count at the start of a line or after a space, so they cannot fire inside a word.</p>
        <div class="tablewrap"><table class="data">
          <tbody>${TEKSTGENVEJE.map((g) => `<tr>
            <th>${esc(g.navn)}</th>
            <td><code class="syntaks-kode">${esc(g.ord)}</code></td>
            <td class="meta">${esc(g.lav(new Date()))}</td>
          </tr>`).join('')}</tbody>
        </table></div>

        <h3 style="margin-top:22px">Tags</h3>
        <p class="meta saetning">A <code>#tag</code> in the <strong>title</strong> becomes a real
        tag. Several at once: <code>#drift,net,backup</code> — no space after the comma, or the
        rest is read as an ordinary sentence.</p>

        <h3 style="margin-top:22px">GitHub</h3>
        <p class="meta saetning">Put a GitHub address <strong>alone on its own line</strong> and
        Sagu shows the thing itself — the file with its lines, or the issue with its state.
        Inside a sentence it stays an ordinary link. Only <code>github.com</code>, and a private
        repository needs a token under <strong>Settings → GitHub</strong>.</p>
        <div class="tablewrap"><table class="data">
          <tbody>${saguGithub.ADRESSER.map((a) => `<tr>
            <th>${esc(a.navn)}</th>
            <td><code class="syntaks-kode">${esc(a.kode)}</code></td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>
    </div>`;
  document.body.appendChild(host);

  const luk = () => { host.remove(); document.removeEventListener('keydown', paaTast); };
  const paaTast = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); luk(); } };
  document.addEventListener('keydown', paaTast);
  host.querySelector('#syntaksLuk').addEventListener('click', luk);
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });
  host.querySelector('#syntaksLuk').focus();
}

/* ======================== kopiér et billede fra en note ==================
 *
 * »sagu skal have en let måde at kunne kopiere et billede fra en note som så
 * kan bruges et andet sted på computeren eller telefonen« (Andreas,
 * 2026-08-24).
 *
 * ── Billedet selv, ikke en adresse ────────────────────────────────────────
 *
 * Det nemme ville være at lægge `/api/v1/files/<id>` på udklipsholderen. Men
 * en adresse kan ikke sættes ind i et dokument, en mail eller en besked — og
 * den kræver oven i købet, at modtageren er logget ind i Sagu. Det, man vil,
 * er at have billedet.
 *
 * ── PNG, uanset hvad filen er ─────────────────────────────────────────────
 *
 * Browserne tager kun `image/png` i udklipsholderen. En JPEG skal derfor
 * tegnes om på et lærred først. Det er samme oprindelse (`/api/v1/files/…`),
 * så lærredet bliver ikke plettet, og `toBlob` virker.
 *
 * ── Løftet skal laves FØR await ───────────────────────────────────────────
 *
 * Safari kræver, at `ClipboardItem` oprettes i selve klik-hændelsen. Venter
 * man på hentningen først, er brugerhandlingen udløbet, og skrivningen
 * afvises — uden at noget ser i stykker ud. Derfor får `ClipboardItem` et
 * LØFTE, ikke en færdig blob.
 *
 * ── Og en ærlig vej ud ────────────────────────────────────────────────────
 *
 * `navigator.clipboard.write` findes ikke over ren http, og panelet nås på
 * `IP:port`. Dér siger knappen det og peger på »Open«, hvor telefonens og
 * computerens egen »kopiér billede« virker som altid.
 */
async function tilPngBlob(src) {
  const svar = await fetch(src);
  if (!svar.ok) throw new Error('Could not read the image.');
  const blob = await svar.blob();
  if (blob.type === 'image/png') return blob;

  const bitmap = await createImageBitmap(blob);
  const lærred = document.createElement('canvas');
  lærred.width = bitmap.width;
  lærred.height = bitmap.height;
  lærred.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise((ok, nej) => {
    lærred.toBlob((b) => (b ? ok(b) : nej(new Error('Could not convert the image.'))), 'image/png');
  });
}

async function kopierBillede(src, knap) {
  if (!navigator.clipboard || !window.ClipboardItem) {
    toast('This browser cannot copy images here — use Open, then copy it from there.');
    return;
  }
  const foer = knap.innerHTML;
  knap.disabled = true;
  try {
    // Loeftet laves NU, inde i klikket - se forklaringen ovenfor.
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': tilPngBlob(src) })]);
    knap.innerHTML = `${icon('tjek', 16)}<span>Copied</span>`;
    toast('Image copied — paste it wherever you need it.');
  } catch {
    /*
     * Nogle browsere afviser et loefte og vil have en faerdig blob. Proev
     * ÉN gang mere med den hentede blob, foer vi giver op - forskellen er
     * usynlig for den, der bare vil have sit billede.
     */
    try {
      const blob = await tilPngBlob(src);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      knap.innerHTML = `${icon('tjek', 16)}<span>Copied</span>`;
      toast('Image copied — paste it wherever you need it.');
    } catch {
      toast('Could not copy it here — use Open, then copy it from there.');
      knap.innerHTML = foer;
    }
  }
  knap.disabled = false;
  setTimeout(() => { if (document.getElementById('lightbox')) knap.innerHTML = foer; }, 2500);
}

/**
 * Skriv BEGGE flavours til udklipsholderen. Sandt, hvis det lykkedes.
 *
 * ── Graensen: Apple Notes tager ikke `data:`-billeder ─────────────────────
 *
 * Maalt (Andreas, 2026-08-25, med skaermbilleder fra begge apps): den samme
 * kopi giver billederne i OneNote paa web - og i Apple Notes et blaat »?«,
 * macOS' ikon for »et billede jeg ikke kan hente«. HTML'en og `<img>`-taggene
 * naar altsaa frem begge steder; Apple Notes naegter bare kilden.
 *
 * Den rigtige vej ville vaere RTF med billedet som `\pngblip` - macOS' eget
 * rige tekstformat, og det Apple Notes helst tager. Det kan vi ikke:
 *
 *   - `e.clipboardData.setData('text/rtf', …)` bliver TAVST kasseret.
 *     Proevet med en gyldig RTF paa 22 KB: bagefter laa der kun
 *     `«class utf8», 10` paa udklipsholderen - den rene tekst og intet andet.
 *   - macOS konverterer ikke selv HTML til RTF undervejs. Der var slet ingen
 *     RTF-flavor at hente (`osascript -e 'the clipboard as «class RTF »'`).
 *   - `ClipboardItem` tager kun de rensede typer; et egetdefineret format
 *     faar praefikset `web ` og kan kun laeses af andre websider.
 *
 * Saa langt raekker en browser. Det, der virker i dag:
 *
 *     OneNote, Word, Mail, Pages   billederne kommer med
 *     Apple Notes                  tekst og formatering kommer med;
 *                                  billederne tages ét ad gangen med
 *                                  »Copy image« i lightboxen
 *
 * Vil man laengere, skal man uden om udklipsholderen: en .html-fil man
 * traekker ind, eller en Apple Genvej der bygger noten gennem AppleScript.
 * Begge dele er stoerre end den her knap, og Andreas valgte dem fra
 * (2026-08-25).
 *
 * ── En rettelse af min egen rettelse ─────────────────────────────────────
 *
 * v33 byttede `navigator.clipboard.write()` ud med `copy`-haendelsen, fordi
 * en note indsat i Apple Notes kom ind som raa markdown, og jeg sluttede, at
 * `text/html` aldrig naaede frem. Det var forkert. Overskrifterne i den
 * indsatte note VAR blevet til Apple Notes' egne typografier - havde ren
 * tekst vundet, havde der staaet `#` foran dem. HTML'en naaede frem hele
 * tiden; den indeholdt bare billedet som tekst, fordi rendererens
 * adresse-loft paa 2.000 tegn ikke kan rumme en `data:`-adresse
 * (se `medIndlejredeBilleder`).
 *
 * `navigator.clipboard.write` er derfor hovedvejen igen: den moderne, den
 * sanktionerede, og den der virkede.
 *
 * `copy`-haendelsen bliver staaende som RESERVE. Den er ikke spildt: den
 * kraever ingen tilladelse, kun at brugeren har trykket paa noget, saa den
 * baerer de tilfaelde, hvor udklipsholder-tilladelsen er naegtet. Maalt paa
 * macOS' egen udklipsholder gennem `osascript` lander den «class HTML».
 */
function skrivToFlavours(ren, html) {
  if (navigator.clipboard && window.ClipboardItem) {
    try {
      navigator.clipboard.write([new ClipboardItem({
        'text/plain': new Blob([ren], { type: 'text/plain' }),
        'text/html': new Blob([html || ''], { type: 'text/html' }),
      })]);
      return true;
    } catch { /* falder igennem til reserven */ }
  }

  let lykkedes = false;
  const paa = (e) => {
    e.clipboardData.setData('text/plain', ren);
    if (html) e.clipboardData.setData('text/html', html);
    e.preventDefault();
    lykkedes = true;
  };
  document.addEventListener('copy', paa, true);
  try {
    // Uden en markering har nogle browsere ingenting at kopiere, og saa
    // fyrer haendelsen aldrig. Et tomt, skjult felt er nok til at give den en.
    const felt = document.createElement('textarea');
    felt.value = ' ';
    felt.setAttribute('aria-hidden', 'true');
    felt.style.cssText = 'position:fixed;top:-9999px;opacity:0';
    document.body.appendChild(felt);
    felt.select();
    document.execCommand('copy');
    felt.remove();
  } catch { /* lykkedes bliver staaende falsk */ }
  document.removeEventListener('copy', paa, true);
  return lykkedes;
}

/**
 * Hele noten paa udklipsholderen, klar til at saette ind et andet sted.
 *
 * »Kan du lave en knap under ...-menuen hvor man kan lave en kopi af hele
 * noten med billeder saa det fx kan pastes ind i apple notes« (Andreas,
 * 2026-08-25). F24 kunne det allerede, men kun efter at man foerst havde
 * aabnet markdown-ruden. Det her er ét klik.
 *
 * ── De to flavours er IKKE det samme ──────────────────────────────────────
 *
 * `text/html` baerer billederne som `data:`-adresser. Det er den, Apple
 * Notes, Mail, Word og Pages tager, og det er hele pointen med knappen.
 *
 * `text/plain` er den RENE markdown med `sagu:`-adresserne i behold - ikke
 * den med billeddata i. Saetter man ind i et tekstfelt, vil man have noget,
 * man kan laese; en halv megabyte base64 er ikke en tekst, det er en mur.
 * (Ruden »Show as markdown« goer det modsat med vilje: dér ser man PAA
 * markdown'en og kan have brug for den selvbaerende udgave.)
 *
 * ── Hvorfor loeftet laves foer der ventes ─────────────────────────────────
 *
 * Safari kraever, at `ClipboardItem` oprettes i selve klik-haendelsen. Ventede
 * vi paa billederne foerst, ville tilladelsen vaere brugt op, naar vi endelig
 * skrev - samme regel som `kopierBillede()`.
 */
function kopierNoten(n) {
  const md = noteSomMarkdown(n);
  const antal = saguMarkdown.billederIMarkdown(md).length;
  if (antal) toast(`Fetching ${antal} image${antal === 1 ? '' : 's'}…`);

  medIndlejredeBilleder(md).then((r) => {
    if (!skrivToFlavours(md, r.html)) {
      toast('Could not copy the note here. Use “Show as markdown” and Select all.');
      return;
    }
    if (r.sprunget) {
      toast(`Note copied with ${r.ialt - r.sprunget} of ${r.ialt} images — `
        + 'the rest were too large to carry.');
    } else {
      const med = antal - r.sprunget;
      toast(antal ? `Note copied with ${med} image${med === 1 ? '' : 's'}.` : 'Note copied.');
    }
  }).catch((ex) => toast(udklipsFejl(ex)));
}

/* ================= kopier en note MED billederne (F24) ==================
 *
 * »Er der nogen måde hvor på jeg kan få billeder med hvis jeg fx laver en
 * kopi af en note i markdown for at paste den over i noget andet?«
 * (Andreas, 2026-08-25).
 *
 * ── Hvorfor `sagu:<id>` ikke duer udenfor ─────────────────────────────────
 *
 * Et billede står i noten som `![navn](sagu:<id>)`. Den form er med vilje:
 * en note skal kunne flyttes til wikien eller en eksport uden at billederne
 * dør, så værten oversætter. Men uden for Sagu betyder `sagu:` ingenting, og
 * en absolut adresse ville kræve, at modtageren er logget ind i Sagu.
 *
 * ── Derfor bæres billedet MED ─────────────────────────────────────────────
 *
 * Filerne hentes og lægges i selve teksten som `data:`-adresser. Så er det,
 * man indsætter, selvbærende: det virker i en mail, et dokument eller en
 * anden app, også for en, der aldrig har hørt om Sagu.
 *
 * ── To formater på udklipsholderen, ikke ét ───────────────────────────────
 *
 * `text/html` med rigtige `<img>` for de steder, der tager imod formatering
 * (Word, Mail, Notion), og `text/plain` med markdown for de steder, der ikke
 * gør. Modtageren vælger selv; vi gætter ikke.
 *
 * ── Og et loft ────────────────────────────────────────────────────────────
 *
 * `data:` er base64, og det er en tredjedel større end filen. En note med
 * feriebilleder bliver til mange megabyte, og en udklipsholder, der bliver
 * bedt om det, kan gå i stå uden at sige noget. Derfor et loft — og en
 * besked, der siger HVAD man så kan gøre, ikke bare at det ikke gik.
 */
const BILLED_LOFT = 8 * 1024 * 1024;

/**
 * Browserens egen fejl oversat til noget, man kan handle paa.
 *
 * »Failed to execute 'write' on 'Clipboard': Document is not focused« er
 * sandt og ubrugeligt. Den, der laeser det, ved ikke, at kuren er at klikke i
 * vinduet foerst. Oversaettelsen hoerer ÉT sted (RUNE-ERFARINGER, doda v11 -
 * samme regel som doda-broens netvaerksbeskeder).
 */
function udklipsFejl(ex) {
  const m = String((ex && ex.message) || '');
  if (/not focused/i.test(m)) {
    return 'The browser would not hand over the clipboard — click inside the window, then try again.';
  }
  if (/NotAllowedError|denied|permission/i.test(m)) {
    return 'The browser refused access to the clipboard. Allow it for this site, or use Select all.';
  }
  return 'Could not copy. Use Select all and press ⌘C — the images will not come along that way.';
}

/** `![alt](sagu:<id>)` i teksten. Ét sted, så de to formater ser det samme. */
/**
 * Henter notens billeder og giver teksten tilbage med dem indlejret.
 *
 * @returns {{markdown: string, html: string, bytes: number, sprunget: number}}
 */
/**
 * Appens HTML gjort STATISK, saa den kan leve et andet sted.
 *
 * Rendereren skriver til Sagu: et flueben er en `<button role="checkbox">`,
 * fordi man skal kunne trykke paa det. Uden for Sagu er der ingen, der
 * lytter - og maalt paa den rigtige markup var tabet ikke bare en knap, det
 * var ASYMMETRISK:
 *
 *     - [x] afsluttet   ->  »✓ afsluttet«      (tegnet staar i knappen)
 *     - [ ] uafsluttet  ->  »uafsluttet«       (knappen er TOM)
 *
 * Sat ind i Apple Notes ville en tjekliste altsaa tabe præcis de punkter, man
 * ikke er faerdig med - de ville se ud som almindelig tekst. Begge dele
 * skrives derfor om til et tegn, der overlever enhver app.
 *
 * DOM og ikke regexp: markup'en er husets egen, og at laese den med den
 * parser, browseren allerede har, kan ikke komme til at ramme ved siden af et
 * attributnavn eller et linjeskift inde i et tag.
 */
function tilFremmedHtml(html) {
  if (!html) return '';
  const d = document.createElement('div');
  d.innerHTML = html;
  d.querySelectorAll('.tjek-boks').forEach((b) => {
    const tegn = b.getAttribute('aria-checked') === 'true' ? '\u2611 ' : '\u2610 ';
    b.replaceWith(document.createTextNode(tegn));
  });
  return d.innerHTML;
}

async function medIndlejredeBilleder(md) {
  const fundne = saguMarkdown.billederIMarkdown(md);
  const kort = new Map();
  let bytes = 0;
  let sprunget = 0;

  for (const b of fundne) {
    if (kort.has(b.sagu)) continue;
    const url = saguUrl(b.sagu);
    if (!url) { sprunget += 1; continue; }
    try {
      const svar = await fetch(url);
      if (!svar.ok) { sprunget += 1; continue; }
      const blob = await svar.blob();
      // Loftet maales paa det, der ER hentet - ikke paa et gaet. Springes et
      // billede over, bliver dets `sagu:`-adresse staaende, saa noten stadig
      // giver mening for den, der har Sagu.
      if (bytes + blob.size * 1.37 > BILLED_LOFT) { sprunget += 1; continue; }
      const data = await new Promise((ok, nej) => {
        const l = new FileReader();
        l.onload = () => ok(l.result);
        l.onerror = () => nej(new Error('kunne ikke laese'));
        l.readAsDataURL(blob);
      });
      bytes += String(data).length;
      kort.set(b.sagu, data);
    } catch { sprunget += 1; }
  }

  let markdown = md;
  for (const [sagu, data] of kort) {
    // `split`/`join` og ikke `replace` med et moenster: en `data:`-adresse
    // indeholder `$`-tegn, og de ville blive tolket som erstatningsgrupper.
    markdown = markdown.split(sagu).join(data);
  }

  // HTML'en laves af DEN SAMME tekst gennem husets egen renderer, saa de to
  // formater aldrig kan vise noget forskelligt.
  /*
   * HTML'en laves af den OPRINDELIGE markdown - den med `sagu:` i - og
   * billeddataen kommer ind gennem `billedUrl`. Ikke af `markdown` ovenfor.
   *
   * Meldt fra brug to gange (Andreas, 2026-08-25). Rendererens inline-regexp
   * har et loft paa adressen:
   *
   *     /!\[([^\]\n]{0,200})\]\(([^)\s]{1,2000})\)/g
   *
   * 2.000 tegn er rigeligt til en adresse og et fornuftigt vaern mod en
   * regexp, der loeber loebsk. Men et base64-billede paa 252 KB fylder
   * 337.000 tegn, og saa matcher moensteret slet ikke: `![x](data:…)` blev
   * staaende som REN TEKST i HTML'en. Det var praecis det, der kom ud i
   * Apple Notes - ikke fordi udklipsholderen tabte noget, men fordi det, vi
   * lagde paa den, indeholdt markdown'en som tekst.
   *
   * `sagu:<32 hex>` er 37 tegn og gaar aldrig i klemme. Den lange adresse
   * skrives kun UD, som en attribut, og dér er der ingen graense.
   *
   * Bagslag, der staar tilbage: skriver man selv en lang `data:`-adresse i en
   * note, vises den stadig som tekst. Det gaelder ogsaa, hvis man saetter den
   * selvbaerende markdown fra »Show as markdown« ind i Sagu igen.
   */
  let html = '';
  try {
    html = saguMarkdown.render(md, {
      billedUrl: (u) => {
        const data = kort.get(u);
        if (data) return data;
        /*
         * Et billede, loftet sprang over, beholder sin adresse - men den skal
         * vaere ABSOLUT. `saguUrl()` giver `/api/v1/files/<id>`, og en relativ
         * sti betyder ingenting i Apple Notes eller en mail.
         */
        const sti = saguUrl(u);
        return sti ? offentligBase() + sti : null;
      },
      linkUrl: (u) => saguUrl(u) || noteUrl(u),
    }).html;
  } catch { html = ''; }

  return { markdown, html: tilFremmedHtml(html), bytes, sprunget, ialt: kort.size + sprunget };
}
