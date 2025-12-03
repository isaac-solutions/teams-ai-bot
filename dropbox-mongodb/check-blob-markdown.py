#!/usr/bin/env python3
"""Check if markdown file exists in blob storage"""

import os
import sys
from pathlib import Path
from dotenv import load_dotenv
from azure.storage.blob import BlobServiceClient

# Load environment variables
env_path = Path(__file__).parent / "worker" / ".env"
if env_path.exists():
    load_dotenv(env_path)

BLOB_CONNECTION_STRING = os.getenv("BLOB_CONNECTION_STRING")
BLOB_CONTAINER_NAME = os.getenv("BLOB_CONTAINER_NAME", "dropbox")

file_id = sys.argv[1] if len(sys.argv) > 1 else "691c9ae12f50138591eef60f"

blob_service_client = BlobServiceClient.from_connection_string(BLOB_CONNECTION_STRING)
container_client = blob_service_client.get_container_client(BLOB_CONTAINER_NAME)

# Blob path is markdown/{file_id}.md within the dropbox container
markdown_blob_name = f"markdown/{file_id}.md"
blob_client = container_client.get_blob_client(markdown_blob_name)

print(f"Checking for markdown blob: {markdown_blob_name}")

if blob_client.exists():
    props = blob_client.get_blob_properties()
    print(f"✓ Markdown file exists!")
    print(f"  Size: {props.size:,} bytes")
    print(f"  Last Modified: {props.last_modified}")
    
    # Try to read first 500 chars
    try:
        content = blob_client.download_blob().readall().decode('utf-8')
        print(f"\nFirst 500 characters:")
        print(content[:500])
    except Exception as e:
        print(f"Error reading content: {e}")
else:
    print("✗ Markdown file not found")
    
    # List all markdown files to see what's there
    print(f"\nListing markdown files in markdown/...")
    blobs = container_client.list_blobs(name_starts_with="markdown/")
    count = 0
    for blob in blobs:
        print(f"  - {blob.name} ({blob.size:,} bytes)")
        count += 1
        if count >= 10:
            break
    if count == 0:
        print("  No markdown files found")

