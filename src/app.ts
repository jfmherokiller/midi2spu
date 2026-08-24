import {convertMidi, ConversionResult} from "./processing"
import {downloadTextFile} from "./download"
import {ZspuPlayer} from "./player"

window.onload = () => {
    const fileInput = document.getElementById("file")! as HTMLInputElement;
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

    fileInput.addEventListener("change", async () => {
        const file = fileInput.files?.[0];
        if (!file) return;

        player?.stop();
        setPlaying(false);

        const buffer = await file.arrayBuffer();
        result = convertMidi(buffer);
        player = new ZspuPlayer(result.tracks, result.tempo);
        player.onEnded = () => setPlaying(false);

        controls.style.display = "";
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
