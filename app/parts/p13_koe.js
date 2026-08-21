'use strict';
/*
 * Sagu - rettelser skrevet uden net (F15).
 *
 * ── Hvad køen ER ──────────────────────────────────────────────────────────
 *
 * Én række pr. NOTE, ikke én pr. tastetryk. Retter man den samme note tre
 * gange offline, er det den sidste tekst, der er meningen — en logbog ville
 * afspille tre gemninger oven i hinanden og kunne genopvække en halvfærdig
 * mellemtilstand. Samme regel som `note_visits` i F13.
 *
 * ── Konflikten er den svære del, ikke køen ────────────────────────────────
 *
 * Sagu har allerede en konfliktvagt: hver gemning sender `ifUpdatedAt`, og
 * serveren afviser med 409, hvis noten er ændret et andet sted. Køen bruger
 * **den samme** vagt frem for at opfinde en ny — og den gemmer det stempel,
 * man startede fra, ikke det nyeste. Ellers ville en rettelse, der har ligget
 * i lommen en dag, overskrive alt, hvad der er sket i mellemtiden, uden at
 * nogen fik det at vide.
 *
 * Går en synkronisering i konflikt, bliver rækken liggende og bliver **vist**.
 * Den må aldrig kastes væk: det er det eneste sted, den tekst findes.
 *
 * ── Det, køen IKKE gør ────────────────────────────────────────────────────
 *
 * Den opretter ikke noter. En ny note offline ville skulle have et midlertidigt
 * id, som derefter skulle skiftes ud overalt — i træet, i favoritterne, i
 * `[[links]]`, i adresselinjen. Det er en fase for sig, og at bygge halvdelen
 * ville betyde noter, der peger på et id, som ikke findes.
 */

const KOE_NOEGLE = 'sagu_koe';

/** Køen i hukommelsen. Læses ÉN gang og skrives ved hver ændring. */
let koen = [];

function laesKoe() {
  try {
    const raa = localStorage.getItem(KOE_NOEGLE);
    koen = raa ? JSON.parse(raa) : [];
    if (!Array.isArray(koen)) koen = [];
  } catch { koen = []; }
  return koen;
}

/**
 * Skriver køen til disken.
 *
 * `localStorage` har et loft på nogle få MB, og en note kan være stor. Kan
 * rettelsen ikke parkeres, skal det siges **med det samme** — ikke opdages
 * ved synkroniseringen, hvor teksten for længst er væk fra skærmen.
 */
function skrivKoe() {
  try {
    localStorage.setItem(KOE_NOEGLE, JSON.stringify(koen));
    return true;
  } catch {
    return false;
  }
}

/** Kun MINE rækker. En kø må ikke kunne afspilles ind i en anden konto. */
function minKoe() {
  const mig = state.user && state.user.id;
  return koen.filter((k) => k.bruger === mig);
}

const antalIKoe = () => minKoe().length;
const antalKonflikter = () => minKoe().filter((k) => k.konflikt).length;

/**
 * Parkér en rettelse.
 *
 * `ifUpdatedAt` sættes KUN første gang. Det stempel er »den udgave, jeg
 * skrev ovenpå«, og det er dét, konfliktvagten skal måle imod — bliver det
 * skubbet frem ved hver ny rettelse, ender vagten med at sammenligne med sig
 * selv og siger god for alt.
 */
function parkér(note) {
  const mig = state.user && state.user.id;
  const gammel = koen.find((k) => k.id === note.id && k.bruger === mig);
  if (gammel) {
    gammel.title = note.title;
    gammel.body = note.body;
    gammel.at = Date.now();
    gammel.konflikt = false;
  } else {
    koen.push({
      id: note.id,
      bruger: mig,
      title: note.title,
      body: note.body,
      fra: note.updatedAt,
      at: Date.now(),
      konflikt: false,
    });
  }
  if (!skrivKoe()) {
    // Rul tilbage: en kø, der siger den har gemt noget, den ikke har, er
    // værre end ingen kø.
    if (!gammel) koen.pop();
    toast('There is no room to park this change on the device. Copy the text somewhere safe.');
    return false;
  }
  visKoeBaand();
  return true;
}

function fjernFraKoe(id) {
  const mig = state.user && state.user.id;
  koen = koen.filter((k) => !(k.id === id && k.bruger === mig));
  skrivKoe();
  visKoeBaand();
}

/** Køen tømmes ved log ud - som cachen. Den hører til den, der skrev den. */
function ryddKoe() {
  koen = [];
  try { localStorage.removeItem(KOE_NOEGLE); } catch { /* ingenting at rydde */ }
}

/* ------------------------------------------------------ synkronisering */

let synkroniserer = false;

/**
 * Sender det, der venter. Kaldes ved opstart og når nettet kommer igen.
 *
 * Én ad gangen med vilje: rækkefølgen er brugerens egen, og et parallelt
 * bundt ville ramme serveren i tilfældig orden — hvilket betyder noget, hvis
 * to af rettelserne hører til den samme side og dens underside.
 */
async function synkKoe(stille) {
  if (synkroniserer || !state.user) return { sendt: 0, konflikter: 0 };
  const venter = minKoe().filter((k) => !k.konflikt);
  if (!venter.length) return { sendt: 0, konflikter: 0 };

  synkroniserer = true;
  let sendt = 0;
  let konflikter = 0;
  try {
    for (const k of venter) {
      try {
        await api('PATCH', `/api/v1/notes/${k.id}`, {
          title: k.title, body: k.body, ifUpdatedAt: k.fra,
        });
        fjernFraKoe(k.id);
        sendt++;
      } catch (ex) {
        if (ex.offline) break;              // stadig uden net - proev senere
        if (ex.status === 409) {
          k.konflikt = true;
          skrivKoe();
          konflikter++;
          continue;
        }
        if (ex.status === 404) {
          /*
           * Noten findes ikke mere - slettet et andet sted, mens rettelsen
           * laa i lommen. Raekken bliver LIGGENDE og markeret: teksten er
           * det eneste, der er tilbage af den, og at kaste den vaek ville
           * vaere at slette noget, brugeren har skrevet.
           */
          k.konflikt = true;
          k.vaek = true;
          skrivKoe();
          konflikter++;
          continue;
        }
        break;                               // noget andet er galt - stop
      }
    }
  } finally {
    synkroniserer = false;
  }

  visKoeBaand();
  if (sendt && !stille) {
    toast(sendt === 1 ? 'Your change from offline was saved.'
      : `${sendt} changes from offline were saved.`);
  }
  if (konflikter) {
    toast(konflikter === 1 ? 'One change could not be saved — open it to decide.'
      : `${konflikter} changes could not be saved — open them to decide.`,
    { label: 'Show', run: () => visKoePanel() });
  }
  // Er der stadig noget, og er vi online, saa proev igen om lidt.
  if (antalIKoe() > antalKonflikter() && navigator.onLine) setTimeout(() => synkKoe(true), 15000);
  return { sendt, konflikter };
}

/* ------------------------------------------------------------- båndet */

/**
 * Ét bånd, to tilstande.
 *
 * Offline-båndet fandtes i forvejen (F14); det her lægger tallet til, så man
 * kan se, at der ER noget at vente på. En prik, der bare siger »offline«,
 * fortæller ikke, om det man skrev, er i sikkerhed.
 */
function visKoeBaand() {
  const b = document.getElementById('offlineBaand');
  if (!b) return;
  const venter = antalIKoe();
  const strid = antalKonflikter();
  const tekst = b.querySelector('.baand-tekst');
  if (!tekst) return;

  if (strid) {
    b.hidden = false;
    b.classList.add('har-strid');
    tekst.innerHTML = `${strid} change${strid === 1 ? '' : 's'} could not be saved — `
      + 'the page was changed somewhere else. '
      + '<button class="linkbtn" id="koeVis">Decide what to keep</button>';
    const knap = document.getElementById('koeVis');
    if (knap) knap.addEventListener('click', () => visKoePanel());
    return;
  }
  b.classList.remove('har-strid');
  if (venter) {
    b.hidden = false;
    tekst.textContent = state.offline
      ? `Offline — ${venter} change${venter === 1 ? '' : 's'} waiting. They are saved on this device and sent when you are back.`
      : `Sending ${venter} change${venter === 1 ? '' : 's'}…`;
    return;
  }
  if (state.offline) {
    b.hidden = false;
    tekst.textContent = 'Offline — showing what was loaded last.';
    return;
  }
  b.hidden = true;
}

/* ------------------------------------------------------------- panelet */

/**
 * Konflikterne, én ad gangen, med begge tekster.
 *
 * **Begge udgaver skal kunne SES**, før man vælger. Et valg mellem »min« og
 * »deres« uden at kunne læse dem er ikke et valg — og det er den eneste
 * skærm i appen, hvor et forkert klik koster noget, der ikke kan hentes
 * tilbage.
 */
async function visKoePanel() {
  const gammel = document.getElementById('koePanel');
  if (gammel) { gammel.remove(); return; }
  const strid = minKoe().filter((k) => k.konflikt);
  if (!strid.length) return;

  const host = document.createElement('div');
  host.className = 'modal';
  host.id = 'koePanel';
  host.innerHTML = `<div class="modal-kort">
      <div class="modal-top">
        <h2>Changes that could not be saved</h2>
        <button class="iconbtn" id="koeLuk" aria-label="Close">${icon('luk', 16)}</button>
      </div>
      <div class="modal-krop" id="koeKrop"><p class="meta saetning">Loading…</p></div>
    </div>`;
  document.body.appendChild(host);

  const luk = () => { host.remove(); document.removeEventListener('keydown', paaTast); };
  const paaTast = (e) => { if (e.key === 'Escape') { e.preventDefault(); luk(); } };
  document.addEventListener('keydown', paaTast);
  host.querySelector('#koeLuk').addEventListener('click', luk);
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });

  const krop = host.querySelector('#koeKrop');

  async function tegn() {
    const liste = minKoe().filter((k) => k.konflikt);
    if (!liste.length) { luk(); return; }

    const dele = [];
    for (const k of liste) {
      let deres = null;
      if (!k.vaek) {
        try { deres = (await api('GET', `/api/v1/notes/${k.id}`)).note; } catch { deres = null; }
      }
      dele.push(`<div class="strid" data-strid="${esc(k.id)}">
        <h3>${esc((deres && deres.title) || k.title || 'Untitled')}</h3>
        ${k.vaek ? `<p class="meta saetning"><strong>That page has been deleted</strong> since you
          wrote this. Your text is below — copy what you need before you discard it.</p>` : `
          <p class="meta saetning">Changed somewhere else while your version waited on this
          device. Written offline ${esc(visTid(Math.floor(k.at / 1000)))}.</p>`}
        <div class="strid-side">
          <h4>Yours, from this device</h4>
          <pre>${esc((k.body || '').slice(0, 4000))}</pre>
        </div>
        ${deres ? `<div class="strid-side">
          <h4>What is on the server now</h4>
          <pre>${esc((deres.body || '').slice(0, 4000))}</pre>
        </div>` : ''}
        <div class="btnrow">
          ${k.vaek ? '' : `<button class="btn primary" data-behold="${esc(k.id)}">Keep mine</button>
          <button class="btn" data-aabn="${esc(k.id)}">Open the page</button>`}
          <button class="btn ghost danger" data-kassér="${esc(k.id)}">Discard mine</button>
        </div>
      </div>`);
    }
    krop.innerHTML = dele.join('');

    krop.querySelectorAll('[data-behold]').forEach((el) => {
      el.addEventListener('click', async () => {
        const k = koen.find((x) => x.id === el.dataset.behold);
        if (!k) return;
        el.disabled = true;
        try {
          // UDEN `ifUpdatedAt`: det er præcis dét, »behold min« betyder, og
          // brugeren har set den anden tekst, før han valgte.
          await api('PATCH', `/api/v1/notes/${k.id}`, { title: k.title, body: k.body });
          fjernFraKoe(k.id);
          toast('Your version was saved.');
          if (editor.note && editor.note.id === k.id) await aabnNote(k.id);
          await tegn();
        } catch (ex) { toast(ex.message); el.disabled = false; }
      });
    });
    krop.querySelectorAll('[data-kassér]').forEach((el) => {
      el.addEventListener('click', () => {
        if (!confirm('Discard your offline version?\n\nThe text is only on this device — '
          + 'it cannot be brought back.')) return;
        fjernFraKoe(el.dataset.kassér);
        tegn();
      });
    });
    krop.querySelectorAll('[data-aabn]').forEach((el) => {
      el.addEventListener('click', () => { luk(); aabnNote(el.dataset.aabn); });
    });
  }

  await tegn();
}
