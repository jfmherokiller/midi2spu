# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser-based tool that converts a MIDI file into a text script for the ZSPU (a scriptable
sound-processing unit / synth implemented by the `gmod_wire_spu` entity in Garry's Mod's Wiremod
addon — source: https://github.com/wiremod/wire/tree/master/lua/entities/gmod_wire_spu). The user
picks a `.mid` file in the page, it's parsed client-side, and the tool downloads a generated `.txt`
script containing note data and a small playback program written in the ZSPU's own bytecode-like
language, which the entity in that repo executes. If a change to the generated script format
doesn't produce a script the SPU actually accepts, that repo is the ground truth for the SPU's
instruction set — check it before guessing at syntax.

It is a 100% client-side static site with no backend or build-time server component.

Live version: https://jfmherokiller.github.io/midi2spu/

## Build

Vite-based; no test suite, linter, or CI config in this repo.

```
npm install
npm run dev       # start the Vite dev server (open the printed localhost URL)
npm run build     # production build to dist/
npm run preview   # serve the dist/ build locally
```

## Architecture

Source lives in `src/`, five files:

- **`MidiFile.ts`** — standalone MIDI file parser. Takes the raw `ArrayBuffer` of an uploaded
  `.mid` file (read via `FileReader.readAsArrayBuffer`) and parses it with a `ByteStream` class
  (backed by a `DataView`) that reads big-endian ints and MIDI variable-length ints directly off
  the bytes. Exposes a `Midifile` class with `.header.ticksPerBeat` and `.tracks: IEvent[][]`,
  where each track is a flat array of parsed MIDI events in file order (note on/off, tempo meta
  events, etc. — see the `IEvent` interface for the full event shape, and each event's `deltaTime`
  for ticks elapsed since the previous event in that track). This is a self-contained parser, not
  the app logic.
- **`utilityfunctions.ts`** — all of the MIDI→ZSPU translation logic:
  - `GetTempo` pulls the tempo meta-event from track 0 (falling back to the MIDI spec default of
    120 BPM if none exists) and converts µs-per-beat into the generated script's tempo units by
    multiplying BPM by `STEPS_PER_BEAT` (10).
  - `getnotes` walks every track's events and, using each event's `deltaTime` converted to output
    steps via `ticksPerBeat`/`STEPS_PER_BEAT`, produces one array entry per output step — holding
    the currently-sounding note (or `-1` for silence) across however many steps elapsed before the
    next event. This is what encodes real note duration and rests into the output, not just a
    per-event dump. Percussion-channel (index 9, i.e. GM channel 10) events don't change the held
    note but their elapsed time still counts. `STEPS_PER_BEAT` must stay in sync between this
    function and `GetTempo` — it's the shared time resolution both assume.
  - `CreateDBLines` chunks each track's step array into ZSPU `db ...;` data-statement lines (32
    values per line).
  - `CreateFileString` assembles the full ZSPU script: per-channel `wset`/`chwave`/`chstart` setup
    blocks, a generated `main()` loop that reads one index into every track array per tick and
    calls `chpitch` per channel, a `tempo()` busy-wait helper, a `strlen()` helper (ZSPU has no
    native one), and finally the `db` data blocks from `CreateDBLines`.
- **`download.ts`** — `downloadTextFile(content, filename, mimeType)`, a small native
  Blob + `URL.createObjectURL` + `<a download>` helper. The project has no runtime dependencies.
- **`processing.ts`** — glue: `parsethefile(midi: ArrayBuffer)` runs the parse → tempo → notes →
  db-lines → file-string pipeline above and calls `downloadTextFile` to save the result as
  `songtest.txt`.
- **`app.ts`** — the only DOM-facing code. On `window.onload`, wires the `#file` `<input>`'s
  `change` event to read the selected file via `readAsArrayBuffer` and hand the result to
  `parsethefile`.

When changing the generated ZSPU script format, `constructBodyOfFile` and `constructLoopBlocks` in
`utilityfunctions.ts` are the two functions that hand-emit the ZSPU source text — the ZSPU
language itself (`fpwr`, `chpitch`, `wset`, `chwave`, `chvolume`, `chstart`, `timer`, etc.) is not
implemented here, only text-generated as a target format for the Lua entity linked above.

There is no in-browser playback/preview of the uploaded MIDI file — the original `index.html` did
load an external `midi.js` script (almost certainly the mudcube/MIDI.js soundfont-playback
library, given the filename), but nothing in `src/` ever referenced it, so it was dead and was
removed. If browser playback is wanted, it'd need to be added from scratch as a new feature.
