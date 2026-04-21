import type { LogSinkEntry } from '../../utils/logger';

export class ErrorStore {
  private entries: LogSinkEntry[] = [];

  constructor(private readonly cap: number = 50) {}

  push(entry: LogSinkEntry): void {
    this.entries.unshift(entry);
    if (this.entries.length > this.cap) {
      this.entries.length = this.cap;
    }
  }

  getAll(): LogSinkEntry[] {
    return [...this.entries];
  }
}
