#!/usr/bin/env python3
"""
Dropbox File Processing Worker

This worker processes files from Dropbox via Azure Service Bus queue,
converts documents to markdown using docling, generates embeddings,
and stores chunks in MongoDB for RAG retrieval.
"""
from __future__ import annotations

import os
import sys
import json
import asyncio
import logging
import hashlib
import tempfile
import traceback
from typing import Optional, Dict, Any, List
from datetime import datetime
from pathlib import Path

# Print startup message immediately (before any imports that might fail)
print("Python worker starting...", flush=True)
sys.stdout.flush()

# Third-party imports
try:
    print("Importing dependencies...", flush=True)
    import httpx
    from azure.servicebus.aio import ServiceBusClient
    from azure.servicebus import ServiceBusReceivedMessage, ServiceBusReceiveMode
    from azure.servicebus.exceptions import ServiceBusError
    from azure.storage.blob.aio import BlobServiceClient
    from motor.motor_asyncio import AsyncIOMotorClient
    from pymongo import errors as mongo_errors
    from bson import ObjectId
    from openai import AsyncAzureOpenAI
    import tiktoken
    from langchain_text_splitters import RecursiveCharacterTextSplitter
    print("✓ Dependencies imported successfully", flush=True)
except ImportError as e:
    print(f"FATAL: Failed to import required dependency: {e}", file=sys.stderr, flush=True)
    sys.exit(1)
except Exception as e:
    print(f"FATAL: Error during imports: {e}", file=sys.stderr, flush=True)
    import traceback
    traceback.print_exc(file=sys.stderr)
    sys.exit(1)

# Docling imports
try:
    from docling.document_converter import DocumentConverter
    DOCLING_AVAILABLE = True
except ImportError:
    DOCLING_AVAILABLE = False

# Set up logging to stdout for container
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)


class WorkerConfig:
    """Configuration settings for the Dropbox worker"""
    
    def __init__(self):
        # MongoDB Configuration
        self.mongodb_uri = os.getenv("MONGODB_URI", "")
        self.mongodb_database = os.getenv("MONGODB_DATABASE", "isaac-dropbox")
        
        # Azure Service Bus
        self.service_bus_connection_string = os.getenv("SERVICE_BUS_CONNECTION_STRING", "")
        self.service_bus_queue_name = os.getenv("SERVICE_BUS_QUEUE_NAME", "dropbox-file-processing")
        
        # Azure Blob Storage
        self.blob_connection_string = os.getenv("BLOB_CONNECTION_STRING", "")
        self.blob_container_name = os.getenv("BLOB_CONTAINER_NAME", "dropbox")
        
        # Worker Settings
        self.max_receive_count = int(os.getenv("MAX_RECEIVE_COUNT", "3"))
        self.max_wait_time = int(os.getenv("MAX_WAIT_TIME", "60"))
        self.temp_dir = os.getenv("TEMP_DIR", "/tmp/dropbox-worker")
        self.max_retries = int(os.getenv("MAX_RETRIES", "3"))
        self.retry_delay_base = float(os.getenv("RETRY_DELAY_BASE", "2.0"))
        
        # Azure OpenAI Configuration
        self.openai_api_key = os.getenv("OPENAI_API_KEY", "")
        self.openai_embedding_model = os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-large")
        self.azure_openai_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT", "")
        self.azure_openai_api_version = os.getenv("AZURE_OPENAI_API_VERSION", "2023-05-15")
        
        # Chunking Configuration
        self.chunk_size = int(os.getenv("CHUNK_SIZE", "512"))
        self.chunk_overlap = int(os.getenv("CHUNK_OVERLAP", "50"))
        
        # Logging
        log_level = os.getenv("LOG_LEVEL", "INFO").upper()
        logging.getLogger().setLevel(getattr(logging, log_level, logging.INFO))
        
        # Validate required settings
        if not self.mongodb_uri:
            raise ValueError("MONGODB_URI environment variable is required")
        if not self.service_bus_connection_string:
            raise ValueError("SERVICE_BUS_CONNECTION_STRING environment variable is required")
        if not self.blob_connection_string:
            raise ValueError("BLOB_CONNECTION_STRING environment variable is required")
        if not self.openai_api_key:
            raise ValueError("OPENAI_API_KEY environment variable is required")
        if not self.azure_openai_endpoint:
            raise ValueError("AZURE_OPENAI_ENDPOINT environment variable is required")
        
        # Ensure temp directory exists
        os.makedirs(self.temp_dir, exist_ok=True)


class DoclingProcessor:
    """Process documents with docling for RAG"""
    
    def __init__(self, config: WorkerConfig):
        self.config = config
        self.converter = None
        
        if DOCLING_AVAILABLE:
            try:
                self.converter = DocumentConverter()
                logger.info("Docling converter initialized successfully")
            except Exception as e:
                logger.error(f"Failed to initialize docling converter: {e}")
                self.converter = None
        else:
            logger.error("Docling not available. Install with: pip install docling")
        
        # Initialize Azure OpenAI client
        self.openai_client = None
        if config.openai_api_key and config.azure_openai_endpoint:
            try:
                self.openai_client = AsyncAzureOpenAI(
                    api_key=config.openai_api_key,
                    api_version=config.azure_openai_api_version,
                    azure_endpoint=config.azure_openai_endpoint
                )
                logger.info(f"Azure OpenAI client initialized (endpoint: {config.azure_openai_endpoint})")
            except Exception as e:
                logger.error(f"Failed to initialize Azure OpenAI client: {e}")
        
        # Initialize tokenizer for chunking
        try:
            self.encoding = tiktoken.get_encoding("cl100k_base")
        except Exception as e:
            logger.warning(f"Failed to load tiktoken encoding: {e}")
            self.encoding = None
    
    def convert_to_markdown(self, file_path: str, file_type: str) -> Optional[str]:
        """
        Convert document to markdown using docling
        
        Args:
            file_path: Path to the document file
            file_type: Type of file (pdf, docx, pptx, etc.)
            
        Returns:
            Markdown string or None if conversion fails
        """
        if not self.converter:
            logger.error("Docling converter not available")
            return None
        
        try:
            logger.info(f"Converting {file_type} file to markdown: {file_path}")
            start_time = datetime.now()
            
            # Convert document
            result = self.converter.convert(file_path)
            
            # Export to markdown
            markdown_content = result.document.export_to_markdown()
            
            conversion_time = (datetime.now() - start_time).total_seconds()
            logger.info(f"Document converted to markdown successfully in {conversion_time:.2f}s")
            logger.info(f"Markdown length: {len(markdown_content)} characters")
            
            return markdown_content
            
        except Exception as e:
            logger.error(f"Failed to convert document to markdown: {e}")
            logger.error(traceback.format_exc())
            return None
    
    def count_tokens(self, text: str) -> int:
        """Count tokens in text"""
        if self.encoding:
            try:
                return len(self.encoding.encode(text))
            except Exception:
                pass
        # Fallback: rough estimate
        return len(text) // 4
    
    def chunk_markdown(self, markdown_content: str) -> List[Dict[str, Any]]:
        """
        Chunk markdown content intelligently
        
        Args:
            markdown_content: Full markdown text
            
        Returns:
            List of chunk dictionaries with content and metadata
        """
        try:
            # Use langchain's RecursiveCharacterTextSplitter for smart chunking
            text_splitter = RecursiveCharacterTextSplitter(
                chunk_size=self.config.chunk_size * 4,  # Approximate chars from tokens
                chunk_overlap=self.config.chunk_overlap * 4,
                length_function=lambda x: self.count_tokens(x),
                separators=[
                    "\n\n## ",  # Major sections
                    "\n\n### ",  # Subsections
                    "\n\n",  # Paragraphs
                    "\n",  # Lines
                    ". ",  # Sentences
                    " ",  # Words
                    ""  # Characters
                ]
            )
            
            # Split the markdown
            chunks_text = text_splitter.split_text(markdown_content)
            
            # Create chunk objects with metadata
            chunks = []
            for idx, chunk_text in enumerate(chunks_text):
                chunk_text = chunk_text.strip()
                if not chunk_text:
                    continue
                
                # Determine chunk type
                chunk_type = "text"
                if "|" in chunk_text and "---" in chunk_text:
                    chunk_type = "table"
                elif chunk_text.startswith("- ") or chunk_text.startswith("* "):
                    chunk_type = "list"
                elif chunk_text.startswith("#"):
                    chunk_type = "heading"
                
                token_count = self.count_tokens(chunk_text)
                
                chunk = {
                    "chunk_index": idx,
                    "content": chunk_text,
                    "metadata": {
                        "chunk_type": chunk_type,
                        "char_count": len(chunk_text),
                        "token_count": token_count
                    }
                }
                chunks.append(chunk)
            
            logger.info(f"Created {len(chunks)} chunks from markdown content")
            return chunks
            
        except Exception as e:
            logger.error(f"Failed to chunk markdown: {e}")
            logger.error(traceback.format_exc())
            return []
    
    async def generate_embeddings(self, chunks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Generate Azure OpenAI embeddings for chunks
        
        Args:
            chunks: List of chunk dictionaries
            
        Returns:
            List of chunks with embeddings added
        """
        if not self.openai_client:
            logger.error("OpenAI client not available")
            return chunks
        
        try:
            # Extract texts for embedding
            texts = [chunk["content"] for chunk in chunks]
            
            if not texts:
                return chunks
            
            logger.info(f"Generating embeddings for {len(texts)} chunks...")
            
            # Generate embeddings in batch
            response = await self.openai_client.embeddings.create(
                model=self.config.openai_embedding_model,
                input=texts
            )
            
            # Add embeddings to chunks
            for idx, embedding_data in enumerate(response.data):
                if idx < len(chunks):
                    chunks[idx]["embedding"] = embedding_data.embedding
            
            logger.info(f"Successfully generated {len(response.data)} embeddings")
            return chunks
            
        except Exception as e:
            logger.error(f"Failed to generate embeddings: {e}")
            logger.error(traceback.format_exc())
            return chunks


class DropboxFileWorker:
    """Main worker class for processing Dropbox files"""
    
    def __init__(self, config: WorkerConfig):
        self.config = config
        self.mongo_client = None
        self.database = None
        self.service_bus_client = None
        self.blob_service_client = None
        self.docling_processor = DoclingProcessor(config)
        self.running = False
    
    async def connect_mongodb(self):
        """Initialize MongoDB connection"""
        try:
            logger.info(f"Connecting to MongoDB: {self.config.mongodb_database}")
            logger.info(f"MongoDB URI: {self.config.mongodb_uri[:50]}...")  # Log partial URI for debugging
            self.mongo_client = AsyncIOMotorClient(self.config.mongodb_uri)
            self.database = self.mongo_client[self.config.mongodb_database]
            
            # Test connection
            logger.info("Testing MongoDB connection...")
            await self.mongo_client.admin.command('ping')
            logger.info(f"✓ Connected to MongoDB: {self.config.mongodb_database}")
            
        except Exception as e:
            logger.error(f"✗ Failed to connect to MongoDB: {e}")
            logger.error(traceback.format_exc())
            raise
    
    async def connect_service_bus(self):
        """Initialize Service Bus connection"""
        try:
            logger.info(f"Connecting to Azure Service Bus queue: {self.config.service_bus_queue_name}")
            self.service_bus_client = ServiceBusClient.from_connection_string(
                self.config.service_bus_connection_string
            )
            logger.info("✓ Connected to Azure Service Bus")
            
        except Exception as e:
            logger.error(f"✗ Failed to connect to Service Bus: {e}")
            logger.error(traceback.format_exc())
            raise
    
    async def connect_blob_storage(self):
        """Initialize Blob Storage connection"""
        try:
            logger.info(f"Connecting to Azure Blob Storage container: {self.config.blob_container_name}")
            self.blob_service_client = BlobServiceClient.from_connection_string(
                self.config.blob_connection_string
            )
            logger.info("✓ Connected to Azure Blob Storage")
            
        except Exception as e:
            logger.error(f"✗ Failed to connect to Blob Storage: {e}")
            logger.error(traceback.format_exc())
            raise
    
    async def download_file_with_retry(self, blob_url: str, local_path: str) -> bool:
        """Download file from Azure Blob Storage with retry logic"""
        last_error = None
        
        for attempt in range(self.config.max_retries):
            try:
                return await self._download_file(blob_url, local_path)
                
            except Exception as e:
                last_error = e
                if attempt < self.config.max_retries - 1:
                    delay = self.config.retry_delay_base ** attempt
                    logger.warning(
                        f"Download attempt {attempt + 1} failed, retrying in {delay}s: {e}"
                    )
                    await asyncio.sleep(delay)
                else:
                    logger.error(f"Download failed after {self.config.max_retries} attempts: {e}")
        
        return False
    
    async def _download_file(self, blob_url: str, local_path: str) -> bool:
        """Download file from blob URL"""
        try:
            if self.blob_service_client and "blob.core.windows.net" in blob_url:
                return await self._download_from_blob_storage(blob_url, local_path)
            else:
                return await self._download_from_url(blob_url, local_path)
                
        except Exception as e:
            logger.error(f"Failed to download file from {blob_url}: {e}")
            raise
    
    async def _download_from_blob_storage(self, blob_url: str, local_path: str) -> bool:
        """Download file from Azure Blob Storage using SDK"""
        try:
            # Parse blob URL to extract container and blob name
            url_parts = blob_url.split("/")
            container_name = self.config.blob_container_name
            
            # Find container in URL and get blob name
            try:
                container_index = url_parts.index(container_name)
                blob_name = "/".join(url_parts[container_index + 1:]).split("?")[0]  # Remove SAS token
            except ValueError:
                # Fallback: assume blob name is after domain
                blob_name = "/".join(url_parts[4:]).split("?")[0]
            
            blob_client = self.blob_service_client.get_blob_client(
                container=container_name,
                blob=blob_name
            )
            
            with open(local_path, "wb") as download_file:
                download_stream = await blob_client.download_blob()
                async for chunk in download_stream.chunks():
                    download_file.write(chunk)
            
            logger.info(f"Downloaded blob {blob_name} to {local_path}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to download from blob storage: {e}")
            raise
    
    async def _download_from_url(self, url: str, local_path: str) -> bool:
        """Download file from HTTP URL as fallback"""
        try:
            async with httpx.AsyncClient(timeout=300.0) as client:
                async with client.stream("GET", url) as response:
                    response.raise_for_status()
                    
                    with open(local_path, "wb") as f:
                        async for chunk in response.aiter_bytes():
                            f.write(chunk)
            
            logger.info(f"Downloaded file from URL to {local_path}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to download from URL: {e}")
            raise
    
    async def upload_markdown_to_blob(self, file_id: str, markdown_content: str) -> Optional[str]:
        """Upload markdown to blob storage and return URL with SAS token"""
        try:
            from azure.storage.blob import ContentSettings
            
            # Blob name should NOT include container name - it's already specified in get_blob_client
            markdown_blob_name = f"markdown/{file_id}.md"
            blob_client = self.blob_service_client.get_blob_client(
                container=self.config.blob_container_name,
                blob=markdown_blob_name
            )
            
            # Run synchronous blob upload in thread pool
            await asyncio.to_thread(
                blob_client.upload_blob,
                markdown_content.encode('utf-8'),
                overwrite=True,
                content_settings=ContentSettings(content_type="text/markdown")
            )
            
            # Generate SAS token for read access
            from azure.storage.blob import generate_blob_sas, BlobSasPermissions
            from datetime import timedelta
            
            try:
                connection_parts = dict(
                    item.split('=', 1) 
                    for item in self.config.blob_connection_string.split(';') 
                    if '=' in item
                )
                account_name = connection_parts.get('AccountName')
                account_key = connection_parts.get('AccountKey')
                
                if account_name and account_key:
                    sas_token = generate_blob_sas(
                        account_name=account_name,
                        container_name=self.config.blob_container_name,
                        blob_name=markdown_blob_name,
                        account_key=account_key,
                        permission=BlobSasPermissions(read=True),
                        expiry=datetime.utcnow() + timedelta(days=365)
                    )
                    markdown_url = f"https://{account_name}.blob.core.windows.net/{self.config.blob_container_name}/{markdown_blob_name}?{sas_token}"
                else:
                    markdown_url = blob_client.url
            except Exception:
                markdown_url = blob_client.url
            
            logger.info(f"Uploaded markdown to blob storage: {markdown_url[:100]}...")
            return markdown_url
            
        except Exception as e:
            logger.error(f"Failed to upload markdown to blob storage: {e}")
            return None
    
    async def process_dropbox_file(self, message: ServiceBusReceivedMessage) -> bool:
        """
        Process a Dropbox file from queue message
        
        Message format:
        {
            "message_type": "dropbox_file",
            "file_id": "...",
            "dropbox_path": "/path/to/file.pdf",
            "dropbox_file_id": "id:...",
            "blob_url": "https://...",
            "filename": "file.pdf",
            "file_type": "pdf",
            "user_id": "...",
            "metadata": {...}
        }
        """
        try:
            # Parse message body (ServiceBusReceivedMessage has body property)
            try:
                # Get message body - handle both bytes and string
                message_body = message.body
                
                # Handle different body types
                if isinstance(message_body, bytes):
                    message_body = message_body.decode('utf-8')
                elif isinstance(message_body, str):
                    pass  # Already a string
                elif hasattr(message_body, '__iter__') and not isinstance(message_body, (str, bytes)):
                    # Handle generator/iterator (some SDK versions)
                    message_body = b''.join(message_body).decode('utf-8')
                else:
                    # Fallback: convert to string
                    message_body = str(message_body)
                
                # Parse JSON
                message_data = json.loads(message_body)
                logger.info(f"Parsed message: file_id={message_data.get('file_id')}, filename={message_data.get('filename')}")
                
            except (json.JSONDecodeError, AttributeError, TypeError, UnicodeDecodeError) as e:
                logger.error(f"Failed to parse message body: {e}")
                logger.error(f"Message type: {type(message)}, Body type: {type(message_body) if 'message_body' in locals() else 'unknown'}")
                logger.error(f"Message body preview: {str(message_body)[:200] if 'message_body' in locals() else 'N/A'}")
                return False
            
            file_id = message_data.get("file_id")
            blob_url = message_data.get("blob_url")
            filename = message_data.get("filename")
            file_type = message_data.get("file_type")
            dropbox_path = message_data.get("dropbox_path", "")
            
            if not all([file_id, blob_url, filename, file_type]):
                logger.error(f"Invalid message data: {message_data}")
                return False
            
            logger.info(f"Processing Dropbox file {file_id}: {filename}")
            
            # Update status to processing
            try:
                update_result = await self.database.dropbox_files.update_one(
                    {"_id": ObjectId(file_id)},
                    {
                        "$set": {
                            "processing_status": "processing",
                            "updated_at": datetime.utcnow()
                        }
                    }
                )
                if update_result.matched_count == 0:
                    logger.error(f"File record not found in MongoDB: {file_id}")
                    return False
                logger.info(f"Updated file status to 'processing'")
            except Exception as e:
                logger.error(f"Failed to update file status in MongoDB: {e}")
                logger.error(traceback.format_exc())
                return False
            
            # Create temporary file
            with tempfile.NamedTemporaryFile(suffix=f".{file_type}", delete=False) as temp_file:
                temp_path = temp_file.name
            
            try:
                # Download file with retry logic
                if not await self.download_file_with_retry(blob_url, temp_path):
                    raise Exception("Failed to download file after retries")
                
                # Convert to markdown
                markdown_content = self.docling_processor.convert_to_markdown(temp_path, file_type)
                if not markdown_content:
                    raise Exception("Failed to convert to markdown")
                
                # Upload markdown to blob storage
                markdown_blob_url = await self.upload_markdown_to_blob(file_id, markdown_content)
                if not markdown_blob_url:
                    raise Exception("Failed to upload markdown to blob storage")
                
                # Chunk the markdown
                chunks = self.docling_processor.chunk_markdown(markdown_content)
                if not chunks:
                    logger.warning(f"No chunks generated for file {file_id}")
                    await self.database.dropbox_files.update_one(
                        {"_id": ObjectId(file_id)},
                        {
                            "$set": {
                                "processing_status": "completed",
                                "markdown_blob_url": markdown_blob_url,
                                "chunk_count": 0,
                                "updated_at": datetime.utcnow()
                            }
                        }
                    )
                    return True
                
                # Generate embeddings
                chunks_with_embeddings = await self.docling_processor.generate_embeddings(chunks)
                
                # Prepare document chunks for insertion
                document_chunks = []
                for chunk in chunks_with_embeddings:
                    if "embedding" not in chunk:
                        logger.warning(f"Chunk {chunk['chunk_index']} missing embedding, skipping")
                        continue
                    
                    doc_chunk = {
                        "file_id": ObjectId(file_id),
                        "chunk_index": chunk["chunk_index"],
                        "content": chunk["content"],
                        "embedding": chunk["embedding"],
                        "metadata": chunk.get("metadata", {}),
                        "created_at": datetime.utcnow()
                    }
                    document_chunks.append(doc_chunk)
                
                # Insert chunks into MongoDB
                if document_chunks:
                    await self.database.dropbox_chunks.insert_many(document_chunks)
                    logger.info(f"Inserted {len(document_chunks)} document chunks for file {file_id}")
                
                # Update file record with completion status
                await self.database.dropbox_files.update_one(
                    {"_id": ObjectId(file_id)},
                    {
                        "$set": {
                            "processing_status": "completed",
                            "markdown_blob_url": markdown_blob_url,
                            "chunk_count": len(document_chunks),
                            "updated_at": datetime.utcnow()
                        }
                    }
                )
                
                logger.info(f"Successfully processed Dropbox file {file_id}")
                return True
                
            finally:
                # Clean up temporary file
                try:
                    os.unlink(temp_path)
                except Exception:
                    pass
            
        except Exception as e:
            logger.error(f"Failed to process Dropbox file: {e}")
            logger.error(traceback.format_exc())
            
            # Update status to failed
            try:
                if 'file_id' in locals():
                    await self.database.dropbox_files.update_one(
                        {"_id": ObjectId(file_id)},
                        {
                            "$set": {
                                "processing_status": "failed",
                                "processing_metadata.last_error": str(e),
                                "updated_at": datetime.utcnow()
                            }
                        }
                    )
            except Exception:
                pass
            
            return False
    
    async def run(self):
        """Main worker loop"""
        logger.info("Starting Dropbox File Processing Worker")
        
        try:
            # Connect to services
            await self.connect_mongodb()
            await self.connect_service_bus()
            await self.connect_blob_storage()
            
            self.running = True
            
            # Start message processing loop
            async with self.service_bus_client.get_queue_receiver(
                queue_name=self.config.service_bus_queue_name,
                max_wait_time=self.config.max_wait_time,
                receive_mode=ServiceBusReceiveMode.PEEK_LOCK
            ) as receiver:
                
                logger.info(f"Listening for messages on queue: {self.config.service_bus_queue_name}")
                
                while self.running:
                    try:
                        # Receive messages
                        received_msgs = await receiver.receive_messages(
                            max_message_count=1,
                            max_wait_time=10
                        )
                        
                        for msg in received_msgs:
                            try:
                                success = await self.process_dropbox_file(msg)
                                
                                if success:
                                    await receiver.complete_message(msg)
                                    logger.info("Message processed successfully and completed")
                                else:
                                    # Check delivery count for dead-lettering
                                    delivery_count = getattr(msg, 'delivery_count', 1)
                                    if delivery_count >= self.config.max_receive_count:
                                        await receiver.dead_letter_message(
                                            msg,
                                            reason="MaxDeliveryCountExceeded",
                                            error_description=f"Message failed processing after {delivery_count} attempts"
                                        )
                                        logger.error(f"Message dead-lettered after {delivery_count} delivery attempts")
                                    else:
                                        await receiver.abandon_message(msg)
                                        logger.warning(f"Message processing failed, abandoned (attempt {delivery_count}/{self.config.max_receive_count})")
                                        
                            except ServiceBusError as e:
                                logger.error(f"Service Bus error processing message: {e}")
                                await asyncio.sleep(1)
                            except Exception as e:
                                logger.error(f"Unexpected error processing message: {e}")
                                try:
                                    await receiver.abandon_message(msg)
                                except Exception:
                                    logger.error("Failed to abandon message after error")
                    
                    except Exception as e:
                        logger.error(f"Error in message processing loop: {e}")
                        await asyncio.sleep(5)
        
        except Exception as e:
            logger.error(f"Fatal error in worker: {e}")
            raise
        
        finally:
            await self.cleanup()
    
    async def cleanup(self):
        """Clean up connections"""
        logger.info("Cleaning up worker connections")
        
        if self.service_bus_client:
            await self.service_bus_client.close()
        
        if self.blob_service_client:
            await self.blob_service_client.close()
        
        if self.mongo_client:
            self.mongo_client.close()
    
    def stop(self):
        """Stop the worker gracefully"""
        logger.info("Stopping worker...")
        self.running = False


async def main():
    """Main entry point"""
    try:
        logger.info("="*60)
        logger.info("Starting Dropbox File Processing Worker")
        logger.info("="*60)
        
        # Load configuration
        logger.info("Loading configuration...")
        config = WorkerConfig()
        logger.info("✓ Configuration loaded successfully")
        
        # Create worker
        logger.info("Initializing worker...")
        worker = DropboxFileWorker(config)
        logger.info("✓ Worker initialized")
        
        # Run worker
        logger.info("Starting worker...")
        await worker.run()
        
    except KeyboardInterrupt:
        logger.info("Received keyboard interrupt, shutting down...")
    except ValueError as e:
        logger.error(f"Configuration error: {e}")
        logger.error("Please check your environment variables")
        sys.exit(1)
    except Exception as e:
        logger.error(f"Worker failed: {e}")
        logger.error(traceback.format_exc())
        sys.exit(1)


if __name__ == "__main__":
    try:
        # Ensure stdout/stderr are unbuffered for container logs
        try:
            sys.stdout.reconfigure(line_buffering=True)
            sys.stderr.reconfigure(line_buffering=True)
        except (AttributeError, ValueError):
            # Fallback if reconfigure not available
            pass
        
        # Run main
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Received keyboard interrupt", flush=True)
        sys.exit(0)
    except Exception as e:
        print(f"FATAL ERROR: {e}", file=sys.stderr, flush=True)
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)

