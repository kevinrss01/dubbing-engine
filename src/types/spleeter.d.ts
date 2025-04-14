interface LalalAPIResponse {
  status: 'success' | 'error';
  result: Result;
}

interface Result {
  [key: string]: SplitDetail;
  archive: SplitDetail;
  batch: SplitDetail;
}

interface SplitDetail {
  status: 'success' | 'error';
  name?: string;
  size?: number;
  duration?: number;
  stem?: string;
  splitter?: 'orion' | 'phoenix';
  preview?: Preview | null;
  split?: any;
  player?: Player | null;
  task?: TaskDetail;
  error?: string;
}

interface Preview {
  duration: number;
  stem_track: string;
  stem_track_size: number;
  back_track: string;
  back_track_size: number;
}

interface Player {
  stem_track: string;
  stem_track_size: number;
  back_track: string;
  back_track_size: number;
}

interface TaskDetail {
  id: string[];
  state: 'success' | 'error' | 'progress' | 'cancelled';
  progress?: number;
  split_id?: string;
  error?: string;
}

interface ApiUploadResponse {
  status: 'success' | 'error';
  id?: string;
  size?: number;
  duration?: number;
  expires?: number;
  error?: string;
}
