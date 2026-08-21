# Overdragelse — Sagu, efter F6

> **Skrevet 2026-08-21.** Denne fil er et *øjebliksbillede*, ikke en kravkilde.
> Kravene står i `docs/HANDOVER.md`, beslutningerne i `DESIGN.md`, planen i
> `SAGU-PLAN.md`, og reglerne i `CLAUDE.md`. Denne fil fortæller kun, hvor
> arbejdet står, og hvad den næste skal gøre først.

---

## 1 · Hvor står vi

**F0–F7 er bygget, og v1 er udgivet 2026-08-21** — offentligt repo, install-scriptet
henter app-koden fra `refs/tags/v1`.

| | |
|---|---|
| Tests | **226 grønne** (`node --test --test-timeout=600000 tests/*.test.mjs`, ~14 s), 1 sprunget over (kræver en rigtig Notion-eksport i `SAGU_NOTION_EKSPORT`) |
| Install-script | **1.640 / 126.000 tegn (1,3 %)** — koden hentes fra GitHub. Payloaden ville indlejret være ~119.000 tegn (~94 %) |
| Repoet | **offentligt**, efter auditten i `DESIGN.md` §13 |
| `APP_VERSION` | **1** — aldrig bumpet, aldrig udgivet |
| Git | **Der er stadig intet git-repo.** `~/ClaudeMacBook/sagu` er en almindelig mappe |
| Migrationer | m1–m8 |
| Næste fase | **F8 · doda-integration** — den vigtigste enkeltdel |

Faserne:

| | | |
|---|---|---|
| F0 | Fundament, flerbruger, de fire målinger | bygget |
| F1 | Noter, notesbøger, hierarki, editor v1 | bygget |
| F2 | Søgning og omni-feltet | bygget |
| F3 | Editor v2 — Notion-følelsen | bygget |
| F4 | Filer og vedhæftninger | bygget |
| F5 | Import fra Notion — og eksport | bygget |
| F6 | Wiki og offentliggørelse | bygget |
| F7 | Kommentarer, i appen og på wikien | bygget |
| F8–F13 | doda · API · MCP · deling · GitHub · polering | ikke påbegyndt |

---

## 2 · Payload-udvejen er taget — 2026-08-21

**Runen bærer ikke længere app-koden.** Install-scriptet henter den fra
GitHub: **1.640 tegn i stedet for 111.352**, og tallet er konstant, uanset hvor
stor appen bliver. Runens YAML gik fra 242.624 til 5.610 b. Repoet er
**offentligt** (Andreas' beslutning samme dag) efter en audit, så der er
hverken token eller `secret:`-variabel. Hele historien — og de otte tests, der
kører det udgivne script — står i `DESIGN.md` måling 1 og §13.

**Tre ting, det ændrer for dig:**

1. **En udgivelse er tre trin:** commit → `git tag v<N>` → `git push --tags`.
   Runens version N henter `refs/tags/vN`. Uden taggen installerer runen
   ingenting — og siger det højt.
2. **De genererede filer SKAL være committet** (`app/public/app.js`, ikonet).
   Det, GitHub har, er det, der installeres. `tjek_git()` i build'et fælder,
   hvis en payload-fil ikke er i git.
3. **En hemmelighed må aldrig i en kildefil mere.** Repoet er offentligt.

**Det, der stadig mangler at blive prøvet:** en rigtig installation på Hjorten.
Alt er kørt på macOS, og **busybox' `tar` og `find` er ikke afprøvet** —
scriptet bruger med vilje kun `tar x -C`, som den nuværende rune allerede
bruger. Hjorten svarede ikke fra denne maskine (ikke på LAN'et), og der er
ingen container-runtime her.

Rækkefølgen, når du begynder:

1. Læs `~/ClaudeMacBook/RUNE-ERFARINGER.md` **helt igennem**. Det er ikke en
   formalitet — F6's dyreste fejl står i den nu.
2. Læs `CLAUDE.md`, `SAGU-PLAN.md` (statusblokken øverst), `DESIGN.md` §10–10f
   og `docs/HANDOVER.md`.
3. Kør testene, så du ved, at du starter fra grønt:

   ```sh
   cd ~/ClaudeMacBook/sagu && node --test --test-timeout=600000 tests/*.test.mjs
   ```

4. Byg runen og **rapportér den målte payload** — fast regel efter hver bygning:

   ```sh
   cd ~/ClaudeMacBook/sagu && python3 build_rune.py
   ```

---

## 3 · Tre ting, der venter på Andreas

Ingen af dem må afgøres uden ham.

1. **`andreasdinesen/sagu` skal oprettes — offentligt.** Der er stadig ikke
   oprettet noget repo, og intet er committet. **Runen kan først installeres,
   når repoet findes og `v1` er tagget**, for install-scriptet henter derfra.
2. **Skal F6 udgives?** Et push er en udgivelse, og først dér bumpes
   `APP_VERSION`.
3. **Wikiens adresse.** `SAGU-PLAN` §10 spørger, om den skal ligge på
   `sagu.<mit-domaene>/w/<slug>` eller på et domæne, kollegaerne kan kende (fx
   `wiki.<mit-domaene>`). Stierne (`/w/<slug>`, `/s/<token>`) virker under enhver
   vært, så det blokerer intet — men det skal afklares inden udgivelsen.

**Uden for projektet:** `~/ClaudeMacBook/rune-erfaringer/RUNE-ERFARINGER.md`
har F6's lærdomme liggende som ucommittede ændringer. Det repo skal committes
og pushes efter et stykke arbejde — også det kræver Andreas' ja.

---

## 4 · Hvad F6 blev, og hvad der blev fundet undervejs

Hele historien står i `DESIGN.md` §10–10f. Kort, fordi det ændrer, hvordan du
bør arbejde:

**Wikien er sin egen server-renderede skabelon** (`app/wiki.js`) uden app-JS.
En besøgende henter aldrig `app.js` og kan ikke kalde app-API'et — der er en
test på præcis det. Den lille `/wiki.js` er wikiens egen: kopier-knapper,
temaskifte, `/`-genvej og levende søgeresultater mod udgivelsens **egen**
søgerute.

**Både en note og en hel notesbog kan udgives** (`shares` har enten `note_id`
eller `notebook_id`, aldrig begge — der er en `CHECK` på det). Et importeret
arkiv *er* en bog med sider i, og at kræve en kunstig forside for at dele den
ville være at bede brugeren om at lave om på sit indhold for appens skyld.

**Fem fejl, der alle havde samme form: noget så rigtigt ud og var det ikke.**

- En **uendelig løkke** efter en import (`foelgImport` ↔ `genindlaes`)
  gentegnede siden, så kvitteringen forsvandt. Målt: **409 `state`-kald på
  tre sekunder**; nu ét. *Når to funktioner kalder hinanden, skal mindst én af
  dem kende en tilstand, der ændrer sig.*
- **Importens interne links virkede ikke.** Kvitteringen sagde »241 internal
  links rewritten«; ingen af dem virkede, fordi `sagu-note:` aldrig blev
  oversat. Nu 281 virkende. *En tæller beviser ikke, at det, den tæller,
  virker.*
- **Genimport rettede kun teksten, ikke placeringen** — så en rettelse i
  struktur-udledningen kunne aldrig komme et eksisterende arkiv til gode.
- **`.meta` er en versal etiket, ikke en tekstklasse.** Fælden bed tre gange på
  én dag, selv om den står to steder i erfaringsfilen. Derfor findes
  `tests/form.test.mjs` nu: en **formregel-test**, der læser frontend-kilden.
  *Når en dokumenteret fejl kommer igen, er noten ikke svaret.*
- **Delingstesten skal ses fejle for hver vagt for sig.** Sabotage af låsen gav
  3 røde; sabotage af udgivelsens id-liste gav kun 1 — og afslørede, at
  filvagten slet ikke var dækket af en test. Den er den nu.

**De to vaner fra F5 holdt, og de holder i F7 med:**

- **Mål på struktur, ikke på antal.** »263 af 268 rækker linker« er et svar;
  »290 sider importeret« er det ikke.
- **Åbn altid det færdige resultat i den rigtige brugerflade.** Wikien blev
  hentet som en rigtig, ikke-logget-ind besøgende — ikke kun gennem en
  testklient.

---

## 5 · Sådan hænger koden sammen

```
app/
  server.js        migrationer m1–m7, auth, note-CRUD, træ, søgning,
                   vedhæftninger, udgivelser, eksport/gendan   (~170 KB)
  wiki.js          den OFFENTLIGE wiki — server-renderet, ingen app-JS
                   (inkl. kommentarformularen, som er ren HTML)
  import.js        Notion-import som baggrundsjob (start/status/afbryd/kig)
  zip.js           egen ZIP-læser og -skriver oven på node:zlib
  shared/          UMD — bruges af BÅDE browseren og serveren
    markdown.js      rendereren. Hvidliste. Kroge: billedUrl, linkUrl
    soeg.js          søgesyntaksens parser
    notion.js        Notion-formatets parser
  parts/p1..p8.js  frontend, samles til public/app.js af build'et
                   (p8 = kommentarer: under noten og Comments-skaermen)
  public/app.js    GENERERET — redigér aldrig
  public/wiki.js   wikiens egen lille fil (ikke app-koden)
runes/sagu.yaml    GENERERET — redigér aldrig
build_rune.py      ikoner, kommentar-strip, require-spærre, payload-budget
tests/*.test.mjs   226 tests i 13 filer
```

**Regler, der er lette at komme til at bryde** (de fulde står i `CLAUDE.md`):

- `user_id`-filteret ligger i `hentNote` / `hentNoter` / `gemNote` / `gemBulk`
  **selv** — aldrig i kaldstederne. Admin er ingen undtagelse.
- Udgivelsens noter beregnes ÉT sted (`udgivelsensNoter`), og **hver** offentlig
  rute — side, søgning, fil, feed — spørger den samme funktion.
- Endepunkter uden login må aldrig scanne datasættet og svarer **404** ved
  forkert token — ikke 401, ikke 403.
- `body_md` kommer aldrig med i et listesvar. Søgeuddraget er undtagelsen, og
  det er **målt**: en note på 200 KB giver et søgesvar under 5 KB.
- Rendererens `linkUrl`-krog kan sige tre ting: en adresse, `null` (»ikke min«)
  og `false` (»min, men kan ikke nås herfra«). Den sidste er det, der gør, at
  et link til noget uudgivet bliver til sit navn som død tekst.
- Interfacet er **engelsk**; kode, kommentarer og dokumenter er **dansk**.
- Nul npm-pakker, nul CDN.
- Angrebssuiten (`tests/markdown.test.mjs`) køres i hver fase, der rører
  rendereren eller importerer indhold. **F7 rører rendereren** (kommentarer er
  fremmed indhold på et offentligt domæne).

---

## 6 · Test og lokal kørsel

```sh
BIND_PORT=8913 DATA_DIR=/tmp/sagudata SAGU_DEV=1 node app/server.js
```

Dev-serveren hedder `sagu` i den globale `~/.claude/launch.json` (port 8913).
Der ligger også en **`sagu-demo`** på port 8919 med datamappe i sessionens
scratchpad — den er Andreas' legeplads og kan fjernes, når den ikke bruges.

Testhjælperne ligger i `tests/hjaelp.mjs`: `startServer`, `startServerPaa`,
`klient`, `stop`, `stopUdenAtSlette`, `stopOgVent` og `tags` (XSS-målingen,
delt af markdown- og wiki-testen). Brug `stopOgVent()`, hvis testen skriver til
SQLite efter nedlukning, og giv en test, der skal **genstarte** serveren, sin
egen datamappe — ellers gør den de efterfølgende tests røde og peger på de
forkerte.

**Fikstur-vagt:** `byggArkiv()` i `tests/notion.test.mjs` kaster på et
Notion-id, der ikke er 32 hex. Uden den importerer en fikstur med `ggg…`
ingenting, og testen fejler af en helt anden grund end den, den handler om.

Notion-importen kan afprøves mod en rigtig eksport ved at pege
`SAGU_NOTION_EKSPORT` på den udpakkede `ExportBlock-…`-mappe i `~/Downloads`.
Uden variablen springes den test over. **Læg aldrig en eksport i `app/`** — den
mappe er præcis den, der bliver hentet ned fra GitHub ved en installation.

---

## 7 · F8 · doda-integration — det, der venter

Detaljerne står i `SAGU-PLAN.md`. Det, F7 og F0 allerede har lagt til rette:

- **Den smalle dør findes.** `POST /api/v1/notes` med `capture`-scope kan
  oprette og **kan ikke se noget som helst**. Det var dén dør, der gjorde
  MsGraphBud billig at bygge (`DESIGN.md` måling 3).
- **Rundturen er målt til ~150 ms** gennem tunnelen. F8 må **aldrig** kalde
  doda pr. optegning — status hentes med et tidsstempel-cache.
- **Der er ingen navneopløsning mellem runer.** URL + nøgle, som Andreas selv
  sætter begge steder. Peges URL'en på LAN-adressen, forsvinder de 150 ms
  uden en linje kode.
- Kommentarerne fra F7 er også dét, doda skal kunne vise på en note (`vis
  notens kommentarer` i planens F8).

**Udskudt med vilje — skriv det ikke som manglende:**

| | |
|---|---|
| Web-push på kommentarer | Sagu har ingen service worker; push kræver PWA-stakken → **F13** |
| Aliaser pr. side, fæstnede søgeord | to felter og en redigeringsflade hver → **F13** |
| Flere kodeord pr. udgivelse | modellen kan bære det; ingen har brug for det endnu |
| »Hent hele wikien som markdown-zip« | motoren findes (F5), skal afgrænses til udgivelsen → **F13** |

## 8 · Arbejdsgangen, kort

- **Bump aldrig `APP_VERSION` undervejs.** Kun ved udgivelse, efter et ja.
- **Commit og push kræver et udtrykkeligt ja.**
- Efter hver ændring: byg, test, opsummer — **og vent**.
- **Rapportér den målte payload efter hver `build_rune.py`.**
- En test skal have været **set fejle**, før den betyder noget — og for hver
  vagt for sig, når der er flere.
- Ny generel lærdom → `RUNE-ERFARINGER.md`. Projektspecifik → `CLAUDE.md`.
- Opdatér `SAGU-PLAN.md` og `DESIGN.md`, når fasen er slut.
