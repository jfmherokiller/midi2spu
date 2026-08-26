
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

/* Sentinel note value marking a periodic-pattern block header in the RLE stream (see
   encodePeriodicRuns). Never a real note: -1 is already the plain-rest sentinel, and real MIDI
   note numbers are never negative. */
const PATTERN_MARK = -2;

/* Patterns longer than this rarely earn back their own header cost, and letting the greedy
   search in encodePeriodicRuns range higher occasionally produces a worse split at a given
   position (confirmed empirically) - encodeRuns' plain-vs-periodic fallback catches that case
   regardless, this cap just keeps the common case efficient. */
const MAX_PATTERN_PERIOD = 32;

/* Collapses a per-step array into flat [note,count, note,count, ...] run-length pairs. Most held
   notes span many consecutive steps at STEPS_PER_BEAT quantization, so this compresses heavily
   (measured 7-9x on real songs) - see constructLoopBlocks for how the generated script decodes
   this back into a per-tick note value. */
function encodePlainRuns(track: number[]): number[] {
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

/* Plain run-length encoding does nothing for a short repeating sequence (e.g. a 4-step arpeggio
   [2,-1,3,33,2,-1,3,33,...]) - since no single value repeats, every step becomes its own
   [note,1] pair, roughly doubling the raw size instead of shrinking it. This extends the same
   idea to short repeating sequences: at each position, also try every period 2..
   MAX_PATTERN_PERIOD, and if a period repeats at least twice, consider encoding it as a single
   [PATTERN_MARK, periodLength, ...periodValues, repeatCount] block instead of one plain run per
   step. Picks whichever candidate (plain run, or one of the periods) covers the most ticks per
   encoded value at that position - greedy, not globally optimal (a locally-best choice can
   occasionally leave a worse split for what follows), which is why encodeRuns below always
   falls back to the plain encoding if this one didn't actually end up shorter overall. */
function encodePeriodicRuns(track: number[]): number[] {
    let out: number[] = [];
    let i = 0;
    const n = track.length;
    while (i < n) {
        let runCount = 1;
        while (i + runCount < n && track[i + runCount] === track[i]) {
            runCount++;
        }
        let bestCost = 2, bestTicks = runCount, bestPeriod = 1, bestRepeat = runCount;

        const maxPeriod = Math.min(MAX_PATTERN_PERIOD, n - i);
        for (let period = 2; period <= maxPeriod; period++) {
            let repeat = 0;
            let k = i;
            while (k + period <= n) {
                let matches = true;
                for (let j = 0; j < period; j++) {
                    if (track[k + j] !== track[i + j]) {
                        matches = false;
                        break;
                    }
                }
                if (!matches) break;
                repeat++;
                k += period;
            }
            if (repeat < 2) continue; // needs to repeat at least twice to be worth its own header
            const ticksCovered = period * repeat;
            const cost = period + 3; // PATTERN_MARK, periodLength, ...periodValues, repeatCount
            if (ticksCovered / cost > bestTicks / bestCost) {
                bestCost = cost;
                bestTicks = ticksCovered;
                bestPeriod = period;
                bestRepeat = repeat;
            }
        }

        if (bestPeriod === 1) {
            out.push(track[i], bestRepeat);
        } else {
            out.push(PATTERN_MARK, bestPeriod, ...track.slice(i, i + bestPeriod), bestRepeat);
        }
        i += bestTicks;
    }
    return out;
}

/* Measured directly from constructLoopBlocks/constructBodyOfFile's output: the extra decode-loop
   code (the PATTERN_MARK branch + patternpos/patternlen bookkeeping) plus the 3 extra variable
   declarations a pattern-enabled track needs, versus the plain two-variable decode. This is a
   fixed per-track cost paid once a track uses even one pattern block - not worth it unless the
   data saved in that track's own `db` text is bigger than this. */
const PATTERN_CODE_OVERHEAD_CHARS = 463;

/* Mirrors createDbLines' actual `db value, value, ...;\n` chunking (32 values/line) closely
   enough to compare two encodings' real exported-text size - used by encodeRuns to decide if a
   periodic encoding's data savings are worth its fixed per-track code cost (see
   PATTERN_CODE_OVERHEAD_CHARS). */
function estimateDbTextLength(tokens: number[]): number {
    let chars = 0;
    let remaining = tokens.slice();
    while (remaining.length) {
        chars += ("db " + remaining.splice(0, 32).join(", ") + ";\n").length;
    }
    return chars;
}

/* Encodes one track's per-step notes for export. encodePeriodicRuns' greedy search can, on rare
   splits, end up longer overall than plain run-length encoding despite never losing locally, and
   even when it IS shorter in raw token count, using it at all costs a fixed amount of extra
   decode-loop code (PATTERN_CODE_OVERHEAD_CHARS) that a track with only a small periodic win
   doesn't earn back - found by comparing generated output size before/after on real files: a
   file with many tracks and little periodic structure got *bigger* despite the RLE token count
   going down, because most tracks paid the code cost for a few tokens of savings. So this always
   computes both, and only picks periodic if its *exported text*, overhead included, is actually
   smaller. constructLoopBlocks' decode loop handles both formats per-track (see usesPattern), so
   callers don't need to know which one was used for any given track. */
function encodeRuns(track: number[]): number[] {
    const plain = encodePlainRuns(track);
    const periodic = encodePeriodicRuns(track);
    if (!periodic.includes(PATTERN_MARK)) return plain;
    const periodicTotal = estimateDbTextLength(periodic) + PATTERN_CODE_OVERHEAD_CHARS;
    return periodicTotal < estimateDbTextLength(plain) ? periodic : plain;
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
   encodePeriodicRuns). Both are decoded through the same three pieces of state -
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
export {getnotes, createDbLines as CreateDBLines, getTempo as GetTempo, createFileString as CreateFileString}