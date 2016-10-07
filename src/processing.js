"use strict";
var midiparse = require("midi-file-parser");
var utilityfunctions_1 = require("./utilityfunctions");
function parsethefile(midi) {
    var midicontent = midiparse(midi);
    var tempo = utilityfunctions_1.GetTempo(midicontent);
    var dblines = utilityfunctions_1.CreateDBLines(utilityfunctions_1.getnotes(midicontent));
    var file = utilityfunctions_1.CreateFileString(dblines, tempo);
    var download = require("downloadjs");
    download(file.join(""), "songtest.txt", "text/plain");
    console.log("AAAAAAA");
}
//# sourceMappingURL=processing.js.map