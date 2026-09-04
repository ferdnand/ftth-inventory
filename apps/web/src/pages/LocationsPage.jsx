import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useCreateLocation, useLocations, useStockByLocation, useUsers } from '../hooks/useData';
import { DataTable } from '../components/DataTable';
import { Badge } from '../components/Badge';
import { Modal } from '../components/Modal';
import { Select, TextInput } from '../components/fields';
import { EmptyState, ErrorState, LoadingRows } from '../components/states';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../components/Toast';
import { LOCATION_TYPES, label } from '../lib/constants';

function LocationFormDialog({ onClose }) {
  const create = useCreateLocation();
  const techs = useUsers({ role: 'field_tech', is_active: true });
  const { notify, notifyError } = useToast();

  const [form, setForm] = useState({ name: '', type: 'warehouse', tech_id: '', address: '' });
  const [errors, setErrors] = useState({});
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  async function onSubmit(event) {
    event.preventDefault();
    const next = {};
    if (!form.name.trim()) next.name = 'Required';
    // A van with no tech is unreachable: the mobile app finds "my stock" through
    // the tech's assigned_location_id.
    if (form.type === 'tech_van' && !form.tech_id) next.tech_id = 'A van needs a tech';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    try {
      await create.mutateAsync({
        name: form.name.trim(),
        type: form.type,
        tech_id: form.type === 'tech_van' ? Number(form.tech_id) : undefined,
        address: form.address.trim() || undefined,
      });
      notify(`${form.name.trim()} created`);
      onClose();
    } catch (err) {
      notifyError(err);
    }
  }

  return (
    <Modal
      title="New location"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="location-form"
            className="btn-primary"
            disabled={create.isPending}
          >
            {create.isPending ? 'Saving…' : 'Create location'}
          </button>
        </>
      }
    >
      <form id="location-form" onSubmit={onSubmit}>
        <TextInput
          id="name"
          label="Name"
          value={form.name}
          onChange={set('name')}
          error={errors.name}
          placeholder="Tech Van MW-02"
        />
        <Select
          id="type"
          label="Type"
          value={form.type}
          onChange={set('type')}
          options={LOCATION_TYPES.map((t) => ({ value: t, label: label(t) }))}
        />
        {form.type === 'tech_van' ? (
          <Select
            id="tech_id"
            label="Assigned tech"
            value={form.tech_id}
            onChange={set('tech_id')}
            error={errors.tech_id}
            placeholder={techs.isPending ? 'Loading…' : 'Choose a tech'}
            options={(techs.data ?? []).map((u) => ({ value: String(u.id), label: u.name }))}
            hint="Also set this van as the tech's assigned location under Users, or their app will show an empty van."
          />
        ) : null}
        <TextInput id="address" label="Address" value={form.address} onChange={set('address')} />
      </form>
    </Modal>
  );
}

export function LocationsPage() {
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const locations = useLocations();
  const totals = useStockByLocation();
  const [type, setType] = useState(null);
  const [showForm, setShowForm] = useState(false);

  const totalsById = new Map((totals.data ?? []).map((t) => [t.location_id, t]));
  const rows = (locations.data ?? []).filter((l) => !type || l.type === type);

  const columns = [
    {
      key: 'name',
      header: 'Location',
      render: (row) => (
        <>
          <div className="item-name">{row.name}</div>
          <div className="item-meta">{row.address ?? '—'}</div>
        </>
      ),
    },
    { key: 'type', header: 'Type', render: (row) => <Badge value={row.type} /> },
    { key: 'tech_name', header: 'Tech', render: (row) => row.tech_name ?? '—' },
    {
      key: 'units',
      header: 'Units ready',
      numeric: true,
      render: (row) => totalsById.get(row.id)?.installable_units ?? 0,
    },
    {
      key: 'to_return',
      header: 'To collect',
      numeric: true,
      render: (row) => totalsById.get(row.id)?.to_return_units ?? 0,
    },
    {
      key: 'bulk',
      header: 'Bulk lines',
      numeric: true,
      render: (row) => totalsById.get(row.id)?.bulk_item_count ?? 0,
    },
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow="Stock"
        title="Locations"
        sub="Warehouses, sites and tech vans. Click a row for what it holds."
        actions={
          hasRole('warehouse_staff', 'pm') ? (
            <button type="button" className="btn-primary" onClick={() => setShowForm(true)}>
              New location
            </button>
          ) : null
        }
      />

      <div className="chip-row">
        <button
          type="button"
          className={`chip ${type === null ? 'active' : ''}`.trim()}
          onClick={() => setType(null)}
        >
          All
        </button>
        {LOCATION_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            className={`chip ${type === t ? 'active' : ''}`.trim()}
            onClick={() => setType(t)}
          >
            {label(t)}
          </button>
        ))}
      </div>

      {locations.isPending ? (
        <LoadingRows />
      ) : locations.isError ? (
        <ErrorState error={locations.error} onRetry={locations.refetch} />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          onRowClick={(row) => navigate(`/locations/${row.id}/stock`)}
          empty={<EmptyState title="No locations yet">Create a warehouse to begin.</EmptyState>}
        />
      )}

      {showForm ? <LocationFormDialog onClose={() => setShowForm(false)} /> : null}
    </div>
  );
}
