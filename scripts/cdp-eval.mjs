const expression = process.argv.slice(2).join(" ");
if (!expression) {
  console.error("Usage: node scripts/cdp-eval.mjs <expression>");
  process.exit(2);
}
const targets = await fetch("http://127.0.0.1:9222/json/list").then((response) => response.json());
const page = targets.find((target) => target.type === "page" && target.url === "app://obsidian.md/index.html");
if (!page) throw new Error("Obsidian renderer target not found.");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});
const response = await new Promise((resolve, reject) => {
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id !== 1) return;
    message.error ? reject(new Error(message.error.message)) : resolve(message.result);
  };
  socket.send(JSON.stringify({
    id: 1,
    method: "Runtime.evaluate",
    params: { expression, awaitPromise: true, returnByValue: true }
  }));
});
socket.close();
console.log(JSON.stringify(response, null, 2));
