/* Install-scriptet, koert som det UDGIVES.
 *
 * Fra og med 2026-08-21 baerer runen ikke app-koden: install-scriptet HENTER
 * den fra GitHub (DESIGN.md maaling 1). Det flytter risikoen fra "er der plads"
 * til "virker hentningen", og den nye risiko er kun daekket, hvis scriptet
 * bliver KOERT - ikke laest.
 *
 * Derfor:
 *
 *  - Scriptet hives ud af `runes/sagu.yaml` med PyYAML, saa testen koerer
 *    praecis det, panelet koerer - ikke en afskrift, der kan komme ud af trit
 *    (RUNE-ERFARINGER, Tilmeld).
 *  - Kun TO ting byttes ud, og hver udskiftning har en assertion foran, saa en
 *    tavs no-op ikke kan lade testen "bestaa" (RUNE-ERFARINGER, tovo):
 *      1. adressen -> en lokal server,
 *      2. require("https") -> require("http"), fordi den lokale server ikke
 *         har et certifikat. TLS'en selv bevises af den sidste test i filen,
 *         som henter over rigtig https fra codeload.
 *  - Fixturen er formet som et RIGTIGT GitHub-arkiv: en praefiks-mappe
 *    (`sagu-1/`) og en `pax_global_header`-post foerst. Begge dele er praecis
 *    det, scriptet med vilje ikke gaetter paa.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import {
  cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------ hjaelpere */

/** Det udgivne install-script, laest ud af YAML'en med PyYAML. */
function udgivetScript(navn = 'install') {
  const res = spawnSync('python3', ['-c',
    `import sys,yaml;print(yaml.safe_load(open(sys.argv[1]))["gameskill"]["${navn}"]["script"],end="")`,
    path.join(ROD, 'runes', 'sagu.yaml')], { encoding: 'utf8' });
  assert.equal(res.status, 0, `kunne ikke laese YAML'en: ${res.stderr}`);
  return res.stdout;
}

/** Bytter adressen og https->http ud, og faelder hvis et moenster ikke fandtes. */
function medLokalAdresse(script, url) {
  const KILDE = /const U="https:\/\/codeload\.github\.com\/[^"]+";/;
  assert.match(script, KILDE, 'scriptet henter ikke fra codeload laengere - ret testen');
  assert.ok(script.includes('require("https")'), 'scriptet bruger ikke https laengere');
  return script
    .replace(KILDE, `const U="${url}";`)
    .replace('require("https")', 'require("http")');
}

/**
 * Bygger et arkiv, der ser ud som codeloads: alt under en praefiks-mappe, og
 * en `pax_global_header`-post foerst (den er GitHubs, og en tar-implementation,
 * der skrev den som en almindelig FIL, ville give scriptet to kandidater at
 * vaelge imellem - derfor er den med i fixturen).
 */
function byggArkiv(dir, { medApp = true, praefiks = 'sagu-1' } = {}) {
  const scene = path.join(dir, 'scene');
  const rod = path.join(scene, praefiks);
  mkdirSync(rod, { recursive: true });
  if (medApp) cpSync(path.join(ROD, 'app'), path.join(rod, 'app'), { recursive: true });
  mkdirSync(path.join(rod, 'docs'), { recursive: true });
  writeFileSync(path.join(rod, 'docs', 'HANDOVER.md'), '# krav\n');
  writeFileSync(path.join(rod, 'README.md'), '# sagu\n');
  // pax_global_header som en rigtig post foerst i arkivet.
  writeFileSync(path.join(scene, 'pax_global_header'), '52 comment=0000000000000000\n');
  const tgz = path.join(dir, 'arkiv.tar.gz');
  execFileSync('tar', ['-czf', tgz, '-C', scene, 'pax_global_header', praefiks]);
  return tgz;
}

/** En lille server, der svarer med et arkiv - eller med en statuskode. */
async function server(svar) {
  const s = createServer((req, res) => svar(req, res));
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${s.address().port}/arkiv.tar.gz`, luk: () => s.close() };
}

/**
 * Koerer scriptet med `sh` i sin egen "datamappe".
 *
 * **Skal vaere asynkron.** `spawnSync` blokerer event-loopet, og arkivserveren
 * bor i SAMME proces som testen - saa scriptets hentning ville vente paa en
 * server, der aldrig naaede at svare. Testen laaste, uden at nogen
 * test-timeout kunne fyre, fordi loopet stod stille.
 */
function koer(script, cwd) {
  const sti = path.join(cwd, '..', 'script.sh');
  writeFileSync(sti, script);
  return new Promise((ok) => {
    const p = spawn('sh', [sti], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let ud = ''; let fejl = '';
    p.stdout.on('data', (d) => { ud += d; });
    p.stderr.on('data', (d) => { fejl += d; });
    p.on('close', (kode) => ok({ kode, ud, fejl }));
  });
}

function friskMappe(navn) {
  const dir = mkdtempSync(path.join(tmpdir(), `sagu-${navn}-`));
  const data = path.join(dir, 'data');
  mkdirSync(data);
  return { dir, data, ryd: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Alle filer under en mappe, relativt - til byte-sammenligning. */
function alleFiler(rod, praefiks = '') {
  const ud = [];
  for (const navn of readdirSync(path.join(rod, praefiks))) {
    const rel = path.join(praefiks, navn);
    if (statSync(path.join(rod, rel)).isDirectory()) ud.push(...alleFiler(rod, rel));
    else ud.push(rel);
  }
  return ud.sort();
}

/* ------------------------------------------------------------- testene */

test('install-scriptet henter, pakker ud og lander byte-identisk', async (t) => {
  const m = friskMappe('inst');
  t.after(() => m.ryd());
  const tgz = byggArkiv(m.dir);
  const s = await server((req, res) => { res.writeHead(200); res.end(readFileSync(tgz)); });
  t.after(() => s.luk());

  const r = await koer(medLokalAdresse(udgivetScript(), s.url), m.data);
  assert.equal(r.kode, 0, `scriptet fejlede:\n${r.fejl}`);
  assert.match(r.ud, /Filer udpakket:/);

  // Praefiks-mappen maa ikke blive liggende, og app/ skal staa i roden.
  assert.deepEqual(readdirSync(m.data), ['app']);

  const forventet = alleFiler(path.join(ROD, 'app'));
  assert.deepEqual(alleFiler(path.join(m.data, 'app')), forventet);
  for (const rel of forventet) {
    assert.deepEqual(readFileSync(path.join(m.data, 'app', rel)),
      readFileSync(path.join(ROD, 'app', rel)), `${rel} er ikke byte-identisk`);
  }
});

test('den hentede kopi er en server, der kan starte og svare', async (t) => {
  const m = friskMappe('start');
  t.after(() => m.ryd());
  const tgz = byggArkiv(m.dir);
  const s = await server((req, res) => { res.writeHead(200); res.end(readFileSync(tgz)); });
  t.after(() => s.luk());
  assert.equal((await koer(medLokalAdresse(udgivetScript(), s.url), m.data)).kode, 0);

  // Start PRAECIS den kopi, scriptet lagde - ikke kilden ved siden af.
  const proc = spawn('node', [path.join(m.data, 'app', 'server.js')], {
    env: { ...process.env, BIND_PORT: '0', DATA_DIR: m.data, SAGU_DEV: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => proc.kill('SIGTERM'));
  let ud = ''; let fejl = '';
  proc.stdout.on('data', (d) => { ud += d; });
  proc.stderr.on('data', (d) => { fejl += d; });
  const port = await new Promise((ok, nej) => {
    const frist = setTimeout(() => nej(new Error(`ingen startlinje:\n${ud}\n${fejl}`)), 10000);
    const kig = setInterval(() => {
      const t2 = ud.match(/sagu lytter paa port (\d+)/);
      if (t2) { clearInterval(kig); clearTimeout(frist); ok(Number(t2[1])); }
    }, 25);
  });
  const svar = await fetch(`http://127.0.0.1:${port}/api/public-config`);
  assert.equal(svar.status, 200);
});

test('en hentning oven paa en gammel version fjerner foraeldede filer - og roerer ikke data', async (t) => {
  const m = friskMappe('opdat');
  t.after(() => m.ryd());
  const tgz = byggArkiv(m.dir);
  const s = await server((req, res) => { res.writeHead(200); res.end(readFileSync(tgz)); });
  t.after(() => s.luk());

  // En mappe, der ligner en koerende container: gammel app + rigtige data.
  mkdirSync(path.join(m.data, 'app'), { recursive: true });
  writeFileSync(path.join(m.data, 'app', 'gammel-modul.js'), '// fra v0\n');
  writeFileSync(path.join(m.data, 'sagu.db'), 'lad som om');
  mkdirSync(path.join(m.data, 'files'));
  writeFileSync(path.join(m.data, 'files', 'abc123'), 'en vedhaeftning');

  const r = await koer(medLokalAdresse(udgivetScript('update'), s.url), m.data);
  assert.equal(r.kode, 0, `update fejlede:\n${r.fejl}`);
  assert.equal(statSync(path.join(m.data, 'app', 'server.js')).isFile(), true);
  assert.throws(() => statSync(path.join(m.data, 'app', 'gammel-modul.js')),
    'tar overskriver, men fjerner ikke - uden `rm -rf app` bliver en slettet fil liggende for evigt');
  assert.equal(readFileSync(path.join(m.data, 'sagu.db'), 'utf8'), 'lad som om');
  assert.equal(readFileSync(path.join(m.data, 'files', 'abc123'), 'utf8'), 'en vedhaeftning');
});

test('404 faelder installationen - og beskeden naevner BEGGE aarsager', async (t) => {
  const m = friskMappe('404');
  t.after(() => m.ryd());
  const s = await server((req, res) => { res.writeHead(404); res.end('Not Found'); });
  t.after(() => s.luk());

  const r = await koer(medLokalAdresse(udgivetScript(), s.url), m.data);
  assert.notEqual(r.kode, 0, 'en mislykket hentning skal faelde installationen');
  assert.match(r.fejl, /GitHub svarede 404/);
  // GitHub skelner ikke mellem "findes ikke" og "ingen adgang". Siger beskeden
  // kun det ene, fejlsoeger man et token, der er helt i orden (tools v1).
  assert.match(r.fejl, /ikke findes/);
  assert.match(r.fejl, /ikke er adgang/);
  assert.match(r.fejl, /taggen/);
  assert.throws(() => statSync(path.join(m.data, 'app')),
    'en fejlet hentning maa ikke efterlade et halvt app/');
});

test('et arkiv UDEN app/ faelder - i stedet for at installere ingenting', async (t) => {
  const m = friskMappe('tom');
  t.after(() => m.ryd());
  const tgz = byggArkiv(m.dir, { medApp: false });
  const s = await server((req, res) => { res.writeHead(200); res.end(readFileSync(tgz)); });
  t.after(() => s.luk());

  const r = await koer(medLokalAdresse(udgivetScript(), s.url), m.data);
  assert.notEqual(r.kode, 0);
  assert.match(r.ud + r.fejl, /ingen app\/server\.js/);
});

test('praefiks-mappens navn gaettes ikke', async (t) => {
  // GitHub navngiver mappen <repo>-<ref uden v>. Ville scriptet danne navnet
  // selv, ville et andet tagnavn braekke installationen tavst (Sagu F5).
  const m = friskMappe('praefiks');
  t.after(() => m.ryd());
  const tgz = byggArkiv(m.dir, { praefiks: 'sagu-noget-helt-andet-4.2.0' });
  const s = await server((req, res) => { res.writeHead(200); res.end(readFileSync(tgz)); });
  t.after(() => s.luk());

  const r = await koer(medLokalAdresse(udgivetScript(), s.url), m.data);
  assert.equal(r.kode, 0, `scriptet gaetter paa mappenavnet:\n${r.fejl}`);
  assert.equal(statSync(path.join(m.data, 'app', 'server.js')).isFile(), true);
});

/* ------------------------------------------ mod det RIGTIGE GitHub ----- */

/**
 * Alt ovenfor koerer mod en lokal server over http. Det, der IKKE bevises der,
 * er selve turen ud i verden: TLS, codeloads svar, GitHubs egen arkivform.
 *
 * Derfor én test mere mod en rigtig, offentlig adresse. `bogreolen` er valgt,
 * fordi den findes, er offentlig og selv er en rune med en `app/`-mappe -
 * altsaa samme form som Sagus eget arkiv vil have. Testen springes over uden
 * net.
 */
test('den rigtige codeload-adresse virker: https, gzip, praefiks og app/',
  { skip: process.env.SAGU_INGEN_NET ? 'net slaaet fra' : false }, async (t) => {
    const m = friskMappe('codeload');
    t.after(() => m.ryd());

    const script = udgivetScript().replace(
      /const U="https:\/\/codeload\.github\.com\/[^"]+";/,
      'const U="https://codeload.github.com/andreasdinesen/bogreolen/tar.gz/refs/heads/main";');
    assert.ok(script.includes('bogreolen'), 'udskiftningen ramte ikke');
    assert.ok(script.includes('require("https")'), 'denne test SKAL gaa over https');

    const r = await koer(script, m.data);
    if (r.kode !== 0 && /kunne ikke naa GitHub/.test(r.fejl)) {
      t.skip('ingen net-adgang');
      return;
    }
    assert.equal(r.kode, 0, `hentningen fra codeload fejlede:\n${r.fejl}`);
    assert.equal(statSync(path.join(m.data, 'app', 'server.js')).isFile(), true);
    assert.deepEqual(readdirSync(m.data), ['app'],
      'praefiks-mappen og pax-headeren skal vaere ryddet vaek');
  });

test('et privat repo svarer 404 paa codeload - ikke 403',
  { skip: process.env.SAGU_INGEN_NET ? 'net slaaet fra' : false }, async () => {
    // Grunden til at fejlbeskeden SKAL naevne begge aarsager. Maalt i F0,
    // bekraeftet her, saa paastanden ikke bare staar i et dokument.
    const svar = await fetch(
      'https://codeload.github.com/andreasdinesen/doda/tar.gz/refs/heads/main',
      { redirect: 'manual' }).catch(() => null);
    if (!svar) return;                       // uden net beviser testen intet
    assert.equal(svar.status, 404);
  });
