export interface TranscriptionDataTypes {
  summary: SegmentDetailOutWithDuration | null;
  formattedSegments: string[];
  detectedAudioLanguage: AudioOriginalLangAllowed | null;
}

export interface GladiaResponse {
  id: string;
  request_id: string;
  kind: string;
  status: string;
  created_at: string;
  completed_at: string;
  file: GladiaFile;
  request_params: RequestParams;
  result: Result;
  //Custom, not natively from Gladia
  original_audio_path: string;
  error_code?: string;
}

export interface Metadata {
  audio_duration: number;
  number_of_distinct_channels: number;
  billing_time: number;
  transcription_time: number;
}

export interface Word {
  word: string;
  start: number;
  end: number;
  confidence: number;
}

export interface Utterance {
  text: string;
  language: string;
  start: number;
  end: number;
  confidence: number;
  channel: number;
  speaker: number;
  words: Word[];
}

export interface Sentence {
  sentence: string;
  language: string;
  start: number;
  end: number;
  confidence: number;
  channel: number;
  speaker: number;
  words: Word[];
}

export interface SegmentDetail {
  transcription: string;
  language: string;
  begin: number;
  end: number;
  speaker: number;
  channel: number;
  confidence: number;
  wordsWithSilence: string;
}

export interface SegmentWitDurationAndOriginalSegment extends SegmentDetail {
  duration: number;
  index: number;
  originalTranscription: string;
}

export interface SegmentDetailOut extends SegmentDetail {
  index: number;
}

export interface SegmentDetailOutWithDuration extends SegmentDetailOut {
  duration: number;
}

export interface Result {
  metadata: Metadata;
  summarization: {
    success: boolean;
    is_empty: boolean;
    results: string;
    exec_time: number;
    error: string | null;
  };
  transcription: Transcription;
}

export interface Transcription {
  languages: string[];
  full_transcript: string;
  utterances: Utterance[];
  sentences: Sentence[];
}

export interface CreatePromptArguments {
  transcriptionToTranslate: string;
  lastTranscription: string;
  targetLanguage: string;
  originLanguage: string;
  mainCategoryVideo: string;
  nextTranscription?: string;
  transcriptionToTranslateSpeaker: string;
  previousTranscriptionSpeaker?: string;
  nextTranscriptionSpeaker?: string;
  videoTitle?: string;
  transcriptionSummary?: string;
}

export interface GladiaRequestBody {
  /** Context to feed the transcription model with for possible better performance */
  context_prompt?: string;

  /** Enable diarization enhanced for this audio */
  diarization_enhanced?: boolean;

  /** Specific vocabulary list to feed the transcription model with */
  custom_vocabulary?: string[];

  /** Detect the language from the given audio */
  detect_language?: boolean;

  /** Detect multiple languages in the given audio */
  enable_code_switching?: boolean;

  /** Specify the configuration for code switching */
  code_switching_config?: {
    // Les détails spécifiques ne sont pas fournis
  };

  /** Set the spoken language for the given audio (ISO 639 standard) */
  language?: keyof typeof languageCodes;

  /** Enable punctuation enhanced for this audio */
  punctuation_enhanced?: boolean;

  /** Callback URL we will do a POST re uest to with the result of the transcription */
  callback_url?: string;

  /** Enable subtitles generation for this transcription */
  subtitles?: boolean;

  /** Configuration for subtitles generation if subtitles is enabled */
  subtitles_config?: {
    // Les détails spécifiques ne sont pas fournis
  };

  /** Enable speaker recognition (diarization) for this audio */
  diarization?: boolean;

  /** Speaker recognition configuration, if diarization is enabled */
  diarization_config?: {
    // Les détails spécifiques ne sont pas fournis
  };

  /** Enable translation for this audio */
  translation?: boolean;

  /** Translation configuration, if translation is enabled */
  translation_config?: {
    // Les détails spécifiques ne sont pas fournis
  };

  /** Enable summarization for this audio */
  summarization?: boolean;

  /** Summarization configuration, if summarization is enabled */
  summarization_config?: {
    // Les détails spécifiques ne sont pas fournis
  };

  /** Enable moderation for this audio */
  moderation?: boolean;

  /** Enable named entity recognition for this audio */
  named_entity_recognition?: boolean;

  /** Enable chapterization for this audio */
  chapterization?: boolean;

  /** Enable names consistency for this audio */
  name_consistency?: boolean;

  /** Enable custom spelling for this audio */
  custom_spelling?: boolean;

  /** Custom spelling configuration, if custom_spelling is enabled */
  custom_spelling_config?: {
    // Les détails spécifiques ne sont pas fournis
  };

  /** Enable structured data extraction for this audio */
  structured_data_extraction?: boolean;

  /** Structured data extraction configuration, if structured_data_extraction is enabled */
  structured_data_extraction_config?: {
    // Les détails spécifiques ne sont pas fournis
  };

  /** Enable sentiment analysis for this audio */
  sentiment_analysis?: boolean;

  /** Enable audio to llm processing for this audio */
  audio_to_llm?: boolean;

  /** Audio to llm configuration, if audio_to_llm is enabled */
  audio_to_llm_config?: {
    // Les détails spécifiques ne sont pas fournis
  };

  /** Custom metadata you can attach to this transcription */
  custom_metadata?: Record<string, any>;

  /** Enable sentences for this audio */
  sentences?: boolean;

  /** Allows to change the output display_mode for this audio. The output will be reordered, creating new utterances when speakers overlapped */
  display_mode?: boolean;

  /** URL to a Gladia file or to an external audio or video file */
  audio_url: string;
}

export type AllowedLanguages =
  | 'swedish'
  | 'korean'
  | 'ukrainian'
  | 'greek'
  | 'japanese'
  | 'english'
  | 'american english'
  | 'russian'
  | 'hindi'
  | 'german'
  | 'danish'
  | 'bulgarian'
  | 'czech'
  | 'polish'
  | 'slovak'
  | 'finnish'
  | 'spanish'
  | 'croatian'
  | 'dutch'
  | 'portuguese'
  | 'french'
  | 'malay'
  | 'italian'
  | 'romanian'
  | 'mandarin'
  | 'tamil'
  | 'turkish'
  | 'indonesian'
  | 'tagalog'
  | 'arabic'
  | 'estonian'
  | 'norwegian'
  | 'vietnamese'
  | 'hungarian'
  | 'british english'
  | 'french canadian';

export type AudioOriginalLangAllowed =
  | 'af'
  | 'sq'
  | 'am'
  | 'ar'
  | 'hy'
  | 'as'
  | 'ast'
  | 'az'
  | 'ba'
  | 'eu'
  | 'be'
  | 'bn'
  | 'bs'
  | 'br'
  | 'bg'
  | 'my'
  | 'ca'
  | 'ceb'
  | 'zh'
  | 'hr'
  | 'cs'
  | 'da'
  | 'nl'
  | 'en'
  | 'et'
  | 'at'
  | 'fo'
  | 'fi'
  | 'fr'
  | 'fy'
  | 'ff'
  | 'gd'
  | 'gl'
  | 'lg'
  | 'ka'
  | 'de'
  | 'el'
  | 'gu'
  | 'ht'
  | 'ha'
  | 'haw'
  | 'he'
  | 'hi'
  | 'hu'
  | 'is'
  | 'ig'
  | 'ilo'
  | 'id'
  | 'ga'
  | 'it'
  | 'ja'
  | 'jv'
  | 'kn'
  | 'kk'
  | 'km'
  | 'ko'
  | 'lo'
  | 'la'
  | 'lv'
  | 'lb'
  | 'ln'
  | 'lt'
  | 'mk'
  | 'mg'
  | 'ms'
  | 'ml'
  | 'mt'
  | 'mi'
  | 'mr'
  | 'mo'
  | 'mn'
  | 'ne'
  | 'no'
  | 'nn'
  | 'oc'
  | 'or'
  | 'pa'
  | 'ps'
  | 'fa'
  | 'pl'
  | 'pt'
  | 'ro'
  | 'ru'
  | 'sa'
  | 'sr'
  | 'sn'
  | 'sd'
  | 'si'
  | 'sk'
  | 'sl'
  | 'so'
  | 'es'
  | 'su'
  | 'sw'
  | 'ss'
  | 'sv'
  | 'tl'
  | 'tg'
  | 'ta'
  | 'tt'
  | 'te'
  | 'th'
  | 'bo'
  | 'tn'
  | 'tr'
  | 'tk'
  | 'uk'
  | 'ur'
  | 'uz'
  | 'vi'
  | 'cy'
  | 'wo'
  | 'xh'
  | 'yi'
  | 'yo'
  | 'zu';
