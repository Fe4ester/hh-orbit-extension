import React, { useState } from 'react';
import { Profile, ResumeCandidate } from '../state/types';
import { CreateProfilePayload, UpdateProfilePayload } from '../state/actions';
import { formatResumeLabel } from './resumeLabel';

interface ProfileEditorProps {
  profile?: Profile;
  resumeCandidates: ResumeCandidate[];
  onSave: (payload: CreateProfilePayload) => void;
  onUpdate: (payload: UpdateProfilePayload) => void;
  onCancel: () => void;
}

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
      // Update mode
      onUpdate({
        name: name.trim(),
        ...commonFields,
      });
    } else {
      // Create mode
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
          <small className="form-hint" style={{ color: '#dc3545', fontWeight: 600 }}>
            Отправляется только если вакансия сама запрашивает сопроводительное письмо.
          </small>
        </div>

        <div className="form-group">
          <label htmlFor="profile-default-resume">Резюме по умолчанию для профиля</label>
          <select
            id="profile-default-resume"
            value={selectedResumeHash}
            onChange={(e) => setSelectedResumeHash(e.target.value)}
            className="resume-select"
          >
            <option value="">Не привязано</option>
            {resumeCandidates.map((resume) => (
              <option key={resume.hash} value={resume.hash}>
                {formatResumeLabel(resume)}
              </option>
            ))}
          </select>
          <small className="form-hint">
            При выборе этого профиля будет автоматически выбрано это резюме
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
