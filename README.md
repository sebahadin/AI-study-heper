# AI-study-heper — Classmate

Classmate is a personal study app for books, notes, multiple-choice flashcards, and quizzes. Its frontend uses React, TypeScript, and Vite. Express provides JSON APIs, Passport authentication, and MongoDB access through Mongoose.

## Repository structure

```text
frontend/          React pages, components, styles, and tests
backend/src/       Express app, Passport configuration, models, and API routes
backend/test/      Unit tests and HTTP integration tests
ai-service/        Internal Python API, local embeddings, indexing worker and shared Chroma client
documentation/     Existing screenshots and app diagrams
```

## Local development

Use Node.js 22.12+ or 24 and a local MongoDB instance or MongoDB Atlas database. PDF uploads also require Python 3.12+ and `uv`.

1. Install each application's dependencies:

   ```sh
   npm ci --prefix backend
   npm ci --prefix frontend
   ```

2. Create `backend/.env` from `backend/.env.example`. Set `DSN` to your MongoDB connection string and `SESSION_SECRET` to a long random value. Existing MongoDB collections, document IDs, usernames, and password hashes remain compatible.

3. Configure the shared `AI_SERVICE_TOKEN` and `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` in the ignored repository-root `.env`. Keep the R2 bucket private and allow the React development origin in its upload CORS policy. Install Python dependencies:

   ```sh
   uv sync --directory ai-service --locked
   ```

4. Start the complete local stack from the repository root:

   ```sh
   node scripts/dev.mjs
   ```

   This starts Express, React, the internal Python API, a private Chroma server, and the indexing worker. Start MongoDB separately. Stop any previous copies of these services first; the launcher checks its ports and stops all of its children together on Ctrl+C. The first worker run downloads the pinned local embedding model; later runs use its ignored cache. Restart the stack after changing Python code or indexing settings.

Open `http://127.0.0.1:5173`. Vite uses port 5173 and reports an error if it is occupied instead of silently switching to another port. If another copy of this frontend is already running, use that copy or stop it before starting a new one. R2 browser uploads require the exact frontend origin in the bucket's CORS policy; changing the port also requires updating that policy. Vite proxies `/api` to Express on port 3000. To change the proxy target, copy `frontend/.env.example` to `frontend/.env` and set `API_PROXY_TARGET`. Keep database credentials and session secrets only in the backend environment.

If the Express port changes, update the Vite proxy target too. Set `CLIENT_ORIGIN` to the browser-facing frontend origin. Separate production origins would also require an explicit cookie/CORS configuration; the default setup serves the UI and API from one origin.

PDFs and saved notes are indexed automatically. Open a material to see **Queued**, **Processing**, **Ready**, or an actionable failure with **Retry indexing**. Editing note text queues a new version. Removing a material immediately revokes access; the worker cleans up retrieval data and expired upload objects in the background. PDFs without extractable text remain readable, but need OCR support before they can be searched. The five-page policy is `MAX_PDF_PAGES` in `ai-service/app/core/constants.py`.

Background verification requeues materials if their published Chroma passages are missing or corrupt. The worker uses local Hugging Face embeddings, with no LLM calls or remote embedding charges. MongoDB stores authoritative job state and canonical passages. Chroma and the worker outbox live in ignored `ai-service/.cache/`. In production, run the Chroma server and worker as supervised processes with persistent private storage. Keep Chroma off the public internet and restrict Express's `/internal/` endpoints to your services.

## Production build

```sh
npm run build --prefix frontend
NODE_ENV=production npm start --prefix backend
```

Express serves `frontend/dist` and supports direct navigation and refresh on React routes. Deploy behind HTTPS with `SESSION_SECRET` set. Production cookies are secure, HttpOnly, and SameSite=Lax; Passport sessions are stored in MongoDB. The app trusts one reverse proxy for HTTPS detection, so configure this for your hosting topology.

## Features

- Register with username, email, and password; log in with username; restore the session after refresh; log out.
- Create, edit, and remove courses with a name, code, term, instructor, description, and color. Each course has an overview and separate Books, Notes, and Flashcards views.
- Assign materials to multiple courses from their editors or manage existing materials inside a course. Notes and flashcards linked to a book also appear in that book’s courses. Removing a course detaches its assignments and preserves all materials.
- Create, read, edit, and remove books, including category, description, and optional URL.
- Write standalone notes or link them to a book. Format text with fonts, sizes, headings, emphasis, colors, highlights, alignment, lists, quotes, and links. Switch between Edit and Read preview without losing your current draft, then click Save note (or ⌘/Ctrl+S). Saved notes open in reading mode and can be reopened for editing.
- Create and edit flashcards with two to four answer options, one correct answer, and related book tags and/or courses.
- Filter collections by course, including materials with no course. Start a quiz from a course or any selected books, answer questions, review mistakes, end early, and retry.
- View books, notes, and flashcard counts on the dashboard.
- Confirm deletions. Deleting a book unlinks its notes and removes its flashcard tags while preserving both. Cards with no remaining books stay available for editing or removal.

Quiz scores stay in browser memory and are not persisted. The existing favorite flag is preserved in MongoDB, without adding a new favorite control. AI chat, generation, and coaching are planned.

## API

All endpoints return JSON, except successful logout and deletions, which return HTTP 204. Authentication uses an HttpOnly session cookie. Request bodies use JSON; API clients must send the cookie on authenticated requests.

| Endpoint | Methods | Purpose |
| --- | --- | --- |
| `/api/auth/register` | POST | Register; return a message prompting login |
| `/api/auth/login` | POST | Log in and return public user fields |
| `/api/auth/me` | GET | Return the current user, or HTTP 401 |
| `/api/auth/logout` | POST | Destroy the session |
| `/api/dashboard` | GET | Books, notes, and flashcard count |
| `/api/courses` and `/api/courses/:id` | GET, POST / GET, PATCH, DELETE | Course management; details include associated and inherited materials |
| `/api/courses/:id/materials` | PATCH | Replace direct assignments of one material kind within this course |
| `/api/books` and `/api/books/:id` | GET, POST / GET, PATCH, DELETE | Book management |
| `/api/notes` and `/api/notes/:id` | GET, POST / GET, PATCH, DELETE | Note management |
| `/api/flashcards` and `/api/flashcards/:id` | GET, POST / GET, PATCH, DELETE | Flashcard management |
| `/api/study/search` | POST | Retrieve authorized passages with citations and source links |

Materials accept an optional `courses` array of owned course IDs; an omitted array preserves membership on PATCH. Filter books, notes, or flashcards with `?course=courseId`, or `?course=none` for materials with no direct or inherited course. Course material assignments accept `{ "kind": "books" | "notes" | "flashcards", "ids": [...] }`; all IDs must belong to the signed-in user. This changes only the selected course’s direct assignments.

Filter flashcards with `/api/flashcards?tags=bookId1,bookId2`. Flashcard writes accept `question`, `options`, `correctIndex` (zero-based), and `tags` (book IDs). Optional empty options are removed while preserving the selected correct answer.

Note writes accept `title`, optional `book` (an owned book ID or `null`), and either plain `content` or rich `contentHtml`. Rich HTML is sanitized on the server; `content` is derived from it for previews and search. Plain-text updates clear previous rich formatting; title/book-only updates preserve it. Legacy notes need no migration. Notes include `updatedAt` after an edit.

Study search accepts `{ "query": "What supplies energy to cells?", "scope": { "courses": ["courseId"] }, "limit": 6 }`. A scope can select `documents`, `notes`, `books`, and `courses`; their selections are combined. Book/course scopes include their currently linked notes and PDFs. Use `{ "library": true }` explicitly for the whole library. An empty scope returns no passages. Only your current, ready source versions are searched; select a narrower scope if more than 100 indexed sources match.

Search returns `{ "query", "passages", "sources" }`, including PDF page or note paragraph citations and links to the original material. Results contain at most 12 passages and 12,000 characters. This endpoint retrieves evidence; chat answers and the chat interface are the next stage. The internal read tools are `search_materials` and `fetch_passages`; the application supplies their identity and scope.

Errors have `{ "error": "message", "fields": { "field": "message" } }`; `fields` is optional. Protected endpoints return HTTP 401; missing or inaccessible records return 404; invalid input returns 400; duplicate registration returns 409. Every record operation and book association is scoped to the authenticated user. Cross-site writes are rejected.

## Checks

```sh
npm run lint --prefix backend
npm test --prefix backend
npm run lint --prefix frontend
npm test --prefix frontend
npm run build --prefix frontend
```

The default backend test run covers validation, cleanup, and HTTP boundaries. To also run real MongoDB/Passport integration tests, use a **disposable database whose name ends in `_test`**:

```sh
TEST_DSN=mongodb://127.0.0.1:27017/classmate_test npm test --prefix backend
```

Those integration tests create users and study records, then drop that test database. They are skipped when `TEST_DSN` is not supplied. Frontend tests cover protected navigation, session restore/logout, registration feedback, quiz scoring, retries, and escaped text rendering.
