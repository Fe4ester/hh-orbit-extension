/**
 * Send message to tab with timeout
 * Prevents infinite hangs when content script doesn't respond
 */

export async function sendMessageWithTimeout<T = any>(
  tabId: number,
  message: any,
  timeoutMs: number = 5000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Message timeout after ${timeoutMs}ms: ${message.type}`));
    }, timeoutMs);

    chrome.tabs.sendMessage(tabId, message)
      .then((response) => {
        clearTimeout(timer);
        resolve(response);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}
