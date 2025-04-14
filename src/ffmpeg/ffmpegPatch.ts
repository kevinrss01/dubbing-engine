import ffmpeg from 'fluent-ffmpeg';

/**
 * Applies a temporary workaround to add the 'lavfi' format.
 * This patch adds 'lavfi' to the available formats returned by ffmpeg.
 *
 * @param command - An instance of ffmpeg.FfmpegCommand to patch.
 * @returns The patched ffmpeg command instance.
 */
export function applyLavfiWorkaround(
  command: ffmpeg.FfmpegCommand,
): ffmpeg.FfmpegCommand {
  // Save the original availableFormats function.
  const originalAvailableFormats = command.availableFormats;

  // Override availableFormats to inject the 'lavfi' format.
  command.availableFormats = (callback: (err: any, data: any) => void) => {
    originalAvailableFormats.call(command, (err: any, data: any) => {
      // If lavfi is not present, add it.
      if (!data.lavfi) {
        data.lavfi = {
          canDemux: true, // lavfi can be used as input
          canMux: false, // lavfi cannot be used as output
          description: 'Libavfilter virtual input device',
        };
      }
      callback(err, data);
    });
  };

  return command;
}
