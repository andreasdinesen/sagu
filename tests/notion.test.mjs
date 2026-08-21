/*
 * F5 - Notion-importen. »Fasen, der afgør om Sagu bliver taget i brug.«
 *
 * To slags tests her:
 *
 *  1. **Formatet**, testet paa syntetiske arkiver. Det er dem, der koerer
 *     altid, og de daekker fælderne: `_all` vs. visningen, linkede visninger,
 *     dublet-titler, datoformater, doede links, zip-bomber.
 *  2. **En RIGTIG eksport**, hvis `SAGU_NOTION_EKSPORT` peger paa en. Den,
 *     der er maalt paa, er 234 MB, 558 filer, 278 sider, 12 databaser. Den
 *     springes over paa en maskine, der ikke har den - men naar den er der, er den det eneste, der beviser,
 *     at importen duer paa rigtige data (RUNE-ERFARINGER, MsGraphBud: »fejlen
 *     findes kun mod aegte data«).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, klient } from './hjaelp.mjs';

const require = createRequire(import.meta.url);
const ROD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const notion = require(path.join(ROD, 'app', 'shared', 'notion.js'));
const zipmod = require(path.join(ROD, 'app', 'zip.js'));

/* ================================================= formatet for sig ===== */

test('filnavnet deles i titel og Notion-id - ogsaa _all', () => {
  assert.deepEqual(notion.delNavn('Must-read 5be729197e9549938ffd0067656b6220.csv'),
    { titel: 'Must-read', id: '5be729197e9549938ffd0067656b6220', endelse: 'csv', alle: false });
  assert.deepEqual(notion.delNavn('Must-read 5be729197e9549938ffd0067656b6220_all.csv'),
    { titel: 'Must-read', id: '5be729197e9549938ffd0067656b6220', endelse: 'csv', alle: true });
  // En vedhaeftning har intet id.
  assert.equal(notion.delNavn('billede.png').id, null);
  assert.equal(notion.delNavn('billede.png').titel, 'billede');
});

test('DATOERNE - alle tre former, Notion faktisk skriver', () => {
  const som = (t) => new Date(t * 1000);
  const a = som(notion.tolkDato('March 23, 2023 2:03 AM'));
  assert.equal(a.getFullYear(), 2023);
  assert.equal(a.getMonth(), 2);
  assert.equal(a.getDate(), 23);
  assert.equal(a.getHours(), 2);

  assert.equal(som(notion.tolkDato('March 23, 2023 2:03 PM')).getHours(), 14);
  assert.equal(som(notion.tolkDato('March 23, 2023 12:30 AM')).getHours(), 0, 'midnat er 12 AM');
  assert.equal(som(notion.tolkDato('March 23, 2023 12:30 PM')).getHours(), 12, 'middag er 12 PM');

  // DANSK d/m/y. En amerikansk laesning ville goere 01/10 til 10. januar i
  // stedet for 1. oktober - og det er den slags, ingen opdager foer et aar
  // senere.
  const dk = som(notion.tolkDato('01/10/2020'));
  assert.equal(dk.getDate(), 1);
  assert.equal(dk.getMonth(), 9, '10 er OKTOBER, ikke januar');

  // Interval: begyndelsen er den, der betyder noget.
  assert.equal(notion.tolkDato('12/10/2020 → 23/10/2020'), notion.tolkDato('12/10/2020'));
  // Tidszone-halen skal ikke vaelte tolkningen.
  assert.ok(notion.tolkDato('October 25, 2023 1:00 PM (GMT+2)') > 0);
  assert.equal(notion.tolkDato(''), null);
  assert.equal(notion.tolkDato('i morgen'), null);
});

test('egenskabsblokken stopper ved den foerste TOMME linje', () => {
  const p = notion.laesSide([
    '# En titel', '',
    'Category: Bog',
    'Created: March 23, 2023 2:03 AM',
    'URL: https://dr.dk',
    '',
    'Broedteksten begynder her.',
    'URL: det her er IKKE en egenskab, for der var en tom linje foer.',
  ].join('\n'));
  assert.equal(p.titel, 'En titel');
  assert.deepEqual(p.props.map((x) => x.key), ['Category', 'Created', 'URL']);
  assert.equal(p.props[2].value, 'https://dr.dk');
  assert.match(p.krop, /^Broedteksten begynder her\./);
  assert.match(p.krop, /IKKE en egenskab/);
});

test('en side UDEN egenskaber taber ikke sin foerste linje', () => {
  const p = notion.laesSide('# Titel\n\nBare noget tekst uden kolon.');
  assert.deepEqual(p.props, []);
  assert.equal(p.krop, 'Bare noget tekst uden kolon.');
});

test('en overskrift lige under titlen er ikke en egenskab', () => {
  const p = notion.laesSide('# Titel\n\n## Underoverskrift: med kolon\n\ntekst');
  assert.deepEqual(p.props, []);
  assert.match(p.krop, /^## Underoverskrift/);
});

test('Tags deles paa komma', () => {
  assert.deepEqual(notion.tolkTags('hus, nilex'), ['hus', 'nilex']);
  assert.deepEqual(notion.tolkTags('Podcast'), ['Podcast']);
  assert.deepEqual(notion.tolkTags(''), []);
});

test('<aside> bliver en callout - ellers staar der literal HTML i noten', () => {
  const ud = notion.asideTilCallout('<aside>\n💡 Et godt raad\n\n</aside>');
  assert.match(ud, /^> \[!TIP\]/);
  assert.match(ud, /> 💡 Et godt raad/);
  assert.match(notion.asideTilCallout('<aside>\n⚠ Pas paa\n</aside>'), /^> \[!WARNING\]/);
  assert.match(notion.asideTilCallout('<aside>\nnoget\n</aside>'), /^> \[!NOTE\]/);
});

test('CSV: citerede felter, dobbelt-anfoerselstegn og komma i en vaerdi', () => {
  const r = notion.laesCsv('﻿Navn,Note\n"Hansen, Ib","han sagde ""hej"""\nx,y');
  assert.deepEqual(r[0], ['Navn', 'Note'], 'BOM skal vaek');
  assert.deepEqual(r[1], ['Hansen, Ib', 'han sagde "hej"']);
  assert.deepEqual(r[2], ['x', 'y']);
});

test('en LINKET VISNING kendes paa at der ikke findes en _all.csv', () => {
  // 12 aegte databaser i Andreas' eksport har alle en `_all`; de 7 linkede
  // visninger har ingen. Navnet »Untitled« er samstemmende, men ikke nok:
  // »Opgaveliste for Renovering« er en AEGTE database inde i en side.
  assert.equal(notion.erLinketVisning({ titel: 'Untitled', sti: 'Side/Untitled abc.csv' }), true);
  assert.equal(notion.erLinketVisning({ titel: 'Untitled', alleSti: 'Side/Untitled abc_all.csv' }), false);
  assert.equal(notion.erLinketVisning({ titel: 'Opgaveliste', alleSti: 'Side/Opgaveliste abc_all.csv' }), false);
});

test('_all er den AUTORITATIVE - den blotte CSV er kun en visning', () => {
  const s = notion.laesStruktur([
    'Rod/Must-read 5be729197e9549938ffd0067656b6220.csv',
    'Rod/Must-read 5be729197e9549938ffd0067656b6220_all.csv',
  ]);
  const d = [...s.databaser.values()][0];
  assert.ok(d.alleSti.endsWith('_all.csv'));
  assert.ok(!d.sti.endsWith('_all.csv'));
  assert.equal(d.titel, 'Must-read');
});

test('LINKS omskrives, og en doed henvisning bliver STAAENDE', () => {
  const md = [
    'Se [en side](Mappe/Anden%20side%20aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.md).',
    '![et billede](Mappe/foto.png)',
    'Og [noget der ikke findes](Mappe/Vaek%20bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.md).',
    'Og [udadtil](https://dr.dk).',
  ].join('\n');
  const ud = notion.omskrivLinks(md, 'Rod/Side.md', (sti) => {
    if (sti === 'Rod/Mappe/Anden side aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.md') return { slags: 'note', id: 'N1' };
    if (sti === 'Rod/Mappe/foto.png') return { slags: 'fil', id: 'F1' };
    return null;
  });
  assert.match(ud, /\[en side\]\(sagu-note:N1\)/);
  assert.match(ud, /!\[et billede\]\(sagu:F1\)/);
  assert.match(ud, /\[noget der ikke findes\]\(Mappe\/Vaek/, 'en doed henvisning er en kendsgerning om noten');
  assert.match(ud, /\[udadtil\]\(https:\/\/dr\.dk\)/, 'et eksternt link roeres ikke');
});

test('en relativ sti kan ikke pege UD af arkivet', () => {
  assert.equal(notion.opløs('Rod/Mappe/Side.md', '../../../../etc/passwd'), 'etc/passwd');
  assert.equal(notion.opløs('Rod/Side.md', 'Mappe/Fil.png'), 'Rod/Mappe/Fil.png');
});

/* ============================================ zip-laeseren for sig ====== */

test('zip-laeseren afviser noget, der ikke er en zip', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sagu-zip-'));
  const sti = path.join(dir, 'ikke-en.zip');
  writeFileSync(sti, 'bare tekst');
  assert.throws(() => zipmod.aabn(sti), /not a zip/i);
});

test('zip-laeseren har et loft paa ANTAL poster og paa udpakket stoerrelse', () => {
  // 64 MB zip, der pakkes ud til 66 GB, er en normal form paa et angreb
  // (Verdandes spec). Begge lofter skal findes - én kaempe fil og ti tusind
  // smaa er to angreb med samme slutning.
  assert.ok(zipmod.MAX_POSTER <= 50000, 'der skal vaere et loft paa antal poster');
  assert.ok(zipmod.MAX_UDPAKKET <= 8 * 1024 * 1024 * 1024, 'der skal vaere et loft paa udpakket stoerrelse');
  assert.ok(zipmod.MAX_POST <= 512 * 1024 * 1024, 'og et loft pr. post');
});

/* ======================================= hele turen, mod en server ====== */

/** Bygger et lille syntetisk Notion-arkiv og zipper det. */
/**
 * Bygger et arkiv af {sti: indhold}.
 *
 * VAGT: Notion-id'er er 32 tegn HEX. Skriver man `ggg…` i en fikstur, ser
 * parseren ingen sider overhovedet - og testen bestaar eller fejler af en
 * helt anden grund end den, den handler om. Det kostede tid én gang
 * (2026-08-21); nu raaber den op paa stedet.
 */
function byggArkiv(filer) {
  for (const sti of Object.keys(filer)) {
    const m = /\s([0-9a-zA-Z]{32})\.(md|csv)$/.exec(sti);
    if (m && !/^[0-9a-f]{32}$/.test(m[1])) {
      throw new Error(`fikstur-id er ikke hex: ${m[1]} i ${sti}`);
    }
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'sagu-notion-'));
  for (const [sti, indhold] of Object.entries(filer)) {
    const fuld = path.join(dir, sti);
    mkdirSync(path.dirname(fuld), { recursive: true });
    writeFileSync(fuld, indhold);
  }
  const zipSti = path.join(mkdtempSync(path.join(tmpdir(), 'sagu-zipud-')), 'eksport.zip');
  execFileSync('zip', ['-rq', zipSti, '.'], { cwd: dir });
  return zipSti;
}

async function importer(srv, kl, zipSti) {
  const { readFileSync } = await import('node:fs');
  const r = await fetch(`${srv.base}/api/v1/upload`, {
    method: 'POST',
    headers: { Cookie: kl.cookie, 'X-Sagu-Upload': '1', 'Content-Type': 'application/zip' },
    body: readFileSync(zipSti),
  });
  const up = await r.json();
  assert.equal(r.status, 200, `upload fejlede: ${JSON.stringify(up)}`);

  const forhaand = await kl.kald('POST', '/api/v1/import/preview', { uploadId: up.id });
  const start = await kl.kald('POST', '/api/v1/import', { uploadId: up.id });
  assert.equal(start.status, 200, `import startede ikke: ${JSON.stringify(start.data)}`);

  for (let i = 0; i < 600; i++) {
    const st = await kl.kald('GET', '/api/v1/import');
    if (!st.data.running) return { forhaand: forhaand.data, status: st.data };
    await new Promise((r2) => setTimeout(r2, 100));
  }
  throw new Error('importen blev aldrig faerdig');
}

let srv;
let a;

before(async () => {
  srv = await startServer();
  a = klient(srv.base);
  await a.opret('alice', 'kodeord-1234');
});

after(() => srv.stop());

test('et lille arkiv: database -> notesbog, raekker -> undersider', async () => {
  const zipSti = byggArkiv({
    'Eksport/Forside abc00000000000000000000000000001.md':
      '# Forside\n\nSe [Boeger](Forside%20abc00000000000000000000000000001/Boeger%20db000000000000000000000000000001.csv).',
    'Eksport/Forside abc00000000000000000000000000001/Boeger db000000000000000000000000000001.csv':
      'Titel,Status\nFactfulness,Laest\n',
    'Eksport/Forside abc00000000000000000000000000001/Boeger db000000000000000000000000000001_all.csv':
      'Titel,Status,Forfatter\nFactfulness,Laest,Rosling\nSapiens,Ikke laest,Harari\n',
    'Eksport/Forside abc00000000000000000000000000001/Boeger db000000000000000000000000000001/Factfulness ffa00000000000000000000000000001.md':
      '# Factfulness\n\nStatus: Laest\nForfatter: Rosling\nCreated: March 23, 2023 2:03 AM\nTags: bog, data\n\nEn god bog.\n\n![omslag](Factfulness/omslag.png)',
    'Eksport/Forside abc00000000000000000000000000001/Boeger db000000000000000000000000000001/Factfulness/omslag.png':
      Buffer.from('\x89PNG\r\n\x1a\nfake'),
    'Eksport/Forside abc00000000000000000000000000001/Boeger db000000000000000000000000000001/Sapiens ffa00000000000000000000000000002.md':
      '# Sapiens\n\nStatus: Ikke laest\n\nEn anden bog.',
  });

  const { forhaand, status } = await importer(srv, a, zipSti);
  assert.equal(forhaand.pages, 3, 'tre sider');
  assert.equal(forhaand.databases, 1, 'én database');
  assert.equal(forhaand.files, 1, 'ét billede');
  assert.equal(forhaand.newPages, 3);
  assert.equal(status.error, null, `importen fejlede: ${status.error}`);
  assert.equal(status.phase, 'done');

  const trae = (await a.kald('GET', '/api/v1/tree')).data;
  assert.ok(trae.notebooks.some((b) => b.name === 'Boeger'), 'databasen skal blive en NOTESBOG');

  // Raekkerne er undersider i den notesbog.
  const bog = trae.notebooks.find((b) => b.name === 'Boeger');
  const iBogen = trae.notes.filter((n) => n.notebookId === bog.id).map((n) => n.title).sort();
  assert.deepEqual(iBogen, ['Boeger', 'Factfulness', 'Sapiens'],
    'baade forsiden og de to raekker skal ligge i bogen');

  // Egenskaberne blev til note_props, og Tags til rigtige maerker.
  const fact = trae.notes.find((n) => n.title === 'Factfulness');
  const fuld = (await a.kald('GET', `/api/v1/notes/${fact.id}`)).data.note;
  assert.deepEqual(fuld.props.map((p) => p.key).sort(), ['Forfatter', 'Status']);
  assert.deepEqual(fuld.tags.sort(), ['bog', 'data'], 'Tags skal blive til rigtige maerker');
  // ... og Created blev til notens dato, ikke i dag.
  assert.equal(new Date(fuld.createdAt * 1000).getFullYear(), 2023,
    'uden datoerne er hele arkivet skrevet samme aften');

  // Billedet blev en vedhaeftning, og linket peger paa den.
  assert.match(fuld.body, /!\[omslag\]\(sagu:[a-f0-9]{32}\)/);
  const filId = fuld.body.match(/sagu:([a-f0-9]{32})/)[1];
  const hent = await fetch(`${srv.base}/api/v1/files/${filId}`, { headers: { Cookie: a.cookie } });
  assert.equal(hent.status, 200, 'billedet skal kunne hentes');

  // Databasens forside er en TABEL over raekkerne, bygget af _all (3 kolonner,
  // ikke visningens 2), og titlerne er links.
  const forside = (await a.kald('GET',
    `/api/v1/notes/${trae.notes.find((n) => n.title === 'Boeger').id}`)).data.note;
  assert.match(forside.body, /\| Titel \| Status \| Forfatter \|/,
    'forsiden skal bygges af _all, ikke af visningen');
  assert.match(forside.body, /\[Factfulness\]\(sagu-note:[a-f0-9]{32}\)/,
    'raekkens titel skal vaere et link til dens side');

  /*
   * ... og et link TIL databasen skal ogsaa vaere skrevet om.
   *
   * Forsiden pegede paa `Boeger <hex>.csv` som en filsti, fordi databasernes
   * forsider blev oprettet TIL SIDST - efter indholdet var skrevet. »Alle
   * noter tomme, saa alle id'er kendes« gjaldt kun siderne (Andreas,
   * 2026-08-21: »hvorfor laver den disse links uden at de virker?«).
   */
  const rod = (await a.kald('GET',
    `/api/v1/notes/${trae.notes.find((n) => n.title === 'Forside').id}`)).data.note;
  assert.match(rod.body, /\[Boeger\]\(sagu-note:[a-f0-9]{32}\)/,
    `linket til databasen skal pege paa dens forside: ${rod.body}`);
  assert.doesNotMatch(rod.body, /\.csv/, 'og ikke paa en filsti');
});

test('GENIMPORT af samme arkiv laver INGEN dubletter', async () => {
  // »Importen kan koeres igen uden at lave dubletter (matcher paa Notion-ID)«
  // (SAGU-PLAN F5). Titlen duer ikke som noegle - 12 titler er dubletter i
  // Andreas' rigtige eksport, én af dem seks gange.
  const zipSti = byggArkiv({
    'Eksport/Side aaa00000000000000000000000000001.md': '# En side\n\nCreated: March 1, 2023 9:00 AM\n\nfoerste udgave',
    'Eksport/Side aaa00000000000000000000000000002.md': '# En side\n\nCreated: March 2, 2023 9:00 AM\n\nogsaa "En side"',
  });

  const foer = (await a.kald('GET', '/api/v1/tree')).data.notes.length;
  const et = await importer(srv, a, zipSti);
  const efterFoerste = (await a.kald('GET', '/api/v1/tree')).data.notes.length;
  assert.equal(efterFoerste - foer, 2, 'to sider med SAMME titel skal begge oprettes');
  assert.equal(et.status.counts.pages, 2);

  const to = await importer(srv, a, zipSti);
  const efterAnden = (await a.kald('GET', '/api/v1/tree')).data.notes.length;
  assert.equal(efterAnden, efterFoerste, 'anden koersel maa ikke tilfoeje noget');
  assert.equal(to.status.counts.pages, 0, 'ingen nye');
  assert.equal(to.status.counts.updated, 2, 'to opdaterede');
  assert.equal(to.forhaand.newPages, 0, 'forhaandsvisningen skal SIGE det foerst');
  assert.equal(to.forhaand.existingPages, 2);
});

test('en GENIMPORT retter PLACERINGEN, ikke kun teksten', async () => {
  /*
   * Fundet af Andreas i drift, 2026-08-20.
   *
   * Hans arkiv var importeret FOER F5's mappe-rettelse, saa alle 290 sider laa
   * i opsamlingsbogen og hver databaseforside sagde »0 of them are pages you
   * can open«. Importen var idempotent paa TEKSTEN og kun paa den: en side,
   * appen allerede kendte, fik sin krop skrevet om, men blev liggende hvor den
   * laa. En rettelse i struktur-udledningen kunne altsaa aldrig komme et
   * eksisterende arkiv til gode - den eneste vej var at slette alt.
   *
   * Testen efterligner den tilstand ved at flytte raekkerne VAEK og se, om en
   * genimport henter dem tilbage.
   */
  const zipSti = byggArkiv({
    'Eksport/Vaerk eee00000000000000000000000000001.csv': 'Titel\nEt vaerk\n',
    'Eksport/Vaerk eee00000000000000000000000000001_all.csv': 'Titel\nEt vaerk\n',
    'Eksport/Vaerk/Et vaerk eee00000000000000000000000000002.md': '# Et vaerk\n\ntekst',
    'Eksport/Rod eee00000000000000000000000000003.md': '# Rod\n\ntekst',
  });

  await importer(srv, a, zipSti);
  let trae = (await a.kald('GET', '/api/v1/tree')).data;
  const bog = trae.notebooks.find((b) => b.name === 'Vaerk');
  const raekke = trae.notes.find((n) => n.title === 'Et vaerk');
  const rod = trae.notes.find((n) => n.title === 'Rod');
  assert.equal(raekke.notebookId, bog.id, 'foerste import lagde den rigtigt');

  // Efterlign den gamle imports resultat: raekken i en anden bog, og en
  // rodside haengt op under noget, den ikke hoerer under.
  const anden = (await a.kald('POST', '/api/v1/notebooks', { name: 'Et forkert sted' })).data.notebook;
  await a.kald('POST', `/api/v1/notes/${raekke.id}/move`, { parentId: null, notebookId: anden.id });
  await a.kald('POST', `/api/v1/notes/${rod.id}/move`, { parentId: raekke.id });
  trae = (await a.kald('GET', '/api/v1/tree')).data;
  assert.notEqual(trae.notes.find((n) => n.id === raekke.id).notebookId, bog.id, 'sabotagen virkede');

  const igen = await importer(srv, a, zipSti);
  trae = (await a.kald('GET', '/api/v1/tree')).data;
  assert.equal(trae.notes.find((n) => n.id === raekke.id).notebookId, bog.id,
    'genimporten skal flytte raekken tilbage i sin databases notesbog');
  assert.equal(trae.notes.find((n) => n.id === rod.id).parentId, null,
    'en side, eksporten siger ligger i roden, skal LOESRIVES igen');
  assert.equal(igen.status.counts.pages, 0, 'ingen nye sider');
  // En flytning maa ikke ske i tavshed: kvitteringen skal kunne taelle den.
  assert.equal(igen.status.counts.moved, 2, 'begge flytninger skal staa i kvitteringen');

  // ... og forsidens tabel linker stadig sin raekke.
  const forside = (await a.kald('GET',
    `/api/v1/notes/${trae.notes.find((n) => n.title === 'Vaerk').id}`)).data.note;
  assert.match(forside.body, /\[Et vaerk\]\(sagu-note:[a-f0-9]{32}\)/);
  assert.match(forside.body, /1 of them are pages you can open/);
});

test('macOS-skrald (._ tvillinger) maa ikke overskrive de RIGTIGE sider', async () => {
  /*
   * Fundet af Andreas i drift, 2026-08-21.
   *
   * Pakker man Notion-eksporten om paa en Mac, ligger der en AppleDouble-fil
   * ved siden af hver rigtig fil: `._Titel <hex>.md` - med **samme id**.
   * `sider` er en Map paa id'et, saa tvillingen overskrev den rigtige side,
   * og importen lavede 297 TOMME noter og 13 tomme notesboeger i stedet for
   * hans arkiv. Intet fejlede: taelleren sagde 302 sider.
   */
  const zipSti = byggArkiv({
    'Eksport/Rigtig side aab00000000000000000000000000001.md':
      '# Rigtig side\n\nden her tekst skal overleve',
    // AppleDouble-tvillingen. Samme id, binaert indhold, ingen titel.
    'Eksport/._Rigtig side aab00000000000000000000000000001.md':
      Buffer.from([0x00, 0x05, 0x16, 0x07, 0x00, 0x02, 0x00, 0x00]),
    'Eksport/__MACOSX/._Eksport': Buffer.from([0x00, 0x05, 0x16, 0x07]),
    'Eksport/.DS_Store': Buffer.from([0x00, 0x00, 0x00, 0x01]),
  });

  const { forhaand, status } = await importer(srv, a, zipSti);
  assert.equal(forhaand.pages, 1, 'kun ÉN side - tvillingen er ikke en side');
  /*
   * ... og skraldet maa vaere vaek FOER den faelles rod findes.
   *
   * `__MACOSX/` ligger ved siden af eksportmappen. Er den med i beregningen,
   * findes der ingen faelles rod, og saa forskydes hver eneste relative sti
   * ét led. Maalt paa Andreas' rigtige eksport kostede det 24 af 241
   * genoprettede links - uden at noget fejlede.
   */
  const bog = (await a.kald('GET', '/api/v1/tree')).data.notebooks
    .find((x) => x.name === 'Imported from Notion');
  assert.ok(bog, 'siden skal ligge i opsamlingsbogen, ikke i en bog ved navn "Eksport"');

  const trae = (await a.kald('GET', '/api/v1/tree')).data;
  assert.ok(!trae.notes.some((n) => n.title.startsWith('._')), 'ingen ._ noter');
  assert.ok(!trae.notebooks.some((b) => b.name.startsWith('._')), 'ingen ._ notesboeger');

  const rigtig = trae.notes.find((n) => n.title === 'Rigtig side');
  assert.ok(rigtig, 'den rigtige side skal vaere der');
  const fuld = (await a.kald('GET', `/api/v1/notes/${rigtig.id}`)).data.note;
  assert.match(fuld.body, /den her tekst skal overleve/,
    'tvillingen maa ikke have overskrevet indholdet');

  // ... og det skal STAA i kvitteringen. En fil, der forsvandt tavst,
  // opdages kun ved at taelle i begge ender.
  const sprunget = status.skipped.find((x) => /file system/.test(x.hvorfor));
  assert.ok(sprunget, `skraldet skal staa i kvitteringen: ${JSON.stringify(status.skipped)}`);
  assert.match(sprunget.sti, /3 files/);
});

test('en TOPSIDE med undersider bliver sin egen notesbog', async () => {
  /*
   * Andreas, 2026-08-21: »hvorfor er min wiki endt under en notebook der
   * hedder Imported from Notion?«
   *
   * Importen lavede kun notesboeger ud af DATABASER; alt andet gik i
   * opsamlingsbogen. Men en side oeverst i eksporten med et helt trae under
   * sig ER en notesbog - det er dét, en »wiki« er i Notion. Uden reglen bliver
   * sidebaren én stor bunke i stedet for det, brugeren selv har bygget.
   */
  const zipSti = byggArkiv({
    'Eksport/Haandbog fff00000000000000000000000000001.md': '# Haandbog\n\nforsiden',
    'Eksport/Haandbog/API fff00000000000000000000000000002.md': '# API\n\nendepunkter',
    'Eksport/Haandbog/API/GET kald fff00000000000000000000000000003.md': '# GET kald\n\ndybt nede',
    // En enlig side oeverst: den er IKKE en bog. En bog med ét blad er ingen bog.
    'Eksport/Loesrevet notat fff00000000000000000000000000004.md': '# Loesrevet notat\n\nalene',
  });

  const { status } = await importer(srv, a, zipSti);
  assert.equal(status.error, null);
  const trae = (await a.kald('GET', '/api/v1/tree')).data;

  const bog = trae.notebooks.find((b) => b.name === 'Haandbog');
  assert.ok(bog, `topsiden skal blive en notesbog: ${trae.notebooks.map((b) => b.name).join(', ')}`);

  // HELE traeet ligger i bogen - ogsaa barnebarnet.
  for (const titel of ['Haandbog', 'API', 'GET kald']) {
    const n = trae.notes.find((x) => x.title === titel);
    assert.ok(n, `${titel} mangler`);
    assert.equal(n.notebookId, bog.id, `${titel} skal ligge i Haandbog-bogen`);
  }
  /*
   * Bogens egne sektioner ligger i TOPPEN af bogen - ikke under en note med
   * samme navn som bogen.
   *
   * Topsiden blev BAADE en notesbog og en note (den har forsidens tekst).
   * Uden det her laa hele wikien under »Haandbog > Haandbog > …«: ét niveau,
   * der ikke siger noget, og som man skal klikke forbi hver gang.
   */
  assert.equal(trae.notes.find((x) => x.title === 'API').parentId, null,
    'sektionen ligger i toppen af bogen');
  assert.equal(trae.notes.find((x) => x.title === 'Haandbog').parentId, null,
    'og forsiden ligger ved siden af den');
  // ... men DYBERE nede er hierarkiet uroert.
  assert.equal(trae.notes.find((x) => x.title === 'GET kald').parentId,
    trae.notes.find((x) => x.title === 'API').id);

  // Den enlige side blev IKKE en bog - den ligger i opsamlingen.
  assert.ok(!trae.notebooks.some((b) => b.name === 'Loesrevet notat'));
  const loes = trae.notes.find((x) => x.title === 'Loesrevet notat');
  assert.equal(trae.notebooks.find((b) => b.id === loes.notebookId).name, 'Imported from Notion');
});

test('opsamlingsbogen laves KUN, naar en side skal ligge i den', async () => {
  // En bog uden noter er ikke en kategori, det er en rest. Med databaser og
  // topsider som notesboeger er der ofte ingen loese sider tilbage.
  const zipSti = byggArkiv({
    'Eksport/Kun en bog abc00000000000000000000000000011.md': '# Kun en bog\n\nforside',
    'Eksport/Kun en bog/Et blad abc00000000000000000000000000012.md': '# Et blad\n\ntekst',
  });
  const foer = (await a.kald('GET', '/api/v1/tree')).data.notebooks.map((b) => b.name);
  await importer(srv, a, zipSti);
  const efter = (await a.kald('GET', '/api/v1/tree')).data.notebooks;
  assert.ok(efter.some((b) => b.name === 'Kun en bog'));
  // Fandtes opsamlingen ikke i forvejen, maa importen ikke have lavet den.
  if (!foer.includes('Imported from Notion')) {
    assert.ok(!efter.some((b) => b.name === 'Imported from Notion'),
      'ingen loese sider - saa ingen opsamlingsbog');
  }
});

test('en LINKET VISNING springes over - og det staar i kvitteringen', async () => {
  // Ellers staar det samme indhold to gange i arkivet.
  const zipSti = byggArkiv({
    'Eksport/Dashboard ccc00000000000000000000000000001.md':
      '# Dashboard\n\n[Untitled](Dashboard%20ccc00000000000000000000000000001/Untitled ffb00000000000000000000000000001.csv)',
    'Eksport/Dashboard ccc00000000000000000000000000001/Untitled ffb00000000000000000000000000001.csv':
      'Titel,Status\nNoget,Aabent\n',
  });
  const { forhaand, status } = await importer(srv, a, zipSti);
  assert.equal(forhaand.databases, 0, 'en linket visning er ikke en database');
  assert.equal(forhaand.linkedViews, 1);
  const sprunget = status.skipped.find((x) => /linked view/.test(x.hvorfor));
  assert.ok(sprunget, `den skal staa i kvitteringen: ${JSON.stringify(status.skipped)}`);
  const trae = (await a.kald('GET', '/api/v1/tree')).data;
  assert.ok(!trae.notebooks.some((b) => b.name === 'Untitled'), 'ingen notesbog for en visning');
});

test('UNDERSIDER bliver undersider, ikke loese noter', async () => {
  const zipSti = byggArkiv({
    'Eksport/Far ddd00000000000000000000000000001.md': '# Far\n\ntekst',
    'Eksport/Far ddd00000000000000000000000000001/Barn ddd00000000000000000000000000002.md': '# Barn\n\ntekst',
    'Eksport/Far ddd00000000000000000000000000001/Barn ddd00000000000000000000000000002/Barnebarn ddd00000000000000000000000000003.md':
      '# Barnebarn\n\ntekst',
  });
  await importer(srv, a, zipSti);
  const d = (await a.kald('GET', '/api/v1/tree')).data;
  const trae = d.notes;
  const far = trae.find((n) => n.title === 'Far');
  const barn = trae.find((n) => n.title === 'Barn');
  const barnebarn = trae.find((n) => n.title === 'Barnebarn');

  /*
   * AENDRET 2026-08-21, og det er et VALG - ikke en rettelse.
   *
   * »Far« er en topside med undersider og bliver derfor en notesbog (se
   * testen ovenfor). Bogen ER den side, saa dens boern ligger i TOPPEN af
   * bogen - ikke under en note, der hedder det samme som bogen. Ellers ville
   * hele wikien ligge under »Haandbog > Haandbog > …«, og man skulle
   * klikke forbi det niveau hver gang (Andreas' Notion-wiki, 2026-08-21).
   *
   * Prisen skal siges hoejt: paa ÉT niveau - lige under bogen - udtrykkes
   * hierarkiet nu af bogen i stedet for af en foraelder. Alt dybere er
   * uroert, og det er dét, de to sidste linjer beviser.
   */
  const bog = d.notebooks.find((b) => b.name === 'Far');
  assert.ok(bog, 'topsiden med boern bliver en notesbog');
  assert.equal(barn.notebookId, bog.id, 'Barn ligger i Far-bogen');
  assert.equal(far.notebookId, bog.id, 'og forsiden ligger der ogsaa');
  assert.equal(barn.parentId, null, 'Barn ligger i TOPPEN af bogen');
  assert.equal(barnebarn.parentId, barn.id, 'men Barnebarn ligger stadig under Barn');
});

test('en zip-bombe afvises, foer den pakkes ud', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sagu-bombe-'));
  const stor = path.join(dir, 'stor.txt');
  // 200 MB nuller komprimerer til naesten ingenting - præcis formen paa en
  // zip-bombe, bare i det smaa.
  writeFileSync(stor, Buffer.alloc(200 * 1024 * 1024));
  const zipSti = path.join(dir, 'bombe.zip');
  execFileSync('zip', ['-q', zipSti, 'stor.txt'], { cwd: dir });

  const { readFileSync, statSync } = await import('node:fs');
  assert.ok(statSync(zipSti).size < 1024 * 1024, 'zip\'en skal vaere lille');

  const r = await fetch(`${srv.base}/api/v1/upload`, {
    method: 'POST',
    headers: { Cookie: a.cookie, 'X-Sagu-Upload': '1', 'Content-Type': 'application/zip' },
    body: readFileSync(zipSti),
  });
  const up = await r.json();
  // Selve posten er over MAX_POST, saa den springes over med en begrundelse
  // frem for at vaelte importen.
  const f = await a.kald('POST', '/api/v1/import/preview', { uploadId: up.id });
  assert.equal(f.status, 200, 'forhaandsvisningen skal kunne laese katalogets tal');
  assert.ok(f.data.unpacked > 100 * 1024 * 1024, 'og RAPPORTERE hvor meget det pakker ud til');
});

/* ======================================= en RIGTIG eksport ============== */

/* Stien kommer fra miljoeet, ikke fra koden.
 *
 * En rigtig eksport kan ikke ligge i repoet: den er hundredvis af MB og er
 * brugerens egne noter. Og et hardkodet `ExportBlock-<uuid>` er i sig selv en
 * oplysning om et privat Notion-arbejdsrum - den slags hoerer ikke i et
 * offentligt repo. Testen springes over, naar variablen ikke er sat:
 *
 *   SAGU_NOTION_EKSPORT=~/Downloads/ExportBlock-... node --test tests/notion.test.mjs
 */
const EKSPORT = process.env.SAGU_NOTION_EKSPORT || '';

test('EN RIGTIG NOTION-EKSPORT gaar ind',
  { skip: (!EKSPORT || !existsSync(EKSPORT)) && 'saet SAGU_NOTION_EKSPORT til en udpakket Notion-eksport' },
  async () => {
    const s2 = await startServer();
    try {
      const x = klient(s2.base);
      await x.opret('andreas', 'kodeord-1234');

      const zipSti = path.join(mkdtempSync(path.join(tmpdir(), 'sagu-ae-')), 'eksport.zip');
      execFileSync('zip', ['-rq', zipSti, path.basename(EKSPORT)], { cwd: path.dirname(EKSPORT) });

      const t0 = Date.now();
      const { forhaand, status } = await importer(s2, x, zipSti);
      const ms = Date.now() - t0;

      assert.equal(status.error, null, `importen fejlede: ${status.error}`);
      console.log(`      forhaandsvisning: ${forhaand.pages} sider, ${forhaand.databases} databaser, `
        + `${forhaand.linkedViews} linkede visninger, ${forhaand.files} filer, `
        + `${(forhaand.unpacked / 1024 / 1024).toFixed(0)} MB udpakket`);
      console.log(`      importeret paa ${(ms / 1000).toFixed(1)} s: `
        + `${status.counts.pages} sider, ${status.counts.notebooks} notesboeger, `
        + `${status.counts.files} filer, ${status.counts.links} links, `
        + `${status.counts.tags} maerker, ${status.skippedTotal} sprunget over`);

      assert.ok(forhaand.pages > 250, `kun ${forhaand.pages} sider fundet`);
      assert.equal(forhaand.databases, 12, 'tolv aegte databaser');
      assert.equal(forhaand.linkedViews, 7, 'syv linkede visninger');

      const trae = (await x.kald('GET', '/api/v1/tree')).data;
      assert.ok(trae.notebooks.length >= 12, `kun ${trae.notebooks.length} notesboeger`);
      for (const navn of ['Must-read', 'Podcasts', 'Links', 'Manualer', 'Inventory']) {
        assert.ok(trae.notebooks.some((b) => b.name === navn), `notesbogen "${navn}" mangler`);
      }
      assert.ok(trae.notes.length > 250, `kun ${trae.notes.length} noter`);

      // Datoerne overlevede: arkivet er IKKE skrevet samme aften.
      const aar = new Set(trae.notes.map((n) => new Date(n.updatedAt * 1000).getFullYear()));
      assert.ok(aar.size > 1, `alle noter har samme aar (${[...aar]}) - datoerne gik tabt`);

      // Interne links blev omskrevet.
      assert.ok(status.counts.links > 200, `kun ${status.counts.links} links omskrevet`);

      // Filerne kom med og kan hentes.
      const filer = (await x.kald('GET', '/api/v1/files')).data;
      assert.ok(filer.files.length > 200, `kun ${filer.files.length} filer`);
      const et = filer.files.find((f) => f.mime === 'application/pdf');
      assert.ok(et, 'der skal vaere PDF\'er');
      const hent = await fetch(`${s2.base}${et.url}`, { headers: { Cookie: x.cookie } });
      assert.equal(hent.status, 200);

      // Soegningen virker paa det importerede.
      const soeg = await x.kald('GET', '/api/v1/search?q=factfulness');
      assert.ok(soeg.data.results.length >= 1, 'soegningen skal finde importeret indhold');

      // Og TI STIKPROEVER ser rigtige ud (F5's acceptkriterium).
      const stik = trae.notes.slice(0, 10);
      for (const n of stik) {
        const fuld = (await x.kald('GET', `/api/v1/notes/${n.id}`)).data.note;
        assert.ok(fuld.title, 'en note uden titel');
        assert.ok(!/^\s*[0-9a-f]{32}\s*$/.test(fuld.title), 'titlen maa ikke vaere et hex-id');
        assert.ok(!fuld.body.includes('<aside>'), 'raa <aside> slap igennem');
        // Ingen uomskrevne relative .md-links.
        const relative = [...fuld.body.matchAll(/\]\(([^)\s]+\.md)\)/g)].map((m) => m[1]);
        assert.equal(relative.length, 0,
          `uomskrevne relative links i "${fuld.title}": ${relative.slice(0, 2)}`);
      }
    } finally {
      s2.stop();
    }
  });
