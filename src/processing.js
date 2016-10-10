"use strict";
///<reference path="../typings/globals/node/index.d.ts" />
var MidiFile_1 = require("./MidiFile");
var utilityfunctions_1 = require("./utilityfunctions");
function parsethefile(midi) {
    var midicontent = new MidiFile_1.Midifile(midi);
    var tempo = utilityfunctions_1.GetTempo(midicontent);
    var dblines = utilityfunctions_1.CreateDBLines(utilityfunctions_1.getnotes(midicontent));
    var file = utilityfunctions_1.CreateFileString(dblines, tempo);
    var download = require("downloadjs");
    download(file.join(""), "songtest.txt", "text/plain");
    console.log("AAAAAAA");
}
exports.parsethefile = parsethefile;
//# sourceMappingURL=processing.js.map