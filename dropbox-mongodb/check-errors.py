#!/usr/bin/env python3
"""Check for processing errors in MongoDB"""

import os
from pathlib import Path
from dotenv import load_dotenv
from pymongo import MongoClient
from bson import ObjectId

# Load environment variables
env_path = Path(__file__).parent / "worker" / ".env"
if env_path.exists():
    load_dotenv(env_path)

MONGODB_URI = os.getenv("MONGODB_URI")
MONGODB_DATABASE = os.getenv("MONGODB_DATABASE", "isaac-dropbox")

client = MongoClient(MONGODB_URI)
db = client[MONGODB_DATABASE]

# Check for failed files
failed_files = list(db.dropbox_files.find({"processing_status": "failed"}).limit(10))

if failed_files:
    print("=" * 60)
    print("FAILED FILES")
    print("=" * 60)
    for file in failed_files:
        print(f"\nFile ID: {file['_id']}")
        print(f"Filename: {file.get('filename', 'N/A')}")
        pm = file.get('processing_metadata', {})
        if pm.get('last_error'):
            print(f"Error: {pm.get('last_error')}")
        print(f"Attempts: {pm.get('attempts', 'N/A')}")
else:
    print("No failed files found")

# Check for files stuck in processing
processing_files = list(db.dropbox_files.find({"processing_status": "processing"}).limit(10))

if processing_files:
    print("\n" + "=" * 60)
    print("FILES STUCK IN PROCESSING")
    print("=" * 60)
    for file in processing_files:
        print(f"\nFile ID: {file['_id']}")
        print(f"Filename: {file.get('filename', 'N/A')}")
        print(f"Updated At: {file.get('updated_at', 'N/A')}")
else:
    print("\nNo files stuck in processing")

# Check the specific file
file_id = "691c7c5e189bc4bbcb072913"
file_record = db.dropbox_files.find_one({"_id": ObjectId(file_id)})

if file_record:
    print("\n" + "=" * 60)
    print(f"FILE: {file_id}")
    print("=" * 60)
    print(f"Status: {file_record.get('processing_status')}")
    pm = file_record.get('processing_metadata', {})
    if pm:
        print(f"Processing Metadata: {pm}")

