# Sagu — projektregler

Noteapp og wiki. Yggdrasil-rune. **Flerbruger.** Erstatter notion.so.
Søskende til doda (opgaver) og tovo (tid) — bundet sammen med **links, aldrig synkronisering**.

> Denne fil rummer kun det, der gælder ved hver eneste ændring. De øvrige
> projektregler ligger i `docs/regler/` og er lige så ufravigelige — slå op dér,
> når opgaven rammer området. Oversigten står nederst.

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

## Ufravigeligt ved hver ændring

- **Interfacet er ENGELSK** — som doda, og også den ramme, kollegaerne ser i wikien.
  Kode, kommentarer, commit-beskeder og disse dokumenter er **dansk**.
- **Nul npm-pakker, nul CDN.** Node ≥22: `node:http`, `node:sqlite`, `node:crypto`, `node:zlib`.
- `app/public/app.js` og `runes/sagu.yaml` er **genererede** — redigér dem aldrig i hånden.
- **Repoet `andreasdinesen/sagu` er OFFENTLIGT**, og install-scriptet henter app-koden
  derfra. **En hemmelighed må aldrig i en kildefil** — tokens hører i `settings` som
  `secret: true` eller i en rune-variabel. De genererede filer SKAL være committet.
- **Ingen backticks i en SQL-template** — heller ikke i en kommentar. Det er sket fire
  gange; der er en formregel nu.
- Kildefiler må ikke indeholde `{{STORE_BOGSTAVER}}` eller `YGG_PAYLOAD_EOF`.
- Echo-linjer i install-scriptet: **ASCII** (æøå → ae/oe/aa).
- **`user_id`-filteret ligger i `hentNote` / `hentNoter` / `gemNote` / `gemBulk` selv** —
  aldrig i kaldstederne. Admin er ingen undtagelse. Resten af adgangsmodellen:
  `docs/regler/adgang.md`.

## Arbejdsgang

- **Bump aldrig `APP_VERSION` undervejs.** Kun ved udgivelse, efter Andreas har sagt ja.
- **Commit og push kræver et udtrykkeligt ja.** Et push er en udgivelse.
- **To versionstal, ikke ét** (F28). `APP_VERSION` i `app/parts/p1_core.js` er *koden*
  og bumpes ved hver udgivelse. `RUNE_VERSION` i `build_rune.py` er *runen* og bumpes
  **kun**, når YAML'en selv ændrer sig — variabler, `startup`, porte, watchers, wipe.
  Bumper man den alligevel hver gang, er Andreas tilbage ved panelets to trin, og hele
  pointen med at serveren henter sin egen kode er tabt.
- **En udgivelse er tre trin:** commit → `git tag v<N>` → `git push --tags`.
  Taggen er det, `kilde.js` leder efter; uden den sker der ingenting ved en genstart.
  Runen skal kun *også* udgives i panelet, når `RUNE_VERSION` er flyttet.
- Efter hver ændring: byg, test, opsummer — og vent.
- **Rapportér den målte payload-størrelse efter hver `build_rune.py`.** Den er ikke
  længere et loft, men tallet er målet på, hvor stor appen er blevet.
  `HENT_FRA_GITHUB = False` giver den indlejrede rune tilbage; den er den eneste,
  der virker uden net ved installationen.
- Ny generel lærdom → `RUNE-ERFARINGER.md`. Projekt-specifik → `docs/regler/`.

## Lokal kørsel

```sh
BIND_PORT=8913 DATA_DIR=/tmp/sagudata SAGU_DEV=1 node app/server.js
python3 build_rune.py
node --test tests/*.test.mjs
```

Dev-serveren hedder `sagu` i den **globale** `~/.claude/launch.json` (port **8913** —
8910 er dodas, 8911 tovos, 8912 er optaget). `SAGU_DEV=1` slår `immutable`-cachen fra.
Kør altid tests med `BIND_PORT=0`. **Isolations-, delings- og rundturstesten køres i
hver fase** — se `docs/regler/test.md`.

## Projektregler pr. område

| Fil | Læs den når |
|---|---|
| `docs/regler/adgang.md` | Du rører adgang, deling, ejerskab, udgivelse, wiki-ruter, nøgler eller OAuth. |
| `docs/regler/flade.md` | Du rører editoren, navigationen, markeringer, genveje eller en knap. |
| `docs/regler/offline.md` | Du rører service workeren, cachen eller offline-køen. |
| `docs/regler/indhold.md` | Du rører markdown, kommentarer, doda-broen, capture-API'et eller guiden. |
| `docs/regler/github-og-import.md` | Du rører GitHub-integrationen, wiki-cachen, søgningen eller Notion-importen. |
| `docs/regler/faldgruber.md` | Før en større ændring — fælder, der allerede har kostet tid i de andre runer. |
| `docs/regler/test.md` | Du skriver eller kører tests. |
