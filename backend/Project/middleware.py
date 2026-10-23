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


class SecurityHeadersMiddleware:
    """
    Add the security headers that Django's built-in SecurityMiddleware
    does not cover:

        Referrer-Policy
            Controls how much referrer information is included with requests.
            'strict-origin-when-cross-origin' is the modern browser default and
            the safest choice — sends the full URL for same-origin requests,
            only the origin for cross-origin HTTPS, and nothing for HTTP targets.

        Content-Security-Policy
            Restricts which resources the browser may load.  The policy is
            deliberately practical for this application:

            • script-src 'self' accounts.google.com
                — allows the Google Sign-In SDK (loaded from accounts.google.com).
                  'unsafe-inline' is NOT included; the frontend uses no inline scripts.

            • style-src 'self' 'unsafe-inline'
                — React / Next.js uses inline style={{ ... }} props extensively.
                  Removing 'unsafe-inline' here would require migrating hundreds of
                  inline styles to CSS classes, which is out of scope for this MVP.
                  This is a known pragmatic trade-off.

            • img-src 'self' data: blob:
                — data: URIs are used for image previews (announcement banner upload).
                  blob: is used by the chunked upload file preview.

            • connect-src 'self'
                — SSE streams (/api/v1/…/stream/) and API calls go to the same origin.

            • frame-ancestors 'self'
                — Equivalent to X-Frame-Options: SAMEORIGIN.  CSP frame-ancestors
                  takes precedence in modern browsers.

            • form-action 'self'
                — Form submissions may only target the same origin.

            • base-uri 'self'
                — Prevents base tag injection.

            • object-src 'none'
                — Blocks <object>/<embed>/<applet> — no legitimate use in this app.

    The header is NOT applied to /media/ responses — those are file downloads
    and a CSP on them would be redundant and may interfere with PDF rendering.
    """

    # Build the CSP directive string once at class definition time.
    _CSP = "; ".join([
        "default-src 'self'",
        "script-src 'self' https://accounts.google.com",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "connect-src 'self'",
        "frame-src 'self' https://accounts.google.com",
        "frame-ancestors 'self'",
        "form-action 'self'",
        "base-uri 'self'",
        "object-src 'none'",
    ])

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)

        # Skip media file responses — file downloads don't need a CSP and
        # a CSP on PDF responses can interfere with Chrome's built-in viewer.
        if request.path.startswith('/media/'):
            response.headers.setdefault(
                'Referrer-Policy', 'strict-origin-when-cross-origin'
            )
            return response

        response.headers.setdefault(
            'Referrer-Policy', 'strict-origin-when-cross-origin'
        )
        response.headers.setdefault(
            'Content-Security-Policy', self._CSP
        )
        return response
