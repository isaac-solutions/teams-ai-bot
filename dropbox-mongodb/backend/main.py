"""
FastAPI Backend for Dropbox RAG Integration

This API provides:
- Manual sync endpoint to trigger Dropbox file processing
- File listing and status endpoints
- RAG search endpoints for vector similarity search
"""

import os
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from azure.storage.blob.aio import BlobServiceClient
from openai import AsyncAzureOpenAI
from dotenv import load_dotenv

from .routes import dropbox, rag
from .services.dropbox_service import DropboxService
from .services.queue_service import QueueService

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# Application lifespan for startup/shutdown
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifespan - startup and shutdown"""
    # Startup
    logger.info("Starting Dropbox RAG Backend...")
    
    # Initialize MongoDB
    mongodb_uri = os.getenv("MONGODB_URI")
    mongodb_database = os.getenv("MONGODB_DATABASE", "isaac-dropbox")
    
    if not mongodb_uri:
        raise ValueError("MONGODB_URI environment variable is required")
    
    mongo_client = AsyncIOMotorClient(mongodb_uri)
    db = mongo_client[mongodb_database]
    
    # Test MongoDB connection
    try:
        await mongo_client.admin.command('ping')
        logger.info(f"✓ Connected to MongoDB: {mongodb_database}")
    except Exception as e:
        logger.error(f"Failed to connect to MongoDB: {e}")
        raise
    
    # Initialize Dropbox service
    dropbox_access_token = os.getenv("DROPBOX_ACCESS_TOKEN")
    dropbox_app_key = os.getenv("DROPBOX_APP_KEY")
    dropbox_app_secret = os.getenv("DROPBOX_APP_SECRET")
    
    if not dropbox_access_token:
        raise ValueError("DROPBOX_ACCESS_TOKEN environment variable is required")
    
    dropbox_service = DropboxService(
        access_token=dropbox_access_token,
        app_key=dropbox_app_key,
        app_secret=dropbox_app_secret
    )
    logger.info("✓ Dropbox service initialized")
    
    # Initialize Queue service
    service_bus_connection = os.getenv("SERVICE_BUS_CONNECTION_STRING")
    service_bus_queue = os.getenv("SERVICE_BUS_QUEUE_NAME", "dropbox-file-processing")
    
    if not service_bus_connection:
        raise ValueError("SERVICE_BUS_CONNECTION_STRING environment variable is required")
    
    queue_service = QueueService(
        connection_string=service_bus_connection,
        queue_name=service_bus_queue
    )
    await queue_service.connect()
    logger.info("✓ Queue service initialized")
    
    # Initialize Blob service
    blob_connection = os.getenv("BLOB_CONNECTION_STRING")
    
    if not blob_connection:
        raise ValueError("BLOB_CONNECTION_STRING environment variable is required")
    
    blob_service = BlobServiceClient.from_connection_string(blob_connection)
    logger.info("✓ Blob storage service initialized")
    
    # Initialize Azure OpenAI client
    openai_api_key = os.getenv("OPENAI_API_KEY")
    azure_openai_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
    azure_openai_api_version = os.getenv("AZURE_OPENAI_API_VERSION", "2023-05-15")
    openai_embedding_model = os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-large")
    
    if not openai_api_key or not azure_openai_endpoint:
        raise ValueError("OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT are required")
    
    openai_client = AsyncAzureOpenAI(
        api_key=openai_api_key,
        api_version=azure_openai_api_version,
        azure_endpoint=azure_openai_endpoint
    )
    # Store deployment name for embeddings
    openai_client._custom_query = {"deployment_name": openai_embedding_model}
    logger.info("✓ Azure OpenAI client initialized")
    
    # Store services in app state
    app.state.db = db
    app.state.mongo_client = mongo_client
    app.state.dropbox_service = dropbox_service
    app.state.queue_service = queue_service
    app.state.blob_service = blob_service
    app.state.openai_client = openai_client
    
    logger.info("=" * 60)
    logger.info("Dropbox RAG Backend Started Successfully!")
    logger.info("=" * 60)
    
    yield
    
    # Shutdown
    logger.info("Shutting down Dropbox RAG Backend...")
    
    # Close connections
    await queue_service.disconnect()
    await blob_service.close()
    mongo_client.close()
    
    logger.info("✓ Shutdown complete")


# Create FastAPI app
app = FastAPI(
    title="Dropbox RAG API",
    description="API for Dropbox file processing and RAG search",
    version="1.0.0",
    lifespan=lifespan
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(dropbox.router)
app.include_router(rag.router)


@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "message": "Dropbox RAG API",
        "version": "1.0.0",
        "endpoints": {
            "dropbox_sync": "/api/dropbox/sync",
            "dropbox_files": "/api/dropbox/files",
            "rag_search": "/api/rag/search",
            "rag_health": "/api/rag/health",
            "docs": "/docs"
        }
    }


@app.get("/health")
async def health():
    """Health check endpoint"""
    try:
        # Check MongoDB connection
        await app.state.db.command("ping")
        
        return {
            "status": "healthy",
            "services": {
                "mongodb": "connected",
                "dropbox": "initialized",
                "queue": "connected",
                "blob_storage": "connected",
                "openai": "initialized"
            }
        }
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return {
            "status": "unhealthy",
            "error": str(e)
        }


if __name__ == "__main__":
    import uvicorn
    
    port = int(os.getenv("PORT", "8000"))
    host = os.getenv("HOST", "0.0.0.0")
    
    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=True,
        log_level="info"
    )

