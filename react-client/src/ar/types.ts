/** A marker the scanner just recognised, for drawing its outline over the camera image. */
export interface Detection {
  /** Outline of the marker in pixels of the scanned frame. */
  corners: number[][];
  frameWidth: number;
  frameHeight: number;
  label: string;
}
