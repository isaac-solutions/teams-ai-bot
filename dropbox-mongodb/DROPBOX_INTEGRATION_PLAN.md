# Dropbox Webhook File Ingestion System with RAG Processing

## Overview

This document outlines the integration of a Dropbox webhook-based file ingestion system into the existing PowerPoint slide processing application. The system will automatically process company files from Dropbox using the same RAG (Retrieval-Augmented Generation) pipeline, triggered by Dropbox webhooks rather than user uploads.

**Key Points:**
- **Same Application**: Integrated into the existing PowerPoint processing system
- **External Trigger**: Dropbox webhooks (not user uploads)
- **Separate Database**: Uses `isaac-dropbox` database (separate from `pptx-gen`)
- **Shared Infrastructure**: Reuses worker logic, RAG pipeline, blob storage, and queues
- **Automatic Processing**: Files are processed automatically when added/modified in Dropbox

## Current System Architecture

### Existing Components

**Backend**: FastAPI application with Azure AD authentication
- Routes: `/api/upload`, `/api/decks`, `/api/slides`, `/api/rag`
- Services: Queue service, blob storage, MongoDB repositories
- Models: Deck, Slide, File, DocumentChunk

**Worker**: Docker container (`pptx-worker`)
- Listens to: `slide-processing` queue
- Processes: PPTX files → slides + RAG data
- Technologies: docling, Azure OpenAI, python-pptx

**Storage**:
- **Azure Blob Storage**: File storage with SAS tokens
- **MongoDB**: `pptx-gen` database with collections:
  - `decks` - PowerPoint deck metadata
  - `slides` - Individual slide data
  - `files` - File records for RAG
  - `document_chunks` - Text chunks with embeddings

**Queue**: Azure Service Bus
- `slide-processing` - Current queue for user uploads

**RAG Pipeline**:
1. Document conversion (docling)
2. Markdown generation
3. Text chunking (512 tokens, 50 overlap)
4. Embedding generation (Azure OpenAI text-embedding-3-large)
5. Vector storage (MongoDB)

### Current Upload Flow

```
User Upload (Web UI)
    ↓
POST /api/upload
    ↓
Upload to Azure Blob Storage
    ↓
Create deck record in MongoDB
    ↓
Send message to slide-processing queue
    ↓
Worker processes:
  - Extract slides from PPTX
  - Generate screenshots
  - Convert to markdown (docling)
  - Chunk text
  - Generate embeddings
  - Store in MongoDB
```

## New Dropbox Integration

### Architecture Overview

**Same Application, New Trigger Source:**
- Dropbox webhooks trigger file processing (instead of user uploads)
- New API endpoints handle webhook events
- Separate queue for Dropbox files (optional, for clarity)
- Separate database (`isaac-dropbox`) to isolate company files
- Reuse existing worker logic with minimal modifications

### Key Differences from Upload System

| Aspect | User Upload System | Dropbox Integration |
|--------|-------------------|---------------------|
| **Trigger** | User uploads via web UI | Dropbox webhook notification |
| **Database** | `pptx-gen` | `isaac-dropbox` |
| **Queue** | `slide-processing` | `dropbox-file-processing` |
| **Collections** | `decks`, `slides` | `dropbox_files`, `dropbox_chunks` |
| **File Source** | User browser upload | Dropbox API download |
| **Authentication** | Azure AD (user) | Dropbox OAuth (app) |
| **Slide Extraction** | Yes (PPTX only) | No (all file types) |
| **Processing Focus** | Presentation slides | Document content |
| **User Context** | Authenticated user | System/Dropbox user |

## Supported File Types

### Primary Document Types (Docling Native Support)

**Documents:**
- `.pdf` - PDF documents ✅
- `.docx`, `.doc` - Microsoft Word ✅
- `.txt` - Plain text files ✅
- `.md` - Markdown files ✅
- `.html`, `.htm` - HTML documents ✅
- `.rtf` - Rich Text Format
- `.odt` - OpenDocument Text

**Presentations:**
- `.pptx`, `.ppt` - Microsoft PowerPoint ✅
- `.odp` - OpenDocument Presentation

**Spreadsheets:**
- `.xlsx`, `.xls` - Microsoft Excel
- `.csv` - Comma-separated values
- `.ods` - OpenDocument Spreadsheet

**Notes & Collaboration:**
- `.one` - Microsoft OneNote
- `.msg`, `.eml` - Email files

**Other:**
- `.xml` - XML documents
- `.json` - JSON data files

### File Type Processing Strategy

**Docling Handles Directly:**
- PDF, DOCX, PPTX, HTML, Markdown, Images (with OCR)

**Custom Extraction Required:**
- **Excel/CSV**: Use `pandas` or `openpyxl` to extract text and structure
- **OneNote**: May require Microsoft Graph API or specialized library
- **Email**: Use `email` library or `mailparser`
- **XML/JSON**: Direct parsing with standard libraries

## Data Model

### New Collections in `isaac-dropbox` Database

#### `dropbox_files` Collection

```python
{
    "_id": ObjectId,
    "dropbox_path": str,           # Full path in Dropbox: "/Company Docs/Q4 Report.pdf"
    "dropbox_file_id": str,         # Dropbox unique file ID
    "dropbox_rev": str,             # Dropbox revision ID for change tracking
    "filename": str,                # "Q4 Report.pdf"
    "file_type": str,               # "pdf"
    "blob_url": str,                # Azure Blob Storage URL
    "markdown_blob_url": str,       # URL to markdown conversion
    "file_hash": str,               # SHA256 hash for deduplication
    "file_size": int,               # Size in bytes
    "user_id": str,                 # Dropbox user who owns/modified file
    "processing_status": str,       # pending, processing, completed, failed
    "chunk_count": int,             # Number of document chunks created
    "created_at": datetime,         # When first ingested
    "updated_at": datetime,         # Last processing update
    "dropbox_created_at": datetime, # Original creation in Dropbox
    "dropbox_modified_at": datetime,# Last modified in Dropbox
    "metadata": {
        "folder": str,              # Parent folder path
        "shared": bool,             # Is file shared?
        "tags": List[str],          # Dropbox tags if available
        "content_hash": str,        # Dropbox content hash
        "is_downloadable": bool     # Can be downloaded?
    },
    "processing_metadata": {
        "attempts": int,            # Number of processing attempts
        "last_error": str,          # Last error message if failed
        "processing_time": float    # Time taken to process (seconds)
    }
}
```

**Indexes:**
```python
# Unique constraint on Dropbox file ID
db.dropbox_files.create_index("dropbox_file_id", unique=True)

# Query by path
db.dropbox_files.create_index("dropbox_path")

# Query by status
db.dropbox_files.create_index("processing_status")

# Query by file type
db.dropbox_files.create_index("file_type")

# Query by user
db.dropbox_files.create_index("user_id")

# Compound index for deduplication
db.dropbox_files.create_index([("file_hash", 1), ("dropbox_path", 1)])
```

#### `dropbox_chunks` Collection

```python
{
    "_id": ObjectId,
    "file_id": ObjectId,            # Reference to dropbox_files
    "chunk_index": int,             # Sequential chunk number
    "content": str,                 # Text content of chunk
    "embedding": List[float],       # 3072 dimensions for text-embedding-3-large
    "token_count": int,             # Number of tokens in chunk
    "metadata": {
        "page_number": int,         # Source page if applicable
        "section": str,             # Section/heading if detected
        "chunk_type": str           # "text", "table", "list", etc.
    },
    "created_at": datetime
}
```

**Indexes:**
```python
# Query chunks by file
db.dropbox_chunks.create_index("file_id")

# Vector search index (MongoDB Atlas)
db.dropbox_chunks.create_index(
    [("embedding", "vector")],
    name="vector_index",
    vectorSearchOptions={
        "type": "vectorSearch",
        "numDimensions": 3072,
        "similarity": "cosine"
    }
)
```

## Component Architecture

### 1. Backend API Extensions

#### New Route: `backend/routes/dropbox.py`

```python
from fastapi import APIRouter, Request, HTTPException, Depends, BackgroundTasks
from typing import Optional
import hmac
import hashlib

router = APIRouter(prefix="/api/dropbox", tags=["dropbox"])

@router.get("/webhook")
async def verify_webhook(challenge: str):
    """
    Dropbox webhook verification endpoint.
    Responds to Dropbox challenge for webhook setup.
    
    GET /api/dropbox/webhook?challenge=xxx
    """
    return {"challenge": challenge}

@router.post("/webhook")
async def handle_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    dropbox_service = Depends(get_dropbox_service)
):
    """
    Dropbox webhook notification endpoint.
    Receives notifications when files change in Dropbox.
    
    POST /api/dropbox/webhook
    
    Flow:
    1. Verify webhook signature
    2. Parse notification payload
    3. For each changed file:
       - Download from Dropbox
       - Upload to Azure Blob Storage
       - Create dropbox_files record
       - Enqueue processing message
    4. Return 200 OK immediately
    """
    # Verify signature
    signature = request.headers.get("X-Dropbox-Signature")
    body = await request.body()
    
    if not verify_dropbox_signature(signature, body):
        raise HTTPException(status_code=401, detail="Invalid signature")
    
    # Parse payload
    payload = await request.json()
    
    # Process in background
    background_tasks.add_task(process_dropbox_changes, payload)
    
    return {"status": "accepted"}

@router.post("/sync")
async def manual_sync(
    path: Optional[str] = None,
    recursive: bool = False,
    current_user = Depends(get_current_user)
):
    """
    Manually trigger sync for specific Dropbox path.
    Useful for initial bulk import or re-processing.
    
    POST /api/dropbox/sync
    {
        "path": "/Company Docs",
        "recursive": true
    }
    """
    # Requires admin role
    if not current_user.has_role("admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Trigger sync
    files = await dropbox_service.list_files(path, recursive)
    
    for file in files:
        await enqueue_dropbox_file(file)
    
    return {
        "status": "sync_started",
        "files_queued": len(files)
    }

@router.get("/files/{file_id}")
async def get_file_status(
    file_id: str,
    current_user = Depends(get_current_user)
):
    """
    Get processing status of a Dropbox file.
    
    GET /api/dropbox/files/{file_id}
    """
    file = await dropbox_file_repository.find_by_id(file_id)
    
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    
    return {
        "file_id": str(file["_id"]),
        "filename": file["filename"],
        "dropbox_path": file["dropbox_path"],
        "status": file["processing_status"],
        "chunk_count": file.get("chunk_count", 0),
        "updated_at": file["updated_at"]
    }

@router.get("/files")
async def list_files(
    status: Optional[str] = None,
    file_type: Optional[str] = None,
    limit: int = 50,
    skip: int = 0,
    current_user = Depends(get_current_user)
):
    """
    List Dropbox files with filtering.
    
    GET /api/dropbox/files?status=completed&file_type=pdf&limit=50
    """
    filters = {}
    if status:
        filters["processing_status"] = status
    if file_type:
        filters["file_type"] = file_type
    
    files = await dropbox_file_repository.find_many(
        filters,
        limit=limit,
        skip=skip,
        sort=[("updated_at", -1)]
    )
    
    return {
        "files": files,
        "total": await dropbox_file_repository.count(filters)
    }
```

#### New Service: `backend/services/dropbox_service.py`

```python
import dropbox
from dropbox.files import FileMetadata, FolderMetadata
from typing import List, Dict, Any, Optional
import hashlib
import hmac

class DropboxService:
    """Service for interacting with Dropbox API"""
    
    def __init__(self, config):
        self.config = config
        self.dbx = dropbox.Dropbox(config.dropbox_access_token)
        
    async def download_file(self, dropbox_path: str) -> bytes:
        """
        Download file content from Dropbox.
        
        Args:
            dropbox_path: Full path in Dropbox
            
        Returns:
            File content as bytes
        """
        try:
            metadata, response = self.dbx.files_download(dropbox_path)
            return response.content
        except dropbox.exceptions.ApiError as e:
            logger.error(f"Failed to download {dropbox_path}: {e}")
            raise
    
    async def get_file_metadata(self, dropbox_path: str) -> Dict[str, Any]:
        """
        Get metadata for a file in Dropbox.
        
        Returns:
            {
                "id": str,
                "name": str,
                "path_display": str,
                "size": int,
                "modified": datetime,
                "rev": str,
                "content_hash": str
            }
        """
        try:
            metadata = self.dbx.files_get_metadata(dropbox_path)
            
            if isinstance(metadata, FileMetadata):
                return {
                    "id": metadata.id,
                    "name": metadata.name,
                    "path_display": metadata.path_display,
                    "size": metadata.size,
                    "modified": metadata.client_modified,
                    "rev": metadata.rev,
                    "content_hash": metadata.content_hash
                }
            else:
                raise ValueError(f"{dropbox_path} is not a file")
                
        except dropbox.exceptions.ApiError as e:
            logger.error(f"Failed to get metadata for {dropbox_path}: {e}")
            raise
    
    async def list_files(
        self,
        folder_path: str = "",
        recursive: bool = False
    ) -> List[Dict[str, Any]]:
        """
        List files in a Dropbox folder.
        
        Args:
            folder_path: Folder path (empty string for root)
            recursive: Include subfolders
            
        Returns:
            List of file metadata dictionaries
        """
        files = []
        
        try:
            result = self.dbx.files_list_folder(
                folder_path,
                recursive=recursive
            )
            
            while True:
                for entry in result.entries:
                    if isinstance(entry, FileMetadata):
                        files.append({
                            "id": entry.id,
                            "name": entry.name,
                            "path_display": entry.path_display,
                            "size": entry.size,
                            "modified": entry.client_modified,
                            "rev": entry.rev,
                            "content_hash": entry.content_hash
                        })
                
                if not result.has_more:
                    break
                    
                result = self.dbx.files_list_folder_continue(result.cursor)
            
            return files
            
        except dropbox.exceptions.ApiError as e:
            logger.error(f"Failed to list files in {folder_path}: {e}")
            raise
    
    def verify_webhook_signature(
        self,
        signature: str,
        body: bytes
    ) -> bool:
        """
        Verify Dropbox webhook signature.
        
        Args:
            signature: X-Dropbox-Signature header value
            body: Raw request body
            
        Returns:
            True if signature is valid
        """
        expected_signature = hmac.new(
            self.config.dropbox_webhook_secret.encode(),
            body,
            hashlib.sha256
        ).hexdigest()
        
        return hmac.compare_digest(signature, expected_signature)
    
    async def get_shared_link(self, dropbox_path: str) -> Optional[str]:
        """Get or create a shared link for a file"""
        try:
            links = self.dbx.sharing_list_shared_links(path=dropbox_path)
            if links.links:
                return links.links[0].url
            
            # Create new shared link
            link = self.dbx.sharing_create_shared_link_with_settings(
                dropbox_path
            )
            return link.url
            
        except dropbox.exceptions.ApiError:
            return None
```

#### Queue Service Extension: `backend/services/queue.py`

```python
# Add to existing QueueService class

async def send_dropbox_processing_message(
    self,
    file_id: str,
    dropbox_path: str,
    dropbox_file_id: str,
    blob_url: str,
    filename: str,
    file_type: str,
    user_id: str,
    additional_metadata: Optional[Dict[str, Any]] = None
) -> bool:
    """
    Send message to dropbox-file-processing queue.
    
    Message format:
    {
        "message_type": "dropbox_file",
        "file_id": "...",
        "dropbox_path": "/Company Docs/file.pdf",
        "dropbox_file_id": "id:...",
        "blob_url": "https://...",
        "filename": "file.pdf",
        "file_type": "pdf",
        "user_id": "...",
        "metadata": {...}
    }
    """
    try:
        message_body = {
            "message_type": "dropbox_file",
            "file_id": file_id,
            "dropbox_path": dropbox_path,
            "dropbox_file_id": dropbox_file_id,
            "blob_url": blob_url,
            "filename": filename,
            "file_type": file_type,
            "user_id": user_id,
            "metadata": additional_metadata or {},
            "timestamp": datetime.utcnow().isoformat()
        }
        
        message = ServiceBusMessage(
            body=json.dumps(message_body),
            content_type="application/json"
        )
        
        # Send to dropbox-file-processing queue
        async with self.sb_client.get_queue_sender(
            queue_name=self.config.dropbox_queue_name
        ) as sender:
            await sender.send_messages(message)
        
        logger.info(f"Sent Dropbox processing message for file {file_id}")
        return True
        
    except Exception as e:
        logger.error(f"Failed to send Dropbox processing message: {e}")
        return False
```

### 2. Worker Implementation

#### Option A: Extend Existing Worker (Recommended)

Modify `worker/main.py` to handle both message types:

```python
class SlideProcessingWorker:
    """Unified worker for both upload and Dropbox processing"""
    
    async def process_message(self, message: ServiceBusReceivedMessage):
        """Route message to appropriate handler"""
        try:
            body = json.loads(str(message))
            message_type = body.get("message_type", "upload")
            
            if message_type == "dropbox_file":
                await self.process_dropbox_file(message, body)
            else:
                # Existing upload processing
                await self.process_uploaded_file(message, body)
                
        except Exception as e:
            logger.error(f"Message processing failed: {e}")
            raise
    
    async def process_dropbox_file(self, message, body):
        """
        Process file from Dropbox webhook.
        
        Flow:
        1. Download file from blob storage
        2. Convert to markdown (docling)
        3. Chunk markdown
        4. Generate embeddings
        5. Store in dropbox_chunks collection
        6. Update dropbox_files record
        
        No slide extraction - just RAG processing
        """
        file_id = body["file_id"]
        blob_url = body["blob_url"]
        filename = body["filename"]
        file_type = body["file_type"]
        
        # Connect to isaac-dropbox database
        db = self.mongo_client["isaac-dropbox"]
        files_collection = db["dropbox_files"]
        chunks_collection = db["dropbox_chunks"]
        
        try:
            # Update status
            await files_collection.update_one(
                {"_id": ObjectId(file_id)},
                {"$set": {"processing_status": "processing"}}
            )
            
            # Download file
            file_path = await self.download_from_blob(blob_url, filename)
            
            # Convert to markdown
            markdown = await self.docling_processor.convert_to_markdown(
                file_path,
                file_type
            )
            
            # Upload markdown to blob with SAS token
            markdown_url = await self.upload_markdown_to_blob(
                file_id,
                markdown,
                prefix="dropbox"
            )
            
            # Chunk markdown
            chunks = self.docling_processor.chunk_markdown(markdown)
            
            # Generate embeddings
            embeddings = await self.docling_processor.generate_embeddings(chunks)
            
            # Store chunks
            chunk_docs = []
            for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
                chunk_docs.append({
                    "file_id": ObjectId(file_id),
                    "chunk_index": i,
                    "content": chunk,
                    "embedding": embedding,
                    "token_count": self.docling_processor.count_tokens(chunk),
                    "created_at": datetime.utcnow()
                })
            
            if chunk_docs:
                await chunks_collection.insert_many(chunk_docs)
            
            # Update file record
            await files_collection.update_one(
                {"_id": ObjectId(file_id)},
                {
                    "$set": {
                        "processing_status": "completed",
                        "markdown_blob_url": markdown_url,
                        "chunk_count": len(chunks),
                        "updated_at": datetime.utcnow()
                    }
                }
            )
            
            logger.info(f"Successfully processed Dropbox file {file_id}")
            
        except Exception as e:
            logger.error(f"Failed to process Dropbox file {file_id}: {e}")
            
            # Update status to failed
            await files_collection.update_one(
                {"_id": ObjectId(file_id)},
                {
                    "$set": {
                        "processing_status": "failed",
                        "processing_metadata.last_error": str(e),
                        "updated_at": datetime.utcnow()
                    }
                }
            )
            raise
```

#### Option B: Separate Worker (Alternative)

Create `worker/dropbox_worker.py` as a separate container:

```python
#!/usr/bin/env python3
"""
Dropbox File Processing Worker

Processes files from Dropbox webhooks using the same RAG pipeline.
Listens to: dropbox-file-processing queue
Database: isaac-dropbox
"""

class DropboxFileWorker:
    """Dedicated worker for Dropbox file processing"""
    
    def __init__(self, config):
        self.config = config
        
        # MongoDB - connect to isaac-dropbox database
        self.mongo_client = AsyncIOMotorClient(config.mongodb_uri)
        self.db = self.mongo_client["isaac-dropbox"]
        
        # Service Bus - listen to dropbox-file-processing queue
        self.sb_client = ServiceBusClient.from_connection_string(
            config.service_bus_connection_string
        )
        
        # Reuse docling processor
        self.docling_processor = DoclingProcessor(config)
        
        # Blob storage
        self.blob_service_client = BlobServiceClient.from_connection_string(
            config.blob_connection_string
        )
    
    async def run(self):
        """Main worker loop"""
        logger.info("Dropbox File Worker starting...")
        
        async with self.sb_client:
            receiver = self.sb_client.get_queue_receiver(
                queue_name=self.config.dropbox_queue_name,
                receive_mode=ServiceBusReceiveMode.PEEK_LOCK
            )
            
            async with receiver:
                while True:
                    messages = await receiver.receive_messages(
                        max_message_count=1,
                        max_wait_time=self.config.max_wait_time
                    )
                    
                    for message in messages:
                        await self.process_message(message)
                        await receiver.complete_message(message)
```

### 3. Configuration Updates

#### `backend/config.py`

```python
class Settings(BaseSettings):
    # ... existing settings ...
    
    # Dropbox Configuration
    dropbox_app_key: str = Field(..., env="DROPBOX_APP_KEY")
    dropbox_app_secret: str = Field(..., env="DROPBOX_APP_SECRET")
    dropbox_access_token: str = Field(..., env="DROPBOX_ACCESS_TOKEN")
    dropbox_webhook_secret: str = Field(..., env="DROPBOX_WEBHOOK_SECRET")
    
    # Dropbox Queue
    dropbox_queue_name: str = Field(
        default="dropbox-file-processing",
        env="DROPBOX_QUEUE_NAME"
    )
    
    # Dropbox Database
    dropbox_database: str = Field(
        default="isaac-dropbox",
        env="DROPBOX_DATABASE"
    )
```

#### `worker/main.py` Configuration

```python
class WorkerConfig:
    def __init__(self):
        # ... existing config ...
        
        # Dropbox Configuration
        self.dropbox_queue_name = os.getenv(
            "DROPBOX_QUEUE_NAME",
            "dropbox-file-processing"
        )
        self.dropbox_database = os.getenv(
            "DROPBOX_DATABASE",
            "isaac-dropbox"
        )
        
        # Listen to both queues
        self.listen_to_dropbox = os.getenv(
            "LISTEN_TO_DROPBOX",
            "true"
        ).lower() == "true"
```

### 4. Data Models

#### `backend/models/dropbox_file.py`

```python
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime
from bson import ObjectId

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
    dropbox_rev: str
    filename: str
    file_type: str
    blob_url: str
    file_hash: str
    file_size: int
    user_id: str
    dropbox_created_at: datetime
    dropbox_modified_at: datetime
    metadata: Optional[DropboxFileMetadata] = None

class DropboxFileResponse(BaseModel):
    """Response model for Dropbox file"""
    id: str
    dropbox_path: str
    filename: str
    file_type: str
    processing_status: str
    chunk_count: int
    created_at: datetime
    updated_at: datetime
    
    class Config:
        json_encoders = {
            ObjectId: str,
            datetime: lambda v: v.isoformat()
        }

class DropboxChunk(BaseModel):
    """Document chunk with embedding"""
    file_id: str
    chunk_index: int
    content: str
    embedding: List[float]
    token_count: int
    metadata: Optional[Dict[str, Any]] = None
```

## Processing Flow

### End-to-End Flow Diagram

```
Dropbox File Change Event
    ↓
Dropbox Webhook → POST /api/dropbox/webhook
    ↓
Verify Signature
    ↓
For Each Changed File:
    ↓
    Download from Dropbox API
    ↓
    Upload to Azure Blob Storage
    ↓
    Create dropbox_files record (status: pending)
    ↓
    Send message to dropbox-file-processing queue
    ↓
Worker Receives Message
    ↓
Update status to "processing"
    ↓
Download file from blob storage
    ↓
Convert to Markdown (docling)
    ↓
Chunk markdown (512 tokens, 50 overlap)
    ↓
Generate embeddings (Azure OpenAI)
    ↓
Store chunks in dropbox_chunks collection
    ↓
Upload markdown to blob storage (with SAS token)
    ↓
Update dropbox_files (status: completed)
```

### Webhook Event Processing

```python
async def process_dropbox_changes(payload: Dict[str, Any]):
    """
    Process Dropbox webhook notification.
    
    Payload structure:
    {
        "list_folder": {
            "accounts": ["dbid:..."]
        },
        "delta": {
            "users": [12345]
        }
    }
    """
    # Get list of changed files
    cursor = await get_dropbox_cursor()
    
    while True:
        result = dropbox_service.files_list_folder_continue(cursor)
        
        for entry in result.entries:
            if isinstance(entry, FileMetadata):
                # Check if file type is supported
                file_type = get_file_extension(entry.name)
                
                if not is_supported_file_type(file_type):
                    logger.info(f"Skipping unsupported file type: {entry.name}")
                    continue
                
                # Check if file already exists (deduplication)
                existing = await dropbox_file_repository.find_one({
                    "dropbox_file_id": entry.id
                })
                
                if existing and existing["file_hash"] == entry.content_hash:
                    logger.info(f"File unchanged, skipping: {entry.name}")
                    continue
                
                # Download and process file
                await process_single_file(entry)
        
        if not result.has_more:
            break
        
        cursor = result.cursor
    
    # Save cursor for next webhook
    await save_dropbox_cursor(cursor)

async def process_single_file(file_metadata: FileMetadata):
    """Process a single file from Dropbox"""
    
    # Download from Dropbox
    file_content = await dropbox_service.download_file(
        file_metadata.path_display
    )
    
    # Calculate hash
    file_hash = hashlib.sha256(file_content).hexdigest()
    
    # Upload to blob storage
    blob_name = f"dropbox/{file_hash}/{file_metadata.name}"
    blob_url = await upload_to_blob_storage(blob_name, file_content)
    
    # Create file record
    file_record = {
        "dropbox_path": file_metadata.path_display,
        "dropbox_file_id": file_metadata.id,
        "dropbox_rev": file_metadata.rev,
        "filename": file_metadata.name,
        "file_type": get_file_extension(file_metadata.name),
        "blob_url": blob_url,
        "file_hash": file_hash,
        "file_size": file_metadata.size,
        "user_id": "system",  # Or extract from Dropbox user
        "processing_status": "pending",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
        "dropbox_created_at": file_metadata.client_modified,
        "dropbox_modified_at": file_metadata.server_modified,
        "metadata": {
            "folder": os.path.dirname(file_metadata.path_display),
            "content_hash": file_metadata.content_hash
        }
    }
    
    file_id = await dropbox_file_repository.insert_one(file_record)
    
    # Enqueue for processing
    await queue_service.send_dropbox_processing_message(
        file_id=str(file_id),
        dropbox_path=file_metadata.path_display,
        dropbox_file_id=file_metadata.id,
        blob_url=blob_url,
        filename=file_metadata.name,
        file_type=get_file_extension(file_metadata.name),
        user_id="system"
    )
```

## Deployment

### Azure Resources Required

1. **Azure Service Bus Queue**: `dropbox-file-processing`
2. **MongoDB Database**: `isaac-dropbox` (in existing cluster)
3. **Blob Storage Container**: Reuse existing `pptx` container with `dropbox/` prefix
4. **Worker Deployment**: Extend existing worker or deploy separate container

### Environment Variables

#### Backend `.env`

```bash
# Existing variables...

# Dropbox Configuration
DROPBOX_APP_KEY=your_app_key_here
DROPBOX_APP_SECRET=your_app_secret_here
DROPBOX_ACCESS_TOKEN=your_access_token_here
DROPBOX_WEBHOOK_SECRET=your_webhook_secret_here

# Dropbox Queue
DROPBOX_QUEUE_NAME=dropbox-file-processing

# Dropbox Database
DROPBOX_DATABASE=isaac-dropbox
```

#### Worker `.env`

```bash
# Existing variables...

# Dropbox Processing
DROPBOX_QUEUE_NAME=dropbox-file-processing
DROPBOX_DATABASE=isaac-dropbox
LISTEN_TO_DROPBOX=true
```

### Deployment Steps

#### 1. Create Azure Service Bus Queue

```bash
# Using Azure CLI
az servicebus queue create \
    --resource-group your-resource-group \
    --namespace-name your-servicebus-namespace \
    --name dropbox-file-processing \
    --max-delivery-count 3 \
    --lock-duration PT5M
```

#### 2. Set Up Dropbox App

1. Go to https://www.dropbox.com/developers/apps
2. Create new app
3. Choose "Scoped access"
4. Select "Full Dropbox" access
5. Name your app
6. Get App Key, App Secret, and generate Access Token
7. Set up webhook URL: `https://your-domain.com/api/dropbox/webhook`

#### 3. Deploy Worker

**Option A: Update existing worker**

```powershell
# Update worker/deploy-worker-simple.ps1
$env:DROPBOX_QUEUE_NAME = "dropbox-file-processing"
$env:DROPBOX_DATABASE = "isaac-dropbox"
$env:LISTEN_TO_DROPBOX = "true"

# Deploy
.\worker\deploy-worker-simple.ps1
```

**Option B: Deploy separate worker**

```powershell
# Create new deployment script: worker/deploy-dropbox-worker.ps1
# Similar to deploy-worker-simple.ps1 but with different container name

.\worker\deploy-dropbox-worker.ps1
```

#### 4. Configure Backend

```bash
# Add Dropbox environment variables to Azure App Service
az webapp config appsettings set \
    --resource-group your-resource-group \
    --name your-backend-app \
    --settings \
    DROPBOX_APP_KEY="your_key" \
    DROPBOX_APP_SECRET="your_secret" \
    DROPBOX_ACCESS_TOKEN="your_token" \
    DROPBOX_WEBHOOK_SECRET="your_webhook_secret" \
    DROPBOX_QUEUE_NAME="dropbox-file-processing" \
    DROPBOX_DATABASE="isaac-dropbox"
```

#### 5. Test Webhook

```bash
# Test webhook verification
curl "https://your-domain.com/api/dropbox/webhook?challenge=test123"

# Should return: {"challenge": "test123"}
```

#### 6. Register Webhook with Dropbox

```bash
curl -X POST https://api.dropboxapi.com/2/files/list_folder/longpoll \
    -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"cursor": "YOUR_CURSOR"}'
```

## Reusable Components

### From Existing System ✅

- **DoclingProcessor**: Document conversion to markdown
- **Chunking Logic**: RecursiveCharacterTextSplitter with token counting
- **Embedding Generation**: Azure OpenAI integration
- **Blob Storage**: Upload/download with SAS tokens
- **MongoDB**: Connection, repositories, error handling
- **Queue Service**: Base class and message handling
- **Error Handling**: Retry logic, exponential backoff
- **Logging**: Structured logging to stdout

### New Components ❌

- **Dropbox API Integration**: File download, metadata, webhook verification
- **Webhook Endpoints**: Signature verification, event processing
- **Dropbox-Specific Models**: DropboxFile, DropboxChunk
- **File Type Detection**: Extension-based routing
- **Deduplication Logic**: Hash-based file comparison
- **Cursor Management**: Tracking Dropbox changes

## Security Considerations

### 1. Webhook Security

- **Signature Verification**: Validate X-Dropbox-Signature header
- **HTTPS Only**: Webhook endpoint must use HTTPS
- **Rate Limiting**: Implement rate limiting on webhook endpoint
- **Replay Protection**: Track processed webhook IDs

### 2. Access Control

- **Folder Restrictions**: Limit sync to specific Dropbox folders
- **File Type Whitelist**: Only process approved file types
- **Size Limits**: Reject files over size threshold (e.g., 100MB)
- **User Permissions**: Respect Dropbox sharing permissions

### 3. Data Isolation

- **Separate Database**: `isaac-dropbox` isolated from `pptx-gen`
- **Separate Collections**: No cross-contamination
- **Blob Prefix**: Use `dropbox/` prefix in blob storage
- **Queue Separation**: Dedicated queue for Dropbox files

### 4. Secrets Management

- **Azure Key Vault**: Store Dropbox tokens securely
- **Environment Variables**: Never commit secrets to code
- **Token Rotation**: Support token refresh
- **Webhook Secret**: Rotate periodically

## Monitoring & Observability

### Key Metrics

- **Files Processed**: Count by status (pending, processing, completed, failed)
- **Processing Time**: Average time per file type
- **Queue Depth**: Messages waiting in dropbox-file-processing queue
- **Error Rate**: Failed processing attempts
- **Storage Usage**: Blob storage and MongoDB growth
- **API Calls**: Dropbox API and Azure OpenAI usage

### Logging

```python
# Structured logging for Dropbox events
logger.info("Dropbox file received", extra={
    "dropbox_path": file.path_display,
    "file_id": file.id,
    "file_size": file.size,
    "file_type": file_type
})

logger.info("File processing completed", extra={
    "file_id": str(file_id),
    "chunk_count": len(chunks),
    "processing_time": elapsed_time
})

logger.error("File processing failed", extra={
    "file_id": str(file_id),
    "error": str(e),
    "attempts": attempts
})
```

### Alerts

- **Queue Depth > 100**: Processing backlog
- **Error Rate > 10%**: System issues
- **Processing Time > 5min**: Performance degradation
- **Failed Files > 10**: Configuration or API issues

## Testing Strategy

### Unit Tests

```python
# Test Dropbox service
async def test_download_file():
    service = DropboxService(config)
    content = await service.download_file("/test.pdf")
    assert len(content) > 0

# Test webhook signature
def test_verify_signature():
    service = DropboxService(config)
    body = b'{"test": "data"}'
    signature = generate_test_signature(body)
    assert service.verify_webhook_signature(signature, body)

# Test file processing
async def test_process_dropbox_file():
    worker = DropboxFileWorker(config)
    result = await worker.process_dropbox_file(test_message)
    assert result["status"] == "completed"
```

### Integration Tests

```python
# Test end-to-end flow
async def test_dropbox_webhook_flow():
    # 1. Simulate webhook
    response = await client.post(
        "/api/dropbox/webhook",
        json=test_webhook_payload,
        headers={"X-Dropbox-Signature": test_signature}
    )
    assert response.status_code == 200
    
    # 2. Check file record created
    file = await dropbox_file_repository.find_one({
        "dropbox_file_id": test_file_id
    })
    assert file is not None
    assert file["processing_status"] == "pending"
    
    # 3. Wait for processing
    await asyncio.sleep(10)
    
    # 4. Verify completion
    file = await dropbox_file_repository.find_by_id(file["_id"])
    assert file["processing_status"] == "completed"
    assert file["chunk_count"] > 0
```

### Manual Testing

```bash
# 1. Test webhook verification
curl "https://your-domain.com/api/dropbox/webhook?challenge=test123"

# 2. Trigger manual sync
curl -X POST https://your-domain.com/api/dropbox/sync \
    -H "Authorization: Bearer YOUR_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"path": "/Test Folder", "recursive": false}'

# 3. Check file status
curl https://your-domain.com/api/dropbox/files/FILE_ID \
    -H "Authorization: Bearer YOUR_TOKEN"

# 4. List processed files
curl "https://your-domain.com/api/dropbox/files?status=completed&limit=10" \
    -H "Authorization: Bearer YOUR_TOKEN"
```

## Implementation Checklist

### Phase 1: Backend Setup

- [ ] Create `backend/routes/dropbox.py` with webhook endpoints
- [ ] Create `backend/services/dropbox_service.py` for Dropbox API
- [ ] Create `backend/models/dropbox_file.py` for Pydantic models
- [ ] Extend `backend/services/queue.py` with Dropbox queue methods
- [ ] Add Dropbox configuration to `backend/config.py`
- [ ] Create MongoDB repositories for dropbox_files and dropbox_chunks
- [ ] Create MongoDB indexes
- [ ] Add Dropbox routes to main.py

### Phase 2: Worker Setup

- [ ] Extend `worker/main.py` with Dropbox message handling
- [ ] Add `process_dropbox_file()` method
- [ ] Configure database switching (pptx-gen vs isaac-dropbox)
- [ ] Add support for additional file types (Excel, CSV, etc.)
- [ ] Test docling conversion for all file types
- [ ] Update worker configuration

### Phase 3: Deployment

- [ ] Create Azure Service Bus queue: `dropbox-file-processing`
- [ ] Set up Dropbox app and get credentials
- [ ] Add environment variables to backend
- [ ] Add environment variables to worker
- [ ] Deploy backend with new routes
- [ ] Deploy worker with Dropbox support
- [ ] Configure webhook URL in Dropbox app
- [ ] Test webhook verification

### Phase 4: Testing

- [ ] Test webhook with Dropbox test events
- [ ] Verify file download from Dropbox
- [ ] Test file upload to blob storage
- [ ] Test RAG processing for PDF files
- [ ] Test RAG processing for Word files
- [ ] Test RAG processing for Excel files
- [ ] Test RAG processing for PowerPoint files
- [ ] Test manual sync endpoint
- [ ] Verify embeddings in MongoDB
- [ ] Test vector search queries

### Phase 5: Monitoring

- [ ] Set up logging for Dropbox events
- [ ] Create dashboard for file processing metrics
- [ ] Configure alerts for queue depth
- [ ] Configure alerts for error rates
- [ ] Monitor storage usage
- [ ] Track API usage (Dropbox, OpenAI)

## Expected Results

### Database Collections

**`isaac-dropbox.dropbox_files`**
- 1 record per unique file in Dropbox
- Tracks processing status and metadata
- Links to blob storage and markdown

**`isaac-dropbox.dropbox_chunks`**
- 10-50 chunks per file (varies by size)
- Each chunk has 3072-dimensional embedding
- Indexed for vector search

### Storage Usage

**Azure Blob Storage:**
- Original files: `dropbox/{hash}/{filename}`
- Markdown files: `dropbox/markdown/{file_id}.md`
- Estimated: 2x original file size

**MongoDB:**
- File records: ~5KB per file
- Chunks: ~10KB per chunk (including embedding)
- Estimated: 500KB - 2MB per file

### Processing Performance

- **PDF (10 pages)**: ~30-60 seconds
- **Word (5000 words)**: ~20-40 seconds
- **PowerPoint (20 slides)**: ~40-80 seconds
- **Excel (10 sheets)**: ~30-60 seconds

## Comparison: Upload vs Dropbox

| Feature | User Upload System | Dropbox Integration |
|---------|-------------------|---------------------|
| **Trigger** | User action in web UI | Dropbox webhook (automatic) |
| **File Source** | Browser upload | Dropbox API download |
| **Authentication** | Azure AD user token | Dropbox app token |
| **Database** | `pptx-gen` | `isaac-dropbox` |
| **Queue** | `slide-processing` | `dropbox-file-processing` |
| **Collections** | `decks`, `slides`, `files`, `document_chunks` | `dropbox_files`, `dropbox_chunks` |
| **Slide Extraction** | Yes (PPTX only) | No (all files) |
| **Screenshot Generation** | Yes | No |
| **RAG Processing** | Yes | Yes |
| **Markdown Conversion** | Yes (docling) | Yes (docling) |
| **Embeddings** | Yes (Azure OpenAI) | Yes (Azure OpenAI) |
| **Vector Search** | Yes | Yes |
| **User Context** | Specific user | System/Dropbox user |
| **File Types** | PPTX, PDF, DOCX | All supported types |
| **Processing Focus** | Presentation slides | Document content |
| **Manual Trigger** | Upload button | Sync API endpoint |

## Success Criteria

The Dropbox integration is complete when:

- ✅ Webhook endpoint receives and validates Dropbox notifications
- ✅ Files are automatically downloaded from Dropbox
- ✅ Files are uploaded to Azure Blob Storage
- ✅ RAG processing completes for all file types
- ✅ Embeddings are generated and stored
- ✅ Vector search returns relevant results
- ✅ No impact on existing upload system
- ✅ Monitoring and alerts are configured
- ✅ Documentation is complete

## Future Enhancements

### Phase 2 Features

1. **Incremental Updates**: Only reprocess changed sections
2. **File Deletion Handling**: Remove chunks when files are deleted
3. **Folder Organization**: Maintain Dropbox folder structure
4. **Selective Sync**: Configure which folders to sync
5. **Real-time Sync**: Reduce webhook processing delay
6. **Conflict Resolution**: Handle file conflicts gracefully

### Advanced Features

1. **OCR for Images**: Extract text from images in documents
2. **Table Extraction**: Preserve table structure in markdown
3. **Multi-language Support**: Detect and handle different languages
4. **Version History**: Track file versions and changes
5. **Collaborative Filtering**: Suggest related documents
6. **Smart Chunking**: Context-aware chunk boundaries

## Conclusion

This Dropbox integration extends the existing PowerPoint processing system to automatically ingest and process company files from Dropbox. By reusing the established RAG pipeline (docling, embeddings, vector search) and maintaining clear separation (different database, queue, and collections), the system remains simple and maintainable while providing powerful document search capabilities across the entire company knowledge base.

The integration is triggered externally by Dropbox webhooks rather than user uploads, making it a fully automated document ingestion pipeline that complements the existing user-driven upload system.

