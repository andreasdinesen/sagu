/*
 * Sagu - ÉN regel for hvad en GitHub-adresse er. To køresteder.
 *
 * ── Hvorfor delt ──────────────────────────────────────────────────────────
 *
 * Tre steder skal kende formen, og de skal kende den ENS:
 *
 *   - **browseren**, for at se at det, man lige har indsat, er en GitHub-fil
 *     og bede serveren om at fryse den,
 *   - **rendereren**, for at vide at linjen er en indlejring og ikke et link,
 *   - **serveren**, for at oversaette adressen til et API-kald - og for at
 *     wikien kan tegne det samme uden app-JS (F6).
 *
 * Tre kopier ville betyde tre lidt forskellige regler, og forskellen ville
 * vise sig som »indlejringen virker i appen, men ikke paa wikien«.
 *
 * ── Reglen ────────────────────────────────────────────────────────────────
 *
 * Kun tre former genkendes, og de skal fylde **hele linjen**:
 *
 *     .../blob/<ref>/<sti>          en fil, valgfrit #L10 eller #L10-L20
 *     .../issues/<nummer>           en sag
 *     .../pull/<nummer>             en aendringsanmodning
 *
 * Alt andet - repo-roden, `/tree/` (en mappe), gists, en release - er et
 * almindeligt link. **En indlejring, der ikke kan vise noget nyttigt, skal
 * ikke se ud som en indlejring**, og et halvtomt kort er vaerre end et link,
 * der bare virker.
 */

(function (root, fabrik) {
  if (typeof module === 'object' && module.exports) module.exports = fabrik();
  else root.saguGithub = fabrik();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** En 40-tegns sha. Det er DEN, der gør en indlejring frossen. */
  const ER_SHA = /^[0-9a-f]{40}$/;

  const ejerNavn = (s) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(s);
  const repoNavn = (s) => /^[A-Za-z0-9._-]{1,100}$/.test(s);

  /**
   * Adressen -> hvad den peger paa. Ren funktion, intet net.
   *
   * @returns {null|{slags:'fil', ejer, repo, ref, frossen, sti, fra, til}
   *              |{slags:'issue'|'pr', ejer, repo, nummer}}
   */
  function tolk(raa) {
    const s = String(raa || '').trim();
    if (!s) return null;
    let u;
    try { u = new URL(s); } catch { return null; }
    // Kun github.com selv. En GitHub Enterprise-vaert har sit eget API og
    // sin egen godkendelse, og at gaette paa den ville sende et token et
    // sted hen, ingen har peget paa.
    if (u.protocol !== 'https:' || u.hostname.toLowerCase() !== 'github.com') return null;

    const dele = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (dele.length < 3) return null;
    const [ejer, repo, art] = dele;
    if (!ejerNavn(ejer) || !repoNavn(repo)) return null;

    if ((art === 'issues' || art === 'pull') && dele.length === 4) {
      const nummer = Number(dele[3]);
      if (!Number.isInteger(nummer) || nummer < 1 || nummer > 9_999_999) return null;
      return { slags: art === 'pull' ? 'pr' : 'issue', ejer, repo, nummer };
    }

    if (art === 'blob' && dele.length >= 5) {
      const ref = dele[3];
      const sti = dele.slice(4).join('/');
      if (!ref || !sti) return null;
      /*
       * Der staar IKKE en `..`-vagt her, og det er malt frem.
       *
       * `new URL()` normaliserer stien FOER vi ser den - ogsaa den kodede
       * form: `/blob/main/a/%2e%2e/b.js` bliver til `/blob/main/b.js`, og
       * `/blob/main/%2e%2e/etc/passwd` bliver til `/o/r/etc/passwd`, som
       * falder paa `art !== 'blob'`. En vagt her ville altsaa aldrig kunne
       * fyre - og en vagt, der ikke kan fyre, er vaerre end ingen: den naeste,
       * der laeser, tror der er noget at bekymre sig om, og bygger videre paa
       * en spaerring, der ikke findes (samme laerdom som m12's kolonne).
       *
       * Stien naar i oevrigt aldrig vores egen disk. Den bliver til et
       * GitHub-API-kald og intet andet.
       */
      const { fra, til } = linjer(u.hash);
      return { slags: 'fil', ejer, repo, ref, frossen: ER_SHA.test(ref), sti, fra, til };
    }

    return null;
  }

  /**
   * `#L10` og `#L10-L20`.
   *
   * `#L20-L10` vendes om frem for at blive afvist: det er en fumlet
   * markering, ikke et forsoeg paa noget - og en indlejring, der forsvinder,
   * fordi man tog linjerne i den forkerte raekkefoelge, ligner en fejl.
   */
  function linjer(hash) {
    const m = String(hash || '').match(/^#L(\d+)(?:-L(\d+))?$/);
    if (!m) return { fra: null, til: null };
    let fra = Number(m[1]);
    let til = m[2] ? Number(m[2]) : fra;
    if (!fra) return { fra: null, til: null };
    if (til < fra) { const x = fra; fra = til; til = x; }
    return { fra, til };
  }

  /** Er HELE linjen én GitHub-adresse? Det er dét, der gør den til en blok. */
  function linjeAdresse(linje) {
    const s = String(linje || '').trim();
    if (/\s/.test(s)) return null;
    return tolk(s);
  }

  /** Adressen igen - med en bestemt ref. Bruges til at fryse og til at opfriske. */
  function medRef(info, ref) {
    const sti = info.sti.split('/').map(encodeURIComponent).join('/');
    const anker = info.fra ? `#L${info.fra}${info.til && info.til !== info.fra ? `-L${info.til}` : ''}` : '';
    return `https://github.com/${info.ejer}/${info.repo}/blob/${ref}/${sti}${anker}`;
  }

  /** Adressen, som den skal VISES: ejer/repo, sti og eventuelt linjeinterval. */
  function navn(info) {
    if (info.slags !== 'fil') return `${info.ejer}/${info.repo}#${info.nummer}`;
    const l = info.fra ? `:${info.fra}${info.til !== info.fra ? `-${info.til}` : ''}` : '';
    return `${info.ejer}/${info.repo} · ${info.sti}${l}`;
  }

  /**
   * Noeglen, et svar caches under.
   *
   * En FROSSEN fil har en sha i noeglen, saa svaret kan gemmes for evigt: det
   * kan ikke laves om. En sag eller en gren kan aendre sig, og deres noegle
   * er derfor uden sha - de skal have et udloeb.
   */
  function cacheNoegle(info) {
    if (info.slags === 'fil') {
      return `fil:${info.ejer}/${info.repo}@${info.ref}:${info.sti}`;
    }
    return `${info.slags}:${info.ejer}/${info.repo}#${info.nummer}`;
  }

  /** Endelsen -> sproget, kodeblokken maerkes med. Kun til fremhaevning. */
  function sprogFor(sti) {
    const m = String(sti || '').match(/\.([A-Za-z0-9]+)$/);
    if (!m) return '';
    const e = m[1].toLowerCase();
    const KENDTE = {
      js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
      ts: 'typescript', tsx: 'typescript', py: 'python', rb: 'ruby', go: 'go',
      rs: 'rust', java: 'java', kt: 'kotlin', swift: 'swift', c: 'c', h: 'c',
      cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp', php: 'php',
      sh: 'bash', bash: 'bash', zsh: 'bash', ps1: 'powershell',
      sql: 'sql', json: 'json', yml: 'yaml', yaml: 'yaml', toml: 'toml',
      md: 'markdown', html: 'html', css: 'css', scss: 'scss', xml: 'xml',
      dockerfile: 'dockerfile', ini: 'ini', conf: 'ini',
    };
    return KENDTE[e] || '';
  }

  return { tolk, linjeAdresse, medRef, navn, cacheNoegle, sprogFor, ER_SHA };
}));
