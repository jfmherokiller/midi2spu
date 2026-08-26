import {Song, isTrackAudible} from "./processing";
import {WaveformId} from "./midiConstants";

const STEP_WIDTH = 20;
const ROW_HEIGHT = 16;
const PIANO_KEYS_WIDTH = 40; // keep in sync with app.css's .piano-ruler margin-left
const PITCH_PADDING = 3;
const MIN_VISIBLE_SEMITONES = 12;
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const WAVEFORM_OPTIONS: WaveformId[] = ["sine", "square", "saw", "tri", "noise"];

// One distinct hue per track, evenly spaced. 32 matches WireSPU_MaxChannels (cl_init.lua in the
// wire submodule) - the SPU's own hard channel limit, so any file this project can actually
// export a full channel mapping for gets a color that never repeats.
const TRACK_COLOR_COUNT = 32;
const PERCUSSION_COLOR = "#555555";

function trackColor(trackIndex: number, isPercussion: boolean): string {
    if (isPercussion) return PERCUSSION_COLOR;
    const hue = (trackIndex * (360 / TRACK_COLOR_COUNT)) % 360;
    return `hsl(${hue}, 65%, 42%)`;
}

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
    private playheadEl: HTMLElement | null = null;
    private scrollAreaEl: HTMLElement | null = null;
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

    /* Tracks shown in the grid overlay: every audible (unmuted, not soloed-out) track, plus the
       active track regardless of its own mute state - you can always see/edit what you're
       working on, even if you've muted it while deciding whether to keep it. */
    private visibleTrackIndexes(): number[] {
        return this.song.tracks
            .map((_, i) => i)
            .filter(i => i === this.activeTrack || isTrackAudible(this.song, i));
    }

    private computePitchRange(trackIndexes: number[]): {min: number; max: number} {
        let min = Infinity, max = -Infinity;
        for (const trackIndex of trackIndexes) {
            for (const note of this.song.tracks[trackIndex]) {
                if (note === -1) continue;
                if (note < min) min = note;
                if (note > max) max = note;
            }
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
        const range = this.computePitchRange(this.visibleTrackIndexes());
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
            label.textContent = "Track " + trackIndex + (this.song.isPercussion[trackIndex] ? " (drums)" : "");
            label.className = "track-label";
            row.appendChild(label);

            const muteLabel = document.createElement("label");
            muteLabel.className = "toggle-badge mute-badge";
            muteLabel.title = "Mute: exclude this track from playback and the exported script";
            muteLabel.addEventListener("click", evt => evt.stopPropagation());
            const muteCheckbox = document.createElement("input");
            muteCheckbox.type = "checkbox";
            muteCheckbox.checked = this.song.muted[trackIndex];
            muteCheckbox.addEventListener("change", () => {
                this.song.muted[trackIndex] = muteCheckbox.checked;
                this.onChange?.();
                this.render();
            });
            const muteText = document.createElement("span");
            muteText.textContent = "M";
            muteLabel.appendChild(muteCheckbox);
            muteLabel.appendChild(muteText);
            row.appendChild(muteLabel);

            const soloLabel = document.createElement("label");
            soloLabel.className = "toggle-badge solo-badge";
            soloLabel.title = "Solo: when any track is soloed, only soloed tracks play/export";
            soloLabel.addEventListener("click", evt => evt.stopPropagation());
            const soloCheckbox = document.createElement("input");
            soloCheckbox.type = "checkbox";
            soloCheckbox.checked = this.song.solo[trackIndex];
            soloCheckbox.addEventListener("change", () => {
                this.song.solo[trackIndex] = soloCheckbox.checked;
                this.onChange?.();
                this.render();
            });
            const soloText = document.createElement("span");
            soloText.textContent = "S";
            soloLabel.appendChild(soloCheckbox);
            soloLabel.appendChild(soloText);
            row.appendChild(soloLabel);

            const swatch = document.createElement("span");
            swatch.className = "track-color-swatch";
            swatch.style.background = trackColor(trackIndex, this.song.isPercussion[trackIndex]);
            row.appendChild(swatch);

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
        keys.style.width = PIANO_KEYS_WIDTH + "px";
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

        const playhead = document.createElement("div");
        playhead.className = "playhead";
        playhead.style.height = gridHeight + "px";
        playhead.style.display = "none";
        this.playheadEl = playhead;
        grid.appendChild(playhead);

        grid.addEventListener("mousedown", evt => this.onGridMouseDown(evt, grid));
        grid.addEventListener("mousemove", evt => this.onGridMouseMove(evt, grid));
        window.addEventListener("mouseup", () => this.onGridMouseUp());

        scrollArea.appendChild(keys);
        scrollArea.appendChild(grid);
        this.scrollAreaEl = scrollArea;

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

    /* Positions the playhead line at the given grid step and scrolls it into view (called from a
       requestAnimationFrame loop in app.ts while a ZspuPlayer is playing). Pass null to hide it
       when playback stops. */
    setPlayheadStep(step: number | null) {
        if (!this.playheadEl || !this.scrollAreaEl) return;
        if (step === null) {
            this.playheadEl.style.display = "none";
            return;
        }
        this.playheadEl.style.display = "";
        const x = step * STEP_WIDTH;
        this.playheadEl.style.left = x + "px";

        const visibleWidth = this.scrollAreaEl.clientWidth - PIANO_KEYS_WIDTH;
        const scrollLeft = this.scrollAreaEl.scrollLeft;
        const margin = visibleWidth * 0.2;
        if (x < scrollLeft + margin || x > scrollLeft + visibleWidth - margin) {
            this.scrollAreaEl.scrollLeft = Math.max(0, x - margin);
        }
    }

    private renderTrackBlocks(trackIndex: number, isActive: boolean) {
        const track = this.song.tracks[trackIndex] ?? [];
        const color = trackColor(trackIndex, this.song.isPercussion[trackIndex]);

        let runStart = -1;
        let runNote = -1;
        const flushRun = (endExclusive: number) => {
            if (runStart === -1 || runNote === -1) return;
            if (runNote < this.minPitch || runNote > this.maxPitch) return;
            const row = this.maxPitch - runNote;
            const block = document.createElement("div");
            block.className = "note-block" + (isActive ? " active-track-block" : "");
            block.style.left = (runStart * STEP_WIDTH) + "px";
            block.style.top = (row * ROW_HEIGHT) + "px";
            block.style.width = ((endExclusive - runStart) * STEP_WIDTH) + "px";
            block.style.height = ROW_HEIGHT + "px";
            block.style.background = color;
            block.style.borderColor = color;
            if (isActive) block.textContent = noteName(runNote);
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

    private refreshNoteBlocks() {
        if (!this.noteBlocksLayer) return;
        this.noteBlocksLayer.innerHTML = "";
        // Dimmed background tracks first, then the active track on top and at full opacity, so
        // it's always clearly readable even where other tracks' notes overlap the same cells.
        for (const trackIndex of this.visibleTrackIndexes()) {
            if (trackIndex !== this.activeTrack) {
                this.renderTrackBlocks(trackIndex, false);
            }
        }
        this.renderTrackBlocks(this.activeTrack, true);
    }
}

export {PianoRoll};
