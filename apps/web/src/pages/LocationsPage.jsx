import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import {
  useCreateLocation,
  useDeleteLocation,
  useLocations,
  useStockByLocation,
  useUpdateLocation,
  useUsers,
} from '../hooks/useData';
import { DataTable } from '../components/DataTable';
import { Badge } from '../components/Badge';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { RowMenu } from '../components/RowMenu';
import { Select, TextInput } from '../components/fields';
import { EmptyState, ErrorState, LoadingRows } from '../components/states';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../components/Toast';
import { LOCATION_TYPES, label } from '../lib/constants';

// One dialog for both jobs. Passing an `existing` location switches it to an
// edit: the type field locks, because the API refuses to change it once stock
// has been booked against the location.
function LocationFormDialog({ onClose, existing }) {
  const create = useCreateLocation();
  const update = useUpdateLocation();
  const techs = useUsers({ role: 'field_tech', is_active: true });
  const { notify, notifyError } = useToast();

  const editing = Boolean(existing);
  const saving = editing ? update.isPending : create.isPending;

  const [form, setForm] = useState({
    name: existing?.name ?? '',
    type: existing?.type ?? 'warehouse',
    tech_id: existing?.tech_id ? String(existing.tech_id) : '',
    address: existing?.address ?? '',
  });
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

    // PATCH takes null to clear an address, where POST wants the field left off
    // altogether — the same empty box means two different things.
    const body = {
      name: form.name.trim(),
      tech_id: form.type === 'tech_van' ? Number(form.tech_id) : editing ? null : undefined,
      address: form.address.trim() || (editing ? null : undefined),
    };

    try {
      if (editing) {
        await update.mutateAsync({ id: existing.id, ...body });
        notify(`${form.name.trim()} updated`);
      } else {
        await create.mutateAsync({ ...body, type: form.type });
        notify(`${form.name.trim()} created`);
      }
      onClose();
    } catch (err) {
      notifyError(err);
    }
  }

  return (
    <Modal
      title={editing ? `Edit ${existing.name}` : 'New location'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="location-form" className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Create location'}
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
          disabled={editing}
          options={LOCATION_TYPES.map((t) => ({ value: t, label: label(t) }))}
          hint={
            editing
              ? 'Fixed once created — every stock row here was booked against this kind of place.'
              : undefined
          }
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

function DeleteLocationDialog({ location, onClose }) {
  const remove = useDeleteLocation();
  const { notify, notifyError } = useToast();

  async function onConfirm() {
    try {
      await remove.mutateAsync(location.id);
      notify(`${location.name} deleted`);
    } catch (err) {
      // A 409 means it has history; its message says to retire it instead.
      notifyError(err);
    }
    onClose();
  }

  return (
    <ConfirmDialog
      title={`Delete ${location.name}?`}
      confirmLabel="Delete permanently"
      pendingLabel="Deleting…"
      pending={remove.isPending}
      onConfirm={onConfirm}
      onClose={onClose}
    >
      <p>
        This removes the location for good and cannot be undone. It only works for a location
        that never held stock, was never part of a movement or restock request, and has nobody
        assigned to it.
      </p>
      <p>
        Otherwise use <strong>Retire</strong> — it leaves the pickers but its history stays, and
        you can restore it later.
      </p>
    </ConfirmDialog>
  );
}

export function LocationsPage() {
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const canEdit = hasRole('warehouse_staff', 'pm');
  const canDelete = hasRole('admin');
  // Editors also see retired locations, otherwise there is nothing to restore.
  const locations = useLocations(undefined, { includeInactive: canEdit });
  const totals = useStockByLocation();
  const update = useUpdateLocation();
  const { notify, notifyError } = useToast();
  const [type, setType] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  async function toggleActive(row) {
    try {
      await update.mutateAsync({ id: row.id, is_active: !row.is_active });
      notify(row.is_active ? `${row.name} retired` : `${row.name} restored`);
    } catch (err) {
      // A location that still holds stock answers 409 and says what to move.
      notifyError(err);
    }
  }

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
    ...(canEdit
      ? [
          {
            key: 'status',
            header: 'Status',
            render: (row) =>
              row.is_active ? <Badge variant="installed">Active</Badge> : <Badge>Retired</Badge>,
          },
          {
            key: 'actions',
            header: '',
            // RowMenu stops propagation itself: the row opens the stock view.
            render: (row) => (
              <RowMenu
                label={`Actions for ${row.name}`}
                items={[
                  { label: 'Edit', onSelect: () => setEditing(row) },
                  {
                    label: row.is_active ? 'Retire' : 'Restore',
                    onSelect: () => toggleActive(row),
                    disabled: update.isPending,
                  },
                  {
                    label: 'Delete…',
                    danger: true,
                    hidden: !canDelete,
                    onSelect: () => setDeleting(row),
                  },
                ]}
              />
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow="Stock"
        title="Locations"
        sub="Warehouses, sites and tech vans. Click a row for what it holds."
        actions={
          canEdit ? (
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
      {editing ? (
        <LocationFormDialog existing={editing} onClose={() => setEditing(null)} />
      ) : null}
      {deleting ? <DeleteLocationDialog location={deleting} onClose={() => setDeleting(null)} /> : null}
    </div>
  );
}
