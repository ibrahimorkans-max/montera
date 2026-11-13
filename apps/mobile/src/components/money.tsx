import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useTheme, useToast } from '@/lib/app-context';
import { api } from '@/lib/api';
import { newKey } from '@/lib/invoice-draft';
import { ACCOUNT_TYPE_LABELS, CURRENCIES, moneyToInput, parseMoney, type AccountType, type MoneyAccount } from '@/lib/shared';
import { Btn, DateField, Field, Notice, Row, Select, Sheet, Txt, addDays, fm, isDate, todayStr, type IconName } from './ui';

export const ACCOUNT_ICONS: Record<AccountType, IconName> = { cash: 'cash-outline', bank: 'business-outline', wallet: 'phone-portrait-outline' };

export function AccountSelect({ label = 'Account', accounts, value, onChange, error }: { label?: string; accounts: MoneyAccount[]; value: string; onChange: (id: string) => void; error?: string }) {
  const current = accounts.find((a) => a.id === value);
  return (
    <Select
      label={label}
      value={current ? `${current.name} · ${fm(current.balance, current)}` : ''}
      placeholder="Default for the payment method"
      items={accounts}
      getKey={(a) => a.id}
      getLabel={(a) => a.name}
      getSub={(a) => `${ACCOUNT_TYPE_LABELS[a.type]} · ${a.currency} · balance ${fm(a.balance, a)}`}
      onSelect={(a) => onChange(a.id)}
      error={error}
    />
  );
}

export function CurrencySelect({ label = 'Currency', value, onChange }: { label?: string; value: string; onChange: (code: string) => void }) {
  return (
    <Select
      label={label}
      value={value}
      placeholder="Choose currency"
      items={CURRENCIES}
      getKey={(c) => c.code}
      getLabel={(c) => `${c.code} · ${c.name}`}
      onSelect={(c) => onChange(c.code)}
    />
  );
}

export function AccountIcon({ type, size = 40 }: { type: AccountType; size?: number }) {
  const t = useTheme();
  const tone = { cash: [t.successSoft, t.success], bank: [t.infoSoft, t.info], wallet: [t.warnSoft, t.warn] }[type];
  return (
    <View style={{ width: size, height: size, borderRadius: size / 3, backgroundColor: tone[0], alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={ACCOUNT_ICONS[type]} size={size * 0.48} color={tone[1]} />
    </View>
  );
}

/** Move money between two accounts of the same business, e.g. depositing cash in the bank. */
export function TransferSheet({ visible, onClose, accounts, onDone, fromId }: { visible: boolean; onClose: () => void; accounts: MoneyAccount[]; onDone: () => void; fromId?: string }) {
  const toast = useToast();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [toAmount, setToAmount] = useState('');
  const [date, setDate] = useState(todayStr());
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const requestId = useRef(`tr-${newKey()}`);

  useEffect(() => {
    if (!visible) return;
    requestId.current = `tr-${newKey()}`;
    const cash = accounts.find((a) => a.type === 'cash');
    const first = fromId ? accounts.find((a) => a.id === fromId) : cash;
    setFrom(first?.id ?? '');
    setTo(accounts.find((a) => a.businessId === first?.businessId && a.id !== first?.id && a.type === 'bank')?.id ?? '');
    setAmount('');
    setToAmount('');
    setDate(todayStr());
    setReference('');
  }, [visible, accounts, fromId]);

  const a = accounts.find((x) => x.id === from);
  const b = accounts.find((x) => x.id === to);
  const sameCurrency = !a || !b || a.currency === b.currency;

  async function save() {
    if (!a || !b) return toast('Choose both accounts', 'error');
    const value = parseMoney(amount, a.currencyPrecision);
    if (!value || value <= 0) return toast('Enter the amount', 'error');
    const arriving = sameCurrency ? value : parseMoney(toAmount, b.currencyPrecision);
    if (!arriving || arriving <= 0) return toast(`Enter how much arrives in ${b.currency}`, 'error');
    if (!isDate(date)) return toast('Enter a valid date', 'error');
    setBusy(true);
    try {
      await api('/transfers', { body: { fromAccountId: a.id, toAccountId: b.id, amount: value, toAmount: arriving, date, reference: reference.trim(), notes: '', clientRequestId: requestId.current } });
      toast(`Moved ${fm(value, a)} to ${b.name}`);
      onDone();
      onClose();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet visible={visible} title="Transfer between accounts" onClose={onClose}>
      <AccountSelect label="From" accounts={accounts} value={from} onChange={(id) => (setFrom(id), id === to && setTo(''))} />
      <View style={{ alignItems: 'center' }}>
        <Ionicons name="arrow-down-circle" size={28} color={useTheme().primary} />
      </View>
      <AccountSelect label="To" accounts={accounts.filter((x) => x.id !== from && (!a || x.businessId === a.businessId))} value={to} onChange={setTo} />
      {a && <Txt v="small">Available in {a.name}: {fm(a.balance, a)}</Txt>}
      <Field label={`Amount${a ? ` (${a.currency})` : ''}`} money placeholder="0" value={amount} onChangeText={setAmount} />
      {!sameCurrency && b && <Field label={`Amount arriving (${b.currency})`} money placeholder="0" value={toAmount} onChangeText={setToAmount} hint="The two accounts use different currencies" />}
      <DateField label="Date" value={date} onChange={setDate} quick={[{ label: 'Today', value: todayStr() }, { label: 'Yesterday', value: addDays(todayStr(), -1) }]} />
      <Field label="Reference (optional)" value={reference} onChangeText={setReference} placeholder="Deposit slip, cheque or transaction no." />
      {a && parseMoney(amount, a.currencyPrecision)! > a.balance && <Notice kind="warn">This is more than {a.name} holds. It will show a negative balance.</Notice>}
      <Btn icon="swap-vertical-outline" title="Transfer" onPress={save} loading={busy} />
    </Sheet>
  );
}

export { moneyToInput };
export const accountKindLabel = (t: AccountType) => ACCOUNT_TYPE_LABELS[t];
export { Row };
