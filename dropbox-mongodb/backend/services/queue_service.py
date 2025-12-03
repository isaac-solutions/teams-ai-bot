"""
Service for Azure Service Bus queue operations
"""

import logging
import json
from typing import Dict, Any, Optional
from datetime import datetime

from azure.servicebus.aio import ServiceBusClient
from azure.servicebus import ServiceBusMessage

logger = logging.getLogger(__name__)


class QueueService:
    """Service for sending messages to Azure Service Bus"""
    
    def __init__(self, connection_string: str, queue_name: str):
        """
        Initialize queue service
        
        Args:
            connection_string: Azure Service Bus connection string
            queue_name: Name of the queue to send messages to
        """
        self.connection_string = connection_string
        self.queue_name = queue_name
        self.sb_client = None
    
    async def connect(self):
        """Initialize Service Bus client"""
        if not self.sb_client:
            self.sb_client = ServiceBusClient.from_connection_string(
                self.connection_string
            )
            logger.info(f"Connected to Service Bus queue: {self.queue_name}")
    
    async def disconnect(self):
        """Close Service Bus client"""
        if self.sb_client:
            await self.sb_client.close()
            self.sb_client = None
    
    async def send_dropbox_processing_message(
        self,
        file_id: str,
        dropbox_path: str,
        dropbox_file_id: str,
        blob_url: str,
        filename: str,
        file_type: str,
        user_id: str = "system",
        additional_metadata: Optional[Dict[str, Any]] = None
    ) -> bool:
        """
        Send message to dropbox-file-processing queue
        
        Args:
            file_id: MongoDB ObjectId of the file record
            dropbox_path: Full path in Dropbox
            dropbox_file_id: Dropbox unique file ID
            blob_url: Azure Blob Storage URL
            filename: Original filename
            file_type: File extension
            user_id: User who triggered the processing
            additional_metadata: Optional metadata dictionary
            
        Returns:
            True if message sent successfully
        """
        try:
            # Ensure client is connected
            await self.connect()
            
            message_body = {
                "message_type": "dropbox_file",
                "file_id": file_id,
                "dropbox_path": dropbox_path,
                "dropbox_file_id": dropbox_file_id,
                "blob_url": blob_url,
                "filename": filename,
                "file_type": file_type,
                "user_id": user_id,
                "metadata": additional_metadata or {},
                "timestamp": datetime.utcnow().isoformat()
            }
            
            message = ServiceBusMessage(
                body=json.dumps(message_body),
                content_type="application/json"
            )
            
            # Send to queue
            async with self.sb_client.get_queue_sender(
                queue_name=self.queue_name
            ) as sender:
                await sender.send_messages(message)
            
            logger.info(f"Sent processing message for file {file_id}: {filename}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to send processing message: {e}")
            return False
    
    async def send_batch_messages(
        self,
        messages: list[Dict[str, Any]]
    ) -> int:
        """
        Send multiple messages in batch
        
        Args:
            messages: List of message dictionaries
            
        Returns:
            Number of messages sent successfully
        """
        try:
            await self.connect()
            
            sb_messages = []
            for msg_body in messages:
                message = ServiceBusMessage(
                    body=json.dumps(msg_body),
                    content_type="application/json"
                )
                sb_messages.append(message)
            
            async with self.sb_client.get_queue_sender(
                queue_name=self.queue_name
            ) as sender:
                await sender.send_messages(sb_messages)
            
            logger.info(f"Sent batch of {len(sb_messages)} messages")
            return len(sb_messages)
            
        except Exception as e:
            logger.error(f"Failed to send batch messages: {e}")
            return 0

