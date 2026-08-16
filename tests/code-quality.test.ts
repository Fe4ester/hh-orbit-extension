import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

// Confirmed dialogs deliberately kept as native confirm() - not a
// missed lint violation, just not worth building custom UI for yet.
const ALLOWED_VIOLATIONS: Array<{ file: string; match: RegExp }> = [
  { file: 'sidepanel/App.tsx', match: /confirm\('Удалить профиль/ },
];

describe('Code quality checks', () => {
  it('should not use alert/confirm/prompt in source code', () => {
    const repoRoot = join(__dirname, '..');
    const roots = ['src', 'sidepanel', 'mcp'].map((dir) => join(repoRoot, dir));

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
          const relativePath = relative(repoRoot, fullPath).replace(/\\/g, '/');

          lines.forEach((line, index) => {
            // Skip comments
            if (line.trim().startsWith('//') || line.trim().startsWith('*')) {
              return;
            }

            // Check for alert/confirm/prompt
            if (/\b(alert|confirm|prompt)\s*\(/.test(line)) {
              const isAllowed = ALLOWED_VIOLATIONS.some(
                (allowed) => allowed.file === relativePath && allowed.match.test(line)
              );
              if (!isAllowed) {
                violations.push(`${relativePath}:${index + 1}: ${line.trim()}`);
              }
            }
          });
        }
      }
    }

    roots.forEach(scanDirectory);

    if (violations.length > 0) {
      console.error('Found alert/confirm/prompt usage:');
      violations.forEach((v) => console.error(`  ${v}`));
    }

    expect(violations).toHaveLength(0);
  });
});
