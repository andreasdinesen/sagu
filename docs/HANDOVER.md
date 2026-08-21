# Sagu — kravbeskrivelse

> Kilden til krav. Andreas' egne ord fra 2026-08-20, struktureret. Ændres et krav,
> rettes det **her først** og derefter i `SAGU-PLAN.md` / `DESIGN.md`.

## Hvad Sagu er

En noteapp bygget som **yggdrasil-rune**, der skal **erstatte notion.so** som Andreas'
sted til alle noter — både de private og de wiki'er, kollegaerne læser på
`<arbejdsrum>.notion.site`. Den skal spille sammen med [doda](../doda) (opgaver) og
[tovo](../tovo) (tid), og **doda-integrationen er den vigtigste enkeltdel**.

## Krav, som Andreas har formuleret dem

### Noter og struktur
1. Notesbøger med underliggende sider (hierarki i flere niveauer).
2. Links til andre noter.
3. Tags.
4. Markdown: paste af markdown skal konverteres automatisk; hele noten skal kunne
   vises som ren markdown, så den kan kopieres ud.
5. God håndtering af links.
6. Kodestumper med en kopier-knap.
7. Billeder: let indsætning, og klik på et billede åbner det stort.
8. Sideoversigt i højre side med notens overskrifter, så man kan hoppe rundt i noten.
9. »De normale andre ting« — det Notion kan i en almindelig side.
10. Kommentarer på noter, som i Notion.

### Deling og offentliggørelse
11. Udgiv en **hovedside plus dens undersider** som en wiki på en URL — erstatningen
    for `<arbejdsrum>.notion.site`.
12. Hovedsiden skal have en **god søgefunktion**, så wiki'en er let at bruge.
    **Notions wiki-søgning er udtrykkeligt utilstrækkelig:** den finder reelt kun
    overskrifter. Sagus wiki-søgning skal dække **titler, tags OG brødtekst** — og
    må gerne gå videre end det (se planens afsnit »Wiki'en skal være bedre end
    Notions«, som er et krav og ikke pynt).
13. Pr. udgivelse vælges: **kodeordsbeskyttelse ja/nej** og **kommentarer ja/nej**.
14. En **enkelt note** skal også kunne synliggøres alene, med samme to valg.

### Flere brugere
15. Flere brugere på systemet.
16. Brugere skal kunne dele noter med hinanden.

### Integrationer
17. **doda** — vigtigst. Skal erstatte den nuværende Notion-integration i doda, og
    gerne blive bedre end den: `*` i dodas fangstfelt opretter en Sagu-note.
18. **MCP-server** (som doda har).
19. **Et godt API** til andre apps og til genveje på iPhone.
20. **GitHub** — hvis muligt: vise kode fra en GitHub-side inde i en note, som Notion kan.

### Data ind og ud
21. **Import fra notion.so**, så alle noter kommer med. Andreas har en del indhold
    liggende i **Notion-databaser**; hver database skal blive til **en notesbog med
    undersider**.
22. Import og eksport generelt.

### Udseende
23. Skal ligne doda og bygge på **samme søgefelt-funktion** som doda.

## Trufne beslutninger (2026-08-20)

| | |
|---|---|
| **Editor** | **Hybrid live-markdown.** Noten vises renderet; klik i et afsnit gør netop dét afsnit til et råt markdown-felt. Markdown er sandheden i databasen. |
| **`*`-markøren** | **Begge veje.** `*` i doda opretter en Sagu-note og hænger den på opgaven. `+` i Sagus søgefelt opretter en doda-opgave med link tilbage til noten. |
| **Rækkefølge** | Kerne → **Notion-import** → **wiki** → integrationer. Importen tidligt, så alt bagefter testes mod rigtigt indhold. |
| **Dodas noter** | **Bliver i doda.** Ingen migrering, ingen synkronisering. De to bindes sammen med links. |
| **Sprog** | **Interfacet er engelsk**, i tråd med doda — også den ramme, kollegaerne ser i wikien. Kode, kommentarer og disse dokumenter er dansk. |
| **Wikiens læsere** | **Kollegaerne får ikke logins.** Wikien tilgås offentligt uden konto. Kodeord er en kontakt, der kan slås til bagefter — uden at det udgivne link skifter. |

## Det, kravene betyder for brugerne

Krav 15–16 (flere brugere, deling mellem brugere) står ved magt i **datamodellen**:
`user_id` og `note_acl` ligger i skemaet fra F0, fordi et flerbrugerlag ikke kan
eftermonteres. Men **kollegaerne er læsere, ikke brugere** — de læser wikien uden konto.
Delings-UI'et mellem konti (F11) bygges derfor først, når der faktisk kommer en bruger
nummer to, og er ikke på den kritiske vej.

## Antagelser, der ikke er bekræftet

- Wiki'en får en adresse under et af Andreas' egne domæner (fx `sagu.<mit-domaene>`), og
  offentlige sider bor som `/w/<slug>` under den. Bekræftes inden F6.
- Sagu og doda taler sammen over en **URL og en API-nøgle**, som Andreas selv sætter i
  begge apps — ikke over Docker-intern navneopløsning. Se risiko R3 i planen.
