"use strict";
var midiparse = require("../node_modules/midi-file-parser");
var utilityfunctions_1 = require("./utilityfunctions");
require("fs").readFile('C:/Users/peter/Google Drive/Public/midi/30064_Always-With-Me.mid', 'binary', parsethefile);
function parsethefile(err, midi) {
    var midicontent = midiparse(midi);
    var tempo = utilityfunctions_1.GetTempo(midicontent);
    var dblines = utilityfunctions_1.CreateDBLines(utilityfunctions_1.getnotes(midicontent));
    var file = utilityfunctions_1.CreateFileString(dblines, tempo);
    require("fs").writeFileSync("songtest.txt", file.join(""));
    console.log("AAAAAAA");
}
//# sourceMappingURL=main.js.map