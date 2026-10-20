import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { groupStacks, nextStep, rankMine, rankReviewPrs } from "../skills/morning-routine/page/rank.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/brief.json", import.meta.url), "utf8"));

const URL_ = "https://github.com/taxwire/x/pull/1";
const pr = (fields) => ({
  number: 1,
  url: URL_,
  draft: false,
  head_ref: "me/one",
  base_ref: "main",
  mergeable_state: "blocked",
  ci: "success",
  failing_check: null,
  review_decision: null,
  unresolved_threads: 0,
  first_unresolved_url: null,
  stale: false,
  stale_closes_on: null,
  created_at: "2026-10-01T09:00:00Z",
  ...fields,
});

const step = (fields) => {
  const { tone, verb, url, sub } = nextStep(pr(fields));
  return [tone, verb, url, sub];
};

test("a mergeable PR says merge", () => {
  assert.deepEqual(step({ mergeable_state: "clean" }), ["go", "Merge", URL_, "ready"]);
  assert.deepEqual(step({ mergeable_state: "has_hooks" }), ["go", "Merge", URL_, "ready"]);
});

test("failing CI links to the failing check by name", () => {
  const check = { name: "lint", url: "https://ci.example.com/runs/1" };
  assert.deepEqual(step({ mergeable_state: "unstable", ci: "failure", failing_check: check }), [
    "fix",
    "Fix CI",
    check.url,
    "lint",
  ]);
  assert.deepEqual(step({ ci: "failure" }), ["fix", "Fix CI", `${URL_}/checks`, "checks"]);
});

test("a conflict says resolve and links to the conflict editor", () => {
  assert.deepEqual(step({ mergeable_state: "dirty" }), ["fix", "Resolve", `${URL_}/conflicts`, "conflict"]);
});

test("open threads come before merging, but after CI and conflicts", () => {
  const thread = "https://github.com/taxwire/x/pull/1#discussion_r9";
  assert.deepEqual(step({ mergeable_state: "clean", unresolved_threads: 2, first_unresolved_url: thread }), [
    "warn",
    "Answer",
    thread,
    "2 threads",
  ]);
  assert.deepEqual(step({ unresolved_threads: 1 }), ["warn", "Answer", URL_, "1 thread"]);
  assert.equal(step({ unresolved_threads: 1, ci: "failure" })[1], "Fix CI");
  assert.equal(step({ unresolved_threads: 1, mergeable_state: "dirty" })[1], "Resolve");
});

test("requested changes, missing reviews and a stale base each get their own step", () => {
  assert.deepEqual(step({ review_decision: "CHANGES_REQUESTED" }), ["fix", "Address", URL_, "changes requested"]);
  assert.deepEqual(step({ review_decision: "REVIEW_REQUIRED" }), ["warn", "Nudge", URL_, "needs review"]);
  assert.deepEqual(step({ mergeable_state: "behind" }), ["warn", "Update", URL_, "behind main"]);
  assert.deepEqual(step({ mergeable_state: "behind", base_ref: "me/base" }), ["warn", "Update", URL_, "behind me/base"]);
});

test("running CI is nothing to do this morning, so it has no link", () => {
  assert.deepEqual(step({ ci: "pending" }), ["idle", "Wait", null, "CI running"]);
});

test("drafts open, and anything unexplained is left to look at", () => {
  assert.deepEqual(step({ draft: true, mergeable_state: "draft" }), ["quiet", "Open", URL_, "draft"]);
  assert.deepEqual(step({ mergeable_state: "unknown" }), ["idle", "Check", URL_, ""]);
});

test("stacks follow base branches from the bottom up, whatever order they arrive in", () => {
  const a = pr({ number: 1, head_ref: "a", base_ref: "main" });
  const b = pr({ number: 2, head_ref: "b", base_ref: "a" });
  const c = pr({ number: 3, head_ref: "c", base_ref: "b" });
  const lone = pr({ number: 4, head_ref: "lone", base_ref: "main" });
  for (const order of [
    [a, b, c, lone],
    [c, lone, a, b],
    [b, c, lone, a],
  ]) {
    const { stacks, singles } = groupStacks(order);
    assert.deepEqual(
      stacks.map((s) => s.map((p) => p.number)),
      [[1, 2, 3]],
    );
    assert.deepEqual(
      singles.map((p) => p.number),
      [4],
    );
  }
});

test("only PRs in the same repo stack, and drafts never do", () => {
  const a = pr({ number: 1, repo: "taxwire/one", head_ref: "a", base_ref: "main" });
  const b = pr({ number: 2, repo: "taxwire/two", head_ref: "b", base_ref: "a" });
  const d = pr({ number: 3, repo: "taxwire/one", head_ref: "d", base_ref: "a", draft: true });
  const { stacks, singles } = groupStacks([a, b, d]);
  assert.deepEqual(stacks, []);
  assert.deepEqual(
    singles.map((p) => p.number),
    [1, 2, 3],
  );
});

test("PRs without branch names stay single", () => {
  const { stacks, singles } = groupStacks([pr({ number: 1, head_ref: null, base_ref: null }), pr({ number: 2, head_ref: undefined })]);
  assert.deepEqual(stacks, []);
  assert.equal(singles.length, 2);
});

test("my PRs rank merges first, then stale soonest, then by step, then oldest", () => {
  const rows = [
    { key: "wait", lead: pr({ ci: "pending", created_at: "2026-08-01T00:00:00Z" }) },
    { key: "update", lead: pr({ mergeable_state: "behind", created_at: "2026-10-10T00:00:00Z" }) },
    { key: "fix-new", lead: pr({ ci: "failure", created_at: "2026-10-12T00:00:00Z" }) },
    { key: "stale-later", lead: pr({ mergeable_state: "behind", stale: true, stale_closes_on: "2026-10-25" }) },
    { key: "fix-old", lead: pr({ ci: "failure", created_at: "2026-09-12T00:00:00Z" }) },
    { key: "merge", lead: pr({ mergeable_state: "clean", created_at: "2026-10-18T00:00:00Z" }) },
    { key: "stale-soon", lead: pr({ ci: "failure", stale: true, stale_closes_on: "2026-10-22" }) },
  ];
  const before = rows.map((r) => r.key);
  assert.deepEqual(
    rankMine(rows).map((r) => r.key),
    ["merge", "stale-soon", "stale-later", "fix-old", "fix-new", "update", "wait"],
  );
  assert.deepEqual(
    rows.map((r) => r.key),
    before,
  );
});

test("review PRs rank by blocking signal, then waiting longest, then smallest", () => {
  const prs = [
    { number: 10, waiting_since: "2026-10-01T00:00:00Z", additions: 400, deletions: 100, blocking_signal: null },
    { number: 11, waiting_since: "2026-10-15T00:00:00Z", additions: 8, deletions: 2, blocking_signal: "pinged in Slack" },
    { number: 12, waiting_since: "2026-10-01T00:00:00Z", additions: 40, deletions: 10, blocking_signal: null },
    { number: 13, waiting_since: "2026-10-10T00:00:00Z", additions: 3, deletions: 2, blocking_signal: null },
  ];
  const before = prs.map((p) => p.number);
  assert.deepEqual(
    rankReviewPrs(prs).map((p) => p.number),
    [11, 12, 10, 13],
  );
  assert.deepEqual(
    prs.map((p) => p.number),
    before,
  );
});

test("the fixture's stack groups into one chain", () => {
  const { stacks } = groupStacks(fixture.my_prs.filter((p) => !p.draft));
  assert.deepEqual(
    stacks.map((s) => s.map((p) => p.number)),
    [[301, 302, 303]],
  );
});
