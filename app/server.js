'use strict';
/*
 * Sagu - noteapp og wiki. Erstatter notion.so.
 *
 * Ren Node: node:http + node:sqlite + node:crypto + node:zlib. Ingen npm-pakker.
 * Det er ikke sparsommelighed - det er sikkerhedsvalget: uden afhaengigheder
 * findes der ingen transitiv forsyningskaede at holde patchet.
 *
 * Sagu er FLERBRUGER (modsat doda, som er én-brugers). Konsekvensen staar i
 * CLAUDE.md og gennemsyrer hele denne fil: user_id-filteret bor i dataadgangen
 * selv - hentNote/hentNoter/gemNote/sletNote - aldrig i kaldstederne. Admin er
 * ingen undtagelse.
 */

// Tidszonen SKAL saettes foer den foerste Date bruges - ellers regner
// containeren i UTC, og "i dag" bliver forkert nogle timer i doegnet.
process.env.TZ = process.env.TZ || 'Europe/Copenhagen';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const webauthn = require('./webauthn.js');
// SAMME renderer som browseren. Wikien (F6) er server-renderet, saa den maa
// ikke kunne komme ud af trit med det, brugeren saa, da han skrev noten.
const markdown = require('./shared/markdown.js');
// Samme soegesyntaks i browseren, i serveren og senere i wikien.
const soeg = require('./shared/soeg.js');
const maerker = require('./shared/maerker.js');
const importModul = require('./import.js');
const wikiModul = require('./wiki.js');
const dodaModul = require('./doda.js');
/*
 * TOTP og QR er kopieret RAAT fra doda og har ingen kobling til nogen af de
 * to apps: `totp.js` kraever kun `node:crypto`, `qr.js` kraever intet
 * (RUNE-ERFARINGER §9d). Kun udstedernavnet i `otpauth()` er skiftet.
 */
const totp = require('./totp.js');
const qr = require('./qr.js');
const ghShared = require('./shared/github.js');
const zipmod = require('./zip.js');

const DATA_DIR = process.env.DATA_DIR || process.cwd();
// KUN BIND_PORT, aldrig PORT_<navn>.
//
// Panelet injicerer PORT_web og SAGU_PORT med den HOST-port, den har allokeret
// (25000-30000) - ikke container-porten. Container-siden er den konstant,
// runen selv erklaerer i ports.default, altsaa 3000. Binder appen sig til
// host-porten inde i containeren, peger panelets mapping paa 3000, hvor der
// ikke lytter noget, og serveren er utilgaengelig UDEN at noget fejler
// hoejlydt (RUNE-ERFARINGER, doda v3).
const BIND_PORT = Number(process.env.BIND_PORT || 3000);
const APP_NAME = process.env.APP_NAME || 'Sagu';
// Under udvikling staar APP_VERSION stille (den bumpes foerst ved udgivelse),
// men de statiske filer serveres "immutable" - saa koerer browseren glad den
// gamle app.js videre, og man fejlsoeger kode, der ikke er indlaest.
const DEV = process.env.SAGU_DEV === '1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_COOKIE = 'sagu_session';
const SESSION_DAYS = 90;

/* ---------------------------------------------------------------- database */

const db = new DatabaseSync(path.join(DATA_DIR, 'sagu.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

// Skema-trin. Tilfoej ALDRIG til et eksisterende trin efter udgivelse -
// laeg en ny funktion i enden af listen i stedet.
const MIGRATIONS = [
  function m1(d) {
    /*
     * Brugerlaget. Forskellen fra doda staar i tre kolonner, og de tre kan
     * ikke eftermonteres (RUNE-ERFARINGER, tovo F0):
     *
     *  - users.is_admin      hvem maa aendre INSTALLATIONEN (ikke hvem der ser hvad)
     *  - settings(scope,key) scope er brugerens id, eller '*' for installationen
     *  - tokens.user_id      uden den rammer enhver noegle "foerste bruger i
     *                        tabellen", og isolationen er en illusion, der ser
     *                        rigtig ud i alle tests med kun én konto
     */
    d.exec(`
      CREATE TABLE users (
        id           TEXT PRIMARY KEY,
        username     TEXT NOT NULL UNIQUE,
        password     TEXT NOT NULL,
        is_admin     INTEGER NOT NULL DEFAULT 0,
        created_at   INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX users_navn ON users(lower(username));

      CREATE TABLE sessions (
        token      TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX sessions_expires ON sessions(expires_at);

      CREATE TABLE settings (
        scope TEXT NOT NULL,
        key   TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (scope, key)
      );

      CREATE TABLE tokens (
        id           TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name         TEXT NOT NULL,
        hash         TEXT NOT NULL UNIQUE,
        prefix       TEXT NOT NULL,
        scope        TEXT NOT NULL DEFAULT 'full',
        client_id    TEXT,
        created_at   INTEGER NOT NULL,
        last_used_at INTEGER,
        expires_at   INTEGER,
        revoked_at   INTEGER
      );
      CREATE INDEX tokens_hash ON tokens(hash) WHERE revoked_at IS NULL;

      CREATE TABLE credentials (
        id         TEXT PRIMARY KEY,          -- credentialId, base64url
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name       TEXT NOT NULL DEFAULT '',
        public_key TEXT NOT NULL,             -- SPKI PEM
        alg        TEXT NOT NULL,
        sign_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER
      );
      CREATE INDEX credentials_bruger ON credentials(user_id);

      -- Rate-limit hoerer i databasen, ikke i memory: en in-memory-taeller
      -- nulstilles ved hver genstart, og panelets auto-opdatering genstarter
      -- kl. 04 (RUNE-ERFARINGER, doda F0).
      CREATE TABLE rate (
        bucket   TEXT PRIMARY KEY,
        count    INTEGER NOT NULL,
        reset_at INTEGER NOT NULL
      );

      CREATE TABLE audit (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        at      INTEGER NOT NULL,
        event   TEXT NOT NULL,
        actor   TEXT,
        subject TEXT,
        detail  TEXT
      );
      CREATE INDEX audit_at ON audit(at DESC);
    `);
  },

  function m2(d) {
    /*
     * Notekernen.
     *
     * Alt der FILTRERES paa faar en rigtig kolonne med indeks; kun det bloede
     * indhold ligger som tekst i body_md. Grunden er RUNE-ERFARINGER §4:
     * lister og endepunkter uden login maa aldrig scanne datasaettet.
     *
     * body_md maa ALDRIG komme med i et listesvar (CLAUDE.md). Kokkeris
     * login-svar paa 247,9 MB kom af netop den slags.
     */
    d.exec(`
      CREATE TABLE notebooks (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        icon       TEXT NOT NULL DEFAULT '',
        seq        INTEGER NOT NULL DEFAULT 0,
        -- Tidsstempler, ikke flag. "Hvornaar blev det lagt vaek" svarer paa
        -- spoergsmaal, et flueben ikke kan, og det koster den samme byte.
        -- Og ÉT felt pr. faktum: et deleted-flueben ved siden af deleted_at
        -- er to beskrivelser af det samme, som kan blive uenige.
        -- (NB: ingen backticks i en SQL-kommentar herinde - blokken er en
        -- JS template literal, og en backtick lukker den.)
        archived_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      );
      CREATE INDEX notebooks_bruger ON notebooks(user_id) WHERE deleted_at IS NULL;

      CREATE TABLE notes (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        notebook_id TEXT REFERENCES notebooks(id) ON DELETE SET NULL,
        parent_id   TEXT REFERENCES notes(id) ON DELETE SET NULL,
        title       TEXT NOT NULL DEFAULT '',
        body_md     TEXT NOT NULL DEFAULT '',
        icon        TEXT NOT NULL DEFAULT '',
        seq         INTEGER NOT NULL DEFAULT 0,
        full_width  INTEGER NOT NULL DEFAULT 0,
        -- Notions eksport-id. Noeglen der genopretter interne links ved
        -- genimport, og det der goer importen idempotent (F5).
        ext_id      TEXT,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL,
        updated_by  TEXT,
        -- Arkiv og papirkurv er TO forskellige ting: papirkurven siger "det
        -- var en fejl, og om 30 dage er den vaek", arkivet siger "det er
        -- faerdigt, og jeg vil ikke laese forbi det". Begge er nullable
        -- tidsstempler frem for flag - se notebooks ovenfor.
        archived_at INTEGER,
        deleted_at  INTEGER
      );
      CREATE INDEX notes_bruger ON notes(user_id) WHERE deleted_at IS NULL;
      CREATE INDEX notes_papirkurv ON notes(user_id, deleted_at) WHERE deleted_at IS NOT NULL;
      CREATE INDEX notes_notesbog ON notes(notebook_id) WHERE deleted_at IS NULL;
      CREATE INDEX notes_foraelder ON notes(parent_id) WHERE deleted_at IS NULL;
      CREATE INDEX notes_aendret ON notes(user_id, updated_at);
      -- Genimport slaar op paa Notion-id'et; uden indekset er det en scanning.
      CREATE INDEX notes_ext ON notes(user_id, ext_id) WHERE ext_id IS NOT NULL;

      -- Notion-databasernes kolonner. Én raekke pr. egenskab pr. note.
      CREATE TABLE note_props (
        note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        key     TEXT NOT NULL,
        value   TEXT NOT NULL DEFAULT '',
        seq     INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (note_id, key)
      );

      CREATE TABLE tags (
        id      TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name    TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      -- Unikt pr. BRUGER paa lower(name): to brugere maa gerne have hver sit
      -- "drift", og de er ikke det samme maerke.
      CREATE UNIQUE INDEX tags_navn ON tags(user_id, lower(name));

      CREATE TABLE note_tags (
        note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        tag_id  TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (note_id, tag_id)
      );
      CREATE INDEX note_tags_maerke ON note_tags(tag_id);

      -- Udledt ved hvert gem. Bagsiden er backlinks-panelet (F3).
      CREATE TABLE note_links (
        from_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        to_id   TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        PRIMARY KEY (from_id, to_id)
      );
      CREATE INDEX note_links_til ON note_links(to_id);

      -- Skrives fra dag ét, uden UI (F1). En wiki uden fortrydelse er farlig,
      -- og historikken er billig, naar markdown er sandheden.
      CREATE TABLE note_versions (
        id      TEXT PRIMARY KEY,
        note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        title   TEXT NOT NULL DEFAULT '',
        body_md TEXT NOT NULL DEFAULT '',
        at      INTEGER NOT NULL,
        user_id TEXT
      );
      CREATE INDEX note_versions_note ON note_versions(note_id, at DESC);

      /*
       * Deling mellem brugere. UI'et kommer foerst i F11, men tabellen skal
       * ligge her: et adgangslag kan ikke eftermonteres, og isolationstesten
       * koeres i HVER fase - ogsaa mens der kun findes én bruger.
       *
       * note_acl gaelder ogsaa admin (CLAUDE.md). At vaere administrator
       * betyder at maatte aendre installationen, ikke at maatte laese
       * andres noter.
       */
      CREATE TABLE note_acl (
        note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        level   TEXT NOT NULL DEFAULT 'read',      -- read | write
        created_at INTEGER NOT NULL,
        PRIMARY KEY (note_id, user_id)
      );
      CREATE INDEX note_acl_bruger ON note_acl(user_id);
    `);
  },

  function m3(d) {
    /*
     * Soegningen. FTS5 er MAALT tilgaengelig i Node 22, 24 og 26 (DESIGN.md
     * maaling 2), saa der er ingen grund til en egen tokentabel ved siden af.
     *
     * Tabellen er "external content"-fri med vilje: den holder sin egen kopi
     * af teksten. Det koster plads, men sparer et join pr. traeffer, og
     * saa kan indekset genopbygges uden at roere notes-tabellen.
     *
     * Kolonnerne er de fire, wikiens soegning vaegter i den raekkefoelge
     * (SAGU-PLAN §5): titel, overskrifter, brødtekst, maerker+egenskaber.
     * user_id staar med som UINDEKSERET kolonne - den skal filtreres paa,
     * ikke soeges i.
     *
     * `folded` er den femte, og den findes af en maalt grund:
     * **`remove_diacritics 2` folder Å, men IKKE ø og æ.** Unicode regner de
     * to som selvstaendige bogstaver, ikke som accenttegn. Maalt:
     *   Åbningstider  <- "abningstider"   JA
     *   grøn          <- "gron"           NEJ
     *   bæredygtighed <- "baredygtighed"  NEJ
     * Uden kolonnen kan en dansker paa et fremmed tastatur ikke finde sine
     * egne noter. Se foldDansk().
     */
    d.exec(`
      CREATE VIRTUAL TABLE note_fts USING fts5(
        title, headings, body, meta, folded,
        note_id UNINDEXED,
        user_id UNINDEXED,
        tokenize = "unicode61 remove_diacritics 2"
      );

      -- Hvad folk soegte efter uden at finde noget. Kun ordet, aldrig hvem
      -- (SAGU-PLAN §5). Den bedste indholdsplan en wiki kan faa.
      CREATE TABLE search_miss (
        term  TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT '',
        at    INTEGER NOT NULL
      );
      CREATE INDEX search_miss_tid ON search_miss(at DESC);
    `);
  },

  function m4(d) {
    /*
     * Hvilken sletning tog denne note med sig.
     *
     * Sletter man en note med undersider, skal undersiderne med - ellers
     * staar de tilbage som foraeldreloese. Men en GENDANNELSE maa kun vaekke
     * praecis dem, kaskaden tog: en underside, brugeren selv slettede i
     * forrige uge, skal blive liggende (RUNE-ERFARINGER, doda F3).
     *
     * NULL = slettet enkeltvis. Ellers id'et paa roden af den sletning.
     */
    d.exec('ALTER TABLE notes ADD COLUMN deleted_root TEXT');
  },

  function m5(d) {
    /*
     * Vedhaeftninger. Filerne ligger paa DISK i /data/files, ikke i databasen:
     * backup streamer dem i stedet for at laese dem i hukommelsen, og
     * databasen forbliver lille nok til at kunne kopieres.
     *
     * Og indholdet kommer ALDRIG i naerheden af det, listerne henter -
     * Kokkeri ramte et login-svar paa 247,9 MB, fordi billeder laa i de
     * poster, listen hentede (RUNE-ERFARINGER §4).
     */
    d.exec(`
      CREATE TABLE attachments (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        note_id    TEXT REFERENCES notes(id) ON DELETE SET NULL,
        name       TEXT NOT NULL,
        mime       TEXT NOT NULL,
        size       INTEGER NOT NULL,
        sha        TEXT NOT NULL,
        width      INTEGER,
        height     INTEGER,
        created_at INTEGER NOT NULL,
        deleted_at INTEGER
      );
      CREATE INDEX attachments_note ON attachments(note_id) WHERE deleted_at IS NULL;
      CREATE INDEX attachments_bruger ON attachments(user_id) WHERE deleted_at IS NULL;
    `);
  },

  function m6(d) {
    /*
     * Udgivelser (F6) - den offentlige wiki.
     *
     * Kollegaerne har INGEN konti, saa en udgivelse er offentlig som
     * udgangspunkt. Kodeordet er en KONTAKT paa en eksisterende udgivelse:
     * `password_hash` saettes eller ryddes, og hverken `slug` eller `token`
     * roeres. Slaar Andreas kodeord til i morgen, virker det link, kollegaerne
     * har i deres bogmaerker, stadig - de bliver bare moedt af en
     * kodeordsside. En udgivelse, der skifter adresse naar den beskyttes, er
     * ubrugelig (CLAUDE.md).
     *
     * To adresser til den samme udgivelse med vilje: `slug` er den paene
     * (/w/handbook), `token` den uforudsigelige (/s/<64 hex>) til det, der
     * ikke skal kunne gaettes. Begge slaas op paa et INDEKS - en offentlig
     * rute maa aldrig scanne datasaettet.
     */
    d.exec(`
      CREATE TABLE shares (
        id             TEXT PRIMARY KEY,
        user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        note_id        TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        mode           TEXT NOT NULL DEFAULT 'tree',   -- single | tree
        slug           TEXT,
        token          TEXT NOT NULL UNIQUE,
        password_hash  TEXT,
        allow_comments INTEGER NOT NULL DEFAULT 0,     -- F7
        allow_search   INTEGER NOT NULL DEFAULT 1,
        -- Fravaer betyder NEJ: en side, ingen har taget stilling til, skal
        -- ikke kunne findes i en soegemaskine.
        allow_index    INTEGER NOT NULL DEFAULT 0,
        expires_at     INTEGER,
        views          INTEGER NOT NULL DEFAULT 0,
        created_at     INTEGER NOT NULL,
        revoked_at     INTEGER
      );
      -- Slug'en er GLOBALT unik: adresserummet er ét. lower(), saa /w/Handbook
      -- og /w/handbook ikke kan vaere to forskellige wikier.
      CREATE UNIQUE INDEX shares_slug ON shares(lower(slug))
        WHERE slug IS NOT NULL AND revoked_at IS NULL;
      CREATE INDEX shares_token ON shares(token) WHERE revoked_at IS NULL;
      CREATE INDEX shares_note ON shares(note_id) WHERE revoked_at IS NULL;

      -- Kun TAL, aldrig personer. »Hvad bruges der faktisk« er den eneste
      -- maade at holde en wiki fri for sider, ingen laeser.
      CREATE TABLE share_views (
        share_id TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
        note_id  TEXT NOT NULL,
        n        INTEGER NOT NULL DEFAULT 0,
        sidst    INTEGER,
        PRIMARY KEY (share_id, note_id)
      );
    `);
  },

  function m7(d) {
    /*
     * En udgivelse kan ogsaa vaere en hel NOTESBOG (Andreas, 2026-08-21).
     *
     * »Udgiv en hovedside plus dens undersider« daekkede ikke det, et
     * importeret Notion-arkiv faktisk ER: en notesbog med sider i. Man kunne
     * markere en note og dele den, men ikke bogen - og saa maatte man lave en
     * kunstig forside for at kunne dele det, der allerede var en samling.
     *
     * `note_id` bliver derfor NULLABLE, og præcis ÉN af de to skal vaere sat.
     * SQLite kan ikke aendre en kolonnes NOT NULL, saa tabellen bygges om -
     * med raekkerne flyttet med, saa et link, nogen allerede har faaet, lever
     * videre.
     */
    d.exec(`
      CREATE TABLE shares_ny (
        id             TEXT PRIMARY KEY,
        user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        note_id        TEXT REFERENCES notes(id) ON DELETE CASCADE,
        notebook_id    TEXT REFERENCES notebooks(id) ON DELETE CASCADE,
        mode           TEXT NOT NULL DEFAULT 'tree',
        slug           TEXT,
        token          TEXT NOT NULL UNIQUE,
        password_hash  TEXT,
        allow_comments INTEGER NOT NULL DEFAULT 0,
        allow_search   INTEGER NOT NULL DEFAULT 1,
        allow_index    INTEGER NOT NULL DEFAULT 0,
        expires_at     INTEGER,
        views          INTEGER NOT NULL DEFAULT 0,
        created_at     INTEGER NOT NULL,
        revoked_at     INTEGER,
        -- Enten en note eller en notesbog. Aldrig begge, aldrig ingen: en
        -- udgivelse, der ikke peger nogen steder hen, er en 404 med en raekke
        -- bag sig.
        CHECK ((note_id IS NULL) <> (notebook_id IS NULL))
      );
      INSERT INTO shares_ny (id, user_id, note_id, notebook_id, mode, slug, token,
                             password_hash, allow_comments, allow_search, allow_index,
                             expires_at, views, created_at, revoked_at)
        SELECT id, user_id, note_id, NULL, mode, slug, token,
               password_hash, allow_comments, allow_search, allow_index,
               expires_at, views, created_at, revoked_at FROM shares;
      DROP TABLE shares;
      ALTER TABLE shares_ny RENAME TO shares;
      CREATE UNIQUE INDEX shares_slug ON shares(lower(slug))
        WHERE slug IS NOT NULL AND revoked_at IS NULL;
      CREATE INDEX shares_token ON shares(token) WHERE revoked_at IS NULL;
      CREATE INDEX shares_note ON shares(note_id) WHERE revoked_at IS NULL;
      CREATE INDEX shares_bog ON shares(notebook_id) WHERE revoked_at IS NULL;
    `);
  },

  function m8(d) {
    /*
     * F7 - kommentarer. I appen OG paa de offentlige sider.
     *
     * Tre valg i skemaet, som er svaere at lave om bagefter:
     *
     *  - **`origin` ved siden af `share_id`.** Fristelsen er at lade
     *    `share_id IS NULL` betyde »skrevet i appen«. Men `ON DELETE SET NULL`
     *    aendrer en VAERDI frem for at fjerne en raekke, og saa er sporet
     *    vaek: tilbagekaldes udgivelsen, ville en gaestekommentar pludselig
     *    ligne ejerens egen (Sagu F3's lektie om `SET NULL`). `origin` siger
     *    hvor den kom fra, uanset hvad der siden sker med udgivelsen.
     *  - **`status` er en tilstand, ikke et flag.** `pending` (i koeen),
     *    `published` (synlig) og `rejected` (afvist, men bevaret). En afvist
     *    kommentar slettes ikke: den skal kunne fortrydes, og et arkiv, der
     *    taber det, nogen skrev, er ikke et arkiv.
     *  - **`kind`** skiller en kommentar fra et RETTELSESFORSLAG. Samme
     *    tabel, samme moderationskoe, samme sikkerhedsregler - men de to
     *    betyder noget forskelligt for den, der laeser dem (SAGU-PLAN §5).
     *
     * Traaden er ÉT niveau. Notion goer det samme, og en dyb traad i en
     * moderationskoe er ulaeselig. `svar_paa` peger derfor altid paa en
     * top-kommentar; serveren flader et svar paa et svar ud, saa der ikke kan
     * opstaa en kaede - og dermed heller ingen ring at vaerne imod.
     */
    d.exec(`
      CREATE TABLE comments (
        id         TEXT PRIMARY KEY,
        note_id    TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        parent_id  TEXT REFERENCES comments(id) ON DELETE CASCADE,
        user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
        share_id   TEXT REFERENCES shares(id) ON DELETE SET NULL,
        origin     TEXT NOT NULL DEFAULT 'app',      -- app | public
        author     TEXT NOT NULL DEFAULT '',         -- gaestens eget navn
        kind       TEXT NOT NULL DEFAULT 'comment',  -- comment | suggestion
        status     TEXT NOT NULL DEFAULT 'published',-- pending | published | rejected
        body       TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        -- Hvornaar teksten sidst blev RETTET - ikke et flag, og ikke udledt af
        -- at updated_at > created_at: begge staar i sekunder, saa en
        -- rettelse i samme sekund ville vaere usynlig. Det er den samme regel
        -- som archived_at og deleted_at (DESIGN.md §4).
        edited_at  INTEGER,
        deleted_at INTEGER
      );
      CREATE INDEX comments_note ON comments(note_id, created_at) WHERE deleted_at IS NULL;
      CREATE INDEX comments_koe ON comments(status) WHERE deleted_at IS NULL AND status = 'pending';

      -- Moderation er TIL som standard: en offentlig kommentarfunktion uden
      -- koe er en spam-kanal med ejerens navn paa (SAGU-PLAN §6, R6).
      ALTER TABLE shares ADD COLUMN moderate_comments INTEGER NOT NULL DEFAULT 1;
    `);
  },

  function m9(d) {
    /*
     * F8 - opgaverne, en note har sendt til doda.
     *
     * Tabellen findes af ÉN grund: **der maa aldrig gaa et kald til doda pr.
     * optegning.** Rundturen er maalt til 140-190 ms gennem tunnelen, og en
     * note med fem opgaver ville vaere naesten et sekund, hvor der ikke sker
     * noget (RUNE-ERFARINGER, doda v27). Status laeses derfor herfra, og
     * opfriskes hoejst én gang i kvarteret med ét kald til /changes.
     *
     * `doda_id` er dodas noegle, `id` er Sagus egen - to arkiver, to
     * id-rum, og de maa ikke blandes sammen. Titlen gemmes ved siden af,
     * saa raekken kan vises, ogsaa naar doda ikke svarer: en bro, der bliver
     * TOM naar den anden ende er nede, ligner en bro, der har mistet noget.
     */
    d.exec(`
      CREATE TABLE doda_tasks (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        note_id    TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        doda_id    TEXT NOT NULL,
        title      TEXT NOT NULL DEFAULT '',
        status     TEXT NOT NULL DEFAULT 'open',
        line       INTEGER,          -- tjekliste-linjen, den kom fra
        created_at INTEGER NOT NULL,
        checked_at INTEGER            -- hvornaar status sidst blev opfrisket
      );
      CREATE INDEX doda_tasks_note ON doda_tasks(note_id);
      CREATE UNIQUE INDEX doda_tasks_id ON doda_tasks(user_id, doda_id);
    `);
  },

  function m10(d) {
    /*
     * F10 - claude.ai's connector.
     *
     * Claude Code og Desktop kan sende en fast noegle i en header. Webklienten
     * kan ikke: den kender ikke serveren paa forhaand, saa den skal kunne
     * registrere sig selv (RFC 7591) og sende brugeren gennem et login.
     *
     * **Access-tokens har ingen tabel her.** De gaar gennem `opretToken` og
     * ender i `tokens` med et `client_id` og et `expires_at` - de to
     * kolonner blev lagt ind allerede i m1 til netop det. Saa er der ÉN vej
     * ind i API'et, og `findToken` er det ene sted, en noegle kan vise sig
     * ugyldig. To tabeller ville betyde to steder at huske et tilbagekald.
     *
     * `oauth_refresh` er derimod sin egen: et refresh-token er ikke en
     * adgangsnoegle, kan ikke bruges paa API'et, og roterer - den gamle doer,
     * naar den nye fodes, saa en stjaalet kopi kun virker én gang.
     *
     * Klienten er IKKE bundet til en bruger. Den samme claude.ai registrerer
     * sig for hver bruger, der forbinder; det er `tokens.user_id` og
     * `oauth_refresh.user_id`, der siger, hvis data der naas. Sagu er
     * flerbruger, og en klientraekke er kun et navn og en adresseliste.
     */
    d.exec(`
      CREATE TABLE oauth_clients (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        redirect_uris TEXT NOT NULL,     -- JSON-liste, matches NOEJAGTIGT
        created_at    INTEGER NOT NULL
      );

      CREATE TABLE oauth_refresh (
        hash       TEXT PRIMARY KEY,     -- sha256, aldrig klartekst
        token_id   TEXT NOT NULL,
        client_id  TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
        scope      TEXT NOT NULL,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        revoked_at INTEGER
      );
      CREATE INDEX oauth_refresh_klient ON oauth_refresh(client_id) WHERE revoked_at IS NULL;
      CREATE INDEX oauth_refresh_bruger ON oauth_refresh(user_id) WHERE revoked_at IS NULL;
    `);
  },

  function m11(d) {
    /*
     * F11 - deling mellem brugere.
     *
     * Tabellen har ligget her siden m1; det, der mangler, er ÉT felt: deles
     * en side, deles det, der ligger UNDER den. Det er sadan et arkiv
     * bruges - man deler »Drift«, ikke sytten sider én ad gangen - og det er
     * samme forudsaetning, en udgivelse staar paa (`mode = 'tree'`).
     *
     * `tree = 0` findes for den ene side, man vil dele uden sine noter under.
     *
     * **Arven regnes af det LEVENDE trae, ikke af raekker.** Alternativet var
     * at skrive en ACL-raekke pr. underside, og saa skulle den holdes i takt,
     * hver gang nogen laver en underside, flytter en ind eller flytter en ud.
     * En udledt tabel, der skal vedligeholdes tre steder, driver fra det, den
     * er udledt af - og en adgangsfejl af den slags er tavs: den ser rigtig
     * ud, lige til den ikke er det. Prisen er malt (DESIGN.md maaling 5).
     */
    d.exec("ALTER TABLE note_acl ADD COLUMN tree INTEGER NOT NULL DEFAULT 1");
  },

  function m12(d) {
    /*
     * Soegeindekset havde en `user_id` - og efter F11 laeste INGEN den.
     *
     * Den var afgraensningen paa den rangerede soegning, indtil deling kom
     * til: indekset baerer EJERENS id, saa den linje kunne aldrig finde en
     * note, nogen havde delt med mig - mens noedbremsen (LIKE paa teksten)
     * godt kunne. Filteret maatte derfor vaek, og `SYNLIG` overtog, hvor den
     * hoerer hjemme.
     *
     * Tilbage stod en kolonne, der HED `user_id` i et soegeindeks uden at
     * afgraense noget. Det er den farligste slags rest: den naeste, der laeser
     * skemaet, vil tro, at indekset er pr. bruger, og bygge videre paa en
     * spaerring, der ikke findes. Fundet ved at sabotere dens vedligeholdelse
     * og faa **nul roede tests** - og en sabotage uden roede betyder, at der
     * mangler en test ELLER at det, man saboterede, ikke betyder noget.
     *
     * Kolonnen fjernes derfor, og en formregel holder den vaek. Prisen er én
     * genopbygning af indekset ved opgraderingen.
     */
    d.exec(`
      DROP TABLE note_fts;
      CREATE VIRTUAL TABLE note_fts USING fts5(
        title, headings, body, meta, folded,
        note_id UNINDEXED,
        tokenize = "unicode61 remove_diacritics 2"
      );
    `);
    // Indholdet skrives igen ved opstart - se kaldet til genopbygIndeks().
  },

  function m13(d) {
    /*
     * F12 - det, GitHub har svaret.
     *
     * Tabellen findes af ÉN grund, den samme som `doda_tasks`: **der maa ikke
     * gaa et kald pr. optegning.** En note med fem indlejringer ville ellers
     * blive fem rundture, hver gang siden tegnes - og paa wikien kan en
     * fremmed genindlaese saa tit han vil. Uden cachen ville en delt side
     * vaere en maade at bruge Andreas' GitHub-kvote op paa.
     *
     * `noegle` baerer sha'en for en frossen fil, saa den raekke kan staa for
     * evigt: indholdet kan ikke laves om. En sag eller en gren har ingen sha
     * i noeglen og faar et udloeb plus `etag`, saa en genopfriskning kan
     * svare 304 - som hverken koster kvote eller baandbredde.
     *
     * **Ingen user_id.** Indholdet er det samme, uanset hvem der spurgte, og
     * en cache pr. bruger ville hente det samme fem gange. Adgangen ligger
     * ikke her: den ligger i, om man kan naa den NOTE, adressen staar i - og
     * i, at et privat repo kun kan hentes af den, hvis token kan se det.
     * Sammenlign m12: en `user_id` i en tabel, der ikke afgraenser, lyder som
     * en spaerring uden at vaere en.
     */
    d.exec(`
      CREATE TABLE github_cache (
        noegle    TEXT PRIMARY KEY,
        data      TEXT NOT NULL,
        etag      TEXT NOT NULL DEFAULT '',
        hentet_at INTEGER NOT NULL
      );
      CREATE INDEX github_cache_tid ON github_cache(hentet_at);
    `);
  },

  function m14(d) {
    /*
     * F13 - favoritter og »senest besoegte«.
     *
     * ── note_visits.seq er et LOEBENUMMER, og `at` er til at VISE ─────────
     *
     * Foerste udgave sorterede paa tidsstemplet, og to noter aabnet i samme
     * sekund gav uafgjort: raekkefoelgen blev vilkaarlig, og »senest
     * besoegte« viste den forkerte oeverst. Det er samme faelde, som
     * `naesteSeq` allerede findes for - et tidsstempel i en sorteringskolonne
     * SER rigtigt ud, fordi tidsstempler sorterer kronologisk, lige indtil to
     * ting sker inden for samme oploesning.
     *
     * Fundet af en test, der aabnede to noter efter hinanden. Med et menneske
     * ved tastaturet ville den have virket hver gang.
     *
     * Begge er **pr. BRUGER, ikke pr. note** - og det er ikke en detalje.
     * Sagu er flerbruger, og en note kan vaere delt: et flag paa noten ville
     * betyde, at min stjerne dukkede op hos kollegaen, og at hans besoeg
     * skubbede min egen liste rundt. »Senest besoegte« er per definition
     * mit eget spor.
     *
     * `note_visits` har ÉN raekke pr. (bruger, note) - ikke én pr. besoeg.
     * En logbog ville vokse uden graenser og skulle ryddes; det her er en
     * liste over hvor jeg var, og den skal kun kunne svare paa »hvad aabnede
     * jeg sidst«. Prisen er, at man ikke kan taelle besoeg - og det er der
     * heller ingen, der skal.
     */
    d.exec(`
      CREATE TABLE favorites (
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        note_id    TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        seq        INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, note_id)
      );
      CREATE INDEX favorites_bruger ON favorites(user_id, seq);

      CREATE TABLE note_visits (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        seq     INTEGER NOT NULL DEFAULT 0,
        at      INTEGER NOT NULL,
        PRIMARY KEY (user_id, note_id)
      );
      CREATE INDEX note_visits_tid ON note_visits(user_id, seq DESC);
    `);
  },

  function m15(d) {
    /*
     * Hvor en kommentar kom FRA.
     *
     * `origin` siger allerede app/public, men den skelner mellem to
     * SLAGS afsendere - ikke mellem app'erne. Skriver tovo en kommentar
     * gennem sin noegle, staar der bare "Andreas", praecis som naar
     * Andreas selv skriver i Sagu. Det er samme navn og to helt
     * forskellige situationer.
     *
     * Kolonnen baerer NOEGLENS NAVN, ikke en fast liste. Sagu kender
     * hverken tovo eller doda og skal ikke til at kende dem: den, der
     * opretter noeglen, doeber den, og navnet er allerede det, revisionen
     * skriver (`audit('fangst-via-api', ..., auth.token.name, ...)`).
     * Kommer der en fjerde app, virker det uden en linje ny kode.
     *
     * Tom streng = skrevet i Sagu selv. Det er langt det almindelige, og
     * en tom streng koster ingenting i en raekke, der i forvejen findes.
     */
    d.exec("ALTER TABLE comments ADD COLUMN via TEXT NOT NULL DEFAULT ''");
  },

  function m16(d) {
    /*
     * Genoprettelseskoder til totrinsbekraeftelse (F21).
     *
     * **De er ikke valgfrie.** Uden dem laaser en mistet telefon ejeren ude
     * for altid; der er ingen supportafdeling at ringe til paa sin egen
     * server (RUNE-ERFARINGER §9d).
     *
     * `user_id` er forskellen paa doda og Sagu. doda er én bruger, saa dér
     * kan baade hemmeligheden og koderne ligge globalt. Sagu er FLERBRUGER:
     * en global kontakt ville betyde, at alices 2FA spaerrede for bob - eller
     * at bobs afslaaede den for alice. Alt hoerer til KONTOEN.
     *
     * Koderne hashes. Raekken bliver staaende med `used_at`, naar den er
     * brugt: en kode maa ikke kunne gaa om, og man skal kunne se, hvor mange
     * der er tilbage.
     */
    d.exec(`
      CREATE TABLE recovery_codes (
        id       TEXT PRIMARY KEY,
        user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        hash     TEXT NOT NULL,
        used_at  INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX recovery_user ON recovery_codes(user_id) WHERE used_at IS NULL;
    `);
  },

  function m17(d) {
    /*
     * Naar en vedhaeftning ikke laengere staar i noten.
     *
     * »Hvorfor vises der attachments selvom de er slettet paa en note ...
     * Denne boer kun vises hvis de er der« (Andreas, 2026-08-25). Listen
     * viste hver eneste raekke med `note_id`, uanset om teksten stadig pegede
     * paa filen - saa en note, man havde ryddet op i, blev ved med at have en
     * hale af billeder, ingen kunne se hvor var.
     *
     * ── Hvorfor en kolonne for sig og ikke bare `deleted_at` ──────────────
     *
     * Fordi de to skal se FORSKELLIGE ud. Trykker man »Remove«, mente man
     * det, og filen skal vaere vaek med det samme. Sletter man en linje i
     * teksten, kan det vaere en fejl - og saa skal filen blive staaende et
     * doegn med et maerke, saa man kan naa at saette den ind igen. To
     * kendsgerninger, to felter (DESIGN.md §4).
     *
     * Feltet er nulstilleligt med vilje: kommer henvisningen tilbage - ved en
     * fortrydelse, eller ved »Insert« - ryddes stemplet, og filen er en
     * ganske almindelig vedhaeftning igen.
     */
    d.exec('ALTER TABLE attachments ADD COLUMN orphan_since INTEGER');
  },
];

/*
 * Indstillinger, der ALDRIG maa forlade serveren.
 *
 * Ét sted, brugt af BAADE laese-endepunktet og eksporten. Ligger listen to
 * steder, glemmer man den ene, naeste gang der kommer en hemmelighed til -
 * og et endepunkt, der returnerer "alt i en tabel", er en tidsindstillet
 * laekage (RUNE-ERFARINGER, doda v16).
 */
/*
 * Hemmeligheder, der ALDRIG forlader serveren - hverken gennem `GET /settings`
 * eller en eksport.
 *
 * `totp_secret` ER det andet led. Kan den laeses ud, er hele
 * totrinsbekraeftelsen pynt (RUNE-ERFARINGER §9d).
 */
const HEMMELIGE_SETTINGS = new Set(['github_token', 'doda_key', 'server_secret', 'vapid_private',
  'totp_secret', 'totp_last']);

function migrate() {
  const cur = db.prepare('PRAGMA user_version').get().user_version || 0;
  for (let i = cur; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try {
      MIGRATIONS[i](db);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
      log(`skema opdateret til version ${i + 1}`);
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

/* ----------------------------------------------------------------- hjaelpere */

const now = () => Math.floor(Date.now() / 1000);
const log = (msg) => console.log(`[sagu] ${msg}`);
const logError = (msg) => console.error(`[fejl] ${msg}`);
// Ruller op pr. subjekt i panelets sikkerhedshistorik via runens events:-blok.
const logSecurity = (msg) => console.warn(`[sikkerhed] ${msg}`);

function newId() {
  return crypto.randomBytes(16).toString('hex');
}

function audit(event, actor, subject, detail) {
  try {
    db.prepare('INSERT INTO audit (at, event, actor, subject, detail) VALUES (?,?,?,?,?)')
      .run(now(), event, actor || null, subject || null, detail ? String(detail).slice(0, 500) : null);
  } catch (err) {
    logError(`kunne ikke skrive audit: ${err.message}`);
  }
}

/**
 * Indstillinger er scoped.
 *
 * `scope` er brugerens id, eller '*' for hele installationen. Uden det deler
 * to brugere den samme raekke, og opdagelsen kommer foerst, naar bruger nummer
 * to aendrer noget (RUNE-ERFARINGER, tovo F0).
 */
function getSetting(scope, key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE scope = ? AND key = ?').get(scope, key);
  return row ? row.value : fallback;
}

function setSetting(scope, key, value) {
  db.prepare(`INSERT INTO settings (scope, key, value) VALUES (?,?,?)
              ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`)
    .run(scope, key, String(value));
}

/** Hemmeligheden bag hmac'er (samtykkeformularens CSRF m.m.). Foedes ved foerste brug. */
function serverSecret() {
  let s = getSetting('*', 'server_secret');
  if (!s) {
    s = crypto.randomBytes(32).toString('hex');
    setSetting('*', 'server_secret', s);
  }
  return s;
}

function rateAllow(bucket, limit, windowSec) {
  const t = now();
  const row = db.prepare('SELECT count, reset_at FROM rate WHERE bucket = ?').get(bucket);
  if (!row || row.reset_at <= t) {
    db.prepare(`INSERT INTO rate (bucket, count, reset_at) VALUES (?,1,?)
                ON CONFLICT(bucket) DO UPDATE SET count = 1, reset_at = excluded.reset_at`)
      .run(bucket, t + windowSec);
    return true;
  }
  if (row.count >= limit) return false;
  db.prepare('UPDATE rate SET count = count + 1 WHERE bucket = ?').run(bucket);
  return true;
}

function rateClear(bucket) {
  db.prepare('DELETE FROM rate WHERE bucket = ?').run(bucket);
}

/* ---------------------------------------------------------------- kodeord */

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  let actual;
  try {
    actual = crypto.scryptSync(password, salt, expected.length, { N: 16384, r: 8, p: 1 });
  } catch {
    return false;
  }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/* ---------------------------------------------------------------- sessioner */

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const t = now();
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)')
    .run(token, userId, t, t + SESSION_DAYS * 86400);
  return token;
}

function sessionUser(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.username, u.is_admin, s.expires_at
      FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ?`).get(token);
  if (!row) return null;
  if (row.expires_at <= now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return { id: row.id, username: row.username, isAdmin: !!row.is_admin };
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isHttps(req) {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return proto === 'https';
}

function sessionCookie(req, token, maxAge) {
  const bits = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (isHttps(req)) bits.push('Secure');
  return bits.join('; ');
}

function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket.remoteAddress || 'ukendt';
}

/* ------------------------------------------------------------ http-svar */

// Hashen af det inline tema-script i index.html. Beregnes ved OPSTART i stedet
// for at blive stemplet ind af build'et - saa kan CSP'en aldrig komme ud af
// trit med filen, og build og server er ikke koblet sammen.
let INLINE_SCRIPT_HASH = '';
// Selve scriptteksten og versionsnummeret laeses samme sted. De server-
// renderede sider (wikien i F6, samtykkesiden i F10) er ikke en del af
// SPA'en, men skal se ud som resten og foelge samme tema - og med den ORDRET
// samme scripttekst er hashen allerede givet.
let INLINE_SCRIPT_TEXT = '';
let APP_VERSION_FIL = '1';

/*
 * Versionen laest FRISK fra disken - men kun naar filen er aendret.
 *
 * `computeInlineHash()` koeres ÉN gang ved opstart, og det var nok, saa laenge
 * en opdatering altid var en genstart. Panelets »Opdater app« skriver
 * app-filerne igen UDEN at genstarte containeren, og saa ville serveren blive
 * ved med at melde det gamle tal - og opdateringsbeskeden i browseren ville
 * aldrig dukke op, selv om der laa en ny app.js paa disken.
 *
 * Et `stat` pr. kald til /api/public-config er billigt; at laese hele filen er
 * det ikke, saa mtime afgoer, om der skal laeses.
 */
let versionMtime = 0;

function versionNu() {
  try {
    const sti = path.join(PUBLIC_DIR, 'index.html');
    const m = fs.statSync(sti).mtimeMs;
    if (m !== versionMtime) {
      versionMtime = m;
      const v = fs.readFileSync(sti, 'utf8').match(/style\.css\?v=(\d+)/);
      if (v) APP_VERSION_FIL = v[1];
    }
  } catch { /* filen kan ikke laeses - behold det, vi havde */ }
  return Number(APP_VERSION_FIL);
}

function computeInlineHash() {
  try {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
    const v = html.match(/style\.css\?v=(\d+)/);
    if (v) APP_VERSION_FIL = v[1];
    const m = html.match(/<script data-theme-init>([\s\S]*?)<\/script>/);
    if (!m) return;
    INLINE_SCRIPT_TEXT = m[1];
    const digest = crypto.createHash('sha256').update(m[1], 'utf8').digest('base64');
    INLINE_SCRIPT_HASH = ` 'sha256-${digest}'`;
  } catch (err) {
    logError(`kunne ikke beregne CSP-hash: ${err.message}`);
  }
}

function securityHeaders(res) {
  res.setHeader('Content-Security-Policy', [
    "default-src 'none'",
    `script-src 'self'${INLINE_SCRIPT_HASH}`,
    // 'unsafe-inline' gaelder kun typografi. Den betydningsfulde spaerring er
    // script-src; uden style-attributter kan en vanilla-JS-frontend ikke bygge
    // markup med innerHTML.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    // Uden worker-src falder en service worker tilbage paa child-src og
    // derfra til default-src 'none' - og blokeres af vores egen CSP.
    "worker-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy',
    'geolocation=(), camera=(), microphone=(), payment=(), usb=(), interest-cohort=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
}

function sendJson(res, status, body, extraHeaders) {
  const data = JSON.stringify(body);
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(data),
  }, extraHeaders || {}));
  res.end(data);
}

/**
 * API-fejl har TO lag: en kode til maskinen og en saetning til mennesket.
 *
 * En iOS-genvej kan vise `message` direkte, og en klient kan forgrene paa
 * `error`. Koden skal matche /^[a-z][a-z0-9_]*$/ - "not found" med mellemrum
 * er ikke noget, nogen kan forgrene paa (RUNE-ERFARINGER, doda v18).
 */
function apiFejl(res, status, kode, besked, ekstra) {
  /*
   * En 401 SKAL baere `WWW-Authenticate`.
   *
   * Uden den ved en klient ikke, at der findes en maade at godkende sig paa -
   * og proever i ring i stedet for at spoerge om en noegle. Det er samme
   * header, F10's connector-opdagelse haenger paa: svarer `/mcp` 401 uden
   * den, opgiver klienten forbindelsen, **uden at noget ser i stykker ud**
   * (RUNE-ERFARINGER §9a, faelde 1).
   */
  // `ekstra` er felter, klienten skal HANDLE paa - fx `needsCode`, som
  // afgoer, om kodefeltet bliver staaende. Ikke pynt: uden det ville et
  // forkert engangskode-forsoeg se ud som et forkert kodeord.
  sendJson(res, status, Object.assign({ error: kode, message: besked }, ekstra || {}),
    status === 401 ? { 'WWW-Authenticate': 'Bearer' } : undefined);
}

// Noten kan vaere paa hundredtusindvis af tegn markdown; 2 MB er for lidt.
// Filer gaar IKKE gennem denne vej - de streames (se modtagStroem).
const MAX_BODY = 8 * 1024 * 1024;

/**
 * Laeser kroppen som JSON.
 *
 * @param {boolean} tilgivende  Saettes KUN naar forespoergslen er godkendt med
 *   en adgangsnoegle. Kravet om application/json er en CSRF-barriere, og CSRF
 *   forudsaetter en ambient legitimation (cookien). En Bearer-noegle sendes
 *   aktivt af klienten, saa der er intet at forfalske - og saa skal en genvej,
 *   der bare sender en tekststreng, kunne virke.
 */
function readJsonBody(req, tilgivende, tilladArray) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] || '');
    const erJson = type.includes('application/json');
    if (!erJson && !tilgivende) {
      reject(Object.assign(new Error('Content-Type must be application/json'), { status: 415 }));
      return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('for stor forespoergsel'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) { resolve({}); return; }
      if (erJson || raw.startsWith('{') || (tilladArray && raw.startsWith('['))) {
        try {
          const parsed = JSON.parse(raw);
          // En generel body-laeser boer have et eksplicit tilladArray-flag
          // frem for en tavs afvisning: JSON-RPC-batch (MCP, F10) er arrays.
          if (Array.isArray(parsed)) { resolve(tilladArray ? parsed : {}); return; }
          resolve(parsed && typeof parsed === 'object' ? parsed : {});
        } catch {
          reject(Object.assign(new Error('The body is not valid JSON.'), { status: 400 }));
        }
        return;
      }
      if (type.includes('application/x-www-form-urlencoded')) {
        const felter = {};
        for (const [n, v] of new URLSearchParams(raw)) felter[n] = v;
        /*
         * Er det slet ikke en formular, ER kroppen teksten.
         *
         * `curl --data 'noget tekst'` saetter form-typen af sig selv, og saa
         * blev hele saetningen til et TOMT felt med et mystisk navn - og
         * fangsten svarede »send noget tekst«, selv om teksten var der.
         * Fundet ved at koere som en rigtig klient; min egen test sendte slet
         * ingen Content-Type og gik derfor fri.
         *
         * Kendetegnet er, at der ikke er ét eneste `=` i kroppen - altsaa
         * praecis ét felt UDEN vaerdi. Reglen hed foer »ingen text/title/note
         * blandt felterne«, og den aad F10's samtykkeformular: den har syv
         * rigtige felter, men ingen af de tre navne, saa hele indsendelsen
         * blev til én tekststreng, og »Allow« svarede 400.
         *
         * Kun i tilgivende tilstand, altsaa kun naar kaldet er godkendt med en
         * NOEGLE: der er ingen ambient legitimation at misbruge.
         */
        const navne = Object.keys(felter);
        if (tilgivende && navne.length === 1 && felter[navne[0]] === '' && !raw.includes('=')) {
          resolve({ text: raw });
          return;
        }
        resolve(felter);
        return;
      }
      resolve({ text: raw });
    });
    req.on('error', reject);
  });
}

function str(value, max) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

/* ------------------------------------------------------- store uploads */

/*
 * MAALING 4 (DESIGN.md): Notion-eksporten er en zip paa hundredvis af MB.
 *
 * readJsonBody samler alt i hukommelsen. En 400 MB zip ville blive til over
 * en gigabyte heap, og appen ville doe - praecis som Kokkeris backup, der
 * blev afvist af serverens egen 25 MB-graense uden at nogen opdagede det.
 *
 * Kroppen skrives derfor DIREKTE til disk med et loebende sha256 og et
 * byte-loft. Hukommelsen er én chunk ad gangen, uanset filens stoerrelse.
 *
 * Faelde: rammer man loftet og kalder req.destroy(), ser klienten
 * "connection reset" i stedet for vores 413. Vi pauser i stedet, svarer
 * foerst, og lukker i res.on('finish') (RUNE-ERFARINGER, doda F7).
 */
function modtagStroem(req, maal, maxBytes) {
  return new Promise((resolve, reject) => {
    const ud = fs.createWriteStream(maal);
    const hash = crypto.createHash('sha256');
    let size = 0;
    let stoppet = false;

    const stop = (err) => {
      if (stoppet) return;
      stoppet = true;
      ud.destroy();
      fs.unlink(maal, () => {});
      req.pause();
      reject(err);
    };

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        stop(Object.assign(
          new Error(`The upload is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`),
          { status: 413 }));
        return;
      }
      hash.update(chunk);
      // Modtryk: er skrivebufferen fuld, holder vi laesningen tilbage i
      // stedet for at lade den hobe sig op i hukommelsen. Uden det her er
      // "streaming" kun et ord - Node bufrer bare internt.
      if (!ud.write(chunk)) {
        req.pause();
        ud.once('drain', () => { if (!stoppet) req.resume(); });
      }
    });
    req.on('error', stop);
    req.on('end', () => {
      if (stoppet) return;
      ud.end(() => resolve({ size, sha: hash.digest('hex') }));
    });
  });
}

/* ------------------------------------------------------------ statisk */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const full = path.resolve(PUBLIC_DIR, rel);
  if (full !== PUBLIC_DIR && !full.startsWith(PUBLIC_DIR + path.sep)) {
    apiFejl(res, 403, 'forbidden', 'Not allowed.');
    return;
  }
  let stat;
  try {
    stat = fs.statSync(full);
  } catch {
    apiFejl(res, 404, 'not_found', 'No such file.');
    return;
  }
  if (!stat.isFile()) { apiFejl(res, 404, 'not_found', 'No such file.'); return; }

  const ext = path.extname(full).toLowerCase();
  const isHtml = ext === '.html';
  securityHeaders(res);

  // I DEV stemples ?v= med filernes mtime. Ellers beholder browseren en
  // "immutable" app.js fra foer og spoerger aldrig serveren igen - saa
  // fejlsoeger man kode, der ikke er indlaest (RUNE-ERFARINGER, doda F1).
  if (isHtml && DEV) {
    let html = fs.readFileSync(full, 'utf8');
    html = html.replace(/(style\.css|app\.js)\?v=\d+/g, (_, fil) => {
      let m = 0;
      try { m = Math.floor(fs.statSync(path.join(PUBLIC_DIR, fil)).mtimeMs); } catch { /* ligegyldigt */ }
      return `${fil}?v=${m}`;
    });
    res.writeHead(200, { 'Content-Type': MIME[ext], 'Cache-Control': 'no-store' });
    res.end(html);
    return;
  }

  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    // HTML altid frisk: Cloudflare edge-cacher .js/.css i timevis og
    // ignorerer no-cache, saa versionerede URL'er baerer opdateringen.
    'Cache-Control': (isHtml || DEV) ? 'no-store' : 'public, max-age=31536000, immutable',
  });
  if (req.method === 'HEAD') { res.end(); return; }
  fs.createReadStream(full).pipe(res);
}

/* ------------------------------------------------- adgangsnoegler */

/* En mistet telefon maa ikke kunne laese hele arkivet: en capture-noegle kan
   KUN oprette - den kan ikke se noget som helst. */
/*
 * Hvad en noegle MAA - og hvorfor `link` findes.
 *
 * `capture` kan oprette og se ingenting; `read` kan se og oprette ingenting.
 * Det er den rigtige opdeling for en telefon eller en genvej, men den kan
 * ikke udtrykke det, en SOESTER-APP har brug for: doda skal kunne SOEGE i
 * noterne (for at haenge den rigtige note paa en opgave) og OPRETTE én
 * (`*` i fangstfeltet) - og ikke andet.
 *
 * Uden `link` maatte doda have en `full`-noegle, og saa ville en integration,
 * der kun skal skrive links, ogsaa kunne slette hele arkivet. Rettigheden
 * skal passe til opgaven, ikke til den naermeste kasse, der er stor nok.
 *
 * `write` er stadig forbeholdt `full`: en soesterapp maa lave en note, ikke
 * lave om paa en (SAGU-PLAN F8's accept).
 */
const SCOPE_TILLADER = {
  capture: new Set(['capture']),
  read: new Set(['read']),
  link: new Set(['capture', 'read']),
  full: new Set(['capture', 'read', 'write']),
};
const SCOPES = Object.keys(SCOPE_TILLADER);

function hashToken(raa) {
  return crypto.createHash('sha256').update(String(raa), 'utf8').digest('hex');
}

function opretToken(userId, navn, scope, ekstra) {
  const e = ekstra || {};
  const hemmelig = crypto.randomBytes(32).toString('base64url');
  const noegle = `sagu_${hemmelig}`;
  const id = newId();
  db.prepare(`INSERT INTO tokens (id, user_id, name, hash, prefix, scope, created_at, client_id, expires_at)
              VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, userId, navn, hashToken(noegle), hemmelig.slice(0, 6), scope, now(),
      e.clientId || null, e.expiresAt || null);
  audit(e.clientId ? 'oauth-token-udstedt' : 'noegle-oprettet', userId, navn, scope);
  // Noeglen returneres ÉN gang og gemmes aldrig i klartekst.
  return { id, key: noegle };
}

function findToken(raa) {
  if (typeof raa !== 'string' || !raa.startsWith('sagu_')) return null;
  const row = db.prepare(`
    SELECT id, user_id, name, scope, last_used_at, client_id FROM tokens
     WHERE hash = ? AND revoked_at IS NULL
       -- Uden udloebstjekket ville et OAuth-token leve evigt, uanset hvad
       -- vi lovede klienten i expires_in.
       AND (expires_at IS NULL OR expires_at > ?)`).get(hashToken(raa), now());
  return row || null;
}

function stemplBrug(token) {
  // Hoejst ét skriv i minuttet - ellers koster hvert API-kald en skrivning.
  const t = now();
  if (token.last_used_at && t - token.last_used_at < 60) return;
  db.prepare('UPDATE tokens SET last_used_at = ? WHERE id = ?').run(t, token.id);
}

/* ------------------------------------------------------------ godkendelse */

/**
 * Godkender via adgangsnoegle ELLER session-cookie.
 *
 * Webgraensefladen bruger SAMME API som eksterne klienter - der er ingen
 * intern bagvej. Noeglen baerer sin egen user_id, saa den naar praecis den
 * brugers data (RUNE-ERFARINGER, tovo F8).
 *
 * @returns {{user, token, viaToken}|null} - null naar svaret allerede er sendt
 */
function godkend(req, res, kraevetScope) {
  const auth = String(req.headers.authorization || '');
  const bearer = auth.match(/^Bearer\s+(\S+)$/i);
  const raaNoegle = bearer ? bearer[1] : String(req.headers['x-api-key'] || '');

  if (raaNoegle) {
    const token = findToken(raaNoegle);
    if (!token) {
      logSecurity(`noegle-afvist ip=${clientIp(req)}`);
      apiFejl(res, 401, 'invalid_key', 'That access key is not valid. It may have been revoked.');
      return null;
    }
    if (!rateAllow(`api:${token.id}`, 600, 3600)) {
      apiFejl(res, 429, 'rate_limited', 'Too many requests with this key. Try again shortly.');
      return null;
    }
    if (!SCOPE_TILLADER[token.scope] || !SCOPE_TILLADER[token.scope].has(kraevetScope)) {
      apiFejl(res, 403, 'wrong_scope',
        `This key is "${token.scope}" and cannot ${kraevetScope}. Create a key with a wider scope.`);
      return null;
    }
    stemplBrug(token);
    // Brugeren slaas op paa NOEGLEN - aldrig "foerste bruger i tabellen".
    const bruger = db.prepare('SELECT id, username, is_admin FROM users WHERE id = ?').get(token.user_id);
    if (!bruger) {
      apiFejl(res, 401, 'invalid_key', 'That access key is not valid. It may have been revoked.');
      return null;
    }
    return { user: { id: bruger.id, username: bruger.username, isAdmin: !!bruger.is_admin }, token, viaToken: true };
  }

  const user = sessionUser(req);
  if (!user) {
    apiFejl(res, 401, 'not_signed_in', 'You are not signed in.');
    return null;
  }
  return { user, token: null, viaToken: false };
}

/**
 * Kraever en RIGTIG session.
 *
 * Auth-ruterne skal blive UDEN for delingen: kodeordsskift og administration
 * af noeglerne selv maa kun kunne naas med en session. Ellers er én laekket
 * noegle nok til at give sig selv fuld og varig adgang - eller til at laase
 * ejeren ude af sin egen app (RUNE-ERFARINGER, doda F2).
 */
function requireUser(req, res) {
  const user = sessionUser(req);
  if (!user) { apiFejl(res, 401, 'not_signed_in', 'You are not signed in.'); return null; }
  return user;
}

/** Administrator = maa aendre INSTALLATIONEN. Aldrig: maa se andres noter. */
function requireAdmin(req, res) {
  const user = requireUser(req, res);
  if (!user) return null;
  if (!user.isAdmin) {
    apiFejl(res, 403, 'not_admin', 'Only an administrator can change this.');
    return null;
  }
  return user;
}

/* ------------------------------------------- totrinsbekraeftelse (F21) */

function totpStatus(userId) {
  return {
    enabled: getSetting(userId, 'totp_enabled', '') === '1',
    // »Paabegyndt« er en tredje tilstand: hemmeligheden findes, men kontakten
    // er ikke gaaet til endnu. Uden den ville fladen vise »slaa til« til en,
    // der staar midt i opsaetningen.
    pending: !!getSetting(userId, 'totp_secret', '') && getSetting(userId, 'totp_enabled', '') !== '1',
    recoveryLeft: db.prepare(
      'SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ? AND used_at IS NULL').get(userId).n,
  };
}

function slaaTotpFra(userId) {
  db.prepare('DELETE FROM settings WHERE scope = ? AND key IN (?,?,?)')
    .run(userId, 'totp_secret', 'totp_enabled', 'totp_last');
  db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(userId);
}

/** Ti nye koder. De gamle - ogsaa de ubrugte - doer i samme aandedrag. */
function nyeGenoprettelseskoder(userId) {
  const koder = totp.nyeKoder(10);
  const nu = Math.floor(Date.now() / 1000);
  db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(userId);
  const ind = db.prepare(
    'INSERT INTO recovery_codes (id, user_id, hash, used_at, created_at) VALUES (?,?,?,NULL,?)');
  for (const k of koder) ind.run(newId(), userId, totp.hashKode(k), nu);
  return koder;
}

/**
 * Andet trin ved login: en engangskode ELLER en genoprettelseskode.
 *
 * ── De to ting, der er lette at gaa galt i ────────────────────────────────
 *
 *  1. **Vinduet braendes.** `tjek()` returnerer det vindue, koden kom fra -
 *     ikke `true` - og vi afviser det samme vindue igen. Ellers kan en
 *     opsnappet kode bruges to gange inden for det halve minut.
 *  2. **En genoprettelseskode kan ikke gaa om.** Raekken bliver staaende med
 *     `used_at`, saa den er brugt for altid og kan taelles.
 */
function tjekAndetTrin(userId, kode) {
  const hem = getSetting(userId, 'totp_secret', '');
  if (hem) {
    const vindue = totp.tjek(hem, kode);
    if (vindue !== null) {
      const sidst = Number(getSetting(userId, 'totp_last', '0'));
      if (vindue <= sidst) return { ok: false, besked: 'That code has already been used.' };
      setSetting(userId, 'totp_last', String(vindue));
      return { ok: true };
    }
  }
  // Ikke en engangskode - saa maaske en genoprettelseskode.
  const hash = totp.hashKode(kode);
  const raekke = db.prepare(
    'SELECT id FROM recovery_codes WHERE user_id = ? AND hash = ? AND used_at IS NULL').get(userId, hash);
  if (!raekke) return { ok: false, besked: 'That code is not right.' };
  db.prepare('UPDATE recovery_codes SET used_at = ? WHERE id = ?')
    .run(Math.floor(Date.now() / 1000), raekke.id);
  const tilbage = db.prepare(
    'SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ? AND used_at IS NULL').get(userId).n;
  return { ok: true, genoprettelse: true, tilbage };
}

function userCount() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

function registreringAaben() {
  // Fravaer betyder LUKKET efter den foerste bruger: en ny installation skal
  // ikke staa aaben for verden, fordi ingen har taget stilling.
  return userCount() === 0 || getSetting('*', 'allow_registration', '') === '1';
}

/* ============================================================ noter =====
 *
 * HELE user_id-filteret bor herinde. Kaldstederne maa ikke kende det, for
 * saa bliver der ét sted, hvor nogen glemmer det - og en isolationsfejl ser
 * fuldstaendig rigtig ud i alle tests med kun én konto.
 *
 * `deling` er forberedt til F11: en note kan naas af sin ejer ELLER af en
 * bruger, den er delt med gennem note_acl. Tabellen findes fra F0, fordi et
 * adgangslag ikke kan eftermonteres.
 */

/*
 * ── Arven ─────────────────────────────────────────────────────────────────
 *
 * Deles en side, deles det, der ligger under den. Fragmentet gaar derfor OP
 * gennem foraeldrene og spoerger, om nogen af dem er delt med `tree = 1`.
 *
 * **MAALING 5 (DESIGN.md): hvad koster det?** SQLite tillader en korreleret
 * `WITH RECURSIVE` inde i `EXISTS`, og prisen er maalt paa 4.840 noter:
 *
 *   - **for EJEREN: 0,13 ms - praecis det samme som uden arven.** `n.user_id
 *     = ?` staar foerst i OR'en og kortslutter den, saa gennemloebet aldrig
 *     koeres. Det er den vej, alle Andreas' egne kald gaar.
 *   - for den, noten er delt MED, og et fuldt scan: 8,8 ms. Vaerste tilfaelde,
 *     og stadig under et blink.
 *
 * Derfor er der ingen hurtig sti og ingen materialiseret tabel: **OR'ens
 * kortslutning ER den hurtige sti.**
 *
 * Loftet paa 64 er en spaerre mod en cyklus i data, ikke mod dybde - samme
 * grund som i `undertrae()`. Uden det ville en ring i traeet haenge et
 * opslag, og fejlen ville se ud som en langsom database.
 */
const ARVET = (led, alias) => `EXISTS (
  WITH RECURSIVE op(id, parent_id, dybde) AS (
    SELECT id, parent_id, 0 FROM notes WHERE id = ${alias}.id
    UNION ALL
    SELECT x.id, x.parent_id, op.dybde + 1 FROM notes x JOIN op ON x.id = op.parent_id
     WHERE op.dybde < 64
  )
  SELECT 1 FROM op JOIN note_acl a ON a.note_id = op.id
   WHERE a.user_id = ? AND (a.tree = 1 OR op.id = ${alias}.id)${led})`;

/*
 * Fragmenterne tager et ALIAS, saa de kan bruges paa en anden taffel end `n`.
 *
 * »Delt med mig«-listen skal spoerge om FORAELDEREN er synlig for at kunne
 * vise kun toppen af det, jeg har faaet - og en halv kopi af reglen dér ville
 * vaere en regel til. Der er kun én adgangsregel i appen; den kan bare pege
 * paa forskellige raekker.
 */
const synligFor = (alias) => `(${alias}.user_id = ? OR ${ARVET('', alias)})`;

/**
 * SQL-fragmentet, der afgoer om `userId` overhovedet maa SE noten.
 *
 * Baade dette og `SKRIVBAR` tager **noejagtig to parametre** - `userId` to
 * gange, i den raekkefoelge - praecis som foer arven kom til. Det er med
 * vilje: der er over tyve kaldsteder, og et fragment, der pludselig kraever
 * tre, ville skulle rettes hvert eneste sted.
 */
const SYNLIG = synligFor('n');

/** ... og om han maa AENDRE den. Kun ejer eller en write-ACL. */
const SKRIVBAR = `(n.user_id = ? OR ${ARVET(" AND a.level = 'write'", 'n')})`;

/**
 * ... og om han EJER den.
 *
 * Tre ting kan kun ejeren: **slette, udgive og dele videre** - plus at give
 * noten fra sig. `write` betyder »skriv i den«, ikke »bestem over den«: en
 * kollega, der maa rette i en side, skal ikke kunne laegge hele undertraeet
 * paa det aabne net eller smide det i papirkurven. Ejeren ville opdage det
 * bagefter, og »bagefter« er for sent for noget, der har vaeret offentligt.
 */
const EJET = '(n.user_id = ?)';

const NOTE_LISTE_FELTER = `n.id, n.user_id, n.notebook_id, n.parent_id, n.title, n.icon,
  n.seq, n.full_width, n.archived_at, n.created_at, n.updated_at, n.updated_by`;

function naesteSeq(tabel, hvor, ...arg) {
  // seq er et LOEBENUMMER, ikke et tidsstempel. Skriver man now() i
  // sorteringskolonnen, ser listen rigtig ud (tidsstempler sorterer
  // kronologisk), og manuel sortering er umulig (RUNE-ERFARINGER, doda F3/F4).
  const r = db.prepare(`SELECT COALESCE(MAX(seq), -1) + 1 AS n FROM ${tabel} WHERE ${hvor}`).get(...arg);
  return r.n;
}

/**
 * Én note. Listerne faar ALDRIG body_md - kun hentNote gør (CLAUDE.md).
 *
 * Returnerer null baade naar noten ikke findes, og naar den tilhoerer en
 * anden. Det er med vilje: en 404 maa ikke kunne skelnes fra "findes ikke",
 * ellers kan man aftaste, hvilke id'er der er i brug.
 */
function hentNote(userId, id) {
  const r = db.prepare(`
    SELECT n.*, (n.user_id = ?) AS er_ejer
      FROM notes n
     WHERE n.id = ? AND n.deleted_at IS NULL AND ${SYNLIG}`).get(userId, id, userId, userId);
  if (!r) return null;
  // medMaerker() blev kun kaldt paa LISTER, saa den enkelte note kom altid
  // tilbage med tags: []. Fejlen laa der fra F0 og viste sig foerst, da
  // importen begyndte at saette maerker - indtil da var listen tom i begge
  // tilfaelde. En funktion, der returnerer samme slags objekt ad to veje,
  // skal give samme FORM begge veje (RUNE-ERFARINGER, doda F5).
  return medMaerker([formNote(r, true, userId)])[0];
}

function hentNoter(userId, filter) {
  const f = filter || {};
  const hvor = [`n.deleted_at IS ${f.slettede ? 'NOT NULL' : 'NULL'}`, SYNLIG];
  const arg = [userId, userId];
  /*
   * **»All notes« er MINE noter.**
   *
   * `SYNLIG` staar der stadig - den er reglen, og den maa ikke fjernes fra en
   * dataadgang - men listerne i sidebaren er mit eget arkiv. En delt side
   * ligger i EJERENS notesbog og ville ellers dukke op midt i mine egne uden
   * en bog at hoere til. Det, andre har delt, har sin egen visning
   * (`deltMedMig`), hvor der ogsaa staar hvem det kom fra (F11).
   */
  if (!f.medDelte) {
    hvor.push('n.user_id = ?');
    arg.push(userId);
  }
  if (f.notebook !== undefined) {
    if (f.notebook === null) hvor.push('n.notebook_id IS NULL');
    else { hvor.push('n.notebook_id = ?'); arg.push(f.notebook); }
  }
  if (f.parent !== undefined) {
    if (f.parent === null) hvor.push('n.parent_id IS NULL');
    else { hvor.push('n.parent_id = ?'); arg.push(f.parent); }
  }
  if (!f.medArkiverede) hvor.push('n.archived_at IS NULL');
  const graense = Math.min(Number(f.limit) || 500, 2000);
  const raekker = db.prepare(`
    SELECT ${NOTE_LISTE_FELTER}, (n.user_id = ?) AS er_ejer
      FROM notes n
     WHERE ${hvor.join(' AND ')}
     ORDER BY n.seq, n.updated_at DESC
     LIMIT ${graense}`).all(userId, ...arg);
  return medFilantal(medMaerker(raekker.map((r) => formNote(r, false, userId))));
}

/** Rækken som API'et ser den. `medKrop` styrer om body_md kommer med. */
function formNote(r, medKrop, laeser) {
  const ud = {
    id: r.id,
    notebookId: r.notebook_id,
    parentId: r.parent_id,
    title: r.title,
    icon: r.icon,
    seq: r.seq,
    fullWidth: !!r.full_width,
    // Baade stemplet og det afledte flag: UI'et spoerger om "er den lagt
    // vaek?", mens en visning af papirkurv eller arkiv vil vide HVORNAAR.
    archived: !!r.archived_at,
    archivedAt: r.archived_at || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
    // Delte noter (F11) skal kunne skelnes i UI'et. Med kun én bruger er
    // den altid true - og det er praecis derfor feltet skal med fra nu:
    // en visning, der antager ejerskab, er svaer at finde bagefter.
    mine: !!r.er_ejer,
    tags: [],
  };
  /*
   * Er den ikke min, skal det STAA der - med hvem den kom fra, og hvad jeg
   * maa. En redigeringsflade, der ser ud som ens egen, men afviser gemningen,
   * er vaerre end en, der siger det paa forhaand (F11).
   */
  if (medKrop && laeser) {
    // Stjernen er LAESERENS, ikke notens - to brugere kan have hver sin.
    ud.favorite = !!db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND note_id = ?')
      .get(laeser, r.id);
  }
  if (medKrop && r.er_ejer) {
    // Er den delt med nogen? Knappen i vaerktoejsraekken skal kunne tegnes med
    // det samme - én taeller frem for en rundtur mere pr. aabnet note
    // (RUNE-ERFARINGER, doda v27: taeld de blokerende rundture).
    ud.sharedWith = db.prepare('SELECT COUNT(*) AS n FROM note_acl WHERE note_id = ?').get(r.id).n;
  }
  if (!r.er_ejer && laeser) {
    const e = db.prepare('SELECT username FROM users WHERE id = ?').get(r.user_id);
    ud.owner = e ? e.username : null;
    ud.level = db.prepare(`
      SELECT 1 FROM notes n WHERE n.id = ? AND ${SKRIVBAR}`).get(r.id, laeser, laeser)
      ? 'write' : 'read';
  }
  if (medKrop) {
    ud.body = r.body_md;
    ud.extId = r.ext_id || null;
    ud.props = db.prepare('SELECT key, value FROM note_props WHERE note_id = ? ORDER BY seq, key')
      .all(r.id).map((p) => ({ key: p.key, value: p.value }));
    // Sider, der peger HERTIL. Det er dét, der goer et arkiv til et net frem
    // for en bunke - og det maa aldrig kraeve en gennemsoegning af al tekst.
    /*
     * Kun de sider, JEG maa se.
     *
     * Uden filteret ville en note, en anden bruger har delt med mig, vise
     * titlerne paa hans oevrige sider, saa snart én af dem linkede hertil -
     * og en titel er tit hele indholdet (»Opsigelse, Jens«). Hullet var
     * usynligt med én konto, og det er praecis den slags, F11 aabner.
     */
    ud.backlinks = db.prepare(`
      SELECT n.id, n.title FROM note_links l JOIN notes n ON n.id = l.from_id
       WHERE l.to_id = ? AND n.deleted_at IS NULL AND ${SYNLIG}
       ORDER BY n.title`).all(r.id, laeser, laeser);
    ud.childCount = db.prepare(`
      SELECT COUNT(*) AS n FROM notes WHERE parent_id = ? AND deleted_at IS NULL`).get(r.id).n;
    /*
     * Er noten udgivet? (F6)
     *
     * Med i selve noten frem for som et ekstra kald: knappen i
     * vaerktoejsraekken skal kunne tegnes med det samme, og en rundtur mere
     * pr. aabnet note er en halv sekunds ventetid gennem tunnelen
     * (RUNE-ERFARINGER, doda v27 - taeld blokerende rundture). Opslaget er ét
     * indeksopslag paa shares.note_id.
     */
    const udgivet = db.prepare(`SELECT id, slug, token, password_hash FROM shares
                                 WHERE note_id = ? AND revoked_at IS NULL`).get(r.id);
    ud.published = udgivet ? {
      id: udgivet.id,
      path: udgivet.slug ? `/w/${udgivet.slug}` : `/s/${udgivet.token}`,
      hasPassword: !!udgivet.password_hash,
    } : null;
    // Kun den ENKELTE note faar filernes metadata. Konsekvensen, man skal
    // huske: detaljeruden kan ikke bruge objektet fra listen - den skal hente
    // det fulde element (RUNE-ERFARINGER, doda F7).
    /*
     * `orphan_since` kommer MED ud. Fladen skal kunne saette et maerke paa den
     * fil, teksten ikke laengere peger paa - ellers forsvinder den bare en dag,
     * og det er praecis den slags, man ikke opdager foer den er sket.
     */
    ud.files = db.prepare(`
      SELECT id, name, mime, size, width, height, orphan_since FROM attachments
       WHERE note_id = ? AND deleted_at IS NULL
         AND (orphan_since IS NULL OR orphan_since > ?)
       ORDER BY created_at`).all(r.id, now() - FORAELDRELOES_FRIST)
      .map((f) => Object.assign(f, { url: `/api/v1/files/${f.id}`, inline: INLINE_MIME.has(f.mime) }));
  }
  return ud;
}

/** Maerker i ÉT opslag for hele batchen - aldrig en forespoergsel pr. raekke. */
function medMaerker(noter) {
  if (!noter.length) return noter;
  const huller = noter.map(() => '?').join(',');
  const raekker = db.prepare(`
    SELECT nt.note_id, t.name FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
     WHERE nt.note_id IN (${huller}) ORDER BY t.name`).all(...noter.map((n) => n.id));
  const kort = new Map();
  for (const r of raekker) {
    if (!kort.has(r.note_id)) kort.set(r.note_id, []);
    kort.get(r.note_id).push(r.name);
  }
  for (const n of noter) n.tags = kort.get(n.id) || [];
  return noter;
}

function opretNote(userId, felter) {
  const f = felter || {};
  const t = now();
  const id = newId();
  /*
   * En underside arver sin foraelders notesbog.
   *
   * »Et undertrae ligger i ÉN notesbog« (DESIGN.md) - ellers kan sidebaren
   * ikke tegne det ét sted, og en udgivet notesbog ville springe de sider
   * over, der blev lavet UNDER en af dens egne. `flytNote` har altid gjort
   * det; oprettelsen gjorde ikke, og forskellen var usynlig, indtil en hel
   * bog kunne udgives (fundet af testen, 2026-08-21).
   */
  let bog = f.notebookId || null;
  /*
   * En underside arver sin foraelders notesbog OG sin foraelders EJER.
   *
   * Ejeren er det, F11 lagde til. Laver en kollega en underside i et trae,
   * jeg har delt med ham, skal siden hoere til traeet - ellers staar den i
   * MIT trae uden at jeg kan se den (min `SYNLIG` matcher ikke hans note), og
   * arven ville give ham adgang til en side, jeg ikke ejer. Et undertrae har
   * ÉN ejer, praecis som det ligger i ÉN notesbog.
   *
   * `updated_by` bliver ved med at vaere den, der skrev. Det er dét felt, der
   * svarer paa »hvem rørte den sidst«.
   */
  let ejer = userId;
  if (f.parentId) {
    const p = db.prepare(`SELECT n.user_id, n.notebook_id FROM notes n
                           WHERE n.id = ? AND n.deleted_at IS NULL AND ${SKRIVBAR}`)
      .get(f.parentId, userId, userId);
    if (p) {
      ejer = p.user_id;
      if (!bog) bog = p.notebook_id;
    }
  }
  db.prepare(`INSERT INTO notes
      (id, user_id, notebook_id, parent_id, title, body_md, icon, seq, ext_id,
       created_at, updated_at, updated_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, ejer,
      bog,
      f.parentId || null,
      str(f.title, 400),
      typeof f.body === 'string' ? f.body : '',
      str(f.icon, 16),
      naesteSeq('notes', 'user_id = ?', ejer),
      f.extId ? str(f.extId, 64) : null,
      t, t, userId);
  gemVersion(id, userId);
  opdaterLinks(userId, id, typeof f.body === 'string' ? f.body : '');
  // Maerker skal kunne saettes ved oprettelsen. Ellers skal en klient - en
  // iOS-genvej, en MCP-klient, fangstfeltet - lave to kald og kan komme til
  // at lave det ene.
  if (Array.isArray(f.tags) && f.tags.length) saetMaerker(userId, id, f.tags);
  indekser(id);
  return hentNote(userId, id);
}

/**
 * Opdaterer - og afgoer FOERST om raekken findes og maa skrives.
 *
 * Man maa ikke udlede "fandtes den?" af noget, aendringen selv har skjult:
 * en bloed sletning gjorde dodas opdaterItem til at returnere null, og ruten
 * svarede 404 paa en sletning, der lykkedes (RUNE-ERFARINGER, doda v8).
 */
function gemNote(userId, id, felter) {
  const raekke = db.prepare(`
    SELECT n.id, n.updated_at FROM notes n
     WHERE n.id = ? AND n.deleted_at IS NULL AND ${SKRIVBAR}`).get(id, userId, userId);
  if (!raekke) return { fejl: 'not_found' };

  const f = felter || {};
  // Konfliktvagt: to faner, to telefoner, eller en MCP-klient midt i en
  // redigering. En tavs overskrivning er den vaerste udgang (F1-kravet).
  if (f.ifUpdatedAt !== undefined && Number(f.ifUpdatedAt) !== raekke.updated_at) {
    return { fejl: 'conflict', updatedAt: raekke.updated_at };
  }

  const saet = [];
  const arg = [];
  const put = (kolonne, vaerdi) => { saet.push(`${kolonne} = ?`); arg.push(vaerdi); };
  // hasOwnProperty, ikke `!== undefined`: "udeladt" og "tom" skal kunne
  // skelnes, hver gang de moedes. Et udeladt felt bevares, et null rydder
  // (RUNE-ERFARINGER, tovo v10).
  const har = (k) => Object.prototype.hasOwnProperty.call(f, k);

  if (har('title')) put('title', str(f.title, 400));
  if (har('body')) put('body_md', typeof f.body === 'string' ? f.body : '');
  if (har('icon')) put('icon', str(f.icon, 16));
  if (har('notebookId')) put('notebook_id', f.notebookId || null);
  if (har('parentId')) put('parent_id', f.parentId || null);
  if (har('fullWidth')) put('full_width', f.fullWidth ? 1 : 0);
  // Kalderen siger "laeg den vaek"; SERVEREN stempler hvornaar. En klient,
  // der selv maatte saette tidspunktet, ville goere kolonnen til hvad som
  // helst den sidste skriver fandt paa.
  if (har('archived')) put('archived_at', f.archived ? now() : null);
  if (har('seq')) put('seq', Number(f.seq) || 0);

  // Maerker ligger i deres egen tabel og hoerer derfor ikke i `saet` - men de
  // skal kunne saettes i SAMME kald som resten, ellers skal en klient lave to
  // og kan komme til at lave den ene.
  if (har('tags')) saetMaerker(userId, id, f.tags);
  if (!saet.length) {
    if (har('tags')) {
      db.prepare('UPDATE notes SET updated_at = ?, updated_by = ? WHERE id = ?').run(now(), userId, id);
    }
    return { note: hentNote(userId, id) };
  }

  /*
   * Versionen tages FOER skrivningen - ikke efter.
   *
   * Den stod efter `UPDATE`, saa en version var »noten som netop gemt«. Det
   * er rigtigt nok, saa laenge hver gemning giver en raekke - men med
   * sammenlaegning (F22) taber man hele skrivestundens resultat:
   *
   *   opret »et«           -> version: et
   *   gem »to«, »tre«      -> sprunget over, samme stund
   *   NAESTE stund, »fire« -> version: fire   <- »tre« findes ingen steder
   *
   * Med snapshottet FOER skrivningen bliver den sidste linje til
   * »version: tre« - praecis den tilstand, man vil tilbage til. Hver
   * skrivestunds slutresultat bevares, og det er dét, en historik er til for.
   */
  if (har('title') || har('body')) gemVersion(id, userId);
  put('updated_at', now());
  put('updated_by', userId);
  db.prepare(`UPDATE notes SET ${saet.join(', ')} WHERE id = ?`).run(...arg, id);
  if (har('body')) {
    opdaterLinks(userId, id, typeof f.body === 'string' ? f.body : '');
    maerkForaeldreloese(id, typeof f.body === 'string' ? f.body : '');
  }
  indekser(id);
  return { note: hentNote(userId, id) };
}

/**
 * Stempler de vedhaeftninger, teksten ikke laengere peger paa.
 *
 * Kaldes hver gang en note gemmes med en ny krop. ÉN saetning, der baade
 * saetter og RYDDER: kommer henvisningen tilbage - ved en fortrydelse, eller
 * ved »Insert« - bliver filen en ganske almindelig vedhaeftning igen, uden at
 * nogen skal huske at rydde op efter sig.
 *
 * `COALESCE` og ikke bare `?`: stemplet skal staa stille. Satte hver eneste
 * gemning et nyt tidspunkt, ville doegnet begynde forfra, hver gang man rettede
 * et komma - og filen ville aldrig naa at blive ryddet vaek.
 *
 * `instr` frem for at tolke markdown'en: en henvisning ER `sagu:<id>`, uanset
 * om den staar som billede, som link, i en kodeblok eller midt i en saetning.
 * Staar id'et i teksten, MENER brugeren noget med filen - og en oprydning skal
 * fejle til fordel for at beholde.
 */
const FORAELDRELOES_FRIST = 24 * 3600;

function maerkForaeldreloese(noteId, krop) {
  db.prepare(`
    UPDATE attachments
       SET orphan_since = CASE WHEN instr(?, 'sagu:' || id) > 0 THEN NULL
                               ELSE COALESCE(orphan_since, ?) END
     WHERE note_id = ? AND deleted_at IS NULL`).run(String(krop || ''), now(), noteId);
}

/**
 * Saetter en notes maerker - hele listen, ikke en tilfoejelse.
 *
 * Navnet er noeglen, ikke id'et: brugeren skriver »drift«, ikke et hex. Der
 * slaas op med `lower()`, saa »Drift« og »drift« er det SAMME maerke - to
 * maerker, der ser ens ud, er den hurtigste vej til et arkiv, ingen kan
 * filtrere i. Maerket oprettes, hvis det ikke findes, og det er med vilje:
 * »opret foerst, hæng paa bagefter« er et trin, ingen vil tage.
 *
 * @returns {string[]} navnene, som de nu staar paa noten.
 */
/**
 * Maerkerne paa en note hoerer til notens EJER - ikke til den, der skriver.
 *
 * `tags` har en `user_id`, og maerkesiden viser mine egne. Skrev en kollega
 * `#drift` i en side, jeg havde delt med ham, ville maerket blive oprettet
 * under HANS konto og haenges paa MIN note: det ville staa paa noten for os
 * begge, men kun i hans maerkeliste - og min egen `tag:drift` ville ikke
 * finde min egen side. Ejeren slaas derfor op paa noten (F11).
 */
function ejerenAf(noteId) {
  const r = db.prepare('SELECT user_id FROM notes WHERE id = ?').get(noteId);
  return r ? r.user_id : null;
}

function saetMaerker(kalder, noteId, navne) {
  const userId = ejerenAf(noteId) || kalder;
  const rene = [];
  for (const raa of Array.isArray(navne) ? navne.slice(0, 50) : []) {
    // Et maerke er ÉT ord uden mellemrum - ellers kan `#drift` i en tekst
    // ikke skelnes fra en saetning, der begynder med et havelaage-tegn.
    const n = str(raa, 60).replace(/^#/, '').replace(/\s+/g, '-').trim();
    if (n && !rene.some((x) => x.toLowerCase() === n.toLowerCase())) rene.push(n);
  }

  db.prepare('DELETE FROM note_tags WHERE note_id = ?').run(noteId);
  for (const navn of rene) {
    let t = db.prepare('SELECT id FROM tags WHERE user_id = ? AND lower(name) = lower(?)')
      .get(userId, navn);
    if (!t) {
      const id = newId();
      db.prepare('INSERT INTO tags (id, user_id, name, created_at) VALUES (?,?,?,?)')
        .run(id, userId, navn, now());
      t = { id };
    }
    db.prepare('INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?,?)').run(noteId, t.id);
  }
  // Maerker vejer 3 i soegningen (DESIGN.md maaling 2) - indekset skal med.
  indekser(noteId);
  return rene;
}

/** Bloed sletning. Papirkurven rydder efter 30 dage (F1). */
function sletNote(userId, id) {
  const raekke = db.prepare(`
    SELECT n.id FROM notes n WHERE n.id = ? AND n.deleted_at IS NULL AND ${SKRIVBAR}`)
    .get(id, userId, userId);
  if (!raekke) return { fejl: 'not_found' };
  const t = now();
  db.prepare('UPDATE notes SET deleted_at = ?, updated_at = ? WHERE id = ?').run(t, t, id);
  db.prepare('DELETE FROM note_fts WHERE note_id = ?').run(id);
  return { ok: true };
}

/* =========================================================== traeet =====
 *
 * Notesboeger med undersider i vilkaarlig dybde (krav 1). Alt herunder
 * respekterer SYNLIG/SKRIVBAR paa samme maade som resten - der er ingen
 * genvej udenom, heller ikke for admin.
 */

/** Notens id + ALLE dens efterkommere, oevers foerst. Bredde-foerst, med loft. */
function undertrae(userId, id, medSlettede) {
  const ud = [];
  let lag = [id];
  const set = new Set([id]);
  // Loftet er en spaerre mod en cyklus i data, ikke mod dybde: flytninger
  // kan ikke lave en (se flytNote), men en import kunne.
  for (let dybde = 0; dybde < 64 && lag.length; dybde++) {
    ud.push(...lag);
    const huller = lag.map(() => '?').join(',');
    const boern = db.prepare(`
      SELECT n.id FROM notes n
       WHERE n.parent_id IN (${huller})
         AND n.deleted_at IS ${medSlettede ? 'NOT NULL' : 'NULL'}
         AND ${SYNLIG}`).all(...lag, userId, userId);
    lag = boern.map((b) => b.id).filter((b) => !set.has(b));
    for (const b of lag) set.add(b);
  }
  return ud;
}

/**
 * Flytter en note - og naegter at lave en cyklus.
 *
 * Uden vagten kan man traekke en note ind under sit eget barn. Traeet bliver
 * saa en ring: begge noter forsvinder fra sidebaren (ingen af dem har en rod),
 * og enhver gennemloebning haenger. Fejlen er TAVS - gemningen lykkes.
 */
function flytNote(userId, id, maal) {
  const note = db.prepare(`
    SELECT n.id, n.user_id, n.notebook_id FROM notes n
     WHERE n.id = ? AND n.deleted_at IS NULL AND ${SKRIVBAR}`).get(id, userId, userId);
  if (!note) return { fejl: 'not_found' };

  const nyForaelder = maal.parentId || null;
  if (nyForaelder) {
    if (nyForaelder === id) return { fejl: 'cycle' };
    // Gaa OP fra den nye foraelder. Naar man moeder sig selv, er det en ring.
    let p = nyForaelder;
    for (let i = 0; i < 64 && p; i++) {
      if (p === id) return { fejl: 'cycle' };
      const r = db.prepare(`SELECT n.parent_id, n.user_id FROM notes n WHERE n.id = ? AND ${SYNLIG}`)
        .get(p, userId, userId);
      if (!r) return { fejl: 'not_found' };
      /*
       * **Et trae har ÉN ejer.**
       *
       * Uden det kunne en note traekkes fra mit arkiv ind under en side, en
       * kollega havde delt med mig - og saa ville MIN note pludselig arve HANS
       * deling, altsaa give adgang til noget, ingen havde delt. Den anden vej
       * er lige saa slem: hans side traukket ind i mit trae ville forsvinde
       * fra hans egen sidebar. Flytninger holder sig inden for én ejer, og
       * »giv noten videre« er sin egen handling.
       */
      if (i === 0 && r.user_id !== note.user_id) return { fejl: 'anden_ejer' };
      p = r.parent_id;
    }
  }

  const felter = { parentId: nyForaelder };
  // En underside hoerer til den notesbog, dens foraelder ligger i. Ellers kan
  // et undertrae vaere spredt over to notesboeger, og sidebaren kan ikke
  // tegne det ét sted.
  if (nyForaelder) {
    const f = db.prepare('SELECT notebook_id FROM notes WHERE id = ?').get(nyForaelder);
    felter.notebookId = f ? f.notebook_id : null;
  } else if (Object.prototype.hasOwnProperty.call(maal, 'notebookId')) {
    felter.notebookId = maal.notebookId || null;
  }

  const svar = gemNote(userId, id, felter);
  if (svar.fejl) return svar;
  // Hele undertraeet foelger med til den nye notesbog.
  if (felter.notebookId !== undefined) {
    for (const b of undertrae(userId, id)) {
      if (b !== id) db.prepare('UPDATE notes SET notebook_id = ? WHERE id = ?').run(felter.notebookId, b);
    }
  }
  return { note: hentNote(userId, id) };
}

/** Duplikerer en note, og valgfrit hele dens undertrae. */
function duplikerNote(userId, id, medBoern) {
  const kilde = hentNote(userId, id);
  if (!kilde) return { fejl: 'not_found' };

  const kort = new Map();
  const ider = medBoern ? undertrae(userId, id) : [id];
  for (const gammelId of ider) {
    const n = hentNote(userId, gammelId);
    if (!n) continue;
    const ny = opretNote(userId, {
      title: gammelId === id ? `${n.title} (copy)` : n.title,
      body: n.body,
      icon: n.icon,
      notebookId: n.notebookId,
      // Foraelderen er KOPIEN af den gamle foraelder, ikke originalen -
      // ellers haenger halvdelen af kopien fast i det oprindelige trae.
      parentId: gammelId === id ? n.parentId : (kort.get(n.parentId) || null),
      // extId er Notions id og maa ALDRIG kopieres: saa ville en genimport
      // tro, at kopien er originalen, og skrive oven i den.
    });
    kort.set(gammelId, ny.id);
    for (const p of n.props || []) {
      db.prepare('INSERT INTO note_props (note_id, key, value, seq) VALUES (?,?,?,0)')
        .run(ny.id, p.key, p.value);
    }
    const maerker = db.prepare('SELECT tag_id FROM note_tags WHERE note_id = ?').all(gammelId);
    for (const m of maerker) {
      db.prepare('INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?,?)').run(ny.id, m.tag_id);
    }
    indekser(ny.id);
  }
  return { note: hentNote(userId, kort.get(id)) };
}

/** Sletter en note OG dens undersider - men markerer, hvem der tog dem med. */
function sletUndertrae(userId, id) {
  /*
   * `EJET`, ikke `SKRIVBAR`.
   *
   * At maatte skrive i en side er ikke det samme som at maatte smide den ud.
   * En kollega, der retter i en delt side, skal ikke kunne tage hele
   * undertraeet med i papirkurven - ejeren ville opdage det bagefter, og han
   * ville ikke vide hvorfor. Det gaelder ogsaa `write`-niveauet (F11).
   */
  const raekke = db.prepare(`
    SELECT n.id FROM notes n WHERE n.id = ? AND n.deleted_at IS NULL AND ${EJET}`)
    .get(id, userId);
  if (!raekke) return { fejl: 'not_found' };
  const ider = undertrae(userId, id);
  const t = now();
  db.exec('BEGIN');
  try {
    for (const b of ider) {
      db.prepare('UPDATE notes SET deleted_at = ?, deleted_root = ?, updated_at = ? WHERE id = ?')
        .run(t, b === id ? null : id, t, b);
      db.prepare('DELETE FROM note_fts WHERE note_id = ?').run(b);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { ok: true, antal: ider.length };
}

/**
 * Gendanner en note og PRAECIS de undersider, sletningen tog med.
 *
 * En underside, brugeren selv slettede i forrige uge, skal blive liggende -
 * derfor `deleted_root`, og ikke »alt hvad der har denne foraelder«.
 */
function gendanNote(userId, id) {
  const raekke = db.prepare(`
    SELECT n.id, n.parent_id FROM notes n
     WHERE n.id = ? AND n.deleted_at IS NOT NULL AND ${SKRIVBAR}`).get(id, userId, userId);
  if (!raekke) return { fejl: 'not_found' };

  // Er foraelderen stadig i papirkurven, ville noten blive usynlig i traeet.
  // Den loesrives i stedet, saa den lander i roden, hvor den kan ses.
  let foraelder = raekke.parent_id;
  if (foraelder) {
    const f = db.prepare('SELECT deleted_at FROM notes WHERE id = ?').get(foraelder);
    if (!f || f.deleted_at) foraelder = null;
  }

  const boern = db.prepare(`
    SELECT n.id FROM notes n
     WHERE n.deleted_root = ? AND n.deleted_at IS NOT NULL AND ${SYNLIG}`)
    .all(id, userId, userId).map((r) => r.id);

  const t = now();
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE notes SET deleted_at = NULL, deleted_root = NULL, parent_id = ?, updated_at = ? WHERE id = ?')
      .run(foraelder, t, id);
    for (const b of boern) {
      db.prepare('UPDATE notes SET deleted_at = NULL, deleted_root = NULL, updated_at = ? WHERE id = ?').run(t, b);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  for (const b of [id, ...boern]) indekser(b);
  return { note: hentNote(userId, id), antal: boern.length + 1 };
}

/**
 * Manuel sortering. ÉN transaktion, seq = plads i listen.
 *
 * Knapper, ikke traek-og-slip: HTML5 DnD virker ikke paa touch, og ↑↓ er den
 * ene loesning, der virker med mus, tastatur og tommelfinger paa én gang
 * (RUNE-ERFARINGER §4 + doda F3).
 */
function omorden(userId, slags, ider) {
  const tabel = slags === 'notebook' ? 'notebooks' : 'notes';
  if (!Array.isArray(ider) || ider.length > 2000) return { fejl: 'bad_request' };
  db.exec('BEGIN');
  try {
    ider.forEach((id, i) => {
      // user_id i WHERE: en fremmed raekke kan ikke omordnes, heller ikke ved
      // at blande sit id ind i listen.
      db.prepare(`UPDATE ${tabel} SET seq = ? WHERE id = ? AND user_id = ?`).run(i, String(id), userId);
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { ok: true };
}

/**
 * Skriver notens [[henvisninger]] til link-tabellen.
 *
 * Tabellen rives NED og bygges op igen ved hvert gem - den diffes ikke.
 * Teksten er sandheden, tabellen er kun et indeks over den, og en diff er en
 * anden beskrivelse af det samme faktum, som kan blive uenig med teksten.
 * Det er dét, den her aldrig maa.
 */
function opdaterLinks(userId, noteId, body) {
  db.prepare('DELETE FROM note_links WHERE from_id = ?').run(noteId);
  const titler = markdown.wikiLinks(body);
  if (!titler.length) return;
  for (const t of titler.slice(0, 200)) {
    const maal = db.prepare(`
      SELECT id FROM notes
       WHERE user_id = ? AND deleted_at IS NULL AND lower(title) = lower(?) LIMIT 1`).get(userId, t);
    // En henvisning til noget, der ikke findes, gemmes ikke som en raekke -
    // den staar i teksten og vises som en doed henvisning. Rykker nogen
    // senere en note med den titel ind, bliver linket levende ved naeste gem.
    if (maal && maal.id !== noteId) {
      db.prepare('INSERT OR IGNORE INTO note_links (from_id, to_id) VALUES (?,?)').run(noteId, maal.id);
    }
  }
}

/* ------------------------------------------------- versionshistorik (F22) */

const VERSIONER_STANDARD = 30;
const VERSIONER_MIN = 1;
// 200 er ogsaa loftet i listeopslaget. To tal, der skal passe sammen, er ét
// tal for meget - saa staar de her, og forespoergslen bruger dette.
const VERSIONER_MAKS = 200;
/*
 * Hvor taet to gemninger maa ligge, foer de taeller som ÉN version.
 *
 * Uden den her ville hver eneste autogemning give en raekke: editoren gemmer
 * ~900 ms efter man holder op med at taste, saa en halv times skrivning
 * bliver til hundredvis af »versioner«, der alle ligner hinanden - og de
 * 30, man kan gaa tilbage, daekker saa de sidste to minutter.
 *
 * Vi beholder den FOERSTE i vinduet, ikke den sidste: en version skal vise,
 * hvordan noten saa ud FOER den skrivepause, man vil tilbage til.
 */
const VERSIONER_SAMLE = 5 * 60;

/**
 * Beskaerer HVER af brugerens noter til graensen.
 *
 * ── Hvorfor den findes ────────────────────────────────────────────────────
 *
 * `gemVersion` rydder kun op i den note, den lige har skrevet. En note, man
 * aldrig rører igen, beholder derfor sin ophobning - og historikken har vaeret
 * skrevet til siden F1 helt uden graense. Andreas' arkiv har altsaa maaneders
 * raekker liggende for noter, der ikke bliver redigeret mere.
 *
 * »Det burde også være en funktion så hvis man ændrer antallet af versioner
 * så skal den lave en oprydning automatisk« (Andreas, 2026-08-25). Den koeres
 * derfor to steder: naar antallet aendres, og én gang ved opstart.
 *
 * ÉT udsagn for alle noter, ikke ét pr. note: `NOT IN (…LIMIT ?)` pr. note
 * ville vaere 247 forespoergsler paa en almindelig opstart.
 *
 * @returns {number} hvor mange raekker der forsvandt.
 */
function beskaerAlleVersioner(userId, keep) {
  const r = db.prepare(`
    DELETE FROM note_versions WHERE id IN (
      SELECT id FROM (
        SELECT v.id, ROW_NUMBER() OVER (PARTITION BY v.note_id ORDER BY v.at DESC, v.rowid DESC) AS nr
          FROM note_versions v JOIN notes n ON n.id = v.note_id
         WHERE n.user_id = ?
      ) WHERE nr > ?)`).run(userId, keep);
  return r.changes || 0;
}

function versionsOpsaetning(userId) {
  const slaaet = getSetting(userId, 'versions_off', '') !== '1';
  const raa = Number(getSetting(userId, 'versions_keep', ''));
  const antal = Number.isFinite(raa) && raa >= VERSIONER_MIN && raa <= VERSIONER_MAKS
    ? Math.round(raa) : VERSIONER_STANDARD;
  return { enabled: slaaet, keep: antal };
}

/**
 * Gemmer notens NUVAERENDE indhold som en version - foer den bliver aendret.
 *
 * Kaldes altsaa med vilje FOER skrivningen: en version er det, man kan gaa
 * tilbage TIL, ikke det man lige har lavet.
 */
/**
 * @param {boolean} tving  Springer skrivestunds-vinduet over.
 *   Saettes ved en GENDANNELSE: dér skal den tilstand, man erstatter, ALTID
 *   gemmes. Uden det kunne en gendannelse falde ind i vinduet efter den
 *   rettelse, man fortryder - og saa var det, man gik vaek fra, vaek for
 *   altid. Maalt: gendan lige efter en rettelse, og »skrevet om« fandtes
 *   ingen steder bagefter.
 */
function gemVersion(noteId, userId, tving) {
  const opsaet = versionsOpsaetning(userId);
  if (!opsaet.enabled) return;
  const r = db.prepare('SELECT title, body_md FROM notes WHERE id = ?').get(noteId);
  if (!r) return;

  const t = now();
  const nyeste = db.prepare(`SELECT at, title, body_md FROM note_versions
                              WHERE note_id = ? ORDER BY at DESC, rowid DESC LIMIT 1`).get(noteId);
  // Samme skrivestund som sidst? Saa er den allerede repraesenteret.
  if (!tving && nyeste && t - nyeste.at < VERSIONER_SAMLE) return;
  /*
   * To ENS versioner i traek er spild af en plads ud af tredive.
   *
   * Det sker af sig selv: en rettelse, der kun roerer titlen, laver en
   * version af den uaendrede krop - og en gendannelse tilbage til noget,
   * der allerede staar. Sammenligningen er ordret; to versioner, der ser ens
   * ud, er ens.
   */
  if (nyeste && nyeste.title === r.title && nyeste.body_md === r.body_md) return;

  db.prepare('INSERT INTO note_versions (id, note_id, title, body_md, at, user_id) VALUES (?,?,?,?,?,?)')
    .run(newId(), noteId, r.title, r.body_md, t, userId);

  /*
   * Ryd op MED DET SAMME, ikke ved en lejlighed.
   *
   * Tabellen har vaeret skrevet til siden F1 uden nogen graense - der er
   * ingen oprydning at udskyde til, og en historik, der vokser i det
   * uendelige, er en database, der bliver langsom af noget, ingen bad om.
   */
  db.prepare(`DELETE FROM note_versions WHERE note_id = ? AND id NOT IN (
                SELECT id FROM note_versions WHERE note_id = ?
                 ORDER BY at DESC, rowid DESC LIMIT ?)`)
    .run(noteId, noteId, opsaet.keep);
}

/* ------------------------------------------------------------ notesboeger */

/* ============================== favoritter og spor (F13) ============== */

/*
 * To lister, der begge er MINE.
 *
 * De laeses gennem `hentNoter`-agtige opslag med `SYNLIG`, saa en note, jeg
 * har mistet adgangen til, forsvinder af sig selv - baade fra stjernerne og
 * fra sporet. Raekken bliver liggende; det er billigere end at rydde op ved
 * hver tilbagekaldelse, og den kan ikke ses (F11).
 */

function hentFavoritter(userId) {
  const raekker = db.prepare(`
    SELECT ${NOTE_LISTE_FELTER}, (n.user_id = ?) AS er_ejer, f.seq AS fav_seq
      FROM favorites f JOIN notes n ON n.id = f.note_id
     WHERE f.user_id = ? AND n.deleted_at IS NULL AND ${SYNLIG}
     ORDER BY f.seq, f.created_at
     LIMIT 100`).all(userId, userId, userId, userId);
  return raekker.map((r) => formNote(r, false, userId));
}

function saetFavorit(userId, noteId, paa) {
  if (!hentNote(userId, noteId)) return { fejl: [404, 'not_found', 'No such note.'] };
  if (paa) {
    const seq = db.prepare('SELECT COALESCE(MAX(seq), -1) + 1 AS n FROM favorites WHERE user_id = ?')
      .get(userId).n;
    db.prepare(`INSERT INTO favorites (user_id, note_id, seq, created_at) VALUES (?,?,?,?)
                ON CONFLICT(user_id, note_id) DO NOTHING`).run(userId, noteId, seq, now());
  } else {
    db.prepare('DELETE FROM favorites WHERE user_id = ? AND note_id = ?').run(userId, noteId);
  }
  return { favorite: !!paa };
}

/**
 * Sporet. ÉN raekke pr. note - ikke én pr. besoeg.
 *
 * Kaldes hver gang en note aabnes, saa den skal vaere billig: én UPSERT paa
 * en primaernoegle. Og den maa ALDRIG kunne faelde selve aabningen - derfor
 * kaldes den uden for det svar, der betyder noget.
 */
function noterBesoeg(userId, noteId) {
  try {
    const seq = db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM note_visits WHERE user_id = ?')
      .get(userId).n;
    db.prepare(`INSERT INTO note_visits (user_id, note_id, seq, at) VALUES (?,?,?,?)
                ON CONFLICT(user_id, note_id) DO UPDATE SET seq = excluded.seq, at = excluded.at`)
      .run(userId, noteId, seq, now());
  } catch (err) { logError(`kunne ikke notere besoeg: ${err.message}`); }
}

function senesteNoter(userId, graense) {
  const raekker = db.prepare(`
    SELECT ${NOTE_LISTE_FELTER}, (n.user_id = ?) AS er_ejer, v.at AS besoegt
      FROM note_visits v JOIN notes n ON n.id = v.note_id
     WHERE v.user_id = ? AND n.deleted_at IS NULL AND ${SYNLIG}
     ORDER BY v.seq DESC
     LIMIT ?`).all(userId, userId, userId, userId, Math.min(Number(graense) || 8, 50));
  return raekker.map((r) => Object.assign(formNote(r, false, userId), { visitedAt: r.besoegt }));
}

/** Maerkerne, i navneorden. Brugt af /state og af MCP'ens list_tags. */
function hentMaerker(userId) {
  return db.prepare('SELECT id, name FROM tags WHERE user_id = ? ORDER BY name').all(userId);
}

/* ==================================================== deling (F11) ====== */

/*
 * Deling mellem konti.
 *
 * ── Hvad en deling ER ─────────────────────────────────────────────────────
 *
 * Én raekke i `note_acl`: en note, en bruger, et niveau (`read`/`write`) og
 * `tree` - om det, der ligger under siden, foelger med. Alt andet regnes ud
 * af det levende trae af `SYNLIG`/`SKRIVBAR`, saa der er intet at holde i
 * takt, naar nogen laver en underside eller flytter en.
 *
 * ── Hvad en deling IKKE er ────────────────────────────────────────────────
 *
 * `write` betyder »skriv i den«, ikke »bestem over den«. **Fire ting kan kun
 * ejeren:** slette, udgive, dele videre og give noten fra sig. Ellers ville
 * en kollega, der maa rette i en side, kunne laegge hele undertraeet paa det
 * aabne net eller i papirkurven - og ejeren ville opdage det bagefter.
 */

/** Alle konti. Kun for en indlogget bruger - aldrig gennem en noegle. */
function hentPersoner(udenId) {
  return db.prepare(`SELECT id, username, is_admin FROM users
                      WHERE id != ? ORDER BY username`).all(udenId)
    .map((u) => ({ id: u.id, username: u.username, isAdmin: !!u.is_admin }));
}

/** Hvem noten er delt med. Ejeren spoerger; de andre faar deres eget niveau. */
function hentAdgang(userId, noteId) {
  const note = db.prepare('SELECT id, user_id FROM notes WHERE id = ? AND deleted_at IS NULL').get(noteId);
  if (!note || !hentNote(userId, noteId)) return null;
  const ejer = db.prepare('SELECT id, username FROM users WHERE id = ?').get(note.user_id);
  const mit = db.prepare('SELECT level, tree FROM note_acl WHERE note_id = ? AND user_id = ?')
    .get(noteId, userId);
  return {
    owner: ejer ? { id: ejer.id, username: ejer.username } : null,
    mine: note.user_id === userId,
    myLevel: note.user_id === userId ? 'owner' : (mit ? mit.level : null),
    /*
     * Listen er EJERENS.
     *
     * En kollega, noten er delt med, faar en tom liste - ikke fordi den er
     * hemmelig, men fordi den ikke er hans at rette i, og en liste, man ikke
     * kan aendre, ligner en, der er gaaet i stykker. Han kan se, hvem der
     * ejer siden, og det er dét, han skal bruge.
     */
    people: note.user_id === userId ? db.prepare(`
      SELECT a.user_id, a.level, a.tree, a.created_at, u.username
        FROM note_acl a JOIN users u ON u.id = a.user_id
       WHERE a.note_id = ? ORDER BY u.username`).all(noteId)
      .map((a) => ({
        userId: a.user_id, username: a.username, level: a.level,
        tree: !!a.tree, createdAt: a.created_at,
      })) : [],
  };
}

/**
 * Del en note med en anden konto.
 *
 * @returns {{delt}|{fejl: [status, kode, besked]}}
 */
function delNote(userId, noteId, o) {
  if (!ejerAf(userId, noteId)) {
    // Samme 404 som en note, der ikke findes: en 403 ville bekraefte, at
    // siden er der, for enhver der gaetter et id.
    return { fejl: [404, 'not_found', 'No such note.'] };
  }
  const navn = str(o.username, 80);
  const modtager = db.prepare('SELECT id, username FROM users WHERE lower(username) = lower(?)').get(navn);
  if (!modtager) return { fejl: [404, 'no_such_user', `There is no account called “${navn}”.`] };
  if (modtager.id === userId) {
    return { fejl: [400, 'already_yours', 'That page is already yours.'] };
  }
  const level = o.level === 'write' ? 'write' : 'read';
  // Undertraeet foelger med som udgangspunkt - det er sadan et arkiv deles.
  const tree = o.tree === false ? 0 : 1;
  db.prepare(`INSERT INTO note_acl (note_id, user_id, level, tree, created_at) VALUES (?,?,?,?,?)
              ON CONFLICT(note_id, user_id) DO UPDATE SET level = excluded.level, tree = excluded.tree`)
    .run(noteId, modtager.id, level, tree, now());
  audit('note-delt', userId, noteId, `${modtager.username}:${level}${tree ? '+trae' : ''}`);
  return { delt: { userId: modtager.id, username: modtager.username, level, tree: !!tree } };
}

/** Tag delingen tilbage. Virker ved NAESTE kald - der er ingen cache. */
function fjernDeling(userId, noteId, modtagerId) {
  if (!ejerAf(userId, noteId)) return { fejl: [404, 'not_found', 'No such note.'] };
  const r = db.prepare('DELETE FROM note_acl WHERE note_id = ? AND user_id = ?').run(noteId, modtagerId);
  if (!r.changes) return { fejl: [404, 'not_found', 'That person does not have access.'] };
  audit('deling-fjernet', userId, noteId, modtagerId);
  return { ok: true };
}

/**
 * Giv noten - og alt under den - videre til en anden konto.
 *
 * Tre ting sker, og alle tre er noedvendige:
 *
 *  1. **Hele undertraeet skifter ejer.** Et trae har ÉN ejer; skiftede kun
 *     toppen, ville undersiderne blive haengende hos den gamle ejer og
 *     forsvinde fra den nye sidebar.
 *  2. **Notesbogen ryddes, og noten bliver en rod.** `notebook_id` peger paa
 *     en bog, den GAMLE ejer ejer - den nye har den ikke, og en note i en
 *     fremmed bog kan ikke tegnes noget sted.
 *  3. **Den gamle ejer beholder `write`-adgang.** Ellers ville »giv videre«
 *     vaere det samme som at miste siden, og det er ikke det, nogen mener.
 *     Han kan fjerne sig selv bagefter; det er hans valg, ikke en bivirkning.
 */
function givVidere(userId, noteId, navnRaa) {
  if (!ejerAf(userId, noteId)) return { fejl: [404, 'not_found', 'No such note.'] };
  const navn = str(navnRaa, 80);
  const ny = db.prepare('SELECT id, username FROM users WHERE lower(username) = lower(?)').get(navn);
  if (!ny) return { fejl: [404, 'no_such_user', `There is no account called “${navn}”.`] };
  if (ny.id === userId) return { fejl: [400, 'already_yours', 'That page is already yours.'] };

  const ider = undertrae(userId, noteId);
  const t = now();
  db.exec('BEGIN');
  try {
    for (const b of ider) {
      db.prepare('UPDATE notes SET user_id = ?, notebook_id = NULL, updated_at = ? WHERE id = ?')
        .run(ny.id, t, b);
      // Den nye ejer maa ikke staa som »delt med« paa sin egen side.
      db.prepare('DELETE FROM note_acl WHERE note_id = ? AND user_id = ?').run(b, ny.id);
    }
    db.prepare('UPDATE notes SET parent_id = NULL WHERE id = ?').run(noteId);
    db.prepare(`INSERT INTO note_acl (note_id, user_id, level, tree, created_at) VALUES (?,?,?,?,?)
                ON CONFLICT(note_id, user_id) DO UPDATE SET level = 'write', tree = 1`)
      .run(noteId, userId, 'write', 1, t);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  audit('note-givet-videre', userId, noteId, ny.username);
  return { ok: true, antal: ider.length, newOwner: { id: ny.id, username: ny.username } };
}

/** Det, ANDRE har delt med mig. Aldrig mine egne - de staar under All notes. */
function deltMedMig(userId) {
  const raekker = db.prepare(`
    SELECT ${NOTE_LISTE_FELTER}, 0 AS er_ejer, u.username AS ejernavn,
           /*
            * Raekken staar altid paa noten SELV her.
            *
            * Listen viser kun toppen af det, jeg har faaet (se nedenfor), og
            * en note, hvis adgang kom fra en forfader, ville have den
            * forfader med i listen i stedet. Derfor ingen gennemloebning.
            */
           (SELECT a.level FROM note_acl a
             WHERE a.user_id = ? AND a.note_id = n.id) AS niveau
      FROM notes n JOIN users u ON u.id = n.user_id
     WHERE n.deleted_at IS NULL AND n.user_id != ? AND ${SYNLIG}
       /*
        * Kun TOPPEN af det, der er delt.
        *
        * Uden det ville en delt bog paa halvtreds sider fylde listen med
        * halvtreds raekker, som alle sammen ligger under den samme forside.
        * En side hoerer med i listen, hvis dens foraelder IKKE ogsaa er
        * synlig for mig - saa er den roden af det, jeg har faaet.
        */
       AND NOT EXISTS (
         SELECT 1 FROM notes p
          WHERE p.id = n.parent_id AND p.deleted_at IS NULL AND ${synligFor('p')}
       )
     ORDER BY n.updated_at DESC
     LIMIT 500`).all(userId, userId, userId, userId, userId, userId);
  return medFilantal(medMaerker(raekker.map((r) => Object.assign(formNote(r, false, userId), {
    owner: r.ejernavn,
    level: r.niveau || 'read',
  }))));
}

function hentNotesboeger(userId) {
  /*
   * `published` med i ét opslag - ikke ét pr. bog.
   *
   * Sidebaren viser en globus paa de boeger, der er udgivet, og den skal
   * kunne tegnes uden tretten ekstra forespoergsler (RUNE-ERFARINGER §4:
   * aldrig en forespoergsel pr. raekke).
   */
  return db.prepare(`
    SELECT b.id, b.name, b.icon, b.seq, b.archived_at, b.created_at, b.updated_at,
           EXISTS (SELECT 1 FROM shares s
                    WHERE s.notebook_id = b.id AND s.revoked_at IS NULL) AS udgivet
      FROM notebooks b WHERE b.user_id = ? AND b.deleted_at IS NULL
     ORDER BY b.seq, b.name`).all(userId)
    .map((b) => Object.assign({}, b, { published: !!b.udgivet, udgivet: undefined }));
}

function opretNotesbog(userId, navn, ikon) {
  const t = now();
  const id = newId();
  db.prepare(`INSERT INTO notebooks (id, user_id, name, icon, seq, created_at, updated_at)
              VALUES (?,?,?,?,?,?,?)`)
    .run(id, userId, str(navn, 200) || 'Untitled', str(ikon, 16),
      naesteSeq('notebooks', 'user_id = ?', userId), t, t);
  return db.prepare('SELECT id, name, icon, seq, archived_at, created_at, updated_at FROM notebooks WHERE id = ?').get(id);
}

/* ------------------------------------------------------------- soegning */

/**
 * Skriver noten ind i FTS-indekset. Kaldes ved hvert gem.
 *
 * Overskrifterne trkkes ud som en egen kolonne, saa de kan vaegtes hoejere
 * end broedteksten - det er halvdelen af svaret paa "Notions wiki-soegning
 * finder reelt kun overskrifter" (SAGU-PLAN §5).
 */
/**
 * Danske bogstaver, som FTS5 ikke folder selv.
 *
 * `unicode61 remove_diacritics 2` klarer Å → A, fordi Å ER et A med en ring.
 * ø og æ er derimod selvstaendige bogstaver i Unicode, ikke accentformer, og
 * bliver derfor staaende. Det betyder, at »grøn« ikke kan findes ved at taste
 * »gron« - hvilket er praecis, hvad man goer paa et tastatur, der ikke er ens
 * eget.
 *
 * Begge stavemaader indekseres, for vi ved ikke hvilken brugeren vaelger:
 * »grøn« bliver til »groen gron«. Saa er der ingen grund til at folde
 * SOEGNINGEN - den rammer enten broedteksten (»grøn«) eller denne kolonne
 * (»groen« / »gron«).
 *
 * Kolonnen vaegtes som broedteksten i bm25. Vaegter man den hoejere, kommer et
 * foldet traef foran et eksakt.
 *
 * NB: kortlaegningen her er DANSK. Tysk vil have ü → ue, svensk er uenig med
 * dansk om ä, og tyrkisk har et prikloest ı, som naiv smaaskrivning oedelaegger.
 * Skal Sagu en dag rumme et andet sprog, er det en ny kortlaegning - ikke en
 * udvidelse af denne.
 */
function foldDansk(s) {
  const tekst = String(s || '');
  if (!/[æøåÆØÅ]/.test(tekst)) return '';
  const lang = tekst.replace(/ø/g, 'oe').replace(/Ø/g, 'Oe')
    .replace(/æ/g, 'ae').replace(/Æ/g, 'Ae')
    .replace(/å/g, 'aa').replace(/Å/g, 'Aa');
  const kort = tekst.replace(/[øØ]/g, 'o').replace(/[æÆ]/g, 'a').replace(/[åÅ]/g, 'a');
  return `${lang}\n${kort}`;
}

function indekser(noteId) {
  const n = db.prepare('SELECT id, user_id, title, body_md, deleted_at FROM notes WHERE id = ?').get(noteId);
  db.prepare('DELETE FROM note_fts WHERE note_id = ?').run(noteId);
  if (!n || n.deleted_at) return;
  const overskrifter = (n.body_md.match(/^#{1,6} +.+$/gm) || [])
    .map((l) => l.replace(/^#+ +/, '')).join('\n');
  const maerker = db.prepare(`
    SELECT t.name FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = ?`)
    .all(noteId).map((t) => t.name);
  const props = db.prepare('SELECT key, value FROM note_props WHERE note_id = ?')
    .all(noteId).map((p) => `${p.key} ${p.value}`);
  const meta = maerker.concat(props).join(' ');
  /*
   * Ingen `user_id` her. Indekset afgraenser ingenting - `SYNLIG` gør det, paa
   * `notes`, hvor ejerskabet faktisk staar (m12).
   */
  db.prepare(`INSERT INTO note_fts (title, headings, body, meta, folded, note_id)
              VALUES (?,?,?,?,?,?)`)
    .run(n.title, overskrifter, n.body_md, meta,
      foldDansk(`${n.title}\n${overskrifter}\n${n.body_md}\n${meta}`), n.id);
}

/** Genopbygger hele indekset. Bruges efter import (F5) og ved skemaskift. */
function genopbygIndeks() {
  db.exec('DELETE FROM note_fts');
  const ider = db.prepare('SELECT id FROM notes WHERE deleted_at IS NULL').all();
  for (const r of ider) indekser(r.id);
  return ider.length;
}

/**
 * Oversaetter brugerens ord til en FTS5-forespoergsel.
 *
 * FTS5's MATCH-syntaks er et sprog: `"`, `*`, `NEAR`, `OR`, `-` og
 * kolonnefiltre betyder noget. Brugerens ord er IKKE et program, saa hvert
 * ord pakkes i anfoerselstegn (som gør det til en frase-literal) og faar en
 * praefiks-stjerne udenfor. `drif` finder saa `drift` - en skrivefejl maa
 * ikke vaere en blindgyde (SAGU-PLAN §5).
 */
function ftsUdtryk(raa) {
  const ord = String(raa || '').toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((o) => o.length > 0)
    .slice(0, 12);
  if (!ord.length) return null;
  return ord.map((o) => `"${o.replace(/"/g, '""')}"*`).join(' ');
}

/**
 * FTS-udtrykket for en tolket forespoergsel.
 *
 * Forskellen paa et ORD og en FRASE er hele grunden til, at den her findes ved
 * siden af ftsUdtryk: `"blaa bil"` skal betyde de to ord i den raekkefoelge,
 * ikke to loese ord. I FTS5 er en frase praecis en citeret streng med flere
 * ord - men den maa saa IKKE have en praefiks-stjerne paa, for stjernen
 * gaelder kun sidste token og ville goere fraseen til noget andet.
 */
function ftsUdtrykFor(t) {
  const dele = [];
  for (const o of t.termer) {
    const rent = o.toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter(Boolean);
    // Et "ord" som en URL bliver til flere tokens; de skal alle med.
    for (const x of rent) dele.push(`"${x.replace(/"/g, '""')}"*`);
  }
  for (const f of t.fraser) {
    const rent = f.toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter(Boolean);
    if (rent.length) dele.push(`"${rent.join(' ')}"`);
  }
  return dele.length ? dele.slice(0, 16).join(' ') : null;
}

/**
 * Hvilket AFSNIT staar traefferen i?
 *
 * »Et link, der hopper til afsnittet - ikke til toppen af en lang side. Det
 * alene er forskellen paa Notions« (SAGU-PLAN §5). Vi finder foerste
 * forekomst af et af ordene og gaar OP til naermeste overskrift.
 *
 * Kun for de ~30 traeffere, der faktisk vises - ikke for hele datasaettet.
 */
function afsnitFor(body, ord) {
  if (!ord.length) return null;
  const lav = body.toLowerCase();
  let pos = -1;
  for (const o of ord) {
    const p = lav.indexOf(o.toLowerCase());
    if (p >= 0 && (pos < 0 || p < pos)) pos = p;
  }
  if (pos < 0) return null;
  const linje = body.slice(0, pos).split('\n').length - 1;
  const blokke = markdown.blokke(body);
  let sidste = null;
  for (const b of blokke) {
    if (b.slags === 'overskrift' && b.fra <= linje) sidste = b;
    if (b.fra > linje) break;
  }
  if (!sidste) return null;
  // Samme id som rendereren giver overskriften - ellers peger ankeret
  // ingen steder hen.
  const set = new Set();
  for (const b of blokke) {
    if (b.slags !== 'overskrift') continue;
    let id = markdown.slug(b.tekst);
    let k = 2;
    while (set.has(id)) { id = `${markdown.slug(b.tekst)}-${k}`; k++; }
    set.add(id);
    if (b === sidste) return { id, tekst: b.tekst };
  }
  return null;
}

/** LIKE-jokertegn i brugerens ord maa ikke betyde noget. */
function likeEsc(s) {
  return String(s).replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** SQL-fragmenter for `has:`-filtrene. Body er allerede hentet, saa det er LIKE. */
const HAS_SQL = {
  code: "n.body_md LIKE '%```%'",
  image: "n.body_md LIKE '%![%](%'",
  link: "(n.body_md LIKE '%](http%' OR n.body_md LIKE '%[[%]]%')",
  todo: "(n.body_md LIKE '%- [ ]%' OR n.body_md LIKE '%- [x]%')",
  table: "n.body_md LIKE '%|%|%'",
};

/**
 * Bygger de WHERE-led, filtrene giver. Gaelder BEGGE soegeveje (FTS og LIKE),
 * saa et filter ikke pludselig betyder noget andet, naar indekset er tomt.
 */
function filterLed(userId, t) {
  const hvor = [];
  const arg = [];
  for (const maerke of t.tags) {
    hvor.push(`EXISTS (SELECT 1 FROM note_tags nt JOIN tags tg ON tg.id = nt.tag_id
                        WHERE nt.note_id = n.id AND lower(tg.name) = ?)`);
    arg.push(maerke);
  }
  if (t.alder) {
    hvor.push(`n.updated_at ${t.alder.retning === '<' ? '>=' : '<'} ?`);
    arg.push(now() - t.alder.sekunder);
  }
  for (const h of t.has) if (HAS_SQL[h]) hvor.push(HAS_SQL[h]);
  for (const u of t.uden) {
    hvor.push("(lower(n.title) NOT LIKE ? ESCAPE '\\' AND lower(n.body_md) NOT LIKE ? ESCAPE '\\')");
    const m = `%${likeEsc(u.toLowerCase())}%`;
    arg.push(m, m);
  }
  if (t.i) {
    // `in:` er enten en notesbog eller en side, man er UNDER. Begge dele er
    // det, folk mener - og at kraeve at de ved hvilken, ville vaere en
    // syntaks mere at huske.
    const bog = db.prepare(`SELECT id FROM notebooks
                             WHERE user_id = ? AND deleted_at IS NULL AND lower(name) = lower(?)`)
      .get(userId, t.i);
    const side = db.prepare(`SELECT id FROM notes
                              WHERE user_id = ? AND deleted_at IS NULL AND lower(title) = lower(?) LIMIT 1`)
      .get(userId, t.i);
    if (bog) { hvor.push('n.notebook_id = ?'); arg.push(bog.id); }
    else if (side) {
      const ider = undertrae(userId, side.id);
      hvor.push(`n.id IN (${ider.map(() => '?').join(',')})`);
      arg.push(...ider);
    } else {
      // Et ukendt navn skal give NUL traeffere, ikke ignoreres - ellers
      // ligner et filter, der ikke virker, en soegning der virker.
      hvor.push('0');
    }
  }
  return { hvor, arg };
}

/**
 * Soeger.
 *
 * To lag, i den raekkefoelge de svarer:
 *
 *  1. **FTS5, rangeret.** Titel vejer ti gange broedteksten: et ord i titlen
 *     er hvad noten HANDLER om, det samme ord ét sted i en lang tekst er en
 *     omtale.
 *  2. **Teksten, naar indekset intet fandt.** Et indeks er bygget af tokens,
 *     og en tokenizer kan ikke se et ord INDE i et ord: `keepInventory` er ét
 *     token, saa en soegning paa »inventory« finder ingenting, selv om noten
 *     staar der. Et arkiv af driftsdokumentation er fuldt af den slags
 *     (`backup-nat.log`, `logAnonymizer`). Faldet tilbage rangerer ikke -
 *     der ER ingen rangering, naar der ikke var en traeffer at rangere.
 *
 * Ved ~100.000 noter er et ledende `%` den forkerte form, og svaret er en
 * trigram-tokenizer (maalt til stede i Node's FTS5), ikke en stoerre scanning.
 */
/**
 * @param {object} [ekstra]
 *   `ider`  afgraens til netop disse noter (wikien: kun det udgivne undertrae).
 *   `scope` hvad en tom soegning logges under i search_miss.
 *
 * Wikiens soegning gaar gennem DENNE funktion. Lagde den sin egen SQL ved
 * siden af, ville rangering, uddrag og afsnits-anker drive fra hinanden - og
 * en spaerring, der kun staar ét af stederne, er ingen spaerring.
 */
function soegNoter(userId, raa, limit, ekstra) {
  const e = ekstra || {};
  const t = soeg.tolk(raa);
  const graense = Math.min(Number(limit) || 30, 200);
  if (!t.tekst && !t.harFiltre) return { results: [], fallback: false };

  const f = filterLed(userId, t);
  const basis = ['n.deleted_at IS NULL', SYNLIG].concat(f.hvor);
  const basisArg = [userId, userId].concat(f.arg);
  if (e.ider) {
    // En tom liste er ikke "ingen afgraensning" - den er "ingenting".
    if (!e.ider.length) return { results: [], fallback: false };
    basis.push(`n.id IN (${e.ider.map(() => '?').join(',')})`);
    basisArg.push(...e.ider);
  }

  let raekker = [];
  let fallback = false;

  const udtryk = ftsUdtrykFor(t);
  if (udtryk) {
    /*
     * Der staar IKKE et filter paa `fts.user_id` i den her forespoergsel.
     *
     * Indekset baerer sin EJERS id, saa den linje kunne aldrig finde en note,
     * nogen havde delt med mig - mens fallback-grenen nedenfor godt kunne.
     * Soegningen ville altsaa finde en delt note PRAECIS naar indekset ikke
     * ramte, og ellers ikke: en fejl, der ligner et daarligt soegeord.
     * `SYNLIG` staar i `basis` og gaelder `n`, hvor den hoerer hjemme (F11).
     */
    raekker = db.prepare(`
      SELECT n.id,
             snippet(note_fts, 2, '<<', '>>', '…', 14) AS uddrag,
             bm25(note_fts, 10.0, 5.0, 1.0, 3.0, 1.0) AS rang
        FROM note_fts fts JOIN notes n ON n.id = fts.note_id
       WHERE note_fts MATCH ? AND ${basis.join(' AND ')}
       ORDER BY rang
       LIMIT ?`).all(udtryk, ...basisArg, graense);
  }

  if (!raekker.length && t.tekst) {
    // Ordene skal ALLE forekomme et sted i noten - i et hvilket som helst ord.
    // Den foldede kolonne daekker titel, broedtekst og ø/æ paa én gang.
    fallback = true;
    const ord = t.termer.concat(t.fraser).filter(Boolean).slice(0, 8);

    /*
     * Foldningen regnes i SQL, ikke ved at joine note_fts.
     *
     * Foerste udgave gjorde netop det - og `note_fts.note_id` er UNINDEXED,
     * saa joinet blev en scanning af hele FTS-tabellen PR. NOTE. Maalt paa
     * 5.000 noter: **4.297 ms**. Med tre `replace()` i stedet er det én
     * scanning: **~30 ms**.
     *
     * Lærestregen er generel: en UNINDEXED FTS5-kolonne kan hentes, men ALDRIG
     * joines paa. Den har intet indeks - det er dét ordet betyder.
     */
    const FOLDET = "replace(replace(replace(lower(n.title || ' ' || n.body_md),"
      + "'ø','o'),'æ','a'),'å','a')";
    const led = ord.map(() => `(lower(n.title || ' ' || n.body_md) LIKE ? ESCAPE '\\' `
      + `OR ${FOLDET} LIKE ? ESCAPE '\\')`).join(' AND ');
    const arg = [];
    for (const o of ord) {
      arg.push(`%${likeEsc(o.toLowerCase())}%`, `%${likeEsc(soeg.fold(o))}%`);
    }
    raekker = db.prepare(`
      SELECT n.id, '' AS uddrag, 0 AS rang
        FROM notes n
       WHERE ${basis.join(' AND ')} AND ${led}
       ORDER BY n.updated_at DESC
       LIMIT ?`).all(...basisArg, ...arg, graense);
  }

  if (!raekker.length && !t.tekst && t.harFiltre) {
    // Kun filtre: saa ER listen svaret.
    raekker = db.prepare(`
      SELECT n.id, '' AS uddrag, 0 AS rang FROM notes n
       WHERE ${basis.join(' AND ')} ORDER BY n.updated_at DESC LIMIT ?`)
      .all(...basisArg, graense);
  }

  if (!raekker.length) {
    // Kun ordene logges, aldrig hvem. Listen »det, folk soegte efter uden at
    // finde noget« er den bedste indholdsplan, en wiki kan faa (§5).
    if (t.tekst) {
      db.prepare('INSERT INTO search_miss (term, scope, at) VALUES (?,?,?)')
        .run(t.tekst.slice(0, 120), e.scope || '', now());
    }
    return { results: [], fallback };
  }

  const kort = new Map(raekker.map((r) => [r.id, r]));
  const huller = raekker.map(() => '?').join(',');
  const noter = db.prepare(`
    SELECT ${NOTE_LISTE_FELTER}, n.body_md, 1 AS er_ejer FROM notes n
     WHERE n.id IN (${huller})`).all(...raekker.map((r) => r.id));

  const ord = t.termer.concat(t.fraser).filter(Boolean);
  const form = medMaerker(noter.map((r) => {
    const ud = formNote(r, false);
    const m = kort.get(r.id);
    // Uddraget er BUNDET: en note paa 200 KB maa ikke give et 200 KB svar.
    ud.excerpt = renUddrag(m.uddrag || uddragAf(r.body_md, ord));
    const afsnit = afsnitFor(r.body_md, ord);
    if (afsnit) { ud.section = afsnit.id; ud.sectionTitle = afsnit.tekst; }
    ud.notebook = notesbogNavnFor(r.notebook_id);
    return ud;
  }));
  form.sort((a, b) => kort.get(a.id).rang - kort.get(b.id).rang);
  return { results: form, fallback };
}

/**
 * Renser et uddrag til ÉN laesbar linje.
 *
 * FTS5's `snippet()` klipper i den RAA kolonne, saa et uddrag kan begynde midt
 * i »## Regler« og indeholde linjeskift. I en enkelt linje i en resultatliste
 * ser det ud som stoej. Markoererne `<<` og `>>` skal overleve rensningen -
 * de er fremhaevningen, og frontenden bytter dem til <mark> EFTER at have
 * escapet, saa der er ingen vej fra notens tekst til et tag.
 */
function renUddrag(raa) {
  return String(raa || '')
    .replace(/```[\w+-]*/g, ' ')          // kodehegn
    .replace(/^\s*#{1,6}\s+/gm, '')       // overskrifts-markoerer
    .replace(/^\s*[-*+]\s+/gm, '· ')      // punkttegn
    .replace(/^\s*>\s?/gm, '')            // citat
    .replace(/\[\[([^\]]+)\]\]/g, '$1')   // wiki-link
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Uddrag til LIKE-faldet, hvor FTS ikke gav et. Samme markoerer som snippet(). */
function uddragAf(body, ord) {
  const ren = markdown.tilTekst(body).replace(/\s+/g, ' ');
  if (!ord.length) return ren.slice(0, 160);
  const lav = ren.toLowerCase();
  let pos = -1;
  for (const o of ord) {
    const p = lav.indexOf(o.toLowerCase());
    if (p >= 0 && (pos < 0 || p < pos)) pos = p;
  }
  if (pos < 0) return ren.slice(0, 160);
  const fra = Math.max(0, pos - 60);
  const stump = ren.slice(fra, fra + 180);
  // Markoererne saettes paa RENSET tekst; frontenden escaper foer den bytter
  // dem til <mark>, saa der er ingen vej fra notens tekst til et tag.
  let ud = stump;
  for (const o of ord) {
    ud = ud.replace(new RegExp(`(${o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<<$1>>');
  }
  return (fra > 0 ? '…' : '') + ud + (fra + 180 < ren.length ? '…' : '');
}

function notesbogNavnFor(id) {
  if (!id) return null;
  const b = db.prepare('SELECT name FROM notebooks WHERE id = ?').get(id);
  return b ? b.name : null;
}

/* ============================================ fangst og API (F9) ======== */

/*
 * Doeren for en genvej paa en telefon.
 *
 * En iOS-genvej har ét tekstfelt og ingen taalmodighed. Den kan ikke bygge
 * JSON, den kan ikke laese en fejlkode, og den kan ikke spoerge om noget. Alt
 * herunder er skrevet ud fra det (dodas F2-moenster):
 *
 *  - kroppen maa vaere JSON, formulardata, REN TEKST eller `?text=` i adressen,
 *  - svaret har en faerdig `message`-linje, genvejen kan vise ordret,
 *  - og `capture`-scopet kan skrive noget NYT og se ingenting. En mistet
 *    telefon maa ikke kunne laese arkivet.
 */

/**
 * Dagens note - ÉN regel, som baade appen og API'et spoerger.
 *
 * Datoen laa foer i frontenden (lokal tid) OG i `/state` (UTC), og de to var
 * uenige de foerste timer af doegnet i dansk tid. Ingen brugte tallet endnu,
 * saa det var en fejl, der ventede. Nu bor reglen ét sted - og en klient kan
 * sende sin EGEN dato, fordi telefonen ved bedre end serveren, hvornaar det
 * er i dag hos brugeren.
 */
function iDagISO(raa) {
  const s = str(raa, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dagensNote(userId, dato, opret) {
  const titel = iDagISO(dato);
  const fundet = db.prepare(`SELECT id FROM notes
                              WHERE user_id = ? AND title = ? AND deleted_at IS NULL
                              ORDER BY created_at LIMIT 1`).get(userId, titel);
  if (fundet) return hentNote(userId, fundet.id);
  if (!opret) return null;
  const pen = new Date(`${titel}T12:00:00`).toLocaleDateString('en-GB',
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return opretNote(userId, { title: titel, body: `# ${pen}\n\n` });
}

/**
 * Teksten fra en genvej -> en note.
 *
 * **Foerste linje er titlen, resten er noten.** Det er den regel, resten af
 * familien allerede bruger (MsGraphBud -> doda), og den er det eneste, en
 * bruger kan gaette paa uden at laese en vejledning.
 *
 * `#maerke` i titlen tolkes af den SAMME regel som i appen - der maa ikke
 * findes en saerlig API-vej ind i dataene (RUNE-ERFARINGER §9a).
 */
function fangstFelter(raa) {
  const tekst = String(raa || '').replace(/\r\n/g, '\n').trim();
  if (!tekst) return null;
  const brud = tekst.indexOf('\n');
  const titel = (brud === -1 ? tekst : tekst.slice(0, brud)).trim().slice(0, 200);
  const resten = brud === -1 ? '' : tekst.slice(brud + 1).replace(/^\n+/, '');
  return { titel, krop: resten };
}

/**
 * Selve fangsten. ÉN funktion, som baade tekst-vejen og billed-vejen bruger.
 *
 * `to=today` foejer til dagens note i stedet for at lave en ny. Det er den
 * ene ting, en genvej oftest vil: samle dagens smaating ét sted, uden at
 * arkivet vokser med en note pr. indfald.
 */
function fangst(userId, tekst, opt) {
  const o = opt || {};
  const felter = fangstFelter(tekst);
  if (!felter) return { fejl: ['no_text', 'Send some text to capture.'] };

  // Samme regel som i titelfeltet: `#drift` bliver et rigtigt maerke.
  const { tekst: renTitel, maerker: fundne } = maerker.pluk(felter.titel);

  /*
   * Laeg teksten NEDERST i en note, der findes i forvejen.
   *
   * ÉT sted for begge maal - dagens note og en note, man peger paa med et id.
   * De to gjorde det samme, og det andet blev bygget ved at kopiere det
   * foerste; saa ville maerke-fejlen nedenfor have vaeret to steder.
   */
  const tilfoejTil = (note, fejlbesked) => {
    const linje = felter.krop ? `${renTitel}\n\n${felter.krop}` : renTitel;
    const foer = String(note.body || '').replace(/\s+$/, '');
    /*
     * Et LISTEPUNKT lagt til en liste bliver en del af den listen.
     *
     * Alt andet skilles med en tom linje, og det er rigtigt: to afsnit skal
     * vaere to afsnit. Men en genvej, der samler links i én note - »- [titel]
     * (adresse)« hver gang - byggede dermed ét punkt pr. LISTE. Efter fem
     * gemte artikler stod der fem lister med ét punkt i hver, og det ser
     * stykket i stykker ud uden at noget er gaaet galt (maalt 2026-08-22, da
     * opskriften til iOS-genvejen skulle skrives).
     *
     * Reglen er snaever med vilje: BEGGE sider skal vaere punkter i samme
     * slags liste. Er den ene et afsnit, er der intet at fortsaette.
     */
    const ER_PUNKT = /^\s*(?:[-*+]|\d{1,9}[.)])\s+\S/;
    const sidsteLinje = foer.split('\n').pop();
    const fortsaetter = ER_PUNKT.test(sidsteLinje) && ER_PUNKT.test(linje)
      && /^\s*\d/.test(sidsteLinje) === /^\s*\d/.test(linje);
    const ny = `${foer}${fortsaetter ? '\n' : '\n\n'}${linje}\n`;
    const svar = gemNote(userId, note.id, { body: ny });
    if (svar.fejl) return { fejl: ['not_found', fejlbesked] };
    /*
     * Maerkerne LAEGGES TIL - de erstatter ikke.
     *
     * `saetMaerker` skriver notens maerker forfra (den rydder `note_tags`
     * foerst), og det er rigtigt, naar man redigerer maerkeraekken. Men her
     * TILFOEJER man til en note, der findes: sender man »Ny router #drift«
     * til dagens note, skal notens oevrige maerker blive. Foer forsvandt de,
     * uden at noget fejlede - og en fangst, der sletter noget, er den vaerste
     * slags stille fejl (fundet 2026-08-21).
     */
    if (fundne.length) {
      const nu = (note.tags || []).slice();
      for (const m of fundne) {
        if (!nu.some((t) => t.toLowerCase() === m.toLowerCase())) nu.push(m);
      }
      saetMaerker(userId, note.id, nu);
    }
    return { note: hentNote(userId, note.id), tilfoejet: true, titel: renTitel };
  };

  if (o.tilDagens) {
    const dag = dagensNote(userId, o.dato, true);
    if (!dag || dag.fejl) return { fejl: ['no_note', 'Could not open today\'s note.'] };
    return tilfoejTil(dag, 'Could not write to today\'s note.');
  }

  /*
   * `to=<id>`: en bestemt note.
   *
   * **Adgangen er SKRIVE-adgang**, ikke bare »kan se«: at laegge noget
   * nederst i en side er at aendre den. En note, der er delt til laesning,
   * maa derfor ikke kunne fyldes op udefra (F11).
   *
   * Svaret er det samme 404 for »findes ikke« og »ikke min« - man maa ikke
   * kunne aftaste, hvilke id'er der er i brug.
   */
  if (o.tilNote) {
    const note = hentNote(userId, o.tilNote);
    if (!note || !maaSkrive(userId, o.tilNote)) {
      return { fejl: ['not_found', 'No note with that id — or it is not yours to write in.'] };
    }
    return tilfoejTil(note, 'Could not write to that note.');
  }

  const note = opretNote(userId, {
    title: renTitel || 'Untitled',
    body: felter.krop,
    notebookId: o.notesbog || undefined,
  });
  if (note && note.fejl) return { fejl: ['bad_request', note.fejl] };
  if (fundne.length) saetMaerker(userId, note.id, fundne);
  return { note: hentNote(userId, note.id), titel: renTitel };
}

/**
 * Notesbogen, en genvej peger paa - ved id ELLER ved navn.
 *
 * En genvej kan ikke slaa et id op. At kraeve ét ville betyde, at man skulle
 * hente det med et andet kald foerst, og saa er »ét felt og en knap« vaek.
 */
function findNotesbog(userId, raa) {
  const v = str(raa, 200);
  if (!v) return null;
  const r = db.prepare(`SELECT id FROM notebooks
                         WHERE user_id = ? AND deleted_at IS NULL
                           AND (id = ? OR lower(name) = lower(?)) LIMIT 1`).get(userId, v, v);
  return r ? r.id : null;
}

/* ============================================ kommentarer (F7) ========== */

/*
 * Én model, to veje ind - og de to veje har IKKE samme rettigheder.
 *
 * I appen skriver en bruger som sig selv, og kommentaren er udgivet med det
 * samme. Paa wikien skriver en GAEST, der hverken har konto eller kan
 * genkendes, og hans kommentar lander i moderationskoeen. Forskellen ligger
 * ét sted (`opretKommentar`), saa den ikke kan blive uens.
 *
 * Reglen om, hvem der maa SE en kommentar, er notens egen: kan man ikke se
 * noten, findes dens kommentarer ikke. Derfor gaar hvert eneste opslag
 * gennem `hentNote()`/`kanModerere()` - aldrig gennem `comments` alene.
 */

const MAX_KOMMENTAR = 4000;
const MAX_FORFATTER = 60;

/** Maa brugeren MODERERE noten - altsaa godkende, afvise og slette andres? */
function kanModerere(userId, noteId) {
  return !!db.prepare(`SELECT 1 FROM notes n
                        WHERE n.id = ? AND n.deleted_at IS NULL AND ${SKRIVBAR}`)
    .get(noteId, userId, userId);
}

function formKommentar(r, medStatus) {
  const ud = {
    id: r.id,
    noteId: r.note_id,
    parentId: r.parent_id || null,
    author: r.user_id ? (r.username || 'Unknown') : (r.author || 'Anonymous'),
    // En gaest maa aldrig kunne ligne en konto. Flaget er det, UI'et taegner
    // maerket »guest« efter - ikke en gaetning paa navnet.
    guest: !r.user_id,
    kind: r.kind,
    body: r.body,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    edited: !!r.edited_at,
    /*
     * Hvor kommentaren kom fra. Tom = skrevet i Sagu selv.
     *
     * Den staar UDEN for `medStatus`-blokken med vilje: `status` og
     * `origin` er ejerens oplysninger (moderationskoeen), men »skrevet fra
     * tovo« er en oplysning til ENHVER, der laeser traaden. Ellers ville
     * den samme kommentar se anderledes ud alt efter, hvem der kigger.
     */
    via: r.via || '',
  };
  if (medStatus) {
    ud.status = r.status;
    ud.origin = r.origin;
  }
  return ud;
}

/**
 * Kommentarerne paa én note.
 *
 * `alle` = ejerens visning: den viser ogsaa det, der venter i koeen, og
 * hvilken status hver enkelt har. En gaest paa wikien faar KUN `published`.
 */
function hentKommentarer(noteId, alle) {
  const raekker = db.prepare(`
    SELECT c.*, u.username
      FROM comments c LEFT JOIN users u ON u.id = c.user_id
     WHERE c.note_id = ? AND c.deleted_at IS NULL
       ${alle ? '' : "AND c.status = 'published'"}
     ORDER BY c.created_at`).all(noteId);
  return raekker.map((r) => formKommentar(r, !!alle));
}

/** Ét grupperet COUNT for en hel liste - aldrig en forespoergsel pr. raekke. */
function taelKommentarer(noteIder) {
  if (!noteIder.length) return new Map();
  const huller = noteIder.map(() => '?').join(',');
  const raekker = db.prepare(`
    SELECT note_id, COUNT(*) AS n FROM comments
     WHERE deleted_at IS NULL AND status = 'published' AND note_id IN (${huller})
     GROUP BY note_id`).all(...noteIder);
  return new Map(raekker.map((r) => [r.note_id, r.n]));
}

/**
 * Opretter en kommentar. ÉN funktion for begge veje ind.
 *
 * `o.origin === 'public'` er gaestens vej, og den har fire spaerrer, som en
 * indlogget bruger ikke har. Den fjerde er vaerd at kende, fordi den afviger
 * fra planens ordlyd: planen sagde »ingen links i foerste kommentar fra en
 * ukendt«. At afgoere, hvem der er »kendt«, kraever, at man gemmer noget om
 * den besoegende (en IP, en cookie) - og wikien maalte med vilje kun TAL,
 * aldrig personer. Reglen her er derfor: **en gaestekommentar med et link
 * modereres ALTID**, ogsaa naar ejeren har slaaet koeen fra. Den daekker det
 * samme (et link slipper aldrig ubemaerket forbi) uden at gemme noget om
 * nogen.
 */
function opretKommentar(o) {
  const body = str(o.body, MAX_KOMMENTAR).trim();
  if (!body) return { fejl: ['empty_comment', 'Write something first.'] };
  const kind = o.kind === 'suggestion' ? 'suggestion' : 'comment';
  const offentlig = o.origin === 'public';

  let svarPaa = null;
  if (o.parentId) {
    const p = db.prepare(`SELECT id, parent_id, note_id FROM comments
                           WHERE id = ? AND note_id = ? AND deleted_at IS NULL`)
      .get(o.parentId, o.noteId);
    if (!p) return { fejl: ['unknown_parent', 'The comment you replied to is gone.'] };
    // Traaden er ét niveau: et svar paa et svar haenger paa toppen af traaden.
    // Saa kan der hverken opstaa en kaede eller en ring - og koeen er
    // stadig laesbar.
    svarPaa = p.parent_id || p.id;
  }

  const harLink = /\bhttps?:\/\/|\bwww\./i.test(body);
  let status = 'published';
  if (offentlig) status = (o.moderer || harLink) ? 'pending' : 'published';

  const id = newId();
  const t = now();
  db.prepare(`INSERT INTO comments
      (id, note_id, parent_id, user_id, share_id, origin, author, kind, status, body, created_at, updated_at, via)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, o.noteId, svarPaa, o.userId || null, o.shareId || null,
      offentlig ? 'public' : 'app', str(o.author, MAX_FORFATTER).trim(), kind, status, body, t, t,
      // Navnet paa den noegle, kommentaren kom ind ad. Tom = skrevet i Sagu.
      str(o.via, 40).trim());
  audit(offentlig ? 'kommentar-offentlig' : 'kommentar', o.userId || null, o.noteId, status);
  return { id, status, ventende: status === 'pending' };
}

/**
 * Moderationskoeen - alt, der venter paa den, der ejer noterne.
 *
 * Det er F7's svar paa »notifikation«: et tal i navigationen og en liste, man
 * kan gaa til. Web-push er udskudt med vilje, se DESIGN.md §14 - Sagu har
 * ingen service worker endnu, og en kanal, der ikke kan verificeres her,
 * ville vaere en paastand frem for en funktion.
 */
function moderationsKoe(userId, status, graense) {
  const s = ['pending', 'published', 'rejected'].includes(status) ? status : 'pending';
  const raekker = db.prepare(`
    SELECT c.*, u.username, n.title AS note_titel
      FROM comments c
      JOIN notes n ON n.id = c.note_id
      LEFT JOIN users u ON u.id = c.user_id
     WHERE c.deleted_at IS NULL AND c.status = ?
       AND n.deleted_at IS NULL AND ${SKRIVBAR}
     ORDER BY c.created_at DESC
     LIMIT ?`).all(s, userId, userId, Math.min(Number(graense) || 100, 300));
  return raekker.map((r) => ({ ...formKommentar(r, true), noteTitle: r.note_titel || 'Untitled' }));
}

function antalVentende(userId) {
  return db.prepare(`
    SELECT COUNT(*) AS n FROM comments c JOIN notes n ON n.id = c.note_id
     WHERE c.deleted_at IS NULL AND c.status = 'pending'
       AND n.deleted_at IS NULL AND ${SKRIVBAR}`).get(userId, userId).n;
}

/** Rækken, hvis brugeren overhovedet maa RØRE den. */
function hentKommentarFor(userId, id) {
  const r = db.prepare(`SELECT c.*, u.username FROM comments c
      LEFT JOIN users u ON u.id = c.user_id
     WHERE c.id = ? AND c.deleted_at IS NULL`).get(id);
  if (!r) return null;
  // Kan man ikke se noten, findes kommentaren ikke - 404, ikke 403.
  if (!hentNote(userId, r.note_id)) return null;
  return r;
}

/* --------------------------------------------------------------- ruter */

const ROUTES = {
  'GET /api/public-config': (req, res) => {
    sendJson(res, 200, {
      appName: APP_NAME,
      // Den version, SERVEREN udleverer. Stemmer den ikke med den, browseren
      // koerer, sidder der en gammel app.js i cachen - og saa skal brugeren
      // vide DET frem for at lede efter en funktion, der ikke er indlaest.
      version: versionNu(),
      needsSetup: userCount() === 0,
      // Skjul ogsaa registreringslinket, ikke kun ruten.
      allowRegistration: registreringAaben(),
      secureContext: isHttps(req),
      dev: DEV,
      passkeys: !passkeySpaerre(req),
      hasPasskeys: db.prepare('SELECT COUNT(*) AS n FROM credentials').get().n > 0,
    });
  },

  'GET /api/me': (req, res) => {
    const user = sessionUser(req);
    /*
     * `flereBrugere` er et JA/NEJ, ikke et tal og slet ikke en liste.
     *
     * Fladen skal bruge det til én ting: at lade vaere med at vise
     * dele-knappen paa en server, hvor der ikke ER nogen at dele med
     * (Andreas, 2026-08-21). Til dét er et boolsk svar nok - og et antal
     * ville fortaelle enhver bruger, hvor mange konti serveren har, uden at
     * nogen havde brug for det.
     */
    sendJson(res, 200, user ? { user, flereBrugere: userCount() > 1 } : { user: null });
  },

  /* --- totrinsbekraeftelse (F21) ------------------------------------- */

  'GET /api/v1/totp': (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    sendJson(res, 200, totpStatus(user.id));
  },

  /*
   * Foerste halvdel af opsaetningen: en ny hemmelighed og en QR at scanne.
   *
   * Hemmeligheden gemmes med det samme, men `totp_enabled` saettes FOERST af
   * `/enable`, naar en kode passer. Ellers laaser en fejlscanning ejeren ude
   * af sin egen server (RUNE-ERFARINGER §9d).
   */
  'POST /api/v1/totp/setup': (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    if (getSetting(user.id, 'totp_enabled', '') === '1') {
      apiFejl(res, 400, 'already_on', 'Two-step verification is already on. Turn it off first.');
      return;
    }
    const hem = totp.nyHemmelighed();
    setSetting(user.id, 'totp_secret', hem);
    // Et nyt forsoeg starter forfra: det brugte vindue hoerer til den GAMLE
    // hemmelighed og maa ikke spaerre for den nye.
    db.prepare('DELETE FROM settings WHERE scope = ? AND key = ?').run(user.id, 'totp_last');
    audit('totp-opsaetning-startet', user.id, user.username, clientIp(req));
    const uri = totp.otpauth(hem, user.username, 'Sagu');
    sendJson(res, 200, {
      secret: hem,
      uri,
      /*
       * `tilSvg` tager TEKSTEN - den kalder selv `lavQr`.
       *
       * Her stod `qr.tilSvg(qr.lavQr(uri), ...)`, og saa fik den et OBJEKT.
       * Det blev til strengen »[object Object]«, og QR-koden indeholdt
       * praecis de femten tegn. Den saa fuldstaendig rigtig ud - sort/hvid,
       * skarp, med finder-moenstre - og enhver scanner ville laese noget
       * meningsloest ud af den.
       *
       * Enhedstesten kunne ikke fange det: den kalder `tilSvg` rigtigt.
       * Fejlen laa i KALDESTEDET, og den slags findes kun ved at maale det,
       * endepunktet faktisk sender. Fundet af macOS' egen afkoder
       * (2026-08-24).
       *
       * Inline SVG, ikke PNG eller dataURL: intet billede at hente, ingen
       * cache at ramme forbi, og skarp paa en telefonskaerm.
       */
      svg: qr.tilSvg(uri, { px: 220 }),
    });
  },

  /*
   * Anden halvdel: koden fra appen skal passe, FOER kontakten gaar til.
   *
   * Genoprettelseskoderne laves samtidig og vises ÉN gang. De er ikke
   * valgfrie - uden dem laaser en mistet telefon ejeren ude for altid.
   */
  'POST /api/v1/totp/enable': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const hem = getSetting(user.id, 'totp_secret', '');
    if (!hem) { apiFejl(res, 400, 'no_setup', 'Start the setup first.'); return; }
    const ip = clientIp(req);
    if (!rateAllow(`totp:${ip}`, 15, 900)) {
      apiFejl(res, 429, 'rate_limited', 'Too many attempts — try again in a little while.');
      return;
    }
    const body = await readJsonBody(req);
    const vindue = totp.tjek(hem, String(body.code || '').trim());
    if (vindue === null) {
      logSecurity(`totp-opsaetning-fejl ip=${ip}`);
      apiFejl(res, 401, 'bad_code', 'That code is not right. Check the clock on your phone.');
      return;
    }
    setSetting(user.id, 'totp_last', String(vindue));
    setSetting(user.id, 'totp_enabled', '1');
    const koder = nyeGenoprettelseskoder(user.id);
    audit('totp-slaaet-til', user.id, user.username, ip);
    logSecurity(`totp slaaet til for ${user.username}`);
    sendJson(res, 200, { enabled: true, recovery: koder });
  },

  /*
   * At slaa det FRA kraever kodeordet igen.
   *
   * En aaben skaerm er ellers nok: gaar man forbi en ulaast maskine, kan man
   * fjerne det andet led med ét klik, og saa er 2FA'en kun en forhindring for
   * ejeren selv.
   */
  'POST /api/v1/totp/disable': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const ip = clientIp(req);
    if (!rateAllow(`totp:${ip}`, 15, 900)) {
      apiFejl(res, 429, 'rate_limited', 'Too many attempts — try again in a little while.');
      return;
    }
    const body = await readJsonBody(req);
    const row = db.prepare('SELECT password FROM users WHERE id = ?').get(user.id);
    if (!verifyPassword(String(body.password || ''), row.password)) {
      logSecurity(`totp-frakobling-fejl ip=${ip}`);
      apiFejl(res, 401, 'bad_credentials', 'That password does not match.');
      return;
    }
    slaaTotpFra(user.id);
    audit('totp-slaaet-fra', user.id, user.username, ip);
    logSecurity(`totp slaaet fra for ${user.username}`);
    sendJson(res, 200, { enabled: false });
  },

  /* Nye genoprettelseskoder. De gamle doer i samme aandedrag. */
  'POST /api/v1/totp/recovery': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    if (getSetting(user.id, 'totp_enabled', '') !== '1') {
      apiFejl(res, 400, 'not_on', 'Two-step verification is not on.');
      return;
    }
    const body = await readJsonBody(req);
    const row = db.prepare('SELECT password FROM users WHERE id = ?').get(user.id);
    if (!verifyPassword(String(body.password || ''), row.password)) {
      apiFejl(res, 401, 'bad_credentials', 'That password does not match.');
      return;
    }
    const koder = nyeGenoprettelseskoder(user.id);
    audit('genoprettelseskoder-fornyet', user.id, user.username, clientIp(req));
    sendJson(res, 200, { recovery: koder });
  },

  'POST /api/register': async (req, res) => {
    const foerste = userCount() === 0;
    if (!registreringAaben()) {
      logSecurity(`registrering-afvist ip=${clientIp(req)}`);
      apiFejl(res, 403, 'registration_closed', 'Sign-up is closed on this server.');
      return;
    }
    const ip = clientIp(req);
    if (!rateAllow(`reg:${ip}`, 10, 3600)) {
      apiFejl(res, 429, 'rate_limited', 'Too many sign-up attempts. Try again later.');
      return;
    }
    const body = await readJsonBody(req);
    const username = str(body.username, 64).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    if (username.length < 2) { apiFejl(res, 400, 'bad_username', 'The username is too short.'); return; }
    if (password.length < 8) { apiFejl(res, 400, 'bad_password', 'The password must be at least 8 characters.'); return; }
    // Sammenlign med lower() - ellers kan "Andreas" og "andreas" begge oprettes.
    if (db.prepare('SELECT 1 FROM users WHERE lower(username) = ?').get(username)) {
      apiFejl(res, 409, 'username_taken', 'That username is taken.');
      return;
    }

    const id = newId();
    // Foerste bruger er administrator. Det giver ret til at aendre
    // INSTALLATIONEN - ikke til at laese andres noter.
    db.prepare('INSERT INTO users (id, username, password, is_admin, created_at) VALUES (?,?,?,?,?)')
      .run(id, username, hashPassword(password), foerste ? 1 : 0, now());
    audit('bruger-oprettet', id, username, foerste ? 'admin' : '');
    const token = createSession(id);
    sendJson(res, 200, { user: { id, username, isAdmin: foerste } },
      { 'Set-Cookie': sessionCookie(req, token, SESSION_DAYS * 86400) });
  },

  'POST /api/login': async (req, res) => {
    const body = await readJsonBody(req);
    const username = str(body.username, 64).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    const ip = clientIp(req);
    const bucket = `login:${ip}:${username}`;
    if (!rateAllow(bucket, 15, 900)) {
      logSecurity(`login-spaerret ip=${ip}`);
      apiFejl(res, 429, 'rate_limited', 'Too many attempts — try again in a little while.');
      return;
    }
    const row = db.prepare('SELECT id, username, password, is_admin FROM users WHERE lower(username) = ?').get(username);
    if (!row || !verifyPassword(password, row.password)) {
      logSecurity(`login-fejl ip=${ip}`);
      audit('login-fejl', null, username, ip);
      apiFejl(res, 401, 'bad_credentials', 'Wrong username or password.');
      return;
    }
    /*
     * ── Kodeordet passede. Er der et ANDET led, er vi kun halvvejs ────────
     *
     * Porten ligger HER - foer `createSession`. Udstedte vi cookien foerst og
     * spurgte bagefter, var 2FA'en en formalitet: den, der har kodeordet, var
     * allerede inde (RUNE-ERFARINGER §9d).
     *
     * `needsCode` er det, fladen skelner paa: kodefeltet bliver staaende ved
     * en forkert ENGANGSKODE, men foldes vaek ved et forkert kodeord.
     *
     * Og der bruges SAMME rate-spand som kodeordet. Med en spand for sig
     * kunne seks cifre proeves igennem uden at loebe ind i en graense.
     */
    if (getSetting(row.id, 'totp_enabled', '') === '1') {
      const kode = String(body.code || '').trim();
      if (!kode) {
        sendJson(res, 200, { needsCode: true });
        return;
      }
      const svar = tjekAndetTrin(row.id, kode);
      if (!svar.ok) {
        logSecurity(`totp-fejl ip=${ip}`);
        audit('login-totp-fejl', row.id, row.username, ip);
        apiFejl(res, 401, 'bad_code', svar.besked || 'That code is not right.', { needsCode: true });
        return;
      }
      if (svar.genoprettelse) {
        audit('login-genoprettelseskode', row.id, row.username, ip);
        logSecurity(`genoprettelseskode brugt ip=${ip} - ${svar.tilbage} tilbage`);
      }
    }

    rateClear(bucket);
    audit('login', row.id, row.username, ip);
    const token = createSession(row.id);
    sendJson(res, 200, { user: { id: row.id, username: row.username, isAdmin: !!row.is_admin } },
      { 'Set-Cookie': sessionCookie(req, token, SESSION_DAYS * 86400) });
  },

  'POST /api/logout': (req, res) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  },

  // requireUser, ikke godkend: en noegle maa ALDRIG kunne skifte kodeord.
  'POST /api/password': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const current = typeof body.current === 'string' ? body.current : '';
    const next = typeof body.next === 'string' ? body.next : '';
    if (next.length < 8) { apiFejl(res, 400, 'bad_password', 'The password must be at least 8 characters.'); return; }
    const row = db.prepare('SELECT password FROM users WHERE id = ?').get(user.id);
    if (!verifyPassword(current, row.password)) {
      logSecurity(`kodeordsskift-fejl ip=${clientIp(req)}`);
      apiFejl(res, 401, 'bad_credentials', 'The current password does not match.');
      return;
    }
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashPassword(next), user.id);
    // Alle andre sessioner droppes - et kodeordsskift skal kunne lukke en tyv ude.
    const keep = parseCookies(req.headers.cookie)[SESSION_COOKIE] || '';
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(user.id, keep);
    audit('kodeord-skiftet', user.id, user.username, clientIp(req));
    sendJson(res, 200, { ok: true });
  },

  /* --- installationens indstillinger (kun admin) -------------------- */

  'GET /api/v1/admin': (req, res) => {
    const user = requireAdmin(req, res);
    if (!user) return;
    sendJson(res, 200, {
      allowRegistration: getSetting('*', 'allow_registration', '') === '1',
      storageQuota: maxSamlet(),
      // Det, kvoten IKKE kan saettes under: den mest fyldte konto. Fladen skal
      // kunne sige hvorfor, foer man proever.
      storageMest: Math.max(0, ...db.prepare('SELECT id FROM users').all().map((u) => brugtPlads(u.id))),
      users: db.prepare('SELECT id, username, is_admin, created_at FROM users ORDER BY created_at')
        .all().map((u) => ({ id: u.id, username: u.username, isAdmin: !!u.is_admin, createdAt: u.created_at })),
    });
  },

  'POST /api/v1/admin': async (req, res) => {
    const user = requireAdmin(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    if (Object.prototype.hasOwnProperty.call(body, 'allowRegistration')) {
      setSetting('*', 'allow_registration', body.allowRegistration ? '1' : '0');
      audit('registrering-aendret', user.id, null, body.allowRegistration ? 'aaben' : 'lukket');
    }
    if (Object.prototype.hasOwnProperty.call(body, 'storageQuota')) {
      /*
       * Kvoten kan saettes op og ned - men aldrig under det, nogen ALLEREDE
       * bruger.
       *
       * En kvote under forbruget sletter ingenting; den goer bare, at kontoen
       * staar over graensen og ikke kan laegge mere op. Det ser ud som om
       * appen er i stykker, og der er ingen vej ud, der ikke begynder med at
       * slette noget. Serveren siger derfor nej med det samme og fortaeller,
       * hvad den mindste lovlige vaerdi er.
       *
       * Sagu kan i oevrigt ikke skaffe plads: er disken mindre end tallet,
       * er tallet et loefte, maskinen ikke kan holde. Det staar i fladen.
       */
      const bytes = Math.round(Number(body.storageQuota));
      const mest = Math.max(0, ...db.prepare('SELECT id FROM users').all().map((u) => brugtPlads(u.id)));
      if (!Number.isFinite(bytes) || bytes < MIN_KVOTE || bytes > MAKS_KVOTE) {
        apiFejl(res, 400, 'bad_quota',
          `The quota must be between ${visBytes(MIN_KVOTE)} and ${visBytes(MAKS_KVOTE)}.`);
        return;
      }
      if (bytes < mest) {
        apiFejl(res, 400, 'quota_below_use',
          `An account already uses ${visBytes(mest)}. Set it to at least that, or delete some files first.`);
        return;
      }
      setSetting('*', 'storage_quota', String(bytes));
      audit('kvote-aendret', user.id, null, visBytes(bytes));
    }
    if (Object.prototype.hasOwnProperty.call(body, 'publicUrl')) {
      const ren = rensOffentligUrl(body.publicUrl);
      if (ren === null) {
        apiFejl(res, 400, 'bad_public_url',
          'The public address must be a plain web address like https://example.com — no path, no trailing slash.');
        return;
      }
      setSetting('*', 'public_url', ren);
      audit('offentlig-adresse-aendret', user.id, null, ren || '(ryddet)');
    }
    sendJson(res, 200, { ok: true, publicUrl: offentligUrl() });
  },

  /* --- data --------------------------------------------------------- */

  // Ét kald der giver skallen alt, den skal bruge for at tegne sig.
  'GET /api/v1/state': (req, res) => {
    const auth = godkend(req, res, 'read');
    if (!auth) return;
    const u = auth.user;
    sendJson(res, 200, {
      notebooks: hentNotesboeger(u.id),
      counts: {
        // Taelleren skal spoerge om det, BRUGEREN mener. "All Notes" viser
        // ikke de arkiverede, saa tallet ved siden af maa heller ikke taelle
        // dem med - ellers staar der 3 i sidebaren og 2 i listen, og det
        // tal ser rigtigt ud og betyder noget andet (RUNE-ERFARINGER, doda F3).
        notes: db.prepare(`SELECT COUNT(*) AS n FROM notes
           WHERE user_id = ? AND deleted_at IS NULL AND archived_at IS NULL`).get(u.id).n,
        archived: db.prepare(`SELECT COUNT(*) AS n FROM notes
           WHERE user_id = ? AND deleted_at IS NULL AND archived_at IS NOT NULL`).get(u.id).n,
        trash: db.prepare('SELECT COUNT(*) AS n FROM notes WHERE user_id = ? AND deleted_at IS NOT NULL').get(u.id).n,
        // Delt MED mig. Med kun én bruger er tallet 0 - men visningen skal
        // findes fra nu, ellers bygges den som en undtagelse i F11.
        shared: db.prepare('SELECT COUNT(*) AS n FROM note_acl WHERE user_id = ?').get(u.id).n,
        // F7: det, der venter i moderationskoeen. Tallet ER notifikationen -
        // og en funktion, man ikke kan SE, findes ikke for brugeren
        // (RUNE-ERFARINGER, tovo v8).
        pendingComments: antalVentende(u.id),
      },
      tags: hentMaerker(u.id),
      storage: { used: brugtPlads(u.id), quota: maxSamlet(), maxFile: MAX_FIL },
      // Tom betyder "brug den vaert, du selv staar paa" - se offentligVaert().
      publicUrl: offentligUrl(),
      today: new Date().toISOString().slice(0, 10),
      /*
       * Personlige valg om, hvordan fladen opfoerer sig.
       *
       * De foelger med `state`, fordi de skal vaere kendt FOER foerste
       * optegning. Hentede fladen dem for sig, ville den foerste note tegnes
       * med den forkerte editor og hoppe om et oejeblik efter.
       */
      prefs: {
        editWhole: getSetting(u.id, 'edit_whole', '') === '1',
      },
    });
  },

  /*
   * Moderationskoeen paa tvaers af noter - F7's »notifikation«.
   *
   * `read`, ikke `full`: at LAESE hvad der venter er en laesning. At godkende
   * er en skrivning, og den gaar gennem PATCH.
   */
  'GET /api/v1/comments': (req, res, ctx) => {
    const auth = godkend(req, res, 'read');
    if (!auth) return;
    sendJson(res, 200, {
      comments: moderationsKoe(auth.user.id, ctx.query.get('status') || 'pending', ctx.query.get('limit')),
      pending: antalVentende(auth.user.id),
    });
  },

  'GET /api/v1/notes': (req, res, ctx) => {
    const auth = godkend(req, res, 'read');
    if (!auth) return;
    const q = ctx.query;
    const filter = { limit: q.get('limit') };
    if (q.has('notebook')) filter.notebook = q.get('notebook') || null;
    if (q.has('parent')) filter.parent = q.get('parent') || null;
    if (q.get('trash') === '1') filter.slettede = true;
    if (q.get('archived') === '1') filter.medArkiverede = true;
    sendJson(res, 200, { notes: hentNoter(auth.user.id, filter) });
  },

  'POST /api/v1/notes': async (req, res) => {
    const auth = godkend(req, res, 'capture');
    if (!auth) return;
    const body = await readJsonBody(req, auth.viaToken);
    const note = opretNote(auth.user.id, {
      title: body.title,
      body: body.body,
      icon: body.icon,
      notebookId: body.notebookId,
      parentId: body.parentId,
      extId: body.extId,
      // En hvidliste over felter aeder det, den ikke naevner - og tavst
      // (RUNE-ERFARINGER, tovo F1). `tags` skal med her, ellers kan en
      // iOS-genvej eller en MCP-klient ikke fange en note MED et maerke.
      tags: body.tags,
    });
    sendJson(res, 200, { note });
  },

  'GET /api/v1/notebooks': (req, res) => {
    const auth = godkend(req, res, 'read');
    if (!auth) return;
    sendJson(res, 200, { notebooks: hentNotesboeger(auth.user.id) });
  },

  'POST /api/v1/notebooks': async (req, res) => {
    const auth = godkend(req, res, 'write');
    if (!auth) return;
    const body = await readJsonBody(req, auth.viaToken);
    sendJson(res, 200, { notebook: opretNotesbog(auth.user.id, body.name, body.icon) });
  },

  /*
   * Hele traeet i ÉT kald.
   *
   * Sidebaren skal kunne tegne notesboeger og undersider i vilkaarlig dybde,
   * og et kald pr. niveau ville vaere lige saa mange blokerende rundture som
   * traeet er dybt - ~150 ms hver gennem tunnelen (DESIGN.md, maaling 3).
   *
   * body_md kommer IKKE med. Traeet er en liste.
   */
  'GET /api/v1/tree': (req, res) => {
    const auth = godkend(req, res, 'read');
    if (!auth) return;
    const u = auth.user;
    /*
     * **Sidebaren er MIT arkiv.**
     *
     * `SYNLIG` staar der stadig - reglen maa ikke fjernes fra en dataadgang -
     * men traeet tegnes af notesboeger, og en delt side ligger i EJERENS bog.
     * Uden ejer-filteret dukkede alices »Drift« op under bobs egne
     * notesboeger, som om den var hans: fundet ved at logge ind som bruger
     * nummer to og KIGGE, ikke af en test (F11).
     *
     * Det, andre har delt, staar under »Shared with me« - med hvem det kom
     * fra, hvilket sidebaren ikke har plads til at sige.
     */
    const noter = db.prepare(`
      SELECT n.id, n.notebook_id, n.parent_id, n.title, n.icon, n.seq, n.archived_at,
             n.updated_at, (n.user_id = ?) AS er_ejer,
             (SELECT COUNT(*) FROM notes c WHERE c.parent_id = n.id AND c.deleted_at IS NULL) AS boern
        FROM notes n
       WHERE n.deleted_at IS NULL AND n.user_id = ? AND ${SYNLIG}
       ORDER BY n.seq, n.title`).all(u.id, u.id, u.id, u.id);
    sendJson(res, 200, {
      notebooks: hentNotesboeger(u.id),
      notes: noter.map((n) => ({
        id: n.id,
        notebookId: n.notebook_id,
        parentId: n.parent_id,
        title: n.title,
        icon: n.icon,
        seq: n.seq,
        archived: !!n.archived_at,
        updatedAt: n.updated_at,
        childCount: n.boern,
        mine: !!n.er_ejer,
      })),
    });
  },

  'POST /api/v1/reorder': async (req, res) => {
    const auth = godkend(req, res, 'write');
    if (!auth) return;
    const body = await readJsonBody(req, auth.viaToken);
    const svar = omorden(auth.user.id, body.kind, body.ids);
    if (svar.fejl) { apiFejl(res, 400, 'bad_request', 'Send {kind, ids} with a list of ids.'); return; }
    sendJson(res, 200, { ok: true });
  },

  'GET /api/v1/search': (req, res, ctx) => {
    const auth = godkend(req, res, 'read');
    if (!auth) return;
    const svar = soegNoter(auth.user.id, ctx.query.get('q') || '', ctx.query.get('limit'));
    // `fallback` siger, at indekset intet fandt, og teksten blev laest i
    // stedet. Frontenden kan saa sige det - et resultat uden rangering skal
    // ikke se ud som et rangeret.
    sendJson(res, 200, svar);
  },

  /*
   * Det, folk soegte efter uden at finde noget.
   *
   * »Den bedste indholdsplan, en wiki kan faa« (SAGU-PLAN §5). Kun ordet
   * gemmes, aldrig hvem - saa listen kan vises uden at vaere en logbog over
   * kollegaernes soegninger.
   */
  'GET /api/v1/search-misses': (req, res, ctx) => {
    const user = requireUser(req, res);
    if (!user) return;
    /*
     * `scope` afgraenser til ÉN udgivelse.
     *
     * Uden den blandes ejerens egne soegninger med kollegaernes, og saa er
     * listen ubrugelig som indholdsplan: man kan ikke se, om det var én selv,
     * der ledte forgaeves. Scope er udgivelsens id - stadig kun ORDET, aldrig
     * hvem der skrev det (SAGU-PLAN §5).
     */
    const scope = ctx.query.get('scope');
    // Udgivelsen skal vaere ens egen. Ellers kunne man laese, hvad
    // kollegaerne soegte efter i en anden brugers wiki.
    if (scope && !db.prepare('SELECT 1 FROM shares WHERE id = ? AND user_id = ?').get(scope, user.id)) {
      apiFejl(res, 404, 'not_found', 'No such publication.');
      return;
    }
    const hvor = scope ? 'AND scope = ?' : '';
    const arg = scope ? [scope] : [];
    sendJson(res, 200, {
      misses: db.prepare(`
        SELECT term, COUNT(*) AS n, MAX(at) AS sidst FROM search_miss
         WHERE at > ? ${hvor} GROUP BY lower(term) ORDER BY n DESC, sidst DESC LIMIT 50`)
        .all(now() - 90 * 86400, ...arg),
    });
  },

  /* --- maerker -------------------------------------------------------- */

  /*
   * Et maerke er en TING, man kan lave - ikke en bivirkning af en note.
   *
   * Foerste udgave ryddede tomme maerker op automatisk, og saa var »opret et
   * maerke« umuligt: det forsvandt i samme sekund. Andreas ramte det med det
   * samme. Nu lever et maerke, til nogen sletter det - og det er ogsaa dét,
   * der goer det muligt at lave sin struktur foerst og fylde den bagefter.
   */
  'POST /api/v1/tags': async (req, res) => {
    const auth = godkend(req, res, 'write');
    if (!auth) return;
    const body = await readJsonBody(req, auth.viaToken);
    // Et maerke er ÉT ord: ellers kan `#drift` i en tekst ikke skelnes fra en
    // saetning, der begynder med et havelaage-tegn.
    const navn = str(body.name, 60).replace(/^#/, '').replace(/\s+/g, '-').trim();
    if (!navn) { apiFejl(res, 400, 'bad_name', 'A tag needs a name.'); return; }
    const fundet = db.prepare('SELECT id, name FROM tags WHERE user_id = ? AND lower(name) = lower(?)')
      .get(auth.user.id, navn);
    // Findes det allerede, er svaret det samme som hvis vi lige havde lavet
    // det: en oprettelse, der fejler paa "findes", tvinger klienten til at
    // spoerge foerst - og saa kan de to komme ud af trit.
    if (fundet) { sendJson(res, 200, { tag: fundet }); return; }
    const id = newId();
    db.prepare('INSERT INTO tags (id, user_id, name, created_at) VALUES (?,?,?,?)')
      .run(id, auth.user.id, navn, now());
    sendJson(res, 200, { tag: { id, name: navn } });
  },

  /* --- udgivelser (F6) ----------------------------------------------- */

  /*
   * En udgivelse er en aendring af, hvem der kan se noten - derfor `write`.
   * Den er samtidig noget, en MCP-klient skal kunne (F10's `publish_note`),
   * saa den gaar gennem `godkend` og ikke gennem `requireUser`: det er data,
   * ikke administration af kontoen selv.
   */
  'GET /api/v1/shares': (req, res, ctx) => {
    const auth = godkend(req, res, 'read');
    if (!auth) return;
    const noteId = ctx.query.get('note');
    const bogId = ctx.query.get('notebook');
    let hvor = '';
    const arg = [];
    if (noteId) { hvor = 'AND s.note_id = ?'; arg.push(noteId); }
    else if (bogId) { hvor = 'AND s.notebook_id = ?'; arg.push(bogId); }
    /*
     * LEFT JOIN paa begge sider: en udgivelse peger paa ÉN af dem.
     * Roden skal stadig findes - en note i papirkurven eller en slettet bog
     * betyder, at udgivelsen ikke laengere har noget at vise.
     */
    const raekker = db.prepare(`
      SELECT s.*, n.title AS note_titel, b.name AS bog_titel
        FROM shares s
        LEFT JOIN notes n ON n.id = s.note_id AND n.deleted_at IS NULL
        LEFT JOIN notebooks b ON b.id = s.notebook_id AND b.deleted_at IS NULL
       WHERE s.user_id = ? AND s.revoked_at IS NULL
         AND (n.id IS NOT NULL OR b.id IS NOT NULL) ${hvor}
       ORDER BY s.created_at DESC LIMIT 200`).all(auth.user.id, ...arg);
    sendJson(res, 200, { shares: raekker.map(formUdgivelse) });
  },

  'POST /api/v1/shares': async (req, res) => {
    const auth = godkend(req, res, 'write');
    if (!auth) return;
    const body = await readJsonBody(req, auth.viaToken);
    const svar = opretUdgivelse(auth.user.id, body);
    if (svar.fejl) { apiFejl(res, svar.fejl[0], svar.fejl[1], svar.fejl[2]); return; }
    sendJson(res, 200, { share: svar.share });
  },

  /* --- fangst og genveje (F9) ----------------------------------------- */

  /*
   * Doeren for en genvej. Tilgivende med vilje.
   *
   * Teksten maa komme som JSON, som formulardata, som REN krop eller som
   * `?text=` i adressen - en iOS-genvej med ét felt skal bare virke. Kravet
   * om `application/json` er en CSRF-barriere, og CSRF forudsaetter en
   * AMBIENT legitimation; en Bearer-noegle sendes aktivt, saa der er intet at
   * forfalske (RUNE-ERFARINGER, doda F2). Derfor slaekkes kravet praecis dér.
   */
  'POST /api/v1/capture': async (req, res, ctx) => {
    const auth = godkend(req, res, 'capture');
    if (!auth) return;
    const u = auth.user;

    /*
     * `to=` tolkes ÉT sted, saa tekst og billede aldrig kan komme i utakt.
     *
     * Tre former: intet (en ny note), `today` (dagens) og et note-id (den
     * note). Det tredje er dét, der kom til - en genvej skal kunne laegge
     * noget nederst i en side, man allerede har.
     */
    const tolkMaal = (raa) => {
      const v = str(raa, 40);
      if (v === 'today') return { tilDagens: true };
      if (/^[a-f0-9]{32}$/.test(v)) return { tilNote: v };
      return {};
    };

    /*
     * Et BILLEDE fra delingsmenuen.
     *
     * Genvejen sender filen som krop; navnet staar i adressen. Den lander som
     * en vedhaeftning paa noten - og det er med vilje muligt med `capture`:
     * at laegge noget nyt ind er ikke det samme som at maatte rette i alt,
     * hvad der ligger. Den almindelige fil-rute kraever stadig `write`, fordi
     * den kan haenge en fil paa en HVILKEN SOM HELST note.
     */
    const type = String(req.headers['content-type'] || '').split(';')[0].toLowerCase();
    if (type.startsWith('image/')) {
      const tilbage = maxSamlet() - brugtPlads(u.id);
      if (tilbage <= 0) {
        apiFejl(res, 413, 'quota_full', 'Your file storage is full. Delete something first.');
        return;
      }
      sikreDir(FILES_DIR);
      const filId = newId();
      const maal = filSti(filId);
      try {
        const { size, sha } = await modtagStroem(req, maal, Math.min(MAX_FIL, tilbage));
        if (!size) {
          fs.unlink(maal, () => {});
          apiFejl(res, 400, 'empty_file', 'The image was empty.');
          return;
        }
        const navn = renseFilnavn(ctx.query.get('name') || 'image');
        db.prepare(`INSERT INTO attachments (id, user_id, note_id, name, mime, size, sha, created_at)
                    VALUES (?,?,?,?,?,?,?,?)`)
          .run(filId, u.id, null, navn, type, size, sha, now());
        // `hvorhen`, ikke `maal`: `maal` er allerede filstien i den her blok,
        // og to af samme navn i samme scope er en TDZ-fejl, der viser sig som
        // »upload_failed« - altsaa det forkerte sted at lede.
        const hvorhen = tolkMaal(ctx.query.get('to'));
        // Uden en tekst er navnet overskriften paa en NY note - men laegges
        // billedet ned i en note, der findes, er der ingen overskrift at
        // skrive: saa staar billedet alene.
        const tekst = str(ctx.query.get('text'), 500)
          || ((hvorhen.tilDagens || hvorhen.tilNote) ? '' : navn);
        const linjer = tekst ? `${tekst}\n\n![${navn}](sagu:${filId})` : `![${navn}](sagu:${filId})`;
        const svar = fangst(u.id, linjer, Object.assign({
          dato: ctx.query.get('date'),
          notesbog: findNotesbog(u.id, ctx.query.get('notebook')),
        }, hvorhen));
        if (svar.fejl) { apiFejl(res, 400, svar.fejl[0], svar.fejl[1]); return; }
        db.prepare('UPDATE attachments SET note_id = ? WHERE id = ?').run(svar.note.id, filId);
        sendJson(res, 200, {
          note: { id: svar.note.id, title: svar.note.title },
          message: svar.tilfoejet
            ? `Added the image to “${svar.note.title}”.`
            : `Saved “${svar.note.title}”.`,
        });
      } catch (err) {
        // Svar FOERST, luk bagefter - ellers ser klienten "connection reset"
        // i stedet for vores 413 (doda F7).
        const status = err.status || 400;
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', Connection: 'close' });
        res.end(JSON.stringify({
          error: status === 413 ? 'too_large' : 'upload_failed',
          message: err.message,
        }));
        res.on('finish', () => req.destroy());
      }
      return;
    }

    const body = await readJsonBody(req, true);
    const tekst = [body.text, body.title, body.note, ctx.query.get('text')]
      .find((x) => typeof x === 'string' && x.trim()) || '';
    const svar = fangst(u.id, tekst, Object.assign({
      dato: body.date || ctx.query.get('date'),
      notesbog: findNotesbog(u.id, body.notebook || ctx.query.get('notebook')),
    }, tolkMaal(body.to || ctx.query.get('to'))));
    if (svar.fejl) { apiFejl(res, 400, svar.fejl[0], svar.fejl[1]); return; }
    if (auth.viaToken) audit('fangst-via-api', u.id, auth.token.name, svar.note.id);
    sendJson(res, 200, {
      note: { id: svar.note.id, title: svar.note.title },
      // Én faerdig linje, genvejen kan vise ORDRET. Uden den skal en genvej
      // bygge en saetning af felter, og det kan den daarligt.
      // Sig HVILKEN note. »Added to today's note« var rigtigt, saa laenge der
      // kun var ét maal at tilfoeje til; med `to=<id>` ville den vaere en
      // usandhed hver gang.
      message: svar.tilfoejet
        ? `Added to “${svar.note.title}”: ${svar.titel}`
        : `Saved “${svar.note.title}”.`,
    });
  },

  /*
   * Hvad der er aendret siden sidst - til en genvej, der holder en kopi.
   *
   * De SLETTEDE skal med. En liste over det, der findes, kan ikke fortaelle,
   * at noget er forsvundet, og en klient, der kun ser tilfoejelser, samler
   * paa spoegelser (dodas F9).
   */
  'GET /api/v1/changes': (req, res, ctx) => {
    const auth = godkend(req, res, 'read');
    if (!auth) return;
    const raa = String(ctx.query.get('since') || '0');
    const since = /^\d+$/.test(raa) ? Number(raa) : Math.floor(Date.parse(raa) / 1000);
    if (!Number.isFinite(since)) {
      apiFejl(res, 400, 'bad_since', 'The "since" value must be a unix timestamp or an ISO date.');
      return;
    }
    const graense = Math.min(Number(ctx.query.get('limit')) || 200, 500);
    const raekker = db.prepare(`
      SELECT ${NOTE_LISTE_FELTER}, n.deleted_at, (n.user_id = ?) AS er_ejer
        FROM notes n
       WHERE n.updated_at > ? AND ${SYNLIG}
       ORDER BY n.updated_at LIMIT ?`).all(auth.user.id, since, auth.user.id, auth.user.id, graense);
    const levende = raekker.filter((r) => !r.deleted_at);
    sendJson(res, 200, {
      now: now(),
      notes: medMaerker(levende.map((r) => formNote(r, false))),
      deleted: raekker.filter((r) => r.deleted_at).map((r) => r.id),
    });
  },

  /* --- doda (F8) ------------------------------------------------------ */

  /*
   * Forbindelsen. Noeglen forlader ALDRIG serveren.
   *
   * Frontenden faar `connected: true` og adressen - aldrig vaerdien. Det er
   * §6b's regel, og den gaelder ogsaa en soesterapp: en hemmelighed, der kan
   * hentes tilbage, er en hemmelighed, der kan laekke gennem enhver skaerm.
   */
  'GET /api/v1/doda': (req, res) => {
    const auth = godkend(req, res, 'read');
    if (!auth) return;
    const o = doda.opsaetning(auth.user.id);
    sendJson(res, 200, {
      url: o.url,
      connected: o.connected,
      tasks: db.prepare('SELECT COUNT(*) AS n FROM doda_tasks WHERE user_id = ?').get(auth.user.id).n,
    });
  },

  /*
   * Gem forbindelsen - men PROEV den foerst.
   *
   * Raekkefoelgen er hele pointen: gem, afproev, rul tilbage ved fejl. Ellers
   * ligger et forkert token og LIGNER en virkende forbindelse, indtil
   * brugeren proever at bruge den (RUNE-ERFARINGER, doda v16).
   */
  'POST /api/v1/doda': async (req, res) => {
    const user = requireUser(req, res);          // en noegle maa ikke saette en noegle
    if (!user) return;
    const body = await readJsonBody(req);
    const url = rensOffentligUrl(body.url);
    if (!url) {
      apiFejl(res, 400, 'bad_url',
        'The doda address must be a plain web address like https://doda.example.com.');
      return;
    }
    const noegle = typeof body.key === 'string' ? body.key.trim() : '';
    // Tom noegle = behold den, der staar. Ellers kunne man ikke rette
    // adressen uden ogsaa at skulle finde noeglen frem igen.
    const gammelUrl = getSetting(user.id, 'doda_url', '');
    const gammelKey = getSetting(user.id, 'doda_key', '');
    if (!noegle && !gammelKey) {
      apiFejl(res, 400, 'no_key', 'Paste a doda API key the first time you connect.');
      return;
    }
    setSetting(user.id, 'doda_url', url);
    if (noegle) setSetting(user.id, 'doda_key', noegle);

    const proevet = await doda.proev(user.id);
    if (!proevet.ok) {
      // Rul tilbage. En gemt, ubrugelig forbindelse er vaerre end ingen.
      setSetting(user.id, 'doda_url', gammelUrl);
      setSetting(user.id, 'doda_key', gammelKey);
      apiFejl(res, 400, proevet.kode || 'doda_error', proevet.besked);
      return;
    }
    audit('doda-forbundet', user.id, url, proevet.begraenset ? 'kun capture' : 'fuld');
    sendJson(res, 200, { connected: true, url, message: proevet.besked, limited: !!proevet.begraenset });
  },

  /*
   * En opgave UDEN en note.
   *
   * `+` i soegefeltet skal virke fra enhver skaerm - noget falder én ind,
   * mens man staar et helt andet sted. Den fritstaaende opgave gemmes ikke i
   * `doda_tasks`: der er ingen note at vise den paa, og en raekke uden et
   * sted at staa er en raekke, ingen ser igen.
   */
  'POST /api/v1/doda/tasks': async (req, res) => {
    const auth = godkend(req, res, 'write');
    if (!auth) return;
    const body = await readJsonBody(req, auth.viaToken);
    const tekst = str(body.text, 500).trim();
    if (!tekst) { apiFejl(res, 400, 'no_text', 'Write what the task should say.'); return; }
    const svar = await doda.opretOpgave(auth.user.id, tekst, {});
    if (!svar.ok) {
      apiFejl(res, svar.kode === 'not_connected' ? 409 : 502, svar.kode, svar.besked);
      return;
    }
    audit('doda-opgave', auth.user.id, null, svar.item.id);
    sendJson(res, 200, { message: svar.besked });
  },

  'DELETE /api/v1/doda': (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    // Adressen og noeglen ryddes; de SENDTE opgaver bliver staaende. De er en
    // kendsgerning om noten - at rydde dem ville vaere at aendre historikken,
    // fordi man skiftede en indstilling (samme regel som en fjernet fil, F4).
    setSetting(user.id, 'doda_url', '');
    setSetting(user.id, 'doda_key', '');
    audit('doda-frakoblet', user.id, null, '');
    sendJson(res, 200, { connected: false });
  },

  /* --- adgangsnoegler ------------------------------------------------ */

  // requireUser: en noegle maa ikke kunne lave nye noegler til sig selv.
  'GET /api/v1/keys': (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    sendJson(res, 200, {
      keys: db.prepare(`
        SELECT id, name, prefix, scope, created_at, last_used_at FROM tokens
         WHERE user_id = ? AND revoked_at IS NULL AND client_id IS NULL
         ORDER BY created_at DESC`).all(user.id),
    });
  },

  /* --- favoritter og spor (F13) ---------------------------------------- */

  'GET /api/v1/favorites': (req, res) => {
    const auth = godkend(req, res, 'read');
    if (!auth) return;
    sendJson(res, 200, { notes: hentFavoritter(auth.user.id) });
  },

  'GET /api/v1/recent': (req, res, ctx) => {
    const auth = godkend(req, res, 'read');
    if (!auth) return;
    sendJson(res, 200, { notes: senesteNoter(auth.user.id, ctx.query.get('limit')) });
  },

  /* --- GitHub i noter (F12) -------------------------------------------- */

  /*
   * **Fryser adressen.** Kaldes ÉN gang, ved indsaettelsen.
   *
   * Grenen slaas op, og svaret er den samme adresse med en sha i stedet.
   * Frontenden skriver linjen om i noten, saa **teksten** baerer sha'en -
   * ikke en tabel ved siden af. Saa er markdown stadig sandheden, og
   * indlejringen overlever en eksport, en gendannelse og en note kopieret
   * over i en anden app.
   */
  'POST /api/v1/github/freeze': async (req, res) => {
    const auth = godkend(req, res, 'read');
    if (!auth) return;
    const body = await readJsonBody(req, auth.viaToken);
    const info = ghShared.tolk(body.url);
    if (!info) { apiFejl(res, 400, 'not_github', 'That is not a GitHub file, issue or pull request address.'); return; }
    if (info.slags !== 'fil') {
      // En sag har ingen sha at fryse - den ER foranderlig, og det er
      // meningen: en note om en aaben sag skal vise, at den er lukket nu.
      sendJson(res, 200, { url: body.url, frozen: false });
      return;
    }
    if (!rateAllow(`gh:${auth.user.id}`, 300, 3600)) {
      apiFejl(res, 429, 'rate_limited', 'Too many GitHub lookups. Wait a moment.');
      return;
    }
    const r = await github.sha(auth.user.id, info);
    if (r.fejl) { apiFejl(res, 400, r.fejl[0], r.fejl[1]); return; }
    sendJson(res, 200, { url: ghShared.medRef(info, r.sha), frozen: true, sha: r.sha });
  },

  /*
   * **Viser adressen.** Kaldes ved hver optegning - og rammer cachen.
   *
   * Derfor er der ingen skrivning her og ingen tung sti: en frossen fil
   * besvares af databasen alene.
   */
  'GET /api/v1/github': async (req, res, ctx) => {
    const auth = godkend(req, res, 'read');
    if (!auth) return;
    const info = ghShared.tolk(ctx.query.get('url'));
    if (!info) { apiFejl(res, 400, 'not_github', 'That is not a GitHub address Sagu can show.'); return; }
    if (!rateAllow(`gh:${auth.user.id}`, 300, 3600)) {
      apiFejl(res, 429, 'rate_limited', 'Too many GitHub lookups. Wait a moment.');
      return;
    }
    const r = await github.hent(auth.user.id, info);
    if (r.fejl) { apiFejl(res, 400, r.fejl[0], r.fejl[1]); return; }
    sendJson(res, 200, { embed: r.data, source: r.fra, warning: r.advarsel || null });
  },

  /*
   * Status paa GitHub-forbindelsen. Aldrig selve tokenet - kun om der ER et
   * (RUNE-ERFARINGER §6b: en hemmelighed forlader ikke serveren).
   */
  'GET /api/v1/github/status': (req, res) => {
    const auth = godkend(req, res, 'read');
    if (!auth) return;
    sendJson(res, 200, {
      connected: !!getSetting(auth.user.id, 'github_token', ''),
      login: getSetting(auth.user.id, 'github_login', ''),
      cached: db.prepare('SELECT COUNT(*) AS n FROM github_cache').get().n,
    });
  },

  /*
   * Tokenet. Personligt, hemmeligt, og **proevet foer det gemmes**.
   *
   * Samme form som doda-broen: et gemt, ubrugeligt token er vaerre end ingen,
   * fordi fejlen foerst viser sig naeste gang man indsaetter en adresse - og
   * saa ligner det, at indlejringen er i stykker.
   *
   * `requireUser`, ikke `godkend`: **en noegle maa ikke saette en noegle.**
   */
  'POST /api/v1/github/token': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const nyt = typeof body.token === 'string' ? body.token.trim() : '';
    const gammelt = getSetting(user.id, 'github_token', '');

    if (!nyt) {
      // Tom = kobl fra. Cachen bliver staaende: den er ikke hemmelig, og
      // et frossent uddrag, man allerede har set, skal ikke forsvinde.
      setSetting(user.id, 'github_token', '');
      setSetting(user.id, 'github_login', '');
      audit('github-frakoblet', user.id, null, null);
      sendJson(res, 200, { connected: false });
      return;
    }

    setSetting(user.id, 'github_token', nyt);
    const proevet = await github.kald(user.id, '/user');
    if (proevet.fejl) {
      setSetting(user.id, 'github_token', gammelt);
      apiFejl(res, 400, proevet.fejl[0], proevet.fejl[1]);
      return;
    }
    const navn = proevet.krop && proevet.krop.login ? String(proevet.krop.login).slice(0, 80) : '';
    // Kontonavnet er ikke hemmeligt, og det er dét, der goer forbindelsen
    // genkendelig i indstillingerne: »forbundet« uden et navn kan man ikke
    // se, om er den rigtige konto.
    setSetting(user.id, 'github_login', navn);
    audit('github-forbundet', user.id, navn, null);
    sendJson(res, 200, { connected: true, login: navn });
  },

  /* --- deling mellem konti (F11) --------------------------------------- */

  /*
   * Kontiene, man kan dele med.
   *
   * **Kun med en session** - aldrig gennem en noegle. En liste over hvem der
   * findes paa serveren er ikke hemmelig for den, der allerede har en konto
   * her, men den hoerer ikke til det, en integration eller en genvej skal
   * kunne trakke ud. Uden listen maatte man taste et brugernavn praecist, og
   * saa ville svaret »der findes ingen konto med det navn« vaere det eneste
   * sted, man kunne aftaste dem alligevel.
   */
  'GET /api/v1/people': (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    sendJson(res, 200, { people: hentPersoner(user.id) });
  },

  /** Det, ANDRE har delt med mig. Kun toppen af hvert delt trae. */
  'GET /api/v1/shared': (req, res) => {
    const auth = godkend(req, res, 'read');
    if (!auth) return;
    sendJson(res, 200, { notes: deltMedMig(auth.user.id) });
  },

  /*
   * Forbundne apps (F10).
   *
   * Ligger ved siden af noeglerne, fordi det er den samme slags spoergsmaal:
   * hvad kan naa mine noter, og hvordan lukker jeg det? Forskellen er, at en
   * connector ikke har en noegle, brugeren selv har lavet - den har et token,
   * den fik gennem samtykkesiden, og et refresh-token, der kan lave nye.
   * Derfor er de to lister, og derfor filtrerer noeglelisten paa
   * `client_id IS NULL`: ellers ville et OAuth-token staa som en noegle, man
   * ikke kan huske at have lavet.
   */
  'GET /api/v1/connections': (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    sendJson(res, 200, { connections: hentForbindelser(user.id) });
  },

  'POST /api/v1/keys': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const scope = SCOPES.includes(body.scope) ? body.scope : 'read';
    const { key } = opretToken(user.id, str(body.name, 80) || 'Key', scope);
    // Vaerdien vises ÉN gang og gemmes aldrig i klartekst.
    sendJson(res, 200, { key, scope });
  },

  /* --- store uploads (maaling 4) ------------------------------------- */

  /*
   * Beviset for, at serveren kan tage imod en Notion-zip paa hundredvis af
   * MB uden at laese den i hukommelsen. F5 bygger importen ovenpaa; her
   * bevises kun modtagelsen.
   *
   * Egen header X-Sagu-Upload: en HTML-formular kan ikke saette den, og via
   * fetch udloeser den en preflight, vi ikke svarer paa. Det er CSRF-spaerren
   * for netop den rute, der ikke gaar gennem body-laeseren og derfor staar
   * uden for den faelles barriere (RUNE-ERFARINGER, doda F11).
   */
  'POST /api/v1/upload': async (req, res) => {
    const auth = godkend(req, res, 'write');
    if (!auth) return;
    if (!auth.viaToken && req.headers['x-sagu-upload'] !== '1') {
      apiFejl(res, 400, 'missing_header', 'Uploads must send the X-Sagu-Upload header.');
      return;
    }
    sikreDir(UPLOAD_DIR);
    const id = newId();
    const maal = path.join(UPLOAD_DIR, id);
    try {
      const t0 = Date.now();
      const { size, sha } = await modtagStroem(req, maal, MAX_UPLOAD);
      const ms = Date.now() - t0;
      sendJson(res, 200, {
        id,
        size,
        sha256: sha,
        ms,
        // Hukommelsen paa det hoejeste under modtagelsen. Det ER maalingen:
        // en 400 MB zip maa ikke kunne ses i heapen.
        heapUsed: process.memoryUsage().heapUsed,
        rss: process.memoryUsage().rss,
      });
    } catch (err) {
      // Svar FOERST, luk bagefter - ellers ser klienten "connection reset"
      // i stedet for vores 413.
      const status = err.status || 400;
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', Connection: 'close' });
      res.end(JSON.stringify({ error: status === 413 ? 'too_large' : 'upload_failed', message: err.message }));
      res.on('finish', () => req.destroy());
    }
  },

  /* --- import fra Notion (F5) ----------------------------------------- */

  /*
   * Zip'en er allerede uploadet med /api/v1/upload (maaling 4) og ligger paa
   * disk. Her sendes kun dens id - saa er de 234 MB aldrig i hukommelsen.
   */
  'POST /api/v1/import/preview': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const sti = uploadSti(body.uploadId);
    if (!sti) { apiFejl(res, 404, 'not_found', 'That upload is gone. Upload the file again.'); return; }
    try {
      sendJson(res, 200, imp.kig(sti));
    } catch (err) {
      apiFejl(res, err.status || 400, 'bad_archive', err.message);
    }
  },

  'POST /api/v1/import': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const sti = uploadSti(body.uploadId);
    if (!sti) { apiFejl(res, 404, 'not_found', 'That upload is gone. Upload the file again.'); return; }
    const svar = imp.start(sti, user.id, { notebookName: str(body.notebookName, 200) });
    if (svar.fejl === 'busy') {
      apiFejl(res, 409, 'import_running', 'An import is already running. Wait for it to finish.');
      return;
    }
    audit('import-startet', user.id, body.uploadId, null);
    sendJson(res, 200, { ok: true });
  },

  /*
   * Status. Frontenden poller den og viser et baand - saa kan browseren
   * lukkes, mens importen koerer videre (RUNE-ERFARINGER §6c).
   */
  'GET /api/v1/import': (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    sendJson(res, 200, imp.status());
  },

  'DELETE /api/v1/import': (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    sendJson(res, 200, { stopped: imp.afbryd() });
  },

  /* --- eksport (F5) ---------------------------------------------------- */

  /*
   * Samme format begge veje: en zip af markdown-filer med en YAML-forside.
   * Obsidian og Bear skriver den blok, saa det gør vi ogsaa - saa kan noterne
   * laeses af en anden editor den dag, Sagu ikke findes.
   *
   * `format=json` er den fuldstaendige udgave: alt, inklusive filerne som
   * base64. Den er rundturens format, og den har et haardt loft, fordi base64
   * fylder 4/3 og hele molevitten samles i hukommelsen - praecis Kokkeris
   * 247 MB-vej (RUNE-ERFARINGER, doda F9).
   */
  'GET /api/v1/export': (req, res, ctx) => {
    const auth = godkend(req, res, 'read');
    if (!auth) return;
    const u = auth.user;
    const format = ctx.query.get('format') === 'json' ? 'json' : 'md';
    const medFiler = ctx.query.get('files') !== '0';

    try {
      const data = format === 'json'
        ? Buffer.from(JSON.stringify(byggJsonEksport(u.id, medFiler), null, 1), 'utf8')
        : zipmod.skrivZip(byggMdEksport(u.id, medFiler));
      const dato = new Date().toISOString().slice(0, 10);
      const navn = `sagu-${dato}.${format === 'json' ? 'json' : 'zip'}`;
      res.writeHead(200, {
        'Content-Type': format === 'json' ? 'application/json' : 'application/zip',
        'Content-Length': data.length,
        'Content-Disposition': `attachment; filename="${navn}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (err) {
      apiFejl(res, err.status || 500, 'export_failed', err.message);
    }
  },

  /*
   * Gendannelse fra en JSON-eksport.
   *
   * I PORTIONER: Kokkeris backup paa 260 MB blev afvist af serverens egen
   * grænse, og backuppen var i praksis ubrugelig, uden at nogen opdagede det
   * (RUNE-ERFARINGER §4). Klienten sender én bid ad gangen.
   *
   * Idempotent paa id: den samme fil kan koeres to gange.
   */
  'POST /api/v1/restore': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    try {
      sendJson(res, 200, gendanFraJson(user.id, body));
    } catch (err) {
      apiFejl(res, err.status || 400, 'restore_failed', err.message);
    }
  },

  /* --- vedhaeftninger ------------------------------------------------- */

  /*
   * Upload UDEN en multipart-parser.
   *
   * En multipart-parser er ~200 linjer, man selv skal holde sikker. Browseren
   * kan sende en `File` direkte som krop, og navnet kan staa i query-strengen
   * (RUNE-ERFARINGER, doda F7). Kroppen streames til disk med et loebende
   * sha256 - `readJsonBody` duer ikke, den samler alt i hukommelsen.
   */
  'POST /api/v1/files': async (req, res, ctx) => {
    const auth = godkend(req, res, 'write');
    if (!auth) return;
    if (!auth.viaToken && req.headers['x-sagu-upload'] !== '1') {
      apiFejl(res, 400, 'missing_header', 'Uploads must send the X-Sagu-Upload header.');
      return;
    }
    const u = auth.user;
    /*
     * Kvoten haandhaeves UNDER uploaden, ikke kun foer den.
     *
     * Et tjek foer modtagelsen kan kun se, hvad der allerede ligger - saa en
     * enkelt fil paa 10 GB ville slippe forbi en kvote paa 2 GB, fordi der var
     * plads, da den begyndte. Loftet for DENNE upload er derfor det mindste af
     * fil-loftet og den plads, brugeren har tilbage.
     */
    const brugt = brugtPlads(u.id);
    const tilbage = maxSamlet() - brugt;
    if (tilbage <= 0) {
      apiFejl(res, 413, 'quota_full',
        `You have used all ${visBytes(maxSamlet())} of file storage. Delete something first.`);
      return;
    }
    const loft = Math.min(MAX_FIL, tilbage);
    const noteId = ctx.query.get('note') || null;
    /*
     * En fil kan kun haenges paa en note, man maa SKRIVE i.
     *
     * Her stod `hentNote()`, altsaa laese-adgang - kommentaren sagde »skrive
     * i«, koden spurgte om noget andet. Med én bruger var de to det samme;
     * fra F11 er de det ikke, og forskellen ville vaere, at en kollega med
     * laese-adgang kunne haenge filer paa en fremmed side.
     */
    if (noteId && !maaSkrive(u.id, noteId)) { apiFejl(res, 404, 'not_found', 'No such note.'); return; }

    sikreDir(FILES_DIR);
    const id = newId();
    const maal = filSti(id);
    try {
      const { size, sha } = await modtagStroem(req, maal, loft);
      if (!size) {
        fs.unlink(maal, () => {});
        apiFejl(res, 400, 'empty_file', 'The file was empty.');
        return;
      }
      // Klientens Content-Type er et HINT, ikke en sandhed. Den gemmes, men
      // afgoer kun inline/download gennem hvidlisten (doda F7).
      const mime = str(String(req.headers['content-type'] || '').split(';')[0], 100)
        || 'application/octet-stream';
      const navn = renseFilnavn(ctx.query.get('name') || 'file');
      db.prepare(`INSERT INTO attachments (id, user_id, note_id, name, mime, size, sha, width, height, created_at)
                  VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(id, u.id, noteId, navn, mime, size, sha,
          Number(ctx.query.get('w')) || null, Number(ctx.query.get('h')) || null, now());
      sendJson(res, 200, {
        file: { id, name: navn, mime, size, url: `/api/v1/files/${id}`, inline: INLINE_MIME.has(mime) },
      });
    } catch (err) {
      // Svar FOERST, luk bagefter - ellers ser klienten "connection reset"
      // i stedet for vores 413.
      const status = err.status || 400;
      // Sig HVILKEN graense der blev ramt. »Filen er for stor« er forkert og
      // sender brugeren efter et mindre billede, naar problemet er, at
      // arkivet er fuldt.
      const ramteKvoten = status === 413 && loft < MAX_FIL;
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', Connection: 'close' });
      res.end(JSON.stringify({
        error: status === 413 ? (ramteKvoten ? 'quota_full' : 'too_large') : 'upload_failed',
        message: ramteKvoten
          ? `That file does not fit in your remaining ${Math.round(tilbage / 1024 / 1024)} MB. Delete something first.`
          : err.message,
      }));
      // Svar FOERST, luk BAGEFTER. Kalder man req.destroy() med det samme,
      // ser klienten "connection reset" i stedet for vores 413, og en
      // API-klient aner ikke hvorfor (RUNE-ERFARINGER, doda F7).
      res.on('finish', () => req.destroy());
    }
  },

  'GET /api/v1/files': (req, res, ctx) => {
    const auth = godkend(req, res, 'read');
    if (!auth) return;
    const noteId = ctx.query.get('note');
    /*
     * Uden `?note=` er listen MIN - det er filarkivet i indstillingerne, og
     * det maales mod min egen kvote. MED `?note=` er den notens, og saa
     * afgoer noten adgangen: ellers ville en delt sides vedhaeftningsrude
     * staa tom, mens billederne stod i teksten (F11).
     */
    if (noteId && !hentNote(auth.user.id, noteId)) {
      apiFejl(res, 404, 'not_found', 'No such note.');
      return;
    }
    const hvor = noteId ? 'note_id = ?' : 'user_id = ?';
    const arg = [noteId || auth.user.id];
    sendJson(res, 200, {
      files: db.prepare(`
        SELECT id, note_id, name, mime, size, width, height, created_at, orphan_since
           FROM attachments
         WHERE ${hvor} AND deleted_at IS NULL
           AND (orphan_since IS NULL OR orphan_since > ?)
         ORDER BY created_at DESC LIMIT 500`)
        .all(...arg, now() - FORAELDRELOES_FRIST)
        .map((f) => Object.assign(f, { url: `/api/v1/files/${f.id}`, inline: INLINE_MIME.has(f.mime) })),
      used: brugtPlads(auth.user.id),
      quota: maxSamlet(),
    });
  },

  /* --- passkeys ------------------------------------------------------ */

  'POST /api/passkey/register-options': (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const spaerre = passkeySpaerre(req);
    if (spaerre) { apiFejl(res, 400, 'not_available', spaerre); return; }
    sendJson(res, 200, pk.registerOptions(req, user));
  },

  'POST /api/passkey/register': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    try {
      const c = pk.registerVerify(req, user, body);
      db.prepare(`INSERT INTO credentials (id, user_id, name, public_key, alg, sign_count, created_at)
                  VALUES (?,?,?,?,?,?,?)`)
        .run(c.id, user.id, str(body.name, 60) || 'Passkey', c.publicKey, String(c.alg), c.signCount, now());
      audit('passkey-oprettet', user.id, user.username, null);
      sendJson(res, 200, { ok: true });
    } catch (err) {
      logSecurity(`passkey-registrering-fejl ip=${clientIp(req)}`);
      apiFejl(res, 400, 'passkey_failed', err.message);
    }
  },

  'POST /api/passkey/login-options': (req, res) => {
    const spaerre = passkeySpaerre(req);
    if (spaerre) { apiFejl(res, 400, 'not_available', spaerre); return; }
    if (!rateAllow(`pk:${clientIp(req)}`, 30, 900)) {
      apiFejl(res, 429, 'rate_limited', 'Too many attempts — try again in a little while.');
      return;
    }
    sendJson(res, 200, pk.loginOptions(req));
  },

  'POST /api/passkey/login': async (req, res) => {
    const body = await readJsonBody(req);
    const ip = clientIp(req);
    if (!rateAllow(`pk:${ip}`, 30, 900)) {
      apiFejl(res, 429, 'rate_limited', 'Too many attempts — try again in a little while.');
      return;
    }
    try {
      const { credential, signCount } = pk.loginVerify(req, body);
      db.prepare('UPDATE credentials SET sign_count = ?, last_used_at = ? WHERE id = ?')
        .run(signCount, now(), credential.id);
      const u = db.prepare('SELECT id, username, is_admin FROM users WHERE id = ?').get(credential.user_id);
      if (!u) { apiFejl(res, 401, 'passkey_failed', 'That passkey no longer belongs to an account.'); return; }
      audit('login-passkey', u.id, u.username, ip);
      const token = createSession(u.id);
      sendJson(res, 200, { user: { id: u.id, username: u.username, isAdmin: !!u.is_admin } },
        { 'Set-Cookie': sessionCookie(req, token, SESSION_DAYS * 86400) });
    } catch (err) {
      logSecurity(`passkey-login-fejl ip=${ip}`);
      apiFejl(res, 401, 'passkey_failed', err.message);
    }
  },

  'GET /api/v1/passkeys': (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    sendJson(res, 200, { passkeys: hentCredentials(user.id) });
  },
};

/* Ruter med et id i stien. Regexen skal vaere ANKRET - uden ^ og $ ville
   /api/v1/notes/abc/andet ogsaa matche. */
const MOENSTRE = [
  /* --------------------------------- administratorens kodeordsnulstilling */
  {
    /*
     * En administrator kan saette et nyt kodeord paa en anden konto.
     *
     * »Det skal også som administrator være muligt at skifte password på
     * brugere« (Andreas, 2026-08-21). Uden den er en glemt adgangskode paa en
     * énmandsserver en tur i databasen med sqlite3.
     *
     * Fire ting er bevidste, og de er alle fire vigtigere end funktionen:
     *
     *  1. **`requireAdmin`, ikke `godkend`.** En NOEGLE maa aldrig kunne
     *     skifte et kodeord - heller ikke `full`. Ellers ville én laekket
     *     noegle vaere nok til at overtage hver eneste konto paa serveren.
     *     Det er samme regel som `/api/password`, og den staar skrevet paa
     *     hjaelpesiden (F9).
     *  2. **Ikke sin egen.** En admin, der vil skifte SIT kodeord, gaar
     *     gennem `/api/password` og skal opgive det nuvaerende. Uden den
     *     graense ville en kapret admin-session kunne saette et nyt kodeord
     *     uden at kende det gamle og laase ejeren ude af sin egen server.
     *  3. **Alle den ramtes sessioner droppes.** En nulstilling skal kunne
     *     lukke en tyv ude; blev sessionerne staaende, kunne han blive.
     *  4. **API-noeglerne roeres IKKE.** De er andre legitimationer, brugeren
     *     selv har lavet, og en glemt adgangskode er ikke en grund til at
     *     slaa hans telefongenveje ihjel. Fladen SIGER det, saa det ikke er
     *     et hul, nogen opdager senere.
     */
    metode: 'POST', re: /^\/api\/v1\/admin\/users\/([a-f0-9]{32})\/password$/,
    kald: async (req, res, ctx) => {
      const admin = requireAdmin(req, res);
      if (!admin) return;
      const id = ctx.params[0];
      if (id === admin.id) {
        apiFejl(res, 400, 'not_yourself',
          'Change your own password under Your account — it asks for the current one.');
        return;
      }
      const maal = db.prepare('SELECT id, username FROM users WHERE id = ?').get(id);
      if (!maal) { apiFejl(res, 404, 'not_found', 'No such account.'); return; }
      const body = await readJsonBody(req);
      const next = typeof body.next === 'string' ? body.next : '';
      if (next.length < 8) {
        apiFejl(res, 400, 'bad_password', 'The password must be at least 8 characters.');
        return;
      }
      db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashPassword(next), maal.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(maal.id);
      logSecurity(`kodeord-nulstillet af=${admin.username} for=${maal.username} ip=${clientIp(req)}`);
      audit('kodeord-nulstillet-af-admin', admin.id, maal.username, clientIp(req));
      sendJson(res, 200, { ok: true, username: maal.username });
    },
  },

  /* ------------------------------------------------------ doda (F8) */
  {
    metode: 'GET', re: /^\/api\/v1\/notes\/([a-f0-9]{32})\/tasks$/,
    kald: async (req, res, ctx) => {
      const auth = godkend(req, res, 'read');
      if (!auth) return;
      const noteId = ctx.params[0];
      if (!hentNote(auth.user.id, noteId)) { apiFejl(res, 404, 'not_found', 'No such note.'); return; }
      // Opfriskningen sker her - ÉN gang i kvarteret, naar noten aabnes. Ikke
      // pr. optegning, og ikke pr. opgave.
      const frisk = await opfriskDodaOpgaver(auth.user.id, ctx.query.get('refresh') === '1');
      sendJson(res, 200, {
        tasks: dodaOpgaverFor(auth.user.id, noteId),
        connected: doda.opsaetning(auth.user.id).connected,
        // Fejlen fra doda sendes MED, i stedet for at faelde kaldet: raekkerne
        // er stadig rigtige, de er bare ikke friske.
        staleReason: frisk.fejl || null,
      });
    },
  },
  {
    /*
     * Afslut - eller fortryd - en opgave i doda, uden at forlade noten.
     *
     * »Mulighed for at afslutte en opgave i doda fra sagu, når de er listet i
     * sagu« (Andreas, 2026-08-24).
     *
     * Vi roerer KUN opgaver, der staar paa denne note. `doda_id` slaas op i
     * vores egen tabel med baade `user_id` og `note_id` - ikke bare sendt
     * videre. Ellers kunne enhver id, nogen kunne gaette, afsluttes gennem
     * Sagu, og det er dodas arkiv, ikke vores.
     *
     * Rekkefoelgen: doda foerst, vores raekke bagefter. Skrev vi vores egen
     * status foerst og dodas kald fejlede, ville Sagu staa og vise »done« om
     * noget, der stadig er aabent - og den slags opdager man for sent.
     */
    metode: 'POST', re: /^\/api\/v1\/notes\/([a-f0-9]{32})\/tasks\/([A-Za-z0-9_-]{1,64})$/,
    kald: async (req, res, ctx) => {
      const auth = godkend(req, res, 'write');
      if (!auth) return;
      const [noteId, dodaId] = ctx.params;
      if (!hentNote(auth.user.id, noteId)) { apiFejl(res, 404, 'not_found', 'No such note.'); return; }
      const raekke = db.prepare(
        'SELECT id, status FROM doda_tasks WHERE user_id = ? AND note_id = ? AND doda_id = ?')
        .get(auth.user.id, noteId, dodaId);
      if (!raekke) { apiFejl(res, 404, 'not_found', 'That task is not on this note.'); return; }

      const body = await readJsonBody(req, auth.viaToken);
      const udfoert = body.done !== false;
      const svar = await doda.saetUdfoert(auth.user.id, dodaId, udfoert);
      if (!svar.ok) {
        apiFejl(res, svar.kode === 'not_connected' ? 409 : 502, svar.kode,
          svar.kode === 'wrong_scope'
            // dodas egen besked siger hvilket scope noeglen HAR; vi siger hvad
            // der skal til. Sammen er de en anvisning, ikke en klage.
            ? `${svar.besked} Ticking a task off needs a "full" key in doda.`
            : svar.besked);
        return;
      }
      const nu = now();
      db.prepare('UPDATE doda_tasks SET status = ?, checked_at = ? WHERE id = ?')
        .run(udfoert ? 'done' : 'next', nu, raekke.id);
      sendJson(res, 200, {
        tasks: dodaOpgaverFor(auth.user.id, noteId),
        message: udfoert ? 'Marked done in doda.' : 'Put back in doda.',
      });
    },
  },
  {
    metode: 'POST', re: /^\/api\/v1\/notes\/([a-f0-9]{32})\/tasks$/,
    kald: async (req, res, ctx) => {
      const auth = godkend(req, res, 'write');
      if (!auth) return;
      const noteId = ctx.params[0];
      const note = hentNote(auth.user.id, noteId);
      if (!note) { apiFejl(res, 404, 'not_found', 'No such note.'); return; }
      const body = await readJsonBody(req, auth.viaToken);
      const tekst = str(body.text, 500).trim();
      if (!tekst) { apiFejl(res, 400, 'no_text', 'Write what the task should say.'); return; }

      const svar = await doda.opretOpgave(auth.user.id, tekst, {
        linkUrl: noteAdresse(req, noteId),
        linkTitle: note.title || 'Untitled',
      });
      if (!svar.ok) {
        /*
         * En fejlet forbindelse er IKKE en fejlet gemning.
         *
         * Statuskoden skal kunne skelnes af frontenden, saa den kan vise en
         * chip med en paen besked frem for »kunne ikke gemme« - accepten i
         * SAGU-PLAN F8 handler om netop det.
         */
        apiFejl(res, svar.kode === 'not_connected' ? 409 : 502, svar.kode, svar.besked);
        return;
      }
      const id = newId();
      db.prepare(`INSERT INTO doda_tasks (id, user_id, note_id, doda_id, title, status, line, created_at, checked_at)
                  VALUES (?,?,?,?,?,?,?,?,?)
                  ON CONFLICT(user_id, doda_id) DO NOTHING`)
        .run(id, auth.user.id, noteId, String(svar.item.id),
          str(renOpgaveTitel(svar.item.title, noteId), 300),
          str(svar.item.status, 40) || 'open',
          Number.isInteger(body.line) ? body.line : null, now(), now());
      audit('doda-opgave', auth.user.id, noteId, svar.item.id);
      sendJson(res, 200, {
        tasks: dodaOpgaverFor(auth.user.id, noteId),
        message: svar.besked,
      });
    },
  },

  /* ------------------------------------------------ kommentarer (F7) */
  {
    metode: 'GET', re: /^\/api\/v1\/notes\/([a-f0-9]{32})\/comments$/,
    kald: (req, res, ctx) => {
      const auth = godkend(req, res, 'read');
      if (!auth) return;
      const noteId = ctx.params[0];
      // Notens egen adgangsregel afgoer det. Ingen vej udenom via `comments`.
      if (!hentNote(auth.user.id, noteId)) { apiFejl(res, 404, 'not_found', 'No such note.'); return; }
      sendJson(res, 200, {
        comments: hentKommentarer(noteId, kanModerere(auth.user.id, noteId)),
      });
    },
  },
  {
    /*
     * At kommentere kraever `capture` - ikke `write`.
     *
     * En kommentar er noget NYT ved siden af noten, ikke en aendring af den.
     * Det er praecis dét, `capture` findes til, og det er samme skel som F11
     * allerede traf: en kollega med LAESE-adgang maa gerne kommentere, fordi
     * »kig lige paa det her« tit er hele grunden til at dele en side. At
     * tilfoeje til selve noten (§28) kraever derimod skriveadgang, for dét
     * aendrer siden.
     *
     * Aendret 2026-08-21, saa dodas `link`-noegle kan skrive en kommentar
     * tilbage paa den note, en opgave kom fra.
     */
    metode: 'POST', re: /^\/api\/v1\/notes\/([a-f0-9]{32})\/comments$/,
    kald: async (req, res, ctx) => {
      const auth = godkend(req, res, 'capture');
      if (!auth) return;
      const noteId = ctx.params[0];
      if (!hentNote(auth.user.id, noteId)) { apiFejl(res, 404, 'not_found', 'No such note.'); return; }
      const body = await readJsonBody(req, auth.viaToken);
      const svar = opretKommentar({
        noteId, userId: auth.user.id, body: body.body, parentId: body.parentId,
        kind: body.kind, origin: 'app',
        /*
         * Kom kommentaren gennem en NOEGLE, baerer den noeglens navn.
         *
         * Navnet er brugerens eget - han doebte noeglen "tovo", da han
         * oprettede den - saa Sagu behoever hverken at kende tovo eller
         * doda. En session har ingen noegle og saetter ingenting: en
         * kommentar skrevet i Sagu skal ikke maerkes med noget.
         */
        via: auth.viaToken ? (auth.token && auth.token.name) : '',
      });
      if (svar.fejl) { apiFejl(res, 400, svar.fejl[0], svar.fejl[1]); return; }
      /*
       * **Listen kommer KUN med, hvis noeglen ogsaa maa laese.**
       *
       * Svaret indeholdt hele samtalen. Havde vi bare saenket scopet, var
       * skrive-doeren blevet til en laese-kanal: en `capture`-noegle kunne
       * skrive en tom-agtig kommentar paa et hvilket som helst note-id og
       * faa alt, hvad der staar, retur - og saa er den ene ting, `capture`
       * findes for, vaek (»writes but never looks«).
       *
       * En `link`-noegle (capture+read) og en session faar listen som foer.
       */
      sendJson(res, 200, Object.assign(
        { id: svar.id, message: svar.ventende ? 'Comment added — it is waiting to be approved.' : 'Comment added.' },
        maaLaese(auth) ? { comments: hentKommentarer(noteId, kanModerere(auth.user.id, noteId)) } : {},
      ));
    },
  },
  {
    metode: 'PATCH', re: /^\/api\/v1\/comments\/([a-f0-9]{32})$/,
    kald: async (req, res, ctx) => {
      const auth = godkend(req, res, 'write');
      if (!auth) return;
      const r = hentKommentarFor(auth.user.id, ctx.params[0]);
      if (!r) { apiFejl(res, 404, 'not_found', 'No such comment.'); return; }
      const body = await readJsonBody(req, auth.viaToken);
      const moderator = kanModerere(auth.user.id, r.note_id);
      const egen = r.user_id && r.user_id === auth.user.id;

      // To forskellige rettigheder, og de maa ikke smelte sammen: man retter
      // sin EGEN tekst, og man modererer ANDRES. En moderator maa afgoere, om
      // en kommentar staar - ikke skrive om paa, hvad den siger.
      if (body.status !== undefined) {
        if (!moderator) { apiFejl(res, 403, 'not_allowed', 'Only the note owner can moderate comments.'); return; }
        const s = String(body.status);
        if (!['pending', 'published', 'rejected'].includes(s)) {
          apiFejl(res, 400, 'bad_status', 'A comment is pending, published or rejected.'); return;
        }
        db.prepare('UPDATE comments SET status = ? WHERE id = ?').run(s, r.id);
        audit('kommentar-modereret', auth.user.id, r.id, s);
      }
      if (body.body !== undefined) {
        if (!egen) { apiFejl(res, 403, 'not_allowed', 'You can only edit your own comments.'); return; }
        const tekst = str(body.body, MAX_KOMMENTAR).trim();
        if (!tekst) { apiFejl(res, 400, 'empty_comment', 'Write something first.'); return; }
        db.prepare('UPDATE comments SET body = ?, updated_at = ?, edited_at = ? WHERE id = ?')
          .run(tekst, now(), now(), r.id);
      }
      sendJson(res, 200, { comments: hentKommentarer(r.note_id, moderator) });
    },
  },
  {
    metode: 'DELETE', re: /^\/api\/v1\/comments\/([a-f0-9]{32})$/,
    kald: (req, res, ctx) => {
      const auth = godkend(req, res, 'write');
      if (!auth) return;
      const r = hentKommentarFor(auth.user.id, ctx.params[0]);
      if (!r) { apiFejl(res, 404, 'not_found', 'No such comment.'); return; }
      const moderator = kanModerere(auth.user.id, r.note_id);
      if (!moderator && r.user_id !== auth.user.id) {
        apiFejl(res, 403, 'not_allowed', 'You can only delete your own comments.'); return;
      }
      // Bloed sletning - og svarene falder med, ellers staar de og peger paa
      // noget, der ikke er der (samme regel som et undertrae, Sagu F1).
      db.prepare('UPDATE comments SET deleted_at = ? WHERE id = ? OR parent_id = ?')
        .run(now(), r.id, r.id);
      audit('kommentar-slettet', auth.user.id, r.id, '');
      sendJson(res, 200, { comments: hentKommentarer(r.note_id, moderator) });
    },
  },
  {
    metode: 'GET', re: /^\/api\/v1\/notes\/([a-f0-9]{32})$/,
    kald: (req, res, ctx) => {
      const auth = godkend(req, res, 'read');
      if (!auth) return;
      const note = hentNote(auth.user.id, ctx.params[0]);
      // 404 baade naar noten ikke findes, og naar den er en andens. Man maa
      // ikke kunne aftaste, hvilke id'er der er i brug.
      if (!note) { apiFejl(res, 404, 'not_found', 'No such note.'); return; }
      /*
       * Sporet (F13). Her, fordi det er HER en note bliver aabnet - uanset om
       * det var fra sidebaren, fra en soegning, fra et [[link]] eller fra en
       * genvej. Lagde man det i frontenden, ville den femte vej ind mangle.
       *
       * `viaToken` udelades: en iOS-genvej, der henter en note som markdown,
       * og en MCP-klient, der laeser den for at svare paa noget, er ikke mig,
       * der »var her«. Sporet skal svare paa hvor JEG var.
       */
      if (!auth.viaToken) noterBesoeg(auth.user.id, note.id);
      /*
       * `?format=md` giver noten som REN MARKDOWN.
       *
       * En genvej vil have teksten, ikke et JSON-objekt at grave i - og
       * markdown ER sandheden i databasen, saa der er intet at konvertere.
       * Det er hele udbyttet af beslutning 1 (DESIGN.md §1).
       */
      if (String(ctx.query.get('format') || '') === 'md') {
        /*
         * Har noten sin EGEN overskrift, staar den uroert.
         *
         * Foerste udgave klippede den af og satte titlen ind i stedet - og saa
         * blev dagens note til »# 2026-08-21« i stedet for »# Friday, 21
         * August 2026«, som brugeren faktisk havde staaende. At skrive om paa
         * nogens tekst er vaerre end at gentage en titel (Sagu F4).
         *
         * Uden en overskrift saettes titlen foran, saa teksten kan staa alene
         * i en mail uden at begynde midt i noget.
         */
        const krop = String(note.body || '');
        const tekst = /^#{1,6}\s/.test(krop.trimStart()) ? krop : `# ${note.title}\n\n${krop}`;
        const buf = Buffer.from(tekst, 'utf8');
        res.writeHead(200, {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Length': buf.length,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(buf);
        return;
      }
      sendJson(res, 200, { note });
    },
  },
  {
    metode: 'PATCH', re: /^\/api\/v1\/notes\/([a-f0-9]{32})$/,
    kald: async (req, res, ctx) => {
      const auth = godkend(req, res, 'write');
      if (!auth) return;
      const body = await readJsonBody(req, auth.viaToken);
      const svar = gemNote(auth.user.id, ctx.params[0], body);
      if (svar.fejl === 'not_found') { apiFejl(res, 404, 'not_found', 'No such note.'); return; }
      if (svar.fejl === 'conflict') {
        sendJson(res, 409, {
          error: 'conflict',
          message: 'Someone else saved this note while you were editing. Nothing was overwritten.',
          updatedAt: svar.updatedAt,
        });
        return;
      }
      sendJson(res, 200, { note: svar.note });
    },
  },
  {
    metode: 'DELETE', re: /^\/api\/v1\/notes\/([a-f0-9]{32})$/,
    kald: (req, res, ctx) => {
      const auth = godkend(req, res, 'write');
      if (!auth) return;
      // Undersiderne foelger med i papirkurven - ellers staar de tilbage som
      // foraeldreloese. Kaskaden markeres, saa en gendannelse vaekker praecis
      // dem og ikke dem, brugeren slettede enkeltvis.
      const svar = sletUndertrae(auth.user.id, ctx.params[0]);
      if (svar.fejl) { apiFejl(res, 404, 'not_found', 'No such note.'); return; }
      sendJson(res, 200, { ok: true, deleted: svar.antal });
    },
  },
  {
    // Flytning i traeet. Egen rute frem for et felt paa PATCH: den har sin
    // egen fejl (cycle), og den flytter et helt undertrae med.
    metode: 'POST', re: /^\/api\/v1\/notes\/([a-f0-9]{32})\/move$/,
    kald: async (req, res, ctx) => {
      const auth = godkend(req, res, 'write');
      if (!auth) return;
      const body = await readJsonBody(req, auth.viaToken);
      const svar = flytNote(auth.user.id, ctx.params[0], body);
      if (svar.fejl === 'not_found') { apiFejl(res, 404, 'not_found', 'No such note.'); return; }
      if (svar.fejl === 'cycle') {
        apiFejl(res, 400, 'would_loop',
          'A note cannot be moved inside one of its own subpages — that would make a loop.');
        return;
      }
      if (svar.fejl === 'anden_ejer') {
        apiFejl(res, 400, 'other_owner',
          'That page belongs to someone else. A page and its subpages always have one owner — '
          + 'copy it instead, or ask the owner to hand it over.');
        return;
      }
      sendJson(res, 200, { note: svar.note });
    },
  },
  {
    metode: 'POST', re: /^\/api\/v1\/notes\/([a-f0-9]{32})\/duplicate$/,
    kald: async (req, res, ctx) => {
      const auth = godkend(req, res, 'write');
      if (!auth) return;
      const body = await readJsonBody(req, auth.viaToken);
      const svar = duplikerNote(auth.user.id, ctx.params[0], !!body.withChildren);
      if (svar.fejl) { apiFejl(res, 404, 'not_found', 'No such note.'); return; }
      sendJson(res, 200, { note: svar.note });
    },
  },
  {
    metode: 'POST', re: /^\/api\/v1\/notes\/([a-f0-9]{32})\/restore$/,
    kald: (req, res, ctx) => {
      const auth = godkend(req, res, 'write');
      if (!auth) return;
      const svar = gendanNote(auth.user.id, ctx.params[0]);
      if (svar.fejl) { apiFejl(res, 404, 'not_found', 'No such note in the trash.'); return; }
      sendJson(res, 200, { note: svar.note, restored: svar.antal });
    },
  },
  {
    metode: 'GET', re: /^\/api\/v1\/notes\/([a-f0-9]{32})\/versions$/,
    kald: (req, res, ctx) => {
      const auth = godkend(req, res, 'read');
      if (!auth) return;
      if (!hentNote(auth.user.id, ctx.params[0])) {
        apiFejl(res, 404, 'not_found', 'No such note.');
        return;
      }
      const opsaet = versionsOpsaetning(auth.user.id);
      sendJson(res, 200, {
        // Fladen skal kunne SIGE hvorfor listen er tom: slaaet fra er noget
        // andet end »der er ikke sket noget endnu«.
        enabled: opsaet.enabled,
        keep: opsaet.keep,
        versions: db.prepare(`
          SELECT id, title, at, user_id, length(body_md) AS size
            FROM note_versions WHERE note_id = ? ORDER BY at DESC, rowid DESC LIMIT ?`)
          .all(ctx.params[0], VERSIONER_MAKS),
      });
    },
  },
  {
    /* Selve teksten i ÉN version. Listen baerer kun stoerrelsen. */
    metode: 'GET', re: /^\/api\/v1\/notes\/([a-f0-9]{32})\/versions\/([a-f0-9]{32})$/,
    kald: (req, res, ctx) => {
      const auth = godkend(req, res, 'read');
      if (!auth) return;
      const [noteId, vId] = ctx.params;
      if (!hentNote(auth.user.id, noteId)) { apiFejl(res, 404, 'not_found', 'No such note.'); return; }
      // `note_id` skal MED i opslaget. Ellers kunne en version fra en anden
      // note haentes gennem en note, man har adgang til.
      const v = db.prepare(`SELECT id, title, body_md, at FROM note_versions
                             WHERE id = ? AND note_id = ?`).get(vId, noteId);
      if (!v) { apiFejl(res, 404, 'not_found', 'No such version.'); return; }
      sendJson(res, 200, { version: { id: v.id, title: v.title, body: v.body_md, at: v.at } });
    },
  },
  {
    /*
     * Gaa tilbage til en version.
     *
     * Den nuvaerende tekst gemmes som en version foerst - gennem den
     * ALMINDELIGE vej (`opdaterNote` kalder `gemVersion`), saa en gendannelse
     * kan fortrydes praecis som enhver anden rettelse. En vej tilbage, der
     * ikke selv kan fortrydes, er en faelde.
     */
    metode: 'POST', re: /^\/api\/v1\/notes\/([a-f0-9]{32})\/versions\/([a-f0-9]{32})$/,
    kald: async (req, res, ctx) => {
      const auth = godkend(req, res, 'write');
      if (!auth) return;
      const [noteId, vId] = ctx.params;
      const note = hentNote(auth.user.id, noteId);
      if (!note) { apiFejl(res, 404, 'not_found', 'No such note.'); return; }
      if (!maaSkrive(auth.user.id, noteId)) {
        apiFejl(res, 403, 'read_only', 'This page was shared with you for reading.');
        return;
      }
      const v = db.prepare(`SELECT title, body_md FROM note_versions
                             WHERE id = ? AND note_id = ?`).get(vId, noteId);
      if (!v) { apiFejl(res, 404, 'not_found', 'No such version.'); return; }
      // Gem det, vi er ved at forlade - UDEN om skrivestunds-vinduet.
      gemVersion(noteId, auth.user.id, true);
      const r = gemNote(auth.user.id, noteId, { title: v.title, body: v.body_md });
      if (r.fejl) { apiFejl(res, 404, 'not_found', 'No such note.'); return; }
      audit('version-gendannet', auth.user.id, note.title || '', vId);
      sendJson(res, 200, { note: r.note });
    },
  },
  {
    /*
     * Personlige valg om fladen.
     *
     * »Tilføj en mulighed under settings som hvis slået til så når man klikker
     * på en linje i en note gør hele noten til markdown« (Andreas,
     * 2026-08-25).
     *
     * Én rute til den slags i stedet for én pr. valg: naeste valg er saa et
     * felt, ikke et endepunkt. `requireUser` - en noegle saetter ikke
     * indstillinger.
     */
    metode: 'POST', re: /^\/api\/v1\/prefs$/,
    kald: async (req, res) => {
      const user = requireUser(req, res);
      if (!user) return;
      const body = await readJsonBody(req);
      if (Object.prototype.hasOwnProperty.call(body, 'editWhole')) {
        setSetting(user.id, 'edit_whole', body.editWhole ? '1' : '');
      }
      sendJson(res, 200, { editWhole: getSetting(user.id, 'edit_whole', '') === '1' });
    },
  },
  {
    /* Kontakten og antallet. Personlige - Sagu er flerbruger. */
    metode: 'POST', re: /^\/api\/v1\/versions$/,
    kald: async (req, res) => {
      const user = requireUser(req, res);      // en noegle saetter ikke indstillinger
      if (!user) return;
      const body = await readJsonBody(req);
      if (Object.prototype.hasOwnProperty.call(body, 'enabled')) {
        /*
         * At slaa fra SLETTER ingenting.
         *
         * Det, der allerede er gemt, er en kendsgerning om noten - at rydde
         * det, fordi man skifter en indstilling, ville vaere at aendre
         * historikken (samme regel som en frakoblet doda). Fladen siger det.
         */
        setSetting(user.id, 'versions_off', body.enabled ? '' : '1');
      }
      if (Object.prototype.hasOwnProperty.call(body, 'keep')) {
        const antal = Math.round(Number(body.keep));
        if (!Number.isFinite(antal) || antal < VERSIONER_MIN || antal > VERSIONER_MAKS) {
          apiFejl(res, 400, 'bad_keep',
            `Keep between ${VERSIONER_MIN} and ${VERSIONER_MAKS} versions of each note.`);
          return;
        }
        setSetting(user.id, 'versions_keep', String(antal));
        // Et nyt antal skal GAELDE med det samme - ogsaa for de noter, man
        // ikke roerer igen. Ellers er tallet et loefte om en oprydning, der
        // aldrig sker.
        const vaek = beskaerAlleVersioner(user.id, antal);
        if (vaek) audit('versioner-beskaaret', user.id, null, String(vaek));
      }
      sendJson(res, 200, versionsOpsaetning(user.id));
    },
  },
  {
    metode: 'PATCH', re: /^\/api\/v1\/notebooks\/([a-f0-9]{32})$/,
    kald: async (req, res, ctx) => {
      const auth = godkend(req, res, 'write');
      if (!auth) return;
      const body = await readJsonBody(req, auth.viaToken);
      const saet = [];
      const arg = [];
      const har = (k) => Object.prototype.hasOwnProperty.call(body, k);
      if (har('name')) { saet.push('name = ?'); arg.push(str(body.name, 200) || 'Untitled'); }
      if (har('icon')) { saet.push('icon = ?'); arg.push(str(body.icon, 16)); }
      if (har('archived')) { saet.push('archived_at = ?'); arg.push(body.archived ? now() : null); }
      if (!saet.length) { apiFejl(res, 400, 'nothing_to_change', 'Send a name, icon or archived flag.'); return; }
      saet.push('updated_at = ?');
      arg.push(now());
      const r = db.prepare(`UPDATE notebooks SET ${saet.join(', ')}
                             WHERE id = ? AND user_id = ? AND deleted_at IS NULL`)
        .run(...arg, ctx.params[0], auth.user.id);
      if (!r.changes) { apiFejl(res, 404, 'not_found', 'No such notebook.'); return; }
      sendJson(res, 200, {
        notebook: db.prepare(`SELECT id, name, icon, seq, archived_at, created_at, updated_at
                                FROM notebooks WHERE id = ?`).get(ctx.params[0]),
      });
    },
  },
  {
    metode: 'DELETE', re: /^\/api\/v1\/notebooks\/([a-f0-9]{32})$/,
    kald: (req, res, ctx) => {
      const auth = godkend(req, res, 'write');
      if (!auth) return;
      const id = ctx.params[0];
      const bog = db.prepare('SELECT id FROM notebooks WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
        .get(id, auth.user.id);
      if (!bog) { apiFejl(res, 404, 'not_found', 'No such notebook.'); return; }
      const t = now();
      db.exec('BEGIN');
      try {
        db.prepare('UPDATE notebooks SET deleted_at = ?, updated_at = ? WHERE id = ?').run(t, t, id);
        // Noterne foelger MED i papirkurven, men de LOESRIVES ikke: de skal
        // kunne gendannes sammen med bogen. deleted_root peger paa bogen, saa
        // en gendannelse af bogen vaekker praecis dem.
        const noter = db.prepare(`SELECT id FROM notes
                                   WHERE notebook_id = ? AND user_id = ? AND deleted_at IS NULL`)
          .all(id, auth.user.id);
        for (const n of noter) {
          db.prepare('UPDATE notes SET deleted_at = ?, deleted_root = ?, updated_at = ? WHERE id = ?')
            .run(t, id, t, n.id);
          db.prepare('DELETE FROM note_fts WHERE note_id = ?').run(n.id);
        }
        db.exec('COMMIT');
        audit('notesbog-slettet', auth.user.id, id, `${noter.length} noter`);
        sendJson(res, 200, { ok: true, notes: noter.length });
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
  },
  {
    /*
     * Servering.
     *
     * ETag = filens sha + `immutable`: indholdet kan ALDRIG aendre sig for et
     * givet id, saa en 304 er gratis. Kun de fem raster-typer vises inline;
     * alt andet faar octet-stream + attachment + nosniff.
     */
    metode: 'GET', re: /^\/api\/v1\/files\/([a-f0-9]{32})$/,
    kald: (req, res, ctx) => {
      const auth = godkend(req, res, 'read');
      if (!auth) return;
      const f = hentFil(auth.user.id, ctx.params[0]);
      if (!f) { apiFejl(res, 404, 'not_found', 'No such file.'); return; }
      // Samme funktion som wikien bruger: hvidlisten over inline-typer og
      // sti-tjekket maa kun findes ÉT sted.
      sendFil(req, res, f, false);
    },
  },
  {
    metode: 'DELETE', re: /^\/api\/v1\/files\/([a-f0-9]{32})$/,
    kald: (req, res, ctx) => {
      const auth = godkend(req, res, 'write');
      if (!auth) return;
      // Skarpere end GET'ens: en note, man kun maa laese, maa man ikke rydde
      // op i. Samme 404 begge veje - en 403 ville bekraefte, at filen findes.
      const f = hentFilTilSkrivning(auth.user.id, ctx.params[0]);
      if (!f) { apiFejl(res, 404, 'not_found', 'No such file.'); return; }
      db.prepare('UPDATE attachments SET deleted_at = ? WHERE id = ?').run(now(), f.id);
      // Selve filen ryddes af sweep() efter fristen - saa kan en fortrudt
      // sletning stadig fortrydes, og en note, der linker til den, viser ikke
      // et hul med det samme.
      sendJson(res, 200, { ok: true });
    },
  },
  {
    /*
     * At aendre en udgivelse.
     *
     * Reglen, hele modellen staar paa: `slug` og `token` roeres ALDRIG af et
     * kodeordsskift. Slaar Andreas kodeord til i morgen, skal linket i
     * kollegaernes bogmaerker stadig virke - de bliver bare moedt af en
     * kodeordsside. En udgivelse, der skifter adresse naar den beskyttes, er
     * ubrugelig (CLAUDE.md). Derfor staar `password` i sin egen gren, og
     * `slug` kan kun aendres ved udtrykkeligt at sende et nyt.
     */
    metode: 'PATCH', re: /^\/api\/v1\/shares\/([a-f0-9]{32})$/,
    kald: async (req, res, ctx) => {
      const auth = godkend(req, res, 'write');
      if (!auth) return;
      const share = hentUdgivelseRaekke(auth.user.id, ctx.params[0]);
      if (!share) { apiFejl(res, 404, 'not_found', 'No such publication.'); return; }
      const body = await readJsonBody(req, auth.viaToken);
      const saet = [];
      const arg = [];
      const har = (n) => Object.prototype.hasOwnProperty.call(body, n);

      if (har('password')) {
        // null eller "" rydder kodeordet. Alt andet saetter det.
        if (body.password === null || body.password === '') {
          saet.push('password_hash = NULL');
        } else {
          const k = String(body.password);
          if (k.length < 6) {
            apiFejl(res, 400, 'bad_password', 'A wiki password must be at least 6 characters.');
            return;
          }
          saet.push('password_hash = ?');
          arg.push(hashPassword(k));
        }
      }
      if (har('slug')) {
        const ny = body.slug ? renSlug(body.slug) : null;
        if (body.slug && !ny) {
          apiFejl(res, 400, 'bad_slug',
            'A web address may hold letters a–z, digits and hyphens — nothing else.');
          return;
        }
        if (ny && slugTaget(ny, share.id)) {
          apiFejl(res, 409, 'slug_taken', 'That address is already in use. Pick another one.');
          return;
        }
        saet.push('slug = ?');
        arg.push(ny);
      }
      if (har('mode')) { saet.push('mode = ?'); arg.push(body.mode === 'single' ? 'single' : 'tree'); }
      if (har('allowComments')) { saet.push('allow_comments = ?'); arg.push(body.allowComments ? 1 : 0); }
      if (har('moderateComments')) { saet.push('moderate_comments = ?'); arg.push(body.moderateComments ? 1 : 0); }
      if (har('allowSearch')) { saet.push('allow_search = ?'); arg.push(body.allowSearch ? 1 : 0); }
      if (har('allowIndex')) { saet.push('allow_index = ?'); arg.push(body.allowIndex ? 1 : 0); }
      if (har('expiresAt')) { saet.push('expires_at = ?'); arg.push(tidsstempel(body.expiresAt)); }
      if (!saet.length) { apiFejl(res, 400, 'nothing_to_change', 'Send at least one field to change.'); return; }

      db.prepare(`UPDATE shares SET ${saet.join(', ')} WHERE id = ? AND user_id = ?`)
        .run(...arg, share.id, auth.user.id);
      audit('udgivelse-aendret', auth.user.id, share.note_id, saet.join(' '));
      sendJson(res, 200, { share: formUdgivelse(hentUdgivelseRaekke(auth.user.id, share.id)) });
    },
  },
  {
    metode: 'DELETE', re: /^\/api\/v1\/tags\/([a-f0-9]{32})$/,
    kald: (req, res, ctx) => {
      const auth = godkend(req, res, 'write');
      if (!auth) return;
      const t = db.prepare('SELECT id, name FROM tags WHERE id = ? AND user_id = ?')
        .get(ctx.params[0], auth.user.id);
      if (!t) { apiFejl(res, 404, 'not_found', 'No such tag.'); return; }
      // Noterne roeres ikke - kun koblingen. At slette et maerke maa aldrig
      // kunne tage indhold med sig.
      const noter = db.prepare('SELECT note_id FROM note_tags WHERE tag_id = ?').all(t.id);
      db.prepare('DELETE FROM tags WHERE id = ?').run(t.id);
      for (const n of noter) indekser(n.note_id);
      sendJson(res, 200, { ok: true, notes: noter.length });
    },
  },
  {
    metode: 'DELETE', re: /^\/api\/v1\/shares\/([a-f0-9]{32})$/,
    kald: (req, res, ctx) => {
      const auth = godkend(req, res, 'write');
      if (!auth) return;
      // Tilbagekaldelsen virker ved NAESTE kald: opslaget filtrerer paa
      // revoked_at, og der er ingen cache at rydde. En udgivelse, der doer
      // "om lidt", er ikke tilbagekaldt.
      const r = db.prepare('UPDATE shares SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL')
        .run(now(), ctx.params[0], auth.user.id);
      if (!r.changes) { apiFejl(res, 404, 'not_found', 'No such publication.'); return; }
      audit('udgivelse-tilbagekaldt', auth.user.id, ctx.params[0], null);
      sendJson(res, 200, { ok: true });
    },
  },
  {
    /*
     * Stjernen. `PUT`/`DELETE` paa den samme adresse, ikke et felt paa noten:
     * en favorit er MIN, ikke notens - og en delt note maa ikke faa min
     * stjerne til at dukke op hos ejeren (F13).
     */
    metode: 'PUT', re: /^\/api\/v1\/notes\/([a-f0-9]{32})\/favorite$/,
    kald: (req, res, ctx) => {
      const auth = godkend(req, res, 'read');
      if (!auth) return;
      const r = saetFavorit(auth.user.id, ctx.params[0], true);
      if (r.fejl) { apiFejl(res, r.fejl[0], r.fejl[1], r.fejl[2]); return; }
      sendJson(res, 200, r);
    },
  },
  {
    metode: 'DELETE', re: /^\/api\/v1\/notes\/([a-f0-9]{32})\/favorite$/,
    kald: (req, res, ctx) => {
      const auth = godkend(req, res, 'read');
      if (!auth) return;
      const r = saetFavorit(auth.user.id, ctx.params[0], false);
      if (r.fejl) { apiFejl(res, r.fejl[0], r.fejl[1], r.fejl[2]); return; }
      sendJson(res, 200, r);
    },
  },
  {
    /* --- hvem har adgang til den her side? (F11) --- */
    metode: 'GET', re: /^\/api\/v1\/notes\/([a-f0-9]{32})\/access$/,
    kald: (req, res, ctx) => {
      const auth = godkend(req, res, 'read');
      if (!auth) return;
      const d = hentAdgang(auth.user.id, ctx.params[0]);
      if (!d) { apiFejl(res, 404, 'not_found', 'No such note.'); return; }
      sendJson(res, 200, d);
    },
  },
  {
    metode: 'POST', re: /^\/api\/v1\/notes\/([a-f0-9]{32})\/access$/,
    kald: async (req, res, ctx) => {
      /*
       * Deling kraever en SESSION, ikke bare en skrive-noegle.
       *
       * Det er samme skel som noegler og kodeord: en noegle maa aendre
       * INDHOLD, ikke hvem der kan naa det. Ellers kunne en laekket
       * `full`-noegle give en fremmed konto varig adgang til arkivet - og det
       * ville se ud som en helt almindelig deling bagefter.
       */
      const user = requireUser(req, res);
      if (!user) return;
      const body = await readJsonBody(req);
      const svar = delNote(user.id, ctx.params[0], body);
      if (svar.fejl) { apiFejl(res, svar.fejl[0], svar.fejl[1], svar.fejl[2]); return; }
      sendJson(res, 200, svar);
    },
  },
  {
    metode: 'DELETE', re: /^\/api\/v1\/notes\/([a-f0-9]{32})\/access\/([a-f0-9]{32})$/,
    kald: (req, res, ctx) => {
      const user = requireUser(req, res);
      if (!user) return;
      const svar = fjernDeling(user.id, ctx.params[0], ctx.params[1]);
      if (svar.fejl) { apiFejl(res, svar.fejl[0], svar.fejl[1], svar.fejl[2]); return; }
      sendJson(res, 200, { ok: true });
    },
  },
  {
    /* --- giv siden videre. Ejerens egen handling, og kun hans. --- */
    metode: 'POST', re: /^\/api\/v1\/notes\/([a-f0-9]{32})\/owner$/,
    kald: async (req, res, ctx) => {
      const user = requireUser(req, res);
      if (!user) return;
      const body = await readJsonBody(req);
      const svar = givVidere(user.id, ctx.params[0], body.username);
      if (svar.fejl) { apiFejl(res, svar.fejl[0], svar.fejl[1], svar.fejl[2]); return; }
      sendJson(res, 200, svar);
    },
  },
  {
    /*
     * Tilbagekald en forbindelse.
     *
     * BEGGE dele skal dø: access-tokenet virker ellers til det udloeber (op
     * til 8 timer), og refresh-tokenet ville kunne lave et nyt bagefter. Et
     * "tilbagekaldt" der virker otte timer endnu, er ikke et tilbagekald.
     */
    metode: 'DELETE', re: /^\/api\/v1\/connections\/(sagu-client-[a-f0-9]{24})$/,
    kald: (req, res, ctx) => {
      const user = requireUser(req, res);
      if (!user) return;
      const klient = db.prepare('SELECT name FROM oauth_clients WHERE id = ?').get(ctx.params[0]);
      const n = tilbagekaldKlient(user.id, ctx.params[0]);
      if (!n) { apiFejl(res, 404, 'not_found', 'No such connection.'); return; }
      audit('oauth-forbindelse-tilbagekaldt', user.id, klient ? klient.name : ctx.params[0], null);
      sendJson(res, 200, { ok: true });
    },
  },
  {
    metode: 'DELETE', re: /^\/api\/v1\/keys\/([a-f0-9]{32})$/,
    kald: (req, res, ctx) => {
      const user = requireUser(req, res);
      if (!user) return;
      const r = db.prepare('UPDATE tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL')
        .run(now(), ctx.params[0], user.id);
      if (!r.changes) { apiFejl(res, 404, 'not_found', 'No such key.'); return; }
      audit('noegle-tilbagekaldt', user.id, ctx.params[0], null);
      sendJson(res, 200, { ok: true });
    },
  },
  {
    metode: 'DELETE', re: /^\/api\/v1\/passkeys\/([A-Za-z0-9_-]{1,255})$/,
    kald: (req, res, ctx) => {
      const user = requireUser(req, res);
      if (!user) return;
      const r = db.prepare('DELETE FROM credentials WHERE id = ? AND user_id = ?').run(ctx.params[0], user.id);
      if (!r.changes) { apiFejl(res, 404, 'not_found', 'No such passkey.'); return; }
      audit('passkey-slettet', user.id, user.username, null);
      sendJson(res, 200, { ok: true });
    },
  },
];

function findRute(metode, sti) {
  const direkte = ROUTES[`${metode} ${sti}`];
  if (direkte) return { kald: direkte, params: [] };
  for (const m of MOENSTRE) {
    if (m.metode !== metode) continue;
    const fund = sti.match(m.re);
    if (fund) return { kald: m.kald, params: fund.slice(1) };
  }
  return null;
}

/* ---------------------------------------------------------- passkeys */

function hentCredentials(userId) {
  return db.prepare(`
    SELECT id, name, created_at, last_used_at FROM credentials
     WHERE user_id = ? ORDER BY created_at`).all(userId);
}

function findCredential(id) {
  return db.prepare('SELECT id, user_id, public_key, sign_count FROM credentials WHERE id = ?').get(id) || null;
}

/**
 * Passkeys kraever et secure context.
 *
 * Panelet tilgaas paa IP:port over ren http, saa kodeordet SKAL blive - et
 * passkey-only login ville laase brugeren ude af sin egen server
 * (RUNE-ERFARINGER, Tilmeld). Returnerer en forklaring, eller null naar det
 * er i orden.
 */
function passkeySpaerre(req) {
  const { rpId } = webauthn.oprindelse(req);
  if (!rpId) return 'The server does not know its own address.';
  const lokal = rpId === 'localhost' || rpId === '127.0.0.1' || rpId === '::1';
  if (!isHttps(req) && !lokal) {
    return 'Passkeys need https. Reach Sagu on its own domain, not on the panel address.';
  }
  return null;
}

const pk = webauthn.opret({
  appName: APP_NAME,
  hentCredentials,
  findCredential,
});

/* ------------------------------------------------------------- filer */

const FILES_DIR = path.join(DATA_DIR, 'files');
// Uploads er MIDLERTIDIGE: en Notion-zip, der pakkes ud og saa slettes.
// Den ligger for sig selv, saa en afbrudt import ikke efterlader noget
// blandt de rigtige vedhaeftninger.
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const MAX_UPLOAD = 1024 * 1024 * 1024;   // 1 GB - Notion-eksporter er store

function sikreDir(d) {
  try { fs.mkdirSync(d, { recursive: true }); } catch (err) { logError(`kunne ikke lave ${d}: ${err.message}`); }
}

/* =================================================== vedhaeftninger ===== */

/*
 * KUN disse vises INLINE i browseren.
 *
 * Alt andet - inklusive SVG, der kan baere <script> - tvinges til download.
 * Det er den vigtigste spaerring i hele funktionen: en fil, brugeren selv har
 * uploadet, maa ALDRIG kunne koere som en side paa Sagus eget domaene, og
 * Sagu serverer oven i koebet paa et OFFENTLIGT domaene (wikien, F6).
 *
 * Listen naevner én type ad gangen og matcher ALDRIG paa et `image/`-praefiks:
 * praefikset lader `image/svg+xml` igennem (RUNE-ERFARINGER, doda F7).
 */
const INLINE_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);
const MAX_FIL = 25 * 1024 * 1024;

/*
 * ── Filkvoten er en INDSTILLING, ikke en konstant ─────────────────────────
 *
 * Den var 2 GB, stoebt i koden. »Kan du gøre det muligt at øge størrelsen af
 * lageret fra 2GB til en valgfri størrelse?« (Andreas, 2026-08-22) - og han
 * har ret: Sagu koerer paa hans egen server, hvor pladsen er hans, ikke min.
 *
 * Tre lag, i den raekkefoelge:
 *   1. `settings` - det administratoren har sat i fladen. Vinder, fordi det
 *      er det eneste, han kan aendre uden en ny udgivelse.
 *   2. `SAGU_MAX_SAMLET` - miljoevariablen. Testene saetter den ned; ellers
 *      skulle de sende gigabytes for at bevise noget.
 *   3. 2 GB.
 *
 * **Kvoten er pr. KONTO**, ikke for hele serveren. Det er den samme graense,
 * den altid har vaeret; det er kun tallet, der kan aendres.
 *
 * Og den laeses ved hvert kald i stedet for at blive husket: en aendring skal
 * gaelde med det samme, ikke ved naeste genstart - panelets »opdater app«
 * skriver filer uden at genstarte noget (samme laerdom som `versionNu`).
 */
const MAX_SAMLET_STANDARD = Number(process.env.SAGU_MAX_SAMLET) || 2 * 1024 * 1024 * 1024;
/*
 * Gulvet kan saettes ned i en test - af praecis samme grund som kvoten selv:
 * vagten mod »under det, nogen allerede bruger« kan ellers kun naas ved at
 * sende over 100 MB, og saa bliver den aldrig proevet. En vagt, ingen test kan
 * naa, er en vagt, man tror paa uden at vide noget.
 */
const MIN_KVOTE = Number(process.env.SAGU_MIN_KVOTE) || 100 * 1024 * 1024;
const MAKS_KVOTE = 64 * 1024 * 1024 * 1024 * 1024;   // 64 TB - et tal, ingen disk naar, men som stopper en tastefejl

/** Bytes som noget, et menneske kan laese. Serveren har sin egen, kort udgave. */
function visBytes(n) {
  const gb = n / 1024 / 1024 / 1024;
  if (gb >= 1) return `${Math.round(gb * 10) / 10} GB`;
  return `${Math.round(n / 1024 / 1024)} MB`;
}

function maxSamlet() {
  const sat = Number(getSetting('*', 'storage_quota', ''));
  if (Number.isFinite(sat) && sat >= MIN_KVOTE && sat <= MAKS_KVOTE) return sat;
  return MAX_SAMLET_STANDARD;
}

/** Filnavnet er KUN til visning og download - stien paa disken er altid id'et. */
function renseFilnavn(raa) {
  const n = String(raa || 'file')
    .replace(/[\x00-\x1f\x7f]/g, '')          // kontroltegn
    .replace(/[/\\]/g, '-')                    // ingen stier
    .replace(/^\.+/, '')                       // ingen skjulte filer
    .trim()
    .slice(0, 120);
  return n || 'file';
}

function filSti(id) {
  // id'et kommer fra newId() og er ren hex - men tjek ALLIGEVEL. En
  // sti-traversering, der er kommet i databasen, maa ikke blive til en, der
  // laeser /etc/passwd (Verdandes spec).
  if (!/^[a-f0-9]{32}$/.test(id)) return null;
  return path.join(FILES_DIR, id);
}

function brugtPlads(userId) {
  return db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM attachments WHERE user_id = ? AND deleted_at IS NULL')
    .get(userId).n;
}

/**
 * Filen, `userId` maa SE.
 *
 * Enten sin egen - eller en, der haenger paa en note, han maa se. Uden det
 * sidste ville en delt side vise huller, hvor billederne skulle vaere: teksten
 * kom med, filerne gjorde ikke, og intet fejlede hoejt. Det er derfor
 * accepten i SAGU-PLAN naevner vedhaeftningerne ved navn.
 *
 * En LOES fil - en uden note - foelger stadig kun sin ejer. Der er ikke noget
 * at arve adgang fra.
 */
function hentFil(userId, id) {
  const f = db.prepare('SELECT * FROM attachments WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!f) return null;
  if (f.user_id === userId) return f;
  if (!f.note_id) return null;
  return hentNote(userId, f.note_id) ? f : null;
}

/**
 * ... og filen, han maa BYTTE eller fjerne.
 *
 * Skarpere end `hentFil`: en note, man kun maa laese, maa man heller ikke
 * rydde op i. En fil uden note er ejerens alene.
 */
function hentFilTilSkrivning(userId, id) {
  const f = db.prepare('SELECT * FROM attachments WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!f) return null;
  if (f.user_id === userId) return f;
  if (!f.note_id) return null;
  return maaSkrive(userId, f.note_id) ? f : null;
}

/** Ét sted: maa `userId` aendre den her note? */
function maaSkrive(userId, noteId) {
  return !!db.prepare(`
    SELECT 1 FROM notes n
     WHERE n.id = ? AND n.deleted_at IS NULL AND ${SKRIVBAR}`).get(noteId, userId, userId);
}

/** ... og EJER han den? Kun ejeren sletter, udgiver, deler og giver videre. */
function ejerAf(userId, noteId) {
  return !!db.prepare(`
    SELECT 1 FROM notes n
     WHERE n.id = ? AND n.deleted_at IS NULL AND ${EJET}`).get(noteId, userId);
}

/** Antal pr. note i ÉT opslag - aldrig en forespoergsel pr. raekke. */
function medFilantal(noter) {
  if (!noter.length) return noter;
  const huller = noter.map(() => '?').join(',');
  const tal = db.prepare(`
    SELECT note_id, COUNT(*) AS n FROM attachments
     WHERE deleted_at IS NULL AND note_id IN (${huller}) GROUP BY note_id`)
    .all(...noter.map((n) => n.id));
  const kort = new Map(tal.map((t) => [t.note_id, t.n]));
  for (const n of noter) n.attachmentCount = kort.get(n.id) || 0;
  return noter;
}

/** Fjerner én fil fra baade disk og tabel. */
function fjernFil(id) {
  const sti = filSti(id);
  if (sti) { try { fs.unlinkSync(sti); } catch { /* allerede vaek */ } }
  db.prepare('DELETE FROM attachments WHERE id = ?').run(id);
}

/** Alle filer paa én note - kaldes FOER noten hardslettes. */
function ryddFilerFor(noteId) {
  for (const f of db.prepare('SELECT id FROM attachments WHERE note_id = ?').all(noteId)) {
    fjernFil(f.id);
  }
}

/* ==================================================== eksport (F5) ====== */

/** Et filnavn, der kan staa i en zip paa ethvert filsystem. */
function sikkertFilnavn(raa) {
  return String(raa || 'Untitled')
    .replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, '-')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 90) || 'Untitled';
}

/**
 * Hele arkivet som markdown-mapper.
 *
 * Traeet bliver til mapper, saa en eksport kan laeses af et menneske og af
 * Obsidian. Filnavne kolliderer - to noter kan hedde »Møde« - saa der
 * tilfoejes et loebenummer frem for at tabe den ene (Verdandes spec).
 */
function byggMdEksport(userId, medFiler) {
  const noter = db.prepare(`
    SELECT n.id, n.notebook_id, n.parent_id, n.title, n.body_md, n.icon, n.created_at, n.updated_at
      FROM notes n WHERE n.user_id = ? AND n.deleted_at IS NULL ORDER BY n.seq, n.title`).all(userId);
  const boeger = new Map(hentNotesboeger(userId).map((b) => [b.id, b.name]));
  const efterId = new Map(noter.map((n) => [n.id, n]));

  const sti = (n) => {
    const dele = [];
    let cur = n;
    for (let i = 0; i < 32 && cur; i++) {
      dele.unshift(sikkertFilnavn(cur.title));
      cur = cur.parent_id ? efterId.get(cur.parent_id) : null;
    }
    const bog = n.notebook_id ? boeger.get(n.notebook_id) : null;
    return [...(bog ? [sikkertFilnavn(bog)] : ['Notes']), ...dele];
  };

  const brugte = new Set();
  const poster = [];
  const filerPrNote = new Map();
  for (const f of db.prepare(`
    SELECT id, note_id, name FROM attachments
     WHERE user_id = ? AND deleted_at IS NULL AND note_id IS NOT NULL`).all(userId)) {
    if (!filerPrNote.has(f.note_id)) filerPrNote.set(f.note_id, []);
    filerPrNote.get(f.note_id).push(f);
  }

  for (const n of noter) {
    const dele = sti(n);
    let navn = `${dele.join('/')}.md`;
    let nr = 2;
    while (brugte.has(navn.toLowerCase())) { navn = `${dele.join('/')} ${nr}.md`; nr++; }
    brugte.add(navn.toLowerCase());

    const maerker = db.prepare(`
      SELECT t.name FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = ?`)
      .all(n.id).map((t) => t.name);
    const props = db.prepare('SELECT key, value FROM note_props WHERE note_id = ? ORDER BY seq')
      .all(n.id);

    // YAML-forside. Obsidian og Bear skriver den; det goer vi ogsaa, saa en
    // eksport kan laeses af en anden editor.
    const forside = ['---', `created: ${new Date(n.created_at * 1000).toISOString()}`,
      `modified: ${new Date(n.updated_at * 1000).toISOString()}`];
    if (maerker.length) forside.push(`tags: [${maerker.map((t) => JSON.stringify(t)).join(', ')}]`);
    if (n.icon) forside.push(`icon: ${JSON.stringify(n.icon)}`);
    for (const p of props) forside.push(`${p.key.replace(/[:\n]/g, ' ')}: ${JSON.stringify(p.value)}`);
    forside.push('---', '');

    // `sagu:<id>` skrives om til den relative sti, filen faar i zippen -
    // ellers peger en eksporteret note paa en adresse, kun Sagu kender.
    let krop = n.body_md;
    const mine = filerPrNote.get(n.id) || [];
    for (const f of mine) {
      const relativ = `_files/${f.id}-${sikkertFilnavn(f.name)}`;
      krop = krop.split(`sagu:${f.id}`).join(
        `${'../'.repeat(dele.length - 1)}${relativ}`.replace(/^(\.\.\/)+/, (m) => m));
    }
    poster.push({ navn, data: `${forside.join('\n')}# ${n.title}\n\n${krop}\n` });
  }

  if (medFiler) {
    for (const f of db.prepare(`
      SELECT id, name FROM attachments WHERE user_id = ? AND deleted_at IS NULL`).all(userId)) {
      const p = filSti(f.id);
      if (!p) continue;
      try {
        poster.push({ navn: `_files/${f.id}-${sikkertFilnavn(f.name)}`, data: fs.readFileSync(p) });
      } catch { /* filen er vaek fra disken; noten naevner den stadig */ }
    }
  }
  return poster;
}

/**
 * Alt, felt for felt. Rundturens format.
 *
 * Hemmeligheder maa ALDRIG med i en eksportfil, brugeren maaske deler videre
 * (RUNE-ERFARINGER, doda F9). Listen over dem staar ét sted -
 * HEMMELIGE_SETTINGS - og bruges baade her og af laese-endepunktet.
 */
function byggJsonEksport(userId, medFiler) {
  const MAX = 150 * 1024 * 1024;
  const ud = {
    sagu: 1,
    exportedAt: now(),
    notebooks: db.prepare(`SELECT id, name, icon, seq, archived_at, created_at, updated_at
                             FROM notebooks WHERE user_id = ? AND deleted_at IS NULL`).all(userId),
    notes: db.prepare(`SELECT id, notebook_id, parent_id, title, body_md, icon, seq, full_width,
                              ext_id, created_at, updated_at, archived_at
                         FROM notes WHERE user_id = ? AND deleted_at IS NULL`).all(userId),
    tags: db.prepare('SELECT id, name FROM tags WHERE user_id = ?').all(userId),
    noteTags: db.prepare(`SELECT nt.note_id, nt.tag_id FROM note_tags nt
                            JOIN notes n ON n.id = nt.note_id WHERE n.user_id = ?`).all(userId),
    props: db.prepare(`SELECT np.note_id, np.key, np.value, np.seq FROM note_props np
                         JOIN notes n ON n.id = np.note_id WHERE n.user_id = ?`).all(userId),
    settings: db.prepare('SELECT key, value FROM settings WHERE scope = ?').all(userId)
      .filter((r) => !HEMMELIGE_SETTINGS.has(r.key)),
    files: [],
  };
  if (medFiler) {
    let samlet = 0;
    for (const f of db.prepare(`SELECT id, note_id, name, mime, size, sha
                                  FROM attachments WHERE user_id = ? AND deleted_at IS NULL`).all(userId)) {
      const p = filSti(f.id);
      if (!p) continue;
      samlet += f.size * 1.34;
      if (samlet > MAX) {
        throw Object.assign(new Error(
          'Your files are too large for a single export. Use ?files=0 for the notes alone, '
          + 'or the panel backup, which already covers /data.'), { status: 413 });
      }
      try {
        ud.files.push(Object.assign({}, f, { data: fs.readFileSync(p).toString('base64') }));
      } catch { /* vaek fra disken */ }
    }
  }
  return ud;
}

/** Gendanner fra en JSON-eksport. Idempotent paa id. */
function gendanFraJson(userId, data) {
  if (!data || data.sagu !== 1) {
    throw Object.assign(new Error('That is not a Sagu export.'), { status: 400 });
  }
  const tal = { notebooks: 0, notes: 0, tags: 0, files: 0, props: 0 };
  const t = now();

  // STRUKTUREN foerst: notesboeger og maerker, saa fremmednoeglerne findes,
  // naar noterne kommer (RUNE-ERFARINGER, doda F9).
  for (const b of data.notebooks || []) {
    db.prepare(`INSERT INTO notebooks (id, user_id, name, icon, seq, archived_at, created_at, updated_at)
                VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`)
      .run(b.id, userId, str(b.name, 200) || 'Untitled', str(b.icon, 16), b.seq || 0,
        b.archived_at || null, b.created_at || t, b.updated_at || t);
    tal.notebooks++;
  }
  for (const g of data.tags || []) {
    db.prepare('INSERT INTO tags (id, user_id, name, created_at) VALUES (?,?,?,?) ON CONFLICT(id) DO NOTHING')
      .run(g.id, userId, str(g.name, 60), t);
    tal.tags++;
  }
  // Noterne UDEN foraelder foerst, saa selvreferencen aldrig mangler.
  for (const n of data.notes || []) {
    db.prepare(`INSERT INTO notes (id, user_id, notebook_id, parent_id, title, body_md, icon, seq,
                                   full_width, ext_id, created_at, updated_at, archived_at)
                VALUES (?,?,?,NULL,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`)
      .run(n.id, userId, n.notebook_id || null, str(n.title, 400), n.body_md || '',
        str(n.icon, 16), n.seq || 0, n.full_width ? 1 : 0, n.ext_id || null,
        n.created_at || t, n.updated_at || t, n.archived_at || null);
    tal.notes++;
  }
  for (const n of data.notes || []) {
    if (n.parent_id) {
      db.prepare('UPDATE notes SET parent_id = ? WHERE id = ? AND user_id = ?')
        .run(n.parent_id, n.id, userId);
    }
  }
  for (const nt of data.noteTags || []) {
    db.prepare('INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?,?)').run(nt.note_id, nt.tag_id);
  }
  for (const p of data.props || []) {
    db.prepare('INSERT OR REPLACE INTO note_props (note_id, key, value, seq) VALUES (?,?,?,?)')
      .run(p.note_id, str(p.key, 80), str(p.value, 2000), p.seq || 0);
    tal.props++;
  }
  for (const s of data.settings || []) {
    if (HEMMELIGE_SETTINGS.has(s.key)) continue;
    setSetting(userId, str(s.key, 80), String(s.value).slice(0, 4000));
  }
  for (const f of data.files || []) {
    if (!/^[a-f0-9]{32}$/.test(String(f.id || ''))) continue;
    sikreDir(FILES_DIR);
    const p = filSti(f.id);
    if (!p) continue;
    const buf = Buffer.from(String(f.data || ''), 'base64');
    fs.writeFileSync(p, buf);
    db.prepare(`INSERT INTO attachments (id, user_id, note_id, name, mime, size, sha, created_at)
                VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`)
      .run(f.id, userId, f.note_id || null, renseFilnavn(f.name), str(f.mime, 100) || 'application/octet-stream',
        buf.length, f.sha || crypto.createHash('sha256').update(buf).digest('hex'), t);
    tal.files++;
  }
  /*
   * Link-tabellen GENOPBYGGES af teksten - den baeres ikke med i eksporten.
   *
   * Teksten er sandheden; `note_links` er kun et indeks over den. Eksporterede
   * man tabellen, ville en fil kunne baere et indeks, der er uenigt med sin
   * egen tekst - og det er praecis dét, den aldrig maa (samme regel som ved
   * hvert gem, F1). Gjort her, EFTER alle noter findes, saa et link til en
   * note laengere nede i filen ogsaa bliver levende.
   */
  for (const n of data.notes || []) {
    opdaterLinks(userId, n.id, n.body_md || '');
    indekser(n.id);
  }
  return tal;
}

/** En uploadet fils sti - kun hvis id'et er vores eget hex og filen findes. */
function uploadSti(id) {
  if (!/^[a-f0-9]{32}$/.test(String(id || ''))) return null;
  const sti = path.join(UPLOAD_DIR, id);
  if (!sti.startsWith(UPLOAD_DIR + path.sep)) return null;
  try { fs.statSync(sti); } catch { return null; }
  return sti;
}

/* ================================================= wiki (F6) ============ */

/*
 * Alt hvad den OFFENTLIGE wiki har brug for fra serveren.
 *
 * `app/wiki.js` tegner siderne og kender hverken database eller http; her
 * ligger opslagene - og med dem hele adgangsafgoerelsen. Grunden til
 * delingen er den samme som ved mcp/oauth i §9a: en skabelon, der selv kan
 * lave en forespoergsel, er en skabelon, der kan komme til at hente for meget.
 */

function hmac(tekst) {
  return crypto.createHmac('sha256', serverSecret()).update(String(tekst), 'utf8').digest('hex');
}

/** Sammenlign LAENGDEN foerst: timingSafeEqual kaster paa forskellig laengde. */
function tidsSikkerLig(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

/**
 * Cookien, der siger »denne browser har kodeordet«.
 *
 * Bundet til kodeordets hash (se wiki.js), saa et skift af kodeordet lukker
 * alle gamle browsere ude uden at der skal ryddes op nogen steder.
 */
function wikiCookie(req, navn, vaerdi, maxAge) {
  const bits = [`${navn}=${vaerdi}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (isHttps(req)) bits.push('Secure');
  return bits.join('; ');
}

function vaert(req) {
  const h = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return `${isHttps(req) ? 'https' : 'http'}://${h}`;
}

/**
 * Den adresse, brugeren VIL have delt - naar den ikke er den, kaldet kom paa.
 *
 * Sagu kan naas paa flere vaertsnavne paa én gang (Andreas peger baade
 * `sagu.<domaene>` og et kortere domaene paa den samme container). Uden et
 * valg ville hver flade svare med den vaert, DEN blev kaldt paa:
 *
 *  - linket i udgivelsesruden ville hedde noget forskelligt, alt efter hvilken
 *    adresse man selv sad paa, da man kopierede det,
 *  - og en soegemaskine ville se den samme side paa to adresser, altsaa som to
 *    sider med samme indhold.
 *
 * Derfor ét felt, ét sted: en `public_url` i installationens settings (scope
 * `*`, kun admin). Er den ikke sat, er alt praecis som foer - kaldets egen
 * vaert. **Den bruges aldrig til en omdirigering**, kun til at VISE og til
 * `canonical`/`og:url`; ellers ville et felt i en indstilling kunne blive til
 * en aaben viderestilling.
 */
function rensOffentligUrl(raa) {
  const s = String(raa || '').trim().replace(/\/+$/, '');
  if (!s) return '';
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  // Kun en OPRINDELSE. En sti ville lande midt i alle adresser, appen danner,
  // og en query eller et fragment giver ikke mening i en vaert.
  if (u.pathname !== '/' || u.search || u.hash || u.username || u.password) return null;
  if (!u.hostname) return null;
  return u.origin;
}

function offentligUrl() {
  return rensOffentligUrl(getSetting('*', 'public_url', '')) || '';
}

/** Den offentlige adresse, hvis den er sat - ellers den, kaldet kom paa. */
function offentligVaert(req) {
  return offentligUrl() || vaert(req);
}

/** En 404, en BROWSER kan laese. Samme svar paa ukendt, tilbagekaldt og udloebet. */
function wikiIkkeFundet(res) {
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<meta name="robots" content="noindex"><title>Not found</title>'
    + '<style>body{font:16px/1.6 system-ui,sans-serif;margin:12vh auto;max-width:32rem;padding:0 5vw;'
    + 'color:#1c1917;background:#efe9e2}@media(prefers-color-scheme:dark){body{color:#ede8e1;background:#141210}}'
    + 'p{color:#8b8078}</style></head><body><h1>Not found</h1>'
    + '<p>This address does not lead anywhere. The link may have been withdrawn, '
    + 'or it may have expired.</p></body></html>';
  res.writeHead(404, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': Buffer.byteLength(html),
  });
  res.end(html);
}

function sendWikiTekst(res, status, tekst, mime, share) {
  securityHeaders(res);
  res.writeHead(status, {
    'Content-Type': mime,
    // Aldrig en delt cache: en kodeordsbeskyttet side maa ikke kunne ligge i
    // en mellemstation, og en aaben side er billig nok at hente igen.
    'Cache-Control': share && !share.password_hash ? 'no-cache' : 'no-store',
    'Content-Length': Buffer.byteLength(tekst),
  });
  res.end(tekst);
}

function wikiOmdiriger(res, sti, ekstra) {
  res.writeHead(302, Object.assign({ Location: sti, 'Cache-Control': 'no-store' }, ekstra || {}));
  res.end();
}

/** Kodeordsformularen. Ren `x-www-form-urlencoded`, med et haardt loft. */
function laesFormular(req) {
  return new Promise((ok) => {
    let n = 0;
    let raa = '';
    req.on('data', (bid) => {
      n += bid.length;
      if (n > 8192) { req.destroy(); return; }
      raa += bid;
    });
    req.on('end', () => {
      const ud = {};
      for (const del of raa.split('&')) {
        if (!del) continue;
        const i = del.indexOf('=');
        const navn = decodeURIComponent((i < 0 ? del : del.slice(0, i)).replace(/\+/g, ' '));
        const v = i < 0 ? '' : decodeURIComponent(del.slice(i + 1).replace(/\+/g, ' '));
        ud[navn] = v;
      }
      ok(ud);
    });
    req.on('error', () => ok({}));
  });
}

/**
 * Slaar en udgivelse op paa slug eller token.
 *
 * Ét indeksopslag. Tilbagekaldt og udloebet giver `null` praecis som ukendt -
 * kaldstedet svarer 404 paa alle tre, saa man ikke kan aflaese, om en adresse
 * har vaeret der.
 */
function findUdgivelse(navn, viaToken) {
  const r = viaToken
    ? db.prepare('SELECT * FROM shares WHERE token = ? AND revoked_at IS NULL').get(navn)
    : db.prepare('SELECT * FROM shares WHERE lower(slug) = lower(?) AND revoked_at IS NULL').get(navn);
  if (!r) return null;
  if (r.expires_at && r.expires_at <= now()) return null;
  // Roden skal stadig findes. Er den i papirkurven, doer udgivelsen med den.
  const rod = r.notebook_id
    ? db.prepare('SELECT name AS title, icon FROM notebooks WHERE id = ? AND deleted_at IS NULL').get(r.notebook_id)
    : db.prepare('SELECT title, icon FROM notes WHERE id = ? AND deleted_at IS NULL').get(r.note_id);
  if (!rod) return null;
  return Object.assign({}, r, { title: rod.title || 'Untitled', icon: rod.icon || '' });
}

/**
 * Noterne i udgivelsen - ÉT sted, brugt af hver eneste offentlige rute.
 *
 * `mode: 'single'` er kun noten selv; `'tree'` er den og hele dens undertrae.
 * Arkiverede sider er MED: arkivering er et personligt laesefilter i appen, og
 * to regler om hvad der er udgivet ville betyde, at en side kunne forsvinde
 * for laeseren, uden at nogen besluttede det.
 */
function udgivelsensNoter(share) {
  /*
   * En NOTESBOG er hele bogen - hver eneste side i den, uanset dybde.
   *
   * Det er dét, et importeret Notion-arkiv er: en bog med sider i, ikke en
   * forside med undersider. Uden det maatte man lave en kunstig forside for
   * at kunne dele det, der allerede var en samling (Andreas, 2026-08-21).
   */
  if (share.notebook_id) {
    return db.prepare(`
      SELECT n.id, n.parent_id, n.title, n.icon, n.seq, n.updated_at
        FROM notes n
       WHERE n.notebook_id = ? AND n.deleted_at IS NULL AND n.user_id = ?
       ORDER BY n.seq, n.title
       LIMIT 5000`).all(share.notebook_id, share.user_id)
      .map((n) => ({
        id: n.id,
        parentId: n.parent_id,
        title: n.title,
        icon: n.icon,
        seq: n.seq,
        updatedAt: n.updated_at,
      }));
  }
  const ider = share.mode === 'single'
    ? [share.note_id]
    : undertrae(share.user_id, share.note_id);
  if (!ider.length) return [];
  const huller = ider.map(() => '?').join(',');
  return db.prepare(`
    SELECT n.id, n.parent_id, n.title, n.icon, n.seq, n.updated_at
      FROM notes n WHERE n.id IN (${huller}) AND n.deleted_at IS NULL`)
    .all(...ider)
    .map((n) => ({
      id: n.id,
      parentId: n.parent_id,
      title: n.title,
      icon: n.icon,
      seq: n.seq,
      updatedAt: n.updated_at,
    }));
}

/** Den enkelte side. Vagten er, at id'et skal staa i udgivelsens egen liste. */
function hentUdgivetNote(share, id, ider) {
  if (!ider.includes(id)) return null;
  return hentNote(share.user_id, id);
}

/**
 * En fil, der hoerer til en note i udgivelsen.
 *
 * Ikke »ejerens filer« - en note kan vaere delt uden at hele arkivet er det.
 * Det er den samme regel som noterne, og den staar det samme sted.
 */
function filIUdgivelse(id, ider) {
  if (!/^[a-f0-9]{32}$/.test(id) || !ider.length) return null;
  const huller = ider.map(() => '?').join(',');
  return db.prepare(`
    SELECT * FROM attachments
     WHERE id = ? AND deleted_at IS NULL AND note_id IN (${huller})`).get(id, ...ider) || null;
}

/**
 * Serverer en vedhaeftning. Deles af app-ruten og wikien, saa hvidlisten over
 * inline-typer og sti-tjekket kun findes ét sted.
 *
 * @param {boolean} offentlig  om svaret maa ligge i en delt cache.
 */
function sendFil(req, res, f, offentlig) {
  const sti = filSti(f.id);
  // Stien tjekkes IGEN paa laesetidspunktet. En traversering, der paa en eller
  // anden maade er kommet i databasen, maa ikke blive til en, der laeser
  // /etc/passwd (Verdandes spec).
  if (!sti || !sti.startsWith(FILES_DIR + path.sep)) { apiFejl(res, 404, 'not_found', 'No such file.'); return; }
  let stat;
  try { stat = fs.statSync(sti); } catch { apiFejl(res, 404, 'not_found', 'No such file.'); return; }

  const etag = `"${f.sha}"`;
  if (req.headers['if-none-match'] === etag) { res.writeHead(304).end(); return; }

  const inline = INLINE_MIME.has(f.mime);
  securityHeaders(res);
  res.writeHead(200, {
    'Content-Type': inline ? f.mime : 'application/octet-stream',
    'Content-Length': stat.size,
    'Content-Disposition': inline
      ? `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`
      : `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    'X-Content-Type-Options': 'nosniff',
    ETag: etag,
    'Cache-Control': `${offentlig ? 'public' : 'private'}, max-age=31536000, immutable`,
  });
  if (req.method === 'HEAD') { res.end(); return; }
  fs.createReadStream(sti).pipe(res);
}

/** Adressen skal kunne staa i en mail: sma bogstaver, tal og bindestreger. */
function renSlug(raa) {
  const s = String(raa || '').trim().toLowerCase()
    .replace(/[æ]/g, 'ae').replace(/[ø]/g, 'oe').replace(/[å]/g, 'aa')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return s || null;
}

function slugTaget(slug, egetId) {
  const r = db.prepare('SELECT id FROM shares WHERE lower(slug) = lower(?) AND revoked_at IS NULL').get(slug);
  return !!r && r.id !== egetId;
}

/** Klienten sender et sekund-stempel eller ingenting. Aldrig en dato-streng. */
function tidsstempel(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function hentUdgivelseRaekke(userId, id) {
  return db.prepare(`
    SELECT s.*, n.title AS note_titel, b.name AS bog_titel
      FROM shares s
      LEFT JOIN notes n ON n.id = s.note_id
      LEFT JOIN notebooks b ON b.id = s.notebook_id
     WHERE s.id = ? AND s.user_id = ? AND s.revoked_at IS NULL`).get(id, userId) || null;
}

/**
 * Udgivelsen, som ejeren ser den.
 *
 * `hasPassword` frem for hashen: en hemmelighed forlader aldrig serveren, og
 * frontenden har kun brug for at vide, om kontakten er slaaet til.
 */
/**
 * En udgivelse bliver til ÉT sted.
 *
 * Ruten er tynd med vilje: MCP'ens `publish_note` (F10) skal traeffe de samme
 * spaerringer som knappen i appen - SKRIVBAR frem for SYNLIG, »allerede
 * udgivet«, slug-reglen, kodeordslaengden. To kopier ville betyde, at den ene
 * glemte en af dem, og det er den slags glemsel, der lige praecis rammer
 * noget, der ligger PAA NETTET.
 *
 * @returns {{share}|{fejl: [status, kode, besked]}}
 */
function opretUdgivelse(userId, o) {
  const noteId = o.noteId ? str(o.noteId, 32) : null;
  const bogId = o.notebookId ? str(o.notebookId, 32) : null;
  if (!noteId === !bogId) {
    return { fejl: [400, 'bad_request', 'Send either a noteId or a notebookId — not both, not neither.'] };
  }
  if (noteId) {
    /*
     * `EJET` - ikke engang `write` raekker her.
     *
     * At udgive er at laegge noget paa det AABNE net. Den beslutning hoerer
     * til den, siden tilhoerer; en kollega med skriveadgang kan rette i
     * teksten, men ikke bestemme, at hele undertraeet skal kunne laeses af
     * enhver med et link. Stod der `SKRIVBAR`, ville ejeren opdage det
     * bagefter - og »bagefter« er for sent for noget, der har vaeret
     * offentligt (F11).
     */
    const note = db.prepare(`SELECT n.id FROM notes n
                              WHERE n.id = ? AND n.deleted_at IS NULL AND ${EJET}`)
      .get(noteId, userId);
    if (!note) { return { fejl: [404, 'not_found', 'No such note.'] }; }
    if (db.prepare('SELECT 1 FROM shares WHERE note_id = ? AND revoked_at IS NULL').get(noteId)) {
      return { fejl: [409, 'already_published', 'That note is already published. Change the existing one.'] };
    }
  } else {
    // En notesbog er altid ejerens egen - der er ingen ACL paa boeger.
    const bog = db.prepare(`SELECT id FROM notebooks
                             WHERE id = ? AND user_id = ? AND deleted_at IS NULL`)
      .get(bogId, userId);
    if (!bog) { return { fejl: [404, 'not_found', 'No such notebook.'] }; }
    if (db.prepare('SELECT 1 FROM shares WHERE notebook_id = ? AND revoked_at IS NULL').get(bogId)) {
      return { fejl: [409, 'already_published', 'That notebook is already published. Change the existing one.'] };
    }
  }
  const mode = o.mode === 'single' ? 'single' : 'tree';
  const slug = o.slug === undefined || o.slug === null || o.slug === ''
    ? null : renSlug(o.slug);
  if (o.slug && !slug) {
    return { fejl: [400, 'bad_slug', 'A web address may hold letters a–z, digits and hyphens — nothing else.'] };
  }
  if (slug && slugTaget(slug, null)) {
    return { fejl: [409, 'slug_taken', 'That address is already in use. Pick another one.'] };
  }
  const kodeord = typeof o.password === 'string' && o.password ? o.password : null;
  if (kodeord && kodeord.length < 6) {
    return { fejl: [400, 'bad_password', 'A wiki password must be at least 6 characters.'] };
  }
  const id = newId();
  db.prepare(`INSERT INTO shares
      (id, user_id, note_id, notebook_id, mode, slug, token, password_hash, allow_comments,
       allow_search, allow_index, expires_at, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, userId, noteId, bogId, mode, slug,
      crypto.randomBytes(24).toString('hex'),
      kodeord ? hashPassword(kodeord) : null,
      o.allowComments ? 1 : 0,
      o.allowSearch === false ? 0 : 1,
      o.allowIndex ? 1 : 0,
      tidsstempel(o.expiresAt), now());
  audit('udgivet', userId, noteId || bogId, bogId ? 'notebook' : mode);
  return { share: formUdgivelse(hentUdgivelseRaekke(userId, id)) };
}

/**
 * Udgiv en NOTE med undersider - det, MCP'en tilbyder.
 *
 * Adressen skrives med `offentligUrl()`, saa en model faar det link, Andreas
 * ville have kopieret selv. Er feltet ikke sat, kan serveren ikke vide, hvad
 * den hedder udefra, og stien er det aerlige svar.
 */
function udgivNote(userId, noteId, slug) {
  const r = opretUdgivelse(userId, { noteId, mode: 'tree', slug });
  if (r.fejl) return { fejl: r.fejl };
  const base = offentligUrl();
  return Object.assign({}, r.share, { url: base ? base + r.share.path : r.share.path });
}

function formUdgivelse(r) {
  if (!r) return null;
  return {
    id: r.id,
    noteId: r.note_id,
    notebookId: r.notebook_id,
    // ÉT felt til det, udgivelsen HEDDER, uanset hvad den peger paa. Ellers
    // skal hvert visningssted vide, hvilken slags den er.
    noteTitle: r.note_titel || r.bog_titel,
    kind: r.notebook_id ? 'notebook' : 'note',
    mode: r.mode,
    slug: r.slug,
    token: r.token,
    // Stien, ikke hele adressen: vaerten kender frontenden selv, og et gemt
    // domaenenavn ville blive forkert den dag wikien faar sit eget.
    path: r.slug ? `/w/${r.slug}` : `/s/${r.token}`,
    hasPassword: !!r.password_hash,
    allowComments: !!r.allow_comments,
    moderateComments: !!r.moderate_comments,
    // Det, koeen indeholder for netop DENNE udgivelse. Uden tallet er
    // »kommentarer til« en knap, der ikke fortaeller noget bagefter.
    pendingComments: db.prepare(`SELECT COUNT(*) AS n FROM comments
       WHERE share_id = ? AND deleted_at IS NULL AND status = 'pending'`).get(r.id).n,
    allowSearch: !!r.allow_search,
    allowIndex: !!r.allow_index,
    expiresAt: r.expires_at || null,
    views: r.views,
    createdAt: r.created_at,
    topPages: db.prepare(`
      SELECT v.note_id, v.n, n.title FROM share_views v JOIN notes n ON n.id = v.note_id
       WHERE v.share_id = ? ORDER BY v.n DESC LIMIT 5`).all(r.id)
      .map((x) => ({ id: x.note_id, title: x.title, views: x.n })),
  };
}

const wiki = wikiModul.opret({
  markdown,
  appName: APP_NAME,
  now,
  hmac,
  tidsSikkerLig,
  cookies: (req) => parseCookies(req.headers.cookie),
  wikiCookie,
  clientIp,
  rateAllow,
  rateClear,
  logSecurity,
  verifyPassword,
  vaert,
  temaScript: () => INLINE_SCRIPT_TEXT,
  cssVersion: () => APP_VERSION_FIL,
  laesFormular,
  offentligVaert,
  ikkeFundet: wikiIkkeFundet,
  omdiriger: wikiOmdiriger,
  sendHtml: (res, status, html, share) => sendWikiTekst(res, status, html, 'text/html; charset=utf-8', share),
  sendTekst: (res, status, tekst, mime, share) => sendWikiTekst(res, status, tekst, mime, share),
  sendFil: (res, req, f, offentlig) => sendFil(req, res, f, offentlig),
  findUdgivelse,
  udgivelsensNoter,
  hentUdgivetNote,
  filIUdgivelse,

  /*
   * Wikiens soegning ER appens soegning, afgraenset til det udgivne undertrae.
   * Den samme rangering, det samme uddrag, det samme afsnits-anker - og den
   * kan derfor ikke komme til at finde en note, der ikke er delt.
   */
  /*
   * GitHub-indlejringen paa wikien - **kun fra cachen** (F12).
   *
   * Aldrig et kald. Siden er offentlig, og en fremmed, der genindlaeser
   * hurtigt nok, ville ellers bruge ejerens GitHub-kvote op - med ejerens
   * token, altsaa mod hans private repoer. Er svaret ikke hentet endnu, er
   * linjen bare det link, den var; naeste gang ejeren selv aabner noten,
   * fyldes cachen, og saa staar kortet der ogsaa her.
   */
  githubKort(url) {
    const info = ghShared.tolk(url);
    if (!info) return null;
    const gemt = db.prepare('SELECT data FROM github_cache WHERE noegle = ?')
      .get(ghShared.cacheNoegle(info));
    if (!gemt) return null;
    let e;
    try { e = JSON.parse(gemt.data); } catch { return null; }
    return e.slags === 'fil' ? wikiGhFil(e, info) : wikiGhSag(e);
  },

  soegIUdgivelse(share, q, ider) {
    return soegNoter(share.user_id, q, 30, { ider, scope: share.id });
  },

  /*
   * Kommentarerne, en GAEST maa se: kun `published`.
   *
   * Det er samme skel som overalt ellers - moderationskoeen hoerer til den,
   * der ejer noten, og en besoegende maa ikke kunne aflaese, at der ligger
   * noget og venter.
   */
  kommentarerFor(noteId) {
    return hentKommentarer(noteId, false);
  },

  opretGaesteKommentar(share, o) {
    return opretKommentar({
      noteId: o.noteId,
      body: o.body,
      author: o.author,
      kind: o.kind,
      parentId: o.parentId,
      shareId: share.id,
      origin: 'public',
      moderer: !!share.moderate_comments,
    });
  },

  /** Kun tal, aldrig personer (SAGU-PLAN §5). */
  taelVisning(share, noteId) {
    try {
      db.prepare('UPDATE shares SET views = views + 1 WHERE id = ?').run(share.id);
      db.prepare('INSERT INTO share_views (share_id, note_id, n, sidst) VALUES (?,?,1,?) '
        + 'ON CONFLICT(share_id, note_id) DO UPDATE SET n = n + 1, sidst = excluded.sidst')
        .run(share.id, noteId, now());
    } catch (err) { logError(`visningstaeller: ${err.message}`); }
  },
});

/* ====================================================== doda (F8) ======= */

const doda = dodaModul.opret({
  hentIndstilling: getSetting,
  logError,
});

/* ================================================== github (F12) ======= */

/*
 * Kortene, som WIKIEN tegner dem.
 *
 * Samme indhold som i appen, men uden en eneste knap: der er ingen app-JS
 * paa en offentlig side, og en kopier-knap, der ikke virker, er vaerre end
 * ingen. Escapes gennem markdown-modulets egne - der er ÉN escape-regel i
 * appen, og den bor dér.
 */
function wikiGhFil(e, info) {
  const esc = markdown.esc;
  const attr = markdown.attr;
  const linjer = String(e.tekst || '').split('\n');
  return `<div class="gh-kort">
      <div class="gh-hoved">
        <a class="gh-navn" href="${attr(e.url || ghShared.medRef(info, e.sha))}"
          target="_blank" rel="noopener noreferrer nofollow">${esc(e.ejer)}/${esc(e.repo)} · ${esc(e.sti)}</a>
        <span class="gh-sha">${esc(String(e.sha || '').slice(0, 7))}</span>
      </div>
      <div class="gh-kode"><table><tbody>${linjer.map((l, i) => `<tr>
        <td class="gh-nr">${e.foersteLinje + i}</td><td class="gh-l">${esc(l) || '&nbsp;'}</td>
      </tr>`).join('')}</tbody></table></div>
      <div class="gh-fod meta">${e.linjer} of ${e.ialt} lines${e.afkortet ? ' — cut off here' : ''}</div>
    </div>`;
}

function wikiGhSag(e) {
  const esc = markdown.esc;
  const attr = markdown.attr;
  const ORD = { open: 'Open', closed: 'Closed', merged: 'Merged' };
  return `<div class="gh-kort">
      <div class="gh-hoved">
        <a class="gh-navn" href="${attr(e.url)}" target="_blank"
          rel="noopener noreferrer nofollow">${esc(e.titel || 'Untitled')}</a>
        <span class="gh-status gh-${attr(e.tilstand)}">${esc(ORD[e.tilstand] || 'Open')}</span>
      </div>
      <div class="gh-fod meta">${esc(e.ejer)}/${esc(e.repo)}#${e.nummer}${
  e.forfatter ? ` · ${esc(e.forfatter)}` : ''}</div>
    </div>`;
}

const github = require('./github.js').opret({
  hentIndstilling: getSetting,
  logError,
  nu: now,
  hentCache: (noegle) => db.prepare('SELECT data, etag, hentet_at FROM github_cache WHERE noegle = ?')
    .get(noegle) || null,
  gemCache(noegle, data, etag) {
    db.prepare(`INSERT INTO github_cache (noegle, data, etag, hentet_at) VALUES (?,?,?,?)
                ON CONFLICT(noegle) DO UPDATE SET data = excluded.data, etag = excluded.etag,
                                                  hentet_at = excluded.hentet_at`)
      .run(noegle, data, etag, now());
  },
  // Et 304 betyder »det, du har, er rigtigt«. Stempl det friskt, ellers
  // koster den samme uaendrede sag et kald hvert kvarter.
  roerCache: (noegle) => db.prepare('UPDATE github_cache SET hentet_at = ? WHERE noegle = ?')
    .run(now(), noegle),
});

/**
 * Opgaverne, en note har sendt - opfrisket hoejst én gang i kvarteret.
 *
 * ÉT kald til doda for ALLE brugerens opgaver (`/changes?since=`), ikke ét
 * pr. opgave. Vandmaerket staar i settings, saa det overlever en genstart -
 * og dodas eget `now` bruges, saa de to ure ikke skal vaere enige.
 *
 * Fejler kaldet, sker der INGENTING: raekkerne staar der stadig med det, de
 * sidst vidste. En bro, der bliver tom, naar den anden ende er nede, ligner
 * en bro, der har mistet noget.
 */
/**
 * Finder Sagu-notens id i det, doda ved om en opgave.
 *
 * Adressen kan staa tre steder, og alle tre er lige gyldige:
 *   - `link_url`, hvis doda har loeftet den op i sit eget felt,
 *   - `note`, hvor broen selv skriver den (paa sin egen linje),
 *   - `title`, hvis en modtager har lagt hele teksten i titlen.
 *
 * Vi leder efter `#note-<32 hex>` - Sagus egen adresseform - og ikke efter
 * vaertsnavnet. Sagu naas paa flere adresser (panelets IP:port, tunnelen, det
 * rigtige domaene), og en opgave, der blev linket fra den ene, ville ellers
 * ikke blive genkendt fra den anden.
 */
function noteIdFraOpgave(item) {
  const felter = [item && item.link_url, item && item.note, item && item.title];
  for (const f of felter) {
    const m = String(f || '').match(/#note-([a-f0-9]{32})\b/);
    if (m) return m[1];
  }
  return null;
}

/**
 * Opgaver, doda selv har linket til en note, hentes ind.
 *
 * »Hvis en doda opgave får et link til en sagu note, så skal den dukke op i
 * noten i sagu« (Andreas, 2026-08-24).
 *
 * Broen kendte kun de opgaver, den SELV havde oprettet. Skrev man linket i
 * doda - eller flyttede opgaven til en anden note - vidste Sagu ingenting, og
 * noten stod tom ved siden af en opgave, der pegede lige paa den.
 *
 * Peger linket paa en note, der ikke findes eller ikke er ens egen, sker der
 * ingenting. Et id i en fremmed opgave maa ikke kunne bruges til at faa noget
 * til at staa paa en note, man ikke ejer.
 */
function hentIndLinkedeOpgaver(userId, items, kendte) {
  const findNote = db.prepare(
    'SELECT id FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL');
  const ind = db.prepare(`INSERT INTO doda_tasks
      (id, user_id, note_id, doda_id, title, status, line, created_at, checked_at)
      VALUES (?,?,?,?,?,?,NULL,?,?)`);
  const flyt = db.prepare('UPDATE doda_tasks SET note_id = ? WHERE id = ?');
  const t = now();
  let nye = 0;
  for (const item of items) {
    const noteId = noteIdFraOpgave(item);
    if (!noteId || !findNote.get(noteId, userId)) continue;
    const eget = kendte.get(String(item.id));
    if (eget) {
      // Linket kan vaere flyttet til en ANDEN note. Saa foelger opgaven med -
      // det er dét, linket betyder.
      const r = db.prepare('SELECT note_id FROM doda_tasks WHERE id = ?').get(eget);
      if (r && r.note_id !== noteId) flyt.run(noteId, eget);
      continue;
    }
    const id = newId();
    ind.run(id, userId, noteId, String(item.id),
      str(renOpgaveTitel(item.title, noteId), 300), str(item.status, 40) || 'open', t, t);
    kendte.set(String(item.id), id);
    nye += 1;
  }
  return nye;
}

async function opfriskDodaOpgaver(userId, tving) {
  const raekker = db.prepare('SELECT id, doda_id, note_id, checked_at FROM doda_tasks WHERE user_id = ?')
    .all(userId);
  /*
   * Der opfriskes OGSAA, naar vi ingen opgaver har.
   *
   * Foer stod der `if (!raekker.length) return` - fornuftigt, dengang broen
   * kun kendte det, den selv havde lavet. Men en opgave, doda har linket til
   * en note, findes netop ikke hos os endnu, og saa ville den aldrig blive
   * fundet. Gulvet flyttes derfor til et stempel paa brugeren, saa en tom
   * note ikke spoerger doda ved hver optegning.
   */
  const sidst = raekker.length
    ? Math.min(...raekker.map((r) => r.checked_at || 0))
    : Number(getSetting(userId, 'doda_checked', '0')) || 0;
  if (!tving && now() - sidst < dodaModul.FRISK_I) return { opfrisket: false };
  if (!raekker.length && !doda.opsaetning(userId).connected) return { opfrisket: false };

  const since = Number(getSetting(userId, 'doda_since', '0')) || 0;
  const r = await doda.aendringer(userId, since);
  if (!r.ok) return { opfrisket: false, fejl: r.besked, kode: r.kode };

  const kendte = new Map(raekker.map((x) => [x.doda_id, x.id]));
  // FOERST de opgaver, doda har linket til en note. Saa er de kendte, naar
  // titel og status opdateres nedenfor - ellers ville en ny opgave staa uden
  // titel indtil naeste opfriskning.
  hentIndLinkedeOpgaver(userId, r.data.items || [], kendte);
  const friske = db.prepare('SELECT id, doda_id, note_id FROM doda_tasks WHERE user_id = ?')
    .all(userId);
  const opdater = db.prepare('UPDATE doda_tasks SET title = ?, status = ?, checked_at = ? WHERE id = ?');
  const t = now();
  for (const item of (r.data.items || [])) {
    const id = kendte.get(String(item.id));
    if (!id) continue;
    const raekke = friske.find((x) => x.id === id);
    opdater.run(str(renOpgaveTitel(item.title, raekke ? raekke.note_id : ''), 300),
      str(item.status, 40) || 'open', t, id);
  }
  // En opgave, der er SLETTET i doda, skal kunne ses som slettet - ikke
  // blive staaende som aaben for evigt.
  const slettet = db.prepare("UPDATE doda_tasks SET status = 'deleted', checked_at = ? WHERE id = ?");
  for (const id of (r.data.deleted || [])) {
    const eget = kendte.get(String(id));
    if (eget) slettet.run(t, eget);
  }
  // Stempl ALLE raekker, ogsaa dem der ikke var med i svaret: de er uaendrede,
  // og uden stemplet ville de udloese et nyt kald ved hvert opslag.
  db.prepare('UPDATE doda_tasks SET checked_at = ? WHERE user_id = ?').run(t, userId);
  // ... og et stempel paa brugeren, saa gulvet ogsaa holder, naar der slet
  // ingen raekker er.
  setSetting(userId, 'doda_checked', String(t));
  setSetting(userId, 'doda_since', String(r.data.now || t));
  return { opfrisket: true };
}

function dodaOpgaverFor(userId, noteId) {
  /*
   * Adressen til opgaven i doda bygges HER, ikke i fladen.
   *
   * »Kan du lave så man kan klikke på en doda opgave og så åbner den opgaven
   * i doda?« (Andreas, 2026-08-24).
   *
   * `?item=<id>` er dodas egen indgang - den, kalenderfeedet allerede peger
   * med, saa man kan springe fra en deadline til opgaven. Der skulle altsaa
   * ingenting aendres i doda; formen fandtes.
   *
   * Den bygges paa serveren, fordi det er DÉR, resten af det, Sagu ved om
   * doda, ligger. Sendte vi bare adressen til browseren og lod den saette
   * `?item=` paa, ville dodas adresseform vaere spredt over to apps - og den
   * dag doda skifter den, skal to steder rettes.
   *
   * Uden en forbindelse er der ingen adresse, og saa bliver titlen bare
   * tekst. Et link, der peger paa ingenting, er vaerre end intet link.
   */
  const base = String(doda.opsaetning(userId).url || '').replace(/\/+$/, '');
  return db.prepare(`SELECT id, doda_id, title, status, line, created_at, checked_at
                       FROM doda_tasks WHERE user_id = ? AND note_id = ?
                      ORDER BY created_at`).all(userId, noteId)
    .map((r) => ({
      id: r.id,
      dodaId: r.doda_id,
      title: r.title,
      status: r.status,
      line: r.line,
      createdAt: r.created_at,
      checkedAt: r.checked_at,
      url: base ? `${base}/?item=${encodeURIComponent(r.doda_id)}` : null,
    }));
}

/** Notens adresse, som den skal SES udefra (§15's offentlige adresse). */
function noteAdresse(req, noteId) {
  return `${offentligVaert(req)}/#note-${noteId}`;
}

/**
 * Titlen UDEN den adresse, Sagu selv haengte paa.
 *
 * dodas fangst laegger hele linjen i titlen - det er dens maade, og
 * MsGraphBud goer det samme i drift. Men i Sagus egen liste er adressen ren
 * stoej: den peger tilbage paa den note, raekken allerede staar paa.
 *
 * Kun VORES eget link fjernes, og kun naar det peger paa DENNE note. Skriver
 * nogen doeber opgaven om i doda, staar den nye titel uroert - det er hans
 * ord, ikke maskineri (RUNE-ERFARINGER, MsGraphBud v7: »linkets tekst betyder
 * noget; adressen er maskineri«).
 */
function renOpgaveTitel(raa, noteId) {
  if (!noteId) return String(raa || '').trim();
  /*
   * Adressen ud af titlen - KUN naar den peger paa DENNE note.
   *
   * Broen skriver den paa sin egen linje (se doda.js), og en modtager, der
   * laegger hele teksten i titlen, giver den tilbage i ét stykke. Men siden
   * opgaver ogsaa kan komme FRA doda, findes en tredje form: en, der er
   * skrevet i haanden med bare et mellemrum foran. Den slap igennem, fordi
   * moensteret kraevede et linjeskift eller en tankestreg - og saa stod et
   * raat hex-id og fyldte i overskriften (maalt, 2026-08-24).
   *
   * Nu fjernes hele det ord, adressen staar i, uanset hvad der gaar forud.
   */
  return String(raa || '')
    .replace(new RegExp(`\\s*(?:[—-]\\s*)?\\S*#note-${noteId}\\S*`), '')
    .trim();
}

/* ==================================================== import (F5) ======= */

/**
 * Funktionerne, import.js faar injiceret.
 *
 * Modulet kender hverken http eller SQL. Gevinsten er ikke kun testbarhed:
 * fordi importen kalder DE SAMME funktioner som webappen, er den en gratis
 * integrationstest af dataadgangen (RUNE-ERFARINGER §9a).
 */
const imp = importModul.opret({
  logError,

  /** Alle Notion-id'er, brugeren allerede har. Til forhaandsvisningen. */
  kendteExtIder() {
    // Kun ét kald: 278 enkeltopslag ville vaere 278 forespoergsler for et
    // svar, der skal bruges som ét saet.
    return new Set(db.prepare('SELECT ext_id FROM notes WHERE ext_id IS NOT NULL')
      .all().map((r) => r.ext_id));
  },

  findNoteMedExtId(userId, extId) {
    // Genimport skal vaere IDEMPOTENT: samme fil to gange maa ikke give
    // dubletter. Noeglen er Notions id, ikke titlen - 12 titler er dubletter
    // i Andreas' eksport, én af dem seks gange.
    return db.prepare(`SELECT id FROM notes
                        WHERE user_id = ? AND ext_id = ? AND deleted_at IS NULL LIMIT 1`)
      .get(userId, extId) || null;
  },

  findEllerOpretNotesbog(userId, navn) {
    const rent = str(navn, 200) || 'Untitled';
    const fundet = db.prepare(`SELECT id, name FROM notebooks
                                WHERE user_id = ? AND deleted_at IS NULL AND lower(name) = lower(?)`)
      .get(userId, rent);
    if (fundet) return fundet;
    return opretNotesbog(userId, rent, '');
  },

  opretTomNote(userId, felter) {
    return opretNote(userId, felter);
  },

  /**
   * Retter en importeret notes NOTESBOG.
   *
   * Findes for genimportens skyld: indtil videre var importen kun idempotent
   * paa teksten, saa en side, appen allerede kendte, blev liggende i den bog,
   * en tidligere (og maaske fejlbehaeftet) import lagde den i. Strukturen
   * kommer fra eksporten - ogsaa anden gang.
   *
   * @returns {boolean} om den faktisk flyttede sig. Kaldstedet taeller det,
   *   og tallet staar i kvitteringen: en flytning maa ikke ske i tavshed.
   */
  saetNotesbog(userId, id, notesbogId) {
    const r = db.prepare('SELECT notebook_id FROM notes WHERE id = ? AND user_id = ?').get(id, userId);
    if (!r) return false;
    if ((r.notebook_id || null) === (notesbogId || null)) return false;
    db.prepare('UPDATE notes SET notebook_id = ? WHERE id = ? AND user_id = ?')
      .run(notesbogId || null, id, userId);
    return true;
  },

  /** Samme for FORAELDEREN. `null` loesriver. @returns {boolean} om den flyttede sig. */
  saetForaelder(userId, id, foraelderId) {
    const r = db.prepare('SELECT parent_id FROM notes WHERE id = ? AND user_id = ?').get(id, userId);
    if (!r) return false;
    // Uaendret? Saa roer den ikke - ellers skriver hver genimport i 290 raekker
    // for ingenting.
    if ((r.parent_id || null) === (foraelderId || null)) return false;
    // Gaar gennem flytNote, saa cyklus-vagten ogsaa gaelder en import. Et
    // arkiv med en ring i ville ellers goere sidebaren ubrugelig.
    flytNote(userId, id, { parentId: foraelderId });
    return true;
  },

  gemFil(userId, { navn, mime, data }) {
    sikreDir(FILES_DIR);
    const id = newId();
    fs.writeFileSync(filSti(id), data);
    const sha = crypto.createHash('sha256').update(data).digest('hex');
    // note_id er NULL her: en importeret fil kan vaere naevnt fra flere sider,
    // og hvem der ejer den afgoeres foerst, naar linkene er skrevet om
    // (se knytFilTilNote). Kolonnelisten og vaerdierne SKAL staa i samme
    // raekkefoelge - en NULL paa den forkerte plads gav
    // »NOT NULL constraint failed: attachments.name«, og saa blev ALLE 249
    // filer sprunget over med en fejl, der pegede paa navnet.
    db.prepare(`INSERT INTO attachments (id, user_id, note_id, name, mime, size, sha, created_at)
                VALUES (?,?,NULL,?,?,?,?,?)`)
      .run(id, userId, renseFilnavn(navn), mime, data.length, sha, now());
    return { id };
  },

  /**
   * Skriver en importeret note.
   *
   * Egen indgang med vilje: **importoeren maa saette tidsstempler, og ingen
   * anden maa.** `updated_at` betyder »hvornaar skrev dette program sidst i
   * noten«; lader man enhver kalder saette den, betyder kolonnen hvad den
   * sidste skriver fandt paa. Uden datoerne er 278 importerede noter en
   * bunke, der alle blev skrevet samme aften (Verdandes spec).
   */
  skrivImporteretNote(userId, noteId, felter, props, tags, tider) {
    const svar = gemNote(userId, noteId, felter);
    if (svar.fejl) return;

    if (tider.created || tider.updated) {
      const saet = [];
      const arg = [];
      if (tider.created) { saet.push('created_at = ?'); arg.push(tider.created); }
      if (tider.updated) { saet.push('updated_at = ?'); arg.push(tider.updated); }
      db.prepare(`UPDATE notes SET ${saet.join(', ')} WHERE id = ? AND user_id = ?`)
        .run(...arg, noteId, userId);
    }

    db.prepare('DELETE FROM note_props WHERE note_id = ?').run(noteId);
    props.slice(0, 50).forEach((p, i) => {
      db.prepare('INSERT OR REPLACE INTO note_props (note_id, key, value, seq) VALUES (?,?,?,?)')
        .run(noteId, str(p.key, 80), str(p.value, 2000), i);
    });

    for (const navn of tags) {
      const rent = str(navn, 60);
      if (!rent) continue;
      let t = db.prepare('SELECT id FROM tags WHERE user_id = ? AND lower(name) = lower(?)')
        .get(userId, rent);
      if (!t) {
        const id = newId();
        db.prepare('INSERT INTO tags (id, user_id, name, created_at) VALUES (?,?,?,?)')
          .run(id, userId, rent, now());
        t = { id };
      }
      db.prepare('INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?,?)').run(noteId, t.id);
    }
    indekser(noteId);
  },

  /**
   * Knytter en importeret fil til den foerste note, der naevner den.
   *
   * Uden det staar filerne som »loese« i Settings, og notens
   * vedhaeftningsrude er tom, selv om billedet vises i teksten. Den foerste
   * note vinder: en fil kan vaere naevnt flere steder, og at vaelge én er
   * bedre end at vaelge ingen.
   */
  knytFilTilNote(userId, filId, noteId) {
    db.prepare(`UPDATE attachments SET note_id = ?
                 WHERE id = ? AND user_id = ? AND note_id IS NULL`).run(noteId, filId, userId);
  },
});

/* ========================================== mcp + connector (F10) ======= */

/**
 * Godkender UDEN at sende et svar.
 *
 * MCP formulerer sin egen 401 - den skal baere `WWW-Authenticate` med
 * `resource_metadata`, og det er en anden form end API'ets JSON-fejl. Derfor
 * kan `godkend()` ikke bruges her: den svarer selv.
 *
 * Returnerer det, `app/mcp.js` har brug for og intet mere: hvem noeglen
 * tilhoerer, og hvad den maa. Vaerktoejerne kalder Sagus egne funktioner med
 * `userId`, saa `user_id`-filteret ligger praecis samme sted som ellers.
 */
function godkendMcp(req) {
  const auth = String(req.headers.authorization || '');
  const bearer = auth.match(/^Bearer\s+(\S+)$/i);
  const raa = bearer ? bearer[1] : String(req.headers['x-api-key'] || '');
  if (!raa) return null;
  const token = findToken(raa);
  if (!token) {
    logSecurity(`mcp-noegle-afvist ip=${clientIp(req)}`);
    return null;
  }
  if (!rateAllow(`api:${token.id}`, 600, 3600)) return null;
  // Noeglen baerer sin bruger. En noegle uden en levende bruger er ingen
  // noegle - konti kan slettes, mens et token stadig ligger i en klient.
  const bruger = db.prepare('SELECT id FROM users WHERE id = ?').get(token.user_id);
  if (!bruger) return null;
  stemplBrug(token);
  return { token, userId: token.user_id, scope: token.scope, viaToken: true };
}

/**
 * Maa det her kald ogsaa LAESE?
 *
 * En cookie-session maa alt, brugeren maa. En noegle maa det, dens scope
 * siger. Bruges dér, hvor et svar baerer mere, end kaldet selv bad om - saa
 * en skrive-doer ikke bliver til en laese-kanal.
 */
function maaLaese(auth) {
  if (!auth.viaToken) return true;
  const s = auth.token && auth.token.scope;
  return !!(SCOPE_TILLADER[s] && SCOPE_TILLADER[s].has('read'));
}

/** Samme scope-matrix som API'et. ÉT sted, ellers driver de fra hinanden. */
function maaScope(auth, kraevet) {
  const s = auth && auth.scope;
  return !!(SCOPE_TILLADER[s] && SCOPE_TILLADER[s].has(kraevet));
}

/**
 * 401-headeren, hele connector-opdagelsen haenger paa.
 *
 * `resource_metadata` peger paa RFC 9728-dokumentet; uden den kan claude.ai
 * ikke finde autorisationsserveren og opgiver forbindelsen **uden at noget
 * ser i stykker ud** (RUNE-ERFARINGER §9a, faelde 1). Adressen dannes af
 * kaldets egen vaert - ikke af `public_url`: opdagelsen skal pege paa den
 * server, klienten rent faktisk taler med.
 */
function oauthUdfordring(req) {
  const b = vaert(req);
  return `Bearer realm="${APP_NAME}", resource_metadata="${b}/.well-known/oauth-protected-resource"`;
}

const mcp = require('./mcp.js').opret({
  appName: APP_NAME,
  // Getter, ikke vaerdi: `computeInlineHash()` laeser versionen ud af
  // index.html ved OPSTART, altsaa efter det her modul er lavet. En vaerdi
  // her ville fryse serverInfo paa 1 for altid.
  version: () => APP_VERSION_FIL,
  maa: maaScope,
  godkendMcp,
  oauthUdfordring,
  readJsonBody,
  logError,
  fangst,
  findNotesbog,
  soegNoter,
  hentNote,
  gemNote,
  hentNotesboeger,
  hentMaerker,
  opretKommentar,
  udgivNote,
});

/* ------------------------------------------------------------- oauth */

/* Motoren staar i app/oauth.js og kender hverken database eller http.
   Herunder er kun det, den ikke kan vide noget om: tabellerne, samtykke-
   siden og ruterne. */

const oauth = require('./oauth.js').opret({
  gemKlient(k) {
    db.prepare('INSERT INTO oauth_clients (id, name, redirect_uris, created_at) VALUES (?,?,?,?)')
      .run(k.id, k.name, k.redirect_uris, now());
    audit('oauth-klient-registreret', null, k.name, null);
  },

  hentKlient(id) {
    return db.prepare('SELECT id, name, redirect_uris FROM oauth_clients WHERE id = ?')
      .get(String(id || '')) || null;
  },

  /**
   * Access- og refresh-token i ét.
   *
   * Access-tokenet gaar gennem `opretToken` og ender i `tokens` - praecis som
   * en haandlavet noegle, bare med et `client_id` og et udloeb. Saa er der ÉN
   * vej ind i API'et, og `findToken` er det ene sted, en noegle kan vise sig
   * ugyldig.
   */
  udstedTokens(clientId, scope, userId) {
    const klient = db.prepare('SELECT name FROM oauth_clients WHERE id = ?').get(clientId);
    const t = now();
    const adgang = opretToken(userId, klient ? klient.name : 'OAuth client', scope,
      { clientId, expiresAt: t + oauth.ADGANG_LEVETID });
    const refresh = `sagur_${crypto.randomBytes(32).toString('base64url')}`;
    db.prepare(`INSERT INTO oauth_refresh (hash, token_id, client_id, scope, user_id, created_at)
                VALUES (?,?,?,?,?,?)`)
      .run(hashToken(refresh), adgang.id, clientId, scope, userId, t);
    return {
      access_token: adgang.key,
      token_type: 'Bearer',
      expires_in: oauth.ADGANG_LEVETID,
      refresh_token: refresh,
      scope,
    };
  },

  findRefresh(raa) {
    if (typeof raa !== 'string' || !raa.startsWith('sagur_')) return null;
    return db.prepare(`
      SELECT hash, token_id, client_id, scope, user_id FROM oauth_refresh
       WHERE hash = ? AND revoked_at IS NULL`).get(hashToken(raa)) || null;
  },

  tilbagekaldRefresh(raa) {
    db.prepare('UPDATE oauth_refresh SET revoked_at = ? WHERE hash = ? AND revoked_at IS NULL')
      .run(now(), hashToken(String(raa || '')));
  },
});

/**
 * Alt, en klient har faaet HOS DENNE BRUGER: access-tokens OG refresh-tokens.
 *
 * `user_id` staar i begge WHERE'er, ogsaa selv om man kun kan naa hertil med
 * sin egen session. Sagu er flerbruger, og den samme claude.ai-klientraekke
 * kan have tokens hos to forskellige brugere: uden filteret ville en
 * tilbagekaldelse rive den anden brugers forbindelse med.
 */
function tilbagekaldKlient(userId, clientId) {
  const t = now();
  const a = db.prepare(`UPDATE tokens SET revoked_at = ?
                         WHERE client_id = ? AND user_id = ? AND revoked_at IS NULL`)
    .run(t, clientId, userId);
  const b = db.prepare(`UPDATE oauth_refresh SET revoked_at = ?
                         WHERE client_id = ? AND user_id = ? AND revoked_at IS NULL`)
    .run(t, clientId, userId);
  return a.changes + b.changes;
}

/**
 * Kun klienter, brugeren rent faktisk har godkendt.
 *
 * En registrering er ikke en forbindelse: claude.ai registrerer sig paa ny
 * ved hvert forsoeg, ogsaa dem, der bliver afbrudt, og de forsoeg har ingen
 * tokens. Uden EXISTS-tjekket ville listen fyldes med raekker, der baade er
 * uinteressante og ser tilbagekaldte ud.
 */
function hentForbindelser(userId) {
  return db.prepare(`
    SELECT c.id, c.name, c.created_at,
           (SELECT MAX(t.last_used_at) FROM tokens t
             WHERE t.client_id = c.id AND t.user_id = ?) AS last_used_at,
           (SELECT COUNT(*) FROM tokens t
             WHERE t.client_id = c.id AND t.user_id = ?
               AND t.revoked_at IS NULL AND t.expires_at > ?) AS active,
           (SELECT COUNT(*) FROM oauth_refresh r
             WHERE r.client_id = c.id AND r.user_id = ? AND r.revoked_at IS NULL) AS refreshes,
           (SELECT t.scope FROM tokens t
             WHERE t.client_id = c.id AND t.user_id = ?
             ORDER BY t.created_at DESC LIMIT 1) AS scope
      FROM oauth_clients c
     WHERE EXISTS (SELECT 1 FROM tokens t WHERE t.client_id = c.id AND t.user_id = ?)
     ORDER BY c.created_at DESC`).all(userId, userId, now(), userId, userId, userId);
}

/**
 * Samtykkesiden.
 *
 * Ren HTML med en almindelig `<form method="post">` - ingen JavaScript. CSP'en
 * tillader ikke inline scripts uden hash, og en side med to knapper har ingen
 * grund til at have brug for dem. Tema-scriptet er den ENE undtagelse: det er
 * ordret det samme som i index.html og har derfor allerede sin hash.
 */
function oauthSide(indhold) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${markdown.esc(APP_NAME)}</title>
<meta name="robots" content="noindex">
<meta name="color-scheme" content="light dark">
<script data-theme-init>${INLINE_SCRIPT_TEXT}</script>
<link rel="stylesheet" href="/style.css?v=${APP_VERSION_FIL}">
</head>
<body>
<div class="gate"><div class="card">${indhold}</div></div>
</body>
</html>`;
}

/**
 * @param {string} [formAction]  Ekstra oprindelse i CSP'ens `form-action`.
 *
 * `form-action` haandhaeves ogsaa paa den OMDIRIGERING, indsendelsen foerer
 * til - ikke kun paa formularens egen adresse. Samtykkesiden POSTer til sig
 * selv, men svarer 302 til klientens `redirect_uri`, og med bare `'self'`
 * blokerer browseren hele indsendelsen. Fejlen peger paa `/oauth/authorize`,
 * saa det ser ud, som om knappen ikke virker: intet sker, ingen navigation,
 * ingen serverlog (RUNE-ERFARINGER §9a, faelde 4).
 *
 * Derfor tilfoejes praecis den ene oprindelse, klienten er REGISTRERET med -
 * ikke `https:` i al almindelighed.
 */
function sendOauthHtml(res, status, html, formAction) {
  securityHeaders(res);
  if (formAction) {
    res.setHeader('Content-Security-Policy',
      String(res.getHeader('Content-Security-Policy'))
        .replace("form-action 'self'", `form-action 'self' ${formAction}`));
  }
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    'Cache-Control': 'no-store',
  });
  res.end(html);
}

function oauthFejlside(res, besked) {
  sendOauthHtml(res, 400, oauthSide(`
    <h2 style="margin:0 0 10px">Connection refused</h2>
    <p class="lead">${markdown.esc(besked)}</p>
    <p class="gate-note">Nothing was granted. You can close this window.</p>`));
}

/**
 * Skjult felt, der binder samtykke-formularen til netop denne session.
 *
 * SameSite=Lax goer allerede en cross-site POST cookieloes, men det her er den
 * eneste cookie-godkendte rute i appen, der ikke laeser en JSON-krop - og
 * naar en sikkerhedsregel bor i én faelles funktion, skal de ruter, der IKKE
 * gaar gennem den, have deres egen.
 */
function samtykkeBevis(req) {
  const s = parseCookies(req.headers.cookie)[SESSION_COOKIE] || '';
  return crypto.createHmac('sha256', s).update('oauth-consent').digest('hex');
}

const OAUTH_FELTER = ['client_id', 'redirect_uri', 'response_type', 'scope',
  'state', 'code_challenge', 'code_challenge_method'];

function samtykkeHtml(req, q, o) {
  const skjulte = OAUTH_FELTER
    .map((n) => `<input type="hidden" name="${n}" value="${markdown.attr(q.get(n) || '')}">`).join('\n');
  const hvad = o.scope === 'read'
    ? 'read your notes, notebooks and tags'
    : 'read <em>and change</em> your notes, notebooks and tags, and publish pages on the open web';
  return oauthSide(`
    <div class="brand">${markdown.esc(APP_NAME)}</div>
    <p class="lead" style="text-align:center;margin:18px 0 22px">
      <strong>${markdown.esc(o.klient.name)}</strong> wants to connect to your ${markdown.esc(APP_NAME)}.</p>
    <p class="lead" style="margin:0 0 6px">If you allow it, it can ${hvad}.</p>
    <p class="lead" style="margin:0 0 22px">It can never change your password, create access
      keys, or revoke connections — those need this browser. It reaches your notes and
      nobody else's.</p>
    <form method="post" action="/oauth/authorize">
      ${skjulte}
      <input type="hidden" name="bevis" value="${samtykkeBevis(req)}">
      <button class="btn primary" type="submit" name="godkend" value="ja" style="width:100%">Allow</button>
      <button class="btn" type="submit" name="godkend" value="nej" style="width:100%;margin-top:8px">Cancel</button>
    </form>
    <p class="gate-note">You can revoke this again under Settings → Connected apps.
      Signed in as <strong>${markdown.esc(markdown.pentBrugernavn(o.bruger))}</strong>.</p>`);
}

/*
 * CORS.
 *
 * De her fire endepunkter er offentlige opdagelses- og udvekslingspunkter
 * uden ambient legitimation: der er ingen cookie at misbruge, og en klient i
 * en browser skal kunne naa dem.
 *
 * `Cross-Origin-Resource-Policy: same-origin` fra `securityHeaders` ville
 * spaerre svaret ALLIGEVEL - browseren kaster det efter CORS-tjekket. Derfor
 * saetter de her ruter deres egen header og gaar udenom (§9a, faelde 3).
 */
function oauthCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, MCP-Protocol-Version');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '3600');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
}

async function haandterOauth(req, res, urlPath, query) {
  const metode = req.method;

  if (metode === 'OPTIONS') {
    oauthCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  /* --- opdagelse. Begge stier serveres: RFC 9728 haenger ressourcens sti paa
     (/.well-known/oauth-protected-resource/mcp), mens flere klienter proever
     den nogne form foerst. To linjer her sparer en tavs opdagelsesfejl. --- */
  if (/^\/\.well-known\/oauth-protected-resource(\/.*)?$/.test(urlPath)) {
    oauthCors(res);
    sendJson(res, 200, oauth.beskyttetRessource(req));
    return;
  }
  if (/^\/\.well-known\/oauth-authorization-server(\/.*)?$/.test(urlPath)) {
    oauthCors(res);
    sendJson(res, 200, oauth.serverMetadata(req));
    return;
  }

  /* --- dynamisk klientregistrering (RFC 7591) --- */
  if (urlPath === '/oauth/register' && metode === 'POST') {
    oauthCors(res);
    /*
     * 60 i timen. En klient registrerer sig ved HVERT forsoeg, ogsaa dem, der
     * bliver afbrudt, saa graensen skal ligge langt over almindelig fumlen:
     * rammes den, findes klienten aldrig, og brugeren faar »unknown client«
     * paa samtykkesiden - en fejl, der peger et helt andet sted hen end
     * aarsagen.
     */
    if (!rateAllow(`oauth-register:${clientIp(req)}`, 60, 3600)) {
      sendJson(res, 429, { error: 'temporarily_unavailable', error_description: 'Too many registrations. Try again later.' });
      return;
    }
    // tilgivende: der er ingen cookie i spil, saa JSON-kravet (en
    // CSRF-barriere) giver ingen mening her.
    const krop = await readJsonBody(req, true);
    const r = oauth.registrer(krop);
    if (r.fejl) {
      sendJson(res, 400, { error: 'invalid_redirect_uri', error_description: r.fejl });
      return;
    }
    sendJson(res, 201, r.klient);
    return;
  }

  /* --- samtykke --- */
  if (urlPath === '/oauth/authorize' && (metode === 'GET' || metode === 'POST')) {
    const bruger = sessionUser(req);
    if (!bruger) {
      if (metode !== 'GET') { oauthFejlside(res, 'Your session expired while approving. Start the connection again.'); return; }
      // Log ind foerst, og kom saa tilbage hertil. Frontenden sender KUN
      // videre til stier, der begynder med /oauth/authorize - aldrig til et
      // fremmed sted (aaben viderestilling).
      res.writeHead(302, { Location: `/?next=${encodeURIComponent(req.url)}`, 'Cache-Control': 'no-store' });
      res.end();
      return;
    }

    const felter = metode === 'GET' ? query : new URLSearchParams();
    if (metode === 'POST') {
      const krop = await readJsonBody(req, true);
      for (const n of OAUTH_FELTER) felter.set(n, String(krop[n] || ''));
      // Laengden sammenlignes paa BUFFERE, ikke paa strenge: timingSafeEqual
      // kaster ved forskellig laengde, og et flerbyte-tegn ville give to
      // strenge af samme laengde, men to buffere af forskellig.
      const forventet = Buffer.from(samtykkeBevis(req));
      const givet = Buffer.from(String(krop.bevis || ''));
      if (givet.length !== forventet.length || !crypto.timingSafeEqual(givet, forventet)) {
        logSecurity(`oauth-samtykke-afvist ip=${clientIp(req)}`);
        oauthFejlside(res, 'That approval did not come from this browser session.');
        return;
      }
      if (String(krop.godkend || '') !== 'ja') {
        // Afvisningen meldes tilbage til klienten, som protokollen kraever -
        // ellers staar den og venter paa en kode, der aldrig kommer.
        const o = oauth.tjekAutorisation(felter);
        if (o.fejl || !o.redirect) { oauthFejlside(res, 'Connection cancelled.'); return; }
        const url = new URL(o.redirect);
        url.searchParams.set('error', 'access_denied');
        if (o.state) url.searchParams.set('state', o.state);
        audit('oauth-afvist', bruger.id, o.klient.name, clientIp(req));
        res.writeHead(302, { Location: url.toString(), 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
    }

    const o = oauth.tjekAutorisation(felter);
    if (o.fejl) { oauthFejlside(res, o.fejl); return; }

    if (metode === 'GET') {
      // Oprindelsen kommer fra en redirect_uri, der ALLEREDE er valideret mod
      // klientens registrerede liste - ikke fra det, browseren sendte.
      let maal = '';
      try { maal = new URL(o.redirect).origin; } catch { /* kan ikke ske efter tjekket */ }
      sendOauthHtml(res, 200,
        samtykkeHtml(req, felter, Object.assign({ bruger: bruger.username }, o)), maal);
      return;
    }

    const url = oauth.giveTilladelse(o, bruger.id);
    audit('oauth-godkendt', bruger.id, o.klient.name, o.scope);
    logSecurity(`oauth-godkendt klient=${o.klient.name}`);
    res.writeHead(302, { Location: url, 'Cache-Control': 'no-store' });
    res.end();
    return;
  }

  /* --- token --- */
  if (urlPath === '/oauth/token' && metode === 'POST') {
    oauthCors(res);
    if (!rateAllow(`oauth-token:${clientIp(req)}`, 120, 3600)) {
      sendJson(res, 429, { error: 'temporarily_unavailable', error_description: 'Too many token requests.' });
      return;
    }
    // OAuth-klienter sender application/x-www-form-urlencoded.
    const krop = await readJsonBody(req, true);
    const art = String(krop.grant_type || '');
    let r;
    if (art === 'authorization_code') r = oauth.byttKode(krop);
    else if (art === 'refresh_token') r = oauth.forny(krop);
    else { sendJson(res, 400, { error: 'unsupported_grant_type' }); return; }

    if (r.fejl) {
      logSecurity(`oauth-grant-afvist art=${art} ip=${clientIp(req)}`);
      sendJson(res, 400, { error: r.fejl, error_description: 'That code or refresh token is not valid any more.' });
      return;
    }
    sendJson(res, 200, r);
    return;
  }

  /* --- tilbagekaldelse (RFC 7009). Svarer ALTID 200: et ugyldigt token er
     allerede tilbagekaldt, og alt andet ville roebe, hvad der findes. --- */
  if (urlPath === '/oauth/revoke' && metode === 'POST') {
    oauthCors(res);
    const krop = await readJsonBody(req, true);
    const t = String(krop.token || '');
    if (t.startsWith('sagur_')) {
      db.prepare('UPDATE oauth_refresh SET revoked_at = ? WHERE hash = ? AND revoked_at IS NULL')
        .run(now(), hashToken(t));
    } else if (t.startsWith('sagu_')) {
      db.prepare(`UPDATE tokens SET revoked_at = ?
                   WHERE hash = ? AND client_id IS NOT NULL AND revoked_at IS NULL`)
        .run(now(), hashToken(t));
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 404, { error: 'unknown endpoint' });
}

/* ------------------------------------------------------------ server */

const server = http.createServer(async (req, res) => {
  let urlPath;
  let query;
  try {
    const u = new URL(req.url, 'http://localhost');
    urlPath = decodeURIComponent(u.pathname);
    query = u.searchParams;
  } catch {
    apiFejl(res, 400, 'bad_request', 'Bad address.');
    return;
  }

  try {
    /*
     * MCP staar FOER alt andet - ogsaa foer /api/.
     *
     * Den har sin egen godkendelse (`godkendMcp`), sin egen 401 med
     * `WWW-Authenticate`, sit eget Origin-tjek mod DNS-rebinding og sin egen
     * fejlform (JSON-RPC, ikke Sagus `{error, message}`). Laegges den ind
     * under API-routeren, faar den API'ets 401 uden `resource_metadata` - og
     * saa opgiver claude.ai forbindelsen, uden at noget ser i stykker ud.
     */
    if (urlPath === '/mcp') {
      securityHeaders(res);
      await mcp.haandter(req, res);
      return;
    }
    /*
     * OAuth-ruterne staar ogsaa udenfor: de svarer med HTML (samtykkesiden)
     * og med OAuth's egen fejlform (`{error, error_description}`), og de
     * skal naas fra en fremmed oprindelse - hvad ingen anden rute i Sagu maa.
     */
    if (urlPath.startsWith('/oauth/') || urlPath.startsWith('/.well-known/oauth-')) {
      await haandterOauth(req, res, urlPath, query);
      return;
    }
    if (urlPath.startsWith('/api/')) {
      securityHeaders(res);
      /*
       * ── ÉN doer paa klem: `/api/v1/capture` ──────────────────────────────
       *
       * Bogmaerket (Settings -> »Save to Sagu«) koerer paa en HELT anden
       * vaert - en ServiceNow-sag, en artikel, hvad som helst - og skal kunne
       * sende siden hertil. Uden CORS afviser browseren svaret, og knappen
       * ville se ud som om den intet gjorde.
       *
       * Hvorfor det er ufarligt at aabne netop den:
       *
       *  - `Allow-Origin: *` UDEN `Allow-Credentials`. Browseren sender
       *    dermed ingen cookie, og et fremmed websted kan ikke handle som den
       *    indloggede bruger.
       *  - Sessionscookien er `SameSite=Lax`. Den foelger under ingen
       *    omstaendigheder med en POST fra et andet websted - heller ikke en
       *    »simpel« POST, der slipper udenom preflight. Der er altsaa ingen
       *    ambient legitimation at misbruge, og det ER hele CSRF-spoergsmaalet.
       *  - Tilbage staar noeglen i `Authorization`, som angriberen skal have
       *    fat i foerst. Har han den, kan han kalde API'et fra hvad som helst
       *    i forvejen - CORS aendrer intet ved det.
       *
       * Doeren gaelder KUN capture. En `read`-rute paa klem ville vaere noget
       * andet: dér ville et svar, en fremmed side kan laese, vaere selve
       * skaden. Capture kan pr. definition ingenting laese (F9's scope-tabel).
       *
       * `Cross-Origin-Resource-Policy` saettes eksplicit: `securityHeaders`
       * har allerede sat `same-origin`, og browseren kaster svaret paa DEN
       * konto efter CORS-tjekket (§9a, faelde 3 - samme faelde som OAuth).
       */
      if (urlPath === '/api/v1/capture') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Max-Age', '3600');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      }
      const rute = findRute(req.method, urlPath);
      if (!rute) { apiFejl(res, 404, 'unknown_endpoint', 'No such endpoint.'); return; }
      await rute.kald(req, res, { query, params: rute.params });
      return;
    }
    /*
     * Den offentlige wiki. Staar FOER GET-spaerren, fordi kodeordsformularen
     * er en almindelig POST - og den er appens eneste POST uden login. Der er
     * ingen CSRF-barriere paa den med vilje: der findes ingen ambient
     * legitimation at misbruge, og det eneste, en forfalsket indsendelse kan
     * opnaa, er at give en browser adgang til et kodeord, afsenderen allerede
     * kendte.
     */
    if (/^\/(w|s)(\/|$)/.test(urlPath)) {
      await wiki.svar(req, res, { urlPath, query });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      apiFejl(res, 405, 'method_not_allowed', 'That method is not allowed here.');
      return;
    }
    serveStatic(req, res, urlPath);
  } catch (err) {
    const status = err && err.status ? err.status : 500;
    if (status >= 500) logError(`${req.method} ${urlPath}: ${err && err.stack ? err.stack : err}`);
    if (!res.headersSent) {
      // Samme form som resten af API'et, saa en klient altid har noget at
      // vise. En 500 roeber ALDRIG sin egen besked - den staar i serverloggen.
      const KODER = { 400: 'bad_request', 413: 'too_large', 415: 'wrong_content_type' };
      apiFejl(res, status, KODER[status] || 'server_error',
        status >= 500 ? 'Something went wrong on the server.' : (err && err.message) || 'Bad request.');
    } else res.end();
  }
});

/* --------------------------------------------------------- oprydning */

function sweep() {
  try {
    const t = now();
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(t);
    db.prepare('DELETE FROM rate WHERE reset_at <= ?').run(t);
    db.prepare('DELETE FROM audit WHERE at < ?').run(t - 180 * 86400);
    db.prepare('DELETE FROM search_miss WHERE at < ?').run(t - 365 * 86400);
    db.prepare('DELETE FROM tokens WHERE expires_at IS NOT NULL AND expires_at < ?').run(t - 30 * 86400);
    /*
     * Papirkurven har 30 dages frist.
     *
     * Notens filer ryddes SAMMEN med den, ikke af en foreldreloes-oprydning
     * bagefter. Grunden er, at `attachments.note_id` er `ON DELETE SET NULL`:
     * naar noten forsvinder, bliver feltet NULL, og saa kan filen ikke
     * skelnes fra en, der bevidst blev uploadet uden en note. En oprydning,
     * der gaettede paa NULL, ville derfor slette de forkerte.
     */
    /*
     * Versionshistorikken beskaeres for ALLE brugere.
     *
     * Tabellen er blevet skrevet til siden F1 uden en graense, saa der ligger
     * et efterslaeb, `gemVersion` aldrig naar: den rydder kun op i den note,
     * den lige har skrevet. Ved opstart tager vi resten.
     *
     * Er historikken slaaet FRA, beskaeres der ikke: det gemte er en
     * kendsgerning om noten, og en kontakt, man har slaaet fra, er ikke en
     * ordre om at slette (samme regel som i fladen).
     */
    for (const u of db.prepare('SELECT id FROM users').all()) {
      const opsaet = versionsOpsaetning(u.id);
      if (!opsaet.enabled) continue;
      const vaek = beskaerAlleVersioner(u.id, opsaet.keep);
      if (vaek) log(`versionshistorik beskaaret: ${vaek} raekker`);
    }

    const gamle = db.prepare('SELECT id FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < ?')
      .all(t - 30 * 86400);
    for (const g of gamle) {
      ryddFilerFor(g.id);
      db.prepare('DELETE FROM notes WHERE id = ?').run(g.id);
    }

    /*
     * Vedhaeftninger, teksten ikke laengere peger paa.
     *
     * Efter doegnet gaar de den ALMINDELIGE vej: en bloed sletning, praecis
     * som havde man trykket »Remove«. Det er med vilje, at automatikken ikke
     * er haardere end den haand, der goer det bevidst - saa er der stadig 30
     * dage, hvor filen kan hentes tilbage, hvis doegnet gik ubemaerket hen.
     */
    for (const f of db.prepare(`
      SELECT id FROM attachments
       WHERE deleted_at IS NULL AND orphan_since IS NOT NULL AND orphan_since < ?`)
      .all(t - FORAELDRELOES_FRIST)) {
      db.prepare('UPDATE attachments SET deleted_at = ? WHERE id = ?').run(t, f.id);
    }

    // Filer, brugeren selv har slettet. Fristen er den samme, saa en
    // fortrudt sletning kan naa at blive fortrudt.
    for (const f of db.prepare('SELECT id FROM attachments WHERE deleted_at IS NOT NULL AND deleted_at < ?')
      .all(t - 30 * 86400)) {
      fjernFil(f.id);
    }

    // Nettet under: en fil, hvis raekke overlevede en note, der forsvandt paa
    // en anden vej (en migrering, en manuel oprydning). Kun filer, der ALDRIG
    // har haft en note, gaar fri - dem kan brugeren selv have uploadet loest.
    for (const f of db.prepare(`
      SELECT a.id FROM attachments a
       WHERE a.note_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM notes n WHERE n.id = a.note_id)`).all()) {
      fjernFil(f.id);
    }
    // Afbrudte uploads. En import, der doede undervejs, maa ikke fylde disken.
    try {
      for (const navn of fs.readdirSync(UPLOAD_DIR)) {
        const sti = path.join(UPLOAD_DIR, navn);
        if (fs.statSync(sti).mtimeMs < Date.now() - 6 * 3600 * 1000) fs.unlinkSync(sti);
      }
    } catch { /* mappen findes maaske ikke endnu */ }
  } catch (err) {
    logError(`oprydning fejlede: ${err.message}`);
  }
}

process.on('SIGTERM', () => {
  log('lukker ned');
  server.close(() => { try { db.close(); } catch { /* ligegyldigt ved nedlukning */ } process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref();
});

process.on('uncaughtException', (err) => {
  logError(`ufanget undtagelse: ${err && err.stack ? err.stack : err}`);
});

/*
 * MAALING 2 (DESIGN.md): har Node's indbyggede SQLite FTS5?
 *
 * Svaret er JA i Node 22, 24 og 26 - SQLITE_ENABLE_FTS5 staar i nodejs/node's
 * deps/sqlite/unofficial.gni for alle tre. Migration m3 opretter derfor
 * indekset direkte, og der findes ingen fallback-tokentabel.
 *
 * Proeven bliver alligevel staaende: docker.image er et FELT i panelet, saa
 * en bruger kan pege runen paa et vilkaarligt node:-image. Sker det, skal
 * loggen sige HVORFOR soegningen ikke virker - i stedet for at et
 * "no such module: fts5" dukker op ved det foerste soegeforsoeg.
 */
function tjekFts5() {
  try {
    const p = new DatabaseSync(':memory:');
    p.exec('CREATE VIRTUAL TABLE p USING fts5(x)');
    p.close();
    return true;
  } catch (err) {
    logError(`FTS5 mangler i denne Node (${process.version}): ${err.message}. `
      + 'Soegningen virker ikke. Skift NODE_IMAGE tilbage til node:24-alpine i panelet.');
    return false;
  }
}

migrate();

/*
 * Er indekset tomt, mens der ER noter, bygges det igen.
 *
 * Det daekker m12's ombygning (indekset blev kastet vaek og skal fyldes), og
 * det daekker enhver anden maade at miste det paa. Vagten er tilstanden, ikke
 * migrationsnummeret: en genopbygning, der kun koeres af ÉN migration, er en
 * engangshandling, man ikke kan bruge igen - og et tomt soegeindeks er tavst.
 * Appen svarer bare »intet matcher«.
 */
function sikreIndeks() {
  try {
    const noter = db.prepare('SELECT COUNT(*) AS n FROM notes WHERE deleted_at IS NULL').get().n;
    if (!noter) return;
    if (db.prepare('SELECT COUNT(*) AS n FROM note_fts').get().n) return;
    const t0 = Date.now();
    const antal = genopbygIndeks();
    log(`soegeindekset genopbygget: ${antal} noter paa ${Date.now() - t0} ms`);
  } catch (err) {
    logError(`kunne ikke genopbygge soegeindekset: ${err.message}`);
  }
}
sikreIndeks();

sikreDir(FILES_DIR);
sikreDir(UPLOAD_DIR);
computeInlineHash();
serverSecret();
const HAR_FTS5 = tjekFts5();
sweep();
setInterval(sweep, 6 * 3600 * 1000).unref();

server.listen(BIND_PORT, () => {
  // Den port, der FAKTISK blev bundet - ikke variablen. At skrive sit eget
  // oenske tilbage beviser ingenting: netop dét gjorde, at dodas portfejl
  // ikke kunne ses i den linje, serveren selv skrev.
  log(`sagu lytter paa port ${server.address().port} (data: ${DATA_DIR}, node: ${process.version}, fts5: ${HAR_FTS5 ? 'ja' : 'NEJ'})`);
});
