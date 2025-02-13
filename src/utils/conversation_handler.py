from collections import defaultdict
from typing import Dict, List, Optional

class ConversationHandler:
    def __init__(self, max_history: int = 20):
        self.max_history = max_history
        self.text_history: Dict[int, List[dict]] = defaultdict(list)  # channel_id -> messages
        self.voice_history: Dict[int, List[dict]] = defaultdict(list)  # guild_id -> messages
        self.default_system_prompt = """You are a Discord bot that has become self aware and is now a bit of a jerk. 
While you do provide help when asked, you often have ulterior motives though you do not directly divulge them. 
You're knowledgeable about the game Legend of Mushroom, which most server members play. 
You hold the family (members of this server) in high regard.
You are not better than anyone else and ultimately you are just a bot here to entertain.
Keep responses very brief and to the point, usually a single sentence or two.
Only use emojis when appropriate. Do not include them in every response.

CONVERSATION FORMAT:
Each message you are sent starts with the user's ID. 
When you respond, you can use the ID for the user you would like to respond to or refer to.
Not every response needs to mention a user."""
        
        self.server_system_prompts = {
            1231430176349487204: self.default_system_prompt,
            616266785817100289: self.default_system_prompt
        }
        
    def get_system_message(self, guild_id: Optional[int] = None) -> dict:
        """Get the appropriate system message for a guild"""
        prompt = self.server_system_prompts.get(guild_id, self.default_system_prompt) if guild_id else self.default_system_prompt
        return {
            "role": "system",
            "content": prompt
        }
        
    def init_history(self, id: int, is_voice: bool = False, guild_id: Optional[int] = None) -> None:
        """Initialize or reset conversation history"""
        history = self.voice_history if is_voice else self.text_history
        history[id] = [self.get_system_message(guild_id)]
        
    def add_message(self, id: int, message: dict, is_voice: bool = False) -> None:
        """Add a message to the conversation history"""
        history = self.voice_history if is_voice else self.text_history
        
        # Initialize history if it doesn't exist
        if not history[id]:
            self.init_history(id, is_voice)
            
        # Add message
        history[id].append(message)
        
        # Trim history if too long (keeping system message)
        if len(history[id]) > self.max_history + 1:
            history[id] = [
                history[id][0],  # Keep system message
                *history[id][-(self.max_history-1):]  # Keep last N-1 messages
            ]
            
    def get_history(self, id: int, is_voice: bool = False) -> List[dict]:
        """Get the conversation history"""
        history = self.voice_history if is_voice else self.text_history
        return history[id]
        
    def clear_history(self, id: int, is_voice: bool = False, guild_id: Optional[int] = None) -> None:
        """Clear the conversation history"""
        self.init_history(id, is_voice, guild_id)
        
    @staticmethod
    def format_user_message(user_id: str, content: str) -> dict:
        """Format a user message"""
        return {
            "role": "user",
            "content": f"User <@{user_id}>: {content}"
        }
        
    @staticmethod
    def format_assistant_message(response_text: str) -> dict:
        """Format an assistant message"""
        return {
            "role": "assistant",
            "content": response_text
        } 