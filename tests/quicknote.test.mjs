/*
 * Quicknote: Cmd+Option+N (Mac) / Ctrl+Alt+N (Windows) laver en ny note
 * HVOR SOM HELST - ogsaa midt i en saetning i en anden note.
 *
 * Genvejene bor i fladen og kan ikke importeres, saa p12 koeres i en vm med
 * en attrap af `document` og fanger den globale keydown-handler.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const p12 = readFileSync(new URL('../app/parts/p12_polering.js', import.meta.url), 'utf8');

function koer(platform, boeger = []) {
  const lyttere = [];
  const kald = [];
  const api = [];
  const felt = { tagName: 'TEXTAREA', isContentEditable: false };
  const ctx = {
    window: { navigator: { platform }, addEventListener: () => {} },
    document: {
      addEventListener: (type, f) => { if (type === 'keydown') lyttere.push(f); },
      querySelector: () => null,
      activeElement: felt,
      getElementById: () => null,
    },
    state: { user: { id: 1 }, view: 'note', notebooks: boeger },
    opretOgAaben: async (f, v) => { kald.push({ f, v }); },
    api: async (metode, sti, krop) => {
      api.push({ metode, sti, krop });
      const b = { id: 'ny' + api.length, name: krop.name };
      boeger.push(b);
      return { notebook: b };
    },
    toast: (t) => { throw new Error(t); },
    console, setInterval: () => 0, setTimeout: () => 0,
  };
  vm.createContext(ctx);
  vm.runInContext(p12, ctx);
  const tast = (e) => {
    let stoppet = false;
    const ev = Object.assign({ key: '', code: '', metaKey: false, ctrlKey: false, altKey: false,
      shiftKey: false, target: felt, preventDefault: () => { stoppet = true; } }, e);
    for (const f of lyttere) f(ev);
    return stoppet;
  };
  const koerI = (kode) => vm.runInContext(kode, ctx);
  return { tast, kald, api, koerI, vis: vm.runInContext('GENVEJE', ctx) };
}

test('Mac: Cmd+Option+N laver en note - ogsaa mens man skriver i et felt', () => {
  const { tast, api: kald } = koer('MacIntel');
  // Option+N er doed-tasten paa en Mac, saa `key` er IKKE 'n'.
  assert.equal(tast({ key: '˜', code: 'KeyN', metaKey: true, altKey: true }), true);
  assert.equal(kald.length, 1);
});

test('quicknoten faar dato og klokkeslaet i titlen', () => {
  const { koerI } = koer('MacIntel');
  assert.equal(koerI('quicknoteTitel(new Date(2026, 9, 1, 8, 5))'), 'Quicknote - 2026-10-01 08:05');
});

test('foerste quicknote opretter »Quicknotes«, de naeste genbruger den', async () => {
  const { koerI, kald, api } = koer('MacIntel');
  await koerI('opretQuicknote()');
  await koerI('opretQuicknote()');
  assert.equal(api.length, 1, 'bogen maa kun oprettes én gang');
  assert.deepEqual({ ...api[0].krop }, { name: 'Quicknotes' });
  assert.equal(kald.length, 2);
  for (const k of kald) {
    assert.equal(k.f.notebookId, 'ny1');
    assert.match(k.f.title, /^Quicknote - \d{4}-\d\d-\d\d \d\d:\d\d$/);
    assert.deepEqual({ ...k.v }, { iTeksten: true }, 'markoeren skal staa i teksten, ikke i titlen');
  }
});

test('en eksisterende bog findes uanset store og smaa bogstaver', async () => {
  const { koerI, kald, api } = koer('MacIntel', [{ id: 'b1', name: 'quicknotes' }]);
  await koerI('opretQuicknote()');
  assert.equal(api.length, 0);
  assert.equal(kald[0].f.notebookId, 'b1');
});

test('to hurtige tryk laver ikke to boeger', async () => {
  const { koerI, api } = koer('MacIntel');
  await Promise.all([koerI('opretQuicknote()'), koerI('opretQuicknote()')]);
  assert.equal(api.length, 1);
});

test('Mac: Ctrl+Option+N roeres ikke (VoiceOvers tast)', () => {
  const { tast, api: kald } = koer('MacIntel');
  assert.equal(tast({ key: '˜', code: 'KeyN', ctrlKey: true, altKey: true }), false);
  assert.equal(kald.length, 0);
});

test('Windows: Ctrl+Alt+N laver en note', () => {
  const { tast, api: kald } = koer('Win32');
  assert.equal(tast({ key: 'n', code: 'KeyN', ctrlKey: true, altKey: true }), true);
  assert.equal(kald.length, 1);
});

test('Ctrl/Cmd+N alene er stadig browserens (nyt vindue)', () => {
  for (const p of ['MacIntel', 'Win32']) {
    const { tast, api: kald } = koer(p);
    assert.equal(tast({ key: 'n', code: 'KeyN', metaKey: p === 'MacIntel', ctrlKey: p !== 'MacIntel' }), false);
    assert.equal(kald.length, 0);
  }
});

test('Ctrl+Alt+andet bogstav (AltGr) aeder ikke tegnet', () => {
  const { tast } = koer('Win32');
  // AltGr+2 = @ paa et dansk tastatur.
  assert.equal(tast({ key: '@', code: 'Digit2', ctrlKey: true, altKey: true }), false);
});

test('quicknoten staar i oversigten med tastaturets egne navne', () => {
  assert.ok(koer('MacIntel').vis.some((g) => g.vis === '⌘⌥N'));
  assert.ok(koer('Win32').vis.some((g) => g.vis === 'Ctrl+Alt+N'));
});
