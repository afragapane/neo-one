import styled from '@emotion/styled';
import { Label } from '@neo-one/react-common';
import { prop } from 'styled-tools';

export const SettingsLabel = styled(Label)`
  ${prop('theme.fontStyles.subheading')};
  grid-auto-flow: column;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  white-space: nowrap;

  &&& {
    display: grid;
  }
`;
