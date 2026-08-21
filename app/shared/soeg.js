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
