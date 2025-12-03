# Test Worker in Azure Without Dropbox
# This script uploads a test file and sends a message to the queue

param(
    [Parameter(Mandatory=$true)]
    [string]$TestFile,
    [string]$ResourceGroup = "your-resource-group"
)

Write-Host "Testing Azure Worker" -ForegroundColor Cyan
Write-Host "===================" -ForegroundColor Cyan

# Load environment from worker/.env
$envPath = Join-Path $PSScriptRoot "worker\.env"
if (Test-Path $envPath) {
    Get-Content $envPath | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+?)\s*=\s*(.+?)\s*$') {
            $name = $matches[1]
            $value = $matches[2]
            Set-Variable -Name $name -Value $value -Scope Script
        }
    }
} else {
    Write-Host "Error: worker/.env not found" -ForegroundColor Red
    exit 1
}

# Verify test file exists
if (-not (Test-Path $TestFile)) {
    Write-Host "Error: Test file not found: $TestFile" -ForegroundColor Red
    exit 1
}

$fileName = Split-Path $TestFile -Leaf
$fileExt = [System.IO.Path]::GetExtension($TestFile).TrimStart('.')

Write-Host "`n1. Calculating file hash..." -ForegroundColor Yellow
$fileHash = (Get-FileHash -Path $TestFile -Algorithm SHA256).Hash.ToLower()
Write-Host "   Hash: $fileHash" -ForegroundColor Gray

Write-Host "`n2. Uploading to Azure Blob Storage..." -ForegroundColor Yellow
$blobName = "dropbox/test/$fileHash/$fileName"

# Upload to blob storage
az storage blob upload `
    --connection-string $BLOB_CONNECTION_STRING `
    --container-name $BLOB_CONTAINER_NAME `
    --name $blobName `
    --file $TestFile `
    --overwrite

Write-Host "   Uploaded to: $blobName" -ForegroundColor Gray

# Get blob URL
$storageAccount = ($BLOB_CONNECTION_STRING -split ';' | Where-Object { $_ -like 'AccountName=*' }) -replace 'AccountName=', ''
$blobUrl = "https://$storageAccount.blob.core.windows.net/$BLOB_CONTAINER_NAME/$blobName"

Write-Host "`n3. Generating test file ID..." -ForegroundColor Yellow
# Generate a MongoDB-compatible ObjectId (24 hex chars)
$timestamp = [int][double]::Parse((Get-Date -UFormat %s))
$fileId = ($timestamp.ToString("x8") + -join ((1..16) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) }))
Write-Host "   Test File ID: $fileId" -ForegroundColor Gray

Write-Host "`n4. Sending test message to queue..." -ForegroundColor Yellow
# Create message body
$messageBody = @{
    message_type = "dropbox_file"
    file_id = $fileId
    dropbox_path = "/test/$fileName"
    dropbox_file_id = "test:$fileId"
    blob_url = $blobUrl
    filename = $fileName
    file_type = $fileExt
    user_id = "test-user"
    metadata = @{}
    timestamp = (Get-Date).ToUniversalTime().ToString("o")
} | ConvertTo-Json -Compress

# Send to queue
$serviceBusNamespace = ($SERVICE_BUS_CONNECTION_STRING -split ';' | Where-Object { $_ -like 'Endpoint=sb://*' }) -replace 'Endpoint=sb://', '' -replace '\.servicebus\.windows\.net.*', ''

az servicebus queue message send `
    --namespace-name $serviceBusNamespace `
    --queue-name $SERVICE_BUS_QUEUE_NAME `
    --body $messageBody

Write-Host "   Message sent to queue: $SERVICE_BUS_QUEUE_NAME" -ForegroundColor Gray

Write-Host "`n✓ Test file uploaded and queued for processing!" -ForegroundColor Green
Write-Host "`n" + "="*60 -ForegroundColor Cyan
Write-Host "NEXT STEPS" -ForegroundColor Cyan
Write-Host "="*60 -ForegroundColor Cyan

Write-Host "`n1. Watch worker logs:" -ForegroundColor Yellow
Write-Host "   az container logs --name dropbox-worker --resource-group $ResourceGroup --follow" -ForegroundColor White

Write-Host "`n2. Check if message was picked up:" -ForegroundColor Yellow
Write-Host "   az servicebus queue show --namespace-name $serviceBusNamespace --name $SERVICE_BUS_QUEUE_NAME --query messageCount" -ForegroundColor White

Write-Host "`n3. Verify in MongoDB (after ~30-60 sec):" -ForegroundColor Yellow
Write-Host "   use isaac-dropbox" -ForegroundColor White
Write-Host "   db.dropbox_files.findOne({_id: ObjectId('$fileId')})" -ForegroundColor White
Write-Host "   db.dropbox_chunks.find({file_id: ObjectId('$fileId')}).count()" -ForegroundColor White

Write-Host "`n4. Check blob storage for markdown:" -ForegroundColor Yellow
Write-Host "   Look for: dropbox/markdown/$fileId.md" -ForegroundColor White

Write-Host "`nTest File ID: $fileId" -ForegroundColor Cyan
Write-Host "="*60 -ForegroundColor Cyan

