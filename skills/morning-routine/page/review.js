// Reads the Issues table out of a pr-review review (see the review prompt in
// pr-review.sh), so the page can list findings instead of the whole write-up.

const cellsOf = (row) =>
  row
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim());

export function parseReviewIssues(markdown) {
  const lines = String(markdown ?? "").split("\n");
  const start = lines.findIndex((line) => /^##\s+Issues\s*$/.test(line.trim()));
  if (start === -1) return [];

  const issues = [];
  for (const raw of lines.slice(start + 1)) {
    const line = raw.trim();
    if (line.startsWith("#")) break;
    if (!line.startsWith("|")) continue;
    const [id, severity, category, location, ...rest] = cellsOf(line);
    if (!rest.length || id === "ID" || /^:?-+:?$/.test(id)) continue;
    issues.push({
      id,
      severity,
      category,
      location: location.replace(/`/g, ""),
      title: rest.join(" | "),
    });
  }
  return issues;
}
