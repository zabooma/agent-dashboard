import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');

// The boot script is the only inline <script> in the document; the other one is the deferred module.
const bootScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];

// Loads the real boot script with just the globals it touches, so a resolution case can be driven
// without a browser. `stored: null` and `blocked: true` are different things: the first has no
// preference recorded, the second cannot read storage at all.
function resolveTheme({ stored = null, systemPrefersDark = false, blocked = false }) {
  const root = { dataset: {} };
  const meta = { content: '' };
  const context = {
    matchMedia: () => ({ matches: systemPrefersDark }),
    localStorage: {
      getItem: () => {
        if (blocked) throw new Error('storage is blocked');
        return stored;
      },
    },
    document: {
      documentElement: root,
      querySelector: (selector) => (selector === 'meta[name="theme-color"]' ? meta : null),
    },
  };
  vm.createContext(context);
  vm.runInContext(bootScript, context);
  return { theme: root.dataset.theme, themeColor: meta.content };
}

test('the theme is resolved before the stylesheet is requested', () => {
  assert.ok(bootScript, 'index.html should carry an inline boot script');
  const scriptAt = html.indexOf('<script>');
  const stylesAt = html.indexOf('/styles.css');
  assert.ok(scriptAt !== -1 && stylesAt !== -1, 'both the boot script and the stylesheet link should exist');
  // app.js is a deferred module, so it cannot prevent a flash of the wrong palette.
  assert.ok(scriptAt < stylesAt, 'the boot script must run before the stylesheet is requested');
});

test('an explicit choice beats the operating system, and system follows it', () => {
  const cases = [
    { name: 'no preference recorded, OS light', stored: null, systemPrefersDark: false, theme: 'light', themeColor: '#dfe2cf' },
    { name: 'no preference recorded, OS dark', stored: null, systemPrefersDark: true, theme: 'dark', themeColor: '#101714' },
    { name: 'light chosen over a dark OS', stored: 'light', systemPrefersDark: true, theme: 'light', themeColor: '#dfe2cf' },
    { name: 'dark chosen over a light OS', stored: 'dark', systemPrefersDark: false, theme: 'dark', themeColor: '#101714' },
    { name: 'an explicit "system" follows a dark OS', stored: 'system', systemPrefersDark: true, theme: 'dark', themeColor: '#101714' },
    { name: 'an unrecognised value follows the light OS', stored: 'something-else', systemPrefersDark: false, theme: 'light', themeColor: '#dfe2cf' },
    { name: 'blocked storage follows the OS instead of throwing', stored: 'dark', blocked: true, systemPrefersDark: false, theme: 'light', themeColor: '#dfe2cf' },
  ];
  for (const { name, ...options } of cases) {
    const { theme, themeColor } = resolveTheme(options);
    assert.equal(theme, options.theme, name);
    assert.equal(themeColor, options.themeColor, `${name} (address-bar color)`);
  }
});

// A token present in one palette and missing from the other does not fail loudly: the missing side
// silently inherits the other theme's value, which is how a light theme ends up with a dark border.
function paletteTokens(selector) {
  const block = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
  assert.ok(block, `${selector} should have a palette block`);
  return new Map([...block[1].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));
}

const lightTokens = paletteTokens(":root[data-theme='light']");
const darkTokens = paletteTokens(":root[data-theme='dark']");

test('both palettes define exactly the same tokens', () => {
  const lightNames = [...lightTokens.keys()].sort();
  const darkNames = [...darkTokens.keys()].sort();
  assert.deepEqual(
    darkNames.filter((name) => !lightTokens.has(name)),
    [],
    'these tokens exist only in the dark palette, so light inherits a dark value',
  );
  assert.deepEqual(
    lightNames.filter((name) => !darkTokens.has(name)),
    [],
    'these tokens exist only in the light palette, so dark inherits a light value',
  );
  assert.equal(lightNames.length, darkNames.length);
});

test('no colour literal escapes the two palettes', () => {
  // Positional, not a substring test: matching by text would clear a stray #101714 in a rule,
  // because that same hex legitimately appears inside the palette blocks.
  const ranges = [...css.matchAll(/:root(?:\[data-theme='(?:light|dark)'\])?\s*\{[^}]*\}/g)]
    .map((match) => [match.index, match.index + match[0].length]);
  const strays = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)]
    .filter((match) => !ranges.some(([start, end]) => match.index >= start && match.index < end))
    .map((match) => `line ${css.slice(0, match.index).split('\n').length}: ${match[0]}`);
  assert.deepEqual(strays, [], 'a hardcoded colour in a rule cannot flip with the theme; use a token');
});

// Name parity alone would pass if someone set both palettes to the same values.
test('the light palette is lighter than the dark one', () => {
  const channel = (value) => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (hex) => {
    const parts = hex.match(/[0-9a-fA-F]{2}/g).map((pair) => parseInt(pair, 16));
    return 0.2126 * channel(parts[0]) + 0.7152 * channel(parts[1]) + 0.0722 * channel(parts[2]);
  };
  const lightBackground = luminance(lightTokens.get('--bg'));
  const darkBackground = luminance(darkTokens.get('--bg'));
  assert.ok(lightBackground > darkBackground, `light --bg ${lightTokens.get('--bg')} should be lighter than dark --bg ${darkTokens.get('--bg')}`);
  assert.ok(
    luminance(lightTokens.get('--fg')) < luminance(darkTokens.get('--fg')),
    'light --fg should be darker than dark --fg',
  );
});

test('each palette declares the matching color-scheme', () => {
  assert.match(css, /:root\[data-theme='light'\][^}]*\{[^}]*color-scheme:\s*light/m);
  assert.match(css, /:root\[data-theme='dark'\][^}]*\{[^}]*color-scheme:\s*dark/m);
});

// The radio values are a contract, not decoration: the boot script and storedThemeMode() only
// persist the literals "light" and "dark", and treat anything else as "follow the system". A
// fourth option, or a renamed value, would silently stop persisting.
test('the masthead control offers exactly the modes the resolver understands', () => {
  const radios = [...html.matchAll(/<input\b[^>]*type="radio"[^>]*>/g)].map((match) => match[0]);
  const values = radios.map((radio) => radio.match(/value="([^"]+)"/)?.[1]);
  assert.deepEqual(values, ['system', 'light', 'dark'], 'the theme group should offer the three documented modes');
  assert.ok(radios.every((radio) => /name="theme"/.test(radio)), 'the radios should be one group');
  assert.equal(radios.filter((radio) => /\bchecked\b/.test(radio)).length, 1, 'exactly one mode should start checked');
  // Without a name the group is unlabelled once the visible label is gone.
  const legend = html.match(/<legend\b[^>]*>([^<]*)<\/legend>/);
  assert.ok(legend, 'the group needs a legend for its accessible name');
  assert.match(legend[0], /class="visually-hidden"/, 'the legend stays for screen readers without being shown');
});

// The boot script runs before the stylesheet is applied, so it cannot read the palette and has to
// repeat the two background colours. This keeps the repetition honest.
test('the boot script repeats the palette backgrounds exactly', () => {
  const literals = [...bootScript.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((match) => match[0].toLowerCase()).sort();
  assert.deepEqual(
    literals,
    [lightTokens.get('--bg'), darkTokens.get('--bg')].map((value) => value.toLowerCase()).sort(),
    'the address-bar colours in the boot script should match the palettes they stand in for',
  );
});
