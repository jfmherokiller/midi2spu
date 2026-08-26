import {Midifile} from "./MidiFile";
import {getnotes, getTempoTrack} from "./midiExtract";
import {CreateDBLines, CreateFileString} from "./scriptGen";
import {WaveformId} from "./midiConstants";

export interface Song {
    tracks: number[][];
    /* One scaled-BPM value per output step (see midiExtract.ts's getTempoTrack), not a single
       constant - a MIDI file can change tempo mid-song, and the exported script/live preview both
       need to follow that rather than playing the whole thing at whatever the first tempo was. */
    tempoTrack: number[];
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
    let {tracks, isPercussion} = getnotes(midicontent);
    let totalSteps = Math.max(0, ...tracks.map(track => track.length));
    let tempoTrack = getTempoTrack(midicontent, totalSteps);
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
    return {tracks, tempoTrack, waveforms, volumes, muted, solo, isPercussion, warnings};
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
        tempoTrack: song.tempoTrack,
        waveforms: audibleIndexes.map(i => song.waveforms[i]),
        volumes: audibleIndexes.map(i => song.volumes[i]),
        muted: audibleIndexes.map(() => false),
        solo: audibleIndexes.map(() => false),
        isPercussion: audibleIndexes.map(i => song.isPercussion[i]),
        warnings: song.warnings,
    };
}

/* Fallback scaled-BPM (120 BPM * STEPS_PER_BEAT) if a song's tempo curve is ever empty - can't
   actually happen when there's at least one audible track (getTempoTrack always produces at least
   as many entries as the longest track in the original song, and an audible track is always a
   subset of that), but kept as a defensive default rather than risking a 0/undefined tempo. */
const FALLBACK_SCALED_BPM = 1200;

export function generateScript(song: Song): string {
    const audible = getAudibleSong(song);
    if (audible.tracks.length === 0) {
        return "// No audible tracks - unmute or un-solo at least one track before exporting.\n";
    }
    /* The tempo curve is computed once from the *original* song's longest track (see loadMidi),
       so muting/soloing down to a shorter set of audible tracks can leave it longer than
       CreateDBLines' own per-track padding would produce - truncate/hold-pad it to exactly match
       here, since createDbLines' generic -1 padding is only meaningful for note tracks (silence),
       not tempo. */
    const maxLength = Math.max(0, ...audible.tracks.map(track => track.length));
    const lastTempo = audible.tempoTrack.length > 0
        ? audible.tempoTrack[audible.tempoTrack.length - 1]
        : FALLBACK_SCALED_BPM;
    let tempoValues = audible.tempoTrack.slice(0, maxLength);
    while (tempoValues.length < maxLength) {
        tempoValues.push(lastTempo);
    }

    const namedTracks = audible.tracks.map((values, i) => ({name: "track" + i, values}));
    namedTracks.push({name: "temposeq", values: tempoValues});

    let {dblines, usesPattern} = CreateDBLines(namedTracks);
    let file = CreateFileString(dblines, usesPattern, audible.waveforms, audible.volumes);
    return file.join("");
}
