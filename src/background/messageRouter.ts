export type MigratedBackgroundMessage =
  | { type: 'CHECK_RUNTIME_BLOCKERS' }
  | { type: 'CLEAR_RUNTIME_BLOCKER' }
  | { type: 'LIVE_MODE_NEXT_SEARCH_PAGE' }
  | { type: 'LIVE_MODE_RUN_SEARCH_LOOP' };

export type BackgroundSuccess = { success: true; [key: string]: unknown };
export type BackgroundFailure = { success: false; error: string };
export type BackgroundResult = BackgroundSuccess | BackgroundFailure;

export interface MigratedMessageHandlers {
  checkRuntimeBlockers(): Promise<void>;
  clearRuntimeBlocker(): Promise<BackgroundResult>;
  nextSearchPage(): Promise<BackgroundResult>;
  runSearchLoop(): Promise<BackgroundResult>;
}

type CoreMessageHandler = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
) => boolean;

interface BackgroundMessageRouterDependencies {
  ensureStoreReady(): Promise<void>;
  isCoreMessage(message: unknown): boolean;
  coreHandler: CoreMessageHandler;
  handlers: MigratedMessageHandlers;
  onDetachedError(messageType: MigratedBackgroundMessage['type'], error: unknown): void;
}

function getMigratedMessageType(message: unknown): MigratedBackgroundMessage['type'] | null {
  if (!message || typeof message !== 'object' || !('type' in message)) return null;
  const type = (message as { type?: unknown }).type;
  if (
    type === 'CHECK_RUNTIME_BLOCKERS' ||
    type === 'CLEAR_RUNTIME_BLOCKER' ||
    type === 'LIVE_MODE_NEXT_SEARCH_PAGE' ||
    type === 'LIVE_MODE_RUN_SEARCH_LOOP'
  ) {
    return type;
  }
  return null;
}

function errorResult(error: unknown): BackgroundFailure {
  return {
    success: false,
    error: error instanceof Error ? error.message : String(error),
  };
}

export function createBackgroundMessageListener(
  dependencies: BackgroundMessageRouterDependencies
): CoreMessageHandler {
  return (message, sender, sendResponse) => {
    const type = getMigratedMessageType(message);
    if (!type) {
      if (!dependencies.isCoreMessage(message)) return false;
      return dependencies.coreHandler(message, sender, sendResponse);
    }

    if (type === 'CHECK_RUNTIME_BLOCKERS') {
      sendResponse({ success: true });
      void dependencies.ensureStoreReady()
        .then(() => dependencies.handlers.checkRuntimeBlockers())
        .catch((error) => dependencies.onDetachedError(type, error));
      return false;
    }

    const operation = dependencies.ensureStoreReady().then(() => {
      if (type === 'CLEAR_RUNTIME_BLOCKER') {
        return dependencies.handlers.clearRuntimeBlocker();
      }
      if (type === 'LIVE_MODE_NEXT_SEARCH_PAGE') {
        return dependencies.handlers.nextSearchPage();
      }
      return dependencies.handlers.runSearchLoop();
    });

    void operation.then(sendResponse, (error) => sendResponse(errorResult(error)));
    return true;
  };
}
