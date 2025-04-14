import { ElevenLabsService } from './../elevenlabs/elevenlabs';
import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import fsPromises from 'fs/promises';
import qs from 'qs';
import { AudioUtils } from '../ffmpeg/audio-utils';

export class Spleeter {
  static async getSeparateAudio(audioFilePath: string) {
    const filePathMp3 = audioFilePath.replace('.wav', '.mp3');
    try {
      await AudioUtils.convertToMp3(audioFilePath, filePathMp3);

      const backgroundAudio = (await this.separateAudioInTwoParts(filePathMp3)).accompaniment;

      const elevenLabsService = new ElevenLabsService();
      const vocalsIsolated = await elevenLabsService.isolateVoiceFromAudio(audioFilePath);

      return { backgroundAudio, vocalsIsolated };
    } catch (error) {
      console.error('Error in getSeparateAudio:', error);
      if (error instanceof Error) {
        throw error;
      } else {
        throw new Error('Error in getSeparateAudio');
      }
    } finally {
      if (fs.existsSync(filePathMp3)) {
        await fsPromises.unlink(filePathMp3);
      }
    }
  }

  static async separateAudioInTwoParts(filePath: string): Promise<{
    vocals: string;
    accompaniment: string;
  }> {
    console.debug('Separating audio into vocals and accompaniment...');
    const licenseKey = process.env.LALAL_LICENSE_KEY;
    const apiUrlBase = 'https://www.lalal.ai/api';
    let fileId: string = '';

    const checkStatus = async (fileId: string): Promise<LalalAPIResponse> => {
      let isCompleted = false;
      let statusData: LalalAPIResponse | null = null;

      while (!isCompleted) {
        try {
          const data = qs.stringify({ id: fileId });
          const response = await axios.post(`${apiUrlBase}/check/`, data, {
            headers: {
              Authorization: `license ${licenseKey}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
          });

          if (response.data.status === 'success') {
            const taskState = response.data.result[fileId]?.task?.state;
            if (taskState === 'success') {
              isCompleted = true;
              statusData = response.data;
            } else {
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }
          } else {
            console.error('Error checking status:', response.data.error);
            throw new Error(response.data.error || 'Status check failed');
          }
        } catch (error) {
          console.error('An error occurred while checking status:', error);
          throw error;
        }
      }

      if (!statusData) throw new Error('No status data found');
      return statusData;
    };

    const processAudio = async (filePath: string): Promise<LalalAPIResponse> => {
      try {
        const form = new FormData();
        form.append('file', fs.createReadStream(filePath), {
          filename: filePath.split('/').pop(),
        });

        // Retry up to 2 additional times if the upload fails
        const uploadAttempt = async (maxRetries = 2): Promise<ApiUploadResponse> => {
          let attempts = 0;
          let lastError: any;
          while (attempts <= maxRetries) {
            try {
              const uploadResponse = await axios.post<ApiUploadResponse>(`${apiUrlBase}/upload/`, form, {
                headers: {
                  ...form.getHeaders(),
                  'Content-Disposition': `attachment; filename=${filePath.split('/').pop()}`,
                  Authorization: `license ${licenseKey}`,
                },
              });
              if (uploadResponse.data.status === 'success') {
                return uploadResponse.data;
              } else {
                lastError = new Error(uploadResponse.data.error || 'Upload failed');
                console.error('Upload failed:', uploadResponse.data.error);
              }
            } catch (error) {
              lastError = error;
              console.error('Upload request error:', error);
            }

            attempts++;
            if (attempts <= maxRetries) {
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }
          }

          console.error('Upload failed after multiple attempts:', lastError);
          throw new Error('Upload failed after multiple attempts.');
        };

        const uploadResponse = await uploadAttempt();

        if (!uploadResponse.id) throw new Error('No file ID received from upload');
        fileId = uploadResponse.id;

        interface SplitParams {
          id: string;
          stem:
            | 'vocals'
            | 'drum'
            | 'bass'
            | 'piano'
            | 'electric_guitar'
            | 'acoustic_guitar'
            | 'synthesizer'
            | 'voice'
            | 'strings'
            | 'wind';
          splitter: 'orion' | 'phoenix' | 'perseus';
          filter: 0 | 1 | 2;
        }

        const params: SplitParams[] = [
          {
            id: fileId,
            stem: 'voice',
            splitter: 'perseus',
            filter: 2,
          },
        ];

        const splitResponse = await axios.post(
          `${apiUrlBase}/split/`,
          qs.stringify({ params: JSON.stringify(params) }),
          {
            headers: {
              ...form.getHeaders(),
              Authorization: `license ${licenseKey}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
          },
        );

        if (splitResponse.data.status !== 'success') {
          console.error('Split operation failed:', splitResponse.data.error);
          throw new Error('Split operation failed.');
        }

        console.debug('Split operation initiated successfully');
        return await checkStatus(fileId);
      } catch (error) {
        console.error('Process failed:', error);
        if (error instanceof Error) {
          throw error;
        }
        throw new Error('Error while processing audio');
      }
    };

    try {
      const lalalResponse = await processAudio(filePath);
      const vocals = lalalResponse.result[fileId].split.stem_track;
      const accompaniment = lalalResponse.result[fileId].split.back_track;
      return { vocals, accompaniment };
    } catch (error) {
      console.error('separateAudioInTwoParts failed:', error);
      throw new Error('Failed to separate audio into two parts.');
    }
  }
}
