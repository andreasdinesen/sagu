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
