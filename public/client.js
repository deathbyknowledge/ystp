class FileSender {
    constructor(url) {
        this.url = url;
        this.ws = null;
        this.code = null;
        this.file = null;
    }

    async send(file, onCodeReady, onStart, onProgress, onComplete) {
        if (!file) throw new Error('No file selected');
        this.file = file;
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
            this.ws.send(JSON.stringify({ name: file.name, size: file.size }));
        }

        this.ws.onmessage = async (event) => {
            if (!this.code) {
                const msg = JSON.parse(event.data);
                if (!msg.code) return;
                this.code = msg.code;
                onCodeReady(this.code);
            } else {
                if (event.data === "LET_IT_RIP") {
                    onStart();
                    await this._sendChunks(onProgress);
                    this.ws.send('EOF');
                    this.ws.close();
                    onComplete();
                }
            }
        };
    }

    async _sendChunks(onProgress) {
        const chunkSize = 64 * 1024; // 64 KB
        let offset = 0;
        const file = this.file;

        while (offset < file.size) {
            const blobPart = file.slice(offset, offset + chunkSize);
            const arrayBuffer = await blobPart.arrayBuffer();

            this.ws.send(arrayBuffer);
            offset += chunkSize;

            const progressPercent = Math.floor((offset / file.size) * 100);
            onProgress(progressPercent);
        }
    }
}

class FileReceiver {
    constructor(url) {
        this.url = url;
        this.ws = null
        this.metadata = null
        this.receivedChunks = [];
        this.totalReceived = 0;
    }

    connect(code, onMetadata, onProgress, onComplete, onError) {
        if (!code) throw new Error("No code provided");
        this.ws = new WebSocket(`${this.url}/${encodeURIComponent(code)}`);

        this.ws.onmessage = async (event) => {
            if (!this.metadata) {
                const msg = JSON.parse(event.data);
                if (!msg.name || !msg.size) return;
                this.metadata = msg;
                onMetadata(this.metadata, () => {
                    this.ws.send('LET_IT_RIP');
                });
            } else {
                if (typeof event.data === 'string' && event.data === 'EOF') {
                    this._completeTransfer(onComplete);
                } else {
                    this.receivedChunks.push(event.data);
                    this.totalReceived += event.data.size || 0;
                    const progressPercent = Math.floor((this.totalReceived / this.metadata.size) * 100);
                    onProgress(progressPercent);
                }
            }
        };

        this.ws.onerror = onError;

        this.ws.onclose = () => this.ws.close();
    }

    _completeTransfer(onComplete) {
        const blob = new Blob(this.receivedChunks);
        const downloadUrl = URL.createObjectURL(blob);
        onComplete(downloadUrl, this.metadata.name);
        this.ws.close();
    }

}

if (typeof window !== "undefined") {
    window.FileSender = FileSender;
    window.FileReceiver = FileReceiver;
}