import {Midifile} from "./MidiFile";
import {getnotes, CreateDBLines, GetTempo, CreateFileString} from "./utilityfunctions";

export interface ConversionResult {
    tracks: number[][];
    tempo: number;
    scriptText: string;
}

export function convertMidi(midi: ArrayBuffer): ConversionResult {
    let midicontent = new Midifile(midi);
    let tempo = GetTempo(midicontent);
    let tracks = getnotes(midicontent);
    let dblines: string[][] = CreateDBLines(tracks.map(track => track.slice()));
    let file = CreateFileString(dblines, tempo);
    return {tracks, tempo, scriptText: file.join("")};
}
