import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { detectResumeCandidates, isResumePage } from '../src/live/resumeDetector';

describe('resumeDetector', () => {
  const loadFixture = (filename: string): string => {
    return readFileSync(join(__dirname, 'fixtures', filename), 'utf-8');
  };

  describe('isResumePage', () => {
    it('detects resume page by URL', () => {
      expect(isResumePage('', 'https://hh.ru/applicant/resumes')).toBe(true);
      expect(isResumePage('', 'https://hh.ru/resume/abc123')).toBe(true);
    });

    it('detects resume page by HTML markers', () => {
      const html = '<div data-qa="resume-title">Test</div>';
      expect(isResumePage(html)).toBe(true);
    });

    it('returns false for non-resume pages', () => {
      expect(isResumePage('', 'https://hh.ru/search/vacancy')).toBe(false);
      expect(isResumePage('<div>No resume here</div>')).toBe(false);
    });
  });

  describe('detectResumeCandidates', () => {
    it('detects multiple resumes from list page', () => {
      const html = loadFixture('hh-resumes-list.html');

      const candidates = detectResumeCandidates(html);

      expect(candidates).toHaveLength(4);
      expect(candidates[0].hash).toBe('abc123def456');
      expect(candidates[0].title).toBe('Senior Frontend Developer');
      expect(candidates[0].isActive).toBe(true);
      expect(candidates[1].hash).toBe('789xyz012abc');
      expect(candidates[1].title).toBe('Full Stack Engineer');
      expect(candidates[1].isActive).toBe(false);
      expect(candidates[2].hash).toBe('def456ghi789');
      expect(candidates[2].isActive).toBe(true);
      expect(candidates[3].hash).toBe('test123');
      expect(candidates[3].isActive).toBe(false);
    });

    it('detects single resume from resume page', () => {
      const html = loadFixture('hh-resume-single.html');
      const url = 'https://hh.ru/resume/abc123def456';

      const candidates = detectResumeCandidates(html, url);

      expect(candidates).toHaveLength(1);
      expect(candidates[0].hash).toBe('abc123def456');
      expect(candidates[0].title).toBe('Senior Frontend Developer');
      expect(candidates[0].isActive).toBe(true);
      expect(candidates[0].url).toBe(url);
    });

    it('extracts resume URLs correctly', () => {
      const html = loadFixture('hh-resumes-list.html');

      const candidates = detectResumeCandidates(html);

      expect(candidates[0].url).toBe('https://hh.ru/resume/abc123def456');
      expect(candidates[1].url).toBe('https://hh.ru/resume/789xyz012abc');
    });

    it('returns empty array when no resumes found', () => {
      const html = '<div>No resumes here</div>';

      const candidates = detectResumeCandidates(html);

      expect(candidates).toHaveLength(0);
    });

    it('sets lastSeenAt timestamp', () => {
      const html = loadFixture('hh-resumes-list.html');
      const before = Date.now();

      const candidates = detectResumeCandidates(html);

      const after = Date.now();
      expect(candidates[0].lastSeenAt).toBeGreaterThanOrEqual(before);
      expect(candidates[0].lastSeenAt).toBeLessThanOrEqual(after);
    });

    it('tolerates missing optional fields', () => {
      const html = loadFixture('hh-resumes-list.html');

      const candidates = detectResumeCandidates(html);

      // Fourth resume has no status element
      expect(candidates[3].hash).toBe('test123');
      expect(candidates[3].isActive).toBe(false);
    });
  });
});
