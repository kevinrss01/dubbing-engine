import type { AxiosResponse } from 'axios';
import type { SyncLabInitialResponse, SynclabV2RequestBody } from '../types/lipsync';
import axios from 'axios';
import fs from 'fs';
import { S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

export class Lipsync {
  static async startLipSync({ audioPath, videoPath }: { audioPath: string; videoPath: string }) {
    try {
      console.debug('Verifying usage links for lip sync...');

      const syncLabResponse = await this.sendLipSyncRequest({
        audioUrl: audioPath,
        videoUrl: videoPath,
      });

      return syncLabResponse;
    } catch (error) {
      console.error(error);
      throw new Error('Error during lip sync request');
    }
  }

  static async sendLipSyncRequest({
    audioUrl,
    videoUrl,
  }: {
    audioUrl: string;
    videoUrl: string;
  }): Promise<SyncLabInitialResponse> {
    const url = 'https://api.sync.so/v2/generate';
    const body: SynclabV2RequestBody = {
      input: [
        {
          type: 'video',
          url: videoUrl,
        },
        {
          type: 'audio',
          url: audioUrl,
        },
      ],
      options: {
        output_format: 'mp4',
        active_speaker: true,
      },
      model: 'lipsync-2',
    };

    const headers = {
      accept: 'application/json',
      'x-api-key': process.env.SYNC_LAB_API_KEY,
      'Content-Type': 'application/json',
    };

    try {
      const response: AxiosResponse<SyncLabInitialResponse> = await axios.post(url, body, {
        headers,
      });

      return response.data as SyncLabInitialResponse;
    } catch (error: any) {
      console.error('Error:', error.response.data);
      throw new Error(`Synclabs error: ${error.message}`);
    }
  }

  static async pollLipSyncResult(
    initialResponse: SyncLabInitialResponse,
    maxAttempts = 600,
    intervalMs = 10000,
  ): Promise<string> {
    let attempts = 0;

    while (attempts < maxAttempts) {
      attempts++;

      try {
        const url = `https://api.sync.so/v2/generate/${initialResponse.id}`;
        const headers = {
          accept: 'application/json',
          'x-api-key': process.env.SYNC_LAB_API_KEY,
        };

        const response = await axios.get(url, { headers });
        const data = response.data;

        if (data.status === 'COMPLETED') {
          if (data.outputUrl) {
            return data.outputUrl;
          } else {
            throw new Error('Output URL is missing from completed response');
          }
        } else if (['FAILED', 'REJECTED', 'CANCELED', 'TIMED_OUT'].includes(data.status)) {
          throw new Error(
            `Lipsync generation failed with status: ${data.status}, error: ${data.error || 'Unknown error'}`,
          );
        }

        console.debug(`Lipsync job status: ${data.status}. Polling again in ${intervalMs / 1000} seconds...`);
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      } catch (error: any) {
        console.error('Error polling lipsync result:', error);
        throw new Error(`Error polling lipsync result: ${error.message}`);
      }
    }

    throw new Error(`Lipsync generation timed out after ${maxAttempts} attempts`);
  }

  static async startLipSyncAndWaitForResult({
    audioPath,
    videoPath,
  }: {
    audioPath: string;
    videoPath: string;
  }): Promise<string> {
    try {
      console.debug('Starting lip sync process...');

      const initialResponse = await this.sendLipSyncRequest({
        audioUrl: audioPath,
        videoUrl: videoPath,
      });

      console.debug(`Lip sync job started with ID: ${initialResponse.id}`);

      const outputUrl = await this.pollLipSyncResult(initialResponse);

      console.debug(`Lip sync completed. Output available at: ${outputUrl}`);
      return outputUrl;
    } catch (error) {
      console.error('Error during lip sync process:', error);
      throw new Error(
        `Failed to complete lip sync process: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  static async processLipSyncWithAwsUpload({
    localVideoPath,
    localAudioPath,
  }: {
    localVideoPath: string;
    localAudioPath: string;
  }): Promise<string> {
    // Check if required environment variables are set
    const requiredEnvVars = [
      'SYNC_LAB_API_KEY',
      'AWS_S3_REGION',
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_BUCKET_NAME',
    ];

    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        throw new Error(`Missing required environment variable: ${envVar}`);
      }
    }

    // Check if files exist
    if (!fs.existsSync(localVideoPath)) {
      throw new Error(`Video file not found at path: ${localVideoPath}`);
    }
    if (!fs.existsSync(localAudioPath)) {
      throw new Error(`Audio file not found at path: ${localAudioPath}`);
    }

    // S3 configuration
    const s3BucketName = process.env.AWS_BUCKET_NAME || '';
    const s3Region = process.env.AWS_S3_REGION || '';

    // Create S3 client
    const s3client = new S3Client({
      region: s3Region,
    });

    // Store S3 file paths for later cleanup
    let videoFileName = '';
    let audioFileName = '';

    try {
      console.debug('Uploading files to AWS S3...');

      // Generate unique file paths for S3
      const timestamp = Date.now();
      videoFileName = `lipsync/video_${timestamp}_${localVideoPath.split('/').pop()}`;
      audioFileName = `lipsync/audio_${timestamp}_${localAudioPath.split('/').pop()}`;

      // Read files as buffers
      const videoBuffer = fs.readFileSync(localVideoPath);
      const audioBuffer = fs.readFileSync(localAudioPath);

      // Upload files to S3
      const [videoUrl, audioUrl] = await Promise.all([
        uploadFileToS3(s3client, s3BucketName, s3Region, videoBuffer, videoFileName),
        uploadFileToS3(s3client, s3BucketName, s3Region, audioBuffer, audioFileName),
      ]);

      console.debug(`Files uploaded successfully. Video URL: ${videoUrl}, Audio URL: ${audioUrl}`);

      // Process the lipsync with the public URLs
      const lipSyncResultUrl = await this.startLipSyncAndWaitForResult({
        videoPath: videoUrl,
        audioPath: audioUrl,
      });

      console.debug(`Lipsync processing complete. Result available at: ${lipSyncResultUrl}`);

      // Clean up local files
      try {
        fs.unlinkSync(localVideoPath);
        fs.unlinkSync(localAudioPath);
        console.debug('Local files deleted successfully');
      } catch (deleteError) {
        console.warn('Failed to delete local files:', deleteError);
        // Continue despite deletion failure
      }

      // Clean up S3 files
      try {
        await Promise.all([
          deleteFileFromS3(s3client, s3BucketName, videoFileName),
          deleteFileFromS3(s3client, s3BucketName, audioFileName),
        ]);
        console.debug('S3 files deleted successfully');
      } catch (deleteError) {
        console.warn('Failed to delete S3 files:', deleteError);
        // Continue despite deletion failure
      }

      return lipSyncResultUrl;
    } catch (error) {
      console.error('Error in lipsync processing with AWS upload:', error);

      // Attempt to clean up S3 files in case of error
      if (videoFileName && audioFileName) {
        try {
          await Promise.all([
            deleteFileFromS3(s3client, s3BucketName, videoFileName),
            deleteFileFromS3(s3client, s3BucketName, audioFileName),
          ]);
          console.debug('S3 files deleted after error');
        } catch (deleteError) {
          console.warn('Failed to delete S3 files after error:', deleteError);
        }
      }

      throw new Error(
        `Failed to process lipsync with AWS: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

/**
 * Helper function to upload a file to S3 and return its public URL
 */
async function uploadFileToS3(
  s3client: S3Client,
  bucketName: string,
  region: string,
  fileBuffer: Buffer,
  filePath: string,
): Promise<string> {
  // Check if file already exists
  try {
    await s3client.send(
      new HeadObjectCommand({
        Bucket: bucketName,
        Key: filePath,
      }),
    );
    // If no error is thrown, file exists
    return `https://${bucketName}.s3.${region}.amazonaws.com/${filePath}`;
  } catch (error: unknown) {
    // File doesn't exist, continue with upload
  }

  // Get expiration date (1 year from now)
  const expirationDate = new Date();
  expirationDate.setFullYear(expirationDate.getFullYear() + 1);

  const uploadParams = {
    Bucket: bucketName,
    Key: filePath.trim(),
    Body: fileBuffer,
    Metadata: {
      'x-amz-meta-expiration-date': expirationDate.toISOString(),
    },
  };

  try {
    const data = await s3client.send(new PutObjectCommand(uploadParams));
    if (!data) {
      throw new Error('Error uploading file to AWS S3');
    }

    return `https://${bucketName}.s3.${region}.amazonaws.com/${filePath.trim()}`;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to upload file: ${errorMessage}`);
  }
}

/**
 * Helper function to delete a file from S3
 */
async function deleteFileFromS3(s3client: S3Client, bucketName: string, filePath: string): Promise<void> {
  try {
    await s3client.send(
      new DeleteObjectCommand({
        Bucket: bucketName,
        Key: filePath,
      }),
    );
    console.debug(`Successfully deleted file from S3: ${filePath}`);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.warn(`Failed to delete file from S3: ${filePath} - ${errorMessage}`);
    throw new Error(`Failed to delete file from S3: ${errorMessage}`);
  }
}
