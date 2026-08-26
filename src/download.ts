function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
}

function downloadTextFile(content: string, filename: string, mimeType: string) {
    downloadBlob(new Blob([content], {type: mimeType}), filename);
}

export {downloadTextFile, downloadBlob}
