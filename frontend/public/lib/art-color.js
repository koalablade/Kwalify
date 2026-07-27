/**
 * Sample a dominant colour from album artwork for result-page accents.
 * Falls back silently when CORS or load fails.
 */
export function sampleImageAccent(url) {
  return new Promise((resolve) => {
    if (!url) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 12;
        canvas.height = 12;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, 12, 12);
        const data = ctx.getImageData(0, 0, 12, 12).data;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 40) continue;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          n += 1;
        }
        if (!n) {
          resolve(null);
          return;
        }
        resolve({
          r: Math.round(r / n),
          g: Math.round(g / n),
          b: Math.round(b / n),
        });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export async function applyArtAccentToPoster(posterEl, artUrls) {
  if (!posterEl) return;
  const urls = (artUrls || []).filter(Boolean);
  if (!urls.length) return;
  const accent = await sampleImageAccent(urls[0]);
  if (!accent) return;
  posterEl.style.setProperty("--art-accent", `rgb(${accent.r}, ${accent.g}, ${accent.b})`);
  posterEl.style.setProperty("--art-glow", `rgba(${accent.r}, ${accent.g}, ${accent.b}, 0.32)`);
}
