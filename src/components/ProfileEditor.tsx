import React, { useState } from 'react';
import { Profile, ResumeCandidate } from '../state/types';
import { CreateProfilePayload, UpdateProfilePayload } from '../state/actions';

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
          <label>Название профиля *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="Например: Frontend разработчик"
          />
        </div>

        <div className="form-group">
          <label>Ключевые слова (включить)</label>
          <input
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
          <label>Ключевые слова (исключить)</label>
          <input
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
          <label>Сопроводительное письмо</label>
          <textarea
            value={coverLetter}
            onChange={(e) => setCoverLetter(e.target.value)}
            rows={4}
            placeholder="Шаблон сопроводительного письма..."
          />
        </div>

        <div className="form-group">
          <label>Резюме по умолчанию для профиля</label>
          <select
            value={selectedResumeHash}
            onChange={(e) => setSelectedResumeHash(e.target.value)}
            className="resume-select"
          >
            <option value="">Не привязано</option>
            {resumeCandidates.map((resume) => (
              <option key={resume.hash} value={resume.hash}>
                {resume.title}
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
