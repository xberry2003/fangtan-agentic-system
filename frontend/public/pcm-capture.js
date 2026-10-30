// A second, silent audio graph feeds ASR without altering MediaRecorder audio.
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
    this.port.onmessage = event => { if (event.data === 'flush') this.flush(); };
  }
  flush() {
    if (!this.buffer.length) return;
    const frame = new Int16Array(this.buffer);
    this.buffer = [];
    this.port.postMessage(frame.buffer, [frame.buffer]);
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let value = 0;
      for (const channel of channels) value += channel[i] / channels.length;
      value = Math.max(-1, Math.min(1, value));
      this.buffer.push(Math.round(value * (value < 0 ? 32768 : 32767)));
    }
    if (this.buffer.length >= sampleRate / 10) this.flush();
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
