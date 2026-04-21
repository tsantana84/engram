import { describe, it, expect } from 'bun:test';
import { ErrorStore } from './ErrorStore';

describe('ErrorStore', () => {
  it('stores entries', () => {
    const store = new ErrorStore(5);
    store.push({ ts: '2026-01-01T00:00:00Z', level: 'error', ctx: 'X', msg: 'boom' });
    expect(store.getAll()).toHaveLength(1);
  });

  it('caps at limit, newest first', () => {
    const store = new ErrorStore(3);
    for (let i = 0; i < 5; i++) {
      store.push({ ts: `2026-01-01T00:00:0${i}Z`, level: 'error', ctx: 'X', msg: `msg${i}` });
    }
    const all = store.getAll();
    expect(all).toHaveLength(3);
    expect(all[0].msg).toBe('msg4'); // newest first
    expect(all[2].msg).toBe('msg2');
  });
});
