import React, { useEffect, useState } from 'react';
import ChatInput from '../components/ChatInput';
import MessageList from '../components/MessageList';
import { useConversation } from '../context/ConversationContext';
import { useAPI } from '../context/APIContext';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
 
const ChatPage: React.FC = () => {
  const { currentConversation, loading, selectedModel, sendMessage, setLoadingMessage, setCurrentConversation, setConversations, setActiveConversationId, fetchChatHistory } = useConversation();
  const api = useAPI();
  const location = useLocation();
  const navigate = useNavigate();
  const { conversationId } = useParams();
 
  const companyName = process.env.REACT_APP_COMPANY_NAME || 'InternalGpt';
 
  // Shared conversation state
  const [sharedConversation, setSharedConversation] = useState<any>(null);
  const [isShareMode, setIsShareMode] = useState(false);
  const [sharedLoading, setSharedLoading] = useState(false);
  const [sharedError, setSharedError] = useState<string | null>(null);
 
  useEffect(() => {
    // If there is no active conversation and the URL has an id, redirect to "/"
    const match = location.pathname.match(/^\/c\/[\w-]+/);
    if ((!currentConversation || !currentConversation.messages?.length) && match) {
      navigate('/');
    }
  }, [currentConversation, location, navigate]);
 
  useEffect(() => {
    // Detect if we're on a /share/:conversationId route
    if (location.pathname.startsWith('/share/')) {
      setIsShareMode(true);
      setSharedLoading(true);
      setSharedError(null);
      // Fetch the shared conversation
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
    } else {
      setIsShareMode(false);
    }
  }, [location, conversationId]);
 
  const handleExampleClick = async (question: string) => {
    if (selectedModel) {
      try {
        const currentMessage = question.trim();
 
        const userIdToSend = sessionStorage.getItem('user_id') || '';
        const conversationIdToSend = currentConversation?.id || sessionStorage.getItem('conversation_id') || '';
 
        setLoadingMessage(true);
        await sendMessage(currentMessage, undefined, userIdToSend, undefined, undefined);
 
        const response = await api.generateResponse(selectedModel, currentMessage, userIdToSend, {
          conversation_id: conversationIdToSend
        });
 
        // Store conversation ID from first response in both state and sessionStorage, and update conversations list
        const realId = response.conversation_id ?? '';
        sessionStorage.setItem('conversation_id', realId);
 
        // Set active conversation ID for new conversations
        if (!currentConversation?.id) {
          setActiveConversationId(realId);
        }
 
        setCurrentConversation(prev => {
          const updated = prev
            ? { ...prev, id: realId }
            : {
              id: realId,
              title: currentMessage || 'New Chat',
              created_at: new Date().toISOString(),
              model: selectedModel,
              messages: []
            };
          setConversations((convs) => {
            const filtered = convs.filter(c => c.id && c.id !== '');
            if (!filtered.find(c => c.id === realId)) {
              return [updated, ...filtered];
            }
            return filtered.map(c => c.id === '' ? updated : c);
          });
          return updated;
        });
 
        await sendMessage(currentMessage, response.response || '', userIdToSend, undefined, undefined);
        // Refresh chat history after first message
        if (userIdToSend) {
          await fetchChatHistory(userIdToSend, 1, 10);
        }
      } catch (error) {
        console.error('Error sending example question:', error);
      } finally {
        setLoadingMessage(false);
      }
    }
  };
 
  if (isShareMode) {
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
      <div className="flex flex-col h-full bg-gray-50">
        <div className="flex-1 overflow-y-auto pb-4">
          <MessageList messages={messages} />
        </div>
        {/* No ChatInput in share mode (read-only) */}
      </div>
    );
  }
 
  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Empty State or Messages */}
      <div className="flex-1 overflow-y-auto pb-4">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="animate-pulse flex flex-col items-center">
              <div className="h-12 w-12 bg-groww-blue/20 rounded-full mb-4"></div>
              <div className="h-4 w-32 bg-groww-blue/20 rounded mb-3"></div>
              <div className="h-3 w-24 bg-groww-blue/20 rounded"></div>
            </div>
          </div>
        ) : !selectedModel ? (
          <div className="flex flex-col items-center justify-center h-full px-4 text-center">
            <div className="bg-groww-green/10 p-4 rounded-full mb-6">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-groww-green" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-groww-black mb-2">Select a Model</h2>
            <p className="text-groww-gray mb-8 max-w-md">
              Please select a model from the sidebar to start chatting.
            </p>
          </div>
        ) : currentConversation ? (
          <MessageList messages={currentConversation.messages} />
        )  : (
          <div className="flex flex-col items-center justify-center h-full px-4 text-center">
            <div className="bg-groww-green/10 p-4 rounded-full mb-6">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-groww-green" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-groww-black mb-2">Welcome to {companyName}</h2>
            <p className="text-groww-gray mb-8 max-w-md">
              Your AI assistant for investments, stocks, and mutual funds. Ask anything about investing, market trends, or financial planning.
            </p>
            {/* Example questions */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-2xl">
              <button
                onClick={() => handleExampleClick("What are the top performing IT stocks in India right now?")}
                className="border border-gray-200 p-4 rounded-lg hover:border-groww-green bg-white text-left transition-colors duration-200 hover:bg-gray-50"
              >
                <h3 className="font-medium text-groww-black mb-2">Analyze Stocks</h3>
                <p className="text-sm text-groww-gray">
                  "What are the top performing IT stocks in India right now?"
                </p>
              </button>
              <button
                onClick={() => handleExampleClick("Compare HDFC Mid-Cap Opportunities and Axis Midcap Fund")}
                className="border border-gray-200 p-4 rounded-lg hover:border-groww-green bg-white text-left transition-colors duration-200 hover:bg-gray-50"
              >
                <h3 className="font-medium text-groww-black mb-2">Mutual Fund Research</h3>
                <p className="text-sm text-groww-gray">
                  "Compare HDFC Mid-Cap Opportunities and Axis Midcap Fund"
                </p>
              </button>
              <button
                onClick={() => handleExampleClick("How should I start investing with Rs. 10,000 per month?")}
                className="border border-gray-200 p-4 rounded-lg hover:border-groww-green bg-white text-left transition-colors duration-200 hover:bg-gray-50"
              >
                <h3 className="font-medium text-groww-black mb-2">Investment Planning</h3>
                <p className="text-sm text-groww-gray">
                  "How should I start investing with Rs. 10,000 per month?"
                </p>
              </button>
              <button
                onClick={() => handleExampleClick("What factors are affecting the Indian market this week?")}
                className="border border-gray-200 p-4 rounded-lg hover:border-groww-green bg-white text-left transition-colors duration-200 hover:bg-gray-50"
              >
                <h3 className="font-medium text-groww-black mb-2">Market Analysis</h3>
                <p className="text-sm text-groww-gray">
                  "What factors are affecting the Indian market this week?"
                </p>
              </button>
            </div>
          </div>
        )}
      </div>
 
 
        <div className="border-t border-gray-200 py-4 px-4 md:px-6 bg-white">
          <ChatInput />
        </div>
    </div>
  );
};
 
export default ChatPage;
 