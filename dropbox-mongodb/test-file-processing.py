#!/usr/bin/env python3
"""
Test script to send a local file to the Dropbox worker for processing.
This script:
1. Uploads the file to Azure Blob Storage
2. Creates a MongoDB record
3. Sends a message to the Service Bus queue
"""

import os
import sys
import json
import hashlib
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv
from azure.storage.blob import BlobServiceClient
from azure.servicebus import ServiceBusClient, ServiceBusMessage
from pymongo import MongoClient
from bson import ObjectId

# Load environment variables
env_path = Path(__file__).parent / "worker" / ".env"
if env_path.exists():
    load_dotenv(env_path)
else:
    print(f"Warning: {env_path} not found. Using system environment variables.")

# Required environment variables
MONGODB_URI = os.getenv("MONGODB_URI")
MONGODB_DATABASE = os.getenv("MONGODB_DATABASE", "isaac-dropbox")
BLOB_CONNECTION_STRING = os.getenv("BLOB_CONNECTION_STRING")
BLOB_CONTAINER_NAME = os.getenv("BLOB_CONTAINER_NAME", "dropbox")
SERVICE_BUS_CONNECTION_STRING = os.getenv("SERVICE_BUS_CONNECTION_STRING")
SERVICE_BUS_QUEUE_NAME = os.getenv("SERVICE_BUS_QUEUE_NAME", "dropbox-file-processing")

def calculate_file_hash(file_path: str) -> str:
    """Calculate SHA256 hash of file"""
    sha256_hash = hashlib.sha256()
    with open(file_path, "rb") as f:
        for byte_block in iter(lambda: f.read(4096), b""):
            sha256_hash.update(byte_block)
    return sha256_hash.hexdigest().lower()

def upload_to_blob_storage(file_path: str, blob_name: str) -> str:
    """Upload file to Azure Blob Storage and return URL"""
    blob_service_client = BlobServiceClient.from_connection_string(BLOB_CONNECTION_STRING)
    blob_client = blob_service_client.get_blob_client(
        container=BLOB_CONTAINER_NAME,
        blob=blob_name
    )
    
    print(f"   Uploading to blob: {blob_name}")
    with open(file_path, "rb") as data:
        blob_client.upload_blob(data, overwrite=True)
    
    # Get blob URL
    storage_account = BLOB_CONNECTION_STRING.split("AccountName=")[1].split(";")[0]
    blob_url = f"https://{storage_account}.blob.core.windows.net/{BLOB_CONTAINER_NAME}/{blob_name}"
    return blob_url

def create_mongodb_record(
    file_path: str,
    blob_url: str,
    file_hash: str,
    dropbox_path: str
) -> str:
    """Create MongoDB record and return file_id. Checks for duplicates first."""
    client = MongoClient(MONGODB_URI)
    db = client[MONGODB_DATABASE]
    
    file_info = Path(file_path)
    file_size = file_info.stat().st_size
    file_type = file_info.suffix.lstrip(".")
    
    # Use consistent dropbox_file_id based on hash for deduplication
    dropbox_file_id = f"test:{file_hash[:16]}"
    
    # Check for existing file by dropbox_file_id or file_hash + dropbox_path
    existing = db.dropbox_files.find_one({
        "$or": [
            {"dropbox_file_id": dropbox_file_id},
            {"file_hash": file_hash, "dropbox_path": dropbox_path}
        ]
    })
    
    if existing:
        file_id = str(existing["_id"])
        print(f"   File already exists (duplicate check): {file_id}")
        print(f"   Existing status: {existing.get('processing_status', 'unknown')}")
        return file_id
    
    file_record = {
        "dropbox_path": dropbox_path,
        "dropbox_file_id": dropbox_file_id,
        "dropbox_rev": None,
        "filename": file_info.name,
        "file_type": file_type,
        "blob_url": blob_url,
        "file_hash": file_hash,
        "file_size": file_size,
        "user_id": "test-user",
        "processing_status": "pending",
        "chunk_count": 0,
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
        "dropbox_created_at": datetime.utcnow(),
        "dropbox_modified_at": datetime.utcnow(),
        "metadata": {
            "folder": str(Path(dropbox_path).parent),
            "content_hash": file_hash
        }
    }
    
    # Insert record
    result = db.dropbox_files.insert_one(file_record)
    file_id = str(result.inserted_id)
    print(f"   Created MongoDB record: {file_id}")
    return file_id

def send_queue_message(
    file_id: str,
    blob_url: str,
    filename: str,
    file_type: str,
    dropbox_path: str,
    dropbox_file_id: str
):
    """Send message to Service Bus queue"""
    servicebus_client = ServiceBusClient.from_connection_string(SERVICE_BUS_CONNECTION_STRING)
    
    message_body = {
        "message_type": "dropbox_file",
        "file_id": file_id,
        "dropbox_path": dropbox_path,
        "dropbox_file_id": dropbox_file_id,
        "blob_url": blob_url,
        "filename": filename,
        "file_type": file_type,
        "user_id": "test-user",
        "metadata": {},
        "timestamp": datetime.utcnow().isoformat()
    }
    
    message = ServiceBusMessage(
        body=json.dumps(message_body),
        content_type="application/json"
    )
    
    with servicebus_client:
        sender = servicebus_client.get_queue_sender(queue_name=SERVICE_BUS_QUEUE_NAME)
        with sender:
            sender.send_messages(message)
    
    print(f"   Message sent to queue: {SERVICE_BUS_QUEUE_NAME}")

def main():
    if len(sys.argv) < 2:
        print("Usage: python test-file-processing.py <file_path> [dropbox_path]")
        print("\nExample:")
        print('  python test-file-processing.py "C:\\path\\to\\file.pptx" "/Company Docs/file.pptx"')
        sys.exit(1)
    
    file_path = sys.argv[1]
    dropbox_path = sys.argv[2] if len(sys.argv) > 2 else f"/test/{Path(file_path).name}"
    
    # Validate file exists
    if not os.path.exists(file_path):
        print(f"Error: File not found: {file_path}")
        sys.exit(1)
    
    # Validate environment variables
    if not all([MONGODB_URI, BLOB_CONNECTION_STRING, SERVICE_BUS_CONNECTION_STRING]):
        print("Error: Missing required environment variables:")
        if not MONGODB_URI:
            print("  - MONGODB_URI")
        if not BLOB_CONNECTION_STRING:
            print("  - BLOB_CONNECTION_STRING")
        if not SERVICE_BUS_CONNECTION_STRING:
            print("  - SERVICE_BUS_CONNECTION_STRING")
        sys.exit(1)
    
    print("=" * 60)
    print("Testing Dropbox Worker File Processing")
    print("=" * 60)
    print(f"\nFile: {file_path}")
    print(f"Dropbox Path: {dropbox_path}")
    
    # Step 1: Calculate file hash
    print("\n1. Calculating file hash...")
    file_hash = calculate_file_hash(file_path)
    print(f"   Hash: {file_hash[:16]}...")
    
    # Step 2: Upload to blob storage
    print("\n2. Uploading to Azure Blob Storage...")
    filename = Path(file_path).name
    blob_name = f"dropbox/test/{file_hash}/{filename}"
    blob_url = upload_to_blob_storage(file_path, blob_name)
    print(f"   Blob URL: {blob_url[:80]}...")
    
    # Step 3: Create MongoDB record
    print("\n3. Creating MongoDB record...")
    file_id = create_mongodb_record(file_path, blob_url, file_hash, dropbox_path)
    
    # Step 4: Send message to queue
    print("\n4. Sending message to Service Bus queue...")
    file_type = Path(file_path).suffix.lstrip(".")
    dropbox_file_id = f"test:{file_hash[:16]}"
    send_queue_message(
        file_id=file_id,
        blob_url=blob_url,
        filename=filename,
        file_type=file_type,
        dropbox_path=dropbox_path,
        dropbox_file_id=dropbox_file_id
    )
    
    print("\n" + "=" * 60)
    print("✓ File uploaded and queued for processing!")
    print("=" * 60)
    print(f"\nFile ID: {file_id}")
    print(f"Hash: {file_hash}")
    print("\nNext steps:")
    print("1. Watch worker logs:")
    print("   az container logs --name dropbox-worker --resource-group IsaacLLM --follow")
    print("\n2. Check MongoDB (after ~30-60 sec):")
    print(f"   db.dropbox_files.findOne({{_id: ObjectId('{file_id}')}})")
    print(f"   db.dropbox_chunks.find({{file_id: ObjectId('{file_id}')}}).count()")
    print("\n3. Check blob storage for markdown:")
    print(f"   Look for: dropbox/markdown/{file_id}.md")

if __name__ == "__main__":
    main()

