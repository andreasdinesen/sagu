# Sagu — plan og status

> **Denne fil er den levende oversigt.** Den opdateres ved afslutningen af hver fase.
> Start en ny session med: »Læs SAGU-PLAN.md og CLAUDE.md i ~/ClaudeMacBook/sagu, og byg F<N>.«

**Hvad:** Noteapp som yggdrasil-rune. Flerbruger. Erstatter notion.so — både
det private notearkiv og de offentlige wiki'er på `<arbejdsrum>.notion.site`.
**Forbillede:** doda (UI, søgefelt, stak) + Notion (sideoplevelse, wiki, kommentarer).
**Kilde til krav:** `docs/HANDOVER.md`.

---

## Status lige nu

| | |
|---|---|
| **Fase** | **ALLE FASER BYGGET (F0–F13), 2026-08-21.** v1 (F0–F7) er i drift på Hjorten. |
| **Næste** | **Udgivelse af v2** (F8–F13) — venter på Andreas' ja |
| **Tilstand** | 372 tests grønne (1 sprunget over). Install-scriptet **henter app-koden fra GitHub** og er **1.640 / 126.000 tegn (1,3 %)**, konstant uanset appens størrelse; runens YAML 242.624 → 5.610 b. Payloaden ville indlejret være 151.518 tegn (120,3 %) — appen er for stor til den gamle vej. |
| **Repoet** | **Offentligt** (Andreas, 2026-08-21) efter en audit — `DESIGN.md` §13. Fire fund fjernet; intet hemmeligt fandtes. |
| **Udgivet version** | **v1** (F0–F7), i drift på Hjorten. F8–F13 er bygget og **venter på et ja** til v2: bump → commit → `git tag v2` → `git push --tags`. |

**De fire målinger, kort** (hele regnestykket i `DESIGN.md`):

1. **Payload.** F0 = 29,7 %. Marginalprisen er ~0,21 tegn pr. byte kilde, så
   loftet svarer til ~600 KB kode — omtrent dodas nuværende størrelse. Et
   realistisk skøn over F1–F13 var ~634 KB, altså **~133.000 tegn: det passer
   ikke hele vejen.** **Udløseren (110.000) blev passeret efter F6, og udvejen
   er taget 2026-08-21:** install-scriptet henter app-koden fra GitHub og er
   **1.640 tegn — konstant, uanset appens størrelse**. Repoet er offentligt,
   så der er hverken token eller `secret:`-variabel. Prisen er ét trin mere
   ved udgivelse (`git tag vN`) og en installation, der kræver net.
   **Risiko R1 er lukket.**
2. **FTS5: JA** i Node 22, 24 og 26. Risiko R2 lukket, ingen fallback-tokentabel.
3. **Rune-til-rune:** ingen navneopløsning mellem runer (bekræftet i skemaet).
   URL + nøgle, som MsGraphBud allerede gør i drift. Rundturen gennem tunnelen
   er **~150 ms** — F8 må aldrig kalde doda pr. optegning.
4. **Store uploads:** 120 MB streamet til disk på 112 ms med **6,4 MB heap**.
   Klar til Notion-zip'en i F5.

---

## 1 · De bærende beslutninger

| Beslutning | Valg | Hvorfor |
|---|---|---|
| **Editor** | Hybrid live-markdown | Markdown er sandheden i databasen. Så er »paste markdown«, »vis som markdown«, API, MCP, GitHub-embeds, import og eksport det **samme** format og ikke fem konverteringer, der hver kan tabe indhold. |
| **Datamodellen** | Én `body_md`-kolonne pr. note + rigtige kolonner til alt, der filtreres på | RUNE-ERFARINGER §4: lister og endepunkter uden login må aldrig scanne datasættet. |
| **Flerbruger** | Som tovo, ikke som doda | doda er én-brugers (`users LIMIT 1`). `user_id`-filteret ligger i dataadgangen selv, aldrig i kaldstederne. |
| **doda-koblingen** | Links, ikke synkronisering | To sandheder om samme note er en fælde. Dodas noter bliver i doda. |
| **Offentlige sider** | Egen server-renderet skabelon, **ikke** SPA'en | En besøgende henter aldrig app-koden og kan aldrig nå app-API'et. Det er både hurtigere og sikrere. |
| **Sprog** | **Engelsk interface**, som doda | Samme app-familie, samme fangstfelt-vaner. Kode, kommentarer og disse dokumenter er dansk. Gælder også den ramme, kollegaerne ser i wikien. |
| **Wikiens læsere** | **Offentlig uden konto** | Kollegaerne får ikke logins. Kodeord er en kontakt, der kan slås til senere — **uden at linket skifter**. |
| **Rækkefølge** | Kerne → import → wiki → integrationer | Importen tidligt, så alt bagefter testes mod Andreas' rigtige indhold. |

## 2 · Stak

Præcis dodas: Node ≥22 (`node:http`, `node:sqlite`, `node:crypto`), **nul npm-pakker,
nul CDN**, SQLite i `/data`, alt samlet af `build_rune.py` til én YAML med
brotli+base85-payload. Auth-stakken (scrypt, sessions-cookie, håndskrevet WebAuthn,
rate-limit) kopieres 1:1. Frontend er vanilla JS i `app/parts/p*.js` → `public/app.js`.

**Fra RUNE-ERFARINGER, som Sagu arver uden at genopfinde:** §9a MCP + OAuth-connector ·
§9b sideoversigten i højre kant (nøjagtig den funktion Andreas beder om) · §9c sidebar
der folder sig væk · dodas markdown-renderer, der allerede har afvist fem XSS-angreb ·
dodas filhåndtering fra F7 (PNG inline, alt andet `attachment`) · dodas web-push.

---

## 3 · Datamodel (udkast — fastlægges i F0/F1 og skrives i DESIGN.md)

```
users, sessions, settings(scope,key), tokens(user_id,scope), rate, audit   -- tovos lag
notebooks   id, user_id, name, icon, seq, archived_at, deleted_at
notes       id, user_id, notebook_id, parent_id, title, body_md, icon, seq,
            full_width, ext_id, created_at, updated_at, updated_by,
            archived_at, deleted_at      -- tidsstempler, ikke flag
note_props  note_id, key, value, seq            -- Notion-databasernes kolonner
tags        id, user_id, name                   -- unikt på lower(name)
note_tags   note_id, tag_id
note_links  from_id, to_id                      -- udledt ved gem → backlinks
note_versions  id, note_id, body_md, title, at, user_id
attachments id, note_id, user_id, name, mime, size, sha256
comments    id, note_id, parent_id, user_id|NULL, author, body, at, status
shares      id, note_id, token, mode(single|tree), slug, password_hash,
            allow_comments, allow_search, expires_at, views, created_at
note_acl    note_id, user_id, level(read|write)
note_fts    FTS5: title, headings, body, meta, folded  -- folded daekker ø og æ
search_miss term, at            -- hvad folk søgte efter uden at finde noget
```

**Regler, der ikke må brydes** (de står også i `CLAUDE.md`):
`user_id`-filteret bor i `hentNote`/`hentNoter`/`gemNote` · offentlige ruter slår op på
et **indeks over `shares.token`/`slug`** og scanner aldrig · forkert token = **404**,
ikke 401 · `note_acl` gælder også admin.

---

## 4 · Faser

Hver fase slutter med: byg, test, opsummer, **vent på Andreas' ja**. Ingen `APP_VERSION`-bump
undervejs. Isolationstesten (to brugere, 404 overalt) køres i **hver** fase.

### F0 · Fundament, flerbruger og de fire målinger — **BYGGET 2026-08-20**

Skelet, login (kodeord + passkeys), førstegangsopsætning, registreringsspærre
(**lukket som standard efter den første bruger**, og linket skjules også), tre
temavalg, mobil-skal (900 px), `build_rune.py`, YAML med `update`/`watchers`/
`events`/`backup`/`wipe`, dev-server `sagu` på port **8913** i den globale
`~/.claude/launch.json`.

Datamodellen fra afsnit 3 ligger i migration 1–3, inklusive `note_acl` og
`tokens.user_id` — de kan ikke eftermonteres. Søgningen kører på FTS5 med
vægtede kolonner fra dag ét.

**Fasens egentlige formål var fire målinger.** Hele regnestykket står i
`DESIGN.md`; her er svarene:

1. **Payload-budgettet.** F0 = **38.137 / 126.000 tegn (30,3 %)**.
   Kommentar-strip af den udgivne kopi sparer **25,4 %** (Kokkeri målte 0,8 %,
   doda 24 % — det skulle måles her). Ikonet tegnes af `build_rune.py` som en
   1-bits palet-PNG: 224 b, der koster 298 tegn, mod dodas 2.817.
   Marginalprisen er ~0,21 tegn pr. byte kilde, så loftet svarer til ~600 KB
   kode — omtrent dodas nuværende størrelse. Skønnet for F1–F13 er ~634 KB.
   **Det passer altså ikke hele vejen.**
   *Den dokumenterede vej:* et install-script, der **henter** app-koden fra
   GitHub, er **233 tegn uafhængigt af appens størrelse** — målt mod codeload,
   som svarer 200 uden token på et offentligt repo (`tools`-mønstret).
   Skiftet er én funktion i `build_rune.py` og koster **ingen app-kode**, så
   ingen fase skal designes omkring pladsen. Udløser: 110.000 tegn.
   *(Besvaret 2026-08-21: repoet er offentligt, og udvejen er taget — se
   statusblokken øverst og `DESIGN.md` måling 1.)*
2. **FTS5: JA** — `SQLITE_ENABLE_FTS5` er sat i Node 22, 24 og 26, altså også i
   runens `node:24-alpine`. `bm25`, `snippet`, `highlight` og
   `unicode61 remove_diacritics 2` verificeret. **Risiko R2 er lukket**, og der
   bygges ingen fallback-tokentabel. En probe ved opstart bliver stående, fordi
   `docker.image` er et felt, brugeren kan ændre.
3. **Rune-til-rune:** skemaet er entydigt — det private bridge-net gælder
   sidecars inde i én rune, og der er ingen navneopløsning mellem runer.
   Det er allerede løst: **MsGraphBud er en rune-til-rune-bro i drift** med
   URL + nøgle. Rundturen gennem tunnelen er målt til **~150 ms** (lokalt
   1–4 ms), så **F8 må aldrig kalde doda pr. optegning** — status hentes med et
   tidsstempel-cache. Peges URL'en på Hjortens LAN-adresse, forsvinder de
   150 ms uden en linje kode; det er en indstilling, ikke et design.
4. **Store uploads:** 120 MB streamet til disk på 112 ms (~1.070 MB/s) med
   **6,4 MB heap** og byte-identisk sha256. Testen fælder ved 40 MB, så et
   tilbagefald til bufring ikke kan snige sig ind. Klar til Notion-zip'en i F5.

**Accept — alt målt, ikke antaget:**

| Krav | Resultat |
|---|---|
| Rune installeres i panelet | bygger; 38.137 tegn, YAML 84.338 b |
| To brugere, 404 overalt | 14 tests · **begge vagter set fejle** (sabotér `SYNLIG` → 5 røde, `SKRIVBAR` → 5 andre) |
| CSRF-barriere (415) | ✓ — og en nøgle må sende ren tekst, for der er intet at forfalske |
| Rate-limit (429) | ✓ — tælleren står i `rate`-tabellen og overlever kl. 04-genstarten |
| CSP-hash | matcher sha256 af den faktiske tekst i `index.html` |
| Tre temavalg | målt på `getComputedStyle`; »Lys« på en mørk maskine giver den lyse palet |
| 375 px uden vandret overløb | notelisten, søgningen, indstillingerne, åben sidebar og brugermenu — nul |
| De fire målinger i `DESIGN.md` | ✓ |

**42 tests grønne** — og kørt mod **payloaden pakket ud af den byggede rune med
den udgivne dekoder**, altså mod den kommentar-strippede kode. Sabotage af den
udpakkede kopi giver røde, så testene rammer beviseligt den rigtige fil.

**Rettet undervejs:** en importeret titel på 90 tegn gjorde en tabelcelle
647 px bred i en 375 px skærm — `min-width: max-content` har ingen øvre
grænse. Loftet og en sticky førstekolonne er lagt på komponenten, ikke som en
lap på én tabel, fordi Sagu importerer et helt arkiv og den længste titel ikke
er en, vi vælger.

### F1 · Noter, notesbøger, hierarki og editor v1 — **BYGGET 2026-08-20**

Notesbøger med undersider i vilkårlig dybde, sidebar-træ med foldning,
opret/omdøb/flyt/duplikér/slet, papirkurv med 30 dages frist og gendan,
manuel sortering med knapper.

Editoren: markdown-kilde, live-renderet visning, **klik i et afsnit åbner dét
afsnit råt**, automatisk lagring med »Saved«-mærke og konfliktvagt
(`ifUpdatedAt` → 409 → et valg, ikke en tavs overskrivning). Versionshistorik
skrives fra dag ét. Sideoversigten i højre kant genbrugt ordret (§9b).
Backlinks nederst på noten.

Dertil, efter Andreas' spørgsmål undervejs: **»fuld skærm« viste sig at være
tre ønsker** — fuld bredde (pr. note, i databasen), fokus-tilstand (`F`/`Esc`,
pr. skærm) og browserens egen fuldskærm (tilvalg i note-menuen). Se `DESIGN.md`
§5.

**Accept:**

| Krav | Resultat |
|---|---|
| 200 KB markdown uden mærkbar forsinkelse | render **15 ms**; gem 8 ms, hent 2 ms over http |
| Fem niveauer foldes, flyttes, slettes uden at miste børn | 19 tests · cyklus-vagt · `deleted_root` |
| XSS-suiten grøn | 32 angreb · hvidliste over tags · **målemetoden set fejle** |
| Historikken har en post pr. gem | ✓ (og ikke ved ændringer, der ikke rører titel/krop) |
| Isolationstesten | kørt igen, udvidet med træ, flyt, duplikér, gendan, omordn |

**76 tests grønne**, også mod payloaden pakket ud af den byggede rune.
Install-script **50.762 / 126.000 tegn (40,3 %)** — F1 kostede 10 procentpoint.

**Rettet undervejs:** en `{once: true}` på kroppens klik-handler gjorde, at man
kunne åbne én blok pr. optegning og derefter ingenting — en fejl, der ville
ligne »editoren går i stå«.

### F2 · Søgning og omni-feltet — **BYGGET 2026-08-20**

Dodas søgepalet, tilpasset noter. **Feltet bor i topbaren på alle skærme**, og
appen starter i det (Andreas' ønske). `/` giver det fokus fra hvor som helst.

**Rækkefølgen er byttet om i forhold til doda, og det er et valg.** I doda skal
ét Enter altid *fange*, fordi appen findes for at fange. Sagu er et arkiv — man
leder langt oftere, end man opretter, og med tusind importerede noter ville en
oprettelse på førstepladsen betyde, at Enter laver en ny note, hver gang man
ledte efter en gammel. Derfor: **træfferne øverst, »Create …« som sidste
række** — altid der, aldrig i vejen. `*` foran flytter den op på
førstepladsen, og uden træffere er den den eneste række, så Enter opretter igen.

Tilstande: `*` ny note · `/` notesbøger · `#` mærker · `+` doda-opgave
(markøren findes fra F2, koblingen bygges i F8 — knappen siger det selv).
Filtre i feltet: `tag:` `in:` `updated:<30d` `has:code|image|link|todo|table`,
`"frase"` og `-uden`. Alt tolkes af `app/shared/soeg.js`, så browserens chips,
serverens søgning og senere wikiens søgning ikke kan komme ud af trit.

**Accept:**

| Krav | Resultat |
|---|---|
| 5.000 noter søges under 100 ms | **3–10 ms** (og faldet tilbage 5 ms) |
| Rangeringen sætter titel-træffere først | ✓ — titel vejer 10× brødteksten |
| Uddraget peger på det rigtige afsnit | ✓ — og ankeret er **samme id**, som rendereren giver overskriften |
| LIKE-jokertegn escapes | ✓ — `%`, `_`, `\` og `%%` returnerer ikke arkivet |

Dertil det, Verdandes spec lagde i kø: **et ord inde i et ord**. `inventory`
finder en note, der kun siger `keepInventory` — indekset kan ikke se det, så
teksten læses i stedet, og feltet **siger det højt** (»no index match — read
the text«), fordi et urangeret resultat ikke skal se ud som et rangeret.

**99 tests grønne**, også mod payloaden pakket ud af den byggede rune.
Install-script **57.827 / 126.000 tegn (45,9 %)**.

**Rettet undervejs:** faldet tilbage joinede `note_fts` på `note_id`, som er
**UNINDEXED** — altså en scanning af hele FTS-tabellen pr. note. Målt på 5.000
noter: **4.297 ms**. Med tre `replace()` i ren SQL i stedet: **9 ms**.
Og FTS5's `snippet()` klipper i den rå kolonne, så uddragene viste
`## Regler` med linjeskift; de renses nu til én læsbar linje, uden at
fremhævningen går tabt.

### F3 · Editor v2 — Notion-følelsen — **BYGGET 2026-08-20**

Kodeblokke med sprogmærke og kopier-knap · billeder (paste, træk, upload) med
lightbox · tabeller · tjeklister · citater og callouts · vandrette streger ·
`[[note-titel]]` med autoudfyldning · backlinks · linkhåndtering · paste af
HTML fra en browser bliver til markdown · »vis som markdown«-panel med
kopier-knap · fuld bredde pr. note · emoji-ikon pr. note og notesbog ·
skabeloner (mødereferat, ugelog, projektnote) · dagens note.

**F4's kerne er trukket frem hertil.** F3's accept kræver billed-upload, og et
billede uden lagring er ikke en funktion. Vedhæftningslaget — tabel, upload,
servering, oprydning — er derfor bygget nu, efter dodas F7-regler ordret. F4
har stadig et indhold: kvote pr. bruger i UI'et, en filliste, `files/` i runens
`wipe` (allerede i YAML'en) og de ikke-billed-vedhæftninger, editoren endnu
ikke tilbyder.

**Accept:**

| Krav | Resultat |
|---|---|
| De ti mest brugte blokke overlever en runde ud og ind | ✓ — kilden er **byte-identisk** efter at være delt i blokke og samlet igen, og ingen linje falder uden for en blok |
| Et 4 MB-foto skaleres i browseren før upload | ✓ — højst 1.600 px, og **PNG bliver PNG** (en JPEG-fallback gør transparens sort) |
| Lightboxen lukkes med Esc og swipe | ✓ — begge målt, plus en synlig lukkeknap, fordi en telefon ikke har Esc |
| SVG må aldrig serveres inline | ✓ — hvidliste på fem rastertyper, aldrig et `image/`-præfiks |
| `../../../etc/passwd` bliver et uskadeligt filnavn | ✓ — og stien på disken er altid hex-id'et |
| Sletning af en note fjerner også dens filer | ✓ — sammen med noten, ikke af en forældreløs-oprydning bagefter |

**121 tests grønne**, også mod payloaden pakket ud af den byggede rune.
Install-script **68.984 / 126.000 tegn (54,7 %)**.

**Rettet undervejs:** `attachments.note_id` er `ON DELETE SET NULL`, så en
hårdslettet note gjorde feltet NULL — og så kunne filen ikke skelnes fra en,
brugeren bevidst havde uploadet uden note. Oprydningen kunne altså ikke gætte
sig til den. Filerne ryddes nu **sammen med** noten. Og en test, der skrev i
databasen efter en `SIGTERM`, bestod alene og fejlede under parallel kørsel:
den venter nu på, at processen faktisk er ude.

### F4 · Filer og vedhæftninger — **BYGGET 2026-08-20**

Kernen kom i F3 (billeder kræver lagring). F4 lukkede resten — og fandt en
defekt, F3 havde indført:

**En vedhæftning, der ikke er et billede, var et dødt link.** `sagu:<id>` er
ikke http(s), så rendereren afviste den *med rette*, og en uploadet PDF blev
til literal tekst `[rapport.pdf](sagu:…)`. Kuren er en **krog** (`linkUrl`)
ved siden af `billedUrl` — ikke en undtagelse i `sikkerUrl`: rendereren må
stadig ikke kende Sagus egne adresser.

Dertil:

- **Vedhæftningsrude på noten** med download, »Insert« og »Remove«. At fjerne
  en fil rører **ikke** teksten — en henvisning til en fjernet fil er en
  kendsgerning om noten, og at redigere brugerens tekst bag hans ryg er værre
  end et dødt link, han selv kan se.
- **Drop-zone på hele noten** med en synlig ramme, plus en filvælger i
  note-menuen, så man ikke *skal* kunne trække.
- **Kvoten håndhæves under uploaden**, ikke kun før den — og fejlen siger
  *hvilken* grænse der blev ramt. »Filen er for stor« er forkert og sender
  brugeren efter et mindre billede, når problemet er, at arkivet er fuldt.
- **Pladsmåler og filliste** i Settings.

**Accept:**

| Krav | Resultat |
|---|---|
| Listerne får kun `attachmentCount` | ✓ — kun den enkelte note får metadata |
| `../../../etc/passwd` bliver uskadeligt | ✓ — og stien på disken er altid hex-id'et, tjekket igen ved læsning |
| Sletning af en note fjerner dens filer | ✓ — sammen med noten, bevist ved at lade `sweep()` køre den rigtige vej |
| 413 **før** forbindelsen lukkes | ✓ — 30 MB mod et 25 MB-loft giver et rigtigt svar, ikke »connection reset«, og den halve fil ryddes op |
| SVG aldrig inline · nosniff · ETag | ✓ |
| Kvote pr. bruger | ✓ — målt med en 3 MB-kvote og en fil, der ikke passer i resten |
| `files/` i runens `wipe` | ✓ — der er en test, der læser YAML'en |

**128 tests grønne**, også mod payloaden pakket ud af den byggede rune.
Install-script **71.607 / 126.000 tegn (56,8 %)**.

**Fundet undervejs, og det er et designspørgsmål mere end en fejl:** CSP'en
(`img-src 'self' data: blob:`) blokerer eksterne billeder. Den strenge CSP er
**rigtig** — på den offentlige wiki ville en note ellers kunne få læserens
browser til at hente fra en fremmed vært, altså spore ham. Men et ødelagt
billedikon forklarer ingenting. Et billede udefra bliver derfor et **synligt
link med en forklaring**, så indholdet ikke går tabt og årsagen kan ses.
F5's import henter dem ned som rigtige vedhæftninger.

### F5 · Import fra Notion — og eksport — **BYGGET 2026-08-20**
**Fasen, der afgør om Sagu bliver taget i brug.**

Notions »Export → Markdown & CSV« giver en zip, hvor hver side er
`Titel <32 hex>.md` og undersider ligger i en mappe med samme navn. Databaser er en
`.csv` **plus** en mappe med én `.md` pr. række.

- **Zip'en læses fra disk**, ikke fra hukommelsen: streaming-upload (F0), egen lille
  ZIP-læser oven på `node:zlib` (central directory + `inflateRaw`), én post ad gangen.
- **Hex-suffikset er ikke støj — det er ID'et.** Titlen er filnavnet uden det; ID'et er
  nøglen, der genopretter **interne links** mellem siderne. Uden det bliver hver
  krydsreference i wikien til en død relativ sti.
- Stier normaliseres med `.normalize('NFC')` og URL-afkodes (`%20`), ellers matcher
  æøå-stier fra en macOS-udpakning ikke deres links.
- **Databaser → én notesbog pr. database.** Hver række bliver en underside; CSV-kolonnerne
  bliver `note_props` og vises som en egenskabstabel øverst i noten. Databasens forside
  genereres som en note med en sorterbar tabel over rækkerne. Det er præcis det, Andreas
  bad om.
- Billeder og vedhæftninger i zip'en lægges i `/data/files` og får deres markdown-link
  skrevet om.
- **Fortæl højt, hvad Notion IKKE eksporterer:** kommentarer, side-historik, synkroniserede
  blokke, indlejrede visninger og relationer (de kommer som tekst). Importen slutter med
  en kvittering: antal sider, databaser, filer — og en liste over det, den måtte springe over.
- Importen kan **køres igen** uden at lave dubletter (matcher på Notion-ID) og kan rulles
  tilbage som ét stykke.

**Eksport samtidig:** hele arkivet som markdown-mapper i en zip · én note/notesbog ·
JSON-rundtur med dodas F9-test: fyld en rigtig server, eksportér, **slet databasen og
filmappen fysisk**, importér igen, og sammenlign felt for felt — og filerne byte for byte.

**Accept:** Andreas' rigtige Notion-eksport går ind, og ti stikprøver ser rigtige ud ·
alle interne links virker · databaserne er blevet til notesbøger med undersider ·
rundturs-testen er grøn.

**Hvad der faktisk skete.** Planen ovenfor byggede på én antagelse, som den
rigtige eksport punkterede med det samme:

> »hver side er `Titel <32 hex>.md` og undersider ligger i en mappe med samme navn«

Filerne, ja. **Mapperne, nej.** I Andreas' eksport har **0 af 97 mapper** et
hex-suffiks — mappen hedder titlen alene, og *afkortet til omkring 48 tegn*.
Koden gættede derfor mappenavnet ud fra id'et, ramte aldrig, og resultatet var
ikke en fejlmeddelelse, men noget værre: hver database-række landede i
opsamlingsbogen »Imported from Notion« i stedet for sin egen notesbog, og hver
databaseforside viste sin tabel **uden et eneste link**. Importen sagde »290
sider« og så vellykket ud.

Kuren er at holde op med at gætte: mapperne, der **findes**, udledes af
stierne, og ejeren findes ved id, når mappenavnet har et, og ellers ved et
præfiks-match på titlen i filnavnsform. Begge former virker nu — Notions
dokumenterede og Notions faktiske.

Den samme afkortning bed én gang til. Databasens `_all.csv` skriver rækkens
**fulde** titel, filnavnet den klippede. Et opslag på filnavnets titel kunne
derfor aldrig finde rækkens side. Forsiden slår nu op på notens rigtige titel
— den fra `# Titel` inde i markdown-filen — med præfiks som reserve.

**Accept:**

| Krav | Resultat |
|---|---|
| Andreas' rigtige eksport (234 MB, 558 filer) går ind | ✓ — **12 notesbøger, 290 sider, 249 filer, 241 links, 109 mærker, 7 sprunget over, på 1,75 s** |
| Databaserne bliver notesbøger med undersider | ✓ — 12 rigtige databaser fik hver sin bog; de 7 *linkede visninger* blev med rette ikke til bøger |
| Rækken ligger i sin egen database | ✓ — 272 af 278 sider opløses ned i en databasemappe; de 6 resterende hører ingen steder hjemme og bliver i opsamlingsbogen |
| Databaseforsiden linker sine rækker | ✓ — **263 af 268 rækker**; de 5 er rækker, hvis side ikke er med i eksporten |
| Interne links genoprettes | ✓ — 241 links; nøglen er hex-id'et, ikke titlen (12 dubletter, én titel seks gange) |
| Importen kan køres igen uden dubletter | ✓ — matcher på `ext_id` |
| Kvittering med det, Notion ikke tager med | ✓ — kommentarer, historik, synkroniserede blokke, relationer |
| Rundturs-testen | ✓ — eksportér, slet database **og** filmappe fysisk, gendan, sammenlign felt for felt og filerne byte for byte |
| Angrebssuiten mod rendereren | ✓ — 27 tests, kørt fordi fasen importerer fremmed indhold |

**155 tests grønne**, også mod payloaden pakket ud af den byggede rune.
Install-script **85.608 / 126.000 tegn (67,9 %)**.

### F6 · Wiki og offentliggørelse — **BYGGET 2026-08-21**
Se afsnit 5 nedenfor — det er fasens indhold og et krav, ikke pynt.

Kernen: `shares` med `mode=single|tree`, pænt slug (`/w/handbook`), valgfrit kodeord
(scrypt, cookie efter korrekt kode, rate-limit, **404** ved ukendt token), valgfri
kommentarer, valgfri udløbsdato, tilbagekald med øjeblikkelig virkning.

**En udgivelse er offentlig som udgangspunkt** — kollegaerne har ingen konti. Kodeordet er
en kontakt på en eksisterende udgivelse: `password_hash` sættes eller ryddes, **`slug` og
`token` røres ikke**. Slår Andreas kodeord til i morgen, virker det link, kollegaerne har
i deres bogmærker, stadig — de bliver bare mødt af en kodeordsside. Det er et krav til
modellen, ikke en detalje: en udgivelse, der skifter adresse, når den beskyttes, er ubrugelig. Offentlige sider
serveres af en **egen skabelon uden app-JS**: navigationstræ til venstre, indhold i
midten, TOC til højre, brødkrummer, »sidst opdateret«, deep-link-ikon på hver overskrift,
kopier-knap på kodeblokke, mørkt/lyst tema, print-venlig, Open Graph-felter.

**Accept:**

| Krav | Resultat |
|---|---|
| Uden kodeord når man intet — heller ikke dybt i træet | ✓ — søgning, feed, ændringsliste og filer svarer **404**; forsiden svarer kun med formularen, og den nævner ikke engang wikiens titel |
| Et tilbagekaldt link dør på næste kald | ✓ — og en **udløbet** udgivelse svarer *ordret* det samme som en ukendt adresse, så man ikke kan aflæse, hvad der har været |
| Den offentlige side henter ingen app-JS | ✓ — målt: præcis to scripts, tema-scriptet (inline, dækket af CSP-hashen) og wikiens egen 4 KB-fil. Ingen `/api/v1/`-adresse står i HTML'en |
| Ingen rute scanner datasættet | ✓ — `shares.slug`/`shares.token`/`notes.parent_id` er indekseret, og **udgivelsens noter beregnes ét sted**, som hver rute spørger |
| Kodeordsforsøg rate-limites | ✓ — 20/kvarter pr. IP **og** 60/time pr. udgivelse. Den anden er den, der bærer: en IP er bare en header bag en proxy |
| Kodeord til/fra rører ikke `slug` eller `token` | ✓ — og et kodeords**skift** lukker de gamle browsere ude, fordi cookien er bundet til hashen |
| Wiki-søgningen dækker titel, overskrifter, brødtekst, mærker | ✓ — **samme funktion som appens**, afgrænset til det udgivne træ. Uddrag med fremhævning, og linket hopper til **afsnittet** |
| Fremmed markdown kan ikke blive til et tag | ✓ — angrebssuiten kørt (fasen rører rendereren), plus en test, der parser de rigtige tags på hele den offentlige side |

**182 tests grønne**, også mod payloaden pakket ud af den byggede rune.
Install-script **100.961 / 126.000 tegn (80,1 %)** — F6 kostede 12,2 procentpoint.

**Begge vagter er set fejle.** Sabotér låsen → 3 røde; sabotér udgivelsens
id-liste → 1 rød. Netop dét afslørede et hul i mine egne tests: en fil på en
note **uden for** udgivelsen var slet ikke dækket, så id-filteret kunne fjernes,
uden at noget blev rødt. Testen findes nu, og den er set fejle.

**Ud over det aftalte:** ændringsfeed med Atom, visningstal pr. side, og
listen over **det, læserne ledte forgæves efter** — den blev logget allerede i
F2, men kunne ikke ses nogen steder, og en funktion, man ikke kan se, findes
ikke for brugeren.

**Det fra afsnit 5, der IKKE er bygget** (og hvorfor):

| | |
|---|---|
| »Foreslå en rettelse« | er en kommentar med et diff-forslag → **F7** |
| Aliaser pr. side og fæstnede svar | to nye felter og en redigeringsflade hver → **F13** |
| Forsiden som kort-grid med »Start her« og »Mest læste« | forsiden er notens egen tekst nu; grid'et er en visning oven på den → **F13** |
| »Hent hele wikien som markdown-zip« | eksport-motoren findes (F5), men skal afgrænses til udgivelsens noter → **F13** |
| Flere kodeord pr. site | modellen kan bære det (én række pr. kodeord), men ingen har brug for det endnu |
| Fuzzy fald tilbage på titler | præfiks-match og »ord inde i ord« dækker i praksis; fuzzy er en ny motor |

### Rettet efter F6, på første brugsdag — **2026-08-21**

Fem ting, som kun kom frem, fordi appen blev brugt på rigtige data. Hele
historien står i `DESIGN.md` §10b:

| Fundet | Hvad det var |
|---|---|
| »0 of them are pages you can open« | Arkivet var importeret **før** F5's rettelse, og en genkørsel rettede kun teksten, aldrig placeringen. Genimporten flytter nu siderne på plads og **tæller** flytningerne |
| `._Vigtige informationer` i sidebaren | macOS' AppleDouble-tvillinger bar **samme Notion-id** som de rigtige sider og overskrev dem: 297 tomme noter i stedet for arkivet |
| »Der mangler en loader« | Uploaden havde ingen fremdrift, og serveren kunne slet ikke svare, mens den importerede. Nu: rigtig procent på uploaden, ubestemt bjælke hvor serveren er optaget, og en **ægte** bjælke under importen |
| »Jeg kan ikke oprette tags med #« | Mærkerne fandtes i modellen, men der var ingen vej til at sætte et — og Tags-skærmen sagde stadig »arrives in F3«. Tre veje ind, én regel |
| Sidebaren var en mur | Notesbøgerne har fået deres egen sektionsoverskrift med en fold. Import & export og temaknappen er flyttet derhen, hvor de hører til |

### Bygget efter F6, på Andreas' ønske — **2026-08-21**

`DESIGN.md` §10c har detaljerne:

- **En hel notesbog kan udgives** (migration m7). Forsiden er genereret: stort
  søgefelt, kort pr. side, de fem senest rørte. Globus på notesbogen i
  sidebaren, samme ikon som på en side.
- **Wikiens søgefelt er levende** — træffere mens man skriver, med tastatur —
  og går på udgivelsens egen adresse, ikke gennem app-API'et.
- **Mærker er rigtige ting:** tre veje ind, én regel, og de forsvinder ikke af
  sig selv.
- Flyt en note mellem notesbøger · foldbar notesbogs-sektion · import og tema
  flyttet derhen, hvor de hører til.
- **Træk noter rundt i sidebaren med musen**, plus Move up/down og »gør den til
  underside af X« i menuen — den vej, der også virker med tastatur og finger.
- **En uendelig løkke efter en import** gentegnede siden, så kvitteringen
  forsvandt: målt 409 `state`-kald på tre sekunder, nu ét.
- Wikiens forside beskåret til det, en forside skal være · »Never expire« på
  udgivelsens datofelt, som Safari ikke lader dig rydde · synlig
  »← Front page« på hver wiki-side.
- **Importen laver nu notesbøger af topsider med undersider**, ikke kun af
  databaser — en Notion-wiki er en side med et træ under sig. Og
  opsamlingsbogen laves først, når en side skal ligge i den.
- **Importens interne links virkede ikke** — `sagu-note:` blev aldrig oversat,
  hverken i appen eller på wikien. Kvitteringen sagde 241; facit var nul. Målt
  efter rettelsen: **281 virkende links**, og de 16 tilbage peger på filer, der
  aldrig var i eksporten.

### F7 · Kommentarer — **BYGGET 2026-08-21**

I appen og på de offentlige sider. Tråde i ét niveau, redigér/slet, moderationskø.
Kommentar-modellen bærer også »foreslå en rettelse« i wikien (`kind: suggestion`).

**Én model, to veje ind — og forskellen bor ét sted** (`opretKommentar`). En bruger
skriver som sig selv og er udgivet med det samme; en **gæst** på wikien har hverken
konto eller ansigt, og hans kommentar lander i køen. `origin` står ved siden af
`share_id`, så en tilbagekaldt udgivelse ikke kan gøre en gæstekommentar til ejerens
egen (F3's `SET NULL`-lektie).

**Spam: fire spærrer.** Moderationskø som standard · honningkrukke, der får samme
kvittering som alle andre · rate-limit 10/time pr. IP **og** 60/time pr. udgivelse ·
og **en gæstekommentar med et link modereres altid**. Det sidste afviger fra planens
ordlyd med vilje: at afgøre, hvem der er »ukendt«, kræver at man gemmer noget om den
besøgende, og wikien måler kun tal, aldrig personer. Se `DESIGN.md` §14.

**Wikien har stadig ingen app-JS.** Formularen er ren HTML, et svar er et link
(`?reply=<id>`), og POST → omdirigering → GET. Kommentarteksten går gennem samme
renderer som noterne, med krogene slået fra og `rel="nofollow ugc"` på links.

**Web-push er udskudt til F13, og det er et valg.** Sagu har ingen service worker,
så push ville betyde at bygge PWA-stakken først — og browserpanelet kan ikke
registrere service workers, så registreringen kunne ikke verificeres. En påstand er
ikke en funktion. I stedet: **et tal i navigationen**, en Comments-skærm med
Waiting/Published/Rejected, og tallet i udgivelsesruden med ét klik til køen.

**Accept:**

| Krav | Resultat |
|---|---|
| En gæstekommentar vises ikke, før den er godkendt | ✓ — heller ikke som et antal; kvitteringen siger det ærligt |
| Honningkrukken tier | ✓ — samme kvittering, intet gemt |
| Rate-limit | ✓ — højst ti slipper igennem, så træder spærren i kraft |
| En gæst kan ikke ramme en note uden for udgivelsen | ✓ — og heller ikke en notesbogs genererede forside |
| En låst wiki tager ikke imod kommentarer | ✓ — 404, ikke en formular uden virkning |
| Isolationen | ✓ — 404 på se, skrive, rette, moderere og slette; køen er ens egen |
| Scopes | ✓ — `capture` kan ikke læse, `read` kan ikke skrive |
| Fremmed markdown kan ikke blive til et tag | ✓ — 10 angreb, målt på den **færdige side**, ikke kun på rendereren |
| Et link i en kommentar giver ikke vægt videre | ✓ — `nofollow ugc`; notens eget link får det ikke |
| Den offentlige side henter stadig ingen app-JS | ✓ |

**217 tests grønne.** Install-scriptet er uændret 1.640 tegn (koden hentes);
payloaden ville indlejret være **117.925 tegn = 93,6 %** — F7 alene kostede 6,8
procentpoint, og det er præcis derfor udvejen blev taget først.

**Rettet undervejs — en fejl fra F6, som F7 gjorde synlig:** wikiens grid stod på
kildeordenen. Uden navigation (en udgivelse med én side) rykkede indholdet op i
navigationens 240 px-spor, mens sideoversigten fik de 748. Hver enkelt-side-udgivelse
har set sådan ud siden F6, uden at noget fejlede. Placeringen er nu eksplicit.

### F8 · doda-integration (den vigtigste) — **SAGUS HALVDEL BYGGET 2026-08-21**

Bygget i Sagu: forbindelsen (adresse + nøgle, personlig, nøglen forlader aldrig
serveren, prøvet før den gemmes) · `+` i søgefeltet sender en opgave fra enhver skærm ·
opgaveruden på noten med status · og et nyt **`link`-scope** (read+capture, aldrig
slette), som er præcis den rettighed, en søsterapp skal have. Hele historien i
`DESIGN.md` §16 — inklusive den fejl, en rigtig doda fandt: et link hængt på enden af
en linje bliver ædt af `!`-markøren, så både linket og datoen forsvandt uden at noget
fejlede.

**Dodas halvdel er ogsaa bygget** (i doda-repoet, 2026-08-21): `app/sagu.js`, søgning i
Sagu inde fra doda, en note oprettet i den rigtige notesbog med link tilbage, notens
kommentarer vist på opgaven, og en ekstra række i paletten på `*`. Detaljerne står i
dodas `DESIGN.md` under »Sagu-broen« — inklusive to fund: ruten `notion/refresh` måtte
skifte navn, da den også svarede for Sagu, og **formen** på adressen skal afgøres før
forbindelsen, ellers spørger doda Notion om et Sagu-id.

Bemærk: doda ramte payload-loftet på samme dag (97 %) og tog **samme udvej** — men
dodas repo er privat, så den koster et token i en `secret: true`-variabel.


**Fra doda mod Sagu** — ny `app/sagu.js` ved siden af `notion.js`, som genbruger dodas
**generiske** `link_url`/`link_title`-felter (de blev bevidst ikke døbt `notion_url`):
søg i Sagu inde fra doda · hæng en note på en opgave, en note eller et projekt · hent den
rigtige titel · vis notens kommentarer · **`*` i fangstfeltet opretter en Sagu-note** med
link begge veje. Notion-modulet bliver stående bag en indstilling, indtil Andreas siger,
at migreringen er kørt færdig.

**Fra Sagu mod doda** — `+` i søgefeltet opretter en doda-opgave · en tjekliste-linje i en
note kan sendes til doda som opgave · noten viser opgavernes status ved opslag med et
tidsstempel (aldrig et kald pr. optegning) · »projektets noter« hentes ud fra dodas
projekt-id.

tovo får kun det generiske: en note kan linke til et tovo-projekt. Intet mere.

**Accept:** en note oprettet fra doda står i den rigtige notesbog med link tilbage ·
Sagu er nede → doda viser det som en chip med en pæn fejl, ikke som en fejlet gemning ·
nøglen i doda har `read`+`capture`-scope og kan ikke slette noter.

### F9 · API og iPhone-genveje — **BYGGET 2026-08-21**
Nøgler med scopes (`read`, `capture`, `full`) pr. bruger, hash-lagret, `sidst brugt`-stempel,
øjeblikkelig tilbagekaldelse. Endepunkter, der kan bruges **uden cookie** og med ren tekst,
formulardata eller `?text=` (dodas F2-mønster — genveje er dårlige til JSON):
`POST /api/v1/capture` (ny note eller tilføj til dagens note) · `GET /api/v1/notes/:id?format=md`
· søgning · billed-upload fra delingsmenuen · `GET /api/v1/changes?since=` med slettede id'er.
Indbygget dokumentationsside (dodas `p9_guide`) med færdige genvejsopskrifter.

**Accept:**

| Krav | Resultat |
|---|---|
| Hele scope-matricen målt **uden cookie** | ✓ — med en session godkender serveren alting, og scope-tjekket ser ud til at virke, selv hvis det aldrig blev kaldt |
| En `capture`-nøgle kan ikke læse | ✓ — 403 på note, søgning, liste, `changes` og `format=md`. En mistet telefon når ikke arkivet |
| Ingen nøgle kan lave nøgler eller skifte kodeord | ✓ — 401 for alle fire scopes, også `full`. Auth-ruterne står uden for »ét API, to legitimationer« |
| De fire veje ind | ✓ — JSON, formulardata, ren krop og `?text=`. Og en krop, der *påstår* at være formulardata, tages som tekst |
| Dagens note | ✓ — `to=today` samler dem ét sted, i rækkefølge; `?date=` lader telefonen sige, hvornår i dag er |
| Billede fra delingsmenuen | ✓ — bliver en note med billedet i, med en `capture`-nøgle |
| `changes` med slettede id'er | ✓ |
| Guiden | ✓ — og en **formregel** slår hver metode og adresse op i serverens ruter, så den ikke kan love noget, appen ikke har |

**266 tests grønne.** Payloaden ville indlejret være **127.927 tegn = 101,5 %** af det
gamle loft — F9 alene ville have sprængt det. Detaljerne i `DESIGN.md` §17.

### F10 · MCP-server og claude.ai-connector — **BYGGET 2026-08-21**
Ni værktøjer over JSON-RPC (`create_note`, `search_notes`, `get_note`, `append_note`,
`update_note`, `list_notebooks`, `list_tags`, `add_comment`, `publish_note`) og hele
OAuth 2.1-flowet, så claude.ai's webklient forbinder sig selv gennem en samtykkeside.
`app/oauth.js` er porteret næsten ordret fra doda; kun tabellerne, samtykkesiden og
ruterne er Sagus egne.

**Accept:**

| Krav | Resultat |
|---|---|
| Dodas MCP-tests overført og grønne | ✓ — 25 i `tests/mcp.test.mjs`, plus 21 for connectoren |
| Fremmed `Origin` afvist (DNS-rebinding) | ✓ — 403; vores egen slipper igennem |
| En `capture`-nøgle ser præcis ét værktøj | ✓ — og `link` ser aldrig et, der skriver |
| Scopet håndhæves også ved kaldet | ✓ — listen er en hjælp, ikke en spærring |
| Hele OAuth-flowet | ✓ — opdagelse → registrering → samtykke → kode → token → `/mcp`, med PKCE S256, engangskode og roterende refresh |
| Forbindelsen kan lukkes | ✓ — både token og refresh dør med det samme; »Connected apps« i Settings |
| **Flerbruger** | ✓ — en forbindelse hører til den, der godkendte den; en tilbagekaldelse rører kun ens egen |
| En connector kan ikke lave nøgler eller skifte kodeord | ✓ — 401 på `/api/v1/keys` og `/api/v1/connections` |

**313 tests grønne**, 12 sabotager set fejle. Detaljerne i `DESIGN.md` §18.

### F11 · Deling mellem brugere — **BYGGET 2026-08-21**
`note_acl` med `read`/`write` og `tree`, »delt med mig«-visning, deling af et helt
undertræ, ejerskifte og kommentarer på tværs. Filteret ligger i dataadgangen, ikke i
visningerne — og **arven regnes af det levende træ**, så der er intet at holde i takt,
når nogen laver en underside eller flytter en.

**Accept:**

| Krav | Resultat |
|---|---|
| En note delt til læsning kan **ikke** gemmes | ✓ |
| ... kan ikke slettes | ✓ — og heller ikke med `write`. At skrive er ikke at bestemme |
| ... kan ikke offentliggøres | ✓ — heller ikke med `write`; »bagefter« er for sent for noget offentligt |
| ... og dens vedhæftninger kan **hentes, men ikke byttes** | ✓ — ellers står en delt side med huller, hvor billederne skulle være |
| Isolationstesten udvidet | ✓ — 25 tests i `tests/deling.test.mjs` ved siden af de 14 i `isolation.test.mjs` |
| Undertræet følger med | ✓ — også undersider lavet **bagefter**; flyttes en note ud, forsvinder adgangen med det samme |
| »Delt med mig« | ✓ — kun **toppen** af hvert træ, med hvem det kom fra |
| Ejerskifte | ✓ — hele undertræet, ud af den gamle ejers notesbog, og den gamle beholder `write` |
| Kommentarer på tværs | ✓ — også med `read`: at kommentere er ikke at ændre noten |
| Kun ejeren deler videre | ✓ — og deling kræver en **session**, ikke en nøgle |

**338 tests grønne**, 15 sabotager set fejle — og én sabotage uden røde, som afslørede
en kolonne i søgeindekset, ingen læste (m12). Detaljerne i `DESIGN.md` §19.

### F12 · GitHub i noter — **BYGGET 2026-08-21**
En GitHub-fil-URL på sin egen linje bliver til koden; issue- og PR-links bliver til chips.

**Accept:**

| Krav | Resultat |
|---|---|
| Server henter via GitHub-API, token som `secret: true` | ✓ — personligt pr. bruger, prøvet før det gemmes, forlader aldrig serveren |
| **Fryser commit-sha'en** ved indsættelse | ✓ — og sha'en står i TEKSTEN, så den overlever eksport og gendannelse |
| Sti + linjeinterval + opdatér + kopiér + link | ✓ — med linjenumre, der passer til filen, ikke til udsnittet |
| Issue- og PR-links som chips med titel og status | ✓ — og **flettet** skelnes fra **lukket**; `state` alene kan ikke se forskel |
| ETag-cache | ✓ — 304 koster hverken kvote eller båndbredde; en frossen fil spørges der slet ikke om igen |
| Rate-limit | ✓ — 300 opslag i timen pr. bruger, og GitHubs egen kvote meldes med *hvornår* den er tilbage |
| Pæn fejl når repoet er privat og tokenet mangler | ✓ — beskeden nævner **begge** betydninger af 404 |
| På wikien | ✓ — **kun fra cachen**; en fremmed kan ikke bruge ejerens kvote op |

**22 tests**, 13 sabotager set fejle. Detaljerne i `DESIGN.md` §20.

### F13 · Polering og udgivelse — **BYGGET 2026-08-21**

| Punkt | Resultat |
|---|---|
| Tastaturgenveje | ✓ — ét bord, og oversigten (`?`) er **genereret** af det, så den ikke kan drive |
| Favoritter og »senest besøgte« | ✓ — begge er brugerens, ikke notens; læses gennem `SYNLIG` |
| Ikoner og manifest | ✓ (F0) |
| README med versionshistorik | ✓ |
| Installationstest på Hjorten | ✓ — v1 kørte 2026-08-21, 154 ms |
| Cloudflare-cache-fælderne | ✓ (F0: `app.js?v=N` stemplet af build'et, HTML `no-store`) |
| RUNE-ERFARINGER opdateret | ✓ — efter hver fase |
| Migreringen af Notion-wikierne | **ikke kode.** Importen (F5) og udgivelsen (F6) er der; selve flytningen er Andreas' |

**10 tests**, 8 sabotager — hvoraf tre først gav nul røde og afslørede tre for svage
tests. Detaljerne i `DESIGN.md` §21.

---

## 5 · Wiki'en skal være bedre end Notions

Andreas' klagepunkt er konkret: Notions wiki-søgning finder reelt kun overskrifter.
Sagus wiki-søgning er derfor en **funktion i sig selv**, ikke et felt.

**Søgningen**
- Indekset dækker **titel, overskrifter, brødtekst, tags, egenskaber og filnavne** — og
  vægter dem i den rækkefølge (FTS5 `bm25()` pr. kolonne, eller samme vægte i fallbacken).
- Resultatet er et **uddrag med fremhævning**, en brødkrumme, og et link, der hopper til
  **afsnittet** — ikke til toppen af en lang side. Det alene er forskellen på Notions.
- Skrivefejl må ikke være en blindgyde: automatisk præfiks-match (`drif` → `drift*`) og
  et fuzzy-fald tilbage på titler og tags.
- Filtre i feltet: `tag:`, `in:<underside>`, `updated:<30d`.
- **Aliaser pr. side** (»kendes også som«): kollegaen søger på et andet ord end forfatteren
  brugte. To linjer kode, stor effekt.
- **Fæstnede svar:** ejeren kan binde et søgeord til en side (»VPN« → denne).
- **Tomme søgninger logges** (kun ordet, aldrig hvem). Listen »det, folk søgte efter uden
  at finde noget« er den bedste indholdsplan, en wiki kan få.
- Søgningen dækker **kun det publicerede undertræ** og slår op i et indeks — den scanner
  aldrig, og den kan aldrig lække en note, der ikke er delt.

**Resten af wikien**
- Tre paneler: navigationstræ, indhold, sideoversigt. Brødkrummer, forrige/næste side.
- **»Sidst opdateret« + ejer pr. side**, og et diskret mærke, når en side er blevet gammel
  (»ikke rørt i 11 måneder«). En arbejdswiki dør af forældet indhold, ikke af manglende indhold.
- **Sider, der henviser hertil** (backlinks) nederst — kollegaerne finder vej sidelæns.
- **Foreslå en rettelse**: en læser kan sende et forslag uden at have en konto; det lander
  i moderationskøen som en kommentar med et diff-forslag.
- Forsiden er ikke bare en note: kort-grid med emoji-ikon og en linje pr. underside,
  plus »Start her«, »Senest opdateret« og »Mest læste«.
- **Ændringsfeed** (`/w/<slug>/changes` + Atom), så kollegaer kan følge med.
- Deep-link-ikon på hver overskrift, kopier-knap på hver kodeblok, print/PDF-venlig visning,
  mørkt tema, og »hent hele wikien som markdown-zip«.
- Visningstal pr. side (kun tal, ingen personer) — så man kan se, hvad der faktisk bruges.
- Flere kodeord pr. site, hvis wikien deles med to grupper: ét kan trækkes tilbage alene.
- Tastatur: `/` søger, `g h` går hjem, piletaster i resultatlisten.

---

## 6 · Risici

| # | Risiko | Håndtering |
|---|---|---|
| **R1** | ~~**Payload-loftet.** doda er på 95 % og er mindre end Sagu.~~ **Lukket 2026-08-21.** | Målt i F0, før der blev bygget funktioner. Da udløseren blev passeret efter F6, skiftede install-scriptet til at **hente** app-koden fra GitHub: 1.640 tegn, konstant. Ny og mindre risiko i stedet: en installation kræver net, og en udgivelse kræver en tag. |
| **R2** | **FTS5 findes måske ikke** i Node's SQLite. | Måles i F0. Fallback-tokentabel designes samtidig. |
| **R3** | **Rune-til-rune-netværk** mellem Sagu og doda. | Måles i F0. Faldet tilbage er URL + nøgle, som virker uanset topologi. |
| **R4** | **XSS.** Sagu renderer fremmed markdown på et **offentligt** domæne. | Egen renderer med whitelist, ingen rå HTML, angrebssuite som fase-krav i F1, F3, F5 (importeret indhold!) og F6. |
| **R5** | **Zip-import af hundredvis af MB.** | Streaming til disk i F0, egen ZIP-læser, én post ad gangen, aldrig hele filen i hukommelsen. |
| **R6** | ~~**Offentlig spam** i kommentarer.~~ **Lukket 2026-08-21 (F7).** | Moderationskø som standard, honeypot, rate-limit i to lag (IP og udgivelse), længdegrænse, og links modereres altid. Hver spærre er set fejle. |
| **R7** | **Store noter i lister.** Kokkeris 247 MB login-svar. | Lister henter aldrig `body_md` — kun titel, mærker og tællere. |
| **R8** | **Omfanget.** 14 faser er projektets største. | Hver fase er udgivelsesklar for sig. Wiki'en kan tages i brug efter F6, længe før F12. |

---

## 7 · Vurdering af de ønskede funktioner

| Funktion | Værdi | Indsats | Bemærkning |
|---|---|---|---|
| doda-integration begge veje | ★★★ | Middel | Billigere end Notion-integrationen: samme maskine, ingen fremmed API-version, ingen »har du husket at dele siden?«. |
| Notion-import med databaser | ★★★ | Stor | Uden den bliver Sagu ikke taget i brug. Zip-læseren og ID-matchningen er det svære. |
| Wiki med rigtig søgning | ★★★ | Stor | Sikkerheden er det dyre, ikke visningen. |
| Hybrid markdown-editor | ★★★ | Middel | Det valg, der gør ni andre funktioner billige. |
| API til iPhone-genveje | ★★★ | Lille | Mønstret ligger færdigt i doda. |
| MCP-server | ★★★ | Lille | §9a er skrevet. |
| Sideoversigt i højre kant | ★★ | **Ingen** | §9b findes ordret. |
| Kodeblokke, billeder, links, tags | ★★★ | Middel | Kernen i »de normale andre ting«. |
| Kommentarer | ★★ | Middel | Offentligt er det moderationen, der koster. |
| Deling mellem brugere | ★★ | Middel | Skal med fra modellens start, selv om UI'et kommer i F11. |
| GitHub-embeds | ★ | Middel | Sjovt og synligt, men ingen bruger det dagligt. Sidst. |
| **Realtids-samredigering** | ★ | **Urealistisk** | CRDT uden pakker. **Frarådes.** Konfliktvagt + versionshistorik dækker behovet. |
| **Krypterede noter** | ★ | Stor | Frarådes: nøglehåndtering, og søgning, MCP og wiki holder op med at virke. |

## 8 · Funktioner, du ikke bad om, men som hører til

1. **Versionshistorik med gendan.** En wiki uden fortrydelse er farlig. Billig, når
   markdown er sandheden. *(F1 i data, UI i F13.)*
2. **Papirkurv med 30 dages frist** — og »gendan hele undertræet«.
3. **Skabeloner** (mødereferat, ugelog, projektnote) og **daglig note**. Passer til
   dit GTD-flow, og gør »hurtigt et sted at skrive« til én tast.
4. **Web-clipper som bookmarklet** — samme mønster som `servicenow-to-md`: markér på en
   side, klik, og teksten ligger i Sagu som markdown med kildehenvisning. Billig, dagligt brugt.
5. **Backlinks og »unlinked mentions«** — noter, der nævner denne notes titel uden at linke.
6. **Ejer og gennemgangsstempel pr. side** (som dodas gennemgang), så wiki-indhold kan
   holdes friskt i stedet for at rådne.
7. **Sagu-ændringsfeed i doda:** de noter, du har rørt i dag, kan læses i dodas logbog.
8. **»Kopiér som rich text«** ved siden af »kopiér som markdown« — så en note kan
   indsættes i Outlook eller Teams uden at se ud som kildekode.
9. **Masse-handlinger**: flyt/mærk/slet flere noter, og »flyt notesbog til en anden bruger«.
10. **Notifikationer** (web-push, dodas stak): ny kommentar, ændring i en delt note.
11. **Statisk arkiv-eksport**: hele wikien som en zip med færdig HTML — en kopi, der kan
    læses om ti år uden Sagu.

## 9 · Ikke i scope

Realtids-samredigering · ende-til-ende-kryptering · indlejrede databaser med formler og
relationer (Notion-databaser importeres som notesbøger med egenskaber, ikke som en
database-motor) · kalender- og tavlevisninger · AI-funktioner inde i appen (MCP dækker
det udefra) · synkronisering med doda eller tovo · mobilapp (PWA, ikke App Store).

## 10 · Åbne spørgsmål

1. ~~**Adressen.**~~ **Afklaret 2026-08-21:** Sagu kører på `sagu.<mit-domaene>`, og
   `sagu.dk` peges på den samme container. Derfor er den offentlige adresse blevet et
   **felt i indstillingerne** — den bestemmer, hvad publicerede links skrives med, og
   hvad søgemaskiner får at vide er den rigtige adresse (`DESIGN.md` §15).
2. **Notion-eksporten.** F5 kan ikke bygges færdig uden en rigtig eksport fra din konto,
   inklusive mindst én database. Den skal bruges, når vi når dertil.

*Afklaret 2026-08-20: engelsk interface som doda · kollegaerne får ikke logins, wikien er
offentlig, og kodeord kan slås til senere uden at linket skifter.*
