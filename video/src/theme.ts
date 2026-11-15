// Tokens copied from apps/web/src/design/obsidian-theme.css ("Deep Space Obsidian").
import { loadFont as loadDisplay } from "@remotion/google-fonts/ChakraPetch";
import { loadFont as loadSans } from "@remotion/google-fonts/PlusJakartaSans";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";
import { Easing } from "remotion";

export const display = loadDisplay("normal", { weights: ["600", "700"], subsets: ["latin"] }).fontFamily;
export const sans = loadSans("normal", { weights: ["400", "600"], subsets: ["latin"] }).fontFamily;
export const mono = loadMono("normal", { weights: ["500"], subsets: ["latin"] }).fontFamily;

export const C = {
  void: "#000000",
  panel: "#0d0d0d",
  raised: "#171717",
  line: "#292929",
  ink: "#ffffff",
  soft: "#dddddd",
  muted: "#a3a3a3",
  ember: "#ff7a1a",
  blue: "#4fa8ff",
  ice: "#8fe3ff",
  violet: "#a78bfa",
};

export const FPS = 30;
// Bars of the music track (4 beats at ~123 BPM), measured with librosa from bgm.mp3.
export const BAR = [0, 60, 119, 178, 238, 296, 355, 412, 471, 529, 586, 642, 700, 756, 813, 870, 900];

// "Professional, trustworthy" motion preset: no overshoot.
export const easeOut = Easing.bezier(0, 0, 0.2, 1);
export const easeCam = Easing.bezier(0.33, 0, 0.15, 1);
