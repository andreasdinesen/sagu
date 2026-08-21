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
| **Noter** | Notesbøger, undersider i vilkårlig dybde, flytning med træk eller knapper, papirkurv med 30 dages frist, versionshistorik fra dag ét |
| **Editor** | Hybrid live-markdown: noten vises renderet, og et klik i et afsnit gør netop dét afsnit til et råt markdown-felt. Markdown er sandheden i databasen |
| **Blokke** | Kodeblokke med kopier-knap, billeder med lightbox, tabeller, tjeklister, citater og callouts, `[[note-titel]]` med backlinks |
| **Søgning** | FTS5 med vægtede kolonner, filtre (`tag:`, `in:`, `updated:<30d`, `has:code`), uddrag med fremhævning og hop til **afsnittet** |
| **Wiki** | Offentlige sider på `/w/<slug>`, server-renderet uden app-JS, med navigation, sideoversigt, søgning, ændringsfeed (Atom) og valgfrit kodeord |
| **Kommentarer** | I appen og på wikien, med moderationskø, honningkrukke og rate-limit |
| **Import** | Notions »Export → Markdown & CSV«, inklusive databaser → notesbøger, interne links og vedhæftninger |
| **Eksport** | Hele arkivet som markdown-mapper i en zip, eller som JSON, der kan gendannes |
| **Flerbruger** | `user_id` i dataadgangen selv, adgangsnøgler med scopes, passkeys |
| **Deling** | Del en side — og det under den — med en anden konto, som læse eller skrive. Arven regnes af træet, så en underside lavet bagefter kommer med. Ejerskifte flytter hele undertræet |
| **GitHub** | En fil-adresse på sin egen linje bliver til koden — **frosset til den commit, den pegede på**, så noten bliver ved med at forklare den kode, den blev skrevet om. Issues og PR-er bliver til chips med titel og tilstand |
| **Tastatur** | Enkelttaster uden ⌘/Ctrl, og en oversigt på `?` der er **genereret** af det samme bord, tasterne bruger |
| **Offline** | Hele appen kan læses uden net — træet, favoritterne og noterne med tekst og mærker. Rettelser parkeres på enheden og sendes, når nettet kommer igen; er siden ændret et andet sted i mellemtiden, får du begge tekster at se og vælger selv |
| **API** | Skrevet til en iPhone-genvej med ét tekstfelt: fangst som JSON, formulardata, ren tekst eller `?text=`, `?format=md` ud, `changes?since=` med slettede id'er — og en indbygget guide med færdige opskrifter |
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

Det gør scriptet **1.640 tegn — konstant, uanset hvor stor appen bliver**.
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
  shared/          UMD — bruges af BÅDE browseren og serveren
    markdown.js      rendereren; hvidliste, escape først
    soeg.js          søgesyntaksens parser
    notion.js        Notion-formatets parser
  parts/p1..p12.js frontend, samles til public/app.js af build'et
build_rune.py      ikon, kommentar-strip, require-spærre, payload-budget
tests/             372 tests
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
| **4** | **Rettelser skrevet uden net bliver sendt, når nettet kommer igen.** Én række pr. note, og konflikten løses med den vagt, der fandtes i forvejen: er siden ændret et andet sted i mellemtiden, bliver din tekst liggende og vist ved siden af deres, så du kan vælge. Dertil: sidemenuen lukker sig, når du vælger en note, og »er jeg offline?« afgøres nu af, om serveren svarer — ikke af hvad browseren mener om ledningen. |
| **3** | **Offline: hele appen kan læses uden net** — træet, favoritterne og noterne med tekst og mærker, med et bånd der siger det højt. Dertil fire ting, som først viste sig i brug: en **tom note kunne ikke åbnes** (pladsholderen fyldte kroppen helt ud, så der ikke var en pixel at ramme), knappen ved den offentlige adresse hed »Use this address« og *ryddede* feltet, mærkeforslagene brugte `<datalist>` og var derfor usynlige på iOS, og `#drift,net` er nu to mærker. Favoritter og »senest besøgte« kan foldes sammen. |
| **2** | doda-broen begge veje (F8), API og iPhone-genveje med indbygget guide (F9), MCP-server og claude.ai-connector med OAuth 2.1 (F10), deling mellem konti med arv gennem undertræet (F11), GitHub-indlejringer med frossen commit-sha (F12), tastaturgenveje, favoritter og »senest besøgte« (F13). |
| **1** | Første udgivelse. Fundament og flerbruger (F0), noter og editor (F1), søgning (F2), Notion-følelsen (F3), filer (F4), Notion-import og eksport (F5), wiki og offentliggørelse (F6), kommentarer (F7). |
