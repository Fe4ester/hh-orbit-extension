import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  isVacancyDetailPage,
  parseVacancyDetail,
  classifyPreflight,
} from '../src/live/vacancyDetailParser';

describe('vacancyDetailParser', () => {
  const canApplyHtml = readFileSync(
    join(__dirname, 'fixtures/hh-vacancy-detail-can-apply.html'),
    'utf-8'
  );
  const alreadyAppliedHtml = readFileSync(
    join(__dirname, 'fixtures/hh-vacancy-detail-already-applied.html'),
    'utf-8'
  );
  const loginRequiredHtml = readFileSync(
    join(__dirname, 'fixtures/hh-vacancy-detail-login-required.html'),
    'utf-8'
  );
  const externalApplyHtml = readFileSync(
    join(__dirname, 'fixtures/hh-vacancy-detail-external-apply.html'),
    'utf-8'
  );
  const archivedHtml = readFileSync(
    join(__dirname, 'fixtures/hh-vacancy-detail-archived.html'),
    'utf-8'
  );
  const coverLetterHtml = readFileSync(
    join(__dirname, 'fixtures/hh-vacancy-detail-cover-letter.html'),
    'utf-8'
  );

  describe('isVacancyDetailPage', () => {
    it('detects vacancy detail page', () => {
      expect(isVacancyDetailPage(canApplyHtml)).toBe(true);
      expect(isVacancyDetailPage(alreadyAppliedHtml)).toBe(true);
    });

    it('returns false for non-detail page', () => {
      expect(isVacancyDetailPage('<html><body>Not a vacancy</body></html>')).toBe(false);
    });
  });

  describe('parseVacancyDetail', () => {
    it('extracts title and company', () => {
      const observation = parseVacancyDetail(canApplyHtml, 'https://hh.ru/vacancy/100001');

      expect(observation.vacancyId).toBe('100001');
      expect(observation.title).toBe('Frontend разработчик (React, TypeScript)');
      expect(observation.company).toBe('ООО "Технологии"');
    });

    it('detects respond button', () => {
      const observation = parseVacancyDetail(canApplyHtml);

      expect(observation.hasRespondButton).toBe(true);
      expect(observation.respondButtonText).toBe('Откликнуться');
    });

    it('detects already applied', () => {
      const observation = parseVacancyDetail(alreadyAppliedHtml);

      expect(observation.alreadyApplied).toBe(true);
      expect(observation.respondButtonText).toContain('Вы откликнулись');
    });

    it('detects login required', () => {
      const observation = parseVacancyDetail(loginRequiredHtml);

      expect(observation.requiresLogin).toBe(true);
      expect(observation.hasRespondButton).toBe(false);
    });

    it('detects external apply', () => {
      const observation = parseVacancyDetail(externalApplyHtml);

      expect(observation.externalApply).toBe(true);
      expect(observation.respondButtonText).toContain('на сайте');
    });

    it('detects archived vacancy', () => {
      const observation = parseVacancyDetail(archivedHtml);

      expect(observation.archivedOrUnavailable).toBe(true);
    });

    it('detects cover letter hint', () => {
      const observation = parseVacancyDetail(coverLetterHtml);

      expect(observation.coverLetterHint).toBe(true);
    });

    it('detects resume selector', () => {
      const observation = parseVacancyDetail(canApplyHtml);

      expect(observation.resumeSelectorVisible).toBe(true);
    });
  });

  describe('classifyPreflight', () => {
    it('classifies can_apply', () => {
      const observation = parseVacancyDetail(canApplyHtml);
      const classification = classifyPreflight(observation);

      expect(classification.code).toBe('can_apply');
      expect(classification.severity).toBe('success');
    });

    it('classifies already_applied', () => {
      const observation = parseVacancyDetail(alreadyAppliedHtml);
      const classification = classifyPreflight(observation);

      expect(classification.code).toBe('already_applied');
      expect(classification.severity).toBe('info');
    });

    it('classifies login_required', () => {
      const observation = parseVacancyDetail(loginRequiredHtml);
      const classification = classifyPreflight(observation);

      expect(classification.code).toBe('login_required');
      expect(classification.severity).toBe('error');
    });

    it('classifies external_apply', () => {
      const observation = parseVacancyDetail(externalApplyHtml);
      const classification = classifyPreflight(observation);

      expect(classification.code).toBe('external_apply');
      expect(classification.severity).toBe('warn');
    });

    it('classifies archived_or_unavailable', () => {
      const observation = parseVacancyDetail(archivedHtml);
      const classification = classifyPreflight(observation);

      expect(classification.code).toBe('archived_or_unavailable');
      expect(classification.severity).toBe('error');
    });

    it('classifies cover_letter_required', () => {
      const observation = parseVacancyDetail(coverLetterHtml);
      const classification = classifyPreflight(observation);

      expect(classification.code).toBe('cover_letter_required');
      expect(classification.severity).toBe('info');
    });

    it('classifies unknown for missing button', () => {
      const observation = parseVacancyDetail('<html><body></body></html>');
      const classification = classifyPreflight(observation);

      expect(classification.code).toBe('unknown');
      expect(classification.severity).toBe('warn');
    });
  });
});
