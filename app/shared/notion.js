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
