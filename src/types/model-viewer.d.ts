import type React from "react";
import type { DetailedHTMLProps, HTMLAttributes } from "react";

type ModelViewerAttributes = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
  src?: string;
  alt?: string;
  poster?: string;
  "camera-controls"?: boolean | "";
  "auto-rotate"?: boolean | "";
  "shadow-intensity"?: string;
  exposure?: string;
  "interaction-prompt"?: string;
  "disable-tap"?: boolean | "";
  loading?: "auto" | "lazy" | "eager";
  reveal?: "auto" | "manual";
  "camera-orbit"?: string;
  "camera-target"?: string;
  "field-of-view"?: string;
  "min-camera-orbit"?: string;
  "max-camera-orbit"?: string;
  "disable-pan"?: boolean | "";
  "touch-action"?: "pan-y" | "pan-x" | "none";
  "rotation-per-second"?: string;
  "environment-image"?: string;
  ref?: React.Ref<ModelViewerElement>;
};

/** The subset of the <model-viewer> element API this app uses. */
export type ModelViewerElement = HTMLElement & {
  cameraOrbit: string;
  fieldOfView: string;
  autoRotate: boolean;
  zoom(steps: number): void;
  jumpCameraToGoal(): void;
  resetTurntableRotation(theta?: number): void;
};

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": ModelViewerAttributes;
    }
  }
}
