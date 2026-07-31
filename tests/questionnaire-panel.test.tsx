import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { QuestionnairePanel } from '../src/components/QuestionnairePanel';
import { ManualActionsPanel } from '../src/components/ManualActionsPanel';
import { INITIAL_QUESTIONNAIRE_STATE } from '../src/questionnaires';

describe('QuestionnairePanel', () => {
  it('renders a collapsible beta workflow and a review queue item', () => {
    const html = renderToStaticMarkup(
      <QuestionnairePanel
        onPatch={vi.fn()}
        manualQuestionnaireCount={2}
        selectedResume={{
          hash: 'resume-1',
          title: 'Senior TypeScript Developer',
          url: 'https://hh.ru/resume/resume-1',
        }}
        state={{
          ...INITIAL_QUESTIONNAIRE_STATE,
          settings: {
            ...INITIAL_QUESTIONNAIRE_STATE.settings,
            context: {
              ...INITIAL_QUESTIONNAIRE_STATE.settings.context,
              legendFile: {
                name: 'legend.md',
                content: '# Candidate legend',
                loadedAt: 1,
                artifact: {
                  version: 1,
                  sourceName: 'legend.md',
                  modelId: 'openrouter/free',
                  generatedAt: 2,
                  profileTitle: 'Senior TypeScript Developer',
                  seniority: 'senior',
                  geography: 'Москва',
                  summary: 'Backend-разработчик TypeScript',
                  confirmedFacts: ['TypeScript — 5 лет'],
                  inferredDefaults: [{
                    key: 'salary_expectation',
                    value: 'от 300 000 ₽ gross в месяц',
                    rationale: 'Профильный ориентир',
                  }],
                  content: 'compact profile',
                },
              },
            },
            provider: {
              ...INITIAL_QUESTIONNAIRE_STATE.settings.provider,
              modelId: 'openrouter/free',
            },
          },
          queue: [{
            questionnaire: {
              id: 'hh_42_task_1',
              vacancyId: '42',
              source: 'hh_backend',
              detectedAt: 1,
              questions: [{
                id: 'task_1',
                type: 'text',
                prompt: 'Опишите опыт',
                required: true,
              }],
            },
            status: 'needs_review',
            manualActionId: 'manual-42',
            sourceUrl: 'https://hh.ru/vacancy/42',
            vacancyTitle: 'Senior TypeScript Developer (AI &amp; Automation)',
            company: 'Example',
            answerPlan: {
              questionnaireId: 'hh_42_task_1',
              providerId: 'openrouter',
              modelId: 'openrouter/free',
              generatedAt: 2,
              answers: [{
                questionId: 'task_1',
                text: 'Пять лет',
                confidence: 0.9,
                evidence: [{ source: 'resume', reference: 'TypeScript — 5 лет' }],
                requiresReview: true,
              }],
            },
            updatedAt: 2,
          }],
        }}
      />
    );

    expect(html).toContain('Заполнение анкет с AI');
    expect(html).toContain('Beta');
    expect(html).toContain('legend.md');
    expect(html).toContain('AI-профиль готов');
    expect(html).toContain('от 300 000 ₽ gross в месяц');
    expect(html).toContain('Пересобрать AI-профиль');
    expect(html).toContain('Senior TypeScript Developer');
    expect(html).toContain('AI &amp; Automation');
    expect(html).not.toContain('&amp;amp;');
    expect(html).toContain('Backend-приёмка · ожидает: 2');
    expect(html).toContain('Нажмите AI у анкеты');
    expect(html).toContain('Вы проверяете и правите');
    expect(html).toContain('Нужно проверить');
    expect(html).toContain('Одобрить и отправить');
    expect(html).toContain('Сгенерировать заново');
    expect(html).toContain('Пять лет');
  });

  it('renders the default hosted provider inside the questionnaire workflow', () => {
    const html = renderToStaticMarkup(
      <QuestionnairePanel
        state={INITIAL_QUESTIONNAIRE_STATE}
        selectedResume={null}
        manualQuestionnaireCount={0}
        onPatch={vi.fn()}
      />
    );

    expect(html).toContain('OpenRouter');
    expect(html).toContain('OpenRouter Free');
    expect(html).toContain('Нужен ключ');
  });

  it('offers AI preparation on each backend questionnaire action', () => {
    const html = renderToStaticMarkup(
      <ManualActionsPanel
        actions={[{
          id: 'manual-1',
          type: 'questionnaire',
          title: 'Backend Developer',
          company: 'Example',
          vacancyId: '42',
          url: 'https://hh.ru/applicant/vacancy_response?vacancyId=42',
          reasonCode: 'questionnaire_required',
        }]}
        onOpen={vi.fn()}
        onDone={vi.fn()}
        onDismiss={vi.fn()}
        onPrepareAI={vi.fn().mockResolvedValue({ success: true })}
      />
    );

    expect(html).toContain('Заполнить с AI');
    expect(html).toContain('Backend Developer');
  });

  it('renders hosted providers, editable models, and free-tier guidance', () => {
    const html = renderToStaticMarkup(
      <QuestionnairePanel
        state={{
          ...INITIAL_QUESTIONNAIRE_STATE,
          settings: {
            ...INITIAL_QUESTIONNAIRE_STATE.settings,
            provider: {
              ...INITIAL_QUESTIONNAIRE_STATE.settings.provider,
              type: 'groq',
              modelId: 'openai/gpt-oss-120b',
            },
          },
        }}
        selectedResume={null}
        manualQuestionnaireCount={0}
        onPatch={vi.fn()}
      />
    );

    expect(html).toContain('OpenAI');
    expect(html).toContain('Claude');
    expect(html).toContain('Google Gemini');
    expect(html).toContain('OpenRouter');
    expect(html).toContain('Groq');
    expect(html).toContain('DeepSeek');
    expect(html).toContain('OpenCode / свой gateway');
    expect(html).toContain('Бесплатный старт');
    expect(html).toContain('Вставьте API-ключ');
    expect(html).toContain('openai/gpt-oss-120b');
    expect(html).toContain('Проверить подключение');
    expect(html).toContain('Для чего подходит');
    expect(html).toContain('Что происходит с данными');
    expect(html).toContain('Как подключить');
    expect(html).toContain('Очень быстрая генерация большого количества черновиков');
    expect(html).toContain('Выбор AI-провайдера');
    expect(html).toContain('Выбор AI-модели');
    expect(html).toContain('GPT-OSS 120B');
    expect(html).toContain('API списка моделей не публикует цену');
    expect(html).toContain('Официальный прайсинг');
    expect(html).toContain('Указать ID вручную');
  });
});
