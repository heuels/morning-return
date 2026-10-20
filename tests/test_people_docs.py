import base64
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / ".claude" / "skills" / "morning-return-run" / "scripts"
sys.path.insert(0, str(SCRIPTS))
_spec = importlib.util.spec_from_file_location("people_docs", SCRIPTS / "people_docs.py")
people_docs = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(people_docs)

NOW = "2026-10-20T07:00:00Z"
PHOTO = "https://avatars.slack-edge.com/2024-01-01/1_abc_192.jpg"


def png(width, height):
    out = io.BytesIO()
    Image.new("RGB", (width, height), (40, 120, 80)).save(out, "PNG")
    return out.getvalue()


def brief_naming(*emails):
    return {
        "review_prs": [{"author_email": emails[0], "requested_reviewers": [{"login": "x", "email": emails[1]}]}],
        "team_review_prs": [],
        "my_prs": [],
        "meetings": [{"attendees": [{"email": e} for e in emails[2:]] + [{"email": "dana@acme.example"}]}],
        "mail_asks": [],
        "slack_asks": [],
        "linear_asks": [],
        "slack_discussions": [],
        "out_of_office": [],
        "linear": {"assigned": [], "project_updates": [], "stale": []},
    }


class PeopleDocsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.scratch = Path(self.tmp.name)
        (self.scratch / "parts").mkdir()
        (self.scratch / "existing" / "people").mkdir(parents=True)
        self.profiles = {
            "ana@taxwire.com": {"name": "Ana Lima", "photo_url": PHOTO},
            "ben@taxwire.com": {"name": "Ben Ortiz", "photo_url": PHOTO},
            "cleo@taxwire.com": {"name": "Cleo Hart", "photo_url": PHOTO},
        }
        self.fetched = []

    def tearDown(self):
        self.tmp.cleanup()

    def existing(self, email, updated_at):
        doc = {"name": email, "org": "Taxwire", "photo": None, "updated_at": updated_at}
        (self.scratch / "existing" / "people" / f"{email}.json").write_text(json.dumps(doc))

    def fetch(self, url):
        self.fetched.append(url)
        return png(100, 60)

    def run_docs(self, brief, versions=None, fetch=None):
        enrich = {"sources": {}, "fields": {}, "notes": [], "handoffs": {"people_profiles": self.profiles}}
        (self.scratch / "parts" / "slack-enrich.json").write_text(json.dumps(enrich))
        return people_docs.write_people(self.scratch, brief, self.scratch / "existing", versions or {}, NOW, fetch=fetch or self.fetch)

    def test_only_missing_or_old_people_are_written(self):
        self.existing("ana@taxwire.com", "2026-10-19T07:00:00Z")
        self.existing("ben@taxwire.com", "2026-09-01T07:00:00Z")
        writes = self.run_docs(brief_naming("ana@taxwire.com", "ben@taxwire.com", "cleo@taxwire.com"), versions={"ben@taxwire.com": 3})
        self.assertEqual(sorted(w["doc_id"] for w in writes), ["ben@taxwire.com", "cleo@taxwire.com"])

    def test_outsiders_never_get_a_document(self):
        writes = self.run_docs(brief_naming("ana@taxwire.com", "ben@taxwire.com"))
        self.assertNotIn("dana@acme.example", [w["doc_id"] for w in writes])

    def test_a_photo_from_another_host_is_never_fetched(self):
        self.profiles["cleo@taxwire.com"]["photo_url"] = "https://evil.example/x.jpg"
        self.run_docs(brief_naming("ana@taxwire.com", "ben@taxwire.com", "cleo@taxwire.com"))
        self.assertNotIn("https://evil.example/x.jpg", self.fetched)
        doc = json.loads((self.scratch / "people" / "cleo@taxwire.com.json").read_text())
        self.assertIsNone(doc["photo"])

    def test_plain_http_is_never_fetched(self):
        self.profiles["cleo@taxwire.com"]["photo_url"] = PHOTO.replace("https://", "http://")
        self.run_docs(brief_naming("ana@taxwire.com", "ben@taxwire.com", "cleo@taxwire.com"))
        self.assertEqual(len(self.fetched), 2)

    def test_photos_come_out_64_square_jpeg(self):
        self.run_docs(brief_naming("ana@taxwire.com", "ben@taxwire.com"))
        doc = json.loads((self.scratch / "people" / "ana@taxwire.com.json").read_text())
        self.assertTrue(doc["photo"].startswith("data:image/jpeg;base64,"))
        image = Image.open(io.BytesIO(base64.b64decode(doc["photo"].split(",", 1)[1])))
        self.assertEqual((image.format, image.size), ("JPEG", (64, 64)))
        self.assertEqual(doc | {"photo": None}, {"name": "Ana Lima", "org": "Taxwire", "photo": None, "updated_at": NOW})

    def test_a_failed_fetch_writes_a_null_photo(self):
        def broken(url):
            raise OSError("timed out")

        self.run_docs(brief_naming("ana@taxwire.com", "ben@taxwire.com"), fetch=broken)
        self.assertIsNone(json.loads((self.scratch / "people" / "ana@taxwire.com.json").read_text())["photo"])

    def test_an_existing_document_is_pinned_to_its_version(self):
        self.existing("ben@taxwire.com", "2026-09-01T07:00:00Z")
        writes = self.run_docs(brief_naming("ana@taxwire.com", "ben@taxwire.com"), versions={"ben@taxwire.com": 3})
        by_id = {w["doc_id"]: w for w in writes}
        self.assertEqual(by_id["ben@taxwire.com"]["if_version"], 3)
        self.assertNotIn("if_version", by_id["ana@taxwire.com"])
        self.assertEqual(by_id["ana@taxwire.com"]["collection"], "people")
        self.assertTrue(Path(by_id["ana@taxwire.com"]["file_path"]).is_absolute())

    def test_an_existing_document_without_a_version_is_left_alone(self):
        self.existing("ben@taxwire.com", "2026-09-01T07:00:00Z")
        writes = self.run_docs(brief_naming("ana@taxwire.com", "ben@taxwire.com"))
        self.assertNotIn("ben@taxwire.com", [w["doc_id"] for w in writes])

    def test_someone_without_a_profile_is_skipped(self):
        del self.profiles["cleo@taxwire.com"]
        writes = self.run_docs(brief_naming("ana@taxwire.com", "ben@taxwire.com", "cleo@taxwire.com"))
        self.assertNotIn("cleo@taxwire.com", [w["doc_id"] for w in writes])

    def test_list_fresh_names_only_recent_documents(self):
        self.existing("ana@taxwire.com", "2026-10-19T07:00:00Z")
        self.existing("ben@taxwire.com", "2026-09-01T07:00:00Z")
        self.assertEqual(people_docs.fresh(self.scratch / "existing", NOW), ["ana@taxwire.com"])

    def test_writes_are_added_to_the_review_writes(self):
        (self.scratch / "writes.json").write_text(json.dumps([{"op": "set", "collection": "reviews", "doc_id": "r", "file_path": "/x"}]))
        enrich = {"sources": {}, "fields": {}, "notes": [], "handoffs": {"people_profiles": self.profiles}}
        (self.scratch / "parts" / "slack-enrich.json").write_text(json.dumps(enrich))
        (self.scratch / "brief.json").write_text(json.dumps(brief_naming("ana@taxwire.com", "ben@taxwire.com")))
        (self.scratch / "versions.json").write_text("{}")
        people_docs.main(
            ["--scratch", str(self.scratch), "--existing", str(self.scratch / "existing"), "--versions", str(self.scratch / "versions.json"), "--now", NOW],
            fetch=self.fetch,
        )
        writes = json.loads((self.scratch / "writes.json").read_text())
        self.assertEqual([w["collection"] for w in writes], ["reviews", "people", "people"])


if __name__ == "__main__":
    unittest.main()
