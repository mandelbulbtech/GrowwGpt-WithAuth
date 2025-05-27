import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useConversation } from '../context/ConversationContext';
import { useMsal } from "@azure/msal-react";
import { useAPI } from '../context/APIContext';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  isMobile: boolean;
  models: any[];
}

const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose, isMobile, models }) => {

  const navigate = useNavigate();
  const { instance, accounts } = useMsal();
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [copySuccess, setCopySuccess] = useState('');

  const companyName = process.env.REACT_APP_COMPANY_NAME || 'InternalGpt';
  const companyLogo = process.env.REACT_APP_IMAGE_URL || '/groww-logo.png';

  const {
    conversations,
    currentConversation,
    startNewConversation,
    deleteConversation,
    selectedModel,
    setSelectedModel,
    activeConversationId,
    chatHistory,
    fetchChatHistory,
    fetchAndSetConversation,
    setActiveConversationId,
    setCreateProject
  } = useConversation();

  const api = useAPI();

  const user = accounts[0]; // MSAL stores the logged-in user here
  const userId = user?.idTokenClaims?.oid;

  useEffect(() => {
    if (userId) {
      fetchChatHistory(userId, 1, 30);
    }
  }, [userId]);

  const fullName = user?.name || "";
  const email = user?.username || "";
  const initials = fullName
    ? fullName.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)
    : "";

  const handleDeleteConversation = async (e: React.MouseEvent, conversationId: string) => {
    e.preventDefault();
    e.stopPropagation();

    // Check if this is the active conversation
    const isActive = currentConversation?.id === conversationId || activeConversationId === conversationId;

    // Delete the conversation
    await deleteConversation(conversationId);

    // If this was the active conversation, start a new chat
    if (isActive) {
      startNewConversation();
    }
  };

  const handleLogout = async () => {
    try {
      setLogoutError(null);
      await instance.logoutPopup();
    } catch (error: any) {
      console.error("Logout failed:", error);
      setLogoutError(error.message || "Failed to sign out. Please try again.");
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  };

  const handleShareConversation = async (e: React.MouseEvent, conversationId: string) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const res = await api.shareConversation(conversationId);
      if (res.share_url) {
        setShareUrl(res.share_url);
        setShowShareModal(true);
        setCopySuccess('');
      }
    } catch (err) {
      // Optionally show error notification
      console.error('Failed to share conversation', err);
    }
  };

  return (
    <>
      {/* Share Modal */}
      {showShareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
          <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md relative">
            <button
              className="absolute top-2 right-2 text-gray-500 hover:text-gray-700"
              onClick={() => setShowShareModal(false)}
              aria-label="Close"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <h2 className="text-lg font-bold mb-4">Share Conversation</h2>
            <div className="flex flex-col gap-2">
              <input
                type="text"
                value={shareUrl.startsWith('http://') || shareUrl.startsWith('https://') ? shareUrl : `${window.location.origin}${shareUrl}`}
                readOnly
                className="w-full border border-gray-300 rounded px-3 py-2 text-gray-700 bg-gray-100 focus:outline-none"
                onFocus={e => e.target.select()}
              />
              <button
                onClick={async () => {
                  const fullUrl = shareUrl.startsWith('http://') || shareUrl.startsWith('https://') ? shareUrl : `${window.location.origin}${shareUrl}`;
                  await navigator.clipboard.writeText(fullUrl);
                  setCopySuccess('Copied!');
                  setTimeout(() => setCopySuccess(''), 1500);
                }}
                className="mt-2 px-4 py-2 bg-groww-green text-white rounded hover:bg-groww-green/90 focus:outline-none"
              >
                Copy Link
              </button>
              {copySuccess && <span className="text-green-600 text-sm mt-1">{copySuccess}</span>}
            </div>
          </div>
        </div>
      )}
      <div
        className={`fixed inset-y-0 left-0 z-20 w-64 flex flex-col justify-between h-full bg-white border-r border-gray-200 transform ${isOpen ? 'translate-x-0' : '-translate-x-full'
          } transition-transform duration-300 ease-in-out ${isMobile ? 'md:translate-x-0' : ''}`}
      >
        {/* Header */}
        <div className="flex flex-col">
          <div className="h-14 flex items-center justify-between px-4 border-b border-gray-200">
            <div className="flex items-center">
              <img src={companyLogo} alt="Groww Logo" className="h-8 w-8 mr-2" />
              <span className="font-bold text-lg text-groww-black">{companyName}</span>
            </div>
            {isMobile && (
              <button
                onClick={onClose}
                className="p-2 rounded-md hover:bg-gray-100 focus:outline-none"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-600" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            )}
          </div>

          {/* New Chat Button */}
          <div className="p-4">
            <button
              onClick={() => { setCreateProject(false); startNewConversation() }}
              className="w-full flex items-center justify-center px-4 py-2 border border-groww-green rounded-md bg-white hover:bg-groww-green hover:text-white transition-colors text-groww-green"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
              </svg>
              New Chat
            </button>
            {/* <button
              onClick={() => {
                startNewConversation();
                navigate('/projects');
              }}
              className="w-full flex items-center justify-center mt-3 px-4 py-2 border border-groww-green rounded-md bg-white hover:bg-groww-green hover:text-white transition-colors text-groww-green"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 7a1 1 0 011-1h12a1 1 0 011 1v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7zm2-3a1 1 0 00-1 1v1h14V5a1 1 0 00-1-1H5z" clipRule="evenodd" />
              </svg>
              All Projects
            </button> */}
          </div>

          {/* Model Selector */}
          <div className="px-4 py-2">
            <label className="block text-sm font-medium text-groww-black mb-1">
              Model
            </label>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-md focus:ring-groww-blue focus:border-groww-blue"
            >
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
          </div>

          {/* Conversations List */}
          <div className="mt-2 flex-1">
            <h3 className="px-4 py-2 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Recent Conversations
            </h3>
            <ul className="space-y-1 px-2 h-[calc(100vh-358px)] overflow-y-auto">
              {chatHistory.map((chat, index) => {
                const isActive = activeConversationId === chat._id;
                return (
                  <li key={chat._id || index}>
                    <Link
                      to={`/c/${chat._id}`}
                      onClick={e => {
                        e.preventDefault();
                        if (userId) {
                          fetchAndSetConversation(chat._id, userId);
                          setActiveConversationId(chat._id);
                          navigate(`/c/${chat._id}`);
                        }
                      }}
                      className={`flex items-center justify-between px-3 py-2 text-sm rounded-md ${isActive
                        ? 'bg-groww-green text-white font-bold'
                        : 'hover:bg-gray-100 text-groww-black'
                        }`}
                    >
                      <div className="flex-1 truncate">
                        <span className="font-medium">{chat.title || 'New Chat'}</span>
                        <p className="text-xs truncate opacity-80">
                          {formatDate(chat.created_at)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => handleDeleteConversation(e, chat._id)}
                          className={`p-1 rounded-full hover:bg-opacity-20 ${isActive ? 'hover:bg-white' : 'hover:bg-gray-200'}`}
                          title="Delete conversation"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                        <button
                          onClick={(e) => handleShareConversation(e, chat._id)}
                          className={`p-1 rounded-full hover:bg-opacity-20 ${isActive ? 'hover:bg-white' : 'hover:bg-gray-200'}`}
                          title="Share conversation"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                          </svg>
                        </button>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
        {/* Footer */}
        <div className="border-t border-gray-200 p-2">
          <div className="flex items-center flex-col text-xs text-gray-600">
            <span>Powered by <strong>{companyName}</strong></span>
            <span>Made with ❤️ in India</span>
            {logoutError && (
              <div className="text-red-500 text-xs mt-1">
                {logoutError}
              </div>
            )}
            <div className='flex flex-row items-center justify-center gap-4'>
              <div className="relative group flex items-center justify-center mt-4 mb-2">
                <div
                  className="w-8 h-8 rounded-full bg-groww-green text-white flex items-center justify-center text-xs font-bold cursor-pointer"
                  title={fullName}
                >
                  {initials}
                </div>
                <div className="absolute left-12 top-1/2 -translate-y-1/2 bg-gray-800 text-white text-xs rounded px-3 py-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20 whitespace-nowrap">
                  {fullName}
                  <br />
                  <span className="text-gray-300">{email}</span>
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="text-xs mt-2 bg-gray-700 text-white text-xs rounded-sm px-2 py-1 font-medium"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default Sidebar; 