import {encodeRuns, PATTERN_MARK} from "./rle";
import {WaveformId, WAVEFORM_PATHS} from "./midiConstants";

interface NamedTrack {
    /* Used both as the `db` block label (`${name}:`) and, combined with `suffix` below at the
       call sites that need it, to derive the generated decode-state variable names. */
    name: string;
    values: number[];
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

/* Encodes any number of named per-step value tracks (note tracks, or the tempo pseudo-track - see
   constructLoopBlocks) into ZSPU `db` data. Every track is padded/truncated to the same length
   (with -1) before encoding so the whole ensemble loops together in sync, rather than each track
   wrapping back to its own start at a different real time - see constructLoopBlocks for how each
   track's own independent decode state uses this. Note: -1 padding is only meaningful for note
   tracks (silence); the tempo pseudo-track must already be exactly the right length when passed
   in (see processing.ts's generateScript), since -1 isn't a valid tempo value. */
function createDbLines(namedTracks: NamedTrack[]) {
    let maxLength = Math.max(0, ...namedTracks.map(t => t.values.length));
    let padded = namedTracks.map(t => {
        let values = t.values.slice(0, maxLength);
        while (values.length < maxLength) {
            values.push(-1);
        }
        return values;
    });

    let dblines:string[][] = [];
    /* Whether each track's encoding actually contains a pattern block - constructLoopBlocks/
       constructBodyOfFile only emit the extra pattern-decode code+variables for tracks that need
       it, since that code is a fixed per-track cost that isn't worth paying on tracks encodeRuns
       didn't find a periodic win for (see encodeRuns' comment). */
    let usesPattern:boolean[] = [];
    for (let i = 0; i < padded.length; i++) {
        let pairs = encodeRuns(padded[i]);
        usesPattern[i] = pairs.includes(PATTERN_MARK);
        dblines[i] = [];
        dblines[i].push(`${namedTracks[i].name}:\n`);
        while (pairs.length) {
            dblines[i].push("db ".concat(pairs.splice(0, 32).join(', ')).concat(";\n"));
        }
        dblines[i].push("db 0; // End string\n");
    }
    return {dblines, usesPattern};
}

/* Generates the per-tick decode logic for one RLE-encoded track, generalized over its variable
   names so the exact same state machine drives both a note track (chpitch N afterward) and the
   tempo pseudo-track (tempo(curtempo) afterward - see constructLoopBlocks). `valueVar` is the
   name of the variable the decoded value ends up in (e.g. "note0" or "curtempo"); `suffix` names
   every other piece of decode state for this track (idx${suffix}, remain${suffix}, tracklen
   ${suffix}, and - only when usesPattern - patternlen/patternstart/patternpos${suffix}).

   While the current run/pattern still has ticks remaining, this just cycles through its held
   value(s); once it runs out, it reads the next block header (wrapping to the start of its own
   array at its own tracklen${suffix}) and starts counting that one down. Each track/tempo-curve
   needs its own independent decode state like this since RLE blocks mean different tracks are
   independently partway through different-length blocks at any given tick - there's no single
   shared index that still makes sense (an early version of this generator had one, see git
   history for the "solid tone" bug that caused).

   A block header is either a plain run [value,count] or, if the first value is PATTERN_MARK, a
   repeating-sequence block [PATTERN_MARK, periodLength, ...periodValues, repeatCount] (see
   rle.ts's encodePeriodicRuns). Both are decoded through the same three pieces of state -
   patternstart${suffix} (where the held value(s) begin), patternlen${suffix} (how many values to
   cycle through, 1 for a plain run), and patternpos${suffix} (position within that cycle) - so
   the decoded value is always just arr[patternstart+patternpos], cycling patternpos back to 0
   every patternlen ticks.

   The pattern-branch state (and the extra variable declarations it needs, see
   constructBodyOfFile) is only emitted when usesPattern is true - it's a fixed code-size cost, so
   a track/tempo-curve encodeRuns didn't find a periodic win for keeps the plain two-variable
   decode instead of paying for pattern support it doesn't use. */
function emitDecodeBlock(valueVar: string, suffix: string, arrName: string, usesPattern: boolean): string[] {
    let lines: string[] = [];
    if (usesPattern) {
        lines.push("if (remain" + suffix + " <= 0) {\n");
        lines.push("    if (" + arrName + "[idx" + suffix + "] == " + PATTERN_MARK + ") {\n");
        lines.push("        patternlen" + suffix + " = " + arrName + "[idx" + suffix + "+1];\n");
        lines.push("        patternstart" + suffix + " = idx" + suffix + "+2;\n");
        lines.push("        idx" + suffix + " += 2;\n");
        lines.push("        idx" + suffix + " += patternlen" + suffix + ";\n");
        lines.push("        remain" + suffix + " = " + arrName + "[idx" + suffix + "];\n");
        lines.push("        remain" + suffix + " *= patternlen" + suffix + ";\n");
        lines.push("        idx" + suffix + " += 1;\n");
        lines.push("    } else {\n");
        lines.push("        patternlen" + suffix + " = 1;\n");
        lines.push("        patternstart" + suffix + " = idx" + suffix + ";\n");
        lines.push("        remain" + suffix + " = " + arrName + "[idx" + suffix + "+1];\n");
        lines.push("        idx" + suffix + " += 2;\n");
        lines.push("    }\n");
        lines.push("    patternpos" + suffix + " = 0;\n");
        lines.push("    if (idx" + suffix + " >= tracklen" + suffix + ") { idx" + suffix + " = 0; }\n");
        lines.push("}\n");
        lines.push(valueVar + " = " + arrName + "[patternstart" + suffix + "+patternpos" + suffix + "];\n");
        lines.push("patternpos" + suffix + " += 1;\n");
        lines.push("if (patternpos" + suffix + " >= patternlen" + suffix + ") { patternpos" + suffix + " = 0; }\n");
        lines.push("remain" + suffix + " -= 1;\n");
    } else {
        lines.push("if (remain" + suffix + " <= 0) {\n");
        lines.push("    " + valueVar + " = " + arrName + "[idx" + suffix + "];\n");
        lines.push("    remain" + suffix + " = " + arrName + "[idx" + suffix + "+1];\n");
        lines.push("    idx" + suffix + " += 2;\n");
        lines.push("    if (idx" + suffix + " >= tracklen" + suffix + ") { idx" + suffix + " = 0; }\n");
        lines.push("}\n");
        lines.push("remain" + suffix + " -= 1;\n");
    }
    return lines;
}

/* usesPattern has one entry per note track (index 0..needed-1) plus one trailing entry
   (usesPattern[needed]) for the tempo pseudo-track - see createDbLines' caller in
   processing.ts's generateScript, which always appends the tempo curve as the last named track. */
function constructLoopBlocks(needed:number, usesPattern:boolean[]) {
    let noteblocks:string[] = [];
    /* Tempo is decoded and applied first each tick, in the same relative position the old literal
       `tempo(N)` call used to occupy at the top of main() - just data-driven now instead of a
       fixed constant, so playback speed can actually follow a mid-song tempo change instead of
       using whatever the first tempo happened to be for the whole song. */
    noteblocks.push("    // Tempo\n");
    noteblocks = noteblocks.concat(emitDecodeBlock("curtempo", "tempo", "temposeq", usesPattern[needed]));
    noteblocks.push("tempo(curtempo);\n");
    noteblocks.push("\n");

    for (let i = 0; i < needed; i++) {
        noteblocks.push("    // Track " + i + "\n");
        noteblocks = noteblocks.concat(emitDecodeBlock("note" + i, String(i), "track" + i, usesPattern[i]));
        noteblocks.push("note = 2;\n");
        noteblocks.push("fpwr note,(note" + i + "/12);\n");
        noteblocks.push("note /= 100;\n");
        noteblocks.push("chpitch " + i + ",note;\n");
        noteblocks.push("\n");
    }
    return noteblocks;
}
function constructBodyOfFile(numberOfTracks:number, waveforms:WaveformId[], usesPattern:boolean[]) {
    let file:string[] = [];
    file.push("// Get track lengths\n");
    for (let i = 0; i < numberOfTracks; i++) {
        file.push("tracklen" + i + " = strlen(track" + i + ");\n");
    }
    file.push("tracklentempo = strlen(temposeq);\n");
    file.push("\n");
    file.push("void main()\n");
    file.push("{\n");
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
    if (usesPattern[numberOfTracks]) {
        file.push("float curtempo, idxtempo, remaintempo, tracklentempo"
            + ", patternlentempo, patternstarttempo, patternpostempo;\n");
    } else {
        file.push("float curtempo, idxtempo, remaintempo, tracklentempo;\n");
    }
    file.push("float time, timestamp;\n");
    file.push("\n");
    for (let i = 0; i < waveforms.length; i++) {
        file.push("string wave" + i + ",\"" + WAVEFORM_PATHS[waveforms[i]] + "\";\n");
    }
    file.push("\n");
    return file;
}
function createFileString(dblinesin:string[][], usesPattern:boolean[], waveforms:WaveformId[], volumes:number[]) {
    let file = createWaveChannelBlocks(volumes);
    let numberOfTracks = dblinesin.length - 1; // last entry is always the tempo pseudo-track
    file = file.concat(constructBodyOfFile(numberOfTracks, waveforms, usesPattern));
    for (let dbline of dblinesin) {
        file = file.concat(dbline);
        file.push("\n");
    }

    return file;
}

export {createDbLines as CreateDBLines, createFileString as CreateFileString};
export type {NamedTrack};
