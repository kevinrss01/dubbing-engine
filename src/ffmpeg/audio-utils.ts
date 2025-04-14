import * as ffprobeStatic from 'ffprobe-static';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import ffmpeg from 'fluent-ffmpeg';
import crypto from 'crypto';
import { Readable } from 'stream';
import { PassThrough } from 'stream';
import { file } from 'bun';
import { file as fileTMP } from 'tmp-promise';
import path from 'path';
import { VideoUtils } from './video-utils';
import { applyLavfiWorkaround } from './ffmpegPatch';

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
    console.debug(`Separating audio and video...`);

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

  static async convertToMp3(inputFilePath: string, outputFilePath: string): Promise<void> {
    console.debug('Converting audio to mp3...');

    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputFilePath)
        .output(outputFilePath)
        .audioCodec('libmp3lame')
        .audioBitrate(320)
        .on('end', () => {
          console.debug('Audio converted to mp3.');
          resolve();
        })
        .on('error', (err) => {
          console.error('Error while converting audio to mp3: ', err);
          reject(err);
        })
        .run();
    });

    console.debug('Conversion completed.');
  }

  static async trimAudioBuffer(audioBuffer: Buffer, durationInSeconds: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const inputStream = new Readable({
        read() {
          this.push(audioBuffer);
          this.push(null);
        },
      });

      const outputStream = new PassThrough();
      let trimmedBuffer = Buffer.alloc(0);

      ffmpeg(inputStream)
        .format('mp3')
        .setDuration(durationInSeconds)
        .audioCodec('libmp3lame')
        .audioBitrate(320)
        .on('error', (err) => {
          console.error('Error while trimming audio buffer:', err);
          reject(err);
        })
        .on('end', () => {
          resolve(trimmedBuffer);
        })
        .pipe(outputStream);

      outputStream.on('data', (chunk: Buffer) => {
        trimmedBuffer = Buffer.concat([trimmedBuffer, chunk]);
      });

      outputStream.on('finish', () => {
        resolve(trimmedBuffer);
      });

      outputStream.on('error', (err: any) => {
        reject(err);
      });
    });
  }

  static async convertPCMBufferToWav(pcmBuffer: Buffer): Promise<Buffer> {
    const { path: pcmFilePath, cleanup: pcmCleanup } = await fileTMP({
      postfix: '.pcm',
    });
    const { path: wavFilePath, cleanup: wavCleanup } = await fileTMP({
      postfix: '.wav',
    });

    try {
      await fsPromises.writeFile(pcmFilePath, pcmBuffer);
      console.debug('Converting PCM buffer to WAV file using ffmpeg');
      await new Promise<void>((resolve, reject) => {
        ffmpeg(pcmFilePath)
          .inputOptions(['-f', 's16le', '-ar', '44100', '-ac', '1'])
          .output(wavFilePath)
          .on('error', (err: any) => {
            console.error('Error during conversion:', err);
            reject(err);
          })
          .on('end', () => resolve(undefined))
          .run();
      });
      const wavBuffer = await fsPromises.readFile(wavFilePath);
      return wavBuffer;
    } catch (error) {
      console.error('Failed to convert PCM buffer to WAV:', error);
      throw new Error('Failed to convert PCM buffer to WAV');
    } finally {
      if (fs.existsSync(pcmFilePath)) await pcmCleanup();
      if (fs.existsSync(wavFilePath)) await wavCleanup();
    }
  }

  static async getAverageDecibel(inputFilePath: string): Promise<number> {
    console.debug(`Analyzing audio decibel level for: ${inputFilePath}`);

    if (!fs.existsSync(inputFilePath)) {
      throw new Error(`File not found: ${inputFilePath}`);
    }

    return new Promise((resolve, reject) => {
      let meanVolumeOutput = '';

      ffmpeg(inputFilePath)
        .audioFilters('volumedetect')
        .format('null')
        .output('/dev/null')
        .on('stderr', (line) => {
          if (line.includes('mean_volume')) {
            meanVolumeOutput = line;
          }
        })
        .on('error', (err) => {
          console.error('Error analyzing audio volume:', err);
          reject(err);
        })
        .on('end', () => {
          // Extract the mean_volume value from the output
          const match = meanVolumeOutput.match(/mean_volume: ([-\d.]+) dB/);
          if (match && match[1]) {
            const averageDecibel = parseFloat(match[1]);
            console.debug(`Average decibel level: ${averageDecibel} dB`);
            resolve(averageDecibel);
          } else {
            reject(new Error('Failed to extract mean volume information'));
          }
        })
        .run();
    });
  }

  // -------------------------
  // adjustAudioToDecibel - Adjust audio volume to reach target decibel level
  // -------------------------
  static async adjustAudioToDecibel(inputFilePath: string, targetDecibel: number): Promise<string> {
    console.debug(`Adjusting audio to target decibel level: ${targetDecibel} dB`);

    if (!fs.existsSync(inputFilePath)) {
      throw new Error(`File not found: ${inputFilePath}`);
    }

    // Get current average decibel level
    const currentDecibel = await this.getAverageDecibel(inputFilePath);

    // Calculate the gain needed (difference between target and current)
    // Audio decibels are often negative values, so this calculation works for both positive and negative values
    let gainNeeded = Number((targetDecibel - currentDecibel).toFixed(2));

    const fileExtension = path.extname(inputFilePath);
    const tempOutputFilePath = `temporary-files/adjusted-audio-${crypto.randomUUID()}${fileExtension}`;

    const outputDir = path.dirname(tempOutputFilePath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    return new Promise((resolve, reject) => {
      const volumeFilter = `volume=${gainNeeded}dB`;
      console.debug(`Applying volume filter: ${volumeFilter}`);

      ffmpeg(inputFilePath)
        .audioFilters(volumeFilter)
        .output(tempOutputFilePath)
        .on('stderr', (line) => {
          if (line.includes('error')) {
            console.error('FFmpeg stderr:', line);
          }
        })
        .on('error', (err) => {
          console.error('Error adjusting audio volume:', err);
          reject(err);
        })
        .on('end', async () => {
          try {
            console.debug(`Audio adjusted to target level and saved to: ${tempOutputFilePath}`);

            await fsPromises.unlink(inputFilePath);
            console.debug(`Original file deleted: ${inputFilePath}`);

            await fsPromises.rename(tempOutputFilePath, inputFilePath);
            console.debug(`Adjusted file moved to original location: ${inputFilePath}`);

            resolve(inputFilePath);
          } catch (error) {
            console.error('Error replacing original file:', error);
            reject(error);
          }
        })
        .run();
    });
  }

  static async cutAudioToBufferAtSpecificTime(
    audioPath: string,
    start: number,
    end: number,
    returnBuffer: boolean = true,
  ): Promise<Buffer | string> {
    const { path: tempFilePath, cleanup } = await fileTMP({
      postfix: '.mp3',
      keep: !returnBuffer,
    });

    return new Promise((resolve, reject) => {
      ffmpeg(audioPath)
        .setStartTime(start)
        .setDuration(end - start)
        .output(tempFilePath)
        .audioCodec('libmp3lame')
        .audioBitrate(320)
        .on('error', async (err) => {
          await cleanup();
          reject(err);
        })
        .on('end', async () => {
          try {
            if (returnBuffer) {
              const buffer = await fsPromises.readFile(tempFilePath);
              await cleanup();
              resolve(buffer);
            } else {
              resolve(tempFilePath);
            }
          } catch (readError) {
            await cleanup();
            reject(readError);
          }
        })
        .run();
    });
  }

  static async concatenateAudio({
    files,
    outputPath,
    outputFormat = 'wav',
  }: {
    files: string[];
    outputPath: string;
    outputFormat?: 'wav' | 'mp3';
  }): Promise<string> {
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const validFiles: string[] = [];

    for (const file of files) {
      if (!fs.existsSync(file)) {
        console.error(`\n[SKIP FILE] File does not exist: ${file}\n`);
        continue;
      }

      try {
        await new Promise<void>((resolve, reject) => {
          ffmpeg()
            .input(file)
            .outputOptions(['-f', 'null'])
            .on('start', () => {
              // Optional: console.debug(`Verifying file: ${file}`);
            })
            .on('stderr', (line) => {
              if (line.toLowerCase().includes('error')) {
                console.error('FFmpeg error:', line);
              }
            })
            .on('error', (err) => {
              reject(err);
            })
            .on('end', () => {
              resolve();
            })
            .saveToFile('/dev/null');
        });

        validFiles.push(file);
      } catch (err) {
        console.error(`\n[SKIP FILE] Invalid/unreadable audio file: ${file}`);
        console.error('Reason:', err, '\n');
      }
    }

    if (validFiles.length === 0) {
      console.error('\n[CONCAT WARNING] No valid audio files found. Skipping concatenation.\n');
      return outputPath;
    }

    const randomId = crypto.randomBytes(8).toString('hex');
    const concatFilePath = path.join(outputDir, `concat_${randomId}.txt`);

    const fileContent = validFiles.map((filePath) => `file '${path.resolve(filePath)}'`).join('\n');
    fs.writeFileSync(concatFilePath, fileContent);

    try {
      console.debug('Starting audio concatenation...');
      await new Promise<void>((resolve, reject) => {
        let command = ffmpeg().input(concatFilePath).inputOptions(['-f', 'concat', '-safe', '0']);

        if (outputFormat === 'wav') {
          command = command.audioCodec('pcm_s16le').audioFrequency(44100).audioChannels(1).format('wav');
        } else if (outputFormat === 'mp3') {
          command = command
            .audioCodec('libmp3lame')
            .audioFrequency(44100)
            .audioChannels(1)
            .audioBitrate('320k')
            .format('mp3');
        }

        command
          .outputOptions(['-loglevel', 'error'])
          .output(outputPath)
          .on('start', () => console.debug('Processing audio files...'))
          .on('stderr', (line) => {
            if (line.toLowerCase().includes('error')) {
              console.error('FFmpeg error:', line);
            }
          })
          .on('error', (error) => {
            console.error('FFmpeg error:', error);
            reject(error);
          })
          .on('end', () => {
            console.debug('Audio concatenation completed successfully.');
            resolve();
          })
          .run();
      });
    } catch (err) {
      throw new Error(`Concatenation failed: ${(err as Error).message}`);
    } finally {
      if (fs.existsSync(concatFilePath)) {
        await fsPromises.unlink(concatFilePath);
      }

      for (const file of files) {
        if (fs.existsSync(file)) {
          await fsPromises.unlink(file);
        }
      }
    }

    return outputPath;
  }

  static async duplicateAndConcatenateAudio(
    inputFilePath: string,
    repeatCount: number,
    outputFormat: 'wav' | 'mp3' = 'wav',
  ): Promise<string> {
    console.debug(`Duplicating and concatenating audio ${repeatCount} times...`);

    if (!fs.existsSync(inputFilePath)) {
      throw new Error('Input file does not exist');
    }

    const tempDir = 'temporary-files/temp';
    const inputTempDir = 'temporary-files';
    const outputDir = 'temporary-files';
    const tempFilePaths: string[] = [];
    let concatFilePath: string | null = null;
    let outputFilePath: string | null = null;

    try {
      [tempDir, inputTempDir, outputDir].forEach((dir) => {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      });

      const inputExtension = path.extname(inputFilePath) || (outputFormat === 'wav' ? '.wav' : '.mp3');

      for (let i = 0; i < repeatCount; i++) {
        const tempFilePath = path.join(
          inputTempDir,
          `for-duplicate-audio-${crypto.randomUUID()}${inputExtension}`,
        );
        await fs.promises.copyFile(inputFilePath, tempFilePath);
        tempFilePaths.push(tempFilePath);
      }

      concatFilePath = path.join(tempDir, `concat-${crypto.randomUUID()}.txt`);
      console.debug('Concat file path:', concatFilePath);
      const concatContent = tempFilePaths.map((file) => `file '${path.relative(tempDir, file)}'`).join('\n');
      await fs.promises.writeFile(concatFilePath, concatContent);

      const outputExtension = outputFormat === 'wav' ? '.wav' : '.mp3';
      outputFilePath = path.join(outputDir, `${crypto.randomUUID()}${outputExtension}`);

      await new Promise<void>((resolve, reject) => {
        if (!concatFilePath || !outputFilePath) {
          reject(new Error('Concat file path or output file path is null'));
          return;
        }

        let command = ffmpeg().input(concatFilePath).inputOptions(['-f', 'concat', '-safe', '0']);

        // Configure FFmpeg based on the desired output format
        if (outputFormat === 'wav') {
          command = command
            .audioCodec('pcm_s16le') // set codec for WAV
            .audioFrequency(44100) // set sample rate
            .audioChannels(1) // set channels
            .format('wav'); // output format WAV
        } else if (outputFormat === 'mp3') {
          command = command
            .audioCodec('libmp3lame') // set codec for MP3
            .audioFrequency(44100) // set sample rate
            .audioChannels(1) // set channels
            .audioBitrate('320k') // set bitrate for MP3
            .format('mp3'); // output format MP3
        }

        command = command
          .outputOptions(['-loglevel', 'error'])
          .on('start', () => {
            console.debug('Processing audio files...');
          })
          .on('stderr', (line) => {
            if (line.toLowerCase().includes('error')) {
              console.error('FFmpeg stderr:', line);
            }
          })
          .on('error', (err) => {
            console.error('Error during audio duplication and concatenation:', err);
            reject(new Error('Error during audio duplication and concatenation'));
          })
          .on('end', () => {
            console.debug('Audio duplication and concatenation completed.');
            resolve();
          })
          .save(outputFilePath);

        command.run();
      });

      return outputFilePath;
    } catch (error) {
      console.error('An error occurred:', error);
      throw error;
    } finally {
      const filesToDelete = [...tempFilePaths, concatFilePath, inputFilePath].filter(
        (file): file is string => file !== null,
      );

      await Promise.all(
        filesToDelete.map(async (file) => {
          if (fs.existsSync(file)) {
            await fsPromises.unlink(file);
          }
        }),
      );

      if (outputFilePath && !fs.existsSync(outputFilePath)) {
        console.error('Output file was not created successfully.');
      }
    }
  }

  static async getAudioDurationFromBuffer(
    buffer: Buffer | Readable | NodeJS.ReadableStream,
  ): Promise<number | 'N/A'> {
    const uuid = crypto.randomUUID();
    const tempFileName = `temporary-files/output-${uuid}-for-getting-audio-duration.wav`;

    try {
      // Add type checking
      if (typeof buffer === 'number' || !buffer) {
        console.error('Invalid input: buffer must be a Buffer or Readable stream');
        throw new Error('Invalid input: buffer must be a Buffer or Readable stream');
      }

      await fsPromises.writeFile(tempFileName, buffer);

      // Use the common utility for getting file duration
      const duration = await VideoUtils.getFileDuration(tempFileName);

      return duration;
    } catch (error) {
      console.error('Failed to get audio duration from buffer:', error);
      throw new Error('Failed to get audio duration');
    } finally {
      try {
        if (fs.existsSync(tempFileName)) {
          await fsPromises.unlink(tempFileName);
        }
      } catch (unlinkError) {
        console.error(`Error deleting temporary file: ${tempFileName}`, unlinkError);
      }
    }
  }

  static async removeStartAndEndSilenceFromAudioWithFFMPEG(inputFilePath: string, outputFilePath: string) {
    // Remove silence from the audio file at the beginning and at the end only
    return await new Promise<void>((resolve, reject) => {
      ffmpeg(inputFilePath)
        .audioFilters([
          {
            filter: 'silenceremove',
            options: 'start_periods=1:start_duration=0.1:start_threshold=-400dB',
          },
          {
            filter: 'silenceremove',
            options: 'stop_periods=-1:stop_duration=0.1:stop_threshold=-400dB',
          },
        ])
        .on('end', () => {
          resolve();
        })
        .on('error', (err) => {
          console.error('Error: ' + err.message);
          reject(err);
        })
        .save(outputFilePath);
    });
  }

  static async adjustSpeed(speech: Buffer, speedFactor: number): Promise<Buffer> {
    console.debug('Adjusting audio speed with factor:', speedFactor);

    // Use temp files instead of streams to avoid blocking issues
    const { path: inputPath, cleanup: cleanupInput } = await fileTMP({ postfix: '.wav' });
    const { path: outputPath, cleanup: cleanupOutput } = await fileTMP({ postfix: '.wav' });

    try {
      // Write input buffer to temp file
      await fsPromises.writeFile(inputPath, speech);

      // Process with ffmpeg using file-based approach
      await new Promise<void>((resolve, reject) => {
        ffmpeg(inputPath)
          .audioCodec('pcm_s16le')
          .audioFilters(`atempo=${speedFactor}`)
          .format('wav')
          .on('error', (err) => {
            console.error('Error adjusting speed:', err);
            reject(err);
          })
          .on('end', () => {
            console.debug('Speed adjustment completed');
            resolve();
          })
          .save(outputPath);
      });

      // Read the result back as buffer
      const resultBuffer = await fsPromises.readFile(outputPath);
      return resultBuffer;
    } catch (error) {
      console.error('Failed to adjust audio speed:', error);
      throw error;
    } finally {
      // Clean up temp files
      await cleanupInput();
      await cleanupOutput();
    }
  }

  static async generateSilence(duration: number, audioFrequency: number): Promise<string> {
    const { path } = await fileTMP({ postfix: '.wav' });

    if (duration <= 0.001) {
      throw new Error(`Silence duration is too short, must be greater than 0: ${duration}`);
    }

    await new Promise((resolve, reject) => {
      const command = ffmpeg().input(`anullsrc=channel_layout=mono:sample_rate=${audioFrequency}`);
      //! Delete this workaround when the fix ffmpeg is released. See here:
      //! https://github.com/fluent-ffmpeg/node-fluent-ffmpeg/issues/1282
      //! https://github.com/fluent-ffmpeg/node-fluent-ffmpeg/pull/1276
      applyLavfiWorkaround(command);

      command
        .inputFormat('lavfi')
        // Use PCM codec for WAV
        .audioCodec('pcm_s16le')
        .format('wav') // Specify output format
        .duration(duration)
        .on('stderr', (line) => {
          if (line.includes('error')) {
            console.error('silence stderr', line);
          }
        })
        .on('error', (err) => {
          console.error(err);
          reject(err);
        })
        .on('end', () => resolve(undefined))
        .save(path);
    });

    return path;
  }

  static overlayingAudio = async (outputPath: string, files: string[]): Promise<string> => {
    if (files.length === 0) {
      throw new Error('No audio files provided.');
    }

    // If there is only one file, just copy it without mixing
    if (files.length === 1) {
      await fsPromises.copyFile(files[0], outputPath);
      return outputPath;
    }

    console.debug('Starting audio overlaying...');

    return new Promise((resolve, reject) => {
      const command = ffmpeg();

      files.forEach((file) => {
        command.input(file);
      });

      const filters: string[] = [];
      let amixInputs = '';

      files.forEach((_, index) => {
        filters.push(
          //! set to stereo
          `[${index}:a]aresample=44100,aformat=channel_layouts=stereo[a${index}]`,
        );
        amixInputs += `[a${index}]`;
      });

      filters.push(`${amixInputs}amix=inputs=${files.length}:duration=longest:dropout_transition=1[aout]`);

      command
        .complexFilter(filters, 'aout')
        .audioCodec('pcm_s16le')
        .format('wav')
        .outputOptions('-y')
        .on('start', () => {
          console.debug('FFmpeg started processing...');
        })
        .on('stderr', (line) => {
          console.debug('FFmpeg stderr:', line);
        })
        .on('error', async (err) => {
          console.error(`Error: ${err.message}`);
          for (const file of files) {
            if (fs.existsSync(file)) await fsPromises.unlink(file);
          }
          reject(err);
        })
        .on('end', async () => {
          console.debug('Audio files have been merged successfully.');
          // Cleanup temporary files
          for (const file of files) {
            if (fs.existsSync(file)) await fsPromises.unlink(file);
          }
          console.debug('Audio overlaying done.');
          resolve(outputPath);
        })
        .saveToFile(outputPath);
    });
  };

  static async startEqualizeAudio(audioPath: string): Promise<string> {
    const uuid = crypto.randomUUID();
    const newAudioPath = `temporary-files/${uuid}-equalized.wav`;

    try {
      await this.equalizeAudio(audioPath, newAudioPath, 44100);
      return newAudioPath;
    } catch (err) {
      console.error(err);
      throw new Error('Error while equalizing audio');
    } finally {
      if (fs.existsSync(audioPath)) await fsPromises.unlink(audioPath);
    }
  }

  static async equalizeAudio(
    inputFilePath: string,
    outputFilePath: string,
    audioFrequency: number,
  ): Promise<void> {
    console.debug('Equalizing audio...');

    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputFilePath)
        .audioCodec('pcm_s16le')
        .audioFrequency(audioFrequency)
        .audioFilters(
          'loudnorm=I=-23:LRA=7:TP=-2:measured_I=-24:measured_LRA=11:measured_TP=-1.5:measured_thresh=-25.6:offset=-0.7',
        )
        .output(outputFilePath)
        .on('end', () => {
          console.debug('Audio equalization completed.');
          resolve();
        })
        .on('error', (err) => {
          console.error('Error while equalizing audio:', err);
          reject(err);
        })
        .run();
    });
  }

  static async mergeAudioFiles(audioPath1: string, audioPath2: string, outputPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      ffmpeg()
        .input(audioPath1)
        .input(audioPath2)
        .complexFilter([
          {
            filter: 'amix',
            options: { inputs: 2, duration: 'longest' },
          },
        ])
        .audioCodec('pcm_s16le')
        .output(outputPath)
        .on('error', (err) => {
          console.error(err);
          reject(err);
        })
        .on('end', () => {
          console.debug('Merging audio and background music done.');
          resolve(outputPath);
        })
        .run();
    });
  }
}
