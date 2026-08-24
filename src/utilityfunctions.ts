
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
const PERCUSSION_CHANNEL = 9;

/* The 4 waveform slots the SPU preloads on reset (VM:Reset() in cl_spuvm.lua) - the only
   waveforms guaranteed to exist without a custom sound resource. */
export type WaveformId = "square" | "saw" | "tri" | "sine";
export const WAVEFORM_PATHS: Record<WaveformId, string> = {
    square: "synth/square.wav",
    saw: "synth/saw.wav",
    tri: "synth/tri.wav",
    sine: "synth/sine.wav",
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
    for (let i = 0; i < midi.tracks.length; i++) {
        let track: number[] = [];
        let currentNote = -1;
        let fractionalSteps = 0;
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
                continue;
            }
            if (midievent.subtype === "noteOn") {
                currentNote = midievent.noteNumber ?? -1;
            } else if (midievent.subtype === "noteOff") {
                currentNote = -1;
            }
        }
        if (track.length > 0) {
            notes.push(track);
        }
    }
    return notes;
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

function createDbLines(notes:number[][]) {
    /* The generated main() loop shares one index `i` across every track, counting up to
       tracklen = strlen(the longest track) - see constructBodyOfFile. A track's own `db 0;`
       terminator only marks where strlen() should stop counting; it does NOT stop the shared
       loop from reading trackN[i] past that point. Without padding, a track shorter than
       tracklen reads straight through into whatever memory comes after its own declared data -
       the next track's real note values, misread as this track's continuing melody. Padding every
       track to the same length with -1 (silence) makes every trackN[i] for i < tracklen valid. */
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
        dblines[notetracknum] = [];
        dblines[notetracknum].push(`track${notetracknum}:\n`);
        while (paddedNotes[notetracknum].length) {
            dblines[notetracknum].push("db ".concat(paddedNotes[notetracknum].splice(0, 32).join(', ')).concat(";\n"));
        }
        dblines[notetracknum].push("db 0; // End string\n");
    }
    return dblines;
}
function constructLoopBlocks(needed:number) {
    let noteblocks:string[] = [];
    noteblocks.push("    // Track 0\n");
    noteblocks.push("note = 2;\n");
    noteblocks.push("fpwr note,(track0[i]/12);\n");
    noteblocks.push("note /= 100;\n");
    noteblocks.push("chpitch 0,note;\n");
    noteblocks.push("\n");
    if (needed > 1) {
        for (let i = 1; i < needed; i++) {
            noteblocks.push("    // Track " + i + "\n");
            noteblocks.push("note = 2;\n");
            noteblocks.push("fpwr note,(track" + i + "[i]/12);\n");
            noteblocks.push("note /= 100;\n");
            noteblocks.push("chpitch " + i + ",note;\n");
            noteblocks.push("\n");
        }
    }
    return noteblocks;
}
function constructBodyOfFile(numberOfTracks:number, longesttrack:number, tempo:number, waveforms:WaveformId[]) {
    let file:string[] = [];
    file.push("// Get track length\n");
    file.push("tracklen = strlen(track" + longesttrack + ");\n");
    file.push("\n");
    file.push("void main()\n");
    file.push("{\n");
    file.push("    tempo(" + tempo + ")\n");
    file.push("\n");
    file = file.concat(constructLoopBlocks(numberOfTracks));
    file.push("    // Index\n");
    file.push("i++; mod i,tracklen;\n");
    file.push("\n");
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
    file.push("float note, i;\n");
    file.push("float tracklen;\n");
    file.push("float time, timestamp;\n");
    file.push("\n");
    for (let i = 0; i < waveforms.length; i++) {
        file.push("string wave" + i + ",\"" + WAVEFORM_PATHS[waveforms[i]] + "\";\n");
    }
    file.push("\n");
    return file;
}
function createFileString(dblinesin:string[][], tempo:number, waveforms:WaveformId[], volumes:number[]) {
    let longestTrack = dblinesin.map(function (a) {
        return a.length;
    }).indexOf(Math.max.apply(Math, dblinesin.map(function (a) {
        return a.length;
    })));
    let file = createWaveChannelBlocks(volumes);
    file = file.concat(constructBodyOfFile(dblinesin.length, longestTrack, tempo, waveforms));
    //file.concat(require("fs").readFileSync("header.txt", 'utf8'));
    for (let dbline of dblinesin) {
        file = file.concat(dbline);
        file.push("\n");
    }

    return file;
}
export {getnotes, createDbLines as CreateDBLines, getTempo as GetTempo, createFileString as CreateFileString}