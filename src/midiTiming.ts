/* A MIDI file's time division is either PPQN (ticks per quarter note - the vast majority of real
   files, tempo-relative) or SMPTE (frames/ticks-per-frame - a fixed real-time clock, no beat or
   tempo concept at all, used for film/video sync). MidiFile.ts decodes the header's time-division
   field into one of these two shapes instead of assuming PPQN and throwing on SMPTE. */
export type MidiDivision =
    | { type: "ppqn"; ticksPerBeat: number }
    | { type: "smpte"; framesPerSecond: number; ticksPerFrame: number };

/* SMPTE-timed files have no equivalent of STEPS_PER_BEAT to quantize against (no beats exist) -
   this is the same idea applied to real time instead. Chosen so it matches PPQN's resolution at a
   common 120bpm: STEPS_PER_BEAT(10) * 120bpm / 60s = 20 steps/sec exactly - not a spec value,
   just a reasonable resolution consistent with the rest of this project's quantization. */
export const SMPTE_STEPS_PER_SECOND = 20;

/* Converts an elapsed tick count to elapsed (fractional) output steps - shared by getnotes() and
   getTempoTrack() so both use the identical timing model regardless of which kind of file this
   is. stepsPerBeat is passed in rather than imported to keep this module free of any dependency
   on midiExtract.ts's own constants. */
export function ticksToStepsFloat(division: MidiDivision, stepsPerBeat: number, deltaTicks: number): number {
    if (division.type === "ppqn") {
        return (deltaTicks / division.ticksPerBeat) * stepsPerBeat;
    }
    return (deltaTicks / division.ticksPerFrame / division.framesPerSecond) * SMPTE_STEPS_PER_SECOND;
}
