import type {
  AllowedLanguages,
  AudioOriginalLangAllowed,
  GladiaResponse,
  Result,
  SegmentDetail,
  SegmentDetailOut,
  SegmentDetailOutWithDuration,
  Sentence,
  Utterance,
  Word,
} from '../types/index';
import { maxCharactersPerSegmentForNonLatinScriptLanguages, threshold } from '../utils/config';
import { maxCharactersPerSegment } from '../utils/config';
import { languageCodes, nonLatinScriptLanguages } from '../utils/constants';

export class Formatter {
  static formatTranscription(transcription: GladiaResponse, detectedLanguage: AudioOriginalLangAllowed) {
    const initialFormattedTranscription = this.getDetailsAndFormatTranscription(
      transcription.result,
      detectedLanguage,
    );

    const mergedSegments = this.mergeSegments(initialFormattedTranscription, threshold);

    const finalTranscription = this.addDurationForEachTranscription(mergedSegments);

    return finalTranscription;
  }

  static getDetailsAndFormatTranscription(
    transcriptionsData: Result,
    detectedLanguage: AudioOriginalLangAllowed,
  ) {
    const gladiaUtterances = (dataTranscriptionGladia: Result) => {
      return dataTranscriptionGladia?.transcription?.utterances;
    };

    let formattedUtterances: {
      transcription: string;
      begin: number;
      end: number;
      wordsWithSilence: string;
      speaker: number;
      channel: number;
      confidence: number;
      language: string;
    }[] = [];

    const splittedUtterances = this.splitTooLongUtterances(
      gladiaUtterances(transcriptionsData) as Utterance[],
    );

    formattedUtterances = splittedUtterances.map((part) => ({
      transcription: part.text,
      begin: Number(part.start.toFixed(3)),
      end: Number(part.end.toFixed(3)),
      wordsWithSilence: this.addTimesInText(part.words),
      speaker: part?.speaker || 0,
      channel: part?.channel || 0,
      confidence: part.confidence,
      language: detectedLanguage,
    }));

    return formattedUtterances;
  }

  static splitTooLongUtterances(transcriptions: Utterance[]) {
    const maxCharactersPerSegment = 500;
    const adjustedTranscription: Utterance[] = [];

    transcriptions.forEach((transcription) => {
      if (transcription.text.length > maxCharactersPerSegment) {
        const splittedTranscription = this.splitSegment(transcription) as Utterance[];
        adjustedTranscription.push(...splittedTranscription);
      } else {
        adjustedTranscription.push(transcription);
      }
    });

    return adjustedTranscription;
  }

  static splitSegment(obj: Sentence | Utterance, maxSentenceLength: number = 500): Sentence[] | Utterance[] {
    const words = obj.words;
    const chunks: (Sentence | Utterance)[] = [];

    let currentChunkWords: Word[] = [];
    let currentSentenceLength = 0;

    const isSentence = 'sentence' in obj;
    const textKey = isSentence ? 'sentence' : 'text';

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const wordLength = word.word.length;

      if (currentSentenceLength + wordLength > maxSentenceLength && currentChunkWords.length > 0) {
        const sentence = currentChunkWords.map((w) => w.word).join('');
        const start = currentChunkWords[0].start;
        const end = currentChunkWords[currentChunkWords.length - 1].end;
        const confidence =
          currentChunkWords.reduce((sum, w) => sum + w.confidence, 0) / currentChunkWords.length;

        const newSegment = {
          words: currentChunkWords,
          language: obj.language,
          start: start,
          end: end,
          speaker: obj?.speaker || 0,
          confidence: confidence,
          channel: obj?.channel || 0,
          [textKey]: sentence,
        };

        //@ts-ignore
        chunks.push(newSegment as Sentence | Utterance);

        currentChunkWords = [];
        currentSentenceLength = 0;
      }

      currentChunkWords.push(word);
      currentSentenceLength += wordLength;
    }

    if (currentChunkWords.length > 0) {
      const sentence = currentChunkWords.map((w) => w.word).join('');
      const start = currentChunkWords[0].start;
      const end = currentChunkWords[currentChunkWords.length - 1].end;
      const confidence =
        currentChunkWords.reduce((sum, w) => sum + w.confidence, 0) / currentChunkWords.length;

      const newSegment = {
        words: currentChunkWords,
        language: obj.language,
        start: start,
        end: end,
        speaker: obj?.speaker || 0,
        confidence: confidence,
        channel: obj?.channel || 0,
        [textKey]: sentence,
      };

      //@ts-ignore
      chunks.push(newSegment as Sentence | Utterance);
    }

    return chunks as Sentence[] | Utterance[];
  }

  private static addTimesInText(words: Word[]) {
    let enhancedText = '';

    words.forEach((word, index) => {
      const timeBetweenNextWord =
        index !== words.length - 1 ? (words[index + 1].start - word.end).toString() : '';

      enhancedText += word.word.trim() + (timeBetweenNextWord ? `<${timeBetweenNextWord.slice(0, 5)}s>` : '');
    });

    return enhancedText;
  }

  static mergeSegments(segments: SegmentDetail[], timeThreshold: number): SegmentDetailOut[] {
    console.debug('Merging segments...');
    const mergedSegments = this.mergeUnderCondition(segments, timeThreshold);

    return mergedSegments;
  }

  static getMaxCharactersPerSegment(language: string): number {
    const languageCode = languageCodes[language as keyof typeof languageCodes]?.toLowerCase();
    return nonLatinScriptLanguages.includes(languageCode as AllowedLanguages)
      ? maxCharactersPerSegmentForNonLatinScriptLanguages
      : maxCharactersPerSegment;
  }

  static mergeUnderCondition(segments: SegmentDetail[], timeThreshold: number) {
    //If one the transcription part is longer that 4000 characters, we try again we a smaller timeThreshold

    const getMergedTranscription = () => {
      const mergedSegments: SegmentDetailOut[] = [];
      let currentSegment = segments[0];
      let mergedPartIndex = 0;

      if (segments.length === 0) throw new Error('No transcription found in the response.');

      for (let i = 1; i < segments.length; i++) {
        const nextSegment = segments[i];
        const maxCharactersPerSegment = this.getMaxCharactersPerSegment(nextSegment.language);

        // Check if the start of the next segment is close to the end of the current segment
        const difference = nextSegment.begin - currentSegment.end;

        if (
          difference <= timeThreshold &&
          currentSegment.speaker === nextSegment.speaker &&
          currentSegment.transcription.length + nextSegment.transcription.length < maxCharactersPerSegment
        ) {
          // Merge segments if close enough
          currentSegment = {
            ...currentSegment,
            transcription: currentSegment.transcription + ' ' + nextSegment.transcription,
            end: nextSegment.end,
            //*To get words with low confidence, simply add low confidence words in an array
            wordsWithSilence: currentSegment.wordsWithSilence.concat(nextSegment.wordsWithSilence),
          };
        } else {
          // Adds the current transcript to the board and moves to the next
          mergedSegments.push({
            ...currentSegment,
            index: mergedPartIndex,
          });
          currentSegment = nextSegment;
          mergedPartIndex++;
        }
      }

      mergedSegments.push({
        ...currentSegment,
        index: mergedPartIndex,
      });

      return mergedSegments;
    };

    const finalMergedTranscriptions = getMergedTranscription();

    const isEverySegmentsLessThan4000 = finalMergedTranscriptions.every(
      (transcription) => transcription.transcription.length < 4000,
    );
    if (!isEverySegmentsLessThan4000) {
      console.error('Error while merging transcriptions: One of the transcription is too long (>4000)');
      //Throw an error if the transcription is too long
      throw new Error('One of the transcription is too long (>4000)');
    } else {
      return finalMergedTranscriptions;
    }
  }

  static addDurationForEachTranscription(transcription: SegmentDetail[]): SegmentDetailOutWithDuration[] {
    return transcription.map((part, index) => {
      const duration = part.end - part.begin;
      return {
        ...part,
        duration: Number(duration.toFixed(3)),
        index,
      };
    });
  }
}
