#!/usr/bin/env python3
"""
Create necessary folder structure in Azure Blob Storage
"""
import os
from azure.storage.blob import BlobServiceClient, ContentSettings
from dotenv import load_dotenv

load_dotenv()

def create_blob_folders():
    """Create markdown folder in blob storage"""
    blob_connection_string = os.getenv("BLOB_CONNECTION_STRING")
    blob_container_name = os.getenv("BLOB_CONTAINER_NAME", "dropbox")
    
    if not blob_connection_string:
        print("❌ BLOB_CONNECTION_STRING not found in environment")
        return
    
    print(f"Connecting to blob storage container: {blob_container_name}")
    blob_service_client = BlobServiceClient.from_connection_string(blob_connection_string)
    
    # Get container client
    container_client = blob_service_client.get_container_client(blob_container_name)
    
    # Check if container exists, create if not
    try:
        container_client.get_container_properties()
        print(f"✓ Container '{blob_container_name}' exists")
    except Exception as e:
        print(f"Creating container '{blob_container_name}'...")
        container_client.create_container()
        print(f"✓ Container '{blob_container_name}' created")
    
    # Create markdown folder by uploading a placeholder file
    # In blob storage, folders are virtual - created when you upload a blob with a path
    markdown_placeholder = "markdown/.keep"
    blob_client = blob_service_client.get_blob_client(
        container=blob_container_name,
        blob=markdown_placeholder
    )
    
    try:
        # Check if it already exists
        blob_client.get_blob_properties()
        print(f"✓ Folder 'markdown/' already exists")
    except Exception:
        # Create placeholder file
        blob_client.upload_blob(
            b"# Placeholder file to create markdown folder",
            overwrite=True,
            content_settings=ContentSettings(content_type="text/plain")
        )
        print(f"✓ Created folder 'markdown/' with placeholder file")
    
    print("\n============================================================")
    print("✓ Blob storage folder structure ready!")
    print("============================================================")

if __name__ == "__main__":
    create_blob_folders()

