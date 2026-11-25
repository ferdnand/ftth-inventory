import { useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useCreateItem, useDeleteItem, useItems, useUpdateItem } from '../hooks/useData';
import { DataTable } from '../components/DataTable';
import { Badge } from '../components/Badge';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { RowMenu } from '../components/RowMenu';
import { NumberInput, Select, TextInput } from '../components/fields';
import { EmptyState, ErrorState, LoadingRows } from '../components/states';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../components/Toast';
import { formatMoney } from '../lib/money';
import { TRACKING_TYPES, label } from '../lib/constants';

const UNITS = ['unit', 'meter', 'box', 'roll', 'metre'];

// Creates a new item, or edits `item` when one is passed. Editing cannot change
// the tracking type: the API refuses it because every unit and stock row already
// booked against the item depends on it.
function ItemFormDialog({ onClose, categories, item = null }) {
  const create = useCreateItem();
  const update = useUpdateItem();
  const saving = create.isPending || update.isPending;
  const editing = item !== null;
  const { notify, notifyError } = useToast();

  const [form, setForm] = useState({
    name: item?.name ?? '',
    category: item?.category ?? '',
    tracking_type: item?.tracking_type ?? 'serialized',
    unit_of_measure: item?.unit_of_measure ?? 'unit',
    manufacturer: item?.manufacturer ?? '',
    model: item?.model ?? '',
    reorder_threshold: item?.reorder_threshold ?? '',
    unit_cost: item?.unit_cost ?? '',
  });
  const [errors, setErrors] = useState({});

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  function validate() {
    // Mirrors the API's own 400 so the round trip is only for what the client
    // cannot know.
    const next = {};
    if (!form.name.trim()) next.name = 'Required';
    if (!form.category.trim()) next.category = 'Required';
    if (!form.unit_of_measure.trim()) next.unit_of_measure = 'Required';
    if (form.reorder_threshold !== '' && Number(form.reorder_threshold) < 0) {
      next.reorder_threshold = 'Cannot be negative';
    }
    if (form.unit_cost !== '' && Number(form.unit_cost) < 0) {
      next.unit_cost = 'Cannot be negative';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (!validate()) return;
    // A blank is `undefined` on create (omit it) but `null` on edit, where
    // omitting a field would leave the old value in place instead of clearing it.
    const blank = editing ? null : undefined;
    const body = {
      name: form.name.trim(),
      category: form.category.trim(),
      unit_of_measure: form.unit_of_measure.trim(),
      manufacturer: form.manufacturer.trim() || blank,
      model: form.model.trim() || blank,
      reorder_threshold:
        form.reorder_threshold === '' ? blank : Number(form.reorder_threshold),
      unit_cost: form.unit_cost === '' ? blank : Number(form.unit_cost),
    };
    try {
      if (editing) {
        await update.mutateAsync({ id: item.id, ...body });
        notify(`${body.name} updated`);
      } else {
        await create.mutateAsync({ ...body, tracking_type: form.tracking_type });
        notify(`${body.name} added to the catalog`);
      }
      onClose();
    } catch (err) {
      notifyError(err);
    }
  }

  return (
    <Modal
      title={editing ? `Edit ${item.name}` : 'New item'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="item-form" className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Create item'}
          </button>
        </>
      }
    >
      <form id="item-form" onSubmit={onSubmit}>
        <TextInput
          id="name"
          label="Name"
          value={form.name}
          onChange={set('name')}
          error={errors.name}
          placeholder="ONT HG8245Q2"
        />

        <TextInput
          id="category"
          label="Category"
          value={form.category}
          onChange={set('category')}
          error={errors.category}
          list="item-categories"
          placeholder="ONT"
          hint="Free text — pick an existing one to keep grouping tidy."
        />
        <datalist id="item-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>

        <Select
          id="tracking_type"
          label="Tracking"
          value={form.tracking_type}
          onChange={set('tracking_type')}
          options={TRACKING_TYPES.map((t) => ({ value: t, label: label(t) }))}
          disabled={editing}
          hint={
            editing
              ? 'Fixed once an item exists. To change it, create a new item and retire this one.'
              : form.tracking_type === 'serialized'
              ? 'Each unit is tracked individually by serial number — routers, ONTs, media converters. This drives everything downstream: installs, replacements and site history all key off a serial.'
              : 'Tracked as a quantity per location — cable, sleeves, connectors. Cannot be installed at a premises or replaced.'
          }
        />

        <div className="field-row">
          <Select
            id="unit_of_measure"
            label="Unit"
            value={form.unit_of_measure}
            onChange={set('unit_of_measure')}
            options={[...new Set([...UNITS, form.unit_of_measure])].map((u) => ({
              value: u,
              label: u,
            }))}
            error={errors.unit_of_measure}
          />
          <NumberInput
            id="reorder_threshold"
            label="Reorder threshold"
            value={form.reorder_threshold}
            onChange={set('reorder_threshold')}
            error={errors.reorder_threshold}
            min="0"
            hint="Leave blank to skip low-stock alerts for this item."
          />
          {/* What makes a job total mean anything. A job line copies this
              figure when the work is recorded, so setting it later prices
              future jobs and leaves past ones exactly as they were. */}
          <NumberInput
            id="unit_cost"
            label="Unit cost (KES)"
            value={form.unit_cost}
            onChange={set('unit_cost')}
            error={errors.unit_cost}
            min="0"
            step="any"
            hint="Per unit of measure. Blank means unpriced, and job totals will say so."
          />
        </div>

        <div className="field-row">
          <TextInput
            id="manufacturer"
            label="Manufacturer"
            value={form.manufacturer}
            onChange={set('manufacturer')}
          />
          <TextInput id="model" label="Model" value={form.model} onChange={set('model')} />
        </div>
      </form>
    </Modal>
  );
}

// Deleting is permanent, so it asks first and says what the alternative is.
function DeleteItemDialog({ item, onClose }) {
  const remove = useDeleteItem();
  const { notify, notifyError } = useToast();

  async function onConfirm() {
    try {
      await remove.mutateAsync(item.id);
      notify(`${item.name} deleted`);
      onClose();
    } catch (err) {
      // A 409 here means the item has history; its message tells the admin to
      // retire it instead.
      notifyError(err);
      onClose();
    }
  }

  return (
    <ConfirmDialog
      title={`Delete ${item.name}?`}
      confirmLabel="Delete permanently"
      pendingLabel="Deleting…"
      pending={remove.isPending}
      onConfirm={onConfirm}
      onClose={onClose}
    >
      <p>
        This removes the item from the catalog for good and cannot be undone. It only works for
        an item that was never received, moved, requested or used on a job.
      </p>
      <p>
        If it has been used, or you just want it out of the pickers, use <strong>Retire</strong>{' '}
        instead — the history stays intact and you can restore it later.
      </p>
    </ConfirmDialog>
  );
}

export function ItemsPage() {
  const { hasRole } = useAuth();
  const canEdit = hasRole('warehouse_staff', 'pm');
  const canDelete = hasRole('admin');
  // Editors also see retired items, otherwise there is nothing to restore.
  const items = useItems(canEdit ? { include_inactive: true } : undefined);
  const update = useUpdateItem();
  const { notify, notifyError } = useToast();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  async function toggleActive(row) {
    try {
      await update.mutateAsync({ id: row.id, is_active: !row.is_active });
      notify(row.is_active ? `${row.name} retired` : `${row.name} restored`);
    } catch (err) {
      notifyError(err);
    }
  }

  const categories = useMemo(
    () => [...new Set((items.data ?? []).map((i) => i.category))].sort(),
    [items.data]
  );

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (items.data ?? []).filter((item) => {
      if (category && item.category !== category) return false;
      if (!term) return true;
      return [item.name, item.manufacturer, item.model]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(term));
    });
  }, [items.data, search, category]);

  const columns = [
    {
      key: 'name',
      header: 'Item',
      render: (row) => (
        <>
          <div className="item-name">{row.name}</div>
          <div className="item-meta">
            {[row.manufacturer, row.model].filter(Boolean).join(' ') || '—'}
          </div>
        </>
      ),
    },
    { key: 'category', header: 'Category' },
    {
      key: 'tracking_type',
      header: 'Tracking',
      render: (row) => (
        <Badge value={row.tracking_type} variant={row.tracking_type === 'serialized' ? 'installed' : ''} />
      ),
    },
    { key: 'unit_of_measure', header: 'Unit' },
    {
      key: 'reorder_threshold',
      header: 'Reorder at',
      numeric: true,
      render: (row) => (row.reorder_threshold ?? '—'),
    },
    {
      key: 'unit_cost',
      header: 'Unit cost',
      numeric: true,
      render: (row) => formatMoney(row.unit_cost),
    },
    ...(canEdit
      ? [
          {
            key: 'is_active',
            header: 'Status',
            render: (row) =>
              row.is_active ? <Badge variant="installed">Active</Badge> : <Badge>Retired</Badge>,
          },
          {
            key: 'actions',
            header: '',
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
                  { label: 'Delete…', danger: true, hidden: !canDelete, onSelect: () => setDeleting(row) },
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
        eyebrow="Catalog"
        title="Items"
        sub="Every SKU the business stocks, and how each one is tracked"
        actions={
          hasRole('warehouse_staff', 'pm') ? (
            <button type="button" className="btn-primary" onClick={() => setShowForm(true)}>
              New item
            </button>
          ) : null
        }
      />

      <div className="premise-search">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by name, manufacturer or model"
          aria-label="Filter items"
        />
      </div>

      <div className="chip-row">
        <button
          type="button"
          className={`chip ${category === null ? 'active' : ''}`.trim()}
          onClick={() => setCategory(null)}
        >
          All
        </button>
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            className={`chip ${category === c ? 'active' : ''}`.trim()}
            onClick={() => setCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>

      {items.isPending ? (
        <LoadingRows />
      ) : items.isError ? (
        <ErrorState error={items.error} onRetry={items.refetch} />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          empty={
            <EmptyState title="No items match">
              {search || category
                ? 'Clear the filters to see the whole catalog.'
                : 'Add the first item to get started.'}
            </EmptyState>
          }
        />
      )}

      {showForm ? (
        <ItemFormDialog onClose={() => setShowForm(false)} categories={categories} />
      ) : null}
      {editing ? (
        <ItemFormDialog item={editing} onClose={() => setEditing(null)} categories={categories} />
      ) : null}
      {deleting ? <DeleteItemDialog item={deleting} onClose={() => setDeleting(null)} /> : null}
    </div>
  );
}
