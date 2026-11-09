import { GAME_VERSION } from './model';

// Both entry points share network work and installation state, but only Info
// grants permission to start a download without a separate button click.
export function setupUpdates(notify: (message: string) => void, saveProject: () => void, positionReminder: () => void): void {
  const guide = document.querySelector<HTMLDialogElement>('#guide-dialog')!;
  const versionButton = document.querySelector<HTMLButtonElement>('.status-bar .version')!;
  const section = () => `<div class="version-details"><dl><dt>Current version</dt><dd>v${GAME_VERSION}</dd><dt>Latest version</dt><dd data-latest aria-live="polite">Not checked</dd></dl><p data-download aria-live="polite"></p><button type="button" data-version-action class="primary-button" hidden></button></div>`;
  guide.querySelector('.info-copyright')!.insertAdjacentHTML('beforebegin', section());
  const panel = document.createElement('section');
  panel.id = 'version-panel';
  panel.className = 'version-panel';
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-labelledby', 'version-panel-title');
  panel.hidden = true;
  panel.innerHTML = `<div class="dialog-heading"><h2 id="version-panel-title">App version</h2><button type="button" class="icon-button" aria-label="Close version information">×</button></div>${section()}`;
  document.body.append(panel);
  versionButton.setAttribute('aria-controls', panel.id);
  versionButton.setAttribute('aria-expanded', 'false');
  const closePanel = () => { panel.hidden = true; versionButton.setAttribute('aria-expanded', 'false'); versionButton.focus(); positionReminder(); };
  panel.querySelector('button')!.onclick = closePanel;
  // Escape also closes the panel while the user is working on the canvas.
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden && !document.querySelector('dialog[open]')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closePanel();
    }
  }, true);

  const updateButton = document.createElement('button');
  updateButton.id = 'update-app';
  updateButton.className = 'primary-button';
  updateButton.hidden = true;
  document.body.append(updateButton);
  new MutationObserver(positionReminder).observe(updateButton, { attributes: true, attributeFilter: ['hidden'] });
  let latest: string | undefined;
  let checking = false;
  let checkError = false;
  let downloadError = false;
  let downloading = false;
  let ready = false;
  let activeElsewhere = false;
  let activating = false;
  let checkTask: Promise<void> | undefined;
  let downloadTask: Promise<void> | undefined;
  let registration: ServiceWorkerRegistration | undefined;
  let registrationTask: Promise<ServiceWorkerRegistration | undefined> = Promise.resolve(undefined);
  let updateTimeout: ReturnType<typeof setTimeout> | undefined;
  const supported = import.meta.env.PROD && 'serviceWorker' in navigator;
  const newer = () => {
    if (!latest) return false;
    const currentParts = GAME_VERSION.split('.').map(Number);
    const latestParts = latest.split('.').map(Number);
    // Compare major, minor and patch in order; string ordering puts 0.4.9 above 0.4.73.
    for (let index = 0; index < currentParts.length; index++) {
      if (latestParts[index] !== currentParts[index]) return latestParts[index] > currentParts[index];
    }
    return false;
  };
  const render = () => {
    // Update the two views together so closing one never discards an in-flight result.
    for (const view of document.querySelectorAll<HTMLElement>('.version-details')) {
      view.querySelector('[data-latest]')!.textContent = checking ? 'Checking…' : checkError ? 'Could not check the latest version. Reopen to retry.' : latest ? `v${latest}${newer() ? ' · New version available' : ' · You are up to date'}` : 'Not checked';
      view.querySelector('[data-download]')!.textContent = activating ? 'Activating update…' : ready ? 'Update ready. Reload to use it.' : downloading ? 'Downloading update…' : downloadError ? 'Update could not be downloaded. Please try again.' : newer() && !supported ? 'In-app updates are unavailable in this browser. Reload while online to update.' : '';
      const button = view.querySelector<HTMLButtonElement>('[data-version-action]')!;
      button.hidden = !(ready || (newer() && supported));
      button.disabled = downloading || activating;
      button.textContent = ready ? 'Reload' : downloadError ? 'Retry download' : 'Update';
      button.onclick = () => { if (ready) activate(); else void download(); };
    }
    updateButton.textContent = activeElsewhere ? 'Update active · Reload' : 'Update ready · Reload';
    updateButton.hidden = !ready || activating;
    positionReminder();
  };
  const showUpdate = () => {
    ready = !!registration?.waiting || activeElsewhere;
    render();
  };
  const activate = () => {
    if (activating) return;
    saveProject();
    const waiting = registration?.waiting;
    if (!waiting) { location.reload(); return; }
    activating = true;
    render();
    waiting.postMessage({ type: 'SKIP_WAITING' });
    updateTimeout = setTimeout(() => {
      activating = false;
      if (waiting.state === 'activated' || !registration?.waiting) location.reload();
      else { showUpdate(); notify('Update could not finish. Check your connection and try again.'); }
    }, 8000);
  };
  updateButton.onclick = activate;
  let workerTask: Promise<void> | undefined;
  const checkWorker = (): Promise<void> => {
    if (workerTask) return workerTask;
    if (!registration) return Promise.resolve();
    // Manual downloads join periodic discovery instead of treating a pending
    // discovery as a completed check with no update available.
    workerTask = registration.update().then(() => {}).finally(() => { workerTask = undefined; });
    return workerTask;
  };
  const download = (): Promise<void> => {
    if (downloadTask) return downloadTask;
    downloadError = false;
    downloading = true;
    render();
    downloadTask = (async () => {
      try {
        registration = await registrationTask;
        if (!registration) throw new Error('Service worker unavailable');
        await checkWorker();
        // update() only discovers a worker; wait until its full offline cache
        // has installed before offering Reload. Bound the wait if installation stalls.
        const installing = registration.installing;
        if (installing && installing.state !== 'installed' && installing.state !== 'activated') {
          await new Promise<void>((resolve, reject) => {
            const finish = () => {
              if (installing.state === 'redundant') cleanup(new Error('Installation failed'));
              else if (installing.state === 'installed' || installing.state === 'activated') cleanup();
            };
            const cleanup = (error?: Error) => {
              clearTimeout(timer);
              installing.removeEventListener('statechange', finish);
              if (error) reject(error); else resolve();
            };
            const timer = setTimeout(() => cleanup(new Error('Installation timed out')), 60000);
            installing.addEventListener('statechange', finish);
            finish();
          });
        }
        showUpdate();
        if (!ready) throw new Error('The new release is not ready on the server yet');
      } catch { downloadError = true; }
      finally { downloading = false; downloadTask = undefined; render(); }
    })();
    return downloadTask;
  };
  const check = (automaticDownload: boolean) => {
    if (!checkTask) {
      checking = true;
      checkError = false;
      render();
      checkTask = (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        try {
          const response = await fetch(new URL('version.json', document.baseURI), { cache: 'no-store', signal: controller.signal });
          if (!response.ok) throw new Error('Version request failed');
          const data: unknown = await response.json();
          const version = (data as { version?: unknown } | null)?.version;
          if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid version');
          latest = version;
        } catch { checkError = true; }
        finally { clearTimeout(timer); checking = false; checkTask = undefined; render(); }
      })();
    }
    void checkTask.then(() => { if (automaticDownload && !checkError && newer() && supported && !ready) void download(); });
  };
  versionButton.onclick = () => {
    panel.hidden = false;
    versionButton.setAttribute('aria-expanded', 'true');
    render();
    check(false);
  };
  document.querySelector<HTMLButtonElement>('#guide')!.onclick = () => {
    panel.hidden = true;
    versionButton.setAttribute('aria-expanded', 'false');
    guide.showModal();
    check(true);
  };
  guide.addEventListener('close', positionReminder);

  if (supported) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (activating) { clearTimeout(updateTimeout); location.reload(); }
      else if (hadController) { activeElsewhere = true; showUpdate(); }
    });
    registrationTask = navigator.serviceWorker.register(new URL('sw.js', document.baseURI), { scope: new URL('./', document.baseURI).pathname, updateViaCache: 'none' })
      .then(result => {
        registration = result;
        showUpdate();
        registration.addEventListener('updatefound', () => {
          const installing = registration!.installing;
          installing?.addEventListener('statechange', () => { if (installing.state === 'installed') showUpdate(); });
        });
        setInterval(() => { void checkWorker().catch(() => { /* Offline checks retry on the next interval. */ }); }, 10 * 60 * 1000);
        navigator.serviceWorker.ready.then(() => notify('Game files are ready offline.'));
        return result;
      })
      .catch(() => { notify('Offline setup failed. Reload while connected to try again.'); return undefined; });
  }
}
