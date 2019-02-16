// tslint:disable no-null-keyword
import { Link } from '@neo-one/react-common';
import * as path from 'path';
import * as React from 'react';
import styled from 'styled-components';
import { prop } from 'styled-tools';

const StyledLink = styled(Link)`
  ${prop('theme.fonts.axiformaRegular')}
  ${prop('theme.fontStyles.subheading')}
`;

const Div = styled.div`
  margin-top: 80px;
`;

interface Props {
  readonly link: string;
}

const baseLink = 'https://github.com/neo-one-suite/neo-one/blob/master/';

export const EditPageLink = ({ link }: Props) => (
  <Div>
    <StyledLink linkColor="accent" href={path.join(baseLink, link)} target="_blank">
      Edit this page
    </StyledLink>
  </Div>
);
