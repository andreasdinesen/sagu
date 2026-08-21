/*
 * XSS-suiten mod markdown-rendereren.
 *
 * Koeres i HVER fase, der roerer rendereren eller importerer indhold
 * (CLAUDE.md, risiko R4): F1, F3, F5 og F6. Sagu renderer fremmed markdown paa
 * et OFFENTLIGT domaene - fra en Notion-import, et API-kald, en MCP-klient og
 * senere fra »foreslaa en rettelse« i wikien.
 *
 * Testen maaler paa RESULTATET, ikke paa kilden: der ledes efter script-tags,
 * on*-attributter og ikke-http hrefs i det producerede HTML. En test, der kun
 * tjekker at en bestemt streng blev escaped, beviser kun det ene angreb.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tags } from './hjaelp.mjs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const md = require(path.join(ROD, 'app', 'shared', 'markdown.js'));

/* ------------------------------------------------------------- angreb */

const ANGREB = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<iframe src="javascript:alert(1)"></iframe>',
  '<svg/onload=alert(1)>',
  '<body onload=alert(1)>',
  '[klik](javascript:alert(1))',
  '[klik](JaVaScRiPt:alert(1))',
  '[klik](java\tscript:alert(1))',
  '[klik](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
  '[klik](vbscript:msgbox(1))',
  '[klik](  javascript:alert(1)  )',
  '![" onerror="alert(1)](https://x.dk/a.png)',
  '[" onmouseover="alert(1)](https://ok.dk)',
  'https://ok.dk" onmouseover="alert(1)',
  '`<b onmouseover=alert(1)>kode</b>`',
  '**[x](javascript:alert(1))**',
  '> <script>alert(1)</script>',
  '- <img src=x onerror=alert(1)>',
  '# <script>alert(1)</script>',
  '```\n<script>alert(1)</script>\n```',
  '[[<script>alert(1)</script>]]',
  '<a href="https://ok.dk" onclick="alert(1)">x</a>',
  '<<script>script>alert(1)<</script>/script>',
  '&lt;script&gt;alert(1)&lt;/script&gt;',
  '<style>body{background:url(javascript:alert(1))}</style>',
  '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
  '<base href="https://ondt.dk/">',
  '<form action="https://ondt.dk"><input name=x></form>',
  '<object data="javascript:alert(1)"></object>',
  '<details open ontoggle=alert(1)>',
  '[x](https://ok.dk/a"onmouseover="alert(1))',
  '*<script>alert(1)</script>*',
  // F3: billeder, tabeller, tjeklister og callouts
  '![billede](javascript:alert(1))',
  '![x](data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+)',
  '![" onerror="alert(1)](https://x.dk/a.png)',
  '![alt](https://x.dk/a.png" onload="alert(1))',
  '| <script>alert(1)</script> | x |\n|---|---|\n| a | b |',
  '| a | b |\n|---|---|\n| <img src=x onerror=alert(1)> | y |',
  '- [ ] <script>alert(1)</script>',
  '- [x] <img src=x onerror=alert(1)>',
  '> [!NOTE]\n> <script>alert(1)</script>',
  '> [!<script>alert(1)</script>]',
];

/*
 * Kun de tags, rendereren SELV udsteder. Alt andet er en fejl.
 *
 * Hvidliste frem for sortliste: en liste over farlige tags fanger dem, nogen
 * har taenkt paa. Den her faelder ogsaa paa et tag, ingen har opfundet endnu.
 */
const VORES_TAGS = new Set(['p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'em', 'del', 'code', 'pre', 'blockquote', 'hr', 'ul', 'ol', 'li',
  'a', 'div', 'span',
  // F3
  'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'button']);

test('ingen af angrebene producerer et tag, vi ikke selv har skrevet', () => {
  for (const ondt of ANGREB) {
    const { html } = md.render(ondt);
    const fundne = tags(html);

    for (const t of fundne) {
      // 1. Kun vores egne elementer. Hvidliste, ikke sortliste.
      assert.ok(VORES_TAGS.has(t.navn),
        `<${t.navn}> er ikke et tag, rendereren udsteder:\n  ${ondt}\n  -> ${html}`);

      for (const a of t.attributter) {
        // 2. Ingen haendelses-attributter overhovedet - ogsaa dem, ingen har
        //    opfundet endnu.
        assert.ok(!/^on/.test(a.navn),
          `attributten ${a.navn} paa <${t.navn}>:\n  ${ondt}\n  -> ${t.raa}`);
        // 3. Alt der peger et sted hen, peger et http(s)-sted hen.
        if (['href', 'src', 'action', 'formaction', 'data', 'xlink:href'].includes(a.navn)) {
          assert.match(a.vaerdi, /^https?:\/\/|^\/[^/]/,
            `${a.navn}="${a.vaerdi}" er hverken http(s) eller en intern sti:\n  ${ondt}`);
        }
      }
    }

    // 4. Og til sidst det groveste net: der maa ikke staa "<script" nogen
    //    steder i det raa output, heller ikke i en attributvaerdi.
    assert.ok(!/<script/i.test(html), `raa <script i output:\n  ${ondt}\n  -> ${html}`);
  }
});

test('testens egen maalemetode virker - en ondsindet renderer ville FEJLE', () => {
  // En sikkerhedstest, man ikke har set fejle, er en formodning. Her er et
  // output, der ER i stykker; finder tags() ikke det, beviser suiten intet.
  const ondt = '<p>x <img src="x" onerror="alert(1)"> <a href="javascript:alert(1)">y</a></p>';
  const fundne = tags(ondt);
  assert.ok(fundne.some((t) => t.navn === 'img'), 'tags() skal se <img>');
  assert.ok(fundne.some((t) => t.attributter.some((a) => a.navn === 'onerror')),
    'tags() skal se onerror');
  assert.ok(fundne.some((t) => t.attributter.some((a) => a.navn === 'href' && /^javascript:/.test(a.vaerdi))),
    'tags() skal se et javascript:-href');
});

test('angreb i en KODEBLOK bliver til synlig tekst, ikke til opmaerkning', () => {
  const { html } = md.render('```html\n<script>alert(1)</script>\n```');
  assert.match(html, /&lt;script&gt;/, 'indholdet skal vaere escaped og LAESBART');
  assert.ok(!/<script/i.test(html));
  // Sproget bliver en klasse, saa F3 kan haenge et maerke og en kopier-knap
  // paa den - uden at roere indholdet.
  assert.match(html, /class="language-html"/);
});

test('escaping mellem tags og escaping i en ATTRIBUT er to forskellige ting', () => {
  // `esc` tager &, < og > - anfoerselstegn er harmloese mellem tags. Inde i en
  // attribut lukker de den, og det er hele forskellen.
  assert.equal(md.esc('a "b" <c>'), 'a "b" &lt;c&gt;');
  assert.equal(md.attr('a "b" <c>'), 'a &quot;b&quot; &lt;c&gt;');
});

test('sikkerUrl er en HVIDLISTE, ikke en sortliste', () => {
  for (const ok of ['https://dr.dk', 'http://192.168.1.5:8080/x?y=1#z']) {
    assert.equal(md.sikkerUrl(ok), ok, `${ok} skulle vaere tilladt`);
  }
  for (const nej of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,x',
    'vbscript:x', 'file:///etc/passwd', '//evil.dk', 'https://ok.dk" onload="x',
    ' javascript:alert(1)', 'java\tscript:alert(1)', '']) {
    assert.equal(md.sikkerUrl(nej), null, `${nej} skulle vaere afvist`);
  }
});

/* ------------------------------------------------- at den faktisk RENDERER */

test('de blokke, F1 lover, virker', () => {
  const { html } = md.render([
    '# Overskrift',
    '',
    'Et afsnit med **fed**, *kursiv*, ~~streget~~ og `kode`.',
    '',
    '## Underoverskrift',
    '',
    '- punkt et',
    '- punkt to',
    '  - indrykket',
    '',
    '1. foerste',
    '2. anden',
    '',
    '> et citat',
    '',
    '---',
    '',
    '```js',
    'const x = 1;',
    '```',
  ].join('\n'));

  assert.match(html, /<h1 id="overskrift"[^>]*>Overskrift<\/h1>/);
  assert.match(html, /<h2 id="underoverskrift"/);
  assert.match(html, /<strong>fed<\/strong>/);
  assert.match(html, /<em>kursiv<\/em>/);
  assert.match(html, /<del>streget<\/del>/);
  assert.match(html, /<code>kode<\/code>/);
  assert.match(html, /<ul><li>punkt et<\/li><li>punkt to<ul><li>indrykket/);
  assert.match(html, /<ol><li>foerste<\/li><li>anden<\/li><\/ol>/);
  assert.match(html, /<blockquote[^>]*>et citat<\/blockquote>/);
  assert.match(html, /<hr[^>]*>/);
  assert.match(html, /<pre[^>]*><code class="language-js">const x = 1;<\/code><\/pre>/);
});

test('HVER linje bliver praecis én linje - markdown maa ikke ombryde det, nogen skrev', () => {
  // Almindelig markdown slaar fortloebende linjer sammen til ét afsnit. Her
  // maa den ikke: personen skrev tre linjer og forventer tre tilbage. En
  // editor, der stiltiende ombryder, er en editor man holder op med at stole paa.
  const { html } = md.render('foerste linje\nanden linje\ntredje linje');
  assert.match(html, /foerste linje<br>anden linje<br>tredje linje/);
  assert.equal((html.match(/<p/g) || []).length, 1, 'det er ÉT afsnit med tre linjer');
});

test('overskrifter faar unikke id\'er, saa et deep-link peger ét sted hen', () => {
  const { overskrifter, html } = md.render('## Drift\n\ntekst\n\n## Drift\n\nmere');
  assert.deepEqual(overskrifter.map((o) => o.id), ['drift', 'drift-2']);
  assert.match(html, /id="drift"/);
  assert.match(html, /id="drift-2"/);
});

test('danske tegn overlever i et id', () => {
  const { overskrifter } = md.render('## Bæredygtig drift på Hjorten');
  assert.equal(overskrifter[0].id, 'baeredygtig-drift-paa-hjorten');
});

test('blokke kender deres linjenumre - det er dét, den hybride editor staar paa', () => {
  const kilde = '# Titel\n\nfoerste afsnit\n\nandet afsnit';
  const b = md.blokke(kilde);
  assert.equal(b.length, 3);
  assert.deepEqual(b.map((x) => [x.slags, x.fra, x.til]),
    [['overskrift', 0, 0], ['afsnit', 2, 2], ['afsnit', 4, 4]]);
  // Kan man skaere praecis den blok ud af kilden igen?
  const linjer = kilde.split('\n');
  assert.equal(linjer.slice(b[2].fra, b[2].til + 1).join('\n'), 'andet afsnit');
});

test('en uafsluttet kodeblok vaelter ikke optegningen', () => {
  // Noten er bare midt i at blive skrevet. Én optegningsfejl maa ikke tage
  // hele ruden med sig (Verdandes spec).
  const { html } = md.render('tekst\n\n```js\nconst x = 1;');
  assert.match(html, /<pre/);
  assert.match(html, /const x = 1;/);
});

test('[[note]] er levende naar noten findes, og SYNLIGT doed naar den ikke goer', () => {
  const opt = { slaaOpNote: (t) => (t === 'Drift' ? { href: '/n/abc' } : null) };
  const levende = md.render('se [[Drift]]', opt).html;
  assert.match(levende, /<a class="notelink" href="\/n\/abc">Drift<\/a>/);

  const doed = md.render('se [[Findes Ikke]]', opt).html;
  assert.match(doed, /class="notelink dead"/);
  assert.match(doed, /Findes Ikke/, 'teksten skal blive staaende - den er en kendsgerning om noten');
});

test('wikiLinks finder de titler, noten peger paa', () => {
  assert.deepEqual(md.wikiLinks('se [[Drift]] og [[Backup]] og [[Drift]] igen'), ['Drift', 'Backup']);
});

test('en kodestump formateres ikke videre indeni', () => {
  const { html } = md.render('`**ikke fed**` men **fed**');
  assert.match(html, /<code>\*\*ikke fed\*\*<\/code>/);
  assert.match(html, /<strong>fed<\/strong>/);
});

test('en 200 KB note renderes uden maerkbar forsinkelse', () => {
  // F1's acceptkriterium. Wikien (F6) renderer server-side ved hvert kald, saa
  // det her er ikke kun en editor-egenskab.
  const afsnit = 'Et afsnit med **fed** og `kode` og https://dr.dk/nyheder i.\n\n';
  const stor = `# Stor note\n\n${afsnit.repeat(3400)}`;
  assert.ok(stor.length > 200000, `testnoten er kun ${stor.length} tegn`);
  const t0 = Date.now();
  const { html } = md.render(stor);
  const ms = Date.now() - t0;
  assert.ok(html.length > 200000);
  assert.ok(ms < 500, `renderingen tog ${ms} ms for ${(stor.length / 1024).toFixed(0)} KB`);
  console.log(`      ${(stor.length / 1024).toFixed(0)} KB markdown renderet paa ${ms} ms`);
});

/* =========================================== F3: de nye blokke ========== */

test('TABELLER renderes med justering og ruller i deres egen ramme', () => {
  const { html } = md.render('| Navn | Antal |\n|:---|---:|\n| kaffe | 3 |\n| te | 12 |');
  assert.match(html, /<div class="tabelwrap"/, 'en bred tabel skal rulle i sin EGEN ramme');
  assert.match(html, /<th>Navn<\/th>/);
  assert.match(html, /<th class="right">Antal<\/th>/);
  assert.match(html, /<td>kaffe<\/td><td class="right">3<\/td>/);
  assert.equal((html.match(/<tr>/g) || []).length, 3);
});

test('en linje med roer er IKKE en tabel uden en skillelinje', () => {
  // Ellers bliver »a | b« i almindelig prosa pludselig til opmaerkning.
  const { html } = md.render('her staar a | b og det er bare tekst');
  assert.ok(!html.includes('<table'), 'det skal blive ved med at vaere et afsnit');
  assert.match(html, /<p/);
});

test('TJEKLISTER er klikbare og kender deres linjenummer', () => {
  const { html } = md.render('- [ ] ikke gjort\n- [x] gjort\n  - [ ] indrykket');
  assert.match(html, /<div class="tjekliste"/);
  assert.match(html, /data-tjek="0"[^>]*aria-checked="false"/);
  assert.match(html, /data-tjek="1"[^>]*aria-checked="true"/);
  assert.match(html, /margin-left:22px/, 'indrykning skal overleve');
  // Et almindeligt punkt maa ikke blive til en tjekliste.
  assert.ok(!md.render('- bare et punkt').html.includes('tjekliste'));
});

test('saetTjek skriver i KILDEN paa det rigtige linjenummer', () => {
  // Tager linjenummeret frem for at soege efter teksten: to punkter kan hedde
  // det samme, og en tekstsoegning ville tikke det forkerte af.
  const kilde = '- [ ] ens tekst\n- [ ] ens tekst';
  assert.equal(md.saetTjek(kilde, 1, true), '- [ ] ens tekst\n- [x] ens tekst');
  assert.equal(md.saetTjek(kilde, 0, true), '- [x] ens tekst\n- [ ] ens tekst');
  // Et linjenummer, der ikke er en tjekliste, roerer ingenting.
  assert.equal(md.saetTjek('bare tekst', 0, true), 'bare tekst');
  assert.equal(md.saetTjek(kilde, 99, true), kilde);
});

test('CALLOUTS i GitHub-stil - og et ukendt navn er bare et citat', () => {
  const { html } = md.render('> [!WARNING]\n> pas paa her\n> anden linje');
  assert.match(html, /<div class="callout warning"/);
  assert.match(html, /Warning/);
  assert.match(html, /pas paa her<br>anden linje/);
  // Ukendt art -> almindeligt citat, ikke en tom boks.
  const u = md.render('> [!FINDESIKKE]\n> tekst').html;
  assert.ok(!u.includes('class="callout'));
  assert.match(u, /<blockquote/);
});

test('BILLEDER: alt-teksten escapes som en ATTRIBUT', () => {
  const { html } = md.render('![et "citat" i alt](https://x.dk/a.png)');
  assert.match(html, /<img src="https:\/\/x\.dk\/a\.png"/);
  assert.match(html, /alt="et &quot;citat&quot; i alt"/, 'anfoerselstegn skal escapes i en attribut');
  assert.match(html, /loading="lazy"/);
});

test('et billede med en ikke-http adresse bliver TEKST, ikke et img', () => {
  for (const ondt of ['javascript:alert(1)', 'data:image/svg+xml,<svg onload=alert(1)>', 'file:///etc/passwd']) {
    const { html } = md.render(`![x](${ondt})`);
    assert.ok(!html.includes('<img'), `${ondt} blev til et billede`);
  }
});

test('billedUrl-krogen lader vaerten oversaette en intern adresse', () => {
  // Vedhaeftninger ligger paa /api/v1/files/<id> - en relativ sti, som
  // sikkerUrl med rette afviser. Vaerten afgoer, hvad der er internt.
  const { html } = md.render('![x](sagu:abc123)', {
    billedUrl: (u) => (u.startsWith('sagu:') ? `/api/v1/files/${u.slice(5)}` : null),
  });
  assert.match(html, /<img src="\/api\/v1\/files\/abc123"/);
});

/* ------------------------------------------------------------- rundturen */

test('ACCEPT: de ti mest brugte blokke overlever en runde ud og ind', () => {
  // »Alt hvad editoren kan, skal overleve en rundtur gennem markdown, og
  //  hvad markdown ikke kan sige, må editoren ikke tilbyde« (Verdandes spec).
  //
  // Beviset er, at kilden er UAENDRET efter at vaere delt i blokke og samlet
  // igen - og at hver blok er genkendt som det, den er.
  const kilde = [
    '# Overskrift',
    '',
    'Et afsnit med **fed**, *kursiv*, `kode` og [et link](https://dr.dk).',
    '',
    '## Underoverskrift',
    '',
    '- punkt',
    '- punkt to',
    '',
    '1. nummer',
    '2. nummer to',
    '',
    '- [ ] ikke gjort',
    '- [x] gjort',
    '',
    '> et citat',
    '',
    '> [!NOTE]',
    '> en callout',
    '',
    '| Navn | Antal |',
    '|---|---:|',
    '| kaffe | 3 |',
    '',
    '```js',
    'const x = 1;',
    '```',
    '',
    '![et billede](https://x.dk/a.png)',
    '',
    '---',
    '',
    'Se ogsaa [[En anden note]].',
  ].join('\n');

  const b = md.blokke(kilde);
  const slags = b.map((x) => x.slags);
  for (const forventet of ['overskrift', 'afsnit', 'liste', 'tjekliste', 'citat',
    'callout', 'tabel', 'kode', 'hr']) {
    assert.ok(slags.includes(forventet), `blokken "${forventet}" blev ikke genkendt: ${slags.join(', ')}`);
  }

  // Rundturen: hver blok skaeres ud af kilden paa sine egne linjenumre og
  // samles igen. Er resultatet ikke identisk, kan editoren ikke skrive en
  // aendret blok tilbage uden at oedelaegge noget.
  const linjer = kilde.split('\n');
  let sidst = -1;
  const samlet = [];
  for (const x of b) {
    // Mellemrummet FOER blokken skal med, ellers taber gensamlingen de tomme
    // linjer - og saa maaler testen sin egen fejl i stedet for parserens.
    samlet.push(...linjer.slice(sidst + 1, x.fra));
    samlet.push(...linjer.slice(x.fra, x.til + 1));
    sidst = x.til;
  }
  samlet.push(...linjer.slice(sidst + 1));
  assert.equal(samlet.join('\n'), kilde,
    'kilden overlevede ikke at blive delt i blokke og samlet igen');

  // Og blokkene maa ikke overlappe eller springe over: hver linje hoerer til
  // hoejst én blok, og alt uden for en blok er tomt.
  let forrige = -1;
  for (const x of b) {
    assert.ok(x.fra > forrige, `blok ${x.slags} overlapper den forrige`);
    for (let i = forrige + 1; i < x.fra; i++) {
      assert.equal(linjer[i].trim(), '', `linje ${i} (»${linjer[i]}«) endte uden for en blok`);
    }
    forrige = x.til;
  }

  // Og den renderes uden at tabe noget.
  const { html } = md.render(kilde);
  for (const spor of ['<h1', '<h2', '<strong>', '<em>', '<code>', '<a href="https://dr.dk"',
    '<ul>', '<ol>', 'tjekliste', '<blockquote', 'callout note', '<table', '<pre',
    '<img src="https://x.dk/a.png"', '<hr', 'notelink']) {
    assert.ok(html.includes(spor), `"${spor}" mangler i det renderede`);
  }
});

test('pentNavn goer en kendt vaert laesbar', () => {
  assert.equal(md.pentNavn('https://github.com/andreasdinesen/sagu'), 'GitHub: andreasdinesen/sagu');
  assert.equal(md.pentNavn('https://www.dr.dk/nyheder'), 'dr.dk');
  assert.equal(md.pentNavn('https://ethvert-arbejdsrum.notion.site/Haandbog-abc'), 'Notion page');
  assert.equal(md.pentNavn('https://ukendt.example/en/sti'), 'ukendt.example/en/sti');
  // En meget lang sti maa ikke fylde en hel linje.
  assert.ok(md.pentNavn(`https://x.dk/${'a'.repeat(200)}`).length < 60);
});

test('linkUrl-krogen lader en vedhaeftning, der ikke er et billede, blive et link', () => {
  // Fejlen, F3 indfoerte: `sagu:<id>` er ikke http(s), saa `sikkerUrl` afviste
  // den med rette - og et PDF-link blev til doed TEKST. Kuren er en KROG, ikke
  // en undtagelse i sikkerUrl: rendereren maa stadig ikke kende Sagus adresser.
  const sagu = (u) => (/^sagu:[a-f0-9]{32}$/.test(u) ? `/api/v1/files/${u.slice(5)}` : null);
  const valg = { linkUrl: sagu, billedUrl: (u) => sagu(u) || md.sikkerUrl(u) };
  const id = 'a'.repeat(32);

  const pdf = md.render(`[rapport.pdf](sagu:${id})`, valg).html;
  assert.match(pdf, /<a href="\/api\/v1\/files\/a{32}" class="vedhaeft">rapport\.pdf<\/a>/);
  // En intern adresse aabnes ikke i en ny fane - den er vores egen.
  assert.ok(!pdf.includes('target="_blank"'));

  // Uden krogen er den samme tekst stadig bare tekst.
  assert.ok(!md.render(`[rapport.pdf](sagu:${id})`).html.includes('<a '));

  // Og krogen aabner IKKE en vej for noget farligt: den kaldes med
  // brugerens streng og svarer null paa alt andet end vores eget moenster.
  for (const ondt of ['javascript:alert(1)', 'sagu:../../etc/passwd', 'sagu:xyz', 'data:text/html,x']) {
    const h = md.render(`[x](${ondt})`, valg).html;
    assert.ok(!h.includes('<a '), `${ondt} blev til et link`);
  }
});

test('et billede UDEFRA bliver et forklarende link, ikke et oedelagt ikon', () => {
  // Sagus CSP er `img-src 'self' data: blob:` MED VILJE: en note maa ikke
  // kunne faa browseren til at hente fra en fremmed vaert, og paa den
  // offentlige wiki ville det lade en forfatter spore sine laesere.
  // Men et oedelagt billedikon forklarer ingenting.
  const kunEgne = { billedUrl: (u) => (/^sagu:[a-f0-9]{32}$/.test(u) ? `/api/v1/files/${u.slice(5)}` : null) };

  const udefra = md.render('![Et diagram](https://x.dk/a.png)', kunEgne).html;
  assert.ok(!udefra.includes('<img'), 'der maa ikke staa et img, browseren naegter at hente');
  assert.match(udefra, /class="ekstern-billede"/);
  assert.match(udefra, /href="https:\/\/x\.dk\/a\.png"/);
  assert.match(udefra, /Et diagram/, 'alt-teksten skal blive staaende - indholdet maa ikke gaa tabt');

  // Vores egne vises stadig som billeder.
  const egen = md.render(`![x](sagu:${'a'.repeat(32)})`, kunEgne).html;
  assert.match(egen, /<img src="\/api\/v1\/files\//);

  // Og en farlig adresse bliver hverken billede eller link.
  for (const ondt of ['javascript:alert(1)', 'data:text/html,x']) {
    const h = md.render(`![x](${ondt})`, kunEgne).html;
    assert.ok(!h.includes('<img') && !h.includes('<a '), `${ondt} slap igennem`);
  }
});

/*
 * **En tom linje er IKKE en blok.**
 *
 * Det lyder som en detalje, og det var årsagen til, at man ikke kunne skrive
 * i en tom note på telefonen: editoren lagde en tom linje ind og bad om
 * »blok 0«, men opdeleren springer tomme linjer over og gav ingen blokke.
 * Optegningen bakkede ud på samme tick, så der aldrig kom et felt frem.
 *
 * Testen står her, fordi den fastholder den præmis, editoren regner med.
 * Ændrer opdeleren adfærd en dag, skal det være et bevidst valg — ikke noget,
 * der bliver opdaget som »man kan ikke skrive i sine noter«.
 */
test('blokke() giver INGEN blokke for en tom eller kun-blank note', () => {
  for (const tom of ['', '\n', '\n\n\n', '   ', ' \n \n']) {
    assert.deepEqual(md.blokke(tom), [], `${JSON.stringify(tom)} skulle ikke give blokke`);
  }
  // ... men ét enkelt tegn ER en blok.
  assert.equal(md.blokke('x').length, 1);
});

/*
 * ── flytBlok ──────────────────────────────────────────────────────────────
 *
 * Traekhaandtagene i fladen goer én ting: kalder den her med to tal. Derfor
 * proeves flytningen HER og ikke gennem en browser.
 *
 * Den strengeste proeve er ikke, at resultatet ser rigtigt ud, men at teksten
 * er DEN SAMME efter en tur frem og tilbage. En editor, der lader noten
 * skifte lidt, hver gang man rykker rundt, aeder det, folk har skrevet - og
 * det opdager man foerst efter tyve flytninger, hvor skaden er sket.
 */
const NOTE = 'Foerste afsnit.\n\n## En overskrift\n\nTredje afsnit.\n\n- a\n- b\n';

test('flytBlok flytter en blok hen foran en anden', () => {
  assert.equal(md.flytBlok(NOTE, 2, 0),
    'Tredje afsnit.\n\nFoerste afsnit.\n\n## En overskrift\n\n- a\n- b\n');
});

test('flytBlok kan lægge en blok nederst — og noten beholder sit sidste linjeskift', () => {
  assert.equal(md.flytBlok(NOTE, 0, 4),
    '## En overskrift\n\nTredje afsnit.\n\n- a\n- b\n\nFoerste afsnit.\n');
});

test('flytBlok: ned i bunden og op igen giver den samme tekst', () => {
  // Den tur, der afsloerede det manglende linjeskift. Uden den ville hver
  // rejse forbi bunden barbere ét tegn af noten.
  const nederst = md.flytBlok(NOTE, 0, 4);
  assert.equal(md.flytBlok(nederst, 3, 0), NOTE);
});

test('flytBlok flytter en flerlinjet blok samlet', () => {
  assert.equal(md.flytBlok(NOTE, 3, 1),
    'Foerste afsnit.\n\n- a\n- b\n\n## En overskrift\n\nTredje afsnit.\n');
});

test('flytBlok hverken taber eller tilføjer blokke', () => {
  const foer = md.blokke(NOTE).length;
  for (let f = 0; f < foer; f += 1) {
    for (let t = 0; t <= foer; t += 1) {
      const ud = md.flytBlok(NOTE, f, t);
      assert.equal(md.blokke(ud).length, foer, `flyt ${f} -> ${t}`);
      assert.ok(!/\n\n\n/.test(ud), `tomme linjer hobede sig op: ${f} -> ${t}`);
    }
  }
});

test('flytBlok frem og tilbage giver den samme tekst', () => {
  // Ned og op igen: blok 0 laegges foran blok 2, og hentes saa tilbage.
  const ned = md.flytBlok(NOTE, 0, 2);
  assert.equal(md.flytBlok(ned, 1, 0), NOTE);
});

test('flytBlok rører ikke teksten, når flytningen ingenting er', () => {
  assert.equal(md.flytBlok(NOTE, 1, 1), NOTE);   // hen foran sig selv
  assert.equal(md.flytBlok(NOTE, 1, 2), NOTE);   // hen bagved sig selv
  assert.equal(md.flytBlok(NOTE, 9, 0), NOTE);   // en blok, der ikke findes
  assert.equal(md.flytBlok(NOTE, 0, 99), NOTE);  // et sted, der ikke findes
  assert.equal(md.flytBlok('', 0, 1), '');
});

test('flytBlok bevarer indrykning og kodeblokke ord for ord', () => {
  const kode = 'Om noget.\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\nSlut.\n';
  const ud = md.flytBlok(kode, 2, 0);
  assert.ok(ud.startsWith('Slut.\n\nOm noget.\n\n```js'), ud);
  // Den tomme linje INDE i kodeblokken maa ikke vaere roert.
  assert.ok(ud.includes('const a = 1;\n\nconst b = 2;'), ud);
});
