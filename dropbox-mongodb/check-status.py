#!/usr/bin/env python3
"""Check the processing status of a file"""

import os
import sys
from pathlib import Path
from dotenv import load_dotenv
from pymongo import MongoClient
from bson import ObjectId
from azure.storage.blob import BlobServiceClient

# Load environment variables
env_path = Path(__file__).parent / "worker" / ".env"
if env_path.exists():
    load_dotenv(env_path)

MONGODB_URI = os.getenv("MONGODB_URI")
MONGODB_DATABASE = os.getenv("MONGODB_DATABASE", "isaac-dropbox")
BLOB_CONNECTION_STRING = os.getenv("BLOB_CONNECTION_STRING")
BLOB_CONTAINER_NAME = os.getenv("BLOB_CONTAINER_NAME", "dropbox")

def check_file_status(file_id: str):
    """Check the status of a file in MongoDB"""
    client = MongoClient(MONGODB_URI)
    db = client[MONGODB_DATABASE]
    
    try:
        file_obj_id = ObjectId(file_id)
    except:
        print(f"Error: Invalid file ID format: {file_id}")
        return
    
    # Get file record
    file_record = db.dropbox_files.find_one({"_id": file_obj_id})
    
    if not file_record:
        print(f"File not found in MongoDB: {file_id}")
        return
    
    print("=" * 60)
    print("FILE PROCESSING STATUS")
    print("=" * 60)
    print(f"\nFile ID: {file_id}")
    print(f"Filename: {file_record.get('filename', 'N/A')}")
    print(f"Dropbox Path: {file_record.get('dropbox_path', 'N/A')}")
    print(f"File Type: {file_record.get('file_type', 'N/A')}")
    print(f"File Size: {file_record.get('file_size', 0):,} bytes")
    print(f"\nProcessing Status: {file_record.get('processing_status', 'unknown')}")
    print(f"Chunk Count: {file_record.get('chunk_count', 0)}")
    
    if file_record.get('markdown_blob_url'):
        print(f"Markdown URL: {file_record.get('markdown_blob_url')[:80]}...")
    
    if file_record.get('processing_metadata'):
        pm = file_record.get('processing_metadata', {})
        if pm.get('last_error'):
            print(f"\n⚠ Last Error: {pm.get('last_error')}")
        if pm.get('attempts'):
            print(f"Processing Attempts: {pm.get('attempts')}")
        if pm.get('processing_time'):
            print(f"Processing Time: {pm.get('processing_time'):.2f} seconds")
    
    print(f"\nCreated At: {file_record.get('created_at', 'N/A')}")
    print(f"Updated At: {file_record.get('updated_at', 'N/A')}")
    
    # Check chunks
    chunk_count = db.dropbox_chunks.count_documents({"file_id": file_obj_id})
    print(f"\nChunks in Database: {chunk_count}")
    
    if chunk_count > 0:
        # Get sample chunk
        sample_chunk = db.dropbox_chunks.find_one({"file_id": file_obj_id})
        if sample_chunk:
            has_embedding = "embedding" in sample_chunk and sample_chunk["embedding"] is not None
            print(f"Sample Chunk:")
            print(f"  - Index: {sample_chunk.get('chunk_index', 'N/A')}")
            print(f"  - Has Embedding: {has_embedding}")
            print(f"  - Token Count: {sample_chunk.get('token_count', 'N/A')}")
            print(f"  - Content Preview: {sample_chunk.get('content', '')[:100]}...")
    
    # Check for markdown in blob storage
    if BLOB_CONNECTION_STRING:
        print("\n" + "=" * 60)
        print("BLOB STORAGE CHECK")
        print("=" * 60)
        try:
            blob_service_client = BlobServiceClient.from_connection_string(BLOB_CONNECTION_STRING)
            container_client = blob_service_client.get_container_client(BLOB_CONTAINER_NAME)
            
            # Blob path is markdown/{file_id}.md within the dropbox container
            markdown_blob_name = f"markdown/{file_id}.md"
            blob_client = container_client.get_blob_client(markdown_blob_name)
            
            if blob_client.exists():
                props = blob_client.get_blob_properties()
                print(f"\n✓ Markdown file exists in blob storage")
                print(f"  Blob: {markdown_blob_name}")
                print(f"  Size: {props.size:,} bytes")
                print(f"  Last Modified: {props.last_modified}")
            else:
                print(f"\n✗ Markdown file not found: {markdown_blob_name}")
        except Exception as e:
            print(f"\nError checking blob storage: {e}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python check-status.py <file_id>")
        print("\nExample:")
        print("  python check-status.py 691c7c5e189bc4bbcb072913")
        sys.exit(1)
    
    file_id = sys.argv[1]
    check_file_status(file_id)

