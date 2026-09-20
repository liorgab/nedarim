import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SaveIcon from '@mui/icons-material/Save';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import type {
  MemberWithBalance,
  MessageTemplateDto,
  TemplateFieldDto,
  TemplateValidationDto,
} from '@shared/api';
import { useAsync } from '../../hooks/useAsync';
import { he } from '../../i18n/he';
import { memberFullName } from '../../lib/format';

export interface TemplatesPageProps {
  onNotify: (message: string) => void;
  canEdit: boolean;
}

/**
 * W-10..W-16 – מסך התבניות.
 *
 * הפריסה: רשימת תבניות מימין, עורך במרכז, תצוגה מקדימה חיה משמאל. התצוגה
 * המקדימה היא העיקר – היא מה שמונע מהגבאי לשלוח 90 הודעות עם שדה שגוי.
 */
export function TemplatesPage({ onNotify, canEdit }: TemplatesPageProps) {
  const [reload, setReload] = useState(0);
  const templates = useAsync<MessageTemplateDto[]>(() => window.api.templates.list(), [reload]);
  const fields = useAsync<TemplateFieldDto[]>(() => window.api.templates.fields(), []);
  const members = useAsync(() => window.api.members.list({}), []);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [previewMemberId, setPreviewMemberId] = useState<number | ''>('');
  const [validation, setValidation] = useState<TemplateValidationDto | null>(null);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const list = useMemo(() => templates.data ?? [], [templates.data]);
  const current = list.find((t) => t.id === selectedId) ?? null;
  const isNew = selectedId === null && (name !== '' || body !== '');

  // בחירת התבנית הראשונה בטעינה, כדי שהמסך לא ייפתח ריק.
  useEffect(() => {
    if (selectedId === null && !isNew && list.length > 0) {
      const first = list[0]!;
      setSelectedId(first.id);
      setName(first.name);
      setBody(first.body);
    }
  }, [list, selectedId, isNew]);

  // חבר ברירת מחדל לתצוגה המקדימה: הראשון עם חוב (W-13).
  useEffect(() => {
    if (previewMemberId !== '') return;
    void window.api.templates.previewMemberId().then((id) => {
      if (id !== null) setPreviewMemberId(id);
    });
  }, [previewMemberId]);

  // ולידציה ותצוגה מקדימה חיות, עם השהיה קצרה כדי לא לפנות ל-main בכל הקלדה.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void window.api.templates.validate(body).then(setValidation);
      if (previewMemberId === '' || body.trim() === '') {
        setPreview('');
        return;
      }
      void window.api.templates
        .render(body, Number(previewMemberId))
        .then(setPreview)
        .catch(() => setPreview(''));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [body, previewMemberId]);

  const select = (t: MessageTemplateDto) => {
    setSelectedId(t.id);
    setName(t.name);
    setBody(t.body);
    setError(null);
  };

  const startNew = () => {
    setSelectedId(null);
    setName('');
    setBody('');
    setError(null);
  };

  const duplicate = (t: MessageTemplateDto) => {
    setSelectedId(null);
    setName(he.whatsapp.templates.copyOf(t.name));
    setBody(t.body);
  };

  /** W-11 – הצ'יפ מכניס את השדה במיקום הסמן, לא בסוף הטקסט. */
  const insertField = (key: string) => {
    const el = bodyRef.current;
    const token = `{{${key}}}`;
    if (!el) {
      setBody((b) => b + token);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? start;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    // מחזירים את הסמן אחרי השדה שהוכנס, כדי שאפשר יהיה להמשיך להקליד.
    window.setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    }, 0);
  };

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await window.api.templates.save({
        ...(selectedId !== null ? { id: selectedId } : {}),
        name,
        body,
      });
      setReload((n) => n + 1);
      onNotify(he.whatsapp.templates.saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(t: MessageTemplateDto): Promise<void> {
    if (!window.confirm(he.whatsapp.templates.removeConfirm(t.name))) return;
    setBusy(true);
    setError(null);
    try {
      await window.api.templates.remove(t.id);
      if (selectedId === t.id) startNew();
      setReload((n) => n + 1);
      onNotify(he.whatsapp.templates.removed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const dirty =
    current === null ? name !== '' || body !== '' : name !== current.name || body !== current.body;
  const canSave = canEdit && dirty && name.trim() !== '' && (validation?.ok ?? false);

  const memberOptions = useMemo(() => (members.data?.rows ?? []).slice(0, 200), [members.data]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 2, flex: 'none' }}
      >
        <Typography variant="h2">{he.whatsapp.templates.title}</Typography>
        <Stack direction="row" spacing={1}>
          <Button startIcon={<AddIcon />} onClick={startNew} disabled={!canEdit}>
            {he.whatsapp.templates.add}
          </Button>
          <Button
            variant="contained"
            startIcon={<SaveIcon />}
            onClick={() => void save()}
            disabled={busy || !canSave}
          >
            {busy ? he.app.saving : he.app.save}
          </Button>
        </Stack>
      </Stack>

      {!canEdit ? (
        <Alert severity="info" sx={{ mb: 2, flex: 'none' }}>
          {he.whatsapp.templates.adminOnly}
        </Alert>
      ) : null}
      {error !== null ? (
        <Alert severity="error" sx={{ mb: 2, flex: 'none' }} onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      <Stack direction="row" spacing={2} sx={{ flex: 1, minHeight: 0 }}>
        {/* רשימת התבניות */}
        <Paper variant="outlined" sx={{ width: 260, flex: 'none', overflow: 'auto' }}>
          {list.length === 0 ? (
            <Typography color="text.secondary" sx={{ p: 2 }}>
              {he.whatsapp.templates.empty}
            </Typography>
          ) : (
            <List dense disablePadding>
              {list.map((t) => (
                <ListItemButton
                  key={t.id}
                  selected={t.id === selectedId}
                  onClick={() => select(t)}
                  sx={{ pr: 1 }}
                >
                  <ListItemText
                    primary={t.name}
                    secondary={t.isActive ? undefined : he.whatsapp.templates.inactive}
                  />
                  <Tooltip title={he.whatsapp.templates.duplicate}>
                    <span>
                      <IconButton aria-label={he.whatsapp.templates.duplicate}
                        size="small"
                        disabled={!canEdit}
                        onClick={(e) => {
                          e.stopPropagation();
                          duplicate(t);
                        }}
                      >
                        <ContentCopyIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title={he.app.actions}>
                    <span>
                      <IconButton aria-label={he.app.actions}
                        size="small"
                        disabled={!canEdit}
                        onClick={(e) => {
                          e.stopPropagation();
                          void remove(t);
                        }}
                      >
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </ListItemButton>
              ))}
            </List>
          )}
        </Paper>

        {/* עורך */}
        <Paper
          variant="outlined"
          sx={{ flex: 1, p: 2, display: 'flex', flexDirection: 'column', minWidth: 0 }}
        >
          <TextField
            label={he.whatsapp.templates.name}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canEdit}
            sx={{ mb: 2 }}
            fullWidth
          />

          <Typography variant="caption" color="text.secondary">
            {he.whatsapp.templates.fields}
          </Typography>
          <Stack direction="row" flexWrap="wrap" useFlexGap spacing={0.5} sx={{ mb: 1, mt: 0.5 }}>
            {(fields.data ?? []).map((f) => (
              <Tooltip key={f.key} title={f.example}>
                <Chip
                  size="small"
                  label={f.label}
                  onClick={() => insertField(f.key)}
                  disabled={!canEdit}
                />
              </Tooltip>
            ))}
          </Stack>

          <TextField
            label={he.whatsapp.templates.body}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={!canEdit}
            multiline
            minRows={10}
            inputRef={bodyRef}
            fullWidth
            sx={{ flex: 1 }}
          />
          <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.5 }}>
            <Typography variant="caption" color="text.secondary">
              {he.whatsapp.templates.charCount(body.length)}
            </Typography>
          </Stack>

          {validation && validation.errors.length > 0 ? (
            <Alert severity="error" sx={{ mt: 1 }}>
              {validation.errors.join(' · ')}
            </Alert>
          ) : null}
          {validation && validation.warnings.length > 0 ? (
            <Alert severity="warning" sx={{ mt: 1 }}>
              {validation.warnings.join(' · ')}
            </Alert>
          ) : null}
        </Paper>

        {/* תצוגה מקדימה חיה */}
        <Paper
          variant="outlined"
          sx={{ width: 340, flex: 'none', p: 2, display: 'flex', flexDirection: 'column' }}
        >
          <Typography variant="h3" sx={{ mb: 1 }}>
            {he.whatsapp.templates.preview}
          </Typography>
          <TextField
            select
            size="small"
            label={he.whatsapp.templates.previewOn}
            value={previewMemberId === '' ? '' : String(previewMemberId)}
            onChange={(e) =>
              setPreviewMemberId(e.target.value === '' ? '' : Number(e.target.value))
            }
            sx={{ mb: 2 }}
          >
            {memberOptions.map((m: MemberWithBalance) => (
              <MenuItem key={m.id} value={String(m.id)}>
                {`${m.memberNumber} · ${memberFullName(m)}`}
              </MenuItem>
            ))}
          </TextField>
          <Divider sx={{ mb: 2 }} />
          {preview === '' ? (
            <Typography color="text.secondary" variant="body2">
              {he.whatsapp.templates.previewEmpty}
            </Typography>
          ) : (
            <Box
              sx={{
                whiteSpace: 'pre-wrap',
                bgcolor: '#dcf8c6',
                borderRadius: 2,
                p: 1.5,
                fontSize: 14,
                lineHeight: 1.6,
                overflow: 'auto',
              }}
            >
              {preview}
            </Box>
          )}
        </Paper>
      </Stack>
    </Box>
  );
}
