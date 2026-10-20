import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  mergeTier,
  rankMyPrs,
  rankReviewPrs,
  whatsLeft,
} from "../skills/morning-routine/page/rank.js";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/brief.json", import.meta.url), "utf8"),
);

const pr = (fields) => ({
  draft: false,
  mergeable_state: "clean",
  ci: "success",
  review_decision: null,
  unresolved_threads: 0,
  stale: false,
  stale_closes_on: null,
  created_at: "2026-10-01T09:00:00Z",
  ...fields,
});

const expectState = (fields, tier, left) => {
  assert.deepEqual(whatsLeft(pr(fields)), left);
  assert.equal(mergeTier(pr(fields)), tier);
};

test("clean is mergeable now", () => {
  expectState({ mergeable_state: "clean", ci: "pending" }, 1, []);
});

test("has_hooks is mergeable now", () => {
  expectState({ mergeable_state: "has_hooks" }, 1, []);
});

test("unresolved threads don't demote", () => {
  expectState({ mergeable_state: "clean", unresolved_threads: 3 }, 1, []);
});

test("behind is one thing left", () => {
  expectState({ mergeable_state: "behind" }, 2, ["behind base branch"]);
});

test("conflict is one thing left", () => {
  expectState({ mergeable_state: "dirty" }, 2, ["merge conflict"]);
});

test("blocked by CI", () => {
  expectState({ mergeable_state: "blocked", ci: "failure" }, 2, ["CI failing"]);
});

test("blocked by review", () => {
  expectState(
    { mergeable_state: "blocked", ci: "success", review_decision: "REVIEW_REQUIRED" },
    2,
    ["review required"],
  );
});

test("several things left", () => {
  expectState(
    { mergeable_state: "blocked", ci: "failure", review_decision: "CHANGES_REQUESTED" },
    3,
    ["CI failing", "changes requested"],
  );
});

test("unknown mergeability is one thing left", () => {
  for (const state of ["unknown", null, undefined]) {
    expectState({ mergeable_state: state }, 2, ["GitHub hasn't computed mergeability yet"]);
  }
});

test("drafts are last", () => {
  expectState({ draft: true, mergeable_state: "clean" }, 4, ["draft"]);
});

test("my PRs rank by tier, then stale soonest, then oldest", () => {
  const prs = [
    pr({ number: 6, draft: true, created_at: "2026-08-01T00:00:00Z" }),
    pr({ number: 1, created_at: "2026-10-10T00:00:00Z" }),
    pr({ number: 5, mergeable_state: "behind", created_at: "2026-09-01T00:00:00Z" }),
    pr({ number: 3, stale: true, stale_closes_on: "2026-10-25", created_at: "2026-10-12T00:00:00Z" }),
    pr({ number: 2, created_at: "2026-10-05T00:00:00Z" }),
    pr({ number: 4, stale: true, stale_closes_on: "2026-10-22", created_at: "2026-10-15T00:00:00Z" }),
  ];
  assert.deepEqual(rankMyPrs(prs).map((p) => p.number), [4, 3, 2, 1, 5, 6]);
});

test("review PRs rank by blocking signal, then waiting longest, then smallest", () => {
  const prs = [
    { number: 10, waiting_since: "2026-10-01T00:00:00Z", additions: 400, deletions: 100, blocking_signal: null },
    { number: 11, waiting_since: "2026-10-15T00:00:00Z", additions: 8, deletions: 2, blocking_signal: "pinged in Slack" },
    { number: 12, waiting_since: "2026-10-01T00:00:00Z", additions: 40, deletions: 10, blocking_signal: null },
    { number: 13, waiting_since: "2026-10-10T00:00:00Z", additions: 3, deletions: 2, blocking_signal: null },
  ];
  const before = prs.map((p) => p.number);
  assert.deepEqual(rankReviewPrs(prs).map((p) => p.number), [11, 12, 10, 13]);
  assert.deepEqual(prs.map((p) => p.number), before);
});

test("fixture ranks without throwing", () => {
  assert.equal(rankMyPrs(fixture.my_prs).length, fixture.my_prs.length);
  assert.equal(rankReviewPrs(fixture.review_prs).length, fixture.review_prs.length);
});
