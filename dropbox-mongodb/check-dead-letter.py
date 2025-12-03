#!/usr/bin/env python3
"""Check dead letter messages in Service Bus queue"""

import os
import json
from pathlib import Path
from dotenv import load_dotenv
from azure.servicebus import ServiceBusClient, ServiceBusReceiveMode

# Load environment variables
env_path = Path(__file__).parent / "worker" / ".env"
if env_path.exists():
    load_dotenv(env_path)

SERVICE_BUS_CONNECTION_STRING = os.getenv("SERVICE_BUS_CONNECTION_STRING")
SERVICE_BUS_QUEUE_NAME = os.getenv("SERVICE_BUS_QUEUE_NAME", "dropbox-file-processing")

if not SERVICE_BUS_CONNECTION_STRING:
    print("Error: SERVICE_BUS_CONNECTION_STRING not found")
    exit(1)

servicebus_client = ServiceBusClient.from_connection_string(SERVICE_BUS_CONNECTION_STRING)

with servicebus_client:
    # Connect to dead letter queue
    dead_letter_queue_name = f"{SERVICE_BUS_QUEUE_NAME}/$deadletterqueue"
    
    try:
        receiver = servicebus_client.get_queue_receiver(
            queue_name=dead_letter_queue_name,
            receive_mode=ServiceBusReceiveMode.PEEK_LOCK,
            max_wait_time=5
        )
        
        with receiver:
            messages = receiver.receive_messages(max_message_count=1, max_wait_time=5)
            
            if messages:
                msg = messages[0]
                print("=" * 60)
                print("DEAD LETTER MESSAGE")
                print("=" * 60)
                
                # Get message body
                body = msg.body
                if isinstance(body, bytes):
                    body = body.decode('utf-8')
                
                try:
                    message_data = json.loads(body)
                    print("\nMessage Body:")
                    print(json.dumps(message_data, indent=2))
                except:
                    print(f"\nMessage Body (raw): {body}")
                
                # Get message properties
                print(f"\nMessage Properties:")
                print(f"  Message ID: {msg.message_id}")
                print(f"  Delivery Count: {msg.delivery_count}")
                print(f"  Enqueued Time: {msg.enqueued_time_utc}")
                print(f"  Dead Letter Reason: {msg.dead_letter_reason}")
                print(f"  Dead Letter Error Description: {msg.dead_letter_error_description}")
                
                # Don't complete/delete - just peek
                receiver.abandon_message(msg)
                
            else:
                print("No dead letter messages found")
                
    except Exception as e:
        print(f"Error accessing dead letter queue: {e}")
        print(f"Tried to access: {dead_letter_queue_name}")

