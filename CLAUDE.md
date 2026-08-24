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

Source lives in `src/`, six files:

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
- **`player.ts`** — `ZspuPlayer`, a Web Audio playback engine for the "Play preview" button.
  Deliberately mimics the real ZSPU rather than doing generic MIDI/soundfont playback (see
  `docs/HLZASM.md`'s "SPU audio model" section for why): one plain sine `OscillatorNode` per
  track/channel, frequency = `880 * 2^(note/12)` matching the generator's `CHPITCH` ratio and its
  `synth/sine_880.wav` base sample, hard on/off steps (no ADSR, matching the generator never
  calling `CHADSR`). Plays the *converted/quantized* note arrays (`getnotes()`'s output — literally
  what ends up in the downloaded script), not the raw MIDI, so the preview matches the actual
  output including its quirks (e.g. the pitch formula's lack of a reference-pitch offset). All
  playback is scheduled up front via `AudioParam.setValueAtTime` at construction time, not driven
  by JS timers, for accurate timing. One-shot (not looping like the real ZSPU's `main()` does).
- **`processing.ts`** — `convertMidi(midi: ArrayBuffer): ConversionResult` runs the parse → tempo →
  notes → db-lines → file-string pipeline and returns `{tracks, tempo, scriptText}` — the raw
  quantized note arrays and tempo (for `player.ts`) alongside the finished script text (for
  `download.ts`). Note: `CreateDBLines` mutates its input via `.splice`, so `convertMidi` passes it
  a cloned copy of `tracks` (`tracks.map(t => t.slice())`) rather than the array it returns.
- **`app.ts`** — the only DOM-facing code. On `window.onload`, wires the `#file` `<input>`'s
  `change` event to read the selected file via `file.arrayBuffer()` and call `convertMidi`, then
  reveals a `#controls` block (`#play`/`#stop`/`#download` buttons, hidden until a file is loaded)
  wired to `ZspuPlayer` and `downloadTextFile` respectively.

When changing the generated ZSPU script format, `constructBodyOfFile` and `constructLoopBlocks` in
`utilityfunctions.ts` are the two functions that hand-emit the ZSPU source text — the ZSPU
language itself (`fpwr`, `chpitch`, `wset`, `chwave`, `chvolume`, `chstart`, `timer`, etc.) is not
implemented here, only text-generated as a target format for the Lua entity linked above. See
**[`docs/HLZASM.md`](docs/HLZASM.md)** for the full language/instruction-set reference (it's
called HLZASM, not "ZSPU bytecode" — that doc has the full opcode tables and syntax rules, sourced
directly from the Wiremod `wire` addon's compiler and VM source).

In-browser playback (`player.ts`, above) replaces the original `index.html`'s dead external
`midi.js` `<script>` tag (removed during the earlier modernization pass — almost certainly the
mudcube/MIDI.js soundfont library, going by the filename, but nothing in `src/` ever referenced
it). There is currently no in-browser *editing* of the note data before conversion/playback —
raised as a possible future feature but explicitly out of scope so far.
