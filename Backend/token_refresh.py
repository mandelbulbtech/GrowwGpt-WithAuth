import os
import time
import requests
from flask import request, jsonify, current_app
from functools import wraps
import logging

logger = logging.getLogger(__name__)

# Token refresh configuration
TOKEN_REFRESH_THRESHOLD = 5 * 60  # Refresh if token expires in 5 minutes
REFRESH_TOKEN_ENDPOINT = f"https://login.microsoftonline.com/{os.environ.get('AZURE_AD_TENANT_ID')}/oauth2/v2.0/token"

class TokenManager:
    def __init__(self):
        self.refresh_tokens = {}  # Store refresh tokens (consider using Redis in production)
    
    def extract_tokens_from_request(self):
        """Extract both access and refresh tokens from request"""
        # Check for tokens in headers
        access_token = request.headers.get('Authorization', '').replace('Bearer ', '')
        refresh_token = request.headers.get('X-Refresh-Token', '')
        
        # Alternatively, check cookies if you're using httpOnly cookies
        if not access_token:
            access_token = request.cookies.get('access_token', '')
        if not refresh_token:
            refresh_token = request.cookies.get('refresh_token', '')
        
        return access_token, refresh_token
    
    def get_token_expiry(self, token):
        """Get token expiration time"""
        try:
            from jose import jwt
            unverified_claims = jwt.get_unverified_claims(token)
            return unverified_claims.get('exp', 0)
        except Exception as e:
            logger.error(f"Error getting token expiry: {str(e)}")
            return 0
    
    def is_token_expired(self, token):
        """Check if token is expired or will expire soon"""
        try:
            exp = self.get_token_expiry(token)
            current_time = time.time()
            
            # Check if token is already expired
            if current_time >= exp:
                return True, "Token is expired"
            
            # Check if token will expire soon (within threshold)
            if (exp - current_time) <= TOKEN_REFRESH_THRESHOLD:
                return True, "Token will expire soon"
            
            return False, None
        except Exception as e:
            logger.error(f"Error checking token expiry: {str(e)}")
            return True, "Error checking token"
    
    def refresh_access_token(self, refresh_token, user_id=None):
        """Refresh the access token using refresh token"""
        try:
            data = {
                'grant_type': 'refresh_token',
                'refresh_token': refresh_token,
                'client_id': os.environ.get('AZURE_AD_CLIENT_ID'),
                'client_secret': os.environ.get('AZURE_AD_CLIENT_SECRET'),  # If using confidential client
                'scope': 'openid profile email https://graph.microsoft.com/User.Read'
            }
            
            headers = {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
            
            logger.info(f"Attempting to refresh token for user: {user_id}")
            response = requests.post(REFRESH_TOKEN_ENDPOINT, data=data, headers=headers)
            
            if response.status_code == 200:
                token_data = response.json()
                new_access_token = token_data.get('access_token')
                new_refresh_token = token_data.get('refresh_token', refresh_token)  # May or may not get new refresh token
                
                # Store the new refresh token
                if user_id and new_refresh_token:
                    self.refresh_tokens[user_id] = new_refresh_token
                
                logger.info(f"Successfully refreshed token for user: {user_id}")
                return {
                    'success': True,
                    'access_token': new_access_token,
                    'refresh_token': new_refresh_token,
                    'expires_in': token_data.get('expires_in', 3600)
                }
            else:
                logger.error(f"Token refresh failed: {response.status_code} - {response.text}")
                return {
                    'success': False,
                    'error': 'Token refresh failed',
                    'status_code': response.status_code
                }
        
        except Exception as e:
            logger.error(f"Error refreshing token: {str(e)}")
            return {
                'success': False,
                'error': f'Token refresh error: {str(e)}'
            }
    
    def handle_token_refresh(self, access_token, refresh_token, user_id=None):
        """Handle the token refresh process"""
        # Check if refresh token exists
        if not refresh_token:
            logger.warning("No refresh token available")
            return None
        
        # Attempt to refresh
        refresh_result = self.refresh_access_token(refresh_token, user_id)
        
        if refresh_result['success']:
            return {
                'new_access_token': refresh_result['access_token'],
                'new_refresh_token': refresh_result['refresh_token'],
                'expires_in': refresh_result['expires_in']
            }
        else:
            return None

# Global token manager instance
token_manager = TokenManager()

def require_auth_with_refresh(f):
    """Enhanced authentication decorator with automatic token refresh"""
    @wraps(f)
    def decorated(*args, **kwargs):
        # Extract tokens from request
        access_token, refresh_token = token_manager.extract_tokens_from_request()
        
        if not access_token:
            return jsonify({
                'error': 'Authorization header is missing or invalid',
                'error_code': 'NO_TOKEN'
            }), 401
        
        # Check if token is expired or will expire soon
        is_expired, reason = token_manager.is_token_expired(access_token)
        
        # If token is expired/expiring and we have a refresh token
        if is_expired and refresh_token:
            logger.info(f"Token refresh needed: {reason}")
            
            # Get user ID from current token (if possible)
            try:
                from jose import jwt
                unverified_claims = jwt.get_unverified_claims(access_token)
                user_id = unverified_claims.get('oid')
            except:
                user_id = None
            
            # Attempt to refresh
            refresh_result = token_manager.handle_token_refresh(access_token, refresh_token, user_id)
            
            if refresh_result:
                # Token refreshed successfully
                logger.info("Token refreshed successfully")
                
                # Set the new token in the request context
                request.headers = dict(request.headers)
                request.headers['Authorization'] = f"Bearer {refresh_result['new_access_token']}"
                
                # Return new tokens to client in response headers
                response = f(*args, **kwargs)
                if hasattr(response, 'headers'):
                    response.headers['X-New-Access-Token'] = refresh_result['new_access_token']
                    response.headers['X-New-Refresh-Token'] = refresh_result['new_refresh_token']
                    response.headers['X-Token-Expires-In'] = str(refresh_result['expires_in'])
                
                return response
            else:
                # Refresh failed
                logger.warning("Token refresh failed, requiring re-authentication")
                return jsonify({
                    'error': 'Token expired and refresh failed',
                    'error_code': 'REFRESH_FAILED',
                    'action_required': 'Please re-authenticate'
                }), 401
        
        elif is_expired and not refresh_token:
            # No refresh token available
            return jsonify({
                'error': 'Token expired and no refresh token available',
                'error_code': 'TOKEN_EXPIRED',
                'action_required': 'Please re-authenticate'
            }), 401
        
        # Proceed with normal authentication
        from auth_middleware import validate_token
        decoded_token = validate_token(access_token)
        
        if not decoded_token:
            return jsonify({
                'error': 'Invalid or expired token',
                'error_code': 'INVALID_TOKEN'
            }), 401
        
        # Add user info to request context
        request.user = {
            'id': decoded_token.get('oid'),
            'email': decoded_token.get('upn') or decoded_token.get('email'),
            'name': decoded_token.get('name'),
            'roles': decoded_token.get('roles', []),
            'app_displayname': decoded_token.get('app_displayname'),
            'tenant_id': decoded_token.get('tid')
        }
        
        return f(*args, **kwargs)
    
    return decorated

# Endpoint for manual token refresh
def add_refresh_endpoint(app):
    """Add a dedicated endpoint for token refresh"""
    
    @app.route('/api/auth/refresh', methods=['POST'])
    def refresh_token_endpoint():
        """Manual token refresh endpoint"""
        try:
            data = request.json or {}
            refresh_token = data.get('refresh_token')
            
            if not refresh_token:
                return jsonify({
                    'error': 'Refresh token required',
                    'error_code': 'NO_REFRESH_TOKEN'
                }), 400
            
            # Attempt refresh
            refresh_result = token_manager.refresh_access_token(refresh_token)
            
            if refresh_result['success']:
                return jsonify({
                    'success': True,
                    'access_token': refresh_result['access_token'],
                    'refresh_token': refresh_result['refresh_token'],
                    'expires_in': refresh_result['expires_in'],
                    'token_type': 'Bearer'
                })
            else:
                return jsonify({
                    'error': refresh_result['error'],
                    'error_code': 'REFRESH_FAILED'
                }), 401
        
        except Exception as e:
            logger.error(f"Error in refresh endpoint: {str(e)}")
            return jsonify({
                'error': 'Internal server error',
                'error_code': 'INTERNAL_ERROR'
            }), 500
    
    @app.route('/api/auth/validate', methods=['GET'])
    def validate_token_endpoint():
        """Endpoint to validate current token and check if refresh is needed"""
        try:
            access_token, refresh_token = token_manager.extract_tokens_from_request()
            
            if not access_token:
                return jsonify({
                    'valid': False,
                    'error': 'No token provided'
                }), 401
            
            # Check token status
            is_expired, reason = token_manager.is_token_expired(access_token)
            exp = token_manager.get_token_expiry(access_token)
            
            return jsonify({
                'valid': not is_expired,
                'expires_at': exp,
                'seconds_until_expiry': max(0, exp - time.time()),
                'needs_refresh': is_expired,
                'reason': reason,
                'has_refresh_token': bool(refresh_token)
            })
        
        except Exception as e:
            logger.error(f"Error validating token: {str(e)}")
            return jsonify({
                'valid': False,
                'error': 'Token validation error'
            }), 500

# Usage example for replacing existing @require_auth
"""
# Replace this:
@app.route('/api/chats', methods=['GET'])
@require_auth
def get_chats():
    pass

# With this:
@app.route('/api/chats', methods=['GET'])
@require_auth_with_refresh
def get_chats():
    pass
"""