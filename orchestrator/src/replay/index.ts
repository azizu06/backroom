/** Public replay entry point: deliberately independent of runtime/store bootstrap. */
export type { ReplayRecording, ReplayFrame, ReplayHeader, ReplayState } from './types';
export { createReplayRecorder, parseReplay } from './record';
