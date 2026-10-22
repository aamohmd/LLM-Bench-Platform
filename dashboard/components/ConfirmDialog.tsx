"use client";

import { useId } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useDialogAccessibility } from "./useDialogAccessibility";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  busy?: boolean;
  confirmDisabled?: boolean;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onCancel,
  onConfirm,
  busy = false,
  confirmDisabled = false,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useDialogAccessibility<HTMLDivElement>(open, onCancel);

  if (!open) return null;

  return (
    <div className="settings-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <div
        ref={dialogRef}
        className="settings-modal-card settings-confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <div className="settings-confirm-dialog__icon" aria-hidden="true">
          <AlertTriangle size={20} />
        </div>
        <div className="settings-confirm-dialog__content">
          <div className="settings-confirm-dialog__heading">
            <h3 id={titleId} className="settings-modal-title">{title}</h3>
            <button type="button" className="settings-icon-button" onClick={onCancel} aria-label="Close confirmation">
              <X size={17} aria-hidden="true" />
            </button>
          </div>
          <p id={descriptionId} className="settings-confirm-dialog__description">{description}</p>
          <div className="settings-modal-actions">
            <button type="button" className="settings-btn-secondary" onClick={onCancel} disabled={busy} data-autofocus>Cancel</button>
            <button type="button" className="settings-btn-danger" onClick={onConfirm} disabled={busy || confirmDisabled}>
              {busy ? "Working…" : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
