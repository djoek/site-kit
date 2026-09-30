// Site configuration: facts only. Visitor-facing copy lives in src/content/i18n/<lang>.json.
import { z } from 'astro/zod';


const schema = z
  .object({
    /** Canonical origin, https, no trailing slash, no www unless the site really uses it. */
    url: z
      .string()
      .url()
      .refine((value) => value.startsWith('https://') && !value.endsWith('/'), 'must be https:// without trailing slash'),
    name: z.string().min(1),
    legalName: z.string().min(1),
    /** schema.org type, e.g. Organization, LocalBusiness, Bakery, CafeOrCoffeeShop, ChildCare. */
    schemaType: z.string().regex(/^[A-Z][A-Za-z]+$/).default('Organization'),
    email: z.string().email(),
    phone: z.string().min(1).optional(),
    vatNumber: z.string().min(1).optional(),
    address: z
      .object({
        street: z.string().min(1),
        postalCode: z.string().min(1),
        locality: z.string().min(1),
        country: z.string().length(2),
      })
      .optional(),
    languages: z.array(z.string().regex(/^[a-z]{2}$/)).min(1),
    defaultLanguage: z.string().regex(/^[a-z]{2}$/),
    analytics: z
      .object({
        umami: z.object({ scriptUrl: z.string().url(), websiteId: z.string().min(1) }),
      })
      .optional(),
    forms: z
      .object({
        contact: z.object({ endpoint: z.string().url() }).optional(),
      })
      .default({}),
    /** Path to hours.toml relative to the project root, or false when the site has no opening hours. */
    hours: z.union([z.literal(false), z.string()]).default(false),
    indexNowKey: z.string().regex(/^[A-Za-z0-9-]{8,128}$/).optional(),
    hosting: z.object({ provider: z.string().min(1) }).optional(),
    privacy: z.object({ lastUpdated: z.string().date() }),
    /** Permanent redirects from old URLs: { '/Prijzen.html': '/prijzen/' }. Exact match, case-sensitive. */
    redirects: z
      .record(z.string().regex(/^\/[^\s]*$/, 'must start with /'), z.string().regex(/^\/[^\s]*$/, 'must start with /'))
      .default({}),
    /** Reviewed, non-secret deploy target. Host, user and key live in the env file (see README). */
    deploy: z
      .object({
        remotePath: z
          .string()
          .regex(/^\/[A-Za-z0-9._/-]+$/, 'absolute path with letters, digits, . _ - / only')
          .refine((value) => !value.includes('..') && !value.endsWith('/') && !value.includes('//'), 'no "..", "//" or trailing slash'),
      })
      .optional(),
    /** Extra or overriding HTTP headers written to .htaccess. */
    headers: z.record(z.string(), z.string()).default({}),
  })
  .refine((site) => site.languages.includes(site.defaultLanguage), {
    message: 'languages must include defaultLanguage',
    path: ['languages'],
  });

/**
 * Validate and freeze the site configuration.
 * @param {z.input<typeof schema>} input
 * @returns {Readonly<z.output<typeof schema>>}
 */
export function defineSite(input) {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    throw new Error(`site.config is invalid:\n${issues.join('\n')}`);
  }
  return Object.freeze(result.data);
}

