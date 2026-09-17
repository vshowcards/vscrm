import { Helmet } from '@dr.pogodin/react-helmet';

export const PageFavicon = () => {
  return (
    <Helmet>
      <link rel="icon" type="image/x-icon" href="/images/vscms.ico" />
    </Helmet>
  );
};
