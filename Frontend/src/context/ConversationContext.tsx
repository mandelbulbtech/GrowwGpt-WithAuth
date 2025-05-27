import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useAPI } from './APIContext';
import { useNavigate, useParams } from 'react-router-dom';

// Types
export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  attachment_ids?: string[];
  image_url?: string;
  document_name?: string;
  document_names?: string[];
  sources?: { [key: string]: { title: string; url: string; snippet?: string } };
}

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  model: string;
  messages: Message[];
  project_id?: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  instructions?: string;
  created_at: string;
  files: ProjectDocument[];
  conversations: Conversation[];
}

export interface ProjectDocument {
  id: string;
  name: string;
  size: number;
  type: string;
  created_at: string;
}

type APIMessage = {
  _id: string;
  assistant_role?: string;
  chat_id: string;
  content_type: string;
  created_at: string;
  order: number;
  user_id: string;
  user_role?: string;
};

interface ConversationContextType {
  currentConversation: Conversation | null;
  conversations: Conversation[];
  loading: boolean;
  loadingMessage: boolean;
  selectedModel: string;
  attachments: { id: string; filename: string; }[];
  activeConversationId: string | null;
  chatHistory: any[];
  createProject: boolean;
  projectChat: boolean;
  currentProject: Project | null;
  projects: Project[];
  loadProjectConversations: (projectId: string) => Promise<void>;
  setCreateProject: (value: boolean) => void;
  setProjectChat: (value: boolean) => void;
  setSelectedModel: (model: string) => void;
  sendMessage: (message: string, response?: string, user_id?: string, image_url?: string, document_names?: string[], sources?: { [key: string]: { title: string; url: string; snippet?: string } }) => Promise<void>;
  loadConversation: (conversationId: string) => Promise<void>;
  startNewConversation: () => void;
  deleteConversation: (conversationId: string) => Promise<void>;
  addAttachment: (file: File) => Promise<void>;
  removeAttachment: (attachmentId: string) => void;
  setLoadingMessage: (loading: boolean) => void;
  setCurrentConversation: React.Dispatch<React.SetStateAction<Conversation | null>>;
  setConversations: React.Dispatch<React.SetStateAction<Conversation[]>>;
  setActiveConversationId: (id: string | null) => void;
  fetchChatHistory: (user_id: string, page?: number, limit?: number) => Promise<void>;
  fetchAndSetConversation: (chatId: string, user_id: string) => Promise<void>;
  createNewProject: (name: string, description: string, instructions?: string) => Promise<void>;
  addProjectFiles: (files: File[], documentNames: string[]) => Promise<void>;
  removeProjectFile: (fileName: string) => void;
  setCurrentProject: (project: Project | null) => void;
  fetchProjects: () => Promise<void>;
  startNewProjectConversation: (projectId: string) => void;
}

// Create context
const ConversationContext = createContext<ConversationContextType | undefined>(undefined);

// Provider component
export const ConversationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const api = useAPI();
  const navigate = useNavigate();
  const { conversationId } = useParams();

  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingMessage, setLoadingMessage] = useState<boolean>(false);
  const [selectedModel, setSelectedModel] = useState<string>('gpt-4o');
  const [attachments, setAttachments] = useState<{ id: string; filename: string; }[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [chatHistory, setChatHistory] = useState<any[]>([]);
  const [createProject, setCreateProject] = useState<boolean>(false);
  const [projectChat, setProjectChat] = useState<boolean>(false);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);

  // Load conversations on initial render
  useEffect(() => {
    const loadConversations = async () => {
      try {
        setLoading(true);
        const data = await api.getConversations();
        setConversations(data);
        setLoading(false);
      } catch (error) {
        console.error('Error loading conversations:', error);
        setLoading(false);
      }
    };

    loadConversations();
  }, [api]);

  // Load conversation if ID is in URL
  useEffect(() => {
    if (conversationId) {
      loadConversation(conversationId);
    } else {
      setCurrentConversation(null);
      setAttachments([]);
    }
  }, [conversationId]);

  // Load a specific conversation
  const loadConversation = async (id: string) => {
    try {
      setLoading(true);
      const data = await api.getConversation(id);
      setCurrentConversation(data);
      setLoading(false);
    } catch (error) {
      console.error(`Error loading conversation ${id}:`, error);
      setLoading(false);
      navigate('/');
    }
  };

  // Start a new conversation
  const startNewConversation = () => {
    setCurrentConversation(null);
    setAttachments([]);
    setActiveConversationId(null);
    sessionStorage.removeItem('conversation_id');
    navigate('/');
  };

  // Send a message
  const sendMessage = async (
    message: string,
    response?: string,
    user_id?: string,
    image_url?: string,
    document_names?: string[],
    sources?: { [key: string]: { title: string; url: string; snippet?: string } }
  ) => {
    try {
      const attachmentIds = attachments.map(attachment => attachment.id);
      const timestamp = new Date().toISOString();

      // Add user message immediately
      let updatedMessages = currentConversation ? [...currentConversation.messages] : [];
      const userMessage: Message = {
        role: 'user' as 'user', // Explicitly cast as literal type
        content: message,
        timestamp: timestamp,
        attachment_ids: attachmentIds,
        ...(document_names ? { document_names } : {})
      };

      updatedMessages.push(userMessage);

      // If this is a new conversation, we'll wait for the backend response to get the conversation ID
      if (!currentConversation) {
        const newConversation: Conversation = {
          id: '', // Will be set from backend response
          title: message.slice(0, 30) + (message.length > 30 ? '...' : ''),
          created_at: new Date().toISOString(),
          model: selectedModel,
          messages: updatedMessages
        };
        setCurrentConversation(newConversation);
      } else {
        setCurrentConversation(prev => prev ? { ...prev, messages: updatedMessages } : null);
      }

      // If response is provided, add it as assistant message
      if (response !== undefined || image_url !== undefined) {
        setCurrentConversation(prev => {
          if (!prev) return null;

          const assistantMessage: Message = {
            role: 'assistant' as 'assistant', // Explicitly cast as literal type
            content: response || '',
            timestamp: new Date().toISOString(),
            ...(image_url ? { image_url } : {}),
            ...(sources ? { sources } : {})
          };

          return {
            ...prev,
            messages: [
              ...prev.messages,
              assistantMessage
            ]
          };
        });
      }

      setAttachments([]);
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    }
  };

  // Delete a conversation
  const deleteConversation = async (id: string) => {
    try {
      const response = await api.deleteConversation(id);
      
      if (response.success) {
        // Update chat history by filtering out the deleted chat
        setChatHistory(prev => prev.filter(chat => chat._id !== id));

        // If deleted the current conversation, redirect to home
        if (currentConversation && currentConversation.id === id) {
          startNewConversation();
        }
      } else {
        console.error('Failed to delete conversation:', response.error);
      }
    } catch (error) {
      console.error(`Error deleting conversation ${id}:`, error);
    }
  };

  // Add an attachment
  const addAttachment = async (file: File) => {
    try {
      const response = await api.uploadAttachment(file);
      setAttachments(prev => [...prev, { id: response.id, filename: response.filename }]);
    } catch (error) {
      console.error('Error uploading attachment:', error);
    }
  };

  // Remove an attachment
  const removeAttachment = (attachmentId: string) => {
    setAttachments(prev => prev.filter(a => a.id !== attachmentId));
  };

  const fetchChatHistory = async (user_id: string, page = 1, limit = 10) => {
    try {
      const data = await api.getChatHistory(user_id, page, limit);
      setChatHistory(data.chats);
    } catch (error) {
      console.error('Error fetching chat history:', error);
    }
  };

  const fetchAndSetConversation = async (chatId: string, user_id: string) => {
    try {
      const data = await api.getChatById(chatId, user_id);
      // You may want to transform the data to fit your Conversation type
      setCurrentConversation({
        id: data.chat._id,
        title: data.chat.title,
        created_at: data.chat.created_at,
        model: data.chat.model_name,
        messages: data.messages.flatMap((m: APIMessage) => {
          const msgs = [];
          if (m.user_role) {
            msgs.push({
              role: 'user' as const,
              content: m.user_role,
              timestamp: m.created_at,
              // add other fields as needed
            });
          }
          if (m.assistant_role) {
            msgs.push({
              role: 'assistant' as const,
              content: m.assistant_role,
              timestamp: m.created_at,
              // add other fields as needed
            });
          }
          return msgs;
        })
      });
    } catch (error) {
      console.error('Error loading chat:', error);
    }
  };

  // Create a new project
  const createNewProject = async (name: string, description: string, instructions?: string) => {
    const user_id = sessionStorage.getItem('user_id') || '1'; // or get from auth context
    const response = await api.createProject(user_id, name, description, instructions);
    if (response.success && response.project) {
      const newProject: Project = {
        id: response.project.id,
        name: response.project.name,
        description: response.project.goal, // Map 'goal' to 'description'
        instructions,
        created_at: response.project.created_at,
        files: [],
        conversations: [],
      };
      setProjects(prev => [...prev, newProject]);
      setCurrentProject(newProject);
      setCreateProject(false);
      setProjectChat(false);
    }
  };

  // Add files to current project
  const addProjectFiles = async (files: File[], documentNames: string[]) => {
    if (currentProject) {
      const user_id = sessionStorage.getItem('user_id') || '1';
      const uploadedDocs = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const name = documentNames[i] || file.name;
        const response = await api.uploadProjectDocument(currentProject.id, user_id, name, file);
        if (response.success && response.document) {
          uploadedDocs.push({
            id: response.document.id,
            name: response.document.name,
            size: response.document.size_mb,
            type: response.document.type,
            created_at: response.document.created_at,
          });
        }
      }
      // Add uploadedDocs to the currentProject's files array
      const updatedProject = {
        ...currentProject,
        files: [...currentProject.files, ...uploadedDocs]
      };
      setCurrentProject(updatedProject);
      setProjects(prev => prev.map(p => p.id === currentProject.id ? updatedProject : p));
    }
  };

  // Remove file from current project
  const removeProjectFile = (fileName: string) => {
    if (currentProject) {
      const updatedProject = {
        ...currentProject,
        files: currentProject.files.filter(f => f.name !== fileName)
      };
      setCurrentProject(updatedProject);
      setProjects(prev => prev.map(p => p.id === currentProject.id ? updatedProject : p));
    }
  };

  // Fetch all projects
  const fetchProjects = async () => {
    try {
      const user_id = sessionStorage.getItem('user_id') || '1';
      const response = await api.getProjects(user_id);
      if (response.projects) {
        // Map backend fields to your Project type
        const mappedProjects = response.projects.map((p: any) => ({
          id: p._id,
          name: p.name,
          description: p.goal,
          created_at: p.created_at,
          instructions: '', // If you want to fetch instructions, add it here
          files: [],
          conversations: [],
        }));
        setProjects(mappedProjects);
      }
    } catch (error) {
      console.error('Error fetching projects:', error);
    }
  };

  const loadProjectConversations = async (projectId: string) => {
    try {
      setLoading(true);
      // Get project conversations from API
      const user_id = sessionStorage.getItem('user_id') || '1';
      const projectDetails = await api.getProjectDetails(projectId, user_id);
      
      if (projectDetails.conversations) {
        // Update the project's conversations list
        setCurrentProject(prev => {
          if (prev && prev.id === projectId) {
            return {
              ...prev,
              conversations: projectDetails.conversations.map((convId: string) => convId)
            };
          }
          return prev;
        });
      }
      setLoading(false);
    } catch (error) {
      console.error(`Error loading project conversations for ${projectId}:`, error);
      setLoading(false);
    }
  };

  const startNewProjectConversation = (projectId: string) => {
    console.log('Starting new project conversation', projectId);
    setCurrentConversation(null);
    setAttachments([]);
    setActiveConversationId(null);
    sessionStorage.removeItem('conversation_id');
    
    // Don't navigate away from the project page
    setProjectChat(true);
  };

  // Context value
  const value = {
    currentConversation,
    conversations,
    loading,
    loadingMessage,
    selectedModel,
    attachments,
    activeConversationId,
    chatHistory,
    createProject,
    projectChat,
    currentProject,
    projects,
    setCreateProject,
    setProjectChat,
    setSelectedModel,
    sendMessage,
    loadConversation,
    startNewConversation,
    deleteConversation,
    addAttachment,
    removeAttachment,
    setLoadingMessage,
    setCurrentConversation,
    setConversations,
    setActiveConversationId,
    fetchChatHistory,
    fetchAndSetConversation,
    createNewProject,
    addProjectFiles,
    removeProjectFile,
    setCurrentProject,
    fetchProjects,
    loadProjectConversations,
    startNewProjectConversation
  };

  return <ConversationContext.Provider value={value}>{children}</ConversationContext.Provider>;
};

// Custom hook for using the conversation context
export const useConversation = () => {
  const context = useContext(ConversationContext);
  if (context === undefined) {
    throw new Error('useConversation must be used within a ConversationProvider');
  }
  return context;
}; 