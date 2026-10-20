import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
RUN_DIR = REPO / ".claude" / "skills" / "morning-return-run"
SCRIPTS = RUN_DIR / "scripts"


def load(name, path):
    sys.path.insert(0, str(path.parent))
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


merge_brief = load("merge_brief", SCRIPTS / "merge_brief.py")
plan_waves = load("plan_waves", SCRIPTS / "plan_waves.py")
fixture = load("parts_fixture", REPO / "tests" / "parts_fixture.py")
split, part, FIXTURE, PR_LISTS, REVIEW_ID = fixture.split, fixture.part, fixture.FIXTURE, fixture.PR_LISTS, fixture.REVIEW_ID
FORMAT = (RUN_DIR / "brief-format.md").read_text()
PARTS = (RUN_DIR / "parts.md").read_text()


def run(parts=None, header=None, **kwargs):
    base_header, base_parts = split(FIXTURE)
    return merge_brief.merge(header or base_header, parts if parts is not None else base_parts, FORMAT, PARTS, **kwargs)


def mention(repo, number, *, url, from_email="ben@taxwire.com", to_me=True, line="Asked you about it in #eng"):
    return {
        "title": "PR thread",
        "url": url,
        "who": None,
        "people": [from_email],
        "when": "2026-10-19T10:00:00Z",
        "summary": "Talked about the PR.",
        "tag": None,
        "action": None,
        "pr": {"repo": repo, "number": number},
        "from_email": from_email,
        "to_me": to_me,
        "line": line,
    }


class MergeTest(unittest.TestCase):
    def test_split_and_merged_back_is_the_fixture(self):
        brief, writes, problems = run()
        self.assertEqual(problems, [])
        self.assertEqual(brief, FIXTURE)
        self.assertEqual(writes, [])

    def test_a_field_the_part_doesnt_own_is_dropped(self):
        header, parts = split(FIXTURE)
        parts["slack-enrich"]["fields"]["slack_asks"] = []
        brief, _, problems = run(parts, header)
        self.assertIn("slack-enrich: doesn't own slack_asks", problems)
        self.assertEqual(brief["slack_asks"], FIXTURE["slack_asks"])

    def test_a_handoff_the_part_doesnt_declare_is_ignored(self):
        header, parts = split(FIXTURE)
        parts["gmail"]["handoffs"]["names"] = {"Cleo Hart": "mallory@evil.example"}
        brief, _, problems = run(parts, header)
        self.assertIn("gmail: doesn't declare names", problems)
        self.assertIn("cleo@taxwire.com", [entry["email"] for entry in brief["out_of_office"]])

    def test_a_record_missing_a_field_is_left_out_with_a_note(self):
        header, parts = split(FIXTURE)
        mangled = parts["github"]["fields"]["my_prs"][0]
        mangled["headSha"] = mangled.pop("head_sha")
        brief, _, problems = run(parts, header)
        self.assertIn("github: my_prs[0]: missing head_sha", problems)
        self.assertNotIn(mangled["number"], [pr["number"] for pr in brief["my_prs"]])
        self.assertEqual(len(brief["my_prs"]), len(FIXTURE["my_prs"]) - 1)
        self.assertIn("The github pass wrote 1 entry the page can't read; it was left out.", brief["notes"])

    def test_a_part_missing_a_field_it_owns_leaves_it_empty(self):
        header, parts = split(FIXTURE)
        del parts["slack"]["fields"]["slack_discussions"]
        brief, _, problems = run(parts, header)
        self.assertIn("slack: missing slack_discussions", problems)
        self.assertEqual(brief["slack_discussions"], [])
        self.assertEqual(brief["slack_asks"], FIXTURE["slack_asks"])

    def test_a_missing_base_part_fails_its_sources(self):
        header, parts = split(FIXTURE)
        parts["slack"] = None
        brief, _, problems = run(parts, header)
        self.assertEqual(problems, [])
        self.assertEqual(brief["sources"]["slack"], {"ok": False, "error": "slack.md didn't finish"})
        self.assertEqual(brief["slack_asks"], [])
        self.assertEqual(brief["slack_discussions"], [])
        self.assertEqual(brief["sources"]["gmail"], {"ok": True})

    def test_a_missing_linear_part_empties_linear(self):
        header, parts = split(FIXTURE)
        parts["linear"] = None
        brief, _, problems = run(parts, header)
        self.assertEqual(problems, [])
        self.assertEqual(brief["linear"], {"assigned": [], "project_updates": [], "stale": []})

    def test_a_missing_enrichment_keeps_the_base_fields(self):
        header, parts = split(FIXTURE)
        parts["slack-enrich"] = None
        brief, _, problems = run(parts, header)
        self.assertEqual(problems, [])
        self.assertEqual(brief["sources"]["slack"], {"ok": True})
        self.assertEqual(brief["slack_asks"], FIXTURE["slack_asks"])
        self.assertEqual(brief["out_of_office"], [])
        self.assertTrue(any(note.startswith("Slack enrichment didn't finish") for note in brief["notes"]), brief["notes"])

    def test_a_pass_that_was_never_started_adds_no_note(self):
        header, parts = split(FIXTURE)
        parts["gmail-enrich"] = None
        brief, _, _ = run(parts, header, started={"slack-enrich", "linear-enrich", "meetings", "github-enrich"})
        self.assertFalse(any("Gmail enrichment" in note for note in brief["notes"]), brief["notes"])

    def test_without_meeting_prep_events_and_invites_stand(self):
        header, parts = split(FIXTURE)
        parts["meetings"] = None
        brief, _, problems = run(parts, header)
        self.assertEqual(problems, [])
        self.assertEqual([m["title"] for m in brief["meetings"]], [m["title"] for m in FIXTURE["meetings"]])
        self.assertTrue(all(m["context"] is None and m["action"] is None for m in brief["meetings"]))
        self.assertTrue(any(note.startswith("Meeting prep didn't finish") for note in brief["notes"]))

    def test_an_invite_matching_a_calendar_event_is_dropped(self):
        header, parts = split(FIXTURE)
        parts["meetings"] = None
        event = parts["calendar"]["handoffs"]["events"][0]
        parts["gmail"]["handoffs"]["invites"].append(event | {"on_calendar": False, "url": "https://calendar.google.com/calendar/event?action=VIEW&eid=dup"})
        brief, _, _ = run(parts, header)
        self.assertEqual([m["title"] for m in brief["meetings"]].count(event["title"]), 1)

    def test_emails_come_from_commits_then_names(self):
        header, parts = split(FIXTURE)
        identities = parts["github"]["handoffs"]["commit_identities"]
        identities["teammate-b"] = [{"name": "Cleo Hart", "email": "12345+cleo@users.noreply.github.com"}]
        brief, _, _ = run(parts, header)
        by_number = {pr["number"]: pr for pr in brief["review_prs"]}
        self.assertEqual(by_number[101]["author_email"], "ben@taxwire.com")
        self.assertEqual(by_number[102]["author_email"], "cleo@taxwire.com")

    def test_a_ping_from_someone_else_isnt_blocking(self):
        header, parts = split(FIXTURE)
        parts["slack-enrich"]["handoffs"]["pr_mentions"] = [mention("taxwire/example-api", 101, url="https://example.slack.com/p9", from_email="cleo@taxwire.com")]
        brief, _, _ = run(parts, header)
        self.assertIsNone(next(pr for pr in brief["review_prs"] if pr["number"] == 101)["blocking_signal"])

    def test_a_ping_from_the_author_is_blocking(self):
        header, parts = split(FIXTURE)
        parts["slack"]["handoffs"]["pr_links"] = [
            {key: value for key, value in mention("taxwire/example-api", 101, url="https://example.slack.com/p9").items() if key in ("url", "pr", "from_email", "to_me", "when", "line")}
        ]
        brief, _, _ = run(parts, header)
        self.assertEqual(next(pr for pr in brief["review_prs"] if pr["number"] == 101)["blocking_signal"], "Asked you about it in #eng")

    def test_a_ping_counts_when_the_author_is_unknown(self):
        header, parts = split(FIXTURE)
        parts["slack-enrich"]["handoffs"]["pr_mentions"] = [mention("taxwire/example-api", 102, url="https://example.slack.com/p9", from_email="zed@taxwire.com")]
        brief, _, _ = run(parts, header)
        self.assertEqual(next(pr for pr in brief["review_prs"] if pr["number"] == 102)["blocking_signal"], "Asked you about it in #eng")

    def test_a_mention_of_my_pr_becomes_a_discussion_once(self):
        header, parts = split(FIXTURE)
        known = FIXTURE["slack_asks"][0]["url"]
        parts["slack-enrich"]["handoffs"]["pr_mentions"] = [
            mention("taxwire/example-web", 201, url="https://example.slack.com/p10", to_me=False),
            mention("taxwire/example-web", 201, url=known, to_me=False),
            mention("taxwire/example-api", 101, url="https://example.slack.com/p11", to_me=False),
        ]
        brief, _, problems = run(parts, header)
        self.assertEqual(problems, [])
        added = [item for item in brief["slack_discussions"] if item["url"] == "https://example.slack.com/p10"]
        self.assertEqual(len(added), 1)
        self.assertEqual(added[0]["tag"], "example-web#201")
        self.assertNotIn("pr", added[0])
        self.assertEqual(len(brief["slack_discussions"]), 2)

    def test_discussions_stop_at_eight(self):
        header, parts = split(FIXTURE)
        parts["slack-enrich"]["handoffs"]["pr_mentions"] = [
            mention("taxwire/example-web", 201, url=f"https://example.slack.com/q{i}", to_me=False) for i in range(12)
        ]
        brief, _, _ = run(parts, header)
        self.assertEqual(len(brief["slack_discussions"]), 8)

    def test_mail_and_slack_from_an_attendee_are_tagged(self):
        header, parts = split(FIXTURE)
        ask = parts["slack"]["fields"]["slack_asks"][0]
        ask["action"] = {"verb": "Reply", "url": ask["url"], "by": None}
        parts["slack"]["handoffs"]["ask_senders"] = {ask["url"]: "hank@globex.example"}
        brief, _, _ = run(parts, header)
        self.assertEqual(brief["mail_asks"][0]["tag"], "Acme 15:30")
        self.assertEqual(brief["mail_asks"][0]["action"]["by"], "15:30")
        self.assertEqual(brief["slack_asks"][0]["tag"], "Globex 19:00")
        self.assertEqual(brief["slack_asks"][0]["action"]["by"], "19:00")

    def test_tags_read_the_meeting_time_in_my_timezone(self):
        header, parts = split(FIXTURE)
        acme = next(m for m in parts["meetings"]["fields"]["meetings"] if m["org"] == "Acme")
        acme["start"] = "2026-10-20T14:30:00Z"
        brief, _, _ = run(parts, header)
        self.assertEqual(brief["mail_asks"][0]["tag"], "Acme 15:30")

    def test_out_of_office_without_an_email_is_dropped(self):
        header, parts = split(FIXTURE)
        del parts["slack-enrich"]["handoffs"]["names"]["Cleo Hart"]
        brief, _, _ = run(parts, header)
        self.assertEqual([entry["name"] for entry in brief["out_of_office"]], ["Ben Ortiz"])

    def test_linked_pr_states_come_from_the_brief_then_github(self):
        header, parts = split(FIXTURE)
        parts["github-enrich"] = None
        brief, _, _ = run(parts, header)
        states = {pr["url"]: pr["state"] for issue in brief["linear_issues"].values() for pr in issue["prs"]}
        open_urls = {pr["url"] for key in PR_LISTS for pr in FIXTURE[key]}
        self.assertTrue(states)
        self.assertTrue(all(url in open_urls and state == "open" for url, state in states.items()), states)

    def test_review_ids_reach_their_prs(self):
        brief, _, _ = run()
        self.assertEqual(next(pr for pr in brief["review_prs"] if pr["number"] == 101)["review_id"], REVIEW_ID)

    def test_a_copied_review_prompt_adds_a_note(self):
        header, parts = split(FIXTURE)
        parts["reviews"]["handoffs"]["prompt"] = "copy: no Verdict line"
        brief, _, _ = run(parts, header)
        self.assertIn("Reviews used the saved copy of the /pr-review prompt: no Verdict line.", brief["notes"])

    def test_notes_keep_four_header_first(self):
        header, parts = split(FIXTURE)
        header["notes"] = ["Header note."]
        for name in ("github", "slack", "gmail", "calendar", "linear"):
            parts[name]["notes"] = [f"{name} note."]
        brief, _, _ = run(parts, header)
        self.assertEqual(len(brief["notes"]), 4)
        self.assertEqual(brief["notes"][0], "Header note.")
        self.assertEqual(brief["notes"][1], "2 reviews queued for the next run (8 per run).")

    def test_new_reviews_become_writes(self):
        _, writes, _ = run(new_reviews=[REVIEW_ID])
        self.assertEqual(writes, [{"op": "set", "collection": "reviews", "doc_id": REVIEW_ID, "file_path": f"reviews/{REVIEW_ID}.json"}])

    def test_a_bad_doc_id_is_left_out_with_a_note(self):
        header, parts = split(FIXTURE)
        parts["reviews"]["handoffs"]["review_ids"]["taxwire/bad repo#1"] = "taxwire:bad repo:1:abc"
        brief, writes, _ = run(parts, header, new_reviews=["taxwire:bad repo:1:abc"])
        self.assertEqual(writes, [])
        self.assertTrue(any("taxwire:bad repo:1:abc" in note for note in brief["notes"]), brief["notes"])

    def test_finish_lines(self):
        header, parts = split(FIXTURE)
        parts["slack"] = None
        brief, _, _ = run(parts, header, new_reviews=[REVIEW_ID])
        lines = merge_brief.finish_lines(brief, parts, new_reviews=[REVIEW_ID])
        self.assertEqual(len(lines), 3)
        self.assertIn("my_prs 7", lines[0])
        self.assertEqual(lines[1], "Reviews: 1 run, 0 already reviewed, 2 queued")
        self.assertEqual(lines[2], "Failed: slack (slack.md didn't finish)")


class CliTest(unittest.TestCase):
    def write_scratch(self, scratch, header, parts):
        (scratch / "parts").mkdir()
        (scratch / "header.json").write_text(json.dumps(header))
        for name, value in parts.items():
            if value is not None:
                (scratch / "parts" / f"{name}.json").write_text(json.dumps(value))

    def merge_cli(self, scratch):
        return subprocess.run(
            [sys.executable, str(SCRIPTS / "merge_brief.py"), "--run-dir", str(RUN_DIR), "--scratch", str(scratch)],
            capture_output=True,
            text=True,
        )

    def test_the_cli_writes_the_brief_and_prints_three_lines(self):
        header, parts = split(FIXTURE)
        with tempfile.TemporaryDirectory() as tmp:
            scratch = Path(tmp)
            self.write_scratch(scratch, header, parts)
            result = self.merge_cli(scratch)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads((scratch / "brief.json").read_text()), FIXTURE)
            self.assertEqual(json.loads((scratch / "writes.json").read_text()), [])
            self.assertEqual(len(result.stdout.strip().splitlines()), 3)

    def test_truncated_json_counts_as_missing(self):
        header, parts = split(FIXTURE)
        with tempfile.TemporaryDirectory() as tmp:
            scratch = Path(tmp)
            self.write_scratch(scratch, header, parts)
            text = (scratch / "parts" / "gmail.json").read_text()
            (scratch / "parts" / "gmail.json").write_text(text[: len(text) // 2])
            result = self.merge_cli(scratch)
            self.assertEqual(result.returncode, 0, result.stderr)
            brief = json.loads((scratch / "brief.json").read_text())
            self.assertEqual(brief["sources"]["gmail"], {"ok": False, "error": "gmail.md didn't finish"})

    def test_problems_are_listed_and_the_brief_is_still_written(self):
        header, parts = split(FIXTURE)
        parts["gmail"]["handoffs"]["names"] = {}
        with tempfile.TemporaryDirectory() as tmp:
            scratch = Path(tmp)
            self.write_scratch(scratch, header, parts)
            result = self.merge_cli(scratch)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("gmail: doesn't declare names", result.stderr)
            self.assertTrue((scratch / "brief.json").exists())

    def test_a_header_it_cant_use_exits_one_without_a_traceback(self):
        header, parts = split(FIXTURE)
        del header["run_date"]
        with tempfile.TemporaryDirectory() as tmp:
            scratch = Path(tmp)
            self.write_scratch(scratch, header, parts)
            result = self.merge_cli(scratch)
            self.assertEqual(result.returncode, 1)
            self.assertIn("header: missing run_date", result.stderr)
            self.assertNotIn("Traceback", result.stderr)
            self.assertFalse((scratch / "brief.json").exists())


def _set(path, value):
    """A mutation that sets parts[path...] = value."""

    def apply(header, parts):
        target = parts
        for key in path[:-1]:
            target = target[key]
        target[path[-1]] = value

    return apply


def _pop(path):
    def apply(header, parts):
        target = parts
        for key in path[:-1]:
            target = target[key]
        target.pop(path[-1])

    return apply


def _no_meetings_then(path, value):
    def apply(header, parts):
        parts["meetings"] = None
        _set(path, value)(header, parts)

    return apply


PING = {"url": "https://example.slack.com/p7", "pr": {"repo": "taxwire/example-api", "number": "102"}, "from_email": "z@taxwire.com", "to_me": True, "when": "2026-10-19T10:00:00Z", "line": "Pinged you"}

# Part files an LLM could plausibly write. None may crash the merge.
MALFORMED = {
    "review_prs written as null": _set(("github", "fields", "review_prs"), None),
    "a PR without author_email": _pop(("github", "fields", "my_prs", 0, "author_email")),
    "a PR without requested_reviewers": _pop(("github", "fields", "my_prs", 0, "requested_reviewers")),
    "requested_reviewers null": _set(("github", "fields", "my_prs", 0, "requested_reviewers"), None),
    "an ask without url": _pop(("slack", "fields", "slack_asks", 0, "url")),
    "an ask without tag": _pop(("slack", "fields", "slack_asks", 0, "tag")),
    "an action written as a string": _set(("gmail", "fields", "mail_asks", 0, "action"), "Reply"),
    "fields written as a list": _set(("gmail", "fields"), []),
    "handoffs written as a list": _set(("gmail", "handoffs"), []),
    "notes written as a sentence": _set(("gmail", "notes"), "Gmail was slow today."),
    "meetings written as null": _set(("meetings", "fields", "meetings"), None),
    "a meeting with attendees null": _set(("meetings", "fields", "meetings", 1, "attendees"), None),
    "a meeting without org": _pop(("meetings", "fields", "meetings", 1, "org")),
    "a meeting starting on a date only": _set(("meetings", "fields", "meetings", 1, "start"), "2026-10-20"),
    "an event starting at null": _no_meetings_then(("calendar", "handoffs", "events", 0, "start"), None),
    "an invite titled null": _no_meetings_then(("gmail", "handoffs", "invites", 0, "title"), None),
    "an event with a naive start": _no_meetings_then(("calendar", "handoffs", "events", 0, "start"), "2026-10-20T09:30:00"),
    "an out-of-office entry without email": _pop(("calendar", "fields", "out_of_office", 0, "email")),
    "an issue's pr_urls null": _set(("linear-enrich", "handoffs", "issues", "APP-1", "pr_urls"), None),
    "an issue's pr_urls holding null": _set(("linear-enrich", "handoffs", "issues", "APP-1", "pr_urls"), [None, "https://github.com/taxwire/example-web/pull/201"]),
    "issues written as a list": _set(("linear-enrich", "handoffs", "issues"), []),
    "commit_identities written as a list": _set(("github", "handoffs", "commit_identities"), []),
    "a login's identities written as one object": _set(("github", "handoffs", "commit_identities", "teammate-a"), {"name": "Ben", "email": "ben@taxwire.com"}),
    "a mention without line": _set(("slack-enrich", "handoffs", "pr_mentions"), [{"url": "https://example.slack.com/p8", "pr": {"repo": "taxwire/example-api", "number": 102}, "from_email": "z@taxwire.com", "to_me": True}]),
    "pr_mentions written as an object": _set(("slack-enrich", "handoffs", "pr_mentions"), {"https://x/1": {}}),
    "names written as a list": _set(("slack-enrich", "handoffs", "names"), [{"name": "Cleo Hart", "email": "cleo@taxwire.com"}]),
    "ok written as the string true": _set(("github", "sources", "github"), {"ok": "true"}),
    "linear written as null": _set(("linear", "fields", "linear"), None),
    "a timezone that isn't one": lambda header, parts: header.__setitem__("timezone", "Lisbon"),
    "header notes null": lambda header, parts: header.__setitem__("notes", None),
    "meeting prep reporting a source": _set(("meetings", "sources"), {"drive": {"ok": False, "error": "no tools"}}),
}


class MalformedPartsTest(unittest.TestCase):
    def test_no_malformed_part_crashes_the_merge_or_breaks_the_contract(self):
        fields = merge_brief.contract.brief_fields(FORMAT)
        for label, mutate in MALFORMED.items():
            with self.subTest(label):
                header, parts = split(FIXTURE)
                mutate(header, parts)
                brief, _, _ = merge_brief.merge(header, parts, FORMAT, PARTS)
                self.assertEqual(merge_brief.contract.validate(brief, fields), [])

    def test_a_ping_numbered_as_a_string_still_counts(self):
        header, parts = split(FIXTURE)
        parts["slack"]["handoffs"]["pr_links"] = [PING]
        brief, _, _ = run(parts, header)
        self.assertEqual(next(pr for pr in brief["review_prs"] if pr["number"] == 102)["blocking_signal"], "Pinged you")

    def test_an_ask_from_a_standup_attendee_isnt_tied_to_the_standup(self):
        header, parts = split(FIXTURE)
        ask = parts["slack"]["fields"]["slack_asks"][0]
        ask["action"] = {"verb": "Reply", "url": None, "by": None}
        parts["slack"]["handoffs"]["ask_senders"] = {ask["url"]: "cleo@taxwire.com"}
        brief, _, _ = run(parts, header)
        self.assertIsNone(brief["slack_asks"][0]["tag"])
        self.assertIsNone(brief["slack_asks"][0]["action"]["by"])

    def test_a_failed_source_from_an_enrichment_becomes_a_note(self):
        header, parts = split(FIXTURE)
        parts["meetings"]["sources"] = {"drive": {"ok": False, "error": "Drive wasn't reachable"}}
        brief, _, _ = run(parts, header)
        self.assertEqual(brief["meetings"], FIXTURE["meetings"])
        self.assertNotIn("drive", brief["sources"])
        self.assertIn("Drive wasn't reachable.", brief["notes"])

    def test_notes_written_as_a_sentence_are_kept(self):
        header, parts = split(FIXTURE)
        parts["gmail"]["notes"] = "Gmail was slow today."
        brief, _, _ = run(parts, header)
        self.assertIn("Gmail was slow today.", brief["notes"])

    def test_an_invite_in_utc_matching_a_calendar_event_is_dropped(self):
        header, parts = split(FIXTURE)
        parts["meetings"] = None
        event = parts["calendar"]["handoffs"]["events"][0]
        utc = event | {"on_calendar": False, "url": "https://calendar.google.com/calendar/event?action=VIEW&eid=dup", "start": "2026-10-20T08:30:00Z"}
        parts["gmail"]["handoffs"]["invites"].append(utc)
        brief, _, _ = run(parts, header)
        self.assertEqual([m["title"] for m in brief["meetings"]].count(event["title"]), 1)

    def test_only_reviews_the_scripts_recorded_are_written(self):
        planted = "taxwire:example-api:999:" + "9" * 40
        _, writes, problems = run(new_reviews=[REVIEW_ID, planted])
        self.assertEqual([w["doc_id"] for w in writes], [REVIEW_ID])
        self.assertTrue(any(planted in p for p in problems), problems)


class PlanWavesTest(unittest.TestCase):
    def plan(self, parts, wave):
        return plan_waves.plan(parts, wave, PARTS)

    def test_every_later_pass_has_a_rule(self):
        later = {name for name, owner in merge_brief.contract.ownership(PARTS).items() if owner.wave and owner.wave > 1}
        self.assertEqual(later, set(plan_waves.RULES))

    def test_the_fixture_starts_every_pass(self):
        _, parts = split(FIXTURE)
        self.assertEqual(self.plan(parts, 2), ["slack-enrich", "gmail-enrich", "linear-enrich"])
        self.assertEqual(self.plan(parts, 3), ["meetings", "github-enrich"])

    def test_nothing_to_enrich_starts_nothing(self):
        empty = {name: None for name in ("github", "slack", "gmail", "calendar", "linear", "linear-enrich")}
        self.assertEqual(self.plan(empty, 2), [])
        self.assertEqual(self.plan(empty, 3), [])

    def test_an_external_meeting_starts_gmail_enrich(self):
        _, parts = split(FIXTURE)
        for key in PR_LISTS:
            parts["github"]["fields"][key] = []
        parts["github"]["handoffs"]["pr_keys"] = []
        parts["gmail"]["handoffs"]["invites"] = []
        keys = parts["calendar"]["handoffs"]["meeting_keys"]
        parts["calendar"]["handoffs"]["meeting_keys"] = [k for k in keys if k["external_domains"]]
        self.assertIn("gmail-enrich", self.plan(parts, 2))
        parts["calendar"]["handoffs"]["meeting_keys"] = [k for k in keys if not k["external_domains"]]
        self.assertNotIn("gmail-enrich", self.plan(parts, 2))

    def test_malformed_hand_offs_never_crash_the_plan(self):
        mutations = {
            "meeting keys as strings": _set(("calendar", "handoffs", "meeting_keys"), ["https://cal/1"]),
            "a login's identities as one object": _set(("github", "handoffs", "commit_identities", "teammate-a"), {"name": "Ben"}),
            "pr_urls null": _set(("linear-enrich", "handoffs", "issues", "APP-1", "pr_urls"), None),
            "review_prs null": _set(("github", "fields", "review_prs"), None),
            "events as an object": _set(("calendar", "handoffs", "events"), {}),
        }
        for label, mutate in mutations.items():
            with self.subTest(label):
                header, parts = split(FIXTURE)
                mutate(header, parts)
                self.assertIsInstance(self.plan(parts, 2), list)
                self.assertIsInstance(self.plan(parts, 3), list)

    def test_github_enrich_only_for_linked_prs_outside_the_brief(self):
        _, parts = split(FIXTURE)
        open_urls = {pr["url"] for key in PR_LISTS for pr in FIXTURE[key]}
        for issue in parts["linear-enrich"]["handoffs"]["issues"].values():
            issue["pr_urls"] = [url for url in issue["pr_urls"] if url in open_urls]
        self.assertNotIn("github-enrich", self.plan(parts, 3))


if __name__ == "__main__":
    unittest.main()
