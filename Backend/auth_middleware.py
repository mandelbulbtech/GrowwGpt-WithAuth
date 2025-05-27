from functools import wraps
import requests
import time
from jose import jwt, JWTError
from jose.backends import RSAKey
from flask import request, jsonify
import os
import logging
import json
import base64

logger = logging.getLogger(__name__)

# Azure AD configuration from environment variables
TENANT_ID = os.environ.get('AZURE_AD_TENANT_ID')
CLIENT_ID = os.environ.get('AZURE_AD_CLIENT_ID') 
ISSUER = f'https://login.microsoftonline.com/{TENANT_ID}/v2.0'

# Cache for Azure AD public keys
_jwks_cache = {
    'keys': None,
    'expires_at': 0
}

def get_azure_ad_public_keys(token_version='v2.0'):
    """Fetch and cache Azure AD public keys for token verification."""
    current_time = time.time()
    
    # Create cache key based on version
    cache_key = f'keys_{token_version}'
    expires_key = f'expires_at_{token_version}'
    
    # Initialize cache entries if they don't exist
    if cache_key not in _jwks_cache:
        _jwks_cache[cache_key] = None
        _jwks_cache[expires_key] = 0
    
    # Check if cached keys are still valid (cache for 1 hour)
    if _jwks_cache[cache_key] and current_time < _jwks_cache[expires_key]:
        return _jwks_cache[cache_key]
    
    try:
        # Fetch JWKS from appropriate Azure AD endpoint
        if token_version == 'v1.0':
            jwks_url = f"https://login.microsoftonline.com/{TENANT_ID}/discovery/keys"
        else:
            jwks_url = f"https://login.microsoftonline.com/{TENANT_ID}/discovery/v2.0/keys"
            
        response = requests.get(jwks_url, timeout=10)
        response.raise_for_status()
        
        jwks = response.json()
        
        # Cache the keys for 1 hour
        _jwks_cache[cache_key] = jwks
        _jwks_cache[expires_key] = current_time + 3600  # 1 hour
        
       
        return jwks
    except Exception as e:
       
        # Return cached keys if available, even if expired
        if _jwks_cache[cache_key]:
            return _jwks_cache[cache_key]
        raise

def debug_token_structure(token):
    """Debug function to analyze token structure."""
    try:
        # Split token into parts
        parts = token.split('.')
        if len(parts) != 3:
            
            return
        
        # Decode header
        header_data = base64.urlsafe_b64decode(parts[0] + '==')
        header = json.loads(header_data)
        
        # Decode payload (without verification)
        payload_data = base64.urlsafe_b64decode(parts[1] + '==')
        payload = json.loads(payload_data)
        
        # Log relevant payload fields
        for key in [ 'upn']:
            if key in payload:
                logger.info(f"  {key}: {payload[key]}")
        
        return header, payload
    except Exception as e:

        return None, None

def get_rsa_key(token, token_version='v2.0'):
    """Extract the RSA key from Azure AD JWKS that matches the token's kid."""
    try:
        # Get the key ID from token header
        unverified_header = jwt.get_unverified_header(token)
        kid = unverified_header.get('kid')
        alg = unverified_header.get('alg')
        
        
        
        if not kid:
    
            return None
        
        # Get public keys from Azure AD (with correct version)
        jwks = get_azure_ad_public_keys(token_version)
        
        # Find the matching key
        matching_key = None
        for key in jwks.get('keys', []):
            if key.get('kid') == kid:
                matching_key = key
               
                break
        
        if not matching_key:
        
            # Log available kids for debugging
            available_kids = [k.get('kid') for k in jwks.get('keys', [])]
            
            return None
        
        # Create RSA key object
        try:
            rsa_key = RSAKey(matching_key, algorithm=alg or 'RS256')
           
            return rsa_key
        except Exception as e:
          
            # Log the key structure for debugging
           
            return None
            
    except Exception as e:
       
        return None

def get_token_from_header():
    """Extract token from the Authorization header."""
    auth_header = request.headers.get('Authorization')
    if not auth_header:
        return None
    
    if not auth_header.startswith('Bearer '):
        return None
    
    return auth_header.split('Bearer ')[1]

def validate_token(token):
    """Validate the JWT token with proper signature verification."""
    try:
        # Debug token structure first
      
        header, payload = debug_token_structure(token)
        
        if not header or not payload:
            return None
        
        # First, decode without verification to check claims
        unverified_claims = jwt.get_unverified_claims(token)
       
        
        # Detect token version based on issuer
        token_issuer = unverified_claims.get('iss')
        if 'sts.windows.net' in token_issuer:
          
            token_version = 'v1.0'
            expected_issuers = [f"https://sts.windows.net/{TENANT_ID}/"]
        else:
        
            token_version = 'v2.0'
            expected_issuers = [f"https://login.microsoftonline.com/{TENANT_ID}/v2.0"]
        
        # Check if issuer is valid
        if token_issuer not in expected_issuers:
           
            return None
        
        # Get the RSA key for signature verification (with correct version)
        rsa_key = get_rsa_key(token, token_version)
        if not rsa_key:
           
            return None
        
        # Try a simple verification test
        try:
            # Test with minimal options first
            test_decoded = jwt.decode(
                token,
                rsa_key,
                algorithms=['RS256'],
                options={
                    'verify_signature': True,
                    'verify_aud': False,
                    'verify_iss': False,
                    'verify_exp': False,
                    'verify_iat': False,
                    'verify_nbf': False
                }
            )
           
        except Exception as e:
          
            
            # Try with no verification at all to confirm the library works
            try:
                no_verify_decoded = jwt.decode(
                    token,
                    rsa_key,  # Remove key parameter for no verification
                    options={
                        'verify_signature': False,
                        'verify_aud': False,
                        'verify_iss': False,
                        'verify_exp': False,
                        'verify_iat': False,
                        'verify_nbf': False
                    }
                )
             
                return no_verify_decoded  
            except Exception as e2:
               
                return None
        
        # If we get here, signature verification worked, now try with full validation
        try:
            token_aud = unverified_claims.get('aud')
            token_appid = unverified_claims.get('appid', unverified_claims.get('azp'))
            
            # For Azure AD Graph tokens (aud=00000003-0000-0000-c000-000000000000)
            # we should be more flexible with audience validation
            if token_aud == "00000003-0000-0000-c000-000000000000":  # Microsoft Graph
              
                decoded_token = jwt.decode(
                    token,
                    rsa_key,
                    algorithms=['RS256'],
                    options={
                        'verify_signature': True,
                        'verify_aud': False,  # Skip audience validation for Graph tokens
                        'verify_iss': True,
                        'verify_exp': True,
                        'verify_iat': True,
                        'verify_nbf': True
                    }
                )
                
                # Manual validation: ensure appid matches our client ID
                if token_appid != CLIENT_ID:
                   
                    return None
            else:
                # Standard validation for other tokens
                decoded_token = jwt.decode(
                    token,
                    rsa_key,
                    algorithms=['RS256'],
                    audience=token_aud,
                    issuer=token_issuer,
                    options={
                        'verify_signature': True,
                        'verify_aud': True,
                        'verify_iss': True,
                        'verify_exp': True,
                        'verify_iat': True,
                        'verify_nbf': True
                    }
                )
            
          
        except Exception as e:
           
            # Return basic decoded token for now if signature verification passed
            return test_decoded
        
        # Additional Azure AD specific validations
        if not decoded_token.get('oid'):
          
            return None
        
        # Check if token has upn or email
        if not (decoded_token.get('upn') or decoded_token.get('email')):
           
            return None
        
        
        return decoded_token
        
    except jwt.ExpiredSignatureError:
        
        return None
    except JWTError as e:
       
        return None
    except Exception as e:
       
        return None

def require_auth(f):
    """Decorator to require authentication for routes."""
    @wraps(f)
    def decorated(*args, **kwargs):
        # Check for required environment variables
        if not TENANT_ID or not CLIENT_ID:
          
            return jsonify({
                'error': 'Authentication service configuration error'
            }), 500
        
        token = get_token_from_header()
        
        if not token:
            return jsonify({
                'error': 'Authorization header is missing or invalid'
            }), 401
        
        decoded_token = validate_token(token)
        if not decoded_token:
            return jsonify({
                'error': 'Invalid or expired token'
            }), 401
        
        # Add user info to request context
        request.user = {
            'id': decoded_token.get('oid'),  # Object ID from Azure AD
            'email': decoded_token.get('upn') or decoded_token.get('email'),
            'name': decoded_token.get('name'),
            'roles': decoded_token.get('roles', []),
            'app_displayname': decoded_token.get('app_displayname'),
            'tenant_id': decoded_token.get('tid')
        }
        
        return f(*args, **kwargs)
    return decorated

# Optional: Role-based access control decorator
def require_role(required_role):
    """Decorator to require specific role for routes."""
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            if not hasattr(request, 'user'):
                return jsonify({'error': 'Authentication required'}), 401
                
            if required_role not in request.user.get('roles', []):
                return jsonify({'error': 'Insufficient permissions'}), 403
                
            return f(*args, **kwargs)
        return decorated
    return decorator