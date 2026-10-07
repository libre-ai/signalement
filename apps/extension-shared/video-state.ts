export interface VideoReviewState {
  present: boolean;
  sanitized: boolean;
  played: boolean;
  reviewed: boolean;
  audioIncluded: boolean;
  audioReviewed: boolean;
}
export function videoReadyForExport(state: VideoReviewState): boolean {
  return (
    !state.present ||
    (state.sanitized &&
      state.played &&
      state.reviewed &&
      (!state.audioIncluded || state.audioReviewed))
  );
}
/** Conservative playback evidence, separate from the person's explicit review assertion. */
export class PlaybackReview {
  #continuous = false;
  #position = 0;
  play(position: number): void {
    if (position <= 0.05) {
      this.#continuous = true;
      this.#position = 0;
    }
  }
  seek(): void {
    this.#continuous = false;
  }
  time(position: number, rate: number): void {
    if (rate !== 1 || position < this.#position || position - this.#position > 1.5)
      this.#continuous = false;
    this.#position = position;
  }
  ended(): boolean {
    return this.#continuous && this.#position > 0.1;
  }
}
