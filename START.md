# Startprompt til en ny samtale

Kopiér alt herunder ind som første besked i en tom samtale.

---

Vi skal bygge **Sagu** — min noteapp og wiki, bygget som yggdrasil-rune. Den skal erstatte
notion.so, både mit private notearkiv og de offentlige wiki'er på `<arbejdsrum>.notion.site`,
som mine kollegaer læser. Det er det største projekt indtil nu.

**Læs disse i denne rækkefølge, før du gør noget:**

1. `~/ClaudeMacBook/RUNE-ERFARINGER.md` — hele filen. Den skal læses **både før og efter**
   et stykke arbejde, og nye generelle lærdomme skrives ind nederst under »Log«.
2. `~/ClaudeMacBook/sagu/CLAUDE.md` — projektets ufravigelige regler.
3. `~/ClaudeMacBook/sagu/SAGU-PLAN.md` — arkitektur, datamodel, de 14 faser og status.
4. `~/ClaudeMacBook/sagu/docs/HANDOVER.md` — kravkilden med mine egne ord.

Læs også kildekoden i `~/ClaudeMacBook/doda`, som Sagu arver stak og udseende fra:
`app/parts/p2_omni.js` (søgefeltet), `app/mcp.js` + `app/oauth.js`, `app/notion.js`
(den integration, Sagu afløser), `app/server.js` omkring migreringen `m10` (`link_url` er
bevidst generisk — det er dér, Sagu skal ind) og `app/public/index.html` (CSS).
Sagu skal føles som doda.

**Byg F0.** Dens egentlige formål er fire målinger, der styrer resten af projektet —
payload-budgettet, om Node's SQLite har FTS5, om Sagu og doda kan nå hinanden på Hjorten,
og om serveren kan tage imod en Notion-zip på hundredvis af MB uden at læse den i
hukommelsen. Skriv svarene i `DESIGN.md`, som du opretter undervejs.

**Husk:**

- Interfacet er **engelsk**; kode, kommentarer og dokumenter er **dansk**.
- Nul npm-pakker, nul CDN. Node ≥22, `node:http` / `node:sqlite` / `node:crypto` / `node:zlib`.
- **Bump aldrig `APP_VERSION` undervejs**, og **commit/push kræver mit udtrykkelige ja**.
- Rapportér den målte payload-størrelse efter hver `python3 build_rune.py`.
- Byg, test, opsummer — og vent på mig efter hver fase. Opdatér `SAGU-PLAN.md` til sidst.
