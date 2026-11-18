// src/app.mjs
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import './config.mjs';
import session from 'express-session';
import passport from './auth.mjs';
import hbs from "hbs";
import './db.mjs';

import authRoutes from './routes/auth.mjs';
import dashboardRoutes from './routes/dashboard.mjs';
import booksRoutes from './routes/books.mjs';
import notesRoutes from './routes/notes.mjs';
import flashcardsRoutes from './routes/flashcards.mjs';


const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));



// Register helper
hbs.registerHelper("ifEquals", function (a, b, options) {
  return a.toString() === b?.toString() ? options.fn(this) : options.inverse(this);
});

// Session + Passport setup
app.use(
  session({
    secret: 'secret-key',
    resave: false,
    saveUninitialized: false,
  })
);
app.use(passport.initialize());
app.use(passport.session());


//make user available in all templates
app.use((req, res, next) => {
  res.locals.user = req.user;
  next();
});


// View engine
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, '../views'));




// Routes
app.use('/', authRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/books', booksRoutes);
app.use('/notes', notesRoutes);
app.use('/flashcards', flashcardsRoutes);


// Root route
app.get("/", (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    res.redirect("/dashboard");
  } else {
    res.redirect("/login");
  }
});



//show dibug info

app.use((req, res, next) => { 
  console.log(`Request URL: ${req.url}`);
  console.log(`Request Method: ${req.method}`);
  console.log(`Is Authenticated: ${req.isAuthenticated()}`);
  next();
});

// Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
