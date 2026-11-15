import React from "react";
import { Composition } from "remotion";
import { FlameAtlasDemo } from "./Main";
import { DURATION60, FlameAtlasDemo60 } from "./Main60";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="FlameAtlasDemo"
      component={FlameAtlasDemo}
      durationInFrames={894}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{ bgm: true }}
    />
    <Composition
      id="FlameAtlasDemo60"
      component={FlameAtlasDemo60}
      durationInFrames={DURATION60}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{ bgm: true }}
    />
  </>
);
