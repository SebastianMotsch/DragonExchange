// Forms are placeholders until the backend is connected.
document.querySelectorAll('form[data-demo-message]').forEach((form) => {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    form.querySelector('.status').textContent = form.dataset.demoMessage;
  });
});
