import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCreatePremises, usePremisesList, usePremisesSearch, useSites } from '../hooks/useData';
import { useDebounced } from '../hooks/useDebounced';
import { Modal } from '../components/Modal';
import {
  PremisesFields,
  emptyPremisesForm,
  premisesFormBody,
  premisesFormLocatable,
} from '../components/PremisesFields';
import { EmptyState, ErrorState, LoadingRows } from '../components/states';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../components/Toast';
import { formatPremisesCode, parsePremisesCode } from '../lib/format';

function PremisesFormDialog({ onClose, onCreated, defaultSiteId }) {
  const create = useCreatePremises();
  const { notify, notifyError } = useToast();
  // Adding from a site's list files the new premises under that site.
  const [form, setForm] = useState(() => ({
    ...emptyPremisesForm(),
    site_id: defaultSiteId ? String(defaultSiteId) : '',
  }));
  const [error, setError] = useState(null);
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  async function onSubmit(event) {
    event.preventDefault();
    // Not "an address is required" any more: the rule is that the premises has
    // to be findable again, and a pin or a landmark does that.
    if (!premisesFormLocatable(form)) {
      setError('Give a landmark, an address, or a GPS pin — something that finds the place again');
      return;
    }
    try {
      const { premises } = await create.mutateAsync(premisesFormBody(form));
      notify(`${premises.label} added`);
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
        {error ? <p className="warn-note">{error}</p> : null}
        <PremisesFields form={form} set={set} />
      </form>
    </Modal>
  );
}

// Premises grouped under their site, sites alphabetically and the ones nobody
// has filed under a site last. One list per site is how the office reads this:
// "who do we have in Kisumu", not "everyone, newest first".
function groupBySite(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.site_id ?? 'none';
    if (!groups.has(key)) {
      groups.set(key, { key, name: row.site_name ?? 'No site set', rows: [] });
    }
    groups.get(key).rows.push(row);
  }
  return [...groups.values()].sort((a, b) => {
    if (a.key === 'none') return 1;
    if (b.key === 'none') return -1;
    return a.name.localeCompare(b.name);
  });
}

function PremisesRow({ row, onOpen }) {
  return (
    <div
      className="result-item"
      onClick={() => onOpen(row.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(row.id);
      }}
    >
      <div className="addr">{row.label}</div>
      <div className="id">
        {[
          formatPremisesCode(row.id),
          row.customer_name,
          row.customer_phone,
          row.customer_account_id,
        ]
          .filter(Boolean)
          .join(' · ')}
      </div>
    </div>
  );
}

export function PremisesSearchPage() {
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const [siteFilter, setSiteFilter] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const debounced = useDebounced(term, 300);
  const sites = useSites();

  // Typing a PREM-00842 code off a dispatch note jumps straight there. That
  // code is a display format only — it is never sent to the API.
  const codeId = parsePremisesCode(term);
  useEffect(() => {
    if (codeId) navigate(`/premises/${codeId}`);
  }, [codeId, navigate]);

  // With a term, search (narrowed to the chosen site). Without one, list the
  // site — or every site, grouped — rather than showing an empty page.
  const searching = debounced.trim().length >= 2;
  const search = usePremisesSearch(debounced, siteFilter);
  const browse = usePremisesList(
    { limit: 500, ...(siteFilter ? { site_id: siteFilter } : {}) },
    { enabled: !searching }
  );
  const query = searching ? search : browse;
  const rows = query.data ?? [];
  const groups = groupBySite(rows);
  const open = (id) => navigate(`/premises/${id}`);

  return (
    <div className="page">
      <PageHeader
        eyebrow="Operations"
        title="Premises"
        sub="Every customer premises, listed under the site it belongs to"
        actions={
          <button type="button" className="btn-primary" onClick={() => setShowForm(true)}>
            Add premises
          </button>
        }
      />

      <div className="chip-row">
        <button
          type="button"
          className={`chip ${siteFilter === null ? 'active' : ''}`.trim()}
          onClick={() => setSiteFilter(null)}
        >
          All sites
        </button>
        {(sites.data ?? []).map((site) => (
          <button
            key={site.id}
            type="button"
            className={`chip ${siteFilter === site.id ? 'active' : ''}`.trim()}
            onClick={() => setSiteFilter(site.id)}
          >
            {site.name}
          </button>
        ))}
      </div>

      <div className="premise-search">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Filter by name, village, landmark, phone, account or PREM code"
          aria-label="Search premises"
          autoFocus
        />
      </div>

      {query.isPending ? (
        <LoadingRows rows={3} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={searching ? 'No premises match' : 'No premises recorded here yet'}
          action={
            <button type="button" className="btn-secondary" onClick={() => setShowForm(true)}>
              Add premises
            </button>
          }
        >
          {searching ? `Nothing found for “${debounced}”.` : 'Add the first one to get started.'}
        </EmptyState>
      ) : (
        groups.map((group) => (
          <section key={group.key}>
            <div className="section-label">
              {group.name} · {group.rows.length}
            </div>
            {group.rows.map((row) => (
              <PremisesRow key={row.id} row={row} onOpen={open} />
            ))}
          </section>
        ))
      )}

      {showForm ? (
        <PremisesFormDialog
          defaultSiteId={siteFilter}
          onClose={() => setShowForm(false)}
          onCreated={(premises) => navigate(`/premises/${premises.id}`)}
        />
      ) : null}
    </div>
  );
}
