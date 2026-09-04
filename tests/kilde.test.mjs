/* F28 - Sagu henter sin egen kode. Koer: node --test tests/kilde.test.mjs
 *
 * Det, der kan gaa galt her, er ikke hentningen - det er REGLERNE omkring den,
 * og de er alle sammen af den slags, der ikke fejler hoejlydt:
 *
 *  - »seneste« maa ikke kunne blive til en tilfaeldig tag. GitHub sorterer
 *    tags ALFABETISK, og alfabetisk er v9 nyere end v80.
 *  - En laas maa ikke kunne tolkes vaek. Skriver man »v46«, skal Sagu sige fra
 *    - ikke gaette paa 46 og heller ikke stille og roligt hente den nyeste.
 *  - Der maa ikke byttes til noget, der ikke er en hel Sagu, eller til kode,
 *    der ikke er den, taggen lover.
 *  - Og runen selv skal kunne installeres FORFRA. Det er den eneste af
 *    fejlene, der ikke rammer Andreas, men den naeste, der installerer.
 *
 * Hentningen selv (https, gunzip, tar) proeves IKKE her: den kraever GitHub.
 * Det er et bevidst hul - og derfor er alt det, der KAN proeves uden net,
 * skilt ud i rene funktioner. Selve turen over nettet er daekket af
 * install.test.mjs, som henter fra det rigtige codeload.
 */

import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const require = createRequire(import.meta.url);
const K = require('../app/kilde.js');
const ROD = join(dirname(fileURLToPath(import.meta.url)), '..');

/* --------------------------------------------------------- KODE_VERSION */

/* Tom er STANDARDEN - ikke bare en tilladt vaerdi. Kunne den tomme streng ikke
   laeses som »nyeste«, ville et nyinstalleret panel-felt betyde »ingen
   udgave«, og hver genstart ville enten fejle eller staa stille. */
test('tom, seneste og latest betyder alle det samme', () => {
  for (const v of ['', '   ', 'seneste', 'latest', 'Seneste', 'LATEST']) {
    const o = K.oensket(v);
    assert.equal(o.laast, false, `»${v}« skulle ikke laase`);
    assert.equal(o.tekst, 'seneste');
    assert.equal(o.fejl, undefined);
  }
});

test('et tal laaser til praecis den udgave', () => {
  const o = K.oensket('46');
  assert.equal(o.laast, true);
  assert.equal(o.version, 46);
  assert.equal(o.tekst, '46');
});

test('noget, der LIGNER et tal, laaser IKKE - det siger fra', () => {
  /* »v46« er det, man skriver, naar man taenker paa taggen. Blev det tolket
     som 46, ville Sagu gaette; blev det tolket som »seneste« i stilhed, ville
     laasen forsvinde, uden at nogen fik det at vide. */
  for (const v of ['v46', '46.2', 'nyeste', '-1', '4 6']) {
    const o = K.oensket(v);
    assert.equal(o.laast, false, `»${v}« maa ikke laase`);
    assert.equal(o.tekst, 'seneste');
    assert.ok(o.fejl, `»${v}« skal give en forklaring`);
    assert.match(o.fejl, /KODE_VERSION/);
  }
  // ... men mellemrum omkring et rent tal er skrivefejl, ikke en anden vaerdi.
  assert.equal(K.oensket(' 46 ').laast, true);
});

/* ------------------------------------------------------------ nyeste tag */

/** En hentJson, der svarer med faste sider i stedet for at ringe til GitHub. */
const faestet = (sider) => async (url) => {
  const m = /[?&]page=(\d+)/.exec(url);
  return sider[Number(m[1]) - 1] || [];
};

test('det HOEJESTE vN vinder - ikke det foerste, GitHub naevner', async () => {
  /* Praecis den raekkefoelge, en alfabetisk sortering giver. Tog vi bare
     liste[0], ville v9 blive til »nyeste«, og hver server ville rulle 37
     udgaver tilbage ved naeste genstart. */
  const svar = [[{ name: 'v9' }, { name: 'v46' }, { name: 'v8' }, { name: 'v40' }]];
  assert.equal(await K.nyesteTag(faestet(svar)), 46);
});

test('der bladres, indtil en side ikke er fuld', async () => {
  const side1 = Array.from({ length: 100 }, (_, i) => ({ name: `v${i + 1}` }));
  const side2 = [{ name: 'v101' }, { name: 'v102' }];
  assert.equal(await K.nyesteTag(faestet([side1, side2])), 102);
});

test('tags, der ikke er udgivelser, taeller ikke med', async () => {
  const svar = [[{ name: 'start' }, { name: 'v3' }, { name: 'v10-rc1' }, { name: 'V99' }]];
  assert.equal(await K.nyesteTag(faestet(svar)), 3);
});

test('en tagliste helt uden vN er en fejl, ikke et nul', async () => {
  await assert.rejects(() => K.nyesteTag(faestet([[{ name: 'start' }]])), /ingen vN-tag/);
});

/* ------------------------------------------------------- tjek foer bytte */

const FILER = {
  'server.js': '// sagu\n',
  'public/app.js': '// app\n',
  'shared/markdown.js': '// markdown\n',
  'shared/soeg.js': '// soeg\n',
};

function traeMed(version, { udelad = [], stempel = true } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'sagu-kilde-'));
  const alle = {
    ...FILER,
    'public/index.html': stempel
      ? `<link rel="stylesheet" href="/style.css?v=${version}">\n`
        + `<script src="/app.js?v=${version}"></script>\n`
      : '<script src="/app.js"></script>\n',
  };
  for (const [navn, indhold] of Object.entries(alle)) {
    if (udelad.includes(navn)) continue;
    mkdirSync(join(d, dirname(navn)), { recursive: true });
    writeFileSync(join(d, navn), indhold);
  }
  return d;
}

const medTrae = (lav, brug) => {
  const d = lav();
  try { brug(d); } finally { rmSync(d, { recursive: true, force: true }); }
};

test('et helt trae med det rigtige stempel godtages', () => {
  medTrae(() => traeMed(47), (d) => K.tjekTrae(d, 47));
});

test('en halv hentning byttes ikke ind', () => {
  /* `shared/` er den farlige: uden den STARTER serveren, og faelder foerst,
     naar nogen soeger eller gemmer. En server, der starter forkert, ligner en
     server, der virker. */
  for (const mangler of Object.keys(FILER).concat('public/index.html')) {
    medTrae(() => traeMed(47, { udelad: [mangler] }), (d) => {
      assert.throws(() => K.tjekTrae(d, 47), new RegExp(mangler.replace('/', '\\/')));
    });
  }
});

test('en tag, der indeholder en ANDEN version, afvises', () => {
  /* Det sker, naar en tag er flyttet oven paa en anden commit. Koden ville
     koere - men ingen kunne navngive den, og tallet i panelet ville lyve. */
  medTrae(() => traeMed(44), (d) => {
    assert.throws(() => K.tjekTrae(d, 47), /v47 indeholder kode stemplet v44/);
  });
});

test('en index.html helt uden stempel afvises', () => {
  medTrae(() => traeMed(47, { stempel: false }), (d) => {
    assert.throws(() => K.tjekTrae(d, 47), /intet versionsstempel/);
  });
});

/* ----------------------------------------------------- hvad ligger der nu */

test('maerket laeses, naar det findes', () => {
  medTrae(() => traeMed(47), (d) => {
    writeFileSync(join(d, '.kode-version'), JSON.stringify({
      version: 44, oensket: '44', hentet: '2026-09-03T10:00:00.000Z', kilde: 'github',
    }));
    const m = K.installeret(d);
    assert.equal(m.version, 44, 'maerket vinder over index.html');
    assert.equal(m.kilde, 'github');
  });
});

test('uden maerke staar tallet i index.html', () => {
  /* Den vej gaelder for hver eneste Sagu, der er installeret foer v47: runens
     install-script skriver ikke noget maerke. Uden dette fallback ville
     foerste genstart hente koden igen, ogsaa naar den allerede var den rette. */
  medTrae(() => traeMed(46), (d) => {
    const m = K.installeret(d);
    assert.equal(m.version, 46);
    assert.equal(m.kilde, 'install');
  });
});

test('en tom mappe kan ikke navngive sig selv - og det er ikke et nul', () => {
  /* `null` betyder »jeg ved det ikke« og foerer til en hentning. Blev det til
     0, ville sammenligningen med maalet stadig virke - men et maerke med
     version 0 ville se ud som en kendsgerning. */
  const d = mkdtempSync(join(tmpdir(), 'sagu-tom-'));
  try { assert.equal(K.installeret(d), null); } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('den rigtige app/ kan navngive sig selv', () => {
  const m = K.installeret(join(ROD, 'app'));
  assert.ok(m && Number.isInteger(m.version), 'app/ skulle kunne laeses');
});

/* ============================ runen som STARTSNOR ======================= */

/*
 * Invarianten »N steder, samme tal« gjaldt, saa laenge runen og appen fulgtes
 * ad. Det goer de ikke laengere - men reglen skal SKIFTES UD, ikke slettes,
 * for de tre nye maader at komme galt af sted paa rammer alle sammen en, der
 * installerer forfra, og ikke nogen, der allerede koerer.
 */

const build = readFileSync(join(ROD, 'build_rune.py'), 'utf8');
const yamlTekst = readFileSync(join(ROD, 'runes', 'sagu.yaml'), 'utf8');
const runeVersion = Number(build.match(/^RUNE_VERSION = (\d+)$/m)[1]);

test('runens version er DEN, alle dens tags peger paa', () => {
  /* Peger install-scriptet paa en anden tag end runens egen version, kan
     runen ikke installeres foerste gang - og det viser sig foerst hos en, der
     installerer forfra. Alle forekomster tjekkes, ikke den foerste: update
     har sin egen. */
  const iYaml = Number(yamlTekst.match(/^\s*version: (\d+)$/m)[1]);
  assert.equal(iYaml, runeVersion, 'YAML er bygget fra en anden RUNE_VERSION');

  const tags = [...yamlTekst.matchAll(/refs\/tags\/v(\d+)/g)].map((m) => Number(m[1]));
  assert.ok(tags.length >= 1, 'runen henter ikke fra en tag laengere - ret testen');
  for (const t of tags) assert.equal(t, runeVersion, `runen peger paa v${t}`);
});

test('startsnoren er en udgave, der KAN hente sin egen kode', () => {
  /* Peger runen paa en udgave fra foer kilde.js, henter en frisk installation
     kode uden kilde.js - og saa opdaterer en genstart aldrig mere. Serveren
     ville koere; den ville bare staa stille for altid. */
  assert.ok(runeVersion >= K.FOERSTE_SELVHENTENDE,
    `runen peger paa v${runeVersion}, men kilde.js kom foerst i `
    + `v${K.FOERSTE_SELVHENTENDE}`);
});

test('opstarten redder app/ FOER den henter, og henter FOER den starter', () => {
  /* Raekkefoelgen er hele sikkerheden. Redningen skal ligge foerst, fordi en
     afbrudt udskiftning ellers efterlader en container uden app/ - og dermed
     uden kilde.js til at hente en ny. */
  const cmd = yamlTekst.slice(yamlTekst.indexOf('startup:'));
  const redning = cmd.indexOf('.sagu-gammel');
  const hentning = cmd.indexOf('node app/kilde.js');
  const server = cmd.indexOf('exec node app/server.js');
  assert.ok(redning > -1, 'redningen mangler i startup');
  assert.ok(redning < hentning, 'redningen skal ligge foer hentningen');
  assert.ok(hentning < server, 'hentningen skal ligge foer serveren');

  /* Og hentningen maa ikke kunne vaelte opstarten. Uden `||` ville en
     netvaerksfejl paa Hjorten slukke for arkivet. */
  assert.match(cmd, /node app\/kilde\.js \|\|/);
});

test('»Opdater Sagu« bruger kilde.js, naar den findes', () => {
  /* Ellers henter knappen startsnorens tag oven paa en nyere app - en
     nedgradering, ingen bad om. */
  const s = yamlTekst.slice(yamlTekst.indexOf('update:'), yamlTekst.indexOf('startup:'));
  const gren = s.indexOf('if [ -f app/kilde.js ]');
  const snor = s.indexOf('refs/tags/v');
  assert.ok(gren > -1, 'update-scriptet kender ikke kilde.js');
  assert.ok(gren < snor, 'startsnoren skal ligge i ELSE-grenen, ikke foerst');
});

test('KODE_VERSION kan staa TOM i panelet', () => {
  /* Uden `?` i moensteret kan standarden ikke gemmes, og saa skal feltet
     udfyldes for at Sagu goer det almindelige. */
  const linje = yamlTekst.match(/key: KODE_VERSION[\s\S]{0,400}/)[0];
  const moenster = linje.match(/pattern: (\S+)/)[1].replace(/^'|'$/g, '');
  for (const god of ['', '46', 'seneste', 'latest']) {
    assert.match(god, new RegExp(moenster), `panelet ville afvise »${god}«`);
  }
  for (const daarlig of ['v46', '46.1', 'nyeste']) {
    assert.doesNotMatch(daarlig, new RegExp(moenster), `panelet ville godtage »${daarlig}«`);
  }
});
