"""Read-only static workflow checks. Never import or run the collector."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def block(text, key):
    """Read an ordinary top-level block; unexpected YAML syntax fails closed."""
    match = re.search(r"(?m)^" + re.escape(key) + r":[ \t]*\n", text)
    if not match:
        return None
    result = []
    for line in text[match.end():].splitlines():
        if line and not line[0].isspace() and not line.startswith("#"):
            break
        if line.strip() and not line.lstrip().startswith("#"):
            result.append(line.rstrip())
    return "\n".join(result)


class BaconWorkflowTests(unittest.TestCase):
    def test_collector_is_manual_only_and_separate_from_pages(self):
        workflow = (ROOT / ".github/workflows/bacon-feed.yml").read_text()
        self.assertEqual(block(workflow, "on"), "  workflow_dispatch:")
        self.assertEqual(block(workflow, "permissions"), "  contents: write")
        self.assertEqual(workflow.count("run: python scripts/bacon-feed.py"), 1)
        self.assertIn("git add data/bacon-intelligence.json data/bacon-history.json", workflow)
        self.assertIn("git push", workflow)
        for forbidden in ("schedule:", "push:", "pages:", "id-token:",
                          "environment:", "github-pages", "upload-pages-artifact",
                          "deploy-pages", "Prepare public site"):
            self.assertNotIn(forbidden, workflow)

    def test_guard_runs_only_static_read_only_check(self):
        workflow = (ROOT / ".github/workflows/bacon-workflow-guard.yml").read_text()
        self.assertEqual(block(workflow, "permissions"), "  contents: read")
        events = block(workflow, "on")
        self.assertIsNotNone(events)
        self.assertIn("  push:", events)
        self.assertIn("  pull_request:", events)
        self.assertNotIn("schedule:", events)
        commands = re.findall(r"(?m)^\s*run:\s*(.+)$", workflow)
        self.assertEqual(commands, [
            "python -m unittest discover -s scripts -p 'test_bacon_workflow.py'"
        ])
        for forbidden in ("scripts/bacon-feed.py", "git push", "contents: write",
                          "pages:", "id-token:", "deploy-pages", "upload-pages-artifact"):
            self.assertNotIn(forbidden, workflow)


if __name__ == "__main__":
    unittest.main()

