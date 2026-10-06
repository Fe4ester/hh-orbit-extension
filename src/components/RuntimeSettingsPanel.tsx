import { t } from '../i18n';
import React, { useEffect, useState } from 'react';
import type { AppState } from '../state/types';

const RANDOM_DELAY_HINT_DISMISSED_KEY = 'dismissed_random_delay_hint';
const HINT_DISMISS_ANIMATION_MS = 200;

interface RuntimeSettingsPanelProps {
  settings: AppState['settings'];
  onPatch: (patch: Partial<AppState['settings']>) => void;
}

export const RuntimeSettingsPanel: React.FC<RuntimeSettingsPanelProps> = ({ settings, onPatch }) => {
  const [isRandomDelayHintHighlighted, setIsRandomDelayHintHighlighted] = useState(true);
  const [isRandomDelayHintDismissing, setIsRandomDelayHintDismissing] = useState(false);

  useEffect(() => {
    const restoreRandomDelayHint = async () => {
      const storedHints = await chrome.storage.local.get(RANDOM_DELAY_HINT_DISMISSED_KEY);
      if (storedHints[RANDOM_DELAY_HINT_DISMISSED_KEY] === true) {
        setIsRandomDelayHintHighlighted(false);
      }
    };

    void restoreRandomDelayHint();
  }, []);

  const dismissRandomDelayHint = () => {
    setIsRandomDelayHintDismissing(true);
    void chrome.storage.local.set({ [RANDOM_DELAY_HINT_DISMISSED_KEY]: true });
    window.setTimeout(() => {
      setIsRandomDelayHintHighlighted(false);
      setIsRandomDelayHintDismissing(false);
    }, HINT_DISMISS_ANIMATION_MS);
  };

  return (
    <>
      <div className="runtime-settings-grid">
        <label htmlFor="runtime-delay-min">{t("Мин. задержка (сек)") + " "}<input
            id="runtime-delay-min"
            type="number"
            min={1}
            value={settings.delayMinSeconds}
            onChange={(e) => onPatch({ delayMinSeconds: Number(e.target.value) })}
          />
          <small>{t("Мин. пауза между откликами.")}</small>
        </label>
        <label htmlFor="runtime-delay-max">{t("Макс. задержка (сек)") + " "}<input
            id="runtime-delay-max"
            type="number"
            min={1}
            value={settings.delayMaxSeconds}
            onChange={(e) => onPatch({ delayMaxSeconds: Number(e.target.value) })}
          />
          <small>{t("Макс. пауза между откликами.")}</small>
        </label>
        <label htmlFor="runtime-limit-run">{t("Лимит за запуск") + " "}<input
            id="runtime-limit-run"
            type="number"
            min={0}
            value={settings.maxAutoAppliesPerRun}
            onChange={(e) => onPatch({ maxAutoAppliesPerRun: Number(e.target.value) })}
            placeholder={t("0 = без лимита")}
          />
          <small>{t("0 = без лимита")}</small>
        </label>
        <label htmlFor="runtime-limit-day">{t("Лимит за день") + " "}<input
            id="runtime-limit-day"
            type="number"
            min={0}
            value={settings.maxAutoAppliesPerDay}
            onChange={(e) => onPatch({ maxAutoAppliesPerDay: Number(e.target.value) })}
            placeholder={t("0 = без лимита")}
          />
          <small>{t("0 = без лимита")}</small>
        </label>
        <label htmlFor="runtime-stop-manual" className="settings-switch runtime-settings-switch">
          <span>
            <strong>{t("Остановить при ручном действии")}</strong>
            <small>{t("Пауза запуска, пока вы разбираете ручной шаг.")}</small>
          </span>
          <input
            id="runtime-stop-manual"
            type="checkbox"
            role="switch"
            aria-label={t("Остановить при ручном действии")}
            aria-checked={settings.stopOnManualAction}
            checked={settings.stopOnManualAction}
            onChange={(e) => onPatch({ stopOnManualAction: e.target.checked })}
          />
        </label>
      </div>
      <small className={isRandomDelayHintHighlighted
        ? `form-hint highlight-hint dismissible-hint${isRandomDelayHintDismissing ? ' is-dismissing' : ''}`
        : 'form-hint'}>{t("Итоговая задержка выбирается случайно между мин. и макс.") + " "}{isRandomDelayHintHighlighted && (
          <button
            type="button"
            className="hint-dismiss-button"
            aria-label={t("Снять выделение подсказки")}
            onClick={dismissRandomDelayHint}
            disabled={isRandomDelayHintDismissing}
          >
            ×
          </button>
        )}
      </small>
    </>
  );
};
