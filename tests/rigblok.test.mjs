/*
 * F30 - den rige blok: noten ser ud, som naar man laeser den, ogsaa mens man
 * skriver i den.
 *
 * Selve fladen bor i `contenteditable` og kan ikke proeves her - der er ingen
 * DOM i node. Det, der KAN proeves, er de tre ting, der afgoer, om den er
 * sikker:
 *
 *   1. PORTEN. Kun en blok, der kan skrives tilbage til noejagtig sin egen
 *      markdown, redigeres renderet. Den regel er ren og hentes ud af kilden.
 *   2. RENSNINGEN ved indsaet - den er den samme rene funktion.
 *   3. FORMREGLER paa kilden: de faa greb, der er lette at komme til at
 *      fjerne, og som fejler TAVST, naar de goer.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import md from '../app/shared/markdown.js';
import R from '../app/shared/redigering.js';

const p4 = readFileSync(new URL('../app/parts/p4_editor.js', import.meta.url), 'utf8');
const HOOK = { billedUrl: (u) => (u.startsWith('sagu:') ? `/api/v1/files/${u.slice(5)}` : null) };

/** `kanRedigereRigt` hentet UD af kilden - ikke skrevet af. */
function hentPorten() {
  const i = p4.indexOf('function kanRedigereRigt');
  assert.ok(i > -1, 'kanRedigereRigt findes ikke laengere');
  const slut = p4.indexOf('\n}', i) + 2;
  const saet = p4.match(/^const RIGE_BLOKKE = new Set\(\[[^\]]*\]\);/m);
  assert.ok(saet, 'RIGE_BLOKKE findes ikke');
  // eslint-disable-next-line no-new-func
  return new Function('saguMarkdown', 'saguRedigering', 'renderValg',
    `${saet[0]}\n${p4.slice(i, slut)}\nreturn { kanRedigereRigt, RIGE_BLOKKE };`)(
    md, R, () => HOOK);
}

const { kanRedigereRigt, RIGE_BLOKKE } = hentPorten();
const blok = (kilde) => md.blokke(kilde)[0];

/* ====================================================== porten ========== */

test('afsnit og overskrifter redigeres renderet', () => {
  for (const kilde of [
    'et helt almindeligt afsnit',
    'med **fed** og *kursiv* og `kode`',
    'med et [link](https://a.dk/?x=1&y=2) og en bar https://b.dk',
    '## En overskrift',
    'flere\nlinjer i samme afsnit',
  ]) {
    assert.equal(kanRedigereRigt(kilde, blok(kilde)), true, kilde);
  }
});

test('KODE aabner altid raat - kode er kode', () => {
  /*
   * Ikke et kompromis. En kodeblok, der blev renderet, mens man skrev i den,
   * ville formatere sit eget indhold - og `**ikke fed**` inde i et eksempel
   * ville blive fed.
   */
  const kilde = '```js\nconst x = 1; // **ikke fed**\n```';
  assert.equal(kanRedigereRigt(kilde, blok(kilde)), false);
  assert.ok(!RIGE_BLOKKE.has('kode'));
});

test('lister, tjeklister, citater og callouts redigeres renderet', () => {
  /*
   * Maalt pr. bloktype mod det rigtige arkiv: liste 92,8 %, citat 98,4 %,
   * callout 100 %. Listerne kom fra 56,6 %, da `<li>` begyndte at baere sit
   * raa praefiks - tabulatorer, dyb indrykning og `*` i stedet for `-`.
   */
  for (const kilde of [
    '- et punkt\n- et til',
    '* stjerne\n* to',
    '\t\t- med tabulatorer\n\t\t- og to',
    '1. et\n2. to\n   - under',
    '- [ ] en opgave\n- [X] en klaret',
    '> et citat\n> paa to linjer',
    '> [!NOTE]\n> en callout',
  ]) {
    assert.equal(kanRedigereRigt(kilde, blok(kilde)), true, kilde);
  }
});

test('tabeller aabner RAAT - og det er et valg, ikke et hul', () => {
  /*
   * Oversaettelsen KAN tabeller - den bruges til at rense det, man indsaetter
   * fra en webside. Men ingen af Andreas' 35 tabeller bestod rundturen:
   * de er skrevet `| --- | --- |` med mellemrum og med haandsat cellebredde
   * (`| setup  |`), og en kanonisk udskrift retter det hele.
   *
   * Vi kunne have baaret hver celles polstring med. Men for en tabel ER den
   * raa form den gode skriveflade: kolonnerne staar under hinanden, og det er
   * netop dét, man har brugt tid paa at rette til. At normalisere den ved
   * foerste tastetryk ville vaere at smide arbejdet vaek.
   */
  const kilde = '| a | b |\n| --- | --- |\n| 1 | 2 |';
  assert.equal(kanRedigereRigt(kilde, blok(kilde)), false);
  assert.ok(!RIGE_BLOKKE.has('tabel'));
});

test('der er en vej til at TILFOEJE en blok - ikke kun til at aabne én', () => {
  /*
   * »Hvordan tilfoejer jeg en ny block, naar jeg kun kan klikke ind i en
   * allerede eksisterende tekstblok?« (Andreas, 2026-09-05).
   *
   * Reglen »et tryk i noten begynder at skrive« aabnede den SIDSTE blok - og
   * sluttede noten med en kodeblok eller en tabel, blev man afleveret i raa
   * markdown uden vej til en ny linje efter den. Feltet skal desuden kunne
   * SES: en regel, man ikke kan se, findes ikke for den, der leder.
   */
  assert.match(p4, /function nyBlokTilSidst/);
  assert.match(p4, /class="ny-blok"/, 'feltet tegnes ikke');
  assert.match(p4, /Add a block/, 'feltet siger ikke, hvad det goer');
  // ... og en TOM blok, man har bedt om at aabne, skal kunne aabnes.
  assert.match(p4, /!String\(linjer\[editor\.aabenBlok\] \|\| ''\)\.trim\(\)/,
    'en tom linje regnes ikke som en blok - »tilfoej« ville lukke med det samme');
  // Ingen knap paa en note, man kun maa laese.
  assert.match(p4, /maaRette\(n\) \? nyBlokFeltHtml\(\) : ''/);
});

test('en TOM blok kan ses - og pladsholderen naar aldrig noten', () => {
  /*
   * »Tekstfeltet er skjult indtil man begynder at skrive i det« (Andreas,
   * 2026-09-05). En ny blok tegnes som et tomt `<p>`, og et tomt afsnit har
   * ingen linjeboks - det falder sammen til nul i hoejden. Tilbage stod kun
   * accent-stregen i venstre kant.
   *
   * Pladsholderen SKAL tegnes med CSS. Et tekstnode ville blive skrevet med
   * ind i noten, naeste gang blokken oversaettes tilbage - man ville faa
   * »Write here…« staaende i sin note, fordi man klikkede.
   */
  const css = readFileSync(new URL('../app/public/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.blok-felt\.rig-felt \{[^}]*min-height:/,
    'feltet har ingen hoejde, foer der staar noget i det');
  assert.match(css, /\.rig-felt > p:empty::before[\s\S]{0,120}content:/,
    'pladsholderen tegnes ikke med CSS');
  // ... og den maa IKKE staa i koden som tekst, der kan havne i noten.
  assert.ok(!/Write here/.test(p4),
    'pladsholderen staar i JS - saa kan den skrives med ind i noten');
});

test('hele-noten-kontakten siger, hvad man giver AFKALD paa', () => {
  /*
   * »Mine noter bliver stadigvaek lavet om til markdown naar jeg proever at
   * skrive i en« (Andreas, 2026-09-05). Der var intet i stykker: kontakten
   * »Click a line to edit the whole note as markdown« var slaaet til, og den
   * gaar UDEN OM blok-editoren.
   *
   * Teksten ved siden af sagde bare, at Sagu »normally opens just the
   * paragraph you clicked« - den naevnte ikke, at afsnittet nu er RENDERET.
   * Man kunne altsaa slaa den rendererede editor fra uden at vide, at det var
   * dét, man gjorde. En kontakt skal sige, hvad den koster.
   */
  const p2 = readFileSync(new URL('../app/parts/p2_pages.js', import.meta.url), 'utf8');
  const i = p2.indexOf('Click a line to edit the whole note as markdown');
  assert.ok(i > -1, 'kontakten findes ikke laengere');
  const tekst = p2.slice(i, i + 900);
  assert.match(tekst, /rendered while you write in it/i,
    'teksten siger ikke, at afsnittet er renderet');
  assert.match(tekst, /give\s*\n?\s*up|giver du afkald/i,
    'teksten siger ikke, hvad man giver afkald paa');
});

/* ============================ det raa felts hjaelpere, i den rige blok === */

test('genvejene og wikilinks er BUNDET i den rige blok', () => {
  /*
   * »Nu hvor min /now m.m. ikke virker« og »min [[link til anden]] virker
   * heller ikke mere« (Andreas, 2026-09-05). Samme aarsag: begge hjaelpere
   * var bundet paa det RAA felts `input`, og den rige blok fik dem aldrig.
   * En proeve paa selve bindingen, for fejlen var tavs - der skete bare
   * ingenting.
   */
  const i = p4.indexOf('function bindRigBlok');
  const stykke = p4.slice(i, p4.indexOf('\n}\n', i));
  assert.match(stykke, /rigTekstgenvej\(vaert\)/, 'genvejene er ikke bundet');
  assert.match(stykke, /opdaterWikiForslag\(a\)/, 'wikilink-forslagene er ikke bundet');
  assert.match(stykke, /if \(wikiTast\(e\)\) return;/,
    'forslagslisten faar ikke tasterne foerst - Escape ville lukke hele blokken');
});

test('genvejene bruger SAMME bord som det raa felt', () => {
  /*
   * To lister ville drive fra hinanden: den dag nogen tilfoejer en genvej,
   * skal den virke begge steder uden at nogen husker det.
   */
  assert.match(p4, /for \(const g of TEKSTGENVEJE\)[\s\S]{0,400}byttVedMarkoer/,
    'rigTekstgenvej loeber ikke TEKSTGENVEJE igennem');
  const knapper = p4.slice(p4.indexOf('const DATOKNAPPER'), p4.indexOf('const DATOKNAPPER') + 300);
  for (const ord of ['/dmy', '/hhmm', '/now']) assert.ok(knapper.includes(ord), ord);
  assert.match(p4, /TEKSTGENVEJE\.find\(\(x\) => x\.ord === o\.ord\)/,
    'knapperne tegnes ikke af TEKSTGENVEJE - de kunne indsaette noget andet end genvejen');
});

test('genvejen kraever et mellemrum foran - ellers rammer den midt i et ord', () => {
  // `og/dmy` maa ikke blive til en dato. Samme regel som i det raa felt.
  assert.match(p4, /if \(tegnFoer !== undefined && !\/\\s\/\.test\(tegnFoer\)\) continue;/);
});

test('dato-knappen virker, ogsaa naar markoeren staar paa selve feltet', () => {
  /*
   * Foerste udgave brugte `markoerTekst()`, som kraever en TEKSTKNUDE. Staar
   * markoeren paa en elementgraense - fx lige efter et fedt ord - gjorde
   * knappen ingenting. Og stod den paa selve feltet, lavede den et nyt
   * afsnit i stedet for at skrive datoen, hvor man stod.
   */
  assert.match(p4, /function indsaetVedMarkoer/);
  assert.match(p4, /if \(r\.startContainer === vaert\)/,
    'markoeren paa selve feltet flyttes ikke ind i afsnittet');
  const i = p4.indexOf("linje.querySelectorAll('[data-genvej]')");
  const stykke = p4.slice(i, i + 500);
  assert.match(stykke, /indsaetVedMarkoer/, 'knappen bruger stadig den, der kraever en tekstknude');
});

test('tjeklister med to mellemrum bestaar porten', () => {
  // Syv af ni af Andreas' tjeklister ser saadan ud.
  const kilde = '- [x]  Kaffe\n- [ ]  Filtre';
  assert.equal(kanRedigereRigt(kilde, blok(kilde)), true);
});

test('en blok, der ikke kan skrives TILBAGE, aabner raat', () => {
  /*
   * DEN vigtigste proeve i filen - hele sikkerhedsnettet.
   *
   * `## Husk ` med et mellemrum til sidst er den ene af 9.233 blokke i
   * Andreas' arkiv, der ikke bestaar rundturen: rendereren trimmer
   * overskrifter. Uden porten ville et klik i den blok fjerne mellemrummet,
   * og versionshistorikken ville vise en rettelse, ingen har lavet.
   */
  const kilde = '## Husk ';
  assert.equal(R.tilMarkdown(md.render(kilde, HOOK).html.trim()), '## Husk',
    'forudsaetningen holder ikke laengere - ret proeven');
  assert.equal(kanRedigereRigt(kilde, blok(kilde)), false,
    'en blok, rundturen aendrer, blev aabnet rigt');
});

test('HTML skrevet i en note er TEKST - og overlever rundturen', () => {
  /*
   * Min foerste antagelse var, at saadan en blok maatte aabne raat. Den var
   * forkert, og porten sagde fra: rendereren escaper `<` til `&lt;`, saa det
   * ER tekst, og laeseren afkoder den praecist tilbage. Der er altsaa ingen
   * grund til at naegte den rig redigering - og det er porten, der afgoer det,
   * ikke et gaet om, hvad der er svaert.
   */
  const kilde = 'noget <span class="mit">eget</span> markup';
  assert.match(md.render(kilde, HOOK).html, /&lt;span/, 'HTML skal escapes til tekst');
  assert.equal(R.tilMarkdown(md.render(kilde, HOOK).html.trim()), kilde);
  assert.equal(kanRedigereRigt(kilde, blok(kilde)), true);
});

/* ============================================ rensning ved indsaet ====== */

test('et Word-indsaet bliver til markdown - ikke til stilark', () => {
  /*
   * Maalt med et rigtigt indsaet 2026-09-05, og det fandt to huller:
   * `<o:p>` har et KOLON i navnet og var derfor slet ikke et tag, saa
   * `</o:p>` slap igennem som synlig tekst - og et `<style>`-blok ville
   * folde sit CSS ud som ord i noten.
   */
  const word = '<html><head><style>p.MsoNormal{margin:0cm;font-size:11.0pt}</style></head>'
    + '<body><div style="font-family:Calibri"><span style="color:#FF0000">roedt</span>'
    + ' og <b>fedt</b> og <a href="https://x.dk">et link</a><o:p></o:p></div></body></html>';
  assert.equal(R.tilMarkdown(word), 'roedt og **fedt** og [et link](https://x.dk)');
});

test('navnerum-tags er tags - ikke tekst', () => {
  assert.equal(R.tilMarkdown('a<o:p>b</o:p>c'), 'abc');
  assert.equal(R.tilMarkdown('<w:sdt><m:oMath>x</m:oMath></w:sdt>'), 'x');
});

test('style og script sluger deres INDHOLD - resten folder kun formateringen ud', () => {
  /*
   * Forskellen er hele reglen: `<div>` mister sit udseende, men beholder sine
   * ord. `<style>` har ingen ord - det har CSS.
   */
  assert.equal(R.tilMarkdown('a<script>alert(1)</script>b'), 'ab');
  assert.equal(R.tilMarkdown('a<style>.x{color:red}</style>b'), 'ab');
  assert.equal(R.tilMarkdown('<div>ordene</div>'), 'ordene', 'div maa ikke sluge tekst');
});

/* ================================================ formregler ============ */

test('den rige blok fyldes EFTER pyntningen', () => {
  /*
   * `pyntInlineKode`, `tegnGreb` og de andre pynter alt, hvad de finder.
   * Inde i noget, man redigerer, ville en kopiknap staa i teksten og blive
   * skrevet MED tilbage som ord. Feltet fyldes derfor foerst bagefter - og
   * det er raekkefoelgen, der baerer det, ikke en undtagelse i fem funktioner.
   */
  const pynt = p4.indexOf('pyntInlineKode(host)');
  const fyld = p4.indexOf("vaert.innerHTML = del(raa)");
  assert.ok(pynt > -1 && fyld > -1, 'de to steder findes ikke laengere');
  assert.ok(pynt < fyld, 'feltet fyldes FOER pyntningen - kopiknapper havner i teksten');
});

test('vaerktoejsknapperne lytter paa mousedown, ikke click', () => {
  /*
   * Et `click` ville tage fokus fra teksten foerst, og `blur` lukker blokken
   * - saa var markeringen vaek, foer knappen naaede at virke. Knappen ville
   * se ud til ikke at goere noget.
   */
  const i = p4.indexOf("linje.querySelectorAll('[data-goer]')");
  assert.ok(i > -1, 'bindingen af vaerktoejslinjen findes ikke');
  const stykke = p4.slice(i, i + 700);
  assert.match(stykke, /addEventListener\('mousedown'/);
  assert.ok(!/addEventListener\('click'/.test(stykke), 'der lyttes paa click');
  assert.match(stykke, /preventDefault\(\)/, 'fokus tages fra teksten');
});

test('blur lukker IKKE blokken, naar man trykker paa vaerktoejslinjen', () => {
  /*
   * Foerste udgave af den her proeve kiggede i HELE `bindRigBlok` efter
   * »blokVaerktoej« - og strengen staar der ogsaa i bindingen af knapperne.
   * Sabotagen (fjern vagten fra blur) gav derfor GROENT. En proeve, der leder
   * i et for stort stykke, maaler noget andet, end den tror.
   *
   * Uden vagten: man markerer et ord, trykker paa B, feltet mister fokus,
   * blur lukker blokken - og knappen ser ud til ikke at goere noget.
   */
  const i = p4.indexOf("vaert.addEventListener('blur'");
  assert.ok(i > -1, 'blur-lytteren paa den rige blok findes ikke');
  const stykke = p4.slice(i, p4.indexOf('});', i));
  assert.match(stykke, /blokVaerktoej/, 'blur-vagten kender ikke vaerktoejslinjen');
  assert.match(stykke, /blokRigt/, 'blur-vagten kender ikke feltet selv');
});

test('live-reglerne kraever et lukketegn OG et forskelligt tegn foran', () => {
  /*
   * Uden `foran`-tjekket spiser den enkelte stjerne den dobbelte: `**fed**`
   * ville blive fanget af `*...*`-reglen med `*fed*` som indhold. Det er
   * samme regel, rendereren har - set fra den anden side.
   */
  const i = p4.indexOf('const LIVE = [');
  const stykke = p4.slice(i, p4.indexOf('];', i));
  for (const t of ['strong', 'em', 'code']) assert.match(stykke, new RegExp(`tag: '${t}'`));
  assert.match(stykke, /foran: '\*'/);
  assert.match(p4, /knude\.data\[start - 1\] === m\.foran/,
    'tegnet foer kontrolleres ikke - ** ville blive spist af *-reglen');
});

test('understregs-varianten baerer sit data-md med ind', () => {
  // Ellers ville `_kursiv_`, skrevet live, komme tilbage som `*kursiv*`.
  const i = p4.indexOf('const LIVE = [');
  const stykke = p4.slice(i, p4.indexOf('];', i));
  assert.match(stykke, /foran: '_', md: '_'/);
  assert.match(p4, /el\.setAttribute\('data-md', m\.md\)/);
});
