FRETSENSE STANDALONE ANDROID v4
================================

This build does NOT require a Windows FretSense engine.

Runs locally on Android:
- Audio upload / decode
- BPM detection
- Key detection
- Beat-synced chord timeline
- Common chords + confidence
- Smart capo finder
- Transpose
- Strumming attack grid + D/U practice suggestion
- Slow playback and A/B looping
- Melody-to-tab beta (short sections)
- Tuner
- Live chord recognition
- Metronome
- Scale / fretboard viewer
- Song library + setlists
- Fast guitar focus + no-guitar backing (DSP)

Optional on-device AI Guitar Isolation:
- HT-Demucs 6-stem ONNX model
- Model downloads once from Hugging Face (~136 MB)
- ONNX WebAssembly runtime downloads/caches on first setup
- AI inference runs on the phone, not on Windows
- Expect high RAM use (around 1 GB model runtime) and slower processing than a PC

ANDROID STUDIO
--------------
1. Open THIS folder, not the app folder.
2. Let Gradle sync finish.
3. Connect phone with USB debugging enabled.
4. Select the phone and press Run.
5. For a debug APK: Build > Build APK(s).

REQUIREMENTS
------------
- Android 8.0+ (API 26+)
- Android System WebView/Chrome reasonably current
- Microphone permission for tuner/live chord
- First AI isolation setup requires internet; Fast DSP does not.

Accuracy note:
Automatic chord, strumming and melody transcription are estimates. Dense mixes can produce mistakes. The timeline supports manual chord correction.
