export function createStoreReadyGate(
  initStore: () => Promise<void>,
  onReady?: () => Promise<void> | void
): () => Promise<void> {
  const ready = (async () => {
    await initStore();
    await onReady?.();
  })();

  return async () => {
    await ready;
  };
}
