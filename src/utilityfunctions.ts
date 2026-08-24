
/**
 * Created by jfmmeyers on 9/14/16.
 */

import {Midifile} from "./MidiFile";

/* The generated ZSPU main() loop advances one `db` array entry per tempo()
   tick, and GetTempo multiplies BPM by this factor - so each entry
   represents 1/STEPS_PER_BEAT of a beat. getnotes() below must quantize
   note durations to this same resolution or the two drift apart. */
const STEPS_PER_BEAT = 10;

/* MIDI default tempo (spec fallback when no setTempo meta event is present) */
const DEFAULT_MICROSECONDS_PER_BEAT = 500000;

/* General MIDI's percussion channel is channel 10 in 1-indexed MIDI terms,
   which is index 9 here since event.channel is 0-indexed (eventTypeByte & 0x0f). */
export const PERCUSSION_CHANNEL = 9;

/* Real Wiremod synth/ resources, confirmed against the in-game sound browser. Per the user,
   prefer the plain unprefixed files for simplicity - square/saw/tri/sine all have one
   (synth/tri.wav is real; also-present "_440"/"_880"/"_1760" suffixed variants of every waveform
   are precisely pitched to that exact Hz, but aren't used here since a plain option exists for
   all four). Native pitch of these plain files is therefore unverified/unknown - see
   BASE_FREQUENCY's comment in player.ts. "noise" (pink_noise.wav) has no real pitch, used as the
   default for percussion tracks - see isPercussion in processing.ts. */
export type WaveformId = "square" | "saw" | "tri" | "sine" | "noise";
export const WAVEFORM_PATHS: Record<WaveformId, string> = {
    square: "synth/square.wav",
    saw: "synth/saw.wav",
    tri: "synth/tri.wav",
    sine: "synth/sine.wav",
    noise: "synth/pink_noise.wav",
};

function getTempo(midi: Midifile) {
    let tempoEvent = midi.tracks[0].filter(x => x.microsecondsPerBeat != null)[0];
    let microsecondsPerBeat = tempoEvent?.microsecondsPerBeat ?? DEFAULT_MICROSECONDS_PER_BEAT;
    let tempo = 60000000 / microsecondsPerBeat;
    tempo = Math.round(tempo);
    return tempo * STEPS_PER_BEAT;
}

function getnotes(midi: Midifile) {
    let notes: number[][] = [];
    let isPercussion: boolean[] = [];
    for (let i = 0; i < midi.tracks.length; i++) {
        let track: number[] = [];
        let currentNote = -1;
        let fractionalSteps = 0;
        let hasPercussionEvent = false;
        for (let midievent of midi.tracks[i]) {
            if (midievent.deltaTime > 0) {
                fractionalSteps += (midievent.deltaTime / midi.header.ticksPerBeat) * STEPS_PER_BEAT;
                let steps = Math.floor(fractionalSteps);
                fractionalSteps -= steps;
                for (let s = 0; s < steps; s++) {
                    track.push(currentNote);
                }
            }
            if (midievent.channel === PERCUSSION_CHANNEL) {
                hasPercussionEvent = true;
            }
            if (midievent.subtype === "noteOn") {
                currentNote = midievent.noteNumber ?? -1;
            } else if (midievent.subtype === "noteOff") {
                currentNote = -1;
            }
        }
        if (track.length > 0) {
            notes.push(track);
            isPercussion.push(hasPercussionEvent);
        }
    }
    return {tracks: notes, isPercussion};
}

function createWaveChannelBlocks(volumes:number[]) {
    let baseblock:string[] = [];
    for (let i = 0; i < volumes.length; i++) {
        baseblock.push("// Set track wave to channel " + i + " and start\n");
        baseblock.push("wset " + i + ",wave" + i + ";\n");
        baseblock.push("chwave " + i + "," + i + ";\n");
        baseblock.push("chvolume " + i + "," + volumes[i] + ";\n");
        baseblock.push("chstart " + i + ";\n");
        baseblock.push("\n");
    }
    return baseblock;
}

/* Collapses a per-step array into flat [note,count, note,count, ...] run-length pairs. Most held
   notes span many consecutive steps at STEPS_PER_BEAT quantization, so this compresses heavily
   (measured 7-9x on real songs) - see constructLoopBlocks for how the generated script decodes
   this back into a per-tick note value. */
function encodeRuns(track: number[]): number[] {
    let pairs: number[] = [];
    let i = 0;
    while (i < track.length) {
        let note = track[i];
        let count = 1;
        while (i + count < track.length && track[i + count] === note) {
            count++;
        }
        pairs.push(note, count);
        i += count;
    }
    return pairs;
}

function createDbLines(notes:number[][]) {
    /* Every track is padded to the same total duration (with -1/silence) before encoding so the
       whole ensemble loops together in sync, rather than each track wrapping back to its own
       start at a different real time - see constructLoopBlocks for how each track's own
       independent decode state uses this. */
    let maxLength = Math.max(0, ...notes.map(track => track.length));
    let paddedNotes = notes.map(track => {
        let padded = track.slice();
        while (padded.length < maxLength) {
            padded.push(-1);
        }
        return padded;
    });

    let dblines:string[][] = [];
    for (let notetracknum = 0; notetracknum < paddedNotes.length; notetracknum++) {
        let pairs = encodeRuns(paddedNotes[notetracknum]);
        dblines[notetracknum] = [];
        dblines[notetracknum].push(`track${notetracknum}:\n`);
        while (pairs.length) {
            dblines[notetracknum].push("db ".concat(pairs.splice(0, 32).join(', ')).concat(";\n"));
        }
        dblines[notetracknum].push("db 0; // End string\n");
    }
    return dblines;
}

/* Each track decodes its own run-length pairs independently: while the current run still has
   ticks remaining, just hold noteN; once it runs out, read the next [note,count] pair (wrapping
   to the start of its own array at its own tracklenN) and start counting that one down. This
   replaces the old flat shared-index model (trackN[i], one shared i across every track) - RLE
   pairs mean different tracks are independently partway through different-length runs at any
   given tick, so there's no single shared index that still makes sense. */
function constructLoopBlocks(needed:number) {
    let noteblocks:string[] = [];
    for (let i = 0; i < needed; i++) {
        noteblocks.push("    // Track " + i + "\n");
        noteblocks.push("if (remain" + i + " <= 0) {\n");
        noteblocks.push("    note" + i + " = track" + i + "[idx" + i + "];\n");
        noteblocks.push("    remain" + i + " = track" + i + "[idx" + i + "+1];\n");
        noteblocks.push("    idx" + i + " += 2;\n");
        noteblocks.push("    if (idx" + i + " >= tracklen" + i + ") { idx" + i + " = 0; }\n");
        noteblocks.push("}\n");
        noteblocks.push("remain" + i + " -= 1;\n");
        noteblocks.push("note = 2;\n");
        noteblocks.push("fpwr note,(note" + i + "/12);\n");
        noteblocks.push("note /= 100;\n");
        noteblocks.push("chpitch " + i + ",note;\n");
        noteblocks.push("\n");
    }
    return noteblocks;
}
function constructBodyOfFile(numberOfTracks:number, tempo:number, waveforms:WaveformId[]) {
    let file:string[] = [];
    file.push("// Get track lengths\n");
    for (let i = 0; i < numberOfTracks; i++) {
        file.push("tracklen" + i + " = strlen(track" + i + ");\n");
    }
    file.push("\n");
    file.push("void main()\n");
    file.push("{\n");
    file.push("    tempo(" + tempo + ")\n");
    file.push("\n");
    file = file.concat(constructLoopBlocks(numberOfTracks));
    file.push("    // Repeat\n");
    file.push("jmp main;\n");
    file.push("}\n");
    file.push("\n");
    file.push("// Accurate tempo function for beats-per-minute\n");
    file.push("void tempo( float bpm )\n");
    file.push("{\n");
    file.push("    timer timestamp;\n");
    file.push("    while ((time - timestamp) < (60 / bpm)) { timer time; }\n");
    file.push("}\n");
    file.push("\n");
    file.push("// Returns the length of a string\n");
    file.push("float strlen(char* str)\n");
    file.push("{\n");
    file.push("    char* strptr = str;\n");
    file.push("   while (*strptr++);\n");
    file.push("  return (strptr - str);\n");
    file.push("}\n");
    file.push("\n");
    file.push("float note;\n");
    for (let i = 0; i < numberOfTracks; i++) {
        file.push("float note" + i + ", idx" + i + ", remain" + i + ", tracklen" + i + ";\n");
    }
    file.push("float time, timestamp;\n");
    file.push("\n");
    for (let i = 0; i < waveforms.length; i++) {
        file.push("string wave" + i + ",\"" + WAVEFORM_PATHS[waveforms[i]] + "\";\n");
    }
    file.push("\n");
    return file;
}
function createFileString(dblinesin:string[][], tempo:number, waveforms:WaveformId[], volumes:number[]) {
    let file = createWaveChannelBlocks(volumes);
    file = file.concat(constructBodyOfFile(dblinesin.length, tempo, waveforms));
    for (let dbline of dblinesin) {
        file = file.concat(dbline);
        file.push("\n");
    }

    return file;
}
export {getnotes, createDbLines as CreateDBLines, getTempo as GetTempo, createFileString as CreateFileString}