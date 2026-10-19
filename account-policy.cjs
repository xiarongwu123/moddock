const featureForRoute = Object.freeze(Object.fromEntries([
 ...['options','start','resume','pause'].map(action=>[`/api/downloads/bundles/${action}`,'library.manage']),
 ...['scan', 'sources/list', 'sources/detail', 'workshop/catalog', 'workshop/game', 'workshop/list', 'workshop/detail', 'workshop/favorites', 'workshop/favorite', 'workshop/attach', 'nexus/authorize', 'downloads/start', 'downloads/file', 'downloads/reveal',
  'library/import', 'updates/check', 'updates/download', 'installations/inspect', 'installations/plan',
  'installations/discard', 'installations/apply', 'installations/action', 'installations/auto', 'installations/restore'].map(route => [`/api/${route}`, 'library.manage']),
 ...['paths', 'paths/select', 'paths/remove', 'mapping', 'workshop/mapping', 'sources/connection', 'nexus/sso/start', 'nexus/sso/cancel', 'library/auto-import', 'installations/profile',
  'loadouts/save', 'loadouts/switch', 'loadouts/delete'].map(route => [`/api/${route}`, 'configuration.edit']),
 ...['installations/launch', 'installations/run'].map(route => [`/api/${route}`, 'game.launch']),
]));
module.exports = { featureForRoute };
