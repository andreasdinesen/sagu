/*
 * F36 - markér flere blokke i en note.
 *
 * »Kan du lave saa man kan markere flere elementer i en note via ctrl+klik
 * saa man fx kan kopier flere elementer paa en gang? Man maa gerne kunne
 * bruge delete og send to doda funktionen« (Andreas, 2026-09-20).
 *
 * ── Hvad proeverne maaler ─────────────────────────────────────────────────
 *
 * Selve markeringen er DOM og kan ikke trykkes paa her. Det, der KAN proeves,
 * er de to rene tekstoperationer, den hviler paa - og de er begge to den
 * slags, der ser ud til at virke, indtil det gaar galt paa en bestemt note:
 *
 *   `sletBlokke`         raekkefoelgen. Sletter man oppefra og ned, er hvert
 *                        linjenummer under den foerste sletning rykket op, og
 *                        de naeste rammer naboen. Med tre afsnit og et valg af
 *                        foerste og tredje ryger foerste og ANDET.
 *   `blokkeSomMarkdown`  notens raekkefoelge og separatoren. Uden den tomme
 *                        linje smelter to afsnit sammen til ét, naar teksten
 *                        saettes ind igen.
 *
 * Dertil de formregler paa kilden, der fejler TAVST: en markering, der ikke
 * ryddes ved en aendring, peger paa linjer i en tekst, der ikke findes mere -
 * og saa sletter »Delete« noget andet, end man kan se er markeret.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import M from '../app/shared/markdown.js';

const p4 = readFileSync(new URL('../app/parts/p4_editor.js', import.meta.url), 'utf8');
const p6 = readFileSync(new URL('../app/parts/p6_blokke.js', import.meta.url), 'utf8');
const p12 = readFileSync(new URL('../app/parts/p12_polering.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/public/style.css', import.meta.url), 'utf8');

/** Blokkenes foerste linjer - det tal, markeringen bestaar af. */
const fraer = (md) => M.blokke(md).map((b) => b.fra);

/* =============================================== sletning af flere ====== */

test('to blokke slettes, og det er PRAECIS dem, der var markeret', () => {
  const md = 'foerste\n\nanden\n\ntredje';
  const f = fraer(md);
  const ud = M.sletBlokke(md, [f[0], f[2]]);
  assert.equal(ud.trim(), 'anden');
});

test('raekkefoelgen i markeringen er ligegyldig', () => {
  const md = 'foerste\n\nanden\n\ntredje';
  const f = fraer(md);
  assert.equal(M.sletBlokke(md, [f[2], f[0]]), M.sletBlokke(md, [f[0], f[2]]));
});

test('samme blok to gange sletter ÉN blok', () => {
  const md = 'en\n\nto\n\ntre';
  const f = fraer(md);
  // Uden `new Set` ville anden omgang ramme den blok, der rykkede op i
  // stedet - og »to« ville forsvinde, uden at nogen havde markeret den.
  assert.equal(M.sletBlokke(md, [f[0], f[0]]).trim(), 'to\n\ntre');
});

test('en flerlinjet blok tages HEL med', () => {
  const md = '# Titel\n\n```js\nconst a = 1;\nconst b = 2;\n```\n\nslut';
  const f = fraer(md);
  const ud = M.sletBlokke(md, [f[1]]);
  assert.ok(!ud.includes('const a'), 'kodeblokkens krop skal med');
  assert.ok(!ud.includes('```'), 'og dens hegn');
  assert.ok(ud.includes('# Titel') && ud.includes('slut'));
});

test('alle blokke kan slettes - noten bliver tom, ikke i stykker', () => {
  const md = 'en\n\nto\n\ntre';
  assert.equal(M.sletBlokke(md, fraer(md)).trim(), '');
});

test('et tal, der ikke er en blok, gør ingenting', () => {
  const md = 'en\n\nto';
  assert.equal(M.sletBlokke(md, [999]), md);
  assert.equal(M.sletBlokke(md, []), md);
  assert.equal(M.sletBlokke(md, null), md);
});

test('SABOTAGE: sorteres der stigende, rammer sletningen naboen', () => {
  /*
   * Proeven ovenfor skal kunne SES faelde. Her er den forkerte rækkefoelge
   * skrevet ud i haanden: sletter man foerst blok 0 og BAGEFTER slaar tallet
   * for blok 2 op i den nye tekst, peger det paa den anden blok.
   */
  const md = 'foerste\n\nanden\n\ntredje';
  const f = fraer(md);
  let galt = M.sletBlok(md, f[0]);
  galt = M.sletBlok(galt, f[2]);
  assert.notEqual(galt.trim(), 'anden',
    'oppefra og ned MAA give et andet svar - ellers maaler proeven ingenting');
});

/* ======================================= de valgte blokke som tekst ===== */

test('blokkene kommer i NOTENS raekkefoelge, ikke klikkenes', () => {
  const md = 'en\n\nto\n\ntre';
  const f = fraer(md);
  assert.equal(M.blokkeSomMarkdown(md, [f[2], f[0]]), 'en\n\ntre');
});

test('blokkene skilles af en tom linje, saa de ikke smelter sammen', () => {
  const md = 'et afsnit\n\net andet';
  const ud = M.blokkeSomMarkdown(md, fraer(md));
  assert.equal(ud, 'et afsnit\n\net andet');
  // Rundturen: teksten skal kunne laeses som de samme to blokke igen.
  assert.equal(M.blokke(ud).length, 2);
});

test('den RAA kilde baeres med - ikke en renderet udgave', () => {
  const md = '- [ ] ring til Bo\n- [x] bestil kaffe\n\n> et citat';
  const f = fraer(md);
  assert.equal(M.blokkeSomMarkdown(md, [f[0]]), '- [ ] ring til Bo\n- [x] bestil kaffe');
  assert.equal(M.blokkeSomMarkdown(md, [f[1]]), '> et citat');
});

test('en tabel og en kodeblok overlever udvalget hele', () => {
  const md = '| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```\nkode\n```';
  const ud = M.blokkeSomMarkdown(md, fraer(md));
  assert.ok(ud.includes('| --- | --- |'));
  assert.ok(ud.includes('```\nkode\n```'));
});

test('ingen markering giver en tom tekst', () => {
  assert.equal(M.blokkeSomMarkdown('en\n\nto', []), '');
});

test('CRLF forskyder ikke linjenumrene', () => {
  const md = 'en\r\n\r\nto\r\n\r\ntre';
  const f = fraer(md);
  assert.equal(M.blokkeSomMarkdown(md, [f[1]]), 'to');
});

/* ============================================ hvad der kan SENDES ======= */

test('en streg har ingen tekst - og bliver derfor ingen opgave', () => {
  /*
   * Fundet af F36 selv: tre markerede blokke, hvoraf den ene var `---`, gav
   * en opgave i doda, der hed »---«. Markoererne i `blokSomLinje` fjerner
   * `#`, `>` og `-` FORAN en tekst - men stregen ER blokken, saa der var
   * intet at fjerne, og tre tegn er nok til at slippe forbi loftet paa to.
   *
   * Fejlen gjaldt ogsaa blokmenuens »Send to doda« for én blok ad gangen.
   */
  const md = 'et afsnit\n\n---\n\n## en overskrift';
  const b = M.blokke(md);
  assert.equal(M.blokSomLinje(md, b[1].fra), '', 'stregen maa ikke blive til tekst');
  assert.equal(M.blokSomLinje(md, b[0].fra), 'et afsnit');
  assert.equal(M.blokSomLinje(md, b[2].fra), 'en overskrift');
});

test('markoerer ryger, men teksten bliver', () => {
  const md = '- [ ] ring til Bo\n- [x] bestil kaffe';
  assert.equal(M.blokSomLinje(md, 0), 'ring til Bo bestil kaffe');
});

/* ================================================== formregler ========== */

test('markeringen ryddes, hver gang noten AENDRER sig', () => {
  /*
   * Markeringen er linjenumre. Enhver aendring af teksten flytter dem, og en
   * markering, der bliver staaende, peger saa paa noget andet, end brugeren
   * kan se er markeret - `sletValgteBlokke` ville fjerne den forkerte blok.
   *
   * De fire steder, `body` skrives uden for markeringens egne handlinger.
   */
  for (const f of ['function fuldfoerTraek()', 'function sletBlokFraMenu(']) {
    const i = p6.indexOf(f);
    assert.ok(i > -1, `${f} findes ikke laengere`);
    const krop = p6.slice(i, i + 1400);
    assert.ok(krop.includes('nulstilBlokValg()'),
      `${f} skal rydde markeringen - linjenumrene er foraeldede bagefter`);
  }
  const ab = p4.indexOf('function aabnBlok(');
  assert.ok(ab > -1);
  assert.ok(p4.slice(ab, p4.indexOf('\n}', ab)).includes('nulstilBlokValg()'),
    'at aabne en blok skal slutte markeringen - det aabne felt har intet data-blok');
});

test('de tre klik-veje spoerger ALLE om markeringen foerst', () => {
  /*
   * Tjekboksen og billedet standser deres egen haendelse, saa de naar aldrig
   * kroppens delegerede handler. Glemmes ét af de to steder, kan en tjekliste
   * eller et billede ikke markeres - og fejlen ligner »markeringen virker
   * ikke paa nogle blokke«.
   */
  for (const f of ['function bindTjek(', 'function bindBilleder(']) {
    const i = p6.indexOf(f);
    assert.ok(i > -1, `${f} findes ikke laengere`);
    assert.ok(p6.slice(i, i + 1400).includes('blokValgKlik(e)'), `${f} mangler markeringen`);
  }
  const bk = p4.indexOf('function bindKrop()');
  assert.ok(bk > -1);
  assert.ok(p4.slice(bk, bk + 3500).includes('blokValgKlik(e)'),
    'kroppens egen handler mangler markeringen');
});

test('markeringen spoerges FOER tekstmarkeringens vagt', () => {
  // Et ⌘-klik i et afsnit, hvor der ogsaa stod markeret tekst, ville ellers
  // falde paa »en markering er ikke en anmodning om at redigere« og gøre
  // ingenting.
  const bk = p4.indexOf('function bindKrop()');
  const krop = p4.slice(bk, bk + 5000);
  assert.ok(krop.indexOf('blokValgKlik(e)') < krop.indexOf('window.getSelection()'),
    'blokValgKlik skal staa foer getSelection-vagten');
});

test('Escape rydder blokmarkeringen FOER traeets', () => {
  const i = p12.indexOf("e.key === 'Escape'");
  assert.ok(i > -1);
  const krop = p12.slice(i, i + 900);
  assert.ok(krop.indexOf('harBlokValg') < krop.indexOf('harValgte'),
    'staar man i en note, er det blokkene, Escape mener');
});

test('haandtaget har en doer for touch - og den kalder markeringen', () => {
  // F26's aabne ende var, at en telefon ikke kan STARTE en markering. Punktet
  // i blokmenuen er den eneste vej ind uden en ⌘-tast; forsvinder det, er
  // halvdelen af brugerne uden funktionen, og intet fejler.
  assert.ok(p6.includes('id="blokVaelg"'), 'menupunktet »Select this block« mangler');
  const i = p6.indexOf("querySelector('#blokVaelg')");
  assert.ok(i > -1 && p6.slice(i, i + 200).includes('skiftBlokValgt('),
    'punktet skal faktisk markere blokken');
});

test('baandets punkter loves kun, naar de kan holdes', () => {
  const i = p6.indexOf('function tegnBlokValgBaand()');
  assert.ok(i > -1);
  const krop = p6.slice(i, p6.indexOf('\n}', p6.indexOf('bvRyd', i)));
  assert.ok(/maaRette\(n\)/.test(krop), 'Delete maa ikke staa paa en note, man kun maa laese');
  assert.ok(/dodaState\.connected/.test(krop), 'doda-punktet maa ikke staa uden doda');
  assert.ok(krop.includes('bvKopi') && krop.includes('bvRyd'),
    'Copy og Clear staar altid - ogsaa paa en note, man kun maa laese');
});

test('en markering farves aldrig med paa et print', () => {
  const i = css.indexOf('@media print');
  assert.ok(i > -1);
  assert.ok(css.slice(i).includes('.blok-valgt'),
    'markeringen ville blive til en graa kasse om et tilfaeldigt afsnit');
  assert.ok(/\.blok-menu, \.syntakspanel, \.valgtbaand \{ display: none/.test(css),
    'baandet er betjening, ikke papir - det hoerer i print-listen over skjulte dele');
});

test('kopieringen har ÉT sted, saa note og udvalg ikke kan sige hver sit', () => {
  assert.ok(p6.includes('function kopierMarkdown('), 'den faelles kopiering mangler');
  const i = p6.indexOf('function kopierNoten(');
  assert.ok(p6.slice(i, p6.indexOf('\n}', i)).includes('kopierMarkdown('),
    'hele noten skal gaa gennem den samme funktion som et udvalg af blokke');
});
