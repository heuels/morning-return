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

const PAGE_DIR = fileURLToPath(new URL("../page/", import.meta.url));
const read = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const fixture = read("brief.json");
const fixturePeople = read("people.json");
const TODAY = "2026-10-20";

const HARNESS = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"><body><script type="module">
import { renderBrief, renderEmpty } from "/render.js";
import * as ui from "/ui.js";
window.renderBrief = renderBrief;
window.renderEmpty = renderEmpty;
window.ui = ui;
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

async function render(brief, { reviews = {}, people = fixturePeople, today = TODAY, viewport, colorScheme, sessions = false } = {}) {
  const page = await openHarness({ viewport: viewport ?? { width: 1280, height: 900 }, colorScheme });
  await page.evaluate(
    ([b, o, withSessions]) => {
      if (withSessions) {
        o.startSession = async (request) => {
          window.__started = request;
          return { url: "https://claude.ai/code/session_TEST" };
        };
      }
      document.body.replaceChildren(window.renderBrief(document, b, o));
    },
    [brief, { reviews, people, today }, sessions],
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
  assert.deepEqual(order, ["meetings", "replies", "review-prs", "my-prs", "stale-closed", "linear", "fyi"]);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
});

test("desktop puts the PRs beside meetings, replies, Linear and worth-knowing", async () => {
  const page = await render(clone());
  const box = Object.fromEntries((await boxes(page)).map((s) => [s.name, s]));
  for (const left of ["review-prs", "my-prs", "stale-closed"]) {
    for (const right of ["meetings", "replies", "linear", "fyi"]) {
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
  assert.deepEqual(counts, { review: "2", fix: "1", merge: "1", reply: "3", meetings: "3" });
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
  assert.deepEqual(keys, ["202", "201", "203", "stack-301"]);
});

test("each PR carries its status as icons with tooltips", async () => {
  const page = await render(clone());
  const pr = (n) => `[data-section="my-prs"] [data-key="${n}"]`;
  assert.equal(await tip(page, `${pr(203)} [data-signal="ci"]`), "CI failing: lint");
  assert.equal(await tip(page, `${pr(201)} [data-signal="merge"]`), "Behind main");
  assert.equal(await tip(page, `${pr(201)} [data-signal="review"]`), "Approved");
  assert.equal(await tip(page, `${pr(201)} [data-signal="threads"]`), "1 unresolved thread");
  assert.equal(await tip(page, `${pr(202)} [data-signal="threads"]`), "No unresolved threads");
  assert.equal(await tip(page, '[data-group="team"] [data-signal="threads"]'), "Threads not checked");
});

test("PR section headings carry grey column icons that explain them, lined up with the rows", async () => {
  const page = await render(clone());
  assert.equal(await page.locator(".colhead").count(), 0);
  for (const section of ["review-prs", "my-prs"]) {
    const tips = await page.$$eval(`[data-section="${section}"] h2 [data-tip]`, (els) => els.map((e) => e.dataset.tip));
    assert.deepEqual(tips.slice(0, 4), ["CI checks", "Mergeable with base", "Review decision", "Unresolved review threads"]);
    assert.equal(tips.length, 5);
    const x = (sel) => page.locator(sel).first().evaluate((e) => Math.round(e.getBoundingClientRect().left + e.getBoundingClientRect().width / 2));
    assert.equal(await x(`[data-section="${section}"] h2 [data-signal="ci"]`), await x(`[data-section="${section}"] .row [data-signal="ci"]`));
  }
  const size = (sel) => page.locator(sel).first().evaluate((e) => e.getBoundingClientRect().width);
  assert.equal(await size('[data-section="my-prs"] h2 [data-signal="ci"] svg'), await size('[data-section="my-prs"] .row [data-signal="ci"] svg'));
});

test("PR rows don't repeat the commit scope as a tag", async () => {
  const page = await render(clone());
  assert.doesNotMatch(await text(page, '[data-pr="101"] .body'), /campfire/i);
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
  const rowHeight = await page.locator('[data-pr="101"]').evaluate((e) => e.getBoundingClientRect().height);
  await review.locator("[data-full]").click();
  const dialog = page.locator("[data-review-dialog]");
  assert.equal(await dialog.evaluate((d) => d.open), true);
  assert.equal(await dialog.locator(".md h2").first().textContent(), "Code Review");
  assert.equal(await dialog.locator(".md table tbody tr").count(), 2);
  assert.equal(await page.locator('[data-pr="101"]').evaluate((e) => e.getBoundingClientRect().height), rowHeight);
  await page.keyboard.press("Escape");
  assert.equal(await dialog.evaluate((d) => d.open), false);
});

test("PR authors who work at Taxwire appear the same way as meeting attendees", async () => {
  const page = await render(clone());
  const author = page.locator('[data-pr="101"] [data-person="ben@taxwire.com"]');
  assert.equal(await author.count(), 1);
  assert.match(await author.textContent(), /Ben/);
  assert.equal(await tip(page, '[data-pr="101"] [data-person="ben@taxwire.com"] [data-tip]'), "Ben Ortiz · Taxwire · out Fri");
  const guest = page.locator('[data-pr="102"] [data-external]');
  assert.equal((await guest.textContent()).trim(), "teammate-b");
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
  const dana = acme.locator("[data-external]");
  assert.equal((await dana.textContent()).trim(), "Dana Park");
  assert.equal(await dana.getAttribute("data-tip"), "Dana Park · Acme · organizer");
  assert.equal(await dana.locator("img").count(), 0);
  const look = (loc) => loc.evaluate((e) => {
    const c = getComputedStyle(e);
    return { radius: c.borderRadius, height: e.getBoundingClientRect().height, shadow: c.boxShadow, bg: c.backgroundColor };
  });
  const guest = await look(dana);
  const teammate = await look(acme.locator(".pp[data-person]").first());
  assert.equal(guest.radius, teammate.radius);
  assert.equal(guest.height, teammate.height);
  assert.equal(guest.shadow, "none");
  assert.notEqual(guest.bg, teammate.bg);
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
    "Ben Ortiz · Taxwire · optional · out Fri",
    "Cleo Hart · Taxwire · out today",
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
  const item = page.locator('[data-section="fyi"] [data-item="D1"]');
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

// ---- Linear, people out, the day, sessions ------------------------------------

const REVIEW_MD = [
  "# Code Review",
  "## Issues",
  "| ID | Sev | Cat | Location | Issue |",
  "|----|-----|-----|----------|-------|",
  "| SEC-1 | High | SEC | `api/void.py:42` `void_invoice()` | Voids an invoice twice on retry |",
  "| PERF-1 | Medium | PERF | `api/sync.py:9` `sync()` | N+1 query per line item |",
].join("\n");
const withReview = () => {
  const brief = clone();
  const id = brief.review_prs[0].review_id;
  return [brief, { [id]: { verdict: "needs-work", counts: { high: 1, medium: 1 }, markdown: REVIEW_MD } }];
};

test("PRs for the same Linear issue sit together under it, with the issue's other PRs named", async () => {
  const page = await render(clone());
  const keys = await page.$$eval('[data-section="my-prs"] [data-linear], [data-section="my-prs"] .row[data-key]', (els) =>
    els.map((e) => e.dataset.linear ? `group:${e.dataset.linear}` : e.dataset.key),
  );
  assert.deepEqual(keys, ["group:APP-1", "202", "201", "203", "stack-301"]);
  const group = page.locator('[data-linear="APP-1"]');
  assert.match(await group.textContent(), /APP-1.*Sandbox filter on the status table/);
  assert.match(await group.textContent(), /example-api#204 closed/);
  assert.equal(await group.locator("a").first().getAttribute("href"), "https://linear.app/taxwire/issue/APP-1");
});

test("a PR on its own still links its Linear issue", async () => {
  const page = await render(clone());
  const chip = page.locator('[data-key="203"] a.lin');
  assert.equal((await chip.textContent()).trim(), "DATA-9");
  assert.equal(await chip.getAttribute("href"), "https://linear.app/taxwire/issue/DATA-9");
});

test("people out this week are flagged where they matter", async () => {
  const page = await render(clone());
  assert.match(await text(page, '[data-pr="101"]'), /Ben out Fri/);
  assert.match(await text(page, '[data-key="203"]'), /Ben out Fri · reviewer/);
  assert.match(await tip(page, '[data-meeting="0"] [data-person="cleo@taxwire.com"] [data-tip]'), /out today/);
  const ring = (sel) => page.locator(sel).first().evaluate((e) => getComputedStyle(e).boxShadow);
  assert.equal(
    await ring('[data-meeting="0"] [data-person="cleo@taxwire.com"] .av'),
    await ring('[data-meeting="0"] [data-person="dev@taxwire.com"] .av'),
  );
  for (const email of ["cleo@taxwire.com", "ben@taxwire.com"]) {
    assert.equal(await page.locator(`[data-out] .pp[data-person="${email}"]`).count(), 1, email);
  }
  const out = await text(page, "[data-out]");
  assert.match(out, /Cleo.*today/);
  assert.match(out, /Ben.*Fri/);
});

test("the day strip draws focus, lunch, busy time and meetings to scale", async () => {
  const page = await render(clone());
  const blocks = await page.$$eval("[data-day] [data-block]", (els) =>
    els.map((e) => [e.dataset.block, e.dataset.tip, Math.round(e.getBoundingClientRect().width)]),
  );
  assert.equal(blocks.length, 6);
  const focus = blocks.find(([k]) => k === "focus");
  assert.equal(focus[1], "Focus 08:00–09:30");
  const lunch = blocks.find(([k]) => k === "lunch");
  assert.ok(Math.abs(focus[2] / lunch[2] - 1.5) < 0.05, `focus ${focus[2]}px should be 1.5× lunch ${lunch[2]}px`);
  assert.ok(blocks.some(([k, t]) => k === "meeting" && /Globex demo.*not on calendar/.test(t)));
});

test("Linear lists new assignments, overdue project updates and quiet issues", async () => {
  const page = await render(clone());
  const linear = page.locator('[data-section="linear"]');
  const assigned = linear.locator('[data-item="DATA-10"]');
  assert.match(await assigned.textContent(), /NetSuite rounds the tax rate/);
  assert.match(await assigned.locator("[data-action]").textContent(), /Triage/);
  assert.equal((await assigned.locator(".ln").textContent()).trim(), "C1");
  assert.equal((await assigned.locator("a.lin").textContent()).trim(), "DATA-10");
  const update = linear.locator('[data-item="update-1"]');
  assert.match(await update.textContent(), /NetSuite polish/);
  assert.match(await update.locator("[data-action]").textContent(), /Post update/);
  const quiet = linear.locator('[data-group="linear-stale"]');
  assert.equal(await quiet.evaluate((d) => d.open), false);
  assert.match(await quiet.locator("summary").textContent(), /^1 in progress, quiet for two weeks or more$/);
});

test("Linear comments waiting on me are replies owed", async () => {
  const page = await render(clone());
  const ask = page.locator('[data-section="replies"] [data-item="B3"]');
  assert.match(await ask.textContent(), /Answer Ana on the \$0 tax investigation/);
  assert.equal(await tip(page, '[data-item="B3"] [data-signal="source"]'), "Linear");
});

test("review findings link to their line in the PR's changed files", async () => {
  const [brief, reviews] = withReview();
  const page = await render(brief, { reviews });
  await page.locator('[data-pr="101"] [data-review] > summary').click();
  const loc = page.locator('[data-issue="SEC-1"] a.loc');
  await page.waitForFunction(() => document.querySelector('[data-issue="SEC-1"] a.loc')?.href.includes("#diff-"));
  const { createHash } = await import("node:crypto");
  const anchor = createHash("sha256").update("api/void.py").digest("hex");
  assert.equal(await loc.getAttribute("href"), `${brief.review_prs[0].url}/files#diff-${anchor}R42`);
});

test("findings are all ticked, and only ticked ones go into the session prompt", async () => {
  const [brief, reviews] = withReview();
  const page = await render(brief, { reviews, sessions: true });
  await page.locator('[data-pr="101"] [data-review] > summary').click();
  const boxes = page.locator('[data-pr="101"] [data-issue] input[type="checkbox"]');
  assert.equal(await boxes.count(), 2);
  assert.deepEqual(await boxes.evaluateAll((els) => els.map((e) => e.checked)), [true, true]);
  await boxes.nth(1).uncheck();
  await page.locator('[data-pr="101"] [data-session]').click();
  const dialog = page.locator("[data-session-dialog]");
  assert.equal(await dialog.evaluate((d) => d.open), true);
  const prompt = await dialog.locator("textarea").inputValue();
  assert.match(prompt, /SEC-1/);
  assert.doesNotMatch(prompt, /PERF-1/);
  assert.match(await dialog.locator('input[name="title"]').inputValue(), /^MR: /);
});

test("starting a session sends the edited title and prompt with the PR's repo and branch", async () => {
  const [brief, reviews] = withReview();
  const page = await render(brief, { reviews, sessions: true });
  await page.locator('[data-pr="101"] [data-review] > summary').click();
  await page.locator('[data-pr="101"] [data-session]').click();
  const dialog = page.locator("[data-session-dialog]");
  await dialog.locator('input[name="title"]').fill("MR: my own title");
  await dialog.locator("textarea").fill("Look only at the retry path.");
  await dialog.locator("[data-start]").click();
  await page.waitForFunction(() => window.__started);
  const sent = await page.evaluate(() => window.__started);
  assert.deepEqual(sent, {
    title: "MR: my own title",
    prompt: "Look only at the retry path.",
    repo: "taxwire/example-api",
    branch: "heuels/pr-101",
    environment_id: "env_test",
  });
  const opened = dialog.locator('a[href="https://claude.ai/code/session_TEST"]');
  await opened.waitFor();
  assert.match(await opened.textContent(), /Open/);
});

test("without session access the dialog offers a prefilled claude.ai/code link instead", async () => {
  const page = await render(clone());
  await page.locator('[data-key="203"] [data-session]').click();
  const dialog = page.locator("[data-session-dialog]");
  assert.equal(await dialog.locator("[data-start]").count(), 0);
  const prompt = await dialog.locator("textarea").inputValue();
  assert.match(prompt, /lint/);
  assert.match(prompt, /https:\/\/ci\.example\.com\/runs\/203/);
  const href = new URL(await dialog.locator("a[data-session-link]").getAttribute("href"));
  assert.equal(href.origin + href.pathname, "https://claude.ai/code");
  assert.equal(href.searchParams.get("prompt"), prompt);
  assert.equal(href.searchParams.get("repositories"), "taxwire/example-api");
  assert.equal(href.searchParams.get("environment"), "Taxwire");
  await dialog.locator("textarea").fill("Edited.");
  const edited = new URL(await dialog.locator("a[data-session-link]").getAttribute("href"));
  assert.equal(edited.searchParams.get("prompt"), "Edited.");
});

test("teammates' faces keep their ring in a pile, the same as in a pill", async () => {
  const page = await render(clone());
  const ring = (sel) => page.locator(sel).first().evaluate((e) => getComputedStyle(e).boxShadow);
  const inPile = await ring('[data-meeting="0"] .pile [data-person="dev@taxwire.com"] .av');
  const inPill = await ring('[data-meeting="1"] .pp[data-person="ana@taxwire.com"] .av');
  assert.equal(inPile, inPill);
  assert.notEqual(inPile, "none");
});

// ---- the shared pieces in ui.js ---------------------------------------------------

test("a chip is the same element in every tone and face; only its colours change", async () => {
  const page = await openHarness();
  const looks = await page.evaluate(() => {
    const box = Object.assign(document.createElement("div"), { className: "tags" });
    document.body.append(box);
    return [undefined, "ok", "warn", "bad", "alarm", "brand"].flatMap((tone) =>
      [false, true].map((mono) => {
        const el = box.appendChild(window.ui.chip(document, "APP-1", { tone, mono }));
        const c = getComputedStyle(el);
        return {
          name: `${tone ?? "neutral"}${mono ? " mono" : ""}`,
          shape: { tag: el.tagName, height: el.getBoundingClientRect().height, radius: c.borderRadius, padding: c.padding, border: c.borderTopWidth },
          bg: c.backgroundColor,
        };
      }),
    );
  });
  for (const look of looks) assert.deepEqual(look.shape, looks[0].shape, look.name);
  assert.equal(looks[0].shape.height, 20);
  assert.equal(new Set(looks.map((l) => l.bg)).size, 6);
});

test("a chip links only to https, and opens it in a new tab", async () => {
  const page = await openHarness();
  const made = await page.evaluate(() =>
    [undefined, "javascript:alert(1)", "http://example.com", "https://linear.app/x"].map((href) => {
      const el = window.ui.chip(document, "x", { href });
      return [el.tagName, el.getAttribute("href"), el.getAttribute("rel"), el.getAttribute("target")];
    }),
  );
  assert.deepEqual(made, [
    ["SPAN", null, null, null],
    ["SPAN", null, null, null],
    ["SPAN", null, null, null],
    ["A", "https://linear.app/x", "noopener noreferrer", "_blank"],
  ]);
});

test("everything in a row of tags stands at the chip's height", async () => {
  const [brief, reviews] = withReview();
  const page = await render(brief, { reviews, sessions: true });
  await page.$$eval("details", (folds) => folds.forEach((d) => (d.open = true)));
  const heights = await page.$$eval(
    ".tags .chip, .tags .pp, .tags .btn, .tags .pile .av, .grp .chip, .rv > summary, .rv-actions .btn",
    (els) => els.map((e) => [e.className, e.getBoundingClientRect().height]),
  );
  assert.ok(heights.length > 40, `only ${heights.length} pieces found`);
  for (const [name, height] of heights) assert.equal(height, 20, name);
});

test("buttons are one component: small in rows, full size in dialogs, plain where they sit on colour", async () => {
  const page = await render(clone(), { sessions: true });
  assert.match(await page.locator('[data-key="203"] [data-session]').getAttribute("class"), /^btn sm$/);
  await page.locator('[data-key="203"] [data-session]').click();
  const dialog = page.locator("[data-session-dialog]");
  const classes = await dialog.locator("button, a[data-session-link]").evaluateAll((els) => els.map((e) => e.className));
  assert.deepEqual(classes, ["btn plain icon", "btn primary", "btn", "btn plain"]);
  const colour = (sel) => dialog.locator(sel).evaluate((e) => getComputedStyle(e).color);
  assert.equal(await colour(".dlg-head .btn"), await colour(".dlg-head"));
  await dialog.locator(".dlg-head .btn").click();
  assert.equal(await dialog.evaluate((d) => d.open), false);
});

test("section headings are one band, with or without column icons, and keep the count at the right edge", async () => {
  for (const width of [1280, 390]) {
    const page = await render(clone(), { viewport: { width, height: 900 } });
    const bands = await page.$$eval("[data-section] > h2", (els) =>
      els.map((h2) => {
        const band = h2.getBoundingClientRect();
        return [h2.parentElement.dataset.section, band.height, Math.round(band.right - h2.querySelector(".cnt").getBoundingClientRect().right)];
      }),
    );
    assert.equal(bands.length, 7);
    for (const [name, height, inset] of bands) {
      assert.deepEqual([height, inset], [bands[0][1], bands[0][2]], `${name} at ${width}px`);
    }
  }
});

test("people are one pill: a teammate with their face, a guest in grey named on hover", async () => {
  const page = await openHarness();
  const [teammate, guest] = await page.evaluate(() => {
    const face = window.ui.avatar(document, { photo: "https://evil.example/x.png", initials: "AL", label: "Ana Lima" });
    return [
      window.ui.pill(document, { name: "Ana", face, attrs: { "data-person": "ana@taxwire.com" } }),
      window.ui.pill(document, { name: "Dana Park", guest: true, label: "Dana Park · Acme" }),
    ].map((el) => ({ cls: el.className, text: el.textContent, tip: el.dataset.tip ?? null, imgs: el.querySelectorAll("img").length, external: el.hasAttribute("data-external") }));
  });
  assert.deepEqual(teammate, { cls: "pp", text: "ALAna", tip: null, imgs: 0, external: false });
  assert.deepEqual(guest, { cls: "pp guest", text: "Dana Park", tip: "Dana Park · Acme", imgs: 0, external: true });
});
