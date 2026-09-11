# IIC IT & NOC Helpdesk

Initial Django REST Framework and Next.js implementation based on the project specification.

## Local development

1. Create a Python virtual environment at `.venv` and install `backend/requirements.txt`.
2. Run migrations from `backend` with `../.venv/Scripts/python.exe manage.py migrate`.
3. Start Django from `backend` with `../.venv/Scripts/python.exe manage.py runserver 127.0.0.1:8000`.
4. Install frontend packages from `frontend` with `pnpm install`.
5. Start Next.js from `frontend` with `pnpm dev`.
6. Open `http://localhost:3000`.

The frontend reads `NEXT_PUBLIC_API_URL` and defaults to `http://127.0.0.1:8000/api/v1`.

## Implemented foundation

- Public service catalogue and API health endpoint
- Requester-scoped ticket list and creation API using Django sessions
- Initial service and ticket database models with migrations
- Responsive IIC home page, working service search, theme preference, and reduced-motion support
- Request form interface ready for institutional sign-in integration

See `IIC-IT-Helpdesk-Project-Specification.md` for the complete functional and non-functional requirements.
