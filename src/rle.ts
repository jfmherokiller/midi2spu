/* Sentinel note value marking a periodic-pattern block header in the RLE stream (see
   encodePeriodicRuns). Never a real note: -1 is already the plain-rest sentinel, and real MIDI
   note numbers are never negative. */
export const PATTERN_MARK = -2;

/* Patterns longer than this rarely earn back their own header cost, and letting the greedy
   search in encodePeriodicRuns range higher occasionally produces a worse split at a given
   position (confirmed empirically) - encodeRuns' plain-vs-periodic fallback catches that case
   regardless, this cap just keeps the common case efficient. */
const MAX_PATTERN_PERIOD = 32;

/* Collapses a per-step array into flat [note,count, note,count, ...] run-length pairs. Most held
   notes span many consecutive steps at STEPS_PER_BEAT quantization, so this compresses heavily
   (measured 7-9x on real songs) - see scriptGen.ts's constructLoopBlocks for how the generated
   script decodes this back into a per-tick value. */
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

/* Measured directly from scriptGen.ts's constructLoopBlocks/constructBodyOfFile output: the extra
   decode-loop code (the PATTERN_MARK branch + patternpos/patternlen bookkeeping) plus the 3 extra
   variable declarations a pattern-enabled track needs, versus the plain two-variable decode. This
   is a fixed per-track cost paid once a track uses even one pattern block - not worth it unless
   the data saved in that track's own `db` text is bigger than this. */
const PATTERN_CODE_OVERHEAD_CHARS = 463;

/* Mirrors scriptGen.ts's createDbLines' actual `db value, value, ...;\n` chunking (32 values/line)
   closely enough to compare two encodings' real exported-text size - used by encodeRuns to decide
   if a periodic encoding's data savings are worth its fixed per-track code cost (see
   PATTERN_CODE_OVERHEAD_CHARS). */
function estimateDbTextLength(tokens: number[]): number {
    let chars = 0;
    let remaining = tokens.slice();
    while (remaining.length) {
        chars += ("db " + remaining.splice(0, 32).join(", ") + ";\n").length;
    }
    return chars;
}

/* Encodes one track's per-step values for export. encodePeriodicRuns' greedy search can, on rare
   splits, end up longer overall than plain run-length encoding despite never losing locally, and
   even when it IS shorter in raw token count, using it at all costs a fixed amount of extra
   decode-loop code (PATTERN_CODE_OVERHEAD_CHARS) that a track with only a small periodic win
   doesn't earn back - found by comparing generated output size before/after on real files: a
   file with many tracks and little periodic structure got *bigger* despite the RLE token count
   going down, because most tracks paid the code cost for a few tokens of savings. So this always
   computes both, and only picks periodic if its *exported text*, overhead included, is actually
   smaller. scriptGen.ts's constructLoopBlocks decode loop handles both formats per-track (see
   usesPattern), so callers don't need to know which one was used for any given track. */
function encodeRuns(track: number[]): number[] {
    const plain = encodePlainRuns(track);
    const periodic = encodePeriodicRuns(track);
    if (!periodic.includes(PATTERN_MARK)) return plain;
    const periodicTotal = estimateDbTextLength(periodic) + PATTERN_CODE_OVERHEAD_CHARS;
    return periodicTotal < estimateDbTextLength(plain) ? periodic : plain;
}

export {encodeRuns};
