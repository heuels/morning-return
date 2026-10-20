// Renders one morning brief (see brief-format.md) as DOM, laid out like a
// return form: a header, a row of totals, then PRs on the left and the day
// (meetings, replies owed, worth knowing) on the right. Every item is the same
// row: line number, what it is, status icons, age or length, and one action
// for this morning.
//
// Everything gathered from GitHub, Slack, mail and calendars is set as text,
// never as markup. Only https:// links become anchors, and photos load only
// from data:image/ URIs.

import { icon, logo } from "./icons.js";
import { groupStacks, nextStep, rankMine, rankReviewPrs } from "./rank.js";
import { parseReviewIssues } from "./review.js";

const SOURCE_NAMES = { github: "GitHub", slack: "Slack", gmail: "Gmail", calendar: "Google Calendar" };

function h(doc, tag, attrs, ...children) {
  const el = doc.createElement(tag);
  for (const [name, value] of Object.entries(attrs ?? {})) {
    if (value == null || value === false) continue;
    el.setAttribute(name, value === true ? "" : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false || child === "") continue;
    el.append(typeof child === "object" ? child : String(child));
  }
  return el;
}

const isHttps = (url) => typeof url === "string" && url.startsWith("https://");
const isPhoto = (src) => typeof src === "string" && src.startsWith("data:image/");
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const sourceOk = (brief, source) => brief.sources?.[source]?.ok !== false;

function link(doc, url, attrs, ...children) {
  return isHttps(url)
    ? h(doc, "a", { ...attrs, href: url, target: "_blank", rel: "noopener noreferrer" }, ...children)
    : h(doc, "span", attrs, ...children);
}

// ---- dates and times -----------------------------------------------------------

const utcDate = (ymd) => new Date(`${ymd}T00:00:00Z`);
const inZone = (iso, timeZone, options) => {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone, ...options }).formatToParts(new Date(iso));
  } catch {
    return [];
  }
};
const part = (parts, type) => parts.find((p) => p.type === type)?.value ?? "";

const longDay = (ymd) =>
  utcDate(ymd).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
const monthDay = (iso, timeZone = "UTC") => {
  const p = inZone(iso, timeZone, { month: "short", day: "numeric" });
  return `${part(p, "month")} ${part(p, "day")}`;
};
const weekdayMonthDay = (ymd) => {
  const p = inZone(`${ymd}T12:00:00Z`, "UTC", { weekday: "short", month: "short", day: "numeric" });
  return `${part(p, "weekday")} ${part(p, "month")} ${part(p, "day")}`;
};
const clock = (iso, timeZone) => {
  const p = inZone(iso, timeZone, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return p.length ? `${part(p, "hour")}:${part(p, "minute")}` : "";
};
const ymdIn = (iso, timeZone) => {
  const p = inZone(iso, timeZone, { year: "numeric", month: "2-digit", day: "2-digit" });
  return `${part(p, "year")}-${part(p, "month")}-${part(p, "day")}`;
};

function daysSince(iso, today) {
  if (!iso) return null;
  const days = Math.round((utcDate(today) - utcDate(String(iso).slice(0, 10))) / 86_400_000);
  return Number.isFinite(days) ? Math.max(days, 0) : null;
}

function duration(start, end) {
  const minutes = Math.round((new Date(end) - new Date(start)) / 60_000);
  if (!Number.isFinite(minutes) || minutes <= 0) return "";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
}

// A message's time: the clock today, the weekday this week, the date before that.
function when(iso, today, timeZone) {
  if (!iso) return "";
  const day = ymdIn(iso, timeZone);
  if (day === today) return clock(iso, timeZone);
  const ago = daysSince(day, today);
  if (ago != null && ago < 7) return part(inZone(iso, timeZone, { weekday: "short" }), "weekday");
  return monthDay(iso, timeZone);
}

// ---- small parts -----------------------------------------------------------------

const badge = (doc, text, tone, attrs) => h(doc, "span", { class: `b${tone ? ` ${tone}` : ""}`, ...attrs }, text);

function cell(doc, signal, name, tone, tip, ...extra) {
  const attrs = { class: "ic", "data-signal": signal };
  if (tip) Object.assign(attrs, { "data-tip": tip, tabindex: "0", "aria-label": tip });
  return h(doc, "span", attrs, name ? icon(doc, name, tone) : null, ...extra);
}

const blank = (doc, signal) => h(doc, "span", { class: "ic", "data-signal": signal });

function action(doc, { tone, verb, url, sub }) {
  const linked = isHttps(url);
  const inner = [
    h(doc, "span", { class: "v" }, verb, linked ? icon(doc, "arrow") : null),
    sub ? h(doc, "span", { class: "sub" }, sub) : null,
  ];
  const cls = `act ${linked ? tone : "idle"}`;
  return linked
    ? h(doc, "a", { class: cls, href: url, target: "_blank", rel: "noopener noreferrer", "data-action": "" }, inner)
    : h(doc, "span", { class: cls, "data-action": "" }, inner);
}

function row(doc, { ln, title, tags, meta, extra, sig, when: age, lateness, act, cls, attrs }) {
  return h(
    doc,
    "div",
    { class: `row${cls ? ` ${cls}` : ""}`, ...attrs },
    h(doc, "span", { class: "ln" }, ln ?? ""),
    h(
      doc,
      "div",
      { class: "body" },
      h(doc, "div", { class: "t" }, title),
      tags?.length ? h(doc, "div", { class: "tags" }, tags) : null,
      (Array.isArray(meta) ? meta.length : meta) ? h(doc, "div", { class: "m" }, meta) : null,
      extra,
    ),
    h(doc, "span", { class: "sig" }, sig),
    h(doc, "span", { class: `when${lateness ? ` ${lateness}` : ""}` }, age ?? ""),
    act,
  );
}

function section(doc, { id, numeral, label, count, children, slot }) {
  return h(
    doc,
    "section",
    { class: "part", id, "data-section": id, "data-slot": slot ?? id },
    h(doc, "h2", null, h(doc, "span", { class: "pn" }, numeral), label, h(doc, "span", { class: "cnt" }, count)),
    children,
  );
}

function sourceError(doc, brief, source, slot) {
  const error = brief.sources?.[source]?.error ?? "unknown error";
  return h(
    doc,
    "p",
    { class: "source-error", "data-source-error": source, "data-slot": slot },
    icon(doc, "alert", "bad"),
    `Couldn't reach ${SOURCE_NAMES[source]}: ${error}. The next run tries again.`,
  );
}

function fold(doc, group, open, summary, rows) {
  return h(
    doc,
    "details",
    { class: "acc", "data-group": group, open },
    h(doc, "summary", null, icon(doc, "chev"), summary),
    rows,
  );
}

// ---- people ----------------------------------------------------------------------

function initials(name) {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "?") + (words.length > 1 ? words.at(-1)[0] : "")).toUpperCase();
}

// One look for every teammate on the page: the same circle in a pill or a pile,
// naming them on hover.
function face(doc, person, note) {
  const tip = [person.name, person.org, note].filter(Boolean).join(" · ");
  return h(
    doc,
    "span",
    { class: "av", "data-tip": tip, tabindex: "0", "aria-label": tip },
    isPhoto(person.photo) ? h(doc, "img", { src: person.photo, alt: "" }) : h(doc, "b", null, initials(person.name)),
  );
}

function pill(doc, person, note) {
  return h(
    doc,
    "span",
    { class: "pp", "data-person": person.email },
    face(doc, person, note),
    String(person.name ?? person.email).split(/\s+/)[0],
  );
}

function pile(doc, people) {
  return h(
    doc,
    "span",
    { class: "pile" },
    people.map(({ person, note }) => h(doc, "span", { class: "pile-face", "data-person": person.email }, face(doc, person, note))),
  );
}

const resolve = (people, email, fallback = {}) => {
  const known = people[email];
  return {
    email,
    name: known?.name || fallback.name || email,
    org: known?.org || fallback.org || null,
    photo: known?.photo ?? null,
  };
};

const isTeammate = (people, attendee) => Boolean(people[attendee.email]) || attendee.org === "Taxwire";

// Externals as plain text, grouped by organisation: "Ken, James · Oneleet".
function externals(doc, attendees) {
  const byOrg = new Map();
  for (const a of attendees) {
    const org = a.org ?? "";
    byOrg.set(org, [...(byOrg.get(org) ?? []), a.name ?? a.email]);
  }
  return [...byOrg].map(([org, names]) => h(doc, "span", { class: "ext" }, org ? `${names.join(", ")} · ${org}` : names.join(", ")));
}

// ---- PRs -------------------------------------------------------------------------

const PREFIX = /^[a-z]+(?:\(([^)]*)\))?!?:\s*/;
const PART = /\(\d+\/\d+\)\s*/;

function cleanTitle(title) {
  const raw = String(title ?? "");
  const scope = raw.match(PREFIX)?.[1] ?? "";
  const text = raw.replace(PREFIX, "").replace(PART, "");
  return { text: text.charAt(0).toUpperCase() + text.slice(1), scope };
}

const shortRepo = (repo) => String(repo ?? "").split("/").pop().replace(/^taxwire-/, "");

function ref(doc, repo, numbers) {
  return h(doc, "span", { class: "ref" }, shortRepo(repo), h(doc, "b", null, `#${numbers}`));
}

function sizeOf(pr) {
  const total = (pr.additions ?? 0) + (pr.deletions ?? 0);
  if (pr.reviewable_additions == null) return { add: pr.additions ?? 0, del: pr.deletions ?? 0, hidden: null };
  const add = pr.reviewable_additions;
  const del = pr.reviewable_deletions ?? 0;
  return { add, del, hidden: Math.max(total - add - del, 0) };
}

const bucket = (n) => (n <= 10 ? "XS" : n <= 100 ? "S" : n <= 500 ? "M" : n <= 1000 ? "L" : "XL");

function sizeBadge(doc, pr) {
  const { add, del, hidden } = sizeOf(pr);
  const lines = add + del;
  const tip =
    hidden == null ? `${lines} lines changed` : `${lines} reviewable lines${hidden ? `, ${hidden} test lines not counted` : ""}`;
  return h(
    doc,
    "span",
    { class: "sz", "data-tip": tip, tabindex: "0", "aria-label": tip },
    h(doc, "b", null, bucket(lines)),
    h(doc, "span", { class: "add" }, `+${add}`),
    h(doc, "span", { class: "del" }, `−${del}`),
  );
}

function signals(doc, pr) {
  const state = pr.mergeable_state;
  const check = pr.failing_check?.name;
  const ci = {
    success: ["ci-ok", "ok", "CI passing"],
    failure: ["ci-fail", "bad", `CI failing${check ? `: ${check}` : ""}`],
    pending: ["ci-run", "warn", "CI running"],
    none: ["none", "dim", "No CI checks"],
  }[pr.ci] ?? ["none", "dim", "CI not checked"];
  const merge = {
    clean: ["merge", "ok", "Mergeable"],
    has_hooks: ["merge", "ok", "Mergeable"],
    unstable: ["merge", "warn", "Mergeable, with failing checks"],
    dirty: ["conflict", "bad", "Merge conflict"],
    behind: ["behind", "warn", `Behind ${pr.base_ref || "main"}`],
    blocked: ["merge", "dim", "Blocked by required checks or reviews"],
    draft: ["none", "dim", "Draft"],
  }[state] ?? ["none", "dim", "Mergeability not computed yet"];
  const review = {
    APPROVED: ["approved", "ok", "Approved"],
    CHANGES_REQUESTED: ["changes", "bad", "Changes requested"],
    REVIEW_REQUIRED: ["needs-review", "warn", "Needs a review"],
  }[pr.review_decision] ?? ["none", "dim", "No review yet"];
  const threads = pr.unresolved_threads;
  return [
    cell(doc, "ci", ...ci),
    cell(doc, "merge", ...merge),
    cell(doc, "review", ...review),
    threads > 0
      ? cell(doc, "threads", "thread", "warn", plural(threads, "unresolved thread"), h(doc, "i", null, threads))
      : threads === 0
        ? blank(doc, "threads")
        : cell(doc, "threads", "none", "dim", "Threads not checked"),
  ];
}

const VERDICT_TONES = { blocking: "bad", "needs-work": "warn", minor: "ok", "ship-ready": "ok" };
const SEVERITIES = ["critical", "high", "medium", "low"];

function reviewDetails(doc, review) {
  const verdict = String(review.verdict ?? "reviewed");
  const counts = review.counts ?? {};
  const issues = parseReviewIssues(review.markdown);
  return h(
    doc,
    "details",
    { class: "rv", "data-review": "" },
    h(
      doc,
      "summary",
      { class: `b review ${VERDICT_TONES[verdict] ?? ""}` },
      icon(doc, "chev"),
      `1st pass · ${verdict.replace(/-/g, " ")}`,
      SEVERITIES.filter((k) => counts[k]).map((k) => h(doc, "i", { class: `sev ${k}` }, `${counts[k]}${k[0].toUpperCase()}`)),
    ),
    issues.length
      ? h(
          doc,
          "ol",
          { class: "issues" },
          issues.map((issue) =>
            h(
              doc,
              "li",
              { "data-issue": issue.id },
              h(doc, "span", { class: `sev ${String(issue.severity).toLowerCase()}` }, issue.severity),
              h(doc, "span", { class: "it" }, issue.title),
              h(doc, "code", null, issue.location),
            ),
          ),
        )
      : null,
    h(doc, "details", { class: "full" }, h(doc, "summary", null, "Full review"), h(doc, "pre", null, review.markdown ?? "")),
  );
}

function author(doc, pr, people) {
  return pr.author_email && people[pr.author_email]
    ? pill(doc, resolve(people, pr.author_email))
    : h(doc, "span", { class: "ext" }, pr.author ?? "");
}

function colhead(doc, ageTip) {
  const heads = [
    ["ci", "ci-ok", "CI checks"],
    ["merge", "merge", "Mergeable with base"],
    ["review", "shield", "Review decision"],
    ["threads", "thread", "Unresolved review threads"],
  ];
  return h(
    doc,
    "div",
    { class: "row colhead" },
    h(doc, "span", { class: "ln" }),
    h(doc, "span", { class: "body" }),
    h(doc, "span", { class: "sig" }, heads.map(([signal, name, tip]) => cell(doc, signal, name, "colh", tip))),
    cell(doc, "age", "hourglass", "colh", ageTip),
    h(doc, "span"),
  );
}

const lateness = (days) => (days != null && days >= 14 ? "late" : "");

function reviewRow(doc, pr, n, reviews, people, today) {
  const { text, scope } = cleanTitle(pr.title);
  const { add, del } = sizeOf(pr);
  const days = daysSince(pr.waiting_since, today);
  const review = pr.review_id ? reviews[pr.review_id] : null;
  return row(doc, {
    ln: n,
    title: text,
    tags: [author(doc, pr, people), ref(doc, pr.repo, pr.number), sizeBadge(doc, pr)],
    meta: [scope, pr.blocking_signal].filter(Boolean).join(" · "),
    extra: review ? reviewDetails(doc, review) : null,
    sig: signals(doc, pr),
    when: days == null ? "" : `${days}d`,
    lateness: lateness(days),
    act: action(doc, { tone: "do", verb: "Review", url: `${pr.url}/files`, sub: `${add + del} lines` }),
    attrs: { "data-pr": pr.number },
  });
}

function compactRow(doc, pr, verb, people, today) {
  const { text, scope } = cleanTitle(pr.title);
  const days = daysSince(pr.waiting_since ?? pr.created_at, today);
  return row(doc, {
    title: text,
    tags: [verb === "Review" ? author(doc, pr, people) : null, ref(doc, pr.repo, pr.number), sizeBadge(doc, pr)],
    meta: scope,
    sig: signals(doc, pr),
    when: days == null ? "" : `${days}d`,
    act: action(doc, { tone: "quiet", verb, url: verb === "Review" ? `${pr.url}/files` : pr.url, sub: "" }),
    cls: "compact",
    attrs: { "data-pr": pr.number },
  });
}

const staleBadge = (doc, pr) =>
  pr.stale && pr.stale_closes_on ? badge(doc, `stale · closes ${weekdayMonthDay(pr.stale_closes_on)}`, "bad") : null;

function myRow(doc, pr, n, reviews, today) {
  const { text, scope } = cleanTitle(pr.title);
  const days = daysSince(pr.created_at, today);
  const review = pr.review_id ? reviews[pr.review_id] : null;
  return row(doc, {
    ln: n,
    title: text,
    tags: [ref(doc, pr.repo, pr.number), sizeBadge(doc, pr), staleBadge(doc, pr)],
    meta: scope,
    extra: review ? reviewDetails(doc, review) : null,
    sig: signals(doc, pr),
    when: days == null ? "" : `${days}d`,
    lateness: lateness(days),
    act: action(doc, nextStep(pr)),
    attrs: { "data-pr": pr.number, "data-key": pr.number },
  });
}

function stackRow(doc, chain, n, today) {
  const bottom = chain[0];
  const { scope } = cleanTitle(bottom.title);
  const name = scope ? `${scope.charAt(0).toUpperCase()}${scope.slice(1)} stack` : `Stack on ${bottom.base_ref}`;
  const step = nextStep(bottom);
  const days = daysSince(bottom.created_at, today);
  const segments = h(
    doc,
    "span",
    { class: "stack" },
    chain.map((pr, i) => {
      const own = nextStep(pr);
      const tip = `#${pr.number}: ${own.verb}`;
      return link(doc, pr.url, { class: `seg ${own.tone}`, "data-segment": "", "data-tip": tip, "aria-label": tip }, String(i + 1));
    }),
  );
  return row(doc, {
    ln: n,
    title: [name, h(doc, "span", { class: "cnt2" }, plural(chain.length, "PR"))],
    tags: [ref(doc, bottom.repo, `${bottom.number}–${chain.at(-1).number}`), segments, staleBadge(doc, bottom)],
    meta: `Bottom first: 1/${chain.length} ${cleanTitle(bottom.title).text.replace(/^./, (c) => c.toLowerCase())}`,
    sig: signals(doc, bottom),
    when: days == null ? "" : `${days}d`,
    lateness: lateness(days),
    act: action(doc, { ...step, tone: bottom.stale ? "fix" : step.tone, sub: `1/${chain.length} first` }),
    attrs: { "data-key": `stack-${bottom.number}` },
  });
}

// ---- meetings and messages ---------------------------------------------------------

const KINDS = {
  customer: ["Customer", "brand"],
  prospect: ["Prospect", "brand"],
  partner: ["Partner", "brand"],
  internal: ["Internal", ""],
  prep: ["Prep", "warn"],
};
const CONFERENCES = {
  meet: ["video", "Google Meet"],
  teams: ["video", "Microsoft Teams"],
  zoom: ["video", "Zoom"],
  phone: ["phone", "Phone call"],
};

function attendeeTags(doc, meeting, people) {
  const attendees = meeting.attendees ?? [];
  const team = attendees.filter((a) => isTeammate(people, a));
  const others = attendees.filter((a) => !isTeammate(people, a));
  const note = (a) => (a.organizer ? "organizer" : a.optional ? "optional" : "");
  const faces = team.map((a) => ({ person: resolve(people, a.email, a), note: note(a) }));
  return [faces.length > 3 ? pile(doc, faces) : faces.map(({ person, note: n }) => pill(doc, person, n)), externals(doc, others)];
}

function meetingRow(doc, meeting, i, people, timeZone) {
  const [kindLabel, kindTone] = KINDS[meeting.kind] ?? [];
  const missing = meeting.on_calendar === false;
  const prep = meeting.action;
  const prepAction = prep && { tone: "warn", verb: prep.verb, url: prep.url, sub: prep.by ? `by ${prep.by}` : "" };
  const act = missing
    ? action(doc, { tone: "fix", verb: "Add", url: meeting.url, sub: "to calendar" })
    : action(doc, prepAction ?? { tone: "idle", verb: "No prep", url: null, sub: "" });
  const then =
    missing && prep && isHttps(prep.url)
      ? h(doc, "span", { class: "then", "data-then": "" }, "Then ", link(doc, prep.url, null, prep.verb, icon(doc, "arrow")), prep.by ? ` by ${prep.by}` : "")
      : null;
  const [conferenceIcon, conferenceName] = CONFERENCES[meeting.conference] ?? ["none", "No call link"];
  return row(doc, {
    ln: clock(meeting.start, timeZone),
    title: link(doc, missing ? null : meeting.url, { class: "tl" }, meeting.title),
    tags: [
      missing ? badge(doc, "Not on calendar", "alarm", { "data-badge": "not-on-calendar" }) : null,
      kindLabel ? badge(doc, kindLabel, kindTone) : null,
      attendeeTags(doc, meeting, people),
    ],
    meta: [meeting.context, then].filter(Boolean).flatMap((x, j) => (j ? [" ", x] : [x])),
    sig: cell(doc, "conference", conferenceIcon, "dim", conferenceName),
    when: duration(meeting.start, meeting.end),
    act,
    cls: "mtg",
    attrs: { "data-meeting": i },
  });
}

function itemRow(doc, item, ln, source, defaults, people, today, timeZone) {
  const step = item.action
    ? { tone: defaults.tone, verb: item.action.verb, url: item.action.url, sub: item.action.by ? `by ${item.action.by}` : "" }
    : defaults.fallback(item);
  return row(doc, {
    ln,
    title: link(doc, item.url, { class: "tl" }, item.title),
    tags: [
      item.tag ? badge(doc, item.tag, "warn") : null,
      (item.people ?? []).map((email) => pill(doc, resolve(people, email))),
      item.who ? h(doc, "span", { class: "ext" }, item.who) : null,
    ],
    meta: item.summary,
    sig: cell(doc, "source", source === "gmail" ? "mail" : "slack", "dim", SOURCE_NAMES[source]),
    when: when(item.when, today, timeZone),
    act: action(doc, step),
    attrs: { "data-item": ln },
  });
}

// ---- the page ----------------------------------------------------------------------

function header(doc, brief, today) {
  const since = brief.since
    ? `since ${part(inZone(brief.since, brief.timezone, { weekday: "short" }), "weekday")} ${clock(brief.since, brief.timezone)}`
    : null;
  return h(
    doc,
    "header",
    { class: "head" },
    h(doc, "div", { class: "mark" }, logo(doc), h(doc, "span", null, "Form MR-1")),
    h(doc, "h1", null, "Morning return"),
    h(doc, "p", { class: "date" }, h(doc, "b", null, longDay(today)), [since, brief.login].filter(Boolean).join(" · ")),
  );
}

function totals(doc, brief, counts) {
  const items = [
    ["review", "Review", "#review-prs", ["github"]],
    ["fix", "Fix", "#my-prs", ["github"]],
    ["merge", "Merge", "#my-prs", ["github"]],
    ["reply", "Reply", "#replies", ["gmail", "slack"]],
    ["meetings", "Meetings", "#meetings", ["calendar"]],
  ];
  return h(
    doc,
    "nav",
    { class: "totals", "aria-label": "Totals" },
    items.map(([key, label, href, sources]) => {
      const known = sources.every((s) => sourceOk(brief, s));
      const n = counts[key];
      const hot = known && n > 0 && ["review", "fix", "reply"].includes(key);
      return h(
        doc,
        "a",
        { class: `tot${hot ? " hot" : ""}`, href, "data-total": key },
        h(doc, "span", { class: "n" }, known ? String(n) : "—"),
        h(doc, "span", { class: "l" }, label),
      );
    }),
  );
}

export function renderBrief(doc, brief, { reviews = {}, people = {}, today } = {}) {
  today ??= brief.run_date;
  const tz = brief.timezone ?? "UTC";
  const left = [];
  const right = [];
  const counts = { review: 0, fix: 0, merge: 0, reply: 0, meetings: 0 };

  // Left: the PRs.
  if (!sourceOk(brief, "github")) {
    left.push(sourceError(doc, brief, "github", "review-prs"));
  } else {
    let n = 0;
    const reviewPrs = rankReviewPrs(brief.review_prs ?? []);
    const team = brief.team_review_prs ?? [];
    counts.review = reviewPrs.length;
    if (reviewPrs.length || team.length) {
      left.push(
        section(doc, {
          id: "review-prs",
          numeral: "I",
          label: "To review",
          count: reviewPrs.length,
          children: [
            colhead(doc, "Days waiting on you"),
            reviewPrs.map((pr) => reviewRow(doc, pr, ++n, reviews, people, today)),
            team.length
              ? fold(doc, "team", true, [h(doc, "b", null, `${team.length} more`), " requested from your teams"], team.map((pr) => compactRow(doc, pr, "Review", people, today)))
              : null,
          ],
        }),
      );
    }

    const mine = brief.my_prs ?? [];
    const drafts = mine.filter((pr) => pr.draft === true || pr.mergeable_state === "draft");
    const { stacks, singles } = groupStacks(mine.filter((pr) => !drafts.includes(pr)));
    const rows = rankMine([
      ...stacks.map((chain) => ({ lead: chain[0], chain })),
      ...singles.map((pr) => ({ lead: pr })),
    ]);
    for (const r of rows) {
      const tone = r.chain && r.lead.stale ? "fix" : nextStep(r.lead).tone;
      if (tone === "fix") counts.fix += 1;
      if (nextStep(r.lead).verb === "Merge") counts.merge += 1;
    }
    if (mine.length) {
      left.push(
        section(doc, {
          id: "my-prs",
          numeral: "II",
          label: "Your pull requests",
          count: mine.length,
          children: [
            colhead(doc, "Days open"),
            rows.map((r) => (r.chain ? stackRow(doc, r.chain, ++n, today) : myRow(doc, r.lead, ++n, reviews, today))),
            drafts.length
              ? fold(doc, "drafts", false, h(doc, "b", null, plural(drafts.length, "draft")), drafts.map((pr) => compactRow(doc, pr, "Open", people, today)))
              : null,
          ],
        }),
      );
    }

    const closed = brief.stale_closed ?? [];
    if (closed.length) {
      left.push(
        section(doc, {
          id: "stale-closed",
          numeral: "III",
          label: "Closed as stale",
          count: closed.length,
          children: closed.map((pr) => {
            const days = daysSince(pr.closed_at, today);
            return row(doc, {
              ln: ++n,
              title: cleanTitle(pr.title).text,
              tags: [ref(doc, pr.repo, pr.number)],
              meta: "The stale bot closed it. Reopen it to keep the work.",
              sig: ["ci", "merge", "review", "threads"].map((s) => blank(doc, s)),
              when: days == null ? "" : `${days}d`,
              act: action(doc, { tone: "warn", verb: "Reopen", url: pr.url, sub: `closed ${monthDay(pr.closed_at, tz)}` }),
              attrs: { "data-pr": pr.number },
            });
          }),
        }),
      );
    }
  }

  // Right: the day.
  if (!sourceOk(brief, "calendar")) {
    right.push(sourceError(doc, brief, "calendar", "meetings"));
  } else {
    // Briefs written before meetings were gathered only have `today.events`.
    const listed = brief.meetings ?? (brief.today?.events ?? []).map((e) => ({ ...e, on_calendar: true }));
    const meetings = [...listed].sort((a, b) => String(a.start).localeCompare(String(b.start)));
    counts.meetings = meetings.length;
    if (meetings.length) {
      right.push(
        section(doc, {
          id: "meetings",
          numeral: "A",
          label: "Meetings",
          count: meetings.length,
          children: meetings.map((m, i) => meetingRow(doc, m, i, people, tz)),
        }),
      );
    }
  }

  const replies = [
    ...(sourceOk(brief, "gmail") ? brief.mail_asks ?? [] : []).map((item) => ["gmail", item]),
    ...(sourceOk(brief, "slack") ? brief.slack_asks ?? [] : []).map((item) => ["slack", item]),
  ];
  counts.reply = replies.length;
  const replyDefaults = { tone: "do", fallback: (item) => ({ tone: "do", verb: "Reply", url: item.url, sub: "" }) };
  if (replies.length) {
    right.push(
      section(doc, {
        id: "replies",
        numeral: "B",
        label: "Replies owed",
        count: replies.length,
        children: replies.map(([source, item], i) => itemRow(doc, item, `B${i + 1}`, source, replyDefaults, people, today, tz)),
      }),
    );
  }
  if (!sourceOk(brief, "gmail")) right.push(sourceError(doc, brief, "gmail", "replies"));

  if (!sourceOk(brief, "slack")) {
    right.push(sourceError(doc, brief, "slack", "fyi"));
  } else {
    const fyi = brief.slack_discussions ?? [];
    const fyiDefaults = {
      tone: "warn",
      fallback: (item) => (isHttps(item.url) ? { tone: "quiet", verb: "Read", url: item.url, sub: "" } : { tone: "idle", verb: "FYI", url: null, sub: "" }),
    };
    if (fyi.length) {
      right.push(
        section(doc, {
          id: "fyi",
          numeral: "C",
          label: "Worth knowing",
          count: fyi.length,
          children: fyi.map((item, i) => itemRow(doc, item, `C${i + 1}`, "slack", fyiDefaults, people, today, tz)),
        }),
      );
    }
  }

  const notes = brief.notes ?? [];
  if (notes.length) right.push(h(doc, "ul", { class: "foot", "data-notes": "", "data-slot": "notes" }, notes.map((note) => h(doc, "li", null, note))));

  const banner =
    brief.run_date && brief.run_date !== today
      ? h(doc, "p", { class: "banner", "data-banner": "stale-brief" }, `This is the brief from ${longDay(brief.run_date)}. Today's run hasn't finished yet.`)
      : null;

  return h(
    doc,
    "div",
    { class: "form" },
    header(doc, brief, today),
    banner,
    totals(doc, brief, counts),
    h(doc, "div", { class: "cols" }, h(doc, "div", { class: "col" }, left), h(doc, "div", { class: "col" }, right)),
  );
}

const EMPTY = {
  "no-brief": [
    "No brief yet",
    "The Routine writes one each morning. Once the first run finishes, it appears here on its own.",
  ],
  "no-db": [
    "Open this page on claude.ai",
    "The brief lives in this page's database, which only loads on claude.ai while you're signed in.",
  ],
};

export function renderEmpty(doc, reason) {
  const [title, body] = EMPTY[reason] ?? EMPTY["no-brief"];
  return h(
    doc,
    "div",
    { class: "form empty" },
    h(doc, "header", { class: "head" }, h(doc, "div", { class: "mark" }, logo(doc)), h(doc, "h1", null, "Morning return")),
    h(doc, "div", { class: "empty-body" }, h(doc, "h2", null, title), h(doc, "p", null, body)),
  );
}
