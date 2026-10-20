// Ranking for the morning brief. Pure functions over the brief's PR records
// (see brief-format.md); the page calls them, so every run ranks the same way.

const MERGEABLE = new Set(["clean", "has_hooks"]);

const isDraft = (pr) => pr.draft === true || pr.mergeable_state === "draft";

// What still stands between one of my PRs and a merge, in GitHub's own terms.
export function whatsLeft(pr) {
  if (isDraft(pr)) return ["draft"];
  const state = pr.mergeable_state;
  if (MERGEABLE.has(state)) return [];

  const left = [];
  if (state === "dirty") left.push("merge conflict");
  if (state === "behind") left.push("behind base branch");
  if (pr.ci === "failure") left.push("CI failing");
  if (pr.ci === "pending") left.push("CI running");
  if (pr.review_decision === "CHANGES_REQUESTED") left.push("changes requested");
  const explained = pr.ci === "failure" || pr.ci === "pending" || pr.review_decision === "CHANGES_REQUESTED";
  if (state === "blocked" && !explained) left.push("review required");
  if (state === "unstable" && pr.ci !== "failure") left.push("a non-required check is failing");
  if (state === "unknown" || state == null) left.push("GitHub hasn't computed mergeability yet");
  return left;
}

// 1 mergeable now · 2 one thing left · 3 several · 4 draft.
export function mergeTier(pr) {
  if (isDraft(pr)) return 4;
  if (MERGEABLE.has(pr.mergeable_state)) return 1;
  return whatsLeft(pr).length <= 1 ? 2 : 3;
}

const byString = (a, b) => (a ?? "").localeCompare(b ?? "");

export function rankMyPrs(prs) {
  return [...prs].sort(
    (a, b) =>
      mergeTier(a) - mergeTier(b) ||
      Number(b.stale === true) - Number(a.stale === true) ||
      (a.stale && b.stale ? byString(a.stale_closes_on, b.stale_closes_on) : 0) ||
      byString(a.created_at, b.created_at),
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
