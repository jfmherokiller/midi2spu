import {Midifile} from "./MidiFile";
import {PERCUSSION_CHANNEL} from "./midiConstants";

/* The generated ZSPU main() loop advances one `db` array entry per tempo()
   tick, and GetTempo multiplies BPM by this factor - so each entry
   represents 1/STEPS_PER_BEAT of a beat. getnotes() below must quantize
   note durations to this same resolution or the two drift apart. */
const STEPS_PER_BEAT = 10;

/* MIDI default tempo (spec fallback when no setTempo meta event is present) */
const DEFAULT_MICROSECONDS_PER_BEAT = 500000;

function getTempo(midi: Midifile) {
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
function getnotes(midi: Midifile) {
    interface ChannelEvent {
        absoluteTick: number;
        subtype: "noteOn" | "noteOff";
        noteNumber: number;
    }
    interface TrackChannelGroup {
        channel: number;
        events: ChannelEvent[];
    }
    let groups = new Map<string, TrackChannelGroup>();
    for (let trackIndex = 0; trackIndex < midi.tracks.length; trackIndex++) {
        let absoluteTick = 0;
        for (let midievent of midi.tracks[trackIndex]) {
            absoluteTick += midievent.deltaTime;
            if (midievent.subtype !== "noteOn" && midievent.subtype !== "noteOff") continue;
            let channel = midievent.channel!;
            let key = trackIndex + ":" + channel;
            if (!groups.has(key)) {
                groups.set(key, {channel, events: []});
            }
            // Events for a given (track,channel) pair are pushed in file order (deltaTime
            // accumulates monotonically), so this list is already sorted by absoluteTick.
            groups.get(key)!.events.push({
                absoluteTick,
                subtype: midievent.subtype,
                noteNumber: midievent.noteNumber ?? -1,
            });
        }
    }

    let notes: number[][] = [];
    let isPercussion: boolean[] = [];
    for (let {channel, events} of groups.values()) {
        let track: number[] = [];
        let currentNote = -1;
        let fractionalSteps = 0;
        let lastTick = 0;
        for (let {absoluteTick, subtype, noteNumber} of events) {
            let deltaTicks = absoluteTick - lastTick;
            lastTick = absoluteTick;
            if (deltaTicks > 0) {
                fractionalSteps += (deltaTicks / midi.header.ticksPerBeat) * STEPS_PER_BEAT;
                let steps = Math.floor(fractionalSteps);
                fractionalSteps -= steps;
                for (let s = 0; s < steps; s++) {
                    track.push(currentNote);
                }
            }
            currentNote = subtype === "noteOn" ? noteNumber : -1;
        }
        if (track.length > 0) {
            notes.push(track);
            isPercussion.push(channel === PERCUSSION_CHANNEL);
        }
    }
    return {tracks: notes, isPercussion};
}

export {getnotes, getTempo};
