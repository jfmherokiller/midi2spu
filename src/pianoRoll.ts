import {Song} from "./processing";
import {WaveformId} from "./utilityfunctions";

const STEP_WIDTH = 20;
const ROW_HEIGHT = 16;
const PITCH_PADDING = 3;
const MIN_VISIBLE_SEMITONES = 12;
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const WAVEFORM_OPTIONS: WaveformId[] = ["sine", "square", "saw", "tri"];

function noteName(note: number): string {
    const name = NOTE_NAMES[((note % 12) + 12) % 12];
    const octave = Math.floor(note / 12) - 1;
    return name + octave;
}

class PianoRoll {
    private song: Song;
    private container: HTMLElement;
    private activeTrack = 0;
    private noteBlocksLayer: HTMLElement | null = null;
    private minPitch = 60;
    private maxPitch = 60;
    private dragValue: number | null = null;
    private dragRow: number | null = null;
    onChange?: () => void;

    constructor(song: Song, container: HTMLElement) {
        this.song = song;
        this.container = container;
        this.render();
    }

    private numSteps(): number {
        return Math.max(1, ...this.song.tracks.map(track => track.length));
    }

    private computePitchRange(track: number[]): {min: number; max: number} {
        let min = Infinity, max = -Infinity;
        for (const note of track) {
            if (note === -1) continue;
            if (note < min) min = note;
            if (note > max) max = note;
        }
        if (min === Infinity) {
            min = 60;
            max = 60;
        }
        min -= PITCH_PADDING;
        max += PITCH_PADDING;
        if (max - min < MIN_VISIBLE_SEMITONES) {
            const extra = MIN_VISIBLE_SEMITONES - (max - min);
            min -= Math.ceil(extra / 2);
            max += Math.floor(extra / 2);
        }
        return {min: Math.max(0, min), max: Math.min(127, max)};
    }

    private render() {
        const track = this.song.tracks[this.activeTrack] ?? [];
        const range = this.computePitchRange(track);
        this.minPitch = range.min;
        this.maxPitch = range.max;

        this.container.innerHTML = "";
        const wrapper = document.createElement("div");
        wrapper.className = "piano-roll";
        wrapper.appendChild(this.renderSidebar());
        wrapper.appendChild(this.renderEditor());
        this.container.appendChild(wrapper);
    }

    private renderSidebar(): HTMLElement {
        const sidebar = document.createElement("div");
        sidebar.className = "track-sidebar";

        this.song.tracks.forEach((_, trackIndex) => {
            const row = document.createElement("div");
            row.className = "track-row" + (trackIndex === this.activeTrack ? " active" : "");

            const label = document.createElement("span");
            label.textContent = "Track " + trackIndex;
            label.className = "track-label";
            row.appendChild(label);

            const waveformSelect = document.createElement("select");
            for (const waveform of WAVEFORM_OPTIONS) {
                const option = document.createElement("option");
                option.value = waveform;
                option.textContent = waveform;
                if (this.song.waveforms[trackIndex] === waveform) option.selected = true;
                waveformSelect.appendChild(option);
            }
            waveformSelect.addEventListener("change", () => {
                this.song.waveforms[trackIndex] = waveformSelect.value as WaveformId;
                this.onChange?.();
            });
            waveformSelect.addEventListener("click", evt => evt.stopPropagation());
            row.appendChild(waveformSelect);

            const volumeSlider = document.createElement("input");
            volumeSlider.type = "range";
            volumeSlider.min = "0";
            volumeSlider.max = "1";
            volumeSlider.step = "0.01";
            volumeSlider.value = String(this.song.volumes[trackIndex]);
            volumeSlider.addEventListener("input", () => {
                this.song.volumes[trackIndex] = volumeSlider.valueAsNumber;
                this.onChange?.();
            });
            volumeSlider.addEventListener("click", evt => evt.stopPropagation());
            row.appendChild(volumeSlider);

            row.addEventListener("click", () => {
                if (this.activeTrack === trackIndex) return;
                this.activeTrack = trackIndex;
                this.render();
            });

            sidebar.appendChild(row);
        });

        return sidebar;
    }

    private renderEditor(): HTMLElement {
        const editor = document.createElement("div");
        editor.className = "piano-editor";

        const numSteps = this.numSteps();
        const rowCount = this.maxPitch - this.minPitch + 1;
        const gridWidth = numSteps * STEP_WIDTH;
        const gridHeight = rowCount * ROW_HEIGHT;

        // Deliberately not width-bound to gridWidth (which can be tens of thousands of px for a
        // long track) - an explicit oversized width here would overflow every unconstrained
        // ancestor and blow out the whole page's layout width instead of just this element
        // scrolling. Known limitation: the ruler doesn't scroll in sync with the grid below it.
        const ruler = document.createElement("div");
        ruler.className = "piano-ruler";
        ruler.style.height = "16px";
        ruler.style.backgroundImage =
            `repeating-linear-gradient(to right, #888 0, #888 1px, transparent 1px, transparent ${STEP_WIDTH * 10}px)`;

        const scrollArea = document.createElement("div");
        scrollArea.className = "piano-scroll-area";

        const keys = document.createElement("div");
        keys.className = "piano-keys";
        keys.style.width = "40px";
        keys.style.height = gridHeight + "px";
        for (let row = 0; row < rowCount; row++) {
            const pitch = this.maxPitch - row;
            const key = document.createElement("div");
            key.className = "piano-key";
            key.style.height = ROW_HEIGHT + "px";
            key.textContent = noteName(pitch);
            keys.appendChild(key);
        }

        const grid = document.createElement("div");
        grid.className = "piano-grid";
        grid.style.width = gridWidth + "px";
        grid.style.height = gridHeight + "px";
        grid.style.backgroundImage = [
            `repeating-linear-gradient(to right, #ccc 0, #ccc 1px, transparent 1px, transparent ${STEP_WIDTH}px)`,
            `repeating-linear-gradient(to bottom, #ccc 0, #ccc 1px, transparent 1px, transparent ${ROW_HEIGHT}px)`,
            `repeating-linear-gradient(to right, #999 0, #999 1px, transparent 1px, transparent ${STEP_WIDTH * 10}px)`,
        ].join(", ");

        const noteBlocksLayer = document.createElement("div");
        noteBlocksLayer.className = "note-blocks";
        this.noteBlocksLayer = noteBlocksLayer;
        grid.appendChild(noteBlocksLayer);
        this.refreshNoteBlocks();

        grid.addEventListener("mousedown", evt => this.onGridMouseDown(evt, grid));
        grid.addEventListener("mousemove", evt => this.onGridMouseMove(evt, grid));
        window.addEventListener("mouseup", () => this.onGridMouseUp());

        scrollArea.appendChild(keys);
        scrollArea.appendChild(grid);

        editor.appendChild(ruler);
        editor.appendChild(scrollArea);
        return editor;
    }

    private gridPositionFromEvent(evt: MouseEvent, grid: HTMLElement): {step: number; row: number} | null {
        const rect = grid.getBoundingClientRect();
        const x = evt.clientX - rect.left;
        const y = evt.clientY - rect.top;
        const step = Math.floor(x / STEP_WIDTH);
        const row = Math.floor(y / ROW_HEIGHT);
        const rowCount = this.maxPitch - this.minPitch + 1;
        if (step < 0 || row < 0 || row >= rowCount) return null;
        return {step, row};
    }

    private onGridMouseDown(evt: MouseEvent, grid: HTMLElement) {
        const pos = this.gridPositionFromEvent(evt, grid);
        if (!pos) return;
        const pitch = this.maxPitch - pos.row;
        const track = this.song.tracks[this.activeTrack] ?? [];
        const currentValue = track[pos.step] ?? -1;
        this.dragValue = currentValue === pitch ? -1 : pitch;
        this.dragRow = pos.row;
        this.setNote(pos.step, this.dragValue);
    }

    private onGridMouseMove(evt: MouseEvent, grid: HTMLElement) {
        if (this.dragValue === null || this.dragRow === null) return;
        const pos = this.gridPositionFromEvent(evt, grid);
        if (!pos || pos.row !== this.dragRow) return;
        this.setNote(pos.step, this.dragValue);
    }

    private onGridMouseUp() {
        this.dragValue = null;
        this.dragRow = null;
    }

    private setNote(step: number, value: number) {
        const track = this.song.tracks[this.activeTrack];
        while (track.length <= step) {
            track.push(-1);
        }
        if (track[step] === value) return;
        track[step] = value;
        this.refreshNoteBlocks();
        this.onChange?.();
    }

    private refreshNoteBlocks() {
        if (!this.noteBlocksLayer) return;
        this.noteBlocksLayer.innerHTML = "";
        const track = this.song.tracks[this.activeTrack] ?? [];

        let runStart = -1;
        let runNote = -1;
        const flushRun = (endExclusive: number) => {
            if (runStart === -1 || runNote === -1) return;
            if (runNote < this.minPitch || runNote > this.maxPitch) return;
            const row = this.maxPitch - runNote;
            const block = document.createElement("div");
            block.className = "note-block";
            block.style.left = (runStart * STEP_WIDTH) + "px";
            block.style.top = (row * ROW_HEIGHT) + "px";
            block.style.width = ((endExclusive - runStart) * STEP_WIDTH) + "px";
            block.style.height = ROW_HEIGHT + "px";
            block.textContent = noteName(runNote);
            this.noteBlocksLayer!.appendChild(block);
        };

        for (let i = 0; i < track.length; i++) {
            const note = track[i];
            if (note !== runNote) {
                flushRun(i);
                runStart = note === -1 ? -1 : i;
                runNote = note;
            }
        }
        flushRun(track.length);
    }
}

export {PianoRoll};
