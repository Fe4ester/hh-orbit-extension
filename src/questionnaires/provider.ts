import type { AnswerPlan, CandidateContext, LegendArtifact, Questionnaire } from './types';

export interface AIProviderHealth {
  available: boolean;
  message?: string;
}

export interface AIModelPricing {
  currency: 'USD';
  inputPerMillion?: number;
  outputPerMillion?: number;
}

export interface AIModelInfo {
  id: string;
  name: string;
  description?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  ownedBy?: string;
  pricing?: AIModelPricing;
  free?: boolean;
}

export interface AIProvider {
  readonly id: string;
  generateAnswers(input: {
    questionnaire: Questionnaire;
    context: CandidateContext;
    modelId: string;
  }): Promise<AnswerPlan>;
  prepareLegend(input: {
    name: string;
    content: string;
    modelId: string;
  }): Promise<LegendArtifact>;
  testConnection(): Promise<AIProviderHealth>;
  listModels(): Promise<string[]>;
  listModelDetails(): Promise<AIModelInfo[]>;
}

export class DisabledAIProvider implements AIProvider {
  readonly id = 'disabled';

  async generateAnswers(): Promise<AnswerPlan> {
    throw new Error('AI answer generation is not configured');
  }

  async prepareLegend(): Promise<LegendArtifact> {
    throw new Error('AI legend preparation is not configured');
  }

  async testConnection(): Promise<AIProviderHealth> {
    return { available: false, message: 'Select and configure an AI provider first' };
  }

  async listModels(): Promise<string[]> {
    return [];
  }

  async listModelDetails(): Promise<AIModelInfo[]> {
    return [];
  }
}
