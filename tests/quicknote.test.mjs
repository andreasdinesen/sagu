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

function koer(platform) {
  const lyttere = [];
  const kald = [];
  const felt = { tagName: 'TEXTAREA', isContentEditable: false };
  const ctx = {
    window: { navigator: { platform }, addEventListener: () => {} },
    document: {
      addEventListener: (type, f) => { if (type === 'keydown') lyttere.push(f); },
      querySelector: () => null,
      activeElement: felt,
      getElementById: () => null,
    },
    state: { user: { id: 1 }, view: 'note' },
    opretOgAaben: (f) => kald.push(f),
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
  return { tast, kald, vis: vm.runInContext('GENVEJE', ctx) };
}

test('Mac: Cmd+Option+N laver en note - ogsaa mens man skriver i et felt', () => {
  const { tast, kald } = koer('MacIntel');
  // Option+N er doed-tasten paa en Mac, saa `key` er IKKE 'n'.
  assert.equal(tast({ key: '˜', code: 'KeyN', metaKey: true, altKey: true }), true);
  assert.equal(kald.length, 1);
});

test('Mac: Ctrl+Option+N roeres ikke (VoiceOvers tast)', () => {
  const { tast, kald } = koer('MacIntel');
  assert.equal(tast({ key: '˜', code: 'KeyN', ctrlKey: true, altKey: true }), false);
  assert.equal(kald.length, 0);
});

test('Windows: Ctrl+Alt+N laver en note', () => {
  const { tast, kald } = koer('Win32');
  assert.equal(tast({ key: 'n', code: 'KeyN', ctrlKey: true, altKey: true }), true);
  assert.equal(kald.length, 1);
});

test('Ctrl/Cmd+N alene er stadig browserens (nyt vindue)', () => {
  for (const p of ['MacIntel', 'Win32']) {
    const { tast, kald } = koer(p);
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
