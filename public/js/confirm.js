const confirmModal = document.getElementById('confirm-modal');
const confirmMessageEl = confirmModal?.querySelector('[data-confirm-modal-message]');
const cancelBtn = confirmModal?.querySelector('[data-confirm-cancel]');
const acceptBtn = confirmModal?.querySelector('[data-confirm-accept]');
let pendingForm = null;

function openConfirmModal(message) {
  if (!confirmModal) {return;}
  if (confirmMessageEl) {confirmMessageEl.textContent = message || 'Are you sure?';}
  confirmModal.classList.remove('hidden');
  confirmModal.setAttribute('aria-hidden', 'false');
}

function closeConfirmModal() {
  if (!confirmModal) {return;}
  confirmModal.classList.add('hidden');
  confirmModal.setAttribute('aria-hidden', 'true');
  pendingForm = null;
}

document.querySelectorAll('form[data-confirm="true"]').forEach((form) => {
  form.addEventListener('submit', (event) => {
    if (!confirmModal) {return;}
    event.preventDefault();
    pendingForm = form;
    const message = form.dataset.confirmMessage || 'Are you sure?';
    openConfirmModal(message);
  });
});

cancelBtn?.addEventListener('click', () => {
  closeConfirmModal();
});

acceptBtn?.addEventListener('click', () => {
  const confirmedForm = pendingForm;
  closeConfirmModal();
  confirmedForm?.submit();
});

confirmModal?.addEventListener('click', (event) => {
  if (event.target === confirmModal) {
    closeConfirmModal();
  }
});
