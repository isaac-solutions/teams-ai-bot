"""
Pydantic models for Dropbox file records
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime


class DropboxFileMetadata(BaseModel):
    """Metadata from Dropbox"""
    folder: Optional[str] = None
    shared: bool = False
    tags: List[str] = []
    content_hash: Optional[str] = None
    is_downloadable: bool = True


class ProcessingMetadata(BaseModel):
    """Processing attempt tracking"""
    attempts: int = 0
    last_error: Optional[str] = None
    processing_time: Optional[float] = None


class DropboxFileCreate(BaseModel):
    """Create new Dropbox file record"""
    dropbox_path: str
    dropbox_file_id: str
    dropbox_rev: Optional[str] = None
    filename: str
    file_type: str
    blob_url: str
    file_hash: str
    file_size: int
    user_id: str = "system"
    dropbox_created_at: Optional[datetime] = None
    dropbox_modified_at: Optional[datetime] = None
    metadata: Optional[DropboxFileMetadata] = None


class DropboxFileResponse(BaseModel):
    """Response model for Dropbox file"""
    id: str
    dropbox_path: str
    filename: str
    file_type: str
    processing_status: str
    chunk_count: int = 0
    file_size: int = 0
    blob_url: Optional[str] = None
    markdown_blob_url: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    
    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }


class DropboxFileListResponse(BaseModel):
    """Response model for listing Dropbox files"""
    files: List[DropboxFileResponse]
    total: int
    page: int
    page_size: int


class DropboxChunkResponse(BaseModel):
    """Response model for a document chunk"""
    id: str
    file_id: str
    chunk_index: int
    content: str
    token_count: int
    chunk_type: str
    created_at: datetime
    
    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }

