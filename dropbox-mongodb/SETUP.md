# Dropbox RAG Integration Setup Guide

This guide walks you through setting up the Dropbox RAG integration system, including Dropbox app configuration, Azure resources, and MongoDB setup.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [MongoDB Setup](#mongodb-setup)
3. [Azure Service Bus Setup](#azure-service-bus-setup)
4. [Azure Blob Storage Setup](#azure-blob-storage-setup)
5. [Azure OpenAI Setup](#azure-openai-setup)
6. [Dropbox App Setup](#dropbox-app-setup)
7. [Local Development Setup](#local-development-setup)
8. [Deployment](#deployment)
9. [Verification](#verification)

## Prerequisites

- Azure subscription with permissions to create resources
- MongoDB Atlas account (or self-hosted MongoDB 5.0+)
- Dropbox account with admin access
- Python 3.11+ installed locally
- Docker installed (for containerized deployment)
- Azure CLI installed

## MongoDB Setup

### 1. Create Database

```bash
# Connect to your MongoDB instance
# Create the isaac-dropbox database (it will be created automatically on first use)
```

### 2. Create Collections

The collections will be created automatically, but you can create them manually:

```javascript
// In MongoDB shell or Compass
use isaac-dropbox

// Create collections
db.createCollection("dropbox_files")
db.createCollection("dropbox_chunks")
```

### 3. Create Indexes

**Required Indexes:**

```javascript
// dropbox_files collection
db.dropbox_files.createIndex({ "dropbox_file_id": 1 }, { unique: true })
db.dropbox_files.createIndex({ "dropbox_path": 1 })
db.dropbox_files.createIndex({ "processing_status": 1 })
db.dropbox_files.createIndex({ "file_type": 1 })
db.dropbox_files.createIndex({ "file_hash": 1, "dropbox_path": 1 })

// dropbox_chunks collection
db.dropbox_chunks.createIndex({ "file_id": 1 })
db.dropbox_chunks.createIndex({ "file_id": 1, "chunk_index": 1 })
```

### 4. Create Vector Search Index (MongoDB Atlas Only)

For vector similarity search, create an Atlas Search index:

1. Go to MongoDB Atlas → Database → Search
2. Click "Create Search Index"
3. Choose "JSON Editor"
4. Name: `vector_index`
5. Collection: `dropbox_chunks`
6. Use this configuration:

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
      },
      "content": {
        "type": "string"
      }
    }
  }
}
```

**Note:** For text-embedding-3-small, use 1536 dimensions instead of 3072.

## Azure Service Bus Setup

### 1. Create Service Bus Namespace

```bash
# Set variables
RESOURCE_GROUP="your-resource-group"
LOCATION="eastus"
NAMESPACE_NAME="your-servicebus-namespace"

# Create namespace
az servicebus namespace create \
  --resource-group $RESOURCE_GROUP \
  --name $NAMESPACE_NAME \
  --location $LOCATION \
  --sku Standard
```

### 2. Create Queue

```bash
# Create dropbox-file-processing queue
az servicebus queue create \
  --resource-group $RESOURCE_GROUP \
  --namespace-name $NAMESPACE_NAME \
  --name dropbox-file-processing \
  --max-delivery-count 3 \
  --lock-duration PT5M
```

### 3. Get Connection String

```bash
# Get connection string
az servicebus namespace authorization-rule keys list \
  --resource-group $RESOURCE_GROUP \
  --namespace-name $NAMESPACE_NAME \
  --name RootManageSharedAccessKey \
  --query primaryConnectionString \
  --output tsv
```

Save this connection string for later use.

## Azure Blob Storage Setup

### 1. Use Existing Storage or Create New

If you have existing blob storage from the PPTX project, you can reuse it. Otherwise:

```bash
STORAGE_ACCOUNT="yourstorageaccount"

# Create storage account
az storage account create \
  --name $STORAGE_ACCOUNT \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION \
  --sku Standard_LRS

# Create container (if not exists)
az storage container create \
  --account-name $STORAGE_ACCOUNT \
  --name pptx \
  --auth-mode login
```

### 2. Get Connection String

```bash
# Get connection string
az storage account show-connection-string \
  --name $STORAGE_ACCOUNT \
  --resource-group $RESOURCE_GROUP \
  --output tsv
```

## Azure OpenAI Setup

### 1. Create Azure OpenAI Resource

1. Go to Azure Portal
2. Create a new "Azure OpenAI" resource
3. Choose your subscription, resource group, and region
4. Select pricing tier (Standard)

### 2. Deploy Embedding Model

1. Go to Azure OpenAI Studio (https://oai.azure.com/)
2. Navigate to "Deployments"
3. Click "Create new deployment"
4. Select model: `text-embedding-3-large`
5. Deployment name: `text-embedding-3-large` (or your preferred name)
6. Deploy

**Note:** You can also use `text-embedding-3-small` for lower costs (1536 dimensions).

### 3. Get API Keys

```bash
# Get endpoint
az cognitiveservices account show \
  --name your-openai-resource \
  --resource-group $RESOURCE_GROUP \
  --query properties.endpoint \
  --output tsv

# Get API key
az cognitiveservices account keys list \
  --name your-openai-resource \
  --resource-group $RESOURCE_GROUP \
  --query key1 \
  --output tsv
```

## Dropbox App Setup

### 1. Create Dropbox App

1. Go to https://www.dropbox.com/developers/apps
2. Click "Create app"
3. Choose:
   - **API**: Scoped access
   - **Access**: Full Dropbox (or App folder, depending on your needs)
   - **App name**: `dropbox-rag-processor` (or your preferred name)
4. Click "Create app"

### 2. Configure Permissions

In the app settings, go to the "Permissions" tab and enable:

**Required permissions:**
- `files.metadata.read` - Read file metadata
- `files.content.read` - Read file content
- `files.content.write` - (Optional) For writing processed results back
- `sharing.read` - (Optional) For accessing shared folders

Click "Submit" to save permissions.

### 3. Generate Access Token

**For Testing/Development:**

1. Go to the "Settings" tab
2. Scroll to "OAuth 2"
3. Under "Generated access token", click "Generate"
4. Copy the token (starts with `sl.`)

**Important:** This token is for development only and is tied to your user account.

**For Production (Recommended):**

For a production setup, implement OAuth 2.0 flow to get user-specific tokens:

1. Note your App key and App secret from the Settings tab
2. Implement OAuth flow:
   ```
   Authorization URL: https://www.dropbox.com/oauth2/authorize
   Token URL: https://api.dropboxapi.com/oauth2/token
   Redirect URI: Your backend URL
   ```

3. Store tokens securely (use Azure Key Vault in production)

### 4. Set Up Webhook (Optional, for Future)

For automatic file change detection:

1. In app settings, go to "Webhooks" section
2. Add webhook URI: `https://your-backend-url/api/dropbox/webhook`
3. Save the webhook secret for signature verification

**Note:** For initial implementation, we're using manual sync, so webhooks can be configured later.

## Local Development Setup

### 1. Clone and Set Up Backend

```bash
cd dropbox-mongodb/backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Copy environment template
cp env.example .env

# Edit .env with your credentials
nano .env
```

Fill in all the credentials you gathered above.

### 2. Set Up Worker

```bash
cd ../worker

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Copy environment template
cp env.example .env

# Edit .env with your credentials
nano .env
```

### 3. Test Worker Locally

Before running the full system, test docling conversion:

```bash
cd worker

# Test with a sample PDF file
python test_worker_local.py --file "path/to/test.pdf" --output-dir "./test_output"

# With embeddings (requires Azure OpenAI credentials in env)
python test_worker_local.py --file "path/to/test.pdf" --with-embeddings
```

Review the output to ensure markdown conversion quality is acceptable.

### 4. Run Backend Locally

```bash
cd ../backend

# Start the FastAPI server
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Access the API docs at: http://localhost:8000/docs

### 5. Run Worker Locally

In a separate terminal:

```bash
cd worker

# Activate virtual environment
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Run the worker
python main.py
```

The worker will connect to the queue and wait for messages.

## Deployment

### Deploy Worker to Azure Container Instances

```bash
cd worker

# Ensure you have an Azure Container Registry
ACR_NAME="yourregistry"

# Create registry if needed
az acr create \
  --resource-group $RESOURCE_GROUP \
  --name $ACR_NAME \
  --sku Basic

# Run deployment script
./deploy-worker.ps1 -ResourceGroup $RESOURCE_GROUP -RegistryName $ACR_NAME -Location $LOCATION
```

### Deploy Backend to Azure App Service

```bash
cd backend

# Create App Service plan
az appservice plan create \
  --name dropbox-rag-plan \
  --resource-group $RESOURCE_GROUP \
  --sku B1 \
  --is-linux

# Create web app
az webapp create \
  --resource-group $RESOURCE_GROUP \
  --plan dropbox-rag-plan \
  --name dropbox-rag-api \
  --runtime "PYTHON:3.11"

# Configure environment variables
az webapp config appsettings set \
  --resource-group $RESOURCE_GROUP \
  --name dropbox-rag-api \
  --settings @env-settings.json

# Deploy code
az webapp up \
  --resource-group $RESOURCE_GROUP \
  --name dropbox-rag-api
```

## Verification

### 1. Check Health Endpoints

```bash
# Backend health
curl http://localhost:8000/health

# RAG health
curl http://localhost:8000/api/rag/health
```

### 2. Test Manual Sync

```bash
# Sync a Dropbox folder
curl -X POST http://localhost:8000/api/dropbox/sync \
  -H "Content-Type: application/json" \
  -d '{
    "path": "/Test",
    "recursive": false
  }'
```

### 3. Check Worker Logs

```bash
# If running locally, check terminal output

# If deployed to ACI:
az container logs \
  --resource-group $RESOURCE_GROUP \
  --name dropbox-worker \
  --follow
```

### 4. Test RAG Search

After files are processed:

```bash
curl -X POST http://localhost:8000/api/rag/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What is the revenue forecast?",
    "top_k": 5
  }'
```

### 5. Check MongoDB

```javascript
// Check file records
use isaac-dropbox
db.dropbox_files.find().limit(5).pretty()

// Check chunks
db.dropbox_chunks.find().limit(2).pretty()

// Check processing status
db.dropbox_files.aggregate([
  { $group: { _id: "$processing_status", count: { $sum: 1 } } }
])
```

## Troubleshooting

### Worker Not Processing Files

1. Check queue for messages:
```bash
az servicebus queue show \
  --resource-group $RESOURCE_GROUP \
  --namespace-name $NAMESPACE_NAME \
  --name dropbox-file-processing
```

2. Check worker logs for errors
3. Verify all environment variables are set correctly
4. Test docling locally with `test_worker_local.py`

### Vector Search Not Working

1. Verify Atlas Search index is created and synced
2. Check index name matches `vector_index` in code
3. Verify embedding dimensions (3072 for large, 1536 for small)
4. System will fall back to text search if vector index unavailable

### Dropbox API Errors

1. Verify access token is valid (tokens can expire)
2. Check app permissions are granted
3. Test Dropbox API directly:
```bash
curl -X POST https://api.dropboxapi.com/2/files/list_folder \
  --header "Authorization: Bearer YOUR_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"path": ""}'
```

## Security Best Practices

1. **Never commit `.env` files** to version control
2. **Use Azure Key Vault** for production secrets
3. **Rotate access tokens** regularly
4. **Use managed identities** where possible
5. **Configure CORS** appropriately for production
6. **Enable authentication** on backend API for production use
7. **Use private endpoints** for Azure services if possible

## Next Steps

1. Test with various file types (PDF, DOCX, PPTX, etc.)
2. Monitor costs (Azure OpenAI, blob storage, Service Bus)
3. Set up alerts for failed processing
4. Configure webhook for automatic syncing (optional)
5. Implement authentication/authorization for API
6. Set up CI/CD pipeline for deployments
7. Configure monitoring and logging (Application Insights)

## Support

For issues or questions:
- Check the main README.md for architecture overview
- Review worker logs for processing errors
- Test docling conversion locally before deploying
- Verify all Azure resources are in the same region for performance

