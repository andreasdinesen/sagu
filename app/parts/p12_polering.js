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
 */
document.addEventListener('keydown', (e) => {
  if (!state.user) return;
  const iFelt = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  if (iFelt(e.target) || iFelt(document.activeElement)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  const g = GENVEJE.find((x) => x.tast === e.key || (x.tast.length === 1 && x.tast === e.key.toLowerCase()));
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

function genvejeHtml() {
  const liste = (titel, noter) => (noter.length ? `
    <nav class="nav genvejsliste">
      <div class="nav-titel">${esc(titel)}</div>
      ${noter.map((n) => `<button class="nav-item" data-genvej="${esc(n.id)}"
        ${editor.note && editor.note.id === n.id ? 'aria-current="page"' : ''}>
        ${n.icon ? `<span class="nav-emoji">${esc(n.icon)}</span>` : icon('notes')}
        <span>${esc(n.title || 'Untitled')}</span>
      </button>`).join('')}
    </nav>` : '');

  return liste('Favourites', sidebarListe.favoritter)
    + liste('Recent', sidebarListe.seneste);
}

function bindGenveje() {
  document.querySelectorAll('[data-genvej]').forEach((el) => {
    el.addEventListener('click', () => aabnNote(el.dataset.genvej));
  });
}

/** Tegner KUN sit eget element. En fuld optegning ville lukke en åben blok. */
function tegnGenveje() {
  const host = document.getElementById('navGenveje');
  if (!host) return;
  host.innerHTML = genvejeHtml();
  bindGenveje();
}
