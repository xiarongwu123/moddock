# Third-party notices

## BG3 API reference and Lua compiler

`vendor/bg3-api/Osiris.txt` is the generated Osiris interface reference from
https://github.com/LaughingLeader/BG3ModdingTools/blob/master/generated/Osi.lua.
Copyright (c) 2021 LaughingLeader, MIT; full terms are in
`vendor/bg3-api/OSIRIS-LICENSE`. `Ext.md` records interface facts and links to
their upstream definitions. BG3SE binaries and its documentation are not bundled.

`wasmoon` 1.16.0 (MIT) provides a WebAssembly Lua compiler. Only a fixed `load`
wrapper is run by the desktop; generated Lua is compiled, never executed there.
Dependency licenses accompany the runtime modules.

## Larian package format

`larian-pak.cjs` implements the LSPK v18 format documented in Norbyte's
LSLib PackageFormat.cs, PackageWriter.cs and PackageReader.cs, reviewed at
commit `6f5f6987d10d8485876b8368431c948e4dea4f83`:
https://github.com/Norbyte/lslib

MIT License

Copyright (c) 2015 Norbyte

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

`@xmldom/xmldom` (MIT) parses and preserves BG3 LSX module settings. Its
license is included in the installed dependency. Script Extender itself and
game assets are not bundled or redistributed by Moddock.

## universal-modder

The bundled `vendor/universal-modder` snapshot includes `um`, `skills`,
`knowledge`, README, pyproject and the original LICENSE at commit
`23902ef42e8ea9b077bfbbf6911eb8ea0348e55a` of:
https://github.com/rehan-remade/universal-modder

`scripts/universal-modder-bridge.py` invokes the original `um.scan` detection
through a bounded host index. `game-diagnostics.cjs` also adapts selected
fingerprints as a fallback. Other bundled commands are not exposed as host actions.
Font assets retain their own SIL Open Font License notices in
`vendor/universal-modder/um/fonts/OFL-JetBrainsMono.txt` and
`vendor/universal-modder/um/fonts/OFL-SpaceGrotesk.txt`.

MIT License

Copyright (c) 2026 Rehan and universal-modder contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
