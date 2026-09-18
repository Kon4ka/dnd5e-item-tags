import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location("release", Path(__file__).resolve().parents[1] / "tools/release.py")
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
    def test_version_increases_and_rerun_is_stable(self):
        self.assertEqual(release.version_for("0.1.1", 1), "0.1.2")
        self.assertEqual(release.version_for("0.1.1", 10), "0.1.11")
        self.assertEqual(release.version_for("0.1.1", 10), release.version_for("0.1.1", 10))
        with self.assertRaises(ValueError):
            release.version_for("0.1.1", 0)

    def test_manifest_uses_stable_feed_and_pinned_download(self):
        result = release.release_manifest({"version": "0.1.1", "id": "dnd5e-item-tags"}, "Kon4ka/dnd5e-item-tags", 2)
        self.assertTrue(result["manifest"].endswith("/releases/latest/download/module.json"))
        self.assertTrue(result["download"].endswith("/releases/download/v0.1.3/dnd5e-item-tags.zip"))

    def test_archive_and_changelog(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def git(*args):
                return subprocess.check_output(["git", *args], cwd=root, text=True, encoding="utf-8").strip()
            git("init", "--quiet")
            git("config", "user.name", "Release Test")
            git("config", "user.email", "test@example.invalid")
            (root / "scripts").mkdir()
            (root / "scripts/main.mjs").write_text("export const ready = true;")
            source = {"id": "dnd5e-item-tags", "version": "0.1.1", "esmodules": ["scripts/main.mjs"]}
            (root / "module.json").write_text(json.dumps(source))
            git("add", ".")
            git("commit", "--quiet", "-m", "Initial")
            git("tag", "v0.1.2")
            (root / "scripts/main.mjs").write_text("export const ready = false;")
            git("commit", "-am", "Fix <tags> [link] $(echo test)", "--quiet")
            metadata = release.build(root, "Kon4ka/dnd5e-item-tags", 2)
            self.assertEqual(metadata["tag"], "v0.1.3")
            self.assertEqual(json.loads((root / "module.json").read_text()), source)
            with zipfile.ZipFile(root / "dist/dnd5e-item-tags.zip") as archive:
                self.assertIn("module.json", archive.namelist())
                self.assertIn("scripts/main.mjs", archive.namelist())
                self.assertFalse(any(name.startswith((".git", "tests/", "tools/")) for name in archive.namelist()))
                self.assertEqual(json.loads(archive.read("module.json"))["version"], "0.1.3")
                notes = archive.read("RELEASE_NOTES.md").decode()
                self.assertIn("Fix &lt;tags&gt;", notes)
                self.assertNotIn("- Initial", notes)

    def test_publish_uploads_before_latest_and_does_not_republish(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            dist = root / "dist"
            dist.mkdir()
            meta = {"repository": "owner/repo", "sha": "abc123", "tag": "v0.1.2", "version": "0.1.2", "archive": "module.zip"}
            (dist / "release.json").write_text(json.dumps(meta))
            for name in ("module.json", "module.zip", "release-notes.md"):
                (dist / name).write_text("test")
            draft = {"id": 1, "target_commitish": "abc123", "draft": True, "assets": [], "upload_url": "https://uploads.github.com/test{?name}"}
            calls = []
            def request(url, token, method="GET", payload=None, **kwargs):
                kwargs["payload"] = payload
                calls.append((method, kwargs))
                return draft if method == "GET" else {}
            with patch.object(release, "ROOT", root), patch.dict(release.os.environ, {"GH_TOKEN": "test"}), patch.object(release, "request", side_effect=request):
                release.publish()
                self.assertEqual([call[0] for call in calls], ["GET", "POST", "POST", "POST", "PATCH"])
                self.assertEqual(calls[-1][1]["payload"], {"draft": False, "make_latest": "legacy"})
            # Published releases are immutable on a re-run.
            draft.update(draft=False, html_url="https://example.invalid/release")
            with patch.object(release, "ROOT", root), patch.dict(release.os.environ, {"GH_TOKEN": "test"}), patch.object(release, "request", return_value=draft) as req:
                release.publish()
                self.assertEqual(req.call_count, 1)


if __name__ == "__main__":
    unittest.main()
