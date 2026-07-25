/**
 * AudioWorklet：把浏览器采样率（通常 44.1k/48k）的输入降采样为
 * 16kHz / 单声道 / PCM16，按 ~100ms 一包 postMessage 给主线程；
 * 同时上报 RMS 电平用于电平条。
 */
class PcmRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate = 16000;
    this.packetSamples = 1600; // 100ms @ 16kHz
    this.ratio = sampleRate / this.targetRate;
    this.needed = Math.ceil(this.ratio * this.packetSamples);
    this.chunks = [];
    this.total = 0;
    this.blockCount = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch || ch.length === 0) return true;

    // 电平（每 ~6 个 128 帧块报一次，约 16ms*6）
    this.blockCount += 1;
    if (this.blockCount % 6 === 0) {
      let sum = 0;
      for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
      this.port.postMessage({ level: Math.sqrt(sum / ch.length) });
    }

    this.chunks.push(ch.slice(0));
    this.total += ch.length;

    while (this.total >= this.needed) {
      // 取出恰好 needed 个源采样
      const merged = new Float32Array(this.needed);
      let filled = 0;
      while (filled < this.needed) {
        const head = this.chunks[0];
        const take = Math.min(head.length, this.needed - filled);
        merged.set(head.subarray(0, take), filled);
        filled += take;
        if (take === head.length) {
          this.chunks.shift();
        } else {
          this.chunks[0] = head.subarray(take);
        }
        this.total -= take;
      }
      // 线性插值降采样 → PCM16
      const out = new Int16Array(this.packetSamples);
      for (let i = 0; i < this.packetSamples; i++) {
        const pos = i * this.ratio;
        const i0 = Math.floor(pos);
        const i1 = Math.min(i0 + 1, this.needed - 1);
        const frac = pos - i0;
        let v = merged[i0] * (1 - frac) + merged[i1] * frac;
        v = Math.max(-1, Math.min(1, v));
        out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
      }
      this.port.postMessage({ pcm: out.buffer }, [out.buffer]);
    }
    return true;
  }
}

registerProcessor('pcm-recorder', PcmRecorder);
