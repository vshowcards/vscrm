import { Img } from 'react-email';

const logoStyle = {
  marginBottom: '40px',
};

export const Logo = () => {
  return (
    <Img
      src="https://vshowcards.com/assets/images/favicon.ico"
      alt="VSCMS logo"
      width="40"
      height="32"
      style={logoStyle}
    />
  );
};
