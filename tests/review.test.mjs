import { test } from "node:test";
import assert from "node:assert/strict";

import { parseReviewIssues } from "../skills/morning-routine/page/review.js";

const REVIEW = `# Code Review — taxwire/example-api \`feature\` @ abc

## Summary
- Totals: Critical 1, High 0, Medium 1, Low 0 (Total 2)
- Verdict: blocking

## Issues
| ID | Sev | Cat | Location | Issue |
|----|-----|-----|----------|-------|
| SEC-1 | Critical | SEC | \`core/tax.py:88\` \`calc()\` | Rounds before summing line taxes |
| DATA-1 | Medium | DATA | \`integrations/x.py:3\` \`sync()\` | Drops credit notes with a \\| in the memo |

## Details
| not | an | issue | table | row |
`;

test("parses each row of the Issues table", () => {
  assert.deepEqual(parseReviewIssues(REVIEW), [
    { id: "SEC-1", severity: "Critical", category: "SEC", location: "core/tax.py:88 calc()", title: "Rounds before summing line taxes" },
    { id: "DATA-1", severity: "Medium", category: "DATA", location: "integrations/x.py:3 sync()", title: "Drops credit notes with a \\| in the memo" },
  ]);
});

test("a review without an Issues table has no issues", () => {
  assert.deepEqual(parseReviewIssues("# Code Review\n\n## Summary\n- Verdict: ship-ready\n"), []);
  assert.deepEqual(parseReviewIssues(undefined), []);
});

test("an Issues table with only its header has no issues", () => {
  assert.deepEqual(parseReviewIssues("## Issues\n| ID | Sev | Cat | Location | Issue |\n|---|---|---|---|---|\n"), []);
});
