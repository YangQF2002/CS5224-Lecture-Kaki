"""AWS Lambda entry points.

``http_handler`` serves the FastAPI app behind the API Gateway HTTP API.
``websocket_handler`` handles $connect/$disconnect/$default from the API Gateway
WebSocket API. Neither keeps state between invocations.
"""

from mangum import Mangum

from app.main import app
from app.modules.forum import gateway

http_handler = Mangum(app, lifespan="off")


def websocket_handler(event, _context):
    return gateway.handle_event(event)
