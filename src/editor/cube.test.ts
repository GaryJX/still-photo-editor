import { describe, expect, it } from 'vitest';
import { parseCube } from './cube';
import { cleanLook, renderingLook } from './look';

describe('cube files and look validation', () => {
  it('reads 1D/3D tables, comments, domains, and titles', () => {
    const one = parseCube('TITLE "Neutral #1"\nLUT_1D_SIZE 2\nDOMAIN_MIN -1 -1 -1\nDOMAIN_MAX 1 1 1\n0 0 0\n1 1 1 # end', 'file.cube');
    expect(one.name).toBe('Neutral #1'); expect(one.kind).toBe(1); expect(Array.from(one.domain)).toEqual([-1, -1, -1, 1, 1, 1]);
    const three = parseCube('LUT_3D_SIZE 2\n' + Array(8).fill('0 0 0').join('\n'), 'cube.cube');
    expect(three.data.length).toBe(24);
  });
  it('rejects incomplete, mixed, nonfinite, and unsupported LUTs', () => {
    for (const source of ['LUT_3D_SIZE 2\n0 0 0', 'LUT_1D_SIZE 2\nLUT_3D_SIZE 2', 'LUT_1D_SIZE 2\nNaN 0 0\n1 1 1', 'LUT_3D_SIZE 66', 'LUT_1D_SIZE 2\nDOMAIN_MAX 0 0 0\n0 0 0\n1 1 1']) expect(() => parseCube(source, 'bad.cube')).toThrow();
  });
  it('excludes names from rendering identity and treats zero amount as inactive', () => {
    const look = { kind: 'lut' as const, name: 'One', amount: 1, assetId: 'a'.repeat(64) };
    expect(renderingLook(look)).toEqual(renderingLook({ ...look, name: 'Two' }));
    expect(renderingLook({ ...look, amount: 0 })).toBeNull();
    expect(() => cleanLook({ ...look, amount: 3 })).toThrow();
    expect(() => cleanLook({ ...look, assetId: 'missing' })).toThrow();
  });
});
