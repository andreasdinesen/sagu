/*
 * Sagu -> doda (F8). Broen til opgave-appen.
 *
 * ── Hvorfor URL og noegle, og ikke et containernavn ───────────────────────
 *
 * Rune-skemaet er entydigt: det private bridge-net gaelder sidecars inde i ÉN
 * rune, og der er ingen navneoploesning mellem to runer (DESIGN.md maaling 3).
 * Svaret er derfor en adresse og en API-noegle, som brugeren selv saetter -
 * praecis som MsGraphBud allerede goer i drift. Det virker uanset topologi, og
 * fordi feltet ER en URL, er genvejen gratis: peges den paa serverens
 * LAN-adresse i stedet for paa tunnelen, forsvinder de ~150 ms uden en linje
 * ny kode. Det er en indstilling, ikke et design.
 *
 * ── Den regel, hele modulet staar paa ─────────────────────────────────────
 *
 * **Der maa ALDRIG gaa et kald til doda pr. optegning.** Rundturen gennem
 * tunnelen er maalt til 140-190 ms; tre kald i traek er et halvt sekund, hvor
 * der ikke sker noget (RUNE-ERFARINGER, doda v27: »tael blokerende rundture,
 * ikke millisekunder«). Status paa en notes opgaver laeses derfor fra Sagus
 * EGEN tabel, og den opfriskes hoejst én gang i kvarteret - med ét kald til
 * `/changes?since=`, ikke ét pr. opgave.
 *
 * ── Modulgraensen ─────────────────────────────────────────────────────────
 *
 * Modulet kender hverken database eller http-lag; det faar de fire funktioner,
 * det skal bruge, gennem `srv`. Samme moenster som `wiki.js` og `import.js` -
 * og gevinsten er den samme: en fejlsti kan proeves uden en server.
 */

'use strict';

/** En doda, der ikke svarer, maa ikke kunne haenge Sagu. */
const TIMEOUT_MS = 10_000;

/*
 * Hvor gammel en status maa vaere, foer den opfriskes.
 *
 * Var 15 minutter, og det var for laenge. Reglen bag tallet er »der maa ikke
 * gaa et kald til doda pr. OPTEGNING« - og at aabne en note er ikke en
 * optegning; en note tegnes mange gange, mens man skriver i den. Med et
 * kvarter var broen doed i praecis den gang, den er lavet til: send en
 * opgave, luk den i doda, kom tilbage til noten. Den stod stadig som aaben
 * (Andreas, 2026-08-21).
 *
 * Et minut holder stadig et kald fra hver optegning og fra hurtige spring
 * mellem noter - og det er kort nok til, at man tror paa det, man ser.
 */
const FRISK_I = 60;

function opret(srv) {
  /**
   * Opsaetningen for ÉN bruger.
   *
   * Forbindelsen er personlig: Sagu er flerbruger, og to brugere deler ikke
   * doda. Noeglen forlader ALDRIG serveren - frontenden faar `connected`.
   */
  function opsaetning(userId) {
    const url = String(srv.hentIndstilling(userId, 'doda_url') || '').replace(/\/+$/, '');
    const key = String(srv.hentIndstilling(userId, 'doda_key') || '');
    return { url, key, connected: !!(url && key) };
  }

  /**
   * Ét kald til doda. Svarer ALDRIG med en undtagelse, men med et resultat.
   *
   * Et netvaerksbrud og et afslag er to forskellige ting, og de skal kunne
   * skelnes af den, der kalder: en fejlet forbindelse skal vises som en chip
   * med en paen besked, ikke som en fejlet gemning (SAGU-PLAN F8's accept).
   */
  async function kald(userId, metode, sti, krop) {
    const { url, key } = opsaetning(userId);
    if (!url || !key) {
      return { ok: false, kode: 'not_connected', besked: 'doda is not connected yet.' };
    }
    let svar;
    try {
      svar = await fetch(`${url}${sti}`, {
        method: metode,
        headers: Object.assign(
          { Authorization: `Bearer ${key}` },
          krop === undefined ? {} : { 'Content-Type': 'application/json' },
        ),
        body: krop === undefined ? undefined : JSON.stringify(krop),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (ex) {
      // Browserens og Nodes egne netvaerksbeskeder siger intet brugbart.
      // Oversaettelsen hoerer ÉT sted (RUNE-ERFARINGER, doda v11).
      srv.logError(`doda: ${metode} ${sti}: ${ex && ex.message}`);
      return {
        ok: false,
        kode: 'unreachable',
        besked: 'doda did not answer. Check the address, and that it is running.',
      };
    }
    let data = null;
    try { data = await svar.json(); } catch { /* tomt eller ikke-JSON svar */ }
    if (svar.status === 403 && data && data.error === 'wrong_scope') {
      // IKKE det samme som en forkert noegle. Blander man de to, skifter
      // brugeren en noegle ud, der er helt i orden - og dodas egen besked
      // siger allerede praecis hvilket scope den har.
      return { ok: false, kode: 'wrong_scope', besked: data.message || 'The doda key is too narrow.' };
    }
    if (svar.status === 401 || svar.status === 403) {
      return {
        ok: false,
        kode: 'bad_key',
        besked: 'doda refused the key. Create a new one in doda and paste it again.',
      };
    }
    if (!svar.ok) {
      return {
        ok: false,
        kode: 'doda_error',
        // dodas egen besked ordret videre: den er det hurtigste spor, der
        // findes, og en paenere formulering fjerner den eneste oplysning.
        besked: (data && data.message) || `doda answered ${svar.status}.`,
      };
    }
    return { ok: true, data: data || {} };
  }

  /**
   * Proev forbindelsen.
   *
   * **Fejlstien er den vigtige.** Et levende endepunkt svarer 401 paa en
   * forkert noegle; et doedt svarer 404 eller 410 - og det er den forskel,
   * der afgoer, om man bygger paa noget, der findes (RUNE-ERFARINGER §6b,
   * Todoists pensionerede /rest/v2).
   *
   * `/api/v1/state` er valgt, fordi den kraever `read` og ikke aendrer noget:
   * lykkes den, kan noeglen baade naa doda OG laese - og det er halvdelen af
   * det, broen skal kunne.
   */
  async function proev(userId) {
    const r = await kald(userId, 'GET', '/api/v1/state');
    if (r.kode === 'wrong_scope') {
      /*
       * Noeglen kan ikke LAESE. Det er ikke en fejl - en `capture`-noegle er
       * den smalleste, der findes, og den kan stadig oprette opgaver.
       *
       * Men det kan ikke bevises uden at oprette noget, og en forbindelsestest,
       * der efterlader en opgave i indbakken, er en daarlig test. Sig sandheden
       * i stedet: hvad den kan, og hvad der saa ikke virker.
       */
      return {
        ok: true,
        begraenset: true,
        besked: 'Connected for creating tasks. This key cannot read, so task status '
          + 'will not be shown. Use a "full" key in doda if you want that.',
      };
    }
    if (!r.ok) return r;
    const n = r.data && r.data.counts ? r.data.counts : {};
    return {
      ok: true,
      besked: `Connected. ${n.next || 0} next actions, ${n.inbox || 0} in the inbox.`,
    };
  }

  /**
   * Opretter en opgave i doda.
   *
   * **Teksten er DODAS sprog, ikke Sagus.** `#kontekst`, `@projekt` og
   * `!i morgen` tolkes af doda selv - broen fylder en skabelon ud og forstaar
   * intet (RUNE-ERFARINGER, MsGraphBud). Derfor er hver ny »kan den ogsaa
   * saette et maerke«-oenske gratis.
   */
  async function opretOpgave(userId, tekst, opt) {
    const o = opt || {};
    /*
     * Linket staar i TEKSTEN, ikke i et felt.
     *
     * doda har rigtige `link_url`/`link_title`-kolonner, og de er det rette
     * sted - men `/api/v1/capture` tager dem ikke imod, og at sende dem
     * alligevel ville vaere en parameter, der bliver ignoreret i stilhed:
     * Sagu ville tro, opgaven var linket, og doda ville aldrig have set den.
     * At saette feltet bagefter kraever `write`, altsaa en `full`-noegle til
     * hele opgavearkivet - for meget for en bro, der skal skrive ét link.
     *
     * Teksten virker med den SMALLESTE noegle, der findes (`capture`), og
     * naar doda faar sin halvdel af F8, kan den selv loefte adressen op i
     * `link_url`. Det er modtagerens arbejde, ikke broens.
     *
     * **Og den skal have sin EGEN linje.** Foerste udgave haengte den paa
     * enden med et tankestreg, og det kostede baade linket og datoen: dodas
     * `!`-markoer loeber til linjens ende, saa `!i morgen — http://…` blev
     * tolket som ét datoudtryk, der ikke gav mening. Resultatet var en opgave
     * uden forfaldsdato og uden link - og INTET fejlede. Maalt mod en rigtig
     * doda:
     *
     *   samme linje  ->  titel »Ret trin 2«, due: null, note: ''
     *   egen linje   ->  titel »Ret trin 2«, due: i morgen, note: <adressen>
     *
     * Modtageren laeser foerste linje som titel og resten som beskrivelse, saa
     * adressen lander praecis dér, hvor den hoerer hjemme. Reglen er generel:
     * **at haenge noget PAA en linje, hvis syntaks er aaben, er at give det
     * vaek** (RUNE-ERFARINGER, MsGraphBud v6).
     */
    const linje = o.linkUrl
      ? `${String(tekst || '').trim()}\n${o.linkUrl}`
      : String(tekst || '').trim();
    const r = await kald(userId, 'POST', '/api/v1/capture', {
      text: linje,
      // En klient UDEN skaerm skal opfoere sig som en genvej: ukendte
      // kontekster og projekter oprettes uden at spoerge, for der er ingen at
      // spoerge.
      createNew: true,
    });
    if (!r.ok) return r;
    const item = r.data && r.data.item;
    if (!item || !item.id) {
      return { ok: false, kode: 'doda_error', besked: 'doda did not return a task.' };
    }
    return { ok: true, item, besked: r.data.message || `Added: ${item.title}` };
  }

  /**
   * Det, der er aendret i doda siden sidst.
   *
   * ÉT kald for alle opgaver, ikke ét pr. opgave. `since` er Sagus eget
   * vandmaerke, og doda svarer med sit `now`, saa de to ure ikke skal vaere
   * enige.
   */
  async function aendringer(userId, since) {
    return kald(userId, 'GET', `/api/v1/changes?since=${encodeURIComponent(since || 0)}`);
  }

  /**
   * Markér en opgave udført i doda - eller fortryd det.
   *
   * ── Hvorfor begge veje ────────────────────────────────────────────────
   *
   * Et flueben, man ikke kan tage af igen, er en faelde: man rammer forkert,
   * og saa er der ingen vej tilbage uden at aabne doda. doda har begge
   * endepunkter, saa det koster ingenting at goere det rigtigt.
   *
   * ── Og hvorfor det kraever en bredere noegle ──────────────────────────
   *
   * At AENDRE en opgave er `write` i dodas scope-tabel; at oprette er
   * `capture`. En bro, der kun skal sende noget ind, klarer sig med den
   * smalleste noegle - men den her aendrer noget, der allerede findes.
   * `wrong_scope` bliver derfor sendt ordret videre, saa fladen kan sige
   * HVAD der mangler i stedet for »det virkede ikke«.
   */
  async function saetUdfoert(userId, dodaId, udfoert) {
    const sti = `/api/v1/items/${encodeURIComponent(dodaId)}/${udfoert ? 'complete' : 'uncomplete'}`;
    const r = await kald(userId, 'POST', sti, {});
    if (!r.ok) return r;
    return { ok: true, item: (r.data && r.data.item) || null };
  }

  return { opsaetning, kald, proev, opretOpgave, aendringer, saetUdfoert, FRISK_I };
}

module.exports = { opret, TIMEOUT_MS, FRISK_I };
