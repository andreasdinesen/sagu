/*
 * Sagu -> GitHub (F12). Kode og sager i en note.
 *
 * ── Reglen, hele modulet staar paa: sha'en fryses ─────────────────────────
 *
 * En adresse med en GREN i (`/blob/main/...`) peger paa noget, der aendrer sig.
 * Skriver man en note om, hvordan noget virker, og indsaetter linjerne der
 * viser det, saa skal de linjer BLIVE ved med at vise det - ogsaa naar nogen
 * retter i filen i naeste uge. Ellers staar noten og forklarer en kode, der
 * ikke findes mere, uden at noget fejler.
 *
 * Derfor slaas grenen op ÉN gang, ved indsaettelsen, og adressen i noten
 * skrives om til den sha, grenen pegede paa. Fra da af er indlejringen
 * frossen, og der er en **opdatér**-knap, hvis man vil have det nye. Det er et
 * VALG, ikke en automatik.
 *
 * ── Den anden regel: der maa ikke gaa et kald pr. optegning ───────────────
 *
 * Samme lektie som doda-broen (§16). En note med fem indlejringer maa ikke
 * blive fem rundture til GitHub, hver gang siden tegnes - og slet ikke paa
 * wikien, hvor en fremmed kan genindlaese saa tit han vil. Alt gaar derfor
 * gennem en cache i databasen:
 *
 *   - en FROSSEN fil caches for evigt. Den kan ikke laves om.
 *   - en sag, en PR eller en gren caches i 15 minutter og genopfriskes med
 *     `If-None-Match`, saa et 304 hverken koster kvote eller baandbredde.
 *
 * ── Tokenet ───────────────────────────────────────────────────────────────
 *
 * Uden token: 60 kald i timen pr. IP, og private repoer svarer 404. Med:
 * 5.000 i timen. Tokenet staar i `settings` som `secret: true` og forlader
 * ALDRIG serveren (RUNE-ERFARINGER §6b). Det er personligt - Sagu er
 * flerbruger, og to brugere deler ikke deres GitHub-konto.
 */

'use strict';

const ghShared = require('./shared/github.js');

/** GitHub, der ikke svarer, maa ikke kunne haenge en optegning. */
const TIMEOUT_MS = 8_000;

/** Hvor laenge noget, der KAN aendre sig, staar i cachen. */
const FRISK_I = 15 * 60;

/*
 * API-adressen. Fast - med ÉN soem, og den er snaever med vilje.
 *
 * Testene skal kunne proeve de fejl, der betyder noget (404 der daekker over
 * to ting, en opbrugt kvote, et 304), og det kraever en falsk GitHub. Men en
 * soem, der kan pege hvor som helst, er en maade at sende Andreas' token til
 * en fremmed vaert paa - saa **kun loopback accepteres**. Alt andet ignoreres
 * uden at sige noget: det er ikke en indstilling, nogen skal kunne fumle med.
 */
const API = (() => {
  const raa = String(process.env.SAGU_GITHUB_API || '');
  if (!raa) return 'https://api.github.com';
  try {
    const u = new URL(raa);
    const lokal = u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '::1';
    if (lokal) return raa.replace(/\/+$/, '');
  } catch { /* ligegyldig - vi falder tilbage */ }
  return 'https://api.github.com';
})();

/** Filer stoerre end det her indlejres ikke - de vises som et link. */
const MAX_FIL = 512 * 1024;

/** Og et uddrag paa mere end det her er ikke et uddrag. */
const MAX_LINJER = 400;

function opret(srv) {
  /** Tokenet for ÉN bruger. Tom streng = anonymt, og det er en gyldig tilstand. */
  const token = (userId) => String(srv.hentIndstilling(userId, 'github_token') || '');

  /**
   * Ét kald til GitHubs API.
   *
   * Svarer ALDRIG med en undtagelse, men med et resultat: et netvaerksbrud og
   * et afslag er to forskellige ting, og den, der kalder, skal kunne vise
   * forskellen som en paen linje frem for en fejlet optegning.
   */
  async function kald(userId, sti, etag) {
    const t = token(userId);
    const hoveder = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'sagu',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (t) hoveder.Authorization = `Bearer ${t}`;
    if (etag) hoveder['If-None-Match'] = etag;

    const afbryd = AbortSignal.timeout ? AbortSignal.timeout(TIMEOUT_MS) : undefined;
    let r;
    try {
      r = await fetch(`${API}${sti}`, { headers: hoveder, signal: afbryd });
    } catch (err) {
      return { fejl: ['unreachable', 'Could not reach GitHub. It may be a network problem here.'] };
    }

    if (r.status === 304) return { uaendret: true };
    if (r.status === 200) {
      let krop;
      try { krop = await r.json(); } catch { return { fejl: ['bad_answer', 'GitHub answered with something unreadable.'] }; }
      return { krop, etag: r.headers.get('etag') || '' };
    }

    /*
     * **404 betyder BEGGE dele** - findes ikke, og maa ikke ses.
     *
     * GitHub skelner ikke, og det er med vilje: et 403 ville bekraefte, at et
     * privat repo findes. Beskeden skal derfor naevne begge muligheder, ellers
     * fejlsoeger man et token, der er helt i orden (DESIGN.md, maaling 1 -
     * samme faelde kostede en aften ved payload-udvejen).
     */
    if (r.status === 404) {
      return {
        fejl: ['not_found', t
          ? 'GitHub says that does not exist — or your token cannot see it. Both answer 404.'
          : 'GitHub says that does not exist — or the repository is private. Both answer 404. '
            + 'Add a GitHub token in Settings to reach private repositories.'],
      };
    }
    if (r.status === 401) {
      return { fejl: ['bad_token', 'GitHub rejected the token. Make a new one in Settings.'] };
    }
    if (r.status === 403 || r.status === 429) {
      // Kvoten. Sig HVORNAAR den er tilbage - »try again later« er ikke noget,
      // nogen kan handle paa.
      const naar = Number(r.headers.get('x-ratelimit-reset') || 0);
      const om = naar ? Math.max(1, Math.round((naar * 1000 - Date.now()) / 60000)) : 0;
      return {
        fejl: ['rate_limited', t
          ? `GitHub's hourly limit is used up${om ? `. It resets in about ${om} min` : ''}.`
          : `Without a token GitHub allows 60 requests an hour${om ? `, and that is used up for about ${om} min` : ''}. `
            + 'Add a token in Settings for 5.000.'],
      };
    }
    return { fejl: ['github_error', `GitHub answered ${r.status}.`] };
  }

  /* ------------------------------------------------------------ opslag */

  /**
   * Grenen -> den sha, den peger paa LIGE NU.
   *
   * Det er hele fryse-handlingen. Kaldes ved indsaettelse og ved »opdatér«,
   * aldrig ved en optegning.
   */
  async function sha(userId, info) {
    if (info.frossen) return { sha: info.ref };
    const r = await kald(userId, `/repos/${info.ejer}/${info.repo}/commits/${encodeURIComponent(info.ref)}`);
    if (r.fejl) return { fejl: r.fejl };
    const s = r.krop && r.krop.sha;
    if (!ghShared.ER_SHA.test(String(s || ''))) {
      return { fejl: ['bad_answer', 'GitHub did not return a commit for that branch.'] };
    }
    return { sha: s };
  }

  /**
   * Indholdet bag en adresse - fra cachen, hvis det kan lade sig goere.
   *
   * @returns {{data}|{fejl:[kode,besked]}}
   */
  async function hent(userId, info) {
    const noegle = ghShared.cacheNoegle(info);
    const frossen = info.slags === 'fil' && info.frossen;
    const gemt = srv.hentCache(noegle);

    // En frossen fil kan ikke aendre sig. Er den i cachen, er vi faerdige -
    // uden et kald, uden et udloeb, uden en betingelse.
    if (gemt && (frossen || srv.nu() - gemt.hentet_at < FRISK_I)) {
      return { data: JSON.parse(gemt.data), fra: 'cache' };
    }

    const sti = info.slags === 'fil'
      ? `/repos/${info.ejer}/${info.repo}/contents/${info.sti.split('/').map(encodeURIComponent).join('/')}`
        + `?ref=${encodeURIComponent(info.ref)}`
      : `/repos/${info.ejer}/${info.repo}/issues/${info.nummer}`;

    const r = await kald(userId, sti, gemt ? gemt.etag : '');
    if (r.uaendret && gemt) {
      // 304: indholdet staar allerede rigtigt: stempl det friskt igen, saa
      // det ikke koster et kald hvert kvarter.
      srv.roerCache(noegle);
      return { data: JSON.parse(gemt.data), fra: 'etag' };
    }
    if (r.fejl) {
      // Har vi noget gammelt, er det bedre end en fejl: en note, der plud-
      // selig taber sit indhold, fordi GitHub har en daarlig dag, er vaerre
      // end en, der viser noget lidt gammelt (samme regel som doda-broen).
      if (gemt) return { data: JSON.parse(gemt.data), fra: 'gammel', advarsel: r.fejl[1] };
      return { fejl: r.fejl };
    }

    const data = info.slags === 'fil' ? formFil(info, r.krop) : formSag(info, r.krop);
    if (data.fejl) return { fejl: data.fejl };
    srv.gemCache(noegle, JSON.stringify(data), r.etag || '');
    return { data, fra: 'github' };
  }

  /* ------------------------------------------------------------- form */

  function formFil(info, krop) {
    if (!krop || krop.type !== 'file' || typeof krop.content !== 'string') {
      return { fejl: ['not_a_file', 'That address points at a folder, not a file.'] };
    }
    if (Number(krop.size) > MAX_FIL) {
      return { fejl: ['too_large', `That file is ${Math.round(krop.size / 1024)} KB — too big to show in a note.`] };
    }
    const raa = Buffer.from(krop.content, 'base64');
    /*
     * Er det overhovedet TEKST?
     *
     * En png i en note ville blive til en skaerm fuld af skrald. Et NUL-tegn
     * i de foerste tusind bytes er den samme proeve, `file(1)` og git selv
     * bruger - billig og god nok.
     */
    if (raa.subarray(0, 1024).includes(0)) {
      return { fejl: ['binary', 'That file is not text, so there is nothing to show.'] };
    }
    const alle = raa.toString('utf8').replace(/\r\n?/g, '\n').split('\n');
    // Sidste linje er tom, naar filen slutter med et linjeskift - som den boer.
    if (alle.length && alle[alle.length - 1] === '') alle.pop();

    const fra = info.fra ? Math.min(info.fra, alle.length) : 1;
    const til = info.til ? Math.min(info.til, alle.length) : alle.length;
    const valgt = alle.slice(fra - 1, til);
    const afkortet = valgt.length > MAX_LINJER;

    return {
      slags: 'fil',
      ejer: info.ejer,
      repo: info.repo,
      sti: info.sti,
      sha: info.ref,
      sprog: ghShared.sprogFor(info.sti),
      foersteLinje: fra,
      // Linjenumrene skal STAA der: et uddrag uden dem kan ikke sammenlignes
      // med filen, og »linje 40« er tit hele pointen i en note om kode.
      tekst: valgt.slice(0, MAX_LINJER).join('\n'),
      linjer: Math.min(valgt.length, MAX_LINJER),
      ialt: alle.length,
      afkortet,
      // Hele filen, ikke kun uddraget - saa »åbn på GitHub« altid virker.
      url: krop.html_url || ghShared.medRef(info, info.ref),
    };
  }

  function formSag(info, krop) {
    if (!krop || typeof krop.number !== 'number') {
      return { fejl: ['bad_answer', 'GitHub answered with something unreadable.'] };
    }
    /*
     * En PR har tre tilstande, ikke to.
     *
     * `state` siger kun open/closed - en LUKKET pr kan vaere flettet eller
     * afvist, og det er den vigtigste forskel af dem alle. `merged_at`
     * afgoer det.
     */
    const flettet = !!krop.pull_request && !!(krop.pull_request.merged_at || krop.merged_at);
    return {
      slags: krop.pull_request ? 'pr' : 'issue',
      ejer: info.ejer,
      repo: info.repo,
      nummer: krop.number,
      titel: String(krop.title || '').slice(0, 300),
      tilstand: flettet ? 'merged' : (krop.state === 'closed' ? 'closed' : 'open'),
      udkast: !!(krop.draft),
      forfatter: krop.user && krop.user.login ? String(krop.user.login).slice(0, 80) : '',
      kommentarer: Number(krop.comments) || 0,
      maerker: Array.isArray(krop.labels)
        ? krop.labels.slice(0, 6).map((l) => String(l.name || '').slice(0, 40)).filter(Boolean) : [],
      opdateret: krop.updated_at || null,
      url: krop.html_url || `https://github.com/${info.ejer}/${info.repo}/issues/${krop.number}`,
    };
  }

  return { kald, sha, hent, FRISK_I, MAX_FIL, MAX_LINJER };
}

module.exports = { opret };
