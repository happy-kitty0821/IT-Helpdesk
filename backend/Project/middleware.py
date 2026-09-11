class MediaCoopMiddleware:
    """
    Remove Cross-Origin-Opener-Policy from media file responses.

    Django's SecurityMiddleware adds COOP: same-origin to every response.
    That header prevents Chrome's built-in PDF viewer (which runs in a
    separate cross-origin process) from rendering PDFs inside an iframe.
    Media files are static assets and do not need process isolation, so
    it is safe to drop COOP for those paths only.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if request.path.startswith('/media/'):
            response.headers.pop('Cross-Origin-Opener-Policy', None)
            response.headers['X-Frame-Options'] = 'SAMEORIGIN'
        return response