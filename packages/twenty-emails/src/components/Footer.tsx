import { type I18n } from '@lingui/core';
import { Column, Container, Row } from 'react-email';
import { Link } from 'src/components/Link';
import { ShadowText } from 'src/components/ShadowText';

const footerContainerStyle = {
  marginTop: '12px',
};

type FooterProps = {
  i18n: I18n;
};

export const Footer = ({ i18n }: FooterProps) => {
  return (
    <Container style={footerContainerStyle}>
      <Row>
        <Column>
          <ShadowText>
            <Link
              href="https://vshowcards.com/"
              value={i18n._('Website')}
              aria-label={i18n._("Visit VSCMS's website")}
            />
          </ShadowText>
        </Column>
        <Column>
          <ShadowText>
            <Link
              href="https://github.com/vshowcards/vscrm"
              value={i18n._('Github')}
              aria-label={i18n._("Visit VSCMS's GitHub repository")}
            />
          </ShadowText>
        </Column>
        <Column>
          <ShadowText>
            <Link
              href="https://docs.twenty.com/getting-started/introduction"
              value={i18n._('User guide')}
              aria-label={i18n._('Read the CRM user guide')}
            />
          </ShadowText>
        </Column>
        <Column>
          <ShadowText>
            <Link
              href="https://docs.twenty.com/"
              value={i18n._('Developers')}
              aria-label={i18n._('Visit the framework documentation')}
            />
          </ShadowText>
        </Column>
      </Row>
      <ShadowText>
        <>
          VSCMS
          <br />
          vShowcards
        </>
      </ShadowText>
    </Container>
  );
};
