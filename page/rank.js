// What to do about each PR this morning, and in what order. Pure functions
// over the brief's PR records (see brief-format.md); the page calls them, so
// every run decides the same way.

const MERGEABLE = new Set(["clean", "has_hooks"]);
const isDraft = (pr) => pr.draft === true || pr.mergeable_state === "draft";
const plural = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;

// The one step that moves a PR forward, as {tone, verb, url, sub}. `tone`
// is how loud the page makes it: go (merge now), fix (broken), warn (needs a
// nudge from me), quiet (draft), idle (nothing to do, so no link).
export function nextStep(pr) {
  const { url, ci } = pr;
  const state = pr.mergeable_state;
  const threads = pr.unresolved_threads ?? 0;

  if (isDraft(pr)) return { tone: "quiet", verb: "Open", url, sub: "draft" };
  if (ci === "failure") {
    const check = pr.failing_check;
    return { tone: "fix", verb: "Fix CI", url: check?.url ?? `${url}/checks`, sub: check?.name ?? "checks" };
  }
  if (state === "dirty") return { tone: "fix", verb: "Resolve", url: `${url}/conflicts`, sub: "conflict" };
  if (threads > 0) {
    return { tone: "warn", verb: "Answer", url: pr.first_unresolved_url ?? url, sub: plural(threads, "thread") };
  }
  if (MERGEABLE.has(state)) return { tone: "go", verb: "Merge", url, sub: "ready" };
  if (pr.review_decision === "CHANGES_REQUESTED") return { tone: "fix", verb: "Address", url, sub: "changes requested" };
  if (ci === "pending") return { tone: "idle", verb: "Wait", url: null, sub: "CI running" };
  if (pr.review_decision === "REVIEW_REQUIRED") return { tone: "warn", verb: "Nudge", url, sub: "needs review" };
  if (state === "behind") return { tone: "warn", verb: "Update", url, sub: `behind ${pr.base_ref || "main"}` };
  return { tone: "idle", verb: "Check", url, sub: "" };
}

// Native GitHub stacks are chains of PRs where each one's base branch is the
// previous one's head branch. Returns each chain bottom-first, plus the PRs
// that aren't part of one. Drafts and PRs without branch names never stack.
export function groupStacks(prs) {
  const stackable = (pr) => !isDraft(pr) && pr.head_ref && pr.base_ref;
  const at = (repo, ref) => `${repo ?? ""}\u0000${ref}`;
  const byHead = new Map(prs.filter(stackable).map((pr) => [at(pr.repo, pr.head_ref), pr]));
  const above = new Map();
  for (const pr of prs.filter(stackable)) {
    const below = byHead.get(at(pr.repo, pr.base_ref));
    if (below && below !== pr) above.set(below, pr);
  }

  const stacks = [];
  const stacked = new Set();
  for (const pr of prs.filter(stackable)) {
    const isBottom = !byHead.has(at(pr.repo, pr.base_ref)) && above.has(pr);
    if (!isBottom) continue;
    const chain = [pr];
    while (above.has(chain.at(-1)) && !chain.includes(above.get(chain.at(-1)))) chain.push(above.get(chain.at(-1)));
    chain.forEach((p) => stacked.add(p));
    stacks.push(chain);
  }
  return { stacks, singles: prs.filter((pr) => !stacked.has(pr)) };
}

const STEP_ORDER = ["Merge", "Fix CI", "Resolve", "Answer", "Address", "Nudge", "Update", "Wait", "Check", "Open"];
const byString = (a, b) => (a ?? "").localeCompare(b ?? "");

// Rows are {lead, ...}: a single PR leads its own row, a stack is led by its
// bottom PR. Ready merges first, then stale PRs by the day they close, then
// by step, then oldest first.
export function rankMine(rows) {
  const verb = (row) => nextStep(row.lead).verb;
  return [...rows].sort(
    (a, b) =>
      Number(verb(b) === "Merge") - Number(verb(a) === "Merge") ||
      Number(b.lead.stale === true) - Number(a.lead.stale === true) ||
      (a.lead.stale && b.lead.stale ? byString(a.lead.stale_closes_on, b.lead.stale_closes_on) : 0) ||
      STEP_ORDER.indexOf(verb(a)) - STEP_ORDER.indexOf(verb(b)) ||
      byString(a.lead.created_at, b.lead.created_at),
  );
}

const size = (pr) => (pr.additions ?? 0) + (pr.deletions ?? 0);

export function rankReviewPrs(prs) {
  return [...prs].sort(
    (a, b) =>
      Number(Boolean(b.blocking_signal)) - Number(Boolean(a.blocking_signal)) ||
      byString(a.waiting_since, b.waiting_since) ||
      size(a) - size(b),
  );
}
