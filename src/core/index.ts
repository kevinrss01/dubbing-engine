import { SubtitlesGenerator } from './../subtitles/subtitles-generator';
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
import fsPromises from 'fs/promises';
import fs from 'fs';
import { Lipsync } from '../lipsync/lipsync';
import crypto from 'crypto';

export type DebugMode = 'yes' | 'no';
export type NumberOfSpeakers = 'auto-detect' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10';
export type ActivateLipSync = 'yes' | 'no';
export type ActivateSubtitle = 'yes' | 'no';

export const translate = async () => {
  const targetLanguage = (process.env.TARGET_LANGUAGE || 'english') as AllowedLanguages;
  const debugMode: DebugMode = (process.env.DEBUG_MODE as DebugMode) || 'no';
  const numberOfSpeakers: NumberOfSpeakers = (process.env.NUM_SPEAKERS as NumberOfSpeakers) || 'auto-detect';
  const activateLipSync: ActivateLipSync = (process.env.APPLY_LIPSYNC as ActivateLipSync) || 'no';
  const activateSubtitle: ActivateSubtitle = (process.env.ACTIVATE_SUBTITLE as ActivateSubtitle) || 'yes';

  let clonedVoicesIdsToDelete: string[] = [];

  const transcriptionData: TranscriptionDataTypes = {
    summary: null,
    formattedSegments: [],
    detectedAudioLanguage: null,
  };

  if (debugMode === 'no') {
    console.debug = () => {};
    console.info('Dubbing Started successfully with the following parameters:');
    console.info('Target Language: ', targetLanguage);
    console.info('Debug Mode: ', debugMode);
    console.info('Number of Speakers: ', numberOfSpeakers);
    console.info('Activate Lip Sync: ', activateLipSync);
    console.info('Activate Subtitle: ', activateSubtitle);
  }

  Helpers.verifyPrerequisitesForDubbing();

  let inputFilePath = '';
  let videoPathWithoutAudio = null;
  let audioPathWithoutVideo = null;
  let backgroundAudio = null;
  let vocalsIsolated = null;

  try {
    inputFilePath = await Helpers.getAllInputFilePaths();
    const fileType = Helpers.getFileType(inputFilePath);

    if (fileType === 'video') {
      const { videoPath, audioPath } = await AudioUtils.separateAudioAndVideo(inputFilePath);
      videoPathWithoutAudio = videoPath;
      audioPathWithoutVideo = audioPath;
    } else {
      const audioPathCopy = `temporary-files/original-audio-${crypto.randomUUID()}.wav`;
      await fsPromises.copyFile(inputFilePath, audioPathCopy);
      audioPathWithoutVideo = audioPathCopy;
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

    ({ backgroundAudio, vocalsIsolated } = await Spleeter.getSeparateAudio(audioPathWithoutVideo));
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

    let finalContent =
      fileType === 'audio'
        ? mergedAudio
        : await VideoUtils.getAudioMergeWithVideo(videoPathWithoutAudio!, mergedAudio);

    if (fileType === 'video' && activateSubtitle === 'yes') {
      const filePathVideoSubtitles = await SubtitlesGenerator.addSubtitlesInVideo({
        transcriptionData: verifiedTranscription,
        initialVideoPath: finalContent,
        lang: targetLanguage,
      });

      finalContent = filePathVideoSubtitles;
    }

    if (fileType === 'video' && activateLipSync === 'yes') {
      const lipSyncedVideoUrl = await Lipsync.processLipSyncWithAwsUpload({
        localAudioPath: mergedAudio,
        localVideoPath: finalContent,
      });

      const lipSyncedVideo = await fetch(lipSyncedVideoUrl).then((res) => res.arrayBuffer());
      const lipSyncedVideoBuffer = Buffer.from(lipSyncedVideo);
      const newFilePath = `output/result-${crypto.randomUUID()}.mp4`;
      await fsPromises.writeFile(newFilePath, lipSyncedVideoBuffer);

      finalContent = newFilePath;
    }

    if (fileType === 'video') {
      if (fs.existsSync(mergedAudio)) await fsPromises.unlink(mergedAudio);
    }

    console.info('Translation completed successfully, you can now find your video in the output folder.');
  } catch (error) {
    if (error instanceof Error) {
      console.error('Error:', error.message);
    } else {
      console.error('Error:', error);
    }
  } finally {
    if (videoPathWithoutAudio && fs.existsSync(videoPathWithoutAudio))
      await fsPromises.unlink(videoPathWithoutAudio);
    if (audioPathWithoutVideo && fs.existsSync(audioPathWithoutVideo))
      await fsPromises.unlink(audioPathWithoutVideo);
    if (backgroundAudio && fs.existsSync(backgroundAudio)) await fsPromises.unlink(backgroundAudio);
    if (vocalsIsolated && fs.existsSync(vocalsIsolated)) await fsPromises.unlink(vocalsIsolated);
  }
};

translate();
