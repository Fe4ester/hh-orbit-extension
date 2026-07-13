import React, { useEffect, useState } from 'react';
import type { Profile, ResumeCandidate } from '../state/types';
import type { CreateProfilePayload, UpdateProfilePayload } from '../state/actions';
import { formatResumeLabel } from './resumeLabel';
import { SelectMenu } from './SelectMenu';

const COVER_LETTER_HINT_DISMISSED_KEY = 'dismissed_cover_letter_hint';
const DEFAULT_RESUME_HINT_DISMISSED_KEY = 'dismissed_default_resume_hint';
const HINT_DISMISS_ANIMATION_MS = 200;

interface ProfileEditorProps {
  profile?: Profile;
  resumeCandidates: ResumeCandidate[];
  onSave: (payload: CreateProfilePayload) => void;
  onUpdate: (payload: UpdateProfilePayload) => void;
  onCancel: () => void;
}

const HintDismissButton: React.FC<{ onDismiss: () => void; disabled: boolean }> = ({ onDismiss, disabled }) => (
  <button
    type="button"
    className="hint-dismiss-button"
    aria-label="Снять выделение подсказки"
    onClick={onDismiss}
    disabled={disabled}
  >
    ×
  </button>
);

export const ProfileEditor: React.FC<ProfileEditorProps> = ({
  profile,
  resumeCandidates,
  onSave,
  onUpdate,
  onCancel,
}) => {
  const [name, setName] = useState(profile?.name || '');
  const [keywordsInclude, setKeywordsInclude] = useState(
    profile?.keywordsInclude.join(', ') || ''
  );
  const [keywordsExclude, setKeywordsExclude] = useState(
    profile?.keywordsExclude.join(', ') || ''
  );
  const [coverLetter, setCoverLetter] = useState(profile?.coverLetterTemplate || '');
  const [selectedResumeHash, setSelectedResumeHash] = useState(
    profile?.selectedResumeHash || ''
  );
  const [isCoverLetterHintHighlighted, setIsCoverLetterHintHighlighted] = useState(true);
  const [isDefaultResumeHintHighlighted, setIsDefaultResumeHintHighlighted] = useState(true);
  const [isCoverLetterHintDismissing, setIsCoverLetterHintDismissing] = useState(false);
  const [isDefaultResumeHintDismissing, setIsDefaultResumeHintDismissing] = useState(false);
  const resumeOptions = [
    { value: '', label: 'Не привязано' },
    ...resumeCandidates.map((resume) => ({ value: resume.hash, label: formatResumeLabel(resume) })),
  ];

  useEffect(() => {
    const restoreHintHighlights = async () => {
      const storedHints = await chrome.storage.local.get([
        COVER_LETTER_HINT_DISMISSED_KEY,
        DEFAULT_RESUME_HINT_DISMISSED_KEY,
      ]);

      if (storedHints[COVER_LETTER_HINT_DISMISSED_KEY] === true) {
        setIsCoverLetterHintHighlighted(false);
      }
      if (storedHints[DEFAULT_RESUME_HINT_DISMISSED_KEY] === true) {
        setIsDefaultResumeHintHighlighted(false);
      }
    };

    void restoreHintHighlights();
  }, []);

  const dismissHint = (
    storageKey: string,
    setHighlighted: (highlighted: boolean) => void,
    setDismissing: (dismissing: boolean) => void
  ) => {
    setDismissing(true);
    void chrome.storage.local.set({ [storageKey]: true });
    window.setTimeout(() => {
      setHighlighted(false);
      setDismissing(false);
    }, HINT_DISMISS_ANIMATION_MS);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const commonFields = {
      keywordsInclude: keywordsInclude
        .split(',')
        .map((k) => k.trim())
        .filter((k) => k),
      keywordsExclude: keywordsExclude
        .split(',')
        .map((k) => k.trim())
        .filter((k) => k),
      coverLetterTemplate: coverLetter.trim() || undefined,
      selectedResumeHash: selectedResumeHash || null,
    };

    if (profile) {
      onUpdate({
        name: name.trim(),
        ...commonFields,
      });
    } else {
      onSave({
        name: name.trim(),
        ...commonFields,
      });
    }
  };

  return (
    <div className="profile-editor">
      <h3>{profile ? 'Редактировать профиль' : 'Создать профиль'}</h3>

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="profile-name">Название профиля *</label>
          <input
            id="profile-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="Например: Frontend разработчик"
          />
        </div>

        <div className="form-group">
          <label htmlFor="profile-keywords-include">Ключевые слова (включить)</label>
          <input
            id="profile-keywords-include"
            type="text"
            value={keywordsInclude}
            onChange={(e) => setKeywordsInclude(e.target.value)}
            placeholder="React, TypeScript, Frontend (через запятую)"
          />
          <small className="form-hint">
            Вакансия должна содержать хотя бы одно из этих слов в названии или описании
          </small>
        </div>

        <div className="form-group">
          <label htmlFor="profile-keywords-exclude">Ключевые слова (исключить)</label>
          <input
            id="profile-keywords-exclude"
            type="text"
            value={keywordsExclude}
            onChange={(e) => setKeywordsExclude(e.target.value)}
            placeholder="PHP, Java (через запятую)"
          />
          <small className="form-hint">
            Вакансии с этими словами будут пропущены
          </small>
        </div>

        <div className="form-group">
          <label htmlFor="profile-cover-letter">Сопроводительное письмо</label>
          <textarea
            id="profile-cover-letter"
            value={coverLetter}
            onChange={(e) => setCoverLetter(e.target.value)}
            rows={4}
            placeholder="Шаблон сопроводительного письма..."
          />
          <small className={isCoverLetterHintHighlighted
            ? `form-hint highlight-hint dismissible-hint${isCoverLetterHintDismissing ? ' is-dismissing' : ''}`
            : 'form-hint'}>
            Отправляется только если вакансия сама запрашивает сопроводительное письмо.
            {isCoverLetterHintHighlighted && (
              <HintDismissButton
                onDismiss={() => dismissHint(
                  COVER_LETTER_HINT_DISMISSED_KEY,
                  setIsCoverLetterHintHighlighted,
                  setIsCoverLetterHintDismissing
                )}
                disabled={isCoverLetterHintDismissing}
              />
            )}
          </small>
        </div>

        <div className="form-group">
          <label htmlFor="profile-default-resume">Резюме по умолчанию для профиля</label>
          <SelectMenu
            id="profile-default-resume"
            value={selectedResumeHash}
            options={resumeOptions}
            placeholder="Не привязано"
            onChange={setSelectedResumeHash}
          />
          <small className={isDefaultResumeHintHighlighted
            ? `form-hint highlight-hint dismissible-hint${isDefaultResumeHintDismissing ? ' is-dismissing' : ''}`
            : 'form-hint'}>
            При выборе этого профиля будет автоматически выбрано это резюме
            {isDefaultResumeHintHighlighted && (
              <HintDismissButton
                onDismiss={() => dismissHint(
                  DEFAULT_RESUME_HINT_DISMISSED_KEY,
                  setIsDefaultResumeHintHighlighted,
                  setIsDefaultResumeHintDismissing
                )}
                disabled={isDefaultResumeHintDismissing}
              />
            )}
          </small>
        </div>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary">
            {profile ? 'Сохранить' : 'Создать'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Отмена
          </button>
        </div>
      </form>
    </div>
  );
};
