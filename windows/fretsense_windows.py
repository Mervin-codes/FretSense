from __future__ import annotations

import contextlib
import os
import socket
import sys
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

APP_NAME = "FretSense"
APP_VERSION = "5.2.3"
ROOT = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
WEB_ROOT = ROOT / "app"


class NoCacheHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, format, *args):
        # Keep the desktop app quiet unless launched from a terminal.
        if os.environ.get("FRETSENSE_DEBUG") == "1":
            super().log_message(format, *args)


def get_app_port() -> int:
    # Keep a stable localhost origin so IndexedDB/localStorage persist between launches.
    # FRETSENSE_PORT can override it for advanced users.
    return int(os.environ.get("FRETSENSE_PORT", "17832"))


def start_server():
    port = get_app_port()
    try:
        server = ThreadingHTTPServer(("127.0.0.1", port), NoCacheHandler)
    except OSError as exc:
        raise RuntimeError(f"FretSense could not use local port {port}. Close any other FretSense instance and try again.") from exc
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, f"http://127.0.0.1:{port}/index.html"


def run_browser(url: str) -> None:
    webbrowser.open(url)
    print(f"{APP_NAME} {APP_VERSION} is running at {url}")
    print("Close this window to stop the local app server.")
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        pass


def main() -> int:
    if not (WEB_ROOT / "index.html").exists():
        print("FretSense app files are missing. Re-extract the complete ZIP.")
        return 2

    server, url = start_server()
    try:
        if "--browser" in sys.argv:
            run_browser(url)
            return 0

        try:
            import webview  # type: ignore
        except Exception:
            print("pywebview is not installed; opening FretSense in your default browser.")
            run_browser(url)
            return 0

        icon_path = str(ROOT / "assets" / "FretSense.ico")
        storage_path = str(Path(os.getenv("LOCALAPPDATA", ROOT)) / "FretSense")
        Path(storage_path).mkdir(parents=True, exist_ok=True)

        webview.settings["ALLOW_DOWNLOADS"] = True
        webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = True

        window = webview.create_window(
            f"{APP_NAME} {APP_VERSION}",
            url,
            width=1360,
            height=860,
            min_size=(960, 640),
            background_color="#07090c",
        )
        # EdgeChromium is preferred on modern Windows. Persistent storage keeps
        # the user's local library and optional AI model cache between launches.
        webview.start(
            gui="edgechromium",
            private_mode=False,
            storage_path=storage_path,
            icon=icon_path if Path(icon_path).exists() else None,
        )
        return 0
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    raise SystemExit(main())
