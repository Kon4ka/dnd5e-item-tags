"""Build locally without credentials; publish only in the explicit publish command."""
import argparse
import html
import json
import os
from pathlib import Path
import re
import subprocess
import urllib.error
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def version_for(base, run_number):
    if not re.fullmatch(r"\d+\.\d+\.\d+", base):
        raise ValueError("module.json version must be major.minor.patch")
    if int(run_number) < 1:
        raise ValueError("Run number must be positive")
    major, minor, patch = map(int, base.split("."))
    return f"{major}.{minor}.{patch + int(run_number)}"


def release_manifest(source, repository, run_number):
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise ValueError("Invalid repository")
    result = dict(source)
    version = version_for(source["version"], run_number)
    url = f"https://github.com/{repository}"
    result.update(version=version, url=url,
                  manifest=f"{url}/releases/latest/download/module.json",
                  download=f"{url}/releases/download/v{version}/{source['id']}.zip",
                  changelog=f"{url}/releases/tag/v{version}")
    return result


def git(*args, root=ROOT, optional=False):
    proc = subprocess.run(["git", *args], cwd=root, capture_output=True, text=True, encoding="utf-8")
    if proc.returncode and not optional:
        raise RuntimeError(proc.stderr.strip())
    return proc.stdout.strip() if proc.returncode == 0 else ""


def notes_for(root, sha, repository, version):
    previous = git("describe", "--tags", "--match", "v[0-9]*", "--abbrev=0", f"{sha}^", root=root, optional=True)
    revision = f"{previous}..{sha}" if previous else sha
    commits = git("log", "--reverse", "--format=%H%x09%s", revision, root=root)
    lines = [f"## {version}", "", "Изменения по сообщениям коммитов:", ""]
    for entry in commits.splitlines():
        commit, subject = entry.split("\t", 1)
        subject = html.escape(subject)
        subject = re.sub(r"([\\`*_[\]{}])", r"\\\1", subject)
        lines.append(f"- {subject} ([{commit[:7]}](https://github.com/{repository}/commit/{commit}))")
    if previous:
        lines += ["", f"[Полное сравнение](https://github.com/{repository}/compare/{previous}...{sha})"]
    lines += ["", "Manifest URL для установки и обновления:", "",
              f"https://github.com/{repository}/releases/latest/download/module.json", "",
              "Обновление проверяется из меню модулей Foundry. Автоматические тесты не заменяют игровой тест."]
    return "\n".join(lines) + "\n"


def build(root=ROOT, repository=None, run_number=None, sha=None):
    repository = repository or os.environ.get("GITHUB_REPOSITORY", "Kon4ka/dnd5e-item-tags")
    run_number = run_number or os.environ.get("GITHUB_RUN_NUMBER", "1")
    sha = sha or os.environ.get("GITHUB_SHA") or git("rev-parse", "HEAD", root=root)
    source = json.loads((root / "module.json").read_text(encoding="utf-8"))
    manifest = release_manifest(source, repository, run_number)
    dist = root / "dist"
    dist.mkdir(exist_ok=True)
    encoded = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    (dist / "module.json").write_text(encoded, encoding="utf-8")
    notes = notes_for(root, sha, repository, manifest["version"])
    (dist / "release-notes.md").write_text(notes, encoding="utf-8")
    metadata = {"repository": repository, "sha": sha, "tag": f"v{manifest['version']}",
                "version": manifest["version"], "archive": f"{manifest['id']}.zip"}
    (dist / "release.json").write_text(json.dumps(metadata), encoding="utf-8")
    files = []
    for folder in ("scripts", "styles", "templates", "examples", "lang"):
        if (root / folder).exists():
            files.extend(p for p in (root / folder).rglob("*") if p.is_file())
    for name in ("README.md", "README.ru.md", "CHANGELOG.md", "LICENSE"):
        if (root / name).is_file():
            files.append(root / name)
    for field in ("esmodules", "styles"):
        for path in manifest.get(field, []):
            if (root / path).resolve() not in [p.resolve() for p in files]:
                raise ValueError(f"Missing package resource: {path}")
    with zipfile.ZipFile(dist / metadata["archive"], "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("module.json", encoded)
        archive.writestr("RELEASE_NOTES.md", notes)
        for path in sorted(files):
            archive.write(path, path.relative_to(root).as_posix())
    with zipfile.ZipFile(dist / metadata["archive"]) as archive:
        assert archive.testzip() is None
        assert json.loads(archive.read("module.json")) == manifest
    print(f"Built {metadata['tag']}: {dist / metadata['archive']}")
    return metadata


def request(url, token, method="GET", payload=None, raw=None, content_type="application/json"):
    data = raw if raw is not None else (json.dumps(payload).encode() if payload is not None else None)
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
        "Content-Type": content_type, "User-Agent": "dnd5e-item-tags-release",
        "X-GitHub-Api-Version": "2022-11-28"})
    with urllib.request.urlopen(req, timeout=90) as response:
        body = response.read()
        return json.loads(body) if body else None


def publish():
    token = os.environ["GH_TOKEN"]
    dist = ROOT / "dist"
    meta = json.loads((dist / "release.json").read_text())
    base = f"https://api.github.com/repos/{meta['repository']}/releases"
    try:
        release = request(f"{base}/tags/{meta['tag']}", token)
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        # Draft tags are not always returned by the tag endpoint. Find a prior interrupted attempt.
        release = None
        page = 1
        while True:
            batch = request(f"{base}?per_page=100&page={page}", token)
            release = next((r for r in batch if r["tag_name"] == meta["tag"]), None)
            if release or len(batch) < 100:
                break
            page += 1
    if release:
        if release["target_commitish"] != meta["sha"]:
            raise RuntimeError("Tag already belongs to another commit; refusing to overwrite")
        if not release["draft"]:
            print(f"Already published: {release['html_url']}")
            return
    else:
        release = request(base, token, "POST", {
            "tag_name": meta["tag"], "target_commitish": meta["sha"],
            "name": f"Item Tags for D&D5e {meta['version']}", "draft": True,
            "prerelease": False, "body": (dist / "release-notes.md").read_text(encoding="utf-8")})
    # Upload everything before publishing so latest never points at a half-uploaded package.
    for name in ("module.json", meta["archive"], "release-notes.md"):
        existing = next((asset for asset in release.get("assets", []) if asset["name"] == name), None)
        if existing:
            request(existing["url"], token, "DELETE")
        url = release["upload_url"].split("{")[0] + f"?name={name}"
        request(url, token, "POST", raw=(dist / name).read_bytes(), content_type="application/octet-stream")
    request(f"{base}/{release['id']}", token, "PATCH", {"draft": False, "make_latest": "legacy"})
    print(f"Published https://github.com/{meta['repository']}/releases/tag/{meta['tag']}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["build", "publish"])
    args = parser.parse_args()
    build() if args.command == "build" else publish()
