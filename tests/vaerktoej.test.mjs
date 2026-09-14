/*
 * F33 - vaerktoejslinjen fik to knapper:
 *
 *   »Kan du tilfoeje checklist til skrive menuen foer Date?«
 *   »kan du efter Now tilfoeje en knap som skifter visningen til markdown,
 *    saa man fx kan rette overskriften i et URL link«
 *                                             (Andreas, 2026-09-07)
 *
 * Selve raekken er DOM og kan ikke trykkes paa her. Det, der KAN proeves, er
 * de to ting, der baerer den: omskrivningen til tjekliste (ren tekst ind, ren
 * tekst ud) og de faa formregler paa kilden, som fejler TAVST, naar nogen
 * fjerner dem - raekkefoelgen i linjen, og at de to felters blur-vagt er ÉN.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import R from '../app/shared/redigering.js';

const p4 = readFileSync(new URL('../app/parts/p4_editor.js', import.meta.url), 'utf8');

/** `skiftTjekliste` hentet UD af kilden med falske naboer. */
function hentSkift() {
  const tag = (navn) => {
    const i = p4.indexOf(`function ${navn}(`);
    assert.ok(i > -1, `${navn} findes ikke laengere`);
    return p4.slice(i, p4.indexOf('\n}', i) + 2);
  };
  const linje = (m) => {
    const t = p4.match(m);
    assert.ok(t, `${m} findes ikke laengere`);
    return t[0];
  };
  // eslint-disable-next-line no-new-func
  return new Function('editor', 'gemRigBlok', 'skrivBlokTilbage', 'tegnKrop', `
    ${linje(/^const TJEK_LINJE = .*$/m)}
    ${linje(/^const BLOKMAERKE = .*$/m)}
    ${tag('skiftTjekliste')}
    return skiftTjekliste;`);
}

const byg = hentSkift();

/** Kalder knappen paa en blok, der fylder HELE noten, og giver markdownen ud. */
function skift(kilde) {
  const editor = { note: { body: kilde } };
  const b = { fra: 0, til: kilde.split('\n').length - 1 };
  const skrivBlokTilbage = (ny, blok) => {
    const linjer = editor.note.body.split('\n');
    const nye = ny.split('\n');
    linjer.splice(blok.fra, blok.til - blok.fra + 1, ...nye);
    editor.note.body = linjer.join('\n');
    blok.til = blok.fra + nye.length - 1;
  };
  byg(editor, () => {}, skrivBlokTilbage, () => {})(null, b);
  return editor.note.body;
}

/* ================================================== tjeklisten ========== */

test('et afsnit bliver til et tjekpunkt - og tilbage igen', () => {
  assert.equal(skift('koeb kaffe'), '- [ ] koeb kaffe');
  assert.equal(skift('- [ ] koeb kaffe'), 'koeb kaffe');
});

test('hver linje bliver sit eget punkt', () => {
  assert.equal(skift('en\nto\ntre'), '- [ ] en\n- [ ] to\n- [ ] tre');
});

test('en liste, der ALLEREDE er en liste, faar boksen - ikke et bullet mere', () => {
  assert.equal(skift('- en\n- to'), '- [ ] en\n- [ ] to');
  assert.equal(skift('1. en\n2. to'), '- [ ] en\n- [ ] to');
});

test('et maerke, der ikke betyder noget i et punkt, laegges fra sig', () => {
  /*
   * »## Onsdag« inde i et listepunkt er ikke en overskrift - det er to
   * synlige havelaager. Det samme gaelder citattegnet.
   */
  assert.equal(skift('## Onsdag'), '- [ ] Onsdag');
  assert.equal(skift('> sagt af en anden'), '- [ ] sagt af en anden');
});

test('et afkrydset punkt slaas ogsaa fra - begge tilstande er en tjekliste', () => {
  assert.equal(skift('- [x] gjort\n- [ ] ikke endnu'), 'gjort\nikke endnu');
});

test('er kun NOGLE af linjerne punkter, bliver resten det ogsaa', () => {
  // Halvt om halvt er ikke »en tjekliste«, saa knappen goer den til én.
  assert.equal(skift('- [ ] en\nto'), '- [ ] en\n- [ ] to');
});

test('indrykningen bliver staaende - en underliste bliver ikke rettet ud', () => {
  assert.equal(skift('- en\n  - under'), '- [ ] en\n  - [ ] under');
});

test('en tom linje bliver ikke til et tomt punkt', () => {
  assert.equal(skift('en\n\nto'), '- [ ] en\n\n- [ ] to');
});

test('#tag er ikke en overskrift og maa ikke miste sit tegn', () => {
  // Overskriften kraever et mellemrum efter havelaagen; et tag har ingen.
  assert.equal(skift('#kaffe skal koebes'), '- [ ] #kaffe skal koebes');
});

/* ====================================================== formen ========== */

test('tjeklisteknappen staar FOER Date', () => {
  const i = p4.indexOf('function vaerktoejslinjeHtml(');
  assert.ok(i > -1, 'vaerktoejslinjeHtml findes ikke');
  const krop = p4.slice(i, p4.indexOf('\n}\n', i));
  const tjek = krop.indexOf('data-blokform="tjekliste"');
  const dato = krop.indexOf('DATOKNAPPER.map');
  assert.ok(tjek > -1, 'tjeklisteknappen findes ikke i raekken');
  assert.ok(dato > -1, 'datoknapperne findes ikke i raekken');
  assert.ok(tjek < dato, 'tjeklisteknappen skal staa foer Date');
});

test('MD-knappen staar EFTER Now', () => {
  const i = p4.indexOf('function vaerktoejslinjeHtml(');
  const krop = p4.slice(i, p4.indexOf('\n}\n', i));
  const dato = krop.indexOf('DATOKNAPPER.map');
  const md = krop.indexOf('mdKnapHtml(true)');
  assert.ok(md > -1, 'MD-knappen findes ikke i raekken');
  assert.ok(dato < md, 'MD-knappen skal staa efter Now');
});

test('i markdown er MD den eneste knap i raekken', () => {
  /*
   * B, I og U kan ingenting i et `<textarea>`. En knap, der ikke kan det,
   * den viser, er vaerre end ingen knap.
   */
  const i = p4.indexOf('function vaerktoejslinjeHtml(');
  const krop = p4.slice(i, p4.indexOf('\n}\n', i));
  assert.match(krop, /if \(!rigt\) return [\s\S]{0,120}mdKnapHtml\(false\)/,
    'den raa raekke er ikke kun MD-knappen');
});

test('porten spoerger OGSAA, om man selv har bedt om markdown', () => {
  assert.match(p4, /const rigt = !editor\.raaBlok && kanRedigereRigt\(raa, b\)/,
    'MD-knappen kan trykkes ned uden at blokken skifter');
});

test('valget om markdown gaelder kun DEN blok, man staar i', () => {
  const i = p4.indexOf('function aabnBlok(');
  const krop = p4.slice(i, p4.indexOf('\n}\n', i));
  assert.match(krop, /if \(fra !== editor\.aabenBlok\) editor\.raaBlok = false/,
    'et tryk paa MD ville goere resten af noten raa');
  const j = p4.indexOf('function lukBlok(');
  assert.match(p4.slice(j, p4.indexOf('\n}\n', j)), /editor\.raaBlok = false/,
    'valget overlever, at blokken lukkes');
});

/** Koden uden kommentarer - en proeve maa ikke laese en forklaring som kode. */
const udenKommentarer = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

test('HVERT felts blur-vagt er den samme ene funktion', () => {
  /*
   * Den her proeve er selve fejlen skrevet ned. Reglen »er fokus stadig inde
   * i blokken?« stod to steder, og hver af dem kendte kun sit eget felt - saa
   * MD-knappen LUKKEDE blokken i stedet for at skifte visning, fordi den
   * rige blok regnede `blokFelt` for »uden for noten«.
   *
   * Den TALTE foer kaldene og kraevede praecis to. Det var det forkerte maal:
   * da hele noten fik sin egen vaerktoejsraekke (F34), fandtes reglen ét sted
   * mere - og proeven blev roed af, at fejlen blev rettet. Det, der skal
   * gaelde, er ikke et antal, men at INGEN blur-vagt har sin egen liste. Saa
   * vokser proeven med koden i stedet for at braekke af den.
   */
  const vagt = p4.indexOf('function fokusErIBlokken(');
  assert.ok(vagt > -1, 'fokusErIBlokken findes ikke');
  const krop = p4.slice(vagt, p4.indexOf('\n}\n', vagt));
  assert.match(krop, /blokRigt/, 'vagten kender ikke det rige felt');
  assert.match(krop, /blokFelt/, 'vagten kender ikke det raa felt');
  assert.match(krop, /blokVaerktoej/, 'vagten kender ikke vaerktoejslinjen');

  /*
   * HVER blur-handler, der LUKKER blokken, skal spoerge den - ikke sin egen
   * liste. Det er dem, spoergsmaalet handler om; notens maerkefelt har ogsaa
   * en blur, og den har intet med blokken at goere.
   */
  const steder = [...p4.matchAll(/addEventListener\('blur'/g)]
    .map((m) => p4.slice(m.index, m.index + 700))
    .filter((h) => h.includes('lukBlok()'));
  assert.ok(steder.length >= 3, `forventede mindst tre blur-vagter, fandt ${steder.length}`);
  for (const h of steder) {
    assert.match(h, /fokusErIBlokken\(\)/,
      `en blur-vagt spoerger ikke den faelles: ${h.slice(0, 90).replace(/\n/g, ' ')}`);
    // KODEN, ikke kommentarerne: historien om fejlen staar netop dér, og en
    // proeve, der laeser den som en fejl, ville forbyde at skrive den ned.
    assert.ok(!/\.id === 'blok/.test(udenKommentarer(h)),
      'en blur-vagt har faaet sin egen liste over felter tilbage');
  }
});

/* ================================================== indsaettet ========== */

/** `indsatMarkdown` hentet UD af kilden, med den rigtige oversaetter. */
function hentIndsat() {
  const i = p4.indexOf('function indsatMarkdown(');
  assert.ok(i > -1, 'indsatMarkdown findes ikke laengere');
  // eslint-disable-next-line no-new-func
  return new Function('saguRedigering',
    `${p4.slice(i, p4.indexOf('\n}', i) + 2)}\nreturn indsatMarkdown;`)(R);
}

const indsat = hentIndsat();

test('HTML\'en er foerstevalget - den baerer formateringen', () => {
  assert.equal(indsat('<b>fed</b>', 'fed'), '**fed**');
});

test('gav HTML\'en ingenting, redder den bare tekst indsaettet', () => {
  /*
   * Vaernet mod den NAESTE form, ingen har set endnu. Udklipsholderens HTML
   * kommer fra fremmede programmer, og et tomt indsaet er det vaerste af de
   * to udfald: teksten er vaek, og der staar ingen fejl nogen steder.
   */
  assert.equal(indsat('<ukendt-form></ukendt-form>', 'ordene'), 'ordene');
  assert.equal(indsat('   ', 'ordene'), 'ordene');
});

test('er der hverken HTML eller tekst, indsaettes ingenting', () => {
  assert.equal(indsat('', ''), '');
  assert.equal(indsat(undefined, undefined), '');
});

/* ======================================= Code over flere linjer ========== */

/*
 * »jeg proevede at lave noget tekst ind og lave det til en kode. men det
 * virkede ikke rigtigt« (Andreas, 2026-09-14). Tolv linjer PowerShell blev
 * pakket i ét par backticks. Markeringen over flere linjer skal give en
 * kodeblok - og teksten omkring den skal blive staaende.
 */
function hentKodeblok() {
  const i = p4.indexOf('function kodeblokMarkdown(');
  assert.ok(i > -1, 'kodeblokMarkdown findes ikke laengere');
  // eslint-disable-next-line no-new-func
  return new Function(`${p4.slice(i, p4.indexOf('\n}', i) + 2)}\nreturn kodeblokMarkdown;`)();
}
const kodeblok = hentKodeblok();
const md = (await import('../app/shared/markdown.js')).default;

test('hele blokken markeret: én kodeblok, intet andet', () => {
  const kode = '$c = Get-Content x.json -Raw\nforeach ($p in $liste) {\n  $p.value__\n}';
  const ud = kodeblok('', kode, '');
  assert.equal(ud, '```\n' + kode + '\n```');
  const b = md.blokke(ud);
  assert.equal(b.length, 1);
  assert.equal(b[0].slags, 'kode');
  assert.equal(b[0].tekst, kode, 'koden skal staa ordret - ogsaa __ og * og $');
});

test('tekst før og efter bliver sine egne afsnit', () => {
  const ud = kodeblok('Kør det her:\n', 'linje 1\nlinje 2', '\nog se svaret.');
  const b = md.blokke(ud);
  assert.deepEqual(b.map((x) => x.slags), ['afsnit', 'kode', 'afsnit']);
  assert.equal(b[1].tekst, 'linje 1\nlinje 2');
  assert.ok(ud.startsWith('Kør det her:\n\n```'));
  assert.ok(ud.endsWith('```\n\nog se svaret.'));
});

test('tomme linjer i kanten af markeringen kommer ikke med i blokken', () => {
  assert.equal(kodeblok('', '\n\nen\nto\n\n', ''), '```\nen\nto\n```');
});

test('Code-knappen spørger om flere linjer, FØR den pakker ind', () => {
  // Formregel: uden den gaar knappen tilbage til ét par backticks om det hele.
  const knap = p4.slice(p4.indexOf("linje.querySelectorAll('[data-goer]')"));
  const spoerg = knap.indexOf('markeringOverFlereLinjer()');
  const pak = knap.indexOf('omslut(vaert, k.dataset.goer)');
  assert.ok(spoerg > -1 && spoerg < pak);
});

test('indrykningen bliver — også på første linje', () => {
  // Foerste udgave tog det, den rige blok VISTE, og HTML viser ikke
  // mellemrum i starten af en linje: scriptet mistede sin indrykning.
  const kode = '  if ($a) {\n    $b = 1\n  }';
  assert.equal(kodeblok('', kode, ''), '```\n' + kode + '\n```');
  assert.equal(md.blokke(kodeblok('', kode, ''))[0].tekst, kode);
});
