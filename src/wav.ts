/* Web Audio can render audio (via OfflineAudioContext) but has no built-in encoder to turn the
   resulting AudioBuffer into a downloadable file - this hand-rolls the minimum needed: an
   uncompressed 16-bit PCM .wav, which every AudioBuffer's float samples convert to directly. */
function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
    const numChannels = buffer.numberOfChannels;
    const numFrames = buffer.length;
    const bytesPerSample = 2;
    const blockAlign = numChannels * bytesPerSample;
    const dataSize = numFrames * blockAlign;
    const headerSize = 44;

    const arrayBuffer = new ArrayBuffer(headerSize + dataSize);
    const view = new DataView(arrayBuffer);

    function writeString(offset: number, text: string) {
        for (let i = 0; i < text.length; i++) {
            view.setUint8(offset + i, text.charCodeAt(i));
        }
    }

    writeString(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true); // fmt chunk size (PCM)
    view.setUint16(20, 1, true); // audio format: 1 = PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * blockAlign, true); // byte rate
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bytesPerSample * 8, true); // bits per sample
    writeString(36, "data");
    view.setUint32(40, dataSize, true);

    const channelData: Float32Array[] = [];
    for (let channel = 0; channel < numChannels; channel++) {
        channelData.push(buffer.getChannelData(channel));
    }

    let offset = headerSize;
    for (let frame = 0; frame < numFrames; frame++) {
        for (let channel = 0; channel < numChannels; channel++) {
            const sample = Math.max(-1, Math.min(1, channelData[channel][frame]));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
            offset += 2;
        }
    }

    return new Blob([arrayBuffer], {type: "audio/wav"});
}

export {audioBufferToWavBlob};
