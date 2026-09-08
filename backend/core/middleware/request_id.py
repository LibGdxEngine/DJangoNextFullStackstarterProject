import uuid

class RequestIdMiddleware:
    """
    Middleware that ensures every incoming request has an X-Request-ID.
    If the client provided one, it will be reused; otherwise, a new UUID4 is generated.
    The ID is attached to the request object and set in the response headers.
    """
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        request.request_id = request_id

        response = self.get_response(request)
        response["X-Request-ID"] = request_id
        return response
