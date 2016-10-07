///<reference path="../typings/globals/node/index.d.ts" />
import {Midi} from "./MidiType";
var midiparse = require("midi-file-parser");
import {getnotes, CreateDBLines, GetTempo, CreateFileString} from "./utilityfunctions";

function parsethefile(midi: string) {
    let midicontent: Midi = midiparse(midi) as Midi;
    let tempo = GetTempo(midicontent);
    let dblines: string[][] = CreateDBLines(getnotes(midicontent));
    let file = CreateFileString(dblines, tempo);
    let download = require("downloadjs");
    download(file.join(""), "songtest.txt", "text/plain");
    console.log("AAAAAAA");
}
export {parsethefile}