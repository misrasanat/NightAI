from typing import Any, Dict, List, Optional
import json
# pyrefly: ignore [missing-import]
import google.generativeai as genai
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.config import get_settings
from app.agents.base import BaseAgent, AgentResponse
from app.db.database import InteractionLog, UserPreferences, engine
from app.agents.communication import CommunicationAgent


class AudioRoutingDecision(BaseModel):
    transcript: str = Field(description="Exact speech-to-text transcription of the audio")
    intent: str = Field(description="The matching intent (e.g., MusicIntent, CalendarIntent, NotesIntent, EmailIntent, GeneralChatIntent)")
    agent: Optional[str] = Field(None, description="The agent to route to: MusicAgent, CalendarAgent, NotesAgent, CommunicationAgent, or null")
    action: str = Field(description="The action name matching the agent actions, or 'chat' for GeneralChatIntent")
    params: Dict[str, Any] = Field(default_factory=dict, description="Parameters object required for the action")
    response: Optional[str] = Field(None, description="The conversational chat response to return to the user if action is 'chat' or routing is not triggered / agent is inactive")
    explanation: str = Field(description="Brief reasoning behind the routing decision")


class RoutingDecision(BaseModel):
    intent: str = Field(description="The matching intent (e.g., MusicIntent, CalendarIntent, NotesIntent, EmailIntent, GeneralChatIntent)")
    agent: Optional[str] = Field(None, description="The agent to route to: MusicAgent, CalendarAgent, NotesAgent, CommunicationAgent, or null")
    action: str = Field(description="The action name matching the agent actions, or 'chat' for GeneralChatIntent")
    params: Dict[str, Any] = Field(default_factory=dict, description="Parameters object required for the action")
    response: Optional[str] = Field(None, description="The conversational chat response to return to the user if action is 'chat' or routing is not triggered / agent is inactive")
    explanation: str = Field(description="Brief reasoning behind the routing decision")


def clean_schema(schema: Any) -> Any:
    """Recursively removes unsupported schema fields like 'default' and 'title',

    and simplifies union/optional types (anyOf) to make them Gemini-compatible.
    """
    if isinstance(schema, dict):
        if "anyOf" in schema:
            # Simplify anyOf by selecting the first non-null type
            subschemas = schema["anyOf"]
            non_null_subschema = next((s for s in subschemas if s.get("type") != "null"), None)
            if non_null_subschema:
                cleaned_sub = clean_schema(non_null_subschema)
                new_schema = {k: v for k, v in schema.items() if k != "anyOf"}
                new_schema.update(cleaned_sub)
                schema = new_schema
            else:
                schema = subschemas[0]

        keys_to_remove = ["default", "$defs", "definitions", "title", "additionalProperties"]
        return {k: clean_schema(v) for k, v in schema.items() if k not in keys_to_remove}
    elif isinstance(schema, list):
        return [clean_schema(item) for item in schema]
    return schema


class ControllerBrain:
    """Orchestrator class responsible for intent classification, agent routing,
    and response synthesis.
    """

    def __init__(self):
        current_settings = get_settings()
        self.api_key = current_settings.GEMINI_API_KEY
        if self.api_key:
            genai.configure(api_key=self.api_key)
        self.agents: Dict[str, BaseAgent] = {}
        self.register_agent(CommunicationAgent())

    def register_agent(self, agent: BaseAgent):
        """Registers a specialized action agent in the system."""
        self.agents[agent.name] = agent
        print(f"Registered agent: {agent.name}")

    def get_system_capabilities_status(self) -> str:
        """Dynamically generates a capabilities status message based on registered
        agents and environment configuration.
        """
        status_lines = []
        current_settings = get_settings()
        
        # Communication Check
        has_google_sync = False
        try:
            with Session(engine) as session:
                statement = select(UserPreferences).where(UserPreferences.key == "google_refresh_token")
                pref = session.exec(statement).first()
                if pref and pref.value:
                    has_google_sync = True
        except Exception as e:
            print(f"Database read failed in capability check: {e}")

        # CommunicationAgent
        status_lines.append(
            f"- CommunicationAgent: {'ACTIVE (Google Sync Connected - can draft/list/send emails)' if has_google_sync else 'INACTIVE (Google Sync Disconnected - user must link Google in Settings)'}"
        )
        
        # CalendarAgent
        has_calendar = "CalendarAgent" in self.agents
        status_lines.append(
            f"- CalendarAgent: {'ACTIVE (can read/write Google Calendar)' if (has_calendar and has_google_sync) else 'INACTIVE (Calendar Agent not registered yet)'}"
        )
        
        # MusicAgent
        has_music = "MusicAgent" in self.agents
        has_spotify = bool(current_settings.SPOTIFY_CLIENT_ID and current_settings.SPOTIFY_CLIENT_SECRET)
        status_lines.append(
            f"- MusicAgent: {'ACTIVE (Spotify playback enabled)' if (has_music and has_spotify) else 'INACTIVE (Spotify client credentials not configured in backend .env)'}"
        )
        
        # NotesAgent
        has_notes = "NotesAgent" in self.agents
        has_notion = bool(current_settings.NOTION_API_KEY and current_settings.NOTION_DATABASE_ID)
        status_lines.append(
            f"- NotesAgent: {'ACTIVE (Notion synchronization enabled)' if (has_notes and has_notion) else 'INACTIVE (Notion credentials not configured in backend .env)'}"
        )
        
        return "\n".join(status_lines)

    def get_recent_conversation_history(self) -> str:
        """Fetches the last few messages from InteractionLog to act as chat history."""
        try:
            with Session(engine) as session:
                statement = select(InteractionLog).order_by(InteractionLog.timestamp.desc()).limit(5)
                logs = session.exec(statement).all()
                if not logs:
                    return "No previous conversation history."
                
                # Reverse logs to chronological order
                logs.reverse()
                history_lines = []
                for log in logs:
                    history_lines.append(f"User: {log.user_query}")
                    history_lines.append(f"Assistant: {log.response}")
                return "\n".join(history_lines)
        except Exception as e:
            print(f"Error fetching conversation history: {e}")
            return "No previous conversation history."

    async def classify_audio_intent(self, audio_bytes: bytes, mime_type: str = "audio/m4a", context: Dict[str, Any] = None) -> Dict[str, Any]:
        """Classifies audio input directly into transcript, intent, agent, action, and arguments in a single pass."""
        if context is None:
            context = {}

        current_settings = get_settings()
        api_key = current_settings.GEMINI_API_KEY
        if not api_key:
            return {
                "transcript": "Error: Gemini API key not configured.",
                "intent": "GeneralChatIntent",
                "agent": None,
                "action": "chat",
                "params": {"response": "Gemini API key not configured."},
                "explanation": "Gemini API key not configured.",
            }

        genai.configure(api_key=api_key)
        capabilities_status = self.get_system_capabilities_status()
        history = self.get_recent_conversation_history()

        try:
            generation_config = {
                "response_mime_type": "application/json",
                "response_schema": clean_schema(AudioRoutingDecision.model_json_schema())
            }

            system_instruction = (
                "You are the Controller Brain of NightAI, a personal operating system voice assistant named 'Night'.\n"
                "Your job is to transcribe the spoken audio EXACTLY into 'transcript', analyze the user's query, and output a structured JSON routing decision.\n\n"
                "System State & Context:\n"
                f"- User's Local Time: {context.get('local_time', 'Unknown')}\n"
                f"- Current App Screen: {context.get('current_screen', 'VoiceScreen')}\n"
                f"- System Capabilities Status:\n{capabilities_status}\n\n"
                f"- Recent Conversation History:\n{history}\n\n"
                "Output EXACTLY this JSON structure:\n"
                "{\n"
                "  \"transcript\": string (exact speech-to-text transcript of audio),\n"
                "  \"intent\": \"MusicIntent\" | \"CalendarIntent\" | \"NotesIntent\" | \"EmailIntent\" | \"GeneralChatIntent\",\n"
                "  \"agent\": \"MusicAgent\" | \"CalendarAgent\" | \"NotesAgent\" | \"CommunicationAgent\" | null,\n"
                "  \"action\": string (action name),\n"
                "  \"params\": object (parameters),\n"
                "  \"response\": string (conversational response as 'Night'),\n"
                "  \"explanation\": string (reasoning)\n"
                "}"
            )

            audio_part = {
                "mime_type": mime_type,
                "data": audio_bytes
            }
            primary_model = getattr(current_settings, "GEMINI_MODEL", "gemini-2.0-flash")
            models_to_try = [primary_model, "gemini-1.5-flash", "gemini-1.5-pro"]
            response = None
            last_err = None

            for m_name in models_to_try:
                try:
                    model = genai.GenerativeModel(
                        m_name,
                        generation_config=generation_config,
                        system_instruction=system_instruction
                    )
                    response = await model.generate_content_async([audio_part, prompt])
                    if response and response.text:
                        break
                except Exception as m_err:
                    last_err = m_err
                    print(f"Gemini model {m_name} call failed: {m_err}. Trying fallback...")
                    continue

            if not response or not response.text:
                raise last_err or Exception("All Gemini models failed to respond.")

            raw_text = response.text.strip()
            start_idx = raw_text.find("{")
            end_idx = raw_text.rfind("}")

            if start_idx != -1 and end_idx != -1:
                clean_json = raw_text[start_idx:end_idx + 1]
            else:
                clean_json = raw_text

            parsed_result = json.loads(clean_json)
            return parsed_result

        except Exception as e:
            print(f"Single-pass audio classification failed: {e}")
            return {
                "transcript": "Error processing command.",
                "intent": "GeneralChatIntent",
                "agent": None,
                "action": "chat",
                "params": {"response": f"I heard your command, but Gemini AI quota is cooling down: {str(e)}"},
                "explanation": f"API quota exception: {str(e)}",
            }

    async def classify_intent(self, text: str, context: Dict[str, Any] = None) -> Dict[str, Any]:
        """Classifies user speech-to-text input into an intent, choosing an agent,
        action, and arguments, taking user state context and history into account.
        """
        if context is None:
            context = {}

        current_settings = get_settings()
        api_key = current_settings.GEMINI_API_KEY
        if not api_key:
            return {
                "intent": "GeneralChatIntent",
                "agent": None,
                "action": "chat",
                "params": {"response": f"Gemini API key not configured. Echoing: {text}"},
                "explanation": "Gemini API key not configured. Offline mode/fallback active.",
            }

        genai.configure(api_key=api_key)
        capabilities_status = self.get_system_capabilities_status()
        history = self.get_recent_conversation_history()

        try:
            # Tell Gemini to return a structured JSON response matching the schema
            generation_config = {
                "response_mime_type": "application/json",
                "response_schema": clean_schema(RoutingDecision.model_json_schema())
            }

            system_instruction = (
                "You are the Controller Brain of NightAI, a personal operating system voice assistant named 'Night'.\n"
                "Your job is to analyze the user's query and output a structured JSON routing decision.\n\n"
                "System State & Context:\n"
                f"- User's Local Time: {context.get('local_time', 'Unknown')}\n"
                f"- Current App Screen: {context.get('current_screen', 'VoiceScreen')}\n"
                f"- System Capabilities Status:\n{capabilities_status}\n\n"
                f"- Recent Conversation History:\n{history}\n\n"
                "Routing & Capability Rules:\n"
                "1. If the user asks about your capabilities, what you can do, what agents are active, or if you can perform a specific task:\n"
                "   - Route to 'GeneralChatIntent' and action 'chat'.\n"
                "   - In the 'response' parameter, summarize what you can do (active agents) and what you cannot do (inactive agents) using the System Capabilities Status above. Speak in a helpful, conversational voice as 'Night'.\n"
                "2. If the user asks you to perform an action for an INACTIVE agent (e.g. play a song but MusicAgent is inactive, or read calendar when CalendarAgent is inactive):\n"
                "   - Route to 'GeneralChatIntent' and action 'chat'.\n"
                "   - In the 'response' parameter, explain politely that this capability is currently inactive or not set up, and guide them on what needs to be linked (e.g., Google or Spotify in Settings) to activate it.\n"
                "3. If the user asks you to do something that corresponds to an ACTIVE agent (e.g. send an email using CommunicationAgent when Google Sync is active), route it correctly to that agent and action.\n\n"
                "Available agents, actions, and schemas:\n"
                "1. MusicAgent:\n"
                "   - Description: Controls Spotify playback, playlists, volume, and search.\n"
                "   - Actions:\n"
                "     - 'play_music': plays a playlist, artist, album, or song. Params: {'query': string, 'type': 'playlist' | 'track' | 'artist'}\n"
                "     - 'pause_music': pauses playback. Params: {}\n"
                "     - 'volume_control': adjust volume. Params: {'volume': integer (0 to 100)}\n"
                "2. CalendarAgent:\n"
                "   - Description: Reads, creates, or modifies events on Google Calendar.\n"
                "   - Actions:\n"
                "     - 'read_calendar': gets today's agenda or upcoming week schedule. Params: {'timeframe': 'today' | 'week'}\n"
                "     - 'create_event': schedules a new event. Params: {'title': string, 'start_time': ISO datetime string, 'duration_minutes': integer}\n"
                "3. NotesAgent:\n"
                "   - Description: Adds notes, tasks, or retrieves information from Notion or a local database.\n"
                "   - Actions:\n"
                "     - 'create_note': adds a new note or task. Params: {'content': string, 'category': string}\n"
                "     - 'get_notes': search past notes. Params: {'search_query': string}\n"
                "4. CommunicationAgent:\n"
                "   - Description: Handles sending emails, checking recent emails, drafting templates, or checking Slack.\n"
                "   - Actions:\n"
                "     - 'send_email': sends an email. Params: {'recipient': string, 'body': string, 'subject': string}\n"
                "     - 'list_emails': retrieves/lists recent emails. Params: {'max_results': integer (default 5), 'query': string (optional search/filter query like 'is:unread')}\n"
                "5. GeneralChatIntent (No Agent):\n"
                "   - Description: Basic conversation, greetings, jokes, general knowledge, explaining capabilities, or when no active agent matches.\n"
                "   - Actions:\n"
                "     - 'chat': returns a natural text response to the user. Params: {'response': string (conversational response to satisfy the user query)}\n\n"
                "Output EXACTLY this JSON structure:\n"
                "{\n"
                "  \"intent\": \"MusicIntent\" | \"CalendarIntent\" | \"NotesIntent\" | \"EmailIntent\" | \"GeneralChatIntent\",\n"
                "  \"agent\": \"MusicAgent\" | \"CalendarAgent\" | \"NotesAgent\" | \"CommunicationAgent\" | null,\n"
                "  \"action\": string (the action name matching above),\n"
                "  \"params\": object (parameters as defined above),\n"
                "  \"explanation\": string (brief reasoning behind routing decision)\n"
                "}"
            )

            model_name = getattr(current_settings, "GEMINI_MODEL", "gemini-2.0-flash")
            model = genai.GenerativeModel(
                model_name,
                generation_config=generation_config,
                system_instruction=system_instruction
            )
            
            response = await model.generate_content_async(text)
            
            # Robust JSON extraction: locate the outermost curly braces
            raw_text = response.text.strip()
            start_idx = raw_text.find("{")
            end_idx = raw_text.rfind("}")
            
            if start_idx != -1 and end_idx != -1:
                clean_json = raw_text[start_idx:end_idx + 1]
            else:
                clean_json = raw_text
                
            parsed_result = json.loads(clean_json)
            return parsed_result
            
        except Exception as e:
            return {
                "intent": "ErrorIntent",
                "agent": None,
                "action": "error",
                "params": {"error": str(e)},
                "explanation": f"Failed to parse query via Gemini: {str(e)}",
            }

    async def execute_audio_workflow(self, audio_bytes: bytes, mime_type: str = "audio/m4a", context: Dict[str, Any] = None) -> tuple[str, AgentResponse]:
        """Main single-pass entry point for audio. Returns (transcript, AgentResponse)."""
        try:
            routing_info = await self.classify_audio_intent(audio_bytes, mime_type, context)
            transcript = routing_info.get("transcript", "")
            
            agent_name = routing_info.get("agent")
            action = routing_info.get("action")
            params = routing_info.get("params", {})

            if action == "chat" or not agent_name or agent_name not in self.agents:
                reply = routing_info.get("response") or params.get("response")
                if not reply or reply.startswith("Acknowledged"):
                    reply = f"I heard you say '{transcript}'. Systems are online and ready — how can I help you?"
                agent_res = AgentResponse(
                    success=True,
                    message="General response generated.",
                    data={"reply": reply, "wake_word_detected": True, "routing": routing_info},
                )
            else:
                agent = self.agents[agent_name]
                try:
                    res = await agent.execute(action, params)
                    res.data["routing"] = routing_info
                    res.data["wake_word_detected"] = True
                    agent_res = res
                except Exception as e:
                    agent_res = AgentResponse(
                        success=False,
                        message=f"Error executing agent {agent_name}: {str(e)}",
                        data={"reply": f"Could not perform action: {str(e)}", "wake_word_detected": True, "routing": routing_info},
                    )

            # Log to SQLite
            log_reply = agent_res.data.get("reply", agent_res.message)
            try:
                with Session(engine) as session:
                    log_entry = InteractionLog(
                        user_query=transcript,
                        intent=routing_info.get("intent", "Unknown"),
                        response=log_reply,
                        success=agent_res.success
                    )
                    session.add(log_entry)
                    session.commit()
            except Exception as db_err:
                print(f"Database logging failed: {db_err}")

            return transcript, agent_res
        except Exception as err:
            print(f"Falling back to 2-step STT pipeline due to: {err}")
            from app.services.stt import STTService
            stt_service = STTService()
            transcript = await stt_service.transcribe_audio_file(audio_bytes, mime_type)
            agent_res = await self.execute_workflow(transcript, context)
            return transcript, agent_res

    async def execute_workflow(self, text: str, context: Dict[str, Any] = None) -> AgentResponse:
        """Main entry point. Receives text, routes to the appropriate agent,
        logs the execution in the database, and returns the unified response.
        """
        routing_info = await self.classify_intent(text, context)
        agent_name = routing_info.get("agent")
        action = routing_info.get("action")
        params = routing_info.get("params", {})

        agent_res: AgentResponse

        if action == "chat" or not agent_name or agent_name not in self.agents:
            # Return general conversation response
            if action == "error":
                reply = f"Error processing query: {params.get('error')}"
                agent_res = AgentResponse(
                    success=False,
                    message="Error during intent classification.",
                    data={"reply": reply, "routing": routing_info},
                )
            else:
                reply = routing_info.get("response") or params.get("response")
                if not reply or reply.startswith("Acknowledged"):
                    reply = f"I heard you say '{text}'. Systems are online and ready — how can I help you?"
                agent_res = AgentResponse(
                    success=True,
                    message="General response generated.",
                    data={"reply": reply, "routing": routing_info},
                )
        else:
            agent = self.agents[agent_name]
            try:
                # Execute agent action
                res = await agent.execute(action, params)
                # Inject routing debug details for testing
                res.data["routing"] = routing_info
                agent_res = res
            except Exception as e:
                agent_res = AgentResponse(
                    success=False,
                    message=f"Error executing agent {agent_name}: {str(e)}",
                    data={"reply": f"Could not perform action: {str(e)}", "routing": routing_info},
                )

        # Resolve text reply for logging
        log_reply = agent_res.data.get("reply", agent_res.message)

        # Save record to SQLite
        try:
            with Session(engine) as session:
                log_entry = InteractionLog(
                    user_query=text,
                    intent=routing_info.get("intent", "Unknown"),
                    response=log_reply,
                    success=agent_res.success
                )
                session.add(log_entry)
                session.commit()
        except Exception as db_err:
            print(f"Database logging failed: {db_err}")

        return agent_res
