// Wires the page to its database: the newest document in `briefs`, plus the
// `reviews` and `people` documents that brief points at. The Routine writes
// all three.

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

const reviewIds = (brief) =>
  [...(brief.review_prs ?? []), ...(brief.my_prs ?? [])].map((pr) => pr.review_id).filter(Boolean);

// Document ids allow letters, digits and `_ - . ~ : @ +`, which covers email
// addresses; anything else is skipped rather than thrown on.
const SAFE_ID = /^[A-Za-z0-9._~:@+-]{1,200}$/;

function personEmails(brief) {
  const emails = [
    ...[...(brief.review_prs ?? []), ...(brief.team_review_prs ?? [])].map((pr) => pr.author_email),
    ...(brief.meetings ?? []).flatMap((m) => (m.attendees ?? []).map((a) => a.email)),
    ...[...(brief.mail_asks ?? []), ...(brief.slack_asks ?? []), ...(brief.slack_discussions ?? [])].flatMap(
      (item) => item.people ?? [],
    ),
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
  const present = (map) => Object.fromEntries(Object.entries(map).filter(([, v]) => v));
  let latest = null;
  const draw = () =>
    show(
      latest
        ? renderBrief(document, latest, { reviews: present(reviews), people: present(people), today: todayIn(latest.timezone) })
        : renderEmpty(document, "no-brief"),
    );

  async function loadLinked(brief) {
    const [r, p] = await Promise.all([
      loadInto(db, "reviews", reviewIds(brief), reviews),
      loadInto(db, "people", personEmails(brief), people),
    ]);
    if ((r || p) && brief === latest) draw();
  }

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
