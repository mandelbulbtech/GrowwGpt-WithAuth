import React, { useEffect, useState } from 'react';
import { useConversation } from '../../context/ConversationContext';
import { useNavigate } from 'react-router-dom';

// Add props for inline mode and onClose
interface CreateProjectPageProps {
  inlineMode?: boolean;
  onClose?: () => void;
}

const CreateProjectPage: React.FC<CreateProjectPageProps> = ({ inlineMode, onClose }) => {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [instructions, setInstructions] = useState('');
  const { setCreateProject, createNewProject, fetchProjects } = useConversation();
  const navigate = useNavigate();
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    if (showSuccess) {
      const timer = setTimeout(() => setShowSuccess(false), 1500);
      return () => clearTimeout(timer);
    }
  }, [showSuccess]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim() && desc.trim()) {
      await createNewProject(name.trim(), desc.trim(), instructions.trim());
      setShowSuccess(true);
      fetchProjects();

      if (inlineMode && onClose) {
        onClose();
      } else {
        navigate('/');
      }
    }
  };

  return (
    <>
      <div className="w-full min-h-full flex items-center justify-center">
        <form onSubmit={handleSubmit} className="bg-white p-8 rounded-lg shadow-lg w-full max-w-md">
          <h2 className="text-3xl font-bold mb-6 text-groww-black">Create a personal project</h2>
          <div className="mb-4">
            <label className="block text-gray-500 mb-2">What are you working on?</label>
            <input
              className="w-full px-4 py-2 rounded border border-gray-300 text-gray-800 focus:outline-none focus:border-groww-green"
              placeholder="Name your project"
              value={name}
              onChange={e => setName(e.target.value)}
              required
            />
          </div>
          <div className="mb-4">
            <label className="block text-gray-500 mb-2">What are you trying to achieve?</label>
            <textarea
              className="w-full px-4 py-2 rounded border border-gray-300 text-gray-800 focus:outline-none focus:border-groww-green"
              placeholder="Describe your project, goals, subject, etc..."
              value={desc}
              onChange={e => setDesc(e.target.value)}
              rows={4}
              required
            />
          </div>
          <div className="mb-6">
            <label className="block text-gray-500 mb-2">Project Instructions (Optional)</label>
            <textarea
              className="w-full px-4 py-2 rounded border border-gray-300 text-gray-800 focus:outline-none focus:border-groww-green"
              placeholder="Add any specific instructions for the AI to follow..."
              value={instructions}
              onChange={e => setInstructions(e.target.value)}
              rows={4}
            />
          </div>
          <div className="flex justify-end gap-2">
            {inlineMode ? (
              <button
                type="button"
                className="px-4 py-2 rounded bg-gray-200 text-gray-700 hover:bg-gray-300"
                onClick={onClose}
              >
                Cancel
              </button>
            ) : (
              <button
                type="button"
                className="px-4 py-2 rounded bg-gray-200 text-gray-700 hover:bg-gray-300"
                onClick={() => setCreateProject(false)}
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              className="px-4 py-2 rounded bg-groww-green text-white font-bold hover:bg-groww-green/90 transition"
            >
              Create project
            </button>
          </div>
        </form>
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
};

export default CreateProjectPage;
