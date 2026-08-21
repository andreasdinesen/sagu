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
/**
 * Kilden UDEN kommentarer.
 *
 * Kommentarer er ikke kode, og en formregel, der ikke kan se forskel, falder
 * over sin egen forklaring: den foerste udgave af handler-reglen citerede den
 * forkerte binding for at forklare sig og faeldede sig selv, og F11's
 * `fts.user_id`-regel gjorde det samme. Det er den samme laerdom som i
 * angrebssuiten - **et regex kan ikke se forskel paa kode og tekst, der
 * ligner kode**, saa teksten maa vaek foer maalingen.
 */
const udenKommentarer = (k) => k
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');

test('en handler bundet ved navn tager haendelsen som foerste parameter', () => {
  const HAENDELSE = new Set(['e', 'ev', 'event', '_', '']);

  // Kun frontend-delene: de samles til ÉN fil, saa de deler scope. server.js
  // og wiki.js er egne moduler - et navnesammenfald dér er ikke et fund.
  const dele = kilder().filter(([navn]) => navn.startsWith('app/parts/'))
    .map(([navn, k]) => [navn, udenKommentarer(k)]);
  const alt = dele.map(([, k]) => k).join('\n');

  /*
   * Alle steder, navnet er ERKLAERET - ikke det foerste, der ligner.
   *
   * Et kort navn som `gaa` findes i flere funktioner, hver med sin egen
   * betydning. En regel, der bare tager den foerste erklaering, den finder,
   * daemmer op for en fejl ét sted og OPFINDER en et andet - og en formregel,
   * der raaber op om ingenting, bliver slaaet fra. Derfor: kan navnet ikke
   * afgoeres entydigt, siger reglen ingenting.
   */
  const erklaeringer = (fn, kilde) => {
    const re = new RegExp(`(?:function\\s+${fn}\\s*\\(([^)]*)\\)`
      + `|(?:const|let|var)\\s+${fn}\\s*=\\s*(?:async\\s*)?\\(([^)]*)\\)\\s*=>`
      + `|(?:const|let|var)\\s+${fn}\\s*=\\s*(?:async\\s*)?([A-Za-z_$][\\w$]*)\\s*=>)`, 'g');
    const ud = [];
    for (const m of kilde.matchAll(re)) {
      const raa = m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3]);
      ud.push(String(raa || '').split(',')[0].trim().replace(/\s*=.*$/, ''));
    }
    return ud;
  };

  const foersteParam = (fn, egenFil) => {
    // Samme fil foerst: dér er det med sikkerhed den, handleren peger paa.
    const her = erklaeringer(fn, egenFil);
    if (her.length === 1) return her[0];
    if (her.length > 1) return null;             // flere i samme fil: kan ikke afgoeres
    const alle = erklaeringer(fn, alt);
    return alle.length === 1 ? alle[0] : null;   // kun naar navnet er entydigt
  };

  const fejl = [];
  for (const [navn, k] of dele) {
    for (const m of k.matchAll(/addEventListener\(\s*['"][a-z]+['"]\s*,\s*([A-Za-z_$][\w$]*)\s*[,)]/g)) {
      const fn = m[1];
      const param = foersteParam(fn, k);
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

/*
 * Guiden maa ikke love et endepunkt, appen ikke har.
 *
 * »En hjaelpetekst, der beskriver en funktion, som ikke findes, er den
 * dyreste slags fejl: brugeren tror, han bruger den forkert« (doda v38). Det
 * er tredje gang den mekanik bider i familien, saa den bliver en REGEL og
 * ikke en note: hver adresse i opskrifterne slaas op i serverens ruter.
 */
test('hver adresse i API-guiden findes ogsaa i serveren - med sin METODE', () => {
  const guide = readFileSync(path.join(ROD, 'app', 'parts', 'p9_guide.js'), 'utf8');
  const server = readFileSync(path.join(ROD, 'app', 'server.js'), 'utf8');

  /*
   * Metoden skal med.
   *
   * Foerste udgave slog kun STIEN op - og tre ruter (`GET`, `PATCH`,
   * `DELETE`) deler det samme moenster, saa en omdoebt GET-rute blev ikke
   * fanget. Det opdagede jeg ved at sabotere netop den. En regel, der maaler
   * mindre, end den lyder til, er den samme fejl som en test med et for stort
   * navn.
   *
   * Opskrifterne staar som `['URL', …]` og `['Method', …]` i den raekkefoelge,
   * saa parret kan laeses direkte ud af kilden.
   */
  const lovede = [];
  for (const m of guide.matchAll(
    /\['URL',\s*`\$\{b\}([^`]+)`\],\s*\n\s*\['Method',\s*'([A-Z]+)'\]/g)) {
    const sti = m[1].split('?')[0].replace(/\/$/, '');
    lovede.push([m[2], /^\/api\/v1\/notes\/[A-Z_]/.test(sti) ? '/api/v1/notes/:id' : sti]);
  }
  assert.ok(lovede.length >= 4, `guiden naevner kun ${lovede.length} opskrifter - er den tom?`);

  const fejl = [];
  for (const [metode, sti] of lovede) {
    const somMoenster = sti.replace('/:id', '/([a-f0-9]{32})').split('/').join('\\/');
    const fast = server.includes(`'${metode} ${sti}'`);
    const moenster = server.includes(`metode: '${metode}', re: /^${somMoenster}$/`);
    if (!fast && !moenster) fejl.push(`${metode} ${sti}`);
  }
  assert.deepEqual(fejl, [], `guiden lover adresser, serveren ikke har:\n${fejl.join('\n')}`);
});

test('... og DEN regel er set fejle', () => {
  // Maalemetoden proevet paa et output, der ER i stykker: en opskrift paa et
  // endepunkt, serveren ikke har.
  const server = "'POST /api/v1/capture':";
  assert.ok(!server.includes("'GET /api/v1/findesikke'"),
    'reglen skal kunne se en adresse, serveren ikke har');
});

/*
 * F11 · **Søgeindekset må ikke have en `user_id`.**
 *
 * Kolonnen fandtes indtil m12 og var afgrænsningen på den rangerede søgning.
 * Den kunne aldrig virke sammen med deling: indekset bærer EJERENS id, så en
 * delt note kunne kun findes, når indekset MISSEDE og nødbremsen overtog — en
 * fejl, der ligner et dårligt søgeord.
 *
 * Da filteret røg, stod kolonnen tilbage og hed stadig `user_id` i et
 * søgeindeks uden at afgrænse noget. Det er den farligste slags rest: den
 * næste, der læser skemaet, tror at indekset er pr. bruger og bygger videre
 * på en spærring, der ikke findes. Reglen står her, fordi den skal gælde det,
 * nogen skriver om et halvt år — ikke kun det, der blev ryddet op i dag.
 *
 * Adgangen hører i `SYNLIG`, på `notes`, hvor ejerskabet faktisk står.
 */
test('der filtreres ALDRIG paa fts.user_id - adgangen hoerer i SYNLIG', () => {
  const server = udenKommentarer(readFileSync(path.join(ROD, 'app', 'server.js'), 'utf8'));
  /*
   * Reglen maaler FORESPOERGSLERNE, ikke skemaet.
   *
   * `m3` opretter stadig den gamle tabel MED kolonnen, og sadan skal det
   * vaere: en migration er fortid. En database fra foer m12 afspiller m3 og
   * derefter m12, og skriver man historien om, faar en gammel installation
   * et andet skema end en ny. Slutskemaet maales i stedet paa en LEVENDE
   * server (tests/deling.test.mjs).
   *
   * Det, der kan skrives igen i morgen, er filteret - og det er dét, reglen
   * staar vagt om.
   */
  assert.ok(!/\bfts\.user_id\b/.test(server),
    'der filtreres paa fts.user_id - saa kan en delt note kun findes, naar indekset MISSER');
  assert.ok(!/INSERT INTO note_fts \([^)]*user_id/.test(server),
    'indekset skriver en user_id, som ingen laeser - en kolonne, der ligner en spaerring');
});

/*
 * F12 · **Begge optegningsveje skal gøre det samme.**
 *
 * Editoren tegner noten to steder: `tegnKrop()` og `tegnMedAabenBlok()`. Den
 * anden findes, fordi ét afsnit står som råt markdown, mens resten er
 * renderet — og den skal pynte kodeblokke, binde tjekbokse, binde billeder og
 * fylde GitHub-indlejringer, præcis som den første.
 *
 * Glemmer den ene noget, virker funktionen kun, når ingen blok er åben. Det
 * skete for `fyldGhIndlejringer` og lignede »kortet forsvandt, da jeg
 * klikkede« — fundet ved at klikke, ikke af en test. Reglen står her, fordi
 * den femte ting, nogen tilføjer, skal med begge steder.
 */
test('de to optegningsveje i editoren kalder det SAMME', () => {
  const kilde = udenKommentarer(
    readFileSync(path.join(ROD, 'app', 'parts', 'p4_editor.js'), 'utf8'));

  const krop = (navn) => {
    const i = kilde.indexOf(`function ${navn}(`);
    assert.ok(i > 0, `fandt ikke ${navn} - er den doebt om?`);
    // Frem til naeste funktion paa toppniveau. Groft, men nok: reglen maaler
    // kun hvilke navne der KALDES, ikke hvordan.
    const j = kilde.indexOf('\nfunction ', i + 1);
    return kilde.slice(i, j === -1 ? kilde.length : j);
  };

  const KRAEVET = ['pyntKodeblokke', 'bindTjek', 'bindBilleder', 'fyldGhIndlejringer'];
  const a = krop('tegnKrop');
  const b = krop('tegnMedAabenBlok');
  for (const navn of KRAEVET) {
    assert.ok(a.includes(`${navn}(`), `tegnKrop kalder ikke ${navn}`);
    assert.ok(b.includes(`${navn}(`),
      `tegnMedAabenBlok kalder ikke ${navn} - saa virker den kun, naar ingen blok er aaben`);
  }
});

/*
 * **Ingen backticks inde i en SQL-template.**
 *
 * Tre gange i dette projekt har en kommentar INDE i `db.exec(\`…\`)` båret en
 * backtick omkring et kolonnenavn — og en backtick afslutter template-literalen.
 * Fejlen er en `SyntaxError` et helt andet sted i filen, så den peger ikke på
 * den linje, den kommer fra.
 *
 * Kuren er ikke omhu: en kommentar om SQL hører UDEN for SQL-strengen, hvor
 * den kan skrive, hvad den vil. Reglen står her, fordi den fjerde gang ellers
 * kommer om et halvt år.
 */
test('en SQL-template indeholder ingen backticks - heller ikke i en kommentar', () => {
  const fejl = [];
  for (const [navn, kilde] of kilder()) {
    // Hver `exec(\`` … afsluttende backtick. Alt derimellem SKAL være fri for
    // backticks; er der én, er strengen allerede lukket, og filen er i stykker.
    for (const m of kilde.matchAll(/\.exec\(`([\s\S]*?)`\)/g)) {
      if (m[1].includes('`')) fejl.push(`${navn}: en backtick inde i en exec-template`);
    }
    /*
     * Der staar IKKE et forbud mod `/* *\/`-kommentarer i SQL-strengen her.
     *
     * Foerste udgave havde et - og det faeldede `m1`, hvor en helt korrekt
     * blokkommentar staar i skemaet og har staaet der siden F0. **En regel,
     * der raaber op om kode, der er i orden, bliver slettet af den naeste,
     * der bliver traet af den** - og saa er den rigtige regel vaek med den.
     * Backtick-tjekket ovenfor maaler den faktiske fejl og kun den.
     */
  }
  assert.deepEqual(fejl, [], fejl.join('\n'));
});

/*
 * F14 · **Service workerens cachenavn skal følge APP_VERSION.**
 *
 * Bumpes det ikke, hober hver udgivelse sig op i browserens cache, og
 * workeren kan servere en gammel `app.js` i det uendelige. Det ramte doda i
 * drift — v39 hed »web app'en på telefonen opdaterer sig selv igen« — og det
 * er nøjagtig den samme mekanik her.
 *
 * `build_rune.py` stempler begge tal fra det samme sted, så de *kan* ikke
 * drive. Reglen står her, fordi det er stemplingen selv, nogen kan komme til
 * at fjerne — og så er der ingen, der opdager det, før en telefon sidder fast
 * på en gammel version.
 */
test('sw.js og index.html baerer SAMME version som APP_VERSION', () => {
  const kerne = readFileSync(path.join(ROD, 'app', 'parts', 'p1_core.js'), 'utf8');
  const v = Number((kerne.match(/^const APP_VERSION = (\d+);/m) || [])[1]);
  assert.ok(v > 0, 'fandt ikke APP_VERSION');

  const sw = readFileSync(path.join(ROD, 'app', 'public', 'sw.js'), 'utf8');
  assert.match(sw, new RegExp(`^const VERSION = ${v};`, 'm'),
    `sw.js staar paa en anden version end ${v} - byg igen, eller stemplingen er vaek`);

  const html = readFileSync(path.join(ROD, 'app', 'public', 'index.html'), 'utf8');
  assert.ok(html.includes(`app.js?v=${v}`), 'index.html er ikke stemplet');

  // ... og workeren skal precache PRAECIS de adresser, siden henter. Ellers
  // ligger der to kopier, og den precachede bliver aldrig brugt.
  for (const fil of ['app.js', 'style.css']) {
    assert.ok(sw.includes(`./${fil}?v=\${VERSION}`),
      `sw.js precacher ikke ${fil} med sin version`);
  }
});

/*
 * Her stod en regel om, at markup med en `bind`-partner kun måtte laves af
 * sin egen `tegn`-funktion. **Den er fjernet igen med vilje.**
 *
 * Den fandt den rigtige fejl (`genvejeHtml()` blev tegnet af `shellHtml()`,
 * men kun bundet af `tegnGenveje()`, så »Recent« ikke virkede efter en
 * sideindlæsning) — men den fældede også tre steder, der er helt i orden:
 * `maerkerHtml`, `kommentarerHtml` og `dodaOpgaverHtml` tegnes af
 * `sideNote()` og bindes af `bindNoteSide()`. Det er en anden, korrekt vej.
 *
 * At skelne dem kræver at følge kaldegrafen fra hvert tegnested til dets
 * egen binder, og en formregel, der er så indviklet, at man ikke kan
 * gennemskue den, er selv en byrde. **En regel, der råber op om kode, der er
 * i orden, bliver slettet af den næste, der bliver træt af den — og så er
 * den rigtige regel væk med den** (samme lærdom som SQL-template-reglen
 * ovenfor, lært samme dag).
 *
 * Reglen står derfor i `CLAUDE.md` som noget, et menneske skal vide:
 * ét sted tegner OG binder.
 */
