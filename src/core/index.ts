import { AudioUtils } from '../ffmpeg/audio-utils';
import { Helpers } from '../utils/helpers';
import { Transcriber } from '../transcription/transcriber';
import type { AllowedLanguages, AudioOriginalLangAllowed, TranscriptionDataTypes } from '../types';
import { Formatter } from '../transcription/formatter';
import { TextTranslator } from '../transcription/textTranslator';
import { Spleeter } from '../separator/spleeter';
import { SpeechGenerator } from '../speech/speechGenerator';
import { Adaptation } from '../smart-sync/adaptation';
import { VideoUtils } from '../ffmpeg/video-utils';

export const translate = async () => {
  const targetLanguage = (process.env.TARGET_LANGUAGE || 'english') as AllowedLanguages;
  const debugMode = process.env.DEBUG_MODE || 'false';
  const numberOfSpeakers = process.env.NUM_SPEAKERS || 'auto-detect';
  const activateLipSync = process.env.APPLY_LIPSYNC || 'false';
  const activateSubtitle = process.env.ACTIVATE_SUBTITLE || 'false';

  let clonedVoicesIdsToDelete: string[] = [];

  const transcriptionData: TranscriptionDataTypes = {
    summary: null,
    formattedSegments: [],
    detectedAudioLanguage: null,
  };

  if (debugMode === 'false') console.debug = () => {};

  Helpers.verifyPrerequisitesForDubbing();

  try {
    const inputFilePath = await Helpers.getAllInputFilePaths();
    const fileType = Helpers.getFileType(inputFilePath);

    let videoPathWithoutAudio = null;
    let audioPathWithoutVideo = null;

    if (fileType === 'video') {
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

    transcriptionData.detectedAudioLanguage = transcription.result.transcription
      .languages[0] as AudioOriginalLangAllowed;

    const transcriptionSummary = transcription.result.summarization.results;

    const formattedTranscription = Formatter.formatTranscription(
      transcription,
      transcriptionData.detectedAudioLanguage,
    );

    const translatedTranscription = await TextTranslator.translateTranscriptionInTargetLanguage({
      transcription: formattedTranscription,
      targetLanguage,
      originLanguage: transcriptionData.detectedAudioLanguage,
      transcriptionSummary: transcriptionSummary || '',
    });

    const verifiedTranscription = Helpers.parseAndVerifyTranscriptionDetails(
      JSON.stringify(translatedTranscription),
    );

    const videoLengthRounded = await Helpers.getVideoLength(videoPathWithoutAudio!);

    const { backgroundAudio, vocalsIsolated } = await Spleeter.getSeparateAudio(audioPathWithoutVideo);
    const isolatedVocalsAverageDecibel = await AudioUtils.getAverageDecibel(vocalsIsolated);

    const { allResultsSorted, clonedVoicesIds } = await SpeechGenerator.getSpeechArrayFromTranscriptions({
      segments: verifiedTranscription,
      targetLanguage,
      isolatedVocalsPath: vocalsIsolated,
    });

    clonedVoicesIdsToDelete = Object.values(clonedVoicesIds);

    const speechWithDuration = await SpeechGenerator.getEachSpeechDuration({
      speechArray: allResultsSorted,
      transcriptions: verifiedTranscription,
    });

    const speechesWithoutSilence =
      await SpeechGenerator.removeStartAndEndSilenceFromAllAudio(speechWithDuration);

    const adaptedSpeeches = await Adaptation.compareAndAdjustSpeeches({
      transcriptions: verifiedTranscription,
      speeches: speechesWithoutSilence,
      clonedVoicesIds,
      originalLanguage: transcriptionData.detectedAudioLanguage,
      targetLanguage,
      transcriptionSummary,
    });

    const finalVoicesAudioTrack =
      await SpeechGenerator.createAndAssembleSeparateAudioTracksEachSpeaker(adaptedSpeeches);

    const equalizedAudio = await AudioUtils.startEqualizeAudio(finalVoicesAudioTrack);

    await AudioUtils.adjustAudioToDecibel(equalizedAudio, isolatedVocalsAverageDecibel);

    const mergedAudio = await SpeechGenerator.overlayAudioAndBackgroundMusic(equalizedAudio, backgroundAudio);

    const finalContent =
      fileType === 'audio'
        ? mergedAudio
        : await VideoUtils.getAudioMergeWithVideo(videoPathWithoutAudio!, mergedAudio);

    console.log(finalContent);
  } catch (error) {
    if (error instanceof Error) {
      console.error('Error:', error.message);
    } else {
      console.error('Error:', error);
    }
  }
};

translate();
