# Script to check Azure resource status for Teams Bot
# This script checks if any Azure resources used by the Teams bot are stopped or deallocated

param(
    [string]$ResourceGroupName,
    [string]$SubscriptionId
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Azure Resources Status Check" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if Azure CLI is installed
$azCliInstalled = Get-Command az -ErrorAction SilentlyContinue
if (-not $azCliInstalled) {
    Write-Host "ERROR: Azure CLI is not installed or not in PATH" -ForegroundColor Red
    Write-Host "Please install Azure CLI from: https://aka.ms/installazurecliwindows" -ForegroundColor Yellow
    exit 1
}

# Check if logged in to Azure
$azAccount = az account show 2>$null | ConvertFrom-Json
if (-not $azAccount) {
    Write-Host "Not logged in to Azure. Logging in..." -ForegroundColor Yellow
    az login
    $azAccount = az account show 2>$null | ConvertFrom-Json
    if (-not $azAccount) {
        Write-Host "ERROR: Failed to login to Azure" -ForegroundColor Red
        exit 1
    }
}

# Get subscription ID if not provided
if (-not $SubscriptionId) {
    $SubscriptionId = $azAccount.id
    Write-Host "Using subscription: $($azAccount.name) ($SubscriptionId)" -ForegroundColor Green
} else {
    az account set --subscription $SubscriptionId
    $azAccount = az account show | ConvertFrom-Json
    Write-Host "Using subscription: $($azAccount.name) ($SubscriptionId)" -ForegroundColor Green
}

# Get resource group name if not provided
if (-not $ResourceGroupName) {
    Write-Host ""
    Write-Host "Available Resource Groups:" -ForegroundColor Yellow
    $resourceGroups = az group list --subscription $SubscriptionId --query "[].name" -o tsv
    if ($resourceGroups) {
        $resourceGroups | ForEach-Object { Write-Host "  - $_" -ForegroundColor Gray }
        Write-Host ""
        $ResourceGroupName = Read-Host "Enter Resource Group Name"
    } else {
        Write-Host "ERROR: No resource groups found" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "Checking resources in Resource Group: $ResourceGroupName" -ForegroundColor Cyan
Write-Host ""

# Check if resource group exists
$rgExists = az group exists --name $ResourceGroupName --subscription $SubscriptionId
if ($rgExists -eq "false") {
    Write-Host "ERROR: Resource Group '$ResourceGroupName' does not exist" -ForegroundColor Red
    exit 1
}

# Get all resources in the resource group
Write-Host "Fetching resources..." -ForegroundColor Yellow
$resources = az resource list --resource-group $ResourceGroupName --subscription $SubscriptionId -o json | ConvertFrom-Json

if (-not $resources -or $resources.Count -eq 0) {
    Write-Host "WARNING: No resources found in resource group '$ResourceGroupName'" -ForegroundColor Yellow
    exit 0
}

Write-Host "Found $($resources.Count) resource(s)" -ForegroundColor Green
Write-Host ""

$issuesFound = $false

# Check each resource
foreach ($resource in $resources) {
    $resourceType = $resource.type
    $resourceName = $resource.name
    $resourceId = $resource.id
    
    Write-Host "----------------------------------------" -ForegroundColor Gray
    Write-Host "Resource: $resourceName" -ForegroundColor White
    Write-Host "Type: $resourceType" -ForegroundColor Gray
    
    # Check App Service (Web App)
    if ($resourceType -eq "Microsoft.Web/sites") {
        Write-Host "Checking App Service status..." -ForegroundColor Yellow
        $webApp = az webapp show --name $resourceName --resource-group $ResourceGroupName --subscription $SubscriptionId -o json 2>$null | ConvertFrom-Json
        
        if ($webApp) {
            $state = $webApp.state
            $defaultHostName = $webApp.defaultHostName
            $httpsOnly = $webApp.httpsOnly
            $alwaysOn = $webApp.siteConfig.alwaysOn
            
            Write-Host "  State: $state" -ForegroundColor $(if ($state -eq "Running") { "Green" } else { "Red" })
            Write-Host "  URL: https://$defaultHostName" -ForegroundColor Gray
            Write-Host "  HTTPS Only: $httpsOnly" -ForegroundColor Gray
            Write-Host "  Always On: $alwaysOn" -ForegroundColor Gray
            
            if ($state -ne "Running") {
                Write-Host "  ⚠️  ISSUE: App Service is not running!" -ForegroundColor Red
                $issuesFound = $true
                
                # Try to get more details
                $webAppStatus = az webapp show --name $resourceName --resource-group $ResourceGroupName --query "state" -o tsv
                Write-Host "  Current Status: $webAppStatus" -ForegroundColor Red
            } else {
                # Test if the endpoint is reachable
                Write-Host "  Testing endpoint..." -ForegroundColor Yellow
                try {
                    $response = Invoke-WebRequest -Uri "https://$defaultHostName" -Method Get -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
                    Write-Host "  ✓ Endpoint is reachable (Status: $($response.StatusCode))" -ForegroundColor Green
                } catch {
                    Write-Host "  ⚠️  Endpoint may not be responding: $($_.Exception.Message)" -ForegroundColor Yellow
                }
            }
        } else {
            Write-Host "  ⚠️  Could not retrieve App Service details" -ForegroundColor Yellow
        }
    }
    
    # Check App Service Plan
    if ($resourceType -eq "Microsoft.Web/serverfarms") {
        Write-Host "Checking App Service Plan status..." -ForegroundColor Yellow
        $appServicePlan = az appservice plan show --name $resourceName --resource-group $ResourceGroupName --subscription $SubscriptionId -o json 2>$null | ConvertFrom-Json
        
        if ($appServicePlan) {
            $status = $appServicePlan.status
            $sku = $appServicePlan.sku.name
            $numberOfWorkers = $appServicePlan.sku.capacity
            
            Write-Host "  Status: $status" -ForegroundColor $(if ($status -eq "Ready") { "Green" } else { "Red" })
            Write-Host "  SKU: $sku" -ForegroundColor Gray
            Write-Host "  Workers: $numberOfWorkers" -ForegroundColor Gray
            
            if ($status -ne "Ready") {
                Write-Host "  ⚠️  ISSUE: App Service Plan is not ready!" -ForegroundColor Red
                $issuesFound = $true
            }
        } else {
            Write-Host "  ⚠️  Could not retrieve App Service Plan details" -ForegroundColor Yellow
        }
    }
    
    # Check Bot Service
    if ($resourceType -eq "Microsoft.BotService/botServices") {
        Write-Host "Checking Bot Service status..." -ForegroundColor Yellow
        $botService = az bot show --name $resourceName --resource-group $ResourceGroupName --subscription $SubscriptionId -o json 2>$null | ConvertFrom-Json
        
        if ($botService) {
            $botState = $botService.properties.state
            $botEndpoint = $botService.properties.endpoint
            $msaAppId = $botService.properties.msaAppId
            
            Write-Host "  State: $botState" -ForegroundColor $(if ($botState -eq "Registered") { "Green" } else { "Red" })
            Write-Host "  Endpoint: $botEndpoint" -ForegroundColor Gray
            Write-Host "  MSA App ID: $msaAppId" -ForegroundColor Gray
            
            if ($botState -ne "Registered") {
                Write-Host "  ⚠️  ISSUE: Bot Service is not registered!" -ForegroundColor Red
                $issuesFound = $true
            }
            
            # Check Teams channel
            Write-Host "  Checking Teams channel..." -ForegroundColor Yellow
            $teamsChannel = az bot msteams show --name $resourceName --resource-group $ResourceGroupName --subscription $SubscriptionId -o json 2>$null | ConvertFrom-Json
            
            if ($teamsChannel) {
                $channelEnabled = $teamsChannel.properties.isEnabled
                Write-Host "  Teams Channel Enabled: $channelEnabled" -ForegroundColor $(if ($channelEnabled) { "Green" } else { "Red" })
                
                if (-not $channelEnabled) {
                    Write-Host "  ⚠️  ISSUE: Teams channel is not enabled!" -ForegroundColor Red
                    $issuesFound = $true
                }
            } else {
                Write-Host "  ⚠️  Could not retrieve Teams channel details" -ForegroundColor Yellow
            }
        } else {
            Write-Host "  ⚠️  Could not retrieve Bot Service details" -ForegroundColor Yellow
        }
    }
    
    # Check Managed Identity
    if ($resourceType -eq "Microsoft.ManagedIdentity/userAssignedIdentities") {
        Write-Host "Checking Managed Identity..." -ForegroundColor Yellow
        $identity = az identity show --name $resourceName --resource-group $ResourceGroupName --subscription $SubscriptionId -o json 2>$null | ConvertFrom-Json
        
        if ($identity) {
            $clientId = $identity.clientId
            $principalId = $identity.principalId
            Write-Host "  Client ID: $clientId" -ForegroundColor Gray
            Write-Host "  Principal ID: $principalId" -ForegroundColor Gray
            Write-Host "  ✓ Managed Identity exists" -ForegroundColor Green
        } else {
            Write-Host "  ⚠️  Could not retrieve Managed Identity details" -ForegroundColor Yellow
        }
    }
    
    Write-Host ""
}

Write-Host "========================================" -ForegroundColor Cyan
if ($issuesFound) {
    Write-Host "⚠️  ISSUES FOUND!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Common fixes:" -ForegroundColor Yellow
    Write-Host "1. If App Service is stopped, start it with:" -ForegroundColor Yellow
    Write-Host "   az webapp start --name <app-name> --resource-group $ResourceGroupName" -ForegroundColor White
    Write-Host ""
    Write-Host "2. If App Service Plan is deallocated, check your subscription quota" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "3. If Bot Service is not registered, check the endpoint URL" -ForegroundColor Yellow
} else {
    Write-Host "✓ All resources appear to be running normally" -ForegroundColor Green
}
Write-Host "========================================" -ForegroundColor Cyan

