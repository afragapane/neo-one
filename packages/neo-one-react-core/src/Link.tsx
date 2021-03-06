import styled from '@emotion/styled';
import { prop, switchProp } from 'styled-tools';
import { LinkBase } from './LinkBase';

export const Link = styled<typeof LinkBase, { readonly linkColor: string }>(LinkBase)`
  color: ${switchProp('linkColor', {
    primary: prop('theme.primary'),
    accent: prop('theme.accent'),
    gray: prop('theme.gray6'),
    light: prop('theme.gray1'),
  })};
  ${prop('theme.fonts.axiformaBold')};
  ${prop('theme.fontStyles.body1')};
  text-decoration: none;

  &:hover {
    color: ${prop('theme.primaryDark')};
    text-decoration: none;
  }

  &:focus {
    color: ${prop('theme.primaryDark')};
    text-decoration: none;
  }

  &:active {
    color: ${prop('theme.primaryDark')};
    text-decoration: none;
  }
`;
