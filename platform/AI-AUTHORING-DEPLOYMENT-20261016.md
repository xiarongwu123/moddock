# AI executable Mod authoring release

The active creation service is `releases/20261016-authoring-fbdd9cd5`.
Archive SHA-256: `fbdd9cd582344cf14e728730fe6f68f42c68064487af65ccd4787d82c3f9a744`.
Previous service: `releases/20261016-pi-agent-de586a2e`.

Only the user creation service was restarted. The account release, payment
application, gateway binaries, databases and configuration were retained.
The deployment state is
`/home/xrw/moddock-studio/deployment-20261016-authoring-fbdd9cd5.json`.
The exact source manifest and native Pi authoring report are retained in that
release. Credentials remain in the existing private environment file.

Rollback through the uploaded deployment helper:

```sh
python3 /home/xrw/moddock-studio/incoming/deploy-studio-authoring.py rollback fbdd9cd582344cf14e728730fe6f68f42c68064487af65ccd4787d82c3f9a744
```

The desktop release is
`output/windows/20261016-mod-creation-0.6.4-final/Moddock-0.6.4-windows-x64-Setup.exe`.
SHA-256: `5f06ae1b45ffe646279cf1d0c04ad80405995cf67755a8418c4cd8ad870f150a`.
Its extracted ASAR matches 580 frozen files. The package verification report
records 310 passing tests, actual packaged renderer checks for BG3 and Ready or
Not, loader preparation, source preview, Mod library import, transactional
script installation and native Electron account/network checks.
The actual installer ASAR's WebAssembly compiler also compiles the complete
21,313-byte final script and reports a real syntax error for invalid input.

The generated Ready or Not Mod is
`output/mods/20261016-ready-or-not/release/ReadyOrNot-SuspectSecondChance-1.0.0-Windows-x64.zip`.
SHA-256: `cd98c18c298ef249413c25978b70325700079dd59ed0b8f7310a1299f0f3a48e`.
It contains the real Lua implementation and the six allowlisted official
UE4SS runtime files. ZIP readback verifies every file and CRC. The source
passed native Pi write/compile/repair, independent Lua compilation and 16
logic-sandbox cases; exact reports are in `output/mu-studio/ron-authoring-verified.json`
and the Mod's `mod-verification.json`.

Windows installation on physical hardware and actual game execution remain
unverified. The sandbox simulates the reflected API contract, not the real
game's damage call path, animation or shipping-build compatibility.
