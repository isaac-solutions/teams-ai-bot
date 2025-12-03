# Dropbox RAG Integration

A production-ready system for automatically ingesting and processing files from Dropbox using RAG (Retrieval-Augmented Generation) for intelligent document search and retrieval.

## Overview

This system provides:

- **Automatic File Processing**: Converts Dropbox files (PDF, DOCX, PPTX, etc.) to searchable markdown using docling
- **Vector Search**: Generates embeddings using Azure OpenAI for semantic search
- **RAG API**: FastAPI backend with endpoints for sync, search, and file management
- **Scalable Worker**: Containerized worker for processing files from Azure Service Bus queue
- **Local Testing**: Test docling conversion locally before deploying

## Architecture

```
┌─────────────┐
│   Dropbox   │
│   Storage   │
└──────┬──────┘
       │
       │ Manual Sync API
       ▼
┌─────────────────────────────────────┐
│      FastAPI Backend                │
│  - Manual sync endpoint             │
│  - File listing & status            │
│  - RAG search (vector similarity)   │
└───────┬─────────────────────────────┘
        │
        │ Queue Message
        ▼
┌─────────────────────────────────────┐
│   Azure Service Bus Queue           │
│   (dropbox-file-processing)         │
└───────┬─────────────────────────────┘
        │
        │ Worker Processes
        ▼
┌─────────────────────────────────────┐
│   Dropbox File Worker               │
│   1. Download from blob             │
│   2. Convert to markdown (docling)  │
│   3. Chunk text (512 tokens)        │
│   4. Generate embeddings (OpenAI)   │
│   5. Store in MongoDB               │
└───────┬─────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│   MongoDB (isaac-dropbox)           │
│   - dropbox_files                   │
│   - dropbox_chunks (with vectors)   │
└─────────────────────────────────────┘
```

## Key Features

### Supported File Types

- **Documents**: PDF, DOCX, DOC, TXT, MD, HTML, RTF
- **Presentations**: PPTX, PPT
- **Spreadsheets**: XLSX, XLS, CSV

### Processing Pipeline

1. **Document Conversion**: Uses docling to convert documents to clean markdown
2. **Intelligent Chunking**: Splits content into 512-token chunks with 50-token overlap
3. **Embedding Generation**: Creates 3072-dimensional vectors using Azure OpenAI
4. **Vector Storage**: Stores chunks with embeddings in MongoDB for fast retrieval
5. **Deduplication**: Hash-based deduplication prevents reprocessing unchanged files

### RAG Search Features

- **Semantic Search**: Vector similarity search using cosine distance
- **Metadata Filtering**: Filter by file type, file ID, or minimum score
- **Ranked Results**: Returns top-k most relevant chunks with scores
- **Source Attribution**: Each result includes source file and location
- **Fallback Search**: Automatic fallback to text search if vector index unavailable

## Project Structure

```
dropbox-mongodb/
├── worker/
│   ├── main.py                  # Worker for processing files
│   ├── test_worker_local.py     # Local testing script
│   ├── requirements.txt         # Worker dependencies
│   ├── env.example              # Environment template
│   ├── Dockerfile               # Container image
│   └── deploy-worker.ps1        # Deployment script
│
├── backend/
│   ├── main.py                  # FastAPI application
│   ├── routes/
│   │   ├── dropbox.py           # Sync and file management
│   │   └── rag.py               # Vector search endpoints
│   ├── services/
│   │   ├── dropbox_service.py   # Dropbox API integration
│   │   └── queue_service.py     # Azure Service Bus
│   ├── models/
│   │   ├── dropbox_file.py      # Data models
│   │   └── rag_models.py        # Search models
│   ├── requirements.txt         # Backend dependencies
│   └── env.example              # Environment template
│
├── SETUP.md                     # Detailed setup guide
└── README.md                    # This file
```

## Quick Start

### Prerequisites

- Python 3.11+
- MongoDB (Atlas or self-hosted)
- Azure subscription (Service Bus, Blob Storage, OpenAI)
- Dropbox account with API access

### Installation

1. **Clone the repository**

```bash
cd dropbox-mongodb
```

2. **Set up Backend**

```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
cp env.example .env
# Edit .env with your credentials
```

3. **Set up Worker**

```bash
cd ../worker
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
cp env.example .env
# Edit .env with your credentials
```

4. **Test Locally**

Test docling conversion before running the full system:

```bash
cd worker
python test_worker_local.py --file "test.pdf" --output-dir "./test_output"
```

Review the generated markdown and chunks to ensure quality meets your needs.

### Running Locally

**Terminal 1 - Backend:**
```bash
cd backend
source venv/bin/activate
python -m uvicorn main:app --reload --port 8000
```

**Terminal 2 - Worker:**
```bash
cd worker
source venv/bin/activate
python main.py
```

Access API docs at: http://localhost:8000/docs

## Usage

### Manual Sync

Trigger processing of files from a Dropbox folder:

```bash
curl -X POST http://localhost:8000/api/dropbox/sync \
  -H "Content-Type: application/json" \
  -d '{
    "path": "/Documents",
    "recursive": true,
    "file_types": ["pdf", "docx"]
  }'
```

Response:
```json
{
  "status": "success",
  "files_queued": 15,
  "files_skipped": 3,
  "message": "Queued 15 files for processing, skipped 3 files"
}
```

### List Files

Get status of processed files:

```bash
curl http://localhost:8000/api/dropbox/files?status=completed&page=1&page_size=10
```

Response:
```json
{
  "files": [
    {
      "id": "507f1f77bcf86cd799439011",
      "filename": "Q4_Report.pdf",
      "file_type": "pdf",
      "processing_status": "completed",
      "chunk_count": 45,
      "dropbox_path": "/Documents/Q4_Report.pdf",
      "created_at": "2024-01-15T10:30:00Z",
      "updated_at": "2024-01-15T10:35:00Z"
    }
  ],
  "total": 15,
  "page": 1,
  "page_size": 10
}
```

### RAG Search

Search for relevant content:

```bash
curl -X POST http://localhost:8000/api/rag/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What were the key findings in the Q4 report?",
    "top_k": 5,
    "file_types": ["pdf"]
  }'
```

Response:
```json
{
  "query": "What were the key findings in the Q4 report?",
  "results": [
    {
      "chunk_id": "507f1f77bcf86cd799439012",
      "file_id": "507f1f77bcf86cd799439011",
      "filename": "Q4_Report.pdf",
      "file_type": "pdf",
      "dropbox_path": "/Documents/Q4_Report.pdf",
      "chunk_index": 12,
      "content": "## Key Findings\n\nRevenue increased by 25% year-over-year...",
      "score": 0.89,
      "metadata": {
        "chunk_type": "heading",
        "token_count": 485
      }
    }
  ],
  "total_results": 5,
  "search_time_ms": 145.2
}
```

### Health Check

Check system status:

```bash
curl http://localhost:8000/health
curl http://localhost:8000/api/rag/health
```

## API Reference

### Dropbox Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/dropbox/sync` | POST | Manually sync files from Dropbox |
| `/api/dropbox/files` | GET | List processed files with filters |
| `/api/dropbox/files/{file_id}` | GET | Get status of specific file |

### RAG Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/rag/search` | POST | Semantic search across documents |
| `/api/rag/health` | GET | RAG system health and stats |

### Request/Response Models

See `/docs` endpoint for interactive API documentation with full schema.

## Configuration

### Environment Variables

**Required:**
- `MONGODB_URI` - MongoDB connection string
- `MONGODB_DATABASE` - Database name (isaac-dropbox)
- `SERVICE_BUS_CONNECTION_STRING` - Azure Service Bus connection
- `SERVICE_BUS_QUEUE_NAME` - Queue name
- `BLOB_CONNECTION_STRING` - Azure Blob Storage connection
- `DROPBOX_ACCESS_TOKEN` - Dropbox API token
- `OPENAI_API_KEY` - Azure OpenAI API key
- `AZURE_OPENAI_ENDPOINT` - Azure OpenAI endpoint URL
- `OPENAI_EMBEDDING_MODEL` - Deployment name for embeddings

**Optional:**
- `CHUNK_SIZE` - Token count per chunk (default: 512)
- `CHUNK_OVERLAP` - Token overlap between chunks (default: 50)
- `LOG_LEVEL` - Logging level (default: INFO)

See `env.example` files for complete configuration.

## Local Testing

The `test_worker_local.py` script allows you to test docling conversion locally without any Azure dependencies:

```bash
cd worker

# Basic conversion test
python test_worker_local.py --file "sample.pdf"

# Custom output directory
python test_worker_local.py --file "sample.pdf" --output-dir "./my_output"

# Custom chunking
python test_worker_local.py --file "sample.pdf" --chunk-size 1024 --chunk-overlap 100

# With embeddings (requires Azure OpenAI credentials)
python test_worker_local.py --file "sample.pdf" --with-embeddings
```

**Outputs:**
- `{filename}.md` - Converted markdown
- `{filename}_chunks.json` - Chunked content with metadata
- `{filename}_summary.txt` - Processing summary and statistics

This is useful for:
- Verifying markdown quality before processing large batches
- Tuning chunk size and overlap parameters
- Testing with different file types
- Debugging conversion issues

## Deployment

### Deploy Worker to Azure Container Instances

```bash
cd worker
./deploy-worker.ps1 -ResourceGroup your-rg -RegistryName yourregistry -Location eastus
```

### Deploy Backend to Azure App Service

```bash
cd backend
az webapp up --name dropbox-rag-api --resource-group your-rg --runtime "PYTHON:3.11"
```

See [SETUP.md](SETUP.md) for detailed deployment instructions.

## MongoDB Setup

### Required Indexes

```javascript
// dropbox_files
db.dropbox_files.createIndex({ "dropbox_file_id": 1 }, { unique: true })
db.dropbox_files.createIndex({ "processing_status": 1 })
db.dropbox_files.createIndex({ "file_type": 1 })

// dropbox_chunks
db.dropbox_chunks.createIndex({ "file_id": 1 })
db.dropbox_chunks.createIndex({ "file_id": 1, "chunk_index": 1 })
```

### Vector Search Index (Atlas Search)

```json
{
  "mappings": {
    "dynamic": false,
    "fields": {
      "embedding": {
        "type": "knnVector",
        "dimensions": 3072,
        "similarity": "cosine"
      }
    }
  }
}
```

## Performance

### Processing Speed

- **PDF (10 pages)**: ~30-60 seconds
- **DOCX (5000 words)**: ~20-40 seconds
- **PPTX (20 slides)**: ~40-80 seconds

### Storage Usage

- **Blob Storage**: ~2x original file size (original + markdown)
- **MongoDB**: ~500KB - 2MB per file (chunks + embeddings)

### Cost Optimization

- Use `text-embedding-3-small` (1536 dimensions) for 50% cost reduction
- Adjust chunk size to balance between granularity and embedding costs
- Use hash-based deduplication to avoid reprocessing unchanged files

## Monitoring

### Key Metrics

- Files processed per hour
- Processing success/failure rate
- Average processing time per file type
- Queue depth (messages waiting)
- Storage growth rate

### Logging

All components use structured logging to stdout. Key events:

- File sync initiated
- File downloaded from Dropbox
- Markdown conversion completed
- Embeddings generated
- Chunks stored in MongoDB
- Processing errors

### Health Checks

```bash
# Backend health
GET /health

# RAG health with stats
GET /api/rag/health
```

## Troubleshooting

### Common Issues

**1. Worker not processing files**
- Check Service Bus queue for messages
- Verify environment variables
- Check worker logs for errors
- Test docling locally with `test_worker_local.py`

**2. Vector search not working**
- Verify Atlas Search index exists
- Check embedding dimensions match (3072 vs 1536)
- System will fall back to text search automatically

**3. Dropbox API errors**
- Verify access token is valid
- Check app permissions
- Test Dropbox API directly

**4. Out of memory errors**
- Increase container memory (4GB recommended)
- Process files in smaller batches
- Check for memory leaks in docling processing

See [SETUP.md](SETUP.md) for detailed troubleshooting steps.

## Security

- **Never commit `.env` files** to version control
- Use **Azure Key Vault** for production secrets
- Rotate **Dropbox tokens** regularly
- Configure **CORS** appropriately
- Enable **authentication** on API endpoints
- Use **private endpoints** for Azure services

## License

[Your License Here]

## Contributing

Contributions welcome! Please:
1. Test locally with `test_worker_local.py`
2. Ensure all tests pass
3. Update documentation
4. Submit pull request

## Support

For detailed setup instructions, see [SETUP.md](SETUP.md).

For issues:
- Check worker logs
- Test docling locally
- Verify all Azure resources are configured
- Review MongoDB indexes

## Roadmap

- [ ] Webhook support for automatic syncing
- [ ] Support for additional file types (OneNote, XML, JSON)
- [ ] Incremental updates (reprocess only changed sections)
- [ ] File deletion handling
- [ ] Enhanced table extraction
- [ ] Multi-language support
- [ ] Performance optimizations
- [ ] Authentication/authorization

