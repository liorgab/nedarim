import { useMemo } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import PostAddIcon from '@mui/icons-material/PostAdd';
import PaymentsIcon from '@mui/icons-material/Payments';
import VolunteerActivismIcon from '@mui/icons-material/VolunteerActivism';
import ReceiptIcon from '@mui/icons-material/Receipt';
import type { DashboardDto } from '@shared/api';
import type { MemberWithBalance } from '@shared/types';
import { useAsync } from '../hooks/useAsync';
import { balanceColor, formatAgorot, formatDate } from '../lib/format';
import { he } from '../i18n/he';

export interface DashboardPageProps {
  onOpenMember: (memberId: number) => void;
  onGoTo: (view: 'members' | 'donations' | 'expenses' | 'pending') => void;
  onNewVow: () => void;
  onNewPayment: () => void;
  reloadToken: number;
}

function Card({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'positive' | 'negative';
}) {
  return (
    <Paper variant="outlined" sx={{ p: 2, flex: '1 1 200px', minWidth: 200 }}>
      <Typography variant="caption" color="text.secondary" display="block">
        {label}
      </Typography>
      <Typography
        variant="h1"
        sx={{
          fontSize: '1.6rem',
          color:
            tone === 'negative' ? 'error.main' : tone === 'positive' ? 'success.main' : undefined,
        }}
      >
        {value}
      </Typography>
      {hint ? (
        <Typography variant="caption" color="text.secondary">
          {hint}
        </Typography>
      ) : null}
    </Paper>
  );
}

/** F-01..F-06 – המסך הראשי: תמונת מצב במקום תפריט כפתורים. */
export function DashboardPage({
  onOpenMember,
  onGoTo,
  onNewVow,
  onNewPayment,
  reloadToken,
}: DashboardPageProps) {
  const query = useAsync<DashboardDto>(() => window.api.dashboard.summary(), [reloadToken]);
  const d = query.data;

  const reviewTotal = useMemo(() => {
    if (!d) return 0;
    const r = d.needsReview;
    return r.charges + r.payments + r.donations + r.expenses;
  }, [d]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1, overflow: 'auto' }}>
      <Stack
        direction="row"
        alignItems="baseline"
        justifyContent="space-between"
        sx={{ mb: 2, flex: 'none' }}
        flexWrap="wrap"
        useFlexGap
      >
        <Typography variant="h2">{he.dashboard.title}</Typography>
        {d ? (
          <Typography variant="body2" color="text.secondary">
            {formatDate(d.today.gregorian)} · {d.today.hebrew}
            {d.today.parasha ? ` · ${he.header.parasha}: ${d.today.parasha}` : ''}
          </Typography>
        ) : null}
      </Stack>

      {query.error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {query.error}
        </Alert>
      ) : null}

      {d ? (
        <>
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
            <Card
              label={he.dashboard.openDebt}
              value={formatAgorot(d.cards.openDebtAgorot)}
              hint={he.dashboard.membersWithDebt(d.cards.membersWithDebt)}
              tone={d.cards.openDebtAgorot > 0 ? 'negative' : undefined}
            />
            <Card
              label={he.dashboard.incomeThisMonth}
              value={formatAgorot(d.cards.incomeThisMonthAgorot)}
              hint={`${he.balance.vowPayments}: ${formatAgorot(d.cards.vowPaymentsThisMonthAgorot)} · ${he.balance.donations}: ${formatAgorot(d.cards.donationsThisMonthAgorot)}`}
            />
            <Card
              label={he.dashboard.expensesThisMonth}
              value={formatAgorot(d.cards.expensesThisMonthAgorot)}
            />
            <Card
              label={he.dashboard.netThisMonth}
              value={formatAgorot(d.cards.netThisMonthAgorot)}
              tone={d.cards.netThisMonthAgorot >= 0 ? 'positive' : 'negative'}
            />
            <Card
              label={he.dashboard.cumulative}
              value={formatAgorot(d.cards.cumulativeBalanceAgorot)}
              hint={`${he.dashboard.fiscalYear}: ${formatAgorot(
                d.cards.fiscalYearIncomeAgorot - d.cards.fiscalYearExpensesAgorot,
              )}`}
              tone={d.cards.cumulativeBalanceAgorot >= 0 ? 'positive' : 'negative'}
            />
          </Stack>

          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="h3" sx={{ mb: 1.5 }}>
              {he.dashboard.quickActions}
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button variant="contained" startIcon={<PostAddIcon />} onClick={onNewVow}>
                {he.card.actions.newVow}
              </Button>
              <Button
                variant="contained"
                color="secondary"
                startIcon={<PaymentsIcon />}
                onClick={onNewPayment}
              >
                {he.card.actions.newPayment}
              </Button>
              <Button startIcon={<VolunteerActivismIcon />} onClick={() => onGoTo('donations')}>
                {he.donations.add}
              </Button>
              <Button startIcon={<ReceiptIcon />} onClick={() => onGoTo('expenses')}>
                {he.expenses.add}
              </Button>
            </Stack>
          </Paper>

          {d.pendingReceipts.count > 0 ? (
            <Alert
              severity="warning"
              sx={{ mb: 2 }}
              action={
                <Button size="small" onClick={() => onGoTo('pending')}>
                  {he.nav.pending}
                </Button>
              }
            >
              {he.dashboard.pending}: {d.pendingReceipts.count} ·{' '}
              {formatAgorot(d.pendingReceipts.totalAgorot)}
            </Alert>
          ) : null}

          {reviewTotal > 0 ? (
            <Alert severity="info" sx={{ mb: 2 }}>
              {he.dashboard.needsReview}: {reviewTotal} ·{' '}
              {he.dashboard.needsReviewDetail(
                d.needsReview.charges,
                d.needsReview.payments,
                d.needsReview.donations,
                d.needsReview.expenses,
              )}
            </Alert>
          ) : null}

          <Paper variant="outlined" sx={{ mb: 2 }}>
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              sx={{ px: 2, py: 1.5 }}
            >
              <Typography variant="h3">{he.dashboard.topDebtors}</Typography>
              <Button size="small" onClick={() => onGoTo('members')}>
                {he.nav.members}
              </Button>
            </Stack>
            <Divider />
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 90 }}>{he.members.number}</TableCell>
                  <TableCell>{he.members.firstName}</TableCell>
                  <TableCell sx={{ width: 140, textAlign: 'end' }}>{he.members.balance}</TableCell>
                  <TableCell sx={{ width: 140 }}>{he.members.lastPayment}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {d.topDebtors.map((m: MemberWithBalance) => (
                  <TableRow
                    key={m.id}
                    hover
                    sx={{ cursor: 'pointer' }}
                    onClick={() => onOpenMember(m.id)}
                  >
                    <TableCell>{m.memberNumber}</TableCell>
                    <TableCell>
                      {m.firstName} {m.lastName}
                    </TableCell>
                    <TableCell sx={{ textAlign: 'end' }}>
                      <Typography
                        component="span"
                        sx={{ color: balanceColor(m.balanceAgorot), fontWeight: 600 }}
                      >
                        {formatAgorot(m.balanceAgorot)}
                      </Typography>
                    </TableCell>
                    <TableCell>{formatDate(m.lastPaymentDate) || '—'}</TableCell>
                  </TableRow>
                ))}
                {d.topDebtors.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4}>
                      <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                        {he.table.noRows}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="h3" sx={{ mb: 1.5 }}>
              {he.dashboard.trend}
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {d.trend.map((t) => (
                <Chip
                  key={t.ym}
                  variant="outlined"
                  label={`${t.ym.slice(5)}/${t.ym.slice(2, 4)} · ${formatAgorot(
                    t.incomeAgorot - t.expensesAgorot,
                  )}`}
                  color={t.incomeAgorot - t.expensesAgorot >= 0 ? 'success' : 'error'}
                />
              ))}
              {d.trend.length === 0 ? (
                <Typography color="text.secondary">{he.table.noRows}</Typography>
              ) : null}
            </Stack>
          </Paper>
        </>
      ) : null}
    </Box>
  );
}
