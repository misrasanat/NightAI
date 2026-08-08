from abc import ABC, abstractmethod
from typing import Any, Dict
from pydantic import BaseModel


class AgentResponse(BaseModel):
    """Unified response format returned by all agents to the controller brain."""
    success: bool
    message: str
    data: Dict[str, Any] = {}


class BaseAgent(ABC):
    """Abstract base class for all action agents in the NightAI system."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Name of the agent (e.g., 'MusicAgent', 'CalendarAgent')."""
        pass

    @property
    @abstractmethod
    def description(self) -> str:
        """Description of the agent's capabilities.
        
        Used by the Controller's routing prompt to select the correct agent.
        """
        pass

    @abstractmethod
    async def execute(self, action: str, params: Dict[str, Any]) -> AgentResponse:
        """Executes a specific action with the given parameters.

        Args:
            action (str): The method/sub-action name (e.g., 'play_song', 'create_event').
            params (Dict[str, Any]): Arguments required for the action.

        Returns:
            AgentResponse: Standardized response object.
        """
        pass
