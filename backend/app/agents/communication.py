import base64
from email.mime.text import MIMEText
from typing import Any, Dict
import httpx
from sqlmodel import Session, select

from app.config import settings
from app.agents.base import BaseAgent, AgentResponse
from app.db.database import UserPreferences, engine


class CommunicationAgent(BaseAgent):
    """Agent responsible for messaging and sending emails via Google Gmail REST API."""

    @property
    def name(self) -> str:
        return "CommunicationAgent"

    @property
    def description(self) -> str:
        return "Handles sending emails, drafting templates, or checking Slack."

    async def get_access_token(self) -> str:
        """Retrieves and refreshes the Google access token using the stored refresh token."""
        with Session(engine) as session:
            statement = select(UserPreferences).where(UserPreferences.key == "google_refresh_token")
            pref = session.exec(statement).first()
            if not pref or not pref.value:
                raise ValueError("Google account not linked. Please link your Google account in Settings.")
            refresh_token = pref.value

        # If OAuth client ID or secret are missing, fallback to using stored token directly
        if not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_CLIENT_SECRET:
            return refresh_token

        # Call Google Token Endpoint to refresh the token
        url = "https://oauth2.googleapis.com/token"
        data = {
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token"
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(url, data=data)
            if response.status_code == 200:
                tokens = response.json()
                new_refresh = tokens.get("refresh_token")
                if new_refresh:
                    with Session(engine) as session:
                        statement = select(UserPreferences).where(UserPreferences.key == "google_refresh_token")
                        pref_record = session.exec(statement).first()
                        if pref_record:
                            pref_record.value = new_refresh
                            session.add(pref_record)
                            session.commit()
                return tokens["access_token"]
            else:
                print(f"Token refresh failed: {response.text}. Attempting fallback to stored token.")
                return refresh_token

    async def send_email(self, recipient: str, subject: str, body: str) -> AgentResponse:
        """Sends an email using the Gmail REST API."""
        try:
            access_token = await self.get_access_token()
        except ValueError as val_err:
            return AgentResponse(
                success=False,
                message=str(val_err),
                data={"reply": str(val_err)}
            )
        except Exception as e:
            return AgentResponse(
                success=False,
                message=f"Failed to retrieve Google token: {str(e)}",
                data={"reply": f"Google authentication failed: {str(e)}"}
            )

        # Construct MIME Message
        try:
            mime_message = MIMEText(body)
            mime_message["to"] = recipient
            mime_message["subject"] = subject

            # Base64url encode the message content
            raw_bytes = mime_message.as_bytes()
            raw_base64 = base64.urlsafe_b64encode(raw_bytes).decode("utf-8")
        except Exception as msg_err:
            return AgentResponse(
                success=False,
                message=f"Failed to build MIME message: {str(msg_err)}",
                data={"reply": f"Failed to compose email structure: {str(msg_err)}"}
            )

        url = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json"
        }
        payload = {"raw": raw_base64}

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(url, json=payload, headers=headers)
                if response.status_code == 200:
                    res_data = response.json()
                    message_id = res_data.get("id", "unknown_id")
                    reply_text = f"Email successfully sent to {recipient} (Subject: '{subject}')."
                    return AgentResponse(
                        success=True,
                        message=reply_text,
                        data={"reply": reply_text, "gmail_message_id": message_id}
                    )
                else:
                    error_msg = response.text
                    print(f"Gmail send request failed: {error_msg}")
                    # Check if token expired / unauthorized
                    if response.status_code == 401:
                        return AgentResponse(
                            success=False,
                            message="Gmail request unauthorized. Your Google session might have expired. Please reconnect in Settings.",
                            data={"reply": "Unauthorized. Please reconnect Google in Settings."}
                        )
                    return AgentResponse(
                        success=False,
                        message=f"Gmail API error (status {response.status_code}): {error_msg}",
                        data={"reply": f"Gmail service returned an error: {response.status_code}"}
                    )
        except Exception as req_err:
            return AgentResponse(
                success=False,
                message=f"Network error calling Gmail API: {str(req_err)}",
                data={"reply": f"Could not reach Gmail API: {str(req_err)}"}
            )

    async def list_emails(self, max_results: int = 5, query: str = None) -> AgentResponse:
        """Retrieves a list of recent emails from the Gmail API."""
        try:
            access_token = await self.get_access_token()
        except ValueError as val_err:
            return AgentResponse(
                success=False,
                message=str(val_err),
                data={"reply": str(val_err)}
            )
        except Exception as e:
            return AgentResponse(
                success=False,
                message=f"Failed to retrieve Google token: {str(e)}",
                data={"reply": f"Google authentication failed: {str(e)}"}
            )

        url = "https://gmail.googleapis.com/gmail/v1/users/me/messages"
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json"
        }
        params: Dict[str, Any] = {
            "maxResults": max_results
        }
        if query:
            params["q"] = query

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(url, headers=headers, params=params)
                if response.status_code != 200:
                    error_msg = response.text
                    print(f"Gmail list request failed: {error_msg}")
                    if response.status_code == 401:
                        return AgentResponse(
                            success=False,
                            message="Gmail request unauthorized. Your Google session might have expired. Please reconnect in Settings.",
                            data={"reply": "Unauthorized. Please reconnect Google in Settings."}
                        )
                    return AgentResponse(
                        success=False,
                        message=f"Gmail API error (status {response.status_code}): {error_msg}",
                        data={"reply": f"Gmail service returned an error: {response.status_code}"}
                    )

                res_data = response.json()
                messages = res_data.get("messages", [])
                if not messages:
                    reply_text = "You have no new or matching emails."
                    return AgentResponse(
                        success=True,
                        message=reply_text,
                        data={"reply": reply_text, "emails": []}
                    )

                email_list = []
                for msg in messages:
                    msg_id = msg.get("id")
                    detail_url = f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{msg_id}"
                    detail_params = {
                        "format": "metadata",
                        "metadataHeaders": ["From", "Subject", "Date"]
                    }
                    detail_response = await client.get(detail_url, headers=headers, params=detail_params)
                    if detail_response.status_code == 200:
                        detail_data = detail_response.json()
                        snippet = detail_data.get("snippet", "")
                        headers_list = detail_data.get("payload", {}).get("headers", [])
                        
                        from_val = next((h.get("value") for h in headers_list if h.get("name") == "From"), "Unknown Sender")
                        subject_val = next((h.get("value") for h in headers_list if h.get("name") == "Subject"), "No Subject")
                        date_val = next((h.get("value") for h in headers_list if h.get("name") == "Date"), "Unknown Date")
                        
                        email_list.append({
                            "id": msg_id,
                            "from": from_val,
                            "subject": subject_val,
                            "date": date_val,
                            "snippet": snippet
                        })
                
                reply_parts = [f"I found {len(email_list)} email(s):"]
                for i, email in enumerate(email_list, 1):
                    reply_parts.append(
                        f"{i}. From: {email['from']}\n"
                        f"   Subject: {email['subject']}\n"
                        f"   Snippet: {email['snippet']}"
                    )
                reply_text = "\n\n".join(reply_parts)
                
                return AgentResponse(
                    success=True,
                    message=f"Successfully retrieved {len(email_list)} emails.",
                    data={"reply": reply_text, "emails": email_list}
                )

        except Exception as req_err:
            return AgentResponse(
                success=False,
                message=f"Network error calling Gmail API: {str(req_err)}",
                data={"reply": f"Could not reach Gmail API: {str(req_err)}"}
            )

    async def execute(self, action: str, params: Dict[str, Any]) -> AgentResponse:
        """Standard BaseAgent execution routing."""
        if action == "send_email":
            recipient = params.get("recipient")
            subject = params.get("subject", "No Subject")
            body = params.get("body", "")

            if not recipient:
                return AgentResponse(
                    success=False,
                    message="Recipient email address was not provided.",
                    data={"reply": "I need a recipient email address to send this."}
                )

            return await self.send_email(recipient, subject, body)

        elif action == "list_emails":
            max_results = params.get("max_results", 5)
            try:
                max_results = int(max_results)
            except (ValueError, TypeError):
                max_results = 5
            query = params.get("query")
            return await self.list_emails(max_results=max_results, query=query)

        return AgentResponse(
            success=False,
            message=f"Unsupported action: '{action}' inside CommunicationAgent.",
            data={"reply": f"I don't know how to perform action '{action}' on email."}
        )
