const port = Number(process.env.CDP_PORT ?? 9222);
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
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
    params: {
      expression: `(async () => {
        const api = app.plugins.plugins["scopus-research-explorer"]?.api;
        if (!api) throw new Error("Plugin API is unavailable");
        const workspaces = await api.listWorkspaces();
        const removedWorkspaces = [];
        for (const workspace of workspaces.filter((item) =>
          item.name === "CDP Smoke Test" ||
          item.name.startsWith("Contract ") ||
          item.name.startsWith("Real Export Validation ") ||
          item.name.startsWith("Quality Preparation ")
        )) {
          await api.deleteWorkspace(workspace.workspaceId);
          removedWorkspaces.push(workspace.name);
        }
        const removedNotes = [];
        for (const note of app.vault.getMarkdownFiles().filter((file) =>
          file.path.startsWith("Research/Publications/")
        )) {
          const text = await app.vault.read(note);
          if (text.includes("research_explorer_doi: \\"10.1000/graph\\"") ||
              text.includes("# Graph Discovery for Literature Reviews")) {
            await app.vault.delete(note);
            removedNotes.push(note.path);
          }
        }
        return {removedWorkspaces, removedNotes};
      })()`,
      awaitPromise: true,
      returnByValue: true
    }
  }));
});
socket.close();
if (response.exceptionDetails) {
  throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
}
console.log(JSON.stringify(response.result.value, null, 2));
