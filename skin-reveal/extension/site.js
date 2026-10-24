(() => {
  const params = new URLSearchParams(location.hash.slice(1));
  const searchId = params.get('skin-reveal-search');
  if (/^[0-9a-f-]{36}$/.test(searchId || '') && location.pathname === '/') {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      const links = [...document.querySelectorAll('h2 a[href*="/items/"]')];
      if (!links.length && !document.body.innerText.includes('No matching items found') && attempts < 90) return;
      clearInterval(timer);
      const results = links.map(a => {
        const url = new URL(a.href);
        const card = a.parentElement?.parentElement?.parentElement;
        const full = [...(card?.querySelectorAll('a[href]') || [])].find(link =>
          link.href === a.href && link.textContent.includes('|'));
        const variants = [...(card?.querySelectorAll('a[href]') || [])]
          .map(link => new URL(link.href).pathname)
          .filter(path => path.startsWith(url.pathname + '/') && !path.includes('/stattrak-'));
        return {name: (full || a).textContent.replace(/\s+/g, ' ').trim(),
          path: url.pathname, default_path: variants.at(-1) || url.pathname};
      }).filter(x => /^\/items\/[a-z0-9-]+$/.test(x.path) && x.name);
      chrome.runtime.sendMessage({kind: 'skin-reveal-search', jobId: searchId,
        url: location.href.split('#')[0], results});
    }, 1000);
    return;
  }
  const jobId = params.get('skin-reveal-job');
  if (!/^[0-9a-f-]{36}$/.test(jobId || '')) return;

  function readChart() {
    const script = [...document.scripts].find(s => s.textContent.includes('const priceHistory ='));
    const raw = script?.textContent.match(/const priceHistory\s*=\s*(\[[\s\S]*?\]);/)?.[1];
    if (!raw) return null;
    const points = JSON.parse(raw);
    if (!Array.isArray(points) || points.length < 2 || points.length > 20000) return null;
    return points;
  }

  let attempts = 0;
  const timer = setInterval(() => {
    attempts++;
    let points;
    try { points = readChart(); } catch { points = null; }
    if (points) {
      clearInterval(timer);
      chrome.runtime.sendMessage({kind: 'skin-reveal-history', jobId,
        url: location.href.split('#')[0], name: document.querySelector('h1')?.textContent?.trim(), points});
    } else if (attempts >= 90) {
      clearInterval(timer);
      chrome.runtime.sendMessage({kind: 'skin-reveal-error', jobId,
        error: '网站页面没有加载出历史走势图；请检查网站安全验证和所选饰品页面'});
    }
  }, 1000);
})();
