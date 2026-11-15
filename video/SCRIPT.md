# Flame Atlas demo video: voiceover script

Length 29.8 s. Each line fits its shot at a calm pace (about 2.5 words per second).
Start each line at the time shown; small drifts are fine as long as a line ends before the next cut.

| Time | On screen | Voiceover |
| --- | --- | --- |
| 0:00 - 0:04 | "In microgravity, fire behaves differently. So what has NASA actually tested?" | In microgravity, fire behaves differently. So what has NASA actually tested? |
| 0:04 - 0:08 | Flame Atlas logo, then the overview with 24 investigations, 2,009 experiment rows, 303 publications | Flame Atlas turns NASA's combustion records into one place to find out. |
| 0:08 - 0:12 | Mission atmospheres: ISS 21%, then the proposed 34% habitat; "no data at this level" for solids | Pick a cabin atmosphere, and see exactly where the evidence stops. |
| 0:12 - 0:16 | Data analytics: FLEX droplet tests, burn time against droplet size, then one test's summary | Explore every recorded test, down to its source table. |
| 0:16 - 0:21 | Knowledge map: search "smoke", select an experiment, evidence path | Search the knowledge map. Every link traces back to a NASA record. |
| 0:21 - 0:25 | Compare: a flight experiment against a ground study, with the warning highlighted | Compare studies, with a warning whenever their conditions don't match. |
| 0:25 - 0:27 | Research assistant answer with source tags | Ask a question, get answers with sources. |
| 0:27 - 0:30 | Flame Atlas end card | Flame Atlas. Know what's been tested. |

Word count: 72.

## Recording notes

- Record in a quiet room, phone mic 15 to 20 cm from the mouth, one take per line so each can be moved.
- Mix: voice around -14 LUFS; duck the music to about -24 dB under the voice. Use
  `out/flame-atlas-demo-nomusic.mp4` if you want to place the music yourself.
- Keep the final file at 30 s or less (the submission limit). The rendered video is 29.8 s; do not add a tail.

## Facts behind the on-screen claims

- 24 investigations, 2,009 experiment-table rows, 303 publications: the overview header of the app (NASA PSI snapshot, 14 Nov 2026).
- "No data at this level" for solids at 34% O2, highest burned solid at 22.2% (BASS-II): the overview's mission panel.
- FLEX droplet scatter and FLEX-035 summary: the data analytics page, PSI-69 table.
- Compare warning "One is a ground study or analysis, the other a flight experiment": the knowledge map's compatibility check (SAME vs PSI-115).
- The assistant answer is in offline mode (retrieved NASA passages with source tags), not a generated answer.

## Rebuild

```sh
cd video
npm install
npm run render            # with music: out/flame-atlas-demo.mp4
npm run render:nomusic    # without music
npm run studio            # preview and edit
```

### Voiceover version

`out/flame-atlas-demo-voice.mp4` uses the recorded voiceover: noise reduced (spectral gating with a noise
profile from the pauses, about 20 dB lower floor), long pauses inside lines shortened to 0.18 s, sped up 1.13x
(pitch kept), compressed and normalized to -16 LUFS, then placed at `VO_STARTS` in `src/Main.tsx`. The scene cuts
(`SHOTS.at`) were moved to the beat nearest each line, so every scene starts with its line. The music sits at
30% under the voice. The processed voice is `public/audio/voice.wav`; to remix:

```sh
npx remotion render src/index.ts FlameAtlasDemo out/_silent.mp4 --props=nomusic.json --muted
ffmpeg -i out/_silent.mp4 -i public/audio/bgm.mp3 -i public/audio/voice.wav -filter_complex "[1:a]atrim=0:29.8,volume=0.30,afade=t=in:d=0.3,afade=t=out:st=28.8:d=1.0[m];[2:a]aformat=channel_layouts=stereo[v];[m][v]amix=inputs=2:normalize=0,alimiter=limit=0.89[a]" -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -shortest out/flame-atlas-demo-voice.mp4
```

Screens are in `public/captures/`, taken from the local app at 1920x1080 (2x). Cuts sit on the music's bars
(about 123 BPM), listed in `src/theme.ts`.

## 60 s extended cut (no voiceover)

`npm run render:60` renders `out/flame-atlas-demo-60s.mp4` (59.8 s) on `public/audio/bgm60.mp3`, from `src/Main60.tsx`.
It adds two 3D flame chamber scenes recorded from the live site with a real GPU (`public/clips/`):
gravity 0 g to 1 g (sphere to teardrop, then 0.17 g) and chamber oxygen 21% to 34%, plus the burn time
forecaster (PSI-69 droplet, methanol: 12.7 s, 90% interval 5.4 to 20 s). The end card shows flameatlas.percytony.com.

## Audio files are not in the repository

`public/audio/bgm.mp3` (30 s cut), `public/audio/bgm60.mp3` (60 s cut) and `public/audio/voice.wav`
(processed voiceover) are kept out of git for licensing reasons. Put your own files at those paths to render
with sound, or render the silent version with `npm run render:nomusic`.
