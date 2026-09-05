import { useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useCreateService, useServices, useUpdateService } from '../hooks/useData';
import { DataTable } from '../components/DataTable';
import { Badge } from '../components/Badge';
import { Modal } from '../components/Modal';
import { Select, TextArea, TextInput } from '../components/fields';
import { EmptyState, ErrorState, LoadingRows } from '../components/states';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../components/Toast';

// 'job' is flat-rate work; 'meter' is measured on site. The distinction is what
// decides whether the mobile app asks the tech for a number.
const UNITS = [
  { value: 'job', label: 'job — flat rate' },
  { value: 'meter', label: 'meter — measured on site' },
];

function ServiceFormDialog({ onClose }) {
  const create = useCreateService();
  const { notify, notifyError } = useToast();

  const [form, setForm] = useState({ name: '', unit_of_measure: 'job', description: '' });
  const [errors, setErrors] = useState({});

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  async function onSubmit(event) {
    event.preventDefault();
    if (!form.name.trim()) {
      setErrors({ name: 'Required' });
      return;
    }
    try {
      await create.mutateAsync({
        name: form.name.trim(),
        unit_of_measure: form.unit_of_measure,
        description: form.description.trim() || undefined,
      });
      notify(`${form.name.trim()} added to the services catalog`);
      onClose();
    } catch (err) {
      // A duplicate name comes back as a 409 from the UNIQUE constraint.
      notifyError(err);
    }
  }

  return (
    <Modal
      title="New service"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="service-form"
            className="btn-primary"
            disabled={create.isPending}
          >
            {create.isPending ? 'Saving…' : 'Create service'}
          </button>
        </>
      }
    >
      <form id="service-form" onSubmit={onSubmit}>
        <TextInput
          id="name"
          label="Name"
          value={form.name}
          onChange={set('name')}
          error={errors.name}
          placeholder="Splicing"
        />
        <Select
          id="unit_of_measure"
          label="Charged by"
          value={form.unit_of_measure}
          onChange={set('unit_of_measure')}
          options={UNITS}
          hint={
            form.unit_of_measure === 'job'
              ? 'Recorded as one per visit — the tech is not asked for a number.'
              : 'The tech enters the measured amount when recording the work.'
          }
        />
        <TextArea
          id="description"
          label="Description"
          value={form.description}
          onChange={set('description')}
          rows={3}
          hint="Optional. What the job involves, for whoever picks it on a phone."
        />
      </form>
    </Modal>
  );
}

export function ServicesPage() {
  const { hasRole } = useAuth();
  const canEdit = hasRole('warehouse_staff', 'pm');
  const services = useServices(canEdit ? { include_inactive: true } : undefined);
  const update = useUpdateService();
  const { notify, notifyError } = useToast();
  const [showForm, setShowForm] = useState(false);

  async function toggleActive(row) {
    try {
      await update.mutateAsync({ id: row.id, is_active: !row.is_active });
      notify(row.is_active ? `${row.name} retired` : `${row.name} offered again`);
    } catch (err) {
      notifyError(err);
    }
  }

  const rows = useMemo(() => services.data ?? [], [services.data]);

  const columns = [
    {
      key: 'name',
      header: 'Service',
      render: (row) => (
        <>
          <div className="item-name">{row.name}</div>
          <div className="item-meta">{row.description || '—'}</div>
        </>
      ),
    },
    {
      key: 'unit_of_measure',
      header: 'Charged by',
      render: (row) => (row.unit_of_measure === 'job' ? 'Per visit' : `Per ${row.unit_of_measure}`),
    },
    {
      key: 'is_active',
      header: 'Status',
      render: (row) =>
        row.is_active ? <Badge variant="installed">Offered</Badge> : <Badge>Retired</Badge>,
    },
    ...(canEdit
      ? [
          {
            key: 'actions',
            header: '',
            render: (row) => (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => toggleActive(row)}
                disabled={update.isPending}
              >
                {row.is_active ? 'Retire' : 'Offer again'}
              </button>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow="Catalog"
        title="Services"
        sub="Billable labour a tech can record against an installation"
        actions={
          canEdit ? (
            <button type="button" className="btn-primary" onClick={() => setShowForm(true)}>
              New service
            </button>
          ) : null
        }
      />

      {services.isPending ? (
        <LoadingRows />
      ) : services.isError ? (
        <ErrorState error={services.error} onRetry={services.refetch} />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          empty={
            <EmptyState title="No services yet">
              A service is work performed, not stock held — splicing, a cable run, a PPPoE setup.
              Techs pick from this list when they record a job.
            </EmptyState>
          }
        />
      )}

      {showForm ? <ServiceFormDialog onClose={() => setShowForm(false)} /> : null}
    </div>
  );
}
