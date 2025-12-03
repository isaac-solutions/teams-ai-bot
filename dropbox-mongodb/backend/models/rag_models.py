"""
Pydantic models for RAG (Retrieval-Augmented Generation) operations
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime


class RAGSearchRequest(BaseModel):
    """Request model for RAG search"""
    query: str = Field(..., description="Search query text")
    top_k: int = Field(default=10, ge=1, le=100, description="Number of results to return")
    file_types: Optional[List[str]] = Field(default=None, description="Filter by file types (e.g., ['pdf', 'docx'])")
    file_ids: Optional[List[str]] = Field(default=None, description="Filter by specific file IDs")
    min_score: Optional[float] = Field(default=None, ge=0.0, le=1.0, description="Minimum similarity score")
    include_content: bool = Field(default=True, description="Include chunk content in response")


class RAGSearchResult(BaseModel):
    """Single search result from RAG query"""
    chunk_id: str
    file_id: str
    filename: str
    file_type: str
    dropbox_path: str
    chunk_index: int
    content: Optional[str] = None
    score: float
    metadata: Dict[str, Any] = {}
    
    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }


class RAGSearchResponse(BaseModel):
    """Response model for RAG search"""
    query: str
    results: List[RAGSearchResult]
    total_results: int
    search_time_ms: float


class SyncRequest(BaseModel):
    """Request model for manual Dropbox sync"""
    path: Optional[str] = Field(default="", description="Dropbox folder path (empty for root)")
    recursive: bool = Field(default=False, description="Recursively sync subfolders")
    file_types: Optional[List[str]] = Field(
        default=None, 
        description="Only sync specific file types (e.g., ['pdf', 'docx'])"
    )
    force_reprocess: bool = Field(
        default=False,
        description="Reprocess files even if already processed"
    )


class SyncResponse(BaseModel):
    """Response model for sync operation"""
    status: str
    files_queued: int
    files_skipped: int
    message: str
    sync_id: Optional[str] = None

