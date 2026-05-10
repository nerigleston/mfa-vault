document.getElementById("copyPromptBtn").addEventListener("click", () => {
  const text = document.getElementById("promptBox").innerText;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById("copyPromptBtn");
    const original = btn.textContent;
    btn.textContent = "Copiado!";
    btn.style.background = "#10b98120";
    btn.style.borderColor = "#10b981";
    btn.style.color = "#10b981";
    setTimeout(() => {
      btn.textContent = original;
      btn.style.background = "";
      btn.style.borderColor = "";
      btn.style.color = "";
    }, 2000);
  });
});
