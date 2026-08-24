import {Midifile} from "./MidiFile";
import {getnotes, CreateDBLines, GetTempo, CreateFileString, WaveformId} from "./utilityfunctions";

export interface Song {
    tracks: number[][];
    tempo: number;
    waveforms: WaveformId[];
    volumes: number[];
    muted: boolean[];
    solo: boolean[];
    isPercussion: boolean[];
}

const DEFAULT_VOLUME = 0.5;

export function loadMidi(midi: ArrayBuffer): Song {
    let midicontent = new Midifile(midi);
    let tempo = GetTempo(midicontent);
    let {tracks, isPercussion} = getnotes(midicontent);
    let waveforms: WaveformId[] = tracks.map((_, i) => isPercussion[i] ? "noise" : "sine");
    let volumes: number[] = tracks.map(() => DEFAULT_VOLUME);
    let muted: boolean[] = tracks.map(() => false);
    let solo: boolean[] = tracks.map(() => false);
    return {tracks, tempo, waveforms, volumes, muted, solo, isPercussion};
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
