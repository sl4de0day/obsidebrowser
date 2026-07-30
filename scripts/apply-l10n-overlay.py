#!/usr/bin/env python3
#
# Standalone re-run of ONLY the l10n overlay step from librewolf-patches.py,
# with UTF-8/newline pinned so it works on non-UTF-8 Windows locales (cp1254).
# The main patcher had already finished every other step; only this loop crashed.
#
# Usage: python apply-l10n-overlay.py <srcdir>   (run from obside-build)
#
import os
import sys
from pathlib import Path

srcdir = sys.argv[1]
os.chdir(srcdir)

print("-> Applying LibreWolf/Obside locales (UTF-8 safe)")
l10n_dir = Path("..", "l10n")
count_w = 0
count_a = 0
for source_path in l10n_dir.rglob("*"):
    if source_path.is_dir() or source_path.name.endswith(".md"):
        continue

    rel_path = source_path.relative_to(l10n_dir)
    if rel_path.parts[0] == "en-US":
        target_path = Path(rel_path.parts[1], "locales", "en-US", *rel_path.parts[2:])
    else:
        target_path = Path("lw", "l10n", *rel_path.parts)

    target_path.parent.mkdir(parents=True, exist_ok=True)

    write_mode = "w"
    if ".inc" in target_path.name:
        target_path = target_path.with_name(target_path.name.replace(".inc", ""))
        write_mode = "a"

    if not target_path.exists() and write_mode == "a":
        print(f"warning: target file {target_path} doesn't exist")

    with open(target_path, write_mode, encoding="utf-8", newline="") as target_file:
        with open(source_path, "r", encoding="utf-8", newline="") as source_file:
            target_file.write(("\n\n" if write_mode == "a" else "") + source_file.read())

    if write_mode == "w":
        count_w += 1
    else:
        count_a += 1

print(f"overlay done: wrote {count_w} files, appended {count_a} files")
