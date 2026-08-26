import {encodeRuns, PATTERN_MARK} from "./rle";
import {WaveformId, WAVEFORM_PATHS} from "./midiConstants";

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
    /* Whether each track's encoding actually contains a pattern block - constructLoopBlocks/
       constructBodyOfFile only emit the extra pattern-decode code+variables for tracks that need
       it, since that code is a fixed per-track cost that isn't worth paying on tracks encodeRuns
       didn't find a periodic win for (see encodeRuns' comment). */
    let usesPattern:boolean[] = [];
    for (let notetracknum = 0; notetracknum < paddedNotes.length; notetracknum++) {
        let pairs = encodeRuns(paddedNotes[notetracknum]);
        usesPattern[notetracknum] = pairs.includes(PATTERN_MARK);
        dblines[notetracknum] = [];
        dblines[notetracknum].push(`track${notetracknum}:\n`);
        while (pairs.length) {
            dblines[notetracknum].push("db ".concat(pairs.splice(0, 32).join(', ')).concat(";\n"));
        }
        dblines[notetracknum].push("db 0; // End string\n");
    }
    return {dblines, usesPattern};
}

/* Each track decodes its own run-length pairs independently: while the current run/pattern still
   has ticks remaining, just cycle through its held note(s); once it runs out, read the next
   block header (wrapping to the start of its own array at its own tracklenN) and start counting
   that one down. This replaces the old flat shared-index model (trackN[i], one shared i across
   every track) - RLE blocks mean different tracks are independently partway through
   different-length blocks at any given tick, so there's no single shared index that still makes
   sense.

   A block header is either a plain run [note,count] or, if the first value is PATTERN_MARK, a
   repeating-sequence block [PATTERN_MARK, periodLength, ...periodValues, repeatCount] (see
   rle.ts's encodePeriodicRuns). Both are decoded through the same three pieces of state -
   patternstartN (where the held value(s) begin), patternlenN (how many values to cycle through,
   1 for a plain run), and patternposN (position within that cycle) - so noteN is always just
   trackN[patternstartN+patternposN], cycling patternposN back to 0 every patternlenN ticks.

   This extra state (and the branch to check for PATTERN_MARK) is only emitted for tracks whose
   encoding actually contains a pattern block (usesPattern[i]) - it's a fixed per-track code-size
   cost, so tracks encodeRuns didn't find a periodic win for keep the plain two-variable decode
   instead of paying for pattern support they don't use. */
function constructLoopBlocks(needed:number, usesPattern:boolean[]) {
    let noteblocks:string[] = [];
    for (let i = 0; i < needed; i++) {
        noteblocks.push("    // Track " + i + "\n");
        if (usesPattern[i]) {
            noteblocks.push("if (remain" + i + " <= 0) {\n");
            noteblocks.push("    if (track" + i + "[idx" + i + "] == " + PATTERN_MARK + ") {\n");
            noteblocks.push("        patternlen" + i + " = track" + i + "[idx" + i + "+1];\n");
            noteblocks.push("        patternstart" + i + " = idx" + i + "+2;\n");
            noteblocks.push("        idx" + i + " += 2;\n");
            noteblocks.push("        idx" + i + " += patternlen" + i + ";\n");
            noteblocks.push("        remain" + i + " = track" + i + "[idx" + i + "];\n");
            noteblocks.push("        remain" + i + " *= patternlen" + i + ";\n");
            noteblocks.push("        idx" + i + " += 1;\n");
            noteblocks.push("    } else {\n");
            noteblocks.push("        patternlen" + i + " = 1;\n");
            noteblocks.push("        patternstart" + i + " = idx" + i + ";\n");
            noteblocks.push("        remain" + i + " = track" + i + "[idx" + i + "+1];\n");
            noteblocks.push("        idx" + i + " += 2;\n");
            noteblocks.push("    }\n");
            noteblocks.push("    patternpos" + i + " = 0;\n");
            noteblocks.push("    if (idx" + i + " >= tracklen" + i + ") { idx" + i + " = 0; }\n");
            noteblocks.push("}\n");
            noteblocks.push("note" + i + " = track" + i + "[patternstart" + i + "+patternpos" + i + "];\n");
            noteblocks.push("patternpos" + i + " += 1;\n");
            noteblocks.push("if (patternpos" + i + " >= patternlen" + i + ") { patternpos" + i + " = 0; }\n");
            noteblocks.push("remain" + i + " -= 1;\n");
        } else {
            noteblocks.push("if (remain" + i + " <= 0) {\n");
            noteblocks.push("    note" + i + " = track" + i + "[idx" + i + "];\n");
            noteblocks.push("    remain" + i + " = track" + i + "[idx" + i + "+1];\n");
            noteblocks.push("    idx" + i + " += 2;\n");
            noteblocks.push("    if (idx" + i + " >= tracklen" + i + ") { idx" + i + " = 0; }\n");
            noteblocks.push("}\n");
            noteblocks.push("remain" + i + " -= 1;\n");
        }
        noteblocks.push("note = 2;\n");
        noteblocks.push("fpwr note,(note" + i + "/12);\n");
        noteblocks.push("note /= 100;\n");
        noteblocks.push("chpitch " + i + ",note;\n");
        noteblocks.push("\n");
    }
    return noteblocks;
}
function constructBodyOfFile(numberOfTracks:number, tempo:number, waveforms:WaveformId[], usesPattern:boolean[]) {
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
    file = file.concat(constructLoopBlocks(numberOfTracks, usesPattern));
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
        if (usesPattern[i]) {
            file.push("float note" + i + ", idx" + i + ", remain" + i + ", tracklen" + i
                + ", patternlen" + i + ", patternstart" + i + ", patternpos" + i + ";\n");
        } else {
            file.push("float note" + i + ", idx" + i + ", remain" + i + ", tracklen" + i + ";\n");
        }
    }
    file.push("float time, timestamp;\n");
    file.push("\n");
    for (let i = 0; i < waveforms.length; i++) {
        file.push("string wave" + i + ",\"" + WAVEFORM_PATHS[waveforms[i]] + "\";\n");
    }
    file.push("\n");
    return file;
}
function createFileString(dblinesin:string[][], usesPattern:boolean[], tempo:number, waveforms:WaveformId[], volumes:number[]) {
    let file = createWaveChannelBlocks(volumes);
    file = file.concat(constructBodyOfFile(dblinesin.length, tempo, waveforms, usesPattern));
    for (let dbline of dblinesin) {
        file = file.concat(dbline);
        file.push("\n");
    }

    return file;
}

export {createDbLines as CreateDBLines, createFileString as CreateFileString};
