import { useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useCreateItem, useItems } from '../hooks/useData';
import { DataTable } from '../components/DataTable';
import { Badge } from '../components/Badge';
import { Modal } from '../components/Modal';
import { NumberInput, Select, TextInput } from '../components/fields';
import { EmptyState, ErrorState, LoadingRows } from '../components/states';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../components/Toast';
import { TRACKING_TYPES, label } from '../lib/constants';

const UNITS = ['unit', 'meter', 'box', 'roll', 'metre'];

function ItemFormDialog({ onClose, categories }) {
  const create = useCreateItem();
  const { notify, notifyError } = useToast();

  const [form, setForm] = useState({
    name: '',
    category: '',
    tracking_type: 'serialized',
    unit_of_measure: 'unit',
    manufacturer: '',
    model: '',
    reorder_threshold: '',
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
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (!validate()) return;
    try {
      await create.mutateAsync({
        name: form.name.trim(),
        category: form.category.trim(),
        tracking_type: form.tracking_type,
        unit_of_measure: form.unit_of_measure.trim(),
        manufacturer: form.manufacturer.trim() || undefined,
        model: form.model.trim() || undefined,
        reorder_threshold:
          form.reorder_threshold === '' ? undefined : Number(form.reorder_threshold),
      });
      notify(`${form.name.trim()} added to the catalog`);
      onClose();
    } catch (err) {
      notifyError(err);
    }
  }

  return (
    <Modal
      title="New item"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="item-form" className="btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Saving…' : 'Create item'}
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
          hint={
            form.tracking_type === 'serialized'
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
            options={UNITS.map((u) => ({ value: u, label: u }))}
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

export function ItemsPage() {
  const { hasRole } = useAuth();
  const items = useItems();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState(null);
  const [showForm, setShowForm] = useState(false);

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
    </div>
  );
}
