const resampleLinearInt16bite = (samples, fromRate, toRate) => {
  if (fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const newLength = Math.floor(samples.length / ratio);
  const out = new Int16Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const src = i * ratio;
    const f = Math.floor(src);
    const c = Math.min(f + 1, samples.length - 1);
    const t = src - f;
    out[i] = Math.round(samples[f] * (1 - t) + samples[c] * t);
  }
  return out;
};

const downsampleTo16k = (int16Samples, fromRate = 48000) => {
  if (fromRate === 16000) {
    return Buffer.from(int16Samples.buffer);
  }
  const res = resampleLinearInt16bite(int16Samples, fromRate, 16000);
  return Buffer.from(res.buffer);
};

module.exports = { resampleLinearInt16bite, downsampleTo16k };
