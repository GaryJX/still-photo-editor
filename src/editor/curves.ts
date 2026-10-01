export const curveChannels = ['master', 'red', 'green', 'blue'] as const;
export type CurveChannel = typeof curveChannels[number];
export type CurvePoint = [number, number];
export type Curves = Record<CurveChannel, CurvePoint[]>;
export const linearCurve = (): CurvePoint[] => [[0, 0], [1, 1]];
export const defaultCurves = (): Curves => ({ master: linearCurve(), red: linearCurve(), green: linearCurve(), blue: linearCurve() });

export function validCurve(points: CurvePoint[]) {
  return points.length >= 2 && points.length <= 32 && points[0][0] === 0 && points.at(-1)![0] === 1
    && points.every(([x, y], i) => Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1 && (i === 0 || x > points[i - 1][0]));
}

export function curveValues(curves: Curves) {
  if (!curveChannels.every(channel => validCurve(curves[channel]))) throw new Error('Invalid tone curve.');
  return new Float32Array(curveChannels.flatMap(channel => [curves[channel].length, ...curves[channel].flat()]));
}
