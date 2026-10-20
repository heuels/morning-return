// Renders one morning brief (see brief-format.md) as DOM, laid out like a
// return form: a header, a row of totals, then PRs on the left and the day
// (meetings, replies owed, Linear, worth knowing) on the right. Every item is
// the same row: line number, what it is, status icons, age or length, and one
// action for this morning.
//
// Everything gathered from GitHub, Slack, mail, Linear and calendars is set as
// text, never as markup. Only https:// links become anchors, and photos load
// only from data:image/ URIs.

import { icon, logo } from "./icons.js";
import { renderMarkdown } from "./markdown.js";
import { groupStacks, nextStep, rankMine, rankReviewPrs } from "./rank.js";
import { parseReviewIssues } from "./review.js";
import { prefillUrl, reviewPrompt, stepPrompt, title as sessionTitle } from "./session.js";

const SOURCE_NAMES = { github: "GitHub", slack: "Slack", gmail: "Gmail", calendar: "Google Calendar", linear: "Linear" };

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
const firstName = (name) => String(name ?? "").split(/\s+/)[0];

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
const weekday = (ymd) => part(inZone(`${ymd}T12:00:00Z`, "UTC", { weekday: "short" }), "weekday");
const weekdayMonthDay = (ymd) => `${weekday(ymd)} ${monthDay(`${ymd}T12:00:00Z`)}`;
const clock = (iso, timeZone) => {
  const p = inZone(iso, timeZone, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return p.length ? `${part(p, "hour")}:${part(p, "minute")}` : "";
};
const minutesIn = (iso, timeZone) => {
  const [hh, mm] = clock(iso, timeZone).split(":").map(Number);
  return Number.isFinite(hh) ? hh * 60 + mm : null;
};
const ymdIn = (iso, timeZone) => {
  const p = inZone(iso, timeZone, { year: "numeric", month: "2-digit", day: "2-digit" });
  return `${part(p, "year")}-${part(p, "month")}-${part(p, "day")}`;
};
const addDays = (ymd, n) => new Date(utcDate(ymd).getTime() + n * 86_400_000).toISOString().slice(0, 10);

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
      tags?.flat(Infinity).some(Boolean) ? h(doc, "div", { class: "tags" }, tags) : null,
      (Array.isArray(meta) ? meta.length : meta) ? h(doc, "div", { class: "m" }, meta) : null,
      extra,
    ),
    h(doc, "span", { class: "sig" }, sig),
    h(doc, "span", { class: `when${lateness ? ` ${lateness}` : ""}` }, age ?? ""),
    act,
  );
}

// PR sections carry their column icons in the heading itself, lined up with
// the rows below; the other sections have a plain heading.
const COLUMNS = [
  ["ci", "ci-ok", "CI checks"],
  ["merge", "merge", "Mergeable with base"],
  ["review", "shield", "Review decision"],
  ["threads", "thread", "Unresolved review threads"],
];

function section(doc, { id, numeral, label, count, children, ageTip }) {
  const heading = ageTip
    ? h(
        doc,
        "h2",
        { class: "cols-h" },
        h(doc, "span", { class: "lbl" }, h(doc, "span", { class: "pn" }, numeral), label),
        h(doc, "span", { class: "sig" }, COLUMNS.map(([signal, name, tip]) => cell(doc, signal, name, "colh", tip))),
        cell(doc, "age", "hourglass", "colh", ageTip),
        h(doc, "span", { class: "cntc" }, h(doc, "span", { class: "cnt" }, count)),
      )
    : h(doc, "h2", null, h(doc, "span", { class: "pn" }, numeral), label, h(doc, "span", { class: "cnt" }, count));
  return h(doc, "section", { class: "part", id, "data-section": id, "data-slot": id }, heading, children);
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
  return h(doc, "details", { class: "acc", "data-group": group, open }, h(doc, "summary", null, icon(doc, "chev"), h(doc, "span", null, summary)), rows);
}

// ---- people ----------------------------------------------------------------------

function initials(name) {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "?") + (words.length > 1 ? words.at(-1)[0] : "")).toUpperCase();
}

// When someone is out in the next week: "out today", "out Fri", "out Fri–Mon".
function outLabel(entry, today) {
  if (!entry) return "";
  const last = addDays(entry.end, -1);
  if (entry.start <= today && today < entry.end) return last > today ? `out until ${weekday(last)}` : "out today";
  return `out ${weekday(entry.start)}${last > entry.start ? `–${weekday(last)}` : ""}`;
}

// One look for every teammate on the page: the same circle in a pill or a
// pile, naming them on hover.
function face(ctx, person, note) {
  const { doc } = ctx;
  const out = outLabel(ctx.out.get(person.email), ctx.today);
  const tip = [person.name, person.org, note, out].filter(Boolean).join(" · ");
  return h(
    doc,
    "span",
    { class: "av", "data-tip": tip, tabindex: "0", "aria-label": tip },
    isPhoto(person.photo) ? h(doc, "img", { src: person.photo, alt: "" }) : h(doc, "b", null, initials(person.name)),
  );
}

const pill = (ctx, person, note) =>
  h(ctx.doc, "span", { class: "pp", "data-person": person.email }, face(ctx, person, note), firstName(person.name ?? person.email));

const pile = (ctx, people) =>
  h(
    ctx.doc,
    "span",
    { class: "pile" },
    people.map(({ person, note }) => h(ctx.doc, "span", { class: "pile-face", "data-person": person.email }, face(ctx, person, note))),
  );

function resolve(ctx, email, fallback = {}) {
  const known = ctx.people[email];
  const away = ctx.out.get(email);
  return {
    email,
    name: known?.name || fallback.name || away?.name || email,
    org: known?.org || fallback.org || (away ? "Taxwire" : null),
    photo: known?.photo ?? null,
  };
}

const isTeammate = (ctx, attendee) => Boolean(ctx.people[attendee.email]) || attendee.org === "Taxwire";

// Anyone who isn't a teammate: the same rounded pill, grey and without a photo.
function guest(doc, name, tip) {
  return h(doc, "span", { class: "pp guest", "data-external": "", "data-tip": tip ?? name, tabindex: "0", "aria-label": tip ?? name }, name);
}

// Outside attendees as grey pills, each organisation named once after its people.
function externals(doc, attendees) {
  const byOrg = new Map();
  for (const a of attendees) byOrg.set(a.org ?? "", [...(byOrg.get(a.org ?? "") ?? []), a]);
  return [...byOrg].map(([org, people]) => [
    people.map((a) => {
      const name = a.name ?? a.email;
      return guest(doc, name, [name, org, a.organizer ? "organizer" : a.optional ? "optional" : ""].filter(Boolean).join(" · "));
    }),
    org ? h(doc, "span", { class: "ext" }, org) : null,
  ]);
}

// A badge for each person on this PR who is out this week.
function awayBadges(ctx, people) {
  return people
    .filter(({ email }) => ctx.out.has(email))
    .map(({ email, role }) => {
      const who = resolve(ctx, email);
      return badge(ctx.doc, `${firstName(who.name)} ${outLabel(ctx.out.get(email), ctx.today)}${role ? ` · ${role}` : ""}`, "warn");
    });
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

const ref = (doc, repo, numbers) => h(doc, "span", { class: "ref" }, shortRepo(repo), h(doc, "b", null, `#${numbers}`));

function linearChip(ctx, id) {
  const issue = id ? ctx.linear[id] : null;
  if (!issue) return null;
  return link(ctx.doc, issue.url, { class: "lin", "data-tip": issue.title, "aria-label": `${id}: ${issue.title}` }, id);
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
  const tip = hidden == null ? `${lines} lines changed` : `${lines} reviewable lines${hidden ? `, ${hidden} test lines not counted` : ""}`;
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
  }[pr.mergeable_state] ?? ["none", "dim", "Mergeability not computed yet"];
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
      : cell(doc, "threads", "none", "dim", threads === 0 ? "No unresolved threads" : "Threads not checked"),
  ];
}

// ---- dialogs: the full review, and starting a Claude Code session -------------------

function dialogShell(doc, kind, heading) {
  const close = h(doc, "button", { type: "button", class: "x", "aria-label": "Close" }, icon(doc, "close"));
  const body = h(doc, "div", { class: "dlg-body" });
  const dialog = h(
    doc,
    "dialog",
    { class: `dlg ${kind}`, [`data-${kind}-dialog`]: "", "aria-label": heading },
    h(doc, "header", { class: "dlg-head" }, h(doc, "h2", null, heading), close),
    body,
  );
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  return { dialog, body };
}

function show(dialog) {
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function reviewDialog(ctx) {
  const { dialog, body } = dialogShell(ctx.doc, "review", "First-pass review");
  return {
    dialog,
    open(pr, review) {
      dialog.querySelector(".dlg-head h2").textContent = `First-pass review · ${shortRepo(pr.repo)}#${pr.number}`;
      body.replaceChildren(
        h(ctx.doc, "p", { class: "dlg-sub" }, cleanTitle(pr.title).text, " · ", String(review.verdict ?? "").replace(/-/g, " ")),
        renderMarkdown(ctx.doc, review.markdown),
      );
      show(dialog);
    },
  };
}

function sessionDialog(ctx) {
  const { doc, brief } = ctx;
  const { dialog, body } = dialogShell(doc, "session", "Start a Claude Code session");
  const titleInput = h(doc, "input", { name: "title", id: "session-title", type: "text", autocomplete: "off" });
  const prompt = h(doc, "textarea", { name: "prompt", id: "session-prompt", rows: "14", spellcheck: "false" });
  const where = h(doc, "p", { class: "dlg-sub" });
  const status = h(doc, "p", { class: "dlg-status", role: "status" });
  const fallback = h(doc, "a", { class: "btn", "data-session-link": "", target: "_blank", rel: "noopener noreferrer" }, "Open in claude.ai/code", icon(doc, "arrow"));
  const start = ctx.startSession ? h(doc, "button", { type: "button", class: "btn primary", "data-start": "" }, icon(doc, "terminal"), "Start session") : null;
  if (!start) fallback.classList.add("primary");
  const cancel = h(doc, "button", { type: "button", class: "btn quiet" }, "Cancel");
  cancel.addEventListener("click", () => dialog.close());
  body.append(
    h(doc, "label", { for: "session-title" }, "Title"),
    titleInput,
    h(doc, "label", { for: "session-prompt" }, "Prompt"),
    prompt,
    where,
    h(doc, "div", { class: "dlg-actions" }, start, fallback, cancel),
    status,
  );

  let target = null;
  const environment = brief.environment ?? {};
  const refreshLink = () => {
    fallback.href = prefillUrl({ prompt: prompt.value, repo: target?.repo, environment: environment.name ?? environment.id });
  };
  prompt.addEventListener("input", refreshLink);

  start?.addEventListener("click", async () => {
    start.disabled = true;
    status.className = "dlg-status";
    status.textContent = "Starting…";
    try {
      const { url } = await ctx.startSession({
        title: titleInput.value.trim(),
        prompt: prompt.value,
        repo: target.repo,
        branch: target.branch,
        environment_id: environment.id ?? null,
      });
      status.replaceChildren(
        "Started. ",
        isHttps(url) ? link(doc, url, { class: "go" }, "Open the session", icon(doc, "arrow")) : "Find it at claude.ai/code.",
      );
    } catch (error) {
      status.className = "dlg-status bad";
      status.textContent = error?.message || "Couldn't start the session. Use the claude.ai/code link instead.";
      start.disabled = false;
    }
  });

  return {
    dialog,
    open({ title, text, repo, branch }) {
      target = { repo, branch };
      titleInput.value = title;
      prompt.value = text;
      where.textContent = [repo, branch, environment.name].filter(Boolean).join(" · ");
      status.textContent = "";
      if (start) start.disabled = false;
      refreshLink();
      show(dialog);
    },
  };
}

function sessionButton(ctx, label, open) {
  const button = h(ctx.doc, "button", { type: "button", class: "cc", "data-session": "" }, icon(ctx.doc, "terminal"), label);
  button.addEventListener("click", open);
  return button;
}

// GitHub anchors a file in a PR's "Files changed" view by the SHA-256 of its
// path, and a line on the new side with R<line>.
async function diffAnchor(path) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(path));
  return `diff-${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function codeLink(ctx, pr, location) {
  const files = `${pr.url}/files`;
  const anchor = link(ctx.doc, files, { class: "loc" }, location);
  const match = String(location).match(/^([\w./@+-]+\.[\w]+)(?::(\d+))?/);
  if (match && anchor.tagName === "A") {
    diffAnchor(match[1])
      .then((hash) => {
        if (hash) anchor.href = `${files}#${hash}${match[2] ? `R${match[2]}` : ""}`;
      })
      .catch(() => {});
  }
  return anchor;
}

const VERDICT_TONES = { blocking: "bad", "needs-work": "warn", minor: "ok", "ship-ready": "ok" };
const SEVERITIES = ["critical", "high", "medium", "low"];

function reviewDetails(ctx, pr, review) {
  const { doc } = ctx;
  const verdict = String(review.verdict ?? "reviewed");
  const counts = review.counts ?? {};
  const issues = parseReviewIssues(review.markdown);
  const boxes = [];
  const list = issues.length
    ? h(
        doc,
        "ol",
        { class: "issues" },
        issues.map((issue) => {
          const box = h(doc, "input", { type: "checkbox", id: `f-${pr.number}-${issue.id}`, checked: true, "aria-label": `Include ${issue.id}` });
          boxes.push([box, issue]);
          return h(
            doc,
            "li",
            { "data-issue": issue.id },
            box,
            h(doc, "span", { class: `sev ${String(issue.severity).toLowerCase()}` }, issue.severity),
            h(doc, "label", { class: "it", for: `f-${pr.number}-${issue.id}` }, issue.title),
            codeLink(ctx, pr, issue.location),
          );
        }),
      )
    : null;
  const selected = () => boxes.filter(([box]) => box.checked).map(([, issue]) => issue);
  const full = h(doc, "button", { type: "button", class: "cc quiet", "data-full": "" }, icon(doc, "book"), "Full review");
  full.addEventListener("click", () => ctx.reviews$.open(pr, review));
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
    list,
    h(
      doc,
      "div",
      { class: "rv-actions" },
      sessionButton(ctx, "Continue in Claude Code", () =>
        ctx.session$.open({
          title: sessionTitle("Review", pr, cleanTitle(pr.title).text),
          text: reviewPrompt(pr, pr.review_id, selected(), ctx.brief.page_url),
          repo: pr.repo,
          branch: pr.head_ref,
        }),
      ),
      full,
    ),
  );
}

function author(ctx, pr) {
  return pr.author_email && (ctx.people[pr.author_email] || ctx.out.has(pr.author_email))
    ? pill(ctx, resolve(ctx, pr.author_email))
    : guest(ctx.doc, pr.author ?? "", `${pr.author} on GitHub`);
}

const lateness = (days) => (days != null && days >= 14 ? "late" : "");

function reviewRow(ctx, pr, n) {
  const { doc } = ctx;
  const { add, del } = sizeOf(pr);
  const days = daysSince(pr.waiting_since, ctx.today);
  const review = pr.review_id ? ctx.reviews[pr.review_id] : null;
  return row(doc, {
    ln: n,
    title: link(doc, pr.url, { class: "tl" }, cleanTitle(pr.title).text),
    tags: [
      author(ctx, pr),
      ref(doc, pr.repo, pr.number),
      sizeBadge(doc, pr),
      linearChip(ctx, pr.linear_id),
      awayBadges(ctx, pr.author_email ? [{ email: pr.author_email }] : []),
    ],
    meta: pr.blocking_signal,
    extra: review ? reviewDetails(ctx, pr, review) : null,
    sig: signals(doc, pr),
    when: days == null ? "" : `${days}d`,
    lateness: lateness(days),
    act: action(doc, { tone: "do", verb: "Review", url: `${pr.url}/files`, sub: `${add + del} lines` }),
    attrs: { "data-pr": pr.number },
  });
}

function compactRow(ctx, pr, verb) {
  const { doc } = ctx;
  const days = daysSince(pr.waiting_since ?? pr.created_at, ctx.today);
  return row(doc, {
    title: link(doc, pr.url, { class: "tl" }, cleanTitle(pr.title).text),
    tags: [verb === "Review" ? author(ctx, pr) : null, ref(doc, pr.repo, pr.number), sizeBadge(doc, pr), linearChip(ctx, pr.linear_id)],
    sig: signals(doc, pr),
    when: days == null ? "" : `${days}d`,
    act: action(doc, { tone: "quiet", verb, url: verb === "Review" ? `${pr.url}/files` : pr.url, sub: "" }),
    cls: "compact",
    attrs: { "data-pr": pr.number },
  });
}

const staleBadge = (doc, pr) =>
  pr.stale && pr.stale_closes_on ? badge(doc, `stale · closes ${weekdayMonthDay(pr.stale_closes_on)}`, "bad") : null;

const SESSION_STEPS = new Set(["Fix CI", "Resolve", "Answer", "Address"]);

function stepSession(ctx, pr, step) {
  if (!SESSION_STEPS.has(step.verb)) return null;
  return sessionButton(ctx, "Claude", () =>
    ctx.session$.open({
      title: sessionTitle(step.verb, pr, cleanTitle(pr.title).text),
      text: stepPrompt(pr, step),
      repo: pr.repo,
      branch: pr.head_ref,
    }),
  );
}

const reviewers = (pr) => (pr.requested_reviewers ?? []).filter((r) => r.email).map((r) => ({ email: r.email, role: "reviewer" }));

function myRow(ctx, pr, n, { grouped }) {
  const { doc } = ctx;
  const days = daysSince(pr.created_at, ctx.today);
  const review = pr.review_id ? ctx.reviews[pr.review_id] : null;
  const step = nextStep(pr);
  return row(doc, {
    ln: n,
    title: link(doc, pr.url, { class: "tl" }, cleanTitle(pr.title).text),
    tags: [
      ref(doc, pr.repo, pr.number),
      sizeBadge(doc, pr),
      grouped ? null : linearChip(ctx, pr.linear_id),
      staleBadge(doc, pr),
      awayBadges(ctx, reviewers(pr)),
      stepSession(ctx, pr, step),
    ],
    extra: review ? reviewDetails(ctx, pr, review) : null,
    sig: signals(doc, pr),
    when: days == null ? "" : `${days}d`,
    lateness: lateness(days),
    act: action(doc, step),
    cls: grouped ? "in-group" : "",
    attrs: { "data-pr": pr.number, "data-key": pr.number },
  });
}

function stackRow(ctx, chain, n, { grouped }) {
  const { doc } = ctx;
  const bottom = chain[0];
  const { scope } = cleanTitle(bottom.title);
  const name = scope ? `${scope.charAt(0).toUpperCase()}${scope.slice(1)} stack` : `Stack on ${bottom.base_ref}`;
  const step = nextStep(bottom);
  const days = daysSince(bottom.created_at, ctx.today);
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
    tags: [
      ref(doc, bottom.repo, `${bottom.number}–${chain.at(-1).number}`),
      segments,
      grouped ? null : linearChip(ctx, bottom.linear_id),
      staleBadge(doc, bottom),
      awayBadges(ctx, reviewers(bottom)),
      stepSession(ctx, bottom, step),
    ],
    meta: `Bottom first: 1/${chain.length} ${cleanTitle(bottom.title).text.replace(/^./, (c) => c.toLowerCase())}`,
    sig: signals(doc, bottom),
    when: days == null ? "" : `${days}d`,
    lateness: lateness(days),
    act: action(doc, { ...step, tone: bottom.stale ? "fix" : step.tone, sub: `1/${chain.length} first` }),
    cls: grouped ? "in-group" : "",
    attrs: { "data-key": `stack-${bottom.number}` },
  });
}

const PR_STATES = { merged: ["merged", "ok"], closed: ["closed", "bad"], open: ["open", ""] };

// The band over PRs that belong to one Linear issue, naming the issue's other
// PRs that aren't open rows here (a back end already merged, or closed stale).
function linearBand(ctx, id, others) {
  const { doc } = ctx;
  const issue = ctx.linear[id];
  return h(
    doc,
    "div",
    { class: "grp", "data-linear": id },
    icon(doc, "issue", "dim"),
    link(doc, issue.url, { class: "grp-id" }, id),
    h(doc, "span", { class: "grp-t" }, issue.title),
    issue.status ? badge(doc, issue.status, "") : null,
    others.map((pr) => {
      const [word, tone] = PR_STATES[pr.state] ?? [pr.state ?? "", ""];
      return link(doc, pr.url, { class: `sib ${tone}` }, `${shortRepo(pr.repo)}#${pr.number} ${word}`);
    }),
  );
}

// ---- meetings, the day, and messages ---------------------------------------------------

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

function attendeeTags(ctx, meeting) {
  const attendees = meeting.attendees ?? [];
  const team = attendees.filter((a) => isTeammate(ctx, a));
  const others = attendees.filter((a) => !isTeammate(ctx, a));
  const note = (a) => (a.organizer ? "organizer" : a.optional ? "optional" : "");
  const faces = team.map((a) => ({ person: resolve(ctx, a.email, a), note: note(a) }));
  return [faces.length > 3 ? pile(ctx, faces) : faces.map(({ person, note: n }) => pill(ctx, person, n)), externals(ctx.doc, others)];
}

function meetingRow(ctx, meeting, i) {
  const { doc, tz } = ctx;
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
    ln: clock(meeting.start, tz),
    title: link(doc, missing ? null : meeting.url, { class: "tl" }, meeting.title),
    tags: [
      missing ? badge(doc, "Not on calendar", "alarm", { "data-badge": "not-on-calendar" }) : null,
      kindLabel ? badge(doc, kindLabel, kindTone) : null,
      attendeeTags(ctx, meeting),
    ],
    meta: [meeting.context, then].filter(Boolean).flatMap((x, j) => (j ? [" ", x] : [x])),
    sig: cell(doc, "conference", conferenceIcon, "dim", conferenceName),
    when: duration(meeting.start, meeting.end),
    act,
    cls: "mtg",
    attrs: { "data-meeting": i },
  });
}

const BLOCK_NAMES = { focus: "Focus", lunch: "Lunch", unavailable: "Busy" };

// The day at a glance: availability blocks above, meetings below, to scale.
function dayStrip(ctx, meetings) {
  const { doc, tz } = ctx;
  const span = (b) => [minutesIn(b.start, tz), minutesIn(b.end, tz)];
  const blocks = [
    ...(ctx.brief.day_blocks ?? []).map((b) => ({ ...b, lane: "avail" })),
    ...meetings.map((m) => ({ kind: "meeting", lane: "meet", start: m.start, end: m.end, title: m.title, missing: m.on_calendar === false })),
  ].filter((b) => span(b).every((v) => v != null));
  if (!blocks.length) return null;
  const from = Math.min(8 * 60, ...blocks.map((b) => Math.floor(span(b)[0] / 60) * 60));
  const to = Math.max(20 * 60, ...blocks.map((b) => Math.ceil(span(b)[1] / 60) * 60));
  const pct = (m) => `${(((m - from) / (to - from)) * 100).toFixed(3)}%`;
  const ticks = [];
  for (let m = from; m <= to; m += 120) ticks.push(h(doc, "span", { class: "tick", style: `left:${pct(m)}` }, `${String(m / 60).padStart(2, "0")}`));
  return h(
    doc,
    "div",
    { class: "day", "data-day": "", role: "img", "aria-label": "Today's meetings and availability" },
    h(doc, "div", { class: "lanes" }, [
      ...blocks.map((b) => {
        const [s, e] = span(b);
        const range = `${clock(b.start, tz)}–${clock(b.end, tz)}`;
        const tip = b.kind === "meeting" ? `${b.title} ${range}${b.missing ? " · not on calendar" : ""}` : `${BLOCK_NAMES[b.kind] ?? b.kind} ${range}`;
        return h(doc, "span", {
          class: `blk ${b.kind} ${b.lane}${b.missing ? " missing" : ""}`,
          "data-block": b.kind,
          "data-tip": tip,
          tabindex: "0",
          "aria-label": tip,
          style: `left:${pct(s)};width:${pct(from + (e - s))}`,
        });
      }),
    ]),
    h(doc, "div", { class: "ticks" }, ticks),
  );
}

function outLine(ctx) {
  const { doc } = ctx;
  const entries = [...ctx.out.values()].sort((a, b) => a.start.localeCompare(b.start));
  if (!entries.length) return null;
  return h(
    doc,
    "div",
    { class: "out", "data-out": "" },
    h(doc, "span", { class: "out-l" }, "Out"),
    entries.map((entry) => {
      const person = resolve(ctx, entry.email, entry);
      return h(doc, "span", { class: "out-p" }, face(ctx, person), `${firstName(person.name)} ${outLabel(entry, ctx.today).replace(/^out /, "")}`);
    }),
  );
}

const SOURCE_ICONS = { gmail: "mail", slack: "slack", linear: "issue" };

function itemRow(ctx, item, ln, source, defaults) {
  const { doc } = ctx;
  const step = item.action
    ? { tone: defaults.tone, verb: item.action.verb, url: item.action.url, sub: item.action.by ? `by ${item.action.by}` : "" }
    : defaults.fallback(item);
  return row(doc, {
    ln,
    title: link(doc, item.url, { class: "tl" }, item.title),
    tags: [
      item.tag ? badge(doc, item.tag, "warn") : null,
      (item.people ?? []).map((email) => pill(ctx, resolve(ctx, email))),
      item.who ? guest(doc, item.who) : null,
    ],
    meta: item.summary,
    sig: cell(doc, "source", SOURCE_ICONS[source], "dim", SOURCE_NAMES[source]),
    when: when(item.when, ctx.today, ctx.tz),
    act: action(doc, step),
    attrs: { "data-item": ln },
  });
}

const PRIORITY_TONES = { Urgent: "bad", High: "warn" };

function linearSection(ctx) {
  const { doc } = ctx;
  const data = ctx.brief.linear ?? {};
  const assigned = data.assigned ?? [];
  const updates = data.project_updates ?? [];
  const stale = data.stale ?? [];
  if (!assigned.length && !updates.length && !stale.length) return null;
  let n = 0;
  const rows = [
    ...assigned.map((issue) =>
      row(doc, {
        ln: `C${++n}`,
        title: link(doc, issue.url, { class: "tl" }, issue.title),
        tags: [
          link(doc, issue.url, { class: "lin" }, issue.id),
          badge(doc, "New to you", "brand"),
          issue.priority && PRIORITY_TONES[issue.priority] ? badge(doc, issue.priority, PRIORITY_TONES[issue.priority]) : null,
          issue.by ? pill(ctx, resolve(ctx, issue.by)) : null,
          issue.project ? h(doc, "span", { class: "ext" }, issue.project) : null,
        ],
        sig: cell(doc, "source", "issue", "dim", "Linear"),
        when: when(issue.when, ctx.today, ctx.tz),
        act: action(doc, { tone: "warn", verb: "Triage", url: issue.url, sub: "" }),
        attrs: { "data-item": issue.id },
      }),
    ),
    ...updates.map((project, i) =>
      row(doc, {
        ln: `C${++n}`,
        title: link(doc, project.url, { class: "tl" }, project.name),
        tags: [badge(doc, "Project update overdue", "warn")],
        sig: cell(doc, "source", "issue", "dim", "Linear"),
        when: project.due ? monthDay(`${project.due}T12:00:00Z`) : "",
        act: action(doc, { tone: "warn", verb: "Post update", url: project.url, sub: "" }),
        attrs: { "data-item": `update-${i + 1}` },
      }),
    ),
  ];
  return section(doc, {
    id: "linear",
    numeral: "C",
    label: "Linear",
    count: assigned.length + updates.length,
    children: [
      rows,
      stale.length
        ? fold(
            doc,
            "linear-stale",
            false,
            [h(doc, "b", null, `${stale.length} in progress`), ", quiet for two weeks or more"],
            stale.map((issue) => {
              const days = daysSince(issue.updated_at, ctx.today);
              return row(doc, {
                title: link(doc, issue.url, { class: "tl" }, issue.title),
                tags: [link(doc, issue.url, { class: "lin" }, issue.id), issue.status ? badge(doc, issue.status, "") : null],
                sig: cell(doc, "source", "issue", "dim", "Linear"),
                when: days == null ? "" : `${days}d`,
                act: action(doc, { tone: "quiet", verb: "Open", url: issue.url, sub: "" }),
                cls: "compact",
                attrs: { "data-item": issue.id },
              });
            }),
          )
        : null,
    ],
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
    ["reply", "Reply", "#replies", ["gmail", "slack", "linear"]],
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

// People out in the next seven days, by email.
function outOfOffice(brief, today) {
  const horizon = addDays(today, 7);
  return new Map(
    (brief.out_of_office ?? [])
      .filter((o) => o.email && o.start && o.end && o.end > today && o.start < horizon)
      .map((o) => [o.email, o]),
  );
}

function myPrsSection(ctx) {
  const { doc, brief } = ctx;
  const mine = brief.my_prs ?? [];
  if (!mine.length) return { section: null, fix: 0, merge: 0 };
  const drafts = mine.filter((pr) => pr.draft === true || pr.mergeable_state === "draft");
  const { stacks, singles } = groupStacks(mine.filter((pr) => !drafts.includes(pr)));
  const rows = rankMine([...stacks.map((chain) => ({ lead: chain[0], chain })), ...singles.map((pr) => ({ lead: pr }))]);
  let fix = 0;
  let merge = 0;
  for (const r of rows) {
    if ((r.chain && r.lead.stale ? "fix" : nextStep(r.lead).tone) === "fix") fix += 1;
    if (nextStep(r.lead).verb === "Merge") merge += 1;
  }

  // Rows that share a Linear issue with other rows, or whose issue has PRs that
  // aren't open here, sit together under the issue at the first one's rank.
  const shown = new Set(mine.map((pr) => `${pr.repo}#${pr.number}`));
  const issueOf = (r) => r.lead.linear_id;
  const members = new Map();
  for (const r of rows) if (issueOf(r) && ctx.linear[issueOf(r)]) members.set(issueOf(r), [...(members.get(issueOf(r)) ?? []), r]);
  const others = (id) => (ctx.linear[id].prs ?? []).filter((pr) => !shown.has(`${pr.repo}#${pr.number}`));
  const grouped = new Set([...members].filter(([id, rs]) => rs.length > 1 || others(id).length).map(([id]) => id));

  let n = ctx.n;
  const out = [];
  const emitted = new Set();
  const render = (r, opts) => (r.chain ? stackRow(ctx, r.chain, ++n, opts) : myRow(ctx, r.lead, ++n, opts));
  for (const r of rows) {
    const id = issueOf(r);
    if (grouped.has(id)) {
      if (emitted.has(id)) continue;
      emitted.add(id);
      out.push(linearBand(ctx, id, others(id)), members.get(id).map((m) => render(m, { grouped: true })));
    } else {
      out.push(render(r, { grouped: false }));
    }
  }
  ctx.n = n;

  const draftsSorted = [...drafts].sort((a, b) => String(a.linear_id ?? "~").localeCompare(String(b.linear_id ?? "~")));
  return {
    fix,
    merge,
    section: section(doc, {
      id: "my-prs",
      numeral: "II",
      label: "Your pull requests",
      count: mine.length,
      ageTip: "Days open",
      children: [
        out,
        drafts.length ? fold(doc, "drafts", false, h(doc, "b", null, plural(drafts.length, "draft")), draftsSorted.map((pr) => compactRow(ctx, pr, "Open"))) : null,
      ],
    }),
  };
}

export function renderBrief(doc, brief, { reviews = {}, people = {}, today, startSession } = {}) {
  today ??= brief.run_date;
  const ctx = {
    doc,
    brief,
    reviews,
    people,
    today,
    tz: brief.timezone ?? "UTC",
    out: outOfOffice(brief, today),
    linear: brief.linear_issues ?? {},
    startSession: typeof startSession === "function" ? startSession : null,
    n: 0,
  };
  ctx.session$ = sessionDialog(ctx);
  ctx.reviews$ = reviewDialog(ctx);

  const left = [];
  const right = [];
  const counts = { review: 0, fix: 0, merge: 0, reply: 0, meetings: 0 };

  // Left: the PRs.
  if (!sourceOk(brief, "github")) {
    left.push(sourceError(doc, brief, "github", "review-prs"));
  } else {
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
          ageTip: "Days waiting on you",
          children: [
            reviewPrs.map((pr) => reviewRow(ctx, pr, ++ctx.n)),
            team.length
              ? fold(doc, "team", true, [h(doc, "b", null, `${team.length} more`), " requested from your teams"], team.map((pr) => compactRow(ctx, pr, "Review")))
              : null,
          ],
        }),
      );
    }

    const mine = myPrsSection(ctx);
    counts.fix = mine.fix;
    counts.merge = mine.merge;
    if (mine.section) left.push(mine.section);

    const closed = brief.stale_closed ?? [];
    if (closed.length) {
      left.push(
        section(doc, {
          id: "stale-closed",
          numeral: "III",
          label: "Closed as stale",
          count: closed.length,
          ageTip: "Days since closed",
          children: closed.map((pr) => {
            const days = daysSince(pr.closed_at, today);
            return row(doc, {
              ln: ++ctx.n,
              title: link(doc, pr.url, { class: "tl" }, cleanTitle(pr.title).text),
              tags: [ref(doc, pr.repo, pr.number)],
              meta: "The stale bot closed it. Reopen it to keep the work.",
              sig: COLUMNS.map(([signal]) => cell(doc, signal, "none", "dim", "")),
              when: days == null ? "" : `${days}d`,
              act: action(doc, { tone: "warn", verb: "Reopen", url: pr.url, sub: `closed ${monthDay(pr.closed_at, ctx.tz)}` }),
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
    if (meetings.length || ctx.out.size) {
      right.push(
        section(doc, {
          id: "meetings",
          numeral: "A",
          label: "Meetings",
          count: meetings.length,
          children: [dayStrip(ctx, meetings), outLine(ctx), meetings.map((m, i) => meetingRow(ctx, m, i))],
        }),
      );
    }
  }

  const replies = [
    ...(sourceOk(brief, "gmail") ? brief.mail_asks ?? [] : []).map((item) => ["gmail", item]),
    ...(sourceOk(brief, "slack") ? brief.slack_asks ?? [] : []).map((item) => ["slack", item]),
    ...(sourceOk(brief, "linear") ? brief.linear_asks ?? [] : []).map((item) => ["linear", item]),
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
        children: replies.map(([source, item], i) => itemRow(ctx, item, `B${i + 1}`, source, replyDefaults)),
      }),
    );
  }
  if (!sourceOk(brief, "gmail")) right.push(sourceError(doc, brief, "gmail", "replies"));

  if (!sourceOk(brief, "linear")) right.push(sourceError(doc, brief, "linear", "linear"));
  else right.push(linearSection(ctx));

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
          numeral: "D",
          label: "Worth knowing",
          count: fyi.length,
          children: fyi.map((item, i) => itemRow(ctx, item, `D${i + 1}`, "slack", fyiDefaults)),
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
    ctx.session$.dialog,
    ctx.reviews$.dialog,
  );
}

const EMPTY = {
  "no-brief": ["No brief yet", "The Routine writes one each morning. Once the first run finishes, it appears here on its own."],
  "no-db": ["Open this page on claude.ai", "The brief lives in this page's database, which only loads on claude.ai while you're signed in."],
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
