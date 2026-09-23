# FretSense for Windows

## Quick start

1. Install Python 3.10+ if needed.
2. Double-click `INSTALL_WINDOWS.bat`.
3. Later, launch with `RUN_FRETSENSE.bat`.

The desktop shell serves the local FretSense interface on `127.0.0.1` and opens it using Windows Edge WebView2 through pywebview. Your FretSense library is stored locally by the browser engine.

### Microphone fallback

If your PC blocks microphone access in the desktop WebView, use `RUN_IN_BROWSER.bat`. Tuner and Live Chord then run in your normal browser while all song analysis still remains local.

### Build EXE

Run `BUILD_EXE.bat`. PyInstaller creates `dist\FretSense\FretSense.exe`.
