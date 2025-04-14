import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import type { Readable } from 'stream';
import path from 'path';
import crypto from 'crypto';
import { createReadStream } from 'fs';
import { promisify } from 'util';

export class VideoUtils {
  static async getFileDuration(filePath: string): Promise<number | 'N/A'> {
    return new Promise((resolve, reject) => {
      if (!filePath) {
        console.error('No file path provided');
        return reject(new Error('No file path provided'));
      }

      if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        return reject(new Error('File not found or inaccessible'));
      }

      try {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
          if (err) {
            console.error('Error while getting file duration:', err, metadata);

            const errorMessage = err.message?.toLowerCase() || '';
            if (errorMessage.includes('invalid data') || errorMessage.includes('unsupported format')) {
              return reject(new Error('Invalid or unsupported media format'));
            }
            if (errorMessage.includes('permission denied')) {
              return reject(new Error('Permission denied to access file'));
            }

            return reject(new Error('Failed to process media file'));
          }

          if (!metadata?.format?.duration) {
            console.error('No duration found in metadata:', {
              filePath,
              metadata: metadata?.format,
            });
            return reject(new Error('Could not determine media duration'));
          }

          const duration = metadata.format.duration;
          if (typeof duration !== 'number' || isNaN(duration) || duration <= 0) {
            console.error('Invalid duration value:', duration);
            console.error('metadata of the file:', metadata);
          }

          resolve(duration);
        });
      } catch (error) {
        console.error('Unexpected error in getFileDuration:', error);
        reject(new Error('Internal server error while processing media'));
      }
    });
  }

  static async getAudioMergeWithVideo(
    videoPath: string,
    audioPath: string,
  ): Promise<{ stream: Readable; filePath: string }> {
    console.debug('Merging audio and video...');
    let filePath = '';
    try {
      const outputPath = path.join(`temporary-files/${crypto.randomUUID()}.mp4`);
      const contentLength = await this.getFileDuration(audioPath);

      if (typeof contentLength !== 'number')
        throw new Error(
          `Error during audio duration when merging audio and video: duration is not a number: ${contentLength}`,
        );

      filePath = await this.mergeAudioAndVideo({
        videoPath,
        audioPath,
        outputPath,
      });

      console.debug('Audio and video merged.');

      const stream = createReadStream(filePath);
      return { stream, filePath };
    } catch (e) {
      console.error(e);
      throw new Error('Error while merging audio and video');
    }
  }

  static mergeAudioAndVideo = async ({
    videoPath,
    audioPath,
    outputPath,
  }: {
    videoPath: string;
    audioPath: string;
    outputPath: string;
  }): Promise<string> => {
    console.debug('Merging audio and video...');

    const fileExtension = path.extname(videoPath).substring(1).toLowerCase();

    // Helper to probe the audio track
    const ffprobePromise = promisify(ffmpeg.ffprobe);
    const audioMetadata = (await ffprobePromise(audioPath)) as {
      streams: Array<{ codec_type: string; codec_name: string }>;
    };
    const audioStreamIndex = audioMetadata.streams.findIndex((stream) => stream.codec_type === 'audio');
    if (audioStreamIndex === -1) {
      throw new Error('No valid audio track found in the provided audio file');
    }

    const videoMetadata = (await ffprobePromise(videoPath)) as {
      streams: Array<{ codec_type: string; codec_name: string }>;
    };

    const videoStreamIndex = videoMetadata.streams.findIndex((stream) => stream.codec_type === 'video');

    if (videoStreamIndex === -1) {
      throw new Error('No valid video track found in the provided video file');
    }

    const isAAC = audioMetadata.streams.some(
      (stream) => stream.codec_type === 'audio' && stream.codec_name === 'aac',
    );

    return new Promise((resolve, reject) => {
      const command = ffmpeg()
        .input(videoPath)
        .input(audioPath)
        // English comment: Map video from the first input, audio from the second
        .outputOptions([
          // Map the correct video track from the 1st input
          `-map 0:${videoStreamIndex}`,
          // Map the correct audio track from the 2nd input
          `-map 1:${audioStreamIndex}`,

          // Always copy video to avoid re-encoding (faster + no quality loss)
          '-c:v copy',

          // If audio is already AAC, copy it; otherwise encode to AAC
          isAAC ? '-c:a copy' : '-c:a aac',

          // Only apply bitrate if we are encoding
          // (this will be ignored if we're copying)
          '-b:a 320k',
          '-ar 48000',

          // Enable faststart for quick playback start in MP4
          '-movflags +faststart',

          // Use all available CPU threads for any encoding
          '-threads 0',
        ])
        .format(fileExtension)
        .output(outputPath)
        .on('error', (err) => {
          console.error('Error merging audio/video:', err);
          reject(err);
        })
        .on('stderr', (line) => {
          if (line.toLowerCase().includes('error')) {
            console.error('FFmpeg error:', line);
          }
        })
        .on('end', () => {
          console.debug('Merging succeeded with minimal re-encoding.');
          resolve(outputPath);
        });

      command.run();
    });
  };
}
