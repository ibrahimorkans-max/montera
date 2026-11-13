import { PAPER_SIZE, type Paper } from './pdf';

export type ImageFormat = 'png' | 'jpg';

/**
 * Browser only: draw an HTML document onto a canvas and download it as PNG or JPG.
 * The document is laid out in a hidden frame to learn its real height, then painted
 * through an SVG foreignObject so no server round trip is needed.
 */
export async function downloadImageInBrowser(html: string, paper: Paper, format: ImageFormat, filename: string): Promise<void> {
  const width = PAPER_SIZE[paper].px;
  const frame = document.createElement('iframe');
  frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:${PAPER_SIZE[paper].pxHeight || 600}px;border:0;visibility:hidden`;
  frame.srcdoc = html;
  document.body.appendChild(frame);
  try {
    await new Promise<void>((resolve, reject) => {
      frame.onload = () => resolve();
      frame.onerror = () => reject(new Error('Could not prepare the document.'));
    });
    const doc = frame.contentDocument;
    if (!doc) throw new Error('Could not prepare the document.');
    const height = Math.max(PAPER_SIZE[paper].pxHeight, doc.documentElement.scrollHeight, doc.body.scrollHeight);
    const xhtml = new XMLSerializer().serializeToString(doc.documentElement);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${xhtml}</foreignObject></svg>`;

    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('This browser could not draw the document as an image.'));
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });

    const scale = 2; // sharp enough to print
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Image export is not available in this browser.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, format === 'png' ? 'image/png' : 'image/jpeg', 0.92));
    if (!blob) throw new Error('Could not create the image.');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } finally {
    frame.remove();
  }
}
