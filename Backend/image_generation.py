import os
from openai import AzureOpenAI
import logging
import json

DALLE_ENDPOINT = os.environ.get("AZURE_DALLE_ENDPOINT")
DALLE_API_KEY = os.environ.get("AZURE_DALLE_API_KEY")
DALLE_API_VERSION = os.environ.get("DALLE_API_VERSION")
DALLE_DEPLOYMENT = os.environ.get("DALLE_DEPLOYMENT")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def get_dalle_client():
    client = AzureOpenAI(
        api_version=DALLE_API_VERSION,
        azure_endpoint=DALLE_ENDPOINT,
        api_key=DALLE_API_KEY
    )
    return client
 
def generate_image(prompt):
    try:
        logger.info(f"Generating image with prompt: {prompt}")
        dalle_client = get_dalle_client()
       
        result = dalle_client.images.generate(
            model=DALLE_DEPLOYMENT,
            prompt=prompt,
            n=1,
            style="vivid",
            quality="standard",
        )
       
        response_json = json.loads(result.model_dump_json())
        image_url = response_json['data'][0]['url']
       
        logger.info(f"Image generated successfully: {image_url[:30]}...")
        return {"success": True, "image_url": image_url}
   
    except Exception as e:
        logger.error(f"Error generating image: {str(e)}")
        return {"success": False, "error": str(e)}