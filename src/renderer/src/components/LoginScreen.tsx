import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';
import type { LoginResultDto, SessionDto } from '@shared/api';
import { he } from '../i18n/he';

export interface LoginScreenProps {
  session: SessionDto;
  synagogueName: string;
  onSession: (session: SessionDto) => void;
}

/**
 * מסך הכניסה, שמשמש גם כמסך נעילה. הוא נפרש על כל היישום כשאין משתמש מחובר
 * או כשהמסך ננעל, כך שאין דרך לעקוף אותו דרך ניווט ב-hash.
 *
 * התקנה טרייה מגיעה עם משתמש מנהל בלי סיסמה. במקרה כזה הכניסה עוברת מייד
 * לקביעת סיסמה, במקום לחסום את הגבאי מחוץ למערכת שלו.
 */
export function LoginScreen({ session, synagogueName, onSession }: LoginScreenProps) {
  const locked = session.user !== null;
  const [username, setUsername] = useState(session.user?.username ?? 'admin');
  const [password, setPassword] = useState('');
  const [stage, setStage] = useState<'login' | 'setPassword'>('login');
  const [newPassword, setNewPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstField.current?.focus();
  }, [stage]);

  const apply = (res: LoginResultDto) => {
    if (res.needsPassword) {
      setStage('setPassword');
      setError(null);
      return;
    }
    if (!res.ok) {
      setError(res.message ?? he.app.error);
      return;
    }
    onSession(res.session);
  };

  async function submitLogin() {
    setBusy(true);
    setError(null);
    try {
      apply(await window.api.auth.login(username.trim(), password));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setPassword('');
    }
  }

  async function submitNewPassword() {
    if (newPassword !== repeat) {
      setError(he.auth.mismatch);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onSession((await window.api.auth.setInitialPassword(username.trim(), newPassword)).session);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const submit = () => void (stage === 'login' ? submitLogin() : submitNewPassword());

  return (
    <Box
      sx={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
      }}
    >
      <Paper elevation={3} sx={{ p: 4, width: 380 }}>
        <Stack
          spacing={2}
          component="form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Stack direction="row" spacing={1} alignItems="center">
            <LockIcon color="primary" />
            <Typography variant="h2" sx={{ fontSize: '1.25rem' }}>
              {stage === 'setPassword'
                ? he.auth.setPasswordTitle
                : locked
                  ? he.auth.lockedTitle
                  : he.auth.loginTitle}
            </Typography>
          </Stack>
          {synagogueName ? (
            <Typography variant="body2" color="text.secondary">
              {synagogueName}
            </Typography>
          ) : null}

          {stage === 'setPassword' ? (
            <Alert severity="info">{he.auth.setPasswordHint}</Alert>
          ) : null}
          {error ? <Alert severity="error">{error}</Alert> : null}

          <TextField
            label={he.auth.username}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={locked || stage === 'setPassword'}
            inputRef={stage === 'login' && !locked ? firstField : undefined}
            slotProps={{ htmlInput: { dir: 'ltr' } }}
            fullWidth
          />

          {stage === 'login' ? (
            <TextField
              label={he.auth.password}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              inputRef={locked ? firstField : undefined}
              slotProps={{ htmlInput: { dir: 'ltr' } }}
              fullWidth
            />
          ) : (
            <>
              <TextField
                label={he.auth.newPassword}
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                inputRef={firstField}
                slotProps={{ htmlInput: { dir: 'ltr' } }}
                fullWidth
              />
              <TextField
                label={he.auth.repeatPassword}
                type="password"
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
                error={repeat !== '' && repeat !== newPassword}
                slotProps={{ htmlInput: { dir: 'ltr' } }}
                fullWidth
              />
            </>
          )}

          <Button type="submit" variant="contained" size="large" disabled={busy}>
            {stage === 'setPassword'
              ? he.auth.setPassword
              : locked
                ? he.auth.unlock
                : he.auth.login}
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}
