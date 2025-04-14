interface LipSyncResult {
  id: string;
  createdAt: string;
  status: StatusSyncLab;
  model: string;
  input: string;
  webhookUrl: string;
  options: {
    output_format: string;
  };
  outputUrl: string;
  error: null | string;
}

export interface LipSyncResponse {
  id: string;
  createdAt: string;
  status: StatusSyncLab;
  model: string;
  input: string;
  webhookUrl: string;
  options: {
    output_format: string;
  };
  outputUrl: string;
  error: null | string;
}

export interface SyncLabInitialResponse {
  id: string;
  createdAt: string;
  status: 'PENDING';
  videoUrl: string | null;
  originalVideoUrl: string;
  originalAudioUrl: string;
  synergize: boolean;
  creditsDeducted: number | null;
  webhookUrl: string;
  errorMessage: string | null;
  message: string;
}

export interface SynclabInput {
  type: 'video' | 'audio';
  url: string;
  segments_secs?: number[][];
  segments_frames?: number[][];
}

export interface SynclabOptions {
  output_format: 'mp4';
  active_speaker?: boolean;
}

export interface SynclabV2RequestBody {
  model: string;
  input: SynclabInput[];
  options: SynclabOptions;
  webhookUrl?: string;
}

export interface SynclabRequestBody {
  audioUrl: string;
  videoUrl: string;
  model: string;
  webhookUrl?: string;
  synergize?: boolean;
  pads?: number;
  maxCredits?: number;
}

export type StatusSyncLab = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'REJECTED' | 'CANCELED';
