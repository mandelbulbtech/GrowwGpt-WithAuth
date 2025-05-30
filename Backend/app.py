from flask import Flask, request, jsonify, session
from flask_cors import CORS
import os
from openai import AzureOpenAI
import logging
import json
import tempfile
import uuid
from datetime import datetime, timedelta
import io
import base64
from azure.ai.projects import AIProjectClient
from azure.identity import DefaultAzureCredential
from azure.ai.projects.models import BingGroundingTool
from dotenv import load_dotenv 
from pymongo import MongoClient, DESCENDING, ASCENDING
from bson import ObjectId
import re
from datetime import datetime, timedelta
from urllib.parse import quote_plus
from functools import wraps
from jose import jwt, JWTError
import hashlib

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
 
app = Flask(__name__)

from document_utils import (
    extract_text_from_document
)

from title import(sanitize_title)

from image_generation import(generate_image)

from auth_middleware import require_auth, validate_token, get_token_from_header

from auth_middleware import TENANT_ID, CLIENT_ID, ISSUER

cors_origin= os.environ.get("CORS_ORIGIN")
CORS(app, resources={"*": {"origins": cors_origin}})
 
TEXT_ENDPOINT = os.environ.get("AZURE_OPENAI_ENDPOINT")
TEXT_API_KEY = os.environ.get("AZURE_OPENAI_API_KEY")
TEXT_API_VERSION = os.environ.get("AZURE_OPENAI_API_VERSION")
 
ASSISTANT_PROMPT = os.environ.get("ASSISTANT_PROMPT") 

PROJECT_PROMPT = os.environ.get("PROJECT_PROMPT")

# MongoDB Cosmos DB Connection
password = os.environ.get('COSMOS_DB_PASSWORD')
connection_string_template = os.environ.get('COSMOS_DB_URL')

# Convert <password> to {password} for Python's .format() method
connection_string_template = connection_string_template.replace('<password>', '{password}')

# URL encode the password
encoded_password = quote_plus(password)

# Replace the {password} placeholder with the encoded password
connection_string = connection_string_template.format(password=encoded_password)
print(connection_string)
# Database name from environment
COSMOS_DB_NAME = os.environ.get('COSMOS_DB_NAME')

# Initialize MongoDB client
mongo_client = MongoClient(connection_string)
db = mongo_client[COSMOS_DB_NAME]

chats_collection = db["chats"]
conversations_collection = db["conversations"]

projects_collection = db["projects"]
project_documents_collection = db["project_documents"]

# Create indexes for better performance
chats_collection.create_index([("is_deleted", ASCENDING), ("updated_at", DESCENDING)])
conversations_collection .create_index([("chat_id", ASCENDING), ("order", ASCENDING)])

projects_collection.create_index([("user_id", ASCENDING), ("created_at", DESCENDING)])
project_documents_collection.create_index([("project_id", ASCENDING)])
 
#Initialize the project management module with the app and database


# Updated conversation context storage to support multiple documents
# Format: {conversation_id: {"messages": [], "documents": [], "last_accessed": timestamp}}
conversation_contexts = {}
 
MAX_CONVERSATION_HISTORY = int(os.environ.get("MAX_CONVERSATION_HISTORY"))
CONVERSATION_EXPIRY_HOURS = int(os.environ.get("CONVERSATION_EXPIRY_HOURS"))
MAX_DOCUMENTS_PER_CONVERSATION = int(os.environ.get("MAX_DOCUMENTS_PER_CONVERSATION"))  # Limit the number of documents per conversation
MAX_DOCUMENT_SIZE_MB = int(os.environ.get("MAX_DOCUMENT_SIZE_MB"))  # Maximum document size in MB
 
text_client = AzureOpenAI(
    azure_endpoint=TEXT_ENDPOINT,
    api_key=TEXT_API_KEY,
    api_version=TEXT_API_VERSION
)
 
# init_project_management(app, db)

def get_or_create_conversation(conversation_id=None, user_id=None):
    """Get an existing conversation or create a new one, using both memory and database."""
    now = datetime.now()
    
    # If conversation_id provided and exists in memory, return it
    if conversation_id and conversation_id in conversation_contexts:
        # Update last accessed time
        conversation_contexts[conversation_id]["last_accessed"] = now
        
        # If user_id provided, verify ownership or update if missing
        if user_id:
            context_user_id = conversation_contexts[conversation_id].get("user_id")
            if context_user_id and context_user_id != user_id:
                # Ownership mismatch - this shouldn't normally happen
                logger.warning(f"User ID mismatch for conversation {conversation_id}: {context_user_id} vs {user_id}")
                return None, None
            else:
                # Update user_id if not set
                conversation_contexts[conversation_id]["user_id"] = user_id
                
        return conversation_id, conversation_contexts[conversation_id]
    
    # If conversation_id provided but not in memory, check database
    if conversation_id:
        query = {"_id": conversation_id, "is_deleted": False}
        
        # If user_id provided, verify ownership
        if user_id:
            query["user_id"] = user_id
            
        chat = chats_collection.find_one(query)
        
        if chat:
            # Chat exists in DB but not in memory, load it
            logger.info(f"Loading conversation {conversation_id} from database for user {user_id}")
            
            # Create conversation context in memory
            conversation_contexts[conversation_id] = {
                "messages": [],
                "documents": [],
                "last_accessed": now,
                "user_id": chat.get("user_id")  # Store user_id in context
            }
            
            # Load messages from the conversations collection
            messages = list(conversations_collection.find(
                {"chat_id": conversation_id}
            ).sort("order", ASCENDING))
            
            if messages:
                # Convert messages to format expected by your application
                for msg in messages:
                    # Add user message
                    conversation_contexts[conversation_id]["messages"].append({
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": msg.get("user_role", "")
                            }
                        ]
                    })
                    
                    # Add assistant message
                    conversation_contexts[conversation_id]["messages"].append({
                        "role": "assistant",
                        "content": [
                            {
                                "type": "text",
                                "text": msg.get("assistant_role", "")
                            }
                        ]
                    })
            
            # If there are document references in the chat, we could load them here
            if chat.get("document_names"):
                logger.info(f"Chat has documents: {chat['document_names']}")
                # Note: You'd need to implement document retrieval logic here
            
            return conversation_id, conversation_contexts[conversation_id]
        elif user_id:
            # Chat doesn't exist or doesn't belong to this user
            logger.warning(f"Chat {conversation_id} not found or doesn't belong to user {user_id}")
            return None, None
    
    # Create new conversation
    new_conversation_id = str(uuid.uuid4()) if not conversation_id else conversation_id
    conversation_contexts[new_conversation_id] = {
        "messages": [],
        "documents": [],
        "last_accessed": now,
        "user_id": user_id  # Store user_id in new conversation context
    }
    
    return new_conversation_id, conversation_contexts[new_conversation_id]

def clean_expired_conversations():
    """Remove expired conversations from memory and mark old chats as archived in DB."""
    now = datetime.now()
    expiry_threshold = now - timedelta(hours=CONVERSATION_EXPIRY_HOURS)
    
    # Clear expired conversations from memory
    expired_convos = [
        cid for cid, data in conversation_contexts.items()
        if data["last_accessed"] < expiry_threshold
    ]
    
    for cid in expired_convos:
        del conversation_contexts[cid]
    
    if expired_convos:
        logger.info(f"Cleaned up {len(expired_convos)} expired conversations from memory")
    
    # Optional: You could also archive very old chats in the database
    # This is separated from the memory cleanup to avoid unnecessary DB operations
    db_cleanup_threshold = now - timedelta(days=90)  # Archive chats older than 90 days
    
    try:
        archive_result = chats_collection.update_many(
            {
                "is_deleted": False,
                "updated_at": {"$lt": db_cleanup_threshold}
            },
            {"$set": {"is_archived": True}}
        )
        
        if archive_result.modified_count > 0:
            logger.info(f"Archived {archive_result.modified_count} old chats in the database")
    except Exception as e:
        logger.error(f"Error archiving old chats: {str(e)}")

def get_text_response(model_name, prompt, conversation_context, new_documents_added=False):
   
    try:
        # Initialize system message
        chat_prompt = [
            {
                "role": "system",
                "content": [
                    {
                        "type": "text",
                        "text":  ASSISTANT_PROMPT
            }
        ]
    }
]

       
        # Add document content if available (only for new documents or if not previously mentioned)
        docs_previously_mentioned = any("Here are the documents" in str(m.get("content", "")) for m in conversation_context["messages"])
       
        if conversation_context["documents"] and (new_documents_added or not docs_previously_mentioned):
            # Combine all documents into a single context message
            combined_docs = "Here are the documents that I'd like you to work with:\n\n"
           
            for idx, doc in enumerate(conversation_context["documents"]):
                combined_docs += f"DOCUMENT {idx+1}: {doc['name']}\n"
                combined_docs += f"TYPE: {doc['type']}\n"
                combined_docs += f"CONTENT:\n{doc['text']}\n\n"
                combined_docs += "-" * 40 + "\n\n"
           
            chat_prompt.append({
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": combined_docs
                    }
                ]
            })
           
            # Add a system acknowledgment if new documents were added
            if new_documents_added:
                chat_prompt.append({
                    "role": "assistant",
                    "content": [
                        {
                            "type": "text",
                            "text": f"I've received {len(conversation_context['documents'])} document(s). I'll analyze them and can answer any questions you have about their content."
                        }
                    ]
                })
   
        # Add existing conversation history
        for message in conversation_context["messages"]:
            chat_prompt.append(message)
       
        # Add the current user prompt
        chat_prompt.append({
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": prompt
                }
            ]
        })
       

        completion_params = {
            "model": model_name,
            "messages": chat_prompt,
            "max_completion_tokens": 2000,
            "stream": False
        }
       
        if model_name != 'o3-mini':
            completion_params["temperature"] = 0.7
   
        completion = text_client.chat.completions.create(**completion_params)
        response_text = completion.choices[0].message.content
       
        # Update conversation history
        conversation_context["messages"].append({
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": prompt
                }
            ]
        })
       
        conversation_context["messages"].append({
            "role": "assistant",
            "content": [
                {
                    "type": "text",
                    "text": response_text
                }
            ]
        })
       
        if len(conversation_context["messages"]) > MAX_CONVERSATION_HISTORY:
            conversation_context["messages"] = conversation_context["messages"][-MAX_CONVERSATION_HISTORY:]
       
        return response_text
   
    except Exception as e:
        logger.error(f"Error with text model {model_name}: {str(e)}")
        return f"Error with model {model_name}: {str(e)}"
 
@app.route('/generate-response', methods=['POST'])
@require_auth
def generate_response():
    """Handle text requests with conversation management and multiple document upload."""
    try:
        # Get user info from the authenticated request
        user_id = request.user['id']  # Use the authenticated user's ID
        
        if request.content_type and 'multipart/form-data' in request.content_type:
            model_name = request.form.get('model_name', 'gpt-4o')
            input_text = request.form.get('input_text', '')
            generate_image_flag = request.form.get('generate_image', 'false').lower() == 'true'
            conversation_id = request.form.get('conversation_id')
            clear_history = request.form.get('clear_history', 'false').lower() == 'true'
        else:
            data = request.json or {}
            model_name = data.get('model_name', 'gpt-4o')
            input_text = data.get('input_text', '')
            generate_image_flag = data.get('generate_image', False)
            conversation_id = data.get('conversation_id')
            clear_history = data.get('clear_history', False)
        
        if not user_id:
            return jsonify({'error': 'User ID is required'}), 400
       
        # Clear conversation if requested
        if clear_history and conversation_id and conversation_id in conversation_contexts:
            del conversation_contexts[conversation_id]
            conversation_id = None
       
        # Get or create the conversation
        conversation_id, conversation_context = get_or_create_conversation(conversation_id)
       
        # Flag to track if new documents were added
        new_documents_added = False
        # NEW: List to store only newly uploaded documents for the response
        newly_uploaded_documents = []
       
        # Process document uploads
        if request.content_type and 'multipart/form-data' in request.content_type:
            # Handle multiple file uploads
            if 'documents[]' in request.files:
                uploaded_files = request.files.getlist('documents[]')
               
                if len(conversation_context["documents"]) + len(uploaded_files) > MAX_DOCUMENTS_PER_CONVERSATION:
                    return jsonify({
                        'error': f'Document limit exceeded. Maximum {MAX_DOCUMENTS_PER_CONVERSATION} documents allowed per conversation.'
                    }), 400
               
                for document_file in uploaded_files:
                    if document_file.filename:
                        # Check file size
                        document_file.seek(0, os.SEEK_END)
                        file_size_mb = document_file.tell() / (1024 * 1024)  # Convert to MB
                        document_file.seek(0)  # Reset file pointer
                       
                        if file_size_mb > MAX_DOCUMENT_SIZE_MB:
                            return jsonify({
                                'error': f'File {document_file.filename} exceeds maximum size of {MAX_DOCUMENT_SIZE_MB}MB'
                            }), 400
                       
                        # Get file extension
                        _, file_extension = os.path.splitext(document_file.filename)
                        document_name = document_file.filename
                       
                        document_text = extract_text_from_document(document_file, file_extension)
                        logger.info(f"Document processed: {document_file.filename}")
                       
                        # Create document object
                        document_obj = {
                            "name": document_name,
                            "text": document_text,
                            "type": file_extension.lower(),
                            "uploaded_at": datetime.now().isoformat(),
                            "size_mb": file_size_mb
                        }
                        
                        # Add to the conversation context
                        conversation_context["documents"].append(document_obj)
                        # NEW: Add to the newly uploaded documents list for response
                        newly_uploaded_documents.append(document_obj)
                        new_documents_added = True
                       
            # Also handle single document upload for backward compatibility
            elif 'document' in request.files:
                document_file = request.files['document']
                if document_file.filename:
                    
                    if len(conversation_context["documents"]) + 1 > MAX_DOCUMENTS_PER_CONVERSATION:
                        return jsonify({
                            'error': f'Document limit exceeded. Maximum {MAX_DOCUMENTS_PER_CONVERSATION} documents allowed per conversation.'
                        }), 400
                   
                    # Check file size
                    document_file.seek(0, os.SEEK_END)
                    file_size_mb = document_file.tell() / (1024 * 1024)  # Convert to MB
                    document_file.seek(0)  # Reset file pointer
                   
                    if file_size_mb > MAX_DOCUMENT_SIZE_MB:
                        return jsonify({
                            'error': f'File {document_file.filename} exceeds maximum size of {MAX_DOCUMENT_SIZE_MB}MB'
                        }), 400
                   
                    _, file_extension = os.path.splitext(document_file.filename)
                    document_name = document_file.filename
                   
                    document_text = extract_text_from_document(document_file, file_extension)
                    logger.info(f"Document processed: {document_file.filename}")
                   
                    # Create document object
                    document_obj = {
                        "name": document_name,
                        "text": document_text,
                        "type": file_extension.lower(),
                        "uploaded_at": datetime.now().isoformat(),
                        "size_mb": file_size_mb
                    }
                    
                    # Add to the conversation context
                    conversation_context["documents"].append(document_obj)
                    # NEW: Add to the newly uploaded documents list for response
                    newly_uploaded_documents.append(document_obj)
                    new_documents_added = True
       
        elif request.json:
            if 'document_content' in request.json and 'document_name' in request.json:
                document_text = request.json['document_content']
                document_name = request.json['document_name']
                document_type = os.path.splitext(document_name)[1].lower() if '.' in document_name else '.txt'
               
                logger.info(f"Document provided in JSON: {document_name}")
               
                document_obj = {
                    "name": document_name,
                    "text": document_text,
                    "type": document_type,
                    "uploaded_at": datetime.now().isoformat(),
                    "size_mb": len(document_text) / (1024 * 1024)  
                }
                
                conversation_context["documents"].append(document_obj)
                # NEW: Add to the newly uploaded documents list for response
                newly_uploaded_documents.append(document_obj)
                new_documents_added = True
               
            elif 'documents' in request.json and isinstance(request.json['documents'], list):
                docs = request.json['documents']
               
                if len(conversation_context["documents"]) + len(docs) > MAX_DOCUMENTS_PER_CONVERSATION:
                    return jsonify({
                        'error': f'Document limit exceeded. Maximum {MAX_DOCUMENTS_PER_CONVERSATION} documents allowed per conversation.'
                    }), 400
               
                for doc in docs:
                    if 'content' in doc and 'name' in doc:
                        document_text = doc['content']
                        document_name = doc['name']
                        document_type = os.path.splitext(document_name)[1].lower() if '.' in document_name else '.txt'
                       
                        document_obj = {
                            "name": document_name,
                            "text": document_text,
                            "type": document_type,
                            "uploaded_at": datetime.now().isoformat(),
                            "size_mb": len(document_text) / (1024 * 1024)
                        }
                        
                        conversation_context["documents"].append(document_obj)
                        # NEW: Add to the newly uploaded documents list for response
                        newly_uploaded_documents.append(document_obj)
                        new_documents_added = True
       
       
        if not input_text and new_documents_added:
            input_text = "Please analyze these documents and provide a summary of their key points."
       
        if not input_text and not conversation_context["documents"]:
            return jsonify({'error': 'Either input text or at least one document is required'}), 400
     
        if generate_image_flag:
            logger.info("Image generation requested")
            image_result = generate_image(input_text)
           
            if image_result["success"]:
                return jsonify({
                    'response_type': 'image',
                    'image_url': image_result["image_url"],
                    'prompt': input_text,
                    'conversation_id': conversation_id
                })
            else:
                return jsonify({'error': f"Image generation failed: {image_result['error']}"}), 500
     
        response_text = get_text_response(model_name, input_text, conversation_context, new_documents_added)
       
        if response_text.startswith("Error:"):
            return jsonify({'error': response_text}), 400
       
        result = {
            'response_type': 'text',
            'response': response_text,
            'model_used': model_name,
            'conversation_id': conversation_id
        }
     
        # MODIFIED: Return information about newly uploaded documents only
        if newly_uploaded_documents:
            result['documents_processed'] = len(newly_uploaded_documents)
            result['document_names'] = [doc["name"] for doc in newly_uploaded_documents]
            result['new_documents_added'] = True
            # Optional: Include more details about newly uploaded documents
            result['uploaded_documents'] = [
                {
                    'name': doc['name'],
                    'type': doc['type'],
                    'size_mb': doc['size_mb'],
                    'uploaded_at': doc['uploaded_at']
                }
                for doc in newly_uploaded_documents
            ]
        else:
            result['new_documents_added'] = False
       
        clean_expired_conversations()

        try:
            # Get chat title from first message or use sanitized input text
            chat_title= sanitize_title(input_text)
            chat_id = result['conversation_id']
            existing_chat = chats_collection.find_one({"_id": chat_id})
            
            # Use newly uploaded documents for the database save
            document_names = []
            if newly_uploaded_documents:
                document_names = [doc["name"] for doc in newly_uploaded_documents]
            
            now = datetime.now()
            
            if existing_chat:
                # Optionally check if the user owns this chat
                if existing_chat.get('user_id') and existing_chat.get('user_id') != user_id:
                    return jsonify({'error': 'Access denied to this conversation'}), 403
                    
                # Update existing chat
                chats_collection.update_one(
                    {"_id": chat_id},
                    {
                        "$set": {
                            "updated_at": now,
                            "model_name": model_name,
                            "document_names": document_names,
                            "message_count": existing_chat.get("message_count", 0) + 1,
                            "user_id": user_id  # Update user_id if changed or not set
                        }
                    }
                )
            else:
                # Create new chat
                chats_collection.insert_one({
                    "_id": chat_id,
                    "title": chat_title,
                    "created_at": now,
                    "updated_at": now,
                    "model_name": model_name,
                    "document_names": document_names,
                    "message_count": 1,  # Initial message pair (user + assistant)
                    "is_deleted": False,
                    "user_id": user_id  # Store the OID
                })
            
            # Get next message order and store message with user_id
            next_order = 1
            last_message = conversations_collection.find_one(
                {"chat_id": chat_id},
                sort=[("order", -1)]
            )
            if last_message:
                next_order = last_message.get("order", 0) + 1
            
            # Insert message with user_id
            conversations_collection.insert_one({
                "_id": str(ObjectId()),
                "chat_id": chat_id,
                "user_role": input_text,
                "assistant_role": response_text,
                "content_type": "text", 
                "created_at": now,
                "order": next_order,
                "user_id": user_id  # Store the OID
            })
            
            logger.info(f"Saved chat and message to Cosmos DB for conversation {chat_id} (User: {user_id})")
        except Exception as e:
            logger.error(f"Error saving chat data to Cosmos DB: {str(e)}")
        
        return jsonify(result)
            # Continue processing even if DB save fails
        
    except Exception as e:
        logger.error(f"Error in generate_response: {str(e)}")
        return jsonify({'error': str(e)}), 500
    
@app.route('/api/chats', methods=['GET'])
@require_auth
def get_chats():
    """Get list of chats for sidebar display."""
    try:
        # Get user ID from authenticated request
        user_id = request.user['id']
        
        # Get query parameters for pagination
        page = int(request.args.get('page', 1))
        limit = int(request.args.get('limit', 30))
        skip = (page - 1) * limit
        
        # Query for active chats for this user
        query = {
            "is_deleted": False,
            "user_id": user_id
        }
        
        chats = list(chats_collection.find(
            query,
            {
                "_id": 1, 
                "title": 1, 
                "created_at": 1, 
                "updated_at": 1, 
                "model_name": 1,
                "message_count": 1,
                "document_names": 1
            }
        ).sort("updated_at", DESCENDING).skip(skip).limit(limit))
        
        # Convert datetime objects to strings
        for chat in chats:
            if isinstance(chat.get('created_at'), datetime):
                chat['created_at'] = chat['created_at'].isoformat()
            if isinstance(chat.get('updated_at'), datetime):
                chat['updated_at'] = chat['updated_at'].isoformat()
        
        total_chats = chats_collection.count_documents(query)
        
        return jsonify({
            "chats": chats,
            "total": total_chats,
            "page": page,
            "limit": limit,
            "pages": (total_chats + limit - 1) // limit
        })
        
    except Exception as e:
        logger.error(f"Error fetching chats: {str(e)}")
        return jsonify({'error': f"Failed to retrieve chats: {str(e)}"}), 500
    
@app.route('/api/chats/<chat_id>', methods=['GET'])
@require_auth
def get_chat_messages(chat_id):
    """Get all messages for a specific chat."""
    try:
        # Get user ID from authenticated request
        user_id = request.user['id']
        
        # Verify chat exists and belongs to the user
        chat = chats_collection.find_one({
            "_id": chat_id, 
            "is_deleted": False,
            "user_id": user_id
        })
        
        if not chat:
            return jsonify({'error': 'Chat not found or access denied'}), 404
        
        # Get all message documents for this chat
        messages = list(conversations_collection.find(
            {"chat_id": chat_id, "user_id": user_id}
        ).sort("order", ASCENDING))
        
        # Convert datetime objects to strings
        if isinstance(chat.get('created_at'), datetime):
            chat['created_at'] = chat['created_at'].isoformat()
        if isinstance(chat.get('updated_at'), datetime):
            chat['updated_at'] = chat['updated_at'].isoformat()
        
        for message in messages:
            if isinstance(message.get('created_at'), datetime):
                message['created_at'] = message['created_at'].isoformat()
        
        # Load the conversation into memory if it's not already there
        if chat_id not in conversation_contexts:
            get_or_create_conversation(chat_id)
        
        return jsonify({
            "chat": chat,
            "messages": messages
        })
        
    except Exception as e:
        logger.error(f"Error fetching chat messages: {str(e)}")
        return jsonify({'error': f"Failed to retrieve chat messages: {str(e)}"}), 500
    
@app.route('/api/chats/<chat_id>', methods=['PUT'])
def update_chat(chat_id):
    """Update chat properties (e.g. title)."""
    try:
        data = request.json
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        # Only allow updating certain fields
        allowed_updates = {}
        if 'title' in data and data['title']:
            allowed_updates['title'] = data['title']
        
        if not allowed_updates:
            return jsonify({'error': 'No valid fields to update'}), 400
        
        # Add updated_at timestamp
        allowed_updates['updated_at'] = datetime.now()
        
        # Update the chat
        result = chats_collection.update_one(
            {"_id": chat_id, "is_deleted": False},
            {"$set": allowed_updates}
        )
        
        if result.matched_count == 0:
            return jsonify({'error': 'Chat not found'}), 404
            
        return jsonify({'success': True, 'chat_id': chat_id})
        
    except Exception as e:
        logger.error(f"Error updating chat: {str(e)}")
        return jsonify({'error': f"Failed to update chat: {str(e)}"}), 500

@app.route('/api/chats/<chat_id>', methods=['DELETE'])
@require_auth
def delete_chat(chat_id):
    """Soft delete a chat but hard delete all associated conversations."""
    try:
        user_id = request.user['id']
        
        # Use a transaction to ensure both operations succeed or both fail
        with mongo_client.start_session() as session:
            with session.start_transaction():
                # First, check if the chat exists and belongs to the user
                chat = chats_collection.find_one(
                    {
                        "_id": chat_id, 
                        "is_deleted": False,
                        "user_id": user_id
                    },
                    session=session
                )
                
                if not chat:
                    return jsonify({'error': 'Chat not found or access denied'}), 404
                
                # Delete all conversations associated with this chat
                conversations_delete_result = conversations_collection.delete_many(
                    {
                        "chat_id": chat_id,
                        "user_id": user_id
                    },
                    session=session
                )
                
                # Soft delete the chat (mark as deleted)
                chat_update_result = chats_collection.update_one(
                    {
                        "_id": chat_id,
                        "user_id": user_id
                    },
                    {
                        "$set": {
                            "is_deleted": True, 
                            "updated_at": datetime.now(),
                            "deleted_at": datetime.now()  # Track when it was deleted
                        }
                    },
                    session=session
                )
                
                # Commit the transaction
                logger.info(f"Soft deleted chat {chat_id} and hard deleted {conversations_delete_result.deleted_count} conversations for user {user_id}")
        
        # Remove from in-memory storage if present
        if chat_id in conversation_contexts:
            del conversation_contexts[chat_id]
            
        return jsonify({
            'success': True, 
            'chat_id': chat_id,
            'conversations_deleted': conversations_delete_result.deleted_count
        })
        
    except Exception as e:
        logger.error(f"Error deleting chat: {str(e)}")
        return jsonify({'error': f"Failed to delete chat: {str(e)}"}), 500
    
@app.route('/api/chats', methods=['DELETE'])
def clear_all_chats():
    """Clear all chats (soft delete)."""
    try:
        # Soft delete all chats
        result = chats_collection.update_many(
            {"is_deleted": False},
            {"$set": {"is_deleted": True, "updated_at": datetime.now()}}
        )
        
        # Clear in-memory conversation contexts
        conversation_contexts.clear()
        
        return jsonify({
            'success': True, 
            'chats_deleted': result.modified_count
        })
        
    except Exception as e:
        logger.error(f"Error clearing all chats: {str(e)}")
        return jsonify({'error': f"Failed to clear chats: {str(e)}"}), 500

@app.route('/api/chats/new', methods=['POST'])
def create_new_chat():
    """Create a new empty chat."""
    try:
        # Get user_id from request body
        data = request.json or {}
        user_id = data.get('user_id')
        
        if not user_id:
            return jsonify({'error': 'User ID is required'}), 400
        
        # Generate a new conversation ID
        chat_id = str(uuid.uuid4())
        now = datetime.now()
        
        # Create a new chat in the database
        chats_collection.insert_one({
            "_id": chat_id,
            "title": "New Chat",
            "created_at": now,
            "updated_at": now,
            "model_name": "gpt-4o",  # Default model
            "document_names": [],
            "message_count": 0,
            "is_deleted": False,
            "user_id": user_id
        })
        
        # Create a conversation context in memory
        conversation_contexts[chat_id] = {
            "messages": [],
            "documents": [],
            "last_accessed": now,
            "user_id": user_id
        }
        
        return jsonify({
            'success': True,
            'chat_id': chat_id
        })
        
    except Exception as e:
        logger.error(f"Error creating new chat: {str(e)}")
        return jsonify({'error': f"Failed to create new chat: {str(e)}"}), 500
    
@app.route('/api/bing-grounding', methods=['POST'])
@require_auth
def bing_grounding():
    """Enhanced Bing Grounding API with citation handling based on the Azure SDK example."""
    try:
        # Get user info from the authenticated request
        user_id = request.user['id']  # Use the authenticated user's ID
        
        data = request.json
        if not data or 'query' not in data:
            return jsonify({'error': 'Query parameter is required'}), 400
        
        query = data.get('query')
        model = data.get('model', 'gpt-4o')
        conversation_id = data.get('conversation_id')
        
        logger.info(f"Bing Grounding API with query: {query}")
       
        # Keep existing context management but include user_id
        conversation_context = None
        if conversation_id:
            if conversation_id in conversation_contexts:
                conversation_id, conversation_context = get_or_create_conversation(conversation_id, user_id)
                logger.info(f"Using existing conversation: {conversation_id}")
            else:
                # Create new conversation with the given ID if it doesn't exist
                conversation_id, conversation_context = get_or_create_conversation(conversation_id, user_id)
                logger.info(f"Created new conversation with provided ID: {conversation_id}")
        else:
            # Create a new conversation if none provided
            conversation_id, conversation_context = get_or_create_conversation(None, user_id)
            logger.info(f"Created new conversation: {conversation_id}")
       
        # Get environment variables with fallbacks to hardcoded values
        project_conn_str = os.environ.get("PROJECT_CONNECTION_STRING")
        bing_conn_name = os.environ.get("BING_CONNECTION_NAME")
       
        if not project_conn_str or not bing_conn_name:
            missing_vars = []
            if not project_conn_str:
                missing_vars.append("PROJECT_CONNECTION_STRING")
            if not bing_conn_name:
                missing_vars.append("BING_CONNECTION_NAME")
               
            return jsonify({
                'error': f'Missing required environment variables: {", ".join(missing_vars)}',
                'status': 'configuration_error'
            }), 400
       
        # Try to initialize the Azure AI Project client
        try:
            # Following the structure of the provided code snippet
            from azure.ai.projects.models import MessageRole
            
            # Create an Azure AI Client using DefaultAzureCredential
            project_client = AIProjectClient.from_connection_string(
                credential=DefaultAzureCredential(),
                conn_str=project_conn_str,
            )
           
            # Get the Bing connection
            bing_connection = project_client.connections.get(
                connection_name=bing_conn_name
            )
            conn_id = bing_connection.id
            logger.info(f"Retrieved Bing connection ID: {conn_id}")
           
            # Initialize agent Bing tool and add the connection id
            bing = BingGroundingTool(connection_id=conn_id)
           
            # Generate a unique name for the agent
            agent_name = f"agent-{uuid.uuid4()}"
           
            # Build context from conversation history and documents if available
            context = ""
           
            if conversation_context:
                # Add document context if available
                if conversation_context["documents"]:
                    context += "I have access to the following documents:\n"
                    for idx, doc in enumerate(conversation_context["documents"]):
                        context += f"Document {idx+1}: {doc['name']} ({doc['type']})\n"
                    context += "\n"
               
                # Add conversation history context - handle both message formats
                if conversation_context["messages"]:
                    context += "Here's some context from our conversation:\n"
                    # Get the last few messages
                    recent_messages = conversation_context["messages"][-5:]
                    for msg in recent_messages:
                        role = msg.get("role", "")
                        content_blocks = msg.get("content", [])
                        
                        # Extract message text, handling both formats
                        msg_text = ""
                        if isinstance(content_blocks, list):
                            for block in content_blocks:
                                if isinstance(block, dict) and block.get("type") == "text":
                                    msg_text += block.get("text", "")
                        
                        if msg_text:
                            context += f"{role.capitalize()}: {msg_text}\n"
                    context += "\n"
           
            # Get the assistant prompt from environment variable
            assistant_prompt = os.environ.get("BING_ASSISTANT_PROMPT")
            
            # Base instructions
            instructions = f"""You are AN Assist, an advanced AI assistant.

{assistant_prompt}

{context}

Based on the above context, answer the following question:
{query}
"""
           
            # Create agent with the Bing tool and process assistant run - following the SDK example structure
            with project_client:
                # Create the agent
                agent = project_client.agents.create_agent(
                    model=model,
                    name=agent_name,
                    instructions=instructions,
                    tools=bing.definitions,
                    headers={"x-ms-enable-preview": "true"},
                )
                agent_id = agent.id
                logger.info(f"Created agent with ID: {agent.id}")
               
                # Create thread for communication
                thread = project_client.agents.create_thread()
                logger.info(f"Created thread, ID: {thread.id}")
               
                # Create message in thread
                message = project_client.agents.create_message(
                    thread_id=thread.id,
                    role=MessageRole.USER,
                    content=query,
                )
                logger.info(f"Created message, ID: {message.id}")
               
                # Create and process agent run in thread with tools
                run = project_client.agents.create_and_process_run(
                    thread_id=thread.id, 
                    agent_id=agent.id
                )
                logger.info(f"Run finished with status: {run.status}")
                
                if run.status == "failed":
                    logger.error(f"Run failed: {run.last_error}")
                    return jsonify({
                        'error': f"Agent run failed: {run.last_error}",
                        'status': 'run_failed'
                    }), 500
                
                # Extract search queries for reporting
                search_queries = []
                run_steps = project_client.agents.list_run_steps(
                    run_id=run.id,
                    thread_id=thread.id
                )
                run_steps_data = run_steps.get('data', [])
                
                for step in run_steps_data:
                    if step.get("type") == "tool_calls":
                        tool_calls = step.get("step_details", {}).get("tool_calls", [])
                        for call in tool_calls:
                            if call.get("type") == "bing_search":
                                input_data = call.get("bing_search", {}).get("input", {})
                                if "query" in input_data:
                                    search_queries.append(input_data["query"])
                
                # Get the response directly using get_last_message_by_role as in the SDK example
                response_message = project_client.agents.list_messages(thread_id=thread.id).get_last_message_by_role(
                    MessageRole.AGENT
                )
                
                # Process the response message
                final_response = ""
                url_citations = []
                
                if response_message:
                    # Gather text from the response
                    for text_message in response_message.text_messages:
                        final_response += text_message.text.value + "\n\n"
                    
                    # Gather URL citations
                    for annotation in response_message.url_citation_annotations:
                        url_citation = {
                            "title": annotation.url_citation.title,
                            "url": annotation.url_citation.url
                        }
                        url_citations.append(url_citation)
                        
                        # Add to final response if not already there
                        citation_text = f"URL Citation: [{annotation.url_citation.title}]({annotation.url_citation.url})"
                        if citation_text not in final_response:
                            final_response += f"\n{citation_text}"
                
                # Delete the agent when done
                try:
                    project_client.agents.delete_agent(agent.id)
                    logger.info("Deleted agent")
                except Exception as e:
                    logger.warning(f"Failed to delete agent {agent.id}: {str(e)}")
                
                # If conversation_context exists, update it in the SAME FORMAT as generate_response
                if conversation_context:
                    # Add messages to the in-memory context in the expected format
                    conversation_context["messages"].append({
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": query
                            }
                        ]
                    })
                   
                    conversation_context["messages"].append({
                        "role": "assistant",
                        "content": [
                            {
                                "type": "text",
                                "text": final_response
                            }
                        ]
                    })
                   
                    # Limit conversation history size
                    if len(conversation_context["messages"]) > MAX_CONVERSATION_HISTORY:
                        conversation_context["messages"] = conversation_context["messages"][-MAX_CONVERSATION_HISTORY:]
               
                # Organize sources for the result
                sources = {}
                for idx, citation in enumerate(url_citations):
                    sources[str(idx)] = {
                        "title": citation["title"],
                        "url": citation["url"],
                        "snippet": ""  # URL citations might not include snippets
                    }
               
                # Return the results with conversation_id and sources
                result = {
                    'status': 'success',
                    'query': query,
                    'model': model,
                    'response': final_response,
                    'search_queries_used': search_queries,
                    'sources': sources,
                    'run_status': run.status,
                    'conversation_id': conversation_id
                }
               
                # Save to Cosmos DB in the SAME FORMAT as generate_response
                try:
                    # Get chat title from query
                    chat_title = sanitize_title(query)
                    now = datetime.now()
                    
                    # Store or update chat record
                    existing_chat = chats_collection.find_one({"_id": conversation_id})
                    
                    if existing_chat:
                        # Verify user ownership if the chat exists
                        if existing_chat.get('user_id') and existing_chat.get('user_id') != user_id:
                            logger.warning(f"User {user_id} attempted to access chat {conversation_id} owned by {existing_chat.get('user_id')}")
                            return jsonify({'error': 'Access denied to this conversation'}), 403
                            
                        # Update existing chat
                        chats_collection.update_one(
                            {"_id": conversation_id},
                            {
                                "$set": {
                                    "updated_at": now,
                                    "model_name": model,
                                    "message_count": existing_chat.get("message_count", 0) + 1,
                                    "user_id": user_id  # Ensure user_id is updated
                                }
                            }
                        )
                    else:
                        # Create new chat
                        chats_collection.insert_one({
                            "_id": conversation_id,
                            "title": chat_title,
                            "created_at": now,
                            "updated_at": now,
                            "model_name": model,
                            "document_names": [],
                            "message_count": 1,
                            "is_deleted": False,
                            "user_id": user_id
                        })
                    
                    # Get next message order
                    next_order = 1
                    last_message = conversations_collection.find_one(
                        {"chat_id": conversation_id},
                        sort=[("order", -1)]
                    )
                    if last_message:
                        next_order = last_message.get("order", 0) + 1
                    
                    # Store message in the SAME FORMAT as generate_response
                    conversations_collection.insert_one({
                        "_id": str(ObjectId()),
                        "chat_id": conversation_id,
                        "user_role": query,
                        "assistant_role": final_response,
                        "content_type": "text",
                        "created_at": now,
                        "order": next_order,
                        "user_id": user_id
                    })
                    
                    logger.info(f"Saved Bing grounding chat to Cosmos DB for conversation {conversation_id} (User: {user_id})")
                except Exception as e:
                    logger.error(f"Error saving Bing grounding chat to Cosmos DB: {str(e)}")
                    # Continue processing even if DB save fails

                return jsonify(result)
               
        except Exception as e:
            logger.error(f"Error during Bing Grounding API call: {str(e)}")
            return jsonify({
                'error': f"Azure AI Project client error: {str(e)}",
                'status': 'api_error'
            }), 500
           
    except Exception as e:
        logger.error(f"Unexpected error in Bing Grounding endpoint: {str(e)}")
        return jsonify({
            'error': f"Unexpected error: {str(e)}",
            'status': 'internal_error'
        }), 500

# Add these error handlers
@app.errorhandler(401)
def unauthorized_error(error):
    return jsonify({
        'error': 'Unauthorized',
        'message': 'Valid authentication credentials are required'
    }), 401

@app.errorhandler(403)
def forbidden_error(error):
    return jsonify({
        'error': 'Forbidden',
        'message': 'You do not have permission to access this resource'
    }), 403

shared_chats_collection = db["shared_chats"]
shared_conversations_collection = db["shared_conversations"]

# Create indexes for shared collections
shared_chats_collection.create_index([("share_id", ASCENDING)])
shared_chats_collection.create_index([("original_chat_id", ASCENDING)])
shared_conversations_collection.create_index([("share_id", ASCENDING), ("order", ASCENDING)])

def generate_share_id(chat_id):
    """Generate a unique share ID for a chat."""
    # Create a hash using chat_id and timestamp to ensure uniqueness
    hash_input = f"{chat_id}:{datetime.now().isoformat()}"
    share_id = hashlib.sha256(hash_input.encode()).hexdigest()[:32]
    return share_id

@app.route('/login')
def login():
    return jsonify({'status':200, 'message':"Sucess" })
 
@app.route('/api/chats/<chat_id>/share', methods=['POST'])
def share_chat(chat_id):
    """Create a shareable link for a chat."""
    try:
        cors_origin = os.environ.get("CORS_ORIGIN")
        
        # Check if chat exists
        chat = chats_collection.find_one({
            "_id": chat_id,
            "is_deleted": False
        })
        
        if not chat:
            return jsonify({'error': 'Chat not found'}), 404
        
        # Check if chat is already shared
        existing_share = shared_chats_collection.find_one({
            "original_chat_id": chat_id
        })
        
        if existing_share:
            return jsonify({
                'success': True,
                'share_id': existing_share['share_id'],
                'share_url': f"/share/{existing_share['share_id']}",
                'message': 'Chat is already shared'
            })
        
        # Generate a unique share ID
        share_id = generate_share_id(chat_id)
        
        # Get all messages for this chat
        messages = list(conversations_collection.find({
            "chat_id": chat_id
        }).sort("order", ASCENDING))
        
        # Create shared chat record
        shared_chat_data = {
            "_id": share_id,
            "share_id": share_id,
            "original_chat_id": chat_id,
            "user_id": chat.get('user_id'),  # Store the original chat owner if available
            "title": chat.get('title', 'Untitled Chat'),
            "created_at": chat.get('created_at'),
            "shared_at": datetime.now(),
            "model_name": chat.get('model_name'),
            "document_names": chat.get('document_names', []),
            "message_count": len(messages),
            "is_active": True
        }
        
        cors_origin= os.environ.get("CORS_ORIGIN")
        shared_chats_collection.insert_one(shared_chat_data)
        
        # Copy all messages to shared collection
        for message in messages:
            shared_message = {
                "_id": str(ObjectId()),
                "share_id": share_id,
                "original_message_id": message.get('_id'),
                "user_role": message.get('user_role', ''),
                "assistant_role": message.get('assistant_role', ''),
                "content_type": message.get('content_type', 'text'),
                "order": message.get('order', 0),
                "created_at": message.get('created_at')
            }
            shared_conversations_collection.insert_one(shared_message)
        
        return jsonify({
            'success': True,
            'share_id': share_id,
            'share_url': f"{cors_origin}/share/{share_id}",
            'message': 'Chat shared successfully'
        })
        
    except Exception as e:
        logger.error(f"Error sharing chat: {str(e)}")
        return jsonify({'error': f"Failed to share chat: {str(e)}"}), 500

@app.route('/share/<share_id>', methods=['GET'])
def get_shared_chat(share_id):
    """Get shared chat without authentication."""
    try:
        # Find the shared chat
        shared_chat = shared_chats_collection.find_one({
            "share_id": share_id,
            "is_active": True
        })
        
        if not shared_chat:
            return jsonify({'error': 'Shared chat not found or no longer available'}), 404
        
        # Get messages for the shared chat
        messages = list(shared_conversations_collection.find({
            "share_id": share_id
        }).sort("order", ASCENDING))
        
        # Convert datetime objects to strings
        if isinstance(shared_chat.get('created_at'), datetime):
            shared_chat['created_at'] = shared_chat['created_at'].isoformat()
        if isinstance(shared_chat.get('shared_at'), datetime):
            shared_chat['shared_at'] = shared_chat['shared_at'].isoformat()
        
        for message in messages:
            if isinstance(message.get('created_at'), datetime):
                message['created_at'] = message['created_at'].isoformat()
            # Remove internal IDs from response
            message.pop('_id', None)
            message.pop('original_message_id', None)
        
        # Remove sensitive information from response
        response_data = {
            "title": shared_chat.get('title'),
            "created_at": shared_chat.get('created_at'),
            "shared_at": shared_chat.get('shared_at'),
            "model_name": shared_chat.get('model_name'),
            "document_names": shared_chat.get('document_names', []),
            "message_count": shared_chat.get('message_count'),
            "messages": messages
        }
        
        return jsonify(response_data)
        
    except Exception as e:
        logger.error(f"Error getting shared chat: {str(e)}")
        return jsonify({'error': f"Failed to retrieve shared chat: {str(e)}"}), 500


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))
 
 
 

 
