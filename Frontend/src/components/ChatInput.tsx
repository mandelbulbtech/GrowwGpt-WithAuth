import React, { useState, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { useConversation } from '../context/ConversationContext';
import { useAPI } from '../context/APIContext';

const ChatInput: React.FC = () => {
  const [message, setMessage] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isImageGeneration, setIsImageGeneration] = useState(false);
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [documentNames, setDocumentNames] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const {
    sendMessage,
    loadingMessage,
    selectedModel,
    setLoadingMessage,
    currentConversation,
    setCurrentConversation,
    setConversations,
    setActiveConversationId,
    fetchChatHistory
  } = useConversation();
  const api = useAPI();

  // Check if Bing search is available
  const isBingSearchAvailable = selectedModel === "gpt-4o";

  // The updated handleSubmit function with conversation_id storage fix
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((message.trim() || selectedFiles.length > 0) && !loadingMessage && selectedModel) {
      try {
        setLoadingMessage(true);
        const currentMessage = message.trim();
        const currentFiles = [...selectedFiles];

        // Set document names immediately from selected files
        const initialDocNames = currentFiles.map(file => file.name);
        setDocumentNames(initialDocNames);

        // Get conversation_id from context or sessionStorage
        const conversationIdToSend = currentConversation?.id || sessionStorage.getItem('conversation_id') || '';
        const userIdToSend = sessionStorage.getItem('user_id') || '';

        // Clear input immediately
        setMessage('');
        setSelectedFiles([]);
        setIsImageGeneration(false);
        setIsSearchMode(false);
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto';
        }

        // Add user message to the conversation first with initial document names
        await sendMessage(currentMessage, undefined, userIdToSend, undefined, initialDocNames);

        // Define a proper type for the response
        interface ApiResponse {
          conversation_id?: string;
          response?: string;
          response_type?: string;
          image_url?: string;
          document_names?: string[];
          sources?: { [key: string]: { title: string; url: string; snippet?: string } };
        }

        let response: ApiResponse = {};

        if (isSearchMode) {
          response = await api.bingGroundingSearch(currentMessage, selectedModel, conversationIdToSend, userIdToSend);
        } else if (currentFiles.length > 0) {
          response = await api.generateResponse(selectedModel, currentMessage, userIdToSend, {
            documents: currentFiles,
            conversation_id: conversationIdToSend
          });
        } else if (isImageGeneration) {
          response = await api.generateResponse(selectedModel, currentMessage, userIdToSend, {
            generate_image: true,
            conversation_id: conversationIdToSend
          });
        } else {
          response = await api.generateResponse(selectedModel, currentMessage, userIdToSend, {
            conversation_id: conversationIdToSend
          });
        }

        // Store conversation_id immediately after first response
        const realId = response.conversation_id ?? '';
        sessionStorage.setItem('conversation_id', realId);
        
        // Set active conversation ID before any other state updates
        if (!currentConversation?.id) {
          setActiveConversationId(realId);
        }

        // Update conversation state
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
          // Update the conversations list
          setConversations(convs => {
            // Remove any conversation with empty id
            const filtered = convs.filter(c => c.id && c.id !== '');
            // Add the updated conversation if not already present
            if (!filtered.find(c => c.id === realId)) {
              return [updated, ...filtered];
            }
            return filtered.map(c => c.id === '' ? updated : c);
          });
          return updated;
        });

        // Handle different response types
        if (isSearchMode) {
          await sendMessage(
            currentMessage,
            response.response || '',
            userIdToSend,
            undefined,
            undefined,
            response.sources
          );
        } else if (isImageGeneration && response.response_type === "image" && response.image_url) {
          await sendMessage(currentMessage, "", userIdToSend, response.image_url);
        } else {
          // Update document names from response if available
          if (response.document_names && response.document_names.length > 0) {
            setDocumentNames(response.document_names);
            await sendMessage(currentMessage, response.response || '', userIdToSend, undefined, response.document_names);
          } else {
            setDocumentNames([]);
            await sendMessage(currentMessage, response.response || '', userIdToSend);
          }
        }

        // Refresh chat history
        await fetchChatHistory(userIdToSend, 1, 10);

      } catch (error) {
        console.error('Error sending message:', error);
      } finally {
        setLoadingMessage(false);
      }
    }
  };

  // Auto-resize textarea
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${e.target.scrollHeight}px`;
  };

  // Handle key press
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  // Setup dropzone for file uploads
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      'application/pdf': ['.pdf'],
      'text/plain': ['.txt'],
      'application/msword': ['.doc'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'text/csv': ['.csv'],
      'image/png': ['.png'],
      'image/jpeg': ['.jpg', '.jpeg']
    },
    maxSize: 10485760, // 10MB
    multiple: true, // Allow multiple files
    onDrop: (acceptedFiles) => {
      setSelectedFiles(prev => [...prev, ...acceptedFiles]);
    }
  });

  // Remove a file from the selection
  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="mx-auto w-full">
      {/* File upload dropzone */}
      <div
        {...getRootProps()}
        className={`mb-3 border-2 border-dashed rounded-md p-4 text-center cursor-pointer transition-colors ${isDragActive ? 'border-groww-green bg-groww-green/5' : 'border-gray-300 hover:border-groww-blue'
          }`}
      >
        <input {...getInputProps()} />
        <p className="text-sm text-gray-600">
          {isDragActive
            ? 'Drop the files here...'
            : 'Drag & drop files here, or click to select'}
        </p>
        <p className="text-xs text-gray-500 mt-1">
          Supported: PDF, TXT, DOC, DOCX, XLS, XLSX, CSV
        </p>
      </div>

      {/* Selected files preview */}
      {selectedFiles.length > 0 && (
        <div className="mb-3 space-y-2">
          {selectedFiles.map((file, index) => (
            <div key={index} className="flex items-center justify-between bg-gray-50 p-3 rounded-lg">
              <div className="flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-500 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                <span className="text-sm text-gray-700 truncate max-w-xs">{file.name}</span>
              </div>
              <button
                onClick={() => removeFile(index)}
                className="text-gray-500 hover:text-red-500"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Message input form */}
      <form onSubmit={handleSubmit} className="relative">
        <div className="flex items-center relative border border-gray-300 rounded-lg focus-within:ring-2 focus-within:ring-groww-blue focus-within:border-transparent">
          {/* Image Generation Toggle */}
          <button
            type="button"
            onClick={() => { setIsImageGeneration(!isImageGeneration); setIsSearchMode(false); }}
            className={`absolute left-2 top-1/2 transform -translate-y-1/2 p-1 rounded-full focus:outline-none ${isImageGeneration
                ? 'text-blue-500 bg-blue-50'
                : 'text-gray-400 hover:text-gray-600'
              }`}
            title={isImageGeneration ? "Switch to text mode" : "Switch to image generation mode"}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" strokeWidth="2" />
              <circle cx="9" cy="9" r="2" stroke="currentColor" strokeWidth="2" />
              <path d="M21 15l-5-5L5 21" stroke="currentColor" strokeWidth="2" />
            </svg>
          </button>

          {/* Search Toggle Button */}
          <button
            type="button"
            onClick={() => {
              if (isBingSearchAvailable) {
                setIsSearchMode(!isSearchMode);
                setIsImageGeneration(false);
              }
            }}
            disabled={!isBingSearchAvailable}
            className={`flex flex-row gap-2 px-2 text-sm border border-gray-300 text-md absolute left-12 top-1/2 transform -translate-y-1/2 p-1 rounded-full ${isSearchMode
                ? "text-blue-500 bg-blue-50 hover:border-blue-500"
                : isBingSearchAvailable
                  ? "text-gray-500 hover:text-gray-600 hover:border-gray-600"
                  : "text-gray-400 cursor-not-allowed"
              }`}
            title={
              isBingSearchAvailable
                ? isSearchMode
                  ? "Switch to normal mode"
                  : "Search the web"
                : "You need to use gpt-4o model to use web search"
            }
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="2"
              />
              <line
                x1="2"
                y1="12"
                x2="22"
                y2="12"
                stroke="currentColor"
                strokeWidth="2"
              />
              <path
                d="M12 2C15 6 15 18 12 22C9 18 9 6 12 2Z"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
              />
            </svg>
            Search
          </button>


          {/* Textarea with adjusted padding for button space */}
          <textarea
            ref={textareaRef}
            value={message}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder={isImageGeneration ? "Describe the image you want to generate..." : "Ask about stocks, mutual funds, or investment strategies..."}
            className="w-full py-3 pl-40 pr-12 resize-none rounded-lg overflow-hidden focus:outline-none"
            rows={1}
            disabled={loadingMessage}
          />

          {/* Send button */}
          <button
            type="submit"
            disabled={(!message.trim() && selectedFiles.length === 0) || loadingMessage}
            className={`absolute right-1 top-1/2 transform -translate-y-1/2 p-1 rounded-full focus:outline-none ${(!message.trim() && selectedFiles.length === 0) || loadingMessage
                ? 'text-gray-400 cursor-not-allowed'
                : 'text-groww-green hover:bg-groww-green/10'
              }`}
            title={isImageGeneration ? "Generate Image" : "Send Message"}
          >
            {loadingMessage ? (
              <svg className="animate-spin h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-8.707l-3-3a1 1 0 00-1.414 0l-3 3a1 1 0 001.414 1.414L9 9.414V13a1 1 0 102 0V9.414l1.293 1.293a1 1 0 001.414-1.414z" clipRule="evenodd" />
              </svg>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ChatInput;
