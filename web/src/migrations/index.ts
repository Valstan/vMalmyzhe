import * as migration_20260621_145321_initial from './20260621_145321_initial';
import * as migration_20260726_141845_m0_news_portal from './20260726_141845_m0_news_portal';

export const migrations = [
  {
    up: migration_20260621_145321_initial.up,
    down: migration_20260621_145321_initial.down,
    name: '20260621_145321_initial',
  },
  {
    up: migration_20260726_141845_m0_news_portal.up,
    down: migration_20260726_141845_m0_news_portal.down,
    name: '20260726_141845_m0_news_portal'
  },
];
