# midi2spu — session handoff

Read this first, then `CLAUDE.md` for architecture/build details. This file tracks what's done,
what's in flight, and what's next — update it whenever a task starts, finishes, or the plan
changes, so a fresh session (or a different agent) can pick up without replaying this history.

## Repo/session context

- Local git repo, remote `github.com/jfmherokiller/midi2spu`. **No CLAUDE Code auto-push** — this
  project pushes only when the user explicitly asks. Check `git log origin/master..HEAD` for
  unpushed local commits before assuming the remote is current.
- Real-world `.mid` test files live at `G:\My Drive\Public\midi` on the user's machine (Google
  Drive mount, ~2,788 files across subdirectories — recurse when scanning it, a top-level-only
  listing misses most of them) — copy into the session scratchpad before uploading via browser
  automation. The standing regression set for anything touching MIDI parsing or the export
  encoding: `A-Team.mid` (small smoke test, 12 real sustain-pedal CC64 events),
  `Bolero-Ravel.mid` (26 tracks sharing only 16 MIDI channels — layout/scale stress test AND the
  file that catches channel-reuse regressions), `Bad Apple.mid` (output-size stress test),
  `Rainbow Tylenol.mid` (percussion-heavy), `Intensive Care Unit TheVocoderGuy.mid` (short
  repeating note sequences), `The-Rhythm-Of-The-Night-3.mid` (format-0, 13 channels in one track
  chunk — catches track/channel-grouping regressions), plus 4 more added 2026-08-26 from a full
  collection survey (see below): `bohemian1.mid` (421 real `setTempo` events, 73 distinct BPM
  values 30-208 — the mid-song-tempo regression fixture), `tom_petty-free_fallin.mid` (real
  overlapping/legato notes, moderate depth 28 on one channel), `Bad Apple!!.mid` (a *different*
  Bad Apple rip than the one above - extreme overlap depth 2086 on one channel, stress-tests the
  held-note-stack fix), `Moveslikejagger.mid` (malformed `timeSignature` meta event - used to
  crash the parser outright). When changing the export encoding, codegen, or `getnotes()` itself,
  check generated output (track count + size) on *all ten*, not just the file that motivated the
  change — see the periodic-RLE and track/channel-grouping lessons below.
- **Full collection survey (2026-08-26)**: wrote a one-off Node script (parses every file with the
  compiled `MidiFile.js`, classifies format/SMPTE-bit/tempo-event-count/sustain-CC64-count/max
  note-overlap-depth per file) and ran it across all 2,788 files (recursively - an initial
  non-recursive pass only found 630). Confirmed **zero** format-2 and **zero** SMPTE-divided files
  exist in the whole collection - real fixtures for those two are a dead end, synthetic `.mid`
  byte buffers were used instead (see Phase C below). Found real candidates for everything else:
  417 files with 2+ tempo events, 135 with meaningful sustain-pedal use, 1238 with real
  overlapping notes, and exactly 2 unparseable files (both the same underlying malformed
  `timeSignature` bug, now fixed). This full survey result isn't saved anywhere reusable beyond
  the 4 files pulled into the regression set above - rerun the script (or ask to) if a future task
  needs different candidates from the collection. (Note: the survey was first attempted via a
  Workflow while still in plan mode and correctly refused - subagents inherit the same read-only
  restriction, so this needed exiting plan mode first.)
- User has Garry's Mod running for real in-game testing but the actual generated HLZASM has never
  been verified running inside the real ZSPU chip in-game — only via a Node harness that
  re-implements the same encode logic, a round-trip decode simulator matching the generated
  script's exact algorithm, and the JS `player.ts` preview (a separate reimplementation, not the
  real HLZASM compiler/VM). Worth doing a real in-game check if the opportunity comes up.

## Done (most recent first)

- **Fuller MIDI spec compliance** (started/finished 2026-08-26, plan at
  `C:\Users\peter\.claude\plans\replicated-giggling-acorn.md`) — six sub-parts, all implemented
  and verified:
  - File reorg: split `utilityfunctions.ts` into `rle.ts`/`midiConstants.ts`/`midiExtract.ts`/
    `scriptGen.ts` (commit `8b8c257`), byte-identical output verified first before anything else.
  - Robustness (`MidiFile.ts`): skip unknown chunks, handle system-common bytes 0xF1-0xF6, reset
    running status after 0xF0+ events, tolerate malformed meta-event lengths (found + fixed a real
    crash on 2 real files this way, not originally scoped) (`a92e471`/`29846c7`).
  - `getnotes()` held-note-stack rewrite: fixes a real, common overlapping/legato-note bug (any
    noteOff used to silence the channel even for a note that wasn't currently sounding - one real
    file's melody track went from 10% to 100% non-rest coverage once fixed), plus All Notes
    Off/All Sound Off (CC 120/123) and sustain pedal (CC64) on the same rewrite (`a92e471`).
  - SMPTE time division: real support (`MidiHeader.division` discriminated union, `midiTiming.ts`),
    not just tolerating the header field - genuinely different timing model (`deec1a3`).
  - Format 2: detect + `Song.warnings`/`#warning` UI banner, deliberately no attempt at real
    sequential-pattern playback (scope decision - see the plan's Context section) (`deec1a3`).
  - Mid-song tempo changes: `getTempoTrack()` (one scaled-BPM value per step, not a song-wide
    constant), `player.ts`'s `cumulativeStepTime` prefix-sum + binary search for correct real-time
    scheduling, `scriptGen.ts`'s `temposeq` pseudo-track reusing the exact same RLE/pattern-block
    machinery as a note track (`5de0f1b`/`267c6a9`). Verified against a real 421-tempo-event file.
  - Full survey of the user's ~2,788-file MIDI collection along the way (see repo/session context
    above) - found real regression fixtures for everything except format-2/SMPTE (confirmed zero
    real examples of either exist in the collection).
- **Track/channel grouping fix** (commits `f5367b4`, `6802d96`, pushed) — `getnotes()` used to
  key its decode state off the raw MIDI track chunk index, assuming one instrument per track.
  Broke two ways on real files: a format-0 file (`The-Rhythm-Of-The-Night-3.mid`, whole song in
  one track chunk multiplexing 13 channels) loaded as one garbled channel; a first-attempt fix
  (group by channel alone) would have broken `Bolero-Ravel.mid` instead (26 instrument tracks
  legitimately share only 16 channels — 3 separate flute parts all declared on channel 0). Fixed
  by grouping by the *(track,channel)* pair, which handles both correctly. See `CLAUDE.md`'s
  `getnotes` section for the full mechanism.
- **WAV export** (commits `23def3d`, `0399e5c`, pushed) — "Export .wav" button renders the current
  song (respecting mute/solo/per-track waveform/volume via `getAudibleSong`, same as the `.txt`
  export) to a downloadable `.wav` using `OfflineAudioContext` + a hand-rolled PCM16 encoder
  (`wav.ts`). `player.ts`'s per-track scheduling was refactored into a shared `scheduleTrack`
  method so live preview and offline render use identical audio logic. Verified in a live browser
  (captured the Blob via a `URL.createObjectURL` patch, parsed the WAV header back out, confirmed
  non-silent PCM) on both a small file and `Bolero-Ravel.mid` (26 tracks, ~14min, ~75MB output,
  no errors). See `CLAUDE.md`'s `player.ts`/`wav.ts`/`app.ts` sections for the mechanism.
- **Periodic-pattern RLE compression** (commits `93d5924`, `8dc3dd5`, pushed) — `encodeRuns` in
  `utilityfunctions.ts` now also detects short repeating note sequences (period 2-32) and encodes
  them as a single pattern block instead of one plain-RLE pair per step. Only used per-track when
  it's genuinely smaller than plain RLE *including* the fixed decode-loop code cost it adds
  (`usesPattern` threaded through `CreateDBLines`/`CreateFileString`/`constructLoopBlocks`) —
  an earlier version that ignored that fixed cost made some files' total output *bigger* despite
  fewer RLE tokens. See `CLAUDE.md`'s `utilityfunctions.ts` section for the full mechanism.
- **Percussion export fix** (commits `b97d80a`, `10a094d`, pushed) — `getnotes()` no longer
  skips noteOn/noteOff on the GM percussion channel; percussion tracks now export/play real note
  data (GM drum note number reused as the noise "pitch") instead of one long silent rest.
- Run-length-encoding of exported note data + percussion detection/default-noise-waveform/color
  (commit `94e9d29`, pushed).
- XP.css restyle, piano roll editor (multi-track overlay, mute/solo, resizable, playhead
  follow-scroll), Web Audio preview player, copy-to-clipboard, HLZASM docs split to
  `E:\projects\zcpu-notes` (all pushed, predates this file).
- Full toolchain modernization: Vite + modern TS, ArrayBuffer-based MIDI parsing, real
  deltaTime-based note timing (all pushed, predates this file).

## Testing technique notes (keep using these)

**Avoiding real downloads during browser testing**: clicking Download .txt / Export .wav for real
in Brave triggers a native save dialog/notification that hangs browser automation. When verifying
via claude-in-chrome, patch BOTH `URL.createObjectURL` (capture the Blob) AND
`HTMLAnchorElement.prototype.click` (no-op it) via `javascript_tool` before clicking those buttons,
so `downloadBlob`'s `link.click()` never fires a real save. Prefer the Node harness (compile +
run against real `.mid` files, no browser needed) for pure data-correctness checks; only reach for
the browser to confirm UI/playback/no-console-errors.

**Plan mode blocks subagents too**: a Workflow/Agent spawned while in plan mode inherits the same
read-only restriction as the main session - it can't run Bash/Node to actually do research that
needs script execution (e.g. parsing thousands of files). If a plan needs that kind of research,
either do it before entering plan mode, or exit plan mode first and re-enter after.

## Known gaps / not yet done

- Real in-game verification of generated HLZASM has never been done (see above) — everything
  verified so far is via reimplementation/simulation, not the actual Wiremod ZSPU compiler+VM.
- `BASE_FREQUENCY=880` in `player.ts` (native pitch of the plain unprefixed `synth/*.wav` files)
  remains an unverified assumption — see the comment at the top of `player.ts`.
- No automated test suite — verification so far is ad hoc Node harnesses (compile the relevant
  `src/*.ts` files standalone, e.g. via `node_modules/.bin/tsc --ignoreConfig --outDir <scratch>
  --module ESNext --moduleResolution bundler --target ES2022 --rootDir src <files>`, use `.mid`
  files copied into the scratchpad) plus live browser testing via claude-in-chrome. Repeat that
  pattern for future verification rather than assuming a `npm test` exists.

## In progress / next up

Nothing in flight. The "fuller MIDI spec compliance" work (see Done above) is fully implemented,
verified, and committed — 10 commits, all **unpushed** as of 2026-08-26 (`8b8c257`..`267c6a9`, on
top of the 9 already-pushed commits from earlier that day). Ask the user before pushing; check
`git log origin/master..HEAD` first to confirm this is still accurate. Next task is whatever the
user asks for next.
