// utils/imageCompress.js — Compression client légère avant upload base64 (évite les payloads > 4.5 MB sur Vercel)

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

export async function fileToCompressedBase64(file, { maxWidth = 1400, maxHeight = 1400, quality = 0.82 } = {}) {
  const dataUrl = await readAsDataUrl(file);
  const rawBase64 = dataUrl.split(',')[1] || '';

  // Garder les petits fichiers ou SVG/PNG transparents de petite taille intacts
  if (!file.type?.startsWith('image/') || file.type === 'image/svg+xml' || file.size <= 180 * 1024) {
    return { base64Data: rawBase64, fileType: file.type || 'image/jpeg', fileName: file.name };
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        let { width, height } = img;
        const ratio = Math.min(1, maxWidth / width, maxHeight / height);
        width = Math.max(1, Math.round(width * ratio));
        height = Math.max(1, Math.round(height * ratio));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve({ base64Data: rawBase64, fileType: file.type || 'image/jpeg', fileName: file.name });
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);

        const outType = file.type === 'image/png' ? 'image/webp' : 'image/jpeg';
        const compressedUrl = canvas.toDataURL(outType, quality);
        const compressedBase64 = compressedUrl.split(',')[1] || rawBase64;
        if (compressedBase64.length < rawBase64.length) {
          const ext = outType === 'image/webp' ? 'webp' : 'jpg';
          const baseName = (file.name || 'image').replace(/\.[^.]+$/, '');
          resolve({ base64Data: compressedBase64, fileType: outType, fileName: `${baseName}.${ext}` });
        } else {
          resolve({ base64Data: rawBase64, fileType: file.type || 'image/jpeg', fileName: file.name });
        }
      } catch (_) {
        resolve({ base64Data: rawBase64, fileType: file.type || 'image/jpeg', fileName: file.name });
      }
    };
    img.onerror = () => resolve({ base64Data: rawBase64, fileType: file.type || 'image/jpeg', fileName: file.name });
    img.src = dataUrl;
  });
}

