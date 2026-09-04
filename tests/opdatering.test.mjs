/* »Opdater Sagu«-knappen, koert som den UDGIVES.
 *
 * ── Hvorfor den her fil findes ────────────────────────────────────────────
 *
 * 2026-09-04 gik Sagu ned i ti timer. Andreas trykkede paa knappen to gange
 * med otte sekunders mellemrum, og scriptet, de to koersler delte, gjorde tre
 * ting forkert paa tre linjer: fast temp-sti i `/tmp`, `rm -rf app` FOER
 * byttet, og et `mv` over to filsystemer, som er en kopi og kan afbrydes.
 *
 * `kilde.js` var bygget udenom praecis de tre (DESIGN.md §35) - og de stod
 * stadig i det script, knappen faktisk koerte. Prøverne her er de vagter, der
 * manglede.
 *
 * Alt koeres mod en lokal arkivserver, saa de kan koere uden net. Scriptet
 * hives ud af `runes/sagu.yaml` med PyYAML, saa det er panelets eget script,
 * der proeves - ikke en afskrift (RUNE-ERFARINGER, Tilmeld).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------ hjaelpere */

function udgivet(navn) {
  const res = spawnSync('python3', ['-c',
    `import sys,yaml;print(yaml.safe_load(open(sys.argv[1]))["gameskill"]["${navn}"]`
    + `["script" if "${navn}" != "startup" else "command"],end="")`,
    path.join(ROD, 'runes', 'sagu.yaml')], { encoding: 'utf8' });
  assert.equal(res.status, 0, `kunne ikke laese YAML'en: ${res.stderr}`);
  return res.stdout;
}

/** Kun redningen og laas-oprydningen fra startup - resten ville starte en server. */
function startupIndledning() {
  const cmd = udgivet('startup');
  const skaering = cmd.indexOf('node app/kilde.js');
  assert.ok(skaering > 0, 'startup koerer ikke kilde.js laengere - ret prøven');
  return cmd.slice(0, skaering);
}

function medLokalAdresse(script, url) {
  const KILDE = /const U="https:\/\/codeload\.github\.com\/[^"]+";/;
  assert.match(script, KILDE, 'scriptet henter ikke fra codeload laengere - ret prøven');
  assert.ok(script.includes('require("https")'), 'scriptet bruger ikke https laengere');
  return script.replace(KILDE, `const U="${url}";`).replace('require("https")', 'require("http")');
}

/** Et arkiv formet som codeloads: praefiks-mappe og pax_global_header foerst. */
function byggArkiv(dir, { medKilde = true } = {}) {
  const scene = path.join(dir, 'scene');
  const rod = path.join(scene, 'sagu-9');
  mkdirSync(path.join(rod, 'app', 'public'), { recursive: true });
  writeFileSync(path.join(rod, 'app', 'server.js'), '// ny server\n');
  writeFileSync(path.join(rod, 'app', 'public', 'index.html'), '<script src="/app.js?v=9">\n');
  writeFileSync(path.join(rod, 'app', 'ny-fil.js'), '// kom til i den nye version\n');
  if (medKilde) writeFileSync(path.join(rod, 'app', 'kilde.js'), '// kilde\n');
  writeFileSync(path.join(scene, 'pax_global_header'), '52 comment=0000000000000000\n');
  const tgz = path.join(dir, 'arkiv.tar.gz');
  execFileSync('tar', ['-czf', tgz, '-C', scene, 'pax_global_header', 'sagu-9']);
  return tgz;
}

/** Arkivserver med valgfri forsinkelse, saa to koersler kan naa at overlappe. */
async function arkivServer(tgz, { forsink = 0, status = 200 } = {}) {
  const s = createServer(async (req, res) => {
    if (forsink) await new Promise((ok) => setTimeout(ok, forsink));
    if (status !== 200) { res.writeHead(status); res.end('nej'); return; }
    res.writeHead(200, { 'content-type': 'application/gzip' });
    res.end(readFileSync(tgz));
  });
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${s.address().port}/a.tar.gz`, luk: () => s.close() };
}

function koer(sti, cwd) {
  return new Promise((ok) => {
    const p = spawn('sh', [sti], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let ud = ''; let fejl = '';
    p.stdout.on('data', (d) => { ud += d; });
    p.stderr.on('data', (d) => { fejl += d; });
    p.on('close', (kode) => ok({ kode, ud, fejl }));
  });
}

/** En datamappe med en GAMMEL app uden kilde.js - saa else-grenen bruges. */
function scene(navn) {
  const dir = mkdtempSync(path.join(tmpdir(), `sagu-${navn}-`));
  const data = path.join(dir, 'data');
  mkdirSync(path.join(data, 'app', 'public'), { recursive: true });
  writeFileSync(path.join(data, 'app', 'server.js'), '// gammel server\n');
  writeFileSync(path.join(data, 'app', 'foraeldet.js'), '// findes ikke i den nye\n');
  writeFileSync(path.join(data, 'sagu.db'), 'DATA MAA IKKE ROERES');
  return { dir, data, ryd: () => rmSync(dir, { recursive: true, force: true }) };
}

const skriv = (dir, script) => {
  const sti = path.join(dir, 'update.sh');
  writeFileSync(sti, script);
  return sti;
};

/* ====================================================== laasen ========= */

test('to samtidige tryk paa knappen: den ene arbejder, den anden faar besked', async (t) => {
  /*
   * DEN fejl, filen findes for. Uden laasen delte de to koersler
   * arbejdsmappe: den ene kunne rydde, mens den anden pakkede ud - og
   * resultatet var en app/, der hverken var den gamle eller den nye.
   *
   * Serveren forsinkes, saa den anden koersel med sikkerhed starter, mens den
   * foerste stadig holder laasen. Uden forsinkelsen ville prøven bestaa ved et
   * tilfaelde, naar hentningen var hurtig nok.
   */
  const s = scene('laas');
  t.after(() => s.ryd());
  const srv = await arkivServer(byggArkiv(s.dir), { forsink: 600 });
  t.after(() => srv.luk());

  const sti = skriv(s.dir, medLokalAdresse(udgivet('update'), srv.url));
  const [a, b] = await Promise.all([koer(sti, s.data), koer(sti, s.data)]);

  const alle = [a, b];
  const afvist = alle.filter((r) => /allerede i gang/.test(r.ud));
  const lykkedes = alle.filter((r) => r.kode === 0);
  assert.equal(afvist.length, 1, `praecis én skal afvises\nA:${a.ud}\nB:${b.ud}`);
  assert.equal(lykkedes.length, 1, 'og praecis én skal komme igennem');
  assert.equal(afvist[0].kode, 1, 'den afviste skal faelde, ikke lade som om');

  // ... og appen skal vaere HEL bagefter - ikke en blanding af de to.
  assert.equal(readFileSync(path.join(s.data, 'app', 'server.js'), 'utf8'), '// ny server\n');
  assert.ok(existsSync(path.join(s.data, 'app', 'ny-fil.js')), 'den nye fil mangler');
  assert.ok(!existsSync(path.join(s.data, 'app', 'foraeldet.js')),
    'den foraeldede fil blev liggende');
  assert.equal(readFileSync(path.join(s.data, 'sagu.db'), 'utf8'), 'DATA MAA IKKE ROERES');
});

test('laasen frigives, ogsaa naar hentningen faelder', async (t) => {
  /*
   * En laas, der bliver liggende efter en fejl, goer knappen doed for altid -
   * og en fejlet hentning er den ALMINDELIGE fejl (nettet blinker, taggen
   * mangler). Derfor `trap`, og derfor denne prøve: den anden koersel skal
   * kunne komme igennem bagefter.
   */
  const s = scene('trap');
  t.after(() => s.ryd());
  const daarlig = await arkivServer(null, { status: 500 });
  const sti = skriv(s.dir, medLokalAdresse(udgivet('update'), daarlig.url));
  const foerste = await koer(sti, s.data);
  daarlig.luk();
  assert.notEqual(foerste.kode, 0, 'en 500 skal faelde opdateringen');
  assert.ok(!existsSync(path.join(s.data, '.sagu-laas')), 'laasen blev liggende efter fejlen');

  const god = await arkivServer(byggArkiv(s.dir));
  t.after(() => god.luk());
  const anden = await koer(skriv(s.dir, medLokalAdresse(udgivet('update'), god.url)), s.data);
  assert.equal(anden.kode, 0, `anden koersel kom ikke igennem:\n${anden.ud}${anden.fejl}`);
  assert.equal(readFileSync(path.join(s.data, 'app', 'server.js'), 'utf8'), '// ny server\n');
});

test('en strandet laas rydder opstarten - ellers er knappen doed for altid', async (t) => {
  /* `trap` naar ikke at koere, hvis containeren draebes haardt. En container,
     der STARTER, er den bedste lejlighed til at rydde op. */
  const s = scene('strandet');
  t.after(() => s.ryd());
  mkdirSync(path.join(s.data, '.sagu-laas'));
  mkdirSync(path.join(s.data, '.sagu-ny'));

  const r = await koer(skriv(s.dir, startupIndledning()), s.data);
  assert.equal(r.kode, 0);
  assert.match(r.ud, /strandet opdateringslaas/);
  assert.ok(!existsSync(path.join(s.data, '.sagu-laas')), 'laasen staar der endnu');
  assert.ok(!existsSync(path.join(s.data, '.sagu-ny')), 'halvfaerdig udpakning staar der endnu');
});

/* ============================== byttet, og vejen tilbage ================ */

test('doeden mellem de to omdoebninger koster ikke app/', async (t) => {
  /*
   * Den eneste rigtigt farlige brik. Uden redningen ville et daarligt sekund
   * efterlade en container UDEN app/ - og uden app/ er der heller ingen
   * kilde.js til at hente en ny.
   */
  const s = scene('redning');
  t.after(() => s.ryd());
  // Praecis tilstanden midt imellem: app/ er vaek, den gamle ligger til side.
  execFileSync('mv', [path.join(s.data, 'app'), path.join(s.data, '.sagu-gammel')]);
  assert.ok(!existsSync(path.join(s.data, 'app')));

  const r = await koer(skriv(s.dir, startupIndledning()), s.data);
  assert.equal(r.kode, 0);
  assert.match(r.ud, /sat tilbage efter en afbrudt udskiftning/);
  assert.equal(readFileSync(path.join(s.data, 'app', 'server.js'), 'utf8'), '// gammel server\n');
  assert.ok(!existsSync(path.join(s.data, '.sagu-gammel')), 'resten skal vaere ryddet');
});

test('en LYKKET udskiftning rulles ikke tilbage af redningen', async (t) => {
  /* Redningen maa kun fyre, naar app/ mangler. Fyrede den paa rester alene,
     ville hver opstart kunne skifte tilbage til den forrige udgave. */
  const s = scene('ikke-rul');
  t.after(() => s.ryd());
  cpSync(path.join(s.data, 'app'), path.join(s.data, '.sagu-gammel'), { recursive: true });
  writeFileSync(path.join(s.data, 'app', 'server.js'), '// NY server\n');

  const r = await koer(skriv(s.dir, startupIndledning()), s.data);
  assert.equal(r.kode, 0);
  assert.equal(readFileSync(path.join(s.data, 'app', 'server.js'), 'utf8'), '// NY server\n',
    'redningen rullede en lykket udskiftning tilbage');
});

test('intet efterlades i datamappen efter en opdatering', async (t) => {
  const s = scene('rent');
  t.after(() => s.ryd());
  const srv = await arkivServer(byggArkiv(s.dir));
  t.after(() => srv.luk());
  const r = await koer(skriv(s.dir, medLokalAdresse(udgivet('update'), srv.url)), s.data);
  assert.equal(r.kode, 0, r.ud + r.fejl);
  assert.deepEqual(readdirSync(s.data).sort(), ['app', 'sagu.db'],
    'der ligger .sagu-arbejdsmapper tilbage');
});

/* ============================== formregler paa scriptet ================= */

test('der pakkes ALDRIG ud i /tmp - et mv derfra er en kopi', () => {
  /*
   * `mv` mellem to filsystemer er en kopi, og en kopi kan afbrydes paa
   * midten; to `rename` inden for samme filsystem kan ikke. Reglen er den
   * samme, kilde.js er bygget paa - og den stod IKKE i scriptet, foer v48.
   */
  for (const navn of ['install', 'update']) {
    const s = udgivet(navn);
    assert.ok(!s.includes('/tmp/'), `${navn}-scriptet bruger stadig /tmp`);
    assert.ok(s.includes('mv "$NY" app'), `${navn}-scriptet bytter ikke ind med et rename`);
    assert.ok(s.includes('mv app .sagu-gammel'),
      `${navn}-scriptet flytter ikke den gamle app vaek`);
  }
});

test('laasen tages FOER begge grene', () => {
  /* Laa den inde i else-grenen, ville to samtidige kilde.js - den
     ALMINDELIGE vej fra v47 og frem - vaere helt ubeskyttede. */
  const s = udgivet('update');
  // `indexOf` giver -1, naar strengen ikke findes - og -1 er mindre end alt.
  // Uden de to linjer her ville prøven bestaa, netop naar laasen var VAEK.
  const laas = s.indexOf('mkdir .sagu-laas');
  const gren = s.indexOf('if [ -f app/kilde.js ]');
  assert.ok(laas > -1, 'der tages ingen laas med mkdir');
  assert.ok(gren > -1, 'forgreningen findes ikke - ret prøven');
  assert.ok(laas < gren, 'laasen tages ikke foer forgreningen');
  assert.match(s, /trap '[^']*\.sagu-laas/, 'laasen frigives ikke ved fejl');
});

test('»genstart nu« er det SIDSTE, der staar', async (t) => {
  /*
   * Panelets app-update svarer 202 og genstarter ikke selv - maalt i panelets
   * egen log 2026-09-04: to app-update kl. 12:30, og foerst en restart ti
   * timer senere. Indtil da koerte den gamle proces oven paa nye filer.
   * Beskeden er den eneste vagt, der findes mod det, saa den skal staa sidst.
   */
  const s = scene('besked');
  t.after(() => s.ryd());
  const srv = await arkivServer(byggArkiv(s.dir));
  t.after(() => srv.luk());
  const r = await koer(skriv(s.dir, medLokalAdresse(udgivet('update'), srv.url)), s.data);
  assert.equal(r.kode, 0, r.ud + r.fejl);

  const linjer = r.ud.trimEnd().split('\n');
  const sidste = linjer.slice(-5).join('\n');
  assert.match(sidste, /GENSTART SAGU NU/, `beskeden staar ikke sidst:\n${r.ud}`);
  assert.match(sidste, /gamle kode/, 'beskeden siger ikke HVORFOR');
});
