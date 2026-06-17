"""Deepgram TTS for FormIQ — speaks coaching feedback aloud after each rep.

Synthesis goes through Deepgram's REST ``/v1/speak`` endpoint (stable across SDK
versions). Playback happens on a background thread so the per-rep feedback loop
is never blocked waiting on audio. If ``DEEPGRAM_API_KEY`` is unset or synthesis
fails, this degrades to a silent no-op.
"""

from __future__ import annotations

import os
import platform
import shutil
import subprocess
import tempfile
import threading
from typing import Optional

import requests

DEEPGRAM_TTS_URL = "https://api.deepgram.com/v1/speak"
DEFAULT_VOICE = os.getenv("DEEPGRAM_TTS_MODEL", "aura-asteria-en")


class Voice:
    """Synthesizes and plays short coaching lines.

    Designed for a local single-user app: audio is rendered to a temp MP3 and
    played through the OS audio output on a daemon thread.
    """

    def __init__(self, api_key: Optional[str] = None, voice: str = DEFAULT_VOICE) -> None:
        self._api_key = api_key or os.getenv("DEEPGRAM_API_KEY")
        self._voice = voice
        self._enabled = bool(self._api_key)
        if not self._enabled:
            print("[voice] DEEPGRAM_API_KEY not set; TTS disabled (silent mode).")

    def synthesize(self, text: str) -> Optional[bytes]:
        """Return MP3 bytes for ``text`` (or None if disabled / on failure)."""
        if not self._enabled or not text.strip():
            return None
        try:
            resp = requests.post(
                DEEPGRAM_TTS_URL,
                params={"model": self._voice, "encoding": "mp3"},
                headers={
                    "Authorization": f"Token {self._api_key}",
                    "Content-Type": "application/json",
                },
                json={"text": text},
                timeout=10,
            )
            resp.raise_for_status()
            return resp.content
        except requests.RequestException as exc:
            print(f"[voice] TTS request failed: {exc}")
            return None

    def speak(self, text: str) -> None:
        """Synthesize and play ``text`` without blocking the caller."""
        if not self._enabled:
            return
        threading.Thread(target=self._speak_blocking, args=(text,), daemon=True).start()

    def _speak_blocking(self, text: str) -> None:
        audio = self.synthesize(text)
        if not audio:
            return
        try:
            with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
                f.write(audio)
                path = f.name
            self._play_file(path)
        except Exception as exc:  # noqa: BLE001 - playback is best-effort
            print(f"[voice] playback failed: {exc}")
        finally:
            try:
                os.unlink(path)
            except (OSError, NameError):
                pass

    @staticmethod
    def _play_file(path: str) -> None:
        """Play an audio file using whatever player the OS provides."""
        system = platform.system()
        if system == "Darwin" and shutil.which("afplay"):
            subprocess.run(["afplay", path], check=False)
            return
        if system == "Linux":
            for player in ("ffplay", "mpg123", "aplay"):
                if shutil.which(player):
                    args = [player, "-nodisp", "-autoexit", path] if player == "ffplay" else [player, path]
                    subprocess.run(args, check=False)
                    return
        if system == "Windows":
            # PowerShell media player fallback.
            subprocess.run(
                ["powershell", "-c", f"(New-Object Media.SoundPlayer '{path}').PlaySync();"],
                check=False,
            )
            return
        # Last resort: try the simpleaudio library if installed.
        try:
            import simpleaudio  # type: ignore

            wave = simpleaudio.WaveObject.from_wave_file(path)
            wave.play().wait_done()
        except Exception:  # noqa: BLE001
            print("[voice] no usable audio player found; skipping playback.")
