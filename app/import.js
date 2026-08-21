'use strict';
/*
 * Sagu - import af en Notion-eksport.
 *
 * »Fasen, der afgør om Sagu bliver taget i brug« (SAGU-PLAN F5).
 *
 * Det koerer som et BAGGRUNDSJOB paa serveren, ikke i frontenden: 278 sider og
 * 249 filer er minutters arbejde, og en loekke i browseren doer med fanen
 * (RUNE-ERFARINGER §6c). Frontenden poller `status` og viser et baand, saa
 * Andreas kan lukke browseren, mens det koerer.
 *
 * Modulet faar serverens funktioner injiceret og kender hverken http eller
 * SQL-detaljerne - samme moenster som mcp.js og webauthn.js. Det er dét, der
 * goer, at hele importen kan koeres mod en rigtig database i en test.
 *
 * ── Raekkefoelgen, og hvorfor den er saadan ───────────────────────────────
 *
 *  1. **Laes strukturen** (hvilke filer er sider, databaser, vedhaeftninger).
 *  2. **Opret notesboeger** for databaserne - ÉN pr. database (Andreas' krav).
 *  3. **Opret alle noter TOMME**, saa alle Notion-id'er kendes.
 *  4. **Gem filerne** og noter deres nye id'er.
 *  5. **Skriv indholdet** med links omskrevet.
 *
 * Trin 3 foer 5 er hele grunden til, at interne links overlever: en side, der
 * peger paa en side laengere nede i arkivet, kan foerst faa sit link skrevet
 * om, naar den anden side har et id. Uden den opdeling ville hver
 * krydsreference i wikien blive en doed relativ sti.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const zip = require('./zip.js');
const notion = require('./shared/notion.js');

/** Endelse -> mime. Kun til at give en vedhaeftning en rimelig type. */
const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', heic: 'image/heic',
  pdf: 'application/pdf', zip: 'application/zip', json: 'application/json',
  csv: 'text/csv', txt: 'text/plain', svg: 'image/svg+xml',
  mp3: 'audio/mpeg', mp4: 'video/mp4', mov: 'video/quicktime',
};

function opret(srv) {
  /*
   * ÉT job ad gangen, i hukommelsen.
   *
   * Et job er ikke vaerd at gemme i databasen: gaar serveren ned midt i en
   * import, skal den koeres forfra alligevel - og fordi importen er
   * IDEMPOTENT paa Notion-id'et, koster det ingenting at goere.
   */
  let job = null;

  const nu = () => Math.floor(Date.now() / 1000);

  function status() {
    if (!job) return { running: false };
    return {
      running: job.koerer,
      phase: job.fase,
      done: job.gjort,
      total: job.total,
      counts: job.tal,
      skipped: job.springer.slice(0, 100),
      skippedTotal: job.springer.length,
      error: job.fejl || null,
      startedAt: job.start,
      finishedAt: job.slut || null,
      notebooks: job.boeger,
    };
  }

  function afbryd() {
    if (job && job.koerer) { job.stop = true; return true; }
    return false;
  }

  /**
   * Kigger i arkivet UDEN at importere.
   *
   * »Importen kan køres igen uden at lave dubletter« kraever, at man kan se
   * hvad der VILLE ske. Og en forhaandsvisning er den eneste maade at opdage,
   * at man har valgt den forkerte zip, foer 278 noter ligger i arkivet.
   */
  function kig(filSti) {
    const z = zip.aabn(filSti);
    try {
      const s = notion.laesStruktur(z.poster.map((p) => p.navn));
      const aegte = [...s.databaser.values()].filter((d) => !notion.erLinketVisning(d));
      const linkede = [...s.databaser.values()].filter(notion.erLinketVisning);
      const kendte = srv.kendteExtIder();
      const nye = [...s.sider.keys()].filter((id) => !kendte.has(id)).length;
      return {
        pages: s.sider.size,
        databases: aegte.length,
        linkedViews: linkede.length,
        files: s.filer.length,
        unpacked: z.samlet,
        newPages: nye,
        existingPages: s.sider.size - nye,
        notebooks: aegte.map((d) => d.titel).sort(),
        skipped: s.springer,
      };
    } finally {
      zip.luk(z);
    }
  }

  /**
   * Starter importen. Returnerer straks; foelg med i `status()`.
   *
   * `setImmediate` frem for `await`: ruten skal svare med det samme, saa
   * browseren kan begynde at polle - og saa kan Andreas lukke fanen.
   */
  function start(filSti, userId, valg) {
    if (job && job.koerer) return { fejl: 'busy' };
    job = {
      koerer: true,
      stop: false,
      fase: 'reading the archive',
      gjort: 0,
      total: 0,
      tal: { notebooks: 0, pages: 0, files: 0, updated: 0, moved: 0, links: 0, tags: 0 },
      springer: [],
      boeger: [],
      start: nu(),
      slut: null,
      fejl: null,
      userId,
    };
    setImmediate(async () => {
      try {
        await koer(filSti, userId, valg || {});
      } catch (err) {
        job.fejl = err.message;
        srv.logError(`import fejlede: ${err.stack || err.message}`);
      } finally {
        job.koerer = false;
        job.slut = nu();
        job.fase = job.fejl ? 'failed' : 'done';
        // Zip'en er en midlertidig upload. Den skal vaek, uanset udfaldet -
        // 234 MB, der bliver liggende, er en disk, der loeber fuld i stilhed.
        try { fs.unlinkSync(filSti); } catch { /* allerede vaek */ }
      }
    });
    return { ok: true };
  }

  /* ------------------------------------------------------------ selve turen */

  /*
   * Giver serveren luft.
   *
   * Importen er ét langt SYNKRONT stykke arbejde - zip-laesning og
   * databaseskrivning - og Node er enkelttraadet. Uden en pause kan
   * `GET /api/v1/import` slet ikke besvares, mens den koerer: browserens
   * poll bliver haengende, fremdriftsbjaelken staar stille, og »Stop«
   * virker ikke. For brugeren ligner det, at der intet sker.
   *
   * Ét `setImmediate` pr. 25 poster koster naesten intet (maalt paa Andreas'
   * 234 MB-eksport: 2,3 s -> 2,4 s) og goer fremdriften ÆGTE.
   */
  const aand = () => new Promise((ok) => setImmediate(ok));
  const AAND_HVER = 25;

  async function koer(filSti, userId, valg) {
    const z = zip.aabn(filSti);
    try {
      const s = notion.laesStruktur(z.poster.map((p) => p.navn));
      for (const sp of s.springer) job.springer.push(sp);

      const postEfterNavn = new Map(z.poster.map((p) => [notion.normSti(p.navn), p]));
      const aegteDb = [...s.databaser.values()].filter((d) => !notion.erLinketVisning(d));
      for (const d of s.databaser.values()) {
        if (notion.erLinketVisning(d)) {
          // TAEL hvad du springer over, og sig det hoejt. En note, der blev
          // droppet tavst af et filter, blev kun fundet ved at taelle i begge
          // ender (Verdandes spec).
          job.springer.push({
            sti: (d.sti || d.alleSti || '').split('/').pop(),
            hvorfor: 'linked view of a database that lives elsewhere — importing it would duplicate the rows',
          });
        }
      }

      // Siderne taelles TO gange med vilje: de oprettes i trin 2 og faar
      // deres indhold skrevet i trin 4. Taeller man dem én gang, staar
      // bjaelken paa 100 % gennem hele den anden halvdel - og en bjaelke,
      // der lyver, er vaerre end ingen bjaelke.
      job.total = s.sider.size * 2 + aegteDb.length + s.filer.length;

      /* --- 1. notesboeger ------------------------------------------------ */
      job.fase = 'creating notebooks';
      // Én notesbog pr. database (Andreas' krav 21). Sider, der ikke hoerer
      // til en database, samles i én bog, saa de ikke ligger loese.
      const bogEfterDbId = new Map();
      for (const d of aegteDb) {
        if (job.stop) return afsluttet();
        const bog = srv.findEllerOpretNotesbog(userId, d.titel || 'Untitled');
        bogEfterDbId.set(d.id, bog.id);
        job.boeger.push(bog.name);
        job.tal.notebooks++;
        job.gjort++;
      }
      /*
       * Opsamlingsbogen laves FOERST, naar en side faktisk skal ligge i den.
       *
       * Med databaser og topsider som notesboeger er der ofte ingen loese
       * sider tilbage - og saa stod der en tom »Imported from Notion« i
       * sidebaren efter hver import. En bog uden noter er ikke en kategori,
       * det er en rest.
       */
      let importBogId = valg.notebook || null;
      const importBog = () => {
        if (!importBogId) {
          const b = srv.findEllerOpretNotesbog(userId, valg.notebookName || 'Imported from Notion');
          importBogId = b.id;
          job.boeger.push(b.name);
          job.tal.notebooks++;
        }
        return importBogId;
      };

      /* --- 2. alle noter TOMME, saa alle id'er kendes -------------------- */
      job.fase = 'creating pages';
      const noteEfterExtId = new Map();
      // Filnavnets titel er AFKORTET til ~48 tegn; markdown-filens »# Titel«
      // er den fulde. Databasens CSV bruger den fulde, saa forsiden kan kun
      // linke sine raekker, hvis vi husker den rigtige.
      const rigtigTitel = new Map();
      const bogForSide = laegSiderIBoeger(s, aegteDb, bogEfterDbId, userId);

      /*
       * Hvilke sider FLYTTEDE sig ved en genimport.
       *
       * Et saet, ikke en taeller: en side kan baade skifte notesbog og
       * foraelder i samme runde, og den er stadig én side, der flyttede.
       */
      const flyttet = new Set();
      // ... og hvilke sider der fandtes i forvejen. En ny side kan ikke flytte sig.
      const kendteIder = new Set();

      for (const side of s.sider.values()) {
        if (job.stop) return afsluttet();
        if (job.gjort % AAND_HVER === 0) await aand();
        const eksisterende = srv.findNoteMedExtId(userId, side.id);
        if (eksisterende) {
          noteEfterExtId.set(side.id, eksisterende.id);
          kendteIder.add(eksisterende.id);
          job.tal.updated++;
          /*
           * En genimport skal ogsaa rette PLACERINGEN - ikke kun indholdet.
           *
           * Indtil videre var importen kun idempotent paa TEKSTEN: en side,
           * appen allerede kendte, fik sin krop skrevet om, men blev liggende,
           * hvor den laa. Konsekvensen var, at en rettelse i selve
           * struktur-udledningen (F5's mappe-fund) ikke kunne komme et
           * eksisterende arkiv til gode: 290 sider laa i opsamlingsbogen, og
           * den eneste vej ud var at slette alt og importere forfra.
           * Strukturen KOMMER fra eksporten - saa den skal ogsaa hentes derfra
           * anden gang. Det taelles og staar i kvitteringen, saa en flytning
           * aldrig sker i tavshed.
           */
          if (srv.saetNotesbog
              && srv.saetNotesbog(userId, eksisterende.id, bogForSide.get(side.id) || importBog())) {
            flyttet.add(eksisterende.id);
          }
        } else {
          const ny = srv.opretTomNote(userId, {
            title: side.titel || 'Untitled',
            extId: side.id,
            notebookId: bogForSide.get(side.id) || importBog(),
          });
          noteEfterExtId.set(side.id, ny.id);
          job.tal.pages++;
        }
        job.gjort++;
      }

      /*
       * Databasernes forsider oprettes TOMME her - ikke foerst i trin 5.
       *
       * »Alle noter tomme, saa alle id'er kendes« gjaldt kun SIDERNE.
       * Forsiderne blev lavet til sidst, og derfor kendte trin 4 dem ikke:
       * hvert link TIL en database (`[Ordliste](…/Ordliste
       * <hex>.csv)`) kunne ikke slaas op og blev staaende som raa markdown
       * med en filsti i (Andreas, 2026-08-21). Et link til en database peger
       * paa dens forside - saa skal forsiden findes, foer indholdet skrives.
       */
      for (const d of aegteDb) {
        if (job.stop) return afsluttet();
        const eksisterende = srv.findNoteMedExtId(userId, d.id);
        if (eksisterende) {
          noteEfterExtId.set(d.id, eksisterende.id);
          kendteIder.add(eksisterende.id);
          job.tal.updated++;
        } else {
          const ny = srv.opretTomNote(userId, {
            title: d.titel || 'Untitled',
            extId: d.id,
            notebookId: bogEfterDbId.get(d.id),
          });
          noteEfterExtId.set(d.id, ny.id);
          job.tal.pages++;
        }
      }

      // Foraeldre: en side, hvis sti ligger inde i en anden sides mappe, er
      // dens underside. Saettes FOERST nu, hvor begge har et id.
      for (const side of s.sider.values()) {
        let f = findForaelder(side, s);
        /*
         * Er foraelderen selve BOGEN, saa laegges siden i toppen af den.
         *
         * En topside, der blev til en notesbog, er ogsaa en note med samme
         * navn i den bog. Uden det her ville hele wikien ligge under
         * »Haandbog > Haandbog > …« - ét niveau, der ikke siger noget,
         * og som man skal klikke forbi hver gang. I Notions egen sidebar
         * ligger sektionerne direkte under wikien; det goer de nu ogsaa her
         * (Andreas, 2026-08-21).
         *
         * Selve topsiden BLIVER i bogen - den har som regel forsidens tekst.
         */
        if (f && bogForSide.bogSider && bogForSide.bogSider.has(f)) f = null;
        // Ogsaa NULL: en side, eksporten siger ligger i roden, skal LOESRIVES,
        // hvis en tidligere import haengte den under en forkert foraelder.
        // Kaldes den kun naar der ER en foraelder, kan en fejlplacering aldrig
        // rettes - kun tilfoejes.
        const foraelderId = f && noteEfterExtId.has(f) ? noteEfterExtId.get(f) : null;
        const id = noteEfterExtId.get(side.id);
        if (id && srv.saetForaelder(userId, id, foraelderId) && kendteIder.has(id)) flyttet.add(id);
      }
      // Nye sider taeller ikke som »flyttet« - de blev lagt rigtigt med det samme.
      job.tal.moved = flyttet.size;

      /* --- 3. filerne ----------------------------------------------------- */
      job.fase = 'saving files';
      const filEfterSti = new Map();
      for (const f of s.filer) {
        if (job.stop) return afsluttet();
        if (job.gjort % AAND_HVER === 0) await aand();
        const post = postEfterNavn.get(notion.normSti(f.sti));
        if (!post) { job.gjort++; continue; }
        try {
          const data = zip.udpak(z, post);
          const gemt = srv.gemFil(userId, {
            navn: f.navn,
            mime: MIME[f.navn.split('.').pop().toLowerCase()] || 'application/octet-stream',
            data,
          });
          filEfterSti.set(notion.normSti(f.sti), gemt.id);
          job.tal.files++;
        } catch (err) {
          job.springer.push({ sti: f.kort, hvorfor: err.message });
        }
        job.gjort++;
      }

      /* --- 4. indholdet, med links omskrevet ----------------------------- */
      job.fase = 'writing content';
      const opslag = byggOpslag(s, noteEfterExtId, filEfterSti);

      for (const side of s.sider.values()) {
        if (job.stop) return afsluttet();
        job.gjort++;
        if (job.gjort % AAND_HVER === 0) await aand();
        const post = postEfterNavn.get(notion.normSti(side.sti));
        if (!post) continue;
        let raa;
        try {
          raa = zip.udpak(z, post).toString('utf8');
        } catch (err) {
          job.springer.push({ sti: side.kort, hvorfor: err.message });
          continue;
        }
        const titel = skrivSide(userId, side, raa, noteEfterExtId, opslag);
        if (titel) rigtigTitel.set(side.id, titel);
      }

      /* --- 5. databasernes forsider -------------------------------------- */
      job.fase = 'building database pages';
      for (const d of aegteDb) {
        if (job.stop) return afsluttet();
        await aand();
        const post = postEfterNavn.get(notion.normSti(d.alleSti || d.sti));
        if (!post) continue;
        try {
          const csv = notion.laesCsv(zip.udpak(z, post).toString('utf8'));
          byggForside(userId, d, csv, bogEfterDbId.get(d.id), s, noteEfterExtId, rigtigTitel);
        } catch (err) {
          job.springer.push({ sti: (d.alleSti || d.sti).split('/').pop(), hvorfor: err.message });
        }
      }
      return afsluttet();
    } finally {
      zip.luk(z);
    }
  }

  function afsluttet() {
    job.fase = job.stop ? 'stopped' : 'done';
    return true;
  }

  /* ------------------------------------------------------------ hjaelpere */

  /** Hvilken side ligger denne side inde i? Returnerer forael­derens ext-id. */
  function findForaelder(side, s) {
    const mine = side.kort.split('/');
    if (mine.length < 2) return null;
    const foraelderMappe = mine.slice(0, -1).join('/');
    for (const anden of s.sider.values()) {
      if (anden.id === side.id) continue;
      if (anden.mappe === foraelderMappe) return anden.id;
    }
    return null;
  }

  /**
   * Hvilken notesbog hoerer hver side til?
   *
   * To slags notesboeger, og de er begge nogens BESLUTNING i Notion:
   *
   *  1. **En database** - dens raekker er dens sider. Det var Andreas' krav 21.
   *  2. **En side oeverst i eksporten, som HAR undersider.** Det er dét, en
   *     »wiki« er i Notion: en side med et trae under sig. Uden den regel
   *     havnede »Haandbog« med hele sin API-dokumentation i
   *     opsamlingsbogen sammen med alt andet - og saa er sidebaren én stor
   *     bunke i stedet for det, brugeren selv har bygget (Andreas,
   *     2026-08-21).
   *
   * En loes side oeverst uden undersider bliver IKKE en notesbog. En bog med
   * ét blad er ikke en bog; den hoerer i opsamlingen.
   */
  function laegSiderIBoeger(s, aegteDb, bogEfterDbId, userId) {
    const ud = new Map();
    for (const side of s.sider.values()) {
      for (const d of aegteDb) {
        if (side.kort.startsWith(`${d.mappe}/`)) { ud.set(side.id, bogEfterDbId.get(d.id)); break; }
      }
    }

    // Foraelderen for hver side - regnet ÉN gang. `findForaelder` gaar hele
    // sidelisten igennem, og med tusind sider er det tusind gange tusind.
    const far = new Map();
    for (const side of s.sider.values()) far.set(side.id, findForaelder(side, s));

    /** Roden i sidetraeet: den oeverste side, denne ligger under. */
    const rodFor = (id) => {
      let p = id;
      for (let i = 0; i < 64; i++) {
        const f = far.get(p);
        if (!f) return p;
        p = f;
      }
      return p;
    };

    const harBoern = new Set([...far.values()].filter(Boolean));
    // Taell hver bog ÉN gang. Uden saettet ville en bog med tredive sider
    // taelle tredive gange i kvitteringen - et tal, der ser rigtigt ud og
    // betyder noget andet (RUNE-ERFARINGER, doda F3).
    const lavede = new Map();
    for (const side of s.sider.values()) {
      if (ud.has(side.id)) continue;                 // hoerer allerede til en database
      const rod = rodFor(side.id);
      if (!harBoern.has(rod)) continue;              // en enlig side er ikke en bog
      const rodSide = s.sider.get(rod);
      if (!rodSide) continue;
      if (!lavede.has(rod)) {
        const ny = srv.findEllerOpretNotesbog(userId, rodSide.titel || 'Untitled');
        lavede.set(rod, ny);
        job.boeger.push(ny.name);
        job.tal.notebooks++;
      }
      ud.set(side.id, lavede.get(rod).id);
    }
    // Hvilke sider ER selve bogen? Se `bogSider` i koersel: deres boern skal
    // ligge i toppen af bogen, ikke under en note med samme navn som bogen.
    ud.bogSider = new Set(lavede.keys());
    return ud;
  }

  function byggOpslag(s, noteEfterExtId, filEfterSti) {
    const efterSti = new Map();
    for (const side of s.sider.values()) {
      efterSti.set(notion.normSti(side.sti),
        { slags: 'note', id: noteEfterExtId.get(side.id), titel: side.titel });
    }
    for (const d of s.databaser.values()) {
      for (const x of [d.sti, d.alleSti]) {
        // En database er ikke en note; et link til den peger paa dens forside,
        // som vi bygger til sidst. Den faar samme ext-id som databasen.
        if (x) efterSti.set(notion.normSti(x), { slags: 'db', id: d.id, titel: d.titel });
      }
    }
    for (const [sti, id] of filEfterSti) efterSti.set(sti, { slags: 'fil', id });
    return efterSti;
  }

  function skrivSide(userId, side, raa, noteEfterExtId, opslag) {
    const p = notion.laesSide(raa);
    const noteId = noteEfterExtId.get(side.id);
    let krop = notion.asideTilCallout(p.krop);

    krop = notion.omskrivLinks(krop, side.sti, (sti) => {
      const t = opslag.get(sti) || opslag.get(sti.normalize('NFD')) || opslag.get(sti.normalize('NFC'));
      if (!t) return null;
      if (t.slags === 'db') {
        // Et link til en database peger paa dens forside, som bygges til
        // sidst. Den taeller ogsaa med - en kvittering, der udelader en
        // slags, er en kvittering, man ikke kan regne med.
        const dbNote = noteEfterExtId.get(t.id);
        if (!dbNote) return null;
        job.tal.links++;
        return { slags: 'note', id: dbNote, titel: t.titel };
      }
      if (t.slags === 'note' && !t.id) return null;
      job.tal.links++;
      // Den foerste note, der naevner en fil, bliver dens ejer - saa staar
      // den i notens vedhaeftningsrude og ikke kun som en loes fil.
      if (t.slags === 'fil' && srv.knytFilTilNote) srv.knytFilTilNote(userId, t.id, noteId);
      return t;
    });

    const felter = { title: p.titel || side.titel || 'Untitled', body: krop };

    // Egenskaberne. `Tags` bliver til rigtige maerker; resten til note_props,
    // som vises som en egenskabstabel oeverst i noten.
    const props = [];
    const tags = [];
    let created = null;
    let updated = null;
    for (const pr of p.props) {
      const n = pr.key.toLowerCase();
      if (n === 'tags' || n === 'tag') { tags.push(...notion.tolkTags(pr.value)); continue; }
      if (n === 'created' || n === 'created time') { created = notion.tolkDato(pr.value); continue; }
      if (n === 'updated' || n === 'last edited time') { updated = notion.tolkDato(pr.value); continue; }
      if (pr.value) props.push(pr);
    }

    srv.skrivImporteretNote(userId, noteId, felter, props, tags, { created, updated });
    if (tags.length) job.tal.tags += tags.length;
    return felter.title;
  }

  /**
   * Databasens forside: en note med en sorterbar tabel over raekkerne.
   *
   * »Databasens forside genereres som en note med en sorterbar tabel over
   * raekkerne. Det er præcis det, Andreas bad om« (SAGU-PLAN F5).
   */
  function byggForside(userId, d, csv, bogId, s, noteEfterExtId, rigtigTitel) {
    if (!csv.length) return;
    const hoved = csv[0];
    const raekker = csv.slice(1);

    // Foerste kolonne er titlen. De sider, der ligger i databasens mappe, er
    // dens raekker - saa titlen kan blive et LINK til den rigtige note.
    const raekkeSider = [...s.sider.values()].filter((x) => d.mappe && x.kort.startsWith(`${d.mappe}/`));
    const sideEfterTitel = new Map();
    for (const side of raekkeSider) {
      // Den RIGTIGE titel foerst - filnavnets er afkortet. Dubletter findes
      // (12 i Andreas' eksport, én titel seks gange); den foerste vinder, og
      // det er bedre end at lade vaere at linke.
      const n = String(rigtigTitel.get(side.id) || side.titel || '').toLowerCase().trim();
      if (n && !sideEfterTitel.has(n)) sideEfterTitel.set(n, noteEfterExtId.get(side.id));
    }

    /*
     * Slaa en CSV-raekke op paa dens titel.
     *
     * Foerst noejagtigt. Ellers paa PRAEFIKS: filnavnet er afkortet til ~48
     * tegn, saa en raekke, hvis side aldrig blev skrevet (fx fordi den ligger
     * i en anden del af eksporten), kan stadig findes paa sin begyndelse.
     */
    const slaaOp = (raa) => {
      const t = String(raa || '').toLowerCase().trim();
      if (!t) return null;
      if (sideEfterTitel.has(t)) return sideEfterTitel.get(t);
      for (const side of raekkeSider) {
        const kort = String(side.titel || '').toLowerCase().trim();
        if (kort.length > 12 && t.startsWith(kort)) return noteEfterExtId.get(side.id);
      }
      return null;
    };

    const celle = (v) => String(v || '').replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim();
    const linjer = [
      `| ${hoved.map(celle).join(' | ')} |`,
      `|${' --- |'.repeat(hoved.length)}`,
    ];
    let linket = 0;
    for (const r of raekker) {
      const c = hoved.map((_, i) => celle(r[i]));
      const maal = slaaOp(r[0]);
      if (maal) { c[0] = `[${c[0] || 'Untitled'}](sagu-note:${maal})`; linket++; }
      linjer.push(`| ${c.join(' | ')} |`);
    }

    const krop = [
      `> [!NOTE]`,
      `> ${raekker.length} rows imported from a Notion database.`
      + ` ${linket} of them are pages you can open.`,
      '',
      linjer.join('\n'),
    ].join('\n');

    // Forsiden er oprettet i trin 2b - her fyldes den bare. Taelleren er
    // ogsaa gjort dér; ellers ville den samme side taelle to gange.
    const noteId = noteEfterExtId.get(d.id);
    if (!noteId) return;
    srv.skrivImporteretNote(userId, noteId, { title: d.titel || 'Untitled', body: krop }, [], [], {});
  }

  return { start, status, afbryd, kig };
}

module.exports = { opret, MIME };
