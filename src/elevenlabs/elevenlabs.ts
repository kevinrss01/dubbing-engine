import fsPromise from 'fs/promises';
import axios from 'axios';
import * as crypto from 'crypto';
import { ElevenLabsClient } from 'elevenlabs';
import FormData from 'form-data';
import fs from 'fs';
import type { AllowedLanguages } from '../types/index';
import { Readable } from 'stream';
import { AudioUtils } from '../ffmpeg/audio-utils';
interface LabelPerLanguage {
  [key: string]: {
    accent: string;
    langue: string;
    language: string;
  };
}

interface SettingsElevenLabs {
  text: string;
  model_id: 'eleven_monolingual_v2' | 'eleven_multilingual_v2';
  output_format:
    | 'mp3_22050_32'
    | 'mp3_44100_32'
    | 'mp3_44100_64'
    | 'mp3_44100_96'
    | 'mp3_44100_128'
    | 'mp3_44100_192'
    | 'pcm_16000'
    | 'pcm_22050'
    | 'pcm_24000'
    | 'pcm_44100'
    | 'ulaw_8000';
  voice_settings: {
    similarity_boost: number;
    stability: number;
    use_speaker_boost: boolean;
    speed?: number; //max 1.2 min 0.8
  };
  previous_text?: string;
  next_text?: string;
  labels?: {
    accent: string;
    langue: string;
    language: string;
  };
  previous_request_ids?: PreviousRequestIdsEL;
}

//Max 3 previous request ids
export type PreviousRequestIdsEL = string[];
/*




**Stability
*The stability slider determines how stable the voice is and the randomness between each generation.
*Lowering this slider introduces a broader emotional range for the voice.
*As mentioned before, this is also influenced heavily by the original voice.
*Setting the slider too low may result in odd performances that are overly
*random and cause the character to speak too quickly.
*On the other hand, setting it too high can lead to a monotonous voice with limited emotion.


**Similarity
The similarity slider dictates how closely the AI should adhere to the original voice when attempting to replicate it.
If the original audio is of poor quality and the similarity slider is set too high, the AI may reproduce artifacts or background noise when trying to mimic the voice if those were present in the original recording.
*/

/*

**Speaker Boost
This is another setting that was introduced in the new models.
The setting itself is quite self-explanatory – it boosts the similarity to the original speaker.
However, using this setting requires a slightly higher computational load, which in turn increases latency.
The differences introduced by this setting are generally rather subtle.

*/

export type OutputFormat =
  | 'mp3_22050_32'
  | 'mp3_44100_32'
  | 'mp3_44100_64'
  | 'mp3_44100_96'
  | 'mp3_44100_128'
  | 'mp3_44100_192'
  | 'pcm_8000'
  | 'pcm_16000'
  | 'pcm_22050'
  | 'pcm_24000'
  | 'pcm_44100'
  | 'ulaw_8000'
  | 'alaw_8000'
  | 'opus_48000_32'
  | 'opus_48000_64'
  | 'opus_48000_96'
  | 'opus_48000_128'
  | 'opus_48000_192';

export class ElevenLabsService {
  elevenLabsApiKey: string | undefined;
  elevenLabsBaseUrl = 'https://api.elevenlabs.io/v1';
  elevenLabsClient: ElevenLabsClient;

  constructor() {
    this.elevenLabsApiKey = process.env.ELEVEN_LABS_API_KEY;
    if (!this.elevenLabsApiKey) {
      throw new Error('ELEVEN_LABS_API_KEY is not defined');
    }
    this.elevenLabsClient = new ElevenLabsClient({
      apiKey: this.elevenLabsApiKey,
    });
  }

  getLabels(targetLanguage: AllowedLanguages):
    | {
        accent: string;
        langue: string;
        language: string;
      }
    | undefined {
    const labelsPerLanguage: LabelPerLanguage = {
      french: { accent: 'french', langue: 'french', language: 'french' },
      'british english': {
        accent: 'british',
        langue: 'english',
        language: 'english',
      },
      english: {
        accent: 'american',
        langue: 'english',
        language: 'english',
      },
      'french canadian': {
        accent: 'canadian',
        langue: 'french',
        language: 'french',
      },
      vietnamese: {
        accent: 'vietnamese',
        langue: 'vietnamese',
        language: 'vietnamese',
      },
    };

    if (!labelsPerLanguage[targetLanguage]) {
      return undefined;
    } else {
      return labelsPerLanguage[targetLanguage];
    }
  }

  // In the `cloneVoice` method of the `ElevenLabsService` class

  generateShortId(length: number): string {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
  }

  async cloneVoice(
    baseAudio: Buffer[],
    voiceName: string,
    totalDuration: number,
  ): Promise<{ voice_id: string }> {
    console.debug('Cloning voice...');
    const maxDuration = 44 * 60; // 44 minutes in seconds
    const maxBufferSize = 10 * 1024 * 1024; // 10MB in bytes

    let processedAudio = baseAudio;

    let concatenatedBuffer = this.concatenateAudioBuffers(baseAudio);

    // Trim the audio buffer if it exceeds 44 minutes
    if (totalDuration > maxDuration) {
      concatenatedBuffer = await AudioUtils.trimAudioBuffer(concatenatedBuffer, maxDuration);

      processedAudio = this.splitBufferIntoChunks(concatenatedBuffer, maxBufferSize);
    }

    // Split the buffer into chunks not exceeding 10MB
    const uuid = crypto.randomUUID();
    const shortId = this.generateShortId(6);
    const url = `${this.elevenLabsBaseUrl}/voices/add`;

    const formData = new FormData();
    formData.append('name', `custom-voice-${shortId}`);
    formData.append('description', voiceName);

    processedAudio.forEach((audioBuffer, index) => {
      formData.append('files', audioBuffer, {
        filename: `${uuid}-${index}.mp3`,
        contentType: 'audio/mp3',
      });
    });

    try {
      const response = await axios.post(url, formData, {
        headers: {
          ...formData.getHeaders(),
          'xi-api-key': this.elevenLabsApiKey,
        },
      });
      console.debug('One Voice cloned.');
      return response.data;
    } catch (error: any) {
      console.error('Error in voice cloning:', error.response.data);
      if (error.response.data?.detail?.message?.includes('corrupted')) {
        throw new Error('Error during voice cloning, audio file is corrupted.');
      }
      throw new Error('Error during voice cloning');
    }
  }

  private splitBufferIntoChunks(buffer: Buffer, maxChunkSize: number): Buffer[] {
    const chunks: Buffer[] = [];
    let start = 0;

    while (start < buffer.length) {
      const end = Math.min(buffer.length, start + maxChunkSize);
      chunks.push(buffer.slice(start, end));
      start = end;
    }

    return chunks;
  }

  /**
   * Concatenates an array of audio buffers into a single buffer
   * @param audioBuffers Array of audio buffers to concatenate
   * @returns A single concatenated buffer
   */
  concatenateAudioBuffers(audioBuffers: Buffer[]): Buffer {
    // Validate input
    if (!audioBuffers || !Array.isArray(audioBuffers) || audioBuffers.length === 0) {
      throw new Error('Invalid input: audioBuffers must be a non-empty array of Buffer objects');
    }

    // Check if all elements are Buffer instances
    for (const buffer of audioBuffers) {
      if (!(buffer instanceof Buffer)) {
        throw new Error('Invalid input: all elements in audioBuffers must be Buffer instances');
      }
    }

    // Concatenate all buffers into a single buffer
    return Buffer.concat(audioBuffers);
  }

  async generateAudioFile({
    text,
    modelId,
    voiceId,
    previousText,
    nextText,
    targetLanguage,
    speedFactor,
  }: {
    text: string;
    modelId: 'eleven_monolingual_v2' | 'eleven_multilingual_v2';
    voiceId: string;
    previousText?: string;
    nextText?: string;
    targetLanguage?: AllowedLanguages;
    speedFactor?: number;
  }): Promise<{
    response: Buffer;
    requestId: string;
  }> {
    const outputFormat: OutputFormat = 'mp3_44100_128';

    const settingsElevenLabs: SettingsElevenLabs = {
      text: text,
      model_id: modelId,
      labels: targetLanguage ? this.getLabels(targetLanguage) : undefined,
      voice_settings: {
        similarity_boost: 0.85,
        stability: 0.5,
        use_speaker_boost: true,
      },
      output_format: outputFormat,
      //! MP3 with 192kbps bitrate requires you to be subscribed to Creator tier or above. PCM with 44.1kHz sample rate requires you to be subscribed to Pro tier or above.
      //output_format: 'pcm_44100',
    };

    if (previousText) settingsElevenLabs.previous_text = previousText + ' ';
    if (nextText) settingsElevenLabs.next_text = ' ' + nextText;
    if (speedFactor) settingsElevenLabs.voice_settings.speed = Number(speedFactor.toFixed(2));

    // Maximum 3 tries
    const maxAttempts = 3;
    let attempt = 0;

    while (attempt < maxAttempts) {
      try {
        const res = await this.elevenLabsClient.textToSpeech.convert(voiceId, settingsElevenLabs);

        console.debug(`Speech 11labs generated on attempt ${attempt + 1}.`);

        async function readableToBuffer(readable: Readable): Promise<Buffer> {
          const chunks: Buffer[] = [];

          for await (const chunk of readable) {
            chunks.push(Buffer.from(chunk));
          }

          return Buffer.concat(chunks);
        }

        const buffer = await readableToBuffer(res);

        const audioBuffer =
          outputFormat === 'mp3_22050_32' ? buffer : await AudioUtils.convertPCMBufferToWav(buffer);

        return {
          response: audioBuffer,
          requestId: crypto.randomUUID(),
        };
      } catch (error: any) {
        console.error(`ERROR IN AUDIO GENERATION (attempt ${attempt + 1}):`, error);

        if (error.toString().includes('Status code: 401')) {
          throw new Error(
            'The voice you are trying to translate cannot be cloned, because it is a protected voice.',
          );
        }

        attempt++;

        if (attempt < maxAttempts) {
          console.debug('Waiting 10 seconds before next attempt...');
          await new Promise((resolve) => setTimeout(resolve, 10000));
        } else {
          throw new Error('Error during audio generation after multiple attempts');
        }
      }
    }

    // In theory, we should never reach here, but just in case:
    throw new Error('Error during audio generation after multiple attempts');
  }

  async isolateVoiceFromAudio(audioFilePath: string) {
    try {
      console.debug('Isolating voice from audio....');

      const url = `${this.elevenLabsBaseUrl}/audio-isolation/stream`;
      const formData = new FormData();
      formData.append('audio', fs.createReadStream(audioFilePath));

      const response = await axios.post(url, formData, {
        headers: {
          ...formData.getHeaders(),
          'xi-api-key': this.elevenLabsApiKey,
        },
        responseType: 'arraybuffer',
      });

      console.debug('Voice isolated successfully from audio.');

      const vocalIsolatedBuffer = Buffer.from(response.data);
      const outputFilePath = audioFilePath.includes('.wav')
        ? audioFilePath.replace('.wav', '-vocal.wav')
        : audioFilePath.replace('.mp3', '-vocal.mp3');

      await fsPromise.writeFile(outputFilePath, vocalIsolatedBuffer);

      return outputFilePath;
    } catch (err: any) {
      console.error('Error in isolateVoiceFromAudio:', err);
      throw new Error('Error during voice isolation');
    }
  }
}
