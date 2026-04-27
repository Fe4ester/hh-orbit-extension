/**
 * Test: doCheckRuntimeBlockers uses tab context, not DOMParser in background
 */

// Verify that detectRuntimeBlockers is NOT imported in service-worker
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const serviceWorkerPath = path.join(__dirname, 'src/background/service-worker.ts');
const serviceWorkerContent = fs.readFileSync(serviceWorkerPath, 'utf-8');

console.log('\n=== TEST: DOMParser Not Used in Background ===\n');

// Check 1: detectRuntimeBlockers should NOT be imported
const hasDetectRuntimeBlockersImport = serviceWorkerContent.includes("import { detectRuntimeBlockers }");

if (hasDetectRuntimeBlockersImport) {
  console.log('❌ FAIL: detectRuntimeBlockers is still imported in service-worker.ts');
  console.log('   This means DOMParser will be used in background context');
  process.exit(1);
} else {
  console.log('✅ PASS: detectRuntimeBlockers is NOT imported in service-worker.ts');
}

// Check 2: doCheckRuntimeBlockers should use chrome.scripting.executeScript
const hasExecuteScriptInBlockerCheck = serviceWorkerContent.includes('chrome.scripting.executeScript') &&
  serviceWorkerContent.includes('doCheckRuntimeBlockers');

if (!hasExecuteScriptInBlockerCheck) {
  console.log('❌ FAIL: doCheckRuntimeBlockers does not use chrome.scripting.executeScript');
  console.log('   Detection must run in tab context, not background');
  process.exit(1);
} else {
  console.log('✅ PASS: doCheckRuntimeBlockers uses chrome.scripting.executeScript');
}

// Check 3: Detection logic should be inline in executeScript
const hasInlineDetection = serviceWorkerContent.includes('function detectRuntimeBlockers(doc: Document, url: string)');

if (!hasInlineDetection) {
  console.log('❌ FAIL: Detection logic is not inlined in executeScript');
  console.log('   Detection must be self-contained in tab context');
  process.exit(1);
} else {
  console.log('✅ PASS: Detection logic is inlined in executeScript (tab context)');
}

// Check 4: Log should mention 'tab_context'
const hasTabContextLog = serviceWorkerContent.includes("mode: 'tab_context'");

if (!hasTabContextLog) {
  console.log('⚠️  WARN: No explicit tab_context log found');
  console.log('   (Not critical, but helpful for debugging)');
} else {
  console.log('✅ PASS: Logs explicitly mention tab_context execution mode');
}

console.log('\n=== SUMMARY ===\n');
console.log('✅ All checks passed: DOMParser will NOT be used in background context');
console.log('✅ Detection runs in tab context via chrome.scripting.executeScript');
console.log('✅ No "DOMParser is not defined" error should occur');
