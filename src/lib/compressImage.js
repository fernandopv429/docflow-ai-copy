// Compresses large images before upload to reduce AI analysis cost.
// PDFs and small images pass through untouched.
const MAX_DIMENSION = 1600;
const MIN_SIZE_TO_COMPRESS = 500 * 1024; // 500KB

export async function prepareFileForUpload(file) {
  if (!file.type.startsWith('image/') || file.size < MIN_SIZE_TO_COMPRESS) return file;
  try {
    const img = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}