import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useConversation } from '../../context/ConversationContext';
import { useAPI } from '../../context/APIContext';
import ProjectInput from 'components/Project/ProjectInput';
import ProjectMessageList from 'components/Project/ProjectMessageList'; // Import the ProjectMessageList component

const ProjectPage: React.FC = () => {
    const {
        currentConversation,
        loading,
        selectedModel,
        sendMessage,
        setLoadingMessage,
        setCurrentConversation,
        setConversations,
        setActiveConversationId,
        fetchChatHistory,
        loadProjectConversations,
        startNewProjectConversation
    } = useConversation();

    const navigate = useNavigate();
    const location = useLocation();
    const { currentProject, addProjectFiles, removeProjectFile, setCurrentProject, setProjectChat } = useConversation();
    const [showKnowledge, setShowKnowledge] = useState(false);
    const [projectInstructions, setProjectInstructions] = useState('');
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    const [showSuccess, setShowSuccess] = useState(false);
    const api = useAPI();
    const [isLoadingProjectDetails, setIsLoadingProjectDetails] = useState(false);

    useEffect(() => {
        if (currentProject?.instructions) {
            setProjectInstructions(currentProject.instructions);
        }
    }, [currentProject]);

    useEffect(() => {
        if (showSuccess) {
            const timer = setTimeout(() => setShowSuccess(false), 1500);
            return () => clearTimeout(timer);
        }
    }, [showSuccess]);

    useEffect(() => {
        // If there is no active conversation and the URL has an id, redirect to "/"
        const match = location.pathname.match(/^\/c\/[\w-]+/);
        if ((!currentConversation || !currentConversation.messages?.length) && match) {
            navigate('/');
        }
    }, [currentConversation, location, navigate]);

    // Load project conversations when the project changes
    useEffect(() => {
        let isMounted = true;

        const loadProjectData = async () => {
            if (!currentProject || isLoadingProjectDetails) return;
            
            try {
                setIsLoadingProjectDetails(true);
                console.log('Current project in ProjectPage:', currentProject);
                await loadProjectConversations(currentProject.id);
                const user_id = sessionStorage.getItem('user_id') || '';
                const response = await api.getProjectDetails(currentProject.id, user_id);
                
                if (!isMounted) return;
                
                console.log('Project details response in ProjectPage:', response);
                if (response.chat && response.messages) {
                    const conversation = {
                        id: response.chat.id,
                        title: response.chat.title,
                        created_at: response.chat.created_at,
                        model: response.chat.model_name,
                        messages: response.messages.flatMap((msg: any) => {
                            const result = [];
                            if (msg.user_message) {
                                result.push({
                                    role: 'user',
                                    content: msg.user_message,
                                    timestamp: msg.created_at,
                                });
                            }
                            if (msg.assistant_message) {
                                result.push({
                                    role: 'assistant',
                                    content: msg.assistant_message,
                                    timestamp: msg.created_at,
                                });
                            }
                            return result;
                        }),
                        project_id: response.chat.project_id
                    };
                    console.log('Setting conversation in ProjectPage:', conversation);
                    setCurrentConversation(conversation);

                    // Update project with documents from response
                    if (response.documents) {
                        const updatedProject = {
                            ...currentProject,
                            files: response.documents.map((doc: any) => ({
                                id: doc._id,
                                name: doc.name,
                                size: doc.size_mb,
                                type: doc.type,
                                created_at: doc.created_at,
                            }))
                        };
                        setCurrentProject(updatedProject);
                    }
                }
            } catch (error) {
                console.error('Error fetching project details in ProjectPage:', error);
            } finally {
                if (isMounted) {
                    setIsLoadingProjectDetails(false);
                }
            }
        };

        loadProjectData();

        return () => {
            isMounted = false;
        };
    }, [currentProject?.id]); // Only depend on the project ID

    // Add a check for the URL parameter
    useEffect(() => {
        const projectId = location.pathname.split('/').pop();
        console.log('Project ID from URL:', projectId);
        if (projectId && !currentProject) {
            console.log('Project ID exists but no current project, redirecting to projects page');
            navigate('/projects');
        }
    }, [location.pathname, currentProject, navigate]);

    const handleSaveFiles = async () => {
        if (!currentProject) return;
        setUploading(true);
        setUploadError(null);
        const user_id = sessionStorage.getItem('user_id') || '';
        try {
            for (const file of pendingFiles) {
                await api.uploadProjectDocument(currentProject.id, user_id, file.name, file);
            }
            setPendingFiles([]);
            setShowKnowledge(false);
            setShowSuccess(true);
            // Reload project after uploading files
            const projectDetails = await api.getProjectDetails(currentProject.id, user_id);
            if (projectDetails.project) {
                setCurrentProject({
                    ...currentProject,
                    files: projectDetails.project.files || []
                });
            }
        } catch (err) {
            setUploadError('Failed to upload one or more files. Please try again.');
        } finally {
            setUploading(false);
        }
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            setPendingFiles(Array.from(e.target.files));
        }
    };

    const handleBackToProjects = () => {
        setCurrentProject(null);
        setProjectChat(false);
        navigate('/projects');
    };

    const handleStartNewChat = () => {
        if (currentProject) {
            startNewProjectConversation(currentProject.id);
        }
    };

    if (!currentProject) {
        return (
            <div className="flex flex-col items-center justify-center w-full h-full bg-gray-50">
                <div className='bg-white flex items-center justify-between fixed top-0 w-[calc(100%-258px)] py-2 px-8 z-10'>
                    <div className='flex flex-col space-x-4'>
                        <button className="flex items-center space-x-2 cursor-pointer font-semibold text-gray-500 hover:text-gray-700" onClick={handleBackToProjects}>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                            </svg>
                            <span className="text-sm">All projects</span>
                        </button>
                    </div>
                </div>
                <p className="text-gray-500">No project selected</p>
            </div>
        );
    }

    return (
        <>
            <div className="flex flex-col h-full bg-gray-50">
                <div className='bg-white flex items-center justify-between fixed top-0 w-[calc(100%-265px)] py-2 px-8 z-10'>
                    <div className='flex flex-col space-x-4'>
                        <button className="flex items-center space-x-2 cursor-pointer font-semibold text-gray-500 hover:text-gray-700" onClick={handleBackToProjects}>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                            </svg>
                            <span className="text-sm">All projects</span>
                        </button>
                    </div>
                    <h1 className='font-bold text-lg text-groww-black'>{currentProject.name}</h1>
                    <div className="flex space-x-2">
                        <button
                            className="flex justify-center items-center flex-row border border-gray-300 text-sm rounded-lg p-1 px-3 hover:bg-gray-100 transition-colors"
                            onClick={handleStartNewChat}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                            </svg>
                            New Chat
                        </button>
                        <button
                            className="flex justify-center items-center flex-row border border-gray-300 text-sm rounded-lg p-1 px-3 hover:bg-gray-100 transition-colors"
                            onClick={() => setShowKnowledge(true)}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                            </svg>
                            Manage Knowledge
                        </button>
                    </div>
                </div>

                <div className='flex-1 overflow-y-auto pb-4 pt-12'>
                    {/* Project conversation display using ProjectMessageList */}
                    {currentConversation && currentConversation.messages && currentConversation.messages.length > 0 && (
                        <div className="flex-1 overflow-y-auto">
                            <ProjectMessageList messages={currentConversation.messages} />
                        </div>
                    )}

                    {/* Knowledge base management UI */}
                    {showKnowledge && (
                        <div
                            className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40"
                            onClick={() => setShowKnowledge(false)}
                        >
                            <div
                                className="bg-white border border-gray-200 rounded-xl p-6 w-full max-w-2xl mx-auto relative"
                                onClick={e => e.stopPropagation()}
                            >
                                <div className="flex items-center justify-between mb-4">
                                    <h2 className="font-semibold text-gray-900 text-base">Project Knowledge Base</h2>
                                    {uploadError && <div className="text-red-500 text-sm">{uploadError}</div>}
                                    <div className='flex flex-row items-center justify-center gap-2'>
                                        <div className="flex space-x-2">
                                            <button
                                                className="border border-gray-300 text-sm rounded-lg py-1 px-4 hover:bg-gray-100 transition-colors"
                                                onClick={handleSaveFiles}
                                                disabled={uploading || pendingFiles.length === 0}
                                            >
                                                {uploading ? 'Uploading...' : 'Save Files'}
                                            </button>
                                        </div>
                                        <button
                                            className="text-gray-400 hover:text-red-500"
                                            onClick={() => setShowKnowledge(false)}
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>

                                <div className="flex flex-col items-center justify-center text-center bg-gray-50 rounded-lg py-4">
                                    <label className="inline-block cursor-pointer bg-white text-sm border border-gray-300 rounded-lg px-4 py-2 text-gray-700 font-medium shadow-sm hover:bg-gray-100 transition-colors mb-4">
                                        + Add files
                                        <input
                                            type="file"
                                            multiple
                                            className="hidden"
                                            onChange={handleFileUpload}
                                        />
                                    </label>

                                    {/* Pending files (not yet uploaded) */}
                                    {pendingFiles.length > 0 && (
                                        <div className="w-full flex flex-col items-center justify-center">
                                            <h4 className="font-medium text-sm text-gray-700 mb-2">Files to upload:</h4>
                                            <ul className="text-gray-700 max-w-md w-full text-left space-y-2 mb-4">
                                                {pendingFiles.map((file, idx) => (
                                                    <li key={file.name + idx} className="flex items-center justify-between bg-white p-2 rounded-md">
                                                        <div className="flex items-center">
                                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-blue-500 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                                            </svg>
                                                            <span className="text-sm">{file.name}</span>
                                                            <span className="text-xs text-gray-500 ml-2">(pending)</span>
                                                        </div>
                                                        <button
                                                            onClick={() => setPendingFiles(files => files.filter((_, i) => i !== idx))}
                                                            className="text-gray-400 hover:text-red-500"
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                            </svg>
                                                        </button>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}

                                    {/* Already uploaded files */}
                                    {currentProject.files.length === 0 && pendingFiles.length === 0 ? (
                                        <p className="text-gray-500 max-w-md">No knowledge files added yet. Add PDFs, documents, or other text to the project knowledge base that Claude will reference in every project conversation.</p>
                                    ) : currentProject.files.length > 0 && (
                                        <div className="w-full flex flex-col items-center justify-center">
                                            <h4 className="font-medium text-sm text-gray-700 mb-2">Project knowledge files:</h4>
                                            <ul className="text-gray-700 max-w-md w-full text-left space-y-2">
                                                {currentProject.files.map((file, idx) => (
                                                    <li key={file.id || idx} className="flex items-center justify-between bg-white p-2 rounded-md">
                                                        <div className="flex items-center">
                                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-500 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                            </svg>
                                                            <span className="text-sm">{file.name}</span>
                                                            <span className="text-xs text-gray-400 ml-2">
                                                                {file.type} ({(file.size * 1024).toFixed(1)} KB)
                                                            </span>
                                                        </div>
                                                        <button
                                                            onClick={() => removeProjectFile(file.name)}
                                                            className="text-gray-400 hover:text-red-500"
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                            </svg>
                                                        </button>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
                <div className="border-t border-gray-200 py-4 px-4 md:px-6 bg-white">
                    <ProjectInput />
                </div>
            </div>
            {showSuccess && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
                    <div className="bg-white border border-green-400 rounded-xl p-8 w-full max-w-sm mx-auto relative flex flex-col items-center">
                        <button
                            className="absolute top-2 right-2 text-gray-400 hover:text-red-500"
                            onClick={() => setShowSuccess(false)}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-green-500 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <h3 className="text-lg font-semibold text-green-700 mb-2">Files uploaded successfully!</h3>
                    </div>
                </div>
            )}
        </>
    );
}

export default ProjectPage;