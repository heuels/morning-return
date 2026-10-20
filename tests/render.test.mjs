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
const read = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const fixture = read("brief.json");
const fixturePeople = read("people.json");
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

async function openHarness(options = {}) {
  const page = await browser.newPage(options);
  page.setDefaultTimeout(5000);
  await page.goto(`${base}/__harness`);
  await page.waitForFunction(() => window.__ready === true);
  return page;
}

async function render(brief, { reviews = {}, people = fixturePeople, today = TODAY, viewport, colorScheme } = {}) {
  const page = await openHarness({ viewport: viewport ?? { width: 1280, height: 900 }, colorScheme });
  await page.evaluate(
    ([b, o]) => document.body.replaceChildren(window.renderBrief(document, b, o)),
    [brief, { reviews, people, today }],
  );
  return page;
}

const boxes = (page) =>
  page.$$eval("[data-section]", (els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { name: e.dataset.section, x: r.left, y: r.top };
    }),
  );
const text = (page, selector) => page.locator(selector).first().textContent();
const tip = (page, selector) => page.locator(selector).first().getAttribute("data-tip");

test("phone width stacks the day first, then the PRs, with no sideways scroll", async () => {
  const page = await render(clone(), { viewport: { width: 390, height: 900 } });
  const order = (await boxes(page)).sort((a, b) => a.y - b.y).map((s) => s.name);
  assert.deepEqual(order, ["meetings", "replies", "review-prs", "my-prs", "stale-closed", "fyi"]);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
});

test("desktop puts the PRs beside meetings, replies and worth-knowing", async () => {
  const page = await render(clone());
  const box = Object.fromEntries((await boxes(page)).map((s) => [s.name, s]));
  for (const left of ["review-prs", "my-prs", "stale-closed"]) {
    for (const right of ["meetings", "replies", "fyi"]) {
      assert.ok(box[left].x < box[right].x, `${left} should sit left of ${right}`);
    }
  }
});

test("totals count what's owed and link to it", async () => {
  const page = await render(clone());
  const total = (name) => page.locator(`[data-total="${name}"]`);
  const counts = {};
  for (const name of ["review", "fix", "merge", "reply", "meetings"]) {
    counts[name] = (await total(name).locator(".n").textContent()).trim();
  }
  assert.deepEqual(counts, { review: "2", fix: "1", merge: "1", reply: "2", meetings: "3" });
  assert.equal(await total("review").getAttribute("href"), "#review-prs");
  assert.equal(await page.locator("#review-prs").count(), 1);
});

test("a total whose source failed shows a dash, not zero", async () => {
  const brief = clone();
  brief.sources.slack = { ok: false, error: "401 from Slack" };
  const page = await render(brief);
  assert.equal((await page.locator('[data-total="reply"] .n').textContent()).trim(), "—");
});

test("a failed source shows one line where its section was", async () => {
  const brief = clone();
  brief.sources.calendar = { ok: false, error: "403 from Calendar" };
  const page = await render(brief);
  const line = await text(page, '[data-source-error="calendar"]');
  assert.match(line, /Google Calendar/);
  assert.match(line, /403 from Calendar/);
  assert.equal(await page.locator('[data-section="meetings"]').count(), 0);
});

test("failed GitHub replaces every PR section with one line", async () => {
  const brief = clone();
  brief.sources.github = { ok: false, error: "rate limited" };
  const page = await render(brief);
  assert.equal(await page.locator('[data-source-error="github"]').count(), 1);
  for (const section of ["review-prs", "my-prs", "stale-closed"]) {
    assert.equal(await page.locator(`[data-section="${section}"]`).count(), 0, section);
  }
});

test("Claude sessions are never reported as a failure", async () => {
  const brief = clone();
  brief.sources.sessions = { ok: false, error: "No list_sessions tool in this session" };
  const page = await render(brief);
  assert.equal(await page.locator('[data-source-error="sessions"]').count(), 0);
  assert.doesNotMatch(await page.locator("body").textContent(), /list_sessions/);
});

test("empty sections are dropped", async () => {
  const brief = clone();
  brief.slack_discussions = [];
  brief.stale_closed = [];
  const page = await render(brief);
  assert.equal(await page.locator('[data-section="fyi"]').count(), 0);
  assert.equal(await page.locator('[data-section="stale-closed"]').count(), 0);
  assert.equal(await page.locator('[data-section="replies"]').count(), 1);
});

test("gathered text renders as text, and photos load only from data URIs", async () => {
  const brief = clone();
  const hostile = '<img src=x onerror="window.__pwned=1">';
  brief.slack_asks[0].title = hostile;
  brief.my_prs[0].title = hostile;
  brief.meetings[1].attendees[1].name = hostile;
  const people = structuredClone(fixturePeople);
  people["ana@taxwire.com"].photo = "https://evil.example/track.png";
  const page = await render(brief, { people });
  assert.match(await page.locator("body").textContent(), /<img src=x onerror="window.__pwned=1">/);
  const sources = await page.$$eval("img", (imgs) => imgs.map((i) => i.getAttribute("src")));
  assert.ok(sources.length > 0);
  assert.ok(sources.every((s) => s.startsWith("data:image/")), sources.join(", "));
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
});

test("my PRs follow the ranking, with the stack as one row", async () => {
  const page = await render(clone());
  const keys = await page.$$eval('[data-section="my-prs"] .row[data-key]', (els) => els.map((e) => e.dataset.key));
  assert.deepEqual(keys, ["202", "203", "201", "stack-301"]);
});

test("each PR carries its status as icons with tooltips", async () => {
  const page = await render(clone());
  const pr = (n) => `[data-section="my-prs"] [data-key="${n}"]`;
  assert.equal(await tip(page, `${pr(203)} [data-signal="ci"]`), "CI failing: lint");
  assert.equal(await tip(page, `${pr(201)} [data-signal="merge"]`), "Behind main");
  assert.equal(await tip(page, `${pr(201)} [data-signal="review"]`), "Approved");
  assert.equal(await tip(page, `${pr(201)} [data-signal="threads"]`), "1 unresolved thread");
  assert.equal(await page.locator(`${pr(202)} [data-signal="threads"][data-tip]`).count(), 0);
  assert.equal(await tip(page, '[data-group="team"] [data-signal="threads"]'), "Threads not checked");
});

test("PR sections head their icon columns with grey icons that explain them", async () => {
  const page = await render(clone());
  for (const section of ["review-prs", "my-prs"]) {
    const tips = await page.$$eval(`[data-section="${section}"] .colhead [data-tip]`, (els) =>
      els.map((e) => e.dataset.tip),
    );
    assert.deepEqual(tips.slice(0, 4), ["CI checks", "Mergeable with base", "Review decision", "Unresolved review threads"]);
    assert.equal(tips.length, 5);
  }
});

test("each PR's action is a link to the next step, except when there's nothing to do", async () => {
  const brief = clone();
  brief.my_prs[0].ci = "pending";
  brief.my_prs[0].unresolved_threads = 0;
  const page = await render(brief);
  const act = (n) => page.locator(`[data-section="my-prs"] [data-key="${n}"] [data-action]`);
  assert.equal(await act(203).getAttribute("href"), "https://ci.example.com/runs/203");
  assert.match(await act(203).textContent(), /Fix CI.*lint/);
  assert.match(await act(202).textContent(), /Merge/);
  assert.equal(await act(201).getAttribute("href"), null);
  assert.match(await act(201).textContent(), /Wait.*CI running/);
});

test("a stack shows each PR's step and takes its action from the bottom", async () => {
  const page = await render(clone());
  const stack = page.locator('[data-key="stack-301"]');
  assert.match(await stack.locator(".t").textContent(), /Rillet stack/);
  const segments = await stack.locator("[data-segment]").evaluateAll((els) => els.map((e) => [e.textContent, e.dataset.tip]));
  assert.deepEqual(segments, [
    ["1", "#301: Update"],
    ["2", "#302: Resolve"],
    ["3", "#303: Merge"],
  ]);
  assert.match(await stack.locator("[data-action]").textContent(), /Update.*1\/3 first/);
  assert.equal(await stack.locator("[data-action]").getAttribute("href"), "https://github.com/taxwire/example-api/pull/301");
});

test("stale PRs say when the bot closes them", async () => {
  const page = await render(clone());
  assert.match(await text(page, '[data-key="203"]'), /stale · closes Fri Oct 23/);
});

test("sizes count reviewable lines when the run measured them", async () => {
  const page = await render(clone());
  const size = page.locator('[data-section="review-prs"] [data-pr="101"] .sz');
  assert.match(await size.textContent(), /S\s*\+80\s*−20/);
  assert.equal(await size.getAttribute("data-tip"), "100 reviewable lines, 50 test lines not counted");
});

test("review findings open in place, issues before the full write-up", async () => {
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
  const page = await render(brief, { reviews });
  const review = page.locator('[data-pr="101"] [data-review]');
  assert.match(await review.locator("summary").first().textContent(), /needs work.*1H.*1M/);
  assert.equal(await review.evaluate((d) => d.open), false);
  await review.locator("summary").first().click();
  const issues = review.locator("[data-issue]");
  assert.equal(await issues.count(), 2);
  assert.match(await issues.first().textContent(), /High.*Voids an invoice twice on retry.*api\/void\.py:42/);
  assert.match(await review.locator("pre").textContent(), /# Code Review/);
});

test("PR authors who work at Taxwire appear the same way as meeting attendees", async () => {
  const page = await render(clone());
  const author = page.locator('[data-pr="101"] [data-person="ben@taxwire.com"]');
  assert.equal(await author.count(), 1);
  assert.match(await author.textContent(), /Ben/);
  assert.equal(await tip(page, '[data-pr="101"] [data-person="ben@taxwire.com"] [data-tip]'), "Ben Ortiz · Taxwire");
  assert.match(await text(page, '[data-pr="102"]'), /teammate-b/);
});

test("team requests sit open under the review list and are never reviewed", async () => {
  const page = await render(clone());
  const team = page.locator('[data-group="team"]');
  assert.equal(await team.evaluate((d) => d.open), true);
  assert.match(await team.textContent(), /Tidy the settings page/);
  assert.equal(await team.locator("[data-review]").count(), 0);
  const drafts = page.locator('[data-group="drafts"]');
  assert.equal(await drafts.evaluate((d) => d.open), false);
  assert.match(await drafts.textContent(), /1 draft/);
});

test("meetings show the local time, length, people and what to do this morning", async () => {
  const page = await render(clone());
  const acme = page.locator('[data-meeting="1"]');
  assert.equal((await acme.locator(".ln").textContent()).trim(), "15:30");
  assert.equal((await acme.locator(".when").textContent()).trim(), "30m");
  assert.match(await acme.textContent(), /Customer/);
  assert.match(await acme.textContent(), /Dana Park · Acme/);
  assert.equal(await acme.locator('[data-person="ana@taxwire.com"] img').count(), 1);
  assert.equal(await tip(page, '[data-meeting="1"] [data-signal="conference"]'), "Microsoft Teams");
  const act = acme.locator("[data-action]");
  assert.match(await act.textContent(), /Reply Dana.*by 15:30/);
  assert.equal(await act.getAttribute("href"), "https://mail.google.com/mail/u/0/#inbox/dana");
});

test("a brief from before meetings were gathered still lists today's events", async () => {
  const brief = clone();
  delete brief.meetings;
  brief.today = {
    events: [{ title: "Standup", start: "2026-10-20T09:30:00+01:00", end: "2026-10-20T09:45:00+01:00", url: null }],
  };
  const page = await render(brief);
  const row = page.locator('[data-meeting="0"]');
  assert.match(await row.textContent(), /09:30.*Standup/);
  assert.equal((await page.locator('[data-total="meetings"] .n').textContent()).trim(), "1");
});

test("a meeting with nothing to prepare says so, without a link", async () => {
  const page = await render(clone());
  const act = page.locator('[data-meeting="0"] [data-action]');
  assert.match(await act.textContent(), /No prep/);
  assert.equal(await act.getAttribute("href"), null);
});

test("larger meetings show faces only, each naming its person on hover", async () => {
  const page = await render(clone());
  const faces = await page.$$eval('[data-meeting="0"] .pile [data-tip]', (els) => els.map((e) => e.dataset.tip));
  assert.deepEqual(faces, [
    "Ana Lima · Taxwire · organizer",
    "Ben Ortiz · Taxwire · optional",
    "Cleo Hart · Taxwire",
    "Dev Rao · Taxwire",
  ]);
});

test("someone without a photo gets their initials in the same circle", async () => {
  const page = await render(clone());
  const cleo = page.locator('[data-meeting="0"] .pile [data-person="cleo@taxwire.com"]');
  assert.equal(await cleo.locator("img").count(), 0);
  assert.equal((await cleo.textContent()).trim(), "CH");
});

test("an invite missing from the calendar gets a red badge and an add action", async () => {
  const page = await render(clone());
  const globex = page.locator('[data-meeting="2"]');
  assert.equal(await globex.locator('[data-badge="not-on-calendar"]').count(), 1);
  const act = globex.locator("[data-action]");
  assert.match(await act.textContent(), /Add.*to calendar/);
  assert.equal(await act.getAttribute("href"), "https://calendar.google.com/calendar/event?action=VIEW&eid=globex");
  const prep = globex.locator('[data-then] a');
  assert.match(await prep.textContent(), /Read brief/);
  assert.equal(await prep.getAttribute("href"), "https://docs.google.com/document/d/globex");
});

test("replies name who's waiting and by when", async () => {
  const page = await render(clone());
  const mail = page.locator('[data-section="replies"] [data-item="B1"]');
  assert.match(await mail.textContent(), /Acme 15:30/);
  assert.match(await mail.textContent(), /Dana Park · Acme/);
  assert.match(await mail.locator("[data-action]").textContent(), /Reply.*by 15:30/);
  const slack = page.locator('[data-section="replies"] [data-item="B2"]');
  assert.equal(await slack.locator('[data-person="cleo@taxwire.com"]').count(), 1);
  assert.match(await slack.locator("[data-action]").textContent(), /Reply/);
});

test("worth-knowing threads show their people and need no action", async () => {
  const page = await render(clone());
  const item = page.locator('[data-section="fyi"] [data-item="C1"]');
  assert.equal(await item.locator("[data-person]").count(), 2);
  const act = item.locator("[data-action]");
  assert.match(await act.textContent(), /Read/);
  assert.equal(await act.getAttribute("href"), "https://example.slack.com/archives/C2/p2");
});

test("PRs the stale bot closed offer a reopen", async () => {
  const page = await render(clone());
  const row = page.locator('[data-section="stale-closed"] [data-pr="150"]');
  assert.match(await row.textContent(), /Old experiment/);
  assert.match(await row.locator("[data-action]").textContent(), /Reopen.*closed Oct 17/);
});

test("the run's notes close the page", async () => {
  const page = await render(clone());
  assert.match(await text(page, "[data-notes]"), /2 reviews queued/);
});

test("an older brief gets a banner naming its day", async () => {
  const brief = clone();
  brief.run_date = "2026-10-19";
  const stale = await render(brief);
  const banner = await text(stale, '[data-banner="stale-brief"]');
  assert.match(banner, /Monday/);
  assert.match(banner, /October 19/);
  const fresh = await render(clone());
  assert.equal(await fresh.locator('[data-banner="stale-brief"]').count(), 0);
});

test("the header names the day, the previous run and the account", async () => {
  const page = await render(clone());
  const head = await text(page, "header.head");
  assert.match(head, /Tuesday, October 20/);
  assert.match(head, /since Mon 07:45 · heuels/);
});

test("empty states explain themselves", async () => {
  const page = await openHarness();
  const say = (reason) => page.evaluate((r) => window.renderEmpty(document, r).textContent, reason);
  assert.match(await say("no-brief"), /No brief yet/);
  assert.match(await say("no-db"), /claude\.ai/);
});

test("non-https links are not linked", async () => {
  const brief = clone();
  brief.mail_asks[0].url = "javascript:alert(1)";
  brief.mail_asks[0].action.url = "javascript:alert(1)";
  const page = await render(brief);
  const item = page.locator('[data-section="replies"] [data-item="B1"]');
  assert.equal(await item.locator('a[href^="javascript"]').count(), 0);
  assert.equal(await item.locator("[data-action]").getAttribute("href"), null);
});

test("dark mode follows the system unless the viewer picked light", async () => {
  const bg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const light = await render(clone(), { colorScheme: "light" });
  const dark = await render(clone(), { colorScheme: "dark" });
  assert.notEqual(await bg(light), await bg(dark));
  await dark.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  assert.equal(await bg(dark), await bg(light));
});
