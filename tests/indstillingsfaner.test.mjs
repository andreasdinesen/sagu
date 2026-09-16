/*
 * §9f - faner i indstillingerne: intet må falde ud.
 *
 * Opdelingen flyttede seksten afsnit rundt i én stor skabelon, og et afsnit,
 * der ryger ud ved et uheld, ser ud som ingenting: ingen fejl, bare en side
 * med et hul. RUNE-ERFARINGER §9f beder derfor om to målinger, og de står her:
 *
 *  1. **Tæl afsnittene** - fane for fane, med navn.
 *  2. **Hvert id, `bindSettings()` slår op, står INDE i en fane.** Fanerne
 *     skjuler med `hidden`; de udelader intet. Et felt uden for enhver fane
 *     står enten fremme på alle faner eller mangler helt - og binder man til
 *     et id, der ikke er tegnet, sker der ingenting, når man trykker.
 *
 * ── Hvorfor den RIGTIGE sideSettings() køres ──────────────────────────────
 *
 * Skabelonen er fuld af `${...}`-afsnit, der kun tegnes under betingelser
 * (administrator, forbundet doda, en nyere server). En tekstsøgning i kilden
 * ville tælle dem, uanset hvor de havnede. Her hentes funktionen UD AF KILDEN
 * og køres med data, der tænder hver eneste betingelse - så det, der tælles,
 * er den HTML, en administrator faktisk får.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const p2 = readFileSync(new URL('../app/parts/p2_pages.js', import.meta.url), 'utf8');
const p1 = readFileSync(new URL('../app/parts/p1_core.js', import.meta.url), 'utf8');

/** Én topniveau-erklæring (funktion eller const) ud af kilden - til den afsluttende kolonne-0-klamme. */
function uddrag(kilde, start) {
  const i = kilde.search(new RegExp(`^${start.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm'));
  assert.ok(i > -1, `${start} findes ikke laengere - ret proeven`);
  const slut = kilde.slice(i).search(/^[}\]][;]?$/m);
  return kilde.slice(i, i + slut).concat(kilde.slice(i + slut).match(/^[^\n]*/)[0]);
}

/** Det, fanen hedder, og de afsnit, den skal have - i den orden, de står. */
const FORVENTET = {
  konto: ['Appearance', 'Account', 'Passkeys', 'Two-step verification', 'About'],
  skrivning: ['Editing', 'Version history'],
  filer: ['Files', 'Published pages'],
  broer: ['doda', 'GitHub', 'Save to Sagu'],
  noegler: ['Access keys', 'Connected apps'],
  server: ['Public address', 'Server'],
};

/** Svar, der tænder hver betingelse i skabelonen. */
const SVAR = {
  '/api/v1/keys': { keys: [{ id: 'k1', name: 'Genvej', scope: 'capture', last_used_at: null }] },
  '/api/v1/passkeys': { passkeys: [{ id: 'p1', name: 'Mac', created_at: 1, last_used_at: null }] },
  '/api/v1/admin': {
    allowRegistration: true,
    storageQuota: 1024 ** 3,
    storageMest: 10,
    users: [{ id: 'u1', username: 'admin', isAdmin: true, createdAt: 1 },
      { id: 'u2', username: 'bruger', isAdmin: false, createdAt: 2 }],
  },
  '/api/v1/doda': { connected: true, url: 'https://doda.eksempel.invalid', tasks: 2 },
  '/api/v1/github/status': { connected: true, login: 'eksempel' },
};

async function tegnSiden() {
  const kilde = [
    uddrag(p1, 'function esc('),
    uddrag(p2, 'const FANER = ['),
    uddrag(p2, 'const SCOPES = ['),
    uddrag(p2, 'function scopeNavn('),
    uddrag(p2, 'function laesFane('),
    uddrag(p2, 'function aktivFane('),
    uddrag(p2, 'function fanebarHtml('),
    uddrag(p2, 'async function sideSettings('),
    'sideSettings();',
  ].join('\n');
  const ctx = vm.createContext({
    state: {
      user: { id: 'u1', username: 'admin', isAdmin: true },
      config: { passkeys: true, secureContext: true, version: 999999 },
      publicUrl: 'https://sagu.eksempel.invalid',
      prefs: { editWhole: false },
      storage: { used: 1, quota: 2, maxFile: 1 },
      notebooks: [{ name: 'Bog' }],
    },
    api: async (metode, sti) => {
      assert.ok(SVAR[sti], `sideSettings kalder ${sti} - giv proeven et svar`);
      return SVAR[sti];
    },
    APP_VERSION: 1,
    location: { origin: 'http://127.0.0.1' },
    localStorage: { getItem: () => null, setItem() {} },
    nuvaerendeTema: () => 'auto',
    pentBruger: String,
    visTid: String,
    visStoerrelse: String,
    icon: () => '',
    offentligBase: () => 'https://sagu.eksempel.invalid',
  });
  return vm.runInContext(kilde, ctx);
}

/** Fanerne i HTML'en: [{ fane, krop }] - og hvad der står UDEN FOR dem. */
function delOp(html) {
  const faner = [];
  const udenfor = html.replace(/<section class="fane" data-fane="([^"]+)">([\s\S]*?)<\/section>/g,
    (_, fane, krop) => { faner.push({ fane, krop }); return ''; });
  return { faner, udenfor };
}

const overskrifter = (html) => [...html.matchAll(/<h2>([^<]*)<\/h2>/g)].map((m) => m[1]);

test('hver fane har sine afsnit - alle seksten, med navn', async () => {
  const { faner, udenfor } = delOp(await tegnSiden());
  const faktisk = Object.fromEntries(faner.map((f) => [f.fane, overskrifter(f.krop)]));
  assert.deepEqual(faktisk, FORVENTET);
  assert.equal(Object.values(faktisk).flat().length, 16);
  assert.deepEqual(overskrifter(udenfor), [], 'et afsnit uden for enhver fane staar fremme paa dem alle');
});

test('fanerne i bjaelken og sektionerne i siden er de SAMME', async () => {
  const html = await tegnSiden();
  const knapper = [...html.matchAll(/data-fane-knap="([^"]+)"/g)].map((m) => m[1]);
  const sektioner = delOp(html).faner.map((f) => f.fane);
  assert.deepEqual(knapper, sektioner, 'en knap uden sektion viser en tom side');
  assert.equal(new Set(sektioner).size, sektioner.length, 'ingen fane to gange');
});

test('hvert id, bindSettings() slår op, ligger INDE i en fane', async () => {
  const { faner, udenfor } = delOp(await tegnSiden());
  const binder = uddrag(p2, 'function bindSettings(');
  const ider = [...new Set([...binder.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]))];
  assert.ok(ider.length >= 25, `fandt kun ${ider.length} bindinger - er maalingen i stykker?`);

  const fejl = [];
  for (const id of ider) {
    const hvor = faner.filter((f) => f.krop.includes(`id="${id}"`)).map((f) => f.fane);
    if (udenfor.includes(`id="${id}"`)) fejl.push(`${id}: staar UDEN FOR fanerne`);
    else if (hvor.length !== 1) fejl.push(`${id}: ${hvor.length ? `i ${hvor.join(' og ')}` : 'tegnes slet ikke'}`);
  }
  assert.deepEqual(fejl, [], fejl.join('\n'));

  // Og de bindinger, der sker paa en data-attribut, rammer ogsaa noget i en fane.
  for (const attr of ['data-tema', 'data-nulstil', 'data-noegleslet', 'data-pkslet']) {
    assert.ok(binder.includes(`[${attr}]`), `${attr} bindes ikke laengere - ret proeven`);
    assert.ok(faner.some((f) => f.krop.includes(`${attr}="`)), `${attr} tegnes ikke i nogen fane`);
    assert.ok(!udenfor.includes(`${attr}="`), `${attr} staar uden for fanerne`);
  }
});
