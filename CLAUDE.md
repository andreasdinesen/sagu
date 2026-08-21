# Sagu — projektregler

Noteapp og wiki. Yggdrasil-rune. **Flerbruger.** Erstatter notion.so.
Søskende til doda (opgaver) og tovo (tid) — bundet sammen med **links, aldrig synkronisering**.

## Før du gør noget

1. `~/ClaudeMacBook/RUNE-ERFARINGER.md` — hele filen. **Læs den FØR og EFTER** et stykke
   arbejde. Ny generel lærdom skrives nederst under »Log«, og repoet committes+pushes.
2. `SAGU-PLAN.md` — fasen du er i gang med, og status.
3. `docs/HANDOVER.md` — kravkilden.
4. `DESIGN.md` — alle trufne beslutninger. Ændres noget, rettes det **her først**.
5. `docs/OVERDRAGELSE.md` — hvor arbejdet står lige nu, og hvad der venter på Andreas.

Ved projektstart læses også kildekoden i `~/ClaudeMacBook/doda`: `app/parts/p2_omni.js`
(søgefeltet), `app/mcp.js` + `app/oauth.js` (MCP og connector), `app/notion.js` (den
integration, Sagu afløser), `app/server.js` omkring `link_url` (m10 — feltet er bevidst
generisk) og `app/public/index.html` (CSS). **Sagu skal føles som doda.**

## Ufravigeligt

- **Interfacet er ENGELSK** — som doda, og også den ramme, kollegaerne ser i wikien.
  Kode, kommentarer, commit-beskeder og disse dokumenter er **dansk**.
- **Nul npm-pakker, nul CDN.** Node ≥22: `node:http`, `node:sqlite`, `node:crypto`, `node:zlib`.
- **`user_id`-filteret ligger i `hentNote` / `hentNoter` / `gemNote` / `gemBulk` selv** —
  aldrig i kaldstederne. Admin er ingen undtagelse. `note_acl` gælder også admin.
- **Deles en side, deles det under den — og arven REGNES af det levende træ**
  (`ARVET` i `SYNLIG`/`SKRIVBAR`). Aldrig en ACL-række pr. underside: den skulle
  vedligeholdes tre steder og ville drive fra træet. Ejeren betaler intet for arven —
  `n.user_id = ?` står først i OR'en og kortslutter den (DESIGN.md måling 5).
- **`SYNLIG` og `SKRIVBAR` tager nøjagtig TO parametre** (`userId` to gange). Over tyve
  kaldsteder; et fragment, der kræver tre, skal rettes hvert eneste sted.
- **Fire ting kan kun ejeren** (`EJET`): slette, udgive, dele videre og give siden fra
  sig. `write` betyder »skriv i den«, ikke »bestem over den«.
- **»All notes« og sidebarens træ er MINE noter.** `SYNLIG` bliver stående, men begge
  lister filtrerer også på `n.user_id = ?` — en delt side ligger i EJERENS notesbog og
  ville ellers stå midt i mine egne. Det, andre har delt, har sin egen visning.
- **Mærker på en note hører til notens EJER**, ikke til den, der skriver. Ellers laver en
  kollegas `#drift` et mærke under hans konto på min note.
- **En underside arver sin forælders EJER** — et undertræ har én ejer, præcis som det
  ligger i én notesbog. Derfor kan en note heller ikke flyttes ind under en fremmed side.
- **Søgeindekset har INGEN `user_id`** (m12). Et indeks afgrænser ikke adgang — `SYNLIG`
  gør, på `notes`. Filteret kunne aldrig finde en delt note, og kolonnen, der blev
  tilbage, lignede en spærring uden at være en. En formregel holder filteret væk.
- **Ét sted tegner OG binder.** `tegnGenveje()`/`tegnTrae()` fylder deres element og
  binder i samme åndedrag; markup'en må ikke ALDRIG også laves af `shellHtml()`. Gør den
  det, står punkterne uden klik-handler efter hver sideindlæsning — de ser rigtige ud og
  gør ingenting, til noget andet tilfældigvis tegner dem om.
- **En markering er ikke en anmodning om at redigere.** Klikket, der afslutter et træk hen
  over teksten, må ikke åbne den rå blok: så kan man hverken kopiere tekst eller nå
  »Send to doda«-knappen.
- **`maaRette()` er ét sted**, brugt af de fire steder en redigering kan begynde:
  titelfeltet, at åbne en blok, tjekbokse og mærkerækken. `aabnSidste()` har sin egen
  kopi af vagten, fordi dens tomme gren går uden om `aabnBlok()`.
- **Et tryk HVOR SOM HELST i notekroppen begynder at skrive.** Reglen var før »kun det
  tomme areal under indholdet«, og på en tom note findes det areal ikke — pladsholderen
  fylder kroppen helt ud. Links, tjekbokse, billeder og GitHub-knapper standser selv
  deres hændelse.
- **En tom linje er IKKE en blok.** `blokke('\n')` giver `[]`, og editoren regner med
  det: en tom første blok er derfor et gyldigt mål i `tegnMedAabenBlok`, ikke et fravær.
- **Mærke-reglen ligger i `app/shared/maerker.js`** — også kommaet. `#drift,net` er to
  mærker; `#drift, net` er ét og en sætning. Reglen gælder titelfeltet, mærkefeltet,
  `capture` og MCP'en på én gang.
- **Brug ikke `<datalist>`.** Den virker ikke på iOS, så forslag findes kun for halvdelen
  af brugerne. Tegn listen selv — og husk så også piletaster, Tab, Enter og klik.
- **En knap skal hedde det, den gør.** »Use this address« ryddede feltet og blev læst som
  »brug den her adresse«. Gør knappen noget, man ikke kan fortryde med et klik, spørger den.
- **Service workeren cacher alt under `/api/`** — ikke kun `/api/v1/`. `/api/me` fra en
  cache ville overleve et log ud.
- **`sw.js`' `VERSION` stemples af build'et sammen med `index.html`s `?v=`.** Bumpes
  cachenavnet ikke, kan workeren servere en gammel `app.js` i det uendelige (doda v39).
- **Offline-cachen ryddes ved log ud.** En cache overlever en session; »log ud« skal
  betyde, at noterne er væk fra telefonen.
- **Offline-køen har ÉN række pr. note**, ikke én pr. rettelse — og den gemmer det
  `ifUpdatedAt`, man **startede** fra. Skubbes stemplet frem, sammenligner konfliktvagten
  med sig selv og siger god for alt.
- **En konflikt i køen kastes ALDRIG væk.** Køen er det eneste sted, den tekst findes.
- **`navigator.onLine` afgør ikke, om vi er offline** — det gør, om serveren svarer.
- **Brugernavnet vises med stort — og gemmes uændret.** `pentBrugernavn()` er en
  VISNINGSregel; alt der sammenlignes eller sendes, skal være det, brugeren tastede.
- **En værdi, man kun får at se én gang, hører i en rude** — ikke i et felt på en side,
  en optegning kan tegne væk. Og den rude lukker ikke på et klik ved siden af.
- **En rute uden en knap er ikke en funktion.** Notesbogens sletning fandtes på serveren
  fra F1 og var uopnåelig i fladen i fem versioner.
- **Piletaster ved en blokgrænse: lad browseren prøve FØRST.** Flyttede den markøren, var
  det dét, brugeren mente. At tælle `\n` ville springe ud af et ombrudt afsnit midt i.
- **Knappen ved en markering lytter på `mousedown`/`touchstart`, ikke `click`.** Et klik
  rydder markeringen, før handleren når at læse den.
- **Wikien caches aldrig offline.** En offentlig side hører til den besøgende, og en kopi
  kan vise noget, der er trukket tilbage. En flade, der lader dig skrive
  og først afviser ved gemningen, ligner en fejl i appen — ikke en spærring.
- **En GitHub-adresse i en note bærer sin egen sha.** Grenen slås op ÉN gang, ved
  indsættelsen, og adressen skrives om i **teksten** — ikke i en tabel ved siden af.
  Ellers forklarer noten en kode, der ikke findes mere, uden at noget fejler.
- **Wikien henter ALDRIG fra GitHub — kun fra `github_cache`.** En fremmed, der
  genindlæser hurtigt nok, ville ellers bruge ejerens kvote op med ejerens token.
- **`bartLink`-krogen kender ikke GitHub.** Rendereren ved kun, at afsnittet er én bar
  adresse; hvad det skal blive til, bestemmer værten. Samme snit som `linkUrl`.
- **`SAGU_GITHUB_API` accepterer kun loopback.** En test-søm, der kan pege hvor som
  helst, er en måde at sende tokenet til en fremmed vært på.
- **Genvejene står i ÉT bord** (`GENVEJE` i `p12_polering.js`), og `?`-oversigten er
  genereret af det. En afskrevet genvejsliste er en liste over hvad appen plejede at kunne.
- **Favoritter og »senest besøgte« er BRUGERENS**, ikke notens — og læses gennem `SYNLIG`.
  Et flag på noten ville vise min stjerne hos den, jeg har delt med.
- **Sporet skrives i selve note-opslaget**, hvor alle veje ind mødes. Og aldrig af en
  nøgle: en genvej eller en MCP-klient er ikke mig, der var her.
- **En eksport bærer ikke `note_acl`.** Rækken peger på en anden brugers id; gendannet i
  en frisk installation kunne den give adgang til nogen, ingen har peget på.
- **Endepunkter uden login** (`/w/:slug`, `/s/:token`, filer i et delt træ) må aldrig
  scanne datasættet, og svarer **404** ved forkert token — ikke 401 eller 403.
- **Udgivelsens noter beregnes ét sted** (`udgivelsensNoter`), og hver eneste offentlige
  rute — side, søgning, fil, feed, ændringsliste — spørger den. To lister betyder, at
  den ene glemmer en spærring. Uden kodeord svarer **kun forsiden**, og den nævner ikke
  engang wikiens titel.
- **Offentlige sider serveres af deres egen skabelon uden app-JS.** En besøgende må
  hverken hente app-koden eller kunne kalde app-API'et. Kollegaerne har **ingen konti** —
  en udgivelse er offentlig som udgangspunkt.
- **Den offentlige adresse er et FELT** (`public_url`, scope `*`, kun admin). Sagu kan
  nås på flere værtsnavne; feltet bestemmer, hvad links skrives med og hvad `canonical`
  siger. Den bruges **aldrig** til en omdirigering — kun til at vise. Tom = kaldets egen
  vært, præcis som før.
- **At slå kodeord til på en udgivelse må aldrig ændre `slug` eller `token`.** Linket i
  kollegaernes bogmærker skal overleve, at siden bliver beskyttet.
- **`body_md` kommer aldrig med i et listesvar.** Lister får titel, mærker og tællere.
- **Markdown renderes af `app/shared/markdown.js`** — et UMD-modul, som BÅDE
  browseren og den server-renderede wiki (F6) bruger. Escape først, match
  bagefter; `esc()` til tekst og `attr()` til attributter; `sikkerUrl()` er en
  hvidliste. Ingen rå HTML igennem, nogensinde.
  **Angrebssuiten (`tests/markdown.test.mjs`) køres i hver fase, der rører
  rendereren eller importerer indhold** — F3, F5, F6 og F7. Den parser de rigtige
  tags frem for at regex'e efter `on…=`; et regex kan ikke se forskel på en
  attribut og tekst, der ligner en.
- **Kommentarer har ÉN vej ind** (`opretKommentar`), og `origin` afgør reglerne. En
  gæst på wikien er ikke en bruger: hans kommentar lander i moderationskøen, og **en
  gæstekommentar med et link modereres altid** — også når køen er slået fra. Tråden er
  ét niveau; et svar på et svar hænger på toppen.
- **Ethvert træ skal have en cyklus-vagt.** En note flyttet ind under sit eget
  barn giver en ring, hvor begge forsvinder fra sidebaren — og gemningen
  lykkes, så intet fejler.
- **doda kaldes ALDRIG pr. optegning.** Rundturen er ~150 ms. Status på en notes
  opgaver står i Sagus egen `doda_tasks` og opfriskes højst én gang i kvarteret — med
  ÉT kald (`/changes?since=`) for alle opgaver, ikke ét pr. opgave. En fejlet
  opfriskning rører ikke rækkerne; den siger bare, at de ikke er friske.
- **Et link til en note skal have sin EGEN linje**, når det sendes til doda. `!`-markøren
  løber til linjens ende, så et link hængt på enden æder både sig selv og datoen — uden
  at noget fejler (DESIGN.md §16).
- **En KOMMENTAR er `capture`, ikke `write`.** Den er noget nyt ved siden af noten, ikke en
  ændring af den — samme skel som F11 traf, hvor en side delt til læsning godt må
  kommenteres. At tilføje til notens egen tekst kræver derimod skriveadgang.
- **Et svar må aldrig bære mere, end kaldet bad om.** Kommentar-POST returnerede hele
  samtalen; med `capture` ville skrive-døren være blevet en læse-kanal. `maaLaese(auth)`
  afgør, om listen kommer med.
- **`link`-scopet er read+capture og aldrig `write`.** Det er den rettighed, en søsterapp
  skal have: finde den rigtige note og lave en ny — ikke slette arkivet.
- **Den tilgivende formularlæser kender ikke feltnavne.** »Kroppen ER teksten« gælder kun,
  når der ikke er ét eneste `=` i den. Reglen hed før »intet text/title/note-felt«, og den
  åd samtykkeformularens syv felter, så »Allow« svarede 400.
- **API'et er skrevet til en genvej med ét tekstfelt.** `POST /api/v1/capture` tager
  teksten som JSON, formulardata, ren krop eller `?text=` — og svarer med en færdig
  `message`-linje. »Tilgivende« gælder KUN ved nøgle-adgang: en Bearer-nøgle sendes
  aktivt, så der er intet at forfalske.
- **»I dag« er ÉN regel på serveren** (`iDagISO`/`dagensNote`). Den lå før i frontenden
  (lokal tid) og i `/state` (UTC) og var uenig med sig selv. En klient må sende sin egen
  `date=` — telefonen ved bedre end serveren, hvornår det er i dag hos brugeren.
- **`?to=` afgør, hvor en fangst lander:** ingenting = ny note, `today` = dagens, et
  **note-id** = den note. Formen tolkes ÉT sted, så tekst og billede ikke kan komme i utakt.
  Et id kræver **skrive**-adgang: at lægge noget nederst i en side er at ændre den.
- **Mærker LÆGGES TIL, når man tilføjer til en note, der findes.** `saetMaerker` skriver
  forfra (den rydder `note_tags`), og det er rigtigt i mærkerækken — men en fangst, der
  sletter notens øvrige mærker, er en stille fejl.
- **Kun en NYERE serverversion er en opdatering.** `!==` gav »v5 is ready, you are running
  v6«, når serverprocessen ikke var genstartet.
- **Serveren læser sin version frisk (efter mtime).** Panelets »Opdatér app« skriver
  app-filerne uden at genstarte containeren; et tal læst ved opstart bliver aldrig rigtigt igen.
- **`?format=md` skriver ikke om på brugerens tekst:** har noten sin egen overskrift,
  står den urørt.
- **Guiden (`p9_guide.js`) er en kravspecifikation.** En formregel slår hver **metode og
  adresse** i opskrifterne op i serverens ruter. Ændres et endepunkt, skal guiden med i
  samme ombæring.
- **Adgangsnøgler har en `user_id`** og et scope. En nøgle når sin egen brugers data og
  intet andet.
- **Et OAuth-access-token ER en adgangsnøgle** — samme `tokens`-tabel, samme `findToken`,
  bare med et `client_id` og et udløb. Én vej ind i API'et; to tabeller ville betyde to
  steder at huske et tilbagekald. Nøglelisten filtrerer derfor på `client_id IS NULL`.
- **En forbindelse hører til den, der godkendte den** — ikke til installationen.
  `hentForbindelser` og `tilbagekaldKlient` har `user_id` i HVER eneste WHERE.
  Klientrækken deles gerne mellem brugere; tokens gør ikke.
- **Kun `read` og `full` tilbydes over OAuth.** `capture` og `link` kan ikke beskrives i
  én sætning på en samtykkeside — »kan skrive, men ikke læse« er ikke et valg, nogen
  træffer. De laves i hånden under Settings.
- **De offentlige OAuth-ruter sætter `Cross-Origin-Resource-Policy: cross-origin` selv.**
  `securityHeaders` sætter `same-origin`, og den kasserer svaret EFTER CORS-tjekket.
- **Samtykkesidens CSP skal udvides med klientens oprindelse** (`form-action`). Direktivet
  håndhæves på den omdirigering, indsendelsen fører til — uden den dør »Allow« tavst.
- **En udgivelse bliver til ét sted** (`opretUdgivelse`). MCP'ens `publish_note` skal ramme
  de samme spærringer som knappen i appen; det ligger PÅ NETTET, hvis den ene glemmer en.
- **`settings` har `(scope, key)`**, hvor scope er brugerens id eller `*` for installationen.
  Kun admin skriver `*`-nøgler. Hemmeligheder (`github_token`, `doda_key`, …) er
  `secret: true` og forlader **aldrig** serveren — frontenden får `connected: true`.
- `app/public/app.js` og `runes/sagu.yaml` er **genererede** — redigér dem aldrig i hånden.
- **Søgningen har en `folded`-kolonne, og den er ikke pynt.** FTS5's
  `remove_diacritics 2` folder `Å`, men **ikke `ø` og `æ`** — de er
  selvstændige bogstaver i Unicode. Uden kolonnen kan »grøn« ikke findes ved at
  taste »gron«. Kortlægningen er **dansk**; et nyt sprog er en ny kortlægning.
- **Repoet `andreasdinesen/sagu` er OFFENTLIGT** (Andreas, 2026-08-21), og
  **install-scriptet henter app-koden derfra** i stedet for at bære den
  (DESIGN.md måling 1). Tre følger, som ikke må glemmes:
  - **En hemmelighed må aldrig i en kildefil.** Tokens hører i `settings` som
    `secret: true` eller i en rune-variabel. Auditten står i DESIGN.md §13.
  - **Det, GitHub har, er det, der installeres.** De genererede filer
    (`app/public/app.js`, ikonet) SKAL være committet; `tjek_git()` i build'et
    fælder ellers.
  - **En udgivelse er tre trin, ikke ét:** commit → `git tag v<N>` →
    `git push --tags`. Runens version N henter `refs/tags/vN`. Uden taggen
    installerer runen ingenting — og siger det højt.
- GitHub svarer **404, ikke 403** — både når adressen ikke findes, og når der
  ikke er adgang. Enhver fejlbesked om en mislykket hentning skal nævne begge,
  ellers fejlsøger man et token, der er helt i orden.
- **Notions eksportformat udledes af de stier, der FINDES — det gættes aldrig.**
  Dokumentationen siger `Titel <32 hex>/` om undersidernes mappe; i Andreas'
  rigtige eksport har **0 af 97 mapper** et hex, og navnet er afkortet ved ~48
  tegn. Begge former skal virke. Af samme grund slås en databaserække op på
  notens **rigtige** titel (`# Titel` inde i filen), ikke på filnavnets — CSV'en
  har den fulde, filnavnet den klippede.
- **Nøglen til en importeret side er hex-id'et, aldrig titlen.** Eksporten har
  12 dublettitler, én af dem seks gange. Id'et er også det, der gør en gentaget
  import idempotent (`ext_id`).
- **En udledt tabel eksporteres aldrig.** `note_links` udledes af notens tekst
  og genopbygges fra teksten ved gendannelsen — ellers kan den vende tilbage i
  utakt med det, den er udledt af.
- **Ingen backticks i en SQL-template** — heller ikke i en kommentar. En backtick
  afslutter template-literalen, og fejlen bliver en `SyntaxError` et helt andet sted i
  filen. Det er sket fire gange; der er en formregel nu.
- Kildefiler må ikke indeholde `{{STORE_BOGSTAVER}}` eller `YGG_PAYLOAD_EOF`.
- Echo-linjer i install-scriptet: **ASCII** (æøå → ae/oe/aa).

## Arbejdsgang

- **Bump aldrig `APP_VERSION` undervejs.** Kun ved udgivelse, efter Andreas har sagt ja.
- **Commit og push kræver et udtrykkeligt ja.** Et push er en udgivelse.
- Efter hver ændring: byg, test, opsummer — og vent.
- **Rapportér den målte payload-størrelse efter hver `build_rune.py`.** Den er ikke
  længere et loft — install-scriptet henter koden og er 1.640 tegn — men tallet er
  fortsat målet på, hvor stor appen er blevet, og build'et skriver det.
  `HENT_FRA_GITHUB = False` giver den indlejrede rune tilbage; den er den eneste,
  der virker uden net ved installationen.
- Ny generel lærdom → `RUNE-ERFARINGER.md`. Projekt-specifik → denne fil.

## Faldgruber, der allerede har kostet tid i andre runer

- `crypto.randomUUID()` findes ikke over http (panelets IP:port) — brug altid
  `crypto.getRandomValues`-fallback.
- CSS skal have `[hidden]{display:none!important}`.
- Mobilgrænsen er **900 px** og bor i én konstant, brugt af både `matchMedia()` og `@media`.
- `render()` må ikke `scrollTo(0,0)` ved gentegning af samme side.
- `overflow-wrap: break-word` på `body` — importerede titler og URL'er er lange og ubrudte.
- Print-HTML må aldrig bruge `var(--…)`-farver; `@page { margin: 0 }` fjerner browserens
  sidehoved og -fod; baggrunde kræver `print-color-adjust: exact`.
- `Object.assign({headers}, opts)` er shallow — sæt headers **efter** merge.
- Cache-bust: `app.js?v=N` stemplet af build'et, **skriv HTML'en tilbage til disk**, og
  server HTML `no-store`. Cloudflare edge-cacher `.js` i timer og ignorerer `no-cache`.
- Serveren logger `server.address().port`, ikke `BIND_PORT`.
- **Læg aldrig billeder i de items, listen henter** (Kokkeri: 247 MB login-svar).

## Lokal kørsel

```sh
BIND_PORT=8913 DATA_DIR=/tmp/sagudata SAGU_DEV=1 node app/server.js
python3 build_rune.py
node --test tests/*.test.mjs
```

Dev-serveren hedder `sagu` i den **globale** `~/.claude/launch.json` (port **8913** —
8910 er dodas, 8911 tovos, 8912 er optaget). `SAGU_DEV=1` slår `immutable`-cachen fra.

## Test

- Kør altid med `BIND_PORT=0`; tag serverens stderr med i timeout-beskeden.
- **Isolationstesten køres i hver fase**, ikke kun én gang: to brugere, 404 overalt.
  Den skal have været set fejle (fjern `AND user_id = ?` → røde tests).
- **Delingstesten er lige så vigtig:** en besøgende uden kodeord skal få 404 på side,
  søgning, billeder og vedhæftninger — også dem, der ligger dybt i et delt træ.
- Rundturs-testen (eksportér, slet databasen og filmappen fysisk, importér, sammenlign
  felt for felt og filer byte for byte) er projektets vigtigste test.
- Tastaturnavigation kan ikke testes gennem browser-panelet (tom `e.key`) — dispatch en
  rigtig `KeyboardEvent`. Mål efter animationer, ikke under dem. **Et klik på en
  submit-knap i panelet sender ikke formularen** — kald `form.requestSubmit()`.
- **`tests/form.test.mjs` er formregler på kilden**, ikke på adfærden: `.meta` er en
  versal etiket og må aldrig bære prosa eller en adresse, hvert `apiFejl` skal have
  en maskinkode og en sætning, og **en handler bundet ved navn skal tage hændelsen som
  første parameter** (`addEventListener('click', visUdgivPanel)` gjorde klikket til
  funktionens `maal`). En note virker kun, mens man husker at læse den — en
  formregel gælder også det, man skriver om et halvt år (tools v2).
- **`tests/deling.test.mjs` er isolationstestens modstykke.** Isolationstesten beviser, at
  to konti ikke kan nå hinanden; denne beviser, at en deling giver præcis den adgang, den
  lover — **og ikke en tomme mere**. Det farlige ved deling er ikke, at for lidt virker.
- **Delingstesten skal ses fejle i BEGGE ender:** sabotér låsen (`erLaastOp`) og sabotér
  udgivelsens id-liste (`filIUdgivelse`, `hentUdgivetNote`, `soegIUdgivelse`) hver for
  sig. Den anden sabotage afslørede, at filvagten slet ikke var dækket.
