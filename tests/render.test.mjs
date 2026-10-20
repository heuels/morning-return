import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

// Playwright is preinstalled globally in agent sandboxes; require() honours NODE_PATH.
const { chromium } = createRequire(import.meta.url)("playwright");

const PAGE_DIR = fileURLToPath(new URL("../skills/morning-routine/page/", import.meta.url));
const fixture = JSON.parse(readFileSync(new URL("./fixtures/brief.json", import.meta.url), "utf8"));
const TODAY = "2026-10-20";

const HARNESS = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"><body><script type="module">
import { renderBrief, renderEmpty } from "/render.js";
window.renderBrief = renderBrief;
window.renderEmpty = renderEmpty;
window.__ready = true;
</script></body>`;

let server;
let browser;
let base;

before(async () => {
  server = http.createServer(async (req, res) => {
    if (req.url === "/__harness") {
      res.writeHead(200, { "content-type": "text/html" }).end(HARNESS);
      return;
    }
    const path = normalize(join(PAGE_DIR, req.url));
    if (!path.startsWith(PAGE_DIR)) return res.writeHead(403).end();
    const types = { ".js": "text/javascript", ".css": "text/css" };
    let body;
    try {
      body = await readFile(path);
    } catch {
      return res.writeHead(404).end();
    }
    res.writeHead(200, { "content-type": types[extname(path)] ?? "text/html" }).end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
});

const clone = () => structuredClone(fixture);

async function openHarness() {
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  await page.goto(`${base}/__harness`);
  await page.waitForFunction(() => window.__ready === true);
  return page;
}

async function render(brief, reviews = {}, today = TODAY, viewport = { width: 1280, height: 900 }) {
  const page = await openHarness();
  await page.setViewportSize(viewport);
  await page.evaluate(
    ([b, r, t]) => document.body.replaceChildren(window.renderBrief(document, b, r, t)),
    [brief, reviews, today],
  );
  return page;
}

const sectionBoxes = (page) =>
  page.$$eval("[data-section]", (els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { name: e.dataset.section, x: r.left, y: r.top };
    }),
  );

test("phone width stacks sections in the brief's order", async () => {
  const page = await render(clone(), {}, TODAY, { width: 390, height: 900 });
  const order = (await sectionBoxes(page)).sort((a, b) => a.y - b.y).map((s) => s.name);
  assert.deepEqual(order, ["today", "review-prs", "my-prs", "stale-closed", "slack", "mail"]);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
});

test("desktop puts the PRs beside the day, Slack and mail", async () => {
  const page = await render(clone());
  const box = Object.fromEntries((await sectionBoxes(page)).map((s) => [s.name, s]));
  for (const left of ["review-prs", "my-prs", "stale-closed"]) {
    for (const right of ["today", "slack", "mail"]) {
      assert.ok(box[left].x < box[right].x, `${left} should sit left of ${right}`);
    }
  }
});

test("tiles count what's waiting and link to it", async () => {
  const page = await render(clone());
  const tile = (name) => page.locator(`[data-tile="${name}"]`);
  assert.match(await tile("review").textContent(), /^2\b/);
  assert.match(await tile("merge").textContent(), /^1\b/);
  assert.match(await tile("slack").textContent(), /^1\b/);
  assert.match(await tile("mail").textContent(), /^1\b/);
  assert.equal(await tile("review").getAttribute("href"), "#review-prs");
  assert.equal(await page.locator("#review-prs").count(), 1);
});

test("a failed source's tile shows a dash, not zero", async () => {
  const brief = clone();
  brief.sources.slack = { ok: false, error: "401 from Slack" };
  const page = await render(brief);
  assert.match(await page.locator('[data-tile="slack"]').textContent(), /^\u2014/);
});

test("empty sections are dropped", async () => {
  const brief = clone();
  brief.slack_asks = [];
  brief.slack_discussions = [];
  const page = await render(brief);
  assert.equal(await page.locator('[data-section="slack"]').count(), 0);
  assert.equal(await page.locator('[data-section="mail"]').count(), 1);
});

test("failed source shows an error line, not a section", async () => {
  const brief = clone();
  brief.sources.slack = { ok: false, error: "401 from Slack" };
  const page = await render(brief);
  const line = await page.locator('[data-source-error="slack"]').textContent();
  assert.match(line, /Slack/);
  assert.match(line, /401 from Slack/);
  assert.equal(await page.locator('[data-section="slack"]').count(), 0);
});

test("failed GitHub replaces all three PR sections with one line", async () => {
  const brief = clone();
  brief.sources.github = { ok: false, error: "rate limited" };
  const page = await render(brief);
  assert.equal(await page.locator('[data-source-error="github"]').count(), 1);
  for (const section of ["review-prs", "my-prs", "stale-closed"]) {
    assert.equal(await page.locator(`[data-section="${section}"]`).count(), 0, section);
  }
});

test("gathered text renders as text", async () => {
  const brief = clone();
  const hostile = '<img src=x onerror="window.__pwned=1">';
  brief.slack_asks[0].title = hostile;
  brief.my_prs[0].title = hostile;
  const page = await render(brief);
  assert.match(await page.locator("body").textContent(), /<img src=x onerror="window.__pwned=1">/);
  assert.equal(await page.evaluate(() => document.images.length), 0);
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
});

test("my PRs follow the ranking", async () => {
  const page = await render(clone());
  const numbers = await page.$$eval('[data-section="my-prs"] [data-pr]', (els) =>
    els.map((e) => Number(e.dataset.pr)),
  );
  assert.deepEqual(numbers, [202, 203, 201]);
});

test("my PRs say what's left and when stale ones close", async () => {
  const page = await render(clone());
  const behind = await page.locator('[data-section="my-prs"] [data-pr="201"]').textContent();
  assert.match(behind, /behind base branch/);
  assert.match(behind, /1 unresolved thread/);
  const stale = await page.locator('[data-section="my-prs"] [data-pr="203"]').textContent();
  assert.match(stale, /CI failing/);
  assert.match(stale, /Oct 23/);
});

test("review findings expand in place", async () => {
  const brief = clone();
  const id = brief.review_prs[0].review_id;
  const reviews = {
    [id]: {
      verdict: "needs-work",
      counts: { critical: 0, high: 1, medium: 2, low: 0 },
      markdown: "# Code Review\n## Summary\n- Verdict: needs-work",
    },
  };
  const page = await render(brief, reviews);
  const review = page.locator(`[data-pr="${brief.review_prs[0].number}"] [data-review]`);
  const summary = await review.locator("summary").first().textContent();
  assert.match(summary, /needs-work/);
  assert.match(summary, /High 1/);
  assert.match(await review.locator("pre").textContent(), /# Code Review/);
});

test("review findings list each issue before the full write-up", async () => {
  const brief = clone();
  const id = brief.review_prs[0].review_id;
  const markdown = [
    "# Code Review",
    "## Summary",
    "- Totals: Critical 0, High 1, Medium 1, Low 0 (Total 2)",
    "- Verdict: needs-work",
    "## Issues",
    "| ID | Sev | Cat | Location | Issue |",
    "|----|-----|-----|----------|-------|",
    "| SEC-1 | High | SEC | `api/void.py:42` `void_invoice()` | Voids an invoice twice on retry |",
    "| PERF-1 | Medium | PERF | `api/sync.py:9` `sync()` | N+1 query per line item |",
    "## Details",
  ].join("\n");
  const reviews = { [id]: { verdict: "needs-work", counts: { critical: 0, high: 1, medium: 1, low: 0 }, markdown } };
  const page = await render(brief, reviews);
  const issues = page.locator(`[data-pr="${brief.review_prs[0].number}"] [data-review] [data-issue]`);
  assert.equal(await issues.count(), 2);
  const first = await issues.first().textContent();
  assert.match(first, /High/);
  assert.match(first, /Voids an invoice twice on retry/);
  assert.match(first, /api\/void\.py:42/);
});

test("team requests are listed but not reviewed", async () => {
  const page = await render(clone());
  const team = page.locator('[data-group="team"]');
  assert.match(await team.textContent(), /Tidy the settings page/);
  assert.equal(await team.locator("[data-review]").count(), 0);
});

test("older brief gets a banner naming its day", async () => {
  const brief = clone();
  brief.run_date = "2026-10-19";
  const stale = await render(brief);
  const banner = await stale.locator('[data-banner="stale-brief"]').textContent();
  assert.match(banner, /Monday/);
  assert.match(banner, /October 19/);
  const fresh = await render(clone());
  assert.equal(await fresh.locator('[data-banner="stale-brief"]').count(), 0);
});

test("empty states explain themselves", async () => {
  const page = await openHarness();
  const text = (reason) =>
    page.evaluate((r) => window.renderEmpty(document, r).textContent, reason);
  assert.match(await text("no-brief"), /No brief yet/);
  assert.match(await text("no-db"), /claude\.ai/);
});

test("non-https links are not linked", async () => {
  const brief = clone();
  brief.mail_asks[0].url = "javascript:alert(1)";
  brief.mail_asks[0].title = "Suspicious link";
  const page = await render(brief);
  const item = page.locator('[data-section="mail"] li', { hasText: "Suspicious link" });
  assert.equal(await item.count(), 1);
  assert.equal(await item.locator("a").count(), 0);
});
