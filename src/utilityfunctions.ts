
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

function createWaveChannelBlocks(needed:number) {
    let baseblock:string[] = [];
    baseblock.push("// Set track wave to channel 0 and start\n");
    baseblock.push("wset 0,trackwave;\n");
    baseblock.push("chwave 0,0;\n");
    baseblock.push("chvolume 0,2.5;\n");
    baseblock.push("chstart 0;\n");
    baseblock.push("\n");
    if (needed > 1) {
        for (let i = 1; i < needed; i++) {
            baseblock.push("// Set track wave to channel " + i + "and start\n");
            baseblock.push("wset " + i + ",trackwave;\n");
            baseblock.push("chwave " + i + "," + i + ";\n");
            baseblock.push("chvolume " + i + ",2.5;\n");
            baseblock.push("chstart " + i + ";\n");
            baseblock.push("\n");
        }
    }
    return baseblock;
}

function createDbLines(notes:number[][]) {
    let dblines:string[][] = [];
    for (let notetracknum = 0; notetracknum < notes.length; notetracknum++) {
        dblines[notetracknum] = [];
        dblines[notetracknum].push(`track${notetracknum}:\n`);
        while (notes[notetracknum].length) {
            dblines[notetracknum].push("db ".concat(notes[notetracknum].splice(0, 32).join(', ')).concat(";\n"));
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
function constructBodyOfFile(numberOfTracks:number, longesttrack:number, tempo:number) {
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
    file.push("string trackwave,\"synth/sine_880.wav\";\n");
    file.push("\n");
    return file;
}
function createFileString(dblinesin:string[][], tempo:number) {
    let longestTrack = dblinesin.map(function (a) {
        return a.length;
    }).indexOf(Math.max.apply(Math, dblinesin.map(function (a) {
        return a.length;
    })));
    let file = createWaveChannelBlocks(dblinesin.length);
    file = file.concat(constructBodyOfFile(dblinesin.length, longestTrack, tempo));
    //file.concat(require("fs").readFileSync("header.txt", 'utf8'));
    for (let dbline of dblinesin) {
        file = file.concat(dbline);
        file.push("\n");
    }

    return file;
}
export {getnotes, createDbLines as CreateDBLines, getTempo as GetTempo, createFileString as CreateFileString}