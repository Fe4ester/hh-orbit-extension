export type QuestionnaireSource = 'hh_live' | 'hh_backend' | 'external';
export type QuestionType = 'single' | 'multiple' | 'text' | 'number' | 'boolean' | 'unknown';

export type QuestionnaireStatus =
  | 'detected'
  | 'ready_for_ai'
  | 'generating'
  | 'needs_review'
  | 'approved'
  | 'filled'
  | 'submitted'
  | 'failed'
  | 'skipped';

export interface QuestionnaireOption {
  value: string;
  label: string;
}

export interface QuestionnaireQuestion {
  id: string;
  type: QuestionType;
  prompt: string;
  required: boolean;
  options?: QuestionnaireOption[];
  allowsCustomText?: boolean;
}

export interface Questionnaire {
  id: string;
  vacancyId: string;
  source: QuestionnaireSource;
  questions: QuestionnaireQuestion[];
  detectedAt: number;
}

export interface CandidateEvidence {
  source: 'resume' | 'profile' | 'saved_answer' | 'user_instruction';
  reference: string;
}

export interface SuggestedAnswer {
  questionId: string;
  selectedValues?: string[];
  text?: string;
  confidence: number;
  evidence: CandidateEvidence[];
  requiresReview: boolean;
  warning?: string;
}

export interface AnswerPlan {
  questionnaireId: string;
  providerId: string;
  modelId: string;
  answers: SuggestedAnswer[];
  generatedAt: number;
}

export interface QuestionnaireQueueItem {
  questionnaire: Questionnaire;
  status: QuestionnaireStatus;
  answerPlan?: AnswerPlan;
  manualActionId?: string;
  sourceUrl?: string;
  vacancyTitle?: string;
  company?: string;
  error?: string;
  updatedAt: number;
}

export interface CandidateContext {
  resumeFacts: string[];
  profileFacts: string[];
  savedAnswers: Array<{ prompt: string; answer: string }>;
  instructions?: string;
  legendFile?: {
    name: string;
    content: string;
    loadedAt: number;
    artifact?: LegendArtifact | null;
  } | null;
}

export type LegendDefaultKey =
  | 'salary_expectation'
  | 'employment_type'
  | 'work_format'
  | 'schedule'
  | 'start_availability'
  | 'relocation'
  | 'business_travel';

export interface LegendProfileDefault {
  key: LegendDefaultKey;
  value: string;
  rationale: string;
}

export interface LegendArtifact {
  version: 1;
  preparationMode?: 'ai' | 'source_fallback';
  sourceName: string;
  modelId: string;
  generatedAt: number;
  profileTitle: string;
  seniority: 'intern' | 'junior' | 'middle' | 'senior' | 'lead' | 'unknown';
  geography: string;
  summary: string;
  confirmedFacts: string[];
  inferredDefaults: LegendProfileDefault[];
  content: string;
}

export interface QuestionnaireAISettings {
  autoProcessAfterCollection: boolean;
  autoFillApproved: boolean;
  requireReview: boolean;
  context: CandidateContext;
  provider: {
    type: AIProviderId;
    modelId: string;
    customBaseUrl?: string;
    temperature: number;
    timeoutMs: number;
  };
  confidence: {
    autoApprove: number;
    needsReview: number;
  };
}

export type AIProviderId =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'openrouter'
  | 'groq'
  | 'deepseek'
  | 'custom_openai';

export type QuestionnaireAISettingsPatch =
  Partial<Omit<QuestionnaireAISettings, 'provider' | 'confidence' | 'context'>> & {
    provider?: Partial<QuestionnaireAISettings['provider']>;
    confidence?: Partial<QuestionnaireAISettings['confidence']>;
    context?: Partial<QuestionnaireAISettings['context']>;
  };

export interface QuestionnaireState {
  settings: QuestionnaireAISettings;
  queue: QuestionnaireQueueItem[];
  processing: boolean;
  lastProcessedAt: number | null;
  lastError: string | null;
}

export const DEFAULT_QUESTIONNAIRE_AI_SETTINGS: QuestionnaireAISettings = {
  autoProcessAfterCollection: false,
  autoFillApproved: false,
  requireReview: true,
  context: {
    resumeFacts: [],
    profileFacts: [],
    savedAnswers: [],
    instructions: '',
    legendFile: null,
  },
  provider: {
    type: 'openrouter',
    modelId: 'openrouter/free',
    temperature: 0.1,
    timeoutMs: 180_000,
  },
  confidence: {
    autoApprove: 0.95,
    needsReview: 0.7,
  },
};

export const INITIAL_QUESTIONNAIRE_STATE: QuestionnaireState = {
  settings: DEFAULT_QUESTIONNAIRE_AI_SETTINGS,
  queue: [],
  processing: false,
  lastProcessedAt: null,
  lastError: null,
};
