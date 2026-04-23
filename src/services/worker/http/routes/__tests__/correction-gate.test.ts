import { describe, it, expect } from 'bun:test';

const CORRECTION_GATE = /\b(wrong|incorrect|stop doing|that's not right|don't do that|that was wrong|you shouldn't)\b/i;

describe('correction heuristic gate', () => {
  it('fires on "wrong"', () => expect(CORRECTION_GATE.test("that's wrong")).toBe(true));
  it('fires on "incorrect"', () => expect(CORRECTION_GATE.test("that's incorrect")).toBe(true));
  it('fires on "stop doing"', () => expect(CORRECTION_GATE.test('stop doing that')).toBe(true));
  it('does not fire on "no"', () => expect(CORRECTION_GATE.test('no')).toBe(false));
  it('does not fire on "instead"', () => expect(CORRECTION_GATE.test('use a map instead')).toBe(false));
  it('does not fire on "actually,"', () => expect(CORRECTION_GATE.test('actually, more context')).toBe(false));
});
