import importlib.util
import re
import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
RUN_DIR = REPO / ".claude" / "skills" / "morning-return-run"
SETUP_DIR = REPO / ".claude" / "skills" / "morning-return-setup"
AGENTS = REPO / ".claude" / "agents"
PARTS = (RUN_DIR / "parts.md").read_text()

sys.path.insert(0, str(RUN_DIR / "scripts"))
_spec = importlib.util.spec_from_file_location("write_agents", SETUP_DIR / "write_agents.py")
write_agents = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(write_agents)
contract = write_agents.contract

COMMON = {"Read", "Grep", "Glob", "Write"}
READ_VERBS = {"get", "list", "search", "read"}
# Connector tools that read but don't start with a read verb.
READ_EXCEPTIONS = {"pull_request_read", "add_repo"}


def front_matter(text):
    head = text.split("---\n", 2)[1]
    return dict(line.split(": ", 1) for line in head.strip().splitlines())


def rendered():
    return {name: front_matter(text) for name, text in write_agents.render(PARTS).items()}


class AgentsTest(unittest.TestCase):
    def test_agent_files_are_what_parts_md_renders(self):
        on_disk = {path.name: path.read_text() for path in AGENTS.glob("mr-*.md")}
        self.assertEqual(on_disk, write_agents.render(PARTS), "run write_agents.py after editing parts.md")

    def test_every_pass_and_the_reviewer_has_an_agent(self):
        passes = {f"mr-{name}.md" for name, part in contract.ownership(PARTS).items() if part.tools}
        self.assertEqual(set(rendered()), passes | {"mr-review.md"})

    def test_each_agent_has_its_pass_model_and_effort(self):
        agents = rendered()
        for name, part in contract.ownership(PARTS).items():
            if part.tools:
                self.assertEqual((agents[f"mr-{name}.md"]["model"], agents[f"mr-{name}.md"]["effort"]), (part.model, part.effort), name)
        review = contract.reviewers(PARTS)
        self.assertEqual((agents["mr-review.md"]["model"], agents["mr-review.md"]["effort"]), (review.model, review.effort))

    def test_each_agent_holds_its_source_tools_and_the_common_ones(self):
        by_source = contract.tools_by_source(PARTS)
        agents = rendered()
        for name, part in contract.ownership(PARTS).items():
            if part.tools:
                tools = set(agents[f"mr-{name}.md"]["tools"].split(", "))
                self.assertEqual(tools, COMMON | set(by_source[part.tools]), name)

    def test_only_the_review_agent_runs_commands(self):
        for name, fields in rendered().items():
            self.assertEqual("Bash" in fields["tools"].split(", "), name == "mr-review.md", name)

    def test_connector_tools_only_read(self):
        for name, fields in rendered().items():
            for tool in fields["tools"].split(", "):
                if not tool.startswith("mcp__"):
                    continue
                short = tool.split("__", 2)[2]
                verb = re.sub(r"^slack_", "", short).split("_")[0]
                self.assertTrue(verb in READ_VERBS or short in READ_EXCEPTIONS, f"{name}: {tool}")

    def test_connector_tools_are_named_every_way_a_session_names_them(self):
        # Connector names as the Morning return Routine stores them, and their ids.
        routine = {
            "slack": ("Slack", "8a43f4e5-70cf-4897-b7f9-df683ecf443c"),
            "gmail": ("Gmail", "c7542e7c-885c-48cd-9b74-ecdf4fdf1d26"),
            "calendar": ("Google-Calendar", "9a7a8585-9f55-4ba2-9388-b200c6b55844"),
            "drive": ("Google-Drive", "379b4aa5-6cf0-49ac-9d45-1f9d61a76a0d"),
            "linear": ("Linear", "0e265249-b98c-497c-b9a3-1c37685deedb"),
        }
        by_source = contract.tools_by_source(PARTS)
        for source, (name, connector_id) in routine.items():
            servers = {tool.split("__")[1] for tool in by_source[source]}
            self.assertLessEqual({name, name.replace("-", "_"), connector_id}, servers, source)

if __name__ == "__main__":
    unittest.main()
