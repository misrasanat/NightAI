from contextlib import asynccontextmanager
import os
import urllib.parse
import json
import base64
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, RedirectResponse
import httpx
from pydantic import BaseModel
from sqlmodel import Session, select

from app.config import settings
from app.db.database import init_db, InteractionLog, UserPreferences, engine
from app.core.brain import ControllerBrain
from app.services.tts import TTSService
from app.services.stt import STTService


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Initialize the relational database schemas
    init_db()
    yield
    # Shutdown: Clean up resources if necessary


app = FastAPI(
    title="NightAI API Server",
    description="The brain controller and agent routing system for NightAI",
    version="1.0.0",
    lifespan=lifespan,
)

# Enable CORS for cross-origin access from mobile simulator and devices
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Core Services
brain = ControllerBrain()
tts = TTSService()
stt = STTService()

# Initialize Local Offline Vosk Wake-Word Model (0 Gemini API calls)
import wave
import subprocess
try:
    from vosk import Model as VoskModel, KaldiRecognizer
    VOSK_MODEL_PATH = os.path.join(os.path.dirname(__file__), "vosk_model")
    if os.path.exists(VOSK_MODEL_PATH):
        vosk_model_instance = VoskModel(VOSK_MODEL_PATH)
        print("Vosk Offline Local Model loaded successfully on Mac CPU!")
    else:
        vosk_model_instance = None
except Exception as vosk_err:
    print(f"Vosk Model initialization note: {vosk_err}")
    vosk_model_instance = None


@app.post("/api/v1/detect-wake-word")
async def detect_wake_word_local(audio: UploadFile = File(...)):
    """Processes incoming audio locally on Mac CPU using Vosk offline STT.
    0 Gemini API Calls. 0 Cloud Cost. 0 Rate Limits.
    """
    if not vosk_model_instance:
        return {"wake_word_detected": False, "transcript": "", "error": "Vosk model not loaded"}

    try:
        audio_bytes = await audio.read()
        temp_input = "/tmp/vosk_input.m4a"
        temp_wav = "/tmp/vosk_input.wav"
        with open(temp_input, "wb") as f:
            f.write(audio_bytes)

        subprocess.run(
            ["afconvert", "-f", "WAVE", "-c", "1", "-d", "LEI16@16000", temp_input, temp_wav],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )

        wf = wave.open(temp_wav, "rb")
        rec = KaldiRecognizer(vosk_model_instance, wf.getframerate())

        transcript_text = ""
        while True:
            data = wf.readframes(4000)
            if len(data) == 0:
                break
            if rec.AcceptWaveform(data):
                res = json.loads(rec.Result())
                transcript_text += " " + res.get("text", "")

        final_res = json.loads(rec.FinalResult())
        transcript_text += " " + final_res.get("text", "")
        wf.close()

        cleaned_text = transcript_text.lower().strip()
        wake_word_detected = any(kw in cleaned_text for kw in ["night", "knight", "nite", "hey night", "hi night", "ok night"])

        return {
            "wake_word_detected": wake_word_detected,
            "transcript": cleaned_text,
            "local_offline": True
        }
    except Exception as err:
        print(f"Local Vosk detection error: {err}")
        return {"wake_word_detected": False, "transcript": "", "error": str(err)}


# API Payload Schemas
class ProcessRequest(BaseModel):
    query: str
    context: dict | None = None


class ProcessResponse(BaseModel):
    success: bool
    message: str
    reply: str
    audio_url: str | None = None


@app.get("/")
def read_root():
    return {"message": "NightAI Brain API Server Running."}


@app.get("/playground", response_class=HTMLResponse)
def get_playground():
    """Serves the interactive developer testing dashboard."""
    filepath = os.path.join(os.path.dirname(__file__), "static", "playground.html")
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Playground HTML not found.")
    with open(filepath, "r", encoding="utf-8") as f:
        return HTMLResponse(content=f.read())


@app.get("/api/v1/logs")
def get_interaction_logs():
    """Retrieves recent system interaction logs from the SQLite database."""
    with Session(engine) as session:
        statement = select(InteractionLog).order_by(InteractionLog.timestamp.desc()).limit(15)
        logs = session.exec(statement).all()
        return logs


@app.get("/api/v1/agents")
def get_active_agents():
    """Lists all registered active agents."""
    return [
        {"name": agent.name, "description": agent.description}
        for agent in brain.agents.values()
    ]


@app.get("/api/v1/settings")
def get_settings():
    """Retrieves all user configurations from SQLite db as key-value pairs."""
    with Session(engine) as session:
        statement = select(UserPreferences)
        results = session.exec(statement).all()
        settings_dict = {pref.key: pref.value for pref in results}
        
        # Dynamically calculate connection statuses
        settings_dict["google_connected"] = "true" if "google_refresh_token" in settings_dict else "false"
        
        return settings_dict


@app.post("/api/v1/settings")
def update_settings(payload: dict):
    """Upserts settings key-value configurations inside the database."""
    with Session(engine) as session:
        for key, val in payload.items():
            # If disconnecting Google
            if key == "google_connected" and val is False:
                # Remove google_refresh_token to disconnect
                stmt_del = select(UserPreferences).where(UserPreferences.key == "google_refresh_token")
                token_record = session.exec(stmt_del).first()
                if token_record:
                    session.delete(token_record)
            
            statement = select(UserPreferences).where(UserPreferences.key == key)
            pref = session.exec(statement).first()
            
            str_val = str(val).lower() if isinstance(val, bool) else str(val)
            
            if pref:
                pref.value = str_val
                session.add(pref)
            else:
                new_pref = UserPreferences(key=key, value=str_val)
                session.add(new_pref)
        session.commit()
        return {"success": True, "message": "Settings updated successfully."}


@app.get("/api/v1/auth/google")
def google_auth_redirect():
    """Redirects the developer/user browser to Google OAuth consent page."""
    if not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_CLIENT_SECRET:
        raise HTTPException(
            status_code=400,
            detail="Google OAuth Credentials (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET) not configured in backend .env"
        )
    
    scopes = [
        "https://www.googleapis.com/auth/calendar",
        "https://www.googleapis.com/auth/gmail.modify"
    ]
    
    params = {
        "client_id": settings.GOOGLE_CLIENT_ID,
        "redirect_uri": settings.GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": " ".join(scopes),
        "access_type": "offline",
        "prompt": "consent"
    }
    
    auth_url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode(params)
    return RedirectResponse(auth_url)


@app.get("/api/v1/auth/google/callback")
async def google_auth_callback(code: str | None = None, error: str | None = None):
    """Exchanges Google auth code for access/refresh tokens and stores it in SQLite."""
    if error:
        return HTMLResponse(
            content=f"<h3>Google Authentication Failed: {error}</h3>",
            status_code=400
        )
    if not code:
        raise HTTPException(status_code=400, detail="Authentication code is missing.")

    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "redirect_uri": settings.GOOGLE_REDIRECT_URI,
                "grant_type": "authorization_code"
            }
        )
        
        if response.status_code != 200:
            return HTMLResponse(
                content=f"<h3>Token Exchange Failed: {response.text}</h3>",
                status_code=400
            )
            
        tokens = response.json()
        refresh_token = tokens.get("refresh_token")
        
        # Save refresh token in database
        with Session(engine) as session:
            stmt = select(UserPreferences).where(UserPreferences.key == "google_refresh_token")
            pref = session.exec(stmt).first()
            
            # Fallback to access_token if refresh_token is not returned
            token_val = refresh_token if refresh_token else tokens.get("access_token")
            
            if pref:
                pref.value = token_val
                session.add(pref)
            else:
                session.add(UserPreferences(key="google_refresh_token", value=token_val))
                
            session.commit()

    success_html = """
    <html>
        <head>
            <title>NightAI Google Sync Setup</title>
            <style>
                body { background-color: #0D0E15; color: #FFFFFF; font-family: -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                .card { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.08); padding: 40px; border-radius: 16px; text-align: center; max-width: 420px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4); }
                h1 { color: #6366F1; margin-bottom: 5px; font-weight: 800; letter-spacing: 1px; }
                h2 { color: #E5E7EB; font-size: 20px; margin-top: 5px; margin-bottom: 20px; }
                p { color: #9CA3AF; line-height: 1.6; font-size: 14px; }
                .success-badge { display: inline-block; background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.3); color: #10B981; font-weight: bold; font-size: 11px; padding: 6px 16px; border-radius: 20px; margin-bottom: 20px; letter-spacing: 1.5px; }
            </style>
        </head>
        <body>
            <div class="card">
                <h1>NIGHTAI</h1>
                <div class="success-badge">SYNC SUCCESSFUL</div>
                <h2>Google Sync Complete</h2>
                <p>Your Google Workspace accounts (Gmail and Calendar) have been successfully linked to NightAI.</p>
                <p>You can now safely close this browser window and return to the mobile application.</p>
            </div>
        </body>
    </html>
    """
    return HTMLResponse(content=success_html)


@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "env": settings.ENV,
        "gemini_configured": settings.GEMINI_API_KEY is not None,
    }


@app.post("/api/v1/process", response_model=ProcessResponse)
async def process_command(request: ProcessRequest):
    if not request.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty.")

    # Process query through intent routing & agent activation
    agent_res = await brain.execute_workflow(request.query, context=request.context)

    # Resolve text reply
    reply = agent_res.data.get("reply", agent_res.message)

    return ProcessResponse(
        success=agent_res.success,
        message=agent_res.message,
        reply=reply,
        audio_url=None,  # Audio generation url hookup in Month 3
    )


@app.post("/api/v1/process-audio")
async def process_audio(
      audio: UploadFile = File(...),
      context: str = Form(None)
):
    """Receives an audio file and executes single-pass transcription + intent routing using ControllerBrain,
    synthesizes speech using TTSService (optional),
    and returns the transcribed text, reply, and optional audio.
    """
    # 1. Read audio bytes
    try:
        audio_bytes = await audio.read()
    except Exception as read_err:
        raise HTTPException(status_code=400, detail=f"Failed to read audio file: {read_err}")
        
    # 2. Parse context if provided
    context_dict = {}
    if context:
        try:
            context_dict = json.loads(context)
        except Exception as json_err:
            print(f"Failed to parse context JSON: {json_err}")

    # 3. Single-pass audio execution (transcribe + route in 1 LLM request)
    mime_type = audio.content_type or "audio/m4a"
    query, agent_res = await brain.execute_audio_workflow(audio_bytes, mime_type=mime_type, context=context_dict)
    
    # 4. Resolve text reply
    reply = agent_res.data.get("reply", agent_res.message)
    
    # 5. Optional: Generate speech via ElevenLabs TTS
    audio_base64 = None
    try:
        tts_audio_bytes = await tts.synthesize_speech(reply)
        if tts_audio_bytes:
            audio_base64 = base64.b64encode(tts_audio_bytes).decode("utf-8")
    except Exception as tts_err:
        print(f"TTS Error: {tts_err}")
        
    wake_word_detected = agent_res.data.get("wake_word_detected", True)

    return {
        "success": agent_res.success,
        "message": agent_res.message,
        "wake_word_detected": wake_word_detected,
        "query": query,
        "reply": reply,
        "audio_base64": audio_base64
    }


@app.websocket("/api/v1/stream")
async def websocket_stream_endpoint(websocket: WebSocket):
    """WebSocket endpoint to process continuous real-time audio streams."""
    await websocket.accept()
    print("Voice stream WebSocket client connected.")
    try:
        while True:
            # Receive raw binary audio chunks
            audio_chunk = await websocket.receive_bytes()
            # Placeholder for chunk processing / VAD / STT pipeline
            await websocket.send_json(
                {"status": "processing", "received_bytes": len(audio_chunk)}
            )
    except WebSocketDisconnect:
        print("Voice stream WebSocket client disconnected.")
