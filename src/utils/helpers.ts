import * as fs from 'fs';
import * as path from 'path';
import { allowedExtensions, audioExtensions, videoExtensions } from './constants';

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
}
