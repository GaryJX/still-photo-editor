export interface Crop { x: number; y: number; width: number; height: number }
export interface Geometry { crop: Crop; rotation: number }
export const fullCrop = (): Crop => ({ x: 0, y: 0, width: 1, height: 1 });
export const defaultGeometry = (): Geometry => ({ crop: fullCrop(), rotation: 0 });
export const geometryKey = (geometry: Geometry) => JSON.stringify([geometry.crop.x, geometry.crop.y, geometry.crop.width, geometry.crop.height, geometry.rotation]);

export function geometryLayout(width: number, height: number, geometry: Geometry) {
  const { crop, rotation } = geometry;
  if (![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) || crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0 || crop.x + crop.width > 1 + 1e-9 || crop.y + crop.height > 1 + 1e-9 || !Number.isInteger(rotation) || rotation < 0 || rotation > 3) throw new Error('Invalid crop or rotation.');
  const x = Math.min(width - 1, Math.round(crop.x * width));
  const y = Math.min(height - 1, Math.round(crop.y * height));
  const right = Math.max(x + 1, Math.min(width, Math.round((crop.x + crop.width) * width)));
  const bottom = Math.max(y + 1, Math.min(height, Math.round((crop.y + crop.height) * height)));
  const cropWidth = right - x, cropHeight = bottom - y;
  return { x, y, cropWidth, cropHeight, width: rotation % 2 ? cropHeight : cropWidth, height: rotation % 2 ? cropWidth : cropHeight,
    values: new Uint32Array([width, height, x, y, cropWidth, cropHeight, rotation]) };
}

export function snapCrop(crop: Crop, width: number, height: number): Crop {
  const rect = geometryLayout(width, height, { crop, rotation: 0 });
  return { x: rect.x / width, y: rect.y / height, width: rect.cropWidth / width, height: rect.cropHeight / height };
}

export function displayCrop(crop: Crop, rotation: number): Crop {
  const { x, y, width, height } = crop;
  if (rotation === 1) return { x: Math.max(0, 1 - y - height), y: x, width: height, height: width };
  if (rotation === 2) return { x: Math.max(0, 1 - x - width), y: Math.max(0, 1 - y - height), width, height };
  if (rotation === 3) return { x: y, y: Math.max(0, 1 - x - width), width: height, height: width };
  return { ...crop };
}
export const sourceCrop = (crop: Crop, rotation: number) => displayCrop(crop, (4 - rotation) % 4);

export function centeredCrop(width: number, height: number, aspect: number): Crop {
  const ratio = aspect * height / width;
  const cropWidth = Math.min(1, ratio), cropHeight = Math.min(1, 1 / ratio);
  return { x: (1 - cropWidth) / 2, y: (1 - cropHeight) / 2, width: cropWidth, height: cropHeight };
}
