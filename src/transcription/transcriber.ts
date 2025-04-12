import type { GladiaRequestBody, GladiaResponse } from '../types';

const baseUrlGladia = 'https://api.gladia.io/v2/pre-recorded/';

export class Transcriber {
  static async transcribeAudio({
    audioPath,
    numberOfSpeakers,
  }: {
    audioPath: string;
    numberOfSpeakers: string;
  }) {
    let transcriptionSummary = '';
    const speakerNumber =
      numberOfSpeakers !== 'auto-detect' && numberOfSpeakers !== undefined
        ? parseInt(numberOfSpeakers)
        : numberOfSpeakers;
  }

  static async getGladiaTranscription({
    filePath,
    numberOfSpeakers,
  }: {
    filePath: string;
    numberOfSpeakers: number | 'auto-detect';
  }): Promise<GladiaResponse> {
    try {
      let audioUrl = '';

      const requestData: GladiaRequestBody = {
        audio_url: audioUrl!,
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

      return {
        ...response,
        original_audio_path: filePath,
      };
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
}
