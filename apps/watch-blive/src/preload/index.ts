import { ipcRenderer } from "electron";

window.addEventListener("message", (event) => {
  if (event.source !== window || event.data !== "watch-blive:connect" || event.ports.length !== 1)
    return;
  const sameOrigin =
    event.origin === window.location.origin ||
    (window.location.protocol === "file:" && event.origin === "null");
  if (!sameOrigin) return;
  ipcRenderer.postMessage("watch-blive:rpc", null, [event.ports[0]!]);
});
