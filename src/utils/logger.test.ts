import { describe, it, expect, vi, beforeEach } from 'bun:test';
import { Logger } from './logger';

describe('Logger.addSink', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger();
  });

  it('calls sink on error log', () => {
    const sink = vi.fn();
    logger.addSink(sink);
    logger.error('SYSTEM', 'something broke');
    expect(sink).toHaveBeenCalledOnce();
    expect(sink.mock.calls[0][0]).toMatchObject({
      level: 'error',
      ctx: 'SYSTEM',
      msg: 'something broke',
    });
  });

  it('calls sink on warn log', () => {
    const sink = vi.fn();
    logger.addSink(sink);
    logger.warn('SYSTEM', 'heads up');
    expect(sink).toHaveBeenCalledOnce();
  });

  it('does not call sink on info log', () => {
    const sink = vi.fn();
    logger.addSink(sink);
    logger.info('SYSTEM', 'informational');
    expect(sink).not.toHaveBeenCalled();
  });

  it('removeSink stops calls', () => {
    const sink = vi.fn();
    logger.addSink(sink);
    logger.removeSink(sink);
    logger.error('SYSTEM', 'after remove');
    expect(sink).not.toHaveBeenCalled();
  });
});
