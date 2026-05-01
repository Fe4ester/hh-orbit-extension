import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

describe('Code quality checks', () => {
  it('should not use alert/confirm/prompt in source code', () => {
    const srcDir = join(__dirname, '../src');

    const violations: string[] = [];

    function scanDirectory(dir: string) {
      const entries = readdirSync(dir);

      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
          scanDirectory(fullPath);
        } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
          const content = readFileSync(fullPath, 'utf-8');
          const lines = content.split('\n');

          lines.forEach((line, index) => {
            // Skip comments
            if (line.trim().startsWith('//') || line.trim().startsWith('*')) {
              return;
            }

            // Check for alert/confirm/prompt
            if (/\b(alert|confirm|prompt)\s*\(/.test(line)) {
              violations.push(`${fullPath}:${index + 1}: ${line.trim()}`);
            }
          });
        }
      }
    }

    scanDirectory(srcDir);

    if (violations.length > 0) {
      console.error('Found alert/confirm/prompt usage in src/:');
      violations.forEach((v) => console.error(`  ${v}`));
    }

    expect(violations).toHaveLength(0);
  });
});
