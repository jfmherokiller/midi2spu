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
  chunk — catches track/channel-grouping regressions), plus 3 more added 2026-08-26 from a full
  collection survey (see below): `bohemian1.mid` (421 real `setTempo` events — mid-song tempo
  regression fixture), `tom_petty-free_fallin.mid` (real overlapping/legato notes, moderate depth
  28 on one channel), `Bad Apple!!.mid` (a *different* Bad Apple rip than the one above - extreme
  overlap depth 2086 on one channel, stress-tests the held-note-stack fix). When changing the
  export encoding, codegen, or `getnotes()` itself, check generated output (track count + size) on
  *all nine*, not just the file that motivated the change — see the periodic-RLE and
  track/channel-grouping lessons below.
- **Full collection survey (2026-08-26)**: wrote a one-off Node script (parses every file with the
  compiled `MidiFile.js`, classifies format/SMPTE-bit/tempo-event-count/sustain-CC64-count/max
  note-overlap-depth per file) and ran it across all 2,788 files. Confirmed **zero** format-2 and
  **zero** SMPTE-divided files exist in the whole collection - real fixtures for those two are a
  dead end, synthetic `.mid` byte buffers are required. Also surfaced a real parser bug: exactly 2
  files (`Moveslikejagger.mid`, `maroon_5-moves_like_jagger_feat_christina_aguilera.mid`) fail to
  parse at all - `"Expected length for timeSignature event is 4, got 2"` - a non-standard/malformed
  but real-world timeSignature meta event the parser is too strict about. Worth fixing as part of
  Phase B's robustness work even though it wasn't one of the original four buckets (same spirit:
  don't crash on a real file). This full survey result isn't saved anywhere reusable - rerun the
  script (or ask to) if a future task needs different candidate files from the collection.
- User has Garry's Mod running for real in-game testing but the actual generated HLZASM has never
  been verified running inside the real ZSPU chip in-game — only via a Node harness that
  re-implements the same encode logic, a round-trip decode simulator matching the generated
  script's exact algorithm, and the JS `player.ts` preview (a separate reimplementation, not the
  real HLZASM compiler/VM). Worth doing a real in-game check if the opportunity comes up.

## Done (most recent first)

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

## In-flight: fuller MIDI spec compliance (started 2026-08-26)

Full plan at `C:\Users\peter\.claude\plans\replicated-giggling-acorn.md` (this machine only, not in
the repo). Checked off as each phase is implemented **and** verified, not just implemented:

- [x] **File reorg** — split `utilityfunctions.ts` into `rle.ts`, `midiConstants.ts`,
      `midiExtract.ts`, `scriptGen.ts` (commit `8b8c257`). Verified byte-identical full generated
      output (not just size) on all 9 files now in the regression set. `midiTiming.ts` deferred to
      when Phase C (SMPTE) actually needs it, per the plan.
- [x] **Phase B** — robustness (`MidiFile.ts`: skip unknown chunks, handle system-common bytes
      0xF1-0xF6, reset running status after 0xF0+ events, tolerate malformed meta-event lengths)
      + `getnotes()` held-note-stack fix (overlapping/legato notes) + All Notes Off/All Sound Off
      (CC 120/123). Commits `a92e471` (fix), `29846c7` (docs). Also fixed a real crash on 2 files
      (malformed `timeSignature` length) discovered along the way, not originally scoped but same
      "don't crash on a real file" spirit.
- [x] **Phase E** — sustain pedal (CC64), implemented together with Phase B since it shares the
      exact same held-note-stack rewrite (same commits as above). Real test file: `A-Team.mid`
      (12 real CC64 events, confirmed).
- [x] **Phase C — SMPTE** — real time-division support (`MidiHeader.division` discriminated union,
      `midiTiming.ts`'s `ticksToStepsFloat`, `SMPTE_STEPS_PER_SECOND=20`). Commits `deec1a3`
      (fix), `7bb4056` (docs). No real SMPTE file exists anywhere in the user's collection
      (confirmed via full survey) - verified against a hand-built synthetic fixture
      (`buildSynthetic.mjs`, not saved anywhere permanent - rebuild if needed again) instead.
- [x] **Phase C — format 2** — detect + UI warning (`Song.warnings`, `#warning` banner in
      `index.html`/`app.ts`), no attempt at real sequential pattern playback (scope decision, see
      plan's Context section for why). Same commits as SMPTE above. Also zero real format-2 files
      in the collection - verified with a hand-built synthetic fixture, live in browser (warning
      shows/hides correctly).
- [ ] **Phase D — mid-song tempo changes** — `getTempoTrack()`, `Song.tempo`→`Song.tempoTrack`,
      `player.ts` real-time scheduling via `cumulativeStepTime` prefix-sum + binary search, dynamic
      `tempo(curtempo)` in generated script. Biggest/last phase - do after B/C/E stabilize
      `getnotes()`. No real multi-tempo file found yet in the checked subset - may need synthetic.

**Testing note for this work specifically**: clicking Download .txt / Export .wav for real in
Brave triggers a native save dialog/notification that hangs browser automation. When verifying via
claude-in-chrome, patch BOTH `URL.createObjectURL` (capture the Blob) AND
`HTMLAnchorElement.prototype.click` (no-op it) via `javascript_tool` before clicking those buttons,
so `downloadBlob`'s `link.click()` never fires a real save. Prefer the Node harness (compile +
run against real `.mid` files, no browser needed) for pure data-correctness checks; only reach for
the browser to confirm UI/playback/no-console-errors.

## Known gaps / not yet done

- Real-world files for the rarer spec-compliance cases (multi-tempo, format 2, SMPTE) weren't
  found in the ~8 files checked so far this session; a full survey of the user's ~2,788-file
  collection was attempted but blocked by plan mode (subagents inherit the same read-only
  restriction, so a Workflow can't run the parsing harness either) - synthetic `.mid` fixtures are
  the fallback for whichever categories a quick manual check of more real files doesn't turn up.
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

See "In-flight: fuller MIDI spec compliance" above — that's the current work. All 9 prior commits
are pushed as of 2026-08-26; check `git log origin/master..HEAD` before assuming that's still
true, and ask before pushing new work.
