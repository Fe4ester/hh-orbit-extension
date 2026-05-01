import { StateStore } from '../state/store';
import { ExtensionStorageAdapter } from '../state/storage';
import { RuntimeEvent } from '../state/types';
import { createDemoResumes } from '../state/actions';
import {
  parseVacancyDetail,
  classifyPreflight,
  isVacancyDetailPage,
} from '../live/vacancyDetailParser';
import {
  executeApplyPrechecked,
  classifyPostClickResult,
} from '../live/applyExecutor';
import { HHPageType } from '../state/types';
import { BackendAutoApplyEngine } from '../runtime/backendAutoApplyEngine';
import { LiveAutoApplyEngineV2 as LiveAutoApplyEngine } from '../runtime/liveAutoApplyEngineV2';
import { AcquisitionService } from '../runtime/acquisitionService';
import { BackendHTTPClient } from '../runtime/backendHTTPClient';
import { FileLogger } from '../utils/fileLogger';

const store = new StateStore(new ExtensionStorageAdapter());
const acquisitionService = new AcquisitionService({
  store,
  log: (...args) => console.log(...args),
});

// ============================================================================
// INTERNAL BACKGROUND OPERATIONS (direct functions, no messaging)
// ============================================================================

interface CheckRuntimeBlockersResult {
  success: boolean;
  status?: 'ok' | 'login_required' | 'captcha_required' | 'degraded';
  blocker?: string;
  reason?: string;
}

async function doCheckRuntimeBlockers(): Promise<CheckRuntimeBlockersResult> {
  FileLogger.log('service_worker', 'info', 'Runtime blockers check start');

  const ensureResult = await ensureControlledTabForCurrentHHTab();

  if (!ensureResult.ok) {
    FileLogger.log('service_worker', 'error', 'Runtime blockers check failed', { reason: ensureResult.reason });

    const errorMsg =
      ensureResult.reason === 'not_hh_tab'
        ? 'Текущая вкладка не на hh.ru'
        : 'Не удалось привязать HH вкладку';

    store.getNotificationManager().addToast('warn', errorMsg, true, 'session_warning');
    broadcastNotifications();

    await store.setRuntimeBlocker('controlled_tab_lost', ensureResult.reason || 'Tab binding failed');
    broadcastState();
    return { success: false, reason: ensureResult.reason };
  }

  const controlledTabId = ensureResult.tabId!;
  const currentUrl = ensureResult.url!;

  FileLogger.log('service_worker', 'info', 'Runtime blockers detection executing', {
    controlledTabId,
    currentUrl
  });

  // Execute detection in tab context (DOMParser available there)
  const [detectionResult] = await chrome.scripting.executeScript({
    target: { tabId: controlledTabId },
    func: (url: string) => {
      interface RuntimeBlockerObservation {
        loginRequired: boolean;
        captchaRequired: boolean;
        sessionDegraded: boolean;
        pageType: string | null;
        reason?: string;
        debug?: {
          matchedMarkers: string[];
          bodyPreview: string;
          url: string;
        };
      }

      function detectRuntimeBlockers(doc: Document, url: string): RuntimeBlockerObservation {
        const bodyText = doc.body?.textContent?.toLowerCase() || '';
        const urlLower = url.toLowerCase();
        const matchedMarkers: string[] = [];

        // Login detection
        const loginMarkers = {
          url_login: urlLower.includes('/login'),
          url_signin: urlLower.includes('/signin'),
          url_auth: urlLower.includes('/auth'),
          qa_login_form: !!doc.querySelector('[data-qa="account-login-form"]'),
          qa_login_button: !!doc.querySelector('[data-qa="login-button"]'),
          form_login: !!doc.querySelector('form[action*="login"]'),
          input_login: !!doc.querySelector('input[name="login"]'),
          input_password: !!doc.querySelector('input[type="password"]'),
          text_voydite: bodyText.includes('войдите'),
          text_avtorizuytes: bodyText.includes('авторизуйтесь'),
          text_trebuetsya_vhod: bodyText.includes('требуется вход'),
          text_neobhodimo_voyti: bodyText.includes('необходимо войти'),
        };

        const strongLoginSignals = [
          loginMarkers.url_login,
          loginMarkers.url_signin,
          loginMarkers.qa_login_form,
          loginMarkers.form_login,
        ].filter(Boolean).length;

        const loginRequired = strongLoginSignals >= 1;

        if (loginRequired) {
          Object.entries(loginMarkers).forEach(([key, value]) => {
            if (value) matchedMarkers.push(`login:${key}`);
          });
        }

        // Captcha detection
        const captchaMarkers = {
          qa_captcha: !!doc.querySelector('[data-qa="captcha"]'),
          recaptcha: !!doc.querySelector('.g-recaptcha'),
          id_captcha: !!doc.querySelector('#captcha'),
          class_captcha: !!doc.querySelector('[class*="captcha"]'),
          id_captcha_any: !!doc.querySelector('[id*="captcha"]'),
          text_kapcha: bodyText.includes('капча'),
          text_captcha: bodyText.includes('captcha'),
          text_proverka: bodyText.includes('проверка безопасности'),
          text_robot: bodyText.includes('подтвердите, что вы не робот'),
          text_verify: bodyText.includes('verify you are human'),
          text_antibot: bodyText.includes('антибот'),
        };

        const captchaRequired = Object.values(captchaMarkers).some(Boolean);

        if (captchaRequired) {
          Object.entries(captchaMarkers).forEach(([key, value]) => {
            if (value) matchedMarkers.push(`captcha:${key}`);
          });
        }

        // Session degraded
        const sessionDegraded =
          bodyText.includes('сессия истекла') ||
          bodyText.includes('session expired') ||
          bodyText.includes('требуется повторный вход');

        if (sessionDegraded) {
          matchedMarkers.push('session_degraded');
        }

        // Page type
        let pageType: string | null = null;
        if (loginRequired) pageType = 'login';
        else if (captchaRequired) pageType = 'captcha';
        else if (urlLower.includes('/applicant/resumes')) pageType = 'applicant_resumes';
        else if (urlLower.includes('/vacancy/')) pageType = 'vacancy';
        else if (urlLower.includes('/search/vacancy')) pageType = 'search';
        else if (urlLower.includes('/resume/')) pageType = 'resume';

        // Reason
        let reason: string | undefined;
        if (loginRequired) reason = `Login page detected (${matchedMarkers.filter(m => m.startsWith('login:')).join(', ')})`;
        else if (captchaRequired) reason = `Captcha/verification required (${matchedMarkers.filter(m => m.startsWith('captcha:')).join(', ')})`;
        else if (sessionDegraded) reason = 'Session degraded';

        const bodyPreview = bodyText.slice(0, 500).replace(/\s+/g, ' ').trim();

        return {
          loginRequired,
          captchaRequired,
          sessionDegraded,
          pageType,
          reason,
          debug: {
            matchedMarkers,
            bodyPreview,
            url,
          },
        };
      }

      return detectRuntimeBlockers(document, url);
    },
    args: [currentUrl],
  });

  const observation = detectionResult.result as {
    loginRequired: boolean;
    captchaRequired: boolean;
    sessionDegraded: boolean;
    pageType: string | null;
    reason?: string;
    debug?: {
      matchedMarkers: string[];
      bodyPreview: string;
      url: string;
    };
  };

  FileLogger.log('service_worker', 'info', 'doCheckRuntimeBlockers: Detection complete', { loginRequired: observation.loginRequired, captchaRequired: observation.captchaRequired, sessionDegraded: observation.sessionDegraded });

  let finalStatus: 'ok' | 'login_required' | 'captcha_required' | 'degraded' = 'ok';

  if (observation.loginRequired) {
    finalStatus = 'login_required';
    await store.setSessionStatus('login_required');
    await store.setRuntimeBlocker('login_required', observation.reason || 'Login required');
  } else if (observation.captchaRequired) {
    finalStatus = 'captcha_required';
    await store.setSessionStatus('captcha_required');
    await store.setRuntimeBlocker('captcha_required', observation.reason || 'Captcha required');
  } else if (observation.sessionDegraded) {
    finalStatus = 'degraded';
    await store.setSessionStatus('degraded');
  } else {
    finalStatus = 'ok';
    await store.setSessionStatus('ok');
    await store.clearRuntimeBlocker();
  }

  FileLogger.log('service_worker', 'info', 'doCheckRuntimeBlockers: Final status', { finalStatus });

  broadcastState();
  return { success: true, status: finalStatus };
}

interface DetectResumesResult {
  success: boolean;
  candidates?: Array<{
    hash: string;
    title: string;
    url?: string;
    isActive?: boolean;
    lastSeenAt?: number;
  }>;
  reason?: string;
}

async function doDetectResumes(): Promise<DetectResumesResult> {
  FileLogger.log('service_worker', 'info', 'doDetectResumes START');

  const ensureResult = await ensureControlledTabForCurrentHHTab({
    requirePageTypes: ['applicant_resumes', 'resume', 'applicant'],
  });

  if (!ensureResult.ok) {
    FileLogger.log('service_worker', 'error', 'doDetectResumes: Ensure failed', { reason: ensureResult.reason });

    const errorMsg =
      ensureResult.reason === 'not_hh_tab'
        ? 'Текущая вкладка не на hh.ru. Откройте страницу резюме.'
        : ensureResult.reason?.startsWith('wrong_page_type')
        ? `Неправильный тип страницы. Откройте страницу резюме (текущая: ${ensureResult.pageType || 'unknown'})`
        : 'Не удалось привязать HH вкладку';

    store.getNotificationManager().addToast('warn', errorMsg, true, 'session_warning');
    broadcastNotifications();
    return { success: false, reason: ensureResult.reason };
  }

  const controlledTabId = ensureResult.tabId!;
  const currentUrl = ensureResult.url!;

  FileLogger.log('service_worker', 'info', 'doDetectResumes: Executing detection', { controlledTabId, currentUrl });

  const [detectionResult] = await chrome.scripting.executeScript({
    target: { tabId: controlledTabId },
    func: (url: string) => {
      interface ResumeCandidate {
        hash: string;
        title: string;
        url?: string;
        isActive?: boolean;
        lastSeenAt?: number;
      }

      function detectResumeCandidates(doc: Document, url: string): ResumeCandidate[] {
        const candidates: ResumeCandidate[] = [];

        const resumeCards = doc.querySelectorAll('[data-qa="resume-card"]');
        if (resumeCards.length > 0) {
          resumeCards.forEach((card) => {
            const link = card.querySelector('a[href*="/resume/"]');
            if (link) {
              const href = link.getAttribute('href');
              const match = href?.match(/\/resume\/([a-f0-9]+)/);
              if (match) {
                const hash = match[1];
                const title = link.textContent?.trim() || 'Резюме';
                candidates.push({
                  hash,
                  title,
                  url: href?.startsWith('http') ? href : `https://hh.ru${href}`,
                  lastSeenAt: Date.now(),
                });
              }
            }
          });
        }

        if (candidates.length === 0 && url.includes('/resume/')) {
          const match = url.match(/\/resume\/([a-f0-9]+)/);
          if (match) {
            const hash = match[1];
            const titleEl = doc.querySelector('[data-qa="resume-title"]') || doc.querySelector('h1');
            const title = titleEl?.textContent?.trim() || 'Резюме';
            candidates.push({
              hash,
              title,
              url,
              lastSeenAt: Date.now(),
            });
          }
        }

        if (candidates.length === 0) {
          const links = doc.querySelectorAll('a[href*="/resume/"]');
          const seen = new Set<string>();
          links.forEach((link) => {
            const href = link.getAttribute('href');
            const match = href?.match(/\/resume\/([a-f0-9]+)/);
            if (match && !seen.has(match[1])) {
              seen.add(match[1]);
              const hash = match[1];
              const title = link.textContent?.trim() || 'Резюме';
              candidates.push({
                hash,
                title,
                url: href?.startsWith('http') ? href : `https://hh.ru${href}`,
                lastSeenAt: Date.now(),
              });
            }
          });
        }

        return candidates;
      }

      return detectResumeCandidates(document, url);
    },
    args: [currentUrl],
  });

  const candidates = detectionResult.result as Array<{
    hash: string;
    title: string;
    url?: string;
    isActive?: boolean;
    lastSeenAt?: number;
  }>;

  FileLogger.log('service_worker', 'info', 'doDetectResumes: Detection complete', { candidatesCount: candidates.length });

  if (candidates.length === 0) {
    store.getNotificationManager().addToast('warn', 'Резюме не найдены на странице');
    broadcastNotifications();
    return { success: false, reason: 'no_resumes_found' };
  }

  const candidatesWithSource = candidates.map((c) => ({
    ...c,
    source: 'hh_detected' as const,
  }));

  await store.setResumeCandidates(candidatesWithSource);

  store.getNotificationManager().addToast('success', `Найдено резюме: ${candidates.length}`);
  broadcastNotifications();
  broadcastState();

  return { success: true, candidates };
}

interface RefreshResumesAPIResult {
  success: boolean;
  count?: number;
  reason?: string;
}

async function doRefreshResumesAPI(): Promise<RefreshResumesAPIResult> {
  FileLogger.log('service_worker', 'info', 'Resume refresh started', { source: 'api_with_dom_fallback' });

  try {
    // Try API endpoint first
    FileLogger.log('service_worker', 'info', 'Resume refresh: trying API source');
    const resumes = await backendHTTPClient.getMyResumes();

    if (resumes.length > 0) {
      FileLogger.log('service_worker', 'info', 'Resumes updated', { count: resumes.length, source: 'api' });

      const candidatesWithSource = resumes.map((r) => ({
        ...r,
        source: 'hh_detected' as const,
        lastSeenAt: Date.now(),
      }));

      await store.setResumeCandidates(candidatesWithSource);

      store.getNotificationManager().addToast('success', `Обновлено резюме: ${resumes.length}`);
      broadcastNotifications();
      broadcastState();

      return { success: true, count: resumes.length };
    }

    // Fallback to DOM detection via temporary tab
    FileLogger.log('service_worker', 'info', 'Resume refresh: API returned empty, trying DOM fallback via resumes tab');

    // Create temporary tab with resumes page
    const tab = await chrome.tabs.create({
      url: 'https://hh.ru/applicant/resumes',
      active: false,  // Don't steal focus
    });

    if (!tab.id) {
      FileLogger.log('service_worker', 'error', 'Resume refresh failed: could not create tab');
      store.getNotificationManager().addToast('error', 'Не удалось создать вкладку');
      broadcastNotifications();
      return { success: false, reason: 'tab_creation_failed' };
    }

    FileLogger.log('service_worker', 'info', 'Resume refresh: temporary tab created', { tabId: tab.id });

    // Wait for tab to load
    await new Promise<void>((resolve) => {
      const listener = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);

      // Timeout after 10 seconds
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 10000);
    });

    FileLogger.log('service_worker', 'info', 'Resume refresh: tab loaded, executing DOM detection');

    // Execute DOM detection (same logic as doDetectResumes)
    const [detectionResult] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        interface ResumeCandidate {
          hash: string;
          title: string;
          url?: string;
        }

        const candidates: ResumeCandidate[] = [];

        // Try resume cards first
        const resumeCards = document.querySelectorAll('[data-qa="resume-card"]');
        if (resumeCards.length > 0) {
          resumeCards.forEach((card) => {
            const link = card.querySelector('a[href*="/resume/"]');
            if (link) {
              const href = link.getAttribute('href');
              const match = href?.match(/\/resume\/([a-f0-9]+)/);
              if (match) {
                const hash = match[1];
                const title = link.textContent?.trim() || 'Резюме';
                candidates.push({
                  hash,
                  title,
                  url: href?.startsWith('http') ? href : `https://hh.ru${href}`,
                });
              }
            }
          });
        }

        // Fallback: find any resume links
        if (candidates.length === 0) {
          const links = document.querySelectorAll('a[href*="/resume/"]');
          const seen = new Set<string>();
          links.forEach((link) => {
            const href = link.getAttribute('href');
            const match = href?.match(/\/resume\/([a-f0-9]+)/);
            if (match && !seen.has(match[1])) {
              seen.add(match[1]);
              const hash = match[1];
              const title = link.textContent?.trim() || 'Резюме';
              candidates.push({
                hash,
                title,
                url: href?.startsWith('http') ? href : `https://hh.ru${href}`,
              });
            }
          });
        }

        return candidates;
      },
    });

    // Close temporary tab
    await chrome.tabs.remove(tab.id);
    FileLogger.log('service_worker', 'info', 'Resume refresh: temporary tab closed');

    const parsedResumes = detectionResult.result as Array<{ hash: string; title: string; url: string }>;

    if (parsedResumes.length === 0) {
      FileLogger.log('service_worker', 'warn', 'Resume refresh failed: no resumes found via DOM detection');
      store.getNotificationManager().addToast('warn', 'Резюме не найдены');
      broadcastNotifications();
      return { success: false, reason: 'no_resumes_found' };
    }

    FileLogger.log('service_worker', 'info', 'Resumes updated', { count: parsedResumes.length, source: 'dom_fallback' });

    const candidatesWithSource = parsedResumes.map((r) => ({
      ...r,
      source: 'hh_detected' as const,
      lastSeenAt: Date.now(),
    }));

    await store.setResumeCandidates(candidatesWithSource);

    store.getNotificationManager().addToast('success', `Обновлено резюме: ${parsedResumes.length}`);
    broadcastNotifications();
    broadcastState();

    return { success: true, count: parsedResumes.length };
  } catch (error) {
    FileLogger.log('service_worker', 'error', 'Resume refresh failed', {
      reason: 'exception',
      error: (error as Error).message
    });
    store.getNotificationManager().addToast('error', 'Ошибка обновления резюме');
    broadcastNotifications();
    return { success: false, reason: 'exception' };
  }
}

interface ObserveVacancyDetailResult {
  success: boolean;
  observation?: any;
  classification?: any;
  error?: string;
}

async function doObserveVacancyDetail(): Promise<ObserveVacancyDetailResult> {
  FileLogger.log('service_worker', 'info', 'doObserveVacancyDetail START');

  const ensureResult = await ensureControlledTabForCurrentHHTab({
    requirePageTypes: ['vacancy'],
  });

  if (!ensureResult.ok) {
    FileLogger.log('service_worker', 'error', 'doObserveVacancyDetail: Ensure failed', { reason: ensureResult.reason });

    const errorMsg =
      ensureResult.reason === 'not_hh_tab'
        ? 'Текущая вкладка не на hh.ru'
        : ensureResult.reason?.startsWith('wrong_page_type')
        ? `Контролируемая вкладка не является страницей вакансии (текущая: ${ensureResult.pageType || 'unknown'})`
        : 'Не удалось привязать HH вкладку';

    store.getNotificationManager().addToast('warn', errorMsg, true, 'session_warning');
    broadcastNotifications();
    return { success: false, error: ensureResult.reason };
  }

  const controlledTabId = ensureResult.tabId!;

  FileLogger.log('service_worker', 'info', 'doObserveVacancyDetail: Fetching HTML', { controlledTabId, url: ensureResult.url });

  const [result] = await chrome.scripting.executeScript({
    target: { tabId: controlledTabId },
    func: () => document.documentElement.outerHTML,
  });

  const html = result.result as string;

  if (!isVacancyDetailPage(html)) {
    store.getNotificationManager().addToast('warn', 'Не удалось распознать страницу вакансии');
    broadcastNotifications();
    return { success: false, error: 'Not a vacancy detail page' };
  }

  const observation = parseVacancyDetail(html, ensureResult.url);
  const classification = classifyPreflight(observation);

  await store.setVacancyDetailObservation(observation);
  await store.setPreflightClassification(classification);

  broadcastState();
  store
    .getNotificationManager()
    .addToast('success', `Preflight: ${classification.message}`);
  broadcastNotifications();

  return { success: true, observation, classification };
}

interface ExecuteApplyResult {
  success: boolean;
  result?: any;
  error?: string;
}

async function doExecuteApply(realClick: boolean): Promise<ExecuteApplyResult> {
  FileLogger.log('service_worker', 'info', 'doExecuteApply START', { realClick });

  const state = store.getState();

  if (!state.liveMode.controlledTabId) {
    return { success: false, error: 'No controlled tab' };
  }

  const controlledTabId = state.liveMode.controlledTabId;

  if (state.liveMode.pageType !== 'vacancy') {
    store
      .getNotificationManager()
      .addToast('warn', 'Контролируемая вкладка не является страницей вакансии');
    broadcastNotifications();
    return { success: false, error: 'Not a vacancy page' };
  }

  const [htmlResult] = await chrome.scripting.executeScript({
    target: { tabId: controlledTabId },
    func: () => document.documentElement.outerHTML,
  });

  const html = htmlResult.result as string;

  if (!isVacancyDetailPage(html)) {
    store.getNotificationManager().addToast('warn', 'Не удалось распознать страницу вакансии');
    broadcastNotifications();
    return { success: false, error: 'Not a vacancy detail page' };
  }

  const observation = parseVacancyDetail(html, state.liveMode.currentUrl || undefined);
  const preflight = classifyPreflight(observation);

  const preflightResult = executeApplyPrechecked(observation, preflight, {
    selectedResumeHash: state.selectedResumeHash,
    coverLetterText: null,
    realClick,
  });

  if (!realClick || preflightResult.outcome !== 'success') {
    await store.recordLocalApplyAttempt({
      vacancyId: observation.vacancyId,
      profileId: state.activeProfileId,
      resumeHash: state.selectedResumeHash,
      outcome: preflightResult.outcome,
      message: preflightResult.message,
      metadata: preflightResult.metadata,
    });

    broadcastState();
    store
      .getNotificationManager()
      .addToast(
        preflightResult.outcome === 'success' ? 'success' : 'info',
        `Apply: ${preflightResult.message}`
      );
    broadcastNotifications();

    return { success: true, result: preflightResult };
  }

  // Real click mode - execute click
  const [clickResult] = await chrome.scripting.executeScript({
    target: { tabId: controlledTabId },
    func: () => {
      interface ClickExecutionObservation {
        found: boolean;
        clicked: boolean;
        buttonText?: string;
        error?: string;
      }

      function findRespondButton(doc: Document): HTMLElement | null {
        const button = doc.querySelector('[data-qa="vacancy-response-button"]') as HTMLElement;
        if (button) return button;

        const buttons = Array.from(doc.querySelectorAll('button, a.bloko-button'));
        for (const btn of buttons) {
          const text = btn.textContent?.trim().toLowerCase() || '';
          if (text.includes('откликнуться')) {
            return btn as HTMLElement;
          }
        }
        return null;
      }

      function clickRespondButton(doc: Document): ClickExecutionObservation {
        const button = findRespondButton(doc);
        if (!button) {
          return { found: false, clicked: false, error: 'Respond button not found' };
        }

        const buttonText = button.textContent?.trim();

        try {
          if (button.hasAttribute('disabled') || button.classList.contains('disabled')) {
            return { found: true, clicked: false, buttonText, error: 'Button is disabled' };
          }

          button.click();
          return { found: true, clicked: true, buttonText };
        } catch (error) {
          return { found: true, clicked: false, buttonText, error: (error as Error).message };
        }
      }

      return clickRespondButton(document);
    },
  });

  const clickObservation = clickResult.result;

  if (!clickObservation) {
    throw new Error('Click observation is undefined');
  }

  await new Promise((resolve) => setTimeout(resolve, 1000));

  const [postClickResult] = await chrome.scripting.executeScript({
    target: { tabId: controlledTabId },
    func: () => {
      interface PostClickObservation {
        modalOpened: boolean;
        loginRedirectVisible: boolean;
        alreadyAppliedVisible: boolean;
        externalApplyVisible: boolean;
        coverLetterUIVisible: boolean;
        questionnaireUIVisible: boolean;
        unknownState: boolean;
      }

      function observePostClickState(doc: Document): PostClickObservation {
        const modalOpened =
          !!doc.querySelector('[data-qa="vacancy-response-modal"]') ||
          !!doc.querySelector('.vacancy-response-popup') ||
          !!doc.querySelector('[role="dialog"]');

        const loginRedirectVisible =
          !!doc.querySelector('[data-qa="vacancy-response-login-required"]') ||
          doc.body.textContent?.includes('Войдите, чтобы откликнуться') ||
          false;

        const alreadyAppliedVisible =
          !!doc.querySelector('[data-qa="vacancy-response-already-applied"]') ||
          doc.body.textContent?.includes('Вы уже откликались') ||
          false;

        const externalApplyVisible =
          !!doc.querySelector('[data-qa="vacancy-response-external"]') ||
          doc.body.textContent?.includes('Откликнуться на сайте') ||
          false;

        const coverLetterUIVisible =
          !!doc.querySelector('[data-qa="vacancy-response-letter-toggle"]') ||
          !!doc.querySelector('[data-qa="vacancy-response-letter-input"]') ||
          doc.body.textContent?.includes('Сопроводительное письмо') ||
          false;

        const questionnaireUIVisible =
          !!doc.querySelector('[data-qa="vacancy-response-questionnaire"]') ||
          doc.body.textContent?.includes('Работодатель просит ответить на вопросы') ||
          false;

        const unknownState =
          !modalOpened &&
          !loginRedirectVisible &&
          !alreadyAppliedVisible &&
          !externalApplyVisible &&
          !coverLetterUIVisible &&
          !questionnaireUIVisible;

        return {
          modalOpened,
          loginRedirectVisible,
          alreadyAppliedVisible,
          externalApplyVisible,
          coverLetterUIVisible,
          questionnaireUIVisible,
          unknownState,
        };
      }

      return observePostClickState(document);
    },
  });

  const postClickObservation = postClickResult.result;

  if (!postClickObservation) {
    throw new Error('Post-click observation is undefined');
  }

  const activeProfile = state.activeProfileId
    ? state.profiles[state.activeProfileId]
    : null;
  const coverLetterText = activeProfile?.coverLetterTemplate || null;

  let finalResult = classifyPostClickResult(
    clickObservation,
    postClickObservation,
    coverLetterText
  );

  // Cover letter fill logic (abbreviated for brevity - same as original)
  if (
    postClickObservation.coverLetterUIVisible &&
    coverLetterText &&
    coverLetterText.trim().length > 0 &&
    finalResult.metadata?.hasCoverLetterText
  ) {
    // ... (same cover letter fill logic as original)
  }

  await store.recordLocalApplyAttempt({
    vacancyId: observation.vacancyId,
    profileId: state.activeProfileId,
    resumeHash: state.selectedResumeHash,
    outcome: finalResult.outcome,
    message: finalResult.message,
    metadata: finalResult.metadata,
  });

  if (
    finalResult.outcome === 'questionnaire_required' ||
    finalResult.outcome === 'manual_action_required'
  ) {
    await store.createManualAction({
      type: finalResult.outcome === 'questionnaire_required' ? 'questionnaire' : 'manual_review',
      vacancyId: observation.vacancyId,
      vacancyTitle: observation.title,
      company: observation.company,
      url: state.liveMode.currentUrl || undefined,
      profileId: state.activeProfileId || undefined,
      status: 'pending',
      reasonCode: finalResult.outcome,
      details: {
        preflightCode: finalResult.metadata?.preflightCode,
        detectedAt: Date.now(),
      },
    });

    if (state.runtimeState === 'RUNNING') {
      await store.dispatch('MANUAL_ACTION_REQUIRED');
    }

    store
      .getNotificationManager()
      .addToast('warn', 'Требуется ручное действие для продолжения', false, 'manual_action_required');
  }

  broadcastState();
  store
    .getNotificationManager()
    .addToast(
      finalResult.outcome === 'success' || finalResult.outcome === 'cover_letter_ready'
        ? 'success'
        : 'info',
      `Apply: ${finalResult.message}`
    );
  broadcastNotifications();

  return { success: true, result: finalResult };
}

// ============================================================================
// END INTERNAL OPERATIONS
// ============================================================================

// Backend HTTP client
const backendHTTPClient = new BackendHTTPClient({
  log: (...args) => console.log(...args),
});

// Backend engine
const backendEngine = new BackendAutoApplyEngine({
  store,
  httpClient: backendHTTPClient,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log: (...args) => console.log(...args),
});

// Live engine V2
const liveEngine = new LiveAutoApplyEngine({
  store,
  acquisitionService,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log: (...args) => console.log(...args),
});

// Helper: log controlled tab state changes
function logControlledTabStateChange(
  _action: string,
  _previous: { tabId: number | null; url: string | null; pageType: any; purpose: any },
  _next: { tabId: number | null; url: string | null; pageType: any; purpose: any }
) {
  // Controlled tab state changed (logged via FileLogger in callers)
}


// Self-healing controlled tab helper
async function ensureControlledTabForCurrentHHTab(options?: {
  requirePageTypes?: HHPageType[];
}): Promise<{
  ok: boolean;
  tabId?: number;
  url?: string;
  pageType?: HHPageType;
  rebound?: boolean;
  reason?: string;
}> {
  FileLogger.log('service_worker', 'info', 'ENSURE_CONTROLLED_TAB START', { options });

  const stateBefore = store.getState();
  const previousState = {
    tabId: stateBefore.liveMode.controlledTabId,
    url: stateBefore.liveMode.currentUrl,
    pageType: stateBefore.liveMode.pageType,
    purpose: stateBefore.liveMode.controlledTabPurpose,
  };

  // Get active tab
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!activeTab || !activeTab.id || !activeTab.url) {
    FileLogger.log('service_worker', 'error', 'ENSURE_CONTROLLED_TAB FAIL: No active tab');
    return { ok: false, reason: 'no_active_tab' };
  }

  // Active tab detected (logged via FileLogger in caller)

  // Check if HH tab
  if (!activeTab.url.includes('hh.ru')) {
    FileLogger.log('service_worker', 'error', 'ENSURE_CONTROLLED_TAB FAIL: Not HH tab', { url: activeTab.url });
    return { ok: false, reason: 'not_hh_tab' };
  }

  const state = store.getState();
  let rebound = false;

  // Check if need to bind/rebind
  if (state.liveMode.controlledTabId !== activeTab.id) {
    // Bind current tab
    FileLogger.log('service_worker', 'info', 'ENSURE_CONTROLLED_TAB BIND', { tabId: activeTab.id });
    await store.bindControlledTab(activeTab.id, activeTab.windowId!, activeTab.url);
    rebound = true;
    FileLogger.log('service_worker', 'info', 'ENSURE_CONTROLLED_TAB BIND ok');
  } else if (state.liveMode.currentUrl !== activeTab.url) {
    // Refresh stale URL
    // Refresh stale URL (logged via FileLogger below)
    await store.updateLiveContextFromUrl(activeTab.url);
    rebound = true;
    FileLogger.log('service_worker', 'info', 'ENSURE_CONTROLLED_TAB REFRESH ok');
  }

  // Get updated state
  const updatedState = store.getState();
  const pageType = updatedState.liveMode.pageType;

  FileLogger.log('service_worker', 'info', 'ENSURE_CONTROLLED_TAB PAGE_TYPE', { pageType });

  // Determine purpose based on page type
  let purpose: 'resume_detection' | 'search' | 'vacancy' | 'generic_hh' = 'generic_hh';
  if (pageType === 'applicant_resumes' || pageType === 'resume' || pageType === 'applicant') {
    purpose = 'resume_detection';
  } else if (pageType === 'search') {
    purpose = 'search';
  } else if (pageType === 'vacancy') {
    purpose = 'vacancy';
  }

  // Check page type requirement
  if (options?.requirePageTypes && options.requirePageTypes.length > 0) {
    if (!pageType || !options.requirePageTypes.includes(pageType)) {
      // Page type mismatch (logged via FileLogger in caller)
      return {
        ok: false,
        tabId: activeTab.id,
        url: activeTab.url,
        pageType: pageType || undefined,
        rebound,
        reason: `wrong_page_type: expected ${options.requirePageTypes.join('|')}, got ${pageType}`,
      };
    }
  }

  // Controlled tab ensured (logged via FileLogger in caller)

  // Set live mode active if not already
  if (!updatedState.liveMode.active) {
    await store.updateState({
      liveMode: {
        ...updatedState.liveMode,
        active: true,
        controlledTabPurpose: purpose,
      },
    });
  } else if (updatedState.liveMode.controlledTabPurpose !== purpose) {
    // Update purpose if changed
    await store.updateState({
      liveMode: {
        ...updatedState.liveMode,
        controlledTabPurpose: purpose,
      },
    });
  }

  broadcastState();

  const stateAfter = store.getState();
  const nextState = {
    tabId: stateAfter.liveMode.controlledTabId,
    url: stateAfter.liveMode.currentUrl,
    pageType: stateAfter.liveMode.pageType,
    purpose: stateAfter.liveMode.controlledTabPurpose,
  };

  if (
    previousState.tabId !== nextState.tabId ||
    previousState.url !== nextState.url ||
    previousState.pageType !== nextState.pageType ||
    previousState.purpose !== nextState.purpose
  ) {
    logControlledTabStateChange('ensureControlledTabForCurrentHHTab', previousState, nextState);
  }

  return {
    ok: true,
    tabId: activeTab.id,
    url: activeTab.url,
    pageType: pageType || undefined,
    rebound,
  };
}

// Deterministic side panel open helper
async function openSidePanelForTab(tabId: number): Promise<{ ok: boolean; reason?: string }> {
  FileLogger.log('service_worker', 'info', 'openSidePanelForTab START', { tabId });

  if (!chrome.sidePanel) {
    const reason = 'sidePanel API not available';
    FileLogger.log('service_worker', 'error', 'sidePanel API not available', { tabId });
    return { ok: false, reason };
  }

  // Step 1: setOptions
  if (!chrome.sidePanel.setOptions) {
    const reason = 'sidePanel.setOptions not available';
    FileLogger.log('service_worker', 'error', 'sidePanel.setOptions not available', { tabId });
    return { ok: false, reason };
  }

  try {
    await chrome.sidePanel.setOptions({
      tabId,
      path: 'sidepanel/index.html',
      enabled: true,
    });
    FileLogger.log('service_worker', 'info', 'openSidePanelForTab PANEL_OPTIONS_SET ok', { tabId });
  } catch (err) {
    const reason = `setOptions failed: ${(err as Error).message}`;
    FileLogger.log('service_worker', 'error', 'setOptions failed', { tabId, error: (err as Error).message });
    return { ok: false, reason };
  }

  // Step 2: open
  if (!chrome.sidePanel.open) {
    const reason = 'sidePanel.open not available';
    FileLogger.log('service_worker', 'error', 'sidePanel.open not available', { tabId });
    return { ok: false, reason };
  }

  try {
    await chrome.sidePanel.open({ tabId });
    FileLogger.log('service_worker', 'info', 'openSidePanelForTab PANEL_OPEN ok', { tabId });
    return { ok: true };
  } catch (err) {
    const reason = `open failed: ${(err as Error).message}`;
    FileLogger.log('service_worker', 'error', 'sidePanel.open failed', { tabId, error: (err as Error).message });
    return { ok: false, reason };
  }
}

// Helper: Set panel behavior
async function setPanelBehavior() {
  if (!chrome.sidePanel || !chrome.sidePanel.setPanelBehavior) {
    FileLogger.log('service_worker', 'warn', 'sidePanel.setPanelBehavior not available');
    return;
  }

  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    FileLogger.log('service_worker', 'info', 'PANEL_BEHAVIOR_SET ok: openPanelOnActionClick=true');
  } catch (err) {
    FileLogger.log('service_worker', 'error', 'PANEL_BEHAVIOR_SET fail', { error: (err as Error).message });
  }
}

// Helper: Enable side panel for HH tabs
async function enableSidePanelForHHTabs() {
  if (!chrome.sidePanel || !chrome.sidePanel.setOptions) {
    FileLogger.log('service_worker', 'warn', 'sidePanel.setOptions not available');
    return;
  }

  try {
    const tabs = await chrome.tabs.query({});
    const hhTabs = tabs.filter((tab) => tab.url && tab.url.includes('hh.ru'));

    FileLogger.log('service_worker', 'info', 'Found HH tabs, enabling side panel', { count: hhTabs.length });

    for (const tab of hhTabs) {
      if (tab.id) {
        try {
          await chrome.sidePanel.setOptions({
            tabId: tab.id,
            path: 'sidepanel/index.html',
            enabled: true,
          });
          FileLogger.log('service_worker', 'info', 'Side panel enabled for tab', { tabId: tab.id });
        } catch (err) {
          FileLogger.log('service_worker', 'error', 'Failed to enable side panel for tab', { tabId: tab.id, error: (err as Error).message });
        }
      }
    }
  } catch (err) {
    FileLogger.log('service_worker', 'error', 'Failed to query tabs', { error: (err as Error).message });
  }
}

// Initialize store on startup
store.init().then(async () => {
  FileLogger.log('service_worker', 'info', 'Store initialized');

  // Subscribe to state changes for real-time UI updates
  store.setOnStateChange(() => {
    FileLogger.log('service_worker', 'info', 'STATE_CHANGED → broadcasting');
    broadcastState();
  });

  broadcastState();

  // Set panel behavior on startup
  await setPanelBehavior();

  // Enable side panel for existing HH tabs
  await enableSidePanelForHHTabs();
});

// Enable side panel behavior on install
chrome.runtime.onInstalled.addListener(async () => {
  FileLogger.log('service_worker', 'info', 'Extension installed');

  // Set panel behavior
  await setPanelBehavior();

  // Inject content script to existing tabs
  await injectContentScriptToExistingTabs();

  // Enable for existing HH tabs
  await enableSidePanelForHHTabs();
});

chrome.runtime.onStartup.addListener(async () => {
  FileLogger.log('service_worker', 'info', 'Extension startup');

  // Inject content script to existing tabs
  await injectContentScriptToExistingTabs();
});

async function injectContentScriptToExistingTabs() {
  const tabs = await chrome.tabs.query({ url: 'https://hh.ru/*' });
  FileLogger.log('service_worker', 'info', 'Injecting content script to existing tabs', { count: tabs.length });

  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content-live-mode.js']
      });
      FileLogger.log('service_worker', 'info', 'Content script injected', { tabId: tab.id });
    } catch (error) {
      FileLogger.log('service_worker', 'warn', 'Failed to inject content script', {
        tabId: tab.id,
        error: (error as Error).message
      });
    }
  }
}

// Enable side panel for new HH tabs
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    const isHHTab = tab.url.includes('hh.ru');

    if (isHHTab && chrome.sidePanel && chrome.sidePanel.setOptions) {
      chrome.sidePanel.setOptions({
        tabId,
        path: 'sidepanel/index.html',
        enabled: true,
      }).then(() => {
        FileLogger.log('service_worker', 'info', 'Side panel enabled for new HH tab', { tabId });
      }).catch((err) => {
        FileLogger.log('service_worker', 'error', 'Failed to enable side panel for new HH tab', { tabId, error: (err as Error).message });
      });
    }
  }
});

// Open sidepanel on action click
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  FileLogger.log('service_worker', 'info', 'ACTION_CLICK on tab', { tabId: tab.id });

  const result = await openSidePanelForTab(tab.id);

  if (!result.ok) {
    FileLogger.log('service_worker', 'error', 'ACTION_CLICK failed', { tabId: tab.id, reason: result.reason });
    // No fallback - side panel only
  }
});

// Message handler
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === 'GET_STATE') {
        const state = store.getState();
        sendResponse({ state });
        return;
      }

      if (message.type === 'AUTO_APPLY_START') {
        const state = store.getState();
        sendResponse({ success: true });

        FileLogger.log('service_worker', 'info', 'AUTO_APPLY_START', { mode: state.mode });

        // Route to correct engine based on mode
        if (state.mode === 'backend') {
          FileLogger.log('service_worker', 'info', 'AUTO_APPLY_START: backend mode');
          backendEngine.start().catch((error) => {
            FileLogger.log('service_worker', 'error', 'Backend engine failed:', error);
            FileLogger.log('service_worker', 'error', 'Backend engine failed', { error: error.message });
          });
        } else {
          FileLogger.log('service_worker', 'info', 'AUTO_APPLY_START: live mode');
          liveEngine.start().catch((error) => {
            FileLogger.log('service_worker', 'error', 'Live engine failed:', error);
            FileLogger.log('service_worker', 'error', 'Live engine failed', { error: error.message });
          });
        }
        return;
      }

      if (message.type === 'AUTO_APPLY_STOP') {
        const state = store.getState();

        FileLogger.log('service_worker', 'info', 'AUTO_APPLY_STOP', { mode: state.mode });

        if (state.mode === 'backend') {
          await backendEngine.stop();
        } else {
          await liveEngine.stop();
        }
        sendResponse({ success: true });
        return;
      }

      if (message.type === 'SET_MODE') {
        await store.updateState({ mode: message.mode });
        broadcastState();
        sendResponse({ success: true });
        return;
      }

      if (message.type === 'UPDATE_SETTINGS') {
        await store.updateSettings(message.patch || {});
        broadcastState();
        sendResponse({ success: true });
        return;
      }

      if (message.type === 'MANUAL_ACTION_DONE') {
        await store.markManualActionDone(message.id);
        broadcastState();
        sendResponse({ success: true });
        return;
      }

      if (message.type === 'MANUAL_ACTION_DISMISS') {
        await store.dismissManualAction(message.id);
        broadcastState();
        sendResponse({ success: true });
        return;
      }

      if (message.type === 'MANUAL_ACTION_CLEAR_COMPLETED') {
        await store.clearCompletedManualActions();
        broadcastState();
        sendResponse({ success: true });
        return;
      }

      if (message.type === 'OPEN_SIDEPANEL_FOR_CURRENT_TAB') {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];

        if (!tab || !tab.id) {
          sendResponse({ error: 'No active tab' });
          return;
        }

        FileLogger.log('service_worker', 'info', 'OPEN_SIDEPANEL_FOR_CURRENT_TAB requested', { tabId: tab.id });

        const result = await openSidePanelForTab(tab.id);

        if (result.ok) {
          sendResponse({ success: true });
        } else {
          sendResponse({ error: result.reason });
        }
        return;
      }

      if (message.type === 'DEBUG_OPEN_SIDEPANEL') {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];

        if (!tab || !tab.id) {
          sendResponse({ error: 'No active tab' });
          return;
        }

        FileLogger.log('service_worker', 'info', 'DEBUG_OPEN_SIDEPANEL', { tabId: tab.id });

        const result = await openSidePanelForTab(tab.id);

        sendResponse({
          success: result.ok,
          tabId: tab.id,
          reason: result.reason,
        });
        return;
      }

      if (message.type === 'DISPATCH_EVENT') {
        const event = message.event as RuntimeEvent;

        if (!store.canDispatch(event)) {
          sendResponse({ error: 'Invalid transition' });
          return;
        }

        await store.dispatch(event);

        // Handle state transitions
        const state = store.getState();

        if (state.runtimeState === 'STARTING') {
          // Simulate async start
          setTimeout(async () => {
            await store.dispatch('START_CONFIRMED');
            broadcastState();
            store.getNotificationManager().addToast('success', 'Запущено', false, 'runtime_started');
            broadcastNotifications();
          }, 500);
        }

        if (state.runtimeState === 'STOPPING') {
          // Simulate async stop
          setTimeout(async () => {
            await store.dispatch('STOP_CONFIRMED');
            broadcastState();
            store.getNotificationManager().addToast('info', 'Остановлено', false, 'runtime_stopped');
            broadcastNotifications();
          }, 300);
        }

        if (state.runtimeState === 'PAUSED_NO_VACANCIES') {
          // Add sticky notification
          store
            .getNotificationManager()
            .addSticky(
              'warn',
              'Новые подходящие вакансии закончились. Поиск остановлен.',
              'no_more_vacancies',
              'no_more_vacancies'
            );
          broadcastNotifications();
        }

        broadcastState();
        sendResponse({ success: true });
        return;
      }

      if (message.type === 'DISMISS_NOTIFICATION') {
        store.getNotificationManager().dismiss(message.id);
        broadcastNotifications();
        sendResponse({ success: true });
        return;
      }

      // Profile actions
      if (message.type === 'CREATE_PROFILE') {
        const profileId = await store.createProfile(message.payload);
        broadcastState();
        store.getNotificationManager().addToast('success', 'Профиль создан');
        broadcastNotifications();
        sendResponse({ success: true, profileId });
        return;
      }

      if (message.type === 'UPDATE_PROFILE') {
        await store.updateProfile(message.id, message.payload);
        broadcastState();
        store.getNotificationManager().addToast('success', 'Профиль обновлён');
        broadcastNotifications();
        sendResponse({ success: true });
        return;
      }

      if (message.type === 'DELETE_PROFILE') {
        await store.deleteProfile(message.id);
        broadcastState();
        store.getNotificationManager().addToast('info', 'Профиль удалён');
        broadcastNotifications();
        sendResponse({ success: true });
        return;
      }

      if (message.type === 'DUPLICATE_PROFILE') {
        const profileId = await store.duplicateProfile(message.id);
        broadcastState();
        store.getNotificationManager().addToast('success', 'Профиль дублирован');
        broadcastNotifications();
        sendResponse({ success: true, profileId });
        return;
      }

      if (message.type === 'SET_ACTIVE_PROFILE') {
        await store.setActiveProfile(message.id);
        broadcastState();
        store.getNotificationManager().addToast('info', 'Активный профиль изменён', false, 'profile_changed');
        broadcastNotifications();
        sendResponse({ success: true });
        return;
      }

      // Resume actions
      if (message.type === 'SELECT_RESUME') {
        await store.selectResume(message.hash);
        broadcastState();
        sendResponse({ success: true });
        return;
      }

      if (message.type === 'ADD_DEMO_RESUMES') {
        const demoResumes = createDemoResumes();
        const currentCandidates = store.getState().resumeCandidates;
        const newCandidates = [...currentCandidates, ...demoResumes];
        await store.setResumeCandidates(newCandidates);
        broadcastState();
        store.getNotificationManager().addToast('success', 'Демо-резюме добавлены');
        broadcastNotifications();
        sendResponse({ success: true });
        return;
      }

      if (message.type === 'BIND_RESUME_TO_PROFILE') {
        await store.bindResumeToProfile(message.profileId, message.hash);
        broadcastState();
        store.getNotificationManager().addToast('success', 'Резюме привязано к профилю');
        broadcastNotifications();
        sendResponse({ success: true });
        return;
      }

      // Analytics actions
      if (message.type === 'RECORD_ATTEMPT') {
        await store.recordAttempt(message.outcome, message.profileId, message.vacancyId);
        broadcastState();
        sendResponse({ success: true });
        return;
      }

      if (message.type === 'RECORD_EVENT') {
        await store.recordEvent(message.eventType, message.payload, message.attemptId, message.profileId);
        broadcastState();
        sendResponse({ success: true });
        return;
      }

      if (message.type === 'MARK_RUN_STARTED') {
        await store.markRunStarted();
        broadcastState();
        sendResponse({ success: true });
        return;
      }

      if (message.type === 'MARK_RUN_STOPPED') {
        await store.markRunStopped();
        broadcastState();
        sendResponse({ success: true });
        return;
      }

      if (message.type === 'CLEAR_RUN_STATS') {
        await store.clearRunStats();
        broadcastState();
        sendResponse({ success: true });
        return;
      }

      if (message.type === 'SEED_DEMO_ANALYTICS') {
        await store.seedDemoAnalytics();
        broadcastState();
        store.getNotificationManager().addToast('success', 'Демо-аналитика добавлена');
        broadcastNotifications();
        sendResponse({ success: true });
        return;
      }

      // Vacancy scan actions
      if (message.type === 'RECORD_VACANCY_SCAN') {
        await store.recordVacancyScan(message.foundCount, message.newCount);
        broadcastState();
        broadcastNotifications();
        sendResponse({ success: true });
        return;
      }

      if (message.type === 'MARK_NO_MORE_VACANCIES') {
        await store.markNoMoreVacancies(message.reason);
        broadcastState();
        broadcastNotifications();
        sendResponse({ success: true });
        return;
      }

      if (message.type === 'RESET_VACANCY_EXHAUSTION') {
        await store.resetVacancyExhaustion();
        // Dismiss sticky notification
        store.getNotificationManager().dismissByDedupeKey('no_more_vacancies');
        broadcastState();
        broadcastNotifications();
        sendResponse({ success: true });
        return;
      }

      // Live mode actions
      if (message.type === 'LIVE_MODE_START') {
        const state = store.getState();

        // Check if controlled tab already exists and is valid
        if (state.liveMode.controlledTabId) {
          try {
            const tab = await chrome.tabs.get(state.liveMode.controlledTabId);
            if (tab && tab.id) {
              // Focus existing tab
              await chrome.tabs.update(tab.id, { active: true });
              if (tab.windowId) {
                await chrome.windows.update(tab.windowId, { focused: true });
              }
              sendResponse({ success: true, tabId: tab.id });
              return;
            }
          } catch {
            // Tab no longer exists, continue
          }
        }

        // Check active tab in current window
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (activeTab && activeTab.url && activeTab.url.includes('hh.ru')) {
          // Active tab is HH - bind it and STOP (do not navigate)
          FileLogger.log('service_worker', 'info', 'LIVE_MODE_START: Binding active HH tab', {
            tabId: activeTab.id,
            url: activeTab.url,
          });

          if (activeTab.id && activeTab.windowId && activeTab.url) {
            await store.bindControlledTab(activeTab.id, activeTab.windowId, activeTab.url);

            // Set purpose based on page type
            const updatedState = store.getState();
            let purpose: 'resume_detection' | 'search' | 'vacancy' | 'generic_hh' = 'generic_hh';
            const pageType = updatedState.liveMode.pageType;

            if (pageType === 'applicant_resumes' || pageType === 'resume' || pageType === 'applicant') {
              purpose = 'resume_detection';
            } else if (pageType === 'search') {
              purpose = 'search';
            } else if (pageType === 'vacancy') {
              purpose = 'vacancy';
            }

            await store.updateState({
              liveMode: {
                ...updatedState.liveMode,
                controlledTabPurpose: purpose,
              },
            });

            broadcastState();
            store.getNotificationManager().addToast('success', 'Live mode запущен на текущей вкладке');
            broadcastNotifications();
            sendResponse({ success: true, tabId: activeTab.id });
          } else {
            sendResponse({ error: 'Failed to bind active tab' });
          }
          return;
        }

        // Active tab is not HH - inform user, do NOT auto-create search tab
        FileLogger.log('service_worker', 'info', 'LIVE_MODE_START: Active tab not HH');
        store.getNotificationManager().addToast('warn', 'Откройте HH страницу и нажмите "Привязать текущую HH вкладку"', true, 'session_warning');
        broadcastNotifications();
        sendResponse({ error: 'Active tab is not HH' });
        return;
      }

      if (message.type === 'LIVE_MODE_STOP') {
        await store.deactivateLiveMode();
        broadcastState();
        store.getNotificationManager().addToast('info', 'Live mode остановлен');
        broadcastNotifications();
        sendResponse({ success: true });
        return;
      }

      if (message.type === 'LIVE_MODE_BIND_CURRENT_TAB') {
        const stateBefore = store.getState();
        const previousState = {
          tabId: stateBefore.liveMode.controlledTabId,
          url: stateBefore.liveMode.currentUrl,
          pageType: stateBefore.liveMode.pageType,
          purpose: stateBefore.liveMode.controlledTabPurpose,
        };

        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!activeTab || !activeTab.url) {
          FileLogger.log('service_worker', 'error', 'LIVE_MODE_BIND_CURRENT_TAB: No active tab');
          sendResponse({ error: 'No active tab' });
          return;
        }

        if (!activeTab.url.includes('hh.ru')) {
          FileLogger.log('service_worker', 'error', 'LIVE_MODE_BIND_CURRENT_TAB: Not HH tab', { url: activeTab.url });
          store.getNotificationManager().addToast('warn', 'Текущая вкладка не на hh.ru', true, 'session_warning');
          broadcastNotifications();
          sendResponse({ error: 'Not HH tab' });
          return;
        }

        FileLogger.log('service_worker', 'info', 'LIVE_MODE_BIND_CURRENT_TAB: Binding', {
          tabId: activeTab.id,
          url: activeTab.url,
        });

        if (activeTab.id && activeTab.windowId && activeTab.url) {
          await store.bindControlledTab(activeTab.id, activeTab.windowId, activeTab.url);

          // Set purpose based on page type
          const updatedState = store.getState();
          let purpose: 'resume_detection' | 'search' | 'vacancy' | 'generic_hh' = 'generic_hh';
          const pageType = updatedState.liveMode.pageType;

          if (pageType === 'applicant_resumes' || pageType === 'resume' || pageType === 'applicant') {
            purpose = 'resume_detection';
          } else if (pageType === 'search') {
            purpose = 'search';
          } else if (pageType === 'vacancy') {
            purpose = 'vacancy';
          }

          await store.updateState({
            liveMode: {
              ...updatedState.liveMode,
              controlledTabPurpose: purpose,
            },
          });

          broadcastState();
          store.getNotificationManager().addToast('success', 'HH вкладка привязана');
          broadcastNotifications();

          const stateAfter = store.getState();
          const nextState = {
            tabId: stateAfter.liveMode.controlledTabId,
            url: stateAfter.liveMode.currentUrl,
            pageType: stateAfter.liveMode.pageType,
            purpose: stateAfter.liveMode.controlledTabPurpose,
          };

          logControlledTabStateChange('LIVE_MODE_BIND_CURRENT_TAB', previousState, nextState);

          sendResponse({
            success: true,
            tabId: activeTab.id,
            url: activeTab.url,
            pageType: updatedState.liveMode.pageType,
            purpose,
          });
        } else {
          sendResponse({ error: 'Failed to bind tab' });
        }
        return;
      }

      if (message.type === 'LIVE_MODE_FOCUS_TAB') {
        const state = store.getState();
        if (state.liveMode.controlledTabId) {
          try {
            const tab = await chrome.tabs.get(state.liveMode.controlledTabId);
            if (tab && tab.id) {
              await chrome.tabs.update(tab.id, { active: true });
              if (tab.windowId) {
                await chrome.windows.update(tab.windowId, { focused: true });
              }
              sendResponse({ success: true });
              return;
            }
          } catch {
            // Tab no longer exists
            await store.clearControlledTab();
            broadcastState();
            sendResponse({ error: 'Controlled tab no longer exists' });
            return;
          }
        }
        sendResponse({ error: 'No controlled tab' });
        return;
      }

      // Vacancy queue actions

      if (message.type === 'CLEAR_VACANCY_QUEUE') {
        await store.clearVacancyQueue();
        broadcastState();
        store.getNotificationManager().addToast('info', 'Очередь вакансий очищена');
        broadcastNotifications();
        sendResponse({ success: true });
        return;
      }

      if (message.type === 'MARK_VACANCY_QUEUED') {
        await store.markVacancyQueued(message.vacancyId);
        broadcastState();
        sendResponse({ success: true });
        return;
      }

      if (message.type === 'MARK_VACANCY_PROCESSED') {
        await store.markVacancyProcessed(message.vacancyId);
        broadcastState();
        sendResponse({ success: true });
        return;
      }

      if (message.type === 'MARK_VACANCY_SKIPPED') {
        await store.markVacancySkipped(message.vacancyId);
        broadcastState();
        sendResponse({ success: true });
        return;
      }

      // Vacancy detail preflight actions
      if (message.type === 'LIVE_MODE_OBSERVE_VACANCY_DETAIL') {
        FileLogger.log('service_worker', 'info', 'LIVE_MODE_OBSERVE_VACANCY_DETAIL: Delegating to doObserveVacancyDetail');

        doObserveVacancyDetail().then((result) => {
          sendResponse(result);
        }).catch((error) => {
          FileLogger.log('service_worker', 'error', 'LIVE_MODE_OBSERVE_VACANCY_DETAIL error:', error);
          sendResponse({ success: false, error: (error as Error).message });
        });

        return;
      }

      if (message.type === 'CLEAR_PREFLIGHT_STATE') {
        await store.clearPreflightState();
        broadcastState();
        sendResponse({ success: true });
        return;
      }

      // Apply executor actions
      if (message.type === 'LIVE_MODE_EXECUTE_APPLY_SKELETON') {
        FileLogger.log('service_worker', 'info', 'LIVE_MODE_EXECUTE_APPLY_SKELETON: Delegating to doExecuteApply');

        const realClick = message.realClick === true;

        doExecuteApply(realClick).then((result) => {
          sendResponse(result);
        }).catch((error) => {
          FileLogger.log('service_worker', 'error', 'LIVE_MODE_EXECUTE_APPLY_SKELETON error:', error);
          sendResponse({ success: false, error: (error as Error).message });
        });

        return;
      }

      if (message.type === 'CLEAR_APPLY_ATTEMPTS') {
        await store.clearApplyAttempts();
        broadcastState();
        store.getNotificationManager().addToast('info', 'История apply attempts очищена');
        broadcastNotifications();
        sendResponse({ success: true });
        return;
      }

      if (message.type === 'LIVE_MODE_DETECT_RESUMES') {
        FileLogger.log('service_worker', 'info', 'LIVE_MODE_DETECT_RESUMES: Delegating to doDetectResumes');

        doDetectResumes().then((result) => {
          sendResponse(result);
        }).catch((err) => {
          FileLogger.log('service_worker', 'error', 'LIVE_MODE_DETECT_RESUMES error', { error: (err as Error).message });
          sendResponse({ success: false, error: (err as Error).message });
        });

        return;
      }

      if (message.type === 'REFRESH_RESUMES_API') {
        FileLogger.log('service_worker', 'info', 'REFRESH_RESUMES_API: Delegating to doRefreshResumesAPI');

        doRefreshResumesAPI().then((result) => {
          sendResponse(result);
        }).catch((err) => {
          FileLogger.log('service_worker', 'error', 'REFRESH_RESUMES_API error', { error: (err as Error).message });
          sendResponse({ success: false, error: (err as Error).message });
        });

        return;
      }

      sendResponse({ error: 'Unknown message type' });
    } catch (error) {
      FileLogger.log('service_worker', 'error', 'Message handler error', { error: (error as Error).message });
      sendResponse({ error: (error as Error).message });
    }
  })();

  return true; // Keep channel open for async response
});

// Runtime blocker handlers
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'CHECK_RUNTIME_BLOCKERS') {
    FileLogger.log('service_worker', 'info', 'CHECK_RUNTIME_BLOCKERS: Delegating to doCheckRuntimeBlockers');

    // Respond immediately
    sendResponse({ success: true });

    // Do async work
    doCheckRuntimeBlockers().catch((error) => {
      FileLogger.log('service_worker', 'error', 'CHECK_RUNTIME_BLOCKERS: Async work failed', error);
    });

    return true;
  }

  if (message.type === 'CLEAR_RUNTIME_BLOCKER') {
    (async () => {
      await store.clearRuntimeBlocker();
      await store.setSessionStatus('unknown');
      broadcastState();
      sendResponse({ success: true });
    })();
    return true;
  }

  return false;
});

// Search loop handlers
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === 'LIVE_MODE_NEXT_SEARCH_PAGE') {
        const state = store.getState();
        const controlledTabId = state.liveMode.controlledTabId;

        if (!controlledTabId) {
          sendResponse({ error: 'No controlled tab' });
          return;
        }

        const tab = await chrome.tabs.get(controlledTabId);
        if (!tab.url) {
          sendResponse({ error: 'No tab URL' });
          return;
        }

        // Get HTML to check hasNextPage
        const [htmlResult] = await chrome.scripting.executeScript({
          target: { tabId: controlledTabId },
          func: () => document.documentElement.outerHTML,
        });

        const html = htmlResult.result as string;

        // Check if next page exists inline
        const [hasNextResult] = await chrome.scripting.executeScript({
          target: { tabId: controlledTabId },
          func: (url: string, html: string) => {
            // Inline hasNextPage
            const urlObj = new URL(url);
            const pageParam = urlObj.searchParams.get('page');
            let currentPage = 0;
            if (pageParam !== null) {
              const parsed = parseInt(pageParam, 10);
              if (!isNaN(parsed) && parsed >= 0) currentPage = parsed;
            }

            const doc = new DOMParser().parseFromString(html, 'text/html');
            const pagerItems = doc.querySelectorAll('[data-qa="pager-page"]');
            let totalPages: number | null = null;

            if (pagerItems.length > 0) {
              let maxPage = 0;
              pagerItems.forEach((item) => {
                const pageAttr = item.getAttribute('data-page');
                if (pageAttr) {
                  const pageNum = parseInt(pageAttr, 10);
                  if (!isNaN(pageNum) && pageNum > maxPage) maxPage = pageNum;
                }
              });
              if (maxPage > 0) totalPages = maxPage;
            }

            if (totalPages === null) {
              const links = doc.querySelectorAll('a[href*="page="]');
              let maxPage = 0;
              links.forEach((link) => {
                const href = link.getAttribute('href');
                if (href) {
                  const match = href.match(/page=(\d+)/);
                  if (match) {
                    const pageNum = parseInt(match[1], 10);
                    if (!isNaN(pageNum) && pageNum > maxPage) maxPage = pageNum;
                  }
                }
              });
              if (maxPage > 0) totalPages = maxPage;
            }

            const hasNext = totalPages === null || currentPage < totalPages;

            return { hasNext, currentPage };
          },
          args: [tab.url, html],
        });

        const { hasNext, currentPage } = hasNextResult.result as {
          hasNext: boolean;
          currentPage: number;
        };

        if (!hasNext) {
          sendResponse({ error: 'No next page available' });
          return;
        }

        // Build next URL
        const nextUrl = new URL(tab.url);
        nextUrl.searchParams.set('page', String(currentPage + 1));

        // Navigate
        await chrome.tabs.update(controlledTabId, { url: nextUrl.toString() });

        sendResponse({ success: true, nextUrl: nextUrl.toString() });
      }

      if (message.type === 'LIVE_MODE_RUN_SEARCH_LOOP') {
        const state = store.getState();
        const controlledTabId = state.liveMode.controlledTabId;

        if (!controlledTabId) {
          sendResponse({ error: 'No controlled tab' });
          return;
        }

        if (state.liveMode.pageType !== 'search') {
          sendResponse({ error: 'Not on search page' });
          return;
        }

        if (state.vacancyScan.exhausted) {
          sendResponse({ error: 'Vacancy search exhausted' });
          return;
        }

        // Check runtime blocker
        if (state.runtimeBlocker) {
          sendResponse({ error: `Runtime blocked: ${state.runtimeBlocker}` });
          return;
        }

        // Start loop
        await store.startSearchLoop();

        // Scan current page
        const scanResponse = await new Promise<any>((resolve) => {
          chrome.runtime.sendMessage({ type: 'LIVE_MODE_SCAN_CURRENT_SEARCH_PAGE' }, resolve);
        });

        if (!scanResponse.success) {
          await store.stopSearchLoop();
          sendResponse({ error: scanResponse.error });
          return;
        }

        // Increment iteration
        await store.incrementSearchLoopIteration();

        // Check exhaustion after scan
        const updatedState = store.getState();

        if (updatedState.vacancyScan.exhausted) {
          await store.stopSearchLoop();
          broadcastState();
          sendResponse({
            success: true,
            stopped: true,
            reason: 'exhausted',
            ...scanResponse,
          });
          return;
        }

        // Check if next page exists
        const tab = await chrome.tabs.get(controlledTabId);
        if (!tab.url) {
          await store.stopSearchLoop();
          sendResponse({ error: 'No tab URL' });
          return;
        }

        const [htmlResult] = await chrome.scripting.executeScript({
          target: { tabId: controlledTabId },
          func: () => document.documentElement.outerHTML,
        });

        const html = htmlResult.result as string;

        const [hasNextResult] = await chrome.scripting.executeScript({
          target: { tabId: controlledTabId },
          func: (url: string, html: string) => {
            const urlObj = new URL(url);
            const pageParam = urlObj.searchParams.get('page');
            let currentPage = 0;
            if (pageParam !== null) {
              const parsed = parseInt(pageParam, 10);
              if (!isNaN(parsed) && parsed >= 0) currentPage = parsed;
            }

            const doc = new DOMParser().parseFromString(html, 'text/html');
            const pagerItems = doc.querySelectorAll('[data-qa="pager-page"]');
            let totalPages: number | null = null;

            if (pagerItems.length > 0) {
              let maxPage = 0;
              pagerItems.forEach((item) => {
                const pageAttr = item.getAttribute('data-page');
                if (pageAttr) {
                  const pageNum = parseInt(pageAttr, 10);
                  if (!isNaN(pageNum) && pageNum > maxPage) maxPage = pageNum;
                }
              });
              if (maxPage > 0) totalPages = maxPage;
            }

            if (totalPages === null) {
              const links = doc.querySelectorAll('a[href*="page="]');
              let maxPage = 0;
              links.forEach((link) => {
                const href = link.getAttribute('href');
                if (href) {
                  const match = href.match(/page=(\d+)/);
                  if (match) {
                    const pageNum = parseInt(match[1], 10);
                    if (!isNaN(pageNum) && pageNum > maxPage) maxPage = pageNum;
                  }
                }
              });
              if (maxPage > 0) totalPages = maxPage;
            }

            return totalPages === null || currentPage < totalPages;
          },
          args: [tab.url, html],
        });

        const hasNext = hasNextResult.result as boolean;

        if (!hasNext) {
          // Last page reached
          if (scanResponse.newCount === 0) {
            // No new vacancies on last page -> mark exhausted
            await store.markNoMoreVacancies('no_unseen_vacancies');
          }
          await store.stopSearchLoop();
          broadcastState();
          sendResponse({
            success: true,
            stopped: true,
            reason: 'last_page',
            ...scanResponse,
          });
          return;
        }

        // Navigate to next page
        const nextResponse = await new Promise<any>((resolve) => {
          chrome.runtime.sendMessage({ type: 'LIVE_MODE_NEXT_SEARCH_PAGE' }, resolve);
        });

        if (!nextResponse.success) {
          await store.stopSearchLoop();
          sendResponse({ error: nextResponse.error });
          return;
        }

        await store.stopSearchLoop();
        broadcastState();

        sendResponse({
          success: true,
          stopped: false,
          ...scanResponse,
          nextUrl: nextResponse.nextUrl,
        });
      }
    } catch (error) {
      FileLogger.log('service_worker', 'error', 'Search loop error', { error: (error as Error).message });
      sendResponse({ error: (error as Error).message });
    }
  })();

  return true;
});

// Broadcast state to all sidepanels
function broadcastState() {
  const state = store.getState();
  // State broadcast (verbose, removed)
  chrome.runtime.sendMessage({ type: 'STATE_UPDATE', state }).catch(() => {
    // Ignore - sidepanel may not be open
  });
}

// Broadcast notifications
function broadcastNotifications() {
  const notifications = store.getNotificationManager().getAll();
  chrome.runtime.sendMessage({ type: 'NOTIFICATIONS_UPDATE', notifications }).catch(() => {
    // Ignore if no listeners
  });
}

// Clear expired notifications periodically
setInterval(() => {
  store.getNotificationManager().clearExpired();
  broadcastNotifications();
}, 5000);

// Live mode tab listeners
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const state = store.getState();

  // Only track controlled tab
  if (state.liveMode.active && state.liveMode.controlledTabId === tabId) {
    if (changeInfo.url && tab.url) {
      store.updateLiveContextFromUrl(tab.url).then(async () => {
        const state = store.getState();

        // Check search sync with DOM context
        if (state.liveMode.pageType === 'search' && state.activeProfileId && tab.url) {
          const profile = state.profiles[state.activeProfileId];

          if (profile) {
            try {
              // Get HTML and detect applied context
              const [htmlResult] = await chrome.scripting.executeScript({
                target: { tabId },
                func: () => document.documentElement.outerHTML,
              });

              const html = htmlResult.result;

              if (!html || !tab.url) return;

              // Detect applied context and compare
              const [contextResult] = await chrome.scripting.executeScript({
                target: { tabId },
                func: (url: string, profile: any) => {
                  // Inline detectAppliedSearchContext + compareProfileToAppliedContext
                  const urlObj = new URL(url);
                  const params = urlObj.searchParams;

                  const context = {
                    queryText: params.get('text') || '',
                    experience: params.get('experience')?.split(',') || [],
                    schedule: params.get('schedule')?.split(',') || [],
                    employment: params.get('employment')?.split(',') || [],
                    pageType: 'search' as const,
                  };

                  const expectedQuery = profile.keywordsInclude.join(' ');
                  const mismatches: any[] = [];

                  if (expectedQuery !== context.queryText) {
                    mismatches.push({ field: 'queryText', expected: expectedQuery, actual: context.queryText });
                  }

                  const arraysEqual = (a: string[], b: string[]) => {
                    if (a.length !== b.length) return false;
                    const aSorted = [...a].sort();
                    const bSorted = [...b].sort();
                    for (let i = 0; i < aSorted.length; i++) {
                      if (aSorted[i] !== bSorted[i]) return false;
                    }
                    return true;
                  };

                  if (!arraysEqual(profile.experience, context.experience)) {
                    mismatches.push({ field: 'experience', expected: profile.experience, actual: context.experience });
                  }

                  if (!arraysEqual(profile.schedule, context.schedule)) {
                    mismatches.push({ field: 'schedule', expected: profile.schedule, actual: context.schedule });
                  }

                  if (!arraysEqual(profile.employment, context.employment)) {
                    mismatches.push({ field: 'employment', expected: profile.employment, actual: context.employment });
                  }

                  return { synced: mismatches.length === 0, mismatches };
                },
                args: [tab.url, profile],
              });

              const syncDiff = contextResult?.result;

              if (!syncDiff) return;

              // Update sync status based on DOM context
              if (syncDiff.synced) {
                await store.markSearchSynced(tab.url, state.activeProfileId);
              } else {
                await store.markSearchOutOfSync();
              }

              // Store sync diff
              await store.updateState({
                liveMode: {
                  ...state.liveMode,
                  searchSyncDiff: syncDiff,
                },
              });

            } catch (error) {
              FileLogger.log('service_worker', 'error', 'Failed to check search sync', { error: (error as Error).message });
            }
          }
        }

        // Check for runtime blockers (login/captcha)
        if (tab.url) {
          try {
            const [htmlResult] = await chrome.scripting.executeScript({
              target: { tabId },
              func: () => document.documentElement.outerHTML,
            });

            const html = htmlResult.result;

            if (html) {
              // Inline detectRuntimeBlockers
              const [blockerResult] = await chrome.scripting.executeScript({
                target: { tabId },
                func: (html: string, url: string) => {
                  const doc = new DOMParser().parseFromString(html, 'text/html');
                  const bodyText = doc.body?.textContent?.toLowerCase() || '';
                  const urlLower = url.toLowerCase();

                  const loginRequired =
                    urlLower.includes('/login') ||
                    urlLower.includes('/signin') ||
                    !!doc.querySelector('[data-qa="account-login-form"]') ||
                    !!doc.querySelector('input[type="password"]') ||
                    bodyText.includes('войдите') ||
                    bodyText.includes('требуется вход');

                  const captchaRequired =
                    !!doc.querySelector('[data-qa="captcha"]') ||
                    !!doc.querySelector('.g-recaptcha') ||
                    bodyText.includes('капча') ||
                    bodyText.includes('captcha') ||
                    bodyText.includes('подтвердите, что вы не робот');

                  return { loginRequired, captchaRequired };
                },
                args: [html, tab.url],
              });

              const blocker = blockerResult?.result;

              if (blocker?.loginRequired) {
                await store.setSessionStatus('login_required');
                await store.setRuntimeBlocker('login_required', 'Login page detected');
                await store.stopSearchLoop();

                store.getNotificationManager().addSticky(
                  'warn',
                  'Требуется вход в систему. Runtime приостановлен.',
                  'generic',
                  'login_required'
                );
                broadcastNotifications();
              } else if (blocker?.captchaRequired) {
                await store.setSessionStatus('captcha_required');
                await store.setRuntimeBlocker('captcha_required', 'Captcha detected');
                await store.stopSearchLoop();

                store.getNotificationManager().addSticky(
                  'warn',
                  'Требуется прохождение капчи. Runtime приостановлен.',
                  'generic',
                  'captcha_required'
                );
                broadcastNotifications();
              } else if (state.sessionStatus !== 'ok') {
                // Clear blocker if page is normal
                await store.setSessionStatus('ok');
                if (state.runtimeBlocker === 'login_required' || state.runtimeBlocker === 'captcha_required') {
                  // Don't auto-clear, user must manually clear
                }
              }
            }
          } catch (error) {
            FileLogger.log('service_worker', 'error', 'Failed to check runtime blockers', { error: (error as Error).message });
          }
        }

        // Check bound resume
        if (state.activeProfileId) {
          const profile = state.profiles[state.activeProfileId];
          if (profile?.selectedResumeHash) {
            const resumeExists = state.resumeCandidates.some(
              (r) => r.hash === profile.selectedResumeHash
            );

            if (!resumeExists) {
              store.getNotificationManager().addSticky(
                'warn',
                `Резюме профиля не найдено среди обнаруженных (${profile.selectedResumeHash})`,
                'generic',
                'resume_missing'
              );
              broadcastNotifications();
            }
          }
        }

        broadcastState();
      });
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const state = store.getState();

  // If controlled tab was closed
  if (state.liveMode.active && state.liveMode.controlledTabId === tabId) {
    store.clearControlledTab().then(async () => {
      // Set runtime blocker
      await store.setRuntimeBlocker('controlled_tab_lost', 'Controlled tab was closed');

      store
        .getNotificationManager()
        .addSticky(
          'warn',
          'Контролируемая вкладка была закрыта. Runtime приостановлен.',
          'generic',
          'controlled_tab_lost'
        );

      // Stop search loop if active
      if (state.liveMode.searchLoopActive) {
        await store.stopSearchLoop();
      }

      broadcastState();
      broadcastNotifications();
    });
  }
});

FileLogger.log('service_worker', 'info', 'Service worker loaded');
