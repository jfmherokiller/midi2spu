import {Midifile} from "./MidiFile";
import {getnotes, getTempo} from "./midiExtract";
import {CreateDBLines, CreateFileString} from "./scriptGen";
import {WaveformId} from "./midiConstants";

export interface Song {
    tracks: number[][];
    tempo: number;
    waveforms: WaveformId[];
    volumes: number[];
    muted: boolean[];
    solo: boolean[];
    isPercussion: boolean[];
    warnings: string[];
}

const DEFAULT_VOLUME = 0.5;

export function loadMidi(midi: ArrayBuffer): Song {
    let midicontent = new Midifile(midi);
    let tempo = getTempo(midicontent);
    let {tracks, isPercussion} = getnotes(midicontent);
    let waveforms: WaveformId[] = tracks.map((_, i) => isPercussion[i] ? "noise" : "sine");
    let volumes: number[] = tracks.map(() => DEFAULT_VOLUME);
    let muted: boolean[] = tracks.map(() => false);
    let solo: boolean[] = tracks.map(() => false);
    let warnings: string[] = [];
    /* Format 2 tracks are independent patterns meant to be triggered on demand (drum-machine-
       style pattern banks), not concatenated into one linear song - this whole app's export model
       (every track loops forever, simultaneously, from step 0) doesn't map onto "play pattern 1,
       then pattern 2" in any single obviously-correct way, and format-2 files are effectively
       nonexistent for this project's real use case (confirmed via a full survey of the user's
       ~2,788-file collection - zero format-2 files found). So this doesn't attempt real sequential
       playback - it surfaces a warning instead of silently producing a likely-wrong result. */
    if (midicontent.header.formatType === 2) {
        warnings.push("Format 2 (sequential pattern) file - tracks will be treated as playing "
            + "simultaneously, which is likely wrong for this file type.");
    }
    return {tracks, tempo, waveforms, volumes, muted, solo, isPercussion, warnings};
}

/* A track is audible (plays back / exports) if it isn't muted, and - if any track is soloed -
   it's one of the soloed ones. Explicit mute always wins over solo (standard DAW convention). */
export function isTrackAudible(song: Song, index: number): boolean {
    if (song.muted[index]) return false;
    const anySoloed = song.solo.some(s => s);
    return !anySoloed || song.solo[index];
}

/* A copy of `song` containing only audible tracks (and their matching waveforms/volumes),
   reindexed - this is what actually gets played back or exported, so a muted/soloed-out track
   never reaches the output. `tracks`/`waveforms`/`volumes` are shallow-copied (not deep-cloned);
   don't mutate the returned arrays' contents expecting it to affect the original song. */
export function getAudibleSong(song: Song): Song {
    const audibleIndexes = song.tracks.map((_, i) => i).filter(i => isTrackAudible(song, i));
    return {
        tracks: audibleIndexes.map(i => song.tracks[i]),
        tempo: song.tempo,
        waveforms: audibleIndexes.map(i => song.waveforms[i]),
        volumes: audibleIndexes.map(i => song.volumes[i]),
        muted: audibleIndexes.map(() => false),
        solo: audibleIndexes.map(() => false),
        isPercussion: audibleIndexes.map(i => song.isPercussion[i]),
        warnings: song.warnings,
    };
}

export function generateScript(song: Song): string {
    const audible = getAudibleSong(song);
    if (audible.tracks.length === 0) {
        return "// No audible tracks - unmute or un-solo at least one track before exporting.\n";
    }
    let {dblines, usesPattern} = CreateDBLines(audible.tracks);
    let file = CreateFileString(dblines, usesPattern, audible.tempo, audible.waveforms, audible.volumes);
    return file.join("");
}
