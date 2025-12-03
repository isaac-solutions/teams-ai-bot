# Azure Deployment Guide for Dropbox Worker

## Prerequisites

- Azure CLI installed and logged in
- Docker installed locally
- Azure Container Registry (or create one)
- Worker `.env` file configured

## Deployment Steps

### 1. Create/Verify Azure Container Registry

```powershell
# Create if needed
az acr create --name yourregistry --resource-group your-rg --sku Basic --location eastus

# Or use existing registry
az acr list --output table
```

### 2. Deploy Worker to Azure

```powershell
cd dropbox-mongodb/worker

# Deploy (builds, pushes, and creates container)
./deploy-worker.ps1 -ResourceGroup "your-rg" -RegistryName "yourregistry" -Location "eastus"
```

**Parameters:**
- `ResourceGroup` - Your Azure resource group
- `RegistryName` - Your Azure Container Registry name
- `ContainerName` - Container instance name (default: dropbox-worker)
- `Location` - Azure region (default: eastus)
- `-SkipBuild` - Skip Docker build (use existing image)

### 3. Verify Deployment

```powershell
# Check container status
az container show --name dropbox-worker --resource-group your-rg --query instanceView.state

# View logs
az container logs --name dropbox-worker --resource-group your-rg --follow
```

**Expected logs:**
```
Starting Dropbox File Processing Worker
Connected to MongoDB: isaac-dropbox
Connected to Azure Service Bus
Connected to Azure Blob Storage
Listening for messages on queue: dropbox-file-processing
```

## Testing Without Dropbox

You can test the worker processes files correctly before setting up Dropbox.

### Option 1: Automated Test Script

```powershell
cd dropbox-mongodb

# Test with a local file
./test-azure-worker.ps1 -TestFile "path\to\test.pdf" -ResourceGroup "your-rg"
```

This script:
1. Uploads test file to blob storage
2. Sends message to queue
3. Worker picks up and processes
4. Shows you how to check results

### Option 2: Manual Test

**Step 1: Upload test file to blob**
```powershell
az storage blob upload \
  --connection-string "YOUR_CONNECTION_STRING" \
  --container-name dropbox \
  --name "dropbox/test/testfile.pdf" \
  --file "path\to\test.pdf"
```

**Step 2: Send test message to queue**
```json
{
  "message_type": "dropbox_file",
  "file_id": "507f1f77bcf86cd799439011",
  "dropbox_path": "/test/testfile.pdf",
  "dropbox_file_id": "test:123",
  "blob_url": "https://youraccount.blob.core.windows.net/dropbox/dropbox/test/testfile.pdf",
  "filename": "testfile.pdf",
  "file_type": "pdf",
  "user_id": "test-user",
  "timestamp": "2024-01-15T10:00:00Z"
}
```

```powershell
az servicebus queue message send \
  --namespace-name pptx-rag-isaac \
  --queue-name dropbox-file-processing \
  --body @message.json
```

**Step 3: Watch worker process it**
```powershell
az container logs --name dropbox-worker --resource-group your-rg --follow
```

### Verify Processing

**Check MongoDB:**
```javascript
use isaac-dropbox

// Should see the file record
db.dropbox_files.findOne({file_id: "507f1f77bcf86cd799439011"})

// Should see chunks with embeddings
db.dropbox_chunks.find({file_id: ObjectId("507f1f77bcf86cd799439011")}).count()
```

**Check Blob Storage:**
- Original: `dropbox/test/testfile.pdf`
- Markdown: `dropbox/markdown/507f1f77bcf86cd799439011.md`

## Monitoring

### View Real-time Logs
```powershell
az container logs --name dropbox-worker --resource-group your-rg --follow
```

### Check Container Status
```powershell
az container show --name dropbox-worker --resource-group your-rg --query instanceView
```

### Check Queue
```powershell
az servicebus queue show \
  --namespace-name pptx-rag-isaac \
  --name dropbox-file-processing \
  --query messageCount
```

### Restart Worker
```powershell
az container restart --name dropbox-worker --resource-group your-rg
```

## Troubleshooting

### Worker Not Starting
```powershell
# Check logs for errors
az container logs --name dropbox-worker --resource-group your-rg

# Common issues:
# - Missing environment variables
# - MongoDB connection string incorrect
# - Service Bus connection string incorrect
```

### Worker Not Processing Messages
```powershell
# Check if messages are in queue
az servicebus queue show --namespace-name pptx-rag-isaac --name dropbox-file-processing

# Check worker is listening
az container logs --name dropbox-worker --resource-group your-rg | Select-String "Listening"
```

### Processing Failures
```powershell
# Check dead-letter queue
az servicebus queue show --namespace-name pptx-rag-isaac --name dropbox-file-processing --query "countDetails.deadLetterMessageCount"

# View detailed logs
az container logs --name dropbox-worker --resource-group your-rg --tail 100
```

## Updating Worker

After code changes:

```powershell
cd dropbox-mongodb/worker

# Redeploy with new code
./deploy-worker.ps1 -ResourceGroup "your-rg" -RegistryName "yourregistry"
```

## Cost Optimization

### Development/Testing
- Use 1 CPU, 2GB memory
- Stop when not in use

### Production
- Use 2 CPU, 4GB memory
- Enable auto-restart
- Monitor costs in Azure Portal

## Next Steps

Once worker is validated:
1. Add Dropbox access token to backend
2. Deploy backend to Azure App Service
3. Test full Dropbox sync
4. Set up monitoring alerts
5. Configure auto-scaling if needed

