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

function getTempo(midi: Midifile) {
    if (midi.header.division.type === "smpte") {
        /* SMPTE-timed files have no beat/tempo concept - a fixed real-time clock instead - so any
           setTempo events present (spec doesn't forbid them, but they're meaningless here) are
           ignored, and this returns a fixed effective tempo instead: chosen so tempo()'s per-tick
           busy-wait (60/bpm seconds) exactly equals one SMPTE-quantized step
           (1/SMPTE_STEPS_PER_SECOND seconds). */
        return 60 * SMPTE_STEPS_PER_SECOND;
    }
    let tempoEvent = midi.tracks[0].filter(x => x.microsecondsPerBeat != null)[0];
    let microsecondsPerBeat = tempoEvent?.microsecondsPerBeat ?? DEFAULT_MICROSECONDS_PER_BEAT;
    let tempo = 60000000 / microsecondsPerBeat;
    tempo = Math.round(tempo);
    return tempo * STEPS_PER_BEAT;
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
/* MIDI channels 0-15; a real GM controller number. Controller 64 is handled by the sustain-pedal
   logic in the per-group walk below, not filtered out here. */
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

export {getnotes, getTempo};
