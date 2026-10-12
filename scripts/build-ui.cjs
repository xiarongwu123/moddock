const { build } = require('esbuild');
build({
 entryPoints: ['src/main.jsx'],
 bundle: true,
 jsx: 'automatic',
 outfile: 'public/auth.js',
 minify: true,
 target: ['chrome120'],
 external: ['/fonts/*'],
 define: { 'process.env.NODE_ENV': '"production"' },
 legalComments: 'eof',
}).then(() => console.log('Moddock UI built')).catch(() => { process.exitCode = 1; });
