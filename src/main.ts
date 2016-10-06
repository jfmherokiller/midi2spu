/**
 * Created by jfmmeyers on 9/13/16.
 */
import {Midi} from "./MidiType";
var midiparse = require("../node_modules/midi-file-parser");
import {getnotes,CreateDBLines,GetTempo,CreateFileString} from "./utilityfunctions";
require("fs").readFile('C:/Users/peter/Google Drive/Public/midi/30064_Always-With-Me.mid', 'binary', parsethefile);
function parsethefile(err: NodeJS.ErrnoException, midi:string)
{
    let midicontent:Midi = midiparse(midi) as Midi;
    let tempo = GetTempo(midicontent);
    let dblines:string[][] = CreateDBLines(getnotes(midicontent));
    let file = CreateFileString(dblines,tempo);
    require("fs").writeFileSync("songtest.txt",file.join(""));
    console.log("AAAAAAA");
}












