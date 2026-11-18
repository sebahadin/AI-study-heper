// src/routes/auth.mjs
import express from 'express';
import bcrypt from 'bcrypt';
import passport from '../auth.mjs';
import { User } from '../db.mjs';

const router = express.Router();

// GET register
router.get('/register', (req, res) => {
  res.render('auth/register');
});

// POST register
// router.post('/register', async (req, res) => {
//   const { username, email, password, confirmPassword } = req.body;
//   // if (password !== confirmPassword) {
//   //   return res.send('Passwords do not match');
//   // }

//   // try {
//   //   const hashedPassword = await bcrypt.hash(password, 10);
//   //   await User.create({ username, email, password: hashedPassword });
//   //   res.redirect('/login');
//   // } catch (err) {
//   //   console.error(err);
//   //   res.send('Error registering user');
//   // }
//   try {
//     if (password !== confirmPassword) {
//       return res.render('auth/register', { error: 'Passwords do not match' });
//     }
  
//     const existingUser = await User.findOne({ $or: [{ username }, { email }] });
//     if (existingUser) {
//       return res.render('auth/register', { error: 'Username or email already exists' });
//     }
  
//     const hashedPassword = await bcrypt.hash(password, 10);
//     await User.create({ username, email, password: hashedPassword });
//     res.redirect('/login');
//   } catch (err) {
//     console.error(err);
//     res.render('auth/register', { error: 'Something went wrong. Please try again.' });
//   }
// });


export async function registerUser(req, res, deps = {}) {
  const { UserModel = User, bcryptLib = bcrypt } = deps;
  const { username, email, password, confirmPassword } = req.body;

  try {
    if (password !== confirmPassword) {
      return res.render('auth/register', { error: 'Passwords do not match' });
    }

    const existingUser = await UserModel.findOne({ $or: [{ username }, { email }] });
    if (existingUser) {
      return res.render('auth/register', { error: 'Username or email already exists' });
    }

    const hashedPassword = await bcryptLib.hash(password, 10);
    await UserModel.create({ username, email, password: hashedPassword });

    // Render login page with success message
    res.render('auth/login', { success: 'Account created successfully! Please log in.' });

  } catch (err) {
    console.error(err);
    res.render('auth/register', { error: 'Something went wrong. Please try again.' });
  }
}

// POST register
router.post('/register', (req, res) => {
  registerUser(req, res);
});




// GET login
router.get('/login', (req, res) => {
  res.render('auth/login');
});


// POST login
router.post('/login', (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) {return next(err);}
    if (!user) {
      // Send error message to login view
      return res.render('auth/login', { error: info.message });
    }
    req.logIn(user, (err) => {
      if (err) {return next(err);}
      res.redirect('/dashboard');
    });
  })(req, res, next);
});


// GET logout
router.get('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) {return next(err);}
    res.render('auth/login', { success: 'You have been logged out successfully.' });
  });
});


export default router;
