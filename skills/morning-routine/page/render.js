// Renders one morning brief (see brief-format.md) as DOM. Everything gathered
// from GitHub, Slack, mail and calendars is set as text, never as markup, and
// only https:// links become anchors.

import { mergeTier, rankMyPrs, rankReviewPrs, whatsLeft } from "./rank.js";

const SOURCE_NAMES = {
  github: "GitHub",
  sessions: "Claude sessions",
  slack: "Slack",
  gmail: "Gmail",
  calendar: "Google Calendar",
};

const TIER_HEADINGS = { 1: "Ready to merge", 2: "One thing left", 3: "Several things left", 4: "Drafts" };

function h(doc, tag, attrs, ...children) {
  const el = doc.createElement(tag);
  for (const [name, value] of Object.entries(attrs ?? {})) {
    if (value == null || value === false) continue;
    el.setAttribute(name, value === true ? "" : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(typeof child === "object" ? child : String(child));
  }
  return el;
}

const isHttps = (url) => typeof url === "string" && url.startsWith("https://");

function link(doc, url, text) {
  return isHttps(url)
    ? h(doc, "a", { href: url, target: "_blank", rel: "noopener noreferrer" }, text)
    : h(doc, "span", null, text);
}

const utcDate = (ymd) => new Date(`${ymd}T00:00:00Z`);
const dayLabel = (ymd) =>
  utcDate(ymd).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
const shortDay = (ymd) =>
  utcDate(ymd).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

function daysSince(iso, today) {
  if (!iso) return null;
  const days = Math.round((utcDate(today) - utcDate(String(iso).slice(0, 10))) / 86_400_000);
  return Number.isFinite(days) ? Math.max(days, 0) : null;
}

function clock(iso, timeZone) {
  try {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });
  } catch {
    return "";
  }
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const shortRepo = (repo) => String(repo ?? "").split("/").pop();

function chip(doc, text, tone) {
  return h(doc, "span", { class: `chip${tone ? ` ${tone}` : ""}` }, text);
}

function diffstat(doc, pr) {
  return h(
    doc,
    "span",
    { class: "diff" },
    h(doc, "span", { class: "add" }, `+${pr.additions ?? 0}`),
    " ",
    h(doc, "span", { class: "del" }, `−${pr.deletions ?? 0}`),
  );
}

function reviewDetails(doc, review) {
  const c = review.counts ?? {};
  const line =
    `${review.verdict ?? "reviewed"} · Critical ${c.critical ?? 0}, High ${c.high ?? 0}, ` +
    `Medium ${c.medium ?? 0}, Low ${c.low ?? 0}`;
  return h(
    doc,
    "details",
    { "data-review": true, class: `review verdict-${review.verdict ?? "unknown"}` },
    h(doc, "summary", null, line),
    h(doc, "pre", null, review.markdown ?? ""),
  );
}

function prRow(doc, pr, { kind, reviews, today }) {
  const chips = [];
  if (kind === "review") {
    if (pr.blocking_signal) chips.push(chip(doc, pr.blocking_signal, "warn"));
    if (pr.author) chips.push(chip(doc, `by ${pr.author}`));
    const waited = daysSince(pr.waiting_since, today);
    if (waited != null) chips.push(chip(doc, waited === 0 ? "requested today" : `waiting ${plural(waited, "day")}`));
  } else if (kind === "mine") {
    const tier = mergeTier(pr);
    const tone = tier === 1 ? "ok" : tier === 4 ? null : "bad";
    const left = whatsLeft(pr);
    if (left.length === 0) chips.push(chip(doc, "mergeable now", "ok"));
    for (const item of left) chips.push(chip(doc, item, tone));
    if (pr.unresolved_threads > 0) chips.push(chip(doc, plural(pr.unresolved_threads, "unresolved thread"), "warn"));
    if (pr.stale) {
      chips.push(chip(doc, pr.stale_closes_on ? `stale · closes ${shortDay(pr.stale_closes_on)}` : "stale", "warn"));
    }
  }
  const review = pr.review_id ? reviews?.[pr.review_id] : null;
  return h(
    doc,
    "li",
    { "data-pr": pr.number },
    h(
      doc,
      "div",
      { class: "pr-head" },
      h(doc, "span", { class: "ref" }, `${shortRepo(pr.repo)}#${pr.number}`),
      h(doc, "span", { class: "title" }, link(doc, pr.url, pr.title ?? "")),
    ),
    h(doc, "div", { class: "meta" }, chips, diffstat(doc, pr)),
    review ? reviewDetails(doc, review) : null,
  );
}

function itemRow(doc, item, timeZone) {
  const when = item.when ? clock(item.when, timeZone) : "";
  return h(
    doc,
    "li",
    null,
    h(doc, "div", { class: "title" }, link(doc, item.url, item.title ?? "")),
    h(doc, "div", { class: "byline" }, [item.who, when].filter(Boolean).join(" · ")),
    item.summary ? h(doc, "p", { class: "summary" }, item.summary) : null,
  );
}

const rows = (doc, children) => h(doc, "ul", { class: "rows" }, children);
const section = (doc, name, title, ...body) =>
  h(doc, "section", { "data-section": name }, h(doc, "h2", null, title), body);

function sourceError(doc, source, error) {
  return h(
    doc,
    "p",
    { "data-source-error": source, class: "source-error" },
    `Couldn't reach ${SOURCE_NAMES[source] ?? source}: ${error || "no details"}`,
  );
}

function todaySection(doc, brief) {
  const today = brief.today ?? {};
  const events = today.events ?? [];
  const prep = today.prep ?? [];
  if (!today.summary && events.length === 0 && prep.length === 0) return null;
  const tz = brief.timezone;
  return section(
    doc,
    "today",
    "Today",
    today.summary ? h(doc, "p", { class: "lede" }, today.summary) : null,
    events.length
      ? h(
          doc,
          "ul",
          { class: "agenda" },
          events.map((e) =>
            h(
              doc,
              "li",
              null,
              h(doc, "span", { class: "when" }, `${clock(e.start, tz)}–${clock(e.end, tz)}`),
              link(doc, e.url, e.title ?? ""),
            ),
          ),
        )
      : null,
    prep.length ? [h(doc, "h3", null, "Prep for tomorrow"), rows(doc, prep.map((i) => itemRow(doc, i, tz)))] : null,
  );
}

function reviewSection(doc, brief, ctx) {
  const mine = rankReviewPrs(brief.review_prs ?? []);
  const team = brief.team_review_prs ?? [];
  if (mine.length === 0 && team.length === 0) return null;
  return section(
    doc,
    "review-prs",
    "To review",
    mine.length
      ? rows(doc, mine.map((pr) => prRow(doc, pr, { ...ctx, kind: "review" })))
      : h(doc, "p", { class: "quiet" }, "Nobody asked you by name."),
    team.length
      ? h(
          doc,
          "details",
          { "data-group": "team", class: "team" },
          h(doc, "summary", null, `Also requested from your teams (${team.length})`),
          rows(doc, rankReviewPrs(team).map((pr) => prRow(doc, pr, { ...ctx, kind: "team", reviews: null }))),
        )
      : null,
  );
}

function myPrsSection(doc, brief, ctx) {
  const ranked = rankMyPrs(brief.my_prs ?? []);
  if (ranked.length === 0) return null;
  const groups = [];
  for (const pr of ranked) {
    const tier = mergeTier(pr);
    if (groups.at(-1)?.tier !== tier) groups.push({ tier, prs: [] });
    groups.at(-1).prs.push(pr);
  }
  return section(
    doc,
    "my-prs",
    "Your PRs",
    groups.map((g) => [
      h(doc, "h3", null, TIER_HEADINGS[g.tier]),
      rows(doc, g.prs.map((pr) => prRow(doc, pr, { ...ctx, kind: "mine" }))),
    ]),
  );
}

function staleClosedSection(doc, brief) {
  const closed = brief.stale_closed ?? [];
  if (closed.length === 0) return null;
  return section(
    doc,
    "stale-closed",
    "Closed as stale",
    rows(
      doc,
      closed.map((pr) =>
        h(
          doc,
          "li",
          { "data-pr": pr.number },
          h(
            doc,
            "div",
            { class: "pr-head" },
            h(doc, "span", { class: "ref" }, `${shortRepo(pr.repo)}#${pr.number}`),
            h(doc, "span", { class: "title" }, link(doc, pr.url, pr.title ?? "")),
          ),
          pr.closed_at ? h(doc, "div", { class: "byline" }, `closed ${shortDay(String(pr.closed_at).slice(0, 10))}`) : null,
        ),
      ),
    ),
  );
}

function slackSection(doc, brief) {
  const asks = brief.slack_asks ?? [];
  const talk = brief.slack_discussions ?? [];
  if (asks.length === 0 && talk.length === 0) return null;
  const tz = brief.timezone;
  return section(
    doc,
    "slack",
    "Slack",
    asks.length ? [h(doc, "h3", null, "Waiting on you"), rows(doc, asks.map((i) => itemRow(doc, i, tz)))] : null,
    talk.length ? [h(doc, "h3", null, "Worth knowing"), rows(doc, talk.map((i) => itemRow(doc, i, tz)))] : null,
  );
}

function mailSection(doc, brief) {
  const asks = brief.mail_asks ?? [];
  if (asks.length === 0) return null;
  return section(doc, "mail", "Mail", rows(doc, asks.map((i) => itemRow(doc, i, brief.timezone))));
}

function tally(brief) {
  const parts = [];
  const ok = (s) => brief.sources?.[s]?.ok !== false;
  if (ok("github")) {
    const review = (brief.review_prs ?? []).length;
    const ready = (brief.my_prs ?? []).filter((pr) => mergeTier(pr) === 1).length;
    if (review) parts.push(`${review} to review`);
    if (ready) parts.push(`${ready} ready to merge`);
  }
  if (ok("slack") && (brief.slack_asks ?? []).length) parts.push(plural(brief.slack_asks.length, "Slack ask"));
  if (ok("gmail") && (brief.mail_asks ?? []).length) parts.push(plural(brief.mail_asks.length, "email waiting", "emails waiting"));
  return parts.length ? parts.join(" · ") : "Nothing is waiting on you.";
}

export function renderBrief(doc, brief, reviews, today) {
  const ok = (s) => brief.sources?.[s]?.ok !== false;
  const err = (s) => sourceError(doc, s, brief.sources[s].error);
  const ctx = { reviews: reviews ?? {}, today };

  const blocks = [
    ok("calendar") ? todaySection(doc, brief) : err("calendar"),
    ok("github") ? reviewSection(doc, brief, ctx) : err("github"),
    ok("sessions") ? null : err("sessions"),
    ok("github") ? myPrsSection(doc, brief, ctx) : null,
    ok("github") ? staleClosedSection(doc, brief) : null,
    ok("slack") ? slackSection(doc, brief) : err("slack"),
    ok("gmail") ? mailSection(doc, brief) : err("gmail"),
  ];
  const notes = brief.notes ?? [];

  return h(
    doc,
    "div",
    { class: "brief" },
    h(
      doc,
      "header",
      null,
      h(doc, "p", { class: "eyebrow" }, "Morning routine"),
      h(doc, "h1", null, dayLabel(brief.run_date)),
      h(doc, "p", { class: "tally" }, tally(brief)),
    ),
    brief.run_date !== today
      ? h(
          doc,
          "p",
          { "data-banner": "stale-brief", class: "banner" },
          `This brief is from ${dayLabel(brief.run_date)}. Today's run hasn't written one yet.`,
        )
      : null,
    blocks,
    notes.length
      ? h(doc, "aside", { class: "notes" }, h(doc, "h2", null, "About this run"), h(doc, "ul", null, notes.map((n) => h(doc, "li", null, n))))
      : null,
  );
}

const EMPTY_MESSAGES = {
  "no-db": "Open this page on claude.ai, signed in, to see your brief.",
  "no-brief": "No brief yet. The first one lands after the routine's next run.",
};

export function renderEmpty(doc, reason) {
  return h(
    doc,
    "div",
    { class: "brief empty", "data-empty": reason },
    h(doc, "header", null, h(doc, "p", { class: "eyebrow" }, "Morning routine"), h(doc, "h1", null, "Your morning brief")),
    h(doc, "p", { class: "lede" }, EMPTY_MESSAGES[reason] ?? EMPTY_MESSAGES["no-brief"]),
  );
}
