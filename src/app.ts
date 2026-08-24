import "xp.css/dist/XP.css"
import {loadMidi, generateScript, Song} from "./processing"
import {downloadTextFile} from "./download"
import {ZspuPlayer} from "./player"
import {PianoRoll} from "./pianoRoll"

window.onload = () => {
    const fileInput = document.getElementById("file")! as HTMLInputElement;
    const dropzone = document.getElementById("dropzone")!;
    const controls = document.getElementById("controls")!;
    const playButton = document.getElementById("play")! as HTMLButtonElement;
    const stopButton = document.getElementById("stop")! as HTMLButtonElement;
    const downloadButton = document.getElementById("download")! as HTMLButtonElement;
    const copyButton = document.getElementById("copy")! as HTMLButtonElement;
    const volumeSlider = document.getElementById("volume")! as HTMLInputElement;
    const pianoRollWindow = document.getElementById("piano-roll-window")!;
    const pianoRollContainer = document.getElementById("piano-roll")!;

    let song: Song | null = null;
    let player: ZspuPlayer | null = null;

    function setPlaying(playing: boolean) {
        playButton.disabled = playing;
        stopButton.disabled = !playing;
    }

    function stopPlayback() {
        player?.stop();
        setPlaying(false);
    }

    async function loadFile(file: File) {
        stopPlayback();

        const buffer = await file.arrayBuffer();
        song = loadMidi(buffer);

        controls.style.display = "";
        pianoRollWindow.style.display = "";
        const pianoRoll = new PianoRoll(song, pianoRollContainer);
        pianoRoll.onChange = stopPlayback;
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
        if (!song) return;
        player?.stop();
        player = new ZspuPlayer(song.tracks, song.tempo, song.waveforms, song.volumes);
        player.setVolume(volumeSlider.valueAsNumber);
        player.onEnded = () => setPlaying(false);
        setPlaying(true);
        player.play();
    });

    stopButton.addEventListener("click", stopPlayback);

    volumeSlider.addEventListener("input", () => {
        player?.setVolume(volumeSlider.valueAsNumber);
    });

    downloadButton.addEventListener("click", () => {
        if (!song) return;
        downloadTextFile(generateScript(song), "songtest.txt", "text/plain");
    });

    copyButton.addEventListener("click", async () => {
        if (!song) return;
        await navigator.clipboard.writeText(generateScript(song));
        const originalText = copyButton.textContent;
        copyButton.textContent = "Copied!";
        setTimeout(() => {
            copyButton.textContent = originalText;
        }, 1200);
    });
};
