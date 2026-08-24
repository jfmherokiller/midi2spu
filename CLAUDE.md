# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser-based tool that converts a MIDI file into a text script for the ZSPU (a scriptable
sound-processing unit / synth used by the `zspu` addon in Garry's Mod). The user picks a `.mid`
file in the page, it's parsed client-side, and the tool downloads a generated `.txt` script
containing note data and a small playback program for the ZSPU's own bytecode-like language.

It is a 100% client-side static site (no backend) — the `.csproj`/`.sln` exist only because the
project was authored in Visual Studio as an "Empty Web Application" wrapping the TypeScript
compiler; there is no C# code anywhere in the project.

Live version: https://jfmherokiller.github.io/midi2spu/

## Build

TypeScript → single bundled `data.js` via Browserify, run through the legacy Gulp 3 toolchain:

```
npm install          # also runs `typings install` (legacy typings tool, not npm @types)
tsc                  # compiles src/*.ts -> src/*.js per tsconfig.json
gulp                 # browserifies src/app.js into data.js + data.js.map at repo root
```

`package.json`'s `prepublish` script runs `tsc && gulp` as a single step. There is no test suite,
linter, or CI config in this repo.

`data.js` / `data.js.map` and the per-file `src/*.js` / `src/*.js.map` outputs are committed
build artifacts, not hand-edited — always change the corresponding `.ts` source and rebuild.

To try it locally, just open `index.html` in a browser (or serve the directory statically) after
building — it needs no server-side component.

## Architecture

Source lives in `src/`, four files, compiled in this dependency order:

- **`MidiFile.ts`** — standalone MIDI file parser (reads the binary/base64 string produced by
  `FileReader.readAsBinaryString`). Exposes a `Midifile` class with `.tracks: IEvent[][]`, where
  each track is a flat array of parsed MIDI events (note on/off, tempo meta events, etc. — see the
  `IEvent` interface for the full event shape). This is a self-contained parser, not the app logic.
- **`utilityfunctions.ts`** — all of the MIDI→ZSPU translation logic:
  - `GetTempo` pulls the tempo meta-event from track 0 and converts µs-per-beat to the value the
    generated ZSPU script expects.
  - `getnotes` walks every track and flattens each into a plain array of note numbers, using `-1`
    as a sentinel for "note off" (channel 10 / the MIDI percussion channel is skipped).
  - `CreateDBLines` chunks each track's note array into ZSPU `db ...;` data-statement lines (32
    values per line).
  - `CreateFileString` assembles the full ZSPU script: per-channel `wset`/`chwave`/`chstart` setup
    blocks, a generated `main()` loop that reads one index into every track array per tick and
    calls `chpitch` per channel, a `tempo()` busy-wait helper, a `strlen()` helper (ZSPU has no
    native one), and finally the `db` data blocks from `CreateDBLines`.
- **`processing.ts`** — glue: `parsethefile(midi)` runs the three steps above in order and calls
  `downloadjs` to save the result as `songtest.txt`.
- **`app.ts`** — the only DOM-facing code. On `window.onload`, wires the `#file` `<input>`'s
  `change` event to read the selected file as a binary string and hand it to `parsethefile`.

When changing the generated ZSPU script format, `constructBodyOfFile` and `constructLoopBlocks` in
`utilityfunctions.ts` are the two functions that hand-emit the ZSPU source text — the ZSPU
language itself (`fpwr`, `chpitch`, `wset`, `chwave`, `chvolume`, `chstart`, `timer`, etc.) is not
implemented here, only text-generated as a target format.

Note: `index.html` also loads a third-party `midi.js` from an external `googledrive.com` host
before `data.js`. Nothing in `src/` references it (`MidiFile.ts` is this project's own parser and
is what's actually used) — it appears to be an unused leftover `<script>` tag rather than a real
dependency.
