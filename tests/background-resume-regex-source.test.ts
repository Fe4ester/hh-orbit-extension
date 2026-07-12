import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('service worker resume hash regex', () => {
  it('uses alphanumeric resume hash regex in injected DOM detection paths', () => {
    const source = readFileSync(join(__dirname, '../src/background/service-worker.ts'), 'utf-8');

    const alphanumericMatches = source.match(/\(\[a-z0-9\]\+\)/g) ?? [];

    expect(alphanumericMatches.length).toBeGreaterThanOrEqual(5);
    expect(source).not.toContain('([a-f0-9]+)');
  });
});
