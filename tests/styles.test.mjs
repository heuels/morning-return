import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The stylesheet's contract: colours live only in the three token blocks
// (bare :root, the dark media query, and [data-theme="dark"]), and the two dark
// blocks say the same thing, so a viewer's pick and the system's agree.

const CSS = readFileSync(new URL("../skills/morning-routine/page/styles.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

// The text between the brace after `opener` and its matching close brace.
function blockAfter(css, opener) {
  const start = css.indexOf(opener);
  assert.notEqual(start, -1, `no ${opener}`);
  const open = css.indexOf("{", start + opener.length - 1);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}" && --depth === 0) return { start, end: i + 1, body: css.slice(open + 1, i) };
  }
  throw new Error(`unclosed ${opener}`);
}

const tokens = (body) => Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));

const light = blockAfter(CSS, ":root {");
const media = blockAfter(CSS, "@media (prefers-color-scheme: dark) {");
const mediaRoot = blockAfter(media.body, ':root:not([data-theme="light"]) {');
const picked = blockAfter(CSS, ':root[data-theme="dark"] {');

test("the dark theme is the same whether the system asks for it or the viewer picks it", () => {
  assert.deepEqual(tokens(mediaRoot.body), tokens(picked.body));
});

test("every dark token overrides one defined first on bare :root", () => {
  const base = tokens(light.body);
  for (const name of Object.keys(tokens(picked.body))) assert.ok(name in base, `${name} has no light value`);
});

test("component rules use tokens, never literal colours", () => {
  const rest = [CSS.slice(0, light.start), CSS.slice(light.end, media.start), CSS.slice(media.end, picked.start), CSS.slice(picked.end)].join("\n");
  const literals = rest.match(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|lab|lch)\(/g) ?? [];
  assert.deepEqual(literals, []);
});
