///<reference path="../typings/globals/node/index.d.ts" />
import {Midifile} from "./MidiFile";
import {getnotes, CreateDBLines, GetTempo, CreateFileString} from "./utilityfunctions";

function parsethefile(midi: string) {
    let midicontent = new Midifile(midi);
    let tempo = GetTempo(midicontent);
    let dblines: string[][] = CreateDBLines(getnotes(midicontent));
    let file = CreateFileString(dblines, tempo);
    let download = require("downloadjs");
    download(file.join(""), "songtest.txt", "text/plain");
    console.log("AAAAAAA");
}
export {parsethefile}