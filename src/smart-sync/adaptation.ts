import { models } from '../llm/openai';
import { requestToGPT } from '../llm/openai';
import { PromptBuilder } from '../llm/prompt-builder';
import type {
  AllowedLanguages,
  AudioOriginalLangAllowed,
  SegmentWitDurationAndOriginalSegment,
} from '../types';
import type {
  CreateLongerSpeechArguments,
  CreateShorterSpeechArguments,
  SpeechAdjusted,
  SpeechResponseWithDuration,
} from '../types/speech';
import { silenceBetweenSegmentConsideredAsPause } from '../utils/config';
import { AudioUtils } from '../ffmpeg/audio-utils';
import { SpeechGenerator } from '../speech/speechGenerator';
import { ElevenLabsService } from '../elevenlabs/elevenlabs';
import type { Readable } from 'form-data';
import fs from 'fs';
import crypto from 'crypto';
import fsPromises from 'fs/promises';

export class Adaptation {
  constructor() {
    //
  }

  static async compareAndAdjustSpeeches({
    transcriptions,
    speeches,
    clonedVoicesIds,
    originalLanguage,
    targetLanguage,
    transcriptionSummary,
  }: {
    transcriptions: SegmentWitDurationAndOriginalSegment[];
    speeches: SpeechResponseWithDuration[];
    clonedVoicesIds: { [key: string]: string };
    originalLanguage: AudioOriginalLangAllowed;
    targetLanguage: AllowedLanguages;
    transcriptionSummary: string;
  }): Promise<SpeechAdjusted[]> {
    console.debug('Comparing speeches, and adjusting length...');
    if (transcriptions.length !== speeches.length) {
      console.error('Array length mismatch');
      throw new Error('Array length mismatch');
    }

    const sortedSegments = transcriptions.sort((a, b) => a.index - b.index);

    const maxSpeedFactor = 1.15;

    const minSpeedFactor = 0.9;

    let previousTranscriptionText = '';

    try {
      const adjustments: SpeechAdjusted[] = [];

      for (let index = 0; index < sortedSegments.length; index++) {
        let isSpeechModifiedToBeLonger = false;
        const transcription = sortedSegments[index];
        const speech = speeches[index];
        let speechBuffer = speech.speech;

        let newSpeechDuration = speech.duration;

        let speedFactor = newSpeechDuration / transcription.duration;
        let adjustedSpeedFactor = speedFactor;
        let reformulationAttempts = 0;
        const clonedVoiceId = clonedVoicesIds[transcription.speaker];

        let transcriptionText = transcription.transcription;
        let nextTranscriptionText = '';

        //next transcription text
        if (index + 1 < sortedSegments.length) {
          const silenceBetweenNextTranscription = sortedSegments[index + 1].begin - transcription.end;

          //1 = 1 second
          if (
            silenceBetweenNextTranscription > silenceBetweenSegmentConsideredAsPause ||
            sortedSegments[index + 1].speaker !== transcription.speaker
          ) {
            nextTranscriptionText = '';
          } else {
            nextTranscriptionText = sortedSegments[index + 1].transcription;
          }
        }

        const activateSmartSync = true;
        const smartSyncMustBeTriggered =
          activateSmartSync && (speedFactor > maxSpeedFactor || speedFactor < minSpeedFactor);

        while (smartSyncMustBeTriggered && reformulationAttempts < 2) {
          if (speedFactor > maxSpeedFactor) {
            console.debug(`Too long (speedFactor: ${speedFactor}), reformulation needed`);

            const shorterSpeech = await this.createShorterSpeech({
              translatedTranscription: transcriptionText,
              originalTranscription: transcription.originalTranscription,
              speechIndex: transcription.index,
              speakerIndex: transcription.speaker,
              targetLanguage: targetLanguage,
              previousText: previousTranscriptionText,
              nextText: nextTranscriptionText,
              transcriptionDuration: transcription.duration,
              translatedSpeechDuration: newSpeechDuration,
              difference: (newSpeechDuration - transcription.duration).toFixed(2),
              transcriptionSummary,
              clonedVoiceId,
            });

            transcriptionText = shorterSpeech.reformulatedText as string;

            speechBuffer = shorterSpeech.speech;
            newSpeechDuration = shorterSpeech.duration;
          } else if (speedFactor < minSpeedFactor) {
            console.debug(`Too short (speedFactor: ${speedFactor}), reformulation needed`);
            const longerSpeech = await this.createLongerSpeech({
              translatedTranscription: transcriptionText,
              speechIndex: transcription.index,
              speakerIndex: transcription.speaker,
              targetLanguage: targetLanguage,
              originalLanguage: originalLanguage,
              transcriptionWords: transcription.wordsWithSilence,
              previousText: previousTranscriptionText,
              nextText: nextTranscriptionText,
              originalSegmentDuration: transcription.duration,
              translatedSpeechDuration: newSpeechDuration,
              difference: (transcription.duration - newSpeechDuration).toFixed(2),
              speedFactor: speedFactor,
              transcriptionSummary,
              clonedVoiceId,
            });

            transcriptionText = longerSpeech.longerText;

            speechBuffer = longerSpeech.speech;
            newSpeechDuration = longerSpeech.duration;
            isSpeechModifiedToBeLonger = true;
          }

          speedFactor = newSpeechDuration / transcription.duration;

          adjustedSpeedFactor = Math.min(Math.max(speedFactor, minSpeedFactor), maxSpeedFactor);
          reformulationAttempts++;

          console.debug(
            `Reformulation attempt ${reformulationAttempts}: adjustedSpeedFactor = ${adjustedSpeedFactor}`,
          );
        }

        previousTranscriptionText = transcriptionText;

        if (
          (speedFactor >= 0.8 && speedFactor <= 0.9 && !isSpeechModifiedToBeLonger) ||
          (speedFactor >= 1.1 && speedFactor <= 1.2 && !isSpeechModifiedToBeLonger)
        ) {
          const { newSpeechBuffer, newSpeechDuration } = await this.adjustSpeechSpeedWithElevenLabs({
            speedFactor,
            transcriptionText,
            voiceId: clonedVoiceId,
          });

          const newSpeedFactor = newSpeechDuration / transcription.duration;

          if (newSpeedFactor > 0.9 && newSpeedFactor < 1.1) {
            speechBuffer = newSpeechBuffer;
            speedFactor = newSpeedFactor;
          }
        }

        const adjustedSpeech = await this.adjustSpeechSpeed(speechBuffer, adjustedSpeedFactor);

        const newSpeechDurationAdjusted = await this.getSpeechDuration(adjustedSpeech);

        if (typeof newSpeechDurationAdjusted !== 'number')
          throw new Error(
            `Error during audio duration calculation in compareAndAdjustSpeeches: duration is not a number: ${newSpeechDurationAdjusted}`,
          );

        adjustments.push({
          speech: adjustedSpeech,
          transcriptionDuration: transcription.duration,
          end: transcription.end,
          begin: transcription.begin,
          speaker: transcription.speaker,
          speechDuration: newSpeechDurationAdjusted,
        });
      }

      return adjustments;
    } catch (err: unknown) {
      console.error(err);
      throw new Error('Error while adjusting speeches');
    }
  }

  static async adjustSpeechSpeed(speech: Buffer, speedFactor: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      if (speedFactor < 0.5 || speedFactor > 2.0) {
        console.error('Speed factor must be between 0.5 and 2.0');
        reject(new Error('Speed factor must be between 0.5 and 2.0'));
        return;
      }

      if (speedFactor === 1) {
        console.debug('speedFactor is 1');
        resolve(speech);
        return;
      }

      return AudioUtils.adjustSpeed(speech, speedFactor).then(resolve).catch(reject);
    });
  }

  static async getSpeechDuration(speech: Readable | Buffer): Promise<number | 'N/A'> {
    try {
      const duration = await AudioUtils.getAudioDurationFromBuffer(speech);
      return duration;
    } catch (err) {
      console.error('Speech duration error : ' + err);
      throw new Error('Error while getting speech duration');
    }
  }

  static async adjustSpeechSpeedWithElevenLabs({
    speedFactor,
    transcriptionText,
    voiceId,
  }: {
    speedFactor: number;
    transcriptionText: string;
    voiceId: string;
  }): Promise<{ newSpeechBuffer: Buffer; newSpeechDuration: number }> {
    const elevenLabsService = new ElevenLabsService();
    const elevenLabsResponse = await elevenLabsService.generateAudioFile({
      text: transcriptionText,
      voiceId: voiceId,
      speedFactor,
      modelId: 'eleven_multilingual_v2',
    });

    const buffer = elevenLabsResponse.response;
    const newSpeechDuration = await AudioUtils.getAudioDurationFromBuffer(buffer);

    if (typeof newSpeechDuration !== 'number')
      throw new Error(
        `Error during audio duration calculation in adjustSpeechSpeedWithElevenLabs: duration is not a number: ${newSpeechDuration}`,
      );

    return { newSpeechBuffer: buffer, newSpeechDuration };
  }

  static async createShorterSpeech({
    translatedTranscription,
    originalTranscription,
    speechIndex,
    speakerIndex,
    targetLanguage,
    previousText,
    nextText,
    transcriptionDuration,
    translatedSpeechDuration,
    difference,
    transcriptionSummary,
    clonedVoiceId,
  }: CreateShorterSpeechArguments) {
    const reformulatedTranscription = await this.getReformulatedTranscription({
      transcription: translatedTranscription,
      originalTranscription,
      targetLanguage,
      transcriptionDuration,
      translatedSpeechDuration,
      difference,
      transcriptionSummary,
    });

    const speechShortened = await SpeechGenerator.getSpeechFromTTSEngine({
      transcription: reformulatedTranscription as string,
      index: speechIndex,
      speakerIndex: speakerIndex,
      clonedVoiceId: clonedVoiceId,
      options: {
        previousTranscriptionText: previousText,
        nextTranscriptionText: nextText,
      },
      targetLanguage,
    });

    const speechBuffer =
      speechShortened.speech instanceof Response
        ? Buffer.from(await speechShortened.speech.arrayBuffer())
        : speechShortened.speech;

    const speechBufferWithoutSilence = await this.removeStartAndEndSilenceFromAudio(speechBuffer);

    const speechDuration = await this.getSpeechDuration(speechBufferWithoutSilence);

    if (typeof speechDuration !== 'number')
      throw new Error(
        `Error during audio duration calculation in createShorterSpeech: duration is not a number: ${speechDuration}`,
      );

    console.debug('Shorter speech created.');

    return {
      speech: speechBufferWithoutSilence,
      duration: speechDuration,
      reformulatedText: reformulatedTranscription,
      requestId: speechShortened.requestId,
    };
  }

  static async removeStartAndEndSilenceFromAudio(speech: Buffer): Promise<Buffer> {
    const temporaryInputFile = `temporary-files/input-for-trim-${crypto.randomUUID()}.wav`;
    const temporaryOutputFile = `temporary-files/output-for-trim-${crypto.randomUUID()}.wav`;

    try {
      await fsPromises.writeFile(temporaryInputFile, speech);

      try {
        await AudioUtils.removeStartAndEndSilenceFromAudioWithFFMPEG(temporaryInputFile, temporaryOutputFile);
      } catch (ffmpegError: any) {
        console.error('FFmpeg error during silence removal:', ffmpegError);

        if (!fs.existsSync(temporaryOutputFile)) {
          throw new Error(`FFmpeg failed to process audio: ${ffmpegError.message || 'Unknown error'}`);
        }

        console.debug('FFmpeg reported an error but output file exists, attempting to continue');
      }

      if (!fs.existsSync(temporaryOutputFile)) {
        throw new Error('Output file was not created during silence removal');
      }

      const stats = await fsPromises.stat(temporaryOutputFile);
      if (stats.size === 0) {
        throw new Error('Output file is empty after silence removal');
      }

      const bufferNewSpeech = await fsPromises.readFile(temporaryOutputFile);

      return bufferNewSpeech;
    } catch (err: any) {
      console.error('Error in removeStartAndEndSilenceFromAudio:', err);
      throw new Error(
        `ERROR while removing start and end silence from audio: ${err.message || 'Unknown error'}`,
      );
    } finally {
      try {
        if (fs.existsSync(temporaryInputFile)) await fsPromises.unlink(temporaryInputFile);
      } catch (unlinkError) {
        console.error('Error deleting temporary input file:', unlinkError);
      }

      try {
        if (fs.existsSync(temporaryOutputFile)) await fsPromises.unlink(temporaryOutputFile);
      } catch (unlinkError) {
        console.error('Error deleting temporary output file:', unlinkError);
      }
    }
  }

  static async requestUpdatedTextToAi({ prompt, instruction }: { prompt: string; instruction: string }) {
    try {
      const response = await requestToGPT({
        prompt,
        maxTokens: 8000,
        temperature: 0.5,
        instructions: instruction,
        responseFormat: 'text',
        model: models.o3Mini,
      });

      return response;
    } catch (error) {
      console.error('Error requesting updated text to AI with fallback (1) :', error);

      throw new Error('Error requesting updated text to AI with fallback (1)');
    }
  }

  static async getReformulatedTranscription({
    transcription,
    originalTranscription,
    targetLanguage,
    transcriptionDuration,
    translatedSpeechDuration,
    difference,
    transcriptionSummary,
  }: {
    transcription: string;
    originalTranscription: string;
    targetLanguage: string;
    transcriptionDuration: number;
    translatedSpeechDuration: number;
    difference: string;
    transcriptionSummary: string;
  }) {
    const params = {
      transcriptionToReformulate: transcription,
      originalTranscription: originalTranscription,
      targetLanguage: targetLanguage,
      transcriptionDuration: transcriptionDuration,
      translatedSpeechDuration: translatedSpeechDuration,
      difference: difference,
      transcriptionSummary: transcriptionSummary,
    };

    const promptForLLM = await PromptBuilder.createPromptForReformulatedTranscription(params);

    const instruction = PromptBuilder.instructionForReformulatedTranscription;

    const LLMResponse = await this.requestUpdatedTextToAi({
      prompt: promptForLLM,
      instruction,
    });

    return LLMResponse;
  }

  static async getLongerText({
    speedFactor,
    difference,
    targetLanguage,
    originalLanguage,
    translatedTranscription,
    transcriptionWords,
    originalSegmentDuration,
    translatedSpeechDuration,
    transcriptionSummary,
  }: {
    speedFactor: number;
    difference: string;
    targetLanguage: string;
    originalLanguage: string;
    translatedTranscription: string;
    transcriptionWords: string;
    originalSegmentDuration: number;
    translatedSpeechDuration: number;
    transcriptionSummary: string;
  }) {
    const isSpeechForElevenLabs = true;
    const isAiAllowedToRewrite = speedFactor < 0.75 || Number(difference) > 2;

    const prompt = PromptBuilder.createPromptForHandlingToShortSpeech({
      targetLanguage: targetLanguage,
      orignalLanguage: originalLanguage,
      transcriptionTranslated: translatedTranscription,
      wordsWithSilences: transcriptionWords,
      originalSegmentDuration,
      translatedSpeechDuration: translatedSpeechDuration.toFixed(2),
      difference,
      isSpeechForElevenLabs,
      allowRewrite: isAiAllowedToRewrite,
      transcriptionSummary,
    });

    const instruction = PromptBuilder.instructionForHandlingToShortSpeech;

    const translatedTextWithSilence = await this.requestUpdatedTextToAi({
      prompt,
      instruction,
    });

    return translatedTextWithSilence;
  }

  static async createLongerSpeech({
    translatedTranscription,
    speechIndex,
    speakerIndex,
    targetLanguage,
    originalLanguage,
    transcriptionWords,
    nextText,
    previousText,
    originalSegmentDuration,
    translatedSpeechDuration,
    difference,
    speedFactor,
    transcriptionSummary,
    clonedVoiceId,
  }: CreateLongerSpeechArguments): Promise<{
    speech: Buffer;
    duration: number;
    requestId: string;
    longerText: string;
  }> {
    const translatedTextWithSilence = await this.getLongerText({
      speedFactor,
      difference,
      targetLanguage,
      originalLanguage,
      translatedTranscription,
      transcriptionWords,
      originalSegmentDuration,
      translatedSpeechDuration,
      transcriptionSummary,
    });

    const longerSpeech = await SpeechGenerator.getSpeechFromTTSEngine({
      transcription: translatedTextWithSilence as string,
      index: speechIndex,
      speakerIndex: speakerIndex,
      clonedVoiceId,
      options: {
        previousTranscriptionText: previousText,
        nextTranscriptionText: nextText,
      },
      targetLanguage,
    });

    const speechBuffer =
      longerSpeech.speech instanceof Response
        ? Buffer.from(await longerSpeech.speech.arrayBuffer())
        : longerSpeech.speech;

    const speechBufferWithoutSilence = await this.removeStartAndEndSilenceFromAudio(speechBuffer);

    const speechDuration = await this.getSpeechDuration(speechBufferWithoutSilence);

    if (typeof speechDuration !== 'number')
      throw new Error(
        `Error during audio duration calculation in translation service: duration is not a number: ${speechDuration}`,
      );

    return {
      speech: speechBufferWithoutSilence,
      duration: speechDuration,
      requestId: longerSpeech.requestId,
      longerText: translatedTextWithSilence,
    };
  }
}
