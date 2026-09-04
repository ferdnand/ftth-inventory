import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCreatePremises, usePremisesSearch } from '../hooks/useData';
import { useDebounced } from '../hooks/useDebounced';
import { Modal } from '../components/Modal';
import { NumberInput, TextInput } from '../components/fields';
import { EmptyState, ErrorState, LoadingRows } from '../components/states';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../components/Toast';
import { formatPremisesCode, parsePremisesCode } from '../lib/format';

function PremisesFormDialog({ onClose, onCreated }) {
  const create = useCreatePremises();
  const { notify, notifyError } = useToast();
  const [form, setForm] = useState({ address: '', customer_account_id: '', gps_lat: '', gps_lng: '' });
  const [error, setError] = useState(null);
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  async function onSubmit(event) {
    event.preventDefault();
    if (!form.address.trim()) {
      setError('An address is required');
      return;
    }
    try {
      const { premises } = await create.mutateAsync({
        address: form.address.trim(),
        customer_account_id: form.customer_account_id.trim() || undefined,
        gps_lat: form.gps_lat === '' ? undefined : Number(form.gps_lat),
        gps_lng: form.gps_lng === '' ? undefined : Number(form.gps_lng),
      });
      notify(`${premises.address} added`);
      onCreated(premises);
    } catch (err) {
      notifyError(err);
    }
  }

  return (
    <Modal
      title="Add premises"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="premises-form"
            className="btn-primary"
            disabled={create.isPending}
          >
            {create.isPending ? 'Saving…' : 'Add premises'}
          </button>
        </>
      }
    >
      <form id="premises-form" onSubmit={onSubmit}>
        <TextInput
          id="address"
          label="Address"
          value={form.address}
          onChange={set('address')}
          error={error}
          placeholder="14B Ngong Road, Nairobi"
        />
        <TextInput
          id="account"
          label="Customer account"
          value={form.customer_account_id}
          onChange={set('customer_account_id')}
          placeholder="KE-77291"
          hint="The account reference from your billing or OSS system, if there is one."
        />
        <div className="field-row">
          <NumberInput id="lat" label="GPS latitude" value={form.gps_lat} onChange={set('gps_lat')} step="any" />
          <NumberInput id="lng" label="GPS longitude" value={form.gps_lng} onChange={set('gps_lng')} step="any" />
        </div>
      </form>
    </Modal>
  );
}

export function PremisesSearchPage() {
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const [showForm, setShowForm] = useState(false);
  const debounced = useDebounced(term, 300);
  const search = usePremisesSearch(debounced);

  // Typing a PREM-00842 code off a dispatch note jumps straight there. That
  // code is a display format only — it is never sent to the API.
  const codeId = parsePremisesCode(term);
  useEffect(() => {
    if (codeId) navigate(`/premises/${codeId}`);
  }, [codeId, navigate]);

  const tooShort = debounced.trim().length < 2;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Operations"
        title="Premises"
        sub="Find a customer address by street, account reference or PREM code"
        actions={
          <button type="button" className="btn-primary" onClick={() => setShowForm(true)}>
            Add premises
          </button>
        }
      />

      <div className="premise-search">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Ngong Road, KE-77291, or PREM-00001"
          aria-label="Search premises"
          autoFocus
        />
      </div>

      {/* Under two characters the API returns { results: [] } with a 200. That
        * is not "no matches" — showing an empty state there would be wrong. */}
      {tooShort ? (
        <EmptyState title="Type at least 2 characters">
          Search matches the street address and the customer account reference.
        </EmptyState>
      ) : search.isPending ? (
        <LoadingRows rows={3} />
      ) : search.isError ? (
        <ErrorState error={search.error} onRetry={search.refetch} />
      ) : search.data.length === 0 ? (
        <EmptyState
          title="No premises match"
          action={
            <button type="button" className="btn-secondary" onClick={() => setShowForm(true)}>
              Add this address
            </button>
          }
        >
          Nothing found for “{debounced}”.
        </EmptyState>
      ) : (
        <div>
          {search.data.map((row) => (
            <div
              className="result-item"
              key={row.id}
              onClick={() => navigate(`/premises/${row.id}`)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter') navigate(`/premises/${row.id}`);
              }}
            >
              <div className="addr">{row.address}</div>
              <div className="id">
                {formatPremisesCode(row.id)}
                {row.customer_account_id ? ` · ${row.customer_account_id}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm ? (
        <PremisesFormDialog
          onClose={() => setShowForm(false)}
          onCreated={(premises) => navigate(`/premises/${premises.id}`)}
        />
      ) : null}
    </div>
  );
}
