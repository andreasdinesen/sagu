/**
 * Billed-udtraekket til »Copy with images«.
 *
 * Selve hentningen er browserens (FileReader, blob:), men UDVAELGELSEN er ren
 * tekst - og det er den, der kan tage fejl: overse et billede, saa det falder
 * ud af kopien, eller gribe et der stod som eksempel i en kodeblok.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import markdown from '../app/shared/markdown.js';

const { billederIMarkdown } = markdown;
const a = 'a'.repeat(32);
const b = 'b'.repeat(32);

test('finder et billede og deler det i adresse og alt-tekst', () => {
  const f = billederIMarkdown(`![Et kort](sagu:${a})`);
  assert.equal(f.length, 1);
  assert.equal(f[0].sagu, `sagu:${a}`);
  assert.equal(f[0].alt, 'Et kort');
  assert.equal(f[0].helt, `![Et kort](sagu:${a})`);
});

test('finder flere billeder i den raekkefoelge, de staar', () => {
  const f = billederIMarkdown([`![en](sagu:${a})`, '', `![to](sagu:${b})`].join('\n'));
  assert.deepEqual(f.map((x) => x.alt), ['en', 'to']);
});

test('to billeder paa SAMME linje bliver til to', () => {
  const f = billederIMarkdown(`![en](sagu:${a}) og ![to](sagu:${b})`);
  assert.equal(f.length, 2);
  assert.deepEqual(f.map((x) => x.sagu), [`sagu:${a}`, `sagu:${b}`]);
});

test('tom alt-tekst er stadig et billede', () => {
  assert.equal(billederIMarkdown(`![](sagu:${a})`).length, 1);
});

test('et LINK til en note er ikke et billede', () => {
  assert.deepEqual(billederIMarkdown(`[se her](sagu:${a})`), []);
});

test('et billede paa nettet roeres ikke', () => {
  assert.deepEqual(billederIMarkdown('![ude](https://eksempel.dk/a.png)'), []);
});

test('en adresse med forkert laengde er ikke en sagu-adresse', () => {
  assert.deepEqual(billederIMarkdown(`![kort](sagu:${'a'.repeat(31)})`), []);
  assert.deepEqual(billederIMarkdown(`![lang](sagu:${'a'.repeat(33)})`), []);
});

test('store bogstaver i adressen tages ikke - id er altid smaa', () => {
  assert.deepEqual(billederIMarkdown(`![stort](sagu:${'A'.repeat(32)})`), []);
});

test('billedsyntaks i en kodeblok er tekst, ikke et billede', () => {
  const md = ['Saadan skriver man det:', '', '```', `![x](sagu:${a})`, '```',
    '', `![rigtigt](sagu:${b})`].join('\n');
  const f = billederIMarkdown(md);
  assert.deepEqual(f.map((x) => x.alt), ['rigtigt']);
});

test('en kodeblok med sprog skaermer ogsaa', () => {
  const md = ['```markdown', `![x](sagu:${a})`, '```'].join('\n');
  assert.deepEqual(billederIMarkdown(md), []);
});

test('taaler tomt og manglende indhold', () => {
  for (const v of ['', null, undefined]) assert.deepEqual(billederIMarkdown(v), []);
});
