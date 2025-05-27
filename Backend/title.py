import re

def sanitize_title(text, max_length=50):
    """Create a chat title from the first user message."""
    if not text:
        return "New Chat"
    
    # Clean up text to make a title
    text = re.sub(r'[^\w\s]', '', text).strip()
    
    # Truncate if too long
    if len(text) > max_length:
        return 
    text[:max_length] + "..."
    return text