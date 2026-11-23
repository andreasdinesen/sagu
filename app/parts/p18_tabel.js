'use strict';
/* Sagu - tabeller, der redigeres som tabeller (v122).
 *
 * »Naar jeg klikker ind i en tabel, saa bliver den lavet om til markdown, og
 * det er lidt svaert at overskue, naar man skal kopiere noget ud fra den«
 * (Andreas, 2026-11-23).
 *
 * ── Hvordan ───────────────────────────────────────────────────────────────
 *
 * Tabellen er stadig en ØE i dokumentet (`contenteditable="false"`, se
 * p16_dokument.js) - den gaar aldrig gennem dokumentets oversaetter. Men hver
 * CELLE er sit eget lille `contenteditable`. Man klikker, markerer og
 * kopierer i tabellen, som man ser den, og skriver direkte i cellen.
 *
 * Markdown'en skrives HER, ikke af oversaetteren: oeens hukommelse
 * (`dok.urort`) faar den nye markdown, og `dokSkriv()` saetter noten sammen
 * som altid. Kun de raekker, man har roert, skrives om - resten staar tegn
 * for tegn, som de stod, med deres egen afstand og skillelinje.
 *
 * Den raa vej findes stadig: »MD« i tabellens linje aabner den som markdown.
 */

const tabel = {
  start: new WeakMap(), // celle -> innerHTML ved sidste skrivning
  celle: null,          // cellen, markoeren staar i
};

/** Cellen, en knude ligger i - kun i en tabel i dokumentet. */
function tabelCelle(x) {
  const el = x && (x.nodeType === 1 ? x : x.parentElement);
  const c = el && el.closest ? el.closest('.dok-tabel th, .dok-tabel td') : null;
  return c && dok.el && dok.el.contains(c) ? c : null;
}

function tabelCelleVedMarkoer() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  return tabelCelle(sel.getRangeAt(0).startContainer);
}

/** Kaldes af `tegnDokument`, naar oeerne er markeret. */
function dokTabeller(el) {
  el.querySelectorAll(':scope > .dok-oe').forEach((oe) => {
    if (!oe.querySelector(':scope > table.md-tabel')) return;
    oe.classList.add('dok-tabel');
    oe.querySelectorAll('th, td').forEach((c) => {
      c.setAttribute('contenteditable', 'true');
      c.spellcheck = true;
      tabel.start.set(c, c.innerHTML);
    });
  });
}

const tabelCeller = (tr) => [...tr.children].filter((c) => c.tagName === 'TH' || c.tagName === 'TD');

/** Cellens markdown - uden kopiknapper og andet pynt. */
function tabelCelleMd(c) {
  const kopi = c.cloneNode(true);
  kopi.querySelectorAll(DOK_PYNT).forEach((x) => x.remove());
  return saguRedigering.tilMarkdown(kopi.innerHTML);
}

/**
 * Tabellens markdown, som den staar nu.
 *
 * `hele` = strukturen er aendret (raekke/kolonne ind eller ud): alt skrives
 * forfra. Ellers beholder hver uroert raekke sin gamle linje.
 */
function tabelMd(oe, hele) {
  const info = dok.urort.get(oe);
  if (!info) return null;
  const gl = info.md.split('\n');
  const raekker = [...oe.querySelectorAll('tr')];
  if (!raekker.length) return null;
  const antal = tabelCeller(raekker[0]).length;
  const r = saguRedigering;
  if (hele || gl.length !== raekker.length + 1) {
    const just = tabelCeller(raekker[0]).map((c) => {
      if (c.classList.contains('center')) return 'center';
      if (c.classList.contains('right')) return 'right';
      return 'left';
    });
    const skil = r.tabelKolonner(gl[1]) === antal ? gl[1] : r.tabelSkil(just);
    return [r.tabelRaekke(tabelCeller(raekker[0]).map(tabelCelleMd)), skil,
      ...raekker.slice(1).map((tr) => r.tabelRaekke(tabelCeller(tr).map(tabelCelleMd)))].join('\n');
  }
  const ud = gl.slice();
  raekker.forEach((tr, i) => {
    const cs = tabelCeller(tr);
    if (!cs.some((c) => tabel.start.get(c) !== c.innerHTML)) return;
    ud[i === 0 ? 0 : i + 1] = r.tabelRaekke(cs.map(tabelCelleMd));
  });
  return ud.join('\n');
}

/** Skriv tabellen ind i noten - via oeens hukommelse og `dokSkriv`. */
function tabelSkriv(oe, hele) {
  const md = tabelMd(oe, hele);
  const info = dok.urort.get(oe);
  if (md === null || !info) return;
  oe.querySelectorAll('th, td').forEach((c) => tabel.start.set(c, c.innerHTML));
  if (md === info.md) return;
  info.md = md;
  dokSkriv();
}

/* ------------------------------------------------------------ tasterne */

/** Fra `dokTast`: sandt, hvis tasten er trykket i en celle (saa er den vores). */
function tabelTast(e) {
  const c = tabelCelle(e.target);
  if (!c) return false;
  const oe = dokBarn(c);
  const tr = c.parentElement;
  const raekker = [...oe.querySelectorAll('tr')];
  const r = raekker.indexOf(tr);
  const k = tabelCeller(tr).indexOf(c);
  const mod = e.metaKey || e.ctrlKey;

  if (e.key === 'Tab') {
    e.preventDefault();
    const alle = raekker.flatMap(tabelCeller);
    const i = alle.indexOf(c) + (e.shiftKey ? -1 : 1);
    if (i >= alle.length) { tabelNyRaekke(oe, raekker.length - 1, 0); return true; }
    if (i >= 0) tabelFokus(alle[i], true);
    return true;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    // Shift+Enter: en celle har ingen linjeskift i markdown - saa intet.
    if (e.shiftKey) return true;
    if (r === raekker.length - 1) { tabelNyRaekke(oe, r, k); return true; }
    tabelFokus(tabelCeller(raekker[r + 1])[k] || tabelCeller(raekker[r + 1])[0], false);
    return true;
  }
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !mod) {
    e.preventDefault();
    const til = r + (e.key === 'ArrowUp' ? -1 : 1);
    if (til >= 0 && til < raekker.length) {
      tabelFokus(tabelCeller(raekker[til])[k] || tabelCeller(raekker[til])[0], false);
    } else tabelUd(oe, e.key === 'ArrowDown');
    return true;
  }
  if (e.key === 'Escape') { e.preventDefault(); tabelUd(oe, true); return true; }
  if (mod && !e.shiftKey && !e.altKey) {
    const kmd = { b: 'bold', i: 'italic', u: 'underline' }[e.key.toLowerCase()];
    if (kmd) { e.preventDefault(); document.execCommand(kmd); return true; }
  }
  return true;
}

/** Markoeren i en celle: hele teksten markeret (Tab) eller sidst (Enter/pile). */
function tabelFokus(c, marker) {
  if (!c) return;
  c.focus();
  const sel = window.getSelection();
  const rng = document.createRange();
  rng.selectNodeContents(c);
  if (!marker) rng.collapse(false);
  sel.removeAllRanges();
  sel.addRange(rng);
  visTabelBar();
}

/** Ud af tabellen - til blokken efter (eller foer). Er der ingen, laves et afsnit. */
function tabelUd(oe, ned) {
  let naboer = ned ? oe.nextElementSibling : oe.previousElementSibling;
  while (naboer && dokErOe(naboer)) naboer = ned ? naboer.nextElementSibling : naboer.previousElementSibling;
  if (!naboer && ned) {
    naboer = document.createElement('p');
    naboer.appendChild(document.createElement('br'));
    oe.after(naboer);
  }
  if (!naboer) return;
  dok.el.focus();
  const sel = window.getSelection();
  const rng = document.createRange();
  rng.selectNodeContents(naboer);
  rng.collapse(ned);
  sel.removeAllRanges();
  sel.addRange(rng);
  skjulTabelBar();
}

/* --------------------------------------------------- raekker og kolonner */

function tabelTomCelle(tag, klasse) {
  const c = document.createElement(tag);
  if (klasse) c.className = klasse;
  c.setAttribute('contenteditable', 'true');
  c.spellcheck = true;
  c.appendChild(document.createElement('br'));
  return c;
}

/** Ny raekke under raekke nr. `efter` - og markoeren i dens kolonne `k`. */
function tabelNyRaekke(oe, efter, k) {
  const raekker = [...oe.querySelectorAll('tr')];
  const mal = raekker[Math.max(1, efter)] || raekker[0];
  const ny = document.createElement('tr');
  tabelCeller(mal).forEach((c) => ny.appendChild(tabelTomCelle('td', c.className)));
  if (efter === 0) {
    const tb = oe.querySelector('tbody') || oe.querySelector('table').appendChild(document.createElement('tbody'));
    tb.prepend(ny);
  } else raekker[efter].after(ny);
  tabelSkriv(oe, true);
  tabelFokus(tabelCeller(ny)[k] || tabelCeller(ny)[0], false);
}

function tabelNyKolonne(oe, efter) {
  const raekker = [...oe.querySelectorAll('tr')];
  raekker.forEach((tr, i) => {
    const ny = tabelTomCelle(i === 0 ? 'th' : 'td', '');
    const cs = tabelCeller(tr);
    if (cs[efter]) cs[efter].after(ny); else tr.appendChild(ny);
  });
  tabelSkriv(oe, true);
  tabelFokus(tabelCeller(raekker[0])[efter + 1], false);
}

function tabelSletRaekke(oe, c) {
  const tr = c.parentElement;
  if (c.tagName === 'TH') { toast('The header row stays - delete the table as markdown (MD).'); return; }
  const raekker = [...oe.querySelectorAll('tr')];
  const i = raekker.indexOf(tr);
  const k = tabelCeller(tr).indexOf(c);
  tr.remove();
  tabelSkriv(oe, true);
  const tilbage = [...oe.querySelectorAll('tr')];
  const naeste = tilbage[Math.min(i, tilbage.length - 1)];
  tabelFokus(tabelCeller(naeste)[k] || tabelCeller(naeste)[0], false);
}

function tabelSletKolonne(oe, c) {
  const k = tabelCeller(c.parentElement).indexOf(c);
  const raekker = [...oe.querySelectorAll('tr')];
  if (tabelCeller(raekker[0]).length <= 1) { toast('A table needs at least one column.'); return; }
  raekker.forEach((tr) => { const x = tabelCeller(tr)[k]; if (x) x.remove(); });
  tabelSkriv(oe, true);
  const cs = tabelCeller(c.parentElement && c.parentElement.isConnected ? c.parentElement : raekker[0]);
  tabelFokus(tabelCeller(raekker[0])[Math.min(k, tabelCeller(raekker[0]).length - 1)] || cs[0], false);
}

/**
 * Kopiér hele tabellen - som TSV OG HTML, saa den lander i celler i Excel,
 * Word og Teams, og som tekst alle andre steder.
 */
async function tabelKopier(oe) {
  const raekker = [...oe.querySelectorAll('tr')];
  const tekst = raekker.map((tr) => tabelCeller(tr).map((c) => c.innerText.replace(/\s+/g, ' ').trim()).join('\t')).join('\n');
  const t = oe.querySelector('table').cloneNode(true);
  t.querySelectorAll('[contenteditable]').forEach((x) => x.removeAttribute('contenteditable'));
  t.querySelectorAll(DOK_PYNT).forEach((x) => x.remove());
  try {
    if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
      await navigator.clipboard.write([new ClipboardItem({
        'text/plain': new Blob([tekst], { type: 'text/plain' }),
        'text/html': new Blob([t.outerHTML], { type: 'text/html' }),
      })]);
    } else await navigator.clipboard.writeText(tekst);
    toast('Table copied.');
  } catch { toast('Could not copy the table.'); }
}

/* ------------------------------------------------------------ linjen */

/*
 * Tabellens egen linje - i stedet for dokumentets, mens markoeren staar i en
 * celle. Dokumentets knapper (fed, overskrift, kodeblok) virker paa
 * dokumentet og ville goere noget forkert i en celle.
 */
function visTabelBar() {
  const c = tabelCelleVedMarkoer();
  const host = document.getElementById('noteBody');
  if (!c || !host) { skjulTabelBar(); return; }
  tabel.celle = c;
  const linje = document.getElementById('blokVaerktoej');
  if (linje && linje.classList.contains('dok-vaerktoej')) linje.remove();
  let bar = document.getElementById('tabelBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'tabelBar';
    bar.className = 'blok-vaerktoej dok-vaerktoej tabel-bar';
    const knap = (goer, vis, navn) => `<button type="button" class="vt-knap vt-tekst" data-tabel="${goer}"
      tabindex="-1" title="${esc(navn)}" aria-label="${esc(navn)}">${vis}</button>`;
    bar.innerHTML = knap('raekke', '+ Row', 'Add a row below')
      + knap('kolonne', '+ Column', 'Add a column to the right')
      + '<span class="vt-skel" aria-hidden="true"></span>'
      + knap('sletraekke', '− Row', 'Delete this row')
      + knap('sletkolonne', '− Column', 'Delete this column')
      + '<span class="vt-skel" aria-hidden="true"></span>'
      + knap('kopier', 'Copy', 'Copy the table (pastes as cells in Excel)')
      + knap('md', 'MD', 'Edit the table as markdown');
    bar.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const k = e.target.closest('[data-tabel]');
      const celle = tabel.celle;
      if (!k || !celle || !celle.isConnected) return;
      const oe = dokBarn(celle);
      const tr = celle.parentElement;
      const raekker = [...oe.querySelectorAll('tr')];
      const goer = k.dataset.tabel;
      if (goer === 'raekke') tabelNyRaekke(oe, raekker.indexOf(tr), tabelCeller(tr).indexOf(celle));
      else if (goer === 'kolonne') tabelNyKolonne(oe, tabelCeller(tr).indexOf(celle));
      else if (goer === 'sletraekke') tabelSletRaekke(oe, celle);
      else if (goer === 'sletkolonne') tabelSletKolonne(oe, celle);
      else if (goer === 'kopier') tabelKopier(oe);
      else if (goer === 'md') {
        const fra = dokFra(oe);
        skjulTabelBar();
        if (fra !== null) { dokTvingSkriv(); aabnBlok(fra); }
      }
    });
    host.appendChild(bar);
  }
  // Over tabellen, i hoejre side - eller i bunden paa en telefon.
  if (smalSkaerm()) {
    const vv = window.visualViewport;
    const under = vv ? Math.max(0, window.innerHeight - (vv.height + vv.offsetTop)) : 0;
    bar.classList.add('bund');
    bar.style.top = '';
    bar.style.bottom = `${under}px`;
    return;
  }
  bar.classList.remove('bund');
  const oe = dokBarn(c);
  const hr = host.getBoundingClientRect();
  const tr = oe.getBoundingClientRect();
  const bjaelke = document.querySelector('.topbar');
  const loft = bjaelke ? bjaelke.getBoundingClientRect().bottom : 0;
  const h = bar.offsetHeight;
  const cr = c.getBoundingClientRect();
  // Over tabellen; er toppen rullet op under bjaelken, saa over cellen.
  let y = tr.top - h - 6;
  if (y < loft + 4) y = cr.top - h - 6;
  if (y < loft + 4) y = cr.bottom + 6;
  bar.style.top = `${Math.round(y - hr.top)}px`;
}

function skjulTabelBar() {
  const bar = document.getElementById('tabelBar');
  if (bar) bar.remove();
  tabel.celle = null;
}

document.addEventListener('selectionchange', () => {
  if (!dokAktiv()) { if (document.getElementById('tabelBar')) skjulTabelBar(); return; }
  if (tabelCelleVedMarkoer()) visTabelBar();
  else if (document.getElementById('tabelBar')) skjulTabelBar();
});

/* ------------------------------------------------------- ny tabel */

const NY_TABEL = ['| Column 1 | Column 2 | Column 3 |', '| --- | --- | --- |', '|  |  |  |', '|  |  |  |'];

/**
 * »Table« i dokumentets linje: en ny 3×2-tabel efter den blok, markoeren
 * staar i - eller I STEDET for den, hvis det er et tomt afsnit.
 *
 * Et usynligt tegn saettes ved markoeren, foer noten skrives, saa ogsaa et
 * helt nyt, tomt afsnit kan findes i markdown'en bagefter.
 */
function dokNyTabel() {
  if (!dokAktiv() || !editor.note) return;
  const sel = window.getSelection();
  if (sel && sel.rangeCount && dok.el.contains(sel.getRangeAt(0).startContainer)) {
    const r = sel.getRangeAt(0).cloneRange();
    r.collapse(false);
    r.insertNode(document.createTextNode(DOK_MARKOER));
  }
  dokTvingSkriv();
  const linjer = editor.note.body.split('\n');
  const i = linjer.findIndex((l) => l.includes(DOK_MARKOER));
  let at = linjer.length;
  if (i >= 0) {
    const b = saguMarkdown.blokke(editor.note.body).find((x) => x.fra <= i && i <= x.til) || { fra: i, til: i };
    for (let j = b.fra; j <= b.til; j++) linjer[j] = linjer[j].split(DOK_MARKOER).join('');
    const tom = !linjer.slice(b.fra, b.til + 1).join('').trim();
    if (tom) { linjer.splice(b.fra, b.til - b.fra + 1); at = b.fra; } else at = b.til + 1;
  }
  while (at > linjer.length) at--;
  const ind = [];
  if (at > 0 && linjer[at - 1].trim()) ind.push('');
  const start = at + ind.length;
  ind.push(...NY_TABEL);
  if (at < linjer.length && linjer[at].trim()) ind.push('');
  linjer.splice(at, 0, ...ind);
  editor.note.body = linjer.join('\n');
  markerBeskidt();
  dokTegnOm();
  const ny = dok.el && dok.el.querySelector(`:scope > .dok-tabel[data-blok="${start}"]`);
  const foerste = ny && ny.querySelector('th');
  if (foerste) tabelFokus(foerste, true);
}
