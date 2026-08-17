import google.generativeai as genai
from app.config import get_settings


class STTService:
    """Service to convert spoken audio into text transcripts."""

    def __init__(self):
        current_settings = get_settings()
        self.api_key = current_settings.GEMINI_API_KEY
        if self.api_key:
            genai.configure(api_key=self.api_key)

    async def transcribe_audio_file(self, audio_bytes: bytes, mime_type: str = "audio/m4a") -> str:
        """Transcribes a raw binary audio file to text using Gemini."""
        current_settings = get_settings()
        api_key = current_settings.GEMINI_API_KEY
        if not api_key:
            return "Error: Gemini API key not configured."

        try:
            genai.configure(api_key=api_key)
            model_name = getattr(current_settings, "GEMINI_MODEL", "gemini-2.0-flash")
            model = genai.GenerativeModel(model_name)
            
            audio_part = {
                "mime_type": mime_type,
                "data": audio_bytes
            }
            
            prompt = (
                "Please transcribe this audio exactly. "
                "Output ONLY the clear, transcribed text. "
                "Do not add any explanations, headers, introductory text, or notes."
            )
            
            response = await model.generate_content_async([audio_part, prompt])
            transcript = response.text.strip()
            return transcript
        except Exception as e:
            print(f"STT transcription failed: {e}")
            return f"Error transcribing audio: {str(e)}"

    async def transcribe_chunk(self, chunk: bytes) -> str:
        """Transcribes a single chunk of audio from a stream."""
        return ""

