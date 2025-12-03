"""
Dropbox routes for manual sync and file management
"""

import os
import logging
import hashlib
from typing import Optional
from datetime import datetime

from fastapi import APIRouter, HTTPException, Depends
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId

from ..models.rag_models import SyncRequest, SyncResponse
from ..models.dropbox_file import DropboxFileResponse, DropboxFileListResponse
from ..services.dropbox_service import DropboxService
from ..services.queue_service import QueueService
from azure.storage.blob.aio import BlobServiceClient

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/dropbox", tags=["dropbox"])


# Dependency to get MongoDB database
async def get_database() -> AsyncIOMotorClient:
    """Get MongoDB database instance"""
    # This will be injected via app state
    from ..main import app
    return app.state.db


# Dependency to get Dropbox service
async def get_dropbox_service() -> DropboxService:
    """Get Dropbox service instance"""
    from ..main import app
    return app.state.dropbox_service


# Dependency to get Queue service
async def get_queue_service() -> QueueService:
    """Get Queue service instance"""
    from ..main import app
    return app.state.queue_service


# Dependency to get Blob service
async def get_blob_service() -> BlobServiceClient:
    """Get Blob service instance"""
    from ..main import app
    return app.state.blob_service


@router.post("/sync", response_model=SyncResponse)
async def manual_sync(
    sync_request: SyncRequest,
    db = Depends(get_database),
    dropbox_service: DropboxService = Depends(get_dropbox_service),
    queue_service: QueueService = Depends(get_queue_service),
    blob_service: BlobServiceClient = Depends(get_blob_service)
):
    """
    Manually trigger sync for specific Dropbox path
    
    This endpoint lists files from Dropbox, downloads them to blob storage,
    creates database records, and enqueues them for processing.
    """
    try:
        logger.info(f"Starting manual sync for path: {sync_request.path}")
        
        # List files from Dropbox
        files = await dropbox_service.list_files(
            folder_path=sync_request.path,
            recursive=sync_request.recursive,
            file_types=sync_request.file_types
        )
        
        files_queued = 0
        files_skipped = 0
        
        for file_metadata in files:
            try:
                # Check if file type is supported
                file_type = dropbox_service.get_file_extension(file_metadata["name"])
                if not dropbox_service.is_supported_file_type(file_type):
                    logger.info(f"Skipping unsupported file type: {file_metadata['name']}")
                    files_skipped += 1
                    continue
                
                # Two-step deduplication check (fast → slow)
                if not sync_request.force_reprocess:
                    existing = await db.dropbox_files.find_one({
                        "dropbox_file_id": file_metadata["id"]
                    })
                    
                    if existing:
                        # Step 1: Quick metadata check (no download needed)
                        existing_modified = existing.get("dropbox_modified_at")
                        new_modified = file_metadata.get("server_modified")
                        
                        if existing_modified and new_modified:
                            # If modification date hasn't changed, assume file is unchanged
                            if existing_modified == new_modified:
                                logger.info(f"File unchanged (metadata check): {file_metadata['name']}")
                                files_skipped += 1
                                continue
                        
                        # Step 2: Hash check (only if metadata suggests change)
                        dropbox_content_hash = file_metadata.get("content_hash", "")
                        if dropbox_content_hash and existing.get("metadata", {}).get("content_hash") == dropbox_content_hash:
                            logger.info(f"File unchanged (hash check): {file_metadata['name']}")
                            # Update modified date even though content is same (for tracking)
                            await db.dropbox_files.update_one(
                                {"_id": existing["_id"]},
                                {"$set": {"dropbox_modified_at": new_modified}}
                            )
                            files_skipped += 1
                            continue
                        
                        logger.info(f"File changed, will reprocess: {file_metadata['name']}")
                
                # Download file from Dropbox
                file_content = await dropbox_service.download_file(file_metadata["path_display"])
                
                # Calculate SHA256 hash
                sha256_hash = hashlib.sha256(file_content).hexdigest()
                
                # Upload to blob storage
                from ..main import app
                container_name = os.getenv("BLOB_CONTAINER_NAME", "dropbox")
                blob_name = f"dropbox/{sha256_hash}/{file_metadata['name']}"
                blob_client = blob_service.get_blob_client(
                    container=container_name,
                    blob=blob_name
                )
                
                await blob_client.upload_blob(
                    file_content,
                    overwrite=True
                )
                
                blob_url = blob_client.url
                logger.info(f"Uploaded to blob storage: {blob_name}")
                
                # Create or update file record in MongoDB
                file_record = {
                    "dropbox_path": file_metadata["path_display"],
                    "dropbox_file_id": file_metadata["id"],
                    "dropbox_rev": file_metadata.get("rev"),
                    "filename": file_metadata["name"],
                    "file_type": file_type,
                    "blob_url": blob_url,
                    "file_hash": sha256_hash,
                    "file_size": file_metadata["size"],
                    "user_id": "system",
                    "processing_status": "pending",
                    "chunk_count": 0,
                    "created_at": datetime.utcnow(),
                    "updated_at": datetime.utcnow(),
                    "dropbox_created_at": file_metadata.get("modified"),
                    "dropbox_modified_at": file_metadata.get("server_modified"),
                    "metadata": {
                        "folder": "/".join(file_metadata["path_display"].split("/")[:-1]),
                        "content_hash": file_hash
                    }
                }
                
                # Upsert file record
                result = await db.dropbox_files.update_one(
                    {"dropbox_file_id": file_metadata["id"]},
                    {"$set": file_record},
                    upsert=True
                )
                
                if result.upserted_id:
                    file_id = str(result.upserted_id)
                else:
                    # Get existing ID
                    existing = await db.dropbox_files.find_one(
                        {"dropbox_file_id": file_metadata["id"]}
                    )
                    file_id = str(existing["_id"])
                
                logger.info(f"Created/updated file record: {file_id}")
                
                # Send message to queue for processing
                success = await queue_service.send_dropbox_processing_message(
                    file_id=file_id,
                    dropbox_path=file_metadata["path_display"],
                    dropbox_file_id=file_metadata["id"],
                    blob_url=blob_url,
                    filename=file_metadata["name"],
                    file_type=file_type,
                    user_id="system"
                )
                
                if success:
                    files_queued += 1
                else:
                    files_skipped += 1
                    
            except Exception as e:
                logger.error(f"Failed to process file {file_metadata['name']}: {e}")
                files_skipped += 1
                continue
        
        return SyncResponse(
            status="success",
            files_queued=files_queued,
            files_skipped=files_skipped,
            message=f"Queued {files_queued} files for processing, skipped {files_skipped} files"
        )
        
    except Exception as e:
        logger.error(f"Sync failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/files/{file_id}", response_model=DropboxFileResponse)
async def get_file_status(
    file_id: str,
    db = Depends(get_database)
):
    """Get processing status of a Dropbox file"""
    try:
        file = await db.dropbox_files.find_one({"_id": ObjectId(file_id)})
        
        if not file:
            raise HTTPException(status_code=404, detail="File not found")
        
        return DropboxFileResponse(
            id=str(file["_id"]),
            dropbox_path=file["dropbox_path"],
            filename=file["filename"],
            file_type=file["file_type"],
            processing_status=file["processing_status"],
            chunk_count=file.get("chunk_count", 0),
            file_size=file.get("file_size", 0),
            blob_url=file.get("blob_url"),
            markdown_blob_url=file.get("markdown_blob_url"),
            created_at=file["created_at"],
            updated_at=file["updated_at"]
        )
        
    except Exception as e:
        logger.error(f"Failed to get file status: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/files", response_model=DropboxFileListResponse)
async def list_files(
    status: Optional[str] = None,
    file_type: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
    db = Depends(get_database)
):
    """
    List Dropbox files with filtering
    
    Query parameters:
    - status: Filter by processing status (pending, processing, completed, failed)
    - file_type: Filter by file type (pdf, docx, etc.)
    - page: Page number (1-indexed)
    - page_size: Items per page (max 100)
    """
    try:
        # Build filter
        filters = {}
        if status:
            filters["processing_status"] = status
        if file_type:
            filters["file_type"] = file_type
        
        # Limit page size
        page_size = min(page_size, 100)
        skip = (page - 1) * page_size
        
        # Get files
        cursor = db.dropbox_files.find(filters).sort("updated_at", -1).skip(skip).limit(page_size)
        files = await cursor.to_list(length=page_size)
        
        # Get total count
        total = await db.dropbox_files.count_documents(filters)
        
        # Convert to response models
        file_responses = []
        for file in files:
            file_responses.append(DropboxFileResponse(
                id=str(file["_id"]),
                dropbox_path=file["dropbox_path"],
                filename=file["filename"],
                file_type=file["file_type"],
                processing_status=file["processing_status"],
                chunk_count=file.get("chunk_count", 0),
                file_size=file.get("file_size", 0),
                blob_url=file.get("blob_url"),
                markdown_blob_url=file.get("markdown_blob_url"),
                created_at=file["created_at"],
                updated_at=file["updated_at"]
            ))
        
        return DropboxFileListResponse(
            files=file_responses,
            total=total,
            page=page,
            page_size=page_size
        )
        
    except Exception as e:
        logger.error(f"Failed to list files: {e}")
        raise HTTPException(status_code=500, detail=str(e))

