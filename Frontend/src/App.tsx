import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { MsalProvider, useMsal } from "@azure/msal-react";
import { PublicClientApplication } from "@azure/msal-browser";
import Layout from './components/Layout';
import ChatPage from './pages/ChatPage';
import LoginPage from './pages/LoginPage';
import ProtectedRoute from './components/ProtectedRoute';
import { ConversationProvider } from './context/ConversationContext';
import { APIProvider } from './context/APIContext';
import { msalConfig } from './config/authConfig';
import CreateProjectPage from './pages/Projects Page/CreateProjectPage';
import AllProjectsPage from './pages/Projects Page/AllProjectsPage';
import ProjectPage from 'pages/Projects Page/ProjectPage';
import { Helmet } from "react-helmet";
import SharedChatPage from './pages/SharedChatPage';

// Initialize MSAL instance
const msalInstance = new PublicClientApplication(msalConfig);

// Create a wrapper component to handle authentication state
const AppContent: React.FC = () => {
  const { accounts } = useMsal();
  const [isBackendAuthenticated, setIsBackendAuthenticated] = useState(false);

  // Check if we have a valid backend authentication
  useEffect(() => {
    const checkBackendAuth = () => {
      const accessToken = sessionStorage.getItem('access_token');
      setIsBackendAuthenticated(!!accessToken);
    };

    checkBackendAuth();
  }, []);

  return (
    <>
      <Helmet>
        <title>{process.env.REACT_APP_COMPANY_NAME || 'InternalGpt'}</title>
        <meta name="description" content={process.env.REACT_APP_COMPANY_NAME || 'InternalGpt'} />
        <link rel="icon" href={process.env.REACT_APP_IMAGE_URL} />
      </Helmet>
      <APIProvider>
        {isBackendAuthenticated ? (
          <ConversationProvider>
            <Routes>
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <Layout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<ChatPage />} />
                <Route path="/c/:conversationId" element={<ChatPage />} />
                <Route path="/projects/:projectId" element={<ProjectPage />} />
                <Route path="/create-project" element={<CreateProjectPage />} />
                <Route path="/projects" element={<AllProjectsPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ConversationProvider>
        ) : (
          <Routes>
            <Route path="/login" element={<LoginPage onBackendAuthSuccess={() => setIsBackendAuthenticated(true)} />} />
            <Route path="/share/:conversationId" element={<SharedChatPage />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        )}
      </APIProvider>
    </>
  );
};

const App: React.FC = () => {
  return (
    <MsalProvider instance={msalInstance}>
      <AppContent />
    </MsalProvider>
  );
};

export default App;