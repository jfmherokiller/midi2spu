/* Faithful preview of what the ZSPU will actually play: one oscillator per channel (waveform
   matching the track's chosen synth wave), hard on/off steps (the generator never sets an ADSR
   envelope). Pitch reproduces the generator's actual CHPITCH math: the generated script computes
   X = 2^(note/12)/100, and CHPITCH's Lua implementation does ChangePitch(clamp(X*100, 0, 255), 0)
   - GMod's ChangePitch treats 100 as normal/unshifted speed, so the real playback-rate multiplier
   is clamp(2^(note/12), 0, 255) / 100, applied to the base sample's native pitch.

   Known unverified assumption: BASE_FREQUENCY=880 was chosen because the generator's old shared
   waveform was literally named "sine_880.wav". The 4 real built-in SPU waveforms (synth/square.wav
   etc, no frequency in the filename) have an unknown native pitch - kept at 880 for all four as a
   working assumption; worth a real in-game check, not fixed blind without the actual asset files. */

import {WaveformId} from "./utilityfunctions";

const BASE_FREQUENCY = 880;
const MAX_PITCH_PERCENT = 255;

const OSCILLATOR_TYPES: Record<WaveformId, OscillatorType> = {
    square: "square",
    saw: "sawtooth",
    tri: "triangle",
    sine: "sine",
};

class ZspuPlayer {
    private tracks: number[][];
    private tempo: number;
    private waveforms: WaveformId[];
    private volumes: number[];
    private audioContext: AudioContext | null = null;
    private masterGain: GainNode | null = null;
    private trackScaling: number;
    private volume = 0.5;
    private oscillators: OscillatorNode[] = [];
    private endTimeout: number | null = null;
    private playStartTime: number | null = null;
    private secondsPerStep = 0;
    onEnded?: () => void;

    constructor(tracks: number[][], tempo: number, waveforms: WaveformId[], volumes: number[]) {
        this.tracks = tracks;
        this.tempo = tempo;
        this.waveforms = waveforms;
        this.volumes = volumes;
        this.trackScaling = 0.9 / Math.max(1, tracks.length);
    }

    private getMasterGain(audioContext: AudioContext): GainNode {
        if (!this.masterGain) {
            this.masterGain = audioContext.createGain();
            this.masterGain.gain.value = this.trackScaling * this.volume;
            this.masterGain.connect(audioContext.destination);
        }
        return this.masterGain;
    }

    setVolume(volume: number) {
        this.volume = volume;
        if (this.masterGain) {
            this.masterGain.gain.value = this.trackScaling * this.volume;
        }
    }

    play() {
        this.stop();

        const audioContext = this.audioContext ?? new AudioContext();
        this.audioContext = audioContext;
        const masterGain = this.getMasterGain(audioContext);

        const secondsPerStep = 60 / this.tempo;
        const startTime = audioContext.currentTime + 0.05;
        const duration = Math.max(...this.tracks.map(track => track.length)) * secondsPerStep;
        this.playStartTime = startTime;
        this.secondsPerStep = secondsPerStep;

        for (let trackIndex = 0; trackIndex < this.tracks.length; trackIndex++) {
            const track = this.tracks[trackIndex];
            const trackVolume = this.volumes[trackIndex] ?? 1;
            const oscillator = audioContext.createOscillator();
            oscillator.type = OSCILLATOR_TYPES[this.waveforms[trackIndex] ?? "sine"];
            const gain = audioContext.createGain();
            gain.gain.setValueAtTime(0, startTime);

            for (let i = 0; i < track.length; i++) {
                const note = track[i];
                const t = startTime + i * secondsPerStep;
                if (note === -1) {
                    gain.gain.setValueAtTime(0, t);
                } else {
                    const pitchPercent = Math.min(MAX_PITCH_PERCENT, Math.pow(2, note / 12));
                    oscillator.frequency.setValueAtTime(BASE_FREQUENCY * pitchPercent / 100, t);
                    gain.gain.setValueAtTime(trackVolume, t);
                }
            }

            oscillator.connect(gain);
            gain.connect(masterGain);
            oscillator.start(startTime);
            oscillator.stop(startTime + duration);
            this.oscillators.push(oscillator);
        }

        this.endTimeout = window.setTimeout(() => {
            this.endTimeout = null;
            this.oscillators = [];
            this.onEnded?.();
        }, (startTime - audioContext.currentTime + duration) * 1000);
    }

    stop() {
        if (this.endTimeout !== null) {
            window.clearTimeout(this.endTimeout);
            this.endTimeout = null;
        }
        for (const oscillator of this.oscillators) {
            oscillator.stop();
            oscillator.disconnect();
        }
        this.oscillators = [];
        this.playStartTime = null;
    }

    /* Current playback position in grid steps, or null if not currently playing. Used to drive
       the piano roll's playhead/follow-scroll. */
    getCurrentStep(): number | null {
        if (this.playStartTime === null || !this.audioContext) return null;
        const elapsed = this.audioContext.currentTime - this.playStartTime;
        if (elapsed < 0) return 0;
        return Math.floor(elapsed / this.secondsPerStep);
    }
}

export {ZspuPlayer};
