import { AudioUtils } from '../ffmpeg/audio-utils';
import { Helpers } from '../utils/helpers';
import { Transcriber } from '../transcription/transcriber';
export const translate = async () => {
  const targetLanguage = process.env.TARGET_LANGUAGE || 'english';
  const debugMode = process.env.DEBUG_MODE || 'false';
  const numberOfSpeakers = process.env.NUM_SPEAKERS || 'auto-detect';
  const activateLipSync = process.env.APPLY_LIPSYNC || 'false';

  if (debugMode === 'false') console.debug = () => {};

  Helpers.verifyPrerequisitesForDubbing();

  try {
    const inputFilePath = await Helpers.getAllInputFilePaths();
    const fileType = Helpers.getFileType(inputFilePath);

    let videoPathWithoutAudio = null;
    let audioPathWithoutVideo = null;

    if (fileType === 'video') {
      // Extract audio from video and set paths
      const { videoPath, audioPath } = await AudioUtils.separateAudioAndVideo(inputFilePath);
      videoPathWithoutAudio = videoPath;
      audioPathWithoutVideo = audioPath;
    } else {
      audioPathWithoutVideo = inputFilePath;
    }

    const transcription = await Transcriber.transcribeAudio({
      audioPath: audioPathWithoutVideo,
      numberOfSpeakers,
    });

    console.log(transcription);
  } catch (error) {
    if (error instanceof Error) {
      console.error('Error:', error.message);
    } else {
      console.error('Error:', error);
    }
  }
};

translate();
