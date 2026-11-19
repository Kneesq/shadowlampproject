(() => {
  'use strict';

  function quantile(histogram, fraction, start = 0) {
    let total = 0;
    for (let i = start; i < histogram.length; i++) total += histogram[i];
    if (!total) return 0;

    let remaining = Math.ceil(total * fraction);
    for (let i = start; i < histogram.length; i++) {
      remaining -= histogram[i];
      if (remaining <= 0) return i;
    }
    return 0;
  }

  function borderIndices(width, height) {
    const border = [];
    for (let x = 0; x < width; x++) {
      border.push(x);
      if (height > 1) border.push((height - 1) * width + x);
    }
    for (let y = 1; y < height - 1; y++) {
      border.push(y * width);
      if (width > 1) border.push(y * width + width - 1);
    }
    return border;
  }

  function colorDistance(rgba, offset, red, green, blue) {
    const dr = rgba[offset] - red;
    const dg = rgba[offset + 1] - green;
    const db = rgba[offset + 2] - blue;
    return Math.sqrt((dr * dr + dg * dg + db * db) / 3);
  }

  function estimateBackground(rgba, border) {
    // A dominant border color remains useful when the subject reaches one edge.
    // Choose a color cluster before taking medians, so colors never get averaged together.
    const clusters = new Uint16Array(4096);
    let peak = 0;
    for (const index of border) {
      const offset = index * 4;
      const bin = (rgba[offset] >> 4) * 256 + (rgba[offset + 1] >> 4) * 16 + (rgba[offset + 2] >> 4);
      if (++clusters[bin] > clusters[peak]) peak = bin;
    }
    const red = (peak >> 8) * 16 + 8;
    const green = ((peak >> 4) & 15) * 16 + 8;
    const blue = (peak & 15) * 16 + 8;
    const channels = Array.from({ length: 3 }, () => new Uint16Array(256));
    for (const index of border) {
      const offset = index * 4;
      if (colorDistance(rgba, offset, red, green, blue) > 15) continue;
      for (let channel = 0; channel < 3; channel++) {
        channels[channel][rgba[offset + channel]]++;
      }
    }
    return channels.map(histogram => quantile(histogram, 0.5));
  }

  function alphaSignal(rgba) {
    const histogram = new Uint32Array(256);
    let transparent = 0;
    for (let offset = 3; offset < rgba.length; offset += 4) {
      const alpha = rgba[offset];
      histogram[alpha]++;
      if (alpha < 24) transparent++;
    }
    const count = rgba.length / 4;
    if (transparent < Math.min(16, Math.max(1, Math.ceil(count * 0.00025)))) return null;
    const signal = new Float32Array(count);
    for (let i = 0; i < count; i++) signal[i] = rgba[i * 4 + 3];
    return { signal, noise: 0, reference: quantile(histogram, 0.95, 24) };
  }

  function opaqueSignal(rgba, width, height) {
    const border = borderIndices(width, height);
    const [red, green, blue] = estimateBackground(rgba, border);
    const count = width * height;
    const signal = new Float32Array(count);
    const histogram = new Uint32Array(256);
    for (let i = 0; i < count; i++) {
      const delta = colorDistance(rgba, i * 4, red, green, blue);
      signal[i] = delta;
      histogram[Math.round(delta)]++;
    }
    const borderHistogram = new Uint32Array(256);
    for (const index of border) borderHistogram[Math.round(signal[index])]++;
    const spread = Math.min(quantile(borderHistogram, 0.72), 1 + 2 * quantile(borderHistogram, 0.4));
    const noise = Math.max(0.75, spread * 1.3 + 0.75);
    const start = Math.min(255, Math.ceil(Math.max(2.5, noise * 1.4 + 0.5)));
    let reference = quantile(histogram, 0.25, start);

    // Keep pale colors alongside dark ink when their color departure from the
    // background is consistent over an area. A single noisy pixel cannot lower
    // the contrast estimate for the rest of the image.
    if (reference > start * 2) {
      const stable = new Uint32Array(256);
      for (let y = 0; y < height - 1; y++) {
        for (let x = 0; x < width - 1; x++) {
          const i = y * width + x;
          const level = signal[i];
          if (level < start || level > reference * 0.55) continue;
          const tolerance = 0.75 + level * 0.04;
          if (Math.abs(signal[i + 1] - level) <= tolerance &&
              Math.abs(signal[i + width] - level) <= tolerance &&
              Math.abs(signal[i + width + 1] - level) <= tolerance) {
            stable[Math.round(level)]++;
          }
        }
      }
      const patchSize = Math.max(4, Math.round(count * 0.00014));
      for (let level = start; level < reference * 0.55; level++) {
        if (stable[level - 1] + stable[level] + stable[level + 1] >= patchSize) {
          reference = Math.min(reference, level + 2);
          break;
        }
      }
    }
    return { signal, noise, reference };
  }

  function removeSpecks(gray, width, height) {
    const shortSide = Math.min(width, height);
    if (shortSide < 16) return;
    const minimum = Math.min(7, 2 + Math.floor(shortSide / 210));
    const visited = new Uint8Array(gray.length);
    const queue = new Int32Array(gray.length);
    for (let seed = 0; seed < gray.length; seed++) {
      if (gray[seed] >= 128 || visited[seed]) continue;
      let head = 0;
      let size = 1;
      visited[seed] = 1;
      queue[0] = seed;
      while (head < size) {
        const index = queue[head++];
        const x = index % width;
        const y = Math.floor(index / width);
        for (let sy = Math.max(0, y - 1); sy <= Math.min(height - 1, y + 1); sy++) {
          for (let sx = Math.max(0, x - 1); sx <= Math.min(width - 1, x + 1); sx++) {
            const neighbor = sy * width + sx;
            if (gray[neighbor] >= 128 || visited[neighbor]) continue;
            visited[neighbor] = 1;
            queue[size++] = neighbor;
          }
        }
      }
      if (size < minimum) {
        for (let i = 0; i < size; i++) gray[queue[i]] = 255;
      }
    }

    // Keep intermediate levels on retained contours, while clearing the light
    // halos left around isolated JPEG specks. Enclosed background is untouched.
    for (let i = 0; i < gray.length; i++) {
      if (gray[i] < 128 || gray[i] === 255) continue;
      const x = i % width;
      const y = Math.floor(i / width);
      let adjacent = false;
      for (let sy = Math.max(0, y - 1); !adjacent && sy <= Math.min(height - 1, y + 1); sy++) {
        for (let sx = Math.max(0, x - 1); sx <= Math.min(width - 1, x + 1); sx++) {
          if (gray[sy * width + sx] < 128) {
            adjacent = true;
            break;
          }
        }
      }
      if (!adjacent) gray[i] = 255;
    }
  }

  function mask(rgba, width, height, threshold = 128, invert = false) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
        rgba.length !== width * height * 4) {
      throw new RangeError('Silhouette pixel data must match its dimensions.');
    }
    const gray = new Uint8Array(width * height);
    const { signal, noise, reference } = alphaSignal(rgba) || opaqueSignal(rgba, width, height);
    const sensitivity = Math.max(0, Math.min(255, Number(threshold))) || 0;
    if (reference <= noise) {
      gray.fill(invert ? 0 : 255);
      return gray;
    }

    const contrast = reference - noise;
    const cutoff = noise + contrast * (0.8 - sensitivity * 0.0024);
    const transition = Math.max(0.75, Math.min(28, contrast * 0.32, cutoff - noise));
    for (let i = 0; i < gray.length; i++) {
      const level = 127.5 + (cutoff - signal[i]) * 127.5 / transition;
      gray[i] = Math.round(Math.max(0, Math.min(255, level)));
    }
    removeSpecks(gray, width, height);
    if (invert) {
      for (let i = 0; i < gray.length; i++) gray[i] = 255 - gray[i];
    }
    return gray;
  }

  const api = { mask };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.ShadowLampSilhouette = api;
})();
