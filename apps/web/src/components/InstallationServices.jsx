import { useState } from 'react';
import { useServices, useSetInstallationServices } from '../hooks/useData';
import { Modal } from './Modal';
import { NumberInput, TextInput } from './fields';
import { EmptyState, ErrorState, LoadingRows } from './states';
import { useToast } from './Toast';

// "40 m" for measured work, just the name for flat-rate work — a bare "1" next
// to Splicing is noise, because a splice is always one splice.
export function formatServiceLine(line) {
  return line.unit_of_measure === 'job' ? line.name : `${line.name} — ${line.quantity} m`;
}

// Read-only summary, used on the current installation and on each timeline entry.
export function ServicesSummary({ services }) {
  if (!services || services.length === 0) return null;
  return (
    <div className="item-meta">
      Work: {services.map(formatServiceLine).join(' · ')}
    </div>
  );
}

export function EditServicesDialog({ installationId, premisesId, current, onClose }) {
  const services = useServices();
  const save = useSetInstallationServices(premisesId);
  const { notify, notifyError } = useToast();

  // Keyed by service id so a checkbox toggle does not disturb the others.
  const [lines, setLines] = useState(() =>
    Object.fromEntries(
      (current ?? []).map((line) => [
        line.service_id,
        { quantity: String(line.quantity), notes: line.notes ?? '' },
      ])
    )
  );

  const toggle = (service) =>
    setLines((prev) => {
      const next = { ...prev };
      if (next[service.id]) delete next[service.id];
      // A flat-rate service is always 1, so it needs no typing to be valid.
      else next[service.id] = { quantity: '1', notes: '' };
      return next;
    });

  const edit = (id, key) => (value) =>
    setLines((prev) => ({ ...prev, [id]: { ...prev[id], [key]: value } }));

  async function onSubmit(event) {
    event.preventDefault();
    try {
      await save.mutateAsync({
        installationId,
        services: Object.entries(lines).map(([serviceId, line]) => ({
          service_id: Number(serviceId),
          quantity: Number(line.quantity),
          notes: line.notes.trim() || undefined,
        })),
      });
      notify('Recorded work updated');
      onClose();
    } catch (err) {
      notifyError(err);
    }
  }

  const chosen = Object.keys(lines).length;

  return (
    <Modal
      title="Record work performed"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="services-form"
            className="btn-primary"
            disabled={save.isPending}
          >
            {save.isPending ? 'Saving…' : `Save ${chosen} service${chosen === 1 ? '' : 's'}`}
          </button>
        </>
      }
    >
      {services.isPending ? (
        <LoadingRows rows={3} />
      ) : services.isError ? (
        <ErrorState error={services.error} onRetry={services.refetch} />
      ) : services.data.length === 0 ? (
        <EmptyState title="No services in the catalog">
          Add one under Catalog → Services first.
        </EmptyState>
      ) : (
        <form id="services-form" onSubmit={onSubmit}>
          {services.data.map((service) => {
            const line = lines[service.id];
            return (
              <div className="card flat" key={service.id}>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={Boolean(line)}
                    onChange={() => toggle(service)}
                  />
                  <span>
                    <span className="item-name">{service.name}</span>
                    <span className="item-meta">
                      {service.unit_of_measure === 'job'
                        ? 'Per visit'
                        : `Per ${service.unit_of_measure}`}
                      {service.description ? ` · ${service.description}` : ''}
                    </span>
                  </span>
                </label>

                {line ? (
                  <div className="field-row">
                    {/* Flat-rate work is always one per visit, so there is
                        nothing to ask. Measured work needs the number. */}
                    {service.unit_of_measure === 'job' ? null : (
                      <NumberInput
                        id={`qty-${service.id}`}
                        label={`Amount (${service.unit_of_measure})`}
                        value={line.quantity}
                        onChange={edit(service.id, 'quantity')}
                        min="0"
                        step="any"
                      />
                    )}
                    <TextInput
                      id={`notes-${service.id}`}
                      label="Notes"
                      value={line.notes}
                      onChange={edit(service.id, 'notes')}
                      placeholder="Optional"
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </form>
      )}
    </Modal>
  );
}
