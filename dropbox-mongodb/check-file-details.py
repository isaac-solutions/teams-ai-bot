#!/usr/bin/env python3
"""Check detailed file information from MongoDB"""

import os
import sys
from pathlib import Path
from dotenv import load_dotenv
from pymongo import MongoClient
from bson import ObjectId
import json

# Load environment variables
env_path = Path(__file__).parent / "worker" / ".env"
if env_path.exists():
    load_dotenv(env_path)

MONGODB_URI = os.getenv("MONGODB_URI")
MONGODB_DATABASE = os.getenv("MONGODB_DATABASE", "isaac-dropbox")

client = MongoClient(MONGODB_URI)
db = client[MONGODB_DATABASE]

file_id = sys.argv[1] if len(sys.argv) > 1 else "691c9ae12f50138591eef60f"

file_record = db.dropbox_files.find_one({"_id": ObjectId(file_id)})

if file_record:
    print("=" * 60)
    print("DETAILED FILE RECORD")
    print("=" * 60)
    print(json.dumps({
        "_id": str(file_record["_id"]),
        "filename": file_record.get("filename"),
        "processing_status": file_record.get("processing_status"),
        "chunk_count": file_record.get("chunk_count"),
        "markdown_blob_url": file_record.get("markdown_blob_url"),
        "blob_url": file_record.get("blob_url"),
        "processing_metadata": file_record.get("processing_metadata"),
        "created_at": str(file_record.get("created_at")),
        "updated_at": str(file_record.get("updated_at"))
    }, indent=2))
else:
    print(f"File {file_id} not found")

