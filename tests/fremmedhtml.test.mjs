/**
 * Koblingen mellem rendereren og »Copy the note with images«.
 *
 * `tilFremmedHtml()` i p6_blokke.js gør appens HTML statisk, saa den kan leve
 * i Apple Notes eller en mail. Den finder fluebenene paa en KLASSE og en
 * ATTRIBUT, som rendereren bestemmer - to filer, der skal blive enige.
 *
 * Selve omskrivningen bruger browserens DOM og kan ikke prøves her. Det, der
 * KAN prøves, er kontrakten: skifter rendereren sin markup, holder transformen
 * op med at ramme noget, og en tjekliste ville igen tabe sine flueben i
 * tavshed - uden at noget fejlede.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import markdown from '../app/shared/markdown.js';

const kilde = readFileSync(new URL('../app/parts/p6_blokke.js', import.meta.url), 'utf8');
const html = markdown.render('- [ ] aaben\n- [x] lukket').html;

test('rendereren giver fluebenet den klasse, transformen leder efter', () => {
  assert.match(html, /class="tjek-boks"/);
  assert.match(kilde, /querySelectorAll\('\.tjek-boks'\)/);
});

test('tilstanden staar i aria-checked, som transformen læser', () => {
  assert.match(html, /aria-checked="false"/);
  assert.match(html, /aria-checked="true"/);
  assert.match(kilde, /getAttribute\('aria-checked'\) === 'true'/);
});

test('fluebenet ER et element, ikke ren tekst — ellers er der intet at bytte', () => {
  assert.match(html, /<button class="tjek-boks"/);
});

test('det UAFKRYDSEDE flueben er tomt — derfor forsvinder det uden transformen', () => {
  /*
   * Det er hele grunden til, at transformen findes. Var den tomme knap fyldt
   * med et tegn, ville tabet vaere symmetrisk og langt mindre slemt. Faldt
   * denne proeve, fordi rendereren begyndte at skrive et tegn i den, maa
   * begrundelsen i p6_blokke.js skrives om.
   */
  assert.match(html, /aria-checked="false"><\/button>/);
  assert.match(html, /aria-checked="true">✓<\/button>/);
});

test('transformen skriver begge tilstande som et tegn, der overlever', () => {
  assert.match(kilde, /\\u2611/);   // ☑
  assert.match(kilde, /\\u2610/);   // ☐
});

/*
 * ── Vejen til udklipsholderen ────────────────────────────────────────────
 *
 * Reglen her er ÆNDRET med vilje, og det er værd at vide hvorfor.
 *
 * v33 gjorde `copy`-hændelsen til hovedvejen, fordi en note indsat i Apple
 * Notes kom ind som rå markdown, og jeg sluttede, at `text/html` aldrig nåede
 * frem. Den slutning var forkert: overskrifterne i den indsatte note VAR
 * blevet til Apple Notes' egne typografier — havde ren tekst vundet, havde
 * der stået `#` foran dem. HTML'en nåede frem hele tiden; den indeholdt bare
 * billedet som tekst (se afsnittet om adresse-loftet nedenfor).
 *
 * `navigator.clipboard.write` er derfor hovedvejen igen. `copy`-hændelsen
 * bliver stående som reserve — den kræver ingen tilladelse, kun et tryk, og
 * bærer de tilfælde, hvor udklipsholder-tilladelsen er nægtet. Målt på macOS'
 * egen udklipsholder gennem `osascript` lander den «class HTML».
 */
test('clipboard.write er hovedvejen — den moderne og den sanktionerede', () => {
  const i = kilde.indexOf('function skrivToFlavours');
  const krop = kilde.slice(i, kilde.indexOf('return lykkedes;', i));
  const skriv = krop.indexOf('navigator.clipboard.write');
  const exec = krop.indexOf("document.execCommand('copy')");
  assert.ok(skriv > -1 && exec > -1, 'begge veje skal findes');
  assert.ok(skriv < exec, 'clipboard.write skal stå FØR copy-hændelsen');
});

test('copy-hændelsen bliver stående som reserve, med begge flavours', () => {
  assert.match(kilde, /document\.execCommand\('copy'\)/);
  assert.match(kilde, /clipboardData\.setData\('text\/html'/);
  assert.match(kilde, /clipboardData\.setData\('text\/plain'/);
});

test('begge knapper bruger DEN SAMME vej — ellers har de hver sin fejl', () => {
  const kald = (kilde.match(/skrivToFlavours\(/g) || []).length;
  assert.ok(kald >= 3, `skrivToFlavours kaldes ${kald} gange, forventede mindst 3 `
    + '(definition + ikonet ved SAVED + rudens knap)');
});


/*
 * ── Rendererens adresse-loft ─────────────────────────────────────────────
 *
 * Meldt fra brug TO gange (Andreas, 2026-08-25). Foerste rettelse ramte ved
 * siden af, fordi jeg proevede med billeder paa 261 bytes. Dem, det gik galt
 * paa, var rigtige skaermbilleder.
 *
 * Rendererens inline-moenster er `/!\[([^\]\n]{0,200})\]\(([^)\s]{1,2000})\)/`.
 * 2.000 tegn er rigeligt til en adresse og et fornuftigt vaern mod en regexp,
 * der loeber loebsk - men et base64-billede paa 252 KB fylder 337.000 tegn.
 * Saa matcher moensteret slet ikke, og `![x](data:…)` bliver staaende som REN
 * TEKST. Det var dét, der kom ud i Apple Notes.
 *
 * Kuren er ikke at haeve loftet, men at lade vaere med at putte den lange
 * adresse IND i markdown'en: der renderes fra den oprindelige tekst med
 * `sagu:<32 hex>` i, og billeddataen kommer ud gennem `billedUrl`.
 */
const LANG = 'data:image/png;base64,' + 'A'.repeat(300000);

test('en lang data-adresse SKREVET i markdown naar aldrig frem til billedUrl', () => {
  /*
   * Foerste udgave af den her proeve kaldte `render()` UDEN `billedUrl`. Den
   * bestod - men af en helt anden grund: uden tilbagekaldet er det
   * `sikkerUrl()`, der afgoer, og den tager kun `http(s)`, saa en
   * `data:`-adresse falder uanset laengde. Proeven ville altsaa ogsaa bestaa
   * med loftet fjernet, og det var netop loftet, den skulle vaere vagt om.
   * Fanget ved at sabotere loftet og se GROENT.
   *
   * Nu leveres et tilbagekald, der siger ja til alt. Saa er laengden det
   * eneste tilbage, og bliver loftet haevet, faar `billedUrl` sin adresse -
   * og proeven falder.
   */
  let set = null;
  const html = markdown.render(`![x](${LANG})`,
    { billedUrl: (u) => { set = u; return u; } }).html;
  assert.equal(set, null, 'billedUrl blev kaldt — saa matchede moensteret alligevel');
  assert.ok(!html.includes('<img'), 'forventede INTET img-tag');
  assert.match(html, /!\[x\]\(data:/, 'markdown\'en bliver staaende som tekst');
});

test('en KORT data-adresse gaar derimod glat igennem — laengden er det hele', () => {
  const kort = 'data:image/png;base64,' + 'A'.repeat(100);
  let set = null;
  markdown.render(`![x](${kort})`, { billedUrl: (u) => { set = u; return u; } });
  assert.equal(set, kort);
});

test('kuren: den samme adresse leveret gennem billedUrl bliver et billede', () => {
  // `sagu:<32 hex>` er 37 tegn og gaar aldrig i klemme i loftet. Den lange
  // adresse skrives kun UD, som en attribut, og dér er der ingen graense.
  const html = markdown.render('![x](sagu:' + 'a'.repeat(32) + ')',
    { billedUrl: () => LANG }).html;
  assert.match(html, /<img[^>]+src="data:image\/png;base64,AAAA/);
  assert.ok(html.length > 300000, 'hele adressen skal med ud');
});

test('kopien renderer fra den OPRINDELIGE markdown, ikke fra den med data i', () => {
  const i = kilde.indexOf('async function medIndlejredeBilleder');
  const krop = kilde.slice(i, kilde.indexOf('\n}', kilde.indexOf('return {', i)));
  assert.match(krop, /saguMarkdown\.render\(md,/,
    'render skal kaldes med `md` — `markdown` baerer de lange data:-adresser');
  assert.match(krop, /billedUrl: \(u\) => \{\s*const data = kort\.get\(u\);/);
});
