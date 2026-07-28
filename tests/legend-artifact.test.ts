import { describe, expect, it } from 'vitest';
import {
  buildLegendArtifactPrompt,
  parseLegendArtifact,
} from '../src/questionnaires';

describe('local legend artifact', () => {
  it('creates a reviewable salary default when the legend omits income', () => {
    const artifact = parseLegendArtifact({
      name: 'legend.md',
      sourceContent: 'Middle data analyst. SQL and Python.',
      modelId: 'openrouter/free',
      now: 10,
      responseContent: '<think></think>{"profileTitle":"Аналитик данных","seniority":"middle","geography":"Москва","summary":"Аналитик SQL/Python","confirmedFacts":["Использует SQL и Python","Зарплата не указана"],"inferredDefaults":[]}',
    });

    expect(artifact).toMatchObject({
      version: 1,
      profileTitle: 'Аналитик данных',
      seniority: 'middle',
      generatedAt: 10,
    });
    expect(artifact.inferredDefaults).toContainEqual(expect.objectContaining({
      key: 'salary_expectation',
      value: 'от 200 000 ₽ gross в месяц',
    }));
    expect(artifact.confirmedFacts).not.toContain('Зарплата не указана');
    expect(artifact.content).toContain('INFERRED DEFAULT — REVIEW REQUIRED');
  });

  it('does not add a salary assumption when an explicit amount exists', () => {
    const artifact = parseLegendArtifact({
      name: 'legend.md',
      sourceContent: 'Ожидания по зарплате: от 250 000 ₽ gross.',
      modelId: 'local',
      responseContent: '{"profileTitle":"Backend-разработчик","seniority":"senior","geography":"Москва","summary":"Senior backend","confirmedFacts":["Зарплата от 250 000 ₽ gross"],"inferredDefaults":[]}',
    });

    expect(artifact.inferredDefaults).not.toContainEqual(expect.objectContaining({
      key: 'salary_expectation',
    }));
  });

  it('replaces an incomplete model salary with a formatted profile default', () => {
    const artifact = parseLegendArtifact({
      name: 'legend.md',
      sourceContent: 'Middle data analyst. SQL and Python.',
      modelId: 'local',
      responseContent: '{"profileTitle":"Аналитик данных","seniority":"middle","geography":"Москва","summary":"Middle analyst","confirmedFacts":[],"inferredDefaults":[{"key":"salary_expectation","value":"120000-150000","rationale":"market"}]}',
    });

    expect(artifact.inferredDefaults[0]).toMatchObject({
      key: 'salary_expectation',
      value: 'от 200 000 ₽ gross в месяц',
    });
  });

  it('normalizes a complete model salary range to a stable RUB format', () => {
    const artifact = parseLegendArtifact({
      name: 'legend.md',
      sourceContent: 'Middle data analyst. SQL and Python.',
      modelId: 'local',
      responseContent: '{"profileTitle":"Аналитик данных","seniority":"middle","geography":"Москва","summary":"Middle analyst","confirmedFacts":[],"inferredDefaults":[{"key":"salary_expectation","value":"₽180000-₽220000 в месяц (gross)","rationale":"Профильный ориентир"}]}',
    });

    expect(artifact.inferredDefaults[0].value).toBe('180 000–220 000 ₽ gross в месяц');
  });

  it('limits the source sent to the local model', () => {
    const prompt = buildLegendArtifactPrompt('large.md', 'Python profile.\n\n'.repeat(10_000));

    expect(prompt.length).toBeLessThan(21_000);
    expect(prompt).toContain('salary_expectation');
  });

  it('accepts an object wrapped in an array by a local model', () => {
    const artifact = parseLegendArtifact({
      name: 'legend.md',
      sourceContent: 'Senior Python developer in Moscow.',
      modelId: 'local',
      responseContent: '[{"profileTitle":"Python-разработчик","seniority":"senior","geography":"Москва","summary":"Senior Python-разработчик","confirmedFacts":["Python"],"inferredDefaults":[]}]',
    });

    expect(artifact.preparationMode).toBe('ai');
    expect(artifact.profileTitle).toBe('Python-разработчик');
  });

  it('builds a truthful source fallback when model output is incomplete', () => {
    const artifact = parseLegendArtifact({
      name: 'candidate.md',
      sourceContent: '# Senior Python-разработчик\n\nМосква\n\nPython, FastAPI и PostgreSQL.',
      modelId: 'local',
      responseContent: '{"profileTitle":',
      now: 42,
    });

    expect(artifact).toMatchObject({
      preparationMode: 'source_fallback',
      seniority: 'senior',
      geography: 'Москва',
      generatedAt: 42,
    });
    expect(artifact.confirmedFacts).toContain('Python, FastAPI и PostgreSQL.');
    expect(artifact.inferredDefaults).toContainEqual(expect.objectContaining({
      key: 'salary_expectation',
    }));
  });
});
