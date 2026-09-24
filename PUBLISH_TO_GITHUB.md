# Publish FretSense to GitHub

This repository is already arranged for GitHub. Do not upload generated `.venv`, Android `build/`, Windows `dist/`, APKs, or large model files into the source repository; `.gitignore` excludes them.

## Method 1 — GitHub website + Git commands

### A. Create the repository

1. Sign in to GitHub.
2. Click **New repository**.
3. Suggested name: `FretSense`.
4. Description: `Multi-instrument song analysis and practice app for Android and Windows.`
5. Choose **Public** if you want everyone to see and use it.
6. Do **not** add another README, license, or `.gitignore` because this project already contains them.
7. Create the repository.

### B. Push this folder

Open PowerShell inside this extracted `FretSense_GitHub_Release_v5_2_3` folder and run:

```powershell
git init
git add .
git commit -m "Release FretSense v5.2.3 for Android and Windows"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/FretSense.git
git push -u origin main
```

Replace `YOUR-USERNAME` with your GitHub username.

## Method 2 — GitHub Desktop

1. Open GitHub Desktop.
2. **File → Add local repository**.
3. Select this extracted project folder.
4. If prompted, choose **Create a repository** in this folder.
5. Commit all files with message `Release FretSense v5.2.3`.
6. Click **Publish repository**.
7. Make sure **Keep this code private** is unchecked if you want a public project.

## Create a Windows downloadable release

After the repository is pushed, GitHub Actions will run the included `Build Windows` workflow.

For a proper public release:

```powershell
git tag v5.2.3
git push origin v5.2.3
```

The workflow will build FretSense on a real Windows GitHub runner, zip the desktop application, and attach it to the GitHub Release automatically.

Users can then download the Windows ZIP from the repository's **Releases** page without installing Python.

## Android public download

For Android, build a signed release APK/AAB in Android Studio. Do not commit your signing keystore or its passwords to GitHub. Upload the signed APK manually to the GitHub Release if you want users to sideload it.
