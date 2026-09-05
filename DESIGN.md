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

**Busybox-spørgsmålet — lukket 2026-08-21.** Alt var kørt på macOS med bsdtar,
og `tar x -C` + `find -maxdepth` var valgt, fordi de er det mindste, busybox
skal kunne. Det kunne ikke afprøves her: Hjorten svarer ikke fra denne maskine,
og der er ingen container-runtime. **Prøven blev installationen selv** — Sagu
v1 er installeret på Hjorten og svarer på `sagu.<mit-domaene>` (v1,
`needsSetup: false`, 154 ms rundtur gennem tunnelen, altså præcis måling 3's
tal). Hentningen, udpakningen og ombytningen kørte i `node:24-alpine` uden en
eneste tilpasning.

Lærestregen om metoden holder alligevel: det var rigtigt at sige højt, at det
var ubevist, frem for at lade en grøn testsuite se ud som et fuldt bevis.

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
| En rigtig mailadresse i kommentar og test | En rigtig adresse i et offentligt repo er føde for skrabere. Eksemplet skulle kun vise, at et kolon i en adresse ikke er et filter | `navn@eksempel.dk` |
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

---

## 16 · F8 · doda-integrationen — Sagus halvdel

Krav 17, og planens »den vigtigste enkeltdel«. **Halvdelen her er Sagus:** at
sende en opgave og vise, hvad der blev af den. Den anden halvdel — `app/sagu.js`
inde i doda, `*` i dodas fangstfelt, søgning i Sagu fra doda — er et andet
repo og en anden udgivelse.

### URL og nøgle, ikke et containernavn

Skemaet er entydigt (måling 3): det private bridge-net gælder sidecars inde i
én rune, og der er ingen navneopløsning mellem to runer. Feltet er derfor en
adresse og en nøgle, brugeren selv sætter — som MsGraphBud allerede gør i
drift. Og fordi feltet **er** en URL, er genvejen gratis: peges den på LAN-
adressen i stedet for på tunnelen, forsvinder de ~150 ms uden en linje kode.

Forbindelsen er **personlig** (scope = brugerens id). Sagu er flerbruger, og to
brugere deler ikke doda.

### Aldrig et kald pr. optegning

Rundturen er målt til 140–190 ms. En note med fem opgaver ville være næsten et
sekund, hvor der ikke sker noget. Derfor:

- Status står i Sagus **egen** tabel (`doda_tasks`, m9) og læses derfra.
- Den opfriskes højst **én gang i kvarteret**, og kun når en note åbnes.
- Opfriskningen er **ét** kald (`/changes?since=`) for alle brugerens opgaver
  — ikke ét pr. opgave. Vandmærket står i settings og overlever en genstart.

Der er en test på begge dele: ti opslag i træk skal give **nul** kald, og tre
opgaver skal give **ét**. Attrappen tæller selv, så reglen er målt frem for
beskrevet.

### Fejlstien er den vigtige

En bro fejler oftere end den lykkes, og de tre fejl fører til hver sin
handling — så de skal kunne skelnes:

| | Hvad brugeren skal gøre |
|---|---|
| `unreachable` | se på adressen, og på om doda kører |
| `bad_key` | lave en ny nøgle |
| `wrong_scope` | *ikke* skifte nøglen ud — den er i orden, bare for smal |

Den sidste er værd at holde adskilt: blander man den med `bad_key`, skifter
brugeren en nøgle ud, der er helt i orden — og dodas egen besked siger allerede
præcis, hvilket scope den har. Den sendes derfor **ordret** videre.

**Nøglen prøves, før den gemmes**, og rulles tilbage ved fejl. Ellers ligger et
forkert token og *ligner* en virkende forbindelse, indtil man prøver at bruge
den (doda v16). Og en `capture`-nøgle er ikke en fejl: den kan stadig oprette,
og forbindelsen siger så højt, at status ikke kan vises.

**En fejlet forbindelse er ikke en fejlet gemning:** ruten svarer 502 (ikke
500), og en fejlet *opfriskning* rører ikke rækkerne — de står der stadig med
det, de sidst vidste, og siden siger hvorfor de ikke er friske. En bro, der
bliver tom, når den anden ende er nede, ligner en bro, der har mistet noget.

### `link`-scopet, og hvorfor det måtte findes

`capture` kan oprette og se ingenting; `read` kan se og oprette ingenting. Det
er den rigtige opdeling for en telefon, men den kan ikke udtrykke det, en
søsterapp har brug for: doda skal kunne **søge** i noterne og **oprette** én —
og ikke andet. Uden `link` måtte doda have en `full`-nøgle, og så ville en
integration, der kun skriver links, også kunne slette hele arkivet.

`write` er stadig forbeholdt `full`. Det er præcis planens accept: *nøglen i
doda har read+capture og kan ikke slette noter.*

### Målt mod en RIGTIG doda — og det var dét, der fandt fejlen

Attrappen dækker fejlstierne, men den er min egen forståelse af doda. Derfor
blev en rigtig doda startet ved siden af og forbundet.

**Første forsøg hang linket på enden af linjen med et tankestreg. Det kostede
både linket og datoen:**

```
samme linje   →  titel »Ret trin 2«, due: null,     note: ''
egen linje    →  titel »Ret trin 2«, due: i morgen, note: <adressen>
```

Dodas `!`-markør løber til linjens ende, så `!i morgen — http://…` blev ét
datoudtryk, der ikke gav mening. Opgaven kom ind uden forfaldsdato og uden
link, og **intet fejlede**. Kuren er ikke omhu, men formatet: adressen får sin
egen linje, modtageren læser første linje som titel og resten som beskrivelse,
og så lander den præcis, hvor den hører hjemme.

Reglen er generel og værd at kunne udenad: **at hænge noget PÅ en linje, hvis
syntaks er åben, er at give det væk** (MsGraphBud v6).

I Sagus egen liste fjernes adressen igen — den peger tilbage på den note,
rækken allerede står på. *Linkets tekst betyder noget; adressen er maskineri.*

### Målt

| | |
|---|---|
| Tests | **243 grønne** (+17 i `tests/doda.test.mjs`), 1 sprunget over |
| Hver vagt set fejle | tilbagerulning · `wrong_scope` · friskheds-tjekket · »listen tømmes ikke« · `link` må ikke skrive · rensning af titlen |
| Ti opslag i træk | **nul** kald til doda |
| Tre opgaver, én opfriskning | **ét** kald |
| Mod en rigtig doda | opgave sendt med kontekst, forfaldsdato og link i beskrivelsen · tikket af i doda · slog igennem i Sagu ved opfriskning, og **ikke** før |
| 375 px | nul overløb, hverken på dokumentet eller pr. element |

### Det, der ikke er bygget her — og hvorfor

`+` i søgefeltet og opgaveruden på noten dækker »fra Sagu mod doda«. Resten af
planens F8 hører i **doda**: `app/sagu.js`, søgning i Sagu inde fra doda, at
hænge en note på en opgave via `link_url`, og `*` i fangstfeltet. Sagus side af
dét er allerede på plads: den smalle dør (`POST /api/v1/notes` med `link`) er
bygget og testet — det var netop dén dør, der gjorde MsGraphBud billig.

---

## 17 · F9 · API'et og iPhone-genvejene

Krav 19. Det meste af laget lå der fra F0 — nøgler med scopes, hash-lagret,
`sidst brugt`-stempel, øjeblikkelig tilbagekaldelse. **F9 er dét, der gør laget
brugbart fra en telefon.**

### En genvej har ét tekstfelt og ingen tålmodighed

Den kan ikke bygge JSON, ikke læse en fejlkode og ikke spørge om noget. Alt i
`POST /api/v1/capture` følger af det:

- **Fire veje ind:** JSON, formulardata, ren krop og `?text=` i adressen.
- **Svaret har en færdig `message`-linje**, genvejen kan vise ordret. Uden den
  skal den bygge en sætning af felter, og det kan den dårligt.
- **Første linje er titlen, resten er noten** — den regel resten af familien
  allerede bruger (MsGraphBud → doda), og den eneste, man kan gætte på.
- **`#mærke` tolkes af den SAMME regel som i titelfeltet.** Reglen lå kun i
  frontenden, så den flyttede til `app/shared/maerker.js` frem for at blive
  kopieret: der må ikke findes en særlig API-vej ind i dataene (§9a).
- **`?notebook=Drift` virker på NAVN.** En genvej kan ikke slå et id op, og at
  kræve ét ville betyde et kald mere — så er »ét felt og en knap« væk. En bog,
  der ikke findes, fælder ikke fangsten: teksten er det vigtige.

### `to=today` — og hvis dagen er en anden

`to=today` føjer til dagens note i stedet for at lave en ny. Det er dét, en
genvej oftest skal: samle dagens småting ét sted.

**Reglen for »i dag« lå to steder og var uenig med sig selv.** Frontenden
regnede lokal tid, `/state` regnede UTC — og de første timer af døgnet i dansk
tid pegede de på hver sin dag. Ingen brugte tallet endnu, så det var en fejl,
der ventede. Nu bor reglen ét sted på serveren, og **en klient kan sende sin
egen dato** (`?date=`): telefonen ved bedre end serveren, hvornår det er i dag
hos brugeren. En værdi, der ikke er en dato, falder tilbage til serverens dag
frem for at fælde fangsten.

### Billedet fra delingsmenuen

`POST /api/v1/capture` med en `image/*`-krop bliver til en note med billedet i.
Det er med vilje muligt med `capture`: **at lægge noget nyt ind er ikke det
samme som at måtte rette i alt, hvad der ligger.** Den almindelige fil-rute
kræver stadig `write`, fordi den kan hænge en fil på en hvilken som helst note.

### Ud igen

- **`?format=md`** giver noten som ren markdown — ikke JSON at grave i.
  Markdown *er* sandheden i databasen, så der er intet at konvertere; det er
  hele udbyttet af beslutning 1. Og **har noten sin egen overskrift, står den
  urørt**: første udgave klippede den af og satte titlen ind, så dagens note
  blev til `# 2026-08-21` i stedet for `# Friday, 21 August 2026`, som
  brugeren faktisk havde stående. At skrive om på nogens tekst er værre end at
  gentage en titel.
- **`GET /api/v1/changes?since=`** fortæller også, hvad der er **slettet**. En
  liste over det, der findes, kan ikke sige, at noget er forsvundet — og en
  klient, der kun ser tilføjelser, samler på spøgelser (doda F9).

### To huller, som først kom frem ved at køre som en rigtig klient

**`curl --data '…'` sætter form-typen af sig selv.** Hele sætningen blev til et
tomt felt med et mystisk navn, og fangsten svarede »send noget tekst«, selv om
teksten var der. Min egen test sendte slet ingen Content-Type og gik fri.
»Tilgivende« skal betyde det: er der ingen felter at genkende, **er** kroppen
teksten.

**Der var ingen `WWW-Authenticate` på et 401.** Uden den ved en klient ikke, at
der findes en måde at godkende sig på, og prøver i ring. Det er samme header,
F10's connector-opdagelse hænger på: svarer `/mcp` 401 uden den, opgiver
klienten forbindelsen, *uden at noget ser i stykker ud* (§9a, fælde 1).

### Guiden er en kravspecifikation — så den blev en formregel

»En hjælpetekst, der beskriver en funktion, som ikke findes, er den dyreste
slags fejl: brugeren tror, han bruger den forkert« (doda v38). Tredje gang den
mekanik bider i familien, så den er nu en **regel og ikke en note**:
`tests/form.test.mjs` læser opskrifterne og slår hver **metode og adresse** op
i serverens ruter.

Første udgave slog kun *stien* op — og tre ruter (`GET`, `PATCH`, `DELETE`)
deler det samme mønster, så en omdøbt GET-rute blev ikke fanget. Det opdagede
jeg ved at sabotere netop den. **En regel, der måler mindre, end den lyder
til, er den samme fejl som en test med et for stort navn.**

Guiden skriver adresserne med `offentligBase()` (§15), så en opskrift, man
kopierer, peger det rigtige sted hen uanset hvilken vært man selv sad på.

### Målt

| | |
|---|---|
| Tests | **266 grønne** (+22 i `tests/api.test.mjs`, +2 formregler), 1 sprunget over |
| Hver vagt set fejle | scopet på fangsten (14 røde) · de slettede i `changes` · `#mærke`-reglen · `to=today` · `WWW-Authenticate` · `format=md` på en fremmed note |
| Hele scope-matricen | målt **uden cookie** — `capture` kan skrive og læse intet, `read` kan læse og skrive intet, og **ingen** nøgle kan lave nøgler, skifte kodeord eller røre serverindstillinger |
| Kørt som en rigtig genvej | ren tekst → note med mærke · `to=today` to gange → ét sted, i rækkefølge · `?format=md` → ren markdown |
| Payload, hvis den var indlejret | **127.927 tegn = 101,5 %** af det gamle loft. F9 alene ville have sprængt det |

## 18 · F10 · MCP-serveren og connectoren til claude.ai

**Bygget 2026-08-21.** Ni værktøjer over JSON-RPC, og hele OAuth 2.1-flowet,
så claude.ai's webklient kan forbinde sig selv — uden at nogen kopierer en
nøgle nogen steder hen.

### Motoren blev flyttet, ikke skrevet

`app/oauth.js` er **porteret næsten ordret fra doda**. Det kunne lade sig gøre,
fordi den ikke kender hverken database eller HTTP: den får seks funktioner ind
(`gemKlient`, `hentKlient`, `udstedTokens`, `findRefresh`, `tilbagekaldRefresh`)
og rører aldrig et `res`. Alt det Sagu-specifikke — tabellerne, samtykkesiden,
ruterne — står i `server.js`.

Det er fjerde gang, den mekanik betaler sig: **en motor, der ikke kender sin
omverden, kan flyttes; en, der gør, skal skrives om.** Det, der VAR anderledes
her, står nedenfor.

### Access-tokens fik ingen ny tabel

De går gennem `opretToken` og ender i `tokens` — præcis som en håndlavet nøgle,
bare med et `client_id` og et `expires_at` (de to kolonner blev lagt ind
allerede i m1 til netop det). Så er der **én vej ind i API'et**, og `findToken`
er det ene sted, en nøgle kan vise sig ugyldig. To tabeller ville betyde to
steder at huske et tilbagekald — og den slags glemsel opdages først, når
nogen prøver at lukke noget ude.

`oauth_refresh` er derimod sin egen: et refresh-token er ikke en adgangsnøgle,
kan ikke bruges på API'et, og **roterer** — den gamle dør i samme øjeblik den
nye fødes, så en stjålet kopi kun virker én gang.

Nøglelisten filtrerer på `client_id IS NULL`. Uden det ville et OAuth-token stå
under »Access keys« som en nøgle, man ikke kan huske at have lavet.

### Det, der var Sagus eget: **appen er flerbruger**

I doda hører en forbindelse til installationen. Her hører den til **den, der
trykkede »Allow«** — og det gennemsyrer tre steder:

- `tokens.user_id` og `oauth_refresh.user_id` bærer brugeren, så et
  connector-token når præcis den ene brugers arkiv. Filteret ligger som altid i
  `hentNote`/`gemNote` selv, ikke i MCP'ens værktøjer.
- `hentForbindelser(userId)` og `tilbagekaldKlient(userId, clientId)` har
  `user_id` i **hver eneste** WHERE. Klientrækken er kun et navn og en
  adresseliste og deles gerne; tokens gør ikke. Uden filteret ville en
  tilbagekaldelse rive den anden brugers forbindelse med — testen
  »en forbindelse hører til den, der godkendte den« er sat til at fange det.
- Samtykkesiden skriver, **hvem** man godkender som (`Signed in as …`). To
  brugere i samme browser er ellers to identiske sider.

### Kun `read` og `full` tilbydes over OAuth

Sagu har fire scopes, men `capture` og `link` er lavet til en genvej og til en
søsterapp, der kender sin egen opgave. En connector forhandler sin rettighed
gennem en **samtykkeside**, og den skal kunne beskrives i én sætning til den,
der trykker »Allow«. »Kan skrive, men ikke læse« er ikke en sætning, nogen
træffer et valg på. De to smalle scopes laves i hånden under Settings, hvor der
står, hvad de kan.

### To fælder, der fejler tavst — og derfor har hver sin test

**1 · CORP kasserer svaret EFTER CORS-tjekket.** `securityHeaders` sætter
`Cross-Origin-Resource-Policy: same-origin`, og den spærrer et
opdagelsesdokument, selv om `Access-Control-Allow-Origin: *` står der. De fire
offentlige OAuth-ruter sætter derfor `cross-origin` selv.

**2 · `form-action 'self'` dræber »Allow«-knappen.** Direktivet håndhæves også
på den **omdirigering**, indsendelsen fører til — ikke kun på formularens egen
adresse. Samtykkesiden POSTer til sig selv, men svarer 302 til klientens
`redirect_uri`, og med bare `'self'` blokerer browseren hele indsendelsen:
ingen navigation, ingen serverlog, intet at fejlsøge på. Derfor tilføjes
præcis den ene oprindelse, klienten er **registreret** med — ikke `https:` i
al almindelighed. En test med en redirect tilbage til samme vært ville aldrig
have fanget det.

### Formularlæseren åd samtykkeformularen

`readJsonBody(req, tilgivende)` faldt tilbage til »hele kroppen ER teksten«,
når der ikke var et `text`-, `title`- eller `note`-felt blandt formularfelterne.
Den regel blev skrevet til `curl --data 'noget tekst'` (F9) — men
samtykkeformularen har syv rigtige felter og ingen af de tre navne, så hele
indsendelsen blev til én tekststreng, og »Allow« svarede **400**.

Kendetegnet er ikke, hvad felterne **hedder**, men at der ikke er ét eneste
`=` i kroppen: altså præcis ét felt uden værdi. **En regel, der kender
feltnavne, kender kun de kald, den blev skrevet til.**

### Udgivelsen fik ét sted at blive til

`publish_note` skal ramme de samme spærringer som knappen i appen — SKRIVBAR
frem for SYNLIG, »allerede udgivet«, slug-reglen, kodeordslængden. Derfor blev
rutens krop trukket ud i `opretUdgivelse(userId, o)`, og ruten er nu tre
linjer. To kopier ville betyde, at den ene glemte en af spærringerne, og det er
den slags glemsel, der lige præcis rammer noget, der ligger **på nettet**.
Samme øvelse gav `hentMaerker()` og `udgivNote()`.

### Målt

| | |
|---|---|
| Tests | **313 grønne** (+25 i `tests/mcp.test.mjs`, +21 i `tests/oauth.test.mjs`), 1 sprunget over |
| Hver vagt set fejle | 12 sabotager, alle røde: Origin-tjekket · scopet i `tools/list` · scopet ved kaldet · `form-action` · PKCE · engangskoden · refresh-rotationen · `resource_metadata` · `user_id` i tilbagekaldet · nøjagtig `redirect_uri` · samtykke-beviset · en omdøbt rute bag opdagelsesdokumentet |
| Scope i praksis | en `capture`-nøgle ser **præcis ét** værktøj; `link` ser aldrig et, der skriver; listen er en hjælp, og `tools/call` tjekker igen |
| To brugere | en connector-nøgle finder ikke den anden brugers note — hverken ved søgning eller på id — og en tilbagekaldelse rører kun ens egen forbindelse |
| Payload, hvis den var indlejret | **137.479 tegn = 109,1 %** af det gamle loft |

## 19 · F11 · Deling mellem konti

**Bygget 2026-08-21.** Datalaget har ligget der siden F0 (`user_id` og
`note_acl` kan ikke eftermonteres); denne fase er dét, der skulle bygges
ovenpå — og de otte huller, delingen åbnede i kode, der så rigtig ud, så
længe der kun fandtes én konto.

### Målt: arven regnes af det levende træ

Deles en side, deles det, der ligger under den. Spørgsmålet var, om
inheritance skulle **materialiseres** (en ACL-række pr. underside) eller
**regnes**. SQLite tillader en korreleret `WITH RECURSIVE` inde i `EXISTS`, så
det kunne måles frem for gættes.

**Måling 5** — 4.840 noter, dybde 5:

| | |
|---|---|
| Fuldt scan som **ejeren**, uden arv | 0,13 ms |
| Fuldt scan som **ejeren**, med arv | **0,13 ms** |
| Fuldt scan som den, noten er delt med | 8,8 ms |

Ejeren betaler **ingenting**, fordi `n.user_id = ?` står først i OR'en og
kortslutter den — gennemløbet køres aldrig. Det er den vej, hvert eneste af
Andreas' egne kald går. Værste tilfælde (en konto, der ikke ejer noget, scanner
alt) er 8,8 ms.

Derfor: ingen materialiseret tabel, ingen hurtig sti. **OR'ens kortslutning ER
den hurtige sti.** Og vigtigere end millisekunderne: der er intet at holde i
takt. En ACL-kopi pr. underside skulle vedligeholdes tre steder — når nogen
laver en underside, flytter en ind, flytter en ud — og en udledt tabel, der
skal vedligeholdes tre steder, driver fra det, den er udledt af. En
adgangsfejl af den slags er tavs: den ser rigtig ud, lige til den ikke er det.

To tests står vagt om netop dét, en kopi ville have fået galt i halsen: en
underside lavet **bagefter**, og en note flyttet **ud** af træet igen.

### `write` betyder »skriv i den«, ikke »bestem over den«

Fire ting kan kun ejeren — slette, udgive, dele videre og give siden fra sig —
og de har deres eget fragment, `EJET`. Grunden er ikke forsigtighed for
forsigtighedens skyld: en kollega, der må rette i en side, skal ikke kunne
lægge hele undertræet på det åbne net eller i papirkurven. Ejeren ville opdage
det bagefter, og **»bagefter« er for sent for noget, der har været offentligt.**

Fragmentet `SYNLIG`/`SKRIVBAR` tager stadig **nøjagtig to parametre** — `userId`
to gange — præcis som før arven kom til. Med over tyve kaldsteder ville et
fragment, der pludselig krævede tre, skulle rettes hvert eneste sted.

### De otte huller, delingen åbnede

Alle otte var kode, der var rigtig med én konto:

| Hvor | Hvad der ville ske |
|---|---|
| **Søgningen** låste på `note_fts.user_id` | En delt note kunne kun findes, **når indekset MISSEDE** og nødbremsen overtog — en fejl, der ligner et dårligt søgeord |
| **Baglæns links** havde ingen adgangsregel | En delt side ville vise titlerne på ejerens øvrige sider, så snart én af dem linkede hertil — og en titel er tit hele indholdet (»Opsigelse, Jens«) |
| **`hentFil`** fulgte kun sin ejer | En delt side ville stå med huller, hvor billederne skulle være |
| **Upload med `?note=`** spurgte om læse-adgang | Kommentaren sagde »en note, man må skrive i«; koden spurgte om noget andet |
| **Mærker** hørte til den, der skrev | `#drift` skrevet af en kollega ville lande under **hans** konto på **min** note — synligt for os begge, men kun i hans mærkeliste, og min egen `tag:drift` ville ikke finde min egen side |
| **Undersider** arvede ikke ejeren | En side lavet af en kollega i mit træ ville høre til ham — altså stå i mit træ uden at jeg kunne se den |
| **Flytning** havde ingen ejer-grænse | En note trukket ind under en delt side ville arve delingen: adgang til noget, ingen havde delt |
| **Sidebarens træ** var sin egen forespørgsel | Alices »Drift« stod under bobs egne notesbøger, som om den var hans |

Det sidste blev **ikke** fundet af en test. `hentNoter` havde fået sit
ejer-filter, men træruten er sin egen forespørgsel, og den tegner sidebaren
efter notesbøger. Det blev fundet ved at logge ind som bruger nummer to og
**kigge**. Lærestregen står i RUNE-ERFARINGER: en liste, ingen test kigger på,
er et sted en regel kan mangle uden at nogen opdager det.

### Kolonnen, der lignede en spærring

Da søgningens `fts.user_id`-filter måtte gå, stod kolonnen tilbage i indekset:
skrevet ved hver indeksering, læst af ingen. Det blev opdaget ved at **sabotere
dens vedligeholdelse og få nul røde tests** — og en sabotage uden røde betyder
enten, at der mangler en test, eller at det, man saboterede, ikke betyder
noget. Her var det det sidste.

Kolonnen er derfor fjernet (m12). Den farlige rest er ikke, at den koster
plads: det er, at den næste, der læser skemaet, vil tro, at indekset er pr.
bruger og bygge videre på en spærring, der ikke findes. En **formregel** holder
filteret væk, og en test på det **levende** skema holder kolonnen væk —
formreglen kan ikke måle skemaet, for `m3` opretter stadig den gamle tabel, og
en migration er fortid.

Prisen er én genopbygning af indekset ved opgraderingen. Den udløses af
**tilstanden** (tomt indeks, men noter i basen), ikke af migrationsnummeret: en
genopbygning, der kun kører fra én migration, er en engangshandling, man ikke
kan bruge igen — og et tomt søgeindeks er tavst. Appen svarer bare »intet
matcher«.

### En eksport bærer ikke delingerne

En ACL-række peger på en **anden** brugers id. Læses den ind i en frisk
installation, peger den på et id, der enten ikke findes — eller er blevet en
helt andens. Det sidste er den værste slags fejl, en gendannelse kan lave: den
giver adgang til nogen, ingen har peget på, og den ser rigtig ud.

Prisen er, at delingerne skal sættes igen efter en gendannelse. Det er en
håndfuld klik; det andet er et hul, ingen opdager. Der er en test på, at
eksporten ikke engang indeholder et fremmed bruger-id.

### Ejerskifte flytter tre ting

`givVidere` skifter ejer på **hele undertræet** (et træ har én ejer), rydder
`notebook_id` og gør noten til en rod (bogen tilhørte den gamle ejer, og en
note i en fremmed bog kan ikke tegnes noget sted), og lader **den gamle ejer
beholde `write`** — ellers ville »giv videre« være det samme som at miste
siden, og det er ikke det, nogen mener. Han kan fjerne sig selv bagefter; det
er hans valg, ikke en bivirkning.

### Fladen siger det på forhånd

`maaRette()` er ét sted, brugt af de **fire** steder en redigering kan begynde:
titelfeltet, det at åbne en blok, tjekbokse og mærkerækken. Værktøjsrækken og
menuen viser kun det, man faktisk kan. En flade, der lader dig skrive og først
afviser ved gemningen, ligner en fejl i appen — ikke en spærring. Serveren
afviser uanset hvad; det her er, for at man ikke skal prøve.

Og gemme-mærket siger **»Read only«** frem for »Saved« på en side, man ikke kan
gemme. »Saved« ville være en usandhed.

### Målt

| | |
|---|---|
| Tests | **338 grønne** (+25 i `tests/deling.test.mjs`, +1 formregel), 1 sprunget over |
| Hver vagt set fejle | **15 sabotager**: arven · slet · udgiv · filsletning · upload · baglæns links · FTS-låsen · mærkernes ejer · undersidens ejer · flytningens ejer-grænse · videredeling · »All notes« · »delt med mig« · sidebarens træ · kontolisten |
| Sabotage uden røde | **1** — og den afslørede en kolonne, ingen læste (m12) |
| Prøvet med to rigtige konti | delt fra alices skærm, åbnet fra bobs: bånd, låst titel, »Read only«, ingen udgiv-knap, halv menu — og hans rettelse landede på hendes note med `updated_by` = bob |
| Payload, hvis den var indlejret | **141.700 tegn = 112,5 %** af det gamle loft |

## 20 · F12 · GitHub i noter

**Bygget 2026-08-21.** En GitHub-adresse på sin egen linje bliver til koden —
eller til en chip med en sags tilstand.

### Sha'en fryses, og det er hele fasen

En adresse med en **gren** i (`/blob/main/...`) peger på noget, der ændrer sig.
Skriver man en note om, hvordan noget virker, og indsætter de linjer der viser
det, skal de linjer blive ved med at vise det — også når nogen retter i filen i
næste uge. Ellers står noten og forklarer en kode, der ikke findes mere, **uden
at noget fejler**.

Grenen slås derfor op én gang, ved indsættelsen, og adressen i noten skrives om
til den sha, grenen pegede på. Fra da af er indlejringen frossen, og der er en
opdatér-knap. Det er et **valg**, ikke en automatik.

Sha'en står i **teksten**, ikke i en tabel ved siden af. Markdown er sandheden
(§2), så indlejringen overlever en eksport, en gendannelse og en note kopieret
over i en anden app.

### Der må ikke gå et kald pr. optegning

Samme lektie som doda-broen (§16). En note med fem indlejringer må ikke blive
fem rundture, hver gang siden tegnes. Alt går gennem `github_cache`:

- en **frossen fil** caches for evigt — den kan ikke laves om, så cachenøglen
  bærer sha'en og der er intet udløb. Målt: tre optegninger mere koster nul kald.
- en **sag eller en gren** caches i 15 minutter og genopfriskes med
  `If-None-Match`, så et 304 hverken koster kvote eller båndbredde.

Og når GitHub har en dårlig dag, vises **det gamle svar med en advarsel**. En
note, der pludselig taber sit indhold, er værre end en, der viser noget lidt
gammelt.

### Wikien henter aldrig selv

Den offentlige side læser **kun** cachen. En fremmed, der genindlæser hurtigt
nok, ville ellers bruge ejerens GitHub-kvote op — med ejerens token, altså mod
hans private repoer. En delt side ville være en måde at tømme en andens kvote
på. Ligger svaret ikke i cachen, er linjen det link, den var.

Kortet på wikien er rent HTML uden en eneste knap: der er ingen app-JS på en
offentlig side, og en kopier-knap, der ikke virker, er værre end ingen.

### 404 betyder to ting, og beskeden skal sige begge

GitHub skelner ikke mellem »findes ikke« og »du må ikke se det« — et 403 ville
bekræfte, at et privat repo findes. Fejlbeskeden nævner derfor begge og
foreslår et token. Det er **samme fælde som ved payload-udvejen** (måling 1),
hvor den kostede en aften på at fejlsøge et token, der var helt i orden.

Kvotebeskeden siger, hvor mange minutter der er til den er tilbage. »Try again
later« er ikke noget, nogen kan handle på.

### Regler, der blev målt frem frem for antaget

**Der er ingen `..`-vagt i URL-tolkningen.** Første udgave havde en — og den
kunne aldrig fyre: `new URL()` normaliserer stien, før modulet ser den, også
den kodede form (`%2e%2e`). En vagt, der ikke kan fyre, er værre end ingen: den
næste, der læser, tror der er noget at bekymre sig om og bygger videre på en
spærring, der ikke findes. Samme lærdom som m12's kolonne, og der er en test på
selve normaliseringen, så påstanden kan efterprøves.

**Test-sømmen accepterer kun loopback.** `SAGU_GITHUB_API` findes, fordi de
fejl, der betyder noget, kræver en falsk GitHub. Men en søm, der kan pege hvor
som helst, er en måde at sende Andreas' token til en fremmed vært på — så alt
andet end `127.0.0.1`/`localhost` ignoreres uden at sige noget.

**Rendereren kender ikke GitHub.** Krogen hedder `bartLink` og siger kun »dette
afsnit er én bar adresse«; hvad den skal blive til, bestemmer værten. Samme
snit som `linkUrl` og `billedUrl`. Uden det ville markdown-modulet — som både
browseren og wikien deler — have et domæne indbygget.

### To fejl, som kun det at klikke kunne finde

1. **Knapperne i kortet åbnede redigeringsfeltet.** Kroppen har én delegeret
   klik-handler, der åbner den rå blok — det er dét, den hybride editor er. Så
   et tryk på »kopiér« gjorde begge dele: koden blev kopieret, og teksten blev
   til et tekstfelt, så kortet forsvandt under fingeren.
2. **Kortene blev ikke fyldt, når en blok stod åben.** Editoren tegner noten to
   steder, og den anden vej glemte `fyldGhIndlejringer`. Det gav
   »kortet forsvandt, da jeg klikkede«. Kuren blev en **formregel**: de to
   optegningsveje skal kalde det samme.

Og kortets chip sagde »frozen at this commit« med et **grennavn** i, når noten
var skrevet gennem API'et eller MCP'en. Den påstand var det stik modsatte af
det, der var tilfældet; nu står der, hvad der er, og knappen tilbyder det, der
mangler.

### Målt

| | |
|---|---|
| Tests | **22 i `tests/github.test.mjs`** + 1 formregel |
| Hver vagt set fejle | 13 sabotager, alle røde |
| Målt mod det rigtige GitHub | Sagus egen README frosset til `5c1cdf0`, og en flettet PR i `nodejs/node` som chip |
| Cachen | en frossen fil: 1 kald, derefter 0. En sag: 304 uden kvote |

## 21 · F13 · Genveje, favoritter og spor

**Bygget 2026-08-21.**

### Genvejsoversigten er GENERERET

`GENVEJE` er både det, tastaturet gør, og det, hjælpen viser — ét bord.
Loggen har »en hjælpetekst er en kravspecifikation« stående fire gange (doda
v9/v35/v38, Sagu F9), og kuren er hver gang den samme: ikke mere omhu, men ét
sted. Her **kan** de ikke drive fra hinanden.

Genvejene er enkelttaster uden modifikator med vilje: `Cmd`/`Ctrl` hører
browseren til, og at stjæle dem er at ødelægge noget, der virkede. Og listen
kan findes fra brugermenuen — en genvej, man ikke kan se, findes ikke.

### Favoritter og spor er MINE, ikke notens

Begge hænger på brugeren. Sagu er flerbruger, og en note kan være delt: et flag
på noten ville betyde, at min stjerne dukkede op hos kollegaen, og at hans
besøg skubbede rundt på min egen liste. Begge lister læses gennem `SYNLIG`, så
en note, jeg har mistet adgangen til, forsvinder af sig selv.

Sporet skrives **ét sted** — i selve note-opslaget, hvor alle veje ind mødes
(sidebaren, en søgning, et `[[link]]`, en genvej). Lagde man det i frontenden,
ville den femte vej ind mangle. Og en **nøgle** skriver ikke i sporet: en
iOS-genvej, der henter en note som markdown, og en MCP-klient, der læser den
for at svare på noget, er ikke mig, der var her.

### Et tidsstempel i en sorteringskolonne — fjerde gang

`note_visits` sorterede først på `at`, og to noter åbnet i **samme sekund** gav
uafgjort: rækkefølgen blev vilkårlig. Det er samme fælde, som `naesteSeq`
allerede findes for.

Det interessante var, hvordan det blev fundet — og hvordan det **ikke** kunne
måles. Sabotagen af sorteringen gav **nul røde**, fordi en uafgjort sortering
er *uspecificeret*, ikke forkert: SQLite må vælge frit, og den valgte rigtigt
begge gange. Et resultat, der er rigtigt ved et tilfælde, er ikke en måling.

Kravet blev derfor stillet på **dataene** i stedet: to besøg i samme sekund
skal have forskelligt løbenummer. Er den betingelse opfyldt, kan rækkefølgen
ikke afhænge af urets opløsning.

### Målt

| | |
|---|---|
| Tests | **10 i `tests/polering.test.mjs`** + 1 formregel |
| Hver vagt set fejle | 8 sabotager — hvoraf **tre først gav nul røde** og afslørede tre for svage tests |
| Prøvet i browseren | `?` viser listen · `n` fyrer ikke, mens man skriver i søgefeltet · `s` sætter stjernen og opdaterer sidebaren |

## 22 · Efter v2 — det, driften fandt

v2 kom på Andreas' telefon, og så kom fejlrapporterne. Alle fire var ting, der
så rigtige ud i koden og var forkerte i hånden. De står her, fordi det er den
slags, ingen testsuite fanger.

### »Jeg kan ikke skrive noget i mine noter på min mobil«

En tom note kunne **ikke åbnes overhovedet** — og fejlen var to lag dyb.

**Lag 1:** klik-handleren åbnede kun redigeringen, når man ramte `#noteBody`
*selv* (`e.target === host`), altså det tomme areal under indholdet. På en tom
note er pladsholderen »Click here to start writing« et `<p>` uden `data-blok`,
og den fylder kroppen helt ud. Målt på en telefonskærm: **kroppen 22 px,
pladsholderen 22 px — nul pixels tilbage at ramme.** Teksten sagde »klik her«,
og der var ikke noget »her«.

**Lag 2:** selv da klikket nåede frem, virkede det ikke. `aabnSidste()` lægger
en tom linje ind og beder om blok 0 — men `blokke('\n')` giver **ingen**
blokke, fordi en tom linje ikke er en blok. `tegnMedAabenBlok` faldt i sin
`!b`-gren, satte `aabenBlok` tilbage til null og tegnede pladsholderen igen
**på samme tick**, så der aldrig kom et felt frem.

Begge lag er lukket: et tryk hvor som helst i kroppen begynder at skrive, og
en tom første blok er et gyldigt mål frem for et fravær. En test i
`markdown.test.mjs` fastholder nu præmissen (`blokke('\n')` → `[]`), så en
ændring dér bliver et bevidst valg og ikke »man kan ikke skrive i sine noter«.

**Hvorfor kun på mobilen:** en NY note åbner sit felt ad en anden vej, og på en
computer er der `E`-genvejen. Fejlen ramte kun den, der kom tilbage til en
note, han havde ladet stå tom — og det gør man på en telefon.

Sidegevinst: `aabnSidste()` fik den `maaRette`-vagt, den manglede. Den tomme
gren gik uden om `aabnBlok()`, så den nye regel ville have givet en kollega med
læseadgang et skrivefelt på en tom delt note.

### »Use this address« gjorde det modsatte af det, den hed

Knappen ved siden af feltet »Public address« ryddede indstillingen. Meningen
var »brug den adresse, du står på« — men ved siden af et felt, man lige har
skrevet en adresse i, læses den som »brug DEN her adresse«. Andreas rettede
adressen, trykkede, og fik den gamle tilbage.

Serveren gjorde alt rigtigt. **En knap skal hedde det, den gør** — den hedder
nu »Clear it«, og fordi den ikke kan fortrydes med et klik, spørger den først.

### Mærkeforslag fandtes kun for halvdelen af brugerne

Mærkefeltet brugte `<datalist>`, altså browserens egen forslagsliste. Den
virker på en computer og **slet ikke på iOS**. Forslagene var der, men kunne
ikke ses af den, der sad med telefonen — og en funktion, man ikke kan se,
findes ikke (RUNE-ERFARINGER, tovo v8).

Listen tegnes nu selv, med piletaster, Tab, Enter og klik. Til gengæld skal
den også selv kunne alt det, browseren gjorde — det er prisen for at holde op
med at bruge en indbygget kontrol.

### `#drift,net,backup` er tre mærker

Komma-reglen ligger i `app/shared/maerker.js`, altså **ét sted**, så den
gælder titelfeltet, mærkefeltet, `POST /api/v1/capture` fra en iPhone-genvej og
MCP'ens `create_note` på én gang. Kommaet skal klæbe til begge sider:
`#drift,net`, aldrig `#drift, net` — ellers ville »husk #drift, og ring til
Bo« give et mærke, der hed »og«.

## 23 · F14 · Offline

**Bygget 2026-08-21**, efter Andreas' ønske: »vigtigste er at man kan se noter
offline«.

### Hvad der virker uden net

Hele appen. Målt med serveren **helt slukket**: skallen, sidebaren, træet,
favoritterne, sporet, og noterne med deres tekst og mærker. Et bånd øverst
siger det højt — *»Offline — showing what was loaded last«* — fordi **en app,
der viser gamle tal uden at sige det, er værre end en, der siger »her er
intet«:** man træffer beslutninger på noget, man tror er nyt.

Service workeren er porteret fra doda, hvor den har kørt i drift.

### Net FØRST, ikke cache først

For data. En note, man har rettet på en computer, skal være den nye, når man
åbner telefonen. Prisen er, at man venter på netværket, når det er der — og
det er den rigtige pris for et arkiv, man skriver i fra flere steder.

For statiske filer er det omvendt: de er versionerede, så cache først er både
sikkert og hurtigt.

### Tre ting, det at prøve det afslørede

**1 · `/api/me` blev cachet cache-først.** Grenen spurgte om `/api/v1/`, så
`/api/me` og `/api/public-config` faldt i den statiske gren. Et svar på »hvem
er jeg« fra cachen ville have overlevet et log ud og fortalt appen, at der
stadig sad nogen. Fundet ved at **kigge i cachen** efter at have varmet den op.

**2 · `?v=` gjorde skallen ubrugelig offline.** Workeren precacher
`app.js?v=<VERSION>`, men i udviklingstilstand stempler serveren `?v=<mtime>`
— to forskellige adresser, så den precachede kopi aldrig blev brugt, og hele
skallen faldt på gulvet uden net. Offline falder nu tilbage til et opslag
**uden** at se på `?v=`: versionsnummeret er en cache-buster, ikke en del af
filens identitet, og en lidt gammel app er uendeligt meget bedre end en tom
skærm.

**3 · Cachen skal ryddes ved log ud.** En cache overlever en session. Uden
oprydning ville en telefon, man har logget ud af, stadig kunne vise noterne
fra sidste gang — en helt anden aftale end den, »log ud« giver indtryk af.

### Cachenavnet stemples af build'et

`sw.js`' `VERSION` og `index.html`s `?v=` stemples fra **samme tal i samme
funktion**. Bumpes cachenavnet ikke, hober hver udgivelse sig op, og workeren
kan servere en gammel `app.js` i det uendelige. Det ramte doda i drift (v39
hed »web app'en på telefonen opdaterer sig selv igen«). En formregel står vagt
om stemplingen.

### Det, der IKKE er bygget

**At skrive offline.** En rettelse uden net fejler med en pæn besked, og båndet
siger det på forhånd (»Changes are not saved until you are back«). En kø, der
gemmer skrivninger og sender dem, når nettet kommer igen, er ikke bygget —
den kræver konfliktbehandling, som Sagu allerede har i den ene ende
(`updated_at`-konflikten fra F1) og skal have i den anden. Det er en fase for
sig, ikke et par linjer.

Wikien caches heller ikke: en offentlig side hører til den besøgende, og en
kopi i ejerens browser kan vise noget, der er trukket tilbage.

### Målt

| | |
|---|---|
| Prøvet med serveren slukket | app, sidebar, træ, favoritter, spor og noter — alt kunne læses |
| Tests | 374 grønne, 1 sprunget over (+2 formregler, +1 markdown-præmis) |
| Fundet ved at prøve frem for ved at teste | 3 fejl i selve offline-laget, og 4 i det, driften rapporterede |

## 24 · F15 · At skrive uden net

**Bygget 2026-08-21.** Køen, F14 udskød.

### Én række pr. NOTE, ikke én pr. tastetryk

Retter man den samme note tre gange offline, er det den sidste tekst, der er
meningen. En logbog ville afspille tre gemninger oven i hinanden og kunne
genopvække en halvfærdig mellemtilstand. Samme regel som `note_visits` i F13 —
og det er tredje gang i dette projekt, at svaret på »skal jeg gemme hændelser
eller tilstand?« er **tilstand**.

### Konflikten er den svære del, ikke køen

Sagu havde konfliktvagten i forvejen: hver gemning sender `ifUpdatedAt`, og
serveren afviser med 409, hvis noten er ændret et andet sted. Køen bruger
**den samme** vagt frem for at opfinde en ny.

Det afgørende er *hvilket* stempel den gemmer: **det, man startede fra** — ikke
det nyeste. Skubbes det frem ved hver ny offline-rettelse, ender vagten med at
sammenligne med sig selv og siger god for alt, og en rettelse, der har ligget i
lommen en dag, overskriver stiltiende alt, hvad der er sket i mellemtiden.

Går en synkronisering i konflikt, bliver rækken **liggende** og bliver **vist**.
Den må aldrig kastes væk: køen er det eneste sted, den tekst findes. Panelet
viser begge udgaver — man kan ikke vælge mellem »min« og »deres« uden at kunne
læse dem, og det er den eneste skærm i appen, hvor et forkert klik koster noget,
der ikke kan hentes tilbage.

En note, der er **slettet** i mellemtiden, behandles som en konflikt frem for
som en fejl. Teksten er det eneste, der er tilbage af den.

### `navigator.onLine` er ikke svaret på »er jeg online?«

Den kender kun netkortet. Den er sand, når man hænger på et wifi uden
internet, og når serveren er nede — og båndet sagde derfor *»Sending 1
change…«*, mens ingenting blev sendt.

**Det, der afgør, om vi er offline, er om vi kan nå serveren.** `api()` sætter
tilstanden på et fejlet kald og rydder den på et svar fra serveren; et svar
fra service workerens cache tæller ikke som kontakt.

### Målt

| | |
|---|---|
| Prøvet med serveren slukket | rettelse parkeret, bånd »Offline — 1 change waiting«, mærket »Waiting for network« |
| Ved genstart af serveren | køen tømte sig selv, teksten stod på serveren, båndet forsvandt |
| Konflikt | provokeret med en rigtig fremmed rettelse: rækken blev liggende, panelet viste begge tekster, »Keep mine« skrev min igennem |

### Det, der stadig ikke er bygget

**At oprette en note offline.** Den ville skulle have et midlertidigt id, som
derefter skulle skiftes ud overalt — i træet, i favoritterne, i `[[links]]`, i
adresselinjen. At bygge halvdelen ville give noter, der peger på et id, som
ikke findes.

Kommentarer, filer og udgivelser køer heller ikke. De er handlinger, ikke
tekst man har skrevet — og en handling, der udføres en time for sent, er
sjældent den, man mente.

## 25 · F16 · Markér en linje, og send den til doda

**Bygget 2026-08-21.** Andreas' ønske: »kan man ved at markere en linje i en
note lave den til en opgave i doda?«

Serveren kunne det i forvejen — `POST /api/v1/notes/:id/tasks` tager vilkårlig
tekst og har gjort det siden F8. Det, der manglede, var **vejen dertil**.

### Markeringen er allerede en beslutning

Man streger den linje under, der er noget, der skal gøres. Alternativet er at
markere, kopiere, rulle ned til feltet og sætte ind — og den vej tager man
ikke, når man har travlt.

### Det, der gør det svært på en telefon

iOS viser sin **egen** menu (Kopiér, Slå op) oven på markeringen, og et tap et
hvilket som helst sted **rydder** markeringen. Derfor to ting, som begge er
nødvendige:

- Knappen lægger sig **over** markeringen. Systemets egen menu lægger sig
  nedenunder, og to menuer oven i hinanden er ingen af dem til at ramme.
- Den lytter på `mousedown`/`touchstart` med `preventDefault` — ikke på
  `click`. Med `click` er markeringen væk, inden handleren kører, og knappen
  ville sende en tom opgave.

Og hændelsen er `selectionchange`, fordi det er den **eneste**, der fyrer for
alle måderne at markere på: mus, tastatur, langt tryk og systemets håndtag.
`mouseup` alene ville virke på en computer og ingen andre steder. Til gengæld
fyrer den under hele trækket, så den er forsinket — ellers hopper knappen
rundt, mens man stadig markerer.

### En opgave er ÉN linje

Markeringen foldes til én linje, og der er et loft på 500 tegn — med en besked,
når det blev brugt. En opgave, der er et helt afsnit, er ikke en opgave.

## 26 · Tre ting mere, som brugen fandt

### Nøglen kunne ikke nås at læses

`POST /api/v1/keys` viste værdien i et `<p>` på siden — og kaldte så
`tegnSide()` med det samme for at få den nye nøgle med i listen. Optegningen
tegnede feltet væk. Nøglen blinkede og var **væk for altid**: Sagu gemmer kun
en hash, så der er ingen vej til at se den igen.

Den står nu i en rude uden for siden, som en optegning ikke kan røre — og som
man skal lukke selv. **Ruden lukker ikke på et klik ved siden af**, selv om
alle andre ruder i appen gør: de kan åbnes igen, det kan denne ikke. Reglen
bøjes netop dér, hvor den ellers ville gøre skade.

### Brugernavnet vises med stort

En visningsregel, og kun det. Den gemte værdi, alt der **sammenlignes**, og
alt der sendes til serveren er uændret — ellers holder login op med at virke,
og en deling til »Bo« finder ikke kontoen »bo«. Der er en test på begge dele.

Reglen bor i `app/shared/markdown.js` ved siden af `pentNavn`, fordi den også
skal gælde de sider, **serveren** tegner: samtykkesiden og wikiens
kommentarer. Kun det første tegn ændres: »andreasD« bliver »AndreasD«, ikke
»Andreasd«.

### Sidemenuen lukker sig, når man vælger en note

Se §24 — rettelsen hører i `aabnNote()`, og **før** vagten mod »samme note
igen«.

## 27 · Fire ting mere fra brugen

### Piletasterne kunne ikke skifte linje

Editoren åbner **ét afsnit ad gangen** som rå markdown; resten står renderet
omkring det. Stod man på den sidste linje i feltet, gjorde en piletast derfor
ingenting — der var ingen næste linje *inde i feltet*, og den næste linje i
noten var et helt andet element. For den, der skriver, ser det ud, som om
piletasterne ikke virker.

Pilene krydser nu blokgrænsen. Målemetoden er valgt med omhu: **browseren får
lov at prøve først.** Kunne den flytte markøren — fordi afsnittet har flere
linjer, eller fordi en lang linje er ombrudt over flere visuelle — så er det
dét, brugeren mente, og vi rører ingenting. Er markøren *ikke* flyttet
bagefter, var der ingen vej inde i feltet, og så springer vi.

Alternativet var at tælle `\n` i teksten, og det ville have været forkert:
et **ombrudt** afsnit har flere visuelle linjer end linjeskift, så en sådan
regel ville springe ud af feltet midt i et afsnit.

Markøren lander dér, bevægelsen pegede hen: går man nedad, i begyndelsen af
den næste blok — ikke i slutningen, hvor man så skulle taste sig tilbage.

### En notesbog kunne ikke slettes

Serveren har kunnet det siden F1 — `PATCH` og `DELETE` på
`/api/v1/notebooks/:id`, med noterne i papirkurven så bog og noter kan
gendannes sammen. Der var bare ingen knap. Andreas spurgte, hvordan man gør,
og det korte svar var »det kan du ikke«.

**En rute uden en knap er ikke en funktion.** Notesbogen har nu en menu med
omdøb, udgiv og slet — og sletningen siger, *hvor mange noter* der følger med,
før man trykker. »Slet notesbogen?« lyder som om det kun er selve bogen.

### »Not in a notebook« kunne ikke foldes

Den var den eneste række i træet uden en fold, og med tredive løse noter er
den en mur under bøgerne. Valget gemmes samme sted som alle de andre
foldninger — to måder at folde på i samme app er to steder at rette.

### Et tomt felt læses som »der er ingen«

doda-kortet sagde »Connected to …«, men nøglefeltet stod tomt med en grå
pladsholder. Hemmeligheden forlader aldrig serveren — det er reglen — så
feltet *kan* ikke fyldes ud. Men et tomt felt er ikke en oplysning; det er
noget, man gætter på.

Der står nu en linje ved siden af: **»An API key is saved on the server. It
never leaves it again — not even to this page, which is why the field looks
empty.«** Samme linje ved GitHub-tokenet. Ingen del af hemmeligheden vises —
heller ikke et præfiks. Reglen er ikke bøjet; den er bare **forklaret**.

### »Public address« lå det forkerte sted

Den stod klemt inde i Server-kortet mellem et flueben om kontooprettelse og en
liste over konti — og blev derfor læst som en detalje ved kontostyringen.
Den handler om noget andet: hvad **links** skrives med, altså det kollegaerne
får at se. Den har sit eget afsnit nu, over Server.

### Import af et stort arkiv gik i stå

En Notion-eksport på 226 MB gennem en Cloudflare-tunnel. **Cloudflares gratis
plan afviser forespørgselskroppe over 100 MB**, så uploaden klatrer op og
stopper. Sagus eget loft er 1 GB; det er ikke dét, der rammer.

Rådet står nu på selve import-skærmen: åbn Sagu på serverens egen adresse på
netværket og importér der. Det er samme genvej som doda-broens (§16) — peger
man forbi tunnelen, forsvinder både grænsen og ventetiden uden en linje kode.

## 28 · Læg noget nederst i en note, der findes

**Bygget 2026-08-21.** Andreas' ønske: at API'et skal kunne føje tekst eller et
billede til en note, der allerede er oprettet.

### Samme dør, ét mål mere

`?to=` fandtes i forvejen og betød »hvor skal det lande«: ingenting = en ny
note, `today` = dagens. Nu er der en tredje form — et **note-id**. Formen
tolkes ét sted, så tekst og billede aldrig kan komme i utakt, og begge veje
ind (JSON, formulardata, ren krop, `?text=`) virker uændret.

Adgangen er **skrive**-adgang, ikke bare »kan se«: at lægge noget nederst i en
side er at ændre den, så en note delt til læsning kan ikke fyldes op udefra
(F11). Svaret er det samme 404 for »findes ikke« og »ikke din« — man må ikke
kunne aftaste, hvilke id'er der er i brug.

Scopet er stadig `capture`. En capture-nøgle kan ikke læse og kan derfor ikke
opdage id'er; den skal have fået et. At skrive noget nyt er ikke det samme som
at måtte rette i alt, hvad der ligger.

### Fejlen, der lå der i forvejen

`to=today` har siden F9 kaldt `saetMaerker(...)` med de mærker, fangsten fandt
— og **`saetMaerker` skriver notens mærker forfra**. Den rydder `note_tags`
først, hvilket er rigtigt, når man redigerer mærkerækken i appen. Men her
*tilføjer* man til en note, der findes: sendte man »Ny router #drift« til
dagens note, forsvandt dens øvrige mærker. Uden at noget fejlede.

**En fangst, der sletter noget, er den værste slags stille fejl.** Mærkerne
lægges nu til. Begge mål deler én funktion, så fejlen ikke kunne blive to.

### Beskeden nævner noten ved navn

»Added to today's note« var rigtigt, så længe der kun var ét mål. Med `to=<id>`
ville den være en usandhed hver gang.

## 29 · F17 · »Der er kommet en ny version«

**Bygget 2026-08-21.**

Versionslinjen i sidebarens fod har kunnet sige det siden F0 — men på en
telefon står foden **bag hamburgeren**, så man ser den aldrig. Beskeden hører
dér, hvor man er: et bånd i toppen med en knap.

### To fejl i den mekanik, der allerede fandtes

**1 · Sammenligningen var `!==`.** Den er forkert i den ene retning: er
serverens tal *lavere* end det, browseren kører — en rullet udgivelse, eller
en serverproces, der ikke er genstartet — så stod der »v5 is ready, you are
running v6«, og det er vås. Kun **nyere** tæller som en opdatering. Målt i
udvikling, hvor netop det skete.

**2 · Serveren læste sin version ved OPSTART.** Panelets »Opdatér app« skriver
app-filerne igen uden at genstarte containeren, og så ville serveren blive ved
med at melde det gamle tal — beskeden ville aldrig dukke op, selv om der lå en
ny `app.js` på disken. Versionen læses nu frisk, men kun når filens mtime er
ændret: et `stat` pr. kald er billigt, at læse hele filen er det ikke.

### Den skal opdages, mens man ser på den

Tallet hentes igen, når fanen kommer **frem** (`visibilitychange`). Det er
netop det øjeblik, en telefon vender tilbage til appen efter en opdatering på
serveren. Uden det ville beskeden først dukke op ved næste genindlæsning — og
så er den overflødig.

Knappen rydder cachen *og* beder service workeren rydde sin, før den
genindlæser. Uden det serverer workeren bare den samme gamle `app.js`, og
knappen ville se ud, som om den ikke gjorde noget.

### En flakkende test, fundet undervejs

413-testen var grøn alene og rød cirka hver fjerde gang i den samlede kørsel.
Årsagen: socket-fejlen kan nå frem **før** `response`-hændelsen, når maskinen
er belastet — så testen målte sit eget kapløb og pegede på serveren. Testens
påstand er, at der *kommer* et rigtigt 413 med en læsbar krop, ikke at der
aldrig sker en socket-fejl. Svaret får nu et øjeblik til at nå frem, før der
dømmes. Otte fulde kørsler i træk grønne bagefter.

## 30 · En kommentar er `capture`, ikke `write`

**Ændret 2026-08-21**, efter Andreas' ønske om at kunne skrive en kommentar på
en Sagu-note direkte fra doda. Dodas bro har en `link`-nøgle (capture + read),
og kommentar-ruten krævede `write`.

Skellet er det samme, F11 allerede traf: **en kommentar ændrer ikke noten.**
En side, der er delt til dig til læsning, må godt kommenteres — »kig lige på
det her« er tit hele grunden til at dele den. At tilføje til notens egen tekst
(§28) kræver derimod skriveadgang, for dét ændrer siden.

### Scopet kunne ikke sænkes alene

Svaret bar **hele samtalen**. Havde vi kun ændret konstanten, var skrive-døren
blevet til en læse-kanal: en `capture`-nøgle kunne skrive en ligegyldig
kommentar på et hvilket som helst note-id og få alt, der står, retur — og så er
den ene ting, `capture` findes for, væk (*»writes but never looks — a lost
phone must not be able to read the archive«*).

Listen kommer nu kun med, hvis nøglen også må læse. En `link`-nøgle og en
session får den som før; en `capture`-nøgle får sit id og en linje.

**Reglen er generel og værd at holde fast i: et svar må aldrig bære mere, end
kaldet bad om.** Et scope, der sænkes, skal måles på svaret — ikke kun på
adgangen.

## 31 · To ting, der så rigtige ud og gjorde ingenting

### »Recent« virkede ikke efter en sideindlæsning

`tegnGenveje()` fylder `#navGenveje` **og** binder klik-handlerne. Men
`shellHtml()` kaldte allerede `genvejeHtml()` direkte, så efter en fuld
optegning — altså hver sideindlæsning — stod punkterne under »Recent« og
»Favourites« i DOM'en uden nogen handler. De så rigtige ud og gjorde
ingenting, indtil noget andet tilfældigvis tegnede dem om (at åbne en note
gør det).

Kuren er **ikke** et bind-kald mere ved siden af det første; det ville være
det samme problem én linje senere. Skallen tegner nu et tomt element, og
`bindShell()` kalder `tegnGenveje()` — nøjagtig som den allerede gjorde med
`tegnTrae()`. **Ét sted tegner og binder, så de to ikke kan skilles ad.**

### En markering var også et klik

I den hybride editor åbner et klik på et afsnit det som rå markdown. Et træk
hen over teksten ender med netop sådan et klik — så markeringen blev ryddet i
samme øjeblik, den var færdig.

To ting var i stykker af det, og den første er den vigtigste: **man kunne ikke
markere tekst for at kopiere den.** Fladen hoppede i redigering, hver gang man
prøvede. Og F16's »Send to doda«-knap kunne aldrig nå frem, fordi den netop
nægter at vise sig, mens en blok er åben — så funktionen fra v5 har i praksis
ikke kunnet bruges.

Et markeret stykke tekst er en handling i sig selv. Klikket, der afslutter
den, er ikke en anmodning om at redigere.

### En formregel, der blev fjernet igen

Jeg skrev en regel om, at markup med en `bind`-partner kun må laves af sin
egen `tegn`-funktion. Den fandt den rigtige fejl — og fældede tre steder, der
er helt i orden (`maerkerHtml`, `kommentarerHtml` og `dodaOpgaverHtml` tegnes
af `sideNote()` og bindes af `bindNoteSide()`, en anden og korrekt vej).

At skelne dem kræver at følge kaldegrafen fra hvert tegnested til dets egen
binder, og en formregel, man ikke kan gennemskue, er selv en byrde. Reglen står
i stedet i `CLAUDE.md` som noget, et menneske skal vide. **Samme lærdom som
SQL-template-reglen samme dag: mål den faktiske fejl, ikke noget der ligner
den — og en regel, der råber op om kode, der er i orden, bliver slettet af den
næste.**

## 32 · Markér en linje — tredje forsøg, og hvorfor de to første ikke virkede

Funktionen blev bygget i v5, »rettet« i v9 og virkede først i v10. Det er værd
at skrive ned, fordi begge fejl havde samme rod: **jeg afprøvede den ikke, som
den bruges.**

**v5** byggede knappen og målte den med en markering lavet af `createRange()`.
Den vej kommer der ikke noget klik bagefter — og i en hybrid editor er det
netop klikket, der afslutter et musetræk, som åbner afsnittet og rydder
markeringen. Testen var grøn, funktionen var død.

**v9** rettede dét: en markering er ikke en anmodning om at redigere. Nu
overlevede markeringen — men knappen kom stadig ikke, for to grunde jeg havde
bygget ind selv:

- En vagt sagde »ikke mens et afsnit står som rå markdown: dér markerer man
  for at rette«. Det var min antagelse, og den var forkert. **At klikke ind i
  teksten og trække hen over en linje er den almindeligste måde at markere
  noget i en note.** Det er netop dér, man gør det.
- Og `window.getSelection()` kan ikke se en markering inde i et `<textarea>`:
  det har sin egen `selectionStart`/`selectionEnd`. Selv uden vagten ville
  teksten have været tom, mens man kunne se den markeret på skærmen.

**v10** læser begge steder: fra det renderede indhold og fra det åbne felt.
Placeringen i feltet er et skøn — linjenummer gange linjehøjde — fordi rigtige
markørkoordinater i et textarea kræver en skyggekopi af hele feltet, og
knappen skal bare være i nærheden af det, man markerede.

**Lærestregen er ikke »test mere«.** Den er: en funktion, der hænger på en
brugerhandling, skal prøves med den handling. En syntetisk markering udelader
præcis det, der gik galt — og en vagt, man har skrevet ud fra en antagelse om,
hvordan folk arbejder, er en antagelse, indtil nogen prøver.

## 33 · Opgavens status stod stille

En opgave lukket i doda blev ved med at stå som åben i Sagu.

Mekanikken var i orden — der var endda en test på, at en ændret status slår
igennem. **Men den test forcerede en opfriskning** (`?refresh=1`), og det kan
brugeren ikke. I brug gjaldt vinduet: status blev opfrisket højst **hvert
kvarter**, og den almindelige gang tager to minutter — send en opgave, skift
til doda, luk den, skift tilbage.

**En test, der forcerer det, brugeren ikke kan forcere, måler mekanikken og
ikke oplevelsen.** Det er samme fejlklasse som de syntetiske markeringer i §32,
to gange på én dag.

To ting rettet:

- **Vinduet er nu 60 sekunder.** Reglen bag tallet er »der må ikke gå et kald
  til doda pr. optegning« (§16) — og at åbne en note er ikke en optegning; en
  note tegnes mange gange, mens man skriver i den. Et minut holder stadig
  kaldene væk fra optegningen og fra hurtige spring mellem noter.
- **Sagu kigger efter, når man kommer tilbage til fanen.** Det er præcis den
  gang: man er i doda, lukker opgaven, skifter tilbage. Med en bund på 10
  sekunder, så to faner ved siden af hinanden ikke bliver til et kald hver gang.

Tallet er pinnet af en test. Sættes det op igen, skal det være et valg.

## 34 · Hvor en kommentar kom fra

Meldt fra brug: tovo kan svare på en notes kommentarer gennem sin `link`-nøgle, og
tråden viste bare »Andreas« — det samme navn som når Andreas selv skriver i Sagu.
Samme navn, to helt forskellige situationer, og læseren kunne ikke se forskel.

### Nøglens navn, ikke en liste over apps

`origin` fandtes i forvejen (`app` | `public`), men den skelner mellem to **slags**
afsendere, ikke mellem apps. En ny kolonne `comments.via` (m15) bærer i stedet
**nøglens eget navn**.

Det er det valg, der gør, at Sagu ikke behøver at kende sine søskende. Andreas døbte
nøglen »tovo«, da han oprettede den; kommer der en fjerde app i morgen, virker mærket
uden en linje ny kode. Navnet er desuden allerede det, revisionen skriver
(`audit('fangst-via-api', …, auth.token.name, …)`), så der er ikke opfundet en ny
identitet — kun vist en, der fandtes.

En session sætter **ingenting**. En kommentar skrevet i Sagu skal ikke mærkes med noget,
og tom streng er langt det almindelige tilfælde.

### `via` står uden for `medStatus`

`status` og `origin` er ejerens oplysninger — de hører til moderationskøen og sendes kun
til den, der må moderere. »Skrevet fra tovo« er derimod en oplysning til **enhver**, der
læser tråden. Lå den bag samme flag, ville den samme kommentar se forskellig ud alt efter,
hvem der kiggede.

### Mærket tegnes ét sted

To visninger tegner en kommentar (tråden og moderationskøen). `komKilde()` bruges begge
steder, så de ikke kan drive fra hinanden — samme grund som `opretKommentar()` er ét sted
for begge veje ind.

---

## 35 · F28 · Serveren henter sin egen kode

Indtil v46 fulgtes app-koden og runen ad. Runen **bar** ikke koden — den hentede den fra
taggen `vN` (måling 1) — men taggen stod i install-scriptet, så en ny app-udgave
**krævede** en ny rune. Andreas skulle derfor gennem panelets to trin, hent runen igen og
tryk Opdater, ved hver eneste udgivelse. For at flytte ét tal i en YAML.

Nu gør serveren det selv. `app/kilde.js` kører fra `startup`, før serveren starter:
**en genstart er opdateringen.**

### Runen bliver en startsnor

Det bærende valg er at skille de to tal ad. `APP_VERSION` er koden og bumpes ved hver
udgivelse; `RUNE_VERSION` er runen og bumpes **kun**, når YAML'en selv ændrer sig.

Gør man ikke det, bumper build'et runen ved hver udgivelse, og så er Andreas tilbage ved
panelets to trin — hele pointen tabt. Det er ikke en teoretisk risiko: det ville ske af
sig selv, hvis de to tal blev ved med at være ét.

`RUNE_VERSION` er også den tag, install-scriptet henter **første** gang. Den behøver ikke
være den nyeste — første opstart henter alligevel det, `KODE_VERSION` peger på — men den
skal være en udgave, der **indeholder `kilde.js`**. Peger startsnoren længere tilbage,
henter en frisk installation kode uden `kilde.js`, og så opdaterer en genstart aldrig
mere. Serveren ville køre; den ville bare stå stille for altid. Derfor er
`FOERSTE_SELVHENTENDE = 47` en konstant i koden og en prøve i suiten, ikke en note.

### `KODE_VERSION` er tom som standard

**Tom = nyeste.** Ordene `seneste` og `latest` godtages stadig, men standarden for »gør
det normale« skal være **ingenting**: et felt, der *skal* udfyldes for at opføre sig
almindeligt, læser man som en indstilling, nogen har taget — og så spekulerer man på,
hvad »seneste« mon dækker over.

Mønsteret er `^([0-9]+|seneste|latest)?$`. Spørgsmålstegnet er ikke pynt: uden det kan
den tomme standard ikke gemmes i panelet. Og mønsteret afviser `v47` og `47.1` allerede
i feltet frem for at lade `kilde.js` tolke noget, brugeren ikke skrev.

Vejen tilbage fra en dårlig udgivelse bliver dermed: skriv tallet, genstart. Frem igen:
tøm feltet, genstart.

### De fem fælder, mekanikken er bygget udenom

**1 · GitHub sorterer tags alfabetisk.** `v9` står efter `v80`. Tager man `liste[0]` fra
`/repos/:ejer/:repo/tags`, ruller hver server tilbage til `v9` ved næste genstart. Hele
listen regnes igennem (`/^v(\d+)$/`, tag max), og der bladres med `per_page=100&page=N`,
til en side ikke er fuld. Sagu er på v46 og passerer punktet, hvor fejlen bider, ved
næste udgivelse.

**2 · Der pakkes ud *ved siden af* `app/`, ikke i `/tmp`.** `mv` mellem to filsystemer er
en kopi, og en kopi kan afbrydes på midten; to `rename` inden for samme filsystem kan
ikke. Den gamle app ligger under `.sagu-gammel` mellem de to omdøbninger, og
`startup`-kommandoen sætter den tilbage, hvis containeren dør præcis dér. Uden det trin
ville et dårligt sekund efterlade en container **uden `app/`** — og uden `app/` er der
heller ingen `kilde.js` til at hente en ny. Det er den eneste rigtigt farlige brik i
hele mekanikken; alt andet må fejle.

**3 · Alt ender med `exit 0`.** Kan GitHub ikke nås, starter serveren på den kode, der
ligger. En netværksfejl må udsætte en opdatering — aldrig slukke for arkivet, som andre
end Andreas læser gennem wikien. Derfor `node app/kilde.js || echo …` i `startup` og
ikke `set -e`.

**4 · Træet tjekkes, før der byttes.** Både at det *er* en hel Sagu (`server.js`,
`public/index.html`, `public/app.js` og **`shared/`**) og at det udpakkede `index.html`
bærer præcis det versionsstempel, taggen lover. `shared/` står med i listen med vilje:
uden den **starter** serveren, og fejler først, når nogen søger eller gemmer — en server,
der starter forkert, ligner en server, der virker. Og er en tag flyttet oven på en anden
commit, byttes der ikke: hellere køre videre på det kendte end at starte noget, ingen kan
navngive.

**5 · `[fejl]` i en advarsel er en fælde.** Panelets watcher tæller `[fejl]`-linjer og
sender en notifikation. Advarslerne herfra skriver derfor `[kode] advarsel: …` — »GitHub
svarede ikke« er ikke en serverfejl, og det skal ikke ringe hver gang nettet blinker.

### Mærkefilen — og hvorfor den har et fallback

`app/.kode-version` (JSON: version, ønsket, hentet, kilde) skrives ved hvert bytte.
Findes den ikke — og det gør den ikke på nogen server, der er installeret **før** denne
ændring — læses tallet ud af `index.html`s `?v=`. Uden det fallback ville hver eneste
eksisterende server hente koden igen ved første genstart, også når den allerede var den
rigtige.

`installeret()` giver `null`, ikke `0`, når ingen af de to veje virker. `null` betyder
»jeg ved det ikke« og fører til en hentning; et mærke med version `0` ville se ud som en
kendsgerning.

### »Opdater Sagu« bruger `kilde.js`, når den findes

Knappen må aldrig hente startsnorens tag, når appen allerede er længere fremme: v47 oven
i v60 er en **nedgradering, ingen bad om**. Findes `app/kilde.js`, er den facit — den
kender `KODE_VERSION` og henter præcis den udgave, en genstart ville hente. Startsnoren
er kun redningen, hvis `app/` er væk eller er fra før v47.

Om panelet templater `{{KODE_VERSION}}` ind i `update`-scriptets **tekst**, er
**ubevist**. At variablerne når frem som env til `startup`, er derimod bevist, fordi
`APP_NAME` allerede virker den vej. Scriptet prøver derfor skabelonen og falder tilbage
til env, hvis den står utemplateret — så kan en låsning ikke tabes på en antagelse.

### Invarianten »N steder, samme tal« er skiftet ud, ikke slettet

Den gjaldt, så længe runen og appen fulgtes ad. Det gør de ikke længere, men de tre nye
måder at komme galt af sted på rammer alle sammen **en, der installerer forfra** — og
ikke nogen, der allerede kører. Derfor står de som prøver:

- appens egne steder (`APP_VERSION`, `index.html`, `sw.js`) følges stadig ad
- **alle** `refs/tags/vN` i runen peger på runens **egen** version
- startsnoren er `>= FOERSTE_SELVHENTENDE`
- `startup` redder `app/` **før** den henter, og henter **før** den starter serveren

### Hvad der er prøvet, og hvad der ikke er

Hentningen selv kræver GitHub og er derfor ikke i `tests/kilde.test.mjs`; alt det, der
kan prøves uden net, er skilt ud i rene funktioner, og fjorten sabotager er set fælde
dem. Selve turen er kørt end-to-end mod det rigtige GitHub fra en midlertidig mappe:
v46 → låst til v45 (rigtig hentning, tjek og bytte, mærke skrevet, ingen rester),
v9999 → 404 → advarsel → `app/` urørt og exit 0, tomt felt og felt slet ikke sat, og
`v47` som vrøvl. Redningen er prøvet ved at fjerne `app/` og lade `.sagu-gammel` stå.

**Den har endnu ikke overlevet en rigtig genstart i panelet på Hjorten.** Det er
Andreas' prøve, og indtil den er kørt, er mekanikken bygget og målt — ikke bevist i
drift.

---

## 36 · Nedbruddet 2026-09-04 — og de tre fælder, der stod i redningsvejen

Sagu var nede i ti timer dagen efter v47. Fejlen lå ikke i `kilde.js`, men i det
script, panelets **»Opdater Sagu«**-knap kører — den vej, §35 kaldte »redningen« og
aldrig kiggede efter.

### Hvad panelet faktisk gør

Målt i panelets egen anmodningslog:

```
12:30:18  POST .../app-update   -> 202
12:30:26  POST .../app-update   -> 202
22:26:44  POST .../restart      -> 200
22:27:00  DELETE .../crashes    -> 200
```

Én ting står klart: **knappen blev trykket to gange med otte sekunders mellemrum.**

Jeg læste også noget andet ud af loggen, og **det var forkert** — se næst­sidste afsnit.
Panelet **genstarter** appen som en del af opdateringen.

### De tre fælder, på tre linjer

Scriptet gjorde:

```sh
rm -rf /tmp/sagu-hent    # fast sti, delt mellem samtidige kørsler
...
rm -rf app               # nu findes app/ slet ikke
mv "$NY" app             # og mv fra /tmp er en KOPI over to filsystemer
```

1. **Fast temp-sti.** To samtidige kørsler deler `/tmp/sagu-hent`. Den ene rydder,
   mens den anden pakker ud.
2. **`rm -rf app` før `mv`.** Et vindue helt uden `app/` — og dermed uden `kilde.js`
   til at redde sig selv.
3. **`mv` fra `/tmp` er en kopi over to filsystemer**, som kan afbrydes på midten.

Det er **nøjagtig** de tre, `kilde.js` blev bygget udenom i §35. Jeg skrev dem ned som
de bærende valg, byggede hovedvejen efter dem — og lod dem stå i den vej, der bruges,
når hovedvejen ikke findes endnu. **Den vej, der kun bruges én gang, er den, der bruges
den dag alt andet er nyt.**

### Hvad der er ændret

`hent_krop()` gør nu det samme som `kilde.js`: pakker ud i `.sagu-ny` **ved siden af**
`app/` i datamappen, flytter den gamle app til `.sagu-gammel` frem for at slette den, og
bytter med to `rename`. Aldrig en kopi, og altid en vej tilbage.

At den gamle app flyttes **væk som en helhed** løser også det, `rm -rf app` var der for:
filer, der er slettet i en ny version, bliver ikke liggende (Beanledger v30). Derfor er
build'ets regel skiftet ud, ikke slettet — og den er blevet skarpere: der må aldrig
pakkes ud oven i den levende `app/`, og `/tmp` er nu forbudt i begge scripts.

### Låsen

Hele update-scriptet tager en lås med **`mkdir`**, som er atomisk på alle filsystemer;
`[ -d ]` efterfulgt af `mkdir` er det ikke — der er et hul imellem dem.

Låsen dækker **begge grene** med vilje. Fra v47 og frem er `kilde.js`-grenen den
almindelige, og to samtidige `kilde.js` ville kunne bytte `app/` ud under hinanden.
En lås inde i else-grenen ville have beskyttet netop den vej, der snart aldrig bruges.

En `trap` frigiver låsen, når noget fælder undervejs — en fejlet hentning er den
**almindelige** fejl, og en lås, der bliver liggende efter den, gør knappen død for
altid. Bliver containeren dræbt hårdt, når `trap` ikke at køre; den vej ryddes af
`startup`. Prisen er, at en opdatering, der kører i sin egen container præcis i det
øjeblik appen starter, mister sin lås — og den pris er mindre end en knap, der aldrig
virker igen.

### Beskeden — og den slutning, der ikke holdt

Første udgave af v48 sluttede med et indrammet **»GENSTART SAGU NU — serveren koerer
stadig den gamle kode«**. Det var **usandt**, og det stod der, fordi jeg havde sluttet
»panelet genstarter ikke« ud af, at der ikke lå en separat `restart`-anmodning i
panelets log.

Det har aldrig været et bevis. **En genstart inde i selve jobbet giver ingen
HTTP-anmodning**, og `202` er kvitteringen for, at jobbet er *accepteret* — ikke for,
hvad det gjorde. Fundet af doda v84, som spurgte til sin egen install-log.

Målt bagefter, to uafhængige steder:

- `server_crashes` har en post for Sagu kl. **22:28:34** med `exit_code 0` og
  `[sagu] lukker ned` — samme sekund som `app-update`. Panelet **stoppede** appen.
- Containerens `StartedAt` er **22:28:40**, seks sekunder senere. Genstarten kl.
  22:26:44 ville have givet 22:26:47.

Panelet kører altså **stop → skift filer → start**. Det ændrer også diagnosen af
nedetiden: den gamle proces kørte ikke videre på nye filer — appen blev stoppet,
filerne skiftet af to kørsler, der trådte i hinanden, og så kunne den ikke starte igen.

Beskeden er derfor formuleret, så den er sand **begge veje**. Den lover ikke noget om
panelet, og den efterlader heller ikke nogen i troen på, at ny kode kører af sig selv:

```
App-filerne er skiftet ud. Databasen i /data er uroert.
Panelet genstarter Sagu bagefter. Sker det ikke, saa genstart
selv - serveren koerer den gamle kode, til den er genstartet.
```

Prøven blev rettet med den. Den måler ikke længere **ordlyden af et banner**, men de to
ting, beskeden skal kunne bære — og den fælder udtrykkeligt det gamle banner.
**En prøve, der holder en påstand på plads, er præcis så god som påstanden.**

### Hvad prøverne måler

`tests/opdatering.test.mjs` kører **panelets eget script** mod en lokal arkivserver.
Den vigtigste starter to kørsler samtidig mod en forsinket server og kræver, at præcis
én kommer igennem, den anden fælder med besked, og `app/` bagefter er **hel** — hverken
den gamle eller en blanding. Dertil: låsen frigives efter en fejlet hentning, `startup`
rydder en strandet lås, døden mellem de to omdøbninger koster ikke `app/`, og en
**lykket** udskiftning rulles ikke tilbage af redningen.

Ti sabotager er set fælde dem. To af dem fanges allerede af `build_rune.py`, så de blev
prøvet igen direkte på den udgivne YAML — ellers ville jeg kun have bevist build'ets
vagt og ikke prøvens.

**Én sabotage afslørede en fejl i prøven selv:** `indexOf` giver `-1`, når strengen
ikke findes, og `-1 < x` er altid sandt. Prøven for »låsen tages før begge grene« ville
altså have bestået netop den dag, låsen var **væk**. Den kræver nu, at begge strenge
findes, før den sammenligner.

**Og én skærpelse kom udefra** (doda v84). Uden låsen får man også »én igennem, én
fejlet« — reproduceret her: taberen falder på `tar: .sagu-ny/app.tar: No such file`,
fordi vinderen har ryddet mappen, og `app/` overlever *tilfældigvis*. Om skaden sker,
afhænger altså af timing, ikke af en regel. En samtidigheds-prøve, der kun tæller
successer og fejl, ville derfor bestå uden låsen. Prøven kræver nu det deterministiske:
**taberen skal falde på LÅSEN og aldrig nå at røre en fil** (`doesNotMatch(/mv:|tar:|No
such file/)`). Samme slags fejl som `indexOf`-fangsten, et lag højere — *påstanden om,
hvad en sabotage beviser, skal selv efterprøves.*

---

## 37 · F29 · En note i sit eget vindue

»Kan du lave en knap så man kan poppe en note ud i sit eget vindue, så den er til at
have ved siden af?« (Andreas, 2026-09-05).

`…` → **Open in its own window**. Vinduet er den samme app på den samme oprindelse —
ikke en særlig visning — så sessionen, redigeringen, søgningen og offline-tilstanden
virker præcis som i hovedvinduet.

### Flaget står i `?solo=1`, ikke i fragmentet

Fragmentet er **notens** adresse (`#note-<id>`). De to ting hører ikke sammen: vinduet
bliver ved med at være et sidevindue, også når man følger et link til en anden note.

Og `saetAdresse()` skriver i forvejen `pathname + search + hash`, så en query overlever
hver eneste adresseskrivning **uden en linje ekstra**. Det er hele grunden til, at
valget er gratis.

Service workeren gemmer skallen under `./`, når `pathname` er `/` — og det er den også
her, for flaget ligger i `search`. Sidevinduet virker derfor uden net på nøjagtig samme
vilkår som appen selv.

### `body.solo` står på samme linjer som `body.fokus`

Et sidevindue skal af med præcis den ramme, fokus-tilstanden allerede tager af:
sidebaren, menuknappen, krummerne og baglinkene. To lister ville drive fra hinanden den
dag, nogen skjuler ét element mere i fokus — og sidevinduet ville få det med måneder
senere, hvis nogen huskede det.

De to klasser er stadig **hver sin ting**: `fokus` slås til og fra med `F` og ryddes af
`gaaTil()`, mens `solo` er en egenskab ved vinduet og bliver stående. Derfor to klasser
og ét regelsæt — ikke én klasse.

### Topbaren bliver — søgefeltet er ikke pynt

Det var fristende at tage de 60 px. Men klikker man på et mærke i et sidevindue, lander
man på en liste, og uden sidebar **og** uden søgefelt er der ingen vej videre derfra.
**Et vindue uden en udvej er en fælde**, og de 60 px er billigere end den.

Tastaturhintene under feltet går derimod med: målt til **61 px**, og de er en
huskeseddel, ikke en vej. Det er den ene halvdel af topbaren, der kan undværes.

### Vinduet bærer notens navn

`document.title` blev kun sat til appens navn ved opstart. Det duer ikke her: har man
tre noter poppet ud, står de i operativsystemets vinduesliste med hver sin titel — og
hedder de alle sammen »Sagu«, kan man ikke vælge imellem dem. **En funktion, hvis formål
er at have noter ved siden af hinanden, skal kunne navngive dem.**

Titlen sættes i `tegnSide()`, som allerede er *ét sted* for sideoversigten, af samme
grund: den kan ellers glemmes i en af de mange grene, der åbner en note.

### Vinduets navn er notens id

`window.open`s andet argument er vinduets navn. Med `sagu-note-<id>` henter browseren
det vindue frem, der allerede står, når man popper **den samme** note ud igen — i stedet
for at lave nummer to. To vinduer på én note ville være to editorer på én tekst.

Punktet er derfor også skjult i et vindue, der allerede er poppet ud: en knap, der åbner
det vindue, man står i, er ikke en knap.

### `gemNu()` først — og uden `await`

Det nye vindue henter noten fra **serveren**. Ligger en rettelse stadig i editorens
debounce, ville sidevinduet vise en tekst, der er ældre end den, man lige har skrevet —
i det vindue, man åbnede for at se den. Derfor sendes `PATCH`en af sted først.

Uden `await`, med vilje: `window.open` skal køre i **samme hop som klikket**, ellers er
brugerhandlingen brugt op, og browseren blokerer vinduet. Ét `await` foran ville være
nok, og fejlen ville vise sig som »der sker ingenting« — kun hos den, der har en langsom
forbindelse. En prøve holder `popud`-grenen foran det første `await` i menuens handler.

Når den sidste rettelse i sjældne tilfælde ikke når med, er det ikke et tab: serverens
`ifUpdatedAt`-vagt afviser den, der skriver ovenpå, så det bliver en **konflikt, man kan
se** — ikke en tekst, der forsvinder.

### Hvad der ikke er gjort

**Hovedvinduet bliver stående på noten.** Man kan altså have den åben to steder. Det er
et valg: at flytte hovedvinduet væk bag brugerens ryg er mere overraskende end det
løser, og konfliktvagten gør det til noget, man kan se, ikke noget, man taber. Skal det
laves om, er det én linje.

### Hvad prøverne måler

`tests/sidevindue.test.mjs` henter `soloVindue`, `vinduestitel` og `popUdNote` **ud af
kilden** og kører dem med attrapper for `location`, `window` og `document` — samme
metode som `rullevagt`. Dertil fire formregler på kilden: at `body.solo` står på samme
CSS-regel som `body.fokus`, at topbaren og søgefeltet **ikke** er skjult i solo, at
`popud` står foran det første `await`, og at punktet er skjult i et sidevindue.

Fjorten sabotager er set fælde dem. Selve vinduet er ikke prøvet automatisk — browser-
ruden laver ingen selvstændige vinduer, den navigerede sin egen fane — men tilstanden er
set i ruden: sidebaren væk, titlen sat til notens navn, og `?solo=1` bevaret gennem en
navigation til en anden note.

---

## 38 · F30 · Vejen tilbage: HTML → markdown

»Jeg vil gerne have et interface som viser det på samme måde som når man bare kigger på
vores noter — bare også når man skriver i den« (Andreas, 2026-09-05).

For at kunne skrive i noten, mens den er **renderet**, skal HTML kunne blive til markdown
igen. `app/shared/redigering.js` er den vej. Fladen er ikke bygget endnu — det her er
porten, der skulle bestås først.

### Invarianten

```
tilMarkdown(render(md)) === md
```

Holder den ikke, bliver en note, man bare har **klikket** i, skrevet om — og det ville stå
i versionshistorikken som en rettelse, ingen har lavet.

Målt mod Andreas' 948 rigtige noter, alle 9.233 afsnit og overskrifter:

| | |
|---|---|
| Første forsøg | **96,93 %** |
| Efter rettelserne | **99,99 %** (9.232 af 9.233) |

Den ene afviger er `## Husk ` → `## Husk`: rendereren trimmer overskrifter. Sådan en blok
skal åbnes **råt** — og det er hele sikkerhedsnettet: *består en blok ikke rundturen,
får den ikke WYSIWYG.* En serialiseringsfejl kan så aldrig omskrive tekst i tavshed.

### Den er ren, ikke DOM-drevet

Den skal bruges i browseren, hvor der er en DOM. Men prøverne kører i node, hvor der ikke
er — og den vigtigste prøve er rundturen over hele korpus. En DOM-drevet udgave kunne ikke
køre den, og to udgaver ville drive fra hinanden. Altså: en lille HTML-læser i modulet, og
browseren giver bare sin `innerHTML` videre.

### Rendereren skriver ned, hvad den udledte

Det var her, arbejdet lå. Fire ting kunne ikke regnes baglæns, fordi to forskellige kilder
gav samme HTML:

| Spor | Uden det |
|---|---|
| `data-auto="1"` | `[a.dk](https://a.dk)` og en bar `https://a.dk` er samme `<a>` — gættet var forkert **240 gange** |
| `data-md="_"` | `_kursiv_` og `*kursiv*` er samme `<em>` |
| `data-md="sagu:…"` | `sagu:`-id'et forsvinder i den oversatte `src`, og noten taber sin vedhæftning |
| `data-tom` / `data-billede` | `[](url)` og `![](url)` får deres tekst udfyldt af rendereren |

**Et program, der har udledt noget, skal skrive det ned — ikke lade den næste regne
baglæns.** Rettelsen hørte hjemme i rendereren, ikke i en klogere serialisering.

### To rigtige fejl, fundet undervejs

Rundturen sammenlignede `href` med kilden, og det afslørede to fejl, der ramte noterne
**i drift** — ikke bare oversættelsen.

**1 · `&` blev dobbelt-undsluppet.** `inline()` escaper hele teksten først, så en adresse,
en regel fanger, bærer allerede `&amp;`. Et `attr()` ovenpå gjorde den til `&amp;amp;`,
browseren afkodede ét lag, og linket pegede på `?x=1&amp;y=2`. **Hver eneste adresse med
mere end én parameter var i stykker** — YouTube med `&t=`, Amazon, alt med en query.
Adressen afkodes nu straks efter, den er fanget, så `sikkerUrl()` og værtens kroge også
ser den rigtige adresse, og `attr()` undslipper én gang.

**2 · Fremhævning kunne komme ind i et færdigt tag.** Reglerne kørte hen over hele
strengen, også inde i de tags, de tidligere regler lige havde udsendt. Et sporingslink
`.../v3/__https://...` fik et `<strong>` injiceret midt i sit `href`. Et færdigt tag
lægges nu til side bag en pladsholder — præcis som kodestumper altid har været. Det
fjerner en hel klasse af fejl, ikke bare den ene.

### Indsæt-rensningen bliver gratis

Andreas bad om rensning ved indsæt. Det er den samme funktion: indsat HTML køres gennem
`tilMarkdown()`, og reglen »et ukendt tag koster sin formatering, aldrig sine ord« gør et
Word-indsæt til ren markdown i stedet for `<span style>`-suppe. **Én mekanisme, to
formål** — ikke en sanitizer ved siden af en serialisering, som kunne drive fra hinanden.

### Hvad der venter

Fladen: værktøjslinje, live-formatering (målrettet erstatning ved markøren, ikke en
gentegning — ellers flytter markøren sig), og `contenteditable` pr. blok frem for pr.
note, så en fejl kun kan ramme den blok, man står i.
