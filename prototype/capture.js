export const FRAME_COUNT = 20;
export const FRAME_INTERVAL_MS = 750;
const MAX_EDGE = 768;
const JPEG_QUALITY = 0.7;

const canvas = document.createElement("canvas");

// Draws any image source downscaled to MAX_EDGE on its long side, returns a JPEG data URL.
function encode(source, width, height) {
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

export async function startCamera(video) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera API unavailable. Open this page over https or on localhost.");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  return stream;
}

export function stopCamera(video) {
  video.srcObject?.getTracks().forEach((track) => track.stop());
  video.srcObject = null;
}

// Captures FRAME_COUNT frames, one every FRAME_INTERVAL_MS, in sweep order.
// Resolves with the frames, or with null if the signal aborts first.
export function runSweep(video, { onFrame, signal } = {}) {
  return new Promise((resolve) => {
    const frames = [];
    const grab = () => {
      const frame = { n: frames.length + 1, dataUrl: encode(video, video.videoWidth, video.videoHeight) };
      frames.push(frame);
      onFrame?.(frame);
      if (frames.length === FRAME_COUNT) {
        clearInterval(timer);
        resolve(frames);
      }
    };
    const timer = setInterval(grab, FRAME_INTERVAL_MS);
    signal?.addEventListener("abort", () => {
      clearInterval(timer);
      resolve(null);
    });
    grab();
  });
}

// Upload path: real photos through the same downscale/encode step, in the order selected.
export async function framesFromFiles(files) {
  const picked = [...files].slice(0, FRAME_COUNT);
  const frames = [];
  for (const file of picked) {
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      throw new Error(`Could not read "${file.name}" as an image (HEIC is not supported by most browsers — use JPEG or PNG).`);
    }
    frames.push({ n: frames.length + 1, dataUrl: encode(bitmap, bitmap.width, bitmap.height) });
    bitmap.close();
  }
  return frames;
}
