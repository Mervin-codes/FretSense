# Contributing to FretSense

Thanks for helping improve FretSense.

## Good contributions

- Reproducible chord-detection bugs
- Better smoothing or key-aware chord scoring
- Instrument chord/fingering data
- Better melody/tab estimation
- Accessibility and mobile/desktop UI fixes
- Performance improvements
- Documentation and tests

## Before opening a bug

Please include:

1. Platform: Android or Windows
2. FretSense version
3. Audio format and approximate song duration
4. What you expected
5. What happened
6. Screenshot or screen recording when useful

Do not upload copyrighted commercial audio to a public GitHub issue unless you have permission to share it. A short self-created test clip is better.

## Pull requests

Keep changes focused. Test `app.js` syntax before opening a PR:

```bash
node --check windows/app/app.js
```

For Android, also perform a Gradle build. For Windows, test both the desktop shell and browser fallback where possible.
