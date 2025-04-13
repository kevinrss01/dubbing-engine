import type { GladiaRequestBody, GladiaResponse } from '../types';
import axios from 'axios';
import fs from 'fs';
import FormData from 'form-data';
import fsPromise from 'fs/promises';

const baseUrlGladia = 'https://api.gladia.io/v2/pre-recorded/';

interface AudioUploadResponse {
  audio_url: string;
  audio_metadata: {
    id: string;
    filename: string;
    source: string;
    extension: string;
    size: number;
    audio_duration: number;
    number_of_channels: number;
  };
}

export class Transcriber {
  static async transcribeAudio({
    audioPath,
    numberOfSpeakers,
  }: {
    audioPath: string;
    numberOfSpeakers: string;
  }) {
    try {
      const speakerNumber =
        numberOfSpeakers !== 'auto-detect' && numberOfSpeakers !== undefined
          ? parseInt(numberOfSpeakers)
          : numberOfSpeakers;

      const audioUrl = await this.uploadAudioFile(audioPath);

      const transcription = await this.getGladiaTranscription({
        fileUrl: audioUrl,
        numberOfSpeakers: speakerNumber,
      });

      return transcription;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(error.message);
      } else {
        throw new Error('Error in transcribeAudio: ' + error);
      }
    }
  }

  static async getGladiaTranscription({
    fileUrl,
    numberOfSpeakers,
  }: {
    fileUrl: string;
    numberOfSpeakers: number | 'auto-detect';
  }): Promise<GladiaResponse> {
    try {
      const requestData: GladiaRequestBody = {
        audio_url: fileUrl,
        detect_language: true,
        diarization: true,
        sentences: true,
        name_consistency: true,
        punctuation_enhanced: true,
        summarization: true,
      };

      if (numberOfSpeakers !== 'auto-detect' && numberOfSpeakers !== undefined && numberOfSpeakers !== 0) {
        requestData.diarization_config = {
          number_of_speakers: numberOfSpeakers || 1,
          max_speakers: numberOfSpeakers || 1,
        };
      }

      const headers = {
        'x-gladia-key': process.env.GLADIA_API_KEY,
        'Content-Type': 'application/json',
      };

      console.debug('- Sending initial request to Gladia API...');
      const initialResponse: any = await this.makeFetchRequest(baseUrlGladia, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestData),
      });

      console.debug('requestData:', requestData);

      if (!initialResponse.id) {
        console.debug('Gladia response:', initialResponse);
        throw new Error('Error with gladia initialization');
      }

      const response = await this.pollForResult(initialResponse.id, headers);

      return response;
    } catch (error) {
      console.error('Error in Gladia transcription:', error);
      throw new Error('Error in Gladia transcription');
    }
  }

  static async pollForResult(transcriptionId: string, headers: any): Promise<GladiaResponse> {
    const pollUrl = `${baseUrlGladia}${transcriptionId}`;

    while (true) {
      const pollResponse: any = await this.makeFetchRequest(pollUrl, {
        method: 'GET',
        headers,
      });

      if (pollResponse.status === 'done') {
        console.debug('pollResponse Gladia parameters:', pollResponse.request_params);
        return pollResponse;
      } else if (pollResponse.status === 'error') {
        throw new Error(`Gladia transcription failed: ${pollResponse.error}`);
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  static async makeFetchRequest(url: string, options: any) {
    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`Gladia API error: ${response.statusText}`);
    }
    return response.json();
  }

  static async uploadAudioFile(filePath: string): Promise<string> {
    const apiKey = process.env.GLADIA_API_KEY;
    if (!apiKey) {
      throw new Error('Missing GLADIA_API_KEY environment variable.');
    }

    try {
      console.log('Uploading audio file to Gladia API...');

      const form = new FormData();
      const fileStream = fs.createReadStream(filePath);
      const filename = filePath.split('/').pop() || 'audio.mp3';

      form.append('audio', fileStream, filename);

      const response = await axios.post('https://api.gladia.io/v2/upload', form, {
        headers: {
          'x-gladia-key': apiKey,
          ...form.getHeaders(),
        },
      });

      const data = response.data as AudioUploadResponse;

      if (!data.audio_url) {
        console.error('Error uploading audio file to Gladia API: ', data);
        throw new Error('Error uploading audio file to Gladia API');
      }

      console.debug('File uploaded to Gladia API:', response.data);

      return data.audio_url;
    } catch (error: any) {
      console.error('Error uploading audio file:', error.response?.data || error.message);
      throw new Error(`Upload failed: ${error.message}`);
    }
  }
}
