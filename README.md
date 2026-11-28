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

## Study chat

Open **Study chat** in the navigation or **Ask Classmate** inside a note, PDF, book, or course. Choose your study scope and ask a question. Book and course scopes include linked notes and PDFs; a book record alone does not contain readable book text. Semantic retrieval needs a Ready index status. Library browsing and current note text can be read without a vector index.

Chat can also browse your application records directly. Try **“list all my books,” “what PDF documents do I have,” “do I have a biology course,” “show notes in Biology,”** or **“what is linked to this book?”** Inventory replies show current owned records and links under **From your library**; they do not turn into coaching. Large lists include exact totals and paginated results; ask for the next page or open a returned item. Tools cover books, courses, notes, uploads, manual flashcards, generated study sets, quiz attempts and conversations. Existing study-space selections remain enforced, including for unindexed materials.

The executable catalog tools are `get_library_overview`, `list_library_items`, `get_library_item`, and `explore_connections`. Tool arguments and results use Pydantic contracts; the LangGraph router uses structured output and receives the tool descriptions and schemas. Express checks the active conversation, owner and scope, then re-reads and renders current records. Titles, IDs, counts and links are not taken from model-written prose. Ambiguous names prompt a choice. Note/PDF/content and conversation excerpts are bounded; book records hold metadata, with readable study text in their linked notes/PDFs.

Every model role shares a Classmate assistant identity prompt. Greetings and identity/help questions have a direct assistant route; performance analysis and recommendations run only for those requests. The assistant is built by Classmate using configured model providers. Generated library changes continue to require review and confirmation.

Answers stream as provisional drafts, then their citation references are checked against current authorized passages before the final answer is saved. Click a numbered source to read the cited passage and open its original note or PDF page. Questions unsupported by the selected material receive an explicit acknowledgment. General explanations require opting in under **Study scope** and are labeled separately. Retrieved text cannot expand the assistant's permissions. The assistant can prepare editable study drafts. Library changes require a separate user review and confirmation through Express.

Conversations and messages live in MongoDB and remain across refresh, logout, and service restarts until you delete the conversation. Each conversation allows 100 turns; starting another preserves the old history. Only a bounded recent history is sent to the model. Stopped or interrupted replies keep your question and provide a retry; partial text is not saved as a completed answer. Editing/deleting a source disables its old quote preview while preserving the historical answer. Deleting a conversation permanently removes its messages.

Python reads existing `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` server-side from `backend/.env` and the repository-root `.env` (root values take precedence; environment variables override both). The default provider is OpenAI with `gpt-6-luna` for routing and tutoring, reasoning disabled. `AI_CHAT_PROVIDER`, `AI_CHAT_MODEL`, and `AI_CHAT_ROUTER_MODEL` can select other available models; see `ai-service/.env.example`. Local Hugging Face embeddings continue to run on your server; the chosen chat provider receives only necessary retrieved excerpts, your question, and bounded recent conversation context. LangSmith tracing is disabled for this workflow.

Default limits are 4,000 characters per question, 8,000 input tokens per model call, 1,500 output tokens for the answer, two retrieval tool calls, and a 90-second Python turn deadline. Express enforces configurable daily quotas of 50 turns per user and 200 across the app (`AI_CHAT_DAILY_TURNS` / `AI_CHAT_GLOBAL_DAILY_TURNS`); failed/cancelled turns also count. Provider retries and automatic upgrades to more expensive models are disabled. Restart the stack after changing model configuration. Keep API keys and `AI_SERVICE_TOKEN` out of React configuration.

## AI study tools

Open **Study tools** or **Create study material** inside a note, PDF, book, or course. Create a summary, explanation, recall deck, or practice quiz from ready indexed materials. Chat can also prepare these drafts; use its study buttons or ask directly. A generated result is an editable draft, with source previews and an explicit description of its excerpt coverage.

Drafts open in a readable preview. Use **Edit draft** to change wording, answers, or rubrics; edits save privately in the background. If the connection fails, this tab keeps a recovery copy. A newer server revision requires your choice before restoring local edits. Sign-out clears local recovery copies. Select **Review & save** when ready. The confirmation applies only to the exact revision you reviewed. Saved-set edits remain draft changes until separately confirmed; deletion also requires confirmation. Repeated confirmation requests cannot create duplicate saved sets. **Create another draft** reuses the original scope and generation settings so you can adjust or regenerate after source changes. Drafts and saved sets persist in MongoDB until you delete them; source-version changes prevent stale drafts from being newly saved.

The study workshop includes title search, saved/draft/type filters, and a resume shortcut. Saved quizzes and decks open directly into practice; sets with pending draft changes lead to review, with the saved version still available. Choose ready source materials and use optional starting ideas and question-count presets to shape a new draft.

Saved recall decks appear in **Flashcards**, saved quizzes in **Quiz**, and summaries in **Notes**, alongside the existing manually created materials. Decks use the existing accessible 3D flip. Quizzes support mixed multiple-choice, written, and coding questions. Choice answers receive deterministic feedback; written/code answers show reference answers, explanations, and self-review rubrics. Jump between questions without losing answers, mark questions for another look, or shuffle a deck. On a focused flashcard, Space/Enter flips it and the left/right arrows move through the deck. Touch and reduced-motion settings are supported. The code editor supports syntax highlighting and normal Tab navigation. Code is never executed. Draft previews stay in browser memory. Saved AI quizzes and existing flashcard quizzes use recorded attempts, described below.

The default is five questions/cards, controlled by `DEFAULT_QUESTION_COUNT` in `ai-service/app/core/constants.py`; the form reads this policy from Python. Requests can choose 1–10 items and automatic, choice, written, or code quiz formats. Automatic mode chooses formats appropriate to the material. Generation uses the configured chat model unless `AI_STUDY_MODEL` is set, with a default 6,000-token output cap (`AI_STUDY_MAX_OUTPUT_TOKENS`), a 90-second deadline, and the shared daily AI quotas. Existing server-side provider keys are reused. The editor and its language support load only when needed.

## Learning history and study coaching

Open **Your learning** to resume an unfinished quiz, review past results, revisit mistakes, and explore study suggestions. Saved AI quizzes and course/book flashcard quizzes keep their question snapshot, draft answers, submitted answers, review flags, and results in MongoDB. A quiz edit or deletion does not rewrite earlier attempts. Starting the same unchanged quiz resumes its unfinished attempt; **Try this quiz again** starts a fresh attempt after completion. Existing manual quizzes use up to 100 flashcards per attempt (`MAX_MANUAL_QUESTIONS`).

Answers save as you work. This tab also keeps an interruption-recovery copy; a conflicting server revision requires your choice before restoration. Submitted answers are fixed for that attempt. Choice questions are scored in Express against the saved answer key. For written/code questions, choose **Submit & get AI feedback**, or submit for self-review and request assessment later. AI feedback includes points and reasons for each saved rubric criterion. Assessments are advisory; code is inspected and never executed. Revealed and unanswered questions earn no points, and the combined result remains provisional while submitted open answers await assessment.

The dashboard shows unfinished sessions and current library entry points without calling an LLM. **Prepare study suggestions** explicitly runs the coach and library recommender; unchanged results are cached. Suggestions use a bounded selection of relevant recent attempts and chat interests. Choice scores stay separate from AI assessments. Recommended IDs and links must resolve to the user's current owned catalog; external recommendations are disabled. Chat can also review performance or recommend materials within its selected study scope. Coaching prepares suggestions and never changes library content.

Assessment and coaching reuse server-side provider credentials and the configured chat model. Optional `AI_ASSESSMENT_MODEL` and `AI_COACHING_MODEL` override their roles; `AI_LEARNING_MAX_OUTPUT_TOKENS` defaults to 2,000. Each explicit assessment or coaching request uses the shared daily quota; coaching has two bounded specialist calls. Calls have timeouts, no automatic paid retries, and expiring leases so interrupted requests can be retried without duplicate completed assessments. Private prompts and answers are not traced. Quiz history is retained in MongoDB; deleting an original study set preserves historical results.

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
- Discuss indexed notes and PDFs in Study chat. Select individual materials, books, courses, or your library; add a topic focus; read streamed answers with verified source previews; stop a response; and reopen saved conversations.
- Confirm deletions. Deleting a book unlinks its notes and removes its flashcard tags while preserving both. Cards with no remaining books stay available for editing or removal.

Saved-quiz and manual flashcard-quiz attempts persist across refresh, logout, and later sessions. Draft previews remain temporary. The existing favorite flag is preserved in MongoDB, without adding a new favorite control.

## API

Endpoints return JSON, except chat answer streams (server-sent events), PDF file redirects, and successful logout/deletions (HTTP 204). Authentication uses an HttpOnly session cookie. Request bodies use JSON; API clients must send the cookie on authenticated requests.

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
| `/api/chat` | GET, POST | Paginated owned conversations / create a scoped conversation |
| `/api/chat/:id` | GET, PATCH, DELETE | History, scope/title updates, or permanent deletion |
| `/api/chat/:id/messages` | POST | Stream a reply as server-sent events; requires a UUID requestId |
| `/api/chat/:id/cancel` | POST | Stop the current run using its runId |
| `/api/chat/:id/sources/:messageId/:number` | GET | Revalidate and preview a cited passage |
| `/api/chat/config` and `/api/chat/options` | GET | Chat availability and owned scope choices |
| `/api/study-tools` | GET, POST | Paginated owned drafts/sets or create a generation request |
| `/api/study-tools/:id` | GET, PATCH | Read a study set or edit its private draft with revision checks |
| `/api/study-tools/:id/generate` and `/cancel` | POST | Stream generation status or stop it |
| `/api/study-tools/:id/confirmations` and `/actions` | POST | Review the exact save/update/delete and apply its confirmation |
| `/api/study-tools/:id/practice` and `/sources/:number` | GET | Answer-key-free quiz controls or a verified source excerpt |
| `/api/study-tools/:id/feedback` | POST | Stateless preview feedback and reference rubrics |
| `/api/learning` | GET | Recent results, resume links, current library suggestions and cached coaching |
| `/api/learning/coaching` | POST | Explicitly prepare or reuse personalized study suggestions |
| `/api/learning/attempts` | GET, POST | Paginated history; start/resume from a saved quiz, manual scope or earlier attempt |
| `/api/learning/attempts/:id` | GET, PATCH | Owned snapshot/progress; autosave unfinished answers, position and review flags |
| `/api/learning/attempts/:id/answers/:question` | POST | Submit an answer or record an answer reveal |
| `/api/learning/attempts/:id/assessments/:question` | POST | Request/reuse a rubric-based AI assessment |
| `/api/learning/attempts/:id/complete` | POST | Finish and preserve the attempt's results |

Materials accept an optional `courses` array of owned course IDs; an omitted array preserves membership on PATCH. Filter books, notes, or flashcards with `?course=courseId`, or `?course=none` for materials with no direct or inherited course. Course material assignments accept `{ "kind": "books" | "notes" | "flashcards", "ids": [...] }`; all IDs must belong to the signed-in user. This changes only the selected course’s direct assignments.

Filter flashcards with `/api/flashcards?tags=bookId1,bookId2`. Flashcard writes accept `question`, `options`, `correctIndex` (zero-based), and `tags` (book IDs). Optional empty options are removed while preserving the selected correct answer.

Note writes accept `title`, optional `book` (an owned book ID or `null`), and either plain `content` or rich `contentHtml`. Rich HTML is sanitized on the server; `content` is derived from it for previews and search. Plain-text updates clear previous rich formatting; title/book-only updates preserve it. Legacy notes need no migration. Notes include `updatedAt` after an edit.

Study search accepts `{ "query": "What supplies energy to cells?", "scope": { "courses": ["courseId"] }, "limit": 6 }`. A scope can select `documents`, `notes`, `books`, and `courses`; their selections are combined. Book/course scopes include their currently linked notes and PDFs. Use `{ "library": true }` explicitly for the whole library. An empty scope returns no passages. Only your current, ready source versions are searched; select a narrower scope if more than 100 indexed sources match.

Search returns `{ "query", "passages", "sources" }`, including PDF page or note paragraph citations and links to the original material. Results contain at most 12 passages and 12,000 characters. Study chat uses these same retrieval boundaries for its answers. The internal read tools are `search_materials`, `fetch_passages`, the bounded `read_material_overview`, `read_quiz_performance`, and `find_library_materials`; the application supplies their identity and scope.

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

Those integration tests create users and study records, then drop that test database. They are skipped when `TEST_DSN` is not supplied. Frontend tests cover protected navigation, session restore/logout, registration feedback, recorded practice and recovery, explicit coaching, chat history/scope/source UI, split streaming frames, and safe Markdown. Python unit tests run with `uv run --directory ai-service --locked pytest`. The opt-in real-provider chat test uses only synthetic material in a disposable MongoDB/Chroma stack and makes a few billed calls:

```sh
cd ai-service
RUN_CHAT_LIVE_TEST=1 uv run --locked pytest tests/integration/test_chat_live.py
```

The study-tool integration test is also opt-in and uses only synthetic notes/PDFs and disposable services:

```sh
cd ai-service
RUN_STUDY_LIVE_TEST=1 uv run --locked pytest tests/integration/test_study_tools_live.py
```

The opt-in learning integration check uses synthetic quizzes, real rubric assessment and coaching, and disposable services:

```sh
cd ai-service
RUN_LEARNING_LIVE_TEST=1 uv run --locked pytest tests/integration/test_learning_live.py
```

The catalog-routing regression uses synthetic records and opt-in real model calls:

```sh
cd ai-service
RUN_LIBRARY_LIVE_TEST=1 uv run --locked pytest tests/integration/test_library_chat_live.py
```
