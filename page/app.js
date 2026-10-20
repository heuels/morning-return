// Wires the page to its database: the newest document in `briefs`, plus the
// `reviews` and `people` documents that brief points at. The Routine writes
// all three. When the viewer allows it, "Start session" creates a Claude Code
// session through the Claude Code Remote connector.

import { renderBrief, renderEmpty } from "./render.js";

const root = document.getElementById("app");
const show = (el) => root.replaceChildren(el);

function todayIn(timeZone) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
      new Date(),
    );
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

// What each connector failure means for the person who pressed "Start session".
const SESSION_ERRORS = {
  approval_required: "Claude needs your permission to start sessions from this page. Allow it when claude.ai asks, then press Start again.",
  not_in_manifest: "This page isn't allowed to start sessions for you. Turn it on in the page's Permissions menu, or use the claude.ai/code link.",
  server_not_connected: "Claude Code Remote isn't connected for your account. Use the claude.ai/code link instead.",
  needs_reauth: "Reconnect Claude Code Remote in claude.ai Settings, Connectors, then press Start again.",
  blocked_by_policy: "Your organisation doesn't allow starting sessions from pages. Use the claude.ai/code link instead.",
  server_unavailable: "Claude Code didn't answer. The session may have started, so check claude.ai/code before trying again.",
  upstream_error: "Claude Code didn't answer. The session may have started, so check claude.ai/code before trying again.",
};

function sessionStarter(mcp) {
  if (!mcp) return null;
  return async ({ title, prompt, repo, branch, environment_id }) => {
    const input = { title, prompt };
    if (environment_id) input.environment_id = environment_id;
    if (repo) input.source_url = `https://github.com/${repo}`;
    if (branch) input.source_revision = branch;
    let result;
    try {
      result = await mcp.callTool("Claude Code Remote", "create_session", input);
    } catch (error) {
      const known = SESSION_ERRORS[error?.code];
      throw new Error(known ?? (error?.code === "tool_error" && error.message ? error.message : `Couldn't start the session (${error?.code ?? "error"}). Use the claude.ai/code link instead.`));
    }
    const id = JSON.stringify(result?.payload ?? result?.content ?? "").match(/session_[A-Za-z0-9]+/)?.[0];
    return { url: id ? `https://claude.ai/code/${id}` : null };
  };
}

const reviewIds = (brief) =>
  [...(brief.review_prs ?? []), ...(brief.my_prs ?? [])].map((pr) => pr.review_id).filter(Boolean);

// Document ids allow letters, digits and `_ - . ~ : @ +`, which covers email
// addresses; anything else is skipped rather than thrown on.
const SAFE_ID = /^[A-Za-z0-9._~:@+-]{1,200}$/;

function personEmails(brief) {
  const prs = [...(brief.review_prs ?? []), ...(brief.team_review_prs ?? []), ...(brief.my_prs ?? [])];
  const items = [...(brief.mail_asks ?? []), ...(brief.slack_asks ?? []), ...(brief.linear_asks ?? []), ...(brief.slack_discussions ?? [])];
  const emails = [
    ...prs.flatMap((pr) => [pr.author_email, ...(pr.requested_reviewers ?? []).map((r) => r.email)]),
    ...(brief.meetings ?? []).flatMap((m) => (m.attendees ?? []).map((a) => a.email)),
    ...items.flatMap((item) => item.people ?? []),
    ...(brief.out_of_office ?? []).map((o) => o.email),
    ...(brief.linear?.assigned ?? []).map((issue) => issue.by),
  ];
  return [...new Set(emails.filter((e) => typeof e === "string" && SAFE_ID.test(e)))];
}

function showError(error) {
  const box = renderEmpty(document, "no-brief");
  box.querySelector("h2").textContent = "Couldn't load the brief";
  box.querySelector("p").textContent = `The page's database answered ${error?.code ?? "with an error"}. Reload the page to try again.`;
  show(box);
}

async function loadInto(db, collection, ids, into) {
  const missing = ids.filter((id) => !(id in into));
  if (missing.length === 0) return false;
  const snaps = await Promise.all(missing.map((id) => db.doc(`${collection}/${id}`).get().catch(() => null)));
  snaps.forEach((snap, i) => {
    into[missing[i]] = snap?.exists ? snap.data() : null;
  });
  return true;
}

async function start() {
  const db = (await window.claude?.use?.("db")) ?? null;
  if (!db) {
    show(renderEmpty(document, "no-db"));
    return;
  }

  const reviews = {};
  const people = {};
  let startSession = null;
  const present = (map) => Object.fromEntries(Object.entries(map).filter(([, v]) => v));
  let latest = null;
  const draw = () =>
    show(
      latest
        ? renderBrief(document, latest, {
            reviews: present(reviews),
            people: present(people),
            today: todayIn(latest.timezone),
            startSession,
          })
        : renderEmpty(document, "no-brief"),
    );

  async function loadLinked(brief) {
    const [r, p] = await Promise.all([
      loadInto(db, "reviews", reviewIds(brief), reviews),
      loadInto(db, "people", personEmails(brief), people),
    ]);
    if ((r || p) && brief === latest) draw();
  }

  // The connector resolves on its own schedule; the page works without it.
  window.claude
    ?.use?.("mcp")
    ?.then((mcp) => {
      startSession = sessionStarter(mcp);
      if (startSession && latest && !document.querySelector("dialog[open], details.rv[open]")) draw();
    })
    ?.catch(() => {});

  db.collection("briefs")
    .orderBy("run_date", "desc")
    .limit(1)
    .onSnapshot((snap) => {
      latest = snap.empty ? null : snap.docs[0].data();
      draw();
      if (latest) loadLinked(latest);
    }, showError);
}

start();
