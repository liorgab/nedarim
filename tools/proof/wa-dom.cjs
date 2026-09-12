/**
 * עזר אבחון: פותח את WhatsApp Web ומדפיס את כל ה-data-testid וה-aria-label
 * שנמצאו בדף, כדי להשוות מול src/main/whatsapp/selectors.ts (WB-06).
 *
 * הרצה:  npx electron tools/proof/wa-dom.cjs out.png
 *
 * חשוב: להריץ עם פרופיל שניתן לכתוב אליו. WhatsApp Web דורש IndexedDB,
 * ובתיקייה חסומה הוא נתקע על מסך הפתיחה.
 */
const { app, BrowserWindow, session } = require('electron');
const { writeFileSync } = require('fs');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

app.whenReady().then(async () => {
  const part = session.fromPartition('persist:waprobe');
  part.setUserAgent(UA);
  const w = new BrowserWindow({
    width: 1100, height: 800, show: false,
    webPreferences: { partition: 'persist:waprobe', contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  w.webContents.setUserAgent(UA);
  w.webContents.on('did-finish-load', () => console.log('[did-finish-load]'));
  w.webContents.on('did-fail-load', (_e, code, desc) => console.log('[did-fail-load]', code, desc));
  // לא ממתינים – WhatsApp Web ממשיך לטעון משאבים ו-loadURL לא נפתר
  w.loadURL('https://web.whatsapp.com').catch((e) => console.log('[loadURL rejected]', e.message));

  for (const wait of [8000, 8000, 8000]) {
    await new Promise((r) => setTimeout(r, wait));
    try {
      const info = await w.webContents.executeJavaScript(`(() => ({
        url: location.href,
        title: document.title,
        text: document.body ? document.body.innerText.slice(0, 300) : '(no body)',
        canvases: document.querySelectorAll('canvas').length,
        testids: [...new Set([...document.querySelectorAll('[data-testid]')].map(e => e.getAttribute('data-testid')))].slice(0, 30),
        hasQrTestid: document.querySelector('[data-testid="qrcode"]') !== null,
        hasPaneSide: document.querySelector('#pane-side') !== null,
        ariaLabels: [...new Set([...document.querySelectorAll('[aria-label]')].map(e => e.getAttribute('aria-label')))].slice(0, 20),
      }))()`, true);
      console.log('=== ' + JSON.stringify(info));
    } catch (e) { console.log('=== probe error:', e.message); }
  }
  if (process.argv[2]) writeFileSync(process.argv[2], (await w.webContents.capturePage()).toPNG());
  app.exit(0);
});
