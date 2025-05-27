import React, { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import { useAPI } from '../context/APIContext';

const Layout: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const api = useAPI();
  const [models, setModels] = useState<any[]>([]);

  const companyName = process.env.REACT_APP_COMPANY_NAME || 'InternalGpt';

  // Load models
  useEffect(() => {
    const fetchModels = async () => {
      try {
        const data = await api.getModels();
        setModels(data);
      } catch (error) {
        console.error('Error fetching models:', error);
      }
    };

    fetchModels();
  }, [api]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) {
        setSidebarOpen(false);
      } else {
        setSidebarOpen(true);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="flex h-screen bg-groww-background">
      {/* Sidebar */}
      <Sidebar 
        isOpen={sidebarOpen} 
        onClose={() => setSidebarOpen(false)} 
        isMobile={isMobile}
        models={models}
      />
      
      {/* Main content */}
      <div className={`flex-1 flex flex-col transition-all duration-300 ${isMobile ? 'ml-0' : (sidebarOpen ? 'ml-64' : 'ml-0')}`}>
        {/* Mobile header with menu button */}
        {isMobile && (
          <div className="bg-white border-b border-gray-200 h-14 flex items-center px-4">
            <button 
              onClick={() => setSidebarOpen(true)}
              className="p-2 rounded-md focus:outline-none focus:ring-2 focus:ring-groww-blue"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-groww-black" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div className="ml-4 font-semibold text-lg text-groww-black">{companyName}</div>
          </div>
        )}
        
        {/* Content */}
        <div className="flex-1 overflow-hidden">
          <Outlet />
        </div>
      </div>
      
      {/* Mobile sidebar backdrop */}
      {isMobile && sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-10"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  );
};

export default Layout; 