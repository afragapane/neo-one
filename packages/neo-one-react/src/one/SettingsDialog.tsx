import * as React from 'react';
import { Base } from 'reakit';
import { AddToken } from './AddToken';
import { AutoConsensusOption } from './AutoConsensusOption';
import { Dialog, OverlayProps } from './Dialog';
import { ResetLocalStateButton } from './ResetLocalStateButton';

interface Props {
  readonly children: (props: OverlayProps) => React.ReactNode;
}

export function SettingsDialog({ children }: Props) {
  return (
    <Dialog
      data-test-heading="neo-one-settings-dialog-heading"
      data-test-close-button="neo-one-settings-dialog-close-button"
      title="Settings"
      renderDialog={() => (
        <Base>
          <AddToken />
          <AutoConsensusOption />
          <ResetLocalStateButton />
        </Base>
      )}
    >
      {children}
    </Dialog>
  );
}
