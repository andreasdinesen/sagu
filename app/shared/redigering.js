/*
 * Sagu - fra HTML tilbage til markdown (F30).
 *
 * `markdown.render()` gaar den ene vej. Det her modul gaar den anden, og det
 * er forudsaetningen for at kunne skrive i noten, mens den ser ud, som naar
 * man laeser den: et `contenteditable` giver HTML tilbage, og databasen skal
 * have markdown.
 *
 * ── Hvorfor den er REN (streng ind, streng ud) ────────────────────────────
 *
 * Den kunne have gaaet gennem browserens DOM - det er der, den skal bruges.
 * Men proeverne koerer i node, hvor der ingen DOM er, og den vigtigste proeve
 * er rundturen over Andreas' 9.233 rigtige afsnit:
 *
 *     tilMarkdown(render(md)) === md
 *
 * En DOM-drevet udgave kunne ikke koere den. To udgaver - én til browseren og
 * én til proeverne - ville drive fra hinanden. Altsaa: en lille HTML-laeser
 * her, og browseren giver bare sin `innerHTML` videre.
 *
 * ── Hvad den IKKE goer ────────────────────────────────────────────────────
 *
 * Den gaetter aldrig. Kan et element ikke oversaettes, foldes dets TEKST ud i
 * stedet for at blive tabt. Et ukendt tag maa koste sin formatering; det maa
 * aldrig koste ordene.
 */
(function (global) {
  'use strict';

  /* Tags, der udsendes af rendereren og oversaettes tilbage. Alt andet
   * foldes ud som tekst - se `ud()` nedenfor. */
  const TOM = new Set(['br', 'img', 'hr', 'wbr']);

  /*
   * Tags, hvis INDHOLD skal vaek - ikke bare deres formatering.
   *
   * Reglen »et ukendt tag koster sin formatering, aldrig sine ord« er rigtig
   * for tekst. Men et `<style>`-blok fra et Word-indsaet er ikke ord: dets
   * indhold er CSS, og foldet ud ville et indsaet fra Word dumpe hundredvis
   * af linjer stilark ind i noten. Maalt 2026-09-05 med et rigtigt indsaet.
   */
  const SLUGES = new Set(['style', 'script', 'head', 'meta', 'title', 'link', 'noscript']);

  const ENTITETER = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'",
  };

  function afkod(s) {
    return String(s).replace(/&(#\d{1,6}|#x[0-9a-f]{1,5}|[a-z]+);/gi, (helt, navn) => {
      const n = navn.toLowerCase();
      if (n[0] === '#') {
        const kode = n[1] === 'x' ? parseInt(n.slice(2), 16) : parseInt(n.slice(1), 10);
        return Number.isFinite(kode) && kode > 0 && kode < 0x110000
          ? String.fromCodePoint(kode) : helt;
      }
      return Object.prototype.hasOwnProperty.call(ENTITETER, n) ? ENTITETER[n] : helt;
    });
  }

  /** Attributterne paa ét starttag. Vaerdier maa staa i ', " eller bart. */
  function attributter(raa) {
    const ud = {};
    const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let m = re.exec(raa);
    while (m) {
      ud[m[1].toLowerCase()] = afkod(m[2] !== undefined ? m[2]
        : (m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : '')));
      m = re.exec(raa);
    }
    return ud;
  }

  /**
   * HTML -> et traes af { tag, attr, boern } og { tekst }.
   *
   * Ubalancerede tags lukkes af sig selv ved enden. En note midt i at blive
   * skrevet er ikke velformet HTML, og et kast her ville vaere et tab af
   * tekst - ikke en fejlmeddelelse, nogen kan bruge.
   */
  function laes(html) {
    const rod = { tag: null, attr: {}, boern: [] };
    const stak = [rod];
    /*
     * Kolon SKAL med i tagnavnet. Word skriver `<o:p>`, `<w:sdt>`, `<m:oMath>`
     * med navnerum, og uden kolonet er `<o:p>` ikke et tag - saa slap
     * `</o:p>` igennem som synlig TEKST i noten. Maalt med et rigtigt
     * Word-indsaet 2026-09-05.
     */
    const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][-a-zA-Z0-9:]*)\s*>|<([a-zA-Z][-a-zA-Z0-9:]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
    let sidst = 0;
    let m = re.exec(html);
    const tekstUd = (s) => {
      if (s) stak[stak.length - 1].boern.push({ tekst: afkod(s) });
    };
    while (m) {
      tekstUd(html.slice(sidst, m.index));
      sidst = m.index + m[0].length;
      if (m[1]) {
        const navn = m[1].toLowerCase();
        // Luk til og med det naermeste aabne tag af samme navn. Et
        // </em> uden et <em> er stoej og springes over.
        for (let i = stak.length - 1; i > 0; i -= 1) {
          if (stak[i].tag === navn) { stak.length = i; break; }
        }
      } else if (m[2]) {
        const navn = m[2].toLowerCase();
        const knude = { tag: navn, attr: attributter(m[3] || ''), boern: [] };
        stak[stak.length - 1].boern.push(knude);
        if (!TOM.has(navn) && !/\/\s*$/.test(m[3] || '')) stak.push(knude);
      }
      m = re.exec(html);
    }
    tekstUd(html.slice(sidst));
    return rod;
  }

  /* ------------------------------------------------------- oversaettelsen */

  const OVERSKRIFT = { h1: '#', h2: '##', h3: '###', h4: '####', h5: '#####', h6: '######' };

  /** Alle efterkommere med et bestemt tag/klasse - laeseren har ingen DOM. */
  function find(knude, passer, ud2) {
    const svar = ud2 || [];
    for (const b of knude.boern || []) {
      if (passer(b)) svar.push(b);
      find(b, passer, svar);
    }
    return svar;
  }

  /*
   * Klassen skal matches som et HELT token.
   *
   * `\b` matchede ogsaa midt i et bindestregs-navn: `callout-krop` opfyldte
   * `\bcallout\b`, saa kroppen blev laest som endnu en callout, og resultatet
   * blev `> [!NOTE]\n> > [!CALLOUT-KROP]`. Klasser er en LISTE af ord - de
   * skal slaas op som ord.
   */
  const klasser = (k) => String((k.attr || {}).class || '').split(/\s+/).filter(Boolean);
  const harKlasse = (k, navn) => klasser(k).includes(navn);

  /**
   * `<div class="tjekliste">` -> `- [ ] tekst`.
   *
   * Indrykningen staar som `margin-left:Npx` med 22 px pr. niveau - det er
   * rendererens eget tal, og `blokke()` laeser to mellemrum tilbage som ét
   * niveau. Tilstanden staar i `aria-checked`, ikke i tegnet inde i knappen:
   * det UAFKRYDSEDE flueben er en tom knap (RUNE-ERFARINGER, klip).
   */
  function tjeklisteUd(knude, opt) {
    return (knude.boern || []).filter((k) => harKlasse(k, 'tjek')).map((raekke) => {
      const boks = find(raekke, (k) => harKlasse(k, 'tjek-boks'))[0];
      const tekst = find(raekke, (k) => harKlasse(k, 'tjek-tekst'))[0];
      const tjekket = boks && (boks.attr || {})['aria-checked'] === 'true';
      const x = (boks && (boks.attr || {})['data-x']) || 'x';
      const raa = (raekke.attr || {})['data-md'];
      if (raa) return `${raa}[${tjekket ? x : ' '}] ${tekst ? ud(tekst, opt) : ''}`;
      const m = /margin-left:\s*(\d+)px/.exec(String((raekke.attr || {}).style || ''));
      const dybde = m ? Math.round(Number(m[1]) / 22) : 0;
      return `${'  '.repeat(dybde)}- [${tjekket ? x : ' '}] ${tekst ? ud(tekst, opt) : ''}`;
    }).join('\n');
  }

  /** `<div class="callout note">` -> `> [!NOTE]` og kroppen med `> ` foran. */
  function calloutUd(knude, opt) {
    const art = (klasser(knude).find((x) => x !== 'callout') || 'note').toUpperCase();
    const krop = find(knude, (k) => harKlasse(k, 'callout-krop'))[0];
    const linjer = krop ? ud(krop, opt).split('\n') : [''];
    return [`> [!${art}]`, ...linjer.map((l) => (l ? `> ${l}` : '>'))].join('\n');
  }

  function ud(knude, opt) {
    if (knude.tekst !== undefined) return knude.tekst;
    const boern = () => knude.boern.map((b) => ud(b, opt)).join('');
    const a = knude.attr || {};

    if (SLUGES.has(knude.tag)) return '';

    switch (knude.tag) {
      case null: return boern();
      case 'br': return '\n';
      /*
       * `data-md` er rendererens spor: `_kursiv_` og `*kursiv*` bliver til det
       * samme tag, og uden sporet ville en note, man kun har klikket i, faa
       * sin tekst skrevet om. Vi gaetter ikke - vi laeser, hvad der stod.
       */
      case 'strong': case 'b': {
        const t = a['data-md'] === '_' ? '__' : '**';
        return `${t}${boern()}${t}`;
      }
      case 'em': case 'i': {
        const t = a['data-md'] === '_' ? '_' : '*';
        return `${t}${boern()}${t}`;
      }
      case 'del': case 's': return `~~${boern()}~~`;
      case 'u': return `__${boern()}__`;
      case 'code': return `\`${boern()}\``;
      case 'img': {
        /*
         * `data-md` er DEN oprindelige adresse. Uden den ville et
         * `sagu:`-billede komme tilbage som sin oversatte api-adresse, og
         * noten ville holde op med at pege paa sin egen vedhaeftning.
         */
        const kilde = a['data-md'] || a.src || '';
        return `![${a.alt || ''}](${kilde})`;
      }
      case 'a': {
        const href = a['data-md'] || a.href || '';
        const tekst = boern();
        /*
         * `data-auto` betyder, at rendereren SELV fandt adressen i teksten -
         * saa skal den tilbage som en bar adresse. Uden sporet maatte vi
         * gaette ud fra, om teksten ligner adressen, og det gaettede forkert
         * 240 gange i Andreas' arkiv: `[megaphone.fm/x](https://megaphone.fm/x)`
         * er skrevet af et menneske og ser ud som et autolink.
         */
        if (a['data-auto'] === '1') return href;
        // `data-billede`: det VAR et billede - CSP'en naegtede bare at hente
        // det fra en fremmed vaert, saa rendereren viste et link i stedet.
        const bang = a['data-billede'] === '1' ? '!' : '';
        // `data-tom`: kilden havde ingen tekst - rendereren satte adressen ind,
        // saa linket kunne ses. Den tekst er ikke brugerens og skal ikke gemmes.
        return `${bang}[${a['data-tom'] === '1' ? '' : tekst}](${href})`;
      }
      /* ------------------------------------------------- blok-niveau */

      case 'ul': case 'ol': {
        /*
         * Punkterne er FLADE, ikke noestede.
         *
         * Rendereren bygger dybden med `<ul><ul><li>` - uden et `<li>`
         * imellem - og hvert `<li>` baerer sit EGET absolutte praefiks i
         * `data-md`: indrykning og punkttegn, som de stod i noten. Saa er der
         * ingen grund til at regne nogen dybde ud her; listen er en raekke
         * linjer, og hver linje ved selv, hvor den hoerer hjemme.
         *
         * Uden `data-md` (aeldre HTML, eller noget indsat udefra) regnes en
         * dybde ud af, hvor dybt `<ul>`'erne ligger.
         */
        const linjer = [];
        const gaa = (liste, dybde) => {
          let nr = Number((liste.attr || {}).start || 1);
          for (const barn of liste.boern || []) {
            if (barn.tag === 'ul' || barn.tag === 'ol') { gaa(barn, dybde + 1); continue; }
            if (barn.tag !== 'li') continue;
            const under = (barn.boern || []).filter((k) => k.tag === 'ul' || k.tag === 'ol');
            const egen = { ...barn, boern: (barn.boern || []).filter((k) => !under.includes(k)) };
            const tekst = ud(egen, opt);
            if (tekst !== '' || !under.length) {
              const inde = (barn.attr || {})['data-md']
                || `${'  '.repeat(dybde)}${liste.tag === 'ol' ? `${nr}. ` : '- '}`;
              linjer.push(inde + tekst);
              nr += 1;
            }
            for (const u of under) gaa(u, dybde + 1);
          }
        };
        gaa(knude, 0);
        return linjer.join('\n');
      }
      case 'li': return boern();

      case 'blockquote':
        // `> ` foran hver linje. En TOM linje faar kun `>` - et efterladt
        // mellemrum ville aendre kilden.
        return boern().split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n');

      case 'span': {
        // `[[en anden note]]` bliver til en chip. Klassen er det eneste spor.
        if (harKlasse(knude, 'notelink')) return `[[${boern()}]]`;
        return boern();
      }

      case 'div': {
        if (harKlasse(knude, 'tjekliste')) return tjeklisteUd(knude, opt);
        if (harKlasse(knude, 'callout')) return calloutUd(knude, opt);
        return boern();
      }
      default: {
        const h = OVERSKRIFT[knude.tag];
        if (h) return `${h} ${boern()}`;
        // p og alt ukendt: teksten foldes ud. Et tag, vi ikke kender, maa
        // koste sin formatering - aldrig sine ord.
        return boern();
      }
    }
  }

  /** HTML fra én blok -> den markdown, blokken kom af. */
  function tilMarkdown(html, opt) {
    return ud(laes(String(html == null ? '' : html)), opt || {});
  }

  const api = { tilMarkdown, laes, afkod };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else global.saguRedigering = api;
}(typeof globalThis !== 'undefined' ? globalThis : this));
