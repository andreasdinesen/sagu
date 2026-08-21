# Overdragelse — Sagu, efter F13 (alle faser bygget)

> **Skrevet 2026-08-21.** Denne fil er et *øjebliksbillede*, ikke en kravkilde.
> Kravene står i `docs/HANDOVER.md`, beslutningerne i `DESIGN.md`, planen i
> `SAGU-PLAN.md`, og reglerne i `CLAUDE.md`. Denne fil fortæller kun, hvor
> arbejdet står, og hvad den næste skal gøre først.

---

## 1 · Hvor står vi

**ALLE faser er bygget (F0–F13). v1 (F0–F7) er i drift på Hjorten**; F8–F13
venter på et ja. Offentligt repo, install-scriptet henter app-koden fra `refs/tags/v<N>`.

| | |
|---|---|
| Tests | **372 grønne** (`node --test tests/*.test.mjs`, ~20 s), 1 sprunget over (kræver en rigtig Notion-eksport i `SAGU_NOTION_EKSPORT`) |
| Install-script | **1.640 / 126.000 tegn (1,3 %)** — koden hentes fra GitHub. Payloaden ville indlejret være **151.518 tegn (120,3 %)**: appen er for stor til den gamle vej |
| Repoet | **offentligt** (`andreasdinesen/sagu`), efter auditten i `DESIGN.md` §13 |
| `APP_VERSION` | **1** — bumpes først, når Andreas siger ja til v2 |
| Git | ét commit (`Sagu v1`), tagget `v1`. F8–F13 er **ucommitteret** |
| Migrationer | m1–m14 |
| Næste | **Udgivelse af v2.** Der er ingen faser tilbage i planen |

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
| F8 | doda-integration, begge veje | bygget |
| F9 | API og iPhone-genveje | bygget |
| F10 | MCP-server og claude.ai-connector | bygget |
| F11 | Deling mellem konti | bygget |
| F12 | GitHub i noter | bygget |
| F13 | Genveje, favoritter, spor | bygget |

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

**Prøvet i drift 2026-08-21:** Sagu v1 er installeret på Hjorten og svarer på
`sagu.<mit-domaene>`. Hentningen kørte i `node:24-alpine` uden tilpasning, så
busybox' `tar` og `find` er ikke længere et åbent spørgsmål.

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

## 3 · Det, der venter på Andreas

Ingen af dem må afgøres uden ham.

1. **Sagu v2 (F8–F13) er ikke udgivet.** Alt står ucommitteret i
   arbejdsmappen. Udgivelsen er tre trin: bump `APP_VERSION` til 2 → commit →
   `git tag v2` → `git push --tags`. **Runen henter `refs/tags/v<N>`, så uden
   taggen installerer den ingenting.**
2. **doda v40 venter på det samme ja.** dodas YAML peger på `refs/tags/v39`,
   som **ikke findes på GitHub**. doda må ikke geninstalleres, før den er
   bumpet og tagget — og panelets doda-felt skal have et `GITHUB_TOKEN`
   (dodas repo er privat; GitHub svarer 404, ikke 403, når tokenet mangler
   adgang).
3. **Connectoren skal prøves af mod den rigtige claude.ai.** Hele flowet er
   testet mod en rigtig server, men først en rigtig webklient viser, om
   opdagelsen holder hele vejen. Adressen er `https://<sagus-vaert>/mcp`
   (Settings → Connectors → Add custom connector).
4. **Skal `sagu.dk` pege på den?** Feltet »Public address« i Settings er der;
   det bestemmer, hvad links og `canonical` skrives med, og bruges aldrig til
   en omdirigering.

**Uden for projektet:** `~/ClaudeMacBook/rune-erfaringer/RUNE-ERFARINGER.md`
skal have F8–F10's lærdomme og committes+pushes — også det kræver et ja.

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
  server.js        migrationer m1–m10, auth, note-CRUD, træ, søgning,
                   vedhæftninger, udgivelser, eksport/gendan, MCP- og
                   OAuth-ruterne                               (~190 KB)
  doda.js          broen til opgave-appen: adresse + nøgle, aldrig pr. optegning
  github.js        kode og sager i en note (F12); ETag-cache, frossen sha
  mcp.js           ni værktøjer over JSON-RPC; kalder Sagus egne funktioner
  oauth.js         OAuth 2.1-motoren — porteret fra doda, kender hverken
                   database eller HTTP (seks funktioner injiceres)
  wiki.js          den OFFENTLIGE wiki — server-renderet, ingen app-JS
                   (inkl. kommentarformularen, som er ren HTML)
  import.js        Notion-import som baggrundsjob (start/status/afbryd/kig)
  zip.js           egen ZIP-læser og -skriver oven på node:zlib
  shared/          UMD — bruges af BÅDE browseren og serveren
    markdown.js      rendereren. Hvidliste. Kroge: billedUrl, linkUrl
    soeg.js          søgesyntaksens parser
    notion.js        Notion-formatets parser
  parts/p1..p12.js frontend, samles til public/app.js af build'et
                   (p8 = kommentarer, p9 = API-guiden, p10 = deling,
                    p11 = GitHub, p12 = genveje/favoritter)
  public/app.js    GENERERET — redigér aldrig
  public/wiki.js   wikiens egen lille fil (ikke app-koden)
runes/sagu.yaml    GENERERET — redigér aldrig
build_rune.py      ikoner, kommentar-strip, require-spærre, payload-budget
tests/*.test.mjs   372 tests i 20 filer
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

## 7 · F10 · connectoren — det, du skal vide, hvis du rører den

Hele historien står i `DESIGN.md` §18. Det korte:

- **`app/oauth.js` er porteret næsten ordret fra doda** og kender hverken
  database eller HTTP. Rør den kun, hvis protokollen kræver det — alt
  Sagu-specifikt hører i `server.js`.
- **Der er én vej ind i API'et.** Et OAuth-access-token er en helt almindelig
  række i `tokens`, bare med `client_id` og `expires_at`.
- **Fire ting fejler TAVST og har hver sin test**: 401 uden
  `resource_metadata`, `form-action 'self'` (dræber »Allow«), CORP der
  kasserer opdagelsesdokumentet, og et fremmed `Origin` (DNS-rebinding).
- **Sagu er flerbruger, doda er ikke.** En forbindelse hører til den, der
  trykkede »Allow«. `user_id` skal stå i hver eneste WHERE.

## 7b · F11 · deling — det, du skal vide, hvis du rører adgangen

Hele historien står i `DESIGN.md` §19. Det korte:

- **Der er ÉN adgangsregel**, og den bor i tre fragmenter i `server.js`:
  `SYNLIG` (må se), `SKRIVBAR` (må ændre) og `EJET` (må bestemme). De to
  første tager nøjagtig **to** parametre — `userId` to gange — fordi der er
  over tyve kaldsteder.
- **Arven regnes af det levende træ**, ikke af rækker. Rør den ikke uden at
  læse måling 5 først: en materialiseret ACL skulle vedligeholdes tre steder.
- **Fire ting kan kun ejeren:** slette, udgive, dele videre, give videre.
- **Hver ny liste er et sted, reglen kan mangle.** Otte huller lukkede i F11,
  og det sidste — sidebarens træ — blev fundet ved at logge ind som bruger
  nummer to og **kigge**, ikke af en test. Laver du en ny liste over noter,
  så spørg dig selv, om den er *mit arkiv* eller *alt jeg må se*. De to er
  ikke det samme.
- **`maaRette()` i `p10_deling.js`** er frontendens ene sted. Kommer der en
  femte måde at begynde en redigering på, skal den spørge dér.

## 7c · F12 og F13 — det korte

`DESIGN.md` §20 og §21. Det, der er værd at vide, før du rører dem:

- **Sha'en står i TEKSTEN.** Rør ikke ved det: markdown er sandheden, og det
  er dét, der gør, at en indlejring overlever en eksport.
- **Wikien henter aldrig fra GitHub.** Kun cachen. En offentlig side må ikke
  kunne bruge ejerens kvote op.
- **`GENVEJE` er ét bord**, og `?`-oversigten er genereret af det. Tilføjer du
  en genvej, står den i hjælpen af sig selv — det er hele pointen.
- **Favoritter og spor er brugerens.** Samme regel som alt andet i F11.

**Udskudt med vilje — skriv det ikke som manglende:**

| | |
|---|---|
| Web-push på kommentarer | Sagu har ingen service worker; push kræver PWA-stakken → **F13** |
| Aliaser pr. side, fæstnede søgeord | to felter og en redigeringsflade hver → **F13** |
| Flere kodeord pr. udgivelse | modellen kan bære det; ingen har brug for det endnu |
| »Hent hele wikien som markdown-zip« | motoren findes (F5), skal afgrænses til udgivelsen → **F13** |
| SSE-strøm på `/mcp` | alt besvares i selve POST-svaret; `GET`/`DELETE` svarer 405 |
| Deling af en hel NOTESBOG | en bog er ejerens; del bogens forside med undertræ i stedet |
| »Hvem rettede sidst« i fladen | `updated_by` gemmes og testes, men vises ikke endnu → **F13** |
| Delinger i en eksport | bevidst udeladt — en ACL-række peger på en anden brugers id (`DESIGN.md` §19) |
| GitHub Enterprise | kun `github.com`; en anden vært har sit eget API og sin egen godkendelse |
| Gists og mapper (`/tree/`) | en indlejring, der ikke kan vise noget nyttigt, skal ikke se ud som en indlejring |
| Syntaksfarver i en GitHub-indlejring | sproget sættes som klasse; farverne mangler stadig → senere |
| Migreringen af Notion-wikierne | ikke kode. Importen (F5) og udgivelsen (F6) er der; flytningen er Andreas' |

## 8 · Arbejdsgangen, kort

- **Bump aldrig `APP_VERSION` undervejs.** Kun ved udgivelse, efter et ja.
- **Commit og push kræver et udtrykkeligt ja.**
- Efter hver ændring: byg, test, opsummer — **og vent**.
- **Rapportér den målte payload efter hver `build_rune.py`.**
- En test skal have været **set fejle**, før den betyder noget — og for hver
  vagt for sig, når der er flere.
- Ny generel lærdom → `RUNE-ERFARINGER.md`. Projektspecifik → `CLAUDE.md`.
- Opdatér `SAGU-PLAN.md` og `DESIGN.md`, når fasen er slut.
