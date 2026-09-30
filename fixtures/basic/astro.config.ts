import { defineConfig } from 'astro/config';
import { siteKit } from '@djoek/site-kit';
import site from './site.config';

export default defineConfig({ integrations: [siteKit(site)] });
