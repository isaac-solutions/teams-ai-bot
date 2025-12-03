# Configuration Status for Dropbox RAG Integration

## ✅ What You Already Have (from PPTX Project)

These credentials from your PPTX project can be reused:

### MongoDB
- ✅ **MONGODB_URI**: Connected to `isaac-mongo.wbotkro.mongodb.net`
- ⚠️ **MONGODB_DATABASE**: Change from `pptx-gen` to `isaac-dropbox`

### Azure Service Bus
- ✅ **SERVICE_BUS_CONNECTION_STRING**: `pptx-rag-isaac.servicebus.windows.net`
- ❌ **SERVICE_BUS_QUEUE_NAME**: Need to create new queue `dropbox-file-processing`
  - Current: `slide-processing` (for PPTX worker)
  - Needed: `dropbox-file-processing` (for Dropbox worker)

### Azure Blob Storage
- ✅ **BLOB_CONNECTION_STRING**: `rgisaacstorage` account
- ✅ **BLOB_CONTAINER_NAME**: Can reuse `pptx` container

### Azure OpenAI
- ✅ **OPENAI_API_KEY**: Connected to `aisaac.cognitiveservices.azure.com`
- ✅ **AZURE_OPENAI_ENDPOINT**: `https://aisaac.cognitiveservices.azure.com/`
- ✅ **AZURE_OPENAI_API_VERSION**: `2024-02-15-preview`
- ✅ **OPENAI_EMBEDDING_MODEL**: `text-embedding-3-large` deployment exists

## ❌ What's Missing for Dropbox Integration

### Required for Backend API

1. **DROPBOX_ACCESS_TOKEN** ❌ **MISSING**
   - Where to get: https://www.dropbox.com/developers/apps
   - Steps:
     1. Create app → Choose "Scoped access" → "Full Dropbox"
     2. Go to Settings tab
     3. Scroll to "OAuth 2" → Click "Generate" under "Generated access token"
     4. Copy the token (starts with `sl.`)

2. **DROPBOX_APP_KEY** (optional, for webhook verification later)
   - Same app, found in Settings tab

3. **DROPBOX_APP_SECRET** (optional, for webhook verification later)
   - Same app, found in Settings tab → "Show" button

## 🔧 Action Items

### 1. Create Azure Service Bus Queue

```bash
az servicebus queue create \
  --resource-group your-resource-group \
  --namespace-name pptx-rag-isaac \
  --name dropbox-file-processing \
  --max-delivery-count 3 \
  --lock-duration PT5M
```

Or create via Azure Portal:
- Go to Service Bus namespace: `pptx-rag-isaac`
- Click "Queues" → "+ Queue"
- Name: `dropbox-file-processing`
- Save

### 2. Create Dropbox App

1. Visit: https://www.dropbox.com/developers/apps
2. Click "Create app"
3. Choose:
   - API: **Scoped access**
   - Access: **Full Dropbox** (or App folder if you prefer)
   - Name: `dropbox-rag-processor` (or your choice)
4. Click "Create app"

### 3. Configure Dropbox Permissions

In your new app → Permissions tab, enable:
- ✅ `files.metadata.read` - Read file metadata
- ✅ `files.content.read` - Read file content

Click "Submit" to save.

### 4. Generate Dropbox Access Token

In your app → Settings tab:
- Scroll to "OAuth 2" section
- Under "Generated access token", click "Generate"
- Copy the token (this is what goes in DROPBOX_ACCESS_TOKEN)

### 5. Create MongoDB Database

The `isaac-dropbox` database will be created automatically on first use, but you can create indexes:

```javascript
// Connect to MongoDB
use isaac-dropbox

// Create indexes for dropbox_files
db.dropbox_files.createIndex({ "dropbox_file_id": 1 }, { unique: true })
db.dropbox_files.createIndex({ "processing_status": 1 })
db.dropbox_files.createIndex({ "file_type": 1 })

// Create indexes for dropbox_chunks
db.dropbox_chunks.createIndex({ "file_id": 1 })
db.dropbox_chunks.createIndex({ "file_id": 1, "chunk_index": 1 })
```

### 6. Create Vector Search Index (MongoDB Atlas)

For semantic search, create an Atlas Search index:
- Database: `isaac-dropbox`
- Collection: `dropbox_chunks`
- Index name: `vector_index`
- Configuration:

```json
{
  "mappings": {
    "dynamic": false,
    "fields": {
      "embedding": {
        "type": "knnVector",
        "dimensions": 3072,
        "similarity": "cosine"
      },
      "file_id": {
        "type": "objectId"
      }
    }
  }
}
```

## 📝 Your Configuration Files

### Worker `.env` file

Create `dropbox-mongodb/worker/.env`:

```

## ⚠️ Important Notes

1. **Azure OpenAI Endpoint**: Your endpoint seems to include the full deployment path. The worker expects just the base endpoint: `https://aisaac.cognitiveservices.azure.com/`

2. **Queue Name**: Make sure to create the new queue `dropbox-file-processing` - don't reuse `slide-processing` as it's for the PPTX worker.

3. **Database Name**: Changed from `pptx-gen` to `isaac-dropbox` to keep data separate.

4. **Security**: 
   - Delete `env2.example` file (it has your credentials)
   - Never commit `.env` files
   - The credentials are already in `.gitignore`

## 🧪 Testing Order

Once configuration is complete:

1. **Test Worker Locally** (no Dropbox needed):
   ```bash
   cd worker
   python test_worker_local.py --file "test.pdf"
   ```

2. **Create Queue**:
   ```bash
   az servicebus queue create --name dropbox-file-processing --namespace-name pptx-rag-isaac --resource-group YOUR_RG
   ```

3. **Get Dropbox Token**:
   - Follow steps in "Create Dropbox App" above

4. **Run Backend**:
   ```bash
   cd backend
   python -m uvicorn main:app --reload
   ```

5. **Run Worker**:
   ```bash
   cd worker
   python main.py
   ```

6. **Test Sync**:
   ```bash
   curl -X POST http://localhost:8000/api/dropbox/sync \
     -H "Content-Type: application/json" \
     -d '{"path": "/Test"}'
   ```

## 📋 Checklist

- [ ] Create Azure Service Bus queue: `dropbox-file-processing`
- [ ] Create Dropbox app at developers.dropbox.com
- [ ] Configure Dropbox app permissions
- [ ] Generate Dropbox access token
- [ ] Create `worker/.env` file with configuration above
- [ ] Create `backend/.env` file with configuration above
- [ ] Delete `env2.example` file (has exposed credentials)
- [ ] Test worker locally with `test_worker_local.py`
- [ ] Create MongoDB indexes (optional but recommended)
- [ ] Create Atlas Search vector index (optional but recommended for search quality)
- [ ] Run backend and worker
- [ ] Test with small Dropbox folder first

## Next Steps

After setup is complete, refer to:
- **QUICKSTART.md** - For quick testing
- **SETUP.md** - For detailed MongoDB index setup
- **README.md** - For full API documentation

