/* ---- shared/github.js ---- */
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

  /*
   * De adresser, indlejringen forstaar - som HJAELPEN viser dem.
   *
   * De bor her hos `tolk()`, ikke i fladen, og `tests/github.test.mjs`
   * koerer hver eneste af dem gennem `tolk()`. Falder én, kan hjaelpen ikke
   * blive ved med at love den. Samme regel som `SYNTAKS` i markdown-modulet.
   */
  const ADRESSER = [
    { navn: 'A whole file', kode: 'https://github.com/owner/repo/blob/main/README.md' },
    { navn: 'One line', kode: 'https://github.com/owner/repo/blob/main/src/app.js#L42' },
    { navn: 'A range of lines', kode: 'https://github.com/owner/repo/blob/main/src/app.js#L10-L20' },
    { navn: 'A frozen version', kode: 'https://github.com/owner/repo/blob/a1b2c3d4e5f60718293a4b5c6d7e8f9012345678/README.md' },
    { navn: 'An issue', kode: 'https://github.com/owner/repo/issues/12' },
    { navn: 'A pull request', kode: 'https://github.com/owner/repo/pull/34' },
  ];

  return { tolk, linjeAdresse, medRef, navn, cacheNoegle, sprogFor, ER_SHA, ADRESSER };
}));

/* ---- shared/maerker.js ---- */
/*
 * Sagu - én regel for `#maerke` i en tekst. To koersteder.
 *
 * Reglen laa i frontenden, indtil API'et (F9) fik brug for den samme: en
 * genvej paa en telefon skriver `Ny router #drift`, og maerket skal blive et
 * rigtigt maerke - praecis som naar man skriver det i titelfeltet. Der maa
 * ikke findes en saerlig API-vej ind i dataene (RUNE-ERFARINGER §9a), saa
 * reglen er flyttet hertil frem for kopieret.
 *
 * To ting er begge noedvendige, og begge er dyrt laert:
 *
 *  - **Markoeren skal staa ved linjestart eller efter et MELLEMRUM.** Ellers
 *    bliver `https://dr.dk/nyheder#sport` til et maerke (doda F1).
 *  - **Maerket skal klaebe direkte til tegnet** (`#drift`, ikke `# drift`).
 *    Saa er der intet at trimme - og det var netop dér, den gamle fejl kom
 *    fra: man trimmede vaerdien og maalte laengden paa den utrimmede.
 */

(function (root, fabrik) {
  if (typeof module === 'object' && module.exports) module.exports = fabrik();
  else root.saguMaerker = fabrik();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Ét maerkes tegn. Bogstav eller tal foerst, derefter ogsaa _ og -. */
  const ORD = '[\\p{L}\\p{N}][\\p{L}\\p{N}_-]{0,59}';

  /*
   * `#drift,net,backup` er TRE maerker.
   *
   * Kommaet skal klaebe til begge sider - `#drift,net`, aldrig `#drift, net`.
   * Med mellemrum efter kommaet er det en saetning: »husk #drift, og ring til
   * Bo« maa ikke give et maerke der hedder »og«. Det er samme slags regel som
   * markoerens egen (den skal staa ved linjestart eller efter et mellemrum) -
   * **et maerke klaeber til det, det hoerer til.**
   */
  const MOENSTER = new RegExp(`(^|\\s)#(${ORD}(?:,${ORD})*)`, 'gu');

  function pluk(raa) {
    const maerker = [];
    const tekst = String(raa || '')
      .replace(MOENSTER, (helt, foer, navne) => {
        for (const n of navne.split(',')) if (n) maerker.push(n);
        return foer;
      })
      .replace(/\s+/g, ' ')
      .trim();
    return { tekst, maerker };
  }

  /**
   * Det, en bruger taster i et maerke-FELT.
   *
   * Samme komma-regel, men uden `#`-markoeren: i et felt, der kun kan
   * indeholde maerker, er havelaagen stoej. Mellemrum om kommaerne er derimod
   * tilladt her - man er i et felt og ikke midt i en saetning, saa der er
   * ingen »og« at forveksle noget med.
   */
  function fraFelt(raa) {
    const ud = [];
    for (const del of String(raa || '').split(',')) {
      const n = del.trim().replace(/^#/, '').replace(/\s+/g, '-');
      if (!n) continue;
      if (!ud.some((x) => x.toLowerCase() === n.toLowerCase())) ud.push(n);
    }
    return ud;
  }

  return { pluk, fraFelt };
}));

/* ---- shared/markdown.js ---- */
/*
 * Sagu - markdown-renderer. ÉN renderer, tre koersteder.
 *
 * Browseren bruger den til den live-renderede visning (F1), serveren bruger
 * den til wikiens offentlige sider (F6, som er SERVER-renderet og ikke maa
 * hente app-koden), og MCP/API'et laener sig op ad den samme forstaaelse af,
 * hvad en note indeholder.
 *
 * Derfor er den UMD-pakket og kender hverken DOM, database eller http.
 * Flytningen laves FOERST, ikke naar F6 opdager, at den mangler
 * (RUNE-ERFARINGER §9a).
 *
 * ── Sikkerhedsmodellen, som er hele pointen ───────────────────────────────
 *
 * Sagu renderer FREMMED markdown paa et OFFENTLIGT domaene (risiko R4):
 * indhold fra en Notion-import, fra et API-kald, fra en MCP-klient, og senere
 * fra »foreslaa en rettelse« i wikien. Derfor:
 *
 *   1. **Teksten escapes FOERST, og der matches bagefter.** Naar `<`, `>`, `&`
 *      og `"` allerede er entiteter, kan hverken et tag eller en
 *      attribut-udbrydning opstaa af noget, brugeren skrev. Det er dodas
 *      gennemproevede greb, og det er grunden til, at der ikke er brug for en
 *      sanitizer bagefter.
 *   2. **Ingen raa HTML slipper igennem. Nogensinde.** Der er ingen
 *      »tillad-liste« af tags, for der er ingen vej ind: alt kommer fra vores
 *      egne skabeloner.
 *   3. **Kun http(s) i links.** `javascript:`, `data:` og `vbscript:` kan ikke
 *      blive til et href, fordi der matches paa protokollen og ikke paa
 *      fravaeret af noget farligt.
 *   4. **At escape mellem tags og at escape inde i en ATTRIBUT er to
 *      forskellige opgaver.** En escaper skrevet til tekst mellem to tags tager
 *      `&`, `<` og `>` - men ikke anfoerselstegn, for mellem tags er de
 *      harmloese. Inde i en attribut lukker de den. `attr()` findes derfor ved
 *      siden af `esc()`, og URL'er gaar ALTID gennem den.
 */

(function (root, fabrik) {
  if (typeof module === 'object' && module.exports) module.exports = fabrik();
  else root.saguMarkdown = fabrik();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Tekst mellem to tags. */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /**
   * Tekst inde i en attribut. Anfoerselstegn SKAL med her - de er harmloese
   * mellem tags og lukker attributten herinde. `![" onerror="alert(1)](x)` er
   * hele angrebet, og det er den forskel, der stopper det.
   */
  function attr(s) {
    return esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /**
   * En adresse, der er sikker at saette i et href.
   *
   * Der matches paa det, der ER tilladt, ikke paa det, der er farligt. En
   * sortliste kan altid omgaas (`java\tscript:`, `JaVaScRiPt:`, en NUL-byte);
   * en hvidliste paa `https?://` kan ikke.
   */
  function sikkerUrl(raa) {
    const s = String(raa || '').trim();
    return /^https?:\/\/[^\s<>"']+$/i.test(s) ? s : null;
  }

  /** Overskrift -> id, saa hver overskrift kan deep-linkes (krav 8, F6). */
  function slug(tekst) {
    const s = String(tekst || '').toLowerCase()
      .replace(/[æ]/g, 'ae').replace(/[ø]/g, 'oe').replace(/[å]/g, 'aa')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '');
    return s || 'afsnit';
  }

  /* ------------------------------------------------------------- inline */

  /**
   * Inline-formatering paa ÉN linje.
   *
   * `kode` tages ud foerst og lægges tilbage til sidst: indholdet af en
   * kodestump maa ikke formateres videre, ellers bliver `**ikke fed**` fed
   * inde i en kodestump, og det er ikke hvad nogen skrev.
   */
  function inline(raa, opt) {
    const o = opt || {};
    /*
     * `noFoelg` er til FREMMED indhold (kommentarer paa en offentlig side).
     *
     * `ugc` og `nofollow` siger til soegemaskiner, at linket er skrevet af en
     * besoegende og ikke af den, der ejer siden - saa en kommentar kan ikke
     * bruges til at give en fremmed adresse vaegt. Attributterne staar ÉT
     * sted, saa de to link-grene nedenfor ikke kan komme til at sige hver
     * sit.
     */
    const eksternRel = o.noFoelg ? 'noopener noreferrer nofollow ugc' : 'noopener noreferrer';
    const gemt = [];
    // NUL bruges som pladsholder for kodestumper nedenfor. Kommer der et
    // NUL med i brugerens egen tekst (JSON kan skrive \u0000), ville det
    // kunne ligne en pladsholder - saa det ryger ud foerst.
    // Escapes FOERST. Alt herefter arbejder paa ufarlig tekst.
    let s = esc(String(raa == null ? '' : raa).replace(/\x00/g, ''));

    // 1. kodestumper ud
    s = s.replace(/`([^`\n]+)`/g, (_, k) => {
      gemt.push(`<code>${k}</code>`);
      return `\x00${gemt.length - 1}\x00`;
    });

    // 2. [[note-titel]] - wiki-link. Maalet slaas op af vaerten; her bliver
    //    det til et link med titlen i et data-attribut, saa baade appen og
    //    den server-renderede wiki kan afgoere, hvor det peger hen.
    s = s.replace(/\[\[([^\]\n]{1,200})\]\]/g, (_, navn) => {
      const rent = navn.trim();
      const kendt = o.slaaOpNote ? o.slaaOpNote(rent) : null;
      if (kendt) return `<a class="notelink" href="${attr(kendt.href)}">${rent}</a>`;
      // En doed henvisning skal SES som doed, ikke forsvinde. Det er en
      // kendsgerning om noten, ikke en fejl (Verdandes spec, og den er rigtig).
      return `<span class="notelink dead" title="No note with that title yet">${rent}</span>`;
    });

    // 3. ![alt](adresse) - FOER links, ellers spiser link-reglen udraabstegnet.
    //
    //    Her er `attr()` ikke valgfri: alt-teksten havner i en ATTRIBUT, og
    //    en escaper skrevet til tekst mellem tags tager ikke anfoerselstegn.
    //    `![" onerror="alert(1)](x.png)` er hele angrebet.
    s = s.replace(/!\[([^\]\n]{0,200})\]\(([^)\s]{1,2000})\)/g, (helt, alt, url) => {
      const sikker = o.billedUrl ? o.billedUrl(url) : sikkerUrl(url);
      if (sikker) {
        return `<img src="${attr(sikker)}" alt="${attr(alt)}" loading="lazy" class="note-img">`;
      }
      /*
       * Vaerten ville ikke vise billedet - men adressen kan stadig vaere en
       * gyldig http(s)-adresse, som CSP'en bare naegter at hente.
       *
       * Sagus CSP er `img-src 'self' data: blob:`, og det er MED VILJE: en
       * note maa ikke kunne faa browseren til at hente fra en fremmed vaert.
       * Paa den offentlige wiki (F6) ville det lade en forfatter spore sine
       * laesere. Men et oedelagt billedikon forklarer ingenting - saa
       * adressen bliver et LINK, der siger hvad der skete. Indholdet gaar
       * ikke tabt, og aarsagen er synlig.
       */
      const udefra = sikkerUrl(url);
      if (udefra) {
        return `<a href="${attr(udefra)}" class="ekstern-billede" target="_blank"
          rel="noopener noreferrer" title="External images are not loaded">${alt || attr(udefra)}</a>`;
      }
      return helt;
    });

    // 4. [tekst](adresse)
    s = s.replace(/\[([^\]\n]{0,200})\]\(([^)\s]{1,2000})\)/g, (helt, tekst, url) => {
      // `linkUrl` er vaertens krog - praecis som `billedUrl`. Uden den kunne
      // en vedhaeftning, der ikke er et billede, ikke haentes: `sagu:<id>` er
      // ikke http(s), saa sikkerUrl afviser den med rette, og linket blev til
      // doed TEKST. Det var en rigtig fejl i F3, og den er derfor en KROG og
      // ikke en undtagelse i sikkerUrl: rendereren maa stadig ikke selv kende
      // Sagus adresser.
      const oversat = o.linkUrl ? o.linkUrl(url) : null;
      /*
       * `false` betyder noget ANDET end `null`.
       *
       * `null` = »ikke min adresse«, og saa proever `sikkerUrl` bagefter.
       * `false` = »det ER min adresse, men den kan ikke naas herfra« - fx et
       * link til en note, der ikke er med i den offentlige udgivelse. Saa skal
       * TEKSTEN staa, ikke den raa markdown med et id i: en doed henvisning
       * skal LAESES som doed frem for at forsvinde - og et id, laeseren ikke
       * maa naa, skal slet ikke staa der.
       */
      if (oversat === false) {
        return `<span class="notelink dead" title="This page is not part of this site">${
          tekst || 'note'}</span>`;
      }
      const sikker = oversat || sikkerUrl(url);
      // Alt andet staar som den tekst, der blev skrevet - saa forsvinder
      // indholdet ikke, og der opstaar intet href.
      if (!sikker) return helt;
      // `#` er lige saa intern som `/`: appen aabner `#note-<id>` selv.
      const intern = oversat && (oversat[0] === '/' || oversat[0] === '#');
      return `<a href="${attr(sikker)}"${intern ? ' class="vedhaeft"'
        : ` target="_blank" rel="${eksternRel}"`}>${tekst || attr(sikker)}</a>`;
    });

    // 5. naegen adresse
    s = s.replace(/(^|[\s(])((?:https?:\/\/)[^\s<]{1,2000})/g, (helt, foer, url) => {
      // Slutpunktum og lukkeparentes hoerer til saetningen, ikke til adressen.
      const hale = url.match(/[.,;:!?)]+$/);
      const ren = hale ? url.slice(0, -hale[0].length) : url;
      const sikker = sikkerUrl(ren);
      if (!sikker) return helt;
      const vis = sikker.replace(/^https?:\/\//, '');
      return `${foer}<a href="${attr(sikker)}" target="_blank" rel="${eksternRel}">${vis}</a>${hale ? hale[0] : ''}`;
    });

    // 6. eftertryk. ** foer *, ellers spiser den enkelte stjerne den dobbelte.
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^_\w])_([^_\n]+)_(?![_\w])/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

    // 7. kodestumperne tilbage
    return s.replace(/\x00(\d+)\x00/g, (_, i) => gemt[Number(i)]);
  }

  /* -------------------------------------------------------------- blokke */

  const ER_FENCE = /^\s{0,3}(?:```|~~~)\s*([\w+-]{0,20})\s*$/;
  const ER_OVERSKRIFT = /^\s{0,3}(#{1,6})\s+(.*)$/;
  const ER_HR = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
  const ER_CITAT = /^\s{0,3}>\s?(.*)$/;
  const ER_PUNKT = /^(\s*)([-*+])\s+(.*)$/;
  const ER_NUMMER = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
  // `- [ ]` og `- [x]`. Skal proeves FOER ER_PUNKT, ellers bliver
  // afkrydsningsfeltet bare til tekst i et almindeligt punkt.
  const ER_TJEK = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/;
  // GitHub-stilens callout. Notion har farvede bokse; det her er den
  // markdown-native skrivemaade, og den overlever en rundtur ud og ind.
  const ER_CALLOUT = /^\s{0,3}>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i;
  // En tabelrække: mindst ét indre roer. Skillelinjen er |---|---|.
  const ER_TABEL = /^\s{0,3}\|(.+)\|\s*$/;
  const ER_TABELSKEL = /^\s{0,3}\|[\s:|-]+\|\s*$/;

  /**
   * Deler teksten i blokke. Hver blok kender sin RAA kilde og sine linjenumre.
   *
   * Linjenumrene er ikke pynt: den hybride editor skal kunne aabne PRAECIS det
   * afsnit, man klikkede i, som raa markdown - og saa skrive det tilbage paa
   * samme plads uden at roere resten af noten.
   */
  function blokke(md) {
    const linjer = String(md == null ? '' : md).replace(/\r\n?/g, '\n').split('\n');
    const ud = [];
    let i = 0;

    while (i < linjer.length) {
      const linje = linjer[i];

      if (!linje.trim()) { i++; continue; }

      const fence = linje.match(ER_FENCE);
      if (fence) {
        const start = i;
        const sprog = fence[1] || '';
        const krop = [];
        i++;
        while (i < linjer.length && !ER_FENCE.test(linjer[i])) { krop.push(linjer[i]); i++; }
        // En uafsluttet fence er ikke en fejl - noten er bare midt i at blive
        // skrevet. Den loeber til slutningen frem for at vaelte optegningen.
        if (i < linjer.length) i++;
        ud.push({ slags: 'kode', sprog, tekst: krop.join('\n'), fra: start, til: i - 1 });
        continue;
      }

      const h = linje.match(ER_OVERSKRIFT);
      if (h) {
        ud.push({ slags: 'overskrift', niveau: h[1].length, tekst: h[2].trim(), fra: i, til: i });
        i++;
        continue;
      }

      if (ER_HR.test(linje)) { ud.push({ slags: 'hr', fra: i, til: i }); i++; continue; }

      // Tabel: en raekke efterfulgt af en skillelinje. Uden skillelinjen er
      // det bare tekst med roer i - og det skal det blive ved med at vaere.
      if (ER_TABEL.test(linje) && i + 1 < linjer.length && ER_TABELSKEL.test(linjer[i + 1])) {
        const start = i;
        const celler = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        const hoved = celler(linje);
        const just = celler(linjer[i + 1]).map((c) => {
          if (/^:.*:$/.test(c)) return 'center';
          if (/:$/.test(c)) return 'right';
          return 'left';
        });
        i += 2;
        const raekker = [];
        while (i < linjer.length && ER_TABEL.test(linjer[i])) { raekker.push(celler(linjer[i])); i++; }
        ud.push({ slags: 'tabel', hoved, just, raekker, fra: start, til: i - 1 });
        continue;
      }

      const callout = linje.match(ER_CALLOUT);
      if (callout) {
        const start = i;
        const krop = callout[2] ? [callout[2]] : [];
        i++;
        while (i < linjer.length && ER_CITAT.test(linjer[i]) && !ER_CALLOUT.test(linjer[i])) {
          krop.push(linjer[i].match(ER_CITAT)[1]);
          i++;
        }
        ud.push({ slags: 'callout', art: callout[1].toUpperCase(), tekst: krop.join('\n'), fra: start, til: i - 1 });
        continue;
      }

      if (ER_CITAT.test(linje)) {
        const start = i;
        const krop = [];
        while (i < linjer.length && ER_CITAT.test(linjer[i])) {
          krop.push(linjer[i].match(ER_CITAT)[1]);
          i++;
        }
        ud.push({ slags: 'citat', tekst: krop.join('\n'), fra: start, til: i - 1 });
        continue;
      }

      // Tjekliste: en egen blok, saa afkrydsningsfelterne kan KLIKKES og
      // skrives tilbage i markdown'en uden at aabne blokken raat.
      if (ER_TJEK.test(linje)) {
        const start = i;
        const punkter = [];
        while (i < linjer.length && ER_TJEK.test(linjer[i])) {
          const m = linjer[i].match(ER_TJEK);
          punkter.push({
            dybde: Math.min(Math.floor(m[1].replace(/\t/g, '  ').length / 2), 6),
            tjekket: m[2].toLowerCase() === 'x',
            tekst: m[3],
            linje: i,
          });
          i++;
        }
        ud.push({ slags: 'tjekliste', punkter, fra: start, til: i - 1 });
        continue;
      }

      if (ER_PUNKT.test(linje) || ER_NUMMER.test(linje)) {
        const start = i;
        const punkter = [];
        while (i < linjer.length) {
          if (ER_TJEK.test(linjer[i])) break;      // en tjekliste er sin egen blok
          const p = linjer[i].match(ER_PUNKT);
          const n = linjer[i].match(ER_NUMMER);
          if (!p && !n) break;
          const m = p || n;
          punkter.push({
            // Indrykning i TRIN af to mellemrum; en tabulator taeller som et
            // trin. Uden loftet kan en dybt indrykket linje lave hundredvis
            // af indlejrede lister.
            dybde: Math.min(Math.floor(m[1].replace(/\t/g, '  ').length / 2), 6),
            nummer: !!n,
            tekst: m[3],
          });
          i++;
        }
        ud.push({ slags: 'liste', punkter, fra: start, til: i - 1 });
        continue;
      }

      // Afsnit: loeber til naeste tomme linje eller naeste blok-begyndelse.
      const start = i;
      const krop = [];
      while (i < linjer.length && linjer[i].trim()
        && !ER_FENCE.test(linjer[i]) && !ER_OVERSKRIFT.test(linjer[i])
        && !ER_HR.test(linjer[i]) && !ER_CITAT.test(linjer[i])
        && !ER_PUNKT.test(linjer[i]) && !ER_NUMMER.test(linjer[i])
        && !ER_TJEK.test(linjer[i])
        && !(ER_TABEL.test(linjer[i]) && i + 1 < linjer.length && ER_TABELSKEL.test(linjer[i + 1]))) {
        krop.push(linjer[i]);
        i++;
      }
      ud.push({ slags: 'afsnit', tekst: krop.join('\n'), fra: start, til: i - 1 });
    }
    return ud;
  }

  /** Lister er flade i `blokke`; her foldes de til den dybde, de blev skrevet i. */
  function listeHtml(punkter, opt) {
    let ud = '';
    const stak = [];
    for (const p of punkter) {
      while (stak.length > p.dybde + 1) ud += `</li></${stak.pop()}>`;
      if (stak.length === p.dybde + 1) ud += '</li>';
      while (stak.length < p.dybde + 1) {
        const tag = p.nummer ? 'ol' : 'ul';
        ud += `<${tag}>`;
        stak.push(tag);
      }
      ud += `<li>${inline(p.tekst, opt)}`;
    }
    while (stak.length) ud += `</li></${stak.pop()}>`;
    return ud;
  }

  /**
   * Renderer en note.
   *
   * @param {string} md
   * @param {object} [opt]
   *   `slaaOpNote(titel)` -> {href} | null, saa [[link]] kan blive levende.
   *   `blokAttribut` -> saet data-blok="<fra>" paa hver blok, saa den hybride
   *   editor ved, hvilket afsnit der blev klikket i.
   * @returns {{html: string, overskrifter: Array<{niveau, tekst, id}>}}
   */
  /*
   * »Hele afsnittet er ÉN adresse.«
   *
   * Bevidst snaever: `https://` og ingen mellemrum. En linje med tekst
   * omkring adressen er en saetning, ikke en indlejring - og et afsnit paa
   * to linjer, hvor den ene er en adresse, er heller ikke.
   */
  const ER_BAR_URL = /^https:\/\/[^\s<>"']+$/;

  function render(md, opt) {
    const o = opt || {};
    const stykker = blokke(md);
    const overskrifter = [];
    const brugteId = new Set();
    let html = '';

    for (const b of stykker) {
      const mrk = o.blokAttribut ? ` data-blok="${b.fra}" data-til="${b.til}"` : '';
      if (b.slags === 'overskrift') {
        // Id'er skal vaere UNIKKE - to afsnit kan hedde det samme, og et
        // deep-link skal pege ét sted hen.
        let id = slug(b.tekst);
        let n = 2;
        while (brugteId.has(id)) { id = `${slug(b.tekst)}-${n}`; n++; }
        brugteId.add(id);
        overskrifter.push({ niveau: b.niveau, tekst: b.tekst, id });
        html += `<h${b.niveau} id="${attr(id)}"${mrk}>${inline(b.tekst, o)}</h${b.niveau}>`;
      } else if (b.slags === 'kode') {
        // Sproget staar som en KLASSE, ikke som tekst i blokken - F3 haenger
        // sprogmaerket og kopier-knappen paa den, uden at roere indholdet.
        const klasse = b.sprog ? ` class="language-${attr(b.sprog)}"` : '';
        html += `<pre${mrk}><code${klasse}>${esc(b.tekst)}</code></pre>`;
      } else if (b.slags === 'hr') {
        html += `<hr${mrk}>`;
      } else if (b.slags === 'citat') {
        html += `<blockquote${mrk}>${afsnitHtml(b.tekst, o)}</blockquote>`;
      } else if (b.slags === 'liste') {
        html += `<div class="liste"${mrk}>${listeHtml(b.punkter, o)}</div>`;
      } else if (b.slags === 'tjekliste') {
        // Afkrydsningsfelterne kan KLIKKES: `data-tjek` er linjenummeret i
        // kilden, saa et klik kan skrive `[ ]` om til `[x]` uden at aabne
        // blokken raat. Feltet er `disabled` og styres af en handler paa
        // raekken - et rigtigt checkbox ville sende en formular ingen steder.
        html += `<div class="tjekliste"${mrk}>${b.punkter.map((p) => `
          <div class="tjek${p.tjekket ? ' er-tjekket' : ''}" style="margin-left:${p.dybde * 22}px">
            <button class="tjek-boks" data-tjek="${p.linje}" role="checkbox"
              aria-checked="${p.tjekket ? 'true' : 'false'}">${p.tjekket ? '✓' : ''}</button>
            <span class="tjek-tekst">${inline(p.tekst, o)}</span>
          </div>`).join('')}</div>`;
      } else if (b.slags === 'callout') {
        const navne = { NOTE: 'Note', TIP: 'Tip', IMPORTANT: 'Important',
          WARNING: 'Warning', CAUTION: 'Caution' };
        const tegn = { NOTE: 'ℹ', TIP: '✦', IMPORTANT: '❗', WARNING: '⚠', CAUTION: '⛔' };
        html += `<div class="callout ${attr(b.art.toLowerCase())}"${mrk}>
            <div class="callout-hoved"><span class="callout-tegn">${tegn[b.art] || 'ℹ'}</span>
              ${esc(navne[b.art] || b.art)}</div>
            <div class="callout-krop">${afsnitHtml(b.tekst, o)}</div>
          </div>`;
      } else if (b.slags === 'tabel') {
        // Wrapperen er ikke pynt: en bred tabel skal rulle i sin EGEN ramme
        // frem for at skubbe siden (RUNE-ERFARINGER, Tilmeld + tovo v13).
        const celle = (c, i, tag) => {
          const j = b.just[i] || 'left';
          return `<${tag}${j === 'left' ? '' : ` class="${j}"`}>${inline(c, o)}</${tag}>`;
        };
        html += `<div class="tabelwrap"${mrk}><table class="md-tabel">
            <thead><tr>${b.hoved.map((c, i) => celle(c, i, 'th')).join('')}</tr></thead>
            <tbody>${b.raekker.map((r) => `<tr>${r.map((c, i) => celle(c, i, 'td')).join('')}</tr>`).join('')}</tbody>
          </table></div>`;
      } else if (b.slags === 'afsnit' && o.bartLink && ER_BAR_URL.test(b.tekst.trim())) {
        /*
         * Et afsnit, der ER én bar adresse, kan blive til noget andet.
         *
         * Krogen hedder `bartLink` og ikke `github`, fordi **rendereren maa
         * ikke kende domaenet**. Den ved kun, at linjen er én adresse og
         * intet andet - hvad den saa skal blive til, bestemmer vaerten
         * (F12: en kode-indlejring eller en sags-chip). Samme snit som
         * `linkUrl` og `billedUrl`.
         *
         * Svarer krogen null, er det et helt almindeligt afsnit. En
         * indlejring, der ikke kan vises, skal falde tilbage til det link,
         * der stod der - ikke til ingenting.
         */
        const saerlig = o.bartLink(b.tekst.trim(), b);
        html += saerlig || `<p${mrk}>${afsnitHtml(b.tekst, o)}</p>`;
      } else {
        html += `<p${mrk}>${afsnitHtml(b.tekst, o)}</p>`;
      }
    }
    return { html, overskrifter };
  }

  /**
   * Et afsnits linjer.
   *
   * **Hver linje bliver praecis én linje.** Almindelig markdown slaar
   * fortloebende linjer sammen til ét afsnit; det maa den ikke her. Personen
   * skrev en linje og forventer at faa den tilbage, og en editor, der
   * stiltiende ombryder det, nogen har skrevet, er en editor man holder op med
   * at stole paa (Verdandes spec).
   */
  function afsnitHtml(tekst, opt) {
    return String(tekst).split('\n').map((l) => inline(l, opt)).join('<br>');
  }

  /** Ren tekst - til soegeuddrag, iCal-beskrivelser og AI-kontekst. */
  /**
   * Notens rene tekst - til uddrag, `<meta description>` og soegning.
   *
   * ADRESSEN skal ud, ikke bare markoererne. En naiv strip af `[ ] ( )` lod
   * `[Se her](sagu-note:7ffd…)` blive til »Se her(sagu-note:7ffd…)«: baade
   * ulaeseligt og - paa en offentlig side - et id paa en note, der ikke er
   * udgivet. Linkets TEKST er det, der betyder noget; adressen er maskineri.
   */
  function tilTekst(md) {
    return blokke(md).map((b) => {
      if (b.slags === 'liste' || b.slags === 'tjekliste') return b.punkter.map((p) => p.tekst).join('\n');
      if (b.slags === 'tabel') {
        return b.hoved.join(' ') + '\n' + b.raekker.map((r) => r.join(' ')).join('\n');
      }
      if (b.slags === 'hr') return '';
      return b.tekst || '';
    }).join('\n')
      // Billeder forsvinder helt (alt-teksten er ikke prosa); links beholder
      // deres tekst og mister deres adresse.
      .replace(/!\[[^\]\n]*\]\([^)\s]{1,2000}\)/g, '')
      .replace(/\[([^\]\n]{0,200})\]\([^)\s]{1,2000}\)/g, '$1')
      .replace(/[*_`~#>\[\]|]/g, '')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /** Notens titel, hvis man vil udlede den. Sagu har sin egen kolonne. */
  function foersteOverskrift(md) {
    const b = blokke(md);
    for (const x of b) {
      if (x.slags === 'overskrift') return x.tekst;
      if (x.slags === 'afsnit') return x.tekst.split('\n')[0].slice(0, 200);
    }
    return '';
  }

  /** De titler, noten henviser til med [[...]] - bagsiden er backlinks (F3). */
  function wikiLinks(md) {
    const ud = [];
    const re = /\[\[([^\]\n]{1,200})\]\]/g;
    let m;
    while ((m = re.exec(String(md || '')))) {
      const t = m[1].trim();
      if (t && !ud.includes(t)) ud.push(t);
    }
    return ud;
  }

  /**
   * Saetter et afkrydsningsfelt i markdown-kilden.
   *
   * Tager LINJENUMMERET frem for at soege efter teksten: to punkter kan hedde
   * det samme, og en tekstsoegning ville tikke det forkerte af.
   */
  function saetTjek(md, linjeNr, tjekket) {
    const linjer = String(md || '').split('\n');
    const l = linjer[linjeNr];
    if (l === undefined) return md;
    const m = l.match(ER_TJEK);
    if (!m) return md;
    linjer[linjeNr] = l.replace(/\[[ xX]\]/, tjekket ? '[x]' : '[ ]');
    return linjer.join('\n');
  }

  /**
   * Flytter en blok hen foran en anden. Ren tekst ind, ren tekst ud.
   *
   * Den bor HER og ikke i editoren af samme grund som `saetTjek`: det er en
   * operation paa markdown, og markdown er sandheden. Saa kan den proeves
   * uden en browser - og traek-og-slip i fladen bliver et spoergsmaal om
   * hvilke to tal, den skal kaldes med.
   *
   * **Linjerne SPLEJSES, de sammensaettes ikke.** Et alternativ var at dele
   * teksten op i blokke og saette dem sammen igen med tomme linjer imellem -
   * men saa ville to tomme linjer blive til én, og en overskydende
   * indrykning forsvinde. En editor, der stiltiende skriver om paa det, nogen
   * har skrevet, er en editor man holder op med at stole paa (Verdandes spec).
   *
   * @param {number} fra  blokkens nummer i `blokke()`
   * @param {number} til  nummeret paa den blok, den skal ligge FORAN.
   *                      `blokke().length` betyder »nederst«.
   */
  function flytBlok(md, fra, til) {
    const tekst = String(md == null ? '' : md);
    const b = blokke(tekst);
    if (!b[fra] || fra === til || til < 0 || til > b.length) return tekst;
    // At flytte en blok hen foran sig selv er ingen flytning.
    if (til === fra + 1) return tekst;

    const linjer = tekst.split('\n');
    const kilde = b[fra];
    const stykke = linjer.slice(kilde.fra, kilde.til + 1);

    /*
     * **Separatoren foelger med blokken.**
     *
     * Fjerner man kun selve blokkens linjer, bliver den tomme linje, der
     * skilte den fra den naeste, tilbage - og saa hober tomme linjer sig op
     * ét sted, mens der mangler én et andet. Det saa man foerst efter tre-fire
     * flytninger, hvor noten stille blev luftigere.
     *
     * Den tomme linje EFTER blokken hoerer til den; er der ingen (blokken er
     * den sidste), tages den foran i stedet.
     */
    let start = kilde.fra;
    let antal = kilde.til - kilde.fra + 1;
    if (kilde.til + 1 < linjer.length && !String(linjer[kilde.til + 1]).trim()) {
      antal += 1;                                   // den tomme linje efter
    } else if (kilde.fra > 0 && !String(linjer[kilde.fra - 1]).trim()) {
      start -= 1;                                   // ... ellers den foran
      antal += 1;
    }

    // Indsaettelsespunktet regnes i den OPRINDELIGE nummerering og rettes
    // bagefter for de linjer, der forsvandt. Regner man det efter fjernelsen,
    // peger tallene paa noget andet, end man valgte.
    let indsaet = til >= b.length ? linjer.length : b[til].fra;
    linjer.splice(start, antal);
    if (indsaet > start) indsaet -= antal;
    if (indsaet > linjer.length) indsaet = linjer.length;

    // ... og saettes ind igen MED sin separator, saa to blokke ikke smelter
    // sammen til én.
    const med = stykke.slice();
    if (indsaet >= linjer.length) {
      /*
       * Nederst betyder »efter sidste blok« - ikke »efter sidste LINJE«.
       *
       * En markdownfil slutter paa et linjeskift, og `split('\n')` goer det
       * til en tom linje til sidst. Satte man blokken efter DEN, forsvandt
       * filens afsluttende linjeskift ved hver tur nederst - saa en blok,
       * der blev trukket ned og op igen, kom tilbage med en tekst, der ikke
       * var helt den samme (maalt i browseren, 2026-08-21).
       *
       * Vi gaar derfor tilbage forbi de tomme linjer og saetter blokken ind
       * DÉR. Halen faar lov at blive, hvor den er.
       */
      while (indsaet > 0 && !String(linjer[indsaet - 1]).trim()) indsaet -= 1;
      if (indsaet > 0) med.unshift('');   // en tom linje foran, hvis der staar noget over
    } else {
      med.push('');
    }
    linjer.splice(indsaet, 0, ...med);
    return linjer.join('\n');
  }

  /**
   * Et brugernavn, som det skal SES.
   *
   * Kun det foerste tegn, og resten roeres ikke: »andreasD« bliver
   * »AndreasD«, ikke »Andreasd«. Det er et navn, ikke en saetning.
   *
   * **Kun til visning.** Den gemte vaerdi og alt, der SAMMENLIGNES eller
   * sendes til serveren, skal blive ved med at vaere det, brugeren tastede -
   * ellers holder login op med at virke, og en deling til »Bo« finder ikke
   * kontoen »bo«.
   *
   * `Array.from` frem for `[0]`: et navn kan begynde med et tegn, der fylder
   * to kodeenheder, og saa ville en indeksering skaere det midt over.
   */
  function pentBrugernavn(navn) {
    const s = String(navn == null ? '' : navn);
    if (!s) return '';
    const tegn = Array.from(s);
    return tegn[0].toUpperCase() + tegn.slice(1).join('');
  }

  /**
   * En kendt vaert faar et paent navn, naar en adresse bliver til et link.
   *
   * »github.com/andreasdinesen/sagu« er bedre end den raa adresse i en
   * saetning, og det er ét opslag frem for en integration.
   */
  function pentNavn(url) {
    const m = String(url || '').match(/^https?:\/\/([^/]+)(\/.*)?$/i);
    if (!m) return url;
    const vaert = m[1].replace(/^www\./, '');
    const sti = (m[2] || '').replace(/\/$/, '');
    const KENDTE = {
      'github.com': (p) => `GitHub: ${p.split('/').slice(1, 3).join('/')}`,
      'notion.so': () => 'Notion page',
      'dr.dk': () => 'dr.dk',
      'stackoverflow.com': () => 'Stack Overflow',
      'developer.mozilla.org': () => 'MDN',
    };
    if (KENDTE[vaert]) { try { return KENDTE[vaert](sti); } catch { return vaert; } }
    // Hvert Notion-arbejdsrum har sit EGET vaertsnavn. En liste over kendte
    // vaerter kan derfor kun daekke dem, nogen har skrevet ned - og et
    // personligt arbejdsrum hoerer ikke hjemme i en app, andre installerer.
    // Endelsen er reglen (RUNE-ERFARINGER, tools v1: skriv kuren som en REGEL,
    // ikke som en liste).
    if (/(^|\.)notion\.site$/.test(vaert)) return 'Notion page';
    return sti ? `${vaert}${sti.length > 40 ? `${sti.slice(0, 37)}…` : sti}` : vaert;
  }

  /**
   * En blok som ÉN linje, uden markdown'ens markoerer.
   *
   * Bruges, naar en blok skal vaere noget ANDET end markdown - en opgave i
   * doda, for eksempel. En opgave er en titel, ikke et stykke kildekode: uden
   * strimlingen ville den hedde »- [ ] ring til Bo«.
   *
   * Den bor her sammen med `flytBlok` og `saetTjek` af samme grund - det er
   * en ren tekstoperation paa markdown, og saa kan den proeves uden browser.
   *
   * Kun linjens FOERSTE markoer ryger. `- - a` er en liste med et
   * bindestregs-punkt, og punktet er en del af teksten.
   *
   * @param {number} fra blokkens foerste linje (`blokke()[i].fra`)
   */
  function blokSomLinje(md, fra) {
    const tekst = String(md == null ? '' : md);
    const b = blokke(tekst).find((x) => x.fra === fra);
    if (!b) return '';
    return tekst.split('\n').slice(b.fra, b.til + 1)
      .map((l) => String(l)
        .replace(/^\s*#{1,6}\s+/, '')                              // overskrift
        .replace(/^\s*>\s?/, '')                                   // citat
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?/, '')   // punkt, evt. med tjekboks
        .replace(/^\s*```.*$/, ''))                                // kodehegn
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /*
   * ── Det, hjaelpen har lov at love ─────────────────────────────────────
   *
   * Listen bor HER, ved siden af de regexp'er, den beskriver - ikke i
   * fladen. »En hjaelpetekst er en kravspecifikation« staar fem gange i
   * loggen nu (doda v9/v35/v38, Sagu F9), og kuren er hver gang den samme:
   * ikke mere omhu, men ÉT sted.
   *
   * Hver `kode` herunder er en levende proeve: `tests/markdown.test.mjs`
   * render'er dem alle og faelder, hvis én af dem kommer ud som almindelig
   * tekst. Holder rendereren op med at kunne tabeller, kan hjaelpen ikke
   * blive ved med at sige, at den kan.
   *
   * `vis` er kun til, naar eksemplet fylder for meget i en snaever rude.
   */
  const SYNTAKS = [
    { navn: 'Heading', kode: '## A heading' },
    { navn: 'Bold', kode: '**bold**' },
    { navn: 'Italic', kode: '*italic*' },
    { navn: 'Strikethrough', kode: '~~struck out~~' },
    { navn: 'Code', kode: '`inline code`' },
    { navn: 'Code block', kode: '```js\nconst a = 1;\n```' },
    { navn: 'Bullets', kode: '- one\n- two' },
    { navn: 'Numbered', kode: '1. first\n2. second' },
    { navn: 'Checklist', kode: '- [ ] to do\n- [x] done' },
    { navn: 'Quote', kode: '> someone said this' },
    { navn: 'Callout', kode: '> [!WARNING]\n> Read this twice.' },
    { navn: 'Table', kode: '| Name | Port |\n| --- | --- |\n| web | 443 |' },
    { navn: 'Divider', kode: '---' },
    { navn: 'Link', kode: '[the docs](https://example.com)' },
    { navn: 'Image', kode: '![a caption](https://example.com/a.png)' },
    { navn: 'Another note', kode: '[[Title of the note]]' },
  ];

  /**
   * Fjerner én blok. Ren tekst ind, ren tekst ud.
   *
   * ── Separatoren foelger med, praecis som i `flytBlok` ─────────────────
   *
   * Fjernede man kun blokkens egne linjer, blev den tomme linje, der skilte
   * den fra den naeste, staaende - og saa hober tomme linjer sig op ét sted.
   * Reglen er den samme: den tomme linje EFTER blokken hoerer til den; er der
   * ingen (blokken er den sidste), tages den foran i stedet.
   *
   * Der splejses, der sammensaettes ikke. En sletning maa ikke skrive om paa
   * de blokke, der bliver staaende - en editor, der stiltiende retter i det,
   * nogen har skrevet, er en editor man holder op med at stole paa.
   *
   * @param {number} fra blokkens foerste linje (`blokke()[i].fra`)
   */
  function sletBlok(md, fra) {
    const tekst = String(md == null ? '' : md);
    const b = blokke(tekst).find((x) => x.fra === fra);
    if (!b) return tekst;

    const linjer = tekst.split('\n');
    let start = b.fra;
    let antal = b.til - b.fra + 1;
    if (b.til + 1 < linjer.length && !String(linjer[b.til + 1]).trim()) {
      antal += 1;                                   // den tomme linje efter
    } else if (b.fra > 0 && !String(linjer[b.fra - 1]).trim()) {
      start -= 1;                                   // ... ellers den foran
      antal += 1;
    }
    linjer.splice(start, antal);
    return linjer.join('\n');
  }

  /**
   * De billeder, noten faktisk viser.
   *
   * Bruges naar en note skal kopieres UD af Sagu: hver `sagu:`-adresse skal
   * skiftes ud med billedet selv, for udenfor Sagu betyder adressen intet.
   *
   * Kodeblokke springes over. Skriver man et eksempel paa billedsyntaksen i
   * en \`\`\`-blok, er det tekst, ikke et billede - byttede vi det ud, ville
   * eksemplet blive oedelagt af en flere megabyte lang data:-adresse.
   * Bagslag: billedsyntaks i kort kode midt i en linje slipper igennem. Det
   * kraever hele inline-tolkningen at fange, og en fuld 32-tegns adresse
   * skrevet som eksempel midt i en saetning findes ikke i praksis.
   */
  function billederIMarkdown(md) {
    const tekst = String(md == null ? '' : md);
    const kode = new Set();
    for (const b of blokke(tekst)) {
      if (b.slags !== 'kode') continue;
      for (let i = b.fra; i <= b.til; i += 1) kode.add(i);
    }
    const fundne = [];
    tekst.split('\n').forEach((linje, nr) => {
      if (kode.has(nr)) return;
      for (const m of linje.matchAll(/!\[([^\]\n]*)\]\((sagu:[a-f0-9]{32})\)/g)) {
        fundne.push({ helt: m[0], alt: m[1], sagu: m[2] });
      }
    });
    return fundne;
  }

  return { render, blokke, inline, tilTekst, foersteOverskrift, wikiLinks,
    slug, esc, attr, sikkerUrl, saetTjek, flytBlok, sletBlok, blokSomLinje,
    billederIMarkdown, pentNavn, pentBrugernavn, SYNTAKS };
}));

/* ---- shared/notion.js ---- */
/*
 * Sagu - Notions eksportformat.
 *
 * Alt her er REN databehandling: filnavne ind, struktur ud. Ingen zip, ingen
 * database, ingen http. Det er med vilje - risikoen i en import ligger i
 * tolkningen (hvilken fil hoerer til hvilken side, hvad er en database, hvor
 * peger et link hen), ikke i at pakke arkivet ud. Ligger tolkningen i et
 * modul, kan hele risikoen testes uden en browser og uden en rigtig zip
 * (RUNE-ERFARINGER, tovo F5).
 *
 * ── Formatet, som det FAKTISK ser ud ─────────────────────────────────────
 *
 * Maalt paa Andreas' eksport (234 MB, 558 filer, 278 sider, 31 CSV'er):
 *
 *   Side.md               "Titel <32 hex>.md"
 *   Undersider OG filer   en mappe "Titel" UDEN hex, AFKORTET til ~48 tegn
 *                         (maalt: 0 af 97 mapper har et hex i navnet)
 *   Database              "Navn <hex>.csv"  +  "Navn <hex>_all.csv"  +  mappe
 *   Interne links         URL-kodede RELATIVE stier: Foo%20Bar%20<hex>.md
 *
 * Fem ting, der maa gaa galt, hvis man ikke ved det paa forhaand:
 *
 *  1. **`_all.csv` er den autoritative.** Den blotte CSV er den AKTUELLE
 *     VISNING - filtreret og sorteret, og med faerre kolonner. Maalt paa
 *     »Must-read«: visningen har 5 kolonner, `_all` har 9. Laeser man
 *     visningen, taber man egenskaber uden at opdage det.
 *  2. **Titler er IKKE unikke.** 12 dubletter i eksporten, én titel 6 gange.
 *     Hex-id'et er noeglen - baade til at samle links og til at kunne
 *     genimportere uden dubletter.
 *  3. **`Untitled <hex>.csv` inde i en side er en LINKET VISNING** af en
 *     database, der bor et andet sted. Importeres den som en notesbog, faar
 *     man det samme indhold to gange.
 *  4. **Egenskabsblokken staar lige under titlen** som `Noegle: vaerdi` uden
 *     tom linje imellem. 269 af 278 sider har en.
 *  5. **`<aside>` er Notions callout.** Rendereren escaper HTML (med rette),
 *     saa uden en omsaetning staar der literal `<aside>` i noten.
 */

(function (root, fabrik) {
  if (typeof module === 'object' && module.exports) module.exports = fabrik();
  else root.saguNotion = fabrik();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const HEX = /^(.*?)[ _]([0-9a-f]{32})(_all)?$/;

  /** Deler et filnavn i titel og Notion-id. */
  function delNavn(filnavn) {
    const punkt = filnavn.lastIndexOf('.');
    const endelse = punkt > 0 ? filnavn.slice(punkt + 1).toLowerCase() : '';
    const stamme = punkt > 0 ? filnavn.slice(0, punkt) : filnavn;
    const m = stamme.match(HEX);
    if (!m) return { titel: stamme, id: null, endelse, alle: false };
    return { titel: m[1].trim(), id: m[2], endelse, alle: !!m[3] };
  }

  /** NFC + URL-afkodning. macOS gemmer NFD; Notions links er NFC og %-kodede. */
  function normSti(s) {
    let ud = String(s || '');
    try { ud = decodeURIComponent(ud); } catch { /* en raa % er ikke en kodning */ }
    return ud.normalize('NFC').replace(/\\/g, '/').replace(/^\.\//, '');
  }

  /** Opløser en relativ sti fra en fil. Uden `..` ud af arkivet. */
  function opløs(fraSti, relativ) {
    const dele = normSti(fraSti).split('/').slice(0, -1);
    for (const d of normSti(relativ).split('/')) {
      if (d === '' || d === '.') continue;
      if (d === '..') { dele.pop(); continue; }
      dele.push(d);
    }
    return dele.join('/');
  }

  /* ------------------------------------------------------- datoerne */

  const MAANEDER = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  };

  /**
   * Notions datoer -> sekunder siden epoken.
   *
   * Tre former i Andreas' eksport (490 + 15 + 6 forekomster):
   *   "March 23, 2023 2:03 AM"      engelsk, med og uden klokkeslæt
   *   "01/10/2020"                  DANSK d/m/y - ikke amerikansk m/d/y
   *   "12/10/2020 → 23/10/2020"     et interval; vi tager begyndelsen
   * Plus én med "(GMT+2)" haengende bagpaa.
   *
   * **Uden de datoer er 278 importerede noter en bunke, der alle blev
   * skrevet samme aften - og raekkefoelgen de blev skrevet i er halvdelen af,
   * hvad et arkiv er** (Verdandes spec).
   */
  function tolkDato(raa) {
    let s = String(raa || '').trim();
    if (!s) return null;
    // Interval: begyndelsen er den, der betyder noget.
    s = s.split('→')[0].trim();
    // Tidszone-halen. Vi kan ikke gøre noget fornuftigt med den uden en
    // tidszonedatabase, og noten er importeret - ikke planlagt.
    s = s.replace(/\s*\((GMT|UTC)[^)]*\)\s*$/i, '').trim();

    const eng = s.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*([AP]M))?$/);
    if (eng) {
      const m = MAANEDER[eng[1].toLowerCase()];
      if (m === undefined) return null;
      let time = eng[4] ? Number(eng[4]) % 12 : 0;
      if (eng[6] && eng[6].toUpperCase() === 'PM') time += 12;
      // Lokal tid: datoen kom fra en menneskelig visning, ikke fra UTC.
      return Math.floor(new Date(Number(eng[3]), m, Number(eng[2]), time,
        eng[5] ? Number(eng[5]) : 0).getTime() / 1000);
    }

    // dd/mm/yyyy. DANSK raekkefoelge - Notion foelger arbejdsområdets
    // lokalitet, og Andreas' er dansk. En amerikansk laesning ville goere
    // 01/10 til 10. januar i stedet for 1. oktober, og det er den slags,
    // ingen opdager foer et aar senere.
    const dk = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
    if (dk) {
      return Math.floor(new Date(Number(dk[3]), Number(dk[2]) - 1, Number(dk[1]),
        dk[4] ? Number(dk[4]) : 0, dk[5] ? Number(dk[5]) : 0).getTime() / 1000);
    }

    const iso = Date.parse(s);
    return Number.isNaN(iso) ? null : Math.floor(iso / 1000);
  }

  /* ------------------------------------------------- sidens indhold */

  /**
   * Skiller titel, egenskaber og krop.
   *
   * Egenskabsblokken staar LIGE under titlen uden en tom linje imellem, og
   * slutter ved den foerste tomme linje. En linje som »URL: https://…« i
   * broedteksten kan derfor ikke forveksles med en egenskab - den staar
   * efter en tom linje.
   */
  function laesSide(tekst) {
    const linjer = String(tekst || '').replace(/\r\n?/g, '\n').split('\n');
    let i = 0;
    let titel = '';
    if (linjer[0] && linjer[0].startsWith('# ')) { titel = linjer[0].slice(2).trim(); i = 1; }
    if (linjer[i] !== undefined && !linjer[i].trim()) i++;

    const props = [];
    while (i < linjer.length && linjer[i].trim()) {
      const m = linjer[i].match(/^([^:\n]{1,80}): ?(.*)$/);
      if (!m) break;
      const noegle = m[1].trim();
      // En markdown-overskrift eller et punkt er ikke en egenskab.
      if (/^[#>\-*|]/.test(noegle) || !noegle) break;
      props.push({ key: noegle, value: m[2].trim() });
      i++;
    }
    while (i < linjer.length && !linjer[i].trim()) i++;
    return { titel, props, krop: linjer.slice(i).join('\n').trim() };
  }

  /** `Tags: hus, nilex` -> ['hus', 'nilex'] */
  function tolkTags(vaerdi) {
    return String(vaerdi || '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 20);
  }

  /**
   * Notions `<aside>` er en callout. Rendereren escaper HTML - med rette -
   * saa uden det her staar der literal `<aside>` i noten.
   */
  function asideTilCallout(md) {
    return String(md || '').replace(/<aside>\s*([\s\S]*?)\s*<\/aside>/g, (_, indhold) => {
      const linjer = indhold.trim().split('\n').map((l) => l.trim()).filter(Boolean);
      // Notion begynder ofte med et emoji, der er selve »ikonet«.
      let art = 'NOTE';
      if (linjer[0] && /^(⚠|❗|🚨)/.test(linjer[0])) art = 'WARNING';
      else if (linjer[0] && /^(💡|✨)/.test(linjer[0])) art = 'TIP';
      return `> [!${art}]\n${linjer.map((l) => `> ${l}`).join('\n')}`;
    });
  }

  /* --------------------------------------------------------- CSV */

  /** Lille CSV-laeser. Citerede felter, dobbelt-anfoerselstegn, linjeskift i felter. */
  function laesCsv(tekst) {
    const s = String(tekst || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const raekker = [];
    let felt = '';
    let raekke = [];
    let iCitat = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (iCitat) {
        if (c === '"') {
          if (s[i + 1] === '"') { felt += '"'; i++; } else iCitat = false;
        } else felt += c;
        continue;
      }
      if (c === '"') { iCitat = true; continue; }
      if (c === ',') { raekke.push(felt); felt = ''; continue; }
      if (c === '\n') { raekke.push(felt); raekker.push(raekke); raekke = []; felt = ''; continue; }
      felt += c;
    }
    if (felt || raekke.length) { raekke.push(felt); raekker.push(raekke); }
    return raekker.filter((r) => r.some((f) => f !== ''));
  }

  /* -------------------------------------------------- hele arkivet */

  /**
   * Bygger arkivets struktur ud af en liste af stier.
   *
   * @param {string[]} stier  alle filer i arkivet, med '/' som skilletegn
   * @returns {{sider, databaser, filer, springer}}
   */
  /**
   * Skrald fra det filsystem, arkivet blev pakket paa - ikke fra Notion.
   *
   * Pakker man eksporten om paa en Mac (fx fordi man har pakket den ud og
   * zippet mappen igen), foelger AppleDouble-filerne med: for hver
   * `Titel <hex>.md` ligger der en `._Titel <hex>.md` med samme navn og
   * **samme id**. Uden dette filter er den ikke bare stoej - den VINDER:
   * `sider` er en Map paa id'et, saa tvillingen overskriver den rigtige side,
   * og resultatet er et arkiv af TOMME noter. Maalt paa Andreas' egen zip:
   * 297 tomme noter og 13 tomme notesboeger, hvor de rigtige skulle have
   * vaeret.
   *
   * Windows' `Thumbs.db` og `desktop.ini` er samme slags: filsystemets
   * efterladenskaber, som aldrig var indhold.
   */
  function erFilsystemSkrald(kort) {
    const navn = kort.split('/').pop();
    return kort.startsWith('__MACOSX/') || kort.includes('/__MACOSX/')
      || navn.startsWith('._') || navn === '.DS_Store'
      || navn === 'Thumbs.db' || navn === 'desktop.ini';
  }

  function laesStruktur(stier) {
    const alle = stier.map(normSti).filter(Boolean);
    /*
     * Skraldet skal vaek FOER den faelles rod findes.
     *
     * `__MACOSX/` ligger ved siden af eksportmappen, ikke inde i den. Er den
     * med i beregningen, er der ingen faelles rod laengere, og saa forskydes
     * ALLE relative stier ét led - links, mapper og ejerskab. Maalt paa
     * Andreas' eksport: 217 genoprettede links i stedet for 241, uden at
     * noget fejlede. Det var kun synligt, fordi tallet blev sammenlignet med
     * den samme eksport uden skrald.
     */
    const rene = alle.filter((sti) => !erFilsystemSkrald(sti));
    const skrald = alle.length - rene.length;
    // Notion pakker alt i én rodmappe. Den skal vaek, ellers bliver hele
    // arkivet til én notesbog med ét barn.
    const rod = faellesRod(rene);

    const sider = new Map();      // id -> {sti, titel, id, foraelderSti}
    const databaser = new Map();  // id -> {sti, alleSti, titel, id, mappe}
    const filer = [];
    const springer = [];

    for (const sti of rene) {
      const kort = rod ? sti.slice(rod.length + 1) : sti;
      if (!kort) continue;
      const navn = kort.split('/').pop();
      const { titel, id, endelse, alle } = delNavn(navn);

      if (endelse === 'md') {
        if (!id) { springer.push({ sti: kort, hvorfor: 'no Notion id in the filename' }); continue; }
        sider.set(id, { sti, kort, titel, id, mappe: null });
        continue;
      }
      if (endelse === 'csv') {
        if (!id) { springer.push({ sti: kort, hvorfor: 'no Notion id in the filename' }); continue; }
        const d = databaser.get(id) || { id, titel, mappe: null };
        // `_all` er den AUTORITATIVE: den blotte CSV er den aktuelle visning,
        // filtreret og med faerre kolonner.
        if (alle) d.alleSti = sti; else d.sti = sti;
        d.titel = titel;
        databaser.set(id, d);
        continue;
      }
      filer.push({ sti, kort, navn });
    }

    /*
     * Hvilken mappe baerer en sides undersider og filer?
     *
     * IKKE `Titel <hex>/`, som man skulle tro: Notion navngiver mappen efter
     * TITLEN ALENE, uden id'et, og afkorter den til ~48 tegn. Maalt paa
     * Andreas' eksport: **0 af 97 mapper har et hex i navnet.**
     *
     * Gaettede man mappenavnet ud af filnavnet, ville hver databaseraekke
     * havne i den forkerte notesbog, og forsidens tabel ville ikke kunne
     * linke til sine egne raekker. Derfor UDLEDES det af de mapper, der
     * faktisk findes: for hver mappe ledes efter den side eller database,
     * der ligger ved siden af den, og hvis titel mappen er en forkortelse af.
     */
    const mapper = new Set();
    for (const sti of rene) {
      const kort = rod ? sti.slice(rod.length + 1) : sti;
      const dele = kort.split('/');
      for (let i = 1; i < dele.length; i++) mapper.add(dele.slice(0, i).join('/'));
    }
    const ejere = [...sider.values(), ...databaser.values()];
    for (const mappe of mapper) {
      const foraelder = mappe.split('/').slice(0, -1).join('/');
      const navn = mappe.split('/').pop();
      /*
       * Mappen kan hedde to ting. Notion skriver som regel »Titel <32 hex>«,
       * men i Andreas' egen eksport (97 mapper) gjorde den det i NUL af dem -
       * der er mappen titlen alene, afkortet til omkring 48 tegn. Vi tager
       * derfor id'et, naar det staar der, og ellers et praefiks-match paa
       * titlen i filnavnsform. Lighed duer ikke: titlen er baade renset for
       * tegn, filsystemet ikke tillader, og klippet af.
       */
      const medId = /^(.*) ([0-9a-f]{32})$/.exec(navn);
      let ramt = null;
      if (medId) ramt = ejere.find((e) => e.id === medId[2]);
      if (!ramt) {
        const bar = medId ? medId[1] : navn;
        ramt = ejere.find((e) => {
          const eKort = e.kort || (rod ? (e.alleSti || e.sti).slice(rod.length + 1) : (e.alleSti || e.sti));
          if (eKort.split('/').slice(0, -1).join('/') !== foraelder) return false;
          return filnavnsform(e.titel).startsWith(bar);
        });
      }
      if (ramt) ramt.mappe = mappe;
    }
    /*
     * TAEL det, du springer over, og sig det hoejt.
     *
     * Én linje frem for 297 - listen ville drukne alt andet - men tavshed er
     * ikke en mulighed: en note, der forsvandt uden en linje, opdages kun ved
     * at taelle i begge ender (Verdandes spec).
     */
    if (skrald) {
      springer.push({
        sti: `${skrald} files`,
        hvorfor: 'left over from the file system (._ resource forks, __MACOSX, .DS_Store) '
          + 'and not part of the export — they carry the same ids as the real pages',
      });
    }
    return { rod, sider, databaser, filer, springer, skrald };
  }

  /**
   * Titlen, som den ser ud som et MAPPENAVN.
   *
   * Notion erstatter de tegn, et filsystem ikke tillader. Uden den samme
   * rensning her matcher en titel med en skraastreg aldrig sin egen mappe.
   */
  function filnavnsform(titel) {
    return String(titel || '').replace(/[/\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /** Den mappe, ALLE stier begynder med. Notion pakker eksporten i én. */
  function faellesRod(stier) {
    if (!stier.length) return '';
    const foerste = stier[0].split('/');
    if (foerste.length < 2) return '';
    const kandidat = foerste[0];
    return stier.every((s) => s.startsWith(`${kandidat}/`)) ? kandidat : '';
  }

  /**
   * Er denne database en LINKET VISNING?
   *
   * Notion eksporterer en linket database - en visning af en database, der
   * bor et andet sted - som `Untitled <hex>.csv` inde i den side, den vises
   * paa. Importeres den som en notesbog, staar det samme indhold to gange.
   *
   * Kendetegnet er baade navnet OG at den ligger inde i en sides mappe.
   */
  function erLinketVisning(db) {
    // Det RENE kendetegn er, at der ikke findes en `_all.csv`: Notion skriver
    // altid en for en aegte database, men en linket visning er kun en
    // visning - der er ingen »alle raekker« at eksportere.
    //
    // Maalt paa Andreas' eksport: 12 aegte databaser, alle med `_all`;
    // 7 linkede visninger, ingen med. Navnet »Untitled« og at ligge inde i en
    // side er samstemmende, men ikke i sig selv nok - »Opgaveliste for
    // Renovering« er en AEGTE database, der ligger inde i en side.
    if (db.alleSti) return false;
    return !db.titel || db.titel.toLowerCase() === 'untitled';
  }

  /**
   * Skriver Notions relative links om til Sagus egne.
   *
   * @param {function} slaaOp  (opløstSti) -> {slags:'note'|'fil', id} | null
   */
  function omskrivLinks(md, fraSti, slaaOp) {
    return String(md || '').replace(
      /(!?)\[([^\]\n]*)\]\(([^)\s]+)\)/g,
      (helt, udraab, tekst, url) => {
        if (/^(https?:|mailto:|#)/i.test(url)) return helt;
        const maal = slaaOp(opløs(fraSti, url));
        if (!maal) return helt;          // en doed henvisning bliver staaende
        if (maal.slags === 'note') return `${udraab}[${tekst || maal.titel || 'note'}](sagu-note:${maal.id})`;
        return `${udraab}[${tekst}](sagu:${maal.id})`;
      },
    );
  }

  return {
    delNavn, normSti, opløs, tolkDato, laesSide, tolkTags, asideTilCallout,
    laesCsv, laesStruktur, faellesRod, erLinketVisning, omskrivLinks, filnavnsform,
  };
}));

/* ---- shared/soeg.js ---- */
/*
 * Sagu - soegesyntaksen. ÉN parser, tre koersteder.
 *
 * Browseren tegner chips ud fra den ved hvert tastetryk (uden netvaerkskald),
 * serveren soeger med den, og wikiens offentlige soegning (F6) skal forstaa
 * praecis det samme. Ligger tolkningen to steder, driver de fra hinanden, og
 * feltet begynder at love noget, resultatet ikke holder.
 *
 * Syntaksen (SAGU-PLAN §5):
 *
 *   tag:drift          kun noter med maerket
 *   in:Hjorten         kun i den notesbog eller under den side
 *   updated:<30d       aendret inden for 30 dage   (ogsaa >, og d/w/m/y)
 *   has:code           indeholder en kodeblok      (ogsaa image, link, todo)
 *   "en hel frase"     ordene i den raekkefoelge
 *   -ord               uden det ord
 *
 * Alt andet er soegeord.
 */

(function (root, fabrik) {
  if (typeof module === 'object' && module.exports) module.exports = fabrik();
  else root.saguSoeg = fabrik();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FILTRE = ['tag', 'in', 'updated', 'has', 'is'];
  const HAS = ['code', 'image', 'link', 'todo', 'table'];

  /**
   * `updated:<30d` -> {retning:'<', sekunder:2592000}
   *
   * Dage, uger, maaneder og aar - IKKE en dato. En dato i et soegefelt er en
   * datoparser mere at holde rigtig, og »inden for 30 dage« er det, folk
   * faktisk skriver.
   */
  function tolkAlder(raa) {
    const m = String(raa || '').match(/^([<>]?)(\d{1,4})([dwmy])$/i);
    if (!m) return null;
    const enhed = { d: 86400, w: 604800, m: 2592000, y: 31536000 }[m[3].toLowerCase()];
    return { retning: m[1] || '<', sekunder: Number(m[2]) * enhed };
  }

  /**
   * Deler linjen i filtre og soegeord.
   *
   * Et filter skal staa ved linjestart eller efter et mellemrum - ellers
   * ville `mailto:navn@eksempel.dk` blive til et `mailto`-filter, og en
   * URL med `https://` ville blive delt midt over.
   */
  function tolk(raa) {
    const ud = { termer: [], fraser: [], uden: [], tags: [], i: null, alder: null, has: [], raa: String(raa || '') };
    const s = ud.raa;
    let i = 0;

    while (i < s.length) {
      if (/\s/.test(s[i])) { i++; continue; }

      // "en hel frase"
      if (s[i] === '"') {
        const slut = s.indexOf('"', i + 1);
        const tekst = (slut < 0 ? s.slice(i + 1) : s.slice(i + 1, slut)).trim();
        if (tekst) ud.fraser.push(tekst);
        i = slut < 0 ? s.length : slut + 1;
        continue;
      }

      // Et ord frem til naeste mellemrum (men en citeret filterværdi maa
      // gerne indeholde mellemrum: in:"Min notesbog").
      let j = i;
      let ord = '';
      let iCitat = false;
      while (j < s.length && (iCitat || !/\s/.test(s[j]))) {
        if (s[j] === '"') { iCitat = !iCitat; j++; continue; }
        ord += s[j];
        j++;
      }
      i = j;
      if (!ord) continue;

      const f = ord.match(/^(\w+):(.*)$/);
      if (f && FILTRE.includes(f[1].toLowerCase()) && f[2]) {
        const navn = f[1].toLowerCase();
        const vaerdi = f[2];
        if (navn === 'tag') ud.tags.push(vaerdi.toLowerCase());
        else if (navn === 'in') ud.i = vaerdi;
        else if (navn === 'updated') { const a = tolkAlder(vaerdi); if (a) ud.alder = a; else ud.termer.push(ord); }
        else if (navn === 'has' || navn === 'is') {
          if (HAS.includes(vaerdi.toLowerCase())) ud.has.push(vaerdi.toLowerCase());
          else ud.termer.push(ord);
        }
        continue;
      }

      // -ord: uden. Et enligt bindestreg-tegn er ikke et filter.
      if (ord[0] === '-' && ord.length > 1) { ud.uden.push(ord.slice(1)); continue; }

      ud.termer.push(ord);
    }

    // Det, der skal SOEGES efter - uden filtrene. Fodrer man soegningen med
    // den raa linje, doer resultatet i det oejeblik brugeren skriver en
    // markoer (RUNE-ERFARINGER, doda v30).
    ud.tekst = ud.termer.concat(ud.fraser).join(' ').trim();
    ud.harFiltre = !!(ud.tags.length || ud.i || ud.alder || ud.has.length || ud.uden.length);
    return ud;
  }

  /**
   * Danske tegn, som FTS5's `remove_diacritics 2` IKKE folder.
   *
   * Skal matche `foldDansk` i server.js - se DESIGN.md, maaling 2. Her bruges
   * den til LIKE-faldet tilbage, saa »gron« ogsaa finder »grøn« dér.
   */
  function fold(s) {
    return String(s || '').toLowerCase()
      .replace(/ø/g, 'o').replace(/æ/g, 'a').replace(/å/g, 'a');
  }

  /** En kort, laesbar gengivelse af filtrene - til chips under feltet. */
  function beskriv(t) {
    const ud = [];
    for (const x of t.tags) ud.push(`#${x}`);
    if (t.i) ud.push(`in ${t.i}`);
    if (t.alder) {
      const dage = Math.round(t.alder.sekunder / 86400);
      ud.push(t.alder.retning === '<' ? `changed in the last ${dage} days` : `older than ${dage} days`);
    }
    for (const h of t.has) ud.push(`has ${h}`);
    for (const u of t.uden) ud.push(`without "${u}"`);
    return ud;
  }

  return { tolk, tolkAlder, fold, beskriv, FILTRE, HAS };
}));

/* ---- p10_deling.js ---- */
'use strict';
/*
 * Sagu - deling mellem konti (F11).
 *
 * ── Hvor beslutningen tages ───────────────────────────────────────────────
 *
 * Ruden hoerer paa noteskaermen, ved siden af udgivelsen, fordi de to er den
 * samme slags valg med to forskellige raekkevidder: »kollegaerne paa nettet«
 * og »Bo, med sin egen konto«. Listen over det, ANDRE har delt med mig, staar
 * for sig - den er ikke mit arkiv, og den skal ikke blandes ind i det.
 *
 * ── Det, ruden skal sige HOEJT ────────────────────────────────────────────
 *
 * At dele er at give noget fra sig, saa der maa ikke vaere tvivl om hvad. Tre
 * ting staar derfor skrevet i selve ruden og ikke kun i koden:
 *
 *   - at undersiderne foelger med,
 *   - at `write` betyder »skriv i den«, ikke »bestem over den«,
 *   - og at »giv videre« flytter ejerskabet, ikke bare adgangen.
 *
 * En rude, der bare siger »Share«, faar folk til at gaette - og et gaet om
 * hvem der kan se hvad er den slags fejl, man opdager for sent.
 */

/**
 * Maa jeg rette i den her note?
 *
 * ÉT sted, brugt af de tre steder en redigering kan BEGYNDE: titelfeltet,
 * det at aabne en blok, og tjekbokse. Spredt ud ville den ene blive glemt -
 * og en flade, der lader dig skrive og foerst afviser ved gemningen, ligner
 * en fejl i appen, ikke en spaerring (RUNE-ERFARINGER, tovo v8).
 *
 * Serveren afviser uanset hvad; det her er, for at man ikke skal proeve.
 */
function maaRette(n) {
  return !n || n.mine !== false || n.level === 'write';
}

/**
 * Knappen i notens vaerktoejsraekke. Kun paa MINE noter - kun ejeren deler.
 *
 * Og kun paa en server, hvor der ER nogen at dele med. Paa en énbrugerserver
 * aabnede knappen en rude, hvor den eneste mulige modtager var én selv - den
 * lovede noget, appen ikke kunne holde (Andreas, 2026-08-21).
 *
 * Er noten ALLEREDE delt, bliver knappen staaende, uanset hvad. Ellers ville
 * en deling, man har lavet, blive usynlig i samme oejeblik den anden konto
 * slettes - og saa kunne den hverken ses eller trakkes tilbage.
 */
function delKnapHtml(n) {
  if (!n || n.mine === false) return '';
  const paa = !!n.sharedWith;
  if (!paa && !state.flereBrugere) return '';
  return `<button class="iconbtn${paa ? ' paa' : ''}" id="delBtn"
    aria-pressed="${paa ? 'true' : 'false'}"
    title="${paa ? 'Shared with other accounts' : 'Share with another account'}">${icon('shared', 16)}</button>`;
}

/**
 * Baandet over en note, der ikke er min.
 *
 * En redigeringsflade, der ser ud som ens egen og saa afviser gemningen, er
 * vaerre end en, der siger det paa forhaand (RUNE-ERFARINGER, tovo v8: en
 * spaerring, man foerst moeder NAAR man har skrevet, ligner en fejl i appen).
 */
function delingsBaandHtml(n) {
  if (!n || n.mine !== false) return '';
  const skriv = n.level === 'write';
  return `<div class="delt-baand${skriv ? ' kan-skrive' : ''}">
    ${icon('shared', 16)}
    <div>
      <strong>${esc(pentBruger(n.owner) || 'Someone')} shared this page with you.</strong>
      <div class="meta saetning">${skriv
    ? 'You can edit it and add subpages. Deleting, publishing and sharing it on stay with '
      + `${esc(pentBruger(n.owner) || 'the owner')}.`
    : 'You can read it. Nothing you type here would be saved.'}</div>
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ ruden */

async function visDelPanel() {
  const n = editor.note;
  if (!n || n.mine === false) return;
  const gammel = document.getElementById('delPanel');
  if (gammel) { gammel.remove(); return; }

  const host = document.createElement('div');
  host.className = 'modal';
  host.id = 'delPanel';
  host.innerHTML = `<div class="modal-kort">
      <div class="modal-top">
        <h2>Share “${esc(n.title || 'Untitled')}”</h2>
        <button class="iconbtn" id="delLuk" aria-label="Close">${icon('luk', 16)}</button>
      </div>
      <div class="modal-krop" id="delKrop"><p class="meta saetning">Loading…</p></div>
    </div>`;
  document.body.appendChild(host);

  const luk = () => { host.remove(); document.removeEventListener('keydown', paaTast); };
  const paaTast = (e) => { if (e.key === 'Escape') { e.preventDefault(); luk(); } };
  document.addEventListener('keydown', paaTast);
  host.querySelector('#delLuk').addEventListener('click', luk);
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });

  const krop = host.querySelector('#delKrop');
  let adgang = null;
  let folk = [];
  try {
    adgang = (await api('GET', `/api/v1/notes/${n.id}/access`));
    folk = (await api('GET', '/api/v1/people')).people;
  } catch (ex) {
    krop.innerHTML = `<p class="meta saetning">${esc(ex.message)}</p>`;
    return;
  }

  function tegn() {
    krop.innerHTML = delKropHtml(adgang, folk);
    bind();
    // Knappen skal foelge med med det samme - ellers ser man ikke, at noget
    // skete, foer siden tegnes forfra.
    n.sharedWith = adgang.people.length;
    const knap = document.getElementById('delBtn');
    if (knap) {
      knap.classList.toggle('paa', !!adgang.people.length);
      knap.setAttribute('aria-pressed', adgang.people.length ? 'true' : 'false');
    }
  }

  function fejl(besked) {
    const el = krop.querySelector('#delFejl');
    if (el) { el.textContent = besked; el.hidden = false; }
  }

  function bind() {
    const q = (id) => krop.querySelector(`#${id}`);

    const giv = q('delGiv');
    if (giv) {
      giv.addEventListener('click', async () => {
        const navn = q('delHvem').value;
        if (!navn) { fejl('Pick who it is for.'); return; }
        giv.disabled = true;
        try {
          await api('POST', `/api/v1/notes/${n.id}/access`, {
            username: navn,
            level: q('delNiveau').value,
            tree: q('delTrae').checked,
          });
          adgang = await api('GET', `/api/v1/notes/${n.id}/access`);
          toast(`Shared with ${pentBruger(navn)}.`);
          tegn();
        } catch (ex) { fejl(ex.message); giv.disabled = false; }
      });
    }

    krop.querySelectorAll('[data-fjern]').forEach((el) => {
      el.addEventListener('click', async () => {
        try {
          await api('DELETE', `/api/v1/notes/${n.id}/access/${el.dataset.fjern}`);
          adgang = await api('GET', `/api/v1/notes/${n.id}/access`);
          toast('Access removed. It stops working right away.');
          tegn();
        } catch (ex) { fejl(ex.message); }
      });
    });

    const over = q('delOverdrag');
    if (over) {
      over.addEventListener('click', async () => {
        const navn = q('delNyEjer').value;
        if (!navn) { fejl('Pick who should have it.'); return; }
        /*
         * Ejerskifte er den ene handling her, der ikke kan fortrydes fra MIN
         * side bagefter - den nye ejer kan tage min adgang. Derfor et
         * spoergsmaal, og et der siger hvad der sker.
         */
        if (!confirm(`Hand “${n.title || 'Untitled'}” and everything under it to ${navn}?\n\n`
          + 'They become the owner. You keep write access until they remove it.')) return;
        over.disabled = true;
        try {
          const d = await api('POST', `/api/v1/notes/${n.id}/owner`, { username: navn });
          toast(`${pentBruger(d.newOwner.username)} owns it now — ${d.antal} page${d.antal === 1 ? '' : 's'}.`);
          luk();
          await hentTrae();
          tegnTrae();
          await aabnNote(n.id);
        } catch (ex) { fejl(ex.message); over.disabled = false; }
      });
    }
  }

  tegn();
}

function delKropHtml(adgang, folk) {
  const brugt = new Set(adgang.people.map((p) => p.username));
  const ledige = folk.filter((p) => !brugt.has(p.username));
  return `
    <p class="delFejl gate-error" id="delFejl" hidden></p>

    ${adgang.people.length ? `<div class="tablewrap"><table class="data">
      <thead><tr><th>Account</th><th>Can</th><th></th></tr></thead>
      <tbody>${adgang.people.map((p) => `<tr>
        <td>${esc(pentBruger(p.username))}</td>
        <td>${p.level === 'write' ? 'Read and write' : 'Read'}${p.tree ? '' : ' — this page only'}</td>
        <td style="text-align:right"><button class="btn ghost danger"
          data-fjern="${esc(p.userId)}">Remove</button></td>
      </tr>`).join('')}</tbody></table></div>`
    : '<p class="meta saetning">Nobody else can see this page yet.</p>'}

    ${ledige.length ? `
      <div class="btnrow" style="margin-top:14px">
        <select class="input" id="delHvem" style="max-width:180px">
          ${ledige.map((p) => `<option value="${esc(p.username)}">${esc(pentBruger(p.username))}</option>`).join('')}
        </select>
        <select class="input" id="delNiveau" style="max-width:160px">
          <option value="read">Can read</option>
          <option value="write">Can write</option>
        </select>
        <button class="btn" id="delGiv">Share</button>
      </div>
      <label class="switch"><input type="checkbox" id="delTrae" checked>
        <span>Include the subpages — pages added later come along too</span></label>
      <p class="meta saetning"><strong>Can write</strong> means they can edit the text and add
      subpages. Deleting, publishing on the web, sharing it on and handing it over stay
      with you — those are not things someone should be able to do to your archive by
      accident.</p>`
    : `<p class="meta saetning">${folk.length
      ? 'Everyone with an account already has access.'
      : 'There are no other accounts yet. An administrator can open sign-up in Settings.'}</p>`}

    ${folk.length ? `
      <h3 style="margin-top:22px">Hand it over</h3>
      <p class="meta saetning">Gives this page <em>and everything under it</em> to someone
      else. It leaves your notebooks and lands in theirs; you keep write access until they
      remove it.</p>
      <div class="btnrow">
        <select class="input" id="delNyEjer" style="max-width:180px">
          ${folk.map((p) => `<option value="${esc(p.username)}">${esc(pentBruger(p.username))}</option>`).join('')}
        </select>
        <button class="btn ghost danger" id="delOverdrag">Hand over</button>
      </div>` : ''}`;
}

/* ------------------------------------------------------- delt med mig */

async function sideDelt() {
  let noter = [];
  try { noter = (await api('GET', '/api/v1/shared')).notes; } catch (ex) {
    return `<div class="card"><p class="lead">${esc(ex.message)}</p></div>`;
  }
  if (!noter.length) {
    return `<div class="card empty">
      <h2>Nothing yet</h2>
      <p class="meta saetning">When somebody with an account here shares a page with you,
      it shows up in this list — with the pages under it.</p>
    </div>`;
  }
  return `<div class="card">
    <div class="tablewrap"><table class="data">
      <thead><tr><th>Page</th><th>From</th><th>You can</th><th class="num">Changed</th></tr></thead>
      <tbody>${noter.map((n) => `<tr>
        <td><button class="linkbtn" data-aabn="${esc(n.id)}">${n.icon ? `${esc(n.icon)} ` : ''}${
  esc(n.title || 'Untitled')}</button></td>
        <td>${esc(pentBruger(n.owner))}</td>
        <td>${n.level === 'write' ? 'read and write' : 'read'}</td>
        <td class="num">${esc(visTid(n.updatedAt))}</td>
      </tr>`).join('')}</tbody></table></div>
    <p class="meta saetning">Only the top of each shared tree is listed — the pages under it
    open from there, the same way your own do.</p>
  </div>`;
}

function bindDelt() {
  document.querySelectorAll('[data-aabn]').forEach((el) => {
    el.addEventListener('click', () => aabnNote(el.dataset.aabn));
  });
}

/* ---- p11_github.js ---- */
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

/* ---- p12_polering.js ---- */
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
/**
 * Hedder tasten Cmd eller Ctrl paa DEN her maskine?
 *
 * Oversigten skal vise det, der staar paa brugerens eget tastatur. Skriver
 * den »Ctrl« til en Mac, leder man efter en tast, der ikke er der.
 */
function modTast() {
  const nav = window.navigator || {};
  const kilde = String((nav.userAgentData && nav.userAgentData.platform) || nav.platform || '');
  return /mac|iphone|ipad|ipod/i.test(kilde) ? '\u2318' : 'Ctrl+';
}

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
    /*
     * Den ENESTE genvej med modifikator - og den er en bevidst undtagelse
     * fra reglen tre skaerme laengere nede.
     *
     * `Cmd`/`Ctrl+K` er blevet den maade, man aabner soegningen paa (Notion,
     * Linear, Slack, GitHub), og en app, der ikke svarer paa den, foeles
     * gaaet i staa. Prisen er aerlig: i Chrome staar `Ctrl/Cmd+K` for
     * adressefeltets soegning, saa vi TAGER noget, browseren havde. Det er
     * vurderingen vaerd, fordi den, der taster den her, mener sin egen app -
     * men det er en undtagelse, ikke en aabning for flere.
     *
     * Den virker OGSAA midt i en note. Netop dér er den mest vaerd: man er
     * ved at skrive, skal slaa noget op, og skal ikke foerst finde musen.
     */
    tast: 'k', modifikator: true, vis: modTast() + 'K',
    hvad: 'Search — from anywhere, even mid-sentence',
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
 * Den ene undtagelse er `Cmd/Ctrl+K`; begrundelsen står ved genvejen selv,
 * så den, der får lyst til at tilføje nummer to, læser prisen først.
 */
document.addEventListener('keydown', (e) => {
  if (!state.user) return;
  /*
   * Escape rydder en markering i traeet.
   *
   * Vejen UD af en tilstand, man kan komme i ved et uheld. Naar der er noget
   * markeret, vaelger et almindeligt klik til og fra i stedet for at aabne -
   * det er oensket (se `bindTrae`), men saa skal der ogsaa vaere en tast, der
   * slipper én fri uden at lede efter en knap.
   *
   * FOER alt andet, og uden at spoerge om skrivefelter: staar man i
   * soegefeltet med tre noter markeret, er Escape stadig det, man trykker.
   */
  if (e.key === 'Escape' && typeof harValgte === 'function' && harValgte()
      && !document.querySelector('.modal')) {
    e.preventDefault();
    ryddValgte();
    return;
  }
  const passer = (x) => x.tast === e.key || (x.tast.length === 1 && x.tast === e.key.toLowerCase());

  /*
   * Genveje MED modifikator afgoeres foerst, og de spoerger hverken om
   * skrivefelter eller om noget andet: de er netop lavet til at kunne bruges
   * midt i en saetning. `altKey` er ikke med - `Alt+K` skriver et tegn paa
   * flere tastaturer, og en genvej maa ikke aede et bogstav.
   */
  if ((e.metaKey || e.ctrlKey) && !e.altKey) {
    const m = GENVEJE.find((x) => x.modifikator && passer(x));
    if (!m || !genvejGaelder(m)) return;
    e.preventDefault();
    try { m.gør(); } catch (ex) { if (window.console) console.error('genvej fejlede', ex); }
    return;
  }

  const iFelt = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  if (iFelt(e.target) || iFelt(document.activeElement)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  const g = GENVEJE.find((x) => !x.modifikator && passer(x));
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

/*
 * Begge lister kan foldes sammen.
 *
 * De ligger over notesbøgerne i sidebaren, og på en telefon skubber de træet
 * ned under skærmkanten. Valget hører til kontoen, ikke til maskinen — men
 * det gemmes samme sted som bøgernes egen foldning (`editor.foldede`), for
 * **to måder at folde på i samme app er to steder at rette**, næste gang en
 * af dem skal ændres (RUNE-ERFARINGER, tovo v11).
 */
const SEKTION_FAV = 'sektion:favourites';
const SEKTION_SENESTE = 'sektion:recent';

function genvejeHtml() {
  const liste = (titel, noegle, noter) => {
    if (!noter.length) return '';
    const foldet = editor.foldede.has(noegle);
    return `
    <nav class="nav genvejsliste">
      <button class="nav-titel nav-fold" data-foldsektion="${esc(noegle)}"
        aria-expanded="${foldet ? 'false' : 'true'}">
        <span class="fold-pil${foldet ? ' er-foldet' : ''}">${icon('udfold', 12)}</span>
        <span>${esc(titel)}</span>
        ${foldet ? `<span class="nav-count">${noter.length}</span>` : ''}
      </button>
      ${foldet ? '' : noter.map((n) => `<button class="nav-item" data-genvej="${esc(n.id)}"
        ${editor.note && editor.note.id === n.id ? 'aria-current="page"' : ''}>
        ${n.icon ? `<span class="nav-emoji">${esc(n.icon)}</span>` : icon('notes')}
        <span>${esc(n.title || 'Untitled')}</span>
      </button>`).join('')}
    </nav>`;
  };

  return liste('Favourites', SEKTION_FAV, sidebarListe.favoritter)
    + liste('Recent', SEKTION_SENESTE, sidebarListe.seneste);
}

function bindGenveje() {
  document.querySelectorAll('[data-genvej]').forEach((el) => {
    el.addEventListener('click', () => aabnNote(el.dataset.genvej));
  });
  document.querySelectorAll('[data-foldsektion]').forEach((el) => {
    el.addEventListener('click', () => {
      const n = el.dataset.foldsektion;
      if (editor.foldede.has(n)) editor.foldede.delete(n); else editor.foldede.add(n);
      gemFoldede();
      // Tegner KUN sit eget element - en fuld optegning ville lukke en aaben
      // blok og flytte rullepositionen.
      tegnGenveje();
    });
  });
}

/** Tegner KUN sit eget element. En fuld optegning ville lukke en åben blok. */
function tegnGenveje() {
  const host = document.getElementById('navGenveje');
  if (!host) return;
  host.innerHTML = genvejeHtml();
  bindGenveje();
}

/* ==================== træk ned for at opfriske (mobil) ==================
 *
 * »Kan du lave så man kan trække ned for at refreshe når man er på
 * mobilen?« (Andreas, 2026-08-21).
 *
 * ── Hvorfor appen har brug for den ────────────────────────────────────────
 *
 * Sagu kører som en installeret app på telefonen, og dér findes browserens
 * egen »træk ned«-opfriskning ikke — der er ingen adresselinje og ingen
 * genindlæs-knap. Kommer der en note ind fra en anden enhed, en genvej eller
 * MCP, stod skærmen med gårsdagens indhold, indtil man lukkede og åbnede
 * appen igen.
 *
 * ── Hvad den opfrisker, og hvad den IKKE rører ────────────────────────────
 *
 * Den henter DATA, ikke siden. En `location.reload()` ville smide den åbne
 * note, rullepositionen og en kø af ikke-sendte rettelser væk — og det er
 * netop dét, man ikke vil, når man står med telefonen i hånden.
 *
 * En ventende gemning sendes FØRST. Rækkefølgen er ikke til forhandling:
 * hentede vi noten før vi gemte, ville serverens ældre udgave overskrive det,
 * man lige har skrevet — man ville trække ned for at opdatere og få sin egen
 * tekst slettet.
 *
 * Og har noten stadig ugemte rettelser bagefter (offline, en gemning der
 * fejlede), hentes dens tekst IKKE. Resten opfriskes.
 *
 * ── Hvorfor pointer-events ikke duer her ──────────────────────────────────
 *
 * Alle andre steder i Sagu er svaret `pointerdown`/`pointermove` — men her
 * skal rulningen kunne AFLYSES, og det kræver `preventDefault()` på en
 * `touchmove`-lytter, der ikke er passiv. En pointer-hændelse kan ikke stoppe
 * browserens rulning.
 *
 * `preventDefault()` kaldes først, når trækket er GENKENDT: mere lodret end
 * vandret, nedad, og fra en side, der allerede står i toppen. Ellers havde vi
 * brudt almindelig rulning for at vinde en gestus.
 */

// `nedtraek`, ikke `traek`: traeet i sidebaren har sin egen `traek`, og alle
// dele samles til ÉN fil med ét globalt rum. Navnesammenstoed her viser sig
// som en SyntaxError et helt andet sted (det er sket foer, med `maal`).
const NEDTRAEK_GRAENSE = 72;      // px, man skal trække, før den udløser
const NEDTRAEK_VAAGN = 10;        // px, før vi overhovedet griber ind
const NEDTRAEK_MAX = 110;         // så elastikken har en ende

const nedtraek = { yStart: 0, xStart: 0, aktiv: false, laast: false, dy: 0, koerer: false };
let traekEl = null;

function traekIndikator() {
  if (!traekEl) {
    traekEl = document.createElement('div');
    traekEl.className = 'traekopfrisk';
    /*
     * Maerket SIGER, hvad der sker.
     *
     * Foerste udgave var kun et ikon, der skiftede farve ved graensen - og en
     * farve er et gaet, foerste gang man moeder gestussen. doda skriver
     * »Pull to refresh« / »Release to refresh« / »Refreshing…«, og det er
     * hele forskellen paa at vide og at prøve sig frem.
     */
    traekEl.innerHTML = `<div class="traekopfrisk-ring">${icon('opfrisk', 18)}</div>`
      + '<div class="traekopfrisk-tekst"></div>';
    document.body.appendChild(traekEl);
  }
  return traekEl;
}

function saetTraekTekst(el, tekst) {
  const t = el.querySelector('.traekopfrisk-tekst');
  if (t && t.textContent !== tekst) t.textContent = tekst;
}

function skjulTraek() {
  if (!traekEl) return;
  traekEl.classList.remove('paa', 'klar', 'koerer');
  traekEl.style.transform = '';
}

/**
 * Står ALT, fingeren rører, allerede i toppen?
 *
 * `window.scrollY` var ikke nok, og det er ikke en detalje: paa en telefon er
 * det `body`, der ruller, saa `window.scrollY` er ALTID 0 dér.
 *
 * Aarsagen er `html, body { height: 100% }` sammen med
 * `@media (max-width: 900px) { html, body { overflow-x: hidden } }`: naar den
 * ene akse ikke er `visible`, beregnes den anden til `auto`, og saa er body
 * rulleboksen. Paa en bred skaerm er det stadig dokumentet. (Her stod
 * tidligere `height: 100dvh; overflow-y: auto` - det er SIDEBARENS regel, og
 * den, der ledte efter den paa html/body, ledte forgaeves.) Værnet greb dermed aldrig, og et træk nedad
 * midt i en lang note ville opfriske i stedet for at rulle - stik imod det,
 * fingeren bad om (målt i browseren, 2026-08-21).
 *
 * Derfor spørges der tre steder: vinduet, de to mulige sidescrollere, og hver
 * eneste forælder op gennem træet. Det sidste dækker de indre ruder, der har
 * deres egen rulning - en lang kodeblok, sidebaren, en åben rude.
 */
function heltOppe(maal) {
  if (window.scrollY > 0) return false;
  if (document.documentElement.scrollTop > 0 || document.body.scrollTop > 0) return false;
  for (let el = maal; el && el !== document.body; el = el.parentElement) {
    if (el.scrollTop > 0) return false;
  }
  return true;
}

/** Må der overhovedet trækkes lige nu? */
function maaTraekke(e) {
  if (!state.user) return false;
  // Kun berøring. En mus har hjul, og en pegefelt-rulning må ikke fange en
  // gestus, der er tænkt til en finger.
  if (e.touches && e.touches.length !== 1) return false;
  if (!heltOppe(e.target)) return false;
  // En rude, der ligger over siden, har sin egen rulning og sin egen lukning.
  if (document.querySelector('.modal, .blok-menu')) return false;
  /*
   * Spørgsmålet er, hvor FINGEREN lander - ikke hvad der har fokus.
   *
   * Første udgave spurgte om `document.activeElement`, og så virkede
   * gestussen aldrig på en telefon: søgefeltet tager fokus, når appen åbner,
   * og beholder det, selv om tastaturet er væk. Værnet ramte dermed hver
   * eneste gang - en funktion, der er umulig at nå i praksis, findes ikke
   * (samme fælde som markeringsknappen i F16).
   *
   * Inde i et skrivefelt er et træk noget andet: dér panorerer og markerer
   * man. På almindelig tekst gør man ikke - en markering på touch begynder
   * med et langt tryk, ikke med et træk.
   */
  const m = e.target;
  if (m && m.closest && m.closest('input, textarea, [contenteditable="true"]')) return false;
  // Er man i gang med at trække i en blok, hører fingeren til dét.
  if (document.body.querySelector('.greb-aktiv')) return false;
  return true;
}

document.addEventListener('touchstart', (e) => {
  nedtraek.aktiv = false; nedtraek.laast = false; nedtraek.dy = 0;
  if (nedtraek.koerer || !maaTraekke(e)) return;
  nedtraek.yStart = e.touches[0].clientY;
  nedtraek.xStart = e.touches[0].clientX;
  nedtraek.aktiv = true;
}, { passive: true });

document.addEventListener('touchmove', (e) => {
  if (!nedtraek.aktiv || nedtraek.koerer) return;
  const dy = e.touches[0].clientY - nedtraek.yStart;
  const dx = Math.abs(e.touches[0].clientX - nedtraek.xStart);

  if (!nedtraek.laast) {
    // Opad, sidelæns eller for lidt: det er ikke vores gestus. Slip den helt,
    // saa resten af traekket forbliver almindelig rulning.
    if (dy <= 0 || dy < NEDTRAEK_VAAGN) { if (dy < 0) nedtraek.aktiv = false; return; }
    if (dx > dy) { nedtraek.aktiv = false; return; }
    // Naaede siden at rulle, mens fingeren var paa vej? Saa er det rulning.
    if (!heltOppe(e.target)) { nedtraek.aktiv = false; return; }
    nedtraek.laast = true;
    traekIndikator().classList.add('paa');
  }

  // Fra her ER det vores - saa maa siden ikke ogsaa rulle.
  e.preventDefault();
  // Elastik: jo laengere man traekker, jo mindre giver den efter. Uden den
  // foelger maerket fingeren ud af skaermen.
  nedtraek.dy = Math.min(NEDTRAEK_MAX, dy * 0.55);
  const el = traekIndikator();
  el.style.transform = `translate(-50%, ${Math.round(nedtraek.dy)}px)`;
  const ring = el.querySelector('.traekopfrisk-ring');
  if (ring) ring.style.transform = `rotate(${Math.round(nedtraek.dy * 3)}deg)`;
  const klar = nedtraek.dy >= NEDTRAEK_GRAENSE * 0.55;
  el.classList.toggle('klar', klar);
  saetTraekTekst(el, klar ? 'Release to refresh' : 'Pull to refresh');
}, { passive: false });

document.addEventListener('touchend', () => {
  if (!nedtraek.laast) { nedtraek.aktiv = false; return; }
  const naaede = nedtraek.dy >= NEDTRAEK_GRAENSE * 0.55;
  nedtraek.aktiv = false; nedtraek.laast = false;
  if (!naaede) { skjulTraek(); return; }
  opfriskAlt();
}, { passive: true });

// En afbrudt beroering (et opkald, en systemgestus) maa ikke efterlade
// maerket haengende paa skaermen.
document.addEventListener('touchcancel', () => {
  nedtraek.aktiv = false; nedtraek.laast = false; skjulTraek();
}, { passive: true });

/**
 * Henter alt det, skærmen viser, forfra.
 *
 * Ligger for sig selv, fordi den ikke har noget med berøringer at gøre - og
 * fordi den så kan kaldes fra andet end en finger, hvis der senere bliver
 * brug for det.
 */
async function opfriskAlt(stille) {
  if (nedtraek.koerer) return;
  nedtraek.koerer = true;
  sidstOpfrisket = Date.now();
  tegnSynkMaerke();
  const el = traekIndikator();
  // En AUTOMATISK opfriskning skal vaere lydloes. Ellers popper der et maerke
  // op, hver gang telefonen laases op (doda §v26 - samme regel dér).
  if (!stille) {
    el.classList.add('paa', 'koerer');
    el.style.transform = 'translate(-50%, 64px)';
    saetTraekTekst(el, 'Refreshing…');
  }
  try {
    // 1. Det, jeg har skrevet, foerst - se forklaringen i toppen.
    if (typeof gemNu === 'function') await gemNu();
    // 2. Ikke-sendte rettelser afsted, mens vi alligevel har fat i nettet.
    if (typeof synkKoe === 'function' && !state.offline) await synkKoe(true);
    // 3. Notesboeger, maerker, taellere, traeet, favoritter og spor.
    await hentState();
    await hentGenveje();
    tegnTrae();
    // Tallene i toppen laeser `state.counts`, men de tegner sig ikke selv.
    // Uden den her stod der stadig »1 note«, efter at den anden var hentet -
    // og et tal, der ikke foelger med, er vaerre end intet tal.
    opdaterNav();
    // 4. Og selve skaermen.
    if (state.view === 'note' && editor.note && !editor.beskidt) {
      await aabnNote(editor.note.id, true);
    } else if (state.view === 'note' && editor.note) {
      // Ugemte rettelser: teksten er MIN, og den hentes ikke over.
      if (!stille) toast('Refreshed everything except this note — it has unsaved changes.');
    } else {
      await tegnSide();
    }
  } catch (ex) {
    if (!stille) toast(ex && ex.message ? ex.message : 'Could not refresh.');
  } finally {
    nedtraek.koerer = false;
    skjulTraek();
    tegnSynkMaerke();
  }
}

/* ------------------------------------------- naar appen kommer frem igen
 *
 * En app paa hjemmeskaermen bliver ALDRIG genindlaest - den lukkes ikke, den
 * skjules. Vender man tilbage, staar der praecis det, der stod, da man gik -
 * ogsaa selv om man har fanget noget med bogmaerket eller rettet noget paa en
 * anden enhed imens. En app, der viser gamle tal uden at sige det, er en app,
 * man holder op med at stole paa (doda §v26, som allerede havde det her).
 *
 * Sagu spurgte kun om VERSIONEN paa dette tidspunkt (`tjekVersion`), ikke om
 * dataene. Traekket ned var eneste vej til friske noter - og den gestus
 * findes ikke paa en computer.
 *
 * `pageshow` er med, fordi en tilbage-navigation kan komme fra bfcache, hvor
 * hverken `visibilitychange` eller en genindlaesning fyrer.
 *
 * Gulvet paa 30 s er ikke sparsommelighed: uden det henter appen forfra, hver
 * gang man skifter mellem to vinduer paa en computer - og en optegning midt i
 * en saetning er vaerre end lidt gamle tal.
 */
let sidstOpfrisket = Date.now();

/* --------------------------------------------------- »hvor gammelt er det?«
 *
 * Maerket ved siden af tallene i toppen. Det svarer paa ét spoergsmaal, som
 * ellers ikke kan besvares: **sker der ingenting, eller har appen bare ikke
 * spurgt?** Uden det ved man ikke, om de nul nye noter er sandheden eller
 * bare det, appen sidst saa (doda §v26, som havde det foerst).
 *
 * Det er samtidig en KNAP. Traekket ned findes ikke paa en computer, og en
 * automatik uden en manuel vej er en automatik, man ikke kan stole paa, naar
 * den svigter.
 *
 * Ingen falsk praecision: »3 min ago«, ikke »3 min 12 s«.
 */
function opfriskAlder() {
  const sek = Math.round((Date.now() - sidstOpfrisket) / 1000);
  if (sek < 45) return 'just now';
  const min = Math.round(sek / 60);
  if (min < 60) return `${min} min ago`;
  const timer = Math.round(min / 60);
  return timer < 24 ? `${timer} h ago` : 'a while ago';
}

function tegnSynkMaerke() {
  const el = document.getElementById('synkLabel');
  if (!el) return;
  el.textContent = nedtraek.koerer ? 'fetching…' : opfriskAlder();
  const knap = document.getElementById('synkBtn');
  if (knap) knap.classList.toggle('koerer', nedtraek.koerer);
}

/*
 * Hvert halve minut. Tallet skal ikke vaere praecist - det skal bare ikke
 * staa og lyve om, at det var »just now« for ti minutter siden.
 */
setInterval(tegnSynkMaerke, 30000);

function opfriskHvisFremme() {
  if (!state.user || document.visibilityState !== 'visible') return;
  if (state.offline) return;
  if (Date.now() - sidstOpfrisket < 30000) return;
  // Skriver man lige nu, roeres skaermen ikke. `opfriskAlt` passer paa selve
  // teksten, men en optegning under haenderne er stadig en afbrydelse.
  if (typeof editor === 'object' && editor.aabenBlok !== null) return;
  opfriskAlt(true);
}

document.addEventListener('visibilitychange', opfriskHvisFremme);
window.addEventListener('pageshow', (e) => { if (e.persisted) opfriskHvisFremme(); });

/* ---- p13_koe.js ---- */
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

/* ---- p14_klip.js ---- */
/*
 * F18 - »Save to Sagu«: bogmærket, der gemmer en side som en note.
 *
 * ── Hvad Andreas bad om ───────────────────────────────────────────────────
 *
 * »Kan du lave et javascript som jeg kan gemme direkte i sagu på samme måde
 * som ServiceNowMarkdown. Det skal lægges som et punkt under indstillinger så
 * det er let at finde. man skal også kunne vælge projekt og evt tag«
 * (2026-08-21). »Projekt« er en **notesbog** i Sagu.
 *
 * ── Bogmærket er skrevet som en RIGTIG funktion ───────────────────────────
 *
 * `klipFunktion` herunder er almindelig, læsbar kode, og bogmærket bygges af
 * dens egen `toString()`. Alternativet - en streng med kode i - kan ikke
 * læses, ikke `node --check`'es og ikke rettes uden at tælle
 * anførselstegn. Build'et minificerer ikke, så det, man læser her, er præcis
 * det, der havner i bogmærket.
 *
 * ── Nøglen er `capture`, og det er ikke en detalje ────────────────────────
 *
 * Et bogmærke ligger i klartekst i browserens bogmærkeliste og bliver
 * synkroniseret rundt. Nøglen i det skal derfor være den svageste, der kan
 * gøre arbejdet: `capture` kan lægge noget NYT ind og læse **ingenting**.
 * Mister man maskinen, kan bogmærket ikke bruges til at hente arkivet ud.
 * Derfor laver ruden altid en `capture`-nøgle - man kan ikke vælge en bredere.
 *
 * ── Og hvorfor det er ét kald til `/api/v1/capture` ───────────────────────
 *
 * Ingen ny rute, intet nyt format. Bogmærket er bare endnu en klient til det
 * API, iPhone-genvejene allerede bruger (F9) - så er der ét sted, der tager
 * imod tekst, og én scope-tabel, der afgør hvad den må.
 */

/**
 * Selve bogmærket. Kører på en FREMMED side og må ikke antage noget om den.
 *
 * Alt, den har brug for, kommer i `k`: adressen, nøglen, notesbogen og
 * mærket. Ingen globale variabler fra Sagu findes derovre.
 */
function klipFunktion(k) {
  var d = document;

  /* Markeringen, hvis der er en - ellers sidens hovedindhold. Det man har
     streget under, er det man mente. */
  var valg = window.getSelection();
  var rod = null;
  if (valg && !valg.isCollapsed && String(valg).trim().length > 2) {
    rod = d.createElement('div');
    for (var i = 0; i < valg.rangeCount; i++) rod.appendChild(valg.getRangeAt(i).cloneContents());
  } else {
    rod = d.querySelector('article') || d.querySelector('main') || d.body;
  }

  var UD = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, IFRAME: 1, SVG: 1, NAV: 1, FOOTER: 1, FORM: 1 };
  var linjer = [];

  function tekst(n) {
    var s = '';
    for (var i = 0; i < n.childNodes.length; i++) {
      var b = n.childNodes[i];
      if (b.nodeType === 3) s += b.nodeValue;
      else if (b.nodeType === 1 && !UD[b.tagName]) {
        var t = b.tagName;
        if (t === 'BR') s += ' ';
        else if (t === 'CODE') s += '`' + tekst(b) + '`';
        else if (t === 'STRONG' || t === 'B') s += '**' + tekst(b) + '**';
        else if (t === 'EM' || t === 'I') s += '*' + tekst(b) + '*';
        else if (t === 'A' && b.getAttribute('href')) {
          var h = b.href || b.getAttribute('href');
          var inde = tekst(b).trim();
          s += inde ? '[' + inde + '](' + h + ')' : h;
        } else s += tekst(b);
      }
    }
    return s.replace(/[ \t ]+/g, ' ');
  }

  function skriv(s) {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    if (s) linjer.push(s);
  }

  function gaa(n, dybde) {
    if (dybde > 40) return;
    for (var i = 0; i < n.childNodes.length; i++) {
      var b = n.childNodes[i];
      if (b.nodeType === 3) { skriv(b.nodeValue); continue; }
      if (b.nodeType !== 1 || UD[b.tagName]) continue;
      var t = b.tagName;
      if (/^H[1-6]$/.test(t)) skriv(new Array(Number(t[1]) + 1).join('#') + ' ' + tekst(b));
      else if (t === 'P') skriv(tekst(b));
      /* En LISTE er ÉN blok. Skrev man hvert punkt for sig med en tom linje
         imellem, blev en nummereret liste til fem lister, der hver begyndte
         paa 1 - maalt paa en rigtig side. */
      else if (t === 'UL' || t === 'OL') linjer.push(liste(b, t === 'OL', ''));
      else if (t === 'BLOCKQUOTE') skriv('> ' + tekst(b));
      else if (t === 'PRE') linjer.push('```\n' + (b.textContent || '').trim() + '\n```');
      else if (t === 'HR') linjer.push('---');
      /* Og en TABEL er ÉN blok med en skillelinje under foerste raekke -
         ellers er det slet ikke en tabel, men en raekke loese streger. */
      else if (t === 'TABLE') { var tb = tabel(b); if (tb) linjer.push(tb); }
      else gaa(b, dybde + 1);
    }
  }

  function liste(n, nummereret, indryk) {
    var ud = [];
    var nr = 1;
    for (var i = 0; i < n.children.length; i++) {
      var li = n.children[i];
      if (li.tagName !== 'LI') continue;
      /* Underlister tages for sig og rykkes ind - saa overlever et
         hierarki turen, i stedet for at blive fladet ud. */
      var under = [];
      for (var j = 0; j < li.children.length; j++) {
        var u = li.children[j];
        if (u.tagName === 'UL' || u.tagName === 'OL') { under.push(u); u.remove(); }
      }
      var linje = indryk + (nummereret ? (nr++) + '. ' : '- ') + tekst(li).trim();
      if (linje.trim() !== indryk.trim() + (nummereret ? '.' : '-')) ud.push(linje);
      for (var m = 0; m < under.length; m++) {
        ud.push(liste(under[m], under[m].tagName === 'OL', indryk + '  '));
      }
    }
    return ud.join('\n');
  }

  function tabel(n) {
    var raekker = n.querySelectorAll('tr');
    if (!raekker.length) return '';
    var ud = [];
    for (var i = 0; i < raekker.length; i++) {
      var celler = [];
      var c = raekker[i].children;
      for (var j = 0; j < c.length; j++) celler.push(tekst(c[j]).replace(/\|/g, '\\|').trim());
      if (!celler.length) continue;
      ud.push('| ' + celler.join(' | ') + ' |');
      if (ud.length === 1) ud.push('|' + new Array(celler.length + 1).join(' --- |'));
    }
    return ud.length > 1 ? ud.join('\n') : '';
  }

  gaa(rod, 0);

  var titel = (d.title || location.hostname).replace(/\s+/g, ' ').trim().slice(0, 180);
  /* Mærket skal stå i FØRSTE linje - det er dér, capture læser det (F9). */
  var foerste = titel + (k.tag ? ' #' + k.tag : '');
  var krop = linjer.join('\n\n').slice(0, 100000);
  var tekstUd = foerste + '\n\n[' + titel + '](' + location.href + ')\n\n' + krop;

  var adr = k.base + '/api/v1/capture';
  if (k.notesbog) adr += '?notebook=' + encodeURIComponent(k.notesbog);

  fetch(adr, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8', Authorization: 'Bearer ' + k.noegle },
    body: tekstUd,
  }).then(function (r) {
    return r.json().catch(function () { return {}; });
  }).then(function (svar) {
    if (svar && svar.note) sig('Saved to Sagu');
    else sig((svar && svar.message) || 'Sagu said no — check the key');
  }).catch(function () {
    sig('Could not reach Sagu');
  });

  /* Et svar man kan SE. En knap, der gør noget usynligt, prøver man igen. */
  function sig(besked) {
    var e = d.createElement('div');
    e.textContent = besked;
    e.style.cssText = 'position:fixed;z-index:2147483647;top:16px;right:16px;padding:10px 14px;'
      + 'border-radius:8px;background:#1c1a17;color:#e8e2d8;font:14px/1.3 system-ui,sans-serif;'
      + 'box-shadow:0 8px 24px rgba(0,0,0,.4)';
    d.body.appendChild(e);
    setTimeout(function () { e.remove(); }, 2600);
  }
}

/**
 * Bogmærkets adresse, bygget af funktionen selv.
 *
 * `encodeURIComponent` om det hele: en bogmærke-URL må ikke indeholde `"`
 * eller mellemrum i visse browsere, og koden her er fuld af begge dele.
 */
function byggKlip(konfig) {
  const kode = `(${klipFunktion.toString()})(${JSON.stringify(konfig)})`;
  return `javascript:${encodeURIComponent(kode)}`;
}

/* ---- p1_core.js ---- */
'use strict';
/* Sagu - kerne: opstart, tema, login, app-skal.
   Denne fil samles til public/app.js af build_rune.py. Redigér aldrig app.js.

   NB: interfacet er ENGELSK - som doda, og ogsaa den ramme, kollegaerne ser
   i wikien. Koden, kommentarerne og dokumenterne er dansk. */

const APP_VERSION = 50;

/* Mobilgraensen bor to steder: her og i style.css. Holdes de ikke i trit,
   folder menuknappen sidebaren sammen paa en iPad, hvor CSS'en tror, den er
   en overlay (RUNE-ERFARINGER §4). */
const SMAL_SKAERM = 900;
const smalSkaerm = () => window.matchMedia(`(max-width: ${SMAL_SKAERM}px)`).matches;

const state = {
  user: null,
  config: { appName: 'Sagu', needsSetup: false, allowRegistration: false, secureContext: false },
  // Appen starter i soegefeltet. Det er dét, man vil, naar man aabner et
  // arkiv: finde noget. Andreas' oenske, 2026-08-20.
  view: 'search',
  notebooks: [],
  tree: [],
  tags: [],
  counts: {},
  notes: [],
  publicUrl: '',
  today: '',
  prefs: {},
  // F14: viser vi noget, der kom fra offline-cachen?
  offline: false,
  // Login-skaermen kan staa i to tilstande: log ind eller opret konto.
  gateMode: 'login',
};

/* ------------------------------------------------------------ hjaelpere */

// crypto.randomUUID() findes KUN i secure contexts. Panelet tilgaas paa
// IP:port over http, hvor alt der opretter id'er ellers doer stille
// (RUNE-ERFARINGER §4).
function nyId() {
  if (window.crypto && crypto.randomUUID && window.isSecureContext) return crypto.randomUUID();
  const b = new Uint8Array(16);
  if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.random() * 256 | 0;
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Plukker `#maerke` ud af en tekst, man er ved at SKRIVE.
 *
 * Familiens vane: i doda og tovo saetter man et maerke ved at skrive `#navn`
 * dér, hvor man skriver. ÉN definition, brugt af baade notens titel og
 * soegefeltets oprettelse - to steder med hver sin regel ville betyde, at
 * feltet lover noget, den anden vej ikke holder (RUNE-ERFARINGER, doda F1).
 *
 * To regler, som begge er noedvendige:
 *  - Markoeren skal staa ved linjestart eller efter et MELLEMRUM, ellers
 *    bliver `https://dr.dk/nyheder#sport` til et maerke.
 *  - Maerket skal klaebe direkte til tegnet (`#drift`, ikke `# drift`), og saa
 *    er der intet at trimme - det var dér, den gamle fejl kom fra: man
 *    trimmede vaerdien og maalte laengden paa den utrimmede.
 */
function plukMaerker(raa) {
  // Reglen bor i `app/shared/maerker.js`, saa serveren og browseren tolker
  // `#maerke` ENS. Wrapperen bliver staaende, saa kaldstederne er uroerte.
  return saguMaerker.pluk(raa);
}

/**
 * Brugernavnet, som det skal SES - med stort begyndelsesbogstav.
 *
 * Reglen bor i det delte modul, fordi den ogsaa skal gaelde de sider,
 * SERVEREN tegner (samtykkesiden og wikiens kommentarer). Kun til visning:
 * den gemte vaerdi, alt der sammenlignes, og alt der sendes til serveren
 * skal blive ved med at vaere det, brugeren tastede.
 */
function pentBruger(navn) {
  return saguMarkdown.pentBrugernavn(navn);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Goer URL'er og [tekst](url) klikbare.
 *
 * Teksten escapes FOERST, og der matches derefter kun paa http(s). Det er med
 * vilje: `javascript:` og `data:` maa aldrig kunne slippe igennem fra en
 * Notion-import, et API-kald eller en MCP-klient. Den rigtige markdown-
 * renderer i F1 bygger ovenpaa netop denne funktion - saa der findes ingen vej
 * fra brugerens tekst til et tag, vi ikke selv har skrevet.
 */
function linkify(tekst) {
  let ud = esc(tekst);
  ud = ud.replace(/\[([^\]\n]{1,120})\]\((https?:\/\/[^)\s]{1,500})\)/g,
    (_, navn, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${navn}</a>`);
  ud = ud.replace(/(^|[\s(])(https?:\/\/[^\s<]{1,500})/g, (helt, foer, url) => {
    // Slutpunktum og lukkeparentes hoerer til saetningen, ikke til adressen.
    const hale = url.match(/[.,;:!?)]+$/);
    const ren = hale ? url.slice(0, -hale[0].length) : url;
    const vis = ren.replace(/^https?:\/\//, '').slice(0, 60);
    return `${foer}<a href="${ren}" target="_blank" rel="noopener noreferrer">${vis}</a>${hale ? hale[0] : ''}`;
  });
  return ud;
}

async function api(method, path, body) {
  const opts = { method, credentials: 'same-origin' };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
    // Saet headers EFTER en evt. merge - en shallow merge har foer slettet
    // Authorization, fordi hele header-objektet blev erstattet.
    opts.headers = { 'Content-Type': 'application/json' };
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    // Browserens egen tekst er ubrugelig for et menneske: Safari siger
    // "Load failed", Chrome "Failed to fetch". Oversaettelsen hoerer hjemme
    // HER - ét sted - og ikke i hvert kaldssted.
    //
    // Ingen `status`: koden andetsteds skelner netvaerksbrud fra afslag
    // netop paa den.
    /*
     * Et fejlet kald ER offline, set fra appen.
     *
     * `navigator.onLine` kender kun netkortet - den er sand, naar man haenger
     * paa et wifi uden internet, eller naar serveren er nede. Baandet sagde
     * derfor »Sending 1 change…«, mens ingenting blev sendt. **Det, der
     * afgoer, om vi er offline, er om vi kan naa serveren** - ikke hvad
     * browseren mener om ledningen (F15).
     */
    saetOffline(true);
    throw Object.assign(
      new Error('No connection — this needs the network. Try again when you are back.'),
      { offline: true });
  }
  /*
   * Kom svaret fra offline-cachen, skal det SIGES.
   *
   * Service workeren saetter headeren, naar den serverer noget gammelt, fordi
   * netvaerket ikke svarede. En app, der viser gamle tal uden at sige det, er
   * vaerre end en, der siger »her er intet«: man traeffer beslutninger paa
   * noget, man tror er nyt (F14).
   */
  /*
   * Kom svaret fra serveren, er vi online igen - ogsaa selv om ingen
   * `online`-haendelse er kommet. Kom det fra cachen, er vi ikke.
   */
  saetOffline(res.headers.get('X-Sagu-Offline') === '1');

  let data = {};
  try { data = await res.json(); } catch { /* tomt svar er i orden */ }
  // API'et svarer {error: kode, message: laesbar tekst}. Mennesket skal se
  // beskeden; koden er til klienter.
  if (!res.ok) {
    /*
     * `needsCode` foelger MED fejlen.
     *
     * Fladen skal kunne skelne to 401'ere fra hinanden: et forkert kodeord
     * (fold kodefeltet vaek) og en forkert engangskode (lad det staa). Uden
     * feltet her ville et fejltastet ciffer se ud som et forkert kodeord, og
     * man ville taste det hele forfra (RUNE-ERFARINGER §9d).
     */
    throw Object.assign(new Error(data.message || data.error || `Error ${res.status}`),
      { status: res.status, code: data.error, needsCode: !!data.needsCode });
  }
  return data;
}

function toast(besked, handling) {
  const host = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(besked)}</span>`;
  if (handling) {
    const knap = document.createElement('button');
    knap.className = 'toast-action';
    knap.textContent = handling.label;
    knap.addEventListener('click', () => { el.remove(); handling.run(); });
    el.appendChild(knap);
  }
  host.appendChild(el);
  setTimeout(() => el.remove(), handling ? 8000 : 3200);
}

/* --------------------------------------------------------------- tema */

function anvendTema(valg) {
  if (valg === 'light' || valg === 'dark') document.documentElement.setAttribute('data-theme', valg);
  else document.documentElement.removeAttribute('data-theme');
  try { localStorage.setItem('sagu_theme', valg); } catch { /* privat tilstand */ }
}

function nuvaerendeTema() {
  try { return localStorage.getItem('sagu_theme') || 'auto'; } catch { return 'auto'; }
}

/* Det tema, man rent faktisk SER. "Follow system" er ikke en tredje farve -
   den er lys eller moerk, afhaengigt af maskinen, og knappen i sidebaren skal
   vise vejen til den modsatte af det, oejet ser.

   Temaet bliver med vilje i localStorage og ikke i settings: det skal laeses
   FOER foerste paint, og der er intet netvaerk. Lyst/moerkt er desuden et valg
   pr. skaerm (RUNE-ERFARINGER, tovo v11). */
function visuelTema() {
  const valg = nuvaerendeTema();
  if (valg === 'light' || valg === 'dark') return valg;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/* -------------------------------------------------------------- ikoner */

const ICONS = {
  logo: '<path d="M6 4.5h8.5L19 9v10.5H6z"/><path d="M14 4.5V9h5"/><path d="M9 12.5h7M9 15.5h4"/>',
  notes: '<path d="M6 4.5h8.5L19 9v10.5H6z"/><path d="M14 4.5V9h5"/><path d="M9 12.5h7M9 15.5h4"/>',
  book: '<path d="M5 5.5A1.5 1.5 0 016.5 4H18v16H6.5A1.5 1.5 0 015 18.5z"/><path d="M9 4v16"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
  tag: '<path d="M4 11.5V5a1 1 0 011-1h6.5l8 8-7.5 7.5z"/><circle cx="8" cy="8" r="1.2"/>',
  shared: '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5"/><path d="M16 6.5a3 3 0 010 6M17.5 19c-.3-1.8-1-3.2-2-4.2"/>',
  trash: '<path d="M5 7h14"/><path d="M9 7V5.5A1.5 1.5 0 0110.5 4h3A1.5 1.5 0 0115 5.5V7"/><path d="M6.5 7l.8 11.6A1.5 1.5 0 008.8 20h6.4a1.5 1.5 0 001.5-1.4L17.5 7"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M18 6l-1.4 1.4M7.4 16.6L6 18M18 18l-1.4-1.4M7.4 7.4L6 6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  // F16: markér en linje -> en opgave i doda.
  tjek: '<path d="M20 6.5L9.5 17 4 11.5"/>',
  pin: '<path d="M9 3.5h6l-1 5 3 3.5H7l3-3.5z"/><path d="M12 12v8.5"/>',
  out: '<path d="M14.5 4.5H18a1.5 1.5 0 011.5 1.5v12a1.5 1.5 0 01-1.5 1.5h-3.5"/><path d="M4.5 12h10M11 8.5l3.5 3.5-3.5 3.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M17.8 6.2l-1.4 1.4M7.6 16.4l-1.4 1.4M17.8 17.8l-1.4-1.4M7.6 7.6L6.2 6.2"/>',
  moon: '<path d="M20 14.6A8.6 8.6 0 019.4 4 8.6 8.6 0 1020 14.6z"/>',
  key: '<circle cx="8" cy="12" r="3.5"/><path d="M11.5 12H20M17 12v3M20 12v2.5"/>',
  caret: '<path d="M9 6l6 6-6 6"/>',
  // Tilbage. En venstre-pil med skaft - `ind` er et INDRYKNINGS-ikon og siger
  // »goer til underside«, ikke »tilbage«.
  tilbage: '<path d="M10.5 5.5L4 12l6.5 6.5"/><path d="M4 12h15"/>',
  focus: '<path d="M4 9V5.5A1.5 1.5 0 015.5 4H9"/><path d="M15 4h3.5A1.5 1.5 0 0120 5.5V9"/><path d="M20 15v3.5a1.5 1.5 0 01-1.5 1.5H15"/><path d="M9 20H5.5A1.5 1.5 0 014 18.5V15"/>',
  dots: '<circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/>',
  comment: '<path d="M20 12.5a6.5 6.5 0 01-6.5 6.5H9l-4 2.5v-4A6.5 6.5 0 016.5 6h7A6.5 6.5 0 0120 12.5z"/>',
  copy: '<path d="M9 9h10v10a1.5 1.5 0 01-1.5 1.5H9z"/><path d="M15 9V4.5A1.5 1.5 0 0013.5 3H5.5A1.5 1.5 0 004 4.5v9A1.5 1.5 0 005.5 15H9"/>',
  luk: '<path d="M6 6l12 12M18 6L6 18"/>',
  kalender: '<path d="M4.5 6.5h15v13h-15z"/><path d="M4.5 10h15M9 4.5v3M15 4.5v3"/>',
  skabelon: '<path d="M4.5 5.5h15v13h-15z"/><path d="M4.5 9.5h15M9.5 9.5v9"/>',
  klips: '<path d="M17 8.5l-6.6 6.6a2.5 2.5 0 003.5 3.5l6.6-6.6a4.5 4.5 0 00-6.4-6.4l-6.6 6.6a6.5 6.5 0 009.2 9.2l5.8-5.8"/>',
  // F12. Tegnet er GitHubs kat, forenklet til den samme stregtykkelse som
  // resten - et fremmed logo hentet fra et CDN ville baade bryde CSP'en og
  // se ud som et fremmedlegeme.
  github: '<path d="M9.5 20.5c-4 1.2-4-2.2-5.5-2.7m11 5.2v-3.4c0-1 .1-1.4-.5-2 2.6-.3 5-1.3 5-5.6a4.3 4.3 0 00-1.2-3 4 4 0 00-.1-3s-1-.3-3.2 1.2a11 11 0 00-5.8 0C7 5.7 6 6 6 6a4 4 0 00-.1 3 4.3 4.3 0 00-1.2 3c0 4.3 2.4 5.3 5 5.6-.6.6-.6 1.2-.5 2v3.4"/>',
  opfrisk: '<path d="M20 12a8 8 0 11-2.3-5.7"/><path d="M20 4v4.5h-4.5"/>',
  laas: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5"/>',
  stjerne: '<path d="M12 3.8l2.5 5.1 5.6.8-4 4 .9 5.6-5-2.6-5 2.6.9-5.6-4-4 5.6-.8z"/>',
  tastatur: '<rect x="3" y="6.5" width="18" height="11" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M17 10h.01M7 14h10"/>',
  offline: '<path d="M3 3l18 18"/><path d="M8.5 16.5a5 5 0 017 0"/><path d="M5 13a10 10 0 013.5-2.3M19 13a10 10 0 00-6.5-2.9"/><path d="M2 9.5A15 15 0 016 7M22 9.5a15 15 0 00-8.5-3.4"/>',
  stjerneFuld: '<path fill="currentColor" d="M12 3.8l2.5 5.1 5.6.8-4 4 .9 5.6-5-2.6-5 2.6.9-5.6-4-4 5.6-.8z"/>',
  import: '<path d="M12 3.5v11M8.5 11L12 14.5 15.5 11"/><path d="M4.5 15.5v3a1.5 1.5 0 001.5 1.5h12a1.5 1.5 0 001.5-1.5v-3"/>',
  ind: '<path d="M4 6.5h16M9 12h11M9 17.5h11"/><path d="M4 10l2.5 2L4 14"/>',
  fold: '<path d="M8 9l4-4 4 4"/><path d="M8 15l4 4 4-4"/>',
  udfold: '<path d="M8 5l4 4 4-4"/><path d="M8 19l4-4 4 4"/>',
  globe: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16"/><path d="M12 4a12 12 0 010 16 12 12 0 010-16z"/>',
  // Et vindue med en pil, der forlader det - ikke `out`, som allerede
  // betyder »flyt ud« i den samme menu. To punkter med samme ikon i én
  // menu er to punkter, man skal laese for at skelne.
  vindue: '<path d="M13 4.5H6A1.5 1.5 0 004.5 6v12A1.5 1.5 0 006 19.5h12a1.5 1.5 0 001.5-1.5v-7"/><path d="M13.5 10.5l6-6"/><path d="M15 4.5h4.5V9"/>',
};

function icon(name, size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

/* ------------------------------------------------------------- sider */

/* Raekkefoelgen her er ogsaa sidebarens. group: 0 = staar IKKE i navigationen;
   Settings naas fra menuen paa brugerknappen, hvor kontoen i forvejen bor. */
const VIEWS = [
  { id: 'notes', label: 'All Notes', icon: 'notes', group: 1, tael: 'notes' },
  { id: 'search', label: 'Search', icon: 'search', group: 1 },
  { id: 'tags', label: 'Tags', icon: 'tag', group: 2 },
  { id: 'comments', label: 'Comments', icon: 'comment', group: 2, tael: 'pendingComments' },
  { id: 'shared', label: 'Shared with me', icon: 'shared', group: 2, tael: 'shared' },
  { id: 'trash', label: 'Trash', icon: 'trash', group: 3, tael: 'trash' },
  // group: 0 = staar IKKE i navigationen. Import og eksport er noget, man goer
  // et par gange i en apps levetid - den hoerer i brugermenuen ved siden af
  // Settings, ikke i den daglige liste (Andreas, 2026-08-21).
  { id: 'import', label: 'Import & export', icon: 'import', group: 0 },
  { id: 'settings', label: 'Settings', icon: 'settings', group: 0 },
  // group: 0 - naas fra Settings, hvor noeglerne bor. En opskrift hoerer
  // ved siden af det, den handler om.
  { id: 'api', label: 'API & Shortcuts', icon: 'settings', group: 0 },
  // group: 0 = staar IKKE i navigationen. En note naas fra traeet; uden en
  // valgt note er der ingenting at gaa ind til.
  { id: 'note', label: 'Note', icon: 'notes', group: 0 },
];

const viewById = (id) => VIEWS.find((v) => v.id === id) || VIEWS[0];

/*
 * Skaermene, der bor bag BRUGERKNAPPEN.
 *
 * De staar ikke i navigationen, saa brugerknappen skal markeres, mens man er
 * paa dem - ellers lyser INTET i menuen, og man kan ikke se, hvor man er
 * (RUNE-ERFARINGER §9c).
 */
const BAG_BRUGEREN = new Set(['settings', 'import', 'api']);

const BESKRIVELSER = {
  notes: 'Everything you have written, newest first.',
  search: 'Search titles, headings, body text, tags and properties.',
  tags: 'Your tags, and what is filed under each.',
  comments: 'What people wrote on your notes — and what is waiting to be read.',
  shared: 'Notes other people have shared with you.',
  trash: 'Deleted notes. They are removed for good after 30 days.',
  import: 'Bring your Notion archive in, and take everything out again whenever you like.',
  settings: 'Appearance, account and access.',
  api: 'How to reach Sagu from an iPhone shortcut, or from another program.',
};

/* ------------------------------------------------------------ optegning */

/** Fuld optegning. Kun ved login/logout - ellers mister felter fokus. */
function render() {
  const root = document.getElementById('root');
  if (!state.user) { root.innerHTML = gateHtml(); bindGate(); return; }
  root.innerHTML = shellHtml();
  bindShell();
  tegnSide();
}

/* --------------------------------------------------------------- gate */

function gateHtml() {
  const setup = state.config.needsSetup;
  const opretter = setup || state.gateMode === 'register';
  return `
  <div class="gate">
    <div class="card">
      <div class="brand">${icon('logo', 26)} ${esc(state.config.appName || 'Sagu')}</div>
      <p class="lead" style="text-align:center;margin-bottom:22px">
        ${setup ? 'Pick a username and a password, and you are in.'
    : opretter ? 'Create your account.' : 'Sign in to continue.'}
      </p>
      <p class="gate-error" id="gateError" hidden></p>
      <form id="gateForm">
        <label class="field"><span>Username</span>
          <input class="input" id="gateUser" autocomplete="username" autocapitalize="none" required></label>
        <label class="field"><span>Password</span>
          <input class="input" id="gatePass" type="password"
            autocomplete="${opretter ? 'new-password' : 'current-password'}" required></label>
        <label class="field" id="gateKodeFelt" ${state.gateKode ? '' : 'hidden'}>
          <span>Code from your authenticator app</span>
          <input class="input" id="gateKode" inputmode="numeric" autocomplete="one-time-code"
            autocapitalize="characters" placeholder="123456" spellcheck="false"></label>
        <button class="btn primary" type="submit" style="width:100%">
          ${opretter ? 'Create account' : 'Sign in'}</button>
      </form>
      ${!opretter && state.config.passkeys && state.config.hasPasskeys ? `
        <div class="gate-or"><span>or</span></div>
        <button class="btn" id="gatePasskey" style="width:100%">Sign in with a passkey</button>` : ''}
      ${setup ? '<p class="gate-note">The first account is the administrator. It decides whether anyone else may sign up.</p>' : ''}
      ${!setup && state.config.allowRegistration ? `
        <p class="gate-switch">${opretter ? 'Already have an account?' : 'No account yet?'}
          <button type="button" id="gateSwitch">${opretter ? 'Sign in' : 'Create one'}</button></p>` : ''}
    </div>
  </div>`;
}

function bindGate() {
  const form = document.getElementById('gateForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('gateError');
    err.hidden = true;
    const opretter = state.config.needsSetup || state.gateMode === 'register';
    try {
      const krop = {
        username: document.getElementById('gateUser').value,
        password: document.getElementById('gatePass').value,
      };
      // Feltet sendes kun med, naar det ER fremme. Ellers ville en tom kode
      // blive et forsoeg, og serveren braendte et vindue for ingenting.
      const kodeFelt = document.getElementById('gateKode');
      if (state.gateKode && kodeFelt && kodeFelt.value.trim()) krop.code = kodeFelt.value.trim();
      const data = await api('POST', opretter ? '/api/register' : '/api/login', krop);

      /*
       * Kodeordet passede, men vi er kun halvvejs.
       *
       * Svaret er 200 og BAERER INGEN cookie - der staar bare, at der mangler
       * et led. Feltet foldes ud, og der staar en besked; en tom formular,
       * der bare ikke gjorde noget, ville se ud som en fejl.
       */
      if (data && data.needsCode) {
        /*
         * Feltet VISES - formularen tegnes ikke om.
         *
         * Foerste udgave kaldte `render()`, og saa blev baade brugernavn og
         * kodeord ryddet i samme oejeblik: man tastede sin kode og sendte en
         * TOM formular, hvorpaa serveren svarede »Wrong username or
         * password«. Det saa ud, som om kodeordet var forkert - og det var
         * det, man lige havde skrevet rigtigt (maalt i browseren,
         * 2026-08-24).
         *
         * Feltet staar der i forvejen, bare skjult. Der er intet at tegne.
         */
        state.gateKode = true;
        const boks = document.getElementById('gateKodeFelt');
        if (boks) boks.hidden = false;
        const felt = document.getElementById('gateKode');
        if (felt) felt.focus();
        const besked = document.getElementById('gateError');
        besked.textContent = 'Enter the six-digit code from your authenticator app '
          + '— or one of your recovery codes.';
        besked.hidden = false;
        besked.classList.add('gate-info');
        return;
      }
      state.gateKode = false;
      state.user = data.user;
      state.config.needsSetup = false;
      if (fortsaetTilConnector()) return;
      await hentState();
      render();
    } catch (ex) {
      /*
       * Kodefeltet bliver staaende ved en forkert ENGANGSKODE og foldes vaek
       * ved et forkert kodeord. Det er hele grunden til, at serveren svarer
       * forskelligt paa de to.
       */
      // Samme grund: fold feltet vaek uden at roere det, der er tastet.
      if (state.gateKode && !ex.needsCode) {
        state.gateKode = false;
        const boks = document.getElementById('gateKodeFelt');
        if (boks) boks.hidden = true;
      }
      const boks = document.getElementById('gateError');
      boks.textContent = ex.message;
      boks.classList.remove('gate-info');
      boks.hidden = false;
      const felt = document.getElementById('gateKode');
      if (felt && ex.needsCode) { felt.value = ''; felt.focus(); }
    }
  });

  const skift = document.getElementById('gateSwitch');
  if (skift) {
    skift.addEventListener('click', () => {
      state.gateMode = state.gateMode === 'register' ? 'login' : 'register';
      render();
    });
  }

  const pkBtn = document.getElementById('gatePasskey');
  if (pkBtn) {
    pkBtn.addEventListener('click', async () => {
      const err = document.getElementById('gateError');
      err.hidden = true;
      try {
        const d = await loginMedPasskey();
        state.user = d.user;
        // Ogsaa her: begge veje ind skal kunne fortsaette til samtykkesiden,
        // ellers virker connectoren kun for den, der taster sit kodeord.
        if (fortsaetTilConnector()) return;
        await hentState();
        render();
      } catch (ex) {
        // Brugeren afbroed selv - det er ikke en fejl, der skal vises.
        if (ex.name === 'NotAllowedError') return;
        err.textContent = ex.message || 'The passkey did not work';
        err.hidden = false;
      }
    });
  }

  document.getElementById('gateUser').focus();
}

/* --------------------------------------------------------------- skal */

function navHtml() {
  const iNav = VIEWS.filter((v) => v.group > 0);
  const grupper = [...new Set(iNav.map((v) => v.group))];
  return grupper.map((g) => `<nav class="nav">${iNav.filter((v) => v.group === g).map((v) => {
    const antal = v.tael ? (state.counts[v.tael] || 0) : 0;
    return `<button class="nav-item" data-view="${v.id}" ${v.id === state.view ? 'aria-current="page"' : ''}>
        ${icon(v.icon)}<span>${esc(v.label)}</span>
        ${antal ? `<span class="nav-count">${antal}</span>` : ''}
      </button>`;
  }).join('')}</nav>`).join('');
}

/*
 * ── Menuknappen staar i BJAELKEN, ikke i skaermens hjoerne ────────────────
 *
 * Den var `position: fixed` med et hoejere lag end topbjaelken. Da bjaelken
 * blev klaebende (v23), laa knappen dermed OVEN PAA soegefeltet, saa snart man
 * rullede - to ting, der begge vil vaere oeverst, og kun den ene kan vinde
 * (Andreas, 2026-08-24).
 *
 * Inde i raekken er der ingen strid om pladsen: bjaelken er ét element, der
 * klaeber, og knappen foelger med af sig selv. Samme sted som i doda.
 *
 * Derfor kan `body.navskjult .main { padding-left: 64px }` ogsaa forsvinde -
 * den fandtes kun for at holde plads fri til en knap, der svaevede.
 *
 * ── Og hvorfor feltet har sin egen indpakning ─────────────────────────────
 *
 * `omniHtml()` giver BAADE soegekortet og maerke-chipsene, og chipsene hoerer
 * UNDER kortet - ikke ved siden af det. Uden `.topraekke-felt` blev de et
 * flex-element nummer to i raekken, raekkens `gap` slog til, og soegefeltet
 * blev ti pixel smallere end indholdet nedenunder. Maalt, da Andreas spurgte
 * hvorfor bredderne ikke passede (2026-08-25).
 */
function shellHtml() {
  return `
  <div class="backdrop" id="backdrop"></div>
  <div class="app">
    <aside class="sidebar">
      <div class="brand">${icon('logo', 24)} <span style="flex:1;min-width:0">${esc(state.config.appName || 'Sagu')}</span>
        <button class="pinbtn" id="pinBtn" aria-label="Hide the menu"
          title="Hide the menu">${icon('pin', 16)}</button></div>
      <div id="navHost">${navHtml()}</div>
      <!-- Fyldes af tegnGenveje() i bindShell, praecis som traeet nedenfor. -->
      <div id="navGenveje"></div>
      <div id="treeHost" class="treehost"></div>
      <div class="sidebar-foot">
        <button class="nav-item" id="userBtn"
          ${BAG_BRUGEREN.has(state.view) ? 'aria-current="page"' : ''}>${icon('settings')}<span>${esc(pentBruger(state.user.username))}</span></button>
        <div class="foot-row" id="footRow">${versionHtml()}</div>
      </div>
    </aside>
    <main class="main">
      <div class="opdater-baand" id="opdaterBaand" hidden>
        ${icon('opfrisk', 15)}
        <span class="baand-tekst"></span>
        <button class="btn" id="opdaterNu">Update</button>
      </div>
      <div class="offline-baand" id="offlineBaand" hidden>
        ${icon('offline', 15)}
        <span class="baand-tekst">Offline — showing what was loaded last.</span>
      </div>
      <div class="topbar">
        <div class="toprow">
          <button class="synkbtn meta" id="synkBtn" title="Fetch new notes now"
            aria-label="Fetch new notes now">${icon('opfrisk', 14)}<span id="synkLabel">just now</span></button>
          <div class="stats meta" id="statsHost">${statsHtml()}</div>
          ${temaKnapHtml()}
        </div>
        <div class="topraekke">
          <button class="btn navtoggle" id="navToggle" aria-label="Menu">${icon('menu')}</button>
          <div class="topraekke-felt">${omniHtml()}</div>
        </div>
      </div>
      <div id="pageHost"></div>
    </main>
  </div>
  <nav class="toc" id="tocRail" aria-label="On this page" hidden></nav>`;
}

/*
 * Versionen, altid synlig. Det er SAMME tal som runens version: i panelet -
 * build_rune.py stempler APP_VERSION i index.html og i runen paa én gang.
 *
 * Serveren melder sit eget tal i /api/public-config. Er de to forskellige, er
 * app.js i browserens cache aeldre end den, serveren udleverer - og saa er det
 * DET, brugeren skal vide, ikke versionsnummeret alene.
 */
/* En rolig linje over feltet: hvor meget staar der egentlig. */
function statsHtml() {
  const c = state.counts || {};
  const dele = [];
  // »1 notes« stod der foer. Et tal og et ord, der ikke passer sammen, er
  // smaat - men det er ogsaa det foerste, oejet falder paa i toppen.
  const stk = (n, ental, flertal) => `${n} ${n === 1 ? ental : flertal}`;
  if (c.notes) dele.push(stk(c.notes, 'note', 'notes'));
  if ((state.notebooks || []).length) {
    dele.push(stk(state.notebooks.length, 'notebook', 'notebooks'));
  }
  if (c.archived) dele.push(`${c.archived} archived`);
  if (c.trash) dele.push(`${c.trash} in trash`);
  return dele.map((d) => `<span>${esc(d)}</span>`).join('');
}

/*
 * Kun NYERE taeller som en opdatering.
 *
 * Sammenligningen var `!==`, og den er forkert i den ene retning: er
 * serverens tal LAVERE end det, browseren koerer - en rullet udgivelse, eller
 * en serverproces, der ikke er genstartet - saa staar der »v5 is ready, you
 * are running v6«, og det er noget vaas. Maalt i udvikling, hvor netop det
 * skete (2026-08-21).
 */
function versionHtml() {
  const server = state.config.version;
  const gammel = server && server > APP_VERSION;
  if (gammel) {
    return `<button class="version-line meta version-old" id="versionBtn"
      title="Your browser is running v${APP_VERSION}, but the server has v${server}. Click to reload.">
      v${APP_VERSION} · v${server} available — reload</button>`;
  }
  return `<div class="version-line meta">v${esc(String(APP_VERSION))}</div>`;
}

/* Ét klik mellem lyst og moerkt. Knappen viser det tema, man skifter TIL -
   ikke det, man er i. Alle tre valg bliver staaende under Settings. */
function temaKnapHtml() {
  const naeste = visuelTema() === 'dark' ? 'light' : 'dark';
  return `<button class="temabtn" id="temaBtn" data-naeste="${naeste}"
    aria-label="Switch to ${naeste} theme" title="Switch to ${naeste} theme">
    ${icon(naeste === 'dark' ? 'moon' : 'sun', 16)}</button>`;
}

function opdaterTemaKnap() {
  const gammel = document.getElementById('temaBtn');
  if (!gammel) return;
  gammel.outerHTML = temaKnapHtml();
  bindTemaKnap();
  // Er man PAA indstillingssiden, skal de tre knapper der ogsaa foelge med.
  if (state.view === 'settings') tegnSide();
}

function bindTemaKnap() {
  const el = document.getElementById('temaBtn');
  if (!el) return;
  el.addEventListener('click', () => { anvendTema(el.dataset.naeste); opdaterTemaKnap(); });
}

function bindNav() {
  document.querySelectorAll('.nav-item[data-view]').forEach((el) => {
    el.addEventListener('click', () => gaaTil(el.dataset.view));
  });
}

function bindShell() {
  bindNav();
  registrerRullevagt();
  bindTemaKnap();
  const synk = document.getElementById('synkBtn');
  if (synk) synk.addEventListener('click', () => opfriskAlt());

  bindOmni();
  tegnLegend();
  /*
   * Favoritter og spor tegnes HER - ikke i `shellHtml()`.
   *
   * De stod som markup inde i skallen, men blev kun BUNDET af
   * `tegnGenveje()`. Efter en fuld optegning - altsaa hver sideindlaesning -
   * havde punkterne under »Recent« og »Favourites« derfor ingen klik-handler:
   * de saa rigtige ud og gjorde ingenting, indtil noget andet tilfaeldigvis
   * kaldte `tegnGenveje()` (Andreas, 2026-08-21).
   *
   * Kuren er ikke et kald mere ved siden af det foerste - det ville vaere
   * det samme problem én linje senere. **Ét sted tegner OG binder**, praecis
   * som `tegnTrae()` under her. Saa kan de to ikke skilles ad igen.
   */
  tegnGenveje();
  tegnTrae();
  document.getElementById('userBtn').addEventListener('click', visBrugerMenu);
  saetNavSkjult(navErSkjult());

  document.getElementById('pinBtn').addEventListener('click', () => {
    const skjul = !document.body.classList.contains('navskjult');
    saetNavSkjult(skjul);
    // Foldes den vaek, mens man staar i den, skal overlayet ogsaa lukke.
    if (skjul) document.body.classList.remove('navopen');
  });

  // Er serverens version nyere end den indlaeste, sidder der en gammel app.js
  // i cachen. Ryd den FOER genindlaesningen - ellers serveres den samme fil.
  const vBtn = document.getElementById('versionBtn');
  if (vBtn) vBtn.addEventListener('click', () => hentNyVersion());
  const opdKnap = document.getElementById('opdaterNu');
  if (opdKnap) opdKnap.addEventListener('click', () => hentNyVersion());
  visOpdaterBaand();

  document.getElementById('navToggle').addEventListener('click',
    () => document.body.classList.toggle('navopen'));
  document.getElementById('backdrop').addEventListener('click',
    () => document.body.classList.remove('navopen'));
}

/*
 * At gaa til en skaerm betyder at se den REN.
 *
 * Laa nulstillingen bag `if (state.view !== view)`, ville en aaben note goere
 * skaermen til en blindgyde: man staar allerede paa 'notes', saa hverken
 * sidebaren eller en tilbage-knap gjorde noget (RUNE-ERFARINGER, doda v32).
 * Et filter er noget, man VAELGER - ikke noget, man arver.
 */
/* ------------------------------------------------------ tilbage (F26)
 *
 * »Kan du lave en back knap. hvis man fx klikker paa et link i en note som
 * goer at man bliver sendt til en anden note, men gerne vil retur igen?«
 * (Andreas, 2026-09-01).
 *
 * ── Hvorfor et EGET spor og ikke browserens historik ──────────────────────
 *
 * v42 valgte med vilje `replaceState` frem for `pushState`, saa browserens
 * tilbage-knap ikke gaar gennem hver eneste note, man har kigget paa - en
 * note aabnes ad mindst seks veje, og flere af dem taenker man ikke paa som
 * en navigation.
 *
 * Det valg staar ved magt. Men et eget spor kan noget, browserens ikke kan:
 * det ved, HVAD man gaar tilbage til, og kan skrive det paa knappen. »Back to
 * Pakke stoerrelser« er et loefte; en pil er et gaet.
 *
 * ── Naar der IKKE huskes ─────────────────────────────────────────────────
 *
 * Ved en opfriskning af den note, man allerede staar paa (`tving`), og ved en
 * tilbage-tur selv. Uden det ville sporet vokse ved hver
 * traek-ned-for-at-opfriske, og tilbage-knappen ville vippe mellem to noter i
 * stedet for at gaa hjem.
 */
const tilbagespor = [];
const TILBAGE_LOFT = 50;
let gaarTilbage = false;

/** Navnet paa det, man ville komme tilbage TIL. */
function sporNavn(post) {
  if (post.note) return post.titel || 'the note';
  const v = (typeof VIEWS !== 'undefined' ? VIEWS : []).find((x) => x.id === post.view);
  return (v && v.label) || 'back';
}

/**
 * Laeg det, man staar paa NU, i sporet.
 *
 * Kaldes FOER `state` aendres - ellers husker den det sted, man er paa vej
 * hen, og knappen bliver en genindlaesning.
 */
function husk() {
  if (gaarTilbage || !state.user) return;
  const post = {
    view: state.view,
    note: state.openNote || null,
    tag: state.filterTag || null,
    notebook: state.openNotebook || null,
    titel: (typeof editor === 'object' && editor.note && editor.note.id === state.openNote)
      ? editor.note.title : '',
  };
  const sidste = tilbagespor[tilbagespor.length - 1];
  // Samme sted to gange i traek er ikke to skridt.
  if (sidste && sidste.view === post.view && sidste.note === post.note
      && sidste.tag === post.tag && sidste.notebook === post.notebook) return;
  tilbagespor.push(post);
  if (tilbagespor.length > TILBAGE_LOFT) tilbagespor.shift();
}

function kanGaaTilbage() {
  return tilbagespor.length > 0;
}

/**
 * Ét skridt tilbage.
 *
 * `gaarTilbage` er den vagt, der goer det til et SKRIDT og ikke en vippen:
 * uden den ville turen tilbage selv blive husket, og knappen ville sende én
 * frem igen.
 */
function gaaTilbage() {
  const post = tilbagespor.pop();
  if (!post) return;
  gaarTilbage = true;
  try {
    if (post.note) {
      aabnNote(post.note);
    } else {
      gaaTil(post.view, { tag: post.tag, notebook: post.notebook });
    }
  } finally {
    /*
     * Vagten slaas fra i naeste tur om loekken, ikke med det samme.
     *
     * `aabnNote` er asynkron: den saetter `state` med det samme, men naar
     * foerst frem til optegningen bagefter. Ryddede vi flaget her, ville den
     * optegning kunne naa at huske det sted, vi lige forlod.
     */
    setTimeout(() => { gaarTilbage = false; }, 0);
  }
}

function gaaTil(view, opt) {
  // En ventende gemning maa ikke gaa tabt, fordi man klikker i sidebaren.
  if (typeof gemNu === 'function') gemNu();
  const skifter = state.view !== view;
  // Husk hvor vi stod - FOER `state` aendres.
  if (skifter || state.openNote) husk();
  const havdeFilter = !!(state.openNote || state.filterTag || state.openNotebook);
  state.view = view;
  state.openNote = null;
  state.filterTag = null;
  state.openNotebook = null;
  if (typeof editor === 'object') { editor.note = null; editor.aabenBlok = null; }
  document.body.classList.remove('fokus');
  if (opt && opt.tag !== undefined) state.filterTag = opt.tag;
  if (opt && opt.notebook !== undefined) state.openNotebook = opt.notebook;
  document.body.classList.remove('navopen');
  /*
   * Adressen ryddes, naar man forlader noten.
   *
   * Ellers ville »gaa til Search og opfrisk« kaste én tilbage til den note,
   * man lige forlod - altsaa den samme fejl som foer, bare med modsat
   * fortegn. Adressen skal sige, hvad man ser.
   */
  if (typeof saetAdresse === 'function') saetAdresse(null);
  opdaterNav();
  tegnSide();
  // Scroll kun til toppen ved reelt sideskift - ellers kastes brugeren op,
  // hver gang en inline-redigering gentegner (RUNE-ERFARINGER §4).
  if (skifter || havdeFilter) tilToppen();
}

/**
 * Til toppen - uanset HVEM der ruller.
 *
 * ── Hvorfor der staar tre linjer og ikke én ───────────────────────────────
 *
 * Her stod `window.scrollTo(0, 0)`, og paa en telefon gjorde den INGENTING.
 * Maalt paa 375 px: rullet til 800, `window.scrollTo(0, 0)`, og
 * `document.body.scrollTop` staar stadig paa 800. Skiftede man side, landede
 * man midt i den nye.
 *
 * Grunden er `@media (max-width: 900px) { html, body { overflow-x: hidden } }`
 * sammen med `html, body { height: 100% }`: naar den ene akse ikke er
 * `visible`, beregnes den anden til `auto`, og saa er det BODY, der er
 * rulleboksen. Paa en bred skaerm er det stadig dokumentet. Maalt:
 * `getComputedStyle(document.body).overflowY === 'auto'` under 900 px.
 *
 * Vi saetter derfor alle tre i stedet for at gaette. Det er samme greb som
 * `heltOppe()` i F19 - bare den anden vej.
 *
 * ── Og hvorfor den staar her, ikke inde i `gaaTil` ────────────────────────
 *
 * En kollega-session fandt fejlen ved at lede efter faelden ét sted mere, end
 * jeg selv gjorde: jeg skrev erkendelsen ned i en kommentar i F19 og rettede
 * kun dét ene sted. **En erkendelse, der kun bliver til en kommentar, er ikke
 * en rettelse.** Naeste gang nogen skal rulle et sted hen, findes funktionen
 * nu - saa der ikke er noget at gaette om.
 */
function tilToppen() {
  window.scrollTo(0, 0);
  document.body.scrollTop = 0;
  document.documentElement.scrollTop = 0;
}

function opdaterNav() {
  const host = document.getElementById('navHost');
  if (host) { host.innerHTML = navHtml(); bindNav(); }
  const stats = document.getElementById('statsHost');
  if (stats) stats.innerHTML = statsHtml();
  // Settings staar ikke i navigationen - brugerknappen er indgangen, og saa
  // skal den ogsaa vise, naar man er der. Ellers er INTET markeret.
  const bruger = document.getElementById('userBtn');
  if (bruger) {
    if (BAG_BRUGEREN.has(state.view)) bruger.setAttribute('aria-current', 'page');
    else bruger.removeAttribute('aria-current');
  }
}

/** Henter state og gentegner NAV og SIDE, men aldrig hele skallen. */
async function genindlaes() {
  await hentState();
  if (typeof foelgImport === 'function') foelgImport();
  opdaterNav();
  await tegnSide();
}

async function hentState() {
  try {
    const d = await api('GET', '/api/v1/state');
    state.notebooks = d.notebooks || [];
    // Traeet hentes i sit EGET kald, saa en note-optegning kan opfriske det
    // uden ogsaa at hente taellere og maerker.
    await hentTrae();
    await hentSeneste();
    state.tags = d.tags || [];
    state.storage = d.storage || {};
    state.counts = d.counts || {};
    state.today = d.today || '';
    // Personlige valg om, hvordan fladen opfoerer sig. De skal vaere kendt
    // FOER foerste optegning - ellers tegnes den foerste note med den ene
    // editor og hopper til den anden et oejeblik efter.
    state.prefs = d.prefs || {};
    // Tom betyder "brug den vaert, browseren staar paa" - se offentligBase().
    state.publicUrl = d.publicUrl || '';
  } catch (ex) {
    if (ex.status !== 401) toast(ex.message);
  }
}

/* ------------------------------------------------------ sidebaren */

/*
 * Sidebaren kan foldes helt vaek, saa der kun staar en hamburger tilbage.
 * Skjult ligger den som et OVERLAY over indholdet i stedet for at skubbe det -
 * ellers hopper hele siden, hver gang man kigger i menuen (§9c).
 *
 * Valget bliver i localStorage med vilje: det afhaenger af skaermens bredde og
 * hoerer derfor til ENHEDEN, ikke til brugeren (RUNE-ERFARINGER, tovo v11).
 */
function navErSkjult() {
  try { return localStorage.getItem('sagu_nav_skjult') === '1'; } catch { return false; }
}

function saetNavSkjult(skjult) {
  try { localStorage.setItem('sagu_nav_skjult', skjult ? '1' : '0'); } catch { /* privat */ }
  document.body.classList.toggle('navskjult', skjult);
  if (!skjult) document.body.classList.remove('navopen');
  // Brugermenuen haenger i sidebarens fod. Foldes sidebaren vaek, mens menuen
  // staar aaben, ville den blive svaevende tilbage over ingenting.
  const menu = document.getElementById('userMenu');
  if (menu) menu.remove();
  const knap = document.getElementById('pinBtn');
  if (knap) {
    const tekst = skjult ? 'Keep the menu open' : 'Hide the menu';
    knap.setAttribute('aria-label', tekst);
    knap.title = tekst;
    knap.classList.toggle('off', skjult);
  }
}

/* --------------------------------------------------- brugermenuen */

/*
 * Menuen HAENGER i sidebarens fod og placeres af CSS (position:absolute i en
 * position:relative fod). Ikke af et getBoundingClientRect() paa
 * klik-tidspunktet: paa mobil glider sidebaren stadig ind, naar man maaler,
 * og menuen lander uden for skaermen (RUNE-ERFARINGER, Beanledger v29).
 *
 * Arver du komponenten, saa arv BEGGE halvdele - CSS'en alene giver en menu,
 * der ser rigtig ud i kilden og er usynlig paa skaermen (tools v2).
 */
function visBrugerMenu() {
  const gammel = document.getElementById('userMenu');
  if (gammel) { gammel.remove(); return; }
  const fod = document.querySelector('.sidebar-foot');
  const anker = document.getElementById('userBtn');
  if (!fod || !anker) return;

  const host = document.createElement('div');
  host.className = 'usermenu';
  host.id = 'userMenu';
  /*
   * Genvejsoversigten staar HER, fordi en genvej, man ikke kan FINDE, ikke
   * findes (RUNE-ERFARINGER, tovo v8). Spoergsmaalstegnet er den eneste vej
   * ind i listen, og det kan man kun taste, hvis man ved, det er der.
   */
  host.innerHTML = `
    <div class="usermenu-head">
      <div class="usermenu-name">${esc(pentBruger(state.user.username))}</div>
      <div class="meta">${state.user.isAdmin ? 'Administrator' : 'Signed in'}${state.config.secureContext ? '' : ' · plain http'}</div>
    </div>
    <button class="usermenu-item" data-go="import">${icon('import', 17)}<span>Import &amp; export</span></button>
    <button class="usermenu-item" data-go="settings">${icon('settings', 17)}<span>Settings</span></button>
    <button class="usermenu-item" data-go="genveje">${icon('tastatur', 17)}<span>Keyboard shortcuts</span>
      <kbd style="margin-left:auto">?</kbd></button>
    <button class="usermenu-item danger" data-go="logout">${icon('out', 17)}<span>Log out</span></button>`;
  fod.appendChild(host);

  const luk = () => host.remove();
  host.querySelectorAll('[data-go]').forEach((el) => {
    el.addEventListener('click', async () => {
      const hvad = el.dataset.go;
      luk();
      if (hvad === 'genveje') { visGenvejsPanel(); return; }
      if (hvad === 'settings' || hvad === 'import') { gaaTil(hvad); return; }
      /*
       * Ryd offline-cachen FOER logout-kaldet.
       *
       * En cache overlever en session. Uden det her ville en telefon, man
       * har logget ud af, stadig kunne vise noterne fra sidste gang - og det
       * er en helt anden aftale end den, »log ud« giver indtryk af (F14).
       */
      ryddOffline();
      ryddKoe();
      await api('POST', '/api/logout', {});
      state.user = null;
      state.gateMode = 'login';
      render();
    });
  });
  // Ét klik udenfor lukker igen. setTimeout, saa klikket der AABNEDE menuen
  // ikke lukker den med det samme.
  setTimeout(() => {
    document.addEventListener('click', function udenfor(e) {
      if (host.isConnected && !host.contains(e.target) && e.target !== anker && !anker.contains(e.target)) {
        luk();
        document.removeEventListener('click', udenfor);
      }
    });
  }, 0);
}

/* --------------------------------------------------- sideoversigten */

/*
 * §9b fra RUNE-ERFARINGER, ordret. En stak streger i hoejre kant, én pr.
 * afsnit, som folder sig ud paa hover. Det er praecis den funktion, Andreas
 * bad om (krav 8), og den koster ingenting, fordi opskriften allerede findes.
 *
 * Den bor i <body>, ikke i #pageHost: alt derinde skiftes ud ved hver
 * optegning, og saa ville oversigten forsvinde.
 */
const tocState = { punkter: [], aktiv: -1 };

function byggToc() {
  const rail = document.getElementById('tocRail');
  if (!rail) return;
  const host = document.getElementById('pageHost');
  // I en note er det notens egne overskrifter, oversigten skal vise - baade
  // h2 og h3, saa et langt dokument kan navigeres.
  const vaelger = state.view === 'note' ? '.note-body h2, .note-body h3' : 'h2';
  const fundne = host ? [...host.querySelectorAll(vaelger)] : [];

  // Under to afsnit er der ingen oversigt at lave, og paa en telefon ville en
  // fast stribe i hoejre side ligge oven i indholdet.
  if (fundne.length < 2 || smalSkaerm()) {
    rail.hidden = true;
    rail.innerHTML = '';
    tocState.punkter = [];
    return;
  }

  tocState.punkter = fundne.map((el, i) => {
    if (!el.id) el.id = `afsnit-${i}`;
    const taeller = el.querySelector('.group-count');
    const navn = (taeller ? el.textContent.replace(taeller.textContent, '') : el.textContent).trim();
    return { el, navn: navn || `Section ${i + 1}` };
  });
  tocState.aktiv = -1;

  rail.innerHTML = tocState.punkter.map((p, i) => `
    <button class="toc-item" data-toc="${i}" title="${esc(p.navn)}">
      <span class="toc-dash"></span><span class="toc-tekst">${esc(p.navn)}</span>
    </button>`).join('');
  rail.hidden = false;

  rail.querySelectorAll('[data-toc]').forEach((el) => {
    el.addEventListener('click', () => {
      const p = tocState.punkter[Number(el.dataset.toc)];
      if (p) p.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
  markerToc();
}

/** Afsnittet, der lige er rullet forbi toppen, er det man er i. */
function markerToc() {
  if (!tocState.punkter.length) return;
  let i = 0;
  for (let n = 0; n < tocState.punkter.length; n++) {
    if (tocState.punkter[n].el.getBoundingClientRect().top <= 140) i = n;
  }
  if (i === tocState.aktiv) return;
  tocState.aktiv = i;
  const rail = document.getElementById('tocRail');
  if (!rail) return;
  rail.querySelectorAll('[data-toc]').forEach((el) => {
    el.classList.toggle('on', Number(el.dataset.toc) === i);
  });
}

// Én rAF pr. rulning: ellers laeses layout hundredvis af gange i sekundet.
let tocVenter = false;
window.addEventListener('scroll', () => {
  if (tocVenter || !tocState.punkter.length) return;
  tocVenter = true;
  requestAnimationFrame(() => { tocVenter = false; markerToc(); });
}, { passive: true });

window.addEventListener('resize', () => { byggToc(); });

/* --------------------------------------------- ny version (F17) */

/*
 * »Der er kommet en ny version.«
 *
 * Versionslinjen i sidebarens fod har kunnet sige det siden F0 - men paa en
 * telefon staar foden BAG hamburgeren, saa man ser den aldrig. Beskeden hoerer
 * dér, hvor man er.
 *
 * Tallet kommer fra serveren (`/api/public-config`), og `APP_VERSION` er
 * bagt ind i den app.js, browseren koerer. Er de forskellige, sidder der en
 * gammel fil i cachen - og saa er DET, brugeren skal vide, ikke
 * versionsnummeret alene.
 */
function visOpdaterBaand() {
  const b = document.getElementById('opdaterBaand');
  if (!b) return;
  const server = state.config.version;
  // Kun NYERE - se versionHtml(). En aeldre server er ikke en opdatering.
  const ny = server && server > APP_VERSION;
  b.hidden = !ny;
  if (!ny) return;
  const t = b.querySelector('.baand-tekst');
  if (t) {
    t.innerHTML = `<strong>Sagu v${esc(String(server))} is ready.</strong> `
      + `You are running v${esc(String(APP_VERSION))}. Updating reloads the app and `
      + 'fetches your notes again.';
  }
}

/**
 * Spoerger serveren, om der er kommet noget nyt.
 *
 * Kaldes naar fanen kommer FREM igen - det er dét oejeblik, en telefon vender
 * tilbage til appen efter en opdatering paa serveren. Uden det ville beskeden
 * foerst dukke op ved naeste genindlaesning, og saa er den overfloedig.
 *
 * Fejler kaldet, sker der ingenting: man er formentlig offline, og saa er en
 * ny version det mindste af det.
 */
async function tjekVersion() {
  try {
    const c = await api('GET', '/api/public-config');
    state.config.version = c.version;
    visOpdaterBaand();
  } catch { /* offline - se F14's eget baand */ }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.user) tjekVersion();
});

/*
 * `body.rullet` - er siden rullet ned fra toppen?
 *
 * Den klaebende topbjaelke bruger den til at folde tallene og legenden
 * sammen, saa kun soegefeltet bliver staaende (F20).
 *
 * ── Den fejl, ÉN taerskel gav ─────────────────────────────────────────────
 *
 * Meldt fra doda-sessionen (2026-08-25): bjaelken flimrede ved rulning, »som
 * om den gaar i hak«. Aarsagen er, at sammenfoldningen SELV goer dokumentet
 * kortere. Er der mindre tilbage at rulle i end den hoejde, bjaelken giver
 * slip paa, klipper browseren rullepositionen til det, der er plads til -
 * toppen kommer i syne, klassen ryger af, bjaelken vokser, dokumentet bliver
 * laengere, man kan rulle igen. Frem og tilbage, mange gange i sekundet.
 *
 *     (dokumenthoejde - skaermhoejde) < det, bjaelken krymper
 *
 * MAALT i Sagu paa 1280x800: bjaelken krymper **70 px**, og en note paa fire
 * til seks korte afsnit har 0-56 px at rulle i, naar den er foldet.
 * Betingelsen holder altsaa. Den rammer KUN korte sider, og det er praecis
 * derfor den kan have staaet laenge uden at blive fanget.
 *
 * `rootMargin: -8px` var taenkt som hysterese, og det ER det - men 8 px er
 * langt mindre end de 70, bjaelken giver tilbage. Justeringen springer let
 * hen over dem.
 *
 * ── Kuren: to taerskler og et gulv ────────────────────────────────────────
 *
 * Afstanden mellem taersklerne skal vaere STOERRE end det, bjaelken krymper -
 * ellers kan justeringen naa ned under den nedre, og loekken er der igen.
 * 120 - 8 = 112 > 70.
 *
 * Og `RULLET_PLADS`: uden det ville bjaelken aldrig folde sig paa en kort
 * side, fordi man ikke KAN naa 120 px. Doda-sessionen faldt selv i den -
 * maalingen sagde »0 skift, ingen flimmer«, hvilket saa ud som en sejr, men
 * fejlen var fjernet ved at fjerne funktionen. Gulvet siger i stedet: fold
 * kun sammen, hvis der er rigeligt at rulle i.
 *
 * ── Hvorfor en scroll-lytter nu, naar v23 valgte den fra ──────────────────
 *
 * v23 skrev: »hvem ruller?« er en faelde, og en programmatisk rulning giver
 * NUL scroll-haendelser. Begge dele staar ved magt - jeg har maalt dem igen i
 * dag. Men de rammer PROEVEN, ikke brugeren: med et rigtigt hjul-scroll kom
 * der baade scroll-haendelser og observer-fyringer i den samme rude. Og »hvem
 * ruller« har vi siden faaet et svar paa i `heltOppe()`, som `rulletNed()`
 * genbruger.
 *
 * En `IntersectionObserver` paa en vagtpost kan kun ÉT skifte, og det er dét,
 * der ikke raekker: to taerskler kraever to tal at sammenligne med.
 *
 * Selve beslutningen ligger derfor i `skalVaereRullet()` - en REN funktion.
 * Hverken observeren eller lytteren kan drives programmatisk i et testmiljoe,
 * saa regnestykket er det eneste sted, fejlen kan fanges uden en finger paa
 * et hjul.
 */
const RULLET_TIL = 120;      // folder sammen her
const RULLET_FRA = 8;        // folder foerst ud igen her
const RULLET_PLADS = 200;    // og kun hvis der er saa meget at rulle i

/**
 * Hvor langt er der rullet? Max af de tre, der kan vaere rulleboksen.
 *
 * `window.scrollY` er ALTID 0, naar body er rulleboksen - og det er den under
 * 900 px, fordi `overflow-x: hidden` faar den anden akse til at blive `auto`.
 * Den fejl har kostet tre gange (traek-ned, op-til-toppen, og her).
 */
function rulletNed() {
  return Math.max(window.scrollY || 0,
    document.body.scrollTop || 0,
    document.documentElement.scrollTop || 0);
}

/** Hvor meget er der overhovedet at rulle i? */
function rullePlads() {
  return Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)
    - window.innerHeight;
}

/**
 * Skal bjaelken vaere foldet sammen?
 *
 * @param {boolean} rullet  staar den foldet lige nu?
 * @param {number} y        hvor langt der er rullet
 * @param {number} plads    hvor meget der er at rulle i
 */
function skalVaereRullet(rullet, y, plads) {
  if (!rullet) return y > RULLET_TIL && plads > RULLET_PLADS;
  return y >= RULLET_FRA;
}

function registrerRullevagt() {
  let rullet = document.body.classList.contains('rullet');
  const tjek = () => {
    const nu = skalVaereRullet(rullet, rulletNed(), rullePlads());
    if (nu === rullet) return;
    rullet = nu;
    document.body.classList.toggle('rullet', nu);
  };
  // Begge mulige rullebokse. Hvilken der er den rigtige, afhaenger af
  // skaermbredden, og det maa den her ikke skulle vide.
  window.addEventListener('scroll', tjek, { passive: true });
  document.body.addEventListener('scroll', tjek, { passive: true });
  /*
   * Ogsaa ved `resize`: `rullePlads()` afhaenger af skaermhoejden. Drejer man
   * en telefon, kan en side, der havde rigeligt at rulle i, pludselig ikke
   * have det - og saa skal bjaelken ud igen, uden at nogen har rullet.
   */
  window.addEventListener('resize', tjek, { passive: true });
  tjek();
}

/**
 * Henter den nye app.
 *
 * Cachen ryddes FOER genindlaesningen - baade fra siden og gennem service
 * workeren. Uden det serverer workeren bare den samme gamle `app.js` igen, og
 * knappen ville se ud, som om den ikke gjorde noget (RUNE-ERFARINGER §5).
 */
async function hentNyVersion() {
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage('ryd');
    }
    if (window.caches) await Promise.all((await caches.keys()).map((n) => caches.delete(n)));
    // Workeren selv skal ogsaa afloeses - ellers styrer den gamle stadig.
    if (navigator.serviceWorker) {
      for (const r of await navigator.serviceWorker.getRegistrations()) await r.update();
    }
  } catch { /* uden cache-api er der ikke noget at rydde */ }
  location.reload();
}

/* ------------------------------------------------------ offline (F14) */

/*
 * Service workeren registreres, saa noterne kan LAESES uden net.
 *
 * `./sw.js` uden en `?v=` med vilje: browseren sammenligner selve FILEN byte
 * for byte og opdaterer workeren, naar den er aendret. Et versionsnummer i
 * adressen ville lave en ny worker pr. udgivelse i stedet for at afloese den
 * gamle - og saa ville to workere slaas om den samme cache.
 *
 * Fejler registreringen, sker der ingenting. Offline er en TILGIFT; appen
 * skal virke praecis som foer uden den.
 */
function registrerOffline() {
  if (!('serviceWorker' in navigator)) return;
  // Kun over https (eller localhost). Panelet naas paa ren http, hvor en
  // service worker slet ikke findes - og en fejl i konsollen dér ville se ud
  // som om noget var i stykker.
  if (location.protocol !== 'https:' && location.hostname !== 'localhost'
      && location.hostname !== '127.0.0.1') return;
  navigator.serviceWorker.register('./sw.js').catch(() => { /* en tilgift */ });
}

/** Alt cachet indhold vaek. Kaldes ved log ud. */
function ryddOffline() {
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage('ryd');
    }
    if (window.caches) caches.keys().then((n) => n.forEach((x) => caches.delete(x)));
  } catch { /* ingen cache at rydde */ }
}

/**
 * Baandet, der siger det HOEJT.
 *
 * En app, der viser gamle tal uden at sige det, er vaerre end en, der siger
 * »her er intet«: man traeffer beslutninger paa noget, man tror er nyt. Derfor
 * saetter service workeren `X-Sagu-Offline` paa et svar fra cachen, og
 * `api()` taender baandet.
 */
function saetOffline(gammelt) {
  const nu = !!gammelt;
  if (state.offline === nu) return;
  const varOffline = state.offline;
  state.offline = nu;
  // Kommer vi tilbage, saa send det, der venter - uden at vente paa
  // browserens `online`-haendelse, som maaske aldrig kommer.
  if (varOffline && !nu && typeof synkKoe === 'function') synkKoe();
  // Baandets TEKST skrives ét sted (`visKoeBaand`), fordi den skal kunne sige
  // baade »offline« og »der venter tre rettelser« - og de to er den samme
  // besked set fra hver sin side.
  visKoeBaand();
}

window.addEventListener('online', () => {
  saetOffline(false);
  // Send det, der venter, FOER vi henter: ellers henter vi den gamle udgave
  // ned oven i den rettelse, der stod i koen (F15).
  synkKoe().then(() => {
    if (state.user) return hentState().then(() => tegnSide());
    return null;
  }).catch(() => {});
});
window.addEventListener('offline', () => saetOffline(true));

/* --------------------------------------------------------------- start */

/**
 * Adressen at vende tilbage til, naar man er logget ind.
 *
 * Serveren sender `?next=/oauth/authorize?...` hertil, naar en connector beder
 * om samtykke og der ingen session er. **KUN den ene sti accepteres** - alt
 * andet ville vaere en aaben viderestilling, og en connector-godkendelse er
 * praecis det sted, hvor man ikke skal kunne lokkes videre.
 */
function oauthNaeste() {
  try {
    const n = new URLSearchParams(location.search).get('next') || '';
    return n.startsWith('/oauth/authorize?') ? n : null;
  } catch { return null; }
}

/** Kaldes efter login. Returnerer true, hvis siden er paa vej et andet sted hen. */
function fortsaetTilConnector() {
  const n = oauthNaeste();
  if (!n) return false;
  location.replace(n);
  return true;
}

(async function start() {
  /*
   * FOER alt andet, og synkront: scriptet ligger sidst i `<body>`, saa
   * klassen naar at staa der, foer der tegnes noget. Saettes den foerst efter
   * `await api(...)`, naar sidebaren at blive vist og forsvinde igen.
   */
  if (soloVindue()) document.body.classList.add('solo');
  anvendTema(nuvaerendeTema());
  registrerOffline();
  try {
    state.config = await api('GET', '/api/public-config');
    document.title = state.config.appName || 'Sagu';
    const me = await api('GET', '/api/me');
    state.user = me.user;
    state.flereBrugere = !!me.flereBrugere;
    // Var jeg allerede logget ind, da connectoren sendte mig herhen, skal jeg
    // slet ikke se appen - kun samtykkesiden.
    if (state.user && fortsaetTilConnector()) return;
    if (state.user) await hentState();
    // Favoritter og spor hentes ÉN gang her - ikke ved hver optegning.
    if (state.user) await hentGenveje();
    /*
     * Koen laeses FOER foerste optegning, saa baandet kan sige det med det
     * samme - og sendes bagefter. Browseren kan vaere lukket, mens den var
     * offline, saa `online`-haendelsen kommer aldrig (F15).
     */
    if (state.user) { laesKoe(); }
  } catch (ex) {
    document.getElementById('root').innerHTML =
      `<div class="gate"><div class="card"><div class="brand">${icon('logo', 26)} Sagu</div>
       <p class="lead" style="text-align:center">Could not reach the server.<br>${esc(ex.message)}</p></div></div>`;
    return;
  }
  render();
  visKoeBaand();
  if (state.user && navigator.onLine) synkKoe(true);
  aabnFraAdressen();
  // Feltet skal have fokus ved opstart - man aabner et arkiv for at finde
  // noget. Ikke paa mobil: dér ville tastaturet daekke halve skaermen.
  if (state.user && state.view === 'search' && !smalSkaerm()) {
    const o = omniEl();
    if (o) o.focus();
  }
})();

/**
 * `#note-<id>` i adressen aabner den note.
 *
 * Saa kan et soegeresultat deles som et link, og en genindlaesning lander
 * samme sted i stedet for paa forsiden.
 */
function aabnFraAdressen() {
  if (!state.user) return;
  const m = String(location.hash || '').match(/^#note-([a-f0-9]{32})$/);
  if (m) aabnNote(m[1]);
}

window.addEventListener('hashchange', aabnFraAdressen);

/**
 * Er DET HER vindue en note, der er poppet ud i sit eget vindue? (F29)
 *
 * »Kan du lave en knap saa man kan poppe en note ud i sit eget vindue, saa
 * den er til at have ved siden af?« (Andreas, 2026-09-05).
 *
 * Flaget staar i `?solo=1` og ikke i fragmentet, af to grunde. Fragmentet er
 * NOTENS adresse (`#note-<id>`), og de to ting hoerer ikke sammen: vinduet
 * bliver ved med at vaere et sidevindue, ogsaa naar man foelger et link til
 * en anden note. Og `saetAdresse()` skriver `pathname + search + hash`, saa
 * en query overlever hver eneste adresseskrivning uden en linje ekstra.
 *
 * Service workeren gemmer skallen under './', naar `pathname` er '/' - og
 * det er den ogsaa her, for `?solo=1` ligger i `search`. Sidevinduet virker
 * derfor uden net paa noejagtig samme vilkaar som appen selv.
 */
function soloVindue() {
  try { return new URLSearchParams(location.search).get('solo') === '1'; }
  catch { return false; }
}

/**
 * Vinduets titel.
 *
 * I et almindeligt vindue er den appens navn. I et sidevindue er den NOTENS
 * navn - og det er ikke pynt: har man tre noter poppet ud, staar de i
 * operativsystemets vinduesliste og paa proceslinjen med hver sin titel, og
 * hedder de alle sammen »Sagu«, kan man ikke vaelge imellem dem. En funktion,
 * hvis formaal er at have noter ved siden af hinanden, skal kunne navngive
 * dem.
 */
function vinduestitel() {
  const app = state.config.appName || 'Sagu';
  const n = (typeof editor === 'object' && editor.note) ? String(editor.note.title || '').trim() : '';
  document.title = (soloVindue() && n) ? `${n} - ${app}` : app;
}

/**
 * Skriver adressen, saa den passer til det, man ser.
 *
 * »Er det muligt at lave at naar man laver en refresh paa en note at den saa
 * bliver paa noten i stedet for at hoppe til forsiden?« (Andreas,
 * 2026-09-01).
 *
 * Mekanikken til at LAESE `#note-<id>` har vaeret der siden F13, og
 * kommentaren ovenfor lovede endda, at »en genindlaesning lander samme sted«.
 * Den gjorde den bare aldrig: ingen skrev adressen, naar man aabnede en note
 * ved at KLIKKE. Adressen blev kun sat, hvis man kom udefra med et link.
 *
 * ── `replaceState` og ikke `location.hash = …` ────────────────────────────
 *
 * At saette `location.hash` fyrer `hashchange`, som kalder
 * `aabnFraAdressen()`, som kalder `aabnNote()` igen. Vagten mod »samme note«
 * fanger det som regel - men netop som regel: mens noten stadig HENTES, er
 * `editor.note` den forrige, og saa slipper kaldet igennem. En adresselinje
 * maa ikke kunne saette en hentning i gang.
 *
 * ── `replaceState` og ikke `pushState` ────────────────────────────────────
 *
 * `pushState` ville lade browserens tilbage-knap gaa gennem de noter, man har
 * kigget paa. Det lyder bedre end det er: en note aabnes ad mindst seks veje,
 * og flere af dem sker uden at man taenker paa det som en navigation. Her er
 * kun bedt om, at en OPFRISKNING lander samme sted - og det er `replaceState`
 * praecis.
 */
function saetAdresse(noteId) {
  const oensket = noteId ? `#note-${noteId}` : '';
  // Ingen skrivning, hvis den allerede staar rigtigt: en tom `replaceState`
  // pr. optegning er stoej i browserens historik-log.
  const nu = String(location.hash || '');
  if (nu === oensket) return;
  try {
    /*
     * `location.pathname + location.search` skal MED.
     *
     * Uden dem kaster Safari paa en `file:`- eller sandkasse-oprindelse, og
     * en tom streng ville i oevrigt rydde stien. Det er kun fragmentet, der
     * skal skiftes.
     */
    history.replaceState(null, '', `${location.pathname}${location.search}${oensket}`);
  } catch { /* uden history-api staar adressen bare stille */ }
}

/* ---- p2_pages.js ---- */
'use strict';
/* Sagu - siderne.
 *
 * Note-siden selv bor i p4_editor.js; her er listerne, soegningen,
 * papirkurven og indstillingerne.
 *
 * En skaerm, der endnu ikke er bygget, siger det AERLIGT med sit fasenummer
 * frem for at staa tom - en tom side ligner en fejl, ikke en plan. */

/** Kaldes ét sted, saa sideoversigten aldrig kan glemmes i en af grenene. */
async function tegnSide() {
  await tegnSideIndhold();
  byggToc();
  // Titlen hoerer til her af samme grund som sideoversigten: ét sted, saa den
  // ikke kan glemmes i en af de mange grene, der aabner en note (F29).
  vinduestitel();
}

/*
 * Spaltens bredde er den SAMME overalt (se style.css).
 *
 * Her stod `BREDE_SIDER` - en liste over de skaerme, der maatte vaere brede.
 * Den er vaek, fordi den var selve problemet: indholdet skiftede bredde fra
 * skaerm til skaerm, mens soegefeltet stod stille.
 *
 * Tilbage staar ét flag: en NOTE er prosa, og dens tekst holder sig i
 * laesebredden inde i den faelles spalte.
 */
async function tegnSideIndhold() {
  const host = document.getElementById('pageHost');
  if (!host) return;
  host.classList.toggle('note', state.view === 'note');
  const v = viewById(state.view);
  /*
   * »All Notes« skriver sin egen undertekst.
   *
   * `BESKRIVELSER` siger »newest first«, og det er sandt lige indtil man
   * sorterer paa en overskrift. En undertekst, der bliver staaende og lyve,
   * er vaerre end ingen undertekst - saa hellere lade siden sige, hvad den
   * FAKTISK viser.
   */
  const beskrivelse = state.view === 'notes' ? noteListeUndertekst() : (BESKRIVELSER[v.id] || '');
  const hoved = `<h1>${esc(v.label)}</h1><p class="lead">${esc(beskrivelse)}</p>`;

  try {
    if (state.view === 'note') {
      // Noten har sin egen overskrift (titelfeltet) - ingen h1 ovenover.
      host.innerHTML = sideNote();
      bindNoteSide();
      return;
    }
    if (state.view === 'settings') { host.innerHTML = hoved + await sideSettings(); bindSettings(); return; }
    // Soegesiden har sin EGEN overskrift; den generiske ville staa oven i den.
    if (state.view === 'search') { host.innerHTML = sideSoeg(); bindSoeg(); return; }
    if (state.view === 'trash') { host.innerHTML = hoved + await sideTrash(); bindTrash(); return; }
    if (state.view === 'shared') {
      host.innerHTML = hoved + await sideDelt();
      bindDelt();
      return;
    }
    if (state.view === 'tags') { host.innerHTML = hoved + sideTags(); bindTags(); return; }
    if (state.view === 'comments') {
      host.innerHTML = hoved + await sideKommentarer();
      bindKommentarSide();
      return;
    }
    if (state.view === 'import') { host.innerHTML = hoved + sideImport(); bindImport(); return; }
    if (state.view === 'api') { host.innerHTML = hoved + sideApi(); return; }
    host.innerHTML = hoved + await sideNoter({});
    bindNoteliste();
  } catch (ex) {
    host.innerHTML = `${hoved}<div class="card"><p class="lead">${esc(ex.message)}</p></div>`;
  }
}

/**
 * En skaerm, der endnu ikke er bygget, skal sige HVAD den bliver og HVORNAAR.
 *
 * En hjaelpetekst er en kravspecifikation (RUNE-ERFARINGER, doda v9/v38): den
 * maa ikke love noget, koden ikke kan. Derfor staar fasenummeret der - saa
 * ingen tror, de bruger appen forkert.
 */
function sideKommer(hvad, fase) {
  return `<div class="card empty">
    <h2>${esc(hvad)}</h2>
    <p class="meta saetning">Not built yet — this arrives in ${esc(fase)}.
    Nothing is hidden here; the screen simply does not exist yet.</p>
  </div>`;
}

/* ------------------------------------------------------------- noter */

/* ------------------------------------------------------------- sortering
 *
 * »Kan du gøre så man kan sortere på overskrifterne under All Notes«
 * (Andreas, 2026-08-22).
 *
 * ── Den sker HER, ikke på serveren ────────────────────────────────────────
 *
 * Listen er allerede hentet og ligger i `state.notes`. En omsortering er en
 * måde at se på det samme på — ikke en ny forespørgsel — og et kald pr. klik
 * på en overskrift ville koste en rundtur gennem tunnelen for at bytte om på
 * noget, browseren allerede har.
 *
 * ── Valget holder sessionen ud, men gemmes ikke ───────────────────────────
 *
 * Det ligger i `state`, så det overlever, at man går ind i en note og tilbage
 * igen. Det bliver IKKE gemt: standarden er »nyeste først«, og det er dét,
 * siden lover i sin egen undertekst. En sortering, der overlever en
 * genindlæsning uden at stå nogen steder, er en indstilling, man ikke ved man
 * har.
 *
 * Underteksten skifter med valget, så den aldrig kommer til at love noget
 * andet end det, listen viser.
 */
const SORTERINGER = {
  titel: {
    navn: 'Title',
    // `localeCompare` med dansk: æ, ø og å hører sidst, ikke midt i alfabetet.
    sammenlign: (a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'da',
      { sensitivity: 'base', numeric: true }),
    stigendeFoerst: true,
    tekst: (ned) => (ned ? 'by title, Z first.' : 'by title, A first.'),
  },
  maerker: {
    navn: 'Tags',
    /*
     * Sorteret paa det FOERSTE maerke. En note uden maerker ligger sidst,
     * uanset retning: »ingen maerker« er ikke en vaerdi, der hoerer i den ene
     * eller den anden ende - det er fravaeret af en, og det skal ikke skubbe
     * det, man leder efter, ned i bunden, naar man vender listen.
     */
    sammenlign: (a, b) => {
      const x = (a.tags || [])[0] || '';
      const y = (b.tags || [])[0] || '';
      if (!x && !y) return 0;
      if (!x) return 1;
      if (!y) return -1;
      return x.localeCompare(y, 'da', { sensitivity: 'base' });
    },
    tomSidst: true,
    stigendeFoerst: true,
    tekst: (ned) => (ned ? 'by tag, Z first — untagged last.' : 'by tag, A first — untagged last.'),
  },
  aendret: {
    navn: 'Updated',
    sammenlign: (a, b) => (a.updatedAt || 0) - (b.updatedAt || 0),
    stigendeFoerst: false,
    tekst: (ned) => (ned ? 'newest first.' : 'oldest first.'),
  },
};

const sortering = { felt: 'aendret', ned: true };

function sorterNoter(liste) {
  const s = SORTERINGER[sortering.felt];
  if (!s) return liste;
  const ud = liste.slice().sort((a, b) => {
    const r = s.sammenlign(a, b);
    if (r !== 0) return sortering.ned ? -r : r;
    // Uafgjort brydes ALTID paa samme maade, ellers hopper raekker rundt
    // mellem to optegninger af den samme liste.
    return String(a.id).localeCompare(String(b.id));
  });
  if (!s.tomSidst) return ud;
  // Notene UDEN vaerdi laegges bagest, uanset retning - se forklaringen ovenfor.
  const med = ud.filter((n) => (n.tags || []).length);
  const uden = ud.filter((n) => !(n.tags || []).length);
  return med.concat(uden);
}

/** Overskriften som en knap, med pilen der viser hvad der sker. */
function sorterTh(felt, ekstra) {
  const s = SORTERINGER[felt];
  const paa = sortering.felt === felt;
  const pil = paa ? (sortering.ned ? '↓' : '↑') : '';
  return `<th${ekstra || ''}><button class="sorterknap${paa ? ' paa' : ''}" data-sorter="${felt}"
    aria-label="Sort by ${esc(s.navn)}">${esc(s.navn)}<span class="sorterpil">${pil}</span></button></th>`;
}

/** Underteksten skal sige, hvad listen FAKTISK viser. */
function noteListeUndertekst() {
  const s = SORTERINGER[sortering.felt];
  return `Everything you have written, ${s.tekst(sortering.ned)}`;
}

async function sideNoter(opt) {
  const q = opt.trash ? '?trash=1' : '';
  const d = await api('GET', `/api/v1/notes${q}`);
  state.notes = d.notes;

  if (!d.notes.length) {
    return `<div class="card empty">
      <h2>${opt.trash ? 'The trash is empty' : 'No notes yet'}</h2>
      <p class="meta saetning">${opt.trash
    ? 'Deleted notes land here and are removed for good after 30 days.'
    : 'Notebooks and pages live in the sidebar. The Notion import arrives in F5.'}</p>
      ${opt.trash ? '' : '<div class="btnrow" style="justify-content:center;margin-top:16px">'
      + `<button class="btn primary" id="nyNote">${icon('plus', 16)} New note</button></div>`}
    </div>`;
  }

  return `${opt.trash ? '' : `<div class="btnrow" style="margin-bottom:16px">
      <button class="btn primary" id="nyNote">${icon('plus', 16)} New note</button>
    </div>`}
    <div class="card"><div class="tablewrap"><table class="data notetabel">
      <thead><tr>${sorterTh('titel')}${sorterTh('maerker')}${sorterTh('aendret', ' class="num"')}<th></th></tr></thead>
      <tbody>${sorterNoter(d.notes).map((n) => `<tr>
        <td><button class="linkknap" data-aabn="${esc(n.id)}">${esc(n.title || 'Untitled')}</button></td>
        <td><span class="chips">${n.tags.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</span></td>
        <td class="num">${esc(visTid(n.updatedAt))}</td>
        <td style="text-align:right;white-space:nowrap">
          ${opt.trash ? '' : `<button class="btn ghost" data-slet="${esc(n.id)}">Delete</button>`}</td>
      </tr>`).join('')}</tbody>
    </table></div></div>`;
}

function bindNoteliste() {
  document.querySelectorAll('[data-sorter]').forEach((el) => {
    el.addEventListener('click', () => {
      const felt = el.dataset.sorter;
      // Samme overskrift igen vender listen. En NY overskrift begynder med
      // den retning, folk mener med netop den: titler fra A, datoer fra
      // nyeste. Alt andet foeles som om knappen gjorde noget tilfaeldigt.
      if (sortering.felt === felt) sortering.ned = !sortering.ned;
      else { sortering.felt = felt; sortering.ned = !SORTERINGER[felt].stigendeFoerst; }
      tegnSide();
    });
  });
  const ny = document.getElementById('nyNote');
  if (ny) ny.addEventListener('click', () => opretOgAaben({}));
  document.querySelectorAll('[data-aabn]').forEach((el) => {
    el.addEventListener('click', () => aabnNote(el.dataset.aabn));
  });
  document.querySelectorAll('[data-slet]').forEach((el) => {
    el.addEventListener('click', async () => {
      try {
        await api('DELETE', `/api/v1/notes/${el.dataset.slet}`);
        toast('Moved to trash.');
        await genindlaes();
      } catch (ex) { toast(ex.message); }
    });
  });
}

function visTid(sek) {
  if (!sek) return '';
  const d = new Date(sek * 1000);
  const dage = Math.floor((Date.now() - sek * 1000) / 86400000);
  if (dage === 0) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (dage === 1) return 'yesterday';
  if (dage < 7) return `${dage} days ago`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ---------------------------------------------------------- papirkurv */

async function sideTrash() {
  const d = await api('GET', '/api/v1/notes?trash=1');
  state.notes = d.notes;
  if (!d.notes.length) {
    return `<div class="card empty"><h2>The trash is empty</h2>
      <p class="meta saetning">Deleted notes land here and are removed for good after 30 days.</p></div>`;
  }
  return `<div class="card"><div class="tablewrap"><table class="data">
      <thead><tr><th>Title</th><th class="num">Deleted</th><th></th></tr></thead>
      <tbody>${d.notes.map((n) => `<tr>
        <td>${esc(n.title || 'Untitled')}</td>
        <td class="num">${esc(visTid(n.updatedAt))}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn ghost" data-gendan="${esc(n.id)}">Restore</button></td>
      </tr>`).join('')}</tbody>
    </table></div></div>
    <p class="meta saetning" style="margin-top:12px">Restoring a page brings back exactly the
    subpages that were deleted with it — not ones you deleted on their own.</p>`;
}

function bindTrash() {
  document.querySelectorAll('[data-gendan]').forEach((el) => {
    el.addEventListener('click', async () => {
      try {
        const d = await api('POST', `/api/v1/notes/${el.dataset.gendan}/restore`, {});
        toast(d.restored > 1 ? `Restored with ${d.restored - 1} subpages.` : 'Restored.');
        await genindlaes();
        tegnTrae();
      } catch (ex) { toast(ex.message); }
    });
  });
}

/* ------------------------------------------------------------ soegning */

function sideSoeg() {
  const seneste = (omni.seneste || []).slice(0, 8);
  return `
    <div class="hjem">
      <h1>${esc(state.config.appName || 'Sagu')}</h1>
      <p class="lead">Search titles, headings, body text, tags and properties —
      or start a new note. Press <kbd>/</kbd> from anywhere.</p>
    </div>
    ${seneste.length ? `<h2>Recently changed</h2>
      <div class="card">${seneste.map((n) => `
        <button class="senest" data-aabn="${esc(n.id)}">
          <span>${esc(n.title || 'Untitled')}</span>
          <span class="meta">${esc(visTid(n.updatedAt))}</span></button>`).join('')}</div>` : ''}
    <h2>What the field understands</h2>
    <div class="card">
      <table class="data syntax">
        <tr><td><code>drif</code></td><td>partial words match — <code>drif</code> finds <em>drift</em></td></tr>
        <tr><td><code>gron</code></td><td>ø, æ and å fold — <code>gron</code> finds <em>grøn</em></td></tr>
        <tr><td><code>"two words"</code></td><td>that phrase, in that order</td></tr>
        <tr><td><code>-word</code></td><td>notes without it</td></tr>
        <tr><td><code>tag:drift</code></td><td>only notes with that tag</td></tr>
        <tr><td><code>in:Hjorten</code></td><td>only in that notebook, or under that page</td></tr>
        <tr><td><code>updated:&lt;30d</code></td><td>changed within 30 days (also <code>w</code>, <code>m</code>, <code>y</code>)</td></tr>
        <tr><td><code>has:code</code></td><td>also <code>image</code>, <code>link</code>, <code>todo</code>, <code>table</code></td></tr>
        <tr><td><code>* title</code></td><td>create a note with that title</td></tr>
        <tr><td><code>/ name</code></td><td>jump to a notebook</td></tr>
        <tr><td><code># name</code></td><td>filter by a tag</td></tr>
      </table>
      <p class="meta saetning" style="margin-top:12px">A word inside a word is found too:
      searching <code>inventory</code> finds a note that only says <code>keepInventory</code>.
      The index cannot see it, so the text is read instead — and the results are then
      unranked, which the field says out loud.</p>
    </div>`;
}

function bindSoeg() {
  // Selve feltet bor i topbaren og bindes af skallen. Her er kun listen over
  // de senest aendrede.
  document.querySelectorAll('.senest[data-aabn]').forEach((el) => {
    el.addEventListener('click', () => aabnNote(el.dataset.aabn));
  });
}

/**
 * FTS5's snippet() markerer traefferne med << og >>.
 *
 * Uddraget escapes FOERST og faar derefter sine markoerer byttet til <mark> -
 * samme raekkefoelge som linkify. Indholdet kan komme fra en Notion-import,
 * saa der maa ikke findes en vej fra notens tekst til et tag, vi ikke selv
 * har skrevet.
 */
function uddrag(raa) {
  return esc(raa || '').replace(/&lt;&lt;/g, '<mark>').replace(/&gt;&gt;/g, '</mark>');
}

/* --------------------------------------------------------------- tags */

/*
 * Maerkerne, og hvad der er filet under hvert.
 *
 * Den tomme tilstand SAGDE »Tags arrive in F3« længe efter, F3 var bygget -
 * og der fandtes ingen vej til at saette et maerke nogen steder. En
 * hjaelpetekst, der beskriver noget, appen ikke kan, er den dyreste slags
 * fejl: brugeren tror, han bruger appen forkert (RUNE-ERFARINGER, doda v38).
 * Nu siger den, HVOR man goer det.
 */
function sideTags() {
  const nyt = `<div class="btnrow" style="margin-top:14px">
      <input class="input" id="nytMaerke" placeholder="New tag name" style="max-width:220px"
        autocomplete="off" spellcheck="false">
      <button class="btn" id="opretMaerke">Create tag</button>
    </div>
    <p class="meta saetning" style="margin-top:10px">Three ways in, and they all end up the same
    place: here, <strong>+ tag</strong> under a note's title, or writing <code>#drift</code> in
    the title. A tag stays until you delete it, so you can lay out your structure first.</p>`;

  if (!state.tags.length) {
    return `<div class="card empty"><h2>No tags yet</h2>${nyt}</div>`;
  }
  return `<div class="card">
    <div class="chips">${state.tags.map((t) =>
    `<span class="chip maerke"><button class="chip-navn" data-maerke="${esc(t.name)}"
      >${esc(t.name)}</button><button class="chip-x" data-sletmaerke="${esc(t.id)}"
      data-navn="${esc(t.name)}" aria-label="Delete ${esc(t.name)}" title="Delete this tag">×</button></span>`).join('')}</div>
    <p class="meta saetning" style="margin-top:12px">Click a tag to see what is filed under it.</p>
    ${nyt}
  </div>`;
}

function bindTags() {
  document.querySelectorAll('[data-maerke]').forEach((el) => {
    // Feltet tolker `tag:navn` som et filter (F2), saa der er ÉN vej til det
    // samme resultat - klikket skriver bare linjen for brugeren.
    el.addEventListener('click', () => soegFra(`tag:${el.dataset.maerke}`));
  });

  const felt = document.getElementById('nytMaerke');
  const knap = document.getElementById('opretMaerke');
  const opret = async () => {
    const navn = (felt.value || '').trim().replace(/^#/, '');
    if (!navn) { felt.focus(); return; }
    try {
      await api('POST', '/api/v1/tags', { name: navn });
      state.tags = (await api('GET', '/api/v1/state')).tags || state.tags;
      felt.value = '';
      tegnSide();
    } catch (ex) { toast(ex.message); }
  };
  if (knap) knap.addEventListener('click', opret);
  if (felt) {
    felt.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); opret(); }
    });
  }

  document.querySelectorAll('[data-sletmaerke]').forEach((el) => {
    el.addEventListener('click', async () => {
      // Bekraeftelsen siger, hvad der SKER - ikke bare "er du sikker".
      // Noterne roeres ikke; kun koblingen forsvinder.
      if (!confirm(`Delete the tag "${el.dataset.navn}"? The notes stay — they just lose the tag.`)) return;
      try {
        const d = await api('DELETE', `/api/v1/tags/${el.dataset.sletmaerke}`);
        state.tags = (await api('GET', '/api/v1/state')).tags || state.tags;
        toast(d.notes ? `Tag removed from ${d.notes} note${d.notes === 1 ? '' : 's'}.` : 'Tag deleted.');
        tegnSide();
      } catch (ex) { toast(ex.message); }
    });
  });
}

/* ------------------------------------------------------------- filer */

/**
 * Alle brugerens filer, paa tvaers af noter.
 *
 * Hentes for sig, ikke som en del af indstillingerne: listen kan vaere lang,
 * og resten af siden skal kunne tegnes uden at vente paa den.
 */
async function tegnFilListe() {
  const host = document.getElementById('filListe');
  if (!host) return;
  try {
    const d = await api('GET', '/api/v1/files');
    if (!d.files.length) {
      host.innerHTML = '<p class="meta saetning">No files yet. Drag one onto a note, or paste an image.</p>';
      return;
    }
    /*
     * Listen er FOLDET som udgangspunkt.
     *
     * »Listen er allerede nu meget lang og fylder« (Andreas, 2026-08-21) - med
     * et par hundrede vedhaeftninger er den en mur, man skal forbi for at naa
     * resten af indstillingerne. Pladsmaaleren staar tilbage: den er ét blik,
     * og det er som regel dét, man kom efter.
     *
     * `<details>` frem for vores egen foldning: browseren goer det selv, det
     * virker uden JavaScript, og teksten paa knappen kan sige HVOR mange der
     * er - saa man ved, hvad man folder ud, foer man goer det (samme grund
     * som wikiens navigation).
     */
    host.innerHTML = `<details class="filfold">
      <summary>${d.files.length} file${d.files.length === 1 ? '' : 's'}</summary>
      <div class="tablewrap"><table class="data">
        <thead><tr><th>Name</th><th>Type</th><th class="num">Size</th><th></th></tr></thead>
        <tbody>${d.files.map((f) => `<tr>
          <td><a href="${esc(f.url)}" ${f.inline ? '' : 'download'}>${esc(f.name)}</a></td>
          <td class="meta saetning">${esc(f.inline ? 'image' : f.mime)}</td>
          <td class="num">${esc(visStoerrelse(f.size))}</td>
          <td style="text-align:right"><button class="btn ghost danger"
            data-filslet2="${esc(f.id)}">Remove</button></td>
        </tr>`).join('')}</tbody>
      </table></div></details>`;
    host.querySelectorAll('[data-filslet2]').forEach((el) => {
      el.addEventListener('click', async () => {
        try {
          await api('DELETE', `/api/v1/files/${el.dataset.filslet2}`);
          toast('Removed.');
          await genindlaes();
        } catch (ex) { toast(ex.message); }
      });
    });
  } catch (ex) {
    host.innerHTML = `<p class="meta saetning">${esc(ex.message)}</p>`;
  }
}

/* ---------------------------------------------------------- settings */

/* ------------------------------------------------ faner i indstillingerne
 *
 * »Jeg vil gerne have lavet sub menuer under indstillinger« (Andreas,
 * 2026-09-02), med verdande som forbillede.
 *
 * Siden var vokset til sytten afsnit i én lang stribe: udseende, konto,
 * passkeys, filer, bogmaerke, udgivelser, om, redigering, versionshistorik,
 * totrin, noegler, forbundne apps, doda, GitHub og to admin-afsnit. Man
 * rullede forbi ti ting for at naa den ellevte.
 *
 * ── ALT tegnes, ét vises ─────────────────────────────────────────────────
 *
 * Fanerne skjuler med `hidden`; de fjerner ikke noget fra dokumentet.
 * `bindSettings()` binder tredive elementer op paa deres id, og tegnede vi
 * kun den aabne fane, ville halvdelen af dem ikke findes - hver eneste
 * binding skulle saa laves om til noget, der koerer igen ved hvert faneskift.
 * Det er den slags omskrivning, der taber en knap undervejs uden at noget
 * fejler.
 *
 * Prisen er, at de skjulte afsnit stadig hentes og tegnes. De er der i
 * forvejen i dag, saa det koster ingenting nyt.
 *
 * ── Valget huskes ────────────────────────────────────────────────────────
 *
 * I `localStorage` og ikke i `state`: det afhaenger af, hvad man sidst var i
 * gang med paa DENNE maskine, ikke af kontoen - samme begrundelse som temaet
 * og den skjulte sidemenu.
 */
const FANER = [
  { id: 'konto', navn: 'Account' },
  { id: 'skrivning', navn: 'Editing' },
  { id: 'filer', navn: 'Files' },
  { id: 'broer', navn: 'Connections' },
  { id: 'noegler', navn: 'Keys' },
  { id: 'server', navn: 'Server', kunAdmin: true },
];

function laesFane() {
  try {
    const g = localStorage.getItem('sagu_fane');
    return FANER.some((f) => f.id === g) ? g : 'konto';
  } catch { return 'konto'; }
}

function gemFane(id) {
  try { localStorage.setItem('sagu_fane', id); } catch { /* privat tilstand */ }
}

/**
 * Hvilken fane staar aaben?
 *
 * Er den gemte fane ikke synlig for den her bruger - »Server« for en, der
 * ikke er administrator - falder den tilbage til den foerste. Ellers ville
 * man aabne indstillingerne og se en tom side.
 */
function aktivFane() {
  const g = laesFane();
  const f = FANER.find((x) => x.id === g);
  if (f && (!f.kunAdmin || state.user.isAdmin)) return g;
  return 'konto';
}

function fanebarHtml() {
  const nu = aktivFane();
  const synlige = FANER.filter((f) => !f.kunAdmin || state.user.isAdmin);
  return `<nav class="faner" role="tablist">${synlige.map((f) => `
    <button class="fane-knap${f.id === nu ? ' paa' : ''}" data-fane-knap="${f.id}"
      role="tab" aria-selected="${f.id === nu ? 'true' : 'false'}">${esc(f.navn)}</button>`).join('')}
  </nav>`;
}

/** Viser én fane og skjuler resten. */
function visFane(id) {
  for (const el of document.querySelectorAll('.fane')) el.hidden = el.dataset.fane !== id;
  for (const k of document.querySelectorAll('[data-fane-knap]')) {
    const paa = k.dataset.faneKnap === id;
    k.classList.toggle('paa', paa);
    k.setAttribute('aria-selected', paa ? 'true' : 'false');
  }
}

function bindFaner() {
  for (const k of document.querySelectorAll('[data-fane-knap]')) {
    k.addEventListener('click', () => {
      gemFane(k.dataset.faneKnap);
      visFane(k.dataset.faneKnap);
      // Til toppen: en fane, man skifter til, skal begynde ved sin foerste
      // overskrift - ikke midt i, fordi den forrige var laengere.
      tilToppen();
    });
  }
  visFane(aktivFane());
}

async function sideSettings() {
  const valgt = nuvaerendeTema();
  const knap = (id, tekst) => `<button class="btn${valgt === id ? ' primary' : ''}" data-tema="${id}">${tekst}</button>`;

  let noegler = [];
  let passkeys = [];
  try { noegler = (await api('GET', '/api/v1/keys')).keys; } catch { /* vist som tom */ }
  try { passkeys = (await api('GET', '/api/v1/passkeys')).passkeys; } catch { /* vist som tom */ }

  let adminDel = '';
  if (state.user.isAdmin) {
    let a = null;
    try { a = await api('GET', '/api/v1/admin'); } catch { /* vist som tom */ }
    if (a) {
      /*
       * To afsnit, ikke ét.
       *
       * »Public address« er et valg om, hvad LINKS skrives med - den handler
       * om det, kollegaerne faar at se. »Server« handler om, hvem der maa
       * logge ind. De to laa i samme kort med adressen klemt inde mellem et
       * flueben og en kontoliste, og saa laeses den som en detalje ved
       * kontostyringen (Andreas, 2026-08-21).
       */
      adminDel = `
      <h2>Public address</h2>
      <div class="card">
        <label class="field"><span>The address links are written with</span>
          <input class="input" id="offentligUrl" value="${esc(state.publicUrl || '')}"
            placeholder="${esc(location.origin)}" autocomplete="off" autocapitalize="none"
            autocorrect="off" inputmode="url" spellcheck="false"></label>
        <div class="btnrow" style="margin-top:8px">
          <button class="btn primary" id="offentligGem">Save address</button>
          ${state.publicUrl ? `<button class="btn" id="offentligRyd">Clear it</button>` : ''}
        </div>
        <p class="meta saetning">Sagu can be reached on more than one address. This is the one
        published links are written with, and the one search engines are told is the real one.
        <strong>Clear it</strong> removes the fixed address again, so links use whichever
        address you happen to be on.</p>
      </div>

      <h2>Server</h2>
      <div class="card">
        <label class="switch">
          <input type="checkbox" id="tilladReg" ${a.allowRegistration ? 'checked' : ''}>
          <span>Let anyone create an account on this server</span></label>
        <p class="meta saetning">Off means only you can sign in. Your colleagues do not need accounts —
        a published wiki is read without one.</p>
        <div class="tablewrap" style="margin-top:14px"><table class="data">
          <thead><tr><th>Account</th><th>Role</th><th class="num">Created</th><th></th></tr></thead>
          <tbody>${a.users.map((u) => `<tr><td>${esc(pentBruger(u.username))}</td>
            <td>${u.isAdmin ? 'Administrator' : 'Member'}</td>
            <td class="num">${esc(visTid(u.createdAt))}</td>
            <td style="text-align:right">${u.id === state.user.id
    ? '<span class="meta">that is you</span>'
    : `<button class="btn ghost" data-nulstil="${esc(u.id)}"
        data-navn="${esc(u.username)}">Set a password</button>`}</td>
          </tr>`).join('')}</tbody>
        </table></div>
        <label class="field" style="margin-top:16px"><span>File storage per account</span>
          <div class="btnrow">
            <input class="input" id="kvoteFelt" type="number" min="0.1" step="0.1"
              style="max-width:130px" value="${esc(String(Math.round((a.storageQuota / 1024 / 1024 / 1024) * 10) / 10))}">
            <span class="meta" style="align-self:center">GB</span>
            <button class="btn" id="kvoteGem">Save</button>
          </div></label>
        <p class="meta saetning">The same limit for every account. Sagu cannot make room:
        is the number bigger than the disk, it is a promise the machine cannot keep.
        Lowering it deletes nothing — it only stops new uploads, so it cannot be set below
        what an account already uses${a.storageMest
    ? ` (right now that is ${esc(visStoerrelse(a.storageMest))})` : ''}.</p>

        <p class="meta saetning">Setting a password signs that account out everywhere at once.
        Its <strong>API keys keep working</strong> — a forgotten password is no reason to kill
        someone's phone shortcuts; remove the key itself if that is what you mean.
        Your own password is changed under <strong>Your account</strong>, where the current
        one is asked for.</p>
      </div>`;
    }
  }

  let dodaDel = '';
  try {
    const d = await api('GET', '/api/v1/doda');
    dodaDel = `
  <h2>doda</h2>
  <div class="card">
    <p class="meta saetning">Sagu and doda are two apps, not one. They are tied together with
    <strong>links</strong> — a note can send a task, and the task carries a link back.
    Nothing is synchronised, so neither can quietly overwrite the other.</p>
    ${d.connected ? `<p class="doda-forbundet">Connected to <strong>${esc(d.url)}</strong>${
  d.tasks ? ` · ${d.tasks} task${d.tasks === 1 ? '' : 's'} sent from your notes` : ''}</p>` : ''}
    <label class="field"><span>doda address</span>
      <input class="input" id="dodaUrl" value="${esc(d.url || '')}"
        placeholder="https://doda.example.com" autocomplete="off" spellcheck="false"></label>
    <label class="field" style="margin-top:10px"><span>API key from doda</span>
      <input class="input" id="dodaKey" type="password" autocomplete="off"
        placeholder="${d.connected ? 'Leave empty to keep the saved key' : 'doda_…'}"></label>
    ${d.connected ? `<p class="gemt-noegle">${icon('laas', 14)}
      <span><strong>An API key is saved</strong> on the server. It never leaves it again —
      not even to this page, which is why the field looks empty. Paste a new one only if
      you want to replace it.</span></p>` : ''}
    <div class="btnrow" style="margin-top:10px">
      <button class="btn primary" id="dodaGem">${d.connected ? 'Save and test' : 'Connect'}</button>
      ${d.connected ? '<button class="btn" id="dodaFjern">Disconnect</button>' : ''}
    </div>
    <p class="meta saetning">In doda: Settings → API keys → create a <strong>full</strong> key.
    A <strong>capture</strong> key also works, but then doda cannot tell Sagu what happened
    to a task, so status will not be shown. The key is tested before it is saved, and it never
    leaves this server again.</p>
  </div>`;
  } catch { /* vist som tom */ }

  let ghDel = '';
  try {
    const g = await api('GET', '/api/v1/github/status');
    ghDel = `
  <h2>GitHub</h2>
  <div class="card">
    <p class="meta saetning">Paste a GitHub file address on its own line in a note, and it
    becomes the code — <strong>frozen at the commit it pointed to</strong>, so the note keeps
    explaining the code it was written about. Issue and pull request addresses become a chip
    with the title and whether it is still open.</p>
    ${g.connected ? `<p class="doda-forbundet">Connected as <strong>${esc(g.login || 'GitHub')}</strong></p>` : ''}
    <label class="field"><span>Personal access token</span>
      <input class="input" id="ghToken" type="password" autocomplete="off"
        placeholder="${g.connected ? 'Leave empty to keep the saved token' : 'github_pat_… or ghp_…'}"></label>
    ${g.connected ? `<p class="gemt-noegle">${icon('laas', 14)}
      <span><strong>A token is saved</strong> on the server. It never leaves it again —
      not even to this page, which is why the field looks empty.</span></p>` : ''}
    <div class="btnrow" style="margin-top:10px">
      <button class="btn primary" id="ghGem">${g.connected ? 'Save and test' : 'Connect'}</button>
      ${g.connected ? '<button class="btn" id="ghFjern">Disconnect</button>' : ''}
    </div>
    <p class="meta saetning">Without a token GitHub allows <strong>60 requests an hour</strong>
    and answers <strong>404</strong> for anything private — the same answer as »does not
    exist«, which is why a missing token looks like a missing file. With a token: 5.000 an
    hour, and your private repositories. A token with <em>read-only</em> access to contents
    is enough; it is tested before it is saved, and it never leaves this server again.</p>
  </div>`;
  } catch { /* vist som tom */ }

  return fanebarHtml() + `
  <section class="fane" data-fane="konto">

  <h2>Appearance</h2>
  <div class="card">
    <div class="btnrow">${knap('auto', 'Follow system')}${knap('light', 'Light')}${knap('dark', 'Dark')}</div>
  </div>


  <h2>Account</h2>
  <div class="card">
    <p class="meta saetning">Signed in as <strong>${esc(pentBruger(state.user.username))}</strong>${state.user.isAdmin ? ' (administrator)' : ''}.</p>
    <form id="kodeordForm" style="margin-top:14px">
      <label class="field"><span>Current password</span>
        <input class="input" type="password" id="kodeNu" autocomplete="current-password"></label>
      <label class="field"><span>New password</span>
        <input class="input" type="password" id="kodeNy" autocomplete="new-password"></label>
      <button class="btn" type="submit">Change password</button>
    </form>
  </div>


  <h2>Passkeys</h2>
  <div class="card">
    ${state.config.passkeys ? '' : `<p class="meta saetning">Passkeys need https.
      On the panel address (plain http) the password is the only way in — and it stays that way,
      so a passkey can never lock you out of your own server.</p>`}
    ${passkeys.length ? `<div class="tablewrap"><table class="data">
      <thead><tr><th>Name</th><th class="num">Added</th><th class="num">Last used</th><th></th></tr></thead>
      <tbody>${passkeys.map((p) => `<tr><td>${esc(p.name)}</td>
        <td class="num">${esc(visTid(p.created_at))}</td>
        <td class="num">${esc(p.last_used_at ? visTid(p.last_used_at) : 'never')}</td>
        <td style="text-align:right"><button class="btn ghost danger" data-pkslet="${esc(p.id)}">Remove</button></td>
      </tr>`).join('')}</tbody></table></div>`
    : '<p class="meta saetning">No passkeys yet.</p>'}
    ${state.config.passkeys ? '<div class="btnrow" style="margin-top:14px">'
      + '<button class="btn" id="pkTilfoej">Add a passkey</button></div>' : ''}
  </div>


  <h2>Two-step verification</h2>
  <div class="card" id="totpKort">
    <p class="meta saetning">Loading…</p>
  </div>


  <h2>About</h2>
  <div class="card">
    <p class="lead" style="margin-top:6px">Sagu version ${esc(String(APP_VERSION))}${
  state.config.version && state.config.version > APP_VERSION
    ? ` — the server has v${esc(String(state.config.version))}` : ''}.</p>
    <p class="meta saetning">${state.config.secureContext
    ? 'Secure connection (https), so passkeys work here.'
    : 'Plain http — passkeys are unavailable on this address. Your password always keeps working.'}
    ${state.publicUrl ? `Links are written with <code>${esc(state.publicUrl)}</code>.` : ''}</p>
    ${state.config.version && state.config.version > APP_VERSION
    ? '<div class="btnrow" style="margin-top:10px"><button class="btn primary" id="omOpdater">Update the app</button></div>'
    : ''}
  </div>
  </section>

  <section class="fane" data-fane="skrivning">

  <h2>Editing</h2>
  <div class="card">
    <label class="switch">
      <input type="checkbox" id="prefHel" ${state.prefs && state.prefs.editWhole ? 'checked' : ''}>
      <span>Click a line to edit the whole note as markdown</span></label>
    <p class="meta saetning">Sagu normally opens just the paragraph you clicked, with the rest of
    the note still rendered around it — good for changing a sentence. With this on, a click opens
    the <strong>whole</strong> note as raw markdown instead, with the cursor at the line you
    clicked. Better for moving things around, fixing a table, or cutting across paragraphs.
    <strong>Esc</strong> closes either way.</p>
  </div>


  <h2>Version history</h2>
  <div class="card" id="versionKort">
    <p class="meta saetning">Loading…</p>
  </div>
  </section>

  <section class="fane" data-fane="filer">

  <h2>Files</h2>
  <div class="card">
    ${(() => {
    const st = state.storage || {};
    const brugt = st.used || 0;
    const kvote = st.quota || 1;
    const pct = Math.min(100, Math.round((brugt / kvote) * 1000) / 10);
    return `<div class="plads">
        <div class="plads-bar"><div class="plads-fyld${pct > 90 ? ' fuld' : ''}"
          style="width:${Math.max(pct, brugt ? 1 : 0)}%"></div></div>
        <p class="meta saetning">${visStoerrelse(brugt)} of ${visStoerrelse(kvote)} used${
  st.maxFile ? ` · one file can be at most ${visStoerrelse(st.maxFile)}` : ''}.</p>
      </div>`;
  })()}
    <div id="filListe"><p class="meta saetning">Loading…</p></div>
  </div>


  <h2>Published pages</h2>
  <div class="card">
    <p class="meta saetning">Pages your colleagues can read without an account.
    A published page always shows what it says right now — there is nothing to re-publish.</p>
    <div id="udgivListe" style="margin-top:12px"><p class="meta saetning">Loading…</p></div>
  </div>
  </section>

  <section class="fane" data-fane="broer">
  ${dodaDel}

  ${ghDel}


  <h2>Save to Sagu</h2>
  <div class="card">
    <p class="meta saetning">A bookmark you press on any page — a ticket, an article, a wiki —
    and it lands in Sagu as a note. Select something first and only the selection is saved;
    otherwise the page's main text is.</p>
    <div class="klip-valg">
      <label class="field"><span>Notebook</span>
        <select class="input" id="klipBog">
          <option value="">Not in a notebook</option>
          ${(state.notebooks || []).map((b) => `<option value="${esc(b.name)}">${esc(b.name)}</option>`).join('')}
        </select></label>
      <label class="field"><span>Tag (optional)</span>
        <input class="input" id="klipMaerke" placeholder="clip" autocomplete="off"
          autocapitalize="none" autocorrect="off" spellcheck="false"></label>
    </div>
    <div class="btnrow" style="margin-top:10px">
      <button class="btn primary" id="klipLav">Make the bookmark</button>
    </div>
    <div id="klipUd"></div>
    <p class="meta saetning" style="margin-top:12px">It gets a <strong>capture</strong> key of its
    own — a key that can put something new in and <strong>read nothing at all</strong>. A bookmark
    sits in plain text in your browser and syncs between machines, so it must not be able to pull
    your archive back out. Revoke it under <strong>Access keys</strong> whenever you like.</p>
  </div>
  </section>

  <section class="fane" data-fane="noegler">

  <h2>Access keys</h2>
  <div class="card">
    <p class="meta saetning">For iPhone shortcuts, Siri and anything else that talks to Sagu
    from outside. One key per device or purpose, so you can revoke a single one without
    touching the rest. The value is shown once.</p>
    ${noegler.length ? `<div class="tablewrap"><table class="data">
      <thead><tr><th>Name</th><th>What it may do</th><th class="num">Last used</th><th></th></tr></thead>
      <tbody>${noegler.map((k) => `<tr><td>${esc(k.name)}</td>
        <td>${esc(scopeNavn(k.scope))}</td>
        <td class="num">${esc(k.last_used_at ? visTid(k.last_used_at) : 'never')}</td>
        <td style="text-align:right"><button class="btn ghost danger" data-noegleslet="${esc(k.id)}">Revoke</button></td>
      </tr>`).join('')}</tbody></table></div>` : ''}
    <div class="btnrow" style="margin-top:14px">
      <input class="input" id="noegleNavn" placeholder="What is it for?" style="max-width:220px">
      <select class="input" id="noegleScope" style="max-width:280px">
        ${SCOPES.map((s) => `<option value="${esc(s.id)}">${esc(s.etiket)}</option>`).join('')}
      </select>
      <button class="btn" id="noegleNy">Create key</button>
    </div>
    <p class="meta saetning" id="scopeHvornaar" style="margin-top:8px"></p>
    <div class="btnrow" style="margin-top:12px">
      <button class="btn" id="tilApi">How to use these →</button>
    </div>
    <div class="tablewrap" style="margin-top:12px"><table class="data">
      <tbody>${SCOPES.map((s) => `<tr>
        <th style="white-space:nowrap">${esc(s.etiket)}</th>
        <td class="meta saetning">${s.hvornaar}</td></tr>`).join('')}</tbody></table></div>
  </div>


  <h2>Connected apps</h2>
  <div class="card">
    <p class="meta saetning">Claude and other MCP clients you have allowed. They asked
    through a consent page and got a key of their own — you did not have to paste one.
    Add Sagu in Claude as a custom connector with the address
    <code>${esc(offentligBase())}/mcp</code>.</p>
    <div id="forbListe"><p class="meta saetning">Loading…</p></div>
    <p class="meta saetning">Revoking cuts it off at once: both the key it holds and the
    one it could have renewed with. It never had permission to change your password,
    create keys, or revoke connections — those need this browser.</p>
  </div>
  </section>

  <section class="fane" data-fane="server">
  ${adminDel}
  </section>`;
}

/** Forbundne apps - hentes bagefter, som udgivelseslisten. */
async function forbindelsesListeHtml() {
  let liste = [];
  try { liste = (await api('GET', '/api/v1/connections')).connections; } catch { return ''; }
  if (!liste.length) return '<p class="meta saetning">Nothing is connected yet.</p>';
  return `<div class="tablewrap"><table class="data">
    <thead><tr><th>App</th><th>Scope</th><th class="num">Last used</th><th></th></tr></thead>
    <tbody>${liste.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.scope || '')}</td>
      <td class="num">${esc(c.last_used_at ? visTid(c.last_used_at) : 'never')}</td>
      <td style="text-align:right"><button class="btn ghost danger"
        data-forbslet="${esc(c.id)}">Revoke</button></td>
    </tr>`).join('')}</tbody></table></div>`;
}

function bindForbindelsesListe() {
  document.querySelectorAll('[data-forbslet]').forEach((el) => {
    el.addEventListener('click', async () => {
      if (!confirm('Cut this app off? It will have to ask again.')) return;
      try {
        await api('DELETE', `/api/v1/connections/${encodeURIComponent(el.dataset.forbslet)}`);
        toast('Connection revoked.');
        const host = document.getElementById('forbListe');
        if (host) { host.innerHTML = await forbindelsesListeHtml(); bindForbindelsesListe(); }
      } catch (ex) { toast(ex.message); }
    });
  });
}

/**
 * Den nye noegle - i en rude, man skal lukke selv.
 *
 * `navigator.clipboard` findes kun i et secure context, og panelet naas over
 * ren http. Derfor BAADE en kopiér-knap og en vaerdi, der kan markeres med
 * fingeren: knappen forsvinder, hvis den ikke kan virke, frem for at fejle
 * naar man trykker (RUNE-ERFARINGER, tools v1).
 */
function visNoeglePanel(noegle, scope) {
  const gammel = document.getElementById('noeglePanel');
  if (gammel) gammel.remove();

  const host = document.createElement('div');
  host.className = 'modal';
  host.id = 'noeglePanel';
  host.innerHTML = `<div class="modal-kort">
      <div class="modal-top">
        <h2>Your new key</h2>
        <button class="iconbtn" id="noegleLuk" aria-label="Close">${icon('luk', 16)}</button>
      </div>
      <div class="modal-krop">
        <p class="lead">Copy it now — <strong>it is never shown again.</strong>
        Sagu keeps only a hash of it, so there is no way to look it up later.</p>
        <p class="meta saetning">It may: <strong>${esc(scopeNavn(scope))}</strong>.</p>
        <p class="noegle-vaerdi"><code id="noegleTekst">${esc(noegle)}</code></p>
        <div class="btnrow">
          ${navigator.clipboard ? '<button class="btn primary" id="noegleKopi">Copy</button>' : ''}
          <button class="btn" id="noegleFaerdig">Done</button>
        </div>
        <p class="meta saetning">Lost it? Revoke it in the list and make a new one —
        that is quicker than looking for it.</p>
      </div>
    </div>`;
  document.body.appendChild(host);

  const luk = () => { host.remove(); document.removeEventListener('keydown', paaTast); };
  const paaTast = (e) => { if (e.key === 'Escape') { e.preventDefault(); luk(); } };
  document.addEventListener('keydown', paaTast);
  host.querySelector('#noegleLuk').addEventListener('click', luk);
  host.querySelector('#noegleFaerdig').addEventListener('click', luk);
  /*
   * Et klik ved siden af lukker IKKE.
   *
   * Alle andre ruder i appen lukker paa baggrunden, og det er rigtigt for
   * dem: man kan aabne dem igen. Den her kan man ikke - et fejlklik ville
   * koste noeglen. Reglen boejes netop dér, hvor den ellers ville gøre skade.
   */

  const kopi = host.querySelector('#noegleKopi');
  if (kopi) {
    kopi.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(noegle);
        kopi.textContent = 'Copied';
        toast('Key copied. Paste it where it belongs before you close this.');
      } catch { toast('The browser would not let me copy — select the text instead.'); }
    });
  }
  // Markér hele vaerdien, saa den kan tages med ét greb paa en telefon.
  const tekst = host.querySelector('#noegleTekst');
  if (tekst) {
    tekst.addEventListener('click', () => {
      const r = document.createRange();
      r.selectNodeContents(tekst);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    });
  }
}

function bindSettings() {
  bindFaner();
  // Listerne hentes bagefter og erstatter kun deres eget element: en side, der
  // venter paa alle sine kald, foeles langsom, og listen er ikke det, man kom
  // efter (RUNE-ERFARINGER, doda v27).
  (async () => {
    const host = document.getElementById('udgivListe');
    if (!host) return;
    host.innerHTML = await udgivelsesListeHtml();
    bindUdgivelsesListe();
  })();

  const ghGem = document.getElementById('ghGem');
  if (ghGem) {
    ghGem.addEventListener('click', async () => {
      const felt = document.getElementById('ghToken');
      ghGem.disabled = true;
      try {
        const d = await api('POST', '/api/v1/github/token', { token: felt.value.trim() });
        toast(d.connected ? `Connected to GitHub as ${d.login}.` : 'Disconnected.');
        tegnSide();
      } catch (ex) { toast(ex.message); ghGem.disabled = false; }
    });
  }

  const ghFjern = document.getElementById('ghFjern');
  if (ghFjern) {
    ghFjern.addEventListener('click', async () => {
      // Tom streng = kobl fra. Cachen bliver staaende: den er ikke hemmelig,
      // og et uddrag, man allerede har set, skal ikke forsvinde.
      try {
        await api('POST', '/api/v1/github/token', { token: '' });
        toast('Disconnected from GitHub.');
        tegnSide();
      } catch (ex) { toast(ex.message); }
    });
  }

  (async () => {
    const host = document.getElementById('forbListe');
    if (!host) return;
    host.innerHTML = await forbindelsesListeHtml();
    bindForbindelsesListe();
  })();

  document.querySelectorAll('[data-tema]').forEach((el) => {
    el.addEventListener('click', () => { anvendTema(el.dataset.tema); opdaterTemaKnap(); });
  });

  const form = document.getElementById('kodeordForm');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('POST', '/api/password', {
          current: document.getElementById('kodeNu').value,
          next: document.getElementById('kodeNy').value,
        });
        toast('Password changed. Other sessions were signed out.');
        form.reset();
      } catch (ex) { toast(ex.message); }
    });
  }

  const reg = document.getElementById('tilladReg');
  if (reg) {
    reg.addEventListener('change', async () => {
      try {
        await api('POST', '/api/v1/admin', { allowRegistration: reg.checked });
        toast(reg.checked ? 'Anyone can now sign up.' : 'Sign-up is closed.');
      } catch (ex) { toast(ex.message); reg.checked = !reg.checked; }
    });
  }

  /*
   * Linjen under rullelisten skifter med valget.
   *
   * Tabellen nedenunder siger det hele, men den, der staar med musen paa
   * rullelisten, skal ikke skulle kigge et andet sted hen for at finde ud af,
   * hvad han lige har valgt.
   */
  const scopeValg = document.getElementById('noegleScope');
  const scopeTekst = document.getElementById('scopeHvornaar');
  if (scopeValg && scopeTekst) {
    const vis = () => {
      const s = SCOPES.find((x) => x.id === scopeValg.value);
      scopeTekst.innerHTML = s ? s.hvornaar : '';
    };
    scopeValg.addEventListener('change', vis);
    vis();
  }

  const prefHel = document.getElementById('prefHel');
  if (prefHel) {
    prefHel.addEventListener('change', async () => {
      try {
        const r = await api('POST', '/api/v1/prefs', { editWhole: prefHel.checked });
        state.prefs = Object.assign({}, state.prefs, { editWhole: r.editWhole });
        toast(r.editWhole ? 'A click now opens the whole note.' : 'A click now opens one paragraph.');
      } catch (ex) { toast(ex.message); prefHel.checked = !prefHel.checked; }
    });
  }

  tegnVersioner();
  tegnTotp();

  const kvoteGem = document.getElementById('kvoteGem');
  if (kvoteGem) {
    kvoteGem.addEventListener('click', async () => {
      const gb = Number(document.getElementById('kvoteFelt').value);
      if (!Number.isFinite(gb) || gb <= 0) { toast('Give it a number of gigabytes.'); return; }
      kvoteGem.disabled = true;
      try {
        await api('POST', '/api/v1/admin', { storageQuota: Math.round(gb * 1024 * 1024 * 1024) });
        toast('Storage limit saved.');
        await genindlaes();
      } catch (ex) { toast(ex.message); }
      kvoteGem.disabled = false;
    });
  }

  const omOpdater = document.getElementById('omOpdater');
  if (omOpdater) omOpdater.addEventListener('click', () => hentNyVersion());

  const klipLav = document.getElementById('klipLav');
  if (klipLav) {
    klipLav.addEventListener('click', async () => {
      const bog = document.getElementById('klipBog').value;
      const maerke = document.getElementById('klipMaerke').value.trim().replace(/^#/, '').replace(/\s+/g, '-');
      klipLav.disabled = true;
      try {
        /*
         * Noeglen laves HER og vises kun én gang - som alle andre noegler.
         *
         * Derfor bygges bogmaerket i samme aandedrag: bagefter findes den raa
         * noegle ikke laengere nogen steder, og en »byg den igen«-knap ville
         * kraeve en ny noegle. Navnet siger hvad den er til, saa den kan
         * genkendes paa noeglelisten, naar den skal trakkes tilbage.
         */
        const navn = `Bookmark${bog ? ` — ${bog}` : ''}`;
        const d = await api('POST', '/api/v1/keys', { name: navn, scope: 'capture' });
        /*
         * Og saa tegnes siden IKKE om.
         *
         * Foerste udgave kaldte `genindlaes()` bagefter, for at den nye
         * noegle kunne dukke op paa noeglelisten. Det slettede bogmaerket
         * igen i samme oejeblik, det var lavet - og noeglen vises kun én
         * gang, saa den var vaek for altid. Det er samme fejl som »jeg kan
         * ikke nå at se Access key når jeg opretter en ny« (Andreas), og
         * den er vaerre her, fordi der ikke engang staar noget at kopiere.
         *
         * Noeglelisten er ajour naeste gang siden tegnes. Bogmaerket bliver
         * staaende, til man selv gaar videre.
         */
        visKlip(byggKlip({ base: offentligBase(), noegle: d.key, notesbog: bog, tag: maerke }), bog, maerke);
      } catch (ex) { toast(ex.message); }
      klipLav.disabled = false;
    });
  }

  document.querySelectorAll('[data-nulstil]').forEach((el) => {
    el.addEventListener('click', () => visNulstilPanel(el.dataset.nulstil, el.dataset.navn));
  });

  const dodaGem = document.getElementById('dodaGem');
  if (dodaGem) {
    dodaGem.addEventListener('click', async () => {
      const url = document.getElementById('dodaUrl').value.trim();
      const key = document.getElementById('dodaKey').value.trim();
      dodaGem.disabled = true;
      dodaGem.textContent = 'Testing…';
      try {
        // Serveren proever forbindelsen FOER den gemmer, og ruller tilbage
        // ved fejl - saa der aldrig ligger et token og LIGNER en virkende
        // forbindelse (RUNE-ERFARINGER, doda v16).
        const r = await api('POST', '/api/v1/doda', { url, key });
        toast(r.message || 'Connected to doda.');
        await tegnSide();
      } catch (ex) {
        toast(ex.message);
        dodaGem.disabled = false;
        dodaGem.textContent = 'Connect';
      }
    });
  }
  const dodaFjern = document.getElementById('dodaFjern');
  if (dodaFjern) {
    dodaFjern.addEventListener('click', async () => {
      // Sig hvad der SKER med det, der allerede findes - ellers toer man ikke
      // trykke (RUNE-ERFARINGER, doda v35).
      if (!window.confirm('Disconnect doda? The tasks your notes have already sent stay '
        + 'where they are, in doda and on the notes.')) return;
      try {
        await api('DELETE', '/api/v1/doda');
        toast('doda disconnected.');
        await tegnSide();
      } catch (ex) { toast(ex.message); }
    });
  }

  // En noegle er ubrugelig uden en opskrift. Herfra er der ét klik til dem.
  const tilApi = document.getElementById('tilApi');
  if (tilApi) tilApi.addEventListener('click', () => gaaTil('api'));

  const gemUrl = document.getElementById('offentligGem');
  if (gemUrl) {
    const felt = document.getElementById('offentligUrl');
    const saet = async (v) => {
      try {
        const r = await api('POST', '/api/v1/admin', { publicUrl: v });
        state.publicUrl = r.publicUrl || '';
        toast(state.publicUrl
          ? `Published links now start with ${state.publicUrl}`
          : 'Published links now use the address you are on.');
        await tegnSide();
      } catch (ex) { toast(ex.message); }
    };
    gemUrl.addEventListener('click', () => saet(felt.value));
    const ryd = document.getElementById('offentligRyd');
    /*
     * Knappen hed »Use this address«, og den RYDDER feltet.
     *
     * Meningen var »brug den adresse, du staar paa« - men ved siden af et
     * felt, man lige har skrevet en adresse i, laeses den som »brug DEN her
     * adresse«. Andreas trykkede paa den efter at have rettet adressen og
     * fik den gamle tilbage; knappen gjorde noejagtig det, den skulle, og
     * stik imod det, den sagde (2026-08-21).
     *
     * **En knap skal hedde det, den goer** - og naar den goer noget, man ikke
     * kan fortryde med det samme, skal den spoerge.
     */
    if (ryd) {
      ryd.addEventListener('click', () => {
        if (!confirm('Remove the fixed public address?\n\n'
          + 'Published links will then use whichever address you open Sagu on.')) return;
        saet('');
      });
    }
  }

  const nyNoegle = document.getElementById('noegleNy');
  if (nyNoegle) {
    nyNoegle.addEventListener('click', async () => {
      try {
        const d = await api('POST', '/api/v1/keys', {
          name: document.getElementById('noegleNavn').value,
          scope: document.getElementById('noegleScope').value,
        });
        /*
         * Vaerdien vises ÉN gang - og skal derfor overleve optegningen.
         *
         * Foer stod den i et `<p>` paa siden, og saa blev `tegnSide()` kaldt
         * med det samme for at faa den nye noegle med i listen. Noeglen
         * blinkede og var vaek, foer man kunne naa at laese den (Andreas,
         * 2026-08-21) - og den kan ikke hentes frem igen.
         *
         * En rude staar uden for siden og roeres ikke af en optegning. Den
         * er samtidig den aerlige form for noget, man kun faar at se én
         * gang: man skal lukke den selv.
         */
        await tegnSide();
        visNoeglePanel(d.key, d.scope);
      } catch (ex) { toast(ex.message); }
    });
  }

  document.querySelectorAll('[data-noegleslet]').forEach((el) => {
    el.addEventListener('click', async () => {
      try {
        await api('DELETE', `/api/v1/keys/${el.dataset.noegleslet}`);
        toast('Key revoked.');
        await tegnSide();
      } catch (ex) { toast(ex.message); }
    });
  });

  tegnFilListe();

  const pkAdd = document.getElementById('pkTilfoej');
  if (pkAdd) {
    pkAdd.addEventListener('click', async () => {
      try {
        await tilfoejPasskey();
        toast('Passkey added.');
        await tegnSide();
      } catch (ex) {
        if (ex.name !== 'NotAllowedError') toast(ex.message || 'The passkey did not work');
      }
    });
  }

  document.querySelectorAll('[data-pkslet]').forEach((el) => {
    el.addEventListener('click', async () => {
      try {
        await api('DELETE', `/api/v1/passkeys/${encodeURIComponent(el.dataset.pkslet)}`);
        toast('Passkey removed.');
        await tegnSide();
      } catch (ex) { toast(ex.message); }
    });
  });
}

/* ================================================ import og eksport (F5) = */

/*
 * Importen koerer som et BAGGRUNDSJOB paa serveren. Frontenden poller og viser
 * et baand - saa kan Andreas lukke browseren, mens 234 MB gaar ind
 * (RUNE-ERFARINGER §6c). En loekke her ville doe med fanen.
 */
const importUI = {
  uploadId: null,
  forhaand: null,
  poller: null,
  /*
   * Har vi allerede ryddet op efter DENNE import?
   *
   * `foelgImport()` kaldte `genindlaes()`, naar en import var faerdig - og
   * `genindlaes()` kalder `foelgImport()`. To funktioner, der kalder hinanden,
   * og en tilstand (`done`), der ikke aendrer sig: løkken koerte i det
   * uendelige, hentede hele state'en og gentegnede siden hver gang. Det saa
   * ud som om siden »hoppede«, og kvitteringen - med listen over det, der
   * blev sprunget over - forsvandt, foer man kunne laese den (Andreas,
   * 2026-08-21).
   *
   * Stemplet er importens starttidspunkt: en NY import har et nyt, saa den
   * bliver ryddet op efter, mens den samme aldrig bliver det to gange.
   */
  ryddetEfter: null,
};

function sideImport() {
  return `
    <h2>Import from Notion</h2>
    <div class="card">
      <p class="meta saetning">In Notion: <strong>Settings → Export all workspace content</strong>,
      format <strong>Markdown &amp; CSV</strong>, include subpages. You get a zip — drop it here.</p>
      <div class="dropzone" id="importDrop">
        <input type="file" id="importFil" accept=".zip" hidden>
        <button class="btn" id="importVaelg">Choose a zip…</button>
        <p class="meta saetning" style="margin-top:8px">or drag it onto this box</p>
      </div>
      <div id="importSvar"></div>
      <p class="meta saetning"><strong>Is the archive bigger than 100 MB?</strong>
      Then send it straight to the server instead of through your tunnel.
      Cloudflare's free plan refuses request bodies over 100 MB, and a big Notion export
      is well past that — the upload climbs and then stops. Open Sagu on the server's own
      address on your network (something like <code>http://192.168.1.50:8080</code>) and
      import there. It is also many times faster, because nothing leaves the house.</p>
    </div>

    <h2>Export</h2>
    <div class="card">
      <p class="meta saetning">Markdown is the format your notes are already stored in, so an
      export loses nothing. The JSON file is the one to keep for a full restore.</p>
      <div class="btnrow" style="margin-top:12px">
        <a class="btn" href="/api/v1/export?format=md" download>Markdown + files (.zip)</a>
        <a class="btn" href="/api/v1/export?format=json" download>Everything (.json)</a>
        <a class="btn ghost" href="/api/v1/export?format=json&files=0" download>Notes only (.json)</a>
      </div>
      <p class="meta saetning" style="margin-top:12px">For a full server backup — including
      settings and keys — use the panel's own backup. It already covers <code>/data</code>.</p>
    </div>`;
}

function bindImport() {
  const felt = document.getElementById('importFil');
  const vaelg = document.getElementById('importVaelg');
  const zone = document.getElementById('importDrop');
  if (!felt || !zone) return;

  vaelg.addEventListener('click', () => felt.click());
  felt.addEventListener('change', () => { if (felt.files[0]) sendArkiv(felt.files[0]); });

  let dybde = 0;
  zone.addEventListener('dragenter', (e) => { e.preventDefault(); dybde++; zone.classList.add('over'); });
  zone.addEventListener('dragover', (e) => e.preventDefault());
  zone.addEventListener('dragleave', () => { dybde = Math.max(0, dybde - 1); if (!dybde) zone.classList.remove('over'); });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    dybde = 0;
    zone.classList.remove('over');
    if (e.dataTransfer.files[0]) sendArkiv(e.dataTransfer.files[0]);
  });

  // Koerer der allerede en import, skal siden vise den - ogsaa efter en
  // genindlaesning. Det er hele pointen med et baggrundsjob.
  foelgImport();
}

/**
 * Et arbejdsfelt, der SIGER hvad der sker.
 *
 * `pct: null` giver en ubestemt, vandrende bjaelke. Den bruges, hvor serveren
 * er optaget og ikke KAN svare paa, hvor langt den er - og en opdigtet
 * procent, der staar stille, er vaerre end en, der aabenlyst bare arbejder.
 */
function arbejdeHtml(overskrift, linje, pct) {
  return `<div class="forhaand">
      <h3>${esc(overskrift)}</h3>
      <div class="plads-bar${pct === null ? ' ubestemt' : ''}">
        <div class="plads-fyld" style="${pct === null ? '' : `width:${pct}%`}"></div></div>
      <p class="meta saetning" style="margin-top:8px">${esc(linje)}</p>
    </div>`;
}

async function sendArkiv(fil) {
  const svar = document.getElementById('importSvar');
  svar.innerHTML = arbejdeHtml('Uploading…', `0 of ${visStoerrelse(fil.size)}`, 0);
  try {
    /*
     * XHR og ikke fetch - ene og alene for `upload.onprogress`.
     *
     * En Notion-eksport er hundredvis af MB, og `fetch` kan ikke fortaelle,
     * hvor langt afsendelsen er naaet. Uden det staar der »Uploading…« i et
     * minut, og brugeren kan ikke se forskel paa »i gang« og »gaaet i staa«.
     */
    const d = await new Promise((ok, nej) => {
      const x = new XMLHttpRequest();
      x.open('POST', `/api/v1/upload?name=${encodeURIComponent(fil.name)}`);
      x.withCredentials = true;
      x.setRequestHeader('X-Sagu-Upload', '1');
      x.setRequestHeader('Content-Type', 'application/zip');
      x.upload.addEventListener('progress', (e) => {
        if (!e.lengthComputable) return;
        svar.innerHTML = arbejdeHtml('Uploading…',
          `${visStoerrelse(e.loaded)} of ${visStoerrelse(e.total)}`,
          Math.round((e.loaded / e.total) * 100));
      });
      x.addEventListener('load', () => {
        let krop = {};
        try { krop = JSON.parse(x.responseText); } catch { /* serveren svarede ikke JSON */ }
        if (x.status >= 200 && x.status < 300) ok(krop);
        else nej(new Error(krop.message || `Upload failed (${x.status})`));
      });
      // En fetch, der kaster, har ingen status - browserens egen ordlyd
      // (»Load failed«) siger brugeren intet (RUNE-ERFARINGER, doda v11).
      x.addEventListener('error', () => nej(new Error('The upload did not get through. Is the server still running?')));
      x.addEventListener('abort', () => nej(new Error('The upload was stopped.')));
      x.send(fil);
    });
    importUI.uploadId = d.id;

    // Serveren laeser hele zip'ens indhold her og kan ikke svare imens.
    // Derfor en ubestemt bjaelke - og en linje, der siger, at det tager tid.
    svar.innerHTML = arbejdeHtml('Looking inside the archive…',
      'Reading the file list. A large export takes a few seconds.', null);
    const f = await api('POST', '/api/v1/import/preview', { uploadId: d.id });
    importUI.forhaand = f;
    visForhaand(f);
  } catch (ex) {
    svar.innerHTML = `<p class="meta saetning" style="color:var(--danger)">${esc(ex.message)}</p>`;
  }
}

/*
 * Vis hvad der VILLE ske, foer det sker.
 *
 * Det er den eneste maade at opdage, at man har valgt den forkerte zip, foer
 * 278 noter ligger i arkivet - og den eneste maade at se, at en genkoersel
 * ikke laver dubletter.
 */
function visForhaand(f) {
  const svar = document.getElementById('importSvar');
  svar.innerHTML = `
    <div class="forhaand">
      <h3>What this archive holds</h3>
      <table class="data">
        <tr><td>Pages</td><td class="num">${f.pages}</td>
          <td class="meta saetning">${f.newPages} new · ${f.existingPages} already imported</td></tr>
        <tr><td>Databases → notebooks</td><td class="num">${f.databases}</td>
          <td class="meta saetning">${f.notebooks.slice(0, 6).map(esc).join(', ')}${f.notebooks.length > 6 ? '…' : ''}</td></tr>
        <tr><td>Files</td><td class="num">${f.files}</td>
          <td class="meta saetning">${esc(visStoerrelse(f.unpacked))} unpacked</td></tr>
        ${f.linkedViews ? `<tr><td>Linked views</td><td class="num">${f.linkedViews}</td>
          <td class="meta saetning">skipped — they are views of databases that live elsewhere,
          and importing them would duplicate the rows</td></tr>` : ''}
      </table>
      ${f.existingPages ? `<p class="meta saetning" style="margin-top:10px">
        ${f.existingPages} pages are already here and will be <strong>updated</strong>, not duplicated —
        the import matches on Notion's own id.</p>` : ''}
      <p class="meta saetning" style="margin-top:10px">Notion does <strong>not</strong> export comments,
      page history, synced blocks or database relations. Those cannot come along.</p>
      <div class="btnrow" style="margin-top:14px">
        <button class="btn primary" id="importStart">Import ${f.pages} pages</button>
        <button class="btn ghost" id="importFortryd">Cancel</button>
      </div>
    </div>`;

  document.getElementById('importStart').addEventListener('click', async () => {
    try {
      await api('POST', '/api/v1/import', { uploadId: importUI.uploadId });
      foelgImport();
    } catch (ex) { toast(ex.message); }
  });
  document.getElementById('importFortryd').addEventListener('click', () => {
    importUI.uploadId = null;
    document.getElementById('importSvar').innerHTML = '';
  });
}

/** Poller status. Baandet staar, ogsaa naar man skifter skaerm. */
async function foelgImport() {
  clearTimeout(importUI.poller);
  let st;
  try { st = await api('GET', '/api/v1/import'); } catch { return; }
  tegnImportBaand(st);
  const svar = document.getElementById('importSvar');
  if (svar && (st.running || st.phase)) svar.innerHTML = importStatusHtml(st);
  if (st.running) {
    importUI.poller = setTimeout(foelgImport, 700);
    return;
  }
  if (st.phase === 'done' && importUI.ryddetEfter !== st.startedAt) {
    importUI.ryddetEfter = st.startedAt;
    // Traeet og taellerne skal opdateres - men KUN én gang. Se kommentaren
    // ved `ryddetEfter`.
    await hentState();
    opdaterNav();
    tegnTrae();
    // Kvitteringen tegnes IKKE om: den staar allerede, og den er det eneste
    // sted, man kan se hvad der blev sprunget over. En gentegning ville
    // rulle siden og lukke »2 skipped - see why« igen.
  }
}

function importStatusHtml(st) {
  const pct = st.total ? Math.min(100, Math.round((st.done / st.total) * 100)) : 0;
  const c = st.counts || {};
  if (st.running) {
    return `<div class="forhaand">
        <h3>${esc(st.phase)}…</h3>
        <div class="plads-bar${st.total ? '' : ' ubestemt'}">
          <div class="plads-fyld" style="${st.total ? `width:${pct}%` : ''}"></div></div>
        <p class="meta saetning" style="margin-top:8px">${st.total
    ? `${st.done} of ${st.total} · ${pct} %` : 'Getting started…'}</p>
        <div class="btnrow" style="margin-top:10px">
          <button class="btn ghost" id="importStop">Stop</button></div>
      </div>`;
  }
  if (st.error) {
    return `<div class="forhaand"><h3 style="color:var(--danger)">The import failed</h3>
      <p class="meta saetning">${esc(st.error)}</p></div>`;
  }
  // Kvitteringen. Den skal ogsaa sige, hvad der blev SPRUNGET OVER - en note,
  // der forsvandt tavst, opdages kun ved at taelle i begge ender.
  return `<div class="forhaand">
      <h3>Done</h3>
      <p class="meta saetning">${c.pages} pages · ${c.notebooks} notebooks · ${c.files} files ·
      ${c.links} internal links rewritten · ${c.tags} tags${c.updated ? ` · ${c.updated} updated` : ''}</p>
      ${c.moved ? `<p class="meta saetning">${c.moved} page${c.moved > 1 ? 's were' : ' was'} moved back
      into the structure the export describes — they had ended up somewhere else.</p>` : ''}
      ${st.skippedTotal ? `<details style="margin-top:10px">
        <summary class="meta saetning">${st.skippedTotal} skipped — see why</summary>
        <ul class="meta saetning">${st.skipped.map((s) =>
    `<li><code>${esc((s.sti || '').slice(-50))}</code> — ${esc(s.hvorfor)}</li>`).join('')}</ul>
      </details>` : ''}
    </div>`;
}

/**
 * Baandet i toppen. Det staar paa ENHVER skaerm, mens importen koerer -
 * ellers ser man ikke, at der sker noget, naar man klikker videre.
 */
function tegnImportBaand(st) {
  let host = document.getElementById('importBaand');
  if (!st || !st.running) { if (host) host.remove(); return; }
  if (!host) {
    host = document.createElement('div');
    host.id = 'importBaand';
    host.className = 'nudge';
    const main = document.querySelector('.main');
    if (!main) return;
    main.insertBefore(host, main.firstChild);
  }
  const pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
  host.innerHTML = `<span>Importing from Notion — ${esc(st.phase)} (${pct}%)</span>
    <button class="btn ghost" id="baandGa">Show</button>`;
  const knap = host.querySelector('#baandGa');
  if (knap) knap.addEventListener('click', () => gaaTil('import'));
}

/* ------------------------------- administratorens kodeordsnulstilling */

/*
 * Ruden, en administrator sætter et nyt kodeord i.
 *
 * ── Hvorfor kodeordet er SYNLIGT her ──────────────────────────────────────
 *
 * Et `type="password"` ville skjule det for den, der skal VIDEREGIVE det.
 * Admin sætter ikke kodeordet for sin egen skyld — han skal sige det til en
 * kollega bagefter, og en prik-række kan man ikke læse op. Modsat sit eget
 * kodeord, hvor felterne netop skal være skjulte, fordi ingen skal aflæse
 * dem over skulderen.
 *
 * ── Og hvorfor der er en »foreslå ét«-knap ────────────────────────────────
 *
 * Alternativet er, at der bliver skrevet »Sommer2026« ind, hver eneste gang.
 * Forslaget kommer fra `crypto.getRandomValues` — ikke fra `Math.random()`,
 * som hverken er tilfældig nok eller ment til det.
 */
function foreslaaKodeord() {
  // Ingen l/I/0/O: et kodeord, der skal læses op eller skrives af, må ikke
  // have tegn, man kan tage fejl af.
  const TEGN = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const tal = new Uint32Array(20);
  crypto.getRandomValues(tal);
  return [...tal].map((n) => TEGN[n % TEGN.length]).join('').replace(/(.{5})(?=.)/g, '$1-');
}

function visNulstilPanel(id, navn) {
  const gammel = document.getElementById('nulstilPanel');
  if (gammel) gammel.remove();

  const host = document.createElement('div');
  host.className = 'modal';
  host.id = 'nulstilPanel';
  host.innerHTML = `<div class="modal-kort">
      <div class="modal-top">
        <h2>Set a password for ${esc(pentBruger(navn))}</h2>
        <button class="iconbtn" id="nulstilLuk" aria-label="Close">${icon('luk', 16)}</button>
      </div>
      <div class="modal-krop">
        <label class="field"><span>New password</span>
          <input class="input" id="nulstilFelt" type="text" autocomplete="off"
            autocapitalize="none" autocorrect="off" spellcheck="false"
            placeholder="At least 8 characters"></label>
        <div class="btnrow" style="margin-top:10px">
          <button class="btn primary" id="nulstilGem">Set password</button>
          <button class="btn" id="nulstilForslag">Suggest one</button>
        </div>
        <p class="meta saetning" style="margin-top:12px">It is shown in full so you can pass it
        on. ${esc(pentBruger(navn))} is signed out everywhere the moment you set it, and should
        change it again under <strong>Your account</strong>. API keys are not touched.</p>
      </div>
    </div>`;
  document.body.appendChild(host);

  const luk = () => { host.remove(); document.removeEventListener('keydown', paaTast); };
  const paaTast = (e) => { if (e.key === 'Escape') { e.preventDefault(); luk(); } };
  document.addEventListener('keydown', paaTast);
  host.querySelector('#nulstilLuk').addEventListener('click', luk);
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });

  const felt = host.querySelector('#nulstilFelt');
  felt.focus();
  host.querySelector('#nulstilForslag').addEventListener('click', () => {
    felt.value = foreslaaKodeord();
    felt.focus();
    felt.select();
  });

  const gem = host.querySelector('#nulstilGem');
  const gaa = async () => {
    const ny = felt.value.trim();
    // Serveren afviser uanset hvad; det her er, for at man ikke skal proeve.
    if (ny.length < 8) { toast('The password must be at least 8 characters.'); felt.focus(); return; }
    gem.disabled = true;
    try {
      const r = await api('POST', `/api/v1/admin/users/${id}/password`, { next: ny });
      luk();
      toast(`${pentBruger(r.username || navn)} has a new password and is signed out everywhere.`);
    } catch (ex) {
      toast(ex.message);
      gem.disabled = false;
    }
  };
  gem.addEventListener('click', gaa);
  felt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); gaa(); }
    e.stopPropagation();
  });
}

/*
 * Det færdige bogmærke.
 *
 * Linket er ægte og trækbart: at trække det op i bogmærkelinjen er den måde,
 * et bogmærke installeres på, og en instruktion uden noget at trække i er
 * ingen instruktion. Kopier-knappen er til dem, der hellere vil indsætte det
 * i »nyt bogmærke«-dialogen — og til telefoner, hvor der ikke er en
 * bogmærkelinje at trække til.
 *
 * `onclick` returnerer false og gør ingenting: klikker man på linket HER,
 * ville browseren køre klippet på Sagus egen side. Det er ikke farligt, men
 * det ser ud som om knappen er i stykker.
 */
function visKlip(adresse, bog, maerke) {
  const ud = document.getElementById('klipUd');
  if (!ud) return;
  ud.innerHTML = `<div class="klip-faerdig">
      <p class="meta saetning"><strong>Drag this up to your bookmarks bar:</strong></p>
      <p style="margin:8px 0 12px"><a class="btn klip-link" id="klipLink">Save to Sagu</a></p>
      <div class="btnrow">
        <button class="btn" id="klipKopi">Copy the address</button>
      </div>
      <p class="meta saetning" style="margin-top:10px">Saves to
      <strong>${esc(bog || 'no notebook')}</strong>${maerke ? ` with <code>#${esc(maerke)}</code>` : ''}.
      Want it somewhere else too? Make a second one — each carries its own key.</p>
    </div>`;

  const link = ud.querySelector('#klipLink');
  link.href = adresse;
  link.addEventListener('click', (e) => { e.preventDefault(); toast('Drag it to your bookmarks bar instead.'); });

  ud.querySelector('#klipKopi').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(adresse);
      toast('Copied. Make a new bookmark and paste it as the address.');
    } catch {
      // Uden udklipsholder: vis den, saa den kan markeres i haanden.
      const felt = document.createElement('textarea');
      felt.className = 'input';
      felt.rows = 4;
      felt.value = adresse;
      felt.readOnly = true;
      ud.appendChild(felt);
      felt.select();
    }
  });
}

/* ------------------------------------------------------- nøglernes navne
 *
 * »Kan jeg ikke få samme navne som i doda under API adgange? Jeg kan godt se
 * at sagu har en link, men kan den ikke få en bedre beskrivelse så jeg kan se
 * hvornår jeg skal bruge den?« (Andreas, 2026-08-21).
 *
 * De hed `read`, `capture`, `link`, `full` — de rå ord fra `SCOPE_TILLADER`.
 * Et databasefelt er ikke en etiket: »link« siger ingenting om, hvad den kan
 * eller hvornår man vil have den, og man skulle læse et helt afsnit under
 * listen for at finde ud af det.
 *
 * De tre, doda også har, hedder nu **præcis det samme dér** — en familie af
 * apps, hvor det samme begreb hedder to ting, tvinger folk til at oversætte i
 * hovedet hver gang.
 *
 * `link` er Sagus egen, og den er den, der havde brug for forklaringen: den
 * kan læse OG lægge nyt ind, men aldrig ændre eller slette.
 *
 * ── Rækkefølgen er ikke tilfældig ─────────────────────────────────────────
 *
 * Den smalleste står øverst og er derfor forvalgt — samme som i doda. Den,
 * der ikke tager stilling, får den nøgle, der kan mindst.
 */
const SCOPES = [
  {
    id: 'capture',
    etiket: 'Capture only — can add, cannot read',
    hvornaar: 'An iPhone shortcut, a Siri command, the <strong>Save to Sagu</strong> bookmark — '
      + 'anything that only sends something in. Lose the phone and it cannot pull your archive out.',
  },
  {
    id: 'read',
    etiket: 'Read only',
    hvornaar: 'Something that looks but must never write: a script that searches your notes, '
      + 'a dashboard, a backup that mirrors the archive.',
  },
  {
    id: 'link',
    etiket: 'Read and add — cannot change or delete',
    hvornaar: 'Both of the above and nothing more — it can find the right note and add to it, '
      + 'but never rewrite or remove what is already there. Pick this when another program '
      + 'should be able to write <em>alongside</em> you rather than over you.',
  },
  {
    id: 'full',
    etiket: 'Full access',
    hvornaar: 'Everything above, and changing and deleting. Claude and other MCP clients need '
      + 'this to edit. No key can make another key or change your password — not even this one.',
  },
];

/** Ét sted at slå etiketten op, så tabellen og rullelisten ikke kan drive fra hinanden. */
function scopeNavn(id) {
  const s = SCOPES.find((x) => x.id === id);
  return s ? s.etiket : id;
}

/* ================================ totrinsbekræftelse (F21) ==============
 *
 * »doda har fået tilføjet 2FA kan du også tilføje det« (Andreas, 2026-08-22).
 *
 * ── Hvorfor den findes ved siden af passkeys ──────────────────────────────
 *
 * Passkeys er stærkere — de kan ikke phishes — men de kræver https, og Sagu
 * nås også på `IP:port` over ren http fra panelet, hvor `navigator.credentials`
 * slet ikke findes. Kodeordet skal derfor altid virke, og så er kodeordet
 * *alene* det svageste led. TOTP lukker netop dét hul, dér hvor en passkey
 * ikke kan (RUNE-ERFARINGER §9d).
 *
 * ── De to ting fladen skal gøre rigtigt ───────────────────────────────────
 *
 *  1. **Nødkoderne vises ÉN gang.** De hashes på serveren, præcis som et
 *     kodeord, så de kan ikke hentes frem igen. Ruden bliver derfor stående,
 *     til man selv lukker den — den må ikke forsvinde i en gentegning, sådan
 *     som bogmærket gjorde, før `genindlaes()` blev fjernet derfra.
 *  2. **Der står, hvad man mister.** At slå det fra kræver kodeordet, og det
 *     står skrevet, før man trykker — ikke i en fejlbesked bagefter.
 */
async function tegnTotp() {
  const host = document.getElementById('totpKort');
  if (!host) return;
  let st;
  try { st = await api('GET', '/api/v1/totp'); } catch { host.innerHTML = ''; return; }

  if (st.enabled) {
    host.innerHTML = `<p class="lead" style="margin-top:0">
        <strong>On.</strong> Signing in needs a code from your authenticator app.</p>
      <p class="meta saetning">${st.recoveryLeft} recovery code${st.recoveryLeft === 1 ? '' : 's'} left.
      They are the way back in if you lose the phone — there is no support desk on your own server.</p>
      <div class="btnrow" style="margin-top:12px">
        <button class="btn" id="totpNyeKoder">New recovery codes</button>
        <button class="btn ghost danger" id="totpFra">Turn off</button>
      </div>`;
    host.querySelector('#totpNyeKoder').addEventListener('click', () => spoergKodeord({
      titel: 'New recovery codes',
      forklaring: 'The ten you have now stop working the moment the new ones appear.',
      knap: 'Make new codes',
      sti: '/api/v1/totp/recovery',
      efter: (d) => visNoedkoder(d.recovery),
    }));
    host.querySelector('#totpFra').addEventListener('click', () => spoergKodeord({
      titel: 'Turn off two-step verification',
      forklaring: 'Your password alone will be enough to sign in again. '
        + 'The secret and every recovery code are deleted.',
      knap: 'Turn it off',
      sti: '/api/v1/totp/disable',
      efter: () => { toast('Two-step verification is off.'); tegnTotp(); },
    }));
    return;
  }

  host.innerHTML = `<p class="meta saetning">A code from an authenticator app as the second step,
    on top of your password. Passkeys are stronger, but they need https — this works on
    <code>IP:port</code> over plain http too, which is exactly where the password stands alone.</p>
    ${st.pending ? '<p class="meta saetning">A setup was started but never finished. '
    + 'Starting again gives you a new QR code.</p>' : ''}
    <div class="btnrow" style="margin-top:12px">
      <button class="btn primary" id="totpStart">${st.pending ? 'Start over' : 'Set it up'}</button>
    </div>
    <div id="totpOpsaet"></div>`;
  host.querySelector('#totpStart').addEventListener('click', () => startTotp());
}

async function startTotp() {
  const ud = document.getElementById('totpOpsaet');
  if (!ud) return;
  ud.innerHTML = '<p class="meta saetning">Making a secret…</p>';
  let d;
  try { d = await api('POST', '/api/v1/totp/setup', {}); } catch (ex) { toast(ex.message); ud.innerHTML = ''; return; }

  ud.innerHTML = `<div class="totp-opsaet">
      <div class="totp-qr">${d.svg}</div>
      <div class="totp-trin">
        <p class="meta saetning"><strong>1.</strong> Scan this with Google Authenticator,
        1Password, Aegis — any authenticator app.</p>
        <p class="meta saetning"><strong>Cannot scan?</strong> Type the secret by hand:<br>
          <code class="totp-hem">${esc(d.secret)}</code></p>
        <label class="field" style="margin-top:12px"><span><strong>2.</strong> The code it shows</span>
          <input class="input" id="totpKode" inputmode="numeric" autocomplete="one-time-code"
            placeholder="123456" spellcheck="false" style="max-width:150px"></label>
        <div class="btnrow" style="margin-top:10px">
          <button class="btn primary" id="totpBekraeft">Turn it on</button>
        </div>
        <p class="meta saetning" style="margin-top:10px">Nothing is switched on until that code
        fits. A mis-scan cannot lock you out of your own server.</p>
      </div>
    </div>`;

  const felt = ud.querySelector('#totpKode');
  const knap = ud.querySelector('#totpBekraeft');
  felt.focus();
  const gaa = async () => {
    const kode = felt.value.trim();
    if (kode.length < 6) { toast('Six digits from the app.'); felt.focus(); return; }
    knap.disabled = true;
    try {
      const r = await api('POST', '/api/v1/totp/enable', { code: kode });
      visNoedkoder(r.recovery);
      await tegnTotp();
    } catch (ex) { toast(ex.message); felt.value = ''; felt.focus(); knap.disabled = false; }
  };
  knap.addEventListener('click', gaa);
  felt.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); gaa(); } });
}

/*
 * Koderne vises ÉN gang.
 *
 * Serveren gemmer kun en hash af dem, præcis som et kodeord, så der er ingen
 * vej til at få dem at se igen. Ruden lukker derfor ikke af sig selv, og
 * teksten siger det højt — det er billigere end at forklare bagefter.
 */
function visNoedkoder(koder) {
  const gammel = document.getElementById('noedPanel');
  if (gammel) gammel.remove();
  const host = document.createElement('div');
  host.className = 'modal';
  host.id = 'noedPanel';
  host.innerHTML = `<div class="modal-kort">
      <div class="modal-top">
        <h2>Your recovery codes</h2>
        <button class="iconbtn" id="noedLuk" aria-label="Close">${icon('luk', 16)}</button>
      </div>
      <div class="modal-krop">
        <p class="lead">Save them now — <strong>they are never shown again.</strong>
        Each one works once, and they are the way back in if you lose the phone.</p>
        <div class="noedkoder">${koder.map((k) => `<code>${esc(k)}</code>`).join('')}</div>
        <div class="btnrow" style="margin-top:14px">
          ${navigator.clipboard ? '<button class="btn primary" id="noedKopi">Copy all</button>' : ''}
          <button class="btn" id="noedFaerdig">I have saved them</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(host);
  const luk = () => { host.remove(); document.removeEventListener('keydown', paaTast); };
  const paaTast = (e) => { if (e.key === 'Escape') { e.preventDefault(); luk(); } };
  document.addEventListener('keydown', paaTast);
  host.querySelector('#noedLuk').addEventListener('click', luk);
  host.querySelector('#noedFaerdig').addEventListener('click', luk);
  const kopi = host.querySelector('#noedKopi');
  if (kopi) {
    kopi.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(koder.join('\n')); toast('Copied.'); }
      catch { toast('Could not copy — select them by hand.'); }
    });
  }
  // Ingen lukning ved klik udenfor: det er for let at ramme ved siden af og
  // miste ti koder, man ikke kan faa igen.
}

/** Ruden, der beder om kodeordet, før noget farligt sker. */
function spoergKodeord(o) {
  const gammel = document.getElementById('kodeordPanel');
  if (gammel) gammel.remove();
  const host = document.createElement('div');
  host.className = 'modal';
  host.id = 'kodeordPanel';
  host.innerHTML = `<div class="modal-kort">
      <div class="modal-top">
        <h2>${esc(o.titel)}</h2>
        <button class="iconbtn" id="kpLuk" aria-label="Close">${icon('luk', 16)}</button>
      </div>
      <div class="modal-krop">
        <p class="meta saetning">${esc(o.forklaring)}</p>
        <label class="field" style="margin-top:12px"><span>Your password</span>
          <input class="input" id="kpFelt" type="password" autocomplete="current-password"></label>
        <div class="btnrow" style="margin-top:12px">
          <button class="btn primary" id="kpGem">${esc(o.knap)}</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(host);
  const luk = () => { host.remove(); document.removeEventListener('keydown', paaTast); };
  const paaTast = (e) => { if (e.key === 'Escape') { e.preventDefault(); luk(); } };
  document.addEventListener('keydown', paaTast);
  host.querySelector('#kpLuk').addEventListener('click', luk);
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });
  const felt = host.querySelector('#kpFelt');
  const knap = host.querySelector('#kpGem');
  felt.focus();
  const gaa = async () => {
    knap.disabled = true;
    try {
      const d = await api('POST', o.sti, { password: felt.value });
      luk();
      o.efter(d);
    } catch (ex) { toast(ex.message); felt.value = ''; felt.focus(); knap.disabled = false; }
  };
  knap.addEventListener('click', gaa);
  felt.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); gaa(); } });
}

/* ============================ versionshistorik (F22) ====================
 *
 * »Denne funktion skal kunne slås fra inde i indstillinger og det skal også
 * være muligt at sætte antallet af versioner den gemmer« (Andreas,
 * 2026-08-25).
 *
 * ── Indstillingen er PERSONLIG ────────────────────────────────────────────
 *
 * Sagu er flerbruger. Ville alice have historik og bob ikke, ville en
 * serverindstilling tvinge dem til at blive enige om noget, der kun handler
 * om deres egne noter.
 */
async function tegnVersioner() {
  const host = document.getElementById('versionKort');
  if (!host) return;
  let d;
  // Opsaetningen ligger paa versions-endepunktet, som kraever en NOTE. Har man
  // ingen, er der heller ingen historik at indstille - men kortet skal stadig
  // kunne vise kontakten, saa vi spoerger gennem den billigste vej der findes.
  try { d = await api('POST', '/api/v1/versions', {}); } catch { host.innerHTML = ''; return; }

  host.innerHTML = `<label class="switch">
      <input type="checkbox" id="verTil" ${d.enabled ? 'checked' : ''}>
      <span>Keep earlier versions of my notes</span></label>
    <p class="meta saetning">A version is kept each time you come back and change something.
    Edits within the same sitting count as one, so the ${esc(String(d.keep))} you keep cover
    ${esc(String(d.keep))} separate times you worked on the note — not the last few minutes.</p>
    <label class="field" style="margin-top:14px"><span>Versions to keep per note</span>
      <div class="btnrow">
        <input class="input" id="verAntal" type="number" min="1" max="200" step="1"
          style="max-width:110px" value="${esc(String(d.keep))}" ${d.enabled ? '' : 'disabled'}>
        <button class="btn" id="verGem" ${d.enabled ? '' : 'disabled'}>Save</button>
      </div></label>
    <p class="meta saetning">Turning it off stops new versions from being kept.
    <strong>What is already saved stays</strong> — it is a fact about the note, and throwing it
    away because you changed a setting would be rewriting history. Open a note's
    <strong>…</strong> menu to see and restore them.</p>`;

  host.querySelector('#verTil').addEventListener('change', async (e) => {
    try {
      await api('POST', '/api/v1/versions', { enabled: e.target.checked });
      toast(e.target.checked ? 'Versions are kept again.' : 'No new versions will be kept.');
      tegnVersioner();
    } catch (ex) { toast(ex.message); e.target.checked = !e.target.checked; }
  });
  const gem = host.querySelector('#verGem');
  if (gem) {
    gem.addEventListener('click', async () => {
      const antal = Number(host.querySelector('#verAntal').value);
      gem.disabled = true;
      try {
        await api('POST', '/api/v1/versions', { keep: antal });
        toast('Saved.');
        tegnVersioner();
      } catch (ex) { toast(ex.message); gem.disabled = false; }
    });
  }
}

/* ---- p3_passkey.js ---- */
'use strict';
/* Sagu - passkeys i browseren.
 *
 * Selve verifikationen ligger i app/webauthn.js paa serveren; her er kun
 * base64url-oversaettelsen og de to kald til navigator.credentials.
 *
 * Passkeys er et TILLAEG, aldrig en erstatning: panelet tilgaas paa IP:port
 * over ren http, hvor WebAuthn slet ikke findes. Et passkey-only login ville
 * laase Andreas ude af sin egen server (RUNE-ERFARINGER, Tilmeld). */

const kanPasskeys = () => !!(window.PublicKeyCredential && window.isSecureContext);

const fraB64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/')
  .padEnd(Math.ceil(String(s).length / 4) * 4, '=')), (c) => c.charCodeAt(0));

const tilB64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Opretter en passkey paa denne enhed. */
async function tilfoejPasskey() {
  if (!kanPasskeys()) throw new Error('This browser cannot use passkeys, or the page is not on https.');
  const o = await api('POST', '/api/passkey/register-options', {});
  const pk = o.publicKey;
  pk.challenge = fraB64u(pk.challenge);
  pk.user.id = fraB64u(pk.user.id);
  pk.excludeCredentials = (pk.excludeCredentials || [])
    .map((c) => ({ type: 'public-key', id: fraB64u(c.id) }));
  const cred = await navigator.credentials.create({ publicKey: pk });
  return api('POST', '/api/passkey/register', {
    challengeId: o.challengeId,
    name: String(navigator.platform || 'This device').slice(0, 60),
    attestationObject: tilB64u(cred.response.attestationObject),
    clientDataJSON: tilB64u(cred.response.clientDataJSON),
  });
}

/** Logger ind UDEN brugernavn - noeglen ved selv, hvem den hoerer til, og
    login-siden roeber dermed ikke, hvilke konti der findes. */
async function loginMedPasskey() {
  if (!kanPasskeys()) throw new Error('This browser cannot use passkeys, or the page is not on https.');
  const o = await api('POST', '/api/passkey/login-options', {});
  const pk = o.publicKey;
  pk.challenge = fraB64u(pk.challenge);
  pk.allowCredentials = [];
  const cred = await navigator.credentials.get({ publicKey: pk });
  return api('POST', '/api/passkey/login', {
    challengeId: o.challengeId,
    id: tilB64u(cred.rawId),
    authenticatorData: tilB64u(cred.response.authenticatorData),
    clientDataJSON: tilB64u(cred.response.clientDataJSON),
    signature: tilB64u(cred.response.signature),
  });
}

/* ---- p4_editor.js ---- */
'use strict';
/* Sagu - traeet i sidebaren og den hybride editor.
 *
 * Editorens model, som er hele F1:
 *
 *   Markdown ER noten. Visningen er renderet; klikker man i et afsnit, bliver
 *   PRAECIS det afsnit til et raat markdown-felt, og resten af noten bliver
 *   staaende renderet. Der er ingen konvertering nogen steder - feltet
 *   indeholder de linjer, der staar i databasen, og de skrives tilbage paa
 *   samme plads.
 *
 * Det er derfor `saguMarkdown.blokke()` giver linjenumre: uden dem ville man
 * skulle gaette, hvor et afsnit begynder, og et gem ville roere hele noten. */

const editor = {
  // Den note, der er INDLAEST. Ikke den, der er markeret i traeet - det er to
  // forskellige tilstande, og at blande dem er den klassiske fejl: markerer
  // man en raekke og giver editoren det lette listeobjekt, ser den samme id
  // og tegner aldrig den fulde note (Verdandes spec).
  note: null,
  indlaeser: null,        // id'et, der er paa vej ind
  aabenBlok: null,        // linjenummeret paa den blok, der redigeres raat
  gemTimer: null,
  gemmer: false,
  // F15: rettelsen ligger i koen og venter paa net.
  parkeret: false,
  // Hvor markoeren skal staa, naar naeste blok aabnes ('start' | null).
  markoerTil: null,
  beskidt: false,
  sidstGemt: 0,
  konflikt: null,
  /*
   * Foldningen LAESES her, ikke bare skrives.
   *
   * `laesFoldede()` fandtes, men blev aldrig kaldt: hver eneste foldning blev
   * skrevet trofast i localStorage og aldrig hentet frem igen. Det saa
   * rigtigt ud, saa laenge man blev paa siden, og var vaek ved naeste
   * genindlaesning - en indstilling, appen lod som om den huskede.
   *
   * Fundet, fordi de nyfoldede notesboeger stod aabne igen efter en
   * genindlaesning (Andreas, 2026-08-21).
   */
  foldede: laesFoldede(),
};

/* ------------------------------------------------------------- foldning */

/*
 * Foldede grene bliver i localStorage med vilje: hvor meget af traeet man vil
 * se ad gangen afhaenger af skaermens stoerrelse, saa det hoerer til ENHEDEN
 * og ikke til brugeren. Sorterings- og visningsvalg hoerer derimod til
 * kontoen (RUNE-ERFARINGER, tovo v11) - saa spoerg for hvert af dem.
 */
function laesFoldede() {
  try {
    const raa = localStorage.getItem('sagu_foldede');
    return new Set(raa ? JSON.parse(raa) : []);
  } catch { return new Set(); }
}

/*
 * Noeglen til hele notesbogs-sektionens foldning.
 *
 * Den ligger i det SAMME saet som de enkelte boeger (`editor.foldede`), saa
 * der kun er én mekanik og ét sted, valget gemmes - to maader at folde paa i
 * samme app er to steder at rette, naeste gang en af dem skal aendres
 * (RUNE-ERFARINGER, tovo v11).
 *
 * Sektionen husker desuden bøgernes egen foldning: den, der har foldet et
 * undertrae ud inde i en bog, skal have det, som han forlod det.
 */
const SEKTION_BOEGER = 'sektion:notebooks';

/** Samme mekanik for de loese noter - ét saet, ét sted det gemmes. */
const SEKTION_LOESE = 'sektion:loose';

/*
 * Notens to bilag - vedhaeftninger og kommentarer - i det SAMME saet.
 *
 * »Kan du lave saa Attachments og comments kan foldes sammen. Men skal vise
 * hvor mange der er« (Andreas, 2026-08-25). De ligger under noten og skubber
 * hinanden ned; med tre skaermbilleder paa er kommentarfeltet ude af syne.
 *
 * De starter FOLDET UD - som i dag. Andreas bad om at kunne folde dem, ikke
 * om at faa dem gemt vaek, og at skjule hans kommentarer uden at spoerge er
 * ikke en foldeknap, det er en aendring han ikke bad om. Folder han dem
 * sammen én gang, bliver de det.
 *
 * Det giver samtidig ÉN betydning i saettet: at staa i `editor.foldede`
 * betyder foldet - praecis som for notesboegerne. Skulle de starte foldet,
 * skulle noeglen betyde det modsatte, og saa var der to konventioner i samme
 * saet at tage fejl af.
 *
 * Antallet staar paa knappen, saa man ved, hvad man folder ud - samme grund
 * som fillisten i indstillingerne (v15) og wikiens navigation.
 *
 * Valget er GLOBALT og ikke pr. note. Den, der aldrig kigger paa
 * vedhaeftninger, skal ikke folde dem sammen én gang pr. note; og den, der
 * altid vil se dem, skal ikke folde dem ud igen hver gang. Samtidig loeser
 * det, at begge afsnit tegnes om under brug - en ny kommentar tegner
 * afsnittet forfra, og uden en husket tilstand ville det klappe i, hver gang
 * man skrev noget.
 */
const BILAG_FILER = 'bilag:files';
const BILAG_KOM = 'bilag:comments';
const BILAG_DODA = 'bilag:doda';

/** Er bilaget foldet ud? */
function bilagAabent(noegle) {
  return !editor.foldede.has(noegle);
}

/**
 * Bind et `<details>` op, saa dets tilstand overlever en optegning.
 *
 * `toggle` og ikke et klik paa `summary`: browseren aabner ogsaa med
 * mellemrum og Enter, og et klik-lytter ville gaa glip af dem.
 */
function bindBilagsfold(host, noegle) {
  const d = host && host.querySelector('details.bilagfold');
  if (!d) return;
  d.addEventListener('toggle', () => {
    if (d.open) editor.foldede.delete(noegle);
    else editor.foldede.add(noegle);
    gemFoldede();
  });
}

/**
 * Er ALLE notesboeger foldet sammen?
 *
 * Knappen skal sige, hvad den GOER - ikke hvad tilstanden er. To modsatte
 * konventioner side om side er det, der goer en omskifter uforstaaelig
 * (RUNE-ERFARINGER, tovo v9).
 */
function altFoldet(boeger) {
  return boeger.length > 0 && boeger.every((b) => editor.foldede.has(b.id));
}

/**
 * Folder alle notesboeger sammen - eller ud igen.
 *
 * To forskellige oensker, to forskellige knapper: sektionens overskrift
 * gemmer HELE listen vaek, mens denne beholder bognavnene og lukker deres
 * sider. Kun BOEGERNE roeres; den, der har foldet et undertrae ud inde i en
 * bog, skal have det, som han forlod det.
 */
function saetAlleFoldede(fold) {
  for (const b of state.notebooks || []) {
    if (fold) editor.foldede.add(b.id);
    else editor.foldede.delete(b.id);
  }
  gemFoldede();
  tegnTrae();
}

function gemFoldede() {
  try { localStorage.setItem('sagu_foldede', JSON.stringify([...editor.foldede])); } catch { /* privat */ }
}

/*
 * ── En notesbog, man ikke har set foer, starter FOLDET ─────────────────────
 *
 * Med syv boeger og tredive importerede sider er sidebaren en mur, foerste
 * gang man aabner appen paa en ny skaerm. Andreas bad om det modsatte
 * udgangspunkt: alt lukket, saa man selv folder ud, hvad man skal bruge
 * (2026-08-21).
 *
 * Det naive var at folde alle boeger ved hver indlaesning. Men saettet
 * husker de FOLDEDE, saa en bog, man har aabnet med vilje, ville blive
 * lukket igen ved naeste besoeg - appen ville glemme et valg, brugeren har
 * truffet, og det er vaerre end en lang liste.
 *
 * Derfor huskes ogsaa, hvilke boeger vi har SET. Er en bog kendt, staar
 * brugerens valg; er den ny, folder vi den. Saa gaelder reglen ogsaa den
 * bog, en import lige har lagt ind.
 */
const SETE_NOEGLE = 'sagu_sete_boeger';

function laesSete() {
  try { return new Set(JSON.parse(localStorage.getItem(SETE_NOEGLE) || '[]')); } catch { return new Set(); }
}

/**
 * Folder de notesboeger sammen, vi ikke har moedt foer.
 *
 * @returns {boolean} true, hvis noget blev foldet - saa kalderen ved, om
 *                    traeet skal tegnes om.
 */
function foldNyeBoeger() {
  const sete = laesSete();
  let aendret = false;
  for (const b of state.notebooks || []) {
    if (sete.has(b.id)) continue;
    sete.add(b.id);
    editor.foldede.add(b.id);
    aendret = true;
  }
  if (aendret) {
    try { localStorage.setItem(SETE_NOEGLE, JSON.stringify([...sete])); } catch { /* privat */ }
    gemFoldede();
  }
  return aendret;
}

/** En bog, brugeren selv har lavet, skal staa aaben - han skal jo bruge den. */
function markerSetOgAaben(id) {
  const sete = laesSete();
  sete.add(id);
  try { localStorage.setItem(SETE_NOEGLE, JSON.stringify([...sete])); } catch { /* privat */ }
  editor.foldede.delete(id);
  gemFoldede();
}

/* --------------------------------------------------------------- traeet */

async function hentTrae() {
  try {
    const d = await api('GET', '/api/v1/tree');
    state.notebooks = d.notebooks;
    state.tree = d.notes;
    foldNyeBoeger();
  } catch (ex) {
    if (ex.status !== 401) toast(ex.message);
    state.tree = state.tree || [];
  }
}

/** Boern af én foraelder, i den raekkefoelge brugeren har sat. */
function boernAf(foraelderId, notesbogId) {
  return (state.tree || []).filter((n) => n.parentId === foraelderId
    && (foraelderId !== null || n.notebookId === notesbogId));
}

function traeHtml() {
  const boeger = state.notebooks || [];
  const loese = boernAf(null, null);

  const gren = (note, dybde) => {
    const boern = boernAf(note.id, null);
    const foldet = editor.foldede.has(note.id);
    const aktiv = editor.note && editor.note.id === note.id;
    const markeret = valgte.has(note.id);
    return `<div class="tree-row${aktiv ? ' on' : ''}${markeret ? ' valgt' : ''}" data-raekke="${esc(note.id)}"
        style="padding-left:${8 + dybde * 14}px">
        ${boern.length
    ? `<button class="tree-fold${foldet ? '' : ' open'}" data-fold="${esc(note.id)}"
           aria-label="${foldet ? 'Expand' : 'Collapse'}">${icon('caret', 12)}</button>`
    : '<span class="tree-fold empty"></span>'}
        <button class="tree-name" data-note="${esc(note.id)}" title="${esc(note.title || 'Untitled')}">
          ${note.icon ? `<span class="tree-icon">${esc(note.icon)}</span>` : ''}
          <span>${esc(note.title || 'Untitled')}</span></button>
        <button class="tree-add" data-sub="${esc(note.id)}" aria-label="New subpage"
          title="New subpage">${icon('plus', 13)}</button>
      </div>
      ${foldet ? '' : boern.map((b) => gren(b, dybde + 1)).join('')}`;
  };

  const bogHtml = (b) => {
    const foldet = editor.foldede.has(b.id);
    const boern = boernAf(null, b.id);
    return `<div class="tree-book${foldet ? '' : ' open'}">
        <div class="tree-row book" data-bograekke="${esc(b.id)}">
          <button class="tree-fold${foldet ? '' : ' open'}" data-fold="${esc(b.id)}"
            aria-label="${foldet ? 'Expand' : 'Collapse'}">${icon('caret', 12)}</button>
          <button class="tree-ikonknap" data-bogikon="${esc(b.id)}"
            aria-label="Pick an icon">${esc(b.icon || '📓')}</button>
          <button class="tree-name" data-book="${esc(b.id)}" title="${esc(b.name)}">
            <span>${esc(b.name)}</span></button>
          <button class="tree-del${b.published ? ' paa' : ''}" data-udgivbog="${esc(b.id)}"
            data-navn="${esc(b.name)}"
            aria-label="${b.published ? 'Published on the web' : 'Publish this notebook'}"
            title="${b.published ? 'Published on the web — open the settings' : 'Publish this notebook'}"
            >${icon('globe', 13)}</button>
          <button class="tree-add" data-in="${esc(b.id)}" aria-label="New note here"
            title="New note here">${icon('plus', 13)}</button>
          <button class="tree-add" data-bogmenu="${esc(b.id)}" data-navn="${esc(b.name)}"
            aria-label="More" title="Rename or delete">${icon('dots', 13)}</button>
        </div>
        ${foldet ? '' : boern.map((x) => gren(x, 1)).join('')}
      </div>`;
  };

  /*
   * Sektionens egen overskrift med en fold.
   *
   * Med tredive importerede notesboeger er sidebaren en mur, og der er ingen
   * vej til at lukke den samlet. Overskriften folder HELE sektionen - det er
   * ét klik i stedet for tredive, og det er den vane, resten af familien har
   * (Andreas, 2026-08-21).
   */
  const sektionFoldet = editor.foldede.has(SEKTION_BOEGER);
  return `<div class="tree">
      <div class="tree-sektion">
        <button class="tree-sektion-navn" data-fold="${SEKTION_BOEGER}"
          aria-expanded="${sektionFoldet ? 'false' : 'true'}"
          title="${sektionFoldet ? 'Show the notebooks' : 'Fold the notebooks away'}">
          <span class="tree-fold${sektionFoldet ? '' : ' open'}">${icon('caret', 12)}</span>
          <span>Notebooks</span>
          ${boeger.length ? `<span class="tree-sektion-tal">${boeger.length}</span>` : ''}
        </button>
        ${boeger.length > 1 && !sektionFoldet ? `<button class="tree-sektion-add" id="foldAlle"
          aria-label="${altFoldet(boeger) ? 'Open every notebook' : 'Fold every notebook'}"
          title="${altFoldet(boeger) ? 'Open every notebook' : 'Fold every notebook'}">${
  icon(altFoldet(boeger) ? 'udfold' : 'fold', 13)}</button>` : ''}
        <button class="tree-sektion-add" id="nyBogHer" aria-label="New notebook"
          title="New notebook">${icon('plus', 13)}</button>
      </div>
      ${sektionFoldet ? '' : boeger.map(bogHtml).join('')}
      ${sektionFoldet || !loese.length ? '' : (() => {
    /*
     * »Not in a notebook« kan foldes som alt andet i traeet.
     *
     * Den var den ENESTE raekke uden en fold, og med tredive loese noter er
     * den en mur under boegerne. Valget gemmes samme sted som alle de andre
     * foldninger - to maader at folde paa i samme app er to steder at rette
     * (RUNE-ERFARINGER, tovo v11).
     */
    const foldet = editor.foldede.has(SEKTION_LOESE);
    return `<div class="tree-book${foldet ? '' : ' open'}">
        <div class="tree-row book">
          <button class="tree-fold${foldet ? '' : ' open'}" data-fold="${SEKTION_LOESE}"
            aria-label="${foldet ? 'Expand' : 'Collapse'}">${icon('caret', 12)}</button>
          <button class="tree-name meta" data-fold="${SEKTION_LOESE}"
            title="Not in a notebook"><span>Not in a notebook</span></button>
          ${foldet ? `<span class="tree-antal">${loese.length}</span>` : ''}
        </div>
        ${foldet ? '' : loese.map((x) => gren(x, 1)).join('')}</div>`;
  })()}
      <div class="tree-actions">
        <button class="btn ghost" id="nyNoteTop">${icon('plus', 14)} New note</button>
        <button class="btn ghost" id="dagensNote">${icon('kalender', 14)} Today's note</button>
        <button class="btn ghost" id="fraSkabelon">${icon('skabelon', 14)} From template</button>
        <button class="btn ghost" id="nyBogTop">${icon('book', 14)} New notebook</button>
      </div>
    </div>`;
}

/*
 * Notesbogens menu: omdoeb og slet.
 *
 * Serveren har kunnet begge dele siden F1 (`PATCH` og `DELETE` paa
 * `/api/v1/notebooks/:id`) - der var bare ingen vej derhen i fladen. Andreas
 * spurgte, hvordan man sletter en notesbog, og det korte svar var »det kan du
 * ikke« (2026-08-21). **En rute uden en knap er ikke en funktion.**
 */
function visBogMenu(anker, id, navn) {
  const gammel = document.getElementById('bogMenu');
  if (gammel) { gammel.remove(); return; }
  const raekke = anker.closest('.tree-row');
  if (!raekke) return;

  const host = document.createElement('div');
  host.className = 'usermenu notemenu';
  host.id = 'bogMenu';
  host.innerHTML = `
    <button class="usermenu-item" data-do="navn">${icon('notes', 16)}<span>Rename…</span></button>
    <button class="usermenu-item" data-do="bog-udgiv">${icon('globe', 16)}<span>Publish this notebook</span></button>
    <button class="usermenu-item" data-do="flet">${icon('ind', 16)}<span>Merge into another…</span></button>
    <button class="usermenu-item danger" data-do="slet">${icon('trash', 16)}<span>Move to trash</span></button>`;
  raekke.appendChild(host);

  const luk = () => host.remove();
  host.querySelectorAll('[data-do]').forEach((el) => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const hvad = el.dataset.do;
      luk();
      try {
        if (hvad === 'navn') {
          const nyt = prompt('Name of the notebook', navn);
          if (nyt === null || !nyt.trim()) return;
          await api('PATCH', `/api/v1/notebooks/${id}`, { name: nyt.trim() });
        } else if (hvad === 'bog-udgiv') {
          visUdgivPanel({ slags: 'bog', id, titel: navn });
          return;
        } else if (hvad === 'flet') {
          visFletRude(id, navn);
          return;
        } else if (hvad === 'slet') {
          /*
           * Sig HVOR MANGE noter der foelger med.
           *
           * En notesbog er ikke tom, og »slet notesbogen?« lyder som om det
           * kun er selve bogen. Noterne gaar i papirkurven SAMMEN med den og
           * kan gendannes sammen med den - men det skal staa der, foer man
           * trykker, ikke bagefter.
           */
          const antal = (state.tree || []).filter((n) => n.notebookId === id).length;
          const spoergsmaal = antal
            ? `Move “${navn}” and its ${antal} note${antal === 1 ? '' : 's'} to the trash?\n\n`
              + 'They can be restored together from the trash.'
            : `Move “${navn}” to the trash?`;
          if (!confirm(spoergsmaal)) return;
          const d = await api('DELETE', `/api/v1/notebooks/${id}`);
          toast(d.notes
            ? `Notebook and ${d.notes} note${d.notes === 1 ? '' : 's'} moved to the trash.`
            : 'Notebook moved to the trash.');
          // Stod man i en note fra bogen, er den vaek nu.
          if (editor.note && editor.note.notebookId === id) gaaTil('notes');
        }
        await hentTrae();
        await hentState();
        tegnTrae();
        opdaterNav();
      } catch (ex) { toast(ex.message); }
    });
  });

  setTimeout(() => {
    document.addEventListener('click', function udenfor(e) {
      if (host.isConnected && !host.contains(e.target) && e.target !== anker) {
        luk();
        document.removeEventListener('click', udenfor);
      }
    });
  }, 0);
}

/* ------------------------------------------- markering af flere noter (F26)
 *
 * »kan du lave saa man kan markere flere noter i venstre side. saa man fx kan
 * flytte flere noter paa en gang?« (Andreas, 2026-09-01).
 *
 * ── Hvorfor ⌘/Ctrl-klik og ikke afkrydsningsfelter ────────────────────────
 *
 * Et felt pr. raekke ville staa fremme i sidebaren hele tiden - i en liste med
 * 945 noter er det 945 felter, man ikke bruger. ⌘-klik er den gestus, enhver
 * filliste bruger, og den koster ingen pixels, foer man tager den i brug.
 *
 * Prisen er, at den ikke findes paa touch. Derfor: **det foerste ⌘-klik
 * taender en markerings-tilstand**, og saa vaelger et almindeligt klik til og
 * fra, saa laenge der er noget markeret. Paa en telefon kan man ikke starte
 * den - og dét er en aaben ende, ikke en loesning. Den staar skrevet ned.
 *
 * ── Hvorfor markeringen ikke overlever en optegning af traeet ─────────────
 *
 * Den goer den. `valgte` er et Set uden for optegningen, og hver raekke faar
 * sin klasse ved tegningen. Ellers ville en flytning - som netop tegner
 * traeet om - rydde markeringen midt i, at man arbejdede med den.
 */
const valgte = new Set();

/** Er der en markering i gang? */
function harValgte() { return valgte.size > 0; }

function ryddValgte() {
  if (!valgte.size) return;
  valgte.clear();
  tegnTrae();
}

/**
 * Skifter markeringen paa én note.
 *
 * `shift` tager spannet fra den sidst markerede - som i enhver anden liste.
 * Raekkefoelgen er den, TRAEET viser, ikke den, noterne blev lavet i: man
 * peger paa to raekker paa skaermen og mener alt imellem dem.
 */
let sidstValgt = null;
function skiftValgt(id, medShift) {
  const raekker = [...document.querySelectorAll('#treeHost [data-note]')]
    .map((el) => el.dataset.note);
  if (medShift && sidstValgt && raekker.includes(sidstValgt) && raekker.includes(id)) {
    const a = raekker.indexOf(sidstValgt);
    const b = raekker.indexOf(id);
    for (const n of raekker.slice(Math.min(a, b), Math.max(a, b) + 1)) valgte.add(n);
  } else if (valgte.has(id)) {
    valgte.delete(id);
  } else {
    valgte.add(id);
  }
  sidstValgt = id;
  tegnTrae();
}

/**
 * Baandet over traeet: hvor mange, og hvad man kan goere.
 *
 * Det staar OVER listen og ikke som en svaevende bjaelke: sidebaren er smal,
 * og en bjaelke hen over den ville daekke netop de raekker, man er ved at
 * vaelge.
 */
function valgtBaandHtml() {
  if (!harValgte()) return '';
  return `<div class="valgtbaand">
      <span class="valgtbaand-tal">${valgte.size} selected</span>
      <button class="btn ghost" id="valgtFlyt">Move…</button>
      <button class="linkbtn" id="valgtRyd">Clear</button>
    </div>`;
}

function bindValgtBaand(host) {
  const flyt = host.querySelector('#valgtFlyt');
  if (flyt) flyt.addEventListener('click', () => visFlytMangeRude());
  const ryd = host.querySelector('#valgtRyd');
  if (ryd) ryd.addEventListener('click', () => ryddValgte());
}

/** Ruden: hvor skal de hen? */
function visFlytMangeRude() {
  const ider = [...valgte];
  if (!ider.length) return;
  const boeger = state.notebooks || [];
  const host = document.createElement('div');
  host.className = 'modal';
  host.id = 'flytMangeRude';
  host.innerHTML = `<div class="modal-kort">
      <div class="modal-top">
        <h2>Move ${ider.length} note${ider.length === 1 ? '' : 's'}</h2>
        <button class="iconbtn" id="fmLuk" aria-label="Close">${icon('luk', 16)}</button>
      </div>
      <div class="modal-krop">
        <p class="meta saetning">Subpages come along. Is a page and its own subpage both
        selected, only the page moves — the subpage follows it, so the branch stays whole.</p>
        <label class="field"><span>Notebook</span>
          <select class="input" id="fmBog">
            <option value="">No notebook</option>
            ${boeger.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}
          </select></label>
        <div class="btnrow" style="margin-top:16px">
          <button class="btn primary" id="fmGem">Move</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(host);

  const luk = () => { host.remove(); document.removeEventListener('keydown', paaTast); };
  const paaTast = (e) => { if (e.key === 'Escape') { e.preventDefault(); luk(); } };
  document.addEventListener('keydown', paaTast);
  host.querySelector('#fmLuk').addEventListener('click', luk);
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });

  host.querySelector('#fmGem').addEventListener('click', async () => {
    const bog = host.querySelector('#fmBog').value || null;
    const navn = bog ? (boeger.find((b) => b.id === bog) || {}).name : 'no notebook';
    try {
      const r = await api('POST', '/api/v1/notes/move', { ids: ider, notebookId: bog });
      luk();
      valgte.clear();
      toast(r.skipped
        ? `${r.moved} moved to “${navn}” — ${r.skipped} came along as `
          + `${r.skipped === 1 ? 'a subpage' : 'subpages'}.`
        : `${r.moved} note${r.moved === 1 ? '' : 's'} moved to “${navn}”.`);
      await hentTrae();
      await hentState();
      tegnTrae();
      opdaterNav();
      // Stod man i en af dem, skal broedkrummerne vise den nye bog.
      if (editor.note && ider.includes(editor.note.id)) await aabnNote(editor.note.id, true);
    } catch (ex) { toast(ex.message); }
  });
}

/* ---------------------------------------- dato- og tidsgenveje (F27)
 *
 * »Jeg vil gerne have en shortcut til at kunne skrive dd-mm-yyyy og hh:mm«
 * (Andreas, 2026-09-02). Han valgte praefiks-formen frem for bare ord.
 *
 * ── Hvorfor et praefiks og ikke bare »dmy« ───────────────────────────────
 *
 * Fordi `dmy` og `hhmm` ogsaa er noget, man kan komme til at skrive - i en
 * note om datoformater, i et kodeeksempel, midt i et ord. En erstatning, der
 * slaar til uden at man bad om det, er vaerre end ingen genvej: man opdager
 * den foerst, naar teksten er forkert.
 *
 * `/` kan ikke rammes ved et uheld midt i et ord, fordi den kun taeller ved
 * starten af en linje eller efter et mellemrum.
 *
 * ── Hvorfor den udloeser med det samme ───────────────────────────────────
 *
 * Alternativet var at vente paa mellemrum eller Enter. Men det, Andreas
 * skriver, er linjer som »01.09.2026, 08.21 : Colestyramin 4g« - dato,
 * komma, tid. Skulle hver genvej afsluttes med et mellemrum, ville han faa et
 * mellemrum, han ikke bad om, lige dér hvor kommaet skal staa.
 *
 * Prisen er, at man ikke kan skrive `/dmy` bogstaveligt i en note. Det er en
 * pris, der er vaerd at betale for to tegn faerre pr. linje, og der er en vej
 * udenom: skriv det i en kodestump.
 */
const TEKSTGENVEJE = [
  {
    ord: '/dmy',
    navn: 'Today’s date',
    eksempel: '02-09-2026',
    lav: (d) => `${String(d.getDate()).padStart(2, '0')}-${
      String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`,
  },
  {
    ord: '/hhmm',
    navn: 'The time now',
    eksempel: '14:32',
    lav: (d) => `${String(d.getHours()).padStart(2, '0')}:${
      String(d.getMinutes()).padStart(2, '0')}`,
  },
  /*
   * Begge dele paa én gang.
   *
   * Formen er den, registreringslinjerne faktisk har: dato, komma, tid -
   * »02-09-2026, 07:18 : Colestyramin 4g«. To genveje pr. linje bliver til én.
   *
   * Den hedder `/now` og ikke `/nu`: interfacet er engelsk (CLAUDE.md), og
   * `/nu` var mit danske ord i et tilbud, ikke et oenske. `/dmy` og `/hhmm`
   * er engelske forkortelser, og den tredje skal laeses i samme sprog.
   *
   * Den bygges af de TO ovenfor frem for at formatere forfra - saa kan de tre
   * ikke komme til at vise forskellige datoer, den dag formatet aendres.
   */
  {
    ord: '/now',
    navn: 'Date and time',
    eksempel: '02-09-2026, 14:32',
    lav: (d) => `${TEKSTGENVEJE[0].lav(d)}, ${TEKSTGENVEJE[1].lav(d)}`,
  },
];

/**
 * Bytter en genvej ud, hvis markoeren staar lige efter én.
 *
 * Returnerer sandt, hvis der blev byttet - saa kalderen ved, at feltet har
 * aendret sig og skal skrives tilbage.
 *
 * Erstatningen sker med `setRangeText`, ikke ved at saette `value`: den
 * bevarer browserens EGEN fortrydelseshistorik, saa ⌘Z tager genvejen tilbage
 * i stedet for at rulle hele afsnittet tilbage.
 */
function byttedeTekstgenvej(felt) {
  const pos = felt.selectionStart;
  if (pos !== felt.selectionEnd) return false;
  const foer = felt.value.slice(0, pos);
  for (const g of TEKSTGENVEJE) {
    if (!foer.endsWith(g.ord)) continue;
    // Kun ved linjestart eller efter et mellemrum - ellers rammer den midt i
    // et ord som `og/dmy`.
    const tegnFoer = foer[foer.length - g.ord.length - 1];
    if (tegnFoer !== undefined && !/\s/.test(tegnFoer)) continue;
    const start = pos - g.ord.length;
    try {
      felt.setRangeText(g.lav(new Date()), start, pos, 'end');
    } catch {
      // Uden setRangeText: bytt i strengen. Fortrydelsen bliver grovere.
      const ny = felt.value.slice(0, start) + g.lav(new Date()) + felt.value.slice(pos);
      const nyPos = start + g.lav(new Date()).length;
      felt.value = ny;
      felt.setSelectionRange(nyPos, nyPos);
    }
    return true;
  }
  return false;
}

function bindTrae() {
  const host = document.getElementById('treeHost');
  if (!host) return;
  bindTraeTraek(host);

  host.querySelectorAll('[data-udgivbog]').forEach((el) => {
    el.addEventListener('click', (e) => {
      // Raekken aabner bogen ved klik; knappen goer noget andet.
      e.stopPropagation();
      visUdgivPanel({ slags: 'bog', id: el.dataset.udgivbog, titel: el.dataset.navn });
    });
  });

  const foldKnap = document.getElementById('foldAlle');
  if (foldKnap) {
    foldKnap.addEventListener('click', (e) => {
      // Knappen ligger inde i sektionsoverskriften, som selv folder ved klik.
      e.stopPropagation();
      saetAlleFoldede(!altFoldet(state.notebooks || []));
    });
  }

  host.querySelectorAll('[data-fold]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.dataset.fold;
      if (editor.foldede.has(id)) editor.foldede.delete(id);
      else editor.foldede.add(id);
      gemFoldede();
      tegnTrae();
    });
  });

  host.querySelectorAll('[data-note]').forEach((el) => {
    el.addEventListener('click', (e) => {
      /*
       * ⌘/Ctrl vaelger, shift tager spannet - og naar der ALLEREDE er en
       * markering i gang, vaelger et almindeligt klik ogsaa til og fra.
       *
       * Den sidste del er udtrykkeligt oensket: »det kraever ikke at jeg
       * benytter command ... hvilket ogsaa er det jeg oensker« (Andreas,
       * 2026-09-01). Jeg havde lige fjernet den med den begrundelse, at ét
       * fejlramt ⌘-klik saa laaser den primaere handling - at aabne en note.
       * Den indvending var teoretisk; hans brug er det ikke.
       *
       * Men laasen SKAL kunne aabnes uden at lede: derfor rydder **Escape**
       * markeringen, og »Clear« staar i baandet. Uden en vej ud ville et
       * uheld koste én en rundtur gennem sidebaren for at finde knappen.
       */
      if (e.metaKey || e.ctrlKey || e.shiftKey || harValgte()) {
        e.preventDefault();
        skiftValgt(el.dataset.note, e.shiftKey);
        return;
      }
      aabnNote(el.dataset.note);
    });
  });
  bindValgtBaand(host);

  host.querySelectorAll('[data-sub]').forEach((el) => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      await opretOgAaben({ parentId: el.dataset.sub });
    });
  });

  host.querySelectorAll('[data-in]').forEach((el) => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      await opretOgAaben({ notebookId: el.dataset.in });
    });
  });

  host.querySelectorAll('[data-book]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.dataset.book;
      if (editor.foldede.has(id)) editor.foldede.delete(id);
      else editor.foldede.add(id);
      gemFoldede();
      tegnTrae();
    });
  });

  host.querySelectorAll('[data-bogmenu]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      visBogMenu(el, el.dataset.bogmenu, el.dataset.navn);
    });
  });

  host.querySelectorAll('[data-bogikon]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const b = (state.notebooks || []).find((x) => x.id === el.dataset.bogikon);
      visIkonVaelger(el, b && b.icon, async (valgt) => {
        try {
          await api('PATCH', `/api/v1/notebooks/${el.dataset.bogikon}`, { icon: valgt });
          await hentTrae();
          tegnTrae();
        } catch (ex) { toast(ex.message); }
      });
    });
  });

  const nyN = document.getElementById('nyNoteTop');
  if (nyN) nyN.addEventListener('click', () => opretOgAaben({}));
  const dagens = document.getElementById('dagensNote');
  if (dagens) dagens.addEventListener('click', aabnDagensNote);

  const skab = document.getElementById('fraSkabelon');
  if (skab) {
    skab.addEventListener('click', () => {
      const gammel = document.getElementById('skabelonMenu');
      if (gammel) { gammel.remove(); return; }
      const m = document.createElement('div');
      m.className = 'usermenu skabelonmenu';
      m.id = 'skabelonMenu';
      m.innerHTML = SKABELONER.map((x) =>
        `<button class="usermenu-item" data-skab="${esc(x.id)}">${esc(x.navn)}</button>`).join('');
      skab.parentElement.appendChild(m);
      m.querySelectorAll('[data-skab]').forEach((el) => {
        el.addEventListener('click', async () => { m.remove(); await opretFraSkabelon(el.dataset.skab); });
      });
      setTimeout(() => {
        document.addEventListener('click', function udenfor(e) {
          if (m.isConnected && !m.contains(e.target) && !skab.contains(e.target)) {
            m.remove();
            document.removeEventListener('click', udenfor);
          }
        });
      }, 0);
    });
  }

  // To knapper, ÉN handler: plusset i sektionsoverskriften og linjen nederst
  // goer det samme, og skal derfor ikke kunne komme til at goere hver sit.
  [document.getElementById('nyBogTop'), document.getElementById('nyBogHer')].forEach((nyB) => {
    if (!nyB) return;
    nyB.addEventListener('click', async () => {
      const navn = prompt('Name of the notebook');
      if (!navn) return;
      try {
        const d = await api('POST', '/api/v1/notebooks', { name: navn });
        await hentTrae();
        // En bog, man lige har bedt om, skal staa aaben - ellers ser det ud,
        // som om der ikke skete noget.
        if (d && d.notebook) markerSetOgAaben(d.notebook.id);
        tegnTrae();
      } catch (ex) { toast(ex.message); }
    });
  });
}

/* ============================================ traek i traeet (Andreas' oenske)

   »Man skal kunne flytte rundt paa raekkefoelgen af noter med musen.«

   POINTER-events, ikke HTML5 drag & drop: DnD virker ikke paa touch, og
   `pointerdown/move/up` + `setPointerCapture` er de samme paa mus, pen og
   finger (RUNE-ERFARINGER §4, tovo v3).

   Traekket er alligevel kun for MUS og PEN. Paa en telefon ejer fingeren
   rulningen af sidebaren, og et traek, der stjaeler den, goer listen ubrugelig
   - derfor har note-menuen »Move up«/»Move down«, som virker med mus,
   tastatur og tommelfinger (doda F3's regel om at knapper er den ENE loesning,
   der virker alle tre steder). To veje til det samme, ikke to halve.

   Det, der falder, er en SOESKENDE til den raekke, man slipper paa - foer
   eller efter, afgjort af midten. Saa er der ét at forstaa: linjen viser,
   hvor den lander. Slipper man paa en NOTESBOG, flytter noten ind i den. */

const traek = { id: null, fra: null, aktiv: false, x: 0, y: 0, linje: null };

/**
 * Synker den AABNE note med traeet efter en flytning.
 *
 * Traeet hentes friskt, men `editor.note` er et objekt fra et tidligere kald -
 * og broedkrummerne, menuen og »Move to top level« laeser den. Uden det her
 * staar de og siger, hvad der var sandt foer flytningen: menuen tilboed
 * »Make it a subpage of X« igen paa en note, der lige var blevet én.
 */
function synkAabenNote() {
  if (!editor.note) return;
  const frisk = (state.tree || []).find((n) => n.id === editor.note.id);
  if (!frisk) return;
  editor.note.parentId = frisk.parentId;
  editor.note.notebookId = frisk.notebookId;
  tegnSide();
}

/** Noten som `state.tree` kender den. */
function traeNote(id) {
  return (state.tree || []).find((n) => n.id === id) || null;
}

/** Er `maal` en efterkommer af `id`? Man maa ikke slippe en note inde i sig selv. */
function erEfterkommer(id, maal) {
  let p = traeNote(maal);
  for (let i = 0; i < 64 && p; i++) {
    if (p.id === id) return true;
    p = p.parentId ? traeNote(p.parentId) : null;
  }
  return false;
}

function ryddLinje() {
  if (traek.linje) { traek.linje.remove(); traek.linje = null; }
  document.querySelectorAll('.tree-row.drop-i').forEach((el) => el.classList.remove('drop-i'));
}

function visLinje(raekke, efter) {
  ryddLinje();
  const r = raekke.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'tree-indsaet';
  el.style.top = `${(efter ? r.bottom : r.top) - 1}px`;
  el.style.left = `${r.left}px`;
  el.style.width = `${r.width}px`;
  document.body.appendChild(el);
  traek.linje = el;
}

/**
 * Skriver den nye raekkefoelge.
 *
 * Foerst en flytning, hvis noten skifter foraelder eller notesbog - ellers
 * ville `reorder` skrive et loebenummer i en gruppe, noten slet ikke er i.
 * Derefter ét `reorder`-kald med HELE soeskendegruppen, saa numrene er
 * 0,1,2,… og ikke et gaet.
 */
async function slipTraek(noteId, maalId, efter) {
  const maal = traeNote(maalId);
  if (!maal) return;
  /*
   * Traekker man en MARKERET note, foelger hele markeringen med - ogsaa her,
   * og ikke kun ved slip paa en notesbog. To slipsteder med hver sin regel er
   * to regler at tage fejl af.
   *
   * De laegges ind i den raekkefoelge, TRAEET viser dem - man har peget paa
   * en stribe raekker og mener den stribe, ikke den, de blev lavet i.
   */
  const flok = traekkerHeleMarkeringen(noteId)
    ? valgteITraeorden().filter((id) => id !== maal.id)
    : [noteId];
  const noter = flok.map(traeNote).filter(Boolean);
  if (!noter.length || noter.some((n) => n.id === maal.id)) return;

  const nyFar = maal.parentId || null;
  const nyBog = maal.notebookId || null;
  const flere = noter.length > 1;
  try {
    for (const note of noter) {
      if ((note.parentId || null) !== nyFar || (note.notebookId || null) !== nyBog) {
        await api('POST', `/api/v1/notes/${note.id}/move`,
          nyFar ? { parentId: nyFar } : { parentId: null, notebookId: nyBog });
      }
    }
    const flytted = new Set(noter.map((n) => n.id));
    const gruppe = (state.tree || [])
      .filter((n) => (n.parentId || null) === nyFar
        && (nyFar !== null || (n.notebookId || null) === nyBog)
        && !flytted.has(n.id));
    let i = gruppe.findIndex((n) => n.id === maal.id);
    if (i < 0) i = gruppe.length - 1;
    gruppe.splice(efter ? i + 1 : i, 0, ...noter);
    await api('POST', '/api/v1/reorder', { kind: 'note', ids: gruppe.map((n) => n.id) });
    if (flere) { valgte.clear(); toast(`${noter.length} notes moved.`); }
    await hentTrae();
    tegnTrae();
    synkAabenNote();
  } catch (ex) { toast(ex.message); }
}

/** Slip paa en notesbog: ind i den, oeverst i traeet. */
/**
 * De markerede noter, i den raekkefoelge TRAEET viser dem - og uden dem, hvis
 * forfader ogsaa er markeret.
 *
 * Den sidste del er den samme regel som paa serveren: `flytNote` tager hele
 * undertraeet med, saa flytter man baade en side og dens underside hver for
 * sig, bliver grenen revet fra hinanden. Her SKAL den ogsaa staa, fordi
 * `slipTraek` ikke gaar gennem bulk-ruten - den bygger sin egen sortering.
 */
function valgteITraeorden() {
  const raekkefoelge = [...document.querySelectorAll('#treeHost [data-note]')]
    .map((el) => el.dataset.note)
    .filter((id) => valgte.has(id));
  const harValgtForfader = (id) => {
    let n = traeNote(id);
    for (let dybde = 0; n && n.parentId && dybde < 64; dybde++) {
      if (valgte.has(n.parentId)) return true;
      n = traeNote(n.parentId);
    }
    return false;
  };
  return raekkefoelge.filter((id) => !harValgtForfader(id));
}

/**
 * Traekker man en MARKERET note, foelger hele markeringen med.
 *
 * Meldt fra brug: »hvis jeg marker flere noter med command og proever at
 * flytte dem ned i en anden notebook, saa flytter den kun en ad gangen«
 * (Andreas, 2026-09-01).
 *
 * v43 gav markeringen en »Move…«-knap og glemte trækket. Det er den samme
 * handling set fra brugerens side - han har markeret tre noter og taget fat i
 * en af dem - saa de to veje skal goere det samme. En markering, der kun
 * gaelder den ene af to veje, er vaerre end ingen markering: man kan ikke se
 * paa skaermen, hvilken vej der taeller.
 */
function traekkerHeleMarkeringen(noteId) {
  return valgte.has(noteId) && valgte.size > 1;
}

async function slipIBog(noteId, bogId) {
  if (traekkerHeleMarkeringen(noteId)) {
    const ider = valgteITraeorden();
    try {
      const r = await api('POST', '/api/v1/notes/move', { ids: ider, notebookId: bogId });
      valgte.clear();
      toast(r.skipped
        ? `${r.moved} moved — ${r.skipped} came along as `
          + `${r.skipped === 1 ? 'a subpage' : 'subpages'}.`
        : `${r.moved} note${r.moved === 1 ? '' : 's'} moved.`);
      await hentTrae();
      tegnTrae();
      synkAabenNote();
    } catch (ex) { toast(ex.message); }
    return;
  }
  const note = traeNote(noteId);
  if (!note || ((note.notebookId || null) === bogId && !note.parentId)) return;
  try {
    await api('POST', `/api/v1/notes/${note.id}/move`, { parentId: null, notebookId: bogId });
    await hentTrae();
    tegnTrae();
    synkAabenNote();
    toast('Moved.');
  } catch (ex) { toast(ex.message); }
}

/** Alle raekker, der ser trukket ud, faar deres udseende tilbage. */
function ryddTraekkes() {
  for (const el of document.querySelectorAll('.tree-row.traekkes')) el.classList.remove('traekkes');
}

function bindTraeTraek(host) {
  host.addEventListener('pointerdown', (e) => {
    // Mus og pen. Fingeren ejer rulningen - se kommentaren oeverst.
    if (e.pointerType === 'touch' || e.button !== 0) return;
    // Knapper i raekken (fold, plus, globus) goer deres eget.
    if (e.target.closest('button') && !e.target.closest('.tree-name')) return;
    const raekke = e.target.closest('.tree-row[data-raekke]');
    if (!raekke) return;
    traek.id = raekke.dataset.raekke;
    traek.fra = raekke;
    traek.aktiv = false;
    traek.x = e.clientX;
    traek.y = e.clientY;
  });

  host.addEventListener('pointermove', (e) => {
    if (!traek.id) return;
    if (!traek.aktiv) {
      // 5 px, saa et almindeligt klik ikke bliver til et traek.
      if (Math.abs(e.clientX - traek.x) + Math.abs(e.clientY - traek.y) < 5) return;
      traek.aktiv = true;
      /*
       * Traekker man en markeret note, skal ALLE de markerede se traukket ud.
       * Ellers ligner det, at man flytter én - og saa er man overrasket, naar
       * tre lander.
       */
      if (traekkerHeleMarkeringen(traek.id)) {
        for (const el of host.querySelectorAll('.tree-row.valgt')) el.classList.add('traekkes');
      } else {
        traek.fra.classList.add('traekkes');
      }
      document.body.classList.add('traekker');
      try { e.target.setPointerCapture(e.pointerId); } catch { /* ligegyldigt */ }
    }
    // elementFromPoint frem for e.target: med pointer capture er target laast
    // til det element, traekket begyndte paa.
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const bog = under && under.closest('.tree-row.book[data-bograekke]');
    if (bog) {
      ryddLinje();
      bog.classList.add('drop-i');
      return;
    }
    const maal = under && under.closest('.tree-row[data-raekke]');
    if (!maal || maal.dataset.raekke === traek.id
      || erEfterkommer(traek.id, maal.dataset.raekke)) { ryddLinje(); return; }
    const r = maal.getBoundingClientRect();
    visLinje(maal, e.clientY > r.top + r.height / 2);
  });

  const slut = async (e) => {
    if (!traek.id) return;
    const varAktiv = traek.aktiv;
    const noteId = traek.id;
    ryddTraekkes();
    document.body.classList.remove('traekker');
    traek.id = null;
    traek.fra = null;
    traek.aktiv = false;
    if (!varAktiv) { ryddLinje(); return; }

    const under = document.elementFromPoint(e.clientX, e.clientY);
    const bog = under && under.closest('.tree-row.book[data-bograekke]');
    const maal = under && under.closest('.tree-row[data-raekke]');
    ryddLinje();
    if (bog) { await slipIBog(noteId, bog.dataset.bograekke); return; }
    if (!maal || maal.dataset.raekke === noteId || erEfterkommer(noteId, maal.dataset.raekke)) return;
    const r = maal.getBoundingClientRect();
    await slipTraek(noteId, maal.dataset.raekke, e.clientY > r.top + r.height / 2);
  };

  host.addEventListener('pointerup', slut);
  host.addEventListener('pointercancel', () => {
    ryddTraekkes();
    document.body.classList.remove('traekker');
    traek.id = null; traek.fra = null; traek.aktiv = false;
    ryddLinje();
  });
}

/**
 * Flytter en note ét trin op eller ned blandt sine soeskende.
 *
 * Den vej, der virker med mus, tastatur OG tommelfinger - traekket er kun for
 * mus og pen (doda F3).
 */
async function flytNoteISort(note, retning) {
  const gruppe = (state.tree || []).filter((n) => (n.parentId || null) === (note.parentId || null)
    && (note.parentId || (n.notebookId || null) === (note.notebookId || null)));
  const i = gruppe.findIndex((n) => n.id === note.id);
  const j = i + retning;
  if (i < 0 || j < 0 || j >= gruppe.length) return;
  const ny = gruppe.slice();
  ny.splice(j, 0, ny.splice(i, 1)[0]);
  try {
    await api('POST', '/api/v1/reorder', { kind: 'note', ids: ny.map((n) => n.id) });
    await hentTrae();
    tegnTrae();
    synkAabenNote();
  } catch (ex) { toast(ex.message); }
}

/** Den soeskende, der staar LIGE FOER noten - den, en indrykning lander under. */
function soeskendeFoer(note) {
  const gruppe = (state.tree || []).filter((n) => (n.parentId || null) === (note.parentId || null)
    && (note.parentId || (n.notebookId || null) === (note.notebookId || null)));
  const i = gruppe.findIndex((n) => n.id === note.id);
  return i > 0 ? gruppe[i - 1] : null;
}

/** Kun traeet gentegnes - ikke skallen, ikke editoren. */
function tegnTrae() {
  const host = document.getElementById('treeHost');
  if (!host) return;
  // Baandet foerst: det siger, hvor mange der er markeret, og staar OVER
  // listen frem for hen over den.
  host.innerHTML = valgtBaandHtml() + traeHtml();
  bindTrae();
}

async function opretOgAaben(felter) {
  try {
    // Svaret INDEHOLDER elementet. At kalde "hent alt igen" bagefter er en
    // ekstra rundtur for noget, man har i haanden (RUNE-ERFARINGER, doda v27).
    const d = await api('POST', '/api/v1/notes', Object.assign({ title: 'Untitled', body: '' }, felter));
    if (felter.parentId) { editor.foldede.delete(felter.parentId); gemFoldede(); }
    // Er der lavet et NYT maerke undervejs, skal listen med - ellers mangler
    // det i »Tags«-skaermen og i autoudfyldningen, til man genindlaeser.
    if (felter.tags && felter.tags.length) {
      try { state.tags = (await api('GET', '/api/v1/state')).tags || state.tags; } catch { /* ligegyldigt */ }
    }
    await hentTrae();
    tegnTrae();
    await aabnNote(d.note.id);
    const t = document.getElementById('noteTitle');
    if (t) { t.focus(); t.select(); }
  } catch (ex) { toast(ex.message); }
}

/* -------------------------------------------------------------- editoren */

/**
 * Aabner en note.
 *
 * `indlaeser` findes, fordi markeringen og indlaesningen er to forskellige
 * tilstande: klikker man hurtigt paa to noter, maa det foerste svar ikke
 * overskrive det andet.
 */
async function aabnNote(id, tving) {
  /*
   * Luk sidemenuen. HER, og ikke i hvert kaldssted - og FOER den tidlige
   * returnering nedenfor.
   *
   * `gaaTil()` gjorde det allerede for skaermene, men en note aabnes ad
   * mindst seks veje - traeet, favoritterne, sporet, et soegeresultat, et
   * baglaens link og et `[[link]]` i teksten. Paa en telefon ligger menuen
   * hen over noten, saa man valgte en note og saa ... menuen (Andreas,
   * 2026-08-21).
   *
   * Klassen fjernes ubetinget: paa en bred skaerm betyder den ingenting.
   *
   * Og den fjernes FOER vagten mod »samme note igen«. Trykker man paa den
   * note, man allerede staar paa, er oensket stadig at SE den - saa en tidlig
   * returnering, der springer lukningen over, efterlader menuen hen over
   * netop det, man bad om.
   */
  document.body.classList.remove('navopen');
  /*
   * `tving` springer vagten over - og den findes, fordi vagten ellers goer en
   * OPFRISKNING til ingenting.
   *
   * Vagten er rigtig for et klik: trykker man paa den note, man allerede
   * staar paa, skal siden ikke blinke. Men »hent den her note forfra« er
   * netop en anmodning om at gaa udenom, og uden `tving` hentede
   * traek-ned-for-at-opfriske (F19) alt ANDET end den note, man stod og
   * kiggede paa. Den fejl overlevede v14, fordi proeven havde en
   * genindlaesning imellem - saa den nye titel kom derfra og ikke fra
   * trakket (fundet 2026-08-22 ved at sammenligne med doda).
   */
  if (!tving && editor.note && editor.note.id === id && !editor.indlaeser) return;
  /*
   * Husk hvor vi stod - FOER `state` aendres, og kun naar vi faktisk gaar et
   * andet sted hen. En opfriskning af den note, man staar paa, er ikke et
   * skridt.
   */
  if (state.openNote !== id) husk();
  await gemNu();
  editor.indlaeser = id;
  state.view = 'note';
  state.openNote = id;
  /*
   * Adressen skrives HER - foer hentningen, ikke efter.
   *
   * Skete det foerst, naar noten var hentet, ville en opfriskning midt i
   * hentningen lande paa forsiden. Og skrivningen er `replaceState`, saa den
   * ikke selv sender en `hashchange` retur (se `saetAdresse`).
   */
  saetAdresse(id);
  editor.aabenBlok = null;
  editor.konflikt = null;
  tegnSide();
  try {
    const d = await api('GET', `/api/v1/notes/${id}`);
    if (editor.indlaeser !== id) return;      // en anden note vandt kapløbet
    editor.indlaeser = null;
    editor.note = d.note;
    editor.beskidt = false;
    editor.parkeret = false;
    editor.sidstGemt = Date.now();
    kom.svarPaa = null;
    kom.redigerer = null;
    // Kommentarerne hentes SAMMEN med noten, saa afsnittet staar der ved
    // foerste optegning i stedet for at hoppe ind bagefter. En fejl her maa
    // ikke tage noten med sig - den er det, brugeren kom efter.
    try { await hentKommentarer(id); } catch { kom.liste = []; kom.noteId = id; }
    // Opgaverne hentes SAMMEN med noten - ét kald, ikke ét pr. optegning.
    // En fejl her maa ikke tage noten med sig.
    try { await hentDodaOpgaver(id); } catch { dodaState.opgaver = []; dodaState.noteId = id; }
    if (editor.note && editor.note.id !== id) return;
    opdaterNav();
    tegnTrae();
    tegnSide();
    /*
     * Sporet opfriskes EFTER optegningen, ikke foer (F13).
     *
     * Serveren har allerede noteret besoeget - det skete i selve
     * note-opslaget, hvor alle veje ind moedes. Det her er kun sidebarens
     * liste, og den maa ikke koste en ventetid paa den note, man kom efter.
     */
    hentGenveje().then(tegnGenveje);
  } catch (ex) {
    editor.indlaeser = null;
    toast(ex.message);
    gaaTil('notes');
  }
}

/**
 * Tilbage-knappen. Kun naar der ER noget at gaa tilbage til.
 *
 * »Den kunne evt. blive synlig til venstre for Save« (Andreas, 2026-09-01) -
 * og dér staar den, forrest i vaerktoejsraekken.
 *
 * Den siger HVOR den foerer hen. En pil alene er et gaet, og man skal kunne
 * vide, om man lander paa den forrige note eller helt tilbage i soegningen,
 * FOER man trykker.
 *
 * Skjult frem for slaaet fra: en knap, der aldrig kan bruges paa den foerste
 * note, man aabner, er stoej i vaerktoejsraekken.
 */
function tilbageKnapHtml() {
  if (!kanGaaTilbage()) return '';
  const post = tilbagespor[tilbagespor.length - 1];
  const navn = sporNavn(post);
  return `<button class="iconbtn" id="tilbageBtn"
    title="Back to “${esc(navn)}”" aria-label="Back to ${esc(navn)}">${icon('tilbage', 16)}</button>`;
}

function notesbogNavn(id) {
  const b = (state.notebooks || []).find((x) => x.id === id);
  return b ? b.name : null;
}

/** Broedkrummer: hvor i traeet er jeg? */
function broedkrummer(note) {
  const kort = new Map((state.tree || []).map((n) => [n.id, n]));
  const sti = [];
  let cur = kort.get(note.parentId);
  for (let i = 0; i < 32 && cur; i++) { sti.unshift(cur); cur = kort.get(cur.parentId); }
  const bog = notesbogNavn(note.notebookId);
  const dele = [];
  if (bog) dele.push(`<span>${esc(bog)}</span>`);
  for (const s of sti) dele.push(`<button data-krumme="${esc(s.id)}">${esc(s.title || 'Untitled')}</button>`);
  return dele.length ? `<nav class="krummer meta saetning">${dele.join('<span class="sep">/</span>')}</nav>` : '';
}

/*
 * Notens maerker - SYNLIGE paa noten.
 *
 * De laa i datamodellen fra F0 og blev sat af Notion-importen, men der fandtes
 * ingen vej til at saette et selv, og »Tags«-skaermen sagde »arrives in F3«.
 * En hjaelpetekst, der beskriver noget, appen ikke kan, er den dyreste slags
 * fejl: brugeren tror, han bruger appen forkert (RUNE-ERFARINGER, doda v38).
 *
 * Raekken staar dér, hvor handlingen sker - ikke i en menu og ikke kun i en
 * toast. En handling, der aendrer noget, skal efterlade et spor paa stedet
 * (tovo v8).
 */
function maerkerHtml(n) {
  const maerker = n.tags || [];
  // Paa en note, jeg kun maa laese, staar maerkerne som TEKST: intet kryds og
  // ingen tilfoej-knap. Fjerde sted, en redigering kunne begynde (F11).
  const kanRette = maaRette(n);
  return `<div class="note-maerker" id="noteMaerker">
      ${maerker.map((t) => `<span class="chip maerke">${esc(t)}${kanRette ? `<button class="chip-x"
        data-fjernmaerke="${esc(t)}" aria-label="Remove ${esc(t)}" title="Remove">×</button>` : ''}</span>`).join('')}
      ${kanRette ? `<button class="chip tilfoej" id="tilfoejMaerke">${maerker.length ? '+ tag' : '+ Add a tag'}</button>
      <span class="maerke-felt-hylster">
        <input class="chip-felt" id="maerkeFelt" placeholder="tag, or tag,tag,tag"
          autocomplete="off" autocapitalize="none" spellcheck="false" hidden>
        <span class="maerke-forslag" id="maerkeForslag" hidden></span>
      </span>` : ''}
    </div>`;
}

async function saetNoteMaerker(navne) {
  const n = editor.note;
  try {
    const d = await api('PATCH', `/api/v1/notes/${n.id}`, { tags: navne });
    n.tags = d.note.tags;
    n.updatedAt = d.note.updatedAt;
    // Listen over ALLE maerker skal med, ellers mangler det nye i
    // autoudfyldningen og i »Tags«-skaermen, til man genindlaeser.
    try { state.tags = (await api('GET', '/api/v1/state')).tags || state.tags; } catch { /* ligegyldigt */ }
    tegnMaerker();
  } catch (ex) { toast(ex.message); }
}

/** Kun maerke-raekken tegnes om - ikke hele noten, som ville lukke en aaben blok. */
function tegnMaerker() {
  const host = document.getElementById('noteMaerker');
  if (!host || !editor.note) return;
  host.outerHTML = maerkerHtml(editor.note);
  bindMaerker();
}

/*
 * Maerkefeltet med FORSLAG.
 *
 * Her stod `<datalist>` foer, altsaa browserens egen liste. Den virker paa en
 * computer og **slet ikke paa iOS** - Safari viser ingenting - saa forslagene
 * fandtes kun for halvdelen af brugerne, og den halvdel, der sad med
 * telefonen, kunne ikke se, at de var der (Andreas, 2026-08-21).
 *
 * Listen tegnes derfor selv, praecis som omni-feltets. Til gengaeld skal den
 * saa ogsaa selv kunne det, browseren gjorde: piletaster, Enter og et klik.
 */
const maerkeValg = { traef: [], valgt: 0 };

function bindMaerker() {
  const felt = document.getElementById('maerkeFelt');
  const knap = document.getElementById('tilfoejMaerke');
  const forslag = document.getElementById('maerkeForslag');
  if (!felt || !knap) return;

  knap.addEventListener('click', () => {
    knap.hidden = true;
    felt.hidden = false;
    felt.value = '';
    felt.focus();
    tegnForslag();
  });

  const luk = () => { felt.hidden = true; knap.hidden = false; skjulForslag(); };
  const skjulForslag = () => {
    maerkeValg.traef = [];
    if (forslag) { forslag.hidden = true; forslag.innerHTML = ''; }
  };

  /** Det, der staar EFTER sidste komma - det er dét, man er i gang med. */
  const sidsteDel = () => (felt.value.split(',').pop() || '').trim().replace(/^#/, '');

  function tegnForslag() {
    if (!forslag) return;
    const soeg = sidsteDel().toLowerCase();
    const alt = editor.note.tags || [];
    // Allerede paa noten, eller allerede skrevet i feltet: ikke et forslag.
    const brugt = new Set(alt.concat(saguMaerker.fraFelt(felt.value)).map((t) => t.toLowerCase()));
    const traef = (state.tags || [])
      .map((t) => t.name)
      .filter((n) => !brugt.has(n.toLowerCase()))
      // Det, der BEGYNDER med det skrevne, staar oeverst - som i omni-feltet.
      .filter((n) => !soeg || n.toLowerCase().includes(soeg))
      .sort((a, b) => {
        const ai = a.toLowerCase().startsWith(soeg) ? 0 : 1;
        const bi = b.toLowerCase().startsWith(soeg) ? 0 : 1;
        return ai - bi || a.localeCompare(b, 'da');
      })
      .slice(0, 8);

    maerkeValg.traef = traef;
    maerkeValg.valgt = 0;
    if (!traef.length) { forslag.hidden = true; forslag.innerHTML = ''; return; }
    forslag.hidden = false;
    forslag.innerHTML = traef.map((n, i) => `<button class="maerke-forslag-punkt${
      i === 0 ? ' valgt' : ''}" data-forslag="${esc(n)}">${esc(n)}</button>`).join('');
    forslag.querySelectorAll('[data-forslag]').forEach((el) => {
      // `mousedown`, ikke `click`: feltets blur naar ellers at lukke listen,
      // foer klikket bliver til noget (samme faelde som doda v30).
      el.addEventListener('mousedown', (e) => { e.preventDefault(); vaelg(el.dataset.forslag); });
    });
  }

  function markerValgt() {
    if (!forslag) return;
    forslag.querySelectorAll('[data-forslag]').forEach((el, i) => {
      el.classList.toggle('valgt', i === maerkeValg.valgt);
    });
  }

  /** Saetter et forslag ind i stedet for det halvskrevne ord. */
  function vaelg(navn) {
    const dele = felt.value.split(',');
    dele[dele.length - 1] = navn;
    // Et komma bagefter, saa man kan skrive det naeste med det samme.
    felt.value = `${dele.join(',')},`;
    felt.focus();
    tegnForslag();
  }

  function gem() {
    const nye = saguMaerker.fraFelt(felt.value);
    if (!nye.length) { luk(); return; }
    const nuvaerende = editor.note.tags || [];
    const tilfoej = nye.filter((n) => !nuvaerende.some((t) => t.toLowerCase() === n.toLowerCase()));
    if (!tilfoej.length) { luk(); return; }
    saetNoteMaerker(nuvaerende.concat(tilfoej));
  }

  felt.addEventListener('input', tegnForslag);
  felt.addEventListener('keydown', (e) => {
    // Feltet ejer sine taster: uden stopPropagation gemmer notens egen
    // ⌘+Enter-genvej samtidig, og »f« ville slaa fokus-tilstand til
    // (RUNE-ERFARINGER, doda v29/v31/v34).
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); luk(); return; }
    if (maerkeValg.traef.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const n = maerkeValg.traef.length;
      maerkeValg.valgt = (maerkeValg.valgt + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      markerValgt();
      return;
    }
    if (e.key === 'Tab' && maerkeValg.traef.length) {
      e.preventDefault();
      vaelg(maerkeValg.traef[maerkeValg.valgt]);
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    /*
     * Enter paa et fremhaevet forslag SAETTER det ind; Enter paa noget, man
     * selv har skrevet til ende, gemmer. Forskellen er, om det skrevne ord
     * allerede ER forslaget - ellers ville man ikke kunne lave et nyt maerke,
     * der ligner et gammelt.
     */
    const halvt = sidsteDel();
    const oeverst = maerkeValg.traef[maerkeValg.valgt];
    if (halvt && oeverst && oeverst.toLowerCase() !== halvt.toLowerCase()) {
      vaelg(oeverst);
      return;
    }
    gem();
  });
  felt.addEventListener('blur', () => setTimeout(() => { gem(); }, 120));

  document.querySelectorAll('[data-fjernmaerke]').forEach((el) => {
    el.addEventListener('click', () => {
      const vaek = el.dataset.fjernmaerke.toLowerCase();
      saetNoteMaerker((editor.note.tags || []).filter((t) => t.toLowerCase() !== vaek));
    });
  });
}

function gemMaerke() {
  /*
   * »Saved« paa en side, man ikke KAN gemme, er en usandhed.
   *
   * Maerket svarer paa »naaede mit arbejde frem?« - og paa en note, jeg kun
   * maa laese, er der intet arbejde. Baandet ovenover siger allerede hvorfor
   * (F11).
   */
  if (!maaRette(editor.note)) return '<span class="gem">Read only</span>';
  if (editor.konflikt) return '<span class="gem konflikt">Not saved — conflict</span>';
  // Parkeret er hverken »gemt« eller »ikke gemt«: det ligger sikkert paa
  // telefonen og venter paa net. Maerket skal sige praecis dét (F15).
  if (editor.parkeret && !editor.beskidt) return '<span class="gem">Waiting for network</span>';
  if (editor.gemmer) return '<span class="gem">Saving…</span>';
  if (editor.beskidt) return '<span class="gem">Unsaved</span>';
  return '<span class="gem ok">Saved</span>';
}

function sideNote() {
  const n = editor.note;
  if (editor.indlaeser || !n) {
    return '<div class="card empty"><p class="meta saetning">Opening…</p></div>';
  }

  return `
    ${broedkrummer(n)}
    <div class="note-head">
      <button class="note-ikon" id="noteIkon" title="Pick an icon"
        aria-label="Pick an icon">${n.icon ? esc(n.icon) : icon('notes', 20)}</button>
      <input class="note-title" id="noteTitle" value="${esc(n.title)}"
        placeholder="Untitled" autocomplete="off" spellcheck="false"
        ${maaRette(n) ? '' : 'readonly'}>
      <div class="note-tools">
        ${tilbageKnapHtml()}
        <span id="gemMaerke">${gemMaerke()}</span>
        <button class="iconbtn" id="kopiNote"
          title="Copy the whole note — with the images">${icon('copy', 15)}</button>
        <button class="iconbtn" id="fokusBtn" title="Focus mode (F) — just the note">${icon('focus', 16)}</button>
        ${favoritKnapHtml(n)}
        ${delKnapHtml(n)}
        ${n.mine === false ? '' : udgivKnapHtml(n.published)}
        <button class="iconbtn" id="menuBtn" title="More">${icon('dots', 16)}</button>
      </div>
    </div>
    ${delingsBaandHtml(n)}
    ${maerkerHtml(n)}
    ${editor.konflikt ? konfliktHtml() : ''}
    <div class="note-body" id="noteBody"></div>
    ${filerHtml(n)}
    ${n.backlinks && n.backlinks.length ? `
      <div class="backlinks">
        <h2>Linked from</h2>
        ${n.backlinks.map((b) => `<button class="backlink" data-krumme="${esc(b.id)}">
          ${esc(b.title || 'Untitled')}</button>`).join('')}
      </div>` : ''}
    ${dodaState.noteId === n.id ? dodaOpgaverHtml() : ''}
    ${kom.noteId === n.id ? kommentarerHtml() : ''}`;
}

/*
 * Konflikten er et VALG, ikke en tavs overskrivning.
 *
 * Noten blev gemt et andet sted, mens den stod aaben her. Begge udgaver
 * findes stadig - brugeren skal kunne se hvad han selv skrev, og bestemme.
 */
function konfliktHtml() {
  return `<div class="konflikt-baand">
      <div>
        <strong>Someone saved this note while you were editing.</strong>
        <div class="meta saetning">Nothing was overwritten. Your version is still on screen.</div>
      </div>
      <div class="btnrow">
        <button class="btn" id="konfliktHent">Load theirs</button>
        <button class="btn primary" id="konfliktGem">Keep mine</button>
      </div>
    </div>`;
}

/* ------------------------------------------------- den hybride optegning */

/**
 * Tegner notens krop.
 *
 * Én optegningsfejl maa IKKE tage hele ruden med sig: én note i en uventet
 * form kastede i Verdande inde i en reaktiv effekt, og derefter kunne INGEN
 * note aabnes - den forrige blev bare staaende. Derfor guarden og faldet
 * tilbage til raa tekst (Verdandes spec, punkt 8 i deres faeldeliste).
 */
function tegnKrop() {
  const host = document.getElementById('noteBody');
  const n = editor.note;
  if (!host || !n) return;

  if (editor.aabenBlok !== null) {
    // To editorer, ét valg. Se `heleNoten()`.
    if (heleNoten()) tegnHeleNoten(host, n);
    else tegnMedAabenBlok(host, n);
    return;
  }

  try {
    const { html } = saguMarkdown.render(n.body, renderValg());
    host.innerHTML = html || '<p class="tom-note meta saetning">Click here to start writing.</p>';
    pyntKodeblokke(host);
    pyntInlineKode(host);
    bindTjek(host);
    bindBilleder(host);
    // Indlejringerne fyldes BAGEFTER: optegningen maa aldrig vente paa et
    // netvaerkskald (F12).
    fyldGhIndlejringer(host);
  } catch (ex) {
    host.innerHTML = `<div class="render-fejl"><p class="meta saetning">
      This note could not be rendered, so here it is as plain text.</p>
      <pre>${esc(n.body)}</pre></div>`;
    if (window.console) console.error('render fejlede', ex);
  }
  bindKrop();
  tegnGreb(host);
  byggToc();
}

/**
 * De valg, rendereren skal have - ét sted, saa den aabne blok og resten af
 * noten aldrig kan tegnes med forskellige regler.
 *
 * `sagu:<id>` frem for en absolut adresse: en note skal kunne flyttes med til
 * wikien eller en eksport uden at billederne doer. Vaerten oversaetter.
 */
/** `sagu:<id>` -> den interne filadresse. Alt andet er vaertens sag. */
function saguUrl(u) {
  return /^sagu:[a-f0-9]{32}$/.test(u) ? `/api/v1/files/${u.slice(5)}` : null;
}

/**
 * `sagu-note:<id>` -> den note.
 *
 * Notion-importen skriver den for HVERT internt link mellem to importerede
 * sider (241 af dem i Andreas' arkiv). Uden oversaettelsen afviste `sikkerUrl`
 * dem med rette - de er ikke http(s) - og hele krydsreferencenettet stod som
 * raa markdown med et hex-id i. Kvitteringen sagde »241 internal links
 * rewritten«, og ikke ét af dem virkede (Andreas, 2026-08-21).
 *
 * Samme greb som §F4's `linkUrl`-krog: rendereren maa ikke kende Sagus
 * adresser, vaerten oversaetter.
 */
function noteUrl(u) {
  const m = /^sagu-note:([a-f0-9]{32})$/.exec(String(u || ''));
  if (!m) return null;
  // `#note-<id>` er den adresse, appen ALLEREDE aabner paa - baade fra
  // [[henvisninger]] og fra adresselinjen. Ét maal, én handler.
  return `#note-${m[1]}`;
}

function renderValg() {
  return {
    blokAttribut: true,
    slaaOpNote: (titel) => {
      const t = (state.tree || []).find((x) => (x.title || '').toLowerCase() === titel.toLowerCase());
      return t ? { href: `#note-${t.id}` } : null;
    },
    // Kun VORES egne filer vises som billeder. Et billede udefra bliver et
    // link med en forklaring - CSP'en henter det alligevel ikke, og et
    // oedelagt ikon forklarer ingenting. F5's import henter dem ned.
    billedUrl: (u) => saguUrl(u),
    // Et LINK kan pege paa baade en fil og en anden note.
    linkUrl: (u) => saguUrl(u) || noteUrl(u),
    // Et afsnit, der ER én bar adresse, kan blive til en indlejring (F12).
    // Rendereren kender ikke GitHub - den spoerger bare, om nogen vil have
    // linjen.
    bartLink: (u, b) => ghKrog(u, b),
  };
}

function bindKrop() {
  const host = document.getElementById('noteBody');
  if (!host) return;

  // ÉN delegeret handler paa kroppen. Ikke `{once:true}`: den ville fjerne sig
  // selv efter foerste klik, saa man kunne aabne én blok pr. optegning og
  // derefter ingenting - og fejlen ville ligne "editoren gaar i staa".
  host.addEventListener('click', (e) => {
    /*
     * **Har man MARKERET noget, aabner klikket ikke redigeringen.**
     *
     * Et traek hen over teksten ender med et `click` paa afsnittet, og saa
     * gjorde den hybride editor det, den plejer: aabnede afsnittet raat. Det
     * ryddede markeringen i samme oejeblik, den var faerdig.
     *
     * To ting var i stykker af det, og den foerste er den vigtigste:
     *  - **man kunne ikke markere tekst for at KOPIERE den** - fladen hoppede
     *    i redigering, hver gang man proevede,
     *  - og F16's »Send to doda«-knap kunne aldrig naa at komme frem, fordi
     *    den netop naegter at vise sig, mens en blok er aaben.
     *
     * Et markeret stykke tekst er en handling i sig selv. Klikket, der
     * afslutter den, er ikke en anmodning om at redigere.
     */
    const valg = window.getSelection();
    if (valg && !valg.isCollapsed && String(valg).trim().length > 1
        && host.contains(valg.getRangeAt(0).commonAncestorContainer)) return;

    /*
     * Traekhaandtaget er en BETJENING, ikke tekst.
     *
     * Reglen nedenfor - »alt andet i kroppen aabner ogsaa redigeringen« - er
     * rigtig for tekst og pladsholdere, men haandtaget ligger inde i kroppen
     * uden at vaere en blok, saa et klik paa prikkerne aabnede den sidste
     * blok BAG menuen. To rigtige regler, der stoedte sammen; den her
     * undtagelse er graensen mellem dem (maalt i browseren, 2026-08-21).
     */
    if (e.target.closest('.blok-greb, .blok-menu, .blok-indsaet')) return;

    /*
     * **Klikker man i det felt, man allerede skriver i, sker der ingenting.**
     *
     * Uden den her linje faldt et klik i `<textarea>`'et igennem til reglen
     * nederst - »alt andet i kroppen aabner ogsaa redigeringen« - og saa blev
     * blokken tegnet om med markoeren sat til SLUTNINGEN. Symptomet: man
     * satte markoeren i linje 1, og den hoppede ned i linje 2 (Andreas,
     * 2026-08-21).
     *
     * Feltet har ingen `data-blok` - det er netop det, der goer det til den
     * aabne blok - saa det slap forbi begge de foregaaende vagter. Reglen
     * nederst er rigtig for TEKST; den maa bare ikke gaelde det sted, man
     * skriver.
     */
    if (e.target.closest('.blok-redigering')) return;

    // Et klik paa et link skal FOELGE linket, ikke aabne redigeringen -
    // ellers har man byttet én irritation for en vaerre (doda v37).
    const a = e.target.closest('a');
    if (a) {
      const intern = a.getAttribute('href') || '';
      if (intern.startsWith('#note-')) { e.preventDefault(); aabnNote(intern.slice(6)); }
      return;
    }
    const blok = e.target.closest('[data-blok]');
    if (blok) { aabnBlok(Number(blok.dataset.blok)); return; }
    /*
     * Alt ANDET i kroppen aabner ogsaa redigeringen.
     *
     * Her stod `if (e.target === host)`, altsaa »kun det tomme areal under
     * indholdet«. Paa en TOM note findes det areal ikke: pladsholderen
     * »Click here to start writing« er et `<p>` uden `data-blok`, og den
     * fylder kroppen helt ud. Maalt paa en telefonskaerm: kroppen er 22 px
     * hoej, pladsholderen 22 px - **nul pixels tilbage at ramme.**
     *
     * Paa en computer kunne man komme udenom (opret en note, og feltet er
     * allerede aabent; ellers `E`), saa fejlen viste sig foerst paa en
     * telefon, hvor man kommer tilbage til en tom note og trykker paa den
     * eneste tekst, der staar - den, der bogstaveligt siger »klik her«.
     *
     * Reglen er nu den, teksten lover: **et tryk i noten begynder at
     * skrive.** Links, tjekbokse, billeder og GitHub-knapper standser selv
     * deres haendelse, saa de er upaavirkede.
     */
    aabnSidste();
  });
}

/** Erstatter ÉN blok med et raat markdown-felt. Resten bliver staaende. */
function tegnMedAabenBlok(host, n) {
  const linjer = n.body.split('\n');
  const blokke = saguMarkdown.blokke(n.body);
  /*
   * En HELT TOM note har ingen blokke - og det er netop dér, man skal kunne
   * begynde at skrive.
   *
   * `aabnSidste()` laegger en tom linje ind og beder om blok 0. Men
   * `blokke('\n')` giver **ingen** blokke: en tom linje er ikke en blok, den
   * springes over af opdeleren. Saa faldt vi i `!b` nedenfor, satte
   * `aabenBlok` tilbage til null og tegnede pladsholderen igen - **paa
   * samme tick**, saa der aldrig kom et felt at skrive i.
   *
   * Fejlen var usynlig paa en computer, fordi en NY note aabner sit felt ad
   * en anden vej. Den ramte kun den, der kom tilbage til en note, han havde
   * ladet staa tom - og trykkede paa den tekst, der siger »klik her«.
   *
   * En tom foerste blok er derfor et gyldigt maal, ikke et fravaer.
   */
  const b = blokke.find((x) => x.fra === editor.aabenBlok)
    || (!blokke.length && editor.aabenBlok === 0 ? { fra: 0, til: 0 } : null);
  if (!b) { editor.aabenBlok = null; tegnKrop(); return; }

  const foer = linjer.slice(0, b.fra).join('\n');
  const efter = linjer.slice(b.til + 1).join('\n');
  const raa = linjer.slice(b.fra, b.til + 1).join('\n');

  const del = (md) => {
    if (!md.trim()) return '';
    try { return saguMarkdown.render(md, renderValg()).html; } catch { return ''; }
  };

  /*
   * Hjaelpeknappen staar ved FELTET, ikke i vaerktoejsraekken.
   *
   * »En lille knap man kan trykke på når man er ved at skrive en note«
   * (Andreas, 2026-08-21). Vaerktoejsraekken staar i toppen af noten, og paa
   * en telefon er den rullet vaek, netop naar man skriver - saa dér ville
   * knappen vaere usynlig praecis i det oejeblik, den skal bruges.
   *
   * Den er `tabindex="-1"`: Tab fra skrivefeltet skal foere videre i teksten,
   * ikke ind i en hjaelpeknap.
   */
  host.innerHTML = `${del(foer)}
    <div class="blok-redigering">
      <textarea class="blok-felt" id="blokFelt" spellcheck="false"
        rows="${Math.max(1, raa.split('\n').length)}">${esc(raa)}</textarea>
      <button class="blok-hjaelp" id="blokHjaelp" type="button" tabindex="-1"
        aria-label="How to write this" title="How to write this">?</button>
    </div>
    ${del(efter)}`;

  // De renderede dele skal ogsaa have knapper, lightbox og indlejringer.
  // **Begge optegningsveje** - den her og `tegnKrop()` - skal goere det samme;
  // glemmer den ene noget, virker funktionen kun, naar ingen blok er aaben,
  // og fejlen ligner »kortet forsvandt, da jeg klikkede« (F12).
  pyntKodeblokke(host);
  pyntInlineKode(host);
  bindTjek(host);
  bindBilleder(host);
  fyldGhIndlejringer(host);
  // Den AABNE blok har ingen `data-blok` og faar derfor intet haandtag - man
  // kan ikke traekke i det, man staar midt i at skrive. Resten kan.
  tegnGreb(host);

  const hj = document.getElementById('blokHjaelp');
  // `mousedown` med preventDefault, ikke `click`: et klik ville tage fokus
  // fra feltet, og `blur` lukker blokken - saa var man ude af det, man var
  // ved at skrive, for at kigge i hjaelpen.
  if (hj) {
    hj.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); visSyntaksPanel(); });
    hj.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); visSyntaksPanel(); },
      { passive: false });
  }

  const felt = document.getElementById('blokFelt');
  if (!felt) return;
  autoHoejde(felt);
  felt.focus();
  /*
   * Markoeren i slutningen - saa man kan skrive videre med det samme.
   *
   * Undtagelsen er, naar man er kommet hertil med pil NED: saa skal den staa
   * i begyndelsen, dér hvor bevaegelsen pegede hen. Hintet bruges ÉN gang og
   * ryddes, ellers ville det ogsaa gaelde det naeste klik.
   */
  const tilStart = editor.markoerTil === 'start';
  editor.markoerTil = null;
  const pos = tilStart ? 0 : felt.value.length;
  felt.setSelectionRange(pos, pos);

  felt.addEventListener('input', () => {
    byttedeTekstgenvej(felt);
    autoHoejde(felt);
    skrivBlokTilbage(felt.value, b);
    opdaterWikiForslag(felt);
  });

  felt.addEventListener('paste', (e) => { haandterIndsaet(e, felt); });
  felt.addEventListener('dragover', (e) => { e.preventDefault(); felt.classList.add('traekker'); });
  felt.addEventListener('dragleave', () => felt.classList.remove('traekker'));
  felt.addEventListener('drop', (e) => {
    e.preventDefault();
    felt.classList.remove('traekker');
    haandterIndsaet(e, felt);
  });

  felt.addEventListener('keydown', (e) => {
    // Forslagslisten faar tasterne FOERST, naar den er aaben - ellers lukker
    // Escape hele blokken i stedet for kun listen.
    if (wikiTast(e)) return;
    if (e.key === 'Escape') { e.preventDefault(); lukBlok(); return; }

    /*
     * Piletasterne skal kunne KRYDSE blokgraensen.
     *
     * Editoren aabner ét afsnit ad gangen som raa markdown; resten af noten
     * staar renderet omkring det. Naar man stod paa den sidste linje i
     * feltet, gjorde en piletast derfor ingenting - der var ikke nogen naeste
     * linje INDE i feltet, og den naeste linje i NOTEN var et andet element.
     * For den, der skriver, ser det ud som om piletasterne ikke virker
     * (Andreas, 2026-08-21).
     *
     * **Browseren faar lov at proeve foerst.** Kunne den flytte markoeren -
     * fordi afsnittet har flere linjer, eller fordi en lang linje er ombrudt
     * over flere - saa er det dét, brugeren mente, og vi roerer ingenting.
     * Er markoeren IKKE flyttet bagefter, var der ingen vej inde i feltet, og
     * saa springer vi til naboblokken.
     *
     * Den maalemetode er valgt frem for at regne paa linjer i teksten: et
     * OMBRUDT afsnit har flere visuelle linjer end `\n`-tegn, og en regel,
     * der taeller `\n`, ville springe ud af feltet midt i et afsnit.
     */
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const foer = felt.selectionStart;
      const ned = e.key === 'ArrowDown';
      const vaerdi = felt.value;
      // Kun fra den yderste LOGISKE linje - ellers er der helt sikkert en vej
      // inde i feltet, og saa er der ingen grund til at maale noget.
      const yderst = ned
        ? !vaerdi.slice(foer).includes('\n')
        : !vaerdi.slice(0, foer).includes('\n');
      if (!yderst || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return;
      setTimeout(() => {
        if (!document.getElementById('blokFelt')) return;
        if (felt.selectionStart !== foer) return;   // browseren flyttede den
        springTilNaboBlok(ned);
      }, 0);
      return;
    }
    // ⌘/Ctrl+Enter gemmer og lukker blokken. Feltet stopper tasten selv, saa
    // en container-genvej ikke ogsaa fyrer (doda v29/v31/v34).
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      lukBlok();
    }
  });

  felt.addEventListener('blur', () => {
    // Kun hvis fokus forlod selve noten - ellers lukker et klik i en anden
    // blok feltet, foer den nye blok naar at aabne.
    setTimeout(() => {
      const aktiv = document.activeElement;
      if (aktiv && aktiv.id === 'blokFelt') return;
      lukWikiForslag();
      lukBlok();
    }, 0);
  });

  // De blokke, der stadig er renderet, skal kunne klikkes.
  host.querySelectorAll('[data-blok]').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      const nr = Number(el.dataset.blok);
      if (nr !== editor.aabenBlok) aabnBlok(nr);
    });
  });
}

function autoHoejde(felt) {
  felt.style.height = 'auto';
  felt.style.height = `${felt.scrollHeight}px`;
}

function aabnBlok(fra) {
  // En delt note, jeg kun maa laese, aabner ikke en raa markdown-blok. Uden
  // vagten ville teksten se ud til at kunne rettes (F11).
  if (!maaRette(editor.note)) return;
  editor.aabenBlok = fra;
  tegnKrop();
}

function aabnSidste() {
  /*
   * Vagten skal ogsaa staa HER, ikke kun i `aabnBlok`.
   *
   * Den tomme gren nedenfor aendrer `body` og saetter `aabenBlok` selv - den
   * gaar altsaa udenom `aabnBlok()` og dens `maaRette`-tjek. Med den nye
   * regel (et tryk hvor som helst i kroppen aabner redigeringen) ville en
   * kollega med LAESE-adgang til en tom delt note faa et skrivefelt (F11).
   */
  if (!maaRette(editor.note)) return;
  const b = saguMarkdown.blokke(editor.note.body);
  if (!b.length) {
    // Tom note: laeg en tom linje ind, saa der er en blok at aabne.
    editor.note.body = '\n';
    editor.aabenBlok = 0;
    tegnKrop();
    return;
  }
  aabnBlok(b[b.length - 1].fra);
}

/**
 * Aabner blokken foer eller efter den, der staar aaben.
 *
 * Markoeren laegges dér, man kom fra: gaar man NEDAD, skal den staa i
 * begyndelsen af den naeste blok - ikke i slutningen, hvor man saa skulle
 * taste sig tilbage. Det er den eneste rigtige plads, og den er let at
 * glemme, fordi feltet ellers altid aabner med markoeren til sidst.
 */
function springTilNaboBlok(ned) {
  const n = editor.note;
  if (!n) return;
  const b = saguMarkdown.blokke(n.body);
  const i = b.findIndex((x) => x.fra === editor.aabenBlok);
  if (i === -1) return;
  const maal = b[i + (ned ? 1 : -1)];
  // Ingen nabo: bliv staaende. At lukke blokken, fordi man trykkede pil op i
  // den foerste linje, ville vaere at straffe en helt almindelig bevaegelse.
  if (!maal) return;
  editor.markoerTil = ned ? 'start' : 'slut';
  aabnBlok(maal.fra);
}

/**
 * Noten som PDF.
 *
 * »Kan du lave en funktion saa man kan lave en pdf af en sagu note. den skal
 * ligge under ... menuen« (Andreas, 2026-08-25).
 *
 * Der er ingen PDF-motor, og der kommer ingen: Sagu har nul pakker, og at
 * skrive en PDF i haanden er skrifttyper, indlejring og sideombrydning - et
 * projekt for sig, som ville kunne mindre end det, browseren allerede kan.
 * Der ER browserens egen »Gem som PDF«, og saa er hele opgaven at give den et
 * ark, der er NOTEN og ikke appen. Det staar i `@media print`.
 *
 * ── De to ting, der skal ske FOER udskriften ──────────────────────────────
 *
 * 1. **Den aabne blok lukkes.** Den er et `<textarea>`, og et tekstfelt
 *    printer som en formular-kasse med rullebjaelke - ikke som den saetning,
 *    der stod der. Man ville faa en PDF med et hul praecis dér, hvor man sidst
 *    havde markoeren.
 *
 * 2. **`document.title` bliver notens navn.** Browseren bruger titlen som
 *    forslag til filnavnet, og »Sagu« paa tolv PDF'er i en mappe er tolv
 *    filer, man skal aabne for at se hvad er hvad (RUNE-ERFARINGER §4,
 *    Beanledger v19). Den gendannes paa `afterprint` - ellers hedder fanen
 *    noten for evigt.
 *
 * `afterprint` fyrer ogsaa, naar man FORTRYDER i dialogen, og det er netop
 * derfor gendannelsen ligger dér og ikke efter `print()`.
 */
function gemSomPdf(n) {
  lukBlok();
  const foer = document.title;
  const navn = (n && n.title ? n.title : 'Untitled').replace(/[\\/:*?"<>|]/g, '-').slice(0, 90);
  document.title = navn;
  const tilbage = () => {
    document.title = foer;
    window.removeEventListener('afterprint', tilbage);
  };
  window.addEventListener('afterprint', tilbage);
  /*
   * Et hak, foer der printes.
   *
   * `lukBlok()` tegner kroppen om, og udskriften skal se den FAERDIGE side -
   * ikke den, der stod der et oejeblik foer. `print()` er synkron og ville
   * ellers naa at fange den halve optegning.
   */
  setTimeout(() => {
    try { window.print(); } catch { toast('The browser would not open the print dialog.'); tilbage(); }
  }, 50);
}

function lukBlok() {
  if (editor.aabenBlok === null) return;
  editor.aabenBlok = null;
  tegnKrop();
  planlaegGem();
  /*
   * ÉT sted til at fryse GitHub-adresser (F12).
   *
   * Her - og ikke i indsaettelses-haendelsen - fordi linjen kan vaere skrevet,
   * indsat eller kommet med en hel blok, man har klistret ind. Alle veje ind
   * ender med at blokken lukkes.
   *
   * Ingen `await`: gemningen er allerede planlagt, og en fejl hos GitHub maa
   * ikke kunne haenge editoren. Lykkes det, tegnes kroppen igen med den
   * frosne adresse.
   */
  frysGhAdresser().then((aendret) => { if (aendret) tegnKrop(); })
    .catch(() => { /* linjen bliver staaende; kortet siger hvorfor */ });
}

/** Skriver feltets linjer tilbage paa deres plads i noten. */
function skrivBlokTilbage(nyTekst, b) {
  const linjer = editor.note.body.split('\n');
  const nye = nyTekst.split('\n');
  linjer.splice(b.fra, b.til - b.fra + 1, ...nye);
  editor.note.body = linjer.join('\n');
  // Blokkens slutlinje flytter sig, mens man skriver; `fra` gør ikke.
  b.til = b.fra + nye.length - 1;
  markerBeskidt();
}

/* ------------------------------------------------------------ gemningen */

function markerBeskidt() {
  editor.beskidt = true;
  const m = document.getElementById('gemMaerke');
  if (m) m.innerHTML = gemMaerke();
  planlaegGem();
}

function planlaegGem() {
  clearTimeout(editor.gemTimer);
  editor.gemTimer = setTimeout(gemNu, 900);
}

async function gemNu() {
  clearTimeout(editor.gemTimer);
  if (!editor.note || !editor.beskidt || editor.gemmer || editor.konflikt) return;
  const n = editor.note;
  editor.gemmer = true;
  const m = document.getElementById('gemMaerke');
  if (m) m.innerHTML = gemMaerke();
  try {
    const d = await api('PATCH', `/api/v1/notes/${n.id}`, {
      title: n.title,
      body: n.body,
      // Konfliktvagten: serveren afviser, hvis noten er aendret et andet sted.
      ifUpdatedAt: n.updatedAt,
    });
    // Kun stemplet og de afledte felter opdateres. Kroppen er brugerens -
    // at skrive serverens svar tilbage ville kaste det, han skrev, mens
    // kaldet var undervejs.
    n.updatedAt = d.note.updatedAt;
    n.backlinks = d.note.backlinks;
    editor.beskidt = false;
    editor.sidstGemt = Date.now();
    // Titlen kan vaere aendret - traeet skal foelge med.
    const t = (state.tree || []).find((x) => x.id === n.id);
    if (t && t.title !== n.title) { t.title = n.title; tegnTrae(); }
  } catch (ex) {
    if (ex.status === 409) {
      editor.konflikt = true;
      tegnSide();
      return;
    }
    /*
     * Uden net: PARKÉR rettelsen frem for bare at klage (F15).
     *
     * `ex.offline` saettes af `api()`, naar selve forbindelsen fejlede - ikke
     * naar serveren afviste. Forskellen er hele pointen: et afslag skal man
     * se, et netvaerksbrud skal man ikke straffes for.
     *
     * `beskidt` ryddes, naar det er parkeret. Ellers ville den planlagte
     * gemning proeve igen hvert sekund og lave en ny fejlbesked hver gang -
     * og den tekst, man skrev, ER i sikkerhed nu.
     */
    if (ex.offline) {
      if (parkér(n)) {
        editor.beskidt = false;
        editor.parkeret = true;
      }
      return;
    }
    toast(ex.message);
  } finally {
    editor.gemmer = false;
    const m2 = document.getElementById('gemMaerke');
    if (m2) m2.innerHTML = gemMaerke();
  }
}

/* ------------------------------------------------------------ fuldskaerm */

/*
 * »Fuld skaerm« var tre forskellige oensker. Det er nu to:
 *
 *  1. **Fokus** - alt andet end noten forsvinder: sidebar, broedkrummer,
 *     vaerktoejer. Det er en tilstand ved SKAERMEN, ikke ved noten, saa den
 *     gemmes ikke. Esc gaar tilbage.
 *  2. **Browserens fuldskaerm** - ogsaa uden faner og adressefelt. Kraever en
 *     brugerhandling, saa den kan kun taendes fra en knap, og den fejler
 *     stille i en iframe. Derfor er den et TILVALG oven paa fokus og ikke
 *     det, F-tasten goer.
 *
 * ── Den tredje er fjernet ─────────────────────────────────────────────────
 *
 * **Fuld bredde** gav notens tekstspalte hele siden i stedet for
 * laesebredden paa 820 px. »Denne funktion kan fjernes, da jeg ikke kommer
 * til at bruge den« (Andreas, 2026-08-21), og en knap, ingen troer paa, er
 * stoej i en vaerktoejsraekke, hvor hver plads skal fortjenes.
 *
 * Kolonnen `full_width` BLIVER i databasen, og eksport/gendannelse baerer den
 * fortsat. To grunde: migreringer er historie og skrives ikke om, og en
 * sikkerhedskopi fra i gaar skal stadig kunne laeses i morgen. Vaerdien
 * bliver bare ikke laest af fladen laengere - `bred-note` saettes ingen
 * steder, saa en note, der ALLEREDE stod gemt som bred, ikke haenger fast i
 * en visning, der ikke har nogen knap at slaa fra.
 */
function saetFokus(til) {
  document.body.classList.toggle('fokus', til);
  const b = document.getElementById('fokusBtn');
  if (b) {
    b.setAttribute('aria-pressed', til ? 'true' : 'false');
    b.title = til ? 'Leave focus mode (Esc)' : 'Focus mode (F) — just the note';
  }
  // Sideoversigten skal med ud og ind: i fokus er der plads til den, men
  // dens plads flytter sig, saa den skal maales igen.
  byggToc();
}

function erIFokus() { return document.body.classList.contains('fokus'); }

async function slaaBrowserFuldskaerm() {
  try {
    if (document.fullscreenElement) { await document.exitFullscreen(); return; }
    await document.documentElement.requestFullscreen();
  } catch {
    // Fejler i en iframe og naar tilladelsen mangler. Sig det frem for at
    // lade knappen se doed ud.
    toast('The browser would not go fullscreen here. Focus mode still works.');
  }
}

/* -------------------------------------------------------------- binding */

function bindNoteSide() {
  const n = editor.note;
  if (!n) return;
  bindKommentarer();
  bindDodaOpgaver();

  const titel = document.getElementById('noteTitle');
  if (titel) {
    titel.addEventListener('input', () => {
      // En note maa ALDRIG staa uden en titel: den hedder sin titel i traeet,
      // i wikiens adresse og i [[henvisninger]]. Tomt felt = "Untitled",
      // men foerst naar man forlader feltet, saa man kan slette og skrive om.
      n.title = titel.value;
      markerBeskidt();
    });
    titel.addEventListener('blur', () => {
      /*
       * `#maerke` i titlen bliver til et rigtigt maerke - se plukMaerker().
       *
       * Det sker, naar man FORLADER feltet, ikke ved hvert tastetryk: ellers
       * ville `#` blive spist, mens man stadig er i gang med at skrive ordet.
       */
      const { tekst: uden, maerker: fundne } = plukMaerker(titel.value);

      if (fundne.length) {
        titel.value = uden;
        n.title = uden;
        markerBeskidt();
        const nu = n.tags || [];
        const nye = fundne.filter((f) => !nu.some((t) => t.toLowerCase() === f.toLowerCase()));
        // Gem titlen FOERST og maerkerne bagefter: det mest specifikke skriver
        // sidst, ellers overskriver den ene gemning den anden (tovo v7).
        if (nye.length) { gemNu().then(() => saetNoteMaerker(nu.concat(nye))); }
      }
      if (!titel.value.trim()) { titel.value = 'Untitled'; n.title = 'Untitled'; markerBeskidt(); }
    });
    titel.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        // Enter i titlen gaar ned i teksten - det er den vane, alle har.
        aabnSidste();
      }
    });
  }

  const fokus = document.getElementById('fokusBtn');
  if (fokus) fokus.addEventListener('click', () => saetFokus(!erIFokus()));

  const ikonKnap = document.getElementById('noteIkon');
  if (ikonKnap) {
    ikonKnap.addEventListener('click', () => visIkonVaelger(ikonKnap, n.icon, async (e) => {
      n.icon = e;
      ikonKnap.innerHTML = e ? esc(e) : icon('notes', 20);
      try {
        await api('PATCH', `/api/v1/notes/${n.id}`, { icon: e });
        const t = (state.tree || []).find((x) => x.id === n.id);
        if (t) { t.icon = e; tegnTrae(); }
      } catch (ex) { toast(ex.message); }
    }));
  }

  const menu = document.getElementById('menuBtn');
  if (menu) menu.addEventListener('click', visNoteMenu);

  const udgiv = document.getElementById('udgivBtn');
  // IKKE `addEventListener('click', visUdgivPanel)`: saa bliver klik-haendelsen
  // til funktionens foerste argument, og ruden tror, den har faaet et maal.
  // Symptomet var en overskrift uden titel - og, vaerre, at ruden aldrig kunne
  // finde notens EKSISTERENDE udgivelse, fordi opslaget skete paa `undefined`.
  if (udgiv) udgiv.addEventListener('click', () => visUdgivPanel());
  // Samme regel som ovenfor: en pil, ikke funktionen selv - ellers bliver
  // klik-haendelsen til funktionens foerste parameter.
  const delKnap = document.getElementById('delBtn');
  if (delKnap) delKnap.addEventListener('click', () => visDelPanel());
  const favKnap = document.getElementById('favBtn');
  if (favKnap) favKnap.addEventListener('click', () => skiftFavorit());

  /*
   * Hele noten i udklipsholderen - MED billederne.
   *
   * Knappen kopierede foer ren markdown. »Kan du lave saa den ny copy
   * funktion bliver lagt ved siden af saved i stedet for den nuvaerende...
   * Copy i markdown findes alligevel under show as markdown« (Andreas,
   * 2026-08-25). Den, man som regel vil have, staar nu forrest, og den anden
   * er ikke vaek - den ligger, hvor man ser PAA markdown'en.
   *
   * Menupunktet bag »...« er fjernet i samme omgang. Det stod to centimeter
   * fra ikonet og gjorde det samme.
   *
   * Titlen kommer med som en overskrift, hvis teksten ikke selv har en: en
   * note indsat i en mail uden sit navn er svaer at forstaa. Det goer
   * `noteSomMarkdown()`, som begge veje deler.
   */
  const tilbageKnap = document.getElementById('tilbageBtn');
  if (tilbageKnap) tilbageKnap.addEventListener('click', () => gaaTilbage());

  const kopiKnap = document.getElementById('kopiNote');
  if (kopiKnap) {
    /*
     * Ingen `await` foran `kopierNoten()`. Den opretter sit `ClipboardItem`
     * synkront, fordi Safari kraever det inde i klikket.
     */
    kopiKnap.addEventListener('click', () => {
      if (editor.note) kopierNoten(editor.note);
    });
  }

  document.querySelectorAll('[data-krumme]').forEach((el) => {
    el.addEventListener('click', () => aabnNote(el.dataset.krumme));
  });

  if (editor.konflikt) {
    const hent = document.getElementById('konfliktHent');
    if (hent) {
      hent.addEventListener('click', async () => {
        editor.konflikt = null;
        editor.beskidt = false;
        editor.note = null;
        await aabnNote(n.id);
      });
    }
    const gem = document.getElementById('konfliktGem');
    if (gem) {
      gem.addEventListener('click', async () => {
        // "Behold min" = gem UDEN vagten. Den anden udgave staar i
        // historikken, saa intet er tabt.
        editor.konflikt = null;
        try {
          const d = await api('PATCH', `/api/v1/notes/${n.id}`, { title: n.title, body: n.body });
          n.updatedAt = d.note.updatedAt;
          editor.beskidt = false;
          toast('Saved. The other version is in the history.');
          tegnSide();
        } catch (ex) { toast(ex.message); }
      });
    }
  }

  bindMaerker();
  bindFiler();
  bindDropZone(document.querySelector('.main'));
  tegnKrop();
}

/**
 * Flyt en note til en anden notesbog.
 *
 * Ruten fandtes fra F1 (`POST /notes/:id/move`), men der var ingen vej til den
 * i UI'et - og en funktion, man ikke kan naa, findes ikke for brugeren
 * (RUNE-ERFARINGER, tovo v8). Undersiderne foelger med: et undertrae ligger i
 * ÉN notesbog, ellers kan sidebaren ikke tegne det ét sted.
 */
/**
 * Ruden: slaa den her notesbog sammen med en anden.
 *
 * »Det skal vaere muligt at kunne slaa 2 notebooks sammen« (Andreas,
 * 2026-08-25), paa to maader.
 *
 * ── Hvorfor de to valg staar med en saetning hver ─────────────────────────
 *
 * »Move the notes« og »Make it a page« siger ikke, hvad forskellen bliver til
 * paa skaermen bagefter - og det her er en handling, man ikke kan fortryde
 * med et klik. Hver mulighed siger derfor, hvad man FAAR: noter side om side,
 * eller et niveau der husker, hvor de kom fra.
 *
 * Antallet staar der ogsaa. »Slaa sammen« lyder som noget, der handler om to
 * bøger; det handler om alle noterne i dem.
 */
function visFletRude(id, navn) {
  const andre = (state.notebooks || []).filter((b) => b.id !== id);
  if (!andre.length) {
    toast('There is no other notebook to merge into.');
    return;
  }
  const antal = (state.tree || []).filter((n) => n.notebookId === id).length;

  const host = document.createElement('div');
  host.className = 'modal';
  host.id = 'fletRude';
  host.innerHTML = `<div class="modal-kort">
      <div class="modal-top">
        <h2>Merge “${esc(navn)}”</h2>
        <button class="iconbtn" id="fletLuk" aria-label="Close">${icon('luk', 16)}</button>
      </div>
      <div class="modal-krop">
        <p class="meta saetning">“${esc(navn)}” goes to the trash and its ${antal
  } note${antal === 1 ? '' : 's'} move to the notebook you pick. Subpages come along.</p>
        <label class="field"><span>Merge into</span>
          <select class="input" id="fletMaal">
            ${andre.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}
          </select></label>
        <fieldset class="fletvalg">
          <legend class="meta">How</legend>
          <label class="fletvalg-en">
            <input type="radio" name="flettilstand" value="noter" checked>
            <span><strong>Move the notes in</strong>
              <span class="meta saetning">They end up side by side with the notes already
              there, and where they came from is forgotten.</span></span>
          </label>
          <label class="fletvalg-en">
            <input type="radio" name="flettilstand" value="side">
            <span><strong>Make it a page under the other</strong>
              <span class="meta saetning">A page called “${esc(navn)}” is created, and the
              notes become subpages of it. The old grouping is kept as a level.</span></span>
          </label>
        </fieldset>
        <div class="btnrow" style="margin-top:16px">
          <button class="btn primary" id="fletGem">Merge</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(host);

  const luk = () => { host.remove(); document.removeEventListener('keydown', paaTast); };
  const paaTast = (e) => { if (e.key === 'Escape') { e.preventDefault(); luk(); } };
  document.addEventListener('keydown', paaTast);
  host.querySelector('#fletLuk').addEventListener('click', luk);
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });

  host.querySelector('#fletGem').addEventListener('click', async () => {
    const maal = host.querySelector('#fletMaal').value;
    const tilstand = host.querySelector('input[name="flettilstand"]:checked').value;
    const maalNavn = (andre.find((b) => b.id === maal) || {}).name || 'the notebook';
    try {
      const r = await api('POST', `/api/v1/notebooks/${id}/merge`,
        { into: maal, mode: tilstand });
      luk();
      toast(tilstand === 'side'
        ? `“${navn}” is now a page in “${maalNavn}” with ${r.top} subpage${
          r.top === 1 ? '' : 's'}.`
        : `${r.notes} note${r.notes === 1 ? '' : 's'} moved to “${maalNavn}”.`);
      // Stod man i en note fra bogen, findes noten stadig - men traeet og
      // brødkrummerne skal tegnes om, saa den staar det rigtige sted.
      await hentTrae();
      await hentState();
      tegnTrae();
      opdaterNav();
      if (editor.note) await aabnNote(editor.note.id, true);
    } catch (ex) { toast(ex.message); }
  });
}

function visFlytRude(n) {
  const boeger = state.notebooks || [];
  const host = document.createElement('div');
  host.className = 'modal';
  host.id = 'flytRude';
  host.innerHTML = `<div class="modal-kort">
      <div class="modal-top">
        <h2>Move “${esc(n.title || 'Untitled')}”</h2>
        <button class="iconbtn" id="flytLuk" aria-label="Close">${icon('luk', 16)}</button>
      </div>
      <div class="modal-krop">
        <p class="meta saetning">Subpages come along — a page and everything under it
        lives in one notebook.</p>
        <label class="field"><span>Notebook</span>
          <select class="input" id="flytBog">
            <option value="">No notebook</option>
            ${boeger.map((b) => `<option value="${esc(b.id)}"${
  b.id === n.notebookId ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}
          </select></label>
        <div class="btnrow" style="margin-top:16px">
          <button class="btn primary" id="flytGem">Move</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(host);

  const luk = () => { host.remove(); document.removeEventListener('keydown', paaTast); };
  const paaTast = (e) => { if (e.key === 'Escape') { e.preventDefault(); luk(); } };
  document.addEventListener('keydown', paaTast);
  host.querySelector('#flytLuk').addEventListener('click', luk);
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });

  host.querySelector('#flytGem').addEventListener('click', async () => {
    const bog = host.querySelector('#flytBog').value || null;
    try {
      // parentId: null, fordi en note, der flytter notesbog, ikke laengere kan
      // haenge under en side i den gamle. Serveren ville ellers rette
      // notesbogen tilbage til foraelderens (flytNote).
      await api('POST', `/api/v1/notes/${n.id}/move`, { parentId: null, notebookId: bog });
      luk();
      await hentTrae();
      tegnTrae();
      // `aabnNote` paa den note, der ALLEREDE er aaben, gaar tilbage med det
      // samme - den henter ikke forfra. Derfor synkes felterne fra traeet.
      synkAabenNote();
      toast(bog ? 'Moved.' : 'Moved out of its notebook.');
    } catch (ex) { toast(ex.message); }
  });
}

/**
 * Aabn noten i sit eget vindue (F29).
 *
 * »Kan du lave en knap saa man kan poppe en note ud i sit eget vindue, saa
 * den er til at have ved siden af?« (Andreas, 2026-09-05).
 *
 * ── Vinduet faar NOTENS navn ──────────────────────────────────────────────
 *
 * `window.open`s andet argument er vinduets navn, og det er ikke pynt her:
 * aabner man den SAMME note ud igen, henter browseren det vindue frem, der
 * allerede staar - i stedet for at lave nummer to af den samme note. To
 * vinduer paa én note ville vaere to editorer paa én tekst.
 *
 * ── `gemNu()` FOER, og uden await ─────────────────────────────────────────
 *
 * Har man skrevet i noten, ligger rettelsen i en debounce, og det nye vindue
 * henter noten fra serveren. Derfor sendes PATCH'en af sted foerst.
 *
 * Uden `await`, med vilje: `window.open` skal koere i SAMME hop som klikket,
 * ellers er brugerhandlingen brugt op, og browseren blokerer vinduet. Vi
 * sender altsaa gemningen af sted og aabner straks efter. Naar den sidste
 * rettelse i sjaeldne tilfaelde ikke naar med, er det ikke et tab: serverens
 * `ifUpdatedAt`-vagt afviser den, der skriver ovenpaa, saa det bliver en
 * konflikt man kan se - ikke en tekst, der forsvinder.
 */
function popUdNote(n) {
  if (typeof gemNu === 'function') gemNu();
  /*
   * `location.pathname`, ikke `offentligBase()`. Linket i menuen skal pege
   * paa den adresse, man DELER; det her vindue skal aabne paa den samme
   * oprindelse, man allerede sidder paa - ellers foelger sessionen ikke med.
   */
  const adr = `${location.pathname}?solo=1#note-${n.id}`;
  const v = window.open(adr, `sagu-note-${n.id}`, 'popup,width=560,height=800');
  if (!v) { toast('The browser blocked the window. Allow pop-ups for Sagu.'); return; }
  try { v.focus(); } catch { /* et vindue, der ikke vil frem, er stadig aabent */ }
}

function visNoteMenu() {
  const gammel = document.getElementById('noteMenu');
  if (gammel) { gammel.remove(); return; }
  const anker = document.getElementById('menuBtn');
  const vaert = document.querySelector('.note-tools');
  if (!anker || !vaert) return;
  const n = editor.note;
  // Den soeskende, der staar lige FOER - det er den, en indrykning lander
  // under. Findes den ikke, er der intet at rykke ind under, og punktet
  // staar der ikke: en knap, der ikke kan goere noget, er ikke en knap.
  const foer = soeskendeFoer(n);

  /*
   * Menuen viser kun det, man faktisk kan.
   *
   * `mit` = jeg ejer siden; `ret` = jeg maa skrive i den. En knap, der
   * afviser, naar man trykker paa den, er ikke en knap - det er en faelde, og
   * paa en delt side ville halvdelen af menuen vaere det (F11). Serveren
   * afviser uanset hvad; det her er, for at man ikke skal proeve.
   */
  const mit = n.mine !== false;
  const ret = maaRette(n);

  const host = document.createElement('div');
  host.className = 'usermenu notemenu';
  host.id = 'noteMenu';
  host.innerHTML = `
    ${ret ? `<button class="usermenu-item" data-do="sub">${icon('plus', 16)}<span>New subpage</span></button>
    <button class="usermenu-item" data-do="fil">${icon('klips', 16)}<span>Attach a file…</span></button>` : ''}
    <button class="usermenu-item" data-do="md">${icon('notes', 16)}<span>Show as markdown</span></button>
    <button class="usermenu-item" data-do="pdf">${icon('import', 16)}<span>Save as PDF…</span></button>
    <button class="usermenu-item" data-do="id">${icon('key', 16)}<span>Copy the note ID</span></button>
    <button class="usermenu-item" data-do="link">${icon('globe', 16)}<span>Copy the link to this note</span></button>
    <button class="usermenu-item" data-do="historik">${icon('kalender', 16)}<span>Version history</span></button>
    ${mit ? `<button class="usermenu-item" data-do="dup">${icon('copy', 16)}<span>Duplicate</span></button>
    <button class="usermenu-item" data-do="dupall">${icon('copy', 16)}<span>Duplicate with subpages</span></button>
    ${foer ? `<button class="usermenu-item" data-do="ind">${icon('ind', 16)}<span>Make it a subpage of “${
  esc((foer.title || 'Untitled').slice(0, 24))}”</span></button>` : ''}
    <button class="usermenu-item" data-do="op">${icon('fold', 16)}<span>Move up</span></button>
    <button class="usermenu-item" data-do="ned">${icon('udfold', 16)}<span>Move down</span></button>
    <button class="usermenu-item" data-do="flyt">${icon('book', 16)}<span>Move to notebook…</span></button>
    ${n.parentId ? `<button class="usermenu-item" data-do="root">${icon('out', 16)}<span>Move to top level</span></button>` : ''}` : ''}
    ${soloVindue() ? '' : `<button class="usermenu-item" data-do="popud">${icon('vindue', 16)}<span>Open in its own window</span></button>`}
    <button class="usermenu-item" data-do="fs">${icon('focus', 16)}<span>Browser fullscreen</span></button>
    ${mit ? `<button class="usermenu-item danger" data-do="del">${icon('trash', 16)}<span>Move to trash</span></button>` : ''}`;
  vaert.appendChild(host);

  host.querySelectorAll('[data-do]').forEach((el) => {
    el.addEventListener('click', async () => {
      const hvad = el.dataset.do;
      host.remove();
      try {
        /*
         * Foerst i listen, og synkront: `window.open` skal naa at koere,
         * mens klikket stadig taeller som en brugerhandling. Ét `await`
         * foran ville vaere nok til, at browseren blokerede vinduet.
         */
        if (hvad === 'popud') { popUdNote(n); return; }
        if (hvad === 'fil') { vaelgFiler(); return; }
        if (hvad === 'md') { visMarkdownPanel(); return; }
        if (hvad === 'pdf') { gemSomPdf(n); return; }
        /*
         * Note-id'et er det, API'et kalder `?to=NOTE_ID` (F9).
         *
         * Det stod KUN i adressefeltet, og en browser viser ikke altid
         * fragmentet - Chrome forkorter til vaertsnavnet, saa der bogstavelig
         * talt ikke var noget at laese af (Andreas, 2026-08-21, med et
         * skaermbillede hvor der staar »sagu.dk« og intet andet).
         *
         * En vaerdi, opskrifterne beder om, skal kunne HENTES i appen. Ellers
         * er hjaelpesiden en anvisning paa noget, man ikke kan skaffe.
         */
        /*
         * Det direkte link - Sagus egen adresse til noten.
         *
         * `offentligBase()` og ikke `location.origin`: Sagu kan naas paa flere
         * adresser (panelets IP:port, tunnelen, det rigtige domaene), og et
         * link, man sender videre, skal pege paa DEN, der er meningen - den
         * samme, udgivelserne og API-opskrifterne skrives med (DESIGN.md §15).
         * Ellers deler man en adresse, kun man selv kan naa.
         */
        if (hvad === 'link') {
          const adr = `${offentligBase()}/#note-${n.id}`;
          try {
            await navigator.clipboard.writeText(adr);
            toast('Link copied.');
          } catch {
            visIdPanel(adr, 'Link to this note');
          }
          return;
        }
        if (hvad === 'historik') { visHistorikPanel(n); return; }
        if (hvad === 'id') {
          try {
            await navigator.clipboard.writeText(n.id);
            toast('Note ID copied.');
          } catch {
            // Uden udklipsholder (http, aeldre browser): vis det, saa det kan
            // markeres i haanden. En besked om at det ikke lykkedes hjaelper
            // ingen, der bare skal bruge de 32 tegn.
            visIdPanel(n.id);
          }
          return;
        }
        if (hvad === 'sub') { await opretOgAaben({ parentId: n.id }); return; }
        if (hvad === 'fs') { saetFokus(true); await slaaBrowserFuldskaerm(); return; }
        if (hvad === 'dup' || hvad === 'dupall') {
          const d = await api('POST', `/api/v1/notes/${n.id}/duplicate`, { withChildren: hvad === 'dupall' });
          await hentTrae();
          tegnTrae();
          await aabnNote(d.note.id);
          return;
        }
        if (hvad === 'op' || hvad === 'ned') { await flytNoteISort(n, hvad === 'op' ? -1 : 1); return; }
        if (hvad === 'ind') {
          // Indrykning: noten bliver en underside af den, der stod lige foer.
          // Serveren flytter hele undertraeet med og synker notesbogen.
          await api('POST', `/api/v1/notes/${n.id}/move`, { parentId: foer.id });
          editor.foldede.delete(foer.id);
          gemFoldede();
          await hentTrae();
          tegnTrae();
          synkAabenNote();
          return;
        }
        if (hvad === 'flyt') { visFlytRude(n); return; }
        if (hvad === 'root') {
          await api('POST', `/api/v1/notes/${n.id}/move`, { parentId: null });
          await hentTrae();
          tegnTrae();
          synkAabenNote();
          return;
        }
        if (hvad === 'del') {
          const svar = await api('DELETE', `/api/v1/notes/${n.id}`);
          // Sig hvor mange der fulgte med - ellers opdager man foerst
          // bagefter, at undersiderne ogsaa er vaek.
          toast(svar.deleted > 1
            ? `Moved to trash with ${svar.deleted - 1} subpage${svar.deleted > 2 ? 's' : ''}.`
            : 'Moved to trash.', {
            label: 'Undo',
            run: async () => {
              try {
                await api('POST', `/api/v1/notes/${n.id}/restore`, {});
                await hentTrae();
                tegnTrae();
                await aabnNote(n.id);
              } catch (ex) { toast(ex.message); }
            },
          });
          editor.note = null;
          await hentTrae();
          tegnTrae();
          gaaTil('notes');
        }
      } catch (ex) { toast(ex.message); }
    });
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

/* ------------------------------------------------------------- genveje */

/*
 * Kun det, der IKKE staar i genvejsbordet.
 *
 * Selve genvejene bor i `GENVEJE` i p12 - ét sted, saa hjaelpeoversigten er
 * genereret og ikke skrevet af (F13). Tilbage her er den ene ting, bordet
 * ikke kan udtrykke: **Escape ud af fokustilstand, ogsaa mens man staar i et
 * felt.** Alle andre genveje skal netop IKKE fyre, mens man skriver - den her
 * skal, fordi fokustilstand er noget, man vil ud af, uden foerst at skulle
 * finde ud af, hvor markoeren er.
 */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !erIFokus()) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  // ... men ikke, mens en raa blok er aaben: dér lukker Escape blokken.
  if (document.getElementById('blokFelt')) return;
  saetFokus(false);
});

// Forlader man browserens fuldskaerm med Esc, skal vores egen tilstand foelge
// med - ellers staar appen i fokus uden at nogen bad om det.
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && erIFokus() && state.view !== 'note') saetFokus(false);
});

// En ventende gemning maa ikke gaa tabt, fordi fanen lukkes.
window.addEventListener('beforeunload', (e) => {
  if (editor.beskidt) { gemNu(); e.preventDefault(); e.returnValue = ''; }
});

/*
 * Note-id'et vist, når udklipsholderen ikke kan bruges.
 *
 * `navigator.clipboard` findes kun i et sikkert kontekst - Sagu nås også på
 * `IP:port` over ren http fra panelet, og dér findes den ikke. En besked om
 * at kopieringen mislykkedes hjælper ingen, der bare skal bruge de 32 tegn:
 * så er det bedre at vise dem markeret, klar til ⌘C.
 */
function visIdPanel(id, overskrift) {
  // `esc`, ikke `attr`: fladens egen `esc` escaper OGSAA anfoerselstegn og er
  // dermed attributsikker - `attr` findes kun i det delte markdown-modul og er
  // ikke global her. Det saas foerst, da reserveveien faktisk blev gaaet.
  const gammel = document.getElementById('idPanel');
  if (gammel) gammel.remove();

  const host = document.createElement('div');
  host.className = 'modal';
  host.id = 'idPanel';
  host.innerHTML = `<div class="modal-kort">
      <div class="modal-top">
        <h2>${esc(overskrift || 'Note ID')}</h2>
        <button class="iconbtn" id="idLuk" aria-label="Close">${icon('luk', 16)}</button>
      </div>
      <div class="modal-krop">
        <input class="input" id="idFelt" value="${esc(id)}" readonly
          autocomplete="off" spellcheck="false">
        <p class="meta saetning" style="margin-top:10px">${overskrift
    ? 'Anyone with an account on this server can open it. It is not a published page — '
      + 'use <strong>Publish</strong> for that.'
    : 'This is what the API calls <code>NOTE_ID</code> — the address a shortcut adds to with '
      + '<code>?to=…</code>. See <strong>API &amp; shortcuts</strong> for the recipes.'}</p>
      </div>
    </div>`;
  document.body.appendChild(host);

  const luk = () => { host.remove(); document.removeEventListener('keydown', paaTast); };
  const paaTast = (e) => { if (e.key === 'Escape') { e.preventDefault(); luk(); } };
  document.addEventListener('keydown', paaTast);
  host.querySelector('#idLuk').addEventListener('click', luk);
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });
  const felt = host.querySelector('#idFelt');
  felt.focus();
  felt.select();
}

/* ============================ versionshistorik (F22) ====================
 *
 * »Det skal være muligt at gå 30 versioner tilbage af en note« (Andreas,
 * 2026-08-25).
 *
 * ── Hvad ruden skal kunne, og hvad den ikke skal ──────────────────────────
 *
 * Den skal vise HVORNÅR, og hvad der stod. Den skal ikke være en
 * forskelsvisning: at se to tekster side om side med farvede linjer er en
 * anden funktion, og den, der leder efter »hvad stod der i tirsdags«, er
 * hjulpet af at læse det — ikke af at se hvad der blev ændret.
 *
 * ── Gendannelsen sker ét sted ─────────────────────────────────────────────
 *
 * Serveren gemmer den nuværende tekst som en version, FØR den skriver den
 * gamle tilbage. Fladen behøver derfor ikke passe på noget: en gendannelse er
 * en rettelse som alle andre, og vejen tilbage findes i den samme liste.
 */
async function visHistorikPanel(note) {
  const gammel = document.getElementById('historikPanel');
  if (gammel) gammel.remove();

  const host = document.createElement('div');
  host.className = 'modal';
  host.id = 'historikPanel';
  host.innerHTML = `<div class="modal-kort bred">
      <div class="modal-top">
        <h2>Version history</h2>
        <button class="iconbtn" id="hisLuk" aria-label="Close">${icon('luk', 16)}</button>
      </div>
      <div class="modal-krop" id="hisKrop"><p class="meta saetning">Loading…</p></div>
    </div>`;
  document.body.appendChild(host);

  const luk = () => { host.remove(); document.removeEventListener('keydown', paaTast); };
  const paaTast = (e) => { if (e.key === 'Escape') { e.preventDefault(); luk(); } };
  document.addEventListener('keydown', paaTast);
  host.querySelector('#hisLuk').addEventListener('click', luk);
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });

  const krop = host.querySelector('#hisKrop');
  let d;
  try { d = await api('GET', `/api/v1/notes/${note.id}/versions`); }
  catch (ex) { krop.innerHTML = `<p class="lead">${esc(ex.message)}</p>`; return; }

  if (!d.versions.length) {
    /*
     * Tom af to grunde, og de betyder ikke det samme.
     *
     * »Slået fra« skal ikke se ud som »der er ikke sket noget endnu« - i det
     * ene tilfælde er der en knap at trykke på, i det andet er der ingenting
     * at gøre.
     */
    krop.innerHTML = d.enabled
      ? '<p class="lead">Nothing yet. A version is kept each time you come back and change '
        + 'something — edits within the same sitting count as one.</p>'
      : '<p class="lead">Version history is switched off.</p>'
        + '<div class="btnrow" style="margin-top:12px">'
        + '<button class="btn" id="hisTilIndst">Open settings</button></div>';
    const knap = krop.querySelector('#hisTilIndst');
    if (knap) knap.addEventListener('click', () => { luk(); gaaTil('settings'); });
    return;
  }

  /*
   * Overskriften skal passe til KONTAKTEN, ikke bare til listen.
   *
   * Her stod »Keeping the last 30 versions« uanset hvad - ogsaa naar
   * historikken var slaaet fra og der altsaa ikke bliver gemt flere. Den
   * tomme rude sagde det rigtige; den fyldte sagde noget andet. En
   * hjaelpetekst er en kravspecifikation, ogsaa naar den staar over en liste,
   * der ser rigtig ud.
   */
  krop.innerHTML = `<p class="meta saetning">${d.enabled
    ? `Keeping the last ${esc(String(d.keep))} versions of each note. `
      + 'Edits within the same sitting count as one.'
    : '<strong>Switched off.</strong> These were kept earlier — no new ones are being added.'}</p>
    <div class="historik">
      <ul class="historik-liste">${d.versions.map((v, i) => `
        <li><button class="historik-rk${i === 0 ? ' paa' : ''}" data-v="${esc(v.id)}">
          <span class="historik-tid">${esc(visTid(v.at))}</span>
          <span class="historik-titel">${esc(v.title || 'Untitled')}</span>
          <span class="meta">${esc(visStoerrelse(v.size))}</span>
        </button></li>`).join('')}</ul>
      <div class="historik-vis" id="hisVis"><p class="meta saetning">Pick a version.</p></div>
    </div>`;

  const vis = krop.querySelector('#hisVis');
  let valgt = null;
  const hent = async (id) => {
    valgt = id;
    krop.querySelectorAll('.historik-rk').forEach((b) => b.classList.toggle('paa', b.dataset.v === id));
    vis.innerHTML = '<p class="meta saetning">Loading…</p>';
    try {
      const r = await api('GET', `/api/v1/notes/${note.id}/versions/${id}`);
      // Teksten vises som MARKDOWN, ikke renderet: det er den, der bliver
      // skrevet tilbage, og så skal det være den, man ser.
      vis.innerHTML = `<div class="btnrow" style="margin-bottom:10px">
          <button class="btn primary" id="hisGendan">Restore this version</button>
        </div>
        <pre class="historik-tekst">${esc(r.version.body)}</pre>`;
      vis.querySelector('#hisGendan').addEventListener('click', async () => {
        try {
          const svar = await api('POST', `/api/v1/notes/${note.id}/versions/${id}`);
          luk();
          editor.note = svar.note;
          editor.beskidt = false;
          editor.aabenBlok = null;
          tegnSide();
          toast('Restored. The version you left is in the history too.');
        } catch (ex) { toast(ex.message); }
      });
    } catch (ex) { vis.innerHTML = `<p class="meta saetning">${esc(ex.message)}</p>`; }
  };
  krop.querySelectorAll('.historik-rk').forEach((b) => {
    b.addEventListener('click', () => { if (b.dataset.v !== valgt) hent(b.dataset.v); });
  });
  hent(d.versions[0].id);
}

/* ==================== hele noten som markdown (F23) ====================
 *
 * »Tilføj en mulighed under settings som hvis slået til så når man klikker på
 * en linje i en note gør hele noten til markdown og ikke kun det element som
 * man har klikket på« (Andreas, 2026-08-25).
 *
 * ── Hvorfor det er et VALG og ikke en erstatning ──────────────────────────
 *
 * Den hybride editor — ét afsnit råt, resten renderet — er god, når man retter
 * en sætning i en lang note: man ser stadig, hvad noten er. Den er i vejen,
 * når man skal flytte rundt på det hele, rette en tabel eller klippe og
 * klistre på tværs af afsnit. Det er to måder at arbejde på, ikke en rigtig og
 * en forkert.
 *
 * ── Klikket lander samme sted ─────────────────────────────────────────────
 *
 * Markøren sættes ved den blok, man klikkede på — ikke i toppen. Ellers skal
 * man lede efter sin egen linje i en note på hundrede afsnit, og så var det
 * hurtigere at lade være med at klikke.
 */
function heleNoten() {
  return !!(state.prefs && state.prefs.editWhole);
}

/** Erstatter HELE noten med ét råt markdown-felt. */
function tegnHeleNoten(host, n) {
  host.innerHTML = `<div class="blok-redigering hel">
      <textarea class="blok-felt hel-felt" id="blokFelt" spellcheck="false"></textarea>
      <button class="blok-hjaelp" id="blokHjaelp" type="button" tabindex="-1"
        aria-label="How to write this" title="How to write this">?</button>
    </div>`;

  const felt = document.getElementById('blokFelt');
  felt.value = n.body;
  autoHoejde(felt);

  const hj = document.getElementById('blokHjaelp');
  // `mousedown`, ikke `click`: et klik ville tage fokus fra feltet, og `blur`
  // lukker editoren - saa var man ude af det, man skrev, for at se hjaelpen.
  hj.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); visSyntaksPanel(); });
  hj.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); visSyntaksPanel(); },
    { passive: false });

  felt.focus();
  /*
   * Markoeren ved den blok, man klikkede paa.
   *
   * `editor.aabenBlok` er blokkens FOERSTE linje i markdown'en, saa
   * tegnpositionen er summen af linjerne foer den. Findes linjen ikke
   * (noten er aendret imens), lander vi i toppen frem for at gaette.
   */
  const linjer = n.body.split('\n');
  const nr = Math.min(Math.max(0, editor.aabenBlok || 0), linjer.length);
  const pos = linjer.slice(0, nr).reduce((sum, l) => sum + l.length + 1, 0);
  felt.setSelectionRange(pos, pos);
  // Rul feltet, saa markoeren er synlig. Uden det staar man paa linje 200 i
  // et felt, der viser linje 1.
  felt.blur();
  felt.focus();

  felt.addEventListener('input', () => {
    byttedeTekstgenvej(felt);
    autoHoejde(felt);
    n.body = felt.value;
    markerBeskidt();
    opdaterWikiForslag(felt);
  });

  felt.addEventListener('paste', (e) => { haandterIndsaet(e, felt); });
  felt.addEventListener('dragover', (e) => { e.preventDefault(); felt.classList.add('traekker'); });
  felt.addEventListener('dragleave', () => felt.classList.remove('traekker'));
  felt.addEventListener('drop', (e) => {
    e.preventDefault();
    felt.classList.remove('traekker');
    haandterIndsaet(e, felt);
  });

  felt.addEventListener('keydown', (e) => {
    if (wikiTast(e)) return;
    if (e.key === 'Escape') { e.preventDefault(); lukBlok(); return; }
    /*
     * Piletasterne skal IKKE krydse nogen graense her.
     *
     * Den hybride editor springer til nabo-blokken, naar man staar yderst -
     * fordi resten af noten er andre elementer. Her ER hele noten i feltet,
     * saa browserens egen opfoersel er den rigtige. Springer man alligevel,
     * lukker man editoren, hver gang man rammer foerste eller sidste linje.
     */
    e.stopPropagation();
  });

  felt.addEventListener('blur', () => {
    // Kun hvis fokus forlod feltet - et klik paa hjaelpeknappen holder det.
    setTimeout(() => {
      if (document.activeElement && document.activeElement.id === 'blokFelt') return;
      lukWikiForslag();
      lukBlok();
    }, 0);
  });

  byggToc();
}

/* ---- p5_omni.js ---- */
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

const omni = {
  mode: null,
  raekker: [],
  valgt: 0,
  timer: null,
  token: 0,
  soeger: false,
  fallback: false,
  seneste: [],
};

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
  const dele = m ? m.legend : OMNI_LEGEND;
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
function tegnOmniChips(tolket) {
  const host = document.getElementById('omniChips');
  if (!host) return;
  const dele = tolket ? saguSoeg.beskriv(tolket) : [];
  if (omni.fallback) dele.push('no index match — read the text');
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

  if (omni.mode === '*') {
    const p = plukMaerker(tekst);
    omni.raekker = [{
      slags: 'ny',
      tekst: p.tekst,
      maerker: p.maerker,
      etiket: p.tekst ? `Create "${p.tekst}"` : 'Create a note',
      meta: p.maerker.length ? p.maerker.map((m) => `#${m}`).join(' ') : '',
    }];
    tegnOmniChips(null);
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
      .map((t) => ({ slags: 'tag', id: t.id, etiket: `#${t.name}` }));
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
      const d = await api('GET', `/api/v1/search?q=${encodeURIComponent(raa)}`);
      // Et AELDRE svar maa aldrig overskrive et nyere.
      if (mit !== omni.token) return;
      omni.fallback = !!d.fallback;
      omni.raekker = d.results.map((r) => ({
        slags: 'note',
        id: r.id,
        etiket: r.title || 'Untitled',
        uddrag: r.excerpt,
        afsnit: r.section,
        afsnitTitel: r.sectionTitle,
        meta: r.notebook,
      }));
      // Oprettelse er den SIDSTE raekke - altid der, aldrig i vejen.
      const p = plukMaerker(tolket.tekst || raa.trim());
      omni.raekker.push({
        slags: 'ny',
        tekst: p.tekst,
        // Baade det, man skrev som `#drift`, og et `tag:drift`-filter: har man
        // ledt efter noget under et maerke og ikke fundet det, er det dér, den
        // nye note hoerer hjemme.
        maerker: p.maerker.concat(tolket.tags || []),
        etiket: `Create "${p.tekst}"`,
      });
      omni.valgt = 0;
      tegnOmniChips(tolket);
      tegnPanel();
    } catch (ex) {
      if (mit !== omni.token) return;
      omni.raekker = [{ slags: 'fejl', etiket: ex.message }];
      tegnPanel();
    }
  }, 140);
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
            ${r.uddrag ? `<span class="omni-row-uddrag">${uddrag(r.uddrag)}</span>` : ''}
          </span>
          <span class="omni-row-meta meta">${r.afsnitTitel ? esc(r.afsnitTitel)
    : (r.meta ? esc(r.meta) : '')}</span>
        </a>`;
    }
    const ikon = { ny: 'plus', nybog: 'book', bog: null, tag: 'tag', doda: 'plus', fejl: 'notes' }[r.slags];
    return `<button class="omni-row${paa}${r.slags === 'fejl' ? ' fejl' : ''}" data-row="${i}">
        <span class="omni-row-ikon">${r.ikon ? esc(r.ikon) : icon(ikon || 'book', 16)}</span>
        <span class="omni-row-tekst"><span class="omni-row-titel">${esc(r.etiket)}</span>
          ${r.under ? `<span class="omni-row-uddrag">${esc(r.under)}</span>` : ''}</span>
      </button>`;
  }).join('');
  host.hidden = false;

  host.querySelectorAll('[data-row]').forEach((el) => {
    el.addEventListener('mousedown', (e) => e.preventDefault());   // behold fokus i feltet
    el.addEventListener('click', (e) => {
      /*
       * ⌘/Ctrl-klik, midterklik og shift-klik er browserens egne. Kalder vi
       * `preventDefault()` paa dem, aabner den nye fane aldrig - og saa har
       * linket kun set ud som et link.
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
    await opretOgAaben({ title: r.tekst || 'Untitled', tags: r.maerker || [] });
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
  if (r.slags === 'bog') { ryd(); gaaTil('notes', { notebook: r.id }); return; }
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
 */
async function sendOpgaveTilDoda(tekst) {
  const note = state.view === 'note' && editor.note ? editor.note : null;
  try {
    if (!note) {
      // Uden en note er der ingen note-rute at gaa igennem. Broen har en
      // fritstaaende doer, saa markoeren virker fra enhver skaerm.
      const r = await api('POST', '/api/v1/doda/tasks', { text: tekst });
      toast(r.message || 'Sent to doda.');
      return;
    }
    const r = await api('POST', `/api/v1/notes/${note.id}/tasks`, { text: tekst });
    dodaState.opgaver = r.tasks || [];
    dodaState.noteId = note.id;
    tegnDodaOpgaver();
    toast(r.message || 'Sent to doda.');
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
      return;
    }
    toast(ex && ex.message ? ex.message : 'Could not reach doda.');
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
  saetMode(null);
  tegnLegend();
  tegnOmniChips(null);
  tegnPanel();
}

/* -------------------------------------------------------------- binding */

function bindOmni() {
  const el = omniEl();
  if (!el) return;

  el.addEventListener('input', () => { omni.valgt = 0; opdaterOmni(); });
  el.addEventListener('focus', () => { if (!omni.raekker.length) opdaterOmni(); });

  el.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); omni.valgt++; tegnPanel(); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); omni.valgt--; tegnPanel(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      /*
       * ⌘/Ctrl+Enter aabner i en ny fane og lader soegningen staa. Det er
       * tastaturets udgave af ⌘-klik, og linjen under feltet lover det.
       */
      if (e.metaKey || e.ctrlKey) {
        const r = omni.raekker[omni.valgt];
        if (r && r.slags === 'note' && r.id) { window.open(`#note-${r.id}`, '_blank'); return; }
      }
      vaelgRaekke(omni.valgt);
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); ryd(); }
  });

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

/** De senest aendrede noter - svaret paa et tomt felt. */
async function hentSeneste() {
  try {
    const d = await api('GET', '/api/v1/notes?limit=8');
    omni.seneste = d.notes.slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 8);
  } catch { omni.seneste = []; }
}

/* ---- p6_blokke.js ---- */
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

/* ---- p7_udgiv.js ---- */
'use strict';
/* Sagu - at udgive en note som wiki (F6).
 *
 * Ruden er noteskaermens, fordi det er DÉR beslutningen tages: »denne side og
 * dens undersider skal kollegaerne kunne laese«. Listen over alt, der er
 * udgivet, staar i Settings - man skal kunne se hele fladen ét sted uden at
 * gaa gennem alle sine noter.
 *
 * Knappen i vaerktoejsraekken skifter udseende, naar noten ER udgivet. En
 * handling, der aendrer noget, skal efterlade et spor dér, hvor den blev
 * udfoert (RUNE-ERFARINGER, tovo v8) - ellers bliver funktionen meldt som
 * manglende, selv om den virker.
 */

/**
 * Den adresse, et link skal SKRIVES med.
 *
 * `location.origin` er den, browseren tilfaeldigvis staar paa - og Sagu kan
 * naas paa flere paa én gang. Uden valget ville et link, man kopierer fra den
 * ene adresse, sende kollegaen et andet sted hen end et kopieret fra den
 * anden. Tom indstilling = praecis som foer: browserens egen vaert.
 */
function offentligBase() {
  return (state.publicUrl || '').replace(/\/+$/, '') || location.origin;
}

/** Hele adressen. Vaerten er den offentlige; serveren gemmer kun stien. */
function udgivelsesLink(share) {
  return offentligBase() + share.path;
}

/**
 * Udgivelsen for ét maal - eller null. Ét kald, ikke en liste.
 *
 * @param {{slags:'note'|'bog', id:string, titel:string}} maal
 */
async function hentUdgivelse(maal) {
  const felt = maal.slags === 'bog' ? 'notebook' : 'note';
  try {
    const d = await api('GET', `/api/v1/shares?${felt}=${encodeURIComponent(maal.id)}`);
    return (d.shares && d.shares[0]) || null;
  } catch { return null; }
}

function udgivKnapHtml(share) {
  const paa = !!share;
  return `<button class="iconbtn${paa ? ' paa' : ''}" id="udgivBtn"
    aria-pressed="${paa ? 'true' : 'false'}"
    title="${paa ? 'Published on the web — open the settings' : 'Publish on the web'}">${icon('globe', 16)}</button>`;
}

/* ------------------------------------------------------------------ ruden */

/**
 * Udgivelsesruden.
 *
 * @param {{slags:'note'|'bog', id, titel}} [maal] - standard er den aabne note.
 *   En NOTESBOG kan udgives ligesaa vel som en side: et importeret arkiv ER en
 *   bog med sider i, og at kraeve en kunstig forside for at dele den ville
 *   vaere at bede brugeren om at lave om paa sit indhold for appens skyld
 *   (Andreas, 2026-08-21).
 */
async function visUdgivPanel(maal) {
  // `maal && maal.slags`, ikke bare `maal`: bindes funktionen ved et uheld
  // direkte som klik-handler, er argumentet en MouseEvent - den er sand, og
  // saa ville ruden arbejde videre paa et maal uden id. Vagten koster én
  // betingelse og lukker hele fejlklassen.
  const m = (maal && maal.slags) ? maal : (editor.note
    ? { slags: 'note', id: editor.note.id, titel: editor.note.title || 'Untitled' }
    : null);
  if (!m) return;
  const n = m.slags === 'note' && editor.note && editor.note.id === m.id ? editor.note : null;
  const gammel = document.getElementById('udgivPanel');
  if (gammel) { gammel.remove(); return; }

  const host = document.createElement('div');
  host.className = 'modal';
  host.id = 'udgivPanel';
  host.innerHTML = `<div class="modal-kort">
      <div class="modal-top">
        <h2>Publish “${esc(m.titel)}”</h2>
        <button class="iconbtn" id="udgivLuk" aria-label="Close">${icon('luk', 16)}</button>
      </div>
      <div class="modal-krop" id="udgivKrop"><p class="meta saetning">Loading…</p></div>
    </div>`;
  document.body.appendChild(host);

  const luk = () => { host.remove(); document.removeEventListener('keydown', paaTast); };
  const paaTast = (e) => { if (e.key === 'Escape') { e.preventDefault(); luk(); } };
  document.addEventListener('keydown', paaTast);
  host.querySelector('#udgivLuk').addEventListener('click', luk);
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });

  const krop = host.querySelector('#udgivKrop');
  let share = await hentUdgivelse(m);
  /*
   * Hvad laeserne ledte efter uden at finde noget.
   *
   * Loggen har ligget der siden F2, men kunne ikke SES nogen steder - og en
   * funktion, man ikke kan se, bliver meldt som manglende (tovo v8). Det er
   * samtidig den bedste indholdsplan en wiki kan faa (SAGU-PLAN §5): listen
   * siger, hvilke sider der mangler.
   */
  let forgaeves = [];
  if (share) {
    try {
      forgaeves = (await api('GET', `/api/v1/search-misses?scope=${share.id}`)).misses || [];
    } catch { /* listen er en tilgift, ikke en forudsaetning */ }
  }

  /** Tegner ruden om ud fra tilstanden. Ét sted, saa de to tilstande ikke driver. */
  function tegn() {
    krop.innerHTML = share ? udgivetHtml(share, m, { forgaeves }) : ikkeUdgivetHtml(m);
    bind();
    // Knappen i vaerktoejsraekken skal foelge med med det samme - ellers ser
    // man ikke, at noget skete, foer siden tegnes forfra. Og notens eget felt
    // skal rettes med, ellers lyver knappen ved naeste optegning.
    // Kun en NOTE baerer sin udgivelse i sit eget objekt; en bogs staar i
    // traeet og hentes derfra.
    if (n) n.published = share ? { id: share.id, path: share.path, hasPassword: share.hasPassword } : null;
    const knap = document.getElementById('udgivBtn');
    if (knap) {
      knap.classList.toggle('paa', !!share);
      knap.setAttribute('aria-pressed', share ? 'true' : 'false');
    }
  }

  function bind() {
    const q = (id) => krop.querySelector(`#${id}`);

    const udgiv = q('udgivNu');
    if (udgiv) {
      udgiv.addEventListener('click', async () => {
        udgiv.disabled = true;
        try {
          const d = await api('POST', '/api/v1/shares', Object.assign(
            m.slags === 'bog' ? { notebookId: m.id } : { noteId: m.id },
            {
            mode: m.slags === 'bog' ? 'tree' : q('udgivMode').value,
            slug: q('udgivSlug').value.trim() || null,
            password: q('udgivKode').value || null,
            allowSearch: true,
            }));
          share = d.share;
          toast('Published. Anyone with the link can read it.');
          tegn();
          // Traeet viser, hvilke boeger der er udgivet - det skal med samme.
          if (m.slags === 'bog') { await hentTrae(); tegnTrae(); }
        } catch (ex) { fejl(ex.message); udgiv.disabled = false; }
      });
    }

    const kopi = q('udgivKopi');
    if (kopi) {
      kopi.addEventListener('click', async () => {
        const felt = q('udgivUrl');
        // Ingen blindgyde: kan udklipsholderen ikke bruges (den kraever et
        // secure context, og panelet naas over http), saa MARKÉR i stedet.
        if (await kopier(udgivelsesLink(share))) { kopi.textContent = 'Copied'; } else if (markerTekst(felt)) {
          kopi.textContent = 'Press ⌘C';
        } else kopi.textContent = 'Could not copy';
        setTimeout(() => { kopi.textContent = 'Copy link'; }, 1600);
      });
    }

    const gemAdresse = q('udgivGemSlug');
    if (gemAdresse) {
      gemAdresse.addEventListener('click', () => saet({ slug: q('udgivSlug2').value.trim() || null }));
    }

    const kodeTil = q('udgivKodeTil');
    if (kodeTil) {
      kodeTil.addEventListener('click', () => {
        const v = q('udgivKodeNy').value;
        if (v.length < 6) { fejl('A wiki password must be at least 6 characters.'); return; }
        saet({ password: v });
      });
    }
    const kodeFra = q('udgivKodeFra');
    if (kodeFra) kodeFra.addEventListener('click', () => saet({ password: null }));

    krop.querySelectorAll('[data-flag]').forEach((el) => {
      el.addEventListener('change', () => saet({ [el.dataset.flag]: el.checked }));
    });

    const mode = q('udgivModeSkift');
    if (mode) mode.addEventListener('change', () => saet({ mode: mode.value }));

    // En koe, man skal lede efter, bliver aldrig toemt. Herfra er der ÉT klik
    // til den (RUNE-ERFARINGER, tovo v8).
    const tilKoe = q('udgivTilKoe');
    if (tilKoe) {
      tilKoe.addEventListener('click', () => {
        luk();
        gaaTil('comments');
      });
    }

    /*
     * En egen knap til at fjerne datoen.
     *
     * `<input type="date">` kan ikke ryddes i Safari - der er ingen kryds, og
     * feltet nulstiller ikke af sig selv. Uden knappen kunne en udgivelse med
     * en udloebsdato aldrig gøres permanent igen (Andreas, 2026-08-21).
     * Browserens egen kontrol er ikke altid en hel kontrol.
     */
    const intet = q('udgivIntetUdloeb');
    if (intet) intet.addEventListener('click', () => saet({ expiresAt: null }));

    const udloeb = q('udgivUdloeb');
    if (udloeb) {
      udloeb.addEventListener('change', () => {
        // Datoen laeses i LOKAL tid paa (aar, maaned, dag) og sendes som
        // sekunder. Aldrig en dato-streng: serveren skal ikke tolke tekst.
        if (!udloeb.value) { saet({ expiresAt: null }); return; }
        const [aa, mm, dd] = udloeb.value.split('-').map(Number);
        saet({ expiresAt: Math.floor(new Date(aa, mm - 1, dd, 23, 59, 59).getTime() / 1000) });
      });
    }

    const stop = q('udgivStop');
    if (stop) {
      stop.addEventListener('click', async () => {
        if (!confirm('Withdraw this link? Anyone who has it will get "Not found" on their next click.')) return;
        try {
          await api('DELETE', `/api/v1/shares/${share.id}`);
          share = null;
          toast('Withdrawn. The link is dead from the next click.');
          tegn();
          if (m.slags === 'bog') { await hentTrae(); tegnTrae(); }
        } catch (ex) { fejl(ex.message); }
      });
    }
  }

  function fejl(besked) {
    const el = krop.querySelector('#udgivFejl');
    if (el) { el.textContent = besked; el.hidden = false; } else toast(besked);
  }

  async function saet(felter) {
    try {
      const d = await api('PATCH', `/api/v1/shares/${share.id}`, felter);
      share = d.share;
      tegn();
    } catch (ex) { fejl(ex.message); }
  }

  tegn();
}

/* ------------------------------------------------------------ de to sider */

function ikkeUdgivetHtml(m) {
  const erBog = m.slags === 'bog';
  const forslag = (m.titel || 'wiki').toLowerCase()
    .replace(/[æ]/g, 'ae').replace(/[ø]/g, 'oe').replace(/[å]/g, 'aa')
    .replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return `
    <p class="lead">Put ${erBog ? 'this notebook' : 'this page'} on the web so people without
    an account can read it — the replacement for a Notion site.</p>
    ${erBog
    ? `<p class="meta saetning">Every page in the notebook is published, and the front page
       is a list of what is inside. Pages you add later come along by themselves.</p>`
    : `<label class="field"><span>What to publish</span>
      <select class="input" id="udgivMode">
        <option value="tree">This page and everything under it</option>
        <option value="single">Only this page</option>
      </select></label>`}
    <label class="field"><span>Web address</span>
      <div class="udgiv-adresse"><span class="adressepraefiks">${esc(offentligBase())}/w/</span>
        <input class="input" id="udgivSlug" value="${esc(forslag)}" placeholder="handbook"
          autocomplete="off" spellcheck="false"></div></label>
    <p class="meta saetning">Leave it empty for a long, unguessable address instead.</p>
    <label class="field"><span>Password (optional)</span>
      <input class="input" type="password" id="udgivKode" autocomplete="new-password"
        placeholder="No password — anyone with the link can read"></label>
    <p class="meta saetning">You can add or remove the password later, and the link stays
    the same either way.</p>
    <p class="wfejl" id="udgivFejl" hidden></p>
    <div class="btnrow" style="margin-top:16px">
      <button class="btn primary" id="udgivNu">Publish</button>
    </div>`;
}

function udgivetHtml(share, m, opt) {
  const o = opt || {};
  const erBog = share.kind === 'notebook';
  const url = udgivelsesLink(share);
  const dato = share.expiresAt
    ? new Date(share.expiresAt * 1000).toISOString().slice(0, 10) : '';
  return `
    <div class="udgiv-link">
      <input class="input" id="udgivUrl" value="${esc(url)}" readonly>
      <button class="btn" id="udgivKopi">Copy link</button>
      <a class="btn" href="${esc(share.path)}/" target="_blank" rel="noopener">Open</a>
    </div>
    <p class="meta saetning">${share.hasPassword
    ? 'Password protected. Visitors are asked for it before they see anything.'
    : 'Open — anyone with the link can read it. No account needed.'}
      ${share.views ? ` · read ${share.views} time${share.views === 1 ? '' : 's'}` : ' · not read yet'}</p>

    <h3 class="udgiv-hoved">What is published</h3>
    ${erBog
    ? `<p class="meta saetning">The whole notebook — every page in it, including ones you add later.</p>`
    : `<label class="field"><span>Scope</span>
      <select class="input" id="udgivModeSkift">
        <option value="tree"${share.mode === 'tree' ? ' selected' : ''}>This page and everything under it</option>
        <option value="single"${share.mode === 'single' ? ' selected' : ''}>Only this page</option>
      </select></label>`}
    <label class="switch"><input type="checkbox" data-flag="allowSearch"
      ${share.allowSearch ? 'checked' : ''}><span>Let readers search the wiki</span></label>
    <label class="switch"><input type="checkbox" data-flag="allowIndex"
      ${share.allowIndex ? 'checked' : ''}><span>Let search engines find it</span></label>
    <p class="meta saetning">Off means the page asks not to be indexed. A password-protected
    page is never indexed, whatever this says.</p>

    <h3 class="udgiv-hoved">Comments</h3>
    <label class="switch"><input type="checkbox" data-flag="allowComments"
      ${share.allowComments ? 'checked' : ''}><span>Let readers comment and suggest edits</span></label>
    ${share.allowComments ? `
      <label class="switch"><input type="checkbox" data-flag="moderateComments"
        ${share.moderateComments ? 'checked' : ''}><span>Read them before they appear</span></label>
      <p class="meta saetning">Readers have no account, so comments wait in your queue by default.
      Anything with a link waits either way.</p>
      ${share.pendingComments
    ? `<p class="udgiv-venter"><button class="linkbtn" id="udgivTilKoe">${share.pendingComments}
        ${share.pendingComments === 1 ? 'comment is' : 'comments are'} waiting to be read</button></p>`
    : '<p class="meta saetning">Nothing is waiting right now.</p>'}` : ''}

    <h3 class="udgiv-hoved">Address</h3>
    <div class="udgiv-adresse">
      <span class="adressepraefiks">${esc(offentligBase())}/w/</span>
      <input class="input" id="udgivSlug2" value="${esc(share.slug || '')}"
        placeholder="unguessable address in use" autocomplete="off" spellcheck="false">
      <button class="btn" id="udgivGemSlug">Save</button>
    </div>
    <p class="meta saetning">Changing this breaks links your colleagues already have.
    Turning the password on or off does not.</p>

    <h3 class="udgiv-hoved">Password</h3>
    ${share.hasPassword
    ? `<div class="btnrow">
         <input class="input" type="password" id="udgivKodeNy" placeholder="New password" autocomplete="new-password">
         <button class="btn" id="udgivKodeTil">Change</button>
         <button class="btn ghost" id="udgivKodeFra">Remove password</button>
       </div>
       <p class="meta saetning">Changing it signs out everyone who typed the old one.</p>`
    : `<div class="btnrow">
         <input class="input" type="password" id="udgivKodeNy" placeholder="At least 6 characters" autocomplete="new-password">
         <button class="btn" id="udgivKodeTil">Add a password</button>
       </div>
       <p class="meta saetning">The link stays exactly the same — bookmarks keep working.</p>`}

    <h3 class="udgiv-hoved">Expiry</h3>
    <div class="btnrow">
      <input class="input" type="date" id="udgivUdloeb" value="${esc(dato)}"
        aria-label="Stops working after" style="max-width:200px">
      ${dato ? '<button class="btn ghost" id="udgivIntetUdloeb">Never expire</button>' : ''}
    </div>
    <p class="meta saetning">${dato
    ? 'It stops working on that day. »Never expire« removes the date again.'
    : 'No expiry — it keeps working until you withdraw it.'}</p>

    ${o.forgaeves && o.forgaeves.length ? `<h3 class="udgiv-hoved">Looked for, not found</h3>
      <ul class="meta saetning" style="margin:0;padding-left:18px">
        ${o.forgaeves.slice(0, 8).map((m) => `<li>“${esc(m.term)}”${m.n > 1 ? ` — ${m.n} times` : ''}</li>`).join('')}
      </ul>
      <p class="meta saetning">What readers searched for here and got nothing. It is the
      shortest list of pages your wiki is missing.</p>` : ''}

    ${share.topPages && share.topPages.length ? `<h3 class="udgiv-hoved">Most read</h3>
      <ul class="meta saetning" style="margin:0;padding-left:18px">
        ${share.topPages.map((s) => `<li>${esc(s.title || 'Untitled')} — ${s.views}</li>`).join('')}
      </ul>
      <p class="meta saetning">Counts only. Sagu does not record who read what.</p>` : ''}

    <p class="wfejl" id="udgivFejl" hidden></p>
    <div class="btnrow" style="margin-top:18px">
      <button class="btn ghost danger" id="udgivStop">Withdraw this link</button>
    </div>`;
}

/* ------------------------------------------------- listen i Settings ----- */

async function udgivelsesListeHtml() {
  let shares = [];
  try { shares = (await api('GET', '/api/v1/shares')).shares; } catch { /* vist som tom */ }
  if (!shares.length) {
    return `<p class="meta saetning">Nothing is published yet. Open a note and use the
      globe in its toolbar — the page and everything under it becomes a wiki
      your colleagues can read without an account.</p>`;
  }
  return `<div class="tablewrap"><table class="data">
    <thead><tr><th>Page</th><th>Address</th><th>Access</th><th class="num">Reads</th><th></th></tr></thead>
    <tbody>${shares.map((s) => `<tr>
      <td><button class="linkknap" data-udgivnote="${esc(s.noteId)}">${esc(s.noteTitle || 'Untitled')}</button>
        ${s.mode === 'single' ? '<span class="meta"> · single page</span>' : ''}</td>
      <td><a href="${esc(s.path)}/" target="_blank" rel="noopener">${esc(s.path)}</a></td>
      <td>${s.hasPassword ? 'Password' : 'Open'}${s.expiresAt
    ? ` · until ${esc(new Date(s.expiresAt * 1000).toISOString().slice(0, 10))}` : ''}</td>
      <td class="num">${s.views}</td>
      <td style="text-align:right"><button class="btn ghost danger"
        data-udgivstop="${esc(s.id)}">Withdraw</button></td>
    </tr>`).join('')}</tbody></table></div>`;
}

function bindUdgivelsesListe() {
  document.querySelectorAll('[data-udgivnote]').forEach((el) => {
    el.addEventListener('click', () => aabnNote(el.dataset.udgivnote));
  });
  document.querySelectorAll('[data-udgivstop]').forEach((el) => {
    el.addEventListener('click', async () => {
      if (!confirm('Withdraw this link? Anyone who has it will get "Not found" on their next click.')) return;
      try {
        await api('DELETE', `/api/v1/shares/${el.dataset.udgivstop}`);
        toast('Withdrawn.');
        const host = document.getElementById('udgivListe');
        if (host) { host.innerHTML = await udgivelsesListeHtml(); bindUdgivelsesListe(); }
      } catch (ex) { toast(ex.message); }
    });
  });
}

/* ---- p8_kommentar.js ---- */
/*
 * F7 - kommentarer i appen.
 *
 * To flader, og de svarer paa hver sit spoergsmaal:
 *
 *  - **Under noten:** samtalen om DENNE side. Traade i ét niveau, som i
 *    Notion.
 *  - **Skaermen »Comments«:** alt, der venter paa mig, paa tvaers af noter.
 *    Det er F7's »notifikation« - et tal i navigationen og en liste, man kan
 *    gaa til. En funktion, man ikke kan SE, findes ikke for brugeren
 *    (RUNE-ERFARINGER, tovo v8), og en moderationskoe, man skal lede efter,
 *    er en koe, der aldrig bliver tømt.
 *
 * Kommentarteksten renderes med den SAMME markdown-renderer som noterne, men
 * med krogene slaaet fra: en kommentar maa ikke kunne pege paa en
 * vedhaeftning eller en anden note med en `sagu:`-adresse. Og `noFoelg`
 * saetter `nofollow ugc` paa links - en kommentar er fremmed indhold, ogsaa
 * naar den staar i ens egen app.
 */

const kom = {
  noteId: null,
  liste: [],
  svarPaa: null,
  redigerer: null,
  henter: false,
};

/** Hentes kun, naar en note er aaben. Kommentarer er ikke en del af noten. */
async function hentKommentarer(noteId) {
  kom.henter = true;
  try {
    const r = await api('GET', `/api/v1/notes/${noteId}/comments`);
    kom.noteId = noteId;
    kom.liste = r.comments || [];
  } catch (ex) {
    kom.liste = [];
    throw ex;
  } finally {
    kom.henter = false;
  }
}

function kommentarTekst(raa) {
  return saguMarkdown.render(String(raa || ''), {
    billedUrl: () => null,
    linkUrl: () => null,
    noFoelg: true,
  }).html;
}

function komDato(sek) {
  const d = new Date(sek * 1000);
  const i_dag = new Date();
  const samme = d.toDateString() === i_dag.toDateString();
  return samme
    ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : d.toISOString().slice(0, 10);
}

function komStatusMaerke(c) {
  if (c.status === 'pending') return '<span class="kom-maerke venter">waiting</span>';
  if (c.status === 'rejected') return '<span class="kom-maerke afvist">rejected</span>';
  return '';
}

/**
 * »fra tovo« - hvor kommentaren kom ind ad.
 *
 * Uden det staar der bare "Andreas" paa baade det, Andreas selv skrev i
 * Sagu, og det en anden app skrev gennem hans noegle: samme navn, to helt
 * forskellige situationer. Navnet er noeglens eget, saa Sagu behoever ikke
 * at kende de apps, der taler med den.
 *
 * Ét sted, fordi to visninger tegner en kommentar (traaden og
 * moderationskoeen) - og to kopier ville drive fra hinanden.
 */
function komKilde(c) {
  return c.via ? `<span class="kom-maerke kilde">from ${esc(c.via)}</span>` : '';
}

function komHtml(c, svarene) {
  const svar = (svarene || []).filter((x) => x.parentId === c.id);
  const egen = !c.guest && state.user && c.author === state.user.username;
  const redigerer = kom.redigerer === c.id;
  return `<li class="kom${c.status === 'published' ? '' : ' daempet'}" data-kom="${esc(c.id)}">
    <div class="kom-top">
      <span class="kom-navn">${esc(pentBruger(c.author))}</span>
      ${c.guest ? '<span class="kom-maerke gaest">guest</span>' : ''}
      ${komKilde(c)}
      ${c.kind === 'suggestion' ? '<span class="kom-maerke forslag">suggested edit</span>' : ''}
      ${komStatusMaerke(c)}
      <time>${esc(komDato(c.createdAt))}</time>
      ${c.edited ? '<span class="meta">· edited</span>' : ''}
    </div>
    ${redigerer
    ? `<div class="kom-ret">
         <textarea class="kom-felt" data-ret="${esc(c.id)}" rows="3">${esc(c.body)}</textarea>
         <div class="kom-knapper">
           <button class="btn primary" data-gemret="${esc(c.id)}">Save</button>
           <button class="btn" data-afbrydret="1">Cancel</button>
         </div>
       </div>`
    : `<div class="note-body kom-krop">${kommentarTekst(c.body)}</div>`}
    <div class="kom-handlinger">
      ${c.parentId ? '' : `<button class="linkbtn" data-svar="${esc(c.id)}">Reply</button>`}
      ${egen && !redigerer ? `<button class="linkbtn" data-ret="${esc(c.id)}">Edit</button>` : ''}
      ${c.status === 'pending' ? `<button class="linkbtn" data-godkend="${esc(c.id)}">Approve</button>
        <button class="linkbtn" data-afvis="${esc(c.id)}">Reject</button>` : ''}
      ${c.status === 'rejected' ? `<button class="linkbtn" data-godkend="${esc(c.id)}">Publish anyway</button>` : ''}
      <button class="linkbtn fare" data-slet="${esc(c.id)}">Delete</button>
    </div>
    ${kom.svarPaa === c.id ? komSkrivHtml(c.id) : ''}
    ${svar.length ? `<ul class="kom-svar">${svar.map((x) => komHtml(x, [])).join('')}</ul>` : ''}
  </li>`;
}

function komSkrivHtml(svarPaa) {
  return `<div class="kom-skriv">
    <textarea class="kom-felt" id="komFelt" rows="${svarPaa ? 2 : 3}"
      placeholder="${svarPaa ? 'Your reply…' : 'Add a comment. Markdown works here.'}"></textarea>
    <div class="kom-knapper">
      <button class="btn primary" id="komSend">${svarPaa ? 'Reply' : 'Comment'}</button>
      ${svarPaa ? '<button class="btn" data-afbrydsvar="1">Cancel</button>' : ''}
      <span class="meta saetning">⌘↵ sends</span>
    </div>
  </div>`;
}

/** Afsnittet under noten. */
function kommentarerHtml() {
  const top = kom.liste.filter((c) => !c.parentId);
  const venter = kom.liste.filter((c) => c.status === 'pending').length;
  /*
   * »N waiting« staar paa SELVE knappen, ikke inde i det foldede.
   *
   * En kommentar, der venter paa moderering, er det eneste her, man skal
   * REAGERE paa. Laa maerket bag foldningen, ville et foldet afsnit skjule
   * netop den oplysning, foldningen ellers er harmloes for.
   */
  return `<section class="kommentarer" id="kommentarer">
    <details class="bilagfold"${bilagAabent(BILAG_KOM) ? ' open' : ''}>
      <summary><span class="bilag-navn">Comments</span>
        ${kom.liste.length ? `<span class="group-count">${kom.liste.length}</span>` : ''}
        ${venter ? `<span class="kom-maerke venter">${venter} waiting</span>` : ''}</summary>
      ${top.length
    ? `<ul class="kom-liste">${top.map((c) => komHtml(c, kom.liste)).join('')}</ul>`
    : '<p class="meta saetning">No comments yet.</p>'}
      ${kom.svarPaa ? '' : komSkrivHtml(null)}
    </details>
  </section>`;
}

/**
 * Tegner KUN kommentarafsnittet om.
 *
 * En fuld optegning af noten ville lukke en aaben blok i editoren og flytte
 * rullepositionen - altsaa straffe brugeren for at have skrevet en kommentar
 * (samme regel som afkrydsningsfelterne i F3).
 */
function tegnKommentarer() {
  const host = document.getElementById('kommentarer');
  if (!host) return;
  host.outerHTML = kommentarerHtml();
  bindKommentarer();
}

async function sendKommentar(tekst, svarPaa) {
  const body = String(tekst || '').trim();
  if (!body) return;
  const r = await api('POST', `/api/v1/notes/${kom.noteId}/comments`,
    { body, parentId: svarPaa || undefined });
  kom.liste = r.comments || [];
  kom.svarPaa = null;
  tegnKommentarer();
  genindlaesTaellere();
}

function bindKommentarer() {
  const host = document.getElementById('kommentarer');
  if (!host) return;
  bindBilagsfold(host, BILAG_KOM);

  const felt = host.querySelector('#komFelt');
  const send = host.querySelector('#komSend');
  if (send && felt) {
    send.addEventListener('click', () => sendKommentar(felt.value, kom.svarPaa).catch(visFejl));
    // ⌘↵ paa FELTET selv, ikke paa "den primaere knap i det aabne vindue":
    // en genvej, der leder efter den vigtigste knap, kan ikke se forskel paa
    // at gemme og at svare (RUNE-ERFARINGER, doda v31).
    felt.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        sendKommentar(felt.value, kom.svarPaa).catch(visFejl);
      }
      // Uden den her boblede hvert tastetryk op til notens egne genveje.
      e.stopPropagation();
    });
  }

  host.querySelectorAll('[data-svar]').forEach((el) => el.addEventListener('click', () => {
    kom.svarPaa = el.dataset.svar;
    kom.redigerer = null;
    tegnKommentarer();
    const f = document.getElementById('komFelt');
    if (f) f.focus();
  }));
  host.querySelectorAll('[data-afbrydsvar]').forEach((el) => el.addEventListener('click', () => {
    kom.svarPaa = null;
    tegnKommentarer();
  }));
  host.querySelectorAll('[data-ret]').forEach((el) => {
    if (el.tagName === 'TEXTAREA') return;
    el.addEventListener('click', () => { kom.redigerer = el.dataset.ret; kom.svarPaa = null; tegnKommentarer(); });
  });
  host.querySelectorAll('[data-afbrydret]').forEach((el) => el.addEventListener('click', () => {
    kom.redigerer = null;
    tegnKommentarer();
  }));
  host.querySelectorAll('[data-gemret]').forEach((el) => el.addEventListener('click', async () => {
    const id = el.dataset.gemret;
    const f = host.querySelector(`textarea[data-ret="${id}"]`);
    try {
      const r = await api('PATCH', `/api/v1/comments/${id}`, { body: f.value });
      kom.liste = r.comments || [];
      kom.redigerer = null;
      tegnKommentarer();
    } catch (ex) { visFejl(ex); }
  }));
  host.querySelectorAll('[data-godkend]').forEach((el) => el.addEventListener('click',
    () => saetKomStatus(el.dataset.godkend, 'published')));
  host.querySelectorAll('[data-afvis]').forEach((el) => el.addEventListener('click',
    () => saetKomStatus(el.dataset.afvis, 'rejected')));
  host.querySelectorAll('[data-slet]').forEach((el) => el.addEventListener('click', async () => {
    // En sletning tager svarene med - sig det, foer den sker.
    const c = kom.liste.find((x) => x.id === el.dataset.slet);
    const svar = kom.liste.filter((x) => x.parentId === el.dataset.slet).length;
    if (!window.confirm(svar
      ? `Delete this comment and its ${svar} ${svar === 1 ? 'reply' : 'replies'}?`
      : `Delete ${c && c.guest ? `the comment from ${c.author}` : 'your comment'}?`)) return;
    try {
      const r = await api('DELETE', `/api/v1/comments/${el.dataset.slet}`);
      kom.liste = r.comments || [];
      tegnKommentarer();
      genindlaesTaellere();
    } catch (ex) { visFejl(ex); }
  }));
}

async function saetKomStatus(id, status) {
  try {
    const r = await api('PATCH', `/api/v1/comments/${id}`, { status });
    kom.liste = r.comments || [];
    tegnKommentarer();
    genindlaesTaellere();
  } catch (ex) { visFejl(ex); }
}

function visFejl(ex) {
  toast(ex && ex.message ? ex.message : 'Something went wrong.');
}

/* ------------------------------------------------ skaermen »Comments« */

const komKoe = { status: 'pending', liste: [] };

async function sideKommentarer() {
  const r = await api('GET', `/api/v1/comments?status=${komKoe.status}`);
  komKoe.liste = r.comments || [];
  const FANER = [
    ['pending', 'Waiting'],
    ['published', 'Published'],
    ['rejected', 'Rejected'],
  ];
  return `<div class="card">
    <div class="fanerakke">${FANER.map(([id, navn]) => `
      <button class="btn${komKoe.status === id ? ' primary' : ''}" data-fane="${id}">${navn}${
  id === 'pending' && r.pending ? ` (${r.pending})` : ''}</button>`).join('')}</div>
    ${komKoe.liste.length ? `<ul class="kom-liste koe">${komKoe.liste.map((c) => `
      <li class="kom" data-kom="${esc(c.id)}">
        <div class="kom-top">
          <span class="kom-navn">${esc(pentBruger(c.author))}</span>
          ${c.guest ? '<span class="kom-maerke gaest">guest</span>' : ''}
      ${komKilde(c)}
          ${c.kind === 'suggestion' ? '<span class="kom-maerke forslag">suggested edit</span>' : ''}
          <time>${esc(komDato(c.createdAt))}</time>
          <button class="linkbtn" data-aabn="${esc(c.noteId)}">on “${esc(c.noteTitle)}”</button>
        </div>
        <div class="note-body kom-krop">${kommentarTekst(c.body)}</div>
        <div class="kom-handlinger">
          ${c.status !== 'published' ? `<button class="linkbtn" data-godkendkoe="${esc(c.id)}">Approve</button>` : ''}
          ${c.status !== 'rejected' ? `<button class="linkbtn" data-afviskoe="${esc(c.id)}">Reject</button>` : ''}
          <button class="linkbtn fare" data-sletkoe="${esc(c.id)}">Delete</button>
        </div>
      </li>`).join('')}</ul>`
    : `<p class="meta saetning">${komKoe.status === 'pending'
      ? 'Nothing is waiting. Comments from your published pages land here first.'
      : 'Nothing here.'}</p>`}
  </div>`;
}

function bindKommentarSide() {
  document.querySelectorAll('[data-fane]').forEach((el) => el.addEventListener('click', async () => {
    komKoe.status = el.dataset.fane;
    await tegnSide();
  }));
  // At gaa til noten er hele pointen med koeen: man skal kunne se, hvad
  // kommentaren staar TIL, foer man godkender den.
  document.querySelectorAll('[data-aabn]').forEach((el) => el.addEventListener('click',
    () => aabnNote(el.dataset.aabn)));
  const opdater = async (id, felter) => {
    try {
      await api('PATCH', `/api/v1/comments/${id}`, felter);
      await tegnSide();
      genindlaesTaellere();
    } catch (ex) { visFejl(ex); }
  };
  document.querySelectorAll('[data-godkendkoe]').forEach((el) => el.addEventListener('click',
    () => opdater(el.dataset.godkendkoe, { status: 'published' })));
  document.querySelectorAll('[data-afviskoe]').forEach((el) => el.addEventListener('click',
    () => opdater(el.dataset.afviskoe, { status: 'rejected' })));
  document.querySelectorAll('[data-sletkoe]').forEach((el) => el.addEventListener('click', async () => {
    if (!window.confirm('Delete this comment for good?')) return;
    try {
      await api('DELETE', `/api/v1/comments/${el.dataset.sletkoe}`);
      await tegnSide();
      genindlaesTaellere();
    } catch (ex) { visFejl(ex); }
  }));
}

/**
 * Opdaterer tallet i navigationen uden at tegne hele siden om.
 *
 * Uden det staar »3 waiting« i sidebaren, efter man har godkendt dem alle -
 * og et tal, der lyver, er vaerre end intet tal (RUNE-ERFARINGER, Sagu).
 */
async function genindlaesTaellere() {
  try {
    const st = await api('GET', '/api/v1/state');
    state.counts = st.counts || state.counts;
    const nav = document.querySelector('.nav-item[data-view="comments"]');
    if (!nav) return;
    const antal = state.counts.pendingComments || 0;
    const gammel = nav.querySelector('.nav-count');
    if (gammel) gammel.remove();
    if (antal) nav.insertAdjacentHTML('beforeend', `<span class="nav-count">${antal}</span>`);
  } catch { /* et tal, der ikke kunne opdateres, er ikke vaerd at raabe op om */ }
}

/* ==================================================== doda (F8) ========= */

/*
 * Opgaverne, en note har sendt til doda.
 *
 * Ruden bor sammen med kommentarerne, fordi de to svarer paa det samme
 * spoergsmaal: hvad er der SKET omkring den her side. Og ligesom dem hentes
 * de, naar noten aabnes - aldrig pr. optegning. Rundturen gennem tunnelen er
 * ~150 ms, og en note med fem opgaver ville vaere naesten et sekund, hvor der
 * ikke sker noget (RUNE-ERFARINGER, doda v27).
 */

const dodaState = { noteId: null, opgaver: [], connected: false, gammel: null };

async function hentDodaOpgaver(noteId, tving) {
  const r = await api('GET', `/api/v1/notes/${noteId}/tasks${tving ? '?refresh=1' : ''}`);
  dodaState.noteId = noteId;
  dodaState.opgaver = r.tasks || [];
  dodaState.connected = !!r.connected;
  dodaState.gammel = r.staleReason || null;
}

/** dodas statusord, som de skal LAESES. */
function dodaStatusTekst(s) {
  return {
    inbox: 'in the inbox', next: 'next action', waiting: 'waiting for', someday: 'someday',
    done: 'done', dropped: 'dropped', deleted: 'deleted in doda',
  }[s] || s;
}

function dodaOpgaverHtml() {
  if (!dodaState.connected && !dodaState.opgaver.length) return '';
  const aabne = dodaState.opgaver.filter((t) => t.status !== 'done' && t.status !== 'dropped'
    && t.status !== 'deleted');
  /*
   * Tallet paa knappen kan vaere GAMMELT, og saa skal knappen sige det.
   *
   * Er broen nede, staar listen stille - det er med vilje (en bro, der bliver
   * tom, naar den anden ende er nede, ligner en bro, der har mistet noget).
   * Men foldes afsnittet sammen, er tallet det eneste, man ser, og et tal
   * uden forbehold er et tal, man tror paa. Maerket foelger derfor MED op paa
   * `summary`, praecis som »N waiting« goer ved kommentarerne.
   */
  return `<section class="dodaopgaver" id="dodaOpgaver">
    <details class="bilagfold"${bilagAabent(BILAG_DODA) ? ' open' : ''}>
      <summary><span class="bilag-navn">Tasks in doda</span>
        ${dodaState.opgaver.length
    ? `<span class="group-count">${aabne.length}/${dodaState.opgaver.length}</span>` : ''}
        ${dodaState.gammel ? '<span class="kom-maerke venter">not fresh</span>' : ''}</summary>
    ${dodaState.gammel
    ? `<p class="meta saetning">Showing what doda last said — ${esc(dodaState.gammel)}</p>` : ''}
    ${dodaState.opgaver.length
    ? `<ul class="doda-liste">${dodaState.opgaver.map((t) => `
      <li class="doda-opgave${t.status === 'done' || t.status === 'dropped' ? ' udfoert' : ''}">
        ${t.status === 'deleted' || t.status === 'dropped'
    /*
     * Slettet eller droppet i doda: intet flueben.
     *
     * En afkrydsning ville love, at man kan hente den tilbage herfra, og det
     * kan man ikke - `uncomplete` giver en slettet opgave tilbage til doda,
     * ikke til papirkurven. En knap, der ikke kan holde sit loefte, er vaerre
     * end ingen knap.
     */
    ? '<span class="doda-tjek tom"></span>'
    : `<button class="doda-tjek" data-doda="${esc(t.dodaId)}"
        aria-pressed="${t.status === 'done' ? 'true' : 'false'}"
        title="${t.status === 'done' ? 'Put it back in doda' : 'Mark it done in doda'}"
        aria-label="${t.status === 'done' ? 'Put it back in doda' : 'Mark it done in doda'}"
        >${t.status === 'done' ? icon('tjek', 14) : ''}</button>`}
        ${t.url
    /*
     * Titlen er et LINK til opgaven i doda - i en ny fane.
     *
     * Uden `_blank` ville man forlade noten for at kigge paa opgaven, og saa
     * skulle man finde tilbage. De to apps er to steder, man arbejder
     * samtidig; det ene maa ikke koste det andet.
     *
     * Er der ingen forbindelse, er der ingen adresse - og saa staar titlen
     * som ren tekst i stedet for som et link, der ikke fører nogen steder hen.
     */
    /*
     * `sikkerUrl` OGSAA her, selv om serveren allerede har renset.
     *
     * `doda_url` kan kun saettes til en http(s)-oprindelse (`rensOffentligUrl`),
     * saa adressen ER sikker naar den kommer. Men en href, der skrives ud af
     * data, skal gaa gennem husets hvidliste dér, hvor den skrives - ellers
     * afhaenger sikkerheden af, at man husker den anden ende. Reglen skal
     * kunne SES paa stedet.
     */
    ? `<a class="doda-titel doda-link" href="${esc(saguMarkdown.sikkerUrl(t.url) || '')}"
        target="_blank" rel="noopener" title="Open in doda">${esc(t.title)}</a>`
    : `<span class="doda-titel">${esc(t.title)}</span>`}
        <span class="kom-maerke doda-status ${esc(t.status)}">${esc(dodaStatusTekst(t.status))}</span>
      </li>`).join('')}</ul>`
    : '<p class="meta saetning">Nothing sent yet.</p>'}
    <div class="kom-skriv">
      <input class="input" id="dodaFelt" placeholder="Send a task to doda — #context @project !tomorrow"
        autocomplete="off">
      <div class="kom-knapper">
        <button class="btn" id="dodaSend">Send to doda</button>
        ${dodaState.opgaver.length
    ? '<button class="linkbtn" id="dodaOpfrisk">Check doda now</button>' : ''}
      </div>
    </div>
    </details>
  </section>`;
}

function tegnDodaOpgaver() {
  const host = document.getElementById('dodaOpgaver');
  if (!host) return;
  host.outerHTML = dodaOpgaverHtml();
  bindDodaOpgaver();
}

function bindDodaOpgaver() {
  const host = document.getElementById('dodaOpgaver');
  if (!host) return;
  bindBilagsfold(host, BILAG_DODA);
  const felt = host.querySelector('#dodaFelt');
  const send = host.querySelector('#dodaSend');
  if (send && felt) {
    const gaa = async () => {
      const t = felt.value.trim();
      if (!t) { toast('Write what the task should say.'); return; }
      felt.value = '';
      await sendOpgaveTilDoda(t);
    };
    send.addEventListener('click', gaa);
    felt.addEventListener('keydown', (e) => {
      // Enter sender. Feltet er ét felt med ét formaal - og tastetrykket maa
      // ikke boble op til notens egne genveje.
      if (e.key === 'Enter') { e.preventDefault(); gaa(); }
      e.stopPropagation();
    });
  }
  /*
   * Fluebenet skifter opgavens tilstand i DODA - ikke bare her.
   *
   * Knappen laases, mens kaldet er undervejs. Uden det kan man naa at trykke
   * to gange, og saa staar der »done« ét sted og »next« et andet, indtil
   * naeste opfriskning retter det - og imens tror man, at appen tog fejl.
   */
  host.querySelectorAll('[data-doda]').forEach((el) => {
    el.addEventListener('click', async () => {
      if (el.disabled) return;
      el.disabled = true;
      const faerdig = el.getAttribute('aria-pressed') === 'true';
      try {
        const r = await api('POST', `/api/v1/notes/${dodaState.noteId}/tasks/${el.dataset.doda}`,
          { done: !faerdig });
        dodaState.opgaver = r.tasks || dodaState.opgaver;
        tegnDodaOpgaver();
        toast(r.message || 'Done.');
      } catch (ex) {
        toast(ex.message);
        el.disabled = false;
      }
    });
  });

  const opfrisk = host.querySelector('#dodaOpfrisk');
  if (opfrisk) {
    opfrisk.addEventListener('click', async () => {
      opfrisk.textContent = 'Checking…';
      try {
        await hentDodaOpgaver(dodaState.noteId, true);
        tegnDodaOpgaver();
      } catch (ex) { toast(ex.message); }
    });
  }
}

/*
 * Kig efter, naar man KOMMER TILBAGE til Sagu.
 *
 * Den almindelige gang er: send en opgave, skift til doda, luk den, skift
 * tilbage. Uden det her skulle man vente paa det naeste opfrisknings-vindue
 * eller finde »Check doda now« - og indtil da staar opgaven som aaben, hvilket
 * ligner en bro, der ikke virker.
 *
 * Der er en bund paa 10 sekunder: springer man frem og tilbage mellem to
 * faner, skal det ikke blive til et kald hver gang.
 */
let sidsteDodaKig = 0;
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') return;
  if (!state.user || state.view !== 'note' || !editor.note) return;
  if (!dodaState.connected || dodaState.noteId !== editor.note.id) return;
  if (Date.now() - sidsteDodaKig < 10000) return;
  sidsteDodaKig = Date.now();
  try {
    await hentDodaOpgaver(editor.note.id, true);
    tegnDodaOpgaver();
  } catch { /* doda kan vaere nede - raekkerne staar der stadig */ }
});

/* ==================== markér en linje -> en opgave i doda (F16) ========= */

/*
 * Markeringen er allerede en beslutning.
 *
 * Man streger den linje under, der er noget, der skal GØRES — og så er
 * afstanden til en opgave ét tryk. Alternativet er at markere, kopiere, rulle
 * ned til feltet og sætte ind, og den vej tager man ikke, når man har travlt.
 *
 * ── Det, der gør det svært på en telefon ──────────────────────────────────
 *
 * iOS viser sin egen menu (Kopiér, Slå op…) oven på markeringen, og en tap et
 * hvilket som helst sted RYDDER markeringen. Derfor to ting:
 *
 *  - knappen lægger sig OVER markeringen, ikke under, hvor systemets egen
 *    menu står,
 *  - og den lytter på `mousedown`/`touchstart` med `preventDefault`, så
 *    markeringen stadig er der, når vi skal læse den. Bruger man `click`,
 *    er teksten væk, inden handleren kører.
 */

let dodaMarkKnap = null;

function skjulDodaMark() {
  if (dodaMarkKnap) { dodaMarkKnap.remove(); dodaMarkKnap = null; }
}

/** Markeringen som ÉN linje. En opgave er en linje, ikke et afsnit. */
function markeringSomOpgave() {
  /*
   * **Det åbne redigeringsfelt tæller MED.**
   *
   * Første udgave sprang over, når et afsnit stod som rå markdown, med
   * begrundelsen »dér markerer man for at rette«. Det var forkert: at klikke
   * ind i teksten og trække hen over en linje er den mest almindelige måde at
   * markere noget i en note — og så var knappen umulig at få frem i praksis
   * (Andreas, 2026-08-21, anden gang på samme funktion).
   *
   * Og `window.getSelection()` kan ikke se en markering inde i et
   * `<textarea>`: den har sin egen `selectionStart`/`selectionEnd`. Uden det
   * her ville teksten være tom, selv om man kunne se den markeret.
   */
  const felt = document.getElementById('blokFelt');
  if (felt && felt.selectionStart !== felt.selectionEnd) {
    const raa = felt.value.slice(felt.selectionStart, felt.selectionEnd);
    const tekst = raa.replace(/\s+/g, ' ').trim();
    if (tekst.length < 2) return null;
    const r = felt.getBoundingClientRect();
    /*
     * Placeringen er et SKØN, ikke en måling: linjenummeret gange
     * linjehøjden. Et ombrudt afsnit rykker den lidt, men knappen skal bare
     * være i nærheden af det, man markerede - og alternativet (rigtige
     * markørkoordinater i et textarea) kræver en skyggekopi af hele feltet.
     */
    const linje = felt.value.slice(0, felt.selectionStart).split('\n').length - 1;
    const lh = parseFloat(getComputedStyle(felt).lineHeight) || 22;
    return {
      tekst: tekst.slice(0, 500),
      afkortet: tekst.length > 500,
      iFelt: true,
      rect: { left: r.left, width: r.width, top: r.top + (linje * lh) - felt.scrollTop },
    };
  }

  const s = window.getSelection();
  if (!s || s.isCollapsed || !s.rangeCount) return null;
  const tekst = String(s.toString() || '').replace(/\s+/g, ' ').trim();
  if (tekst.length < 2) return null;

  // Markeringen skal ligge inde i NOTEN. En markering i en kommentar eller i
  // sidebaren er ikke det, knappen handler om.
  const krop = document.getElementById('noteBody');
  if (!krop) return null;
  const r = s.getRangeAt(0);
  if (!krop.contains(r.commonAncestorContainer)) return null;

  return { tekst: tekst.slice(0, 500), afkortet: tekst.length > 500, rect: r.getBoundingClientRect() };
}

function visDodaMark() {
  // Der stod en vagt her mod det åbne redigeringsfelt. Den er væk med vilje -
  // se markeringSomOpgave(): det er netop dér, man markerer.
  if (!dodaState.connected) { skjulDodaMark(); return; }

  const m = markeringSomOpgave();
  if (!m) { skjulDodaMark(); return; }

  if (!dodaMarkKnap) {
    dodaMarkKnap = document.createElement('button');
    dodaMarkKnap.className = 'mark-knap';
    dodaMarkKnap.type = 'button';
    dodaMarkKnap.innerHTML = `${icon('tjek', 15)}<span>Send to doda</span>`;
    // `mousedown`/`touchstart` og ikke `click`: et klik ville rydde
    // markeringen, FØR vi når at læse den.
    const gaa = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const nu = markeringSomOpgave();
      skjulDodaMark();
      if (!nu) return;
      if (nu.afkortet) toast('That was long — the first 500 characters became the task.');
      await sendOpgaveTilDoda(nu.tekst);
      // Ryd markeringen, saa knappen ikke straks melder sig igen. I et
      // tekstfelt betyder det at laegge markoeren ved markeringens slutning -
      // `removeAllRanges` roerer ikke et textarea.
      const felt2 = document.getElementById('blokFelt');
      if (nu.iFelt && felt2) {
        felt2.setSelectionRange(felt2.selectionEnd, felt2.selectionEnd);
      } else {
        const s = window.getSelection();
        if (s) s.removeAllRanges();
      }
    };
    dodaMarkKnap.addEventListener('mousedown', gaa);
    dodaMarkKnap.addEventListener('touchstart', gaa, { passive: false });
    document.body.appendChild(dodaMarkKnap);
  }

  // Over markeringen, og aldrig ud over kanten.
  const b = dodaMarkKnap.getBoundingClientRect();
  const bredde = b.width || 150;
  const x = Math.min(Math.max(8, m.rect.left + (m.rect.width - bredde) / 2), window.innerWidth - bredde - 8);
  const y = Math.max(8, m.rect.top - 44);
  dodaMarkKnap.style.left = `${Math.round(x)}px`;
  dodaMarkKnap.style.top = `${Math.round(y)}px`;
}

/*
 * `selectionchange` er den ENESTE hændelse, der fyrer for alle måderne at
 * markere på: mus, tastatur, langt tryk på en telefon og systemets egne
 * håndtag. `mouseup` alene ville virke på en computer og ingen andre steder.
 *
 * Den fyrer til gengæld under hele trækket, så den skal forsinkes — ellers
 * hopper knappen rundt, mens man stadig markerer.
 */
let dodaMarkTimer = null;
document.addEventListener('selectionchange', () => {
  clearTimeout(dodaMarkTimer);
  dodaMarkTimer = setTimeout(() => {
    if (state.view !== 'note') { skjulDodaMark(); return; }
    visDodaMark();
  }, 220);
});
// Ruller siden, står knappen det forkerte sted. Så er det bedre, den går væk.
window.addEventListener('scroll', skjulDodaMark, { passive: true });

/* ---- p9_guide.js ---- */
/*
 * F9 - siden om API'et og iPhone-genvejene.
 *
 * ── Hvorfor den findes ────────────────────────────────────────────────────
 *
 * En noegle er ubrugelig uden en opskrift. Man kan se, at der ER et API, men
 * ikke hvad man skriver i Shortcuts' »Get Contents of URL« - og saa bliver
 * funktionen meldt som manglende, selv om den virker (RUNE-ERFARINGER,
 * tovo v8: en funktion, man ikke kan SE, findes ikke for brugeren).
 *
 * ── Reglen, siden er skrevet efter ────────────────────────────────────────
 *
 * **En hjaelpetekst er en kravspecifikation** (doda v9/v35/v38). Hver eneste
 * linje herunder svarer til noget, der er DAEKKET AF EN TEST i
 * `tests/api.test.mjs` - de fire veje ind, `to=today`, `?date=`,
 * `notebook=<navn>`, `#maerke`, `?format=md`, `changes` med slettede id'er, og
 * hele scope-matricen. Bliver et endepunkt lavet om, skal linjen her med i
 * samme ombaering; ellers staar der en funktion, appen ikke har.
 *
 * Adressen skrives med `offentligBase()` - den samme, udgivelsesruden bruger.
 * Ellers ville en opskrift, man kopierer fra én adresse, pege et andet sted
 * hen end en, man kopierer fra en anden (DESIGN.md §15).
 */

/** Ét sted: adressen, opskrifterne skrives med. */
function apiBase() {
  return offentligBase();
}

/**
 * En opskrift.
 *
 * `felter` er præcis dét, der skal staa i Shortcuts' »Get Contents of URL« -
 * i den raekkefoelge, felterne staar dér. Alt andet er stoej for den, der
 * sidder med telefonen i haanden.
 */
function opskriftHtml(o) {
  return `<div class="opskrift">
    <h3>${esc(o.navn)}</h3>
    <p class="lead">${o.hvorfor}</p>
    <table class="data opskrift-felter"><tbody>
      ${o.felter.map(([navn, vaerdi]) => `<tr>
        <th>${esc(navn)}</th>
        <td><code>${esc(vaerdi)}</code></td></tr>`).join('')}
    </tbody></table>
    ${o.noter ? `<p class="meta saetning">${o.noter}</p>` : ''}
  </div>`;
}

function sideApi() {
  const b = apiBase();
  const OPSKRIFTER = [
    {
      navn: 'Send text to Sagu',
      hvorfor: 'One field and a button. The first line becomes the title, the rest becomes the note.',
      felter: [
        ['URL', `${b}/api/v1/capture`],
        ['Method', 'POST'],
        ['Headers', 'Authorization: Bearer sagu_…'],
        ['Request Body', 'JSON — one key, <code>text</code>, with the Shortcut Input as its value'],
      ],
      noter: 'A <strong>capture</strong> key is enough: it can put something new in and '
        + 'read nothing at all. Lose the phone, and it cannot be used to pull your archive. '
        + 'The answer carries a <code>message</code> field you can show as it is.',
    },
    {
      navn: 'Put it in today\'s note',
      hvorfor: 'Gathers the day\'s small things in one place, instead of a note per thought.',
      felter: [
        ['URL', `${b}/api/v1/capture?to=today`],
        ['Method', 'POST'],
        ['Headers', 'Authorization: Bearer sagu_…'],
        ['Request Body', 'JSON — one key, <code>text</code>, with the Shortcut Input as its value'],
      ],
      noter: 'The note is named after the date (<code>2026-08-21</code>) and is made the '
        + 'first time you send something. In a different time zone than the server? Send your '
        + 'own day: <code>?to=today&amp;date=</code> with the date from <em>Current Date</em>.',
    },
    {
      navn: 'Add to a note you already have',
      hvorfor: 'A running page — a project, a shopping list, a log — that you add to from '
        + 'your phone during the day.',
      felter: [
        ['URL', `${b}/api/v1/capture?to=NOTE_ID`],
        ['Method', 'POST'],
        ['Headers', 'Authorization: Bearer sagu_…'],
        ['Request Body', 'JSON — one key, <code>text</code>, with the Shortcut Input as its value'],
      ],
      noter: 'The text lands at the <em>bottom</em>; nothing already there is touched. A '
        + '<code>#tag</code> is <strong>added</strong> to the note\'s tags — it does not replace '
        + 'them. The id is the 32 characters at the end of the note\'s address in Sagu. '
        + 'You need a key that may write in that note; a note shared with you for reading '
        + 'answers 404, the same as one that does not exist.',
    },
    {
      navn: 'Add a photo to a note you already have',
      hvorfor: 'A picture of the cabinet straight into the page about the cabinet.',
      felter: [
        ['URL', `${b}/api/v1/capture?to=NOTE_ID&name=foto.jpg`],
        ['Method', 'POST'],
        ['Headers', 'Authorization: Bearer sagu_…'],
        ['Request Body', 'File (Danish: <em>Arkiv</em>) — the Shortcut Input'],
      ],
      noter: 'A picture is the one case where <em>Request Body</em> must be <strong>File</strong> (<em>Arkiv</em>) and not JSON. The image is '
        + 'written in at the bottom and attached to the note. Add <code>&amp;text=</code> if it '
        + 'needs a line above it; without one the picture stands on its own.',
    },
    {
      navn: 'Share an image from the share sheet',
      hvorfor: 'A photo of the cabinet, a whiteboard, a receipt — as a note with the image in it.',
      felter: [
        ['URL', `${b}/api/v1/capture?name=foto.jpg&text=Skabet%20i%20kaelderen`],
        ['Method', 'POST'],
        ['Headers', 'Authorization: Bearer sagu_…'],
        ['Request Body', 'File (Danish: <em>Arkiv</em>) — the Shortcut Input'],
      ],
      noter: 'Again <strong>File</strong> (<em>Arkiv</em>), not JSON. The image becomes '
        + 'an attachment and is written into the note. Add <code>&amp;to=today</code> to put it '
        + 'in today\'s note instead.',
    },
    {
      navn: 'Save a link from the share sheet',
      hvorfor: 'A page worth keeping — press Share, pick the shortcut, and it is a note. '
        + 'The title becomes the note\'s title, the address its first line.',
      felter: [
        ['URL', `${b}/api/v1/capture?notebook=Reading`],
        ['Method', 'POST'],
        ['Headers', 'Authorization: Bearer sagu_…'],
        ['Request Body', 'JSON — one key, <code>text</code>, with the Text action as its value'],
      ],
      noter: 'Two actions. First a <strong>Text</strong> action holding the page name on line one '
        + 'and the address on line two — from Safari, <em>Get Details of Safari Web Page</em> gives '
        + 'you the name; from anywhere else the Shortcut Input is the address, and that becomes the '
        + 'title. Then <em>Get Contents of URL</em> with the fields above. In the shortcut\'s '
        + 'settings, turn on <strong>Show in Share Sheet</strong> and let it accept '
        + '<em>URLs</em> and <em>Safari web pages</em>. '
        + 'Drop <code>?notebook=</code> to leave it outside a notebook, or add a '
        + '<code>#tag</code> to the end of the first line.',
    },
    {
      navn: 'Add a link to one running list',
      hvorfor: 'A reading list, a list of tickets — one note that grows, instead of a note per link.',
      felter: [
        ['URL', `${b}/api/v1/capture?to=NOTE_ID`],
        ['Method', 'POST'],
        ['Headers', 'Authorization: Bearer sagu_…'],
        ['Request Body', 'JSON — <code>text</code> = <code>- [name](address)</code>'],
      ],
      noter: 'Send it as a <strong>list item</strong> and Sagu continues the list instead of '
        + 'starting a new one, so the note stays one growing list however many you add. '
        + 'Anything that is not a list item is added as its own paragraph, as before. '
        + 'The id is under the note\'s <strong>…</strong> menu → <em>Copy the note ID</em>.',
    },
    {
      navn: 'Save the page itself, not just the link',
      hvorfor: 'The text as well, so it is still readable when the page is gone or behind a login.',
      felter: [
        ['URL', `${b}/api/v1/capture?notebook=Reading`],
        ['Method', 'POST'],
        ['Headers', 'Authorization: Bearer sagu_…'],
        ['Request Body', 'JSON — <code>text</code> = the article text'],
      ],
      noter: 'Put <em>Get Article from Web Page</em> before the call and feed its text into a '
        + '<strong>Text</strong> action: page name, then the address, then the article. '
        + 'It is plain text, not markdown — headings and lists do not survive the trip. '
        + 'For a proper conversion use <strong>Save to Sagu</strong> under Settings; that is the '
        + 'same job done in a browser, where the page structure is still there to read.',
    },
    {
      navn: 'Get a note as markdown',
      hvorfor: 'To paste into an email, a message, or another program.',
      felter: [
        ['URL', `${b}/api/v1/notes/NOTE_ID?format=md`],
        ['Method', 'GET'],
        ['Headers', 'Authorization: Bearer sagu_…'],
      ],
      noter: 'The answer is plain text — not JSON to dig through. Needs a '
        + '<strong>read</strong> key; a capture key gets a 403.',
    },
    {
      navn: 'Search your notes',
      hvorfor: 'The same search as in the app — filters and all.',
      felter: [
        ['URL', `${b}/api/v1/search?q=vpn+tag:drift`],
        ['Method', 'GET'],
        ['Headers', 'Authorization: Bearer sagu_…'],
      ],
      noter: 'The filters work as they do in the field: <code>tag:</code>, <code>in:</code>, '
        + '<code>updated:&lt;30d</code>, <code>has:code</code>, <code>"a phrase"</code> '
        + 'and <code>-without</code>.',
    },
    {
      navn: 'Keep a copy up to date',
      hvorfor: 'For a program mirroring the archive — it is told what was deleted, too.',
      felter: [
        ['URL', `${b}/api/v1/changes?since=0`],
        ['Method', 'GET'],
        ['Headers', 'Authorization: Bearer sagu_…'],
      ],
      noter: 'The answer has a <code>now</code> field. Keep it, and send it as <code>since</code> '
        + 'next time. <code>deleted</code> holds the ids of what is gone — without them a copy '
        + 'collects ghosts.',
    },
  ];

  return `
  <h2>What a key may do</h2>
  <div class="card">
    <div class="tablewrap"><table class="data">
      <thead><tr><th>Scope</th><th>Can</th><th>Cannot</th></tr></thead>
      <tbody>
        <tr><td><code>capture</code></td><td>Add new notes, images and <strong>comments</strong></td>
          <td><strong>Read nothing at all</strong></td></tr>
        <tr><td><code>read</code></td><td>Read and search</td><td>Write anything</td></tr>
        <tr><td><code>link</code></td><td>Read, search and add</td><td>Change or delete</td></tr>
        <tr><td><code>full</code></td><td>Everything above, and change and delete</td>
          <td>Make keys, change your password, or touch server settings</td></tr>
      </tbody>
    </table></div>
    <p class="meta saetning">A <strong>comment</strong> counts as capture, not as writing:
    it is something new beside the note, not a change to it — the same distinction the app
    itself makes, where a page shared with you for reading can still be commented on.
    Adding to the note's own text is different and needs a key that may write in it.
    A capture key gets no reply beyond »done«: a write-only door must not become a way to
    read.</p>
    <p class="meta saetning">No key can make another key or change your password — not even
    <code>full</code>. Otherwise one leaked key would be enough to give itself permanent
    access, or to lock you out of your own app. A key is revoked the moment you remove it
    in Settings; there is no cache to clear.</p>
  </div>

  <h2>The four ways to send text</h2>
  <div class="card">
    <p class="lead">A shortcut has one text field and no patience. <code>/api/v1/capture</code>
    therefore takes the text however it arrives:</p>
    <div class="tablewrap"><table class="data">
      <tbody>
        <tr><th>JSON</th><td><code>{"text": "Ny router i skabet"}</code></td></tr>
        <tr><th>Form</th><td><code>text=Ny+router+i+skabet</code></td></tr>
        <tr><th>Plain text</th><td>the body, with no Content-Type at all</td></tr>
        <tr><th>In the address</th><td><code>?text=Ny%20router</code></td></tr>
      </tbody>
    </table></div>
    <p class="meta saetning"><code>?to=</code> decides <em>where</em> it lands: nothing at all
    makes a new note, <code>today</code> uses today's note, and a <strong>note id</strong>
    adds to that page. The same three work for an image.</p>
    <div class="tablewrap"><table class="data">
      <tbody>
      </tbody>
    </table></div>
    <p class="meta saetning">A <code>#tag</code> in the first line becomes a real tag, exactly
    as it does in the title field — and a web address with a <code>#fragment</code> does not.
    Add <code>?notebook=Drift</code> to file it somewhere; the name works, so a shortcut does
    not have to look up an id.</p>
  </div>

  <h2>Recipes</h2>
  <div class="card">
    <p class="lead">In Shortcuts: <em>Get Contents of URL</em>. These are the fields, in the
    order they appear there.</p>
    <p class="meta saetning"><strong>Which »Request Body«?</strong> The menu offers exactly three:
    <code>JSON</code>, <code>Form</code> and <code>File</code> — on a Danish iPhone
    <code>JSON</code>, <code>Formular</code> and <code>Arkiv</code>. There is no »Text« entry,
    so pick <strong>JSON</strong> and give it one key called <code>text</code> with your
    Shortcut Input as the value. Do <strong>not</strong> set a Content-Type; Sagu takes the text
    as a JSON field, as form data, as a plain body or as <code>?text=</code> in the address —
    a shortcut with one field just has to work.</p>
    ${OPSKRIFTER.map(opskriftHtml).join('')}
  </div>

  <h2>Connect Claude</h2>
  <div class="card">
    <p class="lead">Sagu speaks <strong>MCP</strong>, so Claude can search your archive and
    write in it — without you pasting a key anywhere.</p>
    <div class="tablewrap"><table class="data">
      <tbody>
        <tr><th>Address</th><td><code>${b}/mcp</code></td></tr>
        <tr><th>In Claude</th><td>Settings → Connectors → Add custom connector</td></tr>
        <tr><th>In Claude Code</th><td><code>claude mcp add --transport http sagu ${b}/mcp</code></td></tr>
      </tbody>
    </table></div>
    <p class="meta saetning">The web client sends you through a consent page here and gets a
    key of its own; Claude Code and Desktop can also just carry a <strong>full</strong> key
    in an <code>Authorization</code> header. Either way the connection shows up under
    Settings → Connected apps, and revoking it cuts the app off at once.</p>
    <p class="meta saetning">Claude sees nine tools, and no more than the key allows: a
    <strong>read</strong> connection cannot even see the ones that write. Publishing a page
    is one of them — it puts the page on the <em>open web</em>, so Claude is told to ask
    first.</p>
  </div>

  <h2>When something goes wrong</h2>
  <div class="card">
    <div class="tablewrap"><table class="data">
      <tbody>
        <tr><th>401</th><td>The key is wrong or revoked. Nine times out of ten the
          <code>Authorization</code> value says only <code>Bearer</code> and the key itself
          never made it in — it has to read <code>Bearer sagu_…</code> in full. A key cannot
          be looked up again either: if the list only shows it shortened, make a new one.</td></tr>
        <tr><th>403</th><td>The key is <em>fine</em> — it is just too narrow.
          The message says which scope it has.</td></tr>
        <tr><th>404</th><td>No such note — or it is not yours. The two answer the same,
          so nobody can guess which ids exist.</td></tr>
        <tr><th>413</th><td>Too large, or your file storage is full. The message says which.</td></tr>
        <tr><th>429</th><td>Too many calls with that key. Wait a moment.</td></tr>
      </tbody>
    </table></div>
    <p class="meta saetning">Every error has a machine code and a sentence. A shortcut can show
    the sentence as it is; a program can branch on the code.</p>
  </div>`;
}
