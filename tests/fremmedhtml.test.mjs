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
