export const MAX_CUBE_BYTES = 20 * 1024 * 1024;
export interface LutAsset { id: string; name: string; source: string; kind: 1 | 3; size: number; createdAt: number; sessionOnly?: boolean }
export interface Cube { name: string; kind: 1 | 3; size: number; domain: Float32Array; data: Float32Array }

export function parseCube(source: string, fallbackName: string): Cube {
  if (new TextEncoder().encode(source).length > MAX_CUBE_BYTES) throw new Error('Choose a .cube file smaller than 20 MB.');
  let name = fallbackName.replace(/\.cube$/i, '').slice(0, 96), kind: 1 | 3 = 3, size = 0;
  const min = [0, 0, 0], max = [1, 1, 1]; const samples: number[] = [];
  let dataStarted = false;
  for (let line of source.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    line = line.trim(); if (!line || line.startsWith('#')) continue;
    if (line.startsWith('TITLE')) {
      const title = /^TITLE\s+"(.*?)"\s*(?:#.*)?$/.exec(line);
      if (!title || dataStarted) throw new Error('Invalid .cube title.');
      name = title[1].trim().slice(0, 96) || name; continue;
    }
    const tokens = line.split('#')[0].trim().split(/\s+/);
    if (tokens[0] === 'LUT_1D_SIZE' || tokens[0] === 'LUT_3D_SIZE') {
      if (size || dataStarted || tokens.length !== 2) throw new Error('Combined shaper/3D LUTs are not supported. Use a single 1D or 3D table.');
      kind = tokens[0] === 'LUT_1D_SIZE' ? 1 : 3; size = Number(tokens[1]);
      if (!Number.isInteger(size) || size < 2 || size > (kind === 3 ? 65 : 65536)) throw new Error('Unsupported LUT size. Use a 3D size of 2–65 or 1D size of 2–65536.');
      continue;
    }
    if (tokens[0] === 'DOMAIN_MIN' || tokens[0] === 'DOMAIN_MAX') {
      if (dataStarted || tokens.length !== 4) throw new Error('Invalid LUT domain.');
      const target = tokens[0] === 'DOMAIN_MIN' ? min : max;
      tokens.slice(1).forEach((value, index) => target[index] = Number(value)); continue;
    }
    if (!size || tokens.length !== 3) throw new Error('Unsupported .cube directive or sample row.');
    dataStarted = true;
    for (const token of tokens) { const value = Number(token); if (!Number.isFinite(value) || Math.abs(value) > 16) throw new Error('LUT samples must be finite values between -16 and 16.'); samples.push(value); }
    if (samples.length > (kind === 3 ? size ** 3 : size) * 3) throw new Error('The LUT has more samples than its declared size.');
  }
  if (!size || samples.length !== (kind === 3 ? size ** 3 : size) * 3 || !min.every((value, index) => Number.isFinite(Math.fround(value)) && Math.abs(value) <= 65536 && Number.isFinite(Math.fround(max[index])) && Math.abs(max[index]) <= 65536 && Math.fround(value) < Math.fround(max[index]))) throw new Error('The LUT has an invalid domain or incomplete sample table.');
  return { name: name || 'Imported LUT', kind, size, domain: new Float32Array([...min, ...max]), data: new Float32Array(samples) };
}

export async function cubeId(source: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
