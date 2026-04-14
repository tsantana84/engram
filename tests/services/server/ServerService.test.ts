import { describe, it, expect } from 'bun:test';
import { ServerService } from '../../../src/services/server/ServerService.js';

describe('ServerService', () => {
  it('should be instantiable with config', () => {
    const server = new ServerService({
      port: 8888,
      databaseUrl: 'postgres://localhost:5432/claude_mem_test',
    });
    expect(server).toBeDefined();
  });
});
