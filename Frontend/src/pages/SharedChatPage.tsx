import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import MessageList from '../components/MessageList';
import axios from 'axios';
import { ConversationProvider } from '../context/ConversationContext';
import { APIProvider } from '../context/APIContext';

const SharedChatPage: React.FC = () => {
  const { conversationId } = useParams();
  const [sharedConversation, setSharedConversation] = useState<any>(null);
  const [sharedLoading, setSharedLoading] = useState(false);
  const [sharedError, setSharedError] = useState<string | null>(null);

  useEffect(() => {
    if (conversationId) {
      setSharedLoading(true);
      setSharedError(null);
      axios.get(`${process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000'}/share/${conversationId}`)
        .then(res => {
          setSharedConversation(res.data);
          setSharedLoading(false);
        })
        .catch(err => {
          setSharedConversation(null);
          setSharedLoading(false);
          setSharedError('Failed to load shared conversation.');
        });
    }
  }, [conversationId]);

  if (sharedLoading) {
    return <div className="flex items-center justify-center h-full">Loading shared conversation...</div>;
  }
  if (sharedError) {
    return <div className="flex items-center justify-center h-full text-red-500">{sharedError}</div>;
  }
  if (!sharedConversation) {
    return <div className="flex items-center justify-center h-full">No shared conversation found.</div>;
  }

  // Map backend messages to MessageList format
  const messages: any[] = [];
  (sharedConversation.messages || []).forEach((m: any) => {
    if (m.user_role) {
      messages.push({
        role: 'user',
        content: m.user_role,
        timestamp: m.created_at,
        document_names: m.document_names || [],
      });
    }
    if (m.assistant_role) {
      messages.push({
        role: 'assistant',
        content: m.assistant_role,
        timestamp: m.created_at,
        document_names: m.document_names || [],
      });
    }
  });

  return (
    <APIProvider>
      <ConversationProvider>
        <div className="flex flex-col h-full bg-gray-50">
          <div className="flex-1 overflow-y-auto pb-4">
            <MessageList messages={messages} />
          </div>
          {/* No ChatInput in share mode (read-only) */}
        </div>
      </ConversationProvider>
    </APIProvider>
  );
};

export default SharedChatPage; 