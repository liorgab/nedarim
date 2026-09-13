import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  AppBar,
  Box,
  Chip,
  Container,
  IconButton,
  Snackbar,
  Stack,
  Tab,
  Tabs,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';
import LogoutIcon from '@mui/icons-material/Logout';
import type { AppInfo, HebrewDateInfo, MemberWithBalance } from '@shared/types';
import type { SessionDto } from '@shared/api';
import { he } from './i18n/he';
import { todayIso } from './lib/format';
import { DashboardPage } from './pages/DashboardPage';
import { MembersPage } from './pages/MembersPage';
import { MemberCardPage } from './pages/MemberCardPage';
import { DonationsPage } from './pages/DonationsPage';
import { ExpensesPage } from './pages/ExpensesPage';
import { BalancePage } from './pages/BalancePage';
import { ReportsPage } from './pages/ReportsPage';
import { CalendarPage } from './pages/CalendarPage';
import { SetupWizard } from './components/SetupWizard';
import { ImportWizard } from './components/import/ImportWizard';
import { ReceiptsPage } from './pages/ReceiptsPage';
import { PendingReceiptsPage } from './pages/PendingReceiptsPage';
import { SettingsPage } from './pages/SettingsPage';
import { AuditPage } from './pages/AuditPage';
import { WhatsAppPage } from './pages/whatsapp/WhatsAppPage';
import { LoginScreen } from './components/LoginScreen';
import { ConnectionBadge } from './components/whatsapp/ConnectionBadge';
import { useWhatsAppStatus } from './hooks/useWhatsAppStatus';
import { ReceiptDialog } from './components/dialogs/ReceiptDialog';
import { VowDialog } from './components/dialogs/VowDialog';
import { PaymentDialog } from './components/dialogs/PaymentDialog';
import { useAsync } from './hooks/useAsync';
import { verifyApiSurface } from './lib/apiSurface';

type TabName =
  | 'dashboard'
  | 'members'
  | 'donations'
  | 'expenses'
  | 'receipts'
  | 'pending'
  | 'balance'
  | 'reports'
  | 'calendar'
  | 'audit'
  | 'whatsapp'
  | 'settings';

type View =
  | { name: TabName }
  | { name: 'card'; memberId: number }
  | { name: 'settings'; tab: string }
  /** `#/receipt/452` – פותח את ספר הקבלות עם הקבלה פתוחה לתצוגה מקדימה. */
  | { name: 'receipts'; receiptId: number };

const TABS: ReadonlyArray<{ id: TabName; label: string }> = [
  { id: 'dashboard', label: he.nav.dashboard },
  { id: 'members', label: he.nav.members },
  { id: 'donations', label: he.nav.donations },
  { id: 'expenses', label: he.nav.expenses },
  { id: 'balance', label: he.nav.balance },
  { id: 'reports', label: he.nav.reports },
  { id: 'calendar', label: he.calendar.nav },
  { id: 'receipts', label: he.nav.receipts },
  { id: 'pending', label: he.nav.pending },
  { id: 'whatsapp', label: he.nav.whatsapp },
  { id: 'audit', label: he.nav.audit },
  { id: 'settings', label: he.nav.settings },
];

/** ניתוב מינימלי לפי hash: `#/members`, `#/card/12`, `#/settings` וכו'. */
function viewFromHash(): View {
  const card = /^#\/card\/(\d+)$/.exec(window.location.hash);
  if (card) return { name: 'card', memberId: Number(card[1]) };
  const settings = /^#\/settings\/(\w+)$/.exec(window.location.hash);
  if (settings) return { name: 'settings', tab: settings[1]! };
  const receipt = /^#\/receipt\/(\d+)$/.exec(window.location.hash);
  if (receipt) return { name: 'receipts', receiptId: Number(receipt[1]) };
  const name = window.location.hash.replace('#/', '');
  if (TABS.some((t) => t.id === name)) return { name: name as TabName };
  return { name: 'dashboard' };
}

export default function App() {
  const [view, setView] = useState<View>(viewFromHash);
  const [notice, setNotice] = useState<string | null>(null);
  const [receiptId, setReceiptId] = useState<number | null>(null);
  const [dialog, setDialog] = useState<'vow' | 'payment' | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [session, setSession] = useState<SessionDto | null>(null);

  /**
   * ה-preload נטען פעם אחת בפתיחת החלון, בעוד שה-renderer מתרענן בחם.
   * אחרי הוספת ערוץ, אפליקציה שכבר רצה ממשיכה עם preload ישן – והתקלה
   * מתגלה רק כשלוחצים על הכפתור החדש. עדיף לומר את זה מראש.
   */
  const [apiSurface] = useState(() => verifyApiSurface(window.api));

  const info = useAsync<AppInfo>(() => window.api.app.info(), []);

  // מצב ההתחברות נטען פעם אחת; אחרי כל התחברות/נעילה ה-main מחזיר מצב מעודכן.
  useEffect(() => {
    void window.api.auth.session().then(setSession);
  }, []);
  const hebrew = useAsync<HebrewDateInfo>(() => window.api.calendar.forDate(todayIso()), []);
  const parasha = useAsync(() => window.api.calendar.defaultOccasionForDate(todayIso()), []);
  const config = useAsync(() => window.api.configuration.get(), [reloadToken]);
  const waModule = useAsync(() => window.api.whatsapp.moduleState(), [reloadToken]);
  const waStatus = useWhatsAppStatus();

  /**
   * F-110 – אשף ההתקנה. נפתח כל עוד `setup_completed_at` ריק, ולא לפי
   * שם בית הכנסת: גבאי שמילא רק את השם נחשב קודם "מוגדר" ולא נשאל על
   * מספר הקבלה הראשון – טעות שאי אפשר לתקן בדיעבד.
   */
  const wizard = useAsync(() => window.api.configuration.wizardState(), [reloadToken]);
  const [wizardOpen, setWizardOpen] = useState(false);
  /**
   * F-121 – בהתקנה חדשה אשף הייבוא הוא **המשך** של אשף ההתקנה, ונפתח
   * מיד אחריו. הגבאי שסיים להגדיר עומד מול מערכת ריקה, וזה הרגע שבו
   * הנתונים שלו נכנסים – לא תפריט שהוא יחפש בהמשך.
   */
  const [importOpen, setImportOpen] = useState(false);
  useEffect(() => {
    if (wizard.data?.completed === false) setWizardOpen(true);
  }, [wizard.data]);

  useEffect(() => {
    if (view.name === 'receipts' && 'receiptId' in view) setReceiptId(view.receiptId);
  }, [view]);

  useEffect(() => {
    const onHash = () => setView(viewFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  /**
   * נעילה אוטומטית אחרי חוסר פעילות. פעילה רק כשנדרשת התחברות וכשההגדרה
   * `idle_lock_minutes` גדולה מאפס – הגבאי הבודד על מחשב ביתי לא רוצה מסך
   * שננעל עליו כל רבע שעה, ולכן זו בחירה שלו ולא כפייה (CLAUDE.md כלל 12).
   */
  const minutes = session?.idleLockMinutes ?? 0;
  const lockActive = session?.loginRequired === true && session.authenticated && minutes > 0;
  useEffect(() => {
    if (!lockActive) return undefined;
    let timer = 0;
    const lock = () => {
      void window.api.auth.lock().then(setSession);
    };
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(lock, minutes * 60_000);
    };
    const events = ['mousedown', 'keydown', 'wheel', 'touchstart'] as const;
    for (const e of events) window.addEventListener(e, reset, { passive: true });
    reset();
    return () => {
      window.clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, reset);
    };
  }, [lockActive, minutes]);

  // Esc סוגר את הכרטיסייה וחוזר לרשימה (ניווט מקלדת)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && view.name === 'card' && receiptId === null && dialog === null) {
        setView({ name: 'members' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, receiptId, dialog]);

  const openCard = useCallback(
    (m: MemberWithBalance) => setView({ name: 'card', memberId: m.id }),
    [],
  );
  const openMemberById = useCallback((id: number) => setView({ name: 'card', memberId: id }), []);
  const openReceipt = useCallback((id: number) => setReceiptId(id), []);
  const bumpReload = useCallback(() => setReloadToken((t) => t + 1), []);

  const tabValue: TabName = view.name === 'card' ? 'members' : view.name;
  const synagogueName = config.data?.settings['synagogue_name'] ?? '';

  // מסך הכניסה נפרש על כל היישום, כך שאין דרך לעקוף אותו דרך ניווט ב-hash.
  if (session !== null && session.loginRequired && !session.authenticated) {
    return <LoginScreen session={session} synagogueName={synagogueName} onSession={setSession} />;
  }

  return (
    <Box
      sx={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        bgcolor: 'background.default',
      }}
    >
      <AppBar position="static" color="primary" sx={{ flex: 'none' }}>
        <Toolbar variant="dense">
          <Stack direction="row" alignItems="baseline" spacing={1.5} sx={{ flexGrow: 1 }}>
            <Typography variant="h1" component="span" sx={{ fontSize: '1.3rem' }}>
              {he.app.name}
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.85 }}>
              {synagogueName || he.app.tagline}
            </Typography>
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center">
            {hebrew.data ? (
              <Chip
                size="small"
                color="secondary"
                label={`${he.header.today}: ${hebrew.data.hebrew}`}
              />
            ) : null}
            <Chip
              size="small"
              variant="outlined"
              sx={{ color: 'common.white', borderColor: 'rgba(255,255,255,.5)' }}
              label={`${he.header.parasha}: ${parasha.data?.name ?? he.header.noParasha}`}
            />
            {/* שם החג בעברית ישירות מ-hebcal. מוצג רק כשיש חג באותו יום. */}
            {hebrew.data?.holiday ? (
              <Chip size="small" color="warning" label={hebrew.data.holiday} />
            ) : null}
            {/* W-52 – מוצג רק כשהמודול דלוק. */}
            {waModule.data?.enabled === true ? <ConnectionBadge status={waStatus} /> : null}
            {session?.user ? (
              <Chip
                size="small"
                variant="outlined"
                sx={{ color: 'common.white', borderColor: 'rgba(255,255,255,.5)' }}
                label={session.user.displayName}
              />
            ) : null}
            {session?.loginRequired ? (
              <>
                <Tooltip title={he.auth.lock}>
                  <IconButton aria-label={he.auth.lock}
                    size="small"
                    color="inherit"
                    onClick={() => void window.api.auth.lock().then(setSession)}
                  >
                    <LockIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title={he.auth.logout}>
                  <IconButton aria-label={he.auth.logout}
                    size="small"
                    color="inherit"
                    onClick={() => void window.api.auth.logout().then(setSession)}
                  >
                    <LogoutIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </>
            ) : null}
          </Stack>
        </Toolbar>
        <Tabs
          value={tabValue}
          onChange={(_, v: TabName) => setView({ name: v })}
          textColor="inherit"
          indicatorColor="secondary"
          variant="scrollable"
          scrollButtons="auto"
          sx={{ px: 2, bgcolor: 'rgba(0,0,0,.12)', minHeight: 42 }}
        >
          {TABS.map((t) => (
            <Tab key={t.id} value={t.id} label={t.label} sx={{ minHeight: 42, py: 0 }} />
          ))}
        </Tabs>
      </AppBar>

      <Container
        maxWidth={false}
        sx={{
          py: 2,
          maxWidth: 1600,
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {!apiSurface.ok ? (
          <Alert severity="error" sx={{ mb: 2, flex: 'none' }}>
            {he.app.staleBuild}
            <br />
            <Typography variant="caption">
              {he.app.staleBuildDetail(apiSurface.missing.slice(0, 5).join(', '))}
            </Typography>
          </Alert>
        ) : null}

        {info.error ? (
          <Alert severity="error" sx={{ mb: 2, flex: 'none' }}>
            {info.error}
          </Alert>
        ) : null}

        {config.data?.isFirstRun && view.name !== 'settings' ? (
          <Alert
            severity="warning"
            sx={{ mb: 2, flex: 'none', cursor: 'pointer' }}
            onClick={() => setView({ name: 'settings' })}
          >
            {he.settings.firstRunBanner}
          </Alert>
        ) : null}

        {view.name === 'dashboard' ? (
          <DashboardPage
            reloadToken={reloadToken}
            onOpenMember={openMemberById}
            onGoTo={(v) => setView({ name: v })}
            onNewVow={() => setDialog('vow')}
            onNewPayment={() => setDialog('payment')}
          />
        ) : null}

        {view.name === 'members' ? (
          <MembersPage onOpenCard={openCard} onNotify={setNotice} />
        ) : null}

        {view.name === 'card' ? (
          <MemberCardPage
            memberId={view.memberId}
            onBack={() => setView({ name: 'members' })}
            onOpenReceipt={openReceipt}
            onNotify={setNotice}
          />
        ) : null}

        {view.name === 'donations' ? (
          <DonationsPage onOpenReceipt={openReceipt} onNotify={setNotice} />
        ) : null}

        {view.name === 'expenses' ? <ExpensesPage onNotify={setNotice} /> : null}

        {view.name === 'balance' ? <BalancePage /> : null}

        {view.name === 'reports' ? <ReportsPage onNotify={setNotice} /> : null}

        {view.name === 'calendar' ? <CalendarPage onNotify={setNotice} /> : null}

        {view.name === 'receipts' ? (
          <ReceiptsPage onOpenReceipt={openReceipt} reloadToken={reloadToken} />
        ) : null}

        {view.name === 'pending' ? (
          <PendingReceiptsPage
            onOpenReceipt={openReceipt}
            onOpenMember={openMemberById}
            onNotify={setNotice}
          />
        ) : null}

        {view.name === 'audit' ? <AuditPage onNotify={setNotice} /> : null}

        {view.name === 'whatsapp' ? (
          <WhatsAppPage
            onNotify={setNotice}
            isAdmin={session?.user?.role === 'admin' || session?.loginRequired === false}
            onGoToSettings={() => setView({ name: 'settings' })}
          />
        ) : null}

        {view.name === 'settings' && session !== null ? (
          <SettingsPage
            onNotify={setNotice}
            onChanged={bumpReload}
            session={session}
            initialTab={'tab' in view ? view.tab : undefined}
          />
        ) : null}
      </Container>

      <ReceiptDialog
        open={receiptId !== null}
        receiptId={receiptId}
        canCancel={session?.user?.role === 'admin'}
        onClose={() => setReceiptId(null)}
        onChanged={(msg) => {
          setNotice(msg);
          bumpReload();
        }}
      />

      <VowDialog
        open={dialog === 'vow'}
        mode="single"
        onClose={() => setDialog(null)}
        onSaved={(msg) => {
          setNotice(msg);
          bumpReload();
        }}
      />

      <PaymentDialog
        open={dialog === 'payment'}
        onClose={() => setDialog(null)}
        onSaved={(msg, id) => {
          setNotice(msg);
          bumpReload();
          if (id !== null) openReceipt(id);
        }}
      />

      <Snackbar
        open={notice !== null}
        autoHideDuration={6000}
        onClose={() => setNotice(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" onClose={() => setNotice(null)} sx={{ width: '100%' }}>
          {notice}
        </Alert>
      </Snackbar>
      {config.data !== null && config.data !== undefined ? (
        <SetupWizard
          open={wizardOpen}
          config={config.data}
          onDone={() => {
            setWizardOpen(false);
            setReloadToken((t) => t + 1);
            setNotice(he.wizard.done);
            setImportOpen(true);
          }}
        />
      ) : null}

      <ImportWizard
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => {
          setReloadToken((t) => t + 1);
          setNotice(he.importer.summaryTitle);
        }}
      />

    </Box>
  );
}
