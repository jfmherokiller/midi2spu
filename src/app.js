"use strict";
var processing_1 = require("./processing");
window.onload = function () {
    document.getElementById("file").addEventListener("change", readFile, false);
    function readFile(evt) {
        var files = evt.target.files;
        var file = files[0];
        var reader = new FileReader();
        var preview = new FileReader();
        reader.addEventListener("load", function () {
            processing_1.parsethefile(reader.result);
        });
        reader.readAsBinaryString(file);
    }
};
//# sourceMappingURL=app.js.map