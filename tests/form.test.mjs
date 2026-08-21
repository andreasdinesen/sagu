/*
 * FORMREGLER paa frontend-kilden.
 *
 * Ikke hvad koden GOER, men hvordan den er skrevet. Baggrunden er den
 * dyreste slags fejl: en dokumenteret faelde, der kommer igen.
 *
 * `.meta` i designsystemet er en VERSAL ETIKET (`text-transform: uppercase`),
 * ikke en tekstklasse - den er til »3 OPEN«, ikke til saetninger. Loggen i
 * RUNE-ERFARINGER har den to gange (tools v1 og tools v2), og under F6 skrev
 * jeg den TRE gange mere: et afsnitsnavn blev til »§ VPN-ADGANG« og et
 * adresse-praefiks til »HTTP://LOCALHOST:8919/W/« - en adresse, der ikke
 * findes.
 *
 * tools v2's konklusion er reglen her: **naar en fejl er dokumenteret og
 * alligevel kommer igen, saa er noten ikke svaret.** En note virker kun,
 * mens man husker at laese den; en formregel gaelder ogsaa det, man skriver
 * om et halvt aar.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function kilder() {
  const ud = [];
  const dele = path.join(ROD, 'app', 'parts');
  for (const navn of readdirSync(dele)) {
    if (navn.endsWith('.js')) ud.push([`app/parts/${navn}`, readFileSync(path.join(dele, navn), 'utf8')]);
  }
  for (const navn of ['wiki.js', 'server.js']) {
    ud.push([`app/${navn}`, readFileSync(path.join(ROD, 'app', navn), 'utf8')]);
  }
  return ud;
}

/**
 * Alt indhold i et element med klassen `meta` - uden undtagelserne.
 *
 * Undtagelserne er dem, CSS'en selv gør læsbare: `<p class="meta">`,
 * `<li class="meta">` og `class="meta saetning"`.
 */
function metaIndhold(kode) {
  const fund = [];
  const re = /<(\w+)([^>]*?)class="meta"([^>]*)>([\s\S]{0,400}?)<\/\1>/g;
  for (const m of kode.matchAll(re)) {
    const tag = m[1].toLowerCase();
    if (tag === 'p' || tag === 'li') continue;
    fund.push({ tag, indhold: m[4] });
  }
  return fund;
}

test('`.meta` bruges kun til ETIKETTER - aldrig til prosa eller en adresse', () => {
  const synder = [];
  for (const [navn, kode] of kilder()) {
    for (const f of metaIndhold(kode)) {
      const tekst = f.indhold;
      // En adresse i versaler er en adresse, der ikke findes.
      if (/:\/\/|location\.origin|\/w\/|\.dk|\.com/.test(tekst)) {
        synder.push(`${navn}: adresse i .meta -> ${tekst.trim().slice(0, 70)}`);
        continue;
      }
      // Prosa: den rene tekst uden skabelon-udtryk.
      const ren = tekst.replace(/\$\{[^}]*\}/g, '').replace(/\s+/g, ' ').trim();
      const ord = ren ? ren.split(' ').filter(Boolean).length : 0;
      if (ren.length > 45 || ord > 7) {
        synder.push(`${navn}: saetning i .meta -> ${ren.slice(0, 70)}`);
      }
    }
  }
  assert.deepEqual(synder, [],
    'brug <p class="meta">, <li class="meta"> eller class="meta saetning" til tekst, '
    + 'og en egen klasse til en adresse');
});

test('... og CSS en HAR de undtagelser, reglen ovenfor bygger paa', () => {
  // Uden denne beviser den foerste test ingenting: den ville bare kraeve, at
  // man skriver en klasse, der ikke goer noget.
  const css = readFileSync(path.join(ROD, 'app', 'public', 'style.css'), 'utf8');
  assert.match(css, /\.meta\s*\{[^}]*text-transform:\s*uppercase/,
    '.meta skal faktisk VAERE en versal etiket - ellers er der ingen faelde at undgaa');
  assert.match(css, /p\.meta,\s*li\.meta,\s*\.meta\.saetning\s*\{[^}]*text-transform:\s*none/,
    'de tre undtagelser skal findes i CSS en');
});

test('maalemetoden er set fejle - et ODELAGT eksempel skal fanges', () => {
  // En test, man ikke har set fejle paa den rigtige maade, er en formodning
  // (RUNE-ERFARINGER, tovo F2).
  const ondt = '<span class="meta">${esc(location.origin)}/w/</span>'
    + '<span class="meta">This is a whole sentence that has no business being in versals at all</span>'
    + '<p class="meta">Denne er i orden, fordi den staar i et p og derfor er undtaget i CSS en.</p>';
  const fundne = metaIndhold(ondt);
  assert.equal(fundne.length, 2, 'kun de to span skal fanges - p er undtaget');
  assert.match(fundne[0].indhold, /location\.origin/);
});

/*
 * Fejlsvarenes FORM (doda v18, allerede en regel i DESIGN.md).
 *
 * En test pr. rute laaser kun det, du allerede har skrevet ned; formreglen
 * fanger ogsaa den rute, nogen tilfoejer om et halvt aar. Den staar her
 * sammen med de andre formregler frem for i f0-testen, saa der er ét sted at
 * lede efter »regler om hvordan koden ser ud«.
 */
test('hver apiFejl har en maskinkode og en saetning til mennesket', () => {
  const kode = readFileSync(path.join(ROD, 'app', 'server.js'), 'utf8');
  const synder = [];
  for (const m of kode.matchAll(/apiFejl\(\s*res,\s*(\d{3}),\s*'([^']*)',\s*(?:'([^']*)'|"([^"]*)")/g)) {
    const [, , kodeOrd, besked1, besked2] = m;
    const besked = besked1 || besked2 || '';
    if (!/^[a-z][a-z0-9_]*$/.test(kodeOrd)) synder.push(`koden "${kodeOrd}" kan en klient ikke forgrene paa`);
    if (!besked || besked.length < 8) synder.push(`"${kodeOrd}" mangler en saetning`);
    if (besked.toLowerCase().replace(/[^a-z]/g, '') === kodeOrd.replace(/_/g, '')) {
      synder.push(`"${kodeOrd}" gentager bare koden`);
    }
  }
  assert.deepEqual(synder, []);
});

/*
 * En haendelses-handler, der er bundet VED NAVN, faar haendelsen som sit
 * foerste argument.
 *
 * `udgiv.addEventListener('click', visUdgivPanel)` ser rigtigt ud og er det
 * ikke: `visUdgivPanel(maal)` fik en MouseEvent som `maal`. Den er SAND, saa
 * ingen vagt slog til - ruden viste en overskrift uden titel og kunne
 * derefter aldrig finde notens eksisterende udgivelse, fordi opslaget skete
 * paa `undefined`. Symptomet var »knappen aabner den forkerte rude«, og det
 * peger et helt andet sted hen end aarsagen.
 *
 * Reglen fanger hele klassen: bindes en funktion ved navn, skal dens foerste
 * parameter vaere haendelsen. Vil man binde noget andet, skal der staa en
 * pilefunktion, saa det er SYNLIGT, at argumentet er valgt.
 */
test('en handler bundet ved navn tager haendelsen som foerste parameter', () => {
  const HAENDELSE = new Set(['e', 'ev', 'event', '_', '']);

  // Kommentarer er ikke kode. Uden det her faldt reglen over sin EGEN
  // advarsel, som citerer den forkerte binding for at forklare den.
  const udenKommentarer = (k) => k
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map((l) => l.replace(/(^|[^:'"\`])\/\/.*$/, '$1')).join('\n');

  // Kun frontend-delene: de samles til ÉN fil, saa de deler scope. server.js
  // og wiki.js er egne moduler - et navnesammenfald dér er ikke et fund.
  const dele = kilder().filter(([navn]) => navn.startsWith('app/parts/'))
    .map(([navn, k]) => [navn, udenKommentarer(k)]);
  const alt = dele.map(([, k]) => k).join('\n');

  const foersteParam = (fn) => {
    const m = new RegExp(`(?:function\\s+${fn}\\s*\\(([^)]*)\\)`
      + `|(?:const|let|var)\\s+${fn}\\s*=\\s*(?:async\\s*)?\\(([^)]*)\\)\\s*=>`
      + `|(?:const|let|var)\\s+${fn}\\s*=\\s*(?:async\\s*)?([A-Za-z_$][\\w$]*)\\s*=>)`).exec(alt);
    if (!m) return null;
    const raa = m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3]);
    return String(raa || '').split(',')[0].trim().replace(/\s*=.*$/, '');
  };

  const fejl = [];
  for (const [navn, k] of dele) {
    for (const m of k.matchAll(/addEventListener\(\s*['"][a-z]+['"]\s*,\s*([A-Za-z_$][\w$]*)\s*[,)]/g)) {
      const fn = m[1];
      const param = foersteParam(fn);
      if (param === null) continue;                    // ikke vores egen funktion
      if (!HAENDELSE.has(param)) {
        fejl.push(`${navn}: addEventListener(..., ${fn}) - men ${fn}(${param}) forventer ikke en haendelse`);
      }
    }
  }
  assert.deepEqual(fejl, [], fejl.join('\n'));
});

test('... og DEN regel er set fejle', () => {
  // Maalemetoden skal selv proeves: giv den et stykke kode, der ER i stykker,
  // og se at den fanger det (Sagu F1's regel om angrebssuiten).
  const ondt = "function visRude(maal) {}\nknap.addEventListener('click', visRude);";
  const fundet = [...ondt.matchAll(/addEventListener\(\s*['"][a-z]+['"]\s*,\s*([A-Za-z_$][\w$]*)\s*[,)]/g)]
    .map((m) => new RegExp(`function\\s+${m[1]}\\s*\\(([^)]*)\\)`).exec(ondt)[1]);
  assert.deepEqual(fundet, ['maal'], 'reglen skal kunne se en handler med et andet foerste argument');
});
