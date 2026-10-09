let count = 0;
document.getElementById("add").addEventListener("click", () => {
  count += 2;
  document.getElementById("count").value = String(count);
});
