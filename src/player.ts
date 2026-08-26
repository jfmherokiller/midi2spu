/* Faithful preview of what the ZSPU will actually play: one sound source per channel (waveform
   matching the track's chosen synth wave), hard on/off steps (the generator never sets an ADSR
   envelope). Pitch reproduces the generator's actual CHPITCH math: the generated script computes
   X = 2^(note/12)/100, and CHPITCH's Lua implementation does ChangePitch(clamp(X*100, 0, 255), 0)
   - GMod's ChangePitch treats 100 as normal/unshifted speed, so the real playback-rate multiplier
   is clamp(2^(note/12), 0, 255) / 100.

   Known unverified assumption: BASE_FREQUENCY=880 was chosen because this project's original
   shared waveform was literally named "sine_880.wav". WAVEFORM_PATHS (midiConstants.ts) now
   uses the plain unprefixed synth/{square,saw,tri,sine}.wav files (per the user, preferred for
   simplicity over the precisely-pitched "_440"/"_880"/"_1760" variants confirmed to exist for
   every waveform in the real in-game sound browser) - their actual native pitch is unknown, not
   verified against the real asset files. Worth a real in-game check. */

import {WaveformId} from "./midiConstants";
import {audioBufferToWavBlob} from "./wav";

const BASE_FREQUENCY = 880;
const MAX_PITCH_PERCENT = 255;
const NOISE_BUFFER_SECONDS = 2;
const WAV_SAMPLE_RATE = 44100;

const OSCILLATOR_TYPES: Partial<Record<WaveformId, OscillatorType>> = {
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
    private noiseBuffer: AudioBuffer | null = null;
    private trackScaling: number;
    private volume = 0.5;
    private sources: AudioScheduledSourceNode[] = [];
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

    /* Web Audio has no built-in "noise" OscillatorType, so percussion-style tracks (WaveformId
       "noise", matching synth/pink_noise.wav) instead loop a buffer of generated white noise -
       an approximation of the real pink-noise sample, not an exact match, good enough for preview
       purposes. Cached per player instance (lazily built once, reused across replays and across
       both live playback and offline WAV rendering - an AudioBuffer isn't tied to whichever
       BaseAudioContext created it, so sharing it between an AudioContext and an
       OfflineAudioContext is valid). */
    private getNoiseBuffer(audioContext: BaseAudioContext): AudioBuffer {
        if (!this.noiseBuffer) {
            const length = Math.floor(audioContext.sampleRate * NOISE_BUFFER_SECONDS);
            const buffer = audioContext.createBuffer(1, length, audioContext.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < length; i++) {
                data[i] = Math.random() * 2 - 1;
            }
            this.noiseBuffer = buffer;
        }
        return this.noiseBuffer;
    }

    /* Builds one track's source+gain graph and schedules its note automation, connecting to
       `destination`. Shared between live playback (AudioContext) and offline WAV rendering
       (OfflineAudioContext) - both are a BaseAudioContext and expose the same node-creation
       methods, so the same scheduling code produces identical audio either way. Caller is
       responsible for calling start()/stop() on the returned source. */
    private scheduleTrack(audioContext: BaseAudioContext, destination: AudioNode, trackIndex: number, startTime: number): AudioScheduledSourceNode {
        const track = this.tracks[trackIndex];
        const trackVolume = this.volumes[trackIndex] ?? 1;
        const waveform = this.waveforms[trackIndex] ?? "sine";
        const isNoise = waveform === "noise";

        let source: AudioScheduledSourceNode;
        let pitchParam: AudioParam;
        if (isNoise) {
            const bufferSource = audioContext.createBufferSource();
            bufferSource.buffer = this.getNoiseBuffer(audioContext);
            bufferSource.loop = true;
            source = bufferSource;
            pitchParam = bufferSource.playbackRate;
        } else {
            const oscillator = audioContext.createOscillator();
            oscillator.type = OSCILLATOR_TYPES[waveform] ?? "sine";
            source = oscillator;
            pitchParam = oscillator.frequency;
        }

        const gain = audioContext.createGain();
        gain.gain.setValueAtTime(0, startTime);

        const secondsPerStep = 60 / this.tempo;
        for (let i = 0; i < track.length; i++) {
            const note = track[i];
            const t = startTime + i * secondsPerStep;
            if (note === -1) {
                gain.gain.setValueAtTime(0, t);
            } else {
                const pitchPercent = Math.min(MAX_PITCH_PERCENT, Math.pow(2, note / 12));
                // OscillatorNode.frequency is an absolute Hz value (needs BASE_FREQUENCY);
                // AudioBufferSourceNode.playbackRate is already a direct multiplier (1 = normal).
                pitchParam.setValueAtTime(isNoise ? pitchPercent / 100 : BASE_FREQUENCY * pitchPercent / 100, t);
                gain.gain.setValueAtTime(trackVolume, t);
            }
        }

        source.connect(gain);
        gain.connect(destination);
        return source;
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
            const source = this.scheduleTrack(audioContext, masterGain, trackIndex, startTime);
            source.start(startTime);
            source.stop(startTime + duration);
            this.sources.push(source);
        }

        this.endTimeout = window.setTimeout(() => {
            this.endTimeout = null;
            this.sources = [];
            this.onEnded?.();
        }, (startTime - audioContext.currentTime + duration) * 1000);
    }

    stop() {
        if (this.endTimeout !== null) {
            window.clearTimeout(this.endTimeout);
            this.endTimeout = null;
        }
        for (const source of this.sources) {
            source.stop();
            source.disconnect();
        }
        this.sources = [];
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

    /* Renders this song to a downloadable .wav using the same scheduling as live play() (see
       scheduleTrack) but through an OfflineAudioContext, which computes the audio as fast as
       possible instead of in real time and hands back the finished samples as an AudioBuffer.
       Deliberately doesn't apply the live preview volume slider (this.volume) - that's a
       preview-only convenience, not part of the song, so the export always renders at the same
       per-track-normalized level (trackScaling) regardless of whatever the slider happened to be
       set to during a prior preview. */
    async renderToWav(): Promise<Blob> {
        const secondsPerStep = 60 / this.tempo;
        const duration = Math.max(...this.tracks.map(track => track.length)) * secondsPerStep;
        const totalFrames = Math.max(1, Math.ceil(duration * WAV_SAMPLE_RATE));
        const offlineContext = new OfflineAudioContext(1, totalFrames, WAV_SAMPLE_RATE);

        const masterGain = offlineContext.createGain();
        masterGain.gain.value = this.trackScaling;
        masterGain.connect(offlineContext.destination);

        for (let trackIndex = 0; trackIndex < this.tracks.length; trackIndex++) {
            const source = this.scheduleTrack(offlineContext, masterGain, trackIndex, 0);
            source.start(0);
            source.stop(duration);
        }

        const rendered = await offlineContext.startRendering();
        return audioBufferToWavBlob(rendered);
    }
}

export {ZspuPlayer};
