'use strict';
/*
 * Sagu - GitHub i noter (F12).
 *
 * ── To ting, og de er ikke ens ────────────────────────────────────────────
 *
 * En **fil** er noget, man skriver en note OM: den skal stå stille. Adressen
 * fryses til en commit-sha ved indsættelsen, og der er en opdatér-knap, hvis
 * man vil have det nye. Ellers ville noten forklare en kode, der ikke findes
 * mere, uden at noget fejlede.
 *
 * En **sag** eller en **PR** er det modsatte: den skal netop vise, hvordan
 * det står NU. En note, der siger »afventer #42«, skal kunne fortælle, at
 * #42 blev lukket i mandags.
 *
 * ── Hvorfor der er en pladsholder ─────────────────────────────────────────
 *
 * Rendereren kender ikke GitHub — den ved kun, at afsnittet er én bar adresse
 * (`bartLink`-krogen). Kortet tegnes derfor som en tom ramme, og indholdet
 * hentes bagefter. Det er med vilje: **optegningen må aldrig vente på et
 * netværkskald**, og en note med fem indlejringer skal tegne lige så hurtigt
 * som en uden (samme regel som doda-broen, DESIGN.md §16).
 */

/**
 * Rendererens krog. Ren HTML, ingen hentning - den sker bagefter.
 *
 * Svarer null, når linjen ikke er en GitHub-adresse, vi kan vise noget om.
 * Så bliver den et helt almindeligt afsnit med et link, præcis som før.
 */
function ghKrog(url, blok) {
  const info = saguGithub.linjeAdresse(url);
  if (!info) return null;
  const mrk = blok ? ` data-blok="${blok.fra}" data-til="${blok.til}"` : '';
  return `<div class="gh-kort gh-venter" data-gh="${esc(url)}"${mrk}>
      <div class="gh-hoved">
        <span class="gh-mark">${icon('github', 15)}</span>
        <span class="gh-navn">${esc(saguGithub.navn(info))}</span>
      </div>
      <div class="gh-krop"><p class="meta saetning">Loading from GitHub…</p></div>
    </div>`;
}

/**
 * Fylder de tomme rammer. Kaldes EFTER optegningen.
 *
 * Én ad gangen med vilje: fem parallelle kald til GitHub ville ramme
 * kvotegrænsen hurtigere, og der er ingen, der kan læse fem kodeblokke på én
 * gang alligevel.
 */
async function fyldGhIndlejringer(host) {
  const rammer = [...(host || document).querySelectorAll('.gh-kort.gh-venter')];
  for (const ramme of rammer) {
    ramme.classList.remove('gh-venter');
    await fyldEn(ramme);
  }
}

async function fyldEn(ramme) {
  const url = ramme.dataset.gh;
  const krop = ramme.querySelector('.gh-krop');
  try {
    const d = await api('GET', `/api/v1/github?url=${encodeURIComponent(url)}`);
    ramme.innerHTML = ghKortHtml(d.embed, url, d.warning);
    bindGhKort(ramme);
  } catch (ex) {
    /*
     * En fejl må ikke tage linket med sig.
     *
     * Man skal kunne komme til adressen ALLIGEVEL - det var trods alt den,
     * der stod der. Et kort, der bliver til en fejlbesked og ikke andet,
     * har taget noget fra noten.
     */
    krop.innerHTML = `<p class="gh-fejl">${esc(ex.message)}</p>
      <p class="meta saetning"><a href="${attrEsc(url)}" target="_blank" rel="noopener noreferrer">Open on GitHub</a></p>`;
    ramme.classList.add('gh-daarlig');
  }
}

const attrEsc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ------------------------------------------------------------- kortene */

function ghKortHtml(e, url, advarsel) {
  return e.slags === 'fil' ? ghFilHtml(e, url, advarsel) : ghSagHtml(e, url, advarsel);
}

function ghFilHtml(e, url, advarsel) {
  const linjer = e.tekst.split('\n');
  /*
   * Chippen skal sige SANDHEDEN om, hvad man kigger paa.
   *
   * En note skrevet gennem API'et eller MCP'en er aldrig kommet forbi
   * editoren, saa dens adresse kan stadig pege paa en gren. Foer stod der en
   * chip med »frozen at this commit« og et grennavn i - altsaa en paastand om
   * det stik modsatte af det, der var tilfaeldet. Nu staar der, hvad der ER,
   * og knappen tilbyder det, der mangler.
   */
  const frossen = saguGithub.ER_SHA.test(String(e.sha || ''));
  return `<div class="gh-hoved">
      <span class="gh-mark">${icon('github', 15)}</span>
      <a class="gh-navn" href="${attrEsc(e.url)}" target="_blank" rel="noopener noreferrer"
        >${esc(e.ejer)}/${esc(e.repo)} · ${esc(e.sti)}</a>
      <span class="gh-sha${frossen ? '' : ' gh-levende'}"
        title="${frossen ? 'Frozen at this commit' : 'Still points at a branch — it can change under you'}"
        >${frossen ? esc(e.sha.slice(0, 7)) : esc(e.sha)}</span>
      <span class="gh-tools">
        <button class="iconbtn" data-gh-kopi title="Copy the code">${icon('copy', 15)}</button>
        <button class="iconbtn" data-gh-frisk
          title="${frossen ? 'Fetch the newest version' : 'Freeze it at the commit it points to now'}"
          >${icon(frossen ? 'opfrisk' : 'laas', 15)}</button>
      </span>
    </div>
    ${advarsel ? `<p class="gh-fejl">${esc(advarsel)} Showing what was cached.</p>` : ''}
    <div class="gh-kode"><table><tbody>${linjer.map((l, i) => `<tr>
      <td class="gh-nr">${e.foersteLinje + i}</td><td class="gh-l">${esc(l) || '&nbsp;'}</td>
    </tr>`).join('')}</tbody></table></div>
    <div class="gh-fod meta">
      ${e.linjer} of ${e.ialt} line${e.ialt === 1 ? '' : 's'}${e.afkortet ? ' — cut off here' : ''}
    </div>`;
}

function ghSagHtml(e, url, advarsel) {
  const TILSTAND = {
    open: ['Open', 'gh-open'],
    closed: ['Closed', 'gh-closed'],
    merged: ['Merged', 'gh-merged'],
  };
  const [ord, klasse] = TILSTAND[e.tilstand] || TILSTAND.open;
  return `<div class="gh-hoved">
      <span class="gh-mark">${icon('github', 15)}</span>
      <a class="gh-navn" href="${attrEsc(e.url)}" target="_blank" rel="noopener noreferrer"
        >${esc(e.titel || 'Untitled')}</a>
      <span class="gh-status ${klasse}">${e.udkast && e.tilstand === 'open' ? 'Draft' : ord}</span>
    </div>
    ${advarsel ? `<p class="gh-fejl">${esc(advarsel)} Showing what was cached.</p>` : ''}
    <div class="gh-fod meta">
      ${esc(e.ejer)}/${esc(e.repo)}#${e.nummer}${e.forfatter ? ` · ${esc(e.forfatter)}` : ''}${
  e.kommentarer ? ` · ${e.kommentarer} comment${e.kommentarer === 1 ? '' : 's'}` : ''}
      ${e.maerker.length ? e.maerker.map((m) => `<span class="gh-maerke">${esc(m)}</span>`).join('') : ''}
    </div>`;
}

function bindGhKort(ramme) {
  /*
   * Et klik i kortet maa ikke aabne redigeringsfeltet.
   *
   * Kroppen har ÉN delegeret klik-handler, der aabner den raa blok - det er
   * dét, den hybride editor er. Uden den her linje gjorde et tryk paa
   * »kopiér« begge dele: koden blev kopieret, OG teksten blev til et
   * tekstfelt, saa kortet forsvandt under fingeren. Samme vagt som
   * tjekboksene har (`bindTjek`).
   */
  ramme.addEventListener('click', (e) => {
    if (e.target.closest('button, a')) e.stopPropagation();
  });

  const kopi = ramme.querySelector('[data-gh-kopi]');
  if (kopi) {
    kopi.addEventListener('click', async () => {
      const tekst = [...ramme.querySelectorAll('.gh-l')].map((td) => td.textContent).join('\n');
      try {
        await navigator.clipboard.writeText(tekst);
        toast('Code copied.');
      } catch { toast('The browser would not let me copy.'); }
    });
  }

  const frisk = ramme.querySelector('[data-gh-frisk]');
  if (frisk) {
    frisk.addEventListener('click', async () => {
      /*
       * »Opdatér« er et VALG, og det skriver i noten.
       *
       * Den nye sha skal stå i teksten - ellers ville kortet vise noget
       * andet end den adresse, der er skrevet ned, og næste optegning ville
       * falde tilbage til den gamle. Markdown er sandheden.
       */
      const gammel = ramme.dataset.gh;
      const info = saguGithub.linjeAdresse(gammel);
      if (!info || !maaRette(editor.note)) { toast('Only the owner can update this.'); return; }
      frisk.disabled = true;
      try {
        // Peger den stadig paa en gren, er handlingen »frys den« - og saa er
        // det GRENEN, der skal slaas op, ikke HEAD.
        if (!info.frossen) {
          const d0 = await api('POST', '/api/v1/github/freeze', { url: gammel });
          editor.note.body = editor.note.body.split('\n')
            .map((l) => (l.trim() === gammel ? d0.url : l)).join('\n');
          markerBeskidt();
          await gemNu();
          tegnKrop();
          toast('Frozen at the current commit.');
          return;
        }
        /*
         * `HEAD` er repoets EGEN standardgren, hvad den saa end hedder.
         *
         * Adressen i noten er frossen, saa grennavnet staar der ikke laengere.
         * At gaette paa `main` ville fejle paa alt aeldre, og at gemme
         * grennavnet ved siden af ville vaere en tabel, der kan komme i
         * utakt med teksten.
         */
        const d = await api('POST', '/api/v1/github/freeze', { url: saguGithub.medRef(info, 'HEAD') });
        if (d.url === gammel) { toast('Already the newest version.'); frisk.disabled = false; return; }
        editor.note.body = editor.note.body.split('\n')
          .map((l) => (l.trim() === gammel ? d.url : l)).join('\n');
        markerBeskidt();
        await gemNu();
        tegnKrop();
      } catch (ex) { toast(ex.message); frisk.disabled = false; }
    });
  }
}

/* --------------------------------------------------------- indsættelse */

/**
 * Fryser de GitHub-adresser, der lige er skrevet ind.
 *
 * Kaldes når en blok lukkes — ét sted, så det virker uanset om linjen blev
 * skrevet, indsat eller sat ind med genvejen. Adressen skrives om i noten,
 * så **teksten** bærer sha'en; ingen tabel ved siden af, og indlejringen
 * overlever både en eksport og en note kopieret over i en anden app.
 *
 * Fejler opslaget, sker der INGENTING. Linjen bliver stående som den er, og
 * kortet viser fejlen bagefter — en gemning må ikke kunne mislykkes, fordi
 * GitHub har en dårlig dag.
 */
async function frysGhAdresser() {
  const n = editor.note;
  if (!n || !maaRette(n)) return false;
  const linjer = n.body.split('\n');
  let aendret = false;

  for (let i = 0; i < linjer.length; i++) {
    const raa = linjer[i].trim();
    const info = saguGithub.linjeAdresse(raa);
    // Kun filer på en GREN. En sag skal netop ikke fryses, og en fil, der
    // allerede har sin sha, er der ikke noget at gøre ved.
    if (!info || info.slags !== 'fil' || info.frossen) continue;
    try {
      const d = await api('POST', '/api/v1/github/freeze', { url: raa });
      if (d.frozen && d.url !== raa) { linjer[i] = d.url; aendret = true; }
    } catch { /* linjen bliver staaende - kortet siger hvorfor */ }
  }

  if (!aendret) return false;
  n.body = linjer.join('\n');
  markerBeskidt();
  await gemNu();
  return true;
}
