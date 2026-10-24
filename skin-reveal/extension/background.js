chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!['skin-reveal-history', 'skin-reveal-error', 'skin-reveal-search'].includes(message?.kind) ||
      !sender.url?.startsWith('https://csgoskins.gg/')) return;
  const searching = message.kind === 'skin-reveal-search';
  const suffix = message.kind === 'skin-reveal-error' ? '/error' : '';
  const body = searching ? {url: message.url, results: message.results} :
    message.kind === 'skin-reveal-error' ? {error: message.error} : {url: message.url, name: message.name, points: message.points};
  fetch(`http://127.0.0.1:8765/api/${searching?'site-search':'page-import'}/${encodeURIComponent(message.jobId)}${suffix}`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body)
  }).then(async response => {
    if (!response.ok) throw Error((await response.json()).detail || `HTTP ${response.status}`);
    sendResponse({ok: true});
  }).catch(error => sendResponse({ok: false, error: String(error)}));
  return true;
});
