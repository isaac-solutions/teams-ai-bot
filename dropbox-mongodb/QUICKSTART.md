# Quick Start Guide

Get the Dropbox RAG integration running locally in 5 minutes.

## Prerequisites

- Python 3.11+
- MongoDB connection string
- Azure Service Bus queue
- Azure Blob Storage
- Azure OpenAI deployment
- Dropbox access token

## Step 1: Backend Setup (2 minutes)

```bash
cd dropbox-mongodb/backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp env.example .env
# Edit .env with your credentials

# Start backend
python -m uvicorn main:app --reload --port 8000
```

Backend will be running at: http://localhost:8000

## Step 2: Worker Setup (2 minutes)

In a new terminal:

```bash
cd dropbox-mongodb/worker

# Create virtual environment
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp env.example .env
# Edit .env with same credentials as backend

# Start worker
python main.py
```

Worker will connect to the queue and wait for messages.

## Step 3: Test the System (1 minute)

### Option A: Test Docling Locally First (Recommended)

```bash
cd worker
python test_worker_local.py --file "path/to/test.pdf"
```

This tests document conversion without Azure dependencies. Review the output in `./test_output/`.

### Option B: Test Full Pipeline

```bash
# Sync files from Dropbox
curl -X POST http://localhost:8000/api/dropbox/sync \
  -H "Content-Type: application/json" \
  -d '{"path": "/Test", "recursive": false}'

# Check processing status
curl http://localhost:8000/api/dropbox/files

# Search (after files are processed)
curl -X POST http://localhost:8000/api/rag/search \
  -H "Content-Type: application/json" \
  -d '{"query": "your search query", "top_k": 5}'
```

## Step 4: View API Documentation

Open browser to: http://localhost:8000/docs

This provides interactive API documentation with all endpoints.

## Troubleshooting

### Worker Not Processing

1. Check worker terminal for errors
2. Verify queue name matches in both .env files
3. Check Azure Service Bus queue for messages:
   ```bash
   az servicebus queue show --name dropbox-file-processing --namespace-name YOUR_NAMESPACE --resource-group YOUR_RG
   ```

### Docling Conversion Issues

Test locally first:
```bash
cd worker
python test_worker_local.py --file "problematic.pdf" --output-dir "./debug"
```

Review the markdown output to identify issues.

### Vector Search Not Working

The system will automatically fall back to text search if vector index is not configured. To enable vector search:

1. Create Atlas Search index in MongoDB (see SETUP.md)
2. Index name must be: `vector_index`
3. Dimensions: 3072 (or 1536 for text-embedding-3-small)

## Next Steps

- Read [README.md](README.md) for full feature documentation
- Read [SETUP.md](SETUP.md) for production deployment
- Configure MongoDB vector search index for better search results
- Test with various file types (PDF, DOCX, PPTX)
- Set up monitoring and alerts

## Common Environment Variables

Minimum required in both backend and worker `.env`:

```bash
# MongoDB
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/?retryWrites=true&w=majority
MONGODB_DATABASE=isaac-dropbox

# Azure Service Bus
SERVICE_BUS_CONNECTION_STRING=Endpoint=sb://...
SERVICE_BUS_QUEUE_NAME=dropbox-file-processing

# Azure Blob Storage
BLOB_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=...
BLOB_CONTAINER_NAME=pptx

# Azure OpenAI
OPENAI_API_KEY=your-key
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
OPENAI_EMBEDDING_MODEL=text-embedding-3-large

# Dropbox (backend only)
DROPBOX_ACCESS_TOKEN=sl.your-token
```

## Health Checks

```bash
# System health
curl http://localhost:8000/health

# RAG system with stats
curl http://localhost:8000/api/rag/health
```

## Support

- For setup issues, see [SETUP.md](SETUP.md)
- For API usage, see [README.md](README.md)
- For local testing, use `test_worker_local.py`

