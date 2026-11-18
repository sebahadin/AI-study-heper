// public/js/validation.js
import JustValidate from 'https://cdn.jsdelivr.net/npm/just-validate@4.3.0/dist/just-validate.es.js';

const sharedOptions = {
  errorLabelCssClass: 'form-error',
  focusInvalidField: true,
  lockForm: true,
};

const urlPattern = /^(https?:\/\/)[\w-]+(\.[\w-]+)+[/#?]?.*$/i;

const initRegisterForm = () => {
  const selector = '#registerForm';
  if (!document.querySelector(selector)) {return;}
  const validation = new JustValidate(selector, sharedOptions);
  validation
    .addField(`${selector} [name="username"]`, [
      { rule: 'required', errorMessage: 'Choose a username.' },
      { rule: 'minLength', value: 3, errorMessage: 'Username must be at least 3 characters.' },
    ])
    .addField(`${selector} [name="email"]`, [
      { rule: 'required', errorMessage: 'Enter your email address.' },
      { rule: 'email', errorMessage: 'Use a valid email address.' },
    ]);

  const passwordSelector = `${selector} [name="password"]`;
  validation.addField(passwordSelector, [
    { rule: 'required', errorMessage: 'Create a password.' },
    { rule: 'minLength', value: 6, errorMessage: 'Password must be at least 6 characters.' },
  ]);

  validation.addField(`${selector} [name="confirmPassword"]`, [
    { rule: 'required', errorMessage: 'Confirm your password.' },
    {
      validator: (value, fields) => {
        const passwordValue = fields[passwordSelector]?.elem?.value;
        return passwordValue ? value === passwordValue : true;
      },
      errorMessage: 'Passwords must match.',
    },
  ]);
};

const initLoginForm = () => {
  const selector = '#loginForm';
  if (!document.querySelector(selector)) {return;}
  const validation = new JustValidate(selector, sharedOptions);
  validation
    .addField(`${selector} [name="username"]`, [
      { rule: 'required', errorMessage: 'Enter your username.' },
    ])
    .addField(`${selector} [name="password"]`, [
      { rule: 'required', errorMessage: 'Enter your password.' },
    ]);
};

const initBookForms = () => {
  ['#bookForm', '#editBookForm'].forEach((selector) => {
    if (!document.querySelector(selector)) {return;}
    const validation = new JustValidate(selector, sharedOptions);
    validation
      .addField(`${selector} [name="title"]`, [
        { rule: 'required', errorMessage: 'Provide the book title.' },
        { rule: 'minLength', value: 2, errorMessage: 'Title should be at least 2 characters.' },
      ])
      .addField(`${selector} [name="author"]`, [
        { rule: 'required', errorMessage: 'Specify the author.' },
        { rule: 'minLength', value: 2, errorMessage: 'Author name should be at least 2 characters.' },
      ])
      .addField(`${selector} textarea[name="description"]`, [
        {
          validator: (value = '') => {
            const text = value.trim();
            return !text || text.length >= 10;
          },
          errorMessage: 'Describe the book in at least 10 characters.',
        },
      ])
      .addField(`${selector} [name="category"]`, [
        { rule: 'required', errorMessage: 'Add a category or genre.' },
      ])
      .addField(`${selector} [name="url"]`, [
        {
          validator: (value) => !value.trim() || urlPattern.test(value.trim()),
          errorMessage: 'Enter a full URL, e.g., https://example.com',
        },
      ]);
  });
};

const initNoteForms = () => {
  ['#noteForm', '#editNoteForm'].forEach((selector) => {
    if (!document.querySelector(selector)) {return;}
    const validation = new JustValidate(selector, sharedOptions);
    validation
      .addField(`${selector} [name="title"]`, [
        { rule: 'required', errorMessage: 'Give your note a title.' },
        { rule: 'minLength', value: 3, errorMessage: 'Title should be at least 3 characters.' },
      ])
      .addField(`${selector} textarea[name="content"]`, [
        { rule: 'required', errorMessage: 'Share what you learned.' },
        {
          validator: (value) => value.trim().length >= 10,
          errorMessage: 'Note content should be at least 10 characters long.',
        },
      ]);
  });
};

const initFlashcardForm = () => {
  const selector = '#flashcardForm';
  const form = document.querySelector(selector);
  if (!form) {return;}

  const validation = new JustValidate(selector, sharedOptions);
  validation
    .addField(`${selector} [name="question"]`, [
      { rule: 'required', errorMessage: 'Add the quiz question.' },
      { rule: 'minLength', value: 5, errorMessage: 'Question should be at least 5 characters.' },
    ])
    .addField(`${selector} [name="option1"]`, [
      { rule: 'required', errorMessage: 'Provide the first answer option.' },
    ])
    .addField(`${selector} [name="option2"]`, [
      { rule: 'required', errorMessage: 'Provide the second answer option.' },
    ])
    .addField(`${selector} [name="option3"]`, [
      {
        validator: (value = '') => {
          const text = value.trim();
          return !text || text.length >= 1;
        },
        errorMessage: 'Option 3 must contain text or be left blank.',
      },
    ])
    .addField(`${selector} [name="option4"]`, [
      {
        validator: (value = '') => {
          const text = value.trim();
          return !text || text.length >= 1;
        },
        errorMessage: 'Option 4 must contain text or be left blank.',
      },
    ])
    .addField(`${selector} [name="correctIndex"]`, [
      { rule: 'required', errorMessage: 'Select which option is correct.' },
    ]);

  validation.addRequiredGroup(
    `${selector} input[name="tags"]`,
    'Select at least one related book.'
  );
};

document.addEventListener('DOMContentLoaded', () => {
  initRegisterForm();
  initLoginForm();
  initBookForms();
  initNoteForms();
  initFlashcardForm();
});
