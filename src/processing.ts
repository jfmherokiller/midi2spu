import {Midifile} from "./MidiFile";
import {getnotes, CreateDBLines, GetTempo, CreateFileString} from "./utilityfunctions";
import {downloadTextFile} from "./download";

function parsethefile(midi: ArrayBuffer) {
    let midicontent = new Midifile(midi);
    let tempo = GetTempo(midicontent);
    let dblines: string[][] = CreateDBLines(getnotes(midicontent));
    let file = CreateFileString(dblines, tempo);
    downloadTextFile(file.join(""), "songtest.txt", "text/plain");
}
export {parsethefile}