// Renders one morning brief (see brief-format.md) as DOM. Everything gathered
// from GitHub, Slack, mail and calendars is set as text, never as markup, and
// only https:// links become anchors.
//
// Layout: summary tiles, then two columns on wide screens (PRs on the left;
// the day, Slack and mail on the right). On narrow screens the columns
// dissolve and each panel's data-slot orders it back into the brief's order.

import { mergeTier, rankMyPrs, rankReviewPrs, whatsLeft } from "./rank.js";
import { parseReviewIssues } from "./review.js";

const SOURCE_NAMES = {
  github: "GitHub",
  sessions: "Claude sessions",
  slack: "Slack",
  gmail: "Gmail",
  calendar: "Google Calendar",
};

const SOURCE_PANELS = {
  github: { title: "Pull requests", slot: "review-prs" },
  sessions: { title: "Claude sessions", slot: "sessions" },
  slack: { title: "Slack", slot: "slack" },
  gmail: { title: "Mail", slot: "mail" },
  calendar: { title: "Today", slot: "today" },
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
const sourceOk = (brief, source) => brief.sources?.[source]?.ok !== false;

function chip(doc, text, tone) {
  return h(doc, "span", { class: `chip${tone ? ` ${tone}` : ""}` }, text);
}

const dot = (doc) => h(doc, "span", { class: "sep", "aria-hidden": "true" }, "·");

function diffstat(doc, pr) {
  return h(
    doc,
    "span",
    { class: "diff", title: `${pr.changed_files ?? "?"} files changed` },
    h(doc, "span", { class: "add" }, `+${pr.additions ?? 0}`),
    " ",
    h(doc, "span", { class: "del" }, `−${pr.deletions ?? 0}`),
  );
}

// ---- panels -------------------------------------------------------------

function panel(doc, { name, title, count, blurb }, ...body) {
  return h(
    doc,
    "section",
    { "data-section": name, "data-slot": name, id: name, class: "panel" },
    h(
      doc,
      "header",
      { class: "panel-head" },
      h(doc, "h2", null, title),
      count != null ? h(doc, "span", { class: "count" }, count) : null,
      blurb ? h(doc, "p", { class: "blurb" }, blurb) : null,
    ),
    body,
  );
}

function errorPanel(doc, source, error) {
  const { title, slot } = SOURCE_PANELS[source];
  return h(
    doc,
    "section",
    { "data-source-error": source, "data-slot": slot, class: "panel panel-error" },
    h(doc, "header", { class: "panel-head" }, h(doc, "h2", null, title)),
    h(doc, "p", { class: "source-error" }, `Couldn't reach ${SOURCE_NAMES[source]}: ${error || "no details"}`),
  );
}

const rows = (doc, children, cls = "rows") => h(doc, "ul", { class: cls }, children);
const subhead = (doc, text) => h(doc, "h3", { class: "subhead" }, text);

// ---- PRs ----------------------------------------------------------------

function reviewDetails(doc, review) {
  const c = review.counts ?? {};
  const verdict = review.verdict ?? "reviewed";
  const issues = parseReviewIssues(review.markdown);
  return h(
    doc,
    "details",
    { "data-review": true, class: `review verdict-${verdict}` },
    h(
      doc,
      "summary",
      null,
      h(doc, "span", { class: "verdict" }, verdict),
      h(
        doc,
        "span",
        { class: "counts" },
        ` · Critical ${c.critical ?? 0}, High ${c.high ?? 0}, Medium ${c.medium ?? 0}, Low ${c.low ?? 0}`,
      ),
    ),
    issues.length
      ? h(
          doc,
          "ul",
          { class: "issues" },
          issues.map((issue) =>
            h(
              doc,
              "li",
              { "data-issue": issue.id },
              h(doc, "span", { class: `sev sev-${issue.severity.toLowerCase()}` }, issue.severity),
              h(
                doc,
                "span",
                { class: "issue-body" },
                h(doc, "span", { class: "issue-title" }, issue.title),
                h(doc, "span", { class: "loc" }, issue.location),
              ),
            ),
          ),
        )
      : null,
    h(doc, "details", { class: "full-review" }, h(doc, "summary", null, "Full review"), h(doc, "pre", null, review.markdown ?? "")),
  );
}

function prRow(doc, pr, { kind, reviews, today }) {
  const meta = [h(doc, "span", { class: "ref" }, `${shortRepo(pr.repo)}#${pr.number}`)];
  const chips = [];
  if (kind === "review" || kind === "team") {
    if (pr.author) meta.push(dot(doc), h(doc, "span", null, pr.author));
    const waited = daysSince(pr.waiting_since, today);
    if (waited != null) meta.push(dot(doc), h(doc, "span", null, waited === 0 ? "today" : `waiting ${plural(waited, "day")}`));
    if (kind === "review" && pr.blocking_signal) chips.push(chip(doc, pr.blocking_signal, "warn"));
  } else {
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
  meta.push(dot(doc), diffstat(doc, pr));
  const review = kind !== "team" && pr.review_id ? reviews?.[pr.review_id] : null;
  return h(
    doc,
    "li",
    { "data-pr": pr.number, class: "pr" },
    h(doc, "div", { class: "pr-title" }, link(doc, pr.url, pr.title ?? "")),
    h(doc, "div", { class: "pr-meta" }, meta),
    chips.length ? h(doc, "div", { class: "chips" }, chips) : null,
    review ? reviewDetails(doc, review) : null,
  );
}

function reviewPanel(doc, brief, ctx) {
  const mine = rankReviewPrs(brief.review_prs ?? []);
  const team = brief.team_review_prs ?? [];
  if (mine.length === 0 && team.length === 0) return null;
  return panel(
    doc,
    { name: "review-prs", title: "To review", count: mine.length, blurb: "Asked for your review by name, most urgent first." },
    mine.length
      ? rows(doc, mine.map((pr) => prRow(doc, pr, { ...ctx, kind: "review" })))
      : h(doc, "p", { class: "quiet" }, "Nobody asked you by name."),
    team.length
      ? h(
          doc,
          "details",
          { "data-group": "team", class: "team" },
          h(doc, "summary", null, `Also requested from your teams (${team.length})`),
          rows(doc, rankReviewPrs(team).map((pr) => prRow(doc, pr, { ...ctx, kind: "team" }))),
        )
      : null,
  );
}

function myPrsPanel(doc, brief, ctx) {
  const ranked = rankMyPrs(brief.my_prs ?? []);
  if (ranked.length === 0) return null;
  const groups = [];
  for (const pr of ranked) {
    const tier = mergeTier(pr);
    if (groups.at(-1)?.tier !== tier) groups.push({ tier, prs: [] });
    groups.at(-1).prs.push(pr);
  }
  return panel(
    doc,
    { name: "my-prs", title: "Your PRs", count: ranked.length, blurb: "Closest to merging first." },
    groups.map((g) => [
      subhead(doc, TIER_HEADINGS[g.tier]),
      rows(doc, g.prs.map((pr) => prRow(doc, pr, { ...ctx, kind: "mine" }))),
    ]),
  );
}

function staleClosedPanel(doc, brief) {
  const closed = brief.stale_closed ?? [];
  if (closed.length === 0) return null;
  return panel(
    doc,
    { name: "stale-closed", title: "Closed as stale", count: closed.length, blurb: "The stale bot closed these this week. Reopen any you still want." },
    rows(
      doc,
      closed.map((pr) =>
        h(
          doc,
          "li",
          { "data-pr": pr.number, class: "pr" },
          h(doc, "div", { class: "pr-title" }, link(doc, pr.url, pr.title ?? "")),
          h(
            doc,
            "div",
            { class: "pr-meta" },
            h(doc, "span", { class: "ref" }, `${shortRepo(pr.repo)}#${pr.number}`),
            pr.closed_at ? [dot(doc), h(doc, "span", null, `closed ${shortDay(String(pr.closed_at).slice(0, 10))}`)] : null,
          ),
        ),
      ),
    ),
  );
}

// ---- day, Slack, mail ---------------------------------------------------

function itemRow(doc, item, timeZone) {
  const when = item.when ? clock(item.when, timeZone) : "";
  return h(
    doc,
    "li",
    { class: "item" },
    h(doc, "div", { class: "item-title" }, link(doc, item.url, item.title ?? "")),
    h(doc, "div", { class: "byline" }, [item.who, when].filter(Boolean).join(" · ")),
    item.summary ? h(doc, "p", { class: "summary" }, item.summary) : null,
  );
}

function todayPanel(doc, brief) {
  const today = brief.today ?? {};
  const events = today.events ?? [];
  const prep = today.prep ?? [];
  if (!today.summary && events.length === 0 && prep.length === 0) return null;
  const tz = brief.timezone;
  return panel(
    doc,
    { name: "today", title: "Today", count: events.length || null, blurb: today.summary },
    events.length
      ? h(
          doc,
          "ol",
          { class: "agenda" },
          events.map((e) =>
            h(
              doc,
              "li",
              null,
              h(doc, "span", { class: "when" }, clock(e.start, tz)),
              h(doc, "span", { class: "what" }, link(doc, e.url, e.title ?? ""), h(doc, "span", { class: "until" }, `until ${clock(e.end, tz)}`)),
            ),
          ),
        )
      : null,
    prep.length ? [subhead(doc, "Prep for tomorrow"), rows(doc, prep.map((i) => itemRow(doc, i, tz)))] : null,
  );
}

function slackPanel(doc, brief) {
  const asks = brief.slack_asks ?? [];
  const talk = brief.slack_discussions ?? [];
  if (asks.length === 0 && talk.length === 0) return null;
  const tz = brief.timezone;
  return panel(
    doc,
    { name: "slack", title: "Slack", count: asks.length || null },
    asks.length ? [subhead(doc, "Waiting on you"), rows(doc, asks.map((i) => itemRow(doc, i, tz)))] : null,
    talk.length ? [subhead(doc, "Worth knowing"), rows(doc, talk.map((i) => itemRow(doc, i, tz)))] : null,
  );
}

function mailPanel(doc, brief) {
  const asks = brief.mail_asks ?? [];
  if (asks.length === 0) return null;
  return panel(
    doc,
    { name: "mail", title: "Mail", count: asks.length, blurb: "Asked you something; no reply yet." },
    rows(doc, asks.map((i) => itemRow(doc, i, brief.timezone))),
  );
}

function notesPanel(doc, brief) {
  const notes = brief.notes ?? [];
  if (notes.length === 0) return null;
  return h(
    doc,
    "aside",
    { class: "notes", "data-slot": "notes" },
    h(doc, "h2", null, "About this run"),
    h(doc, "ul", null, notes.map((n) => h(doc, "li", null, n))),
  );
}

// ---- summary tiles ------------------------------------------------------

function tiles(doc, brief) {
  const github = sourceOk(brief, "github");
  const tile = (name, target, value, label, live) => {
    const linked = live && value > 0;
    return h(
      doc,
      linked ? "a" : "span",
      { class: `tile${live && value > 0 ? "" : " quiet"}`, href: linked ? `#${target}` : null, "data-tile": name },
      h(doc, "span", { class: "tile-num" }, live ? String(value) : "—"),
      " ",
      h(doc, "span", { class: "tile-label" }, live ? label : `${label} (unavailable)`),
    );
  };
  return h(
    doc,
    "nav",
    { class: "tiles", "aria-label": "What's waiting" },
    tile("review", "review-prs", (brief.review_prs ?? []).length, "to review", github),
    tile("merge", "my-prs", (brief.my_prs ?? []).filter((pr) => mergeTier(pr) === 1).length, "ready to merge", github),
    tile("slack", "slack", (brief.slack_asks ?? []).length, "Slack asks", sourceOk(brief, "slack")),
    tile("mail", "mail", (brief.mail_asks ?? []).length, "emails waiting", sourceOk(brief, "gmail")),
  );
}

// ---- page ---------------------------------------------------------------

export function renderBrief(doc, brief, reviews, today) {
  const ok = (source) => sourceOk(brief, source);
  const err = (source) => errorPanel(doc, source, brief.sources[source].error);
  const ctx = { reviews: reviews ?? {}, today };

  const main = ok("github")
    ? [reviewPanel(doc, brief, ctx), myPrsPanel(doc, brief, ctx), staleClosedPanel(doc, brief)]
    : [err("github")];
  const side = [
    ok("calendar") ? todayPanel(doc, brief) : err("calendar"),
    ok("slack") ? slackPanel(doc, brief) : err("slack"),
    ok("gmail") ? mailPanel(doc, brief) : err("gmail"),
    ok("sessions") ? null : err("sessions"),
    notesPanel(doc, brief),
  ];

  return h(
    doc,
    "div",
    { class: "brief" },
    h(
      doc,
      "header",
      { class: "masthead" },
      h(doc, "p", { class: "eyebrow" }, "Morning routine"),
      h(doc, "h1", null, dayLabel(brief.run_date)),
      tiles(doc, brief),
    ),
    brief.run_date !== today
      ? h(
          doc,
          "p",
          { "data-banner": "stale-brief", class: "banner" },
          `This brief is from ${dayLabel(brief.run_date)}. Today's run hasn't written one yet.`,
        )
      : null,
    h(doc, "div", { class: "columns" }, h(doc, "div", { class: "col-main" }, main), h(doc, "div", { class: "col-side" }, side)),
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
    h(doc, "header", { class: "masthead" }, h(doc, "p", { class: "eyebrow" }, "Morning routine"), h(doc, "h1", null, "Your morning brief")),
    h(doc, "p", { class: "lede" }, EMPTY_MESSAGES[reason] ?? EMPTY_MESSAGES["no-brief"]),
  );
}
