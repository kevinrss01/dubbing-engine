import { models, requestToGPT } from '../llm/openai';
import type { OpenAIModel } from '../llm/openai';
import { PromptBuilder } from '../llm/prompt-builder';
import { defaultInstructions } from '../llm/prompt-builder';
import type {
  AllowedLanguages,
  AudioOriginalLangAllowed,
  CreatePromptArguments,
  SegmentDetailOutWithDuration,
  SegmentWitDurationAndOriginalSegment,
} from '../types';

export class TextTranslator {
  static async translateTranscriptionInTargetLanguage({
    transcription,
    targetLanguage,
    originLanguage,
    transcriptionSummary,
  }: {
    transcription: SegmentDetailOutWithDuration[];
    targetLanguage: AllowedLanguages;
    originLanguage: AudioOriginalLangAllowed;
    transcriptionSummary: string;
  }) {
    const translatedTranscription = await this.translateTranscription({
      transcription,
      targetLanguage,
      originLanguage,
      transcriptionSummary,
    });

    return translatedTranscription;
  }

  static async translateTranscription({
    transcription,
    targetLanguage,
    originLanguage,
    transcriptionSummary,
  }: {
    transcription: SegmentDetailOutWithDuration[];
    targetLanguage: AllowedLanguages;
    originLanguage: string;
    transcriptionSummary: string;
  }) {
    console.debug('Translating transcription...');
    const maxSimultaneousTranslation = 10;
    let translationPromises: Promise<string>[] = [];
    const transcriptionTranslated: SegmentWitDurationAndOriginalSegment[] = [];
    const deepCopyTranscriptions = (
      JSON.parse(JSON.stringify(transcription)) as SegmentWitDurationAndOriginalSegment[]
    ).sort((a, b) => a.index - b.index) as SegmentWitDurationAndOriginalSegment[];

    try {
      for (let i = 0; i < deepCopyTranscriptions.length; i++) {
        // Skip for first transcription to avoid undefined reference
        const lastTranscription = i !== 0 ? deepCopyTranscriptions[i - 1].transcription : '';

        const actualTranscription = deepCopyTranscriptions[i].transcription;

        deepCopyTranscriptions[i].transcription = actualTranscription;

        const actualTranscriptionSpeaker = deepCopyTranscriptions[i].speaker?.toString() || '0';

        const nextTranscriptionSpeaker =
          i !== deepCopyTranscriptions.length - 1
            ? deepCopyTranscriptions[i + 1].speaker?.toString() || '0'
            : '';

        const nextTranscription =
          i !== deepCopyTranscriptions.length - 1 ? deepCopyTranscriptions[i + 1].transcription || '' : '';

        const lastTranscriptionSpeaker = lastTranscription
          ? deepCopyTranscriptions[i - 1].speaker?.toString() || '0'
          : '';

        const translationPromise = this.getTranslationPromise({
          actualTranscription,
          lastTranscription,
          targetLanguage: targetLanguage,
          transcriptionLanguage: originLanguage,
          actualTranscriptionSpeaker,
          nextTranscriptionSpeaker,
          nextTranscription,
          lastTranscriptionSpeaker,
          transcriptionSummary,
        });

        translationPromises.push(translationPromise);

        // Resolve translations in batches or at the last item
        if (
          translationPromises.length === maxSimultaneousTranslation ||
          i === deepCopyTranscriptions.length - 1
        ) {
          const translations: string[] = await Promise.all(translationPromises);
          for (let j = 0; j < translations.length; j++) {
            const transcriptionToUpdate = deepCopyTranscriptions[transcriptionTranslated.length];
            transcriptionToUpdate.originalTranscription = deepCopyTranscriptions[j].transcription;
            transcriptionToUpdate.transcription = translations[j];
            transcriptionToUpdate.language = targetLanguage;

            transcriptionTranslated.push(transcriptionToUpdate);
          }
          translationPromises = [];
        }
      }

      console.debug('Transcription translated.');
      return transcriptionTranslated;
    } catch (error: unknown) {
      console.error(error);
      throw new Error('Error while translating transcription');
    }
  }

  static async getTranslationPromise({
    actualTranscription,
    lastTranscription,
    targetLanguage,
    transcriptionLanguage,
    nextTranscriptionSpeaker,
    nextTranscription,
    lastTranscriptionSpeaker,
    actualTranscriptionSpeaker,
    transcriptionSummary,
  }: {
    actualTranscription: string;
    lastTranscription: string;
    targetLanguage: AllowedLanguages;
    transcriptionLanguage: string;
    actualTranscriptionSpeaker: string;
    nextTranscriptionSpeaker?: string;
    nextTranscription?: string;
    lastTranscriptionSpeaker?: string;
    transcriptionSummary: string;
  }) {
    const maxAttempts = 3;
    let textTranslated = '';
    let attempts = 0;

    do {
      textTranslated = await this.getTranslationPromiseFromAI({
        actualTranscription,
        lastTranscription,
        targetLanguage,
        transcriptionLanguage,
        nextTranscription: nextTranscription || '',
        nextTranscriptionSpeaker: nextTranscriptionSpeaker || '',
        lastTranscriptionSpeaker: lastTranscriptionSpeaker || '',
        actualTranscriptionSpeaker,
        transcriptionSummary,
      });
      attempts++;
    } while (textTranslated === actualTranscription && attempts < maxAttempts);

    return textTranslated;
  }

  static async getTranslationPromiseFromAI({
    actualTranscription,
    lastTranscription,
    targetLanguage,
    transcriptionLanguage,
    nextTranscriptionSpeaker,
    nextTranscription,
    lastTranscriptionSpeaker,
    actualTranscriptionSpeaker,
    transcriptionSummary,
  }: {
    actualTranscription: string;
    lastTranscription: string;
    targetLanguage: AllowedLanguages;
    transcriptionLanguage: string;
    nextTranscription?: string;
    nextTranscriptionSpeaker?: string;
    lastTranscriptionSpeaker?: string;
    actualTranscriptionSpeaker: string;
    transcriptionSummary: string;
  }) {
    const promptSettings: CreatePromptArguments = {
      transcriptionToTranslate: actualTranscription,
      lastTranscription: lastTranscription,
      targetLanguage: targetLanguage,
      originLanguage: transcriptionLanguage,
      mainCategoryVideo: '',
      nextTranscription: nextTranscription || '',
      nextTranscriptionSpeaker: nextTranscriptionSpeaker || '',
      previousTranscriptionSpeaker: lastTranscriptionSpeaker || '',
      transcriptionToTranslateSpeaker: actualTranscriptionSpeaker || '',
      transcriptionSummary: transcriptionSummary,
    };

    const prompt = PromptBuilder.createPromptToTranslateTranscription(promptSettings);

    return this.translateWithLLM({
      prompt,
      instruction: defaultInstructions,
      temperature: 0.5,
    });
  }

  static async translateWithLLM({
    prompt,
    temperature,
    instruction,
    responseFormat = 'text',
  }: {
    prompt: string;
    temperature: number;
    instruction: string;
    responseFormat?: 'text' | 'json';
  }) {
    let model: OpenAIModel = models.gpt4_1;

    try {
      return await requestToGPT({
        prompt,
        temperature,
        instructions: instruction,
        model,
        maxTokens: 8192,
        responseFormat: responseFormat === 'json' ? 'json_object' : 'text',
      });
    } catch (error) {
      console.error(error);
      throw new Error('Error while translating transcription');
    }
  }
}
