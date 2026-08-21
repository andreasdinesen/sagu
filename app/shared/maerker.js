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
