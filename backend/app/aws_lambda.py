"""AWS Lambda entry points.

``http_handler`` serves the FastAPI app behind the API Gateway HTTP API.
``websocket_handler`` handles $connect/$disconnect/$default from the API Gateway
WebSocket API. ``fanout_handler`` delivers queued room events independently of
HTTP requests. ``cleanup_handler`` runs weekly and deletes PDFs of closed
rooms. Connection state lives in DynamoDB.
"""

from mangum import Mangum

from app.main import app
from app.modules.forum import cleanup, delivery, gateway

http_handler = Mangum(app, lifespan="off")


def websocket_handler(event, _context):
    return gateway.handle_event(event)


def fanout_handler(event, _context):
    delivery.handle_event(event)


def cleanup_handler(_event, _context):
    return cleanup.delete_closed_pdfs()
