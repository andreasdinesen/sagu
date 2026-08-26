# Sagu

En noteapp og wiki, bygget som **yggdrasil-rune**. Notesbøger med undersider i
vilkårlig dybde, en hybrid live-markdown-editor, fuldtekstsøgning i titler,
overskrifter, brødtekst og mærker — og udgivelse af en side eller en hel
notesbog som en offentlig wiki med valgfrit kodeord og kommentarer.

Den er skrevet for at erstatte Notion: både det private notearkiv og de
offentlige sider, kollegaerne læser.

**Nul npm-pakker. Nul CDN.** Node ≥ 22 (`node:http`, `node:sqlite`,
`node:crypto`, `node:zlib`) og en SQLite-fil i `/data`. Det er ikke
sparsommelighed, men sikkerhedsvalget: uden afhængigheder findes der ingen
forsyningskæde at holde patchet.

## Hvad den kan

| | |
|---|---|
| **Noter** | Notesbøger, undersider i vilkårlig dybde, flytning med træk eller knapper, papirkurv med 30 dages frist, versionshistorik med valgfrit antal, en kontakt og en vej tilbage |
| **Editor** | Hybrid live-markdown: noten vises renderet, og et klik i et afsnit gør netop dét afsnit til et råt markdown-felt — eller hele noten, hvis man foretrækker det. Markdown er sandheden i databasen |
| **Blokke** | Kodeblokke med kopier-knap, billeder med lightbox, tabeller, tjeklister, citater og callouts, `[[note-titel]]` med backlinks. Trækhåndtag i margenen flytter en blok, sender den til doda eller sletter den. Et billede kan kopieres for sig, og hele noten kan kopieres **med billederne indeni** — til OneNote, Word, Mail og Pages. *Apple Notes tager tekst og formatering, men ikke billederne:* den afviser `data:`-adresser, og en webside må ikke lægge RTF på udklipsholderen |
| **Søgning** | FTS5 med vægtede kolonner, filtre (`tag:`, `in:`, `updated:<30d`, `has:code`), uddrag med fremhævning og hop til **afsnittet** |
| **Wiki** | Offentlige sider på `/w/<slug>`, server-renderet uden app-JS, med navigation, sideoversigt, søgning, ændringsfeed (Atom) og valgfrit kodeord |
| **Kommentarer** | I appen og på wikien, med moderationskø, honningkrukke og rate-limit |
| **Import** | Notions »Export → Markdown & CSV«, inklusive databaser → notesbøger, interne links og vedhæftninger |
| **Eksport** | Hele arkivet som markdown-mapper i en zip, eller som JSON, der kan gendannes |
| **Flerbruger** | `user_id` i dataadgangen selv, adgangsnøgler med scopes, passkeys, totrinsbekræftelse med nødkoder — alt sammen pr. konto. En administrator kan sætte et nyt kodeord på en anden konto uden at røre dens nøgler |
| **Deling** | Del en side — og det under den — med en anden konto, som læse eller skrive. Arven regnes af træet, så en underside lavet bagefter kommer med. Ejerskifte flytter hele undertræet |
| **GitHub** | En fil-adresse på sin egen linje bliver til koden — **frosset til den commit, den pegede på**, så noten bliver ved med at forklare den kode, den blev skrevet om. Issues og PR-er bliver til chips med titel og tilstand |
| **Tastatur** | Enkelttaster uden ⌘/Ctrl, og en oversigt på `?` der er **genereret** af det samme bord, tasterne bruger |
| **Offline** | Hele appen kan læses uden net — træet, favoritterne og noterne med tekst og mærker. Rettelser parkeres på enheden og sendes, når nettet kommer igen; er siden ændret et andet sted i mellemtiden, får du begge tekster at se og vælger selv. På telefonen henter et træk nedad nye data — ikke siden, så den åbne note og køen af rettelser overlever |
| **API** | Skrevet til en iPhone-genvej med ét tekstfelt: fangst som JSON, formulardata, ren tekst eller `?text=`, `?format=md` ud, `changes?since=` med slettede id'er — og en indbygget guide med færdige opskrifter. Et bogmærke, »Save to Sagu«, gemmer en side eller en markering fra en hvilken som helst browser |
| **doda-bro** | En note kan sende en tjeklistelinje til søsterappen [doda](https://github.com/andreasdinesen/doda) som en opgave og vise dens status igen — med links, aldrig synkronisering |
| **Claude** | MCP-server på `/mcp` med ni værktøjer, og OAuth 2.1 med samtykkeside, så claude.ai's webklient forbinder sig selv. Scopet håndhæves både i listen og ved kaldet |

## Installation

Sagu installeres gennem **Yggdrasil Panel**: `Runes → Browse GitHub`, peg på
dette repo, og installér.

**Install-scriptet bærer ikke app-koden — det henter den.** Panelets
install-script køres som ét `sh -c`-argument, og Linux' `MAX_ARG_STRLEN`
(131.072 b) er derfor loftet. Sagu voksede ud af det, så scriptet henter i
stedet app-mappen fra dette repos tag:

```
https://codeload.github.com/<ejer>/sagu/tar.gz/refs/tags/v<N>
```

Det gør scriptet **1.642 tegn — konstant, uanset hvor stor appen bliver**.
Prisen er, at en installation kræver netadgang, og at hver udgivelse skal
tagges. Regnestykket står i [`DESIGN.md`](DESIGN.md) måling 1.

## Kør den lokalt

```sh
BIND_PORT=8913 DATA_DIR=/tmp/sagudata SAGU_DEV=1 node app/server.js
```

`SAGU_DEV=1` slår `immutable`-cachen fra, så man kan se sine egne ændringer.
Første besøg opretter den første bruger, som bliver administrator;
registrering lukkes derefter automatisk.

## Byg og test

```sh
python3 build_rune.py          # → runes/sagu.yaml   (kræver PyYAML)
python3 build_rune.py --budget # + leave-one-out: hvad koster hver fil?
node --test --test-timeout=600000 tests/*.test.mjs
```

`app/public/app.js`, `app/public/icon-192.png` og `runes/sagu.yaml` er
**genererede artefakter** — redigér dem aldrig i hånden. De er committet med
vilje: det, GitHub har, er det, der bliver installeret.

En enkelt test springes over, med mindre `SAGU_NOTION_EKSPORT` peger på en
udpakket Notion-eksport.

## Sådan hænger det sammen

```
app/
  server.js        migrationer, auth, noter, træ, søgning, filer,
                   udgivelser, kommentarer, eksport/gendan
  wiki.js          de OFFENTLIGE sider — server-renderet, ingen app-JS
  import.js        Notion-import som baggrundsjob
  zip.js           egen ZIP-læser og -skriver oven på node:zlib
  webauthn.js      håndskrevet WebAuthn (passkeys)
  doda.js          broen til opgave-appen
  github.js        kode og sager i en note; ETag-cache, frossen commit-sha
  mcp.js           ni værktøjer over JSON-RPC
  oauth.js         OAuth 2.1 — motoren kender hverken database eller HTTP
  totp.js          totrinsbekræftelse — kopieret råt fra doda, nul pakker
  qr.js            QR-koden til opsætningen, tegnet som SVG
  shared/          UMD — bruges af BÅDE browseren og serveren
    markdown.js      rendereren; hvidliste, escape først — og de rene
                     tekstoperationer på en note, der kan prøves uden browser
    soeg.js          søgesyntaksens parser
    notion.js        Notion-formatets parser
    github.js        GitHub-adressernes seks former
    maerker.js       mærker: dem `#i` teksten, og dem der skrives i feltet
  parts/p1..p14.js frontend, samles til public/app.js af build'et
build_rune.py      ikon, kommentar-strip, require-spærre, payload-budget
tests/             497 prøver
```

## Nogle valg, der er værd at kende

- **Offentlige sider er deres egen skabelon, ikke SPA'en.** En besøgende
  henter aldrig app-koden og kan ikke kalde app-API'et — det er et
  *strukturelt* svar frem for et bevogtet, og der er en test på det.
- **Markdown renderes med escape-først og en hvidliste.** Der findes ingen vej
  fra en brugers tekst til et tag, så der er ingen sanitizer bagefter.
  Angrebssuiten køres i hver fase, der rører rendereren eller importerer
  indhold.
- **`user_id`-filteret ligger i dataadgangen selv**, aldrig i kaldstederne — og
  det gælder også administratorer. At være admin betyder at måtte ændre
  *installationen*, ikke at måtte læse andres noter.
- **Deles en side, deles det under den — og arven regnes af træet**, ikke af en
  kopieret adgangsrække. En underside lavet bagefter kommer med; flyttes en
  note ud, forsvinder adgangen med det samme. Ejeren betaler ingenting for
  det: hans eget id står først i betingelsen og kortslutter den.
- **At måtte skrive er ikke at måtte bestemme.** Slette, udgive, dele videre og
  give siden fra sig kan kun ejeren.
- **Ukendt, tilbagekaldt og udløbet svarer ens: 404.** En 403 ville bekræfte,
  at adressen findes.
- **Der er én vej ind i API'et.** Et OAuth-token fra connectoren er en helt
  almindelig række i nøgletabellen, bare med et klient-id og et udløb — så et
  tilbagekald kun skal huskes ét sted.
- **Interfacet er engelsk; koden, kommentarerne og dokumenterne er danske.**

Beslutningerne og deres begrundelser står i [`DESIGN.md`](DESIGN.md), planen i
[`SAGU-PLAN.md`](SAGU-PLAN.md), kravene i [`docs/HANDOVER.md`](docs/HANDOVER.md)
og reglerne i [`CLAUDE.md`](CLAUDE.md).

## Versionshistorik

| Version | |
|---|---|
| **36** | **Attachments og Comments kan foldes sammen**, med antallet på selve knappen, så man ved hvad man folder ud. De starter foldet **ud** — der blev bedt om en foldeknap, ikke om at få kommentarerne gemt væk — og folder man dem sammen, huskes det. Valget ligger i `editor.foldede`, det **samme** sæt som notesbøgerne bruger: to måder at folde på i samme app er to steder at rette næste gang. Det løser samtidig, at begge afsnit tegnes om under brug — en ny kommentar tegner afsnittet forfra, og uden en husket tilstand ville det klappe i, hver gang man skrev noget. To detaljer: **»N waiting« står på knappen**, ikke inde i det foldede — en kommentar der venter på moderering er det eneste her, man skal reagere på. Og **trekanten tegnes selv**: `display: flex` på et `summary` fjerner browserens egen `::marker`, så overskriften stod uden noget, der ligner en foldeknap. |
| **35** | **Kopiér-ikonet ved siden af SAVED tager nu hele noten med billederne** i stedet for ren markdown — »Copy i markdown findes alligevel under show as markdown«. Punktet bag `…` er fjernet i samme omgang; det stod to centimeter fra ikonet og gjorde det samme. **Og så grænsen, skrevet ned:** Apple Notes tager ikke `data:`-billeder i indsat HTML — den samme kopi giver billederne i OneNote på web og et blåt `?` i Apple Notes. Vejen udenom ville være RTF med billedet som `\pngblip`, men en webside må ikke: `setData('text/rtf', …)` kasseres **tavst** (prøvet med en gyldig RTF på 22 KB — bagefter lå der kun `«class utf8», 10`), macOS konverterer ikke selv HTML til RTF, og `ClipboardItem` tager kun de rensede typer. Så langt rækker en browser; i Apple Notes tages billederne ét ad gangen med »Copy image«. |
| **34** | **Rettelsen i v33 ramte ved siden af — her er den rigtige årsag.** Fejlen sad ikke i udklipsholderen, men i rendererens inline-mønster: `[^)\s]{1,2000}` — **adressen må højst være 2.000 tegn.** Et base64-billede på 252 KB fylder 337.000, så mønsteret matcher slet ikke, og `![x](data:…)` bliver stående som **ren tekst** i den HTML, vi lægger på udklipsholderen. Apple Notes viste vores HTML hele tiden og gengav den trofast; teksten var bare markdown. Beviset lå i det første skærmbillede — overskrifterne *var* blevet til Apple Notes' typografier, så HTML'en nåede frem — og jeg læste det forkert. Kuren er ikke at hæve loftet, men at rendere fra den oprindelige tekst med `sagu:<32 hex>` i (37 tegn) og lade billeddataen komme ud gennem `billedUrl`, hvor der ingen grænse er. Målt til macOS' egen udklipsholder: `«class HTML», 336983` med et rigtigt `<img>`. **Grunden til at jeg ikke fangede det: mine testbilleder var 261 bytes.** Hele forskellen lå i en størrelse, jeg aldrig prøvede. v33's ombytning er rullet tilbage — `clipboard.write` virkede hele tiden. |
| **33** | **Kopien nåede aldrig frem som andet end tekst.** Meldt fra brug: en note indsat i Apple Notes kom ind som rå markdown med billedet skrevet ud som en kilometerlang `data:`-adresse — og det samme i OneNote på web. To uafhængige apps, der begge falder tilbage til ren tekst, er ikke to apps med samme smag: `text/html` nåede aldrig frem. `navigator.clipboard.write()` fører sin HTML gennem en rensning, og den kom ikke ud i den anden ende. Målt på macOS' egen udklipsholder gennem `osascript`: med `copy`-hændelsen står der `«class HTML», 566` med et rigtigt `<img src="data:image/png…>` i. Den vej er nu hovedvejen — den kræver ingen tilladelse, kun et tryk — og `clipboard.write` står tilbage som reserve. Ruden »Show as markdown« havde samme fejl og bruger nu samme vej. **Fejlen var usynlig i appen:** knappen sagde »Note copied«, begge flavours blev bygget rigtigt, og hver måling i browseren var grøn. Den viste sig først, da nogen satte ind et andet sted. |
| **32** | **»Copy the note with images« ligger nu i notens `…`-menu** — ét klik, i stedet for først at åbne markdown-ruden. `text/html` bærer billederne, så det kan sættes direkte ind i Apple Notes, Mail eller Pages; `text/plain` er den **rene** markdown med `sagu:`-adresserne i behold, for en halv megabyte base64 i et tekstfelt er ikke en tekst, det er en mur. **Fluebenene forsvandt undervejs — asymmetrisk:** et flueben er en `<button role="checkbox">`, og den uafkrydsede er *tom*, så `- [x]` blev til »✓ afsluttet« mens `- [ ]` blev til bar tekst. En tjekliste ville altså tabe præcis de punkter, man ikke er færdig med. Begge tilstande skrives nu som `☐` og `☑`. Og et billede, loftet sprang over, beholdt en **relativ** adresse, der ikke betyder noget uden for Sagu. |
| **31** | **Kopiér en note med billederne indeni.** »Copy with images« i markdown-ruden bytter hver `sagu:`-adresse ud med billedet selv og skriver både markdown og HTML på udklipsholderen, så det kan indsættes i en editor *og* i Word eller en mail. Uden for Sagu betyder adressen ingenting — før kom man over med huller, hvor billederne havde stået. Der er et loft på 8 MB; bliver noget sprunget over, står det i beskeden med det samme, i stedet for at man opdager det i det dokument, man har indsat i. **Og billedsyntaks skrevet som eksempel i en kodeblok bliver stående** — byttede vi den ud, ville eksemplet drukne i en megabyte-lang `data:`-adresse. |
| **30** | **Én spaltebredde gennem hele appen.** Indholdet skiftede bredde, hver gang man gik fra en liste til en note — min egen fejl fra v22, hvor listesiderne fik 1240 px og søgefeltet blev på 820. Nu er det ét tal, og topbjælken har det også; prosa beholder sin læsebredde, men **venstrestillet**, så der er én lodret linje ned gennem appen. Tre ting gav skæve kanter undervejs: menuknappen skubbede feltet 54 px ind, topbjælken havde 8 px skyggemargen, og **søgefeltet var 10 px smallere end kortene** — mærke-chipsene var blevet et flex-element nummer to, så rækkens `gap` slog til. Havde man fået chips frem, ville de have stået *ved siden af* feltet. |
| **29** | **Hele noten som markdown** (Settings → Editing). Slået til åbner et klik hele noten i ét felt i stedet for kun det afsnit, man ramte — og markøren lander på den linje, man klikkede på. Det er et *valg*, ikke en erstatning: den hybride editor er god, når man retter en sætning, og i vejen, når man skal flytte rundt på det hele. Piletasterne krydser med vilje ikke blokgrænser her; hele noten *er* i feltet, så browserens egen opførsel er den rigtige. Dertil: **versionshistorikken ryddes op automatisk**, når man sænker antallet, og ved opstart for den bunke, der lå fra før grænsen fandtes. |
| **28** | **Versionshistorik med en grænse, en kontakt og en vej tilbage.** Maskineriet havde været der siden dag ét — uden nogen af delene, så tabellen var skrevet til ved hver eneste gemning og aldrig ryddet. Gemninger i samme skrivestund tæller som én, ellers dækkede de tredive versioner et par minutter. `gemVersion` stod **efter** skrivningen, og det taber hele skrivestundens resultat — den er flyttet før. Kontakten sletter ingenting: det gemte er en kendsgerning om noten. Dertil **»Delete this block«** i trækhåndtagets menu, med **Undo** i kvitteringen frem for en »er du sikker?« ved hver sletning. Og **op til toppen virkede ikke på en telefon**: `html, body { height: 100% }` med `overflow-x: hidden` gør `body` til rulleboksen under 900 px, så `window.scrollTo(0, 0)` gjorde ingenting. |
| **27** | **Klik på en doda-opgave, og den åbner i doda.** `?item=<id>` er dodas egen indgang — den, kalenderfeedet allerede peger med — så doda skulle ikke ændres. Adressen bygges på **serveren**, hvor resten af det Sagu ved om doda ligger; ellers ville dodas adresseform være spredt over to apps. Ingen forbindelse, intet link: rækkerne bliver stående, men titlen står som ren tekst, for et link, der peger ingen steder hen, er værre end intet link. |
| **26** | **Tre CSS-variabler, der aldrig har eksisteret.** »Man kan faktisk ikke se at der er en når den er tom« — om de tomme flueben — og symptomet var mindre end årsagen: kanten stod i `var(--line)`, en variabel Sagus tema aldrig har haft. En uopløselig variabel gør ikke erklæringen rød, den gør den **ugyldig**, så `border: 1.5px solid var(--line)` bliver til ingen kant overhovedet. Der stod tre af slagsen — `--line`, `--hover`, `--fg` — på otte steder, tilføjet over flere uger; også hover-farverne i blok-menuen, fillisten og bogmærke-kortet havde aldrig slået igennem. En formregel kræver nu, at hver `var(--x)` uden reserve er defineret. |
| **25** | **Broen til doda går nu begge veje.** Et flueben ud for hver opgave afslutter den i **doda**, ikke bare her — begge veje, for et flueben man ikke kan tage af igen er en fælde. Kun opgaver, der står på *denne* note, kan røres; ellers kunne et gættet id afslutte hvad som helst i dodas arkiv. Og **en opgave, doda har linket til en note, dukker op i noten** — der ledes efter `#note-<id>`, ikke efter værtsnavnet, for Sagu nås ad flere adresser. En sabotage afslørede en manglende prøve her: et `#note-`-id, der ikke findes, får fremmednøglen til at sige fra og **vælter hele opfriskningen** — én tilfældig hex-streng i én opgave ville slå opgavelisten ud for alt andet. |
| **24** | **Totrinsbekræftelse.** `totp.js` og `qr.js` er kopieret råt fra doda; kun udstedernavnet er skiftet. Tilpasningen er, at doda er énbruger og Sagu ikke er det — en global kontakt ville betyde, at den enes andet led spærrede for den anden. Seks værn, alle set fejle. **QR-koden indeholdt `[object Object]`:** `tilSvg()` tager teksten og kalder selv `lavQr()`, men serveren gav den et objekt. Koden så helt rigtig ud, og enhedsprøven bestod — *en enhedstest kan ikke fange et forkert kaldested*. Der er nu en prøve, der læser den SVG, **endepunktet** sender, og kræver adressen tilbage fra macOS' egen afkoder. Dertil: **billeder kan kopieres** fra lightboxen, og menuknappen er flyttet ind i bjælken ved siden af søgefeltet — den lå oven på feltet, så snart man rullede. |
| **23** | **Søgefeltet bliver i toppen, og krymper når man ruller.** En bjælke, der bare klæber, tager en fjerdedel af skærmen med sig ned gennem hele noten, så alt andet end selve feltet folder sig sammen — målt fra 191 px til 95 px. `sticky`, ikke `fixed`: fixed ville kræve en margen under bjælken, der passer præcis til dens højde. Første udgave lyttede på `scroll` og var ubrugelig — der kom **nul** scroll-hændelser, fordi »hvem ruller« skifter mellem `window`, `documentElement` og `body`. Nu ligger der en usynlig vagtpost over bjælken med en `IntersectionObserver`, som spørger om det, der betyder noget. |
| **22** | **Sorterbare overskrifter under All Notes**, og tabellerne får den plads, der er. Sorteringen sker i browseren — listen ligger allerede i hukommelsen. Dansk sortering, så Æ, Ø og Å hører sidst; en ny kolonne begynder den vej, man *mener* med den (titler fra A, datoer fra nyeste); og **noter uden mærker ligger sidst i begge retninger** — »ingen mærker« er fraværet af en værdi, ikke en værdi i den ene ende. Underteksten følger med, for en undertekst der lyver er værre end ingen. Læsebredden på 820 px gælder prosa; en tabel med fire kolonner er ikke prosa, så listesiderne bruger nu op til 1240 px. |
| **21** | **Tre opskrifter til at gemme et link fra telefonen** under »API & shortcuts«: fra delearket, ind i én løbende liste med `?to=NOTE_ID`, eller hele siden med »Hent artikel fra webside«. Titlen bliver notens titel, adressen står i kroppen som et klikbart link, `#tag` i første linje bliver et rigtigt mærke — alt sammen målt mod det rigtige API. |
| **20** | **En kommentar siger, hvor den kom fra.** tovo kunne svare på en notes kommentarer gennem sin nøgle, og tråden viste bare »Andreas« — samme navn som når Andreas selv skriver i Sagu. Kolonnen bærer **nøglens eget navn**, ikke en liste over apps, så Sagu ikke behøver at kende sine søskende: kommer der en fjerde afsender i morgen, virker mærket uden en linje ny kode. Mærket står uden for moderations-blokken med vilje — status er ejerens oplysning, men »skrevet fra tovo« er en oplysning til enhver, der læser tråden. |
| **19** | **Fire ting fra doda — og fejlen sammenligningen afslørede.** `aabnNote()` har et værn mod at genåbne den note, man står på, og det gjorde træk-ned-for-at-opfriske til ingenting for præcis den note, man kiggede på. Min prøve i v14 sagde noget andet, fordi der lå en **genindlæsning** imellem: den nye titel kom derfra, ikke fra trækket. *Fejlen i målingen er værre end fejlen selv.* Dertil: genvejsvejledningen bad om et »Text«-valg, der ikke findes i Genveje; `401` forklarer nu sig selv; appen henter data, når den kommer frem igen; og **filkvoten er blevet en indstilling** — med et afslag på en kvote under det, kontoen allerede bruger, for den efterlader kontoen over grænsen uden en vej ud, der ikke begynder med at slette noget. |
| **18** | **Markøren bliver, hvor man sætter den.** Et klik inde i skrivefeltet faldt igennem til reglen »et tryk i noten begynder at skrive«, og så blev blokken tegnet om med markøren sat til **slutningen** — satte man den i linje 1, hoppede den til linje 2. Feltet har ingen `data-blok`; det er netop dét, der gør det til den åbne blok, så det slap forbi begge de foregående vagter. Dertil hedder **adgangsnøglernes scopes nu det samme som i doda** — `read`, `capture`, `link`, `full` er de rå ord fra en tabel, og en familie af apps, hvor det samme begreb hedder to ting, tvinger folk til at oversætte i hovedet hver gang. |
| **17** | **Bogmærket »Save to Sagu«.** Vælg notesbog og evt. mærke, og træk linket op i bogmærkelinjen; markerer man noget først, gemmes kun markeringen. Bogmærket er skrevet som **almindelig læsbar kode**, og adressen bygges af funktionens egen `toString()` — en streng med kode i kan hverken læses, `node --check`'es eller rettes uden at tælle anførselstegn. Nøglen er `capture` og kan ikke være andet: et bogmærke ligger i klartekst og synkroniseres mellem maskiner, så den skal kunne lægge noget ind og **læse ingenting**. Der åbnes én CORS-dør, kun på `/api/v1/capture` — ufarlig, fordi sessionscookien er `SameSite=Lax` og aldrig følger med en POST fra et fremmed websted. Dertil: **note-id'et står nu i »…«-menuen**, for det stod kun i adressefeltet, og Chrome viser ikke fragmentet. |
| **16** | **En »?«-knap ved skrivefeltet — og en hjælp, der ikke kan lyve.** Ruden viser markdown og GitHub-indlejringen i tre spalter: hvad det er, hvad man skriver, og hvad man får — det sidste renderet med Sagus **egen** renderer. Knappen sidder ved feltet, ikke i værktøjsrækken, som på en telefon er rullet væk præcis når man skriver. Og pointen: listerne bor i `markdown.js` og `github.js`, ved siden af de regexp'er de beskriver, og **køres af testpakken** — saboterede jeg tabeller ud af rendereren, faldt to prøver; issues og PR'er ud af tolken, otte. Hjælpen kan ikke komme til at love noget, appen har holdt op med at kunne. |
| **15** | **En administrator kan sætte et nyt kodeord på en anden konto.** Uden den er en glemt adgangskode på en énmandsserver en tur i databasen med sqlite3. Fire ting er vigtigere end funktionen: det kræver en **session**, aldrig en nøgle (én lækket nøgle ville ellers være nok til at overtage hver konto); ikke sin egen konto; alle den ramtes sessioner droppes; og **API-nøglerne røres ikke** — en glemt adgangskode er ingen grund til at dræbe nogens telefongenveje. Dertil er **fillisten foldet sammen** som udgangspunkt: 36 px mod 2.109 px. |
| **14** | **Træk ned for at opfriske på mobilen.** Sagu kører som en installeret app, og dér findes browserens egen »træk ned« ikke — kom en note ind fra en anden enhed, stod skærmen med gårsdagens indhold. Den henter **data**, ikke siden: en `location.reload()` ville smide den åbne note, rullepositionen og en kø af usendte rettelser væk. Rækkefølgen er ikke til forhandling — en ventende gemning sendes **først**, ellers ville serverens ældre udgave overskrive det, man lige har skrevet. To fejl fundet ved at måle: vagten spurgte `window.scrollY`, som i Sagu altid er 0, og den spurgte om det **fokuserede** felt — søgefeltet tager fokus ved opstart, så gestussen kunne aldrig nås. |
| **13** | **Cmd/Ctrl+K åbner søgningen i den udgivne wiki**, præcis som i appen — den, der læser wikien, er som regel den, der skriver den. Og **fuld bredde er fjernet igen** efter ønske. Kolonnen `full_width` bliver i databasen, for migreringer er historie og en sikkerhedskopi fra i går skal kunne læses i morgen — men værdien **læses** ikke længere, ellers ville en note, der stod gemt som bred, hænge fast i visningen uden en knap at slå den fra med. |
| **12** | **De seks prikker kan også klikkes** — en menu med »Send to doda«. Klikket var ledigt: et træk begynder først efter 4 px. Blokken bliver til en **opgave**, ikke til kildekode: `blokSomLinje()` strimler markdown'ens markører væk og samler blokken til én linje, for ellers ville opgaven i doda hedde »- [ ] ring til Bo«. Fundet undervejs: det første klik åbnede blokken *bag* menuen — to rigtige regler stødte sammen, og grænsen mellem dem står nu skrevet ned begge steder. |
| **11** | **Trækhåndtag i noten** — seks prikker i margenen ud for hver blok. Selve flytningen er en ren tekstoperation i det delte markdown-modul, der splejser linjer frem for at sætte blokke sammen igen, så tomme linjer og indrykning overlever. Pointer-events, ikke HTML5-træk: mus, pen og finger bliver samme kode. Dertil **Cmd/Ctrl+K**, notesbøger **foldet sammen** som udgangspunkt, og dele-ikonet vises kun, når der *er* nogen at dele med. To fund: `laesFoldede()` var **dødt kode** — foldningen blev skrevet trofast i localStorage og aldrig læst tilbage, altså en indstilling appen lod som om den huskede. Og en blok trukket ned i bunden barberede notens afsluttende linjeskift af. Og: **en indsat GitHub-adresse alene på en linje bliver stående bar** — to af Sagus egne funktioner arbejdede mod hinanden, så et indsat GitHub-link kunne *aldrig* vise koden. »Hvad gør jeg forkert?« var det rigtige spørgsmål, og svaret var: ingenting. |
| **10** | **»Send to doda« virker nu også, når man markerer i det åbne redigeringsfelt** — altså den måde man faktisk markerer på. To ting stod i vejen: en vagt jeg selv havde skrevet ud fra en forkert antagelse, og at `getSelection()` ikke kan se ind i et tekstfelt. Dertil: **en opgave, du lukker i doda, opdateres nu i noten** — status blev før kun hentet hvert kvarter, så broen så død ud i præcis den gang, den er lavet til. Sagu kigger nu efter, når du kommer tilbage til fanen. |
| **9** | **Man kan markere tekst i en note igen** — klikket, der afslutter et træk, åbnede afsnittet som redigeringsfelt og ryddede markeringen. Det gjorde både kopiering og »Send to doda« umulig i praksis. Og **noterne under »Recent« og »Favourites« virker efter en sideindlæsning**: markup'en blev tegnet ét sted og bundet et andet, så punkterne stod uden klik-handler, til noget andet tegnede dem om. |
| **8** | **En kommentar tæller som `capture`, ikke som skrivning** — den er noget nyt ved siden af noten, ikke en ændring af den, så doda kan nu skrive en kommentar tilbage på den note, en opgave kom fra. Scopet kunne ikke sænkes alene: svaret bar hele samtalen, og så var skrive-døren blevet en læse-kanal. Listen kommer nu kun med, hvis nøglen også må læse. |
| **7** | **API'et kan lægge tekst eller et billede nederst i en note, du allerede har** — `?to=<note-id>`, samme dør som `?to=today`. Et `#tag` **lægges til** notens mærker i stedet for at erstatte dem; det gjorde det ikke før, og de gamle forsvandt uden at noget fejlede. Dertil: Sagu siger nu i toppen af skærmen, når der er kommet en ny version, med en knap der henter den — før stod det i sidebarens fod, som en telefon aldrig viser. |
| **6** | **Piletasterne kan skifte linje igen.** Editoren åbner ét afsnit ad gangen, så pilene stod stille ved afsnittets kant — de krydser nu blokgrænsen, og browseren får lov at prøve først, så et ombrudt afsnit ikke bliver forladt midt i. Dertil: en **notesbog kan omdøbes og slettes** (serveren har kunnet det hele tiden — der var ingen knap), »Not in a notebook« kan foldes sammen, og import-skærmen siger nu, hvad man gør ved et arkiv på over 100 MB. Indstillingerne siger desuden **at** der er gemt en API-nøgle — et tomt felt læses som »der er ingen« — og »Public address« har fået sit eget afsnit. |
| **5** | **Markér en linje i en note, og send den til doda som en opgave.** Knappen lægger sig over markeringen — systemets egen menu står nedenunder — og den lytter på et tryk frem for et klik, for et klik ville rydde markeringen, før den kunne læses. Dertil tre ting: den nye adgangsnøgle står nu i en rude, man selv lukker (før tegnede siden den væk, og en nøgle vises kun én gang), brugernavnet vises med stort begyndelsesbogstav, og mærkefeltet foreslår mens man skriver. |
| **4** | **Rettelser skrevet uden net bliver sendt, når nettet kommer igen.** Én række pr. note, og konflikten løses med den vagt, der fandtes i forvejen: er siden ændret et andet sted i mellemtiden, bliver din tekst liggende og vist ved siden af deres, så du kan vælge. Dertil: sidemenuen lukker sig, når du vælger en note, og »er jeg offline?« afgøres nu af, om serveren svarer — ikke af hvad browseren mener om ledningen. |
| **3** | **Offline: hele appen kan læses uden net** — træet, favoritterne og noterne med tekst og mærker, med et bånd der siger det højt. Dertil fire ting, som først viste sig i brug: en **tom note kunne ikke åbnes** (pladsholderen fyldte kroppen helt ud, så der ikke var en pixel at ramme), knappen ved den offentlige adresse hed »Use this address« og *ryddede* feltet, mærkeforslagene brugte `<datalist>` og var derfor usynlige på iOS, og `#drift,net` er nu to mærker. Favoritter og »senest besøgte« kan foldes sammen. |
| **2** | doda-broen begge veje (F8), API og iPhone-genveje med indbygget guide (F9), MCP-server og claude.ai-connector med OAuth 2.1 (F10), deling mellem konti med arv gennem undertræet (F11), GitHub-indlejringer med frossen commit-sha (F12), tastaturgenveje, favoritter og »senest besøgte« (F13). |
| **1** | Første udgivelse. Fundament og flerbruger (F0), noter og editor (F1), søgning (F2), Notion-følelsen (F3), filer (F4), Notion-import og eksport (F5), wiki og offentliggørelse (F6), kommentarer (F7). |
