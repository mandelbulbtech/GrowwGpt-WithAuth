import React, { useEffect, useState } from 'react';
import { useConversation } from '../../context/ConversationContext';
import { useNavigate } from 'react-router-dom';
import { useAPI } from '../../context/APIContext';
import CreateProjectPage from './CreateProjectPage';

const AllProjectsPage: React.FC = () => {
    const { projects, fetchProjects, setCurrentProject, setCurrentConversation } = useConversation();
    const navigate = useNavigate();
    const api = useAPI();
    const [showCreate, setShowCreate] = useState(false);

    useEffect(() => {
        fetchProjects();
        // eslint-disable-next-line
    }, []);

    const handleProjectClick = async (project: any) => {
        try {
            const user_id = sessionStorage.getItem('user_id') || '1';
            console.log('Fetching project details for:', project.id);
            const response = await api.getProjectDetails(project.id, user_id);
            console.log('Project details response:', response);

            if (response.chat && response.messages) {
                // Create a conversation object with messages
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

                console.log('Setting current project and conversation');
                setCurrentProject({
                    id: project.id,
                    name: project.name,
                    description: project.description,
                    instructions: project.instructions || '',
                    created_at: project.created_at,
                    files: [],
                    conversations: [conversation],
                });
                setCurrentConversation(conversation);
                
                console.log('Navigating to project page');
                navigate(`/projects/${project.id}`);
            } else {
                console.error('No chat or messages data in response');
            }
        } catch (error) {
            console.error('Error in handleProjectClick:', error);
        }
    };

    // Close modal when clicking outside the modal content
    const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
        if (e.target === e.currentTarget) {
            setShowCreate(false);
        }
    };

    return (
        <div className="px-8 py-4">
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold">All Projects</h1>
                <button
                    className="px-4 py-2 rounded bg-groww-green text-white font-bold hover:bg-groww-green/90 transition"
                    onClick={() => setShowCreate(true)}
                >
                    + Create Project
                </button>
            </div>
            {showCreate && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40"
                    onClick={handleBackdropClick}
                >
                    <CreateProjectPage inlineMode onClose={() => setShowCreate(false)} />
                </div>
            )}
            {projects.length === 0 ? (
                <p className="text-gray-500">No projects found.</p>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 h-[86vh] py-1 overflow-y-scroll">
                    {projects.map((project) => (
                        <div
                            key={project.id}
                            className="bg-white rounded-lg shadow-md p-6 cursor-pointer hover:shadow-lg transition"
                            onClick={() => handleProjectClick(project)}
                        >
                            <h2 className="text-lg font-semibold">{project.name}</h2>
                            <p className="text-gray-600 text-sm mt-1">{project.description}</p>
                            <p className="text-gray-400 text-xs mt-2">
                                Created: {new Date(project.created_at).toLocaleDateString()}
                            </p>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default AllProjectsPage; 