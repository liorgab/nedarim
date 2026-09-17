import { useEffect, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import SystemUpdateAltIcon from '@mui/icons-material/SystemUpdateAlt';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import type { AppInfo } from '@shared/types';
import type { LegalDocIdDto, UpdateCheckDto } from '@shared/api';
import { he } from '../i18n/he';
import { parseMarkdown, type MdBlock } from '../lib/markdownLite';

/**
 * GPLv3 §5 – "Appropriate Legal Notices" בתוך היישום.
 *
 * הטקסטים נקראים מהקבצים שנארזו בהתקנה ולא ממחרוזות ב-`he.ts`: עותק שני
 * בקוד מתיישן בשקט, ודווקא כאן פער בין מה שכתוב לבין מה שמוצג הוא הבעיה
 * עצמה.
 *
 * המסמכים נטענים רק כשפותחים אותם – קובץ הרישיון הוא 674 שורות, ואין
 * סיבה לשלוח אותו דרך ה-IPC בכל פתיחה של מסך ההגדרות.
 */

const DOC_IDS: readonly LegalDocIdDto[] = ['changelog', 'privacy', 'license', 'notices'];

/**
 * הרישיון הוא 674 שורות של טקסט משפטי שנכתב כטקסט רגיל, לא Markdown.
 * פירוק שלו לפסקאות היה הורס את המבנה שלו, ולכן הוא מוצג כפי שהוא.
 */
const PLAIN_TEXT: ReadonlySet<LegalDocIdDto> = new Set<LegalDocIdDto>(['license']);

function block(b: MdBlock, key: number) {
  switch (b.kind) {
    case 'heading':
      return (
        <Typography
          key={key}
          variant={b.level === 1 ? 'h3' : 'subtitle2'}
          sx={{ mt: key === 0 ? 0 : 2, mb: 0.5, fontWeight: 700 }}
        >
          {b.text}
        </Typography>
      );
    case 'list':
      return (
        <Box key={key} component="ul" sx={{ m: 0, mb: 1.5, pr: 3, pl: 0 }}>
          {b.items.map((item, i) => (
            <Typography key={i} component="li" variant="body2" sx={{ mb: 0.25 }}>
              {item}
            </Typography>
          ))}
        </Box>
      );
    case 'pre':
      return (
        <Box
          key={key}
          component="pre"
          sx={{
            m: 0,
            mb: 1.5,
            fontSize: 12,
            lineHeight: 1.7,
            whiteSpace: 'pre-wrap',
            fontFamily: 'monospace',
          }}
        >
          {b.text}
        </Box>
      );
    default:
      return (
        <Typography key={key} variant="body2" sx={{ mb: 1.5, lineHeight: 1.7 }}>
          {b.text}
        </Typography>
      );
  }
}

function UpdateResult({ result }: { result: UpdateCheckDto }) {
  if (!result.ok) {
    return (
      <Alert severity="warning" sx={{ mt: 2 }}>
        {result.message ?? he.app.error}
      </Alert>
    );
  }

  if (result.kind === 'up-to-date') {
    return (
      <Alert severity="success" sx={{ mt: 2 }}>
        {he.about.update.upToDate}
      </Alert>
    );
  }

  if (result.kind === 'none') {
    return (
      <Alert severity="info" sx={{ mt: 2 }}>
        {he.about.update.none}
      </Alert>
    );
  }

  const release = result.release;
  if (release === undefined) return null;

  return (
    <Alert severity="info" sx={{ mt: 2 }}>
      <Typography sx={{ fontWeight: 700, mb: 0.5 }}>
        {he.about.update.available(release.tagName)}
      </Typography>

      {release.body !== '' ? (
        <Box sx={{ maxHeight: 200, overflow: 'auto', mb: 1 }}>
          {parseMarkdown(release.body).map(block)}
        </Box>
      ) : null}

      <Typography variant="body2" sx={{ mb: 0.5 }}>
        {he.about.update.howToInstall}
      </Typography>
      <Typography variant="body2" sx={{ mb: 1.5, fontWeight: 600 }}>
        {he.about.update.backupFirst}
      </Typography>

      {result.kind === 'available-no-installer' ? (
        <Typography variant="body2" sx={{ mb: 1 }}>
          {he.about.update.noInstaller}
        </Typography>
      ) : null}

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {release.installerUrl !== null ? (
          <Button
            size="small"
            variant="contained"
            startIcon={<OpenInNewIcon />}
            onClick={() => void window.api.app.openExternal(release.installerUrl!)}
          >
            {he.about.update.download}
          </Button>
        ) : null}
        <Button
          size="small"
          startIcon={<OpenInNewIcon />}
          onClick={() => void window.api.app.openExternal(release.htmlUrl)}
        >
          {he.about.update.openRelease}
        </Button>
      </Stack>
    </Alert>
  );
}

export interface AboutTabProps {
  onNotify: (message: string) => void;
}

export function AboutTab({ onNotify }: AboutTabProps) {
  const renderDoc = (text: string, id?: LegalDocIdDto) =>
    id !== undefined && PLAIN_TEXT.has(id) ? (
      <Box
        component="pre"
        sx={{ m: 0, fontSize: 12, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
      >
        {text}
      </Box>
    ) : (
      parseMarkdown(text).map(block)
    );

  const [info, setInfo] = useState<AppInfo | null>(null);
  const [open, setOpen] = useState<LegalDocIdDto | null>(null);
  const [texts, setTexts] = useState<Partial<Record<LegalDocIdDto, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateCheckDto | null>(null);
  const [checking, setChecking] = useState(false);

  /**
   * F-115 – בדיקה **יזומה בלבד**. אין `useEffect` שמריץ אותה בעלייה, וזו
   * לא השמטה: המערכת מבטיחה שהיא אינה פונה לאינטרנט מעצמה.
   */
  async function check(): Promise<void> {
    setChecking(true);
    setUpdate(null);
    try {
      setUpdate(await window.api.app.checkForUpdate());
    } catch (e) {
      setUpdate({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    void window.api.app.info().then(setInfo).catch(() => setInfo(null));
  }, []);

  useEffect(() => {
    if (open === null || texts[open] !== undefined) return;
    void window.api.app
      .legalDoc(open)
      .then((doc) => setTexts((prev) => ({ ...prev, [doc.id]: doc.text })))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [open, texts]);

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h3" sx={{ mb: 1 }}>
          {he.about.title}
        </Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
          <Chip size="small" label={`${he.app.version} ${info?.version ?? '—'}`} />
          <Chip size="small" label={`${he.app.schemaVersion} ${info?.schemaVersion ?? '—'}`} />
          <Chip size="small" color="primary" label={he.about.license} />
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-line' }}>
          {he.about.summary}
        </Typography>
        {info !== null ? (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              {he.about.dbPath}
            </Typography>
            <Typography
              variant="body2"
              sx={{ fontFamily: 'monospace', wordBreak: 'break-all', direction: 'ltr', textAlign: 'start' }}
            >
              {info.dbPath}
            </Typography>
          </>
        ) : null}
      </Paper>

      {/*
        בקשת הכותב. ממוקמת אחרי פרטי היישום ולפני הרישוי – מי שהגיע לכאן
        בא לראות "מה זו התוכנה הזו", וזו התשובה האנושית לשאלה.
      */}
      <Paper
        variant="outlined"
        sx={{ p: 2, borderColor: 'primary.light', bgcolor: 'action.hover' }}
      >
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
          <AutoAwesomeIcon fontSize="small" color="primary" />
          <Typography variant="h3">{he.about.blessing.title}</Typography>
        </Stack>

        <Typography variant="body2" sx={{ mb: 1.5, lineHeight: 1.8 }}>
          {he.about.blessing.writtenBy}
        </Typography>
        <Typography variant="body2" sx={{ mb: 2, lineHeight: 1.8 }}>
          {he.about.blessing.request}
        </Typography>

        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="body2" color="text.secondary">
            {he.about.blessing.name}:
          </Typography>
          <Chip color="primary" label={he.about.blessing.nameValue} />
        </Stack>

        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
          sx={{ mt: 1.5 }}
        >
          <Typography variant="body2" color="text.secondary">
            {he.about.blessing.tellMe}
          </Typography>
          <Typography variant="body2" sx={{ direction: 'ltr', fontWeight: 600 }}>
            {he.about.blessing.email}
          </Typography>
          <Button
            size="small"
            startIcon={<ContentCopyIcon fontSize="small" />}
            onClick={() => {
              // העתקה ולא `mailto:`: לא בכל מחשב מוגדרת תוכנת דואר, וקישור
              // שלא עושה כלום גרוע מכתובת שאפשר להדביק.
              void navigator.clipboard.writeText(he.about.blessing.email);
              onNotify(he.about.blessing.copied);
            }}
          >
            {he.about.blessing.copyEmail}
          </Button>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }} flexWrap="wrap" useFlexGap>
          <Button
            variant="contained"
            startIcon={<SystemUpdateAltIcon />}
            disabled={checking}
            onClick={() => void check()}
          >
            {checking ? he.about.update.checking : he.about.update.check}
          </Button>
          {checking ? <CircularProgress size={18} /> : null}
        </Stack>

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          {he.about.update.manualOnly}
        </Typography>

        {update !== null ? <UpdateResult result={update} /> : null}
      </Paper>

      {error !== null ? <Alert severity="error">{error}</Alert> : null}

      <Box>
        {DOC_IDS.map((id) => (
          <Accordion
            key={id}
            expanded={open === id}
            onChange={(_, isOpen) => setOpen(isOpen ? id : null)}
            disableGutters
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography sx={{ fontWeight: 600 }}>{he.about.docs[id]}</Typography>
            </AccordionSummary>
            <AccordionDetails>
              {texts[id] === undefined ? (
                <Stack direction="row" spacing={1} alignItems="center">
                  <CircularProgress size={16} />
                  <Typography variant="body2">{he.app.loading}</Typography>
                </Stack>
              ) : (
                <Box
                  sx={{
                    maxHeight: 420,
                    overflow: 'auto',
                    p: 1.5,
                    bgcolor: 'grey.50',
                    borderRadius: 1,
                    // `plaintext` קובע כיוון לכל פסקה לפי התו החזק הראשון
                    // שלה. הרישיון אנגלי והפרטיות עברית – באותו רכיב.
                    unicodeBidi: 'plaintext',
                    textAlign: 'start',
                  }}
                >
                  {renderDoc(texts[id]!, id)}
                </Box>
              )}
            </AccordionDetails>
          </Accordion>
        ))}
      </Box>

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Button
          startIcon={<FolderOpenIcon />}
          onClick={() => void window.api.app.openAppFolder()}
        >
          {he.about.openFolder}
        </Button>
        {/* F-114 – למשל כשמעבירים את המערכת לבית כנסת אחר. */}
        <Button
          startIcon={<RestartAltIcon />}
          onClick={() =>
            void window.api.configuration.reopenSetup().then(() => onNotify(he.wizard.reopened))
          }
        >
          {he.wizard.reopen}
        </Button>
      </Stack>
    </Stack>
  );
}
