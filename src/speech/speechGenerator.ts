import type { PreviousRequestIdsEL } from '../elevenlabs/elevenlabs';
import type { AllowedLanguages, SegmentWitDurationAndOriginalSegment } from '../types';
import type { SpeechAdjusted, SpeechResponseWithDuration, SpeechResponseWithIndex } from '../types/speech';
import { maxSimultaneousFetchElevenLabs, silenceBetweenSegmentConsideredAsPause } from '../utils/config';
import { ElevenLabsService } from '../elevenlabs/elevenlabs';
import { AudioUtils } from '../ffmpeg/audio-utils';
import crypto from 'crypto';
import fs from 'fs';
import fsPromises from 'fs/promises';
import { Helpers } from '../utils/helpers';
import { VideoUtils } from '../ffmpeg/video-utils';
import type { Readable } from 'stream';
import * as path from 'path';

export class SpeechGenerator {
  constructor() {
    //
  }

  static async getSpeechArrayFromTranscriptions({
    segments,
    targetLanguage,
    isolatedVocalsPath,
  }: {
    segments: SegmentWitDurationAndOriginalSegment[];
    isolatedVocalsPath: string;
    targetLanguage: AllowedLanguages;
  }): Promise<{
    allResultsSorted: SpeechResponseWithIndex[];
    clonedVoicesIds: { [key: string]: string };
  }> {
    console.debug('Getting speeches...');
    const maxSimultaneousFetch = maxSimultaneousFetchElevenLabs;

    let allResults: SpeechResponseWithIndex[] = [];
    const clonedVoicesIds: {
      //speakerIndex/number: clonedVoiceId
      [key: string]: string;
    } = {};

    const speakers = this.getNumberSpeakers(segments);
    for (const speaker of speakers) {
      clonedVoicesIds[speaker] = await this.cloneVideoVoice(isolatedVocalsPath, segments, speaker);
    }

    try {
      //Voice cloning or custom Voice return only an Array of one Item
      const processTranscriptionBatch = async ({
        batch,
        previousTranscriptionText,
        nextTranscriptionText,
        targetLanguage,
      }: {
        batch: SegmentWitDurationAndOriginalSegment[];
        previousTranscriptionText: string | '';
        nextTranscriptionText: string | '';
        previousRequestIds: PreviousRequestIdsEL;
        targetLanguage: AllowedLanguages;
      }) => {
        const promises = batch.map((transcription) =>
          this.getSpeechFromTTSEngine({
            transcription: transcription.transcription,
            index: transcription.index,
            speakerIndex: transcription.speaker,
            clonedVoiceId: clonedVoicesIds[transcription.speaker],
            options: {
              previousTranscriptionText,
              nextTranscriptionText,
            },
            targetLanguage,
          }),
        );

        return await Promise.all(promises);
      };

      const pastSpeechIds: PreviousRequestIdsEL = [];
      for (let i = 0; i < segments.length; i += maxSimultaneousFetch) {
        const batchEndIndex = i + maxSimultaneousFetch;
        const nextTranscriptionData = segments[i + 1];
        const transcriptionBatch = segments.slice(i, batchEndIndex);
        const previousTranscriptionText = i === 0 ? '' : segments[i - 1]?.transcription;
        let nextTranscriptionText = '';

        if (batchEndIndex < segments.length) {
          const silenceBetweenNextTranscription = nextTranscriptionData?.begin - segments[i].end;

          if (
            nextTranscriptionData?.speaker !== segments[i].speaker ||
            silenceBetweenNextTranscription > silenceBetweenSegmentConsideredAsPause
          ) {
            nextTranscriptionText = '';
          } else {
            nextTranscriptionText = nextTranscriptionData.transcription;
          }
        }

        const batchResults = await processTranscriptionBatch({
          batch: transcriptionBatch,
          previousTranscriptionText: previousTranscriptionText,
          nextTranscriptionText: nextTranscriptionText,
          previousRequestIds: pastSpeechIds || '',
          targetLanguage,
        });

        if (pastSpeechIds.length === 3) pastSpeechIds.shift();
        pastSpeechIds.push(batchResults[0].requestId);

        allResults = allResults.concat(batchResults);
      }
      console.debug('Speeches got.');
      const allResultsSorted = allResults.sort((a, b) => a.index - b.index);

      return {
        allResultsSorted,
        clonedVoicesIds,
      };
    } catch (err: unknown) {
      console.error(err);
      if (err instanceof Error) {
        throw err;
      }
      throw new Error('Error while getting speeches');
    }
  }

  static async cloneVideoVoice(
    vocalsAudioPath: string,
    segments: SegmentWitDurationAndOriginalSegment[],
    speakerIndex: number,
  ) {
    console.debug('Cloning video voice...');
    function combineBuffers(buffers: Buffer[]): Buffer {
      const totalLength = buffers.reduce((sum, buffer) => sum + buffer.length, 0);

      const combinedBuffer = Buffer.alloc(totalLength);

      let offset = 0;
      for (const buffer of buffers) {
        buffer.copy(combinedBuffer, offset);
        offset += buffer.length;
      }

      return combinedBuffer;
    }

    const filePath = `temporary-files/audioFromOneSpeaker-${crypto.randomUUID()}.mp3`;

    try {
      let audioFromOneSpeakerBuffer = await this.getAudiosSpeakerAndMerge(
        segments,
        speakerIndex,
        vocalsAudioPath,
      );

      fs.writeFileSync(filePath, combineBuffers(audioFromOneSpeakerBuffer));
      console.debug('getting file duration for function cloneVideoVoice');
      const audioDuration = await VideoUtils.getFileDuration(filePath);

      if (typeof audioDuration !== 'number')
        throw new Error(
          `Error during audio duration when cloning video voice: duration is not a number: ${audioDuration}`,
        );

      if (audioDuration < 90) {
        const resultPath = await AudioUtils.duplicateAndConcatenateAudio(filePath, 3, 'mp3');

        audioFromOneSpeakerBuffer = await Helpers.splitAudioIntoBuffers(resultPath);

        if (fs.existsSync(resultPath)) await fsPromises.unlink(resultPath);
      }

      const elevenLabsService = new ElevenLabsService();
      const response = await elevenLabsService.cloneVoice(
        audioFromOneSpeakerBuffer,
        'speaker-' + speakerIndex,
        audioDuration,
      );

      return response.voice_id;
    } catch (err) {
      console.error(err);
      if (err instanceof Error) {
        throw err;
      }
      throw new Error('Error while cloning video voice');
    } finally {
      if (fs.existsSync(filePath)) await fsPromises.unlink(filePath);
    }
  }

  static async getSpeechFromTTSEngine({
    transcription,
    index,
    speakerIndex,
    options,
    targetLanguage,
    clonedVoiceId,
  }: {
    transcription: string;
    index: number;
    speakerIndex: number;
    clonedVoiceId: string;
    options?: {
      previousTranscriptionText: string | '';
      nextTranscriptionText: string | '';
    };
    targetLanguage: AllowedLanguages;
  }): Promise<SpeechResponseWithIndex> {
    const elevenLabsService = new ElevenLabsService();

    const createSpeechWithVoiceCloning = async () => {
      try {
        return await elevenLabsService.generateAudioFile({
          text: transcription,
          modelId: 'eleven_multilingual_v2',
          voiceId: clonedVoiceId,
          previousText: options?.previousTranscriptionText,
          targetLanguage: targetLanguage,
          nextText: options?.nextTranscriptionText,
        });
      } catch (err) {
        console.error(err);
        if (err instanceof Error) {
          throw err;
        }

        throw new Error('Error while getting speech with ElevenLabs');
      }
    };

    const response = await createSpeechWithVoiceCloning();

    return {
      index: index,
      speech: response.response,
      speaker: speakerIndex,
      requestId: response?.requestId,
    };
  }

  static async getAudiosSpeakerAndMerge(
    segments: SegmentWitDurationAndOriginalSegment[],
    speakerIndex: number,
    vocalsAudioPath: string,
  ): Promise<Buffer[]> {
    console.debug('Getting audios from one speaker...');
    const uuid = crypto.randomUUID();
    const finalAudioPath = `temporary-files/finalAudioPathFromSpeaker-${uuid}.mp3`;
    const audioPartsPathFromSpeaker: string[] = [];

    try {
      const segmentsFromThisSpeaker = segments.filter((segment) => segment.speaker === speakerIndex);

      for (const segmentWithDuration of segmentsFromThisSpeaker) {
        try {
          const singleVocalSpeakerPath = await AudioUtils.cutAudioToBufferAtSpecificTime(
            vocalsAudioPath,
            segmentWithDuration.begin - 0.2,
            segmentWithDuration.end + 0.2,
            false,
          );

          if (typeof singleVocalSpeakerPath === 'string') {
            audioPartsPathFromSpeaker.push(singleVocalSpeakerPath);
          } else {
            throw new Error('singleVocalSpeakerPath is not type string');
          }
        } catch (error) {
          // Nettoyer les fichiers déjà créés en cas d'erreur
          audioPartsPathFromSpeaker.forEach(async (path) => {
            if (fs.existsSync(path)) await fsPromises.unlink(path);
          });
          throw error;
        }
      }

      await AudioUtils.concatenateAudio({
        files: audioPartsPathFromSpeaker,
        outputPath: finalAudioPath,
        outputFormat: 'mp3',
      });

      if (await this.isFileSizeMoreThan10MB(finalAudioPath)) {
        return await Helpers.splitAudioIntoBuffers(finalAudioPath);
      } else {
        const bufferFile = await fsPromises.readFile(finalAudioPath);
        return [bufferFile];
      }
    } catch (error) {
      console.error(error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Error while getting audio from one speaker.');
    } finally {
      if (fs.existsSync(finalAudioPath)) {
        try {
          await fsPromises.unlink(finalAudioPath);
        } catch (e) {
          console.error('Error cleaning up finalAudioPath:', e);
        }
      }

      audioPartsPathFromSpeaker.forEach(async (path) => {
        if (fs.existsSync(path)) {
          try {
            await fsPromises.unlink(path);
          } catch (e) {
            console.error(`Error cleaning up temp file ${path}:`, e);
          }
        }
      });
    }
  }

  static getNumberSpeakers(segments: SegmentWitDurationAndOriginalSegment[]) {
    const speakerArray = segments.map((segment) => segment.speaker);
    return Array.from(new Set(speakerArray));
  }

  static async isFileSizeMoreThan10MB(filePath: string): Promise<boolean> {
    try {
      const stats = await fsPromises.stat(filePath);
      const fileSizeInBytes = stats.size;
      const fileSizeInMegabytes = fileSizeInBytes / (1024 * 1024);
      return fileSizeInMegabytes > 10;
    } catch (error) {
      console.error('Erreur lors de la vérification de la taille du fichier:', error);
      throw error;
    }
  }

  static async getEachSpeechDuration({
    speechArray,
    transcriptions,
  }: {
    speechArray: SpeechResponseWithIndex[];
    transcriptions: SegmentWitDurationAndOriginalSegment[];
  }): Promise<SpeechResponseWithDuration[]> {
    console.debug('Getting speeches duration...');
    try {
      const speechArraySorted = speechArray.sort((a, b) => a.index - b.index);

      const arraySpeechWithDuration: SpeechResponseWithDuration[] = [];

      for (let i = 0; i < speechArraySorted.length; i++) {
        const speech = speechArraySorted[i];
        // Convertir en Buffer si c'est une Response
        const audioBuffer =
          speech.speech instanceof Response ? Buffer.from(await speech.speech.arrayBuffer()) : speech.speech;

        console.debug(`Getting initial speech duration for index ${i}`);

        const duration = await this.getSpeechDuration(audioBuffer);

        if (typeof duration !== 'number') {
          transcriptions.filter((transcription) => transcription.index !== speech.index);
          continue;
        }

        arraySpeechWithDuration.push({
          speech: audioBuffer,
          duration,
          speechIndex: i,
          speaker: speech.speaker,
          requestId: speech.requestId,
        });
      }

      console.debug('All Speeches duration got.');
      return arraySpeechWithDuration.sort((a, b) => a.speechIndex - b.speechIndex);
    } catch (err: unknown) {
      console.error(err);
      throw new Error('Error while getting speeches duration');
    }
  }

  static async getSpeechDuration(speech: Readable | Buffer): Promise<number | 'N/A'> {
    try {
      return await AudioUtils.getAudioDurationFromBuffer(speech);
    } catch (err) {
      console.error('Speech duration error : ' + err);
      throw new Error('Error while getting speech duration');
    }
  }

  static async removeStartAndEndSilenceFromAllAudio(arraySpeeches: SpeechResponseWithDuration[]) {
    const results = [];

    for (const speech of arraySpeeches) {
      try {
        let retries = 0;
        const maxRetries = 3;
        let newSpeechBuffer: Buffer = speech.speech;
        let success = false;

        while (!success && retries < maxRetries) {
          try {
            const processedBuffer = await this.removeStartAndEndSilenceFromAudio(speech.speech);
            newSpeechBuffer = processedBuffer;
            success = true;
          } catch (error: any) {
            retries++;
            throw error;
          }
        }

        const newSpeechDuration = await this.getSpeechDuration(newSpeechBuffer);

        if (typeof newSpeechDuration !== 'number') {
          console.warn(
            `Speech duration calculation failed for speech index ${speech.speechIndex}, using original duration`,
          );
          results.push({
            speech: speech.speech, // Use original speech buffer
            duration: speech.duration, // Use original duration
            speechIndex: speech.speechIndex,
            speaker: speech.speaker,
            requestId: speech.requestId,
          });
          continue;
        }

        results.push({
          speech: newSpeechBuffer,
          duration: newSpeechDuration,
          speechIndex: speech.speechIndex,
          speaker: speech.speaker,
          requestId: speech.requestId,
        });
      } catch (error) {
        console.error(`Error processing speech at index ${speech.speechIndex}:`, error);

        // Instead of failing the entire batch, keep the original speech
        results.push({
          speech: speech.speech, // Use original speech buffer
          duration: speech.duration, // Use original duration
          speechIndex: speech.speechIndex,
          speaker: speech.speaker,
          requestId: speech.requestId,
        });
      }
    }

    return results;
  }

  static async removeStartAndEndSilenceFromAudio(speech: Buffer): Promise<Buffer> {
    console.debug('Removing start and end silence from audio...');
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

      console.debug('Start and end silence removed from audio.');
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

  static async createAndAssembleSeparateAudioTracksEachSpeaker(clips: SpeechAdjusted[]): Promise<string> {
    const numberOfSpeakers = [...new Set(clips.map((clip) => clip.speaker))];

    if (numberOfSpeakers.length === 1) {
      console.debug('starting assemble audio for one speaker');
      const audioFrequency = 44100;
      const outputPath = await this.assembleAudio(clips, audioFrequency);
      console.debug('assemble audio for one speaker done');
      return outputPath;
    }

    console.debug(`starting overlaying audio for ${numberOfSpeakers.length} speakers`);
    const timelineForEachSpeaker: string[] = [];

    for (const speaker of numberOfSpeakers) {
      console.debug(`starting assemble audio for speaker ${speaker}`);
      const speakerClips = clips.filter((clip) => clip.speaker === speaker);
      timelineForEachSpeaker.push(await this.assembleAudio(speakerClips, 44100));
    }

    console.debug('assembling audio for all speakers done');

    const outputPath = `temporary-files/${crypto.randomUUID()}-result-of-overlaying.wav`;

    await AudioUtils.overlayingAudio(outputPath, timelineForEachSpeaker);

    return outputPath;
  }

  static async assembleAudio(clips: SpeechAdjusted[], audioFrequency: number) {
    console.debug('Assembling audio...');
    let previousEnd = 0;
    const tempFiles: string[] = [];

    try {
      for (const clip of clips) {
        if (clip.begin > previousEnd && parseFloat((clip.begin - previousEnd).toFixed(4)) > 0.001) {
          const silenceDuration = (clip.begin - previousEnd).toFixed(4);
          const silenceDurationFormatted = parseFloat(silenceDuration);
          const silenceFile = await AudioUtils.generateSilence(silenceDurationFormatted, audioFrequency);
          tempFiles.push(silenceFile);
        }

        if (clip.speech) {
          const audioFilePath = `temporary-files/${crypto.randomUUID()}-audio.wav`;
          await fsPromises.writeFile(audioFilePath, clip.speech);
          tempFiles.push(audioFilePath);
        }

        previousEnd = clip.begin + clip.speechDuration;
      }

      const outputPath = `temporary-files/${crypto.randomUUID()}-for-assemble-audio.wav`;

      const concatenatedAudioPath = await AudioUtils.concatenateAudio({
        files: tempFiles,
        outputPath,
        outputFormat: 'wav',
      });

      return concatenatedAudioPath;
    } catch (err: unknown) {
      console.error(err);
      throw new Error('Error while assembling audio');
    }
  }

  static async overlayAudioAndBackgroundMusic(
    voicesAudioPath: string,
    backgroundMusicPath: string,
  ): Promise<string> {
    console.debug('Merging audio and background music...');
    try {
      const outputPath = path.join(`output/result-${crypto.randomUUID()}.wav`);

      //!Do not delete this line for the moment
      //await this.ffmpegService.amplifyAudio(backgroundMusicPath, 1.5);

      return await AudioUtils.mergeAudioFiles(voicesAudioPath, backgroundMusicPath, outputPath);
    } catch (err) {
      console.error(err);
      throw new Error('Error while merging audio and background music');
    } finally {
      if (fs.existsSync(voicesAudioPath)) await fsPromises.unlink(voicesAudioPath);
    }
  }
}
