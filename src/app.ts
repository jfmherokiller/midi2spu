
import {parsethefile} from "./processing"
window.onload = () => {
    document.getElementById("file").addEventListener("change", readFile, false);

    function readFile(evt) {
        let files = evt.target.files;
        let file = files[0];
        let reader = new FileReader();
        reader.addEventListener("load", () => {
            parsethefile(reader.result);
        });
        reader.readAsBinaryString(file);
    }
};