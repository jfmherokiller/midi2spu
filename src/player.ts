/* Faithful preview of what the ZSPU will actually play: one sine oscillator per channel,
   frequency = 880 * 2^(note/12) (matching the generator's CHPITCH ratio, base sample
   "synth/sine_880.wav"), hard on/off steps (the generator never sets an ADSR envelope). */

const BASE_FREQUENCY = 880;

class ZspuPlayer {
    private tracks: number[][];
    private tempo: number;
    private audioContext: AudioContext | null = null;
    private oscillators: OscillatorNode[] = [];
    private endTimeout: number | null = null;
    onEnded?: () => void;

    constructor(tracks: number[][], tempo: number) {
        this.tracks = tracks;
        this.tempo = tempo;
    }

    play() {
        this.stop();

        const audioContext = this.audioContext ?? new AudioContext();
        this.audioContext = audioContext;

        const secondsPerStep = 60 / this.tempo;
        const startTime = audioContext.currentTime + 0.05;
        const duration = Math.max(...this.tracks.map(track => track.length)) * secondsPerStep;

        const masterGain = audioContext.createGain();
        masterGain.gain.value = 0.9 / Math.max(1, this.tracks.length);
        masterGain.connect(audioContext.destination);

        for (const track of this.tracks) {
            const oscillator = audioContext.createOscillator();
            oscillator.type = "sine";
            const gain = audioContext.createGain();
            gain.gain.setValueAtTime(0, startTime);

            for (let i = 0; i < track.length; i++) {
                const note = track[i];
                const t = startTime + i * secondsPerStep;
                if (note === -1) {
                    gain.gain.setValueAtTime(0, t);
                } else {
                    oscillator.frequency.setValueAtTime(BASE_FREQUENCY * Math.pow(2, note / 12), t);
                    gain.gain.setValueAtTime(1, t);
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
    }
}

export {ZspuPlayer};
