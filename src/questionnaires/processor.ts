import type { StateStore } from '../state/store';
import type { AIProvider } from './provider';
import { attachAnswerPlan, failQuestionnaire } from './queue';
import type {
  AnswerPlan,
  CandidateContext,
  Questionnaire,
  QuestionnaireQueueItem,
} from './types';

export interface QuestionnaireTabMessenger {
  extract(tabId: number, vacancyId: string): Promise<Questionnaire>;
  fill(tabId: number, questionnaire: Questionnaire, answerPlan: AnswerPlan): Promise<QuestionnaireFillReport>;
}

export interface QuestionnaireFillReport {
  filledQuestionIds: string[];
  skippedQuestionIds: string[];
  errors: string[];
}

type QuestionnaireStore = Pick<
  StateStore,
  | 'getState'
  | 'enqueueQuestionnaire'
  | 'updateQuestionnaireItem'
  | 'transitionQuestionnaire'
  | 'setQuestionnaireProcessing'
>;

interface QuestionnaireProcessorOptions {
  store: QuestionnaireStore;
  createProvider: () => AIProvider | Promise<AIProvider>;
  tabMessenger?: QuestionnaireTabMessenger;
  getCandidateContext?: () => Promise<CandidateContext>;
}

export interface QuestionnaireCaptureMetadata {
  manualActionId?: string;
  sourceUrl?: string;
  vacancyTitle?: string;
  company?: string;
  source?: Questionnaire['source'];
}

export class QuestionnaireProcessor {
  private readonly generationJobs = new Map<string, Promise<QuestionnaireQueueItem>>();

  constructor(private readonly options: QuestionnaireProcessorOptions) {}

  async capture(
    tabId: number,
    vacancyId: string,
    metadata: QuestionnaireCaptureMetadata = {}
  ): Promise<QuestionnaireQueueItem> {
    if (!this.options.tabMessenger) {
      throw new Error('Browser questionnaire capture is not configured');
    }
    const extracted = await this.options.tabMessenger.extract(tabId, vacancyId);
    const questionnaire = metadata.source
      ? { ...extracted, source: metadata.source }
      : extracted;
    return this.enqueue(questionnaire, metadata);
  }

  async enqueue(
    questionnaire: Questionnaire,
    metadata: QuestionnaireCaptureMetadata = {}
  ): Promise<QuestionnaireQueueItem> {
    await this.options.store.enqueueQuestionnaire(questionnaire);
    const stored = this.findItem(questionnaire.id);
    const item = stored && {
      ...stored,
      manualActionId: metadata.manualActionId ?? stored.manualActionId,
      sourceUrl: metadata.sourceUrl ?? stored.sourceUrl,
      vacancyTitle: metadata.vacancyTitle ?? stored.vacancyTitle,
      company: metadata.company ?? stored.company,
    };
    if (!item) throw new Error('Captured questionnaire was not stored');
    await this.options.store.updateQuestionnaireItem(item);
    return item;
  }

  async listModels(): Promise<string[]> {
    return (await this.options.createProvider()).listModels();
  }

  async listModelDetails() {
    return (await this.options.createProvider()).listModelDetails();
  }

  async testConnection() {
    return (await this.options.createProvider()).testConnection();
  }

  async processPending(): Promise<{ processed: number; failed: number }> {
    const candidates = this.options.store.getState().questionnaires.queue
      .filter(item => ['detected', 'ready_for_ai', 'failed'].includes(item.status))
      .map(item => item.questionnaire.id);
    let processed = 0;
    let failed = 0;

    await this.options.store.setQuestionnaireProcessing(true);
    try {
      for (const id of candidates) {
        const result = await this.processOne(id);
        if (result.status === 'failed') failed += 1;
        else processed += 1;
      }
      return { processed, failed };
    } finally {
      await this.options.store.setQuestionnaireProcessing(false);
    }
  }

  async processOne(questionnaireId: string): Promise<QuestionnaireQueueItem> {
    const existing = this.generationJobs.get(questionnaireId);
    if (existing) return existing;
    const job = this.processOneCore(questionnaireId).finally(() => {
      if (this.generationJobs.get(questionnaireId) === job) {
        this.generationJobs.delete(questionnaireId);
      }
    });
    this.generationJobs.set(questionnaireId, job);
    return job;
  }

  private async processOneCore(questionnaireId: string): Promise<QuestionnaireQueueItem> {
    const settings = this.options.store.getState().questionnaires.settings;

    let item = this.requireItem(questionnaireId);
    if (item.status === 'generating') {
      await this.options.store.updateQuestionnaireItem(
        failQuestionnaire(item, 'Предыдущая генерация была прервана')
      );
      item = this.requireItem(questionnaireId);
    }
    if (item.status === 'needs_review') {
      await this.options.store.transitionQuestionnaire(questionnaireId, 'ready_for_ai');
      item = this.requireItem(questionnaireId);
    }
    if (item.status === 'detected' || item.status === 'failed') {
      await this.options.store.transitionQuestionnaire(questionnaireId, 'ready_for_ai');
      item = this.requireItem(questionnaireId);
    }
    if (item.status !== 'ready_for_ai') {
      throw new Error(`Questionnaire ${questionnaireId} is not ready for AI`);
    }

    await this.options.store.transitionQuestionnaire(questionnaireId, 'generating');
    item = this.requireItem(questionnaireId);

    try {
      const context = this.options.getCandidateContext
        ? await this.options.getCandidateContext()
        : settings.context;
      const provider = await this.options.createProvider();
      const answerPlan = await provider.generateAnswers({
        questionnaire: item.questionnaire,
        context,
        modelId: settings.provider.modelId,
      });
      const next = attachAnswerPlan(item, answerPlan);
      await this.options.store.updateQuestionnaireItem(next);
      return next;
    } catch (error) {
      const failed = failQuestionnaire(
        item,
        error instanceof Error ? error.message : 'AI answer generation failed'
      );
      await this.options.store.updateQuestionnaireItem(failed);
      return failed;
    }
  }

  async approve(questionnaireId: string): Promise<void> {
    const item = this.requireItem(questionnaireId);
    if (!item.answerPlan) throw new Error('Questionnaire has no answer plan');
    await this.options.store.transitionQuestionnaire(questionnaireId, 'approved');
  }

  async reviseAnswer(
    questionnaireId: string,
    questionId: string,
    value: { text?: string; selectedValues?: string[] }
  ): Promise<void> {
    const item = this.requireItem(questionnaireId);
    if (item.status !== 'needs_review' || !item.answerPlan) {
      throw new Error('Answers can only be edited during review');
    }
    const question = item.questionnaire.questions.find(current => current.id === questionId);
    if (!question) throw new Error(`Question ${questionId} not found`);

    const allowedValues = new Set(question.options?.map(option => option.value) ?? []);
    const selectedValues = value.selectedValues?.filter(option => allowedValues.has(option));
    if (value.selectedValues && selectedValues?.length !== value.selectedValues.length) {
      throw new Error('Answer contains an invalid option');
    }

    const answers = item.answerPlan.answers.map(answer => answer.questionId === questionId
      ? {
          ...answer,
          text: typeof value.text === 'string' ? value.text : answer.text,
          selectedValues: value.selectedValues ? selectedValues : answer.selectedValues,
          confidence: 1,
          evidence: [{
            source: 'user_instruction' as const,
            reference: 'Ответ проверен пользователем',
          }],
          requiresReview: false,
          warning: undefined,
        }
      : answer
    );
    if (!answers.some(answer => answer.questionId === questionId)) {
      answers.push({
        questionId,
        text: value.text,
        selectedValues,
        confidence: 1,
        evidence: [{
          source: 'user_instruction',
          reference: 'Ответ добавлен пользователем',
        }],
        requiresReview: false,
      });
    }

    await this.options.store.updateQuestionnaireItem({
      ...item,
      answerPlan: { ...item.answerPlan, answers },
      updatedAt: Date.now(),
    });
  }

  async skip(questionnaireId: string): Promise<void> {
    await this.options.store.transitionQuestionnaire(questionnaireId, 'skipped');
  }

  async fill(tabId: number, questionnaireId: string): Promise<QuestionnaireFillReport> {
    const item = this.requireItem(questionnaireId);
    if (item.status !== 'approved' || !item.answerPlan) {
      throw new Error('Questionnaire must be approved before filling');
    }
    if (!this.options.tabMessenger) {
      throw new Error('Browser questionnaire filling is not configured');
    }
    const report = await this.options.tabMessenger.fill(tabId, item.questionnaire, item.answerPlan);
    if (report.errors.length > 0) {
      throw new Error(report.errors.join('; '));
    }
    await this.options.store.transitionQuestionnaire(questionnaireId, 'filled');
    return report;
  }

  private requireItem(questionnaireId: string): QuestionnaireQueueItem {
    const item = this.findItem(questionnaireId);
    if (!item) throw new Error(`Questionnaire ${questionnaireId} not found`);
    return item;
  }

  private findItem(questionnaireId: string): QuestionnaireQueueItem | undefined {
    return this.options.store.getState().questionnaires.queue.find(
      item => item.questionnaire.id === questionnaireId
    );
  }
}
