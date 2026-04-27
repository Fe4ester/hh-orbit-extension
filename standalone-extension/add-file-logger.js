#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Files to process with their source type
const files = [
  { path: 'src/background/service-worker.ts', source: 'service_worker' },
  { path: 'src/content/live-mode-content.ts', source: 'content_script' },
  { path: 'src/live/searchResultsParser.ts', source: 'content_script' },
];

function addFileLoggerToFile(filePath, source) {
  const fullPath = path.join(__dirname, filePath);
  let content = fs.readFileSync(fullPath, 'utf8');

  // Check if FileLogger already imported
  if (!content.includes("import { FileLogger }")) {
    // Find first import statement
    const importMatch = content.match(/^import .+;$/m);
    if (importMatch) {
      const insertPos = content.indexOf(importMatch[0]) + importMatch[0].length;
      content = content.slice(0, insertPos) + "\nimport { FileLogger } from '../utils/fileLogger';" + content.slice(insertPos);
    }
  }

  // Replace console.log patterns
  content = content.replace(/console\.log\(([^)]+)\);/g, (match, args) => {
    // Extract message from args
    const argsClean = args.trim();

    // Try to extract string literal message
    let message = 'Log';
    let context = null;

    // Pattern: console.log('[Tag] Message', { context })
    const pattern1 = /^['"](\[.+?\]\s*.+?)['"](?:,\s*(.+))?$/;
    const match1 = argsClean.match(pattern1);

    if (match1) {
      message = match1[1].replace(/^\[.+?\]\s*/, ''); // Remove [Tag] prefix
      context = match1[2] || null;
    } else {
      // Pattern: console.log('[Tag] Message')
      const pattern2 = /^['"](\[.+?\]\s*.+?)['"]$/;
      const match2 = argsClean.match(pattern2);
      if (match2) {
        message = match2[1].replace(/^\[.+?\]\s*/, '');
      }
    }

    // Build FileLogger call
    let fileLoggerCall = `FileLogger.log('${source}', 'info', '${message.replace(/'/g, "\\'")}')`;
    if (context) {
      fileLoggerCall = `FileLogger.log('${source}', 'info', '${message.replace(/'/g, "\\'")}', ${context})`;
    }

    return `${fileLoggerCall};\n  ${match}`;
  });

  // Replace console.error patterns
  content = content.replace(/console\.error\(([^)]+)\);/g, (match, args) => {
    const argsClean = args.trim();
    let message = 'Error';
    let context = null;

    const pattern1 = /^['"](\[.+?\]\s*.+?)['"](?:,\s*(.+))?$/;
    const match1 = argsClean.match(pattern1);

    if (match1) {
      message = match1[1].replace(/^\[.+?\]\s*/, '');
      context = match1[2] || null;
    }

    let fileLoggerCall = `FileLogger.log('${source}', 'error', '${message.replace(/'/g, "\\'")}')`;
    if (context) {
      fileLoggerCall = `FileLogger.log('${source}', 'error', '${message.replace(/'/g, "\\'")}', ${context})`;
    }

    return `${fileLoggerCall};\n  ${match}`;
  });

  // Replace console.warn patterns
  content = content.replace(/console\.warn\(([^)]+)\);/g, (match, args) => {
    const argsClean = args.trim();
    let message = 'Warning';
    let context = null;

    const pattern1 = /^['"](\[.+?\]\s*.+?)['"](?:,\s*(.+))?$/;
    const match1 = argsClean.match(pattern1);

    if (match1) {
      message = match1[1].replace(/^\[.+?\]\s*/, '');
      context = match1[2] || null;
    }

    let fileLoggerCall = `FileLogger.log('${source}', 'warn', '${message.replace(/'/g, "\\'")}')`;
    if (context) {
      fileLoggerCall = `FileLogger.log('${source}', 'warn', '${message.replace(/'/g, "\\'")}', ${context})`;
    }

    return `${fileLoggerCall};\n  ${match}`;
  });

  fs.writeFileSync(fullPath, content, 'utf8');
  console.log(`✓ Processed ${filePath}`);
}

// Process all files
files.forEach(file => {
  addFileLoggerToFile(file.path, file.source);
});

console.log('\n✓ All files processed');
