# Deployment Fixes Applied

## Issues Identified
1. **Environment Variable Passing**: Batch file approach was corrupting special characters in connection strings
2. **Entrypoint Error Handling**: Using `set -e` caused silent failures
3. **Missing Debug Output**: No visibility into what was failing
4. **Bash Availability**: Not explicitly installed

## Fixes Applied

### 1. deploy-worker.ps1 + deploy_container.py
- **NEW APPROACH**: Use Python script to handle Azure CLI deployment
- PowerShell converts environment variables to JSON
- Python script (`deploy_container.py`) receives JSON and builds Azure CLI command
- Python's `subprocess.run` properly handles special characters (`&`, `?`, `=`, etc.)
- Each environment variable passed as separate `--environment-variables KEY=VALUE` argument
- This completely bypasses PowerShell and batch file interpretation issues

### 2. entrypoint.sh
- **REMOVED** `set -e` to allow error capture
- **ADDED** comprehensive debugging output:
  - Python version verification
  - File listing
  - Environment variable display
  - Exit code capture and reporting
- Redirects all output to stderr for visibility in Azure logs

### 3. Dockerfile
- **ADDED** explicit bash installation
- **ADDED** import verification step after pip install
- Verifies all critical modules import successfully before image completion
- Uses entrypoint script for better error handling

### 4. .dockerignore
- Already properly excludes Team_Site/ and Team Site/
- Excludes test files, venv, and other unnecessary files

## Deployment Steps
1. Run: `./deploy-worker.ps1 -ResourceGroup "IsaacLLM" -RegistryName "pptxacr2024" -UseAcrBuild`
2. Wait for image build (10-11 minutes)
3. Container will deploy automatically
4. Check logs immediately: `az container logs --name dropbox-worker --resource-group IsaacLLM`

## Expected Behavior
- Entrypoint script will print startup diagnostics
- Python version, file listing, and env vars will be visible
- Worker will log connection attempts to MongoDB, Service Bus, and Blob Storage
- If successful, worker will show "Waiting for messages..."
- Any errors will be captured in logs with full stack traces

## Verification Commands
```powershell
# Check container state
az container show --name dropbox-worker --resource-group IsaacLLM --query "containers[0].instanceView.currentState"

# Check logs (with follow)
az container logs --name dropbox-worker --resource-group IsaacLLM --follow

# Check events
az container show --name dropbox-worker --resource-group IsaacLLM --query "containers[0].instanceView.events"
```

## Root Cause Analysis
The previous batch file approach was escaping quotes incorrectly, causing the Azure CLI to misinterpret environment variable boundaries. This resulted in:
- Truncated MONGODB_URI (stopped at first `&` character)
- Missing or corrupted connection strings
- Container crash before Python could log errors

The array-based approach proven to work in earlier deployments has been restored.

