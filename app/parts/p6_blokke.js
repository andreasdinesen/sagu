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
    <button class="lightbox-luk" aria-label="Close">${icon('luk', 20)}</button>
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

function visMarkdownPanel() {
  const n = editor.note;
  if (!n) return;
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
      <pre class="mdkilde" id="mdKilde">${esc(n.body)}</pre>
      <div class="modal-fod btnrow">
        <span class="meta saetning" id="mdSvar">${n.body.length.toLocaleString('en-GB')} characters</span>
        <span style="flex:1"></span>
        <button class="btn" id="mdMarker">Select all</button>
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
    if (await kopier(n.body)) { svar.textContent = 'Copied.'; return; }
    // Ingen blindgyde: markér, saa brugeren selv kan trykke ⌘C.
    svar.textContent = markerTekst(kilde) ? 'Selected — press ⌘C' : 'Could not copy.';
  });
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
function filerHtml(n) {
  const filer = n.files || [];
  if (!filer.length) return '';
  return `<div class="filer">
      <h2>Attachments <span class="meta">${filer.length}</span></h2>
      ${filer.map((f) => `
        <div class="fil">
          <span class="fil-ikon">${f.inline ? '🖼' : '📎'}</span>
          <a class="fil-navn" href="${esc(f.url)}"
             ${f.inline ? '' : 'download'} title="${esc(f.name)}">${esc(f.name)}</a>
          <span class="fil-stoerrelse meta">${esc(visStoerrelse(f.size))}</span>
          <button class="btn ghost fil-ind" data-filind="${esc(f.id)}"
            title="Insert a link to this file in the note">Insert</button>
          <button class="btn ghost danger" data-filslet="${esc(f.id)}">Remove</button>
        </div>`).join('')}
    </div>`;
}

function bindFiler() {
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
    el.addEventListener('click', () => {
      const n = editor.note;
      const f = (n.files || []).find((x) => x.id === el.dataset.filind);
      if (!f) return;
      const md = f.inline
        ? `![${f.name.replace(/[[\]]/g, '')}](sagu:${f.id})`
        : `[${f.name}](sagu:${f.id})`;
      // Laeg den sidst i noten - dér, hvor man kan se den lande.
      n.body = `${n.body.replace(/\s*$/, '')}\n\n${md}\n`;
      markerBeskidt();
      tegnKrop();
      toast('Inserted at the end of the note.');
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
