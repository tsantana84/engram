import { describe, it, expect } from 'bun:test';

function applyCorrectWeight(
  ids: number[],
  distances: number[],
  correctionIds: Set<number>
): number[] {
  return distances.map((d, i) => correctionIds.has(ids[i]) ? d / 2.0 : d);
}

describe('correction weight bonus', () => {
  it('halves distance for correction observations', () => {
    const ids = [1, 2, 3];
    const correctionIds = new Set([2]);
    const distances = [0.4, 0.4, 0.4];
    const adjusted = applyCorrectWeight(ids, distances, correctionIds);
    expect(adjusted[1]).toBe(0.2);
    expect(adjusted[0]).toBe(0.4);
    expect(adjusted[2]).toBe(0.4);
  });

  it('leaves non-correction distances unchanged', () => {
    const ids = [1, 2];
    const correctionIds = new Set<number>();
    const distances = [0.3, 0.5];
    const adjusted = applyCorrectWeight(ids, distances, correctionIds);
    expect(adjusted).toEqual([0.3, 0.5]);
  });

  it('returns unchanged when ids empty', () => {
    const adjusted = applyCorrectWeight([], [], new Set());
    expect(adjusted).toEqual([]);
  });
});
