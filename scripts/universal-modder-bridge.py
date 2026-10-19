"""Narrow read-only bridge to the pinned upstream package; no agent or shell dispatcher."""
import json
import os
import pathlib
import sys

if sys.version_info < (3, 10):
    raise SystemExit("universal-modder requires Python 3.10+")

vendor = pathlib.Path(__file__).resolve().parents[1] / "vendor" / "universal-modder"
sys.path.insert(0, str(vendor))

if len(sys.argv) == 2 and sys.argv[1] == "probe":
    from um import __version__
    print(json.dumps({"python": sys.version.split()[0], "version": __version__}))
elif len(sys.argv) == 4 and sys.argv[1] == "scan":
    from um import scan
    root = pathlib.Path(sys.argv[2]).resolve(strict=True)
    if not root.is_dir():
        raise SystemExit("game path must be a directory")
    scan.MAX_ENTRIES = 12000
    scan.MAX_DEPTH = 6
    class HostIndex(scan.Index):
        def __init__(self, folder):
            self.root, self.files, self.dirs, self.truncated = folder, [], set(), False
            visited = 0
            def walk(directory, prefix="", depth=0):
                nonlocal visited
                try:
                    with os.scandir(directory) as entries:
                        for entry in entries:
                            visited += 1
                            if visited > scan.MAX_ENTRIES:
                                self.truncated = True
                                return
                            if entry.is_symlink():
                                continue
                            name = (prefix + entry.name).lower()
                            if entry.is_dir(follow_symlinks=False):
                                self.dirs.add(name)
                                if depth < 5 and entry.name.lower() not in (".git", "node_modules", "shadercache", "__pycache__"):
                                    walk(entry.path, name + "/", depth + 1)
                            elif entry.is_file(follow_symlinks=False):
                                self.files.append(name)
                            if self.truncated:
                                return
                except PermissionError:
                    self.truncated = True
            walk(folder)

        def path(self, relative):
            file = super().path(relative)
            if not file.resolve().is_relative_to(self.root):
                raise ValueError("indexed path escaped selected game")
            return file
    scan.Index = HostIndex
    # The host already selected an installed game. Keep discovery inside that directory.
    scan.resolve_game = lambda query: {"path": str(root), "name": sys.argv[3]}
    scan.win_folders = lambda: {}
    report = scan.scan(str(root))
    report["online_only"] = scan.online_only(sys.argv[3])
    print(json.dumps(report, ensure_ascii=False))
else:
    raise SystemExit("only probe and scan are exposed")
