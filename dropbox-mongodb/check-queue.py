#!/usr/bin/env python3
"""Check Service Bus queue status"""

import os
from pathlib import Path
from dotenv import load_dotenv
from azure.servicebus.management import ServiceBusAdministrationClient

# Load environment variables
env_path = Path(__file__).parent / "worker" / ".env"
if env_path.exists():
    load_dotenv(env_path)

SERVICE_BUS_CONNECTION_STRING = os.getenv("SERVICE_BUS_CONNECTION_STRING")
SERVICE_BUS_QUEUE_NAME = os.getenv("SERVICE_BUS_QUEUE_NAME", "dropbox-file-processing")

if not SERVICE_BUS_CONNECTION_STRING:
    print("Error: SERVICE_BUS_CONNECTION_STRING not found")
    exit(1)

admin_client = ServiceBusAdministrationClient.from_connection_string(SERVICE_BUS_CONNECTION_STRING)

try:
    queue_properties = admin_client.get_queue_runtime_properties(SERVICE_BUS_QUEUE_NAME)
    
    print("=" * 60)
    print("SERVICE BUS QUEUE STATUS")
    print("=" * 60)
    print(f"\nQueue Name: {SERVICE_BUS_QUEUE_NAME}")
    print(f"Active Messages: {queue_properties.active_message_count}")
    print(f"Dead Letter Messages: {queue_properties.dead_letter_message_count}")
    print(f"Scheduled Messages: {queue_properties.scheduled_message_count}")
    print(f"Transfer Dead Letter Messages: {queue_properties.transfer_dead_letter_message_count}")
    
    if queue_properties.active_message_count > 0:
        print(f"\n⚠ There are {queue_properties.active_message_count} message(s) waiting in the queue.")
        print("The worker should pick them up automatically.")
    else:
        print("\n✓ No messages in queue (either processed or not sent)")
except Exception as e:
    print(f"Error checking queue: {e}")
finally:
    admin_client.close()

