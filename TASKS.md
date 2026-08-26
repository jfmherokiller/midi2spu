# midi2spu — session handoff

Read this first, then `CLAUDE.md` for architecture/build details. This file tracks what's done,
what's in flight, and what's next — update it whenever a task starts, finishes, or the plan
changes, so a fresh session (or a different agent) can pick up without replaying this history.

## Repo/session context

- Local git repo, remote `github.com/jfmherokiller/midi2spu`. **No CLAUDE Code auto-push** — this
  project pushes only when the user explicitly asks. Check `git log origin/master..HEAD` for
  unpushed local commits before assuming the remote is current.
- Real-world `.mid` test files live at `G:\My Drive\Public\midi` on the user's machine (Google
  Drive mount) — copy into the session scratchpad before uploading via browser automation. The
  standing regression set for anything touching MIDI parsing or the export encoding:
  `A-Team.mid` (small smoke test), `Bolero-Ravel.mid` (26 tracks sharing only 16 MIDI channels —
  layout/scale stress test AND the file that catches channel-reuse regressions),
  `Bad Apple.mid` (output-size stress test), `Rainbow Tylenol.mid` (percussion-heavy),
  `Intensive Care Unit TheVocoderGuy.mid` (short repeating note sequences),
  `The-Rhythm-Of-The-Night-3.mid` (format-0, 13 channels in one track chunk — catches
  track/channel-grouping regressions). When changing the export encoding, codegen, or `getnotes()`
  itself, check generated output (track count + size) on *all six*, not just the file that
  motivated the change — see the periodic-RLE and track/channel-grouping lessons below.
- User has Garry's Mod running for real in-game testing but the actual generated HLZASM has never
  been verified running inside the real ZSPU chip in-game — only via a Node harness that
  re-implements the same encode logic, a round-trip decode simulator matching the generated
  script's exact algorithm, and the JS `player.ts` preview (a separate reimplementation, not the
  real HLZASM compiler/VM). Worth doing a real in-game check if the opportunity comes up.

## Done (most recent first)

- **Track/channel grouping fix** (commits `f5367b4`, `6802d96`, unpushed) — `getnotes()` used to
  key its decode state off the raw MIDI track chunk index, assuming one instrument per track.
  Broke two ways on real files: a format-0 file (`The-Rhythm-Of-The-Night-3.mid`, whole song in
  one track chunk multiplexing 13 channels) loaded as one garbled channel; a first-attempt fix
  (group by channel alone) would have broken `Bolero-Ravel.mid` instead (26 instrument tracks
  legitimately share only 16 channels — 3 separate flute parts all declared on channel 0). Fixed
  by grouping by the *(track,channel)* pair, which handles both correctly. See `CLAUDE.md`'s
  `getnotes` section for the full mechanism.
- **WAV export** (commit pending as of writing this) — "Export .wav" button renders the current
  song (respecting mute/solo/per-track waveform/volume via `getAudibleSong`, same as the `.txt`
  export) to a downloadable `.wav` using `OfflineAudioContext` + a hand-rolled PCM16 encoder
  (`wav.ts`). `player.ts`'s per-track scheduling was refactored into a shared `scheduleTrack`
  method so live preview and offline render use identical audio logic. Verified in a live browser
  (captured the Blob via a `URL.createObjectURL` patch, parsed the WAV header back out, confirmed
  non-silent PCM) on both a small file and `Bolero-Ravel.mid` (26 tracks, ~14min, ~75MB output,
  no errors). See `CLAUDE.md`'s `player.ts`/`wav.ts`/`app.ts` sections for the mechanism.
- **Periodic-pattern RLE compression** (commits `93d5924`, `8dc3dd5`, unpushed) — `encodeRuns` in
  `utilityfunctions.ts` now also detects short repeating note sequences (period 2-32) and encodes
  them as a single pattern block instead of one plain-RLE pair per step. Only used per-track when
  it's genuinely smaller than plain RLE *including* the fixed decode-loop code cost it adds
  (`usesPattern` threaded through `CreateDBLines`/`CreateFileString`/`constructLoopBlocks`) —
  an earlier version that ignored that fixed cost made some files' total output *bigger* despite
  fewer RLE tokens. See `CLAUDE.md`'s `utilityfunctions.ts` section for the full mechanism.
- **Percussion export fix** (commits `b97d80a`, `10a094d`, unpushed) — `getnotes()` no longer
  skips noteOn/noteOff on the GM percussion channel; percussion tracks now export/play real note
  data (GM drum note number reused as the noise "pitch") instead of one long silent rest.
- Run-length-encoding of exported note data + percussion detection/default-noise-waveform/color
  (commit `94e9d29`, pushed).
- XP.css restyle, piano roll editor (multi-track overlay, mute/solo, resizable, playhead
  follow-scroll), Web Audio preview player, copy-to-clipboard, HLZASM docs split to
  `E:\projects\zcpu-notes` (all pushed, predates this file).
- Full toolchain modernization: Vite + modern TS, ArrayBuffer-based MIDI parsing, real
  deltaTime-based note timing (all pushed, predates this file).

## Known gaps / not yet done

- **8 commits unpushed** as of 2026-08-26 (`b97d80a`..`6802d96`) — ask the user before pushing,
  don't do it automatically.
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

Nothing in flight. All explicitly requested features implemented, verified (Node harness and/or
live browser testing as appropriate), and committed. Next task is whatever the user asks for next
— check `git log origin/master..HEAD` first to see how many commits are still unpushed before
starting new work, and ask before pushing.
