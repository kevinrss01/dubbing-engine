import { VideoUtils } from '../ffmpeg/video-utils';
import type { AllowedLanguages, SegmentWitDurationAndOriginalSegment } from '../types';
import { specialLanguagesWithSpecialCharacters } from '../utils/config';
import fs from 'fs';
import fsPromises from 'fs/promises';
import crypto from 'crypto';

export class SubtitlesGenerator {
  constructor() {
    //
  }

  static async addSubtitlesInVideo({
    transcriptionData,
    initialVideoPath,
    lang,
  }: {
    transcriptionData: SegmentWitDurationAndOriginalSegment[];
    initialVideoPath: string;
    lang: AllowedLanguages;
  }): Promise<string> {
    console.debug('Adding subtitles in video...');
    const maxLengthText = 50;
    const srtContent = this.createSrt(transcriptionData, maxLengthText, lang);
    const srtFilePath = `temporary-files/subtitles-${crypto.randomUUID()}.srt`;
    fs.writeFileSync(srtFilePath, srtContent, 'utf8');
    const outputVideoFilePath = `output/result-${crypto.randomUUID()}.mp4`;

    try {
      await VideoUtils.addSubtitles({
        videoPath: initialVideoPath,
        srtFilePath: srtFilePath,
        outputFilePath: outputVideoFilePath,
      });

      return outputVideoFilePath;
    } catch (err) {
      console.error(err);
      throw new Error('Error while adding subtitles');
    } finally {
      if (fs.existsSync(srtFilePath)) await fsPromises.unlink(srtFilePath);
      if (fs.existsSync(initialVideoPath)) await fsPromises.unlink(initialVideoPath);
    }
  }

  static createSrt(
    subtitles: SegmentWitDurationAndOriginalSegment[],
    maxLength: number,
    lang: AllowedLanguages,
  ): string {
    console.debug('Creating subtitles srt file...');
    let srtIndex = 1;
    let srtContent = '';

    for (const subtitle of subtitles) {
      const chunks = this.splitTextProportionally(subtitle.transcription, maxLength, lang);

      const totalWords = chunks.reduce((acc, chunk) => acc + chunk.split(' ').length, 0);

      let previousEnd = subtitle.begin;
      for (const chunk of chunks) {
        const words = chunk.split(' ').length;
        const chunkDuration = (subtitle.end - subtitle.begin) * (words / totalWords);
        const begin = this.secondsToSrtTime(previousEnd);
        const end = this.secondsToSrtTime(previousEnd + chunkDuration);

        srtContent += `${srtIndex}\n${begin} --> ${end}\n${chunk}\n\n`;
        srtIndex++;
        previousEnd += chunkDuration;
      }
    }

    console.debug('Subtitles srt file created');
    return srtContent;
  }

  static secondsToSrtTime(seconds: number): string {
    const date = new Date(0);
    date.setSeconds(seconds);
    const iso = date.toISOString();
    return iso.substring(11, 23).replace('.', ',');
  }

  static ddLineBreaks(text: string): string {
    const maxLength = 20;
    let result = '';
    let lineLength = 0;

    for (const char of text) {
      result += char;
      lineLength++;
      if (lineLength >= maxLength) {
        result += '\n';
        lineLength = 0;
      }
    }

    return result;
  }

  static splitTextProportionally(text: string, maxLength: number, lang: AllowedLanguages): string[] {
    const chunks: string[] = [];
    let currentChunk = '';

    if (specialLanguagesWithSpecialCharacters.includes(lang)) {
      maxLength = 20;
      for (const char of text) {
        if ((currentChunk + char).length > maxLength) {
          chunks.push(currentChunk);
          currentChunk = '';
        }
        currentChunk += char;
      }
    } else {
      const words = text.split(' ');
      for (const word of words) {
        if ((currentChunk + ' ' + word).trim().length > maxLength) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }
        currentChunk += (currentChunk ? ' ' : '') + word;
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }
}
