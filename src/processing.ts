import {Midifile} from "./MidiFile";
import {getnotes, CreateDBLines, GetTempo, CreateFileString, WaveformId} from "./utilityfunctions";

export interface Song {
    tracks: number[][];
    tempo: number;
    waveforms: WaveformId[];
    volumes: number[];
}

const DEFAULT_VOLUME = 0.5;

export function loadMidi(midi: ArrayBuffer): Song {
    let midicontent = new Midifile(midi);
    let tempo = GetTempo(midicontent);
    let tracks = getnotes(midicontent);
    let waveforms: WaveformId[] = tracks.map(() => "sine");
    let volumes: number[] = tracks.map(() => DEFAULT_VOLUME);
    return {tracks, tempo, waveforms, volumes};
}

export function generateScript(song: Song): string {
    let dblines: string[][] = CreateDBLines(song.tracks.map(track => track.slice()));
    let file = CreateFileString(dblines, song.tempo, song.waveforms, song.volumes);
    return file.join("");
}
