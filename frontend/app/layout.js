import './globals.css';

export const metadata = {
  title: 'Ledgerly — Trust & transactions',
  description: 'Fraud monitoring dashboard for growing businesses.',
};

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
