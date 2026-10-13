const featureForRoute = Object.freeze(Object.fromEntries([
 ...['scan', 'sources/list', 'sources/detail', 'workshop/catalog', 'workshop/game', 'workshop/list', 'workshop/detail', 'workshop/favorites', 'workshop/favorite', 'workshop/attach', 'nexus/authorize', 'downloads/start', 'downloads/file', 'downloads/reveal',
  'library/import', 'updates/check', 'updates/download', 'installations/inspect', 'installations/plan',
  'installations/discard', 'installations/apply', 'installations/action'].map(route => [`/api/${route}`, 'library.manage']),
 ...['paths', 'paths/select', 'paths/remove', 'mapping', 'sources/connection', 'nexus/sso/start', 'nexus/sso/cancel', 'library/auto-import', 'installations/profile',
  'loadouts/save', 'loadouts/switch', 'loadouts/delete'].map(route => [`/api/${route}`, 'configuration.edit']),
 ...['installations/launch', 'installations/run'].map(route => [`/api/${route}`, 'game.launch']),
]));
module.exports = { featureForRoute };
