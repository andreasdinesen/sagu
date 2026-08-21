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

  return { tolk, linjeAdresse, medRef, navn, cacheNoegle, sprogFor, ER_SHA };
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

  function pluk(raa) {
    const maerker = [];
    const tekst = String(raa || '')
      .replace(/(^|\s)#([\p{L}\p{N}][\p{L}\p{N}_-]{0,59})/gu, (helt, foer, navn) => {
        maerker.push(navn);
        return foer;
      })
      .replace(/\s+/g, ' ')
      .trim();
    return { tekst, maerker };
  }

  return { pluk };
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

  return { render, blokke, inline, tilTekst, foersteOverskrift, wikiLinks,
    slug, esc, attr, sikkerUrl, saetTjek, pentNavn };
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

/** Knappen i notens vaerktoejsraekke. Kun paa MINE noter - kun ejeren deler. */
function delKnapHtml(n) {
  if (!n || n.mine === false) return '';
  const paa = !!n.sharedWith;
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
      <strong>${esc(n.owner || 'Someone')} shared this page with you.</strong>
      <div class="meta saetning">${skriv
    ? 'You can edit it and add subpages. Deleting, publishing and sharing it on stay with '
      + `${esc(n.owner || 'the owner')}.`
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
          toast(`Shared with ${navn}.`);
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
          toast(`${d.newOwner.username} owns it now — ${d.antal} page${d.antal === 1 ? '' : 's'}.`);
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
        <td>${esc(p.username)}</td>
        <td>${p.level === 'write' ? 'Read and write' : 'Read'}${p.tree ? '' : ' — this page only'}</td>
        <td style="text-align:right"><button class="btn ghost danger"
          data-fjern="${esc(p.userId)}">Remove</button></td>
      </tr>`).join('')}</tbody></table></div>`
    : '<p class="meta saetning">Nobody else can see this page yet.</p>'}

    ${ledige.length ? `
      <div class="btnrow" style="margin-top:14px">
        <select class="input" id="delHvem" style="max-width:180px">
          ${ledige.map((p) => `<option value="${esc(p.username)}">${esc(p.username)}</option>`).join('')}
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
          ${folk.map((p) => `<option value="${esc(p.username)}">${esc(p.username)}</option>`).join('')}
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
        <td>${esc(n.owner || '')}</td>
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

/* ---- p1_core.js ---- */
'use strict';
/* Sagu - kerne: opstart, tema, login, app-skal.
   Denne fil samles til public/app.js af build_rune.py. Redigér aldrig app.js.

   NB: interfacet er ENGELSK - som doda, og ogsaa den ramme, kollegaerne ser
   i wikien. Koden, kommentarerne og dokumenterne er dansk. */

const APP_VERSION = 2;

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
    throw Object.assign(
      new Error('No connection — this needs the network. Try again when you are back.'),
      { offline: true });
  }
  let data = {};
  try { data = await res.json(); } catch { /* tomt svar er i orden */ }
  // API'et svarer {error: kode, message: laesbar tekst}. Mennesket skal se
  // beskeden; koden er til klienter.
  if (!res.ok) {
    throw Object.assign(new Error(data.message || data.error || `Error ${res.status}`),
      { status: res.status, code: data.error });
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
  pin: '<path d="M9 3.5h6l-1 5 3 3.5H7l3-3.5z"/><path d="M12 12v8.5"/>',
  out: '<path d="M14.5 4.5H18a1.5 1.5 0 011.5 1.5v12a1.5 1.5 0 01-1.5 1.5h-3.5"/><path d="M4.5 12h10M11 8.5l3.5 3.5-3.5 3.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M17.8 6.2l-1.4 1.4M7.6 16.4l-1.4 1.4M17.8 17.8l-1.4-1.4M7.6 7.6L6.2 6.2"/>',
  moon: '<path d="M20 14.6A8.6 8.6 0 019.4 4 8.6 8.6 0 1020 14.6z"/>',
  key: '<circle cx="8" cy="12" r="3.5"/><path d="M11.5 12H20M17 12v3M20 12v2.5"/>',
  caret: '<path d="M9 6l6 6-6 6"/>',
  width: '<path d="M3 12h18"/><path d="M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
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
  stjerneFuld: '<path fill="currentColor" d="M12 3.8l2.5 5.1 5.6.8-4 4 .9 5.6-5-2.6-5 2.6.9-5.6-4-4 5.6-.8z"/>',
  import: '<path d="M12 3.5v11M8.5 11L12 14.5 15.5 11"/><path d="M4.5 15.5v3a1.5 1.5 0 001.5 1.5h12a1.5 1.5 0 001.5-1.5v-3"/>',
  ind: '<path d="M4 6.5h16M9 12h11M9 17.5h11"/><path d="M4 10l2.5 2L4 14"/>',
  fold: '<path d="M8 9l4-4 4 4"/><path d="M8 15l4 4 4-4"/>',
  udfold: '<path d="M8 5l4 4 4-4"/><path d="M8 19l4-4 4 4"/>',
  globe: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16"/><path d="M12 4a12 12 0 010 16 12 12 0 010-16z"/>',
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
      const data = await api('POST', opretter ? '/api/register' : '/api/login', {
        username: document.getElementById('gateUser').value,
        password: document.getElementById('gatePass').value,
      });
      state.user = data.user;
      state.config.needsSetup = false;
      if (fortsaetTilConnector()) return;
      await hentState();
      render();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
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

function shellHtml() {
  return `
  <button class="btn navtoggle" id="navToggle" aria-label="Menu">${icon('menu')}</button>
  <div class="backdrop" id="backdrop"></div>
  <div class="app">
    <aside class="sidebar">
      <div class="brand">${icon('logo', 24)} <span style="flex:1;min-width:0">${esc(state.config.appName || 'Sagu')}</span>
        <button class="pinbtn" id="pinBtn" aria-label="Hide the menu"
          title="Hide the menu">${icon('pin', 16)}</button></div>
      <div id="navHost">${navHtml()}</div>
      <div id="navGenveje">${genvejeHtml()}</div>
      <div id="treeHost" class="treehost"></div>
      <div class="sidebar-foot">
        <button class="nav-item" id="userBtn"
          ${BAG_BRUGEREN.has(state.view) ? 'aria-current="page"' : ''}>${icon('settings')}<span>${esc(state.user.username)}</span></button>
        <div class="foot-row" id="footRow">${versionHtml()}</div>
      </div>
    </aside>
    <main class="main">
      <div class="topbar">
        <div class="toprow">
          <div class="stats meta" id="statsHost">${statsHtml()}</div>
          ${temaKnapHtml()}
        </div>
        ${omniHtml()}
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
  if (c.notes) dele.push(`${c.notes} notes`);
  if ((state.notebooks || []).length) dele.push(`${state.notebooks.length} notebooks`);
  if (c.archived) dele.push(`${c.archived} archived`);
  if (c.trash) dele.push(`${c.trash} in trash`);
  return dele.map((d) => `<span>${esc(d)}</span>`).join('');
}

function versionHtml() {
  const server = state.config.version;
  const gammel = server && server !== APP_VERSION;
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
  bindTemaKnap();
  bindOmni();
  tegnLegend();
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
  if (vBtn) {
    vBtn.addEventListener('click', async () => {
      try {
        if (window.caches) await Promise.all((await caches.keys()).map((n) => caches.delete(n)));
      } catch { /* uden cache-api er der ikke noget at rydde */ }
      location.reload();
    });
  }

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
function gaaTil(view, opt) {
  // En ventende gemning maa ikke gaa tabt, fordi man klikker i sidebaren.
  if (typeof gemNu === 'function') gemNu();
  const skifter = state.view !== view;
  const havdeFilter = !!(state.openNote || state.filterTag || state.openNotebook);
  state.view = view;
  state.openNote = null;
  state.filterTag = null;
  state.openNotebook = null;
  if (typeof editor === 'object') { editor.note = null; editor.aabenBlok = null; }
  document.body.classList.remove('fokus', 'bred-note');
  if (opt && opt.tag !== undefined) state.filterTag = opt.tag;
  if (opt && opt.notebook !== undefined) state.openNotebook = opt.notebook;
  document.body.classList.remove('navopen');
  opdaterNav();
  tegnSide();
  // Scroll kun til toppen ved reelt sideskift - ellers kastes brugeren op,
  // hver gang en inline-redigering gentegner (RUNE-ERFARINGER §4).
  if (skifter || havdeFilter) window.scrollTo(0, 0);
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
      <div class="usermenu-name">${esc(state.user.username)}</div>
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
  anvendTema(nuvaerendeTema());
  try {
    state.config = await api('GET', '/api/public-config');
    document.title = state.config.appName || 'Sagu';
    const me = await api('GET', '/api/me');
    state.user = me.user;
    // Var jeg allerede logget ind, da connectoren sendte mig herhen, skal jeg
    // slet ikke se appen - kun samtykkesiden.
    if (state.user && fortsaetTilConnector()) return;
    if (state.user) await hentState();
    // Favoritter og spor hentes ÉN gang her - ikke ved hver optegning.
    if (state.user) await hentGenveje();
  } catch (ex) {
    document.getElementById('root').innerHTML =
      `<div class="gate"><div class="card"><div class="brand">${icon('logo', 26)} Sagu</div>
       <p class="lead" style="text-align:center">Could not reach the server.<br>${esc(ex.message)}</p></div></div>`;
    return;
  }
  render();
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
}

async function tegnSideIndhold() {
  const host = document.getElementById('pageHost');
  if (!host) return;
  const v = viewById(state.view);
  const hoved = `<h1>${esc(v.label)}</h1><p class="lead">${esc(BESKRIVELSER[v.id] || '')}</p>`;

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
    <div class="card"><div class="tablewrap"><table class="data">
      <thead><tr><th>Title</th><th>Tags</th><th class="num">Updated</th><th></th></tr></thead>
      <tbody>${d.notes.map((n) => `<tr>
        <td><button class="linkknap" data-aabn="${esc(n.id)}">${esc(n.title || 'Untitled')}</button></td>
        <td><span class="chips">${n.tags.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</span></td>
        <td class="num">${esc(visTid(n.updatedAt))}</td>
        <td style="text-align:right;white-space:nowrap">
          ${opt.trash ? '' : `<button class="btn ghost" data-slet="${esc(n.id)}">Delete</button>`}</td>
      </tr>`).join('')}</tbody>
    </table></div></div>`;
}

function bindNoteliste() {
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
    host.innerHTML = `<div class="tablewrap"><table class="data">
        <thead><tr><th>Name</th><th>Type</th><th class="num">Size</th><th></th></tr></thead>
        <tbody>${d.files.map((f) => `<tr>
          <td><a href="${esc(f.url)}" ${f.inline ? '' : 'download'}>${esc(f.name)}</a></td>
          <td class="meta saetning">${esc(f.inline ? 'image' : f.mime)}</td>
          <td class="num">${esc(visStoerrelse(f.size))}</td>
          <td style="text-align:right"><button class="btn ghost danger"
            data-filslet2="${esc(f.id)}">Remove</button></td>
        </tr>`).join('')}</tbody>
      </table></div>`;
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
      adminDel = `
      <h2>Server</h2>
      <div class="card">
        <label class="switch">
          <input type="checkbox" id="tilladReg" ${a.allowRegistration ? 'checked' : ''}>
          <span>Let anyone create an account on this server</span></label>
        <p class="meta saetning">Off means only you can sign in. Your colleagues do not need accounts —
        a published wiki is read without one.</p>

        <label class="field" style="margin-top:16px"><span>Public address</span>
          <input class="input" id="offentligUrl" value="${esc(state.publicUrl || '')}"
            placeholder="${esc(location.origin)}" autocomplete="off" spellcheck="false"></label>
        <div class="btnrow" style="margin-top:8px">
          <button class="btn" id="offentligGem">Save address</button>
          ${state.publicUrl ? '<button class="btn" id="offentligRyd">Use this address</button>' : ''}
        </div>
        <p class="meta saetning">Sagu can be reached on more than one address. This is the one
        published links are written with, and the one search engines are told is the real one.
        Leave it empty to use whichever address you happen to be on.</p>
        <div class="tablewrap" style="margin-top:14px"><table class="data">
          <thead><tr><th>Account</th><th>Role</th><th class="num">Created</th></tr></thead>
          <tbody>${a.users.map((u) => `<tr><td>${esc(u.username)}</td>
            <td>${u.isAdmin ? 'Administrator' : 'Member'}</td>
            <td class="num">${esc(visTid(u.createdAt))}</td></tr>`).join('')}</tbody>
        </table></div>
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
        placeholder="${d.connected ? 'Saved — leave empty to keep it' : 'doda_…'}"></label>
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
        placeholder="${g.connected ? 'Saved — leave empty to keep it' : 'github_pat_… or ghp_…'}"></label>
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

  return `
  <h2>Appearance</h2>
  <div class="card">
    <div class="btnrow">${knap('auto', 'Follow system')}${knap('light', 'Light')}${knap('dark', 'Dark')}</div>
  </div>

  <h2>Account</h2>
  <div class="card">
    <p class="meta saetning">Signed in as <strong>${esc(state.user.username)}</strong>${state.user.isAdmin ? ' (administrator)' : ''}.</p>
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

  <h2>Access keys</h2>
  <div class="card">
    <p class="meta saetning">For iPhone shortcuts, other apps and the doda link.
    A key reaches your own notes and nothing else. The value is shown once.</p>
    ${noegler.length ? `<div class="tablewrap"><table class="data">
      <thead><tr><th>Name</th><th>Scope</th><th class="num">Last used</th><th></th></tr></thead>
      <tbody>${noegler.map((k) => `<tr><td>${esc(k.name)}</td><td>${esc(k.scope)}</td>
        <td class="num">${esc(k.last_used_at ? visTid(k.last_used_at) : 'never')}</td>
        <td style="text-align:right"><button class="btn ghost danger" data-noegleslet="${esc(k.id)}">Revoke</button></td>
      </tr>`).join('')}</tbody></table></div>` : ''}
    <div class="btnrow" style="margin-top:14px">
      <input class="input" id="noegleNavn" placeholder="What is it for?" style="max-width:220px">
      <select class="input" id="noegleScope" style="max-width:150px">
        <option value="read">read</option>
        <option value="capture">capture</option>
        <option value="link">link</option>
        <option value="full">full</option>
      </select>
      <button class="btn" id="noegleNy">Create key</button>
    </div>
    <p id="noegleVaerdi" class="meta saetning" hidden></p>
    <div class="btnrow" style="margin-top:12px">
      <button class="btn" id="tilApi">How to use these →</button>
    </div>
    <p class="meta saetning"><strong>read</strong> looks but never writes.
    <strong>capture</strong> writes but never looks — a lost phone must not be able to
    read the archive. <strong>link</strong> does both, and nothing else: it is what a
    sister app needs to find the right note and make a new one.
    <strong>full</strong> can also change and delete.</p>
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
  ${dodaDel}
  ${ghDel}
  ${adminDel}`;
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

function bindSettings() {
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
    if (ryd) ryd.addEventListener('click', () => saet(''));
  }

  const nyNoegle = document.getElementById('noegleNy');
  if (nyNoegle) {
    nyNoegle.addEventListener('click', async () => {
      try {
        const d = await api('POST', '/api/v1/keys', {
          name: document.getElementById('noegleNavn').value,
          scope: document.getElementById('noegleScope').value,
        });
        const ud = document.getElementById('noegleVaerdi');
        // Vaerdien vises ÉN gang. navigator.clipboard kraever secure context,
        // og panelet tilgaas over http - saa teksten skal kunne markeres og
        // kopieres i haanden (RUNE-ERFARINGER, tools v1).
        ud.innerHTML = `Copy it now — it is never shown again:<br><code>${esc(d.key)}</code>`;
        ud.hidden = false;
        await tegnSide();
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
  beskidt: false,
  sidstGemt: 0,
  konflikt: null,
  foldede: new Set(),
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

/* --------------------------------------------------------------- traeet */

async function hentTrae() {
  try {
    const d = await api('GET', '/api/v1/tree');
    state.notebooks = d.notebooks;
    state.tree = d.notes;
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
    return `<div class="tree-row${aktiv ? ' on' : ''}" data-raekke="${esc(note.id)}"
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
      ${sektionFoldet || !loese.length ? '' : `<div class="tree-book open">
        <div class="tree-row book"><span class="tree-fold empty"></span>
          <span class="tree-name meta" style="cursor:default">Not in a notebook</span></div>
        ${loese.map((x) => gren(x, 1)).join('')}</div>`}
      <div class="tree-actions">
        <button class="btn ghost" id="nyNoteTop">${icon('plus', 14)} New note</button>
        <button class="btn ghost" id="dagensNote">${icon('kalender', 14)} Today's note</button>
        <button class="btn ghost" id="fraSkabelon">${icon('skabelon', 14)} From template</button>
        <button class="btn ghost" id="nyBogTop">${icon('book', 14)} New notebook</button>
      </div>
    </div>`;
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
    el.addEventListener('click', () => aabnNote(el.dataset.note));
  });

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
        await api('POST', '/api/v1/notebooks', { name: navn });
        await hentTrae();
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
  const note = traeNote(noteId);
  const maal = traeNote(maalId);
  if (!note || !maal || note.id === maal.id) return;

  const nyFar = maal.parentId || null;
  const nyBog = maal.notebookId || null;
  try {
    if ((note.parentId || null) !== nyFar || (note.notebookId || null) !== nyBog) {
      await api('POST', `/api/v1/notes/${note.id}/move`,
        nyFar ? { parentId: nyFar } : { parentId: null, notebookId: nyBog });
    }
    const gruppe = (state.tree || [])
      .filter((n) => (n.parentId || null) === nyFar
        && (nyFar !== null || (n.notebookId || null) === nyBog)
        && n.id !== note.id);
    let i = gruppe.findIndex((n) => n.id === maal.id);
    if (i < 0) i = gruppe.length - 1;
    gruppe.splice(efter ? i + 1 : i, 0, note);
    await api('POST', '/api/v1/reorder', { kind: 'note', ids: gruppe.map((n) => n.id) });
    await hentTrae();
    tegnTrae();
    synkAabenNote();
  } catch (ex) { toast(ex.message); }
}

/** Slip paa en notesbog: ind i den, oeverst i traeet. */
async function slipIBog(noteId, bogId) {
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
      traek.fra.classList.add('traekkes');
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
    if (traek.fra) traek.fra.classList.remove('traekkes');
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
    if (traek.fra) traek.fra.classList.remove('traekkes');
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
  host.innerHTML = traeHtml();
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
async function aabnNote(id) {
  if (editor.note && editor.note.id === id && !editor.indlaeser) return;
  await gemNu();
  editor.indlaeser = id;
  state.view = 'note';
  state.openNote = id;
  editor.aabenBlok = null;
  editor.konflikt = null;
  tegnSide();
  try {
    const d = await api('GET', `/api/v1/notes/${id}`);
    if (editor.indlaeser !== id) return;      // en anden note vandt kapløbet
    editor.indlaeser = null;
    editor.note = d.note;
    editor.beskidt = false;
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
      <input class="chip-felt" id="maerkeFelt" list="maerkeListe" placeholder="tag name"
        autocomplete="off" spellcheck="false" hidden>
      <datalist id="maerkeListe">${(state.tags || [])
    .map((t) => `<option value="${esc(t.name)}"></option>`).join('')}</datalist>` : ''}
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

function bindMaerker() {
  const felt = document.getElementById('maerkeFelt');
  const knap = document.getElementById('tilfoejMaerke');
  if (!felt || !knap) return;

  knap.addEventListener('click', () => {
    knap.hidden = true;
    felt.hidden = false;
    felt.value = '';
    felt.focus();
  });

  const luk = () => { felt.hidden = true; knap.hidden = false; };
  felt.addEventListener('keydown', (e) => {
    // Feltet ejer sine taster: uden stopPropagation gemmer notens egen
    // ⌘+Enter-genvej samtidig, og »f« ville slaa fokus-tilstand til
    // (RUNE-ERFARINGER, doda v29/v31/v34).
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); luk(); return; }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const navn = felt.value.trim().replace(/^#/, '');
    if (!navn) { luk(); return; }
    const nuvaerende = editor.note.tags || [];
    if (nuvaerende.some((t) => t.toLowerCase() === navn.toLowerCase())) { luk(); return; }
    saetNoteMaerker(nuvaerende.concat([navn]));
  });
  felt.addEventListener('blur', () => setTimeout(luk, 120));

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
        <span id="gemMaerke">${gemMaerke()}</span>
        <button class="iconbtn" id="bredBtn" aria-pressed="${n.fullWidth ? 'true' : 'false'}"
          title="${n.fullWidth ? 'Use reading width' : 'Use the full width'}">${icon('width', 16)}</button>
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

  if (editor.aabenBlok !== null) { tegnMedAabenBlok(host, n); return; }

  try {
    const { html } = saguMarkdown.render(n.body, renderValg());
    host.innerHTML = html || '<p class="tom-note meta saetning">Click here to start writing.</p>';
    pyntKodeblokke(host);
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
    // Klik under indholdet: aabn den sidste blok, eller lav en ny.
    if (e.target === host) aabnSidste();
  });
}

/** Erstatter ÉN blok med et raat markdown-felt. Resten bliver staaende. */
function tegnMedAabenBlok(host, n) {
  const linjer = n.body.split('\n');
  const blokke = saguMarkdown.blokke(n.body);
  const b = blokke.find((x) => x.fra === editor.aabenBlok);
  if (!b) { editor.aabenBlok = null; tegnKrop(); return; }

  const foer = linjer.slice(0, b.fra).join('\n');
  const efter = linjer.slice(b.til + 1).join('\n');
  const raa = linjer.slice(b.fra, b.til + 1).join('\n');

  const del = (md) => {
    if (!md.trim()) return '';
    try { return saguMarkdown.render(md, renderValg()).html; } catch { return ''; }
  };

  host.innerHTML = `${del(foer)}
    <textarea class="blok-felt" id="blokFelt" spellcheck="false"
      rows="${Math.max(1, raa.split('\n').length)}">${esc(raa)}</textarea>
    ${del(efter)}`;

  // De renderede dele skal ogsaa have knapper, lightbox og indlejringer.
  // **Begge optegningsveje** - den her og `tegnKrop()` - skal goere det samme;
  // glemmer den ene noget, virker funktionen kun, naar ingen blok er aaben,
  // og fejlen ligner »kortet forsvandt, da jeg klikkede« (F12).
  pyntKodeblokke(host);
  bindTjek(host);
  bindBilleder(host);
  fyldGhIndlejringer(host);

  const felt = document.getElementById('blokFelt');
  if (!felt) return;
  autoHoejde(felt);
  felt.focus();
  // Markoeren i slutningen, saa man kan skrive videre med det samme.
  felt.setSelectionRange(felt.value.length, felt.value.length);

  felt.addEventListener('input', () => {
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
    toast(ex.message);
  } finally {
    editor.gemmer = false;
    const m2 = document.getElementById('gemMaerke');
    if (m2) m2.innerHTML = gemMaerke();
  }
}

/* ------------------------------------------------------------ fuldskaerm */

/*
 * »Fuld skaerm« er tre forskellige oensker, og de loeses hver for sig:
 *
 *  1. **Fuld bredde** - notens tekstspalte bruger hele siden i stedet for
 *     laesebredden paa 820 px. Godt til tabeller og kode; skidt til prosa,
 *     fordi lange linjer er svaere at laese. Derfor et valg PR. NOTE, gemt i
 *     databasen (`full_width`), saa det foelger noten til enhver skaerm.
 *  2. **Fokus** - alt andet end noten forsvinder: sidebar, broedkrummer,
 *     vaerktoejer. Det er en tilstand ved SKAERMEN, ikke ved noten, saa den
 *     gemmes ikke. Esc gaar tilbage.
 *  3. **Browserens fuldskaerm** - ogsaa uden faner og adressefelt. Kraever en
 *     brugerhandling, saa den kan kun taendes fra en knap, og den fejler
 *     stille i en iframe. Derfor er den et TILVALG oven paa fokus og ikke
 *     det, F-tasten goer.
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

  const bred = document.getElementById('bredBtn');
  if (bred) {
    bred.addEventListener('click', async () => {
      n.fullWidth = !n.fullWidth;
      document.body.classList.toggle('bred-note', n.fullWidth);
      bred.setAttribute('aria-pressed', n.fullWidth ? 'true' : 'false');
      bred.title = n.fullWidth ? 'Use reading width' : 'Use the full width';
      try {
        await api('PATCH', `/api/v1/notes/${n.id}`, { fullWidth: n.fullWidth });
      } catch (ex) { toast(ex.message); }
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
  document.body.classList.toggle('bred-note', !!n.fullWidth);
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
    ${mit ? `<button class="usermenu-item" data-do="dup">${icon('copy', 16)}<span>Duplicate</span></button>
    <button class="usermenu-item" data-do="dupall">${icon('copy', 16)}<span>Duplicate with subpages</span></button>
    ${foer ? `<button class="usermenu-item" data-do="ind">${icon('ind', 16)}<span>Make it a subpage of “${
  esc((foer.title || 'Untitled').slice(0, 24))}”</span></button>` : ''}
    <button class="usermenu-item" data-do="op">${icon('fold', 16)}<span>Move up</span></button>
    <button class="usermenu-item" data-do="ned">${icon('udfold', 16)}<span>Move down</span></button>
    <button class="usermenu-item" data-do="flyt">${icon('book', 16)}<span>Move to notebook…</span></button>
    ${n.parentId ? `<button class="usermenu-item" data-do="root">${icon('out', 16)}<span>Move to top level</span></button>` : ''}` : ''}
    <button class="usermenu-item" data-do="fs">${icon('focus', 16)}<span>Browser fullscreen</span></button>
    ${mit ? `<button class="usermenu-item danger" data-do="del">${icon('trash', 16)}<span>Move to trash</span></button>` : ''}`;
  vaert.appendChild(host);

  host.querySelectorAll('[data-do]').forEach((el) => {
    el.addEventListener('click', async () => {
      const hvad = el.dataset.do;
      host.remove();
      try {
        if (hvad === 'fil') { vaelgFiler(); return; }
        if (hvad === 'md') { visMarkdownPanel(); return; }
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
      <span class="legend-item">↵ ${esc(enter)}</span></span>`;
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
      return `<button class="omni-row${paa}" data-row="${i}">
          <span class="omni-row-ikon">${icon('notes', 16)}</span>
          <span class="omni-row-tekst">
            <span class="omni-row-titel">${esc(r.etiket)}</span>
            ${r.uddrag ? `<span class="omni-row-uddrag">${uddrag(r.uddrag)}</span>` : ''}
          </span>
          <span class="omni-row-meta meta">${r.afsnitTitel ? esc(r.afsnitTitel)
    : (r.meta ? esc(r.meta) : '')}</span>
        </button>`;
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
    el.addEventListener('click', () => vaelgRaekke(Number(el.dataset.row)));
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
      await api('POST', '/api/v1/notebooks', { name: r.tekst });
      await hentTrae();
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
    if (e.key === 'Enter') { e.preventDefault(); vaelgRaekke(omni.valgt); return; }
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

function komHtml(c, svarene) {
  const svar = (svarene || []).filter((x) => x.parentId === c.id);
  const egen = !c.guest && state.user && c.author === state.user.username;
  const redigerer = kom.redigerer === c.id;
  return `<li class="kom${c.status === 'published' ? '' : ' daempet'}" data-kom="${esc(c.id)}">
    <div class="kom-top">
      <span class="kom-navn">${esc(c.author)}</span>
      ${c.guest ? '<span class="kom-maerke gaest">guest</span>' : ''}
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
  return `<section class="kommentarer" id="kommentarer">
    <h2>Comments${kom.liste.length ? ` <span class="group-count">${kom.liste.length}</span>` : ''}
      ${venter ? `<span class="kom-maerke venter">${venter} waiting</span>` : ''}</h2>
    ${top.length
    ? `<ul class="kom-liste">${top.map((c) => komHtml(c, kom.liste)).join('')}</ul>`
    : '<p class="meta saetning">No comments yet.</p>'}
    ${kom.svarPaa ? '' : komSkrivHtml(null)}
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
          <span class="kom-navn">${esc(c.author)}</span>
          ${c.guest ? '<span class="kom-maerke gaest">guest</span>' : ''}
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
  return `<section class="dodaopgaver" id="dodaOpgaver">
    <h2>Tasks in doda${dodaState.opgaver.length
    ? ` <span class="group-count">${aabne.length}/${dodaState.opgaver.length}</span>` : ''}</h2>
    ${dodaState.gammel
    /*
     * En liste, der ikke er frisk, skal SIGE det - og blive staaende. En bro,
     * der bliver tom, naar den anden ende er nede, ligner en bro, der har
     * mistet noget.
     */
    ? `<p class="meta saetning">Showing what doda last said — ${esc(dodaState.gammel)}</p>` : ''}
    ${dodaState.opgaver.length
    ? `<ul class="doda-liste">${dodaState.opgaver.map((t) => `
      <li class="doda-opgave${t.status === 'done' || t.status === 'dropped' ? ' udfoert' : ''}">
        <span class="doda-titel">${esc(t.title)}</span>
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
        ['Request Body', 'Text — the Shortcut Input'],
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
        ['Request Body', 'Text — the Shortcut Input'],
      ],
      noter: 'The note is named after the date (<code>2026-08-21</code>) and is made the '
        + 'first time you send something. In a different time zone than the server? Send your '
        + 'own day: <code>?to=today&amp;date=</code> with the date from <em>Current Date</em>.',
    },
    {
      navn: 'Share an image from the share sheet',
      hvorfor: 'A photo of the cabinet, a whiteboard, a receipt — as a note with the image in it.',
      felter: [
        ['URL', `${b}/api/v1/capture?name=foto.jpg&text=Skabet%20i%20kaelderen`],
        ['Method', 'POST'],
        ['Headers', 'Authorization: Bearer sagu_…'],
        ['Request Body', 'File — the Shortcut Input'],
      ],
      noter: 'Set <em>Request Body</em> to <strong>File</strong>, not JSON. The image becomes '
        + 'an attachment and is written into the note. Add <code>&amp;to=today</code> to put it '
        + 'in today\'s note instead.',
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
        <tr><td><code>capture</code></td><td>Add new notes and images</td>
          <td><strong>Read nothing at all</strong></td></tr>
        <tr><td><code>read</code></td><td>Read and search</td><td>Write anything</td></tr>
        <tr><td><code>link</code></td><td>Read, search and add</td><td>Change or delete</td></tr>
        <tr><td><code>full</code></td><td>Everything above, and change and delete</td>
          <td>Make keys, change your password, or touch server settings</td></tr>
      </tbody>
    </table></div>
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
    <p class="meta saetning">A <code>#tag</code> in the first line becomes a real tag, exactly
    as it does in the title field — and a web address with a <code>#fragment</code> does not.
    Add <code>?notebook=Drift</code> to file it somewhere; the name works, so a shortcut does
    not have to look up an id.</p>
  </div>

  <h2>Recipes</h2>
  <div class="card">
    <p class="lead">In Shortcuts: <em>Get Contents of URL</em>. These are the fields, in the
    order they appear there.</p>
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
        <tr><th>401</th><td>The key is wrong or revoked. Make a new one.</td></tr>
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
