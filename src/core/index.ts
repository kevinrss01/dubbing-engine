import { AudioUtils } from '../ffmpeg/audio-utils';
import { Helpers } from '../utils/helpers';

export const translate = async () => {
  const targetLanguage = process.env.TARGET_LANGUAGE || 'english';
  const debugMode = process.env.DEBUG_MODE || 'false';
  const numberOfSpeakers = process.env.NUM_SPEAKERS || 'auto-detect';
  const activateLipSync = process.env.APPLY_LIPSYNC || 'false';

  if (debugMode === 'false') console.debug = () => {};

  Helpers.verifyPrerequisitesForDubbing();

  const inputFilePath = await Helpers.getAllInputFilePaths();
  const fileType = Helpers.getFileType(inputFilePath);

  let videoPathWithoutAudio = null;
  let audioPathWithoutVideo = null;

  if (fileType === 'video') {
    const { videoPath, audioPath } = await AudioUtils.separateAudioAndVideo(inputFilePath);
  } else {
    audioPathWithoutVideo = inputFilePath;
  }
};

translate();
