import { useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  IconButton,
  Typography,
} from '@mui/material';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import KeyIcon from '@mui/icons-material/Key';
import BlockIcon from '@mui/icons-material/Block';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import type { AuthUserDto, SessionDto } from '@shared/api';
import type { UserRole } from '@shared/types';
import { useAsync } from '../hooks/useAsync';
import { he } from '../i18n/he';

export interface UsersTabProps {
  session: SessionDto;
  onNotify: (message: string) => void;
}

const ROLES: ReadonlyArray<{ value: UserRole; label: string }> = [
  { value: 'admin', label: he.auth.roles.admin },
  { value: 'clerk', label: he.auth.roles.clerk },
  { value: 'viewer', label: he.auth.roles.viewer },
];

const roleLabel = (role: UserRole): string => ROLES.find((r) => r.value === role)?.label ?? role;

/**
 * SPEC 6.3 – ניהול משתמשים ושינוי סיסמה.
 *
 * המחיקה מכוונת החוצה: משתמש מושבת ולא נמחק, כדי שרשומות ה-audit_log שלו
 * יישארו עם שם ולא עם מזהה יתום.
 */
export function UsersTab({ session, onNotify }: UsersTabProps) {
  const users = useAsync<AuthUserDto[]>(() => window.api.auth.listUsers(), []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [resetFor, setResetFor] = useState<AuthUserDto | null>(null);
  const [changingOwn, setChangingOwn] = useState(false);

  const isAdmin = session.user?.role === 'admin';

  async function run(fn: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const toggleActive = (u: AuthUserDto) =>
    void run(async () => {
      await window.api.auth.updateUser(u.id, { isActive: !u.isActive });
      users.reload();
      onNotify(he.auth.userUpdated);
    });

  const changeRole = (u: AuthUserDto, role: UserRole) =>
    void run(async () => {
      await window.api.auth.updateUser(u.id, { role });
      users.reload();
      onNotify(he.auth.userUpdated);
    });

  return (
    <Stack spacing={2}>
      {error !== null ? (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}
      {!session.loginRequired ? <Alert severity="info">{he.auth.loginDisabledHint}</Alert> : null}
      {!isAdmin ? <Alert severity="warning">{he.auth.adminOnly}</Alert> : null}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="h3">{he.auth.users}</Typography>
          <Stack direction="row" spacing={1}>
            <Button startIcon={<KeyIcon />} onClick={() => setChangingOwn(true)}>
              {he.auth.changePassword}
            </Button>
            <Button
              variant="contained"
              startIcon={<PersonAddIcon />}
              disabled={!isAdmin}
              onClick={() => setAdding(true)}
            >
              {he.auth.addUser}
            </Button>
          </Stack>
        </Stack>

        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{he.auth.username}</TableCell>
              <TableCell>{he.auth.displayName}</TableCell>
              <TableCell sx={{ width: 180 }}>{he.auth.role}</TableCell>
              <TableCell sx={{ width: 130 }}>{he.auth.active}</TableCell>
              <TableCell sx={{ width: 110 }}>{he.app.actions}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(users.data ?? []).map((u) => (
              <TableRow key={u.id} hover>
                <TableCell sx={{ direction: 'ltr', textAlign: 'start' }}>{u.username}</TableCell>
                <TableCell>{u.displayName}</TableCell>
                <TableCell>
                  {isAdmin ? (
                    <TextField
                      select
                      size="small"
                      value={u.role}
                      onChange={(e) => changeRole(u, e.target.value as UserRole)}
                      disabled={busy}
                      sx={{ minWidth: 140 }}
                    >
                      {ROLES.map((r) => (
                        <MenuItem key={r.value} value={r.value}>
                          {r.label}
                        </MenuItem>
                      ))}
                    </TextField>
                  ) : (
                    roleLabel(u.role)
                  )}
                </TableCell>
                <TableCell>
                  <Stack direction="row" spacing={0.5}>
                    <Chip
                      size="small"
                      color={u.isActive ? 'success' : 'default'}
                      label={u.isActive ? he.auth.active : he.auth.inactive}
                    />
                    {u.needsPassword ? (
                      <Chip size="small" color="warning" label={he.auth.needsPassword} />
                    ) : null}
                  </Stack>
                </TableCell>
                <TableCell>
                  <Tooltip title={he.auth.resetPassword}>
                    <span>
                      <IconButton aria-label={he.auth.resetPassword}
                        size="small"
                        disabled={!isAdmin || busy}
                        onClick={() => setResetFor(u)}
                      >
                        <KeyIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title={u.isActive ? he.auth.deactivate : he.auth.activate}>
                    <span>
                      <IconButton aria-label={u.isActive ? he.auth.deactivate : he.auth.activate}
                        size="small"
                        disabled={!isAdmin || busy}
                        onClick={() => toggleActive(u)}
                      >
                        {u.isActive ? (
                          <BlockIcon fontSize="small" />
                        ) : (
                          <CheckCircleOutlineIcon fontSize="small" />
                        )}
                      </IconButton>
                    </span>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <NewUserDialog
        open={adding}
        onClose={() => setAdding(false)}
        onSaved={(name) => {
          setAdding(false);
          users.reload();
          onNotify(he.auth.userAdded(name));
        }}
      />

      <PasswordDialog
        open={resetFor !== null}
        title={resetFor ? he.auth.resetPasswordFor(resetFor.displayName) : ''}
        askCurrent={false}
        onClose={() => setResetFor(null)}
        onSubmit={async (_current, next) => {
          await window.api.auth.resetPassword(resetFor!.id, next);
          setResetFor(null);
          users.reload();
          onNotify(he.auth.passwordReset);
        }}
      />

      <PasswordDialog
        open={changingOwn}
        title={he.auth.changePassword}
        askCurrent
        onClose={() => setChangingOwn(false)}
        onSubmit={async (current, next) => {
          await window.api.auth.changeOwnPassword(current, next);
          setChangingOwn(false);
          users.reload();
          onNotify(he.auth.passwordChanged);
        }}
      />
    </Stack>
  );
}

function NewUserDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (displayName: string) => void;
}) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<UserRole>('clerk');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await window.api.auth.createUser({ username, displayName, role, password });
      onSaved(displayName);
      setUsername('');
      setDisplayName('');
      setPassword('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{he.auth.newUser}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error !== null ? <Alert severity="error">{error}</Alert> : null}
          <TextField
            label={he.auth.username}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            slotProps={{ htmlInput: { dir: 'ltr' } }}
            autoFocus
          />
          <TextField
            label={he.auth.displayName}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <TextField
            select
            label={he.auth.role}
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
          >
            {ROLES.map((r) => (
              <MenuItem key={r.value} value={r.value}>
                {r.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label={he.auth.password}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            slotProps={{ htmlInput: { dir: 'ltr' } }}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{he.app.cancel}</Button>
        <Button
          variant="contained"
          disabled={busy || username.trim() === '' || displayName.trim() === ''}
          onClick={() => void submit()}
        >
          {he.app.save}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function PasswordDialog({
  open,
  title,
  askCurrent,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  askCurrent: boolean;
  onClose: () => void;
  onSubmit: (current: string, next: string) => Promise<void>;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    if (next !== repeat) {
      setError(he.auth.mismatch);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(current, next);
      setCurrent('');
      setNext('');
      setRepeat('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error !== null ? <Alert severity="error">{error}</Alert> : null}
          {askCurrent ? (
            <TextField
              label={he.auth.currentPassword}
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              slotProps={{ htmlInput: { dir: 'ltr' } }}
              autoFocus
            />
          ) : null}
          <TextField
            label={he.auth.newPassword}
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            slotProps={{ htmlInput: { dir: 'ltr' } }}
            autoFocus={!askCurrent}
          />
          <TextField
            label={he.auth.repeatPassword}
            type="password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            error={repeat !== '' && repeat !== next}
            slotProps={{ htmlInput: { dir: 'ltr' } }}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{he.app.cancel}</Button>
        <Button variant="contained" disabled={busy || next === ''} onClick={() => void submit()}>
          {he.app.save}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
