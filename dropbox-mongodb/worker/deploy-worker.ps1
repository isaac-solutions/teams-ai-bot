# PowerShell script to deploy Dropbox Worker to Azure Container Instances
# This script builds and deploys the worker container to Azure

param(
    [string]$ResourceGroup = "IsaacLLM",
    [string]$ContainerName = "dropbox-worker",
    [string]$Location = "eastus",
    [string]$RegistryName = "dropbox-mongodb-worker",
    [switch]$SkipBuild = $false,
    [switch]$UseAcrBuild = $false
)

$ErrorActionPreference = "Stop"

Write-Host "====================================" -ForegroundColor Cyan
Write-Host "Dropbox Worker Deployment Script" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan
Write-Host ""

# Load environment variables from .env file
if (Test-Path ".env") {
    Write-Host "Loading environment variables from .env..." -ForegroundColor Yellow
    $loadedCount = 0
    Get-Content .env -Raw | ForEach-Object {
        # Split by lines, handling both \r\n and \n
        $_ -split "`r?`n" | ForEach-Object {
            $line = $_.Trim()
            # Skip comments and empty lines
            if ($line -match '^\s*#') { return }
            if ($line -match '^\s*$') { return }
            
            # Split on first = only, to handle values with = in them
            $parts = $line -split '=', 2
            if ($parts.Length -eq 2) {
                $name = $parts[0].Trim()
                $value = $parts[1].Trim()
                
                # Remove surrounding quotes (single or double) if present
                if ($value -match '^["''](.+)["'']$') {
                    $value = $matches[1]
                }
                
                # Set environment variable (handles special characters like &, ?, etc.)
                [Environment]::SetEnvironmentVariable($name, $value, "Process")
                $loadedCount++
            }
        }
    }
    Write-Host "Loaded $loadedCount environment variables from .env file" -ForegroundColor Green
} else {
    Write-Host "Warning: .env file not found. Make sure environment variables are set." -ForegroundColor Red
    exit 1
}

# Build Docker image
if (-not $SkipBuild) {
    if ($UseAcrBuild) {
        # Use Azure Container Registry Build (no local Docker needed)
        Write-Host "Building Docker image in Azure Container Registry..." -ForegroundColor Green
        az acr build --registry $RegistryName --image dropbox-worker:latest .
        
        if ($LASTEXITCODE -ne 0) {
            Write-Host "ACR build failed!" -ForegroundColor Red
            exit 1
        }
        Write-Host "✓ Image built and pushed to ACR" -ForegroundColor Green
    } else {
        # Use local Docker (requires Docker Desktop running)
        Write-Host "Building Docker image locally..." -ForegroundColor Green
        docker build -t ${RegistryName}.azurecr.io/dropbox-worker:latest .
        
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Docker build failed! Is Docker Desktop running?" -ForegroundColor Red
            Write-Host "Tip: Use -UseAcrBuild to build in Azure instead" -ForegroundColor Yellow
            exit 1
        }
        
        Write-Host "Pushing image to Azure Container Registry..." -ForegroundColor Green
        az acr login --name $RegistryName
        docker push ${RegistryName}.azurecr.io/dropbox-worker:latest
        
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Docker push failed!" -ForegroundColor Red
            exit 1
        }
    }
} else {
    Write-Host "Skipping Docker build (using existing image)..." -ForegroundColor Yellow
}

# Delete existing container instance if it exists
Write-Host "Checking for existing container instance..." -ForegroundColor Green
$existingContainer = az container show --name $ContainerName --resource-group $ResourceGroup 2>$null
if ($existingContainer) {
    Write-Host "Deleting existing container instance..." -ForegroundColor Yellow
    az container delete --name $ContainerName --resource-group $ResourceGroup --yes
}

# Get ACR credentials
Write-Host "Getting ACR credentials..." -ForegroundColor Green
$acrCredentials = az acr credential show --name $RegistryName | ConvertFrom-Json
$acrUsername = $acrCredentials.username
$acrPassword = $acrCredentials.passwords[0].value

# Deploy to Azure Container Instances
Write-Host "Deploying to Azure Container Instances..." -ForegroundColor Green

# Build environment variables hashtable for Azure CLI
Write-Host "Preparing environment variables for deployment..." -ForegroundColor Yellow
$envVars = @{}

# List of expected environment variables
$expectedVars = @(
    "MONGODB_URI", "MONGODB_DATABASE", "SERVICE_BUS_CONNECTION_STRING", 
    "SERVICE_BUS_QUEUE_NAME", "BLOB_CONNECTION_STRING", "BLOB_CONTAINER_NAME",
    "OPENAI_API_KEY", "OPENAI_EMBEDDING_MODEL", "AZURE_OPENAI_ENDPOINT",
    "AZURE_OPENAI_API_VERSION", "LOG_LEVEL", "CHUNK_SIZE", "CHUNK_OVERLAP",
    "MAX_RECEIVE_COUNT", "MAX_WAIT_TIME"
)

# Load all environment variables from process environment
foreach ($varName in $expectedVars) {
    $varValue = [Environment]::GetEnvironmentVariable($varName, "Process")
    if ($varValue) {
        $envVars[$varName] = $varValue
        Write-Host "  ✓ $varName" -ForegroundColor Gray
    } else {
        Write-Host "  ✗ $varName (missing)" -ForegroundColor Yellow
    }
}

# Also include any other variables that start with expected prefixes
Get-ChildItem Env: | Where-Object { 
    $_.Name -match '^(MONGODB_|SERVICE_BUS_|BLOB_|OPENAI_|AZURE_OPENAI_|LOG_LEVEL|CHUNK_|MAX_)' -and 
    -not $envVars.ContainsKey($_.Name)
} | ForEach-Object {
    $envVars[$_.Name] = $_.Value
    Write-Host "  ✓ $($_.Name) (additional)" -ForegroundColor Gray
}

Write-Host "Total environment variables to deploy: $($envVars.Count)" -ForegroundColor Green

# Deploy using JSON file approach - Azure CLI supports this and avoids all shell interpretation
Write-Host "Deploying container with $($envVars.Count) environment variables..." -ForegroundColor Green

# Create temporary JSON file with container configuration
# Azure Container Instances JSON format
$tempJsonFile = [System.IO.Path]::GetTempFileName() + ".json"

# Build environment variables as array of objects (required by Azure API)
$envVarsArray = @()
foreach ($envVar in $envVars.GetEnumerator()) {
    $envVarsArray += @{
        name = $envVar.Key
        value = $envVar.Value
    }
}

# Build container configuration JSON matching Azure Container Instances API format
# The JSON needs 'properties' wrapper and environmentVariables as array
$containerConfig = @{
    location = $Location
    properties = @{
        containers = @(
            @{
                name = $ContainerName
                properties = @{
                    image = "${RegistryName}.azurecr.io/dropbox-worker:latest"
                    environmentVariables = $envVarsArray
                    resources = @{
                        requests = @{
                            cpu = 2
                            memoryInGb = 4
                        }
                    }
                }
            }
        )
        osType = "Linux"
        restartPolicy = "Always"
        imageRegistryCredentials = @(
            @{
                server = "${RegistryName}.azurecr.io"
                username = $acrUsername
                password = $acrPassword
            }
        )
    }
}

# Convert to JSON and write to file
$containerConfig | ConvertTo-Json -Depth 10 | Out-File -FilePath $tempJsonFile -Encoding UTF8

try {
    # Deploy using JSON file - this completely avoids shell interpretation
    $deployOutput = az container create --resource-group $ResourceGroup --name $ContainerName --file $tempJsonFile --output json 2>&1
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Container deployment failed!" -ForegroundColor Red
        Write-Host $deployOutput -ForegroundColor Red
        exit 1
    } else {
        Write-Host "✓ Container deployed successfully!" -ForegroundColor Green
        try {
            $deployResult = $deployOutput | ConvertFrom-Json
            if ($deployResult.containers -and $deployResult.containers[0].instanceView.currentState) {
                Write-Host "Container state: $($deployResult.containers[0].instanceView.currentState.state)" -ForegroundColor Cyan
            }
        } catch {
            # Ignore display errors - deployment succeeded
        }
    }
} finally {
    # Clean up temporary file
    if (Test-Path $tempJsonFile) {
        Remove-Item $tempJsonFile -Force -ErrorAction SilentlyContinue
    }
}

Write-Host ""
Write-Host "====================================" -ForegroundColor Cyan
Write-Host "Deployment Complete!" -ForegroundColor Green
Write-Host "====================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Container Name: $ContainerName" -ForegroundColor Yellow
Write-Host "Resource Group: $ResourceGroup" -ForegroundColor Yellow
Write-Host ""
Write-Host "To check logs:" -ForegroundColor White
Write-Host "  az container logs --name $ContainerName --resource-group $ResourceGroup" -ForegroundColor Gray
Write-Host ""
Write-Host "To check status:" -ForegroundColor White
Write-Host "  az container show --name $ContainerName --resource-group $ResourceGroup --query instanceView.state" -ForegroundColor Gray
Write-Host ""

