export function createStoreReadyGate(
  initStore: () => Promise<void>,
  onReady?: () => Promise<void> | void
): () => Promise<void> {
  let initialized = false;
  let initialization: Promise<void> | null = null;

  return async (): Promise<void> => {
    if (initialized) return;

    if (!initialization) {
      const attempt = (async () => {
        await initStore();
        await onReady?.();
        initialized = true;
      })();

      initialization = attempt;
      attempt.catch(() => {
        if (initialization === attempt) {
          initialization = null;
        }
      });
    }

    await initialization;
  };
}
