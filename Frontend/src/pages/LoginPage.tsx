import React, { useState } from 'react';
import { useMsal } from "@azure/msal-react";
import { loginRequest } from '../config/authConfig';
import Cookies from 'js-cookie';
import { useAPI } from '../context/APIContext';
import { useNavigate } from 'react-router-dom';

interface LoginPageProps {
  onBackendAuthSuccess: () => void;
}

const LoginPage: React.FC<LoginPageProps> = ({ onBackendAuthSuccess }) => {
  const { instance } = useMsal();
  const api = useAPI();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const companyName = process.env.REACT_APP_COMPANY_NAME || 'InternalGpt';
  const companyLogo = process.env.REACT_APP_IMAGE_URL || '/groww-logo.png';

  const handleLogin = async () => {
    try {
      setError(null);
      setIsLoading(true);

      // First, verify backend login
      try {
        const backendResponse = await api.verifyBackendLogin();
        if (backendResponse.status === 200 && backendResponse.message === "Sucess") {
          // Backend verification successful, proceed with MSAL login
          const response = await instance.loginPopup({
            ...loginRequest,
            prompt: 'select_account'
          });
          
          // Store user_id in sessionStorage
          if (response.account?.idTokenClaims?.oid) {
            sessionStorage.setItem('user_id', response.account.idTokenClaims.oid);
          }

          // Get access token
          const tokenResponse = await instance.acquireTokenSilent({
            ...loginRequest,
            account: response.account
          });

          // Store access token in both sessionStorage and cookies
          if (tokenResponse.accessToken) {
            sessionStorage.setItem('access_token', tokenResponse.accessToken);
            // Store in cookies with 1 hour expiry
            Cookies.set('access_token', tokenResponse.accessToken, { expires: 1/24 });
          }

          // Login successful, notify parent component
          console.log('Login process completed successfully');
          onBackendAuthSuccess();
          navigate('/');
        } else {
          // Backend verification failed
          throw new Error('Backend verification failed');
        }
      } catch (backendError) {
        // If backend verification fails, clear any existing tokens
        sessionStorage.removeItem('access_token');
        sessionStorage.removeItem('user_id');
        Cookies.remove('access_token');
        throw new Error('Server error: Unable to verify login');
      }
    } catch (error: any) {
      console.error("Login failed:", error);
      setError(error.message || "Failed to sign in. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-groww-background">
      <div className="max-w-md w-full space-y-8 p-8 bg-white rounded-lg shadow-lg">
        <div className="text-center">
          <img src={companyLogo} alt="Company Logo" className="mx-auto h-12 w-auto" />
          <h2 className="mt-6 text-3xl font-bold text-groww-black">
            Welcome to {companyName}
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            Please sign in with your Microsoft account
          </p>
        </div>
        {error && (
          <div className="text-red-500 text-sm text-center">
            {error}
          </div>
        )}
        <div className="mt-8">
          <button
            onClick={handleLogin}
            disabled={isLoading}
            className={`w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-groww-green hover:bg-groww-green/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-groww-green ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {isLoading ? (
              <span className="flex items-center">
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Signing in...
              </span>
            ) : (
              <>
                <svg className="w-5 h-5 mr-2" viewBox="0 0 23 23" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M11.5 0C5.15 0 0 5.15 0 11.5C0 17.85 5.15 23 11.5 23C17.85 23 23 17.85 23 11.5C23 5.15 17.85 0 11.5 0ZM11.5 2.3C16.56 2.3 20.7 6.44 20.7 11.5C20.7 16.56 16.56 20.7 11.5 20.7C6.44 20.7 2.3 16.56 2.3 11.5C2.3 6.44 6.44 2.3 11.5 2.3Z" fill="currentColor"/>
                  <path d="M11.5 4.6C7.82 4.6 4.6 7.82 4.6 11.5C4.6 15.18 7.82 18.4 11.5 18.4C15.18 18.4 18.4 15.18 18.4 11.5C18.4 7.82 15.18 4.6 11.5 4.6ZM11.5 6.9C13.98 6.9 16.1 9.02 16.1 11.5C16.1 13.98 13.98 16.1 11.5 16.1C9.02 16.1 6.9 13.98 6.9 11.5C6.9 9.02 9.02 6.9 11.5 6.9Z" fill="currentColor"/>
                </svg>
                Sign in with Microsoft
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default LoginPage; 