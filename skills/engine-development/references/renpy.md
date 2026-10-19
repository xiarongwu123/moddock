# RenPy

Read the selected game's readable .rpy/Python source for variable names, labels and callbacks. RenPy loads .rpy files in its game directory. engine-mod/renpy-python accepts real main.py; the host wraps it in init 999 python and owns a uniquely named .rpy, including cleanup of its derived .rpyc on disable/uninstall/restore.

Initialization runs before play. Install callbacks or wrappers there; do not mutate save-backed gameplay variables before their defaults exist. RenPy 7 and 8 use different Python versions; avoid version-specific syntax without evidence. Use rollback-aware store state and normal engine save behavior. Static Python parsing does not prove RenPy API compatibility.

Do not invent variable names from an archive filename. If only compiled/encrypted scripts exist and the request needs unknown variables or labels, preserve genuine implementation with the missing evidence as a blocker. Do not overwrite persistent/saves or enable developer consoles as a substitute for the requested mechanics.

References: https://www.renpy.org/doc/html/lifecycle.html
