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

  static async getAudioMergeWithVideo(videoPath: string, audioPath: string): Promise<string> {
    console.debug('Merging audio and video...');
    let filePath = '';
    try {
      const outputPath = path.join(`output/result-${crypto.randomUUID()}.mp4`);
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

      return filePath;
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

  static addSubtitles = async ({
    videoPath,
    srtFilePath,
    outputFilePath,
  }: {
    videoPath: string;
    srtFilePath: string;
    outputFilePath: string;
  }) => {
    if (!fs.existsSync(srtFilePath)) {
      throw new Error('Srt file does not exist');
    }

    return new Promise((resolve, reject) => {
      // Get input file info
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) {
          console.error('Error probing video file:', err);
          return reject(err);
        }

        // Check if we're dealing with an HEVC/H.265 video
        const videoStream = metadata.streams.find((stream) => stream.codec_type === 'video');
        const isHEVC =
          videoStream && videoStream.codec_name && videoStream.codec_name.toLowerCase().includes('hevc');
        const is10bit = videoStream && videoStream.pix_fmt && videoStream.pix_fmt.includes('10le');

        console.debug(
          `Video info: codec=${videoStream?.codec_name}, pixel format=${videoStream?.pix_fmt}, isHEVC=${isHEVC}, is10bit=${is10bit}`,
        );

        let command = ffmpeg(videoPath);

        // Add subtitles filter with compatible font
        const subtitlesFilter = `subtitles=${srtFilePath}:force_style='FontName=DejaVu'`;

        if (isHEVC || is10bit) {
          // For HEVC/10-bit videos that need browser compatibility:
          console.debug('Converting HEVC/10-bit video to browser-compatible format');
          command = command
            .videoCodec('libx264') // Use H.264 which has better browser support
            .outputOptions([
              '-vf',
              subtitlesFilter,
              '-pix_fmt',
              'yuv420p', // Convert to 8-bit color
              '-crf',
              '18', // High quality
              '-preset',
              'medium', // Balance between speed and quality
              '-movflags',
              '+faststart', // Optimize for web playback
              '-c:a',
              'aac', // Convert audio to AAC for compatibility
              '-b:a',
              '320k', // Good audio quality
            ]);
        } else {
          // For already compatible videos, minimal processing
          command = command.videoCodec('libx264').outputOptions([
            '-vf',
            subtitlesFilter,
            '-pix_fmt',
            'yuv420p', // Ensure 8-bit color
            '-c:a',
            'copy', // Copy audio stream
            '-movflags',
            '+faststart', // Optimize for web playback
          ]);
        }

        command
          .on('start', (commandLine) => {
            console.debug('FFmpeg command:', commandLine);
          })
          .on('stderr', (stderrLine) => {
            if (stderrLine.includes('error')) {
              console.error('FFmpeg stderr:', stderrLine);
            }
          })
          .on('end', () => {
            console.debug('Subtitles added successfully');
            resolve(outputFilePath);
          })
          .on('error', (err) => {
            console.error('Error adding subtitles:', err);
            reject(err);
          })
          .save(outputFilePath);
      });
    });
  };
}
