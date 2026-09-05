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
   * Fra `esc()`'et tekst tilbage til den raa streng.
   *
   * ── Den fejl, den findes for ──────────────────────────────────────────
   *
   * `inline()` escaper HELE teksten foerst, saa alt herefter er ufarligt.
   * Men det betyder ogsaa, at en adresse, der fanges af en af reglerne
   * nedenfor, ALLEREDE baerer `&amp;` - og et `attr()` ovenpaa gjorde den til
   * `&amp;amp;`. Browseren afkoder ét lag, saa
   *
   *     https://a.dk/?x=1&y=2   ->   href="...?x=1&amp;amp;y=2"
   *
   * og linket peger paa `?x=1&amp;y=2`. Hver eneste adresse med en query
   * var i stykker - YouTube med `&t=`, Amazon, alt med mere end én parameter.
   * Fundet 2026-09-05, da rundturen HTML -> markdown (F30) sammenlignede
   * hrefs med kilden.
   *
   * Adressen afkodes derfor STRAKS efter, den er fanget. Saa ser
   * `sikkerUrl()` den rigtige adresse, vaertens kroge (`billedUrl`,
   * `linkUrl`) faar den rigtige adresse, og `attr()` undslipper én gang.
   *
   * Raekkefoelgen er ikke tilfaeldig: `&amp;` skal vaere SIDST, ellers ville
   * `&amp;lt;` blive til `<` i stedet for `&lt;`.
   */
  function afEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
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
    /*
     * Et FAERDIGT tag laegges til side bag en pladsholder.
     *
     * Reglerne nedenfor koerer paa én lang streng, og uden det her ser de
     * ogsaa ind i de tags, de tidligere regler lige har udsendt. En adresse
     * med `__` i - fx et sporingslink `.../v3/__https://...` - fik derfor et
     * `<strong>` injiceret midt i sit href, og linket var i stykker. Fundet
     * 2026-09-05 (F30). Kodestumper har brugt teknikken siden F1; nu bruger
     * alle tag-udsendende regler den.
     */
    const gem = (html) => {
      gemt.push(html);
      return `\x00${gemt.length - 1}\x00`;
    };
    // NUL bruges som pladsholder for kodestumper nedenfor. Kommer der et
    // NUL med i brugerens egen tekst (JSON kan skrive \u0000), ville det
    // kunne ligne en pladsholder - saa det ryger ud foerst.
    // Escapes FOERST. Alt herefter arbejder paa ufarlig tekst.
    let s = esc(String(raa == null ? '' : raa).replace(/\x00/g, ''));

    // 1. kodestumper ud
    s = s.replace(/`([^`\n]+)`/g, (_, k) => gem(`<code>${k}</code>`));

    // 2. [[note-titel]] - wiki-link. Maalet slaas op af vaerten; her bliver
    //    det til et link med titlen i et data-attribut, saa baade appen og
    //    den server-renderede wiki kan afgoere, hvor det peger hen.
    s = s.replace(/\[\[([^\]\n]{1,200})\]\]/g, (_, navn) => {
      const rent = navn.trim();
      const kendt = o.slaaOpNote ? o.slaaOpNote(rent) : null;
      if (kendt) return gem(`<a class="notelink" href="${attr(kendt.href)}">${rent}</a>`);
      // En doed henvisning skal SES som doed, ikke forsvinde. Det er en
      // kendsgerning om noten, ikke en fejl (Verdandes spec, og den er rigtig).
      return gem(`<span class="notelink dead" title="No note with that title yet">${rent}</span>`);
    });

    // 3. ![alt](adresse) - FOER links, ellers spiser link-reglen udraabstegnet.
    //
    //    Her er `attr()` ikke valgfri: alt-teksten havner i en ATTRIBUT, og
    //    en escaper skrevet til tekst mellem tags tager ikke anfoerselstegn.
    //    `![" onerror="alert(1)](x.png)` er hele angrebet.
    s = s.replace(/!\[([^\]\n]{0,200})\]\(([^)\s]{1,2000})\)/g, (helt, alt, raaUrl) => {
      const url = afEsc(raaUrl);
      const sikker = o.billedUrl ? o.billedUrl(url) : sikkerUrl(url);
      if (sikker) {
        /*
         * `data-md` er den adresse, der STAAR i noten. `sagu:<id>` oversaettes
         * af vaerten til en api-adresse, og uden sporet her kunne vejen
         * tilbage til markdown ikke skrive `sagu:`-adressen igen - noten ville
         * holde op med at pege paa sin egen vedhaeftning (F30).
         */
        const spor = sikker === url ? '' : ` data-md="${attr(url)}"`;
        return gem(`<img src="${attr(sikker)}"${spor} alt="${attr(alt)}" loading="lazy" class="note-img">`);
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
        /*
         * Det her ER et billede - CSP'en naegter bare at hente det fra en
         * fremmed vaert. `data-billede` siger det, saa vejen tilbage til
         * markdown skriver `![]()` og ikke `[]()`; `data-tom` daekker den
         * tomme alt-tekst, som rendereren erstatter med adressen, for at der
         * er noget at klikke paa (F30).
         */
        return gem(`<a href="${attr(udefra)}" class="ekstern-billede" data-billede="1"${
          alt ? '' : ' data-tom="1"'} target="_blank"
          rel="noopener noreferrer" title="External images are not loaded">${alt || attr(udefra)}</a>`);
      }
      return helt;
    });

    // 4. [tekst](adresse)
    s = s.replace(/\[([^\]\n]{0,200})\]\(([^)\s]{1,2000})\)/g, (helt, tekst, raaUrl) => {
      const url = afEsc(raaUrl);
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
        return gem(`<span class="notelink dead" title="This page is not part of this site">${
          tekst || 'note'}</span>`);
      }
      const sikker = oversat || sikkerUrl(url);
      // Alt andet staar som den tekst, der blev skrevet - saa forsvinder
      // indholdet ikke, og der opstaar intet href.
      if (!sikker) return helt;
      // `#` er lige saa intern som `/`: appen aabner `#note-<id>` selv.
      const intern = oversat && (oversat[0] === '/' || oversat[0] === '#');
      /*
       * `data-tom` er det tredje spor (F30): skrev man `[](adresse)` uden
       * tekst, saetter rendereren adressen ind, saa linket kan ses og klikkes.
       * Men saa ligner det `[adressen](adressen)`, og vejen tilbage til
       * markdown ville skrive en tekst, ingen har skrevet.
       */
      return gem(`<a href="${attr(sikker)}"${tekst ? '' : ' data-tom="1"'}${intern ? ' class="vedhaeft"'
        : ` target="_blank" rel="${eksternRel}"`}>${tekst || attr(sikker)}</a>`);
    });

    // 5. naegen adresse
    s = s.replace(/(^|[\s(])((?:https?:\/\/)[^\s<]{1,2000})/g, (helt, foer, raaUrl) => {
      const url = afEsc(raaUrl);
      // Slutpunktum og lukkeparentes hoerer til saetningen, ikke til adressen.
      const hale = url.match(/[.,;:!?)]+$/);
      const ren = hale ? url.slice(0, -hale[0].length) : url;
      const sikker = sikkerUrl(ren);
      if (!sikker) return helt;
      const vis = esc(sikker.replace(/^https?:\/\//, ''));
      /*
       * `data-auto` siger, at rendereren SELV fandt linket i teksten.
       *
       * Uden det er `[bar.dk](https://bar.dk)` og en bar `https://bar.dk`
       * det SAMME `<a>`, og vejen tilbage til markdown maa gaette. Den gaettede
       * forkert 240 gange i Andreas' arkiv (F30). Et program, der har udledt
       * noget, skal skrive det ned - ikke lade den naeste regne baglaens.
       */
      return `${foer}${gem(`<a href="${attr(sikker)}" data-auto="1" target="_blank" rel="${
        eksternRel}">${vis}</a>`)}${hale ? hale[0] : ''}`;
    });

    // 6. eftertryk. ** foer *, ellers spiser den enkelte stjerne den dobbelte.
    /*
     * `_kursiv_` og `*kursiv*` er det SAMME tag, og `__fed__` og `**fed**`
     * ogsaa. Uden et spor kan vejen tilbage til markdown ikke vide, hvad der
     * stod - og en note, man kun har klikket i, ville faa sin tekst skrevet om
     * (F30). Understregen er den sjaeldne, saa den er den, der maerkes.
     */
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_\n]+)__/g, '<strong data-md="_">$1</strong>');
    s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^_\w])_([^_\n]+)_(?![_\w])/g, '$1<em data-md="_">$2</em>');
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
