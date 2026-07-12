const CIRCULAR_MARKER = '[Circular]';

function normalizeForJson(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return CIRCULAR_MARKER;

  seen.add(value);
  if (Array.isArray(value)) {
    const normalized = value.map((item) => normalizeForJson(item, seen));
    seen.delete(value);
    return normalized;
  }

  const normalized: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    const label = typeof key === 'symbol' ? key.toString() : key;
    try {
      normalized[label] = normalizeForJson(Reflect.get(value, key), seen);
    } catch (error) {
      normalized[label] = `[Unreadable: ${error instanceof Error ? error.message : String(error)}]`;
    }
  }
  seen.delete(value);
  return normalized;
}

export function safeStringify(value: unknown, space?: number): string {
  try {
    const result = JSON.stringify(normalizeForJson(value, new WeakSet()), null, space);
    return result ?? String(value);
  } catch (error) {
    return `[Unserializable: ${error instanceof Error ? error.message : String(error)}]`;
  }
}
