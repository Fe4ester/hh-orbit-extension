import React from 'react';
import { ProfileSummary } from '../state/selectors';

interface ProfileSummaryViewProps {
  summary: ProfileSummary | null;
}

export const ProfileSummaryView: React.FC<ProfileSummaryViewProps> = ({ summary }) => {
  if (!summary) {
    return (
      <div className="profile-summary empty">
        <p>Профиль не выбран</p>
      </div>
    );
  }

  if (!summary.hasFilters) {
    return (
      <div className="profile-summary empty">
        <p className="profile-name">{summary.name}</p>
        <p className="no-filters">Фильтры не настроены</p>
      </div>
    );
  }

  return (
    <div className="profile-summary">
      <p className="profile-name">{summary.name}</p>
      <div className="filters-summary">
        {summary.keywordsCount > 0 && (
          <span className="filter-badge">Ключевые слова: {summary.keywordsCount}</span>
        )}
        {summary.experienceCount > 0 && (
          <span className="filter-badge">Опыт: {summary.experienceCount}</span>
        )}
        {summary.scheduleCount > 0 && (
          <span className="filter-badge">График: {summary.scheduleCount}</span>
        )}
        {summary.employmentCount > 0 && (
          <span className="filter-badge">Занятость: {summary.employmentCount}</span>
        )}
        {summary.regionsCount > 0 && (
          <span className="filter-badge">Регионы: {summary.regionsCount}</span>
        )}
        {summary.hasSalary && <span className="filter-badge">Зарплата указана</span>}
        {summary.hasCoverLetter && <span className="filter-badge">Сопроводительное письмо</span>}
      </div>
    </div>
  );
};
