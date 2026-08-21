# Sagu — trufne beslutninger

> **Alle beslutninger bor her.** Ændres noget, rettes det **i denne fil først**
> og derefter i koden. Kravkilden er `docs/HANDOVER.md`; faseoversigten er
> `SAGU-PLAN.md`; de fælles lærepenge er `~/ClaudeMacBook/RUNE-ERFARINGER.md`.

Oprettet i F0, 2026-08-20.

---

## 1 · F0's fire målinger

F0's egentlige formål. Alt herunder er **målt**, ikke antaget — og hver måling
siger, hvad den betyder for resten af projektet.

### Måling 1 · Payload-budgettet

**Spørgsmålet:** doda ligger på 95,6 % af `MAX_ARG_STRLEN` og er en *mindre*
app end Sagu. Er der plads til fjorten faser?

**Metoden.** `python3 build_rune.py --budget` kører en leave-one-out: hver fil
udelades på skift, og forskellen i det færdige install-script er filens
*virkelige* pris. Rå filstørrelse siger næsten intet.

**Målt på F0-skelettet (2026-08-20):**

| | |
|---|---|
| Install-script | **36.984 / 126.000 tegn — 29,4 %** |
| Tar før komprimering | 122.880 b |
| Efter brotli q11 + base85 | 35.758 tegn |
| Kommentar-strip sparer | **12.160 tegn = 25,4 %** |

Pris pr. fil:

| Fil | Koster | Af rå størrelse |
|---|---|---|
| `app/server.js` | 14.528 tegn | 21 % af 67.757 b |
| `app/public/app.js` | 10.524 tegn | 24 % af 43.466 b |
| `app/public/style.css` | 6.234 tegn | 34 % af 18.297 b |
| `app/webauthn.js` | 2.241 tegn | 22 % af 10.075 b |
| `app/public/icon-192.png` | 298 tegn | **133 %** af 224 b |
| `app/public/index.html` | 295 tegn | 27 % |
| `manifest.webmanifest` | 135 tegn | 52 % |

**Tre ting bekræftet med tal:**

1. **Kommentar-strip betaler sig her.** Erfaringsfilens §2 kalder den »den
   risikable vej med den mindste gevinst« — det var Kokkeris 0,8 %. doda målte
   24 %, Sagu måler **25,4 %**, fordi begge skriver begrundelser i koden.
   *Mål det på dit eget projekt, før du tror på et andet projekts procent.*
2. **Alt binært koster over 125 % af sin vægt.** Ikonet er 224 b og koster 298
   tegn. Derfor er det en **palet-PNG med 1 bit pr. pixel, tegnet af
   `build_rune.py`** med `zlib` + `struct` — ingen PIL, ingen binær fil i
   repoet. dodas truecolor-ikon kostede 2.817 tegn; Sagus koster 298.
   **Sparet: ~2.500 tegn, gratis.**
3. **Marginalprisen er ~0,21 tegn pr. byte kildekode** (doda: 120.397 tegn for
   573 KB kilde). Sagu F0 ligger på 0,26, fordi brotlis ordbog arbejder
   dårligere på et lille korpus — prisen falder, efterhånden som appen vokser.

**Konklusionen, og den er ubehagelig.** Loftet på 126.000 tegn svarer til
**~600 KB kildekode** — altså omtrent præcis dodas nuværende størrelse. Et
realistisk skøn over F1–F13 (editor, wiki, Notion-import, kommentarer, MCP,
GitHub) er ~490 KB oven i F0's 141 KB, altså **~634 KB ≈ 133.000 tegn.**

**Sagu passer ikke i et indlejret install-script hele vejen til F13.**
Det er ikke et gæt, det er hvad tallene siger, og derfor skulle det måles nu.

**Den dokumenterede vej — og den er målt, ikke foreslået.**

Rune-skemaet siger, at install-scriptet »runs as root via `/bin/sh -c`« (deraf
loftet), og at scriptet **må hente over nettet** — panelets egen
Minecraft-opskrift gør det med `curl`. Så app-koden behøver ikke ligge *i*
scriptet.

Målt 2026-08-20 mod et af Andreas' egne offentlige repoer:

```
GET https://codeload.github.com/andreasdinesen/bogreolen/tar.gz/refs/heads/main
  → 200, 210.985 b, uden token
tar xz --strip-components=1 <prefix>/app   → pakker kun app/ ud
```

Et install-script, der henter i stedet for at bære:

```sh
set -eu
echo "Installerer Sagu v1 ..."
echo "Node: $(node --version)"
wget -qO- https://codeload.github.com/andreasdinesen/sagu/tar.gz/refs/tags/v1 \
  | tar xz --strip-components=1 sagu-1/app
```

**233 tegn — uafhængigt af hvor stor appen bliver.** Det er `tools`-runens
mønster (RUNE-ERFARINGER, tools v1), hvor install-scriptet blev 41 % af loftet,
selv om ét værktøj alene fyldte 4,2 MB.

**Beslutning:**

- **Bliv ved den indlejrede payload indtil videre.** Den virker offline, kræver
  ingen GitHub-adgang ved installation, og der er 89.000 tegn tilbage.
  *(Gjaldt til 2026-08-21 — se »Udvejen er taget« nedenfor.)*
- **`build_rune.py` rapporterer procenten efter hver kørsel** (CLAUDE.md), og
  `--budget` viser hvor pladsen gik, den dag det strammer. Loftet tjekkes
  bevidst **til sidst** i build'et, så `--budget` stadig kan køre, når det
  fælder.
- **Udløseren er 110.000 tegn (87 %).** Derefter skiftes til hente-varianten.
- **Skiftet koster ingen app-kode.** Det er én funktion i `build_rune.py`
  (`install_script`), ikke en arkitektur-beslutning. Derfor må ingen fase
  designes *omkring* pladsen — men ingen fase må heller lade være med at måle.
**404, ikke 403** — GitHub skelner ikke mellem »findes ikke« og »du må ikke se
den«. Målt 2026-08-20 og igen 2026-08-21:

```
codeload  andreasdinesen/doda       (privat)  → 404 uden token
codeload  andreasdinesen/sagu       (findes ej) → 404
codeload  andreasdinesen/bogreolen  (public)  → 200
```

Et fine-grained token, der ikke har fået netop dette repo tilføjet enkeltvis,
svarer det samme. Fejlbeskeden **skal nævne begge muligheder**, ellers
fejlsøger man et token, der er helt i orden (RUNE-ERFARINGER, tools v1). Der
er en test på præcis det.

### Udvejen er taget — 2026-08-21

**Udløseren blev passeret.** Efter F6 lå install-scriptet på **111.352 tegn
(88,4 %)**, altså over de 110.000, og F7 lægger kommentarer oveni. Runen
henter derfor app-koden i stedet for at bære den.

**Repoet er OFFENTLIGT** (Andreas, 2026-08-21) — mod at intet følsomt følger
med. Beslutningen afløser »privat« fra 2026-08-20 og gør udvejen *billigere*:
ingen `GITHUB_TOKEN`, ingen `secret: true`-variabel, ingen
Authorization-header. Hvad auditten fandt og fjernede, står i §13.

| | |
|---|---|
| Install-script før | 111.352 tegn (88,4 %) |
| Install-script efter | **1.640 tegn (1,3 %)** — og konstant, uanset appens størrelse |
| Runens YAML | 242.624 b → **5.610 b** |
| Payloaden, hvis den var indlejret | 109.337 tegn (86,8 %) — bygges stadig, se nedenfor |

**Hvert valg i scriptet, og hvorfor:**

- **Node henter — ikke `wget`.** Node *er* install-imaget og er garanteret til
  stede; busybox' `wget` og dens TLS er ubevist. Node pakker samtidig gzip'en
  ud med `zlib`, så `tar` kun skal kunne det, den allerede gør i dag: `tar x`.
  Ingen `-z`, ingen `--strip-components`, ingen wildcards — **hver ekstra
  tar-funktion er en antagelse mere om busybox.**
- **Der pakkes ud i en frisk mappe, som byttes ind** (tools v1). `rm -rf app`
  står i **både** install og update: tar overskriver, men fjerner ikke filer,
  der er slettet i en ny version. Alt midlertidigt ligger i `/tmp`, så
  datamappen aldrig røres — og en halv hentning kan aldrig efterlade et halvt
  `app/`.
- **Mappenavnet gættes ikke.** GitHub kalder rodmappen `<repo>-<ref uden v>`
  og lægger en `pax_global_header`-post forrest. Scriptet leder efter den
  `app`-mappe, der **findes** (`find -maxdepth 2 -type d -name app`), og
  fælder, hvis der ikke er en `server.js` i den. Det er F5's lærestreg brugt
  et nyt sted: *udled strukturen af de stier, der findes.*
- **Adressen er en TAG, ikke en gren.** `refs/tags/v<N>` — så installerer rune
  v3 præcis v3's kode, også om et år. Prisen er ét trin mere ved udgivelse:
  `git tag vN && git push --tags`. Glemmes det, siger install-scriptet det
  **højt** frem for at installere noget andet.
- **Payloaden bygges stadig.** Rundturs-tjekket beviser fortsat, at kilderne
  kan pakkes og pakkes ud igen; `--budget` svarer fortsat på hvad der fylder;
  og tallet står i loggen, så §8's vane (rapportér payloaden) holder.
  `HENT_FRA_GITHUB = False` giver den indlejrede rune tilbage — den er den
  eneste vej, der virker **uden net** ved installationen.
- **Ny fejlmulighed, ny spærre.** Det, GitHub har, er det, der installeres. En
  genereret fil, der ikke er committet (`app/public/app.js`, ikonet), ville
  give »Cannot find module« i containeren — Beanledger v30's fejl flyttet ét
  sted hen. `tjek_git()` spørger **git**, ikke `.gitignore`.

### Prøvet af, ikke bare skrevet

`tests/install.test.mjs`, otte tests. Scriptet hives ud af YAML'en med PyYAML,
så testen kører **præcis det, panelet kører** — og kun to ting byttes ud
(adressen, og `https`→`http` for den lokale server), hver med en assertion
foran, så en tavs no-op ikke kan lade testen »bestå«.

| Prøvet | Resultat |
|---|---|
| Hent, pak ud, byt ind | `app/` er **byte-identisk** med kilden, fil for fil, og præfiks-mappen er væk |
| Den hentede kopi er en rigtig server | startet fra dét `app/`, svarer 200 på `/api/public-config` |
| Update oven på en gammel version | forældet fil væk, `sagu.db` og `files/` urørt |
| 404 | installationen fælder, og beskeden nævner **begge** årsager |
| Arkiv uden `app/` | fælder — i stedet for at installere ingenting |
| Et andet præfiks-mappenavn | virker; navnet gættes ikke |
| **Den rigtige codeload-adresse over https** | 200 fra `andreasdinesen/bogreolen`, gzip pakket ud, `app/` fundet, pax-header ryddet |
| Et privat repo | 404, ikke 403 — påstanden står ikke længere kun i et dokument |

**Hver vagt er set fejle**, og en af dem på en bedre måde end ventet:

| Sabotage | Hvad blev rødt |
|---|---|
| `rm -rf app` fjernet | **build'et selv fælder** — testen når slet ikke at køre |
| Vagten mod et arkiv uden `app/` fjernet | 1 rød |
| Statuskode-tjekket fjernet | 404-testen rød |
| Præfiks-mappenavnet hardkodet | præfiks-testen rød |
| `app/public/app.js` taget ud af git | `FEJL: disse filer er ikke i git og ville mangle efter en hentning` |

**Det, der IKKE er bevist, og som skal siges højt:** alt er kørt på macOS med
bsdtar og GNU-agtige værktøjer. `tar x -C` og `find -maxdepth` er valgt, fordi
de er det mindste, busybox skal kunne — `tar x` bruges allerede af den
nuværende rune — men **busybox' egen udgave er ikke afprøvet**: Hjorten svarer
ikke fra denne maskine, og der er ingen container-runtime her. Første rigtige
installation på Hjorten er derfor stadig den prøve, der mangler.

### Måling 2 · FTS5

**Spørgsmålet:** har Node's indbyggede SQLite FTS5? Er svaret nej, skal
søgningen bygges på en egen tokentabel fra dag ét — en helt anden kodevej.

**Svaret er JA, i hele det Node-interval runen kan køre på.**

`SQLITE_ENABLE_FTS5` står i `deps/sqlite/unofficial.gni` i **Node 22, 24 og 26**
— altså også i runens standard `node:24-alpine`. Målt lokalt på Node 26.3.1
(SQLite 3.53.4): `fts5` ✓, `bm25()` ✓, `snippet()` ✓, `highlight()` ✓,
`trigram`-tokenizer ✓.

> **Rettelse 2026-08-20.** Første udgave af dette afsnit påstod, at
> `unicode61 remove_diacritics 2` »folder korrekt« danske tegn. Det er for
> bredt: jeg testede kun `Å`. En gennemgang af en fremmed spec (`NOTES-SPEC.md`
> fra Verdande) pegede på fejlen, og målingen bekræftede den:
>
> | Ord | Søgt på | Finder? |
> |---|---|---|
> | `Åbningstider` | `abningstider` | **ja** |
> | `påske` | `paske` | **ja** |
> | `grøn` | `gron` | **nej** |
> | `bæredygtighed` | `baredygtighed` | **nej** |
> | `Ørsted` | `orsted` | **nej** |
>
> `Å` er et A med en ring og bliver foldet. **`ø` og `æ` er selvstændige
> bogstaver i Unicode, ikke accentformer, og røres ikke.** Rettet med en
> `folded`-kolonne, se nedenfor. Lærestregen er metodens, ikke tegnenes:
> *en måling på ét eksempel må ikke skrives ned som en egenskab ved klassen.*

**Beslutning:**

- **FTS5 fra dag ét. Ingen fallback-tokentabel.** Risiko R2 er lukket.
- Tokenizer: `unicode61 remove_diacritics 2` — den klarer `Å`, `ü` og andre
  accentformer.
- **En femte kolonne, `folded`,** dækker `ø` og `æ`, som tokenizeren ikke rører.
  Begge stavemåder indekseres (`grøn` → `groen gron`), for vi ved ikke, hvilken
  brugeren vælger på et fremmed tastatur. **Søgningen foldes ikke** — den
  rammer enten brødteksten (`grøn`) eller kolonnen (`groen`/`gron`), og så er
  der ét sted at tage fejl i stedet for to.
  Kolonnen vægtes **som brødteksten** (1,0). Vægtes den højere, kommer et
  foldet træf foran et eksakt; der er en test på netop det.
  **Kortlægningen er dansk.** Tysk vil have `ü → ue`, svensk er uenig med dansk
  om `ä`, og tyrkisk har et prikløst `ı`, som naiv småskrivning ødelægger.
  Skal Sagu rumme et andet sprog, er det en ny kortlægning — ikke en udvidelse
  af denne.
- **Fire kolonner, vægtet i den rækkefølge SAGU-PLAN §5 kræver:**
  `title` 10,0 · `headings` 5,0 · `meta` (mærker + egenskaber) 3,0 · `body` 1,0
  via `bm25()`. At overskrifter har deres egen kolonne er halvdelen af svaret
  på »Notions wiki-søgning finder reelt kun overskrifter«.
- **Brugerens ord er ikke et FTS5-program.** MATCH-syntaksen er et sprog
  (`"`, `*`, `NEAR`, `OR`, `-`, kolonnefiltre). Hvert ord pakkes derfor som
  frase-literal med en præfiks-stjerne udenfor: `drif` → `"drif"*` finder
  `drift`. Der er test på otte ondsindede input.
- **Proben bliver stående ved opstart.** `docker.image` er et *felt* i panelet,
  så en bruger kan pege runen på et vilkårligt `node:`-image. Sker det, siger
  loggen hvorfor søgningen ikke virker — i stedet for at `no such module: fts5`
  dukker op ved det første søgeforsøg.

### Måling 3 · Rune-til-rune

**Spørgsmålet:** kan Sagu og doda nå hinanden på Hjorten?

**Svaret: ikke ved navn — og det er allerede løst.**

Rune-skemaet er entydigt: det private bridge-net gælder **sidecars inde i én
rune** (`services:`, hvor `name` bliver et DNS-alias). *»Single-container runes
have no documented inter-container communication.«* Der findes intet
`networks:`-felt på rune-niveau.

Det er heller ikke nødvendigt. **MsGraphBud er allerede en rune-til-rune-bro i
drift** — Microsoft 365 → doda — og den gør præcis det, planens fallback
foreskriver: `dest_url` + `dest_key` mod `POST /api/v1/capture` med
`Authorization: Bearer`. Mønsteret er bevist i produktion.

Målt 2026-08-20 (Hjorten var ikke på LAN'et herfra; alt gik gennem tunnelen):

| | |
|---|---|
| `https://doda.<mit-domaene>/api/public-config` | **140–190 ms** (første kald 1,2 s = TLS-håndtryk) |
| Samme kald lokalt | 1–4 ms |
| `cache-control` / `cf-cache-status` | `no-store` / `DYNAMIC` — caching er udelukket som årsag |

**Beslutning:**

- **URL + API-nøgle, som Andreas selv sætter begge steder.** Virker uanset
  topologi, og modtageren er en række i en tabel frem for kode — så den samme
  mekanik kan senere ramme tovo.
- **Feltet er en URL, så genvejen er gratis.** Peger Andreas den på
  `http://<hjortens-lan-ip>:<host-port>` i stedet for på tunnelen, forsvinder
  de ~150 ms uden en linje ny kode. Det er en *indstilling*, ikke et design.
- **F8 må ALDRIG kalde doda pr. optegning.** 150 ms × tre kald i træk er et
  halvt sekund, hvor der ikke sker noget (RUNE-ERFARINGER, doda v27: »tæl
  blokerende rundture, ikke millisekunder«). Opgavestatus på en note hentes med
  et **tidsstempel-cache**, aldrig ved opslag i render.
- **Sagu skal have den smalle dør først.** doda's `/api/v1/capture` med en
  `capture`-nøgle gjorde MsGraphBud billig at bygge. Sagus tilsvarende dør er
  `POST /api/v1/notes` med `capture`-scope — den findes fra F0 og er testet:
  en capture-nøgle kan oprette og **kan ikke se noget som helst**.

### Måling 4 · Store uploads

**Spørgsmålet:** kan serveren tage imod en Notion-zip på hundredvis af MB uden
at læse den i hukommelsen? (Kokkeris backup på 260 MB blev afvist af serverens
egen 25 MB-grænse, og ingen opdagede det, før den skulle bruges.)

**Målt: ja.** `POST /api/v1/upload` med 120 MB:

| | |
|---|---|
| Tid | 112 ms (**~1.070 MB/s** til disk) |
| **Heap under modtagelsen** | **6,4 MB** |
| RSS | 130 MB |
| sha256 | byte-identisk med afsenderens |

Havde kroppen ligget i hukommelsen, ville heapen have været over 120 MB. Testen
fælder ved 40 MB, så et tilbagefald til bufring ikke kan snige sig ind.

**Beslutning:**

- Kroppen streames til disk med `createWriteStream` + løbende `sha256` og et
  byte-loft. **Med modtryk:** rammer skrivebufferen sin grænse, pauses
  læsningen. Uden det er »streaming« kun et ord — Node bufrer bare internt.
- **Loftet er 1 GB**, og uploads lander i `/data/uploads`, ikke blandt de
  rigtige vedhæftninger, så en afbrudt import ikke efterlader noget. Oprydning
  efter 6 timer.
- **413 sendes FØR forbindelsen lukkes.** Kalder man `req.destroy()`, ser
  klienten »connection reset« i stedet for fejlen (doda F7).
- **Egen header `X-Sagu-Upload: 1`.** Ruten læser ikke JSON-kroppen og står
  derfor uden for den fælles CSRF-barriere. En HTML-formular kan ikke sætte
  headeren; via `fetch` udløser den en preflight, vi ikke svarer på. Fritaget
  ved nøgle-adgang — der er ingen ambient legitimation at misbruge.

---

## 2 · Arkitektur

### Stakken

Præcis dodas: Node ≥22 (`node:http`, `node:sqlite`, `node:crypto`, `node:zlib`),
**nul npm-pakker, nul CDN**, SQLite i `/data`, alt samlet af `build_rune.py` til
én YAML med brotli+base85-payload.

Nul afhængigheder er ikke sparsommelighed, men sikkerhedsvalget: uden dem
findes der ingen transitiv forsyningskæde at holde patchet.

### Flerbruger — hvor filteret bor

Sagu er **flerbruger**, som tovo og modsat doda (`users LIMIT 1`). Konsekvensen
er ét arkitektonisk valg, og alt andet følger af det:

> **`user_id`-filteret ligger i dataadgangen selv** — `hentNote`, `hentNoter`,
> `gemNote`, `sletNote`, `soegNoter` — **aldrig i kaldstederne.**

Konkret er det to SQL-fragmenter i `app/server.js`:

```
SYNLIG    = ejer ELLER en note_acl-række
SKRIVBAR  = ejer ELLER en note_acl-række med level = 'write'
```

De to er bevidst adskilte, og **begge er set fejle**: sabotér `SYNLIG` → 5 røde
tests; sabotér `SKRIVBAR` → 5 andre røde. Uden det beviser de grønne ingenting.

Tre ting kan ikke eftermonteres og ligger derfor i migration 1 og 2:

- **`tokens.user_id`.** Uden den rammer enhver nøgle »første bruger i tabellen«,
  og isolationen er en illusion, der ser rigtig ud i alle tests med kun én
  konto (RUNE-ERFARINGER, tovo F0/F8).
- **`settings(scope, key)`**, hvor scope er brugerens id eller `*` for
  installationen. Ellers deler to brugere den samme række.
- **`note_acl`.** UI'et kommer først i F11, men adgangslaget skal findes fra
  F0. **Det gælder også admin:** at være administrator betyder at måtte ændre
  *installationen*, ikke at måtte læse andres noter. Der er test på det.

### Registrering

**Lukket som standard efter den første bruger.** Fravær af indstillingen betyder
lukket — en ny installation må ikke stå åben for verden, fordi ingen har taget
stilling. Første bruger bliver administrator. Registreringslinket **skjules
også** i frontenden via `allowRegistration` i `/api/public-config`; at lukke
ruten uden at skjule linket er en blindgyde.

Kollegaerne får ingen konti: wikien (F6) læses uden.

### Godkendelse — ét API, to legitimationer

Webgrænsefladen bruger **samme API** som eksterne klienter; der er ingen intern
bagvej. `godkend(req, res, scope)` tager enten `Authorization: Bearer` eller
session-cookien. Tre regler, alle med test:

- **Auth-ruterne står UDEN for delingen.** Kodeordsskift, oprettelse og
  tilbagekaldelse af nøgler, admin-ruterne og passkey-administration kræver en
  **rigtig session** (`requireUser`). Ellers er én lækket nøgle nok til at give
  sig selv fuld og varig adgang — eller til at låse ejeren ude af sin egen app.
- **Scopes: `capture` < `read` < `full`.** En capture-nøgle kan oprette og
  **ikke se noget som helst** — en mistet telefon må ikke kunne læse arkivet.
  Testet **uden cookie**; med cookie godkender sessionen alting, og
  scope-tjekket ser ud til at virke, selv hvis det aldrig blev kaldt.
- **Kravet om `application/json` er en CSRF-barriere**, og CSRF forudsætter en
  *ambient* legitimation. En Bearer-nøgle sendes aktivt, så kravet slækkes
  præcis dér — en iOS-genvej med ét tekstfelt skal kunne virke.

### Sikkerhedsheadere

Streng CSP med `default-src 'none'`. To valg er værd at kende:

- **Hashen på tema-scriptet beregnes ved OPSTART** af `index.html` selv, ikke
  stemplet ind af build'et. Så kan CSP'en aldrig komme ud af trit med filen, og
  build og server er ikke koblet sammen. Den samme scripttekst genbruges
  **ordret** af de server-renderede sider (wikien i F6, samtykkesiden i F10) —
  så passer hashen af sig selv, uden en ny undtagelse.
- **`style-src` beholder `'unsafe-inline'`.** En vanilla-JS-frontend bygger
  markup med `innerHTML`, og `style="…"` blokeres ellers. Den betydningsfulde
  spærring er `script-src` — vælg den kamp. `worker-src 'self'` er med fra nu,
  ellers blokerer CSP'en vores egen service worker senere, med en fejl der ikke
  nævner CSP med ét ord.

**Konsekvenser at huske:** `frame-ancestors 'none'` slår erfaringsfilens
iframe-måleteknik ihjel — mobiltest skal bruge `resize_window`, én bredde ad
gangen.

### Data ud af serveren

- **`body_md` kommer aldrig med i et listesvar.** Lister får titel, mærker og
  tællere. Kokkeris login-svar på 247,9 MB kom af netop den slags.
  **Søgeuddraget er undtagelsen med vilje:** SAGU-PLAN §5 kræver et uddrag med
  fremhævning, og det citerer nødvendigvis brødteksten. Grænsen går ved, om
  svaret vokser med notens størrelse — derfor **måles** uddraget i stedet for at
  forbydes: en note på 200 KB giver et søgesvar under 5 KB.
- **Hemmelige indstillinger står ét sted** (`HEMMELIGE_SETTINGS`) og bruges både
  af læse-endepunktet og af eksporten. Et endepunkt, der returnerer »alt i en
  tabel«, er en tidsindstillet lækage: det er rigtigt den dag, det skrives, og
  forkert første gang nogen lægger noget følsomt i tabellen.
- **404, aldrig 403, på en fremmed note.** En 403 ville bekræfte, at id'et
  findes, og så kan man aftaste, hvilke id'er der er i brug.

### Fejlsvar

To lag: en kode til maskinen og en sætning til mennesket —
`{error: "wrong_scope", message: "This key is …"}`. En **formregel-test** gælder
alle ruter: koden skal matche `^[a-z][a-z0-9_]*$`, og beskeden må ikke være
koden om igen. En test pr. rute låser kun det, der allerede er skrevet ned;
formreglen fanger også den rute, nogen tilføjer om et halvt år. En 500 røber
aldrig sin egen besked.

### Konfliktvagt

`PATCH` tager et valgfrit `ifUpdatedAt`. Passer det ikke, svares **409 med det
aktuelle stempel** — aldrig en tavs overskrivning. Det er billigere end
realtids-samredigering og dækker behovet (SAGU-PLAN §7 fraråder CRDT uden
pakker). Versionshistorik skrives fra dag ét, uden UI: en wiki uden fortrydelse
er farlig.

### Frontenden

Vanilla JS i `app/parts/p*.js` → `public/app.js`. Designtokens, skal, sidebar
(§9c) og sideoversigt i højre kant (§9b) er dodas, ordret hvor det kunne lade
sig gøre. **Interfacet er engelsk; koden, kommentarerne og dokumenterne er
dansk.**

Fem ting, arvet som *regler* frem for som kode:

- **Mobilgrænsen er 900 px** og bor i én konstant, brugt af både
  `matchMedia()` (`SMAL_SKAERM`) og `@media`. En iPad i portræt er 768/834 px.
- **`#pageHost { width: 100% }`.** `.main` centrerer sine børn, så en **tom**
  side bliver en smal søjle midt på skærmen. Arver du en skal, så test den også
  med tomt indhold — det er den tilstand, forlægget aldrig havde (tovo F0).
- **`.meta` er en versal etiket, ikke en tekstklasse.** Udvejen er skrevet som
  en **regel** (`p.meta, li.meta, .meta.saetning`), ikke som en liste over
  forældre — en liste fanger tilføjelser, aldrig udeladelser (tools v1+v2).
- **Modifikatorer til `table.data` skal have tabel-præfiks.** `.center` alene
  (0-1-0) taber til `table.data td` (0-1-2) og gør ingenting.
- **Brugermenuen hænger i sidebarens fod og placeres af CSS**, ikke af et
  `getBoundingClientRect()` på klik-tidspunktet. Arver du komponenten, så arv
  **begge** halvdele: CSS'en alene giver en menu, der ser rigtig ud i kilden og
  er usynlig på skærmen (tools v2).

### Build

`build_rune.py` er dodas maskine med tre tilføjelser:

- **Ikonet tegnes** (palet-PNG, `zlib` + `struct`, ingen PIL). Se måling 1.
- **Require-spærren.** Payloadens filliste er globbet, og **kravet udledes af
  koden**: alle `require('./…')` læses ud af kilderne, og build'et fælder, hvis
  en mangler. Beanledger udgav to versioner, der slet ikke kunne installeres,
  fordi et nyt modul manglede i en håndholdt liste — usynligt lokalt, fordi
  preview kører fra repo-mappen. **Spærren er bevist**: fjern `webauthn.js` fra
  globben → `FEJL: disse require-filer mangler i payloaden`.
- **`--budget`.** Leave-one-out plus kommentar-strippens gevinst. Se måling 1.

Build'et verificerer desuden, at **install og update pakker den samme payload**,
at update har `rm -rf app` (tar overskriver, men fjerner ikke slettede filer),
og at update ikke **rører** `/data`, `sagu.db`, `files` eller `uploads` — kun de
handlende linjer tjekkes, så echo-linjen »Databasen i /data er uroert« må blive
stående.

---

## 3 · Test

`node --test tests/*.test.mjs` — **128 grønne** efter F4.

- `tests/hjaelp.mjs` starter **den rigtige server** i en frisk datamappe med
  `BIND_PORT=0`, læser porten ud af serverens **egen startlinje** (samme linje
  runens `done_regex` venter på), og tager stderr med i timeout-beskeden.
  Databasen kan åbnes ved siden af med `node:sqlite` — WAL tåler to processer —
  for at plante data, en test ikke kan provokere gennem API'et.
- `tests/isolation.test.mjs` — 14 tests. **Køres i hver fase**, ikke kun én
  gang. Se afsnit 2 om sabotage-beviset.
- `tests/f0.test.mjs` — 28 tests: CSRF (415), rate-limit (429) med bevis for at
  tælleren ligger i databasen, CSP-hashen mod den faktiske fil, fejlsvarenes
  form, sti-traversering, `seq` som løbenummer, konfliktvagten, udeladt-vs-tom,
  versionshistorik, `BIND_PORT`-regressionen, og målingerne 2 og 4.
- `tests/markdown.test.mjs` — 15 tests: XSS-suiten (32 angreb), blokkene, linjenumrene, unikke overskrifts-id'er, 200 KB på 15 ms.
- `tests/trae.test.mjs` — 19 tests: fem niveauer, cyklus-vagten, kaskade og gendannelse, duplikering, `[[links]]` og backlinks, historikken, isolation på alle de nye ruter.
- `tests/soeg.test.mjs` — 23 tests: parseren, rangeringen, afsnits-ankeret, ordet inde i ordet, LIKE-jokertegn, alle filtrene, isolation på begge søgeveje, og de 5.000 noter.
- `tests/filer.test.mjs` — 17 tests: SVG aldrig inline, filnavns-sanering, ETag/304, kun antal i listerne, isolation, og at en slettet notes filer forsvinder fra disken.

**Test-quirks i Claude Codes browser-panel**, som kostede tid i F0 og vil koste
tid igen:

- `document.visibilityState` er **altid `hidden`**, så `requestAnimationFrame`
  aldrig fyrer og **CSS-transitions aldrig kommer i mål**. Sidebaren så ud til
  ikke at åbne på mobil; den virkede fint. Injicér
  `*{transition:none !important}` før du måler layout, eller mål på den
  egenskab, der ER ændret (`getComputedStyle().transform`), ikke på en geometri,
  der først lander bagefter.
- Syntetiske keydown har tom `e.key` — tastaturnavigation kan ikke afprøves
  gennem panelet. Dispatch en rigtig `KeyboardEvent`.
- Mobilnettet (`overflow-x: hidden` under 900 px) **skjuler beviset**:
  `document.scrollWidth` siger 0, mens en kolonne er klippet af. Mål derfor også
  **pr. element** (`getBoundingClientRect().right > innerWidth`), og filtrér
  elementer inde i en `overflow-x: auto`-ramme fra.

---

## 4 · Hentet fra Verdande (`NOTES-SPEC.md`)

Andreas leverede 2026-08-20 to dokumenter fra **Verdande**, en anden
yggdrasil-rune med noter i en opgave-app. `NOTES-SPEC.md` er skrevet
udtrykkeligt for at kunne løftes ind i et andet program, og den er god. Her
står, hvad Sagu **tog**, hvad Sagu **allerede havde**, og — vigtigere — hvad
Sagu **bevidst gør anderledes**, så ingen senere »retter« det tilbage.

### Taget, og allerede bygget ind

- **`remove_diacritics` folder ikke `ø` og `æ`.** Det afslørede en for bred
  påstand i måling 2. Se rettelsen dér. Dette er dokumentets største bidrag.
- **Kortlægningen er sprogspecifik**, ikke »fjern accenter«. Skrevet ind som en
  regel ved siden af koden.

### Taget som krav til senere faser

Hvert punkt er verificeret mod Sagus egen kode, ikke bare læst:

- **Et ord inde i et ord.** Målt på Sagus søgning: en note med
  `gamerule keepInventory true` findes **ikke** ved at søge `inventory`.
  Tokenizeren så ét ord; en præfiks-stjerne kan kun ramme forfra. Det er ikke
  eksotisk i Sagus tilfælde — arkivet er driftsdokumentation fuld af
  `backup-nat.log`, `logAnonymizer` og kommandolinjer.
  **F2:** når indekset svarer tomt, læs teksten (`LIKE '%term%'` over den
  foldede kolonne, alle termer skal forekomme). Det rangerer ikke — der er
  intet at rangere. Ved ~100.000 noter er svaret en trigram-tokenizer i stedet;
  den er målt til stede i Node's FTS5.
- **Et `body`-felt, der indeholder et UDDRAG, bliver gemt oven i det rigtige.**
  Editoren åbner det, autosave skriver det tilbage, og noten er skåret ned til
  sit eget uddrag — ødelagt af ingenting andet end at være blevet set på.
  Sagu sender allerede `excerpt` som sit eget felt og lader `body` være
  `undefined`; **F1 må ikke lave det om.**
- **Markeret række og indlæst note er to forskellige tilstande.** Editoren
  henter sin tekst, når notens id skifter — får den uddraget først og hele
  noten bagefter, er id'et det samme begge gange, og den anden optegning sker
  aldrig. **F1.**
- **Hver linje bliver præcis én blok.** Markdown slår normalt linjer sammen til
  et afsnit; en editor, der stiltiende ombryder det, nogen har skrevet, er en
  editor man holder op med at stole på. **F1/F3.**
- **Én definition af, hvad en kodeblok indeholder.** En kopiér-knap inde i
  `<pre>` og en syntaksfarver, der læser `textContent`, bliver uenige — og et
  klik på »Copy« skrev ordet *Copied* ind i koden og næste gem lagde det på
  disken. Kopiér-knappen er Andreas' krav 6, så **F3** skal have én funktion,
  der siger hvad blokken rummer, brugt af både farvelægger og serialisering.
- **Escaping mellem tags og escaping inde i en attribut er to forskellige
  opgaver.** `![" onerror="alert(1)](…)` er hele angrebet. Sagus `linkify`
  escaper først og matcher bagefter, hvilket dækker det — men **F3 tilføjer
  billeder**, og så skal angrebet stå i suiten.
- **Én optegningsfejl må ikke tage hele ruden med sig.** Én note i en uventet
  form kastede inde i en reaktiv effekt, og derefter kunne *ingen* note åbnes.
  Guard om optegningen, fald tilbage til rå tekst. **F1.**
- **Importens grænser.** Måling 4 dækkede modtagelsen, ikke udpakningen:
  et loft på **den udpakkede størrelse** (64 MB zip → 66 GB er en normal form
  på et angreb), et loft pr. fil *og* et samlet budget, aldrig brug arkivets
  filnavn som en sti — og **tæl hvad du springer over, og sig det højt**: én
  note ud af 1.141 blev tabt tavst af et filter, der ledte efter `..`, og det
  blev kun fundet ved at tælle i begge ender. **F5.**
- **Lad importøren sætte tidsstempler; lad ingen andre.** `updated_at` betyder
  »hvornår skrev dette program sidst i noten«. En egen smal indgang til
  importen, med begrundelsen i kommentaren. Uden det er 1.200 importerede
  noter en bunke, der alle blev skrevet samme aften — »og rækkefølgen de blev
  skrevet i er halvdelen af, hvad et arkiv er«. **F5.**
- **`content-visibility: auto` før virtualisering.** 1.200 rækker: 2,1 s → 0,95 s
  uden en virtuel liste, uden scroll-matematik og uden en liste, der kan komme
  ud af trit med sig selv. **F1/F3.**

### Bevidst IKKE taget

Verdande siger det selv i sin indledning: »about a third of its design is
inherited from [the host app]«. Tre af dens bærende valg er svar på et andet
program end Sagu, og de skal afvises eksplicit, så de ikke sniger sig ind:

| Verdande | Sagu | Hvorfor |
|---|---|---|
| **Noter har intet hierarki; de filer under projekter** | **Notesbøger med undersider i vilkårlig dybde** | »En anden hierarki at file i er ét for meget« er rigtigt i en opgave-app, der allerede *har* projekter. Sagu **er** notearkivet — hierarkiet er dens filsystem, og det er krav 1. |
| **Deling ER at lægge noten i et projekt; ingen egen adgangsliste** | **`note_acl` + `shares`** | Krav 16 (deling mellem brugere) og krav 11–14 (offentlig wiki med kodeord) er to forskellige adgangsveje til noget, der ikke er et projekt. |
| **Titlen er første linje, udledt ved hvert gem** | **Egen `title`-kolonne** | Notion-importen giver titlen fra filnavnet, og wikiens URL'er og backlinks (`[[titel]]`) skal have en stabil titel, som ikke skifter, fordi nogen omskriver den første linje. **Prisen skal kendes:** Verdandes argument mod en kolonne er, at den bliver forældet. Sagus svar er, at titlen er redigerbar for sig — men **F1 skal sikre, at en note ALDRIG kan stå uden en**, ellers hedder den »Untitled« i wikien. |

**Taget (Andreas sagde ja, 2026-08-20): tidsstempler frem for flag.**
`archived_at` og `deleted_at` er nullable tidsstempler — »hvornår blev det lagt
væk« svarer på spørgsmål, et flag ikke kan, og det koster den samme byte.

Samme ombæring fjernede `deleted`-fluebenet, som lå **ved siden af**
`deleted_at`: to felter om ét faktum, der kan blive uenige (én kodevej sætter
flaget uden stemplet, og oprydningen efter 30 dage finder aldrig rækken). At
rette den ene halvdel og lade den anden stå ville have efterladt to
konventioner side om side — præcis det, erfaringsfilen advarer mod.

Grænsefladen er stadig et flag udadtil: klienten siger `{archived: true}`, og
**serveren stempler hvornår.** En klient, der selv måtte sætte tidspunktet,
ville gøre kolonnen til hvad som helst den sidste skriver fandt på — samme
regel som `updated_at` (se importen i F5).

Med i samme runde: en **test på, at stemplet er et tidspunkt og ikke bare et
omdøbt 1-tal**, at arkiv og papirkurv er to forskellige bits (en arkiveret note
er ikke i skraldespanden), og at **en arkiveret note stadig kan søges frem** —
arkivet er »jeg vil ikke læse forbi det«, ikke »det findes ikke«. Ellers er
arkivering en datatabsmaskine med en pæn knap.

---

## 5 · F1 · Noter, træ og editor

### Markdown-rendereren er et DELT modul fra dag ét

`app/shared/markdown.js` er UMD-pakket og bruges af browseren nu og af den
**server-renderede** wiki i F6. Flytningen laves først, ikke når F6 opdager, at
den mangler (RUNE-ERFARINGER §9a). Prisen viste sig at være nul: leave-one-out
måler modulet til **83 tegn** af 13.797 rå — brotli genkender dubletten, fordi
det også ligger inde i `app.js`. Fjerde projekt, samme resultat.

**Sikkerhedsmodellen** er den, der bærer risiko R4 (fremmed markdown på et
offentligt domæne):

1. **Escape først, match bagefter.** Når `<`, `>` og `&` allerede er entiteter,
   kan intet tag opstå af noget, brugeren skrev. Derfor er der ingen sanitizer
   bagefter — der er ingen vej ind.
2. **`esc()` til tekst, `attr()` til attributter.** To funktioner, fordi det er
   to opgaver: anførselstegn er harmløse mellem tags og lukker en attribut.
   `![" onerror="alert(1)](…)` er hele angrebet.
3. **`sikkerUrl()` er en hvidliste** på `https?://`. En sortliste kan omgås
   (`java\tscript:`, `JaVaScRiPt:`); en hvidliste kan ikke.

**XSS-suiten måler på resultatet, ikke på kilden.** Første udgave brugte et
regex efter `on…=` og gav fem falske positiver: `&lt;img onerror=…&gt;` er
inert tekst, ikke en attribut. Testen parser nu de rigtige tags — hvilket den
kan, netop fordi `esc()` gør enhver bruger-`<` til `&lt;`, så et `<` i
resultatet kun kan komme fra vores egne skabeloner. Dertil en **hvidliste over
de tags, rendereren udsteder**, og en test på, at målemetoden selv ville fange
et ødelagt output.

### Den hybride editor står på blokkenes linjenumre

`blokke()` giver hver blok sin `fra`/`til` i kilden. Et klik i et afsnit
skærer præcis de linjer ud som rå markdown, resten bliver stående renderet, og
det, der skrives, splejses tilbage på samme plads. Der er **ingen konvertering
nogen steder** — feltet indeholder de linjer, der står i databasen.

Fem regler, fire af dem fra Verdandes spec:

- **Hver linje bliver præcis én linje.** Markdown slår normalt fortløbende
  linjer sammen til ét afsnit; her renderes de med `<br>`. Personen skrev en
  linje og forventer at få den tilbage.
- **Indlæst note og markeret række er to tilstande.** `editor.indlaeser` findes,
  fordi to hurtige klik ellers lader det første svar overskrive det andet.
- **Én optegningsfejl må ikke tage ruden med sig.** Guard om `render()`, fald
  tilbage til rå tekst.
- **En note må aldrig stå uden titel** — den hedder sin titel i træet, i
  wikiens adresse og i `[[henvisninger]]`. Tomt felt bliver til `Untitled`, men
  først når man forlader det.
- **Konflikten er et VALG.** `ifUpdatedAt` → 409 → et bånd med »Load theirs« og
  »Keep mine«. Intet overskrives, og den anden udgave står i historikken.
  Verificeret i browseren, ikke kun som statuskode.

### Træet

- **Ét kald** (`GET /api/v1/tree`) til hele træet. Et kald pr. niveau ville
  være lige så mange blokerende rundture som træet er dybt — ~150 ms hver
  gennem tunnelen (måling 3).
- **Cyklus-vagt på flytning.** Uden den kan en note trækkes ind under sit eget
  barn; træet bliver en ring, begge forsvinder fra sidebaren, og **gemningen
  lykkes**. Vagten går *op* fra den nye forælder.
- **Et undertræ ligger i én notesbog.** Ellers kan sidebaren ikke tegne det ét
  sted.
- **Sletning tager undersiderne med, og `deleted_root` husker hvem.** En
  gendannelse vækker præcis dem, kaskaden tog — ikke en underside, brugeren
  selv slettede i forrige uge (doda F3). En gendannet note, hvis forælder
  stadig er slettet, løsrives, så den kan **ses**.
- **En kopi arver ikke `ext_id`.** Ellers ville en Notion-genimport tro, at
  kopien er originalen, og skrive oven i den.
- **Link-tabellen rives ned og bygges op ved hvert gem — den diffes ikke.**
  Teksten er sandheden; tabellen er kun et indeks over den, og en diff er en
  anden beskrivelse af det samme faktum, som kan blive uenig med teksten.

### »Fuld skærm« er tre forskellige ønsker

Andreas spurgte, om en note kunne gøres fuldskærm. Det viste sig at dække tre
ting, som løses hver for sig — at slå dem sammen ville have givet én knap, der
gør for meget:

| | Hvad | Hvor det hører til |
|---|---|---|
| **Fuld bredde** | Tekstspalten bruger hele siden i stedet for læsebredden på 820 px. Godt til tabeller og kode, skidt til prosa. | Et valg **pr. note**, gemt i `full_width`, så det følger noten til enhver skærm. |
| **Fokus** | Alt andet forsvinder: sidebar, brødkrummer, alt. `F` tænder, `Esc` går ud. | En tilstand ved **skærmen**, ikke ved noten — gemmes derfor ikke. |
| **Browserens fuldskærm** | Også uden faner og adressefelt. | Kræver en brugerhandling og fejler i en iframe, så den er et **tilvalg** i note-menuen oven på fokus — ikke det, `F` gør. |

Målt: normal 820 px → fokus 760 px med sidebaren væk → fokus + fuld bredde
1.100 px. **Værktøjsknapperne bliver synlige i fokus** (dæmpet til de hoveres):
en udvej skal virke præcis dér, hvor man er (doda v39).

`F` virker ikke, mens man skriver — værnet spørger om både `activeElement` og
hændelsens `target`, fordi en optimistisk opdatering kan nå at fjerne det
fokuserede element (doda v29).

---

## 6 · F2 · Søgningen og omni-feltet

### Feltet er appens forside

Feltet bor i topbaren på **alle** skærme, som i doda, og appen starter i det.
`/` giver det fokus fra hvor som helst — **ikke** dodas »skriv bare«, for Sagu
har enkeltbogstavs-genveje på noteskærmen (`F` for fokus), og to funktioner om
de samme bogstaver er præcis den fejl, tovo F1 beskriver: *en arvet
tastaturregel kan være forkert i den nye app.*

**Rækkefølgen er byttet om i forhold til doda, bevidst.** doda: ét Enter skal
altid fange. Sagu: man leder oftere, end man opretter. Derfor står træfferne
øverst og »Create …« som **sidste** række — altid der, aldrig i vejen. `*`
flytter den op på førstepladsen, og uden træffere er den den eneste række, så
Enter opretter igen. Den regel kan man forudsige uden at lære den.

### Søgesyntaksen er ét delt modul

`app/shared/soeg.js` tolker linjen for browseren (chips, uden netværkskald),
for serveren og senere for wikiens offentlige søgning. Ligger tolkningen to
steder, driver de fra hinanden, og feltet begynder at love noget, resultatet
ikke holder.

To ting, den skal kunne, som er lette at få galt:

- **Et kolon i en adresse er ikke et filter.** Et filter skal stå ved
  linjestart eller efter et mellemrum — ellers bliver `mailto:andreas@…` til et
  filter og `https://` delt midt over. Samme regel som doda F1's markører.
- **Søgningen fodres med den TOLKEDE tekst, ikke den rå linje.** Ellers dør
  resultatet i det øjeblik brugeren skriver en markør (doda v30).

Et ukendt filternavn bliver et søgeord frem for en fejl; en **ukendt værdi** i
et kendt filter (`tag:findesikke`, `in:FindesIkke`) giver derimod **nul
træffere**. Et filter, der stiltiende ignoreres, ligner en søgning, der virker.

### To lag, i den rækkefølge de svarer

1. **FTS5, rangeret.** Titel 10 · overskrifter 5 · mærker/egenskaber 3 ·
   brødtekst og den foldede kolonne 1. »Et ord i titlen er hvad noten *handler
   om*; det samme ord ét sted i en lang tekst er en omtale.«
2. **Teksten, når indekset intet fandt.** Et indeks er bygget af tokens, og en
   tokenizer kan ikke se et ord **inde i** et ord: `keepInventory` er ét token,
   så `inventory` giver nul — og et arkiv af driftsdokumentation er fuldt af
   `backup-nat.log` og `logAnonymizer`. Faldet tilbage rangerer ikke; der *er*
   ingen rangering, når der ikke var en træffer at rangere, og **svaret siger
   det** (`fallback: true`), så feltet kan sige det videre.

**Ved ~100.000 noter er et ledende `%` den forkerte form**, og svaret er da en
trigram-tokenizer (målt til stede i Node's FTS5) — ikke en større scanning.

### Hop til afsnittet

»Et link, der hopper til afsnittet — ikke til toppen af en lang side. Det alene
er forskellen på Notions« (SAGU-PLAN §5). Serveren finder første forekomst af
et af ordene, går op til nærmeste overskrift og returnerer **samme id, som
rendereren giver den overskrift** — inklusive `-2`-suffikset ved to ens
overskrifter. Peger ankeret et andet sted hen, lander hoppet på toppen, altså
præcis den fejl funktionen findes for at rette. Der er en test, der holder de
to id-generatorer op mod hinanden.

### Målt

| | |
|---|---|
| 5.000 noter, almindelig søgning | **3–10 ms** (accepten var 100 ms) |
| Faldet tilbage over 5.000 noter | **5 ms** |
| Præfiks (`drif` → `drift`) | 3 ms |

**Rettet undervejs, og det er den vigtigste linje i afsnittet:** faldet tilbage
joinede `note_fts` på `note_id`. Den kolonne er **UNINDEXED**, så joinet blev
en scanning af hele FTS-tabellen *pr. note* — **4.297 ms** på 5.000 noter. Med
foldningen regnet i ren SQL (`replace(replace(replace(…)))`) i stedet er det én
scanning: **9 ms**. En UNINDEXED FTS5-kolonne kan hentes, men aldrig joines på;
det er dét, ordet betyder.

Dertil: FTS5's `snippet()` klipper i den **rå** kolonne, så uddrag begyndte
midt i `## Regler` og bar linjeskift. De renses nu til én læsbar linje —
og `<<`/`>>` overlever rensningen, fordi frontenden escaper **først** og
derefter bytter dem til `<mark>`. Der er en test på, at man ikke kan skrive
markørerne selv og få et tag ud af det.

---

## 7 · F3 · Notion-følelsen

### Alt arbejder på markdown-kilden

Der findes ingen anden repræsentation. En kopier-knap læser blokkens kilde, et
afkrydsningsfelt skriver `[ ]` om til `[x]` **på sit linjenummer**, og et
indsat billede bliver til `![navn](sagu:<id>)`. Derfor overlever alt, editoren
kan, en rundtur gennem markdown — og hvad markdown ikke kan sige, tilbyder
editoren ikke.

Rundturen er F3's acceptkriterium, og testen beviser den strengt: kilden skal
være **byte-identisk** efter at være delt i blokke og samlet igen, og **ingen
linje må falde uden for en blok**. Uden den anden halvdel ville en blok, der
tabte en linje, stadig bestå.

### De nye blokke, og hvad der gik galt

- **Tabeller.** En række *plus* en skillelinje. Uden det krav ville »a | b« i
  almindelig prosa pludselig blive til opmærkning.
- **Tjeklister** er deres egen blok, ikke en variant af en liste, fordi
  felterne skal kunne **klikkes**. `saetTjek()` tager linjenummeret, ikke
  teksten: to punkter kan hedde det samme, og en tekstsøgning ville tikke det
  forkerte af. Kun rækken tegnes om — en fuld optegning ville flytte
  rullepositionen og lukke en åben blok.
- **Callouts** i GitHub-stil (`> [!WARNING]`). Notions farvede bokse har ingen
  markdown-form, og en egen syntaks ville ikke overleve en eksport. Et ukendt
  navn bliver et almindeligt citat, ikke en tom boks.
- **Billeder.** `attr()` er ikke valgfri her: alt-teksten havner i en
  **attribut**, og `![" onerror="alert(1)](x.png)` er hele angrebet. En
  `billedUrl`-krog lader værten oversætte `sagu:<id>` til en intern sti —
  rendereren selv kender ikke Sagus adresser.

**Kopier-knappen ligger UDEN FOR `<pre>`.** Verdandes dyreste fejl her: en knap
inde i blokken og en syntaksfarver, der læser `textContent`, blev uenige, og et
klik på »Copy« skrev ordet *Copied* ind i koden — som næste gem lagde på disken.
Én funktion siger, hvad blokken indeholder.

### Indsætning: fra mest til mindst specifikt

1. **Filer** → upload.
2. **En adresse over markeret tekst** → `[markeringen](adressen)`. Den eneste
   måde at få et link uden at skrive parenteser.
3. **En bar adresse** → `[pænt navn](adressen)`, så en 200 tegn lang
   Notion-adresse ikke fylder en linje.
4. **HTML fra en browser** → markdown. Browseren lægger *både* `text/html` og
   `text/plain` i udklipsholderen; den rene tekst har tabt overskrifter og
   links, så HTML'en er den rigtige kilde, når den er der. Kun hvis
   omsætningen gav mere end den rene tekst — ellers er den rene tekst det
   ærligste valg.
5. **Ren tekst** → ordret. Markdown *er* vores format; der er intet at
   konvertere. Det er hele udbyttet af beslutning 1.

Omsætteren er bevidst lille og dækker kun de blokke, editoren selv kan. Der
parses med `DOMParser` i et inert dokument (ingen scripts, ingen hentninger),
og resultatet er markdown, som derefter går gennem vores egen renderer med
hvidliste.

### Vedhæftninger — F4's kerne, trukket frem

Reglerne er dodas F7 ordret, og de er sikkerhedsreglerne:

- **Hvidliste på fem rastertyper til inline.** Aldrig et `image/`-præfiks —
  præfikset lader `image/svg+xml` igennem, og en SVG er et dokument, der kan
  køre script på vores eget domæne. Alt andet får `application/octet-stream`
  + `attachment` + `nosniff`.
- **Filnavnet er kun til visning.** Stien på disken er altid hex-id'et, og
  stien tjekkes **igen** ved læsning: en traversering, der på en eller anden
  måde er kommet i databasen, må ikke blive til en, der læser `/etc/passwd`.
- **Upload uden multipart-parser.** Browseren sender filen som krop, navnet
  står i query-strengen, og kroppen streames til disk med løbende sha256.
  Egen header `X-Sagu-Upload`, fordi ruten aldrig kalder body-læseren og
  derfor står uden for den fælles CSRF-barriere.
- **ETag = filens sha + `immutable`.** Indholdet kan aldrig ændre sig for et
  givet id, så 304 er gratis.
- **Listerne får kun `attachmentCount`.** Kun den enkelte note får metadata —
  og konsekvensen at huske er, at detaljeruden ikke kan bruge objektet fra
  listen.
- **Skaleringen sker i BROWSEREN.** Node kan ikke skalere uden pakker. PNG
  bliver PNG: en JPEG-fallback gør transparens sort.

**Rettet:** `attachments.note_id` er `ON DELETE SET NULL`, så en hårdslettet
note gjorde feltet NULL — hvorefter filen ikke kunne skelnes fra en, brugeren
bevidst havde uploadet uden note. En oprydning, der gættede på NULL, ville have
slettet de forkerte. Filerne ryddes nu **sammen med** noten, med et net under
til rækker, der overlevede en note, som forsvandt ad en anden vej.

### Lightbox, skabeloner og ikoner

Lightboxen lukkes med **Esc, swipe og en synlig knap**. De to første er
accepten; knappen er der, fordi en telefon ikke har en Esc-tast, og et billede
i fuld skærm uden en synlig vej ud er en blindgyde.

Skabelonerne er **ren markdown** — de kan rettes af brugeren, de overlever en
eksport, og de kræver ingen kode. Dagens note hedder datoen, så den kan findes
igen.

Emoji-vælgeren er et fast udvalg på 24 plus et frit felt, ikke en fuld
emoji-vælger: et ikon skal vælges på to sekunder, og den, der vil have et
andet, kan indsætte det.

---

## 8 · F4 · Filer, kvote og en CSP-beslutning

### En krog, ikke en undtagelse

F3 producerede `[rapport.pdf](sagu:<id>)` for en fil, der ikke er et billede —
og rendereren gjorde det eneste rigtige med den: `sagu:` er ikke http(s), så
`sikkerUrl` afviste den, og linket blev til literal tekst. **En uploadet PDF
var altså et dødt link.**

Kuren er en `linkUrl`-krog ved siden af `billedUrl`, ikke en undtagelse inde i
`sikkerUrl`. Forskellen er ikke stilistisk: rendereren bruges også af den
server-renderede wiki (F6) og af MCP (F10), og den må ikke kende Sagus egne
adresser. Værten oversætter; rendereren spørger.

Der er en test på, at krogen ikke åbner en vej for noget andet: den kaldes med
brugerens streng og svarer `null` på alt, der ikke er præcis vores mønster.

### CSP'en blokerer eksterne billeder — og det er den rigtige beslutning

`img-src 'self' data: blob:` betyder, at `![alt](https://andres-server/x.png)`
ikke hentes. Det opdagede jeg først i konsollen, og det er værd at skrive ned
som et **valg** frem for at lade det ligne en fejl:

- **Hvorfor den bliver.** På den offentlige wiki (F6) ville en løsere
  `img-src` lade en note få læserens browser til at hente fra en fremmed vært.
  Det er en sporingskanal, forfatteren kan misbruge mod kollegaerne — og de
  har ikke engang en konto at sige fra med.
- **Men et ødelagt billedikon forklarer ingenting.** Et billede udefra bliver
  derfor et **synligt link med alt-teksten og en forklaring**. Indholdet går
  ikke tabt, og årsagen kan ses.
- **F5 lukker hullet rigtigt:** importen henter eksterne billeder ned som
  vedhæftninger, præcis som Notion-eksportens egne filer. Det er også dét,
  §6c foreskriver (Node kan ikke skalere billeder, så frontenden gør det).

### Kvoten håndhæves UNDER uploaden

Et tjek før modtagelsen kan kun se, hvad der allerede ligger — så én fil, der
er større end hele kvoten, ville slippe forbi, fordi der *var* plads, da den
begyndte. Loftet for den enkelte upload er derfor det mindste af fil-loftet og
den plads, brugeren har tilbage.

Og fejlen siger **hvilken** grænse der blev ramt. »The file is larger than 25
MB« er forkert, når problemet er, at arkivet er fuldt, og sender brugeren efter
et mindre billede.

### At fjerne en fil rører ikke teksten

En henvisning til en fjernet fil bliver stående i noten. At redigere brugerens
tekst bag hans ryg er værre end et dødt link, han selv kan se og fjerne — så
beskeden siger det i stedet: *»Removed … — the note still links to it.«*

### Målt

| | |
|---|---|
| 413 ved 30 MB mod et 25 MB-loft | rigtigt svar, ikke »connection reset« |
| Den halve fil efter en afvisning | ryddet op |
| Kvote 3 MB, fil på 2 MB, så 2 MB til | anden afvist med `quota_full` |
| Sletning af en note | filen væk fra disk **og** tabel, bevist ved at lade `sweep()` køre |

---

## 9 · F5 · Import fra Notion — og eksport

### Den dokumenterede eksport og den faktiske eksport er ikke den samme

Notions egen beskrivelse — og hver vejledning på nettet — siger, at en side er
`Titel <32 hex>.md`, og at dens undersider ligger i mappen `Titel <32 hex>/`.
Filerne holder. **Mapperne gør ikke.** Målt på Andreas' rigtige eksport:

| | |
|---|---|
| mapper i alt | 97 |
| mapper med hex-suffiks | **0** |
| mappenavnets længde | klippet ved ~48 tegn |

En kode, der *danner* mappenavnet ud fra id'et, rammer altså aldrig. Og fejlen
er tavs: importen kører igennem, tæller 290 sider og ser rigtig ud — men hver
databaserække ligger i opsamlingsbogen i stedet for sin egen notesbog, og hver
databaseforside viser sin tabel uden ét eneste link.

Rettelsen er en holdningsændring mere end en kodeændring: **udled mapperne af
de stier, der findes, i stedet for at gætte deres navne.** Ejeren findes ved
id, når mappenavnet har et — og ellers ved et præfiks-match på titlen i
filnavnsform. Præfiks, ikke lighed, netop fordi navnet er klippet af. Begge
former er dækket nu, og der er en test for hver.

### Titlen findes i to udgaver, og CSV'en bruger den anden

Samme afkortning bider et sted til. `_all.csv` skriver rækkens **fulde** titel;
filnavnet har den klippede. Databasens forside slår derfor rækkerne op på
notens **rigtige** titel — den fra `# Titel` inde i markdown-filen, husket
under skrivningen — med præfiks-match som reserve. Resultat: **263 af 268
rækker** linker. De sidste fem er rækker, hvis side slet ikke er i eksporten.

### Nøglen er hex-id'et, ikke titlen

Eksporten har **12 dublettitler**, én af dem seks gange. Havde importen brugt
titlen som nøgle, ville seks forskellige sider være smeltet sammen til én. Det
er også id'et, der genopretter de interne links (241 af dem) — og det, der gør
importen idempotent: `ext_id` matcher, så en gentaget import opdaterer i
stedet for at duplikere.

### Målt

| | |
|---|---|
| eksporten | 234 MB, 558 filer, 278 sider, 19 databaser (12 rigtige + 7 linkede visninger) |
| import | 12 notesbøger, 290 sider, 249 filer, 241 links, 109 mærker, 7 sprunget over |
| tid | **1,75 s** |
| sider opløst ned i en databasemappe | 272 af 278 |
| forside-rækker med link | 263 af 268 |

### Eksporten er rundturen

Zip med markdown-mapper (YAML-forside, som Obsidian og Bear skriver) og
`_files/` — plus en JSON-rundtur, der er projektets vigtigste test: fyld en
rigtig server, eksportér, **slet databasen og filmappen fysisk**, gendan, og
sammenlign felt for felt og filerne byte for byte.

To ting kom kun frem, fordi rundturen findes:

- **`note_links` skal ikke eksporteres.** Tabellen er *udledt* af teksten. En
  eksporteret udledning kan komme tilbage i utakt med det, den er udledt af.
  Links genopbygges derfor fra teksten ved gendannelsen.
- **`hentNote` udfyldte aldrig `tags`** — kun listerne gjorde. En fejl fra F0,
  der først kunne ses, da importen begyndte at sætte mærker.

## 10 · F6 · Wikien og offentliggørelsen

### Én skabelon mere, ikke SPA'en

Offentlige sider har deres **egen server-renderede skabelon** (`app/wiki.js`).
Grunden er ikke hastighed, men at der ikke er noget at spærre for: der findes
ingen `app.js` på siden, ingen `fetch` mod `/api/`, ingen session — så
spørgsmålet »kan en besøgende nå app-API'et« har et strukturelt svar frem for
et bevogtet.

Den arver hele udseendet gratis: `/style.css?v=N` med N læst ud af
`index.html` ved opstart, og tema-scriptet indsat **ordret**, så CSP-hashen
passer af sig selv (RUNE-ERFARINGER §9a). Nul ny CSS til indholdet — noten
renderes ind i **samme `.note-body`**, appen bruger, og kodeblokkene får
samme `.kodeblok`-ramme.

Wikiens egen `public/wiki.js` er 4 KB og gør præcis tre ting, HTML ikke kan:
kopier-knappen, temaskiftet og `/` til søgefeltet. **Alt andet virker uden
JavaScript** — navigation, søgning, links og temaet.

### Adgangsafgørelsen står ét sted

```
findUdgivelse(slug|token)  ->  null ved ukendt, tilbagekaldt, udløbet ELLER slettet rod
udgivelsensNoter(share)    ->  id-listen, som HVER rute spørger
```

Side, søgning, fil, ændringsliste og feed slår alle op i den **samme** liste.
To lister ville betyde, at den ene glemmer en spærring — og det var præcis
dét, saboteringen afslørede: `filIUdgivelse`'s id-filter kunne fjernes, uden
at en eneste test blev rød, fordi ingen test hentede en fil på en note *uden
for* udgivelsen. Testen findes nu.

**Arkiverede sider er MED i en udgivelse.** Arkivering er et personligt
læsefilter i appen; to regler om hvad der er udgivet ville betyde, at en side
kunne forsvinde for læseren, uden at nogen besluttede det.

### Kodeordet er en kontakt, ikke en ny adresse

`password_hash` sættes eller ryddes; `slug` og `token` røres aldrig. Cookien
er `hmac(server_secret, "wiki:<share>:<hash>")` — bundet til hashen, så et
**skift** lukker de gamle browsere ude af sig selv, uden at der skal ryddes op
nogen steder.

Uden kodeordet svarer **kun forsiden**, og den nævner ikke engang wikiens
titel. Alt andet er 404: søgning, feed, ændringsliste og filer. En dyb side
sendes til formularen med et `next`, der er **hvidlistet til udgivelsen selv**
— ellers er kodeordssiden en åben viderestilling, og det er præcis dér, den
besøgende er indstillet på at godkende noget (doda F12).

To spærrer på gætteriet: 20 pr. kvarter pr. IP og **60 i timen pr.
udgivelse**. Den anden er den, der bærer — bag en proxy er en IP bare en
header.

### Søgningen ER appens

Wikien kalder `soegNoter()` med en `ider`-afgrænsning. Samme rangering (titel
10 · overskrifter 5 · mærker 3 · brødtekst 1), samme uddrag med `<<`/`>>` →
`<mark>` **efter** escaping, samme afsnits-anker. Lagde wikien sin egen SQL
ved siden af, ville de to drive fra hinanden — og en spærring, der kun står
ét af stederne, er ingen spærring.

`allow_search` kan slå den fra pr. udgivelse; **en tom liste af id'er betyder
»ingenting«, ikke »ingen afgrænsning«** — den skelnen er én linje og hele
forskellen på et lukket og et åbent arkiv.

### Adresserne

`/w/<slug>` er den pæne, `/s/<token>` den uforudsigelige. Undersider får
**pæne slugs** udledt af titlen; dubletter og reserverede ord (`search`, `f`,
`changes`, `feed`, `password`) får et tal hængt på — samme greb som
rendererens overskrifts-id'er, så en side, der hedder »Search«, ikke kan
stjæle søgningens adresse.

### Tre ting, browseren rettede

- **`.meta` bed for tredje gang.** Et afsnitsnavn blev til »§ VPN-ADGANG« og
  et adresse-præfiks til »HTTP://LOCALHOST:8919/W/« — en adresse, der ikke
  findes. Kuren er ikke en note mere, men **`tests/form.test.mjs`**: en
  formregel, der læser frontend-kilden og fælder på enhver `.meta`, hvis
  indhold ligner prosa eller en adresse. Den er set fejle.
- **Navigationen skulle foldes sammen på mobil.** Første forsøg sendte
  `<details>` lukket og tvang den åben med CSS på desktop. Layoutet sagde ja
  (`display: flex`, 34 px høj), men punkterne blev **ikke tegnet** — og i et
  preview-panel kan jeg ikke afgøre, om det er panelet eller browseren. En
  navigation, hvis synlighed afhænger af, om et trick holder, er ikke noget at
  bygge en offentlig side på. Kuren er `order` i griddet: på en telefon ligger
  navigationen **under** artiklen, så læseren møder siden.
- **Kopier-knappen blev appens.** Min egen udgave lå oven på første kodelinje
  på en telefon. Appens `.kodeblok-top` findes allerede og har knappen i en
  række **over** blokken. Nu er der ét sæt CSS og ét udseende.

### Målt

| | |
|---|---|
| Offentlig side | to scripts i alt; ingen `/api/`-adresse i HTML'en |
| 375 px | nul overløb — hverken på dokumentet eller pr. element, hverken på wikien eller i udgivelsesruden |
| Kopier-knap | koden er **byte-identisk** efter et klik; fallbacken markerer teksten |
| Hele turen i en rigtig browser | udgiv → hent siden uden login → tilbagekald → 404 |

## 10b · Rettet efter F6, paa Andreas' foerste brugsdag

Alt herunder kom af, at appen blev brugt paa rigtige data - ikke af en test.

### Importen var idempotent paa TEKSTEN, ikke paa STRUKTUREN

Et Notion-arkiv importeret **foer** F5's mappe-rettelse laa forkert, og en
genkoersel reddede det ikke: siderne fik deres krop skrevet om og blev
liggende, hvor de laa. 278 »opdaterede« sider, og ikke én flyttede sig.

Strukturen kommer fra kilden — ogsaa anden gang. Genimporten saetter nu baade
notesbog og foraelder paa sider, den kender i forvejen, og **loesriver** en
side, eksporten siger ligger i roden. Flytningerne **taelles** og staar i
kvitteringen: en flytning i tavshed kan ingen gennemskue bagefter.

### macOS-skrald overskrev de rigtige sider

Pakker man eksporten om paa en Mac, ligger der en AppleDouble-fil ved siden af
hver rigtig fil: `._Titel <hex>.md` — **med samme id**. `sider` er en Map paa
id'et, saa tvillingen vandt. Resultatet var **297 tomme noter og 13 tomme
notesboeger** i stedet for arkivet, og intet fejlede: taelleren sagde 302.

Filteret ligger **foer** den faelles rod findes. `__MACOSX/` ligger ved siden
af eksportmappen; er den med i beregningen, findes der ingen faelles rod, og
saa forskydes hver eneste relative sti ét led.

### Loaderen: serveren kunne ikke svare, mens den arbejdede

»Der mangler en loader« viste sig at vaere tre ting:

- **Uploaden** havde ingen fremdrift. `fetch` kan ikke rapportere den; XHR's
  `upload.onprogress` kan. En 236 MB-eksport har nu en rigtig procent.
- **Forhaandsvisningen** laeser hele zip'ens indhold og kan ikke sige, hvor
  langt den er → en **ubestemt** bjaelke. En opdigtet procent, der staar
  stille, er vaerre end en stribe, der aabenlyst arbejder.
- **Importen selv** var ét langt synkront stykke arbejde, saa
  `GET /api/v1/import` blev slet ikke besvaret undervejs. Nu aander den
  (`setImmediate` pr. 25 poster), og fremdriften er **aegte**: maalt
  50/817 → 400/817 → 600/817 → 817/817. Prisen er 0,1 s.
  Og totalen taeller siderne **to gange** — de oprettes i ét trin og faar
  indhold i et andet — ellers staar bjaelken paa 100 % gennem hele den anden
  halvdel.

### Maerker fandtes i modellen, men ikke i appen

`tags` laa i skemaet fra F0 og blev sat af Notion-importen. Der fandtes ingen
vej til at saette et selv, og »Tags«-skaermen sagde stadig *»Tags arrive in
F3«* — laenge efter F3 var bygget. Det er den dyreste slags fejl: brugeren
tror, han bruger appen forkert (doda v38).

Tre veje ind, ÉN regel (`plukMaerker`): **+ Add a tag** under titlen,
`#drift` i titlen (tolkes naar man forlader feltet), og `#drift` i
soegefeltet, hvor et ukendt navn nu tilbyder *»Create a note tagged #drift«*.
Markoeren skal staa ved linjestart eller efter et mellemrum, saa
`dr.dk/nyheder#sport` ikke bliver et maerke.

To valg, der er vaerd at kende: et eksisterende maerkes **stavemaade vinder**
(at skrive »Drift« paa én note maa ikke doebe maerket om paa alle de andre),
og et maerke uden noter **ryddes op** — et maerke uden noter er ikke en
kategori, det er en rest.

### Sidebaren og de to flytninger

- **Notesbøgerne har faaet deres egen sektionsoverskrift** med en fold, som i
  resten af familien. Med tredive importerede boeger var sidebaren en mur uden
  en samlet vej til at lukke den. Foldningen bor i det **samme** saet som de
  enkelte boegers, saa der er én mekanik og ét sted, valget gemmes.
- **Import & export** flyttede ud af navigationen og ind i brugermenuen ved
  siden af Settings — det er noget, man goer et par gange i en apps levetid.
  Brugerknappen markeres nu paa **begge** de sider, der bor bag den; ellers
  lyser intet i navigationen, mens man staar paa dem (§9c).
- **Temaknappen** flyttede op i hoejre hjoerne, samme sted som i wikien, saa
  de to flader har samme vane.

## 10c · Bygget efter F6, paa Andreas' oenske

### En NOTESBOG kan udgives, ikke kun en side

»Jeg kan ikke markere en notebook og dele den.« Et importeret Notion-arkiv
**er** en bog med sider i - ikke en forside med undersider - og at kraeve en
kunstig forside for at kunne dele den ville vaere at bede brugeren lave om paa
sit indhold for appens skyld.

`shares.note_id` blev derfor nullable, `notebook_id` kom til, og en
`CHECK ((note_id IS NULL) <> (notebook_id IS NULL))` siger, at praecis ÉN af
dem skal vaere sat. SQLite kan ikke aendre NOT NULL paa en kolonne, saa m7
bygger tabellen om **med raekkerne flyttet med** - et link, nogen allerede har
faaet, skal leve videre.

Forsiden for en bog er **genereret**: bogens navn, et stort soegefelt, ét kort
pr. side i toppen og de fem senest roerte. Sider, der tilfoejes senere, kommer
med af sig selv; det er hele forskellen paa at dele en bog og at dele en
forside.

Adgangen gaar det samme sted som alt andet (`udgivelsensNoter`), saa en bog
ikke er en ny vej udenom.

**Testen fandt en fejl, mens den blev skrevet:** en underside oprettet under
en side i en notesbog arvede ikke bogen. `flytNote` havde altid syncet den;
`opretNote` gjorde ikke, og forskellen var usynlig - lige til en hel bog kunne
udgives, og siderne saa manglede.

### Wikiens soegefelt er levende - uden appens API

Feltet skal opfoere sig som det, man kender fra den indloggede side: traeffere
mens man skriver. Det maa bare ikke gaa gennem `/api/`. Svaret er derfor
**samme soegning paa udgivelsens egen adresse**
(`/w/<slug>/search?format=json`), og den er afgraenset af den samme id-liste
som alt andet. Der er intet at oprette og ingen notesboeger at hoppe til: en
laeser soeger i sider og maerker, og det er alt.

Uddraget escapes af **serveren** paa naer `<<`/`>>`, og klienten bytter dem til
`<mark>` efter sin egen escaping - saa der er ingen vej fra en notes tekst til
et tag, og serveren udsteder aldrig et tag i JSON. Der er test paa begge dele.

Uden JavaScript virker feltet stadig: formularen GETter til den samme adresse
og faar en almindelig resultatside.

### Maerker blev rigtige ting

Foerste udgave ryddede tomme maerker op automatisk. Det loed rigtigt og gjorde
»opret et maerke« umuligt - det forsvandt i samme sekund. Nu lever et maerke,
til nogen sletter det, og der er tre veje ind (`+ tag` paa noten, `#drift` i
titlen, `#drift` i soegefeltet), som alle gaar gennem ÉN regel
(`plukMaerker`).

`#` i soegefeltet **opretter maerket**, ikke en note med maerket paa: foerste
udgave lavede en tom note, og det er en anden handling end den, man bad om.

### Fire smaating, som alle er den samme lektie

En funktion, man ikke kan se, findes ikke for brugeren (tovo v8):

- **Flyt en note mellem notesboeger** kunne API'et fra F1; der var bare ingen
  knap. Nu i note-menuen.
- **Notesbogs-sektionen** har faaet en overskrift med en fold - og et separat
  greb til at folde de enkelte boeger. To forskellige oensker, to knapper.
- **Globus paa notesbogen** i sidebaren, samme ikon som paa en side: »del det
  her« ser ens ud, uanset hvad man deler. En udgivet bog lyser uden hover.
- **Navigationens titler** blev klippet haardt uden ellipse, fordi
  `.wnav-item > span { flex: none }` ogsaa ramte teksten. En regel skrevet
  efter PLACERING i stedet for efter hvad elementet ER - `.meta`-fejlen i en
  ny forklaedning.

## 10d · Anden runde paa brugsdagen

### En uendelig løkke, der lignede at siden »hoppede«

Efter en import gentegnede siden sig selv i det uendelige, saa kvitteringen -
med listen over det, der blev sprunget over - forsvandt, foer man kunne laese
den. Aarsagen var to funktioner, der kaldte hinanden:
`foelgImport()` kaldte `genindlaes()` naar en import var faerdig, og
`genindlaes()` kalder `foelgImport()`. Tilstanden (`done`) aendrede sig aldrig,
saa der var intet, der stoppede det.

**Maalt: 409 kald til `/api/v1/state` paa tre sekunder. Efter: ét.**

Kuren er et stempel (`ryddetEfter = st.startedAt`), saa oprydningen sker én
gang pr. import - og *ikke* en gentegning af kvitteringen, som ville rulle
siden og lukke »2 skipped — see why« igen.

Det generelle: **naar to funktioner kalder hinanden, skal mindst én af dem
kende en tilstand, der aendrer sig.** En betingelse, der er sand i dag og i
morgen, er ingen betingelse.

### Traek i traeet, og tre veje til det samme

»Man skal kunne flytte rundt paa raekkefoelgen med musen.« Pointer-events, ikke
HTML5 drag & drop (§4). Det, der falder, er en **soeskende** til den raekke,
man slipper paa - foer eller efter, afgjort af midten - saa der er ét at
forstaa, og linjen viser hvor. Slipper man paa en notesbog, flytter noten ind
i den.

Traekket er kun for **mus og pen**: paa en telefon ejer fingeren rulningen af
sidebaren, og et traek, der stjaeler den, goer listen ubrugelig. Derfor har
note-menuen ogsaa **Move up / Move down** og **Make it a subpage of X** - den
vej, der virker med mus, tastatur og tommelfinger (doda F3). To veje til det
samme, ikke to halve.

**Fundet undervejs:** `editor.note` er et objekt fra et tidligere kald, og
broedkrummerne og menuen laeser den. Efter en flytning stod de og sagde, hvad
der var sandt foer - menuen tilboed »Make it a subpage of X« igen paa en note,
der lige var blevet én. `synkAabenNote()` henter de to felter fra det friske
trae, og alle fire flyttninger kalder den.

### Wikiens forside blev til det, en forside skal vaere

Kort-gridet under soegefeltet sagde **praecis det samme** som navigationen til
venstre og »Recently updated« nedenunder. Tre lister over det samme paa den
side, folk lander paa, er ikke tre indgange - det er stoej. Og
»forrige/naeste«-baandet pegede tilfaeldigt hen: en wiki er ikke en bog, man
laeser forfra. Tilbage staar: soeg efter noget, eller se hvad der er nyt.

### Browserens egen kontrol er ikke altid en hel kontrol

`<input type="date">` kan ikke ryddes i Safari - der er intet kryds. En
udgivelse med en udloebsdato kunne derfor aldrig goeres permanent igen. Der er
nu en **»Never expire«**-knap ved siden af feltet, og den staar der kun, naar
der ER en dato at fjerne.

## 10e · Importen laeser nu brugerens egen struktur

»Hvorfor er min wiki endt under en notebook der hedder Imported from
Notion?« Fordi importen kun lavede notesboeger ud af **databaser**; alt andet
gik i opsamlingen. Men wiki-forsiden er en almindelig SIDE med hundredvis af
undersider - og det er praecis dét, en wiki er i Notion.

To slags notesboeger nu, og de er begge en beslutning, nogen har taget i
Notion:

1. **En database** - dens raekker er dens sider (krav 21).
2. **En side oeverst i eksporten, som HAR undersider.**

En enlig side oeverst bliver ikke en bog: en bog med ét blad er ingen bog.
Og **opsamlingsbogen laves foerst, naar en side skal ligge i den** - ellers
stod der en tom »Imported from Notion« efter hver import.

Maalt paa den rigtige eksport: 13 notesboeger med Andreas' egne navne, og en
opsamling paa **nul**.

**Og bogens sektioner ligger i TOPPEN af den.** Topsiden findes stadig som en
note (den baerer forsidens tekst), men dens boern loeftes op: ellers laa hele
wikien under »Haandbog > Haandbog > …«, og man skulle klikke forbi det
niveau hver gang. Prisen, sagt hoejt: paa praecis ét niveau udtrykkes
hierarkiet nu af bogen i stedet for af en foraelder - alt dybere er uroert.

**Wikiens sider har faaet en synlig »← Front page«.** Maerket i toppen linker
allerede hjem, og broedkrummen ogsaa - men ingen af dem ligner en knap, og en
laeser, der er landet dybt nede fra et link, leder efter noget at trykke paa.
En udvej skal kunne SES (doda v39).

## 10f · Importens interne links virkede ikke

»Hvorfor laver den disse links uden at de virker?« Importen skriver
`sagu-note:<id>` for hvert internt link mellem to importerede sider. Ingen af
dem blev oversat: `sikkerUrl` afviste dem med rette - de er ikke http(s) - og
hele krydsreferencenettet stod som **raa markdown med et hex-id i**, baade i
appen og paa wikien. Kvitteringen sagde »241 internal links rewritten«, og
facit var nul.

Kuren er vaertens `linkUrl`-krog, den samme som F4 lavede til vedhaeftninger -
og krogen kan nu sige **tre** ting:

| Svar | Betydning |
|---|---|
| en adresse | brug den |
| `null` | ikke min adresse - proev `sikkerUrl` |
| `false` | det ER min adresse, men den kan ikke naas herfra |

Den sidste er det, der goer, at et link til en note, der **ikke er udgivet**,
bliver til sit eget navn som doed tekst - i stedet for raa markdown med et id,
laeseren ikke maa naa.

To ting mere kom frem af den samme traad:

- **`tilTekst()` fjernede markoererne, men ikke adressen.** `[Se her](sagu-note:
  7ffd…)` blev til »Se her(sagu-note:7ffd…)« - og landede i den offentlige
  sides `<meta description>`. Linkets tekst betyder noget; adressen er
  maskineri.
- **Databasernes forsider blev bygget til sidst**, efter indholdet var
  skrevet, saa hvert link TIL en database blev staaende som en filsti.
  »Alle noter tomme, saa alle id'er kendes« gjaldt kun siderne. Nu oprettes
  forsiderne tomt i samme trin.

**Maalt paa det rigtige arkiv bagefter:** 281 virkende interne links (mod 241
»rewritten«, som ingen af dem var), og de 16 tilbage peger paa filer, der
aldrig var i eksporten - `README.md` og lignende fra GitHub-noter.

## 11 · Rettet i F0

- **En importeret titel på 90 tegn gjorde en tabelcelle 647 px bred i en 375 px
  skærm.** `min-width: max-content` er rigtigt til en bred tabel, men
  max-content har ingen øvre grænse. Loftet (`max-width: 22rem`, på mobil
  `60vw`) er lagt på **komponenten**, ikke som en lap på én tabel: Sagu
  importerer et helt arkiv, så den længste titel er ikke en, vi vælger.
  Efter: 225 px, tabellen 463 px, nul overløb.
  Samtidig fik den vandret rullende tabel **`position: sticky` på første
  kolonne** — uden den ruller navnet ud af syne, og så er den kolonne, man
  rullede hen til, ubrugelig (tovo v13).

---

## 12 · Målt og verificeret i F0

| Krav | Målt |
|---|---|
| Rune bygger | 38.137 tegn (30,3 % af loftet), YAML 84.338 b |
| To brugere, 404 overalt | 14 tests, begge vagter **set fejle** |
| CSRF-barriere | 415 uden `application/json`; nøgle må sende ren tekst |
| Rate-limit | 429 efter 15 forsøg; tælleren står i `rate`-tabellen |
| CSP-hash | matcher `sha256` af den faktiske tekst i `index.html` |
| Tre temavalg | målt på `getComputedStyle` — **»Lys« på en mørk maskine giver den lyse palet**, hvilket er det eneste, der beviser at dobbeltdeklarationen virker |
| 375 px | nul overløb på notelisten, søgningen, indstillingerne, den åbne sidebar og brugermenuen |
| De fire målinger | dette dokument |

---

## 13 · Auditten før et offentligt repo — 2026-08-21

Andreas: *»vi kan godt lave et offentligt på GitHub, men vi skal sikre at der
ikke er nogle følsomme data i de filer og beskrivelser, der bliver lagt op.«*
Det er en forudsætning for hele hente-udvejen, ikke en oprydning bagefter: et
offentligt repo er det, der gør install-scriptet 233 tegn i stedet for 600 og
gør en `secret: true`-variabel overflødig.

**Metoden.** Hele træet blev gennemsøgt for e-mailadresser, tokens og
nøglemønstre (`ghp_`, `sk-`, `AKIA`, `BEGIN … PRIVATE KEY`, `xox…`, `Bearer …`),
kodeord i kilden, IP-adresser, CPR- og telefonmønstre, absolutte stier med
brugernavn, og hver eneste eksterne vært, app-koden nævner.

**Intet hemmeligt fandtes.** Nul tokens, nul nøgler, nul kodeord uden for
testene (`kodeord-1234` og lignende, som er åbenlyse attrapper), nul
`/Users/…`-stier, nul rigtige IP-adresser — `192.168.1.5` og `203.0.113.9` i
testene er henholdsvis et opdigtet og et dokumentationsreserveret nummer.
App-koden når kun tre værter: `github.com`, `notion.so` og `dr.dk`.

**Fire ting blev fjernet, og alle fire var rigtige at fjerne uanset repoet:**

| Fund | Hvorfor det er et fund | Hvad der blev gjort |
|---|---|---|
| Et personligt `*.notion.site`-værtsnavn **hardkodet i app-koden** (`markdown.js`) | Et personligt Notion-arbejdsrum stod i en liste over »kendte værter« i en app, andre kan installere. Og listen kunne alligevel kun dække de arbejdsrum, nogen havde skrevet ned | Reglen er nu **endelsen** (`*.notion.site`) — en regel, ikke en liste (tools v1) |
| `andreas@omlidt.dk` i kommentar og test | En rigtig adresse i et offentligt repo er føde for skrabere. Eksemplet skulle kun vise, at et kolon i en adresse ikke er et filter | `navn@eksempel.dk` |
| Et rigtigt `ExportBlock-<uuid>` hardkodet i `notion.test.mjs` | Et rigtigt Notion-blok-id er i sig selv en oplysning om et privat arbejdsrum — og stien virkede kun på én maskine | Stien kommer nu fra `SAGU_NOTION_EKSPORT`; testen springes over uden den. Kørt igen med variablen sat: **290 sider, 13 notesbøger, 252 links** |
| Levende adresser (app-subdomæner under Andreas' egne domæner) i dokumenterne | Et endepunkt, der **er i drift**, er det tætteste på følsomt, repoet har: det inviterer til at blive prøvet af | Sløret til `<mit-domaene>` |

**Det, der blev stående, og som er Andreas' valg — ikke en fejl:**

- **Navnet »Andreas« omkring 60 steder** i kommentarer og dokumenter (»Andreas,
  2026-08-21« som kilde til en beslutning). Det er projektets stemme, og
  kontoen hedder alligevel `andreasdinesen`. Det kan blive stående.
- **»Hjorten«** som servernavn i testdata og dokumenter. Der står ingen
  IP-adresse nogen steder i repoet, så navnet alene er bare et navn.
- ~~Navnet på arbejdspladsens produkt i testfikstur og i eksemplerne på »et
  ord inde i et ord«.~~ **Fjernet 2026-08-21 på Andreas' anmodning.** Det sagde
  intet om indholdet, men det sagde, hvad arbejdspladsen bruger — og et
  eksempel skal vise sin POINTE, ikke hvor det kom fra. Fikstur og eksempler er
  nu neutrale (`backup-nat.log`, `logAnonymizer`, `Haandbog`).
- **De interne dokumenter** (`DESIGN.md`, `SAGU-PLAN.md`, `docs/`, `START.md`,
  `CLAUDE.md`). De er skrevet til den næste, der arbejder på appen, og de er
  det bedste, repoet har at forklare sig med — men de fortæller også, hvordan
  der arbejdes, og hvad der er gået galt undervejs. **Anbefalingen er at lade
  dem stå:** de er grunden til, at repoet er værd at læse.

**Reglen, der gælder fremover:** repoet er offentligt, så en ny hemmelighed må
aldrig havne i en kildefil. Tokens hører i `settings` som `secret: true` eller
i en rune-variabel — begge dele forlader aldrig serveren (§2).

---

## 14 · F7 · Kommentarer

Andreas' krav 10 (»kommentarer på noter, som i Notion«) og 13 (»pr. udgivelse
vælges kommentarer ja/nej«) i én model. Fasen har to flader med **hver sin
risiko**, og det er dét, der bestemmer designet:

| | I appen | På wikien |
|---|---|---|
| Hvem skriver | en bruger med konto | en **gæst** uden konto, der ikke kan genkendes |
| Hvornår er den synlig | med det samme | når ejeren har set den |
| Hvad den er | data | **fremmed indhold på et offentligt domæne** (R4 + R6) |

### Én model, to veje ind — og forskellen bor ét sted

`opretKommentar()` er den eneste vej ind i tabellen, og `origin` afgør
resten. Lå gæstereglerne i wiki-ruten og brugerreglerne i API-ruten, ville de
to kunne komme ud af trit — og den, der driver, er altid den, ingen kigger på.

Tre valg i skemaet, som er dyre at lave om bagefter:

- **`origin` ved siden af `share_id`.** Fristelsen er at lade
  `share_id IS NULL` betyde »skrevet i appen«. Men `ON DELETE SET NULL` ændrer
  en *værdi* frem for at fjerne en række: tilbagekaldes udgivelsen, ville en
  gæstekommentar pludselig ligne ejerens egen. Det er F3's `SET NULL`-lektie
  brugt et nyt sted — **spørg, om værdien var det eneste spor.**
- **`status` er en tilstand, ikke et flag** (`pending`/`published`/`rejected`).
  En afvist kommentar **slettes ikke**: den skal kunne fortrydes, og et arkiv,
  der taber det, nogen skrev, er ikke et arkiv.
- **`edited_at` frem for `updated_at > created_at`.** Begge står i sekunder, så
  en rettelse i samme sekund ville være usynlig. Det er den samme regel som
  `archived_at`/`deleted_at` — og testen fandt den med det samme.

**Tråden er ét niveau.** Et svar på et svar hænger på toppen af tråden.
Notion gør det samme, en dyb tråd i en moderationskø er ulæselig — og
sidegevinsten er, at der ikke *kan* opstå en ring, så der er ingen cyklus-vagt
at huske (modsat notetræet i F1).

### Spam: fire spærrer, og den fjerde afviger fra planen med vilje

1. **Moderationskø som standard** (`shares.moderate_comments`, default 1).
2. **Honningkrukke.** Et felt uden for skærmen med `tabindex="-1"`. Et udfyldt
   felt får **samme kvittering som alle andre** og gemmes ikke — en
   fejlmeddelelse ville bare fortælle robotten, hvilket felt den skulle lade
   være med at udfylde. (`display:none` er den dårlige løsning: mange robotter
   springer skjulte felter over.)
3. **Rate-limit i to lag:** 10/time pr. IP og 60/time pr. **udgivelse**. Den
   anden er den, der bærer — bag en proxy er en IP bare en header. Samme
   opdeling som kodeordsspærren i F6.
4. **Links.** Planen sagde »ingen links i første kommentar fra en ukendt«. At
   afgøre, hvem der er »kendt«, kræver, at man **gemmer noget om den
   besøgende** (en IP, en cookie) — og wikien måler med vilje kun tal, aldrig
   personer. Reglen er derfor: **en gæstekommentar med et link modereres
   altid**, også når ejeren har slået køen fra. Den dækker det samme (et link
   slipper aldrig ubemærket forbi) uden at gemme noget om nogen.

### Wikien har stadig ingen app-JS

Formularen er ren HTML: `<form method="post">`, POST → omdirigering → GET, så
en genindlæsning ikke sender igen. Et **svar er et link** (`?reply=<id>`), der
tegner formularen ét sted længere nede — ikke en knap, der folder noget ud.
Der er en test på, at siden stadig kun henter to scripts og ingen `/api/`-adresse.

Kommentarteksten går gennem **samme renderer** som noterne, men med krogene
slået fra: en gæst må ikke kunne pege på en vedhæftning eller en anden note
med en `sagu:`-adresse, som han umuligt kan kende id'et på. Og `noFoelg`
sætter `rel="nofollow ugc"` — fremmed indhold på ens eget domæne må ikke kunne
bruges til at give en fremmed adresse vægt. Notens **egen** tekst får det
ikke; der er en test på begge halvdele.

### »Notifikation« er et tal, ikke en kanal

Planen sagde web-push (dodas stak). **Det er udskudt, og det er et valg, ikke
en forglemmelse:** Sagu har ingen service worker overhovedet, så push ville
betyde at bygge en PWA-stak først — og Claude Codes browserpanel kan slet ikke
registrere service workers (doda F6), så registreringen kunne ikke verificeres
her. En påstand er ikke en funktion. Push hører derfor sammen med PWA-arbejdet
i **F13**.

Det, der blev bygget i stedet, dækker behovet: **et tal i navigationen** og en
**Comments-skærm** med Waiting/Published/Rejected, hvor hver linje siger,
hvilken note kommentaren står på, og linker derhen. Plus tallet i
udgivelsesruden med ét klik til køen. En moderationskø, man skal lede efter,
er en kø, der aldrig bliver tømt (tovo v8).

### Fundet undervejs: F6's grid stod på kildeordenen

Kommentarformularen var **240 px bred på en 1280 px skærm**. Målingen viste, at
det ikke var formularen: hele `.wmain` var 240 px. Grid'et er
`240px minmax(0,1fr) 200px`, og navigationen udelades ved under to sider — så
**indholdet rykkede op i navigationens spor**, og sideoversigten fik de 748 px.
Enhver udgivelse med én side har set sådan ud siden F6, uden at noget fejlede.

Kuren er eksplicit placering (`.wmain { grid-column: 2 }`) plus tre regler for,
hvad der sker, når en nabo mangler. Det er `.meta`-fælden i endnu en
forklædning: **skriv hvad elementet ER, ikke hvor det tilfældigvis står.**

Samme runde: wikien havde et »Reply«-link på et svar, som appen ikke havde.
To modsatte konventioner side om side er tovo v9's fejl — wikien følger nu
appen.

### Målt

| | |
|---|---|
| Tests | **217 grønne** (+21 i `tests/kommentar.test.mjs`), 1 sprunget over |
| Hver vagt set fejle | honningkrukke · link-reglen · `allow_comments` · notens adgangsregel · `nofollow` — én rød hver |
| Sabotage, der gav **0** røde | afgrænsningen til udgivelsens noter → **testen manglede**, ikke koden var robust. En notesbogs genererede forside var den tilstand, ingen test ramte. Testen findes nu og er set fejle |
| Payload, hvis den var indlejret | **117.925 tegn = 93,6 %** af det gamle loft — F7 alene kostede 6,8 procentpoint |
| 375 px | nul overløb, hverken på dokumentet eller pr. element, på begge flader |
| Wikien | to scripts, ingen `/api/`-adresse, ingen app-JS |

---

## 15 · Den offentlige adresse — 2026-08-21

Andreas: *»Sagu kommer til at køre på `sagu.<domæne>`. Men jeg kommer også til
at pege `sagu.dk` på den. Så det skal være muligt at give den en offentlig
adresse i indstillinger.«*

**Problemet er ikke visningen — det er, at der ikke længere findes ét svar.**
Uden et valg svarer hver flade med den vært, DEN blev kaldt på:

- et link, man kopierer fra udgivelsesruden, hedder noget forskelligt alt
  efter, hvilken adresse man selv sad på;
- feedets absolutte adresser peger tilbage på den vært, læseren tilfældigvis
  abonnerede fra;
- og en søgemaskine ser den samme side på to domæner, altså som to sider med
  samme indhold.

**Løsningen er ét felt ét sted:** `public_url` i installationens settings
(scope `*`, kun admin). Er den ikke sat, er alt præcis som før — kaldets egen
vært. Fire ting er værd at holde fast i:

- **Kun en OPRINDELSE godtages.** En sti ville lande midt i hver eneste
  adresse, appen danner; en query eller et fragment giver ikke mening i en
  vært. `https://sagu.dk/`, `…/w`, `…?x=1`, `javascript:` og `file:` afvises
  alle — og en afvisning lader den gamle værdi stå.
- **Den bruges ALDRIG til en omdirigering.** Kun til at *vise* og til
  `canonical`/`og:url`. Et adressefelt, der kan ende i et `Location`, er en
  åben viderestilling med en pæn etiket. Alle wikiens omdirigeringer er
  relative, og `next` er stadig hvidlistet til udgivelsen selv (doda F12).
  Der er en test på begge dele.
- **`canonical` + `og:url` kom til samtidig.** De fandtes ikke før, fordi der
  kun var én adresse. Med to er de forskellen på én side og to.
- **Frontenden bruger samme valg** (`offentligBase()`): udgivelsesruden skriver
  linket med den offentlige vært i stedet for `location.origin`.

### Fundet undervejs, og det var en rigtig fejl

**Udgivelsesruden vidste ikke, hvilken note den handlede om.** Knappen var
bundet som `addEventListener('click', visUdgivPanel)` — så blev *klik-hændelsen*
funktionens første argument. En MouseEvent er sand, så ingen vagt slog til:
overskriften stod som `Publish “”`, og værre, opslaget efter notens
eksisterende udgivelse skete på `undefined`. **Ruden meldte derfor hver eneste
udgivet note som ikke-udgivet.**

Kuren er to ting og en tredje:

1. `() => visUdgivPanel()` — argumentet skal være valgt, ikke arvet.
2. En vagt i ruden (`maal && maal.slags`), så en fremtidig fejlbinding ikke kan
   arbejde videre på et mål uden id.
3. **En formregel i `tests/form.test.mjs`:** bindes en funktion ved navn som
   handler, skal dens første parameter være hændelsen. Reglen læser kilden,
   springer kommentarer over (den faldt først over sin egen advarsel) og
   krydser ikke modulgrænser (`opret(srv)` i `wiki.js` er ikke den `opret`,
   `p2_pages.js` binder). **Set fejle på den gamle kode**, og målemetoden er
   selv testet.

Det er tredje gang i denne kodebase, at kuren på en fejl er en formregel og
ikke en note. Mønsteret holder: *en note virker kun, mens man husker at læse
den.*

### Fjernet samme dag

Alle spor af arbejdspladsens produktnavn er væk fra testfikstur, kommentarer og
dokumenter (`Haandbog`, `backup-nat.log`, `logAnonymizer` i stedet). Et
eksempel skal vise sin **pointe**, ikke hvor det kom fra — og repoet er
offentligt.
