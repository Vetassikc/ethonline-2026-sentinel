const status = document.querySelector("#exposure-status");

fetch("/api/exposure/config")
  .then((response) => response.json())
  .then((payload) => {
    status.textContent = JSON.stringify(payload, null, 2);
  })
  .catch(() => {
    status.textContent = "Exposure configuration unavailable.";
  });
