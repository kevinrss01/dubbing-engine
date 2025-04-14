import * as fs from 'fs';
import * as path from 'path';
import { allowedExtensions, audioExtensions, videoExtensions } from './constants';
import type { SegmentWitDurationAndOriginalSegment } from '../types';
import { VideoUtils } from '../ffmpeg/video-utils';
import fsPromises from 'fs/promises';

export class Helpers {
  static async verifyPrerequisitesForDubbing() {
    console.debug('Verifying prerequisites for dubbing...');
    const inputDir = path.join(process.cwd(), 'input');
    let foundInputFile = false;

    try {
      const files = await fs.promises.readdir(inputDir);
      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (allowedExtensions.includes(ext)) {
          foundInputFile = true;
          break;
        }
      }
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new Error("Input directory 'input' not found at the project root.");
      }
      throw new Error(`Error reading input directory: ${error.message}`);
    }

    if (!foundInputFile) {
      throw new Error(
        `No valid video or audio file found in the 'input' directory. Allowed extensions: ${allowedExtensions.join(
          ', ',
        )}`,
      );
    }

    const numberOfSpeakers = process.env.NUM_SPEAKERS;
    const applyLipsync = process.env.APPLY_LIPSYNC;
    const targetLanguage = process.env.TARGET_LANGUAGE;
    const syncLabApiKey = process.env.SYNC_LAB_API_KEY;

    if (!numberOfSpeakers) {
      throw new Error('Environment variable NUMBER_OF_SPEAKERS is missing or not a valid number.');
    }

    if (applyLipsync !== 'yes' && applyLipsync !== 'no') {
      throw new Error("Environment variable APPLY_LIPSYNC must be either 'yes' or 'no'.");
    }

    if (!targetLanguage) {
      throw new Error('Environment variable TARGET_LANGUAGE is missing.');
    }

    if (applyLipsync === 'yes' && !syncLabApiKey) {
      throw new Error('Environment variable SYNC_LAB_API_KEY is required when APPLY_LIPSYNC is true.');
    }

    console.debug('Prerequisites verified successfully.');
  }

  static async getInputFilePath(): Promise<string> {
    const inputDir = path.join(process.cwd(), 'input');

    try {
      const files = await fs.promises.readdir(inputDir);

      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (allowedExtensions.includes(ext)) {
          return path.join(inputDir, file);
        }
      }

      throw new Error(
        `No valid media file found in the input directory. Allowed extensions: ${allowedExtensions.join(', ')}`,
      );
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new Error("Input directory 'input' not found at the project root.");
      }
      throw error;
    }
  }

  static async getAllInputFilePaths(): Promise<string> {
    console.debug('Getting all input file paths...');
    const inputDir = path.join(process.cwd(), 'input');

    try {
      const files = await fs.promises.readdir(inputDir);

      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (allowedExtensions.includes(ext)) {
          return path.join(inputDir, file);
        }
      }

      throw new Error(
        `No valid media file found in the input directory. Allowed extensions: ${allowedExtensions.join(', ')}`,
      );
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new Error("Input directory 'input' not found at the project root.");
      }
      throw error;
    }
  }

  static getFileType(filePath: string): 'audio' | 'video' | null {
    const ext = path.extname(filePath).toLowerCase();

    if (audioExtensions.includes(ext)) {
      return 'audio';
    } else if (videoExtensions.includes(ext)) {
      return 'video';
    } else {
      throw new Error(`Unsupported file type: ${ext}`);
    }
  }

  static parseAndVerifyTranscriptionDetails(
    transcriptionDetails: string,
  ): SegmentWitDurationAndOriginalSegment[] {
    try {
      let parsedTranscriptions =
        typeof transcriptionDetails === 'string'
          ? (JSON.parse(transcriptionDetails) as SegmentWitDurationAndOriginalSegment[])
          : (transcriptionDetails as SegmentWitDurationAndOriginalSegment[]);

      parsedTranscriptions = parsedTranscriptions.map((partTranscription) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { wordsWithSilence, ...rest } = partTranscription;
        const segment = rest;
        if (!partTranscription.channel) {
          partTranscription.channel = 0;
        }

        const isEveryValueCorrect = Object.values(segment).every(
          (value) => value !== '' && value !== null && value !== undefined,
        );

        if (!isEveryValueCorrect) {
          throw new Error('Invalid transcription details, one or more values are incorrect or empty');
        }

        return partTranscription;
      });

      console.debug('Transcription details parsed.');
      return parsedTranscriptions;
    } catch (err: any) {
      console.error(err);
      throw new Error('Error while parsing transcription: ' + err);
    }
  }

  static async getVideoLength(filePath: string) {
    if (!filePath) throw new Error('File path is required');

    const duration = await VideoUtils.getFileDuration(filePath);
    if (typeof duration !== 'number')
      throw new Error(
        `Error during audio duration calculation in translation service: duration is not a number: ${duration}`,
      );

    return Math.round(duration / 60);
  }

  static async splitAudioIntoBuffers(filePath: string): Promise<Buffer[]> {
    try {
      console.debug('Splitting audio into buffers...');
      const fileSizeLimit = 10 * 1024 * 1024; // 10 MB en bytes
      const fileBuffer = await fsPromises.readFile(filePath);
      const buffers = [];

      for (let start = 0; start < fileBuffer.length; start += fileSizeLimit) {
        const end = Math.min(start + fileSizeLimit, fileBuffer.length);
        buffers.push(fileBuffer.slice(start, end));
      }

      console.debug('Audio split into buffers.');
      return buffers;
    } catch (error) {
      console.error('Erreur lors de la lecture ou de la découpe du fichier:', error);
      throw error;
    }
  }
}
