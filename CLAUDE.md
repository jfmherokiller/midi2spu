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

## Visual style

The page is styled as classic Windows XP via the [`xp.css`](https://botoxparty.github.io/XP.css/)
library (`import "xp.css/dist/XP.css"` in `app.ts`, bundled by Vite) — two fixed `.window` panels
(xp.css's title-bar/window-body markup), not real draggable window management. Background is a
plain CSS blue gradient in `app.css`, not the copyrighted "Bliss" wallpaper. `vite.config.ts` sets
`build.cssMinify: false` — Vite's default `lightningcss` minifier fails on a selector pattern in
xp.css's bundled CSS, and this build's Vite has no `esbuild` fallback available; xp.css's own dist
output is already minified anyway, so this costs little.

## Architecture

Source lives in `src/`:

- **`MidiFile.ts`** — standalone MIDI file parser. Takes the raw `ArrayBuffer` of an uploaded
  `.mid` file (read via `file.arrayBuffer()`) and parses it with a `ByteStream` class (backed by a
  `DataView`) that reads big-endian ints and MIDI variable-length ints directly off the bytes.
  Exposes a `Midifile` class with `.header.ticksPerBeat` and `.tracks: IEvent[][]`, where each
  track is a flat array of parsed MIDI events in file order (note on/off, tempo meta events, etc.
  — see the `IEvent` interface for the full event shape, and each event's `deltaTime` for ticks
  elapsed since the previous event in that track). This is a self-contained parser, not app logic.
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
    function and `GetTempo` — it's the shared time resolution both assume, and also what the piano
    roll editor's grid columns are quantized to.
  - `WaveformId`/`WAVEFORM_PATHS` — the 4 real built-in ZSPU waveform slots (confirmed in
    `zcpu-notes/wire/lua/entities/gmod_wire_spu/cl_spuvm.lua`'s `VM:Reset()`): square/saw/tri/sine
    mapped to their `synth/*.wav` resource paths. Shared between script generation here and
    `player.ts`'s oscillator-type mapping.
  - `CreateDBLines` chunks each track's step array into ZSPU `db ...;` data-statement lines (32
    values per line). Mutates its input via `.splice` — callers must pass a cloned array if they
    need the original afterward (`processing.ts`'s `generateScript` does this).
  - `CreateFileString(dblinesin, tempo, waveforms, volumes)` assembles the full ZSPU script:
    per-channel `wset`/`chwave`/`chvolume`/`chstart` setup blocks (one **named wave string var per
    track**, e.g. `wave0`/`wave1`/..., each bound to that track's chosen waveform — not a single
    shared `trackwave` for every channel, which is what this project did before; matches the real
    hand-written `mario_theme.txt` example's pattern of separate named wave vars per track — see
    `zcpu-notes/docs/EXAMPLES.md`), a generated `main()` loop that reads one index into every track
    array per tick and calls `chpitch` per channel, a `tempo()` busy-wait helper, a `strlen()`
    helper (ZSPU has no native one), and finally the `db` data blocks from `CreateDBLines`.
- **`processing.ts`** — the editable song model:
  - `Song` — `{tracks: number[][], tempo: number, waveforms: WaveformId[], volumes: number[]}`.
    `tracks` is mutated **in place** by the piano roll editor; nothing else here is currently
    editable (tempo, in particular, is fixed at load time — the MIDI file's first tempo event).
  - `loadMidi(buffer): Song` — parses + calls `getnotes()`, defaults every track to `"sine"` at
    volume `0.5`.
  - `generateScript(song): string` — runs `CreateDBLines`/`CreateFileString` fresh from *current*
    `song` state. Called on demand at each Play/Download/Copy click, not cached — this is what
    makes piano-roll edits actually show up in playback and exported output.
- **`player.ts`** — `ZspuPlayer`, a Web Audio playback engine for the "Play preview" button.
  Deliberately mimics the real ZSPU rather than doing generic MIDI/soundfont playback (see
  `zcpu-notes/docs/HLZASM.md`'s "SPU audio model" section for why): one `OscillatorNode` per
  track/channel, its `type` set from that track's `WaveformId` (square→`"square"`, saw→
  `"sawtooth"`, tri→`"triangle"`, sine→`"sine"` — Web Audio's 4 built-in types map 1:1), frequency
  = `880 * clamp(2^(note/12), 0, 255) / 100` — reproducing the generator's actual `CHPITCH` math
  exactly (GMod's `Sound:ChangePitch` treats its argument as a percentage of normal speed, 100 =
  unshifted; the generator's own `/100` before calling `CHPITCH` and `CHPITCH`'s internal `*100`
  cancel out, leaving `clamp(2^(note/12), 0, 255)` as that percentage — an earlier version of this
  file and of `zcpu-notes/docs/HLZASM.md` had this wrong, dropped the `/100` entirely, so every
  note played ~100x too fast/high). **Unverified assumption**: `BASE_FREQUENCY = 880` for all 4
  waveforms — chosen because this project's old single shared waveform was literally named
  `sine_880.wav`; the real built-in `synth/square.wav` etc. have unknown native pitch, not
  verifiable without the actual GMod asset files. Worth a real in-game check. Hard on/off steps (no
  ADSR, matching the generator never calling `CHADSR`), per-track note-on gain scaled by that
  track's volume (`CHVOLUME` is a direct 0-1 clamp, no `*100` unlike pitch) plus a separate master
  `GainNode` for the "Volume" slider (`setVolume(0-1)`, live-adjustable during playback). Plays the
  *converted/quantized* note arrays (`getnotes()`'s output, possibly edited by the piano roll), not
  the raw MIDI. All pitch/gain automation is scheduled up front via `AudioParam.setValueAtTime` at
  construction time, not driven by JS timers. One-shot (not looping like the real ZSPU's `main()`
  does) — a new `ZspuPlayer` is constructed fresh on every Play click from current `song` state, so
  edits since the last play are picked up.
- **`pianoRoll.ts`** — `PianoRoll`, the note editor. Takes a `Song` and a container element;
  renders (and owns all interaction for) a track sidebar (waveform `<select>` + volume
  `<input type=range>` per track, click to select which track's grid is shown — mutates
  `song.waveforms[i]`/`song.volumes[i]` directly) and a scrollable step/pitch grid for the active
  track. Grid columns are `STEPS_PER_BEAT`-quantized steps (same resolution `getnotes()` already
  produces); rows are the active track's used pitch range ± padding, not the full 0-127 (keeps the
  DOM small — typical songs span 20-40 semitones). Note blocks are rendered by scanning the active
  track's `number[]` for runs of consecutive identical values and drawing one absolutely-positioned
  labeled `<div>` per run. Click an empty cell to paint the clicked row's pitch there, click an
  already-set cell to erase it to `-1`; drag continues that same paint/erase mode across the same
  pitch row only (no diagonal painting — doesn't make sense for one monophonic value per step).
  `PianoRoll.onChange` fires after any edit (`app.ts` wires it to stop any active playback, since a
  playing `ZspuPlayer` was scheduled from a snapshot and won't reflect the edit until replayed).
  **Known layout constraint, don't remove:** the timeline ruler above the grid is deliberately
  *not* width-bound to the grid's full content width (which can be tens of thousands of px for a
  long track) — an earlier version set `ruler.style.width = gridWidth + "px"` and, because nothing
  wrapped it in a bounded+`overflow:hidden` container, that oversized block overflowed every
  ancestor up to `<body>`, growing the whole page to match instead of just scrolling internally
  (reproducible: load `Bolero-Ravel.mid`, ~26 tracks, thousands of steps — the page becomes tens of
  thousands of px wide and screenshots/layout time out). The ruler doesn't scroll in sync with the
  grid below it as a result — acceptable trade for this pass, don't "fix" by giving it an explicit
  large width again without also properly clipping/scrolling it.
- **`download.ts`** — `downloadTextFile(content, filename, mimeType)`, a small native
  Blob + `URL.createObjectURL` + `<a download>` helper.
- **`app.ts`** — the only remaining DOM-wiring code, and the sole `xp.css` import site. Holds one
  `Song | null` and one `ZspuPlayer | null`. Both the `#file` `<input>`'s `change` event and
  drag-and-drop onto `#dropzone` (dragover/dragleave toggle a `.dragover` CSS class; drop reads
  `evt.dataTransfer.files[0]`) funnel into a shared `loadFile(file: File)` that calls `loadMidi`,
  reveals the Play window's `#controls` and the Piano Roll window, and constructs a `PianoRoll`.
  Play/Stop/Volume/Download/Copy wire to `ZspuPlayer`/`generateScript`/`downloadTextFile` as
  described above — Play and Download/Copy both read *current* `song` state at click time, so
  piano-roll edits need no extra plumbing to take effect. A `window`-level `dragover`/`drop`
  listener pair calls `preventDefault()` so a drop outside `#dropzone` doesn't navigate the page
  away to the dropped file.

When changing the generated ZSPU script format, `constructBodyOfFile` and `constructLoopBlocks` in
`utilityfunctions.ts` are the two functions that hand-emit the ZSPU source text — the ZSPU
language itself (`fpwr`, `chpitch`, `wset`, `chwave`, `chvolume`, `chstart`, `timer`, etc.) is not
implemented here, only text-generated as a target format for the Lua entity linked above. The full
language/instruction-set reference (it's called HLZASM, not "ZSPU bytecode") lives in a separate
sibling repo, **`E:\projects\zcpu-notes\docs\HLZASM.md`** (plus `docs/EXAMPLES.md`, a catalog of
real example/library programs including `mario_theme.txt`, referenced above) — pulled out of this
repo since the language is general-purpose across Wiremod's whole PU chip family, not specific to
MIDI conversion, and is being kept as its own growing reference (that repo also has a `wire` git
submodule with the actual Wiremod source it was sourced from).

Not yet in scope: tempo editing (fixed at load from the MIDI file's first tempo event), adding or
removing tracks in the editor (tracks come from the imported MIDI file only), and a dedicated
horizontal zoom control for the piano roll grid (native browser scroll only).
