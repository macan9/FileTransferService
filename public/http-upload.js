(function () {
  const fileInput = document.getElementById('fileInput');
  const uploadButton = document.getElementById('uploadButton');
  const progressBar = document.getElementById('progressBar');
  const status = document.getElementById('status');
  const result = document.getElementById('result');

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  function setProgress(percent) {
    progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  }

  function setStatus(message, isError) {
    status.textContent = message;
    status.className = isError ? 'status error' : 'status';
  }

  uploadButton.addEventListener('click', () => {
    const file = fileInput.files && fileInput.files[0];

    if (!file) {
      setStatus('Please choose a file first.', true);
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/files/upload');

    uploadButton.disabled = true;
    setProgress(0);
    setStatus(`Uploading ${file.name} (${formatBytes(file.size)})...`, false);
    result.textContent = 'Uploading...';

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) {
        setStatus(`Uploading ${file.name}...`, false);
        return;
      }

      const percent = (event.loaded / event.total) * 100;
      setProgress(percent);
      setStatus(
        `Uploading ${file.name}: ${percent.toFixed(1)}% (${formatBytes(event.loaded)}/${formatBytes(event.total)})`,
        false,
      );
    };

    xhr.onload = () => {
      uploadButton.disabled = false;

      if (xhr.status >= 200 && xhr.status < 300) {
        setProgress(100);
        setStatus(`${file.name} uploaded successfully.`, false);
      } else {
        setStatus(`Upload failed with status ${xhr.status}.`, true);
      }

      result.textContent = xhr.responseText || 'No response body.';
    };

    xhr.onerror = () => {
      uploadButton.disabled = false;
      setStatus('Upload failed because the network request could not be completed.', true);
      result.textContent = 'Network error';
    };

    xhr.send(formData);
  });
})();
