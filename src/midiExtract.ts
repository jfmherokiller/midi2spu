import {Midifile} from "./MidiFile";
import {PERCUSSION_CHANNEL} from "./midiConstants";
import {ticksToStepsFloat, SMPTE_STEPS_PER_SECOND} from "./midiTiming";

/* The generated ZSPU main() loop advances one `db` array entry per tempo()
   tick, and GetTempo multiplies BPM by this factor - so each entry
   represents 1/STEPS_PER_BEAT of a beat. getnotes() below must quantize
   note durations to this same resolution or the two drift apart. */
const STEPS_PER_BEAT = 10;

/* MIDI default tempo (spec fallback when no setTempo meta event is present) */
const DEFAULT_MICROSECONDS_PER_BEAT = 500000;

/* Default scaled-BPM (spec fallback of 120 BPM, matching DEFAULT_MICROSECONDS_PER_BEAT) used
   whenever no setTempo event is in effect yet - both as the very first value in a track with no
   tempo events at all, and to seed getTempoTrack's walk before the first real change. */
const DEFAULT_SCALED_BPM = Math.round(60000000 / DEFAULT_MICROSECONDS_PER_BEAT) * STEPS_PER_BEAT;

/* One scaled-BPM value per output step, the same per-step-array-then-hold-until-next-change shape
   as getnotes()'s note tracks - reused as-is by scriptGen.ts (encoded/decoded exactly like a note
   track, just driving `tempo(curtempo)` instead of `chpitch`, see constructLoopBlocks) and by
   player.ts (to build a real-time cumulative-time lookup for variable-tempo playback). Always
   exactly `totalSteps` long (the caller's longest note track length) - anything past the last
   real tempo-change event holds that value, so the tempo curve and every note track index
   together without a separate padding step.

   setTempo events are scanned across *every* track chunk, not just track 0 - spec allows them
   anywhere, though convention puts them in track 0 - merged by absolute tick across tracks (there
   usually aren't more than a handful in a real file, so this doesn't need getnotes()'s more
   elaborate per-(track,channel) grouping machinery). SMPTE-divided files skip all of this: no
   beat/tempo concept applies to them at all (see getTempo... now folded in here - a fixed
   real-time clock instead), so any setTempo events present (spec doesn't forbid them, but they're
   meaningless for a real-time-clocked file) are ignored and every step gets the same fixed
   effective tempo, chosen so the generated script's tempo() busy-wait (60/bpm seconds) exactly
   equals one SMPTE-quantized step (1/SMPTE_STEPS_PER_SECOND seconds). */
function getTempoTrack(midi: Midifile, totalSteps: number): number[] {
    if (midi.header.division.type === "smpte") {
        return new Array(totalSteps).fill(60 * SMPTE_STEPS_PER_SECOND);
    }

    interface TempoChange {
        absoluteTick: number;
        scaledBpm: number;
    }
    let changes: TempoChange[] = [];
    for (let track of midi.tracks) {
        let absoluteTick = 0;
        for (let midievent of track) {
            absoluteTick += midievent.deltaTime;
            if (midievent.microsecondsPerBeat != null) {
                let bpm = Math.round(60000000 / midievent.microsecondsPerBeat);
                changes.push({absoluteTick, scaledBpm: bpm * STEPS_PER_BEAT});
            }
        }
    }
    changes.sort((a, b) => a.absoluteTick - b.absoluteTick);

    let tempoTrack: number[] = [];
    let currentScaledBpm = DEFAULT_SCALED_BPM;
    let fractionalSteps = 0;
    let lastTick = 0;
    for (let {absoluteTick, scaledBpm} of changes) {
        if (tempoTrack.length >= totalSteps) break;
        let deltaTicks = absoluteTick - lastTick;
        lastTick = absoluteTick;
        if (deltaTicks > 0) {
            fractionalSteps += ticksToStepsFloat(midi.header.division, STEPS_PER_BEAT, deltaTicks);
            let steps = Math.floor(fractionalSteps);
            fractionalSteps -= steps;
            for (let s = 0; s < steps && tempoTrack.length < totalSteps; s++) {
                tempoTrack.push(currentScaledBpm);
            }
        }
        currentScaledBpm = scaledBpm;
    }
    while (tempoTrack.length < totalSteps) {
        tempoTrack.push(currentScaledBpm);
    }
    return tempoTrack;
}

/* A MIDI *track chunk* and a MIDI *channel* are not the same thing, and getnotes() used to
   assume they were (one currentNote per raw track index, fed by every event in that track
   regardless of channel). Two real files broke that assumption in opposite ways:
   - "The-Rhythm-Of-The-Night-3.mid" is a format-0 file: the whole song (13 instruments) is one
     single track chunk multiplexing 13 channels - every instrument's noteOn/noteOff clobbered
     the same currentNote, so it loaded as one garbled channel.
   - "Bolero-Ravel.mid" is format 1 but has 26 instrument tracks sharing only 16 MIDI channels
     (a real orchestral score exceeds MIDI's channel count, e.g. 3 separate "*Flutes" tracks all
     declared on channel 0) - grouping by channel *alone* would wrongly merge those distinct
     instruments back into one clobbered line, the same bug from a different direction.
   The fix that handles both: group noteOn/noteOff events by the pair (which track chunk, which
   channel), not by either alone. A format-0 file has one track chunk, so this still splits it by
   channel; a file with real per-track channel reuse keeps each track chunk's own instrument
   separate regardless of what channel number it happens to share with another track. For the
   common case (one channel per track, true of most files this project was tested against before
   these two), this produces the same grouping as before. */
const CC_ALL_SOUND_OFF = 120;
const CC_ALL_NOTES_OFF = 123;
const CC_SUSTAIN = 64;
const CC_SUSTAIN_ON_THRESHOLD = 64; // spec: 0-63 = off, 64-127 = on

function getnotes(midi: Midifile) {
    interface NoteEvent {
        absoluteTick: number;
        kind: "noteOn" | "noteOff" | "allNotesOff" | "sustain";
        noteNumber: number; // meaningful for noteOn/noteOff only
        sustainDown: boolean; // meaningful for "sustain" only
    }
    interface TrackChannelGroup {
        channel: number;
        events: NoteEvent[];
    }
    let groups = new Map<string, TrackChannelGroup>();
    for (let trackIndex = 0; trackIndex < midi.tracks.length; trackIndex++) {
        let absoluteTick = 0;
        for (let midievent of midi.tracks[trackIndex]) {
            absoluteTick += midievent.deltaTime;
            let kind: NoteEvent["kind"];
            let noteNumber = -1;
            let sustainDown = false;
            if (midievent.subtype === "noteOn" || midievent.subtype === "noteOff") {
                kind = midievent.subtype;
                noteNumber = midievent.noteNumber ?? -1;
            } else if (midievent.subtype === "controller"
                && (midievent.controllerType === CC_ALL_SOUND_OFF || midievent.controllerType === CC_ALL_NOTES_OFF)) {
                kind = "allNotesOff";
            } else if (midievent.subtype === "controller" && midievent.controllerType === CC_SUSTAIN) {
                kind = "sustain";
                sustainDown = (midievent.value ?? 0) >= CC_SUSTAIN_ON_THRESHOLD;
            } else {
                continue;
            }
            let channel = midievent.channel!;
            let key = trackIndex + ":" + channel;
            if (!groups.has(key)) {
                groups.set(key, {channel, events: []});
            }
            // Events for a given (track,channel) pair are pushed in file order (deltaTime
            // accumulates monotonically), so this list is already sorted by absoluteTick.
            groups.get(key)!.events.push({absoluteTick, kind, noteNumber, sustainDown});
        }
    }

    let notes: number[][] = [];
    let isPercussion: boolean[] = [];
    for (let {channel, events} of groups.values()) {
        let track: number[] = [];
        /* Notes currently sounding, most-recently-pressed last ("last note held wins" - standard
           monophonic synth priority, matches this project's one-pitch-per-channel export model).
           A noteOff only changes what's audible if it releases the note that's actually on top of
           the stack - releasing an *older* still-technically-held note (overlapping/legato notes,
           or a chord) just removes it from the stack without silencing whatever's currently
           sounding. This replaces the old "any noteOff silences the channel" behavior, which
           incorrectly cut off the currently-sounding note whenever an earlier note's noteOff
           arrived after a later noteOn had already taken over. */
        let heldNotes: number[] = [];
        /* Notes that got a noteOff *while the sustain pedal was down* - release is deferred until
           the pedal lifts (see the "sustain" case below), not dropped. */
        let sustainedNotes = new Set<number>();
        let sustainDown = false;
        let currentNote = -1;
        let fractionalSteps = 0;
        let lastTick = 0;
        for (let {absoluteTick, kind, noteNumber, sustainDown: pedalDown} of events) {
            let deltaTicks = absoluteTick - lastTick;
            lastTick = absoluteTick;
            if (deltaTicks > 0) {
                fractionalSteps += ticksToStepsFloat(midi.header.division, STEPS_PER_BEAT, deltaTicks);
                let steps = Math.floor(fractionalSteps);
                fractionalSteps -= steps;
                for (let s = 0; s < steps; s++) {
                    track.push(currentNote);
                }
            }
            if (kind === "noteOn") {
                heldNotes.push(noteNumber);
                sustainedNotes.delete(noteNumber); // retriggering cancels a pending sustain-release
                currentNote = noteNumber;
            } else if (kind === "noteOff") {
                if (sustainDown) {
                    // Deferred: keep sounding (stays in heldNotes) until the pedal lifts.
                    sustainedNotes.add(noteNumber);
                } else {
                    let idx = heldNotes.lastIndexOf(noteNumber);
                    if (idx !== -1) heldNotes.splice(idx, 1);
                    currentNote = heldNotes.length > 0 ? heldNotes[heldNotes.length - 1] : -1;
                }
            } else if (kind === "sustain") {
                sustainDown = pedalDown;
                if (!sustainDown) {
                    for (let note of sustainedNotes) {
                        let idx = heldNotes.lastIndexOf(note);
                        if (idx !== -1) heldNotes.splice(idx, 1);
                    }
                    sustainedNotes.clear();
                    currentNote = heldNotes.length > 0 ? heldNotes[heldNotes.length - 1] : -1;
                }
            } else { // allNotesOff / allSoundOff
                heldNotes = [];
                sustainedNotes.clear();
                currentNote = -1;
            }
        }
        /* A group is only worth exporting as a track if it actually sounds a note somewhere -
           broadening the event filter above to also capture sustain/all-notes-off controller
           events means a channel that uses ONLY those (no real noteOn at all) now forms its own
           group too, which would otherwise produce an all-silent phantom track (every entry -1) -
           the same kind of wasted-channel issue the track/channel-grouping fix eliminated for
           metadata-only track chunks. `track.length > 0` alone doesn't catch this since the group
           still has *some* events (just none of them are notes) - check for at least one real
           note instead. */
        if (track.some(note => note !== -1)) {
            notes.push(track);
            isPercussion.push(channel === PERCUSSION_CHANNEL);
        }
    }
    return {tracks: notes, isPercussion};
}

export {getnotes, getTempoTrack};
