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
  Robustness fixes (2026-08-26, driven by real files that used to crash the whole parse):
  - **Unknown chunks are skipped, not fatal.** The constructor used to require the chunk right
    after the header to be `MTrk`, throwing otherwise. Spec explicitly allows non-`MTrk` chunks
    anywhere a chunk is expected ("expect alien chunks and treat them as if they weren't there") -
    now it keeps reading chunks until `trackCount` real `MTrk` chunks are collected, silently
    skipping anything else (each chunk's own length field means skipping never desyncs the
    stream).
  - **System-common messages (0xF1-0xF6) no longer crash the parser.** These are rare in a
    standard MIDI file (mostly a live-performance/sync concept - MTC quarter frame, song position
    pointer, song select, tune request) but legal; `readEvent` now reads and discards the right
    number of data bytes per type instead of throwing "Unrecognised MIDI event type byte".
  - **Running status resets after any 0xF0+ event** (meta, sysex, divided sysex, or one of the new
    system-common types) - spec requires this since none of those are valid running-status
    targets. If a channel event afterward still tries running status with nothing to reuse, it now
    throws a clear "running status used without a preceding status byte" error instead of silently
    computing `NaN`-derived fields from an `undefined` reused status byte.
  - **SMPTE time division is parsed, not rejected** (2026-08-26). `MidiHeader.division` is now a
    discriminated union (`{type:"ppqn", ticksPerBeat}` or `{type:"smpte", framesPerSecond,
    ticksPerFrame}`, from `midiTiming.ts`) instead of a bare `ticksPerBeat: number` — the
    constructor used to `throw` outright whenever the time-division field's top bit was set. SMPTE
    files have no beat/tempo concept (a fixed real-time clock instead — frame rate stored as a
    negative two's-complement byte, -24/-25/-29/-30, plus ticks/frame), so this is a genuinely
    different timing model, not just a parsing detail — see `midiExtract.ts` for how `getnotes()`/
    `getTempo()` branch on it. Verified against a hand-built synthetic SMPTE file (no real one
    exists anywhere in the user's ~2,788-file collection, confirmed via a full survey) since real
    fixtures aren't available for this case.
  - **Meta events tolerate a declared length that doesn't match the field count.** `sequenceNumber`
    /`midiChannelPrefix`/`setTempo`/`smpteOffset`/`timeSignature`/`keySignature` used to `throw` on
    any length mismatch. Found via two real files (`Moveslikejagger.mid` and a variant) whose
    `timeSignature` event declares length 2 (numerator+denominator only, omitting the
    metronome/32nds bytes) - a non-standard but real-world encoder quirk. Now each case reads
    whichever of its fields the declared length actually covers, defaults the rest (spec's own
    "usual" values where one exists, e.g. 24 clocks/click), and always leaves the stream at
    exactly `start + declaredLength` afterward (`ByteStream.position` is directly writable)
    regardless of how many fields were actually read - correctness of *stream position* for every
    later event matters far more than getting a rarely-used meta event's exact field values right
    for a malformed file.
- **`midiTiming.ts`** — `MidiDivision` (the discriminated union above) and
  `ticksToStepsFloat(division, stepsPerBeat, deltaTicks)`, the one function that converts an
  elapsed tick count to elapsed output steps for *either* timing model. Shared by `midiExtract.ts`'s
  `getnotes()` and (once Phase D lands) the tempo-curve builder, so both use the identical timing
  math regardless of which kind of file this is — the only such call site before this existed
  inline inside `getnotes()`. Also exports `SMPTE_STEPS_PER_SECOND` (20 — chosen to match PPQN's
  resolution at a common 120bpm: `STEPS_PER_BEAT(10) * 120bpm / 60s`, not a spec value).
- **`midiConstants.ts`** — small shared leaf constants with no logic: `PERCUSSION_CHANNEL` (GM
  channel 10, 1-indexed, so index 9 here), and `WaveformId`/`WAVEFORM_PATHS` (square/saw/tri/sine/
  noise mapped to their `synth/*.wav` resource paths, confirmed against the real in-game sound
  browser — not just inferred from source; `cl_spuvm.lua`'s `VM:Reset()` only auto-loads
  square/saw/tri/sine into the 4 default slots, but this project's generator always `WSET`s its
  own explicit resource per channel anyway, so it isn't limited to those 4). Per the user, uses the
  plain unprefixed files (`synth/sine.wav` etc.) rather than the also-real `_440`/`_880`/`_1760`
  precisely-pitched variants, for simplicity — their actual native pitch is unverified (see
  `BASE_FREQUENCY`'s comment in `player.ts`). `noise` → `synth/pink_noise.wav`, the default for
  percussion tracks (see `isPercussion` in `processing.ts`) since a noise sample is far more
  percussion-appropriate than a tuned tone. Imported by `scriptGen.ts`, `player.ts` (oscillator-
  type mapping), and `pianoRoll.ts` (waveform dropdown).
- **`rle.ts`** — pure data compression, no MIDI/HLZASM knowledge. `encodeRuns(track)` picks
  between two encodings of one track's per-step values, whichever produces smaller *exported text*:
  - **Plain run-length** (`encodePlainRuns`): flat `[note,count, note,count, ...]` pairs. Real
    measured win: most held notes span many consecutive steps at `STEPS_PER_BEAT` quantization, so
    this compresses 7-9x on real songs (`Bad Apple.mid`: 64,376 raw cells → 7,018; `Bolero-
    Ravel.mid`: 265,330 → 35,222) — the SPU's default memory model is 128K cells, so a large
    multi-track song can genuinely fail to fit (plausibly manifesting as the chip not starting at
    all) without this.
  - **Periodic-pattern** (`encodePeriodicRuns`): plain RLE does nothing for a short repeating
    sequence (e.g. a 4-step arpeggio `2, -1, 3, 33, 2, -1, 3, 33, ...`) - no single value repeats,
    so every step becomes its own `[note,1]` pair, roughly *doubling* size instead of shrinking it.
    This greedily also tries periods 2..`MAX_PATTERN_PERIOD` (32) at each position and, if a period
    repeats at least twice, can instead emit a single `[PATTERN_MARK(-2), periodLength,
    ...periodValues, repeatCount]` block. Found via a real file (`Intensive Care Unit
    TheVocoderGuy.mid`) with exactly this kind of oscillating sequence in its data.
  - The catch: using *any* pattern block on a track costs that track a fixed amount of extra
    decode-loop code (`PATTERN_CODE_OVERHEAD_CHARS`, measured ~463 chars — see `scriptGen.ts`).
    A track with only a small periodic win doesn't earn that back — confirmed empirically: an
    earlier version that chose periodic encoding whenever it had *fewer tokens* (ignoring this
    fixed cost) made some real files' *total generated output bigger* despite the RLE token count
    going down. `encodeRuns` now estimates real exported-text size for both encodings
    (`estimateDbTextLength`, mirrors `scriptGen.ts`'s actual `db` chunking) including that fixed
    cost, and only picks periodic if it's genuinely smaller *for that track*. With this fix,
    periodic encoding measured strictly better-or-equal to plain RLE on every real test file
    (never a regression), 1.7-3.1% smaller total output on files with real repeating sequences and
    identical to plain RLE otherwise.
- **`midiExtract.ts`** — turns a parsed `Midifile` into the per-step arrays the rest of the app
  uses:
  - `getTempoTrack(midi, totalSteps)` (2026-08-26, replaced the old scalar `getTempo`) — one
    scaled-BPM value **per output step**, not a single constant for the whole song. A MIDI file
    can change tempo mid-song (ritardando, a tempo-mapped game rip, etc.); the old design used
    only the *first* `setTempo` event and played the entire song at that one fixed rate. Scans
    every track chunk (not just track 0 — spec allows `setTempo` anywhere, though convention puts
    it there) for `setTempo` events, merges them by absolute tick, and walks them with the exact
    same "hold the current value across elapsed steps" quantization `getnotes()` uses for notes
    (via `midiTiming.ts`'s shared `ticksToStepsFloat`) — just applied to BPM values instead of
    note numbers. Always returns exactly `totalSteps` entries (the caller passes the longest note
    track's length) — anything past the last real tempo change holds that value, so the tempo
    curve lines up 1:1 with every note track's own step indices without a separate padding step.
    Verified against a real file with 421 tempo events (`bohemian1.mid` — a piece famous for
    dramatic tempo shifts; the extracted curve has 73 distinct BPM values ranging 30-208 real
    BPM). For an SMPTE-divided file (`midi.header.division.type === "smpte"`), skips all of that —
    SMPTE files have no beat/tempo concept at all, so any `setTempo` events present are ignored,
    and every step gets the same fixed effective tempo derived from `midiTiming.ts`'s
    `SMPTE_STEPS_PER_SECOND` instead (`60 * SMPTE_STEPS_PER_SECOND`, chosen so the generated
    script's `tempo()` busy-wait exactly matches one SMPTE-quantized step's real duration).
  - `getnotes` groups every `noteOn`/`noteOff` event (plus sustain-pedal and all-notes-off
    controller events, see below) by the pair **(raw track chunk index, MIDI channel)** — not by
    track index alone, and not by channel alone. Both simpler groupings are real bugs on real
    files: a MIDI *track chunk* and a MIDI *channel* aren't the same thing. A track-index-only
    grouping (the original design) breaks on format-0 files, which put an entire multi-instrument
    song in one single track chunk multiplexing up to 16 channels — every instrument's
    noteOn/noteOff clobbered one shared `currentNote`, so the whole song loaded as one garbled
    channel (found via `The-Rhythm-Of-The-Night-3.mid`, format 0, 13 channels in one chunk). A
    channel-only grouping (a first attempt at the fix) breaks the *other* way on format-1 files
    that legitimately reuse a channel across several distinct instrument tracks — real orchestral
    scores can have more instrument parts than MIDI's 16-channel limit, e.g. `Bolero-Ravel.mid`
    declares 3 separate `*Flutes` tracks all on channel 0 — grouping by channel alone would merge
    those back into one clobbered line, the same bug from the opposite direction. Grouping by the
    (track,channel) pair handles both: a format-0 file still splits by channel (only one track
    index exists), while a file with real per-track channel reuse keeps each track chunk's own
    instrument separate. For the common case (one channel per track), this reproduces the original
    per-track grouping exactly. Per matching group, walks its events in file order and, using each
    event's tick position converted to output steps via `ticksPerBeat`/`STEPS_PER_BEAT`, produces
    one array entry per output step — holding the currently-sounding note (or `-1` for silence)
    across however many steps elapsed before the next event. `STEPS_PER_BEAT` must stay in sync
    between this function and `getTempo` — it's the shared time resolution both assume, and also
    what the piano roll editor's grid columns are quantized to.
  - **Held-note stack, not a single `currentNote`** (2026-08-26). A group tracks `heldNotes: []`
    (most-recently-pressed last - "last note held wins", matching this project's one-pitch-per-
    channel export model) instead of one bare `currentNote` that any `noteOff` used to clear
    unconditionally. That old behavior was a real, common-case bug: real MIDI files very often
    encode legato/overlapping notes as `noteOn(next)` arriving at (or just before) the *same tick*
    as `noteOff(previous)` - the old code would process the noteOn (correctly starting the new
    note) and then immediately process the noteOff for the *different*, no-longer-current note,
    which unconditionally reset `currentNote` to `-1` anyway, inserting a spurious silent gap
    after nearly every note. Found via `Rainbow Tylenol.mid`'s own melody track, which went from
    238/2410 non-rest steps (10%) to 2410/2410 (100%, fully continuous) once fixed - the "gap after
    every note" pattern was destroying legato throughout, not just in some rare edge case. Now a
    `noteOff` only changes what's audible if it releases the note actually on top of the stack;
    releasing an older still-technically-held note (overlap/chord) just removes it from the stack.
    Stress-tested against a real file with overlap depth 2086 on one channel (a different "Bad
    Apple" rip than the one already in the regression set, `Bad Apple!!.mid`).
  - **All Notes Off / All Sound Off** (GM controller 123/120) clears the whole held-note stack and
    silences the group — not one of the four spec-compliance buckets originally scoped, but a
    natural, tightly-coupled addition to the same held-note-stack rewrite (same event loop, same
    state), called out explicitly here rather than folded in silently.
  - **Sustain pedal** (controller 64, ≥64 = down): a `noteOff` that arrives while the pedal is down
    doesn't touch `heldNotes` at all (stays audible) - it's added to a separate `sustainedNotes`
    set instead, and only actually removed from `heldNotes` (with `currentNote` recomputed from
    the new stack top) once the pedal lifts. A real `noteOn` always takes effect immediately
    regardless of pedal state (interrupts sustain) and clears any pending sustain-release for that
    note number. Real test coverage: `A-Team.mid` has 12 real sustain events.
  - **A group is only exported if it actually sounds a note** (`track.some(v => v !== -1)`, not
    just `track.length > 0`) - broadening the event filter to also capture sustain/all-notes-off
    controller events means a channel using *only* those (no real noteOn ever) now forms its own
    group too, which would otherwise produce an all-silent phantom track (caught during this same
    change's own testing - the same class of wasted-channel issue the track/channel-grouping fix
    eliminated for metadata-only track chunks, from a different cause).
  - Percussion-channel (index 9, i.e. GM channel 10) events flow through the exact same held-note-
    stack logic as any other group (reusing the raw GM drum note number as the "pitch") - this used
    to `continue` past percussion noteOn/noteOff entirely, silently exporting/playing pure-
    percussion tracks as one long rest, until a real file (`Rainbow Tylenol.mid`) whose drums were
    the only thing sounding during long melodic rests made the resulting silence obvious. A group
    is percussion iff its channel is 9 — exact by construction, not an incidentally-set flag.
- **`scriptGen.ts`** — HLZASM text generation only, no MIDI-domain knowledge beyond the
  `WaveformId`/`usesPattern` shapes it's handed:
  - `CreateDBLines(namedTracks: {name, values}[])` (generalized 2026-08-26 from a positional
    `number[][]` to named tracks — see why below) pads/truncates every track to the same total
    duration (with `-1`, so the whole ensemble loops together in sync rather than each track
    wrapping back to its own start at a different real time), then encodes each one via `rle.ts`'s
    `encodeRuns` before chunking into ZSPU `db ...;` data-statement lines (32 values/line,
    labeled `${name}:`). Returns `{dblines, usesPattern}` - `usesPattern[i]` says whether track
    `i`'s encoding contains a periodic-pattern block, which `CreateFileString`/`constructLoopBlocks`
    need to know which decode code to emit for that track. Doesn't mutate the arrays passed in.
  - **Why named tracks, not positional**: the caller (`processing.ts`'s `generateScript`) always
    appends one extra pseudo-track named `temposeq` after every real note track (`track0`,
    `track1`, ...) — the song's tempo curve (see `midiExtract.ts`'s `getTempoTrack`), encoded and
    decoded through the *exact same* RLE/pattern-block machinery as a note track, just driving
    `tempo(curtempo)` instead of `chpitch` once decoded (see `emitDecodeBlock` below). Positional
    `trackN` naming had no natural slot for a track that isn't really "track N" of anything.
    `usesPattern`'s last entry (index `numberOfTracks`) is always the tempo pseudo-track's.
  - `emitDecodeBlock(valueVar, suffix, arrName, usesPattern)` — the actual per-tick decode state
    machine, factored out so the *identical* logic drives both a note track and the tempo
    pseudo-track instead of two near-duplicate copies. `valueVar` is the variable the decoded
    value ends up in (`note0`, or `curtempo` for tempo); `suffix` names every other piece of state
    for this track (`idx${suffix}`, `remain${suffix}`, `tracklen${suffix}`, and - only when
    `usesPattern` - `patternlen/patternstart/patternpos${suffix}`). While the current run/pattern
    still has ticks remaining, just cycles through its held value(s); once it runs out, reads the
    next block header (wrapping to the start of its own array at its own `tracklen${suffix}`) and
    starts counting that one down - each track/the tempo curve needs its own independent decode
    state like this since RLE blocks mean they're independently partway through different-length
    blocks at any given tick (an earlier version had one shared index across every note track; see
    git history for the "solid tone" bug that caused). A block header is either a plain run
    `[value,count]` or, if the first value is `PATTERN_MARK`, a repeating-sequence block
    `[PATTERN_MARK, periodLength, ...periodValues, repeatCount]` (see `rle.ts`'s
    `encodePeriodicRuns`) - both decoded through the same `patternstart`/`patternlen`/`patternpos`
    state either way, so the decoded value is always just `arr[patternstart+patternpos]`. Only
    emitted (and only declares its pattern-branch variables, in `constructBodyOfFile`) for a
    track/the tempo curve when `usesPattern` is true for it - fixed code-size cost, not worth
    paying when `encodeRuns` didn't find a periodic win.
  - `constructLoopBlocks` calls `emitDecodeBlock` once for the tempo pseudo-track (`curtempo`/
    `tempo`/`"temposeq"`) **first**, immediately followed by `tempo(curtempo);` - the same
    relative position a literal `tempo(1280)`-style constant call used to occupy at the very top
    of `main()`'s body, just data-driven now so playback speed actually follows a mid-song tempo
    change instead of using whatever the first tempo happened to be for the whole song (see
    `getTempoTrack`). Then calls it once per note track (`note0`/`"0"`/`"track0"`, etc.), each
    followed by the existing `fpwr`/`chpitch` pitch application, unchanged.
  - `CreateFileString(dblinesin, usesPattern, waveforms, volumes)` assembles the full ZSPU script:
    per-channel `wset`/`chwave`/`chvolume`/`chstart` setup blocks (one **named wave string var per
    track**, e.g. `wave0`/`wave1`/..., each bound to that track's chosen waveform — not a single
    shared `trackwave` for every channel, which is what this project did before; matches the real
    hand-written `mario_theme.txt` example's pattern of separate named wave vars per track — see
    `zcpu-notes/docs/EXAMPLES.md`), then `main()` (via `constructLoopBlocks` above). Also declares
    `curtempo`/`idxtempo`/`remaintempo`/`tracklentempo` (plus the pattern-branch vars if
    `usesPattern[numberOfTracks]`) alongside each note track's own decode variables, and
    `tracklentempo = strlen(temposeq);` alongside each `tracklenN = strlen(trackN);`. Also emits a
    `tempo()` busy-wait helper and a `strlen()` helper (ZSPU has no native one). No longer takes a
    `tempo: number` parameter at all — there's no single constant left to pass, the tempo curve is
    entirely data-driven now.
- **`processing.ts`** — the editable song model:
  - `Song` — `{tracks: number[][], tempoTrack: number[], waveforms: WaveformId[], volumes:
    number[], muted: boolean[], solo: boolean[], isPercussion: boolean[], warnings: string[]}`.
    `tempoTrack` (renamed from a scalar `tempo` on 2026-08-26 — see `midiExtract.ts`'s
    `getTempoTrack`) is one scaled-BPM value per step, song-global rather than per-track, so
    `getAudibleSong` below copies it through unfiltered by the audible-track index list. `tracks`
    is mutated **in place** by the piano roll editor; nothing else in `Song` is currently editable.
    `isPercussion[i]` is true if any event in that track was on the GM percussion channel
    (computed by `getnotes()` in the same pass that builds `tracks`, so indices can't drift out of
    sync with `getnotes()`'s own empty-track filtering).
  - `loadMidi(buffer): Song` — parses + calls `getnotes()`, defaults every track to volume `0.5`,
    unmuted, not soloed, and waveform `"sine"` — except percussion tracks (`isPercussion[i]`),
    which default to `"noise"` instead (a real user-editable default; percussion note data is real
    now too, since `getnotes()` no longer skips percussion-channel noteOn/noteOff events). Also
    populates `Song.warnings: string[]` — currently only ever set for `midi.header.formatType ===
    2` (sequential-pattern files). Format 2's tracks are independent patterns meant to be
    *triggered on demand* (drum-machine-style pattern banks), not concatenated into one song - this
    project's whole export model (every track loops forever, simultaneously, from step 0) has no
    single obviously-correct mapping onto "play pattern 1, then pattern 2", and real format-2 files
    are effectively nonexistent for this project's use case (confirmed zero in a full survey of the
    user's ~2,788-file collection). So this deliberately does *not* attempt real sequential
    playback (tracks still get treated as simultaneous, same as any other file) - it just surfaces
    a warning instead of silently producing a likely-wrong result. `app.ts` shows `warnings` in a
    `#warning` banner above the controls (hidden when empty) on every file load.
  - `isTrackAudible(song, index)` — a track counts as audible (plays/exports) if it isn't muted,
    and — if *any* track has `solo` set — it's one of the soloed ones. Explicit mute always beats
    solo (standard DAW convention: muting a soloed track still silences it).
  - `getAudibleSong(song): Song` — a reindexed copy containing only audible tracks (and their
    matching waveforms/volumes) — muted/soloed-out tracks are never played or exported. Both
    `generateScript` (below) and `app.ts`'s Play handler call this before using `song.tracks`, so
    what you hear always matches what gets exported.
  - `generateScript(song): string` — runs `getAudibleSong`, then truncates/hold-pads
    `audible.tempoTrack` to exactly match the audible tracks' own max length (`tempoTrack` is
    computed once from the *original* song's longest track in `loadMidi`, so muting/soloing down
    to a shorter set of audible tracks can leave it longer than `CreateDBLines`' own per-track `-1`
    padding would be correct for — `-1` is meaningless as a tempo), builds the named-track list
    (`track0`, `track1`, ..., then `temposeq` last — see `scriptGen.ts`), and runs
    `CreateDBLines`/`CreateFileString` fresh from *current* `song` state. Called on demand at each
    Play/Download/Copy click, not cached — this is what makes piano-roll edits (including
    mute/solo) actually show up in playback and exported output. Returns a short comment instead
    of a broken script if zero tracks end up audible.
- **`player.ts`** — `ZspuPlayer`, a Web Audio playback engine for the "Play preview" button.
  Deliberately mimics the real ZSPU rather than doing generic MIDI/soundfont playback (see
  `zcpu-notes/docs/HLZASM.md`'s "SPU audio model" section for why): one `OscillatorNode` per
  track/channel, its `type` set from that track's `WaveformId` (square→`"square"`, saw→
  `"sawtooth"`, tri→`"triangle"`, sine→`"sine"` — Web Audio's 4 built-in types map 1:1) — **except
  `"noise"`** (the percussion default), which uses an `AudioBufferSourceNode` looping a generated
  white-noise buffer instead (Web Audio has no built-in noise oscillator type; this is an
  approximation of the real `synth/pink_noise.wav`, not an exact match, fine for preview purposes).
  Frequency/pitch math is shared either way, just applied to a different `AudioParam`:
  `OscillatorNode.frequency` is absolute Hz (needs `BASE_FREQUENCY`);
  `AudioBufferSourceNode.playbackRate` is already a direct multiplier (1 = normal speed), so noise
  tracks skip the `BASE_FREQUENCY` multiplication entirely. The pitch percentage itself —
  `clamp(2^(note/12), 0, 255) / 100` — reproduces the generator's actual `CHPITCH` math
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
  does) — a new `ZspuPlayer` is constructed fresh on every Play click from `getAudibleSong(song)`
  (see `processing.ts`), so edits and mute/solo changes since the last play are picked up.
  `getCurrentStep()` returns the current playback position in grid steps (or `null` when not
  playing) — polled by `app.ts` via `requestAnimationFrame` to drive the piano roll's
  playhead/follow-scroll.
  - **Variable-tempo real-time scheduling** (2026-08-26). The constructor now takes a
    `tempoTrack: number[]` (one scaled-BPM value per step, see `midiExtract.ts`'s
    `getTempoTrack`) instead of a single `tempo: number`, and precomputes
    `cumulativeStepTime: number[]` once — a prefix sum where `cumulativeStepTime[i]` is the
    wall-clock seconds from step 0 to the *start* of step `i` (each step's own real duration is
    `60/scaledBpm` seconds), with one trailing entry past the last real step giving the total
    duration. `scheduleTrack` below schedules note `i`'s automation at
    `startTime + cumulativeStepTime[i]` instead of `startTime + i*secondsPerStep` — a mid-song
    tempo change now actually changes playback speed instead of the whole song playing at
    whatever the first tempo was. `getCurrentStep()` correspondingly does a binary search
    (`stepAtElapsedTime`) over `cumulativeStepTime` for the current elapsed real time instead of a
    single division, since elapsed time no longer maps linearly to step index. Verified live
    against a real 421-tempo-event file (`bohemian1.mid`) — playhead follows correctly through
    real tempo shifts, `renderToWav()` (below) produces a correctly-timed ~6-minute file.
  - The actual per-track source/gain graph + note-automation scheduling lives in a private
    `scheduleTrack(audioContext, destination, trackIndex, startTime)`, shared between live
    `play()` and `renderToWav()` below — both `AudioContext` and `OfflineAudioContext` implement
    `BaseAudioContext`, so identical scheduling code produces identical audio either way; only the
    context type and destination differ.
  - `renderToWav(): Promise<Blob>` — the "Export .wav" button. Builds an `OfflineAudioContext`
    (mono, 44.1kHz) sized to the song's full duration, schedules every track into it exactly like
    `play()`, then `startRendering()`s (computes the audio as fast as possible, not in real time)
    and hands the resulting `AudioBuffer` to `wav.ts`'s `audioBufferToWavBlob` (Web Audio has no
    built-in encoder, so this hand-rolls a standard 16-bit PCM `.wav` — RIFF/WAVE headers, one
    `data` chunk of interleaved `Int16` samples clamped from the buffer's `Float32` ones).
    Deliberately does *not* apply the live preview volume slider (`this.volume`) — only the
    per-track loudness normalization (`trackScaling`) — since the slider is a preview-only
    convenience, not a song setting; the export is meant to reproduce "the song as configured"
    (mute/solo/waveform/volume per track, via `getAudibleSong` same as the `.txt` export),
    independent of whatever the slider happened to be at during a prior preview. Verified against
    the full test-file set (see `TASKS.md`) via a captured-`Blob` check in a live browser (parsed
    the WAV header back out, confirmed non-silent PCM data) rather than assuming
    `OfflineAudioContext` support — a ~26-track/14-minute file (`Bolero-Ravel.mid`) rendered to a
    valid ~75MB `.wav` with no errors, confirming this scales fine to the existing test files.
- **`pianoRoll.ts`** — `PianoRoll`, the note editor. Takes a `Song` and a container element;
  renders (and owns all interaction for) a track sidebar and a scrollable step/pitch grid that
  shows **every audible track simultaneously** (not just the selected one — each gets a distinct
  color, one evenly-spaced HSL hue per track index up to `TRACK_COLOR_COUNT` = 32, matching
  `WireSPU_MaxChannels` so no two tracks in a fully-mappable file share a color), plus the
  currently-selected ("active") track always shown too even if it's muted, so you can still
  see/edit what you're deciding whether to keep. A percussion track (`song.isPercussion[i]`) gets
  a fixed neutral gray (`PERCUSSION_COLOR`) instead of a hue, and `" (drums)"` appended to its
  sidebar label. The active track's blocks render at full opacity with a note-name label and on
  top (`.active-track-block` in `app.css`); every other visible track renders dimmed
  (`opacity: 0.4`) as background context, unlabeled. **Editing always targets only the active
  track** regardless of how many others are visually overlaid — no ambiguity about which track a
  click applies to.
  - Track sidebar row: click to make that track active/edited. **Mute** (`M`) and **Solo** (`S`)
    checkboxes wire to `song.muted[i]`/`song.solo[i]` (see `processing.ts`'s `isTrackAudible` for
    the interaction between them) — toggling either calls `onChange` *and* a full `render()`,
    since mute/solo changes who's visible in the overlay, not just export/playback. Rendered as
    colored toggle badges, not plain checkboxes (`.toggle-badge` in `app.css`) — a real native
    `<input type=checkbox>` still backs each one (visually hidden, `opacity:0`, inside the
    `<label>`) for click/keyboard/AT semantics, but the visible state is a `<span>` sibling styled
    via `input:checked + span` (red background when muted, yellow when soloed) — plain XP.css
    checkboxes were too small/subtle to tell active from inactive at a glance. A small color
    swatch shows that track's overlay color. Waveform `<select>` and volume `<input type=range>`
    as before, mutating `song.waveforms[i]`/`song.volumes[i]` directly.
  - Grid columns are `STEPS_PER_BEAT`-quantized steps (same resolution `getnotes()` already
    produces); rows span the *union* of every currently-visible track's used pitch range ± padding
    (not the full 0-127 — keeps the DOM reasonably small, though showing many tracks at once
    widens this range compared to a single-track view). Note blocks are rendered by scanning each
    visible track's `number[]` for runs of consecutive identical values and drawing one
    absolutely-positioned `<div>` per run, colored per-track.
  - Click an empty cell (on the active track) to paint the clicked row's pitch there, click an
    already-set cell to erase it to `-1`; drag continues that same paint/erase mode across the same
    pitch row only (no diagonal painting — doesn't make sense for one monophonic value per step).
  - **Playhead**: a red vertical line (`.playhead`), positioned via `setPlayheadStep(step | null)`
    — `app.ts` drives this from a `requestAnimationFrame` loop polling `ZspuPlayer.getCurrentStep()`
    while playing. Auto-scrolls `.piano-scroll-area` horizontally to keep the playhead in view
    (with a 20%-of-viewport margin before it triggers a re-scroll, not scrolled every frame).
  - **Resizable**: `.piano-scroll-area` uses native CSS `resize: both` (drag the bottom-right
    corner) so a big file like `Bolero-Ravel.mid` isn't stuck in a fixed small viewport — couldn't
    get automated drag testing to trigger the native resize handle (a known friction point with
    synthetic mouse events and browser-native resize handles), verify by hand if touching this.
  - `PianoRoll.onChange` fires after any edit or mute/solo/waveform/volume change (`app.ts` wires
    it to stop any active playback, since a playing `ZspuPlayer` was scheduled from a snapshot and
    won't reflect the change until replayed).
  - **Known layout constraint, don't remove:** the timeline ruler above the grid is deliberately
    *not* width-bound to the grid's full content width (which can be tens of thousands of px for a
    long track) — an earlier version set `ruler.style.width = gridWidth + "px"` and, because
    nothing wrapped it in a bounded+`overflow:hidden` container, that oversized block overflowed
    every ancestor up to `<body>`, growing the whole page to match instead of just scrolling
    internally (reproducible: load `Bolero-Ravel.mid`, ~26 tracks, thousands of steps — the page
    becomes tens of thousands of px wide and screenshots/layout time out). The ruler doesn't
    scroll in sync with the grid below it as a result — acceptable trade for this pass, don't "fix"
    by giving it an explicit large width again without also properly clipping/scrolling it. The
    same defensive pattern (`overflow-x: auto` + `max-width: 100%`) is now also applied to
    `.piano-roll` itself, as a safety net in case the resize handle above is ever dragged very wide.
- **`wav.ts`** — `audioBufferToWavBlob(buffer: AudioBuffer): Blob`, the standalone PCM16 `.wav`
  encoder used by `player.ts`'s `renderToWav()`. Pure function, no DOM/Web-Audio-context
  dependency beyond reading an already-rendered `AudioBuffer`'s channel data.
- **`download.ts`** — `downloadBlob(blob, filename)`, a small native `URL.createObjectURL` +
  `<a download>` helper; `downloadTextFile(content, filename, mimeType)` wraps it for the
  text-content case (`.txt` export).
- **`app.ts`** — the only remaining DOM-wiring code, and the sole `xp.css` import site. Holds one
  `Song | null`, one `ZspuPlayer | null`, one `PianoRoll | null`, and a `requestAnimationFrame`
  handle for the playhead-follow loop. Both the `#file` `<input>`'s `change` event and
  drag-and-drop onto `#dropzone` (dragover/dragleave toggle a `.dragover` CSS class; drop reads
  `evt.dataTransfer.files[0]`) funnel into a shared `loadFile(file: File)` that calls `loadMidi`,
  shows/hides the `#warning` banner based on `song.warnings` (see `processing.ts`'s `loadMidi`),
  reveals the Play window's `#controls` and the Piano Roll window, and constructs a `PianoRoll`.
  Play constructs a fresh `ZspuPlayer` from `getAudibleSong(song)` (muted/soloed-out tracks never
  reach playback) and starts a `followPlayhead()` `requestAnimationFrame` loop polling
  `player.getCurrentStep()` into `pianoRoll.setPlayheadStep(...)`, cancelled by
  `stopFollowingPlayhead()` on Stop, on natural playback end, or on any `PianoRoll.onChange`.
  Download/Copy call `generateScript(song)` fresh (which internally filters through
  `getAudibleSong` too) — both read *current* `song` state at click time, so piano-roll edits and
  mute/solo changes need no extra plumbing to take effect. Export .wav similarly builds a fresh
  `ZspuPlayer` from `getAudibleSong(song)` at click time and awaits `renderToWav()`
  (disables the button and shows "Rendering..." for the duration — rendering is async but can
  still take a moment on a long/many-track song, even though it's faster than real time) before
  handing the result to `downloadBlob`. A `window`-level `dragover`/`drop`
  listener pair calls `preventDefault()` so a drop outside `#dropzone` doesn't navigate the page
  away to the dropped file.

When changing the generated ZSPU script format, `constructBodyOfFile` and `constructLoopBlocks` in
`scriptGen.ts` are the two functions that hand-emit the ZSPU source text — the ZSPU
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
