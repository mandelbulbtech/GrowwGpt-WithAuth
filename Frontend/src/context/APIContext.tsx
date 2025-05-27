import React, { createContext, useContext, ReactNode } from 'react';
import axios from 'axios';
import Cookies from 'js-cookie';
import { useMsal } from "@azure/msal-react";
import { loginRequest } from '../config/authConfig';

// Define the base URL from environment or default to localhost
const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://127.0.0.1:5000';

// Create axios instance with default headers
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Types
interface APIContextType {
  generateResponse: (model_name: string, input_text: string, user_id: string, options?: {
    generate_image?: boolean;
    conversation_id?: string;
    document?: File;
    documents?: File[];
    project_instructions?: string;
  }) => Promise<any>;
  verifyBackendLogin: () => Promise<{ status: number; message: string }>;
  getModels: () => Promise<any>;
  getConversations: () => Promise<any>;
  getConversation: (conversationId: string) => Promise<any>;
  deleteConversation: (conversationId: string) => Promise<any>;
  uploadAttachment: (file: File) => Promise<any>;
  deleteAttachment: (attachmentId: string) => Promise<any>;
  bingGroundingSearch: (query: string, model: string, conversation_id: string, user_id: string) => Promise<any>;
  getChatHistory: (user_id: string, page?: number, limit?: number) => Promise<any>;
  getChatById: (chatId: string, user_id: string) => Promise<any>;
  createProject: (
    user_id: string,
    name: string,
    goal: string,
    instructions?: string
  ) => Promise<any>;
  uploadProjectDocument: (
    projectId: string,
    user_id: string,
    document_name: string,
    document: File
  ) => Promise<any>;
  getProjects: (user_id: string) => Promise<any>;
  getProjectDetails: (projectId: string, user_id: string) => Promise<any>;
  generateProjectResponse: (
    projectId: string, 
    model_name: string, 
    input_text: string, 
    user_id: string, 
    conversation_id?: string,
    options?: {
      documents?: File[];
      generate_image?: boolean;
    }
  ) => Promise<any>;
  updateProjectInstructions: (
    projectId: string,
    user_id: string,
    instructions: string
  ) => Promise<any>;
  shareConversation: (conversationId: string) => Promise<any>;
}

// Create context
const APIContext = createContext<APIContextType | undefined>(undefined);

// Provider component
export const APIProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { instance } = useMsal();

  // Function to refresh token using MSAL
  const refreshToken = async () => {
    try {
      const accounts = instance.getAllAccounts();
      
      if (accounts.length > 0) {
        // MSAL will automatically handle token refresh
        const tokenResponse = await instance.acquireTokenSilent({
          ...loginRequest,
          account: accounts[0]
        });

        if (tokenResponse.accessToken) {
          // Store new token in both sessionStorage and cookies
          sessionStorage.setItem('access_token', tokenResponse.accessToken);
          Cookies.set('access_token', tokenResponse.accessToken, { expires: 1/24 });
          return tokenResponse.accessToken;
        }
      }
      return null;
    } catch (error) {
      console.error('Error refreshing token:', error);
      return null;
    }
  };

  // Add request interceptor to include access token
  api.interceptors.request.use((config) => {
    // Get token from cookies or sessionStorage
    const token = Cookies.get('access_token') || sessionStorage.getItem('access_token');
    
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    
    return config;
  });

  // Add response interceptor to handle token expiration
  api.interceptors.response.use(
    (response) => response,
    async (error) => {
      const originalRequest = error.config;

      // If error is 401 and we haven't tried to refresh token yet
      if (error.response?.status === 401 && !originalRequest._retry) {
        originalRequest._retry = true;

        try {
          // Try to refresh the token using MSAL
          const newToken = await refreshToken();
          
          if (newToken) {
            // Update the authorization header
            originalRequest.headers.Authorization = `Bearer ${newToken}`;
            // Retry the original request
            return api(originalRequest);
          }
        } catch (refreshError) {
          console.error('Error refreshing token:', refreshError);
        }

        // If refresh failed, clear tokens and redirect to login
        Cookies.remove('access_token');
        sessionStorage.removeItem('access_token');
        window.location.href = '/login';
      }
      
      return Promise.reject(error);
    }
  );

  // Add new function to verify backend login
  const verifyBackendLogin = async () => {
    try {
      const response = await api.get('/login');
      return response.data;
    } catch (error) {
      console.error('Error verifying backend login:', error);
      throw error;
    }
  };

  // Generate response from the API
  const generateResponse = async (model_name: string, input_text: string, user_id: string, options?: {
    generate_image?: boolean;
    conversation_id?: string;
    document?: File;
    documents?: File[];
    project_instructions?: string;
  }) => {
    try {
      if (options?.document || options?.documents) {
        // Handle document upload case
        const formData = new FormData();

        if (options.documents) {
          // Handle multiple documents
          options.documents.forEach((doc, index) => {
            formData.append(`documents[]`, doc);
          });
        } else if (options.document) {
          // Handle single document (backward compatibility)
          formData.append('documents[]', options.document);
        }

        formData.append('input_text', input_text);
        formData.append('model_name', model_name);
        formData.append('user_id', user_id);
        if (options.conversation_id) {
          formData.append('conversation_id', options.conversation_id);
        }
        if (options.project_instructions) {
          formData.append('project_instructions', options.project_instructions);
        }

        // Remove the default Content-Type header for FormData
        const response = await api.post('/generate-response', formData, {
          headers: {
            'Content-Type': undefined, // Let the browser set the correct boundary
          },
        });
        return response.data;
      } else {
        // Handle regular JSON payload case
        const payload: any = {
          model_name,
          input_text,
          user_id,
          conversation_id: options?.conversation_id || ''
        };

        if (options?.generate_image) {
          payload.generate_image = "true";
        }
        if (options?.project_instructions) {
          payload.project_instructions = options.project_instructions;
        }

        const response = await api.post('/generate-response', payload);
        return response.data;
      }
    } catch (error) {
      console.error('Error generating response:', error);
      throw error;
    }
  };

  // Get available models
  const getModels = async () => {
    return [
      { id: 'gpt-4o', name: 'gpt-4o' },
      // { id: 'gpt-4o-mini', name: 'gpt-4o-mini' },
      // { id: 'o3-mini', name: 'o3-mini' }
    ];
  };

  // Get all conversations
  const getConversations = async () => {
    return [];
  };

  // Get a specific conversation
  const getConversation = async (conversationId: string) => {
    return null;
  };

  // Delete a conversation
  const deleteConversation = async (conversationId: string) => {
    try {
      const response = await api.delete(`/api/chats/${conversationId}`);
      return response.data;
    } catch (error) {
      console.error('Error deleting conversation:', error);
      throw error;
    }
  };

  // Upload attachment
  const uploadAttachment = async (file: File) => {
    return { id: Date.now().toString(), filename: file.name };
  };

  // Delete attachment
  const deleteAttachment = async (attachmentId: string) => {
    return true;
  };

  // Bing Grounding Search
  const bingGroundingSearch = async (query: string, model: string, conversation_id: string, user_id: string) => {
    try {
      const response = await api.post('/api/bing-grounding', {
        query,
        model,
        conversation_id,
        user_id
      });
      return response.data;
    } catch (error) {
      console.error('Error with Bing Grounding Search:', error);
      throw error;
    }
  };

  // Get chat history
  const getChatHistory = async (user_id: string, page = 1, limit = 10) => {
    const response = await api.get('/api/chats', {
      params: { user_id, page, limit }
    });
    return response.data;
  };

  // Get chat by ID
  const getChatById = async (chatId: string, user_id: string) => {
    const response = await api.get(`/api/chats/${chatId}`, {
      params: { user_id }
    });
    return response.data;
  };

  // Create project
  const createProject = async (
    user_id: string,
    name: string,
    goal: string,
    instructions?: string
  ) => {
    const response = await api.post('/api/projects', {
      user_id,
      name,
      goal,
      instructions,
    });
    return response.data;
  };

  // Upload project document
  const uploadProjectDocument = async (
    projectId: string,
    user_id: string,
    document_name: string,
    document: File
  ) => {
    const formData = new FormData();
    formData.append('user_id', user_id);
    formData.append('document_name', document_name);
    formData.append('document', document);

    const response = await api.post(`/api/projects/${projectId}/documents`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    return response.data;
  };

  // Get projects
  const getProjects = async (user_id: string) => {
    const response = await api.get(`/api/projects?user_id=${user_id}`);
    return response.data;
  };

  // Get project details
  const getProjectDetails = async (projectId: string, user_id: string) => {
    const response = await api.get(`/api/projects/${projectId}?user_id=${user_id}`);
    return response.data;
  };

  const generateProjectResponse = async (
    projectId: string, 
    model_name: string, 
    input_text: string, 
    user_id: string, 
    conversation_id?: string,
    options?: {
      documents?: File[];
      generate_image?: boolean;
    }
  ) => {
    try {
      // For file uploads, use FormData
      if (options?.documents && options.documents.length > 0) {
        const formData = new FormData();
  
        // Add documents
        options.documents.forEach((doc, index) => {
          formData.append(`documents[]`, doc);
        });
  
        // Add other parameters
        formData.append('input_text', input_text);
        formData.append('model_name', model_name);
        formData.append('user_id', user_id);
        
        if (projectId) {
          formData.append('conversation_id', projectId);
        }
  
        // Use the project-specific endpoint
        const response = await api.post(`/api/projects/${projectId}/conversation`, formData, {
          headers: {
            'Content-Type': undefined, // Let browser set correct boundary
          },
        });
        
        return response.data;
      } else {
        // Regular JSON request
        const payload: any = {
          user_id,
          model_name,
          input_text,
        };
  
        if (projectId) {
          payload.conversation_id = projectId;
        }
  
        if (options?.generate_image) {
          payload.generate_image = "true";
        }
  
        // Use the project-specific endpoint
        const response = await api.post(`/api/projects/${projectId}/conversation`, payload);
        return response.data;
      }
    } catch (error) {
      console.error('Error generating project response:', error);
      throw error;
    }
  };

  
  const updateProjectInstructions = async (
    projectId: string,
    user_id: string,
    instructions: string
  ) => {
    try {
      const response = await api.patch(`/api/projects/${projectId}`, {
        user_id,
        instructions
      });
      return response.data;
    } catch (error) {
      console.error('Error updating project instructions:', error);
      throw error;
    }
  };

  const shareConversation = async (conversationId: string) => {
    const response = await api.post(`/api/chats/${conversationId}/share`);
    return response.data;
  };

  // Context value
  const value = {
    generateResponse,
    verifyBackendLogin,
    getModels,
    getConversations,
    getConversation,
    deleteConversation,
    uploadAttachment,
    deleteAttachment,
    bingGroundingSearch,
    getChatHistory,
    getChatById,
    createProject,
    uploadProjectDocument,
    getProjects,
    getProjectDetails,
    generateProjectResponse,
    updateProjectInstructions,
    shareConversation
  };

  return <APIContext.Provider value={value}>{children}</APIContext.Provider>;
};

// Custom hook for using the API context
export const useAPI = () => {
  const context = useContext(APIContext);
  if (context === undefined) {
    throw new Error('useAPI must be used within an APIProvider');
  }
  return context;
}; 