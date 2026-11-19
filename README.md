# AI-study-heper — Classmate

Classmate is a personal study app for books, notes, multiple-choice flashcards, and quizzes. Its frontend uses React, TypeScript, and Vite. Express provides JSON APIs, Passport authentication, and MongoDB access through Mongoose.

## Repository structure

```text
frontend/          React pages, components, styles, and tests
backend/src/       Express app, Passport configuration, models, and API routes
backend/test/      Unit tests and HTTP integration tests
documentation/     Existing screenshots and app diagrams
```

## Local development

Use Node.js 22.12+ or 24 and a local MongoDB instance or MongoDB Atlas database.

1. Install each application's dependencies:

   ```sh
   npm ci --prefix backend
   npm ci --prefix frontend
   ```

2. Create `backend/.env` from `backend/.env.example`. Set `DSN` to your MongoDB connection string and `SESSION_SECRET` to a long random value. Existing MongoDB collections, document IDs, usernames, and password hashes remain compatible.

3. Start the API:

   ```sh
   npm run dev --prefix backend
   ```

4. In another terminal, start React:

   ```sh
   npm run dev --prefix frontend
   ```

Open the URL printed by Vite (normally `http://127.0.0.1:5173`). Vite proxies `/api` to Express on port 3000. To change the proxy target, copy `frontend/.env.example` to `frontend/.env` and set `API_PROXY_TARGET`. Keep database credentials and session secrets only in the backend environment.

If the Express port changes, update the Vite proxy target too. Set `CLIENT_ORIGIN` to the browser-facing frontend origin. Separate production origins would also require an explicit cookie/CORS configuration; the default setup serves the UI and API from one origin.

## Production build

```sh
npm run build --prefix frontend
NODE_ENV=production npm start --prefix backend
```

Express serves `frontend/dist` and supports direct navigation and refresh on React routes. Deploy behind HTTPS with `SESSION_SECRET` set. Production cookies are secure, HttpOnly, and SameSite=Lax; Passport sessions are stored in MongoDB. The app trusts one reverse proxy for HTTPS detection, so configure this for your hosting topology.

## Features

- Register with username, email, and password; log in with username; restore the session after refresh; log out.
- Create, read, edit, and remove books, including category, description, and optional URL.
- Write standalone notes or link them to a book. Format text with fonts, sizes, headings, emphasis, colors, highlights, alignment, lists, quotes, and links. Switch between Edit and Read preview without losing your current draft, then click Save note (or ⌘/Ctrl+S). Saved notes open in reading mode and can be reopened for editing.
- Create and edit flashcards with two to four answer options, one correct answer, and one or more book tags.
- Filter a quiz by any selected book, answer questions, review mistakes, end early, and retry.
- View books, notes, and flashcard counts on the dashboard.
- Confirm deletions. Deleting a book unlinks its notes and removes its flashcard tags while preserving both. Cards with no remaining books stay available for editing or removal.

Quiz scores stay in browser memory and are not persisted. The existing favorite flag is preserved in MongoDB, without adding a new favorite control. AI functionality is deferred.

## API

All endpoints return JSON, except successful logout and deletions, which return HTTP 204. Authentication uses an HttpOnly session cookie. Request bodies use JSON; API clients must send the cookie on authenticated requests.

| Endpoint | Methods | Purpose |
| --- | --- | --- |
| `/api/auth/register` | POST | Register; return a message prompting login |
| `/api/auth/login` | POST | Log in and return public user fields |
| `/api/auth/me` | GET | Return the current user, or HTTP 401 |
| `/api/auth/logout` | POST | Destroy the session |
| `/api/dashboard` | GET | Books, notes, and flashcard count |
| `/api/books` and `/api/books/:id` | GET, POST / GET, PATCH, DELETE | Book management |
| `/api/notes` and `/api/notes/:id` | GET, POST / GET, PATCH, DELETE | Note management |
| `/api/flashcards` and `/api/flashcards/:id` | GET, POST / GET, PATCH, DELETE | Flashcard management |

Filter flashcards with `/api/flashcards?tags=bookId1,bookId2`. Flashcard writes accept `question`, `options`, `correctIndex` (zero-based), and `tags` (book IDs). Optional empty options are removed while preserving the selected correct answer.

Note writes accept `title`, optional `book` (an owned book ID or `null`), and either plain `content` or rich `contentHtml`. Rich HTML is sanitized on the server; `content` is derived from it for previews and search. Plain-text updates clear previous rich formatting; title/book-only updates preserve it. Legacy notes need no migration. Notes include `updatedAt` after an edit.

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
