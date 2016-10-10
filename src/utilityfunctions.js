/**
 * Created by jfmmeyers on 9/14/16.
 */
"use strict";
function getTempo(midi) {
    var tempo = midi.tracks[0].filter(function (x) { return x.microsecondsPerBeat != null; })[0].microsecondsPerBeat;
    tempo = 60000000 / tempo;
    tempo = Math.round(tempo);
    return tempo * 10;
}
exports.GetTempo = getTempo;
function getnotes(midi) {
    var notes = [];
    for (var i = 0; i < midi.tracks.length; i++) {
        notes[i] = [];
        for (var _i = 0, _a = midi.tracks[i]; _i < _a.length; _i++) {
            var midievent = _a[_i];
            if (midievent.channel !== 10) {
                if (midievent.subtype === "noteOn") {
                    notes[i].push(midievent.noteNumber);
                }
                if (midievent.subtype === "noteOff") {
                    notes[i].push(-1);
                }
            }
        }
    }
    for (var k = 0; k < notes.length; k++) {
        if (notes[k].length === 0) {
            notes.splice(k, 1);
        }
    }
    return notes;
}
exports.getnotes = getnotes;
function createWaveChannelBlocks(needed) {
    var baseblock = [];
    baseblock.push("// Set track wave to channel 0 and start\n");
    baseblock.push("wset 0,trackwave;\n");
    baseblock.push("chwave 0,0;\n");
    baseblock.push("chvolume 0,2.5;\n");
    baseblock.push("chstart 0;\n");
    baseblock.push("\n");
    if (needed > 1) {
        for (var i = 1; i < needed; i++) {
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
function createDbLines(notes) {
    var dblines = [];
    for (var notetracknum = 0; notetracknum < notes.length; notetracknum++) {
        dblines[notetracknum] = [];
        dblines[notetracknum].push("track" + notetracknum + ":\n");
        while (notes[notetracknum].length) {
            dblines[notetracknum].push("db ".concat(notes[notetracknum].splice(0, 32).join(', ')).concat(";\n"));
        }
        dblines[notetracknum].push("db 0; // End string\n");
    }
    return dblines;
}
exports.CreateDBLines = createDbLines;
function constructLoopBlocks(needed) {
    var noteblocks = [];
    noteblocks.push("    // Track 0\n");
    noteblocks.push("note = 2;\n");
    noteblocks.push("fpwr note,(track0[i]/12);\n");
    noteblocks.push("note /= 100;\n");
    noteblocks.push("chpitch 0,note;\n");
    noteblocks.push("\n");
    if (needed > 1) {
        for (var i = 1; i < needed; i++) {
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
function constructBodyOfFile(numberOfTracks, longesttrack, tempo) {
    var file = [];
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
function createFileString(dblinesin, tempo) {
    var longestTrack = dblinesin.map(function (a) {
        return a.length;
    }).indexOf(Math.max.apply(Math, dblinesin.map(function (a) {
        return a.length;
    })));
    var file = createWaveChannelBlocks(dblinesin.length);
    file = file.concat(constructBodyOfFile(dblinesin.length, longestTrack, tempo));
    //file.concat(require("fs").readFileSync("header.txt", 'utf8'));
    for (var _i = 0, dblinesin_1 = dblinesin; _i < dblinesin_1.length; _i++) {
        var dbline = dblinesin_1[_i];
        file = file.concat(dbline);
        file.push("\n");
    }
    return file;
}
exports.CreateFileString = createFileString;
//# sourceMappingURL=utilityfunctions.js.map