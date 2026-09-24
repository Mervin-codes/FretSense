# FretSense

**FretSense** is a multi-instrument song analysis and practice app for **Android and Windows**. It is designed for guitarists, keyboard players, ukulele players, and violinists who want to turn a song into something they can practice: chords, tempo, key, capo shapes, transposition, strumming/rhythm guidance, scales, melody/tab estimates, loops, and practice tools.

> Current public source version: **5.2.3**

## Platforms

- **Android** — standalone Android Studio project in [`android/`](android/)
- **Windows** — desktop app in [`windows/`](windows/) using the same FretSense UI and music logic

The normal chord/key/BPM analysis is local. Optional AI guitar isolation downloads an external model the first time it is used.

## Main features

- Song upload and local analysis
- Original song chord detection
- Key and BPM detection
- Beat-synced chord timeline
- Manual chord correction
- Transpose controls synchronized across timeline, Play Now, Practice and chord diagrams
- Manual capo selector with playable shapes
- Active chord diagram + separate sounding-chord information
- Guitar, Keyboard, Ukulele and Violin modes
- Strumming/rhythm studio
- Slow playback and A/B looping
- Melody-to-tab / note estimate
- Scale finder and fretboard / instrument views
- Chromatic tuner
- Metronome
- Live chord recognition
- Local song library and setlists
- Fast local guitar-focus isolation
- Optional AI guitar isolation and no-guitar backing track
- Premium dark/bronze interface

## Important accuracy note

Automatic transcription is an **estimate**, not a replacement for a human transcription. Dense mixes, vocals, bass, effects, inversions and unusual chord voicings can reduce accuracy. FretSense intentionally includes manual chord correction.

## Windows — easiest installation

1. Download or clone this repository.
2. Open the `windows` folder.
3. Double-click `INSTALL_WINDOWS.bat`.
4. After setup, use `RUN_FRETSENSE.bat`.

Requirements:

- Windows 10/11
- Python 3.10 or newer
- Microsoft Edge WebView2 Runtime (normally already installed on modern Windows)

If microphone permissions do not work inside the desktop shell, use `RUN_IN_BROWSER.bat`; the same local FretSense app opens in your normal browser.

### Build a shareable Windows EXE

After normal Windows setup, run:

```bat
BUILD_EXE.bat
```

The result is created under:

```text
windows\dist\FretSense\FretSense.exe
```

Share the **whole `FretSense` folder**, not only the `.exe` file.

## Android

1. Install Android Studio.
2. Open the `android` directory as the project root.
3. Let Gradle Sync finish.
4. Connect an Android device with USB debugging enabled.
5. Press **Run**.

To build an APK in Android Studio:

```text
Build → Build App Bundle(s) / APK(s) → Build APK(s)
```

## How transpose + capo are intended to work

FretSense keeps the detected song chords as the original source. When you intentionally transpose the song, the active chord timeline, Play Now chord, Practice mode and chord diagram follow that new key. When you choose a capo, the app can additionally show the physical chord shape you should play and the chord that will sound.

Example:

```text
Sounding chord: A#m
Capo: 1
Shape to play: Am
```

## Repository structure

```text
FretSense/
├── android/              Android Studio project
├── windows/              Windows desktop source/build scripts
│   ├── app/              Shared FretSense HTML/CSS/JS UI
│   ├── assets/
│   ├── INSTALL_WINDOWS.bat
│   ├── RUN_FRETSENSE.bat
│   ├── RUN_IN_BROWSER.bat
│   ├── BUILD_EXE.bat
│   └── fretsense_windows.py
├── assets/               Branding assets
├── docs/
├── .github/workflows/    Automated Windows build
├── LICENSE
└── README.md
```

## GitHub Actions

The included workflow builds the Windows app on GitHub's Windows runner and uploads a `FretSense-Windows` artifact. Push a version tag such as `v5.2.3` to also create a GitHub Release containing the Windows ZIP.

## Privacy

Normal analysis is performed locally. Audio is not intentionally uploaded to a FretSense server. Optional AI isolation requires downloading runtime/model files from third-party hosting on first use.

## Third-party components

FretSense uses or can download third-party components including:

- `pywebview` for the Windows desktop shell
- `onnxruntime-web` for optional on-device/local AI inference
- an external HT-Demucs-compatible model for optional guitar isolation

Those projects/models have their own licenses and terms. Review them before redistributing a bundled model. This repository does **not** bundle the large AI model.

## Contributing

Bug reports and pull requests are welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

FretSense source code in this repository is released under the **MIT License**. Third-party libraries and downloadable models remain under their respective licenses.
