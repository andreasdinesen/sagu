/*
 * Notesbogen i broedkrummen - en KNAP, der aabner bogen i sidebaren.
 *
 * »jeg vil gerne have tilfoejet at naar jeg staar i en note at den saa viser
 * lige ved navnet hvilke notebook den ligger under og navnet skal man kunne
 * klikke paa for at aabne den notebook i venstre menuen« (Andreas,
 * 2026-09-16).
 *
 * Bogen STOD der i forvejen som doed tekst - og det er netop den slags, der
 * ser rigtig ud og ikke goer noget. Proeven holder derfor fast i, at den er en
 * knap, at den er bundet, og at den folder BEGGE foldninger ud.
 *
 * Det, der ikke proeves her: selve rulningen og glimtet. De er set i
 * browser-ruden - sidebaren rullede 404 px, vinduet stod stille.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const p4 = readFileSync(new URL('../app/parts/p4_editor.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/public/style.css', import.meta.url), 'utf8');

function hent(kilde, navn, afhaengigheder = {}) {
  const i = kilde.indexOf(`function ${navn}(`);
  assert.ok(i > -1, `${navn} findes ikke laengere - ret proeven`);
  const slut = kilde.indexOf('\n}', i) + 2;
  const navne = Object.keys(afhaengigheder);
  // eslint-disable-next-line no-new-func
  return new Function(...navne, `${kilde.slice(i, slut)}\nreturn ${navn};`)(
    ...navne.map((k) => afhaengigheder[k]));
}

function krop(kilde, navn) {
  const i = kilde.indexOf(`function ${navn}(`);
  assert.ok(i > -1, `${navn} findes ikke laengere - ret proeven`);
  return kilde.slice(i, kilde.indexOf('\n}', i) + 2);
}

const BOG = 'b'.repeat(32);
const FAR = 'f'.repeat(32);
const esc = (s) => String(s === undefined || s === null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const krummer = (note, st) => hent(p4, 'broedkrummer', {
  state: st,
  esc,
  icon: (navn, stoerrelse) => `<svg data-ikon="${navn}" data-stoerrelse="${stoerrelse}"></svg>`,
  notesbog: hent(p4, 'notesbog', { state: st }),
})(note);

test('notesbogen er en KNAP med bogens id - ikke doed tekst', () => {
  const html = krummer({ notebookId: BOG, parentId: null }, {
    notebooks: [{ id: BOG, name: 'Hjemmet', icon: null }], tree: [],
  });
  assert.match(html, new RegExp(`<button[^>]*data-bogkrumme="${BOG}"`), 'bogen skal kunne klikkes');
  assert.match(html, /Hjemmet/);
  assert.match(html, /data-ikon="book"/, 'uden et eget ikon staar bog-ikonet');
});

test('bogens eget ikon vinder over standardikonet', () => {
  const html = krummer({ notebookId: BOG, parentId: null }, {
    notebooks: [{ id: BOG, name: 'Kaffe', icon: '☕' }], tree: [],
  });
  assert.match(html, /☕/);
  assert.ok(!html.includes('data-ikon="book"'));
});

test('en note UDEN notesbog faar ingen bog-krumme', () => {
  // De loese noter hoerer ikke til en bog, og en tom krumme ville bare vaere
  // en streg over titlen.
  assert.equal(krummer({ notebookId: null, parentId: null }, { notebooks: [], tree: [] }), '');
});

test('foraeldrene staar stadig efter bogen, og de aabner noten', () => {
  const html = krummer({ notebookId: BOG, parentId: FAR }, {
    notebooks: [{ id: BOG, name: 'Drift', icon: null }],
    tree: [{ id: FAR, parentId: null, title: 'Servere' }],
  });
  assert.ok(html.indexOf('data-bogkrumme') < html.indexOf('data-krumme'), 'bogen staar foerst');
  assert.match(html, new RegExp(`data-krumme="${FAR}"[^>]*>Servere`));
});

test('et bognavn med < og " slipper ikke ud i markup\'en', () => {
  const html = krummer({ notebookId: BOG, parentId: null }, {
    notebooks: [{ id: BOG, name: '<script>"x"', icon: null }], tree: [],
  });
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;/);
});

test('knappen er bundet - en krumme uden handler er doed tekst med en musemarkoer', () => {
  const k = krop(p4, 'bindNoteSide');
  assert.match(k, /\[data-bogkrumme\]/);
  assert.match(k, /visBogITraeet\(el\.dataset\.bogkrumme\)/);
});

test('klikket folder BAADE bogen og hele notesbogs-sektionen ud', () => {
  // Er sektionen foldet sammen, er bogen der stadig ikke - to foldninger, ét
  // oenske. Fejlen ville vaere usynlig, saa laenge sektionen stod aaben.
  const foldede = new Set(['sektion:notebooks', BOG, 'en-anden-bog']);
  let gemt = 0;
  let tegnet = 0;
  hent(p4, 'visBogITraeet', {
    editor: { foldede },
    SEKTION_BOEGER: 'sektion:notebooks',
    gemFoldede: () => { gemt += 1; },
    tegnTrae: () => { tegnet += 1; },
    smalSkaerm: () => false,
    document: { querySelector: () => null },
    setTimeout: () => {},
  })(BOG);
  assert.deepEqual([...foldede], ['en-anden-bog'], 'kun DEN bog og sektionen foldes ud');
  assert.equal(gemt, 1, 'foldningen skal huskes til naeste gang');
  assert.equal(tegnet, 1);
});

test('en bog, der allerede staar aaben, skriver ikke i lageret igen', () => {
  let gemt = 0;
  hent(p4, 'visBogITraeet', {
    editor: { foldede: new Set() },
    SEKTION_BOEGER: 'sektion:notebooks',
    gemFoldede: () => { gemt += 1; },
    tegnTrae: () => {},
    smalSkaerm: () => false,
    document: { querySelector: () => null },
    setTimeout: () => {},
  })(BOG);
  assert.equal(gemt, 0);
});

test('paa en telefon aabnes sidemenuen - ellers folder man en bog ud, man ikke kan se', () => {
  const klasser = [];
  const koer = (smal) => hent(p4, 'visBogITraeet', {
    editor: { foldede: new Set() },
    SEKTION_BOEGER: 'sektion:notebooks',
    gemFoldede: () => {},
    tegnTrae: () => {},
    smalSkaerm: () => smal,
    document: { body: { classList: { add: (k) => klasser.push(k) } }, querySelector: () => null },
    setTimeout: () => {},
  })(BOG);
  koer(false);
  assert.deepEqual(klasser, [], 'paa en bred skaerm staar menuen der i forvejen');
  koer(true);
  assert.deepEqual(klasser, ['navopen']);
});

test('der rulles KUN i sidebaren - aldrig i vinduet', () => {
  // `scrollIntoView()` tager vinduet med og kaster én ned i den note, man
  // staar i. Sidebaren har sin egen rullekasse.
  const k = krop(p4, 'visBogITraeet');
  assert.ok(!k.includes('scrollIntoView'), 'scrollIntoView ruller hele siden');
  assert.ok(!k.includes('window.scroll'), 'vinduet maa ikke flytte sig');
  assert.match(k, /skaerm\.scrollTop \+=/);
});

test('glimtet findes i CSS\'en og forsvinder igen', () => {
  assert.match(css, /\.tree-row\.fremhaevet \{[^}]*background: var\(--accent-soft\)/);
  assert.match(krop(p4, 'visBogITraeet'), /setTimeout\(\(\) => raekke\.classList\.remove\('fremhaevet'\)/);
});
