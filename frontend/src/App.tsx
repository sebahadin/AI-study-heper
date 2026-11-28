import { lazy, Suspense } from 'react';
import { Link, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthProvider';
import { Layout } from './components/Layout';
import { Loading, LoadError } from './components/Feedback';
import { AuthPage } from './pages/auth/AuthPage';
import { Dashboard } from './pages/Dashboard';
import { BookDetail, BookEditor } from './pages/books/BookPages';
import { BookList } from './pages/books/BookList';
import { NoteList } from './pages/notes/NoteList';
import { FlashcardEditor, FlashcardList } from './pages/flashcards/FlashcardPages';
import { CourseList, CourseEditor, CourseDetail } from './pages/courses/CoursePages';
import { QuizPage } from './pages/flashcards/QuizPage';

const LearningPage = lazy(() => import('./pages/learning/LearningPage'));
const AttemptPractice = lazy(() => import('./pages/learning/AttemptPractice'));
const StudyTools = lazy(() => import('./pages/study-tools/StudyToolsPage'));
const StudyDetail = lazy(() => import('./pages/study-tools/StudyDetail'));
const StudyPractice = lazy(() => import('./pages/study-tools/StudyPractice'));
const StudyChat = lazy(() => import('./pages/chat/ChatPage'));
const NoteDetail = lazy(() => import('./pages/notes/NotePages').then((module) => ({ default: module.NoteDetail })));
const NoteEditor = lazy(() => import('./pages/notes/NotePages').then((module) => ({ default: module.NoteEditor })));
const DocumentLibrary = lazy(() => import('./pages/documents/DocumentLibrary').then(module => ({ default: module.DocumentLibrary })));
const DocumentUpload = lazy(() => import('./pages/documents/DocumentUpload').then(module => ({ default: module.DocumentUpload })));
const DocumentDetail = lazy(() => import('./pages/documents/DocumentDetail').then(module => ({ default: module.DocumentDetail })));

function ProtectedRoute() {
  const { user } = useAuth();
  const location = useLocation();
  return user ? <Outlet /> : <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
}

export default function App() {
  const { user, loading, error, refresh } = useAuth();
  if (loading) { return <main className="boot-screen"><Loading message="Opening your workspace…" /></main>; }
  if (error) { return <main className="boot-screen"><LoadError message={error} retry={refresh} /></main>; }
  return <Suspense fallback={<Loading message="Opening your workspace…" />}><Routes><Route element={<Layout />}>
    <Route index element={<Navigate to={user ? '/dashboard' : '/login'} replace />} />
    <Route path="login" element={<AuthPage key="login" />} />
    <Route path="register" element={<AuthPage key="register" register />} />
    <Route element={<ProtectedRoute />}>
      <Route path="learning" element={<LearningPage />} />
      <Route path="learning/attempts/:id" element={<AttemptPractice />} />
      <Route path="study-tools" element={<StudyTools />} />
      <Route path="study-tools/new" element={<StudyTools create />} />
      <Route path="study-tools/:id" element={<StudyDetail />} />
      <Route path="study-tools/:id/practice" element={<StudyPractice />} />
      <Route path="chat" element={<StudyChat />} />
      <Route path="chat/:id" element={<StudyChat />} />
      <Route path="dashboard" element={<Dashboard />} />
      <Route path="courses" element={<CourseList />} />
      <Route path="courses/add" element={<CourseEditor />} />
      <Route path="courses/:id/edit" element={<CourseEditor />} />
      <Route path="courses/:id" element={<CourseDetail />} />
      <Route path="books" element={<BookList />} />
      <Route path="books/add" element={<BookEditor />} />
      <Route path="books/:id/edit" element={<BookEditor />} />
      <Route path="books/:id" element={<BookDetail />} />
      <Route path="documents" element={<DocumentLibrary />} />
      <Route path="documents/upload" element={<DocumentUpload />} />
      <Route path="documents/:id" element={<DocumentDetail />} />
      <Route path="notes" element={<NoteList />} />
      <Route path="notes/add" element={<NoteEditor />} />
      <Route path="notes/:id/edit" element={<NoteEditor />} />
      <Route path="notes/:id" element={<NoteDetail />} />
      <Route path="flashcards" element={<Navigate to="/flashcards/list" replace />} />
      <Route path="flashcards/list" element={<FlashcardList />} />
      <Route path="flashcards/new" element={<FlashcardEditor />} />
      <Route path="flashcards/edit/:id" element={<FlashcardEditor />} />
      <Route path="flashcards/quiz" element={<QuizPage />} />
    </Route>
    <Route path="*" element={<section className="section"><h2>Page not found</h2><p><Link to={user ? '/dashboard' : '/login'}>Return to Classmate</Link></p></section>} />
  </Route></Routes></Suspense>;
}
