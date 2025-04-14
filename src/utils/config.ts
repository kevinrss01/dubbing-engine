import type { AllowedLanguages } from '../types';

export const threshold = 0.7; // 0.8 seconds
export const maxCharactersPerSegment = 350;
export const maxCharactersPerSegmentForNonLatinScriptLanguages = 175;
export const maxSimultaneousFetchElevenLabs = 1;
export const maxSimultaneousFetchOpenAI = process.env.NODE_ENV === 'production' ? 4 : 10;
export const silenceBetweenSegmentConsideredAsPause = 0.5;

export const specialLanguagesWithSpecialCharacters: AllowedLanguages[] = ['mandarin', 'japanese', 'korean'];
