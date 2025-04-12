import * as ffprobeStatic from 'ffprobe-static';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import ffmpeg from 'fluent-ffmpeg';
import crypto from 'crypto';

export class AudioUtils {
  static async getAudioCodec(inputFile: string): Promise<string | null> {
    try {
      const cmd = `"${ffprobeStatic.path}" -v error -show_entries stream=codec_type,codec_name -of default=noprint_wrappers=1:nokey=1 "${inputFile}"`;
      const stdout: string = execSync(cmd, { encoding: 'utf8' });

      // ffprobe will list all streams. Lines with 'audio' and next line with 'codec_name'
      // For example:
      // video
      // h264
      // audio
      // aac
      const lines = stdout
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);

      // We look for the line "audio" then the next line should be the codec.
      for (let i = 0; i < lines.length; i++) {
        if (lines[i] === 'audio' && lines[i + 1]) {
          return lines[i + 1];
        }
      }
      return null;
    } catch (err) {
      console.error('Error running ffprobe:', err);
      return null;
    }
  }

  static async separateAudioAndVideo(inputPath: string): Promise<{ audioPath: string; videoPath: string }> {
    if (!fs.existsSync(inputPath)) throw new Error(`File not found: ${inputPath}`);
    console.debug(`Separating audio and video from ${inputPath}`);

    const audioOutputPathNoExtension = `temporary-files/audio-${crypto.randomUUID()}`;
    const videoOutputPath = `temporary-files/video-${crypto.randomUUID()}.mp4`;

    let audioCodec: string | null = null;
    let finalAudioPath = '';

    try {
      // 1) Determine audio codec
      audioCodec = await this.getAudioCodec(inputPath);

      // Decide the container and whether we can copy the stream:
      // --------------------------------------------------------
      // For AAC -> use .m4a container, copy stream
      // For MP3 -> use .mp3 container, copy stream
      // Otherwise -> re-encode to WAV (.wav)
      let audioContainer = 'm4a';
      let copyAudio = false;

      if (audioCodec && /aac/i.test(audioCodec)) {
        audioContainer = 'm4a';
        copyAudio = true;
      } else if (audioCodec && /mp3/i.test(audioCodec)) {
        audioContainer = 'mp3';
        copyAudio = true;
      } else {
        audioContainer = 'wav';
        copyAudio = false;
      }

      finalAudioPath = `${audioOutputPathNoExtension}.${audioContainer}`;

      await new Promise<void>((resolve, reject) => {
        const command = ffmpeg(inputPath).noVideo();

        // Copy if it's a known container; otherwise encode to WAV
        if (copyAudio) {
          command.audioCodec('copy');
        } else {
          command.audioCodec('pcm_s16le').audioFrequency(44100);
        }

        command
          .output(finalAudioPath)
          .on('error', (err, _stdout, stderr) => {
            console.error('Audio extraction error:', stderr);
            reject(`ffmpeg audio error: ${err.message}`);
          })
          .on('end', () => {
            console.debug('Audio extraction done.');
            resolve();
          })
          .run();
      });

      await new Promise<void>((resolve, reject) => {
        ffmpeg(inputPath)
          .noAudio()
          .videoCodec('copy')
          .output(videoOutputPath)
          .on('error', (err, _stdout, stderr) => {
            console.error('Video extraction error:', stderr);
            reject(`ffmpeg video error: ${err.message}`);
          })
          .on('end', () => {
            console.debug('Video extraction done.');
            resolve();
          })
          .run();
      });

      console.debug('Audio and video separated successfully.');
      return {
        audioPath: finalAudioPath,
        videoPath: videoOutputPath,
      };
    } catch (error) {
      console.error('Error in separateAudioAndVideo:', error);

      // Cleanup
      if (finalAudioPath && fs.existsSync(finalAudioPath)) {
        await fsPromises.unlink(finalAudioPath);
      }
      if (videoOutputPath && fs.existsSync(videoOutputPath)) {
        await fsPromises.unlink(videoOutputPath);
      }

      const errMsg = (error as Error).message || '';
      if (
        errMsg.includes('Invalid data found when processing input') ||
        errMsg.includes('Prediction is not allowed in AAC-LC') ||
        errMsg.includes('Reserved bit set.') ||
        errMsg.includes('corrupt')
      ) {
        throw new Error(`POSSIBLY_CORRUPTED_FILE: ${errMsg}`);
      }
      throw error;
    }
  }
}
