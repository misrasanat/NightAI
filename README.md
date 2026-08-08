# NightAI: Personal AI Operating System

NightAI is a personal AI controller that listens, understands, decides, and executes tasks across your digital ecosystem. It acts as the central brain, orchestrating specialized agents to perform actions at ultra-speed.

## Architecture

The project is structured as a monorepo containing:
1. **`mobile/`**: React Native (Expo) client application for voice recording, continuous listening, wake-word detection, and visual user interface.
2. **`backend/`**: Python (FastAPI) backend containing the "Controller Layer" (Gemini routing and orchestrator) and the "Action Layer" (specialized agents for Spotify, Calendar, Notion, Gmail, Web scraping, and Memory).

```
NightAI/
├── mobile/            # React Native Expo Mobile App
│   ├── assets/        # Media and wake-word model files
│   ├── src/
│   │   ├── components/ # Custom visual components
│   │   ├── screens/    # Interface screens (HUD, Settings, etc.)
│   │   ├── services/   # Audio streaming and API integration
│   │   └── navigation/ # React Navigation configuration
│   └── App.tsx
└── backend/           # FastAPI Backend and Agent System
    ├── app/
    │   ├── main.py     # API entry point & WebSocket server
    │   ├── core/       # Brain (Intent classification & LLM agent routing)
    │   ├── agents/     # Specialized Action Agents (Spotify, Gmail, etc.)
    │   ├── services/   # Audio processing (STT / TTS)
    │   └── db/         # SQLite and Vector DB managers
    └── requirements.txt
```

## Quick Start (Local Setup)

### Prerequisites
- Node.js (v18+) & npm/yarn/pnpm
- Python (v3.10+)
- Gemini API Key (stored in backend `.env`)

### 1. Backend Server Setup
Navigate to the `backend/` directory:
```bash
cd backend
python -m venv .venv
# On Windows (PowerShell):
.venv\Scripts\Activate.ps1
# On macOS/Linux:
source .venv/bin/activate

pip install -r requirements.txt
cp .env.example .env
# Fill in your GEMINI_API_KEY and other credentials in .env

# Run development server
uvicorn app.main:app --reload
```

### 2. Mobile App Setup
Navigate to the `mobile/` directory:
```bash
cd mobile
npm install
npm start
```
Use the Expo Go app on your phone, or run an emulator to load the client.

## Wake-Word & Voice Loop
1. **Always-On Wake-Word**: Listens on-device for the command **"Night"**.
2. **Speech-to-Text (STT)**: Activates on wake-word, records voice, and streams audio to the backend.
3. **Brain Controller**: The backend classifies intent (e.g., `MusicIntent`, `CalendarIntent`) and invokes specialized agents.
4. **Action execution**: Backend agents run concurrently (Spotify, Google APIs, Notion) to perform tasks.
5. **Synthesis & Voice Response**: Gemini synthesizes the response, ElevenLabs/Azure converts it to speech, and the mobile app plays the audio feedback.
