import os
import httpx
from app.config import settings


class TTSService:
    """Service to convert text responses into high-quality spoken audio."""

    def __init__(self):
        self.api_key = settings.ELEVEN_LABS_API_KEY
        self.voice_id = settings.ELEVEN_LABS_VOICE_ID

    async def synthesize_speech(self, text: str) -> bytes:
        """Synthesizes text into audio bytes (e.g. MP3) using ElevenLabs.
        
        If no API key is specified, it returns empty bytes or placeholder audio.
        """
        if not self.api_key:
            # Fallback - empty bytes (the mobile client can also use local TTS)
            return b""

        url = f"https://api.elevenlabs.io/v1/text-to-speech/{self.voice_id}"
        headers = {
            "Accept": "audio/mpeg",
            "Content-Type": "application/json",
            "xi-api-key": self.api_key,
        }
        data = {
            "text": text,
            "model_id": "eleven_monolingual_v1",
            "voice_settings": {
                "stability": 0.5,
                "similarity_boost": 0.5
            }
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(url, json=data, headers=headers)
            if response.status_code == 200:
                return response.content
            else:
                print(f"ElevenLabs TTS failed: {response.text}")
                return b""
