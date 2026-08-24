import {convertMidi, ConversionResult} from "./processing"
import {downloadTextFile} from "./download"
import {ZspuPlayer} from "./player"

window.onload = () => {
    const fileInput = document.getElementById("file")! as HTMLInputElement;
    const dropzone = document.getElementById("dropzone")!;
    const controls = document.getElementById("controls")!;
    const playButton = document.getElementById("play")! as HTMLButtonElement;
    const stopButton = document.getElementById("stop")! as HTMLButtonElement;
    const downloadButton = document.getElementById("download")! as HTMLButtonElement;

    let result: ConversionResult | null = null;
    let player: ZspuPlayer | null = null;

    function setPlaying(playing: boolean) {
        playButton.disabled = playing;
        stopButton.disabled = !playing;
    }

    async function loadFile(file: File) {
        player?.stop();
        setPlaying(false);

        const buffer = await file.arrayBuffer();
        result = convertMidi(buffer);
        player = new ZspuPlayer(result.tracks, result.tempo);
        player.onEnded = () => setPlaying(false);

        controls.style.display = "";
    }

    fileInput.addEventListener("change", () => {
        const file = fileInput.files?.[0];
        if (file) loadFile(file);
    });

    // Prevent stray drops anywhere on the page from navigating away to the dropped file.
    window.addEventListener("dragover", evt => evt.preventDefault());
    window.addEventListener("drop", evt => evt.preventDefault());

    dropzone.addEventListener("dragover", evt => {
        evt.preventDefault();
        dropzone.classList.add("dragover");
    });
    dropzone.addEventListener("dragleave", () => {
        dropzone.classList.remove("dragover");
    });
    dropzone.addEventListener("drop", evt => {
        evt.preventDefault();
        dropzone.classList.remove("dragover");
        const file = evt.dataTransfer?.files?.[0];
        if (file) loadFile(file);
    });

    playButton.addEventListener("click", () => {
        if (!player) return;
        setPlaying(true);
        player.play();
    });

    stopButton.addEventListener("click", () => {
        player?.stop();
        setPlaying(false);
    });

    downloadButton.addEventListener("click", () => {
        if (!result) return;
        downloadTextFile(result.scriptText, "songtest.txt", "text/plain");
    });
};
