import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  QuestionnaireProcessor,
  type AIProvider,
  type AnswerPlan,
  type Questionnaire,
  type QuestionnaireTabMessenger,
} from '../src/questionnaires';
import { StateStore } from '../src/state/store';
import { InMemoryStorageAdapter } from '../src/state/storage';

const questionnaire: Questionnaire = {
  id: 'hh_42_task_1',
  vacancyId: '42',
  source: 'hh_backend',
  detectedAt: 1,
  questions: [{
    id: 'task_1',
    type: 'text',
    prompt: 'Опишите опыт с TypeScript',
    required: true,
  }],
};

function answerPlan(overrides: Partial<AnswerPlan['answers'][number]> = {}): AnswerPlan {
  return {
    questionnaireId: questionnaire.id,
    providerId: 'local',
    modelId: 'openrouter/free',
    generatedAt: 2,
    answers: [{
      questionId: 'task_1',
      text: 'Пять лет',
      confidence: 0.98,
      evidence: [{ source: 'resume', reference: 'TypeScript — 5 лет' }],
      requiresReview: false,
      ...overrides,
    }],
  };
}

describe('QuestionnaireProcessor', () => {
  let store: StateStore;
  let provider: AIProvider;
  let messenger: QuestionnaireTabMessenger;

  beforeEach(async () => {
    store = new StateStore(new InMemoryStorageAdapter());
    await store.init();
    await store.updateQuestionnaireSettings({
      provider: { modelId: 'openrouter/free' },
      context: { resumeFacts: ['TypeScript — 5 лет'] },
    });
    provider = {
      id: 'local',
      listModels: vi.fn().mockResolvedValue(['openrouter/free']),
      testConnection: vi.fn().mockResolvedValue({ available: true }),
      generateAnswers: vi.fn().mockResolvedValue(answerPlan()),
      prepareLegend: vi.fn(),
    };
    messenger = {
      extract: vi.fn().mockResolvedValue(questionnaire),
      fill: vi.fn().mockResolvedValue({
        filledQuestionIds: ['task_1'],
        skippedQuestionIds: [],
        errors: [],
      }),
    };
  });

  function processor() {
    return new QuestionnaireProcessor({
      store,
      createProvider: () => provider,
      tabMessenger: messenger,
    });
  }

  it('captures and generates a reviewable draft using persisted context', async () => {
    const service = processor();
    await service.capture(10, '42', {
      manualActionId: 'manual-42',
      sourceUrl: 'https://hh.ru/vacancy/42',
      vacancyTitle: 'TypeScript Developer',
      company: 'Example',
      source: 'hh_backend',
    });
    const item = await service.processOne(questionnaire.id);

    expect(item.status).toBe('needs_review');
    expect(item).toMatchObject({
      manualActionId: 'manual-42',
      sourceUrl: 'https://hh.ru/vacancy/42',
      vacancyTitle: 'TypeScript Developer',
      company: 'Example',
    });
    expect(provider.generateAnswers).toHaveBeenCalledWith(expect.objectContaining({
      questionnaire,
      context: expect.objectContaining({ resumeFacts: ['TypeScript — 5 лет'] }),
      modelId: 'openrouter/free',
    }));
  });

  it('always requires backend review even when legacy review setting is disabled', async () => {
    await store.updateQuestionnaireSettings({ requireReview: false });
    await store.enqueueQuestionnaire(questionnaire);

    const item = await processor().processOne(questionnaire.id);
    expect(item.status).toBe('needs_review');
  });

  it('keeps unsupported answers in review', async () => {
    await store.updateQuestionnaireSettings({ requireReview: false });
    await store.enqueueQuestionnaire(questionnaire);
    provider.generateAnswers = vi.fn().mockResolvedValue(answerPlan({
      evidence: [],
      requiresReview: true,
    }));

    const item = await processor().processOne(questionnaire.id);
    expect(item.status).toBe('needs_review');
  });

  it('fills only an approved plan and never submits it', async () => {
    await store.enqueueQuestionnaire(questionnaire);
    await processor().processOne(questionnaire.id);
    await processor().approve(questionnaire.id);

    const report = await processor().fill(10, questionnaire.id);

    expect(report.filledQuestionIds).toEqual(['task_1']);
    expect(store.getState().questionnaires.queue[0].status).toBe('filled');
    expect(messenger.fill).toHaveBeenCalledOnce();
  });

  it('records a user-reviewed answer before approval', async () => {
    await store.enqueueQuestionnaire(questionnaire);
    await processor().processOne(questionnaire.id);

    await processor().reviseAnswer(questionnaire.id, 'task_1', { text: 'Шесть лет' });

    expect(store.getState().questionnaires.queue[0].answerPlan?.answers[0]).toMatchObject({
      text: 'Шесть лет',
      confidence: 1,
      requiresReview: false,
      evidence: [{ source: 'user_instruction' }],
    });
  });

  it('records provider errors and continues processing the queue', async () => {
    await store.enqueueQuestionnaire(questionnaire);
    provider.generateAnswers = vi.fn().mockRejectedValue(new Error('model unavailable'));

    const result = await processor().processPending();

    expect(result).toEqual({ processed: 0, failed: 1 });
    expect(store.getState().questionnaires.queue[0]).toMatchObject({
      status: 'failed',
      error: 'model unavailable',
    });
    expect(store.getState().questionnaires.processing).toBe(false);
  });

  it('uses dynamically loaded legend and resume context', async () => {
    await store.enqueueQuestionnaire(questionnaire);
    const dynamicContext = {
      resumeFacts: ['Полный текст выбранного резюме'],
      profileFacts: [],
      savedAnswers: [],
      instructions: '',
      legendFile: {
        name: 'legend.md',
        content: 'Отвечать кратко и честно',
        loadedAt: 1,
      },
    };
    const service = new QuestionnaireProcessor({
      store,
      createProvider: () => provider,
      tabMessenger: messenger,
      getCandidateContext: vi.fn().mockResolvedValue(dynamicContext),
    });

    await service.processOne(questionnaire.id);

    expect(provider.generateAnswers).toHaveBeenCalledWith(expect.objectContaining({
      context: dynamicContext,
    }));
  });

  it('refuses to fill a draft before explicit approval', async () => {
    await store.enqueueQuestionnaire(questionnaire);
    const service = processor();
    await service.processOne(questionnaire.id);

    await expect(service.fill(10, questionnaire.id)).rejects.toThrow(
      'must be approved'
    );
    expect(messenger.fill).not.toHaveBeenCalled();
    expect(store.getState().questionnaires.queue[0].status).toBe('needs_review');
  });

  it('recovers a questionnaire left generating after a worker restart', async () => {
    await store.enqueueQuestionnaire(questionnaire);
    await store.transitionQuestionnaire(questionnaire.id, 'ready_for_ai');
    await store.transitionQuestionnaire(questionnaire.id, 'generating');

    const item = await processor().processOne(questionnaire.id);

    expect(item.status).toBe('needs_review');
    expect(provider.generateAnswers).toHaveBeenCalledOnce();
  });

  it('deduplicates concurrent generation for the same questionnaire', async () => {
    await store.enqueueQuestionnaire(questionnaire);
    let finish!: (plan: AnswerPlan) => void;
    provider.generateAnswers = vi.fn().mockReturnValue(new Promise(resolve => {
      finish = resolve;
    }));
    const service = processor();

    const first = service.processOne(questionnaire.id);
    const second = service.processOne(questionnaire.id);
    finish(answerPlan());

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(provider.generateAnswers).toHaveBeenCalledOnce();
  });

  it('replaces an existing review draft when regenerated', async () => {
    await store.enqueueQuestionnaire(questionnaire);
    const service = processor();
    await service.processOne(questionnaire.id);
    provider.generateAnswers = vi.fn().mockResolvedValue(answerPlan({ text: 'Новый ответ' }));

    const item = await service.processOne(questionnaire.id);

    expect(item.status).toBe('needs_review');
    expect(item.answerPlan?.answers[0].text).toBe('Новый ответ');
    expect(provider.generateAnswers).toHaveBeenCalledOnce();
  });
});
