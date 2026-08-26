/* General MIDI's percussion channel is channel 10 in 1-indexed MIDI terms,
   which is index 9 here since event.channel is 0-indexed (eventTypeByte & 0x0f). */
export const PERCUSSION_CHANNEL = 9;

/* Real Wiremod synth/ resources, confirmed against the in-game sound browser. Per the user,
   prefer the plain unprefixed files for simplicity - square/saw/tri/sine all have one
   (synth/tri.wav is real; also-present "_440"/"_880"/"_1760" suffixed variants of every waveform
   are precisely pitched to that exact Hz, but aren't used here since a plain option exists for
   all four). Native pitch of these plain files is therefore unverified/unknown - see
   BASE_FREQUENCY's comment in player.ts. "noise" (pink_noise.wav) has no real pitch, used as the
   default for percussion tracks - see isPercussion in processing.ts. */
export type WaveformId = "square" | "saw" | "tri" | "sine" | "noise";
export const WAVEFORM_PATHS: Record<WaveformId, string> = {
    square: "synth/square.wav",
    saw: "synth/saw.wav",
    tri: "synth/tri.wav",
    sine: "synth/sine.wav",
    noise: "synth/pink_noise.wav",
};
