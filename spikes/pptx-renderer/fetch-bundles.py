"""Fetch only pinned comparison bundles; do not install or run package scripts."""

import base64
import hashlib
import io
import sys
import tarfile
from pathlib import Path
from urllib.request import urlopen


PACKAGES = {
    "preview": ("pptx-preview/-/pptx-preview-1.0.7.tgz",
                "YByocJuyxAR4YB4Q3+VAxdLfEvA5LojG1gAJsx2Mw0QU5FJPps/2fkJOupJ6oBbA+KdWRpuAk6G6T34rKCHVxw=="),
    "webppt": ("@web-ppt/core/-/core-0.8.0.tgz",
               "ypG3yf+guKEUm0T0l41w1GV+UWXXyCuDN7vwyurtG+dXAbrQiSdS88gGTNx0C/d5y/GkG3SLQxPhWJgJQHMRtQ=="),
    "fflate": ("fflate/-/fflate-0.8.3.tgz",
               "tbZNuJrLwGUp3zshBtdy4W+ORxZuIh8a5ilyIEQDC5rY1f3U20JMry0Ll3WBzU58EZKsEuJFXhb5gwv8CsPvgA=="),
}


def fetch(root):
    for name, (route, expected) in PACKAGES.items():
        for registry in ("https://registry.npmjs.org", "https://registry.npmmirror.com"):
            try:
                with urlopen(f"{registry}/{route}", timeout=12) as response:
                    data = response.read(4_000_000)
                break
            except OSError:
                if registry.endswith("npmmirror.com"):
                    raise
        if base64.b64encode(hashlib.sha512(data).digest()).decode() != expected:
            raise ValueError(f"Integrity check failed: {name}")
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
            for entry in archive.getmembers():
                parts = entry.name.split("/")
                if not entry.isfile() or parts[0] != "package" or ".." in parts:
                    continue
                if not (parts[-1].endswith((".js", ".d.ts")) or parts[-1] in {"README.md", "LICENSE"}):
                    continue
                target = root.joinpath(name, *parts[1:])
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.extractfile(entry).read())
        print(name, len(data))


if __name__ == "__main__":
    fetch(Path(sys.argv[1]))
