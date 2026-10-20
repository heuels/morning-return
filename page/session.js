// Prompts for Claude Code sessions started from the page, and the
// claude.ai/code link that opens one with the prompt already typed in
// (https://code.claude.com/docs/en/web-quickstart, "Pre-fill sessions").
// Every title starts with "MR:" so these sessions are easy to tell apart.

const short = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const ref = (pr) => `${pr.repo}#${pr.number}`;
const checkout = (pr) => `git fetch origin pull/${pr.number}/head:pr-${pr.number} && git checkout pr-${pr.number}`;

export function title(kind, pr, cleanTitle) {
  return short(`MR: ${kind} #${pr.number} ${cleanTitle}`, 72);
}

export function reviewPrompt(pr, reviewId, issues, pageUrl) {
  const findings = issues.length
    ? issues.map((i) => `- ${i.id} (${i.severity}) ${i.location}: ${i.title}`).join("\n")
    : "- (none selected: read the full review)";
  return [
    `Go deeper on the first-pass review of ${ref(pr)} ("${pr.title}") by ${pr.author}, at head ${String(pr.head_sha ?? "").slice(0, 12)}.`,
    `Check out the PR: ${checkout(pr)}`,
    `Findings to check:\n${findings}`,
    pageUrl
      ? `The full review is in my Morning Routine page's database: ArtifactData get, collection "reviews", doc "${reviewId}", on ${pageUrl}.`
      : null,
    "For each finding, check it against the code and say whether it's real. Then look for anything the first pass missed, and draft review comments. Don't post anything to GitHub until I say so.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function stepPrompt(pr, step) {
  const head = `${ref(pr)} ("${pr.title}"), branch ${pr.head_ref ?? `pr-${pr.number}`}`;
  const base = pr.base_ref || "main";
  switch (step.verb) {
    case "Fix CI":
      return [
        `CI fails on ${head}. The failing check is ${step.sub}${pr.failing_check?.url ? ` (${pr.failing_check.url})` : ""}.`,
        `Check out the PR: ${checkout(pr)}`,
        "Find out why the check fails, fix it, run it locally if you can, and push to the PR's branch. Tell me what was wrong.",
      ].join("\n\n");
    case "Resolve":
      return [
        `${head} has a merge conflict with ${base}.`,
        `Check out the PR: ${checkout(pr)}`,
        `Merge ${base} into it, resolve the conflicts keeping what both sides meant, run the tests that cover the files you touched, and push to the PR's branch. Tell me what conflicted and how you resolved it.`,
      ].join("\n\n");
    case "Answer":
    case "Address":
      return [
        `${head} has review feedback waiting on me: ${step.url}`,
        `Check out the PR: ${checkout(pr)}`,
        "Read every unresolved thread and requested change, check each against the code, and draft a reply for each, with a fix where the reviewer is right. Don't post or push anything until I say so.",
      ].join("\n\n");
    default:
      return `Look at ${head} and tell me what it needs to merge.\n\nCheck out the PR: ${checkout(pr)}`;
  }
}

export function prefillUrl({ prompt, repo, environment }) {
  const params = [
    ["prompt", prompt],
    ["repositories", repo],
    ["environment", environment],
  ].filter(([, value]) => value);
  return `https://claude.ai/code?${params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`;
}
