function showAlertModal(title, message) {
  const modal = document.getElementById('alert-modal');
  const titleEl = modal?.querySelector('[data-alert-title]');
  const messageEl = modal?.querySelector('[data-alert-message]');
  const closeBtn = modal?.querySelector('[data-alert-close]');
  if (!modal || !titleEl || !messageEl || !closeBtn) {
    alert(message);
    return;
  }

  titleEl.textContent = title;
  messageEl.textContent = message;
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');

  const controller = new AbortController();
  const hide = () => {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    controller.abort();
  };

  const backdropHandler = (event) => {
    if (event.target === modal) {
      hide();
    }
  };

  closeBtn.addEventListener('click', hide, { signal: controller.signal });
  modal.addEventListener('click', backdropHandler, { signal: controller.signal });
}

class QuizState {
  constructor() {
    this.cards = [];
    this.index = 0;
    this.score = 0;
    this.answered = false;
    this.misses = [];
  }

  reset(cards) {
    this.cards = cards;
    this.index = 0;
    this.score = 0;
    this.answered = false;
    this.misses = [];
  }

  currentCard() {
    return this.cards[this.index];
  }

  recordAnswer(isCorrect, chosenOption) {
    this.answered = true;
    if (isCorrect) {
      this.score += 1;
      return;
    }
    const card = this.currentCard();
    this.misses.push({
      question: card.question,
      chosen: chosenOption,
      correct: card.options[card.correctIndex],
    });
  }

  next() {
    if (this.index < this.cards.length - 1) {
      this.index += 1;
      this.answered = false;
      return true;
    }
    return false;
  }
}

class QuizView {
  constructor() {
    this.tagCheckboxes = document.querySelectorAll('[data-tag-checkbox]');
    this.filterControls = document.getElementById('quizFilters');
    this.startBtn = document.getElementById('startQuizBtn');
    this.tagWarning = document.getElementById('tagWarning');
    this.quizHud = document.getElementById('quizHud');
    this.scoreText = document.getElementById('scoreText');
    this.idxText = document.getElementById('idxText');
    this.totalText = document.getElementById('totalText');
    this.questionBox = document.getElementById('questionBox');
    this.questionText = document.getElementById('questionText');
    this.optionsBox = document.getElementById('optionsBox');
    this.nextBtn = document.getElementById('nextBtn');
    this.leaveBtn = document.getElementById('leaveBtn');
    this.resultBox = document.getElementById('resultBox');
    this.finalScore = document.getElementById('finalScore');
    this.missedList = document.getElementById('missedList');
    this.retryBtn = document.getElementById('retryBtn');
  }

  selectedTagIds() {
    return Array.from(this.tagCheckboxes)
      .filter((cb) => cb.checked)
      .map((cb) => cb.value);
  }

  toggleFilters(visible) {
    if (!this.filterControls) {return;}
    this.filterControls.classList.toggle('is-hidden', !visible);
  }

  setTagWarning(visible) {
    if (!this.tagWarning) {return;}
    this.tagWarning.classList.toggle('hidden', !visible);
  }

  renderQuestion(state) {
    const card = state.currentCard();
    this.idxText.textContent = String(state.index + 1);
    this.totalText.textContent = String(state.cards.length);
    this.questionText.textContent = card.question;
    this.optionsBox.innerHTML = '';
    this.nextBtn.disabled = true;
    state.answered = false;

    card.options.forEach((option, idx) => {
      const btn = document.createElement('button');
      btn.className = 'details-btn';
      btn.style.display = 'block';
      btn.style.marginBottom = '6px';
      btn.textContent = option;
      btn.addEventListener('click', () => {
        if (state.answered) {return;}
        const isCorrect = idx === card.correctIndex;
        state.recordAnswer(isCorrect, option);
        this.scoreText.textContent = String(state.score);
        btn.style.outline = isCorrect ? '2px solid #2ecc71' : '2px solid #e74c3c';
        this.nextBtn.disabled = false;
      });
      this.optionsBox.appendChild(btn);
    });
  }

  renderResults(state) {
    this.questionBox.style.display = 'none';
    this.quizHud.style.display = 'none';
    this.resultBox.style.display = 'block';
    this.finalScore.textContent = `${state.score} / ${state.cards.length}`;
    this.missedList.innerHTML = '';

    if (!state.misses.length) {
      this.missedList.innerHTML = '<p>Perfect! You missed no questions.</p>';
      return;
    }

    const list = document.createElement('ul');
    list.className = 'missed-list';

    state.misses.forEach((miss) => {
      const li = document.createElement('li');
      li.innerHTML = `
        <strong>${miss.question}</strong>
        <div>Your answer: ${miss.chosen}</div>
        <div>Correct answer: <em>${miss.correct}</em></div>
      `;
      list.appendChild(li);
    });

    this.missedList.appendChild(list);
  }

  showQuizUI(cardCount) {
    this.resultBox.style.display = 'none';
    this.quizHud.style.display = 'block';
    this.questionBox.style.display = 'block';
    this.totalText.textContent = String(cardCount);
  }
}

class QuizController {
  constructor() {
    this.view = new QuizView();
    this.state = new QuizState();
    this.attachEvents();
  }

  attachEvents() {
    this.view.startBtn?.addEventListener('click', () => this.start());
    this.view.nextBtn?.addEventListener('click', () => this.advance());
    this.view.leaveBtn?.addEventListener('click', () => this.finish());
    this.view.retryBtn?.addEventListener('click', () => this.start());
  }

  async fetchCards() {
    const tags = this.view.selectedTagIds();
    const res = await fetch(`/flashcards/api/list?tags=${encodeURIComponent(tags.join(','))}`, {
      credentials: 'same-origin',
    });
    const data = await res.json();
    if (!data.ok) {throw new Error('Failed to load flashcards');}
    return data.cards;
  }

  async start() {
    const selected = this.view.selectedTagIds();
    if (!selected.length) {
      this.view.setTagWarning(true);
      return;
    }
    this.view.setTagWarning(false);
    const cards = await this.fetchCards();
    if (!cards.length) {
      showAlertModal('No Flashcards', 'No flashcards found for the selected books. Add some or choose different tags.');
      return;
    }
    this.view.toggleFilters(false);
    this.state.reset(cards);
    this.view.scoreText.textContent = '0';
    this.view.showQuizUI(cards.length);
    this.view.renderQuestion(this.state);
  }

  advance() {
    if (this.state.next()) {
      this.view.renderQuestion(this.state);
    } else {
      this.finish();
    }
  }

  finish() {
    this.view.renderResults(this.state);
  }
}

(() => {
  if (document.getElementById('quizTagList')) {
    new QuizController();
  }
})();
