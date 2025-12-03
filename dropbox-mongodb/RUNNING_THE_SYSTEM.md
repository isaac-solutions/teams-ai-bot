# Running the Dropbox RAG System

## ✅ Enhanced Deduplication Logic

The system now uses a **two-step smart check** to avoid unnecessary processing:

### Step 1: Quick Metadata Check (Instant)
- Compares `dropbox_modified_at` timestamp
- If dates match → **Skip** (no download needed)
- ⚡ **Fast**: Just database lookup, no file download

### Step 2: Hash Check (Only if metadata changed)
- Compares Dropbox `content_hash`
- If hash matches → **Skip** (file renamed or metadata changed, but content is same)
- Updates modified date for tracking
- 📊 **Moderate**: Uses Dropbox's content hash (no download needed)

### Step 3: Full Processing (Only if hash changed)
- Downloads file
- Calculates SHA256
- Processes through docling → chunks → embeddings
- 🔄 **Slow**: Full pipeline

## 🚀 Running the System

### Terminal 1: Backend API
```bash
cd C:\Users\ChrisRass\AgentsToolkitProjects\dropbox-mongodb\backend
venv\Scripts\activate
python -m uvicorn main:app --reload --port 8000
```

**Wait for:** `✓ Connected to MongoDB: isaac-dropbox`

### Terminal 2: Worker
```bash
cd C:\Users\ChrisRass\AgentsToolkitProjects\dropbox-mongodb\worker
venv\Scripts\activate
python main.py
```

**Wait for:** `Listening for messages on queue: dropbox-file-processing`

### Terminal 3: Trigger Sync
```powershell
# Sync your Dropbox folder
curl -X POST http://localhost:8000/api/dropbox/sync `
  -H "Content-Type: application/json" `
  -d '{\"path\": \"/Team Site/Best Practice/Finalized Best Practice/01_Diagnostics/01_Diagnostic Resources for Leads & Client Leads\", \"recursive\": true}'
```

## 📊 Monitoring

### Watch Worker Logs
The worker will show:
```
File unchanged (metadata check): file1.pdf  ← Step 1 skip
File unchanged (hash check): file2.pdf      ← Step 2 skip  
File changed, will reprocess: file3.pdf     ← Step 3 process
```

### Check Processing Status
```bash
# List all files
curl http://localhost:8000/api/dropbox/files

# Filter by status
curl http://localhost:8000/api/dropbox/files?status=completed

# Get specific file
curl http://localhost:8000/api/dropbox/files/{file_id}
```

### Check System Health
```bash
curl http://localhost:8000/health
curl http://localhost:8000/api/rag/health
```

## 🔍 Search Your Documents

Once files are processed:

```powershell
curl -X POST http://localhost:8000/api/rag/search `
  -H "Content-Type: application/json" `
  -d '{\"query\": \"diagnostic checklist\", \"top_k\": 5}'
```

## 📈 What Happens on Each Sync

### First Sync (All New Files)
- Downloads all files
- Processes everything
- Creates embeddings
- **Time**: ~1-2 min per file

### Second Sync (No Changes)
- **Step 1 check** → All skipped instantly
- **Time**: ~1 second total (just metadata checks)

### Re-sync After File Edit
- **Step 1 check** → Modified date changed
- **Step 2 check** → Hash comparison
- Only changed files downloaded and processed
- **Time**: ~1-2 min per changed file only

## 🎯 Efficiency Gains

**Scenario**: 100 files synced daily

| Check Type | Files | Time | Cost |
|------------|-------|------|------|
| Metadata (Step 1) | 95 unchanged | ~1 sec | Free |
| Hash (Step 2) | 4 renamed | ~2 sec | Free |
| Full Process (Step 3) | 1 changed | ~90 sec | $0.001 |

**Result**: 99% of files skip processing, saving time and money!

## 🛠️ Configuration

### Force Reprocess All Files
```powershell
curl -X POST http://localhost:8000/api/dropbox/sync `
  -H "Content-Type: application/json" `
  -d '{\"path\": \"/Your/Path\", \"recursive\": true, \"force_reprocess\": true}'
```

### Filter by File Type
```powershell
curl -X POST http://localhost:8000/api/dropbox/sync `
  -H "Content-Type: application/json" `
  -d '{\"path\": \"/Your/Path\", \"recursive\": true, \"file_types\": [\"pdf\", \"docx\"]}'
```

## 📝 Logs Explained

### Backend Logs
```
File unchanged (metadata check): report.pdf
  → Modified date matches, skipped instantly

File unchanged (hash check): renamed_report.pdf  
  → File was renamed but content is same, skipped

File changed, will reprocess: updated_report.pdf
  → Content changed, downloading and processing
```

### Worker Logs
```
Processing Dropbox file 507f1f77bcf86cd799439011: report.pdf
Converting pdf file to markdown: /tmp/dropbox-worker/report.pdf
✓ Conversion completed in 12.34s
✓ Created 23 chunks from markdown content
Generating embeddings for 23 chunks...
✓ Successfully generated 23 embeddings
Inserted 23 document chunks for file 507f1f77bcf86cd799439011
✓ Successfully processed Dropbox file 507f1f77bcf86cd799439011
```

## 🔧 Troubleshooting

### Worker Not Processing
1. Check queue in Azure Portal
2. Verify `SERVICE_BUS_QUEUE_NAME=dropbox-file-processing` in both `.env` files
3. Check worker terminal for errors

### Files Not Being Skipped
1. First sync always processes everything (no existing records)
2. Check MongoDB has records: `db.dropbox_files.find().pretty()`
3. Verify modified dates are being stored correctly

### Search Not Finding Results
1. Wait for worker to complete processing (check `status=completed`)
2. Verify MongoDB Atlas Search index is created
3. System falls back to text search if vector index unavailable

## 📚 Next Steps

1. **Monitor First Sync**: Let it process all files once
2. **Test Re-sync**: Run sync again, should skip all unchanged files
3. **Edit a File in Dropbox**: Modify a file, sync again, only that file processes
4. **Set Up Scheduled Syncs**: Use cron/scheduler to sync periodically
5. **Create Vector Index**: For better search quality (see SETUP.md)

## 🎉 You're Ready!

Your system is now:
- ✅ Processing Dropbox files automatically
- ✅ Smart deduplication (metadata → hash → full process)
- ✅ Generating embeddings for RAG search
- ✅ Ready for agent integration

The enhanced deduplication means you can sync frequently without wasting resources!

