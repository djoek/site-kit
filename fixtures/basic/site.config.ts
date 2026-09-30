import { defineSite } from '@djoek/site-kit/config';

export default defineSite({
  url: 'https://fixture.example.be',
  name: 'Bakkerij Voorbeeld',
  legalName: 'Bakkerij Voorbeeld BV',
  schemaType: 'Bakery',
  email: 'info@fixture.example.be',
  phone: '+32 3 000 00 00',
  vatNumber: 'BE0000.000.000',
  address: { street: 'Voorbeeldstraat 1', postalCode: '2530', locality: 'Boechout', country: 'BE' },
  languages: ['nl', 'en'],
  defaultLanguage: 'nl',
  forms: { contact: { endpoint: 'https://formspree.io/f/fixture01' } },
  hours: 'src/data/hours.toml',
  hosting: { provider: 'Voorbeeld Hosting' },
  privacy: { lastUpdated: '2026-09-30' },
});
