'use strict';
/*
 * Sagu - service worker. Noterne skal kunne LÆSES uden net.
 *
 * ── Den fælde, der allerede har kostet en udgivelse ───────────────────────
 *
 * `VERSION` stemples af `build_rune.py`, præcis som `?v=` i index.html, og de
 * to **skal** følges ad. Bumpes cache-navnet ikke, hober hver udgivelse sig
 * op i browserens cache, og workeren kan servere en gammel `app.js` i det
 * uendelige. Det ramte doda i drift (v39 hed »web app'en på telefonen
 * opdaterer sig selv igen«), og det er nøjagtig den samme mekanik her.
 *
 * ── Hvad der cachelagres, og hvad der aldrig gør ──────────────────────────
 *
 * Appen og dens data: ja. Alt andet: nej, og hver undtagelse har en grund,
 * der står ved siden af den. Den vigtigste er wikien: en offentlig side hører
 * til den besøgende, ikke til den, der ejer arkivet — og en kopi af den i
 * ejerens browser ville hverken hjælpe nogen eller kunne ryddes af den,
 * det handler om.
 *
 * ── Cachen ryddes ved log ud ──────────────────────────────────────────────
 *
 * En cache overlever en session. Uden en oprydning ville en telefon, man har
 * logget ud af, stadig kunne vise noterne fra sidste gang — og det er en helt
 * anden aftale end den, »log ud« giver indtryk af. Appen sender `ryd`.
 */

const VERSION = 37;
const CACHE = `sagu-v${VERSION}`;

// Præcis de samme URL'er som index.html henter - ellers ligger der to kopier,
// og den precachede bliver aldrig brugt.
const SKAL = [
  './',
  `./style.css?v=${VERSION}`,
  `./app.js?v=${VERSION}`,
  './manifest.webmanifest',
  './icon-192.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // `addAll` fejler samlet, hvis ét svar er dårligt. Hellere hver for sig:
    // en manglende fil må ikke forhindre installationen.
    await Promise.all(SKAL.map((u) => c.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const navn of await caches.keys()) {
      if (navn.startsWith('sagu-') && navn !== CACHE) await caches.delete(navn);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'ryd') caches.keys().then((n) => n.forEach((x) => caches.delete(x)));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  /*
   * Skrivninger røres ALDRIG.
   *
   * En service worker, der gemmer POST'er, ville sende dem i tilfældig
   * rækkefølge og uden at kunne vise brugeren, hvad der skete. Skrivninger
   * offline hører til appens egen kø, hvor de kan ses og fortrydes.
   */
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  /*
   * Det, der aldrig må komme fra en cache:
   *
   *  - `/mcp`, `/oauth/`, `/.well-known/`: protokol, ikke app. Et samtykke
   *    eller et opdagelsesdokument skal ALTID komme fra serveren, og de er
   *    meningsløse offline.
   *  - `/w/` og `/s/`: den offentlige wiki. Den hører til den besøgende, og
   *    en kopi i ejerens browser hjælper ingen — den kan tilmed vise en side,
   *    der er trukket tilbage, længe efter den er det.
   */
  if (url.pathname === '/mcp' || url.pathname.startsWith('/oauth/')
      || url.pathname.startsWith('/.well-known/')
      || /^\/(w|s)\//.test(url.pathname)) return;

  // Selve siden: net først, så en ny udgivelse altid opdages, men skallen
  // findes offline.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const svar = await fetch(req);
        // KUN app-skallen gemmes under './'. Ellers kunne en hvilken som
        // helst anden navigation ende med at være det, brugeren får at se,
        // næste gang han åbner Sagu uden net.
        if (url.pathname === '/') (await caches.open(CACHE)).put('./', svar.clone());
        return svar;
      } catch {
        return (await caches.match('./')) || new Response('Offline', { status: 503 });
      }
    })());
    return;
  }

  /*
   * Data: net først, men gem hvert godt svar, så noterne kan læses uden net.
   *
   * Net FØRST og ikke cache først: en note, man har rettet på en computer,
   * skal være den nye, når man åbner telefonen. Prisen er, at man venter på
   * netværket, når det er der — og det er den rigtige pris for et arkiv, man
   * skriver i fra flere steder.
   */
  /*
   * **Alt under `/api/` er data** - ikke kun `/api/v1/`.
   *
   * Foerste udgave spurgte om `/api/v1/`, og saa faldt `/api/me` og
   * `/api/public-config` i den STATISKE gren nedenfor, som er cache-foerst.
   * Et svar paa »hvem er jeg« serveret fra cachen ville overleve et log ud og
   * fortaelle appen, at der stadig sad nogen. Fundet ved at kigge i cachen
   * efter at have varmet den op - ikke af en test.
   */
  if (url.pathname.startsWith('/api/')) {
    e.respondWith((async () => {
      try {
        const svar = await fetch(req);
        if (svar.ok) (await caches.open(CACHE)).put(req, svar.clone());
        return svar;
      } catch {
        const gemt = await caches.match(req);
        if (gemt) {
          // Markér svaret, så appen kan sige ÆRLIGT, at det er gammelt.
          const h = new Headers(gemt.headers);
          h.set('X-Sagu-Offline', '1');
          return new Response(await gemt.blob(), { status: 200, headers: h });
        }
        return new Response(JSON.stringify({
          error: 'offline',
          message: 'You are offline, and this has not been loaded before.',
        }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      }
    })());
    return;
  }

  // Statiske filer er versionerede -> cache først er sikkert og hurtigt.
  e.respondWith((async () => {
    const gemt = await caches.match(req);
    if (gemt) return gemt;
    try {
      const svar = await fetch(req);
      if (svar.ok) (await caches.open(CACHE)).put(req, svar.clone());
      return svar;
    } catch {
      /*
       * Uden net: find filen igen UDEN at se på `?v=`.
       *
       * Versionsnummeret er en cache-buster, ikke en del af filens identitet.
       * Har browseren en `index.html`, der beder om `app.js?v=7`, mens cachen
       * har `?v=6`, er en lidt gammel app uendeligt meget bedre end en tom
       * skærm — og næste gang der er net, henter navigationen den nye alligevel.
       *
       * Det her blev fundet ved at slukke serveren og prøve: i udviklings-
       * tilstand stempler serveren `?v=<mtime>`, så de to numre er ALDRIG ens,
       * og hele skallen faldt på gulvet. Den mekanik findes også i drift —
       * bare sjældnere.
       */
      const uden = await caches.match(req, { ignoreSearch: true });
      if (uden) return uden;
      return new Response('', { status: 504 });
    }
  })());
});
