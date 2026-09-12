import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Radio,
  RadioGroup,
  Stack,
  TextField,
} from '@mui/material';
import PrintIcon from '@mui/icons-material/Print';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import type { ReceiptDto } from '@shared/api';
import { he } from '../../i18n/he';

export interface ReceiptDialogProps {
  open: boolean;
  receiptId: number | null;
  onClose: () => void;
  onChanged: (message: string) => void;
  /** האם המשתמש רשאי לבטל קבלה (מנהל בלבד). */
  canCancel: boolean;
}

/**
 * F-70..F-73 – תצוגה מקדימה של הקבלה, הפקה/הדפסה חוזרת וביטול.
 * ה-HTML מגיע מה-main (אותה תבנית שממנה נוצר ה-PDF) ומוצג ב-iframe מבודד.
 */
export function ReceiptDialog({
  open,
  receiptId,
  onClose,
  onChanged,
  canCancel,
}: ReceiptDialogProps) {
  const [html, setHtml] = useState('');
  const [receipt, setReceipt] = useState<ReceiptDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [sourceAction, setSourceAction] = useState<'keep' | 'delete'>('keep');

  useEffect(() => {
    if (!open || receiptId === null) return;
    setError(null);
    setCancelling(false);
    setCancelReason('');
    // איפוס לפני הטעינה, אחרת קבלה קודמת נשארת על המסך רגע לפני שהחדשה מגיעה.
    setHtml('');
    setReceipt(null);
    void Promise.all([
      window.api.receipts.previewHtml(receiptId),
      window.api.receipts.get(receiptId),
    ])
      .then(([h, r]) => {
        setHtml(h);
        setReceipt(r);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [open, receiptId]);

  async function doPrint(toPrinter: boolean) {
    if (receiptId === null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await window.api.receipts.print(receiptId, toPrinter);
      setReceipt(res.receipt);
      onChanged(he.receipts.printed(res.pdfPath));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doCancel() {
    if (receiptId === null) return;
    setBusy(true);
    setError(null);
    try {
      await window.api.receipts.cancel(receiptId, cancelReason.trim(), sourceAction);
      onChanged(he.receipts.cancelled_ok);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const isCancelled = receipt?.cancelledAt !== null && receipt?.cancelledAt !== undefined;

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        {he.receipts.preview}
        {receipt ? ` – קבלה מס׳ ${receipt.receiptNumber}` : ''}
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        {error ? (
          <Alert severity="error" sx={{ m: 2 }}>
            {error}
          </Alert>
        ) : null}
        {cancelling ? (
          <Stack spacing={2} sx={{ p: 3 }}>
            <Alert severity="warning">
              ביטול קבלה אינו הפיך. המספר יישאר תפוס ולא יוקצה שוב (B-03).
            </Alert>
            <TextField
              label={he.receipts.cancelReason}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              required
              autoFocus
              multiline
              minRows={2}
            />
            <RadioGroup
              value={sourceAction}
              onChange={(e) => setSourceAction(e.target.value as 'keep' | 'delete')}
            >
              <FormControlLabel
                value="keep"
                control={<Radio />}
                label={he.receipts.cancelKeepSource}
              />
              <FormControlLabel
                value="delete"
                control={<Radio />}
                label={he.receipts.cancelDeleteSource}
              />
            </RadioGroup>
          </Stack>
        ) : (
          <Box sx={{ bgcolor: '#e9edf1', p: 2 }}>
            {/*
              ה-iframe נוצר **רק כשיש HTML**, ועם `key` לפי מספר הקבלה.
              אסור לרנדר אותו עם srcDoc ריק ואז לעדכן: Chromium מנווט את
              המסגרת פעם אחת, בעת היצירה, ושינוי `srcdoc` על מסגרת שכבר
              נטענה לא מרענן אותה – והתצוגה נשארת לבנה לגמרי. ה-`key` מכריח
              יצירת אלמנט חדש לכל קבלה, כדי שאותה מלכודת לא תחזור במעבר
              בין קבלות.

              `sandbox=""` חוסם סקריפטים, טפסים וניווט – ה-HTML הוא שלנו,
              אבל אין סיבה לתת לו יותר ממה שדרוש כדי להיראות.
            */}
            {html === '' ? (
              <Box
                sx={{
                  height: 'min(62vh, 560px)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  bgcolor: '#fff',
                  border: '1px solid #ccc',
                  borderRadius: 1,
                  color: 'text.secondary',
                }}
              >
                {he.app.loading}
              </Box>
            ) : (
              <Box
                component="iframe"
                key={receiptId}
                title="receipt"
                srcDoc={html}
                sandbox=""
                sx={{
                  width: '100%',
                  height: 'min(62vh, 560px)',
                  border: '1px solid #ccc',
                  borderRadius: 1,
                  bgcolor: '#fff',
                }}
              />
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {cancelling ? (
          <>
            <Button onClick={() => setCancelling(false)} disabled={busy}>
              {he.app.back}
            </Button>
            <Button
              color="error"
              variant="contained"
              onClick={() => void doCancel()}
              disabled={busy || cancelReason.trim() === ''}
            >
              {he.receipts.cancelReceipt}
            </Button>
          </>
        ) : (
          <>
            {canCancel && !isCancelled ? (
              <Button color="error" onClick={() => setCancelling(true)} disabled={busy}>
                {he.receipts.cancelReceipt}
              </Button>
            ) : null}
            <Box sx={{ flex: 1 }} />
            <Button onClick={onClose} disabled={busy}>
              {he.app.close}
            </Button>
            <Button
              startIcon={<PictureAsPdfIcon />}
              onClick={() => void doPrint(false)}
              disabled={busy || isCancelled}
            >
              {receipt && receipt.printCount > 0 ? he.receipts.printCopy : he.receipts.print}
            </Button>
            <Button
              variant="contained"
              startIcon={<PrintIcon />}
              onClick={() => void doPrint(true)}
              disabled={busy || isCancelled}
            >
              {he.receipts.print}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
