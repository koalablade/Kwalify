document.querySelectorAll('.btn[data-cmd]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const cmd = 'start-kwalify-benchmark.bat ' + btn.dataset.cmd;
    try {
      await navigator.clipboard.writeText(cmd);
      const toast = document.getElementById('toast');
      toast.style.display = 'block';
      document.getElementById('cmd-hint').textContent = 'Copied: ' + cmd;
      setTimeout(() => { toast.style.display = 'none'; }, 2000);
    } catch (_) {
      document.getElementById('cmd-hint').textContent = 'Run: ' + cmd;
    }
  });
});
